import * as assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
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
		assert.equal(version.stdout.join(''), '0.4.0\n');

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
					officialResponses: [],
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
					officialResponses: [],
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
		const requestedOptions: unknown[] = [];
		const provider = {
			...adapter(),
			health: async (options?: unknown) => {
				requestedOptions.push(options);
				return { provider: 'codex', available: true, compatible: true, version: '0.131.0' };
			},
		};
		const run = harness();
		assert.equal(await main(['health'], run.io, { adapters: { codex: provider }, readFile: async () => '' }), 0);
		assert.deepEqual(JSON.parse(run.stdout[0]), {
			kind: 'capabilities',
			protocolVersion: 2,
			workStatuses: ['waiting', 'working', 'completed'],
			providers: ['codex'],
			commands: [
				'annotations append', 'annotations read', 'annotations delete',
				'agent list', 'agent show', 'agent rename', 'agent session ensure',
				'agent work enqueue', 'agent work ready', 'agent work list', 'agent work show',
				'agent work claim', 'agent work complete', 'agent work requeue',
				'agent transcript', 'agent open', 'agent interrupt', 'agent reset', 'prompt',
			],
			 health: { provider: 'codex', available: true, compatible: true, version: '0.131.0' },
		});
		const refreshed = harness();
		assert.equal(await main(['health', '--provider', 'codex', '--refresh'], refreshed.io, {
			adapters: { codex: provider }, readFile: async () => '',
		}), 0);
		assert.deepEqual(requestedOptions, [{ forceRefresh: false }, { forceRefresh: true }]);
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

	test('drives the persistent agent queue through the machine command surface', async () => {
		const cwd = await mkdtemp(path.join(os.tmpdir(), 'sundial-main-agent-'));
		let providerReads = 0;
		const services = {
			adapters: {
				codex: {
					...adapter(),
					createSession: async () => ({ providerSessionId: 'thread-1' }),
					readSession: async () => {
						providerReads += 1;
						return { providerSessionId: 'thread-1', available: true, transcript: [] };
					},
				},
			},
			readFile: async () => '',
		};
		const invoke = async (args: readonly string[], request: unknown): Promise<unknown> => {
			const run = harness(JSON.stringify(request));
			assert.equal(await main(args, run.io, services), 0, run.stderr.join(''));
			return JSON.parse(run.stdout.join(''));
		};
		try {
			const listed = await invoke(['agent', 'list'], { workspace: { cwd } }) as { agents: Array<{ id: string; name: string }> };
			assert.equal(listed.agents.length, 5);
			const agent = listed.agents[0];
			const ensured = await invoke(['agent', 'session', 'ensure'], {
				workspace: { cwd }, agent: { id: agent.id }, confirmedFreshSession: true,
			}) as { agent: { session: { state: string } } };
			assert.equal(ensured.agent.session.state, 'available');
			const relisted = await invoke(['agent', 'list'], { workspace: { cwd } }) as {
				agents: Array<{ id: string; session: { state: string } }>;
			};
			assert.equal(relisted.agents.find(candidate => candidate.id === agent.id)?.session.state, 'available');
			assert.equal(providerReads, 0, 'agent list must rely only on persisted session readiness');
			const shown = await invoke(['agent', 'show'], {
				workspace: { cwd }, agent: { id: agent.id },
			});
			assert.equal(JSON.stringify(shown).includes('providerSessionId'), false);

			const enqueued = await invoke(['agent', 'work', 'enqueue'], {
				workspace: { cwd }, agent: { id: agent.id }, work: {
					source: { uri: new URL('file.ts', `file://${cwd}/`).toString(), line: 0, text: 'code', before: [], after: [] },
					prompt: { preset: '%W', scope: 'line', text: 'Implement this.' },
				},
			}) as { id: string; ready: boolean; source: { path: string }; latestUpdate: { kind: string } };
			assert.equal(enqueued.ready, false);
			assert.equal(enqueued.source.path, 'file.ts');
			assert.equal(enqueued.latestUpdate.kind, 'enqueued');
			await invoke(['agent', 'work', 'ready'], { workspace: { cwd }, agentId: agent.id, work: { id: enqueued.id } });
			const claimed = await invoke(['agent', 'work', 'claim'], {
				workspace: { cwd }, agent: { id: agent.id },
			}) as { work: { id: string; assignment: { sessionId: string; sequence: number } } };
			assert.equal(claimed.work.id, enqueued.id);
			const complete = harness(JSON.stringify({
				workspace: { cwd }, agent: { id: agent.id }, work: {
					id: enqueued.id,
					agentSessionId: claimed.work.assignment.sessionId,
					assignmentSequence: claimed.work.assignment.sequence,
				}, finalUpdate: 'Completed assignment.',
			}));
			assert.equal(await main(['agent', 'work', 'complete'], complete.io, services), 1);
			assert.match(complete.stderr.join(''), /official response/);
			await invoke(['agent', 'work', 'requeue'], {
				workspace: { cwd }, agent: { id: agent.id }, work: {
					id: enqueued.id, agentSessionId: claimed.work.assignment.sessionId,
					assignmentSequence: claimed.work.assignment.sequence,
				}, reason: 'Provider ended without a response.',
			});
			const work = await invoke(['agent', 'work', 'list'], { workspace: { cwd } }) as { work: Array<{ status: string; latestUpdate: { kind: string; message: string } }> };
			assert.equal(work.work[0].status, 'waiting');
			assert.equal(work.work[0].latestUpdate.kind, 'requeued');
			assert.equal(work.work[0].latestUpdate.message, 'Provider ended without a response.');
		} finally {
			await rm(cwd, { recursive: true, force: true });
		}
	});

	test('marks a managed session missing when Codex reports no rollout', async () => {
		const cwd = await mkdtemp(path.join(os.tmpdir(), 'sundial-main-missing-session-'));
		const provider = {
			...adapter(),
			createSession: async () => ({ providerSessionId: 'thread-lost' }),
			readSession: async () => ({ providerSessionId: 'thread-lost', available: true, transcript: [] }),
			runSession: async (): Promise<never> => { throw new Error('no rollout found for thread id thread-lost'); },
		};
		const services = { adapters: { codex: provider }, readFile: async () => '' };
		const invoke = async (args: readonly string[], value: unknown): Promise<unknown> => {
			const run = harness(JSON.stringify(value));
			assert.equal(await main(args, run.io, services), 0, run.stderr.join(''));
			return JSON.parse(run.stdout.join(''));
		};
		try {
			const listed = await invoke(['agent', 'list'], { workspace: { cwd } }) as { agents: Array<{ id: string }> };
			const agentId = listed.agents[0].id;
			const ensured = await invoke(['agent', 'session', 'ensure'], {
				workspace: { cwd }, agent: { id: agentId }, confirmedFreshSession: true,
			}) as { session: { id: string } };
			const queued = await invoke(['agent', 'work', 'enqueue'], {
				workspace: { cwd }, agent: { id: agentId }, work: {
					source: { uri: new URL('file.ts', `file://${cwd}/`).toString(), line: 0, text: 'code', before: [], after: [] },
					prompt: { preset: '%Q', scope: 'line', text: 'Explain this.' },
				},
			}) as { id: string };
			await invoke(['agent', 'work', 'ready'], { workspace: { cwd }, agentId, work: { id: queued.id } });
			const claimed = await invoke(['agent', 'work', 'claim'], {
				workspace: { cwd }, agent: { id: agentId }, expectedSessionId: ensured.session.id,
			}) as { work: { assignment: { sequence: number } } };

			const promptRun = harness(JSON.stringify({
				provider: 'codex', workspace: { cwd }, managed: {
					agentId,
					agentSessionId: ensured.session.id,
					userAnnotationId: queued.id,
					assignmentSequence: claimed.work.assignment.sequence,
				},
			}));
			assert.equal(await main(['prompt'], promptRun.io, services), 1);
			assert.match(promptRun.stderr.join(''), /no rollout found/);

			const detail = await invoke(['agent', 'show'], { workspace: { cwd }, agent: { id: agentId } }) as {
				session: { state: string };
			};
			assert.equal(detail.session.state, 'missing');
		} finally {
			await rm(cwd, { recursive: true, force: true });
		}
	});
});
