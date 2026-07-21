import * as assert from 'node:assert/strict';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { describe, test } from 'node:test';
import {
	appendAnnotationViaCli,
	claimWorkViaCli,
	completeWorkViaCli,
	deleteAnnotationViaCli,
	enqueueWorkViaCli,
	ensureAgentSessionViaCli,
	interruptAgentViaCli,
	listAgentsViaCli,
	listWorkViaCli,
	markWorkReadyViaCli,
	openAgentViaCli,
	parseAgentRunEvent,
	readAnnotationsViaCli,
	renameAgentViaCli,
	repairCompanionsViaCli,
	requeueWorkViaCli,
	resetAgentViaCli,
	resolveCliInvocation,
	runGitWorkflowViaCli,
	startManagedAgentRun,
	transcriptViaCli,
	type CliProcessServices,
} from '../cliRunner';
import {
	parseAgentId,
	parseAgentSessionId,
	parseUserAnnotationId,
	type NamedAgent,
	type UserAnnotationWorkItem,
} from '../agentProtocol';

const cwd = '/workspace';
const cliPath = '/workspace/cli.js';
const agentId = parseAgentId('agent-bob');
const sessionId = parseAgentSessionId('session-bob-1');
const workId = parseUserAnnotationId('annotation-1');
const enqueuedAt = '2026-07-20T14:00:00.000Z';
const claimedAt = '2026-07-20T14:01:00.000Z';
const permanentBaseCommit = 'a'.repeat(40);

const waitingWork: UserAnnotationWorkItem = {
	id: workId,
	agentId,
	status: 'waiting',
	ready: false,
	enqueuedAt,
	updatedAt: enqueuedAt,
	latestUpdate: { at: enqueuedAt, kind: 'enqueued', message: 'Waiting for Bob.' },
	source: {
		uri: 'file:///workspace/src/example.ts',
		line: 4,
		text: 'const value = 1;',
		before: ['function calculate() {'],
		after: ['return value;', '}'],
	},
	prompt: { preset: '%W', scope: 'project', text: 'Update this behavior.' },
	updates: [{ at: enqueuedAt, kind: 'enqueued', message: 'Waiting for Bob.' }],
};

const workingWork: UserAnnotationWorkItem = {
	...waitingWork,
	status: 'working',
	ready: true,
	updatedAt: claimedAt,
	latestUpdate: { at: claimedAt, kind: 'claimed', message: 'Bob started work.' },
	assignment: { sessionId, sequence: 3, claimedAt },
	updates: [
		...waitingWork.updates,
		{ at: claimedAt, kind: 'claimed', message: 'Bob started work.' },
	],
};

const bob: NamedAgent = {
	id: agentId,
	slot: 1,
	name: 'Bob',
	session: { state: 'available', id: sessionId, provider: 'codex' },
	queue: { waiting: 1, working: 0, completed: 2 },
	controls: {
		canRename: true,
		canEnsureSession: false,
		canOpen: true,
		canInterrupt: false,
		canReset: true,
	},
};

