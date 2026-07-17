---
id: DR-0014
title: Separate harness failures from product fixes
status: accepted
domain: vscode.extension
created: 2026-05-05
references:
  - packages/editor/.vscode-test.mjs
  - packages/editor/src/test/scenarios.mjs
updated: 2026-07-16
author: bjackson
---
## Decision

When a VS Code integration run conflicts with installed-extension behavior, treat the harness as suspect until extensionDevelopmentPath, workspaceFolder, test file glob, activation timing, and view focus are independently verified; do not change product behavior solely to satisfy the harness.

## Appendix

VS Code integration tests boot a separate Code instance with its own activation timing, workspace, and view state, and a misconfigured harness can fail in ways that look exactly like a product bug. The listed inputs are the ones that have actually misled past debugging sessions; pinning them down before touching product code keeps the harness from driving regressions into shipped behavior.
