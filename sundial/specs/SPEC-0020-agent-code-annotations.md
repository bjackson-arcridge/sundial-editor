---
id: SPEC-0020
title: Agent code annotations
status: Done
created: 2026-07-20
updated: 2026-07-21
created_by: bjackson
parent: SPEC-0013
domain: editor
slice: 3
---
# Agent code annotations

## Discovery and Requirements

This is Function 3 under SPEC-0013 and depends on the completed SPEC-0018 and SPEC-0019 contracts. While handling a managed assignment, the agent may create zero or more Markdown annotations on any workspace code it considers useful. Annotations are optional; the agent chooses whether to create them and where they belong.

Every agent annotation belongs to the user annotation for the current assignment. In the UI, a user annotation links to all of its agent annotations, and each agent annotation links back to that user annotation. Each link identifies the other annotation by annotation ID, workspace-relative file, and line number.

User and agent annotations use the same `AnnotationAnchor`: line, line text, and up to three non-empty context lines before and after it. Anchor creation currently lives in the extension. This work moves that logic into the CLI so both annotation types use one implementation and saved content. For a user annotation, the extension removes the prompt command and immediately saves the document before asking the CLI to create the anchor. Anchors and link line numbers remain fixed after creation in this slice. SPEC-0016 will later re-anchor annotations and update the line number stored in the corresponding link.

The agent-facing **Annotate File** command accepts a target workspace file, a one-based line number, and the assigned Markdown content file. The current work assignment supplies the originating `UserAnnotationId`, `AgentId`, `AgentSessionId`, and assignment sequence. The CLI generates the child `AgentAnnotationId`, creates the shared anchor, writes the child to the target companion, and adds the child link to the origin.

The tool is described in the managed-agent prompt with short guidance about when a code annotation would help. The prompt does not require annotations, set a quota, or restrict targets to the source location where the user started the request. If the agent creates annotations, it does so before `record-task-response`, because the official response completes the assignment.

## Applicable Decision Records

- DR-0003 through DR-0009 and DR-0015 govern the existing Lit annotation UI, file layout, CSP, accessibility, VS Code token styling, typed messages, bundling, and `WebviewView` surface.
- DR-0012 keeps annotation mutations in the CLI while allowing the agent to write the assigned Markdown content file; DR-0016 keeps CLI parsing and storage dependency-free.
- DR-0014, DR-0017, and DR-0026 govern staged VS Code testing and local CLI compilation.
- DR-0025 requires a CLI version review for the new command and companion schema.
- DR-0033 preserves standard delayed autosave behavior.
- DR-0034 governs persistent managed-agent session history.
- DR-0035 preserves official responses when companions move to version 3.
- DR-0036 ties each origin `UserAnnotationId` to its persisted assignment.
- DR-0039 keeps only the current internal formats during rapid prototyping.

## Applicable Research Notes

None.

## Interface Details

### Companion schema and links

The current companion schema is version 3. Its `annotations` collection is a discriminated union:

- A `UserAnnotation` has `kind: "user"`. It preserves its existing ID, message, preset, scope, anchor, and ordered official responses. It adds an ordered `agentAnnotations` list.
- An `AgentFileAnnotation` has `kind: "agent"`. It stores its generated `AgentAnnotationId`, authoring `AgentId` and `AgentSessionId`, Markdown body, creation time, shared anchor, and one `userAnnotation` parent link.
- Both directions use `AnnotationLink`, shaped as `{ annotationId, file, line }`. `file` is normalized and workspace-relative. `line` uses the same zero-based value stored in the target annotation's anchor.

The target companion is determined by the target source file. Every annotation command reads and writes version 3 only. Earlier companion versions are rejected rather than migrated. `record-task-response` writes its response into the version-3 user record. All writes validate the complete companion and leave malformed files untouched.

The line in each link is a navigation hint paired with the annotation ID and file. It is not a second anchor. When SPEC-0016 later changes an annotation's anchor line, it must update the link that points to that annotation; that cross-file re-anchoring work is not part of SPEC-0020.

### Agent-facing Annotate File command

`sundial-annotations-cli` adds one operational command alongside `provide-status-update` and `record-task-response`:

```text
sundial-annotations-cli annotate \
  --file "src/example.ts" \
  --line 42 \
  --content ".sundial/<UserAnnotationId>newAnnotation.md"
```

