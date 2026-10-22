const { isFinanceFull, FINANCE_FULL_ROLES } = require('../config/financeAuthority');
const mongoose = require('mongoose');
const OperationsWorkflow = require('../models/OperationsWorkflow');
const { startOfDay, endOfDay, DAY_MS: COMPANY_DAY_MS } = require('../utils/companyDay');
const { flexSpaceRegex } = require('../utils/plateKey');
const logAudit = require('../utils/auditLogger');
const { emitToAll, emitPerRole } = require('../websocket/socketManager');
const {
  derivePaymentTypeFor, hasTaxInvoice, NO_INVOICE_RX, isUnified, hasIssuedInvoice, ISSUED_INVOICE_QUERY,
  normalizePaymentChoice, paymentKindCondition, PAYMENT_KIND_EXPR, paymentKindLabel,
} = require('../utils/paymentType');
const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');
const cache = require('../utils/ttlCache');

// Field-level permission groups
const FIELD_GROUPS = {
  application: [
    'reportNumber', 'reportDate', 'fromLocation', 'toLocation', 'branch',
    'carOwner', 'carNumber', 'ownerType', 'executionStatus',
    'applicationStatus', 'paymentMethod', 'username', 'taxIndicator',
    'purchaseValue',
    'loadingTime', 'driverRentalType', 'reference', 'userPhone',
    'driverName', 'driverPhone', 'carName', 'plateNumber',
    'truckType', 'truckSize', 'loadType', 'quantity',
    'goodsValue', 'representativeName', 'country',
    'ownerName', 'ownerPhone', 'region', 'product', 'invoiceRef',
    'driverCost', 'loadNumber', 'volume',
  ],
  operations: [
    'operationsReview',
  ],
  manual_moderator: [
    // `paymentSubtype` يتبع `paymentType` حيث كان: مَن يختار النوعَ يختار تفصيلَه.
    'paymentDate', 'payingBranch', 'paymentAmount', 'paymentType', 'paymentSubtype',
    'finalReportDestination', 'documentNumber', 'sendingDate', 'branchDeliveryDate', 'deliveryDate',
  ],
  // ── ومراجعةُ الحسابات مجموعةٌ بذاتها ────────────────────────────────────
  // كانت داخل `manual_moderator` فورثها كلُّ من يسجّل سدادًا. وهي إقرارُ
  // المحاسبة بأنّ الصفَّ رُوجع — لا خطوةً في تسجيل السداد. وبقاؤها هناك يجعل
  // مَن يكتب رقمَ السند يوقّع على مراجعة نفسِه.
  accounting: [
    'accountingReview',
  ],
  collections: [
    'invoiceNumber', 'netInvoice', 'tax', 'totalInvoice',
    'invoiceDate', 'invoiceNotes', 'collectedAmount', 'collectionDate',
  ],
  // ── وقيمةُ البيع مجموعةٌ بذاتها ─────────────────────────────────────────
  // كانت بين أعمدة الأبلكيشن فيراها كلُّ مَن يفتح الصفحة. وهي سعرُنا للعميل:
  // يراها ويكتبها مديرُ التشغيل والمبيعاتُ والإدارةُ وأهلُ المال والتحصيل
  // (صاحبُ الشركة، ٢٠٢٦/١٠/٢١) — لا موظّفُ التشغيل. وتُكتب معها في المنصّة.
  selling: ['sellingValue'],
};

// Which roles can edit which field groups
// ── مَن يكتب ماذا ───────────────────────────────────────────────────────────
//
// كانت هذه الخريطةُ مكتوبةً بأسماءِ أدوارٍ قديمة، ثمّ أُعيد بناءُ الأدوار إلى
// مديرٍ وموظّفٍ لكلّ قسم — فصار `operations_staff` يصل إلى نقطة التعديل ولا
// يجد لنفسه سطرًا هنا. ومَن لا سطرَ له يأخذ مصفوفةً فارغة: تُحذَف حقولُه كلُّها
// ويُحفظ المستند بلا تغيير، ويرجع ٢٠٠. فالموظّف يكتب تاريخَ السداد ورقمَ السند
// ويضغط «صح» فلا يتغيّر شيءٌ ولا يُقال له لماذا.
//
// وقسمُ العمليات هو صاحبُ هذا العمل: تسجيلُ السداد والسند والإرسال والتسليم
// عملُه اليوميّ لا استثناء. فيأخذه مديرُه وموظّفُه.
//
// ── وأعمدةُ الفاتورة ليست له ──────────────────────────────────────────────
// أُعطيت العملياتِ ضمنَ «أعطِه كلَّ شيء» حين عولج عطلُ «صح كانت تحفظ لا شيء»،
// لا بقرارٍ في مَن يملكها. وهي مالُ الشركة: رقمُ الفاتورة وصافيها وضريبتُها
// وإجماليها وتاريخُ تحصيلها — يملكها مَن يحاسِب ومَن يحصّل. فرُدَّت إليهم.
//
// ولا تُخفى عن الشاشة وتبقى مكتوبةً على الخادم: مَن يقرأ الخريطةَ يظنّها
// محروسة، والحجبُ في مكانٍ واحدٍ حجبٌ في نصف الطريق.
const OPS_FIELDS = [
  ...FIELD_GROUPS.application, ...FIELD_GROUPS.operations,
  ...FIELD_GROUPS.manual_moderator,
];
// أعمدةُ المال: الفاتورةُ والتحصيلُ ومراجعةُ الحسابات.
const MONEY_FIELDS = [...FIELD_GROUPS.collections, ...FIELD_GROUPS.accounting];
// الكشفُ كلُّه — لمن لا حاجزَ عليه (عدا قيمة البيع: لها قائمتُها أدناه).
const ALL_FIELDS = [...OPS_FIELDS, ...MONEY_FIELDS];
const SELLING_FIELDS = FIELD_GROUPS.selling;
// الكشفُ كلُّه ومعه قيمةُ البيع.
const FULL_FIELDS = [...ALL_FIELDS, ...SELLING_FIELDS];

// ── مَن يرى قيمةَ البيع ويكتبها ─────────────────────────────────────────────
// القائمةُ بأسمائها كما قالها صاحبُ الشركة (٢٠٢٦/١٠/٢١، آخرَ مرّة): مديرُ
// النظام، والإدارة، والمديرُ الماليّ، ومديرُ الحسابات، ومديرُ التحصيل وفريقُه،
// والمحاسب، ومديرُ التشغيل — و«المديرُ العامّ» إن أُنشئ له دور (`general_manager`).
// والمبيعاتُ وتقنيةُ المعلومات خرجا منها. ومَن ليس فيها لا تصله القيمةُ من
// الخادم أصلًا (`stripRowFor`) ولا يفلتر بها ولا تخرج في ملفّه — ولا يكتبها.
const SELLING_ROLES = [
  'super_admin', 'admin', 'cfo', 'accounting_manager', 'accountant',
  'collections_manager', 'collections_staff', 'operations_manager', 'general_manager',
  // فريقُ البيانات (٢٠٢٦/١٠/٢٢) — ومديرُ النظام يضيّق قسمَ التشغيل من المصفوفة.
  ...require('../config/roles').DATA_ROLES,
];

const ROLE_FIELD_ACCESS = {
  super_admin: FULL_FIELDS,
  // فريقُ البيانات: كلُّ الحقول، و«عرض» القسم في المصفوفة يمنع الكتابةَ قبلها.
  ...Object.fromEntries(require('../config/roles').DATA_ROLES.map((r) => [r, FULL_FIELDS])),
  moderator: [...FIELD_GROUPS.application, ...FIELD_GROUPS.manual_moderator],
  operations_manager: [...OPS_FIELDS, ...SELLING_FIELDS],
  operations_staff: OPS_FIELDS,
  // الإدارةُ العليا فوق المحاسبة لا دونَها.
  admin: FULL_FIELDS,
  // ── والمبيعاتُ تملك قيمةَ البيع وحدَها ─────────────────────────────────
  // تفتح سير العمل لتسعّر الكشف، ولا تكتب في غيره ولا ترى أعمدةَ الفاتورة.
  employee: FIELD_GROUPS.collections,
  // ── والمحاسبةُ تسجّل السدادَ كما تسجّل الفاتورة ──────────────────────────
  // كانت تملك مجموعةَ الفاتورة وحدَها، فيكتب المحاسبُ تاريخَ السداد ويضغط
  // «صح» فيُردُّ ٤٠٣ ولا يُحفظ شيء — وهو عملُه اليوميّ لا استثناء.
  //
  // وهي الغلطةُ نفسُها التي وقعت مع موظّف العمليات من قبل: قائمةٌ تُكتب دورًا
  // دورًا فيُنسى فيها ما يعمله صاحبُها كلَّ يوم. ولذلك لم يعد الأمرُ قائمةً
  // وحدَها — الشاشةُ صارت تقرأ الخريطةَ نفسَها فلا تعرض خانةً لن تُحفَظ.
  cfo: FULL_FIELDS,
  accounting_manager: FULL_FIELDS,
  accountant: FULL_FIELDS,
  // ── وقسمُ التحصيل يكتب الكشفَ كلَّه ───────────────────────────────────────
  // أعمدةُ المال وحدَها لا تكفيه: مَن يلاحق فاتورةً يصحّح معها اسمَ العميل
  // ورقمَ السند والفرعَ المسدِّد ووجهةَ الكشف النهائيّة — وكلُّها خارجَ
  // `MONEY_FIELDS`. فيصير كلَّ يومٍ يطلب من قسم العمليات تصحيحَ خانةٍ يراها
  // أمامه، أو يُقال له «حُفِظ» ولم يُحفَظ شيء.
  collections_manager: FULL_FIELDS,
  collections_staff: FULL_FIELDS,
  // تقنيةُ المعلومات في `FULL_ACCESS_ROLES` — بلا حاجزٍ في كلّ قسمٍ آخر،
  // إلّا قيمةَ البيع: ليست في القائمة التي سمّاها صاحبُ الشركة.
  it_manager: ALL_FIELDS,
  it_specialist: ALL_FIELDS,
};
// الخريطةُ والقائمةُ تقولان شيئًا واحدًا — يُفحص عند التحميل كي لا تفترقا.
for (const [r, f] of Object.entries(ROLE_FIELD_ACCESS)) {
  if (f.includes('sellingValue') !== SELLING_ROLES.includes(r)) {
    throw new Error(`[workflow] قيمةُ البيع: ${r} في الخريطة غيرُه في SELLING_ROLES`);
  }
}

/**
 * ── والحجبُ يكون على الطرفين ────────────────────────────────────────────────
 *
 * إخفاءُ عمودٍ من الجدول لا يحجبه: النقطةُ ترجّع المستندَ كاملًا، فيُقرأ في
 * أدوات المتصفّح ويخرج في ملفّ الإكسل. والحجبُ في مكانٍ واحدٍ حجبٌ في نصف
 * الطريق، ويُقرأ أسوأَ من غيابه — لأنّ مَن رآه مخفيًّا يحسبه محجوبًا.
 *
 * فمن لا يملك أعمدةَ المال لا تصله أصلًا: لا في القائمة، ولا في التفاصيل، ولا
 * في التصدير. والقاعدةُ هي هي التي يفلتر بها الحفظُ — خريطةٌ واحدة.
 */
/**
 * ── حقولُ الدورِ المصنوع تأتي من مصفوفة الصلاحيّات ──────────────────────────
 *
 * `ROLE_FIELD_ACCESS` أعلاه مكتوبٌ بمفاتيح الأدوار التي في الشيفرة. والدورُ
 * الذي يصنعه صاحبُ النظام من الشاشة ليس فيها، فيخرج من الخريطة بصفر حقول:
 * يُفتَح له قسمُ العمليات ويُمنح «تعديل» في المصفوفة، ثمّ لا يجد في سير العمل
 * خانةً واحدةً يكتب فيها — ولا رسالةَ خطأ، فيبدو أنّ الشاشة معطوبة. وقع فعلًا
 * مع «فريق العمليات» (operation_team).
 *
 * والعلّةُ أنّ «مَن يكتب» كان يُقرأ من مكانين: مصفوفةُ الصلاحيّات تفتح القسم،
 * وهذه الخريطةُ تقرّر الخانات، ولا جسرَ بينهما. فالجسرُ هنا: الدورُ المصنوعُ
 * يأخذ — في كلّ قسمٍ مُنح فيه «تعديل» — حقولَ موظّفِ ذلك القسم نفسِه. لا أكثر:
 * «عرض» لا يعطي خانةً تُكتب، وما لم يُمنَح لا يُورَّث.
 */
const SECTION_FIELD_SOURCE = {
  Operations: 'operations_staff',
  Collections: 'collections_staff',
  Accounting: 'accountant',
};
const FIELDS_TTL = 60 * 1000;
const fieldsCache = require('../utils/ttlCache');

const fieldsForRole = async (role) => {
  if (ROLE_FIELD_ACCESS[role]) return ROLE_FIELD_ACCESS[role];
  return fieldsCache.wrap(`wf:fields:${role}`, FIELDS_TTL, async () => {
    try {
      const { effectivePermissions, isCustomRole } = require('../utils/permissions');
      if (!(await require('../utils/permissions').inheritsNothing(role))) return [];
      const sections = await effectivePermissions(role);
      const out = new Set();
      for (const [section, source] of Object.entries(SECTION_FIELD_SOURCE)) {
        if (sections[section] === 'edit') for (const f of ROLE_FIELD_ACCESS[source] || []) out.add(f);
      }
      // وقيمةُ البيع لا تُورَّث: قائمتُها أدوارٌ بأسمائها (SELLING_ROLES)، والدورُ
      // المصنوعُ لا يراها في القائمة فلا يكتبها.
      for (const f of SELLING_FIELDS) out.delete(f);
      return [...out];
    } catch (e) {
      // تعذّرُ القراءة لا يفتح شيئًا: بلا حقولٍ حتى يُعرف الجواب.
      console.error('[workflow] fieldsForRole:', e.message);
      return [];
    }
  });
};

const canSeeMoney = (role) => {
  const f = ROLE_FIELD_ACCESS[role] || [];
  return MONEY_FIELDS.some((x) => f.includes(x));
};

/** يُزيل أعمدةَ المال من مستندٍ (أو مصفوفةٍ منها) لمن لا يملكها. */
const stripMoney = (doc) => {
  if (!doc) return doc;
  const plain = typeof doc.toObject === 'function' ? doc.toObject() : { ...doc };
  for (const f of MONEY_FIELDS) delete plain[f];
  return plain;
};
const stripMoneyFor = (role, docs) => {
  if (canSeeMoney(role)) return docs;
  return Array.isArray(docs) ? docs.map(stripMoney) : stripMoney(docs);
};

/** هل يرى هذا الدورُ قيمةَ البيع؟ — القائمةُ بأسمائها (SELLING_ROLES). */
const canSeeSelling = (role) => SELLING_ROLES.includes(role);
const stripSelling = (doc) => {
  if (!doc) return doc;
  const plain = typeof doc.toObject === 'function' ? doc.toObject() : { ...doc };
  delete plain.sellingValue;
  delete plain.sellingValueSource;
  return plain;
};
/**
 * الصفُّ كما يصل هذا الدور: بلا أعمدة المال لمن لا يملكها، وبلا قيمة البيع
 * لمن ليس في قائمتها. (`stripMoneyFor` تبقى كما هي — تقرؤها الصفحةُ الخاصّة
 * وقيمةُ البيع فيها سعرٌ آخر.)
 */
const stripRowFor = (role, docs) => {
  const out = stripMoneyFor(role, docs);
  if (canSeeSelling(role)) return out;
  return Array.isArray(out) ? out.map(stripSelling) : stripSelling(out);
};

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  قواعدُ الفوترة — تُطبَّق على الخادم، لا على الشاشة وحدَها
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * الشاشةُ تُعين المستخدمَ على الصواب؛ والخادمُ هو الذي يضمنه. وقاعدةٌ مكتوبةٌ
 * في الواجهة وحدَها تُلتَفّ عليها من أيّ نافذة: تحديثٌ جماعيّ، أو استيراد، أو
 * نداءٌ مباشر.
 */

// ── أعمدةٌ كان القفلُ النقديُّ يُصفِّرها — وقد أُزيل ───────────────────────
//
// كانت هذه الأعمدةُ تُصفَّر وتُقفَل على كلّ كشفٍ نقديّ. وقد أُزيل ذلك
// (راجع deriveCashTotals): الكشفُ النقديّ يُكتَب فيه ما يلزم كغيره.
//
// وتبقى القائمةُ لعملٍ واحد: كشوفٌ قديمةٌ تحمل أصفارَ القفل وفراغاتِه إلى
// اليوم. فإن خرج كشفٌ منها من «كاش» مُسحت تلك القيمُ الموضوعةُ آليًّا — دون
// ما كتبه إنسان. راجع فرعَ `wasCash` أدناه.
const CASH_LOCKED_FIELDS = [
  'finalReportDestination', 'documentNumber', 'sendingDate',
  // التسليمان معًا: لا كشفَ يُسلَّم لفرعٍ ولا فاتورةَ تُسلَّم لعميلٍ في الكاش.
  'branchDeliveryDate', 'deliveryDate',
  'invoiceNumber', 'netInvoice', 'tax', 'totalInvoice', 'invoiceDate',
];
// ما يُكتب صفرًا وما يُترك فارغًا — الرقمُ صفرٌ والتاريخُ لا صفرَ له.
const CASH_ZERO_NUMERIC = new Set(['netInvoice', 'tax', 'totalInvoice']);
const VAT_RATE = 0.15;

/**
 * القيمُ التي تُثبَّت على كشفٍ نقديّ.
 *
 * ── والنصُّ يُفرَّغ ولا يُكتب «0» ──────────────────────────────────────────────
 * كان القفلُ يكتب «0» في الخانات النصّيّة أيضًا، فيصير للكشف النقديّ **رقمُ
 * فاتورةٍ اسمُه «0»**. وكلُّ ما يقرأ رقمَ الفاتورة يصدّقه: صفحةُ الفواتير
 * الضريبيّة تجمع الكشوفَ على الرقم فتصنع «فاتورة 0» تضمّ كشوفًا نقديّةً
 * وضريبيّةً لعملاءَ مختلفين، ودالّةُ «عليها فاتورة» تقلب الكشفَ إلى ضريبيّ.
 *
 * والصفرُ الرقميُّ يبقى: «صافي الفاتورة صفر» جملةٌ صحيحة، أمّا «رقم الفاتورة
 * صفر» فليست رقمًا بل خانةٌ فارغةٌ تتنكّر في صورة قيمة.
 */
function cashLockedValues() {
  const out = {};
  for (const f of CASH_LOCKED_FIELDS) out[f] = CASH_ZERO_NUMERIC.has(f) ? 0 : (f.endsWith('Date') ? null : '');
  return out;
}

/**
 * الضريبةُ والإجماليّ يُشتقّان من صافي الفاتورة، ولا يُكتبان.
 *
 * كان المحاسبُ يكتب الثلاثةَ بيده، فيُخطئ في واحدٍ منها فلا يساوي الإجماليُّ
 * مجموعَ ما تحته — ولا يُكتشف إلّا عند مطابقةِ حسابٍ بعد شهر. وهي معادلةٌ
 * ثابتة: الضريبةُ خمسةَ عشرَ بالمئة من الصافي، والإجماليُّ مجموعُهما.
 */
/**
 * ── والنقديُّ يُفوتَر بما دُفع، بلا ضريبةٍ وبلا رقمِ فاتورة ────────────────
 *
 * كان الكشفُ النقديُّ تُصفَّر أعمدتُه وتُقفَل: لا سندَ ولا فاتورةَ ولا تسليمَ
 * ولا تاريخ. والقصدُ كان صيانتَه من كتابةٍ لا معنى لها، وأثرُه أنّ الموظّفَ
 * يجد تسعةَ أعمدةٍ مقفولةً بأصفارٍ لا يستطيع تصحيحَها — وهي أعمدةٌ يحتاجها:
 * متى سُلِّمت الورقةُ للعميل، ومتى قُبض المال، وكم قُبض.
 *
 * فالقفلُ أُزيل. والكشفُ النقديّ كغيره يُكتَب فيه ما يلزم، وتبقى قاعدةٌ واحدةٌ
 * تُريح من عملٍ مكرّر: ما دُفع هو ما يُفوتَر. مبلغُ السداد يذهب إلى صافي
 * الفاتورة وإلى إجماليها معًا، والضريبةُ صفر — إذ لا ضريبةَ على نقدٍ. ورقمُ
 * الفاتورة يبقى فارغًا، فليست لها فاتورة.
 *
 * وما كتبه الموظّفُ بيده في هذه الكتابة يُحترَم: القاعدةُ تملأ الفارغَ ولا
 * تدهس القصد.
 */
function deriveCashTotals(patch, current) {
  const given = (f) => Object.prototype.hasOwnProperty.call(patch, f);
  const amount = Number(given('paymentAmount') ? patch.paymentAmount : current.paymentAmount) || 0;
  if (amount <= 0) return patch;

  // لا ضريبةَ على نقد — تُكتب صفرًا صراحةً لا تُترك فارغة.
  if (!given('tax')) patch.tax = 0;
  if (!given('netInvoice')) patch.netInvoice = amount;
  if (!given('totalInvoice')) patch.totalInvoice = amount;
  return patch;
}

function deriveInvoiceTotals(patch, current) {
  const hasNet = Object.prototype.hasOwnProperty.call(patch, 'netInvoice');
  if (!hasNet) return patch;
  const net = Number(patch.netInvoice) || 0;
  const vat = Math.round(net * VAT_RATE * 100) / 100;
  patch.tax = vat;
  patch.totalInvoice = Math.round((net + vat) * 100) / 100;
  return patch;
}

/**
 * ── ونوعُ الدفع يُكتب بيدٍ، ولا يُستنتَج من العميل ─────────────────────────
 *
 * كان يُقرأ من ملفّ العميل ويُملأ من نفسِه، على أنّ النوعَ صفةٌ ثابتةٌ فيه.
 * وليس كذلك: العميلُ الواحد يقول في حمولةٍ «حاسبوني كاش» وفي أخرى «افتحوا
 * فاتورة». النوعُ صفةُ **الشحنة** لا صفةُ الطرف.
 *
 * فاستنتاجُه من الملفّ يكتب على الكشف ما لم يقله أحد، ويرسله إلى صفحةِ تحصيلٍ
 * ليست له — وهو خطأٌ صامتٌ لا يُكتشف إلّا حين يُطالَب عميلٌ بفاتورةٍ اتُّفق على
 * نقدِها. ومن كتبه بيده يعرف ما اتُّفق عليه في تلك الحمولة.
 *
 * والتاريخُ محفوظٌ على كلّ حال: النوعُ مكتوبٌ على الكشف نفسِه، فيُعرَف بعد سنةٍ
 * أيُّ كشوفِ هذا العميل كانت نقدًا وأيُّها فاتورة.
 *
 * (بقيت الدالّةُ محذوفةً لا معطَّلة: دالّةٌ لا تُستدعى تُعاد يومًا بلا قراءةِ
 *  سببِ إزالتها.)
 */

/**
 * يُطبِّق قواعدَ نوع الدفع على تعديلٍ قادم.
 *
 * تُرجِع الحقولَ التي أُسقطت باسمها — فالمرفوضُ يُقال ولا يُبتلع.
 */
/**
 * يملأ نوعَ الدفع من ملفّ العميل قبل تطبيق القواعد.
 *
 * ── لماذا هنا أيضًا وهو في المزامنة ─────────────────────────────────────────
 * المزامنةُ تملؤه للكشوف الآتية من المنصّة. وكشفٌ يُنشأ عندنا بيد موظّف، أو
 * كشفٌ قديمٌ يُكتب له تاريخُ سدادٍ اليوم، لا يمرّ عليها — فيبقى بلا نوع، ولا
 * يظهر في شاشة تحصيلٍ لا كاشًا ولا ضريبيًّا. وهذه اللحظةُ — لحظةَ كتابة تاريخ
 * السداد — هي التي يُسأل بعدها «فين الكشف؟».
 *
 * ولا يُبدَّل نوعٌ مكتوب: يُملأ الفارغُ وحدَه، ولا يُمسّ اختيارُ اليد أبدًا.
 */
