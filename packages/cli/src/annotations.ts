import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { deleteWork } from './agentStore.js';
import { readGitWorkflowState } from './gitWorkflow.js';

export const currentAnnotationCompanionVersion = 4;

export interface AnnotationAnchor {
	readonly line: number;
	readonly text: string;
	readonly before: readonly string[];
	readonly after: readonly string[];
}

export interface AnnotationLink {
	readonly annotationId: string;
	readonly file: string;
	readonly line: number;
}

export interface OfficialResponse {
	readonly userAnnotationId: string;
	readonly agentId: string;
	readonly agentSessionId: string;
	readonly body: string;
	readonly createdAt: string;
}

export interface UserAnnotation {
	readonly kind: 'user';
	readonly id: string;
	readonly permanentBaseCommit: string;
	readonly message: string;
	readonly preset: string;
	readonly scope: 'line' | 'project';
	readonly anchor: AnnotationAnchor;
	readonly officialResponses: readonly OfficialResponse[];
	readonly agentAnnotations: readonly AnnotationLink[];
}

export interface AgentFileAnnotation {
	readonly kind: 'agent';
	readonly id: string;
	readonly permanentBaseCommit: string;
	readonly agentId: string;
	readonly agentSessionId: string;
	readonly body: string;
	readonly createdAt: string;
	readonly anchor: AnnotationAnchor;
	readonly userAnnotation: AnnotationLink;
}

export type Annotation = UserAnnotation | AgentFileAnnotation;

export interface AnnotationCompanion {
	readonly version: typeof currentAnnotationCompanionVersion;
	readonly annotations: readonly Annotation[];
}

export interface AnnotationReadResult extends AnnotationCompanion {
	readonly currentPermanentCommit: string;
	readonly currentPermanentAnnotationIds: readonly string[];
}

export interface AnnotationAppendRequest {
	readonly workspace: { readonly cwd: string };
	readonly document: { readonly uri: string; readonly line: number };
	readonly annotation: {
		readonly id?: string;
		readonly message: string;
		readonly preset: string;
		readonly scope: 'line' | 'project';
	};
}

export interface AnnotationReadRequest {
	readonly workspace: { readonly cwd: string };
	readonly document: { readonly uri: string };
}

export interface AnnotationDeleteRequest extends AnnotationReadRequest {
	readonly annotation: { readonly id: string };
}

export interface AnnotationStoreServices {
	readonly createId: () => string;
	readonly now: () => Date;
	readonly sleep: (milliseconds: number) => Promise<void>;
	readonly lockTimeoutMs: number;
	readonly staleLockMs: number;
	readonly resolvePermanentCommit: (cwd: string) => Promise<string>;
}

const defaultServices: AnnotationStoreServices = {
	createId: randomUUID,
	now: () => new Date(),
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
	return withAnnotationLock(request.workspace.cwd, services, async () => {
		const permanentBaseCommit = await services.resolvePermanentCommit(request.workspace.cwd);
		const companionPath = companionPathForSource(request.workspace.cwd, request.document.uri);
		const existing = await readCompanionFile(request.workspace.cwd, companionPath, permanentBaseCommit);
		const source = await readStableUtf8(fileURLToPath(new URL(request.document.uri)), 'source');
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
		validateAnnotation(annotation);
		const alreadyPersisted = existing.annotations.find(candidate => candidate.id === annotation.id);
		if (alreadyPersisted !== undefined) {
			if (alreadyPersisted.kind !== 'user' || !sameUserAnnotationContent(alreadyPersisted, annotation)) {
				throw new Error(`Annotation ID is already reserved with different content: ${annotation.id}`);
			}
			return alreadyPersisted;
		}
		await writeCompanionFile(companionPath, { version: currentAnnotationCompanionVersion, annotations: [...existing.annotations, annotation] });
		return annotation;
	});
}

