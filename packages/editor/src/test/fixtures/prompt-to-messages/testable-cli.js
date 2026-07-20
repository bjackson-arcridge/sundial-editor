// Stateful test CLI for the editor's durable named-agent orchestration.
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
		fs.writeFileSync(path.join(process.cwd(), 'received-request.json'), JSON.stringify(request));
		process.stdout.write(`${JSON.stringify({ kind: 'status', status: 'working', message: 'Test Codex behavior is working.' })}\n`);
		setTimeout(() => {
			process.stdout.write(`${JSON.stringify({ kind: 'output', text: 'Applied the requested test patch.' })}\n`);
			process.stdout.write(`${JSON.stringify({ kind: 'status', status: 'waiting' })}\n`);
		}, 400);
		return;
	}
	process.stderr.write(`Unsupported command: ${process.argv.slice(2).join(' ')}\n`);
	process.exitCode = 2;
});

function handleAgent(operation, action, request) {
	const state = readState();
	if (operation === 'list') {
		writeJson({ agents: [agentProjection(state, 'agent-bob', 1, 'Bob'), agentProjection(state, 'agent-amy', 2, 'Amy')] });
		return;
	}
	if (operation === 'session' && action === 'ensure') {
		const details = request.agent.id === 'agent-amy'
			? { id: 'agent-amy', slot: 2, name: 'Amy' }
			: { id: 'agent-bob', slot: 1, name: 'Bob' };
		writeJson({
			agent: agentProjection(state, details.id, details.slot, details.name),
			session: { id: `session-${details.name.toLowerCase()}` },
		});
		return;
	}
	if (operation !== 'work') {
		process.stderr.write(`Unsupported agent operation: ${operation ?? ''}\n`);
		process.exitCode = 2;
		return;
	}
	if (action === 'list') {
		writeJson({ work: state.work });
		return;
	}
	if (action === 'enqueue') {
		const at = now();
		const id = request.work.userAnnotationId ?? `integration-work-${state.nextId++}`;
		const update = { at, kind: 'enqueued', message: 'Queued for Bob.' };
		const work = {
			id,
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
		addUpdate(work, 'ready', 'Durable annotation saved; work is ready.');
		work.ready = true;
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
		const agentName = request.agent.id === 'agent-amy' ? 'Amy' : 'Bob';
		const sessionId = `session-${agentName.toLowerCase()}`;
		const update = { at, kind: 'claimed', message: `Assigned to ${agentName}.` };
		work.status = 'working';
		work.assignment = { sessionId, sequence, claimedAt: at };
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
		work.status = 'waiting';
		delete work.assignment;
		addUpdate(work, 'requeued', request.work.reason ?? 'Returned to queue.');
		writeState(state);
		writeJson(work);
		return;
	}
	process.stderr.write(`Unsupported work operation: ${action ?? ''}\n`);
	process.exitCode = 2;
}

function handleAnnotations(operation, request) {
	const companionPath = annotationCompanionPath(request);
	if (operation === 'read') {
		writeJson(readCompanion(companionPath));
		return;
	}
	if (operation === 'append') {
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
		};
		companion.annotations.push(annotation);
		fs.mkdirSync(path.dirname(companionPath), { recursive: true });
		fs.writeFileSync(companionPath, renderCompanion(companion));
		writeJson(annotation);
		return;
	}
	if (operation === 'delete') {
		const companion = readCompanion(companionPath);
		const index = companion.annotations.findIndex(annotation => annotation.id === request.annotation.id);
		if (index < 0) {
			process.stderr.write(`Annotation not found: ${request.annotation.id}\n`);
			process.exitCode = 1;
			return;
		}
		const [deleted] = companion.annotations.splice(index, 1);
		fs.writeFileSync(companionPath, renderCompanion(companion));
		const state = readState();
		state.work = state.work.filter(work => work.id !== request.annotation.id);
		writeState(state);
		writeJson(deleted);
		return;
	}
	process.exitCode = 2;
}
function agentProjection(state, id, slot, name) {
	const agentWork = state.work.filter(work => work.agentId === id);
	const waiting = agentWork.filter(work => work.status === 'waiting').length;
	const working = agentWork.filter(work => work.status === 'working').length;
	const completed = agentWork.filter(work => work.status === 'completed').length;
	const currentWork = agentWork.find(work => work.status === 'working');
	return {
		id,
		slot,
		name,
		session: { state: 'available', id: `session-${name.toLowerCase()}`, provider: 'codex' },
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

function statePath() {
	return path.join(process.cwd(), '.test-agent-state.json');
}

function readState() {
	return fs.existsSync(statePath())
		? JSON.parse(fs.readFileSync(statePath(), 'utf8'))
		: { nextId: 1, assignmentSequence: 0, work: [] };
}

function writeState(state) {
	fs.writeFileSync(statePath(), JSON.stringify(state));
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
	const annotations = [];
	let index = 2;
	while (index < lines.length) {
		const hasContext = lines[index + 7]?.startsWith('      before: ');
		annotations.push({
			id: JSON.parse(lines[index].slice('  - id: '.length)),
			message: JSON.parse(lines[index + 1].slice('    message: '.length)),
			preset: JSON.parse(lines[index + 2].slice('    preset: '.length)),
			scope: JSON.parse(lines[index + 3].slice('    scope: '.length)),
			anchor: {
				line: Number(lines[index + 5].slice('      line: '.length)),
				text: JSON.parse(lines[index + 6].slice('      text: '.length)),
				before: hasContext ? JSON.parse(lines[index + 7].slice('      before: '.length)) : [],
				after: hasContext ? JSON.parse(lines[index + 8].slice('      after: '.length)) : [],
			},
		});
		index += hasContext ? 9 : 7;
	}
	return { version: 1, annotations };
}

function renderCompanion(companion) {
	return [
		'version: 1',
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
		]),
		'',
	].join('\n');
}
