# Sundial Editor

Sundial Editor is the independent VS Code collaboration surface for Sundial workflows. The workspace contains the Editor extension at `packages/editor` and the local provider bridge at `packages/cli`, published as `@arcridge/sundial-editor-cli`.

The extension supports source-anchored agent collaboration through inline prompts or bindable VS Code task commands, plus a global iterative Git workflow: built-in VS Code diffs with a movable first-parent baseline, local temporary checkpoints, permanent consolidation, diff-scoped annotation filtering, and companion repair for source moves and deletes. See the [extension guide](packages/editor/README.md) for the user-facing commands and safety constraints.

## Development

See [DEVELOPING.md](DEVELOPING.md) for maintainer setup, verification, packaging, and CLI publishing workflows.
