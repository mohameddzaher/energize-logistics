/**
 * النقلُ الخفيف — موظّفوه وسكنُهم وأوامرُ تشغيلهم.
 *
 * ── ما يُقرأ من أين ─────────────────────────────────────────────────────────
 * الإنسانُ في الموارد البشريّة، والمركبةُ في سجلّ المركبات، وما يخصّ هذا القسمَ
 * هنا. فالقائمةُ تجمع الثلاثةَ في صفٍّ واحد، ولا تُنسَخ خانةٌ لها صاحبٌ في
 * مكانٍ آخر — راجع تعليقَ models/LightTransport.
 *
 * وحالةُ الخدمة تُقرأ حيّةً من ملفّ الموارد البشريّة في كلّ نداء: من أُنهيت
 * خدمتُه هناك يُقرأ هنا خارجَ العمل في اللحظة نفسها، بلا مزامنةٍ ولا مهمّةٍ
 * مجدولةٍ تنسى.
 */
const mongoose = require('mongoose');
const { listSupervisors, resolveSupervisor, syncRepSupervisor, fold: foldAr } = require('../utils/b2cSupervisors');
const VDOC = require('../config/vehicleDocuments');
const { VehicleRegistryConfig } = require('../models/VehicleMaster');

/**
 * عتباتُ تنبيه المستندات — من إعدادات قسم المركبات، لا من أرقامٍ تُكتب هنا.
 * الوثيقةُ هناك والعتبةُ هناك؛ ولو نُسخت العتبةُ إلى هذا القسم لصار تغييرُها في
 * موضعٍ لا يُغيّرها في الآخر، فقال كارتٌ واحدٌ «حرج» في شاشةٍ و«ساري» في أخرى.
 */
const docAlerts = async () => {
  const hit = cache.get('lt:doc-alerts');
  if (hit !== undefined) return hit;
  const cfg = await VehicleRegistryConfig.findOne({ key: 'vehicle-registry' }).select('alerts').lean();
  const alerts = cfg?.alerts || {};
  cache.set('lt:doc-alerts', alerts, 60000);
  return alerts;
};
const { LightTransportEmployee, LightTransportHousing, LightTransportOrder } = require('../models/LightTransport');
const Employee = require('../models/Employee');
const { VehicleMaster } = require('../models/VehicleMaster');
const logAudit = require('../utils/auditLogger');
const { emitToAll } = require('../websocket/socketManager');
const cache = require('../utils/ttlCache');

const emit = (event, payload = {}) => {
  // تُمحى الذاكرةُ قبل البثّ لا بعده، وإلّا قرأ المستمعون القديمَ — راجع
  // utils/ttlCache وقاعدةَ «أعلِن بعد الإبطال». (كان البثُّ أوّلًا.)
  cache.clear('lt:');
  try { emitToAll(event, payload); } catch (e) { /* البثُّ لا يُوقف العمل */ }
};

const S = (v) => String(v == null ? '' : v).trim();
const byName = (u) => [u?.firstName, u?.lastName].filter(Boolean).join(' ');


/**
 * ── مفردتان لنوعِ المركبة الواحد ────────────────────────────────────────────
 * سجلُّ المركبات يكتب «دراجة آلية» (نوعُ التسجيل الرسميّ) وشيتُ القسم يكتب
 * «دراجة نارية». وهما شيءٌ واحد. فالفلترُ على إحداهما كان يردّ صفرًا من الجهة
 * الأخرى: «الدراجات» تُظهر مئةً وخمسًا وتسعين مركبةً وصفرَ موظّف.
 *
 * والنوعُ يخصّ المركبةَ لا الإنسان، فيُقرأ من سجلّ المركبات متى كانت مربوطةً،
 * وتبقى خانةُ الموظّف لمن لا مركبةَ له في السجلّ. وهذا الجدولُ يجمع المفردتين
 * كي يُفلتَر بأيٍّ منهما.
 */
const TYPE_ALIASES = [
  ['دراجة آلية', 'دراجة نارية', 'دراجه ناريه', 'دراجة'],
  ['خاص', 'كيا', 'كيا بيجاز', 'فان'],
];
const typeKey = (v) => {
  const x = S(v).replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/\s+/g, '');
  for (const group of TYPE_ALIASES) {
    if (group.some((g) => S(g).replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/\s+/g, '') === x)) return group[0];
  }
  return S(v);
};


/**
 * ── واللوحةُ تُقرأ بأيّ ترتيب ───────────────────────────────────────────────
 * سجلُّ المركبات يكتبها «ص ب 7918» والشيتُ يكتبها «7918 ص ب» — والمخالفةُ تُملى
 * بالهاتف بأيّهما وقع. فالبحثُ الحرفيُّ يردّ صفرًا والمركبةُ عندنا، وهو ما وقع
 * فعلًا: سُئل عن سبع لوحاتٍ فلم تظهر واحدةٌ منها وهي مسجّلة.
 *
 * فيُطوى ترتيبُ الحروف والأرقام: تُقارَن اللوحةُ بمفتاحها (أرقامٌ + حروفٌ
 * مرتَّبة) كما يفعل قسمُ المركبات نفسُه، فما يُكتب بأيّ ترتيبٍ يجد صاحبَه.
 */
const plateKeyOf = (p) => {
  const w = S(p).replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d))
    .replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/[ىئ]/g, 'ي').replace(/ؤ/g, 'و');
  const digits = (w.match(/\d+/g) || []).join('');
  const letters = (w.match(/[\u0621-\u064AA-Za-z]/g) || []).map((c) => c.toUpperCase()).sort().join('');
  const k = `${digits}|${letters}`;
  return k === '|' ? null : k;
};

/** أهذا النصُّ لوحةٌ؟ حروفٌ وأرقامٌ معًا، وأربعةُ أرقامٍ فأقلّ — لا اسمٌ ولا هويّة. */
const looksLikePlate = (t) => {
  const w = S(t);
  const digits = (w.match(/[0-9٠-٩]/g) || []).length;
  const letters = (w.match(/[\u0621-\u064AA-Za-z]/g) || []).length;
  return digits >= 3 && digits <= 4 && letters >= 2 && letters <= 6;
};

/**
 * ── حالةُ العمل: يعمل · إجازة · موقوف · حادث ────────────────────────────────
 * التوظيفُ وإنهاءُ الخدمة من الموارد البشريّة وحدَها (قرارُ ٢٠٢٦/١٠/١٩)، وحالةُ
 * اليوم التشغيليّةُ يكتبها القسمُ في `opStatus` (طلبُ ٢٠٢٦/١٠/٢١). والقاعدةُ
 * كاملةً في utils/b2cBoard — تقرؤها اللوحةُ والقائمتان فلا يختلف رقمٌ عن قائمته.
 */
const BOARD = require('../utils/b2cBoard');
const { shownStatus } = BOARD;

/**
 * ── وثيقتا المركبة كما تُقرآن في هذا القسم ──────────────────────────────────
 *
 * بطاقةُ التشغيل والفحصُ الدوريُّ يعيشان على سجلّ المركبات، وعتباتُ التنبيه
 * (حرج · تحذير · قريب) تُضبَط في إعدادات قسم المركبات. فتُقرأ الحالةُ بالحساب
 * نفسِه (`VDOC.stateOf`) وبالعتبات نفسِها — وإلّا قالت شاشتان لوثيقةٍ واحدةٍ
 * حالتين، وهو أسوأُ من ألّا تُقال.
 */
const docOf = (vehicle, key, alerts) => {
  const d = vehicle && typeof vehicle === 'object' ? vehicle[key] : null;
  const st = VDOC.stateOf(d?.expiryDate, d?.statusCode, alerts?.[key] || {});
  return {
    expiryDate: d?.expiryDate || null,
    number: d?.cardNumber || '',
    statusAr: d?.statusAr || '',
    state: VDOC.publicState(st.state),
    days: st.days,
  };
};

const decorate = (row, alerts = {}) => ({
  ...row,
  // عبارةُ «أُضيف من شيت المركبات…» من الاستيراد ليست ملاحظةً — النظامُ هو المرجع.
  notesAr: require('../utils/importLabels').stripImportNote(row.notesAr),
  ...(Array.isArray(row.history) ? { history: row.history.map(require('../utils/importLabels').cleanHistoryEntry) } : {}),
  workStatusShown: shownStatus(row),
  // «كارتُ التشغيل والفحصُ» — من مركبته، بحالتهما لا بتاريخهما وحدَه.
  operatingCard: docOf(row.vehicle, 'operatingCard', alerts),
  inspection: docOf(row.vehicle, 'inspection', alerts),
  // نوعُ المركبة من سجلّها متى كانت مربوطةً — وهو مكتوبٌ هناك رسميًّا.
  vehicleTypeShown: (row.vehicle && typeof row.vehicle === 'object' ? row.vehicle.registrationTypeAr : '') || row.vehicleTypeAr || '',
  // ومن أين جاء الخبر — فلا يُسأل «مين غيّر الحالة؟».
  statusSource: BOARD.statusSource(row),
  // الفئةُ ونوعُ الارتباط والسجلّ — بالمعاني التي تعدّ بها اللوحة (utils/b2cBoard).
  categoryShown: BOARD.categoryOf(row),
  engagementShown: BOARD.engagementOf(row),
  registerShown: BOARD.registerOf(row),
  // تفويضُ مركبته من سجلّ المركبات (المرجع) — `BOARD.authOf` وحدَها تقرؤه.
  authState: row.vehicle && typeof row.vehicle === 'object' ? BOARD.authOf(row.vehicle) : '',
  hrLinked: !!row.employee,
  // نوعُ العقد كما يُعرَض ويُعَدّ: من الموارد البشريّة لمن له ملف — راجع contractKindOf.
  contractTypeShown: ({ sponsored: 'كفالة', freelance: 'فري لانسر', users: 'يوزرات' })[contractKindOf(row)] || '',
  employeeNumber: row.employee && typeof row.employee === 'object' ? row.employee.employeeNumber : '',
});

/**
 * ── والفلترُ بالمشرف يقبل الحساب والاسم ────────────────────────────────────
 * صار المشرفُ حسابًا، فالفلترُ بالمعرِّف. ويبقى الاسمُ مقبولًا لأنّ روابطَ
 * محفوظةً ونسخًا من التطبيق تُرسله، ولأنّ من لا حسابَ لمشرفه بعد يبقى مفلتَرًا
 * باسمه المكتوب — فلا يختفي صفٌّ من شاشةٍ كان يُرى فيها.
 */
/**
 * ── قطاعُ النقل الخفيف مطويًّا ────────────────────────────────────────────────
 *
 * قسمُ الأفراد (b2c) هو قسمُ النقل الخفيف، ومركباتُه تُعرَف بقطاعها في سجلّ
 * المركبات. وكان المطابقُ نصًّا حرفيًّا («النقل الخفيف») — فمركبةٌ تُنشَأ هناك
 * بكتابة «نقل خفيف» أو بمسافةٍ زائدة لا تصل إلى هذا القسم أبدًا، ولا يُعرَف
 * لماذا. فالمطابقةُ بالكلمة: ما فيه «خفيف» فهو منه.
 */
const LIGHT_SECTOR = /خفيف/;

const supervisorFilter = (filter, value, field = 'supervisorUser') => {
  const v = S(value);
  if (!v) return;
  const nameField = field === 'supervisorUser' ? 'supervisorName' : 'dutySupervisorName';
  if (v === 'none') { filter[field] = null; return; }
  if (mongoose.isValidObjectId(v)) filter[field] = v;
  else filter[nameField] = v;
};

// ── قائمةُ الموظّفين ────────────────────────────────────────────────────────
const LIST_POPULATE = [
  { path: 'employee', select: 'employeeNumber arabicName firstName lastName employmentStatus phone registerNumber staffCategory jobTitle department project' },
  { path: 'supervisor', select: 'arabicName firstName lastName employeeNumber' },
  { path: 'supervisorUser', select: 'firstName lastName email role' },
  { path: 'dutySupervisorUser', select: 'firstName lastName email role' },
  // ── وبطاقةُ التشغيل والفحصُ يُقرآن مع المركبة ──────────────────────────
  // «كارتُ تشغيلِ مَن ينتهي هذا الشهر؟» سؤالٌ يُسأل في هذا القسم لا في قسم
  // المركبات: المشرفُ يوقف الرجلَ لا المركبة. والوثيقتان على سجلّ المركبات —
  // فتُقرآن معه في النداء نفسِه، ولا تُنسَخان هنا فتفترقا عن أصلهما.
  // ومعها ورقةُ تفويضها وقائدُها الفعليّ: الشيتُ يحملهما عمودين، والسؤالُ عنهما
  // يقع على الرجل لا على المركبة — «مين المفوَّض؟ ومين اللي راكبها فعلًا؟».
  { path: 'vehicle', select: 'plateNumber serialNumber registrationTypeAr brandAr modelAr operatingCard inspection authorizedPerson actualDriver' },
  { path: 'housing', select: 'name cityAr' },
];

