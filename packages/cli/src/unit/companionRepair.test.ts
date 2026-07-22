import * as assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, test } from 'node:test';
import { parseAnnotationCompanionText } from '@arcridge/sundial-editor-annotations';
import { parseGitNameStatus } from '@arcridge/sundial-editor-annotations/move';
import { repairFromDiff } from '@arcridge/sundial-editor-annotations/repair';
import { withCompanionLock } from '@arcridge/sundial-editor-annotations/store';

async function git(cwd: string, args: readonly string[]): Promise<string> {
	return new Promise((resolve, reject) => {
		const child = spawn('git', args, { cwd }); let stdout = ''; let stderr = '';
		child.stdout.on('data', data => { stdout += String(data); }); child.stderr.on('data', data => { stderr += String(data); });
		child.once('close', code => code === 0 ? resolve(stdout.trim()) : reject(new Error(stderr)));
	});
}

async function repository(prefix: string): Promise<string> {
	const cwd = await mkdtemp(path.join(os.tmpdir(), prefix));
	await git(cwd, ['init']); await git(cwd, ['config', 'user.email', 'test@example.com']); await git(cwd, ['config', 'user.name', 'Test']);
	return cwd;
}

describe('companion repair', () => {
	test('parses only Git-reported renames and deletions from NUL status', () => {
		assert.deepEqual(parseGitNameStatus('R100\0old file.ts\0new file.ts\0D\0gone.ts\0M\0changed.ts\0C100\0copy.ts\0copied.ts\0'), [
			{ kind: 'move', source: 'old file.ts', destination: 'new file.ts' },
			{ kind: 'delete', source: 'gone.ts' },
		]);
		assert.throws(() => parseGitNameStatus('R100\0old.ts\0'), /malformed rename/);
	});

	test('moves and deletes matching companions using Git classifications', async () => {
		const cwd = await repository('sundial-companion-repair-');
		try {
			await mkdir(path.join(cwd, 'nested'));
			await mkdir(path.join(cwd, '.sundial', 'nested'), { recursive: true });
			await writeFile(path.join(cwd, 'nested', 'old file.ts'), 'rename me\n');
			await writeFile(path.join(cwd, 'deleted.ts'), 'delete me\n');
			const companion = `version: 5\nsourceDigest: ${'a'.repeat(64)}\nannotations:\n`;
			await writeFile(path.join(cwd, '.sundial', 'nested', 'old file.ts.comments'), companion);
			await writeFile(path.join(cwd, '.sundial', 'deleted.ts.comments'), companion);
			await git(cwd, ['add', '.']); await git(cwd, ['commit', '-m', 'Initial']);
			await git(cwd, ['mv', 'nested/old file.ts', 'nested/new file.ts']);
			await rm(path.join(cwd, 'deleted.ts'));
			const result = (await repairFromDiff({ workspace: { cwd } })).companionRepair;
			assert.deepEqual(result.actions, [
				{
					kind: 'delete', source: 'deleted.ts', companion: '.sundial/deleted.ts.comments',
				},
				{
					kind: 'move', source: 'nested/old file.ts', destination: 'nested/new file.ts',
					companion: '.sundial/nested/old file.ts.comments',
					destinationCompanion: '.sundial/nested/new file.ts.comments',
				},
			]);
			await assert.rejects(() => readFile(path.join(cwd, '.sundial', 'deleted.ts.comments')));
			await assert.rejects(() => readFile(path.join(cwd, '.sundial', 'nested', 'old file.ts.comments')));
			assert.equal(await readFile(path.join(cwd, '.sundial', 'nested', 'new file.ts.comments'), 'utf8'), companion);
			assert.deepEqual((await repairFromDiff({ workspace: { cwd } })).companionRepair, { actions: [], affectedPaths: [] });
		} finally { await rm(cwd, { recursive: true, force: true }); }
	});

	test('leaves missing companions alone and refuses to overwrite a destination companion', async () => {
		const cwd = await repository('sundial-companion-conflict-');
		try {
			await mkdir(path.join(cwd, '.sundial'));
			await writeFile(path.join(cwd, 'old.ts'), 'source\n');
			await writeFile(path.join(cwd, 'without-comments.ts'), 'none\n');
			await writeFile(path.join(cwd, '.sundial', 'old.ts.comments'), 'old companion\n');
			await git(cwd, ['add', '.']); await git(cwd, ['commit', '-m', 'Initial']);
			await git(cwd, ['mv', 'old.ts', 'new.ts']);
			await rm(path.join(cwd, 'without-comments.ts'));
			await writeFile(path.join(cwd, '.sundial', 'new.ts.comments'), 'existing destination\n');
			await assert.rejects(() => repairFromDiff({ workspace: { cwd } }), error => error instanceof Error
				&& 'code' in error && error.code === 'companion_repair_conflict');
			assert.equal(await readFile(path.join(cwd, '.sundial', 'old.ts.comments'), 'utf8'), 'old companion\n');
			assert.equal(await readFile(path.join(cwd, '.sundial', 'new.ts.comments'), 'utf8'), 'existing destination\n');
		} finally { await rm(cwd, { recursive: true, force: true }); }
	});

	test('repairs two-way links when the moved companion is already at its destination', async () => {
		const cwd = await repository('sundial-companion-link-repair-');
		try {
			const commit = 'a'.repeat(40);
			const digest = 'b'.repeat(64);
			await mkdir(path.join(cwd, '.sundial'), { recursive: true });
			await writeFile(path.join(cwd, 'old.ts'), 'source\n');
			await writeFile(path.join(cwd, 'other.ts'), 'other\n');
			const user = {
				kind: 'user', id: 'query-1', permanentBaseCommit: commit, message: 'Move this.', preset: '%Q', scope: 'line',
				anchor: { line: 0, text: 'source', before: [], after: [] }, officialResponses: [],
				agentAnnotations: [{ annotationId: 'agent-note-1', file: 'other.ts', line: 0 }],
			};
			const agent = {
				kind: 'agent', id: 'agent-note-1', permanentBaseCommit: commit, agentId: 'agent-1', agentSessionId: 'session-1',
				body: 'Linked.', createdAt: '2026-07-21T12:00:00.000Z',
				anchor: { line: 0, text: 'other', before: [], after: [] },
				userAnnotation: { annotationId: 'query-1', file: 'old.ts', line: 0 },
			};
			const render = (annotation: unknown) => `version: 5\nsourceDigest: ${digest}\nannotations:\n  - ${JSON.stringify(annotation)}\n`;
			await writeFile(path.join(cwd, '.sundial', 'old.ts.comments'), render(user));
			await writeFile(path.join(cwd, '.sundial', 'other.ts.comments'), render(agent));
			await git(cwd, ['add', '.']); await git(cwd, ['commit', '-m', 'Initial']);
			await git(cwd, ['mv', 'old.ts', 'new.ts']);
			await rename(path.join(cwd, '.sundial', 'old.ts.comments'), path.join(cwd, '.sundial', 'new.ts.comments'));

			const result = (await repairFromDiff({ workspace: { cwd } })).companionRepair;
			assert.deepEqual(result.affectedPaths, ['.sundial/other.ts.comments']);
			assert.deepEqual(result.actions[0].kind === 'move' ? result.actions[0].linkedCompanions : [], ['.sundial/other.ts.comments']);
			const repairedAgent = parseAnnotationCompanionText(await readFile(path.join(cwd, '.sundial', 'other.ts.comments'), 'utf8')).annotations[0];
			assert.equal(repairedAgent.kind, 'agent');
			if (repairedAgent.kind === 'agent') { assert.equal(repairedAgent.userAnnotation.file, 'new.ts'); }
		} finally { await rm(cwd, { recursive: true, force: true }); }
	});

	test('serializes repair with other companion mutations through the shared lock', async () => {
		const cwd = await repository('sundial-companion-lock-');
		try {
			await mkdir(path.join(cwd, '.sundial'));
			await writeFile(path.join(cwd, 'old.ts'), 'source\n');
			await writeFile(path.join(cwd, '.sundial', 'old.ts.comments'), `version: 5\nsourceDigest: ${'a'.repeat(64)}\nannotations:\n`);
			await git(cwd, ['add', '.']); await git(cwd, ['commit', '-m', 'Initial']);
			await git(cwd, ['mv', 'old.ts', 'new.ts']);
			let release!: () => void;
			let acquired!: () => void;
			const acquiredPromise = new Promise<void>(resolve => { acquired = resolve; });
			const releasePromise = new Promise<void>(resolve => { release = resolve; });
			const holding = withCompanionLock(cwd, async () => { acquired(); await releasePromise; });
			await acquiredPromise;
			let settled = false;
			const repairing = repairFromDiff({ workspace: { cwd } }).finally(() => { settled = true; });
			await new Promise(resolve => setTimeout(resolve, 30));
			assert.equal(settled, false);
			release();
			await Promise.all([holding, repairing]);
			assert.equal(settled, true);
		} finally { await rm(cwd, { recursive: true, force: true }); }
	});
});
