---
id: SPEC-0012
title: Iterative diff and commit workflow
status: Done
created: 2026-07-13
updated: 2026-07-21
created_by: bjackson
parent: SPEC-0008
domain: editor
slice: 5
---
# Iterative diff and commit workflow
Requirements refined from original requirements in SPEC-008.  Here are the authoritative requirements:

We will piggyback on git commits and provide a set of meta commands around the git operations:

A "temporary commit" is a git commit without a commit message that is exactly "Sundial:temp".  Semantically, these commits are local only temporary state and will be rebased away before pushing to the remote.

A "permanant commit" is a git commit with a normal message.  When created, all previous temporary commits after the last normal commit are squashed into this new commit.

We will try to use existing git diff tools as much as possible; vs code seems to make this a bit of a challenge as any diff is opened as a separate editor window.  In an ideal world, the user can toggle diff on and off using simple commands or hotkeys, and this would effectively seem as if the current editor view is being toggled on and off, with the diff target being controlled by sundial.

But achieving this while using the VSCode built-in visual diff seems somewhat challenging.  One attempt is:  When toggled on, navigating to a file opens its diff view instead (if diff is on), and when diff is on, all open files are replaced with diff views, and similarly when diff is turned off, all open files are replaced with their editor files.

When switching back and forth, the current cursor position is remembered and the cursor is placed in the appropriate locaiton
in the new file.  Also the current scroll location is remembered and the scroll location is set appropriately.

The above would only be scoped to files within the repo.

We want a global diff state that affects all open files.
* `%dd` toggle diff view on/off
* `%di` toggle diff inline setting on/off
* `%d+` moves the diff baseline one first-parent commit back (`HEAD~1`, then `HEAD~2`, and so on).
* `%d-` moves the baseline one commit forward toward `HEAD`.
* `%d0` resets the baseline to `HEAD`.
* `%dp` resets the baseline to the last permanent commit.
* `%cf` creates a temporary commit containing the current file.
* `%ca` creates a temporary commit containing all dirty files.
* `%cm` opens a message box, then consolidates all temporary commits and remaining dirty work since the last real commit into one real commit. It does not require `%ca` first.

We will introduce a new companion file repair script within this scope.

`%cf`, `%ca`, and `%cm` check for file moves and deletes (using git diff tooling).  If there is a corresponding companion file, it also gets the same treatment. `%cr` runs this repair script even without the commit operation.

Whenever a source file is committed, its dirty `.comments` companion is included in the same commit. `%cf` therefore commits the current file and its companion, while `%cm` includes companion changes along with all remaining dirty work. Annotations retain stable identities when temporary commits are consolidated.

As a part of this feature; we will add a commit hash field to annotations. The annotation is assigned to the last Permanent commit hash in git; There is an annotation filter, that filters annotations to the the current diff scope.  This annotation filter is toggleable in the annotation area in the sundial agents sidebar (a toggleable filter icon in the menu bar).

## Discovery

This is the revised functional slice 5 from SPEC-0008 and depends on completion of SPEC-0013's three child functions through SPEC-0020. It extends their persistent agent control, official-response, and latest-source code-annotation contracts with version selection, latest-code and editable diff views, iteration and cumulative baselines, diff-scoped annotation presentation, explicit temporary commits, consolidation into a real commit, stable annotation identities, and companion-file inclusion within commit scope.

All version and diff complexity is owned here. SPEC-0018 supplies persistent agent control, SPEC-0019 supplies official responses, and SPEC-0020 supplies fixed-line latest-source code annotations. This slice adds version/diff states, re-anchoring, and any file-scope fallback rather than building a parallel sidebar model.

## Applicable Decision Records

- DR-0003 through DR-0009 govern extensions to the Lit control and feedback surface coordinated by SPEC-0013.
- DR-0012 keeps diff, baseline, and commit mutations behind the CLI-backed store.
- DR-0014, DR-0017, and DR-0026 govern staged VS Code integration coverage and local CLI compilation.
- DR-0016 keeps CLI store operations dependency-free and out of shell pipelines.
- DR-0025 requires a CLI version review for new diff and commit commands.

## Applicable Research Notes

None identified for this initial scaffold.

## Planned Approach

