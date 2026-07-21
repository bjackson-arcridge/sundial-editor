import * as path from 'node:path';
import * as vscode from 'vscode';
import type { GitWorkflowState } from './cliRunner';

export type DiffBaselineAction = 'previous' | 'next' | 'head' | 'permanent';
export interface DiffEditorControllerServices {
	readonly readState: (cwd: string, baseline?: string) => Promise<GitWorkflowState>;
	readonly moveBaseline: (cwd: string, baseline: string | undefined, action: DiffBaselineAction) => Promise<GitWorkflowState>;
	readonly workspaceCwd: (uri: vscode.Uri) => string | undefined;
	readonly workspaceRoots: () => readonly string[];
	readonly reportError: (message: string) => void;
}

export interface DiffEditorDiagnostics {
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

interface ControllerState {
	readonly cwd: string;
	readonly workflow: GitWorkflowState;
}

interface VisualState {
	readonly selection?: vscode.Selection;
	readonly visibleStart?: vscode.Position;
}

interface EditorSnapshot extends VisualState {
	readonly tabInput: vscode.Tab['input'];
	readonly source: vscode.Uri;
	readonly viewColumn: vscode.ViewColumn;
	readonly tabIndex: number;
	readonly activeInGroup: boolean;
	readonly activeGlobally: boolean;
	readonly preview: boolean;
	readonly pinned: boolean;
	readonly activeSide: 'original' | 'modified';
}

interface EditorGroupSnapshot {
	readonly viewColumn: vscode.ViewColumn;
	readonly activeTabIndex: number;
	readonly activeGlobally: boolean;
}

interface ManagedDiff {
	readonly source: vscode.Uri;
	readonly baseline: string;
}

const managedQueryFlag = 'sundialEditor';
const emptyRevisionScheme = 'sundial-empty-diff';

export class DiffEditorController implements vscode.Disposable {
	private state: ControllerState | undefined;
	private enabled = false;
	private operation = Promise.resolve();
	private reconciling = false;
	private reconcileTimer: ReturnType<typeof setTimeout> | undefined;
	private readonly rememberedVisualState = new Map<string, VisualState>();
	private readonly disposables: vscode.Disposable[];

	constructor(private readonly services: DiffEditorControllerServices) {
		this.disposables = [
			vscode.workspace.registerTextDocumentContentProvider(emptyRevisionScheme, {
				provideTextDocumentContent: () => '',
			}),
			vscode.window.tabGroups.onDidChangeTabs(event => {
				if (!this.enabled || this.reconciling || !event.opened.some(tab => this.sourceTabInCurrentWorkspace(tab))) {
					return;
				}
				this.scheduleReconcile();
			}),
		];
	}

	dispose(): void {
		if (this.reconcileTimer !== undefined) { clearTimeout(this.reconcileTimer); }
		for (const disposable of this.disposables) { disposable.dispose(); }
	}

	async toggle(): Promise<boolean> {
		return this.enqueue(async () => {
			if (this.enabled) {
				await this.restoreManagedDiffs();
				this.enabled = false;
				this.rememberedVisualState.clear();
				return false;
			}

			const cwd = this.resolveWorkspaceCwd();
			if (cwd === undefined) { throw new Error('Open a workspace folder before enabling diff view.'); }
			const selected = this.state?.cwd === cwd ? this.state.workflow.baseline : undefined;
			this.state = { cwd, workflow: await this.services.readState(cwd, selected) };
			this.enabled = true;
			await this.reconcileDiffs();
			return true;
		});
	}

	async moveBaseline(action: DiffBaselineAction): Promise<GitWorkflowState> {
		return this.enqueue(async () => {
			const cwd = this.enabled ? this.state?.cwd : this.resolveWorkspaceCwd() ?? this.state?.cwd;
			if (cwd === undefined) { throw new Error('Open a workspace folder before changing the diff baseline.'); }
			const baseline = this.state?.cwd === cwd ? this.state.workflow.baseline : undefined;
			const workflow = await this.services.moveBaseline(cwd, baseline, action);
			this.state = { cwd, workflow };
			if (this.enabled) { await this.reconcileDiffs(); }
			return workflow;
		});
	}