exports.listEmployees = async (req, res) => {
  try {
    const q = req.query || {};
    const filter = {};
    if (q.active !== 'all') filter.isActive = { $ne: false };
    // قيمٌ مفصولةٌ بفاصلة (فلاترُ اللوحة السريعة) أو قيمةٌ واحدة كما كانت.
    for (const [key, field] of [['jobTitle', 'jobTitleAr'],
      ['contractType', 'contractTypeAr'], ['register', 'registerNumber'],
      ['staffKind', 'staffKind']]) {
      const v = BOARD.vals(q[key]);
      if (v.length) filter[field] = v.length === 1 ? v[0] : { $in: v };
    }
    if (BOARD.vals(q.city).length) {
      const v = BOARD.vals(q.city);
      filter.cityAr = { $in: v.includes('—') ? [...v, '', null] : v };
    }
    // المشروعُ بالطيّ كما تعدّه اللوحة (`projectKey`): «هنقرستيشن» يفتح
    // «هنجرستيشن» أيضًا — وإلّا قال الكارتُ عددًا وفتح الرابطُ نصفَه.
    // و«(غير محدد)» اسمُ اللوحة لمن لا مشروعَ مكتوبًا له — فيفتح الفارغين.
    if (BOARD.vals(q.project).length) {
      const wants = new Set(BOARD.vals(q.project).map(BOARD.projectKey));
      const names = (await LightTransportEmployee.distinct('projectAr')).filter((n) => wants.has(BOARD.projectKey(n)));
      filter.projectAr = { $in: wants.has('') ? [...names, null, ''] : names };
    }
    supervisorFilter(filter, q.supervisor);
    supervisorFilter(filter, q.dutySupervisor, 'dutySupervisorUser');
    if (S(q.housing)) filter.housing = S(q.housing) === 'none' ? null : S(q.housing);
    // ومن له مركبةٌ ومن لا مركبةَ له — سؤالٌ يُسأل كثيرًا.
    if (q.hasVehicle === 'yes') filter.vehicle = { $ne: null };
    if (q.hasVehicle === 'no') filter.vehicle = null;
    if (S(q.hiredFrom) || S(q.hiredTo)) {
      filter.hireDate = {};
      if (S(q.hiredFrom)) filter.hireDate.$gte = new Date(S(q.hiredFrom));
      // الحدُّ الأعلى شاملٌ لليوم نفسِه — وإلّا سقط آخرُ يومٍ من كلّ مدّة.
      if (S(q.hiredTo)) filter.hireDate.$lte = new Date(`${S(q.hiredTo)}T23:59:59.999Z`);
    }
    /**
     * ── والبحثُ يجد بأيّ رقمٍ في يدِ السائل ─────────────────────────────────
     * مَن يسأل عن سائقٍ يحمل ما وقع في يده: اسمَه، أو لوحتَه، أو رقمَ هويّته أو
     * إقامته، أو الرقمَ التسلسليَّ للمركبة، أو رقمَ التفويض. وثلاثةٌ من هذه لا
     * توجد في صفّ الموظّف أصلًا — هي في سجلّ المركبات. فبحثٌ يقتصر على صفوفنا
     * يقول «لا نتائج» والمركبةُ عندنا.
     *
     * فالرقمُ يُبحَث عنه في سجلّ المركبات أوّلًا، وما يُوجَد يُضاف إلى الشرط
     * بمعرِّف المركبة — سؤالٌ صغيرٌ واحد، وجوابُه يفتح البابَ من الجهة الأخرى.
     */
    if (S(q.q)) {
      const { arabicSearchRegex } = require('../utils/arabicSearch');
      const term = S(q.q);
      const rx = arabicSearchRegex(term);
      const or = [{ name: rx }, { idNumber: rx }, { vehiclePlate: rx }, { phone: rx },
        { supervisorName: rx }, { projectAr: rx }, { cityAr: rx }, { jobTitleAr: rx },
        { contractTypeAr: rx }, { registerNumber: rx }, { vehicleTypeAr: rx }, { notesAr: rx }];
      const vm = await VehicleMaster.find({
        $or: [{ plateNumber: rx }, { serialNumber: rx }, { chassisNumber: rx },
          { 'authorizedPerson.name': rx }, { 'authorizedPerson.iqamaNumber': rx },
          { 'authorizedPerson.authorizationNumber': rx }],
      }).select('_id').limit(400).lean();
      const ids = vm.map((v) => v._id);
      // ولو بدا النصُّ لوحةً، تُطابَق بمفتاحها المطويّ — فترتيبُ الحروف والأرقام
      // لا يمنع العثور. راجع `plateKeyOf`.
      if (looksLikePlate(term)) {
        const want = plateKeyOf(term);
        const byKey = await VehicleMaster.find({}).select('_id plateNumber').lean();
        for (const v of byKey) if (plateKeyOf(v.plateNumber) === want) ids.push(v._id);
        const ltByPlate = await LightTransportEmployee.find({ vehiclePlate: { $nin: ['', null] } })
          .select('_id vehiclePlate').lean();
        const hit = ltByPlate.filter((x) => plateKeyOf(x.vehiclePlate) === want).map((x) => x._id);
        if (hit.length) or.push({ _id: { $in: hit } });
      }
      if (ids.length) or.push({ vehicle: { $in: ids } });
      filter.$or = or;
    }

    // المؤرشَفُ لا صفَّ له هنا — كأنّه حُذف؛ والمنتهي يبقى صفًّا (تحت).
    const { endedStaff, notArchivedRow, andAll } = require('../utils/archivedHidden');
    let rows = await LightTransportEmployee.find(andAll(filter, notArchivedRow(await endedStaff())))
      .populate(LIST_POPULATE).sort({ name: 1 }).lean();
    await BOARD.markHrLeave(rows);
    await require('../utils/ltRental').markRentals(rows);
    const alerts = await docAlerts();
    rows = rows.map((r) => decorate(r, alerts));
    /**
     * ── وفلاترُ اللوحة تُطبَّق بمعناها في اللوحة ──────────────────────────────
     * الحالةُ والفئةُ ونوعُ الارتباط والسجلُّ والمندوبُ والمركبةُ والتفويض —
     * مشتقّةٌ من سجلَّين أو ثلاثة، فتُطبَّق بعد الاشتقاق بـ`personTests` نفسِها التي
     * تعدّ بها اللوحة: الرقمُ المضغوطُ يفتح أصحابَه بأعيانهم.
     */
    const tests = BOARD.personTests(
      Object.fromEntries(['status', 'vehicleType', 'rep', 'vehicle', 'auth', 'cr', 'engagement', 'category'].map((k) => [k, q[k]])),
      { typeKey },
    );
    rows = rows.filter((r) => tests(r));
    /**
     * ── وأرقامُ «إجمالي المناديب» تُفتَح بأصحابها ─────────────────────────────
     * نوعُ العقد بالطيّ نفسِه الذي يعدّ به `repsBreakdown` (`contractIs`)، و«none»
     * لمن لا نوعَ عقدٍ مكتوبًا له. و`inService=1` يُسقِط المنتهين كما تُسقطهم
     * اللوحة — فالقائمةُ المفتوحة من رقمٍ تعرض الذين عُدّوا فيه بأعيانهم.
     */
    const ck = S(q.contractKind);
    if (ck === 'sponsored' || ck === 'freelance' || ck === 'users') rows = rows.filter((r) => contractIs(r, ck));
    if (ck === 'none') rows = rows.filter((r) => !contractKindOf(r));
    if (q.inService === '1') rows = rows.filter((r) => !isEnded(r));

    res.json({ employees: rows, totals: totalsOf(rows, { includeEnded: BOARD.vals(q.status).includes(ENDED) }), options: await optionsOf() });
  } catch (e) {
    console.error('lt listEmployees:', e);
    res.status(500).json({ message: 'تعذّر تحميل موظّفي النقل الخفيف' });
  }
};

/**
 * ── منتهي الخدمة لا يظهر في اللوحة ─────────────────────────────────────────
 * قاعدةُ صاحب الشركة (٢٠٢٦/١٠/١٩) في كلّ الأقسام عدا الموارد البشريّة: مَن
 * انتهت خدمتُه لا يدخل رقمًا واحدًا من أرقام اللوحة — ولا كارتَ «أُنهيت خدمتهم»
 * ولا توزيعَ الحالات. كان «الإداريّون ١٦» وواحدٌ منهم منتهٍ في الموارد
 * البشريّة، والمراجِعُ يقارن بالموارد البشريّة فيجد ١٥. ويبقى صفُّه في قائمة
 * الموظّفين يُبحَث عنه ويُراجَع ملفُّه — القائمةُ سجلٌّ، واللوحةُ أرقام.
 * والمنتهي: «إنهاء خدمة» (من الموارد البشريّة) أو صفٌّ أُخرج من سجلّ القسم.
 */
const ENDED = 'إنهاء خدمة';
const isEnded = (r) => r.workStatusShown === ENDED || r.isActive === false;
exports.isEnded = isEnded;

/**
 * صفوفُ القسم لمن انتهت خدمتُه — ليُستثنَوا من عدِّ الساكنين. السكنُ سريرٌ يُعَدّ:
 * منتهٍ بقي اسمُه على غرفةٍ يجعلها «مكتملة» ويردّ مَن يحتاجها. والحالةُ من
 * الموارد البشريّة متى وُجد ملف، وإلّا آخرُ ما كُتب في السجلّ.
 */
async function endedRowIds() {
  const { endedStaff } = require('../utils/endedStaff');
  const sets = await endedStaff();
  const rows = await LightTransportEmployee.find({
    housing: { $ne: null },
    $or: [{ employee: { $in: [...sets.ids].map((x) => new mongoose.Types.ObjectId(x)) } }, { employee: null, workStatusAr: ENDED }],
  }).select('_id').lean();
  return rows.map((r) => r._id);
}

/**
 * الكفالةُ والفري لانسر بالطيّ لا بالنصّ: الشيتُ يكتب «كفاله» و«كفالة» و«فري
 * لانسر» و«فريلانسر». وما لا نوعَ عقدٍ مكتوبًا له ليس أيًّا منهما.
 */
/**
 * ── وكفالةُ مَن له ملفٌّ في الموارد البشريّة من ملفّه ──────────────────────
 * قاعدةُ صاحب الشركة (٢٠٢٦/١٠/١٩): على الكفالة / فريلانسر من «رقم السجل
 * التجاري» في الموارد البشريّة (utils/hrEngagement). كان القسمُ يكتب خانتَه
 * وحدَه، فبقيت فارغةً لسبعةٍ نوعُهم معروفٌ هناك («بلا نوع عقد»). وخانةُ القسم
 * تبقى لمن لا ملفَّ له وحدَه.
 */
const ENG = require('../utils/hrEngagement');
const contractKindOf = (r) => {
  // ── واليوزرُ المؤجَّرُ ليس كفالة ─────────────────────────────────────────────
  // كانت كلُّ خانةٍ مكتوبةٍ غيرِ «فريلانسر» تُقرأ «كفالة»، فعُدَّ يوزراتُ نينجا
  // الثلاثةَ عشرَ على الكفالة: ١١٤ في اللوحة و٩٨ في شيت التقرير (٢٠٢٦/١٠/٢٠).
  // واليوزرُ المؤجَّر تأجيرٌ ساري مربوطٌ بصفّه، والنصُّ احتياطٌ لمن لم يُربط — utils/ltRental.
  if (require('../utils/ltRental').isRented(r)) return 'users';
  if (r.employee && typeof r.employee === 'object') {
    const e = ENG.engagementOf(r.employee);
    return e === 'sponsored' || e === 'freelance' ? e : '';
  }
  const v = foldAr(String(r.contractTypeAr || '')).replace(/\s+/g, '');
  return v.includes('فريلانسر') ? 'freelance' : (v ? 'sponsored' : '');
};
const contractIs = (r, kind) => contractKindOf(r) === kind;

/**
 * ── «إجماليُّ المناديب»: كفالة + فري لانسر + يوزرات ─────────────────────────
 * طلبُ صاحب الشركة (٢٠٢٦/١٠/١٩): المناديبُ على رأس العمل بنوع عقدهم، ومعهم
 * اليوزراتُ المؤجَّرة (تأجير اليوزرات) — والكلُّ لكلّ مشروع. والمندوبُ الذي لا
 * نوعَ عقدٍ مكتوبًا له يُعَدّ وحدَه («بلا نوع عقد») فلا يختلّ الجمع.
 * المشروعُ يُجمَع بالطيّ: «هنجرستيشن» و«هنقرستيشن» مشروعٌ واحد.
 */
const projectKey = (p) => foldAr(String(p || '')).replace(/\s+/g, '').replace(/ق/g, 'ج');
async function repsBreakdown(rows, projectFilter) {
  const rentals = await require('./ltUserRentalController').activeByProject();
  const key = projectKey;
  const by = new Map();
  const slot = (name) => {
    const k = key(name) || '—';
    if (!by.has(k)) by.set(k, { project: S(name) || '(غير محدد)', sponsored: 0, freelance: 0, users: 0, noContract: 0 });
    return by.get(k);
  };
  // ── على رأس العمل وحدَهم ────────────────────────────────────────────────
  // كانت تُعَدّ صفوفُ القسم كلُّها، ومنها ستّةُ فري لانسر «إنهاء خدمة» بلا ملفٍّ
  // في الموارد البشريّة: ٦٢ في اللوحة و٥٦ في الشيت. والمنتهي لا يُعَدّ هنا كما
  // لا يُعَدّ في كروت الموظّفين (totalsOf).
  const reps = rows.filter((r) => (r.staffKind === 'rep' || contractIs(r, 'users')) && !isEnded(r));
  for (const r of reps) {
    const o = slot(r.projectAr);
    const k = contractKindOf(r);
    if (k === 'freelance') o.freelance += 1;
    else if (k === 'sponsored') o.sponsored += 1;
    else if (k === 'users') o.users += 1;
    else o.noContract += 1;
  }
  for (const [p, n] of Object.entries(rentals)) {
    if (projectFilter && key(p) !== key(projectFilter)) continue;
    slot(p).users += n;
  }
  const projects = [...by.values()]
    .map((o) => ({ ...o, total: o.sponsored + o.freelance + o.users + o.noContract }))
    .filter((o) => o.total > 0)
    .sort((a, b) => b.total - a.total);
  const sum = (k) => projects.reduce((n, o) => n + o[k], 0);
  return {
    sponsored: sum('sponsored'), freelance: sum('freelance'), users: sum('users'), noContract: sum('noContract'),
    total: sum('total'),
    projects,
  };
}

