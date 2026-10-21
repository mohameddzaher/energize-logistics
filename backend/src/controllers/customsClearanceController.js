const CustomsClearance = require('../models/CustomsClearance');
const { sendMongooseError, stripEmpty } = require('../utils/mongooseError');
const {
  recomputeTotals, COST_KEYS, MARGIN_KEYS, pipelineOf, readStages, readUnits, lockReason, hasTransportInvoice,
  UNIT_STAGES, PORT_LEGS,
  syncUnits, TRANSPORT_LEGS, CARGO_TYPES, VEHICLE_KINDS,
  STAGE_COST, TRANSPORT_STAGE_KEYS, DERIVED_REVENUE, applyPaidCosts,
} = require('../models/CustomsClearance');
const contractPricing = require('../utils/customsContractPricing');
const cache = require('../utils/ttlCache');
const { searchKey } = require('../utils/arabicSearch');
const { parseMonth, parseYear } = require('../utils/period');
const logAudit = require('../utils/auditLogger');
const { endedStaff, userEnded } = require('../utils/endedStaff');
const { emitToAll } = require('../websocket/socketManager');
const { createNotification } = require('../services/notificationService');

// Scalar fields a client may set on create/update.
const EDITABLE = [
  'branch', 'cancelled', 'cargoType', 'assignedTo', 'customerName', 'customer',
  'shippingAgent', 'shippingAgentEmail', 'blNumber', 'invoiceNumber', 'invoiceDate',
  'port', 'invoiceType', 'containerCount', 'totalWeight', 'invoiceValue', 'currency',
  'exporterCompany', 'countryOfOrigin', 'hsCode', 'saberNumber', 'notes',
  // master-spreadsheet additions
  'legacySerial', 'periodMonth', 'periodYear', 'city',
  'declarationNumber', 'declarationDate', 'papersReceivedDate',
  'unloadingAppointment', 'unloadingLocation', 'doNumber', 'exitPermitNumber',
  'returnDeadline', 'returnFreeDays', 'demurrageStartDate',
  // (المراحلُ لا تُكتب من هنا: لها قواعدُ — طريقان يتنافيان ومراحلُ تُغلَق —
  //  فتمرّ من `setStage` وحدَها. راجع PATCH /:id/stage.)
  // ربطُ المعاملة بملفَّي العميل والوكيل.
  'customerParty', 'agentParty',
  // المعاملةُ القادمة: علمُها وتاريخُها المرتقَب.
  'upcoming', 'expectedDate',
];

// Sub-documents. Sent as whole objects by the frontend but merged field-by-field
// here so a partial PUT can never wipe the sibling keys.
const NESTED = {
  documents: ['bl', 'commercialInvoice', 'certificateOfOrigin', 'packingList', 'saber'],
  agentPapers: ['blStamped', 'customerAuthorization', 'companyAuthorization'],
  stageDates: ['doInvoiceEmailed', 'doInvoicePaid', 'doLinkEmailed', 'dutyPaid', 'portFeesPaid', 'unloadingFeesPaid', 'containersReturned', 'returnInvoiceDate'],
  stageDone: ['doInvoiceEmailed', 'doInvoicePaid', 'doLinkEmailed', 'dutyPaid', 'portFeesPaid', 'unloadingFeesPaid', 'containersReturned', 'returnInvoiceDate'],
  costs: COST_KEYS,
  // totalInvoiced/profit مشتقّتان — لا تُقبلان من العميل مهما أرسل. ومثلُهما
  // `transportNet`: صارت فرقَ سعرِ النقل عن سعر المورد (recomputeTotals)،
  // فقبولُها من الشاشة يفتح بابَ رقمٍ يخالف بنودَه.
  revenue: [...MARGIN_KEYS.filter((k) => !DERIVED_REVENUE.includes(k)), 'transportSelling', 'yardTransportNet',
    'transportToYardSelling', 'yardToCustomerSelling'],
  billing: ['invoiceStatus', 'ourInvoiceNumber', 'invoicedAt'],
};

const NUMERIC_NESTED = new Set(['costs', 'revenue']);
// خاناتٌ فراغُها معنًى لا صفر: «لم يُكتب السعرُ بعد» (راجع recomputeTotals).
const NULLABLE_NESTED = new Set(['revenue.transportToYardSelling']);

/**
 * Build an update payload from a request body.
 * `existing` (a lean doc) is merged under the incoming sub-documents so partial
 * updates keep untouched keys. costs.total / revenue.profit are always derived,
 * never taken from the client.
 */
function pick(body, existing) {
  const out = {};
  for (const k of EDITABLE) if (body[k] !== undefined) out[k] = body[k];
  if (out.customer === '' || out.customer === null) delete out.customer;

  for (const [group, keys] of Object.entries(NESTED)) {
    const incoming = body[group];
    if (incoming === undefined || incoming === null || typeof incoming !== 'object') continue;
    const base = (existing && existing[group]) || {};
    const merged = {};
    for (const k of keys) {
      const v = incoming[k] !== undefined ? incoming[k] : base[k];
      if (v === undefined) continue;
      if (NULLABLE_NESTED.has(`${group}.${k}`) && (v === null || v === '')) { merged[k] = null; continue; }
      merged[k] = NUMERIC_NESTED.has(group) ? (Number.isFinite(Number(v)) ? Number(v) : 0) : v;
    }
    out[group] = merged;
  }

  if (out.cargoType !== undefined && !CARGO_TYPES.includes(out.cargoType)) delete out.cargoType;

  if (Array.isArray(body.containers)) {
    const ymd = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : '');
    out.containers = body.containers
      .filter((r) => r && typeof r === 'object')
      .map((r, i) => ({
        // مراحلُ الوحدة وطريقُها لا تُكتب من هنا (لها `PATCH /:id/stage`): يُحفَظ
        // ما في القاعدة لهذه الخانة أيًّا كان ما أرسلته الشاشة.
        route: (existing && existing.containers && existing.containers[i] && existing.containers[i].route) || '',
        stagesDone: (existing && existing.containers && existing.containers[i] && existing.containers[i].stagesDone) || [],
        containerNumber: String(r.containerNumber || '').trim().slice(0, 60),
        exitPermit: Number.isFinite(Number(r.exitPermit)) ? Number(r.exitPermit) : 0,
        declaration: String(r.declaration || '').trim(),
        notes: String(r.notes || '').trim(),
        returnDate: ymd(r.returnDate),
        returnDepot: String(r.returnDepot || '').trim().slice(0, 120),
        returnReceipt: String(r.returnReceipt || '').trim().slice(0, 80),
        returnVehicleKind: VEHICLE_KINDS.includes(r.returnVehicleKind) ? r.returnVehicleKind : '',
        returnRef: String(r.returnRef || '').trim().slice(0, 80),
        returnNotes: String(r.returnNotes || '').trim().slice(0, 500),
        // بيانٌ واحدٌ لكلّ مرحلةِ نقل — الأخيرُ يغلب إن تكرّر المفتاح.
        moves: TRANSPORT_LEGS.map((leg) => (Array.isArray(r.moves) ? r.moves : []).filter((m) => m && m.leg === leg).pop())
          .filter(Boolean)
          .map((m) => ({
            leg: m.leg,
            vehicleKind: VEHICLE_KINDS.includes(m.vehicleKind) ? m.vehicleKind : '',
            ref: String(m.ref || '').trim().slice(0, 80),
          }))
          .filter((m) => m.vehicleKind || m.ref),
      }));
  }
  // ── والخاناتُ بعدد الوحدات ───────────────────────────────────────────────
  // العددُ يُكتب عند الإنشاء ويُعدَّل بعده؛ وفي الحالين تُفتَح لكلّ حاويةٍ
  // خانتُها. وما كُتب فيه رقمٌ لا يسقط بتصغير العدد (راجع syncUnits).
  if (out.containerCount !== undefined || out.containers) {
    const count = out.containerCount !== undefined
      ? out.containerCount
      : ((existing && existing.containerCount) || (out.containers || []).length);
    out.containers = syncUnits(out.containers || (existing && existing.containers) || [], count);
    out.containerCount = out.containers.length;
  }

  // Derive totals from whichever cost/revenue values will end up stored.
  const merged = {
    costs: { ...((existing && existing.costs) || {}), ...(out.costs || {}) },
    revenue: { ...((existing && existing.revenue) || {}), ...(out.revenue || {}) },
  };
  recomputeTotals(merged);
  if (out.costs || (existing && existing.costs)) out.costs = merged.costs;
  if (out.revenue || (existing && existing.revenue)) out.revenue = merged.revenue;

  return out;
}

/**
 * ── وما لا يُعرَض ولا يُصدَّر ولا يُبحَث فيه لا يُنقَل ──────────────────────
 *
 * كانت القائمةُ تستثني الثقيلَ المعروف (المرفقات والحاويات ومراحل السداد)
 * وتأخذ ما بقي كلَّه — فبلغت حمولتُها **٤٥٥ كيلوبايت** لمئتين وثمانٍ وستّين
 * معاملة. وأثقلُ ما فيها لا يُقرأ في الجدول أصلًا: `costs` و`revenue` كاملين
 * (١٢٦ كيلوبايت ولا يُقرأ منهما إلّا أربعةُ أرقام)، و`stageDates` و`agentPapers`
 * (٦٥ كيلوبايت لا تُقرأ حرفًا).
 *
 * والوصلةُ إلى العنقود هي الثمنُ كلُّه لا الحساب (راجع dashboard-performance):
 * ستُّ ثوانٍ تنتظرها الشاشةُ عند كلّ فتحةٍ بعد انقضاء الذاكرة.
 *
 * فتُذكَر الحقولُ بأسمائها: ما يعرضه الجدول، وما يخرج في إكسل، وما يُبحَث فيه
 * (البحثُ يجري على هذه القائمة نفسِها في الذاكرة — فحقلٌ يسقط من هنا يسقط من
 * البحث بلا أن يُقال).
 *
 * ── وما يُبحَث فيه يُقرأ ولا يُرسَل ──────────────────────────────────────────
 * بقي بعد ذلك ٢٣٠ كيلوبايت لمئتين وإحدى وسبعين معاملة، وثُلثُها حقولٌ لا تُرسَم
 * في جدولٍ ولا تخرج في إكسل: إنّما تُقرأ ليصحَّ البحثُ عليها (رقمُ الفاتورة،
 * سابر، البند، الرقمُ القديم، موقعُ التفريغ…). والبحثُ يجري **في الخادم** على
 * الصفوف المحفوظة في الذاكرة، فلا حاجةَ أن تعبر الشبكةَ إلى الهاتف أصلًا:
 * تُقرأ من العنقود، وتبقى في الذاكرة المؤقّتة، ويُسقطها `toWire` قبل الإرسال.
 * فالبحثُ باقٍ كما كان، والحمولةُ تنقص ثلثًا.
 */
// ما تقرؤه الشاشتان: جدولُ الويب وأعمدةُ إكسل وسطرُ الهاتف وفلاترُهما.
const DISPLAY_FIELDS = [
  'refNumber', 'blNumber', 'customerName', 'shippingAgent', 'port', 'stage', 'branch', 'city',
  'containerCount', 'declarationNumber', 'periodYear', 'periodMonth', 'createdAt',
  // عمودا الجدول: رقمُ البيان وتاريخُ التفريغ (موعدُ التفريغ في المعاملة).
  'unloadingAppointment',
  'cancelled', 'isCompleted', 'returnDeadline', 'returnFreeDays',
  'customerParty', 'agentParty',
  // نوعُ المعاملة، ورقمُ فاتورة العميل — به تُقرأ «حالة الفاتورة» في الجدول.
  'cargoType', 'saleInvoiceNumber',
  // سطرُ الهاتف يعرض الشركةَ المصدّرة ويبحث فيها (configs.dart · customsCfg).
  'exporterCompany',
  // ── وصندوقُ بحثِ الويب يعمل في المتصفّح ────────────────────────────────
  // شاشةُ الويب لا ترسل `search` إلى الخادم: تُصفّي الصفوفَ التي عندها. فما
  // يقرؤه صندوقُها لا يكفي أن يكون في القراءة — لا بدّ أن يصل. ورقمُ فاتورة
  // الوكيل منها، وثمنُه لا شيء (مذكورٌ في صفَّين من مئتين وإحدى وسبعين).
  'invoiceNumber',
];
// تُرسَل بعد انتقاءٍ داخليّ — لا الوثيقةُ الفرعيّة كلُّها (راجع toWire).
const DISPLAY_NESTED = ['billing.invoiceStatus', 'billing.ourInvoiceNumber', 'stageDone.containersReturned',
  'costs.total', 'revenue.clearanceFee', 'revenue.totalInvoiced', 'revenue.profit'];
// (كانت هنا قائمةُ «تُقرأ للبحث وحدَه». البحثُ صار له فهرسُه — راجع
//  SEARCH_INDEX_FIELDS أسفل — فلا يُقرأ في القائمة إلّا ما يُعرَض أو يُحسَب منه.)
// تُقرأ ليُحسَب منها ولا تُرسَل: منها نسبةُ المراحل وهل تنتظر فاتورةَ النقل.
const DERIVE_ONLY = ['papersReceivedDate', 'declarationDate', 'stagesDone', 'transportRoute', 'pipelineVersion', 'stageDone.doInvoicePaid', 'transportInvoiceReceived',
  'containers.route', 'containers.stagesDone',
  // أرقامُ الحاويات (أو السيّارات) — يُبحَث بها ويُرسَل منها سطرٌ واحد (راجع toWire).
  'containers.containerNumber'];
const LIST_FIELDS = [...DISPLAY_FIELDS, ...DISPLAY_NESTED, ...DERIVE_ONLY, 'notesLog'].join(' ');

/**
 * ── البحثُ بأيّ شيءٍ مكتوبٍ على المعاملة ────────────────────────────────────
 * صاحبُ الشركة: «البحث يقبل كلّ حاجة — رقم الحاوية، رقم البوليصة… في كلّ
 * صفحات التخليص». والورقةُ التي في يد الموظّف قد تحمل أيَّ رقم: البيان، إذنَ
 * التسليم، تصريحَ الخروج، سابر، إيصالَ إرجاع الحاوية، رقمَ فاتورتنا أو فاتورة
 * الوكيل — والمعاملةُ هي المجهول.
 *
 * فللبحث فهرسٌ واحدٌ تقرؤه الشاشاتُ كلُّها (القائمة، ولوحةُ القسم، وصفحاتُ
 * العملاء والوكلاء والناقلين، والهاتف): لكلّ معاملةٍ سطرٌ مطويٌّ واحد من كلّ
 * نصٍّ فيها، ويُسأل «هل يحتوي». والطيُّ (searchKey) يُسقط المسافاتِ والشرطات
 * ويوحّد صورَ الحروف العربيّة والأرقامَ العربيّة — فـ«MSKU 123 4567»
 * و«msku-1234567» رقمٌ واحد، و«مؤسسة» و«موسسه» اسمٌ واحد.
 *
 * ومَن أضاف حقلًا نصّيًّا إلى المعاملة فليُضِفه هنا وفي `searchValuesOf`.
 */
const SEARCH_INDEX_FIELDS = [
  'refNumber', 'blNumber', 'customerName', 'shippingAgent', 'shippingAgentEmail', 'carrierName',
  'customerParty', 'agentParty', 'carrierParty',
  'invoiceNumber', 'saleInvoiceNumber', 'billing.ourInvoiceNumber', 'billing.invoiceStatus',
  'port', 'city', 'branch', 'declarationNumber', 'doNumber', 'exitPermitNumber', 'saberNumber', 'hsCode',
  'exporterCompany', 'countryOfOrigin', 'currency', 'invoiceType', 'legacySerial', 'notes', 'assignedTo',
  'unloadingLocation', 'contractPricing.contractTitle', 'contractPricing.routeFrom', 'contractPricing.routeTo',
  // الحاوياتُ (أو السيّارات): رقمُها وبيانُها وإرجاعُها ورقمُ كشف كلّ نقلة.
  'containers.containerNumber', 'containers.declaration', 'containers.notes', 'containers.returnDepot',
  'containers.returnReceipt', 'containers.returnRef', 'containers.returnNotes', 'containers.moves.ref',
  // طلباتُ الصرف وبنودُ البيع وفاتورةُ النقل والمرفقاتُ والملاحظاتُ كلُّها.
  'paymentStages.label', 'paymentStages.note', 'paymentStages.decisionNote', 'paymentStages.fileName',
  'saleItems.label', 'saleItems.note', 'transportInvoice.note', 'transportInvoice.fileName',
  'attachments.title', 'attachments.fileName', 'notesLog.text', 'notesLog.byName',
].join(' ');
const BRANCH_NAMES = { jeddah: 'جدة Jeddah', dammam: 'الدمام Dammam' };

/** كلُّ نصٍّ يُبحَث فيه من المعاملة — وأسماءُ أطرافها كما في سجلّ الأطراف. */
function searchValuesOf(c, partyName = () => '') {
  const list = (a) => (Array.isArray(a) ? a : []);
  return [
    c.refNumber, c.blNumber, c.customerName, c.shippingAgent, c.shippingAgentEmail, c.carrierName,
    partyName(c.customerParty), partyName(c.agentParty), partyName(c.carrierParty),
    c.invoiceNumber, c.saleInvoiceNumber, c.billing && c.billing.ourInvoiceNumber, c.billing && c.billing.invoiceStatus,
    c.port, c.city, BRANCH_NAMES[c.branch], c.declarationNumber, c.doNumber, c.exitPermitNumber, c.saberNumber, c.hsCode,
    c.exporterCompany, c.countryOfOrigin, c.currency, c.invoiceType, c.legacySerial, c.notes, c.assignedTo,
    c.unloadingLocation,
    c.contractPricing && c.contractPricing.contractTitle, c.contractPricing && c.contractPricing.routeFrom,
    c.contractPricing && c.contractPricing.routeTo,
    ...list(c.containers).flatMap((x) => (x ? [x.containerNumber, x.declaration, x.notes, x.returnDepot,
      x.returnReceipt, x.returnRef, x.returnNotes, ...list(x.moves).map((m) => m && m.ref)] : [])),
    ...list(c.paymentStages).flatMap((x) => (x ? [x.label, x.note, x.decisionNote, x.fileName] : [])),
    ...list(c.saleItems).flatMap((x) => (x ? [x.label, x.note] : [])),
    c.transportInvoice && c.transportInvoice.note, c.transportInvoice && c.transportInvoice.fileName,
    ...list(c.attachments).flatMap((x) => (x ? [x.title, x.fileName] : [])),
    ...list(c.notesLog).flatMap((x) => (x ? [x.text, x.byName] : [])),
  ];
}

// فاصلٌ لا يُكتب في صندوق بحث: لا يطابق نصٌّ آخرَ حقلٍ وأوّلَ الذي يليه.
const SEP = '\u0001';

/** الفهرسُ نفسُه — يُبنى مرّةً لكلّ ثلاثين ثانية، ويُمحى مع كلّ كتابةٍ في القسم. */
const searchIndex = () => cache.wrap('customs:search-index', 30000, async () => {
  const [rows, parties] = await Promise.all([
    CustomsClearance.find({}).select(SEARCH_INDEX_FIELDS).lean(),
    require('../models/CustomsParty').find({}).select('name').lean(),
  ]);
  const names = new Map(parties.map((p) => [String(p._id), p.name || '']));
  const partyName = (id) => (id ? names.get(String(id)) || '' : '');
  return rows.map((c) => ({
    id: String(c._id),
    parties: [c.customerParty, c.agentParty, c.carrierParty].filter(Boolean).map(String),
    blob: searchValuesOf(c, partyName)
      .filter((v) => v != null && v !== '')
      .map(searchKey).filter(Boolean).join(SEP),
  }));
});

/**
 * المعاملاتُ التي يطابقها نصُّ البحث. يطابق النصُّ كاملًا مطويًّا («MSKU 123
 * 4567» = «MSKU1234567»)، أو كلُّ كلمةٍ فيه على حدة («ميرسك جدة»: وكيلٌ وفرع).
 * `null` إن لم يكن في النصّ ما يُبحث به.
 */
