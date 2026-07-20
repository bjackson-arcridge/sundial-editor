import * as assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
	isAgentDetail,
	isAgentsViewState,
	isAgentTranscript,
	isAgentTranscriptViewState,
	isAgentWorkViewState,
	isNamedAgent,
	isUserAnnotationWorkItem,
	isWorkStatus,
	parseAgentTranscript,
	parseAgentId,
	parseAgentSessionId,
	parseNamedAgent,
	parseUserAnnotationId,
	parseUserAnnotationWorkItem,
	projectAgentTranscript,
	type NamedAgent,
	type UserAnnotationWorkItem,
} from '../agentProtocol';

const agentId = parseAgentId('agent-bob');
const sessionId = parseAgentSessionId('session-bob-1');
const workId = parseUserAnnotationId('annotation-1');
const enqueuedAt = '2026-07-20T14:00:00.000Z';
const workingAt = '2026-07-20T14:01:00.000Z';

const waitingUpdate = {
	at: enqueuedAt,
	kind: 'enqueued',
	message: 'Waiting for Bob.',
} as const;

const workingUpdate = {
	at: workingAt,
	kind: 'claimed',
	message: 'Bob started work.',
} as const;

const work: UserAnnotationWorkItem = {
	id: workId,
	agentId,
	status: 'working',
	ready: true,
	enqueuedAt,
	updatedAt: workingAt,
	latestUpdate: workingUpdate,
	assignment: { sessionId, sequence: 1, claimedAt: workingAt },
	source: {
		uri: 'file:///workspace/src/example.ts',
		line: 8,
		text: 'const value = 1;',
		before: ['function calculate() {'],
		after: ['return value;', '}'],
	},
	prompt: { preset: '%W', scope: 'project', text: 'Update this behavior.' },
	updates: [waitingUpdate, workingUpdate],
};

const bob: NamedAgent = {
	id: agentId,
	slot: 4,
	name: 'Bob',
	session: { state: 'available', id: sessionId, provider: 'codex' },
	queue: { waiting: 2, working: 1, completed: 3 },
	currentWork: work,
	controls: {
		canRename: true,
		canEnsureSession: false,
		canOpen: true,
		canInterrupt: true,
		canReset: true,
	},
};

describe('agent identities and workflow status', () => {
	test('brands non-empty opaque identities without changing their value', () => {
		assert.equal(parseUserAnnotationId('annotation-1'), 'annotation-1');
		assert.equal(parseAgentId('agent-1'), 'agent-1');
		assert.equal(parseAgentSessionId('session-1'), 'session-1');
		assert.throws(() => parseAgentId('   '), /non-empty/);
		assert.throws(() => parseAgentSessionId('session\n2'), /non-empty/);
	});

	test('defines exactly the persistent work lifecycle', () => {
		for (const status of ['waiting', 'working', 'completed']) {
			assert.equal(isWorkStatus(status), true, status);
		}
		for (const status of ['blocked', 'failed', 'cancelled', '']) {
			assert.equal(isWorkStatus(status), false, status);
		}
	});
});

describe('named agent projections', () => {
	test('validates a stable slot, session availability, queue counts, work, and controls', () => {
		assert.equal(isNamedAgent(bob), true);
		assert.equal(parseNamedAgent(bob), bob);
		assert.equal(isNamedAgent({
			...bob,
			session: { state: 'missing', id: sessionId },
			queue: { waiting: 3, working: 0, completed: 3 },
			currentWork: undefined,
			controls: { ...bob.controls, canEnsureSession: true, canOpen: false, canInterrupt: false },
		}), true);
		assert.equal(isNamedAgent({
			...bob,
			session: { state: 'uninitialized', id: sessionId, provider: 'codex' },
			queue: { waiting: 0, working: 0, completed: 0 },
			currentWork: undefined,
		}), true);
	});

	test('rejects unstable slots, malformed names, multiple active work items, and cross-agent current work', () => {
		assert.equal(isNamedAgent({ ...bob, slot: 0 }), false);
		assert.equal(isNamedAgent({ ...bob, name: '  Bob' }), false);
		assert.equal(isNamedAgent({ ...bob, name: '123' }), false);
		assert.equal(isNamedAgent({ ...bob, queue: { ...bob.queue, working: 2 } }), false);
		assert.equal(isNamedAgent({
			...bob,
			session: { ...bob.session, providerSessionId: 'thread-secret' },
		}), false);
		assert.equal(isNamedAgent({
			...bob,
			currentWork: { ...work, agentId: parseAgentId('agent-amy') },
		}), false);
		assert.throws(() => parseNamedAgent({ ...bob, session: { state: 'available', id: sessionId } }), /malformed/);
	});

	test('validates detail work in deterministic FIFO order', () => {
		const later = {
			...work,
			id: parseUserAnnotationId('annotation-2'),
			status: 'waiting',
			enqueuedAt: '2026-07-20T15:00:00.000Z',
			updatedAt: '2026-07-20T15:00:00.000Z',
			assignment: undefined,
		};
		assert.equal(isAgentDetail({ ...bob, work: [work, later] }), true);
		assert.equal(isAgentDetail({ ...bob, work: [later, work] }), false);
	});
});

