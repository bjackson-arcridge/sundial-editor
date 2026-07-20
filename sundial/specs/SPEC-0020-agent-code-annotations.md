---
id: SPEC-0020
title: Agent code annotations
status: Backlog
created: 2026-07-20
updated: 2026-07-20
created_by: bjackson
parent: SPEC-0013
domain: editor
slice: 3
---

# Agent code annotations

## Discovery

This is Function 3 under SPEC-0013 and depends on SPEC-0018 and SPEC-0019. It delivers one complete cross-file feedback workflow: a managed agent annotates a source location while handling a user prompt, the originating user annotation links to that feedback, and the user can discover, navigate, read, and delete the agent annotation immediately and after restart.

The agent-facing **Annotate File** operation accepts only a target workspace file, anchor prefix, Markdown annotation body, and anchor suffix. SPEC-0018's current work assignment supplies the originating `UserAnnotationId`, stable named `AgentId`, and current `AgentSessionId`. The CLI generates the child `AgentAnnotationId`, persists the child in the target file's companion, and links it from the origin. The model does not see or supply annotation identities.

This slice evolves SPEC-0019's version-2 companion into version 3 with discriminated user and agent annotation records plus ordered cross-file links. It preserves official responses and every SPEC-0011 interaction. A unique prefix/suffix match resolves against the latest target source and appears at that location; missing or ambiguous context is presented explicitly at file scope. Version/diff behavior remains deferred to SPEC-0012, and semantic/automatic re-anchoring remains deferred to SPEC-0016.

The workflow is end to end: managed-agent instructions and the narrow agent-facing CLI help expose Annotate File; runtime evidence makes cross-file mutations repairable; versioned companions retain the feedback; extension ports and watchers reload it; the existing Lit annotation pane renders origin/child relationships and file-scope fallback; deletion, documentation, migration, and staged scenarios are included.

## Applicable Decision Records

- DR-0003 through DR-0009 govern the Lit annotation UI, accessibility, styling, typed messages, and `WebviewView`.
- DR-0012 and DR-0016 keep annotation and cross-file lifecycle mutations in the dependency-free CLI store.
- DR-0014, DR-0017, and DR-0026 govern staged VS Code testing and local CLI compilation.
- DR-0025 requires a CLI version review for the annotation command and schema evolution.
- DR-0033 preserves standard delayed autosave while companion watchers reload links and children.
- DR-0034 supplies per-session origin and pending-operation state.
- DR-0035 continues to govern official responses preserved in the version-3 schema.

## Applicable Research Notes

None.

## Planned Approach

