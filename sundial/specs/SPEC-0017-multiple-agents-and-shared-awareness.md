---
id: SPEC-0017
title: Shared awareness and agent coordination
status: Done
created: 2026-07-13
updated: 2026-07-23
created_by: bjackson
domain: editor
slice: 9
---
# Shared awareness and agent coordination

## Discovery

Currently, agents operate independently;  They might face some churn in changing files or tests.  In this case we will offer a tool for agents to inspect other agent state.

This is a new tool in the sundial-annotations-cli, which we should rename to something more generic like sundial-agent-tools.

The new tool will expose the existing status (working/waiting/blocked) and freeform status update from the agent.

The instructions will let the agent know that if they are working on files that another agent is working on, they get priority if their agent ID is lower, otherwise they wait.

If they are getting churn from user's work, they should watch for active edits against the files and wait until there are no edits in the past 30 seconds before continuing.  Once a file hasn't been touched for 30 seconds, they should look at the diff and determine if the user's work is compatible with their goals, and adapt accordinging or report a blocked status. They are welcome to extrapolate and finish the user's work as well if it is incomplete. 

Pause specifics: pause for 30 seconds at a time.  After 10 minutes; change status to paused and wait. The agent will use their built in wait tooling provided by their harness; we do not provide it.

## Applicable Decision Records

- DR-0012 Sundial workflows live in the CLI-backed store.
- DR-0016 CLI store operations avoid runtime dependencies and shell pipelines.
- DR-0025 CLI surface changes require version review.
- DR-0034 Agent runtime state uses per-session update histories.
- DR-0036 User annotations are queued agent work items.
- DR-0037 Queue readiness uses persisted session state.

## Applicable Research Notes

- None.

## Planned Approach

1. Rename the narrow managed-agent executable from `sundial-annotations-cli` to `sundial-agent-tools`, including its entry point, build output, manifest/bin, help, prompts, README, lockfile, and tests. Remove the old executable name.
2. Add an ordered coordination history to each CLI-owned agent runtime record. Each update contains `working | waiting | blocked | paused`, a concise freeform message, normalized workspace-relative file claims, and a timestamp; agent projections expose the latest update.
3. Add agent-facing commands to inspect every agent's slot/name/current coordination update and to publish the caller's update using only managed invocation context. Keep `annotate` and `record-task-response` on this same narrow surface; do not expose editor lifecycle controls.
4. Update the managed-agent contract: publish intended files before editing, inspect peers, and let the lower numeric agent slot win an overlapping claim. The loser publishes `waiting` and rechecks with its harness wait tool every 30 seconds.
5. For user-edit churn, compare file activity at each interval. After a continuous 30 seconds without edits, re-read the diff and either adapt/finish compatible work or publish `blocked`; after 10 minutes, publish `paused` and remain waiting. Sundial supplies no timer or scheduler.
6. Update CLI/editor protocol projections, documentation, and package metadata. This is minor user-facing functionality for both the CLI and extension; apply one uncommitted minor increment per package during implementation.

## Rejected Alternatives

- Parse freeform messages to discover file overlap: file claims must be structured.
- Use queue `WorkStatus` as coordination state: paused and blocked agents may still own active work.
- Lock files or forcibly interrupt the lower-priority agent: coordination remains advisory and agents re-read shared changes.
- Implement waiting in the CLI: the provider harness already owns interruptible waits.

## Test Plan

- Unit-test coordination validation, ordering, atomic persistence, projections, and automatic `working`/`waiting`/`blocked` transitions.
- Unit-test agent-tool inspection/update authorization, path normalization, all four states, rename/help output, and continued annotation/response commands.
- Snapshot-test the managed prompt for structured claims, lower-slot priority, 30-second polling, diff re-read/adaptation, and the 10-minute `paused` limit without real sleeps.
- Update manifest/build/README tests and run type checks, lint, CLI unit/integration tests, and the broad editor regression suites.

## Open Questions

- None. “Lower agent ID” is implemented as the existing ordered numeric agent slot; opaque `AgentId` remains an identity only.

## Implementation Log

- 2026-07-23: Renamed the managed-agent executable to `sundial-agent-tools` and removed the old bin/build entry point.
- 2026-07-23: Added per-session coordination histories with `working`, `waiting`, `blocked`, and `stopped` states, normalized structured file claims, current-update agent projections, legacy version-1 session adoption, and serialized atomic document replacement.
- 2026-07-23: Added managed-context `coordination list` and `coordination update` commands, automatic claim/prompt coordination transitions, protocol capability projection, and the lower-slot/user-churn prompt contract.
- 2026-07-23: Applied the single minor release increments: CLI `0.9.0` and editor `0.16.0`.
- 2026-07-23: Updated the `diff-workflow` staged companion from obsolete version 4 to the current version-5 schema after the broad harness exposed the stale fixture; no diff product behavior was changed.

## Test Log

- 2026-07-22: Planning-only update; no runtime tests were required.
- 2026-07-23: Passed CLI type checks and 72 CLI unit tests, including authorization, normalization, ordering, concurrent persistence, lifecycle transitions, prompt content, legacy sessions, and rename metadata.
- 2026-07-23: Passed 102 editor unit tests, editor host/webview type checks, workspace lint, CLI build/help smoke checks, and 11 CLI integration tests.
- 2026-07-23: `npm run check-types`, `npm run lint`, and `npm run test:unit` passed (186 unit tests total). CLI packaging dry-run included only `sundial-editor-cli` and the renamed `sundial-agent-tools` entry point.
- 2026-07-23: Root `npm test` passed all 11 CLI integration tests and four of five VS Code scenarios. The unrelated `diff-workflow` scenario remained timing-sensitive under pinned VS Code 1.118.1 across cached retries, failing variably while focusing the original compare side or waiting for an automatically converted fourth diff. DR-0014 was applied: no diff product behavior was changed to satisfy the harness.
