import {
	promptCommandPrefix,
	promptPresets,
	type PromptPreset,
	type PromptScope,
} from './promptCommand';

export interface PromptCommandCompletion {
	readonly insertText: string;
	readonly preset: PromptPreset;
	readonly scope: PromptScope;
	readonly detail: string;
	readonly sortText: string;
}

const presetDescriptions: Readonly<Record<PromptPreset, string>> = {
	'%Q': 'Question / no-code guidance',
	'%F': 'Fix guidance',
	'%W': 'Write guidance',
	'%R': 'Refactor guidance',
	'%C': 'Cleanup guidance',
	'%T': 'Test guidance',
};

export const promptCommandCompletions: readonly PromptCommandCompletion[] = promptPresets.flatMap(
	(preset, index) => ([
		{
			insertText: preset,
			preset,
			scope: 'line' as const,
			detail: `${presetDescriptions[preset]} — current line`,
			sortText: `${index.toString().padStart(2, '0')}-0`,
		},
		{
			insertText: `${preset} @G`,
			preset,
			scope: 'project' as const,
			detail: `${presetDescriptions[preset]} — project`,
			sortText: `${index.toString().padStart(2, '0')}-1`,
		},
	]),
);

export function completionsForPromptCommandPrefix(linePrefix: string): readonly PromptCommandCompletion[] {
	if (!linePrefix.startsWith(promptCommandPrefix)) {
		return [];
	}

	const normalized = linePrefix.toUpperCase();
	return promptCommandCompletions.filter(completion => completion.insertText.toUpperCase().startsWith(normalized));
}

export function isPromptCommandMode(linePrefix: string): boolean {
	return completionsForPromptCommandPrefix(linePrefix).length > 0;
}
