# Mobile ↔ Web Parity Tracker

الهدف: كل صفحة وكل فعل في السيستم الويب يعمل ناتيف في التطبيق ١٠٠٪.
- [x] = ناتيف كامل في التطبيق  |  [~] = موجود جزئيًا (مذكور الناقص)  |  [ ] = لم يُنقل بعد
- المحرك: lib/resource (CRUD عام) + شاشات مخصصة للتدفقات المركبة.
- تحديث هذا الملف إلزامي مع كل دفعة.

## حالة الدفعات
- v1–v7 (2026-07-28): أساس التطبيق + ١٠ أقسام أولية — التفاصيل أدناه.

## الرئيسية / Main (`system/`)
- [ ] `main/executive` — النظرة التنفيذية — VIEWS: company-wide executive KPI tiles — ACTIONS: read-only — API: aggregated
- [ ] `main/dashboard` — لوحة التحكم — VIEWS: financial + ops overview (aging/DSO/forecast/risk/credit alerts…) — API: /api/analytics/*
- [ ] `main/overdue` — متأخرات — API: /api/analytics/overdue
- [ ] `main/credit-alerts` — تنبيهات الائتمان — API: /api/analytics/credit-alerts
- [ ] `main/low-visit-customers` — العملاء منخفضو الزيارة — API: /api/tasks/low-visit-customers

## العملاء والمالية / Customers & Finance
- [ ] `customers` — العملاء — CRUD + stop/unstop + export — API: /api/customers
- [ ] `customers/[id]` — ملف العميل — profile+invoices+payments+risk+credit-term — API: multiple
- [ ] `invoices` — الفواتير — CRUD + mark-paid + refund — API: /api/invoices
- [ ] `invoices/[id]` — تفاصيل الفاتورة — status/freeze/refund/record payment — API: /api/invoices/${id}
- [ ] `payments` — المدفوعات — create/bulk/auto-allocate — API: /api/payments
- [ ] `collections` — التحصيلات — complete/promise/follow-ups — API: /api/collections
- [ ] `collectors` + `collectors/[id]` — المحصلين وأداؤهم — API: /api/analytics/performance
- [ ] `tasks` — المهام — CRUD + AI suggestions — API: /api/tasks
- [ ] `disputes` — النزاعات — CRUD/resolve — API: /api/disputes

## العمليات / Operations
- [ ] `operations` — التشغيل — workflows list/stats/stage/bulk — API: /api/workflows
- [ ] `operations/new` — طلب تشغيل جديد — create + bulk-import — API: /api/workflows
- [ ] `operations/[id]` — مراجعة التشغيل — stage/lock/attachments — API: /api/workflows/${id}
- [ ] `operations/dispatch-sheets` — كشوف التخريج
- [ ] `vendors` — الموردين — CRUD — API: /api/vendors
- [ ] `wallet` — المحفظة — transactions/close-day/reopen — API: /api/wallet
- [ ] `wallet-dashboard` (+branch/[id]) — لوحة المحفظة
- [ ] `vehicle-analytics/*` (5 صفحات) — تحليلات المركبات (IndexedDB محلي — يحتاج تصميم خاص للموبايل)

## منصة الأوبريشن (B2B) / ops
- [ ] `ops` — لوحة الأوبريشن — API: /api/ops/dashboard
- [ ] `ops/shipments` — الشحنات — status+timeline — API: /api/ops/shipments
- [ ] `ops/drivers` (+[id]), `cars`, `car-owners`, `users` (+[id]), `branches`, `cities`, `countries`, `truck-types`, `truck-sizes`, `load-types`, `car-brands`, `car-colors` — جداول CRUD (13 صفحة) — API: /api/ops/* — ملائمة تمامًا لمحرك الـ CRUD
- [ ] `ops/my-tasks` + `ops/complaints` (SectionWork) + `ops/kpis` (TeamBoard)

## طلبات الشحنات / shipment-orders
- [ ] `shipment-orders` — الشحنات — status/edit/delete/export
- [ ] `shipment-orders/new` — طلب شحنة جديد (نموذج ديناميكي fields)
- [ ] `shipment-orders/chat` — مساعد الإنشاء
- [ ] `shipment-orders/customers` — العملاء — CRUD
- [ ] `shipment-orders/fleet` — الموردون والمركبات — CRUD
- [ ] `shipment-orders/form-settings` — إعدادات النموذج

## إدارة الأسطول / fleet
- [x] `fleet/board` — اللوحة الرئيسية — فلاتر الحالات + مجموعات المشرفين + كروت حية
- [x] `fleet/page` — الحمولات — بحث/فلاتر حالات/إنشاء
- [x] `fleet/[id]` — تفاصيل الحمولة — تغيير حالة + متابعة + سجل الأحداث الكامل
- [x] `fleet/new` — شحنة جديدة — عميل (+جديد)/عربية بتوافر لحظي/سواق/مدن/مواعيد
- [~] `fleet/drivers` — السائقون — CRUD ✓ (ناقص: bench بسبب + ربط عربية من الفورم)
- [~] `fleet/vehicles` — سياراتنا — CRUD ✓ (ناقص: تعيين مشرف من الشاشة)
- [x] `fleet/customers` — العملاء — CRUD
- [ ] `fleet/dashboard` — لوحة التحليلات — API: /api/fleet/dashboard
- [ ] `fleet/assign` — توزيع المشرفين bulk
- [ ] `fleet/my-tasks` + `complaints` (SectionWork) + `kpis` (TeamBoard)

## التخليص الجمركي / customs
- [ ] `customs` — قائمة التخليص — CRUD + status
- [ ] `customs/[id]` — تفاصيل التخليص (pipeline 11 مرحلة + checklists)
- [ ] `customs/guide` — الدليل
- [ ] `customs/analytics` — التحليلات
- [ ] `customs/my-tasks` + `complaints` + `kpis`

## المركبات / vehicles
- [ ] `vehicles/dashboard` + `vehicles` + `vehicles/[id]` (تفويض/نقل/حوادث) + `accidents` + `kpis`

## لوكيشن سوليوشن / ls2
- [~] `ls2/live`-style — قائمة المركبات بالصيانة والعداد ✓ (شاشة واحدة — ناقص باقي الصفحات)
- [ ] `ls2` — لوحة التتبع | `ls2/registry` | `ls2/[id]` (تفاصيل+مسار+وقود) | `drivers` | `tires` | `temperature` | `maintenance` (+تسجيل خدمة وتأجيلات) | `fleet-assets` (كاوتش/تيدرات + عمليات) | `repairs` | `alerts` | `reports` | `settings` | `kpis`

## الورشة / workshop
- [x] `workshop/purchases` — المشتريات — تسجيل=استلام + حذف
- [ ] `workshop` — طلبات الصيانة | `store` — المستودع | `dashboard` | `tasks` — أوامر شغل | `inventory` | `my-tasks`/`complaints`/`kpis`

## تقييم الأداء / performance
- [ ] `performance` + `overview` + `evaluate/[id]` + `requests` + `settings`

## التسويق / marketing
- [x] `marketing/campaigns` — الحملات — CRUD
- [ ] `marketing` — اللوحة | `campaigns/[id]` تفاصيل | `activities` | `reports` | `my-tasks`/`complaints`/`kpis`

## تطوير الأعمال / bd
- [x] `bd/opportunities` — CRUD (ناقص صفحة تفاصيل الفرصة بسجل نشاطها)
- [x] `bd/partners` — CRUD
- [x] `bd/tenders` — CRUD
- [ ] `bd` — اللوحة | `opportunities/[id]` | `my-tasks`/`complaints`/`kpis`

## الشؤون الإدارية / administration
- [x] `administration` — لوحة المهام كاملة (إنشاء/تعديل/حذف/نقل/محادثة/إسناد)

## إدارة العقود / contracts
- [x] `contracts` — اللوحة | [x] `vendors` CRUD (ناقص مرفقات) | [x] `analysis` | [x] `prospects` + تحويل | [~] `agreements` CRUD (ناقص مرفقات)
- [ ] `vendors/[id]` — الملف التحليلي بالجداول والمرفقات | `my-tasks`/`complaints`/`kpis`

## البرمجيات وتقنية المعلومات / it
- [ ] `it` لوحة | `tickets` (+[id]) | `recurring` | `custody` (تعيين/نقل/إرجاع/عطل/تسليم) | `stock` | `systems` | `my-tasks`/`complaints`/`kpis`

## B2C / b2c
- [ ] `dashboard` | `reps-performance` | `daily-entry` | `reps` | `projects` | `custody` (عهدة) | `kpis`

## العمل عن بُعد / remote
- [ ] `attendance` (check-in/out) | `dashboard` | `leave` | `chat` | `tasks` | `report` | `announcements` | `kpis`

## الموارد البشرية / hr
- [x] `hr/dashboard` — اللوحة
- [~] `hr/employees` — قائمة + بحث + ملف مختصر (ناقص: إنشاء/تعديل + ملف الموظف الكامل بالمستندات)
- [ ] `employees/[id]` كامل | `contracts` | `leaves` (قرارات HR) | `requests` (ردود) | `custody` | `stock` | `licenses` | `leave-types` | `my-tasks`/`complaints`/`kpis`

## الخدمة الذاتية
- [ ] `hr/me` — ملفي (عرض + تعديل)
- [x] `hr/my-leaves` — إجازاتي (رصيد/طلب/إلغاء)
- [x] `hr/my-requests` — طلباتي
- [x] موافقات فريقي (قرارات المدير)

## إدارة العلاقات / crm
- [x] `crm/companies` — CRUD (ناقص: التقييم rate + ملف الشركة [id])
- [x] `crm/contacts` — CRUD
- [ ] `dashboard` | `companies/[id]` | `vendors` | `deals` (+نقل مرحلة) | `tasks` | `calendar` | `activities` | `my-tasks`/`complaints`/`kpis`

## المبيعات / sales
- [ ] `dashboard` | `pipeline` | `targets` CRUD | `performance` | `my-tasks`/`complaints`/`kpis`

## الحسابات / accounting
- [ ] `dashboard` (+sync) | `accounts` (+ledger) | `journal` | `trial-balance` | `profit-loss` | `receivables` | `payables` | `my-tasks`/`complaints`/`kpis`

## المشتريات / procurement
- [ ] `dashboard` | `requests` (submit/decision/convert) | `orders` (receive) | `bills` (pay) | `my-tasks`/`complaints`/`kpis`

## الأدوات / tools
- [ ] `kpis` — مؤشرات الأداء | `assistant` — المساعد | `settings` (كلمة مرور/توقيعات) | `reports`

## الإدارة / admin
- [ ] `branches` | `expense-categories` | `settings/reference-data` | `users` (كامل) | `permissions` | `audit` | `complaints` | `drivers` | `vendors`

## البوابة / portal (عملاء خارجيون)
- [ ] `portal` | `invoices` (+[id]) | `payments`

## مشترك / خاص
- [ ] جرس الإشعارات + شارة غير المقروء
- [x] تبديل اللغة AR/EN فوري + RTL
- [x] بوابة الصلاحيات (roles + matrix) في القوائم
- [ ] التصدير (Excel/PDF/مشاركة) في القوائم والتقارير
- [~] المرفقات والرفع (موجود في الباك — ناقص واجهات الرفع في العقود والموظفين…)
- [~] SectionWork موحّد ✓ (مهامي/الشكاوى في ٧ أقسام: أسطول/عقود/علاقات/HR/تسويق/تطوير أعمال/ورشة) — باقي TeamBoard (kpis)
- [ ] OpsResourceTable موحّد لجداول /api/ops/* (13 صفحة دفعة واحدة)
