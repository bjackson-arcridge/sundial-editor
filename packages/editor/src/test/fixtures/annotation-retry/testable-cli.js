// Stateful test CLI with a one-shot durable-annotation failure.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { fileURLToPath } = require('node:url');

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { input += chunk; });
process.stdin.on('end', () => {
	const request = JSON.parse(input);
	const [command, operation, action] = process.argv.slice(2);
	if (command === 'annotations') {
		handleAnnotations(operation, request);
		return;
	}
	if (command === 'agent') {
		handleAgent(operation, action, request);
		return;
	}
	if (command === 'prompt') {
		const countPath = path.join(process.cwd(), 'delivery-count.txt');
		const count = fs.existsSync(countPath) ? Number(fs.readFileSync(countPath, 'utf8')) : 0;
		fs.writeFileSync(countPath, String(count + 1));
		recordFixtureResponse(request);
		process.stdout.write(`${JSON.stringify({ kind: 'status', status: 'waiting' })}\n`);
		return;
	}
	process.exitCode = 2;
});

function handleAgent(operation, action, request) {
	const state = readState();
	if (operation === 'list') {
		writeJson({ agents: [agentProjection(state)] });
		return;
	}
	if (operation === 'session' && action === 'ensure') {
		writeJson({ agent: agentProjection(state), session: { id: 'session-bob' } });
		return;
	}
	if (operation !== 'work') {
		process.exitCode = 2;
		return;
	}
	if (action === 'list') {
		writeJson({ work: state.work });
		return;
	}
	if (action === 'enqueue') {
		const at = now();
		const update = { at, kind: 'enqueued', message: 'Queued for Bob.' };
		const work = {
			id: request.work.userAnnotationId ?? `retry-work-${state.nextId++}`,
			agentId: request.agent.id,
			status: 'waiting',
			ready: false,
			enqueuedAt: at,
			updatedAt: at,
			latestUpdate: update,
			source: { ...request.work.source, ...anchorForRequest({ document: request.work.source }) },
			prompt: request.work.prompt,
			updates: [update],
		};
		state.work.push(work);
		writeState(state);
		writeJson(work);
		return;
	}
	if (action === 'ready') {
		const work = findWork(state, request.work.id);
		work.ready = true;
		addUpdate(work, 'ready', 'Durable annotation saved; work is ready.');
		writeState(state);
		writeJson(work);
		return;
	}
	if (action === 'claim') {
		const work = state.work.find(item => item.agentId === request.agent.id && item.status === 'waiting' && item.ready);
		if (work === undefined) {
			writeJson({ work: null });
			return;
		}
		const at = now();
		const sequence = ++state.assignmentSequence;
		const update = { at, kind: 'claimed', message: 'Assigned to Bob.' };
		work.status = 'working';
		work.assignment = { sessionId: 'session-bob', sequence, claimedAt: at };
		work.updatedAt = at;
		work.latestUpdate = update;
		work.updates.push(update);
		writeState(state);
		writeJson({ work });
		return;
	}
	if (action === 'complete') {
		const work = findWork(state, request.work.id);
		work.status = 'completed';
		addUpdate(work, 'completed', request.work.finalUpdate ?? 'Completed assignment.');
		writeState(state);
		writeJson(work);
		return;
	}
	if (action === 'requeue') {
		const work = findWork(state, request.work.id);
		if (work.status === 'completed') {
			writeJson(work);
			return;
		}
		work.status = 'waiting';
		delete work.assignment;
		addUpdate(work, 'requeued', request.work.reason ?? 'Returned to queue.');
		writeState(state);
		writeJson(work);
		return;
	}
	process.exitCode = 2;
}

