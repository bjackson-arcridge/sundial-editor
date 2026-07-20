---
id: SPEC-0012
title: Iterative diff and commit workflow
status: Backlog
created: 2026-07-13
updated: 2026-07-20
created_by: bjackson
parent: SPEC-0008
domain: editor
slice: 5
---

# Iterative diff and commit workflow

## Discovery

This is the revised functional slice 5 from SPEC-0008 and depends on completion of SPEC-0013's three child functions through SPEC-0020. It extends their persistent agent control, official-response, and latest-source code-annotation contracts with version selection, latest-code and editable diff views, iteration and cumulative baselines, diff-scoped annotation presentation, explicit temporary commits, consolidation into a real commit, stable annotation identities, and companion-file inclusion within commit scope.

All version and diff complexity is owned here. SPEC-0018 supplies persistent agent control, SPEC-0019 supplies official responses, and SPEC-0020 supplies latest-source code annotations plus file-scope fallback without a diff-shaped placeholder. This slice adds the version/diff states and controls rather than building a parallel sidebar model.

## Applicable Decision Records

- DR-0003 through DR-0009 govern extensions to the Lit control and feedback surface coordinated by SPEC-0013.
- DR-0012 keeps diff, baseline, and commit mutations behind the CLI-backed store.
- DR-0014, DR-0017, and DR-0026 govern staged VS Code integration coverage and local CLI compilation.
- DR-0016 keeps CLI store operations dependency-free and out of shell pipelines.
- DR-0025 requires a CLI version review for new diff and commit commands.

## Applicable Research Notes

None identified for this initial scaffold.

## Planned Approach

1. Begin from the completed typed contracts delivered by SPEC-0018, SPEC-0019, and SPEC-0020, then extend them with explicit latest, iteration-diff, and cumulative-diff contexts. Do not replace the agent summary, transcript, official-response, active-location annotation, or file-scope interaction models.
2. Design the version/diff state, baseline controls, annotation membership rules, editable diff behavior, temporary commits, consolidation, and companion commit scope together in this slice.

## Rejected Alternatives

## Test Plan

## Open Questions

## Implementation Log

## Test Log
