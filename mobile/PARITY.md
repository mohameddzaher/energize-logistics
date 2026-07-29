# Mobile ↔ Web Parity Tracker

الهدف: كل صفحة وكل فعل في السيستم الويب يعمل ناتيف في التطبيق ١٠٠٪.
- [x] = ناتيف كامل في التطبيق  |  [~] = موجود جزئيًا (مذكور الناقص)  |  [ ] = لم يُنقل بعد
- المحرك: lib/resource (CRUD عام) + شاشات مخصصة للتدفقات المركبة.
- تحديث هذا الملف إلزامي مع كل دفعة.

## حالة الدفعات
- v1–v7 (2026-07-28): أساس التطبيق + ١٠ أقسام أولية — التفاصيل أدناه.

## الرئيسية / Main (`system/`)
- [x] `main/executive` — النظرة التنفيذية ✓ (١٢ بطاقة عبر الأقسام: تشغيل/B2C/محفظة/ورشة/طاقم/خدمة + أنشط السائقين)
- [x] `main/dashboard` — اللوحة المالية ✓ (مستحق/تحصيل شهري وسنوي/نسبة/DSO/متأخرات)
- [x] `main/overdue` — الفواتير المتأخرة ✓ (أيام التأخير+الإجمالي+بحث)
- [x] `main/credit-alerts` — تنبيهات الائتمان ✓ (نسبة الاستخدام+تجاوز/قرب الحد)
- [ ] `main/low-visit-customers` — العملاء منخفضو الزيارة — API: /api/tasks/low-visit-customers

## العملاء والمالية / Customers & Finance
- [~] `customers` — العملاء ✓ (قائمة+بحث+ملف موجز+إنشاء/تعديل+إيقاف/تفعيل) — باقي: export
- [x] `customers/[id]` — ملف العميل ✓ (أرصدة+ائتمان+تبويبا الفواتير والمدفوعات؛ النقرة تفتح الملف والضغط المطول ملخصًا)
- [~] `invoices` — الفواتير ✓ (قائمة+فلاتر+تحصيل كامل+إنشاء) — باقي: refund/freeze
- [ ] `invoices/[id]` — تفاصيل الفاتورة — status/freeze/refund/record payment — API: /api/invoices/${id}
- [~] `payments` — المدفوعات ✓ (قائمة+بحث+إجمالي+تسجيل دفعة على فاتورة) — باقي: التخصيص الجماعي FIFO
- [x] `collections` — متابعات التحصيل ✓ (المعلّقة + إنهاء بمبلغ محصّل)
- [ ] `collectors` + `collectors/[id]` — المحصلين وأداؤهم — API: /api/analytics/performance
- [ ] `tasks` — المهام — CRUD + AI suggestions — API: /api/tasks
- [x] `disputes` — النزاعات ✓ (فلاتر الحالة + بدء مراجعة + حل بقرار)

## العمليات / Operations
- [x] `operations` — التشغيل ✓ (قائمة+إحصائيات+فلاتر مرحلة+تقدّم المرحلة+تفاصيل كاملة+بحث خادم+ترقيم)
- [~] `operations` كشوف التخريج ✓ عرض/تقدّم — باقي: الإنشاء اليدوي والاستيراد الجماعي و lock
- [ ] `operations/[id]` — مراجعة التشغيل — stage/lock/attachments — API: /api/workflows/${id}
- [ ] `operations/dispatch-sheets` — كشوف التخريج
- [x] `vendors` — الموردون ✓ CRUD (بحث+فئة+مستحق)
- [x] `b2c-wallet` — عهد المشاريع ✓ (قائمة المديرين للمشرف + دفتر العهدة برصيد/وارد/صادر + تسجيل حركة)
- [ ] `wallet-dashboard` (+branch/[id]) — لوحة المحفظة
- [ ] `vehicle-analytics/*` (5 صفحات) — تحليلات المركبات (IndexedDB محلي — يحتاج تصميم خاص للموبايل)

## منصة الأوبريشن (B2B) / ops
- [x] `ops` — لوحة الأوبريشن ✓ (بطاقات أرقام المنصة الحية)
- [x] `ops/shipments` — الشحنات ✓ الحالة + الجدول الزمني الكامل
- [~] `ops/drivers`, `cars`, `car-owners`, `users`, `branches`, `cities`, `countries`, `truck-types`, `truck-sizes`, `load-types`, `car-brands`, `car-colors` ✓ (قوائم+بحث+تفاصيل) — باقي: التحرير الإداري وملفات [id] الموسعة
- [x] `ops/my-tasks` ✓ `ops/complaints` ✓ `ops/kpis` ✓

