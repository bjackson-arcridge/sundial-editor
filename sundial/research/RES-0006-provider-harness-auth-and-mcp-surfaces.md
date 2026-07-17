---
id: RES-0006
title: Provider harness auth and MCP surfaces
domain: vscode.extension
summary: Official OpenAI Codex and Anthropic Claude Code docs confirm that local provider harnesses can use the user's provider authentication and connect to MCP servers. Load this before changing Sundial editor provider-auth or MCP design.
created: 2026-07-13
updated: 2026-07-13
---

## Research

This research was collected on 2026-07-13 while planning `SPEC-0008`.

### Findings

OpenAI Codex:

- Official Codex authentication docs say Codex supports two OpenAI sign-in methods for OpenAI models:
  - Sign in with ChatGPT for subscription access.
  - Sign in with an API key for usage-based access.
- The same docs say the ChatGPT desktop app, Codex CLI, and Codex IDE extension support both sign-in methods for local work, while Codex cloud requires ChatGPT sign-in.
- The same docs say ChatGPT sign-in follows ChatGPT workspace permissions/RBAC/data-handling settings, while API-key sign-in follows the API organization's retention and data-sharing settings.
- API-key authentication supports local Codex workflows, but some ChatGPT workspace or cloud-service-dependent features are limited or unavailable; API-key usage is billed through the OpenAI Platform account at API rates.
- Official Codex MCP docs say local Codex clients can connect directly to MCP servers and share their configuration.
- The ChatGPT desktop app, Codex CLI, and IDE extension support MCP servers and share MCP configuration for the same Codex host.
- Codex MCP server support includes STDIO servers with environment variables and Streamable HTTP servers with bearer-token auth, OAuth auth, and ChatGPT session authentication for trusted first-party servers.
- Codex stores MCP config in `~/.codex/config.toml` by default and can also use project-scoped `.codex/config.toml` in trusted projects.
- Codex CLI MCP commands include `codex mcp add`, `codex mcp list`, `codex mcp --help`, and `codex mcp login <server-name>` for OAuth-capable servers.
- Codex IDE extension configuration path is through the gear menu -> MCP servers -> Add server, then restart extension.
- Official sources:
  - https://learn.chatgpt.com/docs/auth
  - https://learn.chatgpt.com/docs/extend/mcp

Anthropic Claude Code:

- Official Claude Code authentication docs say individual users can log in with a Claude.ai account, while teams can use Claude for Teams or Enterprise, Claude Console, or cloud providers such as Amazon Bedrock, Google Cloud's Agent Platform, or Microsoft Foundry.
- Claude Code first launch opens a browser login flow; supported account types include Claude Pro or Max subscription, Claude for Teams or Enterprise, Claude Console, cloud-provider credentials, and a self-hosted Claude apps gateway.
- Claude Console authentication supports existing Console accounts; Console roles include Claude Code role, which can only create Claude Code API keys, and Developer role, which can create any kind of API key.
- Claude Code credential management supports Claude.ai credentials, Claude API credentials, Azure Auth, Bedrock Auth, Vertex Auth, and Claude apps gateway session tokens.
- `apiKeyHelper`, `ANTHROPIC_API_KEY`, and `ANTHROPIC_AUTH_TOKEN` apply to the CLI and surfaces that wrap it, including the VS Code extension, Agent SDK, and GitHub Actions.
- Claude Code authentication precedence is cloud-provider credentials, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_API_KEY`, `apiKeyHelper`, `CLAUDE_CODE_OAUTH_TOKEN`, then subscription OAuth credentials from `/login`.
- If an active Claude subscription and `ANTHROPIC_API_KEY` are both present, the API key takes precedence once approved; unsetting `ANTHROPIC_API_KEY` falls back to subscription OAuth.
- Official Claude Code MCP docs say Claude Code connects to external tools and data sources through MCP.
- Claude Code MCP transport options include remote HTTP, deprecated remote SSE, local stdio, and remote WebSocket.
- Claude Code supports dynamic MCP `list_changed` notifications, plugin-provided MCP servers, local/project/user installation scopes, environment-variable expansion in MCP config, OAuth 2.0 for remote MCP servers, dynamic headers for non-OAuth auth, MCP resources, tool search, MCP prompts as commands, and managed MCP configuration.
- Plugin-provided MCP servers are defined in `.mcp.json` or inline in `plugin.json`, start automatically when the plugin is enabled, and appear alongside manually configured MCP tools.
- For local stdio MCP servers, Claude Code sets `CLAUDE_PROJECT_DIR` in the spawned server environment to the project root.
- Official sources:
  - https://code.claude.com/docs/en/iam
  - https://code.claude.com/docs/en/mcp

### Unknowns

- Codex docs explicitly mention ChatGPT session authentication for trusted first-party Streamable HTTP MCP servers; they do not establish that arbitrary third-party HTTP MCP servers can use the user's ChatGPT session as their server auth mechanism.
- SPEC-0004 already found no public Codex prompt-prefill contract equivalent to Claude Code's documented prompt URI. This research confirms MCP availability, not a new Codex session launch mechanism.
