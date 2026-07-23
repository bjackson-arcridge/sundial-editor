import { promptPresets, type PromptPreset, type PromptScope } from './promptCommand';

declare const userAnnotationIdBrand: unique symbol;
declare const agentIdBrand: unique symbol;
declare const agentSessionIdBrand: unique symbol;

export type UserAnnotationId = string & { readonly [userAnnotationIdBrand]: true };
export type AgentId = string & { readonly [agentIdBrand]: true };
export type AgentSessionId = string & { readonly [agentSessionIdBrand]: true };

export const workStatuses = ['waiting', 'working', 'completed'] as const;
export type WorkStatus = typeof workStatuses[number];

export const workUpdateKinds = ['enqueued', 'ready', 'claimed', 'status', 'completed', 'requeued'] as const;
export type WorkUpdateKind = typeof workUpdateKinds[number];
export const coordinationStates = ['working', 'waiting', 'blocked', 'stopped'] as const;
export type CoordinationState = typeof coordinationStates[number];

export interface CoordinationUpdate {
	readonly at: string;
	readonly state: CoordinationState;
	readonly message: string;
	readonly files: readonly string[];
}

export interface WorkUpdate {
	readonly at: string;
	readonly kind: WorkUpdateKind;
	readonly message: string;
}

export interface WorkAssignment {
	readonly sessionId: AgentSessionId;
	readonly sequence: number;
	readonly claimedAt: string;
}

export interface WorkSummary {
	readonly id: UserAnnotationId;
	readonly agentId: AgentId;
	readonly status: WorkStatus;
	readonly ready: boolean;
	readonly enqueuedAt: string;
	readonly updatedAt: string;
	readonly latestUpdate?: WorkUpdate;
	readonly assignment?: WorkAssignment;
}
export interface UserAnnotationWorkItem extends WorkSummary {
	readonly source: {
		readonly uri: string;
		readonly line: number;
		readonly text: string;
		readonly before: readonly string[];
		readonly after: readonly string[];
	};
	readonly prompt: {
		readonly preset: PromptPreset;
		readonly scope: PromptScope;
		readonly text: string;
	};
	readonly updates: readonly WorkUpdate[];
}

export type AgentProvider = 'codex';

export type AgentSessionSummary =
	| { readonly state: 'missing'; readonly id?: AgentSessionId }
	| { readonly state: 'uninitialized'; readonly id: AgentSessionId; readonly provider: AgentProvider }
	| { readonly state: 'available'; readonly id: AgentSessionId; readonly provider: AgentProvider };

export interface AgentQueueCounts {
	readonly waiting: number;
	readonly working: number;
	readonly completed: number;
}

export interface AgentControls {
	readonly canRename: boolean;
	readonly canEnsureSession: boolean;
	readonly canOpen: boolean;
	readonly canInterrupt: boolean;
	readonly canReset: boolean;
}

export interface NamedAgent {
	readonly id: AgentId;
	readonly slot: number;
	readonly name: string;
	readonly session: AgentSessionSummary;
	readonly coordination?: CoordinationUpdate;
	readonly queue: AgentQueueCounts;
	readonly currentWork?: WorkSummary;
	readonly controls: AgentControls;
}

export type AgentSummary = NamedAgent;

export interface AgentDetail extends NamedAgent {
	readonly work: readonly WorkSummary[];
}

export type TranscriptRole = 'user' | 'assistant' | 'system' | 'tool';

export interface TranscriptEntry {
	readonly role: TranscriptRole;
	readonly text: string;
	readonly timestamp?: string;
}

export type AgentTranscript =
	| {
		readonly agentId: AgentId;
		readonly state: 'missing';
		readonly sessionId?: AgentSessionId;
		readonly entries: readonly [];
	}
	| {
		readonly agentId: AgentId;
		readonly state: 'uninitialized';
		readonly sessionId: AgentSessionId;
		readonly entries: readonly [];
	}
	| {
		readonly agentId: AgentId;
		readonly state: 'available';
		readonly sessionId: AgentSessionId;
		readonly entries: readonly TranscriptEntry[];
	};

