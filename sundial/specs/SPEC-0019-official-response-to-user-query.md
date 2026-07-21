---
id: SPEC-0019
title: Official response to user query
status: Done
created: 2026-07-20
updated: 2026-07-21
created_by: bjackson
parent: SPEC-0013
domain: editor
slice: 2
---
# Official response to user query

> SPEC-0020 replaces the version-1/version-2 companion implementation described here with version 3 only. The compatibility details below record this completed slice; they are not current compatibility requirements.

## Discovery

This is Function 2 under SPEC-0013 and depends on SPEC-0018. It delivers one complete feedback operation: a managed agent appends its official response to the user annotation for the prompt it is currently handling, and the user can read that response in the annotation pane immediately and after restart.

An official response is not a new annotation. Under DR-0035 it reuses the originating query's `UserAnnotationId` and is stored as an ordered response entry on that user annotation. The active assignment gives the agent exactly one deterministic handoff path, `.sundial/<UserAnnotationId>response.md`. The agent writes the complete Markdown response there, then invokes `sundial-annotations-cli record-task-response <path>`. SPEC-0018's work assignment supplies and validates the source URI, stable named `AgentId`, and current `AgentSessionId`; the path is the only response input to the command. A later explicit reassignment of the same user query reuses the handoff path after its prior contents are consumed and may append another response without changing the annotation identity.

This slice evolves SPEC-0011's strict version-1 companion into a strict version-2 companion that adds official responses while preserving every version-1 user annotation field and behavior. It also extends the existing annotation pane to render responses. It does not introduce agent-authored file annotations, shared anchor creation, cross-file mutation, or diff behavior.

The workflow is end to end: managed-agent instructions and the narrow agent-facing CLI help expose the operation; the agent-authored Markdown handoff plus CLI-owned runtime and companion stores make it retryable and durable; the extension reloads it through typed ports; the Lit UI presents it with the originating query; and deletion, documentation, migrations, and staged tests are included.

## Applicable Decision Records

- DR-0003 through DR-0009 govern the existing Lit annotation UI, accessibility, styling, typed messages, and `WebviewView`.
- DR-0012 permits the agent to write the intentional Markdown body directly while keeping response recording, companion mutation, and lifecycle transitions in the CLI; DR-0016 keeps those CLI store operations dependency-free.
- DR-0014, DR-0017, and DR-0026 govern staged VS Code testing and local CLI compilation.
- DR-0025 requires a CLI version review for the response command and schema behavior.
- DR-0033 preserves standard delayed autosave while companion watchers reload responses.
- DR-0034 supplies the per-session active-prompt context.
- DR-0035 requires responses to reuse the originating annotation identity.

## Applicable Research Notes

None.

## Interface Details

SPEC-0019 extends the two-executable boundary established by SPEC-0018; it does not add a third binary or expose an editor lifecycle command to managed agents. `sundial-editor-cli` remains the trusted extension-host control plane. `sundial-annotations-cli` remains the narrow managed-agent surface and adds only `record-task-response` alongside `provide-status-update`. Both executables continue to ship from the same `@arcridge/sundial-editor-cli` package, share validated stores and contracts, and report the same package version.

`record-task-response` is the authoritative successful-completion operation for a managed assignment. The extension does not call `agent work complete` merely because a provider turn exits successfully, and ordinary provider output is never inferred to be an official response. Once `record-task-response` succeeds, the response and completed work state are already durable; the host only refreshes its projections and attempts to claim the next ready item for that logical agent.

### sundial-editor-cli Command Surface

SPEC-0019 does not add an editor-facing command, but it strengthens the behavior of four commands established by SPEC-0018. Their machine-readable request/result conventions and trusted access to Sundial identities remain unchanged.

| Command | SPEC-0019 behavior |
| --- | --- |
| `annotations read` | Accept strict version-1 and version-2 companions and return ordered official responses nested under their originating user annotation. |
| `annotations delete` | After the extension obtains explicit confirmation, coordinate idempotent removal of the originating user annotation, all nested responses, and its associated runtime work record under the existing lifecycle preconditions. |
| `agent work complete` | Require matching durable official-response evidence. It remains available for reconciliation but is no longer called merely because a provider turn succeeded. |
| `agent work requeue` | Requeue a turn that ended without a response; if matching durable response evidence exists, finish or report the pending completion instead of reverting it to `waiting`. |

`annotations append` continues to create a version-1 companion when no companion exists and does not accept agent response fields. Only the CLI-owned `record-task-response` mutation upgrades the affected companion to version 2. This keeps an editor or webview caller from impersonating a managed agent response.

