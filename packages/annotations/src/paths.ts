import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isSafeRelativeFile } from './index.js';

export function companionPathForSource(workspaceCwd: string, sourceUri: string): string {
	return companionPathForFile(workspaceCwd, sourceFileForUri(workspaceCwd, sourceUri));
}

export function companionPathForFile(workspaceCwd: string, sourceFile: string): string {
	return workspacePath(workspaceCwd, companionRelativePathForSourceFile(sourceFile), 'annotation companion');
}

export function companionRelativePathForSourceFile(sourceFile: string): string {
	return `.sundial/${normalizeRelativeSourceFile(sourceFile, 'source file')}.comments`;
}

export function sourceFileForUri(workspaceCwd: string, sourceUri: string): string {
	if (!path.isAbsolute(workspaceCwd)) { throw new Error('workspace.cwd must be an absolute path'); }
	let sourcePath: string;
	try {
		const uri = new URL(sourceUri);
		if (uri.protocol !== 'file:') { throw new Error('source URI must use the file scheme'); }
		sourcePath = fileURLToPath(uri);
	} catch (error) {
		throw new Error(error instanceof Error && error.message === 'source URI must use the file scheme'
			? error.message : 'document.uri must be a valid file URI');
	}
	return sourceFileForPath(workspaceCwd, sourcePath, 'document.uri');
}

export function sourceUriForFile(workspaceCwd: string, file: string): string {
	const normalized = normalizeRelativeSourceFile(file, 'annotation link file');
	return pathToFileURL(path.join(path.resolve(workspaceCwd), ...normalized.split('/'))).toString();
}

export function sourceFileForCompanion(cwd: string, companionPath: string): string {
	const root = path.join(path.resolve(cwd), '.sundial');
	const relative = path.relative(root, path.resolve(companionPath));
	if (relative === '' || path.isAbsolute(relative) || relative === '..' || relative.startsWith(`..${path.sep}`)
		|| !relative.endsWith('.comments')) {
		throw new Error('Invalid companion path.');
	}
	return normalizeRelativeSourceFile(relative.slice(0, -'.comments'.length).split(path.sep).join('/'), 'companion source');
}

export function sourcePathForCompanion(cwd: string, companionPath: string): string {
	return path.join(path.resolve(cwd), ...sourceFileForCompanion(cwd, companionPath).split('/'));
}

export function workspaceRelativePath(cwd: string, file: string): string {
	const relative = path.relative(path.resolve(cwd), path.resolve(file));
	return normalizeWorkspaceRelativePath(relative.split(path.sep).join('/'), 'workspace file');
}

export function workspacePath(cwd: string, relative: string, description = 'workspace path'): string {
	if (!path.isAbsolute(cwd)) { throw new Error('workspace.cwd must be an absolute path'); }
	const normalized = normalizeWorkspaceRelativePath(relative, description);
	const result = path.resolve(cwd, ...normalized.split('/'));
	const fromWorkspace = path.relative(path.resolve(cwd), result);
	if (fromWorkspace === '' || fromWorkspace.startsWith(`..${path.sep}`) || path.isAbsolute(fromWorkspace)) {
		throw new Error(`${description} must identify a file inside workspace.cwd`);
	}
	return result;
}

export function normalizeRelativeSourceFile(value: string, description: string): string {
	const normalized = normalizeWorkspaceRelativePath(value, description);
	if (normalized === '.sundial' || normalized.startsWith('.sundial/')) {
		throw new Error(`${description} must not identify .sundial`);
	}
	return normalized;
}

export function normalizeWorkspaceRelativePath(value: string, description: string): string {
	const normalized = value.replaceAll('\\', '/');
	if (!isSafeRelativeFile(normalized)) { throw new Error(`${description} must be a safe workspace-relative file`); }
	return normalized;
}

export function isCompanionStorePath(source: string): boolean {
	const normalized = normalizeWorkspaceRelativePath(source, 'workspace path');
	return normalized === '.sundial' || normalized.startsWith('.sundial/');
}

function sourceFileForPath(cwd: string, file: string, description: string): string {
	const workspace = path.resolve(cwd);
	const relative = path.relative(workspace, path.resolve(file));
	if (relative === '' || path.isAbsolute(relative) || relative === '..' || relative.startsWith(`..${path.sep}`)) {
		throw new Error(`${description} must identify a source file inside workspace.cwd`);
	}
	return normalizeRelativeSourceFile(relative.split(path.sep).join('/'), description);
}