/** الأعدادُ التي تُقرأ في الكاردات — محسوبةٌ على ما بعد الفلترة. */
const totalsOf = (allRows, { includeEnded = false } = {}) => {
  // من فلتر على «إنهاء خدمة» صراحةً سأل عنهم — فيُعَدّون له.
  const rows = includeEnded ? allRows : allRows.filter((r) => !isEnded(r));
  const count = (fn) => rows.filter(fn).length;
  const group = (fn) => {
    const o = {};
    for (const r of rows) { const k = fn(r) || '—'; o[k] = (o[k] || 0) + 1; }
    return o;
  };
  // «على رأس العمل» = حالتُه «يعمل» — الفلترُ نفسُه الذي يفتحه الكارت. كان «كلَّ
  // مَن ليس منتهيًا ولا موقوفًا»، فدخل فيه مَن في إجازة: الكارتُ ١٦١ وفلترُه ١٥٧.
  // والآن: يعمل + إجازة + متوقف = الإجمالي، كلٌّ في كارته.
  const working = (r) => r.workStatusShown === 'يعمل';
  /**
   * ── الكفالةُ والفري لانسر: كارتان لا خانةُ فلترٍ وحدَها ────────────────────
   * «كم على الكفالة وكم فري لانسر» رقمان يُسألان أوّلَ ما تُفتَح الشاشة — وكانا
   * يُعرَفان بفتح قائمة الفلترة واختيار كلٍّ على حدة ثمّ قراءة العدّاد. فصارا
   * كارتين ثابتين، محسوبين على ما بعد الفلترة كسائر الكاردات: من فلتر على
   * مشروعٍ قرأ كفالةَ هذا المشروع وحدَه.
   *
   * والمطابقةُ بالطيّ لا بالنصّ: الشيتُ يكتب «كفاله» و«كفالة» و«فري لانسر»
   * و«فريلانسر» — وأربعةُ أشكالٍ لمعنيَين تُنتِج كارتًا يقرأ صفرًا.
   */
  const docState = (r, key, want) => {
    const st = r[key]?.state;
    return want === 'gap' ? ['expired', 'critical'].includes(st) : st === want;
  };
  return {
    total: rows.length,
    // وكلُّ صفوف القائمة (ومعها المنتهون) — للعلم لا للعدّ.
    listed: allRows.length,
    endedHidden: allRows.length - rows.length,
    sponsored: count((r) => contractIs(r, 'sponsored')),
    freelance: count((r) => contractIs(r, 'freelance')),
    // كارتُ تشغيلٍ أو فحصٌ منتهيان أو على وشك — الرجلُ يُوقَف لا المركبة.
    // ومن لا مشرفَ تفقّدٍ له لا يظهر لأحدٍ في شاشة التفقّد — رقمٌ يُتابَع حتّى يصفر.
    noDutySupervisor: count((r) => r.staffKind === 'rep' && !r.dutySupervisorUser),
    cardGap: count((r) => docState(r, 'operatingCard', 'gap')),
    cardSoon: count((r) => ['warning', 'upcoming'].includes(r.operatingCard?.state)),
    inspectionGap: count((r) => docState(r, 'inspection', 'gap')),
    inspectionSoon: count((r) => ['warning', 'upcoming'].includes(r.inspection?.state)),
    reps: count((r) => r.staffKind === 'rep'),
    admins: count((r) => r.staffKind === 'admin'),
    // والسائقُ ميدانٌ لا مكتب، ومن لا وظيفةَ مكتوبةً له لا تنطبق عليه القاعدة —
    // كلاهما عددٌ قائمٌ بذاته لا زيادةٌ في «الإداريّين».
    drivers: count((r) => r.staffKind === 'driver'),
    unknownKind: count((r) => r.staffKind === 'unknown' || !String(r.jobTitleAr || '').trim()),
    working: count(working),
    notWorking: count((r) => !working(r)),
    onLeave: count((r) => r.workStatusShown === 'إجازة' || r.workStatusShown === 'اجازه'),
    suspended: count((r) => r.workStatusShown === BOARD.SUSPENDED),
    accident: count((r) => r.workStatusShown === BOARD.ACCIDENT),
    // صفرٌ ما لم يُسأل عنهم صراحةً بفلتر «إنهاء خدمة».
    terminated: count(isEnded),
    withVehicle: count((r) => !!r.vehicle),
    withoutVehicle: count((r) => !r.vehicle),
    hrLinked: count((r) => r.hrLinked),
    ownedHere: count((r) => !r.hrLinked),
    housed: count((r) => !!r.housing),
    unhoused: count((r) => !r.housing),
    byProject: group((r) => r.projectAr),
    byCity: group((r) => r.cityAr),
    byJob: group((r) => r.jobTitleAr),
    byContract: group((r) => r.contractTypeAr),
    byRegister: group((r) => r.registerNumber),
    byVehicleType: group((r) => r.vehicleTypeShown),
    bySupervisor: group((r) => r.supervisorName),
    byStatus: group((r) => r.workStatusShown),
  };
};

/**
 * قيمُ الفلاتر تُبنى من السجلّ نفسِه لا تُكتب يدًا — فما يُضاف من إعدادات القسم
 * يظهر في الفلتر بلا نشرة، وما لا يُستعمَل لا يزحم القائمة.
 */
const optionsOf = async () => cache.wrap('lt:options', 60 * 1000, async () => {
  const [projects, cities, jobs, contracts, registers, vehicleTypes, supervisors, housings,
    unlinkedSupervisors] = await Promise.all([
    LightTransportEmployee.distinct('projectAr'),
    LightTransportEmployee.distinct('cityAr'),
    LightTransportEmployee.distinct('jobTitleAr'),
    LightTransportEmployee.distinct('contractTypeAr'),
    LightTransportEmployee.distinct('registerNumber'),
    // الأنواعُ من السجلَّين: خانةُ الموظّف ونوعُ التسجيل في سجلّ المركبات، مطويّةً
    // بمفردةٍ واحدة — وإلّا عُرض «دراجة نارية» و«دراجة آلية» خيارين لشيءٍ واحد.
    (async () => {
      const [a, b] = await Promise.all([
        LightTransportEmployee.distinct('vehicleTypeAr'),
        VehicleMaster.distinct('registrationTypeAr', { sectorAr: LIGHT_SECTOR }),
      ]);
      return [...new Set([...a, ...b].filter(Boolean).map(typeKey))];
    })(),
    /**
     * ── والمشرفون حساباتٌ لا أسماءٌ مكتوبة ─────────────────────────────────
     * كانت القائمةُ `distinct('supervisorName')` — أي ما كُتب في الصفوف. فهي
     * تعرض ما أُدخل ولو بصيغتين، ولا تعرض مشرفًا عُيِّن أمسِ ولم يُسنَد إليه
     * أحدٌ بعد، ولا تعرف أنّ لصاحب الاسم حسابًا يدخل به.
     *
     * فصارت من الحسابات: كلُّ حسابٍ نشطٍ بدورِ إشرافٍ في القسم، ومعه اسمُه
     * العربيُّ من ملفّه ودورُه. راجع `utils/b2cSupervisors`.
     */
    listSupervisors(),
    LightTransportHousing.find({ isActive: { $ne: false } }).select('name').lean(),
    // ومن كُتب في الصفوف ولا حسابَ له بعد — يبقى في الفلتر كي لا يختفي صفُّه.
    LightTransportEmployee.distinct('supervisorName', { supervisorUser: null }),
  ]);
  const clean = (a) => a.filter(Boolean).sort((x, y) => String(x).localeCompare(String(y), 'ar'));
  return {
    project: clean(projects), city: clean(cities), jobTitle: clean(jobs),
    contractType: clean(contracts), register: clean(registers), vehicleType: clean(vehicleTypes),
    supervisor: supervisors,
    supervisorsUnlinked: clean(unlinkedSupervisors),
    housing: housings.map((h) => ({ _id: String(h._id), name: h.name })),
  };
});


/**
 * قائمةُ المشرفين وحدَها — نداءٌ صغيرٌ يقرؤه الهاتف.
 *
 * الويبُ يأخذها ضمن ردّ القائمة (`options.supervisor`)، والهاتفُ يبني حقلَ
 * الاختيار من نقطةٍ مستقلّة. ومصدرُهما واحد: `listSupervisors`.
 */
exports.supervisors = async (req, res) => {
  try {
    res.json({ supervisors: await listSupervisors() });
  } catch (e) {
    console.error('lt supervisors:', e);
    res.status(500).json({ message: 'تعذّر تحميل قائمة المشرفين' });
  }
};

/**
 * ── لوحةُ القسم: سؤالٌ واحدٌ لا عشرة ────────────────────────────────────────
 * اللوحةُ تُقرأ في نداءٍ واحد: الموظّفون والمركباتُ والسكنُ معًا. وعشرةُ نداءاتٍ
 * متتالية تعني عشرةَ دوراتٍ على القاعدة وشاشةً تُبنى على مراحل.
 *
 * وكلُّ الأعداد تُحسَب على **ما بعد الفلترة**، فالكارتُ والجدولُ لا يختلفان: من
 * فلتر على مشروعٍ ثمّ قرأ «على الكفالة ٩» يجد التسعةَ أنفسَهم في القائمة.
 *
 * والمركباتُ تُعَدّ من سجلّ المركبات لا من صفوف الموظّفين: مركبةٌ لا راكبَ لها
 * لا تظهر في صفوفهم، وهي أوّلُ ما يُسأل عنه («كام مركبة واقفة؟»).
 */
/**
 * ── الأرقامُ لا تتحرّك تحت مَن يضغطها ───────────────────────────────────────
 *
 * كانت كلُّ أرقام اللوحة تُحسَب **بعد** كلّ الفلاتر، ومنها فلترُ الكارت المضغوط
 * نفسُه: يُضغط «مناديب ١٧٥» فيصير «إداريون» صفرًا، ويُضغط «كيتا» في «بالمشروع»
 * فيختفي كلُّ مشروعٍ سواه — والقائمةُ تُعاد ترتيبًا بأعدادٍ جديدة فتهتزّ.
 *
 * فكلُّ مجموعةِ كروتٍ تُحسَب **بكلّ الفلاتر عدا فلترَها هي** (عدٌّ بالأوجه —
 * القاعدةُ نفسُها في انتهاءات الموارد البشريّة، راجع `hrMasterController.expiring`):
 *   · مناديب / إداريون / سائقون / بلا وظيفة: بلا `staffKind`.
 *   · على رأس العمل / إجازة / موقوف وتقسيمةُ الحالة: بلا `status`.
 *   · لهم مركبة / بلا مركبة: بلا `hasVehicle`.   · لهم سكن / بلا سكن وإشغالُ السكن: بلا `housing`.
 *   · كلُّ تقسيمة (المشروع، الفرع، الوظيفة، نوع التعاقد، السجل، المشرف، نوع المركبة): بلا مفتاحها.
 *   · «الإجمالي» وما لا يُضغَط: بكلّ شيء — هو عددُ ما يفتحه «اعرض القائمة».
 * فمجموعُ كروتِ المجموعة يبقى إجماليَّها، والمضغوطُ يبقى على رقمه.
 *
 * ولذلك تُطبَّق هذه المفاتيحُ هنا في الذاكرة لا في الاستعلام، بالمعنى نفسِه الذي
 * يطبّقها به `listEmployees` (الطيُّ في المشروع، الحسابُ أو الاسمُ في المشرف…).
 */
const OVERVIEW_FACETS = ['city', 'jobTitle', 'contractType', 'register', 'staffKind', 'project',
  'supervisor', 'housing', 'hasVehicle', 'status', 'vehicleType',
  // فلاترُ اللوحة السريعة (٢٠٢٦/١٠/٢١) — راجع utils/b2cBoard.QUICK.
  'rep', 'vehicle', 'auth', 'cr', 'engagement', 'category'];

/** اسمُ قسم B2C في قائمة أقسام الموارد البشريّة (مفتاحُه light_transport). */
const b2cDepartment = () => cache.wrap('lt:b2cdept', 60000, async () => {
  const Lookup = require('../models/Lookup');
  const row = await Lookup.findOne({ type: 'hr_department', key: 'light_transport', deleted: { $ne: true } }).select('nameAr').lean();
  return S(row?.nameAr) || 'B2C';
});

/**
 * ── مركباتُ القسم صفوفًا تُعَدّ وتُفلتَر ─────────────────────────────────────
 * كلُّ مركبةٍ ينسبها قسمُ المركبات إلى النقل الخفيف (قطاعًا أو إدارةً) — مفوَّضةً
 * أو لا — ومعها كلُّ مركبةٍ عليها راكبٌ من سجلّ القسم (`BOARD.vehicleScope`).
 * ولكلٍّ: مشروعُها (مشروعُ راكبها، وإلّا إدارتُها في السجلّ)، ومدينتُها، ونوعُها
 * مطويًّا، وحالةُ تفويضها (`BOARD.authOf`)، وراكبوها.
 * تقرؤها اللوحةُ وصفحةُ «مركبات النقل الخفيف» معًا — فما يعدّه الكارتُ يفتحه الرابط.
 */
