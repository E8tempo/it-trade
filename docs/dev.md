# Запуск в режиме разработки

В dev всё работает без Docker: база — SQLite (`backend/data/dev.db`), фото лежат в `backend/data/media`. Вместо ~390 тыс. товаров грузится выборка: до 10 товаров с фото на категорию, в первую очередь те, что в наличии. Это ~11.7 тыс. товаров, из них ~9.5 тыс. в наличии, при этом дерево категорий заполнено целиком.

Нужно: Python 3.14, Node.js 22+, логин и пароль b2b.i-t-p.pro.

Понадобятся три терминала: воркер, API и фронтенд.

## 1. Backend: установка

```bash
cd backend
python -m venv .venv
# Windows:
.venv\Scripts\activate
# Linux/macOS:
source .venv/bin/activate

pip install -e . --group dev
cp .env.example .env
```

В `backend/.env` задайте:

- `ADMIN_PASSWORD`: админ создаётся при старте API, логин — `ADMIN_EMAIL`;
- `SUPPLIER_LOGIN` и `SUPPLIER_PASSWORD`, если их нет в корневом `.env`.

`backend/.env` перекрывает корневой `.env`, который использует docker compose. Общие значения, например данные поставщика, можно держать в корневом.

Затем создайте базу:

```bash
alembic upgrade head
```

## 2. Наполнение данными (воркер)

```bash
python -m app.worker
```

При первом запуске воркер сам сделает всё по порядку:

| Этап | Время |
|---|---|
| Дерево категорий | секунды |
| Каталог: выборка `CATALOG_SAMPLE_PER_CATEGORY=10` | ~1 мин |
| Цены и остатки | ~40 с |
| Списки фото (~62 тыс. фото у ~11.7 тыс. товаров) | ~1 мин |
| Главные фото товаров в наличии (~9.5 тыс.) | ~55 мин при 3 фото/с |

Остальные фото галереи обрабатываются при первом открытии карточки товара (`IMAGE_PREFETCH_GALLERY=false`). Пока главного фото нет, у карточки в выдаче `image: null`.

Воркер можно остановить (Ctrl+C) и запустить снова: он продолжит с того места, где остановился. Состояние задач хранится в таблице `job_state`. Потом он сам обновляет остатки раз в 30 минут и каталог раз в сутки.

Лимиты поставщика: каталог — 2 раза в час, остатки — 10 раз в час. Не дёргайте синхронизацию руками слишком часто, удобнее оставить воркер работать.

Разовые команды (`python -m app.cli --help`):

```bash
python -m app.cli sync stock             # обновить цены и остатки сейчас
python -m app.cli process-images 100     # обработать 100 фото из очереди без воркера
python -m app.cli reprice                # пересчитать цены после смены наценок
```

Чтобы начать с нуля, удалите `backend/data/` и повторите `alembic upgrade head`.

## 3. API

```bash
uvicorn app.main:app --reload --port 8000
```

- Swagger: http://localhost:8000/api/docs
- Здоровье: http://localhost:8000/api/health

## 4. Frontend

```bash
cd frontend
npm install
cp .env.example .env.local   # API_URL=http://localhost:8000
npm run dev
```

Сайт: http://localhost:3000.

Next проксирует `/api/*` и `/media/*` на бэкенд (rewrites в `next.config.ts`), поэтому для браузера API находится на том же адресе. Cookies авторизации работают без CORS. В проде то же самое делает Caddy.

## Авторизация (JWT)

| Токен | Срок | Cookie |
|---|---|---|
| access | 15 мин (`JWT_ACCESS_TTL_MIN`) | `access_token`, httpOnly |
| refresh | 30 дней (`JWT_REFRESH_TTL_DAYS`) | `refresh_token`, httpOnly |

- При каждом обновлении refresh-токен ротируется. Если уже использованный токен предъявят повторно позже чем через 30 с, отзывается вся цепочка сессии (защита от кражи). 30 секунд оставлены для параллельных запросов одной страницы.
- Токены возвращаются и в JSON-ответе, поэтому для API-клиентов работают `Authorization: Bearer <access>` и `{"refresh_token": "..."}` в теле `/api/auth/refresh`.
- В dev используется фиксированный `JWT_SECRET`; в проде его нужно задать обязательно, иначе API не запустится.

| Метод | Путь | Что делает |
|---|---|---|
| POST | `/api/auth/register` | `{email, password, name?, phone?}`: регистрация и вход |
| POST | `/api/auth/login` | `{email, password}` |
| POST | `/api/auth/refresh` | новая пара токенов (из cookie или тела запроса) |
| POST | `/api/auth/logout` | завершить текущую сессию |
| POST | `/api/auth/logout-all` | завершить все сессии пользователя |
| GET/PATCH | `/api/auth/me` | профиль: имя, телефон |
| POST | `/api/auth/password` | `{current_password, new_password}`: смена пароля, остальные сессии завершаются |

Админские эндпоинты `/api/admin/*` требуют роль `admin`.

Во фронтенде уже подготовлено:

- `proxy.ts`: если access-cookie истекла, а refresh-cookie есть, сессия обновляется до рендера страницы, и Server Components сразу видят пользователя;
- `lib/api/server.ts`, функция `apiServer()`: запросы из Server Components и Server Functions с токеном пользователя. Использует `cookies()`, поэтому с Cache Components такой код должен быть внутри `<Suspense>`. Функция `apiPublic()` предназначена для публичного каталога без cookies, его можно кешировать через `"use cache"`;
- `lib/api/client.ts`, функция `api()`: запросы из браузера. При 401 сессия обновляется один раз, и запрос повторяется.

Проверка из консоли (cookies в файле `jar`):

```bash
curl -c jar -H "content-type: application/json" -d '{"email":"admin@example.com","password":"..."}' http://localhost:3000/api/auth/login
curl -b jar http://localhost:3000/api/auth/me
curl -b jar http://localhost:3000/api/admin/status
```

## Тесты

```bash
cd backend
python -m pytest
```

Тесты используют временную SQLite и не обращаются к поставщику.

```bash
cd frontend
npx tsc --noEmit
npm run lint
```

## Postgres вместо SQLite (по желанию)

Если нужно проверить что-то специфичное для Postgres:

1. Поднимите контейнер `docker run -d --name ittrade-pg -e POSTGRES_PASSWORD=dev -p 5432:5432 postgres:18-alpine`.
2. В `backend/.env` пропишите `DATABASE_URL=postgresql+asyncpg://postgres:dev@localhost:5432/postgres`.
3. Выполните `alembic upgrade head`.
