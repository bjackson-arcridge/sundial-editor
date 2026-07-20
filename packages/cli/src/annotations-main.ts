import { AgentStoreConflictError, provideStatusUpdate } from './agentStore.js';
import { recordTaskResponse } from './responseRecording.js';
import { packageVersion } from './version.js';

const helpText = `Sundial Annotations CLI ${packageVersion}

Usage:
  sundial-annotations-cli --version
  sundial-annotations-cli help
  sundial-annotations-cli provide-status-update "<status>"
  sundial-annotations-cli record-task-response ".sundial/<UserAnnotationId>response.md"

provide-status-update publishes one concise status for the current assignment.
The status must be one line containing 1 to 240 characters.
record-task-response reads the assigned Markdown response file and completes the
current assignment. It accepts exactly that one announced workspace-relative path.
`;

export interface AgentCliIo {
	readonly stdout: { write(chunk: string): unknown };
	readonly stderr: { write(chunk: string): unknown };
}

export interface AgentInvocationEnvironment {
	readonly SUNDIAL_WORKSPACE_CWD?: string;
	readonly SUNDIAL_AGENT_ID?: string;
	readonly SUNDIAL_AGENT_SESSION_ID?: string;
	readonly SUNDIAL_USER_ANNOTATION_ID?: string;
	readonly SUNDIAL_ASSIGNMENT_SEQUENCE?: string;
}

export async function annotationsMain(
	argv: readonly string[],
	io: AgentCliIo,
	environment: AgentInvocationEnvironment = process.env,
	update: typeof provideStatusUpdate = provideStatusUpdate,
	recordResponse: typeof recordTaskResponse = recordTaskResponse,
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
	if (command !== 'provide-status-update' && command !== 'record-task-response') {
		io.stderr.write(`Unknown command: ${command}\nRun sundial-annotations-cli help for usage.\n`);
		return 2;
	}
	if (args.length !== 1) {
		io.stderr.write(`sundial-annotations-cli: ${command} requires exactly one ${command === 'provide-status-update' ? 'status argument' : 'response-file path'}.\n`);
		return 2;
	}

	try {
		const workspaceCwd = requiredEnvironment(environment.SUNDIAL_WORKSPACE_CWD, 'workspace context');
		const agentSessionId = requiredEnvironment(environment.SUNDIAL_AGENT_SESSION_ID, 'session context');
		const userAnnotationId = requiredEnvironment(environment.SUNDIAL_USER_ANNOTATION_ID, 'assignment context');
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
		io.stderr.write(`sundial-annotations-cli: ${agentFacingError(error, command)}\n`);
		return 1;
	}
}

function requiredEnvironment(value: string | undefined, description: string): string {
	if (value === undefined || value.trim() === '') {
		throw new Error(`No active managed ${description} was provided.`);
	}
	return value;
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function agentFacingError(error: unknown, command: 'provide-status-update' | 'record-task-response'): string {
	if (error instanceof AgentStoreConflictError) {
		const description = error.code === 'missing_session'
			? 'The managed session is no longer active.'
			: 'The managed assignment is no longer current.';
		return `conflict/${error.code}: ${description}`;
	}
	const message = errorMessage(error);
	return /^(Status must|No active managed|The managed assignment context|The response|The managed assignment|The assignment|Official response|Originating user annotation)/.test(message)
		? message
		: command === 'provide-status-update'
			? 'Status update could not be published for the current assignment.'
			: 'Official response could not be recorded for the current assignment.';
}

if (require.main === module) {
	void annotationsMain(process.argv.slice(2), process).then(code => { process.exitCode = code; });
}
