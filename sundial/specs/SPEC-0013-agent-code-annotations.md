---
id: SPEC-0013
title: Agent control, feedback, and code annotations
status: Todo
created: 2026-07-13
updated: 2026-07-20
created_by: bjackson
parent: SPEC-0008
domain: editor
slice: 4
---
# Agent control, feedback, and code annotations

## Discovery and Requirements

This is the revised functional slice 4 from SPEC-0008. It now has two implementation parts within one spec:

1. Design the ideal agent control and feedback surface, then connect it to independently persistent managed-agent sessions.
2. Connect the surface's agent-authored feedback operations to SPEC-0011's completed YAML companion and annotation UI.

SPEC-0011 already provides the concrete integration seam: UUID-backed opaque annotation IDs; strict version-1 YAML companions at `.sundial/<source>.comments`; atomic CLI-owned `annotations append`, `annotations read`, and `annotations delete`; source-line markers; retained selection, pinning, navigation, and deletion; and independently scrolling agent and annotation sections separated by an accessible resizable 50/50 split. This spec extends those contracts rather than designing a parallel annotation repository or replacing the established layout.

### Identifiers and operation context

- `AgentSessionId` is the opaque session identifier supplied by the provider harness, initially Codex and later Claude Code.
- `AnnotationId` is the existing opaque stable identifier emitted by SPEC-0011. Current companions use UUID-backed strings. User-prompt annotations and agent file annotations each receive their own `AnnotationId`; consumers do not infer meaning from its format.
- An official response is appended to its originating user-prompt annotation. It carries that existing `AnnotationId`; it does not create another annotation or generate a new `AnnotationId`.

The selected session's gitignored runtime file records the current user prompt being worked, including its `AnnotationId`, source URI, and workspace context. Managed-agent instructions and agent-authored control arguments do not expose or require annotation IDs. The CLI resolves the active origin from the session context, generates IDs for new file annotations, and returns the applicable existing or generated identity programmatically.

### Control operations

1. **Provide Status Update** appends a lifecycle status and free-form update to the current agent session's ordered status history. These updates drive the default collapsed UI.
2. **Annotate File** accepts a target file, anchor prefix, annotation body, and anchor suffix. The CLI resolves the session's active user annotation, generates an `AnnotationId`, stores the agent annotation in the target companion, and links it from the originating user annotation.
3. **Official Response** accepts a final work summary. The CLI appends it to the session's active user annotation and includes that annotation's existing `AnnotationId` in the result. Multiple sessions or run generations may append responses to one user annotation.

Every operation is mediated by the CLI. Neither the extension, webview, nor agent edits a runtime or companion file directly. No operation is inferred from ordinary model prose.

### Agent state and UI

The upper section of the existing Messages view lists every current Sundial-managed agent. Each collapsed card shows `working`, `waiting`, or `blocked` plus its most recent free-form update. A separate disclosure expands a bounded-height, scrollable chronological status history. A transcript action opens long-form provider output in the upper section; Back or Escape returns to the list and restores focus. Working sessions expose Interrupt, and every session exposes Reset.

Each active Codex card also exposes **Open in Codex**. If a verified provider capability can open the exact recorded thread in the Codex sidebar, use it; otherwise open a VS Code terminal with Codex's supported resume flow for that thread. Hide or disable the action with an explanation when its local provider cache is unavailable. Do not pass guessed arguments to provider extension commands.

The lower annotation section delivered by SPEC-0011 remains independently scrollable and resizable. It renders user annotations, linked agent file annotations, and official responses using the existing retained-selection, pin, navigation, delete, metadata-disclosure, and maximize/restore interactions. Agent feedback resolves against the latest source: a unique anchor appears at its active location, while a missing or ambiguous anchor is presented explicitly at file scope.

Each current managed session has its own exactly gitignored runtime file under `.sundial/agents/`. It stores the exact `AgentSessionId`, provider metadata and conversation identity, active prompt reference, active-run generation/evidence, and append-only ordered status updates. Reset deletes only that session's old runtime file, creates a new provider session, and writes its new runtime file.

Multiple agents' UI and independent persistence are in scope. Prompt routing, agent-to-agent interaction, shared user awareness, and cross-agent coordination remain in SPEC-0017. This spec contains no diff model, baseline selection, version-aware filtering, temporary commits, or diff-shaped placeholder state; SPEC-0012 extends the completed surface with all version and diff behavior.

The dependency order is SPEC-0010, SPEC-0011, this combined control/annotation slice, then SPEC-0012.

## Applicable Decision Records

- DR-0003 through DR-0009 govern the Lit webview, host/client split, CSP, accessibility, token styling, typed messages, and `WebviewView` surface.
- DR-0012 keeps runtime and companion mutations behind the CLI-backed store.
- DR-0014, DR-0017, and DR-0026 govern staged VS Code integration coverage and local CLI compilation.
- DR-0016 keeps CLI store operations dependency-free and out of shell pipelines.
- DR-0025 requires a CLI version review for the new agent and annotation commands.
- DR-0033 preserves the standard delayed autosave behavior while companion watchers are extended.

