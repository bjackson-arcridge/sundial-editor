---
id: SPEC-0021
title: Shared agent state across worktrees
status: Backlog
created: 2026-07-20
updated: 2026-07-20
created_by: bjackson
parent: SPEC-0013
domain: editor
---

# Shared agent state across worktrees

## Discovery

This is a follow-up to SPEC-0018. Its logical agents, current provider sessions, work queues, assignments, transcripts, update histories, and synchronization lock are currently rooted under the active checkout's `.sundial/agents/` directory. Git linked worktrees therefore create independent copies of runtime state even though they belong to one repository. A user can see different agent names, queues, session availability, and current work depending on which worktree is open, and separate extension hosts can claim work without coordinating through the same lock.

Agent runtime state must instead be repository-scoped and shared by every linked worktree of that repository. Opening the main worktree or any linked worktree must expose the same stable `AgentId` values and slots, current `AgentSessionId` and provider conversation, queue contents, assignments, histories, and controls. Mutations from one worktree must be immediately authoritative for all others. Source companions remain checked-in, worktree-local files; this spec changes the location and addressing of gitignored coordination state, not the source-feedback schema.

No backward compatibility or migration is required for the existing per-worktree `.sundial/agents/` state. Implementations may initialize the new repository-shared store cleanly and must not attempt to merge divergent local stores.

## Applicable Decision Records

- DR-0012 keeps agent workflow and lifecycle mutations in the CLI-backed store rather than extension or webview code.
- DR-0016 requires dependency-free Node standard-library store operations and rules out invoking Git through a shell pipeline to locate the store.
- DR-0025 requires a CLI package version review because repository resolution changes public command behavior.
- DR-0034 retains one validated runtime file per managed session and its update history.
- DR-0036 retains stable logical agents, independently persisted user work, and replaceable provider sessions.

## Applicable Research Notes

- RES-0007 Provider command surfaces for agent control documents Codex thread resume/read behavior and the current provider protocol fields relevant to resuming one shared session from another worktree.

## Planned Approach

1. Introduce a dependency-free repository-context resolver for every agent-store command. Starting at `workspace.cwd`, walk upward to the enclosing Git administrative entry. Treat a `.git` directory as the main administrative directory; for a linked-worktree `.git` file, resolve its `gitdir` target and the target's `commondir` file. Canonicalize and validate each resolved path before using it. Do not invoke `git` to perform store resolution.
2. Root agent coordination beneath one private directory in the resolved Git common directory, such as `<git-common-dir>/sundial/agents/`. Move agent, session, work, transcript, and lock path derivation behind the repository context so main and linked worktrees resolve byte-for-byte identical store paths. Keep source companions under each checkout's existing checked-in `.sundial/` mirror.
3. Preserve SPEC-0018's per-identity JSON files, validation-before-mutation, exclusive creation, atomic replacement, and single-store lock. Because every worktree shares the same lock, concurrent extension hosts and CLIs must serialize claims, reset, rename, session reconciliation, transcript updates, completion, and requeue against one authoritative state.
4. Extend work source context with enough validated worktree identity to run and reconcile an assignment in the checkout from which it originated. Keep source paths repository-relative for durable identity and UI projection, but do not silently redirect provider file edits into whichever worktree happens to inspect the shared queue. Reject an origin that no longer resolves to the same Git common directory.
5. Keep one current provider conversation per logical agent across the repository. Session ensure, missing-session reconciliation, reset, transcript, and open operations from any worktree act on that same session. Before implementation, verify how the supported Codex protocol applies `cwd` when a stored thread is resumed and a turn starts from another linked worktree; make the assignment's selected execution root explicit rather than relying on thread creation cwd.
6. Make every open Sundial Editor view project the shared store while resolving file navigation against its own checkout. A mutation observed from another worktree must refresh agent cards and queue state without exposing provider-native IDs to the webview. If a work item's origin is another checkout, label that condition and avoid pretending the current editor owns its source document.
7. Treat repositories as isolation boundaries. Two unrelated repositories, including separate clones with the same remote URL, never share agents or sessions. All linked worktrees that resolve to the same Git common directory do share them, regardless of branch name or workspace-folder path.
8. Start the shared store at its current schema version with fresh default agents when absent. Ignore legacy per-worktree `.sundial/agents/` directories; do not copy, merge, select a winner, or maintain dual reads/writes. Remove the legacy runtime ignore rule only if no other local artifacts depend on it.
9. Review CLI and editor package versions, command documentation, recovery messages, and capability metadata. Document that agent state is repository-local, git-private, and shared across linked worktrees while annotation companions remain checkout files.

