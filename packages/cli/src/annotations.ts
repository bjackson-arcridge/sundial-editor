import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

export const annotationCompanionVersion = 1;

export interface AnnotationAnchor {
	readonly line: number;
	readonly text: string;
	readonly before: readonly string[];
	readonly after: readonly string[];
}

export interface UserAnnotation {
	readonly id: string;
	readonly message: string;
	readonly preset: string;
	readonly scope: 'line' | 'project';
	readonly anchor: AnnotationAnchor;
}

export interface AnnotationAppendRequest {
	readonly workspace: { readonly cwd: string };
	readonly document: {
		readonly uri: string;
		readonly line: number;
		readonly text: string;
		readonly before: readonly string[];
		readonly after: readonly string[];
	};
	readonly annotation: { readonly message: string; readonly preset: string; readonly scope: 'line' | 'project' };
}

export interface AnnotationReadRequest {
	readonly workspace: { readonly cwd: string };
	readonly document: { readonly uri: string };
}

export interface AnnotationDeleteRequest extends AnnotationReadRequest {
	readonly annotation: { readonly id: string };
}

export interface AnnotationCompanion {
	readonly version: typeof annotationCompanionVersion;
	readonly annotations: readonly UserAnnotation[];
}

export interface AnnotationStoreServices {
	readonly createId: () => string;
}

const defaultServices: AnnotationStoreServices = { createId: randomUUID };

export async function appendUserAnnotation(
	value: unknown,
	services: AnnotationStoreServices = defaultServices,
): Promise<UserAnnotation> {
	const request = parseAnnotationAppendRequest(value);
	const companionPath = companionPathForSource(request.workspace.cwd, request.document.uri);
	const existing = await readCompanionFile(companionPath);
	const annotation: UserAnnotation = {
		id: services.createId(),
		message: request.annotation.message,
		preset: request.annotation.preset,
		scope: request.annotation.scope,
		anchor: {
			line: request.document.line,
			text: request.document.text,
			before: request.document.before,
			after: request.document.after,
		},
	};
	validateAnnotation(annotation);
	const companion: AnnotationCompanion = {
		version: annotationCompanionVersion,
		annotations: [...existing.annotations, annotation],
	};
	await writeCompanionFile(companionPath, companion);
	return annotation;
}

export async function readUserAnnotations(value: unknown): Promise<AnnotationCompanion> {
	const request = parseAnnotationReadRequest(value);
	return readCompanionFile(companionPathForSource(request.workspace.cwd, request.document.uri));
}

export async function deleteUserAnnotation(value: unknown): Promise<UserAnnotation> {
	const request = parseAnnotationDeleteRequest(value);
	const companionPath = companionPathForSource(request.workspace.cwd, request.document.uri);
	const existing = await readCompanionFile(companionPath);
	const deleted = existing.annotations.find(annotation => annotation.id === request.annotation.id);
	if (deleted === undefined) {
		throw new Error(`Annotation not found: ${request.annotation.id}`);
	}
	await writeCompanionFile(companionPath, {
		version: annotationCompanionVersion,
		annotations: existing.annotations.filter(annotation => annotation.id !== request.annotation.id),
	});
	return deleted;
}

export function companionPathForSource(workspaceCwd: string, sourceUri: string): string {
	if (!path.isAbsolute(workspaceCwd)) {
		throw new Error('workspace.cwd must be an absolute path');
	}
	let sourcePath: string;
	try {
		const uri = new URL(sourceUri);
		if (uri.protocol !== 'file:') {
			throw new Error('source URI must use the file scheme');
		}
		sourcePath = fileURLToPath(uri);
	} catch (error) {
		throw new Error(error instanceof Error && error.message === 'source URI must use the file scheme'
			? error.message
			: 'document.uri must be a valid file URI');
	}
	const workspacePath = path.resolve(workspaceCwd);
	const relativeSource = path.relative(workspacePath, path.resolve(sourcePath));
	if (relativeSource === '' || relativeSource === '..' || relativeSource.startsWith(`..${path.sep}`) || path.isAbsolute(relativeSource)) {
		throw new Error('document.uri must identify a source file inside workspace.cwd');
	}
	if (relativeSource === '.sundial' || relativeSource.startsWith(`.sundial${path.sep}`)) {
		throw new Error('document.uri must not identify a file inside the companion store');
	}
	return path.join(workspacePath, '.sundial', `${relativeSource}.comments`);
}

