import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import {
	emptyAnnotationCompanion,
	parseAnnotationCompanionText,
	renderAnnotationCompanion,
	type AnnotationCompanion,
} from './index.js';
import { sourceFileForCompanion } from './paths.js';

export interface CompanionFileFound {
	readonly kind: 'found';
	readonly companion: AnnotationCompanion;
}

export interface CompanionFileMissing {
	readonly kind: 'missing';
}

export type CompanionFileReadResult = CompanionFileFound | CompanionFileMissing;

export interface WorkspaceCompanion {
	readonly file: string;
	readonly companion: AnnotationCompanion;
}

export interface CompanionWriteTarget {
	readonly recordPath: string;
	readonly outputPath?: string;
}

export interface CompanionWorkingSetServices {
	readonly read: (file: string) => Promise<CompanionFileReadResult>;
	readonly write: (file: string, companion: AnnotationCompanion) => Promise<void>;
}

export interface CompanionLockServices {
	readonly sleep: (milliseconds: number) => Promise<void>;
	readonly lockTimeoutMs: number;
	readonly staleLockMs: number;
}

const defaultWorkingSetServices: CompanionWorkingSetServices = {
	read: readCompanionFile,
	write: writeCompanionFile,
};

const defaultLockServices: CompanionLockServices = {
	sleep: milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)),
	lockTimeoutMs: 5_000,
	staleLockMs: 30_000,
};

export class CompanionWorkingSet {
	private readonly records = new Map<string, CompanionFileReadResult | Promise<CompanionFileReadResult>>();
	private readonly dirty = new Set<string>();
	private readonly services: CompanionWorkingSetServices;

	constructor(serviceOverrides: Partial<CompanionWorkingSetServices> = {}) {
		this.services = { ...defaultWorkingSetServices, ...serviceOverrides };
	}

	async load(file: string): Promise<CompanionFileReadResult> {
		const key = absolutePath(file);
		const existing = this.records.get(key);
		if (existing !== undefined) { return await existing; }
		const pending = this.services.read(key);
		this.records.set(key, pending);
		try {
			const loaded = await pending;
			this.records.set(key, loaded);
			return loaded;
		} catch (error) {
			this.records.delete(key);
			throw error;
		}
	}

	async readOrEmpty(file: string, missingSourceDigest: string): Promise<AnnotationCompanion> {
		const loaded = await this.load(file);
		return loaded.kind === 'found' ? loaded.companion : emptyAnnotationCompanion(missingSourceDigest);
	}

	async require(file: string, missingMessage?: string): Promise<AnnotationCompanion> {
		const key = absolutePath(file);
		const loaded = await this.load(key);
		if (loaded.kind === 'missing') { throw new Error(missingMessage ?? `Annotation companion is missing: ${key}`); }
		return loaded.companion;
	}

	stage(file: string, companion: AnnotationCompanion): void {
		const key = absolutePath(file);
		this.records.set(key, { kind: 'found', companion });
		this.dirty.add(key);
	}

	get(file: string): AnnotationCompanion {
		const key = absolutePath(file);
		const loaded = this.records.get(key);
		if (loaded === undefined || loaded instanceof Promise || loaded.kind === 'missing') {
			throw new Error(`Annotation companion is not loaded: ${key}`);
		}
		return loaded.companion;
	}

	changedPaths(): readonly string[] {
		return [...this.dirty];
	}

	validate(paths: readonly string[] = this.changedPaths()): void {
		for (const file of paths) { renderAnnotationCompanion(this.get(file)); }
	}

	async write(targets: readonly (string | CompanionWriteTarget)[] = this.changedPaths()): Promise<void> {
		const normalized = targets.map(target => typeof target === 'string'
			? { recordPath: absolutePath(target), outputPath: absolutePath(target) }
			: { recordPath: absolutePath(target.recordPath), outputPath: absolutePath(target.outputPath ?? target.recordPath) });
		const outputs = normalized.map(target => target.outputPath);
		if (new Set(outputs).size !== outputs.length) { throw new Error('Companion write targets must be unique.'); }
		const prepared = normalized.map(target => {
			if (!this.dirty.has(target.recordPath)) { throw new Error(`Annotation companion has no staged change: ${target.recordPath}`); }
			return { ...target, companion: this.get(target.recordPath) };
		});
		this.validate(prepared.map(target => target.recordPath));
		for (const target of prepared) {
			await this.services.write(target.outputPath, target.companion);
			this.dirty.delete(target.recordPath);
		}
	}
}

