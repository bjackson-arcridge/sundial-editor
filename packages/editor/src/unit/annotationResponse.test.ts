import * as assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
	parseAgentId,
	parseAgentSessionId,
	parseUserAnnotationId,
	type NamedAgent,
	type UserAnnotationWorkItem,
} from '../agentProtocol';
import type { Annotation, AnnotationCompanion, UserAnnotation } from '../annotationProtocol';
import {
	prepareAnnotationResponse,
	preferredResponseAgent,
	type PrepareAnnotationResponseDependencies,
	type ResponseSourceDocument,
} from '../annotationResponse';
import { promptPresets } from '../promptCommand';

const bobId = parseAgentId('agent-bob');
const amyId = parseAgentId('agent-amy');
const bobSession = parseAgentSessionId('session-bob');
const amySession = parseAgentSessionId('session-amy');
const oldBobSession = parseAgentSessionId('session-bob-old');
const permanentCommit = 'a'.repeat(40);
const sourceDigest = 'b'.repeat(64);
const sourceUri = 'file:///workspace/src/example.ts';

const bob: NamedAgent = {
	id: bobId,
	slot: 1,
	name: 'Robert',
	session: { state: 'available', id: bobSession, provider: 'codex' },
	queue: { waiting: 0, working: 0, completed: 1 },
	controls: { canRename: true, canEnsureSession: false, canOpen: true, canInterrupt: false, canReset: true },
};
const amy: NamedAgent = {
	id: amyId,
	slot: 2,
	name: 'Amy',
	session: { state: 'available', id: amySession, provider: 'codex' },
	queue: { waiting: 0, working: 0, completed: 0 },
	controls: { canRename: true, canEnsureSession: false, canOpen: true, canInterrupt: false, canReset: true },
};

function userAnnotation(overrides: Partial<UserAnnotation> = {}): UserAnnotation {
	return {
		kind: 'user',
		id: 'annotation-user',
		permanentBaseCommit: permanentCommit,
		message: 'Fix this.',
		preset: '%F',
		scope: 'line',
		anchor: { line: 2, text: 'old target', before: [], after: [] },
		officialResponses: [],
		agentAnnotations: [],
		...overrides,
	};
}

function agentAnnotation(overrides: Partial<Extract<Annotation, { kind: 'agent' }>> = {}): Extract<Annotation, { kind: 'agent' }> {
	return {
		kind: 'agent',
		id: 'annotation-agent',
		permanentBaseCommit: permanentCommit,
		agentId: bobId,
		agentSessionId: bobSession,
		body: 'Consider this line.',
		createdAt: '2026-07-23T12:00:00.000Z',
		anchor: { line: 2, text: 'old target', before: [], after: [] },
		userAnnotation: { annotationId: 'annotation-user', file: 'src/parent.ts', line: 1 },
		...overrides,
	};
}

function workItem(overrides: Partial<UserAnnotationWorkItem> = {}): UserAnnotationWorkItem {
	const enqueuedAt = '2026-07-23T12:00:00.000Z';
	const update = { at: enqueuedAt, kind: 'enqueued', message: 'Waiting for Robert.' } as const;
	return {
		id: parseUserAnnotationId('annotation-user'),
		agentId: bobId,
		status: 'waiting',
		ready: true,
		enqueuedAt,
		updatedAt: enqueuedAt,
		latestUpdate: update,
		source: { uri: sourceUri, line: 2, text: 'target', before: [], after: [] },
		prompt: { preset: '%F', scope: 'line', text: 'Fix this.' },
		updates: [update],
		...overrides,
	};
}

function companion(annotations: readonly Annotation[]): AnnotationCompanion {
	return {
		version: 5,
		sourceDigest,
		annotations,
		currentPermanentCommit: permanentCommit,
		currentPermanentAnnotationIds: annotations.map(annotation => annotation.id),
	};
}

function sourceDocument(
	lines: readonly string[] = ['oldest', 'before', 'current target', '', 'after', 'newest'],
	overrides: Partial<ResponseSourceDocument> = {},
): ResponseSourceDocument {
	return {
		sourceUri,
		lineCount: lines.length,
		isDirty: false,
		lineAt: line => ({ text: lines[line] }),
		...overrides,
	};
}

function dependencies(
	overrides: Partial<PrepareAnnotationResponseDependencies> = {},
): PrepareAnnotationResponseDependencies {
	return {
		activeEditor: () => ({ sourceUri, line: 4 }),
		linkedSourceUri: file => `file:///workspace/${file}`,
		readAnnotations: async () => companion([userAnnotation()]),
		readSourceDocument: async () => sourceDocument(),
		...overrides,
	};
}

