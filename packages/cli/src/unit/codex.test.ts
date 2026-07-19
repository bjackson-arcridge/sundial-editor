import * as assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { createCodexAdapter } from '../adapters/codex';

describe('Codex adapter health', () => {
	test('accepts the regenerated 0.131 protocol family', async () => {
		const health = await createCodexAdapter({
			runVersion: async () => 'codex-cli 0.131.7',
			startAppServer: () => { throw new Error('unused'); },
		}).health();
		assert.deepEqual(health, { provider: 'codex', available: true, compatible: true, version: '0.131.7' });
	});

	test('reports unsupported and missing Codex versions cleanly', async () => {
		const unsupported = await createCodexAdapter({
			runVersion: async () => 'codex-cli 0.132.0',
			startAppServer: () => { throw new Error('unused'); },
		}).health();
		assert.equal(unsupported.compatible, false);
		assert.match(unsupported.message ?? '', /supports Codex 0\.131\.x/);

		const missing = await createCodexAdapter({
			runVersion: async () => { throw Object.assign(new Error('spawn codex ENOENT'), { code: 'ENOENT' }); },
			startAppServer: () => { throw new Error('unused'); },
		}).health();
		assert.deepEqual(missing, {
			provider: 'codex', available: false, compatible: false, message: 'Codex was not found on PATH.',
		});
	});
});
