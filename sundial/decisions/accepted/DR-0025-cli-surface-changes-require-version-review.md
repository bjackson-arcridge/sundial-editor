---
id: DR-0025
title: CLI surface changes require version review
status: accepted
domain: cli
created: 2026-06-13
references:
  - package-lock.json
  - sundial/specs/SPEC-0010-codex-agent-integration.md
updated: 2026-07-16
author: bjackson
---
## Decision

When a change alters the published CLI surface, command behavior, help text, or generated runtime assets, review packages/cli/package.json and package-lock.json in the same change and bump the CLI package version unless the commit explicitly records why no release version changes.

## Pitfalls

Do not leave public CLI behavior changes with unchanged package metadata by default; version neutrality must be intentional, not an omitted step.

## Appendix

Created after the multi-domain dr retrieve change shipped without a CLI version bump.