async function vehicleRows(riderRows, select = '', holderRows = []) {
  const group = (rows) => {
    const m = new Map();
    for (const r of rows) {
      const id = String(r.vehicle && typeof r.vehicle === 'object' ? r.vehicle._id : r.vehicle);
      if (!m.has(id)) m.set(id, []);
      m.get(id).push(r);
    }
    return m;
  };
  const byVehicle = group(riderRows);
  const heldBy = group(holderRows);
  const vehicles = await VehicleMaster.find(BOARD.vehicleScope([...byVehicle.keys(), ...heldBy.keys()]))
    .select(`plateNumber serialNumber registrationTypeAr departmentAr cityAr sectorAr serviceStatusAr serviceStatusCode authorizedPerson actualDriver ${select}`)
    .lean();
  const today = require('../utils/companyDay').todayKey();
  const { vehicleState } = require('../utils/ltRider');
  return vehicles.map((v) => {
    const riders = byVehicle.get(String(v._id)) || [];
    const holders = heldBy.get(String(v._id)) || [];
    return {
      _id: String(v._id), v, riders, holders,
      // عليها راكب · بانتظار التسليم (مع منتهي الخدمة) · واقفة — utils/ltRider.
      state: vehicleState(riders, holders),
      project: S(riders[0]?.projectAr) || S(v.departmentAr),
      city: S(riders[0]?.cityAr) || S(v.cityAr),
      typeKey: typeKey(v.registrationTypeAr),
      auth: BOARD.authOf(v, today),
    };
  });
}

/**
 * ── مَن انتهت خدمتُه والمركبةُ ما زالت معه — «بانتظار التسليم» ─────────────
 * صفوفُ القسم النشطةُ المربوطةُ بمركبةٍ وصاحبُها منتهي الخدمة في الموارد البشريّة
 * (أو في السجلّ لمن لا ملفَّ له) — ومنهم المؤرشَف: اسمُه لا يُعرَض، والمركبةُ
 * تُعرَض «بانتظار التسليم» لا «واقفة». سؤالٌ مستقلٌّ عن صفوف اللوحة، فلا تُخفيه
 * فلاترُ الإنسان ولا قاعدةُ الأرشيف.
 */
async function heldRows() {
  const { endedStaff } = require('../utils/endedStaff');
  const sets = await endedStaff();
  const rows = await LightTransportEmployee.find({
    isActive: { $ne: false }, vehicle: { $ne: null },
    $or: [{ employee: { $in: [...sets.ids].map((x) => new mongoose.Types.ObjectId(x)) } },
      { employee: null, workStatusAr: /انهاء|إنهاء/ }],
  }).select('_id name idNumber vehicle vehiclePlate employee vehicleHold').lean();
  return rows.map((r) => ({
    ...r,
    archived: r.employee ? sets.archivedIds.has(String(r.employee)) : sets.archivedIdNumbers.has(S(r.idNumber).replace(/\s+/g, '')),
  }));
}
exports._heldRows = heldRows;

/** صفوفُ القسم مزخرفةً — كلُّها، ومعها مَن يُعَدّ راكبًا (في الخدمة وعلى مركبة). */
async function boardRows(filter) {
  const { endedStaff, notArchivedRow, andAll } = require('../utils/archivedHidden');
  const archSets = await endedStaff();
  const rows = await LightTransportEmployee.find(andAll(filter, notArchivedRow(archSets))).populate(LIST_POPULATE).lean();
  await BOARD.markHrLeave(rows);
  await require('../utils/ltRental').markRentals(rows);
  const alerts = await docAlerts();
  return rows.map((r) => decorate(r, alerts));
}

/** خياراتُ فلترٍ: `{value, label, count}` بعددِ الصفوف، الأكثرُ أوّلًا. */
const optionList = (list, valueOf, labelOf = (v) => v) => {
  const m = new Map();
  for (const r of list) {
    const v = valueOf(r);
    if (v == null || v === '') continue;
    const o = m.get(v) || { value: v, label: labelOf(v, r), count: 0 };
    o.count += 1;
    m.set(v, o);
  }
  return [...m.values()].sort((a, b) => b.count - a.count || String(a.label).localeCompare(String(b.label), 'ar'));
};

exports._facetTest = (q) => BOARD.personTests(q, { typeKey, contractKindOf });
exports._vehicleRows = vehicleRows;

exports.overview = async (req, res) => {
  try {
    const q = req.query || {};
    // في الاستعلام ما ليس فلترًا من فلاتر اللوحة؛ والفلاترُ تُطبَّق بعد الجلب.
    const filter = { isActive: { $ne: false } };
    supervisorFilter(filter, q.dutySupervisor, 'dutySupervisorUser');
    if (S(q.hiredFrom) || S(q.hiredTo)) {
      filter.hireDate = {};
      if (S(q.hiredFrom)) filter.hireDate.$gte = new Date(S(q.hiredFrom));
      if (S(q.hiredTo)) filter.hireDate.$lte = new Date(`${S(q.hiredTo)}T23:59:59.999Z`);
    }
    const narrowed = Object.keys(filter).length > 1;

    const [decorated, allRows, housing, orders, b2cDept] = await Promise.all([
      boardRows(filter),
      // ── «واقفة» تُقاس على السجلّ كلِّه لا على المفلتَر ──────────────────────
      // والمنتهي لا يُحسَب راكبًا: مركبتُه واقفةٌ وإن بقي اسمُه عليها في السجلّ.
      narrowed ? boardRows({ isActive: { $ne: false } }) : null,
      LightTransportHousing.find({ isActive: { $ne: false } }).lean(),
      LightTransportOrder.find({ status: 'active' }).select('vehicle ltEmployee').lean(),
      b2cDepartment(),
    ]);
    // ── الراكبُ تعريفٌ واحد (utils/ltRider) ───────────────────────────────────
    // صفٌّ نشطٌ مربوطٌ بالمركبة، أيًّا كانت حالةُ يومه — من السجلّ كلِّه لا من
    // المفلتَر، فلا يجعل فلترُ الإنسان مركبةً «واقفة». والمنتهي «بانتظار التسليم».
    const riderRows = (allRows || decorated).filter((r) => r.vehicle && !isEnded(r));
    const vrows = await vehicleRows(riderRows, '', await heldRows());

    const people = BOARD.personTests(q, { typeKey, contractKindOf });
    const vpass = BOARD.vehicleTests(q, people, { typeKey });
    const has = (k) => (k === 'hasVehicle' ? !!q.hasVehicle : BOARD.vals(q[k]).length > 0);
    const listedRows = decorated.filter((r) => people(r));
    // أرقامُ اللوحة كلُّها على مَن هو في الخدمة — إلّا إن سأل الفلترُ عن المنتهين.
    const includeEnded = BOARD.vals(q.status).includes(ENDED);
    const live = (list) => (includeEnded ? list : list.filter((r) => !isEnded(r)));
    const rows = live(listedRows);
    /** صفوفُ مجموعةٍ تُعَدّ بلا فلترها — للتقسيمات وخيارات الفلاتر. */
    const without = (k) => (has(k) ? decorated.filter((r) => people(r, k)) : listedRows);

    // ── المركبات ──────────────────────────────────────────────────────────
    const onOrder = new Set(orders.map((o) => String(o.vehicle || '')));
    const vShown = vrows.filter((v) => vpass(v));
    // «عليها راكب / واقفة» قسمةُ المركبات نفسِها: لا يصفّرها «بلا مركبة».
    const vSplit = vrows.filter((v) => vpass(v, 'hasVehicle'));
    const vGroup = (list, fn) => {
      const o = {};
      for (const v of list) { const k = fn(v) || '—'; o[k] = (o[k] || 0) + 1; }
      return o;
    };

    // إشغالُ السكن بلا فلتر السكن: ضغطُ سكنٍ في الجدول لا يصفّر الآخرين.
    const housingRows = live(without('housing'));
    const housedIn = {};
    for (const r of housingRows) { if (r.housing) { const k = String(r.housing._id); housedIn[k] = (housedIn[k] || 0) + 1; } }
    const roomOcc = {};
    for (const r of housingRows) {
      if (r.housing && r.housingRoom) { const k = `${String(r.housing._id)}|${r.housingRoom}`; roomOcc[k] = (roomOcc[k] || 0) + 1; }
    }

    // الأرقامُ القديمة (التقسيماتُ والتطبيقُ القديم): كلُّ مجموعةٍ بلا فلترها.
    const employees = totalsOf(listedRows, { includeEnded });
    const facet = (k, keys) => {
      if (!has(k)) return;
      const t = totalsOf(without(k), { includeEnded });
      for (const key of keys) employees[key] = t[key];
    };
    facet('staffKind', ['reps', 'admins', 'drivers', 'unknownKind']);
    facet('status', ['working', 'notWorking', 'onLeave', 'suspended', 'accident', 'terminated', 'byStatus']);
    facet('hasVehicle', ['withVehicle', 'withoutVehicle']);
    facet('housing', ['housed', 'unhoused']);
    facet('project', ['byProject']); facet('city', ['byCity']); facet('jobTitle', ['byJob']);
    facet('contractType', ['byContract']); facet('register', ['byRegister']);
    facet('supervisor', ['bySupervisor']); facet('vehicleType', ['byVehicleType']);

    const reps = await repsBreakdown(rows, BOARD.vals(q.project).length === 1 ? BOARD.vals(q.project)[0] : '');
    if (has('project')) reps.projects = (await repsBreakdown(live(without('project')), '')).projects;

    /**
     * ── اللوحةُ كما طلبها صاحبُ الشركة (٢٠٢٦/١٠/٢١) ──────────────────────────
     * الإجماليُّ، وتحته ثلاثةُ كروت (مندوب · إداري · فني) لكلٍّ نصفاه (على الكفالة ·
     * فريلانسر) وما سواهما رقمًا صغيرًا — فالنصفان وما سواهما = الكارت، والكروتُ
     * (ومعها «غير مصنَّف» إن وُجد) = الإجمالي. ثمّ «حالة العمل»: يعمل · إجازة ·
     * موقوف · حادث، وفي كلٍّ قسمتُه على الفئات — ومجموعُها الإجماليُّ نفسُه.
     * وكلُّ رقمٍ تحت كلّ الفلاتر: من اختار مشروعًا قرأ أرقامَه وحدَه.
     */
    const ENG_KEYS = ['sponsored', 'freelance', 'trainee', 'users', 'none'];
    const CATS = ['rep', 'admin', 'tech', 'none'];
    const categories = {};
    for (const c of CATS) categories[c] = { total: 0, ...Object.fromEntries(ENG_KEYS.map((k) => [k, 0])) };
    const status = {};
    for (const s of [...BOARD.WORK_STATES, ...(includeEnded ? [ENDED] : [])]) {
      status[s] = { total: 0, ...Object.fromEntries(CATS.map((c) => [c, 0])) };
    }
    for (const r of rows) {
      const c = BOARD.categoryOf(r);
      categories[c].total += 1;
      categories[c][BOARD.engagementOf(r)] += 1;
      const st = status[r.workStatusShown] || (status[r.workStatusShown] = { total: 0, ...Object.fromEntries(CATS.map((x) => [x, 0])) });
      st.total += 1; st[c] += 1;
    }
    const authCount = (list) => ({
      authorized: list.filter((v) => v.auth === 'authorized').length,
      expired: list.filter((v) => v.auth === 'expired').length,
      none: list.filter((v) => v.auth === 'none').length,
    });

    // ── خياراتُ الفلاتر: لكلٍّ عددُه تحت الفلاتر الأخرى ─────────────────────
    const projectNames = new Map();
    for (const r of decorated) { const k = BOARD.projectKey(r.projectAr); if (!projectNames.has(k)) projectNames.set(k, S(r.projectAr) || BOARD.UNSET); }
    const vehiclesWithout = (k) => vrows.filter((v) => vpass(v, k));
    const filterOptions = {
      project: optionList(live(without('project')), (r) => projectNames.get(BOARD.projectKey(r.projectAr)) || BOARD.UNSET),
      rep: optionList(live(without('rep')), (r) => String(r._id), (v, r) => `${r.name}${r.idNumber ? ` — ${r.idNumber}` : ''}`),
      vehicle: optionList(vehiclesWithout('vehicle'), (v) => v._id,
        (id, v) => `${S(v.v.plateNumber) || S(v.v.serialNumber) || '—'}${v.riders[0] ? ` — ${v.riders[0].name}` : ''}`),
      auth: optionList(vehiclesWithout('auth'), (v) => v.auth, (v) => BOARD.AUTH_AR[v] || v),
      cr: optionList(live(without('cr')), (r) => BOARD.registerOf(r), (v) => (v === '—' ? 'غير محدد' : v)),
      engagement: optionList(live(without('engagement')), (r) => BOARD.engagementOf(r), (v) => BOARD.ENGAGEMENT_AR[v] || v),
      category: optionList(live(without('category')), (r) => BOARD.categoryOf(r), (v) => BOARD.CATEGORY_AR[v] || v),
      city: optionList(live(without('city')), (r) => S(r.cityAr) || '—', (v) => (v === '—' ? 'غير محدد' : v)),
      // المنتهون ليسوا خيارًا: مكانُهم الموارد البشريّة (قاعدةُ ended staff).
      status: optionList(without('status').filter((r) => !isEnded(r)), (r) => r.workStatusShown),
    };

    res.json({
      board: {
        total: rows.length,
        categories,
        status,
        vehicles: {
          total: vSplit.length,
          withRider: vSplit.filter((v) => v.state === 'withRider').length,
          hold: vSplit.filter((v) => v.state === 'hold').length,
          idle: vSplit.filter((v) => v.state === 'idle').length,
          onActiveOrder: vSplit.filter((v) => onOrder.has(v._id)).length,
          auth: authCount(vSplit),
        },
        // ملفُّه في الموارد البشريّة بقسمٍ غيرِ B2C — نُقل هناك ولم يُخرَج من سجلّ
        // القسم (الخروجُ لا يقع آليًّا). رقمٌ يُراجَع لا يُصحَّح بصمت.
        otherDepartment: rows.filter((r) => r.employee && typeof r.employee === 'object'
          && S(r.employee.department) && S(r.employee.department) !== b2cDept
          && !require('../utils/lightTransportSync').isLightDepartment(r.employee.department)).length,
        b2cDepartment: b2cDept,
      },
      filterOptions,
      quickFilters: BOARD.QUICK,
      employees,
      reps,
      vehicles: {
        total: vSplit.length,
        // وإجماليُّ مركبات القسم يبقى معروضًا كي يُعرَف أنّ المعروضَ جزءٌ منه.
        totalAll: vrows.length,
        withRider: vSplit.filter((v) => v.state === 'withRider').length,
        hold: vSplit.filter((v) => v.state === 'hold').length,
        idle: vSplit.filter((v) => v.state === 'idle').length,
        onActiveOrder: vSplit.filter((v) => onOrder.has(v._id)).length,
        byType: vGroup(vrows.filter((v) => vpass(v, 'vehicleType')), (v) => v.v.registrationTypeAr),
        byProject: vGroup(vShown, (v) => v.project),
        byServiceStatus: vGroup(vShown, (v) => v.v.serviceStatusAr),
        byAuth: authCount(vShown),
      },
      housing: housing.map((h) => {
        const cap = (h.rooms || []).reduce((n, r) => n + (Number(r.capacity) || 0), 0) || Number(h.declaredCapacity) || 0;
        const occupied = housedIn[String(h._id)] || 0;
        return {
          _id: String(h._id), name: h.name, cityAr: h.cityAr,
          capacity: cap, occupied, free: Math.max(0, cap - occupied),
          rooms: (h.rooms || []).map((r) => {
            const o = roomOcc[`${String(h._id)}|${r.name}`] || 0;
            return { name: r.name, kind: r.kind, capacity: r.capacity, occupied: o, free: Math.max(0, (Number(r.capacity) || 0) - o) };
          }),
        };
      }),
      orders: { active: orders.length },
      /** ما ينقص ويحتاج عملًا — لا ما هو قائم. */
      gaps: {
        workingWithoutVehicle: rows.filter((r) => !r.vehicle
          && ![ENDED, BOARD.SUSPENDED, BOARD.ACCIDENT].includes(r.workStatusShown)).length,
        idleVehicles: vSplit.filter((v) => v.state === 'idle').length,
        heldVehicles: vSplit.filter((v) => v.state === 'hold').length,
        noRegister: rows.filter((r) => !S(r.registerNumber) && r.workStatusShown !== ENDED).length,
        noContractType: rows.filter((r) => !S(r.contractTypeAr)).length,
        noSupervisor: rows.filter((r) => r.staffKind === 'rep' && !S(r.supervisorName)).length,
        unhoused: housingRows.filter((r) => !r.housing).length,
        noHrFile: rows.filter((r) => !r.hrLinked).length,
        // الورقةُ باسم غيرِ الراكب — تُقرأ من سجلّ المركبات لا من الصفّ.
        authorizationMismatch: rows.filter((r) => {
          if (!r.vehicle || typeof r.vehicle !== 'object') return false;
          const holder = S(r.vehicle.authorizedPerson?.iqamaNumber);
          return holder && S(r.idNumber) && holder !== S(r.idNumber);
        }).length,
      },
      options: await optionsOf(),
    });
  } catch (e) {
    console.error('lt overview:', e);
    res.status(500).json({ message: 'تعذّر تحميل لوحة القسم' });
  }
};

