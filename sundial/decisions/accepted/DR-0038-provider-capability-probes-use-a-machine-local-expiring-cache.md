---
id: DR-0038
title: Provider capability probes use a machine-local expiring cache
status: accepted
domain: cli.bootstrap
created: 2026-07-20
references:
  - packages/cli/src/adapters/codex.ts#createCodexAdapter
updated: 2026-07-20
author: bjackson
---
## Decision

Cache successful provider capability probes in machine-local configuration, keyed by CLI version, provider executable path, and provider version, with bounded expiry and an explicit forced-refresh path.
