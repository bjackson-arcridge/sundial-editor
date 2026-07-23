---
id: SPEC-0023
title: All annotations can be seen
status: Todo
created: 2026-07-23
updated: 2026-07-23
created_by: bjackson
domain: editor
---
# All annotations can be seen

In sundial agents side bar:

Agent/Annotation tabs.

Annotations Tab:
Very top has a operations bar which repeats the filter toggle (filter to current diff).

A list of annotations, sorted by filename and time.
Each filename is a section header in allcaps
Each annotation is a two line prefix of the user message with ... at the end of the second line if needed.
Each annotation opens the annotation in the lower pane when clicked.

## Discovery

The existing `sundialEditor.messages` `WebviewView` already has the two presentation regions this feature needs: the upper, scrollable Agents pane and the lower annotation viewer. The lower viewer can present user annotations, their official responses, and linked agent annotations, and its existing `openAnnotation` path can open a workspace-relative file, load that source's companion through the CLI, reveal the current anchor, and select the exact annotation ID. This feature should make the upper region switchable rather than create a second sidebar view or a second annotation viewer.

The current extension only loads the companion for the active source. `annotations read` requires one `document.uri`, and the companion watcher refreshes only when the event belongs to that active source. A complete Annotations tab therefore needs a CLI-owned workspace index. Under DR-0042, the extension must not discover or parse `.sundial/**/*.comments` itself even though the private annotations package owns reusable paths and codecs.

The list represents user annotations. The requested two-line "user message" is the `UserAnnotation.message`; official responses reuse that identity under DR-0035, and agent-authored file annotations remain directly reachable from the selected user's lower-pane conversation. Listing linked agent annotations as duplicate rows derived from the same user message would make those rows indistinguishable and would turn the tab into a graph traversal rather than an index of user interactions.

User annotations do not store a creation timestamp, but each companion preserves append order and all companion mutations preserve the relative order of unaffected records. Group normalized workspace-relative source paths in ascending order, retain only user annotations within each group, and reverse their persisted order so the newest interaction appears first. This supplies the requested filename/time ordering without advancing the companion schema merely to duplicate time metadata from local work state. A clone that has checked-in companions but no gitignored agent/work runtime state still receives the complete list.

The existing filter is described informally as the current-diff filter, but its implemented contract is membership in the current permanent commit: the CLI resolves the current permanent commit and returns membership independently of the selected diff baseline or temporary commits. The Annotations-tab toolbar repeats that same toggle and shares the same `annotationFilterEnabled` state with the lower pane; it must not introduce a second interpretation or a second saved preference.

The provider currently operates against one current workspace folder: the pending prompt's folder, otherwise the active source's folder, otherwise the first workspace root. The workspace annotation index follows that established selection. Changing the active/pending workspace invalidates the previous index and starts a generation-guarded load for the new folder.

## Applicable Decision Records

- DR-0003 and DR-0015 keep the tab and list in the existing Lit bundle compiled with the webview TypeScript configuration.
- DR-0004 keeps workspace discovery and CLI invocation in the extension host while the client receives only typed presentation state.
- DR-0005 preserves the existing nonce-only CSP and local bundled assets.
- DR-0006 requires semantic tabs, visual-order Tab navigation, arrow-key tab selection, accessible full-message labels for truncated rows, and named icon controls.
- DR-0007 requires all new list, tab, toolbar, hover, selection, border, and focus styling to use VS Code design tokens.
- DR-0008 requires exact, runtime-validated, exhaustive discriminated unions for the new annotation-index state and any retry interaction.
- DR-0009 keeps the feature in the existing Messages `WebviewView`, not a `TreeView` or another contributed view.
- DR-0012 keeps the new product-level workspace read in the CLI-backed annotation store rather than reimplementing store behavior in VS Code.
- DR-0014, DR-0017, and DR-0026 govern staged VS Code scenarios and require the project-prepared runtime plus locally compiled CLI.
- DR-0025 requires a CLI version review because `annotations list`, help text, and capability output expand the published command surface.
- DR-0034 keeps README changes at the major-capability level rather than documenting index internals.
- DR-0035 keeps official responses nested under the originating user annotation instead of listing them as independent annotations.
- DR-0036 makes the listed user annotation the stable interaction/work identity, while checked-in companions—not local work files—remain authoritative for whether a row exists.
- DR-0039 requires callers, contracts, fixtures, and tests to move together without legacy index formats or compatibility branches.
- DR-0042 requires workspace annotation enumeration and parsing to remain CLI-mediated; the editor may consume shared contracts but may not scan companion files directly.
- DR-0043 favors reusing the existing open/filter paths and extracting shared presentation helpers over adding parallel entry points.

