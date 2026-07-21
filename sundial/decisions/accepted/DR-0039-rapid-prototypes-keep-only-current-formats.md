---
id: DR-0039
title: Rapid prototypes keep only current formats
status: accepted
domain: general
created: 2026-07-21
references:
  - SPEC-0020
updated: 2026-07-21
author: bjackson
---
## Decision

While Sundial is in rapid prototyping, update internal formats, callers, fixtures, and tests together. Keep only the current format unless compatibility is explicitly requested.

## Pitfalls

Do not add migration readers, legacy protocol branches, or tests for obsolete internal formats by default. Current provider capability checks are live integration behavior, not legacy-format support.