export function parseAnnotationCompanion(text: string): AnnotationCompanion {
	const lines = text.replaceAll('\r\n', '\n').split('\n');
	if (lines.at(-1) === '') {
		lines.pop();
	}
	if (lines[0] !== `version: ${annotationCompanionVersion}` || lines[1] !== 'annotations:') {
		throw new Error(`Invalid annotation companion: expected version ${annotationCompanionVersion}`);
	}
	const annotations: UserAnnotation[] = [];
	let index = 2;
	while (index < lines.length) {
		if (index + 6 >= lines.length) {
			throw new Error('Invalid annotation companion: incomplete annotation');
		}
		const id = parseQuotedField(lines[index], '  - id: ');
		const message = parseQuotedField(lines[index + 1], '    message: ');
		const preset = parseQuotedField(lines[index + 2], '    preset: ');
		const scope = parseQuotedField(lines[index + 3], '    scope: ');
		if (lines[index + 4] !== '    anchor:') {
			throw new Error('Invalid annotation companion: expected anchor');
		}
		const lineValue = parseIntegerField(lines[index + 5], '      line: ');
		const anchorText = parseQuotedField(lines[index + 6], '      text: ');
		index += 7;
		let before: readonly string[] = [];
		let after: readonly string[] = [];
		if (lines[index]?.startsWith('      before: ')) {
			before = parseStringArrayField(lines[index], '      before: ');
			after = parseStringArrayField(lines[index + 1] ?? '', '      after: ');
			index += 2;
		}
		const annotation = { id, message, preset, scope, anchor: { line: lineValue, text: anchorText, before, after } };
		validateAnnotation(annotation);
		annotations.push(annotation);
	}
	if (new Set(annotations.map(annotation => annotation.id)).size !== annotations.length) {
		throw new Error('Invalid annotation companion: annotation IDs must be unique');
	}
	return { version: annotationCompanionVersion, annotations };
}

export function renderAnnotationCompanion(companion: AnnotationCompanion): string {
	if (companion.version !== annotationCompanionVersion) {
		throw new Error(`Unsupported annotation companion version: ${String(companion.version)}`);
	}
	for (const annotation of companion.annotations) {
		validateAnnotation(annotation);
	}
	return [
		`version: ${annotationCompanionVersion}`,
		'annotations:',
		...companion.annotations.flatMap(annotation => [
			`  - id: ${JSON.stringify(annotation.id)}`,
			`    message: ${JSON.stringify(annotation.message)}`,
			`    preset: ${JSON.stringify(annotation.preset)}`,
			`    scope: ${JSON.stringify(annotation.scope)}`,
			'    anchor:',
			`      line: ${annotation.anchor.line}`,
			`      text: ${JSON.stringify(annotation.anchor.text)}`,
			`      before: ${JSON.stringify(annotation.anchor.before)}`,
			`      after: ${JSON.stringify(annotation.anchor.after)}`,
		]),
		'',
	].join('\n');
}