// ── ملفُّ موظّفٍ واحد ───────────────────────────────────────────────────────
exports.getEmployee = async (req, res) => {
  try {
    const row = await LightTransportEmployee.findById(req.params.id).populate(LIST_POPULATE).lean();
    if (!row) return res.status(404).json({ message: 'الموظّف غير موجود' });
    await BOARD.markHrLeave([row]);
    await require('../utils/ltRental').markRentals([row]);
    const orders = await LightTransportOrder.find({ ltEmployee: row._id })
      .populate('vehicle', 'plateNumber registrationTypeAr')
      .populate('housing', 'name')
      .sort({ startDate: -1 }).lean();
    res.json({ employee: decorate(row, await docAlerts()), orders });
  } catch (e) {
    console.error('lt getEmployee:', e);
    res.status(500).json({ message: 'تعذّر تحميل ملفّ الموظّف' });
  }
};

// `supervisorName` ليس منها: يُشتَقُّ من الحساب المختار — راجع `applySupervisor`.
const EDITABLE = ['name', 'nationalityAr', 'phone', 'cityAr', 'projectAr', 'jobTitleAr', 'contractTypeAr',
  // `workStatusAr` ليس منها: حالةُ العمل من الموارد البشريّة — راجع `shownStatus`.
  'registerNumber', 'vehicleTypeAr', 'housingRoom', 'notesAr', 'hireDate'];

/**
 * ── إسنادُ المشرف: حسابٌ يُختار، والباقي يُشتَقّ ────────────────────────────
 *
 * يُرسَل `supervisorUser` (معرِّفُ حساب) أو فراغٌ يعني «بلا مشرف». ومنه يُكتب
 * الاسمُ لقطةً والملفُّ إشارةً — فلا يُكتب اسمٌ بيدٍ فيفترق عن صاحبه.
 *
 * ويُسنَد الرجلُ في سجلّ التطبيق أيضًا (`B2CRep.supervisor`) فيراه مشرفُه في
 * تفقّد بداية الدوام. وهذا هو الربطُ المقصود: الإسنادُ في موضعٍ واحدٍ يظهر في
 * الشاشتين. راجع `utils/b2cSupervisors.syncRepSupervisor`.
 *
 * وحسابٌ ليس من أدوار الإشراف يُردّ صراحةً: الإسنادُ إليه رجلٌ لا يتفقّده أحد.
 */
async function applySupervisor(doc, body, res) {
  // التشغيليُّ ومشرفُ التفقّد — يُسنَدان مستقلَّين، وكلاهما حسابٌ لا اسم.
  for (const [field, nameField, empField] of [
    ['supervisorUser', 'supervisorName', 'supervisor'],
    ['dutySupervisorUser', 'dutySupervisorName', null],
  ]) {
    if (body[field] === undefined) continue;
    const want = S(body[field]);
    if (!want || want === 'none') {
      doc[field] = null; doc[nameField] = '';
      if (empField) doc[empField] = null;
      continue;
    }
    // eslint-disable-next-line no-await-in-loop
    const sup = await resolveSupervisor(want);
    if (!sup) {
      res.status(400).json({ message: 'هذا الحساب ليس مشرفَ مناديب ولا مديرَ مشروعٍ نشطًا في القسم' });
      return false;
    }
    doc[field] = sup._id;
    doc[nameField] = sup.name;
    if (empField) doc[empField] = sup.employee || null;
  }
  return true;
}

/**
 * ── وإضافةُ موظّفٍ هنا تُنشئ ملفَّه في الموارد البشريّة ──────────────────────
 *
 * كان الصفُّ يُنشأ في سجلّ القسم وحدَه إن لم تكن هويّتُه في الموارد البشريّة:
 * رجلٌ يعمل ولا ملفَّ له، ولا يظهر في الموظّفين ولا الماستر ولا الانتهاءات حتى
 * يتذكّر أحدٌ أن يسجّله هناك مرّةً ثانية. وما يُطلَب مرّتين يُنسى مرّة.
 *
 * فالقسمُ يكتب ما يعرفه — الاسم والإقامة وتاريخا التعيين والميلاد والمشروع
 * والمدينة ونوع التعاقد والسجلّ — ومستنداتِه، ويُنشأ ملفُّه في الموارد البشريّة
 * في الطلب نفسِه معلَّمًا بمصدره (`createdVia: 'b2c'`) وقسمُه «B2C». والموارد
 * البشريّة تجده بزرٍّ في صفحة الموظّفين وتُكمل الباقي.
 *
 * body: حقولُ السجلّ + { dateOfBirth, files: [{ dataUrl, fileName, title }] }
 */
const FREELANCE_RX = /فري|حر|free/i;
exports.createEmployee = async (req, res) => {
  try {
    const idNumber = S(req.body.idNumber).replace(/\s+/g, '');
    if (!idNumber) return res.status(400).json({ message: 'رقمُ الهويّة مطلوب' });
    const name = S(req.body.name);
    if (!name) return res.status(400).json({ message: 'الاسمُ مطلوب' });
    const dup = await LightTransportEmployee.findOne({ idNumber });
    if (dup) return res.status(400).json({ message: `الهويّةُ ${idNumber} مسجَّلةٌ بالفعل لـ${dup.name}` });

    // المستنداتُ تُحفَظ قبل أيّ كتابة: ملفٌّ مرفوضٌ لا يترك موظّفًا نصفَ مُنشأ.
    const { saveUploadFile } = require('../utils/fileStore');
    const stored = [];
    try {
      for (const f of Array.isArray(req.body.files) ? req.body.files.slice(0, 15) : []) {
        if (!f?.dataUrl) continue;
        if (!S(f.title)) return res.status(400).json({ message: 'اكتب اسمَ كلّ مستندٍ مرفق' });
        stored.push({ ...saveUploadFile(f.dataUrl, 'employees', f.fileName || ''), title: S(f.title).slice(0, 150) });
      }
    } catch (e) { return res.status(400).json({ message: 'نوعُ الملفّ غير مدعوم (صورة أو PDF أو Word أو Excel) أو حجمُه أكبر من ٢٠ ميغابايت' }); }

    const doc = new LightTransportEmployee({ idNumber, createdBy: req.user?._id });
    for (const k of EDITABLE) if (req.body[k] !== undefined) doc[k] = req.body[k];
    doc.name = name;
    if (!(await applySupervisor(doc, req.body, res))) return undefined;
    await applyHousing(doc, req.body.housing, req.body.housingRoom, res);
    if (res.headersSent) return undefined;

    // يُربَط بملفّه إن كانت هويّتُه في الموارد البشريّة، وإلّا يُنشأ له ملفّ.
    let hr = await Employee.findOne({ $or: [{ nationalId: idNumber }, { iqamaNumber: idNumber }] });
    let hrCreated = false;
    if (!hr) {
      const parts = name.split(/\s+/);
      const type = S(req.body.contractTypeAr);
      const { applyEmploymentType, FREELANCER, SPONSORED } = require('../utils/employmentType');
      const isSaudi = /^1\d{9}$/.test(idNumber);
      const day = (v) => (/^\d{4}-\d{2}-\d{2}/.test(S(v)) ? S(v).slice(0, 10) : '');
      hr = new Employee({
        firstName: parts[0], lastName: parts.slice(1).join(' ') || '—', arabicName: name,
        idType: isSaudi ? 'national_id' : 'iqama',
        ...(isSaudi ? { nationalId: idNumber } : { iqamaNumber: idNumber }),
        nationality: S(req.body.nationalityAr), phone: S(req.body.phone),
        hireDate: day(req.body.hireDate) || undefined, dateOfBirth: day(req.body.dateOfBirth) || undefined,
        department: 'B2C', project: S(req.body.projectAr), workLocation: S(req.body.cityAr), branchName: S(req.body.cityAr),
        jobTitle: S(req.body.jobTitleAr), registerNumber: S(req.body.registerNumber),
        employmentStatus: 'active', isHrRecord: true, createdVia: 'b2c', hrPending: true, createdBy: req.user?._id,
      });
      if (type) {
        const set = applyEmploymentType(FREELANCE_RX.test(type) ? FREELANCER : SPONSORED);
        hr.employmentType = set.employmentType; hr.isFreelancer = set.isFreelancer;
        if (!hr.fieldStatus || typeof hr.fieldStatus.set !== 'function') hr.fieldStatus = new Map();
        for (const [k, v] of Object.entries(set)) if (k.startsWith('fieldStatus.') && v) hr.fieldStatus.set(k.slice('fieldStatus.'.length), v);
      }
      await hr.save();
      hrCreated = true;
    }
    doc.employee = hr._id;
    doc.history.push({ kind: 'created', by: req.user?._id, byName: byName(req.user), note: hrCreated ? 'أُنشئ في القسم، وأُنشئ ملفُّه في الموارد البشريّة' : 'أُنشئ ومُرتبطٌ بملفّ الموارد البشريّة' });
    await doc.save();

    if (stored.length) {
      const EmployeeDocument = require('../models/EmployeeDocument');
      await EmployeeDocument.insertMany(stored.map((f) => ({
        employee: hr._id, title: f.title, category: 'other', fileUrl: f.fileUrl, fileName: f.fileName, mimeType: f.mimeType, size: f.size, uploadedBy: req.user?._id,
      })));
    }
    if (doc.supervisorUser) await syncRepSupervisor(doc.name, doc.supervisorUser, { ltId: doc._id });
    logAudit({ user: req.user, action: 'create_lt_employee', entity: 'LightTransportEmployee', entityId: doc._id, changes: { after: { name: doc.name, idNumber, hrFileCreated: hrCreated, documents: stored.length } }, ipAddress: req.ip }).catch(() => {});
    if (hrCreated) {
      logAudit({ user: req.user, action: 'create_employee', entity: 'Employee', entityId: hr._id, changes: { after: { name, idNumber, from: 'سجلّ النقل الخفيف (قسم الأفراد)' } }, ipAddress: req.ip }).catch(() => {});
    }
    // الموارد البشريّة تسمع في الحال: الموظّفون والماستر والتحليلات والانتهاءات.
    try { require('./hrController')._bustEmployeeCaches(); } catch (e) { /* */ }
    if (hrCreated) {
      try {
        const { notifySection } = require('../services/notificationService');
        await notifySection('HR', { title: 'موظف جديد من قسم الأفراد', message: `${name} — أضافه ${byName(req.user) || 'قسم الأفراد'}. أكمِل بياناتِه.`, relatedEntity: 'Employee', relatedEntityId: hr._id });
      } catch (e) { /* الإشعارُ تيسيرٌ لا شرط */ }
    }
    emit('lt:updated', {});
    return res.status(201).json({ employee: doc.toObject(), hrEmployee: hr._id, hrCreated, documents: stored.length });
  } catch (e) {
    console.error('lt createEmployee:', e);
    return require('../utils/mongooseError').sendMongooseError(res, e, 'تعذّر إنشاء الموظّف');
  }
};

