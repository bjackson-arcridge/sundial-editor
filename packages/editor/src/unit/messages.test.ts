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
	displayedWorkForAgent,
	isValidHostToWebviewMessage,
	isValidWebviewToHostMessage,
	latestSessionStatusForAgent,
	latestStatusForWork,
	presentAnnotation,
	sessionStatusHistoryGroupsForAgent,
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
const paneSplitPercent = 50;
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
	kind: 'user',
	id: 'annotation-1', message: 'Fix this.', preset: '%F', scope: 'line',
	anchor: { line: 3, text: 'const value = 1;', before: ['function calculate() {'], after: ['return value;', '}'] },
	officialResponses: [],
	agentAnnotations: [],
}, {
	kind: 'user',
	id: 'annotation-2', message: 'Add coverage.', preset: '%T', scope: 'project',
	anchor: { line: 3, text: 'const value = 1;', before: ['function calculate() {'], after: ['return value;', '}'] },
	officialResponses: [],
	agentAnnotations: [],
}] as const;

const annotationViewer = {
	sourceUri: prompt.sourceUri,
	annotation: {
		...annotations[0],
		officialResponses: [{ body: '**Fixed.**', createdAt: '2026-07-20T14:05:00.000Z', agentName: 'Bob' }],
	},
	position: 1,
	total: 2,
	pinned: false,
	canPrevious: false,
	canNext: true,
} as const;

function readyState() {
	return {
		agents: readyAgents,
		work: [work],
		paneSplitPercent,
		prompt,
		draft,
		targetAgentId: bobId,
		busy: false,
		notice: { tone: 'info', message: 'Agent state refreshed.' },
		annotationViewer,
	};
}

