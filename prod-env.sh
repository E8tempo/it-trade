#!/usr/bin/env bash
# Prepares the root .env for production (docker compose). See docs/prod.md.
#
#   ./prod-env.sh          create .env from .env.example if needed, generate secrets, ask for the rest
#   ./prod-env.sh --yes    no questions: only what can be generated or detected
#
# Values already set are never changed, so it is safe to run again: it only fills the gaps
# and checks what is there (DNS of the domain, supplier login, SMTP port).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV="$ROOT/.env"
EXAMPLE="$ROOT/.env.example"

INTERACTIVE=1
[[ -t 0 ]] || INTERACTIVE=0
for arg in "$@"; do
  case "$arg" in
    -y|--yes) INTERACTIVE=0 ;;
    -h|--help) sed -n '2,8p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Неизвестный аргумент: $arg" >&2; exit 1 ;;
  esac
done

say()  { printf '\033[1m==> %s\033[0m\n' "$*"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; WARNINGS=$((WARNINGS + 1)); }
WARNINGS=0

# --- .env helpers -------------------------------------------------------------

# get KEY: the value of the last active KEY= line, without quotes and inline comment
get() {
  local line
  line=$(grep -E "^[[:space:]]*$1=" "$ENV" | tail -n1) || true
  line=${line#*=}
  case $line in
    \'*) line=${line#\'}; line=${line%%\'*} ;;
    \"*) line=${line#\"}; line=${line%%\"*} ;;
    *) line=$(sed -E 's/[[:space:]]+#.*$//; s/[[:space:]]+$//' <<<"$line") ;;
  esac
  printf '%s' "$line"
}

# Plain values are written as is; anything with spaces, $, # and so on in single quotes, which both
# docker compose and the backend (python-dotenv) take literally.
quote() {
  if [[ $1 =~ ^[A-Za-z0-9._@:/+=,-]*$ ]]; then
    printf '%s' "$1"
  else
    printf "'%s'" "$1"
  fi
}

