import {
	parsePromptCommand,
	promptCommandPrefix,
	promptPresets,
	type ParsedPromptCommand,
	type PromptPreset,
	type PromptScope,
	type SelectableAgent,
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
	'%D': 'Deep research',
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
			insertText: `${preset}@G`,
			preset,
			scope: 'project' as const,
			detail: `${presetDescriptions[preset]} — project`,
			sortText: `${index.toString().padStart(2, '0')}-1`,
		},
	]),
);

export function completionsForPromptCommandPrefix(
	linePrefix: string,
	targets: readonly SelectableAgent[] = [],
): readonly PromptCommandCompletion[] {
	const commandPrefix = linePrefix.trimStart();
	if (!commandPrefix.startsWith(promptCommandPrefix)) {
		return [];
	}
	const targetFirstCompletions = completionsForTargetFirstPromptCommand(commandPrefix, targets);
	if (targetFirstCompletions !== undefined) {
		return targetFirstCompletions;
	}
	const targetedCompletions = completionsForTargetedPromptCommand(commandPrefix, targets);
	if (targetedCompletions !== undefined) {
		return targetedCompletions;
	}

	const normalized = commandPrefix.toUpperCase();
	const presetCompletions = promptCommandCompletions.filter(completion => completion.insertText.toUpperCase().startsWith(normalized));
	const preset = promptPresets.find(candidate => candidate === normalized);
	return preset === undefined
		? presetCompletions
		: [...presetCompletions, ...completionsForTargets(preset, targets, 'slot')];
}

function completionsForTargetFirstPromptCommand(
	commandPrefix: string,
	targets: readonly SelectableAgent[],
): readonly PromptCommandCompletion[] | undefined {
	const match = /^%>(.*)$/i.exec(commandPrefix.trimEnd());
	if (match === null) {
		return undefined;
	}

	const selectorPrefix = match[1].toUpperCase();
	const selectorKind = /^\d/u.test(match[1]) || match[1] === '' ? 'slot' : 'name';
	return promptPresets.flatMap(preset => completionsForTargets(preset, targets, selectorKind))
		.filter(completion => completion.insertText.slice(3).toUpperCase().startsWith(selectorPrefix));
}

function completionsForTargetedPromptCommand(
	commandPrefix: string,
	targets: readonly SelectableAgent[],
): readonly PromptCommandCompletion[] | undefined {
	const match = /^(%[QDFWRCT])>(.*)$/i.exec(commandPrefix.trimEnd());
	if (match === null) {
		return undefined;
	}

	const targetedCommand = `${match[1].toUpperCase()}>${match[2]}`;
	const selectorKind = /^\d/u.test(match[2]) || match[2] === '' ? 'slot' : 'name';
	const availableTargets = completionsForTargets(match[1].toUpperCase() as PromptPreset, targets, selectorKind)
		.filter(completion => completion.insertText.toUpperCase().startsWith(targetedCommand.toUpperCase()));
	if (availableTargets.length > 0) {
		return availableTargets;
	}
	const projectPrefix = /^(.*\S)@G?$/i.exec(targetedCommand);
	if (projectPrefix !== null) {
		const projectCommand = `${projectPrefix[1]}@G`;
		const parsed = parsePromptCommand(projectCommand);
		return parsed === undefined ? [] : [completionForParsedCommand(projectCommand, parsed)];
	}

	const parsed = parsePromptCommand(targetedCommand);
	if (parsed === undefined) {
		return [];
	}
	const projectCommand = `${targetedCommand}@G`;
	const project = parsePromptCommand(projectCommand);
	return [
		completionForParsedCommand(targetedCommand, parsed),
		...(project === undefined ? [] : [completionForParsedCommand(projectCommand, project)]),
	];
}

function completionsForTargets(
	preset: PromptPreset,
	targets: readonly SelectableAgent[],
	selectorKind: 'slot' | 'name',
): readonly PromptCommandCompletion[] {
	const presetIndex = promptPresets.indexOf(preset);
	return targets.flatMap(target => {
		const selector = selectorKind === 'slot' ? target.slot.toString() : target.name;
		return (['line', 'project'] as const).map(scope => ({
			insertText: `${preset}>${selector}${scope === 'project' ? '@G' : ''}`,
			preset,
			scope,
			detail: `${presetDescriptions[preset]} — ${target.name} (agent ${target.slot}) — ${scope === 'line' ? 'current line' : 'project'}`,
			sortText: `${presetIndex.toString().padStart(2, '0')}-2-${target.slot.toString().padStart(6, '0')}-${scope === 'line' ? '0' : '1'}`,
		}));
	});
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
	return /^[ \t]*%(?:[QDFWRCT])?(?:>[^\r\n@]*)?(?:@G?)?[ \t]*$/i.test(linePrefix);
}
