import * as assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as vscode from 'vscode';

interface MessagesDiagnostics {
	readonly viewResolved: boolean;
	readonly viewVisible: boolean;
	readonly annotationMarkerLines: readonly number[];
	readonly state: {
		readonly agents: { readonly kind: string; readonly agents?: readonly { readonly id: string; readonly name: string }[] };
		readonly work: readonly {
			readonly id: string; readonly agentId: string; readonly status: 'waiting' | 'working' | 'completed';
			readonly latestUpdate?: { readonly message: string };
			readonly assignment?: { readonly sequence: number };
		}[];
		readonly prompt?: {
			readonly preset: string;
			readonly scope: string;
			readonly targetSelector?: { readonly kind: string; readonly slot?: number; readonly name?: string };
			readonly sourceUri: string;
			readonly sourceLine: number;
			readonly sourceText: string;
			readonly anchorText: string;
			readonly anchorBefore: readonly string[];
			readonly anchorAfter: readonly string[];
		};
		readonly draft?: string;
		readonly targetAgentId?: string;
		readonly annotationViewer?: {
			readonly sourceUri: string;
			readonly annotation: {
				readonly id: string; readonly message: string;
				readonly anchor: { readonly text: string; readonly before: readonly string[]; readonly after: readonly string[] };
				readonly officialResponses: readonly { readonly body: string; readonly createdAt: string; readonly agentName: string }[];
			};
			readonly position: number;
			readonly total: number;
			readonly pinned: boolean;
		};
	};
}