	async acceptWorkflowState(cwd: string, workflow: GitWorkflowState): Promise<void> {
		await this.enqueue(async () => {
			this.state = { cwd, workflow };
			if (this.enabled) { await this.reconcileDiffs(); }
		});
	}

	async toggleInline(): Promise<boolean> {
		const configuration = vscode.workspace.getConfiguration('diffEditor');
		const renderSideBySide = configuration.get<boolean>('renderSideBySide', true);
		await configuration.update('renderSideBySide', !renderSideBySide, vscode.ConfigurationTarget.Workspace);
		return renderSideBySide;
	}

	currentWorkspaceCwd(): string | undefined {
		return this.enabled ? this.state?.cwd : this.resolveWorkspaceCwd() ?? this.state?.cwd;
	}

	activeSourceUri(): vscode.Uri | undefined {
		const activeTab = vscode.window.tabGroups.activeTabGroup.activeTab;
		if (activeTab?.input instanceof vscode.TabInputTextDiff) {
			const managed = parseManagedDiff(activeTab.input);
			if (managed !== undefined) { return managed.source; }
		}
		const uri = vscode.window.activeTextEditor?.document.uri;
		return uri?.scheme === 'file' ? uri : undefined;
	}

	diagnostics(): DiffEditorDiagnostics {
		return {
			enabled: this.enabled,
			...(this.state === undefined ? {} : { cwd: this.state.cwd, baseline: this.state.workflow.baseline }),
			renderSideBySide: vscode.workspace.getConfiguration('diffEditor').get<boolean>('renderSideBySide', true),
			managedDiffs: vscode.window.tabGroups.all.flatMap(group => group.tabs.flatMap(tab => {
				if (!(tab.input instanceof vscode.TabInputTextDiff)) { return []; }
				const managed = parseManagedDiff(tab.input);
				return managed === undefined ? [] : [{
					sourceUri: managed.source.toString(), baseline: managed.baseline,
					viewColumn: group.viewColumn, active: tab.isActive,
				}];
			})),
		};
	}

	private enqueue<T>(operation: () => Promise<T>): Promise<T> {
		const result = this.operation.then(operation, operation);
		this.operation = result.then(() => undefined, () => undefined);
		return result;
	}

	private scheduleReconcile(): void {
		if (this.reconcileTimer !== undefined) { clearTimeout(this.reconcileTimer); }
		this.reconcileTimer = setTimeout(() => {
			this.reconcileTimer = undefined;
			void this.enqueue(async () => {
				await nextEditorFrame();
				await this.reconcileDiffs();
			}).catch(error => {
				this.services.reportError(`New editor could not be converted to a Sundial diff. ${errorMessage(error)}`);
			});
		}, 50);
	}

	private async reconcileDiffs(): Promise<void> {
		const state = this.state;
		if (!this.enabled || state === undefined) { return; }
		const groups = this.editorGroupSnapshots();
		const snapshots = this.editorSnapshots(state.cwd, true);
		await this.withReconciliation(async () => {
			for (const snapshot of orderSnapshots(snapshots)) {
				await this.openDiff(snapshot, state.workflow.baseline);
			}
			await this.restoreEditorGroupState(groups, snapshots, true);
		});
	}

	private async restoreManagedDiffs(): Promise<void> {
		const state = this.state;
		if (state === undefined) { return; }
		const groups = this.editorGroupSnapshots();
		const snapshots = this.editorSnapshots(state.cwd, false);
		await this.withReconciliation(async () => {
			for (const snapshot of orderSnapshots(snapshots)) {
				await this.openSource(snapshot);
			}
			await this.restoreEditorGroupState(groups, snapshots, false);
		});
	}

