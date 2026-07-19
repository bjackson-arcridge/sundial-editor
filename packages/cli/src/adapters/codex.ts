import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import type { AgentEvent, PromptRequest } from '../protocol.js';
import { AdapterError, type ProviderAdapter, type ProviderHealth } from './adapter.js';

const supportedCodexVersion = /^0\.131\./;

interface RpcMessage {
	readonly id?: number;
	readonly method?: string;
	readonly result?: unknown;
	readonly error?: { readonly message?: string };
	readonly params?: unknown;
}

interface AvailableCodexModel {
	readonly id: string;
	readonly model: string;
	readonly isDefault: boolean;
}

export interface CodexProcessServices {
	readonly runVersion: () => Promise<string>;
	readonly startAppServer: (cwd: string) => ChildProcessWithoutNullStreams;
}

export function createCodexAdapter(services: CodexProcessServices = defaultServices): ProviderAdapter {
	return {
		health: async () => codexHealth(services),
		run: async (request, emit, signal) => {
			const health = await codexHealth(services);
			if (!health.available || !health.compatible) {
				throw new AdapterError(health.message ?? 'Codex is unavailable.');
			}
			await runAppServer(services.startAppServer(request.workspace.cwd), request, emit, signal);
		},
	};
}

async function codexHealth(services: CodexProcessServices): Promise<ProviderHealth> {
	try {
		const rawVersion = (await services.runVersion()).trim();
		const match = /codex-cli\s+(\d+\.\d+\.\d+)/.exec(rawVersion);
		if (match === null) {
			return { provider: 'codex', available: true, compatible: false, message: `Unrecognized Codex version: ${rawVersion}` };
		}
		const version = match[1];
		if (!supportedCodexVersion.test(version)) {
			return {
				provider: 'codex', available: true, compatible: false, version,
				message: `Unsupported Codex ${version}; Sundial Editor CLI 0.1.1 supports Codex 0.131.x.`,
			};
		}
		return { provider: 'codex', available: true, compatible: true, version };
	} catch (error) {
		const message = error instanceof Error && 'code' in error && error.code === 'ENOENT'
			? 'Codex was not found on PATH.'
			: `Could not run Codex: ${errorMessage(error)}`;
		return { provider: 'codex', available: false, compatible: false, message };
	}
}

async function runAppServer(
	child: ChildProcessWithoutNullStreams,
	request: PromptRequest,
	emit: (event: AgentEvent) => void,
	signal?: AbortSignal,
): Promise<void> {
	const lines = createInterface({ input: child.stdout });
	let stderr = '';
	let nextId = 1;
	let threadId: string | undefined;
	let turnId: string | undefined;
	let sawOutput = false;
	let settled = false;
	const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();

	child.stderr.on('data', chunk => { stderr += String(chunk); });
	const send = (message: unknown): void => { child.stdin.write(`${JSON.stringify(message)}\n`); };
	const call = (method: string, params: unknown): Promise<unknown> => {
		const id = nextId++;
		send({ method, id, params });
		return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
	};

	const abort = (): void => {
		if (threadId !== undefined && turnId !== undefined) {
			void call('turn/interrupt', { threadId, turnId }).catch(() => child.kill());
			setTimeout(() => child.kill(), 2_000).unref();
		} else {
			child.kill();
		}
	};
	signal?.addEventListener('abort', abort, { once: true });

	const completion = new Promise<void>((resolve, reject) => {
		lines.on('line', rawLine => {
			let message: RpcMessage;
			try {
				message = JSON.parse(rawLine) as RpcMessage;
			} catch {
				return;
			}
			if (message.id !== undefined && pending.has(message.id)) {
				const waiter = pending.get(message.id)!;
				pending.delete(message.id);
				if (message.error !== undefined) {
					waiter.reject(new AdapterError(message.error.message ?? 'Codex app-server request failed.'));
				} else {
					waiter.resolve(message.result);
				}
				return;
			}
			if (message.method === 'item/agentMessage/delta') {
				const delta = recordString(message.params, 'delta');
				if (delta !== undefined && delta !== '') {
					sawOutput = true;
					emit({ kind: 'output', text: delta });
				}
			} else if (message.method === 'turn/started') {
				turnId = nestedRecordString(message.params, 'turn', 'id');
			} else if (message.method === 'turn/completed') {
				const status = nestedRecordString(message.params, 'turn', 'status');
				const turn = asRecord(asRecord(message.params)?.turn);
				const failure = recordString(turn?.error, 'message');
				settled = true;
				if (status === 'failed') {
					reject(new AdapterError(failure ?? 'Codex turn failed.'));
				} else {
					if (!sawOutput) {
						emit({ kind: 'output', text: status === 'interrupted' ? 'Agent run cancelled.' : 'Agent completed without a text response.' });
					}
					resolve();
				}
			}
		});
		child.once('error', error => reject(new AdapterError(`Could not start Codex app-server: ${error.message}`)));
		child.once('exit', code => {
			if (!settled) {
				reject(new AdapterError(mapCodexFailure(stderr, code)));
			}
		});
	});
	void completion.catch(() => undefined);

	try {
		await call('initialize', {
			clientInfo: { name: 'sundial_editor', title: 'Sundial Editor', version: '0.1.1' },
			capabilities: null,
		});
		send({ method: 'initialized', params: {} });
		const model = await selectAvailableModel(call, request.model);
		const started = asRecord(await call('thread/start', {
			cwd: request.workspace.cwd,
			model,
			approvalPolicy: 'never',
			sandbox: 'workspace-write',
			ephemeral: true,
		}));
		threadId = nestedRecordString(started, 'thread', 'id');
		if (threadId === undefined) {
			throw new AdapterError('Codex app-server returned no thread id.');
		}
		emit({ kind: 'status', status: 'working', message: 'Codex is working.' });
		const startedTurn = asRecord(await call('turn/start', {
			threadId,
			cwd: request.workspace.cwd,
			input: [{ type: 'text', text: buildPrompt(request), text_elements: [] }],
		}));
		turnId = nestedRecordString(startedTurn, 'turn', 'id') ?? turnId;
		await completion;
	} finally {
		signal?.removeEventListener('abort', abort);
		lines.close();
		if (!child.killed) {
			child.kill();
		}
	}
}

