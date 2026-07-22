---
id: DR-0040
title: All companion mutations share one worktree-local lock
status: accepted
domain: editor
created: 2026-07-21
references:
  - sundial/specs/SPEC-0016-resilient-annotation-re-anchoring.md
updated: 2026-07-22
author: bjackson
---
## Decision

Serialize annotation append, delete, response, lifecycle repair, and re-anchoring through one lock rooted in the checkout's .sundial companion store. Validate every affected companion before the first write and make cross-file retries idempotent.
