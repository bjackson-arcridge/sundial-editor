import { randomUUID } from 'node:crypto';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	assertAnnotation,
	currentAnnotationCompanionVersion,
	isAnnotationPromptPreset,
	isOpaqueId,
	type AgentFileAnnotation,
	type Annotation,
	type AnnotationAppendRequest,
	type AnnotationCompanion,
	type AnnotationDeleteRequest,
	type AnnotationLink,
	type AnnotationReadRequest,
	type AnnotationReadResult,
	type AnnotationReanchorResult,
	type OfficialResponse,
	type UserAnnotation,
} from '@arcridge/sundial-editor-annotations';
import {
	contentDigest,
} from '@arcridge/sundial-editor-annotations/digest';
import {
	companionPathForSource,
	normalizeRelativeSourceFile,
	sourceFileForCompanion,
	sourceUriForFile,
} from '@arcridge/sundial-editor-annotations/paths';
import { createAnnotationAnchor } from '@arcridge/sundial-editor-annotations/reanchor';
import { repairFromDiff } from '@arcridge/sundial-editor-annotations/repair';
import {
	CompanionWorkingSet,
	readStableUtf8,
	withCompanionLock,
	type CompanionLockServices,
} from '@arcridge/sundial-editor-annotations/store';
import { deleteWork } from './agentStore.js';
import { readGitWorkflowState } from './gitWorkflow.js';

export interface AnnotationStoreServices extends CompanionLockServices {
	readonly createId: () => string;
	readonly resolvePermanentCommit: (cwd: string) => Promise<string>;
}

const defaultServices: AnnotationStoreServices = {
	createId: randomUUID,
	sleep: milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)),
	lockTimeoutMs: 5_000,
	staleLockMs: 30_000,
	resolvePermanentCommit: async cwd => (await readGitWorkflowState({ workspace: { cwd } })).lastPermanentCommit,
};

export async function appendUserAnnotation(
	value: unknown,
	serviceOverrides: Partial<AnnotationStoreServices> = {},
): Promise<UserAnnotation> {
	const services = { ...defaultServices, ...serviceOverrides };
	const request = parseAnnotationAppendRequest(value);
	return withCompanionLock(request.workspace.cwd, async () => {
		const companions = new CompanionWorkingSet();
		const permanentBaseCommit = await services.resolvePermanentCommit(request.workspace.cwd);
		const companionPath = companionPathForSource(request.workspace.cwd, request.document.uri);
		const source = await readStableUtf8(fileURLToPath(new URL(request.document.uri)), 'source');
		const sourceDigest = contentDigest(source);
		const existing = await companions.readOrEmpty(companionPath, sourceDigest);
		if (existing.annotations.length > 0 && existing.sourceDigest !== sourceDigest) {
			throw new Error('Annotation companion source baseline is stale; re-anchor it before appending.');
		}
		const annotation: UserAnnotation = {
			kind: 'user',
			id: request.annotation.id ?? services.createId(),
			permanentBaseCommit,
			message: request.annotation.message,
			preset: request.annotation.preset,
			scope: request.annotation.scope,
			anchor: createAnnotationAnchor(source, request.document.line),
			officialResponses: [],
			agentAnnotations: [],
		};
		assertAnnotation(annotation);
		const alreadyPersisted = existing.annotations.find(candidate => candidate.id === annotation.id);
		if (alreadyPersisted !== undefined) {
			if (alreadyPersisted.kind !== 'user' || !sameUserAnnotationContent(alreadyPersisted, annotation)) {
				throw new Error(`Annotation ID is already reserved with different content: ${annotation.id}`);
			}
			return alreadyPersisted;
		}
		companions.stage(companionPath, { version: currentAnnotationCompanionVersion, sourceDigest, annotations: [...existing.annotations, annotation] });
		await companions.write();
		return annotation;
	}, services);
}

export async function readUserAnnotations(value: unknown): Promise<AnnotationReadResult> {
	const request = parseAnnotationReadRequest(value);
	const currentPermanentCommit = await defaultServices.resolvePermanentCommit(request.workspace.cwd);
	const source = await readStableUtf8(fileURLToPath(new URL(request.document.uri)), 'source');
	const companion = await new CompanionWorkingSet().readOrEmpty(
		companionPathForSource(request.workspace.cwd, request.document.uri),
		contentDigest(source),
	);
	return {
		...companion,
		currentPermanentCommit,
		currentPermanentAnnotationIds: companion.annotations
			.filter(annotation => annotation.permanentBaseCommit === currentPermanentCommit)
			.map(annotation => annotation.id),
	};
}