	private async withReconciliation(operation: () => Promise<void>): Promise<void> {
		this.reconciling = true;
		try { await operation(); }
		finally { this.reconciling = false; }
	}

	private editorSnapshots(cwd: string, forDiff: boolean): EditorSnapshot[] {
		const result: EditorSnapshot[] = [];
		for (const group of vscode.window.tabGroups.all) {
			for (const [tabIndex, tab] of group.tabs.entries()) {
				let source: vscode.Uri | undefined;
				let activeSide: EditorSnapshot['activeSide'] = 'modified';
				if (forDiff && tab.input instanceof vscode.TabInputText && this.insideWorkspace(cwd, tab.input.uri)) {
					source = tab.input.uri;
				} else if (tab.input instanceof vscode.TabInputTextDiff) {
					const managed = parseManagedDiff(tab.input);
					if (managed !== undefined && this.insideWorkspace(cwd, managed.source)
						&& (!forDiff || managed.baseline !== this.state?.workflow.baseline)) {
						source = managed.source;
						activeSide = vscode.window.activeTextEditor?.document.uri.toString() === tab.input.original.toString()
							? 'original' : 'modified';
					}
				}
				if (source === undefined) { continue; }
				const visual = this.captureVisualState(source, group.viewColumn);
				result.push({
					tabInput: tab.input, source, viewColumn: group.viewColumn, tabIndex,
					activeInGroup: tab.isActive, activeGlobally: tab.isActive && group.isActive,
					preview: tab.isPreview, pinned: tab.isPinned, activeSide, ...visual,
				});
			}
		}
		return result;
	}

	private editorGroupSnapshots(): EditorGroupSnapshot[] {
		return vscode.window.tabGroups.all.map(group => ({
			viewColumn: group.viewColumn,
			activeTabIndex: group.activeTab === undefined ? -1 : group.tabs.indexOf(group.activeTab),
			activeGlobally: group.isActive,
		}));
	}

	private captureVisualState(source: vscode.Uri, viewColumn: vscode.ViewColumn): VisualState {
		const key = visualStateKey(source, viewColumn);
		const candidates = vscode.window.visibleTextEditors.filter(candidate => candidate.document.uri.toString() === source.toString());
		const editor = candidates.find(candidate => candidate.viewColumn === viewColumn)
			?? (candidates.length === 1 ? candidates[0] : undefined);
		if (editor === undefined) { return this.rememberedVisualState.get(key) ?? {}; }
		const visual = { selection: editor.selection, visibleStart: editor.visibleRanges[0]?.start };
		this.rememberedVisualState.set(key, visual);
		return visual;
	}

	private async openDiff(snapshot: EditorSnapshot, baseline: string): Promise<void> {
		const original = this.isUntrackedSource(snapshot.source)
			? emptyRevisionUri(snapshot.source, baseline)
			: gitRevisionUri(snapshot.source, baseline);
		await vscode.commands.executeCommand('vscode.diff', original, snapshot.source, diffTitle(snapshot.source, baseline), {
			viewColumn: snapshot.viewColumn,
			preserveFocus: false,
			preview: snapshot.preview,
			...(snapshot.selection === undefined ? {} : { selection: snapshot.selection }),
		});
		await closeSnapshotTab(snapshot);
		await this.restoreReplacementTabState(snapshot, input => input instanceof vscode.TabInputTextDiff
			&& input.original.toString() === original.toString() && input.modified.toString() === snapshot.source.toString());
		this.assertReplacementTabPosition(snapshot, input => input instanceof vscode.TabInputTextDiff
			&& input.original.toString() === original.toString() && input.modified.toString() === snapshot.source.toString());
		await this.restoreVisualState(snapshot);
	}

