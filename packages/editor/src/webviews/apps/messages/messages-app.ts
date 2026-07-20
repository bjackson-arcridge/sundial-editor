import { LitElement, css, html, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import { messageComposerKeyAction } from '../../../messageComposerKeyboard.js';
import {
	defaultPaneSplitPercent,
	maximumPaneSplitPercent,
	minimumPaneSplitPercent,
	paneSplitPercentFromKey,
	paneSplitPercentFromPointer,
} from '../../../paneSplit.js';
import type { PromptContext } from '../../../promptCommand.js';
import {
	type AnnotationViewerState,
	type AgentRunState,
	type HostToWebview,
	type WebviewToHost,
	isValidHostToWebviewMessage,
} from '../../messages/messages.js';
import { getHost, readInitialState } from '../shared/host.js';
import { tokenStyles } from '../shared/styles.js';
import { renderMarkdown } from './markdown.js';

const toolbarIconPaths = {
	'chevron-up': 'M3.14603 9.85423C3.34103 10.0492 3.65803 10.0492 3.85303 9.85423L7.99903 5.70823L12.145 9.85423C12.34 10.0492 12.657 10.0492 12.852 9.85423C13.047 9.65923 13.047 9.34223 12.852 9.14723L8.35203 4.64723C8.15703 4.45223 7.84003 4.45223 7.64503 4.64723L3.14503 9.14723C2.95003 9.34223 2.95103 9.65923 3.14603 9.85423Z',
	'chevron-down': 'M3.14598 5.85423L7.64598 10.3542C7.84098 10.5492 8.15798 10.5492 8.35298 10.3542L12.853 5.85423C13.048 5.65923 13.048 5.34223 12.853 5.14723C12.658 4.95223 12.341 4.95223 12.146 5.14723L7.99998 9.29323L3.85398 5.14723C3.65898 4.95223 3.34198 4.95223 3.14698 5.14723C2.95198 5.34223 2.95098 5.65923 3.14598 5.85423Z',
	'chevron-right': 'M6.14601 3.14579C5.95101 3.34079 5.95101 3.65779 6.14601 3.85279L10.292 7.99879L6.14601 12.1448C5.95101 12.3398 5.95101 12.6568 6.14601 12.8518C6.34101 13.0468 6.65801 13.0468 6.85301 12.8518L11.353 8.35179C11.548 8.15679 11.548 7.83979 11.353 7.64478L6.85301 3.14479C6.65801 2.94979 6.34101 2.95079 6.14601 3.14579Z',
	question: 'M8 11C8.41421 11 8.75 11.3358 8.75 11.75C8.75 12.1642 8.41421 12.5 8 12.5C7.58579 12.5 7.25 12.1642 7.25 11.75C7.25 11.3358 7.58579 11 8 11ZM8 4C9.262 4 10.25 4.988 10.25 6.25C10.25 7.333 9.68352 7.89852 9.22852 8.35352C8.82052 8.76052 8.5 9.082 8.5 9.75C8.5 10.026 8.276 10.25 8 10.25C7.724 10.25 7.5 10.026 7.5 9.75C7.5 8.667 8.06648 8.10148 8.52148 7.64648C8.92948 7.23948 9.25 6.918 9.25 6.25C9.25 5.538 8.712 5 8 5C7.288 5 6.75 5.538 6.75 6.25C6.75 6.526 6.526 6.75 6.25 6.75C5.974 6.75 5.75 6.526 5.75 6.25C5.75 4.988 6.738 4 8 4Z',
	pin: 'M13.5 3C13.303 3 13.109 3.038 12.923 3.114L8.481 4.967L5.659 4.026C5.505 3.976 5.339 4.001 5.209 4.095C5.078 4.189 5.001 4.339 5.001 4.5V7H1.257L0.5 7.5L1.257 8H5V10.5C5 10.661 5.077 10.812 5.208 10.905C5.338 11 5.504 11.023 5.658 10.974L8.48 10.033L12.925 11.887C13.109 11.962 13.302 12 13.499 12C14.326 12 14.999 11.327 14.999 10.5V4.5C14.999 3.673 14.326 3 13.499 3H13.5ZM14 10.5C14 10.843 13.615 11.09 13.308 10.962L8.693 9.038C8.631 9.013 8.566 9 8.501 9C8.447 9 8.395 9.009 8.343 9.025L6.001 9.806V5.193L8.343 5.974C8.457 6.011 8.581 6.007 8.694 5.961L13.306 4.038C13.629 3.902 14.001 4.156 14.001 4.499V10.499L14 10.5Z',
	'screen-full': 'M3.75 3C3.33579 3 3 3.33579 3 3.75V5.5C3 5.77614 2.77614 6 2.5 6C2.22386 6 2 5.77614 2 5.5V3.75C2 2.7835 2.7835 2 3.75 2H5.5C5.77614 2 6 2.22386 6 2.5C6 2.77614 5.77614 3 5.5 3H3.75ZM10 2.5C10 2.22386 10.2239 2 10.5 2H12.25C13.2165 2 14 2.7835 14 3.75V5.5C14 5.77614 13.7761 6 13.5 6C13.2239 6 13 5.77614 13 5.5V3.75C13 3.33579 12.6642 3 12.25 3H10.5C10.2239 3 10 2.77614 10 2.5ZM2.5 10C2.77614 10 3 10.2239 3 10.5V12.25C3 12.6642 3.33579 13 3.75 13H5.5C5.77614 13 6 13.2239 6 13.5C6 13.7761 5.77614 14 5.5 14H3.75C2.7835 14 2 13.2165 2 12.25V10.5C2 10.2239 2.22386 10 2.5 10ZM13.5 10C13.7761 10 14 10.2239 14 10.5V12.25C14 13.2165 13.2165 14 12.25 14H10.5C10.2239 14 10 13.7761 10 13.5C10 13.2239 10.2239 13 10.5 13H12.25C12.6642 13 13 12.6642 13 12.25V10.5C13 10.2239 13.2239 10 13.5 10Z',
	'screen-normal': 'M11 4C11 4.55228 11.4477 5 12 5H13.5C13.7761 5 14 5.22386 14 5.5C14 5.77614 13.7761 6 13.5 6H12C10.8954 6 10 5.10457 10 4V2.5C10 2.22386 10.2239 2 10.5 2C10.7761 2 11 2.22386 11 2.5V4ZM11 12C11 11.4477 11.4477 11 12 11H13.5C13.7761 11 14 10.7761 14 10.5C14 10.2239 13.7761 10 13.5 10H12C10.8954 10 10 10.8954 10 12V13.5C10 13.7761 10.2239 14 10.5 14C10.7761 14 11 13.7761 11 13.5V12ZM4 11C4.55228 11 5 11.4477 5 12V13.5C5 13.7761 5.22386 14 5.5 14C5.77614 14 6 13.7761 6 13.5V12C6 10.8954 5.10457 10 4 10H2.5C2.22386 10 2 10.2239 2 10.5C2 10.7761 2.22386 11 2.5 11H4ZM5 4C5 4.55228 4.55228 5 4 5H2.5C2.22386 5 2 5.22386 2 5.5C2 5.77614 2.22386 6 2.5 6H4C5.10457 6 6 5.10457 6 4V2.5C6 2.22386 5.77614 2 5.5 2C5.22386 2 5 2.22386 5 2.5V4Z',
	trash: 'M14 2H10C10 0.897 9.103 0 8 0C6.897 0 6 0.897 6 2H2C1.724 2 1.5 2.224 1.5 2.5C1.5 2.776 1.724 3 2 3H2.54L3.349 12.708C3.456 13.994 4.55 15 5.84 15H10.159C11.449 15 12.543 13.993 12.65 12.708L13.459 3H13.999C14.275 3 14.499 2.776 14.499 2.5C14.499 2.224 14.275 2 13.999 2H14ZM8 1C8.551 1 9 1.449 9 2H7C7 1.449 7.449 1 8 1ZM11.655 12.625C11.591 13.396 10.934 14 10.16 14H5.841C5.067 14 4.41 13.396 4.346 12.625L3.544 3H12.458L11.656 12.625H11.655ZM7 5.5V11.5C7 11.776 6.776 12 6.5 12C6.224 12 6 11.776 6 11.5V5.5C6 5.224 6.224 5 6.5 5C6.776 5 7 5.224 7 5.5ZM10 5.5V11.5C10 11.776 9.776 12 9.5 12C9.224 12 9 11.776 9 11.5V5.5C9 5.224 9.224 5 9.5 5C9.776 5 10 5.224 10 5.5Z',
} as const;

type ToolbarIcon = keyof typeof toolbarIconPaths;

@customElement('se-messages-app')
export class MessagesApp extends LitElement {
	static styles = [
		tokenStyles,
		css`
			:host {
				display: block;
				box-sizing: border-box;
				height: 100vh;
				padding: 12px;
				overflow: hidden;
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
			button:focus-visible,
			.pane-separator:focus-visible {
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

			.layout {
				display: grid;
				grid-template-rows: minmax(0, 1fr) 8px minmax(0, 1fr);
				height: 100%;
				min-height: 0;
				gap: 0;
			}

			.agent-pane {
				min-height: 0;
				overflow: auto;
			}

			.pane-separator {
				position: relative;
				min-height: 8px;
				border: 0;
				background: var(--se-bg);
				cursor: row-resize;
				touch-action: none;
			}

			.pane-separator::before {
				position: absolute;
				top: 3px;
				right: 0;
				left: 0;
				height: 1px;
				background: var(--se-border);
				content: '';
			}

			.pane-separator:hover::before,
			.pane-separator:focus-visible::before,
			.pane-separator.dragging::before {
				top: 2px;
				height: 3px;
				background: var(--vscode-sash-hoverBorder, var(--se-focus));
			}

			.annotation-pane {
				display: flex;
				box-sizing: border-box;
				flex-direction: column;
				min-height: 0;
				overflow: hidden;
				border-bottom: 1px solid var(--se-border);
			}

			.annotation-pane.takeover {
				height: 100%;
			}

			.annotation-toolbar {
				display: flex;
				align-items: center;
				min-height: 34px;
				padding: 2px 4px;
				gap: 2px;
				border-bottom: 1px solid var(--se-border);
				background: var(--se-toolbar-bg);
			}

			.annotation-source {
				display: flex;
				align-items: center;
				min-width: 0;
				margin-right: auto;
				gap: 2px;
			}

			.source-name {
				overflow: hidden;
				font-weight: 600;
				text-overflow: ellipsis;
				white-space: nowrap;
			}

			.annotation-position {
				color: var(--se-muted-fg);
				white-space: nowrap;
			}

			button.icon {
				display: inline-flex;
				align-items: center;
				justify-content: center;
				width: 28px;
				min-height: 28px;
				padding: 0;
				border-color: var(--se-toolbar-bg);
				background: var(--se-toolbar-bg);
				color: var(--se-icon-fg);
			}

			.toolbar-icon {
				width: 16px;
				height: 16px;
				flex: none;
				fill: currentColor;
				pointer-events: none;
			}

			button.icon:hover:not(:disabled),
			button.icon[aria-pressed="true"] {
				background: var(--vscode-toolbar-hoverBackground, var(--vscode-list-hoverBackground));
				color: var(--se-icon-fg);
			}

			button.icon:disabled {
				opacity: 0.7;
				color: var(--se-icon-fg);
			}

			.annotation-content {
				flex: 1;
				overflow: auto;
				padding: 10px;
			}

			.annotation-message {
				margin: 0;
				white-space: pre-wrap;
				overflow-wrap: anywhere;
			}

			.annotation-metadata {
				margin-bottom: 10px;
				padding-bottom: 10px;
				border-bottom: 1px solid var(--se-border);
			}

			.annotation-empty {
				margin: 0;
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
	@state() private submitted = false;
	@state() private annotationSaved = false;
	@state() private deliveryComplete = false;
	@state() private annotationViewer: AnnotationViewerState | undefined;
	@state() private metadataExpanded = false;
	@state() private takeoverExpanded = false;
	@state() private agentPanePercent = defaultPaneSplitPercent;
	@state() private isResizingPanes = false;

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

	updated(): void {
		const layout = this.renderRoot.querySelector<HTMLElement>('.layout');
		if (layout !== null) {
			layout.style.gridTemplateRows = `minmax(0, ${this.agentPanePercent}fr) 8px minmax(0, ${100 - this.agentPanePercent}fr)`;
		}
	}

	render() {
		const normalMessages = this.renderNormalMessages();
		const annotationPane = this.renderAnnotationPane();
		return this.takeoverExpanded && this.annotationViewer !== undefined
			? annotationPane
			: html`
				<div class="layout">
					<section class="agent-pane" aria-label="Agents">${normalMessages}</section>
					<div
						class="pane-separator ${this.isResizingPanes ? 'dragging' : ''}"
						role="separator"
						aria-label="Resize agent and annotation sections"
						aria-orientation="horizontal"
						aria-valuemin=${minimumPaneSplitPercent}
						aria-valuemax=${maximumPaneSplitPercent}
						aria-valuenow=${Math.round(this.agentPanePercent)}
						aria-valuetext="${Math.round(this.agentPanePercent)}% agents, ${Math.round(100 - this.agentPanePercent)}% annotations"
						tabindex="0"
						title="Resize agent and annotation sections"
						@pointerdown=${this.startPaneResize}
						@pointermove=${this.continuePaneResize}
						@pointerup=${this.finishPaneResize}
						@pointercancel=${this.cancelPaneResize}
						@keydown=${this.handlePaneSeparatorKeydown}
					></div>
					${annotationPane}
				</div>
			`;
	}

	private renderNormalMessages() {
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
				<h2>Source: User ${this.prompt.preset}</h2>
			</section>
			${this.run === undefined ? nothing : this.renderRun(this.run)}
			${this.run?.status === 'working' ? nothing : html`<form @submit=${this.submitComposer} @keydown=${this.handleComposerKeydown}>
				<label for="message">Message</label>
				<textarea
					id="message"
					.value=${this.messageText}
					?readonly=${this.submitted}
					@input=${this.updateMessageText}
					aria-describedby="message-help"
				></textarea>
				<div id="message-help" class="status">${this.submitted
					? this.retryDescription()
					: 'Press Enter to send, Shift+Enter for a new line, or Escape to cancel.'}</div>
				<div class="actions">
					<button type="submit" ?disabled=${this.isSubmitting}>${this.retryLabel()}</button>
					<button class="secondary" type="button" ?disabled=${this.isSubmitting} @click=${this.cancelComposer}>Cancel</button>
				</div>
			</form>`}
		`;
	}

	private renderAnnotationPane() {
		const viewer = this.annotationViewer;
		const sourceName = viewer === undefined ? 'Annotations' : `User ${viewer.annotation.preset}`;
		const metadataTitle = this.metadataExpanded ? 'Collapse annotation metadata' : 'Expand annotation metadata';
		const pinTitle = viewer?.pinned ? 'Unpin annotation' : 'Pin annotation';
		const takeoverTitle = this.takeoverExpanded ? 'Restore annotation pane' : 'Expand annotation pane';
		return html`
			<section class="annotation-pane ${this.takeoverExpanded ? 'takeover' : ''}" aria-label="Annotation viewer">
				<div class="annotation-toolbar" role="toolbar" aria-label="Annotation actions" @keydown=${this.handleToolbarKeydown}>
					<div class="annotation-source">
						<button class="icon" type="button" ?disabled=${viewer === undefined}
							aria-label=${metadataTitle} title=${metadataTitle}
							aria-expanded=${this.metadataExpanded} @click=${this.toggleMetadata}>
							${this.renderToolbarIcon(this.metadataExpanded ? 'chevron-down' : 'chevron-right')}
						</button>
						<span class="source-name">${sourceName}</span>
						<button class="icon" type="button" ?disabled=${viewer === undefined}
							aria-label=${metadataTitle} title=${metadataTitle} aria-expanded=${this.metadataExpanded} @click=${this.toggleMetadata}>
							${this.renderToolbarIcon('question')}
						</button>
					</div>
					${viewer === undefined ? nothing : html`<span class="annotation-position">${viewer.position}/${viewer.total}</span>`}
					<button class="icon" type="button" ?disabled=${viewer?.canPrevious !== true} aria-label="Previous annotation" title="Previous annotation" @click=${this.previousAnnotation}>
						${this.renderToolbarIcon('chevron-up')}
					</button>
					<button class="icon" type="button" ?disabled=${viewer?.canNext !== true} aria-label="Next annotation" title="Next annotation" @click=${this.nextAnnotation}>
						${this.renderToolbarIcon('chevron-down')}
					</button>
					<button class="icon" type="button" ?disabled=${viewer === undefined} aria-label=${pinTitle} title=${pinTitle}
						aria-pressed=${viewer?.pinned === true} @click=${this.toggleAnnotationPin}>
						${this.renderToolbarIcon('pin')}
					</button>
					<button class="icon" type="button" ?disabled=${viewer === undefined}
						aria-label=${takeoverTitle} title=${takeoverTitle}
						aria-pressed=${this.takeoverExpanded} @click=${this.toggleTakeover}>
						${this.renderToolbarIcon(this.takeoverExpanded ? 'screen-normal' : 'screen-full')}
					</button>
					<button class="icon" type="button" ?disabled=${viewer === undefined} aria-label="Delete annotation" title="Delete annotation" @click=${this.deleteAnnotation}>
						${this.renderToolbarIcon('trash')}
					</button>
				</div>
				<div class="annotation-content">
					${viewer === undefined
						? html`<p class="annotation-empty">Select a marked source line to view its annotation.</p>`
						: html`
							${this.metadataExpanded ? this.renderAnnotationMetadata(viewer) : nothing}
							<p class="annotation-message">${viewer.annotation.message}</p>
						`}
				</div>
			</section>
		`;
	}

	private renderToolbarIcon(icon: ToolbarIcon) {
		return html`
			<svg class="toolbar-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
				<path d=${toolbarIconPaths[icon]}></path>
			</svg>
		`;
	}

	private renderAnnotationMetadata(viewer: AnnotationViewerState) {
		const annotation = viewer.annotation;
		return html`
			<div class="annotation-metadata" aria-label="Annotation metadata">
				<dl>
					<dt>Scope</dt><dd>${annotation.scope === 'project' ? 'Project' : 'Current line'}</dd>
					<dt>Line</dt><dd>${annotation.anchor.line + 1}</dd>
					<dt>Target</dt><dd><code>${annotation.anchor.text}</code></dd>
					<dt>Before</dt><dd>${annotation.anchor.before.length === 0 ? 'None' : annotation.anchor.before.map(line => html`<div><code>${line}</code></div>`)}</dd>
					<dt>After</dt><dd>${annotation.anchor.after.length === 0 ? 'None' : annotation.anchor.after.map(line => html`<div><code>${line}</code></div>`)}</dd>
				</dl>
			</div>
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
				${run.status === 'working' && !this.deliveryComplete
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
				const previousAnnotationId = this.annotationViewer?.annotation.id;
				this.prompt = hostMessage.state.prompt;
				this.run = hostMessage.state.run;
				this.submitted = hostMessage.state.submitted === true;
				this.annotationSaved = hostMessage.state.annotationSaved === true;
				this.deliveryComplete = hostMessage.state.deliveryComplete === true;
				this.annotationViewer = hostMessage.state.annotationViewer;
				if (hostMessage.state.annotationViewer?.annotation.id !== previousAnnotationId) {
					this.metadataExpanded = false;
				}
				if (hostMessage.state.annotationViewer === undefined) {
					this.takeoverExpanded = false;
				}
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

	private previousAnnotation = (): void => {
		this.webviewHost.postMessage({ kind: 'previousAnnotation' });
	};

	private nextAnnotation = (): void => {
		this.webviewHost.postMessage({ kind: 'nextAnnotation' });
	};

	private toggleAnnotationPin = (): void => {
		this.webviewHost.postMessage({ kind: 'toggleAnnotationPin' });
	};

	private deleteAnnotation = (): void => {
		this.webviewHost.postMessage({ kind: 'deleteAnnotation' });
	};

	private toggleMetadata = (): void => {
		this.metadataExpanded = !this.metadataExpanded;
	};

	private toggleTakeover = (): void => {
		this.takeoverExpanded = !this.takeoverExpanded;
	};

	private startPaneResize = (pointerEvent: PointerEvent): void => {
		if (pointerEvent.button !== 0) {
			return;
		}
		const separator = pointerEvent.currentTarget as HTMLElement;
		separator.setPointerCapture(pointerEvent.pointerId);
		this.isResizingPanes = true;
		this.resizePanesFromPointer(pointerEvent, separator);
		pointerEvent.preventDefault();
	};

	private continuePaneResize = (pointerEvent: PointerEvent): void => {
		const separator = pointerEvent.currentTarget as HTMLElement;
		if (this.isResizingPanes && separator.hasPointerCapture(pointerEvent.pointerId)) {
			this.resizePanesFromPointer(pointerEvent, separator);
		}
	};

	private finishPaneResize = (pointerEvent: PointerEvent): void => {
		const separator = pointerEvent.currentTarget as HTMLElement;
		if (separator.hasPointerCapture(pointerEvent.pointerId)) {
			this.resizePanesFromPointer(pointerEvent, separator);
			separator.releasePointerCapture(pointerEvent.pointerId);
		}
		this.isResizingPanes = false;
	};

	private cancelPaneResize = (pointerEvent: PointerEvent): void => {
		const separator = pointerEvent.currentTarget as HTMLElement;
		if (separator.hasPointerCapture(pointerEvent.pointerId)) {
			separator.releasePointerCapture(pointerEvent.pointerId);
		}
		this.isResizingPanes = false;
	};

	private resizePanesFromPointer(pointerEvent: PointerEvent, separator: HTMLElement): void {
		const layout = separator.parentElement;
		if (layout === null) {
			return;
		}
		const layoutBounds = layout.getBoundingClientRect();
		this.agentPanePercent = paneSplitPercentFromPointer(
			pointerEvent.clientY,
			layoutBounds.top,
			layoutBounds.height,
			separator.getBoundingClientRect().height,
		);
	}

	private handlePaneSeparatorKeydown = (keyboardEvent: KeyboardEvent): void => {
		const nextPercent = paneSplitPercentFromKey(this.agentPanePercent, keyboardEvent.key);
		if (nextPercent === undefined) {
			return;
		}
		keyboardEvent.preventDefault();
		this.agentPanePercent = nextPercent;
	};

	private handleToolbarKeydown = (keyboardEvent: KeyboardEvent): void => {
		if (keyboardEvent.key === 'Escape') {
			this.metadataExpanded = false;
			this.takeoverExpanded = false;
			return;
		}
		if (keyboardEvent.key !== 'ArrowLeft' && keyboardEvent.key !== 'ArrowRight') {
			return;
		}
		const buttons = [...this.renderRoot.querySelectorAll<HTMLButtonElement>('.annotation-toolbar button:not(:disabled)')];
		const current = buttons.indexOf(keyboardEvent.target as HTMLButtonElement);
		if (current < 0 || buttons.length === 0) {
			return;
		}
		keyboardEvent.preventDefault();
		const direction = keyboardEvent.key === 'ArrowRight' ? 1 : -1;
		buttons[(current + direction + buttons.length) % buttons.length]?.focus();
	};

	private retryLabel(): string {
		if (!this.submitted) {
			return 'Send';
		}
		if (this.deliveryComplete && !this.annotationSaved) {
			return 'Retry save';
		}
		if (this.annotationSaved && !this.deliveryComplete) {
			return 'Retry agent';
		}
		return 'Retry';
	}

	private retryDescription(): string {
		if (this.deliveryComplete && !this.annotationSaved) {
			return 'The message was submitted. Retry saves its annotation without sending it again.';
		}
		if (this.annotationSaved && !this.deliveryComplete) {
			return 'The annotation was saved. Retry sends the same message without creating another annotation.';
		}
		return 'Submission did not complete. Retry preserves the original message and avoids repeating completed work.';
	}

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