describe('annotation response continuity', () => {
	test('continues an agent annotation only through its exact available session', () => {
		const annotation = agentAnnotation();
		assert.equal(preferredResponseAgent(annotation, [], [bob, amy]), bobId);
		assert.equal(preferredResponseAgent(annotation, [], [{ ...bob, session: { state: 'available', id: oldBobSession, provider: 'codex' } }, amy]), undefined);
		assert.equal(preferredResponseAgent(annotation, [], [{ ...bob, session: { state: 'missing', id: bobSession } }, amy]), undefined);
		assert.equal(preferredResponseAgent(annotation, [], [amy]), undefined);
	});

	test('uses the latest official response before work assignment history', () => {
		const annotation = userAnnotation({
			officialResponses: [{
				userAnnotationId: 'annotation-user',
				agentId: amyId,
				agentSessionId: amySession,
				body: 'Completed.',
				createdAt: '2026-07-23T12:05:00.000Z',
			}],
		});
		const assignedToBob = workItem({
			status: 'completed',
			assignment: { sessionId: bobSession, sequence: 1, claimedAt: '2026-07-23T12:01:00.000Z' },
		});
		assert.equal(preferredResponseAgent(annotation, [assignedToBob], [bob, amy]), amyId);
		assert.equal(
			preferredResponseAgent(annotation, [assignedToBob], [bob, { ...amy, session: { state: 'missing', id: amySession } }]),
			undefined,
			'a disappeared official-response session must not fall back to another transcript',
		);
	});

	test('uses historical assignments and not-yet-assigned available targets', () => {
		const annotation = userAnnotation();
		const assigned = workItem({
			status: 'completed',
			assignment: { sessionId: bobSession, sequence: 2, claimedAt: '2026-07-23T12:01:00.000Z' },
		});
		assert.equal(preferredResponseAgent(annotation, [assigned], [bob, amy]), bobId);
		assert.equal(preferredResponseAgent(annotation, [workItem()], [bob, amy]), bobId);
		assert.equal(preferredResponseAgent(annotation, [workItem()], [{ ...bob, session: { state: 'uninitialized', id: bobSession, provider: 'codex' } }]), undefined);
		assert.equal(preferredResponseAgent(annotation, [], [bob, amy]), undefined);
	});
});

describe('prepare annotation response', () => {
	test('inherits user semantics and rebuilds context at the re-anchored annotation line', async () => {
		const prepared = await prepareAnnotationResponse(
			sourceUri,
			userAnnotation({ preset: '%R', scope: 'project' }),
			[workItem()],
			[bob, amy],
			dependencies(),
		);

		assert.deepEqual(prepared, {
			prompt: {
				preset: '%R',
				scope: 'project',
				sourceUri,
				sourceLine: 2,
				sourceText: '%R@G',
				anchorText: 'current target',
				anchorBefore: ['oldest', 'before'],
				anchorAfter: ['after', 'newest'],
			},
			continuity: 'originating-session',
			preferredAgentId: bobId,
		});
	});

	test('inherits every preset and scope from an agent annotation parent read through the supplied port', async () => {
		const reads: string[] = [];
		for (const [index, preset] of promptPresets.entries()) {
			const scope = index % 2 === 0 ? 'line' : 'project';
			const prepared = await prepareAnnotationResponse(sourceUri, agentAnnotation(), [], [bob], dependencies({
				readAnnotations: async uri => {
					reads.push(uri);
					return companion([userAnnotation({ preset, scope })]);
				},
			}));
			assert.equal(prepared.prompt.preset, preset);
			assert.equal(prepared.prompt.scope, scope);
		}
		assert.deepEqual(reads, Array(promptPresets.length).fill('file:///workspace/src/parent.ts'));
	});

	test('uses the current cursor only for a file-scoped annotation in the same active source', async () => {
		const prepared = await prepareAnnotationResponse(
			sourceUri,
			userAnnotation({ anchor: { line: null, text: '', before: [], after: [] } }),
			[workItem()],
			[bob],
			dependencies({ activeEditor: () => ({ sourceUri, line: 4 }) }),
		);
		assert.equal(prepared.prompt.sourceLine, 4);
		assert.equal(prepared.prompt.anchorText, 'after');

		await assert.rejects(
			prepareAnnotationResponse(
				sourceUri,
				userAnnotation({ anchor: { line: null, text: '', before: [], after: [] } }),
				[],
				[bob],
				dependencies({ activeEditor: () => ({ sourceUri: 'file:///workspace/src/other.ts', line: 1 }) }),
			),
			/Open the annotation source/,
		);
	});

	test('fails before opening for dirty, stale, missing-parent, and malformed source state', async () => {
		await assert.rejects(
			prepareAnnotationResponse(sourceUri, userAnnotation(), [], [bob], dependencies({
				readSourceDocument: async () => sourceDocument(undefined, { isDirty: true }),
			})),
			/Save the annotation source/,
		);
		await assert.rejects(
			prepareAnnotationResponse(sourceUri, userAnnotation({ anchor: { line: 99, text: '', before: [], after: [] } }), [], [bob], dependencies()),
			/outside the current saved source/,
		);
		await assert.rejects(
			prepareAnnotationResponse(sourceUri, agentAnnotation(), [], [bob], dependencies({
				readAnnotations: async () => companion([]),
			})),
			/originating user annotation no longer exists/,
		);
		await assert.rejects(
			prepareAnnotationResponse(sourceUri, agentAnnotation(), [], [bob], dependencies({
				linkedSourceUri: () => undefined,
			})),
			/outside the current workspace/,
		);
	});
});
