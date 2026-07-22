import * as os from 'node:os';
import * as path from 'node:path';

export const workspacesRoot = path.join(os.tmpdir(), 'se-it-ws');
export const userDataRoot = path.join(os.tmpdir(), 'se-it');

const committedDiffSource = `${Array.from({ length: 400 }, (_, index) => `line ${index}${index === 210 ? ' committed' : ''}`).join('\n')}\n`;
const workingDiffSource = `${Array.from({ length: 400 }, (_, index) => `line ${index}${index === 210 ? ' working' : ''}`).join('\n')}\n`;

export const scenarios = [
	{
		label: 'delayed-autosave',
		description: 'VS Code saves the latest change through the contributed default delay.',
	},
	{
		label: 'prompt-to-messages',
		description: 'A percent command submits structured context to a testable CLI and streams the result.',
	},
	{
		label: 'annotation-retry',
		description: 'A failed companion append retries without delivering the agent prompt twice.',
	},
	{
		label: 'annotation-reanchor',
		description: 'Saved-source baselines adopt resilient line and file-scoped annotation locations.',
		git: { commits: [], workingTree: {} },
	},
	{
		label: 'diff-workflow',
		description: 'Global diff mode replaces and restores workspace editors across baseline changes.',
		settings: {
			'diffEditor.hideUnchangedRegions.enabled': false,
			'diffEditor.renderSideBySide': true,
			'diffEditor.useInlineViewWhenSpaceIsLimited': false,
		},
		git: {
			commits: [{ message: 'Second', files: { 'source-one.txt': committedDiffSource } }],
			workingTree: { 'source-one.txt': workingDiffSource, 'annotated-source.txt': 'untracked annotated source\n' },
		},
	},
];
