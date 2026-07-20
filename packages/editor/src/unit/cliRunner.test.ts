import * as assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { describe, test } from 'node:test';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { appendAnnotationViaCli, deleteAnnotationViaCli, parseAgentEventLine, readAnnotationsViaCli, resolveCliInvocation, startAgentRun } from '../cliRunner';

describe('CLI runner', () => {
	test('resolves installed executables and JavaScript test CLIs', () => {
		assert.deepEqual(resolveCliInvocation('sundial-editor-cli', '/node'), {
			command: 'sundial-editor-cli', args: ['prompt'],
		});
		assert.deepEqual(resolveCliInvocation('/workspace/cli.js', '/node'), {
			command: '/node', args: ['/workspace/cli.js', 'prompt'],
		});
	});

	test('accepts only valid discriminated NDJSON events', () => {
		assert.deepEqual(parseAgentEventLine('{"kind":"status","status":"working"}'), { kind: 'status', status: 'working' });
		assert.deepEqual(parseAgentEventLine('{"kind":"output","text":"Done"}'), { kind: 'output', text: 'Done' });
		assert.equal(parseAgentEventLine('{"kind":"status","status":"busy"}'), undefined);
		assert.equal(parseAgentEventLine('not-json'), undefined);
	});

	test('passes structured prompt context on stdin and streams events', async () => {
		const child = fakeChild();
		let invocation: { command: string; args: readonly string[]; cwd: string } | undefined;
		const events: unknown[] = [];
		const run = startAgentRun({
			cliPath: '/workspace/cli.js',
			cwd: '/workspace',
			message: 'Fix this.',
			prompt: {
				preset: '%F', scope: 'line', sourceUri: 'file:///workspace/a.ts', sourceLine: 4, sourceText: '%F',
				anchorText: 'code', anchorBefore: ['before'], anchorAfter: ['after'],
			},
		}, event => events.push(event), {
			nodeExecutable: '/node',
			spawn: (command, args, options) => {
				invocation = { command, args, cwd: options.cwd };
				return child.process;
			},
		});

		child.stdout.write('{"kind":"status","status":"working"}\n');
		child.stdout.write('{"kind":"output","text":"Patched."}\n');
		child.emitter.emit('exit', 0);
		assert.deepEqual(await run.completion, { exitCode: 0, stderr: '' });
		assert.deepEqual(invocation, { command: '/node', args: ['/workspace/cli.js', 'prompt'], cwd: '/workspace' });
		assert.deepEqual(events, [
			{ kind: 'status', status: 'working' },
			{ kind: 'output', text: 'Patched.' },
		]);
		const payload = JSON.parse(child.stdinData());
		assert.equal(payload.workspace.cwd, '/workspace');
		assert.equal(payload.document.line, 4);
		assert.equal(payload.prompt.text, 'Fix this.');
	});

	test('forwards cancellation to the CLI as SIGINT', async () => {
		const child = fakeChild();
		const run = startAgentRun({
			cliPath: 'sundial-editor-cli', cwd: '/workspace', message: 'Wait.',
			prompt: {
				preset: '%Q', scope: 'project', sourceUri: 'file:///workspace/a.ts', sourceLine: 0, sourceText: '%Q @G',
				anchorText: 'code', anchorBefore: [], anchorAfter: [],
			},
		}, () => undefined, {
			nodeExecutable: '/node',
			spawn: () => child.process,
		});
		run.cancel();
		assert.equal(child.killedWith(), 'SIGINT');
		child.emitter.emit('exit', 0);
		await run.completion;
	});

	test('invokes annotation commands with JSON and validates their responses', async () => {
		const appendChild = fakeChild();
		let appendInvocation: { command: string; args: readonly string[]; cwd: string } | undefined;
		const append = appendAnnotationViaCli('/workspace/cli.js', {
			workspace: { cwd: '/workspace' },
			document: { uri: 'file:///workspace/a.ts', line: 2, text: 'code', before: ['before'], after: ['after'] },
			annotation: { message: 'Fix it.', preset: '%F', scope: 'line' },
		}, {
			nodeExecutable: '/node',
			spawn: (command, args, options) => {
				appendInvocation = { command, args, cwd: options.cwd };
				return appendChild.process;
			},
		});
		appendChild.stdout.write('{"id":"annotation-1","message":"Fix it.","preset":"%F","scope":"line","anchor":{"line":2,"text":"code","before":["before"],"after":["after"]}}\n');
		appendChild.emitter.emit('exit', 0);
		assert.equal((await append).id, 'annotation-1');
		assert.deepEqual(appendInvocation, {
			command: '/node', args: ['/workspace/cli.js', 'annotations', 'append'], cwd: '/workspace',
		});
		assert.equal(JSON.parse(appendChild.stdinData()).annotation.message, 'Fix it.');

		const deleteChild = fakeChild();
		const remove = deleteAnnotationViaCli('/workspace/cli.js', {
			workspace: { cwd: '/workspace' }, document: { uri: 'file:///workspace/a.ts' },
			annotation: { id: 'annotation-1' },
		}, {
			nodeExecutable: '/node',
			spawn: (_command, args) => {
				assert.deepEqual(args, ['/workspace/cli.js', 'annotations', 'delete']);
				return deleteChild.process;
			},
		});
		deleteChild.stdout.write('{"id":"annotation-1","message":"Fix it.","preset":"%F","scope":"line","anchor":{"line":2,"text":"code","before":[],"after":[]}}\n');
		deleteChild.emitter.emit('exit', 0);
		assert.equal((await remove).id, 'annotation-1');
		assert.equal(JSON.parse(deleteChild.stdinData()).annotation.id, 'annotation-1');

		const readChild = fakeChild();
		const read = readAnnotationsViaCli('sundial-editor-cli', {
			workspace: { cwd: '/workspace' }, document: { uri: 'file:///workspace/a.ts' },
		}, {
			nodeExecutable: '/node',
			spawn: (_command, args) => {
				assert.deepEqual(args, ['annotations', 'read']);
				return readChild.process;
			},
		});
		readChild.stdout.write('{"version":1,"annotations":[]}\n');
		readChild.emitter.emit('exit', 0);
		assert.deepEqual(await read, { version: 1, annotations: [] });
	});
});

function fakeChild(): {
	readonly process: ChildProcessWithoutNullStreams;
	readonly emitter: EventEmitter;
	readonly stdout: PassThrough;
	readonly stdinData: () => string;
	readonly killedWith: () => string | undefined;
} {
	const emitter = new EventEmitter();
	const stdin = new PassThrough();
	const stdout = new PassThrough();
	const stderr = new PassThrough();
	let input = '';
	let signal: string | undefined;
	stdin.on('data', chunk => { input += String(chunk); });
	const process = Object.assign(emitter, {
		stdin, stdout, stderr,
		killed: false,
		kill: (killedWith?: NodeJS.Signals | number) => { signal = String(killedWith); return true; },
	}) as unknown as ChildProcessWithoutNullStreams;
	return { process, emitter, stdout, stdinData: () => input, killedWith: () => signal };
}
