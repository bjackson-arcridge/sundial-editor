---
id: SPEC-0011
title: YAML companion files and user annotations
status: Done
created: 2026-07-13
updated: 2026-07-19
created_by: bjackson
parent: SPEC-0008
domain: editor
slice: 3
---
# YAML companion files and user annotations

## Discovery

This is functional slice 3 from SPEC-0008. A message becomes an annotation only when the user sends it; opening or cancelling the composer does not create one. A standalone user command anchors to the immediately preceding physical source line, falling forward only when it is the first line. The annotation is stored beside its source in a checked-in YAML companion, survives restart, and appears in the Messages view when its anchored line is active.

## Applicable Decision Records

- DR-0003 through DR-0009 govern the existing Messages webview, including styling, accessibility, and its typed host protocol.
- DR-0012 keeps companion mutations behind the CLI-backed store.
- DR-0016 keeps CLI store parsing dependency-free.
- DR-0017 and DR-0026 require staged VS Code workspaces built against the local CLI.
- DR-0025 requires a CLI version review for the new annotation operations.

## Applicable Research Notes

None.

## Planned Approach

1. Add CLI operations to append, read, and delete user-command annotations. For `src/example.ts`, lazily create `.sundial/src/example.ts.comments` on the first append. Anchor a user command to the immediately preceding physical line, with a following-line fallback for a command on line one. Use compact, versioned YAML containing stable annotation IDs, the submitted message, preset, scope, and the target plus its previous three and next three non-empty source lines for later re-anchoring. Validate before writing and leave an invalid existing companion untouched.
2. In the Messages Send path, append the annotation when the user submits the message, independently of whether the agent later succeeds, fails, or is cancelled. Merely opening or cancelling the composer before Send creates nothing. Persistence and delivery failures retain independent retries so neither retry duplicates the operation that already succeeded. Prompt commands require a source file inside the current workspace because other documents have no valid companion path.
3. Load annotations for the active source file through the CLI on activation, editor changes, and companion-file changes. Mark every annotated source line in the text editor. Visiting an annotated line selects it in the annotation section without hiding normal agent messages; leaving the line retains the last annotation. Pinning prevents later cursor movement from replacing the selected annotation. A toolbar provides previous, next, delete, pin, and maximize/restore takeover actions. Pin and takeover are session UI state, not companion data.
4. Present the sidebar as two independently scrollable vertical sections: agent status and messages above, annotations below. They initially divide the available height equally and share a keyboard-accessible draggable separator that lets the user resize both sections. The annotation toolbar identifies the named source, initially `User %Q`-style labels, and exposes metadata disclosure separately from the default message view. Scope, line, and the retained anchoring context appear only in the collapsed-by-default metadata. Toolbar icons use the primary VS Code icon color and every icon button provides both an accessible name and hover text. Extend the typed webview protocol for these interactions following DR-0003 through DR-0009, document the feature in user terms, and apply the required editor minor-version bump and CLI version review.

## Rejected Alternatives

- Persisting when the command line is removed or the composer opens: the user has not sent anything and may still cancel.
- Storing annotations or pin state in VS Code extension storage: annotations must travel with the repository; pinning does not need to.
- Adding rename repair or re-anchoring behavior now: those remain in later SPEC-0008 slices.

## Test Plan

- Unit-test CLI path mapping, lazy append/read round trips, stable IDs, malformed files, multiple annotations on one line, unsupported source URIs, context ordering/limits, whitespace filtering, and older entries without context arrays.
- Unit-test Send, pre-Send Cancel, independent delivery/persistence failure behavior, deletion, and the typed viewer state for retained selection, pinning, navigation, and replacement.
- Unit-test the 50/50 splitter default, pointer clamping, and keyboard increments. In a staged VS Code scenario, send a message, verify the companion exists before the agent completes, inspect the editor marker, restart or reopen, activate its source line, and verify retained selection, pinning, navigation, and deletion. Then run `npm run check-types`, `npm run lint`, `npm run test:unit`, and elevated `npm test`.

## Open Questions

None.

## Implementation Log

