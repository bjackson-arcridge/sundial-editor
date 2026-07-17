---
id: RES-0007
title: Provider command surfaces for agent control
domain: vscode.extension
summary: Local inspection and official docs show that Codex and Claude Code VS Code commands are mostly UI/context surfaces, while programmatic agent control is more likely through Codex app-server and Claude Code CLI/background-agent surfaces. Load this before designing Sundial editor provider-control adapters.
created: 2026-07-13
updated: 2026-07-13
---

## Research

This research was collected on 2026-07-13 while planning `SPEC-0008`.

### Findings

Local installed versions checked:

- `codex --version`: `codex-cli 0.131.0`.
- `claude --version`: `2.1.152 (Claude Code)`.
- Latest installed Codex VS Code extension inspected: `/Users/bjackson/.vscode/extensions/openai.chatgpt-26.707.41301-darwin-arm64`.
- Latest installed Claude Code VS Code extension inspected: `/Users/bjackson/.vscode/extensions/anthropic.claude-code-2.1.207-darwin-arm64`.

Codex VS Code extension:

- Manifest `package.json` has publisher/name/version `openai.chatgpt 26.707.41301`.
- Manifest contributed commands include:
  - `chatgpt.implementTodo`
  - `chatgpt.openSidebar`
  - `chatgpt.openCommandMenu`
  - `chatgpt.newCodexPanel`
  - `chatgpt.addToThread`
  - `chatgpt.addFileToThread`
  - `chatgpt.newChat`
  - `chatgpt.showLspMcpCliArgs`
- Manifest contributes a chat session type named `openai-codex`.
- Static inspection of `out/extension.js` found `chatgpt.addToThread` and `chatgpt.addFileToThread` add file/range context to the focused Codex view.
- Static inspection found `chatgpt.implementTodo` accepts an object shaped like `{ fileName, line, comment }` and posts/stores a webview message shaped like `{ type: "implement-todo", fileName, line, comment }`.
- Static inspection did not find a public VS Code command that accepts arbitrary prompt text and submits it to an existing Codex task.
- Static inspection found the extension starts or talks to a Codex app-server process and includes app-server method names such as `thread/start`, `thread/resume`, `turn/start`, and `turn/steer`.

Codex CLI and app-server:

- `codex --help` lists interactive commands including `resume`, `fork`, `mcp`, `mcp-server`, `app-server`, `remote-control`, `exec`, and `review`.
- `codex resume [SESSION_ID] [PROMPT]` can resume an interactive session and optionally start with a prompt, but this is a TUI-oriented surface rather than a verified append-to-running-session API.
- `codex exec` and `codex exec resume [SESSION_ID] [PROMPT]` provide non-interactive one-shot/resume flows, with flags such as `--json`, `--output-last-message`, and `--output-schema`.
- `codex app-server --help` labels the app-server as experimental and supports transports `stdio://`, `unix://`, `unix://PATH`, `ws://IP:PORT`, and `off`.
- `codex app-server` provides `generate-ts` and `generate-json-schema`. Official Codex docs say generated artifacts are specific to the Codex version that produced them.
- Generated app-server v2 protocol files from local Codex 0.131.0 include request methods:
  - `thread/start`
  - `thread/resume`
  - `thread/fork`
  - `thread/list`
  - `thread/loaded/list`
  - `thread/read`
  - `thread/inject_items`
  - `thread/archive`
  - `thread/unarchive`
  - `thread/rollback`
  - `thread/compact/start`
  - `thread/shellCommand`
  - `turn/start`
  - `turn/steer`
  - `turn/interrupt`
- Generated `TurnStartParams` is `{ threadId: string, input: Array<UserInput>, cwd?, approvalPolicy?, approvalsReviewer?, sandboxPolicy?, model?, serviceTier?, effort?, summary?, personality?, outputSchema? }`.
- Generated `TurnSteerParams` is `{ threadId: string, input: Array<UserInput>, expectedTurnId: string }`; the comment says `expectedTurnId` is a required active-turn precondition and the request fails if it does not match the currently active turn.
- Generated `ThreadStartParams` supports fields including `model`, `modelProvider`, `serviceTier`, `cwd`, `approvalPolicy`, `approvalsReviewer`, `sandbox`, `config`, `serviceName`, `baseInstructions`, `developerInstructions`, `personality`, `ephemeral`, `sessionStartSource`, and `threadSource`.
- Generated `ThreadResumeParams` requires `threadId` and documents three resume mechanisms: by thread id, by history, and by path, with precedence `history > path > thread_id`; it says to prefer `thread_id` whenever possible.
- Generated `ThreadInjectItemsParams` appends raw Responses API items to a thread's model-visible history without starting a user turn.
- Official Codex app-server docs describe starting the server, connecting a client, sending `initialize` followed by `initialized`, starting a thread and a turn, and reading notifications.
- Official Codex app-server source: https://learn.chatgpt.com/docs/app-server

