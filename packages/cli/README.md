# Sundial Editor CLI

`@arcridge/sundial-editor-cli` is the local provider bridge used by Sundial Editor. It runs on Node.js 20 or newer and currently supports a locally authenticated Codex CLI `0.131.x` through its app-server protocol.

```bash
sundial-editor-cli health
sundial-editor-cli prompt < request.json
```

`prompt` accepts structured JSON on stdin (or with `--input <path>`) and emits newline-delimited JSON lifecycle and output events. Run `sundial-editor-cli help` for the complete command contract.