/**
 * ── والسكنُ لا يُتجاوَز ─────────────────────────────────────────────────────
 * السكنُ سعةٌ محدودةٌ وغرفُه لأنواعٍ مختلفة: غرفةُ المناديب تسع ثمانيةً وغرفةُ
 * المشرفين ثلاثة. فالإسكانُ يُحسَب قبل أن يُكتب: كم في هذا السكن الآن، وكم في
 * هذه الغرفة، وهل الغرفةُ لنوعه. وبلا هذا الحسابِ يصير العددُ المكتوب في
 * الإعدادات زينةً، ويُسكَن في غرفةٍ أحدَ عشرَ وهي تسع ثمانية.
 */
async function applyHousing(doc, housingId, room, res) {
  const wanted = S(housingId);
  if (!wanted || wanted === 'none') { doc.housing = null; doc.housingRoom = ''; return; }
  if (!mongoose.isValidObjectId(wanted)) { res.status(400).json({ message: 'سكنٌ غير معروف' }); return; }
  const housing = await LightTransportHousing.findById(wanted).lean();
  if (!housing) { res.status(404).json({ message: 'السكنُ غير موجود' }); return; }

  const roomName = S(room);
  const sameHousing = String(doc.housing || '') === String(housing._id);
  const sameRoom = sameHousing && S(doc.housingRoom) === roomName;
  if (sameRoom) return;                       // لا شيءَ يتغيّر، فلا حسابَ ولا خطر

  const occupants = await LightTransportEmployee.countDocuments({
    housing: housing._id, isActive: { $ne: false }, _id: { $ne: doc._id, $nin: await endedRowIds() },
  });
  const capacity = (housing.rooms || []).reduce((n, r) => n + (Number(r.capacity) || 0), 0)
    || Number(housing.declaredCapacity) || 0;
  if (capacity && occupants >= capacity) {
    res.status(400).json({
      code: 'HOUSING_FULL',
      message: `سكن «${housing.name}» مكتمل: ${occupants} من ${capacity}.`,
    });
    return;
  }

  if (roomName) {
    const r = (housing.rooms || []).find((x) => S(x.name) === roomName);
    if (!r) { res.status(400).json({ message: `لا غرفةَ بهذا الاسم في «${housing.name}»` }); return; }
    // الغرفةُ لنوعه أو للجميع — وإلّا سُكِّن مشرفٌ في غرفةِ مناديب.
    if (r.kind !== 'any' && r.kind !== doc.staffKind) {
      const want = r.kind === 'rep' ? 'المناديب' : 'الإداريّين';
      res.status(400).json({ message: `غرفة «${r.name}» مخصَّصةٌ لـ${want}` });
      return;
    }
    const inRoom = await LightTransportEmployee.countDocuments({
      housing: housing._id, housingRoom: roomName, isActive: { $ne: false }, _id: { $ne: doc._id, $nin: await endedRowIds() },
    });
    if (Number(r.capacity) && inRoom >= Number(r.capacity)) {
      res.status(400).json({
        code: 'ROOM_FULL',
        message: `غرفة «${r.name}» مكتملة: ${inRoom} من ${r.capacity}.`,
      });
      return;
    }
  }

  if (!sameHousing) {
    doc.history.push({ kind: 'housing', fromValue: doc.housing ? 'سكنٌ سابق' : '', toValue: housing.name });
  }
  doc.housing = housing._id;
  doc.housingRoom = roomName;
}

exports.updateEmployee = async (req, res) => {
  try {
    const doc = await LightTransportEmployee.findById(req.params.id);
    if (!doc) return res.status(404).json({ message: 'الموظّف غير موجود' });

    // ── وكلُّ نقلٍ يُقيَّد ────────────────────────────────────────────────
    // «نقلتُه من مشروعٍ إلى مشروع» سؤالٌ يُسأل بعد شهور، وخانةٌ تُستبدَل لا
    // تحفظ جوابَه. فما يُغيَّر من هذه الأربعةِ يُكتب في سجلّ الموظّف بصاحبه.
    // ── والمشروعُ لا يتغيّر من التعديل: «نقل مشروع» وحدَه، وممّن يملكه ──────
    // (صاحبُ الشركة، ٢٠٢٦/١٠/١٩) — POST /employees/:id/transfer-project.
    if (req.body.projectAr !== undefined && S(req.body.projectAr) !== S(doc.projectAr) && S(doc.projectAr)) {
      return res.status(403).json({ message: 'المشروع يتغيّر بـ«نقل مشروع» من صفحة المندوب — لنائب مدير قطاع الأفراد ومدير القسم والسوبر أدمن والأدمن' });
    }
    // ── و«يوزرات» يكتبها تأجيرُ اليوزر وحدَه (صاحبُ الشركة، ٢٠٢٦/١٠/٢٢) ─────────
    // نوعُ العقد «يوزرات» مرآةٌ لتأجيرٍ ساري (utils/ltRental): يُسجَّل التأجيرُ أو
    // يُنهى من «تأجير اليوزرات» فيتبعه الصفّ — لا يُكتب هنا فيفترقا.
    if (req.body.contractTypeAr !== undefined) {
      const RENT = require('../utils/ltRental');
      const toUsers = RENT.isUsersText(req.body.contractTypeAr);
      if (toUsers !== RENT.isUsersText(doc.contractTypeAr)) {
        const active = await require('../models/LtUserRental').exists({ ltEmployee: doc._id, status: 'active' });
        if (toUsers || active) {
          return res.status(409).json({
            message: toUsers
              ? 'اليوزرُ المؤجَّر يُسجَّل من «تأجير اليوزرات» — فيصير نوعُ عقده «يوزرات» تلقائيًّا'
              : 'هذا يوزرٌ مؤجَّر — أنهِ تأجيرَه من «تأجير اليوزرات» فيعود نوعُ عقده تلقائيًّا',
          });
        }
      }
    }
    const TRACKED = { projectAr: 'project', cityAr: 'city' };
    for (const [field, kind] of Object.entries(TRACKED)) {
      if (req.body[field] !== undefined && S(req.body[field]) !== S(doc[field])) {
        doc.history.push({
          kind, by: req.user?._id, byName: byName(req.user),
          fromValue: S(doc[field]), toValue: S(req.body[field]), note: S(req.body.moveNote),
        });
      }
    }
    // وتغييرُ المشرف يُقيَّد بالاسمين لا بالمعرِّفين: السجلُّ يُقرأ بعد شهور.
    const beforeSupName = S(doc.supervisorName);
    const beforeSupUser = String(doc.supervisorUser || '');
    const beforeDutyName = S(doc.dutySupervisorName);
    const beforeIdentity = `${S(doc.name)}|${S(doc.phone)}`;
    const beforeDutyUser = String(doc.dutySupervisorUser || '');
    for (const k of EDITABLE) if (req.body[k] !== undefined) doc[k] = req.body[k];
    if (!(await applySupervisor(doc, req.body, res))) return undefined;
    if (String(doc.supervisorUser || '') !== beforeSupUser) {
      doc.history.push({
        kind: 'supervisor', by: req.user?._id, byName: byName(req.user),
        fromValue: beforeSupName, toValue: S(doc.supervisorName), note: S(req.body.moveNote),
      });
    }
    if (String(doc.dutySupervisorUser || '') !== beforeDutyUser) {
      doc.history.push({
        kind: 'dutySupervisor', by: req.user?._id, byName: byName(req.user),
        fromValue: beforeDutyName, toValue: S(doc.dutySupervisorName), note: S(req.body.moveNote),
      });
    }
    if (req.body.housing !== undefined) {
      await applyHousing(doc, req.body.housing, req.body.housingRoom ?? doc.housingRoom, res);
      if (res.headersSent) return undefined;
    }
    /**
     * ── حالةُ اليوم: يعمل · إجازة · موقوف · حادث ──────────────────────────────
     * يكتبها القسمُ من صفّ الموظّف (صاحبُ الشركة، ٢٠٢٦/١٠/٢١)، وتُقيَّد في سجلّه،
     * وتُنسَخ إلى ملفّه في الموارد البشريّة وإلى مركبته (models/LightTransport).
     * لا يمنعها إلّا إنهاءُ الخدمة في الموارد البشريّة: المنتهي لا حالةَ يومٍ له.
     */
    if (req.body.opStatus !== undefined) {
      const want = S(req.body.opStatus);
      if (!['', ...Object.keys(BOARD.OP_STATUS)].includes(want)) return res.status(400).json({ message: 'حالةُ عملٍ غير معروفة' });
      if (want !== S(doc.opStatus)) {
        const hr = doc.employee ? await Employee.findById(doc.employee).select('employmentStatus').lean() : null;
        if (hr && hr.employmentStatus === 'terminated' && want) {
          return res.status(409).json({ message: 'انتهت خدمتُه في الموارد البشرية — لا حالةَ عملٍ له في القسم' });
        }
        doc.history.push({
          kind: 'status', by: req.user?._id, byName: byName(req.user),
          fromValue: BOARD.OP_STATUS[doc.opStatus] || BOARD.WORKING, toValue: BOARD.OP_STATUS[want] || BOARD.WORKING,
          note: S(req.body.opStatusNote),
        });
        doc.opStatus = want;
        doc.opStatusAt = new Date();
        doc.opStatusNote = S(req.body.opStatusNote).slice(0, 300);
      }
    }
    doc.lastModifiedBy = req.user?._id;
    await doc.save();
    if (String(doc.supervisorUser || '') !== beforeSupUser) await syncRepSupervisor(doc.name, doc.supervisorUser, { ltId: doc._id });
    // الاسمُ والجوالُ يتبعهما حسابُ تطبيق التوصيل — utils/b2cEntry.syncRepOf.
    if (`${S(doc.name)}|${S(doc.phone)}` !== beforeIdentity) {
      try { await require('../utils/b2cEntry').syncRepOf(doc); cache.clear('b2c:'); } catch (_) { /* */ }
    }
    logAudit({ user: req.user, action: 'update_lt_employee', entity: 'LightTransportEmployee', entityId: doc._id, changes: { after: Object.keys(req.body) }, ipAddress: req.ip }).catch(() => {});
    emit('lt:updated', {});
    // حالةٌ صارت «إنهاء خدمة»؟ تُنزَل المركبة — راجع utils/ltVehicleRelease.
    require('../utils/ltVehicleRelease').after();
    return res.json({ employee: doc.toObject() });
  } catch (e) {
    console.error('lt updateEmployee:', e);
    return res.status(500).json({ message: 'تعذّر تعديل الموظّف' });
  }
};

/**
 * ── إسنادُ مشرفٍ لعدّة موظّفين دفعةً ────────────────────────────────────────
 *
 * الإسنادُ صفًّا صفًّا يعني فتحَ نافذةٍ مئةً وسبعًا وأربعين مرّة. والتوزيعُ يقع
 * على مجموعات: محطّةٌ كاملةٌ تنتقل إلى مشرفٍ، أو مشروعٌ يُسلَّم.
 *
 * ويُرسَل أيُّهما شاء — التشغيليُّ أو مشرفُ التفقّد أو كلاهما — وفراغٌ صريح
 * (`none`) يعني الرفع. وما لم يُرسَل لا يُمَسّ: من أسند مشرفَ تفقّدٍ لا يُسقِط
 * الإشرافَ التشغيليَّ بسكوته عنه.
 */
