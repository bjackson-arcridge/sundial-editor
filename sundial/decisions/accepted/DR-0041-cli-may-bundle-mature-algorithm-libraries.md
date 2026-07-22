---
id: DR-0041
title: CLI may bundle mature algorithm libraries
status: accepted
domain: cli
created: 2026-07-21
references:
  - packages/annotations/src/reanchor.ts
updated: 2026-07-22
author: bjackson
---
## Decision

For complex standard algorithms (as an example, diff), CLI store operations may use mature, pinned, in-process libraries when their behavior is contract-tested and their code is bundled into published executables; keep simple parsing and mutation in standard-library or in-repo code.
