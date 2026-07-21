import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';

interface DiffDiagnostics {
	readonly enabled: boolean;
	readonly cwd?: string;
	readonly baseline?: string;
	readonly renderSideBySide: boolean;
	readonly managedDiffs: readonly {
		readonly sourceUri: string;
		readonly baseline: string;
		readonly viewColumn: vscode.ViewColumn;
		readonly active: boolean;
	}[];
}

suite('Scenario: diff-workflow', () => {
	test('replaces and restores workspace editors while preserving global diff state', async function () {
		this.timeout(45_000);
		const extension = vscode.extensions.getExtension('arcridge.sundial-editor');
		if (extension === undefined) { throw new Error('Expected Sundial Editor extension to be loaded'); }
		await extension.activate();
		const workspace = vscode.workspace.workspaceFolders?.[0];
		if (workspace === undefined) { throw new Error('Expected the staged diff workspace'); }

		const first = vscode.Uri.joinPath(workspace.uri, 'source-one.txt');
		const second = vscode.Uri.joinPath(workspace.uri, 'source-two.txt');
		const third = vscode.Uri.joinPath(workspace.uri, 'source-three.txt');
		const annotated = vscode.Uri.joinPath(workspace.uri, 'annotated-source.txt');
		const firstEditor = await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(first), {
			viewColumn: vscode.ViewColumn.One, preview: false,
		});
		firstEditor.selection = new vscode.Selection(220, 3, 220, 3);
		firstEditor.revealRange(new vscode.Range(180, 0, 180, 0), vscode.TextEditorRevealType.AtTop);
		const initialVisibleLine = await waitForVisibleStart(firstEditor);
		const initialLayout = await editorLayout();
		const initialArrangement = editorArrangement();

		await vscode.commands.executeCommand('sundialEditor.diff.toggle');
		const initial = await waitForDiffState(state => state.enabled && state.managedDiffs.length === 1);
		assert.equal(initial.cwd, workspace.uri.fsPath);
		assert.equal(initial.managedDiffs[0].sourceUri, first.toString());
		assert.equal(initial.managedDiffs[0].baseline, initial.baseline);
		assertManagedDiffTabs([first]);
		assert.equal(vscode.window.activeTextEditor?.document.uri.toString(), first.toString());
		assert.equal(vscode.window.activeTextEditor?.selection.active.line, 220);
		assert.equal(vscode.window.activeTextEditor?.selection.active.character, 3);
		assert.deepEqual(await editorLayout(), initialLayout, 'diff preserves the editor-group split layout');
		assert.deepEqual(editorArrangement(), initialArrangement, 'diff preserves relative tab and group state');
		await waitForVisibleLine(first, initialVisibleLine);
		await focusCompareSide('original', first);

		await vscode.commands.executeCommand('sundialEditor.diff.previous');
		const previous = await waitForDiffState(state => state.enabled && state.baseline !== initial.baseline
			&& state.managedDiffs.length === 1 && state.managedDiffs[0].baseline === state.baseline);
		assert.notEqual(previous.baseline, initial.baseline);
		assertManagedDiffTabs([first]);
		await waitForActiveEditorScheme('git');
		assert.deepEqual(await editorLayout(), initialLayout, 'baseline replacement preserves the editor-group split layout');
		assert.deepEqual(editorArrangement(), initialArrangement, 'baseline replacement preserves relative tab and group state');
		assert.equal(modifiedEditor(first)?.selection.active.character, 3);
		await waitForVisibleLine(first, initialVisibleLine);

		const originalInlineState = previous.renderSideBySide;
		await vscode.commands.executeCommand('sundialEditor.diff.inline');
		const inline = await waitForDiffState(state => state.renderSideBySide !== originalInlineState);
		assert.equal(inline.renderSideBySide, !originalInlineState);
		await vscode.commands.executeCommand('sundialEditor.diff.inline');
		await waitForDiffState(state => state.renderSideBySide === originalInlineState);

		await vscode.commands.executeCommand('sundialEditor.diff.toggle');
		await waitForDiffState(state => !state.enabled && state.managedDiffs.length === 0);
		assertSourceTabs([first]);
		assert.equal(vscode.window.activeTextEditor?.document.uri.toString(), first.toString());
		assert.equal(vscode.window.activeTextEditor?.selection.active.character, 3);
		assert.deepEqual(await editorLayout(), initialLayout, 'undiff preserves the editor-group split layout');
		assert.deepEqual(editorArrangement(), initialArrangement, 'undiff restores relative tab and group state');
		await waitForVisibleLine(first, initialVisibleLine);

		await vscode.commands.executeCommand('workbench.action.closeAllEditors');
		await vscode.commands.executeCommand('vscode.setEditorLayout', {
			orientation: 0,
			groups: [{ size: 0.7 }, { size: 0.3 }],
		});
		const reopenedFirst = await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(first), {
			viewColumn: vscode.ViewColumn.One, preview: false,
		});
		reopenedFirst.selection = new vscode.Selection(1, 2, 1, 2);
		const secondEditor = await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(second), {
			viewColumn: vscode.ViewColumn.Beside, preview: true,
		});
		secondEditor.selection = new vscode.Selection(1, 4, 1, 4);
		const untitled = vscode.Uri.parse('untitled:outside-sundial-diff');
		await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(untitled), {
			viewColumn: vscode.ViewColumn.Two, preview: false,
		});
		const multipleLayout = await editorLayout();
		const multipleArrangement = editorArrangement();

		await vscode.commands.executeCommand('sundialEditor.diff.toggle');
		const multiple = await waitForDiffState(state => state.enabled && state.managedDiffs.length === 2);
		assertManagedDiffTabs([first, second]);
		assert.deepEqual(multiple.managedDiffs.map(diff => diff.viewColumn).sort(), [vscode.ViewColumn.One, vscode.ViewColumn.Two]);
		assert.equal(hasTextTab(untitled), true, 'non-workspace editors remain ordinary tabs');
		assert.deepEqual(await editorLayout(), multipleLayout, 'multi-group diff preserves unequal split sizes');
		assert.deepEqual(editorArrangement(), multipleArrangement, 'multi-group diff preserves relative tab and group state');

		await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(third), {
			viewColumn: vscode.ViewColumn.One, preview: false,
		});
		const openedArrangement = editorArrangement();
		await waitForDiffState(state => state.enabled && state.managedDiffs.length === 3);
		await waitForTextTab(third, false);
		await waitForActiveViewColumn(vscode.ViewColumn.One);
		assertManagedDiffTabs([first, second, third]);
		assert.equal(hasTextTab(untitled), true);
		await waitForArrangement(openedArrangement);
		await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(annotated), {
			viewColumn: vscode.ViewColumn.One, preview: false,
		});
		const annotatedArrangement = editorArrangement();
		await waitForDiffState(state => state.enabled && state.managedDiffs.length === 4);
		assertManagedDiffTabs([first, second, third, annotated]);
		await waitForArrangement(annotatedArrangement);
		const navigatedLayout = await editorLayout();
		const navigatedArrangement = editorArrangement();

		await vscode.commands.executeCommand('sundialEditor.diff.toggle');
		await waitForDiffState(state => !state.enabled && state.managedDiffs.length === 0);
		assertSourceTabs([first, second, third, annotated]);
		assert.equal(hasTextTab(untitled), true);
		assert.deepEqual(await editorLayout(), navigatedLayout, 'multi-group undiff preserves unequal split sizes');
		assert.deepEqual(editorArrangement(), navigatedArrangement, 'multi-group undiff restores relative tab and group state');
	});
});

