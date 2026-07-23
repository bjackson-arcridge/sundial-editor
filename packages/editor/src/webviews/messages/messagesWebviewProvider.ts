import * as vscode from 'vscode';
import * as path from 'node:path';
import { companionPathForSource } from '@arcridge/sundial-editor-annotations/paths';
import {
	type AgentId,
	type NamedAgent,
	type UserAnnotationId,
	type UserAnnotationWorkItem,
} from '../../agentProtocol.js';
import type { Annotation, AnnotationLink } from '../../annotationProtocol.js';
import {
	prepareAnnotationResponse,
	type ResponseContinuity,
} from '../../annotationResponse.js';
import {
	defaultPaneSplitPercent,
	normalizePaneSplitPercent,
	paneSplitPercentConfiguration,
} from '../../paneSplit.js';
import {
	appendAnnotationViaCli,
	claimWorkViaCli,
	deleteAnnotationViaCli,
	enqueueWorkViaCli,
	ensureAgentSessionViaCli,
	interruptAgentViaCli,
	listAnnotationsViaCli,
	listAgentsViaCli,
	listWorkViaCli,
	markWorkReadyViaCli,
	openAgentViaCli,
	readAnnotationsViaCli,
	renameAgentViaCli,
	requeueWorkViaCli,
	resetAgentViaCli,
	startManagedAgentRun,
	type AgentRun,
} from '../../cliRunner.js';
import { resolvePromptTargetSelector, type PromptContext } from '../../promptCommand.js';
import { renderWebviewHtml } from '../shared/csp.js';
import { attachMessageRouter, type MessageRouter } from '../shared/messageRouter.js';
import {
	annotationForLine,
	annotationsForCurrentPermanentCommit,
	type AnnotationIndexState,
	type HostToWebview,
	type MessagesState,
	type WorkflowPresentation,
	type WebviewToHost,
	isValidWebviewToHostMessage,
	presentAnnotation,
} from './messages.js';

export interface MessagesServices {
	readonly returnToSource: (prompt: PromptContext) => void | Promise<void>;
	readonly startAgentRun?: typeof startManagedAgentRun;
	readonly appendAnnotation?: typeof appendAnnotationViaCli;
	readonly deleteAnnotation?: typeof deleteAnnotationViaCli;
	readonly readAnnotations?: typeof readAnnotationsViaCli;
	readonly listAnnotations?: typeof listAnnotationsViaCli;
	readonly listAgents?: typeof listAgentsViaCli;
	readonly listWork?: typeof listWorkViaCli;
	readonly renameAgent?: typeof renameAgentViaCli;
	readonly ensureAgentSession?: typeof ensureAgentSessionViaCli;
	readonly enqueueWork?: typeof enqueueWorkViaCli;
	readonly markWorkReady?: typeof markWorkReadyViaCli;
	readonly claimWork?: typeof claimWorkViaCli;
	readonly requeueWork?: typeof requeueWorkViaCli;
	readonly openAgent?: typeof openAgentViaCli;
	readonly interruptAgent?: typeof interruptAgentViaCli;
	readonly resetAgent?: typeof resetAgentViaCli;
	readonly confirmFreshSession?: (agent: NamedAgent) => boolean | Promise<boolean>;
	readonly confirmResetAgent?: (agent: NamedAgent) => boolean | Promise<boolean>;
	readonly confirmDeleteAnnotation?: (annotation: Annotation) => boolean | Promise<boolean>;
	readonly openTerminal?: (name: string, command: string, args: readonly string[], cwd: string) => void;
	readonly showAnnotationMarkers?: (sourceUri: string | undefined, lines: readonly number[]) => void;
	readonly revealAnnotation?: (sourceUri: string, line: number | null, preserveFocus?: boolean) => void | Promise<void>;
	readonly cliPath?: () => string;
	readonly workspaceRootCwd?: () => string | undefined;
	readonly workspaceCwd?: (prompt: PromptContext) => string | undefined;
}

export interface MessagesDiagnostics {
	readonly viewResolved: boolean;
	readonly viewVisible: boolean;
	readonly annotationMarkerLines: readonly number[];
	readonly state: MessagesState;
}

interface PendingPrompt {
	readonly prompt: PromptContext;
	readonly cwd: string;
	readonly draft: string;
	readonly targetAgentId?: AgentId;
	readonly response?: { readonly continuity: ResponseContinuity };
	readonly reservedWork?: UserAnnotationWorkItem;
}

interface ActiveLocation {
	readonly sourceUri: string;
	readonly line: number;
	readonly cwd: string;
}

interface ActiveRun {
	readonly work: UserAnnotationWorkItem;
	readonly run: AgentRun;
	cancelReason?: string;
}

interface LoadedAnnotations {
	readonly sourceUri: string;
	readonly cwd: string;
	readonly annotations: readonly Annotation[];
	readonly currentPermanentCommit: string;
	readonly currentPermanentAnnotationIds: readonly string[];
}

export class MessagesWebviewProvider implements vscode.WebviewViewProvider {
	private readonly messageRouters = new Set<MessageRouter<WebviewToHost, HostToWebview>>();
	private readonly activeRuns = new Map<AgentId, ActiveRun>();
	private readonly recoveredWorkspaces = new Set<string>();
	private activeMessagesView: vscode.WebviewView | undefined;
	private pendingPrompt: PendingPrompt | undefined;
	private agentsState: MessagesState['agents'] = { kind: 'loading' };
	private work: readonly UserAnnotationWorkItem[] = [];
	private busy = false;
	private notice: MessagesState['notice'];
	private activeLocation: ActiveLocation | undefined;
	private loadedAnnotations: LoadedAnnotations | undefined;
	private viewedAnnotation: { readonly sourceUri: string; readonly cwd: string; readonly annotation: Annotation } | undefined;
	private annotationPinned = false;
	private workflow: WorkflowPresentation = {
		diffEnabled: false, diffLayout: 'side-by-side', annotationFilterEnabled: false,
	};
	private paneSplitPercent: number;
	private paneSplitPersistence = Promise.resolve();
	private pendingPaneSplitWrites = 0;
	private annotationLoadGeneration = 0;
	private annotationIndexLoadGeneration = 0;
	private annotationIndexCwd: string | undefined;
	private annotationIndexState: AnnotationIndexState = { kind: 'loading' };
	private annotationIndexRefreshTimer: ReturnType<typeof setTimeout> | undefined;
	private agentLoadGeneration = 0;
	private responseOpening = false;

