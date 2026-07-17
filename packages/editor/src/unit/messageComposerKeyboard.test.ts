import * as assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { messageComposerKeyAction } from '../messageComposerKeyboard';

describe('message composer keyboard behavior', () => {
	test('sends on Enter and preserves a newline on Shift+Enter', () => {
		assert.equal(messageComposerKeyAction({ key: 'Enter', shiftKey: false, isComposing: false }), 'submit');
		assert.equal(messageComposerKeyAction({ key: 'Enter', shiftKey: true, isComposing: false }), 'newline');
	});

	test('keeps Escape cancellation and does not submit during IME composition', () => {
		assert.equal(messageComposerKeyAction({ key: 'Escape', shiftKey: false, isComposing: false }), 'cancel');
		assert.equal(messageComposerKeyAction({ key: 'Enter', shiftKey: false, isComposing: true }), 'none');
		assert.equal(messageComposerKeyAction({ key: 'a', shiftKey: false, isComposing: false }), 'none');
	});
});
