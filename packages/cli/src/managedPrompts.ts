import { readFileSync } from 'node:fs';
import { join, sep } from 'node:path';

export const managedPromptPresets = ['%Q', '%D', '%F', '%W', '%R', '%C', '%T'] as const;
export type ManagedPromptPreset = typeof managedPromptPresets[number];

export const managedPromptScopes = ['local', 'project'] as const;
export type ManagedPromptScope = typeof managedPromptScopes[number];

export const maxAnchorContextLinesPerSide = 3;

const presetTemplates: Readonly<Record<ManagedPromptPreset, ManagedPromptTemplateName>> = {
	'%Q': 'presets/question.md',
	'%D': 'presets/deep-research.md',
	'%F': 'presets/fix.md',
	'%W': 'presets/write.md',
	'%R': 'presets/refactor.md',
	'%C': 'presets/cleanup.md',
	'%T': 'presets/test.md',
};

const scopeTemplates: Readonly<Record<ManagedPromptScope, ManagedPromptTemplateName>> = {
	local: 'scopes/local.md',
	project: 'scopes/project.md',
};
const knownPlaceholders = new Set([
	'agent_name',
	'user_request',
	'source_path',
	'source_line',
	'source_context',
	'response_file',
	'annotation_file',
]);

export type ManagedPromptTemplateName =
	| 'shared.md'
	| 'assignment.md'
	| 'presets/question.md'
	| 'presets/deep-research.md'
	| 'presets/fix.md'
	| 'presets/write.md'
	| 'presets/refactor.md'
	| 'presets/cleanup.md'
	| 'presets/test.md'
	| 'scopes/local.md'
	| 'scopes/project.md';

export type ManagedPromptTemplateLoader = (template: ManagedPromptTemplateName) => string;

export interface ManagedPromptAnchor {
	/** Zero-based source line retained by the editor. */
	readonly line: number;
	readonly text: string;
	readonly before: readonly string[];
	readonly after: readonly string[];
}

export interface ManagedPromptInput {
	readonly agentName: string;
	readonly userAnnotationId: string;
	readonly preset: ManagedPromptPreset;
	readonly scope: ManagedPromptScope;
	readonly userRequest: string;
	readonly sourcePath: string;
	readonly anchor: ManagedPromptAnchor;
}

export interface ManagedPromptRenderOptions {
	readonly loadTemplate?: ManagedPromptTemplateLoader;
	readonly responseFile?: string;
}

/**
 * Renders the complete provider prompt in the order mandated by SPEC-0018:
 * shared contract, preset, scope, then assignment payload.
 */
export function renderManagedPrompt(
	input: ManagedPromptInput,
	options: ManagedPromptRenderOptions = {},
): string {
	validateInput(input);
	const loadTemplate = options.loadTemplate ?? loadPublishedTemplate;
	const context = [...input.anchor.before, input.anchor.text, ...input.anchor.after].join('\n');

	const responseFile = `.sundial/${input.userAnnotationId}response.md`;
	const annotationFile = `.sundial/${input.userAnnotationId}newAnnotation.md`;
	const shared = renderManagedAgentContract(input.agentName, { loadTemplate, responseFile });
	const presetTemplate = presetTemplates[input.preset];
	const preset = renderTemplate(presetTemplate, loadTemplate(presetTemplate), {}, []);
	const scopeTemplate = scopeTemplates[input.scope];
	const scope = renderTemplate(scopeTemplate, loadTemplate(scopeTemplate), {}, []);
	const assignment = renderTemplate(
		'assignment.md',
		loadTemplate('assignment.md'),
		{
			user_request: escapeDelimitedValue(input.userRequest),
			source_path: escapeDelimitedValue(input.sourcePath),
			source_line: String(input.anchor.line + 1),
			source_context: escapeDelimitedValue(context),
			response_file: responseFile,
			annotation_file: annotationFile,
		},
		['user_request', 'source_path', 'source_line', 'source_context', 'response_file', 'annotation_file'],
	);

	return [shared, preset, scope, assignment].join('\n\n');
}

/** Renders the shared managed-agent contract used as provider base instructions. */
export function renderManagedAgentContract(
	agentName: string,
	options: ManagedPromptRenderOptions = {},
): string {
	if (!isSingleLineNonEmptyString(agentName)) {
		throw new Error('Managed prompt agentName must be a non-empty single-line string.');
	}
	const loadTemplate = options.loadTemplate ?? loadPublishedTemplate;
	const responseFile = options.responseFile ?? '.sundial/<UserAnnotationId>response.md';
	return renderTemplate(
		'shared.md',
		loadTemplate('shared.md'),
		{ agent_name: agentName, response_file: responseFile },
		['agent_name', 'response_file'],
	);
}

