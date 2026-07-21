import * as assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { CommandLineDeletionRange } from '../promptCommand';
import {
	completionsForWorkflowCommandPrefix,
	executeWorkflowTextCommand,
	isWorkflowCommandMode,
	parseWorkflowTextCommand,
	workflowTextCommands,
	type WorkflowCommandEditor,
} from '../workflowTextCommand';

describe('workflow text commands', () => {
	test('defines the ten canonical percent commands and host command mappings', () => {
		assert.deepEqual(workflowTextCommands.map(command => [command.insertText, command.commandId]), [
			['%dd', 'sundialEditor.diff.toggle'],
			['%di', 'sundialEditor.diff.inline'],
			['%d+', 'sundialEditor.diff.previous'],
			['%d-', 'sundialEditor.diff.next'],
			['%d0', 'sundialEditor.diff.head'],
			['%dp', 'sundialEditor.diff.permanent'],
			['%cf', 'sundialEditor.commit.file'],
			['%ca', 'sundialEditor.commit.all'],
			['%cm', 'sundialEditor.commit.message'],
			['%cr', 'sundialEditor.companions.repair'],
		]);
	});

	test('filters canonical completions and enters mode only for a viable whole-line command', () => {
		assert.deepEqual(completionsForWorkflowCommandPrefix('%d').map(command => command.insertText), [
			'%dd', '%di', '%d+', '%d-', '%d0', '%dp',
		]);
		assert.deepEqual(completionsForWorkflowCommandPrefix('  %C').map(command => command.insertText), [
			'%cf', '%ca', '%cm', '%cr',
		]);
		assert.equal(isWorkflowCommandMode('%'), true);
		assert.equal(isWorkflowCommandMode('%d+'), true);
		assert.equal(isWorkflowCommandMode('const value = %d'), false);
		assert.equal(parseWorkflowTextCommand('  %CR  ')?.commandId, 'sundialEditor.companions.repair');
		assert.equal(parseWorkflowTextCommand('%unknown'), undefined);
	});

	test('removes and saves the command line before invoking its mapped host command', async () => {
		const events: string[] = [];
		const deleted: CommandLineDeletionRange[] = [];
		const editor = createEditor(['before', '  %cf', 'after'], 1, deleted, events);
		assert.equal(await executeWorkflowTextCommand('sundialEditor.commit.file', {
			activeTextEditor: () => editor,
			createDeletionRange: range => range as never,
			executeCommand: async commandId => { events.push(`execute:${commandId}`); },
			reportValidationFailure: message => assert.fail(message),
		}), true);
		assert.deepEqual(deleted, [{ start: { line: 1, character: 0 }, end: { line: 2, character: 0 } }]);
		assert.deepEqual(events, ['edit', 'save', 'execute:sundialEditor.commit.file']);
	});

	test('does not invoke a mismatched command or continue after a save failure', async () => {
		const failures: string[] = [];
		const executed: string[] = [];
		const mismatch = createEditor(['%ca'], 0, [], []);
		assert.equal(await executeWorkflowTextCommand('sundialEditor.commit.file', {
			activeTextEditor: () => mismatch,
			createDeletionRange: range => range as never,
			executeCommand: async commandId => { executed.push(commandId); },
			reportValidationFailure: message => { failures.push(message); },
		}), false);
		const saveFailure = createEditor(['%cm'], 0, [], [], false);
		assert.equal(await executeWorkflowTextCommand('sundialEditor.commit.message', {
			activeTextEditor: () => saveFailure,
			createDeletionRange: range => range as never,
			executeCommand: async commandId => { executed.push(commandId); },
			reportValidationFailure: message => { failures.push(message); },
		}), false);
		assert.deepEqual(executed, []);
		assert.match(failures[0], /selected workflow command/);
		assert.match(failures[1], /could not be saved/);
	});
});

function createEditor(
	lines: readonly string[],
	activeLine: number,
	deleted: CommandLineDeletionRange[],
	events: string[],
	didSave = true,
): WorkflowCommandEditor {
	return {
		selection: { active: { line: activeLine } },
		document: {
			lineCount: lines.length,
			lineAt: line => ({ text: lines[line] }),
			save: async () => { events.push('save'); return didSave; },
		},
		edit: async callback => {
			callback({ delete: range => { deleted.push(range as unknown as CommandLineDeletionRange); } });
			events.push('edit');
			return true;
		},
	};
}
