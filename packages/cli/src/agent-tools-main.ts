import { createHash } from 'node:crypto';
import { rm } from 'node:fs/promises';
import * as path from 'node:path';
import {
	AgentStoreConflictError,
	listCoordinationAgents,
	provideStatusUpdate,
	publishCoordinationUpdate,
} from './agentStore.js';
import { readStableMarkdown, writeAgentAnnotationPair } from './annotations.js';
import { recordTaskResponse } from './responseRecording.js';
import { packageVersion } from './version.js';

const helpText = `Sundial Agent Tools ${packageVersion}

Usage:
  sundial-agent-tools --version
  sundial-agent-tools help
  sundial-agent-tools coordination list
  sundial-agent-tools coordination update --state <state> --message "<message>" [--file <file>]...
  sundial-agent-tools provide-status-update "<status>"
  sundial-agent-tools annotate --file <file> --line <line> --content <file>
  sundial-agent-tools record-task-response ".sundial/<UserAnnotationId>response.md"

coordination list shows every managed agent's numeric slot, name, and latest
coordination update. coordination update publishes working, waiting, blocked, or
paused state for the current agent, with structured workspace-relative file claims.
provide-status-update publishes one concise status for the current assignment.
The status must be one line containing 1 to 240 characters.
annotate adds the Markdown in the assigned content file to any workspace source
line chosen by the agent. Code annotations are optional.
record-task-response reads the assigned Markdown response file and completes the
current assignment. It accepts exactly that one announced workspace-relative path.
`;

export interface AgentToolsIo {
	readonly stdout: { write(chunk: string): unknown };
	readonly stderr: { write(chunk: string): unknown };
}

export interface AgentInvocationEnvironment {
	readonly SUNDIAL_WORKSPACE_CWD?: string;
	readonly SUNDIAL_AGENT_ID?: string;
	readonly SUNDIAL_AGENT_SESSION_ID?: string;
	readonly SUNDIAL_USER_ANNOTATION_ID?: string;
	readonly SUNDIAL_USER_ANNOTATION_FILE?: string;
	readonly SUNDIAL_ASSIGNMENT_SEQUENCE?: string;
}

export interface AnnotateFileInput {
	readonly workspaceCwd: string;
	readonly agentId: string;
	readonly agentSessionId: string;
	readonly userAnnotationId: string;
	readonly originFile: string;
	readonly targetFile: string;
	readonly targetLine: number;
	readonly contentPath: string;
}

export async function annotateFile(input: AnnotateFileInput): Promise<{ readonly files: readonly string[] }> {
	const expectedContentPath = `.sundial/${input.userAnnotationId}newAnnotation.md`;
	if (input.contentPath !== expectedContentPath) {
		throw new Error(`The annotation content path must be exactly ${expectedContentPath}.`);
	}
	const body = await readStableMarkdown(path.join(input.workspaceCwd, ...expectedContentPath.split('/')));
	const agentAnnotationId = `agent-${createHash('sha256').update(JSON.stringify({
		userAnnotationId: input.userAnnotationId,
		agentId: input.agentId,
		agentSessionId: input.agentSessionId,
		file: input.targetFile,
		line: input.targetLine,
		body,
	})).digest('hex').slice(0, 32)}`;
	const files = await writeAgentAnnotationPair({
		workspaceCwd: input.workspaceCwd,
		originFile: input.originFile,
		targetFile: input.targetFile,
		userAnnotationId: input.userAnnotationId,
		agentAnnotationId,
		agentId: input.agentId,
		agentSessionId: input.agentSessionId,
		body,
		createdAt: new Date().toISOString(),
		targetLine: input.targetLine,
	});
	await rm(path.join(input.workspaceCwd, ...expectedContentPath.split('/')));
	return { files };
}

