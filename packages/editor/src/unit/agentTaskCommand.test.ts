import * as assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
	agentTaskCommands,
	createAgentTask,
	type CreateAgentTaskDependencies,
} from '../agentTaskCommand';
import { promptPresets, type PromptContext } from '../promptCommand';
import type { PromptEditor } from '../promptSubmission';

function createEditor(
	lines: readonly string[],
	activeLine: number,
	save: () => Promise<boolean> = async () => true,
): PromptEditor {
	return {
		selection: { active: { line: activeLine } },
		document: {
			lineCount: lines.length,
			uri: { toString: () => 'file:///workspace/src/example.ts' },
			lineAt: line => ({ text: lines[line] }),
			save,
		},
		edit: async () => assert.fail('agent task commands must not edit the source document'),
	};
}

function dependencies(
	editor: PromptEditor | undefined,
	overrides: Partial<CreateAgentTaskDependencies> = {},
): CreateAgentTaskDependencies {
	return {
		activeTextEditor: () => editor,
		reportValidationFailure: () => undefined,
		openComposer: async () => undefined,
		workspaceCwd: () => '/workspace',
		...overrides,
	};
}

describe('agent task command catalog', () => {
	test('exposes one line and one project command for every prompt preset', () => {
		assert.equal(agentTaskCommands.length, promptPresets.length * 2);
		assert.equal(new Set(agentTaskCommands.map(command => command.id)).size, agentTaskCommands.length);
		assert.equal(new Set(agentTaskCommands.map(command => command.title)).size, agentTaskCommands.length);

		for (const preset of promptPresets) {
			assert.deepEqual(
				agentTaskCommands.filter(command => command.preset === preset).map(command => command.scope),
				['line', 'project'],
			);
		}
		assert.ok(agentTaskCommands.every(command => command.id.startsWith('sundialEditor.task.')));
		assert.deepEqual(
			agentTaskCommands.filter(command => command.preset === '%D').map(command => command.id),
			['sundialEditor.task.deepResearch', 'sundialEditor.task.deepResearchProject'],
		);
	});
});

describe('createAgentTask', () => {
	test('saves and opens a project composer anchored to the unchanged active line', async () => {
		const events: string[] = [];
		const opened: PromptContext[] = [];
		const editor = createEditor([
			'oldest ignored', 'before one', '', 'before two', 'before three',
			'active source', '', 'after one', 'after two', 'after three', 'newest ignored',
		], 5, async () => { events.push('save'); return true; });

		const created = await createAgentTask(
			{ preset: '%R', scope: 'project' },
			dependencies(editor, {
				validatePrompt: prompt => { events.push(`validate:${prompt.anchorText}`); return undefined; },
				openComposer: async prompt => { events.push('open'); opened.push(prompt); },
			}),
		);

		assert.equal(created, true);
		assert.deepEqual(events, ['save', 'validate:active source', 'open']);
		assert.deepEqual(opened, [{
			preset: '%R',
			scope: 'project',
			sourceUri: 'file:///workspace/src/example.ts',
			sourceLine: 5,
			sourceText: '%R@G',
			anchorText: 'active source',
			anchorBefore: ['before one', 'before two', 'before three'],
			anchorAfter: ['after one', 'after two', 'after three'],
		}]);
		assert.equal(editor.document.lineAt(5).text, 'active source');
	});

	test('preserves an empty active line as the source anchor', async () => {
		const opened: PromptContext[] = [];
		const created = await createAgentTask(
			{ preset: '%Q', scope: 'line' },
			dependencies(createEditor(['before', '', 'after'], 1), {
				openComposer: async prompt => { opened.push(prompt); },
			}),
		);

		assert.equal(created, true);
		assert.equal(opened[0].sourceText, '%Q');
		assert.equal(opened[0].anchorText, '');
		assert.deepEqual(opened[0].anchorBefore, ['before']);
		assert.deepEqual(opened[0].anchorAfter, ['after']);
	});

	test('reports missing editors and files outside the workspace without saving or opening', async () => {
		const failures: string[] = [];
		let opened = false;
		assert.equal(await createAgentTask(
			{ preset: '%F', scope: 'line' },
			dependencies(undefined, {
				reportValidationFailure: message => { failures.push(message); },
				openComposer: async () => { opened = true; },
			}),
		), false);
		assert.match(failures[0], /Open a workspace document/);

		let saved = false;
		assert.equal(await createAgentTask(
			{ preset: '%F', scope: 'line' },
			dependencies(createEditor(['source'], 0, async () => { saved = true; return true; }), {
				workspaceCwd: () => undefined,
				reportValidationFailure: message => { failures.push(message); },
				openComposer: async () => { opened = true; },
			}),
		), false);
		assert.equal(saved, false);
		assert.equal(opened, false);
		assert.match(failures[1], /inside an open workspace/);
	});

	test('does not validate or open when the document cannot be saved', async () => {
		const failures: string[] = [];
		let validated = false;
		let opened = false;
		const created = await createAgentTask(
			{ preset: '%W', scope: 'line' },
			dependencies(createEditor(['source'], 0, async () => false), {
				reportValidationFailure: message => { failures.push(message); },
				validatePrompt: () => { validated = true; return undefined; },
				openComposer: async () => { opened = true; },
			}),
		);

		assert.equal(created, false);
		assert.equal(validated, false);
		assert.equal(opened, false);
		assert.match(failures[0], /could not be saved/);

		failures.length = 0;
		assert.equal(await createAgentTask(
			{ preset: '%W', scope: 'line' },
			dependencies(createEditor(['source'], 0, async () => { throw new Error('save rejected'); }), {
				reportValidationFailure: message => { failures.push(message); },
			}),
		), false);
		assert.match(failures[0], /could not be saved/);
	});

	test('reports target validation failures after saving without opening the composer', async () => {
		const failures: string[] = [];
		let opened = false;
		const created = await createAgentTask(
			{ preset: '%T', scope: 'project' },
			dependencies(createEditor(['source'], 0), {
				reportValidationFailure: message => { failures.push(message); },
				validatePrompt: () => 'No managed agents are available.',
				openComposer: async () => { opened = true; },
			}),
		);

		assert.equal(created, false);
		assert.equal(opened, false);
		assert.equal(failures[0], 'Sundial Editor: No managed agents are available.');
	});
});