export function parseAnnotationAppendRequest(value: unknown): AnnotationAppendRequest {
	if (!isRecord(value)
		|| !isWorkspace(value.workspace)
		|| !isRecord(value.document)
		|| !isNonEmptyString(value.document.uri)
		|| !Number.isInteger(value.document.line)
		|| (value.document.line as number) < 0
		|| typeof value.document.text !== 'string'
		|| !isAnchorContext(value.document.before)
		|| !isAnchorContext(value.document.after)
		|| !isRecord(value.annotation)
		|| !isNonEmptyString(value.annotation.message)
		|| !isPromptPreset(value.annotation.preset)
		|| (value.annotation.scope !== 'line' && value.annotation.scope !== 'project')) {
		throw new Error('annotation append request must include workspace, document, and annotation context');
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
	if (!isRecord(value) || !isRecord(value.annotation) || !isNonEmptyString(value.annotation.id)) {
		throw new Error('annotation delete request must include workspace.cwd, document.uri, and annotation.id');
	}
	return { ...request, annotation: { id: value.annotation.id as string } };
}

async function readCompanionFile(companionPath: string): Promise<AnnotationCompanion> {
	try {
		return parseAnnotationCompanion(await readFile(companionPath, 'utf8'));
	} catch (error) {
		if (isNodeError(error) && error.code === 'ENOENT') {
			return { version: annotationCompanionVersion, annotations: [] };
		}
		throw error;
	}
}

async function writeCompanionFile(companionPath: string, companion: AnnotationCompanion): Promise<void> {
	const rendered = renderAnnotationCompanion(companion);
	await mkdir(path.dirname(companionPath), { recursive: true });
	const temporaryPath = `${companionPath}.tmp-${process.pid}-${randomUUID()}`;
	try {
		await writeFile(temporaryPath, rendered, { encoding: 'utf8', flag: 'wx' });
		await rename(temporaryPath, companionPath);
	} finally {
		await rm(temporaryPath, { force: true });
	}
}

function validateAnnotation(value: unknown): asserts value is UserAnnotation {
	if (!isRecord(value)
		|| !isNonEmptyString(value.id)
		|| !isNonEmptyString(value.message)
		|| !isPromptPreset(value.preset)
		|| (value.scope !== 'line' && value.scope !== 'project')
		|| !isRecord(value.anchor)
		|| !Number.isInteger(value.anchor.line)
		|| (value.anchor.line as number) < 0
		|| typeof value.anchor.text !== 'string'
		|| !isAnchorContext(value.anchor.before)
		|| !isAnchorContext(value.anchor.after)) {
		throw new Error('Invalid annotation companion: malformed annotation');
	}
}

function parseStringArrayField(line: string, prefix: string): readonly string[] {
	if (!line.startsWith(prefix)) {
		throw new Error(`Invalid annotation companion: expected ${prefix.trim()}`);
	}
	try {
		const value: unknown = JSON.parse(line.slice(prefix.length));
		if (isAnchorContext(value)) {
			return value;
		}
	} catch {
		// Report the stable companion validation error below.
	}
	throw new Error(`Invalid annotation companion: ${prefix.trim()} must contain up to three non-empty strings`);
}

function parseQuotedField(line: string, prefix: string): string {
	if (!line.startsWith(prefix)) {
		throw new Error(`Invalid annotation companion: expected ${prefix.trim()}`);
	}
	try {
		const value: unknown = JSON.parse(line.slice(prefix.length));
		if (typeof value === 'string') {
			return value;
		}
	} catch {
		// Report the stable companion validation error below.
	}
	throw new Error(`Invalid annotation companion: ${prefix.trim()} must be a quoted string`);
}

function parseIntegerField(line: string, prefix: string): number {
	if (!line.startsWith(prefix) || !/^\d+$/.test(line.slice(prefix.length))) {
		throw new Error(`Invalid annotation companion: ${prefix.trim()} must be a non-negative integer`);
	}
	return Number(line.slice(prefix.length));
}

function isWorkspace(value: unknown): value is { readonly cwd: string } {
	return isRecord(value) && isNonEmptyString(value.cwd);
}

function isPromptPreset(value: unknown): value is string {
	return typeof value === 'string' && /^%(Q|F|W|R|C|T)$/.test(value);
}

function isAnchorContext(value: unknown): value is readonly string[] {
	return Array.isArray(value)
		&& value.length <= 3
		&& value.every(line => typeof line === 'string' && line.trim() !== '');
}

function isNonEmptyString(value: unknown): value is string {
	return typeof value === 'string' && value.trim() !== '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
	return error instanceof Error && 'code' in error;
}
