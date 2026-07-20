import * as vscode from 'vscode';
import {
	completionsForPromptCommandPrefix,
	isPromptCommandMode,
} from './promptCompletion';
import { promptCommandPrefix } from './promptCommand';

export const submitPromptCommandId = 'sundialEditor.submitPrompt';

const promptDocumentSelector: vscode.DocumentSelector = [
	{ scheme: 'file' },
	{ scheme: 'untitled' },
];

export function registerPromptCommandMode(): readonly vscode.Disposable[] {
	return [
		vscode.languages.registerCompletionItemProvider(
			promptDocumentSelector,
			{
				provideCompletionItems(document, position) {
					const linePrefix = document.lineAt(position.line).text.slice(0, position.character);
					const completions = completionsForPromptCommandPrefix(linePrefix);
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
