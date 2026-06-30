# Energize Logistics — Full Rebuild Specification (مواصفات إعادة البناء الكاملة)

> **الغرض / Purpose:** هذا المستند مرجع تنفيذي 100% لإعادة بناء وحدات النظام التالية في مشروع جديد من الصفر، طبق الأصل + قابل للتوسعة:
> HR + الإجازات + الطلبات، الخدمة الذاتية (Self-Service)، CRM، المركبات والتفاويض، المشتريات + المخزن، المبيعات.
> This is an implementation-grade spec to rebuild these modules identically (and extend them) in a brand-new system.
>
> **كيف تستخدمه مع Claude Code / How to use:** أعطِ Claude Code هذا الملف وقُل: "ابنِ النظام ده بالظبط زي ما هو موصوف، موديول موديول، بنفس الـ models والـ endpoints والـ roles والـ workflows." ابدأ بقسم **§2 الأساسات** لأن كل الموديولز تعتمد عليه، ثم ابنِ كل موديول بالترتيب في **§10 ترتيب البناء**.
>
> **اللغة / Language:** الشرح والآليات (workflows) بالعربي + الإنجليزي. أسماء الحقول والـ enums والـ endpoints تبقى بالإنجليزي لأنها معرّفات كود (code identifiers) لا تُترجم.

---

## §0 — Tech Stack & Architecture (التقنيات والمعمارية)

**Backend:** Node.js + Express 4 + MongoDB (Mongoose 8) + Socket.io 4 + JWT (HTTP-only cookies).
- Helmet, CORS (`credentials:true`), express-mongo-sanitize, cookie-parser, morgan, express-rate-limit, express-validator, bcryptjs, xlsx, pdfkit, node-cron, dotenv.

**Frontend:** Next.js 15 (App Router) + React 19 + TypeScript + Tailwind CSS 3 + Framer Motion + socket.io-client + recharts + lucide-react + xlsx.

**المعمارية / Architecture:**
- `backend/src/` → `models/` (Mongoose), `controllers/`, `routes/`, `config/`, `middleware/`, `utils/`, `services/`, `websocket/`, `scripts/`, `seeds/`, `jobs/`.
- `frontend/src/` → `app/system/*` (pages), `components/`, `lib/` (types + helpers + bilingual dicts), `context/` (AuthContext), `hooks/` (useSocket).
- **API proxy:** Next.js `rewrites()` يحوّل `/api/:path*` و `/socket.io/:path*` للباك إند → يخلّي كوكيز الجلسة **first-party** (مهم لـ Safari/iOS). SSR يستخدم `NEXT_PUBLIC_API_URL` مباشرة.
- **ثنائية اللغة:** قاموس مخصص EN/AR + RTL كامل. كل enum له `nameEn`/`nameAr`، وكل status style له `{ bg, text, en, ar }`.
- **بيانات الإقلاع:** عند أول تشغيل النظام يزرع (idempotent): super_admin، أنواع الإجازات، شجرة الحسابات، القوائم المرجعية (Lookups).

**Ports / تشغيل محلي:** Backend `npm run dev` (default `5001`)، Frontend `npm run dev` (`3000`).

---

## §1 — Conventions used throughout (اصطلاحات متكررة)

كل موديول يتبع نفس النمط (اتبعه عند البناء والتوسعة):
1. **Realtime:** كل عملية كتابة (create/update/delete) تبثّ حدث socket (`module:entity`) والصفحات تشترك عبر `useSocket(event, reloadCallback)` وتعيد الجلب.
2. **Audit:** العمليات الحساسة تنادي `logAudit({ user, action, entity, entityId, changes:{before,after}, ipAddress })` (fire-and-forget).
3. **Notifications:** `Notification.create(...)` + `emitToUser(userId,'notification:new',...)`.
4. **Whitelisting:** الـ controllers تعمل `pick()` لحقول محددة فقط من الـ body (مفيش mass-assignment).
5. **Money rounding:** `round2(n)=Math.round(n*100)/100`.
6. **Sequence numbers:** `PREFIX-000001` عبر `estimatedDocumentCount()+1` (PR-, PO-, BILL-, JE-, CC-).
7. **Bilingual labels:** كل قيمة معروضة لها EN/AR. **منطق العمل لا يتفرّع إلا على الـ key** (الإنجليزي الثابت).
8. **روتس الـ collection قبل روتس `/:id`** في ملف الـ routes (مهم لتفادي تضارب المطابقة).

---

## §2 — FOUNDATIONS (الأساسات — كل الموديولز تعتمد عليها)

> ابنِ هذا القسم **أولاً**. كل موديول بعده يفترض وجود: User model + Auth + RBAC + Roles + Org chart + Realtime + Notifications + Audit + Lookups.

### 2.1 Authentication & Sessions (المصادقة والجلسات)

**الآلية بالعربي:** تسجيل الدخول يصدر **access token (15 دقيقة)** + **refresh token (7 أيام)** في كوكيز HTTP-only. عميل الـ API في الفرونت إند يجدّد التوكن تلقائياً عند أي استجابة 401 ويعيد الطلب الأصلي. الوسيط `authenticate` يتحقق من التوكن، يكاش المستخدم 30 ثانية لتقليل ضغط DB، ويرفض الحساب المعطّل/المقفول.

**JWT (`controllers/authController.js`):**
- Access: payload `{ userId, role }`, expiry `15m` (`JWT_ACCESS_SECRET`).
- Refresh: payload `{ userId }`, expiry `7d` (`JWT_REFRESH_SECRET`), مخزّن في `User.refreshToken` (select:false) للتحقق.
- Hashing: bcryptjs 12 rounds.

**Cookie options (`config/constants.js`):** `{ httpOnly:true, secure:!isLocalDev, sameSite:isLocalDev?'lax':'none', path:'/' }`.

**Endpoints (`routes/auth.js`):**
| METHOD | path | auth | body | behavior |
|---|---|---|---|---|
| POST | `/api/auth/login` | rate-limited (20/15min) | `{ email, password }` | يتحقق active/locked + bcrypt، يضبط `lastLogin`+`refreshToken`، يصدر الكوكيز، يرجّع `{ user:{_id,email,firstName,lastName,role} }` |
| POST | `/api/auth/refresh` | none | — | يتحقق refresh + يطابق المخزن، يصدر access جديد، يمدّد refresh |
| POST | `/api/auth/logout` | required | — | يمسح `refreshToken`+الكوكيز، invalidate cache |
| GET | `/api/auth/me` | required | — | يرجّع المستخدم + populate (`linkedCustomer`,`assignedCustomers`,`manager`,`linkedEmployee`)؛ side-effect: `ensureSelfEmployee()` |
| POST | `/api/auth/change-password` | required | `{ currentPassword, newPassword(min6) }` | يتحقق ثم يهَش الجديد |

**Frontend:** `context/AuthContext.tsx` (`user`,`loading`,`login`,`logout`,`refreshUser`,`isAuthenticated`,`loginKey`)؛ `lib/api.ts` ApiClient (`credentials:'include'`, timeout 45s, auto-refresh queue على 401 — مع استثناء مسارات `/api/auth/*`)؛ `next.config` rewrites لـ `/api/*` و `/socket.io/*`.

### 2.2 RBAC & Roles (الصلاحيات والأدوار)

**الوسيط:** `middleware/rbac.js` → `authorize(...roles)` يرجّع 401 لو مفيش user، 403 لو الدور مش ضمن المسموح.

**كل الأدوار (`models/User.js` enum):**
`super_admin, admin, employee, operations_manager, operations, moderator, client, workshop_manager, workshop_employee, purchasing, b2c_head, b2c_project_manager, remote_employee, remote_manager, hr_manager, hr_specialist, crm_manager, crm_team_lead, crm_specialist, crm_agent, finance_manager, accountant, sales_manager, sales_rep, procurement_manager, customs_manager, customs_officer`.

**مجموعات الأدوار (`config/constants.js`):**
```
FINANCE_STAFF_ROLES   = [super_admin, admin, finance_manager, accountant]
SALES_STAFF_ROLES     = [super_admin, admin, sales_manager, sales_rep]
SALES_ADMIN_ROLES     = [super_admin, admin, sales_manager]
PROCUREMENT_STAFF_ROLES = [super_admin, admin, procurement_manager, purchasing]
HR_STAFF_ROLES        = [super_admin, admin, hr_manager, hr_specialist]
CRM_STAFF_ROLES       = [super_admin, admin, crm_manager, crm_team_lead, crm_specialist, crm_agent]
CRM_ADMIN_ROLES       = [super_admin, admin, crm_manager, crm_team_lead]
VEHICLE_STAFF_ROLES   = [super_admin, admin, hr_manager, hr_specialist, finance_manager, accountant]
VEHICLE_ADMIN_ROLES   = [super_admin, admin, hr_manager, finance_manager]
REMOTE_PAGES          = [attendance, dashboard, leave, chat, tasks, report, announcements]
```