export function loadPublishedTemplate(template: ManagedPromptTemplateName): string {
	try {
		return readFileSync(join(__dirname, 'prompts', template), 'utf8');
	} catch (error) {
		if (__dirname.endsWith(`${sep}out`)) {
			return readFileSync(join(__dirname, '..', 'src', 'prompts', template), 'utf8');
		}
		throw error;
	}
}

function renderTemplate(
	templateName: ManagedPromptTemplateName,
	template: string,
	values: Readonly<Record<string, string>>,
	requiredPlaceholders: readonly string[],
): string {
	if (typeof template !== 'string' || template.trim() === '') {
		throw new Error(`Managed prompt template "${templateName}" is empty.`);
	}

	const seen = new Set<string>();
	const placeholder = /{{([^{}]*)}}/g;
	let result = '';
	let sourceIndex = 0;
	for (const match of template.matchAll(placeholder)) {
		const preceding = template.slice(sourceIndex, match.index);
		assertNoMalformedPlaceholder(templateName, preceding);
		result += preceding;

		const name = match[1];
		if (!/^[a-z][a-z0-9_]*$/.test(name) || !knownPlaceholders.has(name)) {
			throw new Error(`Unknown managed prompt placeholder "{{${name}}}" in "${templateName}".`);
		}
		if (!Object.prototype.hasOwnProperty.call(values, name)) {
			throw new Error(`Unresolved managed prompt placeholder "{{${name}}}" in "${templateName}".`);
		}
		result += values[name];
		seen.add(name);
		sourceIndex = (match.index ?? 0) + match[0].length;
	}

	const remaining = template.slice(sourceIndex);
	assertNoMalformedPlaceholder(templateName, remaining);
	result += remaining;
	for (const required of requiredPlaceholders) {
		if (!seen.has(required)) {
			throw new Error(`Unresolved required placeholder "{{${required}}}" in "${templateName}".`);
		}
	}

	return result.replace(/\r\n?/g, '\n').replace(/\n+$/, '');
}

function assertNoMalformedPlaceholder(templateName: ManagedPromptTemplateName, value: string): void {
	if (value.includes('{{') || value.includes('}}')) {
		throw new Error(`Unresolved or malformed managed prompt placeholder in "${templateName}".`);
	}
}

function escapeDelimitedValue(value: string): string {
	return value
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&#39;');
}

function validateInput(input: ManagedPromptInput): void {
	if (typeof input !== 'object' || input === null) {
		throw new Error('Managed prompt input must be an object.');
	}
	if (!isSingleLineNonEmptyString(input.agentName)) {
		throw new Error('Managed prompt agentName must be a non-empty single-line string.');
	}
	if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(input.userAnnotationId)) {
		throw new Error('Managed prompt userAnnotationId must be a safe opaque identity.');
	}
	if (!managedPromptPresets.includes(input.preset)) {
		throw new Error(`Unsupported managed prompt preset "${String(input.preset)}".`);
	}
	if (!managedPromptScopes.includes(input.scope)) {
		throw new Error(`Unsupported managed prompt scope "${String(input.scope)}".`);
	}
	if (typeof input.userRequest !== 'string' || input.userRequest.trim() === '') {
		throw new Error('Managed prompt userRequest must be a non-empty string.');
	}
	if (!isSingleLineNonEmptyString(input.sourcePath)) {
		throw new Error('Managed prompt sourcePath must be a non-empty single-line string.');
	}
	if (typeof input.anchor !== 'object' || input.anchor === null
		|| !Number.isInteger(input.anchor.line) || input.anchor.line < 0
		|| typeof input.anchor.text !== 'string'
		|| !isBoundedLineContext(input.anchor.before)
		|| !isBoundedLineContext(input.anchor.after)) {
		throw new Error(
			`Managed prompt anchor must have a non-negative line, single-line text, and at most ${maxAnchorContextLinesPerSide} context lines per side.`,
		);
	}
	if (hasLineBreak(input.anchor.text)) {
		throw new Error('Managed prompt anchor text must be a single line.');
	}
}

function isBoundedLineContext(value: unknown): value is readonly string[] {
	return Array.isArray(value)
		&& value.length <= maxAnchorContextLinesPerSide
		&& value.every(line => typeof line === 'string' && !hasLineBreak(line));
}

function isSingleLineNonEmptyString(value: unknown): value is string {
	return typeof value === 'string' && value.trim() !== '' && !hasLineBreak(value);
}

function hasLineBreak(value: string): boolean {
	return value.includes('\n') || value.includes('\r');
}
