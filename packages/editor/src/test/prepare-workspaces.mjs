#!/usr/bin/env node
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { scenarios, workspacesRoot } from './scenarios.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(here, '..', '..');
const fixturesRoot = path.join(here, 'fixtures');
const localCliPath = path.resolve(packageRoot, '..', 'cli', 'dist', 'main.js');

async function main() {
	await fs.rm(workspacesRoot, { recursive: true, force: true });
	await fs.mkdir(workspacesRoot, { recursive: true });

	for (const scenario of scenarios) {
		const fixture = path.join(fixturesRoot, scenario.label);
		const target = path.join(workspacesRoot, scenario.label);
		await fs.cp(fixture, target, { recursive: true });
		await fs.mkdir(path.join(target, '.vscode'), { recursive: true });
		await fs.writeFile(path.join(target, '.vscode', 'settings.json'), `${JSON.stringify({
			'sundialEditor.cliPath': localCliPath,
		}, undefined, '\t')}\n`);
		console.log(`[prepare-workspaces] staged "${scenario.label}" -> ${path.relative(packageRoot, target)}`);
	}
}

main().catch(error => {
	console.error('[prepare-workspaces] failed:', error);
	process.exitCode = 1;
});
