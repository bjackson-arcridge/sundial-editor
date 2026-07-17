import * as vscode from 'vscode';
import { createIntegrationStub } from '../../integrationStub.js';
import type { PromptContext } from '../../promptCommand.js';
import { renderWebviewHtml } from '../shared/csp.js';
import { attachMessageRouter, type MessageRouter } from '../shared/messageRouter.js';
import {
	type HostToWebview,
	type WebviewToHost,
	isValidWebviewToHostMessage,
} from './messages.js';

export interface MessagesServices {
	readonly returnToSource: (prompt: PromptContext) => void | Promise<void>;
}

export interface MessagesDiagnostics {
	readonly viewResolved: boolean;
	readonly viewVisible: boolean;
	readonly state: HostToWebview;
}

interface PendingPrompt {
	readonly prompt: PromptContext;
	readonly draft: string;
}

export class MessagesWebviewProvider implements vscode.WebviewViewProvider {
	private readonly messageRouters = new Set<MessageRouter<WebviewToHost, HostToWebview>>();
	private activeMessagesView: vscode.WebviewView | undefined;
	private pendingPrompt: PendingPrompt | undefined;

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
			initialState: this.stateMessage(),
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
		this.postToMessagesWebviews({ kind: 'clearPrompt' });
		this.pendingPrompt = {
			prompt,
			draft: createIntegrationStub(prompt),
		};
		await vscode.commands.executeCommand('workbench.view.extension.sundialEditor');
		await vscode.commands.executeCommand('sundialEditor.messages.focus');
		this.focusPendingComposer();
	}

	diagnostics(): MessagesDiagnostics {
		return {
			viewResolved: this.activeMessagesView !== undefined,
			viewVisible: this.activeMessagesView?.visible === true,
			state: this.stateMessage(),
		};
	}

	async acknowledgePendingSubmission(): Promise<void> {
		const prompt = this.pendingPrompt?.prompt;
		this.pendingPrompt = undefined;
		this.postToMessagesWebviews({ kind: 'submissionAcknowledged' });
		if (prompt !== undefined) {
			await this.services.returnToSource(prompt);
		}
	}

	private handleWebviewMessage(inboundMessage: WebviewToHost): void {
		switch (inboundMessage.kind) {
			case 'submit':
				void this.acknowledgePendingSubmission();
				return;
			case 'cancel': {
				const prompt = this.pendingPrompt?.prompt;
				this.pendingPrompt = undefined;
				this.postToMessagesWebviews({ kind: 'clearPrompt' });
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

		this.postToMessagesWebviews(this.stateMessage());
		this.postToMessagesWebviews({ kind: 'focusComposer' });
	}

	private stateMessage(): HostToWebview {
		return this.pendingPrompt === undefined
			? { kind: 'state' }
			: {
				kind: 'state',
				prompt: this.pendingPrompt.prompt,
				draft: this.pendingPrompt.draft,
			};
	}

	private postToMessagesWebviews(hostMessage: HostToWebview): void {
		for (const messagesRouter of this.messageRouters) {
			messagesRouter.post(hostMessage);
		}
	}
}