exports.assignSupervisors = async (req, res) => {
  try {
    const ids = (Array.isArray(req.body.ids) ? req.body.ids : []).filter((x) => mongoose.isValidObjectId(x));
    if (!ids.length) return res.status(400).json({ message: 'اختر موظّفًا واحدًا على الأقلّ' });
    const has = (k) => req.body[k] !== undefined && req.body[k] !== null && String(req.body[k]) !== '';
    if (!has('supervisorUser') && !has('dutySupervisorUser')) {
      return res.status(400).json({ message: 'اختر مشرفًا تشغيليًّا أو مشرفَ تفقّد' });
    }

    const set = {};
    for (const [field, nameField, empField] of [
      ['supervisorUser', 'supervisorName', 'supervisor'],
      ['dutySupervisorUser', 'dutySupervisorName', null],
    ]) {
      if (!has(field)) continue;
      const want = S(req.body[field]);
      if (want === 'none') {
        set[field] = null; set[nameField] = '';
        if (empField) set[empField] = null;
        continue;
      }
      // eslint-disable-next-line no-await-in-loop
      const sup = await resolveSupervisor(want);
      if (!sup) return res.status(400).json({ message: 'هذا الحساب ليس مشرفَ مناديب ولا مديرَ مشروعٍ نشطًا في القسم' });
      set[field] = sup._id;
      set[nameField] = sup.name;
      if (empField) set[empField] = sup.employee || null;
    }

    // و`history` ضمن المحمَّل: القيدُ يُدفَع إليها، ومصفوفةٌ لم تُحمَّل `undefined`.
    /**
     * ── ويُكتب بالتحديث لا بالحفظ ────────────────────────────────────────────
     * `doc.save()` على صفٍّ حُمّل بحقولٍ مختارة يُشغّل خطّافات المخطَّط على حقولٍ
     * غائبة — فيُعاد اشتقاقُ ما لم يُقرَأ. والمطلوبُ هنا إسنادُ حقلين وقيدٌ في
     * السجلّ، لا إعادةُ حساب الصفّ. فيُكتبان بـ`$set` و`$push` مباشرةً.
     */
    const rows = await LightTransportEmployee.find({ _id: { $in: ids } })
      .select('name supervisorName dutySupervisorName supervisorUser dutySupervisorUser').lean();
    for (const doc of rows) {
      const entries = [];
      if (set.supervisorUser !== undefined && String(doc.supervisorUser || '') !== String(set.supervisorUser || '')) {
        entries.push({ kind: 'supervisor', by: req.user?._id, byName: byName(req.user),
          fromValue: S(doc.supervisorName), toValue: S(set.supervisorName), note: S(req.body.note), at: new Date() });
      }
      if (set.dutySupervisorUser !== undefined && String(doc.dutySupervisorUser || '') !== String(set.dutySupervisorUser || '')) {
        entries.push({ kind: 'dutySupervisor', by: req.user?._id, byName: byName(req.user),
          fromValue: S(doc.dutySupervisorName), toValue: S(set.dutySupervisorName), note: S(req.body.note), at: new Date() });
      }
      const update = { $set: { ...set, lastModifiedBy: req.user?._id } };
      if (entries.length) update.$push = { history: { $each: entries } };
      // eslint-disable-next-line no-await-in-loop
      await LightTransportEmployee.updateOne({ _id: doc._id }, update);
    }

    logAudit({ user: req.user, action: 'assign_lt_supervisors', entity: 'LightTransportEmployee',
      changes: { after: { count: rows.length, ...set } }, ipAddress: req.ip }).catch(() => {});
    emit('lt:updated', {});
    // وشاشةُ التفقّد تقرأ مشرفَ التفقّد — فتُوقَظ معه.
    try { require('../websocket/socketManager').emitToAll('b2c:duty', {}); } catch (e) { /* */ }
    return res.json({ updated: rows.length });
  } catch (e) {
    console.error('lt assignSupervisors:', e);
    return res.status(500).json({ message: 'تعذّر الإسناد' });
  }
};

/** لا يُمحى موظّف — يُعطَّل السجلّ ويبقى أثرُه. راجع قاعدةَ الموارد البشريّة. */
exports.deactivateEmployee = async (req, res) => {
  try {
    const doc = await LightTransportEmployee.findById(req.params.id);
    if (!doc) return res.status(404).json({ message: 'الموظّف غير موجود' });
    doc.isActive = false;
    doc.history.push({ kind: 'status', by: req.user?._id, byName: byName(req.user), toValue: 'خارج القسم', note: S(req.body.reason) });
    await doc.save();
    emit('lt:updated', {});
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ message: 'تعذّر التعطيل' });
  }
};

// ── السكن ───────────────────────────────────────────────────────────────────
exports.listHousing = async (req, res) => {
  try {
    const rows = await LightTransportHousing.find({}).sort({ name: 1 }).lean();
    // الإشغالُ محسوبٌ لا مكتوب: عددُ من يسكن الآن، لا رقمٌ يُحدَّث باليد.
    const counts = await LightTransportEmployee.aggregate([
      // والمنتهي لا يشغل سريرًا — راجع `endedRowIds`.
      { $match: { housing: { $ne: null }, isActive: { $ne: false }, _id: { $nin: await endedRowIds() } } },
      { $group: { _id: { h: '$housing', r: '$housingRoom' }, n: { $sum: 1 } } },
    ]);
    const perHousing = new Map(); const perRoom = new Map();
    for (const c of counts) {
      const h = String(c._id.h);
      perHousing.set(h, (perHousing.get(h) || 0) + c.n);
      perRoom.set(`${h}|${S(c._id.r)}`, c.n);
    }
    res.json({
      housing: rows.map((h) => {
        const cap = (h.rooms || []).reduce((n, r) => n + (Number(r.capacity) || 0), 0) || Number(h.declaredCapacity) || 0;
        const occupied = perHousing.get(String(h._id)) || 0;
        return {
          ...h,
          totalCapacity: cap,
          occupied,
          free: Math.max(0, cap - occupied),
          rooms: (h.rooms || []).map((r) => {
            const o = perRoom.get(`${String(h._id)}|${S(r.name)}`) || 0;
            return { ...r, occupied: o, free: Math.max(0, (Number(r.capacity) || 0) - o) };
          }),
        };
      }),
    });
  } catch (e) {
    console.error('lt listHousing:', e);
    res.status(500).json({ message: 'تعذّر تحميل السكن' });
  }
};

exports.saveHousing = async (req, res) => {
  try {
    const body = req.body || {};
    if (!S(body.name)) return res.status(400).json({ message: 'اسمُ السكن مطلوب' });
    const fields = {
      name: S(body.name), cityAr: S(body.cityAr), addressAr: S(body.addressAr),
      declaredCapacity: Number(body.declaredCapacity) || 0, notes: S(body.notes),
      isActive: body.isActive !== false,
      rooms: Array.isArray(body.rooms) ? body.rooms.map((r) => ({
        name: S(r.name), kind: ['rep', 'admin', 'any'].includes(r.kind) ? r.kind : 'any',
        capacity: Number(r.capacity) || 0, notes: S(r.notes),
      })).filter((r) => r.name) : undefined,
    };
    if (fields.rooms === undefined) delete fields.rooms;

    let doc;
    if (req.params.id) {
      doc = await LightTransportHousing.findById(req.params.id);
      if (!doc) return res.status(404).json({ message: 'السكنُ غير موجود' });
      // ── ولا تُصغَّر سعةٌ دون سكّانها ────────────────────────────────────
      // خفضُ سعةِ غرفةٍ فيها خمسةٌ إلى ثلاثةٍ يجعل السجلَّ يكذب: العددُ يُقرأ
      // «٥ من ٣». فيُرَدّ الطلبُ ويُنقَل السكّانُ أوّلًا.
      if (fields.rooms) {
        const occ = await LightTransportEmployee.aggregate([
          { $match: { housing: doc._id, isActive: { $ne: false }, _id: { $nin: await endedRowIds() } } },
          { $group: { _id: '$housingRoom', n: { $sum: 1 } } },
        ]);
        for (const o of occ) {
          const r = fields.rooms.find((x) => x.name === S(o._id));
          if (S(o._id) && r && r.capacity && o.n > r.capacity) {
            return res.status(400).json({ message: `غرفة «${r.name}» فيها ${o.n} ساكنًا — لا تُخفَّض سعتُها إلى ${r.capacity}` });
          }
        }
      }
      Object.assign(doc, fields);
    } else {
      doc = new LightTransportHousing({ ...fields, createdBy: req.user?._id });
    }
    await doc.save();
    emit('lt:updated', {});
    return res.json({ housing: doc.toObject() });
  } catch (e) {
    if (e?.code === 11000) return res.status(400).json({ message: 'اسمُ السكن مستعملٌ بالفعل' });
    console.error('lt saveHousing:', e);
    return res.status(500).json({ message: 'تعذّر حفظ السكن' });
  }
};

exports.deleteHousing = async (req, res) => {
  try {
    const live = await LightTransportEmployee.countDocuments({ housing: req.params.id, isActive: { $ne: false } });
    if (live) return res.status(400).json({ message: `يسكنه ${live} موظّفًا — انقلهم أوّلًا` });
    await LightTransportHousing.findByIdAndUpdate(req.params.id, { $set: { isActive: false } });
    emit('lt:updated', {});
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ message: 'تعذّر حذف السكن' });
  }
};

module.exports.plateKeyOf = plateKeyOf;
module.exports.looksLikePlate = looksLikePlate;
module.exports.optionsOf = optionsOf;
module.exports.totalsOf = totalsOf;
module.exports.decorate = decorate;
module.exports.applyHousing = applyHousing;

// ═══════════════════════════════════════════════════════════════════════════
//  مركباتُ النقل الخفيف — مركباتُ مشاريع القسم من سجلّ المركبات نفسِه
// ═══════════════════════════════════════════════════════════════════════════
/**
 * قسمُ الأفراد يدير مشاريعَ (كيتا، هنقرستيشن، أمازون، نينجا) تعمل على مركباتٍ
 * مسجَّلةٍ في قسم المركبات. والتفويضُ وقائدُ المركبة الفعليُّ يتغيّران في الميدان
 * كلَّ يوم، فمن يعرفهما هو القسمُ لا قسمُ المركبات.
 *
 * فهذه نافذةٌ على **السجلّ نفسِه** (`VehicleMaster`) — لا نسخةٌ منه: ما يُعدَّل
 * هنا يُكتب هناك ويُبَثّ لقسم المركبات في الحال، وما يُعدَّل هناك يُقرأ هنا.
 * وما يُعدَّل من هنا محصورٌ في أعمدة التشغيل (المشروع والمدينة والقائد الفعليّ
 * والتفويض)؛ اللوحةُ والرقمُ التسلسليّ ووثائقُ المركبة تبقى لقسم المركبات.
 */
// ونطاقُ المركبات واحدٌ مع اللوحة: `BOARD.vehicleScope` (قطاعُه أو مشاريعُه وما عليه راكبُه).
const ymd = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '');
const ltVehicleRow = (v) => {
  const a = v.authorizedPerson || {}; const d = v.actualDriver || {};
  const start = ymd(a.startDate); const end = ymd(a.expiryDate);
  const today = require('../utils/companyDay').todayKey();
  return {
    _id: v._id, serialNumber: v.serialNumber || '', project: v.departmentAr || '', city: v.cityAr || '', plateNumber: v.plateNumber || '',
    driverId: d.idNumber || '', driverName: d.name || '',
    authorizedId: a.iqamaNumber || '', authorizedName: a.name || '', authorizedPhone: a.phone || '',
    authStart: start, authEnd: end, authNumber: a.authorizationNumber || '',
    // المدّةُ مشتقّة: من البداية إلى النهاية، بالأيّام.
    durationDays: start && end ? Math.round((new Date(end) - new Date(start)) / 86400000) : null,
    daysLeft: end ? Math.round((new Date(end) - new Date(today)) / 86400000) : null,
    sector: v.sectorAr || '', updatedAt: v.updatedAt,
    // ── وما يديره القسمُ من بيانات المركبة (صاحبُ الشركة، ٢٠٢٦/١٠/٢٢) ─────────
    serviceStatus: v.serviceStatusAr || '', color: v.colorAr || '', notes: v.notesAr || '',
    registrationType: v.registrationTypeAr || '',
    operatingCardNumber: v.operatingCard?.cardNumber || '', operatingCardEnd: ymd(v.operatingCard?.expiryDate),
    insuranceEnd: ymd(v.insurance?.expiryDate), licenseEnd: ymd(v.vehicleLicense?.expiryDate),
    inspectionEnd: ymd(v.inspection?.expiryDate),
  };
};
const LT_VEHICLE_SELECT = 'serialNumber departmentAr cityAr plateNumber sectorAr actualDriver authorizedPerson updatedAt '
  + 'serviceStatusAr colorAr notesAr registrationTypeAr operatingCard.cardNumber operatingCard.expiryDate insurance.expiryDate '
  + 'vehicleLicense.expiryDate inspection.expiryDate';
/** مَن يعدّل: مديرُ القطاع ونائبُه ومديرُ النظام (وأهلُ المال كما في كلّ ما يُفتَح لهم). */
const LT_VEHICLE_EDIT = ['super_admin', 'b2c_manager', 'b2c_deputy', ...require('../config/financeAuthority').FINANCE_FULL_ROLES];
exports.LT_VEHICLE_EDIT = LT_VEHICLE_EDIT;
/** مَن يعدّل سجلَّ المركبات نفسَه (routes/vehicleRegistry EDIT) — وحدَه يغيّر اللوحة من هنا. */
const REGISTRY_EDIT = ['super_admin', 'admin', 'vehicles_manager', 'vehicles_staff',
  'hr_manager', 'hr_specialist', 'cfo', 'accounting_manager', 'accountant'];

// GET /people?q= — منسدلةُ الأشخاص لمركبات القسم: موظّفو النقل الخفيف أوّلًا ثمّ
// الموارد البشريّة. ما تعرضه هو ما يقبله التعديل — utils/vehiclePerson.
exports.people = async (req, res) => {
  try {
    const people = await require('../utils/vehiclePerson').options({ scope: 'lt', q: req.query.q });
    res.json({ people });
  } catch (e) {
    console.error('lt people:', e);
    res.status(500).json({ message: 'تعذّر تحميل قائمة الموظّفين' });
  }
};

// GET /vehicles
/**
 * ── كلُّ مركبات القسم، وبفلاتر اللوحة ───────────────────────────────────────
 * المجموعةُ نفسُها التي تعدّها اللوحة (`vehicleRows` ← `BOARD.vehicleScope`):
 * قطاعُ النقل الخفيف أو إدارةٌ من مشاريعه، ومعها ما عليه راكبٌ من سجلّ القسم —
 * مفوَّضةً أو لا. وتقبل فلاترَ اللوحة في الرابط (المشروع، المندوب، المركبة،
 * التفويض، السجل، كفالة/فريلانسر، الفئة، المدينة، الحالة) و`vstate`
 * (withRider · idle · activeOrder) — فرقمُ الكارت يفتح مركباتِه بأعيانها.
 */
