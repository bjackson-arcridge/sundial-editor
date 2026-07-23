import * as assert from 'node:assert/strict';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';

interface AnnotationSummary {
	readonly id: string;
	readonly message: string;
	readonly line: number | null;
	readonly currentPermanent: boolean;
}

interface MessagesDiagnostics {
	readonly state: {
		readonly workflow: { readonly annotationFilterEnabled: boolean; readonly currentPermanentCommit?: string };
		readonly annotationIndex:
			| { readonly kind: 'loading' | 'empty' }
			| { readonly kind: 'error'; readonly message: string }
			| { readonly kind: 'ready'; readonly groups: readonly { readonly file: string; readonly annotations: readonly AnnotationSummary[] }[] };
		readonly annotationViewer?: { readonly annotation: { readonly id: string } };
	};
}

suite('Scenario: annotation-index', () => {
	test('groups, filters, opens, and watcher-refreshes workspace annotations', async () => {
		const extension = vscode.extensions.getExtension('arcridge.sundial-editor');
		if (extension === undefined) { throw new Error('Expected Sundial Editor extension to be loaded'); }
		await extension.activate();
		const workspace = vscode.workspace.workspaceFolders?.[0];
		if (workspace === undefined) { throw new Error('Expected the staged annotation-index workspace'); }
		await vscode.commands.executeCommand('workbench.view.extension.sundialEditor');
		await vscode.commands.executeCommand('sundialEditor.messages.focus');
		const initial = await waitForDiagnostics(value => value.state.workflow.currentPermanentCommit !== undefined);
		const current = initial.state.workflow.currentPermanentCommit!;
		const old = current === 'b'.repeat(40) ? 'c'.repeat(40) : 'b'.repeat(40);
		const alphaCompanion = path.join(workspace.uri.fsPath, '.sundial', 'src', 'alpha.ts.comments');
		const betaCompanion = path.join(workspace.uri.fsPath, '.sundial', 'nested', 'beta.ts.comments');
		await mkdir(path.dirname(alphaCompanion), { recursive: true });
		await mkdir(path.dirname(betaCompanion), { recursive: true });
		await writeFile(alphaCompanion, companion([
			user('alpha-old', old, 'Earlier alpha question.', 0),
			user('alpha-current', current, 'Newest alpha question.', 0, [{
				annotationId: 'alpha-agent', file: 'src/alpha.ts', line: 0,
			}]),
			agent('alpha-agent', current, 'alpha-current'),
		]));
		await writeFile(betaCompanion, companion([user('beta-file', old, 'Beta file question.', null)]));

		const ready = await waitForDiagnostics(value => value.state.annotationIndex.kind === 'ready'
			&& value.state.annotationIndex.groups.length === 2);
		assert.equal(ready.state.annotationIndex.kind, 'ready');
		if (ready.state.annotationIndex.kind !== 'ready') { assert.fail('expected ready annotation index'); }
		assert.deepEqual(ready.state.annotationIndex.groups.map(group => group.file), ['nested/beta.ts', 'src/alpha.ts']);
		assert.deepEqual(ready.state.annotationIndex.groups[1].annotations.map(annotation => annotation.id), ['alpha-current', 'alpha-old']);
		assert.equal(JSON.stringify(ready.state.annotationIndex).includes('Agent-only body'), false);

		await vscode.commands.executeCommand('sundialEditor.internal.toggleAnnotationFilter');
		const filtered = await waitForDiagnostics(value => value.state.workflow.annotationFilterEnabled
			&& value.state.annotationIndex.kind === 'ready');
		assert.equal(filtered.state.annotationIndex.kind, 'ready');
		if (filtered.state.annotationIndex.kind !== 'ready') { assert.fail('expected ready filtered index'); }
		// Raw host state stays complete; the webview applies the shared flag to its projection.
		assert.equal(filtered.state.annotationIndex.groups[1].annotations[0].currentPermanent, true);

		await vscode.commands.executeCommand('sundialEditor.internal.openAnnotation', {
			annotationId: 'alpha-current', file: 'src/alpha.ts', line: 0,
		});
		await waitForDiagnostics(value => value.state.annotationViewer?.annotation.id === 'alpha-current');

		await rm(betaCompanion);
		const refreshed = await waitForDiagnostics(value => value.state.annotationIndex.kind === 'ready'
			&& value.state.annotationIndex.groups.length === 1);
		assert.equal(refreshed.state.annotationViewer?.annotation.id, 'alpha-current');

		await writeFile(alphaCompanion, 'malformed companion\n');
		const failed = await waitForDiagnostics(value => value.state.annotationIndex.kind === 'error');
		assert.equal(failed.state.annotationViewer?.annotation.id, 'alpha-current', 'an index failure must not clear the lower viewer');
	});
});

function user(
	id: string,
	permanentBaseCommit: string,
	message: string,
	line: number | null,
	agentAnnotations: readonly { annotationId: string; file: string; line: number | null }[] = [],
) {
	return {
		kind: 'user', id, permanentBaseCommit, message, preset: '%Q', scope: line === null ? 'project' : 'line',
		anchor: { line, text: line === null ? '' : 'export const alpha = 1;', before: [], after: [] },
		officialResponses: [], agentAnnotations,
	};
}

function agent(id: string, permanentBaseCommit: string, userAnnotationId: string) {
	return {
		kind: 'agent', id, permanentBaseCommit, agentId: 'agent-1', agentSessionId: 'session-1',
		body: 'Agent-only body', createdAt: '2026-07-23T12:00:00.000Z',
		anchor: { line: 0, text: 'export const alpha = 1;', before: [], after: [] },
		userAnnotation: { annotationId: userAnnotationId, file: 'src/alpha.ts', line: 0 },
	};
}

function companion(annotations: readonly unknown[]): string {
	return [
		'version: 5',
		`sourceDigest: ${'a'.repeat(64)}`,
		'annotations:',
		...annotations.map(annotation => `  - ${JSON.stringify(annotation)}`),
		'',
	].join('\n');
}

async function waitForDiagnostics(
	predicate: (value: MessagesDiagnostics) => boolean,
	timeoutMs = 10_000,
): Promise<MessagesDiagnostics> {
	const started = Date.now();
	let latest: MessagesDiagnostics | undefined;
	while (Date.now() - started < timeoutMs) {
		latest = await vscode.commands.executeCommand<MessagesDiagnostics>('sundialEditor.internal.messagesDiagnostics');
		if (latest !== undefined && predicate(latest)) { return latest; }
		await new Promise(resolve => setTimeout(resolve, 100));
	}
	throw new Error(`Timed out waiting for annotation-index diagnostics: ${JSON.stringify(latest)}`);
}
