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
  try { emitToAll(event, payload); } catch (e) { /* البثُّ لا يُوقف العمل */ }
  // تُمحى الذاكرةُ قبل البثّ لا بعده، وإلّا قرأ المستمعون القديمَ — راجع
  // utils/ttlCache وقاعدةَ «أعلِن بعد الإبطال».
  cache.clear('lt:');
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

/** حالةُ التوظيف من الموارد البشريّة بلغة هذا القسم. */
const HR_STATUS_AR = { terminated: 'إنهاء خدمة', suspended: 'متوقف', active: '', on_leave: 'إجازة' };

/**
 * ── الحالةُ المعروضة ────────────────────────────────────────────────────────
 * حالةُ القسم هي الأصل، وتغلبها الموارد البشريّةُ حين تنفي: إنهاءُ خدمةٍ أو
 * إيقافٌ خبرٌ أقوى من أيّ خانةٍ هنا. أمّا ملفٌّ `active` فلا يمحو «إجازة» كتبها
 * القسم — الإجازةُ في الموارد البشريّة سجلُّ طلباتٍ لا حالةُ ملفّ.
 */
const shownStatus = (row) => {
  const hr = row.employee && typeof row.employee === 'object' ? row.employee.employmentStatus : null;
  if (hr === 'terminated' || hr === 'suspended') return HR_STATUS_AR[hr];
  return row.workStatusAr || '';
};

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
  workStatusShown: shownStatus(row),
  // «كارتُ التشغيل والفحصُ» — من مركبته، بحالتهما لا بتاريخهما وحدَه.
  operatingCard: docOf(row.vehicle, 'operatingCard', alerts),
  inspection: docOf(row.vehicle, 'inspection', alerts),
  // نوعُ المركبة من سجلّها متى كانت مربوطةً — وهو مكتوبٌ هناك رسميًّا.
  vehicleTypeShown: (row.vehicle && typeof row.vehicle === 'object' ? row.vehicle.registrationTypeAr : '') || row.vehicleTypeAr || '',
  // ومن أين جاء الخبر — فلا يُسأل «مين غيّر الحالة؟».
  statusSource: (() => {
    const hr = row.employee && typeof row.employee === 'object' ? row.employee.employmentStatus : null;
    return (hr === 'terminated' || hr === 'suspended') ? 'hr' : 'section';
  })(),
  hrLinked: !!row.employee,
  employeeNumber: row.employee && typeof row.employee === 'object' ? row.employee.employeeNumber : '',
});

/**
 * ── والفلترُ بالمشرف يقبل الحساب والاسم ────────────────────────────────────
 * صار المشرفُ حسابًا، فالفلترُ بالمعرِّف. ويبقى الاسمُ مقبولًا لأنّ روابطَ
 * محفوظةً ونسخًا من التطبيق تُرسله، ولأنّ من لا حسابَ لمشرفه بعد يبقى مفلتَرًا
 * باسمه المكتوب — فلا يختفي صفٌّ من شاشةٍ كان يُرى فيها.
 */
const supervisorFilter = (filter, value) => {
  const v = S(value);
  if (!v) return;
  if (v === 'none') { filter.supervisorUser = null; filter.supervisorName = ''; return; }
  if (mongoose.isValidObjectId(v)) filter.supervisorUser = v;
  else filter.supervisorName = v;
};

// ── قائمةُ الموظّفين ────────────────────────────────────────────────────────
const LIST_POPULATE = [
  { path: 'employee', select: 'employeeNumber arabicName firstName lastName employmentStatus phone' },
  { path: 'supervisor', select: 'arabicName firstName lastName employeeNumber' },
  { path: 'supervisorUser', select: 'firstName lastName email role' },
  // ── وبطاقةُ التشغيل والفحصُ يُقرآن مع المركبة ──────────────────────────
  // «كارتُ تشغيلِ مَن ينتهي هذا الشهر؟» سؤالٌ يُسأل في هذا القسم لا في قسم
  // المركبات: المشرفُ يوقف الرجلَ لا المركبة. والوثيقتان على سجلّ المركبات —
  // فتُقرآن معه في النداء نفسِه، ولا تُنسَخان هنا فتفترقا عن أصلهما.
  { path: 'vehicle', select: 'plateNumber serialNumber registrationTypeAr brandAr modelAr operatingCard inspection' },
  { path: 'housing', select: 'name cityAr' },
];