export type AgentsViewState =
	| { readonly kind: 'loading' }
	| { readonly kind: 'empty' }
	| { readonly kind: 'ready'; readonly agents: readonly NamedAgent[] }
	| { readonly kind: 'error'; readonly message: string; readonly recoverable: boolean };

export type AgentWorkViewState =
	| { readonly kind: 'loading'; readonly agentId: AgentId }
	| { readonly kind: 'empty'; readonly agent: NamedAgent }
	| { readonly kind: 'ready'; readonly agent: NamedAgent; readonly work: readonly WorkSummary[] }
	| { readonly kind: 'error'; readonly agentId: AgentId; readonly message: string; readonly recoverable: boolean };

export type AgentTranscriptViewState =
	| { readonly kind: 'loading'; readonly agentId: AgentId }
	| { readonly kind: 'missing'; readonly agentId: AgentId; readonly sessionId?: AgentSessionId }
	| { readonly kind: 'uninitialized'; readonly agentId: AgentId; readonly sessionId: AgentSessionId }
	| { readonly kind: 'empty'; readonly agentId: AgentId; readonly sessionId: AgentSessionId }
	| { readonly kind: 'ready'; readonly agentId: AgentId; readonly sessionId: AgentSessionId; readonly entries: readonly TranscriptEntry[] }
	| { readonly kind: 'error'; readonly agentId: AgentId; readonly message: string; readonly recoverable: boolean };

export function parseUserAnnotationId(value: unknown): UserAnnotationId {
	return parseOpaqueId(value, 'user annotation') as UserAnnotationId;
}

export function parseAgentId(value: unknown): AgentId {
	return parseOpaqueId(value, 'agent') as AgentId;
}

export function parseAgentSessionId(value: unknown): AgentSessionId {
	return parseOpaqueId(value, 'agent session') as AgentSessionId;
}

export function isUserAnnotationId(value: unknown): value is UserAnnotationId {
	return isOpaqueId(value);
}

export function isAgentId(value: unknown): value is AgentId {
	return isOpaqueId(value);
}

export function isAgentSessionId(value: unknown): value is AgentSessionId {
	return isOpaqueId(value);
}

export function isWorkStatus(value: unknown): value is WorkStatus {
	return typeof value === 'string' && (workStatuses as readonly string[]).includes(value);
}

export function isWorkUpdate(value: unknown): value is WorkUpdate {
	return isRecord(value)
		&& isTimestamp(value.at)
		&& typeof value.kind === 'string'
		&& (workUpdateKinds as readonly string[]).includes(value.kind)
		&& isNonEmptyString(value.message);
}

export function isCoordinationUpdate(value: unknown): value is CoordinationUpdate {
	return isRecord(value)
		&& isTimestamp(value.at)
		&& typeof value.state === 'string'
		&& (coordinationStates as readonly string[]).includes(value.state)
		&& isNonEmptyString(value.message)
		&& value.message === value.message.trim()
		&& [...value.message].length <= 240
		&& !/[\r\n]/u.test(value.message)
		&& Array.isArray(value.files)
		&& value.files.length <= 100
		&& value.files.every(file => typeof file === 'string' && isNormalizedRelativePath(file))
		&& new Set(value.files).size === value.files.length;
}

export function isWorkSummary(value: unknown): value is WorkSummary {
	if (!isRecord(value)
		|| !isUserAnnotationId(value.id)
		|| !isAgentId(value.agentId)
		|| !isWorkStatus(value.status)
		|| typeof value.ready !== 'boolean'
		|| !isTimestamp(value.enqueuedAt)
		|| !isTimestamp(value.updatedAt)
		|| Date.parse(value.updatedAt) < Date.parse(value.enqueuedAt)
		|| (value.latestUpdate !== undefined && !isWorkUpdate(value.latestUpdate))
		|| (value.assignment !== undefined && !isWorkAssignment(value.assignment))) {
		return false;
	}
	return value.latestUpdate === undefined
		|| Date.parse(value.latestUpdate.at) <= Date.parse(value.updatedAt);
}

