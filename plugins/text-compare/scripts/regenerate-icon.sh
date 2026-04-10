#!/usr/bin/env bash
# 使用 Cursor skill「generate-electron-icons」从 assets/icon.svg 生成根目录 icon.png（512×512）。
# 可通过环境变量覆盖脚本路径：GENERATE_ELECTRON_ICONS_SCRIPT=/path/to/generate_electron_icons.py
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PLUGIN_ROOT"

DEFAULT_SKILL="${HOME}/.cursor/skills/generate-electron-icons/scripts/generate_electron_icons.py"
PY="${GENERATE_ELECTRON_ICONS_SCRIPT:-$DEFAULT_SKILL}"

if [[ ! -f "$PY" ]]; then
  echo "未找到 generate_electron_icons.py: $PY" >&2
  echo "请安装 generate-electron-icons skill，或设置 GENERATE_ELECTRON_ICONS_SCRIPT" >&2
  exit 1
fi

python3 "$PY" \
  --app-svg "$PLUGIN_ROOT/assets/icon.svg" \
  --out-dir "$PLUGIN_ROOT/generated-icons" \
  --name text-compare

cp "$PLUGIN_ROOT/generated-icons/text-compare/build/icon.png" "$PLUGIN_ROOT/icon.png"
echo "已更新: $PLUGIN_ROOT/icon.png"