async function fillPaymentTypeFromCustomer(patch, current = {}, partyTypes = null) {
  if (Object.prototype.hasOwnProperty.call(patch, 'paymentType')) return null;
  // واختيارُ أحد الأنواع الأربعة اختيارٌ للنوع — لا يُشتقّ فوقه.
  if (Object.prototype.hasOwnProperty.call(patch, 'paymentSubtype')) return null;
  if (String(current.paymentTypeSource || '') === 'manual') return null;
  // ── والموحَّدُ على صفة عميله لا يُشتقّ من جديد ─────────────────────────
  // إلّا أن تُكتب له الآن فاتورةٌ ضريبيّةٌ حقيقيّة — راجع isUnified.
  if (isUnified(current)) {
    const merged = { ...current, ...patch };
    if (!hasIssuedInvoice(merged) || String(current.paymentType || '') === 'tax') return null;
    patch.paymentType = 'tax';
    patch.paymentTypeSource = 'unified';
    patch.__derivedPaymentType = true;
    return 'tax';
  }

  const name = patch.username !== undefined ? patch.username : current.username;
  if (!name) return null;
  try {
    const CollectionsParty = require('../models/CollectionsParty');
    const key = CollectionsParty.fold(name);
    if (!key) return null;
    // ── والدفعةُ الكبيرة تقرأ العملاءَ مرّةً لا لكلّ صفّ ─────────────────────
    // `partyTypes` (مفتاحٌ مطويّ ← صفة) يُحمَّل مرّةً في التحديث الجماعيّ؛ وبدونه
    // كانت سبعةٌ وثلاثون ألفَ كشفٍ = سبعةً وثلاثين ألفَ رحلةٍ إلى القاعدة.
    const party = partyTypes
      ? (partyTypes.has(key) ? { paymentType: partyTypes.get(key) } : null)
      : await CollectionsParty.findOne({ kind: 'customer', nameKey: key }).select('paymentType').lean();
    const merged = { ...current, ...patch };
    const next = derivePaymentTypeFor(merged, party?.paymentType);
    if (!next || next === String(current.paymentType || '')) return null;
    patch.paymentType = next;
    patch.paymentTypeSource = 'auto';
    // ── وعلامةٌ تقول إنّ هذا اشتقاقٌ لا اختيارُ يد ──────────────────────────
    // `applyBillingRules` تختم كلَّ `paymentType` في التعديل بأنّه «يدويّ»، وهو
    // صوابٌ لما يكتبه الموظّف وخطأٌ لما نشتقّه نحن: المختومُ يدويًّا لا تمسّه
    // صفحةُ «أنواع الدفع» أبدًا، فيتجمّد الكشفُ على نوعٍ لم يختره أحد ويُعدّ في
    // عمود «اختيار يدويّ» وهو ليس منه.
    patch.__derivedPaymentType = true;
    return next;
  } catch (_) { return null; }
}

/**
 * رقمُ فاتورةٍ كُتب على كشفٍ يصنع قيدَه في دفتر الفواتير.
 *
 * ── ولماذا يلزم ────────────────────────────────────────────────────────────
 * شاشةُ الفواتير الضريبيّة تقرأ الدفتر (`CollectionInvoice`) لا الكشوف: الفاتورةُ
 * هي الوحدةُ وقد تضمّ كشوفًا. فرقمٌ يُكتب على كشفٍ اليوم لا يجد له قيدًا في
 * الدفتر — فلا يظهر في التحصيل أصلًا، والشرطُ أن يصلها **فورًا** متى كُتب رقمُه.
 *
 * فيُنشأ القيدُ عند أوّل كتابةٍ ولا يُلمَس بعدها: ما بعده — تسليمٌ وتحصيلٌ وحالة —
 * عملُ قسم التحصيل على الفاتورة نفسِها، ولا يجوز أن تدهسه كتابةٌ على كشف.
 */
async function ensureLedgerInvoice(workflow, previousNumber = '') {
  const numbers = [workflow && workflow.invoiceNumber, previousNumber];
  return syncOpsInvoices(numbers);
}

/**
 * ── والقيدُ المولودُ من كشفٍ يتبع كشوفَه ──────────────────────────────────
 *
 * كان القيدُ يُنشأ مرّةً ثمّ لا يُلمَس. فظهر في التحصيل شيئان خاطئان:
 *   · رقمٌ صُحِّح على الكشف (١٢١٣ ← غيرُه) بقي قيدُه القديمُ فاتورةً بلا كشف؛
 *   · ورقمٌ كُتب قبل مبالغه بقيت فاتورتُه صفرًا وإن اكتملت مبالغُ الكشف بعده.
 *
 * فالقيدُ الذي وُلد من كشف (`sheetCode: 'workflow'`) يُعاد حسابُه من كشوفه في
 * كلّ تعديل: مبلغُه مجموعُ إجماليّاتها، وطرفُه عميلُها، وكشوفُه أرقامُها. وإن لم
 * يبقَ تحته كشفٌ ولم يعمل عليه التحصيلُ بعدُ (لا تسليمَ ولا تحصيل) أُزيل.
 * أمّا قيدُ دفتر الشركة فلا يُلمَس إلّا طرفًا ناقصًا يُكمَّل — كما كان.
 * وما بعد الإنشاء من تسليمٍ وتحصيلٍ وحالةٍ عملُ قسم التحصيل لا يُمَسّ هنا.
 */
async function syncOpsInvoices(rawNumbers) {
  const CollectionInvoice = require('../models/CollectionInvoice');
  const numbers = [...new Set((rawNumbers || []).map((n) => String(n || '').trim())
    .filter((n) => n && !NO_INVOICE_RX.test(n)))];
  let touched = 0;
  for (const no of numbers) {
    try {
      const reports = await OperationsWorkflow.find({
        invoiceNumber: no,
        executionStatus: { $nin: ['ملغي', 'ملغى', 'ملغاة', 'cancelled', 'canceled', 'Cancelled'] },
      }).select('reportNumber username invoiceNumber invoiceDate netInvoice tax totalInvoice paymentType').lean();
      const taxReports = reports.filter((w) => w.paymentType !== 'cash' && hasTaxInvoice(w));
      // الضريبيُّ وحدَه: رقمُ الشحنة النقديّة تسلسلٌ آخر قد يوافق رقمَ فاتورة.
      const existing = await CollectionInvoice.findOne({ invoiceNumber: no, kind: 'tax' });

      if (!taxReports.length) {
        if (existing && existing.sheetCode === 'workflow' && !existing.collectionDate && !existing.deliveryDate
          && !/collected|delivered/i.test(existing.status || '')) {
          await CollectionInvoice.deleteOne({ _id: existing._id });
          touched += 1;
        }
        continue;
      }

      const first = taxReports[0];
      let party = null;
      try {
        const { ensureCollectionsParty } = require('../utils/ensureCollectionsParty');
        party = await ensureCollectionsParty(first.username, { paymentType: 'tax', source: 'operations_workflow' });
      } catch (_) { /* */ }
      const sum = (k) => Math.round(taxReports.reduce((a, w) => a + (Number(w[k]) || 0), 0) * 100) / 100;
      const dates = taxReports.map((w) => w.invoiceDate).filter(Boolean).map((d) => new Date(d).getTime());

      if (!existing) {
        await CollectionInvoice.create({
          invoiceNumber: no,
          kind: 'tax',
          party: party?._id || undefined,
          partyCode: party?.code || '',
          partyName: first.username || '',
          // يومُ كتابة رقمها إن لم يُكتب لها تاريخ — لا تاريخُ السداد ولا الكشف (راجع stampInvoiceDate).
          invoiceDate: dates.length ? new Date(Math.min(...dates)) : new Date(`${require('../utils/companyDay').todayKey()}T00:00:00.000Z`),
          total: sum('totalInvoice'),
          reportNumbers: taxReports.map((w) => String(w.reportNumber || '')).filter(Boolean),
          // مصدرُ القيد يُقال: قيدٌ وُلد من كشفٍ غيرُ قيدٍ جاء من دفتر الشركة.
          sheetCode: 'workflow',
          source: 'operations_workflow',
          status: '',
        });
        touched += 1;
        continue;
      }

      const $set = {};
      if (!existing.party && party?._id) { $set.party = party._id; $set.partyCode = party.code || ''; }
      // ── رقمٌ محجوزٌ في الدفتر صار فاتورةً على كشوف ───────────────────────────
      // دفترُ التحصيل يحمل أرقامًا محجوزةً في التسلسل (`unused`) لا تُعرض ولا تُعَدّ.
      // فإن كُتب الرقمُ على كشوفٍ ضريبيّة صار فاتورةً حقيقيّة — وكان يبقى محجوزًا
      // صفرًا مخفيًّا: ٥٨ فاتورةً (١٢١٤٦–١٢٢٠٨) لم تصل التحصيل (٢٠٢٦/١٠/٢٠). فيُفتح
      // ويُعامَل معاملةَ ما وُلد من كشف: مبلغُه وطرفُه وكشوفُه منها.
      const wasReserved = existing.unused === true;
      if (wasReserved) {
        $set.unused = false;
        if (existing.sheetCode !== 'workflow') {
          const clash = await CollectionInvoice.exists({ kind: 'tax', invoiceNumber: no, sheetCode: 'workflow' });
          if (!clash) $set.sheetCode = 'workflow';
        }
        $set.source = 'operations_workflow';
      }
      if (existing.sheetCode === 'workflow' || wasReserved) {
        if (!existing.totalLocked) $set.total = sum('totalInvoice');
        $set.partyName = first.username || existing.partyName;
        if (party?._id) { $set.party = party._id; $set.partyCode = party.code || ''; }
        $set.reportNumbers = taxReports.map((w) => String(w.reportNumber || '')).filter(Boolean);
        if (dates.length) $set.invoiceDate = new Date(Math.min(...dates));
      }
      if (Object.keys($set).length) {
        await CollectionInvoice.updateOne({ _id: existing._id }, { $set });
        touched += 1;
      }
    } catch (e) {
      console.error('[ledger] تعذّرت مزامنة الفاتورة', no, e.message);
    }
  }
  if (touched) {
    try { require('./collectionsLedgerController').invalidate(); } catch (_) {}
    try { cache.clear('collections-dept:'); cache.clear('cdr:'); } catch (_) {}
  }
  return touched;
}

// الحقولُ التي إن تغيّرت على كشفٍ تغيّر بها قيدُ فاتورته.
const LEDGER_FIELDS = ['invoiceNumber', 'netInvoice', 'tax', 'totalInvoice', 'invoiceDate', 'paymentType', 'username', 'executionStatus'];

function applyBillingRules(patch, current = {}) {
  // ── النوعُ المختارُ يكتب عائلتَه أوّلًا ──────────────────────────────────
  // «نقدي - 3PL» يصل هنا `paymentType` = 'cash_3pl'، فيصير النوعُ `cash_3pl`
  // والعائلةُ `cash` — ثمّ تسري قواعدُ الكاش كلُّها على العائلة كما كانت.
  // والانتقالُ الآليُّ إلى الضريبيّ يأخذ «آجل - فاتورة». راجع utils/paymentType.
  normalizePaymentChoice(patch, current);
  const nextType = Object.prototype.hasOwnProperty.call(patch, 'paymentType')
    ? patch.paymentType
    : current.paymentType;

  // ── واختيارُ اليد يُختَم بأنّه اختيارُ يد ───────────────────────────────────
  // صفحةُ «أنواع الدفع» تشتقّ النوعَ من صفة العميل، وتمرّ على الكشوف كلَّما
  // تغيّرت. فما لم يُميَّز ما اختاره الموظّفُ على كشفٍ بعينه لدهسه الاشتقاقُ في
  // أوّل مرور — والعميلُ الواحد يكون كاشًا في حمولةٍ وضريبيًّا في التالية،
  // فالاختيارُ على الكشف هو الأصدق. راجع utils/paymentType.
  if (Object.prototype.hasOwnProperty.call(patch, 'paymentType')) {
    // إلّا ما اشتققناه نحن قبل قليل — راجع fillPaymentTypeFromCustomer.
    if (!patch.__derivedPaymentType) patch.paymentTypeSource = 'manual';
  }
  delete patch.__derivedPaymentType;

  // ── الضريبةُ لا تُكتب، وإجماليُّ الضريبيّ لا يُكتب ───────────────────────────
  // تُحسب من الصافي (deriveInvoiceTotals). فما أرسلته شاشةٌ فيهما يُسقَط — وفي
  // الكاش يبقى الإجماليُّ مكتوبًا بيد (صاحبُ الشركة، ٢٠٢٦/١٠/٢٠).
  if (!Object.prototype.hasOwnProperty.call(patch, 'netInvoice')) {
    delete patch.tax;
    if (nextType !== 'cash') delete patch.totalInvoice;
  }

  const blocked = [];
  if (nextType === 'cash') {
    // ── «الكاش ملهاش رقم فاتورة» ────────────────────────────────────────────
    // قرارُ صاحب الشركة: النقديُّ يُكتب له صافٍ وتُحسب ضريبتُه، ولا رقمَ فاتورةٍ
    // له — فرقمُ الفاتورة وحدَه دليلُ الضريبيّ (راجع hasTaxInvoice). فرقمٌ حقيقيٌّ
    // يُكتب على كشفٍ يبقى نقديًّا (نوعُه مختارٌ بيدٍ أو موحَّد، فلم يقلبه الاشتقاق)
    // يُرفض: إمّا أن يُغيَّر نوعُه إلى «ضريبي» أوّلًا، أو لا رقم.
    if (Object.prototype.hasOwnProperty.call(patch, 'invoiceNumber') && hasTaxInvoice(patch)) {
      delete patch.invoiceNumber;
      blocked.push('invoiceNumber');
    }
    // والصافي إن كُتب بيدٍ تُحسب منه الضريبةُ والإجماليّ كما في الضريبيّ
    // («ويتحسب الفات»)؛ وما لم يُكتب يُملأ بما دُفع — راجع deriveCashTotals.
    if (Object.prototype.hasOwnProperty.call(patch, 'netInvoice')) deriveInvoiceTotals(patch, current);
    deriveCashTotals(patch, current);
  } else {
    // ── ومبلغُ التحصيل للنقديّ وحدَه ────────────────────────────────────────
    // الضريبيُّ يُحصَّل بفاتورته وصافيها هو المبلغ، فلا معنى لخانةٍ ثانيةٍ
    // تقول مبلغًا آخر — وإن اختلفا لم يُعرف أيُّهما الصحيح. والنقديُّ لا
    // فاتورةَ له، فمبلغُ تحصيله يُكتب بيده.
    if (Object.prototype.hasOwnProperty.call(patch, 'collectedAmount') && patch.collectedAmount) {
      delete patch.collectedAmount;
      blocked.push('collectedAmount');
    }
    // ── والخروجُ من «كاش» يفكّ ما أقفله ──────────────────────────────────
    // كان القفلُ في اتّجاهٍ واحد: يُختار «كاش» فتُصفَّر تسعةُ أعمدة، ثمّ يُرجَع
    // الاختيارُ فتبقى الأصفارُ مكانها — أعمدةٌ مفتوحةٌ للكتابة تقول «0» وليس
    // فيها صفر. فيظنّ صاحبُها أنّ الكشف مفوتَرٌ بصفر، أو يمسحها تسعَ مرّات
    // بيده.
    //
    // ولا يُمسح إلّا ما وضعه القفلُ نفسُه: تُقارَن كلُّ خانةٍ بقيمة القفل، فما
    // كان صفرَ القفل عاد فارغًا، وما كتبه إنسانٌ يبقى كما كتبه.
    const wasCash = current.paymentType === 'cash';
    if (wasCash) {
      const locked = cashLockedValues();
      for (const f of CASH_LOCKED_FIELDS) {
        if (Object.prototype.hasOwnProperty.call(patch, f)) continue;   // كتبه المستخدمُ الآن
        const now = current[f];
        const placeholder = locked[f];
        const isPlaceholder = placeholder === null
          ? (now === null || now === undefined)
          : String(now ?? '') === String(placeholder);
        if (isPlaceholder) patch[f] = CASH_ZERO_NUMERIC.has(f) ? 0 : (f.endsWith('Date') ? null : '');
      }
    }
    deriveInvoiceTotals(patch, current);
  }
  return { patch, blocked };
}

// Filter update body to only include fields the role can edit
// ── والحذفُ لا يكون صامتًا ──────────────────────────────────────────────────
// إسقاطُ حقلٍ لا يملكه الطالبُ صحيح؛ أمّا أن يُسقَط ثمّ يُقال «حُفِظ» فليس منعًا
// بل كذب. تُعاد المرفوضةُ بأسمائها ليقرّر المستدعي: يردُّ ٤٠٣ يسمّيها، أو يمضي.
const filterFieldsByRole = (body, role, resolvedFields) => {
  const allowedFields = resolvedFields || ROLE_FIELD_ACCESS[role] || [];
  const filtered = {}; const rejected = [];
  for (const key of Object.keys(body)) {
    if (allowedFields.includes(key)) filtered[key] = body[key];
    // الحقولُ التي يضيفها الخادمُ لنفسه ليست إدخالًا من المستخدم فلا تُحسب رفضًا.
    else if (!['lastModifiedBy', 'createdBy', 'stage', '_id', '__v'].includes(key)) rejected.push(key);
  }
  Object.defineProperty(filtered, '__rejected', { value: rejected, enumerable: false });
  return filtered;
};

// Lock expiry time: 5 minutes
const LOCK_EXPIRY_MS = 5 * 60 * 1000;

const isLocked = (workflow, userId) => {
  if (!workflow.lockedBy) return false;
  // Lock expired
  if (workflow.lockedAt && Date.now() - new Date(workflow.lockedAt).getTime() > LOCK_EXPIRY_MS) {
    return false;
  }
  // Locked by someone else
  return workflow.lockedBy.toString() !== userId.toString();
};

// ═══════════════════════════════════════════════════════════════════════════
//  فلاتر الأعمدة — قيمُ العمود تُحسب في القاعدة، والتصفية تجري فيها
// ═══════════════════════════════════════════════════════════════════════════

/**
 * الأعمدة المسموح بالفلترة عليها.
 *
 * قائمةٌ بيضاء مقصودة: اسم العمود يدخل مباشرةً في مفتاح `$group` وفي شرط `$in`،
 * فلو قُبل أي اسمٍ يرسله المتصفح لأمكن استخراج قيم حقولٍ لا يعرضها الجدول أصلًا
 * — ومنها حقولٌ ماليّة محجوبة عن أكثر الأدوار.
 */
const FILTERABLE_COLUMNS = new Set([
  'reportNumber', 'reportDate', 'fromLocation', 'toLocation', 'branch', 'carOwner',
  'carNumber', 'ownerType', 'executionStatus', 'applicationStatus', 'paymentMethod',
  'username', 'userPhone', 'taxIndicator', 'purchaseValue', 'sellingValue',
  'driverName', 'truckType', 'truckSize', 'representativeName', 'operationsReview',
  'paymentDate', 'payingBranch', 'documentNumber', 'sendingDate',
  'branchDeliveryDate', 'deliveryDate',
  'accountingReview', 'invoiceNumber', 'netInvoice', 'tax', 'totalInvoice',
  'invoiceDate', 'collectionDate', 'stage',
  // ── وأعمدةٌ كانت تُعرض بقائمةٍ ولا يقبلها الخادم ─────────────────────────
  // «نوع الدفع» و«مبلغ السداد» و«وجهة الكشف النهائية» و«مبلغ التحصيل» و«مسؤول
  // البيانات» أُضيفت إلى الجدول ولم تُضَف هنا، فكان كلُّ فتحٍ لقائمتها يُردّ ٤٠٠
  // وتُعرض فارغةً بلا رسالة: «نوع الدفع لا يفلتر شيئًا».
  'paymentAmount', 'paymentType', 'finalReportDestination', 'collectedAmount',
  // الحقلُ الخام (تعرضه الصفحةُ الخاصّة كما هو)، والعمودُ المعروضُ في سير العمل —
  // الاسمُ ثمّ مسجّلُ المحفظة ثمّ مصدرُ الاستيراد. راجع utils/dataOwnerIndex.
  'paymentDateByName', 'dataOwnerShown',
  // ── «رقم الفاتورة: موجود / فارغ / بديلٌ مثل no inv» ─────────────────────
  // عمودٌ محسوبٌ لا حقل: شريطُ الفلترة يسأل «أيُّ الكشوف عليها فاتورة؟» ولا
  // يستطيع ذلك فلترُ رقم الفاتورة نفسِه — قيمُه خمسُمئةِ رقمٍ لا ثلاثُ حالات.
  'invoiceState',
  // ── «التخليص»: رقمُ المعاملة المرتبطة، و(فارغ) = غيرُ مرتبط ────────────
  // عمودٌ محسوبٌ من `customsLink.refNumber` — يجيب «أيُّ كشوفٍ لها معاملة؟»
  // و«ما كشوفُ المعاملة كذا؟» بالفلتر نفسِه.
  'customsRef',
]);

// حالاتُ رقم الفاتورة الثلاث — شرطٌ واحدٌ تقرؤه القائمةُ والفلتر معًا.
const INVOICE_STATE_COND = {
  has: ISSUED_INVOICE_QUERY,
  none: { invoiceNumber: { $in: require('../utils/colFilter').BLANK_VALUES } },
  placeholder: { invoiceNumber: { $regex: NO_INVOICE_RX } },
};

// القيمة تصل من المتصفح نصًّا دائمًا، والحقل في القاعدة رقمٌ أو تاريخ. المقارنة
// بين نوعين مختلفين في BSON لا تُطابق شيئًا أبدًا، فالفلترة على «قيمة الشراء» أو
// «تاريخ السداد» كانت سترجع صفرًا من الصفوف بلا رسالة خطأ — لذلك يُعاد كل نوعٍ
// إلى نوعه قبل بناء الشرط.
const NUMERIC_COLUMNS = new Set(['purchaseValue', 'sellingValue', 'netInvoice', 'tax', 'totalInvoice', 'paymentAmount', 'collectedAmount']);
const DATE_COLUMNS = new Set(['reportDate', 'paymentDate', 'sendingDate', 'branchDeliveryDate', 'deliveryDate', 'invoiceDate', 'collectionDate']);

/**
 * أعمدة التواريخ تُجمَّع باليوم لا باللحظة.
 *
 * المخزَّن لحظةٌ بالثانية، والمعروض في الخانة يومٌ فقط؛ فالتجميع باللحظة كان يضع
 * في القائمة ثمانيةً وعشرين سطرًا مكتوبًا عليها كلّها «١٦/١٢/٢٠٢٥» لا يفرّق بينها
 * شيء، ويرفع عدد القيم المختلفة إلى ثلاثةٍ وعشرين ألفًا في عمودٍ واحد.
 *
 * والمنطقة الزمنية مثبَّتة على توقيت الرياض لأن الشركة كلّها فيه: التجميع بالتوقيت
 * العالمي يُلقي بكشوف ما بعد التاسعة مساءً في اليوم التالي، فلا يطابق اليومَ
 * المكتوب في الخانة نفسها.
 */
const TZ = 'Asia/Riyadh';
// (كانت هنا `TZ_OFFSET = '+03:00'` مكتوبةً يدًا — صارت في `utils/companyDay`
//  حيث تُسأل المنطقةُ عن إزاحتها بدل أن تُفترض، ويقرأها النظامُ كلُّه.)
const DAY_MS = 24 * 60 * 60 * 1000;
const isDayString = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v);

/**
 * سقف عدد القيم المُعادة في قائمة العمود الواحد.
 *
 * أعمدة مثل «رقم الكشف» و«رقم الفاتورة» فيها قيمةٌ مختلفة لكل صف — عشرات الآلاف
 * — وإرسالها كاملةً يعيد بالضبط التجمّد الذي جاء هذا الحلّ ليزيله. تُعاد الأكثر
 * تكرارًا، ويُطلب الباقي بالبحث داخل القائمة فيُنفَّذ على الخادم.
 */
const MAX_FILTER_VALUES = 500;

/** نمطٌ يطابق القيمةَ بأيّ فراغٍ حولها أو فيها — راجع utils/colFilter. */
const { textMatcher, BLANK_VALUES, normKey: colKey } = require('../utils/colFilter');

const decodeColumnValue = (field, v) => {
  if (NUMERIC_COLUMNS.has(field)) { const n = Number(v); return Number.isNaN(n) ? undefined : n; }
  if (DATE_COLUMNS.has(field)) { const d = new Date(v); return isNaN(d.getTime()) ? undefined : d; }
  return v;
};

/**
 * شروط فلاتر الأعمدة القادمة من الجدول: `cf_<العمود>` مكرَّرًا لكل قيمة مختارة.
 *
 * التكرار — لا الفصل بفاصلة — لأن القيم نفسها تحمل فواصل (أسماء ملّاك، ملاحظات
 * فواتير)، ففصلها بفاصلة كان يقطع القيمة نصفين فلا تطابق صفًّا واحدًا.
 *
 * `skipField` تستعمله قائمة القيم: قيم عمودٍ تُحسب بكل الفلاتر **إلا فلتره هو**،
 * وإلا لما ظهرت في القائمة إلا القيم التي اختارها المستخدم بالفعل فتعذّر توسيع
 * الاختيار.
 */