async function searchClearances(text) {
  const raw = String(text || '').trim().slice(0, 120);
  const whole = searchKey(raw);
  if (!whole) return null;
  const words = raw.split(/\s+/).map(searchKey).filter(Boolean);
  const idx = await searchIndex();
  return idx.filter((r) => r.blob.includes(whole) || (words.length > 1 && words.every((w) => r.blob.includes(w))));
}
exports._search = { searchValuesOf, searchClearances, SEARCH_INDEX_FIELDS };

/**
 * ── الأرباحُ للإدارة لا للفريق ─────────────────────────────────────────────
 * صاحبُ الشركة قالها: التحليلاتُ والأرباحُ شأنٌ إداريٌّ لا يخصّ فريقَ القسم.
 * فمديرُ النظام ومديرُ القسم يريان الربحَ والهامش، وغيرُهما لا يصله الرقمُ
 * أصلًا — يُحذَف هنا في الخادم، لا يُخفى في الشاشة.
 */
const MONEY_ROLES = ['super_admin', 'customs_manager'];
const seesMoney = (req) => MONEY_ROLES.includes(req.user && req.user.role);
// ربحُ المعاملة الواحدة: للإدارة، وللماليّة التي تراجعها من شاشتها.
const PROFIT_ROLES = [...MONEY_ROLES, 'cfo', 'accounting_manager', 'accountant'];
/**
 * ── تاريخُ المعاملة ────────────────────────────────────────────────────────
 * فلاترُ اليوم والشهر والفترة تُقاس عليه. و`createdAt` لا يصلح له: ما استُورد
 * من الماستر أُدخل كلُّه في يومٍ واحد، فكان فلترُ التاريخ يُخرجه كلَّه أو يُبقيه
 * كلَّه. فالتاريخُ ما يعرفه العمل: استلامُ الورق، ثمّ البيان، ثمّ أوّلُ شهرها
 * في الماستر، ثمّ يومُ إدخالها (بتوقيت الرياض).
 */
const txDateOf = (c) => {
  for (const v of [c.papersReceivedDate, c.declarationDate]) {
    const d = String(v || '').slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
  }
  if (c.periodYear && c.periodMonth) return `${c.periodYear}-${String(c.periodMonth).padStart(2, '0')}-01`;
  return c.createdAt ? new Date(new Date(c.createdAt).getTime() + 3 * 3600000).toISOString().slice(0, 10) : '';
};

/** فُوترت ولم تُنهَ: تنتظر فاتورةَ النقل. */
const awaitsTransportInvoice = (c) => !!c.saleInvoiceNumber && !c.isCompleted && !c.cancelled
  && !(c.transportInvoiceReceived || hasTransportInvoice(c));

/**
 * صفُّ القائمة كما يعبر الشبكة.
 *
 * ولا يُرسَل فراغ: `"carrierName":""` في مئتين وإحدى وسبعين صفًّا نقلٌ لا يُقرأ،
 * ومثلُه `"lastNote":null` و`"returnDeadline":""`. وكلُّ قارئٍ لها في الشاشتين
 * يقرؤها بـ`?.` أو `|| ''` — فالغائبُ والفارغُ عنده سواء. أمّا الصفرُ والـ
 * `false` فيُرسَلان: «٠ حاوية» رقمٌ يُقرأ، و«غير مقفولة» حالةٌ تُرسَم.
 */
function toWire(r, money = true) {
  const out = { _id: r._id };
  for (const k of DISPLAY_FIELDS) {
    const v = r[k];
    if (v !== '' && v !== null && v !== undefined) out[k] = v;
  }
  if (r.costs) out.costs = { total: r.costs.total };
  if (r.revenue) {
    out.revenue = {
      clearanceFee: r.revenue.clearanceFee, totalInvoiced: r.revenue.totalInvoiced,
      ...(money ? { profit: r.revenue.profit } : {}),
    };
  }
  // النسبةُ والمرحلةُ التاليةُ محسوبتان بقاعدة المعاملة نفسِها (pipelineOf).
  const p = pipelineOf(r);
  out.pipeline = { percent: p.percent, done: p.done, total: p.total, next: p.next };
  // تاريخُ المعاملة الذي تُفلتَر به (راجع txDateOf)، وهل فُوترت — ولو قبل النظام.
  out.date = txDateOf(r);
  if (r.saleInvoiceNumber || p.steps.some((x) => x.key === 'invoiced' && x.done)) out.invoiced = true;
  if (awaitsTransportInvoice(r)) out.awaitingTransportInvoice = true;
  const billing = {};
  if (r.billing && r.billing.invoiceStatus) billing.invoiceStatus = r.billing.invoiceStatus;
  if (r.billing && r.billing.ourInvoiceNumber) billing.ourInvoiceNumber = r.billing.ourInvoiceNumber;
  if (Object.keys(billing).length) out.billing = billing;
  // «أُرجعت» علمٌ يُرفع لا حالةٌ تُنقل: الشاشةُ تقرأ `stageDone?.containersReturned`.
  if ((r.stageDone && r.stageDone.containersReturned) || (r.stagesDone || []).includes('containers_returned')) out.stageDone = { containersReturned: true };
  if (r.lastNote) out.lastNote = r.lastNote;
  out.notesCount = r.notesCount;
  // أرقامُ الوحدات سطرًا واحدًا: صندوقُ البحث في الويب يصفّي في المتصفّح، فلا
  // يجد حاويةً لم تصله. كانت «البحث بالحاوية لا يعمل».
  const nums = (r.containers || []).map((x) => String((x && x.containerNumber) || '').trim()).filter(Boolean);
  if (nums.length) out.containerNumbers = nums.join(' ');
  return out;
}

exports.getClearances = async (req, res) => {
  try {
    const q = req.query || {};
    const filter = {};
    // ── الفلاتر ─────────────────────────────────────────────────────────────
    // كانت أربعةً: الفرعُ والمرحلةُ والفترةُ وحالةُ الفوترة. وما يُسأل عنه في
    // العمل أكثر: عميلٌ بعينه، وكيلٌ بعينه، ميناءٌ، عملةٌ، بلدُ منشأ، مدًى
    // زمنيّ، ومَن مسؤولٌ عنها — وكلُّها أعمدةٌ موجودةٌ في الجدول تُقرأ ولا
    // يُفلتَر بها، فيُصدَّر الكلُّ ويُفلتَر في إكسل.
    const eq = {
      branch: 'branch', stage: 'stage', invoiceStatus: 'billing.invoiceStatus',
      port: 'port', currency: 'currency', invoiceType: 'invoiceType', city: 'city',
      countryOfOrigin: 'countryOfOrigin', assignedTo: 'assignedTo',
      customerParty: 'customerParty', agentParty: 'agentParty',
    };
    for (const [k, path] of Object.entries(eq)) if (q[k]) filter[path] = q[k];
    // ما سبق الحقلَ بلا نوعٍ وهو حاويات — فالحاوياتُ «ليست سيّارات» لا «تساوي حاويات».
    if (CARGO_TYPES.includes(q.cargoType)) filter.cargoType = q.cargoType === 'vehicles' ? 'vehicles' : { $ne: 'vehicles' };
    // ── والقادمةُ لا تُخلَط بالجارية ─────────────────────────────────────
    // كلُّ ما يُقرأ في هذه الشاشة معاملاتٌ وقعت: عددُها، وربحُها، وما تأخّر
    // منها. فصفٌّ لم يصل بعدُ يُفسد كلَّ عدٍّ فيها. ولها قائمتُها: `upcoming=true`.
    filter.upcoming = q.upcoming === 'true' ? true : { $ne: true };
    if (q.active === 'true') filter.cancelled = { $ne: true };
    if (q.cancelled === 'true') filter.cancelled = true;
    // الشهرُ يُقبل رقمًا أو «YYYY-MM»، وما لا يُفهَم يُهمَل — راجع utils/period.
    const yq = parseYear(q.year); if (yq) filter.periodYear = yq;
    const mq = parseMonth(q.month);
    if (mq.month) filter.periodMonth = mq.month;
    if (mq.year && !yq) filter.periodYear = mq.year;
    // مدًى زمنيٌّ بتوقيت الشركة — راجع utils/companyDay.
    if (q.from || q.to) {
      const { startOfDay, endOfDay } = require('../utils/companyDay');
      filter.createdAt = {};
      if (q.from) filter.createdAt.$gte = startOfDay(q.from);
      filter.createdAt.$lte = q.to ? endOfDay(q.to) : new Date();
    }
    // «لم تُفوتَر بعد» سؤالٌ ماليٌّ يُطرح كلَّ أسبوع، وكان يحتاج تصديرًا ليُجاب.
    if (q.uninvoiced === 'true') {
      filter.$and = [...(filter.$and || []), {
        $or: [{ 'billing.invoiceStatus': { $ne: 'invoiced' } }, { 'billing.invoiceStatus': { $exists: false } }],
      }];
    }

    // ── نصُّ البحث: `search` من الويب، و`q` من الهاتف (serverSearch) ────────
    const search = String(q.search || q.q || '').trim();
    // `ids=1`: المعرّفاتُ المطابقة وحدَها، بلا صفوف. تقرؤها الشاشاتُ التي تصفّي
    // في المتصفّح (القائمة، لوحةُ القسم، صفحاتُ الأطراف) فتبقى فلاترُها وعدّاداتُها
    // كما هي ويتّسع بحثُها لكلّ ما في المعاملة. ولا يُقيَّد بالقادمة ولا بغيرها:
    // كلُّ شاشةٍ تقاطعه مع ما عندها.
    if (q.ids === '1' || q.ids === 'true') {
      const hits = (await searchClearances(search)) || [];
      return res.json({ ids: hits.map((h) => h.id), parties: [...new Set(hits.flatMap((h) => h.parties))] });
    }

    const SKIP = new Set(['search', 'q', 'limit']);
    const ck = `customs:list:${JSON.stringify(Object.keys(q).sort().reduce((o, k) => (SKIP.has(k) ? o : (o[k] = q[k], o)), {}))}`;
    // نستبعد الحقول الثقيلة من القائمة — المرفقاتُ وحدَها قد تبلغ أربعين سطرًا
    // في المعاملة الواحدة، والقائمةُ لا تعرض منها شيئًا. تُحمَّل عند فتح
    // المعاملة فقط. يقلّل النقل بشكل كبير على Atlas المُقيَّد.
    let list = await cache.wrap(ck, 30000, async () => {
      const rows = await CustomsClearance.find(filter)
        .select(LIST_FIELDS).sort({ createdAt: -1 }).lean();
      // ── آخرُ ملاحظةٍ فقط تُرسَل ──────────────────────────────────────────
      // الجدولُ يعرض الأخيرةَ لا السجلَّ كلَّه، ونقلُ عشر ملاحظاتٍ لكلّ صفٍّ
      // على وصلةٍ مقيَّدة نقلٌ لا يُعرَض. والسجلُّ يُقرأ في المعاملة.
      return rows.map((r) => {
        const log = r.notesLog || [];
        const last = log.length ? log[log.length - 1] : null;
        const { notesLog, ...rest } = r;
        return { ...rest, lastNote: last ? { text: last.text, byName: last.byName, at: last.at } : null, notesCount: log.length };
      });
    });

    // ── والبحثُ بأيّ اسمٍ أو أيّ رقم ─────────────────────────────────────────
    // من الفهرس — راجع SEARCH_INDEX_FIELDS. ويُطبَّق قبل الإرسال، فالعددُ عددُ
    // ما طابق لا عددُ القائمة.
    if (search) {
      const hits = await searchClearances(search);
      if (hits) {
        const keep = new Set(hits.map((h) => h.id));
        list = list.filter((c) => keep.has(String(c._id)));
      }
    }

    const money = seesMoney(req);
    res.json({ clearances: list.map((r) => toWire(r, money)) });
  } catch (error) {
    console.error('getClearances error:', error);
    res.status(500).json({ message: 'Failed to load clearances' });
  }
};

/** قيمُ كلّ فلترٍ مع عددِ صفوفه — تُبنى من المجموعة لا تُكتب يدًا. */
exports.getFilterOptions = async (req, res) => {
  try {
    const hit = cache.get('customs:filters');
    if (hit !== undefined) return res.json(hit);
    const FIELDS = ['branch', 'stage', 'port', 'currency', 'invoiceType', 'city', 'countryOfOrigin', 'assignedTo'];
    const facet = {};
    FIELDS.forEach((f, i) => {
      facet[`f${i}`] = [{ $group: { _id: `$${f}`, count: { $sum: 1 } } }, { $sort: { count: -1 } }];
    });
    facet.invoiceStatus = [{ $group: { _id: '$billing.invoiceStatus', count: { $sum: 1 } } }, { $sort: { count: -1 } }];
    facet.years = [{ $group: { _id: '$periodYear', count: { $sum: 1 } } }, { $sort: { _id: -1 } }];
    const [r] = await CustomsClearance.aggregate([{ $facet: facet }]);
    const shape = (rows) => (rows || []).filter((x) => x._id != null && x._id !== '')
      .map((x) => ({ value: String(x._id), count: x.count }));
    const out = { options: {} };
    FIELDS.forEach((f, i) => { out.options[f] = shape(r[`f${i}`]); });
    out.options.invoiceStatus = shape(r.invoiceStatus);
    out.options.years = shape(r.years);
    const parties = await CustomsParty.find({ isActive: { $ne: false } }).select('kind name').sort({ name: 1 }).lean();
    out.options.customers = parties.filter((p) => p.kind === 'customer').map((p) => ({ value: String(p._id), label: p.name }));
    out.options.agents = parties.filter((p) => p.kind === 'agent').map((p) => ({ value: String(p._id), label: p.name }));
    cache.set('customs:filters', out, 5 * 60 * 1000);
    res.json(out);
  } catch (e) {
    console.error('customs getFilterOptions error:', e);
    res.status(500).json({ message: 'تعذّر تحميل الفلاتر' });
  }
};

exports.getClearance = async (req, res) => {
  try {
    const clearance = await CustomsClearance.findById(req.params.id).populate('customer', 'name');
    if (!clearance) return res.status(404).json({ message: 'Clearance not found' });
    // الوثيقةُ تخرج بلا ربحها (راجع toJSON في النموذج)، ومَن يحقّ له يأخذه هنا.
    const profit = PROFIT_ROLES.includes(req.user.role) ? Number(clearance.revenue && clearance.revenue.profit) || 0 : undefined;
    res.json({ clearance, ...(profit !== undefined ? { profit } : {}) });
  } catch (error) {
    // معرّف مش صالح = «مش موجود»، مش عطل سيرفر. رابط قديم أو مقطوع كان بيرجع
    // 500 وكأن السيستم واقع.
    if (error.name === 'CastError') return res.status(404).json({ message: 'Clearance not found' });
    res.status(500).json({ message: 'Failed to load clearance' });
  }
};

exports.createClearance = async (req, res) => {
  try {
    const data = pick(req.body, null);
    data.createdBy = req.user._id;
    await attachPartyFields(data);
    // أسعارُ عقد العميل تملأ الإيرادات من أوّل لحظة (وتبقى قابلةً للتعديل).
    if (data.customerParty) {
      const contract = await contractPricing.activeCustomerContract(data.customerParty).catch(() => null);
      if (contract) contractPricing.fillRevenue(data, {}, contract);
    }
    const clearance = await CustomsClearance.create(data);

    await logAudit({ user: req.user._id, action: 'create_customs_clearance', entity: 'CustomsClearance', entityId: clearance._id, changes: { after: { refNumber: clearance.refNumber } }, ipAddress: req.ip });
    try { emitToAll('customs:created', { clearance }); } catch (e) {}

    res.status(201).json({ clearance });
  } catch (error) {
    return sendMongooseError(res, error, error.message || 'Failed to create clearance');
  }
};

/**
 * حين يُختار العميلُ أو الوكيلُ من ملفّه، يُنسَخ اسمُه إلى المعاملة — والبريدُ
 * معه إن كان للوكيل بريد.
 *
 * الاسمُ يبقى مخزَّنًا نصًّا لأنّ التصديراتِ والتقاريرَ تقرؤه، والبريدُ كان
 * يُكتب في كلّ معاملةٍ من الذاكرة فيُخطئ حرفٌ فيُرسَل الطلبُ إلى لا أحد.
 */
async function attachPartyFields(data) {
  if (data.customerParty) {
    const p = await CustomsParty.findById(data.customerParty).select('name').lean();
    if (p) data.customerName = p.name;
  }
  if (data.agentParty) {
    const p = await CustomsParty.findById(data.agentParty).select('name email').lean();
    if (p) {
      data.shippingAgent = p.name;
      // لا يُمحى بريدٌ مكتوبٌ يدويًّا إن كان ملفُّ الوكيل بلا بريد.
      if (p.email) data.shippingAgentEmail = p.email;
    }
  }
}

exports.updateClearance = async (req, res) => {
  try {
    const existing = await CustomsClearance.findById(req.params.id).lean();
    if (!existing) return res.status(404).json({ message: 'Clearance not found' });
    // ── تطبيقٌ قديمٌ يغيّر المرحلةَ من هنا ───────────────────────────────────
    // المراحلُ صارت تُعلَّم من `PATCH /:id/stage` بقواعدها، و`stage` هنا لا
    // تُكتب. فنسخةٌ قديمةٌ من التطبيق كانت ستُجاب «تمّ» ولم يُكتب شيء — وذلك
    // أسوأُ من الرفض. فيُقال لها صراحةً. (شاشةُ الويب لا ترسل `stage` أصلًا.)
    if (req.body.stage !== undefined && req.body.stage !== existing.stage) {
      return res.status(400).json({ message: 'المراحلُ تُعلَّم من شاشتها الجديدة — حدِّث التطبيق إلى آخر نسخة.', code: 'STAGE_VIA_ENDPOINT' });
    }
    const data = pick(req.body, existing);
    data.lastModifiedBy = req.user._id;
    await attachPartyFields(data);
    // ── تغيّر العميلُ أو عددُ الحاويات؟ فأسعارُ العقد تتبعه ────────────────────
    // أجورُ التخليص للحاوية، فحاويةٌ زائدةٌ أجرةٌ زائدة. ولا يُكتب إلّا فيما بقي
    // على قيمة العقد — ما عدّله الموظّفُ بيده يبقى (راجع fillRevenue).
    const partyChanged = data.customerParty !== undefined && String(data.customerParty || '') !== String(existing.customerParty || '');
    const countChanged = data.containerCount !== undefined && Number(data.containerCount) !== Number(existing.containerCount || 0);
    if (partyChanged || countChanged) {
      const partyId = data.customerParty !== undefined ? data.customerParty : existing.customerParty;
      const contract = await contractPricing.activeCustomerContract(partyId).catch(() => null);
      if (contract && contractPricing.fillRevenue(data, existing, contract)) {
        const merged = { costs: { ...(existing.costs || {}), ...(data.costs || {}) }, revenue: data.revenue };
        recomputeTotals(merged);
        data.costs = merged.costs;
        data.revenue = merged.revenue;
      }
    }
    const clearance = await CustomsClearance.findByIdAndUpdate(req.params.id, data, { new: true, runValidators: true });
    if (!clearance) return res.status(404).json({ message: 'Clearance not found' });

    await logAudit({ user: req.user._id, action: 'update_customs_clearance', entity: 'CustomsClearance', entityId: clearance._id, changes: { after: { refNumber: clearance.refNumber, stage: clearance.stage } }, ipAddress: req.ip });
    try { emitToAll('customs:updated', { clearance }); } catch (e) {}

    res.json({ clearance });
  } catch (error) {
    return sendMongooseError(res, error, error.message || 'Failed to update clearance');
  }
};

/**
 * Dashboard metrics for /system/customs/analytics — mirrors the company's
 * "UI_AI_dashboard" sheet.
 *
 * Query: ?year=2026  or  ?from=YYYY-MM&to=YYYY-MM (inclusive, on periodYear/periodMonth).
 * Cancelled transactions are excluded from every figure.
 */