1. Define branded `AgentAnnotationId` as the opaque identity of an `AgentFileAnnotation`. Each record contains its own `AgentAnnotationId`, originating `UserAnnotationId`, authoring `AgentId` and `AgentSessionId`, normalized workspace-relative target file, Markdown body, submitted prefix/suffix context, timestamp, and either a resolved latest-source anchor or explicit file scope. Define origin links as `{ agentAnnotationId, file }` and extend CLI, host, and webview contracts with runtime validation.
2. Extend companion parsing/rendering to version 3. Read version-1 user records with empty responses/links and version-2 records with responses plus empty links. Preserve all user fields and official responses. Version-3 companions use discriminated user and agent records, reject duplicate IDs and unsafe paths, validate complete documents before writing, and leave malformed or unsupported files untouched.
3. Add machine-readable `annotate` to SPEC-0018's `sundial-annotations-cli` for a session currently assigned to a `working` `UserAnnotationId`. Agent-authored input contains only target file, prefix, body, and suffix. Verify the work item still names that `AgentSessionId`, normalize and validate the target inside the same workspace, generate the `AgentAnnotationId` in CLI code, and return only the affected workspace-relative files; keep both annotation identities internal to the mutation.
4. Before writing, validate the work assignment, origin companion, target companion, target source, and complete proposed records. For same-file feedback, replace one validated companion atomically. For cross-file feedback, reserve the generated `AgentAnnotationId` and mutation phase in the `UserAnnotationId` work file, then write the child and origin link. A retry after failure between files reuses the ID and repairs the missing half without duplication. A delayed operation is rejected once the work item is waiting, completed, or assigned to another session.
5. Resolve prefix/suffix against the latest target source with deterministic bounded matching. A unique match stores a resolved anchor compatible with SPEC-0011's markers and viewer. Missing or multiple matches retain the supplied context but store explicit file scope; do not guess a nearby location. This slice does not perform TTL write-back or LLM relocation.
6. Add Annotate File to managed-agent instructions and `sundial-annotations-cli` help. Explain that code annotations are emitted while the assigned work is `working`, before Official Response completes it, and distinguish them from Official Response and Provide Status Update. Ordinary model prose and transcript output never create annotations.
7. Extend `annotations read` and extension-host ports to load version-3 user/agent records, origin links, and official responses on activation, active-location changes, and narrowly scoped companion events. Preserve agent cards, response rendering, annotation selection, pinning, navigation, and independent pane sizing.
8. Render agent annotations in the existing lower pane with agent attribution, Markdown, origin navigation, target navigation, metadata disclosure, and resolved/file-scope status. A selected user annotation lists linked agent annotations and can navigate to their files; visiting a resolved target marker selects the child record. File-scoped records remain discoverable from the origin and target-file annotation list without claiming a source line.
9. Extend deletion through CLI-owned idempotent operations. Deleting a child removes its target record and origin link after both companions validate. Deleting a user origin explicitly confirms and cascades to nested responses and every linked child; persist operation evidence so a partial cross-file deletion can be repaired. Never leave a dangling link or silently delete an unrelated record.
10. Document agent code annotations, origin/target relationships, explicit file scope, and version-1/2-to-version-3 compatibility. Apply the editor minor increment relative to the committed release and review/bump the CLI version under DR-0025 without stacking increments within one uncommitted release.

## Rejected Alternatives

- Require the agent to pass origin or child IDs: the work assignment and CLI generation already own those identities.
- Store the child only on the originating annotation: feedback belongs with its target source file and must remain navigable there.
- Store the child only in the target companion without an origin link: the user query must retain its complete agent feedback relationship.
- Write one side of a cross-file relationship without repair evidence: failure would create silent orphans or dangling links.
- Guess a line when prefix/suffix matching is missing or ambiguous: explicit file scope is safer than incorrect anchoring.
- Replace the existing annotation pane with an agent-only surface: user, response, and agent feedback form one navigable source-feedback system.
- Add semantic re-anchoring or diff membership now: SPEC-0016 and SPEC-0012 own those later behaviors respectively.

## Test Plan

- Unit-test version-1 and version-2 reads, version-3 round trips, discriminated user/agent records, official-response preservation, ID uniqueness, origin links, safe normalized paths, malformed preservation, and atomic same-file replacement.
- Unit-test `sundial-annotations-cli annotate` structured I/O, current `UserAnnotationId` assignment resolution, no agent-visible IDs, `AgentAnnotationId` generation, same-file and cross-file writes, validation-before-write, failure between writes, idempotent repair, duplicate prevention, waiting/completed/reassigned rejection, agent-facing help, and the shared package version.
- Unit-test deterministic prefix/suffix resolution for unique, repeated, missing, moved, and deleted context; resolved markers; explicit file fallback; origin/target navigation; retained selection; pinning; metadata; Markdown; keyboard behavior; and all four required themes.
- Unit-test child deletion/unlinking and validated cascading origin deletion across several target companions, including repair after each possible partial failure and preservation of unrelated records.
- Add a staged VS Code scenario that submits a user prompt, records an official response, invokes `sundial-annotations-cli annotate` without IDs for same-file and cross-file targets, observes resolved and file-scoped feedback, navigates both directions, reloads after restart, deletes a child, and finally deletes the origin with its remaining response/children. Verify every mutation passes through the real CLI boundary.
- Run `npm run check-types`, `npm run lint`, `npm run test:unit`, and elevated `npm test`.

## Open Questions

None. SPEC-0012 owns version/diff presentation; SPEC-0016 owns semantic and automatic re-anchoring.

## Implementation Log

## Test Log