function columnFilters(query, skipField, allowMoney = true, allowSelling = true) {
  const conds = [];
  for (const key of Object.keys(query || {})) {
    if (!key.startsWith('cf_')) continue;
    const field = key.slice(3);
    if (!FILTERABLE_COLUMNS.has(field) || field === skipField) continue;
    // والفلترةُ على عمودٍ محجوب تكشفه بالاستنتاج: «أرِني ما إجمالي فاتورته
    // كذا» جوابٌ عن قيمةٍ لا تُعرض. تُسقَط لمن لا يملكها.
    if ((MONEY_FIELDS.includes(field) || field === 'invoiceState') && !allowMoney) continue;
    // وقيمةُ البيع كذلك لمن ليس في قائمتها.
    if (SELLING_FIELDS.includes(field) && !allowSelling) continue;
    const raw = Array.isArray(query[key]) ? query[key] : [query[key]];
    const vals = raw.map((v) => String(v == null ? '' : v));
    if (!vals.length) continue;
    // الخانة الفارغة فئةٌ حقيقية يُسأل عنها («الكشوف التي لم تُفوتر بعد»)، وهي في
    // القاعدة ثلاث صور: حقلٌ غير موجود، وnull، ونصٌّ فارغ — والثلاثة يجب أن يردّها
    // اختيارٌ واحد، وإلا بدا للمستخدم أن صفوفًا اختفت.
    // «مسؤول البيانات» عمودٌ يُحسب من ثلاثة مصادر لا حقلٌ واحد — راجع utils/dataOwnerIndex.
    if (field === 'dataOwnerShown') { conds.push(require('../utils/dataOwnerIndex').ownerCondition(vals)); continue; }
    // «نوع الدفع» يعرض ستَّ قيم: الأنواعَ الأربعة، و«ضريبي»/«كاش» لما بقي بلا نوع.
    if (field === 'paymentType') { conds.push(paymentKindCondition(vals)); continue; }
    if (field === 'invoiceState') {
      const cs = vals.map((v) => INVOICE_STATE_COND[v]).filter(Boolean);
      if (cs.length) conds.push(cs.length === 1 ? cs[0] : { $or: cs });
      continue;
    }
    if (field === 'customsRef') { conds.push(customsRefCondition(vals)); continue; }
    const wantsBlank = vals.some((v) => v === '');
    const rest = vals.filter((v) => v !== '');

    if (DATE_COLUMNS.has(field)) {
      // اليوم مدًى لا لحظة: `$eq` على منتصف ليل اليوم لا يطابق كشفًا سُجّل الثالثة
      // عصرًا من اليوم نفسه، فيختفي من نتيجة فلترٍ اختاره المستخدم بالاسم.
      const clauses = [];
      // وتاريخٌ خارجَ ما يقدر مونجو أن يكتبه يومًا (سنة ٥٧٣٧١ في «تاريخ الارسال» —
      // خطأُ إدخال) يقع في القائمة تحت «(فارغ)»، فيُرَدّ معه — وإلّا عدّته القائمةُ
      // ولم يُرجعه الاختيار.
      if (wantsBlank) clauses.push({ [field]: { $in: ['', null] } }, { [field]: { $gte: new Date('9999-12-31T21:00:00.000Z') } });
      for (const v of rest) {
        if (isDayString(v)) {
          const start = startOfDay(v);
          if (!start) continue;
          clauses.push({ [field]: { $gte: start, $lt: new Date(start.getTime() + COMPANY_DAY_MS) } });
        } else {
          const exact = new Date(v);
          if (!isNaN(exact.getTime())) clauses.push({ [field]: exact });
        }
      }
      if (clauses.length) conds.push(clauses.length === 1 ? clauses[0] : { $or: clauses });
      continue;
    }

    // ── والنصُّ يُطابَق بلا مسافات طرفيه ──────────────────────────────────────
    // المزامنةُ تكتب بخطّ تجميعٍ فلا يمرّ عليها `trim` في المخطّط، فيُخزَّن
    // «الدمام » و«محمد الخولي » و«13  » كما جاءت من المنصّة — بجانب صيغها
    // المقصوصة في صفوفٍ أخرى. والخانتان تُقرآن في الجدول شيئًا واحدًا.
    // و Mongoose يقصّ القيمةَ في الاستعلام (`trim` يسري على الشرط أيضًا)،
    // فكان اختيارُ «الدمام » من القائمة يبحث عن «الدمام» ويُرجع صفرًا من تسعةِ
    // آلافٍ وثلاثِمئةٍ وواحدٍ وخمسين كشفًا. فكلُّ قيمةٍ نصّيّةٍ نمطٌ مثبَّتٌ يقبل
    // المسافاتِ حولها (والنمطُ لا يقصّه أحد)، والقائمةُ تجمع الصيغتين سطرًا واحدًا
    // (راجع filterOptions).
    const textual = !NUMERIC_COLUMNS.has(field);
    const list = rest.map((v) => decodeColumnValue(field, v)).filter((v) => v !== undefined)
      .map((v) => (textual && typeof v === 'string' ? textMatcher(v) : v));
    if (wantsBlank) list.push(...(textual ? BLANK_VALUES : ['', null]));
    if (list.length) conds.push({ [field]: { $in: list } });
  }
  return conds;
}

/**
 * شرطُ عمود «التخليص»: أرقامُ معاملاتٍ بعينها، و'' = لا معاملةَ مرتبطة (ومنه ما
 * فكّه موظّفٌ بيده — `customsLink` موجودٌ بلا معاملة).
 */
const LINKED = { 'customsLink.clearance': { $type: 'objectId' } };
function customsRefCondition(vals) {
  const refs = vals.filter((v) => v !== '');
  const cs = [];
  if (vals.includes('')) cs.push({ 'customsLink.clearance': { $not: { $type: 'objectId' } } });
  if (refs.length) cs.push({ 'customsLink.refNumber': { $in: refs }, ...LINKED });
  return cs.length === 1 ? cs[0] : { $or: cs };
}

/**
 * إبطال قوائم القيم المخزَّنة بعد كل كتابة.
 *
 * القائمة تُخزَّن عشرين ثانية لتوحيد الطلبات المتزامنة؛ لكن حالةً جديدة أو كشفًا
 * محذوفًا لا يجوز أن ينتظر انتهاء المدة: المستخدم سيفلتر على قيمةٍ لم تعد موجودة
 * فيرى جدولًا فارغًا ويظنّ الفلتر معطوبًا.
 */
const bustFilterCache = () => { try { cache.clear('wf:'); } catch (e) {} };

/**
 * ── ما يُرسَل إلى الجدول ────────────────────────────────────────────────────
 *
 * المستندُ يحمل نحوَ ستّين حقلًا، فيها بقايا استيراداتٍ قديمة لا يعرضها الجدول
 * ولا يقرؤها أحد (`ownerName`, `region`, `product`, `invoiceRef`, `volume`…).
 * وخمسون صفًّا كاملةً ثلاثةٌ وستّون كيلوبايت على عنقودٍ نطاقُه مئةُ كيلوبايت في
 * الثانية — فالفتحةُ الواحدة تكلّف ثانيةً ونصفًا. والاستعلامُ نفسُه صفرُ
 * ميلي ثانية: النقلُ هو الثمن كلُّه، لا الحساب.
 *
 * فتُرسَل أعمدةُ الجدول وحدَها. وما لا يُعرض لا يُنقل.
 */
const LIST_FIELDS = [
  'reportNumber', 'reportDate', 'fromLocation', 'toLocation', 'branch',
  'carOwner', 'carNumber', 'ownerType', 'executionStatus', 'applicationStatus',
  'paymentMethod', 'username', 'userPhone', 'taxIndicator',
  'purchaseValue', 'sellingValue', 'loadingTime', 'driverRentalType', 'reference',
  'driverName', 'driverPhone', 'truckType', 'truckSize', 'loadType', 'quantity',
  'representativeName', 'operationsReview',
  'paymentDate', 'payingBranch', 'paymentAmount', 'paymentType', 'paymentSubtype',
  // مسؤولُ البيانات يُقرأ في الجدول — وبغيره يظهر بعد الحفظ ثمّ يختفي في أوّل
  // تحديثٍ حيّ، لأنّ الصفَّ يعود من القائمة بلا هذا الحقل.
  'paymentDateByName', 'paymentDateAt',
  'finalReportDestination', 'documentNumber', 'sendingDate',
  'branchDeliveryDate', 'deliveryDate',
  'accountingReview', 'invoiceNumber', 'netInvoice', 'tax', 'totalInvoice',
  'invoiceDate', 'invoiceNotes', 'collectedAmount', 'collectionDate',
  'stage', 'lockedBy', 'lockedByName', 'lockedAt', 'externalSource', 'createdAt',
  // معاملةُ التخليص المرتبطة — نسخةٌ صغيرة (رقمٌ وبوليصةٌ وحاويات). راجع services/customsOpsLink.
  'customsLink',
].join(' ');

// GET /api/workflows
exports.getWorkflows = async (req, res) => {
  try {
    const { page = 1, limit = 50 } = req.query;
    // شرطُ البحث يُبنى في مكانٍ واحد يقرأه الجدول والإحصاءات والتصدير معًا، فلا
    // يعرض عدّاد الصفوف رقمًا ويعرض الجدول تحته صفوف شرطٍ آخر.
    const filter = buildWorkflowFilter(req.query, undefined, canSeeMoney(req.user.role), canSeeSelling(req.user.role));

    const skip = (parseInt(page) - 1) * parseInt(limit);
    // ── ولا يُملأ في القائمة ما لا يُقرأ فيها ──────────────────────────────
    // كانت ثلاثةُ `populate` على كلّ صفحة: المُنشئُ وآخرُ مَن عدّل ومَن يقفل.
    // والجدولُ لا يقرأ من الثلاثة إلّا `lockedBy._id` — وهو المعرّفُ الخام
    // الموجودُ أصلًا. فثلاثُ رحلاتٍ إلى القاعدة في كلّ فتحةٍ وكلّ حرفِ بحث،
    // ثمنُها ثمنُ ما لا يُعرض. والتفاصيلُ تُملأ في صفحة الكشف حيث تُقرأ.
    const [workflows, total] = await Promise.all([
      OperationsWorkflow.find(filter)
        .select(LIST_FIELDS)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      OperationsWorkflow.countDocuments(filter),
    ]);

    // الكشوفُ التي دفعتها المحفظة: خانةُ «مبلغ السداد» فيها تُعرض مقفولة.
    const { walletPaidMap, walletRecorderMap } = require('../utils/walletPayment');
    const nums = workflows.map((w) => w.reportNumber);
    const [walletPaid, recorders] = await Promise.all([walletPaidMap(nums), walletRecorderMap(nums)]);
    for (const w of workflows) if (walletPaid.has(String(w.reportNumber || '').trim())) w.paidFromWallet = true;

    // ── ومسؤولُ البيانات يُقرأ من ثلاثة مصادرَ بترتيب ─────────────────────────
    // من كتب تاريخَ السداد عندنا أوّلًا، فمن سجّل الشراءَ في المحفظة (هو من دفع
    // ساعتَها)، وإلّا فالصفُّ منقولٌ من منصّة الأوبريشن ولا شخصَ عندنا كتبه —
    // ويُقال ذلك صريحًا بدل خانةٍ فارغةٍ تُقرأ «مجهول».
    for (const w of workflows) {
      const rn = String(w.reportNumber || '').trim();
      const who = String(w.paymentDateByName || '').trim();
      if (who) { w.dataOwnerShown = who; w.dataOwnerFrom = 'system'; continue; }
      const rec = recorders.get(rn);
      if (rec) { w.dataOwnerShown = rec; w.dataOwnerFrom = 'wallet'; continue; }
      if (w.externalSource) {
        // النصُّ نفسُه الذي تُبنى عليه قائمةُ الفلتر — راجع utils/dataOwnerIndex.
        w.dataOwnerShown = require('../utils/dataOwnerIndex').importLabel(w.externalSource);
        w.dataOwnerFrom = 'import';
        continue;
      }
      w.dataOwnerShown = '';
      w.dataOwnerFrom = '';
    }
    res.json({
      workflows: stripRowFor(req.user.role, workflows),
      total, page: parseInt(page), pages: Math.ceil(total / parseInt(limit)),
    });
  } catch (error) {
    console.error('Get workflows error:', error);
    res.status(500).json({ message: 'Failed to load workflows' });
  }
};

// Build the same match filter getWorkflows uses (stage/date/search/pendingOnly)
// so stats and the table always agree. Kept as a helper for the stats endpoint.
/**
 * «فاتورة لم تصل» — تعريفٌ واحد يستعمله العدّاد والفلتر معًا.
 *
 * شرطان لا واحد:
 *
 * ١) **بلا تاريخ سداد.** كان الشرط يجمع غيابه وغيابَ رقم الفاتورة معًا، فكشفٌ
 *    سُدِّد ولم تُسجَّل فاتورته يخرج من العدّ وهو ليس منتظَرًا.
 *
 * ٢) **غير ملغًى.** والملغى لا سداد له بطبيعته — لا لأنّ الفاتورة تأخّرت بل
 *    لأنّ الشحنة لم تحدث. وعدُّه كان يقلب البطاقة رأسًا على عقب: ٥٦٤٢ في
 *    الفترة، منها ٤١٥٢ ملغًى — ولا واحدٌ من الأربعة آلاف له تاريخ سداد ولن
 *    يكون. فالرقم الذي يُقرأ «متأخّرات» كان ثلاثة أرباعه شحناتٍ ملغاة، والعمل
 *    الحقيقيّ ١٤٩٠ مدفونًا تحتها.
 */
const CANCELLED = ['cancelled', 'canceled'];
const PENDING_PAYMENT = {
  $and: [
    { $or: [{ paymentDate: null }, { paymentDate: '' }, { paymentDate: { $exists: false } }] },
    { applicationStatus: { $nin: CANCELLED } },
  ],
};

