# Запуск в режиме разработки

В dev всё работает без Docker: база — SQLite (`backend/data/dev.db`), фото лежат в `backend/data/media`. Вместо ~390 тыс. товаров грузится выборка: `CATALOG_SAMPLE_LIMIT=200` — 200 товаров с фото, разложенных по всем корневым разделам (по ~12 на раздел, почти каждый из своей категории), в первую очередь те, что в наличии. Для объёма побольше есть `CATALOG_SAMPLE_PER_CATEGORY=N` — до N товаров на категорию (10 дают ~11.7 тыс. товаров).

Нужно: Python 3.14, Node.js 22+, логин и пароль b2b.i-t-p.pro.

Понадобятся три терминала: воркер, API и фронтенд. Или один: `./dev.sh` из корня применяет миграции и запускает все три с подписанным выводом (`--no-worker` — без воркера), Ctrl+C останавливает всё. API и воркер сами перезапускаются при правке кода бэкенда. При первом запуске он сам создаст `.venv`, поставит зависимости и скопирует `.env` из примеров.

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
| Каталог: скачивание и выборка 200 товаров | ~1 мин |
| Цены и остатки | ~40 с |
| Списки фото (~1.1 тыс. фото у 200 товаров) | секунды |
| Главные фото товаров в наличии (~190) | ~1 мин при 3 фото/с |
| Остальные фото галерей | ещё ~6 мин |

Ход загрузки, настройки (сколько фото на товар, скорость, пауза) и пробная партия — в админке, «Поставщики → IT Partner → Загрузка каталога». В dev загрузка фото не на паузе и все фото товара (до 8) обрабатываются заранее, поэтому страница товара открывается сразу с готовыми фото. Пока фото товара не готово, у карточки в выдаче `image: null`, на сайте вместо него заглушка. Если в админке выключить «Остальные фото — заранее», фото галереи обрабатываются при первом открытии товара: секунда-две на фото.

После изменений в снятии знака поднимите `VERSION` в `backend/app/images/processing.py` и опишите версию в статье «Версии снятия знака»: воркер сам переобработает фото старых версий (после новых фото). Пока очередь идёт, на сайте видны старые версии, новые подменяются по мере готовности. Прогнать заново фото одного размера знака можно командой `python -m app.cli requeue-images small`.

Повторы в галереях (одно фото в двух размерах, слайд на нескольких языках) ищутся после обработки каждого фото. Для уже обработанных фото, например после обновления кода, их находит `python -m app.cli dedupe-images`.

Воркер можно остановить (Ctrl+C) и запустить снова: он продолжит с того места, где остановился. Состояние задач хранится в таблице `job_state`. Потом он сам обновляет остатки раз в 30 минут и каталог раз в сутки.

Лимиты поставщика: каталог — 2 раза в час, остатки — 10 раз в час. Не дёргайте синхронизацию руками слишком часто, удобнее оставить воркер работать.

Разовые команды (`python -m app.cli --help`):

