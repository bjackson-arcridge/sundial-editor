import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, test } from 'node:test';

interface ViewContribution {
	readonly id?: unknown;
	readonly name?: unknown;
	readonly type?: unknown;
	readonly icon?: unknown;
}

interface PackageManifest {
	readonly name?: unknown;
	readonly version?: unknown;
	readonly publisher?: unknown;
	readonly activationEvents?: readonly unknown[];
	readonly scripts?: Record<string, unknown>;
	readonly dependencies?: Record<string, unknown>;
	readonly contributes?: {
		readonly commands?: readonly { readonly command?: unknown; readonly title?: unknown }[];
		readonly viewsContainers?: {
			readonly activitybar?: readonly { readonly id?: unknown; readonly icon?: unknown; readonly title?: unknown }[];
			readonly secondarySidebar?: readonly { readonly id?: unknown; readonly icon?: unknown; readonly title?: unknown }[];
		};
		readonly views?: Record<string, readonly ViewContribution[]>;
		readonly configurationDefaults?: Record<string, unknown>;
		readonly menus?: { readonly commandPalette?: readonly { readonly command?: unknown }[] };
	};
}

function readManifest(): PackageManifest {
	return JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../package.json'), 'utf8')) as PackageManifest;
}

describe('Sundial Editor manifest', () => {
	test('is an independent 0.3.0 extension package', () => {
		const manifest = readManifest();
		assert.equal(manifest.name, 'sundial-editor');
		assert.equal(manifest.publisher, 'arcridge');
		assert.equal(manifest.version, '0.3.0');
		assert.equal(Object.hasOwn(manifest, 'extensionDependencies'), false);
		assert.equal(Object.hasOwn(manifest.dependencies ?? {}, '@arcridge/sundial'), false);
		assert.equal(Object.hasOwn(manifest.dependencies ?? {}, 'sundial'), false);
		assert.equal(manifest.scripts?.['package:vsix'], 'vsce package --no-dependencies');
	});

	test('contributes the autosave defaults, command, and Secondary Sidebar Messages webview', () => {
		const manifest = readManifest();
		const commands = manifest.contributes?.commands ?? [];
		const views = manifest.contributes?.views?.sundialEditor ?? [];

		assert.equal(manifest.contributes?.configurationDefaults?.['files.autoSave'], 'afterDelay');
		assert.equal(manifest.contributes?.configurationDefaults?.['files.autoSaveDelay'], 1000);
		assert.equal(commands.some(command => command.command === 'sundialEditor.submitPrompt' && command.title === 'Sundial Editor: Submit Prompt'), true);
		assert.equal(manifest.contributes?.menus?.commandPalette?.some(item => item.command === 'sundialEditor.submitPrompt'), true);
		assert.equal(manifest.activationEvents?.includes('onStartupFinished'), true);
		assert.equal(manifest.activationEvents?.includes('onCommand:sundialEditor.submitPrompt'), true);
		assert.equal(manifest.contributes?.viewsContainers?.secondarySidebar?.some(item => item.id === 'sundialEditor' && item.title === 'Sundial Agents' && typeof item.icon === 'string'), true);
		assert.equal(manifest.contributes?.viewsContainers?.activitybar, undefined);
		assert.deepEqual(views, [{
			id: 'sundialEditor.messages',
			name: 'Messages',
			type: 'webview',
			icon: 'media/sundial.svg',
		}]);
	});

	test('documents default Secondary Sidebar placement and root workspace testing', () => {
		const readme = fs.readFileSync(path.resolve(__dirname, '../../README.md'), 'utf8');
		const rootManifest = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../../package.json'), 'utf8')) as {
			workspaces?: readonly unknown[];
			scripts?: Record<string, unknown>;
		};

		assert.doesNotMatch(readme, /View: Move View/);
		assert.match(readme, /Secondary Side Bar/);
		assert.match(readme, /Sundial Agents/);
		assert.match(readme, /`%F`/);
		assert.match(readme, /\[Integration stub\]/);
		assert.equal(rootManifest.workspaces?.some(workspace => workspace === 'packages/editor' || workspace === 'packages/*'), true);
		assert.equal(rootManifest.scripts?.test, 'npm run test --workspaces --if-present');
	});

	test('reveals Sundial Agents once through the startup activation path', () => {
		const manifest = readManifest();
		const source = fs.readFileSync(path.resolve(__dirname, '../../src/extension.ts'), 'utf8');

		assert.equal(manifest.activationEvents?.includes('onStartupFinished'), true);
		assert.match(source, /revealAgentsViewOnFirstActivation/);
		assert.match(source, /workbench\.view\.extension\.\$\{agentsViewContainerId\}/);
		assert.match(source, /\$\{messagesViewId\}\.focus/);
	});

	test('registers percent-triggered command completions that submit after insertion', () => {
		const source = fs.readFileSync(path.resolve(__dirname, '../../src/promptCompletionProvider.ts'), 'utf8');

		assert.match(source, /registerCompletionItemProvider/);
		assert.match(source, /promptCommandPrefix/);
		assert.match(source, /command: submitPromptCommandId/);
		assert.match(source, /editor\.action\.inlineSuggest\.hide/);
	});

	test('returns to the originating editor after a Messages submission', () => {
		const extensionSource = fs.readFileSync(path.resolve(__dirname, '../../src/extension.ts'), 'utf8');
		const providerSource = fs.readFileSync(path.resolve(__dirname, '../../src/webviews/messages/messagesWebviewProvider.ts'), 'utf8');

		assert.match(providerSource, /case 'submit':\s*void this\.acknowledgePendingSubmission\(\)/);
		assert.match(providerSource, /await this\.services\.returnToSource\(prompt\)/);
		assert.match(extensionSource, /showTextDocument\(vscode\.Uri\.parse\(prompt\.sourceUri\), \{ preserveFocus: false \}\)/);
		assert.match(extensionSource, /returnToVSCodeVimNormalMode/);
	});

	test('uses the shared project-managed VS Code test runtime', () => {
		const manifest = readManifest();
		const config = fs.readFileSync(path.resolve(__dirname, '../../.vscode-test.mjs'), 'utf8');

		assert.equal(manifest.scripts?.['prepare-test-runtime'], 'node ../../scripts/prepare-vscode-test-runtime.mjs');
		assert.match(String(manifest.scripts?.pretest), /npm run prepare-test-runtime/);
		assert.match(config, /useInstallation: \{ fromPath: vscodeTestExecutablePath \}/);
		assert.match(config, /vscodeTestVersion/);
		assert.doesNotMatch(config, /fromMachine/);
	});
});
