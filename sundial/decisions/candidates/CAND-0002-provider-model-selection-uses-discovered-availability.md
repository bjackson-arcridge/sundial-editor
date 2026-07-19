---
id: CAND-0002
title: Provider model selection uses discovered availability
status: candidate
domain: cli
created: 2026-07-17
created_by: bjackson
references:
  - packages/cli/src/adapters/codex.ts
---

## Decision

Before starting a provider thread or turn, query the provider's current model catalog and resolve defaults and explicit model requests only from models the provider reports available; pass the resolved model explicitly.

## Pitfalls

Do not rely on a null model, a stale local configuration value, or an unvalidated requested model when the provider exposes model discovery.

## Appendix

A Codex 0.131 run inherited configured model gpt-5.6-sol and failed even though model/list advertised gpt-5.5 as the available default. Explicit discovery also supplies the model set needed by future provider/model selection UI.
