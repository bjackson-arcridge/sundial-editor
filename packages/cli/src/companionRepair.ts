import { randomUUID } from 'node:crypto';
import { lstat, mkdir, rename, rm } from 'node:fs/promises';
import * as path from 'node:path';
import { assertGitWorktreeReady, GitWorkflowConflictError, runGitCommand } from './gitProcess.js';

export interface CompanionMoveRepair {
	readonly kind: 'move';
	readonly source: string;
	readonly destination: string;
	readonly companion: string;
	readonly destinationCompanion: string;
}

export interface CompanionDeleteRepair {
	readonly kind: 'delete';
	readonly source: string;
	readonly companion: string;
}

export type CompanionRepairAction = CompanionMoveRepair | CompanionDeleteRepair;

export interface CompanionRepairResult {
	readonly actions: readonly CompanionRepairAction[];
	readonly affectedPaths: readonly string[];
}

interface PlannedRepair {
	readonly action: CompanionRepairAction;
	readonly sourcePath: string;
	readonly destinationPath?: string;
	readonly temporaryPath: string;
	finalized: boolean;
}

export async function repairCompanions(value: unknown): Promise<CompanionRepairResult> {
	const cwd = workspaceCwd(value);
	await assertGitWorktreeReady(cwd);
	const changes = parseGitNameStatus((await runGitCommand(cwd, [
		'diff', '--name-status', '-z', '--find-renames', 'HEAD', '--',
	])).stdout);
	const candidateActions = changes.flatMap(change => repairAction(change));
	const repairRoot = path.join(cwd, '.sundial', '.repair', randomUUID());
	const planned: PlannedRepair[] = [];
	for (const action of candidateActions) {
		const sourcePath = workspacePath(cwd, action.companion);
		const source = await regularFileState(sourcePath, action.companion);
		if (source === 'missing') { continue; }
		planned.push({
			action,
			sourcePath,
			...(action.kind === 'move' ? { destinationPath: workspacePath(cwd, action.destinationCompanion) } : {}),
			temporaryPath: path.join(repairRoot, randomUUID()),
			finalized: false,
		});
	}
	if (planned.length === 0) { return { actions: [], affectedPaths: [] }; }

	const stagedSources = new Set(planned.map(item => item.sourcePath));
	for (const item of planned) {
		if (item.destinationPath === undefined || stagedSources.has(item.destinationPath)) { continue; }
		if (await regularFileState(item.destinationPath, item.action.kind === 'move' ? item.action.destinationCompanion : '') !== 'missing') {
			throw new GitWorkflowConflictError(
				'companion_repair_conflict',
				`Companion repair would overwrite an existing file: ${item.action.kind === 'move' ? item.action.destinationCompanion : item.action.companion}`,
			);
		}
	}

	await mkdir(repairRoot, { recursive: true });
	try {
		for (const item of planned) { await rename(item.sourcePath, item.temporaryPath); }
		for (const item of planned) {
			if (item.destinationPath === undefined) { continue; }
			await mkdir(path.dirname(item.destinationPath), { recursive: true });
			await rename(item.temporaryPath, item.destinationPath);
			item.finalized = true;
		}
		await verifyRepairs(planned);
	} catch (error) {
		if (await rollbackRepairs(planned)) {
			await rm(repairRoot, { recursive: true, force: true }).catch(() => undefined);
		}
		throw error;
	}
	// Deletion backups stay recoverable until every move/delete has verified. Cleanup failure
	// intentionally leaves this operation's unique repair directory for manual recovery.
	await rm(repairRoot, { recursive: true, force: true }).catch(() => undefined);

	const actions = planned.map(item => item.action);
	return {
		actions,
		affectedPaths: unique(actions.flatMap(action => action.kind === 'move'
			? [action.companion, action.destinationCompanion] : [action.companion])),
	};
}

export type GitNameStatusChange =
	| { readonly kind: 'move'; readonly source: string; readonly destination: string }
	| { readonly kind: 'delete'; readonly source: string };

