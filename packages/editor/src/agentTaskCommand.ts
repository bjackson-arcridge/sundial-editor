import type {
	PromptContext,
	PromptPreset,
	PromptScope,
} from './promptCommand';
import type { PromptEditor } from './promptSubmission';
import { captureLineAnchor } from './annotationResponse';

export interface AgentTaskCommand {
	readonly id: string;
	readonly title: string;
	readonly preset: PromptPreset;
	readonly scope: PromptScope;
}

export const agentTaskCommands: readonly AgentTaskCommand[] = [
	{ id: 'sundialEditor.task.question', title: 'Sundial Editor: Create Question Task for Current Line', preset: '%Q', scope: 'line' },
	{ id: 'sundialEditor.task.questionProject', title: 'Sundial Editor: Create Project Question Task', preset: '%Q', scope: 'project' },
	{ id: 'sundialEditor.task.deepResearch', title: 'Sundial Editor: Create Deep Research Task for Current Line', preset: '%D', scope: 'line' },
	{ id: 'sundialEditor.task.deepResearchProject', title: 'Sundial Editor: Create Project Deep Research Task', preset: '%D', scope: 'project' },
	{ id: 'sundialEditor.task.fix', title: 'Sundial Editor: Create Fix Task for Current Line', preset: '%F', scope: 'line' },
	{ id: 'sundialEditor.task.fixProject', title: 'Sundial Editor: Create Project Fix Task', preset: '%F', scope: 'project' },
	{ id: 'sundialEditor.task.write', title: 'Sundial Editor: Create Write Task for Current Line', preset: '%W', scope: 'line' },
	{ id: 'sundialEditor.task.writeProject', title: 'Sundial Editor: Create Project Write Task', preset: '%W', scope: 'project' },
	{ id: 'sundialEditor.task.refactor', title: 'Sundial Editor: Create Refactor Task for Current Line', preset: '%R', scope: 'line' },
	{ id: 'sundialEditor.task.refactorProject', title: 'Sundial Editor: Create Project Refactor Task', preset: '%R', scope: 'project' },
	{ id: 'sundialEditor.task.cleanup', title: 'Sundial Editor: Create Cleanup Task for Current Line', preset: '%C', scope: 'line' },
	{ id: 'sundialEditor.task.cleanupProject', title: 'Sundial Editor: Create Project Cleanup Task', preset: '%C', scope: 'project' },
	{ id: 'sundialEditor.task.test', title: 'Sundial Editor: Create Test Task for Current Line', preset: '%T', scope: 'line' },
	{ id: 'sundialEditor.task.testProject', title: 'Sundial Editor: Create Project Test Task', preset: '%T', scope: 'project' },
];

export interface CreateAgentTaskDependencies {
	readonly activeTextEditor: () => PromptEditor | undefined;
	readonly reportValidationFailure: (message: string) => void | Thenable<unknown>;
	readonly openComposer: (prompt: PromptContext) => Promise<void>;
	readonly workspaceCwd: (sourceUri: string) => string | undefined;
	readonly validatePrompt?: (prompt: PromptContext, workspaceCwd: string) => string | undefined | Promise<string | undefined>;
}

export async function createAgentTask(
	command: Pick<AgentTaskCommand, 'preset' | 'scope'>,
	dependencies: CreateAgentTaskDependencies,
): Promise<boolean> {
	const editor = dependencies.activeTextEditor();
	if (editor === undefined) {
		await dependencies.reportValidationFailure('Sundial Editor: Open a workspace document and place the cursor on the task source line.');
		return false;
	}

	const sourceUri = editor.document.uri.toString();
	const workspaceCwd = dependencies.workspaceCwd(sourceUri);
	if (workspaceCwd === undefined) {
		await dependencies.reportValidationFailure('Sundial Editor: Agent tasks require a file inside an open workspace.');
		return false;
	}
	let saved: boolean;
	try {
		saved = await editor.document.save();
	} catch {
		saved = false;
	}
	if (!saved) {
		await dependencies.reportValidationFailure('Sundial Editor: The document could not be saved before creating the task.');
		return false;
	}

	const sourceLine = editor.selection.active.line;
	const anchor = captureLineAnchor(editor.document, sourceLine);
	const sourceText = `${command.preset}${command.scope === 'project' ? '@G' : ''}`;
	const prompt: PromptContext = {
		preset: command.preset,
		scope: command.scope,
		sourceUri,
		sourceLine,
		sourceText,
		anchorText: anchor.text,
		anchorBefore: anchor.before,
		anchorAfter: anchor.after,
	};
	const validationFailure = await dependencies.validatePrompt?.(prompt, workspaceCwd);
	if (validationFailure !== undefined) {
		await dependencies.reportValidationFailure(`Sundial Editor: ${validationFailure}`);
		return false;
	}

	await dependencies.openComposer(prompt);
	return true;
}