The agent chooses `--file` and `--line`. The line is one-based in the command and must exist in the selected file. The assignment announces the exact workspace-relative `--content` path. The agent writes the complete Markdown annotation there; the file contains no envelope or frontmatter.

The command requires each named option exactly once and accepts no annotation ID, inline body, stdin body, alternate content path, or extra argument. It rejects unsafe paths, paths outside the workspace, `.sundial` as a target, directories, invalid line numbers, an unsafe or non-regular content file, invalid UTF-8, NUL bytes, and empty Markdown. It reads one stable source snapshot and one stable content snapshot before mutation.

After success, the CLI removes the content file. The agent may create another annotation by writing new Markdown to the same assigned path and invoking the command with another chosen file and line. Repeating the same file, line, and content during the same assignment is an idempotent retry, not a duplicate annotation.

Success returns only the affected workspace-relative files, with duplicates removed in origin-then-target order:

```json
{"files":["src/origin.ts","src/example.ts"]}
```

The result does not expose annotation, agent, session, provider, companion, or operation IDs.

### Shared anchor creation

Move anchor creation into a CLI-owned helper used by both user and agent annotation paths. Given a source snapshot and zero-based target line, it returns the existing anchor shape: the target line, its exact text (including an empty string), and up to three non-empty lines before and after it.

The anchor is always created from saved content. For a user annotation, the extension removes the prompt command and saves the document before calling the CLI. Both user and agent paths then use the current file on disk.

This slice does not match prefixes and suffixes, relocate anchors, or create file-scoped annotations. Those behaviors belong to SPEC-0016.

### Creation

Annotate File trusts the assignment context supplied to the provider turn. It does not query or validate the current work status, active session, assignment sequence, reset history, or reassignment state. Those lifecycle checks are intentionally omitted during rapid prototyping. If the originating user annotation still exists, the command may add the annotation. An assignment with no annotations can proceed directly to its official response.

Before companion mutation, the CLI validates only the origin annotation, target source, source line, content file, and affected companions. It does not create an annotation-operation receipt in runtime work state.

For a same-file annotation, one atomic companion replacement adds the child and origin link. For a cross-file annotation, the CLI writes the target child first, then writes the origin link. The child ID is derived from the invocation context, target, and content so repeating the same request does not add a duplicate. The content file is removed after both writes complete.

All annotation append, response, annotate, and delete operations use one CLI-owned workspace annotation lock so concurrent CLI processes do not overwrite companion changes. Annotate File does not acquire or modify the agent-store lock, and `record-task-response` does not wait for or inspect annotation operations.

### Deletion and repair

`annotations delete` accepts either annotation kind. Deleting an agent annotation removes its target record first and then its matching link from the user annotation. Deleting a user annotation explicitly confirms that its official responses, work record, and all linked agent annotations will also be removed. The CLI validates every referenced companion before the first change, then removes children first and the origin last. Same-file changes use one replacement.

Deletion repair relies on the links stored in checked-in companions rather than only on local `.sundial/agents` state. If one side is already absent, a retry removes the remaining exactly matching side. A mismatched annotation ID, file, or parent/child relationship fails without deleting unrelated content. Runtime work cleanup happens last and is idempotent.

### Extension and webview behavior

`annotations read` and the extension protocol return the user/agent union. The extension maps an agent annotation's `AgentId` to the current display name, with an explicit unknown-agent fallback. `AgentSessionId` stays in host-side data when locally available transcript or provider actions need it; it is not sent to the webview.

The lower pane remains the single annotation surface. A selected user annotation shows its query, official responses, and linked agent annotations. A selected agent annotation shows the agent name, time, Markdown body, and link back to its user annotation. Each link shows the file and one-based display line. Typed `openAnnotation` messages let the host open the linked file, reveal the stored line, load its companion, and select the exact annotation ID.

Agent annotations use the same line markers, same-line selection, previous/next navigation, pinning, retained selection, metadata disclosure, maximize/restore behavior, splitter, keyboard behavior, and focus handling as user annotations. Companion watcher events refresh the active affected source through `sundial-editor-cli`. Markdown uses the sanitized renderer delivered by SPEC-0019.

## Prompt Details

The managed-agent prompt announces the content path and documents the exact command. Its guidance says:

