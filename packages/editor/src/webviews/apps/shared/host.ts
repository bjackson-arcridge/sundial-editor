interface VSCodeApi<Outbound, State = unknown> {
	postMessage(message: Outbound): void;
	getState(): State | undefined;
	setState(state: State): void;
}

declare function acquireVsCodeApi<Outbound, State>(): VSCodeApi<Outbound, State>;

let cachedApi: VSCodeApi<unknown, unknown> | undefined;

export function getHost<Outbound, State = unknown>(): VSCodeApi<Outbound, State> {
	cachedApi ??= acquireVsCodeApi();
	return cachedApi as VSCodeApi<Outbound, State>;
}

export function readInitialState<T>(): T | undefined {
	const node = document.getElementById('se-initial-state');
	if (node === null || node.textContent === null) {
		return undefined;
	}

	try {
		return JSON.parse(node.textContent) as T;
	} catch {
		return undefined;
	}
}