export function isUserAnnotationWorkItem(value: unknown): value is UserAnnotationWorkItem {
	if (!isRecord(value) || !isWorkSummary(value)) {
		return false;
	}
	const candidate = value as WorkSummary & Record<string, unknown>;
	if (!isRecord(candidate.source)
		|| !isNonEmptyString(candidate.source.uri)
		|| !Number.isInteger(candidate.source.line)
		|| (candidate.source.line as number) < 0
		|| typeof candidate.source.text !== 'string'
		|| !isAnchorContext(candidate.source.before)
		|| !isAnchorContext(candidate.source.after)
		|| !isRecord(candidate.prompt)
		|| !isPromptPreset(candidate.prompt.preset)
		|| (candidate.prompt.scope !== 'line' && candidate.prompt.scope !== 'project')
		|| !isNonEmptyString(candidate.prompt.text)
		|| !isOrderedWorkUpdates(candidate.updates)) {
		return false;
	}

	const latest = candidate.updates.at(-1);
	return (latest === undefined && candidate.latestUpdate === undefined)
		|| (latest !== undefined && candidate.latestUpdate !== undefined && equalWorkUpdates(latest, candidate.latestUpdate));
}

export function isNamedAgent(value: unknown): value is NamedAgent {
	if (!isRecord(value)
		|| 'providerSessionId' in value
		|| !isAgentId(value.id)
		|| !Number.isSafeInteger(value.slot)
		|| (value.slot as number) < 1
		|| !isAgentName(value.name)
		|| !isAgentSessionSummary(value.session)
		|| (value.coordination !== undefined && !isCoordinationUpdate(value.coordination))
		|| !isAgentQueueCounts(value.queue)
		|| !isAgentControls(value.controls)
		|| (value.currentWork !== undefined && !isWorkSummary(value.currentWork))) {
		return false;
	}
	return value.currentWork === undefined
		|| (value.currentWork.agentId === value.id && value.currentWork.status === 'working');
}

export function isAgentDetail(value: unknown): value is AgentDetail {
	if (!isRecord(value) || !isNamedAgent(value)) {
		return false;
	}
	const candidate = value as NamedAgent & Record<string, unknown>;
	return Array.isArray(candidate.work)
		&& candidate.work.every(work => isWorkSummary(work) && work.agentId === candidate.id)
		&& hasUniqueValues(candidate.work.map(work => work.id))
		&& isChronological(candidate.work.map(work => work.enqueuedAt));
}

export function isAgentTranscript(value: unknown): value is AgentTranscript {
	if (!isRecord(value)
		|| 'providerSessionId' in value
		|| !isAgentId(value.agentId)
		|| !Array.isArray(value.entries)
		|| !value.entries.every(isTranscriptEntry)) {
		return false;
	}
	if (value.state === 'missing') {
		return (value.sessionId === undefined || isAgentSessionId(value.sessionId)) && value.entries.length === 0;
	}
	if (value.state === 'uninitialized') {
		return isAgentSessionId(value.sessionId) && value.entries.length === 0;
	}
	return value.state === 'available' && isAgentSessionId(value.sessionId);
}

export function isAgentsViewState(value: unknown): value is AgentsViewState {
	if (!isRecord(value)) {
		return false;
	}
	if (value.kind === 'loading' || value.kind === 'empty') {
		return true;
	}
	if (value.kind === 'error') {
		return isNonEmptyString(value.message) && typeof value.recoverable === 'boolean';
	}
	return value.kind === 'ready'
		&& Array.isArray(value.agents)
		&& value.agents.length > 0
		&& value.agents.every(isNamedAgent)
		&& hasUniqueAgents(value.agents);
}