## Applicable Research Notes

- RES-0007 Provider command surfaces for agent control.

## Planned Approach

### Part 1: control surface and persistent agent backing

1. Define provider-neutral contracts for agent summaries, ordered status updates, transcripts, supported actions, user annotations, agent file annotations, official responses, active-location and file-scope feedback, and loading/empty/error states. An official-response view model carries its originating user annotation's ID and has no independent annotation identity. Provider conversation IDs, companion paths, diff baselines, and version identifiers do not cross the webview boundary.
2. Reshape SPEC-0011's upper agent section into an agent-list state machine without replacing its lower annotation section or accessible splitter. Render one card per current session with latest status by default and separate actions for status history, transcript, Open in Provider, Interrupt, and Reset. Transcript detail uses the upper section and restores focus on Back or Escape.
3. Put all inputs and actions behind typed extension-host ports and discriminated host/webview messages. Build reducers and Lit states against deterministic fixtures covering zero, one, and several agents; ordered histories; waiting/working/blocked states; transcripts; provider-open capabilities; user/agent/response feedback; active and file scope; and loading, empty, and failure states. Test-only fixtures do not become a production fallback.
4. Complete the interaction design before provider integration: semantic landmarks and buttons, status text in addition to visual treatment, logical Tab order, Enter/Space activation, arrow-key behavior where applicable, Escape/Back focus restoration, polite live regions, bounded independent scrolling, and VS Code token-only styling in all four required themes.
5. Store sessions in `.sundial/agents/` as one versioned JSON file per `AgentSessionId`, using a filename-safe encoding while retaining the exact ID inside. Include provider conversation identifiers, an optional `activePrompt` containing `AnnotationId`, source URI, workspace context, and accepted prompt data, active-run generation/evidence, pending feedback-operation evidence, and append-only `statusUpdates`. Validate before every same-directory atomic replacement; report malformed state and leave it untouched.
6. Start Codex threads as non-ephemeral, create session state before the first turn, and resume later turns by the recorded provider identity. Append automatic `working` at turn start and `blocked` after provider/startup/protocol failure. After success or interruption, append `waiting` unless the same active generation explicitly reported `blocked`. Ordinary transitions never erase earlier updates.
7. Add machine-readable `agent list`, `agent show`, `agent prompt begin`, `agent status`, `agent transcript`, `agent open`, `agent interrupt`, and `agent reset` CLI operations with discriminated JSON output. Status, feedback, and interrupt reject superseded generations. `agent open` uses only a verified exact-thread provider launch, falling back for Codex to a VS Code terminal running `codex resume <thread-id>`. Reset stops the old session if needed, deletes only its resolved runtime file, starts a new provider session, and writes the replacement state before reporting success.
8. On Send, `agent prompt begin` generates or reserves the opaque `AnnotationId` through the same CLI ID facility used by the annotation store and records the active prompt before provider delivery begins. Extend SPEC-0011's append request to accept this trusted preallocated ID while preserving its existing generate-on-append behavior for callers without one. The extension may then retain SPEC-0011's independent annotation-persistence and agent-delivery retries: both branches share the reserved ID, a persistence retry does not redeliver, and a delivery retry does not duplicate the user annotation. The agent never receives the ID as a control argument.
9. Give managed agents explicit developer instructions describing their session and active generation, the status vocabulary, when to provide a free-form update, and the Annotate File and Official Response argument shapes. Make the same contract discoverable in CLI help and capability output. Do not infer a typed operation from ordinary output text.
10. Normalize provider transcripts; for Codex use `thread/read(includeTurns: true)` and retain user-visible messages, activity/tool summaries, errors, and timestamps. Wire prompt lifecycle, runtime-directory watching, list refresh, history expansion, transcript loading, and CLI-mediated Open/Interrupt/Reset to the completed surface without relying on undocumented `chatgpt.*` arguments.

### Part 2: companion-backed agent annotations and responses

