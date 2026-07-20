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

	test('uses clear action descriptions in completion detail labels', () => {
		assert.deepEqual(
			promptCommandCompletions
				.filter(completion => completion.scope === 'line')
				.map(completion => completion.detail),
			[
				'Ask a question — current line',
				'Fix code — current line',
				'Write code — current line',
				'Refactor code — current line',
				'Clean up code — current line',
				'Create tests — current line',
			],
		);
	});

	test('enters command mode for viable commands after optional indentation and while targeting', () => {
		assert.equal(isPromptCommandMode('%'), true);
		assert.equal(isPromptCommandMode('%F'), true);
		assert.equal(isPromptCommandMode('%F @'), true);
		assert.equal(isPromptCommandMode(' \t%F'), true);
		assert.equal(isPromptCommandMode('%Q>1'), true);
		assert.equal(isPromptCommandMode('%Q>Build Bob @G'), true);
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

	test('preserves typed slot and name selectors in submit completions', () => {
		assert.deepEqual(
			completionsForPromptCommandPrefix('%Q>1').map(completion => completion.insertText),
			['%Q>1', '%Q>1 @G'],
		);
		assert.deepEqual(
			completionsForPromptCommandPrefix('%R>Build Bob').map(completion => completion.insertText),
			['%R>Build Bob', '%R>Build Bob @G'],
		);
		assert.deepEqual(
			completionsForPromptCommandPrefix('%R>Build Bob @').map(completion => completion.insertText),
			['%R>Build Bob @G'],
		);
		assert.deepEqual(completionsForPromptCommandPrefix('%Q>'), []);
		assert.deepEqual(completionsForPromptCommandPrefix('%Q>0'), []);
	});
});
