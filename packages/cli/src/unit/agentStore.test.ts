import * as assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, test } from 'node:test';
import {
	attachProviderSession,
	claimNextWork,
	completeWork,
	enqueueWork,
	ensureAgentSession,
	listCoordinationAgents,
	listAgents,
	listWork,
	markWorkReady,
	markResponseRecorded,
	prepareResponseEvidence,
	provideStatusUpdate,
	publishCoordinationUpdate,
	renameAgent,
	requeueWork,
	resetAgentSession,
	sessionFilePath,
	showAgent,
	showWork,
} from '../agentStore';

const directories: string[] = [];
async function workspace(): Promise<string> { const cwd = await mkdtemp(path.join(os.tmpdir(), 'sundial-agent-store-')); directories.push(cwd); return cwd; }
afterEach(async () => Promise.all(directories.splice(0).map(cwd => rm(cwd, { recursive: true, force: true }))));
const source = { uri: 'file:///workspace/a.ts', path: 'a.ts', line: 2, text: 'code', before: ['before'], after: ['after'] } as const;
const prompt = { preset: '%F', scope: 'line', text: 'Fix it.' } as const;

describe('persistent agent store', () => {
	test('creates stable named slots and enforces case-insensitive rename uniqueness', async () => {
		const cwd = await workspace();
		const first = await listAgents(cwd); const second = await listAgents(cwd);
		assert.deepEqual(first.map(agent => [agent.slot, agent.name]), [[1, 'Cloe'], [2, 'Amy'], [3, 'Sam'], [4, 'Mike'], [5, 'Ty']]);
		assert.deepEqual(second.map(agent => agent.id), first.map(agent => agent.id));
		await assert.rejects(() => renameAgent({ workspaceCwd: cwd, selector: 2, name: 'Cloe' }), /already in use/);
		assert.equal((await renameAgent({ workspaceCwd: cwd, selector: 1, name: 'Builder' })).name, 'Builder');
	});

	test('gates claims on durable annotations and preserves per-agent FIFO', async () => {
		const cwd = await workspace(); const agent = (await listAgents(cwd))[0];
		const session = await ensureAgentSession({ workspaceCwd: cwd, selector: agent.id });
		await attachProviderSession({ workspaceCwd: cwd, agentSessionId: session.id, providerSessionId: 'thread-1' });
		const first = await enqueueWork({ workspaceCwd: cwd, agentSelector: agent.id, userAnnotationId: 'work-1', source, prompt });
		await new Promise(resolve => setTimeout(resolve, 2));
		await enqueueWork({ workspaceCwd: cwd, agentSelector: agent.id, userAnnotationId: 'work-2', source, prompt: { ...prompt, text: 'Second.' } });
		assert.equal(await claimNextWork({ workspaceCwd: cwd, agentSelector: agent.id }), undefined);
		await markWorkReady({ workspaceCwd: cwd, userAnnotationId: 'work-2' });
		await markWorkReady({ workspaceCwd: cwd, userAnnotationId: first.id });
		assert.equal((await claimNextWork({ workspaceCwd: cwd, agentSelector: agent.id }))?.id, 'work-1');
		assert.equal((await showAgent(cwd, agent.id)).coordination?.state, 'working');
		assert.equal(await claimNextWork({ workspaceCwd: cwd, agentSelector: agent.id }), undefined);
	});

	test('persists ordered coordination histories, normalizes claims, and exposes identity-safe projections', async () => {
		const cwd = await workspace();
		const [agent, peer] = await listAgents(cwd);
		const session = await ensureAgentSession({ workspaceCwd: cwd, selector: agent.id });
		await attachProviderSession({ workspaceCwd: cwd, agentSessionId: session.id, providerSessionId: 'thread-1' });
		assert.equal((await showAgent(cwd, agent.id)).coordination?.state, 'waiting');

		const first = await publishCoordinationUpdate({
			workspaceCwd: cwd,
			agentId: agent.id,
			agentSessionId: session.id,
			state: 'working',
			message: 'Editing shared code.',
			files: ['./src/a.ts', 'src\\b.ts', 'src/a.ts'],
		});
		assert.equal(first.appended, true);
		assert.deepEqual(first.update.files, ['src/a.ts', 'src/b.ts']);
		assert.equal((await publishCoordinationUpdate({
			workspaceCwd: cwd,
			agentId: agent.id,
			agentSessionId: session.id,
			state: 'working',
			message: 'Editing shared code.',
			files: ['src/a.ts', 'src/b.ts'],
		})).appended, false);

		for (const state of ['waiting', 'blocked', 'paused'] as const) {
			await publishCoordinationUpdate({
				workspaceCwd: cwd,
				agentId: agent.id,
				agentSessionId: session.id,
				state,
				message: `${state} update`,
				files: [],
			});
		}
		const projection = await listCoordinationAgents(cwd);
		assert.deepEqual(projection.map(item => [item.slot, item.name]), [[agent.slot, agent.name], [peer.slot, peer.name], [3, 'Sam'], [4, 'Mike'], [5, 'Ty']]);
		assert.equal(projection[0].update?.state, 'paused');
		assert.equal('id' in projection[0], false);

		const stored = JSON.parse(await readFile(sessionFilePath(cwd, session.id), 'utf8'));
		assert.deepEqual(stored.coordinationUpdates.map((update: { state: string }) => update.state), [
			'waiting', 'working', 'waiting', 'blocked', 'paused',
		]);
		await assert.rejects(() => publishCoordinationUpdate({
			workspaceCwd: cwd,
			agentId: agent.id,
			agentSessionId: session.id,
			state: 'working',
			message: 'Unsafe.',
			files: ['../outside.ts'],
		}), /workspace-relative/);
		await assert.rejects(() => publishCoordinationUpdate({
			workspaceCwd: cwd,
			agentId: peer.id,
			agentSessionId: session.id,
			state: 'working',
			message: 'Impersonating.',
			files: [],
		}), /no longer active/);
	});

	test('serializes concurrent coordination publications without losing history', async () => {
		const cwd = await workspace();
		const agent = (await listAgents(cwd))[0];
		const session = await ensureAgentSession({ workspaceCwd: cwd, selector: agent.id });
		await attachProviderSession({ workspaceCwd: cwd, agentSessionId: session.id, providerSessionId: 'thread-1' });
		await Promise.all(['First update.', 'Second update.'].map(message => publishCoordinationUpdate({
			workspaceCwd: cwd,
			agentId: agent.id,
			agentSessionId: session.id,
			state: 'working',
			message,
			files: ['src/a.ts'],
		})));
		const stored = JSON.parse(await readFile(sessionFilePath(cwd, session.id), 'utf8'));
		assert.equal(stored.coordinationUpdates.length, 3);
		assert.deepEqual(new Set(stored.coordinationUpdates.slice(1).map((update: { message: string }) => update.message)), new Set(['First update.', 'Second update.']));
	});

	test('adopts pre-coordination version-1 sessions without discarding runtime state', async () => {
		const cwd = await workspace();
		const agent = (await listAgents(cwd))[0];
		const session = await ensureAgentSession({ workspaceCwd: cwd, selector: agent.id });
		await attachProviderSession({ workspaceCwd: cwd, agentSessionId: session.id, providerSessionId: 'thread-1' });
		const file = sessionFilePath(cwd, session.id);
		const legacy = JSON.parse(await readFile(file, 'utf8'));
		delete legacy.coordinationUpdates;
		await writeFile(file, `${JSON.stringify(legacy, null, 2)}\n`);

		assert.equal((await showAgent(cwd, agent.id)).coordination?.state, 'waiting');
		await publishCoordinationUpdate({
			workspaceCwd: cwd,
			agentId: agent.id,
			agentSessionId: session.id,
			state: 'working',
			message: 'Continuing upgraded work.',
			files: ['src/a.ts'],
		});
		const upgraded = JSON.parse(await readFile(file, 'utf8'));
		assert.deepEqual(upgraded.coordinationUpdates.map((update: { state: string }) => update.state), ['waiting', 'working']);
		assert.equal(upgraded.providerSessionId, 'thread-1');
	});

	test('accepts new queue work only for persisted available sessions', async () => {
		const cwd = await workspace(); const agent = (await listAgents(cwd))[0];
		await assert.rejects(
			() => enqueueWork({ workspaceCwd: cwd, agentSelector: agent.id, userAnnotationId: 'work-1', source, prompt }),
			/managed session/,
		);
		const session = await ensureAgentSession({ workspaceCwd: cwd, selector: agent.id });
		await assert.rejects(
			() => enqueueWork({ workspaceCwd: cwd, agentSelector: agent.id, userAnnotationId: 'work-1', source, prompt }),
			/active provider session/,
		);
		await attachProviderSession({ workspaceCwd: cwd, agentSessionId: session.id, providerSessionId: 'thread-1' });
		const queued = await enqueueWork({ workspaceCwd: cwd, agentSelector: agent.id, userAnnotationId: 'work-1', source, prompt });
		await resetAgentSession({ workspaceCwd: cwd, selector: agent.id });
		assert.equal(
			(await enqueueWork({ workspaceCwd: cwd, agentSelector: agent.id, userAnnotationId: queued.id, source, prompt })).id,
			queued.id,
			'an already-reserved identity remains idempotent after session replacement',
		);
	});

	test('validates assignment generations, coalesces status retry, and transitions/requeues', async () => {
		const cwd = await workspace(); const agent = (await listAgents(cwd))[0];
		const session = await ensureAgentSession({ workspaceCwd: cwd, selector: agent.id });
		await attachProviderSession({ workspaceCwd: cwd, agentSessionId: session.id, providerSessionId: 'thread-1' });
		await enqueueWork({ workspaceCwd: cwd, agentSelector: agent.id, userAnnotationId: 'work-1', source, prompt });
		await markWorkReady({ workspaceCwd: cwd, userAnnotationId: 'work-1' });
		const claimed = await claimNextWork({ workspaceCwd: cwd, agentSelector: agent.id }); assert.ok(claimed?.assignment);
		const assignment = { workspaceCwd: cwd, userAnnotationId: claimed.id, agentSessionId: session.id, assignmentSequence: claimed.assignment.sequence };
		const editorAssignment = { ...assignment, agentId: agent.id };
		assert.equal((await provideStatusUpdate({ ...assignment, status: 'Running tests' })).appended, true);
		assert.equal((await provideStatusUpdate({ ...assignment, status: ' Running tests ' })).appended, false);
		await assert.rejects(() => provideStatusUpdate({ ...assignment, assignmentSequence: assignment.assignmentSequence + 1, status: 'Stale' }), /stale/);
		assert.equal((await requeueWork({ ...editorAssignment, reason: 'Provider failed.' })).status, 'waiting');
		const reclaimed = await claimNextWork({ workspaceCwd: cwd, agentSelector: agent.id }); assert.ok(reclaimed?.assignment);
		const responseAttempt = {
			workspaceCwd: cwd, agentId: agent.id, userAnnotationId: reclaimed.id, agentSessionId: session.id,
			assignmentSequence: reclaimed.assignment.sequence, path: `.sundial/${reclaimed.id}response.md`,
			bodyDigest: 'a'.repeat(64), sourceUri: source.uri, file: source.path,
		};
		await assert.rejects(() => completeWork(responseAttempt), /requires a matching durable official response/);
		const evidence = await prepareResponseEvidence(responseAttempt);
		await markResponseRecorded({ ...responseAttempt, createdAt: evidence.createdAt });
		const completed = await completeWork(responseAttempt);
		assert.equal(completed.status, 'completed');
		assert.equal(completed.assignment, undefined);
		assert.equal(completed.pendingResponse?.phase, 'completed');
	});

	test('reset removes only the provider session, requeues work, and malformed files remain untouched', async () => {
		const cwd = await workspace(); const agent = (await listAgents(cwd))[0];
		const session = await ensureAgentSession({ workspaceCwd: cwd, selector: agent.id });
		await attachProviderSession({ workspaceCwd: cwd, agentSessionId: session.id, providerSessionId: 'thread-1' });
		await enqueueWork({ workspaceCwd: cwd, agentSelector: agent.id, userAnnotationId: 'work-1', source, prompt }); await markWorkReady({ workspaceCwd: cwd, userAnnotationId: 'work-1' }); await claimNextWork({ workspaceCwd: cwd, agentSelector: agent.id });
		const replacement = await resetAgentSession({ workspaceCwd: cwd, selector: agent.id });
		assert.notEqual(replacement.session.id, session.id); assert.equal((await showWork(cwd, 'work-1')).status, 'waiting');

		const malformedPath = path.join(cwd, '.sundial', 'agents', 'work', 'broken.json'); await writeFile(malformedPath, '{"broken":true}\n'); const before = await readFile(malformedPath, 'utf8');
		await assert.rejects(() => listWork(cwd), /Malformed/); assert.equal(await readFile(malformedPath, 'utf8'), before);
	});
});
