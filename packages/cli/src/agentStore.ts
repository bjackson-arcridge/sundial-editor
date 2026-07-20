import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import * as path from 'node:path';

declare const userAnnotationIdBrand: unique symbol;
declare const agentIdBrand: unique symbol;
declare const agentSessionIdBrand: unique symbol;

export type UserAnnotationId = string & { readonly [userAnnotationIdBrand]: true };
export type AgentId = string & { readonly [agentIdBrand]: true };
export type AgentSessionId = string & { readonly [agentSessionIdBrand]: true };
export type AgentSelector = string | number;
export type WorkStatus = 'waiting' | 'working' | 'completed';
export type WorkUpdateKind = 'enqueued' | 'ready' | 'claimed' | 'status' | 'completed' | 'requeued';
export type SessionState = 'uninitialized' | 'available' | 'missing';

export const agentStoreVersion = 1;
export const defaultAgentNames = ['Bob', 'Amy', 'Sam', 'Mike', 'Ty'] as const;

export interface NamedAgent {
	readonly version: typeof agentStoreVersion;
	readonly id: AgentId;
	readonly slot: number;
	readonly name: string;
	readonly currentSessionId?: AgentSessionId;
}

export interface TranscriptEntry {
	readonly role: 'user' | 'assistant' | 'system' | 'tool';
	readonly text: string;
	readonly timestamp?: string;
}

export interface AgentSessionRecord {
	readonly version: typeof agentStoreVersion;
	readonly id: AgentSessionId;
	readonly agentId: AgentId;
	readonly provider: string;
	readonly state: SessionState;
	readonly providerSessionId?: string;
	readonly createdAt: string;
	readonly updatedAt: string;
	readonly transcript: readonly TranscriptEntry[];
}

export interface WorkSource {
	readonly uri: string;
	readonly path?: string;
	readonly line: number;
	readonly text: string;
	readonly before: readonly string[];
	readonly after: readonly string[];
}

export interface WorkPrompt {
	readonly preset: '%Q' | '%F' | '%W' | '%R' | '%C' | '%T';
	readonly scope: 'line' | 'project';
	readonly text: string;
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

export interface UserAnnotationWorkItem {
	readonly version: typeof agentStoreVersion;
	readonly id: UserAnnotationId;
	readonly agentId: AgentId;
	readonly source: WorkSource;
	readonly prompt: WorkPrompt;
	readonly enqueuedAt: string;
	readonly readyAt?: string;
	readonly updatedAt: string;
	readonly ready: boolean;
	readonly status: WorkStatus;
	readonly lastAssignmentSequence: number;
	readonly assignment?: WorkAssignment;
	readonly updates: readonly WorkUpdate[];
}

export type WorkItem = UserAnnotationWorkItem;

export interface WorkSummary {
	readonly id: UserAnnotationId;
	readonly agentId: AgentId;
	readonly status: WorkStatus;
	readonly ready: boolean;
	readonly enqueuedAt: string;
	readonly updatedAt: string;
	readonly latestUpdate: WorkUpdate;
	readonly assignment?: WorkAssignment;
}

export type AgentSessionSummary =
	| { readonly state: 'missing'; readonly id?: AgentSessionId }
	| { readonly state: 'uninitialized' | 'available'; readonly id: AgentSessionId; readonly provider: string };

export interface AgentSummary {
	readonly id: AgentId;
	readonly slot: number;
	readonly name: string;
	readonly session: AgentSessionSummary;
	readonly queue: { readonly waiting: number; readonly working: number; readonly completed: number };
	readonly currentWork?: WorkSummary;
	readonly controls: {
		readonly canRename: true;
		readonly canEnsureSession: boolean;
		readonly canOpen: boolean;
		readonly canInterrupt: boolean;
		readonly canReset: boolean;
	};
}

export interface AgentDetail extends AgentSummary {
	readonly work: readonly WorkSummary[];
	readonly sessionFile?: AgentSessionRecord;
}

export interface AgentTranscript {
	readonly agentId: AgentId;
	readonly sessionId?: AgentSessionId;
	readonly state: SessionState | 'missing';
	readonly entries: readonly TranscriptEntry[];
}

export interface AgentStoreServices {
	readonly createId: () => string;
	readonly now: () => Date;
	readonly sleep: (milliseconds: number) => Promise<void>;
	readonly lockTimeoutMs: number;
	readonly staleLockMs: number;
}

export interface EnqueueWorkRequest {
	readonly workspaceCwd: string;
	readonly agentSelector: AgentSelector;
	readonly userAnnotationId?: string;
	readonly source: WorkSource;
	readonly prompt: WorkPrompt;
}

export interface WorkIdentityRequest {
	readonly workspaceCwd: string;
	readonly agentSelector: AgentSelector;
	readonly userAnnotationId: string;
}

export interface AssignedWorkRequest extends WorkIdentityRequest {
	readonly sessionId: string;
	readonly assignmentSequence: number;
}

export interface StatusUpdateResult {
	readonly work: UserAnnotationWorkItem;
	readonly appended: boolean;
}

export interface AgentResetResult {
	readonly agent: NamedAgent;
	readonly session: AgentSessionRecord;
	readonly requeued: readonly UserAnnotationWorkItem[];
}

export type AgentStoreConflictCode =
	| 'not_found'
	| 'duplicate_name'
	| 'id_conflict'
	| 'state_conflict'
	| 'stale_assignment'
	| 'missing_session';

export class AgentStoreConflictError extends Error {
	constructor(
		readonly code: AgentStoreConflictCode,
		message: string,
		readonly current?: unknown,
	) {
		super(message);
		this.name = 'AgentStoreConflictError';
	}
}

export class AgentStoreValidationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'AgentStoreValidationError';
	}
}

