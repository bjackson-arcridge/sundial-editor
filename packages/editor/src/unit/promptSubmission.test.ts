import * as assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { CommandLineDeletionRange, PromptContext } from '../promptCommand';
import { captureAnchorContext, submitPrompt, type PromptEditor } from '../promptSubmission';

interface EditorHarness {
	readonly editor: PromptEditor;
	readonly deletedRanges: CommandLineDeletionRange[];
}

function createEditor(lines: readonly string[], activeLine: number, didDelete = true): EditorHarness {
	const deletedRanges: CommandLineDeletionRange[] = [];
	return {
		editor: {
			selection: { active: { line: activeLine } },
			document: {
				lineCount: lines.length,
				uri: { toString: () => 'file:///workspace/src/example.ts' },
				lineAt: line => ({ text: lines[line] }),
			},
			edit: async callback => {
				callback({ delete: range => deletedRanges.push(range as unknown as CommandLineDeletionRange) });
				return didDelete;
			},
		},
		deletedRanges,
	};
}

describe('submitPrompt', () => {
	test('deletes a valid complete command in one edit and opens the composer with preserved context', async () => {
		const harness = createEditor(['first', '%F @G', 'last'], 1);
		const opened: PromptContext[] = [];

		const submitted = await submitPrompt({
			activeTextEditor: () => harness.editor,
			reportValidationFailure: () => undefined,
			openComposer: async context => { opened.push(context); },
			createDeletionRange: range => range as never,
			workspaceCwd: () => '/workspace',
		});

		assert.equal(submitted, true);
		assert.deepEqual(harness.deletedRanges, [{
			start: { line: 1, character: 0 },
			end: { line: 2, character: 0 },
		}]);
		assert.deepEqual(opened, [{
			preset: '%F',
			scope: 'project',
			sourceUri: 'file:///workspace/src/example.ts',
			sourceLine: 0,
			sourceText: '%F @G',
			anchorText: 'first',
			anchorBefore: [],
			anchorAfter: ['last'],
		}]);
	});

	test('captures up to three non-empty lines on each side in source order', () => {
		const lines = [
			'oldest ignored', 'before one', '', 'before two', '   ', 'before three',
			'anchor line', '%F', '', 'after one', '   ', 'after two', 'after three', 'newest ignored',
		];
		const context = captureAnchorContext(createEditor(lines, 7).editor.document, 7);
		assert.deepEqual(context, {
			line: 6,
			text: 'anchor line',
			before: ['before one', 'before two', 'before three'],
			after: ['after one', 'after two', 'after three'],
		});
	});

	test('falls forward when a command on the first line has no preceding target', () => {
		const context = captureAnchorContext(createEditor(['%Q', 'first source line', '', 'second source line'], 0).editor.document, 0);
		assert.deepEqual(context, {
			line: 0,
			text: 'first source line',
			before: [],
			after: ['second source line'],
		});
	});

	test('keeps an empty previous line as the annotation target', () => {
		const context = captureAnchorContext(createEditor(['before', '', '%F', 'after'], 2).editor.document, 2);
		assert.deepEqual(context, {
			line: 1,
			text: '',
			before: ['before'],
			after: ['after'],
		});
	});

	test('reports an invalid source line without changing the document or opening the composer', async () => {
		const harness = createEditor(['const prompt = "%F";'], 0);
		const failures: string[] = [];
		let opened = false;

		const submitted = await submitPrompt({
			activeTextEditor: () => harness.editor,
			reportValidationFailure: message => { failures.push(message); },
			openComposer: async () => { opened = true; },
			createDeletionRange: range => range as never,
			workspaceCwd: () => '/workspace',
		});

		assert.equal(submitted, false);
		assert.equal(harness.deletedRanges.length, 0);
		assert.equal(opened, false);
		assert.match(failures[0], /supported prompt command/);
	});

	test('does not open the composer when VS Code rejects or throws from the edit', async () => {
		const harness = createEditor(['%T'], 0, false);
		const failures: string[] = [];
		let opened = false;

		const submitted = await submitPrompt({
			activeTextEditor: () => harness.editor,
			reportValidationFailure: message => { failures.push(message); },
			openComposer: async () => { opened = true; },
			createDeletionRange: range => range as never,
			workspaceCwd: () => '/workspace',
		});

		assert.equal(submitted, false);
		assert.equal(opened, false);
		assert.match(failures[0], /could not be removed safely/);

		const throwingHarness = createEditor(['%T'], 0);
		const throwingEditor: PromptEditor = {
			...throwingHarness.editor,
			edit: async () => { throw new Error('read-only document'); },
		};
		const thrownFailures: string[] = [];
		let openedAfterThrow = false;

		const thrown = await submitPrompt({
			activeTextEditor: () => throwingEditor,
			reportValidationFailure: message => { thrownFailures.push(message); },
			openComposer: async () => { openedAfterThrow = true; },
			createDeletionRange: range => range as never,
			workspaceCwd: () => '/workspace',
		});

		assert.equal(thrown, false);
		assert.equal(openedAfterThrow, false);
		assert.match(thrownFailures[0], /could not be removed safely/);
	});

	test('does not edit or open prompts for documents outside the workspace', async () => {
		const harness = createEditor(['%F'], 0);
		const failures: string[] = [];
		const submitted = await submitPrompt({
			activeTextEditor: () => harness.editor,
			reportValidationFailure: message => { failures.push(message); },
			openComposer: async () => assert.fail('composer should not open'),
			createDeletionRange: range => range as never,
			workspaceCwd: () => undefined,
		});
		assert.equal(submitted, false);
		assert.equal(harness.deletedRanges.length, 0);
		assert.match(failures[0], /inside an open workspace/);
	});
});