export function isAgentWorkViewState(value: unknown): value is AgentWorkViewState {
	if (!isRecord(value)) {
		return false;
	}
	if (value.kind === 'loading') {
		return isAgentId(value.agentId);
	}
	if (value.kind === 'error') {
		return isAgentId(value.agentId) && isNonEmptyString(value.message) && typeof value.recoverable === 'boolean';
	}
	const agent = value.agent;
	if ((value.kind !== 'empty' && value.kind !== 'ready') || !isNamedAgent(agent)) {
		return false;
	}
	if (value.kind === 'empty') {
		return agent.queue.waiting === 0
			&& agent.queue.working === 0;
	}
	return Array.isArray(value.work)
		&& value.work.length > 0
		&& value.work.every(work => isWorkSummary(work) && work.agentId === agent.id)
		&& hasUniqueValues(value.work.map(work => work.id))
		&& isChronological(value.work.map(work => work.enqueuedAt));
}

export function isAgentTranscriptViewState(value: unknown): value is AgentTranscriptViewState {
	if (!isRecord(value) || !isAgentId(value.agentId)) {
		return false;
	}
	if (value.kind === 'loading' || value.kind === 'missing') {
		return value.sessionId === undefined || isAgentSessionId(value.sessionId);
	}
	if (value.kind === 'uninitialized' || value.kind === 'empty') {
		return isAgentSessionId(value.sessionId);
	}
	if (value.kind === 'error') {
		return isNonEmptyString(value.message) && typeof value.recoverable === 'boolean';
	}
	return value.kind === 'ready'
		&& isAgentSessionId(value.sessionId)
		&& Array.isArray(value.entries)
		&& value.entries.length > 0
		&& value.entries.every(isTranscriptEntry);
}

export function projectAgentTranscript(transcript: AgentTranscript): AgentTranscriptViewState {
	if (transcript.state === 'missing') {
		return {
			kind: 'missing',
			agentId: transcript.agentId,
			...(transcript.sessionId === undefined ? {} : { sessionId: transcript.sessionId }),
		};
	}
	if (transcript.state === 'uninitialized') {
		return { kind: 'uninitialized', agentId: transcript.agentId, sessionId: transcript.sessionId };
	}
	return transcript.entries.length === 0
		? { kind: 'empty', agentId: transcript.agentId, sessionId: transcript.sessionId }
		: {
			kind: 'ready',
			agentId: transcript.agentId,
			sessionId: transcript.sessionId,
			entries: transcript.entries,
		};
}

export function parseNamedAgent(value: unknown): NamedAgent {
	if (!isNamedAgent(value)) {
		throw new Error('Sundial Editor CLI returned a malformed named agent.');
	}
	return value;
}

export function parseAgentDetail(value: unknown): AgentDetail {
	if (!isAgentDetail(value)) {
		throw new Error('Sundial Editor CLI returned malformed agent details.');
	}
	return value;
}

export function parseWorkSummary(value: unknown): WorkSummary {
	if (!isWorkSummary(value)) {
		throw new Error('Sundial Editor CLI returned a malformed work summary.');
	}
	return value;
}

export function parseUserAnnotationWorkItem(value: unknown): UserAnnotationWorkItem {
	if (!isUserAnnotationWorkItem(value)) {
		throw new Error('Sundial Editor CLI returned a malformed user annotation work item.');
	}
	return value;
}

export function parseAgentTranscript(value: unknown): AgentTranscript {
	if (!isAgentTranscript(value)) {
		throw new Error('Sundial Editor CLI returned a malformed agent transcript.');
	}
	return value;
}

function isWorkAssignment(value: unknown): value is WorkAssignment {
	return isRecord(value)
		&& isAgentSessionId(value.sessionId)
		&& Number.isSafeInteger(value.sequence)
		&& (value.sequence as number) > 0
		&& isTimestamp(value.claimedAt);
}

function isAgentSessionSummary(value: unknown): value is AgentSessionSummary {
	if (!isRecord(value) || 'providerSessionId' in value) {
		return false;
	}
	if (value.state === 'missing') {
		return value.id === undefined || isAgentSessionId(value.id);
	}
	return (value.state === 'uninitialized' || value.state === 'available')
		&& isAgentSessionId(value.id)
		&& value.provider === 'codex';
}

