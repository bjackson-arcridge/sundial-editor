---
id: SPEC-0021
title: Annotations can be conversations
status: Done
created: 2026-07-22
updated: 2026-07-23
created_by: bjackson
---
# Annotations can be conversations

The annotations panel will have a respond option.

If the original agent session is active, it will automatically send to that agent (new work item)

If not, then the user must select the agent from a dropdown.

## Discovery

- The existing lower pane in the Messages `WebviewView` is the single annotation surface. It already presents user annotations, official responses, agent-authored annotations, parent/child navigation, line/file scope, pinning, filtering, and an annotation-actions toolbar.
- The webview intentionally receives presentation-safe annotations with `AgentSessionId` removed. The extension host retains the raw annotation and work records needed to resolve continuity:
  - an agent annotation stores its authoring `AgentId` and `AgentSessionId`;
  - a user annotation's latest official response stores its responding agent/session;
  - the matching user work item stores its target `AgentId` and exposes its current or historical assignment session, including completed work;
  - the persisted agent list exposes each stable agent's current session ID and `available`, `uninitialized`, or `missing` state.
- The exact originating session is active only when both the stable `AgentId` and `AgentSessionId` match an agent whose persisted current session is `available`. Matching only the logical agent is insufficient after a reset because that would silently continue in a different provider conversation. Readiness must come from the persisted CLI projection; Respond does not probe the provider.
- SPEC-0022 is assumed complete. Its host-side task-creation controller can build a non-mutating task context, preselect an optional stable target, open the existing Messages composer, and submit through the established reserve-work, append-annotation, mark-ready transaction. Respond should call that controller with a host-trusted annotation source; it should not add another queue or annotation submission path.
- A response is a new user annotation and a new queued work item with a new `UserAnnotationId`. It does not append user prose to the selected annotation, reuse that annotation's identity, or mutate its official responses. Existing same-line selection and previous/next navigation are sufficient to expose the resulting annotations; persisted thread or parent/reply links are outside this slice.
- Response task semantics inherit the originating user annotation's preset and scope. A user annotation supplies them directly. An agent annotation resolves them through its required parent-user link and the CLI-mediated parent read. This keeps a follow-up to a fix, write, question, or other task in the same workflow without introducing a seventh prompt kind.
- A line-scoped response uses the selected annotation's current re-anchored line, independent of the active cursor or pin state, and rebuilds source context from the current saved document through the SPEC-0022 controller. A file-scoped annotation has no line to reuse: Respond requires the same source to be the active editor and uses the user's current cursor line as the new response anchor. The composer identifies that chosen line; no code path invents line zero or changes the existing numeric task-source contract.
- If the exact originating session is available, the composer can be opened with that logical agent preselected, so Send continues the conversation without another target choice. If it is unavailable, replaced, unknown, or cannot be resolved, the composer must start with no target and keep Send disabled until the user explicitly chooses an agent. Selecting an agent without an active session retains the existing fresh-session confirmation.
- `packages/editor/package.json` is committed at `0.15.0`. SPEC-0022 already requires the single uncommitted user-facing minor increment to `0.16.0`; this feature shares that release and must not stack another increment. No CLI or annotations-package public behavior/version change is planned.

## Applicable Decision Records

- DR-0003 through DR-0008 — extend the existing Lit webview, apps/providers split, strict CSP, accessible interaction model, VS Code-token styling, and exact typed message unions.
- DR-0012 — reuse CLI-owned agent/work and annotation workflows; the extension host may resolve presentation behavior but must not reproduce lifecycle mutations.
- DR-0014, DR-0017, and DR-0026 — use staged VS Code scenario workspaces, distinguish harness failures from product behavior, and compile the local CLI before integration coverage.
- DR-0034 — use the persisted current managed-session identities when resolving the conversation target.
- DR-0035 — official responses retain the originating annotation identity; a user's Respond action is instead a new user annotation/work identity.
- DR-0036 — every submitted response remains a queued user annotation targeted to a stable `AgentId`.
- DR-0037 — decide whether the originating session is active from persisted agent/session state rather than a provider capability or availability probe.
- DR-0042 — resolve parent annotations and perform all operational annotation reads/appends through the CLI, not shared-package storage primitives.

## Applicable Research Notes

- None. The checked-in annotation, work, session, SPEC-0022, and webview contracts were sufficient for this plan.

## Planned Approach

