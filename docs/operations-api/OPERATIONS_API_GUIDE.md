# Operations Platform (UPL) API — Integration Guide

> ملاحظة (للمستخدم): ده الملف المرجعي الكامل لكل حاجة خاصة بربط سيستم الأوبريشن
> الخارجي (UPL). قول لأي Claude Code يقرأه قبل ما يشتغل على أي حاجة ليها علاقة
> بالأوبريشن/الشحنات/السائقين/العملاء. المسار:
> `docs/operations-api/OPERATIONS_API_GUIDE.md`

This document is self-contained: read it and you understand the whole integration
between **our app** (Next.js frontend + Express/Mongoose backend) and the external
**UPL Operations platform** (the system the field/operations team works on — a B2B
logistics platform covering **Fleet Management** + **3PL**).

There are two companion files in this same folder:
- `openapi.json` — the full OpenAPI 3 spec pulled from UPL (106 paths).
- `API_REFERENCE.md` — auto-generated, human-readable list of every endpoint, its
  query params and request body. **Use it as the endpoint catalog.**

---

## 1. The link (where it lives)

| Thing | Value |
|---|---|
| Base URL | `https://backend.energize-logistics.com` |
| API prefix | `/api/v1` (every endpoint is `https://backend.energize-logistics.com/api/v1/...`) |
| Swagger UI | `https://backend.energize-logistics.com/api/admin-docs` |
| OpenAPI JSON | `https://backend.energize-logistics.com/api/admin-docs-json` (needs `x-api-key`) |
| Framework (theirs) | NestJS (strict query validation — see gotchas) |
| Title | "UPL Admin API" |

> ⚠️ The base URL happens to be on our brand's subdomain, but it is the **vendor's
> system**, NOT our `backend/` Express app. Don't confuse them.

---

## 2. Authority & Authentication (CRITICAL — read carefully)

Every request needs **TWO** headers:

1. **`x-api-key: <key>`** — required on **every single request**, including login.
   Without it you get `401 {"message":"Invalid API key"}`.
2. **`Authorization: Bearer <JWT>`** — required on all protected (non-login)
   endpoints. You obtain the JWT by logging in.

### Getting the JWT (login)
```
POST /api/v1/admins/login
Headers: x-api-key: <key>,  Content-Type: application/json
Body:    { "email": "<admin email>", "password": "<password>" }
→ 200 { statusCode, message, data: { admin: {...}, accessToken: "<JWT>" } }
```
The JWT lasts ~7 days. The api-key is a 64-char hex value (NOT a JWT).

### Where the credentials live (never hardcode them)
All secrets are in **`backend/.env`** (gitignored). See `backend/.env.example`:
```
UPL_BASE_URL=https://backend.energize-logistics.com
UPL_API_KEY=<x-api-key value>
UPL_ADMIN_EMAIL=<admin email>
UPL_ADMIN_PASSWORD=<admin password>
```

### Ready-to-run curl (auth + a call)
```bash
BASE=https://backend.energize-logistics.com/api/v1
KEY=$UPL_API_KEY   # from backend/.env

# 1) login -> grab token
TOKEN=$(curl -s -X POST "$BASE/admins/login" \
  -H "x-api-key: $KEY" -H "Content-Type: application/json" \
  -d '{"email":"'"$UPL_ADMIN_EMAIL"'","password":"'"$UPL_ADMIN_PASSWORD"'"}' \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['data']['accessToken'])")

# 2) call any endpoint with BOTH headers
curl -s -H "x-api-key: $KEY" -H "Authorization: Bearer $TOKEN" \
  "$BASE/admin/reports/stats"
```

---

## 3. Response shape

Every response is wrapped:
```json
{ "statusCode": 200, "message": "...", "data": <payload> }
```
List endpoints return:
```json
{ "data": { "items": [ ... ], "meta": {
  "totalItems": 26991, "currentPage": 1, "totalPages": 1080, "limit": 25,
  "hasNextPage": true, "hasPreviousPage": false } } }
```

---

## 4. Gotchas / quirks we already discovered (IMPORTANT)

These cost real debugging time — respect them:

- **`limit` max is 100.** Larger → `400 ") must not exceed 100"`. Paginate.
- **Never send `lang` as a query param.** UPL uses `forbidNonWhitelisted`, so
  unknown query params 400. Send language as a **header** `lang: ar|en` instead.
- **Sort is nested bracket syntax:** `sort[updated_at]=desc`. The forms
  `sort=-updated_at`, `sort=updated_at`, comma, or JSON all 400 with
  `") must be an object"`.
