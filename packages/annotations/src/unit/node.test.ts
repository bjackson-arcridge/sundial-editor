import * as assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, test } from 'node:test';
import { type AnnotationCompanion } from '../index';
import {
	companionPathForFile,
	companionRelativePathForSourceFile,
	workspaceRelativePath,
} from '../paths';
import {
	CompanionWorkingSet,
	readCompanionFile,
	writeCompanionFile,
} from '../store';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

function empty(digest = 'a'.repeat(64)): AnnotationCompanion {
	return { version: 5, sourceDigest: digest, annotations: [] };
}

describe('shared companion file access', () => {
	test('maps source and companion paths consistently', async () => {
		const root = await mkdtemp(path.join(os.tmpdir(), 'sundial-shared-paths-'));
		roots.push(root);
		assert.equal(companionRelativePathForSourceFile('src/example.ts'), '.sundial/src/example.ts.comments');
		assert.equal(workspaceRelativePath(root, companionPathForFile(root, 'src/example.ts')), '.sundial/src/example.ts.comments');
		assert.throws(() => companionRelativePathForSourceFile('../outside.ts'), /safe workspace-relative/);
	});

	test('round-trips atomic writes and reports an absent companion explicitly', async () => {
		const root = await mkdtemp(path.join(os.tmpdir(), 'sundial-shared-files-'));
		roots.push(root);
		const file = companionPathForFile(root, 'src/example.ts');
		assert.deepEqual(await readCompanionFile(file), { kind: 'missing' });
		await writeCompanionFile(file, empty());
		assert.deepEqual(await readCompanionFile(file), { kind: 'found', companion: empty() });
	});

	test('caches one read per operation and exposes staged values', async () => {
		const file = path.resolve('/workspace/source.ts.comments');
		let reads = 0;
		const writes: Array<{ file: string; companion: AnnotationCompanion }> = [];
		const working = new CompanionWorkingSet({
			read: async () => { reads += 1; return { kind: 'found', companion: empty() }; },
			write: async (output, companion) => { writes.push({ file: output, companion }); },
		});
		assert.equal((await working.load(file)).kind, 'found');
		assert.equal((await working.load(file)).kind, 'found');
		assert.equal(reads, 1);
		const next = empty('b'.repeat(64));
		working.stage(file, next);
		assert.equal(working.get(file), next);
		await working.write();
		assert.deepEqual(writes, [{ file, companion: next }]);
	});

	test('validates every staged output before beginning writes', async () => {
		const first = path.resolve('/workspace/first.comments');
		const second = path.resolve('/workspace/second.comments');
		const writes: string[] = [];
		const working = new CompanionWorkingSet({
			read: async () => ({ kind: 'missing' }),
			write: async file => { writes.push(file); },
		});
		working.stage(first, empty());
		working.stage(second, { ...empty(), sourceDigest: 'invalid' } as AnnotationCompanion);
		await assert.rejects(() => working.write(), /Invalid annotation companion/);
		assert.deepEqual(writes, []);
	});
});
