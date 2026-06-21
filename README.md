# Energize Logistics — Company Operating System

A full-stack operations platform for **Energize**, a Saudi logistics company running both
**B2B** (freight, CFS, collections) and **B2C** (last-mile / sales-rep) lines of business.
It is a single internal system that every department logs into — finance, operations,
workshop, HR, CRM, sales and accounting — with role-based access, bilingual (Arabic /
English, full RTL) UI, and real-time updates over WebSockets.

---

## 1. Tech stack

| Layer | Tech |
|---|---|
| Backend | Node.js, Express, MongoDB (Mongoose), Socket.io, JWT auth (HTTP-only cookies) |
| Frontend | Next.js (App Router), React, TypeScript, Tailwind CSS, Framer Motion, lucide-react |
| Realtime | Socket.io — server emits domain events, pages subscribe via `useSocket` |
| i18n | Custom bilingual dictionary (`frontend/src/lib/translations.ts`), EN + AR + RTL |
| Excel | `xlsx` via `frontend/src/utils/exportExcel.ts` |

```
backend/   Express API  (src/models, src/controllers, src/routes, src/config, src/utils, src/scripts)
frontend/  Next.js app  (src/app/system/*, src/components, src/lib, src/context)
```

---

## 2. Running locally

**Backend**
```bash
cd backend
npm install
# .env: MONGODB_URI, JWT_ACCESS_SECRET, JWT_REFRESH_SECRET, FRONTEND_URL,
#       SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD (optional)
npm run dev        # starts the API + Socket.io on PORT (default 5001)
```
On first boot the server **auto-seeds** a `super_admin`, the default **HR leave types**,
and the default **chart of accounts** (all idempotent — safe on every restart).

**Frontend**
```bash
cd frontend
npm install
npm run dev        # Next.js dev server; proxies /api/* to the backend (see next.config)
```
> The frontend always calls `/api/*` on its own origin; Next rewrites proxy to the backend
> so auth cookies stay first-party (critical for Safari/iOS).

---

## 3. Core mechanisms (how everything works)

### Authentication & sessions
- Login issues a short-lived **access token** (15m) + **refresh token** (7d), both in
  HTTP-only cookies. `src/lib/api.ts` auto-refreshes on a 401 and replays the request.
- `middleware/auth.js` verifies the token, caches the user ~30s, and checks `isActive`/`isLocked`.

### Authorization (RBAC)
- `middleware/rbac.js` → `authorize(...roles)` gates each route.
- The frontend mirrors this: the sidebar (`app/system/layout.tsx`) only renders nav items
  whose `roles` include the current user's role, and `lib/roleRoutes.ts` sends each role to
  a landing page it actually has data permission for (no "failed to load" bounces).
- **Single source of truth per concern:** every role must appear in `backend/models/User.js`
  enum, `backend/routes/users.js` validation, `backend/config/constants.js`,
  `frontend/context/AuthContext.tsx`, `lib/roleRoutes.ts`, the layout nav, and
  `translations.ts` role labels.

### Real-time updates
- Controllers emit events (`emitToUser`, `emitToAll`) after a mutation, e.g.
  `crm:company`, `crm:deal`, `crm:task`, `accounting:journal`, `sales:target`,
  `hr:employee`, `notification:new`.
- Pages call `useSocket('<event>', reload)` so lists refresh instantly without polling.

### Notifications
- `services/notificationService.createNotification` writes a Notification doc **and** emits
  `notification:new` to the recipient; the bell in the top bar live-updates.

### Org chart (manager resolution) — *NEW*
- `config/constants.js → ROLE_HIERARCHY` maps each role to its **default manager role**
  (e.g. `accountant → finance_manager → admin → super_admin`). `super_admin` and `client`
  have **no** manager (CEO/COO and external); `admin` reports to `super_admin`. When no
  closer manager exists, resolution falls back **up** the chain (so a lone role still gets
  the CEO as its manager).
- `utils/orgChart.js` walks that chain to find a real active manager user.
- When creating a user without an explicit manager, `userController` auto-resolves one.
  The Add-User form pre-fills it via `GET /api/users/suggest-manager?role=…` and **never
  forces it** — top roles don't even show the field. This fixes the old "why must I assign a
  manager to a manager?" friction.