suite('Scenario: prompt-to-messages', () => {
	test('populates Messages and returns keyboard focus to the source editor', async () => {
		const extension = vscode.extensions.getExtension('arcridge.sundial-editor');
		if (extension === undefined) {
			throw new Error('Expected Sundial Editor extension to be loaded');
		}

		await extension.activate();
		await waitForMessagesViewReady();
		const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
		if (workspaceFolder === undefined) {
			throw new Error('Expected the staged prompt workspace');
		}
		const startupState = await waitForAgentState(state => state.agents.kind === 'ready');
		assert.equal(startupState.state.agents.kind, 'ready');
		assert.ok((startupState.state.agents.agents?.length ?? 0) > 0);

		const uri = vscode.Uri.joinPath(workspaceFolder.uri, 'prompt.txt');
		const testableCli = vscode.Uri.joinPath(workspaceFolder.uri, 'testable-cli.js');
		await vscode.workspace.getConfiguration('sundialEditor').update('cliPath', testableCli.fsPath, vscode.ConfigurationTarget.Workspace);
		await waitForAgentState(state => state.agents.kind === 'ready'
			&& state.agents.agents?.map(agent => agent.name).join(',') === 'Bob,Amy');
		const document = await vscode.workspace.openTextDocument(uri);
		const editor = await vscode.window.showTextDocument(document);
		editor.selection = new vscode.Selection(1, 1, 1, 1);

		const presetCompletionList = await vscode.commands.executeCommand<vscode.CompletionList>(
			'vscode.executeCompletionItemProvider',
			uri,
			new vscode.Position(1, 2),
			'%',
		);
		const targetChoices = presetCompletionList.items.filter(item => String(item.label).startsWith('%F>'));
		assert.deepEqual(targetChoices.map(item => item.label), ['%F>1', '%F>1@G', '%F>2', '%F>2@G']);
		assert.match(targetChoices[0].detail ?? '', /Bob \(agent 1\)/);

		const completionList = await vscode.commands.executeCommand<vscode.CompletionList>(
			'vscode.executeCompletionItemProvider',
			uri,
			new vscode.Position(1, document.lineAt(1).text.length),
			'%',
		);
		const fixCompletion = completionList.items.find(item => item.label === '%F>1');
		assert.ok(fixCompletion, 'Expected the targeted %F>1 command completion');
		assert.equal(fixCompletion.insertText, '%F>1');
		assert.equal(fixCompletion.command?.command, 'sundialEditor.submitPrompt');

		editor.selection = new vscode.Selection(1, document.lineAt(1).text.length, 1, document.lineAt(1).text.length);
		await vscode.commands.executeCommand(fixCompletion.command.command);

		assert.equal(document.lineAt(0).text, 'code before the command');
		assert.equal(document.lineAt(1).text, 'keep this line');
		const diagnostics = await waitForMessagesState();
		assert.equal(diagnostics.viewResolved, true);
		assert.equal(diagnostics.viewVisible, true);
		assert.equal(diagnostics.state.agents.kind, 'ready');
		assert.deepEqual(diagnostics.state.agents.agents?.map(agent => agent.name), ['Bob', 'Amy']);
		assert.deepEqual(diagnostics.state.work, []);
		assert.deepEqual(diagnostics.state.prompt, {
			preset: '%F',
			scope: 'line',
			targetSelector: { kind: 'slot', slot: 1 },
			sourceUri: uri.toString(),
			sourceLine: 0,
			sourceText: '%F>1',
				anchorText: 'code before the command',
				anchorBefore: [],
				anchorAfter: ['keep this line', 'and this second line'],
		});
		assert.equal(diagnostics.state.draft, '');
		assert.equal(diagnostics.state.targetAgentId, 'agent-bob');

		const submission = vscode.commands.executeCommand('sundialEditor.internal.submitPendingMessage', 'Fix this through the test provider.');
		const savedDuringRun = await waitForAnnotationState(state => state.annotationViewer?.annotation.message === 'Fix this through the test provider.');
		assert.deepEqual(savedDuringRun.annotationMarkerLines, [0]);
		await submission;
		const completed = await waitForCompletedRun(1);
		assert.equal(completed.state.work[0].status, 'completed');
		assert.equal(completed.state.work[0].latestUpdate?.message, 'Official response recorded.');
		const responded = await waitForAnnotationState(state => state.annotationViewer?.annotation.officialResponses.length === 1);
		assert.equal(responded.state.annotationViewer?.annotation.officialResponses[0].agentName, 'Bob');
		assert.match(responded.state.annotationViewer?.annotation.officialResponses[0].body ?? '', /Applied the requested test patch/);

		const companionPath = vscode.Uri.joinPath(workspaceFolder.uri, '.sundial', 'prompt.txt.comments').fsPath;
		const companionYaml = await readFile(companionPath, 'utf8');
		assert.match(companionYaml, /^version: 4\nannotations:\n/);
		assert.match(companionYaml, /"permanentBaseCommit":"[0-9a-f]{40}"/);
		assert.match(companionYaml, /"message":"Fix this through the test provider\."/);
		assert.match(companionYaml, /"text":"code before the command"/);
		assert.match(companionYaml, /"before":\[\]/);
		assert.match(companionYaml, /"after":\["keep this line","and this second line"\]/);
		assert.match(companionYaml, /"officialResponses":\[/);
		assert.match(companionYaml, /"agentSessionId":"session-bob"/);
		await assert.rejects(() => readFile(vscode.Uri.joinPath(workspaceFolder.uri, '.sundial', `${completed.state.work[0].id}response.md`).fsPath));

		const received = JSON.parse(await readFile(vscode.Uri.joinPath(workspaceFolder.uri, 'received-request.json').fsPath, 'utf8'));
		assert.equal(received.provider, 'codex');
		assert.equal(received.workspace.cwd, workspaceFolder.uri.fsPath);
		assert.deepEqual(received.managed, {
			agentId: 'agent-bob', agentSessionId: 'session-bob', userAnnotationId: completed.state.work[0].id,
			assignmentSequence: completed.state.work[0].assignment?.sequence,
		});
		assert.equal(received.document, undefined);
		assert.equal(received.prompt, undefined);
		const persistedState = JSON.parse(await readFile(vscode.Uri.joinPath(workspaceFolder.uri, '.test-agent-state.json').fsPath, 'utf8'));
		assert.deepEqual(persistedState.work[0].source, {
			uri: uri.toString(), line: 0, text: 'code before the command',
			before: [], after: ['keep this line', 'and this second line'],
		});
		assert.deepEqual(persistedState.work[0].prompt, {
			preset: '%F', scope: 'line', text: 'Fix this through the test provider.',
		});

		const returnedEditor = vscode.window.activeTextEditor;
		assert.ok(returnedEditor, 'Expected focus to return to a text editor after submission');
		assert.equal(returnedEditor.document.uri.toString(), uri.toString());
		assert.equal(returnedEditor.selection.active.line, 0);
		assert.equal(returnedEditor.selection.active.character, 0);

		await vscode.commands.executeCommand('cursorRight');
		assert.equal(returnedEditor.selection.active.line, 0);
		assert.equal(
			returnedEditor.selection.active.character,
			1,
			'Expected an editor keyboard command to move the restored source cursor',
		);

		const viewed = await waitForAnnotationState(state => state.annotationViewer?.annotation.message === 'Fix this through the test provider.');
		assert.equal(viewed.state.annotationViewer?.annotation.anchor.text, 'code before the command');
		assert.deepEqual(viewed.state.annotationViewer?.annotation.anchor.before, []);
		assert.deepEqual(viewed.state.annotationViewer?.annotation.anchor.after, ['keep this line', 'and this second line']);
		const annotationId = viewed.state.annotationViewer?.annotation.id;
		assert.ok(annotationId);

		returnedEditor.selection = new vscode.Selection(1, 0, 1, 0);
		const retained = await waitForAnnotationState(state => state.annotationViewer?.annotation.id === annotationId);
		assert.equal(retained.state.annotationViewer?.pinned, false, 'Expected the last viewed annotation to remain without explicit pinning');
		await returnedEditor.edit(edit => edit.insert(
			new vscode.Position(2, returnedEditor.document.lineAt(2).text.length),
			'\n%Q>2',
		));
		returnedEditor.selection = new vscode.Selection(3, 4, 3, 4);
		await vscode.commands.executeCommand('sundialEditor.submitPrompt');
		assert.equal((await waitForMessagesState()).state.targetAgentId, 'agent-amy');
		await vscode.commands.executeCommand('sundialEditor.internal.submitPendingMessage', 'Explain the second source line.');
		const secondViewed = await waitForAnnotationState(state => state.annotationViewer?.annotation.message === 'Explain the second source line.');
		assert.equal(secondViewed.state.annotationViewer?.position, 2);
		assert.equal(secondViewed.state.annotationViewer?.total, 2);
		const secondAnnotationId = secondViewed.state.annotationViewer?.annotation.id;
		assert.ok(secondAnnotationId);
		const secondCompleted = await waitForCompletedRun(2);
		assert.equal(secondCompleted.state.work.find(work => work.id === secondAnnotationId)?.agentId, 'agent-amy');
		const secondReceived = JSON.parse(await readFile(vscode.Uri.joinPath(workspaceFolder.uri, 'received-request.json').fsPath, 'utf8'));
		assert.equal(secondReceived.managed.agentId, 'agent-amy');
		assert.equal(secondReceived.managed.agentSessionId, 'session-amy');

		await vscode.commands.executeCommand('sundialEditor.internal.previousAnnotation');
		const previous = await waitForAnnotationState(state => state.annotationViewer?.annotation.id === annotationId);
		assert.equal(previous.state.annotationViewer?.position, 1);
		await vscode.commands.executeCommand('sundialEditor.internal.nextAnnotation');
		await waitForAnnotationState(state => state.annotationViewer?.annotation.id === secondAnnotationId);

		await vscode.commands.executeCommand('sundialEditor.internal.toggleAnnotationPin');
		await waitForAnnotationState(state => state.annotationViewer?.pinned === true);
		returnedEditor.selection = new vscode.Selection(0, 0, 0, 0);
		assert.equal((await waitForAnnotationState(state => state.annotationViewer?.pinned === true)).state.annotationViewer?.annotation.id, secondAnnotationId);
		await vscode.commands.executeCommand('sundialEditor.internal.toggleAnnotationPin');
		await waitForAnnotationState(state => state.annotationViewer?.annotation.id === annotationId && state.annotationViewer.pinned === false);

		await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
		const reopenedEditor = await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uri));
		reopenedEditor.selection = new vscode.Selection(2, 0, 2, 0);
		const reopened = await waitForAnnotationState(state => state.annotationViewer?.annotation.id === secondAnnotationId);
		assert.equal(reopened.state.annotationViewer?.annotation.message, 'Explain the second source line.');
		assert.equal(reopened.state.annotationViewer?.annotation.officialResponses[0].agentName, 'Amy');

		await vscode.commands.executeCommand('sundialEditor.internal.deleteAnnotation');
		const afterDelete = await waitForAnnotationState(state => state.annotationViewer?.annotation.id === annotationId
			&& state.annotationViewer.total === 1
			&& state.work.every(work => work.id !== secondAnnotationId));
		assert.deepEqual(afterDelete.annotationMarkerLines, [0]);
		assert.deepEqual(afterDelete.state.work.map(work => work.id), [annotationId]);
		const afterDeleteYaml = await readFile(companionPath, 'utf8');
		assert.match(afterDeleteYaml, /Fix this through the test provider/);
		assert.doesNotMatch(afterDeleteYaml, /Explain the second source line/);
		assert.doesNotMatch(afterDeleteYaml, /agentSessionId: "session-amy"/);
	});
});

