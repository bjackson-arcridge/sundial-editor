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
	test('discovers and explicitly starts a thread with the available default model', async () => {
		await withServer('default-success', async ({ adapter, events, readTrace }) => {
			await adapter.run(request, event => events.push(event));

			assert.deepEqual(events, [
				{ kind: 'status', status: 'working', message: 'Codex is working.' },
				{ kind: 'output', text: 'Applied fake integration change.' },
			]);
			const calls = await readTrace();
			assert.deepEqual(calls.map(call => call.method), [
				'initialize', 'initialized', 'model/list', 'thread/start', 'turn/start',
			]);
			assert.equal(findCall(calls, 'thread/start').params.model, 'gpt-default');
		});
	});

	test('paginates model discovery and accepts an available explicit model id', async () => {
		await withServer('explicit-pagination', async ({ adapter, events, readTrace }) => {
			await adapter.run({ ...request, model: 'requested-id' }, event => events.push(event));

			const calls = await readTrace();
			const modelCalls = calls.filter(call => call.method === 'model/list');
			assert.deepEqual(modelCalls.map(call => call.params.cursor), [null, 'page-2']);
			assert.equal(findCall(calls, 'thread/start').params.model, 'gpt-requested');
		});
	});

	test('rejects an unavailable explicit model before creating a thread', async () => {
		await withServer('default-success', async ({ adapter, events, readTrace }) => {
			await assert.rejects(
				adapter.run({ ...request, model: 'gpt-missing' }, event => events.push(event)),
				/Requested Codex model "gpt-missing" is unavailable.*gpt-fallback, gpt-default/,
			);

			const calls = await readTrace();
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
	const adapter = createCodexAdapter({
		runVersion: async () => 'codex-cli 0.131.0',
		startAppServer: () => spawn(process.execPath, [fixturePath], {
			cwd: tempDirectory,
			stdio: ['pipe', 'pipe', 'pipe'],
			env: {
				...process.env,
				SUNDIAL_CODEX_SCENARIO: scenario,
				SUNDIAL_CODEX_TRACE: tracePath,
			},
		}),
	});
	try {
		await run({
			adapter,
			events: [],
			readTrace: async () => JSON.parse(await readFile(tracePath, 'utf8')) as RpcCall[],
		});
	} finally {
		await rm(tempDirectory, { recursive: true, force: true });
	}
}

function findCall(calls: readonly RpcCall[], method: string): RpcCall {
	const call = calls.find(candidate => candidate.method === method);
	assert.ok(call, `Expected ${method} call`);
	return call;
}
