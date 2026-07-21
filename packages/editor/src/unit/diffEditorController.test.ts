import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, test } from 'node:test';

const source = fs.readFileSync(path.resolve(__dirname, '../../src/diffEditorController.ts'), 'utf8');
const extensionSource = fs.readFileSync(path.resolve(__dirname, '../../src/extension.ts'), 'utf8');

describe('global diff editor controller', () => {
	test('uses managed built-in diff tabs and restores source tabs in their groups', () => {
		assert.match(source, /vscode\.commands\.executeCommand\('vscode\.diff'/);
		assert.match(source, /await this\.restoreVisualState\(snapshot\)/);
		assert.match(source, /revealLine \+ expectedLine - actualLine/);
		assert.match(source, /viewColumn: snapshot\.viewColumn/);
		assert.match(source, /vscode\.window\.showTextDocument\(snapshot\.source/);
		assert.match(source, /vscode\.window\.tabGroups\.close\(current, true\)/);
	});

	test('restores relative tab, split, selection, and focus state after each replacement', () => {
		assert.match(source, /tabInput: tab\.input,[\s\S]*?tabIndex,[\s\S]*?activeInGroup:[\s\S]*?pinned: tab\.isPinned/);
		assert.match(source, /if \(openedIndex !== snapshot\.tabIndex\)/);
		assert.match(source, /to: 'position', by: 'tab', value: snapshot\.tabIndex \+ 1/);
		assert.match(source, /snapshot\.preview && !replacement\.isPreview/);
		assert.match(source, /workbench\.action\.pinEditor/);
		assert.match(source, /workbench\.action\.unpinEditor/);
		assert.match(source, /rotateTabsAroundPreview\(snapshot, openedIndex, isReplacement\)/);
		assert.match(source, /replacement\.isPreview/);
		assert.match(source, /private editorGroupSnapshots\(\): EditorGroupSnapshot\[\]/);
		assert.match(source, /workbench\.action\.openEditorAtIndex/);
		assert.match(source, /restoreActiveEditorGroup\(globallyActiveGroup\)/);
		assert.match(source, /restoreEditorGroupState\(groups, snapshots/);
		assert.match(source, /restoreDiffSide\(activeSnapshot\)/);
		assert.match(source, /dispatchEditorCommand\(command\)/);
		assert.doesNotMatch(source, /vscode\.setEditorLayout|layoutEditorGroups/);
	});

	test('reconciles new source tabs and baseline changes without claiming unrelated diffs', () => {
		assert.match(source, /vscode\.window\.tabGroups\.onDidChangeTabs/);
		assert.match(source, /managed\.baseline !== this\.state\?\.workflow\.baseline/);
		assert.match(source, /record\[managedQueryFlag\] === true/);
		assert.match(source, /input\.original\.scheme !== 'git' && input\.original\.scheme !== emptyRevisionScheme/);
		assert.match(source, /registerTextDocumentContentProvider\(emptyRevisionScheme/);
		assert.match(source, /provideTextDocumentContent: \(\) => ''/);
		assert.match(source, /this\.isUntrackedSource\(snapshot\.source\)[\s\S]*?emptyRevisionUri\(snapshot\.source, baseline\)/);
		assert.match(source, /workflow\.untrackedPaths\.includes/);
		assert.match(source, /const baseline = typeof record\.baseline === 'string' \? record\.baseline : record\.ref/);
		assert.doesNotMatch(source, /isUntrackedSource\(snapshot\.source\) \? '~'/);
	});

	test('toggles the workspace-wide inline setting', () => {
		assert.match(source, /getConfiguration\('diffEditor'\)/);
		assert.match(source, /configuration\.update\('renderSideBySide', !renderSideBySide, vscode\.ConfigurationTarget\.Workspace\)/);
	});

	test('returns VSCodeVim to Normal mode after switching inline presentation', () => {
		assert.match(extensionSource, /const inline = await diffController\.toggleInline\(\);\s*await returnToVimNormalMode\(\);/);
		assert.match(extensionSource, /async function returnToVimNormalMode\(\): Promise<void> \{[\s\S]*?returnToVSCodeVimNormalMode/);
	});
});