1. Treat the repository `HEAD`, its first-parent ancestry, the contiguous `Sundial:temp` commits at `HEAD`, and the dirty working tree as one CLI-owned workflow model. Add a dependency-free Git runner in `packages/cli` with structured argv, bounded output, typed failures, and explicit repository/safety checks; use Git subprocesses only for Git operations, consistent with DR-0016. Refuse mutations while Git reports unresolved conflicts, an in-progress rebase/cherry-pick/merge, no usable `HEAD`, or a temporary stack that is not safely contiguous at `HEAD`. Before a temporary-stack mutation or consolidation, verify every temporary commit is absent from `origin`; a published temporary commit is a dirty workflow error reported to the user for manual repair. Never shell-concatenate user paths or messages.
2. Add machine-readable CLI commands for: reading the workflow state; moving/resetting the selected first-parent baseline (`HEAD`, previous/next, last permanent); creating a temporary commit for the current source plus its dirty companion; creating a temporary commit for all dirty and non-ignored untracked work; and consolidating the contiguous temporary stack plus remaining dirty work into one user-message commit. `%cr` and the repair/validation primitive are owned by SPEC-0015 and are invoked by the commit commands. Each command accepts the workspace root and returns validated state (HEAD, selected baseline, last permanent commit, temporary-stack count, and affected paths) so the extension remains a thin typed caller. Review the public surface, help text, runtime assets, `packages/cli/package.json`, and lockfile under DR-0025.
3. Consume SPEC-0015's single Git status-to-companion repair/verification primitive before `%cf`, `%ca`, and `%cm`. Commit-scope construction includes a dirty companion whenever its source is selected and retains a recoverable, no-partial-write failure path. Consolidation rewrites only the verified temporary suffix into the permanent commit, preserving annotation IDs and all companion content rather than re-creating annotations.
4. Evolve the companion schema and the editor/CLI protocol with an annotation permanent-base commit hash. Migrate older companion versions on the next validated write without changing annotation identities or official-response identities. The CLI resolves the current last permanent commit at annotation creation and records that immutable hash. When the filter is enabled, membership matches that current permanent hash only; temporary commits and the selected diff baseline affect diff visibility but not annotation scoping. The CLI returns this resolved membership rather than making the extension infer Git ancestry or edit companion YAML directly.
5. Add a workspace-global, in-memory editor diff controller. It obtains state and baseline changes through the CLI, converts only workspace-file editors to VS Code's built-in diff editor, and restores ordinary source editors when diff mode is off. Preserve each replaced editor's source URI, selection, active side, view column/group, and visible-range anchor; restore the modified/right editor selection and reveal position after the transition. New workspace-file navigation while enabled opens the corresponding diff; non-workspace, preview, settings, and webview editors remain untouched. Toggle inline diff rendering as a global controller setting and reset/reconcile the controller after commit or baseline commands.
6. Extend the existing typed Messages `WebviewView` state and annotation pane rather than adding a second sidebar. Surface selected baseline/mode status and a keyboard-accessible annotation-filter icon with name, tooltip, pressed state, and token-only styling. When enabled, apply the CLI-provided current-permanent-hash membership rule to user/response/agent annotations; when disabled, retain the current full annotation presentation, selection, pinning, navigation, markers, and file-scope fallback. Keep the host/client boundary as exhaustive discriminated unions (DR-0003 through DR-0009).
7. Register the `%` commands as the canonical user-facing command/keybinding integration; these refined requirements supersede the related `:::` notation in SPEC-0008. `%cm` requests a non-empty commit message from the user, then calls the CLI once; the extension reports typed success/failure notices and refreshes diff, annotation, marker, and watcher-derived state. Document temporary checkpoints, the local-only/published-stack error constraint, baseline controls, annotations filter, and companion repair at the established capability level.
8. Implement in dependency order: SPEC-0015's repair/verification primitive and fixtures; CLI Git workflow primitives; schema/protocol migration; extension CLI runner and commands; diff-controller/editor replacement; sidebar filter; documentation and staged scenario coverage. This keeps all Git mutation testable outside VS Code while exercising the final commands only through the production CLI boundary.

## Rejected Alternatives

- Implement Git, baseline, or companion mutations in the extension host or webview: DR-0012 requires one CLI-owned workflow authority.
- Detect temporary commits by a loose prefix, a branch name, or a separate metadata file: the authoritative identity is the exact `Sundial:temp` message and a contiguous first-parent suffix at `HEAD`.
- Squash by recreating annotation records: consolidation must preserve stable annotation and official-response identities already persisted in companions.
- Guess source moves from content similarity when Git reports delete/add: companion repair follows Git's reported classification only.
- Replace only the active editor for diff mode: the requirement is a global workspace-file state affecting all currently open and subsequently opened workspace files.
- Build a second annotation/diff sidebar model or bypass typed webview messages: this would fork the completed annotation interaction model and violate the established webview contracts.
- Use an extension-installed Git library or runtime shell pipelines: the CLI can invoke the user's Git executable with structured arguments while retaining the dependency-free store/command layer.