- The direct manager drives the **HR leave-approval chain** (request → manager → HR).

### Editable reference lists (lookups) & inline "+ Add" — *NEW*
Every **descriptive dropdown** in the system (procurement categories, vendor categories,
CRM industries, lead sources, company types, company sizes …) is now **data, not code** —
editable by the right people, with no developer involvement.

- **One generic collection** backs them all: `models/Lookup.js` rows are
  `{ type, key, nameEn, nameAr, color, order, isActive, isSystem }`. The `type`
  (e.g. `procurement_category`, `crm_industry`) is registered in `config/lookupTypes.js`,
  which also declares each list's owning **module**, the **roles** allowed to edit it, and the
  **default rows** seeded once on boot (`ensureDefaultLookups`, idempotent).
- **One API** serves all of them: `GET /api/lookups?type=…` (read — open to any authed user
  so dropdowns work everywhere), `POST/PUT/DELETE /api/lookups` (write — per-type permission
  enforced from the registry), `GET /api/lookups/types` (registry metadata + `canManage`).
- **One management screen:** **Admin → Reference Data** (`/system/settings/reference-data`)
  lists every type grouped by module and lets authorised roles add / edit / activate / delete
  items. Seeded **defaults** are protected from deletion (deactivate instead) so a key a
  workflow relies on can never silently vanish.
- **Inline "+ Add" in any dropdown:** `components/system/ManagedSelect.tsx` is a drop-in
  `<select>` that fetches its own options for a `type` and shows a **"+ Add new"** form
  underneath — the new item is saved to its lookup list and selected immediately, without
  leaving the form. `components/system/VendorSelect.tsx` does the same for **vendors**
  (a real entity, `POST /api/vendors`).
- **Stored values are unchanged:** documents still store the `key` string (or, for vendors,
  the `ObjectId`); the lookup only governs which options appear, so this is fully backward
  compatible. Module `options` endpoints (`/api/procurement/options`, `/api/crm/options`)
  now serve these lists from `Lookup` with a fallback to the static config.
- **Deliberately *not* lookups:** workflow-critical enums — request/order/bill **statuses**,
  CRM **pipeline stages**, account **types** — stay in code (`config/*Defaults.js`) because
  business logic branches on their exact keys. Making those user-editable would break flows.

> Add a new editable dropdown anywhere by (1) adding one entry to `config/lookupTypes.js`
> and (2) pointing a `<ManagedSelect type="…">` at it — **no new model/controller/route.**

---

## 4. Roles & per-role workflow

> Assign roles in **Admin → Users** (super_admin only). Each login can be linked to an HR
> **Employee profile** (for payroll/leave/custody) and, for managers, a **direct manager**.

| Role | Lands on | Sees (sections) | Manager | Notes |
|---|---|---|---|---|
| **super_admin** (CEO/COO) | Dashboard | **Everything** + KPIs + Users/Admin | — | Full control, only role that manages users |
| **admin** | Dashboard | Everything except user *creation* gating | super_admin | Department-spanning manager |
| **moderator** | Dashboard | Main, Customers, Operations, KPIs | admin | Oversight/read-heavy |
| **employee** | Dashboard | Customers & Finance (collections), Tasks, Self-Service | admin | Collections officer |
| **operations_manager** | Operations | Operations, drivers, vendors, wallet, vehicle analytics | admin | Branch ops |
| **operations** | Operations | Operations, drivers, vendors, wallet | operations_manager | Branch-scoped |
| **workshop_manager** | Workshop dashboard | Workshop (all), inventory, maintenance types | admin | |
| **workshop_employee** | Workshop | Workshop, workshop tasks, dashboard | workshop_manager | |
| **purchasing** | Workshop purchases | Workshop purchases, inventory | workshop_manager | |
| **b2c_head** | B2C dashboard | B2C (all) | admin | Owns all B2C projects |
| **b2c_project_manager** | B2C dashboard | B2C (assigned projects) | b2c_head | |
| **hr_manager** | HR dashboard | HR back-office (all) + Self-Service | admin | |
| **hr_specialist** | HR dashboard | HR back-office + Self-Service | hr_manager | |
| **crm_manager** | CRM dashboard | CRM (all, incl. delete) | admin | |
| **crm_specialist** | CRM dashboard | CRM (no delete) | crm_manager | |
| **finance_manager** *(new)* | Accounting | Accounting (all, incl. delete/journal) | admin | |
| **accountant** *(new)* | Accounting | Accounting (CRUD, no delete) | finance_manager | |
| **sales_manager** *(new)* | Sales | Sales (all, sets targets) | admin | |
| **sales_rep** *(new)* | Sales | Sales (own pipeline/performance) | sales_manager | |
| **procurement_manager** *(new)* | Procurement | Procurement (all, approves/deletes) | admin | |
| **purchasing** | Workshop purchases | Workshop purchases + **Procurement** (officer) | workshop_manager | Reused for procurement |
| **remote_manager** | Remote dashboard | Remote (all) | admin | Work-from-home team |
| **remote_employee** | Remote attendance | Remote pages in `remoteAccess` + Self-Service | remote_manager | Granular per-page access |
| **client** | Portal | Client portal (own invoices/payments) | — | External customer login |

