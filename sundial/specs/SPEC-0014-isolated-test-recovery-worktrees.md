---
id: SPEC-0014
title: Isolated test recovery worktrees
status: Backlog
created: 2026-07-13
updated: 2026-07-19
created_by: bjackson
parent: SPEC-0008
domain: editor
slice: 6
---

# Isolated test recovery worktrees

## Discovery

This is functional slice 6 from SPEC-0008. Only when an agent encounters test failures or instability it must address, it may create an isolated snapshot under `.worktrees/`, work and test there, reconcile its targeted diff into the current dirty tree, and remove the worktree.

## Applicable Decision Records

- DR-0012 Sundial workflows live in the CLI-backed store.
- DR-0016 CLI store operations avoid runtime dependencies and shell pipelines.
- DR-0025 CLI surface changes require version review.

## Applicable Research Notes

None identified for this initial scaffold.

## Planned Approach

## Rejected Alternatives

## Test Plan

## Open Questions

## Implementation Log

## Test Log