exports.getAnalytics = async (req, res) => {
  try {
    // الأرباحُ والتحليلاتُ للإدارة وحدَها — ولا يفتحها ختمُ قسمٍ ولا تأشيرةُ صفحة.
    if (!seesMoney(req)) return res.status(403).json({ message: 'تحليلاتُ القسم لمدير النظام ومدير القسم', code: 'CUSTOMS_ANALYTICS_MANAGERS' });
    const q = req.query || {};
    const { year, from, to } = q;
    // والقادمةُ خارجَ الأرقام: لم تقع بعدُ فلا إيرادَ لها ولا تكلفة.
    const filter = { cancelled: { $ne: true }, upcoming: { $ne: true } };
    if (year) filter.periodYear = Number(year);
    // ── التحليلاتُ تقبل ما تقبله القائمة ────────────────────────────────────
    // كانت تقبل السنةَ والمدى وحدَها، فمن أراد «ربحُنا مع هذا العميل في هذا
    // الميناء» صدّر وحسب بنفسه. والأسئلةُ التي تُطرح على الجدول هي التي تُطرح
    // على التحليل — فالفلاترُ واحدة.
    const eq = {
      branch: 'branch', stage: 'stage', port: 'port', currency: 'currency',
      invoiceType: 'invoiceType', city: 'city', countryOfOrigin: 'countryOfOrigin',
      customerParty: 'customerParty', agentParty: 'agentParty',
      invoiceStatus: 'billing.invoiceStatus',
    };
    for (const [k, path] of Object.entries(eq)) if (q[k]) filter[path] = q[k];
    // نوعُ المعاملة وحالتُها — يُسأل بهما كما يُسأل بالعميل والميناء.
    if (CARGO_TYPES.includes(q.cargoType)) filter.cargoType = q.cargoType === 'vehicles' ? 'vehicles' : { $ne: 'vehicles' };
    if (q.state === 'closed') filter.isCompleted = true;
    if (q.state === 'open') filter.isCompleted = { $ne: true };
    const mq2 = parseMonth(q.month);
    if (mq2.month) filter.periodMonth = mq2.month;
    if (mq2.year && !year) filter.periodYear = mq2.year;

    // ── ولا يُنقَل من الحقل إلّا ما يُجمَع ────────────────────────────────
    // كانت تُقرأ `costs` و`revenue` و`billing` كاملةً — وهي أثقلُ ثلاثةِ حقولٍ
    // في السجلّ (مئةٌ وستّةٌ وعشرون كيلوبايت من مئتين)، والحسابُ لا يمسّ منها
    // إلّا ثلاثةَ أرقامٍ وحالةَ الفوترة. والوصلةُ إلى العنقود هي الثمنُ كلُّه
    // لا الحساب — راجع dashboard-performance.
    //
    // ── وتُحفَظ دقيقةً ────────────────────────────────────────────────────
    // اللوحةُ تُقرأ ولا تُكتب، وتُفتح مع كلّ فتحةٍ للصفحة ومع كلّ تحديثٍ حيّ.
    // وكانت تُحسب من أوّلها في كلّ مرّة: ثلاثُ ثوانٍ ينتظرها كلُّ من يفتح.
    // والكتابةُ في القسم تمسح `customs:` فلا تُقرأ أرقامٌ سبقت التعديل.
    const ak = `customs:analytics:${JSON.stringify(q)}`;
    const hit = cache.get(ak);
    if (hit !== undefined) return res.json(hit);

    // والمدى يُصفّى في القاعدة أيضًا — لا تُنقَل سنتان ليُعرَض شهر. والتصفيةُ
    // في الذاكرة بعده تبقى كما هي: هي التي تحكم، وهذه تُخفّف الحمولةَ فقط.
    if (from || to) {
      const lo0 = from ? Number(String(from).slice(0, 4)) * 100 + Number(String(from).slice(5, 7) || 1) : 0;
      const hi0 = to ? Number(String(to).slice(0, 4)) * 100 + Number(String(to).slice(5, 7) || 12) : 999999;
      const pk = { $add: [{ $multiply: [{ $ifNull: ['$periodYear', 0] }, 100] }, { $ifNull: ['$periodMonth', 0] }] };
      filter.$expr = { $and: [{ $gte: [pk, lo0] }, { $lte: [pk, hi0] }] };
    }
    let list = await CustomsClearance.find(filter)
      .select('blNumber refNumber customerName shippingAgent carrierName port stage city branch containerCount periodMonth periodYear costs revenue billing.invoiceStatus '
        + 'cargoType isCompleted saleInvoiceNumber stagesDone transportRoute pipelineVersion stageDone.doInvoicePaid containers.route containers.stagesDone')
      .lean();

    // from/to are month keys (YYYY-MM); filter in JS so rows with no period survive
    // an unbounded request but are excluded from an explicitly bounded one.
    const key = (r) => (r.periodYear && r.periodMonth ? r.periodYear * 100 + r.periodMonth : null);
    if (from || to) {
      const lo = from ? Number(String(from).slice(0, 4)) * 100 + Number(String(from).slice(5, 7) || 1) : -Infinity;
      const hi = to ? Number(String(to).slice(0, 4)) * 100 + Number(String(to).slice(5, 7) || 12) : Infinity;
      list = list.filter((r) => { const k = key(r); return k !== null && k >= lo && k <= hi; });
    }

    const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
    const add = (bucket, r) => {
      bucket.count += 1;
      bucket.containers += num(r.containerCount);
      bucket.revenue += num(r.revenue && r.revenue.totalInvoiced);
      bucket.costs += num(r.costs && r.costs.total);
      bucket.clearanceFee += num(r.revenue && r.revenue.clearanceFee);
      if (r.branch === 'dammam') bucket.dammam += 1; else bucket.jeddah += 1;
      return bucket;
    };
    const blank = () => ({ count: 0, containers: 0, revenue: 0, costs: 0, clearanceFee: 0, jeddah: 0, dammam: 0 });
    const group = (rows, keyFn) => {
      const m = new Map();
      for (const r of rows) {
        const k = (keyFn(r) || '').toString().trim() || '—';
        if (!m.has(k)) m.set(k, { key: k, ...blank() });
        add(m.get(k), r);
      }
      return [...m.values()];
    };
    const round = (x) => Math.round(x * 100) / 100;
    const finish = (arr, totalContainers) => arr
      .map((b) => ({
        ...b,
        revenue: round(b.revenue),
        costs: round(b.costs),
        clearanceFee: round(b.clearanceFee),
        profit: round(b.revenue - b.costs),
        avgContainers: b.count ? round(b.containers / b.count) : 0,
        containerShare: totalContainers ? b.containers / totalContainers : 0,
      }))
      .sort((a, b) => b.containers - a.containers || b.count - a.count)
      .map((b, i) => ({ ...b, rank: i + 1 }));

    const totalContainers = list.reduce((a, r) => a + num(r.containerCount), 0);
    const totalRevenue = round(list.reduce((a, r) => a + num(r.revenue && r.revenue.totalInvoiced), 0));
    const totalCosts = round(list.reduce((a, r) => a + num(r.costs && r.costs.total), 0));
    const clearanceFees = round(list.reduce((a, r) => a + num(r.revenue && r.revenue.clearanceFee), 0));
    const invoiced = list.filter((r) => (r.billing && String(r.billing.invoiceStatus || '').trim()) || num(r.revenue && r.revenue.totalInvoiced) > 0).length;
    const months = new Set(list.filter((r) => key(r) !== null).map((r) => key(r)));

    const byMonth = group(list.filter((r) => key(r) !== null), (r) => `${r.periodYear}-${String(r.periodMonth).padStart(2, '0')}`)
      .map((b) => ({
        ...b,
        revenue: round(b.revenue),
        costs: round(b.costs),
        profit: round(b.revenue - b.costs),
        year: Number(b.key.slice(0, 4)),
        month: Number(b.key.slice(5, 7)),
      }))
      .sort((a, b) => (a.year - b.year) || (a.month - b.month));

    // ── أين يذهب المالُ ومن أين يأتي ────────────────────────────────────────
    // «التكلفة ٣ ملايين» لا تقول شيئًا للإدارة حتى تُفصَّل: أيُّ بندٍ يأكلها.
    // و«الربح» كذلك: أجورُ التخليص أم فرقُ النقل أم التخزين.
    const breakdown = (keys, of) => keys
      .map((key) => ({ key, amount: round(list.reduce((a, r) => a + num(of(r)[key]), 0)), deals: list.filter((r) => num(of(r)[key]) !== 0).length }))
      .filter((x) => x.amount !== 0).sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
    const costBreakdown = breakdown(COST_KEYS, (r) => r.costs || {});
    const marginBreakdown = breakdown(MARGIN_KEYS, (r) => r.revenue || {});
    const isInvoiced = (r) => !!r.saleInvoiceNumber || !!String((r.billing && r.billing.invoiceStatus) || '').trim()
      || pipelineOf(r).steps.some((x) => x.key === 'invoiced' && x.done);
    const sumRev = (rows) => round(rows.reduce((a, r) => a + num(r.revenue && r.revenue.totalInvoiced), 0));
    const openRows = list.filter((r) => !r.isCompleted);
    const notInvoicedRows = list.filter((r) => !isInvoiced(r));
    const byCust = finish(group(list, (r) => r.customerName), totalContainers).sort((a, b) => b.profit - a.profit);
    const profitAll = totalRevenue - totalCosts;
    const share = (n) => (profitAll > 0 ? byCust.slice(0, n).reduce((a, b) => a + Math.max(0, b.profit), 0) / profitAll : 0);

    const payload = {
      costBreakdown,
      marginBreakdown,
      byCargo: finish(group(list, (r) => (r.cargoType === 'vehicles' ? 'vehicles' : 'containers')), totalContainers),
      byCarrier: finish(group(list.filter((r) => (r.carrierName || '').trim()), (r) => r.carrierName), totalContainers),
      byState: finish(group(list, (r) => (r.isCompleted ? 'closed' : 'open')), totalContainers),
      insight: {
        open: openRows.length, closed: list.length - openRows.length,
        openValue: sumRev(openRows),
        notInvoiced: notInvoicedRows.length, notInvoicedValue: sumRev(notInvoicedRows),
        notInvoicedCosts: round(notInvoicedRows.reduce((a, r) => a + num(r.costs && r.costs.total), 0)),
        profitPerContainer: totalContainers ? round(profitAll / totalContainers) : 0,
        revenuePerContainer: totalContainers ? round(totalRevenue / totalContainers) : 0,
        costPerContainer: totalContainers ? round(totalCosts / totalContainers) : 0,
        avgProfit: list.length ? round(profitAll / list.length) : 0,
        losing: list.filter((r) => num(r.revenue && r.revenue.totalInvoiced) - num(r.costs && r.costs.total) < 0).length,
        // كم من الربح يصنعه أكبرُ عميلٍ وأكبرُ خمسة — تركّزٌ يُعرَف قبل أن يُفاجِئ.
        top1Share: share(1), top5Share: share(5),
      },
      totals: {
        clearances: list.length,
        containers: totalContainers,
        customers: new Set(list.map((r) => (r.customerName || '').trim()).filter(Boolean)).size,
        agents: new Set(list.map((r) => (r.shippingAgent || '').trim()).filter(Boolean)).size,
        invoiced: list.length - notInvoicedRows.length,
        notInvoiced: notInvoicedRows.length,
        avgContainersPerBl: list.length ? round(totalContainers / list.length) : 0,
        totalRevenue,
        clearanceFees,
        totalCosts,
        netProfit: round(totalRevenue - totalCosts),
        margin: totalRevenue ? (totalRevenue - totalCosts) / totalRevenue : 0,
        jeddah: list.filter((r) => r.branch !== 'dammam').length,
        dammam: list.filter((r) => r.branch === 'dammam').length,
        avgInvoice: list.length ? round(totalRevenue / list.length) : 0,
        monthsCovered: months.size,
        avgPerMonth: months.size ? round(list.length / months.size) : 0,
      },
      byCustomer: finish(group(list, (r) => r.customerName), totalContainers),
      byAgent: finish(group(list, (r) => r.shippingAgent), totalContainers),
      byCity: finish(group(list, (r) => r.city || (r.branch === 'dammam' ? 'الدمام' : 'جدة')), totalContainers),
      // أبعادٌ أخرى تُسأل ولم تكن تُجمَع: أين نعمل (الميناء)، وأين تتعثّر
      // المعاملاتُ (المرحلة)، وأيُّ فرعٍ يحمل أكثر.
      byPort: finish(group(list, (r) => r.port), totalContainers),
      byStage: finish(group(list, (r) => r.stage), totalContainers),
      byBranch: finish(group(list, (r) => (r.branch === 'dammam' ? 'الدمام' : 'جدة')), totalContainers),
      byMonth,
      // أعلى المعاملات ربحًا وأدناها — الرقمُ المجمَّع لا يقول أيَّ صفقةٍ صنعته.
      topDeals: list.map((r) => ({
        refNumber: r.refNumber, blNumber: r.blNumber, customerName: r.customerName,
        shippingAgent: r.shippingAgent, port: r.port, containers: num(r.containerCount),
        revenue: round(num(r.revenue && r.revenue.totalInvoiced)),
        costs: round(num(r.costs && r.costs.total)),
        profit: round(num(r.revenue && r.revenue.totalInvoiced) - num(r.costs && r.costs.total)),
      })).sort((a, b) => b.profit - a.profit).slice(0, 20),
      losingDeals: list.map((r) => ({
        refNumber: r.refNumber, blNumber: r.blNumber, customerName: r.customerName,
        revenue: round(num(r.revenue && r.revenue.totalInvoiced)),
        costs: round(num(r.costs && r.costs.total)),
        profit: round(num(r.revenue && r.revenue.totalInvoiced) - num(r.costs && r.costs.total)),
      })).filter((d) => d.profit < 0).sort((a, b) => a.profit - b.profit).slice(0, 20),
    };
    cache.set(ak, payload, 60000);
    res.json(payload);
  } catch (error) {
    res.status(500).json({ message: error.message || 'Failed to load customs analytics' });
  }
};

exports.deleteClearance = async (req, res) => {
  try {
    const clearance = await CustomsClearance.findByIdAndDelete(req.params.id);
    if (!clearance) return res.status(404).json({ message: 'Clearance not found' });

    await logAudit({ user: req.user._id, action: 'delete_customs_clearance', entity: 'CustomsClearance', entityId: clearance._id, changes: { before: { refNumber: clearance.refNumber } }, ipAddress: req.ip });
    try { emitToAll('customs:deleted', { clearanceId: clearance._id }); } catch (e) {}

    res.json({ message: 'Clearance deleted' });
  } catch (error) {
    res.status(500).json({ message: 'Failed to delete clearance' });
  }
};

// ---------------------------------------------------------------- المرفقات
//
// ورقُ المعاملة يُرفَع مع المعاملة نفسِها، ويُوسَم بالمرحلة التي أُنتج فيها،
// فيُقرأ في موضعه من دورة الإجراءات. الرفعُ base64 في نفس الطلب — لا multer،
// كما في بقيّة النظام.

const { saveUploadFile, deleteStoredFile } = require('../utils/fileStore');
const { STAGES } = require('../models/CustomsClearance');

exports.addAttachments = async (req, res) => {
  try {
    const clearance = await CustomsClearance.findById(req.params.id);
    if (!clearance) return res.status(404).json({ message: 'Clearance not found' });

    const incoming = Array.isArray(req.body.files) ? req.body.files : [req.body];
    if (!incoming.length) return res.status(400).json({ message: 'No files' });
    if ((clearance.attachments || []).length + incoming.length > 40) {
      return res.status(400).json({ message: 'لا يُرفَق أكثر من ٤٠ ملفًّا للمعاملة' });
    }

    const added = [];
    for (const f of incoming) {
      if (!f || !f.dataUrl) continue;
      let stored;
      try { stored = saveUploadFile(f.dataUrl, 'customs', f.fileName || ''); }
      catch (e) { return res.status(400).json({ message: e.message }); }
      const stage = STAGES.includes(String(f.stage || '')) ? String(f.stage) : '';
      const doc = {
        ...stored,
        title: String(f.title || '').trim().slice(0, 200),
        stage,
        uploadedBy: req.user._id,
        uploadedByName: req.user.name || '',
        uploadedAt: new Date(),
      };
      clearance.attachments.push(doc);
      added.push(doc);
    }
    if (!added.length) return res.status(400).json({ message: 'No files' });

    clearance.lastModifiedBy = req.user._id;
    await clearance.save();

    await logAudit({ user: req.user._id, action: 'add_customs_attachment', entity: 'CustomsClearance', entityId: clearance._id, changes: { after: { refNumber: clearance.refNumber, files: added.map((a) => a.fileName) } }, ipAddress: req.ip });
    try { emitToAll('customs:updated', { clearance }); } catch (e) {}

    res.status(201).json({ clearance });
  } catch (error) {
    return sendMongooseError(res, error, error.message || 'Failed to attach file');
  }
};

exports.updateAttachment = async (req, res) => {
  try {
    const clearance = await CustomsClearance.findById(req.params.id);
    if (!clearance) return res.status(404).json({ message: 'Clearance not found' });
    const att = clearance.attachments.id(req.params.attId);
    if (!att) return res.status(404).json({ message: 'Attachment not found' });

    if (req.body.title !== undefined) att.title = String(req.body.title).trim().slice(0, 200);
    if (req.body.stage !== undefined) att.stage = STAGES.includes(String(req.body.stage)) ? String(req.body.stage) : '';
    clearance.lastModifiedBy = req.user._id;
    await clearance.save();
    try { emitToAll('customs:updated', { clearance }); } catch (e) {}
    res.json({ clearance });
  } catch (error) {
    return sendMongooseError(res, error, error.message || 'Failed to update attachment');
  }
};

/**
 * ملفٌّ واحدٌ على القرص قد يُذكَر في أكثر من موضع (مرفقاتُ المعاملة، إدخالُ
 * مرحلةِ سداد، بندُ فاتورة). فلا يُمحى من القرص ما دام مذكورًا في أحدها.
 */
const fileStillUsed = (clearance, url) => !!url && (
  (clearance.attachments || []).some((a) => a.fileUrl === url)
  || (clearance.paymentStages || []).some((p) => p.fileUrl === url || (p.proofFiles || []).some((f) => f.fileUrl === url))
  || (clearance.saleItems || []).some((x) => x.fileUrl === url)
  || (clearance.transportInvoice && clearance.transportInvoice.fileUrl === url));
const dropIfUnused = (clearance, urls) => {
  for (const u of new Set(urls.filter(Boolean))) if (!fileStillUsed(clearance, u)) { try { deleteStoredFile(u); } catch (_) { /* */ } }
};

/**
 * حذفُ مرفق — ومعه ما يشير إليه.
 *
 * كان الملفُّ يُحذَف من «مرفقات المعاملة» ويبقى إدخالُه في «مراحل السداد»
 * يشير إلى ملفٍّ لم يعد موجودًا (والعكس: يُحذَف الإدخالُ وتبقى ورقتُه في
 * المرفقات). وهما وجهان لشيءٍ واحد: فحذفُ أحدهما حذفٌ للآخر. والشاشةُ تقول
 * ذلك قبل الضغط.
 */
exports.deleteAttachment = async (req, res) => {
  try {
    const clearance = await CustomsClearance.findById(req.params.id);
    if (!clearance) return res.status(404).json({ message: 'Clearance not found' });
    const att = clearance.attachments.id(req.params.attId);
    if (!att) return res.status(404).json({ message: 'Attachment not found' });

    const url = att.fileUrl;
    const name = att.title || att.fileName;
    att.deleteOne();
    // وكلُّ ذكرٍ آخرَ للملفّ نفسِه في المرفقات.
    for (const other of clearance.attachments.filter((a) => a.fileUrl === url)) other.deleteOne();
    const removedStages = [];
    for (const p of [...(clearance.paymentStages || [])]) {
      if (p.fileUrl === url) { removedStages.push(p.label || p.key); p.deleteOne(); continue; }
      if ((p.proofFiles || []).some((f) => f.fileUrl === url)) p.proofFiles = p.proofFiles.filter((f) => f.fileUrl !== url);
    }
    // بندُ الفاتورة يبقى بسعره — يُرفَع عنه مرفقُه وحدَه.
    for (const x of clearance.saleItems || []) {
      if (x.fileUrl === url) Object.assign(x, { fileUrl: '', fileName: '', mimeType: '', size: 0 });
    }
    if (clearance.transportInvoice && clearance.transportInvoice.fileUrl === url) {
      Object.assign(clearance.transportInvoice, { fileUrl: '', fileName: '', mimeType: '', size: 0, receivedAt: null, receivedBy: null, receivedByName: '' });
    }
    clearance.lastModifiedBy = req.user._id;
    await clearance.save();
    dropIfUnused(clearance, [url]);
    cache.clear('customs:');

    await logAudit({ user: req.user._id, action: 'delete_customs_attachment', entity: 'CustomsClearance', entityId: clearance._id, changes: { before: { fileName: name, paymentStages: removedStages } }, ipAddress: req.ip });
    try { emitToAll('customs:updated', { clearance }); } catch (e) {}

    res.json({ clearance, removedStages });
  } catch (error) {
    res.status(500).json({ message: error.message || 'Failed to delete attachment' });
  }
};