function isAgentQueueCounts(value: unknown): value is AgentQueueCounts {
	return isRecord(value)
		&& isNonNegativeInteger(value.waiting)
		&& isNonNegativeInteger(value.working)
		&& (value.working as number) <= 1
		&& isNonNegativeInteger(value.completed);
}

function isAgentControls(value: unknown): value is AgentControls {
	return isRecord(value)
		&& typeof value.canRename === 'boolean'
		&& typeof value.canEnsureSession === 'boolean'
		&& typeof value.canOpen === 'boolean'
		&& typeof value.canInterrupt === 'boolean'
		&& typeof value.canReset === 'boolean';
}

function isTranscriptEntry(value: unknown): value is TranscriptEntry {
	return isRecord(value)
		&& (value.role === 'user' || value.role === 'assistant' || value.role === 'system' || value.role === 'tool')
		&& typeof value.text === 'string'
		&& (value.timestamp === undefined || isTimestamp(value.timestamp));
}

function isOrderedWorkUpdates(value: unknown): value is readonly WorkUpdate[] {
	return Array.isArray(value) && value.every(isWorkUpdate) && isChronological(value.map(update => update.at));
}

function equalWorkUpdates(left: WorkUpdate, right: WorkUpdate): boolean {
	return left.at === right.at && left.kind === right.kind && left.message === right.message;
}

function isPromptPreset(value: unknown): value is PromptPreset {
	return typeof value === 'string' && (promptPresets as readonly string[]).includes(value);
}

function isAgentName(value: unknown): value is string {
	return isNonEmptyString(value)
		&& value === value.trim()
		&& !/[\r\n\u2028\u2029]/u.test(value)
		&& [...value].length <= 80
		&& !/^\d+$/.test(value);
}

function isAnchorContext(value: unknown): value is readonly string[] {
	return Array.isArray(value)
		&& value.length <= 3
		&& value.every(line => typeof line === 'string' && line.trim() !== '');
}

function hasUniqueAgents(agents: readonly NamedAgent[]): boolean {
	return hasUniqueValues(agents.map(agent => agent.id))
		&& hasUniqueValues(agents.map(agent => agent.slot))
		&& hasUniqueValues(agents.map(agent => agent.name.toLowerCase()));
}

function hasUniqueValues(values: readonly (string | number)[]): boolean {
	return new Set(values).size === values.length;
}

function isChronological(timestamps: readonly string[]): boolean {
	for (let index = 1; index < timestamps.length; index += 1) {
		if (Date.parse(timestamps[index]) < Date.parse(timestamps[index - 1])) {
			return false;
		}
	}
	return true;
}

function isTimestamp(value: unknown): value is string {
	return typeof value === 'string' && value !== '' && !Number.isNaN(Date.parse(value));
}

function isNonNegativeInteger(value: unknown): value is number {
	return Number.isSafeInteger(value) && (value as number) >= 0;
}

function parseOpaqueId(value: unknown, label: string): string {
	if (!isOpaqueId(value)) {
		throw new Error(`${label} id must be a non-empty string.`);
	}
	return value;
}

function isOpaqueId(value: unknown): value is string {
	return typeof value === 'string'
		&& value.trim() !== ''
		&& value === value.trim()
		&& !/[\u0000-\u001f\u007f\u2028\u2029]/u.test(value);
}

function isNonEmptyString(value: unknown): value is string {
	return typeof value === 'string' && value.trim() !== '';
}

function isNormalizedRelativePath(value: string): boolean {
	return value !== ''
		&& value.length <= 1_024
		&& !value.startsWith('/')
		&& !/^[A-Za-z]:/u.test(value)
		&& !value.includes('\\')
		&& !value.includes('\0')
		&& value !== '.'
		&& !value.split('/').some(segment => segment === '' || segment === '.' || segment === '..');
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}
