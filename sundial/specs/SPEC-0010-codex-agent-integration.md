---
id: SPEC-0010
title: Codex agent integration
status: Done
created: 2026-07-13
updated: 2026-07-19
created_by: bjackson
parent: SPEC-0008
domain: editor
slice: 2
---
# Codex agent integration

## Discovery

This is functional slice 2 from SPEC-0008. It adds an independently published npm package, `@arcridge/sundial-editor-cli`, that owns the provider-facing agent-control surface for Sundial Editor. The first implementation target is a Codex adapter backed by the local Codex CLI/app-server surface so one managed agent can receive prompts from the editor, report status and output, and make targeted patches in the dirty shared tree.

The existing editor package intentionally stops at an integration stub. This slice replaces that stub boundary with a small local CLI protocol rather than coupling the VS Code extension directly to Codex internals. The Codesteward CLI package is the structural example: a workspace package with its own `package.json`, `bin`, `prepack` compile step, package README, unit-testable `main`, root convenience scripts for local pack/install/publish, and no runtime dependency on VS Code.

Developer-centric command guidance belongs in `DEVELOPING.md`; `AGENTS.md` remains agent-facing project policy plus managed Sundial instructions.

## Applicable Decision Records

- DR-0006 Webview UI meets baseline accessibility requirements.
- DR-0008 Extension ↔ webview messages use typed discriminated unions.
- DR-0009 Sidebar sections use WebviewView, not TreeView.
- DR-0012 Sundial workflows live in the CLI-backed store.
- DR-0016 CLI store operations avoid runtime dependencies and shell pipelines.
- DR-0025 CLI surface changes require version review.

## Applicable Research Notes

- RES-0006 Provider harness auth and MCP surfaces.
- RES-0007 Provider command surfaces for agent control.

## Planned Approach

1. Add `packages/cli` as the new publishable package named `@arcridge/sundial-editor-cli`, with Node `>=20`, Apache-2.0 metadata, repository directory metadata, `publishConfig.access: "public"`, `files` limited to `dist`, `README.md`, and `LICENSE`, and a command-line `bin`. Use `sundial-editor-cli` as the executable name so the command matches the package suffix. Start the package at version `0.1.0` because this is new user-facing functionality; future CLI surface changes follow DR-0025.

2. Mirror the Codesteward CLI package shape where it fits this repository: `src/main.ts` exports a unit-testable `main(argv, io)` function, `esbuild.js` bundles a Node CJS executable with a `#!/usr/bin/env node` banner and `0o755` mode, `tsconfig.json` emits tests to `out`, and scripts include `check-types`, `compile`, `prepack`, `test:unit`, and `cli`. Keep package-local runtime code dependency-free unless implementation proves a focused protocol client dependency is materially safer than in-repo parsing.

3. Add root developer scripts following the Codesteward naming pattern: `cli`, `pack:cli`, `install:cli:local`, `uninstall:cli:local`, and `publish:cli`, alongside the existing editor packaging scripts. Document those commands in `DEVELOPING.md` rather than `AGENTS.md`, including the standard verification flow, local tarball install loop, and publish command. Keep `README.md` product-oriented and brief, linking to developer docs for maintainer workflows.

4. Define a narrow CLI contract for the editor to call. The MVP should support `--version`, `help`, a machine-readable health/capabilities command, and a prompt-submission command that accepts the originating workspace/document context and prompt text through structured stdin or a single JSON file path. Output intended for the VS Code extension should be newline-delimited JSON events with stable `kind` discriminators. Agent status is limited to `waiting`, `working`, and `blocked`; all other progress and output updates are freeform model-authored text events. Human-readable commands can remain plain text. The CLI should exit non-zero with useful stderr on validation, missing Codex, unsupported Codex versions, protocol startup, or provider-auth failures.

