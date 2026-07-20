import { promptPresets, type PromptPreset, type PromptScope } from './promptCommand';

export interface UserAnnotation {
	readonly id: string;
	readonly message: string;
	readonly preset: PromptPreset;
	readonly scope: PromptScope;
	readonly anchor: {
		readonly line: number;
		readonly text: string;
		readonly before: readonly string[];
		readonly after: readonly string[];
	};
	readonly officialResponses: readonly OfficialResponse[];
}

export interface OfficialResponse {
	readonly userAnnotationId: string;
	readonly agentId: string;
	readonly agentSessionId: string;
	readonly body: string;
	readonly createdAt: string;
}

export interface AnnotationCompanion {
	readonly version: 1 | 2;
	readonly annotations: readonly UserAnnotation[];
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

export function parseUserAnnotation(value: unknown): UserAnnotation {
	if (!isUserAnnotation(value)) {
		throw new Error('Sundial Editor CLI returned a malformed annotation.');
	}
	return value;
}

export function parseAnnotationCompanion(value: unknown): AnnotationCompanion {
	if (!isRecord(value)
			|| (value.version !== 1 && value.version !== 2)
			|| !Array.isArray(value.annotations)
			|| !value.annotations.every(isUserAnnotation)
			|| (value.version === 1 && value.annotations.some(annotation => annotation.officialResponses.length > 0))) {
		throw new Error('Sundial Editor CLI returned a malformed annotation companion.');
	}
	return value as unknown as AnnotationCompanion;
}

export function isUserAnnotation(value: unknown): value is UserAnnotation {
	return isRecord(value)
		&& typeof value.id === 'string'
		&& value.id !== ''
		&& typeof value.message === 'string'
		&& value.message.trim() !== ''
		&& typeof value.preset === 'string'
		&& (promptPresets as readonly string[]).includes(value.preset)
		&& (value.scope === 'line' || value.scope === 'project')
		&& isRecord(value.anchor)
		&& Number.isInteger(value.anchor.line)
		&& (value.anchor.line as number) >= 0
		&& typeof value.anchor.text === 'string'
		&& isAnchorContext(value.anchor.before)
		&& isAnchorContext(value.anchor.after)
		&& Array.isArray(value.officialResponses)
		&& value.officialResponses.every(response => isOfficialResponse(response, value.id as string));
}

function isOfficialResponse(value: unknown, expectedId: string): value is OfficialResponse {
	return isRecord(value)
		&& value.userAnnotationId === expectedId
		&& isOpaqueId(value.userAnnotationId)
		&& isOpaqueId(value.agentId)
		&& isOpaqueId(value.agentSessionId)
		&& typeof value.body === 'string'
		&& value.body.trim() !== ''
		&& !value.body.includes('\0')
		&& !value.body.includes('\r')
		&& typeof value.createdAt === 'string'
		&& value.createdAt !== ''
		&& !Number.isNaN(Date.parse(value.createdAt))
		&& new Date(value.createdAt).toISOString() === value.createdAt;
}

function isOpaqueId(value: unknown): value is string {
	return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value);
}

function isAnchorContext(value: unknown): value is readonly string[] {
	return Array.isArray(value)
		&& value.length <= 3
		&& value.every(line => typeof line === 'string' && line.trim() !== '');
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}