**Org chart / المدير (`ROLE_HIERARCHY` = role→دور المدير الافتراضي):**
```
super_admin:null, admin:super_admin, moderator:admin, employee:admin,
operations_manager:admin, operations:operations_manager,
workshop_manager:admin, workshop_employee:workshop_manager, purchasing:workshop_manager,
b2c_head:admin, b2c_project_manager:b2c_head,
hr_manager:admin, hr_specialist:hr_manager,
crm_manager:admin, crm_team_lead:crm_manager, crm_specialist:crm_team_lead, crm_agent:crm_team_lead,
finance_manager:admin, accountant:finance_manager,
sales_manager:admin, sales_rep:sales_manager,
procurement_manager:admin, remote_manager:admin, remote_employee:remote_manager,
customs_manager:admin, customs_officer:customs_manager, client:null
```
**`utils/orgChart.js`:** `managerRoleChain(role)` يمشي لأعلى في الـ hierarchy؛ `resolveDefaultManager(role)` يجيب أول مستخدم active بدور في السلسلة. عند إنشاء مستخدم بدون مدير → يُحلّ تلقائياً. `GET /api/users/suggest-manager?role=` يغذّي الاقتراح في فورم إضافة المستخدم. **المدير المباشر يقود سلسلة اعتماد الإجازات.**

**Frontend:** `lib/roleRoutes.ts` = خريطة دور→صفحة هبوط (مثال: hr_*→`/system/hr/dashboard`, crm_*→`/system/crm/dashboard`, sales_*→`/system/sales/dashboard`, procurement_manager→`/system/procurement/dashboard`, remote_employee→`/system/remote/attendance`, client→`/system/portal`). `app/system/layout.tsx` يفلتر عناصر النفجيشن بـ `roles.includes(user.role)`، و `remote_employee` يرى فقط الصفحات في `remoteAccess`.

> **عند إضافة دور جديد لازم تحدّثه في 7 مواضع:** (1) `User` enum (2) تحقق `routes/users.js` (3) `constants.js` (مجموعات + hierarchy) (4) AuthContext type (5) `roleRoutes.ts` (6) نفجيشن `layout.tsx` (7) تسميات الترجمة + قائمة أدوار صفحة users.

### 2.3 User model (`models/User.js`)
```
email(unique,lowercase,required), password(min8,select:false,bcrypt),
firstName(required), lastName(required), role(enum أعلاه, required),
remoteAccess:[String] (subset REMOTE_PAGES),
branch→Branch, assignedCustomers:[→Customer], linkedCustomer→Customer (لدور client),
assignedProjects:[→B2CProject], assignedBranches:[→Branch],
manager→User (المدير المباشر), linkedEmployee→Employee (ربط ملف HR),
isActive(true), isLocked(false), lastLogin, refreshToken(select:false),
collectionTarget(0), timestamps
```
Indexes: `{role}`, `{isActive,role}`, `{branch}`.

### 2.4 Realtime (`websocket/socketManager.js`)
- `initializeSocket(server)`: Socket.io مع CORS `credentials:true`، middleware يقرأ `accessToken` من الكوكي ويتحقق JWT → `socket.userId`,`socket.userRole`.
- عند الاتصال: `socket.join('user:'+userId)`. غرف إضافية: `dashboard:<role>`, `customer:<id>`, `workflows`.
- **Helpers:** `emitToAll(event,data)`, `emitToUser(userId,event,data)`, `emitToDashboard(role,...)`, `emitToCustomer(customerId,...)`.
- **Frontend:** `lib/socket.ts` (`getSocket`,`connectSocket`,`disconnectSocket`؛ transports `['polling','websocket']`, `withCredentials:true`) + `hooks/useSocket.ts` (`useSocket(event,cb)`، `useRealTimeRefresh(events[],refetch)`).

### 2.5 Notifications (`models/Notification.js`)
```
recipient→User(required), type(enum: invoice_due_soon, invoice_overdue, payment_received,
  risk_updated, dispute_opened, dispute_resolved, credit_term_changed, follow_up_reminder, system_alert),
title(required), message(required), relatedEntity(String), relatedEntityId(ObjectId),
isRead(false), readAt, createdAt
```
Endpoints (`routes/notifications.js`, all auth): `GET /api/notifications?unreadOnly&page&limit` → `{notifications,total,unreadCount,page}`؛ `PUT /:id/read`؛ `PUT /read-all`. النمط: `Notification.create(...)` ثم `emitToUser(userId,'notification:new',...)`.

### 2.6 Audit (`models/AuditLog.js` + `utils/auditLogger.js`)
```
user→User(required), action(String), entity(String), entityId(ObjectId),
changes:{ before:Mixed, after:Mixed }, ipAddress(String), createdAt
```
Indexes: `{entity,entityId}`, `{user}`, `{createdAt:-1}`. Helper: `logAudit({user,action,entity,entityId,changes,ipAddress})` (try/catch، لا يكسر الطلب). Endpoint: `GET /api/audit` (super_admin/admin) فلاتر `entity,action,user,dateFrom,dateTo,page,limit`.

### 2.7 Lookups — قوائم مرجعية قابلة للتعديل (`models/Lookup.js`)
**الفكرة:** مجموعة واحدة عامة تخدم كل قائمة منسدلة **وصفية** (فئات مشتريات/موردين، صناعات/مصادر/أنواع/أحجام شركات CRM…). **الحالات و pipeline stages وأنواع الحسابات تبقى في الكود** لأن المنطق يتفرّع عليها.
```
type(required,indexed), key(required,slug ثابت), nameEn(required), nameAr(required),
color, order(0), isActive(true), isSystem(false=محمي من الحذف), createdBy→User, timestamps
```
Index فريد `{type,key}`. **Registry (`config/lookupTypes.js`):** كل type يعرّف `{type,module,nameEn,nameAr,roles[],seed[]}`. الأنواع المزروعة: `procurement_category, vendor_category, crm_industry, crm_source, crm_company_type, crm_company_size`. `BASE_WRITE_ROLES=[super_admin,admin]` دائماً. Helpers: `byType, writeRolesFor, canManage, typesForRole, ensureDefaultLookups, activeByType`.
**Endpoints (`routes/lookups.js`, auth):** `GET /types`؛ `GET /?type=&active=`؛ `POST /` (يولّد key من slugify)؛ `PUT /:id` (key غير قابل للتعديل)؛ `DELETE /:id` (يرفض حذف isSystem → عطّله بدل حذفه). كله يبثّ `lookup:changed`.
**Frontend:** `components/system/ManagedSelect.tsx` (dropdown + زر «+ إضافة» inline)، `components/system/VendorSelect.tsx` (كيان مورد حقيقي عبر `POST /api/vendors`)، صفحة إدارة `app/system/settings/reference-data`.

### 2.8 Server bootstrap (`server.js`)
ترتيب الـ middleware: dotenv → helmet → cors(credentials) → mongoSanitize → `express.json({limit:'25mb'})` → urlencoded(25mb) → cookieParser → `express.static('/api/uploads',...)` (قبل الـ rate limiter) → morgan → generalLimiter على `/api/` (يتخطى `/api/auth/refresh`,`/api/health`).
**Mounts:** `/api/auth, /api/users, /api/hr, /api/crm, /api/sales, /api/procurement, /api/vehicles, /api/vendors, /api/workshop, /api/remote, /api/lookups, /api/accounting, /api/notifications, /api/audit, /api/customers, /api/invoices, /api/payments, /api/analytics …`.
**Auto-seed عند الإقلاع (idempotent):** `autoSeedAdmin()` (super_admin من env)، `ensureDefaultLeaveTypes()`، `ensureDefaultAccounts()`، `ensureDefaultLookups()`.
**Env المطلوبة:** `JWT_ACCESS_SECRET, JWT_REFRESH_SECRET, MONGODB_URI, PORT, NODE_ENV, FRONTEND_URL, SEED_ADMIN_EMAIL/PASSWORD/FIRST_NAME/LAST_NAME, NEXT_PUBLIC_API_URL`.

---

## §3 — HR + Leaves + Requests + Custody (الموارد البشرية والإجازات والطلبات والعُهد)

