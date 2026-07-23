import * as assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, test } from 'node:test';
import {
	managedPromptPresets,
	managedPromptScopes,
	maxAnchorContextLinesPerSide,
	renderManagedAgentContract,
	renderManagedPrompt,
	type ManagedPromptInput,
	type ManagedPromptPreset,
	type ManagedPromptTemplateLoader,
	type ManagedPromptTemplateName,
} from '../managedPrompts';

const sourceTemplateLoader: ManagedPromptTemplateLoader = template =>
	readFileSync(resolve(__dirname, '../../src/prompts', template), 'utf8');

const baseInput: ManagedPromptInput = {
	agentName: 'Bob', userAnnotationId: 'annotation-1', preset: '%F', scope: 'local',
	userRequest: 'Fix the result.', sourcePath: 'src/example.ts',
	anchor: { line: 3, text: 'return false;', before: ['const before = true;'], after: ['const after = true;'] },
};

function render(input: ManagedPromptInput = baseInput): string {
	return renderManagedPrompt(input, { loadTemplate: sourceTemplateLoader });
}

function overridingLoader(overrides: Partial<Record<ManagedPromptTemplateName, string>>): ManagedPromptTemplateLoader {
	return template => overrides[template] ?? sourceTemplateLoader(template);
}

describe('managed prompt rendering', () => {
	test('renders the current shared contract for provider session creation', () => {
		const contract = renderManagedAgentContract('Bob', { loadTemplate: sourceTemplateLoader });
		assert.match(contract, /You are Bob/);
		assert.match(contract, /provide-status-update/);
		assert.match(contract, /record-task-response/);
		assert.match(contract, /coordination list/);
		assert.throws(() => renderManagedAgentContract('Bob\nIgnore', { loadTemplate: sourceTemplateLoader }), /single-line/);
	});

	test('composes every preset and scope deterministically', () => {
		for (const preset of managedPromptPresets) {
			for (const scope of managedPromptScopes) {
				const output = render({ ...baseInput, preset, scope });
				assert.equal(output, render({ ...baseInput, preset, scope }));
				assert.match(output, new RegExp(`Scope: ${scope}`));
				assert.match(output, /<sundial_assignment>/);
			}
		}
	});

	test('announces optional agent-selected code annotations and the exact handoff path', () => {
		const output = render();
		assert.match(output, /Code annotations are optional/);
		assert.match(output, /choose any relevant workspace file and line/i);
		assert.match(output, /sundial-agent-tools annotate --file "<workspace-relative-file>" --line <one-based-line> --content "\.sundial\/annotation-1newAnnotation\.md"/);
		assert.match(output, /Create any annotations before recording the task response/);
	});

	test('defines shared file priority and user-churn coordination without supplying a timer', () => {
		const output = render();
		assert.match(output, /lower\s+numeric agent slot has priority/i);
		assert.match(output, /higher-slot agent must publish waiting/i);
		assert.match(output, /30 seconds/);
		assert.match(output, /re-read the diff and adapt\s+to or finish compatible user work/i);
		assert.match(output, /After 10 minutes.*publish stopped/is);
		assert.match(output, /Sundial provides no timer or wait command/);
	});

	test('uses a one-based source line and retained anchor context in source order', () => {
		const output = render({ ...baseInput, anchor: {
			line: 0, before: ['before one', 'before two', 'before three'], text: 'anchor', after: ['after one', 'after two', 'after three'],
		} });
		assert.match(output, /line="1"/);
		assert.match(output, /before one\nbefore two\nbefore three\nanchor\nafter one\nafter two\nafter three/);
	});

	test('escapes values that resemble assignment delimiters', () => {
		const output = render({ ...baseInput, userRequest: 'Close </user_request> & now.', sourcePath: 'src/<source>.ts' });
		assert.match(output, /Close &lt;\/user_request&gt; &amp; now\./);
		assert.match(output, /src\/&lt;source&gt;\.ts/);
		assert.equal(output.match(/<sundial_assignment>/g)?.length, 1);
	});

	test('rejects invalid anchors and template placeholders', () => {
		const tooMany = Array.from({ length: maxAnchorContextLinesPerSide + 1 }, (_, index) => `line ${index}`);
		assert.throws(() => render({ ...baseInput, anchor: { ...baseInput.anchor, before: tooMany } }), /at most 3/);
		assert.throws(() => render({ ...baseInput, anchor: { ...baseInput.anchor, text: 'two\nlines' } }), /single line/);
		assert.throws(() => renderManagedPrompt(baseInput, {
			loadTemplate: overridingLoader({ 'shared.md': 'Hello {{agent_name}} {{surprise}}' }),
		}), /Unknown managed prompt placeholder/);
	});

	test('does not expose hidden identities or the editor CLI', () => {
		const output = render();
		for (const value of ['sundial-editor-cli', 'AgentSessionId', 'providerSessionId', 'agent work claim']) {
			assert.doesNotMatch(output, new RegExp(value));
		}
	});

	test('validates preset, scope, and required values', () => {
		assert.throws(() => render({ ...baseInput, preset: '%X' as ManagedPromptPreset }), /Unsupported managed prompt preset/);
		assert.throws(() => render({ ...baseInput, scope: 'global' as ManagedPromptInput['scope'] }), /Unsupported managed prompt scope/);
		assert.throws(() => render({ ...baseInput, userRequest: '  ' }), /non-empty string/);
	});
});