- **Multi-value status filter = repeat the param:** `status=requesting&status=loading`.
  Comma (`status=a,b`) 400s with "Invalid Status enum".
- **Localized fields** (names of branches, cities, truck types, car names, …) come
  back as `{ "en": "...", "ar": "..." }` OR a plain string. Handle both.
- **`search` is fuzzy and multi-field.** Searching a number can match a different
  shipment's other field. For an EXACT match on the unique numbers
  (`graduation_statement_num`, `reference_num`) do `search=<n>` then filter the
  results client-side to the exact field.
- **Driver name is at `shipment.driver.admin.name`**, NOT `driver.name`. Phone too
  (`driver.admin.phone`). The `driver` object itself holds nationality, residence,
  card number, etc.
- **Car owner** is at `shipment.car.owner.owner_name` (and `car.owner.owner.name`).
- **Shipment create/update is `multipart/form-data`** (it carries images). Most
  other resources accept `application/json`.
- **The `admins` endpoint is misleading** — it returns driver/company app accounts
  (temp emails like `driver_*@temp.local`), not real back-office admins. We do not
  surface it as a page.
- **UPL exposes NO socket/webhook to us** (its `/socket.io` 404s). So "live" from
  their side = we poll. See §6.

---

## 5. How OUR system is wired to it (architecture)

```
Browser (Next.js pages)
   │  calls our own /api/ops/* (same-origin, cookie auth) — NEVER calls UPL directly
   ▼
Express backend  /api/ops/*  (routes/ops.js → controllers/opsController.js)
   │  adds OUR auth (cookie JWT) + RBAC, then proxies to UPL via uplClient
   ▼
services/uplClient.js  → adds x-api-key + Bearer, caches token, auto re-logins on 401
   ▼
UPL  https://backend.energize-logistics.com/api/v1/*
```

Key backend files:
- **`backend/src/services/uplClient.js`** — the ONLY thing that talks to UPL. Token
  cache + auto re-login, nested-bracket query serializer, `request()/get/post/patch/del`.
- **`backend/src/config/opsResources.js`** — whitelist mapping our resource keys →
  UPL paths (shipments, drivers, cars, car-owners, branches, cities, countries,
  users, truck-types, truck-sizes, load-types, car-brands, car-colors, admins).
- **`backend/src/controllers/opsController.js`** — dashboard + generic CRUD proxy +
  shipment status/timeline + inbound webhook.
- **`backend/src/routes/ops.js`** — mounts `/api/ops`, auth + RBAC
  (`OPS_PLATFORM_STAFF_ROLES` read, `OPS_PLATFORM_ADMIN_ROLES` write — in
  `config/constants.js`).
- **`backend/src/jobs/opsPoll.js`** — near-real-time polling (see §6).
- **`backend/src/services/opsCustomerSyncService.js`** — mirrors UPL customers into
  the CRM (see §7).

Frontend:
- **`frontend/src/lib/ops.ts`** — resource configs (columns, form fields, filters),
  status styles, helpers (`locName`, `fmtMoney`…), role lists.
- **`frontend/src/components/ops/OpsResourceTable.tsx`** — generic CRUD table.
- **`frontend/src/components/ops/OpsLiveSummary.tsx`** — live widget embedded in
  other dashboards.
- **`frontend/src/app/system/ops/`** — dashboard `page.tsx`, custom `shipments/`,
  and thin entity pages (drivers, cars, …).

---

## 6. "Live" updates (how changes propagate)

- Changes WE make through `/api/ops` are instant (direct proxy + we broadcast
  `ops:<resource>:changed` over our socket.io).
- Changes made **inside UPL** can't push to us (no webhook/socket from them), so
  `jobs/opsPoll.js` polls and broadcasts:
  - shipments every `UPL_POLL_INTERVAL_MS` (default 6s) → `ops:shipments:changed`
  - stats every `UPL_STATS_INTERVAL_MS` (default 30s) → `ops:stats`
- **For genuinely-instant push**, we exposed `POST /api/ops/webhook` (gated by
  `UPL_WEBHOOK_SECRET`, declared before auth). If the vendor ever calls it on
  change, set the same secret on both sides and it broadcasts immediately. Body:
  `{ resource, action, id?, ids?, status? }`.

---

## 7. Customers → CRM sync

