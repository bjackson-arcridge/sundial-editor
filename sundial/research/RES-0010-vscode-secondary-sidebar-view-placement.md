---
id: RES-0010
title: VS Code Secondary Sidebar view placement
domain: vscode.extension
summary: VS Code 1.106 finalized the `viewsContainers.secondarySidebar` contribution point, while opening or focusing that container remains an imperative command behavior rather than a view-visibility declaration.
created: 2026-07-13
updated: 2026-07-13
---

## Research

Verified on 2026-07-13 from official VS Code release notes and the locally installed Codex and Claude Code extension manifests.

- VS Code 1.104 introduced `viewsContainers.secondarySidebar` behind the `contribSecondarySideBar` proposed API.
- VS Code 1.106 finalized `secondarySidebar` as a contribution point. A manifest can declare a custom container under `contributes.viewsContainers.secondarySidebar` and contribute views to that container id under `contributes.views`.
- Locally installed `openai.chatgpt` 26.707.41301 declares `codexSecondaryViewContainer` under `viewsContainers.secondarySidebar` and contributes its webview to that container. It uses a context-key-gated Activity Bar container as an older-client fallback.
- Locally installed `anthropic.claude-code` 2.1.207 likewise declares `claude-sidebar-secondary` under `viewsContainers.secondarySidebar` with a context-key-gated Activity Bar fallback.
- Neither installed extension lists `contribSecondarySideBar` in `enabledApiProposals`, consistent with the contribution being stable.
- The general contribution-point and Sidebar UX pages still stated that custom containers were limited to the Activity Bar or Panel when checked on 2026-07-13; those pages conflict with the 1.106 release notes and working extension manifests.
- Users retain the ability to relocate a view or container after installation, and VS Code remembers that layout choice.
- A contributed view's optional `visibility` value (`visible`, `collapsed`, or `hidden`) is only respected the first time a workspace is opened with that view. It controls the view inside its container; the documentation does not state that it reveals a hidden Secondary Side Bar or selects that container.
- VS Code generates a `<viewId>.focus` command for contributed views. The installed Claude Code extension executes `claudeVSCodeSidebarSecondary.focus` to reveal its Secondary Sidebar webview.
- The installed Codex extension first executes `workbench.view.extension.<containerId>` and then `<viewId>.focus`. Its `chatgpt.openOnStartup` setting calls that focus routine after activation and defaults to `false`.
- The documented activation-event list has no install-specific event. `onStartupFinished` activates an interested extension after startup without delaying initial startup; `ExtensionContext.globalState` provides persisted `get` and `update` operations that can distinguish a one-time first activation from later activations or updates.

Sources:

- https://code.visualstudio.com/api/references/contribution-points#contributes.viewsContainers
- https://code.visualstudio.com/api/ux-guidelines/sidebars
- https://code.visualstudio.com/api/extension-guides/tree-view#view-container
- https://code.visualstudio.com/api/references/activation-events#onStartupFinished
- https://code.visualstudio.com/updates/v1_104/#_view-containers-in-the-secondary-side-bar
- https://code.visualstudio.com/updates/v1_106/#_view-containers-in-secondary-side-bar
- `~/.vscode/extensions/openai.chatgpt-26.707.41301-darwin-arm64/package.json`
- `~/.vscode/extensions/openai.chatgpt-26.707.41301-darwin-arm64/out/extension.js`
- `~/.vscode/extensions/anthropic.claude-code-2.1.207-darwin-arm64/package.json`
- `~/.vscode/extensions/anthropic.claude-code-2.1.207-darwin-arm64/extension.js`
- `node_modules/@types/vscode/index.d.ts#ExtensionContext.globalState`
