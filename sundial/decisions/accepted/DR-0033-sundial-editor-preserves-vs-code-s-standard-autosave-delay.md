---
id: DR-0033
title: Sundial Editor preserves VS Code's standard autosave delay
status: accepted
domain: editor
created: 2026-07-13
references:
  - packages/editor/package.json#contributes.configurationDefaults
updated: 2026-07-17
author: bjackson
---
## Decision

Sundial Editor contributes delayed autosave with the standard 1000 ms default; user, workspace, folder, and language settings remain able to override it.

## Appendix

SPEC-0009 originally proposed two seconds. The product direction is to retain VS Code's default one-second delay while still explicitly enabling afterDelay as the extension default.
