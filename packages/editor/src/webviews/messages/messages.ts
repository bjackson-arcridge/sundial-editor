import {
	isAgentId,
	isAgentsViewState,
	isAgentTranscriptViewState,
	isUserAnnotationId,
	isUserAnnotationWorkItem,
	type AgentId,
	type AgentsViewState,
	type AgentTranscriptViewState,
	type UserAnnotationId,
	type UserAnnotationWorkItem,
} from '../../agentProtocol.js';
import { isUserAnnotation, type UserAnnotation } from '../../annotationProtocol.js';
import { promptPresets, type PromptContext, type PromptPreset, type PromptScope } from '../../promptCommand.js';

export interface HostNotice {
	readonly tone: 'info' | 'error';
	readonly message: string;
}

interface MessagesStateBase {
	readonly agents: AgentsViewState;
	readonly work: readonly UserAnnotationWorkItem[];
	readonly busy?: boolean;
	readonly notice?: HostNotice;
	readonly transcript?: AgentTranscriptViewState;
	readonly annotationViewer?: AnnotationViewerState;
}

export type MessagesState = MessagesStateBase & (
	| {
		readonly prompt: PromptContext;
		readonly draft: string;
		readonly targetAgentId?: AgentId;
	}
	| {
		readonly prompt?: undefined;
		readonly draft?: undefined;
		readonly targetAgentId?: undefined;
	}
);

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

export function workForAgentInFifoOrder(
	work: readonly UserAnnotationWorkItem[],
	agentId: AgentId,
): readonly UserAnnotationWorkItem[] {
	return work
		.filter(item => item.agentId === agentId)
		.sort((left, right) => left.enqueuedAt.localeCompare(right.enqueuedAt) || left.id.localeCompare(right.id));
}

export type HostToWebview =
	| { readonly kind: 'state'; readonly state: MessagesState }
	| { readonly kind: 'focusComposer' };

export type WebviewToHost =
	| { readonly kind: 'submit'; readonly message: string; readonly targetAgentId: AgentId }
	| { readonly kind: 'selectTarget'; readonly targetAgentId: AgentId }
	| { readonly kind: 'cancel' }
	| { readonly kind: 'refresh' }
	| { readonly kind: 'renameAgent'; readonly agentId: AgentId; readonly name: string }
	| { readonly kind: 'showTranscript'; readonly agentId: AgentId }
	| { readonly kind: 'openAgent'; readonly agentId: AgentId }
	| { readonly kind: 'interruptAgent'; readonly agentId: AgentId }
	| { readonly kind: 'resetAgent'; readonly agentId: AgentId }
	| { readonly kind: 'previousAnnotation' }
	| { readonly kind: 'nextAnnotation' }
	| { readonly kind: 'toggleAnnotationPin' }
	| { readonly kind: 'deleteAnnotation' };

export function isValidHostToWebviewMessage(value: unknown): value is HostToWebview {
	if (!isRecord(value) || typeof value.kind !== 'string') {
		return false;
	}
	switch (value.kind) {
		case 'state':
			return hasExactKeys(value, ['kind', 'state']) && isMessagesState(value.state);
		case 'focusComposer':
			return hasExactKeys(value, ['kind']);
		default:
			return false;
	}
}

export function isValidWebviewToHostMessage(value: unknown): value is WebviewToHost {
	if (!isRecord(value) || typeof value.kind !== 'string') {
		return false;
	}
	switch (value.kind) {
		case 'submit':
			return hasExactKeys(value, ['kind', 'message', 'targetAgentId'])
				&& isNonEmptyString(value.message)
				&& isAgentId(value.targetAgentId);
		case 'selectTarget':
			return hasExactKeys(value, ['kind', 'targetAgentId']) && isAgentId(value.targetAgentId);
		case 'renameAgent':
			return hasExactKeys(value, ['kind', 'agentId', 'name'])
				&& isAgentId(value.agentId)
				&& isAgentName(value.name);
		case 'showTranscript':
		case 'openAgent':
		case 'interruptAgent':
		case 'resetAgent':
			return hasExactKeys(value, ['kind', 'agentId']) && isAgentId(value.agentId);
		case 'cancel':
		case 'refresh':
		case 'previousAnnotation':
		case 'nextAnnotation':
		case 'toggleAnnotationPin':
		case 'deleteAnnotation':
			return hasExactKeys(value, ['kind']);
		default:
			return false;
	}
}

