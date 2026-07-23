---
id: SPEC-0022
title: Expose creating agent tasks via VS Code commands
status: Active
created: 2026-07-23
updated: 2026-07-23
created_by: bjackson
---

# Expose creating agent tasks via VS Code commands

## Discovery

- The consumer is programmatic. The Sundial plugin is the first caller, but its worktree-merging workflow is only a use case; Git/rebase semantics do not belong in the editor command contract.
- The existing `sundialEditor.submitPrompt` path is interactive and annotation-first: it derives context from the active editor, opens the composer, reserves a `UserAnnotationId`, appends a source companion annotation, and only then marks work ready. A generic background task must not require editor focus, a visible webview, user confirmation, or a source annotation.
- Direct tasks can reuse the existing logical agents, persisted sessions, FIFO claims, ordered updates, managed provider turns, and CLI-owned runtime store. They need a distinct work origin because their response belongs to the task record rather than a source companion.
- The VS Code surface must be small and composable: submit a task, receive a stable request handle, and read its status/result. Callers own higher-level orchestration, polling policy, retries after task completion, and interpretation of the response.
- VS Code commands do not authenticate which extension invoked them. The contract therefore accepts only bounded task data, explicit workspace and target selectors, and a narrow session policy; it does not expose lifecycle mutation primitives or provider/session internals.
- `packages/editor/package.json` is currently at committed version `0.15.0` and `packages/cli/package.json` is at `0.8.0`. The new programmatic VS Code and CLI task surfaces require one minor increment per package, to editor `0.16.0` and CLI `0.9.0`, without stacking later bumps in the same uncommitted release.

## Applicable Decision Records

- DR-0012 — keep queue and lifecycle mutations in the CLI-backed store; VS Code commands reuse the existing extension-to-CLI submission path.
- DR-0025 — review and increment the CLI package for its new public programmatic-task commands and result contracts.
- DR-0036 — preserve annotation-backed work while extending the work model with a separate programmatic origin targeted to the same stable `AgentId`.
- DR-0037 — populate and validate target choices from persisted agent/session state, not a provider probe.
- DR-0039 and DR-0043 — introduce one current versioned contract and update all internal work-item callers together rather than adding workflow-specific aliases or compatibility branches.
- DR-0040 and DR-0042 — leave companion locking and CLI-mediated annotation behavior unchanged; programmatic tasks do not create or mutate companions.

## Applicable Research Notes

- None. The checked-in VS Code, CLI, work-store, response-recording, and Git workflow implementations were sufficient for this plan.

## Planned Approach

1. Generalize the CLI work model into a discriminated union with the existing annotation-backed item and a direct item. Both retain an internal ID, `agentId`, prompt, lifecycle, assignment, and ordered updates. A direct origin records only the opaque caller-supplied request ID and optional source context; it has no caller identity, workflow operation, companion identity, or source-annotation readiness phase.
2. Add CLI-owned `agent task submit` and `agent task status` machine operations. Submission validates an exact versioned request, resolves the stable target by `{ slot }` or `{ name }`, requires an available persisted session unless the request explicitly permits ensuring a fresh one, creates the direct item already ready, and returns the existing item for an exact retry. Reusing the request ID with different target or task content returns a typed idempotency conflict; status is a read-only lookup by workspace and request ID.
3. Define the version-1 submit request as JSON-friendly data:
   - `version: 1`;
   - safe opaque `requestId`;
   - `workspaceUri` for an exact open local workspace folder;
   - target selector `{ slot }` or `{ name }`;
   - task `title`, `message`, preset, and `line | project` scope;
   - optional source context `{ uri, line }`;
   - `sessionPolicy: "require-existing" | "ensure"`.
   Line scope requires source context; project scope does not. Source context is validated inside the workspace and supplies the same bounded repository context used by managed prompts, but it does not create an annotation.
4. Extend managed prompt construction with a generic direct-assignment variant. It composes the existing managed-agent contract, caller-selected preset and scope, optional delimited source context, and delimited task message. It adds no Sundial-plugin, Git, merge, rebase, or worktree instructions; those belong in the caller's task.
5. Reuse the agent-facing response handoff, but branch its durable destination by work origin. Annotation-backed responses continue to use the originating companion under DR-0035. Direct-task responses are validated against the active assignment, stored once in the CLI task record with completion evidence, and transition that item to `completed` without touching a companion. Exact retries remain idempotent and changed content conflicts.
6. Register two non-palette VS Code commands and activation events:
   - `sundialEditor.agentTask.submit(request)` returns once the programmatic task is durably ready;
   - `sundialEditor.agentTask.status(request)` returns the current lifecycle/result for a previously submitted task.
   Both delegate mutations and reads to typed CLI commands. They do not require the Messages view, active editor, active file, or interactive confirmation.
