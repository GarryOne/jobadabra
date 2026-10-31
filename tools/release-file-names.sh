#!/usr/bin/env bash
# The download file names of a release: Jobadabra-* only.
#   tools/release-file-names.sh make  <mac|windows> <version> <dist folder>   copies the built Jobadabra-<version>-… files to every other name; prints the files to upload
#   tools/release-file-names.sh check <mac|windows> <tag>                     fails when the release lacks one of its names (desktop.yml runs it after the upload)
# Guarded by tests/test_release_file_names.py.
# Why (31 Oct 2026, owner: "We want only Jobadabra"): no Job-Pilotto-* copies any more; an app on 0.8.27 or older (reads only those) must be reinstalled.
set -euo pipefail
mode=${1:?make|check}; platform=${2:?mac|windows}; third=${3:?version or tag}

names() {   # $1 = version: every file name of the platform
  local v=$1
  case $platform in
    mac) echo "Jobadabra-$v-arm64.dmg"; echo "Jobadabra-$v-arm64.zip"; echo "Jobadabra-mac-arm64.dmg"; echo "Jobadabra-mac-arm64.zip" ;;
    windows) echo "Jobadabra-$v-x64.exe"; echo "Jobadabra-windows-x64.exe" ;;
    *) echo "unknown platform $platform" >&2; exit 2 ;;
  esac
}

case $mode in
  make)
    dist=${4:?dist folder}
    for name in $(names "$third"); do
      # the built file is the versioned Jobadabra one; every other name is a copy of it with the same extension and arch
      ext=${name##*.}; arch=$([ "$platform" = mac ] && echo arm64 || echo x64)
      cp "$dist/Jobadabra-$third-$arch.$ext" "$dist/$name" 2>/dev/null || true
      echo "$dist/$name"
    done | sort -u ;;
  check)
    have=$(gh release view "$third" --json assets -q '.assets[].name')
    missing=0
    for name in $(names "${third#desktop-v}"); do
      printf '%s\n' "$have" | grep -qx "$name" || { echo "release $third lacks $name" >&2; missing=1; }
    done
    [ "$missing" = 0 ] && echo "release $third has all its $platform file names" ;;
  *) echo "usage: $0 make|check ..." >&2; exit 2 ;;
esac