1. Add pure host-side response-resolution helpers over the selected raw annotation, current work list, and persisted named agents. Resolve an agent annotation from its authoring pair. Resolve a user annotation from its latest official response, then its matching current/historical work assignment, and finally—as the not-yet-assigned case—its target logical agent's currently available session. Return a preferred stable `AgentId` only when the exact persisted current session is available; otherwise require an explicit target.
2. Resolve the response preset and scope from the selected user annotation or, for an agent annotation, from its linked parent user annotation read through the existing CLI port. Treat a missing/malformed parent, disappeared source, or unavailable task semantics as an actionable failure before opening the composer; do not silently change the response into `%Q` or choose another scope.
3. Reuse SPEC-0022's host-side context builder with a trusted source location rather than exposing source/session overrides on its public VS Code command. For a numeric annotation anchor, read the current saved source and build the bounded context at that exact line even when the annotation is pinned and the cursor is elsewhere. For a file-scoped anchor, require the active editor to show the same workspace source and use its current valid cursor line; otherwise show guidance to open the source and choose a line. Respond and cancellation never edit or save the document.
4. Extend the exact `WebviewToHost` union and guard with a fieldless `respondToAnnotation` action, matching the existing selection-based delete/navigation actions. The host acts on its current raw `viewedAnnotation`; no `AgentSessionId`, provider identity, arbitrary path, work identity, or internal task request crosses into the webview.
5. Add a Respond icon button to the annotation toolbar for both user and agent annotations. Give it a visible tooltip and `aria-label`, include it in the toolbar's arrow-key order, disable it while no annotation is selected or a response is being opened, and preserve focus/selection when validation fails. Follow the existing Lit, CSP, VS Code-token, focus, and high-contrast conventions.
6. Open the shared composer with the inherited preset/scope and an empty editable response draft. When the exact origin is active, preselect its stable logical agent and label the target as a continuation of that session; the existing target control remains the confirmation boundary and may be deliberately changed. When continuity is unavailable, leave the required select on its disabled placeholder, explain that the chosen agent may not have the prior transcript, and do not default to the first agent. The existing fresh-session warning and confirmation still apply after a choice.
7. On Send, reuse SPEC-0022's submission transaction unchanged. Reserve a new `UserAnnotationId`, append a new user annotation at the resolved response source, mark that same work identity ready, and let the selected agent's queue claim it. Queueing behind current work is valid; Respond never interrupts the origin, reopens completed work, reuses the selected annotation ID, or appends a user-authored official response.
8. Preserve the original viewed annotation and navigation state while the composer takeover is open. Cancel returns to the selected source/annotation without durable changes. Successful submission returns to the new response anchor, refreshes agents/work/annotations through existing paths, and selects the newly saved user annotation unless the user had pinned another annotation.
9. Document annotation responses at the established capability level in the editor README. Reconcile the manifest and lockfile with SPEC-0022's one pending editor release at `0.16.0`; do not change the CLI or annotations-package versions and do not add another editor increment.

## Rejected Alternatives

- Append the user's reply to the selected annotation or its `officialResponses`: the requested response is a separately queued work item, while official responses are agent-authored results governed by DR-0035.
- Introduce companion-level conversation IDs, reply trees, nested rendering, or cascading thread deletion: conversational continuity in this slice comes from the managed session and successive user annotations; durable thread grouping is a separate product/schema decision.
- Compare only `AgentId` and automatically target that agent after its session was reset: this could imply continuity while sending to a different provider conversation.
- Probe the provider before rendering or opening Respond: persisted CLI session state is the responsive UI authority under DR-0037; the normal send path owns missing-session confirmation and recovery.
- Default to the first listed agent when the origin session is unavailable: the user explicitly must choose who receives a response when continuity cannot be guaranteed.
- Pass `AgentSessionId`, provider ID, annotation source path, raw `PromptContext`, or queue fields through the webview event or public SPEC-0022 command: the host already owns trusted annotation/session state and source validation.
- Enqueue work or append an annotation directly from the Respond handler: this would fork SPEC-0022's composer transaction and could leave reserved work without its matching annotation.
- Send immediately when Respond is clicked: the user still needs to author/confirm the response and target; opening the composer is not a durable mutation.
- Reuse the stale queued-work line after an annotation has become file-scoped, or silently use line zero: queued work is an immutable request-time snapshot, and a file-scoped response requires a current user-chosen line.
- Add another extension minor increment after SPEC-0022: both user-facing additions belong to the same uncommitted `0.16.0` release.

## Test Plan

