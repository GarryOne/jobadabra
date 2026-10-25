#!/usr/bin/env bash
# The download file names of a release: Jobadabra-* are the names, Job-Pilotto-* are copies kept for a few releases (the 0.8.27 app and old links read them).
#   tools/release-file-names.sh make  <mac|windows> <version> <dist folder>   copies the built Jobadabra-<version>-… files to every other name; prints the files to upload
#   tools/release-file-names.sh check <mac|windows> <tag>                     fails when the release lacks one of its names (desktop.yml runs it after the upload)
# Guarded by tests/test_release_file_names.py. Drop the Job-Pilotto-* copies from here, from updater.js and from the site after the old apps are gone (RELEASE.md §1).
set -euo pipefail
mode=${1:?make|check}; platform=${2:?mac|windows}; third=${3:?version or tag}

names() {   # $1 = version: every file name of the platform, new names first
  local v=$1 brand
  for brand in Jobadabra Job-Pilotto; do
    case $platform in
      mac) echo "$brand-$v-arm64.dmg"; echo "$brand-$v-arm64.zip"; echo "$brand-mac-arm64.dmg"; echo "$brand-mac-arm64.zip" ;;
      windows) echo "$brand-$v-x64.exe"; echo "$brand-windows-x64.exe" ;;
      *) echo "unknown platform $platform" >&2; exit 2 ;;
    esac
  done
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
    [ "$missing" = 0 ] && echo "release $third has all its $platform file names (Jobadabra-* and the Job-Pilotto-* copies)" ;;
  *) echo "usage: $0 make|check ..." >&2; exit 2 ;;
esac