function handleAnnotations(operation, request) {
	if (operation === 'list') {
		writeJson(listAnnotations(request.workspace.cwd));
		return;
	}
	const companionPath = annotationCompanionPath(request);
	if (operation === 'read') {
		const companion = readCompanion(companionPath, request.document.uri);
		const currentPermanentCommit = permanentCommit();
		writeJson({
			...companion,
			currentPermanentCommit,
			currentPermanentAnnotationIds: companion.annotations
				.filter(annotation => annotation.permanentBaseCommit === currentPermanentCommit)
				.map(annotation => annotation.id),
		});
		return;
	}
	if (operation === 'reanchor') {
		const companion = readCompanion(companionPath, request.document.uri);
		writeJson({
			companion: {
				...companion, currentPermanentCommit: permanentCommit(),
				currentPermanentAnnotationIds: companion.annotations.filter(annotation => annotation.permanentBaseCommit === permanentCommit()).map(annotation => annotation.id),
			},
			changedAnnotationIds: [], fileScopedAnnotationIds: [], affectedPaths: [], alreadyApplied: true,
		});
		return;
	}
	if (operation === 'append') {
		const failureMarker = path.join(process.cwd(), 'fail-annotation-once');
		if (fs.existsSync(failureMarker)) {
			fs.unlinkSync(failureMarker);
			process.stderr.write('simulated annotation write failure\n');
			process.exitCode = 1;
			return;
		}
		const companion = readCompanion(companionPath, request.document.uri);
		const existing = companion.annotations.find(annotation => annotation.id === request.annotation.id);
		if (existing !== undefined) {
			writeJson(existing);
			return;
		}
		const annotation = {
			kind: 'user',
			id: request.annotation.id,
			permanentBaseCommit: permanentCommit(),
			message: request.annotation.message,
			preset: request.annotation.preset,
			scope: request.annotation.scope,
			anchor: anchorForRequest(request),
				officialResponses: [],
				agentAnnotations: [],
		};
		companion.annotations.push(annotation);
		fs.mkdirSync(path.dirname(companionPath), { recursive: true });
		fs.writeFileSync(companionPath, renderCompanion(companion));
		writeJson(annotation);
		return;
	}
	process.exitCode = 2;
}

function recordFixtureResponse(request) {
	const state = readState();
	const work = findWork(state, request.managed.userAnnotationId);
	const responsePath = path.join(request.workspace.cwd, '.sundial', `${work.id}response.md`);
	const body = 'Persisted the annotation exactly once.\n';
	fs.writeFileSync(responsePath, body);
	const companionPath = annotationCompanionPath({ workspace: { cwd: request.workspace.cwd }, document: { uri: work.source.uri } });
	const companion = readCompanion(companionPath);
	const annotation = companion.annotations.find(candidate => candidate.id === work.id);
	if (annotation === undefined) { throw new Error(`Missing annotation for response: ${work.id}`); }
	const at = now();
	annotation.officialResponses.push({
		userAnnotationId: work.id, agentId: work.agentId, agentSessionId: work.assignment.sessionId, body, createdAt: at,
	});
	fs.writeFileSync(companionPath, renderCompanion(companion));
	work.status = 'completed';
	addUpdate(work, 'completed', 'Official response recorded.');
	writeState(state);
	fs.rmSync(responsePath);
}

function agentProjection(state) {
	const waiting = state.work.filter(work => work.status === 'waiting').length;
	const working = state.work.filter(work => work.status === 'working').length;
	const completed = state.work.filter(work => work.status === 'completed').length;
	const currentWork = state.work.find(work => work.status === 'working');
	return {
		id: 'agent-bob',
		slot: 1,
		name: 'Bob',
		session: { state: 'available', id: 'session-bob', provider: 'codex' },
		queue: { waiting, working, completed },
		...(currentWork === undefined ? {} : { currentWork: workSummary(currentWork) }),
		controls: {
			canRename: true,
			canEnsureSession: false,
			canOpen: true,
			canInterrupt: currentWork !== undefined,
			canReset: true,
		},
	};
}

function workSummary(work) {
	return {
		id: work.id,
		agentId: work.agentId,
		status: work.status,
		ready: work.ready,
		enqueuedAt: work.enqueuedAt,
		updatedAt: work.updatedAt,
		latestUpdate: work.latestUpdate,
		...(work.assignment === undefined ? {} : { assignment: work.assignment }),
	};
}

