import { promptPresets, type PromptContext, type PromptPreset, type PromptScope } from '../../promptCommand.js';
import type { AgentEvent, AgentStatus } from '../../agentProtocol.js';
import { isUserAnnotation, type UserAnnotation } from '../../annotationProtocol.js';

export interface AgentRunState {
	readonly status: AgentStatus;
	readonly events: readonly AgentEvent[];
}

export interface MessagesState {
	readonly prompt?: PromptContext;
	readonly draft?: string;
	readonly submitted?: true;
	readonly annotationSaved?: true;
	readonly deliveryComplete?: true;
	readonly run?: AgentRunState;
	readonly annotationViewer?: AnnotationViewerState;
}

export interface AnnotationViewerState {
	readonly sourceUri: string;
	readonly annotation: UserAnnotation;
	readonly position: number;
	readonly total: number;
	readonly pinned: boolean;
	readonly canPrevious: boolean;
	readonly canNext: boolean;
}

export function annotationForLine(
	annotations: readonly UserAnnotation[],
	line: number,
	preferredId?: string,
): UserAnnotation | undefined {
	const onLine = annotations.filter(annotation => annotation.anchor.line === line);
	return onLine.find(annotation => annotation.id === preferredId) ?? onLine[0];
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
	| { kind: 'cancel' }
	| { kind: 'previousAnnotation' }
	| { kind: 'nextAnnotation' }
	| { kind: 'toggleAnnotationPin' }
	| { kind: 'deleteAnnotation' };

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
		if (state.draft !== undefined || state.submitted !== undefined || state.annotationSaved !== undefined || state.deliveryComplete !== undefined) {
			return false;
		}
	} else if (!isPromptContext(state.prompt)
		|| typeof state.draft !== 'string'
		|| (state.submitted !== undefined && state.submitted !== true)
		|| (state.annotationSaved !== undefined && state.annotationSaved !== true)
		|| (state.deliveryComplete !== undefined && state.deliveryComplete !== true)) {
		return false;
	}
	return (state.run === undefined || isAgentRunState(state.run))
		&& (state.annotationViewer === undefined || isAnnotationViewerState(state.annotationViewer));
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
		|| value.kind === 'cancel'
		|| value.kind === 'previousAnnotation'
		|| value.kind === 'nextAnnotation'
		|| value.kind === 'toggleAnnotationPin'
		|| value.kind === 'deleteAnnotation';
}

function isAnnotationViewerState(value: unknown): boolean {
	return isRecord(value)
		&& typeof value.sourceUri === 'string'
		&& isUserAnnotation(value.annotation)
		&& Number.isInteger(value.position)
		&& (value.position as number) >= 1
		&& Number.isInteger(value.total)
		&& (value.total as number) >= (value.position as number)
		&& typeof value.pinned === 'boolean'
		&& typeof value.canPrevious === 'boolean'
		&& typeof value.canNext === 'boolean';
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
		&& typeof value.sourceText === 'string'
		&& typeof value.anchorText === 'string'
		&& isStringArray(value.anchorBefore)
		&& isStringArray(value.anchorAfter);
}

function isStringArray(value: unknown): value is readonly string[] {
	return Array.isArray(value)
		&& value.length <= 3
		&& value.every(line => typeof line === 'string' && line.trim() !== '');
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
