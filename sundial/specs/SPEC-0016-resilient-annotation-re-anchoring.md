---
id: SPEC-0016
title: Resilient annotation re-anchoring
status: Done
created: 2026-07-13
updated: 2026-07-22
created_by: bjackson
parent: SPEC-0008
domain: editor
slice: 8
---
# Resilient annotation re-anchoring

## Discovery

This is functional slice 8 from SPEC-0008, deliberately narrowed to one mechanism: use a standard line-oriented text diff between the previous saved source and the current saved source to translate annotation line numbers. Do not add an LLM, fuzzy/context matcher, AST analysis, confidence scoring, or user-selectable strategy in this slice. Those can be layered on later if ordinary diff behavior proves insufficient.

The current version-4 companion records a fixed zero-based line plus the target text and up to three non-empty context lines on each side. The editor can retain the last source text it successfully processed, so a conventional diff can provide old-line-to-new-line correspondence without inventing a second matching system.

An unchanged old line maps directly to the corresponding new line. When the annotated old line was deleted or replaced, use the closest surviving line before it and the closest surviving line after it from the same edit script, then choose the midpoint of their new line numbers. This intentionally accepts the diff algorithm's ordinary choices for repeated or moved text. If only one side survives, use the adjacent valid line on that side. If neither side survives, or the new file has no line, leave the annotation at file scope.

SPEC-0015 and SPEC-0021 are being built in parallel. SPEC-0015 owns source/companion rename and delete repair; this spec only re-anchors a companion at its already-resolved source path. SPEC-0021 may share private agent/session/work state across linked worktrees, but annotation companions and their source baselines remain worktree-local.

## Applicable Decision Records

- DR-0009 preserves the existing Messages `WebviewView` surface.
- DR-0012 keeps anchor, companion, and cross-link mutation in the CLI-backed store; the extension only determines visibility and schedules operations.
- DR-0014, DR-0017, and DR-0026 govern the staged VS Code harness and require it to exercise the locally compiled CLI.
- DR-0025 requires a CLI package version review for the new re-anchor command.
- DR-0033 preserves delayed autosave behavior, so automatic re-anchoring waits for saved source content rather than forcing a save.
- DR-0034 Agent runtime state uses per-session update histories, DR-0036 User annotations are queued agent work items, and DR-0037 Queue readiness uses persisted session state: re-anchoring changes annotation presentation, not the immutable work-at-submission snapshot or agent lifecycle.
- DR-0035 Official responses reuse originating annotation identity: no re-anchor result creates or replaces annotation or response IDs.
- DR-0039 Rapid prototypes keep only current formats: update the companion schema, protocols, fixtures, and tests together without retaining predecessor readers.
- DR-0040 serializes every companion mutation through one worktree-local lock, requires complete pre-write validation, and requires retry-safe cross-file operations.
- DR-0041 permits the pinned, bundled, contract-tested standard diff implementation while keeping simple parsing and mutation in shared project code.
- DR-0042 keeps every product annotation read and mutation mediated through the CLI even though contracts and storage primitives live in a shared TypeScript package.
- CAND-0001 places annotation-specific Git commands, move/delete classification, deep link repair, and source re-anchoring behind the annotations package's single `repairFromDiff` entrypoint while retaining the CLI as product gateway.

## Applicable Research Notes

- RES-0014 documents the `diffArrays` contract, abort controls, package characteristics, and local differential/performance probes used to select the library.

## Planned Approach

