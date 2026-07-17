---
id: RES-0008
title: VS Code test CLI package-specific configs
domain: vscode.extension
summary: The installed @vscode/test-cli supports an explicit --config path and resolves its default nearest .vscode-test configuration from the current directory, allowing independent extension packages to own separate integration harnesses.
created: 2026-07-13
updated: 2026-07-13
---

## Research

Verified on 2026-07-13 against the installed `@vscode/test-cli` package version declared in the root `package.json` as `^0.0.12`.

- `vscode-test --help` documents `--config <path>` with default `nearest .vscode-test.js`.
- `node_modules/@vscode/test-cli/README.md` says the runner searches for `.vscode-test.(js/json/mjs)` relative to the current working directory when no explicit config is supplied.
- The README's configuration example says `files`, `extensionDevelopmentPath`, and `workspaceFolder` values are resolved relative to the directory containing the configuration file.

Sources:

- `node_modules/@vscode/test-cli/README.md`
- `./node_modules/.bin/vscode-test --help` run from the repository root on 2026-07-13