export async function readCompanionFile(file: string): Promise<CompanionFileReadResult> {
	try {
		return { kind: 'found', companion: parseAnnotationCompanionText(await readStableUtf8(file, 'annotation companion')) };
	} catch (error) {
		if (nodeCode(error) === 'ENOENT') { return { kind: 'missing' }; }
		throw error;
	}
}

export async function listWorkspaceCompanions(cwd: string): Promise<readonly WorkspaceCompanion[]> {
	if (!path.isAbsolute(cwd)) { throw new Error('workspace.cwd must be an absolute path'); }
	const storeRoot = path.join(path.resolve(cwd), '.sundial');
	let rootStat;
	try { rootStat = await lstat(storeRoot); }
	catch (error) {
		if (nodeCode(error) === 'ENOENT') { return []; }
		throw error;
	}
	if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
		throw new Error('Annotation companion store must be a directory.');
	}
	const companionPaths: string[] = [];
	await collectCompanionPaths(storeRoot, storeRoot, companionPaths);
	const result: WorkspaceCompanion[] = [];
	for (const companionPath of companionPaths) {
		const file = sourceFileForCompanion(cwd, companionPath);
		try {
			const loaded = await readCompanionFile(companionPath);
			if (loaded.kind === 'found') { result.push({ file, companion: loaded.companion }); }
		} catch (error) {
			throw new Error(`Invalid annotation companion ${path.relative(cwd, companionPath).split(path.sep).join('/')}: ${errorMessage(error)}`);
		}
	}
	return result.sort((left, right) => compareText(left.file, right.file));
}

export async function writeCompanionFile(companionPath: string, companion: AnnotationCompanion): Promise<void> {
	const rendered = renderAnnotationCompanion(companion);
	await mkdir(path.dirname(companionPath), { recursive: true });
	const temporaryPath = `${companionPath}.tmp-${process.pid}-${randomUUID()}`;
	try {
		await writeFile(temporaryPath, rendered, { encoding: 'utf8', flag: 'wx' });
		await rename(temporaryPath, companionPath);
	} finally {
		await rm(temporaryPath, { force: true });
	}
}

export async function readStableUtf8(file: string, description: string): Promise<string> {
	const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
	try {
		const before = await handle.stat({ bigint: true });
		if (!before.isFile()) { throw new Error(`The ${description} path must identify a regular file.`); }
		const bytes = await handle.readFile();
		const after = await handle.stat({ bigint: true });
		if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size
			|| before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs) {
			throw new Error(`The ${description} file changed while it was being read.`);
		}
		try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
		catch { throw new Error(`The ${description} file must contain valid UTF-8.`); }
	} finally {
		await handle.close();
	}
}

export async function withCompanionLock<T>(
	cwd: string,
	operation: () => Promise<T>,
	serviceOverrides: Partial<CompanionLockServices> = {},
): Promise<T> {
	const services = { ...defaultLockServices, ...serviceOverrides };
	const root = path.join(path.resolve(cwd), '.sundial');
	const lock = path.join(root, '.annotations.lock');
	await mkdir(root, { recursive: true });
	const started = Date.now();
	while (true) {
		try { await mkdir(lock); break; }
		catch (error) {
			if (nodeCode(error) !== 'EEXIST') { throw error; }
			try {
				if (Date.now() - (await stat(lock)).mtimeMs > services.staleLockMs) {
					await rm(lock, { recursive: true, force: true });
				}
			} catch { /* retry */ }
			if (Date.now() - started > services.lockTimeoutMs) { throw new Error('Timed out waiting for annotation lock.'); }
			await services.sleep(10);
		}
	}
	try { return await operation(); }
	finally { await rm(lock, { recursive: true, force: true }); }
}

function absolutePath(file: string): string {
	if (!path.isAbsolute(file)) { throw new Error('Annotation companion path must be absolute.'); }
	return path.resolve(file);
}

function nodeCode(error: unknown): string | undefined {
	return error instanceof Error && 'code' in error ? String(error.code) : undefined;
}

async function collectCompanionPaths(root: string, directory: string, output: string[]): Promise<void> {
	const entries = await readdir(directory, { withFileTypes: true });
	for (const entry of entries.sort((left, right) => compareText(left.name, right.name))) {
		if (directory === root && entry.name === 'agents') { continue; }
		const entryPath = path.join(directory, entry.name);
		if (entry.isDirectory()) {
			await collectCompanionPaths(root, entryPath, output);
		} else if (entry.isFile() && entry.name.endsWith('.comments')) {
			output.push(entryPath);
		}
	}
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function compareText(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}
