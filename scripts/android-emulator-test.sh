#!/usr/bin/env bash
# The emulator test, in the toolchain shell and under resource limits. Needs /dev/kvm and about 3 GB of SDK downloads
# on the first run (nix-shell fetches the emulator and one system image).
#   scripts/android-emulator-test.sh [debug apk]     (build one first: scripts/android-build.sh debug)
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
version="$(node -p "require('$root/app/package.json').version")"
apk="${1:-$root/dist-android/bodymap-$version-debug.apk}"
if [ -z "${BODYMAP_IN_SHELL:-}" ]; then
  exec nix-shell "$root/app/shell.nix" --arg withEmulator true --max-jobs 1 --cores 2 --run "BODYMAP_IN_SHELL=1 $(printf '%q ' "$0" "$apk")"
fi
if [ -z "${BODYMAP_NO_LIMITS:-}" ] && command -v systemd-run >/dev/null 2>&1; then
  systemd-run --user --scope --quiet -p MemoryMax=8G -p MemorySwapMax=0 -p CPUQuota=300% timeout -k 10 630 setsid node --disable-warning=ExperimentalWarning "$root/scripts/android-emulator-test.mjs" "$apk"
else
  node --disable-warning=ExperimentalWarning "$root/scripts/android-emulator-test.mjs" "$apk"
fi