**نطاق الموديول بالعربي:** ملفات الموظفين (HR-sheet سعودي كامل) + العقود + طلبات الإجازة بسلسلة اعتماد (المدير ← HR) + احتساب رصيد تدريجي + طلبات الموظفين (thread) + عُهد الأصول + المستندات (رفع base64) + التجديدات + سجل التدقيق + داشبورد بتنبيهات انتهاء الوثائق. الأدوار: `HR_STAFF_ROLES`. الحذف: `super_admin, hr_manager`. Mount: `/api/hr`. Realtime prefix: `hr:*`.

### 3.1 Models

**`Employee` (collection `employees`)** — كل الحقول (كلها optional إلا firstName/lastName):
- *Identity:* `firstName*`, `lastName*`, `arabicName`, `employeeNumber`, `gender(male|female|'')='`, `dateOfBirth(YYYY-MM-DD)`, `nationality`, `photo`.
- *Saudi ID:* `idType(iqama|national_id)=iqama`, `iqamaNumber`, `iqamaExpiry`, `nationalId`, `passportNumber`, `passportExpiry`.
- *Government:* `qiwaContractNumber`, `gosiNumber`, `absherStatus`, `sponsorName`, `workPermitExpiry`.
- *Job:* `jobTitle`, `department`, `hireDate`, `workLocation`, `branch→Branch`, `employmentStatus(active|on_leave|suspended|terminated)=active`, `terminatedAt(Date)`, `terminationReason`.
- *Contact:* `phone`, `email`, `address`, `emergencyContactName`, `emergencyContactPhone`.
- *Compensation:* `basicSalary(0)`, `allowances(0)` (العقد هو المصدر الرسمي).
- *Banking/HR-sheet:* `iban`, `bank`, `fileStatus`, `absherNumber`, `companyNumber`, `originCountryNumber`, `project`, `registerNumber`, `systemStatus`, `workStatusText`, `penaltyClause(0)`, `iqamaProfession`, `classification`.
- *Insurance:* `insuranceCompany`, `insuranceExpiry`, `socialInsuranceStatus`.
- *Visa/Travel:* `visaExpiry`, `lastTravelDate`, `lastReturnDate`.
- *Driving:* `vehiclePlate`(denormalized؛ المصدر الرسمي VehicleAuthorization), `licenseNumber`, `licenseType`, `licenseExpiry`, `driverCardNumber`, `driverCardType`, `driverCardStatus`, `driverCardExpiry`, `workCard`, `ajeerStatus`, `ajeerExpiry`.
- *Links:* `user→User`(اختياري two-way مع `User.linkedEmployee`), `directManager→User`, `notes`, `createdBy→User`, timestamps.
- Indexes: `(firstName,lastName)`, `iqamaNumber`, `nationalId`, `employeeNumber`, `employmentStatus`, `user`, `directManager`, `vehiclePlate`.

**`Contract` (`contracts`):** `employee*→Employee`, `type(fixed|unlimited)=fixed`, `startDate*`, `endDate`, `durationMonths(12)`, `annualLeaveDays*(21)` (يقود احتساب الرصيد), `jobTitle`, `basicSalary(0)`, `allowances(0)`, `probationMonths(3)`, `status(active|expired|terminated)=active`, `terminatedAt`, `terminationReason`, `custodyReturned(false)`, `notes`, `createdBy`. Indexes `(employee,status)`,`status`,`endDate`. **قاعدة:** عقد active واحد فقط لكل موظف (إنشاء جديد يُنهي القديم)؛ الإنهاء **محظور** طالما فيه Asset `status:'assigned'` (بوابة العُهدة).

**`LeaveType` (`leavetypes`):** `code*(unique,lowercase)`, `nameEn*`, `nameAr*`, `paid(true)`, `affectsBalance(true)` (هل يخصم من الرصيد المتراكم), `color('#f37121')`, `active(true)`, `createdBy`. **المزروعة افتراضياً (10):** annual(paid,affects), sick(paid), emergency(paid,affects), unpaid(unpaid), hajj, marriage, maternity, paternity, bereavement, exam — كلها paid عدا unpaid، و affectsBalance=true فقط لـ annual+emergency.

**`LeaveRequest` (`leaverequests`):** `employee*`, `requester*→User`, `manager→User`(نسخة من مدير الطالب وقت الإنشاء), `leaveType*→LeaveType`, `leaveTypeCode`, `startDate*`, `endDate*`, `days*`, `reason`, `status(pending_manager|pending_hr|approved|rejected|cancelled)=pending_manager`, `currentStage(manager|hr|done)=manager`, `managerDecision:{by→User,at,decision(approved|rejected),note}`, `hrDecision:{...}`, `balanceSnapshot:{accrued,requested,remainingAfter}`. Indexes `(employee,createdAt-1)`,`(requester,createdAt-1)`,`(manager,status)`,`status`.

**`HRRequest` (`hrrequests`):** `requester*→User`, `employee→Employee`, `manager→User`, `category(salary_certificate|letter|document|data_update|complaint|other)=other`, `subject*`, `thread:[{sender→User, body, link, at=now, _id}]`, `status(open|in_progress|received|resolved|closed)=open`, `assignedTo→User`, `readByRequester(true)`, `readByHR(false)`.

**`Asset` (`assets`):** `employee*`, `name*`, `type(laptop|phone|sim|vehicle|tool|access_card|other)=other`, `serialNumber`, `brand`, `model`, `condition(new|good|fair|damaged)=good`, `value(0)`, `assignedDate`, `status(assigned|returned)=assigned`, `returnedDate`, `returnedCondition`, `returnedTo→User`, `notes`, `createdBy`.

**`EmployeeDocument` (`employeedocuments`):** `employee*`, `title*`, `category('other')`, `fileUrl*`(`/api/uploads/employees/..`), `fileName`, `mimeType`, `size(0)`, `expiryDate`, `notes`, `uploadedBy→User`.

**`EmployeeRenewal` (`employeerenewals`):** `employee*`, `docType*(iqama|passport|workPermit|insurance|visa|license|driverCard|ajeer|other)`, `previousExpiry`, `newExpiry`, `documentNumber`, `notes`, `renewedBy→User`, `renewedAt(now)`.

### 3.2 File uploads بدون multer (`utils/fileStore.js`)
الفرونت يقرأ الملف بـ `FileReader.readAsDataURL` ويبعت base64 data URL كـ JSON. الباك يفكّ الترميز ويكتب في `backend/uploads/employees/<timestamp>-<random>.<ext>`. يُخدَم عبر `app.use('/api/uploads', express.static(...))` (قبل الـ rate limiter). حد `express.json` مرفوع 25mb. الملفات gitignored. MIME المسموح: JPEG/PNG/WebP/GIF/HEIC/PDF/Word/Excel، ≤20MB.

### 3.3 Endpoints (`routes/hr.js`)

**Self-service (أي مستخدم authenticated، ماعدا client):**
| METHOD | path | behavior |
|---|---|---|
| GET | `/api/hr/me/profile` | ملف المستخدم المرتبط + contracts + activeContract + balance + leaves + assets (lazy `ensureSelfEmployee`) |
| GET | `/api/hr/me/team` | `{hasTeam,teamCount,team}` (المرؤوسون المباشرون) |
| GET | `/api/hr/me/leaves` | إجازاتي + الرصيد الحي |
| POST | `/api/hr/me/leaves` | `{leaveType,startDate,endDate,reason?}` → ينشئ طلب، يحسب days+balanceSnapshot، status=pending_manager (لو فيه مدير) وإلا pending_hr، يخطر المدير/HR |
| PATCH | `/api/hr/me/leaves/:id/cancel` | يلغي طلب pending للطالب نفسه فقط |
| GET/POST | `/api/hr/me/requests` | طلباتي / إنشاء طلب thread (يخطر HR) |
| GET | `/api/hr/team/leaves` | طلبات المرؤوسين المنتظرة قرار هذا المدير |
| PATCH | `/api/hr/leaves/:id/decision` | `{decision,note?}` المدير: approve→pending_hr / reject→rejected؛ HR: نهائي approved/rejected |
| POST | `/api/hr/requests/:id/reply` | `{body?,link?}` يضيف للـ thread + يقلب أعلام القراءة + open→in_progress |
| GET | `/api/hr/leave-types` | HR يرى الكل، غيرهم active فقط |
| GET | `/api/hr/employees/:id` | الملف الكامل (self إن كان صاحبه، أو HR staff) + documents+renewals |

