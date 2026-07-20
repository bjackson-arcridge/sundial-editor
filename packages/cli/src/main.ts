import { readFile } from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCodexAdapter } from './adapters/codex.js';
import type { ProviderAdapter } from './adapters/adapter.js';
import {
	attachProviderSession,
	claimNextWork,
	completeWork,
	enqueueWork,
	ensureAgentSession,
	getAgentTranscript,
	listAgents,
	listWork,
	markProviderSessionMissing,
	markWorkReady,
	renameAgent,
	requeueWork,
	resetAgentSession,
	setSessionTranscript,
	showAgent,
	showWork,
	AgentStoreConflictError,
	type AgentDetail,
	type AgentSelector,
	type WorkItem,
} from './agentStore.js';
import { appendUserAnnotation, deleteUserAnnotation, readUserAnnotations } from './annotations.js';
import { renderManagedAgentContract, renderManagedPrompt } from './managedPrompts.js';
import { isManagedPromptRequest, parseCliPromptRequest, renderEvent } from './protocol.js';
import { packageVersion } from './version.js';

export interface CliIo {
	readonly stdin: NodeJS.ReadableStream;
	readonly stdout: { write(chunk: string): unknown };
	readonly stderr: { write(chunk: string): unknown };
}

export interface MainServices {
	readonly adapters: Readonly<Record<string, ProviderAdapter>>;
	readonly readFile: (path: string) => Promise<string>;
	readonly appendUserAnnotation?: typeof appendUserAnnotation;
	readonly deleteUserAnnotation?: typeof deleteUserAnnotation;
	readonly readUserAnnotations?: typeof readUserAnnotations;
}

const defaultServices: MainServices = {
	adapters: { codex: createCodexAdapter() },
	readFile: path => readFile(path, 'utf8'),
};

const helpText = `Sundial Editor CLI ${packageVersion}

Usage:
  sundial-editor-cli --version
  sundial-editor-cli help
  sundial-editor-cli health [--provider codex] [--refresh]
  sundial-editor-cli prompt [--input request.json]
  sundial-editor-cli annotations append [--input request.json]
  sundial-editor-cli annotations read [--input request.json]
  sundial-editor-cli annotations delete [--input request.json]
  sundial-editor-cli agent list [--input request.json]
  sundial-editor-cli agent show [--input request.json]
  sundial-editor-cli agent rename [--input request.json]
  sundial-editor-cli agent session ensure [--input request.json]
  sundial-editor-cli agent work enqueue [--input request.json]
  sundial-editor-cli agent work ready [--input request.json]
  sundial-editor-cli agent work list [--input request.json]
  sundial-editor-cli agent work show [--input request.json]
  sundial-editor-cli agent work claim [--input request.json]
  sundial-editor-cli agent work complete [--input request.json]
  sundial-editor-cli agent work requeue [--input request.json]
  sundial-editor-cli agent transcript [--input request.json]
  sundial-editor-cli agent open [--input request.json]
  sundial-editor-cli agent interrupt [--input request.json]
  sundial-editor-cli agent reset [--input request.json]

Machine commands read one JSON request from stdin or --input and write one JSON
result to stdout. prompt emits newline-delimited status, output, and error events.
Runtime agent, session, queue, transcript, and work-update state is CLI-owned.
`;

export async function main(argv: readonly string[], io: CliIo, services: MainServices = defaultServices): Promise<number> {
	const [command, ...args] = argv;
	if (command === '--version' || command === '-v') { io.stdout.write(`${packageVersion}\n`); return 0; }
	if (command === undefined || command === 'help' || command === '--help' || command === '-h') { io.stdout.write(helpText); return 0; }
	if (command === 'health') {return health(args, io, services);}
	if (command === 'prompt') {return prompt(args, io, services);}
	if (command === 'annotations') {return annotations(args, io, services);}
	if (command === 'agent') {return agent(args, io, services);}
	io.stderr.write(`Unknown command: ${command}\nRun sundial-editor-cli help for usage.\n`); return 2;
}