export async function deleteUserAnnotation(value: unknown): Promise<Annotation> {
	const request = parseAnnotationDeleteRequest(value);
	return withCompanionLock(request.workspace.cwd, async () => {
		const companions = new CompanionWorkingSet();
		const companionPath = companionPathForSource(request.workspace.cwd, request.document.uri);
		const loaded = await companions.load(companionPath);
		const companion = loaded.kind === 'found' ? loaded.companion : undefined;
		const annotation = companion?.annotations.find(candidate => candidate.id === request.annotation.id);
		if (annotation === undefined) {
			throw new Error(`Annotation not found: ${request.annotation.id}`);
		}
		if (annotation.kind === 'agent') {
			await deleteAgentAnnotation(request.workspace.cwd, companionPath, companion!, annotation, companions);
		} else {
			await deleteUserAnnotationCascade(request.workspace.cwd, companionPath, companion!, annotation, companions);
			await deleteWork({ workspaceCwd: request.workspace.cwd, userAnnotationId: annotation.id });
		}
		return annotation;
	});
}

export function parseAnnotationAppendRequest(value: unknown): AnnotationAppendRequest {
	if (!isRecord(value) || !isWorkspace(value.workspace) || !isRecord(value.document)
		|| !isNonEmptyString(value.document.uri) || !Number.isSafeInteger(value.document.line) || (value.document.line as number) < 0
		|| !isRecord(value.annotation) || (value.annotation.id !== undefined && !isOpaqueId(value.annotation.id))
		|| !isNonEmptyString(value.annotation.message) || !isAnnotationPromptPreset(value.annotation.preset)
		|| (value.annotation.scope !== 'line' && value.annotation.scope !== 'project')) {
		throw new Error('annotation append request must include workspace, saved document location, and annotation content');
	}
	return value as unknown as AnnotationAppendRequest;
}

export function parseAnnotationReadRequest(value: unknown): AnnotationReadRequest {
	if (!isRecord(value) || !isWorkspace(value.workspace) || !isRecord(value.document) || !isNonEmptyString(value.document.uri)) {
		throw new Error('annotation read request must include workspace.cwd and document.uri');
	}
	return value as unknown as AnnotationReadRequest;
}

export function parseAnnotationDeleteRequest(value: unknown): AnnotationDeleteRequest {
	const request = parseAnnotationReadRequest(value);
	if (!isRecord(value) || !isRecord(value.annotation) || !isOpaqueId(value.annotation.id)) {
		throw new Error('annotation delete request must include workspace.cwd, document.uri, and annotation.id');
	}
	return { ...request, annotation: { id: value.annotation.id } };
}

export async function reanchorAnnotations(value: unknown): Promise<AnnotationReanchorResult> {
	const request = parseAnnotationReadRequest(value);
	const permanentCommit = await defaultServices.resolvePermanentCommit(request.workspace.cwd);
	const repaired = await repairFromDiff(value);
	if (repaired.reanchor === undefined) { throw new Error('repair from diff did not receive a source change'); }
	return reanchorResult(
		repaired.reanchor.companion,
		permanentCommit,
		repaired.reanchor.changedAnnotationIds,
		repaired.reanchor.fileScopedAnnotationIds,
		repaired.affectedPaths,
		repaired.reanchor.alreadyApplied,
	);
}

function reanchorResult(
	companion: AnnotationCompanion,
	permanentCommit: string,
	changedAnnotationIds: readonly string[],
	fileScopedAnnotationIds: readonly string[],
	affectedPaths: readonly string[],
	alreadyApplied: boolean,
): AnnotationReanchorResult {
	return {
		companion: {
			...companion,
			currentPermanentCommit: permanentCommit,
			currentPermanentAnnotationIds: companion.annotations
				.filter(annotation => annotation.permanentBaseCommit === permanentCommit)
				.map(annotation => annotation.id),
		},
		changedAnnotationIds,
		fileScopedAnnotationIds,
		affectedPaths,
		alreadyApplied,
	};
}

