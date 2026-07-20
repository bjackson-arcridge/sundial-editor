import { LitElement, css, html, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
import type {
	AgentId,
	AgentsViewState,
	AgentTranscriptViewState,
	NamedAgent,
	TranscriptRole,
	UserAnnotationWorkItem,
	WorkUpdateKind,
} from '../../../agentProtocol.js';
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
	type HostNotice,
	type HostToWebview,
	type WebviewToHost,
	currentWorkForAgent,
	isValidHostToWebviewMessage,
	waitingAgentForAnnotation,
} from '../../messages/messages.js';
import { getHost, readInitialState } from '../shared/host.js';
import { tokenStyles } from '../shared/styles.js';

const toolbarIconPaths = {
	'chevron-up': 'M3.14603 9.85423C3.34103 10.0492 3.65803 10.0492 3.85303 9.85423L7.99903 5.70823L12.145 9.85423C12.34 10.0492 12.657 10.0492 12.852 9.85423C13.047 9.65923 13.047 9.34223 12.852 9.14723L8.35203 4.64723C8.15703 4.45223 7.84003 4.45223 7.64503 4.64723L3.14503 9.14723C2.95003 9.34223 2.95103 9.65923 3.14603 9.85423Z',
	'chevron-down': 'M3.14598 5.85423L7.64598 10.3542C7.84098 10.5492 8.15798 10.5492 8.35298 10.3542L12.853 5.85423C13.048 5.65923 13.048 5.34223 12.853 5.14723C12.658 4.95223 12.341 4.95223 12.146 5.14723L7.99998 9.29323L3.85398 5.14723C3.65898 4.95223 3.34198 4.95223 3.14698 5.14723C2.95198 5.34223 2.95098 5.65923 3.14598 5.85423Z',
	'chevron-right': 'M6.14601 3.14579C5.95101 3.34079 5.95101 3.65779 6.14601 3.85279L10.292 7.99879L6.14601 12.1448C5.95101 12.3398 5.95101 12.6568 6.14601 12.8518C6.34101 13.0468 6.65801 13.0468 6.85301 12.8518L11.353 8.35179C11.548 8.15679 11.548 7.83979 11.353 7.64478L6.85301 3.14479C6.65801 2.94979 6.34101 2.95079 6.14601 3.14579Z',
	'clear-agent': 'M8.70701 8.00001L12.353 4.35401C12.548 4.15901 12.548 3.84201 12.353 3.64701C12.158 3.45201 11.841 3.45201 11.646 3.64701L8.00001 7.29301L4.35401 3.64701C4.15901 3.45201 3.84201 3.45201 3.64701 3.64701C3.45201 3.84201 3.45201 4.15901 3.64701 4.35401L7.29301 8.00001L3.64701 11.646C3.45201 11.841 3.45201 12.158 3.64701 12.353C3.74501 12.451 3.87301 12.499 4.00101 12.499C4.12901 12.499 4.25701 12.45 4.35501 12.353L8.00101 8.70701L11.647 12.353C11.745 12.451 11.873 12.499 12.001 12.499C12.129 12.499 12.257 12.45 12.355 12.353C12.55 12.158 12.55 11.841 12.355 11.646L8.70901 8.00001H8.70701Z',
	close: 'M8.70701 8.00001L12.353 4.35401C12.548 4.15901 12.548 3.84201 12.353 3.64701C12.158 3.45201 11.841 3.45201 11.646 3.64701L8.00001 7.29301L4.35401 3.64701C4.15901 3.45201 3.84201 3.45201 3.64701 3.64701C3.45201 3.84201 3.45201 4.15901 3.64701 4.35401L7.29301 8.00001L3.64701 11.646C3.45201 11.841 3.45201 12.158 3.64701 12.353C3.74501 12.451 3.87301 12.499 4.00101 12.499C4.12901 12.499 4.25701 12.45 4.35501 12.353L8.00101 8.70701L11.647 12.353C11.745 12.451 11.873 12.499 12.001 12.499C12.129 12.499 12.257 12.45 12.355 12.353C12.55 12.158 12.55 11.841 12.355 11.646L8.70901 8.00001H8.70701Z',
	'open-external': 'M15 9.5V12.5C15 13.879 13.879 15 12.5 15H3.5C2.121 15 1 13.879 1 12.5V3.5C1 2.121 2.121 1 3.5 1H6.5C6.776 1 7 1.224 7 1.5C7 1.776 6.776 2 6.5 2H3.5C2.673 2 2 2.673 2 3.5V12.5C2 13.327 2.673 14 3.5 14H12.5C13.327 14 14 13.327 14 12.5V9.5C14 9.224 14.224 9 14.5 9C14.776 9 15 9.224 15 9.5ZM14.5 1H9.5C9.224 1 9 1.224 9 1.5C9 1.776 9.224 2 9.5 2H13.293L9.147 6.146C8.952 6.341 8.952 6.658 9.147 6.853C9.245 6.951 9.373 6.999 9.501 6.999C9.629 6.999 9.757 6.95 9.855 6.853L14.001 2.707V6.5C14.001 6.776 14.225 7 14.501 7C14.777 7 15.001 6.776 15.001 6.5V1.5C15.001 1.224 14.777 1 14.501 1H14.5Z',
	question: 'M8 11C8.41421 11 8.75 11.3358 8.75 11.75C8.75 12.1642 8.41421 12.5 8 12.5C7.58579 12.5 7.25 12.1642 7.25 11.75C7.25 11.3358 7.58579 11 8 11ZM8 4C9.262 4 10.25 4.988 10.25 6.25C10.25 7.333 9.68352 7.89852 9.22852 8.35352C8.82052 8.76052 8.5 9.082 8.5 9.75C8.5 10.026 8.276 10.25 8 10.25C7.724 10.25 7.5 10.026 7.5 9.75C7.5 8.667 8.06648 8.10148 8.52148 7.64648C8.92948 7.23948 9.25 6.918 9.25 6.25C9.25 5.538 8.712 5 8 5C7.288 5 6.75 5.538 6.75 6.25C6.75 6.526 6.526 6.75 6.25 6.75C5.974 6.75 5.75 6.526 5.75 6.25C5.75 4.988 6.738 4 8 4Z',
	edit: 'M14.236 1.76386C13.2123 0.740172 11.5525 0.740171 10.5289 1.76386L2.65722 9.63549C2.28304 10.0097 2.01623 10.4775 1.88467 10.99L1.01571 14.3755C0.971767 14.5467 1.02148 14.7284 1.14646 14.8534C1.27144 14.9783 1.45312 15.028 1.62432 14.9841L5.00978 14.1151C5.52234 13.9836 5.99015 13.7168 6.36433 13.3426L14.236 5.47097C15.2596 4.44728 15.2596 2.78755 14.236 1.76386ZM11.236 2.47097C11.8691 1.8378 12.8957 1.8378 13.5288 2.47097C14.162 3.10413 14.162 4.1307 13.5288 4.76386L12.75 5.54269L10.4571 3.24979L11.236 2.47097ZM9.75002 3.9569L12.0429 6.24979L5.65722 12.6355C5.40969 12.883 5.10023 13.0595 4.76117 13.1465L2.19447 13.8053L2.85327 11.2386C2.9403 10.8996 3.1168 10.5901 3.36433 10.3426L9.75002 3.9569Z',
	transcript: 'M14.56 7.44049C14.28 7.16049 13.9 7.00049 13.5 7.00049H13V4.00049C13 2.90049 12.1 2.00049 11 2.00049H3C1.9 2.00049 1 2.90049 1 4.00049V9.00049C1 10.1005 1.9 11.0005 3 11.0005V12.0005C3 12.8205 3.93 13.2905 4.59 12.8105L7 11.0505V11.5005C7 11.9005 7.16 12.2805 7.44 12.5605C7.72 12.8405 8.1 13.0005 8.5 13.0005H10.29L12.15 14.8505C12.19 14.9005 12.25 14.9405 12.31 14.9605C12.37 14.9905 12.43 15.0005 12.5 15.0005C12.57 15.0005 12.63 14.9905 12.69 14.9605C12.78 14.9205 12.86 14.8605 12.92 14.7805C12.97 14.7005 13 14.6005 13 14.5005V13.0005H13.5C13.9 13.0005 14.28 12.8405 14.56 12.5605C14.84 12.2805 15 11.9005 15 11.5005V8.50049C15 8.10049 14.84 7.72049 14.56 7.44049ZM6.75 10.0005L4 12.0005V10.0005H3C2.45 10.0005 2 9.55049 2 9.00049V4.00049C2 3.45049 2.45 3.00049 3 3.00049H11C11.55 3.00049 12 3.45049 12 4.00049V7.00049H8.5C8.1 7.00049 7.72 7.16049 7.44 7.44049C7.16 7.72049 7 8.10049 7 8.50049V10.0005H6.75ZM14 11.5005C14 11.6305 13.95 11.7605 13.85 11.8505C13.76 11.9505 13.63 12.0005 13.5 12.0005H12.5C12.37 12.0005 12.24 12.0505 12.15 12.1505C12.05 12.2405 12 12.3705 12 12.5005V13.2905L10.85 12.1505C10.81 12.1005 10.75 12.0605 10.69 12.0405C10.63 12.0105 10.57 12.0005 10.5 12.0005H8.5C8.37 12.0005 8.24 11.9505 8.15 11.8505C8.05 11.7605 8 11.6305 8 11.5005V8.50049C8 8.37049 8.05 8.24049 8.15 8.15049C8.24 8.05049 8.37 8.00049 8.5 8.00049H13.5C13.63 8.00049 13.76 8.05049 13.85 8.15049C13.95 8.24049 14 8.37049 14 8.50049V11.5005Z',
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

			h2,
			h3,
			h4 {
				margin: 0;
				font-size: 1rem;
				font-weight: 600;
			}

			.empty,
			.status {
				margin: 0;
				line-height: 1.45;
				color: var(--se-muted-fg);
			}

			.notice {
				margin: 10px 0;
				padding: 8px 10px;
				border: 1px solid var(--se-border);
				border-radius: 3px;
				background: var(--se-surface-bg);
				line-height: 1.45;
			}

			.notice.error {
				color: var(--vscode-errorForeground);
			}

			.context {
				margin: 0 0 12px;
				padding: 10px;
				border: 1px solid var(--se-border);
				border-radius: 3px;
				background: var(--se-surface-bg);
			}

			.context h2 {
				margin-bottom: 8px;
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

			.composer {
				display: grid;
				gap: 8px;
			}

			.composer {
				margin-bottom: 16px;
			}

			.composer-fields {
				display: grid;
				grid-template-columns: minmax(0, 1fr);
				gap: 8px;
			}

			label {
				font-weight: 600;
			}

			input,
			select,
			textarea {
				box-sizing: border-box;
				width: 100%;
				padding: 8px;
				border: 1px solid var(--se-input-border);
				border-radius: 3px;
				background: var(--se-input-bg);
				color: var(--se-input-fg);
				font-family: var(--vscode-font-family);
				font-size: var(--vscode-font-size);
				line-height: 1.4;
			}

			textarea {
				min-height: 112px;
				resize: vertical;
			}

			input:focus-visible,
			select:focus-visible,
			textarea:focus-visible,
			button:focus-visible,
			summary:focus-visible,
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

			.agents-header {
				display: flex;
				align-items: center;
				justify-content: space-between;
				gap: 8px;
				margin-bottom: 8px;
			}

			.agents-state {
				display: grid;
				justify-items: start;
				gap: 8px;
				padding: 10px;
				border: 1px solid var(--se-border);
				border-radius: 3px;
				background: var(--se-surface-bg);
			}

			.agent-list {
				display: grid;
				gap: 12px;
			}

			.agent-section {
				padding: 10px;
				border: 1px solid var(--se-border);
				border-radius: 3px;
				background: var(--se-surface-bg);
			}

			.agent-section.current-target {
				border-color: var(--se-focus);
			}

			.agent-header {
				display: grid;
				gap: 2px;
			}

			.agent-title-row {
				display: flex;
				align-items: center;
				gap: 4px;
			}

			.agent-title-row h3 {
				display: flex;
				align-items: center;
				flex: 1;
				gap: 4px;
				min-width: 0;
				overflow-wrap: anywhere;
			}

			.rename-input {
				flex: 1;
				width: auto;
				min-width: 80px;
				padding: 2px 4px;
				font-weight: 600;
			}

			.agent-title-actions {
				display: flex;
				align-items: center;
				flex: none;
				gap: 2px;
			}

			.agent-slot,
			.queue-counts,
			.fresh-session-warning,
			.work-meta,
			time {
				color: var(--se-muted-fg);
			}

			.agent-slot,
			.queue-counts {
				margin: 2px 0 0;
				line-height: 1.4;
			}

			.agent-summary {
				display: flex;
				flex-wrap: wrap;
				align-items: center;
				gap: 6px;
				margin-top: 2px;
			}

			.agent-summary .queue-counts {
				margin: 0;
			}

			.agent-actions {
				display: flex;
				flex-wrap: wrap;
				gap: 6px;
				margin-top: 10px;
			}

			.session-indicator {
				width: 10px;
				height: 10px;
				flex: none;
				border-radius: 3px;
			}

			.session-indicator.available {
				background: var(--vscode-testing-iconPassed);
			}

			.session-indicator.missing,
			.session-indicator.uninitialized {
				background: var(--vscode-editorWarning-foreground);
			}

			.work-list,
			.transcript-entries {
				display: grid;
				gap: 8px;
				margin-top: 10px;
			}

			.work-card {
				padding: 9px;
				border: 1px solid var(--se-border);
				border-radius: 3px;
				background: var(--se-bg);
			}

			.work-card-header,
			.transcript-entry-header {
				display: flex;
				align-items: baseline;
				justify-content: space-between;
				gap: 8px;
			}

			.work-status {
				padding: 1px 6px;
				border-radius: 9px;
				background: var(--vscode-badge-background);
				color: var(--vscode-badge-foreground);
				font-size: 0.9em;
				white-space: nowrap;
			}

			.work-message,
			.latest-update p,
			.transcript-text {
				white-space: pre-wrap;
				overflow-wrap: anywhere;
			}

			.work-message {
				margin: 8px 0;
			}

			.work-meta {
				margin: 0 0 8px;
			}

			.latest-update {
				padding: 8px;
				border-inline-start: 2px solid var(--se-border);
			}

			.latest-update p {
				margin: 4px 0;
			}

			details {
				margin-top: 8px;
			}

			summary {
				cursor: pointer;
			}

			.history {
				display: grid;
				gap: 8px;
				margin-bottom: 0;
				padding-inline-start: 24px;
			}

			.history p {
				margin: 2px 0;
				white-space: pre-wrap;
				overflow-wrap: anywhere;
			}

			.transcript-error {
				display: grid;
				justify-items: start;
				gap: 6px;
			}

			.transcript-entry {
				padding-top: 8px;
				border-top: 1px solid var(--se-border);
			}

			.transcript-entry:first-child {
				padding-top: 0;
				border-top: 0;
			}

			.transcript-text {
				margin: 4px 0 0;
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

			.transcript-takeover {
				display: flex;
				box-sizing: border-box;
				flex-direction: column;
				height: 100%;
				min-height: 0;
			}

			.transcript-toolbar {
				display: flex;
				align-items: center;
				justify-content: space-between;
				min-height: 34px;
				padding: 2px 4px 2px 10px;
				gap: 8px;
				border-bottom: 1px solid var(--se-border);
				background: var(--se-toolbar-bg);
			}

			.transcript-toolbar h1 {
				margin: 0;
				overflow: hidden;
				font-size: 1rem;
				text-overflow: ellipsis;
				white-space: nowrap;
			}

			.transcript-content {
				flex: 1;
				min-height: 0;
				overflow: auto;
				padding: 10px;
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

			.agent-title-actions button.icon {
				border-color: var(--se-surface-bg);
				background: var(--se-surface-bg);
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

			.annotation-work-status {
				margin: 0 0 8px;
				color: var(--se-muted-fg);
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
	private hostTargetAgentId: AgentId | undefined;
	@state() private agents: AgentsViewState = { kind: 'loading' };
	@state() private work: readonly UserAnnotationWorkItem[] = [];
	@state() private prompt: PromptContext | undefined;
	@state() private messageText = '';
	@state() private targetAgentId: AgentId | undefined;
	@state() private busy = false;
	@state() private notice: HostNotice | undefined;
	@state() private transcript: AgentTranscriptViewState | undefined;
	@state() private openTranscriptAgentId: AgentId | undefined;
	@state() private editingAgentId: AgentId | undefined;
	@state() private renameText = '';
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
		const transcriptAgent = this.agents.kind === 'ready'
			? this.agents.agents.find(agent => agent.id === this.openTranscriptAgentId)
			: undefined;
		if (transcriptAgent !== undefined) {
			return this.renderTranscriptTakeover(this.transcript, transcriptAgent);
		}
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
		return html`
			<h1>Messages</h1>
			${this.prompt === undefined ? nothing : this.renderComposer(this.prompt)}
			${this.notice === undefined
				? nothing
				: html`<p class="notice ${this.notice.tone}" role=${this.notice.tone === 'error' ? 'alert' : 'status'}>${this.notice.message}</p>`}
			<div class="agents-header">
				<h2>Agents</h2>
				<button class="secondary" type="button" ?disabled=${this.busy} @click=${this.refreshAgents}>Refresh</button>
			</div>
			${this.renderAgents()}
		`;
	}

	private renderComposer(prompt: PromptContext) {
		const availableAgents = this.agents.kind === 'ready' ? this.agents.agents : [];
		const selectedAgent = availableAgents.find(agent => agent.id === this.targetAgentId);
		const canSubmit = !this.busy && this.messageText.trim() !== '' && selectedAgent !== undefined;
		const createsFreshSession = selectedAgent !== undefined && selectedAgent.session.state !== 'available';
		return html`
			<section class="context" aria-label="Prompt context">
				<h2>New message</h2>
				<p class="status">Source: User ${prompt.preset}</p>
			</section>
			<form class="composer" @submit=${this.submitComposer} @keydown=${this.handleComposerKeydown}>
				<div class="composer-fields">
					<label for="target-agent">Current agent</label>
					<select
						id="target-agent"
						.value=${this.targetAgentId ?? ''}
						?disabled=${this.busy || availableAgents.length === 0}
						@change=${this.updateTargetAgent}
						aria-describedby=${createsFreshSession ? 'fresh-session-warning' : nothing}
						required
					>
						<option value="" disabled>Select a current agent</option>
						${availableAgents.map(agent => html`
							<option value=${agent.id}>${`>${agent.slot} ${agent.name} — ${this.sessionLabel(agent)}`}</option>
						`)}
					</select>
					${createsFreshSession
						? html`<p id="fresh-session-warning" class="fresh-session-warning">No active session found; this operation will create a fresh session.</p>`
						: nothing}
					<label for="message">Message</label>
					<textarea
						id="message"
						.value=${this.messageText}
						?readonly=${this.busy}
						@input=${this.updateMessageText}
						aria-describedby=${createsFreshSession ? 'message-help fresh-session-warning' : 'message-help'}
						required
					></textarea>
				</div>
				<div id="message-help" class="status">Press Enter to send, Shift+Enter for a new line, or Escape to cancel.</div>
				<div class="actions">
					<button type="submit" ?disabled=${!canSubmit}>Send</button>
					<button class="secondary" type="button" ?disabled=${this.busy} @click=${this.cancelComposer}>Cancel</button>
				</div>
			</form>
		`;
	}

	private renderAgents() {
		switch (this.agents.kind) {
			case 'loading':
				return html`<div class="agents-state" role="status" aria-live="polite">Loading agents…</div>`;
			case 'empty':
				return html`
					<div class="agents-state">
						<p class="empty">No managed agents are available.</p>
						<button class="secondary" type="button" ?disabled=${this.busy} @click=${this.refreshAgents}>Refresh</button>
					</div>
				`;
			case 'error':
				return html`
					<div class="agents-state" role="alert">
						<p class="empty">${this.agents.message}</p>
						${this.agents.recoverable
							? html`<button class="secondary" type="button" ?disabled=${this.busy} @click=${this.refreshAgents}>Try again</button>`
							: nothing}
					</div>
				`;
			case 'ready': {
				const orderedAgents = [...this.agents.agents].sort((left, right) => left.slot - right.slot);
				return html`
					<div class="agent-list">
						${repeat(orderedAgents, agent => agent.id, (agent, agentIndex) => this.renderAgent(agent, agentIndex))}
					</div>
				`;
			}
			default: {
				const unhandledState: never = this.agents;
				throw new Error(`Unexpected agents state: ${JSON.stringify(unhandledState)}`);
			}
		}
	}

	private renderAgent(agent: NamedAgent, agentIndex: number) {
		const currentWork = currentWorkForAgent(this.work, agent);
		const isRenaming = agent.controls.canRename && this.editingAgentId === agent.id;
		const isCurrentTarget = this.prompt !== undefined && this.targetAgentId === agent.id;
		return html`
			<section class="agent-section ${isCurrentTarget ? 'current-target' : ''}" aria-labelledby="agent-${agentIndex}-heading">
				<header class="agent-header">
					<div class="agent-title-row">
						<h3 id="agent-${agentIndex}-heading">
							<span>${`>${agent.slot}`}</span>
							${isRenaming
								? html`
									<input
										id="rename-agent"
										class="rename-input"
										.value=${this.renameText}
										@input=${this.updateRenameText}
										@keydown=${(event: KeyboardEvent) => this.handleRenameKeydown(event, agent)}
										aria-label="Name for agent slot ${agent.slot}"
										required
									>
								`
								: agent.name}
						</h3>
						<div class="agent-title-actions" role="toolbar" aria-label="${agent.name} controls" @keydown=${this.handleAgentToolbarKeydown}>
							${agent.controls.canRename && !isRenaming
								? html`
									<button
										class="icon rename-button"
										type="button"
										data-agent-id=${agent.id}
										?disabled=${this.busy}
										aria-label="Rename ${agent.name}"
										title="Rename ${agent.name}"
										@click=${() => this.beginRename(agent)}
									>${this.renderToolbarIcon('edit')}</button>
								`
								: nothing}
							${agent.session.state === 'available'
								? html`
									<button
										class="icon transcript-button"
										type="button"
										data-agent-id=${agent.id}
										aria-label="View transcript for ${agent.name}"
										title="View transcript for ${agent.name}"
										@click=${() => this.openTranscript(agent.id)}
									>${this.renderToolbarIcon('transcript')}</button>
								`
								: nothing}
							${agent.controls.canOpen
								? html`
									<button class="icon" type="button" ?disabled=${this.busy}
										aria-label="Open ${agent.name} in Codex" title="Open ${agent.name} in Codex"
										@click=${() => this.openAgent(agent.id)}>${this.renderToolbarIcon('open-external')}</button>
								`
								: nothing}
							${agent.controls.canReset
								? html`
									<button class="icon" type="button" ?disabled=${this.busy}
										aria-label="Reset ${agent.name}" title="Reset ${agent.name}"
										@click=${() => this.resetAgent(agent.id)}>${this.renderToolbarIcon('clear-agent')}</button>
								`
								: nothing}
						</div>
					</div>
					${isCurrentTarget ? html`<p class="agent-slot">Current message target</p>` : nothing}
					<div class="agent-summary">
						<p class="queue-counts">${agent.queue.waiting} waiting · ${agent.queue.working} working · ${agent.queue.completed} completed</p>
						<span
							class="session-indicator ${agent.session.state}"
							role="img"
							aria-label=${this.sessionBadgeLabel(agent)}
							title=${this.sessionBadgeLabel(agent)}
						></span>
					</div>
				</header>
				${agent.controls.canInterrupt
					? html`
						<div class="agent-actions">
							<button class="secondary" type="button" ?disabled=${this.busy} @click=${() => this.interruptAgent(agent.id)}>Interrupt</button>
						</div>
					`
					: nothing}
				${currentWork === undefined
					? nothing
					: html`<div class="work-list">${this.renderWorkCard(currentWork, agent, agentIndex, 0)}</div>`}
			</section>
		`;
	}

	private renderWorkCard(item: UserAnnotationWorkItem, agent: NamedAgent, agentIndex: number, workIndex: number) {
		const latest = item.latestUpdate;
		return html`
			<article class="work-card" aria-labelledby="agent-${agentIndex}-work-${workIndex}-heading">
				<header class="work-card-header">
					<h4 id="agent-${agentIndex}-work-${workIndex}-heading">User ${item.prompt.preset}</h4>
					<span class="work-status">${item.status}</span>
				</header>
				<p class="work-message">${item.prompt.text}</p>
				<p class="work-meta">Target: ${agent.name} · ${item.prompt.scope === 'project' ? 'Project' : 'Current line'} · Line ${item.source.line + 1}</p>
				<div class="latest-update" aria-label="Latest update">
					<strong>Latest update</strong>
					${latest === undefined
						? html`<p class="status">No updates yet.</p>`
						: html`
							<p>${latest.message}</p>
							<time datetime=${latest.at}>${this.formatTimestamp(latest.at)}</time>
						`}
				</div>
				<details @keydown=${this.handleDetailsKeydown}>
					<summary>Details and update history (${item.updates.length})</summary>
					${item.updates.length === 0
						? html`<p class="status">No updates yet.</p>`
						: html`
							<ol class="history">
								${item.updates.map(update => html`
									<li>
										<strong>${this.updateKindLabel(update.kind)}</strong>
										<p>${update.message}</p>
										<time datetime=${update.at}>${this.formatTimestamp(update.at)}</time>
									</li>
								`)}
							</ol>
						`}
				</details>
			</article>
		`;
	}

	private renderTranscriptTakeover(transcript: AgentTranscriptViewState | undefined, agent: NamedAgent) {
		return html`
			<section
				class="transcript-takeover"
				aria-labelledby="transcript-heading"
				@keydown=${(event: KeyboardEvent) => this.handleTranscriptKeydown(event, agent.id)}
			>
				<header class="transcript-toolbar">
					<h1 id="transcript-heading">${`>${agent.slot} ${agent.name} — Transcript`}</h1>
					<button class="icon transcript-close-button" type="button"
						aria-label="Close transcript for ${agent.name}" title="Close transcript"
						@click=${() => this.closeTranscript(agent.id)}>${this.renderToolbarIcon('close')}</button>
				</header>
				<div class="transcript-content">
					${transcript === undefined || transcript.agentId !== agent.id
						? html`<p class="status" role="status" aria-live="polite">Loading transcript…</p>`
						: this.renderTranscriptState(transcript, agent)}
				</div>
			</section>
		`;
	}

	private renderTranscriptState(transcript: AgentTranscriptViewState, agent: NamedAgent) {
		switch (transcript.kind) {
			case 'loading':
				return html`<p class="status" role="status" aria-live="polite">Loading transcript…</p>`;
			case 'missing':
				return html`<p class="status">This agent has a missing session.</p>`;
			case 'uninitialized':
				return html`<p class="status">This agent has an uninitialized session.</p>`;
			case 'empty':
				return html`<p class="status">${agent.name} has no transcript entries yet.</p>`;
			case 'error':
				return html`
					<div class="transcript-error" role="alert">
						<p class="status">${transcript.message}</p>
						${transcript.recoverable
							? html`<button class="secondary" type="button" @click=${() => this.requestTranscript(transcript.agentId)}>Try again</button>`
							: nothing}
					</div>
				`;
			case 'ready':
				return html`
					<div class="transcript-entries">
						${transcript.entries.map(entry => html`
							<article class="transcript-entry">
								<header class="transcript-entry-header">
									<strong>${this.transcriptRoleLabel(entry.role)}</strong>
									${entry.timestamp === undefined ? nothing : html`<time datetime=${entry.timestamp}>${this.formatTimestamp(entry.timestamp)}</time>`}
								</header>
								<p class="transcript-text">${entry.text}</p>
							</article>
						`)}
					</div>
				`;
			default: {
				const unhandledState: never = transcript;
				throw new Error(`Unexpected transcript state: ${JSON.stringify(unhandledState)}`);
			}
		}
	}

	private renderAnnotationPane() {
		const viewer = this.annotationViewer;
		const waitingAgent = viewer === undefined || this.agents.kind !== 'ready'
			? undefined
			: waitingAgentForAnnotation(this.work, this.agents.agents, viewer.annotation.id);
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
							${waitingAgent === undefined
								? nothing
								: html`<p class="annotation-work-status">Waiting for ${waitingAgent.name}</p>`}
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

	private handleHostMessageEvent = (messageEvent: MessageEvent<unknown>): void => {
		if (isValidHostToWebviewMessage(messageEvent.data)) {
			this.applyHostMessage(messageEvent.data);
		}
	};

	private applyHostMessage(hostMessage: HostToWebview): void {
		switch (hostMessage.kind) {
			case 'state': {
				this.webviewHost.setState(hostMessage);
				const isOpeningPrompt = this.prompt === undefined && hostMessage.state.prompt !== undefined;
				const hostTargetChanged = hostMessage.state.targetAgentId !== this.hostTargetAgentId;
				const previousAnnotationId = this.annotationViewer?.annotation.id;
				this.agents = hostMessage.state.agents;
				this.work = hostMessage.state.work;
				this.prompt = hostMessage.state.prompt;
				this.busy = hostMessage.state.busy === true;
				this.notice = hostMessage.state.notice;
				this.transcript = hostMessage.state.transcript;
				this.annotationViewer = hostMessage.state.annotationViewer;
				this.hostTargetAgentId = hostMessage.state.targetAgentId;
				const editingAgent = this.agents.kind === 'ready'
					? this.agents.agents.find(agent => agent.id === this.editingAgentId)
					: undefined;
				if (editingAgent?.controls.canRename !== true) {
					this.editingAgentId = undefined;
					this.renameText = '';
				}
				if (this.agents.kind !== 'ready'
					|| !this.agents.agents.some(agent => agent.id === this.openTranscriptAgentId && agent.session.state === 'available')) {
					this.openTranscriptAgentId = undefined;
				}
				if (hostMessage.state.annotationViewer?.annotation.id !== previousAnnotationId) {
					this.metadataExpanded = false;
				}
				if (hostMessage.state.annotationViewer === undefined) {
					this.takeoverExpanded = false;
				}
				if (hostMessage.state.prompt === undefined) {
					this.messageText = '';
					this.targetAgentId = undefined;
				} else {
					if (isOpeningPrompt) {
						this.messageText = hostMessage.state.draft ?? '';
					}
					if (isOpeningPrompt || hostTargetChanged || this.targetAgentId === undefined) {
						this.targetAgentId = hostMessage.state.targetAgentId;
					}
				}
				return;
			}
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

	private updateTargetAgent = (changeEvent: Event): void => {
		const value = (changeEvent.target as HTMLSelectElement).value;
		this.targetAgentId = this.agents.kind === 'ready'
			? this.agents.agents.find(agent => agent.id === value)?.id
			: undefined;
		if (this.targetAgentId !== undefined) {
			this.webviewHost.postMessage({ kind: 'selectTarget', targetAgentId: this.targetAgentId });
		}
	};

	private submitComposer = (submitEvent: SubmitEvent): void => {
		submitEvent.preventDefault();
		this.submitComposerMessage();
	};

	private submitComposerMessage(): void {
		if (this.busy || this.prompt === undefined || this.targetAgentId === undefined || this.messageText.trim() === '') {
			return;
		}

		this.busy = true;
		this.webviewHost.postMessage({ kind: 'submit', message: this.messageText, targetAgentId: this.targetAgentId });
	}

	private cancelComposer = (): void => {
		if (this.prompt !== undefined) {
			this.webviewHost.postMessage({ kind: 'cancel' });
		}
	};

	private refreshAgents = (): void => {
		if (!this.busy) {
			this.webviewHost.postMessage({ kind: 'refresh' });
		}
	};

	private beginRename(agent: NamedAgent): void {
		this.editingAgentId = agent.id;
		this.renameText = agent.name;
		void this.updateComplete.then(() => {
			const input = this.renderRoot.querySelector<HTMLInputElement>('#rename-agent');
			input?.focus();
			input?.select();
		});
	}

	private updateRenameText = (inputEvent: Event): void => {
		const input = inputEvent.target as HTMLInputElement;
		this.renameText = input.value;
		input.setCustomValidity(this.isValidAgentNameInput(input.value)
			? ''
			: 'Enter a name of 1 to 80 characters that is not only numbers.');
	};

	private confirmRename(agent: NamedAgent): void {
		if (this.busy || this.editingAgentId !== agent.id) {
			return;
		}
		const name = this.renameText.trim();
		if (!this.isValidAgentNameInput(name)) {
			this.renderRoot.querySelector<HTMLInputElement>('#rename-agent')?.reportValidity();
			return;
		}
		if (name !== agent.name) {
			this.webviewHost.postMessage({ kind: 'renameAgent', agentId: agent.id, name });
		}
		this.finishRename(agent.id);
	}

	private handleRenameKeydown(keyboardEvent: KeyboardEvent, agent: NamedAgent): void {
		if (keyboardEvent.key === 'Enter') {
			keyboardEvent.preventDefault();
			keyboardEvent.stopPropagation();
			this.confirmRename(agent);
			return;
		}
		if (keyboardEvent.key !== 'Escape') {
			return;
		}
		keyboardEvent.preventDefault();
		keyboardEvent.stopPropagation();
		this.finishRename(agent.id);
	}

	private finishRename(agentId: AgentId): void {
		this.editingAgentId = undefined;
		this.renameText = '';
		void this.updateComplete.then(() => {
			const button = [...this.renderRoot.querySelectorAll<HTMLButtonElement>('.rename-button')]
				.find(candidate => candidate.dataset.agentId === agentId);
			button?.focus();
		});
	}

	private openTranscript(agentId: AgentId): void {
		this.openTranscriptAgentId = agentId;
		this.requestTranscript(agentId);
		void this.updateComplete.then(() => {
			this.renderRoot.querySelector<HTMLButtonElement>('.transcript-close-button')?.focus();
		});
	}

	private requestTranscript(agentId: AgentId): void {
		this.webviewHost.postMessage({ kind: 'showTranscript', agentId });
	}

	private handleTranscriptKeydown(keyboardEvent: KeyboardEvent, agentId: AgentId): void {
		if (keyboardEvent.key !== 'Escape') {
			return;
		}
		keyboardEvent.preventDefault();
		keyboardEvent.stopPropagation();
		this.closeTranscript(agentId);
	}

	private closeTranscript(agentId: AgentId): void {
		if (this.openTranscriptAgentId !== agentId) {
			return;
		}
		this.openTranscriptAgentId = undefined;
		void this.updateComplete.then(() => {
			const button = [...this.renderRoot.querySelectorAll<HTMLButtonElement>('.transcript-button')]
				.find(candidate => candidate.dataset.agentId === agentId);
			button?.focus();
		});
	}

	private openAgent(agentId: AgentId): void {
		if (!this.busy) {
			this.webviewHost.postMessage({ kind: 'openAgent', agentId });
		}
	}

	private interruptAgent(agentId: AgentId): void {
		if (!this.busy) {
			this.webviewHost.postMessage({ kind: 'interruptAgent', agentId });
		}
	}

	private resetAgent(agentId: AgentId): void {
		if (!this.busy) {
			this.webviewHost.postMessage({ kind: 'resetAgent', agentId });
		}
	}

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

	private handleAgentToolbarKeydown = (keyboardEvent: KeyboardEvent): void => {
		const toolbar = keyboardEvent.currentTarget as HTMLElement;
		if (keyboardEvent.key !== 'ArrowLeft'
			&& keyboardEvent.key !== 'ArrowRight'
			&& keyboardEvent.key !== 'Home'
			&& keyboardEvent.key !== 'End') {
			return;
		}
		const buttons = [...toolbar.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
		const current = buttons.indexOf(keyboardEvent.target as HTMLButtonElement);
		if (current < 0 || buttons.length === 0) {
			return;
		}
		keyboardEvent.preventDefault();
		const next = keyboardEvent.key === 'Home'
			? 0
			: keyboardEvent.key === 'End'
				? buttons.length - 1
				: (current + (keyboardEvent.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length;
		buttons[next]?.focus();
	};

	private handleDetailsKeydown = (keyboardEvent: KeyboardEvent): void => {
		if (keyboardEvent.key !== 'Escape') {
			return;
		}
		const details = keyboardEvent.currentTarget as HTMLDetailsElement;
		if (!details.open) {
			return;
		}
		keyboardEvent.preventDefault();
		keyboardEvent.stopPropagation();
		details.open = false;
		details.querySelector<HTMLElement>('summary')?.focus();
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

	private sessionLabel(agent: NamedAgent): string {
		switch (agent.session.state) {
			case 'missing':
				return 'missing session';
			case 'uninitialized':
				return 'uninitialized session';
			case 'available':
				return 'available session';
			default: {
				const unhandledState: never = agent.session;
				throw new Error(`Unexpected session state: ${JSON.stringify(unhandledState)}`);
			}
		}
	}

	private sessionBadgeLabel(agent: NamedAgent): string {
		switch (agent.session.state) {
			case 'missing':
				return 'Missing session';
			case 'uninitialized':
				return 'Uninitialized session';
			case 'available':
				return 'Available session';
			default: {
				const unhandledState: never = agent.session;
				throw new Error(`Unexpected session state: ${JSON.stringify(unhandledState)}`);
			}
		}
	}

	private isValidAgentNameInput(value: string): boolean {
		const name = value.trim();
		return name !== '' && [...name].length <= 80 && !/[\r\n]/.test(name) && !/^\d+$/.test(name);
	}

	private updateKindLabel(kind: WorkUpdateKind): string {
		switch (kind) {
			case 'enqueued':
				return 'Enqueued';
			case 'ready':
				return 'Ready';
			case 'claimed':
				return 'Claimed';
			case 'status':
				return 'Status';
			case 'completed':
				return 'Completed';
			case 'requeued':
				return 'Requeued';
			default: {
				const unhandledKind: never = kind;
				throw new Error(`Unexpected work update kind: ${unhandledKind}`);
			}
		}
	}

	private transcriptRoleLabel(role: TranscriptRole): string {
		switch (role) {
			case 'user':
				return 'User';
			case 'assistant':
				return 'Assistant';
			case 'system':
				return 'System';
			case 'tool':
				return 'Tool';
			default: {
				const unhandledRole: never = role;
				throw new Error(`Unexpected transcript role: ${unhandledRole}`);
			}
		}
	}

	private formatTimestamp(timestamp: string): string {
		return new Date(timestamp).toLocaleString();
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
