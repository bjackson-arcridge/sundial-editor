---
id: SPEC-0015
title: Companion lifecycle safety
status: Backlog
created: 2026-07-13
updated: 2026-07-19
created_by: bjackson
parent: SPEC-0008
domain: editor
slice: 7
---

# Companion lifecycle safety

## Discovery

This is functional slice 7 from SPEC-0008 and owns the deterministic companion-repair primitive consumed by SPEC-0012's iterative commit workflow. It adds an agent-facing move command, repair from Git diff status, the manual `%cr` command, and verification before `%cf`, `%ca`, or `%cm`. SPEC-0012's refined `%` controls supersede SPEC-0008's related `:::` notation.

## Applicable Decision Records

- DR-0012 Sundial workflows live in the CLI-backed store.
- DR-0016 CLI store operations avoid runtime dependencies and shell pipelines.
- DR-0025 CLI surface changes require version review.

## Applicable Research Notes

None identified for this initial scaffold.

## Planned Approach

1. Add one CLI-owned repair/verification service and machine command for `%cr`. It reads Git's reported name-status for the requested workspace with structured Git arguments, validates the repository/worktree state, and returns affected source and companion paths with typed diagnostics. The extension invokes this command and never derives or writes companion moves itself.
2. For each Git-reported source rename, move an existing `.sundial/<old-path>.comments` companion to `.sundial/<new-path>.comments`; for each Git-reported source deletion, remove its companion when present. A reported delete/add remains a delete/add: never infer a rename from content similarity. Missing companions and non-source paths are no-ops, and every computed path stays within the workspace companion store.
3. Validate the resulting companion state before returning success. `%cf`, `%ca`, and `%cm` call this same repair-and-verify primitive before they construct commit scope; their scope includes a dirty companion whenever its source is selected. `%ca`/`%cm` include non-ignored untracked files as part of their all-dirty scope, while repair itself remains driven only by Git's reported move/delete classification.
4. Make repair recoverable: validate before mutation where possible, use atomic filesystem operations, retain typed failure context, and never leave an inferred or silently partial companion relocation. Review the public CLI command/help/runtime surface and package metadata under DR-0025.
## Rejected Alternatives

- Reimplement repair in the extension host or webview: companion lifecycle mutation is CLI-owned under DR-0012.
- Guess a rename for a Git-reported delete/add pair: Git's classification is authoritative.
- Make `%cf`, `%ca`, and `%cm` each implement their own repair logic: they must share the `%cr` service so repair and pre-commit verification cannot drift.
- Treat an absent companion as an error: source files without annotations have no companion to repair.
## Test Plan

- Unit-test Git name-status parsing and companion path mapping for reported rename, deletion, delete/add, missing companions, nested paths, and paths with spaces.
- Use disposable repositories for repair/verification integration tests: source rename moves the matching companion, source deletion removes it, untracked/non-ignored files remain in all-dirty commit scope without triggering inferred repair, malformed or out-of-workspace paths fail safely, and a verification failure leaves a recoverable state.
- Unit-test `%cr` command I/O, typed errors, help text, returned affected paths, and its invocation by `%cf`, `%ca`, and `%cm`; assert a selected dirty source includes its dirty companion in the resulting commit scope.
- Cover the command from SPEC-0012's focused host/webview tests; no separate broad VS Code scenario is required beyond its iterative-workflow acceptance scenario.
## Open Questions

None.
## Implementation Log

## Test Log