describe('user annotation work projections', () => {
	test('validates source/prompt context, assignment, and ordered update history', () => {
		assert.equal(isUserAnnotationWorkItem(work), true);
		assert.equal(parseUserAnnotationWorkItem(work), work);
	});

	test('rejects out-of-order or inconsistent update histories and invalid work state', () => {
		assert.equal(isUserAnnotationWorkItem({ ...work, updates: [workingUpdate, waitingUpdate] }), false);
		assert.equal(isUserAnnotationWorkItem({ ...work, latestUpdate: waitingUpdate }), false);
		assert.equal(isUserAnnotationWorkItem({ ...work, status: 'blocked' }), false);
		assert.equal(isUserAnnotationWorkItem({
			...work,
			assignment: { ...work.assignment, sequence: 0 },
		}), false);
		assert.equal(isUserAnnotationWorkItem({
			...work,
			source: { ...work.source, before: ['1', '2', '3', '4'] },
		}), false);
		assert.throws(() => parseUserAnnotationWorkItem({ ...work, prompt: { ...work.prompt, preset: '%X' } }), /malformed/);
	});
});

describe('transcript projections', () => {
	test('distinguishes uninitialized, missing, empty, and populated current sessions', () => {
		const uninitialized = { agentId, sessionId, state: 'uninitialized', entries: [] } as const;
		const missing = { agentId, sessionId, state: 'missing', entries: [] } as const;
		const available = {
			agentId,
			sessionId,
			state: 'available',
			entries: [
				{ role: 'user', text: 'Please update this.', timestamp: enqueuedAt },
				{ role: 'assistant', text: 'Done.' },
			],
		} as const;

		assert.equal(isAgentTranscript(uninitialized), true);
		assert.equal(isAgentTranscript(missing), true);
		assert.equal(isAgentTranscript(available), true);
		assert.equal(parseAgentTranscript(available), available);
		assert.deepEqual(projectAgentTranscript(missing), { kind: 'missing', agentId, sessionId });
		assert.deepEqual(projectAgentTranscript({ ...available, entries: [] }), { kind: 'empty', agentId, sessionId });
		assert.equal(isAgentTranscriptViewState({ kind: 'empty', agentId, sessionId }), true);
		assert.equal(isAgentTranscriptViewState({
			kind: 'ready', agentId, sessionId, entries: available.entries,
		}), true);
	});

	test('rejects provider-native identities, invalid roles, and entries on a missing session', () => {
		assert.equal(isAgentTranscript({
			agentId, sessionId, state: 'available', providerSessionId: 'thread-secret', entries: [],
		}), false);
		assert.equal(isAgentTranscript({
			agentId, sessionId, state: 'available', entries: [{ role: 'agent', text: 'Nope.' }],
		}), false);
		assert.equal(isAgentTranscript({
			agentId, sessionId, state: 'missing', entries: [{ role: 'system', text: 'Unavailable.' }],
		}), false);
		assert.equal(isAgentTranscriptViewState({
			kind: 'ready', agentId, sessionId, entries: [],
		}), false);
	});
});

describe('loading, empty, ready, and error view states', () => {
	test('validates agent collection states and case-insensitive identity uniqueness', () => {
		assert.equal(isAgentsViewState({ kind: 'loading' }), true);
		assert.equal(isAgentsViewState({ kind: 'empty' }), true);
		assert.equal(isAgentsViewState({ kind: 'error', message: 'Cannot load agents.', recoverable: true }), true);
		assert.equal(isAgentsViewState({ kind: 'ready', agents: [bob] }), true);
		assert.equal(isAgentsViewState({ kind: 'ready', agents: [] }), false);
		assert.equal(isAgentsViewState({
			kind: 'ready',
			agents: [bob, { ...bob, id: parseAgentId('agent-other'), slot: 5, name: 'bOB' }],
		}), false);
	});

	test('validates per-agent queue states without deriving slots from ordering', () => {
		assert.equal(isAgentWorkViewState({ kind: 'loading', agentId }), true);
		assert.equal(isAgentWorkViewState({
			kind: 'error', agentId, message: 'Cannot load work.', recoverable: false,
		}), true);
		assert.equal(isAgentWorkViewState({ kind: 'ready', agent: bob, work: [work] }), true);
		assert.equal(isAgentWorkViewState({
			kind: 'empty',
			agent: { ...bob, queue: { waiting: 0, working: 0, completed: 0 }, currentWork: undefined },
		}), true);
		assert.equal(isAgentWorkViewState({ kind: 'empty', agent: bob }), false);
	});
});
