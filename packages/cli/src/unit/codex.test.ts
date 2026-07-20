import * as assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, test } from 'node:test';
import { createCodexAdapter } from '../adapters/codex';
import type { ProviderHealth } from '../adapters/adapter';

const fixturePath = path.resolve(__dirname, '../../src/integration/fixtures/fake-codex-app-server.js');
const resolvedExecutable = '/test/path/codex';

describe('Codex adapter health', () => {
	test('accepts the minimum, current, prerelease, and newer compatible versions after probing behavior', async () => {
		for (const version of ['0.131.0', '0.144.6', '0.145.0-alpha.18', '0.200.0']) {
			await withHealth(version, async health => {
				assert.equal(health.available, true, version);
				assert.equal(health.compatible, true, version);
				assert.equal(health.version, version);
				assert.equal(health.executablePath, resolvedExecutable);
				assert.match(health.message ?? '', /passed Sundial app-server capability checks/);
			});
		}
	});

	test('rejects versions below the documented minimum without probing app-server', async () => {
		let started = false;
		const health = await createCodexAdapter({
			resolveExecutable: async () => resolvedExecutable,
			runVersion: async () => 'codex-cli 0.130.99',
			startAppServer: () => { started = true; throw new Error('must not start'); },
		}).health();
		assert.equal(health.compatible, false);
		assert.equal(health.version, '0.130.99');
		assert.equal(health.executablePath, resolvedExecutable);
		assert.match(health.message ?? '', /requires Codex 0\.131\.0 or newer/);
		assert.equal(started, false);
	});

	test('reports malformed versions and PATH resolution failures with actionable diagnostics', async () => {
		const malformed = await createCodexAdapter({
			resolveExecutable: async () => resolvedExecutable,
			runVersion: async () => 'unexpected version output',
			startAppServer: () => { throw new Error('unused'); },
		}).health();
		assert.equal(malformed.compatible, false);
		assert.equal(malformed.executablePath, resolvedExecutable);
		assert.match(malformed.message ?? '', /\/test\/path\/codex.*unrecognized version.*unexpected version output/);

		const missing = await createCodexAdapter({
			resolveExecutable: async () => { throw Object.assign(new Error('missing'), { code: 'ENOENT' }); },
			runVersion: async () => { throw new Error('unused'); },
			startAppServer: () => { throw new Error('unused'); },
		}).health();
		assert.deepEqual(missing, {
			provider: 'codex',
			available: false,
			compatible: false,
			message: 'Codex executable was not found on the PATH used by Sundial Editor CLI.',
		});
	});
});

async function withHealth(
	version: string,
	run: (health: ProviderHealth) => Promise<void>,
): Promise<void> {
	const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'sundial-codex-health-'));
	const adapter = createCodexAdapter({
		resolveExecutable: async () => resolvedExecutable,
		runVersion: async executablePath => {
			assert.equal(executablePath, resolvedExecutable);
			return `codex-cli ${version}`;
		},
		startAppServer: () => spawn(process.execPath, [fixturePath], {
			cwd: tempDirectory,
			stdio: ['pipe', 'pipe', 'pipe'],
			env: { ...process.env, SUNDIAL_CODEX_STATE: path.join(tempDirectory, 'state.txt') },
		}),
	});
	try {
		await run(await adapter.health());
	} finally {
		await rm(tempDirectory, { recursive: true, force: true });
	}
}
