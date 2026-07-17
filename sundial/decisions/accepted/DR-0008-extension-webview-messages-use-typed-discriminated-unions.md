---
id: DR-0008
title: Extension ↔ webview messages use typed discriminated unions
status: accepted
domain: vscode.webview
created: 2026-05-04
references:
  - packages/editor/src/webviews/
updated: 2026-07-16
author: bjackson
---
## Decision

Each webview defines two TypeScript discriminated unions (HostToWebview and WebviewToHost) keyed on a `kind` field, validated by a runtime guard at the receiver and dispatched via an exhaustive switch; no any at the boundary, no postMessage of arbitrary objects.

## Appendix

The extension host and the webview run in separate processes that share no types at runtime; the type system can only catch mistakes on the sending side. A `kind`-keyed discriminated union pairs cleanly with an exhaustive switch on receive — TypeScript fails the build when a new message variant is added without a handler, which is the kind of drift that an `any`-typed boundary would silently accept until users hit it.
