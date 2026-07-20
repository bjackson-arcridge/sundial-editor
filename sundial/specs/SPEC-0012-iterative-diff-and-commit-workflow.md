---
id: SPEC-0012
title: Iterative diff and commit workflow
status: Backlog
created: 2026-07-13
updated: 2026-07-19
created_by: bjackson
parent: SPEC-0008
domain: editor
slice: 5
---

# Iterative diff and commit workflow

## Discovery

This is the revised functional slice 5 from SPEC-0008 and depends on SPEC-0013's completed agent control, feedback, and companion-backed annotation integration. It extends those contracts with version selection, latest-code and editable diff views, iteration and cumulative baselines, diff-scoped annotation presentation, explicit temporary commits, consolidation into a real commit, stable annotation identities, and companion-file inclusion within commit scope.

All version and diff complexity is owned here. SPEC-0013 supplies persistent agent control, the feedback surface, latest-source annotation presentation, and file-scope fallback without a diff-shaped placeholder. This slice adds the version/diff states and controls rather than building a parallel sidebar model.

## Applicable Decision Records

- DR-0003 through DR-0009 govern extensions to SPEC-0013's Lit control and feedback surface.
- DR-0012 keeps diff, baseline, and commit mutations behind the CLI-backed store.
- DR-0014, DR-0017, and DR-0026 govern staged VS Code integration coverage and local CLI compilation.
- DR-0016 keeps CLI store operations dependency-free and out of shell pipelines.
- DR-0025 requires a CLI version review for new diff and commit commands.

## Applicable Research Notes

None identified for this initial scaffold.

## Planned Approach

1. Begin from SPEC-0013's completed typed control, feedback, and annotation contracts, then extend them with explicit latest, iteration-diff, and cumulative-diff contexts. Do not replace the agent summary, transcript, active-location annotation, or file-scope interaction models.
2. Design the version/diff state, baseline controls, annotation membership rules, editable diff behavior, temporary commits, consolidation, and companion commit scope together in this slice.

## Rejected Alternatives

## Test Plan

## Open Questions

## Implementation Log

## Test Log