function isMessagesState(value: unknown): value is MessagesState {
	if (!isRecord(value)
		|| !hasAllowedKeys(value, [
			'agents', 'work', 'prompt', 'draft', 'targetAgentId', 'busy', 'notice', 'transcript', 'annotationViewer',
		])
		|| !hasRequiredKeys(value, ['agents', 'work'])
		|| !isAgentsViewState(value.agents)
		|| !Array.isArray(value.work)
		|| !value.work.every(isUserAnnotationWorkItem)
		|| !hasUniqueWork(value.work)
		|| (value.busy !== undefined && typeof value.busy !== 'boolean')
		|| (value.notice !== undefined && !isNotice(value.notice))
		|| (value.transcript !== undefined && !isAgentTranscriptViewState(value.transcript))
		|| (value.annotationViewer !== undefined && !isAnnotationViewerState(value.annotationViewer))) {
		return false;
	}

	if (value.prompt === undefined) {
		if (value.draft !== undefined || value.targetAgentId !== undefined) {
			return false;
		}
	} else if (!isPromptContext(value.prompt)
		|| typeof value.draft !== 'string'
		|| (value.targetAgentId !== undefined && !isAgentId(value.targetAgentId))) {
		return false;
	}

	if (value.agents.kind !== 'ready') {
		return true;
	}
	const agentIds = new Set<AgentId>(value.agents.agents.map(agent => agent.id));
	return value.work.every(item => agentIds.has(item.agentId))
		&& (value.transcript === undefined || agentIds.has(value.transcript.agentId))
		&& (value.prompt === undefined || (value.targetAgentId !== undefined && agentIds.has(value.targetAgentId)));
}

function isNotice(value: unknown): value is HostNotice {
	return isRecord(value)
		&& hasExactKeys(value, ['tone', 'message'])
		&& (value.tone === 'info' || value.tone === 'error')
		&& isNonEmptyString(value.message);
}

function isAnnotationViewerState(value: unknown): value is AnnotationViewerState {
	return isRecord(value)
		&& hasExactKeys(value, [
			'sourceUri', 'annotation', 'position', 'total', 'pinned', 'canPrevious', 'canNext',
		])
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
	if (!isRecord(value)
		|| !hasAllowedKeys(value, [
			'preset', 'scope', 'targetSelector', 'sourceUri', 'sourceLine', 'sourceText', 'anchorText', 'anchorBefore', 'anchorAfter',
		])
		|| !hasRequiredKeys(value, [
			'preset', 'scope', 'sourceUri', 'sourceLine', 'sourceText', 'anchorText', 'anchorBefore', 'anchorAfter',
		])) {
		return false;
	}
	return isPromptPreset(value.preset)
		&& isPromptScope(value.scope)
		&& (value.targetSelector === undefined || isPromptTargetSelector(value.targetSelector))
		&& typeof value.sourceUri === 'string'
		&& Number.isInteger(value.sourceLine)
		&& (value.sourceLine as number) >= 0
		&& typeof value.sourceText === 'string'
		&& typeof value.anchorText === 'string'
		&& isStringArray(value.anchorBefore)
		&& isStringArray(value.anchorAfter);
}

function isPromptTargetSelector(value: unknown): boolean {
	return isRecord(value) && (
		(value.kind === 'slot'
			&& hasExactKeys(value, ['kind', 'slot'])
			&& Number.isSafeInteger(value.slot)
			&& (value.slot as number) >= 1)
		|| (value.kind === 'name'
			&& hasExactKeys(value, ['kind', 'name'])
			&& isAgentName(value.name))
	);
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

function isAgentName(value: unknown): value is string {
	return typeof value === 'string'
		&& value === value.trim()
		&& value !== ''
		&& !/[\r\n]/.test(value)
		&& [...value].length <= 80
		&& !/^\d+$/.test(value);
}

function hasUniqueWork(work: readonly UserAnnotationWorkItem[]): boolean {
	return new Set<UserAnnotationId>(work.map(item => item.id)).size === work.length
		&& work.every(item => isUserAnnotationId(item.id));
}

function isNonEmptyString(value: unknown): value is string {
	return typeof value === 'string' && value.trim() !== '';
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
	return hasAllowedKeys(value, keys) && hasRequiredKeys(value, keys);
}

function hasAllowedKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
	return Object.keys(value).every(key => keys.includes(key));
}

function hasRequiredKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
	return keys.every(key => Object.hasOwn(value, key));
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