// ═══════════════════════════════════════════════════════════════════════════
//  أطرافُ التخليص — العملاءُ ووكلاءُ الشحن
// ═══════════════════════════════════════════════════════════════════════════
const CustomsParty = require('../models/CustomsParty');
const CustomsContract = require('../models/CustomsContract');
const { fold: foldName } = require('../models/CustomsParty');

/**
 * بحثٌ لا يبالي بالمسافات ولا بالشرطات ولا بفروق الرسم العربيّ — كما في بقيّة
 * النظام. «050-123 4567» و«0501234567» رقمٌ واحد، و«أ» تجد «ا» والعكس.
 */
const partyRx = (s) => {
  const bare = searchKey(s);
  if (!bare) return null;
  const cls = { ا: '[اأإآٱ]', ه: '[هة]', ي: '[يىئ]', و: '[وؤ]' };
  const parts = [...bare].map((ch) => cls[ch] || ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(parts.join('[\\s\\-_./\\\\,:#ـ]*'), 'i');
};

// ── ثلاثةُ أدوار، وحقلٌ في المعاملة لكلٍّ ──────────────────────────────────
// العميلُ صاحبُ البضاعة، والوكيلُ يخلّصها، والناقلُ ينقلها. راجع CustomsParty.
const PARTY_KINDS = ['customer', 'agent', 'carrier'];
const partyField = (kind) => (kind === 'agent' ? 'agentParty' : kind === 'carrier' ? 'carrierParty' : 'customerParty');

exports.listParties = async (req, res) => {
  try {
    // `kind=all` — الأطرافُ كلُّها بأدوارها، لاختيار صاحب العقد من قائمةٍ واحدة.
    const all = req.query.kind === 'all';
    const kind = PARTY_KINDS.includes(req.query.kind) ? req.query.kind : 'customer';
    const filter = all ? {} : { kind };
    if (req.query.active !== 'all') filter.isActive = { $ne: false };
    const q = String(req.query.q || '').trim();
    if (q) {
      const rx = partyRx(q);
      // يُبحَث بالاسم وبكلّ رقمٍ في الملفّ — «أيّ اسمٍ أو أيّ رقم».
      filter.$or = [{ name: rx }, { email: rx }, { phone: rx }, { contactPerson: rx },
        { commercialRegister: rx }, { taxNumber: rx }, { city: rx }];
      // `deep=1` (صفحةُ الأطراف): ويُوجَد الطرفُ بما في معاملاته كذلك — رقمِ حاويةٍ
      // أو بوليصةٍ أو بيان. ولا يُطلب في قوائم الاختيار: هناك يُكتب الاسم.
      if (req.query.deep === '1') {
        const hits = (await searchClearances(q)) || [];
        const ids = [...new Set(hits.flatMap((h) => h.parties))];
        if (ids.length) filter.$or.push({ _id: { $in: ids } });
      }
    }
    const parties = await CustomsParty.find(filter).sort({ name: 1 }).lean();

    // مع كلّ طرفٍ حجمُه: القائمةُ بلا أرقامٍ أسماءٌ لا تُقارَن.
    const ids = parties.map((p) => p._id);
    if (all) return res.json({ parties });          // القائمةُ للاختيار، بلا أرقامٍ تُحسب
    const field = partyField(kind);
    const agg = await CustomsClearance.aggregate([
      { $match: { [field]: { $in: ids }, cancelled: { $ne: true } } },
      { $group: {
        _id: `$${field}`,
        deals: { $sum: 1 },
        revenue: { $sum: { $ifNull: ['$revenue.totalInvoiced', 0] } },
        profit: { $sum: { $ifNull: ['$revenue.profit', 0] } },
        containers: { $sum: { $ifNull: ['$containerCount', 0] } },
        last: { $max: '$createdAt' },
      } },
    ]);
    const stats = new Map(agg.map((a) => [String(a._id), a]));
    const money = seesMoney(req);
    res.json({
      // الربحُ للإدارة وحدَها — راجع MONEY_ROLES.
      money,
      parties: parties.map((p) => {
        const s = stats.get(String(p._id)) || {};
        return {
          ...p, deals: s.deals || 0, revenue: Math.round(s.revenue || 0),
          ...(money ? { profit: Math.round(s.profit || 0) } : {}),
          containers: s.containers || 0, lastDealAt: s.last || null,
        };
      }),
    });
  } catch (e) {
    console.error('listParties error:', e);
    res.status(500).json({ message: 'تعذّر تحميل القائمة' });
  }
};

exports.createParty = async (req, res) => {
  try {
    const kind = PARTY_KINDS.includes(req.body.kind) ? req.body.kind : 'customer';
    const name = String(req.body.name || '').trim();
    if (!name) return res.status(400).json({ message: 'الاسم مطلوب' });
    const exists = await CustomsParty.findOne({ kind, nameKey: foldName(name) }).lean();
    if (exists) return res.status(409).json({ message: 'موجودٌ بالاسم نفسِه', party: exists });
    const party = await CustomsParty.create({ ...req.body, kind, name, createdBy: req.user._id });
    cache.clear('customs:');
    res.status(201).json({ party });
  } catch (e) {
    return sendMongooseError(res, e, e.message || 'تعذّر الحفظ');
  }
};

exports.updateParty = async (req, res) => {
  try {
    // المرفقاتُ لها نقاطُها — لا تُكتب من هنا فوق ما رُفع.
    const { kind, _id, __v, attachments, ...body } = req.body;
    const party = await CustomsParty.findByIdAndUpdate(req.params.id, { $set: body }, { new: true });
    if (!party) return res.status(404).json({ message: 'غير موجود' });
    // الاسمُ مخزَّنٌ نصًّا في المعاملات أيضًا (تقرؤه التصديرات) — يُحدَّث معه
    // وإلّا عُرض الاسمُ القديم في الجدول والجديدُ في الملفّ.
    const field = party.kind === 'agent' ? 'shippingAgent' : 'customerName';
    const link = party.kind === 'agent' ? 'agentParty' : 'customerParty';
    await CustomsClearance.updateMany({ [link]: party._id }, { $set: { [field]: party.name } });
    cache.clear('customs:');
    res.json({ party });
  } catch (e) {
    return sendMongooseError(res, e, e.message || 'تعذّر الحفظ');
  }
};

exports.deleteParty = async (req, res) => {
  try {
    const party = await CustomsParty.findById(req.params.id);
    if (!party) return res.status(404).json({ message: 'غير موجود' });
    const link = party.kind === 'agent' ? 'agentParty' : 'customerParty';
    const used = await CustomsClearance.countDocuments({ [link]: party._id });
    // لا يُحذَف مَن له تاريخ: حذفُه يقطع معاملاتِه عن ملفّها. يُعطَّل فيختفي من
    // القوائم ويبقى تاريخُه مقروءًا.
    if (used > 0) {
      party.isActive = false;
      await party.save();
      cache.clear('customs:');
      return res.json({ deactivated: true, used, message: `له ${used} معاملة — عُطِّل ولم يُحذَف كي لا ينقطع تاريخُه.` });
    }
    await party.deleteOne();
    cache.clear('customs:');
    res.json({ deleted: true });
  } catch (e) {
    res.status(500).json({ message: e.message || 'تعذّر الحذف' });
  }
};

/** ملفُّ طرفٍ واحد: بياناتُه، وأرقامُه، وكلُّ معاملاته. */
exports.getPartyProfile = async (req, res) => {
  try {
    const party = await CustomsParty.findById(req.params.id).lean();
    if (!party) return res.status(404).json({ message: 'غير موجود' });
    const field = partyField(party.kind);

    const deals = await CustomsClearance.find({ [field]: party._id })
      .select('-documents -attachments -containers -paymentStages -stageLog -saleItems').sort({ createdAt: -1 }).lean();
    const money = seesMoney(req);

    const live = deals.filter((d) => !d.cancelled);
    const sum = (f) => Math.round(live.reduce((t, d) => t + (Number(f(d)) || 0), 0));
    const revenue = sum((d) => d.revenue?.totalInvoiced);
    const profit = sum((d) => d.revenue?.profit);
    const cost = sum((d) => d.costs?.total);

    // بالشهر — ليُقرأ النموّ لا المجموعُ وحدَه.
    const byMonth = {};
    live.forEach((d) => {
      const k = d.periodYear && d.periodMonth
        ? `${d.periodYear}-${String(d.periodMonth).padStart(2, '0')}`
        : (d.createdAt ? new Date(d.createdAt).toISOString().slice(0, 7) : '—');
      if (!byMonth[k]) byMonth[k] = { key: k, deals: 0, revenue: 0, profit: 0, containers: 0 };
      byMonth[k].deals += 1;
      byMonth[k].revenue += Number(d.revenue?.totalInvoiced) || 0;
      byMonth[k].profit += Number(d.revenue?.profit) || 0;
      byMonth[k].containers += Number(d.containerCount) || 0;
    });

    const tally = (get) => {
      const m = new Map();
      live.forEach((d) => { const v = String(get(d) || '—'); m.set(v, (m.get(v) || 0) + 1); });
      return [...m.entries()].map(([name, n]) => ({ name, n })).sort((a, b) => b.n - a.n).slice(0, 12);
    };

    res.json({
      party,
      money,
      totals: {
        deals: live.length,
        cancelled: deals.length - live.length,
        containers: sum((d) => d.containerCount),
        weight: sum((d) => d.totalWeight),
        revenue, cost,
        ...(money ? {
          profit,
          margin: revenue ? Math.round((profit / revenue) * 1000) / 10 : 0,
          avgProfit: live.length ? Math.round(profit / live.length) : 0,
        } : {}),
        firstDealAt: deals.length ? deals[deals.length - 1].createdAt : null,
        lastDealAt: deals.length ? deals[0].createdAt : null,
        // ما لم يُفوتَر بعد — أوّلُ ما يُسأل عنه في ملفّ عميل.
        uninvoiced: live.filter((d) => (d.billing?.invoiceStatus || 'not_invoiced') !== 'invoiced').length,
      },
      byMonth: Object.values(byMonth).sort((a, b) => a.key.localeCompare(b.key))
        .map((b) => ({ ...b, revenue: Math.round(b.revenue), profit: money ? Math.round(b.profit) : undefined })),
      byStage: tally((d) => d.stage),
      byPort: tally((d) => d.port),
      byCounterparty: tally((d) => (party.kind === 'customer' ? d.shippingAgent : d.customerName)),
      // عقودُنا معه — تُقرأ في ملفّه لا في شاشةٍ أخرى. راجع CustomsContract.
      contracts: await CustomsContract.find({ party: party._id }).sort({ createdAt: -1 }).lean(),
      deals: deals.map((d) => {
        const p = pipelineOf(d);
        const out = { ...d, pipeline: { percent: p.percent, next: p.next } };
        if (!money && out.revenue) out.revenue = { ...out.revenue, profit: undefined, transportNet: undefined };
        return out;
      }),
    });
  } catch (e) {
    console.error('getPartyProfile error:', e);
    res.status(500).json({ message: 'تعذّر تحميل الملفّ' });
  }
};

// ═══════════════════════════════════════════════════════════════════════════
//  إعداداتُ القسم · المعاملاتُ القادمة · طلباتُ الصرف
// ═══════════════════════════════════════════════════════════════════════════

const CustomsSettings = require('../models/CustomsSettings');

/** إعداداتُ القسم — رقمُ أيّام التنبيه اليوم. */
exports.getSettings = async (req, res) => {
  try {
    res.json({ settings: await CustomsSettings.get() });
  } catch (e) {
    res.status(500).json({ message: 'تعذّر تحميل الإعدادات' });
  }
};

exports.updateSettings = async (req, res) => {
  try {
    const days = Number(req.body.upcomingAlertDays);
    if (!Number.isFinite(days) || days < 0 || days > 60) {
      return res.status(400).json({ message: 'عدد الأيّام بين صفر وستّين' });
    }
    const who = [req.user.firstName, req.user.lastName].filter(Boolean).join(' ') || '';
    const settings = await CustomsSettings.findOneAndUpdate(
      { key: 'customs' },
      { $set: { upcomingAlertDays: Math.round(days), updatedBy: req.user._id, updatedByName: who } },
      { new: true, upsert: true },
    ).lean();
    try { cache.clear('customs:'); } catch (_) { /* */ }
    res.json({ settings });
  } catch (e) {
    res.status(500).json({ message: 'تعذّر حفظ الإعدادات' });
  }
};

/**
 * ── شارةُ المعاملات القادمة ────────────────────────────────────────────────
 * عددُ ما اقترب موعدُه — والمدّةُ من إعدادات القسم لا من رقمٍ في الشيفرة، فمن
 * غيّرها إلى ثلاثة أيّامٍ رأى أثرَها في النداء التالي بلا نشر.
 *
 * وما فات موعدُه يبقى في العدّ: معاملةٌ حان وقتُها ولم تُحوَّل هي أحقُّ بالتنبيه
 * من معاملةٍ بعد يومين.
 */
exports.upcomingAlerts = async (req, res) => {
  try {
    const { upcomingAlertDays } = await CustomsSettings.get();
    const days = Number.isFinite(Number(upcomingAlertDays)) ? Number(upcomingAlertDays) : 2;
    // ── اليومُ بتوقيت الشركة لا بتوقيت الخادم ────────────────────────────
    // `todayKey` تردّ «YYYY-MM-DD» بالرياض، وهو نفسُ شكلِ `expectedDate`
    // المخزَّن — فالمقارنةُ نصّيّةٌ مباشرةٌ بلا تحويلِ مناطق. راجع
    // utils/companyDay (و`startOfDay` تأخذ مفتاحَ يومٍ لا كائنَ تاريخ).
    const { todayKey, DAY_MS, startOfDay } = require('../utils/companyDay');
    const today = todayKey();
    const until = new Date(startOfDay(today).getTime() + days * DAY_MS)
      .toISOString().slice(0, 10);

    const rows = await CustomsClearance.find({
      upcoming: true,
      cancelled: { $ne: true },
      expectedDate: { $gt: '', $lte: until },
    }).select('refNumber blNumber customerName shippingAgent port expectedDate containerCount branch')
      .sort({ expectedDate: 1 }).lean();

    // ── والقادمةُ كلُّها في النافذة نفسِها ────────────────────────────────
    // صفحةُ «المعاملات القادمة» رُفعت بطلب القسم: النافذةُ تكفي. فتحمل كلَّ
    // قادمةٍ — لا ما اقترب وحدَه — ومع كلٍّ منها كم بقي على موعدها وأوراقُها
    // الخمس، فتُعلَّم الأوراقُ ويُعدَّل التاريخُ من النافذة بلا فتح المعاملة.
    const all = await CustomsClearance.find({ upcoming: true, cancelled: { $ne: true } })
      .select('refNumber blNumber customerName shippingAgent expectedDate containerCount branch documents')
      .sort({ expectedDate: 1 }).lean();
    const t0 = startOfDay(today).getTime();
    const daysLeft = (d) => (d ? Math.round((startOfDay(d).getTime() - t0) / DAY_MS) : null);

    res.json({
      days,
      count: rows.length,
      today,
      // وما فات موعدُه أحقُّ بالتنبيه ممّا لم يحِن — فيُعلَّم.
      items: rows.map((r) => ({ ...r, overdue: r.expectedDate < today })),
      upcoming: all.map((r) => ({
        ...r,
        daysLeft: daysLeft(r.expectedDate),
        overdue: !!r.expectedDate && r.expectedDate < today,
        dueSoon: !!r.expectedDate && r.expectedDate <= until,
      })),
      total: all.length,
    });
  } catch (e) {
    console.error('customs upcomingAlerts:', e);
    res.status(500).json({ message: 'تعذّر قراءة المعاملات القادمة' });
  }
};

/**
 * تحويلُ معاملةٍ قادمةٍ إلى جارية — هي هي، غيّر أنّها وقعت.
 *
 * ولا تُنشأ من جديد: كلُّ ما كُتب فيها (العميلُ والوكيلُ والميناءُ والحاويات)
 * كُتب مرّةً — وإعادةُ كتابته بابُ خطأٍ ونسخةٌ ثانية.
 */
exports.activateClearance = async (req, res) => {
  try {
    const clearance = await CustomsClearance.findById(req.params.id);
    if (!clearance) return res.status(404).json({ message: 'Clearance not found' });
    if (!clearance.upcoming) return res.json({ clearance });
    const who = [req.user.firstName, req.user.lastName].filter(Boolean).join(' ') || '';
    clearance.upcoming = false;
    clearance.activatedAt = new Date();
    clearance.activatedBy = req.user._id;
    clearance.activatedByName = who;
    await clearance.save();
    try { cache.clear('customs:'); } catch (_) { /* */ }
    try { emitToAll('customs:updated', { clearance }); } catch (_) { /* */ }
    await logAudit({
      user: req.user._id, action: 'update_customs_clearance', entity: 'CustomsClearance',
      entityId: clearance._id, changes: { after: { upcoming: false } }, ipAddress: req.ip,
    });
    res.json({ clearance });
  } catch (e) {
    res.status(500).json({ message: 'تعذّر تحويل المعاملة' });
  }
};

/**
 * ── طلباتُ الصرف كما تراها الإدارةُ الماليّة ───────────────────────────────
 * مدخلاتُ مراحل السداد في كلّ المعاملات، مسطَّحةً في قائمةٍ واحدة: كلُّ سطرٍ
 * يقول أيَّ معاملةٍ وأيَّ مرحلةٍ وكم ومرفقَه — فيُقرأ العملُ كلُّه في شاشةٍ
 * واحدةٍ بدل فتح المعاملات واحدةً واحدة.
 */
/**
 * ── والعدُّ والتصفيةُ في القاعدة لا هنا ──────────────────────────────────────
 * كانت تُحمَّل المعاملاتُ كلُّها بمراحلها كلّها (١٤٠٠ إدخالٍ، ميجابايت) في كلّ
 * فتحٍ وكلّ نقرةِ تبويبٍ وبعد كلّ قرار — سبعُ ثوانٍ تنتظرها الشاشة، ولا يُعرَض
 * منها إلّا عشرات. فصار التجميعُ في القاعدة: العدّاداتُ في مرور، والصفحةُ
 * المعروضةُ وحدَها في مرور، ولا يعبر الشبكةَ إلّا ما يُقرأ.
 *
 * ── والسجلُّ المنقول ليس دفعًا ─────────────────────────────────────────────
 * الاستيرادُ حوّل كلَّ «تم» في الماستر إلى إدخالٍ «مدفوع» بلا مبلغ (سجلّ سابق)
 * — ليُرى تاريخُ المعاملة في شاشتها. لكنّه ليس قرارًا من الماليّة، وعدُّه مع
 * المدفوع يجعل «مدفوعة: ١٤٠٣» رقمًا لا يعني شيئًا. فيُعدّ وحدَه ولا يُعرَض إلّا
 * إن طُلب.
 */
const LEGACY_DECIDER = 'سجلّ سابق';

exports.listPaymentRequests = async (req, res) => {
  try {
    const status = ['pending', 'paid', 'returned', 'rejected', 'all'].includes(String(req.query.status))
      ? String(req.query.status) : 'pending';
    const legacy = String(req.query.legacy || '') === '1';
    const q = String(req.query.search || '').trim().slice(0, 80);
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
    const key = `customs:payreq:${status}:${legacy ? 1 : 0}:${q}:${page}:${limit}`;

    const body = await cache.wrap(key, 30000, async () => {
      const rx = q ? new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') : null;
      const rowMatch = {
        ...(status !== 'all' ? { st: status } : {}),
        ...(legacy ? {} : { legacy: false }),
        ...(rx ? { $or: [
          { refNumber: rx }, { blNumber: rx }, { customerName: rx },
          { 'paymentStages.label': rx }, { 'paymentStages.addedByName': rx },
        ] } : {}),
      };
      const [agg] = await CustomsClearance.aggregate([
        { $match: { cancelled: { $ne: true }, 'paymentStages.0': { $exists: true } } },
        { $project: { refNumber: 1, blNumber: 1, customerName: 1, shippingAgent: 1, port: 1, branch: 1, paymentStages: 1 } },
        { $unwind: '$paymentStages' },
        { $addFields: {
          st: { $ifNull: ['$paymentStages.payStatus', 'pending'] },
          legacy: { $eq: ['$paymentStages.decidedByName', LEGACY_DECIDER] },
        } },
        { $facet: {
          counts: [
            { $group: {
              _id: { st: '$st', legacy: '$legacy' },
              n: { $sum: 1 },
              amount: { $sum: { $ifNull: ['$paymentStages.amount', 0] } },
            } },
          ],
          total: [{ $match: rowMatch }, { $count: 'n' }],
          page: [
            { $match: rowMatch },
            { $sort: { 'paymentStages.addedAt': -1, _id: -1 } },
            { $skip: (page - 1) * limit },
            { $limit: limit },
          ],
        } },
      ]);

      const counts = { pending: 0, paid: 0, returned: 0, rejected: 0, legacy: 0, amountPending: 0, amountPaid: 0 };
      for (const c of agg?.counts || []) {
        if (c._id.legacy) { counts.legacy += c.n; continue; }
        if (counts[c._id.st] !== undefined) counts[c._id.st] += c.n;
        if (c._id.st === 'pending') counts.amountPending += c.amount;
        if (c._id.st === 'paid') counts.amountPaid += c.amount;
      }
      counts.amountPending = Math.round(counts.amountPending * 100) / 100;
      counts.amountPaid = Math.round(counts.amountPaid * 100) / 100;

      const total = agg?.total?.[0]?.n || 0;
      const requests = (agg?.page || []).map((c) => {
        const e = c.paymentStages;
        return {
          clearanceId: String(c._id),
          refNumber: c.refNumber,
          blNumber: c.blNumber,
          customerName: c.customerName,
          shippingAgent: c.shippingAgent,
          port: c.port,
          branch: c.branch,
          entryId: String(e._id),
          key: e.key,
          label: e.label,
          date: e.date,
          amount: e.amount,
          note: e.note,
          fileUrl: e.fileUrl,
          fileName: e.fileName,
          addedByName: e.addedByName,
          addedAt: e.addedAt,
          payStatus: c.st,
          legacy: c.legacy,
          decisionNote: e.decisionNote || '',
          decidedByName: e.decidedByName || '',
          decidedAt: e.decidedAt || null,
          proofFiles: e.proofFiles || [],
        };
      });
      return { requests, counts, total, page, pages: Math.max(1, Math.ceil(total / limit)) };
    });
    res.json(body);
  } catch (e) {
    console.error('customs listPaymentRequests:', e);
    res.status(500).json({ message: 'تعذّر تحميل طلبات الصرف' });
  }
};

/**
 * قرارُ الإدارة الماليّة على طلبِ صرف.
 *
 * ثلاثةُ أجوبةٍ لا واحد: دُفع (ومعه إثباتٌ اختياريّ)، أو يُعاد لتصحيحٍ (ومعه
 * سببُه)، أو يُرفَض. والسببُ اختياريٌّ في الحالتين لأنّه قد يُقال مشافهةً —
 * لكنّه يُحفَظ حيث يُقرأ: بجانب الإدخال نفسِه في شاشة التخليص، لا في بريد.
 */
exports.decidePaymentStage = async (req, res) => {
  try {
    const decision = String(req.body.decision || '').trim();
    if (!['paid', 'returned', 'rejected'].includes(decision)) {
      return res.status(400).json({ message: 'قرارٌ غير معروف' });
    }
    const clearance = await CustomsClearance.findById(req.params.id);
    if (!clearance) return res.status(404).json({ message: 'Clearance not found' });
    const entry = (clearance.paymentStages || []).id(req.params.entryId);
    if (!entry) return res.status(404).json({ message: 'الإدخال غير موجود' });

    const who = [req.user.firstName, req.user.lastName].filter(Boolean).join(' ') || '';
    const files = Array.isArray(req.body.files) ? req.body.files.slice(0, 10) : [];
    const stored = [];
    for (const f of files) {
      if (!f || !f.dataUrl) continue;
      try { stored.push(saveUploadFile(f.dataUrl, 'customs', f.fileName || '')); }
      catch (e) { return res.status(400).json({ message: e.message }); }
    }

    const wasPaid = entry.payStatus === 'paid';
    entry.payStatus = decision;
    entry.decisionNote = String(req.body.note || '').trim().slice(0, 500);
    entry.decidedBy = req.user._id;
    entry.decidedByName = who;
    entry.decidedAt = new Date();
    if (stored.length) entry.proofFiles = [...(entry.proofFiles || []), ...stored];

    // «تمّ الدفع» يكتب المبلغَ في بنده من التكاليف — راجع STAGE_COST.
    if (STAGE_COST[entry.key]) applyPaidCosts(clearance, [entry.key], wasPaid || decision === 'paid');

    // وإثباتُ الدفع يُوجَد مع ورق المعاملة كذلك — حيث يبحث عنه من لا يعرف
    // من أيّ مرحلةٍ جاء (نفسُ قاعدة مرفق الإدخال).
    for (const f of stored) {
      clearance.attachments.push({
        ...f, title: `إثبات دفع · ${entry.label || entry.key}`, stage: '',
        uploadedBy: req.user._id, uploadedByName: who, uploadedAt: new Date(),
      });
    }

    await clearance.save();
    try { cache.clear('customs:'); cache.clear('finance:'); } catch (_) { /* */ }
    try { emitToAll('customs:updated', { clearance }); } catch (_) { /* */ }

    // ── والجوابُ قبل الذيول ────────────────────────────────────────────────
    // الإشعارُ والتدقيقُ نداءان إلى القاعدة (٩٠ مللي ثانيةٍ لكلٍّ منهما من
    // الخادم) لا ينتظرهما المحاسبُ في شيء. فيُردّ عليه بما قرّر، ويكتملان بعد.
    res.json({ ok: true, clearanceId: String(clearance._id), entryId: String(entry._id), payStatus: decision });

    // ومن طلب الصرف يُخبَر بما صار إليه طلبُه — لا يفتح الشاشة ليعرف.
    try {
      const { createNotification } = require('../services/notificationService');
      const label = { paid: 'تمّ الدفع', returned: 'أُعيد للتصحيح', rejected: 'رُفض' }[decision];
      if (entry.addedBy && String(entry.addedBy) !== String(req.user._id)) {
        await createNotification({
          recipient: entry.addedBy,
          type: 'status_changed',
          title: `طلب صرف: ${label}`,
          message: `${clearance.refNumber || ''} · ${entry.label || entry.key}${entry.decisionNote ? ` — ${entry.decisionNote}` : ''}`,
          relatedEntity: 'CustomsClearance',
          relatedEntityId: clearance._id,
        });
      }
    } catch (_) { /* */ }

    await logAudit({
      user: req.user._id, action: 'update_customs_clearance', entity: 'CustomsClearance',
      entityId: clearance._id, changes: { after: { paymentDecision: decision, entry: String(entry._id) } }, ipAddress: req.ip,
    }).catch(() => { /* */ });
  } catch (e) {
    console.error('customs decidePaymentStage:', e);
    if (res.headersSent) return;
    res.status(500).json({ message: 'تعذّر تسجيل القرار' });
  }
};

// ═══════════════════════════════════════════════════════════════════════════
//  مراحلُ السداد — إدخالٌ بتاريخه ومرفقه، يتكرّر
// ═══════════════════════════════════════════════════════════════════════════
/**
 * المرحلةُ التي لا تُقفَل المعاملةُ بدونها. مفتاحُها يُقرأ في الشيفرة، واسمُها
 * يُعدَّل من إعدادات القسم — راجع `customs_payment_stage` في lookupTypes.
 */
const REQUIRED_STAGE_KEY = 'transportInvoice';

/** المراحلُ المسموحة كما هي في إعدادات القسم الآن. */
const allowedStages = async () => {
  const Lookup = require('../models/Lookup');
  const rows = await Lookup.find({ type: 'customs_payment_stage', deleted: { $ne: true } })
    .sort({ order: 1 }).lean();
  return rows;
};

/**
 * إضافةُ إدخالِ مرحلة — تاريخٌ ومرفقٌ وربّما مبلغ.
 *
 * والمرفقُ يُكتب في مكانين: في الإدخال ليُقرأ في موضعه من المرحلة، وفي
 * `attachments` ليُوجَد مع بقيّة ورق المعاملة حيث يبحث عنه من لا يعرف من أيّ
 * مرحلةٍ جاء. وهو ملفٌّ واحدٌ على القرص، مذكورٌ مرّتين — لا نسختان.
 */
exports.addPaymentStage = async (req, res) => {
  try {
    const clearance = await CustomsClearance.findById(req.params.id);
    if (!clearance) return res.status(404).json({ message: 'Clearance not found' });

    const stages = await allowedStages();
    const key = String(req.body.key || '').trim();
    const def = stages.find((s) => s.key === key);
    if (!def) return res.status(400).json({ message: 'مرحلة غير معروفة — أضِفها من إعدادات القسم' });
    if ((clearance.paymentStages || []).length >= 60) {
      return res.status(400).json({ message: 'بلغت المعاملةُ حدَّ إدخالات المراحل' });
    }

    const date = String(req.body.date || '').trim();
    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ message: 'التاريخ غير صالح' });
    }

    let stored = null;
    if (req.body.dataUrl) {
      try { stored = saveUploadFile(req.body.dataUrl, 'customs', req.body.fileName || ''); }
      catch (e) { return res.status(400).json({ message: e.message }); }
    }
    if (!date && !stored) {
      return res.status(400).json({ message: 'اختر تاريخًا أو ارفع ملفًّا — الإدخال الفارغ لا يُسجَّل' });
    }
    // ── والمبلغُ إجباريٌّ لما يُدفَع ──────────────────────────────────────────
    // المرحلةُ طلبُ صرفٍ إلى الإدارة الماليّة، ومنها يُكتب البندُ في التكاليف
    // عند الدفع. فطلبٌ بلا مبلغٍ لا يُصرَف ولا يُكتب. (المراسلاتُ بلا مبلغ.)
    const amountNum = req.body.amount != null && req.body.amount !== '' ? Number(req.body.amount) : null;
    if (STAGE_COST[key] && !(Number.isFinite(amountNum) && amountNum > 0)) {
      return res.status(400).json({ message: 'اكتب المبلغ — مرحلةُ السداد طلبُ صرفٍ ولا تُضاف بلا مبلغ', code: 'AMOUNT_REQUIRED' });
    }

    const who = [req.user.firstName, req.user.lastName].filter(Boolean).join(' ') || req.user.name || '';
    const entry = {
      key,
      label: def.nameAr || def.nameEn || key,
      date,
      amount: amountNum,
      note: String(req.body.note || '').trim().slice(0, 500),
      ...(stored || {}),
      addedBy: req.user._id,
      addedByName: who,
      addedAt: new Date(),
    };
    clearance.paymentStages.push(entry);

    if (stored) {
      clearance.attachments.push({
        ...stored,
        title: entry.label,
        stage: '',   // مرحلةُ السداد ليست من `STAGES` (دورةُ الإجراءات) فتبقى عامّة
        uploadedBy: req.user._id,
        uploadedByName: who,
        uploadedAt: new Date(),
      });
    }

    // فاتورةُ النقل وصلت لمعاملةٍ فُوترت؟ فهي تُنهى الآن — راجع settleClosure.
    if (TRANSPORT_STAGE_KEYS.includes(key) && stored) settleClosure(clearance, req);
    clearance.lastModifiedBy = req.user._id;
    await clearance.save();
    await logAudit({
      user: req.user._id, action: 'add_customs_payment_stage', entity: 'CustomsClearance',
      entityId: clearance._id,
      changes: { after: { refNumber: clearance.refNumber, stage: entry.label, date, file: entry.fileName || '' } },
      ipAddress: req.ip,
    });
    try { emitToAll('customs:updated', { clearance }); } catch (e) {}
    cache.clear('customs:');
    res.status(201).json({ clearance });
  } catch (error) {
    return sendMongooseError(res, error, 'تعذّر إضافة المرحلة');
  }
};

