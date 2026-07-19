const fs = require('node:fs');
const readline = require('node:readline');

const scenario = process.env.SUNDIAL_CODEX_SCENARIO ?? 'default-success';
const tracePath = process.env.SUNDIAL_CODEX_TRACE;
const trace = [];

function record(message) {
	trace.push(message);
	if (tracePath !== undefined) {
		fs.writeFileSync(tracePath, JSON.stringify(trace));
	}
}

function send(message) {
	process.stdout.write(`${JSON.stringify(message)}\n`);
}

function modelsFor(cursor) {
	if (scenario === 'explicit-pagination') {
		return cursor === null
			? {
				data: [model('gpt-default', true)],
				nextCursor: 'page-2',
			}
			: {
				data: [model('gpt-requested', false, 'requested-id')],
				nextCursor: null,
			};
	}
	return {
		data: [model('gpt-fallback', false), model('gpt-default', true)],
		nextCursor: null,
	};
}

function model(name, isDefault, id = name) {
	return { id, model: name, isDefault };
}

readline.createInterface({ input: process.stdin }).on('line', rawLine => {
	const message = JSON.parse(rawLine);
	record(message);

	if (message.method === 'initialize') {
		send({ id: message.id, result: { userAgent: 'fake-codex/0.131.0' } });
		return;
	}
	if (message.method === 'initialized') {
		return;
	}
	if (message.method === 'model/list') {
		if (scenario === 'model-list-error') {
			send({ id: message.id, error: { message: 'Could not load available models.' } });
			return;
		}
		send({ id: message.id, result: modelsFor(message.params.cursor) });
		return;
	}
	if (message.method === 'thread/start') {
		if (scenario === 'newer-codex-required') {
			send({
				id: message.id,
				error: { message: "The 'gpt-default' model requires a newer version of Codex." },
			});
			return;
		}
		send({ id: message.id, result: { thread: { id: 'thread-1' } } });
		return;
	}
	if (message.method === 'turn/start') {
		send({ id: message.id, result: { turn: { id: 'turn-1' } } });
		setImmediate(() => {
			send({ method: 'turn/started', params: { turn: { id: 'turn-1', status: 'inProgress' } } });
			send({ method: 'item/agentMessage/delta', params: { delta: 'Applied fake integration change.' } });
			send({ method: 'turn/completed', params: { turn: { id: 'turn-1', status: 'completed', error: null } } });
		});
		return;
	}
	if (message.method === 'turn/interrupt') {
		send({ id: message.id, result: {} });
	}
});
