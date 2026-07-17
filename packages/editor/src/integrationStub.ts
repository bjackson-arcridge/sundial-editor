import type { PromptContext } from './promptCommand';

export function createIntegrationStub(prompt: PromptContext): string {
	const target = prompt.scope === 'project'
		? 'project scope'
		: `source line ${prompt.sourceLine + 1}`;
	return `[Integration stub] Sundial received ${prompt.preset} for ${target}.`;
}
