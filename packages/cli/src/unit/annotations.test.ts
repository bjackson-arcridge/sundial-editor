import * as assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, test } from 'node:test';
import {
	appendUserAnnotation,
	companionPathForSource,
	deleteUserAnnotation,
	parseAnnotationCompanion,
	readUserAnnotations,
} from '../annotations';

const temporaryDirectories: string[] = [];

afterEach(async () => {
	await Promise.all(temporaryDirectories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
});

async function workspace(): Promise<{ root: string; sourceUri: string }> {
	const root = await mkdtemp(path.join(os.tmpdir(), 'sundial-annotations-'));
	temporaryDirectories.push(root);
	return { root, sourceUri: pathToFileURL(path.join(root, 'src', 'example.ts')).toString() };
}

describe('annotation companions', () => {
	test('maps source paths into the mirrored .sundial tree', async () => {
		const context = await workspace();
		assert.equal(
			companionPathForSource(context.root, context.sourceUri),
			path.join(context.root, '.sundial', 'src', 'example.ts.comments'),
		);
		assert.throws(() => companionPathForSource(context.root, 'untitled:Untitled-1'), /file scheme/);
		assert.throws(() => companionPathForSource(context.root, pathToFileURL(path.join(context.root, '..', 'outside.ts')).toString()), /inside/);
	});

	test('deletes one annotation by stable ID and preserves the remaining companion', async () => {
		const context = await workspace();
		let nextId = 0;
		for (const message of ['First.', 'Second.']) {
			await appendUserAnnotation({
				workspace: { cwd: context.root },
				document: { uri: context.sourceUri, line: nextId, text: `line ${nextId}`, before: [], after: [] },
				annotation: { message, preset: '%Q', scope: 'line' },
			}, { createId: () => `annotation-${++nextId}` });
		}

		const deleted = await deleteUserAnnotation({
			workspace: { cwd: context.root }, document: { uri: context.sourceUri },
			annotation: { id: 'annotation-1' },
		});
		assert.equal(deleted.message, 'First.');
		assert.deepEqual((await readUserAnnotations({
			workspace: { cwd: context.root }, document: { uri: context.sourceUri },
		})).annotations.map(annotation => annotation.id), ['annotation-2']);
		await assert.rejects(() => deleteUserAnnotation({
			workspace: { cwd: context.root }, document: { uri: context.sourceUri },
			annotation: { id: 'missing' },
		}), /Annotation not found/);
	});

	test('lazily appends and reads stable, versioned YAML annotations', async () => {
		const context = await workspace();
		let nextId = 0;
		const first = await appendUserAnnotation({
			workspace: { cwd: context.root },
			document: {
				uri: context.sourceUri, line: 4, text: 'const value = 1;',
				before: ['import value from "value";', 'function calculate() {'],
				after: ['return value;', '}'],
			},
			annotation: { message: 'Fix "this".\nPlease.', preset: '%F', scope: 'line' },
		}, { createId: () => `annotation-${++nextId}` });
		await appendUserAnnotation({
			workspace: { cwd: context.root },
			document: {
				uri: context.sourceUri, line: 4, text: 'const value = 1;',
				before: ['function calculate() {'], after: ['return value;', '}'],
			},
			annotation: { message: 'Add a test.', preset: '%T', scope: 'project' },
		}, { createId: () => `annotation-${++nextId}` });

		assert.equal(first.id, 'annotation-1');
		const companionPath = companionPathForSource(context.root, context.sourceUri);
		const yaml = await readFile(companionPath, 'utf8');
		assert.match(yaml, /^version: 1\nannotations:\n/);
		assert.doesNotMatch(yaml, /^\{/);
		const loaded = await readUserAnnotations({ workspace: { cwd: context.root }, document: { uri: context.sourceUri } });
		assert.deepEqual(loaded.annotations.map(annotation => ({ id: annotation.id, line: annotation.anchor.line })), [
			{ id: 'annotation-1', line: 4 },
			{ id: 'annotation-2', line: 4 },
		]);
		assert.equal(loaded.annotations[0].message, 'Fix "this".\nPlease.');
		assert.deepEqual(loaded.annotations[0].anchor.before, ['import value from "value";', 'function calculate() {']);
		assert.deepEqual(loaded.annotations[0].anchor.after, ['return value;', '}']);
	});

	test('returns an empty collection for a source without a companion', async () => {
		const context = await workspace();
		assert.deepEqual(
			await readUserAnnotations({ workspace: { cwd: context.root }, document: { uri: context.sourceUri } }),
			{ version: 1, annotations: [] },
		);
	});

	test('rejects malformed companions without changing them', async () => {
		const context = await workspace();
		const companionPath = companionPathForSource(context.root, context.sourceUri);
		await mkdir(path.dirname(companionPath), { recursive: true });
		await writeFile(companionPath, 'version: 1\nannotations:\n  - broken\n', { encoding: 'utf8', flag: 'wx' });
		const before = await readFile(companionPath, 'utf8');
		await assert.rejects(() => appendUserAnnotation({
			workspace: { cwd: context.root },
			document: { uri: context.sourceUri, line: 0, text: 'code', before: [], after: [] },
			annotation: { message: 'Do it.', preset: '%W', scope: 'line' },
		}), /Invalid annotation companion/);
		assert.equal(await readFile(companionPath, 'utf8'), before);
		assert.throws(() => parseAnnotationCompanion('version: 2\nannotations:\n'), /version 1/);
	});

	test('reads older version-1 entries without context arrays', () => {
		const companion = parseAnnotationCompanion([
			'version: 1',
			'annotations:',
			'  - id: "legacy"',
			'    message: "Existing annotation."',
			'    preset: "%Q"',
			'    scope: "line"',
			'    anchor:',
			'      line: 2',
			'      text: "const value = 1;"',
			'',
		].join('\n'));
		assert.deepEqual(companion.annotations[0].anchor, {
			line: 2, text: 'const value = 1;', before: [], after: [],
		});
	});
});
