import * as assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { parsePromptRequest, renderEvent } from '../protocol';

describe('prompt protocol', () => {
	test('accepts the managed editor request shape', () => {
		const request = parsePromptRequest({
			provider: 'codex',
			model: 'gpt-5.4',
			workspace: { cwd: '/workspace' },
			managed: { agentId: 'agent-1', agentSessionId: 'session-1', userAnnotationId: 'work-1', assignmentSequence: 2 },
		});
		assert.equal(request.managed.assignmentSequence, 2);
	});

	test('rejects incomplete or invalid requests', () => {
		assert.throws(() => parsePromptRequest(null), /provider/);
		assert.throws(() => parsePromptRequest({ provider: 'codex' }), /workspace/);
		assert.throws(() => parsePromptRequest({ provider: 'codex', workspace: { cwd: '/w' } }), /managed prompt/);
	});

	test('requires a positive assignment generation for managed prompts', () => {
		const request = parsePromptRequest({
			provider: 'codex',
			workspace: { cwd: '/workspace' },
			managed: {
				agentId: 'agent-1', agentSessionId: 'session-1', userAnnotationId: 'work-1', assignmentSequence: 2,
			},
		});
		assert.equal(request.managed.assignmentSequence, 2);
		assert.throws(() => parsePromptRequest({
			provider: 'codex',
			workspace: { cwd: '/workspace' },
			managed: {
				agentId: 'agent-1', agentSessionId: 'session-1', userAnnotationId: 'work-1', assignmentSequence: 0,
			},
		}), /positive assignmentSequence/);
	});

	test('renders stable discriminated event JSON', () => {
		assert.equal(renderEvent({ kind: 'status', status: 'waiting' }), '{"kind":"status","status":"waiting"}');
	});
});