async function health(args: readonly string[], io: CliIo, services: MainServices): Promise<number> {
	try {
		const provider = optionValue(args, '--provider') ?? 'codex';
		const refresh = args.includes('--refresh');
		const expectedLength = (args.includes('--provider') ? 2 : 0) + (refresh ? 1 : 0);
		if (args.length !== expectedLength) {throw new Error(`Unexpected health arguments: ${args.join(' ')}`);}
		const adapter = services.adapters[provider]; if (adapter === undefined) {throw new Error(`Unsupported provider: ${provider}`);}
		const providerHealth = await adapter.health({ forceRefresh: refresh });
		writeJson(io, { kind: 'capabilities', protocolVersion: 2, workStatuses: ['waiting', 'working', 'completed'], providers: [provider], commands: editorCommands, health: providerHealth });
		return providerHealth.available && providerHealth.compatible ? 0 : 1;
	} catch (error) { io.stderr.write(`${errorMessage(error)}\n`); return 2; }
}

const editorCommands = [
	'annotations append', 'annotations read', 'annotations delete',
	'agent list', 'agent show', 'agent rename', 'agent session ensure',
	'agent work enqueue', 'agent work ready', 'agent work list', 'agent work show', 'agent work claim', 'agent work complete', 'agent work requeue',
	'agent transcript', 'agent open', 'agent interrupt', 'agent reset', 'prompt',
] as const;

async function annotations(args: readonly string[], io: CliIo, services: MainServices): Promise<number> {
	try {
		const [operation, ...rest] = args;
		if (operation !== 'append' && operation !== 'delete' && operation !== 'read') {throw new Error('annotations requires append, delete, or read');}
		const request = await requestInput(rest, io, services, `annotations ${operation}`);
		const result = operation === 'append' ? await (services.appendUserAnnotation ?? appendUserAnnotation)(request)
			: operation === 'delete' ? await (services.deleteUserAnnotation ?? deleteUserAnnotation)(request)
				: await (services.readUserAnnotations ?? readUserAnnotations)(request);
		writeJson(io, result); return 0;
	} catch (error) { return machineFailure(io, error); }
}

async function agent(args: readonly string[], io: CliIo, services: MainServices): Promise<number> {
	try {
		const [section, maybeOperation, ...tail] = args;
		let operation: string; let rest: readonly string[];
		if (section === 'session' || section === 'work') { if (maybeOperation === undefined) {throw new Error(`agent ${section} requires an operation`);} operation = `${section} ${maybeOperation}`; rest = tail; }
		else { if (section === undefined) {throw new Error('agent requires an operation');} operation = section; rest = maybeOperation === undefined ? [] : [maybeOperation, ...tail]; }
		const request = await requestInput(rest, io, services, `agent ${operation}`, operation === 'list');
		const cwd = workspaceCwd(request);
		let result: unknown;
		switch (operation) {
			case 'list': result = { agents: await listAgents(cwd) }; break;
			case 'show': result = projectAgentDetail(await showAgent(cwd, selector(request))); break;
			case 'rename': result = await renameAgent({ workspaceCwd: cwd, selector: selector(request), name: stringField(request, 'name') }); break;
			case 'session ensure': result = await ensureSessionCommand(cwd, request, services); break;
			case 'work enqueue': result = projectWorkItem(await enqueueCommand(cwd, request)); break;
			case 'work ready': result = projectWorkItem(await markWorkReady({ workspaceCwd: cwd, userAnnotationId: workId(request), agentId: optionalString(request.agentId) })); break;
			case 'work list': result = { work: (await listWork(cwd, hasAgent(request) ? selector(request) : undefined)).map(projectWorkItem) }; break;
			case 'work show': result = projectWorkItem(await showWork(cwd, workId(request))); break;
			case 'work claim': {
				const work = await claimNextWork({ workspaceCwd: cwd, agentSelector: selector(request), expectedSessionId: optionalString(request.expectedSessionId) });
				result = { work: work === undefined ? null : projectWorkItem(work) };
				break;
			}
			case 'work complete': result = projectWorkItem(await completeWork({ ...assignment(request, cwd), finalUpdate: optionalString(request.finalUpdate) })); break;
			case 'work requeue': result = projectWorkItem(await requeueWork({ ...assignment(request, cwd), reason: stringField(request, 'reason') })); break;
			case 'transcript': result = await transcriptCommand(cwd, request, services); break;
			case 'open': result = await openCommand(cwd, request); break;
			case 'interrupt': result = await interruptCommand(cwd, request); break;
			case 'reset': result = await resetCommand(cwd, request, services); break;
			default: throw new Error(`Unknown agent operation: ${operation}`);
		}
		writeJson(io, result); return 0;
	} catch (error) { return machineFailure(io, error); }
}

