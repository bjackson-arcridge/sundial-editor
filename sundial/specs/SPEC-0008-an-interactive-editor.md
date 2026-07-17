---
id: SPEC-0008
title: An interactive editor.
status: Backlog
created: 2026-07-12
updated: 2026-07-13
created_by: bjackson
---

# An interactive editor.

## Discovery

2026-07-13 provider command-surface research: VS Code provider commands are mostly UI/context commands, not a stable provider-neutral way to send arbitrary prompts or steer active turns. Codex app-server and Claude Code CLI/background-agent/stream-json surfaces are the likely programmatic control surfaces.

Sundial can require current Codex and Claude Code harness versions for this feature. Setup should detect stale provider CLIs/extensions and guide users to update instead of preserving compatibility with older command surfaces.

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

## Concerns

### Overview and Goals

Sundial Editor is a separate VS Code extension package for collaborative editing of one working tree by the user and multiple agents. The editor is the shared collaboration surface; provider harnesses retain authentication and execution responsibility. Codex is the first supported provider.

### Overall Interaction Model and UX

The default mode is concurrent work in a dirty, moving working tree. Agents make small targeted patches for their assigned tasks and are not responsible for making the whole tree error-free unless asked. The standard editor contributes VS Code's built-in delayed autosave with the standard one-second default; user, workspace, folder, and language-specific settings can override that default. It supports both latest-code and diff views. The experience is keyboard-first, including navigation of the sidebar and switching between edit and diff views.

The right-hand Secondary Sidebar, normally used for LLM chat panes, contains the **Sundial Agents** collaboration panel. It shows the user and agents with their status and current task, and annotations for the current code location or the selected agent's provider output. Sidebar sections use `WebviewView`, meet the established keyboard-accessibility requirements, and communicate through typed messages. Sundial contributes its own container directly to the Secondary Sidebar rather than hosting itself inside a provider-owned chat pane; it reveals the panel once after installation, then respects the user's normal ability to close or move it.

### Command Surface

Commands are typed on a standalone source line. Submitting a prompt command removes that line, opens a message box, and sends the entered message without writing it into the source file. The resulting user-command annotation remains anchored to the source line where the command was issued.

Prompt commands enter an explicit editor mode with `%` in column zero. Presets include question/no-code (`%Q`), fix (`%F`), write (`%W`), refactor (`%R`), cleanup (`%C`), and tests (`%T`); an `@G` modifier associates the prompt with the project globally. These presets are advisory prompt guidance, not enforceable safety boundaries. They do not select or route to an agent; dynamic agent selection and routing are deferred to Function 2.

Diff and commit commands are:

* `:::+` moves the diff baseline one first-parent commit back (`HEAD~1`, then `HEAD~2`, and so on).
* `:::-` moves the baseline one commit forward toward `HEAD`.
* `:::0` resets the baseline to `HEAD`.
* `:::F` creates a temporary commit containing the current file.
* `:::A` creates a temporary commit containing all dirty files.
* `:::M` opens a message box, then consolidates all temporary commits and remaining dirty work since the last real commit into one real commit. It does not require `:::A` first.
* `:::R` repairs companion-file moves and deletions without creating a commit.

`:::F`, `:::A`, and `:::M` run the same companion repair within their commit scope before committing.

### Provider and CLI Control

Agent control is exposed through the Sundial CLI as a provider-agnostic surface for start/resume, send, steer where supported, interrupt, transcript access, native UI, and context. The first provider adapter controls Codex through app-server. Claude integration is deferred. VS Code provider commands are reserved for native UI and context operations.

Sundial manages only sessions that it starts. Codex sessions created through the native VS Code extension or a separate CLI process may coexist, but they remain outside Sundial's agent list and control surface. Capabilities and supported provider versions are detected for each Sundial-managed session.

Agents initially use the Sundial CLI for comments, re-anchoring, current-work awareness, and related editor state. MCP tooling is deferred and can later wrap the same CLI-owned operations.

### Checkpoints and Diff Scope

Temporary commits are explicit user-created checkpoints that reset the iteration diff; Sundial does not choose their cadence. The iteration baseline is `HEAD`. The cumulative baseline is the last real commit and includes temporary commits plus current dirty work, so the user can review everything that will enter the next real commit. Temporary commits carry a machine-readable marker identifying the last non-temporary ancestor.

Whenever a source file is committed, its dirty `.comments` companion is included in the same commit. `:::F` therefore commits the current file and its companion, while `:::M` includes companion changes along with all remaining dirty work. Annotations retain stable identities when temporary commits are consolidated.

### Agent Work, Snapshots, and Awareness

An agent works directly against the dirty shared tree. If it cannot safely complete its targeted task, it pauses and sets its status to `blocked`. An agent creates an isolated snapshot only when it encounters test failures or instability that it must address and needs a stable environment to do so. The snapshot is a temporary Git worktree under the repository-root `.worktrees/` directory, created from the current dirty tree without moving the shared `HEAD` or adding to the user's temporary-commit stack. The `.worktrees/` directory is local, user-inspectable, and gitignored. The agent works in that worktree, reconciles its targeted diff into the current dirty tree, and then removes the worktree.