1. Code annotations are optional.
2. Use one when source-specific context, risk, rationale, or a follow-up would help the user at a particular code location.
3. Choose any relevant workspace file and line; the original user location is not a restriction.
4. Write only the Markdown body to the announced content file, then run Annotate File.
5. Repeat for any other useful locations.
6. Create annotations before Record Task Response, which completes the assignment.

The guidance distinguishes Annotate File from Provide Status Update and Record Task Response. Ordinary provider prose does not create an annotation, and the prompt does not require a minimum number of annotations.

## Planned Approach

1. Integrate the completed SPEC-0019 baseline and add `AgentAnnotationId`, version-3 user/agent records, and `AnnotationLink` validation across CLI, host, and webview boundaries.
2. Replace the existing companion parser and renderer with the single version-3 schema. Update append, response, read, annotate, and delete together; do not retain readers, writers, migrations, or tests for earlier companion versions.
3. Move anchor creation into the CLI. Save the user document after removing the prompt command, then let the CLI read that saved file and build the anchor. Use the same helper for the file and line selected by Annotate File.
4. Implement `annotate --file --line --content`, including strict option parsing, assigned content-path validation, source/content snapshot reads, optional repeated use, prompt/help text, concise diagnostics, handoff cleanup, and ignore/package rules.
5. Add same-file atomic creation, target-first cross-file creation, deterministic duplicate prevention, and shared annotation locking. Do not add assignment-state checks, operation receipts, or an unfinished-annotation completion guard.
6. Generalize extension annotation state, markers, selection, ordering, and navigation from user-only records to the user/agent union. Add exact parent/child open-and-select behavior.
7. Extend the existing Lit pane with linked child/parent views, Markdown, attribution, file/line navigation, metadata, accessible controls, and VS Code token styling.
8. Make agent deletion and cascading user deletion safe and retryable from the paired links, including repositories with no local work state.
9. Update package READMEs at the established capability level. After integrating current `main`, expect the editor feature release to move from `0.11.0` to `0.12.0` and the CLI command release from `0.4.1` to `0.5.0`; update the lockfile and shared CLI version source without stacking increments if the baseline changes.
10. Add unit and staged integration coverage, then run `npm run check-types`, `npm run lint`, `npm run test:unit`, and elevated `npm test`.

## Rejected Alternatives

- Require an annotation or preselect its target: annotations are optional and the agent may choose any relevant workspace code.
- Preserve earlier companion schemas or prompt protocols: this project is still prototyping, so callers, fixtures, and tests move to the current format together.
- Validate work status, session activity, resets, reassignment, or assignment freshness in Annotate File: the provider turn supplies the context, the user remains the final authority, and the unlikely defensive cases do not justify runtime receipts and lifecycle coupling during rapid prototyping.
- Give agent annotations a separate anchor format: user and agent annotations should share one CLI-owned anchor builder and stored shape.
- Use prefix/suffix matching or file-scope fallback during creation: this slice creates the same fixed line anchors as user annotations; SPEC-0016 owns re-anchoring and file scope.
- Accept the Markdown body through stdin or an inline shell argument: the assigned Markdown file is the single multiline content path established by SPEC-0019.
- Let the agent choose the content path or supply origin/child IDs: assignment context owns the origin and handoff path, while the CLI owns child identity.
- Store only one side of the relationship: both annotations need direct navigation, validation, and deletion repair without a workspace-wide scan.
- Depend only on work-file deletion journals: annotations travel with checked-in companions while `.sundial/agents` does not.
- Write the origin link before the cross-file child: target-first creation avoids a visible link to a child that was never written.
- Allow Annotate File after Record Task Response: response recording completes and clears the assignment that authorizes the annotation.
- Replace the existing annotation pane or add another sidebar view: user queries, official responses, and agent annotations belong in the existing source-feedback surface.
- Add re-anchoring, companion move repair, or diff membership now: SPEC-0016, SPEC-0015, and SPEC-0012 own those behaviors.

## Test Plan

