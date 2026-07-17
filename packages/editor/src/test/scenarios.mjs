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
		description: 'A percent command removes its source line and populates the Messages composer with integration stub text.',
	},
];
