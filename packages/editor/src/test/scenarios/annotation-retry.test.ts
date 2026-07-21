import * as assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as vscode from 'vscode';

interface MessagesDiagnostics {
	readonly state: {
		readonly prompt?: unknown;
		readonly work: readonly {
			readonly id: string;
			readonly status: string;
			readonly ready: boolean;
			readonly prompt: { readonly text: string };
		}[];
		readonly notice?: { readonly tone: string; readonly message: string };
	};
}

suite('Scenario: annotation-retry', () => {
	test('retries a failed annotation append without delivering the message again', async () => {
		const extension = vscode.extensions.getExtension('arcridge.sundial-editor');
		const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
		if (extension === undefined || workspaceFolder === undefined) {
			throw new Error('Expected the extension and staged retry workspace');
		}
		await extension.activate();
		const testableCli = vscode.Uri.joinPath(workspaceFolder.uri, 'testable-cli.js');
		await vscode.workspace.getConfiguration('sundialEditor').update('cliPath', testableCli.fsPath, vscode.ConfigurationTarget.Workspace);
		const uri = vscode.Uri.joinPath(workspaceFolder.uri, 'prompt.txt');
		const editor = await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uri));
		editor.selection = new vscode.Selection(0, 0, 0, 0);
		await vscode.commands.executeCommand('sundialEditor.submitPrompt');
		await vscode.commands.executeCommand('sundialEditor.internal.submitPendingMessage', 'Persist this once.');

		const failedSave = await waitForState(state => state.prompt !== undefined && state.notice?.tone === 'error');
		assert.notEqual(failedSave.state.prompt, undefined);
		assert.match(failedSave.state.notice?.message ?? '', /Retry preserves its identity/);
		await assert.rejects(readFile(vscode.Uri.joinPath(workspaceFolder.uri, 'delivery-count.txt').fsPath, 'utf8'), /ENOENT/);
		const failedStore = JSON.parse(await readFile(vscode.Uri.joinPath(workspaceFolder.uri, '.test-agent-state.json').fsPath, 'utf8'));
		assert.equal(failedStore.work.length, 1);
		assert.equal(failedStore.work[0].status, 'waiting');
		assert.equal(failedStore.work[0].ready, false);
		assert.equal(failedStore.work[0].prompt.text, 'Persist this once.');

		await vscode.commands.executeCommand('sundialEditor.internal.submitPendingMessage', 'This replacement must not be sent.');
		const completed = await waitForState(state => state.prompt === undefined && state.work.some(work => work.status === 'completed'));
		assert.equal(completed.state.work.length, 1);
		assert.equal(completed.state.work[0].id, failedStore.work[0].id);
		assert.equal(completed.state.work[0].ready, true);
		assert.equal(completed.state.work[0].prompt.text, 'Persist this once.');
		assert.equal(await readFile(vscode.Uri.joinPath(workspaceFolder.uri, 'delivery-count.txt').fsPath, 'utf8'), '1');
		const companion = await readFile(vscode.Uri.joinPath(workspaceFolder.uri, '.sundial', 'prompt.txt.comments').fsPath, 'utf8');
		assert.match(companion, /"message":"Persist this once\."/);
		assert.doesNotMatch(companion, /replacement/);

		const sourceEditor = vscode.window.activeTextEditor;
		assert.ok(sourceEditor);
		await sourceEditor.edit(edit => edit.insert(new vscode.Position(0, 0), '%Q\n'));
		sourceEditor.selection = new vscode.Selection(0, 0, 0, 0);
		await vscode.commands.executeCommand('sundialEditor.submitPrompt');
		assert.equal(await readFile(vscode.Uri.joinPath(workspaceFolder.uri, '.sundial', 'prompt.txt.comments').fsPath, 'utf8'), companion);
		await vscode.commands.executeCommand('sundialEditor.internal.cancelPendingMessage');
		await waitForState(state => state.prompt === undefined);
		assert.equal(await readFile(vscode.Uri.joinPath(workspaceFolder.uri, 'delivery-count.txt').fsPath, 'utf8'), '1');
		assert.equal(await readFile(vscode.Uri.joinPath(workspaceFolder.uri, '.sundial', 'prompt.txt.comments').fsPath, 'utf8'), companion);
	});
});

async function waitForState(
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
	throw new Error(`Timed out waiting for retry state: ${JSON.stringify(latest)}`);
}
