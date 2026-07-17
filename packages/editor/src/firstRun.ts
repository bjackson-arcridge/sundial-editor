export const agentsViewOpenedStateKey = 'sundialEditor.agentsViewOpenedOnFirstActivation';

export interface FirstRunState {
	readonly get: <T>(key: string) => T | undefined;
	readonly update: (key: string, value: unknown) => Thenable<void>;
}

export interface FirstRunServices {
	readonly state: FirstRunState;
	readonly revealAgentsView: () => Promise<void>;
}

export async function revealAgentsViewOnFirstActivation(services: FirstRunServices): Promise<boolean> {
	if (services.state.get<boolean>(agentsViewOpenedStateKey) === true) {
		return false;
	}

	await services.revealAgentsView();
	await services.state.update(agentsViewOpenedStateKey, true);
	return true;
}
