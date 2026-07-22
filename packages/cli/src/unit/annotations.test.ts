import * as assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, test } from 'node:test';
import { parseAnnotationCompanionText, renderAnnotationCompanion } from '@arcridge/sundial-editor-annotations';
import { contentDigest } from '@arcridge/sundial-editor-annotations/digest';
import { createAnnotationAnchor } from '@arcridge/sundial-editor-annotations/reanchor';
import {
	appendOfficialResponse,
	appendUserAnnotation,
	deleteUserAnnotation,
	readUserAnnotations,
	reanchorAnnotations,
	writeAgentAnnotationPair,
} from '../annotations';
import { createTemporaryCommit, moveGitWorkflowBaseline } from '../gitWorkflow';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

async function git(cwd: string, args: readonly string[]): Promise<string> {
	return new Promise((resolve, reject) => {
		const child = spawn('git', args, { cwd }); let stdout = ''; let stderr = '';
		child.stdout.on('data', data => { stdout += String(data); }); child.stderr.on('data', data => { stderr += String(data); });
		child.once('close', code => code === 0 ? resolve(stdout.trim()) : reject(new Error(stderr)));
	});
}

async function workspace(): Promise<{ root: string; source: string; sourceUri: string }> {
	const root = await mkdtemp(path.join(os.tmpdir(), 'sundial-annotations-'));
	roots.push(root);
	const source = path.join(root, 'src', 'example.ts');
	await mkdir(path.dirname(source), { recursive: true });
	await writeFile(source, 'before\n\nconst value = 1;\nafter\n');
	await git(root, ['init']); await git(root, ['config', 'user.email', 'test@example.com']); await git(root, ['config', 'user.name', 'Test']);
	await git(root, ['add', '.']); await git(root, ['commit', '-m', 'Initial']);
	return { root, source, sourceUri: pathToFileURL(source).toString() };
}

