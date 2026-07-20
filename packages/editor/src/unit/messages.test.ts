import * as assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
	appendAgentEvent,
	annotationForLine,
	isValidHostToWebviewMessage,
	isValidWebviewToHostMessage,
} from '../webviews/messages/messages';

const prompt = {
	preset: '%W',
	scope: 'project',
	sourceUri: 'file:///workspace/src/example.ts',
	sourceLine: 3,
	sourceText: '%W @G',
	anchorText: 'const value = 1;',
	anchorBefore: ['function calculate() {'],
	anchorAfter: ['return value;', '}'],
} as const;

const draft = 'Please update the project.';
const annotations = [{
	id: 'annotation-1', message: 'Fix this.', preset: '%F', scope: 'line',
	anchor: { line: 3, text: 'const value = 1;', before: ['function calculate() {'], after: ['return value;', '}'] },
}, {
	id: 'annotation-2', message: 'Add coverage.', preset: '%T', scope: 'project',
	anchor: { line: 3, text: 'const value = 1;', before: ['function calculate() {'], after: ['return value;', '}'] },
}] as const;

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
		assert.equal(isValidHostToWebviewMessage({
			kind: 'state',
			state: {
				annotationViewer: {
					sourceUri: prompt.sourceUri, annotation: annotations[0], position: 1, total: 2,
					pinned: false, canPrevious: false, canNext: true,
				},
			},
		}), true);
		assert.equal(isValidHostToWebviewMessage({ kind: 'state', state: {
			prompt, draft, submitted: true, annotationSaved: true, deliveryComplete: true,
		} }), true);
	});

	test('rejects malformed host messages', () => {
		assert.equal(isValidHostToWebviewMessage({ kind: 'state', state: { prompt, draft: 12 } }), false);
		assert.equal(isValidHostToWebviewMessage({ kind: 'state', state: { prompt } }), false);
		assert.equal(isValidHostToWebviewMessage({ kind: 'state', state: { draft } }), false);
		assert.equal(isValidHostToWebviewMessage({ kind: 'state', state: { prompt: { ...prompt, scope: 'global' }, draft } }), false);
		assert.equal(isValidHostToWebviewMessage({ kind: 'state', state: { prompt: { ...prompt, sourceLine: -1 }, draft } }), false);
		assert.equal(isValidHostToWebviewMessage({ kind: 'state', state: { prompt: { ...prompt, preset: '%X' }, draft } }), false);
		assert.equal(isValidHostToWebviewMessage({ kind: 'state', state: { run: { status: 'busy', events: [] } } }), false);
		assert.equal(isValidHostToWebviewMessage({ kind: 'state', state: { deliveryComplete: true } }), false);
		assert.equal(isValidHostToWebviewMessage({ kind: 'state', state: {
			annotationViewer: {
				sourceUri: prompt.sourceUri,
				annotation: { ...annotations[0], anchor: { line: -1, text: '', before: [], after: [] } },
				position: 1, total: 1, pinned: false, canPrevious: false, canNext: false,
			},
		} }), false);
		assert.equal(isValidHostToWebviewMessage({ kind: 'state', state: {
			annotationViewer: {
				sourceUri: prompt.sourceUri, annotation: annotations[0], position: 2, total: 1,
				pinned: false, canPrevious: true, canNext: false,
			},
		} }), false);
		assert.equal(isValidHostToWebviewMessage({ kind: 'other' }), false);
		assert.equal(isValidHostToWebviewMessage(null), false);
	});

	test('accepts and rejects the webview commands by their full shape', () => {
		assert.equal(isValidWebviewToHostMessage({ kind: 'submit', message: '' }), true);
		assert.equal(isValidWebviewToHostMessage({ kind: 'submit', message: 'Please fix this.' }), true);
		assert.equal(isValidWebviewToHostMessage({ kind: 'cancel' }), true);
		assert.equal(isValidWebviewToHostMessage({ kind: 'previousAnnotation' }), true);
		assert.equal(isValidWebviewToHostMessage({ kind: 'nextAnnotation' }), true);
		assert.equal(isValidWebviewToHostMessage({ kind: 'toggleAnnotationPin' }), true);
		assert.equal(isValidWebviewToHostMessage({ kind: 'deleteAnnotation' }), true);
		assert.equal(isValidWebviewToHostMessage({ kind: 'submit' }), false);
		assert.equal(isValidWebviewToHostMessage({ kind: 'submit', message: 12 }), false);
		assert.equal(isValidWebviewToHostMessage({ kind: 'cancel', message: 'unexpected' }), true);
		assert.equal(isValidWebviewToHostMessage({ kind: 'send', message: 'nope' }), false);
		assert.equal(isValidWebviewToHostMessage({ kind: 'pinAnnotation', id: '' }), false);
	});

	test('selects an annotation for a line and retains a preferred annotation on that line', () => {
		assert.equal(annotationForLine(annotations, 3)?.id, 'annotation-1');
		assert.equal(annotationForLine(annotations, 3, 'annotation-2')?.id, 'annotation-2');
		assert.equal(annotationForLine(annotations, 4), undefined);
	});
});