- Unit-test originating-session resolution for agent annotations; user annotations with a latest official response; working/completed historical assignments; waiting work before assignment; renamed logical agents; exact active matches; the same agent with a replacement session; missing/uninitialized sessions; missing work; and unknown agents. Assert that no provider probe participates.
- Unit-test response preset/scope inheritance for every preset, user and linked agent annotations, cross-file parent reads, missing parent records, malformed CLI results, and parent deletion races.
- Unit-test trusted response context construction for first/middle/last lines, a pinned annotation with the cursor elsewhere, re-anchored lines, stale/out-of-range source state, empty documents, disappeared or out-of-workspace sources, file-scoped annotations with and without a matching active editor, and file-scoped cursor choice. Verify open/cancel never calls editor edit or save.
- Extend protocol tests for the exact fieldless `respondToAnnotation` event, rejection of extra fields and identity-bearing variants, exhaustive switches, response-composer state with and without a target, and continued absence of agent/session/provider identities from the webview projection.
- Test the Lit toolbar and composer behavior: semantic button, tooltip, `aria-label`, arrow-key position, focus preservation, busy/empty disabled states, exact-origin preselection, unavailable-origin blank required selection, continuity help text, fresh-session warning, Send disabled until message and target are present, Escape cancellation, and Light/Dark/High Contrast/High Contrast Light token styling.
- Unit-test host orchestration so Respond uses SPEC-0022's controller once, never calls enqueue/append itself, leaves the original annotation/work untouched, and passes only inherited preset/scope, trusted source, optional preferred target, and an empty draft. Cover rapid double activation and source/agent state changes while the composer opens.
- Extend submission coverage to prove each response receives a fresh `UserAnnotationId`; the queued work and appended user annotation share it; the selected target is honored; same-session work queues normally behind active work; cancellation creates neither record; retry keeps only the new reservation; and the original user/agent annotation plus official responses remain unchanged.
- Add a staged VS Code scenario using the locally compiled CLI: complete a user task, select one of its agent annotations, Respond with the exact originating session active, submit and verify a new work/annotation identity targeting that session; reset the origin, Respond again, verify no default target, choose another agent and complete the fresh-session confirmation, then verify the second new identity and unchanged originals after reload.
- Run the broad feature regression set required by `AGENTS.md`: `npm run check-types`, `npm run lint`, `npm run test:unit`, and elevated `npm test`.

## Open Questions

- None. This slice deliberately provides session-backed follow-up tasks rather than a new persisted reply/thread schema. File-scoped annotations require an explicit current cursor line, and unavailable origin sessions require an explicit agent choice.

## Implementation Log

- 2026-07-23: Marked Active and planned against the accepted editor/webview decisions and the assumed-complete SPEC-0022 task-creation controller. No Decision Record candidate is proposed because the design applies existing session-readiness, queued-work, annotation-identity, CLI-boundary, and webview rules without establishing a new cross-project convention.
- 2026-07-23: Implemented a host-side response resolver that inherits task semantics, reads agent-annotation parents through the CLI, rebuilds saved-source context at the current annotation anchor, and preselects only an exact available originating session.
- 2026-07-23: Added the fieldless Respond toolbar action, accessible response-composer continuity states, blank target enforcement when continuity is unavailable, and reuse of the existing durable enqueue/append/ready transaction for a fresh annotation identity.
- 2026-07-23: Added unit, protocol, static webview, and staged VS Code coverage plus capability-level README documentation. Kept the existing editor `0.16.0` release and made no CLI or annotation-package contract/version change.
- 2026-07-23: Decision-aware review found no substantive completeness, security/privacy, or accepted-DR issue. No new Decision Record candidate is warranted.

## Test Log

- 2026-07-23: `npm run check-types` passed across annotations, CLI, editor host, and editor webview.
- 2026-07-23: `npm run lint` passed.
- 2026-07-23: `npm run test:unit` passed all 201 tests (12 annotations, 72 CLI, 117 editor).
- 2026-07-23: The staged `prompt-to-messages` scenario passed twice, including response open/cancel, exact-session preselection, fresh response annotation/work identity, completion, and preservation of the original annotation.
- 2026-07-23: Two elevated `npm test` runs passed all 11 CLI integration tests and the delayed-autosave, prompt-to-messages, annotation-retry, and annotation-reanchor VS Code scenarios. The unchanged diff-workflow scenario prevented a fully green command with different focus/state wait timeouts on the two runs. Under DR-0014 no diff product change was made for this harness-only failure.
