import * as assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, test } from 'node:test';
import { parseGitNameStatus, repairCompanions } from '../companionRepair';

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
			await writeFile(path.join(cwd, '.sundial', 'nested', 'old file.ts.comments'), 'rename companion\n');
			await writeFile(path.join(cwd, '.sundial', 'deleted.ts.comments'), 'delete companion\n');
			await git(cwd, ['add', '.']); await git(cwd, ['commit', '-m', 'Initial']);
			await git(cwd, ['mv', 'nested/old file.ts', 'nested/new file.ts']);
			await rm(path.join(cwd, 'deleted.ts'));
			const result = await repairCompanions({ workspace: { cwd } });
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
			assert.equal(await readFile(path.join(cwd, '.sundial', 'nested', 'new file.ts.comments'), 'utf8'), 'rename companion\n');
			assert.deepEqual(await repairCompanions({ workspace: { cwd } }), { actions: [], affectedPaths: [] });
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
			await assert.rejects(() => repairCompanions({ workspace: { cwd } }), error => error instanceof Error
				&& 'code' in error && error.code === 'companion_repair_conflict');
			assert.equal(await readFile(path.join(cwd, '.sundial', 'old.ts.comments'), 'utf8'), 'old companion\n');
			assert.equal(await readFile(path.join(cwd, '.sundial', 'new.ts.comments'), 'utf8'), 'existing destination\n');
		} finally { await rm(cwd, { recursive: true, force: true }); }
	});
});
