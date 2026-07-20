# Sundial Editor

Sundial Editor turns a source-line `%` command into a focused message composer without writing the message back to your source file. A companion CLI connects submitted messages to local coding agents such as Codex.

Marketplace id: `arcridge.sundial-editor`.

## Prompt commands

Type `%` as the first character of a source line. Sundial takes over the triggered completion list while the prefix remains a valid command. Choosing a completion inserts and immediately submits it:

- `%Q` — question / no-code guidance
- `%F` — fix guidance
- `%W` — write guidance
- `%R` — refactor guidance
- `%C` — cleanup guidance
- `%T` — test guidance

Each command also has a project-scoped `@G` variant, such as `%F @G`. Commands do not select an agent; agent routing is deferred. The command line is removed in one undoable edit and the Messages view opens a message box identified by its named source, such as `User %Q`. Submitted messages are delivered through the companion CLI.

Place a command immediately after the source line it concerns. The resulting interaction anchors to that preceding physical line. A command on the first line falls forward to the following line because there is no preceding target.

Enter sends the message and Shift+Enter inserts a newline. Sending and Escape cancellation return focus to the source location for a keyboard-only loop. When VSCodeVim is enabled, Sundial also returns it to Normal mode so the restored cursor is ready for navigation.

## Source-anchored interactions

When a user sends a message, Sundial records the interaction beside its source file independently of the agent's eventual result. For example, an interaction anchored in `src/example.ts` is stored in the checked-in YAML companion `.sundial/src/example.ts.comments`. Each anchor retains up to three non-empty source lines before and after its target as context for later re-anchoring. Opening or cancelling the composer before Send creates nothing, and malformed existing companions are left untouched.

Annotated source lines carry an editor marker. Agent activity and annotations occupy independently scrolling halves of the Messages view; drag the separator to resize them. Moving onto a marked line selects its interaction below, and the last viewed interaction remains visible after moving away. The annotation toolbar navigates, deletes, pins, or expands the interaction; pinning prevents another marked line from replacing it. Metadata such as scope, line, and anchoring context remains collapsed by default. Toolbar state lasts for the current editor session; the interaction itself survives restarts through the companion file.

## Sundial Agents panel

Sundial Editor contributes the **Sundial Agents** panel to VS Code's right-hand Secondary Side Bar, beside other collaboration surfaces such as Codex and Claude Code. The extension reveals it once on first activation after installation; afterwards VS Code remembers whether you close or move it.

Streamed agent responses are rendered as Markdown, preserving the structure supplied by the agent without adding spacing between stream chunks.

## Autosave

The extension contributes defaults for VS Code's built-in delayed autosave: `files.autoSave` is `afterDelay` and `files.autoSaveDelay` is 1000 milliseconds. User, workspace, folder, and language-specific settings retain their normal precedence.

## Tests

Run `npm test` from the repository root. The project downloads and validates its pinned VS Code test runtime into `.vscode-test/` when needed; it does not require a machine-wide VS Code installation.
