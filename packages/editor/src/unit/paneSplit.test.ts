import * as assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
	defaultPaneSplitPercent,
	maximumPaneSplitPercent,
	minimumPaneSplitPercent,
	paneSplitPercentFromKey,
	paneSplitPercentFromPointer,
} from '../paneSplit';

describe('agent and annotation pane splitter', () => {
	test('defaults to an equal vertical split', () => {
		assert.equal(defaultPaneSplitPercent, 50);
	});

	test('maps pointer movement to the usable height and clamps both panes', () => {
		assert.equal(paneSplitPercentFromPointer(504, 0, 1008, 8), 50);
		assert.equal(paneSplitPercentFromPointer(-100, 0, 1008, 8), minimumPaneSplitPercent);
		assert.equal(paneSplitPercentFromPointer(1200, 0, 1008, 8), maximumPaneSplitPercent);
		assert.equal(paneSplitPercentFromPointer(10, 0, 8, 8), defaultPaneSplitPercent);
	});

	test('supports fine and coarse keyboard resizing', () => {
		assert.equal(paneSplitPercentFromKey(50, 'ArrowUp'), 48);
		assert.equal(paneSplitPercentFromKey(50, 'ArrowDown'), 52);
		assert.equal(paneSplitPercentFromKey(50, 'PageUp'), 40);
		assert.equal(paneSplitPercentFromKey(50, 'PageDown'), 60);
		assert.equal(paneSplitPercentFromKey(50, 'Home'), minimumPaneSplitPercent);
		assert.equal(paneSplitPercentFromKey(50, 'End'), maximumPaneSplitPercent);
		assert.equal(paneSplitPercentFromKey(50, 'Enter'), undefined);
	});
});
