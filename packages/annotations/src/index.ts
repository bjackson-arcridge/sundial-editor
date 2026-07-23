export const currentAnnotationCompanionVersion = 5;
export const annotationPromptPresets = ['%Q', '%F', '%W', '%R', '%C', '%T'] as const;

export type AnnotationPromptPreset = typeof annotationPromptPresets[number];
export type AnnotationPromptScope = 'line' | 'project';

export interface AnnotationAnchor {
	readonly line: number | null;
	readonly text: string;
	readonly before: readonly string[];
	readonly after: readonly string[];
}

export interface AnnotationLink {
	readonly annotationId: string;
	readonly file: string;
	readonly line: number | null;
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
	readonly preset: AnnotationPromptPreset;
	readonly scope: AnnotationPromptScope;
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
	readonly sourceDigest: string;
	readonly annotations: readonly Annotation[];
}

export interface AnnotationReadResult extends AnnotationCompanion {
	readonly currentPermanentCommit: string;
	readonly currentPermanentAnnotationIds: readonly string[];
}

export interface AnnotationListRequest {
	readonly workspace: { readonly cwd: string };
}

export interface AnnotationListItem {
	readonly id: string;
	readonly message: string;
	readonly line: number | null;
	readonly currentPermanent: boolean;
}

export interface AnnotationListGroup {
	readonly file: string;
	readonly annotations: readonly AnnotationListItem[];
}

export interface AnnotationListResult {
	readonly currentPermanentCommit: string;
	readonly groups: readonly AnnotationListGroup[];
}

export interface AnnotationAppendRequest {
	readonly workspace: { readonly cwd: string };
	readonly document: { readonly uri: string; readonly line: number };
	readonly annotation: {
		readonly id?: string;
		readonly message: string;
		readonly preset: AnnotationPromptPreset;
		readonly scope: AnnotationPromptScope;
	};
}

export interface AnnotationReadRequest {
	readonly workspace: { readonly cwd: string };
	readonly document: { readonly uri: string };
}

export interface AnnotationDeleteRequest extends AnnotationReadRequest {
	readonly annotation: { readonly id: string };
}

export interface AnnotationReanchorRequest extends AnnotationReadRequest {
	readonly previousSource: string;
	readonly expectedPreviousSourceDigest: string;
}

export interface AnnotationReanchorResult {
	readonly companion: AnnotationReadResult;
	readonly changedAnnotationIds: readonly string[];
	readonly fileScopedAnnotationIds: readonly string[];
	readonly affectedPaths: readonly string[];
	readonly alreadyApplied: boolean;
}

