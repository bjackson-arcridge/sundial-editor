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
npm run install:editor:local
```

The editor extension is owned by `packages/editor/package.json` and packaged with `vsce`. `install:editor:local` packages the current workspace, uninstalls `arcridge.sundial-editor` from your local VS Code profile when present, and installs the new VSIX. Set `CODE_BIN=code-insiders` (or another VS Code CLI path) to target a different installation.

## CLI Package

`packages/cli` is published as `@arcridge/sundial-editor-cli`. It requires Node.js 20 or newer and currently validates Codex `0.131.x` before using the version-specific app-server protocol.

Local commands:

```bash
npm run cli -- --help
npm run pack:cli
npm run install:cli:local
npm run uninstall:cli:local
npm run publish:cli
```

`install:cli:local` packages the current workspace into a temporary tarball, installs it globally, and removes the temporary artifact. It does not require a prior `pack:cli` command.

Before publishing the CLI, run the broad verification suite, pack the tarball, inspect its contents, install it locally, and verify `sundial-editor-cli --version` and `sundial-editor-cli --help`.

Standard verification and local install loop:

```bash
npm run check-types
npm run lint
npm run test:unit
npm test
npm run pack:cli
tar -tf arcridge-sundial-editor-cli-0.1.1.tgz
npm run install:cli:local
sundial-editor-cli --version
sundial-editor-cli --help
npm run uninstall:cli:local
```

Publish the public package with `npm run publish:cli` after verification.
