import * as assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as path from 'node:path';
import { test } from 'node:test';

test('annotations package exposes contracts, storage, and the complete repair workflow', async () => {
	const manifest = JSON.parse(await readFile(path.resolve(__dirname, '../../package.json'), 'utf8'));
	assert.equal(manifest.name, '@arcridge/sundial-editor-annotations');
	assert.equal(manifest.private, true);
	assert.deepEqual(Object.keys(manifest.exports), ['.', './digest', './paths', './store', './reanchor', './move', './repair']);
	assert.equal(manifest.exports['./store'].default, './dist/store.js');
	assert.equal(manifest.exports['./repair'].default, './dist/repair.js');
	assert.equal(manifest.devDependencies.diff, '9.0.0');
});
