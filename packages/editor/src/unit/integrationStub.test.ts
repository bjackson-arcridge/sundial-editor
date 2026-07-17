import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { createIntegrationStub } from '../integrationStub';

test('creates clearly labelled deterministic editor-integration stub text', () => {
	assert.equal(createIntegrationStub({
		preset: '%F',
		scope: 'line',
		sourceUri: 'file:///workspace/src/example.ts',
		sourceLine: 4,
		sourceText: '%F',
	}), '[Integration stub] Sundial received %F for source line 5.');

	assert.equal(createIntegrationStub({
		preset: '%Q',
		scope: 'project',
		sourceUri: 'file:///workspace/src/example.ts',
		sourceLine: 0,
		sourceText: '%Q @G',
	}), '[Integration stub] Sundial received %Q for project scope.');
});
