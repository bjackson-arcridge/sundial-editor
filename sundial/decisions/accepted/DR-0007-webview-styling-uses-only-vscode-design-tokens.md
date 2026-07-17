---
id: DR-0007
title: Webview styling uses only --vscode-* design tokens
status: accepted
domain: vscode.webview.ui
created: 2026-05-04
references:
  - packages/editor/src/webviews/apps/
updated: 2026-07-16
author: bjackson
---
## Decision

All color, background, border, and font CSS in Sundial webviews references --vscode-* CSS custom properties (or color-mix() over them); hex, rgb, hsl, and named-color literals are disallowed, and components are visually verified against Default Light, Default Dark, High Contrast, and High Contrast Light themes before merge.

## Appendix

VS Code ships many themes, including high-contrast variants required for accessibility, and the `--vscode-*` custom properties are the only stable surface that participates in theme switching. CSS that hard-codes colors looks correct in whichever theme the author was using and unreadable in the others; verifying against all four bundled themes is what catches that class of regression before users see it.
