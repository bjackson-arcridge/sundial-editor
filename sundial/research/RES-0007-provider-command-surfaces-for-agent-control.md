---
id: RES-0007
title: Provider command surfaces for agent control
domain: vscode.extension
summary: Local inspection and official docs show that Codex and Claude Code VS Code commands are mostly UI/context surfaces, while programmatic agent control is more likely through Codex app-server and Claude Code CLI/background-agent surfaces. Load this before designing Sundial editor provider-control adapters.
created: 2026-07-13
updated: 2026-07-20
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

- A 2026-07-20 compatibility follow-up resolved PATH `codex` to `/opt/homebrew/bin/codex`, which reported `codex-cli 0.144.6`. The installed OpenAI VS Code extension `openai.chatgpt 26.715.31925` separately bundles `/Users/bjackson/.vscode/extensions/openai.chatgpt-26.715.31925-darwin-arm64/bin/macos-aarch64/codex`, whose `codex-package.json` and `--version` report `0.145.0-alpha.18`. The current `sundial-editor-cli health` result includes the exact executable path and version it resolved.
- `codex --help` lists interactive commands including `resume`, `fork`, `mcp`, `mcp-server`, `app-server`, `remote-control`, `exec`, and `review`.
- `codex resume [SESSION_ID] [PROMPT]` can resume an interactive session and optionally start with a prompt, but this is a TUI-oriented surface rather than a verified append-to-running-session API.
- `codex exec` and `codex exec resume [SESSION_ID] [PROMPT]` provide non-interactive one-shot/resume flows, with flags such as `--json`, `--output-last-message`, and `--output-schema`.
- `codex app-server --help` labels the app-server as experimental and supports transports `stdio://`, `unix://`, `unix://PATH`, `ws://IP:PORT`, and `off`.
- `codex app-server` provides `generate-ts` and `generate-json-schema`. Official Codex docs say generated artifacts are specific to the Codex version that produced them.
- Official app-server documentation fetched on 2026-07-20 lists the stable RPC surface but does not document a runtime RPC that returns the complete supported-method inventory. Generated Codex 0.144.6 `ClientRequest.json` contains a version-specific static request union including Sundial's required operations; it is not behavioral discovery and cannot justify exact-version equality as a compatibility rule.
- The current Sundial adapter uses Codex `0.131.0` as the minimum already validated by this research, rejects older builds, and behaviorally probes safe operations on the resolved installation. Its compatibility result does not use an exact minor-version allowlist.
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
  - `model/list`