interface StorePaths {
	readonly root: string;
	readonly lock: string;
	readonly agents: string;
	readonly work: string;
	readonly sessions: string;
}

const defaultServices: AgentStoreServices = {
	createId: randomUUID,
	now: () => new Date(),
	sleep: milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)),
	lockTimeoutMs: 5_000,
	staleLockMs: 30_000,
};

export function asUserAnnotationId(value: unknown): UserAnnotationId {
	return parseOpaqueId(value, 'UserAnnotationId') as UserAnnotationId;
}

export function asAgentId(value: unknown): AgentId {
	return parseOpaqueId(value, 'AgentId') as AgentId;
}

export function asAgentSessionId(value: unknown): AgentSessionId {
	return parseOpaqueId(value, 'AgentSessionId') as AgentSessionId;
}

export function generateUserAnnotationId(createId: () => string = randomUUID): UserAnnotationId {
	return asUserAnnotationId(createId());
}

export function validateAgentName(value: unknown): string {
	if (typeof value !== 'string') {
		throw new AgentStoreValidationError('Agent name must be a string.');
	}
	const name = value.trim();
	if (name === '' || unicodeLength(name) > 80 || /[\r\n\u2028\u2029>@]/u.test(name) || /^\d+$/u.test(name)) {
		throw new AgentStoreValidationError('Agent name must be 1-80 characters, one line, non-numeric, and contain neither ">" nor "@".');
	}
	return name;
}

export function normalizeAgentStatus(value: unknown): string {
	if (typeof value !== 'string') {
		throw new AgentStoreValidationError('Status must be a string.');
	}
	const status = value.trim();
	if (status === '' || unicodeLength(status) > 240 || /[\r\n]/u.test(status)) {
		throw new AgentStoreValidationError('Status must contain 1-240 characters and no line break.');
	}
	return status;
}

export function agentStorePath(workspaceCwd: string): string {
	return storePaths(workspaceCwd).root;
}

export function agentFilePath(workspaceCwd: string, agentId: string): string {
	return path.join(storePaths(workspaceCwd).agents, `${asAgentId(agentId)}.json`);
}

export function workFilePath(workspaceCwd: string, workId: string): string {
	return path.join(storePaths(workspaceCwd).work, `${asUserAnnotationId(workId)}.json`);
}

export function sessionFilePath(workspaceCwd: string, sessionId: string): string {
	return path.join(storePaths(workspaceCwd).sessions, `${asAgentSessionId(sessionId)}.json`);
}

export async function ensureDefaultAgents(workspaceCwd: string, services: AgentStoreServices = defaultServices): Promise<readonly AgentSummary[]> {
	return withStoreLock(workspaceCwd, services, async () => {
		const agents = await readAgents(workspaceCwd);
		for (let slot = 1; slot <= defaultAgentNames.length; slot += 1) {
			if (agents.some(agent => agent.slot === slot)) {continue;}
			const agent: NamedAgent = { version: 1, id: asAgentId(services.createId()), slot, name: uniqueAgentName(defaultAgentNames[slot - 1], agents) };
			await createDocument(agentFilePath(workspaceCwd, agent.id), agent);
			agents.push(agent);
		}
		return projectAgentSummaries(workspaceCwd, agents);
	});
}

export async function listAgents(workspaceCwd: string): Promise<readonly AgentSummary[]> {
	await ensureDefaultAgents(workspaceCwd);
	return projectAgentSummaries(workspaceCwd, await readAgents(workspaceCwd));
}

export async function resolveAgentSelector(workspaceCwd: string, selector: AgentSelector): Promise<NamedAgent> {
	await ensureDefaultAgents(workspaceCwd);
	return selectAgent(await readAgents(workspaceCwd), selector);
}

export async function showAgent(workspaceCwd: string, selector: AgentSelector): Promise<AgentDetail> {
	const agent = await resolveAgentSelector(workspaceCwd, selector);
	const summary = (await projectAgentSummaries(workspaceCwd, [agent]))[0];
	const work = (await listWork(workspaceCwd, selector)).map(workSummary);
	const sessionFile = agent.currentSessionId === undefined ? undefined : await readSessionRequired(workspaceCwd, agent.currentSessionId);
	return { ...summary, work, ...(sessionFile === undefined ? {} : { sessionFile }) };
}

