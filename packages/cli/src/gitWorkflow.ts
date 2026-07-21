import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import * as path from 'node:path';

export const temporaryCommitMessage = 'Sundial:temp';

export interface GitWorkflowState {
	readonly head: string;
	readonly baseline: string;
	readonly lastPermanentCommit: string;
	readonly temporaryCommitCount: number;
	readonly affectedPaths: readonly string[];
}

export interface GitWorkflowRequest {
	readonly workspace: { readonly cwd: string };
	readonly baseline?: string;
	readonly file?: string;
	readonly message?: string;
}

interface GitResult { readonly stdout: string; readonly stderr: string; }

export async function readGitWorkflowState(value: unknown): Promise<GitWorkflowState> {
	const request = parseRequest(value);
	return stateFor(request.workspace.cwd, request.baseline);
}

export async function moveGitWorkflowBaseline(value: unknown): Promise<GitWorkflowState> {
	const request = parseRequest(value);
	const action = record(value).action;
	if (action !== 'previous' && action !== 'next' && action !== 'head' && action !== 'permanent') {
		throw new Error('workflow baseline action must be previous, next, head, or permanent');
	}
	const state = await stateFor(request.workspace.cwd, request.baseline);
	let baseline = state.baseline;
	if (action === 'head') { baseline = state.head; }
	else if (action === 'permanent') { baseline = state.lastPermanentCommit; }
	else if (action === 'previous') { baseline = await git(request.workspace.cwd, ['rev-parse', `${baseline}~1`]).then(result => result.stdout.trim()); }
	else {
		const commits = (await git(request.workspace.cwd, ['rev-list', '--first-parent', '--reverse', `${baseline}..${state.head}`])).stdout.trim().split('\n').filter(Boolean);
		if (commits.length > 0) { baseline = commits[0]; }
	}
	return stateFor(request.workspace.cwd, baseline);
}

export async function createTemporaryCommit(value: unknown, all: boolean): Promise<GitWorkflowState> {
	const request = parseRequest(value);
	await assertSafeMutation(request.workspace.cwd);
	const paths = all ? await dirtyPaths(request.workspace.cwd) : await commitPathsForFile(request.workspace.cwd, requiredFile(request));
	if (paths.length === 0) { throw new Error('There are no dirty files to checkpoint.'); }
	await git(request.workspace.cwd, ['add', '--', ...paths]);
	await git(request.workspace.cwd, all ? ['commit', '-m', temporaryCommitMessage] : ['commit', '--only', '-m', temporaryCommitMessage, '--', ...paths]);
	return { ...(await stateFor(request.workspace.cwd, request.baseline)), affectedPaths: paths };
}

export async function consolidateTemporaryCommits(value: unknown): Promise<GitWorkflowState> {
	const request = parseRequest(value);
	if (typeof request.message !== 'string' || request.message.trim() === '') { throw new Error('workflow consolidation requires a non-empty commit message'); }
	await assertSafeMutation(request.workspace.cwd);
	const before = await stateFor(request.workspace.cwd, request.baseline);
	const dirty = await dirtyPaths(request.workspace.cwd);
	if (before.temporaryCommitCount === 0 && dirty.length === 0) { throw new Error('There is no temporary or dirty work to consolidate.'); }
	if (before.temporaryCommitCount > 0) { await git(request.workspace.cwd, ['reset', '--soft', before.lastPermanentCommit]); }
	await git(request.workspace.cwd, ['add', '-A']);
	await git(request.workspace.cwd, ['commit', '-m', request.message]);
	return { ...(await stateFor(request.workspace.cwd)), affectedPaths: dirty };
}

async function stateFor(cwd: string, selected?: string): Promise<GitWorkflowState> {
	await assertRepository(cwd);
	const head = (await git(cwd, ['rev-parse', 'HEAD'])).stdout.trim();
	const commits = (await git(cwd, ['rev-list', '--first-parent', 'HEAD'])).stdout.trim().split('\n').filter(Boolean);
	let temporaryCommitCount = 0;
	for (const commit of commits) {
		const subject = (await git(cwd, ['show', '-s', '--format=%s', commit])).stdout.trim();
		if (subject !== temporaryCommitMessage) { break; }
		temporaryCommitCount += 1;
	}
	const lastPermanentCommit = commits[temporaryCommitCount];
	if (lastPermanentCommit === undefined) { throw new Error('Sundial requires a permanent commit beneath temporary checkpoints.'); }
	const baseline = selected === undefined ? head : await resolveCommit(cwd, selected);
	await git(cwd, ['merge-base', '--is-ancestor', baseline, head]);
	return { head, baseline, lastPermanentCommit, temporaryCommitCount, affectedPaths: [] };
}