describe('version 5 annotation companions', () => {
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
		assert.match(first.permanentBaseCommit, /^[0-9a-f]{40}$/);
		assert.deepEqual(first.anchor, { line: 2, text: 'const value = 1;', before: ['before'], after: ['after'] });
		assert.equal(repeated.id, first.id);
		assert.deepEqual((await readUserAnnotations({ workspace: { cwd: context.root }, document: { uri: context.sourceUri } })).annotations, [first]);
	});

	test('parses only the current source-digest and nullable-line format', () => {
		const permanentBaseCommit = 'a'.repeat(40);
		const annotation = {
			kind: 'user', id: 'query-1', message: 'Explain.', preset: '%Q', scope: 'line',
			permanentBaseCommit,
			anchor: { line: null, text: 'const value = 1;', before: ['before'], after: ['after'] },
			officialResponses: [{
				userAnnotationId: 'query-1', agentId: 'agent-1', agentSessionId: 'session-1',
				body: 'Done.', createdAt: '2026-07-21T12:00:00.000Z',
			}],
			agentAnnotations: [{ annotationId: 'agent-note-1', file: 'src/example.ts', line: null }],
		};
		const current = parseAnnotationCompanionText(`version: 5\nsourceDigest: ${'b'.repeat(64)}\nannotations:\n  - ${JSON.stringify(annotation)}\n`);
		assert.deepEqual(current, {
			version: 5, sourceDigest: 'b'.repeat(64), annotations: [annotation],
		});
		for (const version of [1, 2, 3, 4, 6]) {
			assert.throws(() => parseAnnotationCompanionText(`version: ${version}\nannotations:\n`), /version 5/);
		}
	});

	test('returns membership for the current permanent commit independently of temporary commits and selected baseline', async () => {
		const context = await workspace();
		const initialPermanentCommit = await git(context.root, ['rev-parse', 'HEAD']);
		await appendUserAnnotation({
			workspace: { cwd: context.root }, document: { uri: context.sourceUri, line: 2 },
			annotation: { id: 'query-1', message: 'First.', preset: '%Q', scope: 'line' },
		});
		await git(context.root, ['add', '.']);
		await git(context.root, ['commit', '-m', 'Permanent two']);
		const currentPermanentCommit = await git(context.root, ['rev-parse', 'HEAD']);
		await appendUserAnnotation({
			workspace: { cwd: context.root }, document: { uri: context.sourceUri, line: 2 },
			annotation: { id: 'query-2', message: 'Second.', preset: '%F', scope: 'line' },
		});

		const selected = await moveGitWorkflowBaseline({
			workspace: { cwd: context.root }, baseline: currentPermanentCommit, action: 'previous',
		});
		assert.equal(selected.baseline, initialPermanentCommit);
		await createTemporaryCommit({ workspace: { cwd: context.root } }, true);
		const read = await readUserAnnotations({ workspace: { cwd: context.root }, document: { uri: context.sourceUri } });
		assert.equal(read.currentPermanentCommit, currentPermanentCommit);
		assert.deepEqual(read.currentPermanentAnnotationIds, ['query-2']);
		assert.deepEqual(read.annotations.map(annotation => annotation.permanentBaseCommit), [
			initialPermanentCommit, currentPermanentCommit,
		]);
	});

	test('preserves a malformed predecessor file when a validated write is rejected', async () => {
		const context = await workspace();
		const companionPath = path.join(context.root, '.sundial', 'src', 'example.ts.comments');
		const malformed = 'version: 3\nannotations:\n  - not-json\n';
		await mkdir(path.dirname(companionPath), { recursive: true });
		await writeFile(companionPath, malformed);
		await assert.rejects(appendUserAnnotation({
			workspace: { cwd: context.root }, document: { uri: context.sourceUri, line: 2 },
			annotation: { id: 'query-1', message: 'Explain.', preset: '%Q', scope: 'line' },
		}), /version 5/);
		assert.equal(await readFile(companionPath, 'utf8'), malformed);
	});

	test('preserves official responses on the version 5 user record', async () => {
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

	test('finishes a cross-file agent deletion after its reverse link was already removed', async () => {
		const context = await workspace();
		const target = path.join(context.root, 'src', 'other.ts');
		await writeFile(target, 'target\n');
		await appendUserAnnotation({
			workspace: { cwd: context.root }, document: { uri: context.sourceUri, line: 2 },
			annotation: { id: 'query-1', message: 'Explain.', preset: '%Q', scope: 'line' },
		});
		await writeAgentAnnotationPair({
			workspaceCwd: context.root, originFile: 'src/example.ts', targetFile: 'src/other.ts', targetLine: 0,
			userAnnotationId: 'query-1', agentAnnotationId: 'agent-note-1', agentId: 'agent-1', agentSessionId: 'session-1',
			body: 'This location matters.', createdAt: '2026-07-21T12:00:00.000Z',
		});
		const originPath = path.join(context.root, '.sundial', 'src', 'example.ts.comments');
		const origin = parseAnnotationCompanionText(await readFile(originPath, 'utf8'));
		const parent = origin.annotations[0];
		assert.equal(parent.kind, 'user');
		if (parent.kind !== 'user') { assert.fail('expected user annotation'); }
		await writeFile(originPath, renderAnnotationCompanion({
			...origin,
			annotations: [{ ...parent, agentAnnotations: [] }],
		}));

		await deleteUserAnnotation({
			workspace: { cwd: context.root },
			document: { uri: pathToFileURL(target).toString() },
			annotation: { id: 'agent-note-1' },
		});
		assert.deepEqual((await readUserAnnotations({
			workspace: { cwd: context.root }, document: { uri: pathToFileURL(target).toString() },
		})).annotations, []);
	});

	test('re-anchors all annotations from one saved baseline and is idempotent', async () => {
		const context = await workspace();
		const previousSource = await readFile(context.source, 'utf8');
		await appendUserAnnotation({
			workspace: { cwd: context.root }, document: { uri: context.sourceUri, line: 2 },
			annotation: { id: 'query-1', message: 'Explain.', preset: '%Q', scope: 'line' },
		});
		await writeFile(context.source, `inserted\n${previousSource}`);
		const request = {
			workspace: { cwd: context.root }, document: { uri: context.sourceUri }, previousSource,
			expectedPreviousSourceDigest: contentDigest(previousSource),
		};
		const result = await reanchorAnnotations(request);
		assert.deepEqual(result.changedAnnotationIds, ['query-1']);
		assert.deepEqual(result.fileScopedAnnotationIds, []);
		assert.equal(result.companion.annotations[0].anchor.line, 3);
		assert.equal(result.companion.annotations[0].anchor.text, 'const value = 1;');
		assert.deepEqual(result.affectedPaths, ['.sundial/src/example.ts.comments']);
		assert.equal((await reanchorAnnotations(request)).alreadyApplied, true);
	});

	test('falls back to file scope and updates a reciprocal stable-id link', async () => {
		const context = await workspace();
		const target = path.join(context.root, 'src', 'other.ts');
		await writeFile(target, 'target\n');
		await appendUserAnnotation({
			workspace: { cwd: context.root }, document: { uri: context.sourceUri, line: 2 },
			annotation: { id: 'query-1', message: 'Explain.', preset: '%Q', scope: 'line' },
		});
		await writeAgentAnnotationPair({
			workspaceCwd: context.root, originFile: 'src/example.ts', targetFile: 'src/other.ts', targetLine: 0,
			userAnnotationId: 'query-1', agentAnnotationId: 'agent-note-1', agentId: 'agent-1', agentSessionId: 'session-1',
			body: 'Related.', createdAt: '2026-07-21T12:00:00.000Z',
		});
		const previousSource = await readFile(target, 'utf8');
		await writeFile(target, '');
		const result = await reanchorAnnotations({
			workspace: { cwd: context.root }, document: { uri: pathToFileURL(target).toString() }, previousSource,
			expectedPreviousSourceDigest: contentDigest(previousSource),
		});
		assert.deepEqual(result.fileScopedAnnotationIds, ['agent-note-1']);
		const origin = await readUserAnnotations({ workspace: { cwd: context.root }, document: { uri: context.sourceUri } });
		assert.equal(origin.annotations[0].kind, 'user');
		if (origin.annotations[0].kind === 'user') { assert.equal(origin.annotations[0].agentAnnotations[0].line, null); }
	});
});
