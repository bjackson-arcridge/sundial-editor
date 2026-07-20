import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import {
	isNamedAgent,
	isUserAnnotationWorkItem,
	parseAgentTranscript,
	parseNamedAgent,
	parseUserAnnotationWorkItem,
	type AgentId,
	type AgentSessionId,
	type AgentTranscript,
	type NamedAgent,
	type UserAnnotationId,
	type UserAnnotationWorkItem,
} from './agentProtocol';
import type { PromptContext } from './promptCommand';
import {
	parseAnnotationCompanion,
	parseUserAnnotation,
	type AnnotationAppendRequest,
	type AnnotationCompanion,
	type AnnotationDeleteRequest,
	type AnnotationReadRequest,
	type UserAnnotation,
} from './annotationProtocol';

export interface ManagedAgentRunRequest {
	readonly cliPath: string;
	readonly cwd: string;
	readonly agentId: AgentId;
	readonly agentSessionId: AgentSessionId;
	readonly userAnnotationId: UserAnnotationId;
	readonly assignmentSequence: number;
	readonly provider?: 'codex';
	readonly model?: string;
}

export interface AgentRunEvent {
	readonly kind: 'status' | 'output' | 'error';
	readonly status?: 'waiting' | 'working' | 'blocked';
	readonly message?: string;
	readonly text?: string;
	readonly recoverable?: boolean;
}

export interface AgentRun {
	readonly completion: Promise<{ readonly exitCode: number; readonly stderr: string }>;
	readonly cancel: () => void;
}

export interface CliProcessServices {
	readonly spawn: (command: string, args: readonly string[], options: { readonly cwd: string }) => ChildProcessWithoutNullStreams;
	readonly nodeExecutable: string;
}

export interface WorkEnqueueInput {
	readonly userAnnotationId?: UserAnnotationId;
	readonly source: UserAnnotationWorkItem['source'];
	readonly prompt: UserAnnotationWorkItem['prompt'];
}

export interface WorkTransitionInput {
	readonly agentId: AgentId;
	readonly sessionId: AgentSessionId;
	readonly workId: UserAnnotationId;
	readonly assignmentSequence: number;
}

export interface OpenAgentResult {
	readonly kind: 'terminal';
	readonly command: string;
	readonly args: readonly string[];
}

export class CliConflictError extends Error {
	constructor(
		readonly code: string,
		message: string,
		readonly current?: unknown,
	) {
		super(message);
		this.name = 'CliConflictError';
	}
}

export function startManagedAgentRun(
	request: ManagedAgentRunRequest,
	onEvent: (event: AgentRunEvent) => void,
	services: CliProcessServices = defaultServices,
): AgentRun {
	const invocation = resolveCliInvocation(request.cliPath, services.nodeExecutable, ['prompt']);
	const child = services.spawn(invocation.command, invocation.args, { cwd: request.cwd });
	let stderr = '';
	let stdoutBuffer = '';
	let settled = false;

	child.stderr.on('data', chunk => { stderr += String(chunk); });
	child.stdout.on('data', chunk => {
		stdoutBuffer += String(chunk);
		let newline = stdoutBuffer.indexOf('\n');
		while (newline >= 0) {
			const line = stdoutBuffer.slice(0, newline).trim();
			stdoutBuffer = stdoutBuffer.slice(newline + 1);
			const event = parseAgentRunEvent(line);
			if (event !== undefined) {
				onEvent(event);
			}
			newline = stdoutBuffer.indexOf('\n');
		}
	});

	const completion = new Promise<{ exitCode: number; stderr: string }>((resolve, reject) => {
		child.once('error', error => {
			if (!settled) {
				settled = true;
				reject(new Error(errorMessageForStart(error, request.cliPath)));
			}
		});
		child.once('exit', code => {
			if (!settled) {
				settled = true;
				resolve({ exitCode: code ?? 1, stderr: stderr.trim() });
			}
		});
	});

	child.stdin.end(JSON.stringify({
		provider: request.provider ?? 'codex',
		...(request.model === undefined ? {} : { model: request.model }),
		workspace: { cwd: request.cwd },
		managed: {
			agentId: request.agentId,
			agentSessionId: request.agentSessionId,
			userAnnotationId: request.userAnnotationId,
			assignmentSequence: request.assignmentSequence,
		},
	}));

	return {
		completion,
		cancel: () => { if (!settled) { child.kill('SIGINT'); } },
	};
}

