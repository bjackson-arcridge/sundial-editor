import * as assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { physicalLines, survivingLineMap, translateLine } from '../reanchor';

describe('annotation line diff', () => {
	test('maps unchanged, inserted, deleted, replaced, repeated, blank, and CRLF lines deterministically', () => {
		assert.deepEqual(survivingLineMap('a\nb\nc', 'a\nb\nc'), [
			{ oldLine: 0, newLine: 0 }, { oldLine: 1, newLine: 1 }, { oldLine: 2, newLine: 2 },
		]);
		assert.deepEqual(survivingLineMap('a\nb\nc', 'new\na\nb\nc'), [
			{ oldLine: 0, newLine: 1 }, { oldLine: 1, newLine: 2 }, { oldLine: 2, newLine: 3 },
		]);
		assert.deepEqual(survivingLineMap('a\nb\nc', 'a\nc'), [
			{ oldLine: 0, newLine: 0 }, { oldLine: 2, newLine: 1 },
		]);
		assert.deepEqual(survivingLineMap('a\nb\nc', 'a\nx\nc'), [
			{ oldLine: 0, newLine: 0 }, { oldLine: 2, newLine: 2 },
		]);
		assert.deepEqual(survivingLineMap('same\nsame\nlast', 'same\nlast'), [
			{ oldLine: 0, newLine: 0 }, { oldLine: 2, newLine: 1 },
		]);
		assert.deepEqual(survivingLineMap('a\r\n\r\nb', 'a\n\nb'), [
			{ oldLine: 0, newLine: 0 }, { oldLine: 1, newLine: 1 }, { oldLine: 2, newLine: 2 },
		]);
		assert.deepEqual(physicalLines(''), []);
	});

	test('translates direct, midpoint, one-sided, empty, and file-scoped anchors', () => {
		const mapping = [
			{ oldLine: 0, newLine: 0 },
			{ oldLine: 4, newLine: 6 },
		];
		assert.equal(translateLine(0, mapping, 7), 0);
		assert.equal(translateLine(2, mapping, 7), 3);
		assert.equal(translateLine(5, mapping, 7), 6);
		assert.equal(translateLine(-1, mapping, 7), 0);
		assert.equal(translateLine(2, [], 7), null);
		assert.equal(translateLine(2, mapping, 0), null);
		assert.equal(translateLine(null, mapping, 7), null);
	});
});
