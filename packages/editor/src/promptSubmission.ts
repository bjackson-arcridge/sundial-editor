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
		readonly save: () => Thenable<boolean>;
	};
	readonly edit: (callback: (edit: { delete: (range: vscode.Range) => void }) => void) => Thenable<boolean>;
}

export interface AnchorContext {
	readonly line: number;
	readonly text: string;
	readonly before: readonly string[];
	readonly after: readonly string[];
}

export interface SubmitPromptDependencies {
	readonly activeTextEditor: () => PromptEditor | undefined;
	readonly reportValidationFailure: (message: string) => void | Thenable<unknown>;
	readonly openComposer: (prompt: PromptContext) => Promise<void>;
	readonly createDeletionRange: (range: CommandLineDeletionRange) => vscode.Range;
	readonly workspaceCwd: (sourceUri: string) => string | undefined;
	readonly validatePrompt?: (prompt: PromptContext, workspaceCwd: string) => string | undefined | Promise<string | undefined>;
}

export async function submitPrompt(dependencies: SubmitPromptDependencies): Promise<boolean> {
	const editor = dependencies.activeTextEditor();
	if (editor === undefined) {
		await dependencies.reportValidationFailure('Sundial Editor: Open a document and place the cursor on a prompt command.');
		return false;
	}

	const line = editor.selection.active.line;
	const sourceText = editor.document.lineAt(line).text;
	const sourceUri = editor.document.uri.toString();
	const workspaceCwd = dependencies.workspaceCwd(sourceUri);
	if (workspaceCwd === undefined) {
		await dependencies.reportValidationFailure('Sundial Editor: Prompt commands require a file inside an open workspace.');
		return false;
	}
	const parsed = parsePromptCommand(sourceText);
	if (parsed === undefined) {
		await dependencies.reportValidationFailure('Sundial Editor: The active line must contain a supported prompt command.');
		return false;
	}
	const anchor = captureAnchorContext(editor.document, line);
	const prompt = createPromptContext(
		parsed,
		sourceUri,
		anchor.line,
		sourceText,
		anchor.text,
		anchor.before,
		anchor.after,
	);
	const validationFailure = await dependencies.validatePrompt?.(prompt, workspaceCwd);
	if (validationFailure !== undefined) {
		await dependencies.reportValidationFailure(`Sundial Editor: ${validationFailure}`);
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
	if (!await editor.document.save()) {
		await dependencies.reportValidationFailure('Sundial Editor: The document could not be saved before creating the annotation.');
		return false;
	}

	await dependencies.openComposer(prompt);
	return true;
}

export function captureAnchorContext(
	document: PromptEditor['document'],
	commandLine: number,
): AnchorContext {
	const targetOriginalLine = commandLine > 0
		? commandLine - 1
		: (commandLine + 1 < document.lineCount ? commandLine + 1 : undefined);
	const targetLine = commandLine > 0 ? commandLine - 1 : 0;
	const before: string[] = [];
	for (let line = (targetOriginalLine ?? 0) - 1; line >= 0 && before.length < 3; line -= 1) {
		if (line === commandLine) {
			continue;
		}
		const text = document.lineAt(line).text;
		if (text.trim() !== '') {
			before.unshift(text);
		}
	}

	const after: string[] = [];
	for (let line = (targetOriginalLine ?? commandLine) + 1; line < document.lineCount && after.length < 3; line += 1) {
		if (line === commandLine) {
			continue;
		}
		const text = document.lineAt(line).text;
		if (text.trim() !== '') {
			after.push(text);
		}
	}

	return {
		line: targetLine,
		text: targetOriginalLine === undefined ? '' : document.lineAt(targetOriginalLine).text,
		before,
		after,
	};
}
