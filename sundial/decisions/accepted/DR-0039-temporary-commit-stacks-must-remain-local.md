---
id: DR-0039
title: Temporary commit stacks must remain local
status: accepted
domain: editor
created: 2026-07-21
references:
  - sundial/specs/SPEC-0012-iterative-diff-and-commit-workflow.md
updated: 2026-07-21
author: bjackson
---
## Decision

Before a Sundial temporary-stack mutation or consolidation, verify every contiguous temporary commit is absent from origin; treat any published temporary commit as a dirty workflow error that the user must repair.

## Pitfalls

Do not rewrite or offer to repair a temporary commit once it is reachable from origin.

## Appendix

A temporary commit is a local checkpoint whose exact message is Sundial:temp; it cannot be safely consolidated after publication. It should never be published, but if it is; the user must fix the git history state before we can continue to manage it.