	private async openSource(snapshot: EditorSnapshot): Promise<void> {
		await vscode.window.showTextDocument(snapshot.source, {
			viewColumn: snapshot.viewColumn,
			preserveFocus: false,
			preview: snapshot.preview,
			...(snapshot.selection === undefined ? {} : { selection: snapshot.selection }),
		});
		await closeSnapshotTab(snapshot);
		await this.restoreReplacementTabState(snapshot, input => input instanceof vscode.TabInputText
			&& input.uri.toString() === snapshot.source.toString());
		this.assertReplacementTabPosition(snapshot, input => input instanceof vscode.TabInputText
			&& input.uri.toString() === snapshot.source.toString());
		await this.restoreVisualState(snapshot);
	}

	private async restoreReplacementTabState(
		snapshot: EditorSnapshot,
		isReplacement: (input: vscode.Tab['input']) => boolean,
	): Promise<void> {
		const openedGroup = vscode.window.tabGroups.all.find(candidate => candidate.viewColumn === snapshot.viewColumn);
		if (openedGroup === undefined) { throw new Error(`Editor group ${snapshot.viewColumn} closed during a Sundial diff transition.`); }
		const openedIndex = openedGroup.tabs.findIndex(tab => isReplacement(tab.input));
		if (openedIndex < 0) { throw new Error('VS Code did not open the replacement editor tab.'); }
		const openedReplacement = openedGroup.tabs[openedIndex];
		if (snapshot.preview && openedIndex !== snapshot.tabIndex) {
			await this.rotateTabsAroundPreview(snapshot, openedIndex, isReplacement);
		} else if (openedIndex !== snapshot.tabIndex) {
			if (!openedGroup.isActive || !openedReplacement.isActive) {
				await focusEditorGroup(snapshot.viewColumn);
				await openEditorAtIndex(snapshot.viewColumn, openedIndex, isReplacement);
			}
			await vscode.commands.executeCommand('moveActiveEditor', {
				to: 'position', by: 'tab', value: snapshot.tabIndex + 1,
			});
			await waitForEditorState(() => {
				const current = vscode.window.tabGroups.all.find(candidate => candidate.viewColumn === snapshot.viewColumn);
				return current?.tabs.findIndex(tab => isReplacement(tab.input)) === snapshot.tabIndex;
			}, 'VS Code did not move the replacement editor tab.');
		}
		const group = vscode.window.tabGroups.all.find(candidate => candidate.viewColumn === snapshot.viewColumn);
		if (group === undefined) { throw new Error(`Editor group ${snapshot.viewColumn} closed during a Sundial diff transition.`); }
		const replacement = group.tabs.find(tab => isReplacement(tab.input));
		if (replacement === undefined) { throw new Error('VS Code lost the replacement editor tab.'); }
		if (snapshot.preview && !replacement.isPreview) {
			throw new Error('VS Code did not preserve the replacement editor preview state.');
		}
		if (!snapshot.preview && replacement.isPinned !== snapshot.pinned) {
			await vscode.commands.executeCommand(snapshot.pinned
				? 'workbench.action.pinEditor'
				: 'workbench.action.unpinEditor');
			await waitForEditorState(() => {
				const current = vscode.window.tabGroups.all.find(candidate => candidate.viewColumn === snapshot.viewColumn);
				return current?.tabs.find(tab => isReplacement(tab.input))?.isPinned === snapshot.pinned;
			}, 'VS Code did not restore the replacement editor pin state.');
		}
	}

	private async rotateTabsAroundPreview(
		snapshot: EditorSnapshot,
		openedIndex: number,
		isReplacement: (input: vscode.Tab['input']) => boolean,
	): Promise<void> {
		let replacementIndex = openedIndex;
		while (replacementIndex !== snapshot.tabIndex) {
			await focusEditorGroup(snapshot.viewColumn);
			const adjacentIndex = replacementIndex > snapshot.tabIndex
				? replacementIndex - 1
				: replacementIndex + 1;
			await openEditorAtIndex(snapshot.viewColumn, adjacentIndex);
			await vscode.commands.executeCommand('moveActiveEditor', {
				to: 'position', by: 'tab', value: replacementIndex + 1,
			});
			const expectedIndex = replacementIndex > snapshot.tabIndex
				? replacementIndex - 1
				: replacementIndex + 1;
			await waitForEditorState(() => {
				const current = vscode.window.tabGroups.all.find(candidate => candidate.viewColumn === snapshot.viewColumn);
				const replacement = current?.tabs.find(tab => isReplacement(tab.input));
				return replacement !== undefined && current?.tabs.indexOf(replacement) === expectedIndex && replacement.isPreview;
			}, 'VS Code did not reposition the replacement preview tab.');
			replacementIndex = expectedIndex;
		}
	}