11. Extend the strict companion schema from version 1 to version 2. Continue reading version-1 user annotations and normalize them to empty agent-link and response collections. Version-2 user records preserve the existing `id`, `message`, `preset`, `scope`, and `anchor`; add ordered links to agent annotations and ordered official responses. Version-2 agent records carry their own `AnnotationId`, originating user `AnnotationId`, `AgentSessionId`, Markdown body, submitted prefix/suffix context, and either a resolved source anchor or explicit file scope. Validate complete documents before writing and never silently discard unknown or malformed data.
12. Implement CLI-owned `annotations append-agent` for Annotate File. Trusted session context supplies `AgentSessionId`, active generation, originating `AnnotationId`, and originating source URI; agent-authored input supplies only target file, prefix, Markdown body, and suffix. Validate the origin and target before writing. Reserve the child `AnnotationId` in the session's pending-operation state so retries reuse it, then atomically write the target annotation and origin link. For cross-file failure after one write, a retry idempotently repairs the missing half rather than duplicating either record.
13. Implement CLI-owned `annotations respond` for Official Response. Trusted session context supplies the origin; agent-authored input supplies only the Markdown summary. Append a response carrying the existing originating `AnnotationId`, `AgentSessionId`, active generation, body, and timestamp without generating another `AnnotationId`. Treat session plus active generation as the retry identity so a lost result can be retried without duplication while later generations can append additional responses.
14. Resolve agent file annotations only against the latest active source. A unique prefix/suffix match becomes a resolved source anchor compatible with the existing annotation viewer. Missing or ambiguous context remains stored and renders at explicit file scope without claiming an incorrect line. TTL throttling, automatic write-back, and semantic relocation remain in SPEC-0016.
15. Extend `annotations read` and the typed host/view models to return user annotations with linked agent feedback and official responses. Reuse SPEC-0011's lower annotation pane, markers, retained selection, pinning, previous/next navigation, metadata disclosure, deletion confirmation, maximize/restore behavior, and companion watcher. Deleting a user origin explicitly confirms and cascades to its nested responses and linked child annotations after every affected companion validates; persist enough operation evidence to repair a failure between files. Deleting a child agent annotation removes only the target record and its origin link through the same CLI-owned idempotent mechanism.
16. Keep provider runtime data out of checked-in companions. The runtime file associates the locally cached provider conversation with the active annotation, which enables transcript and Open in Provider while active; companions retain only source feedback and the minimal `AgentSessionId` attribution on authored entries.
17. Document the combined workflow, apply the editor version increment required relative to the committed release, and review/bump the CLI version under DR-0025. If SPEC-0011's manifest edits are still part of the same uncommitted release, do not stack another increment; if its release has been committed, treat SPEC-0013's added user-facing behavior as the next minor release.

## Rejected Alternatives

- Keep Codex threads ephemeral and treat the current run log as transcript history: completed sessions would disappear and provider-native reopening would lose the continuing conversation.
- Invoke private or guessed VS Code command arguments for an exact provider thread: unsupported integration would be brittle; use a verified capability or terminal resume.
- Store lifecycle state, provider identities, or the active-prompt pointer in YAML companions: runtime coordination is local and independent of source history.
- Store every agent in one `.sundial/agents.json`: per-session files isolate validation, status history, reset, and provider lifecycle.
- Require an agent to copy or pass annotation IDs: session state already owns the active origin and CLI code owns generated identities.
- Assign an independent `AnnotationId` to an official response: it is a response on an existing user annotation, not another annotation.
- Replace SPEC-0011's annotation pane or create an agent-only store: the implemented split surface and companion repository are the integration foundation.
- Mutate companions directly from the extension or webview: all validation, schema evolution, cross-file repair, and logical deletion belong to the CLI.
- Guess a nearby source location when prefix/suffix matching is absent or ambiguous: explicit file scope is safer.
- Add a diff abstraction or placeholder now: SPEC-0012 owns version selection, diff views, baselines, and diff-scoped presentation.
- Move prompt routing or cross-agent awareness here: this slice manages multiple independent sessions, while SPEC-0017 owns coordination among them.

## Test Plan

- Surface: unit-test exhaustive typed messages and view-model transitions for zero/one/multiple agents, latest and expanded histories, waiting/working/blocked, transcripts, Open in Provider capability/fallback/unavailable states, Interrupt, Reset, user/agent/response feedback, active/file scope, and Back/Escape focus restoration. Verify the existing splitter, independent scrolling, keyboard behavior, and four required themes.
- Runtime: unit-test session-ID filename safety, exact ID retention, active-prompt reservation, opaque annotation-ID validation, identical-prompt uniqueness, append ordering, pending-operation evidence, atomic replacement, exact gitignore scope, generation checks, malformed-state preservation, structured CLI I/O/help/capabilities, and version metadata.
- Provider: extend fake app-server coverage for several non-ephemeral sessions, independent resume/read/open, automatic and agent-authored statuses, interruption, model-reported blocks, reset deletion/new-session creation, and failures before or after state persistence.
- Companion: unit-test version-1 reads and version-2 round trips; user and agent records; origin links; official responses reusing the origin ID; same-file and cross-file validation; child-ID retry repair; response retry idempotency; normalized paths; malformed preservation; unique, missing, ambiguous, and deleted anchors; explicit file fallback; child unlinking; and validated cascading origin deletion with repair after partial failure.
- Integration: stage several fake sessions and exercise the real `WebviewView` through CLI-backed ports. Submit a prompt, verify its reserved ID is shared by independent persistence/delivery, append a linked agent annotation and two official responses without agent-authored IDs, reload them in the existing annotation pane, open status history and transcript, exercise Open/Interrupt/Reset, and verify no direct runtime or companion writes by the extension.
- Run `npm run check-types`, `npm run lint`, `npm run test:unit`, and elevated `npm test`.

## Open Questions

None. SPEC-0017 owns prompt routing and shared coordination; SPEC-0012 owns all version and diff extensions.

## Implementation Log

## Test Log