- Companion schema: version-3 user/agent round trips; rejection of any other version; official-response preservation; paired parent/child links; safe paths and line numbers; duplicate rejection; malformed-file preservation; and `record-task-response` updates within version 3.
- Shared anchors: unit-test the CLI anchor builder for empty target lines, skipped blank context, three-line bounds, first and last lines, invalid lines, and LF/CRLF input. Test document saving and CLI invocation separately; no dedicated integration test is needed for their simple composition.
- Agent command: optional use; exact `--file`, `--line`, and `--content` parsing; one-based lines; agent-chosen targets independent of the origin; exact assigned content path; multiline Markdown; stable source/content snapshots; path and UTF-8 validation; no returned identities; no assignment-lifecycle validation; multiple sequential annotations; identical-request duplicate prevention; cleanup; diagnostics; ignore rules; help text; and version metadata.
- Creation and locking: same-file replacement; target-first cross-file creation; deterministic child identity; concurrent append/respond/annotate/delete serialization; stale-lock recovery; and preservation of unrelated records. Do not add tests for waiting, completed, reset, reassigned, stale, or unfinished-operation states.
- Deletion: child unlinking; same-file deletion; multi-target user cascade; missing runtime state; either link side already absent; mismatch refusal; retry after each phase; runtime cleanup last; and preservation of unrelated responses, annotations, and work.
- Host and webview: exhaustive typed messages; agent attribution and fallback; user-to-child and child-to-user navigation; exact selection after file load; displayed one-based lines; line markers; multiple annotations on one line; retained and pinned selection; previous/next ordering; metadata; sanitized Markdown; keyboard/focus behavior; maximize/restore; splitter behavior; watcher reloads; and all four required themes.
- Staged VS Code: complete one assignment with no agent annotations. For another assignment, create same-file and cross-file annotations at agent-chosen lines through the real CLI, verify links and navigation in both directions, reload after restart, record the official response, delete one child, then cascade-delete the user annotation and remaining child. Verify all reads and mutations use the locally compiled CLI.
- Run `npm run check-types`, `npm run lint`, `npm run test:unit`, and elevated `npm test`.

## Open Questions

None. Annotation use and targets are agent-chosen. Annotate File intentionally trusts provider-turn context and performs no assignment-lifecycle validation; the user is the final authority during rapid prototyping. Version 3 is the only supported companion schema; backward-compatible readers and migration tests are intentionally out of scope. SPEC-0020 creates the same fixed line anchors as user annotations and stores line hints in both links. SPEC-0016 owns later re-anchoring and link-line updates; SPEC-0015 owns companion lifecycle repair; SPEC-0012 owns version and diff presentation.

## Implementation Log

- 2026-07-21: Integrated the completed SPEC-0019 baseline from `main` while preserving the revised optional, agent-selected annotation design.
- 2026-07-21: Replaced the annotation companion implementation with version 3 only. User and agent records share one saved-file anchor builder and use paired `{ annotationId, file, line }` links.
- 2026-07-21: Added the agent-facing `annotate --file --line --content` command, exact assigned handoff paths, deterministic duplicate prevention, same-file and target-first cross-file writes, handoff cleanup, shared annotation locking, and the new handoff ignore rule.
- 2026-07-21: Kept Annotate File independent of agent lifecycle validation as directed: it trusts provider-turn context and does not query work status, active sessions, resets, reassignment, or assignment freshness. No annotation-operation receipts or response guards were added.
- 2026-07-21: Moved user work and annotation anchors to CLI reads of the saved source. The extension now saves immediately after removing the prompt command.
- 2026-07-21: Added optional annotation guidance to managed prompts, linked user/agent rendering and navigation in the Lit pane, agent-name fallback, host-only session identity, paired deletion, and version-3 watcher refreshes.
- 2026-07-21: Removed v1/v2 companion readers, writers, fixtures, and tests, plus the legacy unmanaged prompt request and provider adapter path. Bumped the CLI to `0.5.0` and the editor to `0.12.0` under DR-0025 and the repository version policy.
- 2026-07-21: Updated the CLI/editor READMEs at capability level. DR-0039 now governs the current-format-only prototype policy.

## Test Log

- 2026-07-21: `npm run check-types` passed for CLI, extension host, and Lit webview.
- 2026-07-21: `npm run lint` passed.
- 2026-07-21: `npm run test:unit` passed: 41 CLI tests and 84 editor tests.
- 2026-07-21: CLI app-server integration passed: 11 tests.
- 2026-07-21: Elevated `npm test` passed with the pinned VS Code 1.118.1 runtime: delayed autosave, prompt-to-messages, and annotation-retry scenarios all passed. The first two runs exposed obsolete v1/v2 fake-CLI assumptions; those fixtures and assertions were moved to the single version-3 saved-anchor protocol before the green rerun.
