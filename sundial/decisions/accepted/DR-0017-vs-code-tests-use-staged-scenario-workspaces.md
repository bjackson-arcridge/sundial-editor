---
id: DR-0017
title: VS Code tests use staged scenario workspaces
status: accepted
domain: vscode.extension
created: 2026-05-05
references:
  - packages/editor/.vscode-test.mjs#userDataRoot
  - packages/editor/src/test/prepare-workspaces.mjs#main
  - packages/editor/.vscode-test.mjs
  - packages/editor/src/test/prepare-workspaces.mjs
  - packages/editor/src/test/fixtures
updated: 2026-07-16
author: bjackson
---
## Decision

Run VS Code integration scenarios against prepared .test-workspaces/<scenario> copies with a short tmp user-data root; do not open shared fixtures directly or place test user data under the package tree.
