---
id: DR-0005
title: Webviews enforce a strict nonce-based CSP
status: accepted
domain: vscode.webview
created: 2026-05-04
references:
  - packages/editor/src/webviews/
updated: 2026-07-16
author: bjackson
enabled: true
---
## Decision

Every Sundial webview ships a CSP with default-src 'none', script-src and style-src restricted to webview.cspSource plus a per-render nonce, no unsafe-eval or unsafe-inline, and all assets loaded via webview.asWebviewUri (no remote origins).

## Appendix

Webviews load arbitrary HTML inside a user's editor with access to a privileged message channel, so a permissive CSP would broaden the attack surface in ways that extension review cannot catch after the fact. The shape chosen here is the VS Code team's documented baseline; any relaxation (e.g. `unsafe-inline`, remote origins) would be a security regression rather than an ergonomic tradeoff.
