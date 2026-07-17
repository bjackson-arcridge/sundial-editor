---
id: RES-0011
title: VS Code test runtime download cache and signature behavior
domain: vscode.extension
summary: The installed VS Code test libraries checksum and retry runtime downloads but trust a stable cache completion marker; test-cli exposes a documented executable-path field rather than a cache-path field. The desktop runner has no supported macOS headless mode; Microsoft documents Xvfb for headless Linux CI, while browser tests use a separate web-extension host.
created: 2026-07-13
updated: 2026-07-13
---

## Research

Verified on 2026-07-13 against installed `@vscode/test-electron` 2.5.2 and `@vscode/test-cli` 0.0.12.

### Downloader API and validation

- `downloadAndUnzipVSCode(options: Partial<DownloadOptions>): Promise<string>` accepts `version`, `platform`, `cachePath`, `extensionDevelopmentPath`, `reporter`, `extractSync`, and an idle `timeout`. It returns the platform executable path.
- The default platform is `darwin-arm64` or `darwin` on macOS, `win32-arm64-archive` or `win32-x64-archive` on Windows, and one of `linux-arm64`, `linux-armhf`, or `linux-x64` elsewhere.
- An exact stable download is stored at `<cachePath>/vscode-<platform>-<version>`. The platform executable is `Visual Studio Code.app/Contents/MacOS/Electron` on macOS, `Code.exe` on Windows, and `code` on Linux.
- The update-service redirect supplies an `x-sha256` response header. `validateStream` checks both downloaded byte length and that SHA-256 value while the archive is extracted.
- Download/extraction failures enter a three-attempt loop. Each attempt removes the target download directory before fetching again.
- After successful extraction, the downloader creates `is-complete`. For an exact stable version, a later call returns the cached executable whenever that marker exists; it does not revalidate the archive checksum or the macOS application signature.

### test-cli configuration

- `IDesktopTestConfiguration` documents `version`, `desktopPlatform`, `download`, and `useInstallation`, but it does not declare `cachePath`.
- `useInstallation.fromPath` is mapped to `@vscode/test-electron`'s `vscodeExecutablePath`. When that path is present, `runTests` launches it without calling the downloader.
- `useInstallation.fromMachine` is a separate field mapped to `reuseMachineInstall`; it is not required when `fromPath` names a downloaded executable.
- In test-cli 0.0.12, undeclared configuration properties are spread into the test-electron options, so `cachePath` happens to pass through at runtime even though it is absent from the declared test-cli configuration API.

### macOS observation

- For the same prepared app at `.vscode-test/vscode-darwin-arm64-1.118.1/Visual Studio Code.app`, `codesign --verify --deep --strict` returned exit 1 with `invalid signature` inside the managed filesystem sandbox and exit 0 with `valid on disk` and `satisfies its Designated Requirement` outside that sandbox.
- The elevated integration run launched that prepared runtime successfully and completed all governance and editor scenarios. The original corruption popup's precise cause was not independently established, so an upstream transient archive problem remains possible but unconfirmed.

### Desktop launch visibility and web tests

- The installed `@vscode/test-cli` 0.0.12 desktop configuration exposes `launchArgs` and `platform?: 'desktop'`, but no `headless` setting. Its browser configuration is separately typed for Firefox, WebKit, or Chromium and is marked incomplete/nonfunctional in this installed release.
- `@vscode/test-electron` launches the VS Code desktop executable. The official VS Code extension-testing documentation describes these integration tests as running in an Extension Development Host and does not document a desktop headless flag.
- Microsoft's continuous-integration documentation requires `xvfb` for VS Code extension tests on headless Linux machines and shows `xvfb-run -a npm test`. The same example runs ordinary `npm test` on macOS and Windows.
- `@vscode/test-web` is a separate runner for VS Code for the Web. Its test code runs under web-extension-host restrictions: the test bundle supports only `require('vscode')`, and the extension must be compatible with the browser host. This is not an equivalent execution environment for Sundial's current desktop extension, which imports Node APIs including `node:child_process`, `node:fs/promises`, and `node:path`.
- A local macOS probe on 2026-07-13 passed `--headless` through `@vscode/test-cli` to the pinned VS Code 1.118.1 Electron runtime. The runner warned that `headless` is not a known VS Code option but forwarded it; the Electron main, renderer, GPU, and extension-host processes started with the flag. The `init-from-welcome` scenario then failed all three tests because its WebviewView never reported a rendered state, despite the extension host and ordinary extension diagnostics initializing. The run ended with `0 passing`, `3 failing` after 30 seconds. This confirms that Electron headless mode is not behaviorally equivalent for this repository's webview integration suite.

Sources:

- `node_modules/@vscode/test-electron/out/download.d.ts`
- `node_modules/@vscode/test-electron/out/download.js`
- `node_modules/@vscode/test-electron/out/runTest.d.ts`
- `node_modules/@vscode/test-electron/out/runTest.js`
- `node_modules/@vscode/test-electron/out/util.js`
- `node_modules/@vscode/test-cli/out/config.d.cts`
- `node_modules/@vscode/test-cli/out/cli/platform/desktop.mjs`
- https://code.visualstudio.com/api/working-with-extensions/testing-extension
- https://code.visualstudio.com/api/working-with-extensions/continuous-integration
- https://code.visualstudio.com/api/extension-guides/web-extensions
- Local `codesign` and `npm test` command output from 2026-07-13