async function waitForMessagesState(timeoutMs = 6000): Promise<MessagesDiagnostics> {
	const started = Date.now();
	let latest: MessagesDiagnostics | undefined;
	while (Date.now() - started < timeoutMs) {
		latest = await vscode.commands.executeCommand<MessagesDiagnostics>('sundialEditor.internal.messagesDiagnostics');
		if (latest.viewResolved && latest.viewVisible && latest.state.prompt !== undefined) {
			return latest;
		}

		await new Promise(resolve => setTimeout(resolve, 100));
	}

	throw new Error(`Timed out waiting for Messages state: ${JSON.stringify(latest)}`);
}

async function waitForAgentState(predicate: (state: MessagesDiagnostics['state']) => boolean, timeoutMs = 6000): Promise<MessagesDiagnostics> {
	const started = Date.now();
	let latest: MessagesDiagnostics | undefined;
	while (Date.now() - started < timeoutMs) {
		latest = await vscode.commands.executeCommand<MessagesDiagnostics>('sundialEditor.internal.messagesDiagnostics');
		if (latest.viewResolved && latest.viewVisible && predicate(latest.state)) {
			return latest;
		}

		await new Promise(resolve => setTimeout(resolve, 100));
	}

	throw new Error(`Timed out waiting for agent state: ${JSON.stringify(latest)}`);
}

