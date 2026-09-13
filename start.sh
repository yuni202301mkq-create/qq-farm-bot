#!/usr/bin/env bash

set -Eeuo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
BOT_PORT="${ADMIN_PORT:-3007}"

cd "$ROOT_DIR"

# 中文日志为 UTF-8 输出；部分最小化安装的 Ubuntu/Debian locale 不是 UTF-8，
# 会把日志显示成乱码（如 å®‰æŽ'）。这里强制声明，用户无需手动 export。
export LANG="${LANG:-C.UTF-8}"
export LC_ALL="C.UTF-8"

# 优先使用 Corepack，以遵循 package.json 中锁定的 pnpm 版本。
if command -v corepack >/dev/null 2>&1; then
  PNPM=(corepack pnpm)
elif command -v pnpm >/dev/null 2>&1; then
  PNPM=(pnpm)
else
  echo "[ERROR] 未找到 pnpm 或 corepack，请先安装 Node.js 20+。" >&2
  exit 1
fi

if command -v lsof >/dev/null 2>&1 && lsof -nP -iTCP:"$BOT_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "[INFO] QQ 农场已在运行，端口：$BOT_PORT"
  echo "[INFO] 面板：http://localhost:$BOT_PORT"
  exit 0
fi

if [[ ! -d core/node_modules || ! -d web/node_modules ]]; then
  echo "[INFO] 正在安装项目依赖..."
  "${PNPM[@]}" install -r
fi

if [[ ! -f web/dist/index.html ]]; then
  echo "[INFO] 正在构建前端..."
  "${PNPM[@]}" -C web build
fi

echo "[INFO] 正在启动 QQ 农场..."
echo "[INFO] 面板：http://localhost:$BOT_PORT"
exec env ADMIN_PORT="$BOT_PORT" "${PNPM[@]}" -C core dev
