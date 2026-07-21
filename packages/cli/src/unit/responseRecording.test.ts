import * as assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, test } from 'node:test';
import {
	attachProviderSession,
	claimNextWork,
	enqueueWork,
	ensureAgentSession,
	listAgents,
	markWorkReady,
	prepareResponseEvidence,
	showWork,
} from '../agentStore';
import { appendOfficialResponse, appendUserAnnotation, readUserAnnotations, type UserAnnotation } from '../annotations';
import { recordTaskResponse, requeueWorkWithResponseReconciliation } from '../responseRecording';

const directories: string[] = [];
afterEach(async () => Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true }))));

async function git(cwd: string, args: readonly string[]): Promise<void> {
	await new Promise<void>((resolve, reject) => {
		const child = spawn('git', args, { cwd }); let stderr = '';
		child.stderr.on('data', data => { stderr += String(data); });
		child.once('close', code => code === 0 ? resolve() : reject(new Error(stderr)));
	});
}

async function assigned() {
	const cwd = await mkdtemp(path.join(os.tmpdir(), 'sundial-response-'));
	directories.push(cwd);
	const sourcePath = path.join(cwd, 'src', 'example.ts');
	await mkdir(path.dirname(sourcePath), { recursive: true });
	await writeFile(sourcePath, 'export const value = 1;\n');
	await git(cwd, ['init']); await git(cwd, ['config', 'user.email', 'test@example.com']); await git(cwd, ['config', 'user.name', 'Test']);
	await git(cwd, ['add', '.']); await git(cwd, ['commit', '-m', 'Initial']);
	const sourceUri = pathToFileURL(sourcePath).toString();
	await appendUserAnnotation({
		workspace: { cwd }, document: { uri: sourceUri, line: 0, text: 'export const value = 1;', before: [], after: [] },
		annotation: { id: 'query-1', message: 'Explain this.', preset: '%Q', scope: 'line' },
	});
	const agent = (await listAgents(cwd))[0];
	const session = await ensureAgentSession({ workspaceCwd: cwd, selector: agent.id });
	await attachProviderSession({ workspaceCwd: cwd, agentSessionId: session.id, providerSessionId: 'thread-1' });
	await enqueueWork({
		workspaceCwd: cwd, agentSelector: agent.id, userAnnotationId: 'query-1',
		source: { uri: sourceUri, path: 'src/example.ts', line: 0, text: 'export const value = 1;', before: [], after: [] },
		prompt: { preset: '%Q', scope: 'line', text: 'Explain this.' },
	});
	await markWorkReady({ workspaceCwd: cwd, userAnnotationId: 'query-1' });
	const work = await claimNextWork({ workspaceCwd: cwd, agentSelector: agent.id });
	assert.ok(work?.assignment);
	return {
		cwd, sourceUri, agentId: agent.id, sessionId: session.id, sequence: work.assignment.sequence,
		responsePath: '.sundial/query-1response.md', absoluteResponsePath: path.join(cwd, '.sundial', 'query-1response.md'),
	};
}

async function storedUser(cwd: string, sourceUri: string): Promise<UserAnnotation> {
	const annotation = (await readUserAnnotations({ workspace: { cwd }, document: { uri: sourceUri } })).annotations[0];
	assert.equal(annotation.kind, 'user');
	if (annotation.kind !== 'user') { throw new Error('Expected user annotation.'); }
	return annotation;
}

