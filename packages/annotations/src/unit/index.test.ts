import * as assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
	parseAnnotationCompanionText,
	parseAnnotationListResult,
	parseAnnotationReadResult,
	parseAnnotationReanchorResult,
	parseCompanionRepairResult,
	renderAnnotationCompanion,
	type AnnotationCompanion,
} from '../index';

const companion: AnnotationCompanion = {
	version: 5,
	sourceDigest: 'b'.repeat(64),
	annotations: [{
		kind: 'user',
		id: 'query-1',
		permanentBaseCommit: 'a'.repeat(40),
		message: 'Explain this.',
		preset: '%Q',
		scope: 'line',
		anchor: { line: 2, text: 'const value = 1;', before: ['before'], after: ['after'] },
		officialResponses: [],
		agentAnnotations: [],
	}],
};

describe('shared annotation contracts', () => {
	test('round-trips the current companion text format', () => {
		assert.deepEqual(parseAnnotationCompanionText(renderAnnotationCompanion(companion)), companion);
		assert.throws(() => parseAnnotationCompanionText('version: 4\nannotations:\n'), /version 5/);
	});

	test('validates CLI annotation result envelopes', () => {
		const read = {
			...companion,
			currentPermanentCommit: 'a'.repeat(40),
			currentPermanentAnnotationIds: ['query-1'],
		};
		assert.deepEqual(parseAnnotationReadResult(read), read);
		assert.deepEqual(parseAnnotationReanchorResult({
			companion: read,
			changedAnnotationIds: ['query-1'],
			fileScopedAnnotationIds: [],
			affectedPaths: ['.sundial/source.ts.comments'],
			alreadyApplied: false,
		}).companion, read);
		assert.throws(() => parseAnnotationReadResult({ ...read, currentPermanentAnnotationIds: [] }), /read result/);
	});

	test('validates exact, unique workspace annotation list results', () => {
		const result = {
			currentPermanentCommit: 'a'.repeat(40),
			groups: [{
				file: 'src/example.ts',
				annotations: [{ id: 'query-1', message: 'Explain this.', line: 2, currentPermanent: true }],
			}],
		};
		assert.deepEqual(parseAnnotationListResult(result), result);
		assert.throws(() => parseAnnotationListResult({ ...result, extra: true }), /list result/);
		assert.throws(() => parseAnnotationListResult({
			...result,
			groups: [...result.groups, { file: 'src/other.ts', annotations: result.groups[0].annotations }],
		}), /list result/);
		assert.throws(() => parseAnnotationListResult({
			...result,
			groups: [{ ...result.groups[0], annotations: [{ ...result.groups[0].annotations[0], line: -1 }] }],
		}), /list result/);
	});

	test('validates companion repair result envelopes', () => {
		const result = {
			actions: [{
				kind: 'move' as const,
				source: 'old.ts',
				destination: 'new.ts',
				companion: '.sundial/old.ts.comments',
				destinationCompanion: '.sundial/new.ts.comments',
				linkedCompanions: ['.sundial/other.ts.comments'],
			}],
			affectedPaths: ['.sundial/new.ts.comments'],
		};
		assert.deepEqual(parseCompanionRepairResult(result), result);
		assert.throws(() => parseCompanionRepairResult({ ...result, actions: [{ kind: 'move' }] }), /repair result/);
	});
});
