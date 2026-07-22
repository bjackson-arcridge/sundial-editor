---
id: SPEC-0015
title: Deep-link fixing during companion file moves
status: Done
created: 2026-07-13
updated: 2026-07-22
created_by: bjackson
parent: SPEC-0008
domain: editor
slice: 7
---
# Deep-link fixing during companion file moves

## Discovery

SPEC-0012 already implemented companion repair from Git-reported renames and deletions, manual `%cr`, and repair before `%cf`, `%ca`, and `%cm`. This spec makes one focused behavior change: when repair moves a companion, it also updates the cross-file `AnnotationLink.file` values that point into or out of that companion.

The links are two-way. A moved user annotation lists its agent annotations, and each agent annotation links back to that user annotation. A moved agent annotation likewise identifies its user annotation, whose child list points back. Repair can therefore follow the links in the moved companion directly; it does not need to scan or index every companion in the workspace.

SPEC-0016 is being developed concurrently. SPEC-0015 updates link file paths after a companion move. SPEC-0016 updates annotation anchors and link line hints. Both mutations use the existing worktree-local annotation lock so their writes cannot overwrite one another.

## Applicable Decision Records

- DR-0012 keeps companion repair in the CLI-backed workflow rather than the extension or webview.
- DR-0025 requires a CLI version review because repair behavior and returned affected paths change.
- DR-0040 requires repair to share the worktree-local companion lock, validate all affected companions before moving files, and remain retry-safe.
- DR-0042 keeps repair and all other product annotation operations mediated through the CLI while permitting shared contracts and storage primitives.
- CAND-0001 places the annotation-specific Git commands and complete diff-driven repair policy in the annotations package behind `repairFromDiff`.

## Applicable Research Notes

None.

## Planned Approach

1. Preserve the existing Git classification, move/delete transaction, verification, `%cr`, and pre-commit behavior while moving their implementation to `packages/annotations/src/move.ts`. Have CLI workflows call the package-owned `repairFromDiff` entrypoint directly, without a forwarding module or alternate repair entrypoint. Do not add a new command, UI surface, workspace graph index, or deletion behavior.
2. Make the existing annotation lock available to companion repair. Hold it while reading linked companions, moving the companion, and writing link updates. SPEC-0016 uses the same lock for re-anchoring; no new locking scheme is introduced.
3. Build one old-to-new map for all Git-reported source renames in the repair. For each moved companion, follow its stored two-way links to the directly related companion files, translating a counterpart path through the same map when that file is also moving. Resolve counterparts by file and annotation ID, validate the bounded linked set and reverse links before the existing move transaction, and fail without overwriting unrelated content when a referenced pair is malformed or missing.
4. Update matching `AnnotationLink.file` values in the moved and counterpart companions, preserving annotation IDs, bodies, responses, permanent-base commits, anchors, and link line values. Keep repair retryable: if the companion has already reached its destination but some link paths are stale, a later `%cr` completes those updates. Write through the existing atomic YAML replacement path and return every changed companion in `affectedPaths`.
5. Associate the linked companion paths with the corresponding rename action so `%cf` includes the moved companion and its required counterpart-link updates when checkpointing that source. `%ca` and `%cm` retain their existing all-dirty behavior. The extension continues to use the existing repair result and refresh flow.
6. Add focused CLI tests. Treat this as a CLI bug-fix adjustment: review a patch increment from the committed CLI version under DR-0025, without changing the editor version or stacking a second increment if another uncommitted change already owns the release bump. No help text or capability documentation changes are expected because the command surface and advertised repair capability are unchanged.

## Rejected Alternatives

- Scan every `.comments` file to find inbound references: the stored reverse links already identify every counterpart that must change.
- Add an agent-facing move command or another repair entry point: `%cr` and the existing pre-commit repair calls already provide the required lifecycle trigger.
- Generalize this into deletion cascades, graph repair, symlink policy, or a new transaction framework: those are not required to correct link paths during an existing companion move.
- Let SPEC-0016 update file paths: re-anchoring owns line relocation, while rename repair owns file relocation.

## Test Plan

- Extend the disposable-repository repair test with a moved companion containing both user and agent annotations linked to other files. Verify both directions receive the new file path while IDs, content, anchors, and link lines remain unchanged.
- Cover same-file links, two linked companions moved in the same repair, multiple links to the same counterpart companion, nested paths, and paths with spaces without duplicating writes or affected paths.
- Cover retry after the companion is already at its destination with stale links, a missing or mismatched counterpart that fails without changing unrelated companions, and one focused check that repair serializes with another annotation mutation through the shared lock.
- Verify `workflow repair` returns all changed companion paths and `%cf` includes the linked counterpart companions required by the selected rename. Retain the existing rename, deletion, delete/add, rollback, `%cr`, `%ca`, and `%cm` tests as regression coverage.
- Run `npm run check-types`, `npm run lint`, `npm run test:unit`, and `git diff --check`. No new VS Code scenario is needed because the command and refresh surface are unchanged.

## Open Questions

None.

## Implementation Log

- 2026-07-21: Reused the worktree-local companion lock for Git repair, validated the bounded two-way link graph before moves, translated paths through one rename map, and made already-moved stale-link retries idempotent.
- 2026-07-21: Associated changed counterpart companions with their source rename so `%cf` stages the complete linked repair. The combined SPEC-0015/0016 release advances the CLI once to 0.8.0.
- 2026-07-22: Moved repair's companion parsing, stable reads, path mapping, validation, and staged writes onto the shared annotations package without changing its CLI-owned operation boundary.
- 2026-07-22: Completed the boundary by moving Git name-status invocation/classification, recoverable move/delete execution, and deep link-path repair into the annotations package. Removed the temporary CLI repair and line-diff forwarding modules; CLI workflows now call `repairFromDiff` directly and project its result only at the command boundary.

## Test Log

- 2026-07-21: Added disposable-repository coverage for linked retry, shared-lock serialization, affected paths, and scoped checkpoint inclusion. Types, lint, 168 unit tests, CLI integration, and the new annotation VS Code scenario pass.
- 2026-07-21: The broad `npm test` run passed all CLI integration and four editor scenarios, including annotation re-anchoring; the existing `diff-workflow` scenario failed twice at VS Code compare-side focus/timeout. No product behavior was changed for that harness-only failure under DR-0014.
- 2026-07-22: Added a direct annotations-package integration covering rename detection, companion movement, reciprocal path repair, and re-anchoring in one `repairFromDiff` call. The final 180-unit-test regression and all 11 CLI integration tests pass; the broad editor result remains four passing scenarios plus the previously recorded `diff-workflow` focus timeout.
- 2026-07-22: After removing the CLI forwarding modules, types, lint, all 180 unit tests, all 11 CLI integration tests, the CLI package dry-run, Sundial validation, and `git diff --check` pass.
- 2026-07-22: The repeated broad `npm test` run passed CLI integration plus `delayed-autosave`, `prompt-to-messages`, `annotation-retry`, and `annotation-reanchor`; the pre-existing `diff-workflow` compare-focus wait timed out again after reporting the expected managed-diff state.