export async function renameAgent(input: { workspaceCwd: string; selector: AgentSelector; name: string }): Promise<AgentSummary> {
	await ensureDefaultAgents(input.workspaceCwd);
	const name = validateAgentName(input.name);
	return withStoreLock(input.workspaceCwd, defaultServices, async () => {
		const agents = await readAgents(input.workspaceCwd);
		const agent = selectAgent(agents, input.selector);
		if (agents.some(other => other.id !== agent.id && fold(other.name) === fold(name))) {throw new AgentStoreConflictError('duplicate_name', `Agent name is already in use: ${name}`);}
		const next: NamedAgent = { ...agent, name };
		await replaceDocument(agentFilePath(input.workspaceCwd, agent.id), next);
		return (await projectAgentSummaries(input.workspaceCwd, [next]))[0];
	});
}

export async function ensureAgentSession(input: { workspaceCwd: string; selector: AgentSelector }): Promise<AgentSessionRecord> {
	await ensureDefaultAgents(input.workspaceCwd);
	return withStoreLock(input.workspaceCwd, defaultServices, async () => {
		const agent = selectAgent(await readAgents(input.workspaceCwd), input.selector);
		if (agent.currentSessionId !== undefined) {return readSessionRequired(input.workspaceCwd, agent.currentSessionId);}
		const now = defaultServices.now().toISOString();
		const session: AgentSessionRecord = { version: 1, id: asAgentSessionId(defaultServices.createId()), agentId: agent.id, provider: 'codex', state: 'uninitialized', createdAt: now, updatedAt: now, transcript: [] };
		await createDocument(sessionFilePath(input.workspaceCwd, session.id), session);
		await replaceDocument(agentFilePath(input.workspaceCwd, agent.id), { ...agent, currentSessionId: session.id });
		return session;
	});
}

export async function attachProviderSession(input: { workspaceCwd: string; agentSessionId: string; providerSessionId: string }): Promise<AgentSessionRecord> {
	return withStoreLock(input.workspaceCwd, defaultServices, async () => {
		const session = await readSessionRequired(input.workspaceCwd, input.agentSessionId);
		if (session.state === 'available' && session.providerSessionId !== input.providerSessionId) {throw new AgentStoreConflictError('state_conflict', 'Session already has a different provider conversation.', session);}
		const next: AgentSessionRecord = { ...session, state: 'available', providerSessionId: nonEmpty(input.providerSessionId, 'providerSessionId'), updatedAt: defaultServices.now().toISOString() };
		await replaceDocument(sessionFilePath(input.workspaceCwd, session.id), next); return next;
	});
}

export async function markProviderSessionMissing(input: { workspaceCwd: string; agentSessionId: string }): Promise<AgentSessionRecord> {
	return withStoreLock(input.workspaceCwd, defaultServices, async () => {
		const session = await readSessionRequired(input.workspaceCwd, input.agentSessionId);
		const next: AgentSessionRecord = { ...session, state: 'missing', updatedAt: defaultServices.now().toISOString() };
		await replaceDocument(sessionFilePath(input.workspaceCwd, session.id), next); return next;
	});
}

export async function resetAgentSession(input: { workspaceCwd: string; selector: AgentSelector; reason?: string }): Promise<AgentResetResult> {
	await ensureDefaultAgents(input.workspaceCwd);
	return withStoreLock(input.workspaceCwd, defaultServices, async () => {
		const agent = selectAgent(await readAgents(input.workspaceCwd), input.selector);
		const requeued: UserAnnotationWorkItem[] = [];
		for (const item of (await readWork(input.workspaceCwd)).filter(work => work.agentId === agent.id && work.status === 'working')) {
			const next = requeueItem(item, input.reason ?? 'Agent session reset.'); await replaceDocument(workFilePath(input.workspaceCwd, item.id), next); requeued.push(next);
		}
		if (agent.currentSessionId !== undefined) {await rm(sessionFilePath(input.workspaceCwd, agent.currentSessionId), { force: true });}
		const now = defaultServices.now().toISOString();
		const session: AgentSessionRecord = { version: 1, id: asAgentSessionId(defaultServices.createId()), agentId: agent.id, provider: 'codex', state: 'uninitialized', createdAt: now, updatedAt: now, transcript: [] };
		await createDocument(sessionFilePath(input.workspaceCwd, session.id), session);
		const updatedAgent: NamedAgent = { ...agent, currentSessionId: session.id }; await replaceDocument(agentFilePath(input.workspaceCwd, agent.id), updatedAgent);
		return { agent: updatedAgent, session, requeued };
	});
}

