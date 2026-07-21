import * as assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, test } from 'node:test';
import {
	appendOfficialResponse,
	appendUserAnnotation,
	createAnnotationAnchor,
	deleteUserAnnotation,
	parseAnnotationCompanion,
	readUserAnnotations,
	writeAgentAnnotationPair,
} from '../annotations';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

async function workspace(): Promise<{ root: string; source: string; sourceUri: string }> {
	const root = await mkdtemp(path.join(os.tmpdir(), 'sundial-annotations-'));
	roots.push(root);
	const source = path.join(root, 'src', 'example.ts');
	await mkdir(path.dirname(source), { recursive: true });
	await writeFile(source, 'before\n\nconst value = 1;\nafter\n');
	return { root, source, sourceUri: pathToFileURL(source).toString() };
}

describe('version 3 annotation companions', () => {
	test('builds fixed anchors from saved LF or CRLF source', () => {
		assert.deepEqual(createAnnotationAnchor('one\r\n\r\ntwo\r\nthree\r\nfour\r\nfive', 2), {
			line: 2, text: 'two', before: ['one'], after: ['three', 'four', 'five'],
		});
		assert.throws(() => createAnnotationAnchor('one', 1), /existing source line/);
	});

	test('appends and reads one current-format user annotation idempotently', async () => {
		const context = await workspace();
		const request = {
			workspace: { cwd: context.root }, document: { uri: context.sourceUri, line: 2 },
			annotation: { id: 'query-1', message: 'Explain this.', preset: '%Q', scope: 'line' as const },
		};
		const first = await appendUserAnnotation(request);
		const repeated = await appendUserAnnotation(request);
		assert.equal(first.kind, 'user');
		assert.deepEqual(first.anchor, { line: 2, text: 'const value = 1;', before: ['before'], after: ['after'] });
		assert.equal(repeated.id, first.id);
		assert.deepEqual((await readUserAnnotations({ workspace: { cwd: context.root }, document: { uri: context.sourceUri } })).annotations, [first]);
	});

	test('rejects every obsolete companion version', () => {
		for (const version of [1, 2, 4]) {
			assert.throws(() => parseAnnotationCompanion(`version: ${version}\nannotations:\n`), /version 3/);
		}
	});

	test('preserves official responses on the version 3 user record', async () => {
		const context = await workspace();
		await appendUserAnnotation({
			workspace: { cwd: context.root }, document: { uri: context.sourceUri, line: 2 },
			annotation: { id: 'query-1', message: 'Explain.', preset: '%Q', scope: 'line' },
		});
		await appendOfficialResponse({ workspaceCwd: context.root, sourceUri: context.sourceUri, response: {
			userAnnotationId: 'query-1', agentId: 'agent-1', agentSessionId: 'session-1', body: 'Done.', createdAt: '2026-07-21T12:00:00.000Z',
		} });
		const annotation = (await readUserAnnotations({ workspace: { cwd: context.root }, document: { uri: context.sourceUri } })).annotations[0];
		assert.equal(annotation.kind, 'user');
		if (annotation.kind !== 'user') { assert.fail('expected user annotation'); }
		assert.equal(annotation.officialResponses[0].body, 'Done.');
	});

	test('writes paired cross-file links and deletes either side safely', async () => {
		const context = await workspace();
		const target = path.join(context.root, 'src', 'other.ts');
		await writeFile(target, 'target\n');
		await appendUserAnnotation({
			workspace: { cwd: context.root }, document: { uri: context.sourceUri, line: 2 },
			annotation: { id: 'query-1', message: 'Explain.', preset: '%Q', scope: 'line' },
		});
		assert.deepEqual(await writeAgentAnnotationPair({
			workspaceCwd: context.root, originFile: 'src/example.ts', targetFile: 'src/other.ts', targetLine: 0,
			userAnnotationId: 'query-1', agentAnnotationId: 'agent-note-1', agentId: 'agent-1', agentSessionId: 'session-1',
			body: 'This location matters.', createdAt: '2026-07-21T12:00:00.000Z',
		}), ['src/example.ts', 'src/other.ts']);
		const origin = await readUserAnnotations({ workspace: { cwd: context.root }, document: { uri: context.sourceUri } });
		const childCompanion = await readUserAnnotations({ workspace: { cwd: context.root }, document: { uri: pathToFileURL(target).toString() } });
		assert.equal(origin.annotations[0].kind, 'user');
		assert.equal(childCompanion.annotations[0].kind, 'agent');
		await deleteUserAnnotation({ workspace: { cwd: context.root }, document: { uri: pathToFileURL(target).toString() }, annotation: { id: 'agent-note-1' } });
		const remaining = await readUserAnnotations({ workspace: { cwd: context.root }, document: { uri: context.sourceUri } });
		assert.equal(remaining.annotations[0].kind, 'user');
		if (remaining.annotations[0].kind === 'user') { assert.deepEqual(remaining.annotations[0].agentAnnotations, []); }
	});
});
