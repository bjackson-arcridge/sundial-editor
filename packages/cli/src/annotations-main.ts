import { AgentStoreConflictError, provideStatusUpdate } from './agentStore.js';

const packageVersion = '0.3.0';

const helpText = `Sundial Annotations CLI ${packageVersion}

Usage:
  sundial-annotations-cli --version
  sundial-annotations-cli help
  sundial-annotations-cli provide-status-update "<status>"

provide-status-update publishes one concise status for the current assignment.
The status must be one line containing 1 to 240 characters.
`;

export interface AgentCliIo {
	readonly stdout: { write(chunk: string): unknown };
	readonly stderr: { write(chunk: string): unknown };
}

export interface AgentInvocationEnvironment {
	readonly SUNDIAL_WORKSPACE_CWD?: string;
	readonly SUNDIAL_AGENT_SESSION_ID?: string;
	readonly SUNDIAL_USER_ANNOTATION_ID?: string;
	readonly SUNDIAL_ASSIGNMENT_SEQUENCE?: string;
}

export async function annotationsMain(
	argv: readonly string[],
	io: AgentCliIo,
	environment: AgentInvocationEnvironment = process.env,
	update: typeof provideStatusUpdate = provideStatusUpdate,
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
	if (command !== 'provide-status-update') {
		io.stderr.write(`Unknown command: ${command}\nRun sundial-annotations-cli help for usage.\n`);
		return 2;
	}
	if (args.length !== 1) {
		io.stderr.write('sundial-annotations-cli: provide-status-update requires exactly one status argument.\n');
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
			io.stderr.write(`sundial-annotations-cli: ${agentFacingError(error)}\n`);
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

function agentFacingError(error: unknown): string {
	if (error instanceof AgentStoreConflictError) {
		const description = error.code === 'missing_session'
			? 'The managed session is no longer active.'
			: 'The managed assignment is no longer current.';
		return `conflict/${error.code}: ${description}`;
	}
	const message = errorMessage(error);
	return /^(Status must|No active managed|The managed assignment context)/.test(message)
		? message
		: 'Status update could not be published for the current assignment.';
}

if (require.main === module) {
	void annotationsMain(process.argv.slice(2), process).then(code => { process.exitCode = code; });
}
