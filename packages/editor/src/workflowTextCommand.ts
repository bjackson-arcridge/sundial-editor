import type * as vscode from 'vscode';
import { commandLineDeletionRange, type CommandLineDeletionRange } from './promptCommand';

export type WorkflowCommandId =
	| 'sundialEditor.diff.toggle'
	| 'sundialEditor.diff.inline'
	| 'sundialEditor.diff.previous'
	| 'sundialEditor.diff.next'
	| 'sundialEditor.diff.head'
	| 'sundialEditor.diff.permanent'
	| 'sundialEditor.commit.file'
	| 'sundialEditor.commit.all'
	| 'sundialEditor.commit.message'
	| 'sundialEditor.companions.repair';

export interface WorkflowTextCommand {
	readonly insertText: string;
	readonly commandId: WorkflowCommandId;
	readonly detail: string;
	readonly sortText: string;
}

export const workflowTextCommands: readonly WorkflowTextCommand[] = [
	{ insertText: '%dd', commandId: 'sundialEditor.diff.toggle', detail: 'Toggle workspace diff view', sortText: '20-00' },
	{ insertText: '%di', commandId: 'sundialEditor.diff.inline', detail: 'Toggle inline diff rendering', sortText: '20-01' },
	{ insertText: '%d+', commandId: 'sundialEditor.diff.previous', detail: 'Move diff baseline one commit back', sortText: '20-02' },
	{ insertText: '%d-', commandId: 'sundialEditor.diff.next', detail: 'Move diff baseline one commit forward', sortText: '20-03' },
	{ insertText: '%d0', commandId: 'sundialEditor.diff.head', detail: 'Reset diff baseline to HEAD', sortText: '20-04' },
	{ insertText: '%dp', commandId: 'sundialEditor.diff.permanent', detail: 'Reset diff baseline to the last permanent commit', sortText: '20-05' },
	{ insertText: '%cf', commandId: 'sundialEditor.commit.file', detail: 'Checkpoint the current file and companion', sortText: '21-00' },
	{ insertText: '%ca', commandId: 'sundialEditor.commit.all', detail: 'Checkpoint all dirty files', sortText: '21-01' },
	{ insertText: '%cm', commandId: 'sundialEditor.commit.message', detail: 'Create a permanent consolidated commit', sortText: '21-02' },
	{ insertText: '%cr', commandId: 'sundialEditor.companions.repair', detail: 'Repair companions for Git moves and deletes', sortText: '21-03' },
];

export function completionsForWorkflowCommandPrefix(linePrefix: string): readonly WorkflowTextCommand[] {
	const prefix = linePrefix.trimStart().toLowerCase();
	if (!prefix.startsWith('%')) { return []; }
	return workflowTextCommands.filter(command => command.insertText.startsWith(prefix));
}

export function parseWorkflowTextCommand(sourceLine: string): WorkflowTextCommand | undefined {
	const command = sourceLine.trim().toLowerCase();
	return workflowTextCommands.find(candidate => candidate.insertText === command);
}

export function isWorkflowCommandMode(linePrefix: string): boolean {
	const prefix = linePrefix.trim();
	return prefix === '%' || workflowTextCommands.some(command => command.insertText.startsWith(prefix.toLowerCase()));
}

export interface WorkflowCommandEditor {
	readonly selection: { readonly active: { readonly line: number } };
	readonly document: {
		readonly lineCount: number;
		readonly lineAt: (line: number) => { readonly text: string };
		readonly save: () => Thenable<boolean>;
	};
	readonly edit: (callback: (edit: { delete: (range: vscode.Range) => void }) => void) => Thenable<boolean>;
}

export interface ExecuteWorkflowTextCommandDependencies {
	readonly activeTextEditor: () => WorkflowCommandEditor | undefined;
	readonly createDeletionRange: (range: CommandLineDeletionRange) => vscode.Range;
	readonly executeCommand: (commandId: WorkflowCommandId) => PromiseLike<unknown>;
	readonly reportValidationFailure: (message: string) => void | PromiseLike<unknown>;
}

export async function executeWorkflowTextCommand(
	expectedCommandId: WorkflowCommandId,
	dependencies: ExecuteWorkflowTextCommandDependencies,
): Promise<boolean> {
	const editor = dependencies.activeTextEditor();
	if (editor === undefined) {
		await dependencies.reportValidationFailure('Sundial Editor: Open a document and place the cursor on a workflow command.');
		return false;
	}
	const line = editor.selection.active.line;
	const sourceText = editor.document.lineAt(line).text;
	const command = parseWorkflowTextCommand(sourceText);
	if (command?.commandId !== expectedCommandId) {
		await dependencies.reportValidationFailure('Sundial Editor: The active line must contain the selected workflow command.');
		return false;
	}
	const deletion = commandLineDeletionRange(line, editor.document.lineCount, sourceText.length);
	let didDelete = false;
	try { didDelete = await editor.edit(edit => edit.delete(dependencies.createDeletionRange(deletion))); }
	catch { /* report the stable validation error below */ }
	if (!didDelete) {
		await dependencies.reportValidationFailure('Sundial Editor: The workflow command line could not be removed safely.');
		return false;
	}
	if (!await editor.document.save()) {
		await dependencies.reportValidationFailure('Sundial Editor: The document could not be saved before running the workflow command.');
		return false;
	}
	await dependencies.executeCommand(command.commandId);
	return true;
}
