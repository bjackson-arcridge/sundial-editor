import * as assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
	parseAgentId,
	parseAgentSessionId,
	parseUserAnnotationId,
	type NamedAgent,
	type UserAnnotationWorkItem,
} from '../agentProtocol';
import {
	annotationForLine,
	currentWorkForAgent,
	isValidHostToWebviewMessage,
	isValidWebviewToHostMessage,
	waitingAgentForAnnotation,
} from '../webviews/messages/messages';

const bobId = parseAgentId('agent-bob');
const amyId = parseAgentId('agent-amy');
const bobSessionId = parseAgentSessionId('session-bob-1');
const workId = parseUserAnnotationId('annotation-work-1');
const enqueuedAt = '2026-07-20T14:00:00.000Z';

const prompt = {
	preset: '%W',
	scope: 'project',
	targetSelector: { kind: 'name', name: 'Bob' },
	sourceUri: 'file:///workspace/src/example.ts',
	sourceLine: 3,
	sourceText: '%W>Bob @G',
	anchorText: 'const value = 1;',
	anchorBefore: ['function calculate() {'],
	anchorAfter: ['return value;', '}'],
} as const;

const draft = 'Please update the project.';
const enqueuedUpdate = {
	at: enqueuedAt,
	kind: 'enqueued',
	message: 'Waiting for Bob.',
} as const;

const work: UserAnnotationWorkItem = {
	id: workId,
	agentId: bobId,
	status: 'waiting',
	ready: true,
	enqueuedAt,
	updatedAt: enqueuedAt,
	latestUpdate: enqueuedUpdate,
	source: {
		uri: prompt.sourceUri,
		line: prompt.sourceLine,
		text: prompt.anchorText,
		before: prompt.anchorBefore,
		after: prompt.anchorAfter,
	},
	prompt: { preset: prompt.preset, scope: prompt.scope, text: draft },
	updates: [enqueuedUpdate],
};

const bob: NamedAgent = {
	id: bobId,
	slot: 1,
	name: 'Bob',
	session: { state: 'available', id: bobSessionId, provider: 'codex' },
	queue: { waiting: 1, working: 0, completed: 0 },
	controls: {
		canRename: true,
		canEnsureSession: false,
		canOpen: true,
		canInterrupt: false,
		canReset: true,
	},
};

const amy: NamedAgent = {
	id: amyId,
	slot: 2,
	name: 'Amy',
	session: { state: 'missing' },
	queue: { waiting: 0, working: 0, completed: 0 },
	controls: {
		canRename: true,
		canEnsureSession: true,
		canOpen: false,
		canInterrupt: false,
		canReset: true,
	},
};

const readyAgents = { kind: 'ready', agents: [bob, amy] } as const;
const annotations = [{
	id: 'annotation-1', message: 'Fix this.', preset: '%F', scope: 'line',
	anchor: { line: 3, text: 'const value = 1;', before: ['function calculate() {'], after: ['return value;', '}'] },
}, {
	id: 'annotation-2', message: 'Add coverage.', preset: '%T', scope: 'project',
	anchor: { line: 3, text: 'const value = 1;', before: ['function calculate() {'], after: ['return value;', '}'] },
}] as const;

const annotationViewer = {
	sourceUri: prompt.sourceUri,
	annotation: annotations[0],
	position: 1,
	total: 2,
	pinned: false,
	canPrevious: false,
	canNext: true,
} as const;

function readyState(transcript?: unknown) {
	return {
		agents: readyAgents,
		work: [work],
		prompt,
		draft,
		targetAgentId: bobId,
		busy: false,
		notice: { tone: 'info', message: 'Agent state refreshed.' },
		...(transcript === undefined ? {} : { transcript }),
		annotationViewer,
	};
}

