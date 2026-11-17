#!/usr/bin/env bash
# Chromium on this WSL machine lacks libnspr4/libnss3/libasound2. Fetch them into a folder
# without sudo and print the LD_LIBRARY_PATH to run Playwright with.
# Usage: eval "$(bash chromium-libs.sh <dir>)"   then run node / npx playwright as usual.
set -euo pipefail
dir="${1:?usage: chromium-libs.sh <dir>}"
lib="$dir/libs/usr/lib/x86_64-linux-gnu"
if [ ! -f "$lib/libnss3.so" ]; then
  mkdir -p "$dir/debs" "$dir/libs"
  (cd "$dir/debs" && apt-get download libnspr4 libnss3 libasound2t64 >/dev/null 2>&1)
  for deb in "$dir"/debs/*.deb; do dpkg -x "$deb" "$dir/libs"; done
fi
echo "export LD_LIBRARY_PATH=$lib:$lib/nss"
