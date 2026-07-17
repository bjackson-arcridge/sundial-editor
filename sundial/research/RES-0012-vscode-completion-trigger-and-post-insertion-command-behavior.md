---
id: RES-0012
title: VS Code completion trigger and post-insertion command behavior
domain: vscode.extension
summary: VS Code completion trigger characters restrict the trigger request to providers registered for that character, and CompletionItem.command runs after insertion. The public completion API has no per-line switch that disables all other standard or inline completion providers.
created: 2026-07-13
updated: 2026-07-13
---

## Research

Verified on 2026-07-13 against the VS Code API documentation and the repository's `@types/vscode` 1.109-compatible surface.

- `vscode.languages.registerCompletionItemProvider(selector, provider, ...triggerCharacters)` registers trigger characters separately from ordinary invocation. The trigger character is already present in the document when `provideCompletionItems` runs.
- When a registered trigger character is typed, VS Code requests completions only from providers that registered that character. This differs from an ordinary invoke request, where providers are grouped by document-selector score and success from a higher-scoring group stops lower-scoring groups.
- `CompletionItem.command?: Command` is executed after VS Code inserts the selected completion. The API directs document edits that are part of the completion itself to `additionalTextEdits`; a follow-on workflow command may use the post-insertion command.
- A completion replacement `range` must be single-line and contain the requested position. `filterText` is matched against the prefix defined by that range.
- `CompletionList.isIncomplete` means further typing should recompute the list. It is not an exclusivity or suppression flag.
- The public completion-provider API has no per-line option to disable every other standard completion provider or all inline-completion providers. Standard completion and inline completion are separate provider surfaces. Executing `editor.action.inlineSuggest.hide` hides the active inline suggestion but does not persistently disable another extension's provider.

Sources:

- https://code.visualstudio.com/api/references/vscode-api#languages.registerCompletionItemProvider
- https://code.visualstudio.com/api/references/vscode-api#CompletionItem
- https://code.visualstudio.com/api/references/vscode-api#CompletionList
- `node_modules/@types/vscode/index.d.ts`
