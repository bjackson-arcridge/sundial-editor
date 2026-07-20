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
	listAgents,
	listWork,
	markWorkReady,
	provideStatusUpdate,
	renameAgent,
	requeueWork,
	resetAgentSession,
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
		assert.deepEqual(first.map(agent => [agent.slot, agent.name]), [[1, 'Bob'], [2, 'Amy'], [3, 'Sam'], [4, 'Mike'], [5, 'Ty']]);
		assert.deepEqual(second.map(agent => agent.id), first.map(agent => agent.id));
		await assert.rejects(() => renameAgent({ workspaceCwd: cwd, selector: 2, name: 'bOB' }), /already in use/);
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
		assert.equal(await claimNextWork({ workspaceCwd: cwd, agentSelector: agent.id }), undefined);
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
		assert.equal((await completeWork({ workspaceCwd: cwd, agentId: agent.id, userAnnotationId: reclaimed.id, agentSessionId: session.id, assignmentSequence: reclaimed.assignment.sequence })).status, 'completed');
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