	private assertReplacementTabPosition(
		snapshot: EditorSnapshot,
		isReplacement: (input: vscode.Tab['input']) => boolean,
	): void {
		const group = vscode.window.tabGroups.all.find(candidate => candidate.viewColumn === snapshot.viewColumn);
		if (group?.tabs.findIndex(tab => isReplacement(tab.input)) !== snapshot.tabIndex) {
			throw new Error('VS Code did not preserve the replacement editor tab position.');
		}
	}

	private async restoreEditorGroupState(
		groups: readonly EditorGroupSnapshot[],
		snapshots: readonly EditorSnapshot[],
		restoreActiveDiffSide: boolean,
	): Promise<void> {
		const touchedColumns = new Set(snapshots.map(snapshot => snapshot.viewColumn));
		const restore = groups
			.filter(group => group.activeGlobally || touchedColumns.has(group.viewColumn))
			.sort((left, right) => Number(left.activeGlobally) - Number(right.activeGlobally));
		for (const group of restore) {
			await focusEditorGroup(group.viewColumn);
			if (group.activeTabIndex >= 0) {
				await openEditorAtIndex(group.viewColumn, group.activeTabIndex);
			}
		}
		const globallyActiveGroup = groups.find(group => group.activeGlobally);
		if (globallyActiveGroup !== undefined) {
			await restoreActiveEditorGroup(globallyActiveGroup);
		}
		const activeSnapshot = snapshots.find(snapshot => snapshot.activeGlobally);
		if (activeSnapshot !== undefined && restoreActiveDiffSide) {
			await restoreDiffSide(activeSnapshot);
		}
	}

	private async restoreVisualState(snapshot: EditorSnapshot): Promise<void> {
		await nextEditorFrame();
		const activeEditor = vscode.window.activeTextEditor;
		const activeModifiedEditor = snapshot.activeGlobally
			&& activeEditor?.document.uri.toString() === snapshot.source.toString() ? activeEditor : undefined;
		const candidates = vscode.window.visibleTextEditors.filter(candidate => candidate.document.uri.toString() === snapshot.source.toString());
		const editor = activeModifiedEditor ?? candidates.find(candidate => candidate.viewColumn === snapshot.viewColumn)
			?? (candidates.length === 1 ? candidates[0] : candidates.at(-1));
		if (editor === undefined) { return; }
		if (snapshot.selection !== undefined) {
			editor.selection = snapshot.selection;
			await new Promise(resolve => setTimeout(resolve, 100));
		}
		if (snapshot.visibleStart !== undefined) {
			const expectedLine = snapshot.visibleStart.line;
			let revealLine = expectedLine;
			let stableFrames = 0;
			for (let attempt = 0; attempt < 6 && stableFrames < 2; attempt += 1) {
				const revealPosition = new vscode.Position(revealLine, snapshot.visibleStart.character);
				editor.revealRange(new vscode.Range(revealPosition, revealPosition), vscode.TextEditorRevealType.AtTop);
				await nextEditorFrame();
				const actualLine = editor.visibleRanges[0]?.start.line;
				if (actualLine === expectedLine) { stableFrames += 1; }
				else if (actualLine !== undefined) {
					stableFrames = 0;
					revealLine = Math.max(0, Math.min(editor.document.lineCount - 1, revealLine + expectedLine - actualLine));
				}
			}
		}
	}