export async function enqueueWork(input: EnqueueWorkRequest): Promise<UserAnnotationWorkItem> {
	await ensureDefaultAgents(input.workspaceCwd);
	validateSource(input.source); validatePrompt(input.prompt);
	return withStoreLock(input.workspaceCwd, defaultServices, async () => {
		const agent = selectAgent(await readAgents(input.workspaceCwd), input.agentSelector);
		const id = input.userAnnotationId === undefined ? generateUserAnnotationId(defaultServices.createId) : asUserAnnotationId(input.userAnnotationId);
		const existing = await readOptional(workFilePath(input.workspaceCwd, id), validateWorkItem);
		if (existing !== undefined) {
			if (existing.agentId !== agent.id || JSON.stringify(existing.source) !== JSON.stringify(input.source) || JSON.stringify(existing.prompt) !== JSON.stringify(input.prompt)) {throw new AgentStoreConflictError('id_conflict', 'Work identity is reserved with different content.', existing);}
			return existing;
		}
		const now = defaultServices.now().toISOString();
		const update: WorkUpdate = { at: now, kind: 'enqueued', message: `Queued for ${agent.name}.` };
		const work: UserAnnotationWorkItem = { version: 1, id, agentId: agent.id, source: input.source, prompt: input.prompt, enqueuedAt: now, updatedAt: now, ready: false, status: 'waiting', lastAssignmentSequence: 0, updates: [update] };
		await createDocument(workFilePath(input.workspaceCwd, work.id), work); return work;
	});
}

export async function markWorkReady(input: { workspaceCwd: string; userAnnotationId: string; agentId?: string }): Promise<UserAnnotationWorkItem> {
	return mutateWork(input.workspaceCwd, input.userAnnotationId, item => {
		if (input.agentId !== undefined && item.agentId !== input.agentId) {throw new AgentStoreConflictError('state_conflict', 'Work targets another agent.', item);}
		if (item.status === 'completed') {throw new AgentStoreConflictError('state_conflict', 'Completed work cannot become ready.', item);}
		if (item.ready) {return item;}
		const at = defaultServices.now().toISOString(); return { ...item, ready: true, readyAt: at, updatedAt: at, updates: [...item.updates, { at, kind: 'ready', message: 'Annotation saved; ready for assignment.' }] };
	});
}

export async function claimNextWork(input: { workspaceCwd: string; agentSelector: AgentSelector; expectedSessionId?: string }): Promise<UserAnnotationWorkItem | undefined> {
	await ensureDefaultAgents(input.workspaceCwd);
	return withStoreLock(input.workspaceCwd, defaultServices, async () => {
		const agent = selectAgent(await readAgents(input.workspaceCwd), input.agentSelector);
		if (agent.currentSessionId === undefined) {throw new AgentStoreConflictError('missing_session', 'Agent has no managed session.');}
		const session = await readSessionRequired(input.workspaceCwd, agent.currentSessionId);
		if (session.agentId !== agent.id || session.state !== 'available') {
			throw new AgentStoreConflictError('missing_session', 'Agent has no active provider session.', session);
		}
		if (input.expectedSessionId !== undefined && agent.currentSessionId !== input.expectedSessionId) {throw new AgentStoreConflictError('stale_assignment', 'Agent session changed before claim.');}
		const all = await readWork(input.workspaceCwd); if (all.some(item => item.agentId === agent.id && item.status === 'working')) {return undefined;}
		const item = all.filter(work => work.agentId === agent.id && work.status === 'waiting' && work.ready).sort(compareWork)[0]; if (item === undefined) {return undefined;}
		const at = defaultServices.now().toISOString(); const sequence = item.lastAssignmentSequence + 1;
		const next: UserAnnotationWorkItem = { ...item, status: 'working', lastAssignmentSequence: sequence, assignment: { sessionId: agent.currentSessionId, sequence, claimedAt: at }, updatedAt: at, updates: [...item.updates, { at, kind: 'claimed', message: `Assigned to ${agent.name}.` }] };
		await replaceDocument(workFilePath(input.workspaceCwd, item.id), next); return next;
	});
}

interface AssignmentInput { readonly workspaceCwd: string; readonly userAnnotationId: string; readonly agentSessionId: string; readonly assignmentSequence: number; readonly agentId?: string }
type EditorAssignmentInput = AssignmentInput & { readonly agentId: string };
export async function completeWork(input: EditorAssignmentInput & { finalUpdate?: string }): Promise<UserAnnotationWorkItem> { return mutateAssigned(input, item => transitionAssigned(item, 'completed', 'completed', input.finalUpdate ?? 'Work completed successfully.')); }
export async function requeueWork(input: EditorAssignmentInput & { reason: string }): Promise<UserAnnotationWorkItem> { return mutateAssigned(input, item => requeueItem(item, input.reason)); }
export async function provideStatusUpdate(input: AssignmentInput & { status: string }): Promise<StatusUpdateResult> {
	const status = normalizeAgentStatus(input.status); let appended = false;
	const work = await mutateAssigned(input, item => { if (item.updates.at(-1)?.message === status) {return item;} appended = true; const at = defaultServices.now().toISOString(); return { ...item, updatedAt: at, updates: [...item.updates, { at, kind: 'status', message: status }] }; }, true);
	return { work, appended };
}

