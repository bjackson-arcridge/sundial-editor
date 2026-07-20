export const agentStatuses = ['waiting', 'working', 'blocked'] as const;
export type AgentStatus = typeof agentStatuses[number];

export interface LegacyPromptRequest {
	readonly provider: 'codex';
	readonly model?: string;
	readonly workspace: { readonly cwd: string };
	readonly document: {
		readonly uri: string;
		readonly line: number;
		readonly text: string;
	};
	readonly prompt: {
		readonly preset: string;
		readonly scope: 'line' | 'project';
		readonly text: string;
	};
}

export interface ManagedPromptRequest {
	readonly provider: 'codex';
	readonly model?: string;
	readonly workspace: { readonly cwd: string };
	readonly managed: {
		readonly agentId: string;
		readonly agentSessionId: string;
		readonly userAnnotationId: string;
		readonly assignmentSequence: number;
	};
}

/** Retained public name for the compatibility prompt protocol. */
export type PromptRequest = LegacyPromptRequest;
export type CliPromptRequest = PromptRequest | ManagedPromptRequest;

export type AgentEvent =
	| { readonly kind: 'status'; readonly status: AgentStatus; readonly message?: string }
	| { readonly kind: 'output'; readonly text: string }
	| { readonly kind: 'error'; readonly message: string; readonly recoverable: boolean };

export function parsePromptRequest(value: unknown): PromptRequest {
	if (!isRecord(value) || value.provider !== 'codex') {
		throw new Error('provider must be "codex"');
	}
	if (!isRecord(value.workspace) || !isNonEmptyString(value.workspace.cwd)) {
		throw new Error('workspace.cwd must be a non-empty string');
	}
	if (value.model !== undefined && !isNonEmptyString(value.model)) {
		throw new Error('model must be a non-empty string when provided');
	}
	if (!isRecord(value.document)
		|| !isNonEmptyString(value.document.uri)
		|| !Number.isInteger(value.document.line)
		|| (value.document.line as number) < 0
		|| typeof value.document.text !== 'string') {
		throw new Error('document must include uri, non-negative line, and text');
	}
	if (!isRecord(value.prompt)
		|| !isNonEmptyString(value.prompt.preset)
		|| (value.prompt.scope !== 'line' && value.prompt.scope !== 'project')
		|| !isNonEmptyString(value.prompt.text)) {
		throw new Error('prompt must include preset, scope, and non-empty text');
	}
	return value as unknown as LegacyPromptRequest;
}

export function parseCliPromptRequest(value: unknown): CliPromptRequest {
	if (isRecord(value) && isRecord(value.managed)) {
		if (value.provider !== 'codex') {
			throw new Error('provider must be "codex"');
		}
		if (!isRecord(value.workspace) || !isNonEmptyString(value.workspace.cwd)) {
			throw new Error('workspace.cwd must be a non-empty string');
		}
		if (value.model !== undefined && !isNonEmptyString(value.model)) {
			throw new Error('model must be a non-empty string when provided');
		}
		if (!isNonEmptyString(value.managed.agentId)
			|| !isNonEmptyString(value.managed.agentSessionId)
			|| !isNonEmptyString(value.managed.userAnnotationId)
			|| !Number.isSafeInteger(value.managed.assignmentSequence)
			|| (value.managed.assignmentSequence as number) < 1) {
			throw new Error('managed prompt must include agentId, agentSessionId, userAnnotationId, and a positive assignmentSequence');
		}
		return value as unknown as ManagedPromptRequest;
	}
	return parsePromptRequest(value);
}

export function isManagedPromptRequest(request: CliPromptRequest): request is ManagedPromptRequest {
	return 'managed' in request;
}

export function renderEvent(event: AgentEvent): string {
	return JSON.stringify(event);
}

function isNonEmptyString(value: unknown): value is string {
	return typeof value === 'string' && value.trim() !== '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}
