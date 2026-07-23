import * as assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { Readable } from 'node:stream';
import { describe, test } from 'node:test';
import type { ProviderAdapter } from '../adapters/adapter';
import {
	attachProviderSession,
	claimNextWork,
	enqueueWork,
	ensureAgentSession,
	listAgents,
	markWorkReady,
	showAgent,
} from '../agentStore';
import { GitWorkflowConflictError } from '../gitProcess';
import { main, type CliIo } from '../main';
import type { AgentEvent } from '../protocol';

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
		runSession: async (request, emit) => {
			events.forEach(emit);
			return { providerSessionId: request.providerSessionId, output: '', outcome: 'completed' };
		},
	};
}

const permanentBaseCommit = 'a'.repeat(40);

describe('main', () => {
	test('renders version and help', async () => {
		const version = harness();
		assert.equal(await main(['--version'], version.io, { adapters: {}, readFile: async () => '' }), 0);
		assert.equal(version.stdout.join(''), '0.9.0\n');

		const help = harness();
		assert.equal(await main(['help'], help.io, { adapters: {}, readFile: async () => '' }), 0);
		assert.match(help.stdout.join(''), /prompt \[--input request\.json\]/);
		assert.match(help.stdout.join(''), /annotations append/);
		assert.match(help.stdout.join(''), /annotations delete/);
		assert.match(help.stdout.join(''), /workflow checkpoint-file/);
		assert.match(help.stdout.join(''), /workflow consolidate/);
	});

	test('routes every workflow operation through the machine command surface', async () => {
		const state = {
			head: 'a'.repeat(40), baseline: 'b'.repeat(40), lastPermanentCommit: 'c'.repeat(40),
			temporaryCommitCount: 2, untrackedPaths: [], affectedPaths: ['source.ts'],
		};
		const request = { workspace: { cwd: '/workspace' }, marker: 'request' };
		const calls: string[] = [];
		const services = {
			adapters: {}, readFile: async () => '',
			readGitWorkflowState: async (value: unknown) => { assert.deepEqual(value, request); calls.push('state'); return state; },
			moveGitWorkflowBaseline: async (value: unknown) => { assert.deepEqual(value, request); calls.push('baseline'); return state; },
			createTemporaryCommit: async (value: unknown, all: boolean) => {
				assert.deepEqual(value, request); calls.push(all ? 'checkpoint-all' : 'checkpoint-file'); return state;
			},
			consolidateTemporaryCommits: async (value: unknown) => { assert.deepEqual(value, request); calls.push('consolidate'); return state; },
			repairFromDiff: async (value: unknown) => {
				assert.deepEqual(value, request);
				calls.push('repair');
				return { companionRepair: { actions: [], affectedPaths: [] }, affectedPaths: [] };
			},
		};
		for (const operation of ['state', 'baseline', 'checkpoint-file', 'checkpoint-all', 'consolidate'] as const) {
			const run = harness(JSON.stringify(request));
			assert.equal(await main(['workflow', operation], run.io, services), 0, run.stderr.join(''));
			assert.deepEqual(JSON.parse(run.stdout.join('')), state);
		}
		const repair = harness(JSON.stringify(request));
		assert.equal(await main(['workflow', 'repair'], repair.io, services), 0, repair.stderr.join(''));
		assert.deepEqual(JSON.parse(repair.stdout.join('')), { actions: [], affectedPaths: [] });
		assert.deepEqual(calls, ['state', 'baseline', 'checkpoint-file', 'checkpoint-all', 'consolidate', 'repair']);

		const invalid = harness('{}');
		assert.equal(await main(['workflow', 'unknown'], invalid.io, services), 1);
		assert.match(invalid.stderr.join(''), /workflow requires/);
	});

	test('projects workflow state conflicts as typed machine failures', async () => {
		const run = harness('{"workspace":{"cwd":"/workspace"}}');
		assert.equal(await main(['workflow', 'checkpoint-all'], run.io, {
			adapters: {}, readFile: async () => '',
			createTemporaryCommit: async () => { throw new GitWorkflowConflictError('nothing_to_checkpoint', 'There are no dirty files to checkpoint.'); },
		}), 1);
		assert.deepEqual(JSON.parse(run.stdout.join('')), {
			kind: 'conflict', code: 'nothing_to_checkpoint', message: 'There are no dirty files to checkpoint.',
		});
		assert.match(run.stderr.join(''), /no dirty files/);
	});

	test('routes annotation append, delete, and read operations as JSON', async () => {
		const append = harness('{"append":true}');
		assert.equal(await main(['annotations', 'append'], append.io, {
			adapters: {}, readFile: async () => '',
			appendUserAnnotation: async value => {
				assert.deepEqual(value, { append: true });
				return {
					kind: 'user',
					id: 'annotation-1', permanentBaseCommit, message: 'Fix it.', preset: '%F', scope: 'line',
					anchor: { line: 2, text: 'code', before: ['before'], after: ['after'] },
					officialResponses: [],
					agentAnnotations: [],
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
					kind: 'user',
					id: 'annotation-1', permanentBaseCommit, message: 'Fix it.', preset: '%F', scope: 'line',
					anchor: { line: 2, text: 'code', before: [], after: [] },
					officialResponses: [],
					agentAnnotations: [],
				};
			},
		}), 0);
		assert.equal(JSON.parse(remove.stdout[0]).id, 'annotation-1');

		const read = harness('{"read":true}');
		assert.equal(await main(['annotations', 'read'], read.io, {
			adapters: {}, readFile: async () => '',
			readUserAnnotations: async value => {
				assert.deepEqual(value, { read: true });
				return { version: 5, sourceDigest: 'd'.repeat(64), annotations: [], currentPermanentCommit: permanentBaseCommit, currentPermanentAnnotationIds: [] };
			},
		}), 0);
		assert.deepEqual(JSON.parse(read.stdout[0]), { version: 5, sourceDigest: 'd'.repeat(64), annotations: [], currentPermanentCommit: permanentBaseCommit, currentPermanentAnnotationIds: [] });

		const reanchor = harness('{"previousSource":"old"}');
		assert.equal(await main(['annotations', 'reanchor'], reanchor.io, {
			adapters: {}, readFile: async () => '',
			reanchorAnnotations: async value => {
				assert.deepEqual(value, { previousSource: 'old' });
				return {
					companion: { version: 5, sourceDigest: 'd'.repeat(64), annotations: [], currentPermanentCommit: permanentBaseCommit, currentPermanentAnnotationIds: [] },
					changedAnnotationIds: [], fileScopedAnnotationIds: [], affectedPaths: [], alreadyApplied: true,
				};
			},
		}), 0);
		assert.equal(JSON.parse(reanchor.stdout[0]).alreadyApplied, true);
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
			protocolVersion: 3,
			workStatuses: ['waiting', 'working', 'completed'],
			coordinationStates: ['working', 'waiting', 'blocked', 'paused'],
			providers: ['codex'],
			commands: [
				'annotations append', 'annotations read', 'annotations delete', 'annotations reanchor',
				'workflow state', 'workflow baseline', 'workflow checkpoint-file', 'workflow checkpoint-all', 'workflow consolidate', 'workflow repair',
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
			await writeFile(path.join(cwd, 'file.ts'), '\n');
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
					source: { uri: new URL('file.ts', `file://${cwd}/`).toString(), line: 0, text: '', before: [], after: [] },
					prompt: { preset: '%W', scope: 'line', text: 'Implement this.' },
				},
			}) as { id: string; ready: boolean; source: { path: string; text: string }; latestUpdate: { kind: string } };
			assert.equal(enqueued.ready, false);
			assert.equal(enqueued.source.path, 'file.ts');
			assert.equal(enqueued.source.text, '', 'blank annotation target lines remain valid work source text');
			assert.equal(enqueued.latestUpdate.kind, 'enqueued');
			await invoke(['agent', 'work', 'ready'], { workspace: { cwd }, agentId: agent.id, work: { id: enqueued.id } });
			const claimed = await invoke(['agent', 'work', 'claim'], {
				workspace: { cwd }, agent: { id: agent.id },
			}) as { work: { id: string; assignment: { sessionId: string; sequence: number } } };
			assert.equal(claimed.work.id, enqueued.id);
			const promptRun = harness(JSON.stringify({
				provider: 'codex',
				workspace: { cwd },
				managed: {
					agentId: agent.id,
					agentSessionId: claimed.work.assignment.sessionId,
					userAnnotationId: enqueued.id,
					assignmentSequence: claimed.work.assignment.sequence,
				},
			}));
			assert.equal(await main(['prompt'], promptRun.io, services), 0, promptRun.stderr.join(''));
			const afterPrompt = await invoke(['agent', 'show'], {
				workspace: { cwd }, agent: { id: agent.id },
			}) as { coordination: { state: string } };
			assert.equal(afterPrompt.coordination.state, 'waiting');
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
			const reset = await invoke(['agent', 'reset'], { workspace: { cwd }, agent: { id: agent.id } }) as {
				session: { state: string };
			};
			assert.equal(reset.session.state, 'available');
			const cleared = await invoke(['agent', 'work', 'list'], { workspace: { cwd }, agent: { id: agent.id } }) as {
				work: unknown[];
			};
			assert.deepEqual(cleared.work, []);
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
			await writeFile(path.join(cwd, 'file.ts'), 'code\n');
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

	test('persists a blocked coordination state when an active provider turn fails', async () => {
		const cwd = await mkdtemp(path.join(os.tmpdir(), 'sundial-main-blocked-session-'));
		try {
			const agent = (await listAgents(cwd))[0];
			const session = await ensureAgentSession({ workspaceCwd: cwd, selector: agent.id });
			await attachProviderSession({ workspaceCwd: cwd, agentSessionId: session.id, providerSessionId: 'thread-1' });
			await enqueueWork({
				workspaceCwd: cwd,
				agentSelector: agent.id,
				userAnnotationId: 'work-1',
				source: { uri: 'file:///workspace/a.ts', path: 'a.ts', line: 0, text: 'code', before: [], after: [] },
				prompt: { preset: '%F', scope: 'line', text: 'Fix it.' },
			});
			await markWorkReady({ workspaceCwd: cwd, userAnnotationId: 'work-1' });
			const work = await claimNextWork({ workspaceCwd: cwd, agentSelector: agent.id });
			assert.ok(work?.assignment);
			const run = harness(JSON.stringify({
				provider: 'codex',
				workspace: { cwd },
				managed: {
					agentId: agent.id,
					agentSessionId: session.id,
					userAnnotationId: work.id,
					assignmentSequence: work.assignment.sequence,
				},
			}));
			assert.equal(await main(['prompt'], run.io, {
				adapters: {
					codex: {
						...adapter(),
						runSession: async (): Promise<never> => { throw new Error('Provider is temporarily unavailable.'); },
					},
				},
				readFile: async () => '',
			}), 1);
			const detail = await showAgent(cwd, agent.id);
			assert.equal(detail.coordination?.state, 'blocked');
			assert.equal(detail.coordination?.message, 'Provider is temporarily unavailable.');
		} finally {
			await rm(cwd, { recursive: true, force: true });
		}
	});
});
