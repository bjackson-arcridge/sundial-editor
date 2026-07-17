import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';

interface MessagesDiagnostics {
	readonly viewResolved: boolean;
	readonly viewVisible: boolean;
	readonly state: {
		readonly kind: string;
		readonly prompt?: {
			readonly preset: string;
			readonly scope: string;
			readonly sourceLine: number;
			readonly sourceText: string;
		};
		readonly draft?: string;
	};
}

suite('Scenario: prompt-to-messages', () => {
	test('populates Messages and returns keyboard focus to the source editor', async () => {
		const extension = vscode.extensions.getExtension('arcridge.sundial-editor');
		if (extension === undefined) {
			throw new Error('Expected Sundial Editor extension to be loaded');
		}

		await extension.activate();
		const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
		if (workspaceFolder === undefined) {
			throw new Error('Expected the staged prompt workspace');
		}

		const uri = vscode.Uri.joinPath(workspaceFolder.uri, 'prompt.txt');
		const document = await vscode.workspace.openTextDocument(uri);
		const editor = await vscode.window.showTextDocument(document);
		editor.selection = new vscode.Selection(0, 1, 0, 1);

		const completionList = await vscode.commands.executeCommand<vscode.CompletionList>(
			'vscode.executeCompletionItemProvider',
			uri,
			new vscode.Position(0, 1),
			'%',
		);
		const fixCompletion = completionList.items.find(item => item.label === '%F');
		assert.ok(fixCompletion, 'Expected the %F command completion');
		assert.equal(fixCompletion.command?.command, 'sundialEditor.submitPrompt');

		editor.selection = new vscode.Selection(0, document.lineAt(0).text.length, 0, document.lineAt(0).text.length);
		await vscode.commands.executeCommand('sundialEditor.submitPrompt');

		assert.equal(document.lineAt(0).text, 'keep this line');
		const diagnostics = await waitForMessagesState();
		assert.equal(diagnostics.viewResolved, true);
		assert.equal(diagnostics.viewVisible, true);
		assert.deepEqual(diagnostics.state, {
			kind: 'state',
			prompt: {
				preset: '%F',
				scope: 'line',
				sourceUri: uri.toString(),
				sourceLine: 0,
				sourceText: '%F',
			},
			draft: '[Integration stub] Sundial received %F for source line 1.',
		});

		await vscode.commands.executeCommand('sundialEditor.internal.submitPendingMessage');
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
