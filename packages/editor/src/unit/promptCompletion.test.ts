import * as assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
	completionsForPromptCommandPrefix,
	isPromptCommandMode,
	promptCommandCompletions,
} from '../promptCompletion';

describe('prompt command completions', () => {
	const targets = [
		{ slot: 1, name: 'Cloe' },
		{ slot: 2, name: 'Build Amy' },
	] as const;

	test('offers line and project variants for all seven presets', () => {
		assert.equal(promptCommandCompletions.length, 14);
		assert.deepEqual(
			promptCommandCompletions.map(completion => completion.insertText),
			[
				'%Q', '%Q@G',
				'%D', '%D@G',
				'%F', '%F@G',
				'%W', '%W@G',
				'%R', '%R@G',
				'%C', '%C@G',
				'%T', '%T@G',
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
				'Deep research — current line',
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
		assert.equal(isPromptCommandMode('%D>Research Bob@'), true);
		assert.equal(isPromptCommandMode('%F@'), true);
		assert.equal(isPromptCommandMode(' \t%F'), true);
		assert.equal(isPromptCommandMode('%Q>1'), true);
		assert.equal(isPromptCommandMode('%Q>Build Bob@G'), true);
		assert.equal(isPromptCommandMode('const value = %'), false);
		assert.equal(isPromptCommandMode('%unknown'), false);
	});

	test('narrows completions while preserving a project-scope choice', () => {
		assert.deepEqual(
			completionsForPromptCommandPrefix('%F').map(completion => completion.insertText),
			['%F', '%F@G'],
		);
		assert.deepEqual(
			completionsForPromptCommandPrefix('%F@').map(completion => completion.insertText),
			['%F@G'],
		);
	});

	test('preserves typed slot and name selectors in submit completions', () => {
		assert.deepEqual(
			completionsForPromptCommandPrefix('%D>Research Amy').map(completion => completion.insertText),
			['%D>Research Amy', '%D>Research Amy@G'],
		);
		assert.deepEqual(
			completionsForPromptCommandPrefix('%Q>1').map(completion => completion.insertText),
			['%Q>1', '%Q>1@G'],
		);
		assert.deepEqual(
			completionsForPromptCommandPrefix('%R>Build Bob').map(completion => completion.insertText),
			['%R>Build Bob', '%R>Build Bob@G'],
		);
		assert.deepEqual(
			completionsForPromptCommandPrefix('%R>Build Bob@').map(completion => completion.insertText),
			['%R>Build Bob@G'],
		);
		assert.deepEqual(completionsForPromptCommandPrefix('%Q>'), []);
		assert.deepEqual(completionsForPromptCommandPrefix('%Q>0'), []);
	});

	test('offers current agents after a preset and filters slot or name selectors while typing', () => {
		assert.deepEqual(
			completionsForPromptCommandPrefix('%Q', targets).map(completion => completion.insertText),
			['%Q', '%Q@G', '%Q>1', '%Q>1@G', '%Q>2', '%Q>2@G'],
		);
		assert.deepEqual(
			completionsForPromptCommandPrefix('%Q>', targets).map(completion => completion.insertText),
			['%Q>1', '%Q>1@G', '%Q>2', '%Q>2@G'],
		);
		assert.deepEqual(
			completionsForPromptCommandPrefix('%Q>B', targets).map(completion => completion.insertText),
			['%Q>Bob', '%Q>Bob@G', '%Q>Build Amy', '%Q>Build Amy@G'],
		);
		assert.match(completionsForPromptCommandPrefix('%Q>1', targets)[0].detail, /Bob \(agent 1\)/);
	});
});
