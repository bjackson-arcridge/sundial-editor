import type * as vscode from 'vscode';
import {
	commandLineDeletionRange,
	createPromptContext,
	parsePromptCommand,
	type CommandLineDeletionRange,
	type PromptContext,
} from './promptCommand';

export interface PromptEditor {
	readonly selection: { readonly active: { readonly line: number } };
	readonly document: {
		readonly lineCount: number;
		readonly uri: { readonly toString: () => string };
		readonly lineAt: (line: number) => { readonly text: string };
	};
	readonly edit: (callback: (edit: { delete: (range: vscode.Range) => void }) => void) => Thenable<boolean>;
}

export interface SubmitPromptDependencies {
	readonly activeTextEditor: () => PromptEditor | undefined;
	readonly reportValidationFailure: (message: string) => void | Thenable<unknown>;
	readonly openComposer: (prompt: PromptContext) => Promise<void>;
	readonly createDeletionRange: (range: CommandLineDeletionRange) => vscode.Range;
}

export async function submitPrompt(dependencies: SubmitPromptDependencies): Promise<boolean> {
	const editor = dependencies.activeTextEditor();
	if (editor === undefined) {
		await dependencies.reportValidationFailure('Sundial Editor: Open a document and place the cursor on a prompt command.');
		return false;
	}

	const line = editor.selection.active.line;
	const sourceText = editor.document.lineAt(line).text;
	const parsed = parsePromptCommand(sourceText);
	if (parsed === undefined) {
		await dependencies.reportValidationFailure('Sundial Editor: The active line must contain a supported prompt command.');
		return false;
	}

	const deletion = commandLineDeletionRange(line, editor.document.lineCount, sourceText.length);
	let didDelete: boolean;
	try {
		didDelete = await editor.edit(edit => edit.delete(dependencies.createDeletionRange(deletion)));
	} catch {
		await dependencies.reportValidationFailure('Sundial Editor: The prompt command line could not be removed safely.');
		return false;
	}

	if (!didDelete) {
		await dependencies.reportValidationFailure('Sundial Editor: The prompt command line could not be removed safely.');
		return false;
	}

	await dependencies.openComposer(createPromptContext(parsed, editor.document.uri.toString(), line, sourceText));
	return true;
}
