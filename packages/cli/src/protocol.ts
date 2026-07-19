export const agentStatuses = ['waiting', 'working', 'blocked'] as const;
export type AgentStatus = typeof agentStatuses[number];

export interface PromptRequest {
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
	if (value.model !== undefined && !isNonEmptyString(value.model)) {
		throw new Error('model must be a non-empty string when provided');
	}
	return value as unknown as PromptRequest;
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
