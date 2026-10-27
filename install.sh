#!/usr/bin/env bash
set -euo pipefail

source_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
name="$(basename "$source_dir")"
target_dir="${OPENCODE_PLUGIN_DIR:-$HOME/.config/opencode/plugins}"
target="$target_dir/$name"

mkdir -p "$target_dir"

if [[ -e "$target" && ! -L "$target" ]]; then
  echo "目标已存在且不是软链接：$target" >&2
  echo "请先备份或删除它，再重新运行。" >&2
  exit 1
fi

ln -sfn "$source_dir" "$target"
echo "链接 $name -> $source_dir"
echo "重启 OpenCode TUI 使插件生效。"
