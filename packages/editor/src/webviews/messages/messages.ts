import { promptPresets, type PromptContext, type PromptPreset, type PromptScope } from '../../promptCommand.js';
import type { AgentEvent, AgentStatus } from '../../agentProtocol.js';

export interface AgentRunState {
	readonly status: AgentStatus;
	readonly events: readonly AgentEvent[];
}

export interface MessagesState {
	readonly prompt?: PromptContext;
	readonly draft?: string;
	readonly run?: AgentRunState;
}

export function appendAgentEvent(events: readonly AgentEvent[], event: AgentEvent): readonly AgentEvent[] {
	const previous = events.at(-1);
	if (event.kind === 'output' && previous?.kind === 'output') {
		return [
			...events.slice(0, -1),
			{ kind: 'output', text: previous.text + event.text },
		];
	}
	return [...events, event];
}

export type HostToWebview =
	| { kind: 'state'; state: MessagesState }
	| { kind: 'focusComposer' };

export type WebviewToHost =
	| { kind: 'submit'; message: string }
	| { kind: 'cancel' };

export function isValidHostToWebviewMessage(value: unknown): value is HostToWebview {
	if (!isRecord(value)) {
		return false;
	}

	if (value.kind === 'focusComposer') {
		return true;
	}

	if (value.kind !== 'state' || !isRecord(value.state)) {
		return false;
	}
	const state = value.state;
	if (state.prompt === undefined) {
		if (state.draft !== undefined) {
			return false;
		}
	} else if (!isPromptContext(state.prompt) || typeof state.draft !== 'string') {
		return false;
	}
	return state.run === undefined || isAgentRunState(state.run);
}

function isAgentRunState(value: unknown): boolean {
	if (!isRecord(value)
		|| (value.status !== 'waiting' && value.status !== 'working' && value.status !== 'blocked')
		|| !Array.isArray(value.events)) {
		return false;
	}
	return value.events.every(isAgentEvent);
}

function isAgentEvent(value: unknown): boolean {
	if (!isRecord(value)) {
		return false;
	}
	return (value.kind === 'status'
			&& (value.status === 'waiting' || value.status === 'working' || value.status === 'blocked')
			&& (value.message === undefined || typeof value.message === 'string'))
		|| (value.kind === 'output' && typeof value.text === 'string')
		|| (value.kind === 'error' && typeof value.message === 'string' && typeof value.recoverable === 'boolean');
}

export function isValidWebviewToHostMessage(value: unknown): value is WebviewToHost {
	if (!isRecord(value)) {
		return false;
	}

	return (value.kind === 'submit' && typeof value.message === 'string')
		|| value.kind === 'cancel';
}

function isPromptContext(value: unknown): value is PromptContext {
	if (!isRecord(value)) {
		return false;
	}

	return isPromptPreset(value.preset)
		&& isPromptScope(value.scope)
		&& typeof value.sourceUri === 'string'
		&& typeof value.sourceLine === 'number'
		&& Number.isInteger(value.sourceLine)
		&& value.sourceLine >= 0
		&& typeof value.sourceText === 'string';
}

function isPromptPreset(value: unknown): value is PromptPreset {
	return typeof value === 'string' && (promptPresets as readonly string[]).includes(value);
}

function isPromptScope(value: unknown): value is PromptScope {
	return value === 'line' || value === 'project';
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}
