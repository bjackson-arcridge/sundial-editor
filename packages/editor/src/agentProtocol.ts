export type AgentStatus = 'waiting' | 'working' | 'blocked';
export type AgentEvent =
	| { readonly kind: 'status'; readonly status: AgentStatus; readonly message?: string }
	| { readonly kind: 'output'; readonly text: string }
	| { readonly kind: 'error'; readonly message: string; readonly recoverable: boolean };
