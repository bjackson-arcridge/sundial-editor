import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';

suite('Scenario: delayed-autosave', () => {
	test('uses the contributed one-second default to save without an explicit save command', async () => {
		const extension = vscode.extensions.getExtension('arcridge.sundial-editor');
		if (extension === undefined) {
			throw new Error('Expected Sundial Editor extension to be loaded');
		}

		await extension.activate();
		const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
		if (workspaceFolder === undefined) {
			throw new Error('Expected the staged autosave workspace');
		}

		const uri = vscode.Uri.joinPath(workspaceFolder.uri, 'autosave.txt');
		const document = await vscode.workspace.openTextDocument(uri);
		const configuration = vscode.workspace.getConfiguration('files', uri);
		assert.equal(configuration.get('autoSave'), 'afterDelay');
		assert.equal(configuration.get('autoSaveDelay'), 1000);

		const editor = await vscode.window.showTextDocument(document);
		const marker = `saved-${Date.now()}`;
		const changed = await editor.edit(edit => edit.replace(new vscode.Range(0, 0, 0, document.lineAt(0).text.length), marker));
		assert.equal(changed, true);

		await waitForSavedText(uri.fsPath, marker);
	});
});

async function waitForSavedText(filePath: string, expected: string, timeoutMs = 6000): Promise<void> {
	const started = Date.now();
	let latest = '';
	while (Date.now() - started < timeoutMs) {
		latest = await fs.readFile(filePath, 'utf8');
		if (latest.startsWith(expected)) {
			return;
		}

		await new Promise(resolve => setTimeout(resolve, 100));
	}

	throw new Error(`Timed out waiting for auto-save. Latest file content: ${JSON.stringify(latest)}`);
}
