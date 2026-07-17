---
id: SPEC-0010
title: Codex agent integration
status: Active
created: 2026-07-13
updated: 2026-07-17
created_by: bjackson
parent: SPEC-0008
domain: editor
slice: 2
---
# Codex agent integration

## Discovery

This is functional slice 2 from SPEC-0008. It adds a provider-agnostic CLI agent-control surface and the first Codex app-server adapter so one managed agent can receive prompts, report status and output, and make targeted patches in the dirty shared tree.

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
