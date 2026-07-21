import * as assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, test } from 'node:test';
import { annotationsMain } from '../annotations-main';
import { appendUserAnnotation, readUserAnnotations } from '../annotations';

function io() {
	const stdout: string[] = [];
	const stderr: string[] = [];
	return { stdout, stderr, value: { stdout: { write: (chunk: string) => stdout.push(chunk) }, stderr: { write: (chunk: string) => stderr.push(chunk) } } };
}

describe('agent-facing annotations CLI', () => {
	test('advertises only the three managed-agent operations', async () => {
		const run = io();
		assert.equal(await annotationsMain(['help'], run.value), 0);
		assert.match(run.stdout.join(''), /provide-status-update/);
		assert.match(run.stdout.join(''), /record-task-response/);
		assert.match(run.stdout.join(''), /annotate --file/);
		assert.doesNotMatch(run.stdout.join(''), /enqueue|claim|reset|transcript/);
	});

	test('creates an annotation from turn context without consulting assignment lifecycle state', async () => {
		const cwd = await mkdtemp(path.join(os.tmpdir(), 'sundial-annotate-cli-'));
		try {
			const source = path.join(cwd, 'src.ts');
			await writeFile(source, 'first\nsecond\n');
			const sourceUri = pathToFileURL(source).toString();
			await appendUserAnnotation({
				workspace: { cwd }, document: { uri: sourceUri, line: 0 },
				annotation: { id: 'work-1', message: 'Review this.', preset: '%Q', scope: 'line' },
			});
			await writeFile(path.join(cwd, '.sundial', 'work-1newAnnotation.md'), 'Agent note.');
			const run = io();
			assert.equal(await annotationsMain([
				'annotate', '--file', 'src.ts', '--line', '2', '--content', '.sundial/work-1newAnnotation.md',
			], run.value, {
				SUNDIAL_WORKSPACE_CWD: cwd, SUNDIAL_AGENT_ID: 'agent-1', SUNDIAL_AGENT_SESSION_ID: 'session-1',
				SUNDIAL_USER_ANNOTATION_ID: 'work-1', SUNDIAL_USER_ANNOTATION_FILE: 'src.ts',
			}), 0, run.stderr.join(''));
			assert.deepEqual(JSON.parse(run.stdout.join('')), { files: ['src.ts'] });
			const companion = await readUserAnnotations({ workspace: { cwd }, document: { uri: sourceUri } });
			assert.deepEqual(companion.annotations.map(annotation => annotation.kind), ['user', 'agent']);
		} finally {
			await rm(cwd, { recursive: true, force: true });
		}
	});

	test('records a response using only hidden assignment context and one path', async () => {
		const run = io();
		let received: unknown;
		assert.equal(await annotationsMain(['record-task-response', '.sundial/work-1response.md'], run.value, {
			SUNDIAL_WORKSPACE_CWD: '/workspace', SUNDIAL_AGENT_ID: 'agent-1',
			SUNDIAL_AGENT_SESSION_ID: 'session-1', SUNDIAL_USER_ANNOTATION_ID: 'work-1',
			SUNDIAL_ASSIGNMENT_SEQUENCE: '4',
		}, async () => ({ appended: false, work: {} as never }), async input => {
			received = input;
			return { file: 'src/example.ts' };
		}), 0);
		assert.deepEqual(received, {
			workspaceCwd: '/workspace', agentId: 'agent-1', agentSessionId: 'session-1',
			userAnnotationId: 'work-1', assignmentSequence: 4, responsePath: '.sundial/work-1response.md',
		});
		assert.deepEqual(JSON.parse(run.stdout.join('')), { file: 'src/example.ts' });
	});

	test('resolves hidden assignment evidence from the invocation environment', async () => {
		const run = io();
		let received: unknown;
		assert.equal(await annotationsMain(['provide-status-update', ' Running focused tests '], run.value, {
			SUNDIAL_WORKSPACE_CWD: '/workspace',
			SUNDIAL_AGENT_SESSION_ID: 'session-1',
			SUNDIAL_USER_ANNOTATION_ID: 'work-1',
			SUNDIAL_ASSIGNMENT_SEQUENCE: '4',
		}, async input => {
			received = input;
			return { appended: true, work: {} as never };
		}), 0);
		assert.deepEqual(received, {
			workspaceCwd: '/workspace', agentSessionId: 'session-1', userAnnotationId: 'work-1',
			assignmentSequence: 4, status: ' Running focused tests ',
		});
		assert.equal(run.stdout.join(''), 'Status update published.\n');
	});

	test('rejects missing context, extra arguments, and unknown controls', async () => {
		const missing = io();
		assert.equal(await annotationsMain(['provide-status-update', 'Working'], missing.value, {}), 1);
		assert.match(missing.stderr.join(''), /No active managed/);
		const extra = io();
		assert.equal(await annotationsMain(['provide-status-update', 'One', 'Two'], extra.value), 2);
		const unknown = io();
		assert.equal(await annotationsMain(['reset'], unknown.value), 2);
	});
});