export async function listWork(workspaceCwd: string, selector?: AgentSelector): Promise<readonly UserAnnotationWorkItem[]> {
	const work = await readWork(workspaceCwd); if (selector === undefined) {return work.sort(compareWork);}
	const agent = await resolveAgentSelector(workspaceCwd, selector); return work.filter(item => item.agentId === agent.id).sort(compareWork);
}
export async function deleteWork(input: { workspaceCwd: string; userAnnotationId: string }): Promise<UserAnnotationWorkItem | undefined> {
	return withStoreLock(input.workspaceCwd, defaultServices, async () => {
		const expectedId = asUserAnnotationId(input.userAnnotationId);
		const file = workFilePath(input.workspaceCwd, expectedId);
		const item = await readOptional(file, validateWorkItem);
		if (item === undefined) {return undefined;}
		if (item.id !== expectedId) {throw new AgentStoreValidationError('User work identity does not match its filename.');}
		await rm(file);
		return item;
	});
}
export async function showWork(workspaceCwd: string, userAnnotationId: string): Promise<UserAnnotationWorkItem> { const expectedId = asUserAnnotationId(userAnnotationId); const item = await readOptional(workFilePath(workspaceCwd, expectedId), validateWorkItem); if (item === undefined) {throw new AgentStoreConflictError('not_found', `Work not found: ${userAnnotationId}`);} if (item.id !== expectedId) {throw new AgentStoreValidationError('User work identity does not match its filename.');} return item; }
export async function getAgentTranscript(workspaceCwd: string, selector: AgentSelector): Promise<AgentTranscript> { const agent = await resolveAgentSelector(workspaceCwd, selector); if (agent.currentSessionId === undefined) {return { agentId: agent.id, state: 'missing', entries: [] };} const session = await readSessionRequired(workspaceCwd, agent.currentSessionId); return { agentId: agent.id, sessionId: session.id, state: session.state, entries: session.state === 'available' ? session.transcript : [] }; }
export async function setSessionTranscript(input: { workspaceCwd: string; agentSessionId: string; entries: readonly TranscriptEntry[] }): Promise<AgentSessionRecord> { return withStoreLock(input.workspaceCwd, defaultServices, async () => { const session = await readSessionRequired(input.workspaceCwd, input.agentSessionId); if (session.state !== 'available') {throw new AgentStoreConflictError('missing_session', 'Transcript cannot be updated without an active provider session.', session);} if (!input.entries.every(isTranscriptEntry)) {throw new AgentStoreValidationError('Malformed normalized transcript.');} const next = { ...session, transcript: input.entries, updatedAt: defaultServices.now().toISOString() }; await replaceDocument(sessionFilePath(input.workspaceCwd, session.id), next); return next; }); }

async function mutateAssigned(input: AssignmentInput, mutation: (item: UserAnnotationWorkItem) => UserAnnotationWorkItem, requireActiveSession = false): Promise<UserAnnotationWorkItem> { return withStoreLock(input.workspaceCwd, defaultServices, async () => { const item = await showWork(input.workspaceCwd, input.userAnnotationId); if ((input.agentId !== undefined && item.agentId !== input.agentId) || item.status !== 'working' || item.assignment?.sessionId !== input.agentSessionId || item.assignment.sequence !== input.assignmentSequence) {throw new AgentStoreConflictError('stale_assignment', 'The assignment is stale or no longer working.', item);} if (requireActiveSession) { const session = await readSessionRequired(input.workspaceCwd, input.agentSessionId); const agent = selectAgent(await readAgents(input.workspaceCwd), item.agentId); if (session.state !== 'available' || session.agentId !== item.agentId || agent.currentSessionId !== session.id) {throw new AgentStoreConflictError('stale_assignment', 'The invoking session is no longer active for this assignment.', item);} } const next = mutation(item); if (next !== item) {await replaceDocument(workFilePath(input.workspaceCwd, item.id), next);} return next; }); }
async function mutateWork(cwd: string, id: string, mutation: (item: UserAnnotationWorkItem) => UserAnnotationWorkItem): Promise<UserAnnotationWorkItem> { return withStoreLock(cwd, defaultServices, async () => { const item = await showWork(cwd, id); const next = mutation(item); if (next !== item) {await replaceDocument(workFilePath(cwd, id), next);} return next; }); }
function transitionAssigned(item: UserAnnotationWorkItem, status: WorkStatus, kind: WorkUpdateKind, message: string): UserAnnotationWorkItem { const at = defaultServices.now().toISOString(); const cleaned = nonEmpty(message.trim(), 'work update'); return { ...item, status, updatedAt: at, updates: [...item.updates, { at, kind, message: cleaned }] }; }
function requeueItem(item: UserAnnotationWorkItem, reason: string): UserAnnotationWorkItem { const { assignment: _assignment, ...rest } = item; return transitionAssigned(rest as UserAnnotationWorkItem, 'waiting', 'requeued', reason); }

