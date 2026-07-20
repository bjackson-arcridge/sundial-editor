import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { access, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import * as path from 'node:path';
import { createInterface, type Interface as ReadlineInterface } from 'node:readline';
import type { AgentEvent, PromptRequest } from '../protocol.js';
import { packageVersion } from '../version.js';
import {
	AdapterError,
	type ProviderAdapter,
	type ProviderHealth,
	type ProviderHealthOptions,
	type ProviderRunResult,
	type ProviderSessionReadResult,
	type ProviderTranscriptEntry,
} from './adapter.js';

const minimumSupportedCodexVersion = '0.131.0';
const defaultCapabilityCacheTtlMs = 24 * 60 * 60 * 1_000;
const managedSessionMarker = 'Sundial managed session initialized.';
const compatibilityProbeMarker = 'Sundial Codex compatibility probe. No model turn was started.';

interface RpcMessage {
	readonly id?: number;
	readonly method?: string;
	readonly result?: unknown;
	readonly error?: { readonly code?: number; readonly message?: string };
	readonly params?: unknown;
}

interface AvailableCodexModel {
	readonly id: string;
	readonly model: string;
	readonly isDefault: boolean;
}

export interface CodexProcessServices {
	readonly resolveExecutable: () => Promise<string>;
	readonly runVersion: (executablePath: string) => Promise<string>;
	readonly startAppServer: (
		executablePath: string,
		cwd: string,
		environment?: Readonly<Record<string, string>>,
	) => ChildProcessWithoutNullStreams;
	readonly readCapabilityCache?: () => Promise<unknown>;
	readonly writeCapabilityCache?: (value: unknown) => Promise<void>;
	readonly now?: () => Date;
	readonly capabilityCacheTtlMs?: number;
}

export function createCodexAdapter(services: CodexProcessServices = defaultServices): ProviderAdapter {
	let cachedHealth: Promise<ProviderHealth> | undefined;
	const health = (options: ProviderHealthOptions = {}): Promise<ProviderHealth> => {
		if (options.forceRefresh === true) {
			cachedHealth = codexHealth(services, true);
			return cachedHealth;
		}
		return cachedHealth ??= codexHealth(services, false);
	};
	const requireHealthy = async (): Promise<string> => requireHealthyCodex(health);
	return {
		health,
		run: async (request, emit, signal) => {
			const executablePath = await requireHealthy();
			return runAppServerTurn(services, executablePath, {
				cwd: request.workspace.cwd,
				model: request.model,
				prompt: buildPrompt(request),
			}, emit, signal);
		},
		createSession: async request => {
			const executablePath = await requireHealthy();
			const started = await withConnection(services, executablePath, request.cwd, async connection => {
				const model = await validateRequestedModel(connection.call, request.model);
				const thread = asRecord(await connection.call('thread/start', {
					cwd: request.cwd,
					model,
					approvalPolicy: 'never',
					sandbox: 'workspace-write',
					ephemeral: false,
					baseInstructions: request.baseInstructions,
				}));
				const providerSessionId = requiredThreadId(thread);
				try {
					validateObjectResponse('thread/inject_items', await injectThreadMarker(connection, providerSessionId, managedSessionMarker));
					return { providerSessionId, injected: true };
				} catch (error) {
					if (!isMissingRpcMethod(error, 'thread/inject_items')) {
						throw error;
					}
					return { providerSessionId, injected: false };
				}
			});
			if (!started.injected && !await threadPersistedAcrossConnections(services, executablePath, request.cwd, started.providerSessionId)) {
				throw new AdapterError(
					'Codex app-server is missing required RPC "thread/inject_items", and thread/start did not persist the managed thread. Update Codex and retry.',
				);
			}
			return { providerSessionId: started.providerSessionId };
		},
		runSession: async (request, emit, signal) => {
			const executablePath = await requireHealthy();
			return runAppServerTurn(services, executablePath, {
				cwd: request.cwd,
				model: request.model,
				prompt: request.prompt,
				providerSessionId: request.providerSessionId,
				invocationEnvironment: request.invocationEnvironment,
			}, emit, signal);
		},
		readSession: async request => {
			const executablePath = await requireHealthy();
			try {
				return await withConnection(services, executablePath, request.cwd, async connection => {
					const result = await connection.call('thread/read', {
						threadId: request.providerSessionId,
						includeTurns: true,
					});
					return {
						providerSessionId: request.providerSessionId,
						available: true,
						transcript: normalizeTranscript(result),
					};
				});
			} catch (error) {
				if (isMissingCodexThread(error)) {
					return {
						providerSessionId: request.providerSessionId,
						available: false,
						transcript: [],
					};
				}
				throw error;
			}
		},
	};
}

async function requireHealthyCodex(healthCheck: () => Promise<ProviderHealth>): Promise<string> {
	const health = await healthCheck();
	if (!health.available || !health.compatible) {
		throw new AdapterError(health.message ?? 'Codex is unavailable.');
	}
	if (health.executablePath === undefined) {
		throw new AdapterError('Codex compatibility passed without resolving an executable path.');
	}
	return health.executablePath;
}

async function codexHealth(services: CodexProcessServices, forceRefresh: boolean): Promise<ProviderHealth> {
	let executablePath: string;
	try {
		executablePath = await services.resolveExecutable();
	} catch (error) {
		const message = error instanceof Error && 'code' in error && error.code === 'ENOENT'
			? 'Codex executable was not found on the PATH used by Sundial Editor CLI.'
			: `Could not resolve Codex on PATH: ${errorMessage(error)}`;
		return { provider: 'codex', available: false, compatible: false, message };
	}

	try {
		const rawVersion = (await services.runVersion(executablePath)).trim();
		const match = /codex-cli\s+(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/.exec(rawVersion);
		if (match === null) {
			return {
				provider: 'codex', available: true, compatible: false, executablePath,
				message: `Codex at ${executablePath} returned an unrecognized version: ${rawVersion}`,
			};
		}
		const version = match[1];
		if (compareVersionCore(version, minimumSupportedCodexVersion) < 0) {
			return {
				provider: 'codex', available: true, compatible: false, executablePath, version,
				message: `Codex ${version} at ${executablePath} is too old; Sundial Editor CLI requires Codex ${minimumSupportedCodexVersion} or newer.`,
			};
		}
		if (!forceRefresh) {
			const cached = await readCachedCapability(services, executablePath, version);
			if (cached !== undefined) {
				return cached;
			}
		}
		try {
			const probe = await probeCodexCapabilities(services, executablePath);
			const persistence = probe.threadStartPersistedImmediately
				? 'thread/start persisted immediately'
				: 'thread/inject_items materialization required';
			const result: ProviderHealth = {
				provider: 'codex', available: true, compatible: true, executablePath, version,
				message: `Codex ${version} at ${executablePath} passed Sundial app-server capability checks (${persistence}).`,
			};
			await writeCachedCapability(services, result);
			return result;
		} catch (error) {
			return {
				provider: 'codex', available: true, compatible: false, executablePath, version,
				message: `Codex ${version} at ${executablePath} failed a required app-server capability check: ${errorMessage(error)}`,
			};
		}
	} catch (error) {
		return {
			provider: 'codex', available: false, compatible: false, executablePath,
			message: `Could not run Codex at ${executablePath}: ${errorMessage(error)}`,
		};
	}
}

interface CodexCapabilityCache {
	readonly version: 1;
	readonly provider: 'codex';
	readonly cliVersion: string;
	readonly executablePath: string;
	readonly codexVersion: string;
	readonly checkedAt: string;
	readonly health: ProviderHealth;
}

async function readCachedCapability(
	services: CodexProcessServices,
	executablePath: string,
	codexVersion: string,
): Promise<ProviderHealth | undefined> {
	if (services.readCapabilityCache === undefined) {return undefined;}
	let value: unknown;
	try {value = await services.readCapabilityCache();} catch {return undefined;}
	const cached = parseCapabilityCache(value);
	if (cached === undefined
		|| cached.cliVersion !== packageVersion
		|| cached.executablePath !== executablePath
		|| cached.codexVersion !== codexVersion) {return undefined;}
	const checkedAt = Date.parse(cached.checkedAt);
	const age = (services.now?.() ?? new Date()).getTime() - checkedAt;
	const ttl = services.capabilityCacheTtlMs ?? defaultCapabilityCacheTtlMs;
	if (!Number.isFinite(checkedAt) || age < 0 || age >= ttl) {return undefined;}
	return cached.health;
}

async function writeCachedCapability(services: CodexProcessServices, health: ProviderHealth): Promise<void> {
	if (services.writeCapabilityCache === undefined || health.executablePath === undefined || health.version === undefined) {return;}
	const cached: CodexCapabilityCache = {
		version: 1,
		provider: 'codex',
		cliVersion: packageVersion,
		executablePath: health.executablePath,
		codexVersion: health.version,
		checkedAt: (services.now?.() ?? new Date()).toISOString(),
		health,
	};
	try {await services.writeCapabilityCache(cached);} catch {
		// A cache write failure must not turn a successful compatibility check into a provider failure.
	}
}

function parseCapabilityCache(value: unknown): CodexCapabilityCache | undefined {
	const cached = asRecord(value);
	const health = asRecord(cached?.health);
	if (cached?.version !== 1
		|| cached.provider !== 'codex'
		|| typeof cached.cliVersion !== 'string'
		|| typeof cached.executablePath !== 'string'
		|| typeof cached.codexVersion !== 'string'
		|| typeof cached.checkedAt !== 'string'
		|| health?.provider !== 'codex'
		|| health.available !== true
		|| health.compatible !== true
		|| health.executablePath !== cached.executablePath
		|| health.version !== cached.codexVersion
		|| (health.message !== undefined && typeof health.message !== 'string')) {return undefined;}
	return cached as unknown as CodexCapabilityCache;
}

interface CapabilityProbeResult {
	readonly threadStartPersistedImmediately: boolean;
}

async function probeCodexCapabilities(
	services: CodexProcessServices,
	executablePath: string,
): Promise<CapabilityProbeResult> {
	const cwd = tmpdir();
	let probeThreadId: string | undefined;
	let archived = false;
	let threadStartPersistedImmediately = false;
	try {
		await withConnection(services, executablePath, cwd, async connection => {
			await listAvailableModels(connection.call);
			const started = asRecord(await connection.call('thread/start', {
				cwd,
				approvalPolicy: 'never',
				sandbox: 'workspace-write',
				ephemeral: false,
				baseInstructions: compatibilityProbeMarker,
			}));
			probeThreadId = requiredThreadId(started, 'thread/start');
			threadStartPersistedImmediately = await threadPersistedAcrossConnections(
				services,
				executablePath,
				cwd,
				probeThreadId,
			);
			try {
				validateObjectResponse(
					'thread/inject_items',
					await injectThreadMarker(connection, probeThreadId, compatibilityProbeMarker),
				);
			} catch (error) {
				if (!isMissingRpcMethod(error, 'thread/inject_items')) {
					throw error;
				}
				if (!threadStartPersistedImmediately) {
					throw new AdapterError(
						'Required RPC "thread/inject_items" is missing, and thread/start did not persist the probe thread.',
					);
				}
			}
		});

		await withConnection(services, executablePath, cwd, async connection => {
			await listAvailableModels(connection.call);
			await validateThreadRead(connection, probeThreadId as string);
			const resumed = asRecord(await connection.call('thread/resume', { threadId: probeThreadId }));
			validateThreadIdentity('thread/resume', resumed, probeThreadId as string);
			await requireRecognizedRpc(connection, 'turn/start', {});
			await requireRecognizedRpc(connection, 'turn/interrupt', {});
			validateObjectResponse('thread/archive', await connection.call('thread/archive', { threadId: probeThreadId }));
			archived = true;
		});
		return { threadStartPersistedImmediately };
	} finally {
		if (probeThreadId !== undefined && !archived) {
			await bestEffortArchiveProbe(services, executablePath, cwd, probeThreadId);
		}
	}
}

async function injectThreadMarker(connection: CodexConnection, threadId: string, marker: string): Promise<unknown> {
	return connection.call('thread/inject_items', {
		threadId,
		items: [{
			type: 'message',
			role: 'developer',
			content: [{ type: 'input_text', text: marker }],
		}],
	});
}

async function threadPersistedAcrossConnections(
	services: CodexProcessServices,
	executablePath: string,
	cwd: string,
	threadId: string,
): Promise<boolean> {
	try {
		return await withConnection(services, executablePath, cwd, async connection => {
			await validateThreadRead(connection, threadId);
			return true;
		});
	} catch (error) {
		if (isMissingCodexThread(error)) {
			return false;
		}
		throw error;
	}
}

async function validateThreadRead(connection: CodexConnection, threadId: string): Promise<void> {
	const read = asRecord(await connection.call('thread/read', { threadId, includeTurns: false }));
	validateThreadIdentity('thread/read', read, threadId);
}

function validateThreadIdentity(method: string, response: Record<string, unknown> | undefined, expectedThreadId: string): void {
	const actualThreadId = nestedRecordString(response, 'thread', 'id');
	if (actualThreadId === undefined) {
		throw new AdapterError(`Required RPC "${method}" returned a malformed response without thread.id.`);
	}
	if (actualThreadId !== expectedThreadId) {
		throw new AdapterError(`Required RPC "${method}" returned thread ${actualThreadId} instead of ${expectedThreadId}.`);
	}
}

async function requireRecognizedRpc(connection: CodexConnection, method: string, params: unknown): Promise<void> {
	try {
		await connection.call(method, params);
		throw new AdapterError(`Required RPC "${method}" accepted malformed probe parameters.`);
	} catch (error) {
		if (isMissingRpcMethod(error, method)) {
			throw new AdapterError(`Required RPC "${method}" is missing.`);
		}
		if (error instanceof CodexRpcError) {
			return;
		}
		throw error;
	}
}

async function bestEffortArchiveProbe(
	services: CodexProcessServices,
	executablePath: string,
	cwd: string,
	threadId: string,
): Promise<void> {
	try {
		await withConnection(services, executablePath, cwd, async connection => {
			await connection.call('thread/archive', { threadId });
		});
	} catch {
		// Preserve the original capability error; non-materialized probe threads have no durable state to archive.
	}
}

function validateObjectResponse(method: string, value: unknown): void {
	if (asRecord(value) === undefined) {
		throw new AdapterError(`Required RPC "${method}" returned a malformed non-object response.`);
	}
}

function compareVersionCore(left: string, right: string): number {
	const leftParts = left.split('-', 1)[0].split('.').map(Number);
	const rightParts = right.split('-', 1)[0].split('.').map(Number);
	for (let index = 0; index < 3; index += 1) {
		const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
		if (difference !== 0) {
			return difference;
		}
	}
	return 0;
}

interface TurnRequest {
	readonly cwd: string;
	readonly prompt: string;
	readonly model?: string;
	readonly providerSessionId?: string;
	readonly invocationEnvironment?: Readonly<Record<string, string>>;
}

async function runAppServerTurn(
	services: CodexProcessServices,
	executablePath: string,
	request: TurnRequest,
	emit: (event: AgentEvent) => void,
	signal?: AbortSignal,
): Promise<ProviderRunResult> {
	return withConnection(services, executablePath, request.cwd, async connection => {
		const model = await validateRequestedModel(connection.call, request.model);
		let providerSessionId = request.providerSessionId;
		if (providerSessionId === undefined) {
			const started = asRecord(await connection.call('thread/start', {
				cwd: request.cwd,
				model,
				approvalPolicy: 'never',
				sandbox: 'workspace-write',
				ephemeral: false,
			}));
			providerSessionId = requiredThreadId(started);
		} else {
			const resumed = asRecord(await connection.call('thread/resume', { threadId: providerSessionId }));
			const resumedId = nestedRecordString(resumed, 'thread', 'id');
			if (resumedId !== undefined && resumedId !== providerSessionId) {
				throw new AdapterError('Codex resumed a different thread than the requested managed session.');
			}
		}

		emit({ kind: 'status', status: 'working', message: 'Codex is working.' });
		const completion = waitForTurn(connection, emit, providerSessionId, signal);
		const startedTurn = asRecord(await connection.call('turn/start', {
			threadId: providerSessionId,
			cwd: request.cwd,
			model,
			input: [{ type: 'text', text: request.prompt, text_elements: [] }],
		}));
		const turnId = nestedRecordString(startedTurn, 'turn', 'id');
		if (turnId !== undefined) {
			connection.setActiveTurn(providerSessionId, turnId);
		}
		return completion;
	}, request.invocationEnvironment);
}

function waitForTurn(
	connection: CodexConnection,
	emit: (event: AgentEvent) => void,
	providerSessionId: string,
	signal?: AbortSignal,
): Promise<ProviderRunResult> {
	let output = '';
	let settled = false;
	return new Promise((resolve, reject) => {
		const dispose = connection.onNotification(message => {
			if (message.method === 'item/agentMessage/delta') {
				const delta = recordString(message.params, 'delta');
				if (delta !== undefined && delta !== '') {
					output += delta;
					emit({ kind: 'output', text: delta });
				}
				return;
			}
			if (message.method === 'turn/started') {
				const turnId = nestedRecordString(message.params, 'turn', 'id');
				if (turnId !== undefined) {
					connection.setActiveTurn(providerSessionId, turnId);
				}
				return;
			}
			if (message.method !== 'turn/completed') {
				return;
			}
			settled = true;
			dispose();
			const turn = asRecord(asRecord(message.params)?.turn);
			const status = recordString(turn, 'status');
			const failure = recordString(turn?.error, 'message');
			if (status === 'failed') {
				reject(new AdapterError(failure ?? 'Codex turn failed.'));
				return;
			}
			const outcome = status === 'interrupted' ? 'interrupted' : 'completed';
			if (output === '') {
				const fallback = outcome === 'interrupted' ? 'Agent run cancelled.' : 'Agent completed without a text response.';
				output = fallback;
				emit({ kind: 'output', text: fallback });
			}
			resolve({ providerSessionId, output, outcome });
		});

		const abort = (): void => { void connection.interrupt(); };
		if (signal?.aborted === true) {
			abort();
		} else {
			signal?.addEventListener('abort', abort, { once: true });
		}
		connection.onFailure(error => {
			if (!settled) {
				dispose();
				reject(error);
			}
		});
	});
}

class CodexConnection {
	private readonly lines: ReadlineInterface;
	private readonly pending = new Map<number, {
		readonly method: string;
		readonly resolve: (value: unknown) => void;
		readonly reject: (error: Error) => void;
	}>();
	private readonly notificationListeners = new Set<(message: RpcMessage) => void>();
	private readonly failureListeners = new Set<(error: Error) => void>();
	private nextId = 1;
	private stderr = '';
	private activeThreadId: string | undefined;
	private activeTurnId: string | undefined;

	constructor(private readonly child: ChildProcessWithoutNullStreams) {
		this.lines = createInterface({ input: child.stdout });
		child.stderr.on('data', chunk => { this.stderr += String(chunk); });
		this.lines.on('line', rawLine => this.receive(rawLine));
		child.once('error', error => this.fail(new AdapterError(`Could not start Codex app-server: ${error.message}`)));
		child.once('exit', code => this.fail(new AdapterError(mapCodexFailure(this.stderr, code))));
	}

	readonly call = (method: string, params: unknown): Promise<unknown> => {
		const id = this.nextId++;
		this.child.stdin.write(`${JSON.stringify({ method, id, params })}\n`);
		return new Promise((resolve, reject) => this.pending.set(id, { method, resolve, reject }));
	};

	notify(method: string, params: unknown): void {
		this.child.stdin.write(`${JSON.stringify({ method, params })}\n`);
	}

	onNotification(listener: (message: RpcMessage) => void): () => void {
		this.notificationListeners.add(listener);
		return () => this.notificationListeners.delete(listener);
	}

	onFailure(listener: (error: Error) => void): void {
		this.failureListeners.add(listener);
	}

	setActiveTurn(threadId: string, turnId: string): void {
		this.activeThreadId = threadId;
		this.activeTurnId = turnId;
	}

	async interrupt(): Promise<void> {
		if (this.activeThreadId === undefined || this.activeTurnId === undefined) {
			this.child.kill();
			return;
		}
		try {
			await this.call('turn/interrupt', { threadId: this.activeThreadId, turnId: this.activeTurnId });
		} catch {
			this.child.kill();
		}
	}

	close(): void {
		this.lines.close();
		if (!this.child.killed) {
			this.child.kill();
		}
	}

	private receive(rawLine: string): void {
		let message: RpcMessage;
		try {
			message = JSON.parse(rawLine) as RpcMessage;
		} catch {
			return;
		}
		if (message.id !== undefined) {
			const waiter = this.pending.get(message.id);
			if (waiter !== undefined) {
				this.pending.delete(message.id);
				if (message.error !== undefined) {
					waiter.reject(new CodexRpcError(
						waiter.method,
						message.error.message ?? 'Codex app-server request failed.',
						message.error.code,
					));
				} else {
					waiter.resolve(message.result);
				}
			}
			return;
		}
		for (const listener of this.notificationListeners) {
			listener(message);
		}
	}

	private fail(error: Error): void {
		for (const waiter of this.pending.values()) {
			waiter.reject(error);
		}
		this.pending.clear();
		for (const listener of this.failureListeners) {
			listener(error);
		}
	}
}

async function withConnection<T>(
	services: CodexProcessServices,
	executablePath: string,
	cwd: string,
	operation: (connection: CodexConnection) => Promise<T>,
	environment?: Readonly<Record<string, string>>,
): Promise<T> {
	const connection = new CodexConnection(services.startAppServer(executablePath, cwd, environment));
	try {
		const initialized = asRecord(await connection.call('initialize', {
			clientInfo: { name: 'sundial_editor', title: 'Sundial Editor', version: packageVersion },
			capabilities: null,
		}));
		if (typeof initialized?.userAgent !== 'string' || initialized.userAgent === '') {
			throw new AdapterError('Required RPC "initialize" returned a malformed response without userAgent.');
		}
		connection.notify('initialized', {});
		return await operation(connection);
	} finally {
		connection.close();
	}
}

async function listAvailableModels(
	call: (method: string, params: unknown) => Promise<unknown>,
): Promise<readonly AvailableCodexModel[]> {
	const models: AvailableCodexModel[] = [];
	const seenCursors = new Set<string>();
	let cursor: string | null = null;
	do {
		const page = asRecord(await call('model/list', { cursor, includeHidden: false, limit: 100 }));
		const data = page?.data;
		if (!Array.isArray(data)) {
			throw new AdapterError('Required RPC "model/list" returned a malformed response: data must be an array.');
		}
		for (const [index, value] of data.entries()) {
			const model = asAvailableCodexModel(value);
			if (model === undefined) {
				throw new AdapterError(`Required RPC "model/list" returned a malformed model entry at index ${index}.`);
			}
			models.push(model);
		}
		const nextCursor = page?.nextCursor;
		if (nextCursor !== null && nextCursor !== undefined && typeof nextCursor !== 'string') {
			throw new AdapterError('Required RPC "model/list" returned a malformed nextCursor.');
		}
		cursor = nextCursor ?? null;
		if (cursor !== null && seenCursors.has(cursor)) {
			throw new AdapterError('Required RPC "model/list" repeated a pagination cursor.');
		}
		if (cursor !== null) {
			seenCursors.add(cursor);
		}
	} while (cursor !== null);

	if (models.length === 0) {
		throw new AdapterError('Required RPC "model/list" returned no available models.');
	}
	return models;
}

async function validateRequestedModel(
	call: (method: string, params: unknown) => Promise<unknown>,
	requestedModel?: string,
): Promise<string | undefined> {
	const models = await listAvailableModels(call);
	if (requestedModel !== undefined) {
		const requested = models.find(model => model.id === requestedModel || model.model === requestedModel);
		if (requested === undefined) {
			throw new AdapterError(
				`Requested Codex model "${requestedModel}" is unavailable. Available models: ${models.map(model => model.model).join(', ')}.`,
			);
		}
		return requested.model;
	}
	return undefined;
}

function requiredThreadId(value: Record<string, unknown> | undefined, method = 'thread/start'): string {
	const threadId = nestedRecordString(value, 'thread', 'id');
	if (threadId === undefined) {
		throw new AdapterError(`Required RPC "${method}" returned a malformed response without thread.id.`);
	}
	return threadId;
}

function normalizeTranscript(value: unknown): readonly ProviderTranscriptEntry[] {
	const thread = asRecord(asRecord(value)?.thread) ?? asRecord(value);
	const turns = thread?.turns;
	if (!Array.isArray(turns)) {
		return [];
	}
	const entries: ProviderTranscriptEntry[] = [];
	for (const turnValue of turns) {
		const items = asRecord(turnValue)?.items;
		if (!Array.isArray(items)) {
			continue;
		}
		for (const itemValue of items) {
			const item = asRecord(itemValue);
			const type = recordString(item, 'type') ?? '';
			const role = /user/i.test(type) ? 'user' : /agent|assistant/i.test(type) ? 'agent' : undefined;
			if (role === undefined) {
				continue;
			}
			const text = transcriptText(item);
			if (text !== '') {
				entries.push({ role, text });
			}
		}
	}
	return entries;
}

function transcriptText(item: Record<string, unknown> | undefined): string {
	for (const key of ['text', 'message']) {
		const value = item?.[key];
		if (typeof value === 'string') {
			return value;
		}
	}
	const content = item?.content;
	if (!Array.isArray(content)) {
		return '';
	}
	return content.map(part => {
		if (typeof part === 'string') {
			return part;
		}
		const record = asRecord(part);
		return recordString(record, 'text') ?? recordString(record, 'input_text') ?? recordString(record, 'output_text') ?? '';
	}).filter(Boolean).join('\n');
}


function buildPrompt(request: PromptRequest): string {
	const context = request.prompt.scope === 'project'
		? `Project prompt from ${request.document.uri}`
		: `Prompt from ${request.document.uri}, line ${request.document.line + 1}:\n${request.document.text}`;
	return `${request.prompt.text}\n\nOriginating Sundial context:\n${context}`;
}

const capabilityCachePath = machineConfigurationPath('provider-capabilities.json');

const defaultServices: CodexProcessServices = {
	resolveExecutable: () => resolveExecutableOnPath('codex'),
	runVersion: executablePath => new Promise((resolve, reject) => {
		const child = spawn(executablePath, ['--version'], { stdio: ['ignore', 'pipe', 'pipe'] });
		let stdout = '';
		let stderr = '';
		child.stdout.on('data', chunk => { stdout += String(chunk); });
		child.stderr.on('data', chunk => { stderr += String(chunk); });
		child.once('error', reject);
		child.once('exit', code => code === 0 ? resolve(stdout) : reject(new Error(stderr || `exit ${code}`)));
	}),
	startAppServer: (executablePath, cwd, environment) => spawn(executablePath, ['app-server'], {
		cwd,
		stdio: ['pipe', 'pipe', 'pipe'],
		env: { ...process.env, ...environment },
	}),
	readCapabilityCache: async () => {
		try {return JSON.parse(await readFile(capabilityCachePath, 'utf8')) as unknown;}
		catch {return undefined;}
	},
	writeCapabilityCache: async value => {
		await mkdir(path.dirname(capabilityCachePath), { recursive: true });
		const temporary = `${capabilityCachePath}.tmp-${process.pid}-${randomUUID()}`;
		try {
			await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
			await rename(temporary, capabilityCachePath);
		} finally {
			await rm(temporary, { force: true });
		}
	},
	now: () => new Date(),
	capabilityCacheTtlMs: defaultCapabilityCacheTtlMs,
};

function machineConfigurationPath(filename: string): string {
	if (process.platform === 'darwin') {
		return path.join(homedir(), 'Library', 'Application Support', 'Sundial Editor', filename);
	}
	if (process.platform === 'win32') {
		const applicationData = process.env.APPDATA ?? path.join(homedir(), 'AppData', 'Roaming');
		return path.join(applicationData, 'Sundial Editor', filename);
	}
	const configRoot = process.env.XDG_CONFIG_HOME ?? path.join(homedir(), '.config');
	return path.join(configRoot, 'sundial-editor', filename);
}

async function resolveExecutableOnPath(command: string): Promise<string> {
	const pathEntries = (process.env.PATH ?? '').split(path.delimiter);
	const extensions = process.platform === 'win32'
		? (process.env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM').split(';')
		: [''];
	for (const entry of pathEntries) {
		const directory = entry === '' ? process.cwd() : entry;
		for (const extension of extensions) {
			const candidate = path.resolve(directory, `${command}${extension}`);
			try {
				await access(candidate, fsConstants.X_OK);
				return candidate;
			} catch {
				// Continue searching the exact PATH inherited by this CLI process.
			}
		}
	}
	throw Object.assign(new Error(`${command} was not found on PATH`), { code: 'ENOENT' });
}

function mapCodexFailure(stderr: string, code: number | null): string {
	if (/login|auth|credential|unauthorized/i.test(stderr)) {
		return 'Codex authentication failed. Run `codex login` and try again.';
	}
	return stderr.trim() || `Codex app-server exited before completing the turn (exit ${code ?? 'unknown'}).`;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function recordString(value: unknown, key: string): string | undefined {
	const record = asRecord(value);
	return typeof record?.[key] === 'string' ? record[key] : undefined;
}

function nestedRecordString(value: unknown, outer: string, inner: string): string | undefined {
	return recordString(asRecord(value)?.[outer], inner);
}

function asAvailableCodexModel(value: unknown): AvailableCodexModel | undefined {
	const model = asRecord(value);
	return typeof model?.id === 'string' && typeof model.model === 'string' && typeof model.isDefault === 'boolean'
		? { id: model.id, model: model.model, isDefault: model.isDefault }
		: undefined;
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

class CodexRpcError extends AdapterError {
	constructor(readonly method: string, message: string, readonly code?: number) {
		super(`Codex app-server RPC "${method}" failed: ${message}`);
		this.name = 'CodexRpcError';
	}
}

function isMissingRpcMethod(error: unknown, method: string): boolean {
	return error instanceof CodexRpcError
		&& error.method === method
		&& (error.code === -32601 || /method not found|unknown method|unsupported method/i.test(error.message));
}

function isMissingCodexThread(error: unknown): boolean {
	return /not found|missing|unknown thread|does not exist|thread not loaded|no rollout found/i.test(errorMessage(error));
}
