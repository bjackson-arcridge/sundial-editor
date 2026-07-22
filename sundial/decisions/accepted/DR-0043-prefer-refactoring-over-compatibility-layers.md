---
id: DR-0043
title: Prefer refactoring over compatibility layers
status: accepted
domain: general
created: 2026-07-22
references:
  - packages/annotations/src/repair.ts
  - packages/cli/src/main.ts
updated: 2026-07-22
author: bjackson
---
## Decision

For internal refactors, migrate callers to the owning API and delete superseded indirection in the same change. Among behaviorally equivalent designs, prefer the coherent design with less code and fewer entrypoints.
