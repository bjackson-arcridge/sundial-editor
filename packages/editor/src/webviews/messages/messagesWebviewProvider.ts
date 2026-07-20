import * as vscode from 'vscode';
import type { AgentEvent } from '../../agentProtocol.js';
import type { UserAnnotation } from '../../annotationProtocol.js';
import {
	appendAnnotationViaCli,
	deleteAnnotationViaCli,
	readAnnotationsViaCli,
	startAgentRun,
	type AgentRun,
} from '../../cliRunner.js';
import type { PromptContext } from '../../promptCommand.js';
import { renderWebviewHtml } from '../shared/csp.js';
import { attachMessageRouter, type MessageRouter } from '../shared/messageRouter.js';
import {
	type HostToWebview,
	type MessagesState,
	type WebviewToHost,
	annotationForLine,
	appendAgentEvent,
	isValidWebviewToHostMessage,
} from './messages.js';

export interface MessagesServices {
	readonly returnToSource: (prompt: PromptContext) => void | Promise<void>;
	readonly startAgentRun?: typeof startAgentRun;
	readonly appendAnnotation?: typeof appendAnnotationViaCli;
	readonly deleteAnnotation?: typeof deleteAnnotationViaCli;
	readonly readAnnotations?: typeof readAnnotationsViaCli;
	readonly confirmDeleteAnnotation?: (annotation: UserAnnotation) => boolean | Promise<boolean>;
	readonly showAnnotationMarkers?: (sourceUri: string | undefined, lines: readonly number[]) => void;
	readonly revealAnnotation?: (sourceUri: string, line: number) => void | Promise<void>;
	readonly cliPath?: () => string;
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
	readonly draft: string;
	readonly submitted: boolean;
	readonly annotationSaved: boolean;
	readonly deliveryComplete: boolean;
}

interface ActiveLocation {
	readonly sourceUri: string;
	readonly line: number;
	readonly cwd: string;
}

export class MessagesWebviewProvider implements vscode.WebviewViewProvider {
	private readonly messageRouters = new Set<MessageRouter<WebviewToHost, HostToWebview>>();
	private activeMessagesView: vscode.WebviewView | undefined;
	private pendingPrompt: PendingPrompt | undefined;
	private submissionInProgress = false;
	private activeRun: { readonly prompt: PromptContext; readonly run: AgentRun; cancelRequested: boolean } | undefined;
	private runState: MessagesState['run'];
	private activeLocation: ActiveLocation | undefined;
	private loadedAnnotations: { readonly sourceUri: string; readonly cwd: string; readonly annotations: readonly UserAnnotation[] } | undefined;
	private viewedAnnotation: { readonly sourceUri: string; readonly cwd: string; readonly annotation: UserAnnotation } | undefined;
	private annotationPinned = false;
	private annotationLoadGeneration = 0;

	constructor(
		private readonly extensionUri: vscode.Uri,
		private readonly services: MessagesServices,
	) {}