## طلبات الشحنات / shipment-orders
- [x] `shipment-orders` — الشحنات ✓ (قائمة+فلاتر+تغيير حالة+فتح للتعديل)
- [x] `shipment-orders/new` — طلب شحنة جديد ✓ نموذج ديناميكي من fields + عميل/شاحنة inline + سعر المسار التلقائي + تعديل
- [ ] `shipment-orders/chat` — مساعد الإنشاء
- [x] `shipment-orders/customers` — العملاء — CRUD
- [x] `shipment-orders/fleet` — الموردون ✓ والمركبات ✓ — CRUD
- [ ] `shipment-orders/form-settings` — إعدادات النموذج

## إدارة الأسطول / fleet
- [x] `fleet/board` — اللوحة الرئيسية — فلاتر الحالات + مجموعات المشرفين + كروت حية
- [x] `fleet/page` — الحمولات — بحث/فلاتر حالات/إنشاء
- [x] `fleet/[id]` — تفاصيل الحمولة — تغيير حالة + متابعة + سجل الأحداث الكامل
- [x] `fleet/new` — شحنة جديدة — عميل (+جديد)/عربية بتوافر لحظي/سواق/مدن/مواعيد
- [~] `fleet/drivers` — السائقون — CRUD ✓ (ناقص: bench بسبب + ربط عربية من الفورم)
- [~] `fleet/vehicles` — سياراتنا — CRUD ✓ (ناقص: تعيين مشرف من الشاشة)
- [x] `fleet/customers` — العملاء — CRUD
- [x] `fleet/dashboard` ✓ (مضاف كـ DashSpec)
- [ ] `fleet/assign` — توزيع المشرفين bulk
- [x] `fleet/my-tasks` ✓ `complaints` ✓ `kpis` ✓

## التخليص الجمركي / customs
- [x] `customs` — قائمة التخليص — CRUD كامل بالمراحل الـ11
- [x] `customs/[id]` — تفاصيل التخليص ✓ (مسار ١١ مرحلة بتقدّم بلمسة + مهام الإنجاز stageDone بتواريخها + تعديل التكاليف)
- [ ] `customs/guide` — الدليل
- [x] `customs/analytics` — التحليلات ✓ (DashSpec)
- [x] `customs/my-tasks` + `complaints` + `kpis`

## المركبات / vehicles
- [x] `vehicles` — قسم كامل ✓: اللوحة + المركبات (CRUD) + تفاصيل المركبة (تفويض/نقل/إلغاء/سجل تفويضات) + الحوادث (قائمة+تسجيل) + KPIs

## لوكيشن سوليوشن / ls2
- [~] `ls2/live`-style — قائمة المركبات بالصيانة والعداد ✓ (شاشة واحدة — ناقص باقي الصفحات)
- [~] `ls2` — اللوحة ✓ | `ls2/[id]` ✓ (نظرة عامة/صيانة+تسجيل خدمة بقائمة الفحص+مؤجلات/رحلات/مسافة+وقود/تنبيهات) — باقي: registry | tires | temperature | maintenance (fleet-wide) | reports | settings (drivers ✓ بالتفاصيل)
- [x] `ls2/fleet-assets` — الكاوتشات ✓ بكل العمليات (تسجيل/فك بوجهة+نسبة حالة/تركيب مع مصير القاطن/نتيجة التجديد/إتلاف) + بطاقات فلترة

## الورشة / workshop
- [x] `workshop/purchases` — المشتريات — تسجيل=استلام + حذف
- [~] `workshop` — طلبات الصيانة ✓ اللوحة ✓ `inventory` ✓ (إضافة صنف+صرف بمصير القطعة المستبدلة) `my-tasks`/`complaints`/`kpis` ✓ — باقي: `store` الشامل | `tasks` أوامر الشغل

## تقييم الأداء / performance
- [ ] `performance` + `overview` + `evaluate/[id]` + `requests` + `settings`

## التسويق / marketing
- [x] `marketing/campaigns` — الحملات — CRUD
- [~] `marketing` — اللوحة ✓ `activities` ✓ (إنشاء+فلاتر منصة+مقاييس) `my-tasks`/`complaints`/`kpis` ✓ — باقي: `campaigns/[id]` | `reports`

## تطوير الأعمال / bd
- [x] `bd/opportunities` — CRUD (ناقص صفحة تفاصيل الفرصة بسجل نشاطها)
- [x] `bd/partners` — CRUD
- [x] `bd/tenders` — CRUD
- [~] `bd` — اللوحة ✓ `opportunities/[id]` ✓ (تفاصيل+نقل مرحلة+سجل أنشطة+تسجيل نشاط) `my-tasks`/`complaints`/`kpis` ✓

## الشؤون الإدارية / administration
- [x] `administration` — لوحة المهام كاملة (إنشاء/تعديل/حذف/نقل/محادثة/إسناد)

