---
id: SPEC-0014
title: Isolated test recovery worktrees
status: Archive
created: 2026-07-13
updated: 2026-07-21
created_by: bjackson
parent: SPEC-0008
domain: editor
slice: 6
---
# Isolated test recovery worktrees

## Discovery

This was proposed as functional slice 6 from SPEC-0008: when an agent encountered test failures or instability it had to address, Sundial would let the agent create an isolated snapshot under `.worktrees/`, work and test there, reconcile its targeted diff into the current dirty tree, and remove the worktree.

That automatic recovery-worktree workflow is deferred indefinitely. The user decides whether separate worktrees are warranted and is responsible for creating, assigning, and removing them. An agent works only in the workspace it was given; it does not create a recovery worktree, move its task to another checkout, or reconcile changes across worktrees on its own.

Multiple agents may continue to work in one user-selected worktree. SPEC-0017 owns a prompt-level instability response that allows an agent to pause for a randomized period between one and three minutes before checking again. That backoff is coordination behavior, not a substitute for diagnosing deterministic failures, and it does not revive automatic worktree management.

This deferral is independent of SPEC-0015 and SPEC-0016. Companion lifecycle repair and annotation re-anchoring continue to operate within the current worktree and do not need recovery-worktree orchestration. Repository-shared agent state and worktree-origin awareness, if pursued, remain separate follow-up work.

## Applicable Decision Records

- DR-0012 Sundial workflows live in the CLI-backed store. If this feature is revived, worktree lifecycle and reconciliation must be CLI-owned rather than reimplemented in the extension or prompts.
- DR-0016 CLI store operations avoid runtime dependencies and shell pipelines. Any revived implementation may use structured Git subprocesses for Git operations but must keep store logic dependency-free.
- DR-0014 Separate harness failures from product fixes. Test instability must first be classified as harness or product behavior; instability alone does not justify changing product behavior.
- DR-0017 VS Code tests use staged scenario workspaces. Existing integration isolation remains the test harness's responsibility and is not replaced by agent-created worktrees.
- DR-0025 CLI surface changes require version review. A future public worktree command would require CLI package and lockfile review.
- DR-0039 Rapid prototypes keep only current formats. A revived design should update current callers and formats together rather than preserve an unshipped recovery protocol.

## Applicable Research Notes

None. The deferral does not depend on an external API or protocol finding.

## Planned Approach

1. Ship no SPEC-0014 product, CLI, extension, or prompt surface. Keep the spec in Backlog as the record of the deferred idea and its ownership boundaries.
2. Treat the active workspace as the agent's complete mutation boundary. User-created worktrees may be used, but Sundial does not create, select, reconcile, or remove them under this spec.
3. Move instability coordination to SPEC-0017. Its initial contract is prompt guidance allowing a randomized one-to-three-minute pause after observed transient instability, followed by a fresh state/test check. SPEC-0017 must define an interruptible, bounded retry policy before turning that guidance into automated scheduling.
4. Keep SPEC-0015 and SPEC-0016 independent: they read and mutate only the current worktree's source and companion state. Do not add recovery-worktree branches, cross-worktree reconciliation, or shared-state behavior to either implementation.
5. Reconsider this slice only if repeated use shows that user-selected worktrees plus bounded coordination backoff cannot safely recover from material test instability. A revived proposal must start with explicit user control, conflict handling, dirty-tree snapshot semantics, cancellation, cleanup, and recovery from partial reconciliation.

## Rejected Alternatives

- Let an agent create a worktree whenever tests fail: ordinary deterministic failures should be diagnosed in place, and automatic isolation hides ownership and cleanup decisions from the user.
- Implement only worktree creation and defer reconciliation/cleanup: this can strand unpublished changes or leave worktrees the user did not request.
- Fold recovery behavior into SPEC-0015 or SPEC-0016: companion repair and anchor relocation have separate current-worktree responsibilities and are being built concurrently.
- Treat a random pause as proof that a failure is transient: backoff must be followed by a fresh check and must not replace reporting a persistent or deterministic failure.
- Automatically copy or merge dirty changes between worktrees: cross-worktree reconciliation is conflict-prone and remains outside Sundial unless a future user-controlled design specifies it end to end.

## Test Plan

- No product tests are required while SPEC-0014 remains deferred because it introduces no runtime behavior.
- SPEC-0017 should snapshot-test the eventual prompt contract: backoff is limited to observed instability, the delay is randomized from one through three minutes, the agent rechecks afterward, persistent failure is surfaced, and user interrupt/steer remains effective.
- SPEC-0015 and SPEC-0016 tests should use their existing disposable-repository or staged-workspace isolation without asserting automatic recovery-worktree behavior.
- If SPEC-0014 is revived, add disposable-repository tests for dirty snapshot fidelity, linked-worktree path validation, concurrent-user changes, conflict/no-partial-apply behavior, cancellation, cleanup failure, and preservation of unrelated index/worktree state before adding a VS Code acceptance scenario.

## Open Questions

- SPEC-0017 must decide the maximum number of backoff attempts or total wait budget and how an agent distinguishes transient instability from a reproducible failure. Until then, the pause remains advisory prompt guidance rather than automated scheduling.
- SPEC-0008 still describes automatic isolated recovery as Function 6. Its parent narrative should be revised when the functional-slice outline is next consolidated so it does not imply that SPEC-0014 is scheduled implementation work.

## Implementation Log

- 2026-07-21: Deferred automatic recovery-worktree creation, reconciliation, and cleanup. Assigned worktree selection to the user, kept SPEC-0015/0016 independent, and moved bounded transient-instability backoff guidance to SPEC-0017. No product code was planned or changed.

## Test Log

- 2026-07-21: Planning-only update; no runtime tests were required.
