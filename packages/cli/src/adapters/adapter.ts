import type { AgentEvent } from '../protocol.js';

export interface ProviderAdapter {
	readonly health: (options?: ProviderHealthOptions) => Promise<ProviderHealth>;
	readonly createSession?: (request: ProviderSessionCreateRequest) => Promise<ProviderSession>;
	readonly runSession?: (
		request: ProviderSessionRunRequest,
		emit: (event: AgentEvent) => void,
		signal?: AbortSignal,
	) => Promise<ProviderRunResult>;
	readonly readSession?: (request: ProviderSessionReadRequest) => Promise<ProviderSessionReadResult>;
}

export interface ProviderHealthOptions {
	readonly forceRefresh?: boolean;
}

export interface ProviderHealth {
	readonly provider: string;
	readonly available: boolean;
	readonly compatible: boolean;
	readonly executablePath?: string;
	readonly version?: string;
	readonly message?: string;
}

export interface ProviderSessionCreateRequest {
	readonly cwd: string;
	readonly model?: string;
	readonly baseInstructions: string;
}

export interface ProviderSessionRunRequest {
	readonly cwd: string;
	readonly providerSessionId: string;
	readonly prompt: string;
	readonly model?: string;
	/** Environment inherited by provider-launched tools; values are never placed in the model prompt. */
	readonly invocationEnvironment?: Readonly<Record<string, string>>;
}

export interface ProviderSessionReadRequest {
	readonly cwd: string;
	readonly providerSessionId: string;
}

export interface ProviderSession {
	readonly providerSessionId: string;
}

export interface ProviderRunResult extends ProviderSession {
	readonly output: string;
	readonly outcome: 'completed' | 'interrupted';
}

export interface ProviderTranscriptEntry {
	readonly role: 'user' | 'agent' | 'system';
	readonly text: string;
}

export interface ProviderSessionReadResult extends ProviderSession {
	readonly available: boolean;
	readonly transcript: readonly ProviderTranscriptEntry[];
}


export class AdapterError extends Error {
	constructor(message: string, readonly recoverable = true) {
		super(message);
		this.name = 'AdapterError';
	}
}