	async resolveWebviewView(messagesView: vscode.WebviewView): Promise<void> {
		this.activeMessagesView = messagesView;
		messagesView.webview.options = {
			enableScripts: true,
			localResourceRoots: [this.extensionUri],
		};
		messagesView.webview.html = renderWebviewHtml({
			title: 'Sundial Editor Messages',
			bodyTagId: 'se-messages-app',
			scriptUri: messagesView.webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'dist', 'webviews', 'messages.js')),
			codiconUri: messagesView.webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'codicon.css')),
			cspSource: messagesView.webview.cspSource,
			initialState: this.hostStateMessage(),
			fallbackText: 'Loading Messages...',
		});

		const messagesRouter = attachMessageRouter<WebviewToHost, HostToWebview>(
			messagesView.webview,
			isValidWebviewToHostMessage,
			inboundMessage => this.handleWebviewMessage(inboundMessage),
		);
		this.messageRouters.add(messagesRouter);
		messagesView.onDidChangeVisibility(() => this.focusPendingComposer());
		messagesView.onDidDispose(() => {
			messagesRouter.dispose();
			this.messageRouters.delete(messagesRouter);
			if (this.activeMessagesView === messagesView) {
				this.activeMessagesView = undefined;
			}
		});

		if (messagesView.visible) {
			queueMicrotask(() => this.focusPendingComposer());
		}
	}

	async openPrompt(prompt: PromptContext): Promise<void> {
		if (this.activeRun !== undefined) {
			this.activeRun.cancelRequested = true;
			this.activeRun.run.cancel();
			try {
				await this.activeRun.run.completion;
			} catch {
				// The existing run reports its own recoverable failure before this prompt opens.
			}
		}
		this.pendingPrompt = { prompt, draft: '', submitted: false, annotationSaved: false, deliveryComplete: false };
		this.runState = undefined;
		this.postState();
		await vscode.commands.executeCommand('workbench.view.extension.sundialEditor');
		await vscode.commands.executeCommand('sundialEditor.messages.focus');
		this.focusPendingComposer();
	}

	diagnostics(): MessagesDiagnostics {
		return {
			viewResolved: this.activeMessagesView !== undefined,
			viewVisible: this.activeMessagesView?.visible === true,
			annotationMarkerLines: annotationLines(this.loadedAnnotations?.annotations ?? []),
			state: this.currentState(),
		};
	}

	async submitPendingMessage(message = 'Please handle this prompt.'): Promise<void> {
		await this.startSubmission(message);
	}

	cancelPendingMessage(): void {
		if (this.activeRun !== undefined) {
			this.activeRun.cancelRequested = true;
			this.activeRun.run.cancel();
			return;
		}
		const prompt = this.pendingPrompt?.prompt;
		this.pendingPrompt = undefined;
		this.runState = undefined;
		this.postState();
		if (prompt !== undefined) {
			void this.services.returnToSource(prompt);
		}
	}

	async setActiveLocation(location: ActiveLocation | undefined, reload = false): Promise<void> {
		this.activeLocation = location;
		if (location === undefined) {
			this.services.showAnnotationMarkers?.(undefined, []);
			this.postState();
			return;
		}
		if (!reload && this.loadedAnnotations?.sourceUri === location.sourceUri && this.loadedAnnotations.cwd === location.cwd) {
			this.updateViewedAnnotation();
			this.postState();
			return;
		}
		await this.refreshActiveAnnotations();
	}

	async refreshActiveAnnotations(): Promise<void> {
		const location = this.activeLocation;
		const generation = ++this.annotationLoadGeneration;
		if (location === undefined) {
			return;
		}
		try {
			const companion = await (this.services.readAnnotations ?? readAnnotationsViaCli)(
				this.cliPath(),
				{ workspace: { cwd: location.cwd }, document: { uri: location.sourceUri } },
			);
			if (generation !== this.annotationLoadGeneration || this.activeLocation?.sourceUri !== location.sourceUri) {
				return;
			}
			this.loadedAnnotations = { sourceUri: location.sourceUri, cwd: location.cwd, annotations: companion.annotations };
			this.services.showAnnotationMarkers?.(location.sourceUri, annotationLines(companion.annotations));
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

	toggleAnnotationPin(): void {
		if (this.viewedAnnotation === undefined) {
			return;
		}
		this.annotationPinned = !this.annotationPinned;
		if (!this.annotationPinned) {
			this.updateViewedAnnotation();
		}
		this.postState();
	}

	async selectAdjacentAnnotation(direction: -1 | 1): Promise<void> {
		const loaded = this.loadedAnnotations;
		const viewed = this.viewedAnnotation;
		if (loaded === undefined || viewed?.sourceUri !== loaded.sourceUri) {
			return;
		}
		const annotations = orderedAnnotations(loaded.annotations);
		const currentIndex = annotations.findIndex(annotation => annotation.id === viewed.annotation.id);
		const next = annotations[currentIndex + direction];
		if (next === undefined) {
			return;
		}
		this.viewedAnnotation = { sourceUri: loaded.sourceUri, cwd: loaded.cwd, annotation: next };
		this.postState();
		await this.services.revealAnnotation?.(loaded.sourceUri, next.anchor.line);
	}

	async deleteViewedAnnotation(confirmedForTest = false): Promise<void> {
		const viewed = this.viewedAnnotation;
		if (viewed === undefined) {
			return;
		}
		const confirmed = confirmedForTest || (this.services.confirmDeleteAnnotation === undefined
			? await vscode.window.showWarningMessage('Delete this source annotation?', { modal: true }, 'Delete') === 'Delete'
			: await this.services.confirmDeleteAnnotation(viewed.annotation));
		if (!confirmed) {
			return;
		}
		try {
			await (this.services.deleteAnnotation ?? deleteAnnotationViaCli)(this.cliPath(), {
				workspace: { cwd: viewed.cwd },
				document: { uri: viewed.sourceUri },
				annotation: { id: viewed.annotation.id },
			});
			const loaded = this.loadedAnnotations;
			if (loaded?.sourceUri === viewed.sourceUri) {
				const ordered = orderedAnnotations(loaded.annotations);
				const deletedIndex = ordered.findIndex(annotation => annotation.id === viewed.annotation.id);
				const remaining = ordered.filter(annotation => annotation.id !== viewed.annotation.id);
				this.loadedAnnotations = { ...loaded, annotations: remaining };
				const replacement = remaining[Math.min(Math.max(deletedIndex, 0), remaining.length - 1)];
				this.viewedAnnotation = replacement === undefined
					? undefined
					: { sourceUri: loaded.sourceUri, cwd: loaded.cwd, annotation: replacement };
				this.annotationPinned = false;
				this.services.showAnnotationMarkers?.(loaded.sourceUri, annotationLines(remaining));
			} else {
				this.viewedAnnotation = undefined;
				this.annotationPinned = false;
			}
			this.postState();
		} catch (error) {
			this.handleAgentEvent({
				kind: 'error', recoverable: true,
				message: `The annotation could not be deleted. ${error instanceof Error ? error.message : String(error)}`,
			});
		}
	}

	private handleWebviewMessage(inboundMessage: WebviewToHost): void {
		switch (inboundMessage.kind) {
			case 'submit':
				void this.startSubmission(inboundMessage.message);
				return;
			case 'cancel': {
				this.cancelPendingMessage();
				return;
			}
			case 'previousAnnotation':
				void this.selectAdjacentAnnotation(-1);
				return;
			case 'nextAnnotation':
				void this.selectAdjacentAnnotation(1);
				return;
			case 'toggleAnnotationPin':
				this.toggleAnnotationPin();
				return;
			case 'deleteAnnotation':
				void this.deleteViewedAnnotation();
				return;
			default: {
				const unhandledMessage: never = inboundMessage;
				throw new Error(`Unexpected webview message: ${JSON.stringify(unhandledMessage)}`);
			}
		}
	}

	private focusPendingComposer(): void {
		if (this.activeMessagesView?.visible !== true || this.pendingPrompt === undefined) {
			return;
		}
		this.postState();
		this.postToMessagesWebviews({ kind: 'focusComposer' });
	}

	private async startSubmission(message: string): Promise<void> {
		const pending = this.pendingPrompt;
		if (pending === undefined || this.activeRun !== undefined || this.submissionInProgress) {
			return;
		}
		const draft = pending.submitted ? pending.draft : message;
		if (draft.trim() === '') {
			this.runState = {
				status: 'blocked',
				events: [{ kind: 'error', message: 'Enter a message before sending.', recoverable: true }],
			};
			this.postState();
			return;
		}

		const cwd = this.services.workspaceCwd?.(pending.prompt)
			?? vscode.workspace.getWorkspaceFolder(vscode.Uri.parse(pending.prompt.sourceUri))?.uri.fsPath;
		if (cwd === undefined) {
			this.runState = {
				status: 'blocked',
				events: [{ kind: 'error', message: 'The prompt is not inside an open workspace.', recoverable: true }],
			};
			this.postState();
			return;
		}
		this.submissionInProgress = true;

		this.pendingPrompt = { ...pending, draft, submitted: true };
		this.runState = {
			status: 'working',
			events: appendAgentEvent(this.runState?.events ?? [], {
				kind: 'status', status: 'working',
				message: pending.deliveryComplete ? 'Saving source annotation…' : 'Starting Codex…',
			}),
		};
		this.postState();

		const annotationPromise = pending.annotationSaved
			? Promise.resolve(true)
			: (this.services.appendAnnotation ?? appendAnnotationViaCli)(this.cliPath(), {
				workspace: { cwd },
				document: {
					uri: pending.prompt.sourceUri,
					line: pending.prompt.sourceLine,
					text: pending.prompt.anchorText,
					before: pending.prompt.anchorBefore,
					after: pending.prompt.anchorAfter,
				},
			annotation: {
					message: draft,
					preset: pending.prompt.preset,
					scope: pending.prompt.scope,
				},
			}).then(annotation => {
				this.acceptSavedAnnotation(annotation, cwd);
				return true;
			}).catch(error => {
				this.recordSubmissionError(`The source annotation could not be saved. Retry will not redeliver a message that already completed. ${error instanceof Error ? error.message : String(error)}`);
				return false;
			});

		let deliveryPromise: Promise<{ delivered: boolean; cancelled: boolean }>;
		if (pending.deliveryComplete) {
			deliveryPromise = Promise.resolve({ delivered: true, cancelled: false });
		} else {
			deliveryPromise = this.runSubmittedMessage(pending.prompt, draft, cwd);
		}

		const [annotationSaved, delivery] = await Promise.all([annotationPromise, deliveryPromise]);
		const latest = this.pendingPrompt;
		if (latest === undefined) {
			this.submissionInProgress = false;
			return;
		}
		const deliveryComplete = delivery.delivered || delivery.cancelled;
		if (annotationSaved && deliveryComplete) {
			this.pendingPrompt = undefined;
			if (this.runState !== undefined) {
				this.runState = { status: 'waiting', events: this.runState.events };
			}
			this.postState();
			this.submissionInProgress = false;
			await this.services.returnToSource(pending.prompt);
			return;
		}
		this.pendingPrompt = { ...latest, annotationSaved, deliveryComplete };
		this.runState = {
			status: 'blocked',
			events: this.runState?.events ?? [],
		};
		this.postState();
		this.submissionInProgress = false;
		this.focusPendingComposer();
	}

	private async runSubmittedMessage(prompt: PromptContext, draft: string, cwd: string): Promise<{ delivered: boolean; cancelled: boolean }> {
		let run: AgentRun;
		try {
			run = (this.services.startAgentRun ?? startAgentRun)({
				cliPath: this.cliPath(), cwd, prompt, message: draft,
			}, event => this.handleAgentEvent(event));
		} catch (error) {
			this.finishDeliveryFailure(error instanceof Error ? error.message : String(error));
			return { delivered: false, cancelled: false };
		}
		const activeRun = { prompt, run, cancelRequested: false };
		this.activeRun = activeRun;
		try {
			const result = await run.completion;
			if (activeRun.cancelRequested) {
				return { delivered: false, cancelled: true };
			}
			if (result.exitCode !== 0) {
				this.finishDeliveryFailure(result.stderr || `Sundial Editor CLI exited with code ${result.exitCode}.`);
				return { delivered: false, cancelled: false };
			}
			return { delivered: true, cancelled: false };
		} catch (error) {
			if (!activeRun.cancelRequested) {
				this.finishDeliveryFailure(error instanceof Error ? error.message : String(error));
			}
			return { delivered: false, cancelled: activeRun.cancelRequested };
		} finally {
			if (this.activeRun === activeRun) {
				this.activeRun = undefined;
			}
		}
	}

	private acceptSavedAnnotation(annotation: UserAnnotation, cwd: string): void {
		const pending = this.pendingPrompt;
		if (pending !== undefined) {
			this.pendingPrompt = { ...pending, annotationSaved: true };
		}
		const loaded = this.loadedAnnotations;
		if (pending !== undefined && loaded?.sourceUri === pending.prompt.sourceUri) {
			const annotations = loaded.annotations.some(existing => existing.id === annotation.id)
				? loaded.annotations
				: [...loaded.annotations, annotation];
			this.loadedAnnotations = { ...loaded, annotations };
			this.services.showAnnotationMarkers?.(pending.prompt.sourceUri, annotationLines(annotations));
		}
		if (!this.annotationPinned && pending !== undefined) {
			this.viewedAnnotation = { sourceUri: pending.prompt.sourceUri, cwd, annotation };
		}
		this.postState();
	}

	private recordSubmissionError(message: string): void {
		this.runState = {
			status: this.activeRun === undefined ? 'blocked' : 'working',
			events: appendAgentEvent(this.runState?.events ?? [], { kind: 'error', message, recoverable: true }),
		};
		this.postState();
	}

	private handleAgentEvent(event: AgentEvent): void {
		const events = appendAgentEvent(this.runState?.events ?? [], event);
		const status = event.kind === 'status'
			? event.status
			: event.kind === 'error' ? 'blocked' : (this.runState?.status ?? 'working');
		this.runState = { status, events };
		this.postState();
	}

	private finishDeliveryFailure(message: string): void {
		this.handleAgentEvent({ kind: 'error', message, recoverable: true });
		this.focusPendingComposer();
	}

	private updateViewedAnnotation(): void {
		const location = this.activeLocation;
		const loaded = this.loadedAnnotations;
		if (location === undefined || loaded?.sourceUri !== location.sourceUri) {
			return;
		}
		if (this.viewedAnnotation?.sourceUri === loaded.sourceUri) {
			const refreshed = loaded.annotations.find(annotation => annotation.id === this.viewedAnnotation?.annotation.id);
			if (refreshed !== undefined) {
				this.viewedAnnotation = { sourceUri: loaded.sourceUri, cwd: loaded.cwd, annotation: refreshed };
			} else {
				this.viewedAnnotation = undefined;
				this.annotationPinned = false;
			}
		}
		if (this.annotationPinned) {
			return;
		}
		const annotation = annotationForLine(loaded.annotations, location.line, this.viewedAnnotation?.annotation.id);
		if (annotation !== undefined) {
			this.viewedAnnotation = { sourceUri: loaded.sourceUri, cwd: loaded.cwd, annotation };
		}
	}

	private currentState(): MessagesState {
		const viewer = this.annotationViewerState();
		return {
			...(this.pendingPrompt === undefined ? {} : {
				prompt: this.pendingPrompt.prompt,
				draft: this.pendingPrompt.draft,
				...(this.pendingPrompt.submitted ? { submitted: true as const } : {}),
				...(this.pendingPrompt.annotationSaved ? { annotationSaved: true as const } : {}),
				...(this.pendingPrompt.deliveryComplete ? { deliveryComplete: true as const } : {}),
			}),
			...(this.runState === undefined ? {} : { run: this.runState }),
			...(viewer === undefined ? {} : { annotationViewer: viewer }),
		};
	}

	private annotationViewerState(): MessagesState['annotationViewer'] {
		const viewed = this.viewedAnnotation;
		if (viewed === undefined) {
			return undefined;
		}
		const loaded = this.loadedAnnotations;
		const annotations = loaded?.sourceUri === viewed.sourceUri
			? orderedAnnotations(loaded.annotations)
			: [viewed.annotation];
		const index = annotations.findIndex(annotation => annotation.id === viewed.annotation.id);
		const position = index < 0 ? 0 : index;
		return {
			sourceUri: viewed.sourceUri,
			annotation: viewed.annotation,
			position: position + 1,
			total: Math.max(annotations.length, 1),
			pinned: this.annotationPinned,
			canPrevious: position > 0,
			canNext: position >= 0 && position < annotations.length - 1,
		};
	}

	private cliPath(): string {
		return this.services.cliPath?.()
			?? vscode.workspace.getConfiguration('sundialEditor').get('cliPath', 'sundial-editor-cli');
	}

	private hostStateMessage(): HostToWebview {
		return { kind: 'state', state: this.currentState() };
	}

	private postState(): void {
		this.postToMessagesWebviews(this.hostStateMessage());
	}

	private postToMessagesWebviews(hostMessage: HostToWebview): void {
		for (const messagesRouter of this.messageRouters) {
			messagesRouter.post(hostMessage);
		}
	}
}

function orderedAnnotations(annotations: readonly UserAnnotation[]): readonly UserAnnotation[] {
	return annotations
		.map((annotation, index) => ({ annotation, index }))
		.sort((left, right) => left.annotation.anchor.line - right.annotation.anchor.line || left.index - right.index)
		.map(item => item.annotation);
}

function annotationLines(annotations: readonly UserAnnotation[]): readonly number[] {
	return [...new Set(annotations.map(annotation => annotation.anchor.line))].sort((left, right) => left - right);
}