async function assertSafeMutation(cwd: string): Promise<void> {
	const state = await stateFor(cwd);
	const gitDir = (await git(cwd, ['rev-parse', '--git-dir'])).stdout.trim();
	for (const marker of ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REBASE_HEAD']) {
		try { await access(path.join(cwd, gitDir, marker)); throw new Error('Git has an in-progress operation; finish or abort it before using Sundial commits.'); } catch (error) { if (error instanceof Error && error.message.startsWith('Git has')) { throw error; } }
	}
	const unmerged = (await git(cwd, ['diff', '--name-only', '--diff-filter=U'])).stdout.trim();
	if (unmerged !== '') { throw new Error('Git has unresolved conflicts; resolve them before using Sundial commits.'); }
	if (state.temporaryCommitCount > 0) {
		const published = (await git(cwd, ['branch', '-r', '--contains', 'HEAD'])).stdout.trim();
		if (published !== '') { throw new Error('A Sundial temporary commit is reachable from origin and must be repaired manually.'); }
	}
}

async function commitPathsForFile(cwd: string, file: string): Promise<string[]> {
	const normalized = normalizePath(cwd, file);
	const companion = `.sundial/${normalized}.comments`;
	const dirty = new Set(await dirtyPaths(cwd));
	return [normalized, companion].filter(candidate => dirty.has(candidate));
}

async function dirtyPaths(cwd: string): Promise<string[]> {
	const output = (await git(cwd, ['status', '--porcelain=v1', '-z', '--untracked-files=all'])).stdout;
	const fields = output.split('\0'); const paths: string[] = [];
	for (let index = 0; index < fields.length - 1; index += 1) {
		const entry = fields[index]; if (entry.length < 4) { continue; }
		paths.push(entry.slice(3));
		if ((entry.startsWith('R') || entry.startsWith('C')) && index + 1 < fields.length - 1) { paths.push(fields[++index]); }
	}
	return [...new Set(paths)].filter(candidate => candidate !== '');
}

async function assertRepository(cwd: string): Promise<void> {
	if (!path.isAbsolute(cwd)) { throw new Error('workspace.cwd must be an absolute path'); }
	const inside = (await git(cwd, ['rev-parse', '--is-inside-work-tree'])).stdout.trim();
	if (inside !== 'true') { throw new Error('workspace.cwd must be a Git working tree'); }
}
async function resolveCommit(cwd: string, ref: string): Promise<string> { return (await git(cwd, ['rev-parse', '--verify', `${ref}^{commit}`])).stdout.trim(); }
async function git(cwd: string, args: readonly string[]): Promise<GitResult> {
	return new Promise((resolve, reject) => {
		const child = spawn('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] }); let stdout = ''; let stderr = '';
		child.stdout.on('data', chunk => { stdout += String(chunk); }); child.stderr.on('data', chunk => { stderr += String(chunk); });
		child.once('error', error => reject(new Error(`Git could not be started: ${error.message}`)));
		child.once('close', code => code === 0 ? resolve({ stdout, stderr }) : reject(new Error(stderr.trim() || `git ${args[0]} failed`)));
	});
}
function parseRequest(value: unknown): GitWorkflowRequest { const root = record(value); const workspace = record(root.workspace); if (typeof workspace.cwd !== 'string') { throw new Error('workflow request must include workspace.cwd'); } if (root.baseline !== undefined && typeof root.baseline !== 'string') { throw new Error('workflow baseline must be a commit hash'); } return value as GitWorkflowRequest; }
function record(value: unknown): Record<string, unknown> { if (typeof value !== 'object' || value === null || Array.isArray(value)) { throw new Error('workflow request must be an object'); } return value as Record<string, unknown>; }
function requiredFile(request: GitWorkflowRequest): string { if (typeof request.file !== 'string' || request.file.trim() === '') { throw new Error('workflow temporary-file commit requires file'); } return request.file; }
function normalizePath(cwd: string, file: string): string { const relative = path.relative(cwd, path.resolve(cwd, file)); if (relative === '' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) { throw new Error('workflow file must be inside workspace.cwd'); } return relative.split(path.sep).join('/'); }
