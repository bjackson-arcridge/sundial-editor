import * as os from 'node:os';
import * as path from 'node:path';

export const workspacesRoot = path.join(os.tmpdir(), 'se-it-ws');

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
];
