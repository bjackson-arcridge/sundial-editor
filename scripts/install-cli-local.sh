#!/usr/bin/env bash

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
temp_dir="$(mktemp -d "${TMPDIR:-/tmp}/sundial-editor-cli-install.XXXXXX")"

cleanup() {
	rm -rf "$temp_dir"
}
trap cleanup EXIT

cd "$repo_root"

echo "Packaging the current Sundial Editor CLI workspace..."
npm pack --workspace packages/cli --pack-destination "$temp_dir"

shopt -s nullglob
tarballs=("$temp_dir"/*.tgz)
if (( ${#tarballs[@]} != 1 )); then
	echo "Expected one CLI tarball, but found ${#tarballs[@]}." >&2
	exit 1
fi

echo "Installing the newly packaged CLI globally..."
npm install --global "${tarballs[0]}"

echo "Installed the current Sundial Editor CLI globally."
