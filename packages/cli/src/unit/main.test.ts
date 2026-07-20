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
		assert.equal(version.stdout.join(''), '0.2.0\n');

		const help = harness();
		assert.equal(await main(['help'], help.io, { adapters: {}, readFile: async () => '' }), 0);
		assert.match(help.stdout.join(''), /prompt \[--input request\.json\]/);
		assert.match(help.stdout.join(''), /annotations append/);
		assert.match(help.stdout.join(''), /annotations delete/);
	});

	test('routes annotation append, delete, and read operations as JSON', async () => {
		const append = harness('{"append":true}');
		assert.equal(await main(['annotations', 'append'], append.io, {
			adapters: {}, readFile: async () => '',
			appendUserAnnotation: async value => {
				assert.deepEqual(value, { append: true });
				return {
					id: 'annotation-1', message: 'Fix it.', preset: '%F', scope: 'line',
					anchor: { line: 2, text: 'code', before: ['before'], after: ['after'] },
				};
			},
		}), 0);
		assert.equal(JSON.parse(append.stdout[0]).id, 'annotation-1');

		const remove = harness('{"annotation":{"id":"annotation-1"}}');
		assert.equal(await main(['annotations', 'delete'], remove.io, {
			adapters: {}, readFile: async () => '',
			deleteUserAnnotation: async value => {
				assert.deepEqual(value, { annotation: { id: 'annotation-1' } });
				return {
					id: 'annotation-1', message: 'Fix it.', preset: '%F', scope: 'line',
					anchor: { line: 2, text: 'code', before: [], after: [] },
				};
			},
		}), 0);
		assert.equal(JSON.parse(remove.stdout[0]).id, 'annotation-1');

		const read = harness('{"read":true}');
		assert.equal(await main(['annotations', 'read'], read.io, {
			adapters: {}, readFile: async () => '',
			readUserAnnotations: async value => {
				assert.deepEqual(value, { read: true });
				return { version: 1, annotations: [] };
			},
		}), 0);
		assert.deepEqual(JSON.parse(read.stdout[0]), { version: 1, annotations: [] });
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
