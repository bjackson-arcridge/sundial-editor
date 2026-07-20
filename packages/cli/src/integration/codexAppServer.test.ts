import * as assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, test } from 'node:test';
import { createCodexAdapter } from '../adapters/codex';
import type { AgentEvent, PromptRequest } from '../protocol';

const fixturePath = path.resolve(__dirname, '../../src/integration/fixtures/fake-codex-app-server.js');

const request: PromptRequest = {
	provider: 'codex',
	workspace: { cwd: '/workspace' },
	document: { uri: 'file:///workspace/example.ts', line: 2, text: '%F' },
	prompt: { preset: '%F', scope: 'line', text: 'Fix this.' },
};

describe('Codex app-server integration', () => {
	test('discovers models but lets Codex apply its configured model when no model was requested', async () => {
		await withServer('default-success', async ({ adapter, events, readTrace }) => {
			await adapter.run(request, event => events.push(event));

			assert.deepEqual(events, [
				{ kind: 'status', status: 'working', message: 'Codex is working.' },
				{ kind: 'output', text: 'Applied fake integration change.' },
			]);
			const calls = operationalCalls(await readTrace());
			assert.deepEqual(calls.map(call => call.method), [
				'initialize', 'initialized', 'model/list', 'thread/start', 'turn/start',
			]);
			assert.equal('model' in findCall(calls, 'thread/start').params, false);
			assert.equal('model' in findCall(calls, 'turn/start').params, false);
			assert.equal(findCall(calls, 'thread/start').params.ephemeral, false);
		});
	});

	test('creates, resumes, and reads a persistent managed session', async () => {
		await withServer('default-success', async ({ adapter, events, readTrace }) => {
			const session = await adapter.createSession?.({
				cwd: request.workspace.cwd,
				baseInstructions: 'Managed contract.',
			});
			assert.deepEqual(session, { providerSessionId: 'thread-1' });
			const creationCalls = operationalCalls(await readTrace());
			assert.equal(findCall(creationCalls, 'thread/start').params.ephemeral, false);
			assert.equal(findCall(creationCalls, 'thread/start').params.baseInstructions, 'Managed contract.');
			assert.deepEqual(creationCalls.map(call => call.method), [
				'initialize', 'initialized', 'model/list', 'thread/start', 'thread/inject_items',
			]);
			assert.deepEqual(findCall(creationCalls, 'thread/inject_items').params, {
				threadId: 'thread-1',
				items: [{
					type: 'message',
					role: 'developer',
					content: [{ type: 'input_text', text: 'Sundial managed session initialized.' }],
				}],
			});
		});

		await withServer('default-success', async ({ adapter, events, readTrace }) => {
			const result = await adapter.runSession?.({
				cwd: request.workspace.cwd,
				providerSessionId: 'thread-persistent',
				prompt: 'Current assignment.',
			}, event => events.push(event));
			assert.equal(result?.providerSessionId, 'thread-persistent');
			assert.equal(result?.outcome, 'completed');
			const calls = operationalCalls(await readTrace());
			assert.deepEqual(calls.map(call => call.method), [
				'initialize', 'initialized', 'model/list', 'thread/resume', 'turn/start',
			]);
			assert.equal(findCall(calls, 'turn/start').params.threadId, 'thread-persistent');
			assert.equal('model' in findCall(calls, 'turn/start').params, false);
		});

		await withServer('default-success', async ({ adapter, readTrace }) => {
			const transcript = await adapter.readSession?.({
				cwd: request.workspace.cwd,
				providerSessionId: 'thread-persistent',
			});
			assert.deepEqual(transcript, {
				providerSessionId: 'thread-persistent',
				available: true,
				transcript: [
					{ role: 'user', text: 'Fix this.' },
					{ role: 'agent', text: 'Applied fake integration change.' },
				],
			});
			assert.equal(findCall(operationalCalls(await readTrace()), 'thread/read').params.includeTurns, true);
		});
	});

	test('reports Codex thread-not-loaded as unavailable session state', async () => {
		await withServer('missing-session', async ({ adapter }) => {
			assert.deepEqual(await adapter.readSession?.({
				cwd: request.workspace.cwd,
				providerSessionId: 'missing-thread',
			}), {
				providerSessionId: 'missing-thread', available: false, transcript: [],
			});
		});
	});

	test('paginates model discovery and accepts an available explicit model id', async () => {
		await withServer('explicit-pagination', async ({ adapter, events, readTrace }) => {
			await adapter.run({ ...request, model: 'requested-id' }, event => events.push(event));

			const calls = operationalCalls(await readTrace());
			const modelCalls = calls.filter(call => call.method === 'model/list');
			assert.deepEqual(modelCalls.map(call => call.params.cursor), [null, 'page-2']);
			assert.equal(findCall(calls, 'thread/start').params.model, 'gpt-requested');
			assert.equal(findCall(calls, 'turn/start').params.model, 'gpt-requested');
		});
	});

	test('rejects an unavailable explicit model before creating a thread', async () => {
		await withServer('default-success', async ({ adapter, events, readTrace }) => {
			await assert.rejects(
				adapter.run({ ...request, model: 'gpt-missing' }, event => events.push(event)),
				/Requested Codex model "gpt-missing" is unavailable.*gpt-fallback, gpt-default/,
			);

			const calls = operationalCalls(await readTrace());
			assert.equal(calls.some(call => call.method === 'thread/start'), false);
		});
	});

	test('propagates model discovery and Codex-version RPC errors cleanly', async () => {
		await withServer('model-list-error', async ({ adapter, events }) => {
			await assert.rejects(
				adapter.run(request, event => events.push(event)),
				/Could not load available models/,
			);
		});

		await withServer('newer-codex-required', async ({ adapter, events }) => {
			await assert.rejects(
				adapter.run(request, event => events.push(event)),
				/requires a newer version of Codex/,
			);
		});
	});

	test('probes safe required behavior without starting a model turn and archives its thread', async () => {
		await withServer('default-success', async ({ adapter, readTrace }) => {
			const health = await adapter.health();
			assert.equal(health.compatible, true);
			assert.equal(health.executablePath, '/test/bin/codex');
			const calls = await readTrace();
			assert.ok(calls.some(call => call.method === 'model/list'));
			assert.ok(calls.some(call => call.method === 'thread/start'));
			assert.ok(calls.some(call => call.method === 'thread/inject_items'));
			assert.ok(calls.some(call => call.method === 'thread/read'));
			assert.ok(calls.some(call => call.method === 'thread/resume'));
			assert.ok(calls.some(call => call.method === 'turn/start' && call.params.threadId === undefined));
			assert.ok(calls.some(call => call.method === 'turn/interrupt' && call.params.threadId === undefined));
			assert.ok(calls.some(call => call.method === 'thread/archive'));
			assert.equal(calls.some(call => call.method === 'turn/start' && call.params.threadId !== undefined), false);
		});
	});

	test('names missing and malformed required RPC behavior', async () => {
		for (const [scenario, expected] of [
			['malformed-initialize', /initialize.*malformed/],
			['missing-model-list', /model\/list.*Method not found/],
			['malformed-model-list', /model\/list.*malformed/],
			['malformed-thread-start', /thread\/start.*malformed/],
			['missing-turn-start', /turn\/start.*missing/],
			['missing-turn-interrupt', /turn\/interrupt.*missing/],
			['missing-inject-not-persistent', /thread\/inject_items.*missing.*did not persist/],
		] as const) {
			await withServer(scenario, async ({ adapter }) => {
				const health = await adapter.health();
				assert.equal(health.compatible, false, scenario);
				assert.match(health.message ?? '', expected, scenario);
			});
		}
	});

	test('accepts a missing injection RPC only when thread/start is already durable', async () => {
		await withServer('missing-inject-persistent', async ({ adapter }) => {
			const health = await adapter.health();
			assert.equal(health.compatible, true);
			assert.match(health.message ?? '', /thread\/start persisted immediately/);
			assert.deepEqual(await adapter.createSession?.({
				cwd: request.workspace.cwd,
				baseInstructions: 'Managed contract.',
			}), { providerSessionId: 'thread-1' });
		});
	});

	test('retains injection materialization for servers whose empty threads are not immediately durable', async () => {
		await withServer('legacy-materialization', async ({ adapter }) => {
			const health = await adapter.health();
			assert.equal(health.compatible, true);
			assert.match(health.message ?? '', /thread\/inject_items materialization required/);
		});
	});
});

