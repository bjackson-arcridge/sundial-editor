import * as assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as vscode from 'vscode';

interface MessagesDiagnostics {
	readonly annotationMarkerLines: readonly number[];
	readonly state: {
		readonly annotationViewer?: {
			readonly annotation: { readonly id: string; readonly anchor: { readonly line: number | null; readonly text: string } };
		};
	};
}

suite('Scenario: annotation-reanchor', () => {
	test('adopts the saved source and retains an out-of-range annotation at file scope', async () => {
		const extension = vscode.extensions.getExtension('arcridge.sundial-editor');
		if (extension === undefined) { throw new Error('Expected Sundial Editor extension to be loaded'); }
		await extension.activate();
		const workspace = vscode.workspace.workspaceFolders?.[0];
		if (workspace === undefined) { throw new Error('Expected the staged re-anchor workspace'); }
		const source = vscode.Uri.joinPath(workspace.uri, 'source.txt');
		const editor = await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(source));
		editor.selection = new vscode.Selection(1, 0, 1, 0);

		const adopted = await waitForDiagnostics(value => value.state.annotationViewer?.annotation.id === 'line-note'
			&& value.state.annotationViewer.annotation.anchor.text === 'second line');
		assert.deepEqual(adopted.annotationMarkerLines, [1]);
		await vscode.commands.executeCommand('sundialEditor.internal.nextAnnotation');
		const fileScoped = await waitForDiagnostics(value => value.state.annotationViewer?.annotation.id === 'file-note');
		assert.equal(fileScoped.state.annotationViewer?.annotation.anchor.line, null);

		const companion = await readFile(vscode.Uri.joinPath(workspace.uri, '.sundial', 'source.txt.comments').fsPath, 'utf8');
		assert.doesNotMatch(companion, /sourceDigest: 0{64}/);
		assert.match(companion, /"id":"file-note"[^\n]+"line":null/);
	});
});

async function waitForDiagnostics(
	predicate: (value: MessagesDiagnostics) => boolean,
	timeoutMs = 10_000,
): Promise<MessagesDiagnostics> {
	const started = Date.now();
	let latest: MessagesDiagnostics | undefined;
	while (Date.now() - started < timeoutMs) {
		latest = await vscode.commands.executeCommand<MessagesDiagnostics>('sundialEditor.internal.messagesDiagnostics');
		if (latest !== undefined && predicate(latest)) { return latest; }
		await new Promise(resolve => setTimeout(resolve, 100));
	}
	throw new Error(`Timed out waiting for re-anchor diagnostics: ${JSON.stringify(latest)}`);
}
