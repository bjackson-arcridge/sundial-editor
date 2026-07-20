---
id: DR-0037
title: Queue readiness uses persisted session state
status: accepted
domain: editor
created: 2026-07-20
references:
  - packages/cli/src/main.ts#agent
updated: 2026-07-20
author: bjackson
---
## Decision

Use CLI-persisted agent and session readiness for any UI behaviors; this cache maintains UI responsiveness. 