## Applicable Research Notes

None. Planning required only current repository contracts and accepted project decisions; no external or version-sensitive API research was needed.

## Planned Approach

1. Add shared, runtime-validated contracts for a workspace annotation-list request and result. The request contains only `workspace.cwd`. The result contains the CLI-resolved current permanent commit plus source groups identified by normalized workspace-relative file, each with ordered user-annotation summaries: stable ID, full message, current nullable anchor line, and CLI-provided current-permanent-commit membership. Require unique source groups and annotation IDs, safe paths, non-empty messages, valid nullable lines, and exact keys.
2. Add a read-only companion enumerator to the private annotations package. Walk only the workspace's `.sundial` companion tree, accept regular `*.comments` files at safe nested paths, ignore runtime directories, locks, temporary files, and symlinks, and sort normalized source paths deterministically. Parse every discovered companion with the current codec. A missing `.sundial` tree returns an empty list; a malformed companion fails the operation with its path rather than silently presenting a partial index.
3. Expose `sundial-editor-cli annotations list [--input request.json]`. The CLI calls the package-owned enumerator, resolves current-permanent membership using the same rule as `annotations read`, projects only user records into the compact list contract, and preserves each companion's user-record order. Add the operation to routing, service injection, help, health/capability output, and CLI unit tests. Do not read source files or source digests during listing: the companion holds the current re-anchored line, and opening a row performs the existing per-source read.
4. Add `listAnnotationsViaCli` to the editor CLI adapter and parse the result at that boundary. Keep a raw workspace index and a separate `loading | empty | ready | error` presentation state in `MessagesWebviewProvider`, with a load generation so results from a previously active workspace cannot overwrite the current one. A ready state contains already grouped and sorted summaries suitable for the webview; it never sends full official responses, agent annotation bodies, companion paths, or source contents across the boundary.
5. Load the index when the Messages view resolves and whenever its effective workspace changes. Refresh it after successful annotation creation/deletion, response or agent-annotation companion changes, re-anchoring, workflow repair, and any current-workspace companion watcher create/change/delete event. Coalesce watcher bursts from cross-file operations and retain the current successful list while a same-workspace refresh is pending; only a workspace change returns the tab to its initial loading state. Expose a recoverable retry that refreshes the annotation index independently of agent lifecycle operations.
6. Replace the redundant upper-pane `Messages`/`Agents` headings with an `Agents` / `Annotations` tablist while leaving composer takeover, agent-history takeover, lower-pane maximize/restore, and the persisted vertical split unchanged. Default to Agents for a newly created webview. Keep tab selection client-local, use `role="tablist"`, `role="tab"`, `role="tabpanel"`, `aria-selected`, `aria-controls`, roving `tabindex`, Left/Right arrow navigation, and Home/End; moving focus and activating a tab occur together.
7. Retain the current Agents panel contents and refresh behavior under the Agents tab. At the top of the Annotations panel, render a compact operations toolbar containing the same filter icon, accessible name, tooltip, and pressed state used by the lower annotation toolbar. Extract the filter control or its label calculation so both locations post the existing `toggleAnnotationFilter` message and cannot drift. Filtering reprojects the workspace list, current-source markers, previous/next order, and selected lower-pane annotation from the same host flag.
8. Render ready results as filename sections sorted by normalized workspace-relative path. Display the full relative path as an all-caps section heading so equal basenames in different directories remain distinguishable. Within each section, show user annotations in reverse companion order. Make each row a full-width semantic button whose visible message is clamped to two lines with an end ellipsis; expose the untruncated message and file/location in its accessible label and title. Include file-scoped annotations without inventing a line number.
9. Reuse the existing typed `openAnnotation` interaction for a row, constructing its `AnnotationLink` from the indexed ID, file, and current line. The provider opens/reveals the source, calls `annotations read`, selects the exact stable ID in the lower pane, and reports a recoverable notice if the source or annotation disappeared between indexing and selection. Preserve the Annotations tab selection, and let the existing lower-pane pin, previous/next, delete, links, metadata, responses, and maximize controls operate unchanged.
10. Add explicit loading, filtered-empty, workspace-empty, and recoverable-error presentations to the Annotations tab. Distinguish “No annotations in this workspace” from “No annotations for the current permanent commit.” Keep a previously selected lower annotation visible unless the shared filter excludes it or a refresh proves it no longer exists; an index load failure alone must not clear the active-source viewer.
11. Update the editor README only if the workspace-wide browsing tab merits a concise addition to the existing annotation capability paragraph. Treat the tabs as added user-facing functionality, so advance `packages/editor/package.json` once from committed `0.15.0` to `0.16.0` and update the lockfile. Because `annotations list` expands the published CLI surface, advance `packages/cli/package.json` once from committed `0.8.0` to `0.9.0`, update the shared CLI version assertion/source and lockfile, and do not stack another increment if another uncommitted feature has already established those release versions.