async function ensureSessionCommand(cwd: string, request: Record<string, unknown>, services: MainServices): Promise<unknown> {
	const target = selector(request); let detail = await showAgent(cwd, target);
	if (detail.sessionFile?.state === 'available' && detail.sessionFile.providerSessionId !== undefined) {
		const adapter = requiredAdapter(services, detail.sessionFile.provider);
		if (adapter.readSession !== undefined) {
			const current = await adapter.readSession({ cwd, providerSessionId: detail.sessionFile.providerSessionId });
			if (!current.available) {
				await markProviderSessionMissing({ workspaceCwd: cwd, agentSessionId: detail.sessionFile.id });
				detail = await showAgent(cwd, target);
			}
		}
	}
	if (detail.session.state !== 'available' && request.confirmedFreshSession !== true) {throw new Error('No active session found; this operation will create a fresh session. Confirmation is required.');}
	if (detail.session.state === 'missing' && detail.session.id !== undefined) { await resetAgentSession({ workspaceCwd: cwd, selector: target, reason: 'Missing provider session replaced.' }); detail = await showAgent(cwd, target); }
	let session = await ensureAgentSession({ workspaceCwd: cwd, selector: target });
	if (session.state !== 'available') {
		const adapter = requiredAdapter(services, session.provider); if (adapter.createSession === undefined) {throw new Error('Provider cannot create managed sessions.');}
		const provider = await adapter.createSession({ cwd, model: optionalString(request.model), baseInstructions: renderManagedAgentContract(detail.name) });
		session = await attachProviderSession({ workspaceCwd: cwd, agentSessionId: session.id, providerSessionId: provider.providerSessionId });
	}
	return { agent: projectAgentDetail(await showAgent(cwd, target)), session: { id: session.id, state: session.state, provider: session.provider } };
}

async function enqueueCommand(cwd: string, request: Record<string, unknown>): Promise<WorkItem> {
	const work = recordField(request, 'work'); const source = recordField(work, 'source'); const promptValue = recordField(work, 'prompt');
	return enqueueWork({ workspaceCwd: cwd, agentSelector: selector(request), userAnnotationId: optionalString(work.userAnnotationId ?? work.id), source: {
		uri: stringField(source, 'uri'),
		path: workspaceRelativeSourcePath(cwd, stringField(source, 'uri'), optionalString(source.path)),
		line: integerField(source, 'line'), text: stringValue(source.text, 'source.text'), before: stringArray(source.before, 'source.before'), after: stringArray(source.after, 'source.after'),
	}, prompt: { preset: preset(promptValue.preset), scope: scope(promptValue.scope), text: stringField(promptValue, 'text') } });
}

async function transcriptCommand(cwd: string, request: Record<string, unknown>, services: MainServices): Promise<unknown> {
	const target = selector(request); const detail = await showAgent(cwd, target);
	if (detail.sessionFile?.state !== 'available' || detail.sessionFile.providerSessionId === undefined) {return getAgentTranscript(cwd, target);}
	const adapter = requiredAdapter(services, detail.sessionFile.provider); if (adapter.readSession === undefined) {return getAgentTranscript(cwd, target);}
	const read = await adapter.readSession({ cwd, providerSessionId: detail.sessionFile.providerSessionId });
	if (!read.available) { await markProviderSessionMissing({ workspaceCwd: cwd, agentSessionId: detail.sessionFile.id }); return getAgentTranscript(cwd, target); }
	await setSessionTranscript({ workspaceCwd: cwd, agentSessionId: detail.sessionFile.id, entries: read.transcript.map(entry => ({ role: entry.role === 'agent' ? 'assistant' : entry.role, text: entry.text })) });
	return getAgentTranscript(cwd, target);
}

async function openCommand(cwd: string, request: Record<string, unknown>): Promise<unknown> {
	const detail = await showAgent(cwd, selector(request));
	if (detail.sessionFile?.state !== 'available' || detail.sessionFile.providerSessionId === undefined) {return { state: 'missing session' };}
	return { state: 'available', kind: 'terminal', command: 'codex', args: ['resume', detail.sessionFile.providerSessionId] };
}