exports.listVehicles = async (req, res) => {
  try {
    const q = req.query || {};
    const decorated = await boardRows({ isActive: { $ne: false } });
    const riderRows = decorated.filter((r) => r.vehicle && !isEnded(r));
    let vrows = await vehicleRows(riderRows, LT_VEHICLE_SELECT, await heldRows());
    const people = BOARD.personTests(q, { typeKey, contractKindOf });
    const vpass = BOARD.vehicleTests(q, people, { typeKey });
    vrows = vrows.filter((v) => vpass(v));
    const vstate = S(q.vstate);
    if (['withRider', 'hold', 'idle'].includes(vstate)) vrows = vrows.filter((v) => v.state === vstate);
    if (vstate === 'activeOrder') {
      const on = new Set((await LightTransportOrder.find({ status: 'active' }).select('vehicle').lean()).map((o) => String(o.vehicle || '')));
      vrows = vrows.filter((v) => on.has(v._id));
    }
    const vehicles = vrows
      .map((v) => {
        /**
         * ── عمودُ «القائد الفعلي» = الراكبُ نفسُه (utils/ltRider) ─────────────
         * من صفّه في سجلّ القسم، لا من نصٍّ على المركبة: فالمركبةُ «الواقفة» لا
         * اسمَ عليها. وصاحبُ «بانتظار التسليم» يُعرَض بعلامته (والمؤرشَفُ بلا اسم).
         * وما بقي نصًّا على المركبة بلا صفٍّ يطابقه يُعرَض «غيرَ مربوط» لا قائدًا.
         */
        const rider = v.riders[0] || null;
        const holder = !rider ? (v.holders[0] || null) : null;
        const mirror = v.v.actualDriver || {};
        const base = ltVehicleRow(v.v);
        return {
          ...base,
          driverName: rider ? S(rider.name) : holder ? (holder.archived ? 'منتهي الخدمة' : S(holder.name)) : '',
          driverId: rider ? S(rider.idNumber) : holder && !holder.archived ? S(holder.idNumber) : '',
          driverLt: rider ? String(rider._id) : '',
          driverHold: !!holder,
          // نصٌّ قديمٌ على المركبة لا يطابق راكبًا — يُصحَّح بالمطابقة (scripts/reconcileLtRiders).
          driverUnlinked: !rider && !holder && S(mirror.name) ? S(mirror.name) : '',
          vstate: v.state,
          // المشروعُ كما تعدّه اللوحة (مشروعُ الراكب، وإلّا الإدارة) — وخانةُ السجلّ تبقى في `project`.
          boardProject: v.project,
          authState: v.auth,
          riderName: v.riders.map((r) => r.name).join('، '),
          riderId: S(rider?._id),
        };
      })
      .sort((a, b) => String(a.project).localeCompare(String(b.project), 'ar') || String(a.plateNumber).localeCompare(String(b.plateNumber), 'ar'));
    const count = (f) => vehicles.filter(f).length;
    const filtered = Object.keys(q).some((k) => BOARD.vals(q[k]).length);
    res.json({
      vehicles,
      summary: {
        total: vehicles.length,
        noAuthorization: count((v) => v.authState === 'none'),
        expired: count((v) => v.authState === 'expired'),
        expiringSoon: count((v) => v.daysLeft != null && v.daysLeft >= 0 && v.daysLeft <= 30),
        noDriver: count((v) => v.vstate === 'idle'),
        withRider: count((v) => v.vstate === 'withRider'),
        hold: count((v) => v.vstate === 'hold'),
        idle: count((v) => v.vstate === 'idle'),
      },
      filtered,
      canEdit: LT_VEHICLE_EDIT.includes(req.user?.role),
      canEditPlate: LT_VEHICLE_EDIT.includes(req.user?.role) && REGISTRY_EDIT.includes(req.user?.role),
    });
  } catch (e) {
    console.error('lt vehicles:', e);
    res.status(500).json({ message: 'تعذّر تحميل مركبات القسم' });
  }
};

// PUT /vehicles/:id — أعمدةُ التشغيل وحدَها.
exports.updateVehicle = async (req, res) => {
  try {
    if (!LT_VEHICLE_EDIT.includes(req.user?.role)) return res.status(403).json({ message: 'تعديلُ مركبات القسم لمدير القطاع ونائبه' });
    const { VehicleMaster } = require('../models/VehicleMaster');
    // مركباتُ القسم كما تعدّها اللوحة: قطاعُه أو مشاريعُه، وما عليه راكبٌ من سجلّه.
    const ridden = await LightTransportEmployee.distinct('vehicle', { isActive: { $ne: false }, vehicle: { $ne: null } });
    const v = await VehicleMaster.findOne({ _id: req.params.id, ...BOARD.vehicleScope(ridden) });
    if (!v) return res.status(404).json({ message: 'المركبةُ ليست من مركبات القسم' });
    const b = req.body || {};
    const before = ltVehicleRow((await VehicleMaster.findById(v._id).select(LT_VEHICLE_SELECT).lean()) || {});
    const text = (x) => S(x).slice(0, 150);
    const dateOf = (x, label) => {
      if (x === '' || x === null) return null;
      const d = new Date(`${S(x).slice(0, 10)}T00:00:00.000Z`);
      if (!/^\d{4}-\d{2}-\d{2}/.test(S(x)) || Number.isNaN(d.getTime())) { const err = new Error(`${label} غير صحيح`); err.bad = true; throw err; }
      return d;
    };
    const $set = {};
    if (b.project !== undefined) $set.departmentAr = text(b.project);
    if (b.city !== undefined) $set.cityAr = text(b.city);
    // ── وما يديره القسمُ من بيانات المركبة (صاحبُ الشركة، ٢٠٢٦/١٠/٢٢) ─────────
    // يُكتب في سجلّ المركبات نفسِه وبطريقه (findByIdAndUpdate) فتجري خطّافاتُه:
    // الاشتقاقُ، ومرآةُ التفويض، ونقلُ اللوحة إلى نسخها.
    if (b.serviceStatus !== undefined) $set.serviceStatusAr = text(b.serviceStatus);
    if (b.color !== undefined) $set.colorAr = text(b.color);
    if (b.notes !== undefined) $set.notesAr = S(b.notes).slice(0, 1000);
    if (b.operatingCardNumber !== undefined) $set['operatingCard.cardNumber'] = text(b.operatingCardNumber).replace(/\s+/g, '');
    for (const [k, p, label] of [['operatingCardEnd', 'operatingCard.expiryDate', 'تاريخُ انتهاء بطاقة التشغيل'],
      ['insuranceEnd', 'insurance.expiryDate', 'تاريخُ انتهاء التأمين'], ['licenseEnd', 'vehicleLicense.expiryDate', 'تاريخُ انتهاء الاستمارة'],
      ['inspectionEnd', 'inspection.expiryDate', 'تاريخُ انتهاء الفحص الدوري']]) {
      if (b[k] !== undefined) {
        $set[p] = dateOf(b[k], label);
        // تاريخٌ كُتب يرفع علامةَ «مطلوب/لا يوجد» عن المستند — صار له تاريخ.
        if ($set[p]) $set[p.replace('expiryDate', 'statusCode')] = '';
      }
    }
    // اللوحةُ هويّةُ المركبة: يعدّلها مَن يعدّل سجلَّ المركبات وحدَه.
    if (b.plateNumber !== undefined && text(b.plateNumber) !== S(v.plateNumber)) {
      if (!REGISTRY_EDIT.includes(req.user?.role)) return res.status(403).json({ message: 'اللوحةُ تُعدَّل من قسم المركبات' });
      if (!text(b.plateNumber)) return res.status(400).json({ message: 'اللوحةُ لا تُترك فارغة' });
      $set.plateNumber = text(b.plateNumber);
    }
    if (b.authNumber !== undefined) $set['authorizedPerson.authorizationNumber'] = text(b.authNumber);
    if (b.authStart !== undefined) $set['authorizedPerson.startDate'] = dateOf(b.authStart, 'تاريخُ بداية التفويض');
    if (b.authEnd !== undefined) $set['authorizedPerson.expiryDate'] = dateOf(b.authEnd, 'تاريخُ نهاية التفويض');

    /**
     * ── القائدُ الفعليّ والمفوَّض: يُختاران من الموظّفين ولا يُكتبان ────────────
     * القائدُ الفعليّ = راكبُ المركبة من سجلّ القسم (utils/ltRider) — يُغيَّر بربط
     * صفّه بها لا بكتابة اسمٍ عليها. والمفوَّضُ ورقةٌ تُكتب بـ`setHolder`
     * (utils/vehicleAuthorization) فيتبعها سجلُّ الإسناد. واسمٌ لا يطابق موظّفًا
     * يُرفض برسالةٍ واضحة (utils/vehiclePerson).
     */
    const VP = require('../utils/vehiclePerson');
    const driverSent = ['driverLt', 'driverId', 'driverName'].some((k) => b[k] !== undefined);
    let rider;
    if (driverSent) {
      rider = await VP.resolvePerson({ ltId: b.driverLt, idNumber: b.driverId, name: b.driverName }, { needLt: true, label: 'القائد الفعلي' });
    }
    const authSent = ['authorizedEmployee', 'authorizedLt', 'authorizedId', 'authorizedName'].some((k) => b[k] !== undefined);
    let holder;
    if (authSent) {
      holder = await VP.resolvePerson({ employeeId: b.authorizedEmployee, ltId: b.authorizedLt, idNumber: b.authorizedId, name: b.authorizedName }, { label: 'المفوَّض' });
    }
    const holderChanged = authSent && (holder ? holder.idNumber !== S(v.authorizedPerson?.iqamaNumber) || holder.name !== S(v.authorizedPerson?.name) : !!(S(v.authorizedPerson?.name) || S(v.authorizedPerson?.iqamaNumber)));
    if (!Object.keys($set).length && !driverSent && !authSent) return res.status(400).json({ message: 'لا حقولَ للتعديل' });
    const s0 = $set['authorizedPerson.startDate'] !== undefined ? $set['authorizedPerson.startDate'] : v.authorizedPerson?.startDate;
    const e0 = $set['authorizedPerson.expiryDate'] !== undefined ? $set['authorizedPerson.expiryDate'] : v.authorizedPerson?.expiryDate;
    if (s0 && e0 && new Date(e0) < new Date(s0)) return res.status(400).json({ message: 'نهايةُ التفويض قبل بدايته' });
    // تاريخٌ كُتب يرفع علامةَ «مطلوب/لا يوجد» عن التفويض — صار له تاريخ.
    if ($set['authorizedPerson.expiryDate']) $set['authorizedPerson.statusCode'] = '';

    // ورقةُ تفويضٍ لشخصٍ آخر تُكتب كاملةً بـ`setHolder` — رقمُها ومدّتُها معها.
    if (holderChanged) {
      const auth = {};
      for (const k of Object.keys($set)) if (k.startsWith('authorizedPerson.')) { auth[k.slice(17)] = $set[k]; delete $set[k]; }
      const VA = require('../utils/vehicleAuthorization');
      await VA.setHolder(v._id, holder ? {
        employee: holder.employee || null, name: holder.name, idNumber: holder.idNumber, phone: holder.phone,
        jobTitleAr: holder.jobTitleAr || undefined,
        authorizationNumber: auth.authorizationNumber !== undefined ? auth.authorizationNumber : S(v.authorizedPerson?.authorizationNumber),
        startDate: auth.startDate !== undefined ? auth.startDate : (v.authorizedPerson?.startDate || null),
        expiryDate: auth.expiryDate !== undefined ? auth.expiryDate : (v.authorizedPerson?.expiryDate || null),
      } : null, { userId: req.user?._id, byName: byName(req.user), note: holder ? 'فُوِّضت المركبة من مركبات النقل الخفيف' : undefined, reason: holder ? '' : 'من مركبات النقل الخفيف' });
    }
    if (Object.keys($set).length) {
      const { fillHijriPairs } = require('../utils/hijri');
      fillHijriPairs($set, v.toObject());
      await VehicleMaster.findByIdAndUpdate(v._id, { $set }, { new: true, runValidators: true });
    }
    if (driverSent) {
      await require('../utils/ltRider').setRider(v._id, rider ? rider.ltId : null, { user: req.user, announce: false });
    }
    const saved = await VehicleMaster.findById(v._id).select(LT_VEHICLE_SELECT).lean();
    const after = ltVehicleRow(saved);
    const changedKeys = Object.keys(after).filter((k) => !['updatedAt', 'daysLeft'].includes(k) && String(before[k] ?? '') !== String(after[k] ?? ''));
    logAudit({
      user: req.user, action: 'lt_vehicle_update', entity: 'VehicleMaster', entityId: v._id,
      changes: { details: `مركبة ${after.plateNumber} — من قسم الأفراد`, before: Object.fromEntries(changedKeys.map((k) => [k, before[k]])), after: Object.fromEntries(changedKeys.map((k) => [k, after[k]])) },
      ipAddress: req.ip,
    }).catch(() => {});
    // قسمُ المركبات يسمع في الحال (ذاكرتُه تُمسَح قبل الإعلان)، والقسمُ نفسُه كذلك.
    try { const cache = require('../utils/ttlCache'); for (const k of ['vreg:', 'lt:', 'veh:', 'vehicles:list', 'hr:', 'hrm:', 'dash:', 'reports:doc:', 'reports:opts:vehicle:']) cache.clear(k); } catch (e) { /* */ }
    emit('vreg:updated', {});
    emit('lt:updated', {});
    emit('hr:employee', {});
    res.json({ vehicle: after });
  } catch (e) {
    if (e.bad) return res.status(400).json({ message: e.message });
    if (e.status) return res.status(e.status).json({ message: e.message });
    console.error('lt vehicle update:', e);
    return require('../utils/mongooseError').sendMongooseError(res, e, 'تعذّر تعديل المركبة');
  }
};
