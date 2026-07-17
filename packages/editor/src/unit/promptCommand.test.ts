import * as assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { commandLineDeletionRange, createPromptContext, parsePromptCommand, promptPresets } from '../promptCommand';

describe('prompt command parser', () => {
	test('accepts every preset with optional global scope', () => {
		for (const preset of promptPresets) {
			assert.deepEqual(parsePromptCommand(preset), { preset, scope: 'line' });
			assert.deepEqual(parsePromptCommand(`${preset} @G`), { preset, scope: 'project' });
		}

		assert.deepEqual(parsePromptCommand('%F @G\t '), { preset: '%F', scope: 'project' });
	});

	test('rejects source text, unrecognised presets, and malformed modifiers', () => {
		for (const sourceLine of [
			'',
			' :Q',
			'const answer = "%Q";',
			':Q',
			'>1:F',
			'%X',
			'%F@G',
			'%F @g',
			'%F @G trailing',
			'%Q @G @G',
			'% F',
			' \t%F',
		]) {
			assert.equal(parsePromptCommand(sourceLine), undefined, sourceLine);
		}
	});
});

describe('command line deletion ranges', () => {
	test('removes the line ending for first and middle lines', () => {
		assert.deepEqual(commandLineDeletionRange(0, 3, 2), {
			start: { line: 0, character: 0 },
			end: { line: 1, character: 0 },
		});
		assert.deepEqual(commandLineDeletionRange(1, 3, 5), {
			start: { line: 1, character: 0 },
			end: { line: 2, character: 0 },
		});
	});

	test('does not extend past the last source line', () => {
		assert.deepEqual(commandLineDeletionRange(2, 3, 4), {
			start: { line: 2, character: 0 },
			end: { line: 2, character: 4 },
		});
	});

	test('rejects invalid document coordinates', () => {
		assert.throws(() => commandLineDeletionRange(-1, 3, 2), RangeError);
		assert.throws(() => commandLineDeletionRange(3, 3, 2), RangeError);
		assert.throws(() => commandLineDeletionRange(0, 3, -1), RangeError);
	});
});

test('creates prompt context without changing the original source text', () => {
	const parsed = parsePromptCommand('%C @G');
	if (parsed === undefined) {
		throw new Error('Expected the preset to parse.');
	}

	const context = createPromptContext(parsed, 'file:///workspace/src/example.ts', 8, '%C @G');
	assert.deepEqual(context, {
		preset: '%C',
		scope: 'project',
		sourceUri: 'file:///workspace/src/example.ts',
		sourceLine: 8,
		sourceText: '%C @G',
	});
});
