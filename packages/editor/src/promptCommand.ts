export const promptCommandPrefix = '%';
export const promptPresets = ['%Q', '%F', '%W', '%R', '%C', '%T'] as const;

export type PromptPreset = typeof promptPresets[number];
export type PromptScope = 'line' | 'project';

export interface ParsedPromptCommand {
	readonly preset: PromptPreset;
	readonly scope: PromptScope;
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

const commandPattern = /^(%Q|%F|%W|%R|%C|%T)(?:[ \t]+(@G))?[ \t]*$/;

export function parsePromptCommand(sourceLine: string): ParsedPromptCommand | undefined {
	const match = commandPattern.exec(sourceLine);
	if (match === null) {
		return undefined;
	}

	return {
		preset: match[1] as PromptPreset,
		scope: match[2] === '@G' ? 'project' : 'line',
	};
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
