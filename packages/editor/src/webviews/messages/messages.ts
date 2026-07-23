import {
	isAgentId,
	isAgentsViewState,
	isUserAnnotationId,
	isUserAnnotationWorkItem,
	type AgentId,
	type AgentsViewState,
	type NamedAgent,
	type WorkUpdate,
	type UserAnnotationId,
	type UserAnnotationWorkItem,
} from '../../agentProtocol.js';
import { isAnnotation, type AgentFileAnnotation, type Annotation, type AnnotationLink, type UserAnnotation } from '../../annotationProtocol.js';
import type { ResponseContinuity } from '../../annotationResponse.js';
import { maximumPaneSplitPercent, minimumPaneSplitPercent } from '../../paneSplit.js';
import { promptPresets, type PromptContext, type PromptPreset, type PromptScope } from '../../promptCommand.js';
export interface HostNotice {
	readonly tone: 'info' | 'error';
	readonly message: string;
}

interface MessagesStateBase {
	readonly agents: AgentsViewState;
	readonly work: readonly UserAnnotationWorkItem[];
	readonly paneSplitPercent: number;
	readonly workflow: WorkflowPresentation;
	readonly busy?: boolean;
	readonly notice?: HostNotice;
	readonly annotationViewer?: AnnotationViewerState;
}

export interface WorkflowPresentation {
	readonly diffEnabled: boolean;
	readonly diffLayout: 'inline' | 'side-by-side';
	readonly annotationFilterEnabled: boolean;
	readonly baseline?: string;
	readonly currentPermanentCommit?: string;
}

export type MessagesState = MessagesStateBase & (
	| {
		readonly prompt: PromptContext;
		readonly draft: string;
		readonly targetAgentId?: AgentId;
		readonly response?: { readonly continuity: ResponseContinuity };
	}
	| {
		readonly prompt?: undefined;
		readonly draft?: undefined;
		readonly targetAgentId?: undefined;
		readonly response?: undefined;
	}
);

export interface AnnotationViewerState {
	readonly sourceUri: string;
	readonly annotation: PresentedAnnotation;
	readonly position: number;
	readonly total: number;
	readonly pinned: boolean;
	readonly canPrevious: boolean;
	readonly canNext: boolean;
}

export interface PresentedOfficialResponse {
	readonly body: string;
	readonly createdAt: string;
	readonly agentName: string;
}

export interface PresentedUserAnnotation extends Omit<UserAnnotation, 'officialResponses'> {
	readonly officialResponses: readonly PresentedOfficialResponse[];
}

export interface PresentedAgentAnnotation extends Omit<AgentFileAnnotation, 'agentSessionId'> {
	readonly agentName: string;
}

export type PresentedAnnotation = PresentedUserAnnotation | PresentedAgentAnnotation;

export function presentAnnotation(annotation: Annotation, agents: readonly NamedAgent[]): PresentedAnnotation {
	if (annotation.kind === 'agent') {
		const { agentSessionId: _agentSessionId, ...safe } = annotation;
		return { ...safe, agentName: agents.find(agent => agent.id === annotation.agentId)?.name ?? 'Unknown agent' };
	}
	return { ...annotation, officialResponses: annotation.officialResponses.map(response => ({
		body: response.body, createdAt: response.createdAt,
		agentName: agents.find(agent => agent.id === response.agentId)?.name ?? 'Unknown agent',
	})) };
}

export function annotationForLine(
	annotations: readonly Annotation[],
	line: number,
	preferredId?: string,
): Annotation | undefined {
	const onLine = annotations.filter(annotation => annotation.anchor.line === line);
	return onLine.find(annotation => annotation.id === preferredId) ?? onLine[0];
}

export function annotationsForCurrentPermanentCommit(
	annotations: readonly Annotation[],
	currentPermanentAnnotationIds: readonly string[],
	filterEnabled: boolean,
): readonly Annotation[] {
	if (!filterEnabled) { return annotations; }
	const currentIds = new Set(currentPermanentAnnotationIds);
	return annotations.filter(annotation => currentIds.has(annotation.id));
}

export function currentWorkForAgent(
	work: readonly UserAnnotationWorkItem[],
	agent: NamedAgent,
): UserAnnotationWorkItem | undefined {
	const currentWorkId = agent.currentWork?.id;
	return currentWorkId === undefined
		? undefined
		: work.find(item => item.id === currentWorkId && item.agentId === agent.id && item.status === 'working');
}

export function displayedWorkForAgent(
	work: readonly UserAnnotationWorkItem[],
	agent: NamedAgent,
): UserAnnotationWorkItem | undefined {
	return currentWorkForAgent(work, agent) ?? work
		.filter(item => item.agentId === agent.id && item.status === 'completed')
		.sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))[0];
}

