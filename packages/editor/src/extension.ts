import * as vscode from 'vscode';
import { revealAgentsViewOnFirstActivation } from './firstRun';
import { registerPromptCommandMode, submitPromptCommandId } from './promptCompletionProvider';
import type { PromptContext } from './promptCommand';
import { submitPrompt } from './promptSubmission';
import { returnToVSCodeVimNormalMode } from './vimNormalMode';
import { MessagesWebviewProvider } from './webviews/messages/messagesWebviewProvider';

const messagesViewId = 'sundialEditor.messages';
const agentsViewContainerId = 'sundialEditor';

export function activate(context: vscode.ExtensionContext): void {
	const messagesProvider = new MessagesWebviewProvider(context.extensionUri, {
		returnToSource: returnToSource,
	});
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(messagesViewId, messagesProvider),
		vscode.commands.registerCommand(submitPromptCommandId, () => submitPrompt({
			activeTextEditor: () => vscode.window.activeTextEditor,
			reportValidationFailure: message => vscode.window.showWarningMessage(message),
			openComposer: prompt => messagesProvider.openPrompt(prompt),
			createDeletionRange: range => new vscode.Range(
				new vscode.Position(range.start.line, range.start.character),
				new vscode.Position(range.end.line, range.end.character),
			),
		})),
		vscode.commands.registerCommand('sundialEditor.internal.messagesDiagnostics', () => messagesProvider.diagnostics()),
		vscode.commands.registerCommand('sundialEditor.internal.submitPendingMessage', () => messagesProvider.acknowledgePendingSubmission()),
		...registerPromptCommandMode(),
	);

	setTimeout(() => {
		void revealAgentsViewOnFirstActivation({
			state: context.globalState,
			revealAgentsView: revealAgentsView,
		}).catch(error => console.error('sundial-editor: failed to reveal Sundial Agents on first activation', error));
	}, 0);
}

async function revealAgentsView(): Promise<void> {
	await vscode.commands.executeCommand(`workbench.view.extension.${agentsViewContainerId}`);
	await vscode.commands.executeCommand(`${messagesViewId}.focus`);
}

async function returnToSource(prompt: PromptContext): Promise<void> {
	try {
		const editor = await vscode.window.showTextDocument(vscode.Uri.parse(prompt.sourceUri), { preserveFocus: false });
		const line = Math.min(prompt.sourceLine, Math.max(editor.document.lineCount - 1, 0));
		const position = new vscode.Position(line, 0);
		editor.selection = new vscode.Selection(position, position);
		editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
		await returnToVSCodeVimNormalMode({
			getExtension: extensionId => vscode.extensions.getExtension(extensionId),
			executeCommand: commandId => vscode.commands.executeCommand(commandId),
			reportFailure: error => console.error('sundial-editor: failed to return VSCodeVim to Normal mode', error),
		});
	} catch {
		void vscode.window.showWarningMessage('Sundial Editor: The originating document is no longer available.');
	}
}
