#!/usr/bin/env bash

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
code_bin="${CODE_BIN:-code}"
extension_id="arcridge.sundial-editor"
temp_dir="$(mktemp -d "${TMPDIR:-/tmp}/sundial-editor-install.XXXXXX")"
vsix_path="$temp_dir/sundial-editor-local.vsix"

cleanup() {
	rm -rf "$temp_dir"
}
trap cleanup EXIT

if ! command -v "$code_bin" >/dev/null 2>&1; then
	echo "VS Code CLI '$code_bin' was not found. Add it to PATH or set CODE_BIN." >&2
	exit 1
fi

cd "$repo_root"

echo "Packaging the current Sundial Editor workspace..."
npm run package:editor -- -- --out "$vsix_path"

installed_extensions="$("$code_bin" --list-extensions)"
if grep -Fxiq "$extension_id" <<<"$installed_extensions"; then
	echo "Uninstalling $extension_id..."
	"$code_bin" --uninstall-extension "$extension_id"
else
	echo "$extension_id is not currently installed; continuing."
fi

echo "Installing the newly packaged extension..."
"$code_bin" --install-extension "$vsix_path" --force

echo "Installed $extension_id from the current workspace. Reload VS Code to verify it."
