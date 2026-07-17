---
id: SPEC-0009
title: Sundial Editor package and prompt UX
status: Done
created: 2026-07-13
updated: 2026-07-17
created_by: bjackson
parent: SPEC-0008
domain: editor
slice: 1
---
# Sundial Editor package and prompt UX

## Discovery

This is functional slice 1 from SPEC-0008. It establishes the separate Sundial Editor VS Code extension package, rate-limited automatic saving, and the source-line-to-message-box prompt UX. Submitting a prompt stops at the UI boundary and does not yet contact an agent.

## Applicable Decision Records

- DR-0003 Webview UI uses Lit and @floating-ui/dom.
- DR-0004 Webview file layout follows the apps/providers split.
- DR-0005 Webviews enforce a strict nonce-based CSP.
- DR-0006 Webview UI meets baseline accessibility requirements.
- DR-0007 Webview styling uses only --vscode-* design tokens.
- DR-0008 Extension ↔ webview messages use typed discriminated unions.
- DR-0009 Sidebar sections use WebviewView, not TreeView.
- DR-0012 Sundial workflows live in the CLI-backed store.
- DR-0014 Separate harness failures from product fixes.
- DR-0015 Bundle Lit webviews with the webview tsconfig.
- DR-0017 VS Code tests use staged scenario workspaces.
- DR-0026 VS Code scenarios compile local CLI dist.

## Applicable Research Notes

- RES-0008 VS Code test CLI package-specific configs.
- RES-0009 VS Code delayed auto-save configuration.
- RES-0010 VS Code Secondary Sidebar view placement.
- RES-0011 VS Code test runtime download cache and signature behavior.
- RES-0012 VS Code completion trigger and post-insertion command behavior.
- RES-0013 VSCodeVim Ex command integration.

## Planned Approach

1. Keep the independently packaged `packages/editor` VS Code extension in this dedicated `sundial-editor` repository, published as `arcridge.sundial-editor` and now at version `0.3.0` after making command presets explicitly agent-neutral. The root npm workspace uses `packages/*`, retaining room for future CLI, VS Code, or MCP packages without moving the editor again. Give the package its own manifest, README, TypeScript configurations, esbuild host/browser builds, Sundial icon, and VSIX packaging script. It depends neither on the former governance extension nor on a Sundial CLI package. Its collaboration view targets VS Code's right-hand Secondary Sidebar, the workspace normally used for LLM chat panes.

2. Implement a small extension-host command and pure parser for an entire source line. A `%` in column zero enters Sundial command mode; supported lines are `%Q`, `%F`, `%W`, `%R`, `%C`, and `%T`, with an optional trailing `@G` modifier such as `%F @G`. Trailing horizontal whitespace is permitted, but leading whitespace, source text, unrecognised command forms, and malformed modifiers do not change the document. Commands provide only prompt guidance in this slice; none selects or routes to an agent.

3. Contribute `Sundial Editor: Submit Prompt` to the Command Palette and register a `%`-triggered completion provider for file and untitled documents. When `%` is the first character of the line, the provider offers line- and project-scoped variants of all six Sundial commands; accepting one inserts the complete command and invokes Submit Prompt. While the typed prefix remains a viable Sundial command, hide active inline suggestions so they do not compete with command selection. The submit command captures the document URI and source line, deletes the whole command line (including its line ending where present) in one undoable edit, then opens the message composer. It does not replace VS Code's normal type or Enter commands. If it cannot safely edit the active line, it reports the validation failure and does not open the composer.

4. Use VS Code's built-in delayed autosave rather than implementing a save coordinator. The editor extension contributes `configurationDefaults` for `files.autoSave: "afterDelay"` and `files.autoSaveDelay: 1000`, retaining VS Code's standard one-second default delay without modifying the user's settings files. VS Code owns saving, including its normal document eligibility and lifecycle behavior. User, workspace, folder, and language-specific settings retain their normal precedence and may override the default.

5. Add a `WebviewView` named Messages in a movable **Sundial Agents** view container contributed directly to VS Code's right-hand Secondary Sidebar rather than the primary code sidebar or any provider-owned chat UI. The stable `viewsContainers.secondarySidebar` contribution point is available throughout the extension's declared VS Code engine range. Activate on `onStartupFinished` and reveal the panel once after installation, recording success in extension global state so later startups respect the user's decision to close or relocate it. Give the view an icon so it remains identifiable if the user relocates it. Its host provider lives under `src/webviews/messages/`, its Lit client under `src/webviews/apps/messages/`, and shared client helpers under `src/webviews/apps/shared/`. The provider keeps a pending prompt context until the lazily resolved view is visible, then focuses the composer. It uses the established nonce CSP renderer, `asWebviewUri` assets only, `tsconfig.webview.json`, and a `kind`-discriminated, runtime-validated protocol in both directions.

