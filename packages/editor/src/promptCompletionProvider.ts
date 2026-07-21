import * as vscode from 'vscode';
import {
	completionsForPromptCommandPrefix,
	isPromptCommandMode,
} from './promptCompletion';
import { promptCommandPrefix, type SelectableAgent } from './promptCommand';
import {
	completionsForWorkflowCommandPrefix,
	isWorkflowCommandMode,
} from './workflowTextCommand';

export const submitPromptCommandId = 'sundialEditor.submitPrompt';
export const executeWorkflowTextCommandId = 'sundialEditor.executeWorkflowTextCommand';

const promptDocumentSelector: vscode.DocumentSelector = [
	{ scheme: 'file' },
	{ scheme: 'untitled' },
];

export interface PromptCommandModeServices {
	readonly targetsForDocument: (document: vscode.TextDocument) => Promise<readonly SelectableAgent[]>;
}

export function registerPromptCommandMode(services?: PromptCommandModeServices): readonly vscode.Disposable[] {
	return [
		vscode.languages.registerCompletionItemProvider(
			promptDocumentSelector,
			{
				async provideCompletionItems(document, position, token) {
					const linePrefix = document.lineAt(position.line).text.slice(0, position.character);
					const targets = needsPromptTargets(linePrefix)
						? await services?.targetsForDocument(document).catch(() => []) ?? []
						: [];
					if (token.isCancellationRequested) {
						return undefined;
					}
					const promptCompletions = completionsForPromptCommandPrefix(linePrefix, targets);
					const workflowCompletions = completionsForWorkflowCommandPrefix(linePrefix);
					if (promptCompletions.length === 0 && workflowCompletions.length === 0
						&& !isPromptCommandMode(linePrefix) && !isWorkflowCommandMode(linePrefix)) {
						return undefined;
					}

					const replacement = new vscode.Range(position.line, 0, position.line, position.character);
					const commandPrefix = linePrefix.trimStart();
					const targeting = /^%(?:[QFWRCT])?(?:>|@)/i.test(commandPrefix);
					const completions = [
						...promptCompletions.map(completion => ({ ...completion, commandId: submitPromptCommandId, arguments: undefined })),
						...workflowCompletions.map(completion => ({
							...completion, commandId: executeWorkflowTextCommandId, arguments: [completion.commandId],
						})),
					];
					const items = completions.map((completion, index) => {
						const item = new vscode.CompletionItem(completion.insertText, vscode.CompletionItemKind.Keyword);
						item.detail = completion.detail;
						item.filterText = targeting ? commandPrefix : completion.insertText;
						item.insertText = completion.insertText;
						item.range = replacement;
						item.sortText = completion.sortText;
						item.preselect = index === 0;
						item.command = {
							command: completion.commandId,
							title: completion.commandId === submitPromptCommandId ? 'Submit Sundial prompt' : 'Run Sundial workflow command',
							...(completion.arguments === undefined ? {} : { arguments: completion.arguments }),
						};
						return item;
					});

					return new vscode.CompletionList(items, true);
				},
			},
			promptCommandPrefix,
			'>',
			'@',
		),
		vscode.workspace.onDidChangeTextDocument(event => {
			const refreshRequired = event.contentChanges.some(change => change.rangeLength > change.text.length);
			queueMicrotask(() => refreshRequired
				? refreshPromptCommandCompletions(event.document)
				: hideInlineSuggestionInCommandMode());
		}),
		vscode.window.onDidChangeTextEditorSelection(event => hideInlineSuggestionInCommandMode(event.textEditor)),
	];
}

function needsPromptTargets(linePrefix: string): boolean {
	return /^%(?:[QFWRCT](?:>|$)|>)/i.test(linePrefix.trim());
}

function refreshPromptCommandCompletions(document: vscode.TextDocument): void {
	const editor = vscode.window.activeTextEditor;
	if (editor === undefined || editor.document !== document) {
		return;
	}

	const position = editor.selection.active;
	const linePrefix = document.lineAt(position.line).text.slice(0, position.character);
	if (isPromptCommandMode(linePrefix) || isWorkflowCommandMode(linePrefix)) {
		hideInlineSuggestionInCommandMode(editor);
		void vscode.commands.executeCommand('editor.action.triggerSuggest');
	}
}

function hideInlineSuggestionInCommandMode(editor = vscode.window.activeTextEditor): void {
	if (editor === undefined) {
		return;
	}

	const position = editor.selection.active;
	const linePrefix = editor.document.lineAt(position.line).text.slice(0, position.character);
	if (isPromptCommandMode(linePrefix) || isWorkflowCommandMode(linePrefix)) {
		void vscode.commands.executeCommand('editor.action.inlineSuggest.hide');
	}
}