async function interruptCommand(cwd: string, request: Record<string, unknown>): Promise<unknown> {
	const detail = await showAgent(cwd, selector(request)); const current = detail.currentWork;
	if (current?.assignment === undefined) {return { interrupted: false, agent: projectAgentDetail(detail) };}
	const work = await requeueWork({ workspaceCwd: cwd, agentId: detail.id, userAnnotationId: current.id, agentSessionId: current.assignment.sessionId, assignmentSequence: current.assignment.sequence, reason: 'Interrupted by the user.' });
	return { interrupted: true, work: projectWorkItem(work), agent: projectAgentDetail(await showAgent(cwd, detail.id)) };
}

async function resetCommand(cwd: string, request: Record<string, unknown>, services: MainServices): Promise<unknown> {
	const target = selector(request); const before = await showAgent(cwd, target);
	const reset = await resetAgentSession({ workspaceCwd: cwd, selector: target, reason: 'Agent session reset by the user.' }); const session = reset.session;
	const adapter = requiredAdapter(services, session.provider); if (adapter.createSession === undefined) {throw new Error('Provider cannot create managed sessions.');}
	const provider = await adapter.createSession({ cwd, model: optionalString(request.model), baseInstructions: renderManagedAgentContract(before.name) });
	await attachProviderSession({ workspaceCwd: cwd, agentSessionId: session.id, providerSessionId: provider.providerSessionId });
	return projectAgentDetail(await showAgent(cwd, target));
}

async function prompt(args: readonly string[], io: CliIo, services: MainServices): Promise<number> {
	try {
		const request = parseCliPromptRequest(await requestInput(args, io, services, 'prompt'));
		const adapter = requiredAdapter(services, request.provider); const abortController = new AbortController(); const abort = (): void => abortController.abort(); process.once('SIGINT', abort); process.once('SIGTERM', abort);
		try {
			if (!isManagedPromptRequest(request)) {await adapter.run(request, event => io.stdout.write(`${renderEvent(event)}\n`), abortController.signal);}
			else {await runManagedPrompt(request, adapter, io, abortController.signal);}
			io.stdout.write(`${renderEvent({ kind: 'status', status: 'waiting' })}\n`); return 0;
		} finally { process.removeListener('SIGINT', abort); process.removeListener('SIGTERM', abort); }
	} catch (error) {
		const message = error instanceof SyntaxError ? `Invalid JSON: ${error.message}` : errorMessage(error);
		io.stdout.write(`${renderEvent({ kind: 'status', status: 'blocked', message })}\n`);
		io.stdout.write(`${renderEvent({ kind: 'error', message, recoverable: true })}\n`);
		io.stderr.write(`sundial-editor-cli: ${message}\n`); return 1;
	}
}