export async function appendOfficialResponse(input: {
	readonly workspaceCwd: string;
	readonly sourceUri: string;
	readonly response: OfficialResponse;
}): Promise<{ readonly response: OfficialResponse; readonly appended: boolean }> {
	validateOfficialResponse(input.response, input.response.userAnnotationId);
	return withCompanionLock(input.workspaceCwd, async () => {
		const companions = new CompanionWorkingSet();
		const companionPath = companionPathForSource(input.workspaceCwd, input.sourceUri);
		const loaded = await companions.load(companionPath);
		const existing = loaded.kind === 'found' ? loaded.companion : undefined;
		const annotationIndex = existing?.annotations.findIndex(annotation => annotation.kind === 'user' && annotation.id === input.response.userAnnotationId) ?? -1;
		if (annotationIndex < 0) { throw new Error(`Originating user annotation not found: ${input.response.userAnnotationId}`); }
		const annotation = existing!.annotations[annotationIndex] as UserAnnotation;
		const duplicate = annotation.officialResponses.find(response => sameOfficialResponse(response, input.response));
		if (duplicate !== undefined) { return { response: duplicate, appended: false }; }
		const annotations = [...existing!.annotations];
		annotations[annotationIndex] = { ...annotation, officialResponses: [...annotation.officialResponses, input.response] };
		companions.stage(companionPath, { ...existing!, annotations });
		await companions.write();
		return { response: input.response, appended: true };
	});
}

export async function containsOfficialResponse(input: {
	readonly workspaceCwd: string;
	readonly sourceUri: string;
	readonly response: OfficialResponse;
}): Promise<boolean> {
	const loaded = await new CompanionWorkingSet().load(companionPathForSource(input.workspaceCwd, input.sourceUri));
	if (loaded.kind === 'missing') { return false; }
	const companion = loaded.companion;
	const annotation = companion.annotations.find(candidate => candidate.kind === 'user' && candidate.id === input.response.userAnnotationId);
	return annotation?.kind === 'user' && annotation.officialResponses.some(response => sameOfficialResponse(response, input.response));
}

export async function writeAgentAnnotationPair(input: {
	readonly workspaceCwd: string;
	readonly originFile: string;
	readonly targetFile: string;
	readonly userAnnotationId: string;
	readonly agentAnnotationId: string;
	readonly agentId: string;
	readonly agentSessionId: string;
	readonly body: string;
	readonly createdAt: string;
	readonly targetLine: number;
}): Promise<readonly string[]> {
	return withCompanionLock(input.workspaceCwd, async () => {
		const companions = new CompanionWorkingSet();
		const permanentBaseCommit = await defaultServices.resolvePermanentCommit(input.workspaceCwd);
		const originFile = normalizeRelativeSourceFile(input.originFile, 'origin file');
		const targetFile = normalizeRelativeSourceFile(input.targetFile, 'target file');
		const originPath = companionPathForSource(input.workspaceCwd, sourceUriForFile(input.workspaceCwd, originFile));
		const targetPath = companionPathForSource(input.workspaceCwd, sourceUriForFile(input.workspaceCwd, targetFile));
		const loadedOrigin = await companions.load(originPath);
		if (loadedOrigin.kind === 'missing') { throw new Error(`Originating user annotation not found: ${input.userAnnotationId}`); }
		const origin = loadedOrigin.companion;
		const source = await readStableUtf8(path.join(path.resolve(input.workspaceCwd), ...targetFile.split('/')), 'source');
		const sourceDigest = contentDigest(source);
		const target = originPath === targetPath ? origin : await companions.readOrEmpty(targetPath, sourceDigest);
		if (target.annotations.length > 0 && target.sourceDigest !== sourceDigest) {
			throw new Error('Target annotation companion source baseline is stale; re-anchor it before annotating.');
		}
		const originIndex = origin.annotations.findIndex(annotation => annotation.kind === 'user' && annotation.id === input.userAnnotationId);
		if (originIndex < 0) { throw new Error(`Originating user annotation not found: ${input.userAnnotationId}`); }
		const anchor = createAnnotationAnchor(source, input.targetLine);
		const parent: AnnotationLink = { annotationId: input.userAnnotationId, file: originFile, line: (origin.annotations[originIndex] as UserAnnotation).anchor.line };
		const childLink: AnnotationLink = { annotationId: input.agentAnnotationId, file: targetFile, line: anchor.line };
		const child: AgentFileAnnotation = {
			kind: 'agent', id: input.agentAnnotationId, agentId: input.agentId, agentSessionId: input.agentSessionId,
			permanentBaseCommit,
			body: input.body, createdAt: input.createdAt, anchor, userAnnotation: parent,
		};
		assertAnnotation(child);
		const existingChild = target.annotations.find(annotation => annotation.id === child.id);
		if (existingChild !== undefined && (existingChild.kind !== 'agent' || !sameAgentAnnotationContent(existingChild, child))) {
			throw new Error(`Annotation ID is already reserved with different content: ${child.id}`);
		}
		const user = origin.annotations[originIndex] as UserAnnotation;
		const existingLink = user.agentAnnotations.find(link => link.annotationId === child.id);
		if (existingLink !== undefined && JSON.stringify(existingLink) !== JSON.stringify(childLink)) {
			throw new Error('Origin annotation contains a mismatched child link.');
		}
		if (originPath === targetPath) {
			let annotations = [...origin.annotations];
			if (existingChild === undefined) { annotations.push(child); }
			annotations[originIndex] = { ...user, agentAnnotations: existingLink === undefined ? [...user.agentAnnotations, childLink] : user.agentAnnotations };
			companions.stage(originPath, { ...origin, sourceDigest, annotations });
		} else {
			if (existingChild === undefined) { companions.stage(targetPath, { ...target, sourceDigest, annotations: [...target.annotations, child] }); }
			if (existingLink === undefined) {
				const annotations = [...origin.annotations];
				annotations[originIndex] = { ...user, agentAnnotations: [...user.agentAnnotations, childLink] };
				companions.stage(originPath, { ...origin, annotations });
			}
		}
		await companions.write();
		return originFile === targetFile ? [originFile] : [originFile, targetFile];
	});
}

