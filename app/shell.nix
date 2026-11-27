# Build shell for the Android app: JDK 21 (what Capacitor 8 needs), gradle, and an Android SDK from nixpkgs.
#
#   nix-shell app/shell.nix                          # build tools only (platform 36, build-tools 35.0.0, platform-tools)
#   nix-shell app/shell.nix --arg withEmulator true  # also the emulator and an x86_64 system image (about 2 GB more)
#
# The Android SDK licence is accepted here, for this shell only (the licence texts are Google's, see
# https://developer.android.com/studio/terms). Nothing is installed system wide and no config outside this file is touched.
{
  pkgs ? import <nixpkgs> {
    config = {
      allowUnfree = true;
      android_sdk.accept_license = true;
    };
  },
  withEmulator ? false,
}:
let
  sdk = pkgs.androidenv.composeAndroidPackages {
    platformVersions = [ "36" ];
    buildToolsVersions = [ "35.0.0" ]; # what Android Gradle Plugin 8.13 asks for
    includeEmulator = withEmulator;
    includeSystemImages = withEmulator;
    systemImageTypes = [ "google_apis" ];
    abiVersions = [ "x86_64" ];
    includeNDK = false;
    includeCmake = false;
  };
  root = "${sdk.androidsdk}/libexec/android-sdk";
in
pkgs.mkShell {
  packages = [ pkgs.jdk21 pkgs.gradle pkgs.nodejs_24 sdk.androidsdk ] ++ pkgs.lib.optional withEmulator pkgs.qemu_kvm;
  JAVA_HOME = "${pkgs.jdk21}";
  ANDROID_HOME = root;
  ANDROID_SDK_ROOT = root;
  # AGP would download its own aapt2 from Maven, a dynamically linked binary that does not run on NixOS. Use the SDK's.
  GRADLE_OPTS = "-Dorg.gradle.project.android.aapt2FromMavenOverride=${root}/build-tools/35.0.0/aapt2";
  shellHook = ''
    export GRADLE_USER_HOME="''${GRADLE_USER_HOME:-''${BODYMAP_ANDROID_SCRATCH:-$HOME/.cache/bodymap-android}/gradle}"
    mkdir -p "$GRADLE_USER_HOME"
  '';
}
