---
id: DR-0036
title: User annotations are queued agent work items
status: accepted
domain: editor
created: 2026-07-20
references:
  - sundial/specs/SPEC-0018-agent-updates-and-persistent-state.md
updated: 2026-07-20
author: bjackson
---
## Decision

Brand each submitted user annotation as UserAnnotationId and persist its waiting, working, or completed workflow independently; target it to a stable named AgentId whose provider AgentSessionId may be replaced.
