---
id: DR-0034
title: Agent runtime state uses per-session update histories
status: accepted
domain: editor
created: 2026-07-20
references:
  - sundial/specs/SPEC-0013-agent-code-annotations.md
updated: 2026-07-20
author: bjackson
---
## Decision

Persist every current Sundial-managed agent in its own CLI-owned gitignored runtime file.