**Self-Service (every internal role):** My Profile, My Leaves, My Requests under HR — each
employee files leave (routed to their manager then HR) and HR requests.

---

## 5. Modules

### Customers & Finance (B2B core)
Customers, invoices, payments, collections, collectors, disputes, credit alerts, overdue,
daily wallet (cash/expense/purchase per branch). The financial backbone the Accounting
module reads from.

### Operations
Operations workflows (draft → ops → collections → completed), dispatch sheets, drivers,
vendors, wallet, and vehicle analytics (fuel, GPS, trips, uploads).

### Workshop
Maintenance requests, workshop tasks, inventory, purchase requests, maintenance types.

### B2C
Sales-rep daily-order tracking, project/branch/rep management, Excel + Google-Sheet sync,
performance dashboards and rep evaluation.

### Remote (work-from-home)
Attendance, leave, chat, tasks, reports, announcements — with per-page grants via
`User.remoteAccess`.

### HR
Employees, contracts, leave requests (manager → HR approval), employee requests, asset
custody, leave types, plus the org-wide Self-Service pages. Progressive leave-balance
accrual in `utils/leaveBalance.js`.

### CRM
Companies (with **0–5 star rating** + **WhatsApp / call / email / website** quick-action
icons via `wa.me` / `tel:` / `mailto:`), contacts, activities (call/meeting/email/whatsapp/
visit/note), tasks, a **drag-and-drop deal pipeline**, and a calendar. **Hybrid**: a CRM
company can optionally link to an existing logistics `Customer`. API under `/api/crm`.

### Sales *(new)*
Built **on top of CRM deals** (deal owner = the rep). Monthly **targets** per rep/team,
**performance** (won vs target with attainment %), a read-only **pipeline** view, and a
dashboard (won value, win rate, top reps). API under `/api/sales`.

### Accounting *(new)*
Full **double-entry** accounting:
- **Chart of Accounts** (asset/liability/equity/revenue/expense; defaults auto-seeded).
- **Journal** — balanced manual entries (debits must equal credits) + **auto-posting**.
- **Auto-posting engine** (`POST /api/accounting/sync`, idempotent): scans existing
  **invoices** (Dr A/R, Cr Sales), **payments** (Dr Cash, Cr A/R) and **wallet
  transactions** (collection / expense / purchase) and posts a journal entry per document,
  keyed by source so re-running never duplicates.
- **Reports:** general ledger per account, **trial balance**, **profit & loss**, and
  **receivables (A/R aging)** straight from open invoices. API under `/api/accounting`.

