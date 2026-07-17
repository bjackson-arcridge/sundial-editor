import * as assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { agentsViewOpenedStateKey, revealAgentsViewOnFirstActivation } from '../firstRun';

describe('first activation agents view', () => {
	test('reveals the view and records success on first activation', async () => {
		const values = new Map<string, unknown>();
		let revealCount = 0;

		const didReveal = await revealAgentsViewOnFirstActivation({
			state: {
				get: <T>(key: string) => values.get(key) as T | undefined,
				update: async (key, value) => {
					values.set(key, value);
				},
			},
			revealAgentsView: async () => {
				revealCount += 1;
			},
		});

		assert.equal(didReveal, true);
		assert.equal(revealCount, 1);
		assert.equal(values.get(agentsViewOpenedStateKey), true);
	});

	test('does not take focus after the first successful activation', async () => {
		let revealCount = 0;
		const didReveal = await revealAgentsViewOnFirstActivation({
			state: {
				get: <T>() => true as T,
				update: async () => undefined,
			},
			revealAgentsView: async () => {
				revealCount += 1;
			},
		});

		assert.equal(didReveal, false);
		assert.equal(revealCount, 0);
	});

	test('does not record completion when revealing fails', async () => {
		let updateCount = 0;
		await assert.rejects(revealAgentsViewOnFirstActivation({
			state: {
				get: () => undefined,
				update: async () => {
					updateCount += 1;
				},
			},
			revealAgentsView: async () => {
				throw new Error('cannot reveal');
			},
		}), /cannot reveal/);

		assert.equal(updateCount, 0);
	});
});