## Rejected Alternatives

- Continue storing runtime under `<worktree>/.sundial/agents/`: this is the defect; linked worktrees cannot observe or lock the same state.
- Check agent/session/work JSON into the repository: provider identities, local transcripts, locks, and active lifecycle state are private runtime coordination, not source artifacts.
- Copy or merge state when a worktree opens: divergent queues and sessions have no safe automatic winner, and delayed copies would not provide a shared lock.
- Symlink each worktree's local store to the main checkout: worktree creation and relocation would require out-of-band setup and platform-specific symlink behavior.
- Key a user-global store by remote URL or branch: separate clones must remain isolated, remotes can change or be absent, and branches do not identify a repository's shared worktree set.
- Invoke `git rev-parse` for every command: store resolution is a CLI store concern and DR-0016 requires implementing it with in-repo, standard-library logic.
- Keep compatibility reads or dual writes for legacy stores: the requirement explicitly permits a clean break, and compatibility would reintroduce ambiguity about which store is authoritative.

## Test Plan

- Unit-test repository-context resolution for a main `.git` directory, absolute and relative linked-worktree gitfiles, relative `commondir`, nested workspace paths, canonical path normalization, missing/malformed administrative files, traversal attempts, symlinks, and unrelated repositories.
- Create a real temporary repository with at least two linked worktrees. From independent CLI processes, verify identical agent IDs, slots, names, current session identity, transcripts, queues, work histories, and control projections in every worktree.
- Mutate rename, session ensure/missing/reset, enqueue/ready/claim/status/complete/requeue, and transcript state from alternating worktrees. Verify each mutation is immediately visible from the others and that provider-native IDs remain absent from ordinary results.
- Race independent processes in different worktrees through initialization, enqueue, claim, reset, and completion. Assert one default agent set, exclusive `UserAnnotationId` reservation, at most one working item per agent, monotonic assignment generations, and no lost updates or duplicate claims.
- Verify work created in one worktree retains its repository-relative source plus validated origin, provider execution uses the intended checkout, another worktree can inspect it without editing the wrong checkout, and removed or foreign origins fail explicitly.
- Verify two separate clones with the same remote do not share state. Verify legacy `.sundial/agents/` data is ignored and is neither migrated nor changed.
- Add a staged VS Code scenario with two worktree windows or equivalent independently hosted clients. Rename an agent and queue work in one, observe it in the other, perform a control mutation there, and verify both converge while source navigation remains worktree-aware.
- Run `npm run check-types`, `npm run lint`, `npm run test:unit`, and elevated `npm test`.

## Open Questions

- Should non-Git workspaces retain an explicitly workspace-local fallback store, or should managed agents require a resolvable Git repository once this behavior ships?
- Does the supported Codex app-server version safely resume one thread while changing `cwd` per assignment across linked worktrees, or must a logical agent own separate provider sessions per execution root while retaining shared queue identity?
- What user-facing label and controls should appear when work originated in another worktree, particularly after that worktree is moved or removed?
- Should completed work retain its originating absolute worktree root for auditability, or discard the local absolute path after completion and retain only repository-relative source identity?

## Implementation Log

- 2026-07-20: Created as a Backlog follow-up to SPEC-0018 after live CLI testing showed that the current `.sundial/agents/` root is scoped to one checkout. Captured the requirement for one Git-common-dir-backed store across linked worktrees and explicitly excluded legacy-store migration.

## Test Log
