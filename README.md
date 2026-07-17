# Sundial Editor

Sundial Editor is the independent VS Code collaboration surface for Sundial workflows. The workspace currently contains the Editor extension at `packages/editor` and intentionally preserves the `packages/` layout for future CLI, VS Code, or MCP packages.

## Development

```bash
npm install
npm run check-types
npm run lint
npm run test:unit
npm test
```

`npm test` downloads and validates the pinned VS Code runtime in the repository-local `.vscode-test/` cache when needed; it does not require a machine-wide VS Code installation.
