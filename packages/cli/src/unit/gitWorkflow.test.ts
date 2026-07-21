import * as assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, test } from 'node:test';
import { consolidateTemporaryCommits, createTemporaryCommit, moveGitWorkflowBaseline, readGitWorkflowState, temporaryCommitMessage } from '../gitWorkflow';

async function git(cwd: string, args: readonly string[]): Promise<string> {
	return new Promise((resolve, reject) => {
		const child = spawn('git', args, { cwd }); let stdout = ''; let stderr = '';
		child.stdout.on('data', data => { stdout += String(data); }); child.stderr.on('data', data => { stderr += String(data); });
		child.once('close', code => code === 0 ? resolve(stdout.trim()) : reject(new Error(stderr)));
	});
}

describe('git workflow', () => {
	test('checkpoints selected files and consolidates the temporary suffix', async () => {
		const cwd = await mkdtemp(path.join(os.tmpdir(), 'sundial-git-workflow-'));
		try {
			await git(cwd, ['init']); await git(cwd, ['config', 'user.email', 'test@example.com']); await git(cwd, ['config', 'user.name', 'Test']);
			await writeFile(path.join(cwd, 'source.ts'), 'one\n'); await git(cwd, ['add', 'source.ts']); await git(cwd, ['commit', '-m', 'Initial']);
			await writeFile(path.join(cwd, 'source.ts'), 'two\n'); await writeFile(path.join(cwd, '.sundial-source.ts.comments'), 'ignored\n');
			const checkpoint = await createTemporaryCommit({ workspace: { cwd }, file: 'source.ts' }, false);
			assert.equal(checkpoint.temporaryCommitCount, 1);
			assert.equal(await git(cwd, ['log', '-1', '--format=%s']), temporaryCommitMessage);
			await writeFile(path.join(cwd, 'second.ts'), 'second\n');
			const permanent = await consolidateTemporaryCommits({ workspace: { cwd }, message: 'Real work' });
			assert.equal(permanent.temporaryCommitCount, 0);
			assert.equal(await git(cwd, ['log', '-1', '--format=%s']), 'Real work');
			assert.equal(await git(cwd, ['show', '--format=', '--name-only', 'HEAD']), '.sundial-source.ts.comments\nsecond.ts\nsource.ts');
		} finally { await rm(cwd, { recursive: true, force: true }); }
	});

	test('moves the first-parent baseline without changing HEAD', async () => {
		const cwd = await mkdtemp(path.join(os.tmpdir(), 'sundial-git-baseline-'));
		try {
			await git(cwd, ['init']); await git(cwd, ['config', 'user.email', 'test@example.com']); await git(cwd, ['config', 'user.name', 'Test']);
			await writeFile(path.join(cwd, 'source.ts'), 'one\n'); await git(cwd, ['add', '.']); await git(cwd, ['commit', '-m', 'Initial']);
			await writeFile(path.join(cwd, 'source.ts'), 'two\n'); await git(cwd, ['commit', '-am', 'Second']);
			const initial = await readGitWorkflowState({ workspace: { cwd } });
			const previous = await moveGitWorkflowBaseline({ workspace: { cwd }, baseline: initial.head, action: 'previous' });
			assert.equal(previous.head, initial.head); assert.notEqual(previous.baseline, previous.head);
			assert.equal((await moveGitWorkflowBaseline({ workspace: { cwd }, baseline: previous.baseline, action: 'next' })).baseline, initial.head);
		} finally { await rm(cwd, { recursive: true, force: true }); }
	});
});
