#!/usr/bin/env bash
set -euo pipefail
# Run from a checkout: bash scripts/install.sh
# Remote bootstrap defaults to the public upstream repository.
command -v docker >/dev/null || { echo '请先安装并启动 Docker / Docker Desktop。' >&2; exit 1; }
docker compose version >/dev/null
if [[ -f ./compose.yaml && -f ./pyproject.toml ]] && grep -q 'name = "cinebridge"' ./pyproject.toml; then
  task_install_dir="$PWD"
else
  CINEBRIDGE_REPO="${CINEBRIDGE_REPO:-tainanzhui/cinebridge}"
  [[ "$CINEBRIDGE_REPO" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || { echo '无效仓库名称' >&2; exit 1; }
  task_install_dir="${CINEBRIDGE_INSTALL_DIR:-$HOME/cinebridge}"
  if [[ -e "$task_install_dir" ]]; then
    echo "目标目录已存在，未覆盖：$task_install_dir。更新请在原目录运行 git pull 后重新构建。" >&2
    exit 1
  fi
  command -v git >/dev/null || { echo '请先安装 Git。' >&2; exit 1; }
  git clone --depth 1 --branch "${CINEBRIDGE_REF:-v0.2.1}" "https://github.com/$CINEBRIDGE_REPO.git" "$task_install_dir"
fi
cd "$task_install_dir"
docker compose up -d --build --wait --wait-timeout 180
printf '\n幕间已启动：http://127.0.0.1:%s\n打开即可使用，无需登录。\n' "${CINEBRIDGE_PORT:-8766}"