6. Render the captured preset and scope as read-only context above an accessible textarea with Send and Cancel controls. Prefill the textarea with deterministic text labelled `[Integration stub]` so this slice visibly proves the editor-command-to-Messages handoff without implying an agent response. In the textarea, Enter submits, Shift+Enter inserts a newline, IME composition is not intercepted, and Escape cancels. Both submission and cancellation return focus to the originating editor URI and source line for a keyboard-only loop. When the enabled VSCodeVim extension is present, activate it if necessary and send its Escape command after restoring editor focus so navigation resumes in Vim Normal mode; do not enter Vim's `:` Command-line mode. The client and host use semantic form controls, visual-order Tab navigation, visible token-based focus styling, and only `--vscode-*` colors/fonts. A submitted message is acknowledged and cleared at the webview boundary, but is neither written to the source document nor persisted, sent to a CLI, or delivered to an agent. A later slice owns annotation persistence and agent routing.

7. Give the new package a package-local VS Code test configuration and staged scenario workspace, while the root test script runs every workspace test script. This keeps the existing governance extension harness intact and lets the editor extension compile, stage, and launch its own extension-development path without sharing fixture state or user-data directories.

## Rejected Alternatives

- Add the editor behavior to `packages/vscode`. The editor needs an independently installable collaboration surface and must not couple its activation, release, or dependencies to the existing governance extension.
- Use `vscode.window.showInputBox` for prompts. A native input box would bypass the persistent message composer needed by the next slice and would not exercise the typed extension-host/webview boundary required for this editor UI.
- Implement an extension-owned per-document save coordinator. VS Code already provides delayed autosave, including the two settings needed for this slice; a custom scheduler would duplicate core editor behavior and needlessly add lifecycle and timing logic.
- Treat the primary left sidebar or a provider-owned Codex/Claude Code chat pane as the editor's collaboration surface. The message composer belongs in its own container in the user-customizable Secondary Sidebar; users may still move it through VS Code's layout controls.
- Override VS Code's standard type or Enter commands. The `%` trigger and public completion-item command provide command-mode behavior without intercepting ordinary typing or replacing core editor commands.
- Persist, annotate, or dispatch the entered message now. SPEC-0008 assigns delivery to Function 2 and command annotations to Function 3; this slice proves the UI handoff only.

## Test Plan

- Add pure unit tests for every accepted `%` preset and `@G` form, rejected standalone-line variants including leading whitespace and legacy syntax, completion filtering, command-line deletion ranges for first/middle/final lines, deterministic stub text, and preserved original source context.
- Test the manifest's `configurationDefaults` for `files.autoSave: "afterDelay"` and `files.autoSaveDelay: 1000`; no extension-host save scheduler is implemented or unit-tested.
- Test both message-union guards against valid messages and malformed/unrecognised values, plus provider HTML for the nonce CSP, local resource URIs, and absence of unsafe CSP directives.
- Add manifest/package tests covering the independent extension id, the **Sundial Agents** Secondary Sidebar container, its message `WebviewView` and icon, startup activation, Command Palette command, build entries, autosave defaults, absence of governance-extension dependencies, and current package version. Unit-test that first activation reveals and records the panel, later activations do not take focus, and a failed reveal remains retryable.
- Add staged extension-host scenarios that (a) verify VS Code's effective one-second default saves the latest change without an explicit user save and (b) query `%` completions, submit a real source command, verify its line is removed, focus the actual Messages WebviewView, and assert the host state contains the expected prompt plus integration-stub draft. Keep DOM details unit-tested through host/client seams rather than depending on unsupported native webview DOM automation.
- Run `npm run check-types`, `npm run lint`, `npm run test:unit`, and `npm test`. Before merge, visually verify the message composer in Default Light, Default Dark, High Contrast, and High Contrast Light themes, including focus order, Escape, and return-to-editor behavior.

## Open Questions

None for this slice. Commands are deliberately agent-neutral until the agent-routing slice defines a dynamic targeting model; `@G` is accepted as an optional trailing modifier and is UI-only until command annotation persistence exists.

## Implementation Log

