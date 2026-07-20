---
id: SPEC-0013
title: Agent control and feedback coordination
status: Todo
created: 2026-07-13
updated: 2026-07-20
created_by: bjackson
parent: SPEC-0008
domain: editor
slice: 4
---
# Agent control and feedback coordination

## Discovery and Requirements

SPEC-0013 is the coordination spec for the next three functional, end-to-end additions to the Sundial Editor. It owns their shared contracts, order, and scope boundaries but does not contain an implementation slice of its own:

1. **SPEC-0018 — Agent updates and persistent state.** Each submitted user annotation becomes a persistent queued work item with its own `waiting`, `working`, or `completed` workflow; managed sessions claim and update those items while exposing transcripts, provider-native opening, interruption, and reset.
2. **SPEC-0019 — Official response to user query.** A managed agent can append an official response to the active user annotation, and the user can see that response after reload.
3. **SPEC-0020 — Agent code annotations.** A managed agent can attach source feedback to another file or location, and the user can navigate and manage it through the existing annotation surface.

Each child delivers its behavior through the CLI, persistent backing, extension host, typed webview protocol, accessible Lit UI, documentation, and tests. No child is merely a UI prototype, storage layer, schema placeholder, or adapter integration for a later child to finish.

SPEC-0011 is the completed foundation: UUID-backed opaque annotation IDs; strict version-1 YAML companions at `.sundial/<source>.comments`; CLI-owned `annotations append`, `annotations read`, and `annotations delete`; source markers; retained selection, pinning, navigation, and deletion; and independently scrolling agent and annotation sections separated by an accessible resizable split.

### Shared contracts and boundaries

- `AgentId` is the stable named Sundial agent selected by prompt slot or name; `AgentSessionId` is its replaceable provider conversation identity.
- `AnnotationId` is the opaque stable identity established by SPEC-0011. `UserAnnotationId` brands an annotation originating from a submitted user query; `AgentAnnotationId` later brands a code annotation created by an agent. Models do not see, copy, or supply either identity in feedback operations.
- CLI-owned runtime state persists each queued `UserAnnotationId` with its target `AgentId`, independently from provider sessions. Stable agent records map selector slots and names to current optional sessions; provider lifecycle and queue state remain separate from checked-in YAML companions.
- All runtime and companion mutations are CLI-owned. The extension and webview consume typed ports and never edit backing files directly.

## Applicable Decision Records

- DR-0003 through DR-0009 govern the shared Lit webview architecture, accessibility, styling, messages, and `WebviewView` surface.
- DR-0012 and DR-0016 keep runtime and companion workflows in dependency-free CLI-owned stores.
- DR-0014, DR-0017, and DR-0026 govern staged VS Code integration coverage and local CLI compilation.
- DR-0025 requires a CLI package-version review for each child that changes the public command surface.
- DR-0033 preserves VS Code's standard delayed autosave behavior.
- DR-0034 requires one CLI-owned gitignored runtime file per current managed session.
- DR-0035 requires official responses to reuse their originating user annotation's identity.

## Applicable Research Notes

- RES-0007 Provider command surfaces for agent control.
