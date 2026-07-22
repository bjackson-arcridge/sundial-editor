---
id: RES-0014
title: Git Worktree Manager command contracts
domain: vscode.extension
summary: Verified command IDs and argument behavior for Git Worktree Manager 3.25.0, plus the Git worktree discovery format used by Sundial worktree navigation.
created: 2026-07-22
updated: 2026-07-22
---

## Research

Verified against the locally installed `jackiotyu.git-worktree-manager` version `3.25.0` at `/Users/bjackson/.vscode/extensions/jackiotyu.git-worktree-manager-3.25.0` and the extension's upstream source on 2026-07-22.

- The extension manifest contributes `git-worktree-manager.switchToSelectWorkspace`. Its handler accepts an optional internal `WorktreeItem`; with no item it returns immediately. With an item it reads `item.uriPath`, parses it as a `vscode.Uri`, and executes `vscode.openFolder` with `{ forceNewWindow: false, forceReuseWindow: true }`.
- The manifest also contributes `git-worktree-manager.switchWorktree`. That command accepts no target argument, opens a picker populated from the worktree list, and opens the selected worktree in a new window.
- The manifest contributes `git-worktree-manager.addWorktree`. Its handler accepts an optional internal `IWorktreeLess`, reads `item.fsPath` when present, resolves that path to the repository's main worktree, prompts for a branch and destination, and creates the worktree. The command does not return the created worktree path.
- The extension's `activate` entry point does not expose a documented typed API for these operations. The `WorktreeItem` and `IWorktreeLess` argument shapes are implementation types rather than contracts documented in the manifest or README.
- VS Code permits extension-contributed commands to receive arbitrary argument types through `commands.executeCommand`; the command handler receives the supplied arguments. Official command documentation: https://code.visualstudio.com/api/extension-guides/command and https://code.visualstudio.com/api/references/vscode-api#commands
- A functional dependency on another extension is declared with the manifest's `extensionDependencies` array, using the full `publisher.name` identifier. Official manifest documentation: https://code.visualstudio.com/api/references/extension-manifest
- `git worktree list --porcelain -z` is Git's stable script-oriented worktree format. Each record starts with `worktree <path>` and may include `branch refs/heads/<name>`, `detached`, `bare`, `locked`, or `prunable` attributes. The main worktree is listed first, followed by linked worktrees. Official Git documentation: https://git-scm.com/docs/git-worktree

Unknowns:

- Git Worktree Manager does not document compatibility guarantees for the argument shape of `git-worktree-manager.switchToSelectWorkspace` or `git-worktree-manager.addWorktree`.
- No target-specific navigation command taking a documented plain path or `vscode.Uri` was found in version `3.25.0`.
