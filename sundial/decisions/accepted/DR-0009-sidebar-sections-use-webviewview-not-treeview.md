---
id: DR-0009
title: Sidebar sections use WebviewView, not TreeView
status: accepted
domain: vscode.extension
created: 2026-05-04
references:
  - packages/editor/src/extension.ts
  - packages/editor/src/webviews/
updated: 2026-07-16
author: bjackson
---
## Decision

Sundial sidebar sections are implemented as vscode.WebviewView providers, not vscode.TreeView providers. Supersedes CAND-0007 for any section that has migrated to a webview.

## Appendix

TreeView gave the original sections fewer affordances than candidate review needed — rich previews, anchored popovers, and per-row actions that don't fit `TreeItem`. Standardizing on WebviewView lets every sidebar section share the same Lit components, CSP, and message protocol, so a fix or accessibility improvement made in one section carries across the others.
