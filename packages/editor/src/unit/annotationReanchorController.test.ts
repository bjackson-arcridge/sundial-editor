import * as assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { AnnotationReanchorController, sourceDigest, type SavedAnnotationSource } from '../annotationReanchorController';

const commit = 'a'.repeat(40);
const source: SavedAnnotationSource = { cwd: '/workspace', sourceUri: 'file:///workspace/source.ts', text: 'old\n' };

function companion(text: string) {
	return {
		version: 5 as const, sourceDigest: sourceDigest(text), annotations: [],
		currentPermanentCommit: commit, currentPermanentAnnotationIds: [],
	};
}

async function drain(): Promise<void> {
	await new Promise(resolve => setImmediate(resolve));
}

describe('annotation re-anchor scheduling', () => {
	test('seeds a matching saved baseline without a mutation', async () => {
		let reanchors = 0;
		const controller = new AnnotationReanchorController({
			readAnnotations: async () => companion(source.text),
			reanchor: async () => { reanchors += 1; throw new Error('unexpected'); },
			onApplied: () => undefined,
			reportError: message => assert.fail(message),
		});
		controller.observeSaved(source);
		await drain();
		assert.equal(reanchors, 0);
		controller.dispose();
	});

	test('adopts an unknown baseline and coalesces intermediate saves until the TTL', async () => {
		let now = 0;
		let timer: (() => void) | undefined;
		const requests: { previous: string; current: string }[] = [];
		const controller = new AnnotationReanchorController({
			readAnnotations: async () => companion('different\n'),
			reanchor: async (current, previous) => {
				requests.push({ previous, current: current.text });
				return {
					companion: companion(current.text), changedAnnotationIds: [], fileScopedAnnotationIds: [],
					affectedPaths: [], alreadyApplied: false,
				};
			},
			onApplied: () => undefined,
			reportError: message => assert.fail(message),
			now: () => now,
			setTimer: callback => { timer = callback; return 1 as unknown as ReturnType<typeof setTimeout>; },
			clearTimer: () => { timer = undefined; },
		});
		controller.observeSaved(source);
		await drain();
		assert.deepEqual(requests, [{ previous: 'old\n', current: 'old\n' }]);

		controller.observeSaved({ ...source, text: 'middle\n' });
		controller.observeSaved({ ...source, text: 'newest\n' });
		assert.equal(requests.length, 1);
		now = 30_000;
		timer?.();
		await drain();
		assert.deepEqual(requests[1], { previous: 'old\n', current: 'newest\n' });
		controller.dispose();
	});
});