/** تعديلُ إدخالٍ قائم — تاريخُه أو مبلغُه أو ملاحظتُه. */
exports.updatePaymentStage = async (req, res) => {
  try {
    const clearance = await CustomsClearance.findById(req.params.id);
    if (!clearance) return res.status(404).json({ message: 'Clearance not found' });
    const entry = clearance.paymentStages.id(req.params.entryId);
    if (!entry) return res.status(404).json({ message: 'الإدخال غير موجود' });

    if (req.body.date !== undefined) {
      const d = String(req.body.date || '').trim();
      if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) return res.status(400).json({ message: 'التاريخ غير صالح' });
      entry.date = d;
    }
    if (req.body.amount !== undefined) {
      const a = req.body.amount === '' || req.body.amount == null ? null : Number(req.body.amount);
      if (STAGE_COST[entry.key] && !(Number.isFinite(a) && a > 0)) {
        return res.status(400).json({ message: 'اكتب المبلغ — مرحلةُ السداد لا تبقى بلا مبلغ', code: 'AMOUNT_REQUIRED' });
      }
      entry.amount = a;
      // مبلغُ مرحلةٍ مدفوعةٍ تغيّر؟ فبندُها في التكاليف يتبعه.
      if (STAGE_COST[entry.key] && entry.payStatus === 'paid') applyPaidCosts(clearance, [entry.key], true);
    }
    if (req.body.note !== undefined) entry.note = String(req.body.note).trim().slice(0, 500);

    // ملفٌّ جديدٌ يحلُّ محلَّ القديم، والقديمُ يُمحى من القرص لا يبقى يتيمًا.
    if (req.body.dataUrl) {
      let stored;
      try { stored = saveUploadFile(req.body.dataUrl, 'customs', req.body.fileName || ''); }
      catch (e) { return res.status(400).json({ message: e.message }); }
      const old = entry.fileUrl;
      Object.assign(entry, stored);
      clearance.attachments.push({
        ...stored,
        title: entry.label,
        stage: '',
        uploadedBy: req.user._id,
        uploadedByName: [req.user.firstName, req.user.lastName].filter(Boolean).join(' '),
        uploadedAt: new Date(),
      });
      if (old) {
        // لا يُمحى من القرص إن كان مذكورًا في مرفقاتٍ أخرى — الذكرُ مرّتان
        // لملفٍّ واحد، ومحوُه يُفرِغ السطرَ الآخر أيضًا.
        const stillUsed = clearance.attachments.some((a) => a.fileUrl === old)
          || clearance.paymentStages.some((p) => String(p._id) !== String(entry._id) && p.fileUrl === old);
        if (!stillUsed) { try { deleteStoredFile(old); } catch (e) { /* */ } }
      }
    }

    if (TRANSPORT_STAGE_KEYS.includes(entry.key) && req.body.dataUrl) settleClosure(clearance, req);
    clearance.lastModifiedBy = req.user._id;
    await clearance.save();
    try { emitToAll('customs:updated', { clearance }); } catch (e) {}
    cache.clear('customs:');
    res.json({ clearance });
  } catch (error) {
    return sendMongooseError(res, error, 'تعذّر تعديل المرحلة');
  }
};

/** حذفُ إدخال — وورقتُه تُحذَف معه من مرفقات المعاملة (راجع deleteAttachment). */
exports.deletePaymentStage = async (req, res) => {
  try {
    const clearance = await CustomsClearance.findById(req.params.id);
    if (!clearance) return res.status(404).json({ message: 'Clearance not found' });
    const entry = clearance.paymentStages.id(req.params.entryId);
    if (!entry) return res.status(404).json({ message: 'الإدخال غير موجود' });
    const label = entry.label;
    const urls = [entry.fileUrl, ...(entry.proofFiles || []).map((f) => f.fileUrl)].filter(Boolean);
    const paidKey = entry.payStatus === 'paid' && STAGE_COST[entry.key] ? entry.key : '';
    entry.deleteOne();
    // حُذف ما دُفع؟ فبندُه في التكاليف يعود إلى مجموع ما بقي مدفوعًا.
    if (paidKey) applyPaidCosts(clearance, [paidKey], true);
    for (const a of clearance.attachments.filter((x) => urls.includes(x.fileUrl))) a.deleteOne();
    clearance.lastModifiedBy = req.user._id;
    await clearance.save();
    dropIfUnused(clearance, urls);
    await logAudit({
      user: req.user._id, action: 'delete_customs_payment_stage', entity: 'CustomsClearance',
      entityId: clearance._id, changes: { before: { stage: label, files: urls.length } }, ipAddress: req.ip,
    });
    try { emitToAll('customs:updated', { clearance }); } catch (e) {}
    cache.clear('customs:');
    res.json({ clearance });
  } catch (error) {
    return sendMongooseError(res, error, 'تعذّر حذف المرحلة');
  }
};

/**
 * إقفالُ المعاملة — ومعه الشرطُ الذي طُلب صراحةً.
 *
 * لا تُقفَل قبل أن تكون «فاتورة النقل» لها **تاريخٌ ومرفق** معًا. والإقفالُ
 * يُخرج المعاملةَ من قوائم المتابعة، فإقفالُها بلا فاتورةِ نقلٍ يُخرجها وفيها
 * مالٌ لم يُطالَب به — ولا يُكتشَف ذلك إلّا عند الجرد.
 *
 * والسببُ يُقال صريحًا: «ارفع فاتورة النقل واختر تاريخها» لا «غير مسموح».
 */
/**
 * بنودُ فاتورة العميل المسموحة — من إعدادات القسم (`customs_sale_item`).
 * تُقرأ ولا تُكتب في الشيفرة: البنودُ تزيد بزيادة العمل، وزيادتُها إعدادٌ لا نشرة.
 */
const saleItemDefs = async () => {
  const Lookup = require('../models/Lookup');
  const rows = await Lookup.find({ type: 'customs_sale_item', isActive: { $ne: false } })
    .sort({ order: 1 }).lean().catch(() => []);
  if (rows.length) return rows.map((r) => ({ key: r.key, nameAr: r.nameAr, nameEn: r.nameEn }));
  // ولا تُقفَل معاملةٌ لأنّ القائمةَ لم تُبذَر بعد — تُقرأ بذرةُ التعريف.
  const { REGISTRY } = require('../config/lookupTypes');
  const def = (REGISTRY || []).find((x) => x.type === 'customs_sale_item');
  return (def?.seed || []).map((r) => ({ key: r.key, nameAr: r.nameAr, nameEn: r.nameEn }));
};

/**
 * رقمُ فاتورةٍ جديد — تسلسلٌ خاصٌّ بالتخليص («CUS-1001») لا يُشتبَه بغيره.
 * يُقرأ أكبرُ ما صُدِر ويُزاد؛ والرقمُ لا يُعاد استعمالُه ولا يُغيَّر بعد منحه.
 */
const nextSaleInvoiceNumber = async () => {
  const last = await CustomsClearance.find({ saleInvoiceNumber: /^CUS-\d+$/ })
    .sort({ saleInvoiceNumber: -1 }).limit(1).select('saleInvoiceNumber').lean();
  const prev = Number(String(last?.[0]?.saleInvoiceNumber || '').replace('CUS-', '')) || 1000;
  return `CUS-${prev + 1}`;
};

/**
 * GET /:id/invoice — فاتورةُ العميل محسوبةً من بنودها.
 * لا تُخزَّن المجاميعُ: تُشتقّ عند القراءة — راجع utils/customsInvoice.
 */