function buildWorkflowFilter(query, skipField, allowMoney = true, allowSelling = true) {
  const {
    stage, search, dateFrom, dateTo, pendingOnly, invoiceGap, pendingKind,
  } = query || {};
  const filter = {};

  // ── «مرتبطٌ بالتخليص» / «غيرُ مرتبط» / معاملةٌ بعينها ───────────────────
  // شريطُ الفلترة فوق الجدول وزرُّ «كشوف التشغيل» في صفحة المعاملة يقولانها
  // بكلمة: `customs=linked|unlinked|<معرّف المعاملة>`.
  const customs = String((query && query.customs) || '');
  if (customs === 'linked') filter.$and = [...(filter.$and || []), LINKED];
  else if (customs === 'unlinked') filter.$and = [...(filter.$and || []), { 'customsLink.clearance': { $not: { $type: 'objectId' } } }];
  else if (mongoose.isValidObjectId(customs)) filter.$and = [...(filter.$and || []), { 'customsLink.clearance': new mongoose.Types.ObjectId(customs) }];

  // ── «كشفٌ فُوتِر ضريبيًّا ولا رقمَ لفاتورته» ────────────────────────────
  //
  // خانةُ رقم الفاتورة تُكتب بيدٍ عندنا ولا تأتي من منصّة التشغيل، وهي فارغةٌ
  // في ثلاثين ألفَ كشفٍ من خمسةٍ وثلاثين. وأكثرُها لم يُفوتَر بعدُ حقًّا.
  //
  // ── والمبلغُ وحدَه لا يكفي دليلًا ─────────────────────────────────────────
  // كان الشرطُ «عليه صافٍ أو ضريبةٌ أو إجماليّ»، فالتقط تسعةً وأربعين كشفًا
  // نقديًّا ليس فيها نقص: `deriveCashTotals` هي التي تكتب أرقامَها — مبلغُ
  // السداد يُنسَخ إلى الصافي والإجماليّ والضريبةُ صفر — **وتترك رقمَ الفاتورة
  // فارغًا عن قصد، إذ لا فاتورةَ لنقد**. فكان الكارتُ يطالب بسدّ ما ليس ثغرة.
  //
  // والضريبةُ هي الفاصل: `deriveInvoiceTotals` تحسبها من الصافي لكلّ فوترةٍ
  // ضريبيّة فتكون أكبرَ من صفرٍ دائمًا، والنقديّةُ تُكتب صفرًا صراحةً. فما كان
  // عليه ضريبةٌ ولا رقمَ له فقد فُوتِر ضريبيًّا ونُسي رقمُه — وذاك النقصُ وحدَه.
  if (invoiceGap === 'true') {
    filter.$and = [...(filter.$and || []), {
      $or: [
        { invoiceNumber: null }, { invoiceNumber: '' }, { invoiceNumber: { $exists: false } },
        { invoiceNumber: { $regex: '^\\s*(no\\s*inv|بدون|لا\\s*يوجد|-|—|ىى)\\s*$', $options: 'i' } },
      ],
    }, { tax: { $gt: 0 } },
    // والنقديُّ قد تُحسب ضريبتُه ولا رقمَ له بالقرار (راجع hasTaxInvoice) — فليس ثغرة.
    { paymentType: { $ne: 'cash' } }];
  }
  // ── «فواتير لم تصل» = بلا تاريخ سداد، لا شيء غيره ──────────────────────────
  // كان الشرط يجمع غيابَ تاريخ السداد **ورقمِ الفاتورة** معًا، فكشفٌ سُدِّد ولم
  // تُسجَّل فاتورته يخرج من العدّ وهو ليس منتظَرًا، وكشفٌ لم يُسدَّد وله رقم فاتورة
  // يخرج كذلك. والسؤال الذي تُطرَح البطاقة لأجله واحد: «أيُّ كشفٍ لم يصل سداده؟»
  // فشرطُه واحد.
  if (pendingOnly === 'true') {
    filter.$and = [...(filter.$and || []), PENDING_PAYMENT];
    // «سندات لم تصل — كاش / ضريبي»: القسمةُ نفسُها التي تعدّها البطاقتان
    // (راجع PENDING_SPLIT في getWorkflowStats) — فما تقوله البطاقةُ يفتحه الجدول.
    if (pendingKind === 'cash') filter.$and.push({ paymentType: 'cash' });
    else if (pendingKind === 'tax') filter.$and.push({ paymentType: { $ne: 'cash' } });
  }
  if (stage) filter.stage = stage;
  // ── الفترة تُقاس بتاريخ الكشف لا بلحظة إدخاله ─────────────────────────────
  //
  // كان الفلتر على `createdAt` — وهي لحظةُ كتابة الصفّ في قاعدتنا لا تاريخُ
  // العمل. وسبعةٌ وعشرون ألفًا من ثلاثةٍ وثلاثين ألفًا أُدخلت دفعةً واحدة يوم
  // ٣٠ يونيو، فسؤال «أرِني كشوف يناير» كان يرجع فارغًا: لا صفَّ **أُدخل** في
  // يناير وإن كانت كشوفُه كلُّها فيه. والشاشة تعرض صفرًا فيُقرأ «لا عمل» لا
  // «فلترتُ بالعمود الخطأ».
  //
  // و`reportDate` يحمل وقتًا حقيقيًّا من منصّة التشغيل، فالمدى يُبنى على اليوم
  // كاملًا في الطرفين كي لا يسقط كشفُ الساعة الحادية عشرة ليلًا من يومه.
  if (dateFrom || dateTo) {
    const range = {};
    // ── الحدُّ بتوقيت الرياض لا غرينتش ────────────────────────────────────
    // كان هذا السطرُ يبني منتصفَ ليلٍ بغرينتش = الثالثةَ فجرًا عندنا. فمَن
    // اختار «من ١ يناير» كان يفقد كشوفَ الساعات الثلاث الأولى من ذلك اليوم —
    // ٢١٢١ كشفًا من ٣٣٩١٧ تقع فيها. والملفُّ كان يناقض نفسَه: فلترُ العمود
    // أدناه يحسب اليومَ بالرياض، فيختلف «١ يناير» عن «من ١ إلى ١ يناير».
    if (dateFrom) range.$gte = startOfDay(dateFrom);
    // ── «إلى» الفارغة تعني «حتى الآن» لا «بلا نهاية» ────────────────────────
    // المدى المفتوح يُدخل كشوفًا مؤرَّخةً في المستقبل — تُكتب بالخطأ أو تأتي
    // بتاريخٍ مقلوب — فيقرأ المستخدم عددًا أكبر ممّا حدث فعلًا. ومَن يكتب «من»
    // وحدها يقصد «من هذا اليوم إلى الآن»، لا إلى الأبد.
    range.$lte = dateTo ? endOfDay(dateTo) : new Date();
    // والكشف الذي لا تاريخ له يُقاس بلحظة إدخاله — أفضل ما يُعرف عنه.
    filter.$and = [...(filter.$and || []), { $or: [
      { reportDate: range },
      { $and: [{ $or: [{ reportDate: null }, { reportDate: { $exists: false } }] }, { createdAt: range }] },
    ] }];
  }
  if (search) {
    // ── البحثُ يُجيب عمّا سُئل عنه، لا عمّا يحتويه ─────────────────────────
    //
    // كان تعبيرًا نمطيًّا واحدًا غيرَ مثبَّتٍ على سبعةَ عشرَ حقلًا — فمن كتب رقمَ
    // كشفٍ «8730» جاءته واحدٌ وعشرون صفًّا ليس فيها ذلك الكشف: أرقامٌ وقعت داخل
    // هاتف سائقٍ أو رقم مستند. ومن كتب «جدة» جاءه اثنان وثلاثون ألفًا — المدينةُ
    // مكتوبةٌ في كلّ كشفٍ تقريبًا، فالبحثُ لم ينفِ شيئًا.
    //
    // فالحقولُ ثلاثةُ أصناف، ولكلٍّ قاعدتُه:
    //   • أرقامُ الهويّة (كشف، مستند، فاتورة): تطابقٌ تامّ — من كتب رقمًا يريد
    //     صاحبَه لا ما يحويه. وهو يمرّ على الفهرس فلا يمسح الجدول.
    //   • الرموز (لوحةُ السيارة) والهواتف: احتواءٌ — يُبحَث بجزءٍ من اللوحة —
    //     لكنّ الهاتفَ لا يُطابَق بأقلّ من ستّ خاناتٍ كي لا يصير كلُّ رقمٍ قصيرٍ
    //     صيدًا في كلّ هاتف.
    //   • الأسماءُ والأماكن: احتواءٌ مع طيّ صور الحروف (راجع utils/arabicSearch).
    //
    // والكلماتُ تُجمَع لا تُفرَّق: «اركان جدة» تعني الاثنين معًا، فكلُّ كلمةٍ
    // شرطٌ قائم. وهذا ما يجعل الإضافةَ تُضيّق النتيجةَ كما يتوقّع من يكتبها.
    const { arabicSearchRegex, westernDigits } = require('../utils/arabicSearch');
    const term = westernDigits(String(search).trim());
    const ID_EXACT = ['reportNumber', 'documentNumber', ...(allowMoney ? ['invoiceNumber'] : [])];
    // ورقمُ معاملة التخليص وبوليصتُها تُكتب كما هي فيُوجَد كشفُها.
    const CODE_FIELDS = ['carNumber', 'plateNumber', 'customsLink.refNumber', 'customsLink.blNumber'];
    const PHONE_FIELDS = ['driverPhone', 'userPhone'];
    // والملاحظاتُ خارجَ البحث السريع عمدًا: نصٌّ حرٌّ يجعل كلمةً عابرةً فيه
    // تَجُرُّ كشوفًا لا علاقةَ لها بما يُسأل عنه. ولها فلترُ عمودها.
    const NAME_FIELDS = [
      'username', 'carOwner', 'driverName', 'branch', 'payingBranch',
      'fromLocation', 'toLocation', 'finalReportDestination',
      'truckType', 'truckSize', 'agentName', 'representativeName',
    ];

    const clauseFor = (tk) => {
      // «+966506793241» و«0506793241» و«506793241» رقمٌ واحد: تُنزع الزخرفةُ
      // ويُطابَق آخرُ تسعِ خاناتٍ، فيُوجَد الهاتفُ كيفما كُتب.
      const bare = tk.replace(/\D/g, '');
      const numeric = /^[\d\s+()\-]+$/.test(tk) && bare.length > 0;
      const rx = arabicSearchRegex(tk);
      if (numeric) {
        const rxBare = new RegExp(bare.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
        const tail = bare.length > 9 ? bare.slice(-9) : bare;
        const rxTail = new RegExp(`${tail}$`);
        return [
          ...ID_EXACT.map((f) => ({ [f]: bare })),
          ...CODE_FIELDS.map((f) => ({ [f]: rxBare })),
          ...(bare.length >= 6 ? PHONE_FIELDS.map((f) => ({ [f]: rxTail })) : []),
        ];
      }
      return [...NAME_FIELDS, ...CODE_FIELDS].map((f) => ({ [f]: rx }));
    };

    const tokens = term.split(/\s+/).filter(Boolean);
    if (tokens.length <= 1) {
      filter.$or = clauseFor(term);
    } else {
      // كلُّ كلمةٍ شرطٌ مستقلّ، وتُجمَع بـ`$and` — والجملةُ كاملةً تُقبَل أيضًا
      // في حقول الأسماء (اسمٌ فيه مسافةٌ يُكتب كما هو).
      const whole = arabicSearchRegex(term);
      filter.$and = [
        ...(filter.$and || []),
        {
          $or: [
            { $and: tokens.map((tk) => ({ $or: clauseFor(tk) })) },
            ...NAME_FIELDS.map((f) => ({ [f]: whole })),
          ],
        },
      ];
    }
  }
  // فلاتر الأعمدة تُطبَّق هنا لا في المتصفح: كانت الصفحة تنزّل الجدول كلّه لتفلتره
  // محليًّا، فكان الفلتر يكلّف عشرات الآلاف من الصفوف ويجمّد التبويب.
  //
  // وتُضاف داخل `$and` لا على الجذر، لأن فلتر اليوم يحتاج `$or` (مدى اليوم أو
  // خانة فارغة) وعلى الجذر `$or` واحدة يشغلها البحث فيمحو أحدهما الآخر بصمت.
  const conds = columnFilters(query, skipField, allowMoney, allowSelling);
  if (conds.length) filter.$and = [...(filter.$and || []), ...conds];
  return filter;
}

// GET /api/workflows/stats — aggregates over the WHOLE matching set (not one
// page): total rows, "invoices not arrived" count, and total purchase value.
// Powers the operations-page summary cards so they reflect all ~27k records.
exports.getWorkflowStats = async (req, res) => {
  try {
    const filter = buildWorkflowFilter(req.query, undefined, canSeeMoney(req.user.role), canSeeSelling(req.user.role));
    // نفس الشرط الذي يفلتر به الزرّ — من تعريفٍ واحد، فلا يقول العدّاد رقمًا
    // ويفتح الزرّ غيره.
    const pendingMatch = { ...filter, $and: [...(filter.$and || []), PENDING_PAYMENT] };
    /**
     * ── والرقمُ الذي يُسأل عنه بعد «سندات لم تصل» مباشرةً ────────────────────
     *
     * صفٌّ بلا تاريخ سداد يُعَدُّ سندًا لم يصل، وحالةُ طلبِه تقول «استُلم
     * السند». وهذا تناقضٌ لا يُقرأ من البطاقتين منفصلتين: مجموعُ الأولى ٩٨٨
     * ومجموعُ الحالة أربعةُ آلاف، ولا يُعرَف أيُّهما يتقاطع.
     *
     * وهو موضعُ العمل: السندُ وصل (قالت الحالةُ ذلك) ولم يُكتب تاريخُ سداده في
     * الكشف — فإمّا تاريخٌ ناقصٌ يُكتب، أو حالةٌ تُصحَّح. فيُعَدُّ صريحًا.
     */
    const bondReceivedPending = {
      ...filter,
      $and: [...(filter.$and || []), PENDING_PAYMENT, { applicationStatus: 'bond_received' }],
    };
    /**
     * ── «سندات لم تصل» كاشًا وضريبيًّا، ومجموعُهما الإجماليّ بالضبط ────────────
     *
     * قاعدةُ صاحب الشركة: البطاقتان تساويان معًا بطاقةَ الإجماليّ. والقسمةُ على
     * `paymentType` — العمودِ نفسِه الذي تعرضه الصفحةُ «نوع الدفع» ويقرؤه التحصيل:
     *
     *   كاش    = نوعُ الدفع «كاش».
     *   ضريبي  = كلُّ ما سواه: «ضريبي»، **والذي لم يُحدَّد نوعُه بعد**.
     *
     * والثالثُ داخلٌ في الضريبيّ لا خارجَه، لأنّ الكشفَ بلا نوعٍ ينتظر رقمَ
     * فاتورةٍ ليصل التحصيل (`reachesCollections`: غيرُ النقديّ «بانتظار رقم
     * الفاتورة») — فهو في طريق الضريبيّ لا الكاش. ويُقال عددُه تحت البطاقة
     * (`pendingUntyped`) فلا يختبئ. والأرقامُ الثلاثةُ من تجميعٍ واحد، فلا
     * يفترق المجموعُ عن الإجماليّ ولو تغيّر صفٌّ بين استعلامين.
     */
    const PENDING_SPLIT = OperationsWorkflow.aggregate([
      { $match: pendingMatch },
      { $group: { _id: { $ifNull: ['$paymentType', ''] }, n: { $sum: 1 } } },
    ]);
    const [total, pendingRows, pendingBondReceived, agg, stages] = await Promise.all([
      OperationsWorkflow.countDocuments(filter),
      PENDING_SPLIT,
      OperationsWorkflow.countDocuments(bondReceivedPending),
      OperationsWorkflow.aggregate([
        { $match: filter },
        { $group: { _id: null, sumPurchaseValue: { $sum: '$purchaseValue' } } },
      ]),
      // عدّاد كل مرحلة يُحسب هنا أيضًا: كان يُحسب في المتصفح من الصفوف المحمَّلة،
      // فيقول «مكتمل: ٤» وهو لا يرى إلا خمسين صفًّا من عشرات الآلاف.
      OperationsWorkflow.aggregate([
        { $match: filter },
        { $group: { _id: '$stage', count: { $sum: 1 } } },
      ]),
    ]);

    // ── وأعدادُ حالة الأبلكيشن ───────────────────────────────────────────────
    // بطاقاتُ الحالات فوق الجدول كانت في صفحة شحنات المنصّة وحدَها، وهي السؤالُ
    // الأوّل هنا أيضًا: كم في الطريق؟ وكم وصلت ولم يصل سندُها؟ وحسابُها في
    // المتصفّح من الصفوف المحمَّلة يعدّ خمسين صفًّا من ستّةٍ وثلاثين ألفًا.
    //
    // وتُحسَب تحت الفلاتر القائمة عدا فلترَ الحالة نفسِه — كما يفعل إكسل: من
    // صفّى «في الطريق» يريد أن يرى بقيّةَ الحالات لينتقل إليها، لا أصفارًا.
    // و`skipField` هي الآليّةُ المكتوبةُ لذلك أصلًا في `buildWorkflowFilter`.
    const statusFree = buildWorkflowFilter(req.query, 'applicationStatus', canSeeMoney(req.user.role), canSeeSelling(req.user.role));
    const byStatusRows = await OperationsWorkflow.aggregate([
      { $match: statusFree },
      { $group: { _id: { $ifNull: ['$applicationStatus', ''] }, count: { $sum: 1 } } },
    ]);
    const byStatus = {};
    let statusTotal = 0;
    byStatusRows.forEach((r) => { byStatus[r._id || '(بلا حالة)'] = r.count; statusTotal += r.count; });

    let pendingCash = 0; let pendingTax = 0; let pendingUntyped = 0;
    for (const r of pendingRows) {
      if (r._id === 'cash') pendingCash += r.n;
      else { pendingTax += r.n; if (r._id !== 'tax') pendingUntyped += r.n; }
    }
    const pendingInvoices = pendingCash + pendingTax;
    res.json({
      total,
      pendingInvoices,
      pendingCash,
      pendingTax,
      pendingUntyped,
      pendingBondReceived,
      sumPurchaseValue: agg[0]?.sumPurchaseValue || 0,
      byStage: stages.reduce((acc, r) => { acc[r._id || 'draft'] = r.count; return acc; }, {}),
      byStatus,
      statusTotal,
    });
  } catch (error) {
    console.error('Get workflow stats error:', error);
    res.status(500).json({ message: 'Failed to load workflow stats' });
  }
};

/**
 * GET /api/workflows/filters?field=<العمود> — قيمُ عمودٍ واحد مع عدد صفوف كل قيمة.
 *
 * كانت قائمة الفلتر تُبنى من الصفوف المحمَّلة في المتصفح، وهي خمسون صفًّا، فتعرض
 * ثلاث حالاتٍ من أصل تسع؛ ثم عولج ذلك بتنزيل الجدول كلّه عند أول فلتر، فصار فتح
 * القائمة ينقل عشرات الآلاف من الصفوف ويجمّد التبويب دقيقةً كاملة. العدّ في
 * القاعدة يُرجع القيم كلّها في استعلامٍ واحد وبحجمٍ لا يُذكر.
 *
 * القيم محسوبةٌ على الفلاتر النشطة (المرحلة/البحث/المدى/بقيّة الأعمدة) لأن قائمةً
 * تعرض قيمًا لا صفوف لها بعد الفلترة تدعو المستخدم إلى اختيارٍ يُرجع جدولًا فارغًا.
 */
exports.filterOptions = async (req, res) => {
  try {
    const field = String(req.query.field || '');
    if (!FILTERABLE_COLUMNS.has(field)) {
      return res.status(400).json({ message: 'Unknown filter column' });
    }
    // وقائمةُ قيمِ عمودٍ محجوبٍ تعرضه قيمةً قيمة: «اجمالى الفاتوره» تُقرأ من
    // قائمتها كما تُقرأ من الجدول. فتُمنع لمن لا يملكه.
    if ((MONEY_FIELDS.includes(field) || field === 'invoiceState') && !canSeeMoney(req.user.role)) {
      return res.status(403).json({ message: 'Insufficient permissions' });
    }
    if (SELLING_FIELDS.includes(field) && !canSeeSelling(req.user.role)) {
      return res.status(403).json({ message: 'Insufficient permissions' });
    }
    // ── والمفتاحُ يحمل الصلاحيّة ────────────────────────────────────────
    // الشرطُ صار يختلف باختلاف الدور (فلاترُ أعمدة المال تُسقَط لمن لا يملكها)،
    // فمفتاحٌ لا يحمله يخدم دورًا بنتيجةٍ حُسبت لدورٍ آخر — وهي أوّلُ ثانيةٍ
    // بعد أن يفتح محاسبٌ القائمةَ نفسَها.
    const money = canSeeMoney(req.user.role);
    const selling = canSeeSelling(req.user.role);
    const key = `wf:filters:${money ? 'm' : 'x'}${selling ? 's' : 'x'}:${JSON.stringify(req.query || {})}`;
    const hit = cache.get(key);
    if (hit !== undefined) return res.json(hit);

    // حالاتُ رقم الفاتورة الثلاث تُعَدّ بشرطها لا بتجميع الحقل.
    if (field === 'invoiceState') {
      const base = buildWorkflowFilter(req.query, field, money, selling);
      const states = Object.keys(INVOICE_STATE_COND);
      const counts = await Promise.all(states.map((k) => OperationsWorkflow.countDocuments(
        { $and: [base, INVOICE_STATE_COND[k]] })));
      const values = states.map((value, i) => ({ value, count: counts[i] }));
      const body = { filters: [{ key: field, values, truncated: false, distinct: values.length }] };
      cache.set(key, body, 20000);
      return res.json(body);
    }

    // «التخليص» يُجمَّع برقم المعاملة، والفارغُ = غيرُ مرتبط.
    if (field === 'customsRef') {
      const base = buildWorkflowFilter(req.query, field, money, selling);
      const q = String(req.query.q || '').trim().toLowerCase();
      const agg = await OperationsWorkflow.aggregate([
        { $match: base },
        { $group: { _id: { $cond: [{ $eq: [{ $type: '$customsLink.clearance' }, 'objectId'] }, '$customsLink.refNumber', ''] }, count: { $sum: 1 } } },
      ]);
      let values = agg.map((r) => ({ value: String(r._id || ''), count: r.count }))
        .filter((o) => !q || o.value.toLowerCase().includes(q))
        .sort((a, b) => (a.value === '' ? 1 : b.value === '' ? -1 : b.value.localeCompare(a.value, 'en', { numeric: true })));
      const distinct = values.length;
      const truncated = values.length > MAX_FILTER_VALUES;
      if (truncated) values = values.slice(0, MAX_FILTER_VALUES);
      const body = { filters: [{ key: field, values, truncated, distinct }] };
      cache.set(key, body, 20000);
      return res.json(body);
    }

    // «مسؤول البيانات» يُعَدّ بالمصادر الثلاثة التي تملأ خانتَه — راجع utils/dataOwnerIndex.
    if (field === 'dataOwnerShown') {
      const owner = require('../utils/dataOwnerIndex');
      await owner.ensure();
      const base = buildWorkflowFilter(req.query, field, money, selling);
      const q = String(req.query.q || '').trim().toLowerCase();
      let values = (await owner.ownerOptions(OperationsWorkflow, base))
        .filter((o) => !q || o.value.toLowerCase().includes(q))
        .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value, 'ar'));
      const distinct = values.length;
      const truncated = values.length > MAX_FILTER_VALUES;
      if (truncated) values = values.slice(0, MAX_FILTER_VALUES);
      const body = { filters: [{ key: field, values, truncated, distinct }] };
      cache.set(key, body, 20000);
      return res.json(body);
    }

    const match = buildWorkflowFilter(req.query, field, money, selling);
    // البحث داخل القائمة يُنفَّذ هنا لا في المتصفح، لأن المتصفح لا يملك إلا القيم
    // التي بلغت السقف: البحث عن رقم كشفٍ ليس ضمن الخمسمئة الأكثر تكرارًا كان
    // يُرجع «لا توجد قيم» والقيمة موجودة في القاعدة.
    const q = String(req.query.q || '').trim();
    // (ونوعُ الدفع ستُّ قيمٍ تُقرأ أسماؤها لا مفاتيحُها — لا بحثَ فيها.)
    if (q && field !== 'paymentType' && !NUMERIC_COLUMNS.has(field) && !DATE_COLUMNS.has(field)) {
      const rx = { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
      const prev = match[field];
      // الشرط القائم على العمود قد يكون قيمةً مفردة (اختيار المرحلة من الشريط
      // العلوي)؛ ونشرُ نصٍّ داخل كائن يفكّكه إلى حروف فيصير الشرط بلا معنى.
      match[field] = prev === undefined ? rx
        : (prev && typeof prev === 'object' && !(prev instanceof Date) ? { ...prev, ...rx } : { $eq: prev, ...rx });
    }

    const isDate = DATE_COLUMNS.has(field);
    // ── والترتيبُ يتبع طبيعةَ العمود ──────────────────────────────────────────
    // التواريخُ من الأحدث: مَن يفلتر بتاريخ يبحث عن أيامٍ قريبة، لا عن اليوم
    // الذي صادف أن فيه أكبرَ عددِ كشوف.
    //
    // وأعمدةُ الأرقام (الكشف، المستند، الفاتورة) قيمتُها فريدةٌ لكلّ صفٍّ تقريبًا،
    // فالترتيبُ بالتكرار يرفع إلى رأس القائمة الرقمَ الذي تكرّر مرّتين بالخطأ
    // ويدفن سبعةً وثلاثين ألفًا سواه — ويُقرأ كأنّه فلترٌ مفروض. فتُرتَّب
    // بقيمتها تنازليًّا: أعلى القائمة أحدثُها، وهو ما يُطلَب.
    // (وقع هذا في دفتر الفواتير: راجع collectionsDeptController.invoiceColumnOptions.)
    const ID_LIKE = new Set(['reportNumber', 'documentNumber', 'invoiceNumber', 'carNumber', 'plateNumber']);
    const isIdLike = !isDate && ID_LIKE.has(field);
    const sort = isDate ? { _id: -1 } : (isIdLike ? { _num: -1, _id: -1 } : { count: -1, _id: 1 });
    const [agg] = await OperationsWorkflow.aggregate([
      { $match: match },
      {
        $group: {
          // ونوعُ الدفع يُجمَّع بما تعرضه الخانة: النوعُ إن وُجد، وإلّا العائلة.
          _id: isDate ? { $dateToString: { format: '%Y-%m-%d', date: `$${field}`, timezone: TZ } }
            : (field === 'paymentType' ? PAYMENT_KIND_EXPR : `$${field}`),
          count: { $sum: 1 },
        },
      },
      // الرقمُ يُقرأ رقمًا لا نصًّا: «10012» بعد «7679» لا قبله.
      ...(isIdLike ? [{ $addFields: { _num: { $convert: { input: '$_id', to: 'double', onError: null, onNull: null } } } }] : []),
      {
        $facet: {
          values: [{ $sort: sort }, { $limit: MAX_FILTER_VALUES + 1 }],
          meta: [{ $count: 'distinct' }],
        },
      },
    ]).allowDiskUse(true);

    // الحقل غير الموجود وnull ينتجان المفتاح نفسه (null)، والنصّ الفارغ ينتج ''،
    // وكلّها عند المستخدم شيءٌ واحد: «(فارغ)». دمجها هنا يمنع ظهور سطرين متطابقين
    // في القائمة لا يفرّق بينهما شيء.
    const merged = new Map();
    for (const r of (agg?.values || [])) {
      const id = r._id;
      // والنصُّ يُجمَع مقصوصًا: «الدمام » و«الدمام» سطرٌ واحدٌ كما في الجدول، وفلترُه
      // يطابق الصيغتين (راجع columnFilters).
      const value = id === null || id === undefined || id === ''
        ? ''
        : (id instanceof Date ? id.toISOString() : (typeof id === 'string' ? colKey(id) : String(id)));
      merged.set(value, (merged.get(value) || 0) + r.count);
    }
    // والدمجُ لا يُفسد ترتيبَ القاعدة: يُعاد الترتيبُ بنفس القاعدة التي فوق.
    const numOf = (v) => { const n = Number(String(v).replace(/[\s,]/g, '')); return Number.isFinite(n) ? n : null; };
    let values = [...merged.entries()].map(([value, count]) => ({ value, count }))
      .sort((a, b) => {
        if (isDate) return b.value.localeCompare(a.value);
        if (isIdLike) {
          const na = numOf(a.value); const nb = numOf(b.value);
          if (na !== null && nb !== null) return nb - na;
          if (na !== null) return -1;
          if (nb !== null) return 1;
          return b.value.localeCompare(a.value, 'ar', { numeric: true });
        }
        return b.count - a.count || a.value.localeCompare(b.value, 'ar', { numeric: true });
      });
    const distinct = agg?.meta?.[0]?.distinct || values.length;
    const truncated = values.length > MAX_FILTER_VALUES;
    if (truncated) values = values.slice(0, MAX_FILTER_VALUES);

    // الشكل نفسه الذي تتكلّمه فلاتر الموارد البشرية وسجلّ المركبات، حتى لا يتعلّم
    // كل قسمٍ لغةً خاصة به: { filters: [{ key, values: [{ value, count }] }] }.
    const body = { filters: [{ key: field, values, truncated, distinct }] };
    cache.set(key, body, 20000);
    res.json(body);
  } catch (error) {
    console.error('workflow filterOptions', error);
    res.status(500).json({ message: 'Failed to load column filter values' });
  }
};

// GET /api/workflows/:id
exports.getWorkflow = async (req, res) => {
  try {
    const workflow = await OperationsWorkflow.findById(req.params.id)
      .populate('createdBy', 'firstName lastName')
      .populate('lastModifiedBy', 'firstName lastName')
      .populate('lockedBy', 'firstName lastName');

    if (!workflow) {
      return res.status(404).json({ message: 'Workflow not found' });
    }

    res.json(stripRowFor(req.user.role, workflow));
  } catch (error) {
    console.error('Get workflow error:', error);
    res.status(500).json({ message: 'Failed to load workflow details' });
  }
};

// POST /api/workflows
exports.createWorkflow = async (req, res) => {
  try {
    const filteredBody = filterFieldsByRole(req.body, req.user.role, await fieldsForRole(req.user.role));
    // نوعُ الدفع يقرّر شكلَ الكشف من لحظة إنشائه، لا بعد أوّل تعديل.
    await fillPaymentTypeFromCustomer(filteredBody, {});
    applyBillingRules(filteredBody, {});
    filteredBody.createdBy = req.user._id;
    filteredBody.lastModifiedBy = req.user._id;
    filteredBody.stage = 'draft';

    const workflow = await OperationsWorkflow.create(filteredBody);
    if (filteredBody.invoiceNumber) await ensureLedgerInvoice(workflow);
    // كشفٌ قد ذكره التخليصُ في خانة نقلٍ قبل أن يُنشأ، أو سندُه بوليصةُ معاملة.
    await require('../services/customsOpsLink').resolveReports({ _id: workflow._id })
      .catch((e) => console.error('customs link (workflow create):', e.message));
    // كشفٌ يُنشأ في النظام لعميلٍ جديد يُدخله قسمَ التحصيل بكوده بنوع حمولته —
    // كما تفعل مزامنةُ المنصّة. راجع ensureCollectionsParty.
    if (workflow.username) {
      const { ensureCollectionsParty } = require('../utils/ensureCollectionsParty');
      ensureCollectionsParty(workflow.username, { paymentType: workflow.paymentType, source: 'operations_workflow' }).catch(() => {});
    }

    // ── ولا يُنسَخ الكشفُ إلى عميلٍ وفاتورة ──────────────────────────────
    // كان كلُّ كشفٍ يُنشئ خلفَه سجلَّ عميلٍ وفاتورةً في ورك فلو «العملاء
    // والمالية»، ويزيد «المستحقّ» على ذلك العميل. فصار للشيء الواحد رقمان:
    // يُعدَّل الكشفُ فيبقى المستحقُّ على القديم، ولا يُعرف أيُّهما الصحيح.
    //
    // والكشفُ نفسُه هو المستند: قسمُ التحصيل يقرأ منه ما لنا وما علينا مباشرةً
    // (`collectionsDeptController`)، وملفُّ الطرف يُبنى من صفوفه. فالنسخُ لم
    // يعد يضيف شيئًا سوى رقمٍ ثانٍ يتأخّر عن الأوّل.

    const populated = await OperationsWorkflow.findById(workflow._id)
      .populate('createdBy', 'firstName lastName')
      .populate('lastModifiedBy', 'firstName lastName');

    await logAudit({
      user: req.user._id,
      action: 'create_workflow',
      entity: 'OperationsWorkflow',
      entityId: workflow._id,
      changes: { after: filteredBody },
      ipAddress: req.ip,
    });

    bustFilterCache();
    try { emitPerRole('workflow:created', (r) => stripRowFor(r, populated)); } catch (e) { console.error('WebSocket emit error:', e); }

    res.status(201).json(populated);
  } catch (error) {
    console.error('Create workflow error:', error);
    res.status(500).json({ message: 'Failed to create workflow' });
  }
};

// PUT /api/workflows/:id
/**
 * ── تاريخُ الفاتورة يومُ كتابة رقمها ────────────────────────────────────────
 * حين يُكتب رقمُ الفاتورة لأوّل مرّةٍ ولا تاريخَ لها، يُكتب تاريخُها يومَ الكتابة
 * (بتوقيت الشركة) — ويبقى يُعدَّل باليد بعد ذلك كأيّ خانة.
 *
 * و«تاريخُ التسليم للعميل» غيرُه ولا يُشتقّ منه أبدًا: الفاتورةُ تُصدَر اليومَ
 * وتُسلَّم للعميل بعد أيّامٍ أو أسابيع. يكتبه المستخدمُ بيده — هنا أو في قسم
 * التحصيل — وما كُتب في أحدهما يظهر في الآخر في الحال (مزامنةُ الدفتر في الحفظ
 * وزرُّ «تسليم» في التحصيل).
 */
function stampInvoiceDate(patch, current) {
  if (!Object.prototype.hasOwnProperty.call(patch, 'invoiceNumber')) return;
  const was = String((current && current.invoiceNumber) || '').trim();
  const now = String(patch.invoiceNumber || '').trim();
  if (!now || was) return;
  const sent = Object.prototype.hasOwnProperty.call(patch, 'invoiceDate') && patch.invoiceDate;
  if (sent || (current && current.invoiceDate)) return;
  patch.invoiceDate = new Date(`${require('../utils/companyDay').todayKey()}T00:00:00.000Z`);
}
exports._stampInvoiceDate = stampInvoiceDate;

/**
 * ── قيمةُ البيع إلى منصّة التشغيل ───────────────────────────────────────────
 *
 * المنصّةُ تحمل للشحنة سعرين: `purchase_price` («Cost to company») و`selling_price`
 * («Price charged to client») — `PATCH /api/v1/admin/shipments/{id}` بـ
 * multipart/form-data، وكلُّ حقولها اختياريّة (UpdateShipmentDto). فتُرسَل
 * `selling_price` وحدَها، و**لا يُلمَس `purchase_price` أبدًا**: هو كلفتُنا،
 * ومنه تُقرأ قيمةُ الشراء هنا.
 *
 * كشفٌ ليس من المنصّة (أُنشئ عندنا أو استُورد) لا شحنةَ له هناك: يُكتب هنا
 * وحدَه، ويُقال ذلك في الردّ (`platform: false`).
 */
// ── ومعلَّقٌ حتّى يقرّر صاحبُ الشركة ────────────────────────────────────────
// كتابةُ سعر البيع الحقيقيّ في المنصّة تُظهر هامشَنا لفريقها، وكانت قيمتُه
// هناك تساوي الكلفة. فبقيت مطفأةً حتّى أذن بها صاحبُ الشركة صراحةً
// (٢٠٢٦/١٠/٢١: «افتح الكتابة على المنصة»). والإطفاءُ = `false` هنا ونشرٌ جديد.
const PUSH_SELLING_TO_PLATFORM = true;

async function pushSellingValue(workflow, value) {
  if (!PUSH_SELLING_TO_PLATFORM) return { platform: false, held: true };
  if (workflow.externalSource !== 'ops_upl' || !workflow.externalId) return { platform: false };
  const upl = require('../services/uplClient');
  const shipmentId = String(workflow.externalId);
  await upl.patch(`/admin/shipments/${encodeURIComponent(shipmentId)}`, { form: { selling_price: value } });
  return { platform: true, shipmentId };
}
exports._pushSellingValue = pushSellingValue;