export function latestSessionStatusForAgent(
	work: readonly UserAnnotationWorkItem[],
	agent: NamedAgent,
): WorkUpdate | undefined {
	return sessionStatusHistoryGroupsForAgent(work, agent).at(-1)?.updates.at(-1);
}

export function latestStatusForWork(work: UserAnnotationWorkItem): WorkUpdate | undefined {
	return work.updates.filter(update => update.kind === 'status').at(-1);
}

export interface SessionStatusHistoryGroup {
	readonly annotationId: UserAnnotationId;
	readonly userMessage: string;
	readonly preset: PromptPreset;
	readonly sourceLine: number;
	readonly updates: readonly WorkUpdate[];
}

export function sessionStatusHistoryGroupsForAgent(
	work: readonly UserAnnotationWorkItem[],
	agent: NamedAgent,
): readonly SessionStatusHistoryGroup[] {
	if (agent.session.state !== 'available') {
		return [];
	}
	const groups: SessionStatusHistoryGroup[] = [];
	for (const item of work) {
		if (item.agentId !== agent.id || item.assignment?.sessionId !== agent.session.id) {
			continue;
		}
		const updates = item.updates
			.filter(update => update.kind === 'status')
			.sort((left, right) => Date.parse(left.at) - Date.parse(right.at));
		if (updates.length > 0) {
			groups.push({
				annotationId: item.id,
				userMessage: item.prompt.text,
				preset: item.prompt.preset,
				sourceLine: item.source.line,
				updates,
			});
		}
	}
	return groups.sort((left, right) => Date.parse(left.updates[0].at) - Date.parse(right.updates[0].at));
}

export function waitingAgentForAnnotation(
	work: readonly UserAnnotationWorkItem[],
	agents: readonly NamedAgent[],
	annotationId: string,
): NamedAgent | undefined {
	const pending = work.find(item => item.id === annotationId && item.status === 'waiting');
	return pending === undefined ? undefined : agents.find(agent => agent.id === pending.agentId);
}

export type HostToWebview =
	| { readonly kind: 'state'; readonly state: MessagesState }
	| { readonly kind: 'focusComposer' };

export type WebviewToHost =
	| { readonly kind: 'ready' }
	| { readonly kind: 'submit'; readonly message: string; readonly targetAgentId: AgentId }
	| { readonly kind: 'selectTarget'; readonly targetAgentId: AgentId }
	| { readonly kind: 'cancel' }
	| { readonly kind: 'refresh' }
	| { readonly kind: 'renameAgent'; readonly agentId: AgentId; readonly name: string }
	| { readonly kind: 'openAgent'; readonly agentId: AgentId }
	| { readonly kind: 'interruptAgent'; readonly agentId: AgentId }
	| { readonly kind: 'resetAgent'; readonly agentId: AgentId }
	| { readonly kind: 'revealAnnotation'; readonly annotationId: UserAnnotationId }
	| { readonly kind: 'openAnnotation'; readonly link: AnnotationLink }
	| { readonly kind: 'previousAnnotation' }
	| { readonly kind: 'nextAnnotation' }
	| { readonly kind: 'toggleAnnotationPin' }
	| { readonly kind: 'toggleAnnotationFilter' }
	| { readonly kind: 'respondToAnnotation' }
	| { readonly kind: 'deleteAnnotation' }
	| { readonly kind: 'setPaneSplitPercent'; readonly percent: number };

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
		case 'setPaneSplitPercent':
			return hasExactKeys(value, ['kind', 'percent'])
				&& typeof value.percent === 'number'
				&& Number.isFinite(value.percent)
				&& value.percent >= minimumPaneSplitPercent
				&& value.percent <= maximumPaneSplitPercent;
		case 'openAgent':
		case 'interruptAgent':
		case 'resetAgent':
			return hasExactKeys(value, ['kind', 'agentId']) && isAgentId(value.agentId);
		case 'revealAnnotation':
			return hasExactKeys(value, ['kind', 'annotationId']) && isUserAnnotationId(value.annotationId);
		case 'openAnnotation':
			return hasExactKeys(value, ['kind', 'link']) && isAnnotationLink(value.link);
		case 'cancel':
		case 'ready':
		case 'refresh':
		case 'previousAnnotation':
		case 'nextAnnotation':
		case 'toggleAnnotationPin':
		case 'toggleAnnotationFilter':
		case 'respondToAnnotation':
		case 'deleteAnnotation':
			return hasExactKeys(value, ['kind']);
		default:
			return false;
	}
}

