import * as assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
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

const draft = '[Integration stub] Sundial received %W for project scope.';

describe('messages protocol guards', () => {
	test('accepts every defined host message', () => {
		assert.equal(isValidHostToWebviewMessage({ kind: 'state' }), true);
		assert.equal(isValidHostToWebviewMessage({ kind: 'state', prompt, draft }), true);
		assert.equal(isValidHostToWebviewMessage({ kind: 'focusComposer' }), true);
		assert.equal(isValidHostToWebviewMessage({ kind: 'clearPrompt' }), true);
		assert.equal(isValidHostToWebviewMessage({ kind: 'submissionAcknowledged' }), true);
	});

	test('rejects malformed host messages', () => {
		assert.equal(isValidHostToWebviewMessage({ kind: 'state', prompt, draft: 12 }), false);
		assert.equal(isValidHostToWebviewMessage({ kind: 'state', prompt }), false);
		assert.equal(isValidHostToWebviewMessage({ kind: 'state', draft }), false);
		assert.equal(isValidHostToWebviewMessage({ kind: 'state', prompt: { ...prompt, scope: 'global' }, draft }), false);
		assert.equal(isValidHostToWebviewMessage({ kind: 'state', prompt: { ...prompt, sourceLine: -1 }, draft }), false);
		assert.equal(isValidHostToWebviewMessage({ kind: 'state', prompt: { ...prompt, preset: '%X' }, draft }), false);
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