5. Implement the first provider adapter as `codex`, isolated behind an internal adapter interface so later Claude or mock adapters do not reshape the editor-facing CLI. The Codex path should prefer the app-server protocol researched in RES-0007 for managed thread/turn control, but implementation must regenerate or validate protocol types against the installed Codex version before binding to version-specific request shapes. Unsupported Codex versions should be reported cleanly rather than guessed around. If app-server proves unstable during implementation, fall back only to a deliberately documented one-shot `codex exec` mode and keep live steering out of scope for this slice.

6. Replace the Messages integration stub with extension-host orchestration that invokes the locally installed `sundial-editor-cli` from `PATH`. Provider selection belongs in the Sundial Agents panel, where each agent can be configured with a provider/model preset; the CLI receives that selected agent configuration rather than hard-coding provider choice in the extension. The extension sends accepted `%` prompt context to the CLI, renders lifecycle/status/output events in the Messages view, and keeps the keyboard loop from SPEC-0009: prompt line removal remains undoable, cancellation and completion return focus to the originating source location, and provider failures surface as recoverable user-facing status rather than source-document edits.

7. Keep this slice scoped to one managed Codex agent in the current dirty shared tree. It may start or resume one local session, stream visible progress, and allow interrupt/cancel if the provider surface supports it. It does not yet implement multi-agent awareness, annotation persistence, isolated worktrees, commit workflows, or provider selection UI beyond a conservative `codex` default and a test/mocked adapter seam.

## Rejected Alternatives

- Publish the CLI as part of `packages/editor`. The VS Code extension package and Node agent-control package have different runtimes, package metadata, release artifacts, and testing surfaces; keeping them separate matches the workspace layout already reserved by SPEC-0009.
- Call Codex VS Code commands directly from the editor extension. RES-0007 found no public command for arbitrary prompt submission or live steering, and direct extension internals would be harder to test than a local CLI boundary.
- Put developer command walkthroughs in `AGENTS.md`. That file is for agent operating policy and managed instruction blocks; maintainer workflows are easier to find and less noisy in `DEVELOPING.md`.
- Build provider control only as a webview client feature. Provider processes, local filesystem context, auth failure handling, and subprocess lifecycles belong in Node surfaces, not browser webview code.

## Test Plan

- Add CLI unit tests for argument parsing, `--version`, help output, unknown commands, stdin/file JSON validation, newline-delimited event rendering, exit-code behavior, and adapter error mapping. Use fake adapters and temporary directories; avoid real Codex subprocesses in unit tests.
- Add package-manifest tests covering `@arcridge/sundial-editor-cli`, its current version, Node engine, `bin`, public publish config, `files`, repository metadata, executable build script, and root package scripts for local pack/install/publish.
- Add process-level CLI integration tests around a deterministic fake Codex app-server. Cover initialization, paginated model discovery, advertised-default selection, explicit-model validation, thread/turn startup, streamed output, and representative RPC failures without requiring a real Codex login or model turn.
- Add focused extension unit tests for CLI path resolution, command invocation arguments, event parsing, provider-failure messages, and preservation of the SPEC-0009 prompt focus loop.
- Add staged VS Code integration coverage that submits a `%F` prompt through the Messages view using a deterministic fake CLI executable, verifies the prompt context reaches the CLI contract, streams fake status/output into the view state, and returns focus to the source editor after completion or cancellation. Do not require a real Codex login in integration tests.
- Run `npm run check-types`, `npm run lint`, `npm run test:unit`, and `npm test`. Per project instructions, run `npm test` elevated on the first attempt in a sandboxed Codex session because the VS Code runtime cache may need network access.
- Before publishing, run `npm pack` for `@arcridge/sundial-editor-cli`, inspect the tarball contents, install it locally with the documented developer command, and verify `sundial-editor-cli --version` and help from the global install.

## Implementation Log

