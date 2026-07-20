import * as assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, test } from 'node:test';
import {
	appendUserAnnotation,
	appendOfficialResponse,
	companionPathForSource,
	deleteUserAnnotation,
	parseAnnotationCompanion,
	readUserAnnotations,
} from '../annotations';
import { attachProviderSession, enqueueWork, ensureAgentSession, listAgents, listWork } from '../agentStore';

const temporaryDirectories: string[] = [];

afterEach(async () => {
	await Promise.all(temporaryDirectories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
});

async function workspace(): Promise<{ root: string; sourceUri: string }> {
	const root = await mkdtemp(path.join(os.tmpdir(), 'sundial-annotations-'));
	temporaryDirectories.push(root);
	return { root, sourceUri: pathToFileURL(path.join(root, 'src', 'example.ts')).toString() };
}

describe('annotation companions', () => {
	test('maps source paths into the mirrored .sundial tree', async () => {
		const context = await workspace();
		assert.equal(
			companionPathForSource(context.root, context.sourceUri),
			path.join(context.root, '.sundial', 'src', 'example.ts.comments'),
		);
		assert.throws(() => companionPathForSource(context.root, 'untitled:Untitled-1'), /file scheme/);
		assert.throws(() => companionPathForSource(context.root, pathToFileURL(path.join(context.root, '..', 'outside.ts')).toString()), /inside/);
	});

	test('deletes one annotation by stable ID and preserves the remaining companion', async () => {
		const context = await workspace();
		let nextId = 0;
		for (const message of ['First.', 'Second.']) {
			await appendUserAnnotation({
				workspace: { cwd: context.root },
				document: { uri: context.sourceUri, line: nextId, text: `line ${nextId}`, before: [], after: [] },
				annotation: { message, preset: '%Q', scope: 'line' },
			}, { createId: () => `annotation-${++nextId}` });
		}
		const agent = (await listAgents(context.root))[0];
		const session = await ensureAgentSession({ workspaceCwd: context.root, selector: agent.id });
		await attachProviderSession({ workspaceCwd: context.root, agentSessionId: session.id, providerSessionId: 'thread-1' });
		for (const id of ['annotation-1', 'annotation-2']) {
			await enqueueWork({
				workspaceCwd: context.root,
				agentSelector: agent.id,
				userAnnotationId: id,
				source: { uri: context.sourceUri, path: 'src/example.ts', line: 0, text: 'line 0', before: [], after: [] },
				prompt: { preset: '%Q', scope: 'line', text: `Handle ${id}.` },
			});
		}

		const deleted = await deleteUserAnnotation({
			workspace: { cwd: context.root }, document: { uri: context.sourceUri },
			annotation: { id: 'annotation-1' },
		});
		assert.equal(deleted.message, 'First.');
		assert.deepEqual((await readUserAnnotations({
			workspace: { cwd: context.root }, document: { uri: context.sourceUri },
		})).annotations.map(annotation => annotation.id), ['annotation-2']);
		assert.deepEqual((await listWork(context.root)).map(work => work.id), ['annotation-2']);
		await assert.rejects(() => deleteUserAnnotation({
			workspace: { cwd: context.root }, document: { uri: context.sourceUri },
			annotation: { id: 'missing' },
		}), /Annotation not found/);
	});

	test('lazily appends and reads stable, versioned YAML annotations', async () => {
		const context = await workspace();
		let nextId = 0;
		const first = await appendUserAnnotation({
			workspace: { cwd: context.root },
			document: {
				uri: context.sourceUri, line: 4, text: 'const value = 1;',
				before: ['import value from "value";', 'function calculate() {'],
				after: ['return value;', '}'],
			},
			annotation: { message: 'Fix "this".\nPlease.', preset: '%F', scope: 'line' },
		}, { createId: () => `annotation-${++nextId}` });
		await appendUserAnnotation({
			workspace: { cwd: context.root },
			document: {
				uri: context.sourceUri, line: 4, text: 'const value = 1;',
				before: ['function calculate() {'], after: ['return value;', '}'],
			},
			annotation: { message: 'Add a test.', preset: '%T', scope: 'project' },
		}, { createId: () => `annotation-${++nextId}` });

		assert.equal(first.id, 'annotation-1');
		const companionPath = companionPathForSource(context.root, context.sourceUri);
		const yaml = await readFile(companionPath, 'utf8');
		assert.match(yaml, /^version: 1\nannotations:\n/);
		assert.doesNotMatch(yaml, /^\{/);
		const loaded = await readUserAnnotations({ workspace: { cwd: context.root }, document: { uri: context.sourceUri } });
		assert.deepEqual(loaded.annotations.map(annotation => ({ id: annotation.id, line: annotation.anchor.line })), [
			{ id: 'annotation-1', line: 4 },
			{ id: 'annotation-2', line: 4 },
		]);
		assert.equal(loaded.annotations[0].message, 'Fix "this".\nPlease.');
		assert.deepEqual(loaded.annotations[0].anchor.before, ['import value from "value";', 'function calculate() {']);
		assert.deepEqual(loaded.annotations[0].anchor.after, ['return value;', '}']);
	});

	test('persists an editor-preallocated user annotation identity idempotently', async () => {
		const context = await workspace();
		const request = {
			workspace: { cwd: context.root },
			document: { uri: context.sourceUri, line: 2, text: 'code', before: [], after: [] },
			annotation: { id: 'reserved-work-id', message: 'Fix it.', preset: '%F', scope: 'line' },
		} as const;
		assert.equal((await appendUserAnnotation(request)).id, 'reserved-work-id');
		assert.equal((await appendUserAnnotation(request)).id, 'reserved-work-id');
		assert.equal((await readUserAnnotations({
			workspace: request.workspace, document: { uri: context.sourceUri },
		})).annotations.length, 1);

		await assert.rejects(() => appendUserAnnotation({
			...request,
			annotation: { ...request.annotation, message: 'Different content.' },
		}), /already reserved with different content/);
	});

	test('upgrades only on response mutation and preserves multiple ordered responses on the originating identity', async () => {
		const context = await workspace();
		await appendUserAnnotation({
			workspace: { cwd: context.root },
			document: { uri: context.sourceUri, line: 1, text: 'code', before: [], after: [] },
			annotation: { id: 'query-1', message: 'Explain.', preset: '%Q', scope: 'line' },
		});
		for (const [index, body] of ['First response.', 'Second response.'].entries()) {
			await appendOfficialResponse({
				workspaceCwd: context.root,
				sourceUri: context.sourceUri,
				response: {
					userAnnotationId: 'query-1', agentId: 'agent-1', agentSessionId: `session-${index + 1}`,
					body, createdAt: `2026-07-20T14:0${index}:00.000Z`,
				},
			});
		}
		const companion = await readUserAnnotations({ workspace: { cwd: context.root }, document: { uri: context.sourceUri } });
		assert.equal(companion.version, 2);
		assert.deepEqual(companion.annotations[0].officialResponses.map(response => response.body), ['First response.', 'Second response.']);
		assert.ok(companion.annotations[0].officialResponses.every(response => response.userAnnotationId === 'query-1'));
	});

	test('returns an empty collection for a source without a companion', async () => {
		const context = await workspace();
		assert.deepEqual(
			await readUserAnnotations({ workspace: { cwd: context.root }, document: { uri: context.sourceUri } }),
			{ version: 1, annotations: [] },
		);
	});

	test('rejects malformed companions without changing them', async () => {
		const context = await workspace();
		const companionPath = companionPathForSource(context.root, context.sourceUri);
		await mkdir(path.dirname(companionPath), { recursive: true });
		await writeFile(companionPath, 'version: 1\nannotations:\n  - broken\n', { encoding: 'utf8', flag: 'wx' });
		const before = await readFile(companionPath, 'utf8');
		await assert.rejects(() => appendUserAnnotation({
			workspace: { cwd: context.root },
			document: { uri: context.sourceUri, line: 0, text: 'code', before: [], after: [] },
			annotation: { message: 'Do it.', preset: '%W', scope: 'line' },
		}), /Invalid annotation companion/);
		assert.equal(await readFile(companionPath, 'utf8'), before);
		assert.deepEqual(parseAnnotationCompanion('version: 2\nannotations:\n'), { version: 2, annotations: [] });
		assert.throws(() => parseAnnotationCompanion('version: 3\nannotations:\n'), /version 1 or 2/);
	});

	test('reads older version-1 entries without context arrays', () => {
		const companion = parseAnnotationCompanion([
			'version: 1',
			'annotations:',
			'  - id: "legacy"',
			'    message: "Existing annotation."',
			'    preset: "%Q"',
			'    scope: "line"',
			'    anchor:',
			'      line: 2',
			'      text: "const value = 1;"',
			'',
		].join('\n'));
		assert.deepEqual(companion.annotations[0].anchor, {
			line: 2, text: 'const value = 1;', before: [], after: [],
		});
	});
});
