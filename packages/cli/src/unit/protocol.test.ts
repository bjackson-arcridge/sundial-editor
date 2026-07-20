import * as assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { parseCliPromptRequest, parsePromptRequest, renderEvent } from '../protocol';

describe('prompt protocol', () => {
	test('accepts the complete editor request shape', () => {
		const request = parsePromptRequest({
			provider: 'codex',
			model: 'gpt-5.4',
			workspace: { cwd: '/workspace' },
			document: { uri: 'file:///workspace/a.ts', line: 0, text: '%W @G' },
			prompt: { preset: '%W', scope: 'project', text: 'Work on this.' },
		});
		assert.equal(request.prompt.scope, 'project');
	});

	test('rejects incomplete or invalid requests', () => {
		assert.throws(() => parsePromptRequest(null), /provider/);
		assert.throws(() => parsePromptRequest({ provider: 'codex' }), /workspace/);
		assert.throws(() => parsePromptRequest({
			provider: 'codex', workspace: { cwd: '/w' },
			document: { uri: 'file:///w/a', line: -1, text: '' },
			prompt: { preset: '%F', scope: 'line', text: 'Fix' },
		}), /document/);
	});

	test('requires a positive assignment generation for managed prompts', () => {
		const request = parseCliPromptRequest({
			provider: 'codex',
			workspace: { cwd: '/workspace' },
			managed: {
				agentId: 'agent-1', agentSessionId: 'session-1', userAnnotationId: 'work-1', assignmentSequence: 2,
			},
		});
		assert.equal('managed' in request && request.managed.assignmentSequence, 2);
		assert.throws(() => parseCliPromptRequest({
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