**HR back-office (HR_STAFF_ROLES):**
- `GET /api/hr/dashboard` — مقاييس (انظر 3.5).
- `GET /api/hr/options` — managers + branches للدروب داون.
- `GET /api/hr/employees?q=&status=` — بحث (name/iqama/nationalId/employeeNumber/phone/email/jobTitle) max2000.
- `GET /api/hr/employees-search?q=` — بحث خفيف لربط مستخدم (max25).
- `POST /api/hr/employees`؛ `PUT /api/hr/employees/:id` (يسجّل diff)؛ `DELETE /api/hr/employees/:id` (super_admin/hr_manager — يفصل الـ User، يحذف المستندات والتجديدات).
- `POST /api/hr/employees/:id/renew` — `{docType,newExpiry,documentNumber?,notes?}` يحدّث حقول الموظف عبر `RENEWAL_FIELDS` + ينشئ EmployeeRenewal + audit.
- `POST /api/hr/employees/:id/terminate` — **بوابة عُهدة** (400 `CUSTODY_OUTSTANDING` لو فيه أصل assigned)، يضبط terminated + يُنهي العقد.
- `POST /api/hr/employees/:id/reactivate`؛ `GET /api/hr/employees/:id/audit`.
- المستندات: `GET/POST /api/hr/employees/:id/documents`، `PUT/DELETE /api/hr/documents/:docId`.
- العقود: `GET/POST /api/hr/contracts`, `PUT /api/hr/contracts/:id`, `POST /api/hr/contracts/:id/terminate` (نفس بوابة العُهدة), `DELETE`.
- أنواع الإجازات: `POST/PUT/DELETE /api/hr/leave-types[/:id]`.
- `GET /api/hr/leaves?status=&employee=` (سلسلة الاعتماد الكاملة)؛ `GET /api/hr/requests?status=`، `PATCH /api/hr/requests/:id/status`.
- العُهد: `GET/POST /api/hr/assets`, `PUT /api/hr/assets/:id`, `POST /api/hr/assets/:id/return` (يبثّ `hr:asset`+`hr:employee` لفك بوابة الإنهاء), `DELETE`.

**`RENEWAL_FIELDS` map:** `iqama→{iqamaExpiry,iqamaNumber}`, `passport→{passportExpiry,passportNumber}`, `workPermit→{workPermitExpiry}`, `insurance→{insuranceExpiry}`, `visa→{visaExpiry}`, `license→{licenseExpiry,licenseNumber}`, `driverCard→{driverCardExpiry,driverCardNumber}`, `ajeer→{ajeerExpiry}`, `other→{}`.

### 3.4 Workflows (state machines)

**دورة الإجازة (الأهم):**
```
موظف يقدّم → (فيه مدير؟ pending_manager : pending_hr)
pending_manager: المدير approve→pending_hr | reject→rejected(نهائي)
pending_hr:       HR approve→approved(نهائي) | reject→rejected(نهائي)
أي pending: الطالب cancel→cancelled(نهائي)
```
**احتساب الرصيد (`utils/leaveBalance.js`):** يتطلب عقد active. `leaveDays(s,e)=(e-s)/يوم+1` (شامل الطرفين). `accrued = annualLeaveDays × (daysElapsed/365)` تراكم تدريجي (daysElapsed مقصوص على نافذة العقد). `taken = مجموع الإجازات approved حيث affectsBalance=true`. `available = accrued − taken`. `balanceSnapshot` يُلتقط وقت الإنشاء.

**طلب HR (thread):** الموظف ينشئ (open، readByHR=false) → HR يردّ (open→in_progress، assignedTo=الرادّ، readByRequester=false) → الموظف يردّ (readByHR=false) → HR يضبط الحالة النهائية. أعلام القراءة تقود شارات «غير مقروء».

**الإنهاء/التفعيل:** terminate يفحص العُهد، يضبط employmentStatus=terminated + ينهي العقد (custodyReturned=true) + يخطر الموظف. reactivate يرجّعه active.

**التجديد:** يلتقط previousExpiry → يحدّث حقل الموظف عبر RENEWAL_FIELDS → ينشئ سجل تجديد → audit → يظهر في تبويب History.

### 3.5 Dashboard (`GET /api/hr/dashboard`)
- *summary counts:* total/active/on_leave/suspended/terminated employees، pendingLeaves (`status∈[pending_manager,pending_hr]`)، openRequests (`open|in_progress`)، assignedAssets، expiringDocsCount/expiredDocsCount.
- *breakdowns ($group):* byStatus، byDepartment(top12)، byProject(top12)، byNationality(top10).
- *recentHires:* آخر 8 بـ hireDate.
- **expiringDocs (feed موحّد):** يمسح كل موظف غير منتهي الخدمة عبر `EXPIRY_DOCS` = حقول {iqama,passport,workPermit,insurance,visa,license,driverCard,ajeer}؛ أي حقل ≤ today+60d يدخل الـ feed (مرتّب تصاعدي، أول 100، مع علم `expired` لو < today).
- *expiringContracts:* عقود active بـ endDate في [today, today+90d].

### 3.6 Realtime events
`hr:employee` (CRUD/renew/terminate/reactivate/document)، `hr:contract`، `hr:leave`، `hr:request`، `hr:asset`. Payload `{ id }`. يُبَثّ للمستخدم + كل HR staff.

### 3.7 Frontend
- Types في `lib/hr.ts` (Employee, Contract, LeaveType, LeaveBalance, LeaveRequest, HRRequest, Asset, EmployeeDocument, EmployeeRenewal, AuditEntry) + helpers (`isHRStaff, empName, leaveTypeLabel, expiryBadge, fmtDate, daysUntil`).
- مكوّنات مشتركة `components/hr/` (`EmployeeFormModal` مشترك بين صفحة القائمة والملف + `EMPTY_EMPLOYEE`، `RenewModal`, `TerminateModal`).
- صفحات staff: `/system/hr/dashboard`, `/employees` (قائمة + `?status=`)، `/employees/[id]` (تبويبات: Overview, Files, Leaves, Custody, **Vehicles** [من §6], Contracts, Requests, History)، `/leaves`, `/requests`, `/custody`, leave-types.
- صفحات self-service: `/system/hr/me` (Overview/Leaves/Custody)، `/my-leaves` (Mine + Team لو مدير)، `/my-requests` (thread modal).

---

## §4 — SELF-SERVICE + REMOTE + CLIENT PORTAL (الخدمة الذاتية والعمل عن بُعد وبوابة العميل)

**الفكرة بالعربي:** أي مستخدم داخلي (غير client) له خدمة ذاتية كاملة مبنية فوق HR (§3): ملفي، إجازاتي، طلباتي — والربط مفتاحه `User.linkedEmployee`. الموظف يرى/يقدّم فقط بياناته الخاصة، وطلباته تدخل سلسلة اعتماد HR. بالإضافة لموديول **Remote** (عمل عن بُعد منفصل: حضور/إجازات/مهام/شات/تقارير/إعلانات) و**Client Portal** للعميل الخارجي (فواتيره ومدفوعاته فقط).

### 4.1 Self-Service workflow (ربط User↔Employee)
1. HR ينشئ Employee (بدون login). 2. super_admin/HR يربط User بالـ Employee من شاشة Users → `User.linkedEmployee=Employee._id` + `Employee.user=User._id`. 3. الموظف يدخل الخدمة الذاتية. `ensureSelfEmployee(req.user)` ينشئ ملف stub تلقائياً لمن يدخل `/me/*` بدون ربط (idempotent). كل endpoints وworkflow الإجازات/الطلبات في **§3.3 + §3.4**.

### 4.2 Remote module (`/api/remote`, auth = `[super_admin, admin, remote_manager, remote_employee]`)
**الصلاحية لكل صفحة (per-page):** `remote_employee` يرى فقط الصفحات في `User.remoteAccess` (subset من `REMOTE_PAGES`). admin/manager يرون الكل. النطاق: admin=الكل، remote_manager=فريقه (مرؤوسوه)، remote_employee=نفسه.

**Models:**
- `RemoteAttendance`: `user*`, `date(YYYY-MM-DD Cairo-local)`, `checkIn`, `checkOut`, `durationMinutes(0)`, `status(present|incomplete)=incomplete`. Index فريد `(user,date)`.
- `RemoteLeaveRequest`: `user*`, `manager→User`, `type(annual|sick|personal|unpaid|other)=annual`, `startDate*`, `endDate*`, `days(1)`, `reason`, `status(pending|approved|rejected)=pending`, `reviewedBy`, `reviewedAt`, `reviewNote`. (أبسط من HR — مرحلة واحدة).
- `RemoteTask`: `user*(assignee)`, `assignedBy→User`, `title*`, `description`, `dueDate`, `done(false)`, `completedAt`.
- `RemoteReport`: `user*`, `date(Cairo)`, `body*`. Index فريد `(user,date)`. (تقرير يومي واحد، upsert).
- `RemoteMessage`: `employee*→User`(صاحب الـ thread), `sender*→User`, `body*`, `readByEmployee(false)`, `readByStaff(false)`. Index `(employee,createdAt)`.
- `RemoteAnnouncement`: `author*`, `title*`, `body*`, `audience:[→User]` (فاضي=كل remote_employees، وإلا محصور).

