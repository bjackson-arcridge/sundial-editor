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

This is functional slice 9 from SPEC-0008. SPEC-0013 already supplies the UI, per-session persistence, ordered status histories, transcript access, interruption, reset, and companion-backed feedback for multiple independently managed sessions. This slice adds the interactions among those sessions: prompt routing, agent-to-agent coordination, user awareness, shared task summaries, and repair of stale multi-process awareness. It extends rather than replaces SPEC-0013's per-session files and lifecycle semantics.

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