export function resolveCliInvocation(
	cliPath: string,
	nodeExecutable: string,
	args: readonly string[] = ['prompt'],
): { command: string; args: string[] } {
	return cliPath.endsWith('.js')
		? { command: nodeExecutable, args: [cliPath, ...args] }
		: { command: cliPath, args: [...args] };
}

export async function appendAnnotationViaCli(
	cliPath: string,
	request: AnnotationAppendRequest,
	services: CliProcessServices = defaultServices,
): Promise<UserAnnotation> {
	return parseUserAnnotation(await invokeJsonCommand(cliPath, request.workspace.cwd, ['annotations', 'append'], request, services));
}

export async function readAnnotationsViaCli(
	cliPath: string,
	request: AnnotationReadRequest,
	services: CliProcessServices = defaultServices,
): Promise<AnnotationCompanion> {
	return parseAnnotationCompanion(await invokeJsonCommand(cliPath, request.workspace.cwd, ['annotations', 'read'], request, services));
}

export async function deleteAnnotationViaCli(
	cliPath: string,
	request: AnnotationDeleteRequest,
	services: CliProcessServices = defaultServices,
): Promise<UserAnnotation> {
	return parseUserAnnotation(await invokeJsonCommand(cliPath, request.workspace.cwd, ['annotations', 'delete'], request, services));
}

export async function listAgentsViaCli(
	cliPath: string,
	cwd: string,
	services: CliProcessServices = defaultServices,
): Promise<readonly NamedAgent[]> {
	const value = await invokeJsonCommand(cliPath, cwd, ['agent', 'list'], { workspace: { cwd } }, services);
	const agents = isRecord(value) ? value.agents : undefined;
	if (!Array.isArray(agents) || !agents.every(isNamedAgent)) {
		throw new Error('Sundial Editor CLI returned a malformed agent list.');
	}
	return agents;
}

export async function renameAgentViaCli(
	cliPath: string,
	cwd: string,
	agentId: AgentId,
	name: string,
	services: CliProcessServices = defaultServices,
): Promise<NamedAgent> {
	return parseNamedAgent(await invokeJsonCommand(cliPath, cwd, ['agent', 'rename'], {
		workspace: { cwd }, agent: { id: agentId }, name,
	}, services));
}

export async function ensureAgentSessionViaCli(
	cliPath: string,
	cwd: string,
	agentId: AgentId,
	services: CliProcessServices = defaultServices,
): Promise<NamedAgent> {
	const value = await invokeJsonCommand(cliPath, cwd, ['agent', 'session', 'ensure'], {
		workspace: { cwd }, agent: { id: agentId }, confirmedFreshSession: true,
	}, services);
	if (!isRecord(value)) {
		throw new Error('Sundial Editor CLI returned a malformed session result.');
	}
	return parseNamedAgent(value.agent);
}

export async function enqueueWorkViaCli(
	cliPath: string,
	cwd: string,
	agentId: AgentId,
	work: WorkEnqueueInput,
	services: CliProcessServices = defaultServices,
): Promise<UserAnnotationWorkItem> {
	return parseUserAnnotationWorkItem(await invokeJsonCommand(cliPath, cwd, ['agent', 'work', 'enqueue'], {
		workspace: { cwd }, agent: { id: agentId }, work,
	}, services));
}

