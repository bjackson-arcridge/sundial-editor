# Sundial Domains

Domains are broad applicability scopes. Use lowercase dot-separated hierarchy paths. A domain query matches ancestors, the exact domain, and descendants, but not sibling branches.

## Domains

### all

Global guidance that applies across the project.

### cli

Sundial command-line behavior and CLI-owned workflows.

### cli.bootstrap

LLM bootstrap execution, subprocess invocation, sandboxing, and related operator feedback.

### governance

Sundial governance lifecycle, store ownership, candidate review, and accepted DR retrieval behavior.

### governance.dr-lifecycle

Candidate DR creation, acceptance, rejection, supersession, and lifecycle metadata.

### governance.dr-retrieval

Accepted DR retrieval, context rendering, vocabulary filtering, and deterministic lookup behavior.

### governance.review

Decision-aware review mechanisms and escalation policy.

### vscode

VS Code extension work across extension host and webview surfaces.

### vscode.extension

VS Code extension-host behavior, commands, sidebar providers, integration harnesses, and extension packaging.

### vscode.webview

VS Code webview host/client boundaries, CSP, message protocols, asset loading, and webview bundling.

### vscode.webview.ui

Webview client UI components, styling, theming, accessibility, and interaction behavior.

### editor

Interactive editor UX, annotations, agent coordination, and iterative Git workflows.
