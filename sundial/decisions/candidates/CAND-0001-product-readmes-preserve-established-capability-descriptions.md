---
id: CAND-0001
title: Product READMEs preserve established capability descriptions
status: candidate
domain: editor
created: 2026-07-17
created_by: bjackson
references:
  - packages/editor/README.md
---

## Decision

Keep product-facing package READMEs focused on major capabilities, and preserve established accurate capability and interaction descriptions when revising them.

## Pitfalls

Move newly added provider protocol, failure-mode, installation/configuration mechanics, and maintainer workflow detail to dedicated developer documentation instead of expanding the product README.

## Appendix

Raised from SPEC-0010 review feedback: simplify the new companion-CLI material without removing the README's existing prompt and keyboard-loop explanations.
