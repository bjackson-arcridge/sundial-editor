import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptsRoot = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptsRoot, '..');

export const vscodeTestVersion = '1.118.1';
export const vscodeTestCachePath = path.join(repositoryRoot, '.vscode-test');

export const vscodeTestPlatform = resolvePlatform();
export const vscodeTestDownloadPath = path.join(
	vscodeTestCachePath,
	`vscode-${vscodeTestPlatform}-${vscodeTestVersion}`,
);
export const vscodeTestExecutablePath = resolveExecutablePath();

function resolvePlatform() {
	if (process.platform === 'darwin') {
		return process.arch === 'arm64' ? 'darwin-arm64' : 'darwin';
	}

	if (process.platform === 'win32') {
		return process.arch === 'arm64' ? 'win32-arm64-archive' : 'win32-x64-archive';
	}

	if (process.arch === 'arm64') {
		return 'linux-arm64';
	}

	if (process.arch === 'arm') {
		return 'linux-armhf';
	}

	return 'linux-x64';
}

function resolveExecutablePath() {
	if (process.platform === 'darwin') {
		return path.join(vscodeTestDownloadPath, 'Visual Studio Code.app', 'Contents', 'MacOS', 'Electron');
	}

	if (process.platform === 'win32') {
		return path.join(vscodeTestDownloadPath, 'Code.exe');
	}

	return path.join(vscodeTestDownloadPath, 'code');
}
