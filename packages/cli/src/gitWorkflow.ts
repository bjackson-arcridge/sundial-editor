import { access } from 'node:fs/promises';
import * as path from 'node:path';
import type { CompanionRepairResult } from '@arcridge/sundial-editor-annotations';
import { companionRelativePathForSourceFile } from '@arcridge/sundial-editor-annotations/paths';
import { repairFromDiff } from '@arcridge/sundial-editor-annotations/repair';
import { assertGitWorktreeReady, GitWorkflowConflictError, runGitCommand as git } from './gitProcess.js';

export const temporaryCommitMessage = 'Sundial:temp';

export interface GitWorkflowState {
	readonly head: string;
	readonly baseline: string;
	readonly lastPermanentCommit: string;
	readonly temporaryCommitCount: number;
	readonly untrackedPaths: readonly string[];
	readonly affectedPaths: readonly string[];
}

export interface GitWorkflowRequest {
	readonly workspace: { readonly cwd: string };
	readonly baseline?: string;
	readonly file?: string;
	readonly message?: string;
}

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
	else if (action === 'previous') {
		const commits = splitLines((await git(request.workspace.cwd, ['rev-list', '--first-parent', '--max-count=2', baseline])).stdout);
		baseline = commits[1] ?? baseline;
	}
	else {
		const commits = (await git(request.workspace.cwd, ['rev-list', '--first-parent', '--reverse', `${baseline}..${state.head}`])).stdout.trim().split('\n').filter(Boolean);
		if (commits.length > 0) { baseline = commits[0]; }
	}
	return stateFor(request.workspace.cwd, baseline);
}

export async function createTemporaryCommit(value: unknown, all: boolean): Promise<GitWorkflowState> {
	const request = parseRequest(value);
	await assertSafeMutation(request.workspace.cwd);
	const repair = (await repairFromDiff(request)).companionRepair;
	const paths = all ? await dirtyPaths(request.workspace.cwd) : await commitPathsForFile(request.workspace.cwd, requiredFile(request), repair);
	if (paths.length === 0) { throw new GitWorkflowConflictError('nothing_to_checkpoint', 'There are no dirty files to checkpoint.'); }
	if (all) { await git(request.workspace.cwd, ['add', '-A']); }
	else { await stageScopedPaths(request.workspace.cwd, paths); }
	await git(request.workspace.cwd, all ? ['commit', '-m', temporaryCommitMessage] : ['commit', '--only', '-m', temporaryCommitMessage, '--', ...paths]);
	return { ...(await stateFor(request.workspace.cwd, request.baseline)), affectedPaths: uniquePaths([...repair.affectedPaths, ...paths]) };
}

export async function consolidateTemporaryCommits(value: unknown): Promise<GitWorkflowState> {
	const request = parseRequest(value);
	if (typeof request.message !== 'string' || request.message.trim() === '') { throw new Error('workflow consolidation requires a non-empty commit message'); }
	await assertSafeMutation(request.workspace.cwd);
	const repair = (await repairFromDiff(request)).companionRepair;
	const before = await stateFor(request.workspace.cwd, request.baseline);
	const dirty = await dirtyPaths(request.workspace.cwd);
	if (before.temporaryCommitCount === 0 && dirty.length === 0) {
		throw new GitWorkflowConflictError('nothing_to_consolidate', 'There is no temporary or dirty work to consolidate.');
	}
	const temporaryPaths = before.temporaryCommitCount === 0 ? [] : splitNul((await git(request.workspace.cwd, [
		'diff', '--name-only', '-z', before.lastPermanentCommit, before.head,
	])).stdout);
	if (before.temporaryCommitCount > 0) { await git(request.workspace.cwd, ['reset', '--soft', before.lastPermanentCommit]); }
	await git(request.workspace.cwd, ['add', '-A']);
	await git(request.workspace.cwd, ['commit', '-m', request.message]);
	return { ...(await stateFor(request.workspace.cwd)), affectedPaths: uniquePaths([...repair.affectedPaths, ...temporaryPaths, ...dirty]) };
}

async function stateFor(cwd: string, selected?: string): Promise<GitWorkflowState> {
	await assertRepository(cwd);
	const head = (await git(cwd, ['rev-parse', 'HEAD'])).stdout.trim();
	const commits = splitLines((await git(cwd, ['rev-list', '--first-parent', 'HEAD'])).stdout);
	let temporaryCommitCount = 0;
	for (const commit of commits) {
		if (!isTemporaryCommitMessage(await commitMessage(cwd, commit))) { break; }
		temporaryCommitCount += 1;
	}
	const lastPermanentCommit = commits[temporaryCommitCount];
	if (lastPermanentCommit === undefined) {
		throw new GitWorkflowConflictError('missing_permanent_commit', 'Sundial requires a permanent commit beneath temporary checkpoints.');
	}
	const baseline = selected === undefined ? head : await resolveCommit(cwd, selected);
	if (!commits.includes(baseline)) {
		throw new GitWorkflowConflictError('invalid_baseline', 'workflow baseline must be on the first-parent ancestry of HEAD');
	}
	return { head, baseline, lastPermanentCommit, temporaryCommitCount, untrackedPaths: await untrackedPaths(cwd), affectedPaths: [] };
}

