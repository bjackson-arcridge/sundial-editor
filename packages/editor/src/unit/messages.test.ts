import * as assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
	appendAgentEvent,
	isValidHostToWebviewMessage,
	isValidWebviewToHostMessage,
} from '../webviews/messages/messages';

const prompt = {
	preset: '%W',
	scope: 'project',
	sourceUri: 'file:///workspace/src/example.ts',
	sourceLine: 3,
	sourceText: '%W @G',
} as const;

const draft = 'Please update the project.';

describe('messages protocol guards', () => {
	test('coalesces adjacent streamed output without inserting whitespace', () => {
		const events = appendAgentEvent(
			appendAgentEvent(
				[{ kind: 'status', status: 'working', message: 'Codex is working.' }],
				{ kind: 'output', text: 'First line' },
			),
			{ kind: 'output', text: '\n\n**Second line**' },
		);

		assert.deepEqual(events, [
			{ kind: 'status', status: 'working', message: 'Codex is working.' },
			{ kind: 'output', text: 'First line\n\n**Second line**' },
		]);
	});

	test('accepts every defined host message', () => {
		assert.equal(isValidHostToWebviewMessage({ kind: 'state', state: {} }), true);
		assert.equal(isValidHostToWebviewMessage({ kind: 'state', state: { prompt, draft } }), true);
		assert.equal(isValidHostToWebviewMessage({
			kind: 'state',
			state: { run: { status: 'working', events: [{ kind: 'output', text: 'Editing files.' }] } },
		}), true);
		assert.equal(isValidHostToWebviewMessage({ kind: 'focusComposer' }), true);
	});

	test('rejects malformed host messages', () => {
		assert.equal(isValidHostToWebviewMessage({ kind: 'state', state: { prompt, draft: 12 } }), false);
		assert.equal(isValidHostToWebviewMessage({ kind: 'state', state: { prompt } }), false);
		assert.equal(isValidHostToWebviewMessage({ kind: 'state', state: { draft } }), false);
		assert.equal(isValidHostToWebviewMessage({ kind: 'state', state: { prompt: { ...prompt, scope: 'global' }, draft } }), false);
		assert.equal(isValidHostToWebviewMessage({ kind: 'state', state: { prompt: { ...prompt, sourceLine: -1 }, draft } }), false);
		assert.equal(isValidHostToWebviewMessage({ kind: 'state', state: { prompt: { ...prompt, preset: '%X' }, draft } }), false);
		assert.equal(isValidHostToWebviewMessage({ kind: 'state', state: { run: { status: 'busy', events: [] } } }), false);
		assert.equal(isValidHostToWebviewMessage({ kind: 'other' }), false);
		assert.equal(isValidHostToWebviewMessage(null), false);
	});

	test('accepts and rejects the webview commands by their full shape', () => {
		assert.equal(isValidWebviewToHostMessage({ kind: 'submit', message: '' }), true);
		assert.equal(isValidWebviewToHostMessage({ kind: 'submit', message: 'Please fix this.' }), true);
		assert.equal(isValidWebviewToHostMessage({ kind: 'cancel' }), true);
		assert.equal(isValidWebviewToHostMessage({ kind: 'submit' }), false);
		assert.equal(isValidWebviewToHostMessage({ kind: 'submit', message: 12 }), false);
		assert.equal(isValidWebviewToHostMessage({ kind: 'cancel', message: 'unexpected' }), true);
		assert.equal(isValidWebviewToHostMessage({ kind: 'send', message: 'nope' }), false);
	});
});
