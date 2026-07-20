import * as assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { annotationsMain } from '../annotations-main';

function io() {
	const stdout: string[] = [];
	const stderr: string[] = [];
	return { stdout, stderr, value: { stdout: { write: (chunk: string) => stdout.push(chunk) }, stderr: { write: (chunk: string) => stderr.push(chunk) } } };
}

describe('agent-facing annotations CLI', () => {
	test('advertises only the status-update operation', async () => {
		const run = io();
		assert.equal(await annotationsMain(['help'], run.value), 0);
		assert.match(run.stdout.join(''), /provide-status-update/);
		assert.doesNotMatch(run.stdout.join(''), /enqueue|claim|complete|reset|transcript/);
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
