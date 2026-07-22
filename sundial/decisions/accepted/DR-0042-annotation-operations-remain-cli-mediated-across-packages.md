---
id: DR-0042
title: Annotation operations remain CLI-mediated across packages
status: accepted
domain: editor
created: 2026-07-22
references:
  - packages/annotations
updated: 2026-07-22
author: bjackson
---
## Decision

Keep annotation contracts, codecs, paths, and storage primitives in the shared TypeScript annotations package, while routing every product annotation read and mutation through the CLI; editor and other adapters consume shared contracts but do not access companion files operationally.

## Pitfalls

Do not bypass the CLI from the editor merely because the shared annotations package exposes reusable Node storage primitives.