### sundial-annotations-cli Command Surface

| Command | Agent-facing behavior |
| --- | --- |
| `provide-status-update "<status>"` | Retains SPEC-0018 behavior: append a concise progress update without changing workflow state. |
| `record-task-response ".sundial/<UserAnnotationId>response.md"` | Read the active assignment's Markdown handoff file, append it to the originating user annotation, and complete that assignment atomically from the caller's perspective. |

`help` and `--version` remain conventional metadata flags. Help advertises only these two operational commands in this slice, explains that `record-task-response` completes the assignment, and does not mention editor control-plane commands. SPEC-0020 later adds `annotate` as the only other managed-agent operation.

There is exactly one way to provide an official response: write the response body to the assignment's announced Markdown file and pass that file's path as the command's one positional argument:

```text
sundial-annotations-cli record-task-response ".sundial/<UserAnnotationId>response.md"
```

The command rejects stdin, `--input`, inline response text, omitted or additional arguments, and any second response-source mechanism. The argument must be the normalized workspace-relative path `.sundial/<current UserAnnotationId>response.md` derived from the invoking assignment. The CLI rejects absolute paths, traversal, alternate filenames, directories, symbolic links, non-regular files, invalid UTF-8, NUL bytes, and a file with no non-whitespace Markdown content. It reads one stable snapshot of the file before mutation; the file contents are the complete official response and no request envelope or frontmatter is allowed.

The command writes exactly one JSON result to stdout:

```json
{"file":"path/to/source.ts"}
```

The stored body normalizes line endings and otherwise preserves the Markdown. The success result contains only the originating normalized workspace-relative source path. The agent necessarily sees the `UserAnnotationId` embedded in its assigned response-file path, but the command does not accept or return a separate annotation identity and never exposes `AgentId`, `AgentSessionId`, provider IDs, companion paths, runtime-store paths, or lifecycle controls. Diagnostics go to stderr and failures exit non-zero.

The provider adapter supplies the same hidden invocation context used by `provide-status-update`. Immediately before mutation, the CLI resolves that context to one current `working` item and verifies its target logical agent, assigned `AgentSessionId`, durable origin companion, and exact originating user annotation. A waiting, deleted, retargeted, or differently assigned item returns a typed conflict without touching the companion or work state. A completed item conflicts unless it carries the matching completion receipt described below.

For a valid assignment, the CLI reads the file once and records pending-response evidence in the work item before replacing the companion. That evidence identifies the assignment attempt and contains the normalized response path, body digest, target companion, mutation phase, and eventual completion receipt; it does not create another annotation identity. The CLI then appends one `OfficialResponse`, verifies the durable companion, transitions the work item to `completed`, appends its final history entry, clears its current assignment, and removes the handoff file. A retry with the same hidden assignment context and path returns the recorded success result after completion even when the consumed file is absent. If the file still exists, its digest must match before cleanup; different content conflicts and is preserved. A later explicit reassignment creates new attempt evidence and may reuse the same deterministic path for a second ordered response.

If reading or persisting the response fails, the item remains `working`, the handoff file is preserved, and `record-task-response` exits non-zero so the same invocation can retry. If the response is durable but the work transition or handoff cleanup is interrupted, the next retry or host reconciliation verifies the matching stored response and finishes the remaining phases without duplication. If a provider turn ends without success or a companion write that can be verified and completed, the host requeues the unfinished item with a reason; it never synthesizes a response from the transcript or independently ingests the Markdown file.

### Extension and Webview Projection

`annotations read` returns ordered official responses as part of the originating user annotation. The extension maps persisted `AgentId` attribution to the current stable agent name and retains `AgentSessionId` only in extension-host state for existing transcript or provider-opening controls. The webview receives a presentation-safe nested response model containing body, timestamp, and display attribution, with no independent response identity, `AgentSessionId`, provider ID, storage path, or pending-operation evidence. The enclosing user annotation retains the identity required by SPEC-0011 selection and SPEC-0018 work-card projection.

Companion watcher notifications identify the affected normalized source file and trigger a narrow re-read through `sundial-editor-cli`; the host does not parse YAML or merge response arrays itself. Host-to-webview and webview-to-host messages remain runtime-guarded discriminated unions with exhaustive dispatch. Responses are nested presentation records rather than independently selectable annotations, so existing source-marker selection and navigation continue to key only on the originating user annotation.

## Prompt Details

SPEC-0019 updates SPEC-0018's plain Markdown templates under `packages/cli/src/prompts/`. Preset and scope fragments remain unchanged. The trusted assignment wrapper adds the deterministic response path, and the shared managed-agent contract retains the status guidance while replacing its turn-success completion paragraph with the following text:

### Shared managed-agent contract amendment

```text
When the assignment has a final user-facing outcome, write the complete Markdown
body to the response file announced below. Then record it exactly once with:

  sundial-annotations-cli record-task-response "{{response_file}}"

The file contents are the complete answer the user should see: state the outcome,
important files changed, validation performed, and any concrete blocker. Write
plain Markdown with no request envelope or frontmatter. Do not pass the body on
stdin or as a command argument, and do not use another file path.

Record Task Response is the successful completion operation. Call it only after
the work and validation are finished. After it succeeds, do not modify the
workspace. A brief provider reply may summarize the recorded outcome, but normal
provider prose does not complete the assignment. If the command fails, preserve
the response file, follow its diagnostic, and retry only when safe; never
substitute Provide Status Update for the final response.
```

For each claimed assignment, the trusted wrapper renders exactly one `response_file` value in the form `.sundial/<UserAnnotationId>response.md` and repeats the completion fragment because persistent provider conversations contain earlier work. The existing contract still says earlier assignments are background, forbids inspection or mutation of Sundial lifecycle state other than writing this announced handoff file and calling the two documented agent commands, and reserves `provide-status-update` for meaningful in-progress phases.

The response path and CLI invocation contract are rendered as trusted instruction text outside `<sundial_assignment>`. Repository paths, source context, and the user's request remain escaped data inside that delimiter and cannot alter the path or command schema. The prompt exposes no separate annotation identity and never interpolates an agent, session, provider, or pending-operation identity.

## Planned Approach

1. Define `OfficialResponse` as an ordered entry containing the originating `UserAnnotationId`, responding `AgentId`, authoring `AgentSessionId`, Markdown body, and timestamp. It has no independent annotation ID. Extend typed CLI, host, and webview contracts plus runtime guards without exposing provider or companion details to the webview.
2. Extend companion parsing/rendering to version 2. Read version-1 user annotations as version-2 records with an empty `officialResponses` collection; preserve all existing `id`, `message`, `preset`, `scope`, and anchor fields. Write version 2 only when a response mutation touches the file. Validate the complete document before atomic replacement and leave malformed or unsupported companions untouched.
3. Add the single-path `record-task-response ".sundial/<UserAnnotationId>response.md"` interface defined under Interface Details to SPEC-0018's `sundial-annotations-cli`. The active assignment announces the exact path. Accept no body, stdin, input flag, alternate path, or extra argument; read the non-empty Markdown file, resolve the origin from assignment context, verify the invoking `AgentSessionId` and exact user annotation, and return only the affected workspace-relative source file.
4. Persist pending response evidence on the `UserAnnotationId` work item before the companion write. Retain the assignment-scoped handoff path, body digest, phase, and completion receipt long enough for a lost-result retry to resolve after the file is consumed and the current assignment is cleared. The same assignment and content append at most once, changed content conflicts, and a later explicit reassignment may reuse the path for another response. Preserve the handoff file until the response and workflow completion are durable, then remove it idempotently.
5. Make `sundial-annotations-cli record-task-response` the successful completion operation once this capability is installed and stop treating provider-turn success as sufficient for the host to call SPEC-0018's `agent work complete`: read and persist the official response first, transition the work item from `working` to `completed`, clear the session assignment, then consume the handoff file. If the provider turn ends without a durable response, return the unfinished item to `waiting` with an explanatory update instead of marking it completed. Repair a failure between any phase idempotently from the pending response evidence.
6. Add the Prompt Details completion fragment and deterministic response path to managed-agent instructions, and document the one-positional-path contract in `sundial-annotations-cli` help. Tell the agent to write the file only after work and validation, invoke the command with that exact path, stop workspace mutation after success, and distinguish it from transcript output and Provide Status Update. Ordinary model prose never mutates the companion.
7. Extend `annotations read` and extension-host ports to load official responses on activation, active-editor/selection changes, and narrowly scoped companion watcher events. Preserve SPEC-0018's work queue, sessions, histories, transcripts, and controls.
8. Render ordered official responses under their originating user query in SPEC-0011's lower annotation pane. Identify the stable named agent and timestamp, retaining the session identity only for locally available transcript/provider opening, without presenting responses as separate navigable annotations. Use the established metadata disclosure, Markdown rendering, independent scrolling, maximize/restore, keyboard behavior, and VS Code tokens.
9. Deleting the originating user annotation explicitly confirms that its nested official responses and runtime work record will also be removed. Coordinate the checked-in companion deletion and local work cleanup idempotently; responses do not add a separate delete target or leave orphans.
10. Document official responses and the version-1-to-version-2 compatibility behavior. Apply the editor minor increment relative to the committed release and review/bump the CLI version under DR-0025 without stacking increments in one uncommitted release.