describe('official response recording', () => {
	test('upgrades the companion, completes work, consumes the handoff, and retries from its receipt', async () => {
		const context = await assigned();
		await writeFile(context.absoluteResponsePath, '# Done\r\n\r\nValidated.\r\n');
		const input = {
			workspaceCwd: context.cwd, agentId: context.agentId, agentSessionId: context.sessionId,
			userAnnotationId: 'query-1', assignmentSequence: context.sequence, responsePath: context.responsePath,
		};
		assert.deepEqual(await recordTaskResponse(input), { file: 'src/example.ts' });
		await assert.rejects(() => readFile(context.absoluteResponsePath), error => (error as NodeJS.ErrnoException).code === 'ENOENT');

		const companion = await readUserAnnotations({ workspace: { cwd: context.cwd }, document: { uri: context.sourceUri } });
		assert.equal(companion.version, 4);
		assert.equal(companion.annotations[0].id, 'query-1');
		const user = await storedUser(context.cwd, context.sourceUri);
		assert.equal(user.officialResponses.length, 1);
		assert.equal(user.officialResponses[0].body, '# Done\n\nValidated.\n');
		assert.equal(user.officialResponses[0].agentId, context.agentId);
		assert.equal(user.officialResponses[0].agentSessionId, context.sessionId);
		const completed = await showWork(context.cwd, 'query-1');
		assert.equal(completed.status, 'completed');
		assert.equal(completed.assignment, undefined);
		assert.equal(completed.pendingResponse?.phase, 'completed');

		assert.deepEqual(await recordTaskResponse(input), { file: 'src/example.ts' });
		assert.equal((await storedUser(context.cwd, context.sourceUri)).officialResponses.length, 1);
		assert.equal((await requeueWorkWithResponseReconciliation({
			workspaceCwd: context.cwd,
			agentId: context.agentId,
			userAnnotationId: 'query-1',
			agentSessionId: context.sessionId,
			assignmentSequence: context.sequence,
			reason: 'Provider exited after recording the response.',
		})).status, 'completed');
	});

	test('rejects alternate paths, symlinks, empty content, and changed content after completion without consuming it', async () => {
		const alternate = await assigned();
		await writeFile(alternate.absoluteResponsePath, 'Answer.');
		await assert.rejects(() => recordTaskResponse({
			workspaceCwd: alternate.cwd, agentId: alternate.agentId, agentSessionId: alternate.sessionId,
			userAnnotationId: 'query-1', assignmentSequence: alternate.sequence, responsePath: '.sundial/other.md',
		}), /must be exactly/);

		await rm(alternate.absoluteResponsePath);
		await writeFile(path.join(alternate.cwd, 'target.md'), 'Answer.');
		await symlink(path.join(alternate.cwd, 'target.md'), alternate.absoluteResponsePath);
		await assert.rejects(() => recordTaskResponse({
			workspaceCwd: alternate.cwd, agentId: alternate.agentId, agentSessionId: alternate.sessionId,
			userAnnotationId: 'query-1', assignmentSequence: alternate.sequence, responsePath: alternate.responsePath,
		}));

		await rm(alternate.absoluteResponsePath);
		await writeFile(alternate.absoluteResponsePath, '   \n');
		await assert.rejects(() => recordTaskResponse({
			workspaceCwd: alternate.cwd, agentId: alternate.agentId, agentSessionId: alternate.sessionId,
			userAnnotationId: 'query-1', assignmentSequence: alternate.sequence, responsePath: alternate.responsePath,
		}), /non-whitespace/);
		await writeFile(alternate.absoluteResponsePath, Buffer.from([0xff, 0xfe]));
		await assert.rejects(() => recordTaskResponse({
			workspaceCwd: alternate.cwd, agentId: alternate.agentId, agentSessionId: alternate.sessionId,
			userAnnotationId: 'query-1', assignmentSequence: alternate.sequence, responsePath: alternate.responsePath,
		}), /valid UTF-8/);
		await writeFile(alternate.absoluteResponsePath, 'Before\0after');
		await assert.rejects(() => recordTaskResponse({
			workspaceCwd: alternate.cwd, agentId: alternate.agentId, agentSessionId: alternate.sessionId,
			userAnnotationId: 'query-1', assignmentSequence: alternate.sequence, responsePath: alternate.responsePath,
		}), /NUL/);

		await writeFile(alternate.absoluteResponsePath, 'Original.');
		const input = {
			workspaceCwd: alternate.cwd, agentId: alternate.agentId, agentSessionId: alternate.sessionId,
			userAnnotationId: 'query-1', assignmentSequence: alternate.sequence, responsePath: alternate.responsePath,
		};
		await recordTaskResponse(input);
		await writeFile(alternate.absoluteResponsePath, 'Changed.');
		await assert.rejects(() => recordTaskResponse(input), /different content/);
		assert.equal(await readFile(alternate.absoluteResponsePath, 'utf8'), 'Changed.');
	});

	test('reconciles a companion write that became durable before work completion without duplication', async () => {
		const context = await assigned();
		const body = 'Recovered response.\n';
		await writeFile(context.absoluteResponsePath, body);
		const evidenceInput = {
			workspaceCwd: context.cwd, agentId: context.agentId, userAnnotationId: 'query-1',
			agentSessionId: context.sessionId, assignmentSequence: context.sequence,
			path: context.responsePath, bodyDigest: createHash('sha256').update(body).digest('hex'),
			sourceUri: context.sourceUri, file: 'src/example.ts',
		};
		const evidence = await prepareResponseEvidence(evidenceInput);
		await appendOfficialResponse({
			workspaceCwd: context.cwd,
			sourceUri: context.sourceUri,
			response: {
				userAnnotationId: 'query-1', agentId: context.agentId, agentSessionId: context.sessionId,
				body, createdAt: evidence.createdAt,
			},
		});
		const completed = await requeueWorkWithResponseReconciliation({
			workspaceCwd: context.cwd, agentId: context.agentId, userAnnotationId: 'query-1',
			agentSessionId: context.sessionId, assignmentSequence: context.sequence,
			reason: 'Provider exited before returning the result.',
		});
		assert.equal(completed.status, 'completed');
		await assert.rejects(() => readFile(context.absoluteResponsePath), error => (error as NodeJS.ErrnoException).code === 'ENOENT');
		assert.equal((await storedUser(context.cwd, context.sourceUri)).officialResponses.length, 1);
	});
});