export async function readUserAnnotations(value: unknown): Promise<AnnotationReadResult> {
	const request = parseAnnotationReadRequest(value);
	const currentPermanentCommit = await defaultServices.resolvePermanentCommit(request.workspace.cwd);
	const companion = await readCompanionFile(
		request.workspace.cwd,
		companionPathForSource(request.workspace.cwd, request.document.uri),
		currentPermanentCommit,
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
	return withAnnotationLock(request.workspace.cwd, defaultServices, async () => {
		const permanentBaseCommit = await defaultServices.resolvePermanentCommit(request.workspace.cwd);
		const companionPath = companionPathForSource(request.workspace.cwd, request.document.uri);
		const companion = await readCompanionFile(request.workspace.cwd, companionPath, permanentBaseCommit);
		const annotation = companion.annotations.find(candidate => candidate.id === request.annotation.id);
		if (annotation === undefined) {
			throw new Error(`Annotation not found: ${request.annotation.id}`);
		}
		if (annotation.kind === 'agent') {
			await deleteAgentAnnotation(request.workspace.cwd, companionPath, companion, annotation);
		} else {
			await deleteUserAnnotationCascade(request.workspace.cwd, companionPath, companion, annotation);
			await deleteWork({ workspaceCwd: request.workspace.cwd, userAnnotationId: annotation.id });
		}
		return annotation;
	});
}

export function createAnnotationAnchor(source: string, line: number): AnnotationAnchor {
	const lines = source.replace(/\r\n?/g, '\n').split('\n');
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

export function companionPathForSource(workspaceCwd: string, sourceUri: string): string {
	const relativeSource = sourceFileForUri(workspaceCwd, sourceUri);
	return path.join(path.resolve(workspaceCwd), '.sundial', `${relativeSource.split('/').join(path.sep)}.comments`);
}

export function sourceFileForUri(workspaceCwd: string, sourceUri: string): string {
	if (!path.isAbsolute(workspaceCwd)) { throw new Error('workspace.cwd must be an absolute path'); }
	let sourcePath: string;
	try {
		const uri = new URL(sourceUri);
		if (uri.protocol !== 'file:') { throw new Error('source URI must use the file scheme'); }
		sourcePath = fileURLToPath(uri);
	} catch (error) {
		throw new Error(error instanceof Error && error.message === 'source URI must use the file scheme'
			? error.message : 'document.uri must be a valid file URI');
	}
	return normalizeWorkspaceFile(workspaceCwd, sourcePath, 'document.uri');
}

export function sourceUriForFile(workspaceCwd: string, file: string): string {
	const normalized = normalizeRelativeFile(file, 'annotation link file');
	return pathToFileURL(path.join(path.resolve(workspaceCwd), ...normalized.split('/'))).toString();
}

export function parseAnnotationCompanion(text: string, migrationCommit?: string): AnnotationCompanion {
	const lines = text.replace(/\r\n?/g, '\n').split('\n');
	if (lines.at(-1) === '') { lines.pop(); }
	const version = lines[0] === 'version: 4' ? 4 : lines[0] === 'version: 3' ? 3 : undefined;
	if (version === undefined || lines[1] !== 'annotations:') {
		throw new Error('Invalid annotation companion: expected version 3 or 4');
	}
	if (version === 3 && !isCommitHash(migrationCommit)) {
		throw new Error('Invalid annotation companion: version 3 migration requires a permanent commit');
	}
	const annotations = lines.slice(2).map((line, index) => {
		if (!line.startsWith('  - ')) {
			throw new Error(`Invalid annotation companion: malformed annotation at index ${index}`);
		}
		let value: unknown;
		try { value = JSON.parse(line.slice(4)); }
		catch { throw new Error(`Invalid annotation companion: malformed annotation at index ${index}`); }
		validateAnnotation(value, version === 4);
		if (version === 3) {
			return { ...(value as Annotation), permanentBaseCommit: migrationCommit as string };
		}
		return value as Annotation;
	});
	if (new Set(annotations.map(annotation => annotation.id)).size !== annotations.length) {
		throw new Error('Invalid annotation companion: annotation IDs must be unique');
	}
	return { version: currentAnnotationCompanionVersion, annotations };
}

export function renderAnnotationCompanion(companion: AnnotationCompanion): string {
	if (companion.version !== currentAnnotationCompanionVersion) { throw new Error(`Unsupported annotation companion version: ${String(companion.version)}`); }
	for (const annotation of companion.annotations) { validateAnnotation(annotation); }
	if (new Set(companion.annotations.map(annotation => annotation.id)).size !== companion.annotations.length) {
		throw new Error('Invalid annotation companion: annotation IDs must be unique');
	}
	return [`version: ${currentAnnotationCompanionVersion}`, 'annotations:', ...companion.annotations.map(annotation => `  - ${JSON.stringify(annotation)}`), ''].join('\n');
}

export function parseAnnotationAppendRequest(value: unknown): AnnotationAppendRequest {
	if (!isRecord(value) || !isWorkspace(value.workspace) || !isRecord(value.document)
		|| !isNonEmptyString(value.document.uri) || !Number.isSafeInteger(value.document.line) || (value.document.line as number) < 0
		|| !isRecord(value.annotation) || (value.annotation.id !== undefined && !isSafeOpaqueId(value.annotation.id))
		|| !isNonEmptyString(value.annotation.message) || !isPromptPreset(value.annotation.preset)
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
	if (!isRecord(value) || !isRecord(value.annotation) || !isSafeOpaqueId(value.annotation.id)) {
		throw new Error('annotation delete request must include workspace.cwd, document.uri, and annotation.id');
	}
	return { ...request, annotation: { id: value.annotation.id } };
}

export async function appendOfficialResponse(input: {
	readonly workspaceCwd: string;
	readonly sourceUri: string;
	readonly response: OfficialResponse;
}): Promise<{ readonly response: OfficialResponse; readonly appended: boolean }> {
	validateOfficialResponse(input.response, input.response.userAnnotationId);
	return withAnnotationLock(input.workspaceCwd, defaultServices, async () => {
		const permanentBaseCommit = await defaultServices.resolvePermanentCommit(input.workspaceCwd);
		const companionPath = companionPathForSource(input.workspaceCwd, input.sourceUri);
		const existing = await readCompanionFile(input.workspaceCwd, companionPath, permanentBaseCommit);
		const annotationIndex = existing.annotations.findIndex(annotation => annotation.kind === 'user' && annotation.id === input.response.userAnnotationId);
		if (annotationIndex < 0) { throw new Error(`Originating user annotation not found: ${input.response.userAnnotationId}`); }
		const annotation = existing.annotations[annotationIndex] as UserAnnotation;
		const duplicate = annotation.officialResponses.find(response => sameOfficialResponse(response, input.response));
		if (duplicate !== undefined) { return { response: duplicate, appended: false }; }
		const annotations = [...existing.annotations];
		annotations[annotationIndex] = { ...annotation, officialResponses: [...annotation.officialResponses, input.response] };
		await writeCompanionFile(companionPath, { version: currentAnnotationCompanionVersion, annotations });
		return { response: input.response, appended: true };
	});
}

export async function containsOfficialResponse(input: {
	readonly workspaceCwd: string;
	readonly sourceUri: string;
	readonly response: OfficialResponse;
}): Promise<boolean> {
	const permanentBaseCommit = await defaultServices.resolvePermanentCommit(input.workspaceCwd);
	const companion = await readCompanionFile(input.workspaceCwd, companionPathForSource(input.workspaceCwd, input.sourceUri), permanentBaseCommit);
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
	return withAnnotationLock(input.workspaceCwd, defaultServices, async () => {
		const permanentBaseCommit = await defaultServices.resolvePermanentCommit(input.workspaceCwd);
		const originFile = normalizeRelativeFile(input.originFile, 'origin file');
		const targetFile = normalizeRelativeFile(input.targetFile, 'target file');
		const originPath = companionPathForSource(input.workspaceCwd, sourceUriForFile(input.workspaceCwd, originFile));
		const targetPath = companionPathForSource(input.workspaceCwd, sourceUriForFile(input.workspaceCwd, targetFile));
		const origin = await readCompanionFile(input.workspaceCwd, originPath, permanentBaseCommit);
		const target = originPath === targetPath ? origin : await readCompanionFile(input.workspaceCwd, targetPath, permanentBaseCommit);
		const originIndex = origin.annotations.findIndex(annotation => annotation.kind === 'user' && annotation.id === input.userAnnotationId);
		if (originIndex < 0) { throw new Error(`Originating user annotation not found: ${input.userAnnotationId}`); }
		const source = await readStableUtf8(path.join(path.resolve(input.workspaceCwd), ...targetFile.split('/')), 'source');
		const anchor = createAnnotationAnchor(source, input.targetLine);
		const parent: AnnotationLink = { annotationId: input.userAnnotationId, file: originFile, line: (origin.annotations[originIndex] as UserAnnotation).anchor.line };
		const childLink: AnnotationLink = { annotationId: input.agentAnnotationId, file: targetFile, line: anchor.line };
		const child: AgentFileAnnotation = {
			kind: 'agent', id: input.agentAnnotationId, agentId: input.agentId, agentSessionId: input.agentSessionId,
			permanentBaseCommit,
			body: input.body, createdAt: input.createdAt, anchor, userAnnotation: parent,
		};
		validateAnnotation(child);
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
			await writeCompanionFile(originPath, { version: currentAnnotationCompanionVersion, annotations });
		} else {
			if (existingChild === undefined) { await writeCompanionFile(targetPath, { version: currentAnnotationCompanionVersion, annotations: [...target.annotations, child] }); }
			if (existingLink === undefined) {
				const annotations = [...origin.annotations];
				annotations[originIndex] = { ...user, agentAnnotations: [...user.agentAnnotations, childLink] };
				await writeCompanionFile(originPath, { version: currentAnnotationCompanionVersion, annotations });
			}
		}
		return originFile === targetFile ? [originFile] : [originFile, targetFile];
	});
}

export async function readStableMarkdown(file: string): Promise<string> {
	const body = (await readStableUtf8(file, 'annotation content')).replace(/\r\n?/g, '\n');
	if (body.includes('\0')) { throw new Error('The annotation content file must not contain NUL bytes.'); }
	if (body.trim() === '') { throw new Error('The annotation content file must contain non-whitespace Markdown.'); }
	return body;
}

export function contentDigest(body: string): string {
	return createHash('sha256').update(body, 'utf8').digest('hex');
}

async function deleteAgentAnnotation(cwd: string, targetPath: string, target: AnnotationCompanion, child: AgentFileAnnotation): Promise<void> {
	const originPath = companionPathForSource(cwd, sourceUriForFile(cwd, child.userAnnotation.file));
	const origin = originPath === targetPath ? target : await readCompanionFile(cwd, originPath);
	const userIndex = origin.annotations.findIndex(annotation => annotation.kind === 'user' && annotation.id === child.userAnnotation.annotationId);
	if (userIndex < 0) { throw new Error('Agent annotation parent link does not resolve.'); }
	const user = origin.annotations[userIndex] as UserAnnotation;
	const link = user.agentAnnotations.find(candidate => candidate.annotationId === child.id);
	if (link === undefined || link.file !== sourceFileForCompanion(cwd, targetPath) || link.line !== child.anchor.line) {
		throw new Error('Agent annotation parent/child links do not match.');
	}
	if (originPath === targetPath) {
		const annotations = origin.annotations.filter(annotation => annotation.id !== child.id);
		const nextUserIndex = annotations.findIndex(annotation => annotation.kind === 'user' && annotation.id === user.id);
		annotations[nextUserIndex] = { ...user, agentAnnotations: user.agentAnnotations.filter(candidate => candidate.annotationId !== child.id) };
		await writeCompanionFile(originPath, { version: currentAnnotationCompanionVersion, annotations });
	} else {
		await writeCompanionFile(targetPath, { version: currentAnnotationCompanionVersion, annotations: target.annotations.filter(annotation => annotation.id !== child.id) });
		const annotations = [...origin.annotations];
		annotations[userIndex] = { ...user, agentAnnotations: user.agentAnnotations.filter(candidate => candidate.annotationId !== child.id) };
		await writeCompanionFile(originPath, { version: currentAnnotationCompanionVersion, annotations });
	}
}

async function deleteUserAnnotationCascade(cwd: string, originPath: string, origin: AnnotationCompanion, user: UserAnnotation): Promise<void> {
	for (const link of user.agentAnnotations) {
		const targetPath = companionPathForSource(cwd, sourceUriForFile(cwd, link.file));
		const target = targetPath === originPath ? origin : await readCompanionFile(cwd, targetPath);
		const child = target.annotations.find(annotation => annotation.kind === 'agent' && annotation.id === link.annotationId);
		if (child !== undefined && (child.kind !== 'agent' || child.userAnnotation.annotationId !== user.id
			|| child.userAnnotation.file !== sourceFileForCompanion(cwd, originPath) || child.anchor.line !== link.line)) {
			throw new Error('User annotation contains a mismatched child link.');
		}
		if (targetPath !== originPath && child !== undefined) {
			await writeCompanionFile(targetPath, { version: currentAnnotationCompanionVersion, annotations: target.annotations.filter(annotation => annotation.id !== link.annotationId) });
		}
	}
	const childIds = new Set(user.agentAnnotations.filter(link => companionPathForSource(cwd, sourceUriForFile(cwd, link.file)) === originPath).map(link => link.annotationId));
	await writeCompanionFile(originPath, { version: currentAnnotationCompanionVersion, annotations: origin.annotations.filter(annotation => annotation.id !== user.id && !childIds.has(annotation.id)) });
}

async function readCompanionFile(cwd: string, companionPath: string, migrationCommit?: string): Promise<AnnotationCompanion> {
	const permanentBaseCommit = migrationCommit ?? await defaultServices.resolvePermanentCommit(cwd);
	try { return parseAnnotationCompanion(await readFile(companionPath, 'utf8'), permanentBaseCommit); }
	catch (error) {
		if (nodeCode(error) === 'ENOENT') { return { version: currentAnnotationCompanionVersion, annotations: [] }; }
		throw error;
	}
}

async function writeCompanionFile(companionPath: string, companion: AnnotationCompanion): Promise<void> {
	const rendered = renderAnnotationCompanion(companion);
	await mkdir(path.dirname(companionPath), { recursive: true });
	const temporaryPath = `${companionPath}.tmp-${process.pid}-${randomUUID()}`;
	try { await writeFile(temporaryPath, rendered, { encoding: 'utf8', flag: 'wx' }); await rename(temporaryPath, companionPath); }
	finally { await rm(temporaryPath, { force: true }); }
}

async function readStableUtf8(file: string, description: string): Promise<string> {
	const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
	try {
		const before = await handle.stat({ bigint: true });
		if (!before.isFile()) { throw new Error(`The ${description} path must identify a regular file.`); }
		const bytes = await handle.readFile();
		const after = await handle.stat({ bigint: true });
		if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs) {
			throw new Error(`The ${description} file changed while it was being read.`);
		}
		try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
		catch { throw new Error(`The ${description} file must contain valid UTF-8.`); }
	} finally { await handle.close(); }
}

async function withAnnotationLock<T>(cwd: string, services: AnnotationStoreServices, operation: () => Promise<T>): Promise<T> {
	const root = path.join(path.resolve(cwd), '.sundial');
	const lock = path.join(root, '.annotations.lock');
	await mkdir(root, { recursive: true });
	const started = Date.now();
	while (true) {
		try { await mkdir(lock); break; }
		catch (error) {
			if (nodeCode(error) !== 'EEXIST') { throw error; }
			try { if (Date.now() - (await stat(lock)).mtimeMs > services.staleLockMs) { await rm(lock, { recursive: true, force: true }); } } catch { /* retry */ }
			if (Date.now() - started > services.lockTimeoutMs) { throw new Error('Timed out waiting for annotation lock.'); }
			await services.sleep(10);
		}
	}
	try { return await operation(); }
	finally { await rm(lock, { recursive: true, force: true }); }
}

function validateAnnotation(value: unknown, requirePermanentBase = true): asserts value is Annotation {
	if (!isRecord(value) || !isSafeOpaqueId(value.id) || !isAnchor(value.anchor)) {
		throw new Error('Invalid annotation companion: malformed annotation');
	}
	if (requirePermanentBase ? !isCommitHash(value.permanentBaseCommit) : value.permanentBaseCommit !== undefined) {
		throw new Error('Invalid annotation companion: malformed permanent base commit');
	}
	if (value.kind === 'user') {
		if (!isNonEmptyString(value.message) || !isPromptPreset(value.preset) || (value.scope !== 'line' && value.scope !== 'project')
			|| !Array.isArray(value.officialResponses) || !value.officialResponses.every(response => isOfficialResponse(response, value.id as string))
			|| !Array.isArray(value.agentAnnotations) || !value.agentAnnotations.every(isAnnotationLink)
			|| new Set(value.agentAnnotations.map(link => (link as AnnotationLink).annotationId)).size !== value.agentAnnotations.length) {
			throw new Error('Invalid annotation companion: malformed user annotation');
		}
		return;
	}
	if (value.kind === 'agent') {
		if (!isSafeOpaqueId(value.agentId) || !isSafeOpaqueId(value.agentSessionId) || typeof value.body !== 'string' || value.body.trim() === ''
			|| value.body.includes('\0') || value.body.includes('\r') || !isCanonicalTimestamp(value.createdAt) || !isAnnotationLink(value.userAnnotation)) {
			throw new Error('Invalid annotation companion: malformed agent annotation');
		}
		return;
	}
	throw new Error('Invalid annotation companion: unknown annotation kind');
}

function isAnchor(value: unknown): value is AnnotationAnchor {
	return isRecord(value) && Number.isSafeInteger(value.line) && (value.line as number) >= 0 && typeof value.text === 'string'
		&& !/[\r\n]/.test(value.text) && isAnchorContext(value.before) && isAnchorContext(value.after);
}

function isAnnotationLink(value: unknown): value is AnnotationLink {
	return isRecord(value) && isSafeOpaqueId(value.annotationId) && safeRelativeFile(value.file)
		&& Number.isSafeInteger(value.line) && (value.line as number) >= 0;
}

function isOfficialResponse(value: unknown, expectedId: string): value is OfficialResponse {
	try { validateOfficialResponse(value, expectedId); return true; } catch { return false; }
}

function validateOfficialResponse(value: unknown, expectedId: string): asserts value is OfficialResponse {
	if (!isRecord(value) || !isSafeOpaqueId(value.userAnnotationId) || value.userAnnotationId !== expectedId
		|| !isSafeOpaqueId(value.agentId) || !isSafeOpaqueId(value.agentSessionId) || typeof value.body !== 'string'
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

function normalizeWorkspaceFile(cwd: string, file: string, description: string): string {
	const workspace = path.resolve(cwd);
	const relative = path.relative(workspace, path.resolve(file));
	if (relative === '' || path.isAbsolute(relative) || relative === '..' || relative.startsWith(`..${path.sep}`)) {
		throw new Error(`${description} must identify a source file inside workspace.cwd`);
	}
	const normalized = relative.split(path.sep).join('/');
	if (normalized === '.sundial' || normalized.startsWith('.sundial/')) { throw new Error(`${description} must not identify .sundial`); }
	return normalized;
}

function normalizeRelativeFile(value: string, description: string): string {
	if (!safeRelativeFile(value)) { throw new Error(`${description} must be a safe workspace-relative file`); }
	const normalized = value.replaceAll('\\', '/');
	if (normalized === '.sundial' || normalized.startsWith('.sundial/')) { throw new Error(`${description} must not identify .sundial`); }
	return normalized;
}

function sourceFileForCompanion(cwd: string, companionPath: string): string {
	const relative = path.relative(path.join(path.resolve(cwd), '.sundial'), companionPath);
	if (!relative.endsWith('.comments')) { throw new Error('Invalid companion path.'); }
	return relative.slice(0, -'.comments'.length).split(path.sep).join('/');
}

function safeRelativeFile(value: unknown): value is string {
	return typeof value === 'string' && value.trim() !== '' && !path.isAbsolute(value)
		&& !value.split(/[\\/]/u).some(segment => segment === '' || segment === '.' || segment === '..');
}

function isWorkspace(value: unknown): value is { readonly cwd: string } { return isRecord(value) && isNonEmptyString(value.cwd); }
function isPromptPreset(value: unknown): value is string { return typeof value === 'string' && /^%(Q|F|W|R|C|T)$/.test(value); }
function isAnchorContext(value: unknown): value is readonly string[] { return Array.isArray(value) && value.length <= 3 && value.every(line => typeof line === 'string' && line.trim() !== '' && !/[\r\n]/.test(line)); }
function isSafeOpaqueId(value: unknown): value is string { return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value); }
function isCanonicalTimestamp(value: unknown): value is string { return typeof value === 'string' && value !== '' && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString() === value; }
function isCommitHash(value: unknown): value is string { return typeof value === 'string' && /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(value); }
function isNonEmptyString(value: unknown): value is string { return typeof value === 'string' && value.trim() !== ''; }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function nodeCode(error: unknown): string | undefined { return error instanceof Error && 'code' in error ? String(error.code) : undefined; }
