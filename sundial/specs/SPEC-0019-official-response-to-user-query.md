---
id: SPEC-0019
title: Official response to user query
status: Backlog
created: 2026-07-20
updated: 2026-07-20
created_by: bjackson
parent: SPEC-0013
domain: editor
slice: 2
---

# Official response to user query

## Discovery

This is Function 2 under SPEC-0013 and depends on SPEC-0018. It delivers one complete feedback operation: a managed agent appends its official response to the user annotation for the prompt it is currently handling, and the user can read that response in the annotation pane immediately and after restart.

An official response is not a new annotation. Under DR-0035 it reuses the originating query's `UserAnnotationId` and is stored as an ordered response entry on that user annotation. The agent supplies only the Markdown response body; SPEC-0018's current work assignment supplies the `UserAnnotationId`, source URI, stable named `AgentId`, and current `AgentSessionId`. A later explicit reassignment of the same user query may append another response without changing its identity.

This slice evolves SPEC-0011's strict version-1 companion into a strict version-2 companion that adds official responses while preserving every version-1 user annotation field and behavior. It also extends the existing annotation pane to render responses. It does not introduce agent-authored file annotations, prefix/suffix matching, cross-file mutation, file-scope feedback, or diff behavior.

The workflow is end to end: managed-agent instructions and the narrow agent-facing CLI help expose the operation; CLI-owned runtime and companion stores make it retryable and durable; the extension reloads it through typed ports; the Lit UI presents it with the originating query; and deletion, documentation, migrations, and staged tests are included.

## Applicable Decision Records

- DR-0003 through DR-0009 govern the existing Lit annotation UI, accessibility, styling, typed messages, and `WebviewView`.
- DR-0012 and DR-0016 keep response and companion mutations in the dependency-free CLI store.
- DR-0014, DR-0017, and DR-0026 govern staged VS Code testing and local CLI compilation.
- DR-0025 requires a CLI version review for the response command and schema behavior.
- DR-0033 preserves standard delayed autosave while companion watchers reload responses.
- DR-0034 supplies the per-session active-prompt context.
- DR-0035 requires responses to reuse the originating annotation identity.

## Applicable Research Notes

None.

## Planned Approach

1. Define `OfficialResponse` as an ordered entry containing the originating `UserAnnotationId`, responding `AgentId`, authoring `AgentSessionId`, Markdown body, and timestamp. It has no independent annotation ID. Extend typed CLI, host, and webview contracts plus runtime guards without exposing provider or companion details to the webview.
2. Extend companion parsing/rendering to version 2. Read version-1 user annotations as version-2 records with an empty `officialResponses` collection; preserve all existing `id`, `message`, `preset`, `scope`, and anchor fields. Write version 2 only when a response mutation touches the file. Validate the complete document before atomic replacement and leave malformed or unsupported companions untouched.
3. Add machine-readable `respond` to SPEC-0018's `sundial-annotations-cli` for a session currently assigned to a `working` item. Agent-authored input contains only the non-empty Markdown response. Resolve the origin from the session assignment, verify that the work file still names that `AgentSessionId`, validate the exact user annotation in its known companion, append the response, and return only the affected workspace-relative file; keep the existing `UserAnnotationId` internal to the mutation.
4. Persist pending response evidence on the `UserAnnotationId` work item before the companion write. The current assignment record is the idempotency identity: retrying after a lost result or temporary companion failure appends at most once, while a later explicit reassignment may append another response. A response attempted before user-annotation persistence completes remains retryable rather than creating an orphan.
5. Make `sundial-annotations-cli respond` the successful completion operation once this capability is installed and stop treating provider-turn success as sufficient for the host to call SPEC-0018's `agent work complete`: persist the official response first, then transition the work item from `working` to `completed` and clear the session assignment. If the provider turn ends without a durable response, return the unfinished item to `waiting` with an explanatory update instead of marking it completed. Repair a failure between the companion write and work transition idempotently from the pending response evidence.
6. Add the Official Response operation to managed-agent developer instructions and `sundial-annotations-cli` help. Tell the agent to use it as the final user-facing completion and distinguish it from transcript output and Provide Status Update. Ordinary model prose never mutates the companion.
7. Extend `annotations read` and extension-host ports to load official responses on activation, active-editor/selection changes, and narrowly scoped companion watcher events. Preserve SPEC-0018's work queue, sessions, histories, transcripts, and controls.
8. Render ordered official responses under their originating user query in SPEC-0011's lower annotation pane. Identify the stable named agent and timestamp, retaining the session identity only for locally available transcript/provider opening, without presenting responses as separate navigable annotations. Use the established metadata disclosure, Markdown rendering, independent scrolling, maximize/restore, keyboard behavior, and VS Code tokens.
9. Deleting the originating user annotation explicitly confirms that its nested official responses and runtime work record will also be removed. Coordinate the checked-in companion deletion and local work cleanup idempotently; responses do not add a separate delete target or leave orphans.
10. Document official responses and the version-1-to-version-2 compatibility behavior. Apply the editor minor increment relative to the committed release and review/bump the CLI version under DR-0025 without stacking increments in one uncommitted release.

## Rejected Alternatives

- Give every response a new `AnnotationId`: a response belongs to an existing user annotation and DR-0035 forbids a separate annotation identity.
- Require the agent to pass the origin ID or source path: SPEC-0018's current work assignment already owns that context.
- Infer the official response from the final transcript message: transcript presentation is not an authoritative companion mutation.
- Store responses only in `.sundial/agents/`: official answers are source feedback that must travel with the checked-in companion.
- Include file annotations in the same slice: cross-file links, anchor resolution, and deletion repair are a separate end-to-end outcome in SPEC-0020.
- Add diff fields or diff filtering to the response model: SPEC-0012 owns all version-aware presentation.

## Test Plan

- Unit-test version-1 reads, version-2 round trips, empty and multiple ordered responses, reuse of the `UserAnnotationId`, Markdown/timestamp/session validation, malformed preservation, atomic replacement, and deletion of a user annotation with responses/work state.
- Unit-test `sundial-annotations-cli respond` structured I/O, current assignment resolution, waiting/completed/reassigned rejection, no agent-visible IDs, idempotent retry after lost output or failures before/between writes, response-before-origin retry, durable response before completion, missing-response requeue, suppression of host turn-success completion, agent-facing help text, and the shared package version.
- Unit-test exhaustive typed host/webview messages and UI rendering for no response, one response, later reassignment responses, malformed CLI output, reload, metadata, Markdown, keyboard access, maximize/restore, and all four required themes.
- Add a staged VS Code scenario that submits a user query, records its active session context, invokes `sundial-annotations-cli respond` without an annotation ID, observes the response under the query, restarts/reloads it, appends a second response, and confirms parent deletion removes both. Verify all reads and mutations traverse the real CLI boundary.
- Run `npm run check-types`, `npm run lint`, `npm run test:unit`, and elevated `npm test`.

## Open Questions

None. Agent file annotations and cross-file feedback begin in SPEC-0020.

## Implementation Log

## Test Log