## Test Plan
- The bulk of testing will be in each submodule; as most emergent behavior is already sufficiently tested.
- The CLI command is extensively tested for Git control.
- The new commands are unit tested. The existing command surface and test coverage generalize to these editor commands, so no additional integration coverage is required beyond the focused functional UI acceptance test below.
- Add functional UI acceptance coverage for closing/opening editor windows when enabling/disabling diff or changing diff levels. Maximize reuse and minimize integration tests: one scenario covers a single open window, multiple open windows, editor-to-diff, diff-to-editor, and diff-to-diff transitions. Do not attempt every exponential combination.

### CLI Test Details

- Cover Git workflow state and typed command I/O in CLI unit tests: repository preconditions; exact `Sundial:temp` classification; contiguous temporary stacks; first-parent baseline movement at root and merge commits; `HEAD`, last permanent commit, and boundary behavior; and clean, staged, unstaged, untracked, rename, deletion, and conflict states.
- Cover `%cf` and `%ca` command scopes: current-source plus dirty companion, all dirty and non-ignored untracked work, no-op behavior, paths with spaces, unrelated staged/worktree state, and returned affected paths. Repair/verification behavior is covered by SPEC-0015.
- Cover `%cm` with zero, one, and multiple temporary commits plus remaining dirty work: required message, resulting tree and parent, removal of only the temporary suffix, stable companion/annotation identities, unsafe-stack rejection, and a published-temporary-stack error.
- Cover annotation schema/protocol changes: predecessor reads and validated writes, permanent-base hash assignment, identity/official-response/agent-annotation preservation, malformed-file preservation, and current-permanent-hash diff-scope membership independent of temporary commits and selected baseline.
- Cover each command's runtime validation, help text, CLI-runner error projection, and package-version review. Use disposable repositories and real Git subprocess invocations for Git behavior; keep the remaining command logic in unit tests.

### Functional Acceptance Test Details

- Add one staged VS Code acceptance scenario using the locally compiled production CLI (DR-0017 and DR-0026). It opens one source editor, enables diff, checks the equivalent diff editor and preserved source cursor/scroll location, changes the baseline/inline setting, returns to the source editor, then repeats the transition with multiple open workspace editors.
- Within that same scenario, cover editor-to-diff, diff-to-editor, and diff-to-diff replacement. Confirm workspace-file navigation honors the global diff state and non-workspace editors are left unchanged.
- Exercise annotation filtering and commit commands through focused host/webview unit tests rather than expanding the acceptance scenario: typed messages, filter icon accessibility/pressed state, current-permanent-hash filtering independent of temporary diff visibility, filtered marker/viewer/navigation behavior, and command notices/refreshes.
- Retain the established typecheck, lint, unit, and pinned VS Code regression commands: `npm run check-types`, `npm run lint`, `npm run test:unit`, and elevated `npm test`; include `git diff --check` and report any environment-specific blocker.

## Open Questions

None.

## Implementation Log

### Work Queue

1. [x] Harden core Git workflow invariants: exact temporary messages, every temporary commit unpublished, linked-worktree operation detection, bounded subprocess output, baseline boundaries, and complete affected-path reporting.
2. [x] Complete the CLI workflow test matrix and machine-protocol coverage for repository preconditions, merge ancestry, dirty states, commit scopes, consolidation, unsafe stacks, and typed failures.
3. [x] Implement the CLI-owned companion repair/verification primitive and `%cr`, then invoke it before `%cf`, `%ca`, and `%cm`.
4. [x] Add the annotation permanent-base commit field, predecessor migration, identity-preserving writes, and CLI-resolved current-permanent membership.
5. [x] Finalize the workspace-global diff controller and focused VS Code acceptance coverage, including active-side, cursor, scroll, multi-group, navigation, and non-workspace behavior.
6. [x] Add canonical `%dd`, `%di`, `%d+`, `%d-`, `%d0`, `%dp`, `%cf`, `%ca`, `%cm`, and `%cr` integration plus post-operation state refresh and typed notices.
7. [x] Add the accessible diff-scoped annotation filter to the existing Messages webview using exhaustive typed messages and VS Code design tokens.
8. [x] Finish capability-level documentation, package/version review, full regression testing, and SPEC-0012 closure.
9. [x] Snapshot the relative editor state before diff, baseline, navigation, and undiff transitions: split layout, tab indices, preview/pinned state, selected tabs, and active group.
10. [x] Restore each replacement in place and stabilize the original selected tab, active group, cursor/scroll state, and compare side after VS Code's deferred tab mutations settle.
11. [x] Strengthen the staged acceptance scenario with unequal multi-group splits, unrelated tabs, navigation-time conversion, and exact logical arrangement checks across every transition.
12. [x] Update capability documentation and unit guards, then run the broad regression set for the state-preservation hardening.

