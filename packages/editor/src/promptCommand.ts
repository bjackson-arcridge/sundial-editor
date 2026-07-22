import { annotationPromptPresets } from '@arcridge/sundial-editor-annotations';

export const promptCommandPrefix = '%';
export const promptPresets = annotationPromptPresets;

export type PromptPreset = typeof promptPresets[number];
export type PromptScope = 'line' | 'project';

export type PromptTargetSelector =
	| { readonly kind: 'slot'; readonly slot: number }
	| { readonly kind: 'name'; readonly name: string };

export interface SelectableAgent {
	readonly slot: number;
	readonly name: string;
}

export interface ParsedPromptCommand {
	readonly preset: PromptPreset;
	readonly scope: PromptScope;
	readonly targetSelector?: PromptTargetSelector;
}

export interface PromptContext extends ParsedPromptCommand {
	readonly sourceUri: string;
	readonly sourceLine: number;
	readonly sourceText: string;
	readonly anchorText: string;
	readonly anchorBefore: readonly string[];
	readonly anchorAfter: readonly string[];
}

export interface CommandLinePosition {
	readonly line: number;
	readonly character: number;
}

export interface CommandLineDeletionRange {
	readonly start: CommandLinePosition;
	readonly end: CommandLinePosition;
}

export type PromptTargetResolutionErrorCode = 'unknown' | 'ambiguous';

export class PromptTargetResolutionError extends Error {
	constructor(
		readonly code: PromptTargetResolutionErrorCode,
		readonly selector: PromptTargetSelector,
	) {
		super(code === 'unknown'
			? `No current agent matches selector ${formatPromptTargetSelector(selector)}.`
			: `Agent selector ${formatPromptTargetSelector(selector)} is ambiguous.`);
		this.name = 'PromptTargetResolutionError';
	}
}

export function parsePromptCommand(sourceLine: string): ParsedPromptCommand | undefined {
	if (/[\r\n\u2028\u2029]/u.test(sourceLine)) {
		return undefined;
	}

	const command = sourceLine.trim();
	const preset = command.slice(0, 2);
	if (!(promptPresets as readonly string[]).includes(preset)) {
		return undefined;
	}

	let remainder = command.slice(2);
	let scope: PromptScope = 'line';
	let targetSelector: PromptTargetSelector | undefined;
	if (remainder.startsWith('>')) {
		remainder = remainder.slice(1);
		const projectScope = /^(.*\S)@G$/u.exec(remainder);
		if (projectScope !== null) {
			remainder = projectScope[1];
			scope = 'project';
		}
		if (remainder === '@G') {
			return undefined;
		}
		targetSelector = parseTargetSelector(remainder);
		if (targetSelector === undefined) {
			return undefined;
		}
	} else if (/^@G$/u.test(remainder)) {
		scope = 'project';
	} else if (remainder !== '') {
		return undefined;
	}

	return {
		preset: preset as PromptPreset,
		scope,
		...(targetSelector === undefined ? {} : { targetSelector }),
	};
}

export function resolvePromptTargetSelector<T extends SelectableAgent>(
	selector: PromptTargetSelector,
	agents: readonly T[],
): T {
	const matches = selector.kind === 'slot'
		? agents.filter(agent => agent.slot === selector.slot)
		: agents.filter(agent => agent.name.toLowerCase() === selector.name.toLowerCase());

	if (matches.length === 0) {
		throw new PromptTargetResolutionError('unknown', selector);
	}
	if (matches.length > 1) {
		throw new PromptTargetResolutionError('ambiguous', selector);
	}
	return matches[0];
}

export function formatPromptTargetSelector(selector: PromptTargetSelector): string {
	return selector.kind === 'slot' ? `>${selector.slot}` : `>${selector.name}`;
}

function parseTargetSelector(value: string): PromptTargetSelector | undefined {
	if (value === ''
		|| value !== value.trim()
		|| [...value].length > 80) {
		return undefined;
	}
	if (/^[1-9]\d*$/.test(value)) {
		const slot = Number(value);
		return Number.isSafeInteger(slot) ? { kind: 'slot', slot } : undefined;
	}
	return /^\d+$/.test(value) ? undefined : { kind: 'name', name: value };
}

export function commandLineDeletionRange(line: number, lineCount: number, lineLength: number): CommandLineDeletionRange {
	if (!Number.isInteger(line) || !Number.isInteger(lineCount) || !Number.isInteger(lineLength) || line < 0 || line >= lineCount || lineLength < 0) {
		throw new RangeError('Cannot create a deletion range outside the document.');
	}

	return {
		start: { line, character: 0 },
		end: line < lineCount - 1
			? { line: line + 1, character: 0 }
			: { line, character: lineLength },
	};
}

export function createPromptContext(
	parsed: ParsedPromptCommand,
	sourceUri: string,
	sourceLine: number,
	sourceText: string,
	anchorText: string,
	anchorBefore: readonly string[],
	anchorAfter: readonly string[],
): PromptContext {
	return {
		...parsed,
		sourceUri,
		sourceLine,
		sourceText,
		anchorText,
		anchorBefore,
		anchorAfter,
	};
}