**Endpoints:**
- Attendance: `POST /attendance/toggle` (زر واحد: أول ضغطة check_in، تانية check_out + يحسب المدة + status=present، تالتة done)؛ `GET /attendance/today`؛ `GET /attendance?userId&from&to`.
- Dashboard: `GET /dashboard?userId&from&to` → `{scope, summary:{daysWorked,totalMinutes,totalHours,leaveDays,pendingLeaves}, perEmployee:[...]}`.
- Leave: `POST /leave`؛ `GET /leave?status&userId&from&to`؛ `PATCH /leave/:id` (`{status,reviewNote?}` — manager لفريقه فقط؛ يبثّ `remote:leave-updated`).
- Chat: `GET /chat/threads` (staff)، `GET /chat` (own)، `GET /chat/:employeeId` (staff)، `POST /chat`، `POST /chat/:employeeId`. أعلام القراءة `readByEmployee/readByStaff`.
- Tasks: `GET /tasks?done&userId`، `POST /tasks` (staff؛ manager لفريقه)، `PATCH /tasks/:id` (الموظف يعلّم done فقط؛ staff يعدّل المحتوى)، `DELETE /tasks/:id` (staff).
- Reports: `GET /reports`، `POST /reports` (upsert اليوم)، `GET /reports/today`.
- Announcements: `GET /announcements`، `POST /announcements` (staff)، `DELETE /announcements/:id`.
- `GET /employees` (staff — دليل فريق remote).
- **Events:** `remote:leave-updated, remote:message, remote:task, remote:attendance, remote:announcement`.
- **Frontend:** `/system/remote/{dashboard,attendance,leave,tasks,chat,report,announcements}`.

### 4.3 Client Portal (دور `client`)
- الربط: `User.linkedCustomer→Customer`. التحجيم: كل الاستعلامات تفلتر بـ `req.user.linkedCustomer`.
- `GET /api/analytics/portal/dashboard` (client) → `{customer, invoices(+isOverdue,isDueSoon,statusColor,message), totalOutstanding, totalPaid, totalInvoices}`. حساب الحالة: `dueDate-now<0 && !paid`→overdue (أحمر)، `0..5 يوم`→due soon (أصفر)، paid→أخضر.
- `GET /api/payments` (client) → مدفوعات العميل.
- نماذج مرتبطة: `Invoice` (`invoiceNumber*unique, customer*, amount*, paidAmount, balance, invoiceDate*, dueDate*, creditTerm(15|30|45|60)*, status(pending|partial|paid|overdue|frozen|disputed|refunded)`), `Payment` (`invoice, customer*, amount*, paymentDate, paymentMethod(bank_transfer|check|cash|online|other), reference`), `Customer` (`companyName*unique, creditTerm(15|30|45|60)=30, creditLimit, grade(A-D), clientStatus(...), riskLevel(low|medium|high)`).
- **Frontend:** `/system/portal` (KPIs+تنبيهات)، `/portal/invoices` (+`[id]`)، `/portal/payments`.

### 4.4 ربط الخدمة الذاتية بـ CRM (للتوسعة)
أدوار CRM موجودة؛ في النسخة الحالية صفقات/مهام مستخدم CRM **غير مربوطة** مباشرة بالخدمة الذاتية. **التوسعة المقترحة:** مستخدم CRM يرى صفقاته (`CrmDeal.owner=me`) ومهامه (`CrmTask.assignedTo=me`) جنب ملف HR بتاعه في لوحة موحّدة. (الربط متاح أصلاً عبر `owner`/`assignedTo` — انظر §5/§8).

---

## §5 — CRM (إدارة علاقات العملاء)

**النطاق:** شركات (تقييم نجوم + أزرار تواصل مباشرة) + جهات اتصال + أنشطة + مهام + صفقات (kanban سحب وإفلات) + تقويم + داشبورد. هجين: شركة CRM تُربط اختيارياً بعميل لوجستي. Mount `/api/crm`. كل المسارات `authorize(...CRM_STAFF_ROLES)`. الحذف للشركات فقط = `CRM_ADMIN_ROLES`. Events `crm:company|contact|deal|task|activity`.

### 5.1 Models
**`CrmCompany`:** `name*`, `arabicName`, `status(lead|prospect|active|inactive|churned)=lead`, `type(customer|partner|vendor|reseller|other)=customer`, `rating(0-5)=0`, `score(0-100)=0`, `industry`, `size(small|medium|large|enterprise|'')`, `website`, `phone`, `whatsapp`, `email`, `address`, `city`, `country`, `source(referral|website|cold_call|social|event|campaign|other|'')`, `tags:[String]`, `owner→User`, `linkedCustomer→Customer`(هجين), `notes`, `createdBy`. Indexes: name,status,owner,rating-1,tags.

**`CrmContact`:** `company→CrmCompany`, `firstName*`, `lastName`, `arabicName`, `title`, `department`, `email`, `phone`, `mobile`, `whatsapp`, `linkedinUrl`, `isPrimary(false)`(واحد فقط لكل شركة), `rating(0-5)`, `tags`, `owner→User`, `notes`, `createdBy`.

**`CrmDeal`:** `title*`, `company→CrmCompany`, `contact→CrmContact`, `stage(='new')`, `status(open|won|lost)=open`, `value(0)`, `currency('SAR')`, `probability(0-100)`, `expectedCloseDate`, `wonAt`, `lostAt`, `lostReason`, `source`, `owner→User`(= مندوب المبيعات؛ رابط §7), `notes`, `createdBy`. Indexes: company، `(stage,status)`، **owner**، `(status,expectedCloseDate)`.

**`CrmTask`:** `title*`, `description`, `company`, `contact`, `deal`, `assignedTo→User`, `dueDate`, `dueTime(HH:mm)`, `priority(low|medium|high|urgent)=medium`, `status(todo|in_progress|done|cancelled)=todo`, `completedAt`, `createdBy`.

**`CrmActivity`:** `type(call|meeting|email|whatsapp|visit|note)=note`, `subject*`, `body`, `company`, `contact`, `deal`, `direction(inbound|outbound|'')`, `outcome(connected|no_answer|voicemail|positive|negative|neutral|'')`, `date(now)`, `durationMinutes(0)`, `createdBy`.