### Completed Work

- Task 1: temporary classification now reads the complete commit object message; safety validation checks every temporary suffix commit against `origin`; operation markers resolve through `git rev-parse --git-path` in linked worktrees; Git output is capped; baselines are restricted to first-parent ancestry with stable root behavior; and consolidation reports both temporary and dirty paths (DR-0016, DR-0039).
- Task 2: expanded disposable-repository coverage across invalid/unborn repositories, root and merge ancestry, staged/unstaged/untracked/renamed/deleted/path-with-space states, current-file companion scope, unrelated index preservation, multi-checkpoint consolidation, conflict and output-limit failures, and stable companion bytes. Workflow state conflicts now cross the machine boundary with stable codes and the editor validates hashes, counts, paths, and conflict projection.
- Task 3: added the CLI-owned `workflow repair` primitive used by manual `%cr` integration and invoked before every checkpoint/consolidation. It consumes only Git `--name-status` rename/delete classifications, stages matching companions through a recoverable repair area, refuses overwrite/non-regular-file conflicts, validates the resulting paths, and includes both sides of a repaired current-file move in `%cf`. The CLI is now 0.7.0 (DR-0012, DR-0016, DR-0025).
- Task 4: evolved annotation companions to version 4 with an immutable `permanentBaseCommit` on user and agent annotations. Version 3 companions migrate in memory against the CLI-resolved last permanent commit and are written as version 4 on the next validated mutation without changing annotation, official-response, or cross-file link identities. Annotation reads now return the current permanent commit and an ordered, validated membership list; temporary commits and editor-selected baselines do not alter that membership (DR-0012).
- Added the CLI-owned Git workflow command family: state, first-parent baseline movement, exact temporary checkpoints, and permanent consolidation. Mutations use structured Git argv, reject conflicts/in-progress operations, and reject temporary stacks reachable from a remote branch (DR-0016, DR-0039).
- Added typed editor CLI calls and command-palette integration for the diff baseline and commit commands. `%cm` obtains a non-empty message before invoking the CLI. The final release review applies one minor increment from the rebased committed versions: CLI 0.7.0 and editor 0.14.0 (DR-0025).
- Task 5: added the workspace-global diff controller. It replaces every open workspace text tab with a managed built-in Git diff tab, preserves group, selection, active side, and stable first-visible-line anchors, reconciles diff-to-diff baseline changes and commit results, converts newly opened workspace files while enabled, restores ordinary source tabs when disabled, and leaves non-workspace tabs untouched. Inline/side-by-side mode updates the workspace-wide VS Code diff setting. The editor release is 0.14.0.
- Task 5 uses one staged production-CLI VS Code scenario covering editor-to-diff, diff-to-diff, diff-to-editor, multi-group editors, navigation while enabled, non-workspace tabs, modified selection, original-side focus, non-zero scroll restoration, and inline-mode changes (DR-0014, DR-0017, DR-0026).
- Task 6: registered all ten canonical workflow percent commands as typed completion items mapped to host commands. Selecting one removes and saves the exact command line before execution; `%cr` now invokes the CLI repair primitive directly. Checkpoint, consolidation, and repair operations reconcile managed diff tabs, annotations, markers, and agent/watcher-derived state before publishing operation-specific success or typed CLI failure notices (DR-0012).
- Task 7: extended the exhaustive Messages protocol with typed diff mode, layout, selected baseline, current permanent commit, and filter state. The token-styled toolbar exposes an accessible filter button with a dynamic tooltip and pressed state. Filtering consumes only the CLI-provided annotation-ID membership and consistently applies it to markers, viewer selection, pinning, adjacent navigation, links, and file fallback; active original diff panes resolve through the modified source editor so annotations remain loaded.
- Task 8: documented the complete iterative workflow, local-only checkpoint constraint, first-parent baseline controls, consolidation, filtering, and companion repair in the root, editor, and CLI guides. The final package review confirms one minor increment from the committed manifests (CLI 0.7.0 and editor 0.14.0). Decision-aware review found and corrected a repair rollback flaw by isolating recovery directories and retaining delete backups until every repair verifies; no completeness, privacy, security, or governing-DR finding remains open.
- Follow-up: diff/source replacement now restores every tab at its exact prior index, including its preview/pinned state, then restores the active tab in each touched editor group and the globally focused group. Replacement-before-close keeps the existing groups alive, so VS Code retains nested/unequal split geometry. New-tab reconciliation waits for VS Code's active-group state to settle, and active original/modified diff-side restoration is verified against the observable text editor.
- Tasks 9–11: hardened diff/undiff as an in-place editor-state transition. The controller snapshots immutable tab inputs and exact tab indices, closes the intended source/diff even when VS Code retargets a tab object, repositions and repins the replacement after closure, restores each group's selected tab and the globally active group after deferred editor work settles, then restores the active compare side. Automatic conversion waits for the tab-open focus event to settle. The staged scenario now proves the split tree and unequal proportions, relative tab order, preview/pinned state, per-group selection, global focus, navigation-time conversion, cursor/scroll state, and active side remain stable.
- Task 12: documented the editor-state guarantees and added unit guards for the in-place replacement contract. Replacements already at the target index are not moved; when VS Code relocates a preview replacement to its single preview slot, the controller rotates the intervening kept tabs around it instead of moving and keeping the preview. Compare-side restoration is verified through observable editor state after deferred focus work. The follow-up retains the existing editor 0.14.0 minor increment rather than stacking another version bump in the same uncommitted release.