describe('CLI runner', () => {
	test('resolves installed executables and JavaScript test CLIs for arbitrary commands', () => {
		assert.deepEqual(resolveCliInvocation('sundial-editor-cli', '/node'), {
			command: 'sundial-editor-cli', args: ['prompt'],
		});
		assert.deepEqual(resolveCliInvocation(cliPath, '/node', ['agent', 'work', 'list']), {
			command: '/node', args: [cliPath, 'agent', 'work', 'list'],
		});
	});

	test('accepts only typed managed-run NDJSON events', () => {
		assert.deepEqual(parseAgentRunEvent('{"kind":"status","status":"waiting"}'), { kind: 'status', status: 'waiting' });
		assert.deepEqual(parseAgentRunEvent('{"kind":"status","status":"working","message":"Editing."}'), {
			kind: 'status', status: 'working', message: 'Editing.',
		});
		assert.deepEqual(parseAgentRunEvent('{"kind":"output","text":"Done"}'), { kind: 'output', text: 'Done' });
		assert.deepEqual(parseAgentRunEvent('{"kind":"error","message":"Failed","recoverable":true}'), {
			kind: 'error', message: 'Failed', recoverable: true,
		});
		assert.equal(parseAgentRunEvent('{"kind":"status","status":"busy"}'), undefined);
		assert.equal(parseAgentRunEvent('{"kind":"output","text":4}'), undefined);
		assert.equal(parseAgentRunEvent('{"kind":"error","message":"Failed"}'), undefined);
		assert.equal(parseAgentRunEvent('not-json'), undefined);
	});

	test('starts a managed assignment without resending prompt or provider-native identity', async () => {
		const child = fakeChild();
		let invocation: ProcessInvocation | undefined;
		const events: unknown[] = [];
		const run = startManagedAgentRun({
			cliPath,
			cwd,
			agentId,
			agentSessionId: sessionId,
			userAnnotationId: workId,
			assignmentSequence: 3,
			model: 'gpt-5.6-codex',
		}, event => events.push(event), servicesFor(child, captured => { invocation = captured; }));

		child.stdout.write('{"kind":"status","status":"working"}\n');
		child.stdout.write('{"kind":"output","text":"Patched."}\n');
		child.emitter.emit('exit', 0);

		assert.deepEqual(await run.completion, { exitCode: 0, stderr: '' });
		assert.deepEqual(invocation, { command: '/node', args: [cliPath, 'prompt'], cwd });
		assert.deepEqual(events, [
			{ kind: 'status', status: 'working' },
			{ kind: 'output', text: 'Patched.' },
		]);
		assert.deepEqual(JSON.parse(child.stdinData()), {
			provider: 'codex',
			model: 'gpt-5.6-codex',
			workspace: { cwd },
			managed: { agentId, agentSessionId: sessionId, userAnnotationId: workId, assignmentSequence: 3 },
		});
	});

	test('forwards managed-run cancellation to the CLI as SIGINT', async () => {
		const child = fakeChild();
		const run = startManagedAgentRun({
			cliPath, cwd, agentId, agentSessionId: sessionId, userAnnotationId: workId, assignmentSequence: 3,
		}, () => undefined, servicesFor(child));
		run.cancel();
		assert.equal(child.killedWith(), 'SIGINT');
		child.emitter.emit('exit', 0);
		await run.completion;
	});

	test('passes a preallocated user annotation identity to annotation append', async () => {
		const child = fakeChild();
		let invocation: ProcessInvocation | undefined;
		const request = {
			workspace: { cwd },
			document: { uri: waitingWork.source.uri, line: waitingWork.source.line },
			annotation: { id: workId, message: waitingWork.prompt.text, preset: '%W' as const, scope: 'project' as const },
		};
		const result = appendAnnotationViaCli(cliPath, request, servicesFor(child, captured => { invocation = captured; }));
		finishJson(child, {
			kind: 'user',
			id: workId,
			permanentBaseCommit,
			message: waitingWork.prompt.text,
			preset: '%W',
			scope: 'project',
			anchor: {
				line: waitingWork.source.line,
				text: waitingWork.source.text,
				before: waitingWork.source.before,
				after: waitingWork.source.after,
			},
			officialResponses: [],
			agentAnnotations: [],
		});

		assert.equal((await result).id, workId);
		assert.deepEqual(invocation, { command: '/node', args: [cliPath, 'annotations', 'append'], cwd });
		assert.deepEqual(JSON.parse(child.stdinData()), request);
	});

	test('uses typed annotation read and delete requests', async () => {
		const readChild = fakeChild();
		const read = readAnnotationsViaCli('sundial-editor-cli', {
			workspace: { cwd }, document: { uri: waitingWork.source.uri },
		}, servicesFor(readChild, invocation => {
			assert.deepEqual(invocation.args, ['annotations', 'read']);
		}));
		finishJson(readChild, {
			version: 4, annotations: [], currentPermanentCommit: permanentBaseCommit, currentPermanentAnnotationIds: [],
		});
		assert.deepEqual(await read, {
			version: 4, annotations: [], currentPermanentCommit: permanentBaseCommit, currentPermanentAnnotationIds: [],
		});
		const malformedReadChild = fakeChild();
		const malformedRead = readAnnotationsViaCli('sundial-editor-cli', {
			workspace: { cwd }, document: { uri: waitingWork.source.uri },
		}, servicesFor(malformedReadChild));
		finishJson(malformedReadChild, {
			version: 4, annotations: [], currentPermanentCommit: permanentBaseCommit,
			currentPermanentAnnotationIds: ['annotation-not-in-current-commit'],
		});
		await assert.rejects(malformedRead, /malformed annotation companion/);

		const deleteChild = fakeChild();
		const remove = deleteAnnotationViaCli(cliPath, {
			workspace: { cwd }, document: { uri: waitingWork.source.uri }, annotation: { id: workId },
		}, servicesFor(deleteChild, invocation => {
			assert.deepEqual(invocation.args, [cliPath, 'annotations', 'delete']);
		}));
		finishJson(deleteChild, {
			kind: 'user',
			id: workId,
			permanentBaseCommit,
			message: waitingWork.prompt.text,
			preset: '%W',
			scope: 'project',
				anchor: { line: 4, text: 'const value = 1;', before: [], after: [] },
			officialResponses: [],
			agentAnnotations: [],
		});
		assert.equal((await remove).id, workId);
	});

	test('uses and validates the typed Git workflow machine protocol', async () => {
		const child = fakeChild();
		let invocation: ProcessInvocation | undefined;
		const state = {
			head: 'a'.repeat(40), baseline: 'b'.repeat(40), lastPermanentCommit: 'c'.repeat(40),
		temporaryCommitCount: 2, untrackedPaths: [], affectedPaths: ['source.ts'],
		};
		const result = runGitWorkflowViaCli(cliPath, cwd, 'checkpoint-file', { file: '/workspace/source.ts' }, servicesFor(child, value => { invocation = value; }));
		finishJson(child, state);
		assert.deepEqual(await result, state);
		assert.deepEqual(invocation, { command: '/node', args: [cliPath, 'workflow', 'checkpoint-file'], cwd });
		assert.deepEqual(JSON.parse(child.stdinData()), { workspace: { cwd }, file: '/workspace/source.ts' });

		const malformedChild = fakeChild();
		const malformed = runGitWorkflowViaCli(cliPath, cwd, 'state', {}, servicesFor(malformedChild));
		finishJson(malformedChild, { ...state, temporaryCommitCount: -1 });
		await assert.rejects(malformed, /malformed Git workflow state/);

		const missingUntrackedPathsChild = fakeChild();
		const missingUntrackedPaths = runGitWorkflowViaCli(cliPath, cwd, 'state', {}, servicesFor(missingUntrackedPathsChild));
		finishJson(missingUntrackedPathsChild, { ...state, untrackedPaths: undefined });
		await assert.rejects(missingUntrackedPaths, /malformed Git workflow state/);

		const conflictChild = fakeChild();
		const conflict = runGitWorkflowViaCli(cliPath, cwd, 'consolidate', { message: 'Commit' }, servicesFor(conflictChild));
		conflictChild.stdout.write(`${JSON.stringify({ kind: 'conflict', code: 'published_temporary_commit', message: 'Published temporary commit.' })}\n`);
		conflictChild.emitter.emit('exit', 1);
		await assert.rejects(conflict, error => error instanceof Error
			&& error.name === 'CliConflictError'
			&& 'code' in error && error.code === 'published_temporary_commit');
	});

	test('uses and validates the companion repair machine protocol', async () => {
		const child = fakeChild();
		let invocation: ProcessInvocation | undefined;
		const result = repairCompanionsViaCli(cliPath, cwd, servicesFor(child, value => { invocation = value; }));
		finishJson(child, {
			actions: [{
				kind: 'move', source: 'old.ts', destination: 'new.ts',
				companion: '.sundial/old.ts.comments', destinationCompanion: '.sundial/new.ts.comments',
			}],
			affectedPaths: ['.sundial/old.ts.comments', '.sundial/new.ts.comments'],
		});
		assert.equal((await result).actions[0].kind, 'move');
		assert.deepEqual(invocation, { command: '/node', args: [cliPath, 'workflow', 'repair'], cwd });
		assert.deepEqual(JSON.parse(child.stdinData()), { workspace: { cwd } });

		const malformedChild = fakeChild();
		const malformed = repairCompanionsViaCli(cliPath, cwd, servicesFor(malformedChild));
		finishJson(malformedChild, { actions: [{ kind: 'delete', source: 'old.ts' }], affectedPaths: [] });
		await assert.rejects(malformed, /malformed companion repair result/);
	});

	test('unwraps agent and work collection results from the machine protocol', async () => {
		const agentsChild = fakeChild();
		const agents = listAgentsViaCli(cliPath, cwd, servicesFor(agentsChild, invocation => {
			assert.deepEqual(invocation.args, [cliPath, 'agent', 'list']);
		}));
		finishJson(agentsChild, { agents: [bob] });
		assert.deepEqual(await agents, [bob]);
		assert.deepEqual(JSON.parse(agentsChild.stdinData()), { workspace: { cwd } });

		const workChild = fakeChild();
		const work = listWorkViaCli(cliPath, cwd, servicesFor(workChild, invocation => {
			assert.deepEqual(invocation.args, [cliPath, 'agent', 'work', 'list']);
		}));
		finishJson(workChild, { work: [waitingWork] });
		assert.deepEqual(await work, [waitingWork]);
		assert.deepEqual(JSON.parse(workChild.stdinData()), { workspace: { cwd } });
	});

	test('uses agent/work wrappers to enqueue, ready, and claim durable work', async () => {
		const enqueueChild = fakeChild();
		const enqueue = enqueueWorkViaCli(cliPath, cwd, agentId, {
			userAnnotationId: workId,
			source: waitingWork.source,
			prompt: waitingWork.prompt,
		}, servicesFor(enqueueChild));
		finishJson(enqueueChild, waitingWork);
		assert.deepEqual(await enqueue, waitingWork);
		assert.deepEqual(JSON.parse(enqueueChild.stdinData()), {
			workspace: { cwd },
			agent: { id: agentId },
			work: {
				userAnnotationId: workId,
				source: waitingWork.source,
				prompt: waitingWork.prompt,
			},
		});

		const readyChild = fakeChild();
		const ready = markWorkReadyViaCli(cliPath, cwd, workId, agentId, servicesFor(readyChild));
		const readyWork = {
			...waitingWork,
			ready: true,
			updatedAt: claimedAt,
			latestUpdate: { at: claimedAt, kind: 'ready' as const, message: 'Ready for Bob.' },
			updates: [...waitingWork.updates, { at: claimedAt, kind: 'ready' as const, message: 'Ready for Bob.' }],
		};
		finishJson(readyChild, readyWork);
		assert.deepEqual(await ready, readyWork);
		assert.deepEqual(JSON.parse(readyChild.stdinData()), {
			workspace: { cwd }, agentId, work: { id: workId },
		});

		const claimChild = fakeChild();
		const claim = claimWorkViaCli(cliPath, cwd, agentId, servicesFor(claimChild));
		finishJson(claimChild, { work: workingWork });
		assert.deepEqual(await claim, workingWork);
		assert.deepEqual(JSON.parse(claimChild.stdinData()), {
			workspace: { cwd }, agent: { id: agentId },
		});

		const emptyChild = fakeChild();
		const empty = claimWorkViaCli(cliPath, cwd, agentId, servicesFor(emptyChild));
		finishJson(emptyChild, { work: null });
		assert.equal(await empty, undefined);
	});

	test('ensures a missing session only with the explicit fresh-session confirmation field', async () => {
		const child = fakeChild();
		const ensured = ensureAgentSessionViaCli(cliPath, cwd, agentId, servicesFor(child));
		finishJson(child, {
			agent: bob,
			session: { id: sessionId, state: 'available', provider: 'codex' },
		});
		assert.deepEqual(await ensured, bob);
		assert.deepEqual(JSON.parse(child.stdinData()), {
			workspace: { cwd },
			agent: { id: agentId },
			confirmedFreshSession: true,
		});
	});

	test('sends compare-and-transition evidence when completing or requeueing work', async () => {
		const transition = { agentId, sessionId, workId, assignmentSequence: 3 };
		const completeChild = fakeChild();
		const completed = completeWorkViaCli(cliPath, cwd, transition, 'Completed assignment.', servicesFor(completeChild));
		finishJson(completeChild, {
			...workingWork,
			status: 'completed',
			updatedAt: '2026-07-20T14:02:00.000Z',
			latestUpdate: { at: '2026-07-20T14:02:00.000Z', kind: 'completed', message: 'Completed assignment.' },
			updates: [...workingWork.updates, { at: '2026-07-20T14:02:00.000Z', kind: 'completed', message: 'Completed assignment.' }],
		});
		assert.equal((await completed).status, 'completed');
		assert.deepEqual(JSON.parse(completeChild.stdinData()), {
			workspace: { cwd },
			agent: { id: agentId },
			work: { id: workId, agentSessionId: sessionId, assignmentSequence: 3 },
			finalUpdate: 'Completed assignment.',
		});

		const requeueChild = fakeChild();
		const requeued = requeueWorkViaCli(cliPath, cwd, transition, 'Provider failed.', servicesFor(requeueChild));
		finishJson(requeueChild, {
			...waitingWork,
			ready: true,
			updatedAt: '2026-07-20T14:02:00.000Z',
			latestUpdate: { at: '2026-07-20T14:02:00.000Z', kind: 'requeued', message: 'Provider failed.' },
			updates: [...workingWork.updates, { at: '2026-07-20T14:02:00.000Z', kind: 'requeued', message: 'Provider failed.' }],
		});
		assert.equal((await requeued).status, 'waiting');
		assert.deepEqual(JSON.parse(requeueChild.stdinData()), {
			workspace: { cwd },
			agent: { id: agentId },
			work: { id: workId, agentSessionId: sessionId, assignmentSequence: 3 },
			reason: 'Provider failed.',
		});
	});

	test('validates control-plane results and keeps provider-native identity out of requests', async () => {
		const renamed = await awaitJson(child => renameAgentViaCli(cliPath, cwd, agentId, 'Robert', servicesFor(child)), {
			...bob, name: 'Robert',
		});
		assert.deepEqual(renamed.result, { ...bob, name: 'Robert' });
		assert.deepEqual(renamed.request, { workspace: { cwd }, agent: { id: agentId }, name: 'Robert' });

		const transcript = await awaitJson(child => transcriptViaCli(cliPath, cwd, agentId, servicesFor(child)), {
			agentId,
			sessionId,
			state: 'available',
			entries: [{ role: 'assistant', text: 'Done.' }],
		});
		assert.equal(transcript.result.state, 'available');
		assert.deepEqual(transcript.request, { workspace: { cwd }, agent: { id: agentId } });

		const opened = await awaitJson(child => openAgentViaCli(cliPath, cwd, agentId, servicesFor(child)), {
			state: 'available', kind: 'terminal', command: 'codex', args: ['resume', 'provider-thread-secret'],
		});
		assert.deepEqual(opened.result, { kind: 'terminal', command: 'codex', args: ['resume', 'provider-thread-secret'] });
		assert.deepEqual(opened.request, { workspace: { cwd }, agent: { id: agentId } });

		const interrupted = await awaitJson(child => interruptAgentViaCli(cliPath, cwd, agentId, servicesFor(child)), {
			interrupted: false, agent: bob,
		});
		assert.equal(interrupted.result, undefined);
		assert.deepEqual(interrupted.request, { workspace: { cwd }, agent: { id: agentId } });

		const reset = await awaitJson(child => resetAgentViaCli(cliPath, cwd, agentId, servicesFor(child)), bob);
		assert.deepEqual(reset.result, bob);
		assert.deepEqual(reset.request, { workspace: { cwd }, agent: { id: agentId } });
	});

	test('rejects malformed collection wrappers instead of trusting display-shaped JSON', async () => {
		const agentsChild = fakeChild();
		const agents = listAgentsViaCli(cliPath, cwd, servicesFor(agentsChild));
		finishJson(agentsChild, { agents: [{ ...bob, providerSessionId: 'thread-secret' }] });
		await assert.rejects(agents, /malformed agent list/);

		const workChild = fakeChild();
		const work = listWorkViaCli(cliPath, cwd, servicesFor(workChild));
		finishJson(workChild, { work: [{ ...waitingWork, status: 'blocked' }] });
		await assert.rejects(work, /malformed work list/);
	});
});