function isMessagesState(value: unknown): value is MessagesState {
	if (!isRecord(value)
		|| !hasAllowedKeys(value, [
			'agents', 'work', 'paneSplitPercent', 'workflow', 'prompt', 'draft', 'targetAgentId', 'response', 'busy', 'notice', 'annotationViewer',
		])
		|| !hasRequiredKeys(value, ['agents', 'work', 'paneSplitPercent', 'workflow'])
		|| !isAgentsViewState(value.agents)
		|| !Array.isArray(value.work)
		|| !value.work.every(isUserAnnotationWorkItem)
		|| !hasUniqueWork(value.work)
		|| typeof value.paneSplitPercent !== 'number'
		|| !Number.isFinite(value.paneSplitPercent)
		|| value.paneSplitPercent < minimumPaneSplitPercent
		|| value.paneSplitPercent > maximumPaneSplitPercent
		|| !isWorkflowPresentation(value.workflow)
		|| (value.busy !== undefined && typeof value.busy !== 'boolean')
		|| (value.notice !== undefined && !isNotice(value.notice))
		|| (value.annotationViewer !== undefined && !isAnnotationViewerState(value.annotationViewer))) {
		return false;
	}

	if (value.prompt === undefined) {
		if (value.draft !== undefined || value.targetAgentId !== undefined || value.response !== undefined) {
			return false;
		}
	} else if (!isPromptContext(value.prompt)
		|| typeof value.draft !== 'string'
		|| (value.targetAgentId !== undefined && !isAgentId(value.targetAgentId))
		|| (value.response !== undefined && !isResponseComposerState(value.response))) {
		return false;
	}

	if (value.agents.kind !== 'ready') {
		return true;
	}
	const agentIds = new Set<AgentId>(value.agents.agents.map(agent => agent.id));
	return value.work.every(item => agentIds.has(item.agentId))
		&& (value.prompt === undefined || value.targetAgentId === undefined || agentIds.has(value.targetAgentId));
}

function isResponseComposerState(value: unknown): value is { readonly continuity: ResponseContinuity } {
	return isRecord(value)
		&& hasExactKeys(value, ['continuity'])
		&& (value.continuity === 'originating-session' || value.continuity === 'agent-selection-required');
}

function isWorkflowPresentation(value: unknown): value is WorkflowPresentation {
	return isRecord(value)
		&& hasAllowedKeys(value, [
			'diffEnabled', 'diffLayout', 'annotationFilterEnabled', 'baseline', 'currentPermanentCommit',
		])
		&& hasRequiredKeys(value, ['diffEnabled', 'diffLayout', 'annotationFilterEnabled'])
		&& typeof value.diffEnabled === 'boolean'
		&& (value.diffLayout === 'inline' || value.diffLayout === 'side-by-side')
		&& typeof value.annotationFilterEnabled === 'boolean'
		&& (value.baseline === undefined || isCommitHash(value.baseline))
		&& (value.currentPermanentCommit === undefined || isCommitHash(value.currentPermanentCommit));
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
		&& isPresentedAnnotation(value.annotation)
		&& Number.isInteger(value.position)
		&& (value.position as number) >= 1
		&& Number.isInteger(value.total)
		&& (value.total as number) >= (value.position as number)
		&& typeof value.pinned === 'boolean'
		&& typeof value.canPrevious === 'boolean'
		&& typeof value.canNext === 'boolean';
}

function isPresentedAnnotation(value: unknown): value is PresentedAnnotation {
	if (!isRecord(value)) { return false; }
	if (value.kind === 'agent') {
		if (!hasExactKeys(value, ['kind', 'id', 'permanentBaseCommit', 'agentId', 'agentName', 'body', 'createdAt', 'anchor', 'userAnnotation'])) { return false; }
		const persisted: Record<string, unknown> = { ...value, agentSessionId: 'redacted' };
		delete persisted.agentName;
		return isAnnotation(persisted) && isNonEmptyString(value.agentName);
	}
	if (!hasExactKeys(value, ['kind', 'id', 'permanentBaseCommit', 'message', 'preset', 'scope', 'anchor', 'officialResponses', 'agentAnnotations'])) { return false; }
	const persisted = { ...value, officialResponses: [] };
	return isAnnotation(persisted) && Array.isArray(value.officialResponses)
		&& value.officialResponses.every(response => isRecord(response)
			&& hasExactKeys(response, ['body', 'createdAt', 'agentName'])
			&& isNonEmptyString(response.body) && isNonEmptyString(response.agentName)
			&& typeof response.createdAt === 'string' && !Number.isNaN(Date.parse(response.createdAt)));
}

function isAnnotationLink(value: unknown): value is AnnotationLink {
	return isRecord(value) && hasExactKeys(value, ['annotationId', 'file', 'line'])
		&& typeof value.annotationId === 'string' && value.annotationId !== ''
		&& typeof value.file === 'string' && value.file !== ''
		&& (value.line === null || (Number.isSafeInteger(value.line) && (value.line as number) >= 0));
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

function isCommitHash(value: unknown): value is string {
	return typeof value === 'string' && /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(value);
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