async function projectAgentSummaries(cwd: string, agents: readonly NamedAgent[]): Promise<AgentSummary[]> { const all = await readWork(cwd); const projected: AgentSummary[] = []; for (const agent of [...agents].sort((a, b) => a.slot - b.slot)) { const work = all.filter(item => item.agentId === agent.id); const working = work.filter(item => item.status === 'working'); if (working.length > 1) {throw new AgentStoreValidationError(`Agent ${agent.id} has more than one working item.`);} const current = working[0]; const session = agent.currentSessionId === undefined ? undefined : await readSessionRequired(cwd, agent.currentSessionId); if (session !== undefined && session.agentId !== agent.id) {throw new AgentStoreValidationError(`Agent ${agent.id} references another agent's session.`);} const sessionSummary: AgentSessionSummary = session === undefined ? { state: 'missing' } : session.state === 'missing' ? { state: 'missing', id: session.id } : { state: session.state, id: session.id, provider: session.provider }; projected.push({ id: agent.id, slot: agent.slot, name: agent.name, session: sessionSummary, queue: { waiting: work.filter(x => x.status === 'waiting').length, working: working.length, completed: work.filter(x => x.status === 'completed').length }, ...(current === undefined ? {} : { currentWork: workSummary(current) }), controls: { canRename: true, canEnsureSession: session?.state !== 'available', canOpen: session?.state === 'available', canInterrupt: current !== undefined, canReset: session !== undefined } }); } return projected; }
function workSummary(item: UserAnnotationWorkItem): WorkSummary { return { id: item.id, agentId: item.agentId, status: item.status, ready: item.ready, enqueuedAt: item.enqueuedAt, updatedAt: item.updatedAt, latestUpdate: item.updates[item.updates.length - 1], ...(item.assignment === undefined ? {} : { assignment: item.assignment }) }; }

async function readAgents(cwd: string): Promise<NamedAgent[]> { const agents = await readDocuments(storePaths(cwd).agents, validateNamedAgent); if (!unique(agents.map(agent => agent.id)) || !unique(agents.map(agent => agent.slot)) || !unique(agents.map(agent => fold(agent.name)))) {throw new AgentStoreValidationError('Logical agent identities, slots, and names must be unique.');} return agents; }
async function readWork(cwd: string): Promise<UserAnnotationWorkItem[]> { const work = await readDocuments(storePaths(cwd).work, validateWorkItem); if (!unique(work.map(item => item.id))) {throw new AgentStoreValidationError('User work identities must be unique.');} if (!unique(work.filter(item => item.status === 'working').map(item => item.agentId))) {throw new AgentStoreValidationError('A logical agent may have at most one working item.');} if (work.length > 0) { const agentIds = new Set((await readAgents(cwd)).map(agent => agent.id)); if (work.some(item => !agentIds.has(item.agentId))) {throw new AgentStoreValidationError('Work targets an unknown logical agent.');} } return work; }
async function readSessionRequired(cwd: string, id: string): Promise<AgentSessionRecord> { const expectedId = asAgentSessionId(id); const session = await readOptional(sessionFilePath(cwd, expectedId), validateSessionRecord); if (session === undefined) {throw new AgentStoreValidationError(`Current session file is missing: ${id}`);} if (session.id !== expectedId) {throw new AgentStoreValidationError('Managed session identity does not match its filename.');} return session; }
async function readDocuments<T extends { readonly id: string }>(directory: string, validate: (value: unknown) => asserts value is T): Promise<T[]> { let names: string[]; try { names = await readdir(directory); } catch (error) { if (nodeCode(error) === 'ENOENT') {return [];} throw error; } const result: T[] = []; for (const name of names.filter(file => file.endsWith('.json')).sort()) { const value: unknown = JSON.parse(await readFile(path.join(directory, name), 'utf8')); validate(value); if (`${value.id}.json` !== name) {throw new AgentStoreValidationError(`Stored identity does not match filename: ${name}`);} result.push(value); } return result; }
async function readOptional<T>(file: string, validate: (value: unknown) => asserts value is T): Promise<T | undefined> { try { const value: unknown = JSON.parse(await readFile(file, 'utf8')); validate(value); return value; } catch (error) { if (nodeCode(error) === 'ENOENT') {return undefined;} throw error; } }

