# Sundial Editor

Sundial Editor turns a source-line `%` command into a focused message composer without writing the message back to your source file. A companion CLI connects submitted messages to local coding agents such as Codex.

Marketplace id: `arcridge.sundial-editor`.

## Prompt commands

Type `%` on its own source line, with optional leading whitespace. Sundial takes over the triggered completion list while the prefix remains a valid command. Choosing a completion inserts and immediately submits it:

- `%Q` — question / no-code guidance
- `%F` — fix guidance
- `%W` — write guidance
- `%R` — refactor guidance
- `%C` — cleanup guidance
- `%T` — test guidance

Each command also has a project-scoped `@G` variant, such as `%F@G`, and accepts an optional agent selector. The command line is removed in one undoable edit and the Messages view opens a message box identified by its named source, such as `User %Q`. Submitted messages are delivered through the editor CLI.

Target a named agent by adding its stable slot or name after the command, such as `%Q>1` or `%Q>Bob`. Names match without regard to case. The composer preselects that agent and shows the current agent dropdown so you can confirm or change the target before sending.

Place a command immediately after the source line it concerns. The resulting interaction anchors to that preceding physical line. A command on the first line falls forward to the following line because there is no preceding target.

Enter sends the message and Shift+Enter inserts a newline. Sending and Escape cancellation return focus to the source location for a keyboard-only loop. When VSCodeVim is enabled, Sundial also returns it to Normal mode so the restored cursor is ready for navigation.

## Source-anchored interactions

When a user sends a message, Sundial records the interaction beside its source file independently of the agent's eventual result. For example, an interaction anchored in `src/example.ts` is stored in the checked-in YAML companion `.sundial/src/example.ts.comments`. Each anchor retains up to three non-empty source lines before and after its target as context for later re-anchoring. Opening or cancelling the composer before Send creates nothing, and malformed existing companions are left untouched.

When the assigned agent finishes, its official Markdown response appears beneath the originating user message with the stable agent name and timestamp. Responses remain nested under that interaction rather than becoming separately navigable annotations, and they reload from the companion after restart. The agent may also add optional Markdown annotations to any useful workspace file and line. User annotations link to those agent annotations, and each agent annotation links back to its originating user request. Deleting the user interaction also removes its responses, linked agent annotations, and runtime work record after confirmation.

Annotated source lines carry an editor marker. Agent activity and annotations occupy independently scrolling halves of the Messages view; drag the separator to resize them. Moving onto a marked line selects its interaction below, and the last viewed interaction remains visible after moving away. The annotation toolbar navigates, deletes, pins, or expands the interaction; pinning prevents another marked line from replacing it. Metadata such as scope, line, and anchoring context remains collapsed by default. Toolbar state lasts for the current editor session; the interaction itself survives restarts through the companion file.

After an active source is saved, Sundial automatically relocates its annotations across ordinary inserted, deleted, and replaced lines. Rapid saves are coalesced, and unsaved buffer contents are never used as an annotation baseline. If a location can no longer be represented by a source line, the interaction remains navigable with a **File** badge but has no editor marker or claimed cursor line. Cross-file links follow the relocated interaction by its stable identity.

The pane split survives webview and VS Code restarts through the `sundialEditor.paneSplitPercent` user setting. Dragging the separator or resizing it with the keyboard updates that setting; values remain between 10% and 90% so both panes stay available.

## Iterative diff and commit workflow

Sundial can turn every open workspace source tab into a built-in VS Code diff against one shared baseline. The mode is global within the current workspace: enabling it replaces existing source tabs with managed diff tabs, newly opened workspace files join the same mode, and disabling it restores ordinary editors. Sundial preserves the split tree and proportions, relative tab order, each group's selected tab, the globally active group, preview/pinned state, cursor position, active diff side, and visible source area across those transitions. Non-workspace editors are left alone.

Type these commands on their own source line and choose the completion. Sundial removes and saves the command line before running it:

- `%dd` toggles the global diff view.
- `%di` toggles VS Code's inline and side-by-side diff layout.
- `%d+` moves the baseline one first-parent commit back; `%d-` moves it one commit toward `HEAD`.
- `%d0` resets the baseline to `HEAD`; `%dp` selects the last permanent commit.
- `%cf` creates a temporary checkpoint for the current file and its dirty annotation companion.
- `%ca` creates a temporary checkpoint containing all dirty, staged, and non-ignored untracked files.
- `%cm` asks for a message, then consolidates the temporary checkpoint suffix and any remaining dirty work into one permanent commit. A prior `%ca` is not required.
- `%cr` repairs annotation companion paths for source moves and deletes reported by Git, including links between moved and related companions.

Temporary checkpoints use the exact commit message `Sundial:temp`. They are local iteration state, not publishable history: Sundial refuses to alter or consolidate a temporary stack if any checkpoint is reachable from `origin`, leaving manual repair to the user. `%cm` removes the verified temporary suffix while retaining companion content and stable annotation identities.

The annotation toolbar shows the current diff mode, layout, and abbreviated baseline. Its filter button can show only annotations assigned to the current permanent commit; the button has a tooltip and pressed state for keyboard and assistive-technology use. The filter changes markers, selection, pinning, linked-annotation opening, and previous/next navigation together. Moving the selected diff baseline or creating temporary checkpoints does not change annotation membership.

## Sundial Agents panel

Sundial Editor contributes the **Sundial Agents** panel to VS Code's right-hand Secondary Side Bar, beside other collaboration surfaces such as Codex and Claude Code. The extension reveals it once on first activation after installation; afterwards VS Code remembers whether you close or move it.

Each named agent has its own persistent queue. Submitted interactions move independently through **waiting**, **working**, and **completed**, so a busy agent can finish older work in order while other agents continue. A collapsed work card shows its latest status; expand its history to see ordered progress updates.

Managed agents also share their current coordination state and structured file claims. When intended edits overlap, the lower numeric agent slot proceeds while the other agent waits and rechecks, reducing churn without locking files or interrupting user edits.

Agent controls let you rename the logical agent, read its current-session status history, choose **Open in Codex**, interrupt current work, or reset the provider session. History contains only the concise status updates published by the agent, not provider conversation text. Interrupting or resetting returns unfinished work to that agent's queue without discarding its durable work history, stable identity, slot, or editable name. If a recorded conversation is no longer available, the agent shows **missing session**. Sending new work then asks, “No active session found; this operation will create a fresh session,” and creates one only after confirmation.

Agent queues, session records, and status histories survive VS Code restarts in CLI-owned runtime state under `.sundial/agents/`. The directory is gitignored and remains separate from checked-in source-annotation companions.

## Autosave

The extension contributes defaults for VS Code's built-in delayed autosave: `files.autoSave` is `afterDelay` and `files.autoSaveDelay` is 1000 milliseconds. User, workspace, folder, and language-specific settings retain their normal precedence.

## Tests

Run `npm test` from the repository root. The project downloads and validates its pinned VS Code test runtime into `.vscode-test/` when needed; it does not require a machine-wide VS Code installation.