async function waitForMessagesViewReady(timeoutMs = 6000): Promise<void> {
	const started = Date.now();
	while (Date.now() - started < timeoutMs) {
		const diagnostics = await vscode.commands.executeCommand<MessagesDiagnostics>('sundialEditor.internal.messagesDiagnostics');
		if (diagnostics.viewResolved && diagnostics.viewVisible) {
			// Let the first-run reveal finish its focus command before opening the source editor.
			await new Promise(resolve => setTimeout(resolve, 50));
			return;
		}
		await new Promise(resolve => setTimeout(resolve, 25));
	}
	throw new Error('Timed out waiting for the first-run Messages view reveal');
}

async function waitForCompletedRun(completedCount: number, timeoutMs = 6000): Promise<MessagesDiagnostics> {
	const started = Date.now();
	let latest: MessagesDiagnostics | undefined;
	while (Date.now() - started < timeoutMs) {
		latest = await vscode.commands.executeCommand<MessagesDiagnostics>('sundialEditor.internal.messagesDiagnostics');
		if (latest.state.prompt === undefined && latest.state.work.filter(work => work.status === 'completed').length >= completedCount) {
			return latest;
		}
		await new Promise(resolve => setTimeout(resolve, 50));
	}
	throw new Error(`Timed out waiting for completed agent run: ${JSON.stringify(latest)}`);
}

async function waitForAnnotationState(
	predicate: (state: MessagesDiagnostics['state']) => boolean,
	timeoutMs = 6000,
): Promise<MessagesDiagnostics> {
	const started = Date.now();
	let latest: MessagesDiagnostics | undefined;
	while (Date.now() - started < timeoutMs) {
		latest = await vscode.commands.executeCommand<MessagesDiagnostics>('sundialEditor.internal.messagesDiagnostics');
		if (predicate(latest.state)) {
			return latest;
		}
		await new Promise(resolve => setTimeout(resolve, 50));
	}
	throw new Error(`Timed out waiting for annotation state: ${JSON.stringify(latest)}`);
}