## إدارة العقود / contracts
- [x] `contracts` — اللوحة | [x] `vendors` CRUD (ناقص مرفقات) | [x] `analysis` | [x] `prospects` + تحويل | [~] `agreements` CRUD (ناقص مرفقات)
- [x] `vendors/[id]` — الملف التحليلي ✓ (حالة العقد+السعة+التشغيل الشهري بنِسَب الاستغلال) — باقي: المرفقات | `my-tasks`/`complaints`/`kpis` ✓

## البرمجيات وتقنية المعلومات / it
- [~] `tickets` ✓ `systems` ✓ `stock` ✓ `custody` ✓ (تسليم/نقل/إرجاع/إبلاغ/إخراج/سجل) `my-tasks`/`complaints`/`kpis` ✓ — باقي: recurring (اللوحة ✓)

## B2C / b2c
- [~] `reps` ✓ `projects` ✓ `daily-entry` ✓ `kpis` ✓ اللوحة ✓ — باقي: reps-performance/custody

## العمل عن بُعد / remote
- [~] `attendance` ✓ `leave` ✓ (طلب + قرار) `tasks` ✓ `report` ✓ `chat` ✓ (محادثات المشرف + مباشرة) `announcements` ✓ — باقي: dashboard/kpis

## الموارد البشرية / hr
- [x] `hr/dashboard` — اللوحة
- [x] `hr/employees` — قائمة + بحث + ملف الموظف الكامل (بيانات/عقود/إجازات/عهد/مستندات + تعديل) — ناقص: إنشاء موظف جديد + رفع مستندات
- [~] `employees/[id]` ✓ (٥ تبويبات+تعديل+إنشاء عقد) `employees` إنشاء ✓ `leaves` ✓ `requests` ✓ `licenses` ✓ `leave-types` ✓ — باقي: `custody`/`stock` HR | رفع مستندات

## الخدمة الذاتية
- [x] `hr/me` — ملفي ✓ (بيانات+عقد نشط+رصيد إجازات+عهدي+آخر إجازاتي) ضمن الخدمة الذاتية
- [x] `hr/my-leaves` — إجازاتي (رصيد/طلب/إلغاء)
- [x] `hr/my-requests` — طلباتي
- [x] موافقات فريقي (قرارات المدير)

## إدارة العلاقات / crm
- [x] `crm/companies` — CRUD ✓ + ملف الشركة [id] ✓ (بيانات/جهات اتصال/صفقات/مهام/سجل أنشطة — النقرة تفتح الملف والضغط المطول يحرر)
- [x] `crm/contacts` — CRUD
- [~] `deals` ✓ `tasks` ✓ `activities` ✓ `dashboard` ✓ `my-tasks`/`complaints`/`kpis` ✓ | `companies/[id]` | `vendors` | `calendar`

## المبيعات / sales
- [~] `targets` CRUD ✓ | `dashboard` ✓ `my-tasks`/`complaints`/`kpis` ✓ | `pipeline` | `performance`

## الحسابات / accounting
- [~] `accounts` ✓ (فلاتر النوع+الأرصدة) `journal` ✓ (عرض+قيد متوازن ببنود ديناميكية) اللوحة ✓ `my-tasks`/`complaints`/`kpis` ✓ — باقي: التقارير الأربعة/ledger/trial-balance

## المشتريات / procurement
- [~] `requests` ✓ (المسار كامل: مسودة←اعتماد←أمر شراء) `orders` ✓ (استلام) `bills` ✓ (دفعات) `dashboard` ✓ `my-tasks`/`complaints`/`kpis` ✓

## الأدوات / tools
- [ ] `kpis` — مؤشرات الأداء | `assistant` — المساعد | `settings` (كلمة مرور/توقيعات) | `reports`

## الإدارة / admin
- [x] `branches` ✓ `expense-categories` ✓ `users` ✓ (إنشاء/تعديل/حذف/فلترة) `permissions` ✓ (دور×قسم) — باقي: `settings/reference-data` | `audit` | `complaints` | `drivers` | `vendors`

## البوابة / portal (عملاء خارجيون)
- [ ] `portal` | `invoices` (+[id]) | `payments`

## مشترك / خاص
- [x] الإشعارات ✓ (صفحة ضمن الخدمة الذاتية: غير المقروءة+قراءة الكل) — باقي: شارة عدّاد حية في الهيدر
- [x] تبديل اللغة AR/EN فوري + RTL
- [x] بوابة الصلاحيات (roles + matrix) في القوائم
- [ ] التصدير (Excel/PDF/مشاركة) في القوائم والتقارير
- [~] المرفقات والرفع (موجود في الباك — ناقص واجهات الرفع في العقود والموظفين…)
- [x] SectionWork موحّد ✓ (مهامي/الشكاوى في ١٢ قسم) + TeamBoard ✓ (تقييم الأداء في كل الأقسام — عرض الدرجات؛ نموذج التقييم التفصيلي لاحقًا)
- [x] OpsResourceScreen موحّد ✓ — 13 جدولًا ببحث الخادم وترقيم الصفحات وتفاصيل كاملة
