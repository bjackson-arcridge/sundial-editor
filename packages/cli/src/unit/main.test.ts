import * as assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { describe, test } from 'node:test';
import type { ProviderAdapter } from '../adapters/adapter';
import { main, type CliIo } from '../main';
import type { AgentEvent, PromptRequest } from '../protocol';

const request: PromptRequest = {
	provider: 'codex',
	workspace: { cwd: '/workspace' },
	document: { uri: 'file:///workspace/example.ts', line: 2, text: '%F' },
	prompt: { preset: '%F', scope: 'line', text: 'Fix this.' },
};

function harness(input = ''): { io: CliIo; stdout: string[]; stderr: string[] } {
	const stdout: string[] = [];
	const stderr: string[] = [];
	return {
		io: {
			stdin: Readable.from([input]),
			stdout: { write: chunk => stdout.push(chunk) },
			stderr: { write: chunk => stderr.push(chunk) },
		},
		stdout,
		stderr,
	};
}

function adapter(events: readonly AgentEvent[] = []): ProviderAdapter {
	return {
		health: async () => ({ provider: 'codex', available: true, compatible: true, version: '0.131.0' }),
		run: async (_request, emit) => { events.forEach(emit); },
	};
}

describe('main', () => {
	test('renders version and help', async () => {
		const version = harness();
		assert.equal(await main(['--version'], version.io, { adapters: {}, readFile: async () => '' }), 0);
		assert.equal(version.stdout.join(''), '0.1.1\n');

		const help = harness();
		assert.equal(await main(['help'], help.io, { adapters: {}, readFile: async () => '' }), 0);
		assert.match(help.stdout.join(''), /prompt \[--input request\.json\]/);
	});

	test('reports health as machine-readable capabilities', async () => {
		const run = harness();
		assert.equal(await main(['health'], run.io, { adapters: { codex: adapter() }, readFile: async () => '' }), 0);
		assert.deepEqual(JSON.parse(run.stdout[0]), {
			kind: 'capabilities',
			protocolVersion: 1,
			statuses: ['waiting', 'working', 'blocked'],
			health: { provider: 'codex', available: true, compatible: true, version: '0.131.0' },
		});
	});

	test('validates stdin and emits newline-delimited adapter events', async () => {
		const run = harness(JSON.stringify(request));
		const code = await main(['prompt'], run.io, {
			adapters: { codex: adapter([
				{ kind: 'status', status: 'working' },
				{ kind: 'output', text: 'Done.' },
			]) },
			readFile: async () => '',
		});
		assert.equal(code, 0);
		assert.deepEqual(run.stdout.map(line => JSON.parse(line)), [
			{ kind: 'status', status: 'working' },
			{ kind: 'output', text: 'Done.' },
			{ kind: 'status', status: 'waiting' },
		]);
	});

	test('reads a JSON file and maps validation failures to blocked/error events', async () => {
		const run = harness();
		const code = await main(['prompt', '--input', 'request.json'], run.io, {
			adapters: { codex: adapter() },
			readFile: async path => {
				assert.equal(path, 'request.json');
				return '{"provider":"other"}';
			},
		});
		assert.equal(code, 1);
		assert.equal(JSON.parse(run.stdout[0]).status, 'blocked');
		assert.equal(JSON.parse(run.stdout[1]).kind, 'error');
		assert.match(run.stderr.join(''), /provider must be "codex"/);
	});

	test('rejects unknown commands with a usage error', async () => {
		const run = harness();
		assert.equal(await main(['nope'], run.io, { adapters: {}, readFile: async () => '' }), 2);
		assert.match(run.stderr.join(''), /Unknown command/);
	});
});