interface ProcessInvocation {
	readonly command: string;
	readonly args: readonly string[];
	readonly cwd: string;
}

function servicesFor(child: FakeChild, inspect?: (invocation: ProcessInvocation) => void): CliProcessServices {
	return {
		nodeExecutable: '/node',
		spawn: (command, args, options) => {
			inspect?.({ command, args, cwd: options.cwd });
			return child.process;
		},
	};
}

async function awaitJson<T>(
	start: (child: FakeChild) => Promise<T>,
	response: unknown,
): Promise<{ readonly result: T; readonly request: unknown }> {
	const child = fakeChild();
	const promise = start(child);
	finishJson(child, response);
	return { result: await promise, request: JSON.parse(child.stdinData()) };
}

function finishJson(child: FakeChild, value: unknown): void {
	child.stdout.write(`${JSON.stringify(value)}\n`);
	child.emitter.emit('exit', 0);
}

interface FakeChild {
	readonly process: ChildProcessWithoutNullStreams;
	readonly emitter: EventEmitter;
	readonly stdout: PassThrough;
	readonly stdinData: () => string;
	readonly killedWith: () => string | undefined;
}

function fakeChild(): FakeChild {
	const emitter = new EventEmitter();
	const stdin = new PassThrough();
	const stdout = new PassThrough();
	const stderr = new PassThrough();
	let input = '';
	let signal: string | undefined;
	stdin.on('data', chunk => { input += String(chunk); });
	const process = Object.assign(emitter, {
		stdin,
		stdout,
		stderr,
		killed: false,
		kill: (killedWith?: NodeJS.Signals | number) => { signal = String(killedWith); return true; },
	}) as unknown as ChildProcessWithoutNullStreams;
	return { process, emitter, stdout, stdinData: () => input, killedWith: () => signal };
}