The user and agents appear in one awareness list with status `waiting`, `working`, or `blocked`. A `working` or `blocked` participant publishes a title and one paragraph of approximately 100 words describing the current task; `waiting` has no active-task description. Participants update and check this state whenever useful, with prompt guidance adjusted from observed coordination problems rather than a fixed cadence.

Awareness is stored in a dedicated gitignored runtime-state file under `.sundial/` and managed through the CLI. It is repairable cache state: startup or an explicit repair command preserves entries backed by expected live processes or sessions and removes stale entries.

### Comments and Anchoring

Companion files are compact YAML files checked in under a hidden `.sundial/` directory that mirrors the source tree. For example, `src/example.ts` maps to `.sundial/src/example.ts.comments`. A companion file is created lazily when the first annotation for its source file is recorded; source files without annotations have no companion.

Agent prompts instruct agents to use a Sundial move command that relocates a source file and its companion together. Users may manage moves manually in the initial version; editor-assisted user moves are deferred.

A Sundial repair operation deterministically follows Git's reported diff status: a reported rename moves the companion to the mirrored destination, a reported deletion deletes the companion, and other statuses do not relocate it. Repair runs automatically before `:::F`, `:::A`, and `:::M`, and manually through `:::R`. A verify operation then fails if the resulting companion state does not match those reported statuses.

There are two annotation types: user-command annotations initially anchored to one line, and agent annotations attached to a code range through the CLI. Initial automatic anchoring uses surrounding prefix and suffix text, bounded match and distance thresholds, and TTL-throttled re-anchoring for visible annotations in changed files. A failed match becomes explicitly file-anchored rather than claiming an incorrect line.

Agents may explicitly update anchors through the CLI. A dedicated re-anchor operation may launch an LLM subagent to compare file-anchored annotations and their original context with the current file, re-anchor confident matches, and leave ambiguous annotations at file scope. The user is not expected to re-anchor comments manually. Visible annotations follow the selected diff scope.

### Risks and Limitations

Prompt presets and agent move instructions are advisory and may not be followed. Repair follows Git's classification, so a heavily modified move reported by Git as a deletion and addition is treated that way rather than inferred as a rename. Provider capabilities differ and Codex app-server remains experimental. Anchoring is best-effort, and rate-limited automatic saves may trigger file watchers and development tooling.


## Incremental Functional Delivery

Each slice should leave a usable end-to-end workflow and preserve the behavior delivered by earlier slices. The order is an initial proposal and can change with use.

Prove out the primary user interactions first, then expand to multiple subagents as the final step.

### Function 1: Editor Plugin 
Create the separate Sundial Editor extension package. Configure VS Code's built-in delayed autosave to default to one second and implement the source-line-to-message-box prompt UX through the UI boundary; submitting a prompt does not yet contact an agent.

### Function 2: Agent Integration
Add the provider-agnostic CLI agent-control surface and its first Codex app-server adapter. The user can start and stop one managed agent, see its status and output in the sidebar, submit a prompt through the existing message-box interaction, and have the agent make targeted patches in the dirty shared tree.

### Function 3: Companion File
Persist each submitted user command as a line-anchored annotation in a lazily created YAML companion file. Load the annotation after restart and show it when its source location is active.

### Function 4: Iterative Diff and Commit Workflow
Add latest-code and editable diff views with `:::+`, `:::-`, `:::0`, `:::F`, `:::A`, and `:::M`. Support iteration and cumulative baselines, marked temporary commits, consolidation into a real commit, stable annotation identities through consolidation, and inclusion of dirty companion files whenever their source files are committed.

### Function 5: Agent Code Annotations
Add CLI operations for an agent to attach comments to code ranges and explicitly update their anchors. Show annotations for the current cursor location and selected diff scope, use surrounding text to resolve moved ranges, and fall back to explicit file scope when a range cannot be resolved.

### Function 6: Isolated Test Recovery
When the agent encounters test failures or instability it must address, allow it to create a private snapshot in `.worktrees/`, work and test in that linked worktree, reconcile only its targeted diff into the current dirty tree, and remove the worktree afterward.

### Function 7: Companion Lifecycle Safety
Add the agent-facing move command, deterministic repair based on Git diff status, manual `:::R`, and companion verification. Run repair and verification before `:::F`, `:::A`, and `:::M` so reported source moves and deletions have matching companion changes before a commit is created.

### Function 8: Resilient Re-anchoring
Add TTL-throttled re-anchoring for visible annotations and clearly present annotations that remain at file scope. Add the dedicated LLM re-anchor operation for semantic relocation when deterministic surrounding-text matching cannot recover a range.

### Function 9: Multiple Agents and Shared Awareness
Extend single-agent control to multiple managed Codex sessions, route commands by agent number, and support add, remove, and context reset. Show the user and agents with `waiting`, `working`, or `blocked` status plus current-task summaries. Persist and repair the gitignored awareness state, and let agents inspect and update it through the CLI.


## Longer Term Enhancements 

* Reverting individual diff blocks in the initial version.
* Claude integration
* Github Copilot integration (for MS shoipes)
* Editor-assisted user file rename/delete.