- Generated Codex 0.131.0 `ModelListParams` is `{ cursor?: string | null, includeHidden?: boolean | null, limit?: number | null }`. `cursor` is the opaque `nextCursor` from a prior response; `includeHidden: false` excludes models hidden from the default picker.
- Generated Codex 0.131.0 `ModelListResponse` is `{ data: Model[], nextCursor?: string | null }`. Each `Model` requires `id`, `model`, `displayName`, `description`, `hidden`, `isDefault`, `defaultReasoningEffort`, and `supportedReasoningEfforts`; the `id` and `model` fields are distinct protocol fields even when their values match.
- A live `model/list` probe on 2026-07-16 against authenticated Codex 0.131.0 returned four visible models and `nextCursor: null`. It marked `gpt-5.5` as `isDefault: true`; the other returned model strings were `gpt-5.4`, `gpt-5.4-mini`, and `gpt-5.3-codex-spark`.
- During that live probe, Codex logged that its cached model data contained an unrecognized reasoning-effort value `max`, then still returned the four-model response above.
- A manual Sundial run that left `ThreadStartParams.model` null failed with an error naming configured model `gpt-5.6-sol`, even though the same installed app-server's visible model list identified `gpt-5.5` as its default. This establishes that a null thread model does not necessarily resolve to the visible `model/list` default when local Codex configuration selects another model.
- Current official model documentation describes `isDefault` as the recommended default for client model pickers. It does not state that the catalog row replaces app-server configuration when the optional model override is omitted. The current Sundial adapter queries `model/list`, validates and passes an explicit request, and omits `model` when Sundial has no explicit choice.
- Generated `TurnStartParams` is `{ threadId: string, input: Array<UserInput>, cwd?, approvalPolicy?, approvalsReviewer?, sandboxPolicy?, model?, serviceTier?, effort?, summary?, personality?, outputSchema? }`.
- Generated `TurnSteerParams` is `{ threadId: string, input: Array<UserInput>, expectedTurnId: string }`; the comment says `expectedTurnId` is a required active-turn precondition and the request fails if it does not match the currently active turn.
- Generated `ThreadStartParams` supports fields including `model`, `modelProvider`, `serviceTier`, `cwd`, `approvalPolicy`, `approvalsReviewer`, `sandbox`, `config`, `serviceName`, `baseInstructions`, `developerInstructions`, `personality`, `ephemeral`, `sessionStartSource`, and `threadSource`.
- Generated `ThreadResumeParams` requires `threadId` and documents three resume mechanisms: by thread id, by history, and by path, with precedence `history > path > thread_id`; it says to prefer `thread_id` whenever possible.
- Generated `ThreadInjectItemsParams` appends raw Responses API items to a thread's model-visible history without starting a user turn.
- Official Codex app-server docs describe starting the server, connecting a client, sending `initialize` followed by `initialized`, starting a thread and a turn, and reading notifications.
- Official Codex app-server source: https://learn.chatgpt.com/docs/app-server
- Official app-server documentation fetched on 2026-07-19 says `thread/start` creates a persisted thread when `ephemeral` is false and returns a `thread` containing `id`, `sessionId`, and `ephemeral`.
- The same documentation says `thread/resume` accepts `{ threadId: string }`, returns the same thread shape as `thread/start`, and continues the stored session identified by the previously recorded thread id.
- The same documentation says `thread/read` accepts `{ threadId: string, includeTurns?: boolean }`; with `includeTurns: true`, it returns the stored thread and its turns without loading/resuming the thread or subscribing the caller to events.
- The same documentation says `thread/list` can filter by `cwd` and source kinds and returns persisted thread summaries, but a client that already owns an agent identity can read the recorded thread id directly rather than rediscovering it heuristically.
- The same documentation describes `thread/status/changed` payloads as `{ threadId, status }`, where the runtime status can be `notLoaded`, `idle`, `systemError`, or `active` with active flags. Those provider runtime values are distinct from Sundial's user-facing `waiting`, `working`, and `blocked` vocabulary.
- A live Codex 0.131.0 probe on 2026-07-20 found that `thread/start` with `ephemeral: false` returned an id and emitted `thread/started`, but no rollout file existed after the app-server process closed when no history item or turn had been written. A new process returned `thread not loaded: <id>` from `thread/read`, `no rollout found for thread id <id>` from `thread/resume`, omitted the id from `thread/list`, and returned an empty `thread/loaded/list`.
- Generated Codex 0.131.0 `ThreadInjectItemsParams` is `{ threadId: string, items: Array<JsonValue> }`; its generated comment says the raw Responses API items are appended to model-visible history.
- On that empty live thread, `thread/inject_items` accepted `{ threadId, items: [{ type: "message", role: "developer", content: [{ type: "input_text", text: "Managed Sundial session initialized." }] }] }` and returned `{}` without starting a turn. It created the rollout file immediately. After restarting app-server, `thread/read` returned the same id with `status: { type: "notLoaded" }` and `thread/resume` succeeded.
- The materialized rollout's `session_meta` retained the `baseInstructions` supplied to the original `thread/start`; the injected developer item was recorded separately. `thread/read(includeTurns: true)` returned an empty `turns` array because the injected history item did not create a user turn.
- A live Sundial compatibility probe against PATH-resolved Codex 0.144.6 on 2026-07-20 completed `initialize`, `model/list`, `thread/start`, `thread/read`, `thread/inject_items`, `thread/resume`, and `thread/archive`. It also sent deliberately incomplete parameters to `turn/start` and `turn/interrupt`; both returned parameter errors, proving the RPCs were recognized without starting a model turn. The probe archived its thread afterward.
- In that 0.144.6 probe, a second initialized app-server process could not read the empty non-ephemeral thread immediately after `thread/start`; after the first process applied `thread/inject_items`, a fresh process could read and resume it. Thus current 0.144.6 still requires Sundial's materialization marker in practice. The adapter's missing-method branch accepts an absent `thread/inject_items` only after a fresh connection reads that specific new thread; otherwise it returns an error naming the missing RPC and durability failure.

Codex VS Code transcript opening:

- The locally installed Codex extension inspected on 2026-07-19 was `openai.chatgpt 26.715.31925` at `/Users/bjackson/.vscode/extensions/openai.chatgpt-26.715.31925-darwin-arm64`.
- Static inspection of its bundled `out/extension.js` found `chatgpt.openSidebar` opens the provider UI and `chatgpt.newCodexPanel` calls `createNewPanel()`; the latter only inspects an optional analytics `source` value. No verified public command argument for opening a specific externally created app-server thread was found.

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

- Codex app-server is marked experimental and its generated schemas are version-specific. Sundial compatibility currently combines the `0.131.0` minimum with safe behavioral checks instead of exact generated-schema version equality. Turn notifications remain covered by fake-app-server integration tests because the live compatibility probe does not start a model turn.
- It was not verified whether Sundial can attach to the same Codex app-server instance used by the VS Code extension, or whether it should run its own app-server process.
- No public Codex VS Code command was found for arbitrary prompt submission or live-turn steering.
- No public Claude Code VS Code command was found for arbitrary prompt submission to an already-running session.
- Claude Code's stream-json input/output surface appears suitable for probing, but this research did not verify the exact multi-turn input envelope or whether it can steer an already-active background session.
- Local Claude CLI 2.1.152 lags the installed VS Code extension 2.1.207 and current official docs; current/latest Claude CLI behavior should be rechecked after upgrade before implementation.
