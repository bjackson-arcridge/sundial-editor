import { constants } from 'node:fs';
import { open, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	AgentStoreConflictError,
	completeWork,
	markResponseRecorded,
	prepareResponseEvidence,
	requeueWork,
	showWork,
	type PendingResponseEvidence,
	type UserAnnotationWorkItem,
} from './agentStore.js';
import { appendOfficialResponse, readUserAnnotations, type OfficialResponse } from './annotations.js';

export interface RecordTaskResponseInput {
	readonly workspaceCwd: string;
	readonly agentId: string;
	readonly agentSessionId: string;
	readonly userAnnotationId: string;
	readonly assignmentSequence: number;
	readonly responsePath: string;
}

export interface RecordTaskResponseResult {
	readonly file: string;
}

export async function recordTaskResponse(input: RecordTaskResponseInput): Promise<RecordTaskResponseResult> {
	const work = await showWork(input.workspaceCwd, input.userAnnotationId);
	const expectedPath = responsePathFor(input.userAnnotationId);
	if (input.responsePath !== expectedPath) {
		throw new AgentStoreConflictError('response_conflict', `The response path must be exactly ${expectedPath}.`, work);
	}
	const sourceFile = normalizedSourceFile(input.workspaceCwd, work);
	const completed = completedEvidence(work, input);
	if (completed !== undefined) {
		await cleanCompletedHandoff(input.workspaceCwd, expectedPath, completed.bodyDigest);
		return { file: completed.receipt!.file };
	}
	if (work.agentId !== input.agentId
		|| work.status !== 'working'
		|| work.assignment?.sessionId !== input.agentSessionId
		|| work.assignment.sequence !== input.assignmentSequence) {
		throw new AgentStoreConflictError('stale_assignment', 'The managed assignment is no longer current.', work);
	}

	const body = await readStableResponse(path.join(input.workspaceCwd, ...expectedPath.split('/')));
	const bodyDigest = digest(body);
	const evidenceInput = {
		workspaceCwd: input.workspaceCwd,
		agentId: input.agentId,
		userAnnotationId: input.userAnnotationId,
		agentSessionId: input.agentSessionId,
		assignmentSequence: input.assignmentSequence,
		path: expectedPath,
		bodyDigest,
		sourceUri: work.source.uri,
		file: sourceFile,
	};
	const evidence = await prepareResponseEvidence(evidenceInput);
	const response = responseFrom(work, evidence, body);
	await appendOfficialResponse({ workspaceCwd: input.workspaceCwd, sourceUri: work.source.uri, response });
	await markResponseRecorded({ ...evidenceInput, createdAt: evidence.createdAt });
	await completeWork({
		workspaceCwd: input.workspaceCwd,
		agentId: input.agentId,
		userAnnotationId: input.userAnnotationId,
		agentSessionId: input.agentSessionId,
		assignmentSequence: input.assignmentSequence,
		finalUpdate: 'Official response recorded.',
	});
	await rm(path.join(input.workspaceCwd, ...expectedPath.split('/')));
	return { file: sourceFile };
}

export async function requeueWorkWithResponseReconciliation(input: {
	readonly workspaceCwd: string;
	readonly agentId: string;
	readonly userAnnotationId: string;
	readonly agentSessionId: string;
	readonly assignmentSequence: number;
	readonly reason: string;
}): Promise<UserAnnotationWorkItem> {
	let work = await showWork(input.workspaceCwd, input.userAnnotationId);
	const evidence = work.pendingResponse;
	if (work.status === 'completed' && evidence?.phase === 'completed') {
		if (work.agentId !== input.agentId
			|| evidence.assignment.sessionId !== input.agentSessionId
			|| evidence.assignment.sequence !== input.assignmentSequence) {
			throw new AgentStoreConflictError('stale_assignment', 'The completed response receipt belongs to another assignment.', work);
		}
		await cleanCompletedHandoff(input.workspaceCwd, evidence.path, evidence.bodyDigest);
		return work;
	}
	if (work.status === 'working' && evidence?.phase === 'prepared'
		&& evidence.assignment.sessionId === input.agentSessionId
		&& evidence.assignment.sequence === input.assignmentSequence) {
		if (await containsEvidenceResponse(input.workspaceCwd, work, evidence)) {
			work = await markResponseRecorded({
				...input,
				path: evidence.path,
				bodyDigest: evidence.bodyDigest,
				sourceUri: evidence.sourceUri,
				file: evidence.file,
				createdAt: evidence.createdAt,
			});
		}
	}
	const result = await requeueWork(input);
	if (result.status === 'completed' && result.pendingResponse?.phase === 'completed') {
		await cleanCompletedHandoff(input.workspaceCwd, result.pendingResponse.path, result.pendingResponse.bodyDigest);
	}
	return result;
}