## Rejected Alternatives

- Give every response a new `AnnotationId`: a response belongs to an existing user annotation and DR-0035 forbids a separate annotation identity.
- Require a separate origin ID or source path argument: the deterministic handoff filename already derives from the current `UserAnnotationId`, and assignment context owns the remaining origin data.
- Accept the response body through JSON, stdin, an inline argument, or multiple interchangeable mechanisms: the assigned Markdown file followed by `record-task-response <path>` is the only ingestion path.
- Infer the official response from the final transcript message: transcript presentation is not an authoritative companion mutation.
- Store responses only in `.sundial/agents/`: official answers are source feedback that must travel with the checked-in companion.
- Include file annotations in the same slice: cross-file links, anchor resolution, and deletion repair are a separate end-to-end outcome in SPEC-0020.
- Add diff fields or diff filtering to the response model: SPEC-0012 owns all version-aware presentation.

## Test Plan

- Unit-test version-1 reads, version-2 round trips, empty and multiple ordered responses, reuse of the `UserAnnotationId`, Markdown/timestamp/session validation, malformed preservation, atomic replacement, and deletion of a user annotation with responses/work state.
- Unit-test `sundial-annotations-cli record-task-response` with exactly one positional handoff path, deterministic `.sundial/<UserAnnotationId>response.md` matching, multiline Markdown, stable-snapshot reads, normalized source-path results, and rejection of stdin/input flags, inline bodies, extra arguments, alternate/absolute/traversing paths, symlinks, non-files, invalid UTF-8, NUL, and empty content. Cover current-assignment resolution, waiting/unmatched-completed/reassigned rejection, matching completed-receipt success after file consumption, changed-content conflict, handoff preservation on failure, idempotent cleanup and retry after failures between every phase, response-before-origin retry, missing-response requeue, suppression of host turn-success completion, editor completion/requeue preconditions, agent-facing help text, and the shared package version.
- Snapshot-test the managed-agent contract amendment, deterministic response-path interpolation, its placement outside the escaped assignment payload, repetition for persistent sessions, unchanged preset/scope fragments, the absence of agent/session/provider identities and editor commands, and the distinction among Record Task Response, Provide Status Update, and ordinary provider prose.
- Unit-test exhaustive typed host/webview messages and UI rendering for no response, one response, later reassignment responses, malformed CLI output, reload, metadata, Markdown, keyboard access, maximize/restore, and all four required themes.
- Add a staged VS Code scenario that submits a user query, receives its deterministic response path, writes Markdown there, invokes `sundial-annotations-cli record-task-response` with that one path, observes the consumed handoff and response under the query, restarts/reloads it, reassigns the query and reuses the path for a second response, and confirms parent deletion removes both. Verify all reads and mutations traverse the real CLI boundary.
- Run `npm run check-types`, `npm run lint`, `npm run test:unit`, and elevated `npm test`.

## Open Questions

None. Agent file annotations and cross-file feedback begin in SPEC-0020.

## Implementation Log

- 2026-07-20: Added strict version-2 companion support with ordered `OfficialResponse` entries while retaining version-1 reads and writes until the first response mutation.
- 2026-07-20: Added assignment-scoped response evidence, completion receipts, deterministic handoff validation, idempotent phase recovery, and the narrow `record-task-response` managed-agent command.
- 2026-07-20: Updated managed prompts, host completion/requeue behavior, typed CLI/extension/webview projections, narrow companion refreshes, response-aware deletion, and Markdown response presentation.
- 2026-07-20: Updated staged CLI fixtures, documentation, ignore rules, and the shared package release versions (`@arcridge/sundial-editor-cli` 0.4.0 and `sundial-editor` 0.8.0).
- 2026-07-20: No Decision Record candidate was added; the implementation applies the accepted records listed above without establishing a new durable project convention.

## Test Log

- 2026-07-20: `npm run check-types` passed for the CLI, extension host, and webview projects.
- 2026-07-20: `npm run lint` passed.
- 2026-07-20: `npm run test:unit` passed after rebasing (44 CLI tests and 75 editor tests).
- 2026-07-20: Elevated `npm test` passed after rebasing (11 CLI integration tests, including the provider capability cache, and all staged VS Code 1.118.1 scenarios: delayed autosave, prompt-to-messages official-response flow/reload/deletion, and annotation retry).
