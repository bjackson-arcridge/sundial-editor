---
id: DR-0016
title: CLI store operations avoid runtime dependencies and shell pipelines
status: retired
domain: cli
created: 2026-05-05
references:
  - AGENTS.md
  - sundial/specs/SPEC-0010-codex-agent-integration.md
updated: 2026-07-16
author: bjackson
---
## Decision

Implement Sundial CLI store, parsing, retrieval, and lifecycle logic with Node standard-library APIs and in-repo parsers; reserve subprocess spawning for external provider or adapter invocations, not store operations.
