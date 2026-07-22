import { diffArrays } from 'diff';
import { contentDigest } from './digest.js';
import {
	companionPathForFile,
	companionPathForSource,
	sourceFileForUri,
	sourcePathForCompanion,
	workspaceRelativePath,
} from './paths.js';
import { CompanionWorkingSet, readStableUtf8 } from './store.js';
import {
	currentAnnotationCompanionVersion,
	emptyAnnotationCompanion,
	type Annotation,
	type AnnotationAnchor,
	type AnnotationCompanion,
	type AnnotationReanchorRequest,
} from './index.js';

export interface LineMapping {
	readonly oldLine: number;
	readonly newLine: number;
}

export interface RepairPathResolver {
	recordPathForOutput(outputPath: string): string;
	outputPathForRecord(recordPath: string): string;
}

export interface StagedAnnotationReanchor {
	readonly companion: AnnotationCompanion;
	readonly primaryRecordPath: string;
	readonly changedAnnotationIds: readonly string[];
	readonly fileScopedAnnotationIds: readonly string[];
	readonly affectedPaths: readonly string[];
	readonly alreadyApplied: boolean;
}

export function physicalLines(source: string): string[] {
	const normalized = source.replace(/\r\n?/g, '\n');
	return normalized === '' ? [] : normalized.split('\n');
}

export function survivingLineMap(previousSource: string, currentSource: string): readonly LineMapping[] {
	const previous = physicalLines(previousSource);
	const current = physicalLines(currentSource);
	const mappings: LineMapping[] = [];
	let oldLine = 0;
	let newLine = 0;
	for (const change of diffArrays(previous, current)) {
		if (change.added) {
			newLine += change.value.length;
			continue;
		}
		if (change.removed) {
			oldLine += change.value.length;
			continue;
		}
		for (let offset = 0; offset < change.value.length; offset += 1) {
			mappings.push({ oldLine: oldLine + offset, newLine: newLine + offset });
		}
		oldLine += change.value.length;
		newLine += change.value.length;
	}
	return mappings;
}

export function translateLine(
	oldLine: number | null,
	mappings: readonly LineMapping[],
	currentLineCount: number,
): number | null {
	if (oldLine === null || currentLineCount === 0) { return null; }
	const direct = mappings.find(mapping => mapping.oldLine === oldLine);
	if (direct !== undefined) { return clamp(direct.newLine, currentLineCount); }
	let previous: LineMapping | undefined;
	let next: LineMapping | undefined;
	for (const mapping of mappings) {
		if (mapping.oldLine < oldLine) { previous = mapping; continue; }
		if (mapping.oldLine > oldLine) { next = mapping; break; }
	}
	if (previous !== undefined && next !== undefined) {
		return clamp(Math.floor((previous.newLine + next.newLine) / 2), currentLineCount);
	}
	if (previous !== undefined) { return clamp(previous.newLine + 1, currentLineCount); }
	if (next !== undefined) { return clamp(next.newLine - 1, currentLineCount); }
	return null;
}

export function createAnnotationAnchor(source: string, line: number): AnnotationAnchor {
	const lines = physicalLines(source);
	if (!Number.isSafeInteger(line) || line < 0 || line >= lines.length) {
		throw new Error('Annotation line must identify an existing source line.');
	}
	const before: string[] = [];
	for (let index = line - 1; index >= 0 && before.length < 3; index -= 1) {
		if (lines[index].trim() !== '') { before.unshift(lines[index]); }
	}
	const after: string[] = [];
	for (let index = line + 1; index < lines.length && after.length < 3; index += 1) {
		if (lines[index].trim() !== '') { after.push(lines[index]); }
	}
	return { line, text: lines[line], before, after };
}