interface EditorArrangement {
	readonly activeViewColumn: vscode.ViewColumn;
	readonly groups: readonly {
		readonly viewColumn: vscode.ViewColumn;
		readonly activeTab?: string;
		readonly tabs: readonly {
			readonly identity: string;
			readonly active: boolean;
			readonly pinned: boolean;
			readonly preview: boolean;
		}[];
	}[];
}

function editorArrangement(): EditorArrangement {
	return {
		activeViewColumn: vscode.window.tabGroups.activeTabGroup.viewColumn,
		groups: vscode.window.tabGroups.all.map(group => ({
			viewColumn: group.viewColumn,
			...(group.activeTab === undefined ? {} : { activeTab: logicalTabIdentity(group.activeTab) }),
			tabs: group.tabs.map(tab => ({
				identity: logicalTabIdentity(tab),
				active: tab.isActive,
				pinned: tab.isPinned,
				preview: tab.isPreview,
			})),
		})),
	};
}

async function waitForArrangement(expected: EditorArrangement, timeoutMs = 8_000): Promise<void> {
	const started = Date.now();
	let latest = editorArrangement();
	while (Date.now() - started < timeoutMs) {
		latest = editorArrangement();
		try {
			assert.deepEqual(latest, expected);
			return;
		} catch {
			await new Promise(resolve => setTimeout(resolve, 25));
		}
	}
	assert.deepEqual(latest, expected, 'automatic diff conversion preserves relative tab and group state');
}

function logicalTabIdentity(tab: vscode.Tab): string {
	if (tab.input instanceof vscode.TabInputText) { return `text:${tab.input.uri.toString()}`; }
	if (tab.input instanceof vscode.TabInputTextDiff
		&& (tab.input.original.scheme === 'git' || tab.input.original.scheme === 'sundial-empty-diff')) {
		return `text:${tab.input.modified.toString()}`;
	}
	return `other:${tab.label}`;
}

async function editorLayout(): Promise<unknown> {
	return vscode.commands.executeCommand('vscode.getEditorLayout');
}

