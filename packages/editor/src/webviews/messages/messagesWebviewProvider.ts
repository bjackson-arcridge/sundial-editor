import * as vscode from 'vscode';
import type { AgentEvent } from '../../agentProtocol.js';
import { startAgentRun, type AgentRun } from '../../cliRunner.js';
import type { PromptContext } from '../../promptCommand.js';
import { renderWebviewHtml } from '../shared/csp.js';
import { attachMessageRouter, type MessageRouter } from '../shared/messageRouter.js';
import {
	type HostToWebview,
	type MessagesState,
	type WebviewToHost,
	appendAgentEvent,
	isValidWebviewToHostMessage,
} from './messages.js';

export interface MessagesServices {
	readonly returnToSource: (prompt: PromptContext) => void | Promise<void>;
	readonly startAgentRun?: typeof startAgentRun;
	readonly cliPath?: () => string;
	readonly workspaceCwd?: (prompt: PromptContext) => string | undefined;
}

export interface MessagesDiagnostics {
	readonly viewResolved: boolean;
	readonly viewVisible: boolean;
	readonly state: MessagesState;
}

interface PendingPrompt {
	readonly prompt: PromptContext;
	readonly draft: string;
}

export class MessagesWebviewProvider implements vscode.WebviewViewProvider {
	private readonly messageRouters = new Set<MessageRouter<WebviewToHost, HostToWebview>>();
	private activeMessagesView: vscode.WebviewView | undefined;
	private pendingPrompt: PendingPrompt | undefined;
	private activeRun: { readonly prompt: PromptContext; readonly run: AgentRun } | undefined;
	private runState: MessagesState['run'];

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
			this.activeRun.run.cancel();
			try {
				await this.activeRun.run.completion;
			} catch {
				// The existing run reports its own recoverable failure before this prompt opens.
			}
		}
		this.pendingPrompt = {
			prompt,
			draft: '',
		};
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
			state: this.currentState(),
		};
	}

	async submitPendingMessage(message = 'Please handle this prompt.'): Promise<void> {
		await this.startSubmission(message);
	}

	private handleWebviewMessage(inboundMessage: WebviewToHost): void {
		switch (inboundMessage.kind) {
			case 'submit':
				void this.startSubmission(inboundMessage.message);
				return;
			case 'cancel': {
				if (this.activeRun !== undefined) {
					this.activeRun.run.cancel();
					return;
				}
				const prompt = this.pendingPrompt?.prompt;
				this.pendingPrompt = undefined;
				this.postState();
				if (prompt !== undefined) {
					void this.services.returnToSource(prompt);
				}
				return;
			}
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
		if (pending === undefined || this.activeRun !== undefined) {
			return;
		}
		if (message.trim() === '') {
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

		this.pendingPrompt = { prompt: pending.prompt, draft: message };
		this.runState = { status: 'working', events: [{ kind: 'status', status: 'working', message: 'Starting Codex…' }] };
		this.postState();
		let run: AgentRun;
		try {
			run = (this.services.startAgentRun ?? startAgentRun)({
				cliPath: this.services.cliPath?.() ?? vscode.workspace.getConfiguration('sundialEditor').get('cliPath', 'sundial-editor-cli'),
				cwd,
				prompt: pending.prompt,
				message,
			}, event => this.handleAgentEvent(event));
		} catch (error) {
			this.finishWithFailure(pending.prompt, error instanceof Error ? error.message : String(error));
			return;
		}
		this.activeRun = { prompt: pending.prompt, run };
		try {
			const result = await run.completion;
			if (result.exitCode !== 0 && this.runState?.status !== 'blocked') {
				this.handleAgentEvent({
					kind: 'error', recoverable: true,
					message: result.stderr || `Sundial Editor CLI exited with code ${result.exitCode}.`,
				});
			}
		} catch (error) {
			this.handleAgentEvent({ kind: 'error', recoverable: true, message: error instanceof Error ? error.message : String(error) });
		} finally {
			this.activeRun = undefined;
			this.pendingPrompt = undefined;
			this.postState();
			await this.services.returnToSource(pending.prompt);
		}
	}

	private handleAgentEvent(event: AgentEvent): void {
		const events = appendAgentEvent(this.runState?.events ?? [], event);
		const status = event.kind === 'status'
			? event.status
			: event.kind === 'error' ? 'blocked' : (this.runState?.status ?? 'working');
		this.runState = { status, events };
		this.postState();
	}

	private finishWithFailure(prompt: PromptContext, message: string): void {
		this.handleAgentEvent({ kind: 'error', message, recoverable: true });
		this.pendingPrompt = undefined;
		this.postState();
		void this.services.returnToSource(prompt);
	}

	private currentState(): MessagesState {
		return {
			...(this.pendingPrompt === undefined ? {} : {
				prompt: this.pendingPrompt.prompt,
				draft: this.pendingPrompt.draft,
			}),
			...(this.runState === undefined ? {} : { run: this.runState }),
		};
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