describe('messages protocol guards', () => {
	test('accepts loading, empty, error, and complete ready host states', () => {
		assert.equal(isValidHostToWebviewMessage({
			kind: 'state', state: { agents: { kind: 'loading' }, work: [] },
		}), true);
		assert.equal(isValidHostToWebviewMessage({
			kind: 'state', state: { agents: { kind: 'empty' }, work: [], prompt, draft },
		}), true);
		assert.equal(isValidHostToWebviewMessage({
			kind: 'state',
			state: { agents: { kind: 'error', message: 'CLI unavailable.', recoverable: true }, work: [] },
		}), true);
		assert.equal(isValidHostToWebviewMessage({ kind: 'state', state: readyState() }), true);
		assert.equal(isValidHostToWebviewMessage({ kind: 'focusComposer' }), true);
	});

	test('accepts every transcript disclosure state', () => {
		const transcriptStates = [
			{ kind: 'loading', agentId: bobId },
			{ kind: 'missing', agentId: amyId },
			{ kind: 'uninitialized', agentId: bobId, sessionId: bobSessionId },
			{ kind: 'empty', agentId: bobId, sessionId: bobSessionId },
			{
				kind: 'ready', agentId: bobId, sessionId: bobSessionId,
				entries: [{ role: 'assistant', text: 'Implemented the change.', timestamp: enqueuedAt }],
			},
			{ kind: 'error', agentId: bobId, message: 'Transcript unavailable.', recoverable: true },
		] as const;

		for (const transcript of transcriptStates) {
			assert.equal(isValidHostToWebviewMessage({ kind: 'state', state: readyState(transcript) }), true, transcript.kind);
		}
	});

	test('rejects malformed or internally inconsistent host states', () => {
		assert.equal(isValidHostToWebviewMessage({ kind: 'state', state: {} }), false);
		assert.equal(isValidHostToWebviewMessage({ kind: 'state', state: { agents: { kind: 'loading' }, work: [], extra: true } }), false);
		assert.equal(isValidHostToWebviewMessage({
			kind: 'state', state: { agents: readyAgents, work: [work], prompt, draft },
		}), false);
		assert.equal(isValidHostToWebviewMessage({
			kind: 'state', state: { ...readyState(), targetAgentId: parseAgentId('agent-unknown') },
		}), false);
		assert.equal(isValidHostToWebviewMessage({
			kind: 'state', state: { ...readyState(), work: [work, work] },
		}), false);
		assert.equal(isValidHostToWebviewMessage({
			kind: 'state', state: { ...readyState(), work: [{ ...work, agentId: parseAgentId('agent-unknown') }] },
		}), false);
		assert.equal(isValidHostToWebviewMessage({
			kind: 'state', state: { ...readyState(), prompt: { ...prompt, targetSelector: { kind: 'slot', slot: 0 } } },
		}), false);
		assert.equal(isValidHostToWebviewMessage({
			kind: 'state', state: { ...readyState(), draft: 12 },
		}), false);
		assert.equal(isValidHostToWebviewMessage({
			kind: 'state', state: readyState({ agentId: bobId, state: 'available', sessionId: bobSessionId, entries: [] }),
		}), false);
		assert.equal(isValidHostToWebviewMessage({
			kind: 'state', state: { ...readyState(), annotationViewer: { ...annotationViewer, position: 3 } },
		}), false);
		assert.equal(isValidHostToWebviewMessage({ kind: 'focusComposer', extra: true }), false);
		assert.equal(isValidHostToWebviewMessage({ kind: 'other' }), false);
		assert.equal(isValidHostToWebviewMessage(null), false);
	});

	test('accepts every exact webview command shape', () => {
		const commands = [
			{ kind: 'submit', message: 'Please fix this.', targetAgentId: bobId },
			{ kind: 'selectTarget', targetAgentId: amyId },
			{ kind: 'cancel' },
			{ kind: 'refresh' },
			{ kind: 'renameAgent', agentId: bobId, name: 'Robert' },
			{ kind: 'showTranscript', agentId: bobId },
			{ kind: 'openAgent', agentId: bobId },
			{ kind: 'interruptAgent', agentId: bobId },
			{ kind: 'resetAgent', agentId: bobId },
			{ kind: 'previousAnnotation' },
			{ kind: 'nextAnnotation' },
			{ kind: 'toggleAnnotationPin' },
			{ kind: 'deleteAnnotation' },
		] as const;

		for (const command of commands) {
			assert.equal(isValidWebviewToHostMessage(command), true, command.kind);
		}
	});

	test('rejects missing, obsolete, extra, and invalid webview command fields', () => {
		assert.equal(isValidWebviewToHostMessage({ kind: 'submit', message: '', targetAgentId: bobId }), false);
		assert.equal(isValidWebviewToHostMessage({ kind: 'submit', message: draft, agentId: bobId }), false);
		assert.equal(isValidWebviewToHostMessage({ kind: 'selectTarget', targetAgentId: '' }), false);
		assert.equal(isValidWebviewToHostMessage({ kind: 'renameAgent', agentId: bobId, name: '123' }), false);
		assert.equal(isValidWebviewToHostMessage({ kind: 'renameAgent', agentId: bobId, name: ' Bob ' }), false);
		assert.equal(isValidWebviewToHostMessage({ kind: 'refresh', extra: true }), false);
		assert.equal(isValidWebviewToHostMessage({ kind: 'refreshAgents' }), false);
		assert.equal(isValidWebviewToHostMessage({ kind: 'cancel', message: 'unexpected' }), false);
		assert.equal(isValidWebviewToHostMessage({ kind: 'send', message: draft }), false);
	});
});

describe('messages view projections', () => {
	test('shows only the agent current work item', () => {
		const claimedAt = '2026-07-20T14:01:00.000Z';
		const claimedUpdate = { at: claimedAt, kind: 'claimed', message: 'Bob started work.' } as const;
		const current: UserAnnotationWorkItem = {
			...work,
			id: parseUserAnnotationId('annotation-work-current'),
			status: 'working',
			updatedAt: claimedAt,
			latestUpdate: claimedUpdate,
			assignment: { sessionId: bobSessionId, sequence: 1, claimedAt },
			updates: [enqueuedUpdate, claimedUpdate],
		};
		const amyWork = {
			...work,
			id: parseUserAnnotationId('annotation-work-amy'),
			agentId: amyId,
		};
		const workingBob: NamedAgent = {
			...bob,
			queue: { waiting: 1, working: 1, completed: 0 },
			currentWork: current,
		};

		assert.equal(currentWorkForAgent([work, amyWork, current], workingBob)?.id, current.id);
		assert.equal(currentWorkForAgent([work, amyWork, current], bob), undefined);
	});

	test('projects a waiting work item onto its annotation target', () => {
		assert.equal(waitingAgentForAnnotation([work], [bob, amy], work.id)?.name, 'Bob');
		assert.equal(waitingAgentForAnnotation([{ ...work, status: 'completed' }], [bob, amy], work.id), undefined);
		assert.equal(waitingAgentForAnnotation([work], [bob, amy], 'annotation-other'), undefined);
	});

	test('selects an annotation for a line and retains a preferred annotation on that line', () => {
		assert.equal(annotationForLine(annotations, 3)?.id, 'annotation-1');
		assert.equal(annotationForLine(annotations, 3, 'annotation-2')?.id, 'annotation-2');
		assert.equal(annotationForLine(annotations, 4), undefined);
	});
});
