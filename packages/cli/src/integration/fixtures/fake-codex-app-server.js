const fs = require('node:fs');
const readline = require('node:readline');

const scenario = process.env.SUNDIAL_CODEX_SCENARIO ?? 'default-success';
const tracePath = process.env.SUNDIAL_CODEX_TRACE;
const statePath = process.env.SUNDIAL_CODEX_STATE;

function record(message) {
	if (tracePath !== undefined) {
		fs.appendFileSync(tracePath, `${JSON.stringify(message)}\n`);
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
		if (scenario === 'malformed-initialize') {
			send({ id: message.id, result: {} });
			return;
		}
		send({ id: message.id, result: { userAgent: 'fake-codex/0.131.0' } });
		return;
	}
	if (message.method === 'initialized') {
		return;
	}
	if (message.method === 'model/list') {
		if (scenario === 'missing-model-list') {
			send({ id: message.id, error: { code: -32601, message: 'Method not found: model/list' } });
			return;
		}
		if (scenario === 'malformed-model-list') {
			send({ id: message.id, result: { data: {}, nextCursor: null } });
			return;
		}
		if (scenario === 'model-list-error') {
			send({ id: message.id, error: { message: 'Could not load available models.' } });
			return;
		}
		send({ id: message.id, result: modelsFor(message.params.cursor) });
		return;
	}
	if (message.method === 'thread/start') {
		const isProbe = message.params.baseInstructions?.startsWith('Sundial Codex compatibility probe.');
		if (scenario === 'malformed-thread-start' && isProbe) {
			send({ id: message.id, result: { thread: {} } });
			return;
		}
		if (scenario === 'newer-codex-required' && !isProbe) {
			send({
				id: message.id,
				error: { message: "The 'gpt-default' model requires a newer version of Codex." },
			});
			return;
		}
		const threadId = isProbe ? 'compatibility-probe-thread' : 'thread-1';
		send({ id: message.id, result: { thread: { id: threadId } } });
		send({ method: 'thread/started', params: { thread: { id: threadId } } });
		return;
	}
	if (message.method === 'thread/inject_items') {
		if (scenario === 'missing-inject-not-persistent' || scenario === 'missing-inject-persistent') {
			send({ id: message.id, error: { code: -32601, message: 'Method not found: thread/inject_items' } });
			return;
		}
		if (statePath !== undefined) {
			fs.writeFileSync(statePath, message.params.threadId);
		}
		send({ id: message.id, result: {} });
		return;
	}
	if (message.method === 'thread/resume') {
		if (scenario === 'missing-session' && message.params.threadId === 'missing-thread') {
			send({ id: message.id, error: { message: `no rollout found for thread id ${message.params.threadId}` } });
			return;
		}
		send({ id: message.id, result: { thread: { id: message.params.threadId } } });
		return;
	}
	if (message.method === 'thread/read') {
		const threadId = message.params.threadId;
		const needsInjection = scenario === 'legacy-materialization' || scenario === 'missing-inject-not-persistent';
		const injected = statePath !== undefined && fs.existsSync(statePath) && fs.readFileSync(statePath, 'utf8') === threadId;
		if ((scenario === 'missing-session' && threadId === 'missing-thread') || (needsInjection && !injected)) {
			send({ id: message.id, error: { message: `thread not loaded: ${message.params.threadId}` } });
			return;
		}
		send({
			id: message.id,
			result: {
				thread: {
					id: threadId,
					turns: threadId === 'compatibility-probe-thread' ? [] : [{ items: [
						{ type: 'userMessage', content: [{ type: 'input_text', text: 'Fix this.' }] },
						{ type: 'agentMessage', text: 'Applied fake integration change.' },
					] }],
				},
			},
		});
		return;
	}
	if (message.method === 'turn/start') {
		if (message.params.threadId === undefined) {
			if (scenario === 'missing-turn-start') {
				send({ id: message.id, error: { code: -32601, message: 'Method not found: turn/start' } });
			} else {
				send({ id: message.id, error: { code: -32602, message: 'missing field threadId' } });
			}
			return;
		}
		send({ id: message.id, result: { turn: { id: 'turn-1' } } });
		setImmediate(() => {
			send({ method: 'turn/started', params: { turn: { id: 'turn-1', status: 'inProgress' } } });
			send({ method: 'item/agentMessage/delta', params: { delta: 'Applied fake integration change.' } });
			send({ method: 'turn/completed', params: { turn: { id: 'turn-1', status: 'completed', error: null } } });
		});
		return;
	}
	if (message.method === 'turn/interrupt') {
		if (message.params.threadId === undefined) {
			if (scenario === 'missing-turn-interrupt') {
				send({ id: message.id, error: { code: -32601, message: 'Method not found: turn/interrupt' } });
			} else {
				send({ id: message.id, error: { code: -32602, message: 'missing field threadId' } });
			}
			return;
		}
		send({ id: message.id, result: {} });
		return;
	}
	if (message.method === 'thread/archive') {
		send({ id: message.id, result: {} });
	}
});
