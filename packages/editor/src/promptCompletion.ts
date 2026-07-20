import {
	parsePromptCommand,
	promptCommandPrefix,
	promptPresets,
	type ParsedPromptCommand,
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
	const targetedCompletions = completionsForTargetedPromptCommand(commandPrefix);
	if (targetedCompletions !== undefined) {
		return targetedCompletions;
	}

	const normalized = commandPrefix.toUpperCase();
	return promptCommandCompletions.filter(completion => completion.insertText.toUpperCase().startsWith(normalized));
}

function completionsForTargetedPromptCommand(commandPrefix: string): readonly PromptCommandCompletion[] | undefined {
	const match = /^(%[QFWRCT])>(.*)$/i.exec(commandPrefix.trimEnd());
	if (match === null) {
		return undefined;
	}

	const targetedCommand = `${match[1].toUpperCase()}>${match[2]}`;
	const projectPrefix = /^(.*\S)[ \t]+@G?$/i.exec(targetedCommand);
	if (projectPrefix !== null) {
		const projectCommand = `${projectPrefix[1]} @G`;
		const parsed = parsePromptCommand(projectCommand);
		return parsed === undefined ? [] : [completionForParsedCommand(projectCommand, parsed)];
	}

	const parsed = parsePromptCommand(targetedCommand);
	if (parsed === undefined) {
		return [];
	}
	const projectCommand = `${targetedCommand} @G`;
	const project = parsePromptCommand(projectCommand);
	return [
		completionForParsedCommand(targetedCommand, parsed),
		...(project === undefined ? [] : [completionForParsedCommand(projectCommand, project)]),
	];
}

function completionForParsedCommand(insertText: string, parsed: ParsedPromptCommand): PromptCommandCompletion {
	const presetIndex = promptPresets.indexOf(parsed.preset);
	return {
		insertText,
		preset: parsed.preset,
		scope: parsed.scope,
		detail: `${presetDescriptions[parsed.preset]} — ${parsed.scope === 'line' ? 'current line' : 'project'}`,
		sortText: `${presetIndex.toString().padStart(2, '0')}-${parsed.scope === 'line' ? '0' : '1'}`,
	};
}

export function isPromptCommandMode(linePrefix: string): boolean {
	return /^[ \t]*%(?:[QFWRCT](?:>[^\r\n@]*)?)?(?:[ \t]+@G?)?[ \t]*$/i.test(linePrefix);
}