function assertManagedDiffTabs(expectedSources: readonly vscode.Uri[]): void {
	const sources = vscode.window.tabGroups.all.flatMap(group => group.tabs.flatMap(tab => {
		if (!(tab.input instanceof vscode.TabInputTextDiff)
			|| (tab.input.original.scheme !== 'git' && tab.input.original.scheme !== 'sundial-empty-diff')) { return []; }
		return [tab.input.modified.toString()];
	})).sort();
	assert.deepEqual(sources, expectedSources.map(uri => uri.toString()).sort());
}

function modifiedEditor(uri: vscode.Uri): vscode.TextEditor | undefined {
	return vscode.window.visibleTextEditors.find(editor => editor.document.uri.toString() === uri.toString());
}

async function waitForVisibleStart(editor: vscode.TextEditor, timeoutMs = 2000): Promise<number> {
	const started = Date.now();
	while (Date.now() - started < timeoutMs) {
		const line = editor.visibleRanges[0]?.start.line ?? 0;
		if (line > 0) { return line; }
		await new Promise(resolve => setTimeout(resolve, 25));
	}
	throw new Error('Timed out waiting for the editor to establish a non-zero scroll anchor.');
}

async function waitForVisibleLine(uri: vscode.Uri, expected: number, timeoutMs = 2000): Promise<void> {
	const started = Date.now();
	let latest: number | undefined;
	while (Date.now() - started < timeoutMs) {
		latest = modifiedEditor(uri)?.visibleRanges[0]?.start.line;
		if (latest === expected) { return; }
		await new Promise(resolve => setTimeout(resolve, 25));
	}
	throw new Error(`Timed out waiting for ${uri.toString()} to restore visible line ${expected}; latest was ${String(latest)}.`);
}

async function waitForActiveEditorScheme(expected: string, timeoutMs = 2000): Promise<void> {
	const started = Date.now();
	let latest: string | undefined;
	while (Date.now() - started < timeoutMs) {
		latest = vscode.window.activeTextEditor?.document.uri.scheme;
		if (latest === expected) { return; }
		await new Promise(resolve => setTimeout(resolve, 25));
	}
	throw new Error(`Timed out waiting for active editor scheme ${expected}; latest was ${String(latest)}.`);
}

async function focusCompareSide(side: 'original' | 'modified', source: vscode.Uri, timeoutMs = 8_000): Promise<void> {
	const command = side === 'original'
		? 'workbench.action.compareEditor.focusSecondarySide'
		: 'workbench.action.compareEditor.focusPrimarySide';
	const started = Date.now();
	let active: vscode.Uri | undefined;
	while (Date.now() - started < timeoutMs) {
		void vscode.commands.executeCommand(command).then(undefined, () => undefined);
		await new Promise(resolve => setTimeout(resolve, 100));
		active = vscode.window.activeTextEditor?.document.uri;
		if (side === 'original' ? active?.scheme === 'git' : active?.toString() === source.toString()) { return; }
	}
	throw new Error(`Timed out focusing the ${side} compare side; active editor was ${active?.toString() ?? 'none'}.`);
}

function assertSourceTabs(expectedSources: readonly vscode.Uri[]): void {
	for (const source of expectedSources) {
		assert.equal(hasTextTab(source), true, `expected restored source tab for ${source.toString()}`);
	}
}

function hasTextTab(uri: vscode.Uri): boolean {
	return vscode.window.tabGroups.all.some(group => group.tabs.some(tab => tab.input instanceof vscode.TabInputText
		&& tab.input.uri.toString() === uri.toString()));
}

async function waitForTextTab(uri: vscode.Uri, expected: boolean, timeoutMs = 2000): Promise<void> {
	const started = Date.now();
	while (Date.now() - started < timeoutMs) {
		if (hasTextTab(uri) === expected) { return; }
		await new Promise(resolve => setTimeout(resolve, 25));
	}
	throw new Error(`Timed out waiting for ${uri.toString()} text-tab state ${String(expected)}.`);
}

async function waitForActiveViewColumn(expected: vscode.ViewColumn, timeoutMs = 2000): Promise<void> {
	const started = Date.now();
	while (Date.now() - started < timeoutMs) {
		if (vscode.window.tabGroups.activeTabGroup.viewColumn === expected) { return; }
		await new Promise(resolve => setTimeout(resolve, 25));
	}
	throw new Error(`Timed out waiting for active editor group ${expected}.`);
}

async function waitForDiffState(predicate: (state: DiffDiagnostics) => boolean, timeoutMs = 8000): Promise<DiffDiagnostics> {
	const started = Date.now();
	let latest: DiffDiagnostics | undefined;
	while (Date.now() - started < timeoutMs) {
		latest = await vscode.commands.executeCommand<DiffDiagnostics>('sundialEditor.internal.diffDiagnostics');
		if (predicate(latest)) { return latest; }
		await new Promise(resolve => setTimeout(resolve, 100));
	}
	throw new Error(`Timed out waiting for diff state: ${JSON.stringify(latest)}`);
}
