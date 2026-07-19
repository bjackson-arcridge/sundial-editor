import * as assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as path from 'node:path';
import { describe, test } from 'node:test';

describe('CLI package manifest', () => {
	test('defines the public executable package contract', async () => {
		const manifest = JSON.parse(await readFile(path.resolve(__dirname, '../../package.json'), 'utf8'));
		assert.equal(manifest.name, '@arcridge/sundial-editor-cli');
		assert.equal(manifest.version, '0.1.1');
		assert.equal(manifest.engines.node, '>=20');
		assert.equal(manifest.bin['sundial-editor-cli'], 'dist/main.js');
		assert.equal(manifest.publishConfig.access, 'public');
		assert.deepEqual(manifest.files, ['dist', 'README.md', 'LICENSE']);
		assert.equal(manifest.repository.directory, 'packages/cli');
		assert.match(manifest.scripts.prepack, /compile/);
		assert.match(manifest.scripts['test:integration'], /out\/integration/);
		assert.match(manifest.scripts.test, /test:integration/);

		const rootManifest = JSON.parse(await readFile(path.resolve(__dirname, '../../../../package.json'), 'utf8'));
		assert.match(rootManifest.scripts.cli, /packages\/cli/);
		assert.match(rootManifest.scripts['pack:cli'], /npm pack/);
		assert.equal(rootManifest.scripts['install:cli:local'], './scripts/install-cli-local.sh');
		assert.match(rootManifest.scripts['publish:cli'], /npm publish/);

		const installScript = await readFile(path.resolve(__dirname, '../../../../scripts/install-cli-local.sh'), 'utf8');
		assert.match(installScript, /npm pack --workspace packages\/cli/);
		assert.match(installScript, /npm install --global/);
	});
});