## Test Log

- Task 1 passed repository-wide typecheck, 46 CLI unit tests (including exact-message, published-interior-temp, linked-worktree operation, baseline-root, and affected-path regressions), 88 editor unit tests, lint, and `git diff --check`.
- Task 2 passed repository-wide typecheck, 53 CLI unit tests, 89 editor unit tests, lint, and `git diff --check`.
- Task 3 passed repository-wide typecheck, 57 CLI unit tests, 90 editor unit tests, lint, and `git diff --check`.
- Task 4 passed repository-wide typecheck and 60 CLI plus 90 editor unit tests, including predecessor migration, identity preservation, malformed-file preservation, permanent-base assignment, typed protocol validation, and membership independence from temporary commits and selected baselines.
- Task 5 passed the focused pinned VS Code 1.118.1 `diff-workflow` acceptance scenario after strengthening it to cover active-side and non-zero scroll restoration; the other three staged editor scenarios also pass with the schema-v4 fixtures.
- Task 6 passed repository-wide typecheck, lint, `git diff --check`, all 60 CLI unit tests, and 94 editor unit tests, including exact percent-command mappings, completion filtering, safe line removal/save ordering, mismatch rejection, manifest registration, and the repair CLI protocol.
- Task 7 passed repository-wide typecheck, lint, `git diff --check`, all 60 CLI unit tests, and 96 editor unit tests. Coverage validates exact typed workflow/filter messages, rejects malformed workflow state, proves filtering follows CLI membership rather than matching hashes in the editor, and checks the accessible token-styled toolbar plus filtered marker/viewer/navigation wiring.
- Task 8 passed the final `npm run check-types`, `npm run lint`, `npm run test:unit`, and `git diff --check` regression set: all 60 CLI and 96 editor unit tests are green. Elevated `npm test` passed all 11 Codex app-server integration tests and all four staged VS Code 1.118.1 scenarios. The first full run exposed an acceptance-test race after compare-side focus; the scenario now waits for VS Code's observable active-editor transition, and both the focused scenario and complete elevated rerun pass.
- Passed `npm run check-types`, `npm run lint`, `npm run test:unit`, and `git diff --check` after the global diff controller implementation.
- Passed elevated `npm test`: all 11 CLI integration tests and all four pinned VS Code scenarios, including the staged production-CLI `diff-workflow` acceptance scenario.
- The focused `diff-workflow` scenario passes after adding exact logical tab-order, active-tab, pinned/preview, active-group, and `vscode.getEditorLayout` assertions across diff, baseline replacement, navigation, and undiff. The scenario uses an unequal 70/30 two-group layout with an untouched interleaved tab plus an inactive preview source and verifies that both preview semantics and split geometry are unchanged.
- Task 12 passed `npm run check-types`, `npm run lint`, `npm run test:unit`, and the complete elevated `npm test`: 60 CLI unit tests, 97 editor unit tests, 11 CLI integration tests, and all four pinned VS Code 1.118.1 scenarios are green. The first complete run exposed adaptive inline fallback during the original-side check, and the preview case proved that moving the preview itself clears preview semantics. The deterministic fixture now forces a focusable side-by-side diff and resets only its fixed disposable profiles; the controller rotates adjacent kept tabs around a relocated preview. The final focused and complete pinned-runtime runs passed.
- Decision-aware follow-up review found no remaining completeness, privacy/security, or governing-DR issue. The change remains an extension-host presentation transition over built-in VS Code editors, adds no workflow mutation or external data path, follows the staged pinned-runtime harness decisions, and does not establish a new durable architectural rule requiring a Decision Record.