- 2026-07-16: Planned the new `@arcridge/sundial-editor-cli` package using Codesteward's CLI package and developer-script layout as the reference shape. Created CAND-0004 to capture the docs split that keeps maintainer command walkthroughs in `DEVELOPING.md` rather than `AGENTS.md`.
- 2026-07-17: Folded review comments into the plan: the executable is `sundial-editor-cli`, the extension invokes the locally installed CLI from `PATH`, provider/model preset selection is owned by the Sundial Agents panel, unsupported Codex versions are reported explicitly, and the event vocabulary uses `waiting`, `working`, `blocked`, plus freeform model-authored updates.
- 2026-07-16: Added the publishable `@arcridge/sundial-editor-cli` 0.1.0 workspace package, dependency-free structured request/event protocol, unit-testable entry point, root packaging scripts, and a Codex adapter validated against regenerated Codex 0.131.0 app-server bindings. The adapter uses the stable initialize/thread/turn flow, a workspace-write sandbox with no interactive approvals, streamed agent-message deltas, interrupt handling, and explicit rejection of unvalidated Codex versions.
- 2026-07-16: Replaced the editor integration stub with extension-host CLI orchestration, strict event guards, streamed Messages activity, recoverable provider errors, cancellation, configurable `sundialEditor.cliPath`, and completion/cancellation focus restoration. Added a deterministic fake-CLI VS Code scenario and bumped the user-facing editor extension from 0.3.0 to 0.4.0.
- 2026-07-16: Updated maintainer and product documentation for CLI verification, packaging, installation, and Codex routing; the implementation constraints were already specified by SPEC-0010 and DR-0025/DR-0026.
- 2026-07-16: Refined the editor's product README after review by preserving its established wording and replacing only the obsolete no-agent-routing and integration-stub claims with a brief companion-CLI capability. Created CAND-0001 to retain that documentation discipline for future changes.
- 2026-07-16: Updated the Codex adapter to query the 0.131 `model/list` RPC before thread creation, follow pagination, resolve explicit model ids/strings only from the returned visible set, and pass the advertised default explicitly when no model is requested. Added a spawned fake-app-server integration harness covering lifecycle, selection, and RPC errors, bumped the behavior-changing CLI patch version to 0.1.1 per DR-0025, and proposed CAND-0002 for the durable provider model-discovery rule.
- 2026-07-16: Coalesced adjacent streamed output deltas without adding whitespace and rendered the accumulated response through bundled `markdown-it` with raw HTML disabled. Kept the editor at its existing uncommitted 0.4.0 release increment and rolled the user's committed-baseline version correction directly into the existing `AGENTS.md` guidance.

## Test Log

- 2026-07-16: `npm run check-types` passed for the CLI, extension host, and webview projects.
- 2026-07-16: `npm run lint` passed.
- 2026-07-16: `npm run test:unit` passed: 11 CLI tests and 36 editor tests, including request validation, event rendering/parsing, Codex compatibility errors, package manifests, CLI process orchestration, and SIGINT cancellation forwarding.
- 2026-07-16: `npm test` passed both pinned-runtime VS Code scenarios. The prompt scenario submitted `%F` context to a staged fake CLI, verified the captured request and streamed output, and confirmed source focus restoration.
- 2026-07-16: Local smoke checks passed for bundled `--version`, help, and `health`; health detected local Codex 0.131.0 as compatible. `npm pack --workspace packages/cli --dry-run` showed only `dist/main.js`, `README.md`, `LICENSE`, and `package.json`, and the bundled executable has mode `0o755`. A global install and publish were not performed because this implementation run was not a release operation.
- 2026-07-16: The four spawned-process Codex app-server integration tests passed, covering discovered-default selection, paginated explicit-model selection, pre-thread rejection of unavailable models, model-list errors, and the reproduced newer-Codex-required RPC error class.
- 2026-07-16: Broad verification passed after model discovery was added: `npm run check-types`, `npm run lint`, `npm run test:unit` (11 CLI and 36 editor tests), and `npm test` (4 CLI app-server integration tests plus both pinned-runtime VS Code scenarios).
- 2026-07-16: Broad verification passed after streamed Markdown rendering was added: `npm run check-types`, `npm run lint`, `npm run test:unit` (11 CLI and 37 editor tests), and `npm test` (4 CLI app-server integration tests plus both pinned-runtime VS Code scenarios). The prompt scenario emitted two Markdown-bearing output chunks and verified that the persisted run contained one exact concatenated output event.
