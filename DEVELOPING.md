# Developing Sundial Editor

This file is for human maintainer workflows. Agent-facing project rules stay in `AGENTS.md`.

## Setup

```bash
npm install
npm run check-types
npm run lint
npm run test:unit
npm test
```

`npm test` launches the VS Code integration suites against the pinned project-managed runtime in `.vscode-test/`. The runtime is downloaded and validated when absent; no machine-wide VS Code install is required.

## Editor Package

```bash
npm run package:editor
```

The editor extension is owned by `packages/editor/package.json` and packaged with `vsce`.

## CLI Package

SPEC-0010 plans a publishable CLI package at `packages/cli` named `@arcridge/sundial-editor-cli`.

Planned local commands:

```bash
npm run cli -- --help
npm run pack:cli
npm run install:cli:local
npm run uninstall:cli:local
npm run publish:cli
```

Before publishing the CLI, run the broad verification suite, pack the tarball, inspect its contents, install it locally, and verify `sundial-editor-cli --version` and `sundial-editor-cli --help`.