`services/opsCustomerSyncService.js` mirrors UPL customers (the `/admin/users`
endpoint = businesses/individuals who book shipments) into `CrmCompany` every
`OPS_CUSTOMER_SYNC_MIN` minutes (default 30) + on boot. Deduped by
`CrmCompany.externalSource:'ops_upl'` + `externalId` (UPL user id). Contact fields
are re-synced each run; CRM-only fields (owner/rating/notes/status) are written
only on first insert.

---

## 8. Our proxy endpoints (what the frontend calls)

All under `/api/ops` (our backend), all require our cookie auth + ops role:

| Method | Path | UPL target | Notes |
|---|---|---|---|
| GET | `/api/ops/dashboard` | reports/stats + charts + operation-home | combined, partial-failure tolerant |
| GET | `/api/ops/:resource` | `/admin/<resource>` (or `/admins`,`/roles`) | list (items+meta) |
| GET | `/api/ops/:resource/:id` | `.../:id` | single |
| POST | `/api/ops/:resource` | create (multipart for shipments) | admin tier |
| PATCH | `/api/ops/:resource/:id` | update | admin tier |
| DELETE | `/api/ops/:resource/:id` | delete | admin tier |
| PATCH | `/api/ops/:resource/restore/:id` | restore (soft-deleted) | admin tier |
| PATCH | `/api/ops/shipments/status` | bulk status `{status, ids[], status_log_details?}` | admin tier |
| GET | `/api/ops/shipments/timeline/:id` | status timeline | |
| POST | `/api/ops/webhook` | (inbound from UPL) | secret-gated, no auth |

`:resource` ∈ the whitelist in `config/opsResources.js`.

For the FULL list of raw UPL endpoints + params + bodies, see **`API_REFERENCE.md`**
and **`openapi.json`** in this folder.

---

## 9. How to do common things ("when I need to fetch / edit / add")

- **Fetch data for a page** → `GET /api/ops/<resource>?page=1&limit=25&search=...&<filters>`
  (send `lang` as a header if needed, never as a query param).
- **Edit a record** → `PATCH /api/ops/<resource>/<id>` with a JSON body of the
  fields. (Shipments go out as multipart automatically — handled by uplClient.)
- **Change a shipment's status** → `PATCH /api/ops/shipments/status`
  `{ "status": "on_way", "ids": ["<id>"] }`.
- **Add a new entity type/page** →
  1. Add it to `backend/src/config/opsResources.js` (key → UPL path).
  2. Add a `ResourceCfg` to `RESOURCES` in `frontend/src/lib/ops.ts`
     (columns + form `fields` + filters).
  3. Create `frontend/src/app/system/ops/<key>/page.tsx` rendering
     `<OpsResourceTable cfg={resourceByKey('<key>')!} />`.
  4. Add a sidebar entry in `frontend/src/app/system/layout.tsx`.
- **Probe/debug UPL directly** → use the curl in §2, then hit any path from
  `API_REFERENCE.md`. Remember the gotchas in §4.

---

## 10. Environment variables (backend/.env)

```
UPL_BASE_URL=https://backend.energize-logistics.com
UPL_API_KEY=...                 # the x-api-key
UPL_ADMIN_EMAIL=...             # login email
UPL_ADMIN_PASSWORD=...          # login password
UPL_POLL_INTERVAL_MS=6000       # shipments poll cadence
UPL_STATS_INTERVAL_MS=30000     # stats poll cadence
UPL_WEBHOOK_SECRET=...          # shared secret for POST /api/ops/webhook
OPS_CUSTOMER_SYNC_MIN=30        # CRM customer-sync interval (minutes)
```

---

## 11. Resources we expose (entity → UPL path)

shipments → `/admin/shipments` · drivers → `/admin/drivers` · cars → `/admin/cars`
· car-owners → `/admin/car-owners` · branches → `/admin/branches` · cities →
`/admin/cities` · countries → `/admin/countries` · users (customers) →
`/admin/users` · truck-types → `/admin/truck-types` · truck-sizes →
`/admin/truck-sizes` · load-types → `/admin/load-types` · car-brands →
`/admin/car-brands` · car-colors → `/admin/car-colors` · roles → `/roles` ·
permissions → `/permissions`.

Reports/extras: `/admin/reports/stats`, `/admin/reports/charts-maps-tables`,
`/admins/operation-app-home`, `/admin/shipments/timeline/:id`,
`/admin/import-excel`, `/admin/export-excel`, `/admin/download-excel`.

---

_Last verified live against real data: 26,991 shipments · 16,101 drivers ·
12,123 cars · 580 customers · 9 branches. If endpoints/params change, re-pull
`openapi.json` from `/api/admin-docs-json` and regenerate `API_REFERENCE.md`._