describe('messages protocol guards', () => {
	test('accepts loading, empty, error, and complete ready host states', () => {
		assert.equal(isValidHostToWebviewMessage({
			kind: 'state', state: { agents: { kind: 'loading' }, work: [], paneSplitPercent },
		}), true);
		assert.equal(isValidHostToWebviewMessage({
			kind: 'state', state: { agents: { kind: 'empty' }, work: [], paneSplitPercent, prompt, draft },
		}), true);
		assert.equal(isValidHostToWebviewMessage({
			kind: 'state',
			state: { agents: { kind: 'error', message: 'CLI unavailable.', recoverable: true }, work: [], paneSplitPercent },
		}), true);
		assert.equal(isValidHostToWebviewMessage({ kind: 'state', state: readyState() }), true);
		assert.equal(isValidHostToWebviewMessage({
			kind: 'state', state: { ...readyState(), targetAgentId: amyId },
		}), true, 'an agent without an active session remains a valid preselected target');
		assert.equal(isValidHostToWebviewMessage({ kind: 'focusComposer' }), true);
	});

	test('rejects malformed or internally inconsistent host states', () => {
		assert.equal(isValidHostToWebviewMessage({ kind: 'state', state: {} }), false);
		assert.equal(isValidHostToWebviewMessage({
			kind: 'state', state: { agents: { kind: 'loading' }, work: [], paneSplitPercent, extra: true },
		}), false);
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
			kind: 'state', state: { ...readyState(), paneSplitPercent: 9 },
		}), false);
		assert.equal(isValidHostToWebviewMessage({
			kind: 'state', state: { ...readyState(), paneSplitPercent: Number.NaN },
		}), false);
		assert.equal(isValidHostToWebviewMessage({
			kind: 'state', state: { ...readyState(), transcript: { kind: 'empty', agentId: bobId, sessionId: bobSessionId } },
		}), false);
		assert.equal(isValidHostToWebviewMessage({
			kind: 'state', state: { ...readyState(), annotationViewer: { ...annotationViewer, position: 3 } },
		}), false);
		assert.equal(isValidHostToWebviewMessage({ kind: 'focusComposer', extra: true }), false);
		assert.equal(isValidHostToWebviewMessage({
			kind: 'state',
			state: {
				...readyState(),
				annotationViewer: {
					...annotationViewer,
					annotation: {
						...annotationViewer.annotation,
						officialResponses: [{
							...annotationViewer.annotation.officialResponses[0], agentSessionId: 'session-secret',
						}],
					},
				},
			},
		}), false);
		assert.equal(isValidHostToWebviewMessage({ kind: 'other' }), false);
		assert.equal(isValidHostToWebviewMessage(null), false);
	});

	test('accepts every exact webview command shape', () => {
		const commands = [
			{ kind: 'ready' },
			{ kind: 'submit', message: 'Please fix this.', targetAgentId: bobId },
			{ kind: 'selectTarget', targetAgentId: amyId },
			{ kind: 'cancel' },
			{ kind: 'refresh' },
			{ kind: 'renameAgent', agentId: bobId, name: 'Robert' },
			{ kind: 'openAgent', agentId: bobId },
			{ kind: 'interruptAgent', agentId: bobId },
			{ kind: 'resetAgent', agentId: bobId },
			{ kind: 'revealAnnotation', annotationId: workId },
			{ kind: 'openAnnotation', link: { annotationId: 'agent-note-1', file: 'src/other.ts', line: 4 } },
			{ kind: 'previousAnnotation' },
			{ kind: 'nextAnnotation' },
			{ kind: 'toggleAnnotationPin' },
			{ kind: 'deleteAnnotation' },
			{ kind: 'setPaneSplitPercent', percent: 62 },
		] as const;

		for (const command of commands) {
			assert.equal(isValidWebviewToHostMessage(command), true, command.kind);
		}
	});

	test('rejects missing, obsolete, extra, and invalid webview command fields', () => {
		assert.equal(isValidWebviewToHostMessage({ kind: 'ready', extra: true }), false);
		assert.equal(isValidWebviewToHostMessage({ kind: 'submit', message: '', targetAgentId: bobId }), false);
		assert.equal(isValidWebviewToHostMessage({ kind: 'submit', message: draft, agentId: bobId }), false);
		assert.equal(isValidWebviewToHostMessage({ kind: 'selectTarget', targetAgentId: '' }), false);
		assert.equal(isValidWebviewToHostMessage({ kind: 'renameAgent', agentId: bobId, name: '123' }), false);
		assert.equal(isValidWebviewToHostMessage({ kind: 'renameAgent', agentId: bobId, name: ' Bob ' }), false);
		assert.equal(isValidWebviewToHostMessage({ kind: 'revealAnnotation', annotationId: '' }), false);
		assert.equal(isValidWebviewToHostMessage({ kind: 'revealAnnotation', agentId: bobId }), false);
		assert.equal(isValidWebviewToHostMessage({ kind: 'revealAnnotation', annotationId: workId, extra: true }), false);
		assert.equal(isValidWebviewToHostMessage({ kind: 'openAnnotation', link: { annotationId: '', file: 'src/a.ts', line: 0 } }), false);
		assert.equal(isValidWebviewToHostMessage({ kind: 'refresh', extra: true }), false);
		assert.equal(isValidWebviewToHostMessage({ kind: 'refreshAgents' }), false);
		assert.equal(isValidWebviewToHostMessage({ kind: 'showTranscript', agentId: bobId }), false);
		assert.equal(isValidWebviewToHostMessage({ kind: 'cancel', message: 'unexpected' }), false);
		assert.equal(isValidWebviewToHostMessage({ kind: 'send', message: draft }), false);
		assert.equal(isValidWebviewToHostMessage({ kind: 'setPaneSplitPercent', percent: 9 }), false);
		assert.equal(isValidWebviewToHostMessage({ kind: 'setPaneSplitPercent', percent: 91 }), false);
		assert.equal(isValidWebviewToHostMessage({ kind: 'setPaneSplitPercent', percent: Number.NaN }), false);
		assert.equal(isValidWebviewToHostMessage({ kind: 'setPaneSplitPercent', percent: 50, extra: true }), false);
	});

	test('presents agent annotations without exposing the provider session identity', () => {
		const presented = presentAnnotation({
			kind: 'agent', id: 'agent-note-1', agentId: bobId, agentSessionId: bobSessionId,
			body: '**Important.**', createdAt: '2026-07-20T14:05:00.000Z',
			anchor: { line: 4, text: 'return value;', before: [], after: [] },
			userAnnotation: { annotationId: 'annotation-1', file: 'src/example.ts', line: 3 },
		}, [{ ...bob, name: 'Robert' }, amy]);
		assert.equal(presented.kind, 'agent');
		if (presented.kind !== 'agent') { assert.fail('expected agent annotation'); }
		assert.equal(presented.agentName, 'Robert');
		assert.equal(JSON.stringify(presented).includes('session-bob-1'), false);
	});
});