/** مَن يقرأ `sellingValue` ويحفظ ما قرأ — يُمسح قبل أيّ بثّ. */
/** ذاكرةُ قسم التحصيل (اللوحة والشجرة والدفتر) — تُمسح قبل أيّ بثٍّ يقرؤها. */
function invalidateCollectionsReaders() {
  try { require('./collectionsDeptController').invalidate(); } catch (_) { /* */ }
  try { require('./collectionsLedgerController').invalidate(); } catch (_) { /* */ }
}

function invalidateSellingReaders() {
  for (const p of ['wf:', 'collections-dept:', 'cdr:', 'colledger:', 'opsprivate:', 'ops:']) {
    try { cache.clear(p); } catch (_) { /* */ }
  }
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  قيمةُ البيع — طريقٌ واحدٌ لكلّ شاشة
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * كانت لقيمة البيع نسختان: عمودُ `sellingValue` في الكشف، و«السعرُ الحقيقيّ»
 * في `PrivateSellingPrice` تكتبه صفحةُ «التشغيل — خاصّ» وحدَها. فيُصحَّح السعرُ
 * في إحداهما وتبقى الأخرى على القديم، ولا يُعرف أيُّهما الصحيح.
 *
 * فصار الكشفُ هو المرجعَ الوحيد (صاحبُ الشركة، ٢٠٢٦/١٠/٢١)، والكتابةُ من أيّ
 * شاشةٍ تمرّ من هنا: التحقّقُ، ثمّ المنصّة، ثمّ الحفظ، ثمّ الذاكرةُ والبثّ.
 *
 * `prepareSellingValue` — قبل الحفظ: يتحقّق ويدفع إلى المنصّة، ويُرجع خطأً
 *   بحالته إن رُفض (فلا يُحفظ شيءٌ والمنصّةُ على القديم).
 * `announceSellingValue` — بعد الحفظ: يمسح الذاكرة **قبل** البثّ ويبثّ.
 */
async function prepareSellingValue(workflow, raw) {
  const v = raw === '' || raw === null || raw === undefined ? 0 : Number(raw);
  if (!Number.isFinite(v) || v < 0) {
    return { error: { status: 400, body: { code: 'BAD_SELLING_VALUE', fields: ['sellingValue'], message: 'قيمة البيع يجب أن تكون رقمًا لا يقلّ عن صفر.' } } };
  }
  const value = Math.round(v * 100) / 100;
  if (value === Math.round((Number(workflow.sellingValue) || 0) * 100) / 100) return { unchanged: true, value };
  let push;
  try {
    push = await pushSellingValue(workflow, value);
  } catch (e) {
    return {
      error: {
        status: 502,
        body: {
          code: 'PLATFORM_WRITE_FAILED',
          fields: ['sellingValue'],
          message: `تعذّرت كتابة قيمة البيع في منصّة التشغيل — لم يُحفظ شيء. (${e.message || 'خطأ في المنصّة'})`,
        },
      },
    };
  }
  return { value, push };
}

function announceSellingValue(workflow, push) {
  invalidateSellingReaders();
  try { emitToAll('collections:changed', { source: 'workflow', field: 'sellingValue', reportNumber: workflow.reportNumber }); } catch (e) { /* */ }
  // والصفحةُ الخاصّةُ تسمع خبرَها باسمه — تقرأ العمودَ نفسَه.
  try { emitToAll('operationsPrivate:updated', { _id: String(workflow._id), sellingValue: workflow.sellingValue }); } catch (e) { /* */ }
  if (push && push.platform) {
    try { emitToAll('ops:shipments:changed', { resource: 'shipments', action: 'selling_price', ids: [push.shipmentId], at: Date.now() }); } catch (e) { /* */ }
  }
}

/**
 * يكتب قيمةَ البيع وحدَها على كشف — لشاشةٍ لا تعدّل غيرَها («التشغيل — خاصّ»).
 * القواعدُ هي قواعدُ `updateWorkflow` حرفًا: صلاحيّةُ الحقل (SELLING_ROLES)،
 * والقفل، والمنصّةُ أوّلًا، والمصدرُ `manual` فلا تكتب المزامنةُ فوقها.
 * يُرجع `{ status, body }` ولا يكتب الردَّ بنفسه.
 */
async function setSellingValue(id, raw, user, { ip, note } = {}) {
  if (!mongoose.isValidObjectId(id)) return { status: 400, body: { message: 'معرّف غير صالح' } };
  const fields = await fieldsForRole(user.role);
  if (!fields.includes('sellingValue')) {
    return {
      status: 403,
      body: { code: 'FIELDS_NOT_ALLOWED', fields: ['sellingValue'], message: 'صلاحيّتك لا تسمح بتعديل: sellingValue — لم يُحفظ شيء.' },
    };
  }
  const workflow = await OperationsWorkflow.findById(id);
  if (!workflow) return { status: 404, body: { message: 'الكشف غير موجود' } };
  if (isLocked(workflow, user._id)) {
    return { status: 423, body: { message: `This record is currently being edited by ${workflow.lockedByName || 'another user'}` } };
  }
  const prep = await prepareSellingValue(workflow, raw);
  if (prep.error) return prep.error;
  if (prep.unchanged) return { status: 200, body: { workflow: stripRowFor(user.role, workflow), unchanged: true } };

  const before = { sellingValue: workflow.sellingValue, sellingValueSource: workflow.sellingValueSource };
  workflow.sellingValue = prep.value;
  workflow.sellingValueSource = 'manual';
  workflow.lastModifiedBy = user._id;
  await workflow.save();

  await logAudit({
    user: user._id,
    action: 'update_workflow',
    entity: 'OperationsWorkflow',
    entityId: workflow._id,
    changes: { before, after: { sellingValue: prep.value, sellingValueSource: 'manual', ...(note ? { note } : {}) } },
    ipAddress: ip,
  });

  bustFilterCache();
  announceSellingValue(workflow, prep.push);
  try { emitPerRole('workflow:updated', (r) => stripRowFor(r, workflow)); } catch (e) { console.error('WebSocket emit error:', e); }
  return {
    status: 200,
    body: { workflow: stripRowFor(user.role, workflow), sellingPlatform: !!(prep.push && prep.push.platform) },
  };
}
exports.setSellingValue = setSellingValue;

exports.updateWorkflow = async (req, res) => {
  try {
    const workflow = await OperationsWorkflow.findById(req.params.id);
    if (!workflow) {
      return res.status(404).json({ message: 'Workflow not found' });
    }

    // Check lock
    if (isLocked(workflow, req.user._id)) {
      return res.status(423).json({
        message: `This record is currently being edited by ${workflow.lockedByName || 'another user'}`,
      });
    }

    const filteredBody = filterFieldsByRole(req.body, req.user.role, await fieldsForRole(req.user.role));

    // ── مبلغُ السداد من المحفظة لا يُكتب هنا ─────────────────────────────────
    // كشفٌ له مشترياتٌ في المحفظة: مبلغُه ما كتبه موظّفُ العهدة. وكان فتحُ
    // الكشف وحفظُه والخانةُ فارغة يمسحه (راجع utils/walletPayment).
    if (Object.prototype.hasOwnProperty.call(filteredBody, 'paymentAmount')) {
      const walletAmount = await require('../utils/walletPayment').walletPurchaseAmount(workflow.reportNumber);
      if (walletAmount != null) filteredBody.paymentAmount = walletAmount;
    }

    // ما لا يملكه الطالبُ يُقال له، لا يُبتلع. وإلّا ظنّ أنّه حفظ.
    const rejected = filteredBody.__rejected || [];
    if (rejected.length && !Object.keys(filteredBody).length) {
      return res.status(403).json({
        code: 'FIELDS_NOT_ALLOWED',
        fields: rejected,
        message: `صلاحيّتك لا تسمح بتعديل: ${rejected.join('، ')} — لم يُحفظ شيء.`,
      });
    }

    stampInvoiceDate(filteredBody, workflow);

    // ── تاريخ السداد لا يُسجَّل قبل استلام السند ──────────────────────────────
    // السداد إقرارٌ بوصول المال، ولا يصل قبل استلام سند التسليم. تسجيله قبله
    // يجعل التقارير المالية تَعُدُّ مبلغًا لم يُقبَض.
    //
    // الشرط هنا لا في الشاشة وحدها: الشاشة تمنع الخطأ، والخادم يمنع الاحتيال —
    // وأي مسار آخر (الموبايل، استيراد، طلب مباشر) يمرّ من هنا أيضًا.
    const settingPayment = Object.prototype.hasOwnProperty.call(filteredBody, 'paymentDate')
      && filteredBody.paymentDate && String(filteredBody.paymentDate).trim();
    if (settingPayment) {
      const statusAfter = String(
        Object.prototype.hasOwnProperty.call(filteredBody, 'applicationStatus')
          ? filteredBody.applicationStatus
          : workflow.applicationStatus || '',
      ).trim();
      if (statusAfter !== 'bond_received') {
        return res.status(400).json({
          code: 'BOND_NOT_RECEIVED',
          message: 'لا يُسجَّل تاريخ السداد إلا بعد أن تصبح حالة الطلب «استُلم السند».'
            + ' السداد إقرارٌ بوصول المال، ولا يصل قبل استلام السند.',
          applicationStatus: statusAfter || null,
        });
      }
    }

    // ── ومَن كتب التاريخَ يُكتب معه ────────────────────────────────────────
    // يُسجَّل عند أوّل كتابةٍ وعند كلّ تعديلٍ للتاريخ — فالعمودُ يقول «آخرُ مَن
    // مسّ السداد» لا «أوّلُ من كتبه». راجع paymentDateBy في النموذج.
    if (Object.prototype.hasOwnProperty.call(filteredBody, 'paymentDate')) {
      const nextDate = filteredBody.paymentDate ? String(filteredBody.paymentDate) : '';
      const prevDate = workflow.paymentDate ? new Date(workflow.paymentDate).toISOString().slice(0, 10) : '';
      if (nextDate.slice(0, 10) !== prevDate) {
        filteredBody.paymentDateBy = req.user._id;
        filteredBody.paymentDateByName = `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim();
        filteredBody.paymentDateAt = new Date();
      }
    }

    // ── وقواعدُ الفوترة تُطبَّق هنا ────────────────────────────────────────
    // كشفٌ نقديٌّ لا يُفوتَر، وصافي الفاتورة يشتقّ ضريبتَه وإجماليَّها. والشرطُ
    // على الخادم لا على الشاشة: أيُّ نافذةٍ أخرى (تحديثٌ جماعيّ، تطبيق، نداءٌ
    // مباشر) تمرّ من هنا كذلك.
    // ما أرسله المستخدمُ فعلًا — يُلتقط قبل التصفير، لأنّ `applyBillingRules`
    // تُضيف الأعمدةَ المقفولة بقيمها الصفريّة، فلو قيس عليها بعدُ لبدا الطلبُ
    // كأنّه حمل حقولًا مسموحة ولم يُرفض شيء.
    const sentKeys = Object.keys(filteredBody);
    // نوعُ الدفع يُملأ من ملفّ العميل قبل تطبيق القواعد، فيُقفل الكشفُ النقديُّ
    // في الحفظة نفسِها التي سُجّل فيها سدادُه — لا في تعديلٍ ثانٍ.
    await fillPaymentTypeFromCustomer(filteredBody, workflow.toObject());
    const billing = applyBillingRules(filteredBody, workflow.toObject());
    // رقمُ فاتورةٍ على كشفٍ نقديّ يُرفض صراحةً ولو جاء مع غيره: إسقاطُه في صمتٍ
    // وحفظُ الباقي يُقرأ «حُفظ الرقم» وهو لم يُحفظ.
    if (billing.blocked.includes('invoiceNumber')) {
      return res.status(400).json({
        code: 'CASH_INVOICE_NUMBER',
        fields: ['invoiceNumber'],
        message: 'الكشف نقديّ — الكاش ليس له رقم فاتورة. غيّر نوع الدفع إلى «ضريبي» أوّلًا ثمّ اكتب الرقم.',
      });
    }
    if (billing.blocked.length && sentKeys.every((k) => billing.blocked.includes(k))) {
      return res.status(400).json({
        code: 'CASH_INVOICE_LOCKED',
        fields: billing.blocked,
        message: 'الكشف نقديّ: لا فاتورة له ولا سند — الأعمدة المقفولة لا تُكتب.'
          + ` (${billing.blocked.join('، ')})`,
      });
    }

    // ── قيمةُ البيع تُكتب في منصّة التشغيل أوّلًا ثمّ هنا ──────────────────────
    // المنصّةُ تملك `selling_price` للشحنة وتعيد كتابتَه في كلّ مزامنة. فإن كُتبت
    // هنا وحدَها كذبت شاشتان: المنصّةُ تقول سعرًا وسيرُ العمل غيرَه. فتُدفع إليها
    // أوّلًا (راجع pushSellingValue)، ولا يُحفظ شيءٌ إن رفضتها — فلا يُقال «حُفظ»
    // وقد بقيت المنصّةُ على القديم.
    let sellingChanged = false;
    let sellingPush = null;
    // (الطريقُ نفسُه الذي تكتب به «التشغيل — خاصّ» — راجع prepareSellingValue.)
    if (Object.prototype.hasOwnProperty.call(filteredBody, 'sellingValue')) {
      const prep = await prepareSellingValue(workflow, filteredBody.sellingValue);
      if (prep.error) return res.status(prep.error.status).json(prep.error.body);
      if (prep.unchanged) {
        delete filteredBody.sellingValue;
      } else {
        filteredBody.sellingValue = prep.value;
        sellingPush = prep.push;
        filteredBody.sellingValueSource = 'manual';
        sellingChanged = true;
      }
    }

    filteredBody.lastModifiedBy = req.user._id;

    const before = workflow.toObject();
    const hadCollectionDate = !!workflow.collectionDate;
    Object.assign(workflow, filteredBody);
    // ── تحصيلٌ كُتب بيدٍ هنا هو تحصيلُ يد ────────────────────────────────────
    // مَن غيّر تاريخَ التحصيل أو مبلغَه من هذه الشاشة أخذ الكشفَ من المحفظة:
    // لا تعود فتكتب فوقه ولا ترفعه. راجع utils/walletCollection.
    if (['collectionDate', 'collectedAmount'].some((k) => filteredBody[k] !== undefined
      && String(before[k] ?? '') !== String(workflow[k] ?? ''))) {
      workflow.collectedByWallet = false;
    }
    await workflow.save();
    // رقمُ فاتورةٍ كُتب الآن يصنع قيدَه، فتصل الشاشةَ الضريبيّة فورًا.
    if (LEDGER_FIELDS.some((k) => filteredBody[k] !== undefined)) await ensureLedgerInvoice(workflow, before.invoiceNumber);
    if (filteredBody.username !== undefined || filteredBody.paymentType !== undefined) {
      const { ensureCollectionsParty } = require('../utils/ensureCollectionsParty');
      if (workflow.username) ensureCollectionsParty(workflow.username, { paymentType: workflow.paymentType, source: 'operations_workflow' }).catch(() => {});
    }

    // ── ودفترُ التحصيل يتبع الكشف ────────────────────────────────────────
    // تاريخُ التحصيل أو تسليمِ العميل كُتب أو مُحي من هنا: يتبعه صفُّه في دفتر
    // التحصيل، فلا تقول شاشتا القسمين شيئين عن فاتورةٍ واحدة.
    {
      const moved = (k) => filteredBody[k] !== undefined && String(before[k] || '') !== String(workflow[k] || '');
      const changed = { collectionDate: moved('collectionDate'), deliveryDate: moved('deliveryDate') };
      if (changed.collectionDate || changed.deliveryDate) {
        await require('./collectionsDeptController').syncLedgerFromWorkflows(workflow, changed)
          .catch((e) => console.error('ledger sync (workflow update):', e.message));
      }
    }

    // ── وتحصيلُ المحفظة يتبع نوعَ الكشف ─────────────────────────────────────
    // صار نقديًّا وعليه قيدُ تحصيلٍ في المحفظة فيُحصَّل، وكفّ عن النقد فيُرفع ما
    // كتبته المحفظة. وكذلك إن تغيّر رقمُه. راجع utils/walletCollection.
    if (String(before.paymentType || '') !== String(workflow.paymentType || '')
      || String(before.reportNumber || '') !== String(workflow.reportNumber || '')) {
      await require('../utils/walletCollection')
        .syncWalletCollection([workflow.reportNumber, before.reportNumber], { user: req.user, reason: 'تغيّر نوع الكشف' })
        .catch((e) => console.error('wallet cash-collection (workflow update):', e.message));
    }

    // ── ونوعُ الدفع يتبعه قسمُ التحصيل في الحال ────────────────────────────
    // لوحةُ التحصيل تقسم المديونيّةَ بالأنواع الأربعة (راجع
    // collectionsReceivablesController.subtypeCards)، وتقرأ من ذاكرةٍ مؤقّتة.
    // فتُمسح الذاكرةُ **قبل** البثّ أدناه — وإلّا قرأ المستمعُ القديمَ وتأخّر
    // خطوةً (announce-before-invalidate).
    const kindMoved = String(before.paymentType || '') !== String(workflow.paymentType || '')
      || String(before.paymentSubtype || '') !== String(workflow.paymentSubtype || '');
    if (kindMoved) invalidateCollectionsReaders();

    // ── وتاريخُ التحصيل لا يُنشئ دفعةً في مكانٍ آخر ──────────────────────
    // كان إثباتُ تاريخ التحصيل يقيّد `Payment` ويحدّث فاتورةً ورصيدَ عميل في
    // ورك فلو لم يعد يجري. والتاريخُ في الكشف هو الإثبات: قسمُ التحصيل يقرأ
    // «ما حُصِّل» من عمود التحصيل نفسِه، لا من نسخةٍ عنه.

    // ── و«رقم السند» قد يكون بوليصةَ معاملة تخليص أو حاويتَها ───────────────
    // يُعاد ربطُ الكشف قبل جلب نسخته، فيخرج الردُّ والبثُّ بالربط الجديد.
    if (String(before.documentNumber || '') !== String(workflow.documentNumber || '')
      || String(before.reportNumber || '') !== String(workflow.reportNumber || '')) {
      await require('../services/customsOpsLink').resolveReports({ _id: workflow._id })
        .catch((e) => console.error('customs link (workflow update):', e.message));
    }

    const populated = await OperationsWorkflow.findById(workflow._id)
      .populate('createdBy', 'firstName lastName')
      .populate('lastModifiedBy', 'firstName lastName')
      .populate('lockedBy', 'firstName lastName');

    await logAudit({
      user: req.user._id,
      action: 'update_workflow',
      entity: 'OperationsWorkflow',
      entityId: workflow._id,
      changes: { before, after: filteredBody },
      ipAddress: req.ip,
    });

    bustFilterCache();
    // قيمةُ البيع يقرؤها التحصيلُ (مستحقُّ الكاش وأعمارُه) والصفحةُ الخاصّة ولوحاتُ
    // المنصّة — تُمسح ذاكرتُها **قبل** البثّ، وإلّا قرأ المستمعُ القديمَ وتأخّر
    // خطوةً (راجع announce-before-invalidate).
    if (sellingChanged) invalidateSellingReaders();
    try { emitPerRole('workflow:updated', (r) => stripRowFor(r, populated)); } catch (e) { console.error('WebSocket emit error:', e); }
    // `emitPerRole` لا يعبر إلى العامل الآخر — فخبرُ التحصيل يُبثّ للجميع.
    if (kindMoved) {
      try { emitToAll('collections:changed', { source: 'workflow', field: 'paymentType', reportNumber: workflow.reportNumber }); } catch (e) { /* */ }
    }
    // ── وصفحةُ معاملة التخليص تعرض الكشفَ كاملًا ──────────────────────────────
    // وتُعدِّله من مكانها. و`workflow:updated` يُبثّ لكلّ دورٍ على هذا العامل
    // وحدَه؛ فالخبرُ للمعاملة يُبثّ للجميع — بلا صفٍّ فيه، تجلب الصفحةُ ما يحقّ لقارئها.
    // (لا ذاكرةَ تحمل «كشوف المعاملة» فتُمسح قبله: تُقرأ من القاعدة في كلّ طلب.)
    {
      const linkedTo = [before.customsLink && before.customsLink.clearance, populated.customsLink && populated.customsLink.clearance]
        .filter(Boolean).map(String);
      if (linkedTo.length) {
        try { emitToAll('customs:opsLinks', { clearanceIds: [...new Set(linkedTo)], reportNumbers: [workflow.reportNumber], edited: true }); } catch (e) { /* */ }
      }
    }
    if (sellingChanged) announceSellingValue(workflow, sellingPush);

    // ما رُفض يُقال حتّى حين نجح غيرُه: الحفظُ الجزئيُّ الصامتُ يترك الموظّف
    // يظنّ أنّ الستّةَ حُفظت وقد حُفظ واحد.
    // وردُّ الحفظ يُحجب كما تُحجب القائمة: هو نسخةُ الصفّ التي تحلّ محلَّ
    // القديمة في الشاشة، فلو خرج كاملًا عاد المحجوبُ من باب الحفظ.
    const out = stripRowFor(req.user.role, populated);
    const extra = {};
    if (rejected.length) {
      extra.refusedFields = rejected;
      extra.refusedMessage = `لم تُحفظ (خارج صلاحيّتك): ${rejected.join('، ')}`;
    }
    // ويُقال أين كُتبت قيمةُ البيع: في المنصّة وهنا، أم هنا وحدَه (كشفٌ ليس منها).
    if (sellingPush) extra.sellingPlatform = !!sellingPush.platform;
    if (Object.keys(extra).length) {
      return res.json(Object.assign(out.toObject ? out.toObject() : { ...out }, extra));
    }
    res.json(out);
  } catch (error) {
    console.error('Update workflow error:', error);
    res.status(500).json({ message: 'Failed to update workflow' });
  }
};

// PUT /api/workflows/:id/stage
exports.updateStage = async (req, res) => {
  try {
    const { stage } = req.body;
    const validTransitions = {
      draft: ['submitted_to_ops'],
      submitted_to_ops: ['ops_completed', 'draft'],
      ops_completed: ['submitted_to_collections', 'submitted_to_ops'],
      submitted_to_collections: ['completed', 'ops_completed'],
      completed: [],
    };

    const workflow = await OperationsWorkflow.findById(req.params.id);
    if (!workflow) {
      return res.status(404).json({ message: 'Workflow not found' });
    }

    // Check lock
    if (isLocked(workflow, req.user._id)) {
      return res.status(423).json({
        message: `This record is currently being edited by ${workflow.lockedByName || 'another user'}`,
      });
    }

    const allowed = validTransitions[workflow.stage] || [];
    // Super admin can force any transition
    // …وأهلُ المال معه — راجع config/financeAuthority.
    if (req.user.role !== 'super_admin' && !isFinanceFull(req.user.role) && !allowed.includes(stage)) {
      return res.status(400).json({
        message: `Cannot transition from "${workflow.stage}" to "${stage}"`,
      });
    }

    // Role-based stage transition authorization
    const stageRoleMap = {
      submitted_to_ops: ['moderator', 'super_admin', ...FINANCE_FULL_ROLES],
      ops_completed: ['operations_manager', 'super_admin', ...FINANCE_FULL_ROLES],
      submitted_to_collections: ['operations_manager', 'super_admin', ...FINANCE_FULL_ROLES],
      completed: ['admin', 'employee', 'super_admin', ...FINANCE_FULL_ROLES],
      draft: ['moderator', 'operations_manager', 'super_admin', ...FINANCE_FULL_ROLES], // rollback
    };

    const allowedRoles = stageRoleMap[stage] || [];
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ message: 'You do not have permission to perform this stage transition' });
    }

    const before = { stage: workflow.stage };
    workflow.stage = stage;
    workflow.lastModifiedBy = req.user._id;
    await workflow.save();

    // Release lock only after stage transition saved successfully
    workflow.lockedBy = null;
    workflow.lockedByName = '';
    workflow.lockedAt = null;
    await workflow.save();

    const populated = await OperationsWorkflow.findById(workflow._id)
      .populate('createdBy', 'firstName lastName')
      .populate('lastModifiedBy', 'firstName lastName')
      .populate('lockedBy', 'firstName lastName');

    await logAudit({
      user: req.user._id,
      action: 'workflow_stage_change',
      entity: 'OperationsWorkflow',
      entityId: workflow._id,
      changes: { before, after: { stage } },
      ipAddress: req.ip,
    });

    bustFilterCache();
    try { emitPerRole('workflow:stageChanged', (r) => stripRowFor(r, populated)); } catch (e) { console.error('WebSocket emit error:', e); }

    res.json(populated);
  } catch (error) {
    console.error('Update stage error:', error);
    res.status(500).json({ message: 'Failed to update workflow stage' });
  }
};

// POST /api/workflows/:id/lock
exports.lockWorkflow = async (req, res) => {
  try {
    const workflow = await OperationsWorkflow.findById(req.params.id);
    if (!workflow) {
      return res.status(404).json({ message: 'Workflow not found' });
    }

    if (isLocked(workflow, req.user._id)) {
      return res.status(423).json({
        message: `This record is currently being edited by ${workflow.lockedByName || 'another user'}`,
      });
    }

    workflow.lockedBy = req.user._id;
    workflow.lockedByName = `${req.user.firstName} ${req.user.lastName}`;
    workflow.lockedAt = new Date();
    await workflow.save();

    try {
      emitToAll('workflow:locked', {
        _id: workflow._id,
        lockedBy: { _id: req.user._id, firstName: req.user.firstName, lastName: req.user.lastName },
        lockedByName: workflow.lockedByName,
        lockedAt: workflow.lockedAt,
      });
    } catch (e) { console.error('WebSocket emit error:', e); }

    res.json({ message: 'Row locked successfully' });
  } catch (error) {
    console.error('Lock workflow error:', error);
    res.status(500).json({ message: 'Failed to lock workflow' });
  }
};

// POST /api/workflows/:id/unlock
exports.unlockWorkflow = async (req, res) => {
  try {
    const workflow = await OperationsWorkflow.findById(req.params.id);
    if (!workflow) {
      return res.status(404).json({ message: 'Workflow not found' });
    }

    // Only the locker or super_admin can unlock
    if (
      workflow.lockedBy &&
      workflow.lockedBy.toString() !== req.user._id.toString() &&
      req.user.role !== 'super_admin' && !isFinanceFull(req.user.role)
    ) {
      return res.status(403).json({ message: 'Only the locking user or super admin can unlock' });
    }

    workflow.lockedBy = null;
    workflow.lockedByName = '';
    workflow.lockedAt = null;
    await workflow.save();

    try { emitToAll('workflow:unlocked', { _id: workflow._id }); } catch (e) { console.error('WebSocket emit error:', e); }

    res.json({ message: 'Row unlocked successfully' });
  } catch (error) {
    console.error('Unlock workflow error:', error);
    res.status(500).json({ message: 'Failed to unlock workflow' });
  }
};

// DELETE /api/workflows/:id
exports.deleteWorkflow = async (req, res) => {
  try {
    const workflow = await OperationsWorkflow.findById(req.params.id);
    if (!workflow) {
      return res.status(404).json({ message: 'Workflow not found' });
    }

    if (isLocked(workflow, req.user._id)) {
      return res.status(423).json({
        message: `This record is currently being edited by ${workflow.lockedByName || 'another user'}`,
      });
    }

    await OperationsWorkflow.findByIdAndDelete(req.params.id);

    await logAudit({
      user: req.user._id,
      action: 'delete_workflow',
      entity: 'OperationsWorkflow',
      entityId: req.params.id,
      changes: { before: workflow.toObject() },
      ipAddress: req.ip,
    });

    bustFilterCache();
    try { emitToAll('workflow:deleted', { _id: req.params.id }); } catch (e) { console.error('WebSocket emit error:', e); }

    res.json({ message: 'Workflow deleted successfully' });
  } catch (error) {
    console.error('Delete workflow error:', error);
    res.status(500).json({ message: 'Failed to delete workflow' });
  }
};

// PATCH /api/workflows/:id/application-status
/**
 * حالةُ الطلب تُغيَّر من جدول سير العمل — وتُكتب في المنصّة لا عندنا.
 *
 * ── العلّة ──────────────────────────────────────────────────────────────────
 * `applicationStatus` عمودٌ مرآةٌ: المنصّةُ تكتبه وتُعيد كتابته في كلّ مزامنة.
 * فلو كُتب عندنا وحدَه مُسح بعد دقائق بلا أثر — وهذا بالضبط ما كان يقع لمن
 * يعدّله من الجدول: يتغيّر أمام عينه ثمّ يعود.
 *
 * فالكتابةُ تذهب إلى مصدرها: `PATCH /admin/shipments/status` في المنصّة، ثمّ
 * تُقرأ الشحنةُ منها ويُكتب صفُّنا بما استقرّ هناك ويُبَثّ. فالشاشتان — جدولُ
 * سير العمل وصفحةُ الطلبات — تريان الشيءَ نفسَه في اللحظة نفسِها، والمنصّةُ
 * معهما. وكشفٌ ليس من المنصّة لا حالةَ طلبٍ له تُغيَّر من هنا.
 */
const UPL_STATUSES = [
  'requesting', 'loading', 'uploaded', 'on_way', 'arrived',
  'bond_sent', 'bond_received', 'late', 'invoiced', 'cancelled',
];

/**
 * دفعُ حالةِ الطلب إلى المنصّة ثمّ قراءةُ ما استقرّ هناك.
 *
 * ── ولماذا دالّةٌ مستقلّة ───────────────────────────────────────────────────
 * يناديها جدولُ سير العمل حين يغيّرها الموظّفُ بيده، وتنادِيها المحفظةُ حين
 * يُسجَّل شراءٌ على كشف — والشراءُ إقرارٌ بأنّ السندَ في اليد. ونسخُ المنطق
 * للثانية يعني طريقين لكتابة الحالة يفترقان: أحدُهما يدفعها إلى المنصّة
 * ويُعيد المزامنة، والآخرُ يكتبها عندنا فتُمحى في أوّل مزامنةٍ بلا أثر.
 *
 * وتُرجع ما استقرّ، أو `null` إن لم يكن الكشفُ من المنصّة أصلًا.
 */
async function pushApplicationStatus(workflow, status, actor) {
  if (!UPL_STATUSES.includes(status)) throw new Error(`حالةٌ غير معروفة: ${status}`);
  if (workflow.externalSource !== 'ops_upl' || !workflow.externalId) return null;
  if (String(workflow.applicationStatus || '') === status) return { applicationStatus: status, unchanged: true };

  const before = String(workflow.applicationStatus || '');
  const upl = require('../services/uplClient');
  await upl.patch('/admin/shipments/status', { body: { status, ids: [String(workflow.externalId)] } });

  const { syncShipmentsById } = require('../services/opsWorkflowSyncService');
  const out = await syncShipmentsById([String(workflow.externalId)]);
  const row = (out.rows || [])[0] || null;

  try { cache.clear('ops:'); } catch (e) { /* */ }
  bustFilterCache();
  try {
    emitToAll('ops:shipments:changed', {
      resource: 'shipments', action: 'status', ids: [String(workflow.externalId)], status, at: Date.now(),
    });
  } catch (e) { /* */ }
  if (actor) {
    await logAudit({
      user: actor._id || actor,
      action: 'update_workflow',
      entity: 'OperationsWorkflow',
      entityId: workflow._id,
      changes: { before: { applicationStatus: before }, after: { applicationStatus: row?.applicationStatus || status } },
    });
  }
  return row || { applicationStatus: status };
}
exports.pushApplicationStatus = pushApplicationStatus;

exports.updateApplicationStatus = async (req, res) => {
  try {
    const status = String(req.body?.status || '').trim();
    if (!UPL_STATUSES.includes(status)) {
      return res.status(400).json({ message: `حالةٌ غير معروفة: ${status || '(فارغة)'}` });
    }
    // ومَن يملك عمودَ الحالة في الجدول هو مَن يملك تغييرَها — الخريطةُ نفسُها.
    const allowed = await fieldsForRole(req.user.role);
    if (!allowed.includes('applicationStatus')) {
      return res.status(403).json({ message: 'صلاحيّتك لا تسمح بتغيير حالة الطلب.' });
    }

    const workflow = await OperationsWorkflow.findById(req.params.id)
      .select('externalSource externalId applicationStatus reportNumber lockedBy lockedByName lockedAt');
    if (!workflow) return res.status(404).json({ message: 'Workflow not found' });
    if (isLocked(workflow, req.user._id)) {
      return res.status(423).json({ message: `الكشف مفتوحٌ لدى ${workflow.lockedByName || 'مستخدمٍ آخر'}` });
    }
    if (workflow.externalSource !== 'ops_upl' || !workflow.externalId) {
      return res.status(400).json({
        message: 'هذا الكشف ليس من منصّة التشغيل — لا حالةَ طلبٍ له تُغيَّر.',
      });
    }
    if (String(workflow.applicationStatus || '') === status) {
      return res.json({ _id: workflow._id, applicationStatus: status, unchanged: true });
    }

    const before = String(workflow.applicationStatus || '');
    const upl = require('../services/uplClient');
    await upl.patch('/admin/shipments/status', {
      body: { status, ids: [String(workflow.externalId)] },
    });

    // ما استقرّ في المنصّة هو ما يُعرض — لا ما طلبناه.
    const { syncShipmentsById } = require('../services/opsWorkflowSyncService');
    const out = await syncShipmentsById([String(workflow.externalId)]);
    const row = (out.rows || [])[0] || null;

    try { cache.clear('ops:'); } catch (e) { /* */ }
    bustFilterCache();
    try {
      emitToAll('ops:shipments:changed', {
        resource: 'shipments', action: 'status', ids: [String(workflow.externalId)], status, at: Date.now(),
      });
    } catch (e) { /* */ }

    await logAudit({
      user: req.user._id,
      action: 'update_workflow',
      entity: 'OperationsWorkflow',
      entityId: workflow._id,
      changes: { before: { applicationStatus: before }, after: { applicationStatus: row?.applicationStatus || status } },
      ipAddress: req.ip,
    });

    // والردُّ يُحجَب كما تُحجَب القائمة: هو نسخةُ الصفّ التي تحلّ محلَّ القديمة.
    res.json(row ? stripRowFor(req.user.role, row) : { _id: workflow._id, applicationStatus: status });
  } catch (error) {
    const status = error.status && error.status >= 400 && error.status < 600 ? error.status : 500;
    if (status >= 500) console.error('updateApplicationStatus:', error.message);
    res.status(status).json({ message: error.message || 'تعذّر تغيير حالة الطلب في منصّة التشغيل' });
  }
};

// POST /api/workflows/bulk-delete
/**
 * تحديثٌ جماعيّ — حقلٌ واحدٌ على كشوفٍ كثيرة.
 *
 * فريقُ التحصيل يستلم دفعةَ سنداتٍ في اليوم الواحد بتاريخِ سدادٍ واحدٍ وفرعٍ
 * واحد، فكان يفتح مئةَ صفٍّ ويكتب التاريخَ نفسَه مئةَ مرّة. والكتابةُ المكرّرة
 * ليست بطئًا فحسب: كلُّ صفٍّ فرصةُ خطأٍ جديدة.
 *
 * وليس حلقةَ نداءاتٍ من الشاشة: مئةُ صفٍّ = مئةُ طلبٍ متوازٍ على عنقودٍ مقيَّد.
 * الطلبُ واحدٌ هنا، والقواعدُ هي هي — صلاحيّةُ الحقل، وشرطُ «لا سدادَ قبل
 * السند» — ويعود لكلّ صفٍّ سببُه إن رُفض، فلا يُقال «تمّ» ونصفُها لم يتمّ.
 */
/**
 * ── «كلُّ نتائج الفلتر» — الشروطُ نفسُها، والعددُ الذي رآه المستخدم ──────────
 *
 * الجدولُ يعرض خمسين في الصفحة، والفلترُ قد يُخرج سبعةً وثلاثين ألفًا. فتُرسَل
 * شروطُ الجدول نفسُها (`query`) ويُستخرج منها كلُّ ما يطابق — بالدالّة التي
 * يقرأ بها الجدولُ صفوفَه، فلا يُكتب على ما لا يراه صاحبُ الفلتر.
 *
 * وكان السقفُ ألفًا، فتغييرُ نوع الدفع لعميلٍ واحدٍ كبير يستحيل إلّا بتقطيع
 * الفلتر يدويًّا. فصار السقفُ سقفَ أمانٍ لا سقفَ عمل (`ALL_MATCHING_CAP`)،
 * والشرطُ الحقيقيُّ هو **العددُ الذي أكّده المستخدم** (`expectedCount`): إن
 * طابق الفلترُ الآن أكثرَ ممّا رآه في نافذة التأكيد (مزامنةٌ أضافت كشوفًا
 * بينهما) رُفض الطلبُ بالعدد الجديد ليُؤكَّد ثانيةً — لا يُكتب على كشفٍ لم يُعرَض.
 */
const ALL_MATCHING_CAP = 60000;
const IDS_CAP = 1000;

async function idsForAllMatching(body, role) {
  const q = Object.fromEntries(Object.entries(body.query || {}).filter(([k]) => !['page', 'limit', 'sort', 'order', 'scope'].includes(k)));
  if (q.cf_dataOwnerShown !== undefined) await require('../utils/dataOwnerIndex').ensure().catch(() => {});
  const filter = buildWorkflowFilter(q, undefined, canSeeMoney(role), canSeeSelling(role));
  const found = await OperationsWorkflow.find(filter).select('_id').limit(ALL_MATCHING_CAP + 1).lean();
  if (found.length > ALL_MATCHING_CAP) {
    return { error: { status: 400, body: { message: `نتائجُ الفلتر أكثرُ من ${ALL_MATCHING_CAP.toLocaleString('en-US')} كشف — ضيِّق الفلتر ثمّ أعِد.` } } };
  }
  const expected = Number(body.expectedCount);
  if (Number.isFinite(expected) && expected >= 0 && found.length > expected) {
    return {
      error: {
        status: 409,
        body: {
          code: 'COUNT_CHANGED', count: found.length, expectedCount: expected,
          message: `تغيّرت نتائجُ الفلتر: صارت ${found.length} بدل ${expected} — لم يُحفظ شيء. أكِّد العددَ الجديد ثمّ أعِد.`,
        },
      },
    };
  }
  return { ids: found.map((x) => x._id) };
}
exports._idsForAllMatching = idsForAllMatching;

exports.bulkUpdate = async (req, res) => {
  try {
    let ids = Array.isArray(req.body.ids) ? req.body.ids.filter((x) => mongoose.isValidObjectId(x)) : [];
    const allMatching = !!(req.body.allMatching && req.body.query && typeof req.body.query === 'object');
    if (allMatching) {
      const r = await idsForAllMatching(req.body, req.user.role);
      if (r.error) return res.status(r.error.status).json(r.error.body);
      ids = r.ids;
    }
    if (!ids.length) return res.status(400).json({ message: 'لم تُحدَّد أيُّ كشوف.' });
    if (!allMatching && ids.length > IDS_CAP) return res.status(400).json({ message: `الحدُّ الأقصى ${IDS_CAP} كشفًا في المرّة — أو اختر «كلّ نتائج الفلتر».` });

    const patch = filterFieldsByRole(req.body.fields || {}, req.user.role, await fieldsForRole(req.user.role));
    // والقواعدُ نفسُها في الجملة: لا يكسب أحدٌ بالتحديد ما لا يملكه بالمفرد.
    // (وتُعاد لكلّ صفٍّ على حدة أدناه، لأنّ نوعَ الدفع يختلف من كشفٍ لآخر.)
    const refused = patch.__rejected || [];
    // ── وقيمةُ البيع لا تُكتب جماعةً ──────────────────────────────────────────
    // كلُّ كشفٍ منها يُكتب في منصّة التشغيل نداءً بنداء (راجع pushSellingValue)،
    // وسعرٌ واحدٌ لمئة كشفٍ لعملاءَ ومساراتٍ شتّى ليس تسعيرًا. تُعدَّل كشفًا كشفًا.
    if (Object.prototype.hasOwnProperty.call(patch, 'sellingValue')) {
      delete patch.sellingValue;
      refused.push('sellingValue');
    }
    const keys = Object.keys(patch);
    if (!keys.length) {
      return res.status(403).json({
        code: 'FIELDS_NOT_ALLOWED', fields: refused,
        message: `صلاحيّتك لا تسمح بتعديل: ${refused.join('، ')} — لم يُحفظ شيء.`,
      });
    }

    const wantsPayment = keys.includes('paymentDate') && patch.paymentDate && String(patch.paymentDate).trim();
    const rows = await OperationsWorkflow.find({ _id: { $in: ids } })
      // `paymentTypeSource` وما يُشتقّ منه النوع: بدونها يُقرأ كلُّ صفٍّ «غيرَ يدويّ
      // وغيرَ موحَّد» فيُعاد اشتقاقُ ما اختارته يدٌ أو وُحِّد — راجع fillPaymentTypeFromCustomer.
      .select('reportNumber applicationStatus paymentType paymentSubtype paymentTypeSource paymentMethod reportDate tax netInvoice username lockedBy lockedByName lockedAt invoiceNumber').lean();

    // ── والقواعدُ تُطبَّق صفًّا صفًّا ──────────────────────────────────────
    // نوعُ الدفع يختلف من كشفٍ لآخر، فالتعديلُ الواحد لا ينتج تعديلًا واحدًا:
    // كشفٌ نقديٌّ في الدفعة يُسقِط عنه أعمدةَ الفاتورة، وكشفٌ ضريبيٌّ يشتقّ
    // ضريبتَه من صافيه. وتطبيقُ قاعدةٍ واحدةٍ على الجميع كان سيكتب فاتورةً
    // على عميلِ كاش.
    const skipped = []; const perRow = [];
    // مبلغُ السداد لكشفٍ دفعته المحفظةُ يبقى مبلغَها — راجع utils/walletPayment.
    const walletPaid = Object.prototype.hasOwnProperty.call(patch, 'paymentAmount')
      ? await require('../utils/walletPayment').walletPaidMap(rows.map((r) => r.reportNumber))
      : new Map();
    // صفاتُ العملاء مرّةً للدفعة كلِّها — راجع partyTypes في fillPaymentTypeFromCustomer.
    let partyTypes = null;
    if (!keys.includes('paymentType') && !keys.includes('paymentSubtype') && rows.length > 50) {
      const CollectionsParty = require('../models/CollectionsParty');
      const names = [...new Set(rows.map((r) => CollectionsParty.fold(patch.username !== undefined ? patch.username : r.username || '')).filter(Boolean))];
      partyTypes = new Map();
      // الأوّلُ لكلّ مفتاح — كما يأخذ `findOne` في المسار المفرد.
      for (const p of await CollectionsParty.find({ kind: 'customer', nameKey: { $in: names } }).select('nameKey paymentType').lean()) {
        if (!partyTypes.has(p.nameKey)) partyTypes.set(p.nameKey, p.paymentType);
      }
    }
    for (const r of rows) {
      // الصفُّ الذي يحرّره غيرُك لا يُكتب فوقه في دفعةٍ لا يراها.
      if (isLocked(r, req.user._id)) {
        skipped.push({ reportNumber: r.reportNumber, reason: `قيد التعديل لدى ${r.lockedByName || 'مستخدم آخر'}` });
        continue;
      }
      if (wantsPayment && String(r.applicationStatus || '').trim() !== 'bond_received') {
        skipped.push({ reportNumber: r.reportNumber, reason: 'لم يُستلم السند بعد' });
        continue;
      }
      const rowPatch = { ...patch };
      // ومَن كتب تاريخ السداد يُكتب معه في الدفعة كما في التعديل المفرد.
      if (Object.prototype.hasOwnProperty.call(patch, 'paymentDate') && patch.paymentDate) {
        rowPatch.paymentDateBy = req.user._id;
        rowPatch.paymentDateByName = `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim();
        rowPatch.paymentDateAt = new Date();
      }
      if (walletPaid.has(String(r.reportNumber || '').trim())) rowPatch.paymentAmount = walletPaid.get(String(r.reportNumber || '').trim());
      // ونوعُ الدفع يُملأ لكلّ صفٍّ من ملفّ عميله — والدفعةُ الواحدة تضمّ
      // عملاءَ شتّى، فقاعدةٌ واحدةٌ للجميع تكتب فاتورةً على عميل كاش.
      await fillPaymentTypeFromCustomer(rowPatch, r, partyTypes);
      stampInvoiceDate(rowPatch, r);
      const own = applyBillingRules(rowPatch, r);
      if (own.blocked.includes('invoiceNumber')) {
        skipped.push({ reportNumber: r.reportNumber, reason: 'كشف نقديّ — ليس له رقم فاتورة' });
        continue;
      }
      if (own.blocked.length && !Object.keys(own.patch).length) {
        skipped.push({ reportNumber: r.reportNumber, reason: 'كشف نقديّ — لا فاتورة له' });
        continue;
      }
      // تاريخُ التحصيل أو مبلغُه كُتب بيدٍ في الدفعة — الكشفُ لم يعد للمحفظة.
      if (['collectionDate', 'collectedAmount'].some((k) => Object.prototype.hasOwnProperty.call(own.patch, k))) {
        own.patch.collectedByWallet = false;
      }
      perRow.push({
        _id: r._id, patch: own.patch, reportNumber: r.reportNumber,
        typeBefore: r.paymentType || '', subBefore: r.paymentSubtype || '',
      });
    }

    let updated = 0;
    if (perRow.length) {
      // تُجمَّع الصفوفُ التي تأخذ التعديلَ نفسَه في كتابةٍ واحدة، فلا تصير
      // مئةُ صفٍّ مئةَ رحلةٍ إلى القاعدة.
      const byPatch = new Map();
      for (const t of perRow) {
        const k = JSON.stringify(t.patch);
        if (!byPatch.has(k)) byPatch.set(k, { patch: t.patch, ids: [] });
        byPatch.get(k).ids.push(t._id);
      }
      // والمعرّفاتُ تُقطَّع خمسةَ آلافٍ في الشرط الواحد — سبعةٌ وثلاثون ألفًا في
      // `$in` واحدٍ طلبٌ ثقيلٌ على العنقود بلا داعٍ.
      const CHUNK = 5000;
      const ops = [];
      for (const g of byPatch.values()) {
        for (let i = 0; i < g.ids.length; i += CHUNK) {
          ops.push({
            updateMany: {
              filter: { _id: { $in: g.ids.slice(i, i + CHUNK) } },
              update: { $set: { ...g.patch, lastModifiedBy: req.user._id } },
            },
          });
        }
      }
      const results = await OperationsWorkflow.bulkWrite(ops, { ordered: false });
      updated = results.modifiedCount || 0;
      cache.clear('wf:');
      // «رقم السند» كُتب جماعيًّا — يُعاد ربطُ كشوفه بالتخليص (بوليصةٌ أو حاوية).
      if (keys.includes('documentNumber')) {
        await require('../services/customsOpsLink').resolveReports({ _id: { $in: perRow.map((t) => t._id) } })
          .catch((e) => console.error('customs link (workflow bulk):', e.message));
      }
      // رقمُ فاتورةٍ كُتب جماعيًّا يصنع قيدَه في الدفتر كما يصنعه التعديلُ
      // المفرد — وإلّا غابت هذه الفواتيرُ عن التحصيل كلِّه. راجع ensureLedgerInvoice.
      {
        const hit = perRow.filter((t) => LEDGER_FIELDS.some((k) => Object.prototype.hasOwnProperty.call(t.patch, k)));
        if (hit.length) {
          // الرقمُ القديمُ والجديدُ معًا: قيدُ القديم يُعاد حسابُه أو يُزال.
          const oldNo = new Map(rows.map((r) => [String(r._id), r.invoiceNumber]));
          const fresh = await OperationsWorkflow.find({ _id: { $in: hit.map((t) => t._id) } }).select('invoiceNumber').lean();
          await syncOpsInvoices([...fresh.map((w) => w.invoiceNumber), ...hit.map((t) => oldNo.get(String(t._id)))]);
        }
      }
      // ودفترُ التحصيل يتبع ما كُتب جماعيًّا من تاريخ تحصيلٍ أو تسليم — كما في المفرد.
      {
        const has = (k) => perRow.some((t) => Object.prototype.hasOwnProperty.call(t.patch, k));
        const changed = { collectionDate: has('collectionDate'), deliveryDate: has('deliveryDate') };
        if (changed.collectionDate || changed.deliveryDate) {
          const touched = perRow.filter((t) => ['collectionDate', 'deliveryDate'].some((k) => Object.prototype.hasOwnProperty.call(t.patch, k))).map((t) => t._id);
          const fresh = await OperationsWorkflow.find({ _id: { $in: touched } }).select('invoiceNumber collectionDate deliveryDate').lean();
          await require('./collectionsDeptController').syncLedgerFromWorkflows(fresh, changed)
            .catch((e) => console.error('ledger sync (workflow bulk):', e.message));
        }
      }
      // ونوعُ الدفع تغيّر جماعةً: تحصيلُ المحفظة يُعاد النظرُ فيه لتلك الكشوف.
      {
        const retyped = perRow.filter((t) => Object.prototype.hasOwnProperty.call(t.patch, 'paymentType')
          && String(t.patch.paymentType || '') !== t.typeBefore).map((t) => t.reportNumber);
        // ومطابقةُ المحفظة كشفًا كشفًا رحلتان لكلّ كشف؛ فإن كثرت الكشوفُ طوبقت
        // القيودُ كلُّها مرّةً (وهي أقلُّ بكثير) في الخلف — النتيجةُ نفسُها.
        if (retyped.length > 300) {
          require('../utils/walletCollection').resyncAllWalletCollections({ user: req.user, reason: 'تغيّر نوع الكشف' })
            .catch((e) => console.error('wallet cash-collection (workflow bulk, all):', e.message));
        } else if (retyped.length) {
          await require('../utils/walletCollection').syncWalletCollection(retyped, { user: req.user, reason: 'تغيّر نوع الكشف' })
            .catch((e) => console.error('wallet cash-collection (workflow bulk):', e.message));
        }
      }
      // ونوعُ الدفع (عائلةً أو نوعًا) تغيّر: لوحةُ التحصيل تُمسح ذاكرتُها قبل البثّ.
      const kindMoved = perRow.some((t) => (Object.prototype.hasOwnProperty.call(t.patch, 'paymentType')
          && String(t.patch.paymentType || '') !== t.typeBefore)
        || (Object.prototype.hasOwnProperty.call(t.patch, 'paymentSubtype')
          && String(t.patch.paymentSubtype || '') !== t.subBefore));
      if (kindMoved) invalidateCollectionsReaders();
      try { emitToAll('workflow:bulkImported', { bulkUpdate: true, updated }); } catch (e) {}
      if (kindMoved) {
        try { emitToAll('collections:changed', { source: 'workflow', field: 'paymentType', bulk: true }); } catch (e) { /* */ }
      }
      logAudit({
        user: req.user, action: 'bulk_update', entity: 'OperationsWorkflow',
        details: `${updated} كشفًا · ${keys.join('، ')}`, ip: req.ip,
      });
    }

    // قائمةُ المتروك تُقصّ في الردّ (العددُ كاملٌ في `skippedCount`): عشرةُ آلاف
    // سببٍ لا تُقرأ في نافذة، وتُثقل الردَّ بلا فائدة.
    res.json({
      updated,
      requested: ids.length,
      skipped: skipped.slice(0, 300),
      skippedCount: skipped.length,
      refusedFields: refused.length ? refused : undefined,
      message: skipped.length
        ? `حُفظ ${updated} من ${ids.length} — و${skipped.length} لم يُحفظ.`
        : `حُفظ ${updated} كشفًا.`,
    });
  } catch (e) {
    console.error('bulkUpdate error:', e);
    res.status(500).json({ message: e.message || 'تعذّر التحديث الجماعي' });
  }
};

exports.bulkDelete = async (req, res) => {
  try {
    let { ids } = req.body;
    // «كلُّ نتائج الفلتر» هنا كما في التحديث الجماعيّ — بالشروط نفسِها والعددِ
    // الذي أكّده المستخدم (راجع idsForAllMatching).
    const allMatching = !!(req.body.allMatching && req.body.query && typeof req.body.query === 'object');
    if (allMatching) {
      const r = await idsForAllMatching(req.body, req.user.role);
      if (r.error) return res.status(r.error.status).json(r.error.body);
      ids = r.ids;
    }
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ message: 'ids must be a non-empty array' });
    }
    if (!allMatching && ids.length > IDS_CAP) {
      return res.status(400).json({ message: `الحدُّ الأقصى ${IDS_CAP} كشفًا في المرّة — أو اختر «كلّ نتائج الفلتر».` });
    }

    // Check for locked workflows
    const workflows = await OperationsWorkflow.find({ _id: { $in: ids } }).select('lockedBy lockedAt lockedByName').lean();
    const lockedIds = workflows.filter((w) => isLocked(w, req.user._id)).map((w) => w._id.toString());
    if (lockedIds.length > 0) {
      return res.status(423).json({ message: `${lockedIds.length} workflow(s) are locked and cannot be deleted` });
    }

    for (let i = 0; i < ids.length; i += 5000) {
      await OperationsWorkflow.deleteMany({ _id: { $in: ids.slice(i, i + 5000) } });
    }

    await logAudit({
      user: req.user._id,
      action: 'bulk_delete_workflows',
      entity: 'OperationsWorkflow',
      entityId: null,
      // المعرّفاتُ كلُّها حتى ألفٍ — وما فوقه عددُه وشرطُه، لا سجلٌّ بميغابايت.
      changes: { before: { count: ids.length, ids: ids.slice(0, 1000), ...(allMatching ? { query: req.body.query } : {}) } },
      ipAddress: req.ip,
    });

    bustFilterCache();
    // خبرٌ لكلّ صفٍّ معقولٌ لصفحة؛ ولآلافٍ خبرٌ واحدٌ تُعاد عليه القائمة.
    if (ids.length > 200) {
      try { emitToAll('workflow:bulkImported', { bulkDelete: true, deleted: ids.length }); } catch (e) { /* */ }
    } else {
      ids.forEach((id) => {
        try { emitToAll('workflow:deleted', { _id: id }); } catch (e) { console.error('WebSocket emit error:', e); }
      });
    }

    res.json({ message: `${ids.length} workflow(s) deleted successfully`, deleted: ids.length });
  } catch (error) {
    console.error('Bulk delete workflows error:', error);
    res.status(500).json({ message: 'Failed to bulk delete workflows' });
  }
};