async function selectAvailableModel(
	call: (method: string, params: unknown) => Promise<unknown>,
	requestedModel?: string,
): Promise<string> {
	const models: AvailableCodexModel[] = [];
	const seenCursors = new Set<string>();
	let cursor: string | null = null;
	do {
		const page = asRecord(await call('model/list', { cursor, includeHidden: false, limit: 100 }));
		const data = page?.data;
		if (!Array.isArray(data)) {
			throw new AdapterError('Codex app-server returned an invalid model list.');
		}
		for (const value of data) {
			const model = asAvailableCodexModel(value);
			if (model !== undefined) {
				models.push(model);
			}
		}
		const nextCursor = page?.nextCursor;
		if (nextCursor !== null && nextCursor !== undefined && typeof nextCursor !== 'string') {
			throw new AdapterError('Codex app-server returned an invalid model-list cursor.');
		}
		cursor = nextCursor ?? null;
		if (cursor !== null && seenCursors.has(cursor)) {
			throw new AdapterError('Codex app-server repeated a model-list cursor.');
		}
		if (cursor !== null) {
			seenCursors.add(cursor);
		}
	} while (cursor !== null);

	if (models.length === 0) {
		throw new AdapterError('Codex app-server returned no available models.');
	}
	if (requestedModel !== undefined) {
		const requested = models.find(model => model.id === requestedModel || model.model === requestedModel);
		if (requested === undefined) {
			throw new AdapterError(
				`Requested Codex model "${requestedModel}" is unavailable. Available models: ${models.map(model => model.model).join(', ')}.`,
			);
		}
		return requested.model;
	}
	return (models.find(model => model.isDefault) ?? models[0]).model;
}

function buildPrompt(request: PromptRequest): string {
	const context = request.prompt.scope === 'project'
		? `Project prompt from ${request.document.uri}`
		: `Prompt from ${request.document.uri}, line ${request.document.line + 1}:\n${request.document.text}`;
	return `${request.prompt.text}\n\nOriginating Sundial context:\n${context}`;
}

const defaultServices: CodexProcessServices = {
	runVersion: () => new Promise((resolve, reject) => {
		const child = spawn('codex', ['--version'], { stdio: ['ignore', 'pipe', 'pipe'] });
		let stdout = '';
		let stderr = '';
		child.stdout.on('data', chunk => { stdout += String(chunk); });
		child.stderr.on('data', chunk => { stderr += String(chunk); });
		child.once('error', reject);
		child.once('exit', code => code === 0 ? resolve(stdout) : reject(new Error(stderr || `exit ${code}`)));
	}),
	startAppServer: cwd => spawn('codex', ['app-server'], { cwd, stdio: ['pipe', 'pipe', 'pipe'] }),
};

function mapCodexFailure(stderr: string, code: number | null): string {
	if (/login|auth|credential|unauthorized/i.test(stderr)) {
		return 'Codex authentication failed. Run `codex login` and try again.';
	}
	return stderr.trim() || `Codex app-server exited before completing the turn (exit ${code ?? 'unknown'}).`;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return typeof value === 'object' && value !== null ? value as Record<string, unknown> : undefined;
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
