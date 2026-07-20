---
id: DR-0035
title: Provider model selection uses discovered availability
status: accepted
domain: cli
created: 2026-07-17
references:
  - packages/cli/src/adapters/codex.ts
updated: 2026-07-19
author: bjackson
---
## Decision

Before starting a provider thread or turn, query the provider's current model catalog.