async function runManagedPrompt(request: ReturnType<typeof parseCliPromptRequest> & { readonly managed: unknown }, adapter: ProviderAdapter, io: CliIo, signal: AbortSignal): Promise<void> {
	if (!isManagedPromptRequest(request)) {throw new Error('Expected managed prompt request.');}
	const work = await showWork(request.workspace.cwd, request.managed.userAnnotationId);
	if (work.agentId !== request.managed.agentId
		|| work.status !== 'working'
		|| work.assignment?.sessionId !== request.managed.agentSessionId
		|| work.assignment.sequence !== request.managed.assignmentSequence) {
		throw new Error('Managed assignment is stale or incompatible.');
	}
	const agentDetail = await showAgent(request.workspace.cwd, work.agentId); const session = agentDetail.sessionFile;
	if (session?.id !== work.assignment.sessionId || session.state !== 'available' || session.providerSessionId === undefined) {throw new Error('Managed provider session is missing.');}
	if (adapter.runSession === undefined) {throw new Error('Provider cannot resume managed sessions.');}
	const rendered = renderManagedPrompt({ agentName: agentDetail.name, preset: work.prompt.preset, scope: work.prompt.scope === 'project' ? 'project' : 'local', userRequest: work.prompt.text, sourcePath: work.source.path ?? work.source.uri, anchor: { line: work.source.line, text: work.source.text, before: work.source.before, after: work.source.after } });
	let result;
	try {
		result = await adapter.runSession({ cwd: request.workspace.cwd, providerSessionId: session.providerSessionId, prompt: rendered, model: request.model, invocationEnvironment: {
			SUNDIAL_WORKSPACE_CWD: request.workspace.cwd, SUNDIAL_AGENT_SESSION_ID: session.id, SUNDIAL_USER_ANNOTATION_ID: work.id, SUNDIAL_ASSIGNMENT_SEQUENCE: String(work.assignment.sequence),
		} }, event => io.stdout.write(`${renderEvent(event)}\n`), signal);
	} catch (error) {
		if (isMissingProviderSession(error)) {
			await markProviderSessionMissing({ workspaceCwd: request.workspace.cwd, agentSessionId: session.id });
		}
		throw error;
	}
	if (result.outcome === 'interrupted') {throw new Error('Provider turn was interrupted.');}
	if (adapter.readSession !== undefined) { const transcript = await adapter.readSession({ cwd: request.workspace.cwd, providerSessionId: session.providerSessionId }); if (transcript.available) {await setSessionTranscript({ workspaceCwd: request.workspace.cwd, agentSessionId: session.id, entries: transcript.transcript.map(entry => ({ role: entry.role === 'agent' ? 'assistant' : entry.role, text: entry.text })) });} }
}

function assignment(request: Record<string, unknown>, cwd: string) { const work = recordField(request, 'work'); return { workspaceCwd: cwd, agentId: explicitAgentId(request), userAnnotationId: stringValue(work.id ?? work.userAnnotationId, 'work.id'), agentSessionId: stringValue(work.agentSessionId ?? request.agentSessionId, 'work.agentSessionId'), assignmentSequence: integerValue(work.assignmentSequence ?? request.assignmentSequence, 'work.assignmentSequence') }; }
function workspaceCwd(request: Record<string, unknown>): string { return stringField(recordField(request, 'workspace'), 'cwd'); }
function selector(request: Record<string, unknown>): AgentSelector { const value = record(request.agent) ? request.agent : request; if (typeof value.agentId === 'string') {return value.agentId;} if (typeof value.id === 'string') {return value.id;} if (Number.isSafeInteger(value.slot) && (value.slot as number) >= 1) {return value.slot as number;} if (typeof value.name === 'string' && value.name.trim() !== '') {return value.name;} throw new Error('Request must identify an agent by id, slot, or name.'); }
function explicitAgentId(request: Record<string, unknown>): string { const value = record(request.agent) ? request.agent : request; return stringValue(value.id ?? value.agentId, 'agent.id'); }
function hasAgent(request: Record<string, unknown>): boolean { return record(request.agent) || typeof request.agentId === 'string' || typeof request.id === 'string' || typeof request.name === 'string' || typeof request.slot === 'number'; }
function workId(request: Record<string, unknown>): string { const work = record(request.work) ? request.work : request; return stringValue(work.id ?? work.userAnnotationId, 'work.id'); }
function requiredAdapter(services: MainServices, provider: string): ProviderAdapter { const adapter = services.adapters[provider]; if (adapter === undefined) {throw new Error(`Unsupported provider: ${provider}`);} return adapter; }
function projectAgentDetail(detail: AgentDetail): Omit<AgentDetail, 'sessionFile'> {
	const { sessionFile: _sessionFile, ...safe } = detail;
	return safe;
}
function projectWorkItem(work: WorkItem): WorkItem & { readonly latestUpdate: WorkItem['updates'][number] } {
	const latestUpdate = work.updates.at(-1);
	if (latestUpdate === undefined) {throw new Error(`Work item has no update history: ${work.id}`);}
	return { ...work, latestUpdate };
}

function isMissingProviderSession(error: unknown): boolean {
	return /not found|missing|unknown thread|does not exist|thread not loaded|no rollout found/i.test(errorMessage(error));
}

