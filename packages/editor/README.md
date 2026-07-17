# Sundial Editor

Sundial Editor turns a source-line `%` command into a focused message composer without writing the message back to your source file. This first editor-integration slice does not route a command or submitted message to an agent.

Marketplace id: `arcridge.sundial-editor`.

## Prompt commands

Type `%` as the first character of a source line. Sundial takes over the triggered completion list while the prefix remains a valid command. Choosing a completion inserts and immediately submits it:

- `%Q` — question / no-code guidance
- `%F` — fix guidance
- `%W` — write guidance
- `%R` — refactor guidance
- `%C` — cleanup guidance
- `%T` — test guidance

Each command also has a project-scoped `@G` variant, such as `%F @G`. Commands do not select an agent; agent routing is deferred. The command line is removed in one undoable edit and the Messages view opens with the preset and scope shown above the message box. The composer is prefilled with deterministic `[Integration stub]` text to prove the editor handoff, but it does not contact an agent or persist a message.

Enter sends the message and Shift+Enter inserts a newline. Sending and Escape cancellation return focus to the source location for a keyboard-only loop. When VSCodeVim is enabled, Sundial also returns it to Normal mode so the restored cursor is ready for navigation.

## Sundial Agents panel

Sundial Editor contributes the **Sundial Agents** panel to VS Code's right-hand Secondary Side Bar, beside other collaboration surfaces such as Codex and Claude Code. The extension reveals it once on first activation after installation; afterwards VS Code remembers whether you close or move it.

## Autosave

The extension contributes defaults for VS Code's built-in delayed autosave: `files.autoSave` is `afterDelay` and `files.autoSaveDelay` is 1000 milliseconds. User, workspace, folder, and language-specific settings retain their normal precedence.

## Tests

Run `npm test` from the repository root. The project downloads and validates its pinned VS Code test runtime into `.vscode-test/` when needed; it does not require a machine-wide VS Code installation.
