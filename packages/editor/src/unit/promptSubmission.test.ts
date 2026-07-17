import * as assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { CommandLineDeletionRange, PromptContext } from '../promptCommand';
import { submitPrompt, type PromptEditor } from '../promptSubmission';

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
			sourceLine: 1,
			sourceText: '%F @G',
		}]);
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
		});

		assert.equal(thrown, false);
		assert.equal(openedAfterThrow, false);
		assert.match(thrownFailures[0], /could not be removed safely/);
	});
});
