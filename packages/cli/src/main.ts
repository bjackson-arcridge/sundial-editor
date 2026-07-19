import { readFile } from 'node:fs/promises';
import { createCodexAdapter } from './adapters/codex.js';
import type { ProviderAdapter } from './adapters/adapter.js';
import { parsePromptRequest, renderEvent } from './protocol.js';

const packageVersion = '0.1.1';

export interface CliIo {
	readonly stdin: NodeJS.ReadableStream;
	readonly stdout: { write(chunk: string): unknown };
	readonly stderr: { write(chunk: string): unknown };
}

export interface MainServices {
	readonly adapters: Readonly<Record<string, ProviderAdapter>>;
	readonly readFile: (path: string) => Promise<string>;
}

const helpText = `Sundial Editor CLI ${packageVersion}

Usage:
  sundial-editor-cli --version
  sundial-editor-cli help
  sundial-editor-cli health [--provider codex]
  sundial-editor-cli prompt [--input request.json]

The prompt command reads JSON from stdin unless --input is provided and emits
newline-delimited JSON events with kind=status, output, or error.
`;

export async function main(
	argv: readonly string[],
	io: CliIo,
	services: MainServices = { adapters: { codex: createCodexAdapter() }, readFile: path => readFile(path, 'utf8') },
): Promise<number> {
	const [command, ...args] = argv;
	if (command === '--version' || command === '-v') {
		io.stdout.write(`${packageVersion}\n`);
		return 0;
	}
	if (command === undefined || command === 'help' || command === '--help' || command === '-h') {
		io.stdout.write(helpText);
		return 0;
	}
	if (command === 'health') {
		try {
			const provider = optionValue(args, '--provider') ?? 'codex';
			if (args.length !== 0 && args.length !== 2) {
				throw new Error(`Unexpected health arguments: ${args.join(' ')}`);
			}
			const adapter = services.adapters[provider];
			if (adapter === undefined) {
				io.stderr.write(`Unsupported provider: ${provider}\n`);
				return 2;
			}
			const health = await adapter.health();
			io.stdout.write(`${JSON.stringify({ kind: 'capabilities', protocolVersion: 1, statuses: ['waiting', 'working', 'blocked'], health })}\n`);
			return health.available && health.compatible ? 0 : 1;
		} catch (error) {
			io.stderr.write(`${errorMessage(error)}\n`);
			return 2;
		}
	}
	if (command !== 'prompt') {
		io.stderr.write(`Unknown command: ${command}\nRun sundial-editor-cli help for usage.\n`);
		return 2;
	}

	try {
		const inputPath = optionValue(args, '--input');
		validatePromptArgs(args, inputPath);
		const input = inputPath === undefined ? await readStream(io.stdin) : await services.readFile(inputPath);
		const request = parsePromptRequest(JSON.parse(input));
		const adapter = services.adapters[request.provider];
		if (adapter === undefined) {
			throw new Error(`Unsupported provider: ${request.provider}`);
		}
		const abortController = new AbortController();
		const onSignal = (): void => abortController.abort();
		process.once('SIGINT', onSignal);
		process.once('SIGTERM', onSignal);
		try {
			await adapter.run(request, event => io.stdout.write(`${renderEvent(event)}\n`), abortController.signal);
			io.stdout.write(`${renderEvent({ kind: 'status', status: 'waiting' })}\n`);
			return 0;
		} finally {
			process.removeListener('SIGINT', onSignal);
			process.removeListener('SIGTERM', onSignal);
		}
	} catch (error) {
		const message = error instanceof SyntaxError ? `Invalid JSON: ${error.message}` : errorMessage(error);
		io.stdout.write(`${renderEvent({ kind: 'status', status: 'blocked', message })}\n`);
		io.stdout.write(`${renderEvent({ kind: 'error', message, recoverable: true })}\n`);
		io.stderr.write(`sundial-editor-cli: ${message}\n`);
		return 1;
	}
}

function optionValue(args: readonly string[], name: string): string | undefined {
	const index = args.indexOf(name);
	if (index < 0) {
		return undefined;
	}
	const value = args[index + 1];
	if (value === undefined || value.startsWith('-')) {
		throw new Error(`${name} requires a value`);
	}
	return value;
}

function validatePromptArgs(args: readonly string[], inputPath: string | undefined): void {
	const expected = inputPath === undefined ? 0 : 2;
	if (args.length !== expected) {
		throw new Error(`Unexpected prompt arguments: ${args.join(' ')}`);
	}
}

async function readStream(stream: NodeJS.ReadableStream): Promise<string> {
	let value = '';
	for await (const chunk of stream) {
		value += String(chunk);
	}
	return value;
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

if (require.main === module) {
	void main(process.argv.slice(2), process).then(code => { process.exitCode = code; });
}
