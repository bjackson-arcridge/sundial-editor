---
id: DR-0004
title: Webview file layout follows the apps/providers split
status: accepted
domain: vscode.webview
created: 2026-05-04
references:
  - packages/editor/src/webviews/
  - packages/editor/esbuild.js
updated: 2026-07-16
author: bjackson
enabled: true
---
## Decision

Extension-host webview code lives under src/webviews/<view>/; webview client code lives under src/webviews/apps/<view>/; cross-view client code lives under src/webviews/apps/shared/; the two halves communicate only via the typed message protocol (CAND-0014).

## Appendix

The two halves of a webview run in different processes with different capabilities: the host can call VS Code APIs and the client cannot. Putting the boundary in the directory layout (rather than only in the type system) makes it physically obvious which file is allowed to import `vscode`, and it matches the convention used by larger VS Code extensions like GitLens so contributors who have seen that layout do not have to relearn it here.
