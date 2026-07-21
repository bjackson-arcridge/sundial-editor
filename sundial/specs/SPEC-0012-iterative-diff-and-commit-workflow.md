---
id: SPEC-0012
title: Iterative diff and commit workflow
status: Backlog
created: 2026-07-13
updated: 2026-07-20
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

## Test Log