Claude Code VS Code extension:

- Manifest `package.json` has publisher/name/version `Anthropic.claude-code 2.1.207`.
- Manifest contributed commands include:
  - `claude-vscode.editor.open`
  - `claude-vscode.editor.openLast`
  - `claude-vscode.primaryEditor.open`
  - `claude-vscode.window.open`
  - `claude-vscode.createWorktree`
  - `claude-vscode.sidebar.open`
  - `claude-vscode.newConversation`
  - `claude-vscode.reopenClosedSession`
  - `claude-vscode.update`
  - `claude-vscode.focus`
  - `claude-vscode.blur`
  - `claude-vscode.logout`
  - `claude-vscode.terminal.open`
- Static inspection found a URI handler for `/open` that reads `session` and `prompt`, then executes `claude-vscode.primaryEditor.open(session, prompt)`.
- Static inspection found `claude-vscode.editor.open` is registered with arguments `(sessionId, initialPrompt, viewColumn)`.
- Static inspection found the webview can receive `initialPrompt` and `initialSession`; the prompt is used as initial input/prefill, not as a verified automatic submit.
- Static inspection found `claude-vscode.focus` focuses the Claude input and can insert an active-selection mention, but did not identify a public command for submitting arbitrary text to an already-running VS Code session.
- Static inspection found the extension launches a Claude subprocess with `--output-format stream-json --verbose --input-format stream-json`, indicating the VS Code UI uses a CLI-backed streaming JSON channel internally.

Claude Code CLI and background-agent surfaces:

- Local `claude --help` supports interactive prompt arguments, `-p/--print`, `--input-format text|stream-json`, `--output-format text|json|stream-json`, `--include-partial-messages`, `--replay-user-messages`, `--resume`, `--continue`, `--fork-session`, `--session-id`, `--name`, `--remote-control`, `--ide`, `--mcp-config`, `--strict-mcp-config`, `--plugin-dir`, `--agents`, `--agent`, `--permission-mode`, `--settings`, `--allowedTools`, `--tools`, `--worktree`, and `--tmux`.
- Local `claude agents --help` says `claude agents --json` prints live sessions as a JSON array and exits without requiring a TTY.
- Local hidden/current commands also responded to `--help` for `claude attach <id>`, `claude logs <id>`, `claude stop <id>`, and `claude daemon`.
- Official Claude Code CLI reference documents `claude agents --json`, `claude attach <id>`, `claude logs <id>`, `claude stop <id>`, `claude respawn <id>`, and `claude rm <id>`.
- Official Claude Code CLI reference documents `--bg` / `--background` for starting a background agent, and says it cannot be combined with `-p` / `--print`.
- Official Claude Code agent-view docs show a launched background session prints management commands including `claude agents`, `claude attach <id>`, `claude logs <id>`, and `claude stop <id>`.
- Official Claude Code CLI reference source: https://code.claude.com/docs/en/cli-reference
- Official Claude Code agent-view source: https://code.claude.com/docs/en/agent-view

Claude Code Remote Control:

- Local `claude --help` includes `--remote-control [name]`.
- Local `claude remote-control --help` exited because the user was not logged in and printed that Remote Control is only available with claude.ai subscriptions.
- Official Claude Code Remote Control docs say Remote Control connects local Claude Code sessions to `claude.ai/code` / Claude apps for viewing and steering from web or mobile.
- Official Remote Control docs say it is activated by `/remote-control`, `claude --remote-control`, or `claude remote-control`.
- Official Remote Control docs say local Claude Code makes outbound HTTPS requests and does not open inbound ports.
- Official Remote Control docs say API-key authentication is not supported for Remote Control; it requires claude.ai OAuth, and organization policy or managed settings can disable it.
- Official Claude Code Remote Control source: https://code.claude.com/docs/en/remote-control

### Unknowns

- Codex app-server is marked experimental; protocol stability and compatibility across CLI versions must be checked against the exact version Sundial targets.
- It was not verified whether Sundial can attach to the same Codex app-server instance used by the VS Code extension, or whether it should run its own app-server process.
- No public Codex VS Code command was found for arbitrary prompt submission or live-turn steering.
- No public Claude Code VS Code command was found for arbitrary prompt submission to an already-running session.
- Claude Code's stream-json input/output surface appears suitable for probing, but this research did not verify the exact multi-turn input envelope or whether it can steer an already-active background session.
- Local Claude CLI 2.1.152 lags the installed VS Code extension 2.1.207 and current official docs; current/latest Claude CLI behavior should be rechecked after upgrade before implementation.
