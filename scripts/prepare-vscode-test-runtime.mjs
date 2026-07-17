#!/usr/bin/env node
import { execFile } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { promisify } from 'node:util';

import { downloadAndUnzipVSCode } from '@vscode/test-electron';

import {
	vscodeTestCachePath,
	vscodeTestDownloadPath,
	vscodeTestExecutablePath,
	vscodeTestVersion,
} from './vscode-test-runtime.mjs';

const execFileAsync = promisify(execFile);
const preparedMarker = '.sundial-runtime-prepared.json';

async function main() {
	if (process.platform !== 'darwin') {
		if (await exists(vscodeTestDownloadPath) && !await exists(vscodeTestExecutablePath)) {
			await fs.rm(vscodeTestDownloadPath, { recursive: true, force: true });
		}

		const executablePath = await downloadRuntime();
		if (!await exists(executablePath)) {
			throw new Error(`Prepared VS Code test runtime is missing its executable: ${executablePath}`);
		}
		return;
	}

	const appPath = macAppPath(vscodeTestExecutablePath);
	if (await exists(vscodeTestDownloadPath)) {
		if (await exists(appPath) && await verifies(appPath)) {
			console.log(`[prepare-vscode-test-runtime] verified cached VS Code ${vscodeTestVersion}`);
			return;
		}

		// Never bless an unknown or modified cache. The official downloader validates
		// the archive checksum, so replace the cache before applying a local signature.
		await fs.rm(vscodeTestDownloadPath, { recursive: true, force: true });
	}

	const executablePath = await downloadRuntime();
	const downloadedAppPath = macAppPath(executablePath);
	let signature = 'vendor';
	if (!await verifies(downloadedAppPath)) {
		await execFileAsync('codesign', ['--force', '--deep', '--sign', '-', downloadedAppPath]);
		signature = 'adhoc';
	}

	if (!await verifies(downloadedAppPath)) {
		throw new Error(`Prepared VS Code test runtime still fails signature verification: ${downloadedAppPath}`);
	}

	await fs.writeFile(
		path.join(vscodeTestDownloadPath, preparedMarker),
		`${JSON.stringify({ version: vscodeTestVersion, signature })}\n`,
	);
	console.log(`[prepare-vscode-test-runtime] prepared VS Code ${vscodeTestVersion} for macOS`);
}

async function downloadRuntime() {
	const executablePath = await downloadAndUnzipVSCode({
		version: vscodeTestVersion,
		cachePath: vscodeTestCachePath,
	});
	if (path.resolve(executablePath) !== path.resolve(vscodeTestExecutablePath)) {
		throw new Error(`VS Code downloader returned an unexpected executable path: ${executablePath}`);
	}

	return executablePath;
}

function macAppPath(executablePath) {
	return path.resolve(executablePath, '../../..');
}

async function verifies(appPath) {
	try {
		await execFileAsync('codesign', ['--verify', '--deep', '--strict', appPath]);
		return true;
	} catch {
		return false;
	}
}

async function exists(target) {
	try {
		await fs.access(target);
		return true;
	} catch {
		return false;
	}
}

main().catch(error => {
	console.error('[prepare-vscode-test-runtime] failed:', error);
	process.exitCode = 1;
});