export async function markWorkReadyViaCli(
	cliPath: string,
	cwd: string,
	workId: UserAnnotationId,
	agentId: AgentId,
	services: CliProcessServices = defaultServices,
): Promise<UserAnnotationWorkItem> {
	return parseUserAnnotationWorkItem(await invokeJsonCommand(cliPath, cwd, ['agent', 'work', 'ready'], {
		workspace: { cwd }, agentId, work: { id: workId },
	}, services));
}

export async function listWorkViaCli(
	cliPath: string,
	cwd: string,
	services: CliProcessServices = defaultServices,
): Promise<readonly UserAnnotationWorkItem[]> {
	const value = await invokeJsonCommand(cliPath, cwd, ['agent', 'work', 'list'], { workspace: { cwd } }, services);
	const work = isRecord(value) ? value.work : undefined;
	if (!Array.isArray(work) || !work.every(isUserAnnotationWorkItem)) {
		throw new Error('Sundial Editor CLI returned a malformed work list.');
	}
	return work;
}

export async function claimWorkViaCli(
	cliPath: string,
	cwd: string,
	agentId: AgentId,
	services: CliProcessServices = defaultServices,
): Promise<UserAnnotationWorkItem | undefined> {
	const value = await invokeJsonCommand(cliPath, cwd, ['agent', 'work', 'claim'], {
		workspace: { cwd }, agent: { id: agentId },
	}, services);
	if (!isRecord(value) || !Object.hasOwn(value, 'work')) {
		throw new Error('Sundial Editor CLI returned a malformed claim result.');
	}
	return value.work === null || value.work === undefined ? undefined : parseUserAnnotationWorkItem(value.work);
}

export async function completeWorkViaCli(
	cliPath: string,
	cwd: string,
	transition: WorkTransitionInput,
	update: string,
	services: CliProcessServices = defaultServices,
): Promise<UserAnnotationWorkItem> {
	return transitionWork(cliPath, cwd, 'complete', transition, { finalUpdate: update }, services);
}

export async function requeueWorkViaCli(
	cliPath: string,
	cwd: string,
	transition: WorkTransitionInput,
	reason: string,
	services: CliProcessServices = defaultServices,
): Promise<UserAnnotationWorkItem> {
	return transitionWork(cliPath, cwd, 'requeue', transition, { reason }, services);
}

export async function transcriptViaCli(
	cliPath: string,
	cwd: string,
	agentId: AgentId,
	services: CliProcessServices = defaultServices,
): Promise<AgentTranscript> {
	return parseAgentTranscript(await invokeJsonCommand(cliPath, cwd, ['agent', 'transcript'], {
		workspace: { cwd }, agent: { id: agentId },
	}, services));
}

export async function openAgentViaCli(
	cliPath: string,
	cwd: string,
	agentId: AgentId,
	services: CliProcessServices = defaultServices,
): Promise<OpenAgentResult> {
	const value = await invokeJsonCommand(cliPath, cwd, ['agent', 'open'], {
		workspace: { cwd }, agent: { id: agentId },
	}, services);
	if (!isRecord(value) || value.state !== 'available' || value.kind !== 'terminal' || typeof value.command !== 'string'
		|| !Array.isArray(value.args) || !value.args.every(argument => typeof argument === 'string')) {
		throw new Error('Sundial Editor CLI returned a malformed open-agent result.');
	}
	return { kind: 'terminal', command: value.command, args: value.args as string[] };
}

export async function interruptAgentViaCli(
	cliPath: string,
	cwd: string,
	agentId: AgentId,
	services: CliProcessServices = defaultServices,
): Promise<void> {
	await invokeJsonCommand(cliPath, cwd, ['agent', 'interrupt'], { workspace: { cwd }, agent: { id: agentId } }, services);
}

export async function resetAgentViaCli(
	cliPath: string,
	cwd: string,
	agentId: AgentId,
	services: CliProcessServices = defaultServices,
): Promise<NamedAgent> {
	return parseNamedAgent(await invokeJsonCommand(cliPath, cwd, ['agent', 'reset'], {
		workspace: { cwd }, agent: { id: agentId },
	}, services));
}

