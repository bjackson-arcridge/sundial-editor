import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderWebviewHtml } from '../webviews/shared/csp';

test('messages HTML uses a strict nonce CSP and local webview resources', () => {
	const html = renderWebviewHtml({
		title: 'Messages',
		bodyTagId: 'se-messages-app',
		scriptUri: 'vscode-webview://test-authority/dist/webviews/messages.js' as never,
		codiconUri: 'vscode-webview://test-authority/media/codicon.css' as never,
		cspSource: 'vscode-webview://test-authority',
		initialState: { kind: 'state' },
	});

	assert.match(html, /default-src 'none'/);
	assert.match(html, /style-src vscode-webview:\/\/test-authority 'nonce-[A-Za-z0-9_-]{43}'/);
	assert.match(html, /script-src vscode-webview:\/\/test-authority 'nonce-[A-Za-z0-9_-]{43}'/);
	assert.match(html, /src="vscode-webview:\/\/test-authority\/dist\/webviews\/messages\.js"/);
	assert.match(html, /href="vscode-webview:\/\/test-authority\/media\/codicon\.css"/);
	assert.match(html, /html, body \{ height: 100%; margin: 0; overflow: hidden; \}/);
	assert.doesNotMatch(html, /unsafe-inline|unsafe-eval|https?:\/\//);
});