export async function readStableMarkdown(file: string): Promise<string> {
	const body = (await readStableUtf8(file, 'annotation content')).replace(/\r\n?/g, '\n');
	if (body.includes('\0')) { throw new Error('The annotation content file must not contain NUL bytes.'); }
	if (body.trim() === '') { throw new Error('The annotation content file must contain non-whitespace Markdown.'); }
	return body;
}

async function deleteAgentAnnotation(
	cwd: string,
	targetPath: string,
	target: AnnotationCompanion,
	child: AgentFileAnnotation,
	companions: CompanionWorkingSet,
): Promise<void> {
	const originPath = companionPathForSource(cwd, sourceUriForFile(cwd, child.userAnnotation.file));
	if (originPath !== targetPath) {
		const loadedOrigin = await companions.load(originPath);
		if (loadedOrigin.kind === 'found') {
			const origin = loadedOrigin.companion;
			const userIndex = origin.annotations.findIndex(annotation => annotation.kind === 'user'
				&& annotation.id === child.userAnnotation.annotationId);
			if (userIndex >= 0) {
				const user = origin.annotations[userIndex] as UserAnnotation;
				const link = user.agentAnnotations.find(candidate => candidate.annotationId === child.id);
				if (link !== undefined) {
					if (link.file !== sourceFileForCompanion(cwd, targetPath) || link.line !== child.anchor.line) {
						throw new Error('Agent annotation parent/child links do not match.');
					}
					const annotations = [...origin.annotations];
					annotations[userIndex] = {
						...user,
						agentAnnotations: user.agentAnnotations.filter(candidate => candidate.annotationId !== child.id),
					};
					companions.stage(originPath, { ...origin, annotations });
				}
			}
		}
		companions.stage(targetPath, { ...target, annotations: target.annotations.filter(annotation => annotation.id !== child.id) });
		const changedPaths = companions.changedPaths();
		await companions.write([...changedPaths.filter(candidate => candidate !== targetPath), targetPath]);
		return;
	}

	const origin = target;
	const userIndex = origin.annotations.findIndex(annotation => annotation.kind === 'user' && annotation.id === child.userAnnotation.annotationId);
	if (userIndex < 0) { throw new Error('Agent annotation parent link does not resolve.'); }
	const user = origin.annotations[userIndex] as UserAnnotation;
	const link = user.agentAnnotations.find(candidate => candidate.annotationId === child.id);
	if (link === undefined || link.file !== sourceFileForCompanion(cwd, targetPath) || link.line !== child.anchor.line) {
		throw new Error('Agent annotation parent/child links do not match.');
	}
	const annotations = origin.annotations.filter(annotation => annotation.id !== child.id);
	const nextUserIndex = annotations.findIndex(annotation => annotation.kind === 'user' && annotation.id === user.id);
	annotations[nextUserIndex] = { ...user, agentAnnotations: user.agentAnnotations.filter(candidate => candidate.annotationId !== child.id) };
	companions.stage(originPath, { ...origin, annotations });
	await companions.write();
}

