import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import * as path from 'node:path';
import { CompanionMoveTransaction, CompanionRepairConflictError } from './move.js';
import { stageAnnotationReanchor } from './reanchor.js';
import { CompanionWorkingSet, withCompanionLock } from './store.js';
import {
	isContentDigest,
	type AnnotationCompanion,
	type AnnotationReanchorRequest,
	type CompanionRepairResult,
} from './index.js';

const maximumGitOutputBytes = 8 * 1024 * 1024;

export interface GitResult {
	readonly stdout: string;
	readonly stderr: string;
}

export interface RepairFromDiffResult {
	readonly companionRepair: CompanionRepairResult;
	readonly reanchor?: AnnotationReanchorRepairResult;
	readonly affectedPaths: readonly string[];
}

export interface AnnotationReanchorRepairResult {
	readonly companion: AnnotationCompanion;
	readonly changedAnnotationIds: readonly string[];
	readonly fileScopedAnnotationIds: readonly string[];
	readonly affectedPaths: readonly string[];
	readonly alreadyApplied: boolean;
}

export interface RepairFromDiffServices {
	readonly runGitCommand: (cwd: string, args: readonly string[]) => Promise<GitResult>;
	readonly assertGitWorktreeReady: (cwd: string) => Promise<void>;
}

const defaultServices: RepairFromDiffServices = {
	runGitCommand,
	assertGitWorktreeReady,
};

export async function repairFromDiff(
	value: unknown,
	serviceOverrides: Partial<RepairFromDiffServices> = {},
): Promise<RepairFromDiffResult> {
	const request = parseRepairRequest(value);
	const services = { ...defaultServices, ...serviceOverrides };
	await services.assertGitWorktreeReady(request.cwd);
	const nameStatus = (await services.runGitCommand(request.cwd, [
		'diff', '--name-status', '-z', '--find-renames', 'HEAD', '--',
	])).stdout;

	return withCompanionLock(request.cwd, async () => {
		const moves = await CompanionMoveTransaction.prepare(request.cwd, nameStatus);
		const records = new CompanionWorkingSet();
		await moves.stageLinkRepairs(records);
		const reanchor = request.reanchor === undefined
			? undefined
			: await stageAnnotationReanchor(request.cwd, request.reanchor, records, moves);
		const changedPaths = records.changedPaths();
		const orderedChangedPaths = reanchor === undefined || reanchor.alreadyApplied
			? changedPaths
			: [...changedPaths.filter(candidate => candidate !== reanchor.primaryRecordPath), reanchor.primaryRecordPath];
		await moves.apply(records, orderedChangedPaths);
		const companionRepair = moves.result();
		const reanchorResult = reanchor === undefined ? undefined : {
			companion: reanchor.companion,
			changedAnnotationIds: reanchor.changedAnnotationIds,
			fileScopedAnnotationIds: reanchor.fileScopedAnnotationIds,
			affectedPaths: reanchor.affectedPaths,
			alreadyApplied: reanchor.alreadyApplied,
		};
		return {
			companionRepair,
			...(reanchorResult === undefined ? {} : { reanchor: reanchorResult }),
			affectedPaths: unique([
				...companionRepair.affectedPaths,
				...(reanchor?.affectedPaths ?? []),
			]),
		};
	});
}

export async function assertGitWorktreeReady(cwd: string): Promise<void> {
	for (const marker of ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REBASE_HEAD', 'rebase-merge', 'rebase-apply']) {
		if (await gitPathExists(cwd, marker)) {
			throw new CompanionRepairConflictError(
				'operation_in_progress',
				'Git has an in-progress operation; finish or abort it before repairing annotations.',
			);
		}
	}
	const unmerged = (await runGitCommand(cwd, ['diff', '--name-only', '--diff-filter=U'])).stdout.trim();
	if (unmerged !== '') {
		throw new CompanionRepairConflictError(
			'unresolved_conflicts',
			'Git has unresolved conflicts; resolve them before repairing annotations.',
		);
	}
}

export async function runGitCommand(cwd: string, args: readonly string[]): Promise<GitResult> {
	return new Promise((resolve, reject) => {
		const child = spawn('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
		let stdout = '';
		let stderr = '';
		let outputBytes = 0;
		let outputExceeded = false;
		let settled = false;
		const collect = (target: 'stdout' | 'stderr', chunk: Buffer): void => {
			if (outputExceeded) { return; }
			outputBytes += chunk.byteLength;
			if (outputBytes > maximumGitOutputBytes) {
				outputExceeded = true;
				child.kill('SIGKILL');
				return;
			}
			if (target === 'stdout') { stdout += chunk.toString(); }
			else { stderr += chunk.toString(); }
		};
		child.stdout.on('data', (chunk: Buffer) => collect('stdout', chunk));
		child.stderr.on('data', (chunk: Buffer) => collect('stderr', chunk));
		child.once('error', error => {
			if (!settled) {
				settled = true;
				reject(new Error(`Git could not be started: ${error.message}`));
			}
		});
		child.once('close', code => {
			if (settled) { return; }
			settled = true;
			if (outputExceeded) {
				reject(new CompanionRepairConflictError(
					'git_output_limit',
					`git ${args[0]} exceeded the ${maximumGitOutputBytes}-byte output limit`,
				));
			} else if (code === 0) {
				resolve({ stdout, stderr });
			} else {
				reject(new Error(stderr.trim() || `git ${args[0]} failed`));
			}
		});
	});
}

interface ParsedRepairRequest {
	readonly cwd: string;
	readonly reanchor?: AnnotationReanchorRequest;
}

function parseRepairRequest(value: unknown): ParsedRepairRequest {
	if (!isRecord(value) || !isRecord(value.workspace) || typeof value.workspace.cwd !== 'string'
		|| !path.isAbsolute(value.workspace.cwd)) {
		throw new Error('repair from diff request must include absolute workspace.cwd');
	}
	const cwd = path.resolve(value.workspace.cwd);
	const hasReanchorInput = value.document !== undefined || value.previousSource !== undefined
		|| value.expectedPreviousSourceDigest !== undefined;
	if (!hasReanchorInput) { return { cwd }; }
	if (!isRecord(value.document) || typeof value.document.uri !== 'string' || value.document.uri.trim() === ''
		|| typeof value.previousSource !== 'string' || !isContentDigest(value.expectedPreviousSourceDigest)) {
		throw new Error('repair from diff source change must include document.uri, previousSource, and expectedPreviousSourceDigest');
	}
	return {
		cwd,
		reanchor: {
			workspace: { cwd },
			document: { uri: value.document.uri },
			previousSource: value.previousSource,
			expectedPreviousSourceDigest: value.expectedPreviousSourceDigest,
		},
	};
}

async function gitPathExists(cwd: string, name: string): Promise<boolean> {
	const value = (await runGitCommand(cwd, [
		'rev-parse', '--path-format=absolute', '--git-path', name,
	])).stdout.trim();
	try {
		await access(value);
		return true;
	} catch (error) {
		if (isNodeError(error) && error.code === 'ENOENT') { return false; }
		throw error;
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNodeError(value: unknown): value is NodeJS.ErrnoException {
	return value instanceof Error;
}

function unique<T>(values: readonly T[]): T[] {
	return [...new Set(values)];
}
