#!/usr/bin/env bash
# Development launcher: migrations, then API, worker and frontend in one terminal.
# Ctrl+C stops everything. See docs/dev.md for what each part does.
#
#   ./dev.sh               API + worker + frontend
#   ./dev.sh --no-worker   without the worker (no supplier syncs, no photo processing)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND="$ROOT/backend"
FRONTEND="$ROOT/frontend"
PY="$BACKEND/.venv/bin/python"

WORKER=1
for arg in "$@"; do
  case "$arg" in
    --no-worker) WORKER=0 ;;
    -h|--help) sed -n '2,6p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Неизвестный аргумент: $arg" >&2; exit 1 ;;
  esac
done

say() { printf '\033[1m==> %s\033[0m\n' "$*"; }

# --- first-time setup -------------------------------------------------------

if [[ ! -x "$PY" ]]; then
  say "Создаю backend/.venv и ставлю зависимости"
  python3 -m venv "$BACKEND/.venv"
  (cd "$BACKEND" && "$PY" -m pip install -e . --group dev)
fi

if [[ ! -f "$BACKEND/.env" ]]; then
  cp "$BACKEND/.env.example" "$BACKEND/.env"
  say "Создан backend/.env из примера: задайте ADMIN_PASSWORD и SUPPLIER_LOGIN/PASSWORD и запустите снова"
  exit 1
fi

if [[ ! -d "$FRONTEND/node_modules" ]]; then
  say "Ставлю зависимости фронтенда"
  (cd "$FRONTEND" && npm install)
fi

if [[ ! -f "$FRONTEND/.env.local" ]]; then
  cp "$FRONTEND/.env.example" "$FRONTEND/.env.local"
fi

for port in 8000 3000; do
  if ss -ltn "sport = :$port" 2>/dev/null | grep -q LISTEN; then
    echo "Порт $port уже занят — похоже, dev уже запущен в другом терминале." >&2
    exit 1
  fi
done

say "Применяю миграции"
(cd "$BACKEND" && "$PY" -m alembic upgrade head)

# --- run --------------------------------------------------------------------

# Stop every child (uvicorn reloader, next dev workers...) on Ctrl+C or when one part exits.
stop() {
  trap - INT EXIT
  trap "" TERM # kill 0 below signals this script too
  echo; say "Останавливаю"
  kill 0 2>/dev/null
  wait
}
trap stop INT TERM EXIT

# run <name> <color> <dir> <command...>: output prefixed with a colored name
run() {
  local name=$1 color=$2 dir=$3; shift 3
  (
    cd "$dir"
    "$@" 2>&1 | while IFS= read -r line; do
      printf '\033[%sm%-8s\033[0m %s\n' "$color" "$name" "$line"
    done
  ) &
}

export FORCE_COLOR=1 PYTHONUNBUFFERED=1

run api 34 "$BACKEND" "$PY" -m uvicorn app.main:app --reload --port 8000
[[ $WORKER == 1 ]] && run worker 35 "$BACKEND" "$PY" -m app.worker
run web 32 "$FRONTEND" npm run dev

say "Сайт: http://localhost:3000  Админка: http://localhost:3000/admin  Swagger: http://localhost:8000/api/docs"

# If any part dies (port busy, crash), stop the rest instead of leaving a half-running stack.
wait -n