	private sourceTabInCurrentWorkspace(tab: vscode.Tab): boolean {
		return this.state !== undefined && tab.input instanceof vscode.TabInputText
			&& this.insideWorkspace(this.state.cwd, tab.input.uri);
	}

	private resolveWorkspaceCwd(): string | undefined {
		const source = this.activeSourceUri();
		return (source === undefined ? undefined : this.services.workspaceCwd(source)) ?? this.services.workspaceRoots()[0];
	}

	private insideWorkspace(cwd: string, uri: vscode.Uri): boolean {
		if (uri.scheme !== 'file') { return false; }
		const relative = path.relative(cwd, uri.fsPath);
		return relative === '' || (!relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
	}

	private isUntrackedSource(source: vscode.Uri): boolean {
		const state = this.state;
		return state !== undefined && state.workflow.untrackedPaths.includes(path.relative(state.cwd, source.fsPath).split(path.sep).join('/'));
	}
}

function gitRevisionUri(source: vscode.Uri, ref: string, baseline = ref): vscode.Uri {
	return source.with({
		scheme: 'git',
		query: JSON.stringify({ path: source.fsPath, ref, baseline, [managedQueryFlag]: true }),
	});
}

function emptyRevisionUri(source: vscode.Uri, baseline: string): vscode.Uri {
	return source.with({
		scheme: emptyRevisionScheme,
		query: JSON.stringify({ path: source.fsPath, baseline, [managedQueryFlag]: true }),
	});
}

function parseManagedDiff(input: vscode.TabInputTextDiff): ManagedDiff | undefined {
	if ((input.original.scheme !== 'git' && input.original.scheme !== emptyRevisionScheme)
		|| input.modified.scheme !== 'file') { return undefined; }
	try {
		const query: unknown = JSON.parse(input.original.query);
		if (typeof query !== 'object' || query === null || Array.isArray(query)) { return undefined; }
		const record = query as Record<string, unknown>;
		const baseline = typeof record.baseline === 'string' ? record.baseline : record.ref;
		return record[managedQueryFlag] === true && typeof baseline === 'string'
			? { source: input.modified, baseline }
			: undefined;
	} catch { return undefined; }
}

function diffTitle(source: vscode.Uri, baseline: string): string {
	return `${path.basename(source.fsPath)} (${baseline.slice(0, 8)} ↔ Working Tree)`;
}

function visualStateKey(source: vscode.Uri, viewColumn: vscode.ViewColumn): string {
	return `${viewColumn}:${source.toString()}`;
}

function orderSnapshots(snapshots: readonly EditorSnapshot[]): EditorSnapshot[] {
	return [...snapshots].sort((left, right) => Number(left.activeInGroup) - Number(right.activeInGroup)
		|| Number(left.activeGlobally) - Number(right.activeGlobally));
}

async function closeSnapshotTab(snapshot: EditorSnapshot): Promise<void> {
	const group = vscode.window.tabGroups.all.find(candidate => candidate.viewColumn === snapshot.viewColumn);
	const current = group?.tabs.find(tab => sameTabInput(tab.input, snapshot.tabInput));
	if (current !== undefined) { await vscode.window.tabGroups.close(current, true); }
}

function sameTabInput(left: vscode.Tab['input'], right: vscode.Tab['input']): boolean {
	if (left instanceof vscode.TabInputText && right instanceof vscode.TabInputText) {
		return left.uri.toString() === right.uri.toString();
	}
	if (left instanceof vscode.TabInputTextDiff && right instanceof vscode.TabInputTextDiff) {
		return left.original.toString() === right.original.toString()
			&& left.modified.toString() === right.modified.toString();
	}
	return false;
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function nextEventLoop(): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, 0));
}

function nextEditorFrame(): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, 25));
}

