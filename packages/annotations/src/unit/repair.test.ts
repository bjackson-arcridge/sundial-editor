import * as assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, test } from 'node:test';
import { contentDigest } from '../digest';
import { parseAnnotationCompanionText, renderAnnotationCompanion, type AnnotationCompanion } from '../index';
import { parseGitNameStatus } from '../move';
import { repairFromDiff } from '../repair';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

async function git(cwd: string, args: readonly string[]): Promise<string> {
	return new Promise((resolve, reject) => {
		const child = spawn('git', args, { cwd });
		let stdout = '';
		let stderr = '';
		child.stdout.on('data', data => { stdout += String(data); });
		child.stderr.on('data', data => { stderr += String(data); });
		child.once('close', code => code === 0 ? resolve(stdout.trim()) : reject(new Error(stderr)));
	});
}

describe('repair from diff', () => {
	test('owns Git rename/delete classification', () => {
		assert.deepEqual(parseGitNameStatus('R100\0old file.ts\0new file.ts\0D\0gone.ts\0M\0changed.ts\0'), [
			{ kind: 'move', source: 'old file.ts', destination: 'new file.ts' },
			{ kind: 'delete', source: 'gone.ts' },
		]);
	});

	test('moves a companion, repairs deep file links, and reanchors from one entrypoint', async () => {
		const cwd = await mkdtemp(path.join(os.tmpdir(), 'sundial-repair-from-diff-'));
		roots.push(cwd);
		const previousSource = 'first\nsecond\nthird\n';
		const currentSource = 'inserted\nfirst\nsecond\nthird\n';
		await mkdir(path.join(cwd, '.sundial'), { recursive: true });
		await writeFile(path.join(cwd, 'old.ts'), previousSource);
		await writeFile(path.join(cwd, 'other.ts'), 'other\n');
		const commit = 'a'.repeat(40);
		const userCompanion: AnnotationCompanion = {
			version: 5,
			sourceDigest: contentDigest(previousSource),
			annotations: [{
				kind: 'user', id: 'query-1', permanentBaseCommit: commit, message: 'Explain.', preset: '%Q', scope: 'line',
				anchor: { line: 1, text: 'second', before: ['first'], after: ['third'] }, officialResponses: [],
				agentAnnotations: [{ annotationId: 'agent-note-1', file: 'other.ts', line: 0 }],
			}],
		};
		const agentCompanion: AnnotationCompanion = {
			version: 5,
			sourceDigest: contentDigest('other\n'),
			annotations: [{
				kind: 'agent', id: 'agent-note-1', permanentBaseCommit: commit, agentId: 'agent-1', agentSessionId: 'session-1',
				body: 'Linked.', createdAt: '2026-07-22T12:00:00.000Z',
				anchor: { line: 0, text: 'other', before: [], after: [] },
				userAnnotation: { annotationId: 'query-1', file: 'old.ts', line: 1 },
			}],
		};
		await writeFile(path.join(cwd, '.sundial', 'old.ts.comments'), renderAnnotationCompanion(userCompanion));
		await writeFile(path.join(cwd, '.sundial', 'other.ts.comments'), renderAnnotationCompanion(agentCompanion));
		await git(cwd, ['init']);
		await git(cwd, ['config', 'user.email', 'test@example.com']);
		await git(cwd, ['config', 'user.name', 'Test']);
		await git(cwd, ['add', '.']);
		await git(cwd, ['commit', '-m', 'Initial']);
		await git(cwd, ['mv', 'old.ts', 'new.ts']);
		await writeFile(path.join(cwd, 'new.ts'), currentSource);

		const result = await repairFromDiff({
			workspace: { cwd },
			document: { uri: pathToFileURL(path.join(cwd, 'new.ts')).toString() },
			previousSource,
			expectedPreviousSourceDigest: contentDigest(previousSource),
		});

		assert.equal(result.companionRepair.actions[0]?.kind, 'move');
		assert.equal(result.reanchor?.companion.annotations[0]?.anchor.line, 2);
		await assert.rejects(() => readFile(path.join(cwd, '.sundial', 'old.ts.comments')));
		const moved = parseAnnotationCompanionText(await readFile(path.join(cwd, '.sundial', 'new.ts.comments'), 'utf8'));
		assert.equal(moved.annotations[0]?.anchor.line, 2);
		const counterpart = parseAnnotationCompanionText(await readFile(path.join(cwd, '.sundial', 'other.ts.comments'), 'utf8'));
		const agent = counterpart.annotations[0];
		assert.equal(agent.kind, 'agent');
		if (agent.kind === 'agent') {
			assert.deepEqual(agent.userAnnotation, { annotationId: 'query-1', file: 'new.ts', line: 2 });
		}
	});
});
