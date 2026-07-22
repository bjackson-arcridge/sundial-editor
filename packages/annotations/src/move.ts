import { randomUUID } from 'node:crypto';
import { lstat, mkdir, rename, rm } from 'node:fs/promises';
import * as path from 'node:path';
import {
	companionRelativePathForSourceFile,
	isCompanionStorePath,
	workspacePath,
	workspaceRelativePath,
} from './paths.js';
import { CompanionWorkingSet, type CompanionWriteTarget } from './store.js';
import {
	type AgentFileAnnotation,
	type AnnotationCompanion,
	type CompanionRepairAction,
	type CompanionRepairResult,
	type UserAnnotation,
} from './index.js';
import type { RepairPathResolver } from './reanchor.js';

export type CompanionRepairConflictCode =
	| 'companion_repair_conflict'
	| 'operation_in_progress'
	| 'unresolved_conflicts'
	| 'git_output_limit';

export class CompanionRepairConflictError extends Error {
	constructor(readonly code: CompanionRepairConflictCode, message: string) {
		super(message);
		this.name = 'CompanionRepairConflictError';
	}
}

export type GitNameStatusChange =
	| { readonly kind: 'move'; readonly source: string; readonly destination: string }
	| { readonly kind: 'delete'; readonly source: string };

interface PlannedRepair {
	readonly action: CompanionRepairAction;
	readonly sourcePath: string;
	readonly destinationPath?: string;
	readonly temporaryPath: string;
	readonly needsMove: boolean;
	readonly linkedCompanions: Set<string>;
	finalized: boolean;
}

export class CompanionMoveTransaction implements RepairPathResolver {
	private readonly loadedRecordPaths = new Set<string>();
	private readonly moveChangedPaths = new Set<string>();
	private readonly moveBySource: ReadonlyMap<string, PlannedRepair>;

	private constructor(
		private readonly cwd: string,
		private readonly repairRoot: string,
		private readonly planned: readonly PlannedRepair[],
	) {
		this.moveBySource = new Map(planned.flatMap(item => item.action.kind === 'move'
			? [[item.action.source, item] as const]
			: []));
	}

	static async prepare(cwd: string, nameStatus: string): Promise<CompanionMoveTransaction> {
		const repairRoot = path.join(cwd, '.sundial', '.repair', randomUUID());
		const planned: PlannedRepair[] = [];
		const actions = parseGitNameStatus(nameStatus).flatMap(change => repairAction(change));
		for (const action of actions) {
			const sourcePath = workspacePath(cwd, action.companion);
			const source = await regularFileState(sourcePath, action.companion);
			const destinationPath = action.kind === 'move' ? workspacePath(cwd, action.destinationCompanion) : undefined;
			const destination = action.kind === 'move' ? await regularFileState(destinationPath!, action.destinationCompanion) : 'missing';
			if (source === 'missing' && (action.kind === 'delete' || destination === 'missing')) { continue; }
			planned.push({
				action,
				sourcePath,
				...(destinationPath === undefined ? {} : { destinationPath }),
				temporaryPath: path.join(repairRoot, randomUUID()),
				needsMove: source === 'regular',
				linkedCompanions: new Set(),
				finalized: false,
			});
		}
		const transaction = new CompanionMoveTransaction(cwd, repairRoot, planned);
		await transaction.assertDestinationsAvailable();
		return transaction;
	}

	recordPathForOutput(outputPath: string): string {
		const output = path.resolve(outputPath);
		const moving = this.planned.find(item => item.action.kind === 'move' && item.destinationPath === output);
		return moving === undefined ? output : moving.needsMove ? moving.sourcePath : moving.destinationPath!;
	}

	outputPathForRecord(recordPath: string): string {
		const record = path.resolve(recordPath);
		const moving = this.planned.find(item => item.action.kind === 'move'
			&& (item.needsMove ? item.sourcePath : item.destinationPath) === record);
		return moving?.destinationPath ?? record;
	}

