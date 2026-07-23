import * as assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import * as path from 'node:path';
import { describe, test } from 'node:test';

describe('CLI package manifest', () => {
	test('defines the public executable package contract', async () => {
		const manifest = JSON.parse(await readFile(path.resolve(__dirname, '../../package.json'), 'utf8'));
		assert.equal(manifest.name, '@arcridge/sundial-editor-cli');
		assert.equal(manifest.version, '0.9.1');
		assert.equal(manifest.engines.node, '>=20');
		assert.deepEqual(manifest.bin, {
			'sundial-editor-cli': 'dist/main.js',
			'sundial-agent-tools': 'dist/agent-tools-main.js',
		});
		assert.equal(manifest.publishConfig.access, 'public');
		assert.deepEqual(manifest.files, ['dist', 'README.md', 'LICENSE']);
		assert.equal(manifest.devDependencies['@arcridge/sundial-editor-annotations'], '0.1.0');
		assert.equal(manifest.devDependencies.diff, undefined);
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

		const buildScript = await readFile(path.resolve(__dirname, '../../esbuild.js'), 'utf8');
		assert.match(buildScript, /entryPoints: \['src\/main\.ts'\]/);
		assert.match(buildScript, /entryPoints: \['src\/agent-tools-main\.ts'\]/);
		assert.match(buildScript, /fs\.cpSync\('src\/prompts', 'dist\/prompts'/);
		assert.match(buildScript, /fs\.chmodSync\('dist\/agent-tools-main\.js', 0o755\)/);

		const annotationsAdapter = await readFile(path.resolve(__dirname, '../../src/annotations.ts'), 'utf8');
		const gitWorkflow = await readFile(path.resolve(__dirname, '../../src/gitWorkflow.ts'), 'utf8');
		assert.equal(existsSync(path.resolve(__dirname, '../../src/companionRepair.ts')), false);
		assert.equal(existsSync(path.resolve(__dirname, '../../src/lineDiff.ts')), false);
		assert.match(gitWorkflow, /@arcridge\/sundial-editor-annotations\/repair/);
		assert.doesNotMatch(annotationsAdapter, /diffArrays|survivingLineMap|translateLine/);

		const promptAssets = [
			'assignment.md',
			'shared.md',
			'presets/cleanup.md',
			'presets/fix.md',
			'presets/question.md',
			'presets/refactor.md',
			'presets/test.md',
			'presets/write.md',
			'scopes/local.md',
			'scopes/project.md',
		];
		for (const asset of promptAssets) {
			assert.notEqual(
				(await readFile(path.resolve(__dirname, '../../src/prompts', asset), 'utf8')).trim(),
				'',
				`${asset} must be a non-empty published prompt asset`,
			);
		}
	});
});