## Rejected Alternatives

- Scan `.sundial/**/*.comments` from the extension host: DR-0042 keeps every product annotation read behind the CLI and prevents storage behavior from splitting across packages.
- Build the tab from `agent work list`: local gitignored work state supplies useful runtime status but is not authoritative for checked-in annotations, can be absent after a clone, and retains request-time rather than re-anchored locations.
- Add `createdAt` to `UserAnnotation` and advance the companion schema: the append order already provides the requested within-file chronology. A schema break and duplicated work timestamp are disproportionate to a list that does not display timestamps.
- List official responses or agent annotations as top-level rows: responses have no independent identity under DR-0035, while agent annotations are linked details of the originating user interaction and do not have the requested user-message preview.
- Return every full companion or full annotation union from `annotations list`: the tab needs only a compact stable-ID/message/location/membership index and performs the authoritative per-source read when a row opens.
- Add one `annotations read` subprocess per discovered file from the extension: this would still require the extension to discover storage paths, amplify process overhead, and allow the workspace to change between separate scans.
- Create a second contributed VS Code view, use a `TreeView`, or replace the lower viewer: the existing WebviewView split already provides the required master/detail interaction and DR-0009 governs the surface.
- Give the Annotations-tab filter its own state or interpret it using the selected diff baseline: the existing toggle is specifically based on CLI-provided current-permanent-commit membership.
- Persist selected tab in extension configuration: tab choice is transient presentation state and does not warrant another user setting. The existing pane split remains the only persisted layout preference.
- Derive a fixed-character excerpt in the host: visible two-line truncation depends on sidebar width and font metrics; CSS line clamping supplies the correct responsive ellipsis while accessible text remains complete.

## Test Plan

- Shared annotations package: empty/missing store; nested safe companions; deterministic normalized path ordering; multiple user and agent records with only users projected; preservation of user append order; nullable lines; ignored runtime/lock/temp entries; non-followed symlinks; malformed companion failure with path; and duplicate source/annotation rejection at the result contract.
- CLI: exact `annotations list` request parsing and routing; help and capability advertisement; empty and multi-file results; current-permanent membership independent of diff baseline and temporary commits; no source-file read requirement; compact output without responses, agent bodies, session IDs, companion paths, or source digests; malformed-store failure; adapter result validation; and updated version/lock assertions.
- Host/provider unit coverage: effective-workspace changes, initial load, same-workspace retained refresh, stale-generation rejection, watcher burst coalescing, successful create/delete/re-anchor refresh, error/retry behavior, filter projection, filtered selection clearing, filename grouping, reverse companion chronology, file-scope links, exact-ID open, and disappearance between index and open.
- Webview unit/static coverage: exact typed state guards; Agents/Annotations tab roles and relationships; roving focus plus Arrow/Home/End behavior; default Agents selection; retained tab through host updates; shared filter pressed state and message; all-caps full-path headings; two-line ellipsis styles; complete accessible row labels; visual-order keyboard access; empty/loading/error states; and exclusive VS Code-token styling in Default Light, Default Dark, High Contrast, and High Contrast Light.
- Add a staged `annotation-index` VS Code scenario using the locally compiled CLI. Prepare user annotations in two nested source paths with multiple records and one linked agent annotation; verify grouping, newest-first user order, current-permanent filtering, file-scoped inclusion, exact stable-ID navigation into the lower pane, watcher-driven creation/deletion refresh, restart persistence without relying on local work state, and an actionable malformed/disappeared-source failure.
- Re-run the existing prompt submission, linked agent annotation, deletion, current-permanent filter, re-anchoring, pane split, history takeover, and diff-workflow coverage to ensure the new upper tabs do not change lower-pane or agent behavior.
- Run the broad regression set required for this user-facing feature: `npm run check-types`, `npm run lint`, `npm run test:unit`, and elevated `npm test`. Also run `git diff --check` and `sundial status`.

## Open Questions

None. The user-message wording scopes the top-level list to user annotations; responses and agent-authored annotations remain visible through the selected conversation. “Filename” means the full normalized workspace-relative path to avoid basename collisions, “time” means newest-first companion append order, and “current diff” reuses the established current-permanent-commit filter contract.

## Implementation Log

## Test Log