describe('messages view projections', () => {
	test('maps response authors to current names without projecting identity metadata', () => {
		const presented = presentAnnotation({
			...annotations[0],
			officialResponses: [{
				userAnnotationId: annotations[0].id,
				agentId: bobId,
				agentSessionId: bobSessionId,
				body: '**Fixed.**',
				createdAt: '2026-07-20T14:05:00.000Z',
			}],
		}, [{ ...bob, name: 'Robert' }, amy]);

		assert.equal(presented.kind, 'user');
		if (presented.kind !== 'user') { assert.fail('expected user annotation'); }
		assert.deepEqual(presented.officialResponses, [{
			body: '**Fixed.**',
			createdAt: '2026-07-20T14:05:00.000Z',
			agentName: 'Robert',
		}]);
		assert.equal(JSON.stringify(presented).includes('agent-bob'), false);
		assert.equal(JSON.stringify(presented).includes('session-bob-1'), false);
	});

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

	test('shows active work or the agent latest completed work as the annotation target', () => {
		const earlierCompleted: UserAnnotationWorkItem = {
			...work,
			id: parseUserAnnotationId('annotation-work-earlier'),
			status: 'completed',
			updatedAt: '2026-07-20T14:03:00.000Z',
		};
		const latestCompleted: UserAnnotationWorkItem = {
			...earlierCompleted,
			id: parseUserAnnotationId('annotation-work-latest'),
			updatedAt: '2026-07-20T14:05:00.000Z',
		};
		const active: UserAnnotationWorkItem = {
			...work,
			id: parseUserAnnotationId('annotation-work-active'),
			status: 'working',
		};
		const workingBob: NamedAgent = { ...bob, currentWork: active };

		assert.equal(displayedWorkForAgent([latestCompleted, earlierCompleted], bob)?.id, latestCompleted.id);
		assert.equal(displayedWorkForAgent([latestCompleted, active], workingBob)?.id, active.id);
		assert.equal(displayedWorkForAgent([work, { ...latestCompleted, agentId: amyId }], bob), undefined);
	});

	test('uses only agent-authored status updates for compact active-work feedback', () => {
		const firstStatus = { at: '2026-07-20T14:02:00.000Z', kind: 'status', message: 'Reviewing the request.' } as const;
		const latestStatus = { at: '2026-07-20T14:03:00.000Z', kind: 'status', message: 'Updating the card.' } as const;
		const claimed = { at: '2026-07-20T14:01:00.000Z', kind: 'claimed', message: 'Bob started work.' } as const;

		assert.equal(latestStatusForWork({ ...work, updates: [enqueuedUpdate, claimed] }), undefined);
		assert.equal(
			latestStatusForWork({ ...work, updates: [enqueuedUpdate, claimed, firstStatus, latestStatus] }),
			latestStatus,
		);
	});

	test('groups ordered current-session status history by annotation and user message', () => {
		const claimedAt = '2026-07-20T14:01:00.000Z';
		const statusAt = '2026-07-20T14:02:00.000Z';
		const latestStatusAt = '2026-07-20T14:02:30.000Z';
		const completedAt = '2026-07-20T14:03:00.000Z';
		const secondClaimedAt = '2026-07-20T14:04:00.000Z';
		const secondStatusAt = '2026-07-20T14:05:00.000Z';
		const secondCompletedAt = '2026-07-20T14:06:00.000Z';
		const claimedUpdate = { at: claimedAt, kind: 'claimed', message: 'Bob started work.' } as const;
		const statusUpdate = { at: statusAt, kind: 'status', message: 'Reviewing the final diff.' } as const;
		const latestStatusUpdate = { at: latestStatusAt, kind: 'status', message: 'Running the focused tests.' } as const;
		const completedUpdate = { at: completedAt, kind: 'completed', message: 'Completed assignment.' } as const;
		const completed: UserAnnotationWorkItem = {
			...work,
			status: 'completed',
			updatedAt: completedAt,
			latestUpdate: completedUpdate,
			assignment: { sessionId: bobSessionId, sequence: 1, claimedAt },
			updates: [enqueuedUpdate, claimedUpdate, statusUpdate, latestStatusUpdate, completedUpdate],
		};
		const secondStatusUpdate = { at: secondStatusAt, kind: 'status', message: 'Checking the second annotation.' } as const;
		const secondCompletedUpdate = { at: secondCompletedAt, kind: 'completed', message: 'Completed second assignment.' } as const;
		const secondCompleted: UserAnnotationWorkItem = {
			...completed,
			id: parseUserAnnotationId('annotation-work-second'),
			prompt: { ...completed.prompt, text: 'Please update the second annotation.' },
			updatedAt: secondCompletedAt,
			latestUpdate: secondCompletedUpdate,
			assignment: { sessionId: bobSessionId, sequence: 1, claimedAt: secondClaimedAt },
			updates: [
				enqueuedUpdate,
				{ ...claimedUpdate, at: secondClaimedAt },
				secondStatusUpdate,
				secondCompletedUpdate,
			],
		};
		const oldSessionWork: UserAnnotationWorkItem = {
			...completed,
			id: parseUserAnnotationId('annotation-work-old-session'),
			updatedAt: '2026-07-20T14:08:00.000Z',
			latestUpdate: { ...completedUpdate, at: '2026-07-20T14:08:00.000Z' },
			assignment: { sessionId: parseAgentSessionId('session-bob-old'), sequence: 1, claimedAt },
			updates: [
				enqueuedUpdate,
				claimedUpdate,
				{ ...statusUpdate, at: '2026-07-20T14:07:00.000Z', message: 'Status from an old session.' },
				{ ...completedUpdate, at: '2026-07-20T14:08:00.000Z' },
			],
		};

		const groups = sessionStatusHistoryGroupsForAgent([secondCompleted, oldSessionWork, completed], bob);
		assert.deepEqual(
			groups.map(group => ({
				userMessage: group.userMessage,
				preset: group.preset,
				sourceLine: group.sourceLine,
				updates: group.updates.map(update => update.message),
			})),
			[
				{
					userMessage: completed.prompt.text,
					preset: completed.prompt.preset,
					sourceLine: completed.source.line,
					updates: [statusUpdate.message, latestStatusUpdate.message],
				},
				{
					userMessage: secondCompleted.prompt.text,
					preset: secondCompleted.prompt.preset,
					sourceLine: secondCompleted.source.line,
					updates: [secondStatusUpdate.message],
				},
			],
		);
		assert.equal(latestSessionStatusForAgent([completed, secondCompleted, oldSessionWork], bob)?.message, secondStatusUpdate.message);
		assert.deepEqual(sessionStatusHistoryGroupsForAgent([completed], { ...bob, session: { state: 'missing' } }), []);
		assert.equal(latestSessionStatusForAgent([completed], { ...bob, session: { state: 'missing' } }), undefined);
		assert.equal(latestSessionStatusForAgent([completed], amy), undefined);
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
