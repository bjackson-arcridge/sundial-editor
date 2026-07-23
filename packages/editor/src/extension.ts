import * as vscode from 'vscode';
import { revealAgentsViewOnFirstActivation } from './firstRun';
import { paneSplitPercentConfiguration } from './paneSplit';
import { executeWorkflowTextCommandId, registerPromptCommandMode, submitPromptCommandId } from './promptCompletionProvider';
import type { PromptContext } from './promptCommand';
import { submitPrompt } from './promptSubmission';
import { returnToVSCodeVimNormalMode } from './vimNormalMode';
import { MessagesWebviewProvider } from './webviews/messages/messagesWebviewProvider';
import {
	readAnnotationsViaCli,
	reanchorAnnotationsViaCli,
	repairCompanionsViaCli,
	runGitWorkflowViaCli,
	type GitWorkflowState,
} from './cliRunner';
import { DiffEditorController, type DiffBaselineAction } from './diffEditorController';
import { executeWorkflowTextCommand, type WorkflowCommandId } from './workflowTextCommand';
import { AnnotationReanchorController } from './annotationReanchorController';
import { agentTaskCommands, createAgentTask } from './agentTaskCommand';

const messagesViewId = 'sundialEditor.messages';
const agentsViewContainerId = 'sundialEditor';