- 2026-07-19: Added dependency-free CLI companion storage and public `annotations append` / `annotations read` operations. Sources map into the mirrored `.sundial/` tree, files use strict version-1 YAML with JSON-quoted scalars, IDs are UUID-backed and stable, missing companions read as empty, and validated updates replace through a same-directory temporary file.
- 2026-07-19: Added workspace/file validation and captured the post-command source line before deleting the prompt command. Refined the anchor to retain the previous three and next three non-empty lines in source order, while accepting earlier version-1 entries without the optional arrays. Proposed CAND-0004 to preserve the bounded-context rule for later re-anchoring work.
- 2026-07-19: Initially split successful agent delivery from annotation persistence in the Messages provider. This sequencing was later corrected because it mistook post-Send agent completion for the intended pre-Send cancellation boundary; no decision candidate was retained for the superseded sequencing.
- 2026-07-19: Added active-source loading on activation/editor changes and companion watcher events, line takeover, session pinning, split normal/pinned presentation, unpinning, and stable-ID pin replacement through the typed webview protocol and Lit UI.
- 2026-07-19: Documented source-anchored interactions and bumped the editor from 0.4.0 to 0.5.0. Reviewed the changed public CLI surface and bumped the CLI from 0.1.1 to 0.2.0 with matching lockfile metadata.
- 2026-07-19: Reviewed the expanded anchor payload against the already-uncommitted release metadata; it remains part of the same editor 0.5.0 and CLI 0.2.0 feature release, so no stacked version bump was applied.
- 2026-07-19: Changed standalone user commands to anchor to the immediately preceding physical line because prompts normally react to code already read. Commands on the first line fall forward to the following line. Context collection excludes the deleted command and remains relative to the selected target. Proposed CAND-0005 to preserve this convention.
- 2026-07-19: Named the staged editor fixture executables `testable-cli.js`: they are partially functional implementations with added request inspection, deterministic provider output, delivery counting, and fault injection. Real integration implementations remain preferred when those additional controls are unnecessary.
- 2026-07-20: Corrected Send as the annotation commit boundary. Annotation persistence and agent delivery now start as independent consequences of submission, cancellation after Send retains the annotation, and retry state remembers which operation already succeeded. Proposed CAND-0002 to retain this distinction.
- 2026-07-20: Added atomic `annotations delete`, theme-aware source-line markers, retained viewer selection, explicit pinning, previous/next navigation, confirmed deletion, and an annotation pane with named source, collapsed anchoring metadata, and maximize/restore takeover.
- 2026-07-20: Refined the sidebar into independently scrolling agent and annotation sections with an initial 50/50 split and a pointer- and keyboard-resizable separator. Changed toolbar buttons to the primary VS Code icon foreground and added hover titles matching their accessible names. Proposed CAND-0001 for the split-section contract.
- 2026-07-20: Reviewed release metadata under DR-0025. Delete and the revised editor behavior remain part of the same uncommitted CLI 0.2.0 and editor 0.5.0 feature releases, so no stacked version increment was applied.

## Test Log

- 2026-07-19: `npm run check-types` passed for CLI, extension host, and webview configurations.
- 2026-07-19: `npm run lint` passed.
- 2026-07-19: `npm run test:unit` passed: 17 CLI unit tests and 42 editor unit tests, covering path mapping, round trips, stable/multiple annotations, malformed companions, unsupported sources, CLI invocation/guards, workspace validation, preceding-line selection and first-line fallback, bounded context ordering and whitespace filtering, older context-free entries, takeover state, and pin replacement.
- 2026-07-19: Elevated `npm test` passed: 4 CLI app-server integration tests and all three staged VS Code scenarios (`delayed-autosave`, `prompt-to-messages`, and `annotation-retry`). The prompt scenario verifies companion content, reload, line takeover, pin/split/unpin; the retry scenario verifies one agent delivery across a failed append and successful save-only retry, then verifies opening and cancelling a new composer leaves the companion unchanged.
- 2026-07-19: Re-ran the complete broad regression set after expanding anchor context and switching to preceding-line targets. Typecheck, lint, all 59 unit tests, all 4 CLI integration tests, and all 3 staged VS Code scenarios passed; the prompt scenario verifies target selection plus persisted `before` and `after` arrays through reload.
- 2026-07-19: After renaming the controlled fixtures to `testable-cli.js`, typecheck, lint, all 4 CLI integration tests, and all 3 staged VS Code scenarios passed. The prompt scenario now waits for the one-time Messages reveal before opening its editor, isolating first-run harness focus timing per DR-0014.
- 2026-07-20: `npm run check-types`, `npm run lint`, and `npm run test:unit` passed with 18 CLI and 42 editor unit tests. Coverage now includes CLI deletion, typed viewer actions, line selection, and independent retry state.
- 2026-07-20: Elevated `npm test` passed after fixing the save-only retry terminal state: all 4 CLI app-server integration tests and all 3 staged VS Code scenarios passed. The prompt scenario verifies persistence and marker visibility before agent completion, retained selection, previous/next navigation, pin replacement protection, reload, and deletion; the retry scenario verifies no duplicate delivery and no pre-Send cancellation write.
- 2026-07-20: Final decision-aware review added overlapping-submission protection, cleared pin state when deleting the selected annotation, and added toolbar arrow-key/Escape behavior. The complete typecheck, lint, 60-unit-test, 4 CLI integration-test, and 3 VS Code scenario set passed again; `git diff --check` and the webview color-token audit were clean.
- 2026-07-20: The two-section panel refinement passed workspace typecheck and lint, 18 CLI unit tests, 46 editor unit tests, all 4 CLI integration tests, and all 3 pinned-runtime VS Code scenarios. Splitter unit coverage verifies the 50/50 default, pointer clamping, and fine/coarse keyboard controls; source assertions cover independent overflow, toolbar hover titles, and primary icon-token use. Final review found no CSP, accessibility, theme-token, or scroll-containment findings; `git diff --check` remained clean.
