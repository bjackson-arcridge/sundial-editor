---
id: DR-0003
title: Webview UI uses Lit and @floating-ui/dom
status: accepted
domain: vscode.webview.ui
created: 2026-05-04
references:
  - packages/editor/package.json
  - packages/editor/src/webviews/apps/
updated: 2026-07-16
author: bjackson
---
## Decision

Sundial webview client bundles use Lit for components and @floating-ui/dom for anchored positioning; no other component or positioning library is allowed in webview bundles.

## Appendix

VS Code webviews ship under a strict CSP and live inside the extension bundle, so the runtime budget is tight and every dependency is shipped to every user. Lit's web-component model maps cleanly onto VS Code's design-token surface without a virtual-DOM framework, and @floating-ui/dom is the smallest credible primitive for anchored popovers — bringing in a second component or positioning library would duplicate that surface area for no gain.
