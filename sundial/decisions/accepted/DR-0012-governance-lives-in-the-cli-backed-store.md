---
id: DR-0012
title: Sundial workflows live in the CLI-backed store
status: accepted
domain: all
created: 2026-05-04
references:
  - AGENTS.md
  - sundial/config.json
  - sundial/specs/SPEC-0010-codex-agent-integration.md
updated: 2026-07-16
author: bjackson
---
## Decision

Keep Sundial workflow and lifecycle mutations in the sundial CLI over the hand-editable `sundial/` store; editor, MCP, CI, VS Code, and agent adapters delegate logical state-changing operations to the CLI. Direct markdown edits remain appropriate for human or LLM-authored document bodies where the model is intentionally filling in the artifact from its template.

## Pitfalls

Do not reimplement workflow mutations in the VS Code extension host or webviews when a CLI command owns the operation, including candidate lifecycle, decision lifecycle, spec creation, spec status changes, generated workflow state, and future Sundial store transitions.

## Appendix

The `sundial/` store is intentionally hand-editable so that humans and LLMs can review and version DRs, research notes, specs, and implementation logs as plain markdown. Workflow operations such as accepting a candidate, retiring a DR, creating a spec, or moving a spec between lanes encode product behavior and may touch multiple files or derived views. Centralizing those mutations in the CLI is what keeps editor, MCP, CI, and agent adapters in agreement; if the same logic were re-implemented in each adapter, the store would drift quickly.
