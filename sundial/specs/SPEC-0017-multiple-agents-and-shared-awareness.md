---
id: SPEC-0017
title: Shared awareness and agent coordination
status: Backlog
created: 2026-07-13
updated: 2026-07-20
created_by: bjackson
parent: SPEC-0008
domain: editor
slice: 9
---

# Shared awareness and agent coordination

## Discovery

This is functional slice 9 from SPEC-0008. SPEC-0018 supplies persistent `UserAnnotationId` queues targeted by stable agent slot or name, per-agent FIFO assignment, replaceable provider sessions, ordered work histories, transcript access, interruption, and reset; SPEC-0019 and SPEC-0020 add source feedback. This slice adds reassignment and priorities, agent-to-agent coordination, user awareness, shared task summaries, and stale multi-process repair. It extends rather than replaces SPEC-0018's work/agent/session files, targeted FIFO behavior, and lifecycle semantics.

## Applicable Decision Records

- DR-0006 Webview UI meets baseline accessibility requirements.
- DR-0008 Extension ↔ webview messages use typed discriminated unions.
- DR-0009 Sidebar sections use WebviewView, not TreeView.
- DR-0012 Sundial workflows live in the CLI-backed store.
- DR-0016 CLI store operations avoid runtime dependencies and shell pipelines.
- DR-0025 CLI surface changes require version review.

## Applicable Research Notes

- RES-0006 Provider harness auth and MCP surfaces.
- RES-0007 Provider command surfaces for agent control.

## Planned Approach

## Rejected Alternatives

## Test Plan

## Open Questions

## Implementation Log

## Test Log
