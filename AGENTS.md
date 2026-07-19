# Agent Instructions

## Version Management

`packages/editor/package.json` owns the Sundial Editor extension version. Increment the patch version for bug fixes and existing-behavior adjustments; increment the minor version when adding or removing user-facing functionality. Major versions require explicit user direction.

## VS Code Integration Tests

`npm test` launches the editor integration suites against one pinned, project-managed runtime in the root `.vscode-test/` cache. The pretest helper downloads that runtime from the official VS Code update service when absent, so tests must not depend on a machine-wide VS Code installation. The test config uses the supported `useInstallation.fromPath` field only to launch this prepared project-cache executable; never replace it with `useInstallation.fromMachine` or a system application path. On macOS the helper verifies the disposable app bundle and, after a checksum-validated fresh download, applies a local ad-hoc signature when Gatekeeper rejects the archive signature. Do not manually clear Gatekeeper attributes or reuse an unverifiable cache.

In a sandboxed Codex session, run `npm test` with `sandbox_permissions: "require_escalated"` on the first attempt because a fresh cache needs network access. Do not first retry it inside the network-restricted sandbox.

## Broad Testing After Major Features

After implementing any major feature, run the broad local regression set before finalizing: `npm run check-types`, `npm run lint`, `npm run test:unit`, and `npm test`. If a suite cannot run in the current environment, report the skipped command and the concrete blocker.