1. Advance the companion to one current version with two small additions: a companion-level SHA-256 digest of the saved source version against which its anchors are expressed, and `number | null` for both `AnnotationAnchor.line` and `AnnotationLink.line`. A numeric line is line-scoped; `null` is file-scoped. Keep the existing `text`, `before`, and `after` fields, refreshing them after a successful mapping and retaining them when the result is file-scoped. Update the CLI/editor protocols, fixtures, and tests together without compatibility branches under DR-0039.
2. Keep the last successfully processed saved text in extension memory for each open source. On initial load, compare the current saved text with the companion digest. If they agree, start tracking it. If they disagree and the extension does not have the prior text, adopt the current text as the new baseline without guessing a move: retain in-range numeric anchors, change out-of-range anchors to file scope, and update their context only when still line-scoped. This is an explicit first-release limitation for edits that happened while Sundial was not observing the file.
3. Use the pinned `diff` package's `diffArrays` implementation of Myers over normalized physical-line tokens in `packages/annotations/src/reanchor.ts`. Convert its unchanged token runs into an ordered map from surviving zero-based old line numbers to zero-based new line numbers. Do not add context scoring or special handling for moves, repeated text, whitespace, or programming languages; the stable edit script is authoritative.
4. Translate each annotation with that single map. If its old line survives, use the mapped line. Otherwise find the nearest mapped old line before and after it. With both bounds, choose `floor((previousNewLine + nextNewLine) / 2)`, so an exact half-line tie favors the preceding side. With only a preceding bound, choose the following line if one exists, otherwise the bound itself. With only a subsequent bound, choose the preceding line if one exists, otherwise the bound itself. With no mapped bound, an already file-scoped annotation, or an empty new file, use file scope. Clamp every numeric result to the new file and rebuild `text`, `before`, and `after` from that line.
5. Expose one CLI-owned `annotations reanchor` operation. Its validated request contains the workspace, saved document URI, previous saved text, and the expected previous-source digest; the CLI reads the current source through the existing stable-read boundary. It rejects a previous-text/digest mismatch, computes one diff for the entire companion, updates all annotations in that source together, and returns the complete refreshed companion plus changed and file-scoped IDs. If the current digest is already recorded, the request is an idempotent no-op. There is no strategy flag, provider call, manual line override, or agent-specific re-anchor command.
6. Apply the companion and reciprocal-link updates under the worktree-local companion lock required by DR-0040. Validate the source and every affected companion before the first write. When an annotation line changes, update its stable-ID link in the counterpart companion to the new line or `null`. SPEC-0015 repair uses the same lock but remains solely responsible for moves and deletes; this spec never infers a rename. Queued work retains its request-time source location, while return navigation resolves the current annotation by stable ID.
7. Schedule re-anchoring only for the active source after its current contents have been saved. Coalesce concurrent requests and retain the required 30-second in-memory TTL per workspace/source; the next allowed attempt diffs the last successfully processed saved text directly to the newest saved text, so skipped intermediate saves need no special treatment. Update the in-memory baseline only after a successful or already-applied CLI result. Diff all annotations in the active source's companion, including those hidden by the current permanent-commit filter, because they share one source baseline. Companion watcher events, cursor movement, and filter changes do not trigger re-anchoring.
8. Present `line: null` clearly in the existing Messages `WebviewView`: show a `File` location badge, render no line decoration, and do not select the annotation from cursor movement. File-scoped annotations remain available in previous/next navigation. Opening a file-scoped cross-link opens the file and selects the annotation by stable ID without claiming a line. Do not add semantic-recovery controls in this slice.
9. Document the user-facing automatic re-anchoring and file-scope behavior without describing the schema or algorithm in package READMEs. Review the editor version as one minor increment from the committed manifest and the CLI version under DR-0025, reconciling with Specs 15 and 21 so the parallel work shares each package's single uncommitted release increment.
10. Consolidate the annotation contracts, companion codec, safe path mapping, stable file I/O, lock, operation-scoped working set, Git diff conventions, move/delete transaction, deep link repair, and source re-anchoring in the private shared TypeScript annotations package. Organize the repair engine as `reanchor.ts`, `move.ts`, and the primary `repair.ts` entrypoint. `repairFromDiff` runs the package-owned Git status commands, holds one lock, plans path changes, repairs deep file links, applies the supplied saved-source diff, validates the complete affected set, and then commits the filesystem changes. Keep every product annotation read and mutation mediated through the CLI under DR-0042: CLI commands project the shared result onto their existing protocols, while the editor consumes shared contracts and validators but never reads companion files directly.

## Rejected Alternatives

