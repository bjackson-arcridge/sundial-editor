# Sundial Editor CLI

`@arcridge/sundial-editor-cli` is the local provider bridge used by Sundial Editor. It runs on Node.js 20 or newer and supports a locally authenticated Codex CLI `0.131.0` or newer when that installation passes Sundial's app-server capability probe. Newer Codex versions are not rejected solely because their version differs from the build used to generate earlier protocol schemas.

`sundial-editor-cli health --provider codex` reports the exact Codex executable path and version resolved from the CLI process's `PATH`. It then initializes app-server, validates model discovery and the required thread/history operations, checks turn RPC recognition with invalid parameters, and archives its temporary probe thread. The probe never starts a model turn. A missing or malformed required capability is reported by RPC name with an update/retry diagnostic.

Sundial queries `model/list` before starting a thread or turn. An explicit Sundial model request must match the visible catalog and is passed to Codex. Without an explicit request, Sundial omits the model override—even when one catalog row has `isDefault: true`—so Codex applies its configured model and resumed threads retain their existing model.

The package installs two executables at the same version:

- `sundial-editor-cli` is the editor control surface. It manages source annotations, named agents and their queues, sessions, transcripts, and lifecycle controls. Run `sundial-editor-cli help` for its complete command surface.
- `sundial-annotations-cli` is the intentionally narrow surface described to managed agents. Run `sundial-annotations-cli help` to see the agent-facing surface.

The editor executable accepts structured JSON for its machine commands and exposes health, annotation, agent, work-queue, transcript, open, interrupt, and reset operations. The annotation commands store source-anchored interactions in compact, versioned YAML companions under the workspace's mirrored `.sundial/` tree.

Named agents, queued work, replaceable sessions, and ordered status histories persist separately under `.sundial/agents/`. This runtime directory is CLI-owned and gitignored; it is not part of the checked-in annotation companions.