interface RpcCall {
	readonly method: string;
	readonly params: Record<string, unknown>;
}

async function withServer(
	scenario: string,
	run: (context: {
		readonly adapter: ReturnType<typeof createCodexAdapter>;
		readonly events: AgentEvent[];
		readonly readTrace: () => Promise<RpcCall[]>;
	}) => Promise<void>,
): Promise<void> {
	const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'sundial-codex-integration-'));
	const tracePath = path.join(tempDirectory, 'trace.json');
	const statePath = path.join(tempDirectory, 'state.txt');
	const adapter = createCodexAdapter({
		resolveExecutable: async () => '/test/bin/codex',
		runVersion: async executablePath => {
			assert.equal(executablePath, '/test/bin/codex');
			return 'codex-cli 0.144.6';
		},
		startAppServer: () => spawn(process.execPath, [fixturePath], {
			cwd: tempDirectory,
			stdio: ['pipe', 'pipe', 'pipe'],
			env: {
				...process.env,
				SUNDIAL_CODEX_SCENARIO: scenario,
				SUNDIAL_CODEX_TRACE: tracePath,
				SUNDIAL_CODEX_STATE: statePath,
			},
		}),
	});
	try {
		await run({
			adapter,
			events: [],
			readTrace: async () => (await readFile(tracePath, 'utf8')).trim().split('\n')
				.filter(Boolean).map(line => JSON.parse(line) as RpcCall),
		});
	} finally {
		await rm(tempDirectory, { recursive: true, force: true });
	}
}

function operationalCalls(calls: readonly RpcCall[]): readonly RpcCall[] {
	let archiveIndex = -1;
	for (let index = calls.length - 1; index >= 0; index -= 1) {
		if (calls[index].method === 'thread/archive') {
			archiveIndex = index;
			break;
		}
	}
	return archiveIndex < 0 ? calls : calls.slice(archiveIndex + 1);
}

function findCall(calls: readonly RpcCall[], method: string): RpcCall {
	const call = calls.find(candidate => candidate.method === method);
	assert.ok(call, `Expected ${method} call`);
	return call;
}