function validateNamedAgent(value: unknown): asserts value is NamedAgent { if (!isRecord(value) || value.version !== 1 || !validOpaque(value.id) || !Number.isSafeInteger(value.slot) || (value.slot as number) < 1 || typeof value.name !== 'string' || validateAgentName(value.name) !== value.name || (value.currentSessionId !== undefined && !validOpaque(value.currentSessionId))) {throw new AgentStoreValidationError('Malformed logical agent file.');} }
function validateSessionRecord(value: unknown): asserts value is AgentSessionRecord { if (!isRecord(value) || value.version !== 1 || !validOpaque(value.id) || !validOpaque(value.agentId) || value.provider !== 'codex' || !['uninitialized', 'available', 'missing'].includes(String(value.state)) || !validTimestamp(value.createdAt) || !validTimestamp(value.updatedAt) || Date.parse(value.updatedAt) < Date.parse(value.createdAt) || !Array.isArray(value.transcript) || !value.transcript.every(isTranscriptEntry) || (value.providerSessionId !== undefined && (typeof value.providerSessionId !== 'string' || value.providerSessionId.trim() === '')) || (value.state === 'available' && typeof value.providerSessionId !== 'string') || (value.state === 'uninitialized' && (value.providerSessionId !== undefined || value.transcript.length !== 0))) {throw new AgentStoreValidationError('Malformed managed session file.');} }
function validateWorkItem(value: unknown): asserts value is UserAnnotationWorkItem { if (!isRecord(value) || value.version !== 1 || !validOpaque(value.id) || !validOpaque(value.agentId) || !['waiting', 'working', 'completed'].includes(String(value.status)) || typeof value.ready !== 'boolean' || !validTimestamp(value.enqueuedAt) || !validTimestamp(value.updatedAt) || Date.parse(value.updatedAt) < Date.parse(value.enqueuedAt) || !Number.isSafeInteger(value.lastAssignmentSequence) || (value.lastAssignmentSequence as number) < 0 || !Array.isArray(value.updates) || value.updates.length === 0 || !value.updates.every(isWorkUpdate) || !chronological(value.updates.map(update => update.at)) || value.updates[0].kind !== 'enqueued' || value.updates[0].at !== value.enqueuedAt || value.updates.at(-1)?.at !== value.updatedAt || !isRecord(value.source) || !isRecord(value.prompt)) {throw new AgentStoreValidationError('Malformed user work file.');} validateSource(value.source as unknown as WorkSource); validatePrompt(value.prompt as unknown as WorkPrompt); validateWorkLifecycle(value as unknown as UserAnnotationWorkItem); }
function validateSource(value: WorkSource): void { if (!isRecord(value) || typeof value.uri !== 'string' || value.uri.trim() === '' || (value.path !== undefined && !safeRelativePath(value.path)) || !Number.isSafeInteger(value.line) || value.line < 0 || typeof value.text !== 'string' || !isContext(value.before) || !isContext(value.after)) {throw new AgentStoreValidationError('Malformed work source.');} }
function validatePrompt(value: WorkPrompt): void { if (!isRecord(value) || !/^%(Q|F|W|R|C|T)$/.test(String(value.preset)) || !['line', 'project'].includes(String(value.scope)) || typeof value.text !== 'string' || value.text.trim() === '') {throw new AgentStoreValidationError('Malformed work prompt.');} }
function isContext(value: unknown): value is readonly string[] { return Array.isArray(value) && value.length <= 3 && value.every(line => typeof line === 'string' && line.trim() !== '' && !/[\r\n\u2028\u2029]/u.test(line)); }
function isWorkUpdate(value: unknown): value is WorkUpdate { return isRecord(value) && validTimestamp(value.at) && ['enqueued', 'ready', 'claimed', 'status', 'completed', 'requeued'].includes(String(value.kind)) && typeof value.message === 'string' && value.message.trim() !== ''; }
function isTranscriptEntry(value: unknown): value is TranscriptEntry { return isRecord(value) && ['user', 'assistant', 'system', 'tool'].includes(String(value.role)) && typeof value.text === 'string' && value.text.trim() !== '' && (value.timestamp === undefined || validTimestamp(value.timestamp)); }

function validateWorkLifecycle(item: UserAnnotationWorkItem): void {
	let status: WorkStatus = 'waiting';
	let ready = false;
	let readyAt: string | undefined;
	let assignmentCount = 0;
	let mostRecentClaimAt: string | undefined;
	for (let index = 1; index < item.updates.length; index += 1) {
		const update = item.updates[index];
		switch (update.kind) {
			case 'ready':
				if (ready || status !== 'waiting') {throw new AgentStoreValidationError('Work readiness history is inconsistent.');}
				ready = true; readyAt = update.at; break;
			case 'claimed':
				if (!ready || status !== 'waiting') {throw new AgentStoreValidationError('Work claim history is inconsistent.');}
				status = 'working'; assignmentCount += 1; mostRecentClaimAt = update.at; break;
			case 'status':
				if (status !== 'working') {throw new AgentStoreValidationError('A status update must belong to working work.');}
				break;
			case 'requeued':
				if (status !== 'working') {throw new AgentStoreValidationError('Work requeue history is inconsistent.');}
				status = 'waiting'; mostRecentClaimAt = undefined; break;
			case 'completed':
				if (status !== 'working' || index !== item.updates.length - 1) {throw new AgentStoreValidationError('Work completion history is inconsistent.');}
				status = 'completed'; break;
			case 'enqueued':
				throw new AgentStoreValidationError('Work may be enqueued only once.');
		}
	}
	if (item.ready !== ready || item.readyAt !== readyAt || item.status !== status || item.lastAssignmentSequence !== assignmentCount) {
		throw new AgentStoreValidationError('Work lifecycle fields do not match its update history.');
	}
	if (status === 'waiting') {
		if (item.assignment !== undefined) {throw new AgentStoreValidationError('Waiting work cannot retain assignment evidence.');}
		return;
	}
	const assignment = item.assignment;
	if (!isRecord(assignment) || !validOpaque(assignment.sessionId)
		|| !Number.isSafeInteger(assignment.sequence) || (assignment.sequence as number) !== assignmentCount
		|| !validTimestamp(assignment.claimedAt) || assignment.claimedAt !== mostRecentClaimAt) {
		throw new AgentStoreValidationError('Assigned work has malformed assignment evidence.');
	}
}

