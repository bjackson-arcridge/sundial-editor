import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { test } from 'node:test';

test('messages webview requests current state after its listener is ready', () => {
	const appSource = fs.readFileSync(path.resolve(__dirname, '../../src/webviews/apps/messages/messages-app.ts'), 'utf8');
	const providerSource = fs.readFileSync(path.resolve(__dirname, '../../src/webviews/messages/messagesWebviewProvider.ts'), 'utf8');
	const routerIndex = providerSource.indexOf('const router = attachMessageRouter');
	const htmlIndex = providerSource.indexOf('messagesView.webview.html = renderWebviewHtml');

	assert.match(appSource, /window\.addEventListener\('message', this\.handleHostMessageEvent\);\s*this\.webviewHost\.postMessage\(\{ kind: 'ready' \}\);/);
	assert.notEqual(routerIndex, -1);
	assert.notEqual(htmlIndex, -1);
	assert.ok(
		routerIndex < htmlIndex,
		'the host listener must be attached before the webview can announce readiness',
	);
	assert.match(providerSource, /case 'ready': this\.postState\(\); this\.focusPendingComposer\(\); return;/);
});

test('messages sidebar loads agents from the workspace root before a file editor is active', () => {
	const extensionSource = fs.readFileSync(path.resolve(__dirname, '../../src/extension.ts'), 'utf8');
	const providerSource = fs.readFileSync(path.resolve(__dirname, '../../src/webviews/messages/messagesWebviewProvider.ts'), 'utf8');

	assert.match(extensionSource, /workspaceRootCwd: \(\) => vscode\.workspace\.workspaceFolders\?\.\[0\]\?\.uri\.fsPath/);
	assert.match(providerSource, /this\.pendingPrompt\?\.cwd \?\? this\.activeLocation\?\.cwd \?\? this\.services\.workspaceRootCwd\?\.\(\)/);
	assert.match(providerSource, /const cwd = this\.currentCwd\(\);\s*if \(cwd !== undefined\) \{ void this\.refreshAgentState\(cwd\); \}/);
	assert.match(extensionSource, /event\.affectsConfiguration\('sundialEditor\.cliPath'\)[\s\S]*?void messagesProvider\.refreshAgentState\(\);/);
});

test('annotation response control is accessible and sends only a fieldless selection action', () => {
	const appSource = fs.readFileSync(path.resolve(__dirname, '../../src/webviews/apps/messages/messages-app.ts'), 'utf8');
	const protocolSource = fs.readFileSync(path.resolve(__dirname, '../../src/webviews/messages/messages.ts'), 'utf8');

	assert.match(
		appSource,
		/<button class="icon respond-annotation" type="button" \?disabled=\$\{viewer === undefined \|\| this\.busy\}[\s\S]*?aria-label="Respond to annotation" title="Respond to annotation"/,
	);
	assert.match(appSource, /this\.webviewHost\.postMessage\(\{ kind: 'respondToAnnotation' \}\);/);
	assert.match(appSource, /The originating active conversation is preselected\./);
	assert.match(appSource, /The originating conversation is unavailable\. Choose an agent; the selected agent may not have the prior conversation context\./);
	assert.match(appSource, /\.annotation-toolbar button:not\(:disabled\)/);
	assert.match(protocolSource, /case 'respondToAnnotation':[\s\S]*?return hasExactKeys\(value, \['kind'\]\);/);
});
