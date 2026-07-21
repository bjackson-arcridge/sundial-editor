import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';

const maximumGitOutputBytes = 8 * 1024 * 1024;

export interface GitResult { readonly stdout: string; readonly stderr: string; }

export type GitWorkflowConflictCode =
	| 'nothing_to_checkpoint'
	| 'nothing_to_consolidate'
	| 'missing_permanent_commit'
	| 'invalid_baseline'
	| 'operation_in_progress'
	| 'unresolved_conflicts'
	| 'published_temporary_commit'
	| 'companion_repair_conflict'
	| 'git_output_limit';

export class GitWorkflowConflictError extends Error {
	constructor(readonly code: GitWorkflowConflictCode, message: string) {
		super(message);
		this.name = 'GitWorkflowConflictError';
	}
}

export async function assertGitWorktreeReady(cwd: string): Promise<void> {
	for (const marker of ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REBASE_HEAD', 'rebase-merge', 'rebase-apply']) {
		if (await gitPathExists(cwd, marker)) {
			throw new GitWorkflowConflictError('operation_in_progress', 'Git has an in-progress operation; finish or abort it before using Sundial commits.');
		}
	}
	const unmerged = (await runGitCommand(cwd, ['diff', '--name-only', '--diff-filter=U'])).stdout.trim();
	if (unmerged !== '') {
		throw new GitWorkflowConflictError('unresolved_conflicts', 'Git has unresolved conflicts; resolve them before using Sundial commits.');
	}
}

export async function runGitCommand(cwd: string, args: readonly string[]): Promise<GitResult> {
	return new Promise((resolve, reject) => {
		const child = spawn('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
		let stdout = ''; let stderr = ''; let outputBytes = 0; let outputExceeded = false; let settled = false;
		const collect = (target: 'stdout' | 'stderr', chunk: Buffer): void => {
			if (outputExceeded) { return; }
			outputBytes += chunk.byteLength;
			if (outputBytes > maximumGitOutputBytes) {
				outputExceeded = true;
				child.kill('SIGKILL');
				return;
			}
			if (target === 'stdout') { stdout += chunk.toString(); } else { stderr += chunk.toString(); }
		};
		child.stdout.on('data', (chunk: Buffer) => collect('stdout', chunk));
		child.stderr.on('data', (chunk: Buffer) => collect('stderr', chunk));
		child.once('error', error => {
			if (!settled) { settled = true; reject(new Error(`Git could not be started: ${error.message}`)); }
		});
		child.once('close', code => {
			if (settled) { return; }
			settled = true;
			if (outputExceeded) {
				reject(new GitWorkflowConflictError('git_output_limit', `git ${args[0]} exceeded the ${maximumGitOutputBytes}-byte output limit`));
			} else if (code === 0) { resolve({ stdout, stderr }); }
			else { reject(new Error(stderr.trim() || `git ${args[0]} failed`)); }
		});
	});
}

async function gitPathExists(cwd: string, name: string): Promise<boolean> {
	const value = (await runGitCommand(cwd, ['rev-parse', '--path-format=absolute', '--git-path', name])).stdout.trim();
	try { await access(value); return true; }
	catch (error) {
		if (isNodeError(error) && error.code === 'ENOENT') { return false; }
		throw error;
	}
}

function isNodeError(value: unknown): value is NodeJS.ErrnoException { return value instanceof Error; }