export function parseGitNameStatus(value: string): GitNameStatusChange[] {
	const fields = value.split('\0');
	const changes: GitNameStatusChange[] = [];
	for (let index = 0; index < fields.length - 1;) {
		const status = fields[index++];
		if (status === '') { continue; }
		if (status[0] === 'R' || status[0] === 'C') {
			const source = fields[index++]; const destination = fields[index++];
			if (source === undefined || source === '' || destination === undefined || destination === '') { throw new Error('Git returned malformed rename status.'); }
			if (status[0] === 'R') { changes.push({ kind: 'move', source, destination }); }
		} else {
			const source = fields[index++];
			if (source === undefined || source === '') { throw new Error('Git returned malformed path status.'); }
			if (status === 'D') { changes.push({ kind: 'delete', source }); }
		}
	}
	return changes;
}

function repairAction(change: GitNameStatusChange): CompanionRepairAction[] {
	if (isCompanionStorePath(change.source) || (change.kind === 'move' && isCompanionStorePath(change.destination))) { return []; }
	const companion = companionPath(change.source);
	return change.kind === 'move'
		? [{ kind: 'move', source: change.source, destination: change.destination, companion, destinationCompanion: companionPath(change.destination) }]
		: [{ kind: 'delete', source: change.source, companion }];
}

async function verifyRepairs(planned: readonly PlannedRepair[]): Promise<void> {
	for (const item of planned) {
		if (await regularFileState(item.sourcePath, item.action.companion) !== 'missing') {
			throw new Error(`Companion repair did not remove the old path: ${item.action.companion}`);
		}
		if (item.destinationPath !== undefined && await regularFileState(
			item.destinationPath,
			item.action.kind === 'move' ? item.action.destinationCompanion : item.action.companion,
		) !== 'regular') {
			throw new Error(`Companion repair did not create the new path for ${item.action.companion}`);
		}
	}
}

async function rollbackRepairs(planned: readonly PlannedRepair[]): Promise<boolean> {
	let recovered = true;
	for (const item of [...planned].reverse()) {
		try {
			await mkdir(path.dirname(item.sourcePath), { recursive: true });
			if (item.finalized && item.destinationPath !== undefined) { await rename(item.destinationPath, item.sourcePath); }
			else if (await regularFileState(item.temporaryPath, item.action.companion) === 'regular') { await rename(item.temporaryPath, item.sourcePath); }
		} catch {
			// The staged repair directory remains in place so the companion is recoverable manually.
			recovered = false;
		}
	}
	return recovered;
}

async function regularFileState(file: string, displayPath: string): Promise<'missing' | 'regular'> {
	try {
		const value = await lstat(file);
		if (!value.isFile()) {
			throw new GitWorkflowConflictError('companion_repair_conflict', `Companion path is not a regular file: ${displayPath}`);
		}
		return 'regular';
	} catch (error) {
		if (isNodeError(error) && error.code === 'ENOENT') { return 'missing'; }
		throw error;
	}
}

function workspaceCwd(value: unknown): string {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) { throw new Error('companion repair request must be an object'); }
	const workspace = (value as Record<string, unknown>).workspace;
	if (typeof workspace !== 'object' || workspace === null || Array.isArray(workspace)
		|| typeof (workspace as Record<string, unknown>).cwd !== 'string' || !path.isAbsolute((workspace as Record<string, unknown>).cwd as string)) {
		throw new Error('companion repair request must include absolute workspace.cwd');
	}
	return path.resolve((workspace as Record<string, unknown>).cwd as string);
}

function workspacePath(cwd: string, relative: string): string {
	const normalized = normalizeRelativePath(relative);
	const result = path.resolve(cwd, ...normalized.split('/'));
	const fromWorkspace = path.relative(cwd, result);
	if (fromWorkspace === '' || fromWorkspace.startsWith(`..${path.sep}`) || path.isAbsolute(fromWorkspace)) {
		throw new Error(`Companion repair path escapes the workspace: ${relative}`);
	}
	return result;
}

function normalizeRelativePath(value: string): string {
	const normalized = value.replaceAll('\\', '/');
	if (normalized.trim() === '' || normalized.startsWith('/')
		|| normalized.split('/').some(segment => segment === '' || segment === '.' || segment === '..')) {
		throw new Error(`Git returned an unsafe workspace path: ${value}`);
	}
	return normalized;
}

function companionPath(source: string): string { return `.sundial/${normalizeRelativePath(source)}.comments`; }
function isCompanionStorePath(source: string): boolean { return normalizeRelativePath(source).startsWith('.sundial/'); }
function unique(values: readonly string[]): string[] { return [...new Set(values)]; }
function isNodeError(value: unknown): value is NodeJS.ErrnoException { return value instanceof Error; }