### 5.2 Static config (`config/crmDefaults.js`) — مخدومة عبر `GET /api/crm/options` (مع override من Lookups)
- **PIPELINE_STAGES (ترتيب + probability + color):** `new`(10,#94a3b8) → `contacted`(25,#3b82f6) → `qualified`(40,#6366f1) → `proposal`(60,#a855f7) → `negotiation`(80,#f97316) → `won`(100,#22c55e,terminal status=won) → `lost`(0,#ef4444,terminal status=lost).
- COMPANY_STATUSES: lead, prospect, active, inactive, churned. COMPANY_TYPES: customer, partner, vendor, reseller, other. COMPANY_SIZES: small, medium, large, enterprise. SOURCES: referral, website, cold_call, social, event, campaign, other. INDUSTRIES: logistics, manufacturing, retail, wholesale, construction, food, tech, healthcare, oil_gas, government, other. ACTIVITY_TYPES كأعلاه. TASK_PRIORITIES/STATUSES كأعلاه. كل عنصر `{key,nameEn,nameAr}`.

### 5.3 Endpoints (`routes/crm.js`)
- Meta: `GET /options`، `GET /dashboard`، `GET /calendar?from&to&mine`، `GET /customers-search?q` (بحث عملاء لوجستيين للربط الهجين، max20).
- Companies: `GET /companies?q&status&type&owner&minRating&tag` (max500)، `GET /companies/:id` (+contacts/activities/tasks/deals)، `POST`، `PUT`، `PATCH /companies/:id/rate {rating}`، `DELETE` (**CRM_ADMIN** — cascade يحذف contacts/activities/tasks/deals).
- Contacts: `GET /contacts?q&company`، `POST` (isPrimary يلغي الباقي)، `PUT`، `DELETE`.
- Activities: `GET /activities?q&company&contact&deal&type&from&to`، `POST`، `PUT`، `DELETE`.
- Tasks: `GET /tasks?q&status&priority&assignedTo&company&deal&mine&from&to`، `POST` (لو assignedTo≠منشئ → notification+`crm:task` للمكلّف)، `PUT` (status=done→completedAt)، `DELETE`.
- Deals: `GET /deals?q&status&stage&owner&company`، `POST`، `PUT`، **`PATCH /deals/:id/move {stage,lostReason?}`** (kanban: won→status=won+wonAt+prob100؛ lost→status=lost+lostAt+prob0؛ غيره→open)، `DELETE`.

### 5.4 Frontend
- `lib/crm.ts`: types + helpers (`waLink`=`https://wa.me/{digits}?text=` بإسقاط 00، `telLink`=`tel:`، `mailLink`=`mailto:?subject=`، `companyName`، `dueBadge`، `money`) + style maps + `CRM_STAFF_ROLES/CRM_ADMIN_ROLES/isCrmStaff/isCrmAdmin`.
- `components/crm/CrmKit.tsx`: `StarRating` (5 نجوم clickable/read-only)، **`ContactButtons`** (WhatsApp `wa.me`، Call `tel:`، Email `mailto:`، Website — تظهر فقط للقنوات المتاحة)، `CopyText`.
- Pages: `/system/crm/{dashboard, companies, companies/[id] (tabs: Overview/Contacts/Activities/Tasks/Deals), contacts, deals (kanban drag-drop عبر /move), tasks, calendar (month grid), activities}`. Excel export.

---

## §6 — VEHICLES & AUTHORIZATIONS (المركبات والتفاويض)

**الفكرة بالعربي:** في السعودية الموظف يحتاج **تفويض (Authorization)** رسمي ليأخذ/يشغّل مركبة الشركة (سيارة/دباب/شاحنة). التفويض كيان مستقل (زي العُهدة لكن منفصل) يمكن نقله A→B أو إلغاؤه (المركبة تُركَن)، **والتاريخ يُحفظ بالكامل ولا يُحذف**. + سجل حوادث مربوط بالمركبة والموظف. Mount `/api/vehicles`. الأدوار: `VEHICLE_STAFF_ROLES` (super_admin+HR+Accounting)؛ الحذف `VEHICLE_ADMIN_ROLES`. **ملاحظة مهمة:** Accounting لا تنادي HR، فالموديول له بحث موظفين خاص (`/employees`). الموديول AR/EN كامل.

### 6.1 Models
**`Vehicle`:** `plateNumber*(unique)`, `type(car|motorcycle|heavy_truck|trailer|van|equipment|other)=car`, `make`, `model`, `year`, `color`, `branch→Branch`, `department`, `project`, `registrationExpiry`, `insuranceExpiry`, `status(available|authorized|parked|maintenance|out_of_service)=available`, `currentAuthorization→VehicleAuthorization`(denorm), `currentEmployee→Employee`(denorm), `accidentCount(0)`, `notes`, `createdBy`. Indexes: status,type,branch,currentEmployee.

**`VehicleAuthorization`** (سجل لفترة تفويض واحدة، **لا يُحذف**): `vehicle*`, `employee*`, `status(active|transferred|revoked)=active`, `startDate*`, `endDate`, `authorizationType`, `documentNumber`, `documentExpiry`, `issuedBy`, `endReason(transferred|revoked|parked|'')`, `transferredTo→Employee`, `transferredFrom→Employee`, `revokedReason`, `notes`, `createdBy`, `endedBy→User`. Indexes: `(vehicle,status)`,`(employee,status)`,`(vehicle,createdAt-1)`,`(employee,createdAt-1)`.

**`VehicleAccident`:** `vehicle*`, `employee→Employee`, `authorization→VehicleAuthorization`(snapshot), `date*`, `location`, `description*`, `faultParty(employee|third_party|shared|none|unknown)=unknown`, `severity(minor|moderate|severe|total_loss)=minor`, `thirdPartyDetails`, `injuries(false)`, `actionTaken`, `reportNumber`, `estimatedCost(0)`, `actualCost(0)`, `status(reported|investigating|resolved|closed)=reported`, `resolution`, `notes`, `createdBy`.

### 6.2 Core logic: `syncVehiclePointers(vehicleId)`
```
active = VehicleAuthorization.findOne({vehicle, status:'active'}).sort({createdAt:-1})
if active: Vehicle.update({ currentAuthorization:active._id, currentEmployee:active.employee, status:'authorized' })
else:      Vehicle.update({ $unset:{currentAuthorization,currentEmployee}, status:'parked' })
```
يُنادى بعد: authorize / transfer / revoke / deleteAuthorization.

### 6.3 Endpoints (`routes/vehicles.js`) — **روتس collection قبل `/:id`**
- `GET /` (فلاتر q,type,status,branch,project؛ populate currentEmployee/currentAuthorization)، `GET /:id` (+authorizations+accidents)، `POST /`, `PUT /:id`, `DELETE /:id` (ADMIN — cascade auths+accidents).
- `GET /dashboard`، `GET /employees?q` (بحث خاص EMP_FIELDS، max50)، `GET /authorizations?status&employee&vehicle`، `GET /accidents?status&vehicle&employee&q`، `GET /by-employee/:employeeId` → `{current, authorizations, accidents}`.
- `POST /:id/authorize {employee*,startDate?,authorizationType?,documentNumber?,documentExpiry?,issuedBy?,notes?}` — يفشل لو فيه auth active (`ALREADY_AUTHORIZED`).
- `POST /:id/transfer {employee*,...}` — يفشل لو مفيش active (`NOT_AUTHORIZED`) أو نفس الموظف.
- `POST /:id/revoke {endDate?,revokedReason?}`.
- `POST /:id/accidents {date*,description*,...}`.
- `PUT/DELETE /authorizations/:authId` (DELETE=ADMIN)، `PUT/DELETE /accidents/:accId` (DELETE=ADMIN).

### 6.4 Workflows
- **Authorize:** ينشئ auth active → `syncVehiclePointers` (status=authorized) → `Employee.vehiclePlate=plate` → events `vehicle:authorization`+`hr:employee`.
- **Transfer A→B:** يقفل القديم (status=transferred, endDate, endReason=transferred, transferredTo=B, endedBy) → يمسح plate القديم → ينشئ active جديد (transferredFrom=A) → plate الجديد → sync → events للطرفين.
- **Revoke:** يقفل (status=revoked, revokedReason, endedBy) → يمسح plate → sync (status=parked) → events.
- **Accident:** يجيب active auth (يملأ employee+authorization تلقائياً) → ينشئ + `accidentCount++` → events.
- **Vehicle status machine:** available→authorized (authorize)؛ authorized→authorized (transfer)؛ authorized→parked (revoke)؛ أي→maintenance/out_of_service (تعديل يدوي).

### 6.5 Realtime & Frontend
- Events: `vehicle:updated`, `vehicle:authorization`, `vehicle:accident`, `hr:employee`.
- `lib/vehicles.ts`: types + `VEHICLE_TYPES/STATUS/AUTH_STATUS/ACCIDENT_SEVERITY/ACCIDENT_STATUS/FAULT_PARTY` (style maps AR/EN) + role helpers + `getVehiclesText(lang)`.
- `components/vehicles/EmployeePicker.tsx` (بحث debounced عبر `/api/vehicles/employees`).
- Pages: `/system/vehicles` (أسطول+تفاويض)، `/[id]` (Overview/Authorizations timeline/Accidents + modals authorize/transfer/revoke/report-accident)، `/dashboard`، `/accidents`. وتبويب **Vehicles** في ملف الموظف (`hr/employees/[id]`) عبر `/by-employee/:id`.
- **(اختياري) vehicle-analytics:** طبقة تحليلات منفصلة offline-first (IndexedDB: وقود/GPS/رحلات/كيلومترات) — ليست مربوطة بسير التفويض؛ ابنها فقط لو محتاج تحليلات أسطول.

---

## §7 — PROCUREMENT + WAREHOUSE/INVENTORY (المشتريات والمخزن)

**الفكرة:** دورة شراء-حتى-الدفع كاملة: طلب شراء → اعتماد → أمر شراء (VAT سعودي 15%) → استلام → فاتورة مورد (ذمم دائنة) **مع ترحيل محاسبي تلقائي**. + مخزن الورشة (InventoryItem بنظام موافقة + low-stock) + طلبات شراء الورشة المربوطة بطلبات الصيانة. Mount `/api/procurement`, `/api/vendors`, `/api/workshop`. الأدوار: `PROCUREMENT_STAFF_ROLES`؛ MANAGER=`[super_admin,admin,procurement_manager]`.

### 7.1 Models
**`PurchaseRequest`:** `requestNumber(PR-xxxxxx)`, `title*`, `category`, `requester→User`, `department`, `items:[{description*,quantity(1),unitPrice(0),total}]`, `totalEstimate(0)`, `justification`, `neededBy`, `priority(low|medium|high|urgent)=medium`, `suggestedVendor→Vendor`, `status(draft|pending_approval|approved|rejected|ordered)=draft`, `approval:{by→User,at,note}`, `purchaseOrder→PurchaseOrder`, `notes`, `createdBy`. Index `(status,createdAt-1)`,`requester`.

**`PurchaseOrder`:** `poNumber(PO-xxxxxx)`, `vendor*→Vendor`, `purchaseRequest→PR`, `items:[line]`, `subtotal(0)`, `vatRate(15)`, `vatAmount(0)`, `total(0)`, `currency('SAR')`, `status(draft|sent|partially_received|received|billed|cancelled)=draft`, `expectedDate`, `receivedDate`, `notes`, `approvedBy`, `createdBy`.

**`VendorBill` (AP):** `billNumber(BILL-xxxxxx)`, `vendorInvoiceNumber`, `vendor*→Vendor`, `purchaseOrder→PO`, `subtotal(0)`, `vatAmount(0)`, `total*`, `paidAmount(0)`, `balance(0)`, `currency('SAR')`, `billDate(now)`, `dueDate`, `category`, `status(unpaid|partial|paid)=unpaid`, `paidAt`, `notes`, `createdBy`. Index `(status,dueDate)`,`vendor`.

**`Vendor`:** `name*`, `contactPerson`, `phone`, `email`, `address`, `category`(lookup `vendor_category`), `totalPaid(0)`, `totalOutstanding(0)`, `isActive(true)`, `notes`, `createdBy`.

**`InventoryItem` (مخزن الورشة):** `code*(unique)`, `name*`, `category`, `quantity(0)`, `minQuantity(0)`(عتبة إعادة طلب), `unit('piece')`, `costPrice(0)`, `location`, `supplier`, `notes`, `isActive(true)`, **نظام موافقة:** `approvalStatus(pending|approved|rejected)=pending`, `approvedBy`, `approvedAt`, `approvalNote`, `createdBy`, `branch`. منطق: غير المديرين ينشئون pending؛ المديرون auto-approve ويرون الكل؛ غيرهم يرون approved فقط. `lowStock = quantity<=minQuantity`.

**`WorkshopPurchaseRequest`:** `itemName*`, `quantity(1)`, `description`, `maintenanceRequest→MaintenanceRequest`, `vehicleNumber`, `status(pending|received|fulfilled)=pending`, استلام `{receivedBy,receivedAt,cost,supplier,invoiceNumber}`, تنفيذ `{fulfilledAt,fulfilledBy,fulfillmentNotes}`, `requestedBy*`, `branch`. (يربط `MaintenanceRequest.partsNeeded[idx]` بـ sentToPurchasing+purchaseRequestId).

### 7.2 Accounting integration (`utils/accountingPoster.js` + `config/accountingDefaults.js`)
**CODES:** CASH=1000, BANK=1010, AR=1100, INVENTORY=1200, AP=2000, VAT_PAYABLE=2100, EQUITY=3000, SALES=4000, COGS=5000, OPEX=6000 …
- **postJournalEntry({date,memo,lines,source,createdBy})**: يصفّي السطور الصفرية، يحسب totalDebit/totalCredit، **يرفض لو غير متوازن (debit≠credit)**، status=posted. `JournalEntry.source={type,refId,auto}` مع **index فريد partial على (source.type,source.refId) حيث auto=true** → يمنع التكرار (idempotent).
- **reverseSource(type,refId):** يحذف القيود الآلية المطابقة.
- **VendorBill create →** `Dr OPEX(6000)=subtotal`, `Dr VAT_PAYABLE(2100)=vatAmount`, `Cr AP(2000)=total` (source `vendorbill`).
- **Bill pay →** `Dr AP(2000)=amount`, `Cr CASH(1000)=amount` (source `vendorpayment`).
- **Bill delete →** `reverseSource('vendorbill')` + `reverseSource('vendorpayment')`.
- `JournalEntry.source.type` enum يشمل: `manual, invoice, payment, wallet, vendorbill, vendorpayment`.

### 7.3 Endpoints
**Procurement (STAFF؛ decision/delete=MANAGER):** `GET /options`، `GET /dashboard`؛ PRs: `GET /requests?status&q&mine`, `POST /requests`, `PUT /requests/:id` (ممنوع لو approved/ordered), `POST /requests/:id/submit`, `PATCH /requests/:id/decision {decision,note?}`(MANAGER), `POST /requests/:id/convert {vendor*,vatRate?,expectedDate?}`, `DELETE`(MANAGER)؛ POs: `GET /orders`, `POST`, `PUT` (ممنوع لو billed/cancelled), `POST /orders/:id/receive`, `DELETE`(MANAGER، يفشل لو فيه bills)؛ Bills: `GET /bills`, `POST /bills` (auto-post AP + PO→billed), `POST /bills/:id/pay {amount?}` (auto-post payment), `DELETE`(MANAGER، reverse).
**Vendors (`/api/vendors`):** `GET /`, `GET /:id`, `POST` (super_admin,admin,operations_manager,operations,procurement_manager,purchasing — إنشاء inline من فورم المشتريات), `PUT`, `DELETE`(super_admin). Events `vendor:created|updated|deleted`.
**Workshop inventory (`/api/workshop`):** `GET /inventory/search?q`, `GET /inventory?search&category&approvalStatus&page&limit` (+lowStock), `POST /inventory` (purchasingRoles), `PUT /inventory/:id`, `PUT /inventory/:id/approve {status,note?}` (managerRoles), `DELETE` (soft isActive=false). Purchases: `GET /purchases`, `POST /purchases`, `PUT /purchases/:id/receive {inventoryItemId?}` (يخصم من المخزون لو مُمرّر), `PUT /purchases/:id/fulfill {cost,supplier,invoiceNumber,fulfillmentNotes}`.

### 7.4 Workflows
**Procure-to-Pay:** `draft →submit→ pending_approval →decision(MANAGER)→ approved|rejected →convert→ ordered` (ينشئ PO draft، VAT 15%)؛ `PO: draft→sent→received→billed`؛ `Bill: unpaid→partial→paid` (كل خطوة ترحّل قيد؛ الحذف يعكس). **Helpers:** `lineTotals`,`sumLines`,`round2`,`recalcPO`,`seq(Model,prefix)`.
**Workshop purchase:** `pending →receive(+خصم مخزون)→ received →fulfill(تكلفة)→ fulfilled`.
**AP aging (`getPayables`/dashboard):** فواتير `status∈[unpaid,partial]` مجمّعة بعمر `dueDate` (current/31-60/61-90/90+) بمجموع `balance`؛ overdue = `dueDate<today`.

### 7.5 Realtime & Frontend
Events: `procurement:pr|po|bill`, `accounting:journal`, `vendor:*`, `inventory:created|updated|deleted`, `purchase:created|received|fulfilled`. `config/procurementDefaults.js`: `KSA_VAT_RATE=15` + PR/PO/BILL_STATUSES + PRIORITIES + CATEGORIES (AR/EN). `lib/procurement.ts`: types + style maps. Pages: `/system/procurement/{dashboard,requests,orders,bills}`، `/system/vendors`، صفحة مخزون تحت `/system/workshop`، وتقرير `/system/accounting/payables`.

---

## §8 — SALES (المبيعات)

**الفكرة:** المبيعات مبنية **فوق صفقات CRM** (`CrmDeal.owner` = المندوب). الموديول يقرأ الصفقات فقط (لا ينشئها — الإدارة الكاملة في CRM). أهداف شهرية لكل مندوب/فريق + أداء (المنجز مقابل الهدف) + عرض pipeline للقراءة + داشبورد. Mount `/api/sales`. الأدوار: `SALES_STAFF_ROLES`؛ وضع الأهداف `SALES_ADMIN_ROLES`.

### 8.1 Model `SalesTarget`
`rep→User` (null=هدف فريق), `period*('YYYY-MM')`, `amountTarget(0)`, `dealsTarget(0)`, `notes`, `createdBy`. **Index فريد `(rep,period)`** → هدف واحد لكل مندوب/شهر. **Upsert** عبر `findOneAndUpdate({rep:rep||null,period},...,{upsert:true,setDefaultsOnInsert:true})`. الأرقام الفعلية تُحسب حيّاً من CrmDeal (لا تُخزّن).

### 8.2 Endpoints (`routes/sales.js`)
- `GET /options` → `{reps}` (مستخدمون active بأدوار SALES_STAFF + crm_manager/crm_specialist).
- `GET /dashboard?period` → wonValue/wonCount/lostValue/lostCount/openValue/openCount, teamTarget, attainment=(won/target×100), winRate=(won/(won+lost)×100), avgDealSize, prev* (الشهر السابق), `byStage` (open مجمّع بـ stage: new,contacted,qualified,proposal,negotiation), `repRows[]` (لكل مندوب: won/open/target/attainment، مرتّب wonValue desc), `topReps[]` (أعلى 10).
- `GET /performance?period` → `rows[]` (rep{_id,name,role}, wonValue/Count, openValue/Count, target, dealsTarget, attainment).
- `GET /pipeline?owner?` → deals (max500, populate company+owner) — kanban للقراءة فقط.
- `GET /targets?period`، `POST /targets {rep?,period*,amountTarget,dealsTarget,notes?}` (ADMIN, upsert, يبثّ `sales:target`)، `PUT /targets/:id` (ADMIN)، `DELETE /targets/:id` (ADMIN).

### 8.3 احتساب الأداء
`periodRange(period)`: `start=new Date(y,m-1,1)`, `end=new Date(y,m,0,23,59,59)`. **Won** = `CrmDeal{status:'won', owner:rep, wonAt∈[start,end]}` بمجموع `$value`. **Open** = `{status:'open'}` (كل الوقت). **Lost** = `{status:'lost', lostAt∈range}`. attainment = `won/target×100` (0 لو target=0). `round2` على كل القيم.

### 8.4 الربط بـ CRM
الصفقة تصبح ملك مندوب بمجرد ضبط `CrmDeal.owner`. الانتقالات `open→won` (يضبط wonAt) / `open→lost` (يضبط lostAt) تتم في CRM عبر `/deals/:id/move` (§5.3) وتُحسب في فترة المبيعات. الموديول يستمع لـ `crm:deal` + `sales:target` ويعيد الجلب.

### 8.5 Frontend
`lib/finance.ts`: `SALES_STAFF_ROLES/SALES_ADMIN_ROLES/isSalesStaff/isSalesAdmin`, `money/pct/num/thisPeriod/userName`, `STAGES` (نسخة من crmDefaults). Pages: `/system/sales/{dashboard,performance,targets,pipeline}`. Excel export. النصيحة في pipeline: "لإدارة الصفقات بالكامل استخدم CRM → Deals".

---

## §9 — Cross-Module Integration Map (خريطة الربط بين الموديولز)

```
User ──linkedEmployee──► Employee ──► HR (contracts/leaves/requests/custody/documents)
User ──manager (ROLE_HIERARCHY)──► سلسلة اعتماد الإجازات (المدير ← HR)
User ──linkedCustomer──► Customer ──► Client Portal (invoices/payments)
User ──remoteAccess[]──► صفحات Remote المسموح بها

Employee ◄──currentEmployee / VehicleAuthorization.employee──► Vehicles (تفويض/حوادث)
Employee.vehiclePlate  ◄── يُزامن من VehicleAuthorization (denormalized)

CrmCompany ──linkedCustomer (اختياري)──► Customer (لوجستي)
CrmDeal.owner = User (مندوب) ──► Sales (targets/performance/pipeline)
CrmTask.assignedTo = User

Vendor ──► PurchaseRequest → PurchaseOrder → VendorBill (AP)
VendorBill/Payment ──auto-post──► JournalEntry (Accounting: Dr OPEX+VAT / Cr AP ; Dr AP / Cr Cash)
WorkshopPurchaseRequest ──► MaintenanceRequest.partsNeeded ; receive ──► InventoryItem.quantity

كل الموديولز ──► Realtime (module:entity) + Notifications + Audit (الأساسات §2)
```

**ملخص الربط بالعربي:** المستخدم هو المحور — يرتبط بملف HR (خدمة ذاتية وإجازات بسلسلة المدير)، وبعميل لوجستي (بوابة)، وبصفحات Remote. الموظف يرتبط بالمركبات عبر التفويض (والـ plate يتزامن). شركة CRM تُربط اختيارياً بعميل، وصفقات CRM (بمالكها) تغذّي المبيعات. المورد يقود دورة المشتريات التي تُرحّل تلقائياً للمحاسبة. وكل شيء يبثّ realtime + إشعارات + تدقيق.

---

## §10 — Build Order & Checklist (ترتيب البناء وقائمة التحقق)

ابنِ بالترتيب ده (كل خطوة تعتمد على اللي قبلها):

1. **الأساسات (§2):** المشروع (backend/frontend skeleton + Next rewrites) → User model → Auth (JWT cookies + refresh) → RBAC + كل الأدوار + ROLE_HIERARCHY + orgChart → Realtime (socketManager + useSocket) → Notification → AuditLog + logAudit → Lookup + lookupTypes + ManagedSelect → server bootstrap + auto-seed. **اختبر:** login/refresh/me، authorize يرفض/يسمح، socket يتصل.
2. **HR (§3):** Models التسعة → fileStore (uploads) → hrController + routes → leaveBalance util → ensureSelfEmployee → dashboard → frontend (lib/hr + EmployeeFormModal + الصفحات). **اختبر:** دورة إجازة كاملة (مدير→HR)، بوابة العُهدة عند الإنهاء، تجديد وثيقة، رفع مستند.
3. **Self-Service + Remote + Portal (§4):** نقاط `/me/*` (موجودة في hr.js) → Remote models+controller+routes → Portal (analytics/portal/dashboard). **اختبر:** الموظف يرى نفسه فقط؛ remoteAccess يحجب الصفحات؛ client يرى فواتيره فقط.
4. **CRM (§5):** 5 models → crmDefaults → crmController + routes (مع /move + cascade delete) → lib/crm + CrmKit (ContactButtons/StarRating) → الصفحات (kanban/calendar). **اختبر:** سحب صفقة لـ won يضبط wonAt؛ ContactButtons يبني wa.me/tel/mailto؛ ربط هجين بعميل.
5. **Vehicles (§6):** 3 models → syncVehiclePointers → vehicleController + routes → lib/vehicles + EmployeePicker → الصفحات + تبويب Vehicles في ملف الموظف. **اختبر:** authorize→transfer→revoke والتاريخ محفوظ؛ ALREADY_AUTHORIZED/NOT_AUTHORIZED؛ plate يتزامن.
6. **Accounting الأساسي (§7.2):** ChartAccount + JournalEntry + accountingDefaults (seed CODES) + accountingPoster (postJournalEntry/reverseSource/accountIdsByCode + index فريد idempotent). **اختبر:** قيد متوازن يُقبل، غير متوازن يُرفض، لا تكرار للقيد الآلي.
7. **Procurement + Inventory (§7):** Vendor + PR + PO + VendorBill + InventoryItem + WorkshopPurchaseRequest → procurementController (مع auto-post) + workshopController (inventory) → vendors routes → lib/procurement → الصفحات. **اختبر:** PR→approve→convert→receive→bill (قيد AP)→pay (قيد دفع)→delete (عكس)؛ خصم المخزون عند الاستلام.
8. **Sales (§8):** SalesTarget + salesController + routes → lib/finance → الصفحات. **اختبر:** هدف upsert؛ attainment يُحسب من صفقات won في الفترة؛ pipeline للقراءة.
9. **التحقق النهائي:** اكتب اختبار تكامل in-memory (mongodb-memory-server + supertest) يغطّي: auth، RBAC، org chart، دورة إجازة، CRM، vehicles transfer، procure-to-pay + AP posting + ميزان متوازن، sales attainment. (المرجع الأصلي عنده `scripts/fullSystemTest.js`).

**معايير القبول العامة لكل موديول:** (أ) كل model بحقوله/enums/defaults زي الموصوف. (ب) كل endpoint بالـ method/path/roles/body الصحيح. (ج) كل workflow/state-machine ينتقل صح ويرفض الانتقالات غير القانونية. (د) realtime + notifications + audit شغّالة. (هـ) الواجهة AR/EN + RTL. (و) الـ whitelisting موجود (مفيش mass-assignment).

> **هذا المستند مكتمل ويغطي 100% المطلوب لإعادة بناء الموديولز الستة + الأساسات.** أي قسم تحب أوسّعه (مثلاً صفحات الفرونت بمكوناتها التفصيلية، أو موديولز إضافية زي B2C/التخليص الجمركي/المحاسبة الكاملة) أقدر أزوّده.