// GET /api/workflows/export
/**
 * تصديرُ سير عمل التشغيل — يُبنى الملفُّ في الخادم ويُنزَّل جاهزًا.
 *
 * ── أين يذهب الوقتُ حقًّا ───────────────────────────────────────────────────
 * كانت الشاشةُ تطلب الجدولَ كلَّه (`limit=100000`) ثمّ تبني المصنَّفَ بنفسها،
 * فتتجمّد دقائق. ونقلُ البناءِ إلى هنا أزال التجمُّدَ ووفّر نحوَ الرُّبع — ولم
 * يحلَّ المشكلة، لأنّ الخانقَ ليس البناءَ ولا القاعدة:
 *
 *   الفرزُ داخلَ القاعدة على فهرس `createdAt`: ٤٢ ميلي‌ثانيةً لخمسةٍ وثلاثين ألفًا.
 *   وزمنُ ping من الخادم إلى العنقود: ٩ ميلي‌ثانية.
 *   ومعدّلُ النقل الفعليّ: **٠٫١ ميغابايت في الثانية**، ثابتًا مهما كبرت الدفعة.
 *
 * ذاك سقفُ عنقودٍ مشترَك (Atlas shared tier — و`hostInfo` ممنوعٌ عليه، وهي
 * علامتُه). فقراءةُ ما يلزم هذا الملفَّ تستغرق دقائقَ أيًّا كان الكودُ الذي
 * يقرؤها. ولا يُصلحه إلّا ترقيةُ العنقود.
 *
 * ── فما دام السقفُ قائمًا: يُبنى مرّةً ويُخدَم مرارًا ────────────────────────
 * «الجدولُ كلُّه بلا فلتر» طلبٌ واحدٌ لا يختلف من سائلٍ إلى آخر، ومحتواه يتغيّر
 * ببطء. فيُبنى الملفُّ ويُحفَظ على القرص، ويُخدَم من هناك في لحظة. ومَن طلبه وهو
 * قديمٌ أخذ القديمَ فورًا وبُني الجديدُ خلفَه لمن يأتي بعده — انتظارُ خمسِ دقائقَ
 * أسوأُ من ملفٍّ عمرُه ساعة، وعمرُه مكتوبٌ في ترويسة الردّ على أيّ حال.
 *
 * والمفلتَرُ لا يُخزَّن: شرطُه يختلف بين طلبٍ وآخر، وهو أصغرُ بكثير.
 *
 * ── والملفُّ هو ما على الشاشة ───────────────────────────────────────────────
 * الأعمدةُ وترجماتُها هي التي تعرضها صفحةُ سير العمل حرفًا بحرف، لا مجموعةٌ
 * ثانيةٌ تفترق عنها. و`scope=all` وحدَها تتجاوز الفلترَ — وهي خيارٌ يسمّي نفسَه
 * في القائمة، فلا يخرج الملفُّ أوسعَ ممّا طُلب.
 */