- Let VS Code edit anchor lines or reciprocal links directly: visibility belongs to the host, but companion mutation and validation remain CLI-owned under DR-0012.
- An LLM re-anchor operation: defer it until evidence shows that line-diff mapping is inadequate. This slice has no model selection, prompts, structured model output, provider turns, or model test set.
- Fuzzy context, edit distance, AST matching, move detection, or confidence scoring: defer all of them so there is only one predictable algorithm and fallback rule.
- Persist full source snapshots in companions or a checked-in cache: the first slice retains only a digest in the companion and the previous saved text in extension memory, avoiding large or duplicated repository data.
- Use a Git commit as the universal old source: annotations may be created against saved dirty content that does not exist in that commit.
- Re-anchor only diff-filter-visible annotation IDs: advancing a shared source baseline for only part of a companion would make hidden anchors refer to the wrong old version.
- Rewrite the immutable queued-work source when an annotation moves: work state is the request-time execution/audit snapshot and may be shared by SPEC-0021; navigation should resolve the annotation's stable ID instead.
- Infer a companion rename when a requested source companion is absent: source/companion lifecycle is SPEC-0015's Git-status-driven responsibility.
- Maintain a bespoke Myers search and backtracking implementation: differential probes showed the mature `diff` package produced the same required maps, while its optimized edit-graph traversal and abort controls reduce performance and maintenance risk.
- Let the editor use the shared Node store to bypass the CLI for reads: this would split source/permanent-commit enrichment and cache invalidation across processes. The shared package removes duplicate implementation without creating a second operational gateway.

## Test Plan

- Contract-test the library-backed edit map for unchanged files, insertions, deletions, replacements, repeated lines, blank lines, CRLF normalization, and deterministic output.
- Unit-test anchor translation for a directly mapped line, a replacement span, adjacent surviving bounds, midpoint rounding, each one-sided boundary, no surviving lines, an empty new file, and retained file scope.
- Unit-test the current companion/protocol format, source-digest validation, context refresh, identity preservation, `number | null` links, whole-companion updates, already-applied no-ops, stable source reads, complete validation before writes, reciprocal-link updates, and lock serialization with append/delete/response and SPEC-0015 repair.
- Unit-test editor scheduling with a fake clock and CLI: dirty documents wait for save; intermediate saves coalesce; the oldest processed and newest saved texts are sent; only successful/already-applied results advance memory; initial digest matches seed tracking; initial digest mismatches adopt the current baseline; watcher, cursor, and filter events do not loop; different worktree/source keys remain isolated.
- Unit-test presentation and typed messages for the file badge, absence of a stale marker, stable-ID selection, pin retention, line/file navigation, submission-location labels, `null` cross-links, keyboard access, accessible names, and VS Code design tokens.
- Add a staged VS Code scenario using the locally compiled CLI: create annotations, make and save insert/delete/replace edits, verify the mapped and midpoint lines, force a file-scoped result, verify TTL coalescing, reload, and verify decorations and navigation.
- After integrating SPEC-0015, rename a source and companion, then re-anchor at the repaired destination while racing a second companion mutation. After integrating SPEC-0021, verify linked worktrees retain independent source digests and annotation locations even though their named-agent state is shared.
- Run `npm run check-types`, `npm run lint`, `npm run test:unit`, and elevated `npm test` as the required broad regression set.
- Unit-test the shared companion codec and working set directly, including explicit missing-file handling, stable UTF-8 reads, operation-local cache reuse, staged-value visibility, write deduplication, and validation of every output before any replacement.

## Open Questions

None. Semantic recovery, persisted old-source snapshots, and richer matching are explicitly deferred until real failures justify them.

## Implementation Log

- 2026-07-21: Advanced companions and editor protocols to version 5 with saved-source SHA-256 digests and nullable anchor/link lines, without predecessor readers under DR-0039.
- 2026-07-21: Added the CLI-owned whole-companion re-anchor operation, reciprocal-link validation/update, and retry-safe write ordering under the shared worktree lock. The first pass used an in-repo Myers implementation.
- 2026-07-21: Added active-saved-source tracking with per-source 30-second coalescing plus file-scoped marker, navigation, stable-link, metadata, and accessible badge behavior. The combined release advances the editor once to 0.15.0 and CLI once to 0.8.0.
- 2026-07-21: Replaced the bespoke Myers engine with a small adapter over pinned `diff` 9.0.0. Retained Sundial-owned physical-line normalization and anchor translation policy under DR-0041.
- 2026-07-22: Added the private shared annotations package for contracts, codecs, digests, path mapping, stable I/O, locking, and operation-scoped working sets. Refactored CLI annotation and repair operations onto that package while the editor continues to mediate all product reads and mutations through CLI commands under DR-0042. Cross-file deletion and repair validate all involved companions before the first write and retain retry-safe ordering under DR-0040.
- 2026-07-22: Moved the complete repair engine into `packages/annotations`: `reanchor.ts` owns diff mapping and reciprocal line changes, `move.ts` owns Git rename/delete interpretation plus deep path-link transactions, and `repair.ts` owns Git invocation and the single `repairFromDiff` orchestration boundary. CLI re-anchor and workflow-repair commands are now projections over that entrypoint; proposed CAND-0001 to retain this package boundary.
- 2026-07-22: Removed the temporary CLI `lineDiff` and `companionRepair` forwarding modules plus compatibility-only exports from CLI annotation storage. Production and test callers now import the owning annotations-package modules directly; the CLI command handlers remain the product-operation boundary.
- 2026-07-22: Retained the combined uncommitted release versions after review under DR-0025: editor 0.15.0, CLI 0.8.0, and private annotations package 0.1.0. Moving implementation and its pinned `diff` dependency into the private package does not add another public version increment.