- 2026-07-13: Added the independently packaged `packages/editor` extension at version `0.1.0`, including its manifest, README, copied icons/license, TypeScript configurations, Lit browser bundle, VSIX script, and package-local staged VS Code test configuration. The root workspace and test script now include the editor package without changing the governance extension or CLI packages.
- 2026-07-13: Implemented the standalone-line prompt parser, one-edit command-line removal, preserved prompt context, and safe failure handling. The `sundialEditor.submitPrompt` command opens the pending Messages composer only after VS Code accepts the deletion.
- 2026-07-13: Implemented the Messages `WebviewView` with a strict nonce CSP, local resources, runtime-validated discriminated messages, accessible textarea/form controls, explicit Send acknowledgement, and Escape cancellation that returns focus to the originating document. Submission intentionally stops at the webview boundary.
- 2026-07-13: Ensured a pending prompt supplied in the initial lazy-webview state focuses the textarea immediately after Lit's first render.
- 2026-07-13: Applied the corrected standard 1000 ms autosave delay. Created CAND-0003 to retain that product guidance for review.
- 2026-07-13: Added project guidance requiring elevated-network execution for `npm test` so VS Code runtime downloads do not first fail in the restricted sandbox.
- 2026-07-13: Pinned both VS Code integration harnesses to 1.118.1. This avoids mutable-Insiders cache replacement prompts while remaining within the declared extension engine range.
- 2026-07-13: Consolidated both integration harnesses onto one pinned, project-managed runtime in the root `.vscode-test` cache. Each package pretest now verifies or downloads the runtime without relying on a machine VS Code installation, then the test CLI's supported `useInstallation.fromPath` field launches that exact project-cache executable. On macOS an unverifiable cache is discarded; only a fresh checksum-validated official download may receive the disposable local ad-hoc signature needed to keep a transiently invalid archive from reaching Gatekeeper.
- 2026-07-13: Corrected the initial placement assumption after comparison with the installed Codex and Claude Code manifests and the VS Code 1.106 release notes. Messages now uses the stable `viewsContainers.secondarySidebar` contribution directly; the extension's `^1.109.0` engine range needs no Activity Bar fallback or first-use relocation instructions.
- 2026-07-13: Renamed the visible Secondary Sidebar container to **Sundial Agents** and added `onStartupFinished` activation with a global-state-guarded first-install reveal. The completion flag is stored only after both container and view focus commands succeed, so failures remain retryable while later startups preserve the user's layout choice.
- 2026-07-13: Replaced the punctuation-ambiguous legacy presets with column-zero `%` commands. Added `%`-triggered line/project completions that invoke submission after insertion, hide active inline suggestions during viable command prefixes, and prefill Messages with deterministic `[Integration stub]` text so this slice visibly verifies editor integration without an agent.
- 2026-07-13: Bumped the independently versioned editor extension from `0.1.0` to `0.2.0` for the added command-mode and integration-stub functionality.
- 2026-07-13: Changed the Messages textarea keyboard contract to Enter = Send and Shift+Enter = newline while preserving Escape cancellation, explicit buttons, and IME composition. Bumped the editor extension patch version to `0.2.1`.
- 2026-07-13: Completed the keyboard-only loop by returning focus to the originating editor and source line after submission, matching cancellation behavior. Bumped the editor extension patch version to `0.2.2` and extended the prompt-to-Messages desktop scenario to verify the focus handoff.
- 2026-07-16: Added a best-effort VSCodeVim handoff after source-focus restoration: when `vscodevim.vim` is available, the editor extension activates it if needed and executes its Escape command so the restored cursor is in Vim Normal mode for navigation. The non-Vim path is unchanged, Vim `:` Command-line integration remains deferred, and the editor extension patch version is now `0.2.3`.
- 2026-07-16: Replaced numbered prompt presets with agent-neutral `%F`, `%W`, `%R`, `%C`, and `%T` forms, preserving `%Q` and `@G` project scope without implying agent selection or routing. Renamed the webview protocol validators and direction-sensitive state variables, inlined exhaustive-union checks at their switch sites, used Node's URL-safe cryptographic nonce encoding, and made the best-effort VSCodeVim handoff explicitly `Promise<void>`. Bumped the editor extension minor version to `0.3.0`.
- 2026-07-16: Extracted the editor package and its roadmap into the dedicated `sundial-editor` repository. The package remains at `packages/editor`; the root workspace uses `packages/*` for future packages, carries its own pinned-runtime helpers and Sundial initialization, and retains the relevant specs, research, candidate, and inherited decision records.

## Test Log