exports.listEmployees = async (req, res) => {
  try {
    const q = req.query || {};
    const filter = {};
    if (q.active !== 'all') filter.isActive = { $ne: false };
    for (const [key, field] of [['project', 'projectAr'], ['city', 'cityAr'], ['jobTitle', 'jobTitleAr'],
      ['contractType', 'contractTypeAr'], ['register', 'registerNumber'],
      ['staffKind', 'staffKind']]) {
      if (S(q[key])) filter[field] = S(q[key]);
    }
    supervisorFilter(filter, q.supervisor);
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

    let rows = await LightTransportEmployee.find(filter)
      .populate(LIST_POPULATE).sort({ name: 1 }).lean();
    const alerts = await docAlerts();
    rows = rows.map((r) => decorate(r, alerts));
    // الحالةُ ونوعُ المركبة يُفلتَران بعد الاشتقاق: كلٌّ منهما مركّبٌ من سجلَّين.
    if (S(q.status)) rows = rows.filter((r) => r.workStatusShown === S(q.status));
    if (S(q.vehicleType)) rows = rows.filter((r) => typeKey(r.vehicleTypeShown) === typeKey(q.vehicleType));

    res.json({ employees: rows, totals: totalsOf(rows), options: await optionsOf() });
  } catch (e) {
    console.error('lt listEmployees:', e);
    res.status(500).json({ message: 'تعذّر تحميل موظّفي النقل الخفيف' });
  }
};

