---
id: DR-0006
title: Webview UI meets baseline accessibility requirements
status: accepted
domain: vscode.webview.ui
created: 2026-05-04
references:
  - packages/editor/src/webviews/apps/
updated: 2026-07-16
author: bjackson
---
## Decision

Every Sundial webview component uses semantic ARIA roles, supports Tab in visual order plus Escape and arrow-key navigation, traps focus inside open popovers and restores it on close, and provides aria-label for every icon-only control.

## Appendix

Sidebar webviews replace native VS Code chrome (TreeView, QuickPick) that already provides keyboard and screen-reader behavior out of the box. Without an explicit baseline, the migration to webviews silently regresses accessibility relative to the native UI it replaced — the goal of this DR is to keep the parity, not to set an aspirational target.