function parseOpaqueId(value: unknown, name: string): string { if (!validOpaque(value)) {throw new AgentStoreValidationError(`${name} must be a safe non-empty opaque id.`);} return value; }
function validOpaque(value: unknown): value is string { return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value); }
function unicodeLength(value: string): number { return [...value].length; }
function storePaths(workspaceCwd: string): StorePaths { if (!path.isAbsolute(workspaceCwd)) {throw new AgentStoreValidationError('workspaceCwd must be absolute.');} const root = path.join(path.resolve(workspaceCwd), '.sundial', 'agents'); return { root, lock: path.join(root, '.lock'), agents: path.join(root, 'agents'), work: path.join(root, 'work'), sessions: path.join(root, 'sessions') }; }
function selectAgent(agents: readonly NamedAgent[], selector: AgentSelector): NamedAgent { const matches = typeof selector === 'number' ? agents.filter(agent => agent.slot === selector) : agents.filter(agent => agent.id === selector || fold(agent.name) === fold(selector)); if (matches.length === 0) {throw new AgentStoreConflictError('not_found', 'Unknown agent selector.');} if (matches.length > 1) {throw new AgentStoreConflictError('state_conflict', 'Ambiguous agent selector.');} return matches[0]; }
function uniqueAgentName(base: string, agents: readonly NamedAgent[]): string { let name = base; let suffix = 2; while (agents.some(agent => fold(agent.name) === fold(name))) {name = `${base} ${suffix++}`;} return name; }
function fold(value: string): string { return value.toLocaleLowerCase(); }
function compareWork(a: UserAnnotationWorkItem, b: UserAnnotationWorkItem): number { return a.enqueuedAt.localeCompare(b.enqueuedAt) || a.id.localeCompare(b.id); }
function chronological(timestamps: readonly string[]): boolean { return timestamps.every((timestamp, index) => index === 0 || Date.parse(timestamp) >= Date.parse(timestamps[index - 1])); }
function validTimestamp(value: unknown): value is string { return typeof value === 'string' && value !== '' && !Number.isNaN(Date.parse(value)); }
function unique(values: readonly (string | number)[]): boolean { return new Set(values).size === values.length; }
function safeRelativePath(value: unknown): value is string { return typeof value === 'string' && value.trim() !== '' && !path.isAbsolute(value) && !value.split(/[\\/]/u).some(segment => segment === '..' || segment === ''); }
function nonEmpty(value: string, name: string): string { if (value.trim() === '') {throw new AgentStoreValidationError(`${name} must be non-empty.`);} return value; }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function nodeCode(error: unknown): string | undefined { return error instanceof Error && 'code' in error ? String(error.code) : undefined; }
async function createDocument(file: string, value: unknown): Promise<void> { await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' }); }
async function replaceDocument(file: string, value: unknown): Promise<void> { await mkdir(path.dirname(file), { recursive: true }); const temporary = `${file}.tmp-${process.pid}-${randomUUID()}`; try { await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' }); await rename(temporary, file); } finally { await rm(temporary, { force: true }); } }
async function withStoreLock<T>(cwd: string, services: AgentStoreServices, operation: () => Promise<T>): Promise<T> { const paths = storePaths(cwd); await mkdir(paths.root, { recursive: true }); const started = Date.now(); while (true) { try { await mkdir(paths.lock); break; } catch (error) { if (nodeCode(error) !== 'EEXIST') {throw error;} try { const info = await stat(paths.lock); if (Date.now() - info.mtimeMs > services.staleLockMs) {await rm(paths.lock, { recursive: true, force: true });} } catch { /* retry */ } if (Date.now() - started > services.lockTimeoutMs) {throw new AgentStoreConflictError('state_conflict', 'Timed out waiting for agent-store lock.');} await services.sleep(10); } } try { return await operation(); } finally { await rm(paths.lock, { recursive: true, force: true }); } }