```bash
python -m app.cli sync stock             # обновить цены и остатки сейчас
python -m app.cli process-images 100     # обработать 100 фото из очереди без воркера
python -m app.cli reprice                # пересчитать цены после смены наценок
python -m app.cli dedupe-images          # найти повторы среди уже обработанных фото
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

Админка: http://localhost:3000/admin. Вход — `ADMIN_EMAIL` и `ADMIN_PASSWORD` из `backend/.env`, этот администратор создаётся при старте API. После обновления кода примените миграции: `python -m alembic upgrade head` (из `backend/`).

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

## Кабинет клиента: корзина, заказы, организации

Регистрация требует код, отправленный на e-mail. Без `SMTP_HOST` письмо не отправляется, а печатается в лог API: в `./dev.sh` код виден в строках `api` («mail (SMTP_HOST is not set…»).

Сайт работает только с бизнесом. Без сессии открываются только `/login` и `/register` (и `/admin` со своим входом): остальные страницы `proxy.ts` перенаправляет на вход, а `RequireSession` (components/shop/require-session.tsx) — если сессия кончилась на открытой странице. Публичный каталог (`/api/products`, `/api/products/{sku}`) цен не отдаёт. Цены, корзина и заказы доступны только сотрудникам подтверждённой организации: гостю `401`, пользователю без подтверждённой организации `403`. Цены всегда считает сервер: оптовые цены организации (`app/pricing.py: can_buy_for`) для способа оплаты `?payment=cash|cashless`. Ответы с данными клиента приходят с `Cache-Control: no-store`.

| Метод | Путь | Что делает |
|---|---|---|
| POST | `/api/auth/register` | `{email, password, name, phone, organization: {name, inn, kpp?}}`: регистрация вместе с организацией; пользователь становится её руководителем; 409, если компания уже клиент |
| GET | `/api/cart?payment=` | корзина: строки с ценами обоих способов оплаты, проблемы строк (`not_found`, `out_of_stock`, `no_price`), итоги, `organization` — для какой организации цены |
| POST | `/api/cart/items` | `{items: [{sku, qty}]}`: добавить (количество округляется вверх до кратности); не добавленные — в `not_added` |
| PUT/DELETE | `/api/cart/items/{sku}` | `{qty}`: задать количество (0 — удалить) / удалить строку |
| DELETE | `/api/cart` | очистить |
| PUT | `/api/cart/organization` | `{organization_id}`: от какой своей подтверждённой организации работать (её цены во всём каталоге) |
| GET | `/api/cart/prices?sku=…` | цены товаров (до 200) для организации: страницы каталога одинаковы для всех, браузер клиента берёт цены отсюда |
| POST | `/api/orders` | оформить заказ из корзины: контакты, доставка, `payment_method`, `contract_id` (договор организации), `expected_total`; 409, если корзина изменилась |
| GET | `/api/orders`, `/api/orders/{id}` | заказы: руководителю — все заказы его организаций, закупщику — свои (без закупочных цен и заметок менеджера) |
| GET/POST | `/api/account/organizations` | организации пользователя с его ролью / добавить ещё одну (ИНН и ОГРН проверяются по контрольным цифрам) |
| PUT/DELETE | `/api/account/organizations/{id}` | только руководитель: изменить реквизиты (подтверждённая организация снова уходит на проверку) / удалить (если у неё нет договоров) |
| GET | `/api/posts?kind=&limit=` | опубликованные новости и текущие акции для главной |

Админка:

| Метод | Путь | Что делает |
|---|---|---|
| GET | `/api/admin/suppliers` | поставщики и число их товаров |
| GET | `/api/admin/suppliers/{code}/pricing` | правила наценки поставщика для 4 типов цен |
| PUT | `/api/admin/suppliers/{code}/pricing/{price_type}` | сохранить правила одного типа; цены пересчитываются в фоне |
| POST | `/api/admin/pricing/preview`, `/impact` | калькулятор и «как изменятся цены» для типа цены |
| GET | `/api/admin/organizations?status=&q=` | клиенты (организации), счётчики по статусам; поиск по названию, ИНН, e-mail сотрудника |
| GET/PUT/DELETE | `/api/admin/organizations/{id}` | карточка (сотрудники, договоры, заказы) / правка реквизитов / удаление |
| POST | `/api/admin/organizations/{id}/members` | `{email, role: owner\|buyer}`: добавить зарегистрированного пользователя |
| PUT/DELETE | `/api/admin/organizations/{id}/members/{user_id}` | сменить роль / убрать (руководитель у организации остаётся всегда) |
| POST | `/api/admin/organizations/{id}/review` | `{status, note?}`: подтвердить, отклонить с причиной или вернуть на проверку |
| POST | `/api/admin/organizations/{id}/contracts` | `{number, signed_on, terms: prepayment\|deferred, deferral_days?, is_active}`: добавить договор |
| PUT/DELETE | `/api/admin/contracts/{id}` | изменить или закрыть договор (`is_active: false`) / удалить |
| GET/POST | `/api/admin/posts` | новости и акции / создать (`{kind: news\|promo, title, body, link_url?, is_published, pinned, ends_on?}`) |
| PUT/DELETE | `/api/admin/posts/{id}` | изменить / удалить |

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