async function requestInput(args: readonly string[], io: CliIo, services: MainServices, command: string, allowEmpty = false): Promise<Record<string, unknown>> { const inputPath = optionValue(args, '--input'); validateInputArgs(args, inputPath, command); const text = inputPath === undefined ? await readStream(io.stdin) : await services.readFile(inputPath); if (text.trim() === '' && allowEmpty) {return { workspace: { cwd: process.cwd() } };} const value: unknown = JSON.parse(text); if (!record(value)) {throw new Error(`${command} request must be a JSON object`);} return value; }
function optionValue(args: readonly string[], name: string): string | undefined { const index = args.indexOf(name); if (index < 0) {return undefined;} const value = args[index + 1]; if (value === undefined || value.startsWith('-')) {throw new Error(`${name} requires a value`);} return value; }
function validateInputArgs(args: readonly string[], inputPath: string | undefined, command: string): void { if (args.length !== (inputPath === undefined ? 0 : 2)) {throw new Error(`Unexpected ${command} arguments: ${args.join(' ')}`);} }
async function readStream(stream: NodeJS.ReadableStream): Promise<string> { let value = ''; for await (const chunk of stream) {value += String(chunk);} return value; }
function writeJson(io: CliIo, value: unknown): void { io.stdout.write(`${JSON.stringify(value)}\n`); }
function machineFailure(io: CliIo, error: unknown): number {
	const message = error instanceof SyntaxError ? `Invalid JSON: ${error.message}` : errorMessage(error);
	if (error instanceof AgentStoreConflictError) {
		writeJson(io, {
			kind: 'conflict', code: error.code, message,
			...(error.current === undefined ? {} : { current: redactProviderNativeIds(error.current) }),
		});
	}
	io.stderr.write(`sundial-editor-cli: ${message}\n`);
	return 1;
}
function record(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null; }
function recordField(value: Record<string, unknown>, field: string): Record<string, unknown> { const result = value[field]; if (!record(result)) {throw new Error(`${field} must be an object`);} return result; }
function stringField(value: Record<string, unknown>, field: string): string { return stringValue(value[field], field); }
function stringValue(value: unknown, field: string): string { if (typeof value !== 'string' || value.trim() === '') {throw new Error(`${field} must be a non-empty string`);} return value; }
function optionalString(value: unknown): string | undefined { return typeof value === 'string' && value.trim() !== '' ? value : undefined; }
function integerField(value: Record<string, unknown>, field: string): number { return integerValue(value[field], field); }
function integerValue(value: unknown, field: string): number { if (!Number.isSafeInteger(value) || (value as number) < 0) {throw new Error(`${field} must be a non-negative integer`);} return value as number; }
function stringArray(value: unknown, field: string): readonly string[] { if (!Array.isArray(value) || value.length > 3 || !value.every(item => typeof item === 'string' && !/[\r\n]/.test(item))) {throw new Error(`${field} must contain up to three single-line strings`);} return value; }
function preset(value: unknown): WorkItem['prompt']['preset'] { if (typeof value !== 'string' || !/^%(Q|F|W|R|C|T)$/.test(value)) {throw new Error('prompt.preset is invalid');} return value as WorkItem['prompt']['preset']; }
function scope(value: unknown): WorkItem['prompt']['scope'] { if (value !== 'line' && value !== 'project') {throw new Error('prompt.scope is invalid');} return value; }
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }

function redactProviderNativeIds(value: unknown): unknown {
	if (Array.isArray(value)) { return value.map(redactProviderNativeIds); }
	if (!record(value)) { return value; }
	return Object.fromEntries(Object.entries(value)
		.filter(([key]) => key !== 'providerSessionId')
		.map(([key, child]) => [key, redactProviderNativeIds(child)]));
}

function workspaceRelativeSourcePath(cwd: string, sourceUri: string, suppliedPath?: string): string {
	const workspace = path.resolve(cwd);
	const relative = path.relative(workspace, fileURLToPath(new URL(sourceUri)));
	if (relative === '' || path.isAbsolute(relative) || relative === '..' || relative.startsWith(`..${path.sep}`)) {
		throw new Error('work.source must identify a file inside workspace.cwd');
	}
	const normalized = relative.split(path.sep).join('/');
	if (suppliedPath !== undefined && suppliedPath.replaceAll('\\', '/') !== normalized) {
		throw new Error('work.source.path must match the workspace-relative source URI');
	}
	return normalized;
}

if (require.main === module) {void main(process.argv.slice(2), process).then(code => { process.exitCode = code; });}
