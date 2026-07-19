import type { AgentEvent, PromptRequest } from '../protocol.js';

export interface ProviderAdapter {
	readonly health: () => Promise<ProviderHealth>;
	readonly run: (request: PromptRequest, emit: (event: AgentEvent) => void, signal?: AbortSignal) => Promise<void>;
}

export interface ProviderHealth {
	readonly provider: string;
	readonly available: boolean;
	readonly compatible: boolean;
	readonly version?: string;
	readonly message?: string;
}


export class AdapterError extends Error {
	constructor(message: string, readonly recoverable = true) {
		super(message);
		this.name = 'AdapterError';
	}
}