	async stageLinkRepairs(records: CompanionWorkingSet): Promise<void> {
		const before = new Set(records.changedPaths());
		for (const item of this.planned) {
			const actualPath = item.needsMove ? item.sourcePath : item.destinationPath!;
			await loadCompanion(actualPath, records);
			this.loadedRecordPaths.add(actualPath);
			if (item.action.kind === 'move') {
				await this.repairMovedLinks(item, actualPath, records);
			}
		}
		for (const file of records.changedPaths()) {
			if (!before.has(file)) { this.moveChangedPaths.add(file); }
		}
	}

	async apply(records: CompanionWorkingSet, orderedChangedPaths: readonly string[]): Promise<void> {
		const validationPaths = unique([...this.loadedRecordPaths, ...orderedChangedPaths]);
		records.validate(validationPaths);
		const writes: CompanionWriteTarget[] = orderedChangedPaths.map(recordPath => ({
			recordPath,
			outputPath: this.outputPathForRecord(recordPath),
		}));
		if (this.planned.length === 0) {
			await records.write(writes);
			return;
		}

		await mkdir(this.repairRoot, { recursive: true });
		try {
			for (const item of this.planned.filter(candidate => candidate.needsMove)) {
				await rename(item.sourcePath, item.temporaryPath);
			}
			for (const item of this.planned.filter(candidate => candidate.needsMove)) {
				if (item.destinationPath === undefined) { continue; }
				await mkdir(path.dirname(item.destinationPath), { recursive: true });
				await rename(item.temporaryPath, item.destinationPath);
				item.finalized = true;
			}
			await verifyRepairs(this.planned);
			await records.write(writes);
		} catch (error) {
			if (await rollbackRepairs(this.planned.filter(item => item.needsMove))) {
				await rm(this.repairRoot, { recursive: true, force: true }).catch(() => undefined);
			}
			throw error;
		}
		await rm(this.repairRoot, { recursive: true, force: true }).catch(() => undefined);
	}

	result(): CompanionRepairResult {
		const effective = this.planned.filter(item => item.needsMove || item.linkedCompanions.size > 0
			|| this.moveChangedPaths.has(item.needsMove ? item.sourcePath : item.destinationPath ?? item.sourcePath));
		const actions = effective.map(item => item.action.kind === 'move' && item.linkedCompanions.size > 0
			? { ...item.action, linkedCompanions: [...item.linkedCompanions] }
			: item.action);
		const writtenPaths = [...this.moveChangedPaths].map(inputPath =>
			workspaceRelativePath(this.cwd, this.outputPathForRecord(inputPath)));
		return {
			actions,
			affectedPaths: unique([
				...this.planned.flatMap(item => item.needsMove
					? item.action.kind === 'move'
						? [item.action.companion, item.action.destinationCompanion]
						: [item.action.companion]
					: []),
				...writtenPaths,
			]),
		};
	}

	private async assertDestinationsAvailable(): Promise<void> {
		const stagedSources = new Set(this.planned.filter(item => item.needsMove).map(item => item.sourcePath));
		for (const item of this.planned) {
			if (!item.needsMove || item.destinationPath === undefined || stagedSources.has(item.destinationPath)) { continue; }
			if (await regularFileState(item.destinationPath, item.action.kind === 'move'
				? item.action.destinationCompanion
				: '') !== 'missing') {
				throw new CompanionRepairConflictError(
					'companion_repair_conflict',
					`Companion repair would overwrite an existing file: ${item.action.kind === 'move'
						? item.action.destinationCompanion
						: item.action.companion}`,
				);
			}
		}
	}