### Procurement *(new)*
Full purchase-to-pay cycle: **Purchase Request** (with line items, justification, priority)
→ **approval** (manager) → **Purchase Order** (vendor, Saudi 15% VAT) → **Receive** →
**Vendor Bill** (accounts payable). Creating a vendor bill **auto-posts** a balanced journal
entry to Accounting (Dr Expense + Dr VAT, Cr A/P); recording a payment posts Dr A/P, Cr Cash;
deleting a bill reverses its entries. The **Payables (A/P aging)** report under Accounting reads
the open vendor bills. Reuses the existing `purchasing` role and adds `procurement_manager`.
API under `/api/procurement`; shared poster in `utils/accountingPoster.js`.
**Vendors** are a first-class entity (`models/Vendor.js`) managed under **Operations →
Vendors** — now reachable by `procurement_manager` / `purchasing` too — and can also be
created inline straight from any procurement form via the vendor dropdown's **"+ Add"**.
Purchase categories are editable [reference lists](#editable-reference-lists-lookups--inline-add).

### KPIs *(new, leadership)*
`/system/kpis` — one executive board pulling a headline number from **every** module
(finance P&L + A/R, CRM/sales pipeline + won, customers, HR headcount + pending leaves,
B2C orders, open operations) via `GET /api/kpi/overview`. Each card links to its module.

---

## 6. How the modules link together

```
Customer (B2B) ──┬─ Invoices ─ Payments ─ Collections ─ Wallet ──┐
                 │                                                ├──► Accounting (auto-posted journal → ledger → P&L / Trial Balance / A/R + A/P aging)
CRM Company ─────┘ (optional link: CrmCompany.linkedCustomer)     │
Vendor ── Procurement (PR → PO → Vendor Bill) ───────────────────┤  (auto-posts A/P)
   │                                                              │
   ├─ Contacts / Activities / Tasks / Calendar                   │
   └─ Deals (owner = user) ──► Sales (targets, performance, pipeline)
                                                                  │
User ──(linkedEmployee)──► HR Employee ── Contracts / Leave / Custody
User ──(manager, via ROLE_HIERARCHY)──► leave-approval chain
                                                                  │
All of the above ───────────────────────────────────────────────┴──► KPIs (executive overview)
```

- **CRM ↔ Sales:** Sales reads `CrmDeal` directly; a deal's `owner` is the sales rep, and
  `wonAt`/`value` feed targets & performance. No data duplication.
- **Finance ↔ Accounting:** Accounting never re-enters data — it posts journals *from*
  invoices/payments/wallet, so the ledger always reflects operational reality.
- **Users ↔ HR:** every login can map to one Employee profile (two-way link kept exclusive
  by `userController.syncEmployeeLink`).
- **Everything ↔ KPIs:** the KPI controller aggregates across modules read-only.

---

## 7. Operational scripts

### Backfill employee profiles
Create an HR Employee profile for every login user that doesn't have one (placeholder data
you edit later), linked two-way. **Idempotent**, skips clients and already-linked users.

```bash
cd backend
node src/scripts/backfillEmployeeProfiles.js --dry   # preview, writes nothing
node src/scripts/backfillEmployeeProfiles.js          # apply
```
After running, open **HR → Employees** to replace the placeholder data (salary, iqama, hire
date, etc.) with the real values.

---

## 8. Conventions (for contributors)

- **Models:** Mongoose, `{ timestamps: true }`, refs by `ObjectId`, dates that are
  user-entered day values stored as `YYYY-MM-DD` strings; indexes on common query paths.
- **Controllers:** `exports.fn = async (req,res) => { try/catch }`, role guard first,
  `{ entity }` / `{ entities }` response shapes, `console.error('<fn> error:', e)` on failure,
  emit a socket event after each mutation.
- **Routes:** `router.use(authenticate)` then `authorize(...ROLES)`; list/​create/​update/​
  delete + verb-style actions (`/sync`, `/:id/move`, `/:id/rate`).
- **Frontend pages:** `'use client'`, guard with the section's `isXStaff(user.role)`, load
  via `api.get`, refresh via `useSocket`, render with the shared kits
  (`components/hr/HRKit.tsx`, `components/crm/CrmKit.tsx`), bilingual via
  `getXTranslations(lang)` and `dir={isRTL ? 'rtl' : 'ltr'}`.
- **Adding a role:** update the 7 touchpoints listed in §3 (Authorization).
- **Adding a section:** model(s) → controller → route (mount in `server.js`) → frontend
  `lib/*.ts` + pages under `app/system/<section>/` → nav item + translations + roleRoutes.
- **Adding an editable dropdown:** add a `type` entry (with seed rows + allowed roles) to
  `config/lookupTypes.js`, then render `<ManagedSelect type="…">` in the form. It auto-appears
  in **Admin → Reference Data**. Do **not** convert workflow-gating enums (statuses, stages).

---

## 9. Build / verify

```bash
# backend — syntax + module load
cd backend && node --check src/server.js

# frontend — type check (build ignores TS/ESLint per next.config, but keep new code clean)
cd frontend && npx tsc --noEmit
```
