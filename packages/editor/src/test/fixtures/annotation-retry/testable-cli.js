// Stateful test CLI with a one-shot durable-annotation failure.
const fs = require('node:fs');
const path = require('node:path');
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
			source: request.work.source,
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
	const companionPath = annotationCompanionPath(request);
	if (operation === 'read') {
		writeJson(readCompanion(companionPath));
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
		const companion = readCompanion(companionPath);
		const existing = companion.annotations.find(annotation => annotation.id === request.annotation.id);
		if (existing !== undefined) {
			writeJson(existing);
			return;
		}
		const annotation = {
			id: request.annotation.id,
			message: request.annotation.message,
			preset: request.annotation.preset,
			scope: request.annotation.scope,
			anchor: {
				line: request.document.line,
				text: request.document.text,
				before: request.document.before,
					after: request.document.after,
				},
				officialResponses: [],
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
	companion.version = 2;
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

function readCompanion(companionPath) {
	if (!fs.existsSync(companionPath)) {
		return { version: 1, annotations: [] };
	}
	const lines = fs.readFileSync(companionPath, 'utf8').trimEnd().split('\n');
	const version = Number(lines[0].slice('version: '.length));
	const annotations = [];
	let index = 2;
	while (index < lines.length) {
		const annotation = {
			id: JSON.parse(lines[index].slice('  - id: '.length)),
			message: JSON.parse(lines[index + 1].slice('    message: '.length)),
			preset: JSON.parse(lines[index + 2].slice('    preset: '.length)),
			scope: JSON.parse(lines[index + 3].slice('    scope: '.length)),
			anchor: {
				line: Number(lines[index + 5].slice('      line: '.length)),
				text: JSON.parse(lines[index + 6].slice('      text: '.length)),
				before: JSON.parse(lines[index + 7].slice('      before: '.length)),
				after: JSON.parse(lines[index + 8].slice('      after: '.length)),
			},
			officialResponses: [],
		};
		index += 9;
		if (version === 2) {
			index += 1;
			while (lines[index]?.startsWith('      - userAnnotationId: ')) {
				annotation.officialResponses.push({
					userAnnotationId: JSON.parse(lines[index].slice('      - userAnnotationId: '.length)),
					agentId: JSON.parse(lines[index + 1].slice('        agentId: '.length)),
					agentSessionId: JSON.parse(lines[index + 2].slice('        agentSessionId: '.length)),
					body: JSON.parse(lines[index + 3].slice('        body: '.length)),
					createdAt: JSON.parse(lines[index + 4].slice('        createdAt: '.length)),
				});
				index += 5;
			}
		}
		annotations.push(annotation);
	}
	return { version, annotations };
}

function renderCompanion(companion) {
	return [
		`version: ${companion.version}`,
		'annotations:',
		...companion.annotations.flatMap(annotation => [
			`  - id: ${JSON.stringify(annotation.id)}`,
			`    message: ${JSON.stringify(annotation.message)}`,
			`    preset: ${JSON.stringify(annotation.preset)}`,
			`    scope: ${JSON.stringify(annotation.scope)}`,
			'    anchor:',
			`      line: ${annotation.anchor.line}`,
			`      text: ${JSON.stringify(annotation.anchor.text)}`,
			`      before: ${JSON.stringify(annotation.anchor.before)}`,
			`      after: ${JSON.stringify(annotation.anchor.after)}`,
			...(companion.version === 1 ? [] : [
				'    officialResponses:',
				...annotation.officialResponses.flatMap(response => [
					`      - userAnnotationId: ${JSON.stringify(response.userAnnotationId)}`,
					`        agentId: ${JSON.stringify(response.agentId)}`,
					`        agentSessionId: ${JSON.stringify(response.agentSessionId)}`,
					`        body: ${JSON.stringify(response.body)}`,
					`        createdAt: ${JSON.stringify(response.createdAt)}`,
				]),
			]),
		]),
		'',
	].join('\n');
}