# set KEY VALUE: replaces the KEY= line (or a commented-out "# KEY=" one) keeping its inline comment,
# otherwise appends
set_var() {
  local key=$1 line tmp mode=append
  line="$key=$(quote "$2")"
  if grep -qE "^[[:space:]]*$key=" "$ENV"; then
    mode=active
  elif grep -qE "^#[[:space:]]*$key=" "$ENV"; then
    mode=commented
  fi
  tmp=$(mktemp "$ENV.XXXXXX")
  LINE=$line KEY=$key MODE=$mode awk '
    BEGIN { k = ENVIRON["KEY"]; mode = ENVIRON["MODE"]; done = 0 }
    {
      pat = (mode == "commented") ? "^#[[:space:]]*" k "=" : "^[[:space:]]*" k "="
      if (mode != "append" && $0 ~ pat) {
        if (!done) {
          rest = $0
          sub(/^[^=]*=/, "", rest)
          comment = ""
          if (rest !~ /^[\047"]/ && match(rest, /[ \t]+#/)) comment = substr(rest, RSTART)
          print ENVIRON["LINE"] comment
        }
        done = 1
        next
      }
      print
    }
    END { if (mode == "append") print ENVIRON["LINE"] }
  ' "$ENV" >"$tmp"
  cat "$tmp" >"$ENV" # keeps the file's owner and mode
  rm -f "$tmp"
}

rand_hex() {
  openssl rand -hex "$1" 2>/dev/null || od -An -tx1 -N "$1" /dev/urandom | tr -d ' \n'
}

rand_password() {
  LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c 20 || true
}

# ask VAR "question" [default] [secret]: reads an answer into VAR (empty if skipped)
ask() {
  local __var=$1 prompt=$2 default=${3-} secret=${4-} answer
  while true; do
    if [[ -n $default ]]; then prompt+=" [$default]"; fi
    if [[ -n $secret ]]; then
      read -r -s -p "  $prompt: " answer; echo
    else
      read -r -p "  $prompt: " answer
    fi
    answer=${answer:-$default}
    if [[ $answer == *"'"* ]]; then
      echo "  Значение не может содержать одинарную кавычку, введите другое." >&2
      default=""
      continue
    fi
    printf -v "$__var" '%s' "$answer"
    return
  done
}

json_escape() {
  local s=$1
  s=${s//\\/\\\\}
  s=${s//\"/\\\"}
  printf '%s' "$s"
}

# --- start --------------------------------------------------------------------

if [[ ! -f $ENV ]]; then
  cp "$EXAMPLE" "$ENV"
  chmod 600 "$ENV"
  say "Создан .env из .env.example"
else
  cp -p "$ENV" "$ENV.bak"
  say "Дополняю существующий .env"
fi

if [[ $(stat -c %a "$ENV" 2>/dev/null || echo 600) != 600 ]]; then
  chmod 600 "$ENV"
  ok ".env: права 600, в нём пароли"
fi

# --- domain -------------------------------------------------------------------

say "Домен"
DOMAIN=$(get DOMAIN)
if [[ -z $DOMAIN || $DOMAIN == shop.example.ru ]]; then
  if ((INTERACTIVE)); then
    ask DOMAIN "Домен сайта, например shop.it-trade.ru"
    DOMAIN=${DOMAIN#http://}; DOMAIN=${DOMAIN#https://}; DOMAIN=${DOMAIN%%/*}
    DOMAIN=$(tr '[:upper:]' '[:lower:]' <<<"$DOMAIN")
    [[ -n $DOMAIN ]] && set_var DOMAIN "$DOMAIN"
  fi
fi
DOMAIN=$(get DOMAIN)
if [[ -z $DOMAIN || $DOMAIN == shop.example.ru ]]; then
  warn "DOMAIN не задан"
elif [[ $DOMAIN == localhost ]]; then
  ok "DOMAIN=localhost: локальная проверка, сертификат самоподписанный"
else
  public_ip=$(curl -fsS4 --max-time 5 https://api.ipify.org 2>/dev/null || curl -fsS4 --max-time 5 https://ifconfig.me 2>/dev/null || true)
  resolved=$(getent ahostsv4 "$DOMAIN" 2>/dev/null | awk '{print $1}' | sort -u | tr '\n' ' ' || true)
  resolved=${resolved% }
  if [[ -z $resolved ]]; then
    warn "$DOMAIN не резолвится: создайте A-запись на IP сервера${public_ip:+ ($public_ip)}, иначе Caddy не получит сертификат"
  elif [[ -z $public_ip ]]; then
    ok "$DOMAIN → $resolved (внешний IP сервера определить не удалось, сверьте сами)"
  elif [[ " $resolved " == *" $public_ip "* ]]; then
    ok "$DOMAIN → $resolved, это этот сервер"
  else
    warn "$DOMAIN → $resolved, а внешний IP сервера $public_ip: проверьте A-запись (или прокси Cloudflare — его надо выключить на время выпуска сертификата)"
  fi
fi

# --- database -----------------------------------------------------------------

say "База данных"
if [[ -z $(get POSTGRES_PASSWORD) ]]; then
  # Postgres takes the password only when it creates the database: a new one for an existing volume
  # would lock the API out of it.
  if docker volume inspect it-trade_pgdata >/dev/null 2>&1; then
    warn "POSTGRES_PASSWORD пуст, а база (volume it-trade_pgdata) уже создана: впишите пароль, с которым она создавалась"
  else
    set_var POSTGRES_PASSWORD "$(rand_hex 24)"
    ok "POSTGRES_PASSWORD сгенерирован"
  fi
else
  ok "POSTGRES_PASSWORD уже задан, не трогаю"
  if [[ ! $(get POSTGRES_PASSWORD) =~ ^[A-Za-z0-9._~-]+$ ]]; then
    warn "в POSTGRES_PASSWORD есть символы, которые ломают DATABASE_URL: нужны только буквы, цифры и ._~-"
  fi
fi

# --- secrets and admin --------------------------------------------------------

say "Секреты и администратор"
JWT=$(get JWT_SECRET)
if ((${#JWT} < 32)); then
  set_var JWT_SECRET "$(rand_hex 32)"
  ok "JWT_SECRET сгенерирован${JWT:+ (старый был короче 32 символов, API с ним не запустился бы)}"
else
  ok "JWT_SECRET уже задан, не трогаю"
fi

ADMIN_EMAIL=$(get ADMIN_EMAIL)
if [[ -z $ADMIN_EMAIL || $ADMIN_EMAIL == admin@example.ru ]]; then
  default=""
  [[ -n $DOMAIN && $DOMAIN != shop.example.ru && $DOMAIN != localhost ]] && default="admin@$DOMAIN"
  if ((INTERACTIVE)); then
    ask ADMIN_EMAIL "E-mail администратора (это логин в админку; на него же придёт код, если забыть пароль)" "$default"
  else
    ADMIN_EMAIL=$default
  fi
  [[ -n $ADMIN_EMAIL ]] && set_var ADMIN_EMAIL "$ADMIN_EMAIL" && ok "ADMIN_EMAIL=$ADMIN_EMAIL"
fi
[[ -z $(get ADMIN_EMAIL) || $(get ADMIN_EMAIL) == admin@example.ru ]] && warn "ADMIN_EMAIL не задан"

NEW_ADMIN_PASSWORD=""
if [[ -z $(get ADMIN_PASSWORD) ]]; then
  NEW_ADMIN_PASSWORD=$(rand_password)
  set_var ADMIN_PASSWORD "$NEW_ADMIN_PASSWORD"
  ok "ADMIN_PASSWORD сгенерирован (покажу в конце)"
else
  ok "ADMIN_PASSWORD уже задан, не трогаю"
fi

# --- supplier -----------------------------------------------------------------

say "Поставщик (b2b.i-t-p.pro)"
if [[ -z $(get SUPPLIER_LOGIN) || -z $(get SUPPLIER_PASSWORD) ]] && ((INTERACTIVE)); then
  ask login "Логин b2b.i-t-p.pro" "$(get SUPPLIER_LOGIN)"
  ask password "Пароль b2b.i-t-p.pro" "" secret
  [[ -n $login ]] && set_var SUPPLIER_LOGIN "$login"
  [[ -n $password ]] && set_var SUPPLIER_PASSWORD "$password"
fi
login=$(get SUPPLIER_LOGIN)
password=$(get SUPPLIER_PASSWORD)
if [[ -z $login || -z $password ]]; then
  warn "SUPPLIER_LOGIN / SUPPLIER_PASSWORD не заданы: без них воркер не загрузит каталог"
else
  body=$(printf '{"data":{"login":"%s","password":"%s"},"request":{"method":"login","model":"auth","module":"quickfox"}}' \
    "$(json_escape "$login")" "$(json_escape "$password")")
  answer=$(curl -sS --max-time 20 -H 'content-type: application/json' --data @- https://b2b.i-t-p.pro/api/2 <<<"$body" 2>&1 || true)
  if grep -qE '"success"[[:space:]]*:[[:space:]]*true' <<<"$answer"; then
    ok "вход поставщика с $login работает"
  elif grep -q '"success"' <<<"$answer"; then
    warn "поставщик не принял логин или пароль ($login)"
  else
    warn "не удалось проверить вход поставщика: ${answer:0:200}"
  fi
fi

# --- mail ---------------------------------------------------------------------

say "Почта (коды подтверждения при регистрации и восстановлении пароля)"
if [[ -z $(get SMTP_HOST) ]] && ((INTERACTIVE)); then
  ask host "SMTP-сервер, например smtp.yandex.ru (Enter — пропустить)"
  if [[ -n $host ]]; then
    ask port "Порт: 465 — TLS, 587 — STARTTLS" "$(get SMTP_PORT || true)"
    ask user "Логин SMTP (обычно адрес ящика)"
    ask password "Пароль SMTP (для Яндекса и Mail.ru — пароль приложения)" "" secret
    set_var SMTP_HOST "$host"
    set_var SMTP_PORT "${port:-465}"
    [[ -n $user ]] && set_var SMTP_USER "$user"
    [[ -n $password ]] && set_var SMTP_PASSWORD "$password"
    if [[ -z $(get MAIL_FROM) && $user == *@* ]]; then
      set_var MAIL_FROM "IT Trade <$user>"
      ok "MAIL_FROM=IT Trade <$user>"
    fi
  fi
fi
host=$(get SMTP_HOST)
if [[ -z $host ]]; then
  warn "SMTP_HOST не задан: в проде без почты не работают регистрация и «Забыли пароль?»"
else
  port=$(get SMTP_PORT)
  port=${port:-465}
  # many VPS providers block outgoing mail ports until asked
  if timeout 5 bash -c "exec 3<>/dev/tcp/$host/$port" 2>/dev/null; then
    ok "$host:$port доступен"
  else
    warn "$host:$port недоступен: проверьте адрес или спросите хостинг, не закрыты ли исходящие порты почты"
  fi
fi

# --- optional -----------------------------------------------------------------

say "Необязательное"
if [[ -z $(get DADATA_API_KEY) ]] && ((INTERACTIVE)); then
  ask key "API-ключ dadata.ru для реквизитов по ИНН (Enter — пропустить, реквизиты будут вводить вручную)"
  [[ -n $key ]] && set_var DADATA_API_KEY "$key"
fi
[[ -n $(get DADATA_API_KEY) ]] && ok "DADATA_API_KEY задан" || ok "DADATA_API_KEY пуст: реквизиты организаций вводятся вручную"

if [[ -z $(get IMAGE_WORKERS) ]]; then
  # cores - 1, so the API and the database keep one; at most 6: at the supplier's 4.5 photos/s and
  # ~1 s of CPU per photo more processes only take memory
  cores=$(nproc 2>/dev/null || echo 2)
  workers=$((cores > 2 ? cores - 1 : 1))
  workers=$((workers > 6 ? 6 : workers))
  set_var IMAGE_WORKERS "$workers"
  ok "IMAGE_WORKERS=$workers (ядер: $cores)"
else
  ok "IMAGE_WORKERS=$(get IMAGE_WORKERS) уже задан"
fi

# --- result -------------------------------------------------------------------

echo
if [[ -f $ENV.bak ]]; then
  if cmp -s "$ENV" "$ENV.bak"; then
    rm -f "$ENV.bak"
  else
    say ".env дополнен, прежняя версия — .env.bak"
  fi
fi
if [[ -n $NEW_ADMIN_PASSWORD ]]; then
  site=$DOMAIN
  [[ -z $site || $site == shop.example.ru ]] && site="<домен>"
  say "Вход в админку: https://$site/admin"
  echo "  логин:  $(get ADMIN_EMAIL)"
  echo "  пароль: $NEW_ADMIN_PASSWORD"
  echo "  Сохраните его в менеджер паролей. После первого входа его можно стереть из .env:"
  echo "  администратор создаётся один раз, при первом старте API."
  echo
fi

if ((WARNINGS)); then
  say "Готово с замечаниями ($WARNINGS), см. «!» выше. Исправьте .env или запустите скрипт снова."
else
  say "Готово. Запуск: docker compose up -d --build"
fi
