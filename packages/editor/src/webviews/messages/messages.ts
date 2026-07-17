import { promptPresets, type PromptContext, type PromptPreset, type PromptScope } from '../../promptCommand.js';

export type HostToWebview =
	| { kind: 'state'; prompt?: undefined; draft?: undefined }
	| { kind: 'state'; prompt: PromptContext; draft: string }
	| { kind: 'focusComposer' }
	| { kind: 'clearPrompt' }
	| { kind: 'submissionAcknowledged' };

export type WebviewToHost =
	| { kind: 'submit'; message: string }
	| { kind: 'cancel' };

export function isValidHostToWebviewMessage(value: unknown): value is HostToWebview {
	if (!isRecord(value)) {
		return false;
	}

	if (value.kind === 'focusComposer' || value.kind === 'clearPrompt' || value.kind === 'submissionAcknowledged') {
		return true;
	}

	if (value.kind !== 'state') {
		return false;
	}

	if (value.prompt === undefined) {
		return value.draft === undefined;
	}

	return isPromptContext(value.prompt) && typeof value.draft === 'string';
}

export function isValidWebviewToHostMessage(value: unknown): value is WebviewToHost {
	if (!isRecord(value)) {
		return false;
	}

	return (value.kind === 'submit' && typeof value.message === 'string')
		|| value.kind === 'cancel';
}

function isPromptContext(value: unknown): value is PromptContext {
	if (!isRecord(value)) {
		return false;
	}

	return isPromptPreset(value.preset)
		&& isPromptScope(value.scope)
		&& typeof value.sourceUri === 'string'
		&& typeof value.sourceLine === 'number'
		&& Number.isInteger(value.sourceLine)
		&& value.sourceLine >= 0
		&& typeof value.sourceText === 'string';
}

function isPromptPreset(value: unknown): value is PromptPreset {
	return typeof value === 'string' && (promptPresets as readonly string[]).includes(value);
}

function isPromptScope(value: unknown): value is PromptScope {
	return value === 'line' || value === 'project';
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}