async function buildWorkflowWorkbook(filter, money, selling = true) {
  {
    const { SHIPMENT_STATUS_AR } = require('../config/constants');

    const PAYMENT_AR = { cash: 'كاش', late: 'آجل' };
    const STAGE_AR = {
      draft: 'مسودة', submitted_to_ops: 'مرسل للتشغيل', ops_completed: 'تم التشغيل',
      submitted_to_collections: 'مرسل للتحصيل', completed: 'مكتمل',
    };
    const d = (v) => (v ? new Date(v).toLocaleDateString('en-GB') : '');
    const st = (v) => SHIPMENT_STATUS_AR[v] || v || '';
    const yes = (v) => (v ? 'تمّت' : '');

    // العمودُ وقارئُه في سطرٍ واحد، والعلامةُ الثالثةُ تعني «مالٌ لا يراه الجميع».
    const COLUMNS = [
      ['رقم الطلب', (w) => w.reportNumber || ''],
      ['تاريخ الطلب', (w) => d(w.reportDate)],
      ['من', (w) => w.fromLocation || ''],
      ['إلى', (w) => w.toLocation || ''],
      ['الفرع', (w) => w.branch || ''],
      ['مالك السيارة', (w) => w.carOwner || ''],
      ['رقم السيارة', (w) => w.carNumber || ''],
      ['نوع الملكية', (w) => w.ownerType || ''],
      ['حالة التنفيذ', (w) => st(w.executionStatus)],
      ['حالة الطلب', (w) => st(w.applicationStatus)],
      ['طريقة الدفع', (w) => PAYMENT_AR[w.paymentMethod] || w.paymentMethod || ''],
      ['العميل', (w) => w.username || ''],
      ['هاتف العميل', (w) => w.userPhone || ''],
      ['قيمة الشراء', (w) => w.purchaseValue || 0, 'money'],
      ['قيمة البيع', (w) => w.sellingValue || 0, 'selling'],
      ['السائق', (w) => w.driverName || ''],
      ['نوع الشاحنة', (w) => w.truckType || ''],
      ['حجم الشاحنة', (w) => w.truckSize || ''],
      ['المندوب', (w) => w.representativeName || ''],
      ['مراجعة العمليات', (w) => yes(w.operationsReview)],
      ['تاريخ السداد', (w) => d(w.paymentDate)],
      ['فرع السداد', (w) => w.payingBranch || ''],
      // الستُّ كما تُعرَض في الخانة — راجع paymentKindLabel.
      ['نوع الدفع', (w) => paymentKindLabel(w)],
      ['وجهة الكشف النهائية', (w) => w.finalReportDestination || ''],
      ['رقم المستند', (w) => w.documentNumber || ''],
      // معاملةُ التخليص المرتبطة وبوليصتُها — راجع services/customsOpsLink.
      ['معاملة التخليص', (w) => (w.customsLink && w.customsLink.clearance ? w.customsLink.refNumber || '' : '')],
      ['البوليصة', (w) => (w.customsLink && w.customsLink.clearance ? w.customsLink.blNumber || '' : '')],
      ['تاريخ الإرسال', (w) => d(w.sendingDate)],
      ['تاريخ التسليم للفرع', (w) => d(w.branchDeliveryDate)],
      ['تاريخ التسليم للعميل', (w) => d(w.deliveryDate)],
      ['مراجعة المحاسبة', (w) => yes(w.accountingReview), 'money'],
      ['رقم الفاتورة', (w) => w.invoiceNumber || '', 'money'],
      ['صافي الفاتورة', (w) => w.netInvoice || 0, 'money'],
      ['الضريبة', (w) => w.tax || 0, 'money'],
      ['إجمالي الفاتورة', (w) => w.totalInvoice || 0, 'money'],
      ['تاريخ الفاتورة', (w) => d(w.invoiceDate), 'money'],
      ['تاريخ التحصيل', (w) => d(w.collectionDate), 'money'],
      ['المرحلة', (w) => STAGE_AR[w.stage] || w.stage || ''],
    ];

    // الملفُّ يُفتح خارج النظام حيث لا حارس، فما لا يُعرض على الشاشة لا يخرج
    // فيه — وإلّا كان الحجبُ زينةً يلتفّ عليها زرُّ تصدير.
    // وقيمةُ البيع لمن في قائمتها وحدَه — راجع SELLING_ROLES.
    const cols = COLUMNS.filter(([, , tag]) => (tag !== 'money' || money) && (tag !== 'selling' || selling));
    const headers = cols.map(([h]) => h);

    // ولا تُقرأ حقولٌ لا عمودَ لها: كان الاستعلامُ يجلب المستندَ كاملًا بما فيه
    // ملاحظاتٌ حرّةٌ طويلةٌ لا تدخل الملفّ أصلًا.
    const FIELDS = [
      'reportNumber', 'reportDate', 'fromLocation', 'toLocation', 'branch', 'carOwner',
      'carNumber', 'ownerType', 'executionStatus', 'applicationStatus', 'paymentMethod',
      'username', 'userPhone', 'purchaseValue', 'sellingValue', 'driverName', 'truckType',
      'truckSize', 'representativeName', 'operationsReview', 'paymentDate', 'payingBranch',
      'paymentType', 'paymentSubtype', 'finalReportDestination', 'documentNumber', 'sendingDate', 'branchDeliveryDate',
      'deliveryDate', 'accountingReview', 'invoiceNumber', 'netInvoice', 'tax',
      'totalInvoice', 'invoiceDate', 'collectionDate', 'stage', 'customsLink',
    ].join(' ');

    // ── والصفوفُ تُقرأ تدفّقًا لا دفعةً واحدة ──────────────────────────────
    // خمسةٌ وثلاثون ألفَ مستندٍ في مصفوفةٍ واحدةٍ ذروةُ ذاكرةٍ بلا داعٍ على
    // عاملٍ يخدم غيرَه في الوقت نفسِه. تُقرأ صفًّا صفًّا وتُحوَّل فورًا إلى
    // سطرِ الملفّ، فلا يبقى في الذاكرة إلّا ما سيُكتب.
    const aoa = [headers];
    // ودفعةٌ كبيرةٌ لا مئةُ صفٍّ في كلّ رحلة: الافتراضيُّ مئةٌ وواحد، أي نحوَ
    // ثلاثِمئةٍ وخمسين رحلةً إلى القاعدة لجدولٍ بهذا الحجم — وثمنُ الرحلة ذهابًا
    // وإيابًا هو الغالبُ هنا لا قراءةُ القرص.
    const cursor = OperationsWorkflow.find(filter).select(FIELDS)
      .sort({ createdAt: -1 }).lean().cursor({ batchSize: 5000 });
    for (let w = await cursor.next(); w != null; w = await cursor.next()) {
      aoa.push(cols.map(([, get]) => get(w)));
    }

    // `compression` يصغّر الملفَّ إلى نحو خُمسه — وهو فرقُ ثوانٍ على الشبكة.
    // والكتابةُ في خيطٍ عامل: وإلّا توقّف هذا العاملُ عن خدمة الجميع طوالَها
    // (قيس: طلبُ health أثناء تصديرةٍ أخذ أربعَ عشرةَ ثانية). راجع xlsxBuilder.
    const buf = await require('../utils/xlsxBuilder').buildXlsx(aoa, {
      sheetName: 'العمليات',
      cols: headers.map((h) => ({ wch: Math.max(h.length + 4, 14) })),
    });
    return { buf, rows: aoa.length - 1 };
  }
}

// ── مخزنُ «الجدول كلّه» على القرص ───────────────────────────────────────────
// على القرص لا في ذاكرة العامل: البرودكشن عاملان، وذاكرةٌ لكلٍّ منهما تعني
// بناءَين ونسختين. والقرصُ مشترَكٌ بينهما.
const EXPORT_DIR = path.join(__dirname, '..', '..', 'uploads', 'exports');
const ALL_TTL_MS = 60 * 60 * 1000;
// وأربعُ نسخٍ لا اثنتان: بالمال وبدونه، وبقيمة البيع وبدونها.
const allFile = (money, selling = true) => path.join(EXPORT_DIR, `operations-all${money ? '' : '-nomoney'}${selling ? '' : '-nosell'}.xlsx`);
let buildingAll = false;

async function refreshAllExport(money, selling = true) {
  if (buildingAll) return;
  buildingAll = true;
  try {
    const { buf, rows } = await buildWorkflowWorkbook({}, money, selling);
    fs.mkdirSync(EXPORT_DIR, { recursive: true });
    // يُكتب إلى اسمٍ مؤقّتٍ ثمّ يُنقَل: من يقرأ أثناء الكتابة يقرأ ملفًّا كاملًا
    // قديمًا لا ملفًّا نصفَه جديدٌ ونصفُه قديم.
    const tmp = `${allFile(money, selling)}.tmp`;
    fs.writeFileSync(tmp, buf);
    fs.renameSync(tmp, allFile(money, selling));
    console.log(`[workflowExport] بُني ملفُّ الجدول كلِّه: ${rows} صفًّا · ${(buf.length / 1048576).toFixed(1)}MB`);
  } catch (e) {
    console.error('[workflowExport] تعذّر البناء:', e.message);
  } finally {
    buildingAll = false;
  }
}

