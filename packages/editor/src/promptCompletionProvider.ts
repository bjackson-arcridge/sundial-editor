import * as vscode from 'vscode';
import {
	completionsForPromptCommandPrefix,
	isPromptCommandMode,
} from './promptCompletion';
import { promptCommandPrefix, type SelectableAgent } from './promptCommand';

export const submitPromptCommandId = 'sundialEditor.submitPrompt';

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
					const completions = completionsForPromptCommandPrefix(linePrefix, targets);
					if (completions.length === 0 && !isPromptCommandMode(linePrefix)) {
						return undefined;
					}

					const replacement = new vscode.Range(position.line, 0, position.line, position.character);
					const items = completions.map(completion => {
						const item = new vscode.CompletionItem(completion.insertText, vscode.CompletionItemKind.Keyword);
						item.detail = completion.detail;
						item.filterText = completion.insertText;
						item.insertText = completion.insertText;
						item.range = replacement;
						item.sortText = completion.sortText;
						item.command = {
							command: submitPromptCommandId,
							title: 'Submit Sundial prompt',
						};
						return item;
					});

					return new vscode.CompletionList(items, true);
				},
			},
			promptCommandPrefix,
		),
		vscode.workspace.onDidChangeTextDocument(() => queueMicrotask(hideInlineSuggestionInCommandMode)),
		vscode.window.onDidChangeTextEditorSelection(event => hideInlineSuggestionInCommandMode(event.textEditor)),
	];
}

function needsPromptTargets(linePrefix: string): boolean {
	return /^%[QFWRCT](?:>|$)/i.test(linePrefix.trim());
}

function hideInlineSuggestionInCommandMode(editor = vscode.window.activeTextEditor): void {
	if (editor === undefined) {
		return;
	}

	const position = editor.selection.active;
	const linePrefix = editor.document.lineAt(position.line).text.slice(0, position.character);
	if (isPromptCommandMode(linePrefix)) {
		void vscode.commands.executeCommand('editor.action.inlineSuggest.hide');
	}
}
