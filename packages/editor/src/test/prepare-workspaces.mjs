#!/usr/bin/env node
import { execFile } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

import { scenarios, userDataRoot, workspacesRoot } from './scenarios.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(here, '..', '..');
const fixturesRoot = path.join(here, 'fixtures');
const localCliPath = path.resolve(packageRoot, '..', 'cli', 'dist', 'main.js');
const execFileAsync = promisify(execFile);

async function main() {
	const removeOptions = { recursive: true, force: true, maxRetries: 5, retryDelay: 100 };
	await fs.rm(workspacesRoot, removeOptions);
	await fs.rm(userDataRoot, removeOptions);
	await fs.mkdir(workspacesRoot, { recursive: true });

	for (const scenario of scenarios) {
		const fixture = path.join(fixturesRoot, scenario.label);
		const target = path.join(workspacesRoot, scenario.label);
		await fs.cp(fixture, target, { recursive: true });
		await fs.mkdir(path.join(target, '.vscode'), { recursive: true });
		await fs.writeFile(path.join(target, '.vscode', 'settings.json'), `${JSON.stringify({
			'sundialEditor.cliPath': localCliPath,
			...scenario.settings,
		}, undefined, '\t')}\n`);
		if (scenario.git !== undefined) {
			await initializeGitFixture(target, scenario.git);
		}
		console.log(`[prepare-workspaces] staged "${scenario.label}" -> ${path.relative(packageRoot, target)}`);
	}
}

async function initializeGitFixture(cwd, fixture) {
	await git(cwd, ['init']);
	await git(cwd, ['config', 'user.email', 'tests@sundial.invalid']);
	await git(cwd, ['config', 'user.name', 'Sundial Tests']);
	await git(cwd, ['add', '.']);
	await git(cwd, ['commit', '-m', 'Initial']);
	for (const commit of fixture.commits) {
		await writeFiles(cwd, commit.files);
		await git(cwd, ['add', '.']);
		await git(cwd, ['commit', '-m', commit.message]);
	}
	await writeFiles(cwd, fixture.workingTree);
}

async function writeFiles(cwd, files) {
	for (const [relativePath, contents] of Object.entries(files)) {
		await fs.writeFile(path.join(cwd, relativePath), contents);
	}
}

async function git(cwd, args) {
	await execFileAsync('git', args, { cwd });
}

main().catch(error => {
	console.error('[prepare-workspaces] failed:', error);
	process.exitCode = 1;
});