7. Define status input as `version: 1`, `requestId`, and `workspaceUri`. Return a narrow versioned result echoing the request ID and containing the resolved logical agent slot/name, `waiting | working | completed`, ready flag, latest update, and—only when completed—the direct-task response body and timestamp. Reject unknown fields, version mismatch, malformed selectors, oversized task data, foreign/non-file workspaces, and unavailable sessions with typed errors. Do not expose internal task IDs, provider session IDs, assignment generations, store paths, companion internals, or provider-native identifiers.
8. Have `submit` notify the existing host queue runner for the addressed workspace after the CLI confirms durability. Generalize agent-card/history projections only enough to represent a direct current item without an annotation link; display its caller-supplied title and retain status/history visibility. No new interactive creation controls are added.
9. Keep `sundialEditor.submitPrompt`, the composer, and all annotation-backed behavior intact. Document the stable generic request/result contract in an integration reference, including a neutral TypeScript `executeCommand` example. The Sundial plugin owns its own command wrapper and workflow-specific tests.
10. Apply the single editor `0.16.0` and CLI `0.9.0` minor increments, including the lockfile. No annotations-package contract change is planned unless implementation requires moving a shared generic type there.

## Rejected Alternatives

- Encode Sundial-plugin operation names or rebase policy in the command schema or managed prompt: the command surface supplies generic agent work; callers compose workflow semantics.
- Drive the composer or Command Palette from a caller: background coordination must not steal focus, depend on visible UI, or wait for manual confirmation.
- Require a synthetic source annotation for every direct task: generic workspace-level work may have no meaningful source anchor, and task availability must not depend on companion state.
- Let the VS Code host create runtime task files directly: task lifecycle and idempotency remain CLI-owned under DR-0012.
- Treat a successful provider process exit as task completion: completion requires the assignment-scoped response handoff.
- Block `submit` until the agent finishes: long-lived command promises are fragile across extension reloads and provide poor recovery. Immediate durable submission plus explicit status polling is restart-tolerant.
- Expose enqueue/ready/claim/complete/requeue as independent VS Code commands: those are internal lifecycle mutations, not safe composition primitives.
- Expose internal IDs in place of caller request IDs: callers need stable idempotency and lookup, not store or provider identities.

## Test Plan

- Unit-test direct-work validation, atomic ready creation, target resolution, explicit session policy, exact idempotent replay, changed-request conflict, per-agent FIFO interaction with annotation work, assignment transitions, response persistence, completion replay, reset/requeue behavior, and malformed-state preservation.
- Snapshot-test generic direct prompt construction for all presets, both scopes, optional source context, delimiter escaping, size bounds, and the absence of workflow-specific instructions.
- Unit-test both VS Code command schemas and result parsers, unknown-field rejection, version mismatch, request and response size limits, safe opaque IDs, file-scheme/open-workspace validation, target errors, missing sessions, CLI typed conflicts, and absence of editor focus or notification calls.
- Unit-test mixed work projection so direct current work and history render with their title and no annotation link while annotation-backed cards, waiting labels, deletion, and official responses remain unchanged.
- Add a staged VS Code scenario that calls `submit` and `status` with a neutral direct task and without resolving the Messages view, confirms durable queue dispatch and restart-safe status lookup, completes the response, and verifies no annotation companion was created or changed.
- Extend manifest/package tests for both non-palette activation commands, documented version-1 integration contracts, editor `0.16.0`, CLI `0.9.0`, and lockfile consistency.
- Run the broad feature regression set required by `AGENTS.md`: `npm run check-types`, `npm run lint`, `npm run test:unit`, and elevated `npm test`.

## Open Questions

- Should optional source context be included in version 1, or should the first direct-task contract be workspace-scoped only? The recommended shape includes optional `{ uri, line }` because it composes with code-focused callers without coupling tasks to annotations.
- Is requiring an exact open workspace folder acceptable for version 1? Supporting unopened paths would need a separate authorization and queue-hosting design rather than a looser string-path check.

## Implementation Log

- 2026-07-23: Marked Active, retrieved accepted decisions for the editor/extension domains, and initially planned the feature against the existing composer and CLI-mediated task transaction.
- 2026-07-23: Reframed the feature as a generic, idempotent submit/status surface with companion-free direct work and stored direct responses. Workflow-specific orchestration remains entirely caller-owned.
- 2026-07-23: Dismissed the over-specific CAND-0001 proposal; the corrected design establishes no new project-wide workflow rule.

## Test Log