/** الأعدادُ التي تُقرأ في الكاردات — محسوبةٌ على ما بعد الفلترة. */
const totalsOf = (rows) => {
  const count = (fn) => rows.filter(fn).length;
  const group = (fn) => {
    const o = {};
    for (const r of rows) { const k = fn(r) || '—'; o[k] = (o[k] || 0) + 1; }
    return o;
  };
  const working = (r) => !['إنهاء خدمة', 'متوقف'].includes(r.workStatusShown);
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
  const contractIs = (r, kind) => {
    const v = foldAr(String(r.contractTypeAr || '')).replace(/\s+/g, '');
    return kind === 'freelance' ? v.includes('فريلانسر') : (!!v && !v.includes('فريلانسر'));
  };
  const docState = (r, key, want) => {
    const st = r[key]?.state;
    return want === 'gap' ? ['expired', 'critical'].includes(st) : st === want;
  };
  return {
    total: rows.length,
    sponsored: count((r) => contractIs(r, 'sponsored')),
    freelance: count((r) => contractIs(r, 'freelance')),
    // كارتُ تشغيلٍ أو فحصٌ منتهيان أو على وشك — الرجلُ يُوقَف لا المركبة.
    cardGap: count((r) => docState(r, 'operatingCard', 'gap')),
    cardSoon: count((r) => ['warning', 'upcoming'].includes(r.operatingCard?.state)),
    inspectionGap: count((r) => docState(r, 'inspection', 'gap')),
    inspectionSoon: count((r) => ['warning', 'upcoming'].includes(r.inspection?.state)),
    reps: count((r) => r.staffKind === 'rep'),
    admins: count((r) => r.staffKind === 'admin'),
    working: count(working),
    notWorking: count((r) => !working(r)),
    onLeave: count((r) => r.workStatusShown === 'إجازة' || r.workStatusShown === 'اجازه'),
    terminated: count((r) => r.workStatusShown === 'إنهاء خدمة'),
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
        VehicleMaster.distinct('registrationTypeAr', { sectorAr: 'النقل الخفيف' }),
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
exports.overview = async (req, res) => {
  try {
    const q = req.query || {};
    const filter = { isActive: { $ne: false } };
    for (const [key, field] of [['project', 'projectAr'], ['city', 'cityAr'], ['jobTitle', 'jobTitleAr'],
      ['contractType', 'contractTypeAr'], ['register', 'registerNumber'],
      ['staffKind', 'staffKind']]) {
      if (S(q[key])) filter[field] = S(q[key]);
    }
    supervisorFilter(filter, q.supervisor);
    if (S(q.housing)) filter.housing = S(q.housing) === 'none' ? null : S(q.housing);
    if (q.hasVehicle === 'yes') filter.vehicle = { $ne: null };
    if (q.hasVehicle === 'no') filter.vehicle = null;
    if (S(q.hiredFrom) || S(q.hiredTo)) {
      filter.hireDate = {};
      if (S(q.hiredFrom)) filter.hireDate.$gte = new Date(S(q.hiredFrom));
      if (S(q.hiredTo)) filter.hireDate.$lte = new Date(`${S(q.hiredTo)}T23:59:59.999Z`);
    }

    const [rawRows, allRidden, housing, vehicles, orders] = await Promise.all([
      LightTransportEmployee.find(filter).populate(LIST_POPULATE).lean(),
      // ── «واقفة» تُقاس على السجلّ كلِّه لا على المفلتَر ────────────────────
      // لو حُسبت من الصفوف المفلترة لقال الفلترُ على مشروعٍ إنّ مئةً وأربعين
      // مركبةً واقفة — وهي تعمل، لكن راكبَها ليس في هذا المشروع. والسؤالُ
      // «كم مركبةً واقفة؟» جوابُه واحدٌ لا يتغيّر بما أُظهِر على الشاشة.
      LightTransportEmployee.find({ isActive: { $ne: false }, vehicle: { $ne: null } })
        .select('vehicle projectAr cityAr').lean(),
      LightTransportHousing.find({ isActive: { $ne: false } }).lean(),
      // قطاعُ النقل الخفيف في سجلّ المركبات — هو مصدرُ عددِ المركبات.
      VehicleMaster.find({ sectorAr: 'النقل الخفيف', isActive: { $ne: false } })
        .select('plateNumber registrationTypeAr departmentAr serviceStatusAr serviceStatusCode authorizedPerson').lean(),
      LightTransportOrder.find({ status: 'active' }).select('vehicle ltEmployee').lean(),
    ]);
    const alerts = await docAlerts();
    let rows = rawRows.map((r) => decorate(r, alerts));
    if (S(q.status)) rows = rows.filter((r) => r.workStatusShown === S(q.status));
    if (S(q.vehicleType)) rows = rows.filter((r) => typeKey(r.vehicleTypeShown) === typeKey(q.vehicleType));

    // ── المركبات ──────────────────────────────────────────────────────────
    const ridden = new Set(allRidden.map((r) => String(r.vehicle)));
    const onOrder = new Set(orders.map((o) => String(o.vehicle || '')));
    // المشروعُ والفرعُ من سجلّ القسم كلِّه — خانةُ المركبة فارغةٌ في ثمانٍ
    // وثلاثين منها ومكتوبةٌ بصياغةٍ أخرى في غيرها، فلا تُقرأ إلّا بديلًا.
    const ltProjectByVehicle = new Map(allRidden.map((r) => [String(r.vehicle), r.projectAr]).filter(([, p]) => !!p));
    const ltCityByVehicle = new Map(allRidden.map((r) => [String(r.vehicle), r.cityAr]).filter(([, p]) => !!p));

    /**
     * والفلترُ يمسّ المركباتَ أيضًا، لا الموظّفين وحدَهم: «كم دراجةً في مشروع
     * كيتا؟» سؤالٌ عن المركبات. فما يخصّ المركبةَ من الفلاتر يُطبَّق عليها —
     * المشروعُ والفرعُ ونوعُ المركبة — وما يخصّ الإنسانَ وحدَه لا يُطبَّق.
     */
    const vShown = vehicles.filter((v) => {
      const id = String(v._id);
      if (S(q.project) && (ltProjectByVehicle.get(id) || v.departmentAr) !== S(q.project)) return false;
      if (S(q.city) && ltCityByVehicle.get(id) && ltCityByVehicle.get(id) !== S(q.city)) return false;
      if (S(q.vehicleType) && typeKey(v.registrationTypeAr) !== typeKey(q.vehicleType)) return false;
      if (q.hasVehicle === 'no') return !ridden.has(id);
      return true;
    });
    const vGroup = (fn) => {
      const o = {};
      for (const v of vShown) { const k = fn(v) || '—'; o[k] = (o[k] || 0) + 1; }
      return o;
    };

    const housedIn = {};
    for (const r of rows) { if (r.housing) { const k = String(r.housing._id); housedIn[k] = (housedIn[k] || 0) + 1; } }
    const roomOcc = {};
    for (const r of rows) {
      if (r.housing && r.housingRoom) { const k = `${String(r.housing._id)}|${r.housingRoom}`; roomOcc[k] = (roomOcc[k] || 0) + 1; }
    }

    res.json({
      employees: totalsOf(rows),
      vehicles: {
        total: vShown.length,
        // وإجماليُّ القطاع يبقى معروضًا كي يُعرَف أنّ المعروضَ جزءٌ منه.
        totalAll: vehicles.length,
        withRider: vShown.filter((v) => ridden.has(String(v._id))).length,
        idle: vShown.filter((v) => !ridden.has(String(v._id))).length,
        onActiveOrder: vShown.filter((v) => onOrder.has(String(v._id))).length,
        byType: vGroup((v) => v.registrationTypeAr),
        byProject: vGroup((v) => ltProjectByVehicle.get(String(v._id)) || v.departmentAr),
        byServiceStatus: vGroup((v) => v.serviceStatusAr),
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
      /**
       * ── وما يحتاج عملًا اليوم ────────────────────────────────────────────
       * اللوحةُ تقول ما هو قائم؛ وهذه تقول ما ينقص. وهي أسئلةٌ تُسأل كلَّ أسبوع
       * ولا جوابَ لها إلّا بالفرز: مَن يعمل بلا مركبة، ومركبةٌ تقف بلا راكب،
       * ومَن لا سجلَّ كفالةٍ له، ومَن ورقةُ مركبته باسم غيره.
       */
      gaps: {
        workingWithoutVehicle: rows.filter((r) => !r.vehicle
          && !['إنهاء خدمة', 'متوقف'].includes(r.workStatusShown)).length,
        idleVehicles: vShown.filter((v) => !ridden.has(String(v._id))).length,
        noRegister: rows.filter((r) => !S(r.registerNumber)
          && !['إنهاء خدمة'].includes(r.workStatusShown)).length,
        noContractType: rows.filter((r) => !S(r.contractTypeAr)).length,
        noSupervisor: rows.filter((r) => r.staffKind === 'rep' && !S(r.supervisorName)).length,
        unhoused: rows.filter((r) => !r.housing).length,
        noHrFile: rows.filter((r) => !r.hrLinked).length,
        // الورقةُ باسم غيرِ الراكب — تُقرأ من سجلّ المركبات لا من الصفّ.
        authorizationMismatch: (() => {
          let n = 0;
          for (const r of rows) {
            if (!r.vehicle) continue;
            const v = vehicles.find((x) => String(x._id) === String(r.vehicle._id));
            const holder = S(v?.authorizedPerson?.iqamaNumber);
            if (holder && S(r.idNumber) && holder !== S(r.idNumber)) n += 1;
          }
          return n;
        })(),
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
  'registerNumber', 'vehicleTypeAr', 'workStatusAr', 'housingRoom', 'notesAr', 'hireDate'];

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
  if (body.supervisorUser === undefined) return true;
  const want = S(body.supervisorUser);
  if (!want || want === 'none') {
    doc.supervisorUser = null; doc.supervisorName = ''; doc.supervisor = null;
    return true;
  }
  const sup = await resolveSupervisor(want);
  if (!sup) {
    res.status(400).json({ message: 'هذا الحساب ليس مشرفَ مناديب ولا مديرَ مشروعٍ نشطًا في القسم' });
    return false;
  }
  doc.supervisorUser = sup._id;
  doc.supervisorName = sup.name;
  doc.supervisor = sup.employee || null;
  return true;
}

exports.createEmployee = async (req, res) => {
  try {
    const idNumber = S(req.body.idNumber);
    if (!idNumber) return res.status(400).json({ message: 'رقمُ الهويّة مطلوب' });
    if (!S(req.body.name)) return res.status(400).json({ message: 'الاسمُ مطلوب' });
    const dup = await LightTransportEmployee.findOne({ idNumber });
    if (dup) return res.status(400).json({ message: `الهويّةُ ${idNumber} مسجَّلةٌ بالفعل لـ${dup.name}` });

    const doc = new LightTransportEmployee({ idNumber, createdBy: req.user?._id });
    for (const k of EDITABLE) if (req.body[k] !== undefined) doc[k] = req.body[k];
    if (!(await applySupervisor(doc, req.body, res))) return undefined;
    // ويُربَط بملفّ الموارد البشريّة إن كانت هويّتُه هناك — بلا سؤال.
    const hr = await Employee.findOne({ $or: [{ nationalId: idNumber }, { iqamaNumber: idNumber }] }).select('_id').lean();
    if (hr) doc.employee = hr._id;
    await applyHousing(doc, req.body.housing, req.body.housingRoom, res);
    if (res.headersSent) return undefined;
    doc.history.push({ kind: 'created', by: req.user?._id, byName: byName(req.user), note: hr ? 'أُنشئ ومُرتبطٌ بملفّ الموارد البشريّة' : 'أُنشئ في القسم — لا ملفَّ له في الموارد البشريّة' });
    await doc.save();
    if (doc.supervisorUser) await syncRepSupervisor(doc.name, doc.supervisorUser, { ltId: doc._id });
    logAudit({ user: req.user, action: 'create_lt_employee', entity: 'LightTransportEmployee', entityId: doc._id, changes: { after: { name: doc.name, idNumber } }, ipAddress: req.ip }).catch(() => {});
    emit('lt:updated', {});
    return res.status(201).json({ employee: doc.toObject() });
  } catch (e) {
    console.error('lt createEmployee:', e);
    return res.status(500).json({ message: 'تعذّر إنشاء الموظّف' });
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
    housing: housing._id, isActive: { $ne: false }, _id: { $ne: doc._id },
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
      housing: housing._id, housingRoom: roomName, isActive: { $ne: false }, _id: { $ne: doc._id },
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
    const TRACKED = { projectAr: 'project', cityAr: 'city', workStatusAr: 'status' };
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
    for (const k of EDITABLE) if (req.body[k] !== undefined) doc[k] = req.body[k];
    if (!(await applySupervisor(doc, req.body, res))) return undefined;
    if (String(doc.supervisorUser || '') !== beforeSupUser) {
      doc.history.push({
        kind: 'supervisor', by: req.user?._id, byName: byName(req.user),
        fromValue: beforeSupName, toValue: S(doc.supervisorName), note: S(req.body.moveNote),
      });
    }
    if (req.body.housing !== undefined) {
      await applyHousing(doc, req.body.housing, req.body.housingRoom ?? doc.housingRoom, res);
      if (res.headersSent) return undefined;
    }
    doc.lastModifiedBy = req.user?._id;
    await doc.save();
    if (String(doc.supervisorUser || '') !== beforeSupUser) await syncRepSupervisor(doc.name, doc.supervisorUser, { ltId: doc._id });
    logAudit({ user: req.user, action: 'update_lt_employee', entity: 'LightTransportEmployee', entityId: doc._id, changes: { after: Object.keys(req.body) }, ipAddress: req.ip }).catch(() => {});
    emit('lt:updated', {});
    return res.json({ employee: doc.toObject() });
  } catch (e) {
    console.error('lt updateEmployee:', e);
    return res.status(500).json({ message: 'تعذّر تعديل الموظّف' });
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
      { $match: { housing: { $ne: null }, isActive: { $ne: false } } },
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
          { $match: { housing: doc._id, isActive: { $ne: false } } },
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
