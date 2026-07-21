export const agentStatuses = ['waiting', 'working', 'blocked'] as const;
export type AgentStatus = typeof agentStatuses[number];

export interface PromptRequest {
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

export type AgentEvent =
	| { readonly kind: 'status'; readonly status: AgentStatus; readonly message?: string }
	| { readonly kind: 'output'; readonly text: string }
	| { readonly kind: 'error'; readonly message: string; readonly recoverable: boolean };

export function parsePromptRequest(value: unknown): PromptRequest {
	if (!isRecord(value) || value.provider !== 'codex') { throw new Error('provider must be "codex"'); }
	if (!isRecord(value.workspace) || !isNonEmptyString(value.workspace.cwd)) {
		throw new Error('workspace.cwd must be a non-empty string');
	}
	if (value.model !== undefined && !isNonEmptyString(value.model)) {
		throw new Error('model must be a non-empty string when provided');
	}
	if (!isRecord(value.managed) || !isNonEmptyString(value.managed.agentId)
		|| !isNonEmptyString(value.managed.agentSessionId) || !isNonEmptyString(value.managed.userAnnotationId)
		|| !Number.isSafeInteger(value.managed.assignmentSequence) || (value.managed.assignmentSequence as number) < 1) {
		throw new Error('managed prompt must include agentId, agentSessionId, userAnnotationId, and a positive assignmentSequence');
	}
	return value as unknown as PromptRequest;
}

export function renderEvent(event: AgentEvent): string { return JSON.stringify(event); }
function isNonEmptyString(value: unknown): value is string { return typeof value === 'string' && value.trim() !== ''; }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