- 2026-07-13: Passed `npm run check-types`, `npm run lint`, and `npm run test:unit` (including 16 editor-package unit tests covering parser, deletion, command seams, message guards, CSP, and manifest behavior).
- 2026-07-13: Passed `npm --workspace packages/editor run test` against the pinned VS Code 1.118.1 runtime; the staged `delayed-autosave` scenario verified a save after the 1000 ms default without an explicit save command.
- 2026-07-13: Built `sundial-editor-spec-0009.vsix` successfully from the editor package into `/private/tmp`.
- 2026-07-13: Full `npm test` passed twice before the test configuration was changed to the pinned 1.118.1 runtime. A later full run failed before any governance test began because the existing `packages/vscode/.vscode-test` 1.118.1 runtime exited with `SIGKILL`; the editor package's same pinned runtime passed independently. Per DR-0014, this is recorded as a harness failure rather than a product change.
- 2026-07-13: Removed only the incomplete, gitignored 1.118.1 test-runtime caches and reran the full suite with approved network access. `npm test` then passed all three governance scenarios and the editor delayed-autosave scenario using clean cached runtimes.
- 2026-07-13: Verified the shared prepared runtime with strict deep code-signature validation outside the restricted agent sandbox. The same check can report a false invalid signature inside the filesystem sandbox, which is why the documented first attempt uses elevated execution for both preparation and launch.
- 2026-07-13: Passed the required broad regression set after installing the permanent shared-runtime harness: `npm run check-types`, `npm run lint`, `npm run test:unit` (151 tests across all workspaces), and `npm test` (all three governance scenarios plus the editor's 1000 ms delayed-autosave scenario). The full integration command reused the verified project cache for both extension packages and did not use an installed VS Code application.
- 2026-07-13: Repeated the full required regression suite after the initial-composer-focus refinement; `npm run check-types`, `npm run lint`, `npm run test:unit`, and `npm test` all passed.
- 2026-07-13: Repeated the broad regression set after replacing test-cli's undeclared `cachePath` pass-through with its supported `useInstallation.fromPath` launch of the helper-downloaded cache and adding stale-cache executable checks. Type checking, lint, all 151 unit tests, and all four integration scenarios passed.
- 2026-07-13: Manual visual verification in Default Light, Default Dark, High Contrast, and High Contrast Light remains outstanding; this environment can launch extension-host scenarios but cannot perform the required interactive theme inspection.
- 2026-07-13: Passed focused editor verification for the `%` command revision: package host/webview type checks, repository lint, and all 26 editor unit tests. The new `prompt-to-messages` desktop scenario passed against pinned VS Code 1.118.1, verifying a `%F` completion wired to Submit Prompt, command-line removal, a resolved and visible Messages WebviewView, and the exact integration-stub draft state.
- 2026-07-13: Passed the required broad regression set after the `%` command and integration-stub implementation: `npm run check-types`, `npm run lint`, `npm run test:unit` (160 tests across all workspaces), and `npm test` (three governance scenarios plus editor autosave and prompt-to-Messages scenarios). Packaged `/private/tmp/sundial-editor-0.2.0.vsix` successfully.
- 2026-07-13: Passed the focused `0.2.1` composer-keyboard verification: editor host/webview type checks, repository lint, `git diff --check`, all 28 editor unit tests, and production VSIX packaging to `/private/tmp/sundial-editor-0.2.1.vsix`. The desktop integration suite was not repeated because the immediately preceding broad run had passed the unchanged extension-host protocol and this patch is isolated to a pure-tested webview key mapping.
- 2026-07-13: Passed the focused `0.2.2` focus-restoration verification: editor host/webview type checks, repository lint, `git diff --check`, all 29 editor unit tests, and the pinned desktop `prompt-to-messages` scenario. The scenario now acknowledges the pending submission and verifies the originating URI is the active editor with its cursor restored to source line 1, column 1. Packaged `/private/tmp/sundial-editor-0.2.2.vsix` successfully.
- 2026-07-16: Reverified the `0.2.2` keyboard-only submission loop with editor host/webview type checks, repository lint, all 29 editor unit tests, and the pinned `prompt-to-messages` desktop scenario. The scenario now also runs `cursorRight` after submission and verifies that VS Code routes the command to the restored source cursor, rather than merely retaining the source as `activeTextEditor` while the webview owns input focus.
- 2026-07-16: Passed focused `0.2.3` VSCodeVim handoff verification: editor host/webview type checks, repository lint, all 33 editor unit tests, production packaging, and `git diff --check`. Unit coverage verifies absent, inactive, active, and failing VSCodeVim paths. The isolated desktop harness disables other extensions by design, so a live VSCodeVim mode transition was not claimed from that harness.
- 2026-07-16: Passed the full regression set after the agent-neutral command and naming cleanup: `npm run check-types`, `npm run lint`, `npm run test:unit` (167 unit tests across all workspaces), and `npm test` (three governance scenarios plus the editor delayed-autosave and `%F` prompt-to-Messages scenarios). The integration run verified the cached project-managed VS Code 1.118.1 runtime rather than a machine-wide installation.
- 2026-07-16: Verified the extracted `sundial-editor` workspace with `npm run check-types`, `npm run lint`, and all 33 editor unit tests. Its standalone `npm test` downloaded, checksum-validated, and prepared its own project-local VS Code 1.118.1 runtime, then ran the delayed-autosave and prompt-to-Messages integration scenarios successfully.
