import * as assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
	commandLineDeletionRange,
	createPromptContext,
	parsePromptCommand,
	PromptTargetResolutionError,
	promptPresets,
	resolvePromptTargetSelector,
} from '../promptCommand';

describe('prompt command parser', () => {
	test('accepts every preset with optional global scope', () => {
		for (const preset of promptPresets) {
			assert.deepEqual(parsePromptCommand(preset), { preset, scope: 'line' });
			assert.deepEqual(parsePromptCommand(`${preset}@G`), { preset, scope: 'project' });
		}

		assert.deepEqual(parsePromptCommand('\u2003\t   %F@G\t '), { preset: '%F', scope: 'project' });
	});

	test('parses stable slot and named target selectors before optional project scope', () => {
		assert.deepEqual(parsePromptCommand('%Q>1'), {
			preset: '%Q', scope: 'line', targetSelector: { kind: 'slot', slot: 1 },
		});
		assert.deepEqual(parsePromptCommand('   %W>27@G'), {
			preset: '%W', scope: 'project', targetSelector: { kind: 'slot', slot: 27 },
		});
		assert.deepEqual(parsePromptCommand('%R>Bob'), {
			preset: '%R', scope: 'line', targetSelector: { kind: 'name', name: 'Bob' },
		});
		assert.deepEqual(parsePromptCommand('\t%C>build-agent_2@G  '), {
			preset: '%C', scope: 'project', targetSelector: { kind: 'name', name: 'build-agent_2' },
		});
		assert.deepEqual(parsePromptCommand('%T>Build Bob@G'), {
			preset: '%T', scope: 'project', targetSelector: { kind: 'name', name: 'Build Bob' },
		});
		assert.deepEqual(parsePromptCommand('%F>123Bob'), {
			preset: '%F', scope: 'line', targetSelector: { kind: 'name', name: '123Bob' },
		});
		assert.deepEqual(parsePromptCommand('%F>Bob@G'), {
			preset: '%F', scope: 'project', targetSelector: { kind: 'name', name: 'Bob' },
		});
	});

	test('rejects source text, unrecognised presets, and malformed modifiers', () => {
		for (const sourceLine of [
			'',
			' :Q',
			'const answer = "%Q";',
			':Q',
			'>1:F',
			'%X',
			'%F @G',
			'%F @g',
			'%F@G trailing',
			'%Q@G@G',
			'% F',
			'%Q >1',
			'%Q>0',
			'%Q>01',
			'%Q>',
			'%Q>   ',
			'%Q>@G',
			'%Q>Bob\n@G',
			'%Q>Bob\u2028@G',
			`%Q>${Number.MAX_SAFE_INTEGER}0`,
			`%Q>${'a'.repeat(81)}`,
		]) {
			assert.equal(parsePromptCommand(sourceLine), undefined, sourceLine);
		}
	});
});

describe('prompt target selector resolution', () => {
	const bob = { id: 'agent-bob', slot: 4, name: 'Build Bob' } as const;
	const amy = { id: 'agent-amy', slot: 1, name: 'Amy' } as const;

	test('resolves slots by stable slot value rather than array position', () => {
		assert.equal(resolvePromptTargetSelector({ kind: 'slot', slot: 1 }, [bob, amy]), amy);
		assert.equal(resolvePromptTargetSelector({ kind: 'slot', slot: 4 }, [amy, bob]), bob);
	});

	test('resolves names case-insensitively while retaining the stored agent', () => {
		assert.equal(resolvePromptTargetSelector({ kind: 'name', name: 'build BOB' }, [amy, bob]), bob);
	});

	test('reports unknown and ambiguous selectors without choosing an agent', () => {
		assert.throws(
			() => resolvePromptTargetSelector({ kind: 'slot', slot: 2 }, [amy, bob]),
			(error: unknown) => {
				assert.ok(error instanceof PromptTargetResolutionError);
				assert.equal(error.code, 'unknown');
				assert.match(error.message, />2/);
				return true;
			},
		);
		assert.throws(
			() => resolvePromptTargetSelector({ kind: 'name', name: 'SAM' }, [
				{ id: 'agent-sam-1', slot: 2, name: 'Sam' },
				{ id: 'agent-sam-2', slot: 3, name: 'sam' },
			]),
			(error: unknown) => {
				assert.ok(error instanceof PromptTargetResolutionError);
				assert.equal(error.code, 'ambiguous');
				assert.match(error.message, />SAM/);
				return true;
			},
		);
		assert.throws(
			() => resolvePromptTargetSelector({ kind: 'slot', slot: 3 }, [
				{ id: 'agent-one', slot: 3, name: 'One' },
				{ id: 'agent-two', slot: 3, name: 'Two' },
			]),
			(error: unknown) => error instanceof PromptTargetResolutionError && error.code === 'ambiguous',
		);
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

test('creates prompt context without changing the original source text or target selector', () => {
	const parsed = parsePromptCommand('  %C>Ty@G');
	if (parsed === undefined) {
		throw new Error('Expected the preset to parse.');
	}

	const context = createPromptContext(
		parsed,
		'file:///workspace/src/example.ts',
		8,
		'  %C>Ty@G',
		'const value = 1;',
		['function calculate() {'],
		['return value;', '}'],
	);
	assert.deepEqual(context, {
		preset: '%C',
		scope: 'project',
		targetSelector: { kind: 'name', name: 'Ty' },
		sourceUri: 'file:///workspace/src/example.ts',
		sourceLine: 8,
		sourceText: '  %C>Ty@G',
		anchorText: 'const value = 1;',
		anchorBefore: ['function calculate() {'],
		anchorAfter: ['return value;', '}'],
	});
});