	constructor(
		private readonly extensionUri: vscode.Uri,
		private readonly services: MessagesServices,
	) {
		this.paneSplitPercent = this.configuredPaneSplitPercent();
	}

	refreshPaneSplitPercent(): void {
		if (this.pendingPaneSplitWrites > 0) {
			return;
		}
		const configured = this.configuredPaneSplitPercent();
		if (configured !== this.paneSplitPercent) {
			this.paneSplitPercent = configured;
			this.postState();
		}
	}

	setDiffPresentation(presentation: Pick<WorkflowPresentation, 'diffEnabled' | 'diffLayout' | 'baseline' | 'currentPermanentCommit'>): void {
		this.workflow = { ...this.workflow, ...presentation };
		this.postState();
	}

	async resolveWebviewView(messagesView: vscode.WebviewView): Promise<void> {
		this.activeMessagesView = messagesView;
		messagesView.webview.options = { enableScripts: true, localResourceRoots: [this.extensionUri] };
		const router = attachMessageRouter<WebviewToHost, HostToWebview>(
			messagesView.webview,
			isValidWebviewToHostMessage,
			message => this.handleWebviewMessage(message),
		);
		this.messageRouters.add(router);
		messagesView.webview.html = renderWebviewHtml({
			title: 'Sundial Editor Messages',
			bodyTagId: 'se-messages-app',
			scriptUri: messagesView.webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'dist', 'webviews', 'messages.js')),
			codiconUri: messagesView.webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'codicon.css')),
			cspSource: messagesView.webview.cspSource,
			initialState: this.hostStateMessage(),
			fallbackText: 'Loading Messages...',
		});
		messagesView.onDidChangeVisibility(() => this.focusPendingComposer());
		messagesView.onDidDispose(() => {
			router.dispose();
			this.messageRouters.delete(router);
			if (this.activeMessagesView === messagesView) { this.activeMessagesView = undefined; }
		});
		const cwd = this.currentCwd();
		if (cwd !== undefined) { void this.refreshAgentState(cwd); }
		void this.ensureAnnotationIndexWorkspace();
		if (messagesView.visible) { queueMicrotask(() => this.focusPendingComposer()); }
	}

	async validatePromptTarget(prompt: PromptContext, cwd: string): Promise<string | undefined> {
		const agents = await this.loadAgents(cwd);
		if (agents.length === 0) {
			return 'No managed agents are available.';
		}
		if (prompt.targetSelector === undefined) {
			return undefined;
		}
		try {
			resolvePromptTargetSelector(prompt.targetSelector, agents);
			return undefined;
		} catch (error) {
			return error instanceof Error ? error.message : String(error);
		}
	}

	async promptTargets(cwd: string): Promise<readonly NamedAgent[]> {
		if (this.currentCwd() === cwd && this.agentsState.kind === 'ready') {
			return this.agentsState.agents;
		}
		return this.loadAgents(cwd);
	}

	async openPrompt(prompt: PromptContext): Promise<void> {
		const cwd = this.services.workspaceCwd?.(prompt)
			?? vscode.workspace.getWorkspaceFolder(vscode.Uri.parse(prompt.sourceUri))?.uri.fsPath;
		if (cwd === undefined) {
			this.setError('The prompt is not inside an open workspace.');
			return;
		}
		const agents = await this.loadAgents(cwd);
		let target = agents[0];
		if (prompt.targetSelector !== undefined) {
			try {
				target = resolvePromptTargetSelector(prompt.targetSelector, agents);
			} catch (error) {
				this.setError(error instanceof Error ? error.message : String(error));
				return;
			}
		}
		await this.openComposer(prompt, cwd, agents, target?.id);
	}

	private async openComposer(
		prompt: PromptContext,
		cwd: string,
		agents: readonly NamedAgent[],
		targetAgentId?: AgentId,
		response?: { readonly continuity: ResponseContinuity },
	): Promise<void> {
		if (agents.length === 0) {
			this.setError('No managed agents are available.');
			return;
		}
		this.pendingPrompt = {
			prompt,
			cwd,
			draft: '',
			...(targetAgentId === undefined ? {} : { targetAgentId }),
			...(response === undefined ? {} : { response }),
		};
		void this.ensureAnnotationIndexWorkspace();
		this.notice = undefined;
		this.postState();
		await vscode.commands.executeCommand('workbench.view.extension.sundialEditor');
		await vscode.commands.executeCommand('sundialEditor.messages.focus');
		this.focusPendingComposer();
	}

	async respondToViewedAnnotation(): Promise<void> {
		const viewed = this.viewedAnnotation;
		if (viewed === undefined || this.pendingPrompt !== undefined || this.busy || this.responseOpening) {
			return;
		}

		this.responseOpening = true;
		this.busy = true;
		this.notice = { tone: 'info', message: 'Preparing annotation response…' };
		this.postState();
		try {
			const [agents, work] = await Promise.all([
				(this.services.listAgents ?? listAgentsViaCli)(this.cliPath(), viewed.cwd),
				(this.services.listWork ?? listWorkViaCli)(this.cliPath(), viewed.cwd),
			]);
			this.agentsState = agents.length === 0 ? { kind: 'empty' } : { kind: 'ready', agents };
			this.work = work;
			const prepared = await prepareAnnotationResponse(
				viewed.sourceUri,
				viewed.annotation,
				work,
				agents,
				{
					activeEditor: () => {
						const editor = vscode.window.activeTextEditor;
						return editor === undefined ? undefined : {
							sourceUri: editor.document.uri.toString(),
							line: editor.selection.active.line,
						};
					},
					linkedSourceUri: file => workspaceFileUri(viewed.cwd, file),
					readAnnotations: sourceUri => (this.services.readAnnotations ?? readAnnotationsViaCli)(
						this.cliPath(),
						{ workspace: { cwd: viewed.cwd }, document: { uri: sourceUri } },
					),
					readSourceDocument: async sourceUri => {
						const uri = vscode.Uri.parse(sourceUri);
						const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
						if (workspaceFolder === undefined
							|| path.normalize(workspaceFolder.uri.fsPath) !== path.normalize(viewed.cwd)) {
							throw new Error('The annotation source is outside the current workspace.');
						}
						const document = await vscode.workspace.openTextDocument(uri);
						return {
							sourceUri: document.uri.toString(),
							lineCount: document.lineCount,
							isDirty: document.isDirty,
							lineAt: line => ({ text: document.lineAt(line).text }),
						};
					},
				},
			);
			await this.openComposer(
				prepared.prompt,
				viewed.cwd,
				agents,
				prepared.preferredAgentId,
				{ continuity: prepared.continuity },
			);
		} catch (error) {
			this.setError(`The annotation response could not be opened. ${errorMessage(error)}`);
		} finally {
			this.responseOpening = false;
			this.busy = false;
			this.postState();
			this.focusPendingComposer();
		}
	}

	diagnostics(): MessagesDiagnostics {
		return {
			viewResolved: this.activeMessagesView !== undefined,
			viewVisible: this.activeMessagesView?.visible === true,
			annotationMarkerLines: annotationLines(this.visibleAnnotations()),
			state: this.currentState(),
		};
	}

	async submitPendingMessage(message = 'Please handle this prompt.', agentId?: AgentId): Promise<void> {
		const target = agentId ?? this.pendingPrompt?.targetAgentId;
		if (target !== undefined) { await this.startSubmission(message, target); }
	}

	cancelPendingMessage(): void {
		const pending = this.pendingPrompt;
		const prompt = pending?.prompt;
		this.pendingPrompt = undefined;
		this.busy = false;
		this.notice = undefined;
		this.postState();
		void this.ensureAnnotationIndexWorkspace();
		if (prompt !== undefined) { void this.services.returnToSource(prompt); }
		if (pending?.reservedWork !== undefined) { void this.refreshAgentState(pending.cwd); }
	}

	async setActiveLocation(location: ActiveLocation | undefined, reload = false): Promise<void> {
		this.activeLocation = location;
		void this.ensureAnnotationIndexWorkspace();
		if (location === undefined) {
			this.services.showAnnotationMarkers?.(undefined, []);
			this.postState();
			return;
		}
		void this.refreshAgentState(location.cwd);
		if (!reload && this.loadedAnnotations?.sourceUri === location.sourceUri && this.loadedAnnotations.cwd === location.cwd) {
			this.updateViewedAnnotation();
			this.postState();
			return;
		}
		await this.refreshActiveAnnotations();
	}

	async refreshAgentState(cwd = this.currentCwd()): Promise<void> {
		if (cwd === undefined) { return; }
		const generation = ++this.agentLoadGeneration;
		try {
			let [agents, work] = await Promise.all([
				(this.services.listAgents ?? listAgentsViaCli)(this.cliPath(), cwd),
				(this.services.listWork ?? listWorkViaCli)(this.cliPath(), cwd),
			]);
			if (!this.recoveredWorkspaces.has(cwd)) {
				this.recoveredWorkspaces.add(cwd);
				const stale = work.filter(item => item.status === 'working'
					&& item.assignment !== undefined && !this.activeRuns.has(item.agentId));
				for (const item of stale) {
					try {
						await (this.services.requeueWork ?? requeueWorkViaCli)(this.cliPath(), cwd, {
							agentId: item.agentId,
							sessionId: item.assignment!.sessionId,
							workId: item.id,
							assignmentSequence: item.assignment!.sequence,
						}, 'Returned to queue after the editor restarted.');
					} catch {
						// A concurrent host may already have reconciled this assignment.
					}
				}
				if (await this.recoverUnreadyWork(cwd, work)) {
					[agents, work] = await Promise.all([
						(this.services.listAgents ?? listAgentsViaCli)(this.cliPath(), cwd),
						(this.services.listWork ?? listWorkViaCli)(this.cliPath(), cwd),
					]);
				}
				if (stale.length > 0) {
					[agents, work] = await Promise.all([
						(this.services.listAgents ?? listAgentsViaCli)(this.cliPath(), cwd),
						(this.services.listWork ?? listWorkViaCli)(this.cliPath(), cwd),
					]);
				}
			}
			if (generation !== this.agentLoadGeneration) { return; }
			this.agentsState = agents.length === 0 ? { kind: 'empty' } : { kind: 'ready', agents };
			this.work = work;
			this.postState();
			for (const agent of agents) {
				if (agent.session.state === 'available'
					&& work.some(item => item.agentId === agent.id && item.status === 'waiting' && item.ready)) {
					void this.processQueue(cwd, agent.id);
				}
			}
		} catch (error) {
			if (generation === this.agentLoadGeneration) {
				this.agentsState = { kind: 'error', message: errorMessage(error), recoverable: true };
				this.postState();
			}
		}
		}

	private async recoverUnreadyWork(cwd: string, work: readonly UserAnnotationWorkItem[]): Promise<boolean> {
		let changed = false;
		const pendingId = this.pendingPrompt?.reservedWork?.id;
		for (const item of work.filter(candidate => candidate.status === 'waiting' && !candidate.ready && candidate.id !== pendingId)) {
			try {
				await (this.services.appendAnnotation ?? appendAnnotationViaCli)(this.cliPath(), {
					workspace: { cwd },
					document: { uri: item.source.uri, line: item.source.line },
					annotation: {
						id: item.id, message: item.prompt.text, preset: item.prompt.preset, scope: item.prompt.scope,
					},
				});
				await (this.services.markWorkReady ?? markWorkReadyViaCli)(this.cliPath(), cwd, item.id, item.agentId);
				changed = true;
			} catch (error) {
				this.notice = {
					tone: 'error',
					message: `Queued work is waiting for annotation recovery. Refresh to retry. ${errorMessage(error)}`,
				};
			}
		}
		return changed;
	}

	async refreshActiveAnnotations(): Promise<void> {
		const location = this.activeLocation;
		const generation = ++this.annotationLoadGeneration;
		if (location === undefined) { return; }
		try {
			const companion = await (this.services.readAnnotations ?? readAnnotationsViaCli)(
				this.cliPath(),
				{ workspace: { cwd: location.cwd }, document: { uri: location.sourceUri } },
			);
			if (generation !== this.annotationLoadGeneration || this.activeLocation?.sourceUri !== location.sourceUri) { return; }
			this.loadedAnnotations = {
				sourceUri: location.sourceUri, cwd: location.cwd, annotations: companion.annotations,
				currentPermanentCommit: companion.currentPermanentCommit,
				currentPermanentAnnotationIds: companion.currentPermanentAnnotationIds,
			};
			this.workflow = { ...this.workflow, currentPermanentCommit: companion.currentPermanentCommit };
			this.services.showAnnotationMarkers?.(location.sourceUri, annotationLines(this.visibleAnnotations()));
			this.updateViewedAnnotation();
			this.postState();
		} catch (error) {
			if (generation === this.annotationLoadGeneration) {
				this.loadedAnnotations = undefined;
				this.services.showAnnotationMarkers?.(location.sourceUri, []);
				this.postState();
			}
			console.error('sundial-editor: failed to load source annotations', error);
		}
	}

	async refreshAnnotationsForCompanion(companionPath: string): Promise<void> {
		const location = this.activeLocation;
		if (location !== undefined) {
			const expected = companionPathForSource(location.cwd, location.sourceUri);
			if (path.normalize(companionPath) === path.normalize(expected)) {
				await this.refreshActiveAnnotations();
			}
		}
		const cwd = this.currentCwd();
		if (cwd !== undefined && isInsideWorkspace(cwd, companionPath)) {
			this.scheduleAnnotationIndexRefresh(cwd);
		}
	}

	async refreshAnnotationIndex(cwd = this.currentCwd(), workspaceChanged = false): Promise<void> {
		if (cwd === undefined) {
			this.annotationIndexCwd = undefined;
			this.annotationIndexState = { kind: 'empty' };
			this.postState();
			return;
		}
		const generation = ++this.annotationIndexLoadGeneration;
		if (workspaceChanged || this.annotationIndexCwd !== cwd) {
			this.annotationIndexCwd = cwd;
			this.annotationIndexState = { kind: 'loading' };
			this.postState();
		}
		try {
			const result = await (this.services.listAnnotations ?? listAnnotationsViaCli)(
				this.cliPath(), { workspace: { cwd } },
			);
			if (generation !== this.annotationIndexLoadGeneration || this.currentCwd() !== cwd) { return; }
			this.workflow = { ...this.workflow, currentPermanentCommit: result.currentPermanentCommit };
			this.annotationIndexState = result.groups.length === 0
				? { kind: 'empty' }
				: {
					kind: 'ready',
					groups: result.groups.map(group => ({ ...group, annotations: [...group.annotations].reverse() })),
				};
			this.postState();
		} catch (error) {
			if (generation !== this.annotationIndexLoadGeneration || this.currentCwd() !== cwd) { return; }
			this.annotationIndexState = { kind: 'error', message: errorMessage(error), recoverable: true };
			this.postState();
		}
	}

	private async ensureAnnotationIndexWorkspace(): Promise<void> {
		const cwd = this.currentCwd();
		if (cwd === this.annotationIndexCwd) { return; }
		await this.refreshAnnotationIndex(cwd, true);
	}

	private scheduleAnnotationIndexRefresh(cwd: string): void {
		if (this.annotationIndexRefreshTimer !== undefined) { clearTimeout(this.annotationIndexRefreshTimer); }
		this.annotationIndexRefreshTimer = setTimeout(() => {
			this.annotationIndexRefreshTimer = undefined;
			if (this.currentCwd() === cwd) { void this.refreshAnnotationIndex(cwd); }
		}, 50);
	}

	toggleAnnotationPin(): void {
		if (this.viewedAnnotation === undefined) { return; }
		this.annotationPinned = !this.annotationPinned;
		if (!this.annotationPinned) { this.updateViewedAnnotation(); }
		this.postState();
	}

	toggleAnnotationFilter(): void {
		this.workflow = { ...this.workflow, annotationFilterEnabled: !this.workflow.annotationFilterEnabled };
		const loaded = this.loadedAnnotations;
		if (loaded !== undefined && this.viewedAnnotation?.sourceUri === loaded.sourceUri
			&& !this.visibleAnnotations(loaded).some(annotation => annotation.id === this.viewedAnnotation?.annotation.id)) {
			this.viewedAnnotation = undefined;
			this.annotationPinned = false;
		}
		this.updateViewedAnnotation(true);
		this.services.showAnnotationMarkers?.(loaded?.sourceUri, annotationLines(this.visibleAnnotations()));
		this.postState();
	}

	async selectAdjacentAnnotation(direction: -1 | 1): Promise<void> {
		const loaded = this.loadedAnnotations;
		const viewed = this.viewedAnnotation;
		if (loaded === undefined || viewed?.sourceUri !== loaded.sourceUri) { return; }
		const annotations = orderedAnnotations(this.visibleAnnotations(loaded));
		const currentIndex = annotations.findIndex(annotation => annotation.id === viewed.annotation.id);
		const next = annotations[currentIndex + direction];
		if (next === undefined) { return; }
		this.viewedAnnotation = { sourceUri: loaded.sourceUri, cwd: loaded.cwd, annotation: next };
		this.postState();
		await this.services.revealAnnotation?.(loaded.sourceUri, next.anchor.line);
	}

	async deleteViewedAnnotation(confirmedForTest = false): Promise<void> {
		const viewed = this.viewedAnnotation;
		if (viewed === undefined) { return; }
		const confirmed = confirmedForTest || (this.services.confirmDeleteAnnotation === undefined
			? await vscode.window.showWarningMessage(
				viewed.annotation.kind === 'user'
					? 'Delete this user annotation, its official responses, linked agent annotations, and corresponding work item?'
					: 'Delete this agent annotation and its link from the user annotation?',
				{ modal: true }, 'Delete',
			) === 'Delete'
			: await this.services.confirmDeleteAnnotation(viewed.annotation));
		if (!confirmed) { return; }
		try {
			await (this.services.deleteAnnotation ?? deleteAnnotationViaCli)(this.cliPath(), {
				workspace: { cwd: viewed.cwd }, document: { uri: viewed.sourceUri }, annotation: { id: viewed.annotation.id },
			});
			const active = [...this.activeRuns.values()].find(run => run.work.id === viewed.annotation.id);
			if (active !== undefined) {
				active.cancelReason = 'Annotation deleted by the user.';
				active.run.cancel();
			}
			const loaded = this.loadedAnnotations;
			if (loaded?.sourceUri === viewed.sourceUri) {
				const ordered = orderedAnnotations(this.visibleAnnotations(loaded));
				const deletedIndex = ordered.findIndex(annotation => annotation.id === viewed.annotation.id);
				const remaining = loaded.annotations.filter(annotation => annotation.id !== viewed.annotation.id);
				this.loadedAnnotations = {
					...loaded,
					annotations: remaining,
					currentPermanentAnnotationIds: loaded.currentPermanentAnnotationIds.filter(id => id !== viewed.annotation.id),
				};
				const visibleRemaining = orderedAnnotations(this.visibleAnnotations());
				const replacement = visibleRemaining[Math.min(Math.max(deletedIndex, 0), visibleRemaining.length - 1)];
				this.viewedAnnotation = replacement === undefined ? undefined : { sourceUri: loaded.sourceUri, cwd: loaded.cwd, annotation: replacement };
				this.annotationPinned = false;
				this.services.showAnnotationMarkers?.(loaded.sourceUri, annotationLines(visibleRemaining));
			}
			this.postState();
			await Promise.all([this.refreshAgentState(viewed.cwd), this.refreshAnnotationIndex(viewed.cwd)]);
		} catch (error) { this.setError(`The annotation could not be deleted. ${errorMessage(error)}`); }
	}

	async revealWorkAnnotation(annotationId: UserAnnotationId): Promise<void> {
		const annotationWork = this.work.find(item => item.id === annotationId);
		if (annotationWork === undefined) { return; }
		await this.services.revealAnnotation?.(annotationWork.source.uri, annotationWork.source.line, false);
	}

	async openLinkedAnnotation(link: AnnotationLink): Promise<void> {
		const cwd = this.viewedAnnotation?.cwd ?? this.currentCwd();
		if (cwd === undefined) { return; }
		const sourceUri = vscode.Uri.file(path.join(cwd, ...link.file.split('/'))).toString();
		await this.services.revealAnnotation?.(sourceUri, link.line, false);
		const companion = await (this.services.readAnnotations ?? readAnnotationsViaCli)(
			this.cliPath(), { workspace: { cwd }, document: { uri: sourceUri } },
		);
		this.activeLocation = { sourceUri, line: link.line ?? 0, cwd };
		this.loadedAnnotations = {
			sourceUri, cwd, annotations: companion.annotations,
			currentPermanentCommit: companion.currentPermanentCommit,
			currentPermanentAnnotationIds: companion.currentPermanentAnnotationIds,
		};
		this.workflow = { ...this.workflow, currentPermanentCommit: companion.currentPermanentCommit };
		const annotation = this.visibleAnnotations().find(candidate => candidate.id === link.annotationId);
		if (annotation === undefined) {
			this.viewedAnnotation = undefined;
			this.annotationPinned = false;
			this.updateViewedAnnotation(true);
			this.services.showAnnotationMarkers?.(sourceUri, annotationLines(this.visibleAnnotations()));
			this.setError(this.workflow.annotationFilterEnabled
				? 'The linked annotation is outside the current permanent-commit filter.'
				: 'The linked annotation no longer exists.');
			return;
		}
		this.viewedAnnotation = { sourceUri, cwd, annotation };
		this.annotationPinned = false;
		this.services.showAnnotationMarkers?.(sourceUri, annotationLines(this.visibleAnnotations()));
		this.postState();
	}

	private handleWebviewMessage(message: WebviewToHost): void {
		switch (message.kind) {
			case 'ready': this.postState(); this.focusPendingComposer(); return;
			case 'submit': void this.startSubmission(message.message, message.targetAgentId); return;
			case 'selectTarget':
				if (this.pendingPrompt !== undefined) {
					this.pendingPrompt = { ...this.pendingPrompt, targetAgentId: message.targetAgentId };
					this.postState();
				}
				return;
			case 'cancel': this.cancelPendingMessage(); return;
			case 'refresh': void this.refreshAgentState(); return;
			case 'renameAgent': void this.renameAgent(message.agentId, message.name); return;
			case 'openAgent': void this.openAgent(message.agentId); return;
			case 'interruptAgent': void this.interruptAgent(message.agentId); return;
			case 'resetAgent': void this.resetAgent(message.agentId); return;
			case 'revealAnnotation': void this.revealWorkAnnotation(message.annotationId); return;
			case 'openAnnotation':
				void this.openLinkedAnnotation(message.link)
					.catch(error => this.setError(`The annotation could not be opened. ${errorMessage(error)}`));
				return;
			case 'previousAnnotation': void this.selectAdjacentAnnotation(-1); return;
			case 'nextAnnotation': void this.selectAdjacentAnnotation(1); return;
			case 'toggleAnnotationPin': this.toggleAnnotationPin(); return;
			case 'toggleAnnotationFilter': this.toggleAnnotationFilter(); return;
			case 'respondToAnnotation': void this.respondToViewedAnnotation(); return;
			case 'retryAnnotationIndex': void this.refreshAnnotationIndex(); return;
			case 'deleteAnnotation': void this.deleteViewedAnnotation(); return;
			case 'setPaneSplitPercent': this.persistPaneSplitPercent(message.percent); return;
			default: { const unhandled: never = message; throw new Error(`Unexpected webview message: ${JSON.stringify(unhandled)}`); }
		}
	}

	private async startSubmission(message: string, agentId: AgentId): Promise<void> {
		const pending = this.pendingPrompt;
		if (pending === undefined || this.busy) { return; }
		const draft = pending.reservedWork === undefined ? message : pending.draft;
		if (draft.trim() === '') { this.setError('Enter a message before sending.'); return; }
		const agent = this.currentAgents().find(candidate => candidate.id === agentId);
		if (agent === undefined) { this.setError('The selected agent is no longer available. Refresh and choose another agent.'); return; }
		if (pending.reservedWork !== undefined && pending.reservedWork.agentId !== agentId) {
			this.setError('This queued message is already reserved for another agent. Retry with its original target.');
			return;
		}
		this.busy = true;
		this.notice = { tone: 'info', message: pending.reservedWork === undefined ? 'Reserving queued work…' : 'Retrying durable annotation persistence…' };
		this.pendingPrompt = { ...pending, draft, targetAgentId: agentId };
		this.postState();
		try {
			if (agent.session.state !== 'available') {
				const confirmed = this.services.confirmFreshSession === undefined
					? await vscode.window.showWarningMessage(
						'No active session found; this operation will create a fresh session.',
						{ modal: true }, 'Continue',
					) === 'Continue'
					: await this.services.confirmFreshSession(agent);
				if (!confirmed) { this.notice = undefined; return; }
				await (this.services.ensureAgentSession ?? ensureAgentSessionViaCli)(this.cliPath(), pending.cwd, agentId);
			}
			const work = pending.reservedWork ?? await (this.services.enqueueWork ?? enqueueWorkViaCli)(
				this.cliPath(), pending.cwd, agentId, {
					source: {
						uri: pending.prompt.sourceUri,
						line: pending.prompt.sourceLine,
					},
					prompt: { preset: pending.prompt.preset, scope: pending.prompt.scope, text: draft },
				},
			);
			this.pendingPrompt = { ...pending, draft, targetAgentId: agentId, reservedWork: work };
			const annotation = await (this.services.appendAnnotation ?? appendAnnotationViaCli)(this.cliPath(), {
				workspace: { cwd: pending.cwd },
				document: {
					uri: pending.prompt.sourceUri,
					line: pending.prompt.sourceLine,
				},
				annotation: { id: work.id, message: draft, preset: pending.prompt.preset, scope: pending.prompt.scope },
			});
			this.acceptSavedAnnotation(annotation, pending.cwd);
			await (this.services.markWorkReady ?? markWorkReadyViaCli)(this.cliPath(), pending.cwd, work.id, agentId);
			this.pendingPrompt = undefined;
			this.notice = { tone: 'info', message: `Queued for ${agent.name}.` };
			await this.refreshAgentState(pending.cwd);
			await this.services.returnToSource(pending.prompt);
		} catch (error) {
			await this.refreshAgentState(pending.cwd);
			this.setError(`The queued message could not be made ready. Retry preserves its identity. ${errorMessage(error)}`);
		} finally {
			this.busy = false;
			this.postState();
			this.focusPendingComposer();
		}
	}

	private async processQueue(cwd: string, agentId: AgentId): Promise<void> {
		if (this.activeRuns.has(agentId)) { return; }
		let work: UserAnnotationWorkItem | undefined;
		try { work = await (this.services.claimWork ?? claimWorkViaCli)(this.cliPath(), cwd, agentId); }
		catch (error) { this.setError(`Could not claim queued work. ${errorMessage(error)}`); return; }
		if (work?.assignment === undefined) { return; }
		const assignment = work.assignment;
		let run: AgentRun;
		try {
			run = (this.services.startAgentRun ?? startManagedAgentRun)({
				cliPath: this.cliPath(), cwd, agentId, agentSessionId: assignment.sessionId,
				userAnnotationId: work.id, assignmentSequence: assignment.sequence,
			}, () => undefined);
		} catch (error) {
			await this.safeRequeue(cwd, work, `Provider startup failed: ${errorMessage(error)}`);
			return;
		}
		const active: ActiveRun = { work, run };
		this.activeRuns.set(agentId, active);
		const statusRefresh = setInterval(() => { void this.refreshWorkOnly(cwd); }, 1_500);
		void this.refreshAgentState(cwd);
		try {
			const result = await run.completion;
			const reason = active.cancelReason
				?? (result.exitCode === 0
					? 'Provider turn ended without recording an official response.'
					: result.stderr || `Provider exited with code ${result.exitCode}.`);
			await this.safeRequeue(cwd, work, reason);
		} catch (error) {
			await this.safeRequeue(cwd, work, active.cancelReason ?? `Provider failed: ${errorMessage(error)}`);
		} finally {
			clearInterval(statusRefresh);
			if (this.activeRuns.get(agentId) === active) { this.activeRuns.delete(agentId); }
			await this.refreshAgentState(cwd);
			if (this.activeLocation?.cwd === cwd) { await this.refreshActiveAnnotations(); }
		}
	}

	private async refreshWorkOnly(cwd: string): Promise<void> {
		try {
			this.work = await (this.services.listWork ?? listWorkViaCli)(this.cliPath(), cwd);
			this.postState();
		} catch {
			// A full lifecycle refresh reports actionable errors; polling stays quiet.
		}
	}

	private async safeRequeue(cwd: string, work: UserAnnotationWorkItem, reason: string): Promise<void> {
		if (work.assignment === undefined) { return; }
		try {
			await (this.services.requeueWork ?? requeueWorkViaCli)(this.cliPath(), cwd, {
				agentId: work.agentId,
				sessionId: work.assignment.sessionId,
				workId: work.id,
				assignmentSequence: work.assignment.sequence,
			}, reason);
		} catch {
			// Interrupt/reset may already have performed the same compare-and-transition.
		}
	}

	private async renameAgent(agentId: AgentId, name: string): Promise<void> {
		const cwd = this.currentCwd();
		if (cwd === undefined) { return; }
		try {
			await (this.services.renameAgent ?? renameAgentViaCli)(this.cliPath(), cwd, agentId, name);
			await this.refreshAgentState(cwd);
		} catch (error) { await this.refreshAgentState(cwd); this.setError(`Agent could not be renamed. ${errorMessage(error)}`); }
	}

	private async openAgent(agentId: AgentId): Promise<void> {
		const cwd = this.currentCwd();
		const agent = this.currentAgents().find(candidate => candidate.id === agentId);
		if (cwd === undefined || agent === undefined) { return; }
		try {
			const result = await (this.services.openAgent ?? openAgentViaCli)(this.cliPath(), cwd, agentId);
			if (this.services.openTerminal !== undefined) {
				this.services.openTerminal(agent.name, result.command, result.args, cwd);
			} else {
				const terminal = vscode.window.createTerminal({ name: `Sundial: ${agent.name}`, cwd });
				terminal.sendText(shellCommand(result.command, result.args));
				terminal.show();
			}
		} catch (error) { this.setError(`Agent conversation could not be opened. ${errorMessage(error)}`); }
	}

	private async interruptAgent(agentId: AgentId): Promise<void> {
		const cwd = this.currentCwd();
		if (cwd === undefined) { return; }
		const active = this.activeRuns.get(agentId);
		if (active !== undefined) { active.cancelReason = 'Interrupted by the user.'; active.run.cancel(); }
		try {
			await (this.services.interruptAgent ?? interruptAgentViaCli)(this.cliPath(), cwd, agentId);
			await this.refreshAgentState(cwd);
		} catch (error) { await this.refreshAgentState(cwd); this.setError(`Agent could not be interrupted. ${errorMessage(error)}`); }
	}

	private async resetAgent(agentId: AgentId): Promise<void> {
		const cwd = this.currentCwd();
		const agent = this.currentAgents().find(candidate => candidate.id === agentId);
		if (cwd === undefined || agent === undefined) { return; }
		const confirmed = this.services.confirmResetAgent === undefined
			? await vscode.window.showWarningMessage(
				`This will reset ${agent.name}, interrupt any active work, and delete all work that has been assigned to this agent. Continue?`,
				{ modal: true }, 'Reset',
			) === 'Reset'
			: await this.services.confirmResetAgent(agent);
		if (!confirmed) { return; }
		const active = this.activeRuns.get(agentId);
		if (active !== undefined) { active.cancelReason = 'Session reset by the user.'; active.run.cancel(); }
		try {
			await (this.services.resetAgent ?? resetAgentViaCli)(this.cliPath(), cwd, agentId);
			await this.refreshAgentState(cwd);
		} catch (error) { await this.refreshAgentState(cwd); this.setError(`Agent session could not be reset. ${errorMessage(error)}`); }
	}

	private async loadAgents(cwd: string): Promise<readonly NamedAgent[]> {
		const agents = await (this.services.listAgents ?? listAgentsViaCli)(this.cliPath(), cwd);
		this.agentsState = agents.length === 0 ? { kind: 'empty' } : { kind: 'ready', agents };
		this.postState();
		return agents;
	}

	private acceptSavedAnnotation(annotation: Annotation, cwd: string): void {
		const pending = this.pendingPrompt;
		const loaded = this.loadedAnnotations;
		if (pending !== undefined && loaded?.sourceUri === pending.prompt.sourceUri) {
			const annotations = loaded.annotations.some(existing => existing.id === annotation.id) ? loaded.annotations : [...loaded.annotations, annotation];
			const currentPermanentAnnotationIds = annotation.permanentBaseCommit === loaded.currentPermanentCommit
				&& !loaded.currentPermanentAnnotationIds.includes(annotation.id)
				? [...loaded.currentPermanentAnnotationIds, annotation.id]
				: loaded.currentPermanentAnnotationIds;
			this.loadedAnnotations = { ...loaded, annotations, currentPermanentAnnotationIds };
			this.services.showAnnotationMarkers?.(pending.prompt.sourceUri, annotationLines(this.visibleAnnotations()));
		}
		if (!this.annotationPinned && pending !== undefined) {
			this.viewedAnnotation = { sourceUri: pending.prompt.sourceUri, cwd, annotation };
		}
		this.postState();
		void this.refreshAnnotationIndex(cwd);
	}

	private focusPendingComposer(): void {
		if (this.activeMessagesView?.visible !== true || this.pendingPrompt === undefined) { return; }
		this.postToMessagesWebviews({ kind: 'focusComposer' });
	}

	private updateViewedAnnotation(allowFileFallback = false): void {
		const location = this.activeLocation;
		const loaded = this.loadedAnnotations;
		if (location === undefined || loaded?.sourceUri !== location.sourceUri) { return; }
		const visible = this.visibleAnnotations(loaded);
		if (this.viewedAnnotation?.sourceUri === loaded.sourceUri) {
			const refreshed = visible.find(annotation => annotation.id === this.viewedAnnotation?.annotation.id);
			this.viewedAnnotation = refreshed === undefined ? undefined : { sourceUri: loaded.sourceUri, cwd: loaded.cwd, annotation: refreshed };
			if (refreshed === undefined) { this.annotationPinned = false; }
		}
		if (!this.annotationPinned) {
			const annotation = annotationForLine(visible, location.line, this.viewedAnnotation?.annotation.id)
				?? (allowFileFallback ? orderedAnnotations(visible)[0] : undefined);
			if (annotation !== undefined) { this.viewedAnnotation = { sourceUri: loaded.sourceUri, cwd: loaded.cwd, annotation }; }
		}
	}

	private currentState(): MessagesState {
		const viewer = this.annotationViewerState();
		const base = {
			agents: this.agentsState,
			work: this.work,
			paneSplitPercent: this.paneSplitPercent,
			workflow: this.workflow,
			annotationIndex: this.annotationIndexState,
			...(this.busy ? { busy: true as const } : {}),
			...(this.notice === undefined ? {} : { notice: this.notice }),
			...(viewer === undefined ? {} : { annotationViewer: viewer }),
		};
		if (this.pendingPrompt === undefined) {
			return base;
		}
		return {
			...base,
			prompt: this.pendingPrompt.prompt,
			draft: this.pendingPrompt.draft,
			...(this.pendingPrompt.targetAgentId === undefined ? {} : { targetAgentId: this.pendingPrompt.targetAgentId }),
			...(this.pendingPrompt.response === undefined ? {} : { response: this.pendingPrompt.response }),
		};
	}

	private annotationViewerState(): MessagesState['annotationViewer'] {
		const viewed = this.viewedAnnotation;
		if (viewed === undefined) { return undefined; }
		const loaded = this.loadedAnnotations;
		const annotations = loaded?.sourceUri === viewed.sourceUri ? orderedAnnotations(this.visibleAnnotations(loaded)) : [viewed.annotation];
		const index = annotations.findIndex(annotation => annotation.id === viewed.annotation.id);
		const position = index < 0 ? 0 : index;
		return {
			sourceUri: viewed.sourceUri, annotation: presentAnnotation(viewed.annotation, this.currentAgents()),
			position: position + 1, total: Math.max(annotations.length, 1), pinned: this.annotationPinned,
			canPrevious: position > 0, canNext: position >= 0 && position < annotations.length - 1,
		};
	}

	private currentAgents(): readonly NamedAgent[] {
		return this.agentsState.kind === 'ready' ? this.agentsState.agents : [];
	}

	private visibleAnnotations(loaded = this.loadedAnnotations): readonly Annotation[] {
		return loaded === undefined ? [] : annotationsForCurrentPermanentCommit(
			loaded.annotations,
			loaded.currentPermanentAnnotationIds,
			this.workflow.annotationFilterEnabled,
		);
	}

	private currentCwd(): string | undefined {
		return this.pendingPrompt?.cwd ?? this.activeLocation?.cwd ?? this.services.workspaceRootCwd?.();
	}

	private setError(message: string): void {
		this.notice = { tone: 'error', message };
		this.postState();
	}

	private cliPath(): string {
		return this.services.cliPath?.() ?? vscode.workspace.getConfiguration('sundialEditor').get('cliPath', 'sundial-editor-cli');
	}

	private configuredPaneSplitPercent(): number {
		return normalizePaneSplitPercent(
			vscode.workspace.getConfiguration('sundialEditor').get('paneSplitPercent', defaultPaneSplitPercent),
		);
	}

	private persistPaneSplitPercent(percent: number): void {
		this.paneSplitPercent = normalizePaneSplitPercent(percent);
		this.postState();
		const persistedPercent = this.paneSplitPercent;
		this.pendingPaneSplitWrites += 1;
		this.paneSplitPersistence = this.paneSplitPersistence
			.then(() => vscode.workspace.getConfiguration('sundialEditor').update(
				'paneSplitPercent',
				persistedPercent,
				vscode.ConfigurationTarget.Global,
			))
			.catch(error => {
				console.error(`sundial-editor: failed to persist ${paneSplitPercentConfiguration}`, error);
			})
			.finally(() => {
				this.pendingPaneSplitWrites -= 1;
				if (this.pendingPaneSplitWrites === 0) {
					this.refreshPaneSplitPercent();
				}
			});
	}

	private hostStateMessage(): HostToWebview { return { kind: 'state', state: this.currentState() }; }
	private postState(): void { this.postToMessagesWebviews(this.hostStateMessage()); }
	private postToMessagesWebviews(message: HostToWebview): void { for (const router of this.messageRouters) { router.post(message); } }
}