export async function agentToolsMain(
	argv: readonly string[],
	io: AgentToolsIo,
	environment: AgentInvocationEnvironment = process.env,
	update: typeof provideStatusUpdate = provideStatusUpdate,
	recordResponse: typeof recordTaskResponse = recordTaskResponse,
	listCoordination: typeof listCoordinationAgents = listCoordinationAgents,
	publishCoordination: typeof publishCoordinationUpdate = publishCoordinationUpdate,
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
	if (command !== 'coordination' && command !== 'provide-status-update' && command !== 'annotate' && command !== 'record-task-response') {
		io.stderr.write(`Unknown command: ${command}\nRun sundial-agent-tools help for usage.\n`);
		return 2;
	}
	if (command === 'coordination' && args[0] !== 'list' && args[0] !== 'update') {
		io.stderr.write('sundial-agent-tools: coordination requires list or update.\n');
		return 2;
	}
	if (command !== 'annotate' && args.length !== 1) {
		if (command !== 'coordination') {
			io.stderr.write(`sundial-agent-tools: ${command} requires exactly one ${command === 'provide-status-update' ? 'status argument' : 'response-file path'}.\n`);
			return 2;
		}
	}

	try {
		const workspaceCwd = requiredEnvironment(environment.SUNDIAL_WORKSPACE_CWD, 'workspace context');
		if (command === 'coordination' && args[0] === 'list') {
			if (args.length !== 1) {
				throw new Error('coordination list does not accept arguments.');
			}
			io.stdout.write(`${JSON.stringify({ agents: await listCoordination(workspaceCwd) })}\n`);
			return 0;
		}
		const agentSessionId = requiredEnvironment(environment.SUNDIAL_AGENT_SESSION_ID, 'session context');
		if (command === 'coordination') {
			const options = parseCoordinationUpdateArgs(args.slice(1));
			const result = await publishCoordination({
				workspaceCwd,
				agentId: requiredEnvironment(environment.SUNDIAL_AGENT_ID, 'agent context'),
				agentSessionId,
				state: options.state,
				message: options.message,
				files: options.files,
			});
			io.stdout.write(result.appended ? 'Coordination update published.\n' : 'Coordination update is already current.\n');
			return 0;
		}
		const userAnnotationId = requiredEnvironment(environment.SUNDIAL_USER_ANNOTATION_ID, 'assignment context');
		if (command === 'annotate') {
			const options = parseAnnotateArgs(args);
			const result = await annotateFile({
				workspaceCwd,
				agentId: requiredEnvironment(environment.SUNDIAL_AGENT_ID, 'agent context'),
				agentSessionId,
				userAnnotationId,
				originFile: requiredEnvironment(environment.SUNDIAL_USER_ANNOTATION_FILE, 'origin annotation file'),
				targetFile: options.file,
				targetLine: options.line - 1,
				contentPath: options.content,
			});
			io.stdout.write(`${JSON.stringify(result)}\n`);
			return 0;
		}
		const sequenceText = requiredEnvironment(environment.SUNDIAL_ASSIGNMENT_SEQUENCE, 'assignment generation');
		if (!/^[1-9]\d*$/.test(sequenceText) || !Number.isSafeInteger(Number(sequenceText))) {
			throw new Error('The managed assignment context is invalid or stale.');
		}
		if (command === 'record-task-response') {
			const result = await recordResponse({
				workspaceCwd,
				agentId: requiredEnvironment(environment.SUNDIAL_AGENT_ID, 'agent context'),
				userAnnotationId,
				agentSessionId,
				assignmentSequence: Number(sequenceText),
				responsePath: args[0],
			});
			io.stdout.write(`${JSON.stringify(result)}\n`);
			return 0;
		}
		const result = await update({
			workspaceCwd,
			userAnnotationId,
			agentSessionId,
			assignmentSequence: Number(sequenceText),
			status: args[0],
		});
		io.stdout.write(result.appended ? 'Status update published.\n' : 'Status is already current.\n');
		return 0;
	} catch (error) {
		io.stderr.write(`sundial-agent-tools: ${agentFacingError(error, command)}\n`);
		return 1;
	}
}

function requiredEnvironment(value: string | undefined, description: string): string {
	if (value === undefined || value.trim() === '') {
		throw new Error(`No active managed ${description} was provided.`);
	}
	return value;
}

function parseAnnotateArgs(args: readonly string[]): { readonly file: string; readonly line: number; readonly content: string } {
	if (args.length !== 6) {
		throw new Error('annotate requires --file, --line, and --content exactly once.');
	}
	const values = new Map<string, string>();
	for (let index = 0; index < args.length; index += 2) {
		const name = args[index];
		const value = args[index + 1];
		if (!['--file', '--line', '--content'].includes(name) || values.has(name) || value === undefined || value === '' || value.startsWith('--')) {
			throw new Error('annotate requires --file, --line, and --content exactly once.');
		}
		values.set(name, value);
	}
	const lineText = values.get('--line');
	if (lineText === undefined || !/^[1-9]\d*$/.test(lineText) || !Number.isSafeInteger(Number(lineText))) {
		throw new Error('--line must be a positive one-based line number.');
	}
	return { file: values.get('--file')!, line: Number(lineText), content: values.get('--content')! };
}

function parseCoordinationUpdateArgs(args: readonly string[]): {
	readonly state: string;
	readonly message: string;
	readonly files: readonly string[];
} {
	const values = new Map<string, string>();
	const files: string[] = [];
	for (let index = 0; index < args.length; index += 2) {
		const name = args[index];
		const value = args[index + 1];
		if (!['--state', '--message', '--file'].includes(name) || value === undefined || value === '' || value.startsWith('--')
			|| (name !== '--file' && values.has(name))) {
			throw new Error('coordination update requires --state and --message exactly once, plus optional repeated --file paths.');
		}
		if (name === '--file') {
			files.push(value);
		} else {
			values.set(name, value);
		}
	}
	const state = values.get('--state');
	const message = values.get('--message');
	if (state === undefined || message === undefined) {
		throw new Error('coordination update requires --state and --message exactly once, plus optional repeated --file paths.');
	}
	return { state, message, files };
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function agentFacingError(error: unknown, command: 'coordination' | 'provide-status-update' | 'annotate' | 'record-task-response'): string {
	if (error instanceof AgentStoreConflictError) {
		const description = error.code === 'missing_session'
			? 'The managed session is no longer active.'
			: 'The managed assignment is no longer current.';
		return `conflict/${error.code}: ${description}`;
	}
	const message = errorMessage(error);
	return /^(Status must|Coordination|No active managed|The managed assignment context|The response|The annotation|Annotation|The managed assignment|The assignment|Official response|Originating user annotation|--line|annotate requires|coordination)/.test(message)
		? message
		: command === 'coordination'
			? 'Coordination state could not be read or published.'
		: command === 'provide-status-update'
			? 'Status update could not be published for the current assignment.'
			: command === 'annotate'
				? 'Code annotation could not be created.'
				: 'Official response could not be recorded for the current assignment.';
}

if (require.main === module) {
	void agentToolsMain(process.argv.slice(2), process).then(code => { process.exitCode = code; });
}