export function parseAgentRunEvent(line: string): AgentRunEvent | undefined {
	let value: unknown;
	try { value = JSON.parse(line); } catch { return undefined; }
	if (!isRecord(value)) { return undefined; }
	if (value.kind === 'status'
		&& (value.status === 'waiting' || value.status === 'working' || value.status === 'blocked')
		&& (value.message === undefined || typeof value.message === 'string')) {
		return value as unknown as AgentRunEvent;
	}
	if (value.kind === 'output' && typeof value.text === 'string') {
		return value as unknown as AgentRunEvent;
	}
	if (value.kind === 'error' && typeof value.message === 'string' && typeof value.recoverable === 'boolean') {
		return value as unknown as AgentRunEvent;
	}
	return undefined;
}

const defaultServices: CliProcessServices = {
	spawn: (command, args, options) => spawn(command, args, { cwd: options.cwd, stdio: ['pipe', 'pipe', 'pipe'] }),
	nodeExecutable: process.execPath,
};

async function transitionWork(
	cliPath: string,
	cwd: string,
	operation: 'complete' | 'requeue',
	transition: WorkTransitionInput,
	extra: { readonly finalUpdate: string } | { readonly reason: string },
	services: CliProcessServices,
): Promise<UserAnnotationWorkItem> {
	return parseUserAnnotationWorkItem(await invokeJsonCommand(cliPath, cwd, ['agent', 'work', operation], {
		workspace: { cwd },
		agent: { id: transition.agentId },
		work: {
			id: transition.workId,
			agentSessionId: transition.sessionId,
			assignmentSequence: transition.assignmentSequence,
		},
		...extra,
	}, services));
}

async function invokeJsonCommand(
	cliPath: string,
	cwd: string,
	args: readonly string[],
	request: unknown,
	services: CliProcessServices,
): Promise<unknown> {
	const invocation = resolveCliInvocation(cliPath, services.nodeExecutable, args);
	const child = services.spawn(invocation.command, invocation.args, { cwd });
	let stdout = '';
	let stderr = '';
	child.stdout.on('data', chunk => { stdout += String(chunk); });
	child.stderr.on('data', chunk => { stderr += String(chunk); });
	child.stdin.end(JSON.stringify(request));
	const exitCode = await new Promise<number>((resolve, reject) => {
		let settled = false;
		child.once('error', error => {
			if (!settled) { settled = true; reject(new Error(errorMessageForStart(error, cliPath))); }
		});
		child.once('exit', code => {
			if (!settled) { settled = true; resolve(code ?? 1); }
		});
	});
	if (exitCode !== 0) {
		const conflict = parseCliConflict(stdout);
		if (conflict !== undefined) { throw conflict; }
		throw new Error(stderr.trim() || `Sundial Editor CLI exited with code ${exitCode}.`);
	}
	try { return JSON.parse(stdout); } catch { throw new Error('Sundial Editor CLI returned invalid JSON.'); }
}

function parseCliConflict(stdout: string): CliConflictError | undefined {
	if (stdout.trim() === '') { return undefined; }
	try {
		const value: unknown = JSON.parse(stdout);
		if (isRecord(value) && value.kind === 'conflict' && typeof value.code === 'string'
			&& typeof value.message === 'string') {
			return new CliConflictError(value.code, value.message, value.current);
		}
	} catch {
		// A non-conflict failure may have emitted diagnostics that are not JSON.
	}
	return undefined;
}

function errorMessageForStart(error: Error, cliPath: string): string {
	return 'code' in error && error.code === 'ENOENT'
		? `Sundial Editor CLI was not found at ${cliPath}. Install @arcridge/sundial-editor-cli or configure sundialEditor.cliPath.`
		: `Sundial Editor CLI could not be started: ${error.message}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}
