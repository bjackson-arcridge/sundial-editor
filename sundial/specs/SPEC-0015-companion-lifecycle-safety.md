---
id: SPEC-0015
title: Deep-link fixing during companion file moves
status: Todo
created: 2026-07-13
updated: 2026-07-21
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
- DR-0016 requires dependency-free store logic and structured Git arguments rather than shell pipelines.
- DR-0025 requires a CLI version review because repair behavior and returned affected paths change.

## Applicable Research Notes

None.

## Planned Approach

1. Keep `packages/cli/src/companionRepair.ts` and its existing Git classification, move/delete transaction, verification, `%cr`, and pre-commit integration as the baseline. Do not add a new command, UI surface, repair service, workspace graph index, or deletion behavior.
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

## Test Log