	private async repairMovedLinks(
		item: PlannedRepair,
		primaryPath: string,
		records: CompanionWorkingSet,
	): Promise<void> {
		const action = item.action;
		if (action.kind !== 'move') { return; }
		const annotationIds = records.get(primaryPath).annotations.map(annotation => annotation.id);
		for (const annotationId of annotationIds) {
			const annotation = records.get(primaryPath).annotations.find(candidate => candidate.id === annotationId)!;
			if (annotation.kind === 'user') {
				for (const originalLink of annotation.agentAnnotations) {
					const targetFile = translatedFile(originalLink.file, this.moveBySource);
					const targetPath = companionLocation(this.cwd, targetFile, this.moveBySource);
					const target = await loadCompanion(targetPath, records);
					this.loadedRecordPaths.add(targetPath);
					const childIndex = target.annotations.findIndex(candidate => candidate.kind === 'agent'
						&& candidate.id === originalLink.annotationId);
					const child = target.annotations[childIndex];
					if (child === undefined || child.kind !== 'agent' || child.userAnnotation.annotationId !== annotation.id
						|| (child.userAnnotation.file !== action.source && child.userAnnotation.file !== action.destination)
						|| child.userAnnotation.line !== annotation.anchor.line || originalLink.line !== child.anchor.line) {
						throw repairLinkError(annotation.id, originalLink.annotationId);
					}
					if (originalLink.file !== targetFile) {
						updateUserLink(records, primaryPath, annotation.id, originalLink.annotationId, link => ({ ...link, file: targetFile }));
					}
					if (child.userAnnotation.file !== action.destination) {
						updateAgentParent(records, targetPath, child.id, link => ({ ...link, file: action.destination }));
						item.linkedCompanions.add(outputCompanionPath(this.cwd, targetPath, this.moveBySource));
					}
				}
				continue;
			}

			const parentFile = translatedFile(annotation.userAnnotation.file, this.moveBySource);
			const parentPath = companionLocation(this.cwd, parentFile, this.moveBySource);
			const parent = await loadCompanion(parentPath, records);
			this.loadedRecordPaths.add(parentPath);
			const userIndex = parent.annotations.findIndex(candidate => candidate.kind === 'user'
				&& candidate.id === annotation.userAnnotation.annotationId);
			const user = parent.annotations[userIndex];
			if (user === undefined || user.kind !== 'user' || annotation.userAnnotation.line !== user.anchor.line) {
				throw repairLinkError(annotation.id, annotation.userAnnotation.annotationId);
			}
			const reverse = user.agentAnnotations.find(link => link.annotationId === annotation.id
				&& (link.file === action.source || link.file === action.destination));
			if (reverse === undefined || reverse.line !== annotation.anchor.line) {
				throw repairLinkError(annotation.id, annotation.userAnnotation.annotationId);
			}
			if (annotation.userAnnotation.file !== parentFile) {
				updateAgentParent(records, primaryPath, annotation.id, link => ({ ...link, file: parentFile }));
			}
			if (reverse.file !== action.destination) {
				updateUserLink(records, parentPath, user.id, annotation.id, link => ({ ...link, file: action.destination }));
				item.linkedCompanions.add(outputCompanionPath(this.cwd, parentPath, this.moveBySource));
			}
		}
	}
}

