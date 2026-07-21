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
