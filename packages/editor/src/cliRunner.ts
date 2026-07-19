import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import type { AgentEvent } from './agentProtocol';
import type { PromptContext } from './promptCommand';

export interface AgentRunRequest {
	readonly cliPath: string;
	readonly cwd: string;
	readonly prompt: PromptContext;
	readonly message: string;
	readonly provider?: 'codex';
	readonly model?: string;
}

export interface AgentRun {
	readonly completion: Promise<{ readonly exitCode: number; readonly stderr: string }>;
	readonly cancel: () => void;
}

export interface CliProcessServices {
	readonly spawn: (command: string, args: readonly string[], options: { readonly cwd: string }) => ChildProcessWithoutNullStreams;
	readonly nodeExecutable: string;
}

export function startAgentRun(
	request: AgentRunRequest,
	onEvent: (event: AgentEvent) => void,
	services: CliProcessServices = defaultServices,
): AgentRun {
	const invocation = resolveCliInvocation(request.cliPath, services.nodeExecutable);
	const child = services.spawn(invocation.command, invocation.args, { cwd: request.cwd });
	let stderr = '';
	let stdoutBuffer = '';
	let settled = false;

	child.stderr.on('data', chunk => { stderr += String(chunk); });
	child.stdout.on('data', chunk => {
		stdoutBuffer += String(chunk);
		let newline = stdoutBuffer.indexOf('\n');
		while (newline >= 0) {
			const line = stdoutBuffer.slice(0, newline).trim();
			stdoutBuffer = stdoutBuffer.slice(newline + 1);
			if (line !== '') {
				const event = parseAgentEventLine(line);
				if (event !== undefined) {
					onEvent(event);
				}
			}
			newline = stdoutBuffer.indexOf('\n');
		}
	});

	const completion = new Promise<{ exitCode: number; stderr: string }>((resolve, reject) => {
		child.once('error', error => {
			if (!settled) {
				settled = true;
				reject(new Error(errorMessageForStart(error, request.cliPath)));
			}
		});
		child.once('exit', code => {
			if (!settled) {
				settled = true;
				resolve({ exitCode: code ?? 1, stderr: stderr.trim() });
			}
		});
	});

	child.stdin.end(JSON.stringify({
		provider: request.provider ?? 'codex',
		...(request.model === undefined ? {} : { model: request.model }),
		workspace: { cwd: request.cwd },
		document: {
			uri: request.prompt.sourceUri,
			line: request.prompt.sourceLine,
			text: request.prompt.sourceText,
		},
		prompt: {
			preset: request.prompt.preset,
			scope: request.prompt.scope,
			text: request.message,
		},
	}));

	return {
		completion,
		cancel: () => {
			if (!settled) {
				child.kill('SIGINT');
			}
		},
	};
}

export function resolveCliInvocation(cliPath: string, nodeExecutable: string): { command: string; args: string[] } {
	return cliPath.endsWith('.js')
		? { command: nodeExecutable, args: [cliPath, 'prompt'] }
		: { command: cliPath, args: ['prompt'] };
}

export function parseAgentEventLine(line: string): AgentEvent | undefined {
	let value: unknown;
	try {
		value = JSON.parse(line);
	} catch {
		return undefined;
	}
	if (!isRecord(value) || typeof value.kind !== 'string') {
		return undefined;
	}
	if (value.kind === 'status'
		&& (value.status === 'waiting' || value.status === 'working' || value.status === 'blocked')
		&& (value.message === undefined || typeof value.message === 'string')) {
		return value as unknown as AgentEvent;
	}
	if (value.kind === 'output' && typeof value.text === 'string') {
		return value as unknown as AgentEvent;
	}
	if (value.kind === 'error' && typeof value.message === 'string' && typeof value.recoverable === 'boolean') {
		return value as unknown as AgentEvent;
	}
	return undefined;
}

const defaultServices: CliProcessServices = {
	spawn: (command, args, options) => spawn(command, args, { cwd: options.cwd, stdio: ['pipe', 'pipe', 'pipe'] }),
	nodeExecutable: process.execPath,
};

function errorMessageForStart(error: Error, cliPath: string): string {
	return 'code' in error && error.code === 'ENOENT'
		? `Sundial Editor CLI was not found at ${cliPath}. Install @arcridge/sundial-editor-cli or configure sundialEditor.cliPath.`
		: `Sundial Editor CLI could not be started: ${error.message}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}
