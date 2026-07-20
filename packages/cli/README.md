# Sundial Editor CLI

`@arcridge/sundial-editor-cli` is the local provider bridge used by Sundial Editor. It runs on Node.js 20 or newer and currently supports a locally authenticated Codex CLI `0.131.x` through its app-server protocol.

```bash
sundial-editor-cli health
sundial-editor-cli prompt < request.json
sundial-editor-cli annotations append < annotation.json
sundial-editor-cli annotations delete < annotation-id.json
sundial-editor-cli annotations read < source.json
```

`prompt` accepts structured JSON on stdin (or with `--input <path>`) and emits newline-delimited JSON lifecycle and output events. Run `sundial-editor-cli help` for the complete command contract.

The annotation commands map a file URI inside `workspace.cwd` to a compact, versioned YAML companion under the workspace's mirrored `.sundial/` tree. A line anchor can retain up to three non-empty source lines before and after its target for later re-anchoring. `append` and `delete` validate an existing companion before replacing it atomically; `read` returns an empty versioned collection when no companion exists.