function addUpdate(work, kind, message) {
	const at = now();
	const update = { at, kind, message };
	work.updatedAt = at;
	work.latestUpdate = update;
	work.updates.push(update);
}

function findWork(state, id) {
	const work = state.work.find(item => item.id === id);
	if (work === undefined) {
		throw new Error(`Unknown work: ${id}`);
	}
	return work;
}

function readState() {
	const statePath = path.join(process.cwd(), '.test-agent-state.json');
	return fs.existsSync(statePath)
		? JSON.parse(fs.readFileSync(statePath, 'utf8'))
		: { nextId: 1, assignmentSequence: 0, work: [] };
}

function writeState(state) {
	fs.writeFileSync(path.join(process.cwd(), '.test-agent-state.json'), JSON.stringify(state));
}

function now() {
	return new Date().toISOString();
}

function writeJson(value) {
	process.stdout.write(`${JSON.stringify(value)}\n`);
}

function annotationCompanionPath(request) {
	const relative = path.relative(request.workspace.cwd, fileURLToPath(request.document.uri));
	return path.join(request.workspace.cwd, '.sundial', `${relative}.comments`);
}

function readCompanion(companionPath, sourceUri) {
	if (!fs.existsSync(companionPath)) {
		return { version: 5, sourceDigest: digest(fs.readFileSync(fileURLToPath(sourceUri), 'utf8')), annotations: [] };
	}
	const lines = fs.readFileSync(companionPath, 'utf8').trimEnd().split('\n');
	const version = Number(lines[0].slice('version: '.length));
	return { version, sourceDigest: lines[1].slice('sourceDigest: '.length), annotations: lines.slice(3).map(line => JSON.parse(line.slice(4))) };
}

function listAnnotations(cwd) {
	const store = path.join(cwd, '.sundial');
	const currentPermanentCommit = permanentCommit();
	if (!fs.existsSync(store)) { return { currentPermanentCommit, groups: [] }; }
	const companionPaths = [];
	const visit = directory => {
		for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
			if (directory === store && entry.name === 'agents') { continue; }
			const entryPath = path.join(directory, entry.name);
			if (entry.isDirectory()) { visit(entryPath); }
			else if (entry.isFile() && entry.name.endsWith('.comments')) { companionPaths.push(entryPath); }
		}
	};
	visit(store);
	const groups = companionPaths.sort().flatMap(companionPath => {
		const companion = readCompanion(companionPath);
		const annotations = companion.annotations.flatMap(annotation => annotation.kind === 'user' ? [{
			id: annotation.id, message: annotation.message, line: annotation.anchor.line,
			currentPermanent: annotation.permanentBaseCommit === currentPermanentCommit,
		}] : []);
		return annotations.length === 0 ? [] : [{
			file: path.relative(store, companionPath).slice(0, -'.comments'.length).split(path.sep).join('/'),
			annotations,
		}];
	});
	return { currentPermanentCommit, groups };
}

function permanentCommit() {
	return 'a'.repeat(40);
}

function renderCompanion(companion) {
	return [
		`version: ${companion.version}`,
		`sourceDigest: ${companion.sourceDigest}`,
		'annotations:',
		...companion.annotations.map(annotation => `  - ${JSON.stringify(annotation)}`),
		'',
	].join('\n');
}

function digest(source) {
	return createHash('sha256').update(source, 'utf8').digest('hex');
}

function anchorForRequest(request) {
	const lines = fs.readFileSync(fileURLToPath(request.document.uri), 'utf8').replace(/\r\n?/g, '\n').split('\n');
	const before = lines.slice(0, request.document.line).filter(line => line.trim() !== '').slice(-3);
	const after = lines.slice(request.document.line + 1).filter(line => line.trim() !== '').slice(0, 3);
	return { line: request.document.line, text: lines[request.document.line] ?? '', before, after };
}
