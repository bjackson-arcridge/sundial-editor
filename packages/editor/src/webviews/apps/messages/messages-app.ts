import { LitElement, css, html, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import { messageComposerKeyAction } from '../../../messageComposerKeyboard.js';
import type { PromptContext } from '../../../promptCommand.js';
import {
	type AgentRunState,
	type HostToWebview,
	type WebviewToHost,
	isValidHostToWebviewMessage,
} from '../../messages/messages.js';
import { getHost, readInitialState } from '../shared/host.js';
import { tokenStyles } from '../shared/styles.js';
import { renderMarkdown } from './markdown.js';

@customElement('se-messages-app')
export class MessagesApp extends LitElement {
	static styles = [
		tokenStyles,
		css`
			:host {
				display: block;
				padding: 12px;
				background: var(--se-bg);
			}

			h1 {
				margin: 0 0 12px;
				font-size: 1.1rem;
				font-weight: 600;
			}

			.empty,
			.status {
				margin: 0;
				line-height: 1.45;
				color: var(--se-muted-fg);
			}

			.context {
				margin: 0 0 12px;
				padding: 10px;
				border: 1px solid var(--se-border);
				border-radius: 3px;
				background: var(--se-surface-bg);
			}

			.context h2 {
				margin: 0 0 8px;
				font-size: 1rem;
				font-weight: 600;
			}

			dl {
				display: grid;
				grid-template-columns: max-content minmax(0, 1fr);
				gap: 4px 10px;
				margin: 0;
			}

			dt {
				color: var(--se-muted-fg);
			}

			dd {
				min-width: 0;
				margin: 0;
				overflow-wrap: anywhere;
			}

			code {
				font-family: var(--vscode-editor-font-family);
				font-size: var(--vscode-editor-font-size);
			}

			form {
				display: grid;
				gap: 8px;
			}

			label {
				font-weight: 600;
			}

			textarea {
				box-sizing: border-box;
				width: 100%;
				min-height: 112px;
				resize: vertical;
				padding: 8px;
				border: 1px solid var(--se-input-border);
				border-radius: 3px;
				background: var(--se-input-bg);
				color: var(--se-input-fg);
				font-family: var(--vscode-font-family);
				font-size: var(--vscode-font-size);
				line-height: 1.4;
			}

			textarea:focus-visible,
			button:focus-visible {
				outline: 1px solid var(--se-focus);
				outline-offset: 2px;
			}

			.actions {
				display: flex;
				flex-wrap: wrap;
				gap: 8px;
			}

			button {
				min-height: 28px;
				padding: 4px 12px;
				border: 1px solid var(--se-button-bg);
				border-radius: 3px;
				background: var(--se-button-bg);
				color: var(--se-button-fg);
				font: inherit;
				cursor: pointer;
			}

			button:hover:not(:disabled) {
				background: var(--se-button-hover);
			}

			button.secondary {
				border-color: var(--se-secondary-button-bg);
				background: var(--se-secondary-button-bg);
				color: var(--se-secondary-button-fg);
			}

			button.secondary:hover:not(:disabled) {
				background: var(--se-secondary-button-hover);
			}

			button:disabled {
				opacity: var(--vscode-disabledOpacity);
				cursor: default;
			}

			.events {
				display: grid;
				gap: 6px;
				margin: 8px 0;
			}

			.event {
				overflow-wrap: anywhere;
			}

			.event.output > :first-child {
				margin-top: 0;
			}

			.event.output > :last-child {
				margin-bottom: 0;
			}

			.event.output pre {
				overflow-x: auto;
				padding: 8px;
				border: 1px solid var(--se-border);
				background: var(--se-surface-bg);
			}

			.event.output blockquote {
				margin-inline: 0;
				padding-inline-start: 10px;
				border-inline-start: 2px solid var(--se-border);
				color: var(--se-muted-fg);
			}

			.event.status,
			.event.error {
				color: var(--se-muted-fg);
			}
		`,
	];

	private readonly webviewHost = getHost<WebviewToHost, HostToWebview>();
	@state() private prompt: PromptContext | undefined;
	@state() private messageText = '';
	@state() private isSubmitting = false;
	@state() private statusMessage = '';
	@state() private run: AgentRunState | undefined;

	connectedCallback(): void {
		super.connectedCallback();
		const persistedState = this.webviewHost.getState();
		const initialHostMessage = persistedState !== undefined && isValidHostToWebviewMessage(persistedState)
			? persistedState
			: readInitialState<HostToWebview>();
		if (initialHostMessage !== undefined && isValidHostToWebviewMessage(initialHostMessage)) {
			this.applyHostMessage(initialHostMessage);
		}

		window.addEventListener('message', this.handleHostMessageEvent);
	}

	disconnectedCallback(): void {
		super.disconnectedCallback();
		window.removeEventListener('message', this.handleHostMessageEvent);
	}

	firstUpdated(): void {
		if (this.prompt !== undefined && document.visibilityState !== 'hidden') {
			this.renderRoot.querySelector<HTMLTextAreaElement>('#message')?.focus();
		}
	}

	render() {
		if (this.prompt === undefined) {
			return html`
				<h1>Messages</h1>
				${this.run === undefined
					? html`<p class="empty">Run Sundial Editor: Submit Prompt from a supported command line to begin a message.</p>`
					: this.renderRun(this.run)}
				${this.statusMessage === '' ? nothing : html`<p class="status" role="status">${this.statusMessage}</p>`}
			`;
		}

		return html`
			<h1>New message</h1>
			<section class="context" aria-label="Prompt context">
				<h2>Prompt context</h2>
				<dl>
					<dt>Preset</dt>
					<dd><code>${this.prompt.preset}</code></dd>
					<dt>Scope</dt>
					<dd>${this.prompt.scope === 'project' ? 'Project' : 'Current line'}</dd>
					<dt>Source</dt>
					<dd>Line ${this.prompt.sourceLine + 1}</dd>
				</dl>
			</section>
			${this.run === undefined ? nothing : this.renderRun(this.run)}
			${this.run?.status === 'working' ? nothing : html`<form @submit=${this.submitComposer} @keydown=${this.handleComposerKeydown}>
				<label for="message">Message</label>
				<textarea
					id="message"
					.value=${this.messageText}
					@input=${this.updateMessageText}
					aria-describedby="message-help"
				></textarea>
				<div id="message-help" class="status">Press Enter to send, Shift+Enter for a new line, or Escape to cancel.</div>
				<div class="actions">
					<button type="submit" ?disabled=${this.isSubmitting}>Send</button>
					<button class="secondary" type="button" ?disabled=${this.isSubmitting} @click=${this.cancelComposer}>Cancel</button>
				</div>
			</form>`}
		`;
	}

	private renderRun(run: AgentRunState) {
		return html`
			<section aria-label="Agent activity">
				<p class="status" role="status">Agent status: ${run.status}</p>
				<div class="events" role="log" aria-live="polite" aria-label="Agent output">
					${run.events.map(event => event.kind === 'output'
						? html`<div class="event output">${unsafeHTML(renderMarkdown(event.text))}</div>`
						: html`<div class="event ${event.kind}">${event.message ?? (event.kind === 'status' ? event.status : '')}</div>`)}
				</div>
				${run.status === 'working'
					? html`<button class="secondary" type="button" @click=${this.cancelComposer}>Cancel</button>`
					: nothing}
			</section>
		`;
	}

	private handleHostMessageEvent = (messageEvent: MessageEvent<unknown>): void => {
		if (isValidHostToWebviewMessage(messageEvent.data)) {
			this.applyHostMessage(messageEvent.data);
		}
	};

	private applyHostMessage(hostMessage: HostToWebview): void {
		switch (hostMessage.kind) {
			case 'state':
				this.webviewHost.setState(hostMessage);
				const isOpeningPrompt = this.prompt === undefined && hostMessage.state.prompt !== undefined;
				this.prompt = hostMessage.state.prompt;
				this.run = hostMessage.state.run;
				this.isSubmitting = hostMessage.state.run?.status === 'working';
				if (hostMessage.state.prompt === undefined) {
					this.messageText = '';
				} else {
					this.statusMessage = '';
					if (isOpeningPrompt) {
						this.messageText = hostMessage.state.draft ?? '';
					}
				}
				return;
			case 'focusComposer':
				void this.updateComplete.then(() => this.renderRoot.querySelector<HTMLTextAreaElement>('#message')?.focus());
				return;
			default: {
				const unhandledMessage: never = hostMessage;
				throw new Error(`Unexpected host message: ${JSON.stringify(unhandledMessage)}`);
			}
		}
	}

	private updateMessageText = (inputEvent: Event): void => {
		this.messageText = (inputEvent.target as HTMLTextAreaElement).value;
	};

	private submitComposer = (submitEvent: SubmitEvent): void => {
		submitEvent.preventDefault();
		this.submitComposerMessage();
	};

	private submitComposerMessage(): void {
		if (this.isSubmitting || this.prompt === undefined) {
			return;
		}

		this.isSubmitting = true;
		this.webviewHost.postMessage({ kind: 'submit', message: this.messageText });
	}

	private cancelComposer = (): void => {
		if (this.prompt !== undefined) {
			this.webviewHost.postMessage({ kind: 'cancel' });
		}
	};

	private handleComposerKeydown = (keyboardEvent: KeyboardEvent): void => {
		const action = messageComposerKeyAction(keyboardEvent);
		if (action === 'cancel') {
			keyboardEvent.preventDefault();
			this.cancelComposer();
			return;
		}

		if (keyboardEvent.target instanceof HTMLTextAreaElement && action === 'submit') {
			keyboardEvent.preventDefault();
			this.submitComposerMessage();
		}
	};
}