exports.exportWorkflows = async (req, res) => {
  try {
    const money = canSeeMoney(req.user.role);
    const selling = canSeeSelling(req.user.role);
    const wantsAll = String(req.query.scope || '') === 'all';
    const name = `operations-${new Date().toISOString().split('T')[0]}.xlsx`;
    const head = (len, ageMs) => {
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename=${name}`);
      res.setHeader('Content-Length', String(len));
      // عمرُ الملفّ مُعلَنٌ لا مخفيّ: من أخذ نسخةً عمرُها ساعةٌ يستطيع أن يعرف.
      if (ageMs != null) res.setHeader('X-Export-Age-Seconds', String(Math.round(ageMs / 1000)));
    };

    if (wantsAll) {
      const f = allFile(money, selling);
      let stat = null;
      try { stat = fs.statSync(f); } catch (e) { /* لم يُبنَ بعد */ }
      if (stat) {
        const age = Date.now() - stat.mtimeMs;
        // القديمُ يُسلَّم الآن ويُجدَّد خلفَه: الانتظارُ أسوأُ من ساعةٍ من العمر.
        if (age > ALL_TTL_MS) refreshAllExport(money, selling).catch(() => {});
        head(stat.size, age);
        return fs.createReadStream(f).pipe(res);
      }
      // أوّلُ مرّة: يُبنى الآن ويُحفَظ، فلا ينتظره أحدٌ بعدها.
      const { buf } = await buildWorkflowWorkbook({}, money, selling);
      try {
        fs.mkdirSync(EXPORT_DIR, { recursive: true });
        fs.writeFileSync(allFile(money, selling), buf);
      } catch (e) { /* تعذّر الحفظ لا يمنع التسليم */ }
      head(buf.length, 0);
      return res.send(buf);
    }

    // المفلتَرُ يُبنى لحظتَه — شرطُه يخصّ سائلَه.
    const filter = buildWorkflowFilter(req.query, undefined, money, selling);
    const { buf } = await buildWorkflowWorkbook(filter, money, selling);
    head(buf.length, 0);
    return res.send(buf);
  } catch (error) {
    console.error('Export workflows error:', error);
    return res.status(500).json({ message: 'Failed to export workflows' });
  }
};

/**
 * البناءُ نفسُه لطلبِ تصديرٍ في الخلفيّة (controllers/exportJobsController).
 * الأعمدةُ والحجبُ بالدور واحدةٌ هنا وهناك — ملفٌّ واحدٌ مهما كان طريقُه.
 */
exports.buildExportFile = async (query = {}, user = {}) => {
  const money = canSeeMoney(user.role);
  const selling = canSeeSelling(user.role);
  const all = String(query.scope || '') === 'all';
  const filter = all ? {} : buildWorkflowFilter(query, undefined, money, selling);
  const { buf, rows } = await buildWorkflowWorkbook(filter, money, selling);
  return { buf, rows, name: `operations-${new Date().toISOString().slice(0, 10)}.xlsx` };
};

exports.refreshAllExport = refreshAllExport;

// POST /api/workflows/bulk-import
exports.bulkImport = async (req, res) => {
  try {
    const { rows } = req.body;

    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ message: 'rows must be a non-empty array' });
    }

    // Moderator can import application + manual_moderator fields
    const allowedImportFields = [...FIELD_GROUPS.application, ...FIELD_GROUPS.manual_moderator];

    const workflowsToCreate = rows.map((row) => {
      const workflow = {};
      allowedImportFields.forEach((field) => {
        if (row[field] !== undefined && row[field] !== null && row[field] !== '') {
          workflow[field] = row[field];
        }
      });
      workflow.stage = 'draft';
      workflow.createdBy = req.user._id;
      workflow.lastModifiedBy = req.user._id;
      return workflow;
    });

    // Use save() instead of insertMany to trigger pre-save hooks (auto reportNumber)
    // and handle duplicates gracefully.
    // ONE $in resolves every duplicate up front — the per-row findOne was a
    // round trip per row (~200 imports ≈ 20s of pure latency at 90ms RTT).
    const wanted = workflowsToCreate.map((w) => w.reportNumber).filter(Boolean);
    const dupes = new Set(
      (await OperationsWorkflow.find({ reportNumber: { $in: wanted } }).select('reportNumber').lean())
        .map((w) => w.reportNumber)
    );
    const createdWorkflows = [];
    const skipped = [];
    for (const wfData of workflowsToCreate) {
      try {
        if (wfData.reportNumber && dupes.has(wfData.reportNumber)) {
          skipped.push(wfData.reportNumber);
          continue;
        }
        const wf = new OperationsWorkflow(wfData);
        await wf.save();
        createdWorkflows.push(wf);
      } catch (err) {
        if (err.code === 11000) {
          skipped.push(wfData.reportNumber || 'unknown');
          continue;
        }
        throw err;
      }
    }

    // ── ولا يُنسَخ إلى عملاءَ وفواتير ────────────────────────────────────
    // كان الاستيرادُ يُنشئ خلفَ كلّ صفٍّ سجلَّ عميلٍ وفاتورةً في ورك فلو
    // «العملاء والمالية» ويزيد المستحقَّ عليه. زال القسمُ، وصار الكشفُ هو
    // المستندَ الوحيد: قسمُ التحصيل يقرأ منه مباشرةً.

    // وما ذكره التخليصُ منها في خانات النقل، أو سندُه بوليصةُ معاملة، يُربط بها.
    if (createdWorkflows.length) {
      await require('../services/customsOpsLink').resolveReports({ _id: { $in: createdWorkflows.map((w) => w._id) } })
        .catch((e) => console.error('customs link (bulk import):', e.message));
    }

    const populated = await OperationsWorkflow.find({
      _id: { $in: createdWorkflows.map((w) => w._id) },
    })
      .populate('createdBy', 'firstName lastName')
      .populate('lastModifiedBy', 'firstName lastName');

    await logAudit({
      user: req.user._id,
      action: 'bulk_import_workflows',
      entity: 'OperationsWorkflow',
      entityId: null,
      changes: { after: { count: createdWorkflows.length } },
      ipAddress: req.ip,
    });

    bustFilterCache();
    // والصفوفُ في البثّ تُحجَب لكلّ دورٍ كما تُحجَب في القائمة — كانت تخرج كاملةً
    // لكلّ مقبس، بمالها وقيمة بيعها.
    try {
      emitPerRole('workflow:bulkImported', (r) => ({
        count: createdWorkflows.length,
        workflows: stripRowFor(r, populated),
      }));
    } catch (e) { console.error('WebSocket emit error:', e); }

    res.status(201).json({
      imported: createdWorkflows.length,
      skipped: skipped.length,
      skippedReports: skipped,
      workflows: stripRowFor(req.user.role, populated),
    });
  } catch (error) {
    console.error('Bulk import workflows error:', error);
    res.status(500).json({ message: 'Failed to bulk import workflows' });
  }
};

// GET /api/workflows/pending-by-customer/:customerId
exports.getPendingByCustomer = async (req, res) => {
  try {
    // الطرفُ من سجلّ التحصيل لا من `Customer`: ذاك سجلُّ ورك فلو زال، وهذا
    // هو الذي يعرفه القسمُ ويُبنى منه ملفُّ العميل.
    const CollectionsParty = require('../models/CollectionsParty');
    const party = await CollectionsParty.findById(req.params.customerId).select('name').lean();
    if (!party) {
      return res.status(404).json({ message: 'الطرف غير موجود' });
    }

    const workflows = await OperationsWorkflow.find({
      username: flexSpaceRegex(party.name),
      $and: [
        { $or: [{ paymentDate: null }, { paymentDate: '' }, { paymentDate: { $exists: false } }] },
        { $or: [{ invoiceNumber: null }, { invoiceNumber: '' }, { invoiceNumber: { $exists: false } }] },
      ],
    })
      .select('reportNumber reportDate fromLocation toLocation branch carOwner sellingValue stage createdAt')
      .sort({ createdAt: -1 })
      .lean();

    res.json({ workflows: stripRowFor(req.user.role, workflows), total: workflows.length });
  } catch (error) {
    console.error('Get pending invoices by customer error:', error);
    res.status(500).json({ message: 'Failed to load pending invoices' });
  }
};

// Return field permissions info for the frontend
exports.getFieldPermissions = async (req, res) => {
  // `roleAccess` تبقى كما هي (شاشاتٌ تقرؤها بالمفتاح)، ويُضاف `myFields`:
  // حقولُ قارئِ هذه الصفحة نفسِه — وهي الوحيدةُ التي تعرف الدورَ المصنوع.
  res.json({
    groups: FIELD_GROUPS,
    roleAccess: ROLE_FIELD_ACCESS,
    myFields: await fieldsForRole(req.user.role),
    // زرُّ «ربط بمعاملة تخليص» يُعرض لمن يملكه — والخادمُ يفحصه ثانيةً.
    canLinkCustoms: await canLinkCustoms(req.user.role),
  });
};

// ── وشرطُ الفلترة واحدٌ لكلّ من يقرأ هذه الكشوف ────────────────────────────
// صفحةُ «التشغيل — خاصّ» تعرض الكشوفَ نفسَها بسعر بيعنا. ولو بنت شرطَها بيدها
// لانفصل الجدولان عند أوّل تعديلٍ هنا: صفوفٌ في شاشةٍ ليست في الأخرى، ومجموعٌ
// لا يساوي مجموعًا. فتُصدَّر الدالّةُ ويُقرأ الشرطُ من موضعٍ واحد.
module.exports.buildWorkflowFilter = buildWorkflowFilter;
// وحجبُ أعمدة المال واحدٌ أيضًا: الصفحةُ الخاصّة تعرض أعمدةَ الكشف كلَّها،
// ومَن لا يملك الفاتورةَ هنا لا يملكها هناك.
module.exports.canSeeMoney = canSeeMoney;
module.exports.fieldsForRole = fieldsForRole;
module.exports.stripMoneyFor = stripMoneyFor;
module.exports.canSeeSelling = canSeeSelling;
module.exports.SELLING_ROLES = SELLING_ROLES;
// والكشفُ يُعرض كاملًا في صفحة معاملة التخليص — بالحجب نفسِه وبالحقول نفسِها.
module.exports.stripRowFor = stripRowFor;
module.exports.FULL_FIELDS = FULL_FIELDS;

/**
 * هل يصل هذا الدورُ إلى `PUT /api/workflows/:id` ويُقبل منه حقلٌ واحدٌ على الأقلّ؟
 *
 * شاشةٌ أخرى (صفحةُ معاملة التخليص) تعرض زرَّ «تعديل» على الكشف، وتحفظ من
 * النقطة نفسِها. فيُسأل هنا ما يسأله الطريقُ كلُّه: حارسُ قسم التشغيل
 * (`sectionGate`) بمصفوفته وافتراضه — «عرض» لا يكتب و«لا شيء» يمنع — ثمّ
 * قائمةُ الأدوار في المسار، ثمّ حقولُ الدور. فلا يظهر زرٌّ يُردّ كلَّ مرّة.
 */
async function canWriteWorkflows(role) {
  const fields = await fieldsForRole(role);
  if (!fields.length) return { canEdit: false, fields };
  const { FULL_ACCESS_ROLES } = require('../config/constants');
  if (FULL_ACCESS_ROLES.includes(role)) return { canEdit: true, fields };
  try {
    const { getOverride, liftFinance } = require('../utils/permissions');
    const { defaultAccess } = require('../config/sections');
    const saved = await getOverride(role, 'Operations');
    const access = saved == null ? liftFinance(role, defaultAccess(role, 'Operations')) : saved;
    if (access === 'edit') return { canEdit: true, fields };
    // بلا منحٍ ولا افتراض: يقرّر سطرُ الأدوار في المسار — وأدوارُ الخريطة كلُّها فيه.
    if (saved == null && access === 'none') return { canEdit: !!ROLE_FIELD_ACCESS[role], fields };
    return { canEdit: false, fields };
  } catch (e) {
    return { canEdit: false, fields };
  }
}
module.exports.canWriteWorkflows = canWriteWorkflows;
module.exports.syncOpsInvoices = syncOpsInvoices;

// ═══════════════════════════════════════════════════════════════════════════
//  فحوصُ الفواتير — GET /api/workflows/invoice-checks[/:kind]
// ═══════════════════════════════════════════════════════════════════════════
// أرقامُ فواتيرَ وقيمُها وأسماءُ عملائها: لمن يملك أعمدةَ المال وحدَه.
exports.invoiceChecks = async (req, res) => {
  try {
    if (!canSeeMoney(req.user.role)) return res.status(403).json({ message: 'Insufficient permissions' });
    res.json(await require('../services/invoiceChecksService').summary());
  } catch (e) {
    console.error('invoiceChecks:', e);
    res.status(500).json({ message: 'تعذّر حساب فحوص الفواتير' });
  }
};
exports.invoiceCheckList = async (req, res) => {
  try {
    if (!canSeeMoney(req.user.role)) return res.status(403).json({ message: 'Insufficient permissions' });
    const rows = await require('../services/invoiceChecksService').list(String(req.params.kind || ''));
    if (!rows) return res.status(404).json({ message: 'فحصٌ غير معروف' });
    res.json({ kind: req.params.kind, rows, total: rows.length });
  } catch (e) {
    console.error('invoiceCheckList:', e);
    res.status(500).json({ message: 'تعذّر جلب القائمة' });
  }
};

// ═══════════════════════════════════════════════════════════════════════════
//  رفعُ بيانات الفواتير من إكسل — POST /api/workflows/import-invoices
// ═══════════════════════════════════════════════════════════════════════════
/**
 * ورقةُ المبيعات من النظام المحاسبيّ (مثل «مبيعات حتي 16-10.xlsx»): لكلّ كشفٍ
 * صفّ — «امر الشحن» هو رقمُ الكشف عندنا، ومعه السند ورقمُ الفاتورة وصافيها
 * وضريبتُها وإجماليُّها وتاريخُها. فيُكتب كلُّ ذلك على كشفه دفعةً واحدة بدل
 * كتابته صفًّا صفًّا (صاحبُ الشركة، ٢٠٢٦/١٠/٢٠).
 *
 *   · الأعمدةُ تُقرأ بأسمائها لا بمواضعها، و«العميل» لا يُقرأ (العميلُ من الكشف).
 *   · رقمُ كشفٍ تكرّر في الملفّ: الصفُّ الأخير هو المعتمد، وما في الملفّ يكتب
 *     فوق ما في الكشف (الأحدثُ هو الأصحّ).
 *   · كلُّ صفٍّ يمرّ بقواعد التعديل المفرد نفسِها: الصلاحيّة، والكشفُ المقفول
 *     لدى غيرك، ونوعُ الدفع (الكاش لا رقمَ فاتورةٍ له)، واشتقاقُ الضريبة.
 *   · ورقمُ الفاتورة الضريبيّ يصل التحصيلَ فورًا (syncOpsInvoices).
 *   · `apply: false` يُرجع المعاينةَ وحدَها — ما سيُكتب وما لن يُكتب ولماذا.
 */
exports.importInvoices = async (req, res) => {
  try {
    const XLSX = require('xlsx');
    const dataUrl = String(req.body.dataUrl || '');
    const m = dataUrl.match(/^data:[^;]*;base64,(.*)$/);
    if (!m) return res.status(400).json({ message: 'ارفع ملفّ إكسل' });
    let wb;
    try { wb = XLSX.read(Buffer.from(m[1], 'base64'), { type: 'buffer', cellDates: false }); }
    catch (_) { return res.status(400).json({ message: 'الملفّ ليس إكسل صالحًا' }); }

    const norm = (s) => String(s ?? '').replace(/[ \s]+/g, ' ').trim();
    const fold = (s) => norm(s).replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/\s+/g, '');
    const COLS = {
      reportNumber: ['امرالشحن', 'رقمالكشف', 'رقمكشفالتخريج'],
      documentNumber: ['السند', 'رقمالسند'],
      invoiceNumber: ['رقمالفاتوره'],
      netInvoice: ['اجماليالسعر', 'صافيالفاتوره'],
      totalInvoice: ['المجموعالصافي', 'اجماليالفاتوره'],
      tax: ['ضريبهالبند', 'الضريبه'],
      invoiceDate: ['التاريخ', 'تاريخالفاتوره'],
      // العميلُ لا يُكتب على الكشف (العميلُ من الكشف) — يُحفظ مع سطر الورقة
      // ليُقارَن بعميل الكشف (بطاقة «عدم تطابق اسم العميل»).
      customerName: ['العميل', 'اسمالعميل'],
    };
    const num = (v) => {
      if (v === null || v === undefined || v === '') return undefined;
      const n = Number(String(v).replace(/[٠-٩]/g, (c) => '٠١٢٣٤٥٦٧٨٩'.indexOf(c)).replace(/,/g, ''));
      return Number.isFinite(n) ? Math.round(n * 100) / 100 : undefined;
    };
    const text = (v) => {
      if (v === null || v === undefined) return '';
      const s = typeof v === 'number' ? String(Math.round(v)) : norm(v);
      return s.replace(/[٠-٩]/g, (c) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(c)));
    };
    // التاريخ رقمٌ تسلسليٌّ في إكسل — يُقرأ بأجزائه (لا cellDates: يفقد يومًا). راجع xlsx-date-epoch.
    const date = (v) => {
      if (v === null || v === undefined || v === '') return undefined;
      if (typeof v === 'number') {
        const p = XLSX.SSF.parse_date_code(v);
        return p ? new Date(Date.UTC(p.y, p.m - 1, p.d)) : undefined;
      }
      const s = norm(v);
      let mm = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
      if (mm) return new Date(Date.UTC(+mm[1], +mm[2] - 1, +mm[3]));
      mm = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/);
      if (mm) return new Date(Date.UTC(+mm[3], +mm[2] - 1, +mm[1]));
      return undefined;
    };

    // ── قراءةُ الصفوف من كلّ ورقةٍ فيها عمودُ «امر الشحن» ──
    const byReport = new Map(); let fileRows = 0; const badRows = [];
    // ── وأسطرُ الورقة كما جاءت، تُحفظ بعد التطبيق ───────────────────────────
    // (فاتورة، كشف) — الأخيرُ يغلب كما في `byReport`. راجع services/invoiceChecksService.
    const lineMap = new Map();
    for (const name of wb.SheetNames) {
      const aoa = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: null, blankrows: false });
      const hi = aoa.findIndex((r) => (r || []).some((c) => COLS.reportNumber.includes(fold(c))));
      if (hi < 0) continue;
      const head = aoa[hi].map(fold);
      const at = Object.fromEntries(Object.entries(COLS).map(([k, names]) => [k, head.findIndex((h) => names.includes(h))]));
      for (let i = hi + 1; i < aoa.length; i++) {
        const r = aoa[i] || [];
        const rep = text(r[at.reportNumber]);
        if (!rep) continue;
        fileRows += 1;
        const patch = {};
        if (at.documentNumber >= 0 && text(r[at.documentNumber])) patch.documentNumber = text(r[at.documentNumber]);
        if (at.invoiceNumber >= 0 && text(r[at.invoiceNumber])) patch.invoiceNumber = text(r[at.invoiceNumber]);
        if (at.netInvoice >= 0 && num(r[at.netInvoice]) !== undefined) patch.netInvoice = num(r[at.netInvoice]);
        if (at.tax >= 0 && num(r[at.tax]) !== undefined) patch.tax = num(r[at.tax]);
        if (at.totalInvoice >= 0 && num(r[at.totalInvoice]) !== undefined) patch.totalInvoice = num(r[at.totalInvoice]);
        if (at.invoiceDate >= 0 && date(r[at.invoiceDate])) patch.invoiceDate = date(r[at.invoiceDate]);
        if (!Object.keys(patch).length) { badRows.push({ reportNumber: rep, reason: 'لا بيانات فاتورة في الصفّ' }); continue; }
        byReport.set(rep, { patch, sheetRow: i + 1, sheet: name }); // الأخيرُ يغلب
        if (patch.invoiceNumber) {
          lineMap.set(`${patch.invoiceNumber}|${rep}`, {
            invoiceNumber: patch.invoiceNumber, reportNumber: rep,
            net: patch.netInvoice ?? null, tax: patch.tax ?? null, total: patch.totalInvoice ?? null,
            customerName: at.customerName >= 0 ? norm(r[at.customerName]) : '',
            invoiceDate: patch.invoiceDate || null, sheet: name, sheetRow: i + 1,
          });
        }
      }
    }
    if (!byReport.size) return res.status(400).json({ message: 'لم يُعثر على عمود «امر الشحن» أو لا صفوف فيه' });

    const allowed = await fieldsForRole(req.user.role);
    const reports = await OperationsWorkflow.find({ reportNumber: { $in: [...byReport.keys()] } })
      .select('reportNumber applicationStatus paymentType paymentSubtype paymentTypeSource paymentMethod reportDate tax netInvoice totalInvoice invoiceNumber invoiceDate documentNumber username lockedBy lockedByName lockedAt executionStatus').lean();
    const found = new Map(reports.map((r) => [String(r.reportNumber).trim(), r]));

    const notFound = []; const skipped = []; const unchanged = []; const plan = [];
    for (const [rep, item] of byReport) {
      const r = found.get(rep);
      if (!r) { notFound.push(rep); continue; }
      if (isLocked(r, req.user._id)) { skipped.push({ reportNumber: rep, reason: `قيد التعديل لدى ${r.lockedByName || 'مستخدم آخر'}` }); continue; }
      const own = filterFieldsByRole({ ...item.patch }, req.user.role, allowed);
      const refused = own.__rejected || [];
      if (!Object.keys(own).length) { skipped.push({ reportNumber: rep, reason: `صلاحيّتك لا تسمح بـ: ${refused.join('، ')}` }); continue; }
      await fillPaymentTypeFromCustomer(own, r);
      stampInvoiceDate(own, r);
      const billed = applyBillingRules(own, r);
      if (billed.blocked.includes('invoiceNumber')) { skipped.push({ reportNumber: rep, reason: 'كشف نقديّ — لا رقم فاتورة له (غيِّر نوعه إلى ضريبي أوّلًا)' }); continue; }
      const patch = billed.patch;
      const diff = Object.keys(patch).filter((k) => {
        const a = patch[k]; const b = r[k];
        if (a instanceof Date || b instanceof Date) return String(a ? new Date(a).toISOString().slice(0, 10) : '') !== String(b ? new Date(b).toISOString().slice(0, 10) : '');
        return String(a ?? '') !== String(b ?? '');
      });
      if (!diff.length) { unchanged.push(rep); continue; }
      plan.push({ _id: r._id, reportNumber: rep, patch, before: Object.fromEntries(diff.map((k) => [k, r[k] ?? null])), oldInvoice: r.invoiceNumber, refused });
    }

    const summary = {
      fileRows, reports: byReport.size, toUpdate: plan.length, unchanged: unchanged.length,
      notFound, skipped, badRows,
      sample: plan.slice(0, 15).map((p) => ({ reportNumber: p.reportNumber, before: p.before, after: Object.fromEntries(Object.keys(p.before).map((k) => [k, p.patch[k]])) })),
    };
    // ── تنبيهاتُ الرفع: الفحوصُ الثلاثةُ على أسطر هذه الورقة ────────────────
    // في المعاينة تُقرأ الكشوفُ كما ستكون بعد التطبيق (ما سيُكتب عليها فوق ما
    // فيها) — فلا يُنبَّه على فرقٍ يزيله التطبيقُ نفسُه.
    const invChecks = require('../services/invoiceChecksService');
    const lines = [...lineMap.values()];
    if (!req.body.apply) {
      const overlay = new Map(plan.map((p) => [p.reportNumber, p.patch]));
      const checks = await invChecks.checkLines(lines, overlay);
      return res.json({ preview: true, ...summary, checks });
    }

    // ── الكتابة ──
    let updated = 0;
    for (const p of plan) {
      const r = await OperationsWorkflow.updateOne({ _id: p._id }, { $set: { ...p.patch, lastModifiedBy: req.user._id } });
      updated += r.modifiedCount || 0;
    }
    // أسطرُ الورقة تُحفظ كلُّها — ومنها ما لا كشفَ له (وهو ما تُبنى عليه بطاقتُه).
    const uploadAt = new Date();
    const savedLines = await invChecks.persistLines(lines, {
      batchId: `${uploadAt.getTime().toString(36)}-${String(req.user._id).slice(-6)}`,
      fileName: String(req.body.fileName || '').slice(0, 200), at: uploadAt,
      userId: req.user._id, userName: `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim(),
    });
    cache.clear('wf:');
    const fresh = await OperationsWorkflow.find({ _id: { $in: plan.map((p) => p._id) } }).select('invoiceNumber').lean();
    await syncOpsInvoices([...fresh.map((w) => w.invoiceNumber), ...plan.map((p) => p.oldInvoice)]);
    // والسندُ من الورقة قد يكون بوليصةَ معاملة تخليص — راجع services/customsOpsLink.
    {
      const withDoc = plan.filter((p) => Object.prototype.hasOwnProperty.call(p.patch, 'documentNumber')).map((p) => p._id);
      if (withDoc.length) {
        await require('../services/customsOpsLink').resolveReports({ _id: { $in: withDoc } })
          .catch((e) => console.error('customs link (import invoices):', e.message));
      }
    }
    const checks = await invChecks.checkLines(lines);
    try { emitToAll('workflow:bulkImported', { importInvoices: true, updated }); } catch (_) { /* */ }
    logAudit({
      user: req.user, action: 'import_invoices', entity: 'OperationsWorkflow',
      details: `رفع بيانات فواتير: ${updated} كشفًا من ${byReport.size} في الملفّ (${notFound.length} غير موجود، ${skipped.length} لم يُكتب)`, ip: req.ip,
    });
    return res.json({ preview: false, updated, savedLines, ...summary, checks });
  } catch (e) {
    console.error('importInvoices:', e);
    res.status(500).json({ message: e.message || 'تعذّر رفع بيانات الفواتير' });
  }
};

// ═══════════════════════════════════════════════════════════════════════════
//  ربطُ الكشف بمعاملة تخليص — يدويًّا
// ═══════════════════════════════════════════════════════════════════════════
//
// الأدلّةُ الآليّة (خاناتُ النقل في المعاملة، و«رقم السند» = البوليصة أو الحاوية)
// لا تغطّي كلَّ كشف: كثيرٌ من الكشوف لا سندَ عليه. فيربطه موظّفُ التشغيل بيده
// بعد أن يبحث برقم المعاملة أو البوليصة أو الحاوية. راجع services/customsOpsLink.

/** مَن يربط ويفكّ: مَن يكتب «رقم السند» أو «مراجعة التشغيل» في هذا الجدول. */
async function canLinkCustoms(role) {
  if (['super_admin', 'admin', 'operations_manager'].includes(role) || isFinanceFull(role)) return true;
  const f = await fieldsForRole(role);
  return f.includes('documentNumber') || f.includes('operationsReview');
}

/** GET /api/workflows/customs-search?q= — معاملاتٌ تطابق رقمَها أو بوليصتَها أو حاويتَها. */
exports.customsSearch = async (req, res) => {
  try {
    const CustomsClearance = require('../models/CustomsClearance');
    const link = require('../services/customsOpsLink');
    const q = String(req.query.q || '').trim().slice(0, 60);
    if (q.length < 2) return res.json({ clearances: [] });
    const esc = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const k = link.normKey(q);
    // البوليصةُ والحاويةُ تُكتبان بمسافاتٍ وشرطاتٍ أو بدونها — فيُبحث بالحروف وحدها.
    const loose = k ? k.split('').join('[\\s\\-/._]*') : '';
    const or = [{ refNumber: { $regex: esc, $options: 'i' } }, { customerName: { $regex: esc, $options: 'i' } }];
    if (loose) or.push({ blNumber: { $regex: loose, $options: 'i' } }, { 'containers.containerNumber': { $regex: loose, $options: 'i' } });
    const rows = await CustomsClearance.find({ $or: or, cancelled: { $ne: true } })
      .select('refNumber blNumber customerName containerCount cargoType stage containers.containerNumber isCompleted upcoming')
      .sort({ createdAt: -1 }).limit(15).lean();
    res.json({
      clearances: rows.map((c) => ({
        _id: String(c._id), refNumber: c.refNumber || '', blNumber: c.blNumber || '',
        customerName: c.customerName || '', containerCount: c.containerCount || 0, cargoType: c.cargoType || 'containers',
        stage: c.stage || '', isCompleted: !!c.isCompleted, upcoming: !!c.upcoming,
        containers: (c.containers || []).map((u) => u.containerNumber).filter(Boolean),
      })),
    });
  } catch (e) {
    console.error('customs search', e);
    res.status(500).json({ message: 'تعذّر البحث في معاملات التخليص' });
  }
};

async function afterLinkWrite(req, wf, link, kind) {
  const populated = await OperationsWorkflow.findById(wf._id)
    .populate('createdBy', 'firstName lastName')
    .populate('lastModifiedBy', 'firstName lastName')
    .populate('lockedBy', 'firstName lastName');
  // الذاكرةُ تُمسح ثمّ يُبَثّ — داخل announce.
  link.announce({ reportNumbers: [wf.reportNumber], clearanceIds: kind.clearanceIds });
  try { emitPerRole('workflow:updated', (r) => stripRowFor(r, populated)); } catch (_) { /* */ }
  await logAudit({
    user: req.user._id, action: kind.action, entity: 'OperationsWorkflow', entityId: wf._id,
    changes: { before: { customsLink: wf.customsLink || null }, after: { customsLink: populated.customsLink || null } }, ipAddress: req.ip,
  });
  return stripRowFor(req.user.role, populated);
}

/** PUT /api/workflows/:id/customs-link {clearanceId, containers?} — ربطٌ يدويّ. */
exports.setCustomsLink = async (req, res) => {
  try {
    if (!(await canLinkCustoms(req.user.role))) return res.status(403).json({ message: 'صلاحيّتك لا تسمح بربط الكشف بمعاملة تخليص' });
    const id = String(req.body.clearanceId || '');
    if (!mongoose.isValidObjectId(id)) return res.status(400).json({ message: 'اختر معاملةَ التخليص' });
    const CustomsClearance = require('../models/CustomsClearance');
    const c = await CustomsClearance.findById(id).select('refNumber blNumber customerName containers.containerNumber cancelled').lean();
    if (!c || c.cancelled) return res.status(404).json({ message: 'معاملةُ التخليص غيرُ موجودة' });
    const wf = await OperationsWorkflow.findById(req.params.id).select('reportNumber customsLink').lean();
    if (!wf) return res.status(404).json({ message: 'الكشف غير موجود' });
    const known = new Set((c.containers || []).map((u) => String(u.containerNumber || '').trim()).filter(Boolean));
    const containers = (Array.isArray(req.body.containers) ? req.body.containers : [])
      .map((x) => String(x || '').trim()).filter((x) => known.has(x));
    const link = require('../services/customsOpsLink');
    const next = {
      clearance: c._id, refNumber: c.refNumber || '', blNumber: c.blNumber || '', customerName: c.customerName || '',
      containers: [...new Set(containers)].sort(), via: 'manual', at: new Date(),
      byName: `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim(),
    };
    await OperationsWorkflow.updateOne({ _id: wf._id }, { $set: { customsLink: next, lastModifiedBy: req.user._id } });
    const before = wf.customsLink && wf.customsLink.clearance ? [String(wf.customsLink.clearance)] : [];
    const out = await afterLinkWrite(req, wf, link, { action: 'link_workflow_customs', clearanceIds: [...new Set([...before, id])] });
    res.json(out);
  } catch (e) {
    console.error('set customs link', e);
    res.status(500).json({ message: 'تعذّر ربط الكشف بمعاملة التخليص' });
  }
};

/**
 * DELETE /api/workflows/:id/customs-link — فكُّ الربط.
 * ما كتبه قسمُ التخليص في خانة النقل لا يُفكّ من هنا: يُصحَّح في المعاملة نفسِها،
 * وإلّا عاد الربطُ في أوّل حفظٍ لها ولا يُعرف لماذا.
 */
exports.clearCustomsLink = async (req, res) => {
  try {
    if (!(await canLinkCustoms(req.user.role))) return res.status(403).json({ message: 'صلاحيّتك لا تسمح بفكّ ربط الكشف' });
    const wf = await OperationsWorkflow.findById(req.params.id).select('reportNumber customsLink').lean();
    if (!wf) return res.status(404).json({ message: 'الكشف غير موجود' });
    const cur = wf.customsLink || {};
    if (!cur.clearance) return res.status(400).json({ message: 'الكشفُ غيرُ مرتبطٍ بمعاملة تخليص' });
    if (cur.via === 'move') {
      return res.status(409).json({
        code: 'LINKED_FROM_CUSTOMS',
        message: `رقمُ هذا الكشف مكتوبٌ في خانة نقلٍ في المعاملة ${cur.refNumber || ''} — يُصحَّح من صفحة المعاملة في قسم التخليص.`,
      });
    }
    const link = require('../services/customsOpsLink');
    await OperationsWorkflow.updateOne({ _id: wf._id }, {
      $set: {
        customsLink: {
          clearance: null, refNumber: '', blNumber: '', customerName: '', containers: [], via: 'unlinked', at: new Date(),
          byName: `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim(),
        },
        lastModifiedBy: req.user._id,
      },
    });
    const out = await afterLinkWrite(req, wf, link, { action: 'unlink_workflow_customs', clearanceIds: [String(cur.clearance)] });
    res.json(out);
  } catch (e) {
    console.error('clear customs link', e);
    res.status(500).json({ message: 'تعذّر فكّ الربط' });
  }
};