export async function stageAnnotationReanchor(
	cwd: string,
	request: AnnotationReanchorRequest,
	records: CompanionWorkingSet,
	paths: RepairPathResolver,
): Promise<StagedAnnotationReanchor> {
	if (contentDigest(request.previousSource) !== request.expectedPreviousSourceDigest) {
		throw new Error('annotation reanchor previous source does not match its expected digest');
	}
	const primaryOutputPath = companionPathForSource(cwd, request.document.uri);
	const primaryRecordPath = paths.recordPathForOutput(primaryOutputPath);
	const currentSource = await readStableUtf8(sourcePathForCompanion(cwd, primaryOutputPath), 'source');
	const currentDigest = contentDigest(currentSource);
	const loaded = await records.load(primaryRecordPath);
	const primary = loaded.kind === 'found' ? loaded.companion : emptyAnnotationCompanion(currentDigest);
	if (primary.sourceDigest === currentDigest) {
		return {
			companion: primary,
			primaryRecordPath,
			changedAnnotationIds: [],
			fileScopedAnnotationIds: primary.annotations
				.filter(annotation => annotation.anchor.line === null)
				.map(annotation => annotation.id),
			affectedPaths: [],
			alreadyApplied: true,
		};
	}

	const adoptingCurrentBaseline = request.expectedPreviousSourceDigest === currentDigest;
	if (!adoptingCurrentBaseline && primary.sourceDigest !== request.expectedPreviousSourceDigest) {
		throw new Error('Annotation companion source baseline does not match the expected previous source.');
	}
	const currentLines = physicalLines(currentSource);
	const mappings = survivingLineMap(adoptingCurrentBaseline ? currentSource : request.previousSource, currentSource);
	const changedAnnotationIds: string[] = [];
	const fileScopedAnnotationIds: string[] = [];
	const originalAnnotations = primary.annotations;
	const originalById = new Map(originalAnnotations.map(annotation => [annotation.id, annotation]));
	const relocated = originalAnnotations.map(annotation => {
		const oldLine = annotation.anchor.line;
		const line = adoptingCurrentBaseline && oldLine !== null && oldLine >= currentLines.length
			? null
			: translateLine(oldLine, mappings, currentLines.length);
		const anchor = line === null ? annotation.anchor : createAnnotationAnchor(currentSource, line);
		const next = { ...annotation, anchor: line === null ? { ...anchor, line: null } : anchor } as Annotation;
		if (JSON.stringify(next.anchor) !== JSON.stringify(annotation.anchor)) { changedAnnotationIds.push(annotation.id); }
		if (next.anchor.line === null) { fileScopedAnnotationIds.push(annotation.id); }
		return next;
	});
	const touched = new Set<string>();
	const stage = (file: string, companion: AnnotationCompanion): void => {
		records.stage(file, companion);
		touched.add(file);
	};
	const nextPrimary: AnnotationCompanion = {
		...primary,
		version: currentAnnotationCompanionVersion,
		sourceDigest: currentDigest,
		annotations: relocated,
	};
	stage(primaryRecordPath, nextPrimary);

	const primaryFile = sourceFileForUri(cwd, request.document.uri);
	for (let index = 0; index < originalAnnotations.length; index += 1) {
		const before = originalAnnotations[index];
		const after = relocated[index];
		if (before.anchor.line === after.anchor.line) { continue; }
		await updateReciprocalLine(
			cwd, primaryFile, primaryRecordPath, before, after.anchor.line, originalById, records, paths, stage,
		);
	}
	return {
		companion: nextPrimary,
		primaryRecordPath,
		changedAnnotationIds,
		fileScopedAnnotationIds,
		affectedPaths: [...touched].map(file => workspaceRelativePath(cwd, paths.outputPathForRecord(file))),
		alreadyApplied: false,
	};
}

async function updateReciprocalLine(
	cwd: string,
	primaryFile: string,
	primaryRecordPath: string,
	annotation: Annotation,
	line: number | null,
	originalPrimary: ReadonlyMap<string, Annotation>,
	records: CompanionWorkingSet,
	paths: RepairPathResolver,
	stage: (file: string, companion: AnnotationCompanion) => void,
): Promise<void> {
	if (annotation.kind === 'user') {
		for (const link of annotation.agentAnnotations) {
			const counterpartPath = paths.recordPathForOutput(companionPathForFile(cwd, link.file));
			const counterpart = await records.require(counterpartPath, `Linked annotation companion is missing: ${counterpartPath}`);
			const index = counterpart.annotations.findIndex(candidate => candidate.kind === 'agent' && candidate.id === link.annotationId);
			const child = counterpart.annotations[index];
			const originalChildLine = counterpartPath === primaryRecordPath
				? originalPrimary.get(link.annotationId)?.anchor.line
				: undefined;
			if (index < 0 || child.kind !== 'agent' || child.userAnnotation.annotationId !== annotation.id
				|| child.userAnnotation.file !== primaryFile
				|| (child.userAnnotation.line !== annotation.anchor.line && child.userAnnotation.line !== line)
				|| (link.line !== child.anchor.line && link.line !== originalChildLine)) {
				throw new Error(`Annotation link does not resolve symmetrically: ${annotation.id} -> ${link.annotationId}`);
			}
			if (child.userAnnotation.line !== line) {
				const annotations = [...counterpart.annotations];
				annotations[index] = { ...child, userAnnotation: { ...child.userAnnotation, line } };
				stage(counterpartPath, { ...counterpart, annotations });
			}
		}
		return;
	}
	const counterpartPath = paths.recordPathForOutput(companionPathForFile(cwd, annotation.userAnnotation.file));
	const counterpart = await records.require(counterpartPath, `Linked annotation companion is missing: ${counterpartPath}`);
	const userIndex = counterpart.annotations.findIndex(candidate => candidate.kind === 'user'
		&& candidate.id === annotation.userAnnotation.annotationId);
	const user = counterpart.annotations[userIndex];
	const originalUserLine = counterpartPath === primaryRecordPath
		? originalPrimary.get(annotation.userAnnotation.annotationId)?.anchor.line
		: undefined;
	if (userIndex < 0 || user.kind !== 'user'
		|| (annotation.userAnnotation.line !== user.anchor.line && annotation.userAnnotation.line !== originalUserLine)) {
		throw new Error(`Annotation link does not resolve symmetrically: ${annotation.id}`);
	}
	const linkIndex = user.agentAnnotations.findIndex(link => link.annotationId === annotation.id && link.file === primaryFile);
	const link = user.agentAnnotations[linkIndex];
	if (linkIndex < 0 || (link.line !== annotation.anchor.line && link.line !== line)) {
		throw new Error(`Annotation link does not resolve symmetrically: ${annotation.id}`);
	}
	if (link.line !== line) {
		const links = [...user.agentAnnotations];
		links[linkIndex] = { ...link, line };
		const annotations = [...counterpart.annotations];
		annotations[userIndex] = { ...user, agentAnnotations: links };
		stage(counterpartPath, { ...counterpart, annotations });
	}
}

function clamp(line: number, lineCount: number): number {
	return Math.min(Math.max(line, 0), lineCount - 1);
}