## Test Log

- 2026-07-21: Added line-map/translation, schema/digest, re-anchor/idempotency, reciprocal-link, scheduler/coalescing, null-line protocol, marker, and cursor-selection unit coverage plus a staged locally compiled CLI scenario for baseline adoption and file-scoped navigation.
- 2026-07-21: `npm run check-types`, `npm run lint`, `npm run test:unit` (168 tests), and `git diff --check` pass. CLI integration (11 tests) and four VS Code scenarios pass, including the new re-anchor scenario.
- 2026-07-21: The existing `diff-workflow` VS Code scenario failed in the broad run at compare-side focus and again in isolation by timeout; this is recorded as a harness focus failure under DR-0014 rather than a product change.
- 2026-07-21: After adopting `diff` 9.0.0, CLI type checking and all 67 CLI unit tests pass, including the unchanged line-map contract cases and an exact build-dependency assertion.
- 2026-07-21: Final library-backed regression: `npm run check-types`, `npm run lint`, `npm run test:unit` (168 tests), CLI integration (11 tests), the four non-diff VS Code scenarios including `annotation-reanchor`, `npm pack --workspace packages/cli --dry-run`, and `git diff --check` pass. The unchanged `diff-workflow` scenario again timed out waiting for compare-side focus after reporting the expected managed-diff state.
- 2026-07-22: Added 8 direct shared-package tests for codec/result contracts, path mapping, explicit missing reads, atomic round trips, operation-local caching, staged visibility, complete pre-write validation, and package export separation. Added a CLI retry test for a cross-file agent deletion whose reverse link was already durably removed.
- 2026-07-22: Final shared-package regression: `npm run check-types`, `npm run lint`, `npm run test:unit` (177 tests), CLI integration (11 tests), elevated `npm pack --workspace packages/cli --dry-run`, and `git diff --check` pass. The broad elevated `npm test` run passed CLI integration and the four annotation/editor scenarios; the unchanged `diff-workflow` scenario retained its recorded compare-focus timeout after reporting the expected managed-diff state.
- 2026-07-22: Expanded direct annotations-package coverage to 12 tests, including the relocated standard line-diff contract and a single `repairFromDiff` integration that detects a Git rename, moves the companion, repairs a deep reciprocal file link, and reanchors both line hints from the saved-source diff.
- 2026-07-22: Final package-owned-repair regression: `npm run check-types`, `npm run lint`, `npm run test:unit` (180 tests), CLI integration (11 tests), and elevated `npm pack --workspace packages/cli --dry-run` pass. The elevated broad suite again passed CLI integration plus `delayed-autosave`, `prompt-to-messages`, `annotation-retry`, and `annotation-reanchor`; only the pre-existing `diff-workflow` compare-focus wait timed out after reporting the expected managed-diff state.
- 2026-07-22: Repeated types, lint, all 180 unit tests, all 11 CLI integration tests, the elevated CLI package dry-run, Sundial validation, and `git diff --check` after deleting the forwarding modules; all pass.
- 2026-07-22: The repeated broad `npm test` run passed CLI integration plus `delayed-autosave`, `prompt-to-messages`, `annotation-retry`, and `annotation-reanchor`; the pre-existing `diff-workflow` compare-focus wait timed out again after reporting the expected managed-diff state.
