import { promptPresets, type PromptPreset, type PromptScope } from './promptCommand';

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
	readonly message: string;
	readonly preset: PromptPreset;
	readonly scope: PromptScope;
	readonly anchor: AnnotationAnchor;
	readonly officialResponses: readonly OfficialResponse[];
	readonly agentAnnotations: readonly AnnotationLink[];
}

export interface AgentFileAnnotation {
	readonly kind: 'agent';
	readonly id: string;
	readonly agentId: string;
	readonly agentSessionId: string;
	readonly body: string;
	readonly createdAt: string;
	readonly anchor: AnnotationAnchor;
	readonly userAnnotation: AnnotationLink;
}

export type Annotation = UserAnnotation | AgentFileAnnotation;

export interface AnnotationCompanion {
	readonly version: 3;
	readonly annotations: readonly Annotation[];
}

export interface AnnotationAppendRequest {
	readonly workspace: { readonly cwd: string };
	readonly document: { readonly uri: string; readonly line: number };
	readonly annotation: {
		readonly id?: string;
		readonly message: string;
		readonly preset: PromptPreset;
		readonly scope: PromptScope;
	};
}

export interface AnnotationReadRequest {
	readonly workspace: { readonly cwd: string };
	readonly document: { readonly uri: string };
}

export interface AnnotationDeleteRequest extends AnnotationReadRequest {
	readonly annotation: { readonly id: string };
}

export function parseAnnotation(value: unknown): Annotation {
	if (!isAnnotation(value)) { throw new Error('Sundial Editor CLI returned a malformed annotation.'); }
	return value;
}

export function parseAnnotationCompanion(value: unknown): AnnotationCompanion {
	if (!isRecord(value) || value.version !== 3 || !Array.isArray(value.annotations)
		|| !value.annotations.every(isAnnotation)
		|| new Set(value.annotations.map(annotation => (annotation as Annotation).id)).size !== value.annotations.length) {
		throw new Error('Sundial Editor CLI returned a malformed annotation companion.');
	}
	return value as unknown as AnnotationCompanion;
}

export function isAnnotation(value: unknown): value is Annotation {
	if (!isRecord(value) || !isOpaqueId(value.id) || !isAnchor(value.anchor)) { return false; }
	if (value.kind === 'user') {
		return typeof value.message === 'string' && value.message.trim() !== ''
			&& typeof value.preset === 'string' && (promptPresets as readonly string[]).includes(value.preset)
			&& (value.scope === 'line' || value.scope === 'project')
			&& Array.isArray(value.officialResponses) && value.officialResponses.every(response => isOfficialResponse(response, value.id as string))
			&& Array.isArray(value.agentAnnotations) && value.agentAnnotations.every(isAnnotationLink);
	}
	return value.kind === 'agent' && isOpaqueId(value.agentId) && isOpaqueId(value.agentSessionId)
		&& typeof value.body === 'string' && value.body.trim() !== '' && !/[\0\r]/.test(value.body)
		&& isCanonicalTimestamp(value.createdAt) && isAnnotationLink(value.userAnnotation);
}

export function isUserAnnotation(value: unknown): value is UserAnnotation {
	return isAnnotation(value) && value.kind === 'user';
}

function isOfficialResponse(value: unknown, expectedId: string): value is OfficialResponse {
	return isRecord(value) && value.userAnnotationId === expectedId && isOpaqueId(value.userAnnotationId)
		&& isOpaqueId(value.agentId) && isOpaqueId(value.agentSessionId) && typeof value.body === 'string'
		&& value.body.trim() !== '' && !/[\0\r]/.test(value.body) && isCanonicalTimestamp(value.createdAt);
}

function isAnchor(value: unknown): value is AnnotationAnchor {
	return isRecord(value) && Number.isSafeInteger(value.line) && (value.line as number) >= 0
		&& typeof value.text === 'string' && !/[\r\n]/.test(value.text)
		&& isAnchorContext(value.before) && isAnchorContext(value.after);
}

function isAnnotationLink(value: unknown): value is AnnotationLink {
	return isRecord(value) && isOpaqueId(value.annotationId) && typeof value.file === 'string'
		&& value.file.trim() !== '' && !value.file.split(/[\\/]/).some(segment => segment === '' || segment === '.' || segment === '..')
		&& Number.isSafeInteger(value.line) && (value.line as number) >= 0;
}

function isOpaqueId(value: unknown): value is string { return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value); }
function isCanonicalTimestamp(value: unknown): value is string { return typeof value === 'string' && value !== '' && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString() === value; }
function isAnchorContext(value: unknown): value is readonly string[] { return Array.isArray(value) && value.length <= 3 && value.every(line => typeof line === 'string' && line.trim() !== '' && !/[\r\n]/.test(line)); }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
