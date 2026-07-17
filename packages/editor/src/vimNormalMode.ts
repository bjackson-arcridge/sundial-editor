export const vscodeVimExtensionId = 'vscodevim.vim';
export const vscodeVimEscapeCommandId = 'extension.vim_escape';

export interface VSCodeVimExtension {
	readonly isActive: boolean;
	activate(): PromiseLike<unknown>;
}

export interface VSCodeVimNormalModeServices {
	readonly getExtension: (extensionId: string) => VSCodeVimExtension | undefined;
	readonly executeCommand: (commandId: string) => PromiseLike<unknown>;
	readonly reportFailure?: (error: unknown) => void;
}

export async function returnToVSCodeVimNormalMode(services: VSCodeVimNormalModeServices): Promise<void> {
	const extension = services.getExtension(vscodeVimExtensionId);
	if (extension === undefined) {
		return;
	}

	try {
		if (!extension.isActive) {
			await extension.activate();
		}
		await services.executeCommand(vscodeVimEscapeCommandId);
	} catch (error) {
		services.reportFailure?.(error);
	}
}
