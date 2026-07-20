import { css } from 'lit';

export const tokenStyles = css`
	:host {
		--se-fg: var(--vscode-foreground);
		--se-icon-fg: var(--vscode-foreground);
		--se-toolbar-bg: var(--vscode-sideBarSectionHeader-background, var(--vscode-sideBar-background));
		--se-muted-fg: var(--vscode-descriptionForeground);
		--se-bg: var(--vscode-sideBar-background);
		--se-surface-bg: var(--vscode-editorWidget-background);
		--se-border: var(--vscode-widget-border, var(--vscode-panel-border));
		--se-focus: var(--vscode-focusBorder);
		--se-input-bg: var(--vscode-input-background);
		--se-input-fg: var(--vscode-input-foreground);
		--se-input-border: var(--vscode-input-border, var(--vscode-widget-border));
		--se-button-bg: var(--vscode-button-background);
		--se-button-fg: var(--vscode-button-foreground);
		--se-button-hover: var(--vscode-button-hoverBackground);
		--se-secondary-button-bg: var(--vscode-button-secondaryBackground);
		--se-secondary-button-fg: var(--vscode-button-secondaryForeground);
		--se-secondary-button-hover: var(--vscode-button-secondaryHoverBackground);
		font-family: var(--vscode-font-family);
		font-size: var(--vscode-font-size);
		color: var(--se-fg);
	}
`;
