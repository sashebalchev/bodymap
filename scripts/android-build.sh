#!/usr/bin/env bash
# Builds the Android app and leaves dist-android/bodymap-<version>.apk and its .sha256.
#   scripts/android-build.sh            signed release APK
#   scripts/android-build.sh debug      debug APK (cleartext allowed to 10.0.2.2 only, for the emulator test)
# Needs nix and network (npm, Maven, the Android SDK from dl.google.com on the first run). Nothing is installed system wide.
# Scratch (Gradle cache, SDK user dir) lives in BODYMAP_ANDROID_SCRATCH, default ~/.cache/bodymap-android; delete it any time.
# The release key is made once in ~/.local/share/bodymap-android/ (mode 600, passwords in keystore.properties beside it).
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
variant="${1:-release}"
case "$variant" in release|debug) ;; *) echo "usage: $0 [release|debug]" >&2; exit 2 ;; esac

# Everything below runs inside the toolchain shell (JDK 21, gradle, Android SDK, node).
if [ -z "${BODYMAP_IN_SHELL:-}" ]; then
  exec nix-shell "$root/app/shell.nix" --max-jobs 1 --cores 2 --run "BODYMAP_IN_SHELL=1 $(printf '%q ' "$0" "$@")"
fi

scratch="${BODYMAP_ANDROID_SCRATCH:-${XDG_CACHE_HOME:-$HOME/.cache}/bodymap-android}"
export GRADLE_USER_HOME="${GRADLE_USER_HOME:-$scratch/gradle}"
export ANDROID_USER_HOME="${ANDROID_USER_HOME:-$scratch/android-user}"
mkdir -p "$GRADLE_USER_HOME" "$ANDROID_USER_HOME"

keydir="${BODYMAP_KEYSTORE_DIR:-$HOME/.local/share/bodymap-android}"
export BODYMAP_KEYSTORE_DIR="$keydir"

# On a laptop other work runs on, a build must not take the machine: memory, CPU and time are capped.
capped() {
  if [ -z "${BODYMAP_NO_LIMITS:-}" ] && command -v systemd-run >/dev/null 2>&1; then
    systemd-run --user --scope --quiet -p MemoryMax=8G -p MemorySwapMax=0 -p CPUQuota=300% timeout -k 5 1800 setsid "$@"
  else
    "$@"
  fi
}

# The release key, once. The passwords never touch argv or the environment: keytool reads them from a file.
if [ "$variant" = release ]; then
  if [ ! -f "$keydir/keystore.jks" ]; then
    echo "making the release key in $keydir (once)"
    (
      umask 077
      mkdir -p "$keydir"
      chmod 700 "$keydir"
      secret="$(head -c 32 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 32)"
      printf 'storePassword=%s\nkeyPassword=%s\nkeyAlias=bodymap\n' "$secret" "$secret" > "$keydir/keystore.properties"
      printf '%s' "$secret" > "$keydir/.secret.tmp"
      unset secret
      keytool -genkeypair -keystore "$keydir/keystore.jks" -storetype PKCS12 -alias bodymap -keyalg RSA -keysize 4096 -validity 36500 \
        -dname "CN=Body map, O=bodymap" -storepass:file "$keydir/.secret.tmp" -keypass:file "$keydir/.secret.tmp" >/dev/null
      rm -f "$keydir/.secret.tmp"
      chmod 600 "$keydir/keystore.jks" "$keydir/keystore.properties"
    )
  elif [ ! -f "$keydir/keystore.properties" ]; then
    echo "$keydir/keystore.jks exists but keystore.properties is missing. Not making a new key: it would not match the installed app." >&2
    exit 1
  fi
fi

cd "$root/app"
[ -d node_modules/@capacitor/android ] || capped npm ci --ignore-scripts --no-audit --no-fund
node build-web.mjs
capped npx cap sync android

task=assemble${variant^}
capped gradle --no-daemon --max-workers=2 --console=plain -p android "$task"
gradle --stop >/dev/null 2>&1 || true

version="$(node -p "require('./package.json').version")"
code="$(node -p "require('./package.json').bodymap.versionCode")"
mkdir -p "$root/dist-android"
if [ "$variant" = release ]; then
  src="android/app/build/outputs/apk/release/app-release.apk"
  out="$root/dist-android/bodymap-$version.apk"
else
  src="android/app/build/outputs/apk/debug/app-debug.apk"
  out="$root/dist-android/bodymap-$version-debug.apk"
fi
cp "$src" "$out"
( cd "$root/dist-android" && sha256sum "$(basename "$out")" > "$(basename "$out").sha256" )
echo "$out (versionName $version, versionCode $code)"
cat "$out.sha256"
if [ "$variant" = release ]; then
  "$ANDROID_HOME"/build-tools/*/apksigner verify --print-certs "$out" | grep -E "^(Verifies|Signer #1 certificate (DN|SHA-256))" || true
fi
