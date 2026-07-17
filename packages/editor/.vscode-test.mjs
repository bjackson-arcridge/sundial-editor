import * as os from 'node:os';
import * as path from 'node:path';

import { defineConfig } from '@vscode/test-cli';

import { scenarios, workspacesRoot } from './src/test/scenarios.mjs';
import { vscodeTestExecutablePath, vscodeTestVersion } from '../../scripts/vscode-test-runtime.mjs';

const userDataRoot = path.join(os.tmpdir(), 'se-it');

export default defineConfig(scenarios.map(scenario => ({
	label: scenario.label,
	files: `out/test/scenarios/${scenario.label}.test.js`,
	extensionDevelopmentPath: '.',
	version: vscodeTestVersion,
	useInstallation: { fromPath: vscodeTestExecutablePath },
	workspaceFolder: path.join(workspacesRoot, scenario.label),
	launchArgs: [
		'--disable-extensions',
		'--user-data-dir', path.join(userDataRoot, scenario.label),
	],
	mocha: {
		timeout: 20000,
	},
})));