async function deleteUserAnnotationCascade(
	cwd: string,
	originPath: string,
	origin: AnnotationCompanion,
	user: UserAnnotation,
	companions: CompanionWorkingSet,
): Promise<void> {
	for (const link of user.agentAnnotations) {
		const targetPath = companionPathForSource(cwd, sourceUriForFile(cwd, link.file));
		if (targetPath === originPath) { continue; }
		const loaded = await companions.load(targetPath);
		if (loaded.kind === 'missing') { continue; }
		const target = loaded.companion;
		const child = target.annotations.find(annotation => annotation.kind === 'agent' && annotation.id === link.annotationId);
		if (child !== undefined && (child.kind !== 'agent' || child.userAnnotation.annotationId !== user.id
			|| child.userAnnotation.file !== sourceFileForCompanion(cwd, originPath) || child.anchor.line !== link.line)) {
			throw new Error('User annotation contains a mismatched child link.');
		}
		if (child !== undefined) {
			companions.stage(targetPath, { ...target, annotations: target.annotations.filter(annotation => annotation.id !== link.annotationId) });
		}
	}
	const childIds = new Set(user.agentAnnotations.filter(link => companionPathForSource(cwd, sourceUriForFile(cwd, link.file)) === originPath).map(link => link.annotationId));
	companions.stage(originPath, { ...origin, annotations: origin.annotations.filter(annotation => annotation.id !== user.id && !childIds.has(annotation.id)) });
	const changedPaths = companions.changedPaths();
	await companions.write([...changedPaths.filter(candidate => candidate !== originPath), originPath]);
}

function validateOfficialResponse(value: unknown, expectedId: string): asserts value is OfficialResponse {
	if (!isRecord(value) || !isOpaqueId(value.userAnnotationId) || value.userAnnotationId !== expectedId
		|| !isOpaqueId(value.agentId) || !isOpaqueId(value.agentSessionId) || typeof value.body !== 'string'
		|| value.body.trim() === '' || value.body.includes('\0') || value.body.includes('\r') || !isCanonicalTimestamp(value.createdAt)) {
		throw new Error('Invalid annotation companion: malformed official response');
	}
}

function sameUserAnnotationContent(left: UserAnnotation, right: UserAnnotation): boolean {
	return left.id === right.id && left.message === right.message && left.preset === right.preset && left.scope === right.scope
		&& JSON.stringify(left.anchor) === JSON.stringify(right.anchor);
}

function sameOfficialResponse(left: OfficialResponse, right: OfficialResponse): boolean {
	return left.userAnnotationId === right.userAnnotationId && left.agentId === right.agentId
		&& left.agentSessionId === right.agentSessionId && left.body === right.body && left.createdAt === right.createdAt;
}

function sameAgentAnnotationContent(left: AgentFileAnnotation, right: AgentFileAnnotation): boolean {
	return left.id === right.id && left.agentId === right.agentId && left.agentSessionId === right.agentSessionId
		&& left.body === right.body && JSON.stringify(left.anchor) === JSON.stringify(right.anchor)
		&& JSON.stringify(left.userAnnotation) === JSON.stringify(right.userAnnotation);
}

function isWorkspace(value: unknown): value is { readonly cwd: string } { return isRecord(value) && isNonEmptyString(value.cwd); }
function isCanonicalTimestamp(value: unknown): value is string { return typeof value === 'string' && value !== '' && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString() === value; }
function isNonEmptyString(value: unknown): value is string { return typeof value === 'string' && value.trim() !== ''; }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