export function responsePathFor(userAnnotationId: string): string {
	if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(userAnnotationId)) {
		throw new Error('The managed assignment has an invalid user annotation identity.');
	}
	return `.sundial/${userAnnotationId}response.md`;
}

function responseFrom(work: UserAnnotationWorkItem, evidence: PendingResponseEvidence, body: string): OfficialResponse {
	return {
		userAnnotationId: work.id,
		agentId: work.agentId,
		agentSessionId: evidence.assignment.sessionId,
		body,
		createdAt: evidence.createdAt,
	};
}

async function containsEvidenceResponse(
	workspaceCwd: string,
	work: UserAnnotationWorkItem,
	evidence: PendingResponseEvidence,
): Promise<boolean> {
	const companion = await readUserAnnotations({ workspace: { cwd: workspaceCwd }, document: { uri: work.source.uri } });
	return companion.annotations.find(annotation => annotation.id === work.id)?.officialResponses.some(response =>
		response.userAnnotationId === work.id
		&& response.agentId === work.agentId
		&& response.agentSessionId === evidence.assignment.sessionId
		&& response.createdAt === evidence.createdAt
		&& digest(response.body) === evidence.bodyDigest) === true;
}

function completedEvidence(work: UserAnnotationWorkItem, input: RecordTaskResponseInput): PendingResponseEvidence | undefined {
	const evidence = work.pendingResponse;
	if (work.status !== 'completed' || evidence?.phase !== 'completed') {
		return undefined;
	}
	if (work.agentId !== input.agentId
		|| evidence.assignment.sessionId !== input.agentSessionId
		|| evidence.assignment.sequence !== input.assignmentSequence
		|| evidence.path !== input.responsePath) {
		throw new AgentStoreConflictError('stale_assignment', 'The completed response receipt belongs to another assignment.', work);
	}
	return evidence;
}

async function cleanCompletedHandoff(workspaceCwd: string, responsePath: string, expectedDigest: string): Promise<void> {
	const absolute = path.join(workspaceCwd, ...responsePath.split('/'));
	let body: string;
	try {
		body = await readStableResponse(absolute);
	} catch (error) {
		if (nodeCode(error) === 'ENOENT') {
			return;
		}
		throw error;
	}
	if (digest(body) !== expectedDigest) {
		throw new AgentStoreConflictError('response_conflict', 'The completed response path now contains different content and was preserved.');
	}
	await rm(absolute);
}

async function readStableResponse(file: string): Promise<string> {
	const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
	try {
		const before = await handle.stat({ bigint: true });
		if (!before.isFile()) {
			throw new Error('The response path must identify a regular file.');
		}
		const bytes = await handle.readFile();
		const after = await handle.stat({ bigint: true });
		if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size
			|| before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs) {
			throw new Error('The response file changed while it was being read.');
		}
		let body: string;
		try {
			body = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
		} catch {
			throw new Error('The response file must contain valid UTF-8.');
		}
		body = body.replace(/\r\n?/g, '\n');
		if (body.includes('\0')) {
			throw new Error('The response file must not contain NUL bytes.');
		}
		if (body.trim() === '') {
			throw new Error('The response file must contain non-whitespace Markdown.');
		}
		return body;
	} finally {
		await handle.close();
	}
}

function digest(body: string): string {
	return createHash('sha256').update(body, 'utf8').digest('hex');
}

function normalizedSourceFile(workspaceCwd: string, work: UserAnnotationWorkItem): string {
	if (work.source.path !== undefined) {
		return work.source.path.replaceAll('\\', '/');
	}
	const relative = path.relative(path.resolve(workspaceCwd), fileURLToPath(new URL(work.source.uri)));
	if (relative === '' || path.isAbsolute(relative) || relative === '..' || relative.startsWith(`..${path.sep}`)) {
		throw new Error('The assignment source is outside the managed workspace.');
	}
	return relative.split(path.sep).join('/');
}

function nodeCode(error: unknown): string | undefined {
	return error instanceof Error && 'code' in error ? String(error.code) : undefined;
}
