---
id: SPEC-0017
title: Shared awareness and agent coordination
status: Backlog
created: 2026-07-13
updated: 2026-07-21
created_by: bjackson
parent: SPEC-0008
domain: editor
slice: 9
---

# Shared awareness and agent coordination

## Discovery

This is functional slice 9 from SPEC-0008. SPEC-0018 supplies persistent `UserAnnotationId` queues targeted by stable agent slot or name, per-agent FIFO assignment, replaceable provider sessions, ordered work histories, transcript access, interruption, and reset; SPEC-0019 and SPEC-0020 add source feedback. This slice adds reassignment and priorities, agent-to-agent coordination, user awareness, shared task summaries, and stale multi-process repair. It extends rather than replaces SPEC-0018's work/agent/session files, targeted FIFO behavior, and lifecycle semantics.

SPEC-0014 defers automatic recovery-worktree creation and leaves worktree selection to the user. This slice therefore owns the lighter-weight response to transient instability when agents share a user-selected worktree: an agent may decide to pause for a randomly selected period from one through three minutes, then re-read shared state and retry a focused check. The pause begins as managed-agent prompt guidance, not a scheduler or worktree-lifecycle feature.

## Applicable Decision Records

- DR-0006 Webview UI meets baseline accessibility requirements.
- DR-0008 Extension ↔ webview messages use typed discriminated unions.
- DR-0009 Sidebar sections use WebviewView, not TreeView.
- DR-0012 Sundial workflows live in the CLI-backed store.
- DR-0016 CLI store operations avoid runtime dependencies and shell pipelines.
- DR-0025 CLI surface changes require version review.
- DR-0036 User annotations are queued agent work items.
- DR-0037 Queue readiness uses persisted session state.

## Applicable Research Notes

- RES-0006 Provider harness auth and MCP surfaces.
- RES-0007 Provider command surfaces for agent control.

## Planned Approach

1. Amend the managed-agent coordination instructions so an agent that has evidence of plausibly transient, concurrent instability may choose a randomized pause of one through three minutes. Do not require a pause for every failed test or use it for a reproducible product failure.
2. Before pausing, publish a concise status update that identifies the unstable check and intended retry. The pause must remain interruptible by the existing agent controls and must not change the work item's `working` lifecycle state merely because time is passing.
3. After the pause, re-read current shared/workspace state before rerunning the narrowest useful check; do not assume the pre-pause failure or file state is still current. If the problem is deterministic or persists beyond the bounded retry policy, surface it through the normal status/blocking path rather than silently looping.
4. Keep the initial behavior prompt-only. Do not add persisted timers, scheduler state, automatic queue reordering, or a new CLI command until observed use demonstrates that advisory coordination is insufficient.
5. Preserve the user's exclusive control of worktree topology. The backoff contract never authorizes an agent to create, select, reconcile, or remove a worktree.

## Rejected Alternatives

- Pause automatically after every test failure: deterministic failures should be diagnosed immediately and do not benefit from coordination backoff.
- Use a fixed delay: randomization reduces agents resuming simultaneously after colliding on shared state.
- Pause without a visible status update: hidden inactivity undermines the shared-awareness goal of this slice.
- Retry indefinitely: persistent instability must become visible to the user through the normal status/blocking path.
- Escalate from a pause to an agent-created recovery worktree: SPEC-0014 explicitly leaves worktree decisions to the user.

## Test Plan

- Snapshot-test the managed-agent prompt: the pause is discretionary, applies only to plausibly transient instability, chooses an inclusive one-to-three-minute delay, requires a status update, remains user-interruptible, and requires a fresh state/check afterward.
- Assert the prompt distinguishes transient/concurrent instability from deterministic product or harness failures and never grants worktree lifecycle authority.
- Unit-test any delay-selection helper only if implementation introduces one; inject time/randomness so tests do not actually wait and cover both one- and three-minute bounds.
- Verify an advisory pause does not transition the work item out of `working`, reorder its queue, append synthetic completion, or suppress interrupt/reset controls.
- Cover persistent failure behavior once the retry cap is resolved: no unbounded loop, and the existing status/blocking path remains visible.

## Open Questions

- What maximum number of pauses or total wait budget applies to one unchanged instability episode before the agent must surface a persistent failure?
- Is prompt-level provider interruption sufficient during the wait, or does implementation need a host-owned cancellable timer after observed use?

## Implementation Log

- 2026-07-21: Added SPEC-0014's deferred-worktree replacement requirement: visible, discretionary, randomized one-to-three-minute coordination backoff with a fresh post-pause check and no agent worktree authority. Kept initial delivery prompt-only.

## Test Log

- 2026-07-21: Planning-only update; no runtime tests were required.