async function assertSafeMutation(cwd: string): Promise<void> {
	const state = await stateFor(cwd);
	await assertGitWorktreeReady(cwd);
	if (state.temporaryCommitCount > 0) {
		const temporaryCommits = splitLines((await git(cwd, [
			'rev-list', '--first-parent', `--max-count=${state.temporaryCommitCount}`, state.head,
		])).stdout);
		for (const commit of temporaryCommits) {
			const published = (await git(cwd, [
				'for-each-ref', '--format=%(refname)', '--contains', commit, 'refs/remotes/origin',
			])).stdout.trim();
			if (published !== '') {
				throw new GitWorkflowConflictError(
					'published_temporary_commit',
					`Sundial temporary commit ${commit.slice(0, 12)} is reachable from origin and must be repaired manually.`,
				);
			}
		}
	}
}

async function commitPathsForFile(cwd: string, file: string, repair: CompanionRepairResult): Promise<string[]> {
	const normalized = normalizePath(cwd, file);
	const companion = companionRelativePathForSourceFile(normalized);
	const dirty = new Set(await dirtyPaths(cwd));
	const repairedCompanions = repair.actions.flatMap(action => action.kind === 'move' && action.destination === normalized
		? [action.source, action.destination, action.companion, action.destinationCompanion, ...(action.linkedCompanions ?? [])] : []);
	return uniquePaths([normalized, companion, ...repairedCompanions]).filter(candidate => dirty.has(candidate));
}

async function stageScopedPaths(cwd: string, paths: readonly string[]): Promise<void> {
	const stageable: string[] = [];
	for (const file of paths) {
		if (await fileExists(path.join(cwd, ...file.split('/'))) || await pathIsInIndex(cwd, file)) { stageable.push(file); }
	}
	if (stageable.length > 0) { await git(cwd, ['add', '--', ...stageable]); }
}

async function pathIsInIndex(cwd: string, file: string): Promise<boolean> {
	try { await git(cwd, ['ls-files', '--error-unmatch', '--', file]); return true; }
	catch { return false; }
}

async function fileExists(file: string): Promise<boolean> {
	try { await access(file); return true; }
	catch (error) { if (isNodeError(error) && error.code === 'ENOENT') { return false; } throw error; }
}

async function dirtyPaths(cwd: string): Promise<string[]> {
	const output = (await git(cwd, ['status', '--porcelain=v1', '-z', '--untracked-files=all'])).stdout;
	const fields = output.split('\0'); const paths: string[] = [];
	for (let index = 0; index < fields.length - 1; index += 1) {
		const entry = fields[index]; if (entry.length < 4) { continue; }
		paths.push(entry.slice(3));
		if ((entry[0] === 'R' || entry[0] === 'C' || entry[1] === 'R' || entry[1] === 'C')
			&& index + 1 < fields.length - 1) { paths.push(fields[++index]); }
	}
	return uniquePaths(paths);
}

async function untrackedPaths(cwd: string): Promise<string[]> {
	const output = (await git(cwd, ['status', '--porcelain=v1', '-z', '--untracked-files=all'])).stdout;
	return output.split('\0').flatMap(entry => entry.startsWith('?? ') ? [entry.slice(3)] : []);
}

async function assertRepository(cwd: string): Promise<void> {
	if (!path.isAbsolute(cwd)) { throw new Error('workspace.cwd must be an absolute path'); }
	const inside = (await git(cwd, ['rev-parse', '--is-inside-work-tree'])).stdout.trim();
	if (inside !== 'true') { throw new Error('workspace.cwd must be a Git working tree'); }
}
async function resolveCommit(cwd: string, ref: string): Promise<string> { return (await git(cwd, ['rev-parse', '--verify', `${ref}^{commit}`])).stdout.trim(); }
async function commitMessage(cwd: string, commit: string): Promise<string> {
	const object = (await git(cwd, ['cat-file', 'commit', commit])).stdout;
	const separator = object.indexOf('\n\n');
	if (separator < 0) { throw new Error(`Git returned a malformed commit object for ${commit.slice(0, 12)}.`); }
	return object.slice(separator + 2);
}
function isTemporaryCommitMessage(message: string): boolean {
	return message === temporaryCommitMessage || message === `${temporaryCommitMessage}\n`;
}
function splitLines(value: string): string[] { return value.trim().split('\n').filter(Boolean); }
function splitNul(value: string): string[] { return value.split('\0').filter(Boolean); }
function uniquePaths(paths: readonly string[]): string[] { return [...new Set(paths)].filter(candidate => candidate !== ''); }
function isNodeError(value: unknown): value is NodeJS.ErrnoException { return value instanceof Error; }
function parseRequest(value: unknown): GitWorkflowRequest { const root = record(value); const workspace = record(root.workspace); if (typeof workspace.cwd !== 'string') { throw new Error('workflow request must include workspace.cwd'); } if (root.baseline !== undefined && typeof root.baseline !== 'string') { throw new Error('workflow baseline must be a commit hash'); } return value as GitWorkflowRequest; }
function record(value: unknown): Record<string, unknown> { if (typeof value !== 'object' || value === null || Array.isArray(value)) { throw new Error('workflow request must be an object'); } return value as Record<string, unknown>; }
function requiredFile(request: GitWorkflowRequest): string { if (typeof request.file !== 'string' || request.file.trim() === '') { throw new Error('workflow temporary-file commit requires file'); } return request.file; }
function normalizePath(cwd: string, file: string): string { const relative = path.relative(cwd, path.resolve(cwd, file)); if (relative === '' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) { throw new Error('workflow file must be inside workspace.cwd'); } return relative.split(path.sep).join('/'); }