exports.getClearanceInvoice = async (req, res) => {
  try {
    const clearance = await CustomsClearance.findById(req.params.id)
      .populate('customer', 'name nameEn vatNumber')
      .lean();
    if (!clearance) return res.status(404).json({ message: 'Clearance not found' });
    const { buildClearanceInvoice } = require('../utils/customsInvoice');
    res.json({
      invoice: buildClearanceInvoice(clearance),
      saleItemDefs: await saleItemDefs(),
      clearance: {
        _id: clearance._id, refNumber: clearance.refNumber,
        customerName: clearance.customerName || clearance.customer?.name || '',
        declarationNumber: clearance.declarationNumber || '',
        billOfLading: clearance.billOfLading || '',
        containers: clearance.containers?.length || 0,
        isCompleted: clearance.isCompleted,
        completedAt: clearance.completedAt,
      },
    });
  } catch (error) {
    return sendMongooseError(res, error, 'تعذّر بناء الفاتورة');
  }
};

/**
 * GET /invoices — فواتيرُ العميل التي تنتظر الإدارةَ الماليّة.
 * القائمةُ التي تقرؤها الماليّةُ: معاملةٌ أُقفلت ولها فاتورةٌ وبنودُها ومجاميعُها.
 */
exports.listClearanceInvoices = async (req, res) => {
  try {
    const f = { saleInvoiceNumber: { $gt: '' } };
    if (req.query.from || req.query.to) {
      f.saleInvoiceAt = {};
      if (req.query.from) f.saleInvoiceAt.$gte = new Date(req.query.from);
      if (req.query.to) f.saleInvoiceAt.$lte = new Date(`${req.query.to}T23:59:59.999Z`);
    }
    if (req.query.customer) f.customerName = new RegExp(String(req.query.customer).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    const rows = await CustomsClearance.find(f)
      .sort({ saleInvoiceAt: -1 })
      .limit(Math.min(500, Math.max(1, Number(req.query.limit) || 200)))
      .select('refNumber blNumber customerName declarationNumber billOfLading saleInvoiceNumber saleInvoiceAt saleVatRate saleItems paymentStages isCompleted completedAt cancelled transportInvoice transportInvoiceReceived')
      .lean();
    const { buildClearanceInvoice } = require('../utils/customsInvoice');
    const invoices = rows.map((c) => {
      const inv = buildClearanceInvoice(c);
      return {
        _id: c._id, refNumber: c.refNumber, customerName: c.customerName || '',
        declarationNumber: c.declarationNumber || '', billOfLading: c.billOfLading || '',
        invoiceNumber: c.saleInvoiceNumber, invoiceAt: c.saleInvoiceAt,
        completedAt: c.completedAt, isCompleted: !!c.isCompleted, blNumber: c.blNumber || '',
        // فُوترت ولم تصل فاتورةُ نقلها — تُلوَّن بالأحمر عند الماليّة أيضًا.
        awaitingTransportInvoice: awaitsTransportInvoice(c),
        lines: inv.lines.length, passThrough: inv.passThrough, billed: inv.billed, totals: inv.totals,
      };
    });
    res.json({
      invoices,
      summary: invoices.reduce((a, i) => ({
        count: a.count + 1,
        net: Math.round((a.net + i.totals.net) * 100) / 100,
        vat: Math.round((a.vat + i.totals.vat) * 100) / 100,
        grand: Math.round((a.grand + i.totals.grand) * 100) / 100,
        awaitingTransportInvoice: a.awaitingTransportInvoice + (i.awaitingTransportInvoice ? 1 : 0),
      }), { count: 0, net: 0, vat: 0, grand: 0, awaitingTransportInvoice: 0 }),
    });
  } catch (error) {
    return sendMongooseError(res, error, 'تعذّر تحميل الفواتير');
  }
};

const whoIs = (req) => [req.user.firstName, req.user.lastName].filter(Boolean).join(' ') || req.user.name || '';

/**
 * ── الإنهاءُ يتبع فاتورةَ النقل ────────────────────────────────────────────
 * معاملةٌ صدرت فاتورتُها ووصلت فاتورةُ نقلها (أو قيل إنّها لا تُنتظَر) انتهت:
 * لا يبقى فيها عملٌ ولا ورقٌ منتظَر. فتُنهى في اللحظة التي يجتمع فيها الأمران
 * — لا بضغطةٍ ثالثةٍ تُنسى فتبقى المعاملةُ مفتوحةً وهي منتهية.
 * تُنادى قبل الحفظ؛ وتردّ هل أنهتها.
 */
function settleClosure(clearance, req) {
  if (clearance.isCompleted || clearance.cancelled || !clearance.saleInvoiceNumber) return false;
  if (!hasTransportInvoice(clearance)) return false;
  clearance.isCompleted = true;
  clearance.completedAt = new Date();
  clearance.completedBy = req.user._id;
  clearance.completedByName = whoIs(req);
  return true;
}

/** يكتب بنودَ فاتورة العميل من جسم الطلب. يردّ نصَّ الخطأ أو null. */
async function writeSaleItems(clearance, sent, req) {
  const allowed = await saleItemDefs();
  const byKey = new Map(allowed.map((x) => [x.key, x]));
  const prev = new Map((clearance.saleItems || []).map((x) => [x.key, x]));
  const built = [];
  for (const raw of sent) {
    const key = String(raw?.key || '').trim();
    const def = byKey.get(key);
    if (!def) return `بندٌ غير معروف: «${key || '—'}»`;
    const amount = Number(raw?.amount);
    // بندٌ بلا سعرٍ في فاتورةٍ تذهب إلى الماليّة مبلغٌ يُطالَب به ولا يُعرَف.
    if (!Number.isFinite(amount) || amount < 0) return `اكتب سعرَ «${def.nameAr}»`;
    const item = {
      key, label: def.nameAr || key, amount: Math.round(amount * 100) / 100,
      note: String(raw?.note || '').trim(),
      addedBy: req.user._id, addedByName: whoIs(req), addedAt: new Date(),
    };
    if (raw?.file) {
      try {
        const saved = saveUploadFile(raw.file, 'customs', raw.fileName || def.nameAr);
        Object.assign(item, { fileUrl: saved.fileUrl, fileName: saved.fileName, mimeType: saved.mimeType, size: saved.size });
        // والمرفقُ يُوجَد مع بقيّة ورق المعاملة كذلك — مكانٌ واحدٌ لكلّ الورق.
        clearance.attachments.push({
          title: `فاتورة العميل — ${item.label}`,
          fileUrl: saved.fileUrl, fileName: saved.fileName, mimeType: saved.mimeType, size: saved.size,
          uploadedBy: req.user._id, uploadedByName: whoIs(req), uploadedAt: new Date(),
        });
      } catch (err) { return `مرفقُ «${def.nameAr}»: ${err.message}`; }
    } else {
      // ما أُرفِق في إصدارٍ سابقٍ يبقى: إعادةُ الإصدار لتصحيح سعرٍ لا تُسقط الورق.
      const old = prev.get(key);
      const src = raw?.fileUrl ? raw : old;
      if (src?.fileUrl) {
        Object.assign(item, {
          fileUrl: String(src.fileUrl), fileName: String(src.fileName || ''),
          mimeType: String(src.mimeType || ''), size: Number(src.size) || 0,
        });
      }
    }
    built.push(item);
  }
  clearance.saleItems = built;
  return null;
}

/**
 * PATCH /:id/invoice — إصدارُ فاتورة العميل (الفوترة).
 *
 * ── وفاتورةُ النقل ليست شرطًا ──────────────────────────────────────────────
 * كان الإصدارُ لا يمرّ قبل «فاتورة النقل» بسعرها ومرفقها. وهي تتأخّر عند
 * الناقل، فتتأخّر معها فاتورةُ العميل كلُّها. فصار: تُصدَر الفاتورةُ بما هو
 * معروف، وتذهب إلى الماليّة كأيّ فاتورة، وتبقى المعاملةُ معلَّمةً بالأحمر
 * «بانتظار فاتورة النقل» حتى تُرفَق — فتُنهى عندها.
 */
exports.issueInvoice = async (req, res) => {
  try {
    const clearance = await CustomsClearance.findById(req.params.id);
    if (!clearance) return res.status(404).json({ message: 'Clearance not found' });
    if (clearance.cancelled) return res.status(400).json({ message: 'المعاملةُ ملغاة — لا تُفوتَر' });
    if (clearance.upcoming) return res.status(400).json({ message: 'معاملةٌ قادمةٌ لم تبدأ — حوِّلها إلى جاريةٍ أوّلًا' });

    const sent = Array.isArray(req.body.saleItems) ? req.body.saleItems : [];
    const err = await writeSaleItems(clearance, sent, req);
    if (err) return res.status(400).json({ message: err });
    const hasPassThrough = (clearance.paymentStages || []).some((p) => Number(p.amount) > 0);
    if (!clearance.saleItems.length && !hasPassThrough) {
      return res.status(400).json({ message: 'فاتورةٌ بلا بنود — اكتب سعرَ بندٍ واحدٍ على الأقلّ' });
    }

    clearance.saleVatRate = 0.15;
    const first = !clearance.saleInvoiceNumber;
    if (first) {
      clearance.saleInvoiceNumber = await nextSaleInvoiceNumber();
      clearance.saleInvoiceAt = new Date();
    }
    // ── و«حالة الفاتورة» تتبع الإصدار ──────────────────────────────────────
    // كانت خانةً تُكتب بيدٍ فتقول «غير مفوتر» لمعاملةٍ صدرت فاتورتُها.
    const { todayKey } = require('../utils/companyDay');
    if (!clearance.billing) clearance.billing = {};
    clearance.billing.invoiceStatus = 'مفوترة';
    if (!clearance.billing.ourInvoiceNumber) clearance.billing.ourInvoiceNumber = clearance.saleInvoiceNumber;
    if (!clearance.billing.invoicedAt) clearance.billing.invoicedAt = todayKey();
    // والمرحلةُ الأخيرةُ في الدورة هي الفاتورةُ نفسُها.
    const { done, route } = readStages(clearance);
    done.add('invoiced');
    clearance.stagesDone = CustomsClearance.STAGES.filter((k) => done.has(k));
    clearance.transportRoute = route;
    if (!(clearance.pipelineVersion >= 2)) clearance.pipelineVersion = 2;
    clearance.stage = 'invoiced';
    if (first) clearance.stageLog.push({ key: 'invoiced', done: true, by: req.user._id, byName: whoIs(req), at: new Date() });

    const closed = settleClosure(clearance, req);
    clearance.lastModifiedBy = req.user._id;
    await clearance.save();
    await logAudit({
      user: req.user._id, action: closed ? 'complete_customs_clearance' : 'invoice_customs_clearance',
      entity: 'CustomsClearance', entityId: clearance._id,
      changes: { after: { refNumber: clearance.refNumber, invoice: clearance.saleInvoiceNumber, awaitingTransportInvoice: !closed } }, ipAddress: req.ip,
    });
    try { emitToAll('customs:updated', { clearance }); } catch (e) {}
    cache.clear('customs:'); try { cache.clear('finance:'); } catch (_) { /* */ }
    res.json({ clearance, closed, awaitingTransportInvoice: !closed });
  } catch (error) {
    return sendMongooseError(res, error, 'تعذّر إصدار الفاتورة');
  }
};

/**
 * POST /:id/transport-invoice — وصلت فاتورةُ النقل (أو لا تُنتظَر).
 *   { dataUrl, fileName, date? }      تُرفَق، وتظهر في مرفقات المعاملة
 *   { notRequired: true, note? }      نُقلت بسيّارات الشركة — لا فاتورةَ ناقل
 * ومتى كانت المعاملةُ مفوترةً أُنهيت في الحال.
 */
exports.receiveTransportInvoice = async (req, res) => {
  try {
    const clearance = await CustomsClearance.findById(req.params.id);
    if (!clearance) return res.status(404).json({ message: 'Clearance not found' });
    if (!clearance.transportInvoice) clearance.transportInvoice = {};
    const t = clearance.transportInvoice;
    if (req.body.notRequired === true) {
      t.notRequired = true;
      t.note = String(req.body.note || '').trim().slice(0, 300);
    } else {
      if (!req.body.dataUrl) return res.status(400).json({ message: 'أرفِق فاتورةَ النقل' });
      const date = String(req.body.date || '').trim();
      if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ message: 'التاريخ غير صالح' });
      let stored;
      try { stored = saveUploadFile(req.body.dataUrl, 'customs', req.body.fileName || 'فاتورة النقل'); }
      catch (e) { return res.status(400).json({ message: e.message }); }
      const old = t.fileUrl;
      Object.assign(t, stored, { date, notRequired: false });
      for (const a of clearance.attachments.filter((x) => old && x.fileUrl === old)) a.deleteOne();
      clearance.attachments.push({
        ...stored, title: 'فاتورة النقل', stage: '',
        uploadedBy: req.user._id, uploadedByName: whoIs(req), uploadedAt: new Date(),
      });
      if (old) dropIfUnused(clearance, [old]);
    }
    t.receivedAt = new Date(); t.receivedBy = req.user._id; t.receivedByName = whoIs(req);
    const closed = settleClosure(clearance, req);
    clearance.lastModifiedBy = req.user._id;
    await clearance.save();
    await logAudit({
      user: req.user._id, action: closed ? 'complete_customs_clearance' : 'update_customs_clearance',
      entity: 'CustomsClearance', entityId: clearance._id,
      changes: { after: { refNumber: clearance.refNumber, transportInvoice: t.notRequired ? 'not required' : t.fileName } }, ipAddress: req.ip,
    });
    try { emitToAll('customs:updated', { clearance }); } catch (e) {}
    cache.clear('customs:'); try { cache.clear('finance:'); } catch (_) { /* */ }
    res.json({ clearance, closed });
  } catch (error) {
    return sendMongooseError(res, error, 'تعذّر حفظ فاتورة النقل');
  }
};

/**
 * PATCH /:id/complete — إعادةُ الفتح، أو الإنهاءُ بيدٍ لمعاملةٍ اكتملت شروطُها.
 * (الإنهاءُ يقع وحدَه عند اجتماع الفاتورة وفاتورة النقل — راجع settleClosure؛
 *  وهذا لما أُعيد فتحُه ثمّ أُريد إنهاؤه ثانيةً.)
 */
exports.completeClearance = async (req, res) => {
  try {
    // تطبيقٌ قديمٌ يرسل البنودَ مع الإقفال: هو إصدارُ فاتورة.
    if (req.body.completed !== false && Array.isArray(req.body.saleItems)) return exports.issueInvoice(req, res);

    const clearance = await CustomsClearance.findById(req.params.id);
    if (!clearance) return res.status(404).json({ message: 'Clearance not found' });

    const reopen = req.body.completed === false;
    if (reopen) {
      clearance.isCompleted = false;
      clearance.completedAt = null;
      clearance.completedBy = null;
      clearance.completedByName = '';
    } else {
      if (!clearance.saleInvoiceNumber) {
        return res.status(400).json({ message: 'أصدِر فاتورةَ العميل أوّلًا — ثمّ تُنهى المعاملةُ حين تُرفَق فاتورةُ النقل.', code: 'NOT_INVOICED' });
      }
      if (!hasTransportInvoice(clearance)) {
        return res.status(400).json({ message: 'تُنهى المعاملةُ حين تُرفَق «فاتورة النقل» — أرفِقها أو قل إنّها لا تُنتظَر.', missingStage: REQUIRED_STAGE_KEY });
      }
      clearance.isCompleted = true;
      clearance.completedAt = new Date();
      clearance.completedBy = req.user._id;
      clearance.completedByName = whoIs(req);
    }

    clearance.lastModifiedBy = req.user._id;
    await clearance.save();
    await logAudit({
      user: req.user._id, action: reopen ? 'reopen_customs_clearance' : 'complete_customs_clearance',
      entity: 'CustomsClearance', entityId: clearance._id,
      changes: { after: { refNumber: clearance.refNumber } }, ipAddress: req.ip,
    });
    try { emitToAll('customs:updated', { clearance }); } catch (e) {}
    cache.clear('customs:');
    res.json({ clearance });
  } catch (error) {
    return sendMongooseError(res, error, 'تعذّر إنهاء المعاملة');
  }
};

/**
 * PATCH /:id/stage — تعليمُ مرحلةٍ أو رفعُ علامتها. { key, done }
 *
 * القواعدُ هنا لا في الشاشة — وهي ثلاث:
 *   · مرحلتا الميناء تتنافيان: تعليمُ إحداهما يختار الطريقَ ويُغلِق الأخرى.
 *   · ما ليس من طريق المعاملة مُغلَق: لا تفريغَ ولا تخزينَ لمن نقل إلى العميل
 *     مباشرةً، ولا إرجاعَ حاوياتٍ في معاملة سيّارات.
 *   · «إصدار الفاتورة» لا تُعلَّم بيد: تُعلَّم بإصدارها.
 */