async function focusEditorGroup(viewColumn: vscode.ViewColumn): Promise<void> {
	const commands = [
		'workbench.action.focusFirstEditorGroup',
		'workbench.action.focusSecondEditorGroup',
		'workbench.action.focusThirdEditorGroup',
		'workbench.action.focusFourthEditorGroup',
		'workbench.action.focusFifthEditorGroup',
		'workbench.action.focusSixthEditorGroup',
		'workbench.action.focusSeventhEditorGroup',
		'workbench.action.focusEighthEditorGroup',
	] as const;
	const command = commands[viewColumn - vscode.ViewColumn.One] ?? 'workbench.action.focusLastEditorGroup';
	await vscode.commands.executeCommand(command);
	await waitForEditorState(() => vscode.window.tabGroups.activeTabGroup.viewColumn === viewColumn,
		`VS Code did not restore editor group ${viewColumn}.`);
}

async function openEditorAtIndex(
	viewColumn: vscode.ViewColumn,
	index: number,
	isExpected?: (input: vscode.Tab['input']) => boolean,
): Promise<void> {
	await vscode.commands.executeCommand('workbench.action.openEditorAtIndex', index);
	await waitForEditorState(() => {
		const group = vscode.window.tabGroups.activeTabGroup;
		return group.viewColumn === viewColumn && group.activeTab !== undefined
			&& group.tabs.indexOf(group.activeTab) === index
			&& (isExpected === undefined || isExpected(group.activeTab.input));
	}, `VS Code did not restore editor ${index + 1} in group ${viewColumn}.`);
}

async function restoreActiveEditorGroup(snapshot: EditorGroupSnapshot): Promise<void> {
	// Diff/source opens can report their tab mutation before their deferred focus work settles.
	// Restore after that quiet period, and retry only if VS Code moves focus again.
	await new Promise(resolve => setTimeout(resolve, 250));
	for (let attempt = 0; attempt < 3; attempt += 1) {
		await focusEditorGroup(snapshot.viewColumn);
		if (snapshot.activeTabIndex >= 0) {
			await openEditorAtIndex(snapshot.viewColumn, snapshot.activeTabIndex);
		}
		await new Promise(resolve => setTimeout(resolve, 150));
		const activeGroup = vscode.window.tabGroups.activeTabGroup;
		const activeIndex = activeGroup.activeTab === undefined ? -1 : activeGroup.tabs.indexOf(activeGroup.activeTab);
		if (activeGroup.viewColumn === snapshot.viewColumn && activeIndex === snapshot.activeTabIndex) { return; }
	}
	throw new Error('VS Code did not preserve the active editor group and tab.');
}

async function restoreDiffSide(snapshot: EditorSnapshot): Promise<void> {
	const command = snapshot.activeSide === 'original'
		? 'workbench.action.compareEditor.focusSecondarySide'
		: 'workbench.action.compareEditor.focusPrimarySide';
	const started = Date.now();
	while (Date.now() - started < 4_000) {
		dispatchEditorCommand(command);
		await new Promise(resolve => setTimeout(resolve, 100));
		const activeUri = vscode.window.activeTextEditor?.document.uri;
		if (snapshot.activeSide === 'original'
			? activeUri?.scheme === 'git' || activeUri?.scheme === emptyRevisionScheme
			: activeUri?.toString() === snapshot.source.toString()) {
			return;
		}
	}
	throw new Error(`VS Code did not restore the active ${snapshot.activeSide} diff side.`);
}

function dispatchEditorCommand(command: string, ...args: unknown[]): void {
	void vscode.commands.executeCommand(command, ...args).then(undefined, () => undefined);
}

async function waitForEditorState(predicate: () => boolean, message: string, timeoutMs = 2_000): Promise<void> {
	const started = Date.now();
	let stableFrames = 0;
	while (Date.now() - started < timeoutMs) {
		if (predicate()) {
			stableFrames += 1;
			if (stableFrames >= 2) { return; }
		} else {
			stableFrames = 0;
		}
		await new Promise(resolve => setTimeout(resolve, 25));
	}
	throw new Error(message);
}