export function activate(context: vscode.ExtensionContext): void {
	const diffController = new DiffEditorController({
		readState: (cwd, baseline) => runGitWorkflowViaCli(cliPath(), cwd, 'state', baseline === undefined ? {} : { baseline }),
		moveBaseline: (cwd, baseline, action) => runGitWorkflowViaCli(cliPath(), cwd, 'baseline', {
			...(baseline === undefined ? {} : { baseline }), action,
		}),
		workspaceCwd: uri => workspaceCwdForSource(uri),
		workspaceRoots: () => vscode.workspace.workspaceFolders?.map(folder => folder.uri.fsPath) ?? [],
		reportError: message => { void vscode.window.showErrorMessage(`Sundial Editor: ${message}`); },
	});
	const annotationMarker = vscode.window.createTextEditorDecorationType({
		before: {
			contentText: '●',
			color: new vscode.ThemeColor('editorInfo.foreground'),
			margin: '0 0.65em 0 0',
		},
	});
	const messagesProvider = new MessagesWebviewProvider(context.extensionUri, {
		returnToSource: returnToSource,
		workspaceRootCwd: () => vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
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
	const reanchorController = new AnnotationReanchorController({
		readAnnotations: source => readAnnotationsViaCli(cliPath(), {
			workspace: { cwd: source.cwd }, document: { uri: source.sourceUri },
		}),
		reanchor: (source, previousSource, expectedPreviousSourceDigest) => reanchorAnnotationsViaCli(cliPath(), {
			workspace: { cwd: source.cwd }, document: { uri: source.sourceUri },
			previousSource, expectedPreviousSourceDigest,
		}),
		onApplied: () => messagesProvider.refreshActiveAnnotations(),
		reportError: message => console.error(`sundial-editor: annotation re-anchor failed: ${message}`),
	});
	const annotationWatcher = vscode.workspace.createFileSystemWatcher('**/.sundial/**/*.comments');
	const updateActiveLocation = (editor: vscode.TextEditor | undefined, reload = false): void => {
		const source = diffController.activeSourceUri();
		const sourceEditor = source === undefined ? editor : vscode.window.visibleTextEditors
			.find(candidate => candidate.document.uri.toString() === source.toString()) ?? editor;
		const location = source === undefined || sourceEditor === undefined
			? undefined
			: activeWorkspaceLocation(source, sourceEditor.selection.active.line);
		void messagesProvider.setActiveLocation(location, reload);
	};
	context.subscriptions.push(
		diffController,
		{ dispose: () => reanchorController.dispose() },
		vscode.window.registerWebviewViewProvider(messagesViewId, messagesProvider),
		vscode.workspace.onDidChangeConfiguration(event => {
			if (event.affectsConfiguration(paneSplitPercentConfiguration)) {
				messagesProvider.refreshPaneSplitPercent();
			}
			if (event.affectsConfiguration('sundialEditor.cliPath')) {
				void messagesProvider.refreshAgentState();
			}
			if (event.affectsConfiguration('diffEditor.renderSideBySide')) {
				syncDiffPresentation();
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
		...agentTaskCommands.map(command => vscode.commands.registerCommand(command.id, () => createAgentTask(command, {
			activeTextEditor: () => vscode.window.activeTextEditor,
			reportValidationFailure: message => vscode.window.showWarningMessage(message),
			openComposer: prompt => messagesProvider.openPrompt(prompt),
			workspaceCwd: sourceUri => workspaceCwdForSource(vscode.Uri.parse(sourceUri)),
			validatePrompt: (prompt, cwd) => messagesProvider.validatePromptTarget(prompt, cwd),
		}))),
		vscode.commands.registerCommand(executeWorkflowTextCommandId, (commandId: WorkflowCommandId) => executeWorkflowTextCommand(commandId, {
			activeTextEditor: () => vscode.window.activeTextEditor,
			createDeletionRange: range => new vscode.Range(
				new vscode.Position(range.start.line, range.start.character),
				new vscode.Position(range.end.line, range.end.character),
			),
			executeCommand: id => vscode.commands.executeCommand(id),
			reportValidationFailure: message => vscode.window.showWarningMessage(message),
		})),
		vscode.commands.registerCommand('sundialEditor.internal.messagesDiagnostics', () => messagesProvider.diagnostics()),
		vscode.commands.registerCommand('sundialEditor.internal.submitPendingMessage', (message?: string) => messagesProvider.submitPendingMessage(message)),
		vscode.commands.registerCommand('sundialEditor.internal.cancelPendingMessage', () => messagesProvider.cancelPendingMessage()),
		vscode.commands.registerCommand('sundialEditor.internal.toggleAnnotationPin', () => messagesProvider.toggleAnnotationPin()),
		vscode.commands.registerCommand('sundialEditor.internal.toggleAnnotationFilter', () => messagesProvider.toggleAnnotationFilter()),
		vscode.commands.registerCommand('sundialEditor.internal.openAnnotation', link => messagesProvider.openLinkedAnnotation(link)),
		vscode.commands.registerCommand('sundialEditor.internal.previousAnnotation', () => messagesProvider.selectAdjacentAnnotation(-1)),
		vscode.commands.registerCommand('sundialEditor.internal.nextAnnotation', () => messagesProvider.selectAdjacentAnnotation(1)),
		vscode.commands.registerCommand('sundialEditor.internal.respondToAnnotation', () => messagesProvider.respondToViewedAnnotation()),
		vscode.commands.registerCommand('sundialEditor.internal.deleteAnnotation', () => messagesProvider.deleteViewedAnnotation(true)),
		vscode.commands.registerCommand('sundialEditor.internal.diffDiagnostics', () => diffController.diagnostics()),
		vscode.commands.registerCommand('sundialEditor.diff.toggle', () => toggleDiff()),
		vscode.commands.registerCommand('sundialEditor.diff.inline', () => toggleInlineDiff()),
		vscode.commands.registerCommand('sundialEditor.diff.previous', () => moveBaseline('previous')),
		vscode.commands.registerCommand('sundialEditor.diff.next', () => moveBaseline('next')),
		vscode.commands.registerCommand('sundialEditor.diff.head', () => moveBaseline('head')),
		vscode.commands.registerCommand('sundialEditor.diff.permanent', () => moveBaseline('permanent')),
		vscode.commands.registerCommand('sundialEditor.commit.file', () => checkpoint(false)),
		vscode.commands.registerCommand('sundialEditor.commit.all', () => checkpoint(true)),
		vscode.commands.registerCommand('sundialEditor.commit.message', () => consolidate()),
		vscode.commands.registerCommand('sundialEditor.companions.repair', () => repairCompanions()),
		vscode.window.onDidChangeActiveTextEditor(editor => {
			updateActiveLocation(editor, true);
			observeActiveSavedSource();
		}),
		vscode.workspace.onDidSaveTextDocument(document => {
			const activeSource = diffController.activeSourceUri() ?? vscode.window.activeTextEditor?.document.uri;
			if (activeSource?.toString() === document.uri.toString()) { observeSavedDocument(document); }
		}),
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

	async function workflowCwd(): Promise<string | undefined> {
		const cwd = diffController.currentWorkspaceCwd();
		if (cwd === undefined) { await vscode.window.showWarningMessage('Sundial Editor: Select a workspace file first.'); }
		return cwd;
	}
	async function toggleDiff(): Promise<void> {
		try {
			const enabled = await diffController.toggle();
			syncDiffPresentation();
			void vscode.window.showInformationMessage(`Sundial Editor: Diff view ${enabled ? 'enabled' : 'disabled'}.`);
		} catch (error) { await vscode.window.showErrorMessage(`Sundial Editor: ${errorMessage(error)}`); }
	}
	async function toggleInlineDiff(): Promise<void> {
		try {
			const inline = await diffController.toggleInline();
			await returnToVimNormalMode();
			syncDiffPresentation();
			void vscode.window.showInformationMessage(`Sundial Editor: Diff view is now ${inline ? 'inline' : 'side by side'}.`);
		} catch (error) { await vscode.window.showErrorMessage(`Sundial Editor: ${errorMessage(error)}`); }
	}
	async function moveBaseline(action: DiffBaselineAction): Promise<void> {
		try {
			const state = await diffController.moveBaseline(action);
			syncDiffPresentation(state);
			void vscode.window.showInformationMessage(`Sundial Editor: Diff baseline ${state.baseline.slice(0, 8)}.`);
		}
		catch (error) { await vscode.window.showErrorMessage(`Sundial Editor: ${errorMessage(error)}`); }
	}
	async function checkpoint(all: boolean): Promise<void> {
		const cwd = await workflowCwd(); if (cwd === undefined) { return; }
		try {
			const source = diffController.activeSourceUri();
			const state = await runGitWorkflowViaCli(cliPath(), cwd, all ? 'checkpoint-all' : 'checkpoint-file', all ? {} : { file: source?.fsPath });
			await refreshWorkflowPresentation(cwd, state);
			void vscode.window.showInformationMessage(`Sundial Editor: Created temporary checkpoint for ${state.affectedPaths.length} file(s).`);
		} catch (error) { await vscode.window.showErrorMessage(`Sundial Editor: ${errorMessage(error)}`); }
	}
	async function consolidate(): Promise<void> {
		const cwd = await workflowCwd(); if (cwd === undefined) { return; }
		const message = await vscode.window.showInputBox({ prompt: 'Commit message', validateInput: value => value.trim() === '' ? 'A commit message is required.' : undefined });
		if (message === undefined) { return; }
		try {
			const state = await runGitWorkflowViaCli(cliPath(), cwd, 'consolidate', { message });
			await refreshWorkflowPresentation(cwd, state);
			void vscode.window.showInformationMessage('Sundial Editor: Created permanent commit.');
		}
		catch (error) { await vscode.window.showErrorMessage(`Sundial Editor: ${errorMessage(error)}`); }
	}
	async function repairCompanions(): Promise<void> {
		const cwd = await workflowCwd(); if (cwd === undefined) { return; }
		try {
			const result = await repairCompanionsViaCli(cliPath(), cwd);
			const state = await runGitWorkflowViaCli(cliPath(), cwd, 'state', {});
			await refreshWorkflowPresentation(cwd, state);
			void vscode.window.showInformationMessage(result.actions.length === 0
				? 'Sundial Editor: Companion files already match Git moves and deletes.'
				: `Sundial Editor: Repaired ${result.actions.length} companion file operation(s).`);
		} catch (error) { await vscode.window.showErrorMessage(`Sundial Editor: ${errorMessage(error)}`); }
	}
	async function refreshWorkflowPresentation(cwd: string, state: GitWorkflowState): Promise<void> {
		await diffController.acceptWorkflowState(cwd, state);
		syncDiffPresentation(state);
		await Promise.all([
			messagesProvider.refreshAgentState(cwd),
			messagesProvider.refreshActiveAnnotations(),
			messagesProvider.refreshAnnotationIndex(cwd),
		]);
	}
	function syncDiffPresentation(state?: GitWorkflowState): void {
		const diagnostics = diffController.diagnostics();
		messagesProvider.setDiffPresentation({
			diffEnabled: diagnostics.enabled,
			diffLayout: diagnostics.renderSideBySide ? 'side-by-side' : 'inline',
			...(state?.baseline === undefined && diagnostics.baseline === undefined ? {} : { baseline: state?.baseline ?? diagnostics.baseline }),
			...(state === undefined ? {} : { currentPermanentCommit: state.lastPermanentCommit }),
		});
	}
	function cliPath(): string { return vscode.workspace.getConfiguration('sundialEditor').get<string>('cliPath', 'sundial-editor-cli'); }
	function observeActiveSavedSource(): void {
		const source = diffController.activeSourceUri() ?? vscode.window.activeTextEditor?.document.uri;
		if (source === undefined) { return; }
		const document = vscode.workspace.textDocuments.find(candidate => candidate.uri.toString() === source.toString());
		if (document !== undefined && !document.isDirty) { observeSavedDocument(document); }
	}
	function observeSavedDocument(document: vscode.TextDocument): void {
		const cwd = workspaceCwdForSource(document.uri);
		if (cwd !== undefined && document.uri.scheme === 'file' && !document.isDirty) {
			reanchorController.observeSaved({ cwd, sourceUri: document.uri.toString(), text: document.getText() });
		}
	}
	syncDiffPresentation();
	updateActiveLocation(vscode.window.activeTextEditor, true);
	observeActiveSavedSource();

	setTimeout(() => {
		void revealAgentsViewOnFirstActivation({
			state: context.globalState,
			revealAgentsView: revealAgentsView,
		}).catch(error => console.error('sundial-editor: failed to reveal Sundial Agents on first activation', error));
	}, 0);
}

function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }

async function revealAnnotation(sourceUri: string, sourceLine: number | null, preserveFocus = true): Promise<void> {
	const editor = await vscode.window.showTextDocument(vscode.Uri.parse(sourceUri), { preserveFocus });
	if (sourceLine === null) { return; }
	const line = Math.min(sourceLine, Math.max(editor.document.lineCount - 1, 0));
	const position = new vscode.Position(line, 0);
	editor.selection = new vscode.Selection(position, position);
	editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
}

function activeWorkspaceLocation(sourceUri: vscode.Uri, line: number): { sourceUri: string; line: number; cwd: string } | undefined {
	const cwd = workspaceCwdForSource(sourceUri);
	return cwd === undefined ? undefined : {
		sourceUri: sourceUri.toString(),
		line,
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
		await returnToVimNormalMode();
		await new Promise(resolve => setTimeout(resolve, 0));
		await vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');
	} catch {
		void vscode.window.showWarningMessage('Sundial Editor: The originating document is no longer available.');
	}
}

async function returnToVimNormalMode(): Promise<void> {
	await returnToVSCodeVimNormalMode({
		getExtension: extensionId => vscode.extensions.getExtension(extensionId),
		executeCommand: commandId => vscode.commands.executeCommand(commandId),
		reportFailure: error => console.error('sundial-editor: failed to return VSCodeVim to Normal mode', error),
	});
}
