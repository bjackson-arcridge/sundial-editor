---
id: RES-0009
title: VS Code delayed auto-save configuration
domain: vscode.extension
summary: VS Code exposes delayed automatic saving through files.autoSave and files.autoSaveDelay, and extensions can contribute defaults for those existing settings through configurationDefaults.
created: 2026-07-13
updated: 2026-07-13
---

## Research

Verified on 2026-07-13 from the official VS Code documentation.

- `files.autoSave` accepts `off`, `afterDelay`, `onFocusChange`, and `onWindowChange`.
- With `files.autoSave` set to `afterDelay`, `files.autoSaveDelay` configures the delay in milliseconds. The documented default delay is `1000` milliseconds.
- The extension manifest's `contributes.configurationDefaults` contribution point supplies default values for configurations registered elsewhere. The official example overrides `files.autoSave` to `onFocusChange`.
- VS Code configuration supports user, workspace, and resource scopes; configured values take precedence over defaults according to the applicable scope.

Sources:

- https://code.visualstudio.com/docs/editing/codebasics
- https://code.visualstudio.com/api/references/contribution-points#contributes.configurationDefaults
- https://code.visualstudio.com/docs/configure/settings
