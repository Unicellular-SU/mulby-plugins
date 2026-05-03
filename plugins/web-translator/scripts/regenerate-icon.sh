#!/usr/bin/env bash
set -euo pipefail

python3 /Users/su/.agents/skills/generate-electron-icons/scripts/generate_electron_icons.py \
  --app-svg assets/icon.svg \
  --out-dir generated-icons \
  --name web-translator \
  --app-padding 0.08

cp generated-icons/web-translator/build/icon.png icon.png