export function parseGitNameStatus(value: string): GitNameStatusChange[] {
	const fields = value.split('\0');
	const changes: GitNameStatusChange[] = [];
	for (let index = 0; index < fields.length - 1;) {
		const status = fields[index++];
		if (status === '') { continue; }
		if (status[0] === 'R' || status[0] === 'C') {
			const source = fields[index++];
			const destination = fields[index++];
			if (source === undefined || source === '' || destination === undefined || destination === '') {
				throw new Error('Git returned malformed rename status.');
			}
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
	if (isCompanionStorePath(change.source) || (change.kind === 'move' && isCompanionStorePath(change.destination))) {
		return [];
	}
	const companion = companionRelativePathForSourceFile(change.source);
	return change.kind === 'move'
		? [{
			kind: 'move',
			source: change.source,
			destination: change.destination,
			companion,
			destinationCompanion: companionRelativePathForSourceFile(change.destination),
		}]
		: [{ kind: 'delete', source: change.source, companion }];
}

async function loadCompanion(file: string, records: CompanionWorkingSet): Promise<AnnotationCompanion> {
	const loaded = await records.load(file);
	if (loaded.kind === 'missing') {
		throw new CompanionRepairConflictError(
			'companion_repair_conflict',
			`Linked annotation companion is missing: ${file}`,
		);
	}
	return loaded.companion;
}

function updateUserLink(
	records: CompanionWorkingSet,
	file: string,
	userId: string,
	childId: string,
	update: (link: UserAnnotation['agentAnnotations'][number]) => UserAnnotation['agentAnnotations'][number],
): void {
	const companion = records.get(file);
	const annotationIndex = companion.annotations.findIndex(candidate => candidate.kind === 'user' && candidate.id === userId);
	const user = companion.annotations[annotationIndex] as UserAnnotation;
	const linkIndex = user.agentAnnotations.findIndex(link => link.annotationId === childId);
	const links = [...user.agentAnnotations];
	links[linkIndex] = update(links[linkIndex]);
	const annotations = [...companion.annotations];
	annotations[annotationIndex] = { ...user, agentAnnotations: links };
	records.stage(file, { ...companion, annotations });
}

function updateAgentParent(
	records: CompanionWorkingSet,
	file: string,
	agentId: string,
	update: (link: AgentFileAnnotation['userAnnotation']) => AgentFileAnnotation['userAnnotation'],
): void {
	const companion = records.get(file);
	const annotationIndex = companion.annotations.findIndex(candidate => candidate.kind === 'agent' && candidate.id === agentId);
	const agent = companion.annotations[annotationIndex] as AgentFileAnnotation;
	const annotations = [...companion.annotations];
	annotations[annotationIndex] = { ...agent, userAnnotation: update(agent.userAnnotation) };
	records.stage(file, { ...companion, annotations });
}

function translatedFile(file: string, moveBySource: ReadonlyMap<string, PlannedRepair>): string {
	const move = moveBySource.get(file);
	return move?.action.kind === 'move' ? move.action.destination : file;
}

function companionLocation(cwd: string, file: string, moveBySource: ReadonlyMap<string, PlannedRepair>): string {
	const move = moveBySource.get(file) ?? [...moveBySource.values()].find(candidate =>
		candidate.action.kind === 'move' && candidate.action.destination === file);
	if (move?.action.kind === 'move') { return move.needsMove ? move.sourcePath : move.destinationPath!; }
	return workspacePath(cwd, companionRelativePathForSourceFile(file), 'annotation companion');
}

function outputCompanionPath(cwd: string, inputPath: string, moveBySource: ReadonlyMap<string, PlannedRepair>): string {
	const moving = [...moveBySource.values()].find(item =>
		(item.needsMove ? item.sourcePath : item.destinationPath) === inputPath);
	return workspaceRelativePath(cwd, moving?.destinationPath ?? inputPath);
}

function repairLinkError(left: string, right: string): CompanionRepairConflictError {
	return new CompanionRepairConflictError(
		'companion_repair_conflict',
		`Annotation links are missing or mismatched: ${left} <-> ${right}`,
	);
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
			if (item.finalized && item.destinationPath !== undefined) {
				await rename(item.destinationPath, item.sourcePath);
			} else if (await regularFileState(item.temporaryPath, item.action.companion) === 'regular') {
				await rename(item.temporaryPath, item.sourcePath);
			}
		} catch {
			// Preserve the repair directory so the companion remains manually recoverable.
			recovered = false;
		}
	}
	return recovered;
}

async function regularFileState(file: string, displayPath: string): Promise<'missing' | 'regular'> {
	try {
		const value = await lstat(file);
		if (!value.isFile()) {
			throw new CompanionRepairConflictError(
				'companion_repair_conflict',
				`Companion path is not a regular file: ${displayPath}`,
			);
		}
		return 'regular';
	} catch (error) {
		if (isNodeError(error) && error.code === 'ENOENT') { return 'missing'; }
		throw error;
	}
}

function unique<T>(values: readonly T[]): T[] {
	return [...new Set(values)];
}

function isNodeError(value: unknown): value is NodeJS.ErrnoException {
	return value instanceof Error;
}
