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
	'%Q': 'Ask a question',
	'%F': 'Fix code',
	'%W': 'Write code',
	'%R': 'Refactor code',
	'%C': 'Clean up code',
	'%T': 'Create tests',
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
	const commandPrefix = linePrefix.trimStart();
	if (!commandPrefix.startsWith(promptCommandPrefix)) {
		return [];
	}

	const normalized = commandPrefix.toUpperCase();
	return promptCommandCompletions.filter(completion => completion.insertText.toUpperCase().startsWith(normalized));
}

export function isPromptCommandMode(linePrefix: string): boolean {
	return /^[ \t]*%(?:[QFWRCT](?:>[^\r\n@]*)?)?(?:[ \t]+@G?)?[ \t]*$/i.test(linePrefix);
}