function orderedAnnotations(annotations: readonly Annotation[]): readonly Annotation[] {
	return annotations.map((annotation, index) => ({ annotation, index }))
		.sort((left, right) => annotationOrder(left.annotation) - annotationOrder(right.annotation) || left.index - right.index)
		.map(item => item.annotation);
}

function annotationLines(annotations: readonly Annotation[]): readonly number[] {
	return [...new Set(annotations.flatMap(annotation => annotation.anchor.line === null ? [] : [annotation.anchor.line]))]
		.sort((left, right) => left - right);
}

function annotationOrder(annotation: Annotation): number {
	return annotation.anchor.line ?? Number.MAX_SAFE_INTEGER;
}

function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }

function workspaceFileUri(cwd: string, workspaceRelativeFile: string): string | undefined {
	const resolved = path.resolve(cwd, ...workspaceRelativeFile.split('/'));
	const relative = path.relative(cwd, resolved);
	return relative === '' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)
		? undefined
		: vscode.Uri.file(resolved).toString();
}

function isInsideWorkspace(cwd: string, file: string): boolean {
	const relative = path.relative(path.resolve(cwd), path.resolve(file));
	return relative !== '' && !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`);
}

function shellCommand(command: string, args: readonly string[]): string {
	return [command, ...args].map(value => `'${value.replaceAll("'", "'\\''")}'`).join(' ');
}
