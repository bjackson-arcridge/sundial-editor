import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, test } from 'node:test';
import { agentTaskCommands } from '../agentTaskCommand';

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
	readonly devDependencies?: Record<string, unknown>;
	readonly contributes?: {
		readonly commands?: readonly { readonly command?: unknown; readonly title?: unknown }[];
		readonly viewsContainers?: {
			readonly activitybar?: readonly { readonly id?: unknown; readonly icon?: unknown; readonly title?: unknown }[];
			readonly secondarySidebar?: readonly { readonly id?: unknown; readonly icon?: unknown; readonly title?: unknown }[];
		};
		readonly views?: Record<string, readonly ViewContribution[]>;
		readonly configuration?: {
			readonly properties?: Record<string, {
				readonly type?: unknown;
				readonly default?: unknown;
				readonly minimum?: unknown;
				readonly maximum?: unknown;
				readonly scope?: unknown;
			}>;
		};
		readonly configurationDefaults?: Record<string, unknown>;
		readonly menus?: { readonly commandPalette?: readonly { readonly command?: unknown }[] };
	};
}

function readManifest(): PackageManifest {
	return JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../package.json'), 'utf8')) as PackageManifest;
}

function typeScriptSources(root: string): string[] {
	return fs.readdirSync(root, { withFileTypes: true }).flatMap(entry => {
		const candidate = path.join(root, entry.name);
		if (entry.isDirectory()) { return entry.name === 'test' || entry.name === 'unit' ? [] : typeScriptSources(candidate); }
		return entry.isFile() && entry.name.endsWith('.ts') ? [candidate] : [];
	});
}

