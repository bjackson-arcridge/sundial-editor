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
		readonly configuration?: { readonly properties?: Record<string, { readonly default?: unknown }> };
		readonly configurationDefaults?: Record<string, unknown>;
		readonly menus?: { readonly commandPalette?: readonly { readonly command?: unknown }[] };
	};
}

function readManifest(): PackageManifest {
	return JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../package.json'), 'utf8')) as PackageManifest;
}

describe('Sundial Editor manifest', () => {
	test('is an independent 0.6.2 extension package', () => {
		const manifest = readManifest();
		assert.equal(manifest.name, 'sundial-editor');
		assert.equal(manifest.publisher, 'arcridge');
		assert.equal(manifest.version, '0.6.2');
		assert.equal(Object.hasOwn(manifest, 'extensionDependencies'), false);
		assert.equal(Object.hasOwn(manifest.dependencies ?? {}, '@arcridge/sundial'), false);
		assert.equal(Object.hasOwn(manifest.dependencies ?? {}, 'sundial'), false);
		assert.equal(manifest.dependencies?.['markdown-it'], '^14.3.0');
		assert.equal(manifest.scripts?.['package:vsix'], 'vsce package --no-dependencies');
	});

	test('contributes the autosave defaults, command, and Secondary Sidebar Messages webview', () => {
		const manifest = readManifest();
		const commands = manifest.contributes?.commands ?? [];
		const views = manifest.contributes?.views?.sundialEditor ?? [];

		assert.equal(manifest.contributes?.configurationDefaults?.['files.autoSave'], 'afterDelay');
		assert.equal(manifest.contributes?.configurationDefaults?.['files.autoSaveDelay'], 1000);
		assert.equal(manifest.contributes?.configuration?.properties?.['sundialEditor.cliPath']?.default, 'sundial-editor-cli');
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
		assert.match(readme, /Codex/);
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

		assert.match(providerSource, /case 'submit':\s*void this\.startSubmission\(message\.message, message\.targetAgentId\)/);
		assert.match(providerSource, /await this\.services\.returnToSource\(pending\.prompt\)/);
		assert.match(extensionSource, /showTextDocument\(vscode\.Uri\.parse\(prompt\.sourceUri\), \{ preserveFocus: false \}\)/);
		assert.match(extensionSource, /returnToVSCodeVimNormalMode/);
	});

	test('renders icon agent controls, a transcript takeover, and independently scrolling split panes', () => {
		const messagesSource = fs.readFileSync(path.resolve(__dirname, '../../src/webviews/apps/messages/messages-app.ts'), 'utf8');
		const sharedStyles = fs.readFileSync(path.resolve(__dirname, '../../src/webviews/apps/shared/styles.ts'), 'utf8');

		assert.match(messagesSource, /class="agent-pane" aria-label="Agents"/);
		assert.match(messagesSource, /class="pane-separator/);
		assert.match(messagesSource, /class="annotation-pane/);
		assert.match(messagesSource, /\.agent-pane \{[\s\S]*?overflow: auto/);
		assert.match(messagesSource, /\.annotation-content \{[\s\S]*?overflow: auto/);
		assert.match(messagesSource, /title="Previous annotation"/);
		assert.match(messagesSource, /title="Next annotation"/);
		assert.match(messagesSource, /title="Delete annotation"/);
		assert.doesNotMatch(messagesSource, /No current work\./);
		assert.match(messagesSource, /Waiting for \$\{waitingAgent\.name\}/);
		assert.match(messagesSource, /class="toolbar-icon"/);
		assert.match(messagesSource, /class="agent-title-actions" role="toolbar"/);
		assert.match(messagesSource, /renderToolbarIcon\('edit'\)/);
		assert.match(messagesSource, /renderToolbarIcon\('transcript'\)/);
		assert.match(messagesSource, /renderToolbarIcon\('open-external'\)/);
		assert.match(messagesSource, /renderToolbarIcon\('clear-agent'\)/);
		assert.match(messagesSource, /return this\.renderTranscriptTakeover\(this\.transcript, transcriptAgent\)/);
		assert.match(messagesSource, /class="transcript-takeover"/);
		assert.match(messagesSource, /class="icon transcript-close-button"/);
		assert.doesNotMatch(messagesSource, /transcriptExpanded \? this\.renderTranscript/);
		assert.match(messagesSource, /agent\.session\.state === 'available'/);
		assert.match(messagesSource, /class="session-indicator \$\{agent\.session\.state\}"/);
		assert.match(messagesSource, /role="img"[\s\S]*?aria-label=\$\{this\.sessionBadgeLabel\(agent\)\}/);
		assert.match(messagesSource, /class="rename-input"/);
		assert.doesNotMatch(messagesSource, /class="rename-actions"/);
		assert.match(messagesSource, /fill: currentColor/);
		assert.doesNotMatch(messagesSource, /class="codicon/);
		assert.match(sharedStyles, /--se-icon-fg: var\(--vscode-foreground\)/);
		assert.match(sharedStyles, /--se-toolbar-bg: var\(--vscode-sideBarSectionHeader-background/);
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