exports.setStage = async (req, res) => {
  try {
    const clearance = await CustomsClearance.findById(req.params.id);
    if (!clearance) return res.status(404).json({ message: 'Clearance not found' });
    const key = String(req.body.key || '');
    if (!CustomsClearance.STAGES.includes(key)) return res.status(400).json({ message: 'مرحلةٌ غير معروفة' });
    const on = req.body.done !== false;
    if (key === 'invoiced') {
      return res.status(400).json({ message: 'هذه المرحلةُ تُعلَّم بإصدار الفاتورة — من «إصدار الفاتورة» أعلى الصفحة.', code: 'STAGE_AUTO' });
    }

    const before = clearance.stage;
    const read = readUnits(clearance);
    let { done, route } = read;
    const cargo = clearance.cargoType;
    let unitNote = '';

    if (UNIT_STAGES.includes(key) && read.units) {
      // ── مرحلةُ وحدة: لحاويةٍ بعينها، أو للكلّ معًا ───────────────────────
      // `unit`: رقمُ الخانة (من صفر) أو 'all'. وغيابُه «الكلّ» — فتطبيقٌ لا يعرف
      // الوحداتِ يعلّم المعاملةَ كلَّها كما كان.
      const all = req.body.unit === undefined || req.body.unit === null || req.body.unit === 'all';
      const idx = all ? -1 : Number(req.body.unit);
      if (!all && !(Number.isInteger(idx) && idx >= 0 && idx < read.units.length)) {
        return res.status(400).json({ message: 'وحدةٌ غير موجودةٍ في هذه المعاملة' });
      }
      const units = read.units.map((u) => ({ route: u.route, done: new Set(u.done) }));
      const targets = all ? units : [units[idx]];
      const touched = new Set();
      let applied = 0; let refusal = '';
      for (const u of targets) {
        if (on) {
          // الطريقُ يُبدَّل بضغطة: تُرفَع علامةُ الأوّل وما بُني عليه، ويُعلَّم الثاني.
          if (PORT_LEGS.includes(key) && u.route && lockReason(key, u.route, cargo)) {
            for (const k of ['transport_to_yard', 'transport_to_customer', 'unloaded_stored', 'yard_to_customer']) u.done.delete(k);
            u.route = '';
          }
          const reason = lockReason(key, u.route, cargo);
          if (reason) { refusal = reason; continue; }
          if (!u.done.has(key)) touched.add(u);
          u.done.add(key);
          if (PORT_LEGS.includes(key)) u.route = key === 'transport_to_yard' ? 'yard' : 'customer';
        } else {
          u.done.delete(key);
          if (PORT_LEGS.includes(key)) { u.route = ''; u.done.delete('unloaded_stored'); u.done.delete('yard_to_customer'); }
        }
        applied += 1;
      }
      if (!applied) return res.status(400).json({ message: `هذه المرحلةُ غيرُ متاحة: ${refusal}`, code: 'STAGE_LOCKED' });

      // تُكتب مراحلُ كلّ وحدةٍ في خانتها — ومعها ما كان على المعاملة كلِّها.
      const { todayKey } = require('../utils/companyDay');
      const rows = syncUnits(clearance.containers, Math.max(Number(clearance.containerCount) || 0, units.length));
      units.forEach((u, i) => {
        rows[i].route = u.route;
        rows[i].stagesDone = UNIT_STAGES.filter((k) => u.done.has(k));
        // الإرجاعُ الذي عُلِّم الآن بلا تاريخٍ يُؤرَّخ بيومه.
        if (on && key === 'containers_returned' && touched.has(u) && !rows[i].returnDate) rows[i].returnDate = todayKey();
      });
      clearance.containers = rows;
      clearance.containerCount = rows.length;
      for (const k of UNIT_STAGES) done.delete(k);
      const routes = [...new Set(units.map((u) => u.route))];
      route = routes.length === 1 ? routes[0] : '';
      clearance.stagesDone = CustomsClearance.STAGES.filter((k) => done.has(k));
      clearance.transportRoute = route;
      clearance.pipelineVersion = 3;
      clearance.stage = key;
      unitNote = all ? 'all' : String(idx);
    } else {
      const isPortLeg = PORT_LEGS.includes(key);
      if (on) {
        // الطريقُ يُبدَّل بضغطة — راجع ما فوق.
        if (isPortLeg && route && lockReason(key, route, cargo)) {
          for (const k of ['transport_to_yard', 'transport_to_customer', 'unloaded_stored', 'yard_to_customer']) done.delete(k);
          route = '';
        }
        const reason = lockReason(key, route, cargo);
        if (reason) return res.status(400).json({ message: `هذه المرحلةُ غيرُ متاحة: ${reason}`, code: 'STAGE_LOCKED' });
        done.add(key);
        if (isPortLeg) route = key === 'transport_to_yard' ? 'yard' : 'customer';
      } else {
        done.delete(key);
        // رفعُ علامةِ الطريق يفتح الاختيارَ من جديد — وما بُني عليه يسقط معه.
        if (isPortLeg) { route = ''; done.delete('unloaded_stored'); done.delete('yard_to_customer'); }
      }
      // مرحلةُ المعاملة (ما قبل النقل) في معاملةٍ لها وحدات: ما على الوحدات يبقى
      // حيث هو — مكتوبًا عليها (٣) أو موروثًا من المعاملة (دون ذلك).
      const keepUnits = read.units && clearance.pipelineVersion !== 3;
      const legacy = keepUnits ? readStages(clearance).done : null;
      clearance.stagesDone = CustomsClearance.STAGES.filter((k) => done.has(k) || (legacy && UNIT_STAGES.includes(k) && legacy.has(k)));
      if (!read.units || keepUnits) clearance.transportRoute = keepUnits ? readStages(clearance).route : route;
      if (!(clearance.pipelineVersion >= 2)) clearance.pipelineVersion = 2;
      // «أين هي الآن»: ما عُلِّم للتوّ، أو آخرُ ما بقي معلَّمًا إن رُفعت علامة.
      const lastDone = [...CustomsClearance.STAGES].reverse().find((k) => done.has(k) && !lockReason(k, route, cargo));
      clearance.stage = on ? key : (lastDone || 'papers_received');
    }
    clearance.stageLog.push({ key: unitNote ? `${key}#${unitNote}` : key, done: on, by: req.user._id, byName: whoIs(req), at: new Date() });
    if (clearance.stageLog.length > 300) clearance.stageLog = clearance.stageLog.slice(-300);
    clearance.lastModifiedBy = req.user._id;
    await clearance.save();
    cache.clear('customs:');

    await logAudit({ user: req.user._id, action: 'update_customs_clearance', entity: 'CustomsClearance', entityId: clearance._id, changes: { after: { refNumber: clearance.refNumber, stage: key, done: on } }, ipAddress: req.ip });
    try { emitToAll('customs:updated', { clearance }); } catch (e) {}
    res.json({ clearance });

    // مَن أنشأ المعاملةَ يُخبَر بتقدّمها — إن لم يكن هو مَن علّم.
    if (on && before !== clearance.stage && clearance.createdBy && String(clearance.createdBy) !== String(req.user._id)) {
      try {
        const { CUSTOMS_STAGE_AR } = require('../config/customsStages');
        await createNotification({
          recipient: clearance.createdBy, type: 'status_changed', title: 'تحديث معاملة تخليص',
          message: `${clearance.blNumber || clearance.refNumber} — ${CUSTOMS_STAGE_AR[key] || key}`,
          relatedEntity: 'CustomsClearance', relatedEntityId: clearance._id,
        });
      } catch (e) { /* الإشعارُ زيادة */ }
    }
  } catch (error) {
    if (res.headersSent) return undefined;
    return sendMongooseError(res, error, 'تعذّر تعليم المرحلة');
  }
};

/**
 * GET /release-sheets?numbers=a,b — أيُّ أرقام كشوف التخريج موجودٌ في سير عمل
 * التشغيل. الرقمُ يُكتب في خانة الحاوية حين تُنقَل بسيّارة الشركة، وهو نفسُه
 * `reportNumber` هناك: فيُقال للموظّف في الحال أمرتبطٌ هو أم لا.
 */
exports.releaseSheets = async (req, res) => {
  try {
    const numbers = [...new Set(String(req.query.numbers || '').split(',').map((x) => x.trim()).filter(Boolean))].slice(0, 300);
    if (!numbers.length) return res.json({ found: {} });
    const OperationsWorkflow = require('../models/OperationsWorkflow');
    const rows = await OperationsWorkflow.find({ reportNumber: { $in: numbers } }).select('reportNumber').lean();
    res.json({ found: Object.fromEntries(rows.map((r) => [r.reportNumber, String(r._id)])) });
  } catch (e) {
    res.status(500).json({ message: 'تعذّر التحقّق من كشوف التخريج' });
  }
};

module.exports.REQUIRED_STAGE_KEY = REQUIRED_STAGE_KEY;


// ═══════════════════════════════════════════════════════════════════════════
//  لوحةُ القسم — التشغيلُ لا الأرباح
// ═══════════════════════════════════════════════════════════════════════════
/**
 * GET /dashboard — ما يحتاجه الفريقُ ليعمل: كم معاملةً قادمةً ومفتوحةً ومغلقة،
 * وأين تقف كلٌّ منها، ومع كم عميلٍ نعمل الآن، وما الذي ينتظر فاتورةَ نقله،
 * وحركةُ كلّ فردٍ في الفريق. **ولا رقمَ ماليًّا فيها**: الأرباحُ والإيراداتُ في
 * «تحليلات قسم التخليص» وهي للإدارة وحدَها.
 *
 * الفلاتر: customerParty, agentParty, carrierParty, branch, cargoType, member
 * (مَن أنشأ), from/to (تاريخُ الإنشاء). وكلُّ بطاقةٍ تُحسَب على ما بقي بعدها —
 * فمَن اختار عميلًا قرأ قادمَه ومفتوحَه ومغلقَه هو.
 *
 * والصفوفُ تُرسَل مع الأرقام: كلُّ بطاقةٍ تُضغَط فتُصفّي الجدولَ تحتها، بلا
 * نداءٍ ثانٍ ولا رقمٍ لا يُعرَف ممّ تكوّن.
 */
exports.getDashboard = async (req, res) => {
  try {
    const q = req.query || {};
    const mongoose = require('mongoose');
    const { todayKey, startOfDay, DAY_MS } = require('../utils/companyDay');
    const { stageLabel } = require('../config/customsStages');
    const User = require('../models/User');
    const { JpTask } = require('../models/JpModels');
    const { JP_SECTIONS } = require('../config/jpSections');
    const jp = JP_SECTIONS.customs;
    const isManager = req.user.role === 'super_admin' || jp.managerRoles.includes(req.user.role);

    const filter = {};
    for (const k of ['customerParty', 'agentParty', 'carrierParty']) {
      if (q[k] && mongoose.isValidObjectId(q[k])) filter[k] = q[k];
    }
    if (q.branch === 'jeddah' || q.branch === 'dammam') filter.branch = q.branch;
    if (CARGO_TYPES.includes(q.cargoType)) filter.cargoType = q.cargoType === 'vehicles' ? 'vehicles' : { $ne: 'vehicles' };
    if (q.member && mongoose.isValidObjectId(q.member)) filter.createdBy = q.member;
    // المدى يُقاس على تاريخ المعاملة (txDateOf) بعد القراءة — لا على يوم الإدخال.
    const ymd = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : '');
    const dFrom = ymd(q.from); const dTo = ymd(q.to);

    const ck = `customs:dash:${isManager ? 'm' : String(req.user._id)}:${JSON.stringify(Object.keys(q).sort().map((k) => [k, q[k]]))}`;
    const body = await cache.wrap(ck, 30000, async () => {
      const since = new Date(Date.now() - 30 * DAY_MS);
      const oid = (v) => new mongoose.Types.ObjectId(String(v));
      const aggMatch = { ...filter };
      for (const k of ['customerParty', 'agentParty', 'carrierParty', 'createdBy']) if (aggMatch[k]) aggMatch[k] = oid(aggMatch[k]);
      // فلترُ «مَن أنشأ» لا يُطبَّق على حركة الفريق: الحركةُ تُقرأ لكلّ فردٍ على حدة.
      const actMatch = { ...aggMatch }; delete actMatch.createdBy;
      const act = (path, by, at) => CustomsClearance.aggregate([
        { $match: { ...actMatch, [`${path}.0`]: { $exists: true } } },
        { $project: { [path]: 1 } }, { $unwind: `$${path}` },
        { $match: { [`${path}.${at}`]: { $gte: since } } },
        { $group: { _id: `$${path}.${by}`, n: { $sum: 1 }, last: { $max: `$${path}.${at}` } } },
      ]);
      const jpVisible = { scope: 'section', section: 'customs' };
      if (!isManager) jpVisible.$or = [{ assignedTo: req.user._id }, { createdBy: req.user._id }];

      const [rows, users, notes, pays, ticks, pendingPay, tasks, ended] = await Promise.all([
        CustomsClearance.find(filter)
          .select('refNumber blNumber customerName customerParty shippingAgent agentParty carrierName carrierParty branch cargoType containerCount '
            + 'containers.route containers.stagesDone stage stagesDone transportRoute pipelineVersion stageDone.doInvoicePaid stageDone.containersReturned saleInvoiceNumber saleInvoiceAt '
            + 'transportInvoiceReceived isCompleted completedAt completedBy cancelled upcoming expectedDate returnDeadline createdAt createdBy updatedAt declarationNumber port '
            + 'papersReceivedDate declarationDate periodYear periodMonth')
          .sort({ createdAt: -1 }).lean()
          // القادمةُ تُقاس بتاريخها المرتقَب: هو تاريخُها الوحيد.
          .then((list) => (dFrom || dTo ? list.filter((c) => {
            const d = c.upcoming ? String(c.expectedDate || '').slice(0, 10) : txDateOf(c);
            return !!d && (!dFrom || d >= dFrom) && (!dTo || d <= dTo);
          }) : list)),
        User.find({ role: { $in: jp.memberRoles }, isActive: { $ne: false } }).select('firstName lastName role').lean(),
        act('notesLog', 'by', 'at'),
        act('paymentStages', 'addedBy', 'addedAt'),
        act('stageLog', 'by', 'at'),
        CustomsClearance.aggregate([
          { $match: { ...aggMatch, cancelled: { $ne: true }, 'paymentStages.payStatus': 'pending' } },
          { $project: { paymentStages: 1 } }, { $unwind: '$paymentStages' },
          { $match: { 'paymentStages.payStatus': 'pending' } },
          { $group: { _id: '$_id', n: { $sum: 1 } } },
        ]),
        JpTask.find(jpVisible).select('status deadlineAt assignedTo links title').lean(),
        endedStaff(),
      ]);

      const today = todayKey();
      const soon = new Date(startOfDay(today).getTime() + 7 * DAY_MS).toISOString().slice(0, 10);
      const pendingBy = new Map(pendingPay.map((x) => [String(x._id), x.n]));
      const now = Date.now();
      const taskState = (t) => (t.status === 'done' ? 'done' : (t.deadlineAt && new Date(t.deadlineAt).getTime() < now ? 'overdue' : 'open'));
      const tasksByClearance = new Map();
      for (const t of tasks) {
        if (t.status === 'done') continue;
        for (const l of t.links || []) {
          if (l.kind !== 'clearance') continue;
          tasksByClearance.set(String(l.ref), (tasksByClearance.get(String(l.ref)) || 0) + 1);
        }
      }
      const nameOf = (u) => (u ? [u.firstName, u.lastName].filter(Boolean).join(' ').trim() : '');
      const userName = new Map(users.map((u) => [String(u._id), nameOf(u)]));

      const out = rows.map((c) => {
        const p = pipelineOf(c);
        const bucket = c.cancelled ? 'cancelled' : c.upcoming ? 'upcoming' : c.isCompleted ? 'closed' : 'open';
        const returned = p.steps.some((s) => s.key === 'containers_returned' && s.done) || !!(c.stageDone && c.stageDone.containersReturned);
        const needsReturn = bucket === 'open' && c.cargoType !== 'vehicles' && !returned;
        const d = String(c.returnDeadline || '').slice(0, 10);
        // ── أين كلُّ حاوية ───────────────────────────────────────────────────
        // المعاملةُ تُعَدّ بوحداتها: كم ما زال في الميناء، وكم في الساحة، وكم
        // سُلِّم، وكم لم يُرجَع — وكم من ذلك فات موعدُ إرجاعه.
        const U = { total: 0, atPort: 0, inYard: 0, delivered: 0, returned: 0, notReturned: 0, late: 0 };
        if (bucket === 'open') {
          for (const u of p.units || []) {
            const has = (k) => u.steps.some((s) => s.key === k && s.done);
            U.total += 1;
            if (has('transport_to_customer') || has('yard_to_customer')) U.delivered += 1;
            else if (has('transport_to_yard')) U.inYard += 1;
            else U.atPort += 1;
            if (c.cargoType !== 'vehicles') {
              if (has('containers_returned')) U.returned += 1;
              else { U.notReturned += 1; if (d && d < today) U.late += 1; }
            }
          }
        }
        const row = {
          _id: c._id, refNumber: c.refNumber, blNumber: c.blNumber || '', customerName: c.customerName || '',
          customerParty: c.customerParty || null, shippingAgent: c.shippingAgent || '', carrierName: c.carrierName || '',
          branch: c.branch, cargoType: c.cargoType === 'vehicles' ? 'vehicles' : 'containers', units: Number(c.containerCount) || 0,
          bucket, percent: p.percent, next: bucket === 'open' ? p.next : '',
          nextLabel: bucket === 'open' && p.next ? stageLabel(p.next, c.cargoType) : '',
          route: p.route,
          date: c.upcoming ? String(c.expectedDate || '').slice(0, 10) : txDateOf(c),
          port: c.port || '', declarationNumber: c.declarationNumber || '',
          createdAt: c.createdAt, createdBy: c.createdBy || null, createdByName: userName.get(String(c.createdBy || '')) || '',
          expectedDate: c.expectedDate || '', completedAt: c.completedAt || null,
          invoiceNumber: c.saleInvoiceNumber || '',
          // «فُوترت» تشمل ما فُوتر قبل النظام (مرحلتُه معلَّمةٌ بلا رقمِ فاتورةٍ هنا).
          invoiced: !!c.saleInvoiceNumber || p.steps.some((s) => s.key === 'invoiced' && s.done),
          awaitingTransportInvoice: awaitsTransportInvoice(c),
          returnDeadline: d, unitsState: U,
          returnState: !needsReturn || !d ? '' : (d < today ? 'overdue' : d <= soon ? 'due' : ''),
          pendingPayments: pendingBy.get(String(c._id)) || 0,
          openTasks: tasksByClearance.get(String(c._id)) || 0,
        };
        if (bucket === 'upcoming' && row.expectedDate) row.expectedState = row.expectedDate < today ? 'overdue' : '';
        return row;
      });

      const open = out.filter((r) => r.bucket === 'open');
      const count = (f) => out.filter(f).length;
      const customersOf = (list) => new Set(list.map((r) => String(r.customerParty || r.customerName || '')).filter(Boolean));

      // أين تقف المفتوحةُ: بالمرحلة التي تنتظرها كلٌّ منها.
      const stageOrder = CustomsClearance.STAGES;
      const byNext = new Map();
      for (const r of open) {
        const k = r.next || 'done';
        const e = byNext.get(k) || { key: k, label: k === 'done' ? 'اكتملت مراحلُها — تنتظر الإنهاء' : stageLabel(k), count: 0, units: 0 };
        e.count += 1; e.units += r.units; byNext.set(k, e);
      }
      const byStage = [...byNext.values()].sort((a, b) => (a.key === 'done' ? 99 : stageOrder.indexOf(a.key)) - (b.key === 'done' ? 99 : stageOrder.indexOf(b.key)));

      const custMap = new Map();
      for (const r of out) {
        if (r.bucket === 'cancelled') continue;
        const k = String(r.customerParty || r.customerName || '—');
        const e = custMap.get(k) || { key: k, party: r.customerParty || null, name: r.customerName || '—', upcoming: 0, open: 0, closed: 0, awaiting: 0, units: 0 };
        e[r.bucket] += 1; if (r.awaitingTransportInvoice) e.awaiting += 1; if (r.bucket === 'open') e.units += r.units;
        custMap.set(k, e);
      }

      // ── الفريق: ما على كلّ فردٍ الآن، وما فعله في ثلاثين يومًا ─────────────
      const idx = (list) => new Map(list.map((x) => [String(x._id), x]));
      const N = idx(notes); const P = idx(pays); const S = idx(ticks);
      const monthStart = startOfDay(`${today.slice(0, 7)}-01`).getTime();
      // الأرقامُ على المعاملات كلِّها لا على ما صفّاه فلترُ «مَن أنشأ».
      const scope = filter.createdBy
        ? await CustomsClearance.find((({ createdBy, ...rest }) => rest)(filter)).select('createdBy completedBy completedAt isCompleted cancelled upcoming').lean()
          .then((all) => all.map((c) => ({ ...c, bucket: c.cancelled ? 'cancelled' : c.upcoming ? 'upcoming' : c.isCompleted ? 'closed' : 'open' })))
        : rows.map((c, i) => ({ createdBy: c.createdBy, completedBy: c.completedBy, completedAt: c.completedAt, bucket: out[i].bucket }));
      // من أنهت الموارد البشريّة خدمتَه لا يُعدّ في الفريق — واسمُه يبقى على ما أنشأه.
      const team = users.filter((u) => !userEnded(ended, u)).map((u) => {
        const id = String(u._id);
        const mine = tasks.filter((t) => String(t.assignedTo) === id);
        const last = [N.get(id)?.last, P.get(id)?.last, S.get(id)?.last].filter(Boolean).map((d) => new Date(d).getTime());
        return {
          _id: u._id, name: nameOf(u), role: u.role, isManager: jp.managerRoles.includes(u.role),
          openCreated: scope.filter((c) => String(c.createdBy || '') === id && c.bucket === 'open').length,
          upcomingCreated: scope.filter((c) => String(c.createdBy || '') === id && c.bucket === 'upcoming').length,
          closedThisMonth: scope.filter((c) => String(c.completedBy || '') === id && c.completedAt && new Date(c.completedAt).getTime() >= monthStart).length,
          stages30: S.get(id)?.n || 0, notes30: N.get(id)?.n || 0, payments30: P.get(id)?.n || 0,
          tasksOpen: mine.filter((t) => taskState(t) !== 'done').length,
          tasksOverdue: mine.filter((t) => taskState(t) === 'overdue').length,
          lastActivityAt: last.length ? new Date(Math.max(...last)) : null,
        };
      }).sort((a, b) => (b.stages30 + b.notes30 + b.payments30) - (a.stages30 + a.notes30 + a.payments30));

      return {
        today,
        counts: {
          total: count((r) => r.bucket !== 'cancelled'),
          upcoming: count((r) => r.bucket === 'upcoming'),
          upcomingOverdue: count((r) => r.bucket === 'upcoming' && r.expectedState === 'overdue'),
          open: open.length,
          closed: count((r) => r.bucket === 'closed'),
          // أُغلقت ولم تُفوتَر — من السجلّ القديم؛ تبقى ظاهرةً حتى تُصدَر فواتيرُها.
          closedNotInvoiced: count((r) => r.bucket === 'closed' && !r.invoiced),
          cancelled: count((r) => r.bucket === 'cancelled'),
          awaitingTransportInvoice: count((r) => r.awaitingTransportInvoice),
          notInvoiced: open.filter((r) => !r.invoiced).length,
          activeCustomers: customersOf(open).size,
          customers: customersOf(out.filter((r) => r.bucket !== 'cancelled')).size,
          openUnits: open.reduce((a, r) => a + r.units, 0),
          openContainers: open.filter((r) => r.cargoType === 'containers').reduce((a, r) => a + r.units, 0),
          openVehicles: open.filter((r) => r.cargoType === 'vehicles').reduce((a, r) => a + r.units, 0),
          unitsAtPort: open.reduce((a, r) => a + r.unitsState.atPort, 0),
          unitsInYard: open.reduce((a, r) => a + r.unitsState.inYard, 0),
          unitsDelivered: open.reduce((a, r) => a + r.unitsState.delivered, 0),
          unitsNotReturned: open.reduce((a, r) => a + r.unitsState.notReturned, 0),
          unitsLate: open.reduce((a, r) => a + r.unitsState.late, 0),
          returnOverdue: count((r) => r.returnState === 'overdue'),
          returnDue: count((r) => r.returnState === 'due'),
          pendingPayments: open.reduce((a, r) => a + r.pendingPayments, 0),
          withPendingPayments: open.filter((r) => r.pendingPayments > 0).length,
          tasksOpen: tasks.filter((t) => taskState(t) !== 'done').length,
          tasksOverdue: tasks.filter((t) => taskState(t) === 'overdue').length,
          closedThisMonth: out.filter((r) => r.bucket === 'closed' && r.completedAt && new Date(r.completedAt).getTime() >= monthStart).length,
        },
        byStage,
        byCustomer: [...custMap.values()].sort((a, b) => b.open - a.open || b.upcoming - a.upcoming || b.closed - a.closed),
        byBranch: ['jeddah', 'dammam'].map((b) => ({ key: b, upcoming: count((r) => r.branch === b && r.bucket === 'upcoming'), open: count((r) => r.branch === b && r.bucket === 'open'), closed: count((r) => r.branch === b && r.bucket === 'closed') })),
        team,
        rows: out,
      };
    });
    res.json({ ...body, canManage: isManager, canSeeAnalytics: seesMoney(req) });
  } catch (e) {
    console.error('customs getDashboard:', e);
    res.status(500).json({ message: 'تعذّر تحميل لوحة القسم' });
  }
};