export interface CompanionMoveRepair {
	readonly kind: 'move';
	readonly source: string;
	readonly destination: string;
	readonly companion: string;
	readonly destinationCompanion: string;
	readonly linkedCompanions?: readonly string[];
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

export function emptyAnnotationCompanion(sourceDigest: string): AnnotationCompanion {
	if (!isContentDigest(sourceDigest)) { throw new Error('Invalid annotation companion: malformed source digest'); }
	return { version: currentAnnotationCompanionVersion, sourceDigest, annotations: [] };
}

export function parseAnnotationCompanionText(text: string): AnnotationCompanion {
	const lines = text.replace(/\r\n?/g, '\n').split('\n');
	if (lines.at(-1) === '') { lines.pop(); }
	if (lines[0] !== `version: ${currentAnnotationCompanionVersion}` || !/^sourceDigest: [0-9a-f]{64}$/.test(lines[1] ?? '')
		|| lines[2] !== 'annotations:') {
		throw new Error(`Invalid annotation companion: expected version ${currentAnnotationCompanionVersion}`);
	}
	const annotations = lines.slice(3).map((line, index) => {
		if (!line.startsWith('  - ')) {
			throw new Error(`Invalid annotation companion: malformed annotation at index ${index}`);
		}
		let value: unknown;
		try { value = JSON.parse(line.slice(4)); }
		catch { throw new Error(`Invalid annotation companion: malformed annotation at index ${index}`); }
		assertAnnotation(value);
		return value;
	});
	if (new Set(annotations.map(annotation => annotation.id)).size !== annotations.length) {
		throw new Error('Invalid annotation companion: annotation IDs must be unique');
	}
	return { version: currentAnnotationCompanionVersion, sourceDigest: lines[1].slice('sourceDigest: '.length), annotations };
}

export function renderAnnotationCompanion(companion: AnnotationCompanion): string {
	assertAnnotationCompanion(companion);
	return [
		`version: ${currentAnnotationCompanionVersion}`,
		`sourceDigest: ${companion.sourceDigest}`,
		'annotations:',
		...companion.annotations.map(annotation => `  - ${JSON.stringify(annotation)}`),
		'',
	].join('\n');
}

export function assertAnnotationCompanion(value: unknown): asserts value is AnnotationCompanion {
	if (!isRecord(value) || value.version !== currentAnnotationCompanionVersion || !isContentDigest(value.sourceDigest)
		|| !Array.isArray(value.annotations) || !value.annotations.every(isAnnotation)
		|| new Set(value.annotations.map(annotation => (annotation as Annotation).id)).size !== value.annotations.length) {
		throw new Error('Invalid annotation companion.');
	}
}

export function parseAnnotation(value: unknown): Annotation {
	assertAnnotation(value);
	return value;
}

export function parseAnnotationReadResult(value: unknown): AnnotationReadResult {
	if (!isRecord(value) || value.version !== currentAnnotationCompanionVersion || !isContentDigest(value.sourceDigest)
		|| !Array.isArray(value.annotations) || !value.annotations.every(isAnnotation)
		|| new Set(value.annotations.map(annotation => (annotation as Annotation).id)).size !== value.annotations.length
		|| !isCommitHash(value.currentPermanentCommit) || !Array.isArray(value.currentPermanentAnnotationIds)
		|| !value.currentPermanentAnnotationIds.every(isOpaqueId)
		|| JSON.stringify(value.currentPermanentAnnotationIds) !== JSON.stringify((value.annotations as Annotation[])
			.filter(annotation => annotation.permanentBaseCommit === value.currentPermanentCommit)
			.map(annotation => annotation.id))) {
		throw new Error('Invalid annotation read result.');
	}
	return value as unknown as AnnotationReadResult;
}

export function parseAnnotationListResult(value: unknown): AnnotationListResult {
	if (!isRecord(value) || !hasExactKeys(value, ['currentPermanentCommit', 'groups'])
		|| !isCommitHash(value.currentPermanentCommit) || !Array.isArray(value.groups)
		|| !value.groups.every(isAnnotationListGroup)) {
		throw new Error('Invalid annotation list result.');
	}
	const groups = value.groups as AnnotationListGroup[];
	const files = groups.map(group => group.file);
	const annotationIds = groups.flatMap(group => group.annotations.map(annotation => annotation.id));
	if (new Set(files).size !== files.length || new Set(annotationIds).size !== annotationIds.length) {
		throw new Error('Invalid annotation list result.');
	}
	return value as unknown as AnnotationListResult;
}

export function parseAnnotationReanchorResult(value: unknown): AnnotationReanchorResult {
	if (!isRecord(value) || !Array.isArray(value.changedAnnotationIds) || !value.changedAnnotationIds.every(isOpaqueId)
		|| !Array.isArray(value.fileScopedAnnotationIds) || !value.fileScopedAnnotationIds.every(isOpaqueId)
		|| !Array.isArray(value.affectedPaths) || !value.affectedPaths.every(isNonEmptyString)
		|| typeof value.alreadyApplied !== 'boolean') {
		throw new Error('Invalid annotation re-anchor result.');
	}
	return {
		companion: parseAnnotationReadResult(value.companion),
		changedAnnotationIds: value.changedAnnotationIds,
		fileScopedAnnotationIds: value.fileScopedAnnotationIds,
		affectedPaths: value.affectedPaths,
		alreadyApplied: value.alreadyApplied,
	};
}

export function parseCompanionRepairResult(value: unknown): CompanionRepairResult {
	if (!isRecord(value) || !Array.isArray(value.actions) || !value.actions.every(isCompanionRepairAction)
		|| !Array.isArray(value.affectedPaths) || !value.affectedPaths.every(isNonEmptyString)) {
		throw new Error('Invalid companion repair result.');
	}
	return value as unknown as CompanionRepairResult;
}

export function assertAnnotation(value: unknown): asserts value is Annotation {
	if (!isAnnotation(value)) { throw new Error('Invalid annotation companion: malformed annotation'); }
}

export function isAnnotation(value: unknown): value is Annotation {
	if (!isRecord(value) || !isOpaqueId(value.id) || !isCommitHash(value.permanentBaseCommit) || !isAnchor(value.anchor)) { return false; }
	if (value.kind === 'user') {
		return isNonEmptyString(value.message) && isAnnotationPromptPreset(value.preset)
			&& (value.scope === 'line' || value.scope === 'project')
			&& Array.isArray(value.officialResponses) && value.officialResponses.every(response => isOfficialResponse(response, value.id as string))
			&& Array.isArray(value.agentAnnotations) && value.agentAnnotations.every(isAnnotationLink)
			&& new Set(value.agentAnnotations.map(link => (link as AnnotationLink).annotationId)).size === value.agentAnnotations.length;
	}
	return value.kind === 'agent' && isOpaqueId(value.agentId) && isOpaqueId(value.agentSessionId)
		&& typeof value.body === 'string' && value.body.trim() !== '' && !/[\0\r]/.test(value.body)
		&& isCanonicalTimestamp(value.createdAt) && isAnnotationLink(value.userAnnotation);
}

export function isUserAnnotation(value: unknown): value is UserAnnotation {
	return isAnnotation(value) && value.kind === 'user';
}

export function isAnnotationPromptPreset(value: unknown): value is AnnotationPromptPreset {
	return typeof value === 'string' && (annotationPromptPresets as readonly string[]).includes(value);
}

export function isContentDigest(value: unknown): value is string {
	return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

export function isOpaqueId(value: unknown): value is string {
	return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value);
}

export function isSafeRelativeFile(value: unknown): value is string {
	return typeof value === 'string' && value.trim() !== '' && !value.startsWith('/') && !value.startsWith('\\')
		&& !/^[A-Za-z]:[\\/]/.test(value)
		&& !value.split(/[\\/]/u).some(segment => segment === '' || segment === '.' || segment === '..');
}

function isCompanionRepairAction(value: unknown): value is CompanionRepairAction {
	if (!isRecord(value) || (value.kind !== 'move' && value.kind !== 'delete')
		|| !nonEmptyStrings(value, ['source', 'companion'])) { return false; }
	return value.kind === 'delete' || (nonEmptyStrings(value, ['destination', 'destinationCompanion'])
		&& (value.linkedCompanions === undefined
			|| (Array.isArray(value.linkedCompanions) && value.linkedCompanions.every(isNonEmptyString))));
}

function isOfficialResponse(value: unknown, expectedId: string): value is OfficialResponse {
	return isRecord(value) && value.userAnnotationId === expectedId && isOpaqueId(value.userAnnotationId)
		&& isOpaqueId(value.agentId) && isOpaqueId(value.agentSessionId) && typeof value.body === 'string'
		&& value.body.trim() !== '' && !/[\0\r]/.test(value.body) && isCanonicalTimestamp(value.createdAt);
}

function isAnchor(value: unknown): value is AnnotationAnchor {
	return isRecord(value) && isNullableLine(value.line) && typeof value.text === 'string' && !/[\r\n]/.test(value.text)
		&& isAnchorContext(value.before) && isAnchorContext(value.after);
}

function isAnnotationLink(value: unknown): value is AnnotationLink {
	return isRecord(value) && isOpaqueId(value.annotationId) && isSafeRelativeFile(value.file) && isNullableLine(value.line);
}

function isNullableLine(value: unknown): value is number | null {
	return value === null || (Number.isSafeInteger(value) && (value as number) >= 0);
}

function isAnchorContext(value: unknown): value is readonly string[] {
	return Array.isArray(value) && value.length <= 3
		&& value.every(line => typeof line === 'string' && line.trim() !== '' && !/[\r\n]/.test(line));
}

function isCanonicalTimestamp(value: unknown): value is string {
	return typeof value === 'string' && value !== '' && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString() === value;
}

function isCommitHash(value: unknown): value is string {
	return typeof value === 'string' && /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(value);
}

function isAnnotationListGroup(value: unknown): value is AnnotationListGroup {
	return isRecord(value) && hasExactKeys(value, ['file', 'annotations'])
		&& isSafeRelativeFile(value.file) && value.file !== '.sundial' && !String(value.file).startsWith('.sundial/')
		&& Array.isArray(value.annotations) && value.annotations.length > 0
		&& value.annotations.every(isAnnotationListItem)
		&& new Set(value.annotations.map(annotation => (annotation as AnnotationListItem).id)).size === value.annotations.length;
}

function isAnnotationListItem(value: unknown): value is AnnotationListItem {
	return isRecord(value) && hasExactKeys(value, ['id', 'message', 'line', 'currentPermanent'])
		&& isOpaqueId(value.id) && isNonEmptyString(value.message) && isNullableLine(value.line)
		&& typeof value.currentPermanent === 'boolean';
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
	return Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}

function nonEmptyStrings(value: Record<string, unknown>, fields: readonly string[]): boolean {
	return fields.every(field => isNonEmptyString(value[field]));
}

function isNonEmptyString(value: unknown): value is string {
	return typeof value === 'string' && value.trim() !== '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
