import * as vscode from 'vscode';
import { revealAgentsViewOnFirstActivation } from './firstRun';
import { paneSplitPercentConfiguration } from './paneSplit';
import { registerPromptCommandMode, submitPromptCommandId } from './promptCompletionProvider';
import type { PromptContext } from './promptCommand';
import { submitPrompt } from './promptSubmission';
import { returnToVSCodeVimNormalMode } from './vimNormalMode';
import { MessagesWebviewProvider } from './webviews/messages/messagesWebviewProvider';

const messagesViewId = 'sundialEditor.messages';
const agentsViewContainerId = 'sundialEditor';

export function activate(context: vscode.ExtensionContext): void {
	const annotationMarker = vscode.window.createTextEditorDecorationType({
		before: {
			contentText: '●',
			color: new vscode.ThemeColor('editorInfo.foreground'),
			margin: '0 0.65em 0 0',
		},
	});
	const messagesProvider = new MessagesWebviewProvider(context.extensionUri, {
		returnToSource: returnToSource,
		revealAnnotation: revealAnnotation,
		showAnnotationMarkers: (sourceUri, lines) => {
			for (const editor of vscode.window.visibleTextEditors) {
				const matches = sourceUri !== undefined && editor.document.uri.toString() === sourceUri;
				editor.setDecorations(annotationMarker, matches
					? lines.filter(line => line < editor.document.lineCount).map(line => new vscode.Range(line, 0, line, 0))
					: []);
			}
		},
	});
	const annotationWatcher = vscode.workspace.createFileSystemWatcher('**/.sundial/**/*.comments');
	const updateActiveLocation = (editor: vscode.TextEditor | undefined, reload = false): void => {
		const location = editor === undefined ? undefined : activeWorkspaceLocation(editor);
		void messagesProvider.setActiveLocation(location, reload);
	};
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(messagesViewId, messagesProvider),
		vscode.workspace.onDidChangeConfiguration(event => {
			if (event.affectsConfiguration(paneSplitPercentConfiguration)) {
				messagesProvider.refreshPaneSplitPercent();
			}
		}),
		vscode.commands.registerCommand(submitPromptCommandId, () => submitPrompt({
			activeTextEditor: () => vscode.window.activeTextEditor,
			reportValidationFailure: message => vscode.window.showWarningMessage(message),
			openComposer: prompt => messagesProvider.openPrompt(prompt),
			workspaceCwd: sourceUri => workspaceCwdForSource(vscode.Uri.parse(sourceUri)),
			validatePrompt: (prompt, cwd) => messagesProvider.validatePromptTarget(prompt, cwd),
			createDeletionRange: range => new vscode.Range(
				new vscode.Position(range.start.line, range.start.character),
				new vscode.Position(range.end.line, range.end.character),
			),
		})),
		vscode.commands.registerCommand('sundialEditor.internal.messagesDiagnostics', () => messagesProvider.diagnostics()),
		vscode.commands.registerCommand('sundialEditor.internal.submitPendingMessage', (message?: string) => messagesProvider.submitPendingMessage(message)),
		vscode.commands.registerCommand('sundialEditor.internal.cancelPendingMessage', () => messagesProvider.cancelPendingMessage()),
		vscode.commands.registerCommand('sundialEditor.internal.toggleAnnotationPin', () => messagesProvider.toggleAnnotationPin()),
		vscode.commands.registerCommand('sundialEditor.internal.previousAnnotation', () => messagesProvider.selectAdjacentAnnotation(-1)),
		vscode.commands.registerCommand('sundialEditor.internal.nextAnnotation', () => messagesProvider.selectAdjacentAnnotation(1)),
		vscode.commands.registerCommand('sundialEditor.internal.deleteAnnotation', () => messagesProvider.deleteViewedAnnotation(true)),
		vscode.window.onDidChangeActiveTextEditor(editor => updateActiveLocation(editor, true)),
		vscode.window.onDidChangeTextEditorSelection(event => {
			if (event.textEditor === vscode.window.activeTextEditor) {
				updateActiveLocation(event.textEditor);
			}
		}),
		annotationWatcher,
		annotationWatcher.onDidCreate(uri => { void messagesProvider.refreshAnnotationsForCompanion(uri.fsPath); }),
		annotationWatcher.onDidChange(uri => { void messagesProvider.refreshAnnotationsForCompanion(uri.fsPath); }),
		annotationWatcher.onDidDelete(uri => { void messagesProvider.refreshAnnotationsForCompanion(uri.fsPath); }),
		annotationMarker,
		...registerPromptCommandMode({
			targetsForDocument: document => {
				const cwd = workspaceCwdForSource(document.uri);
				return cwd === undefined ? Promise.resolve([]) : messagesProvider.promptTargets(cwd);
			},
		}),
	);
	updateActiveLocation(vscode.window.activeTextEditor, true);

	setTimeout(() => {
		void revealAgentsViewOnFirstActivation({
			state: context.globalState,
			revealAgentsView: revealAgentsView,
		}).catch(error => console.error('sundial-editor: failed to reveal Sundial Agents on first activation', error));
	}, 0);
}

async function revealAnnotation(sourceUri: string, sourceLine: number): Promise<void> {
	const editor = await vscode.window.showTextDocument(vscode.Uri.parse(sourceUri), { preserveFocus: true });
	const line = Math.min(sourceLine, Math.max(editor.document.lineCount - 1, 0));
	const position = new vscode.Position(line, 0);
	editor.selection = new vscode.Selection(position, position);
	editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
}

function activeWorkspaceLocation(editor: vscode.TextEditor): { sourceUri: string; line: number; cwd: string } | undefined {
	const cwd = workspaceCwdForSource(editor.document.uri);
	return cwd === undefined ? undefined : {
		sourceUri: editor.document.uri.toString(),
		line: editor.selection.active.line,
		cwd,
	};
}

function workspaceCwdForSource(uri: vscode.Uri): string | undefined {
	if (uri.scheme !== 'file') {
		return undefined;
	}
	return vscode.workspace.getWorkspaceFolder(uri)?.uri.fsPath;
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