// ═══════════════════════════════════════════════════════════════════════════
//  الملاحظات — سطرٌ يُضاف، وآخرُه يُقرأ في الجدول
// ═══════════════════════════════════════════════════════════════════════════
const touchCustoms = (id) => {
  try { cache.clear('customs:'); } catch (_) { /* */ }
  try { emitToAll('customs:updated', { id: String(id || '') }); } catch (_) { /* */ }
};

exports.addNote = async (req, res) => {
  try {
    const text = String(req.body.text || '').trim().slice(0, 2000);
    if (!text) return res.status(400).json({ message: 'اكتب الملاحظة' });
    const clearance = await CustomsClearance.findById(req.params.id);
    if (!clearance) return res.status(404).json({ message: 'المعاملة غير موجودة' });
    const note = {
      text,
      by: req.user._id,
      byName: `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim() || req.user.name || '',
      at: new Date(),
    };
    clearance.notesLog.push(note);
    clearance.lastModifiedBy = req.user._id;
    await clearance.save();
    await logAudit({ user: req.user._id, action: 'customs_note', entity: 'CustomsClearance', entityId: clearance._id, changes: { after: { note: text } }, ipAddress: req.ip });
    touchCustoms(clearance._id);
    res.status(201).json({ note, notesLog: clearance.notesLog });
  } catch (e) { sendMongooseError(res, e, 'تعذّرت إضافة الملاحظة'); }
};

exports.deleteNote = async (req, res) => {
  try {
    const clearance = await CustomsClearance.findById(req.params.id);
    if (!clearance) return res.status(404).json({ message: 'المعاملة غير موجودة' });
    const note = clearance.notesLog.id(req.params.noteId);
    if (!note) return res.status(404).json({ message: 'الملاحظة غير موجودة' });
    // ملاحظةُ غيرِك لا تُحذف إلّا للمدير: هي أثرٌ لصاحبها.
    const boss = ['super_admin', 'admin', 'customs_manager'].includes(req.user.role);
    if (!boss && String(note.by || '') !== String(req.user._id)) {
      return res.status(403).json({ message: 'لا تُحذف ملاحظةُ غيرك' });
    }
    note.deleteOne();
    await clearance.save();
    touchCustoms(clearance._id);
    res.json({ notesLog: clearance.notesLog });
  } catch (e) { sendMongooseError(res, e, 'تعذّر حذف الملاحظة'); }
};

// ═══════════════════════════════════════════════════════════════════════════
//  العقود — عقدُنا مع عميلٍ أو وكيلٍ أو ناقل
// ═══════════════════════════════════════════════════════════════════════════
const CONTRACT_FIELDS = ['title', 'contractNumber', 'startDate', 'endDate', 'value', 'valueBasis',
  'paymentTermDays', 'autoRenew', 'status', 'scope', 'notes'];

/** أسعارُ العقد كما تُحفَظ: أرقامٌ أو فراغ، ووجهاتٌ لها اسمٌ وسعر. */
const cleanPricing = (p) => {
  if (!p || typeof p !== 'object') return undefined;
  const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Math.max(0, Number(v)));
  return {
    clearanceFeePerContainer: num(p.clearanceFeePerContainer),
    portToYard: num(p.portToYard),
    yardToCustomer: num(p.yardToCustomer),
    routes: (Array.isArray(p.routes) ? p.routes : []).slice(0, 100)
      .map((r) => ({ from: String(r?.from || '').trim().slice(0, 80), to: String(r?.to || '').trim().slice(0, 80), price: num(r?.price) }))
      .filter((r) => r.from || r.to || r.price !== null),
  };
};

/** العقدُ المنتهي يُقرأ منتهيًا وإن كُتب «ساري»: التاريخُ أصدقُ من الخانة. */
const withState = (c) => {
  const end = c.endDate ? new Date(c.endDate) : null;
  const expired = !!end && end.getTime() < Date.now();
  const daysLeft = end ? Math.ceil((end.getTime() - Date.now()) / 86400000) : null;
  return { ...c, expired, daysLeft, state: c.status === 'terminated' ? 'terminated' : expired ? 'expired' : c.status };
};

exports.listContracts = async (req, res) => {
  try {
    const filter = {};
    if (PARTY_KINDS.includes(req.query.kind)) filter.partyKind = req.query.kind;
    if (req.query.party) filter.party = req.query.party;
    if (req.query.status) filter.status = req.query.status;
    const q = String(req.query.q || '').trim();
    if (q) {
      const rx = partyRx(q);
      filter.$or = [{ title: rx }, { contractNumber: rx }, { partyName: rx }, { scope: rx }];
    }
    const rows = await CustomsContract.find(filter).sort({ createdAt: -1 }).lean();
    res.json({ contracts: rows.map(withState) });
  } catch (e) {
    console.error('listContracts error:', e);
    res.status(500).json({ message: 'تعذّر تحميل العقود' });
  }
};

exports.createContract = async (req, res) => {
  try {
    const party = await CustomsParty.findById(req.body.party).lean();
    if (!party) return res.status(400).json({ message: 'اختر الطرف' });
    if (!String(req.body.title || '').trim()) return res.status(400).json({ message: 'اسم العقد مطلوب' });
    const body = stripEmpty(req.body, CustomsContract.schema);
    const doc = await CustomsContract.create({
      ...Object.fromEntries(CONTRACT_FIELDS.map((f) => [f, body[f]]).filter(([, v]) => v !== undefined)),
      ...(cleanPricing(req.body.pricing) ? { pricing: cleanPricing(req.body.pricing) } : {}),
      party: party._id,
      partyKind: party.kind,
      partyName: party.name,
      createdBy: req.user._id,
      createdByName: `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim(),
    });
    await logAudit({ user: req.user._id, action: 'create_customs_contract', entity: 'CustomsContract', entityId: doc._id, changes: { after: { title: doc.title, party: party.name } }, ipAddress: req.ip });
    try { emitToAll('customs:contract', { id: String(doc._id) }); } catch (_) { /* */ }
    res.status(201).json({ contract: withState(doc.toObject()) });
  } catch (e) { sendMongooseError(res, e, 'تعذّر حفظ العقد'); }
};

exports.updateContract = async (req, res) => {
  try {
    const doc = await CustomsContract.findById(req.params.id);
    if (!doc) return res.status(404).json({ message: 'العقد غير موجود' });
    if (req.body.party && String(req.body.party) !== String(doc.party)) {
      const party = await CustomsParty.findById(req.body.party).lean();
      if (!party) return res.status(400).json({ message: 'الطرف غير موجود' });
      doc.party = party._id; doc.partyKind = party.kind; doc.partyName = party.name;
    }
    for (const f of CONTRACT_FIELDS) if (req.body[f] !== undefined) doc[f] = req.body[f] === '' ? (doc.schema.path(f)?.instance === 'Number' ? null : '') : req.body[f];
    if (req.body.pricing !== undefined) doc.pricing = cleanPricing(req.body.pricing) || {};
    doc.lastModifiedBy = req.user._id;
    await doc.save();
    try { emitToAll('customs:contract', { id: String(doc._id) }); } catch (_) { /* */ }
    res.json({ contract: withState(doc.toObject()) });
  } catch (e) { sendMongooseError(res, e, 'تعذّر حفظ العقد'); }
};

exports.deleteContract = async (req, res) => {
  try {
    const doc = await CustomsContract.findById(req.params.id);
    if (!doc) return res.status(404).json({ message: 'العقد غير موجود' });
    // الورقُ يُحذف مع صفّه، وإلّا بقي ملفٌّ لا يشير إليه شيء.
    for (const a of doc.attachments || []) { try { deleteStoredFile(a.fileUrl); } catch (_) { /* */ } }
    await doc.deleteOne();
    await logAudit({ user: req.user._id, action: 'delete_customs_contract', entity: 'CustomsContract', entityId: doc._id, changes: { before: { title: doc.title, party: doc.partyName } }, ipAddress: req.ip });
    try { emitToAll('customs:contract', { id: String(doc._id) }); } catch (_) { /* */ }
    res.json({ ok: true });
  } catch (e) { sendMongooseError(res, e, 'تعذّر حذف العقد'); }
};

exports.addContractFiles = async (req, res) => {
  try {
    const doc = await CustomsContract.findById(req.params.id);
    if (!doc) return res.status(404).json({ message: 'العقد غير موجود' });
    const incoming = Array.isArray(req.body.files) ? req.body.files : [req.body];
    const added = [];
    for (const f of incoming) {
      if (!f || !f.dataUrl) continue;
      let stored;
      try { stored = saveUploadFile(f.dataUrl, 'customs', f.fileName || ''); }
      catch (e) { return res.status(400).json({ message: e.message }); }
      const att = {
        ...stored,
        title: String(f.title || '').trim().slice(0, 200),
        uploadedBy: req.user._id,
        uploadedByName: `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim(),
        uploadedAt: new Date(),
      };
      doc.attachments.push(att);
      added.push(att);
    }
    if (!added.length) return res.status(400).json({ message: 'لا ملفات' });
    await doc.save();
    try { emitToAll('customs:contract', { id: String(doc._id) }); } catch (_) { /* */ }
    res.status(201).json({ contract: withState(doc.toObject()) });
  } catch (e) { sendMongooseError(res, e, 'تعذّر رفع الملف'); }
};

exports.deleteContractFile = async (req, res) => {
  try {
    const doc = await CustomsContract.findById(req.params.id);
    if (!doc) return res.status(404).json({ message: 'العقد غير موجود' });
    const att = doc.attachments.id(req.params.attId);
    if (!att) return res.status(404).json({ message: 'الملف غير موجود' });
    try { deleteStoredFile(att.fileUrl); } catch (_) { /* */ }
    att.deleteOne();
    await doc.save();
    try { emitToAll('customs:contract', { id: String(doc._id) }); } catch (_) { /* */ }
    res.json({ contract: withState(doc.toObject()) });
  } catch (e) { sendMongooseError(res, e, 'تعذّر حذف الملف'); }
};

// ═══════════════════════════════════════════════════════════════════════════
//  مرفقاتُ الأطراف — العميلُ والوكيلُ والناقل
// ═══════════════════════════════════════════════════════════════════════════
const partyCardOf = (p) => ({
  _id: p._id, kind: p.kind, name: p.name, phone: p.phone, email: p.email, contactPerson: p.contactPerson,
  commercialRegister: p.commercialRegister, taxNumber: p.taxNumber, address: p.address, city: p.city, notes: p.notes,
  attachments: p.attachments || [],
});

/**
 * GET /:id/parties-card — بطاقاتُ أطراف المعاملة (العميل والوكيل والناقل):
 * بياناتُهم ومرفقاتُهم، تُقرأ في صفحة المعاملة بلا فتح ملفّ كلٍّ منهم.
 */
exports.getClearanceParties = async (req, res) => {
  try {
    const c = await CustomsClearance.findById(req.params.id).select('customerParty agentParty carrierParty customerName shippingAgent carrierName').lean();
    if (!c) return res.status(404).json({ message: 'Clearance not found' });
    const ids = [c.customerParty, c.agentParty, c.carrierParty].filter(Boolean);
    const rows = await CustomsParty.find({ _id: { $in: ids } }).lean();
    const by = new Map(rows.map((p) => [String(p._id), partyCardOf(p)]));
    const pick = (id, kind, name) => (id && by.get(String(id))) || (name ? { kind, name, attachments: [], unlinked: true } : null);
    res.json({
      customer: pick(c.customerParty, 'customer', c.customerName),
      agent: pick(c.agentParty, 'agent', c.shippingAgent),
      carrier: pick(c.carrierParty, 'carrier', c.carrierName),
    });
  } catch (e) { res.status(500).json({ message: 'تعذّر تحميل الأطراف' }); }
};

// POST /parties/:id/attachments { files: [{ dataUrl, fileName, title }] }
exports.addPartyAttachments = async (req, res) => {
  try {
    const party = await CustomsParty.findById(req.params.id);
    if (!party) return res.status(404).json({ message: 'غير موجود' });
    const incoming = Array.isArray(req.body.files) ? req.body.files : [];
    if ((party.attachments || []).length + incoming.length > 40) return res.status(400).json({ message: 'لا يُرفَق أكثر من ٤٠ ملفًّا للطرف' });
    const added = [];
    for (const f of incoming) {
      if (!f || !f.dataUrl) continue;
      let stored;
      try { stored = saveUploadFile(f.dataUrl, 'customs', f.fileName || ''); }
      catch (e) { return res.status(400).json({ message: 'نوعُ الملفّ غير مدعوم أو حجمُه أكبر من ٢٠ ميغابايت' }); }
      added.push({ ...stored, title: String(f.title || f.fileName || '').trim().slice(0, 200), uploadedByName: [req.user.firstName, req.user.lastName].filter(Boolean).join(' '), uploadedAt: new Date() });
    }
    if (!added.length) return res.status(400).json({ message: 'لا ملفّات' });
    party.attachments.push(...added);
    await party.save();
    logAudit({ user: req.user, action: 'customs_party_attach', entity: 'CustomsParty', entityId: party._id, changes: { details: `${party.name}: ${added.map((a) => a.title).join('، ')}` }, ipAddress: req.ip }).catch(() => {});
    cache.clear('customs:');
    try { emitToAll('customs:updated', { party: String(party._id) }); } catch (e) { /* */ }
    res.status(201).json({ party: partyCardOf(party.toObject()) });
  } catch (e) { return sendMongooseError(res, e, 'تعذّر رفع الملفّات'); }
};

// PUT /parties/:id/attachments/:attId { title } · DELETE /parties/:id/attachments/:attId
exports.updatePartyAttachment = async (req, res) => {
  try {
    const party = await CustomsParty.findById(req.params.id);
    const a = party && party.attachments.id(req.params.attId);
    if (!a) return res.status(404).json({ message: 'غير موجود' });
    a.title = String(req.body.title || '').trim().slice(0, 200);
    await party.save();
    try { emitToAll('customs:updated', { party: String(party._id) }); } catch (e) { /* */ }
    res.json({ party: partyCardOf(party.toObject()) });
  } catch (e) { return sendMongooseError(res, e, 'تعذّر الحفظ'); }
};
exports.deletePartyAttachment = async (req, res) => {
  try {
    const party = await CustomsParty.findById(req.params.id);
    const a = party && party.attachments.id(req.params.attId);
    if (!a) return res.status(404).json({ message: 'غير موجود' });
    const gone = { title: a.title, fileUrl: a.fileUrl };
    a.deleteOne();
    await party.save();
    try { require('../utils/fileStore').deleteStoredFile(gone.fileUrl); } catch (e) { /* الملفُّ يبقى إن تعذّر حذفُه */ }
    logAudit({ user: req.user, action: 'customs_party_detach', entity: 'CustomsParty', entityId: party._id, changes: { details: `${party.name}: ${gone.title}` }, ipAddress: req.ip }).catch(() => {});
    try { emitToAll('customs:updated', { party: String(party._id) }); } catch (e) { /* */ }
    res.json({ party: partyCardOf(party.toObject()) });
  } catch (e) { return sendMongooseError(res, e, 'تعذّر الحذف'); }
};

// ═══════════════════════════════════════════════════════════════════════════
//  أسعارُ عقد العميل ← الإيرادات والفوترة
// ═══════════════════════════════════════════════════════════════════════════
/** GET /:id/contract-pricing — عقدُ العميل الساري ووجهاتُه وما يقوله لهذه المعاملة. */
exports.getContractPricing = async (req, res) => {
  try {
    const c = await CustomsClearance.findById(req.params.id).select('customerParty containerCount city contractPricing').lean();
    if (!c) return res.status(404).json({ message: 'Clearance not found' });
    const contract = await contractPricing.activeCustomerContract(c.customerParty);
    res.json({ contract: contractPricing.contractSummary(contract, c) });
  } catch (e) {
    console.error('getContractPricing:', e);
    res.status(500).json({ message: 'تعذّر قراءة عقد العميل' });
  }
};

/**
 * POST /:id/apply-contract { from?, to? } — «تعبئة من العقد»: يكتب أسعارَ العقد
 * في خانات الإيراد كلِّها (ولو عُدِّلت)، وباختيار الوجهة يُكتب سعرُها.
 */
exports.applyContractPricing = async (req, res) => {
  try {
    const clearance = await CustomsClearance.findById(req.params.id);
    if (!clearance) return res.status(404).json({ message: 'Clearance not found' });
    const contract = await contractPricing.activeCustomerContract(clearance.customerParty);
    if (!contract) return res.status(400).json({ message: 'لا يوجد عقدٌ ساري بأسعار لهذا العميل — أضِف الأسعار في عقده أوّلًا', code: 'NO_CONTRACT' });
    const current = clearance.toObject();
    const target = {};
    const opts = { overwrite: true };
    if (req.body.from !== undefined || req.body.to !== undefined) { opts.from = String(req.body.from || ''); opts.to = String(req.body.to || ''); }
    contractPricing.fillRevenue(target, current, contract, opts);
    clearance.revenue = { ...current.revenue, ...target.revenue };
    clearance.contractPricing = target.contractPricing;
    clearance.lastModifiedBy = req.user._id;
    await clearance.save();
    await logAudit({
      user: req.user._id, action: 'update_customs_clearance', entity: 'CustomsClearance', entityId: clearance._id,
      changes: { after: { refNumber: clearance.refNumber, contractPricing: contract.title, route: `${target.contractPricing.routeFrom} → ${target.contractPricing.routeTo}` } },
      ipAddress: req.ip,
    }).catch(() => {});
    try { emitToAll('customs:updated', { clearance }); } catch (_) { /* */ }
    cache.clear('customs:');
    res.json({ clearance, contract: contractPricing.contractSummary(contract, clearance.toObject()) });
  } catch (e) {
    return sendMongooseError(res, e, 'تعذّر التعبئة من العقد');
  }
};
