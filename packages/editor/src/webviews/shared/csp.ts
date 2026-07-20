import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';

export function generateNonce(): string {
	return randomBytes(32).toString('base64url');
}

export interface WebviewHtmlOptions {
	readonly title: string;
	readonly bodyTagId: string;
	readonly scriptUri: vscode.Uri;
	readonly codiconUri: vscode.Uri;
	readonly cspSource: string;
	readonly initialState?: unknown;
	readonly fallbackText?: string;
}

export function renderWebviewHtml(options: WebviewHtmlOptions): string {
	const nonce = generateNonce();
	const csp = [
		"default-src 'none'",
		`style-src ${options.cspSource} 'nonce-${nonce}'`,
		`script-src ${options.cspSource} 'nonce-${nonce}'`,
		`img-src ${options.cspSource}`,
		`font-src ${options.cspSource}`,
	].join('; ');
	const initialState = options.initialState === undefined
		? ''
		: `<script nonce="${nonce}" type="application/json" id="se-initial-state">${escapeJson(options.initialState)}</script>`;
	return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta http-equiv="Content-Security-Policy" content="${csp}">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<link rel="stylesheet" href="${options.codiconUri}" nonce="${nonce}">
	<style nonce="${nonce}">html, body { height: 100%; margin: 0; overflow: hidden; }</style>
	<title>${escapeHtml(options.title)}</title>
</head>
<body>
	<${options.bodyTagId}>${options.fallbackText === undefined ? '' : `<p>${escapeHtml(options.fallbackText)}</p>`}</${options.bodyTagId}>
	${initialState}
	<script nonce="${nonce}" type="module" src="${options.scriptUri}"></script>
</body>
</html>`;
}

function escapeHtml(value: string): string {
	return value
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll('\'', '&#39;');
}

function escapeJson(value: unknown): string {
	return JSON.stringify(value).replaceAll('<', '\\u003c').replaceAll('>', '\\u003e').replaceAll('&', '\\u0026');
}
