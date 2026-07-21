import * as assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
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
			assert.deepEqual([...permanent.affectedPaths].sort(), ['.sundial-source.ts.comments', 'second.ts', 'source.ts']);
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
			const root = await moveGitWorkflowBaseline({ workspace: { cwd }, baseline: previous.baseline, action: 'previous' });
			assert.equal(root.baseline, previous.baseline);
		} finally { await rm(cwd, { recursive: true, force: true }); }
	});

	test('reports untracked paths so editor diffs can use VS Code’s empty Git revision', async () => {
		const cwd = await mkdtemp(path.join(os.tmpdir(), 'sundial-git-untracked-'));
		try {
			await git(cwd, ['init']); await git(cwd, ['config', 'user.email', 'test@example.com']); await git(cwd, ['config', 'user.name', 'Test']);
			await writeFile(path.join(cwd, 'tracked.ts'), 'one\n'); await git(cwd, ['add', '.']); await git(cwd, ['commit', '-m', 'Initial']);
			await writeFile(path.join(cwd, 'annotated.ts'), 'new source\n');
			assert.deepEqual((await readGitWorkflowState({ workspace: { cwd } })).untrackedPaths, ['annotated.ts']);
		} finally { await rm(cwd, { recursive: true, force: true }); }
	});

	test('requires the complete commit message to identify a temporary commit', async () => {
		const cwd = await mkdtemp(path.join(os.tmpdir(), 'sundial-git-message-'));
		try {
			await git(cwd, ['init']); await git(cwd, ['config', 'user.email', 'test@example.com']); await git(cwd, ['config', 'user.name', 'Test']);
			await writeFile(path.join(cwd, 'source.ts'), 'one\n'); await git(cwd, ['add', '.']); await git(cwd, ['commit', '-m', 'Initial']);
			await writeFile(path.join(cwd, 'source.ts'), 'two\n');
			await git(cwd, ['commit', '-am', temporaryCommitMessage, '-m', 'This body makes the commit permanent.']);
			const state = await readGitWorkflowState({ workspace: { cwd } });
			assert.equal(state.temporaryCommitCount, 0);
			assert.equal(state.lastPermanentCommit, state.head);
		} finally { await rm(cwd, { recursive: true, force: true }); }
	});

	test('rejects a temporary suffix when any commit in it is published to origin', async () => {
		const cwd = await mkdtemp(path.join(os.tmpdir(), 'sundial-git-published-'));
		const remote = await mkdtemp(path.join(os.tmpdir(), 'sundial-git-origin-'));
		try {
			await git(remote, ['init', '--bare']);
			await git(cwd, ['init']); await git(cwd, ['config', 'user.email', 'test@example.com']); await git(cwd, ['config', 'user.name', 'Test']);
			await writeFile(path.join(cwd, 'source.ts'), 'one\n'); await git(cwd, ['add', '.']); await git(cwd, ['commit', '-m', 'Initial']);
			await writeFile(path.join(cwd, 'source.ts'), 'two\n'); await createTemporaryCommit({ workspace: { cwd } }, true);
			await git(cwd, ['remote', 'add', 'origin', remote]); await git(cwd, ['push', 'origin', 'HEAD:main']);
			await writeFile(path.join(cwd, 'source.ts'), 'three\n'); await git(cwd, ['commit', '-am', temporaryCommitMessage]);
			await assert.rejects(
				() => consolidateTemporaryCommits({ workspace: { cwd }, message: 'Must not rewrite published work' }),
				/reachable from origin/,
			);
		} finally {
			await rm(cwd, { recursive: true, force: true });
			await rm(remote, { recursive: true, force: true });
		}
	});

	test('detects in-progress operations through linked-worktree Git paths', async () => {
		const parent = await mkdtemp(path.join(os.tmpdir(), 'sundial-git-worktree-'));
		const cwd = path.join(parent, 'main');
		const linked = path.join(parent, 'linked');
		try {
			await git(parent, ['init', 'main']); await git(cwd, ['config', 'user.email', 'test@example.com']); await git(cwd, ['config', 'user.name', 'Test']);
			await writeFile(path.join(cwd, 'source.ts'), 'one\n'); await git(cwd, ['add', '.']); await git(cwd, ['commit', '-m', 'Initial']);
			await git(cwd, ['worktree', 'add', '-b', 'linked-work', linked]);
			await writeFile(path.join(linked, 'source.ts'), 'two\n');
			const mergeHead = await git(linked, ['rev-parse', '--path-format=absolute', '--git-path', 'MERGE_HEAD']);
			await writeFile(mergeHead, `${await git(linked, ['rev-parse', 'HEAD'])}\n`);
			await assert.rejects(
				() => createTemporaryCommit({ workspace: { cwd: linked } }, true),
				/in-progress operation/,
			);
		} finally { await rm(parent, { recursive: true, force: true }); }
	});

	test('rejects invalid repositories, clean checkpoints, and non-first-parent baselines', async () => {
		const outside = await mkdtemp(path.join(os.tmpdir(), 'sundial-git-invalid-'));
		const cwd = await mkdtemp(path.join(os.tmpdir(), 'sundial-git-ancestry-'));
		try {
			await assert.rejects(() => readGitWorkflowState({ workspace: { cwd: outside } }), /not a git repository/);
			await git(cwd, ['init']); await git(cwd, ['config', 'user.email', 'test@example.com']); await git(cwd, ['config', 'user.name', 'Test']);
			await assert.rejects(() => readGitWorkflowState({ workspace: { cwd } }), /HEAD|revision/);
			await writeFile(path.join(cwd, 'source.ts'), 'initial\n'); await git(cwd, ['add', '.']); await git(cwd, ['commit', '-m', 'Initial']);
			await assert.rejects(() => createTemporaryCommit({ workspace: { cwd } }, true), /no dirty files/);
			const mainBranch = await git(cwd, ['branch', '--show-current']);
			await git(cwd, ['checkout', '-b', 'side']); await writeFile(path.join(cwd, 'side.ts'), 'side\n'); await git(cwd, ['add', '.']); await git(cwd, ['commit', '-m', 'Side']);
			const side = await git(cwd, ['rev-parse', 'HEAD']);
			await git(cwd, ['checkout', mainBranch]); await writeFile(path.join(cwd, 'main.ts'), 'main\n'); await git(cwd, ['add', '.']); await git(cwd, ['commit', '-m', 'Main']);
			await git(cwd, ['merge', '--no-ff', 'side', '-m', 'Merge side']);
			await assert.rejects(
				() => readGitWorkflowState({ workspace: { cwd }, baseline: side }),
				/first-parent ancestry/,
			);
		} finally {
			await rm(outside, { recursive: true, force: true });
			await rm(cwd, { recursive: true, force: true });
		}
	});

	test('checkpoints one file with its dirty companion while preserving unrelated index and worktree state', async () => {
		const cwd = await mkdtemp(path.join(os.tmpdir(), 'sundial-git-file-scope-'));
		try {
			await git(cwd, ['init']); await git(cwd, ['config', 'user.email', 'test@example.com']); await git(cwd, ['config', 'user.name', 'Test']);
			await writeFile(path.join(cwd, 'source file.ts'), 'initial\n');
			await writeFile(path.join(cwd, 'staged.ts'), 'initial\n');
			await writeFile(path.join(cwd, 'worktree.ts'), 'initial\n');
			await git(cwd, ['add', '.']); await git(cwd, ['commit', '-m', 'Initial']);
			await writeFile(path.join(cwd, 'source file.ts'), 'checkpoint\n');
			await mkdir(path.join(cwd, '.sundial'));
			await writeFile(path.join(cwd, '.sundial', 'source file.ts.comments'), 'version: 3\nannotations:\n');
			await writeFile(path.join(cwd, 'staged.ts'), 'staged change\n'); await git(cwd, ['add', 'staged.ts']);
			await writeFile(path.join(cwd, 'worktree.ts'), 'worktree change\n');
			const state = await createTemporaryCommit({ workspace: { cwd }, file: 'source file.ts' }, false);
			assert.deepEqual([...state.affectedPaths].sort(), ['.sundial/source file.ts.comments', 'source file.ts']);
			assert.equal(await git(cwd, ['show', '--format=', '--name-only', 'HEAD']), '.sundial/source file.ts.comments\nsource file.ts');
			assert.equal(await git(cwd, ['show', 'HEAD:staged.ts']), 'initial');
			assert.match(await git(cwd, ['status', '--porcelain']), /M  staged\.ts/);
			assert.match(await git(cwd, ['status', '--porcelain']), / M worktree\.ts/);
		} finally { await rm(cwd, { recursive: true, force: true }); }
	});

	test('checkpoints both sides of a reported source and companion move for the current file', async () => {
		const cwd = await mkdtemp(path.join(os.tmpdir(), 'sundial-git-file-move-'));
		try {
			await git(cwd, ['init']); await git(cwd, ['config', 'user.email', 'test@example.com']); await git(cwd, ['config', 'user.name', 'Test']);
			await mkdir(path.join(cwd, '.sundial'));
			await writeFile(path.join(cwd, 'old.ts'), 'source\n');
			await writeFile(path.join(cwd, '.sundial', 'old.ts.comments'), 'stable companion\n');
			await git(cwd, ['add', '.']); await git(cwd, ['commit', '-m', 'Initial']);
			await git(cwd, ['mv', 'old.ts', 'new.ts']);
			const state = await createTemporaryCommit({ workspace: { cwd }, file: 'new.ts' }, false);
			assert.deepEqual(new Set(state.affectedPaths), new Set([
				'old.ts', 'new.ts', '.sundial/old.ts.comments', '.sundial/new.ts.comments',
			]));
			assert.equal(await git(cwd, ['ls-tree', '--name-only', 'HEAD', 'old.ts']), '');
			assert.equal(await git(cwd, ['show', 'HEAD:new.ts']), 'source');
			assert.equal(await git(cwd, ['show', 'HEAD:.sundial/new.ts.comments']), 'stable companion');
			await assert.rejects(() => git(cwd, ['show', 'HEAD:.sundial/old.ts.comments']));
		} finally { await rm(cwd, { recursive: true, force: true }); }
	});

	test('checkpoints every staged, unstaged, untracked, renamed, and deleted path', async () => {
		const cwd = await mkdtemp(path.join(os.tmpdir(), 'sundial-git-all-scope-'));
		try {
			await git(cwd, ['init']); await git(cwd, ['config', 'user.email', 'test@example.com']); await git(cwd, ['config', 'user.name', 'Test']);
			for (const file of ['staged.ts', 'unstaged.ts', 'old-name.ts', 'deleted.ts']) { await writeFile(path.join(cwd, file), 'initial\n'); }
			await git(cwd, ['add', '.']); await git(cwd, ['commit', '-m', 'Initial']);
			await writeFile(path.join(cwd, 'staged.ts'), 'staged\n'); await git(cwd, ['add', 'staged.ts']);
			await writeFile(path.join(cwd, 'unstaged.ts'), 'unstaged\n');
			await git(cwd, ['mv', 'old-name.ts', 'renamed file.ts']);
			await rm(path.join(cwd, 'deleted.ts'));
			await writeFile(path.join(cwd, 'untracked file.ts'), 'untracked\n');
			const state = await createTemporaryCommit({ workspace: { cwd } }, true);
			assert.deepEqual(new Set(state.affectedPaths), new Set([
				'staged.ts', 'unstaged.ts', 'old-name.ts', 'renamed file.ts', 'deleted.ts', 'untracked file.ts',
			]));
			assert.equal(await git(cwd, ['status', '--porcelain']), '');
			assert.equal(await git(cwd, ['log', '-1', '--format=%s']), temporaryCommitMessage);
		} finally { await rm(cwd, { recursive: true, force: true }); }
	});

	test('consolidates multiple temporary commits and dirty work onto the permanent parent without rewriting companion content', async () => {
		const cwd = await mkdtemp(path.join(os.tmpdir(), 'sundial-git-consolidate-'));
		try {
			await git(cwd, ['init']); await git(cwd, ['config', 'user.email', 'test@example.com']); await git(cwd, ['config', 'user.name', 'Test']);
			await writeFile(path.join(cwd, 'source.ts'), 'initial\n'); await git(cwd, ['add', '.']); await git(cwd, ['commit', '-m', 'Initial']);
			const permanentParent = await git(cwd, ['rev-parse', 'HEAD']);
			await mkdir(path.join(cwd, '.sundial'));
			const companion = 'version: 3\nannotations:\n  - {"kind":"user","id":"stable-id"}\n';
			await writeFile(path.join(cwd, '.sundial', 'source.ts.comments'), companion);
			await createTemporaryCommit({ workspace: { cwd } }, true);
			await writeFile(path.join(cwd, 'second.ts'), 'second\n'); await createTemporaryCommit({ workspace: { cwd } }, true);
			await writeFile(path.join(cwd, 'dirty.ts'), 'dirty\n');
			const beforeRejectedMessage = await git(cwd, ['rev-parse', 'HEAD']);
			await assert.rejects(() => consolidateTemporaryCommits({ workspace: { cwd }, message: '   ' }), /non-empty commit message/);
			assert.equal(await git(cwd, ['rev-parse', 'HEAD']), beforeRejectedMessage);
			const state = await consolidateTemporaryCommits({ workspace: { cwd }, message: 'Permanent result' });
			assert.equal(state.temporaryCommitCount, 0);
			assert.deepEqual(new Set(state.affectedPaths), new Set(['.sundial/source.ts.comments', 'second.ts', 'dirty.ts']));
			assert.equal(await git(cwd, ['rev-parse', 'HEAD^']), permanentParent);
			assert.equal(await git(cwd, ['rev-list', '--count', 'HEAD']), '2');
			assert.equal(await git(cwd, ['show', 'HEAD:.sundial/source.ts.comments']), companion.trim());
		} finally { await rm(cwd, { recursive: true, force: true }); }
	});

	test('rejects conflicted worktrees and bounds Git subprocess output', async () => {
		const cwd = await mkdtemp(path.join(os.tmpdir(), 'sundial-git-conflict-'));
		const large = await mkdtemp(path.join(os.tmpdir(), 'sundial-git-output-'));
		try {
			await git(cwd, ['init']); await git(cwd, ['config', 'user.email', 'test@example.com']); await git(cwd, ['config', 'user.name', 'Test']);
			await writeFile(path.join(cwd, 'source.ts'), 'initial\n'); await git(cwd, ['add', '.']); await git(cwd, ['commit', '-m', 'Initial']);
			const mainBranch = await git(cwd, ['branch', '--show-current']);
			await git(cwd, ['checkout', '-b', 'conflicting']); await writeFile(path.join(cwd, 'source.ts'), 'branch\n'); await git(cwd, ['commit', '-am', 'Branch']);
			await git(cwd, ['checkout', mainBranch]); await writeFile(path.join(cwd, 'source.ts'), 'main\n'); await git(cwd, ['commit', '-am', 'Main']);
			await assert.rejects(() => git(cwd, ['merge', 'conflicting']));
			await assert.rejects(() => createTemporaryCommit({ workspace: { cwd } }, true), error => error instanceof Error
				&& 'code' in error && error.code === 'operation_in_progress');

			await git(large, ['init']); await git(large, ['config', 'user.email', 'test@example.com']); await git(large, ['config', 'user.name', 'Test']);
			const message = path.join(large, 'large-message.txt');
			await writeFile(message, 'x'.repeat(8 * 1024 * 1024 + 1024));
			await git(large, ['commit', '--allow-empty', '-F', message]);
			await assert.rejects(() => readGitWorkflowState({ workspace: { cwd: large } }), error => error instanceof Error
				&& 'code' in error && error.code === 'git_output_limit');
		} finally {
			await rm(cwd, { recursive: true, force: true });
			await rm(large, { recursive: true, force: true });
		}
	});
});