describe('Sundial Editor manifest', () => {
	test('is an independent 0.18.0 extension package', () => {
		const manifest = readManifest();
		assert.equal(manifest.name, 'sundial-editor');
		assert.equal(manifest.publisher, 'arcridge');
		assert.equal(manifest.version, '0.18.0');
		assert.equal(Object.hasOwn(manifest, 'extensionDependencies'), false);
		assert.equal(Object.hasOwn(manifest.dependencies ?? {}, '@arcridge/sundial'), false);
		assert.equal(Object.hasOwn(manifest.dependencies ?? {}, 'sundial'), false);
		assert.equal(manifest.dependencies?.['markdown-it'], '^14.3.0');
		assert.equal(manifest.devDependencies?.['@arcridge/sundial-editor-annotations'], '0.1.0');
		assert.equal(manifest.scripts?.['package:vsix'], 'vsce package --no-dependencies');
		assert.equal(manifest.scripts?.['watch:annotations'], 'npm run compile --workspace @arcridge/sundial-editor-annotations -- --watch');
	});

	test('contributes every public agent task command to activation and the Command Palette', () => {
		const manifest = readManifest();
		const contributed = manifest.contributes?.commands ?? [];
		const palette = manifest.contributes?.menus?.commandPalette ?? [];

		for (const command of agentTaskCommands) {
			assert.equal(
				contributed.some(candidate => candidate.command === command.id && candidate.title === command.title),
				true,
				`${command.id} must be contributed with its catalog title`,
			);
			assert.equal(manifest.activationEvents?.includes(`onCommand:${command.id}`), true);
			assert.equal(palette.some(item => item.command === command.id), true);
		}
	});

	test('mediates annotation file operations through the CLI', () => {
		const sources = typeScriptSources(path.resolve(__dirname, '../../src'));
		for (const source of sources) {
			assert.doesNotMatch(
				fs.readFileSync(source, 'utf8'),
				/@arcridge\/sundial-editor-annotations\/(?:store|move|repair|reanchor)/,
				`${path.relative(path.resolve(__dirname, '../../src'), source)} must not invoke annotation repair or storage directly`,
			);
		}
	});

	test('contributes the autosave defaults, command, and Secondary Sidebar Messages webview', () => {
		const manifest = readManifest();
		const commands = manifest.contributes?.commands ?? [];
		const views = manifest.contributes?.views?.sundialEditor ?? [];

		assert.equal(manifest.contributes?.configurationDefaults?.['files.autoSave'], 'afterDelay');
		assert.equal(manifest.contributes?.configurationDefaults?.['files.autoSaveDelay'], 1000);
		assert.equal(manifest.contributes?.configuration?.properties?.['sundialEditor.cliPath']?.default, 'sundial-editor-cli');
		assert.deepEqual(manifest.contributes?.configuration?.properties?.['sundialEditor.paneSplitPercent'], {
			type: 'number',
			default: 50,
			minimum: 10,
			maximum: 90,
			scope: 'window',
			description: 'Percentage of the Messages view height allocated to the Agents pane. Resizing the pane separator updates this setting.',
		});
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
		assert.match(readme, /`%D`.*deep research/);
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
		const manifest = readManifest();

		assert.match(source, /registerCompletionItemProvider/);
		assert.match(source, /promptCommandPrefix/);
		assert.match(source, /commandId: submitPromptCommandId/);
		assert.match(source, /command: completion\.commandId/);
		assert.match(source, /executeWorkflowTextCommandId/);
		assert.match(source, /editor\.action\.inlineSuggest\.hide/);
		assert.deepEqual(manifest.contributes?.commands?.flatMap(command => typeof command.command === 'string' ? [command.command] : []).filter(command =>
			command.startsWith('sundialEditor.diff.') || command.startsWith('sundialEditor.commit.')
				|| command === 'sundialEditor.companions.repair'), [
			'sundialEditor.diff.toggle', 'sundialEditor.diff.inline', 'sundialEditor.diff.previous',
			'sundialEditor.diff.next', 'sundialEditor.diff.head', 'sundialEditor.diff.permanent',
			'sundialEditor.commit.file', 'sundialEditor.commit.all', 'sundialEditor.commit.message',
			'sundialEditor.companions.repair',
		]);
	});

	test('returns to the originating editor after a Messages submission', () => {
		const extensionSource = fs.readFileSync(path.resolve(__dirname, '../../src/extension.ts'), 'utf8');
		const providerSource = fs.readFileSync(path.resolve(__dirname, '../../src/webviews/messages/messagesWebviewProvider.ts'), 'utf8');

		assert.match(providerSource, /case 'submit':\s*void this\.startSubmission\(message\.message, message\.targetAgentId\)/);
		assert.match(providerSource, /await this\.services\.returnToSource\(pending\.prompt\)/);
		assert.match(extensionSource, /showTextDocument\(vscode\.Uri\.parse\(prompt\.sourceUri\), \{ preserveFocus: false \}\)/);
		assert.match(extensionSource, /returnToVSCodeVimNormalMode/);
	});

	test('initializes the targeted agent option when the composer opens', () => {
		const messagesSource = fs.readFileSync(path.resolve(__dirname, '../../src/webviews/apps/messages/messages-app.ts'), 'utf8');

		assert.match(messagesSource, /<option value=\$\{agent\.id\} \.selected=\$\{agent\.id === this\.targetAgentId\}>/);
	});

	test('places the rename control directly after the agent name', () => {
		const messagesSource = fs.readFileSync(path.resolve(__dirname, '../../src/webviews/apps/messages/messages-app.ts'), 'utf8');
		const headingStart = messagesSource.indexOf('<h3 id="agent-${agentIndex}-heading">');
		const renameButton = messagesSource.indexOf('class="icon rename-button"', headingStart);
		const headingEnd = messagesSource.indexOf('</h3>', headingStart);
		const controlsToolbar = messagesSource.indexOf('class="agent-title-actions"', headingStart);

		assert.ok(headingStart >= 0);
		assert.ok(renameButton > headingStart && renameButton < headingEnd);
		assert.ok(controlsToolbar > headingEnd);
	});

	test('renders the new-message composer as the highest-priority sidebar takeover', () => {
		const messagesSource = fs.readFileSync(path.resolve(__dirname, '../../src/webviews/apps/messages/messages-app.ts'), 'utf8');

		assert.match(messagesSource, /render\(\) \{\s*if \(this\.prompt !== undefined\) \{\s*return this\.renderComposerTakeover\(this\.prompt\);\s*\}/);
		assert.match(messagesSource, /class="composer-takeover" aria-labelledby="new-message-heading"/);
		assert.match(messagesSource, /<h1 id="new-message-heading">New message<\/h1>/);
	});

	test('renders icon agent controls, a status-history takeover, and independently scrolling split panes', () => {
		const messagesSource = fs.readFileSync(path.resolve(__dirname, '../../src/webviews/apps/messages/messages-app.ts'), 'utf8');
		const providerSource = fs.readFileSync(path.resolve(__dirname, '../../src/webviews/messages/messagesWebviewProvider.ts'), 'utf8');
		const sharedStyles = fs.readFileSync(path.resolve(__dirname, '../../src/webviews/apps/shared/styles.ts'), 'utf8');

		assert.match(messagesSource, /class="agent-pane" aria-label="Agents and annotations"/);
		assert.match(messagesSource, /class="pane-separator/);
		assert.match(messagesSource, /class="annotation-pane/);
		assert.match(messagesSource, /\.annotation-content \{[\s\S]*?overflow: auto/);
		assert.match(messagesSource, /title="Previous annotation"/);
		assert.match(messagesSource, /title="Next annotation"/);
		assert.match(messagesSource, /title="Delete annotation"/);
		assert.doesNotMatch(messagesSource, /No current work\./);
		assert.match(messagesSource, /Waiting for \$\{waitingAgent\.name\}/);
		assert.match(messagesSource, /class="toolbar-icon"/);
		assert.match(messagesSource, /class="agent-title-actions" role="toolbar"/);
		assert.match(messagesSource, /renderToolbarIcon\('edit'\)/);
		assert.match(messagesSource, /renderToolbarIcon\('history'\)/);
		assert.match(messagesSource, /renderToolbarIcon\('open-external'\)/);
		assert.match(messagesSource, /renderToolbarIcon\('clear-agent'\)/);
		assert.doesNotMatch(messagesSource, /aria-label="Interrupt \$\{agent\.name\}"/);
		assert.match(providerSource, /This will reset \$\{agent\.name\}, interrupt any active work, and delete all work that has been assigned to this agent\./);
		assert.doesNotMatch(messagesSource, /class="agent-actions"/);
		assert.match(messagesSource, /return this\.renderHistoryTakeover\(historyAgent\)/);
		assert.match(messagesSource, /sessionStatusHistoryGroupsForAgent\(this\.work, agent\)/);
		assert.match(messagesSource, /class="history-group"/);
		assert.match(messagesSource, />User message<\/h2>/);
		assert.match(messagesSource, /class="history-user-message">\$\{group\.userMessage\}/);
		assert.match(messagesSource, /class="history-takeover"/);
		assert.match(messagesSource, /class="icon history-close-button"/);
		assert.match(messagesSource, /View history for \$\{agent\.name\}/);
		assert.doesNotMatch(messagesSource, /Transcript|transcript/);
		assert.match(messagesSource, /agent\.session\.state === 'available'/);
		assert.match(messagesSource, /class="session-indicator \$\{agent\.session\.state\}"/);
		assert.match(messagesSource, /role="img"[\s\S]*?aria-label=\$\{this\.sessionBadgeLabel\(agent\)\}/);
		assert.match(messagesSource, /class="rename-input"/);
		assert.doesNotMatch(messagesSource, /class="rename-actions"/);
		assert.match(messagesSource, /latestSessionStatusForAgent\(this\.work, agent\)/);
		assert.match(messagesSource, /class="agent-last-status"/);
		assert.match(messagesSource, /\.agent-last-status \{[^}]*overflow-wrap: anywhere;[^}]*white-space: pre-wrap;/);
		assert.doesNotMatch(messagesSource, /\.agent-last-status \{[^}]*white-space: nowrap;/);
		assert.match(messagesSource, /\.agent-pane \{[^}]*overflow-x: hidden;[^}]*overflow-y: auto;/);
		assert.match(messagesSource, /class="agent-pending-status" role="status"/);
		assert.match(messagesSource, /@keyframes pending-status-dot/);
		assert.match(messagesSource, /@media \(prefers-reduced-motion: reduce\)/);
		assert.match(messagesSource, /class="work-annotation-link"/);
		assert.match(messagesSource, /displayedWorkForAgent\(this\.work, agent\)/);
		assert.match(messagesSource, /renderWorkAnnotationLink\(group\.annotationId, group\.preset, group\.sourceLine\)/);
		assert.match(messagesSource, /renderToolbarIcon\('return'\)/);
		assert.match(messagesSource, /kind: 'revealAnnotation', annotationId/);
		assert.doesNotMatch(messagesSource, /renderWorkCard|class="work-card"/);
		assert.match(providerSource, /case 'revealAnnotation': void this\.revealWorkAnnotation\(message\.annotationId\)/);
		assert.match(providerSource, /this\.services\.revealAnnotation\?\.\(annotationWork\.source\.uri, annotationWork\.source\.line, false\)/);
		assert.match(messagesSource, /fill: currentColor/);
		assert.doesNotMatch(messagesSource, /class="codicon/);
		assert.match(sharedStyles, /--se-icon-fg: var\(--vscode-foreground\)/);
		assert.match(sharedStyles, /--se-toolbar-bg: var\(--vscode-sideBarSectionHeader-background/);
	});

	test('renders an accessible annotation index with shared filtering and exact links', () => {
		const messagesSource = fs.readFileSync(path.resolve(__dirname, '../../src/webviews/apps/messages/messages-app.ts'), 'utf8');
		assert.match(messagesSource, /role="tablist" aria-label="Messages view"/);
		assert.match(messagesSource, /role="tab"[\s\S]*aria-selected=/);
		assert.match(messagesSource, /role="tabpanel"/);
		assert.match(messagesSource, /ArrowLeft/);
		assert.match(messagesSource, /ArrowRight/);
		assert.match(messagesSource, /keyboardEvent\.key === 'Home'/);
		assert.match(messagesSource, /keyboardEvent\.key === 'End'/);
		assert.match(messagesSource, /annotationIndexGroups\(this\.annotationIndex, this\.workflow\.annotationFilterEnabled\)/);
		assert.match(messagesSource, /-webkit-line-clamp: 2/);
		assert.match(messagesSource, /annotationId: annotation\.id, file: group\.file, line: annotation\.line/);
		assert.match(messagesSource, /No annotations in this workspace\./);
		assert.match(messagesSource, /No annotations for the current permanent commit\./);
	});

	test('renders and applies the permanent-commit annotation filter from typed workflow state', () => {
		const extensionSource = fs.readFileSync(path.resolve(__dirname, '../../src/extension.ts'), 'utf8');
		const messagesSource = fs.readFileSync(path.resolve(__dirname, '../../src/webviews/apps/messages/messages-app.ts'), 'utf8');
		const providerSource = fs.readFileSync(path.resolve(__dirname, '../../src/webviews/messages/messagesWebviewProvider.ts'), 'utf8');

		assert.match(messagesSource, /class="workflow-status"/);
		assert.match(messagesSource, /color: var\(--se-muted-fg\)/);
		assert.match(messagesSource, /aria-label="Filter annotations to current permanent commit"/);
		assert.match(messagesSource, /aria-pressed=\$\{this\.workflow\.annotationFilterEnabled\}/);
		assert.match(messagesSource, /title=\$\{filterTitle\}/);
		assert.match(messagesSource, /postMessage\(\{ kind: 'toggleAnnotationFilter' \}\)/);
		assert.match(providerSource, /companion\.currentPermanentAnnotationIds/);
		assert.match(providerSource, /annotationsForCurrentPermanentCommit\([\s\S]*?loaded\.currentPermanentAnnotationIds/);
		assert.match(providerSource, /annotationLines\(this\.visibleAnnotations\(\)\)/);
		assert.match(providerSource, /orderedAnnotations\(this\.visibleAnnotations\(loaded\)\)/);
		assert.match(extensionSource, /diffController\.activeSourceUri\(\)/);
		assert.match(extensionSource, /messagesProvider\.setDiffPresentation/);
		assert.match(extensionSource, /diffLayout: diagnostics\.renderSideBySide \? 'side-by-side' : 'inline'/);
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
