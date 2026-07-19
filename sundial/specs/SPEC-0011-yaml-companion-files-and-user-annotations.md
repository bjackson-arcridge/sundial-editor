---
id: SPEC-0011
title: YAML companion files and user annotations
status: Active
created: 2026-07-13
updated: 2026-07-19
created_by: bjackson
parent: SPEC-0008
domain: editor
slice: 3
---
# YAML companion files and user annotations

## Discovery

This is functional slice 3 from SPEC-0008. A message becomes an annotation only when the user sends it; opening or cancelling the composer does not create one. The annotation is stored beside its source in a checked-in YAML companion, survives restart, and appears in the Messages view when its anchored line is active.

## Applicable Decision Records

- DR-0003 through DR-0009 govern the existing Messages webview, including styling, accessibility, and its typed host protocol.
- DR-0012 keeps companion mutations behind the CLI-backed store.
- DR-0016 keeps CLI store parsing dependency-free.
- DR-0017 and DR-0026 require staged VS Code workspaces built against the local CLI.
- DR-0025 requires a CLI version review for the new annotation operations.

## Applicable Research Notes

None.

## Planned Approach

1. Add CLI operations to append and read user-command annotations. For `src/example.ts`, lazily create `.sundial/src/example.ts.comments` on the first append. Use compact, versioned YAML containing stable annotation IDs, the submitted message, preset, scope, and a one-line anchor with enough original source context for later re-anchoring. Validate before writing and leave an invalid existing companion untouched.
2. In the Messages Send path, deliver the message to the agent and append the annotation only after that handoff succeeds. Cancel, delivery failure, and merely opening the composer create nothing. A delivery failure keeps the composer available for retry; an annotation-write failure is retried without sending the message again. Prompt commands require a source file inside the current workspace because other documents have no valid companion path.
3. Load annotations for the active source file through the CLI on activation, editor changes, and companion-file changes. When the cursor enters an annotated line, its annotations take over the Messages view; leaving returns the view to normal. The user can pin an annotation before leaving: normal mode then occupies the top of a split view and the pinned annotation remains below until unpinned or replaced. Pinning is session UI state, not companion data.
4. Extend the typed webview protocol and Lit UI for annotation, pin, and split-view states, following DR-0003 through DR-0009. Document the feature in user terms as source-anchored LLM interactions, then apply the required editor minor-version bump and CLI version review.

## Rejected Alternatives

- Persisting when the command line is removed or the composer opens: the user has not sent anything and may still cancel.
- Storing annotations or pin state in VS Code extension storage: annotations must travel with the repository; pinning does not need to.
- Adding rename repair or re-anchoring behavior now: those remain in later SPEC-0008 slices.

## Test Plan

- Unit-test CLI path mapping, lazy append/read round trips, stable IDs, malformed files, multiple annotations on one line, and unsupported source URIs.
- Unit-test Send, Cancel, and failure behavior plus the typed UI states for takeover, return to normal, pin, split view, unpin, and replacement.
- In a staged VS Code scenario, send a message, inspect the companion, restart or reopen, activate its source line, and verify takeover and pin behavior. Then run `npm run check-types`, `npm run lint`, `npm run test:unit`, and elevated `npm test`.

## Open Questions

None.

## Implementation Log

## Test Log
