import * as assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
	completionsForPromptCommandPrefix,
	isPromptCommandMode,
	promptCommandCompletions,
} from '../promptCompletion';

describe('prompt command completions', () => {
	test('offers line and project variants for all six presets', () => {
		assert.equal(promptCommandCompletions.length, 12);
		assert.deepEqual(
			promptCommandCompletions.map(completion => completion.insertText),
			[
				'%Q', '%Q @G',
				'%F', '%F @G',
				'%W', '%W @G',
				'%R', '%R @G',
				'%C', '%C @G',
				'%T', '%T @G',
			],
		);
	});

	test('enters command mode only when a viable percent command starts in column zero', () => {
		assert.equal(isPromptCommandMode('%'), true);
		assert.equal(isPromptCommandMode('%F'), true);
		assert.equal(isPromptCommandMode('%F @'), true);
		assert.equal(isPromptCommandMode(' %F'), false);
		assert.equal(isPromptCommandMode('const value = %'), false);
		assert.equal(isPromptCommandMode('%unknown'), false);
	});

	test('narrows completions while preserving a project-scope choice', () => {
		assert.deepEqual(
			completionsForPromptCommandPrefix('%F').map(completion => completion.insertText),
			['%F', '%F @G'],
		);
		assert.deepEqual(
			completionsForPromptCommandPrefix('%F @').map(completion => completion.insertText),
			['%F @G'],
		);
	});
});
