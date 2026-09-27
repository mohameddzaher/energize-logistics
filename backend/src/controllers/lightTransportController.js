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

const decorate = (row) => ({
  ...row,
  workStatusShown: shownStatus(row),
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

// ── قائمةُ الموظّفين ────────────────────────────────────────────────────────
const LIST_POPULATE = [
  { path: 'employee', select: 'employeeNumber arabicName firstName lastName employmentStatus phone' },
  { path: 'supervisor', select: 'arabicName firstName lastName employeeNumber' },
  { path: 'vehicle', select: 'plateNumber serialNumber registrationTypeAr brandAr modelAr' },
  { path: 'housing', select: 'name cityAr' },
];

exports.listEmployees = async (req, res) => {
  try {
    const q = req.query || {};
    const filter = {};
    if (q.active !== 'all') filter.isActive = { $ne: false };
    for (const [key, field] of [['project', 'projectAr'], ['city', 'cityAr'], ['jobTitle', 'jobTitleAr'],
      ['contractType', 'contractTypeAr'], ['register', 'registerNumber'],
      ['supervisor', 'supervisorName'], ['staffKind', 'staffKind']]) {
      if (S(q[key])) filter[field] = S(q[key]);
    }
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
    if (S(q.q)) {
      const { arabicSearchRegex } = require('../utils/arabicSearch');
      const rx = arabicSearchRegex(S(q.q));
      filter.$or = [{ name: rx }, { idNumber: rx }, { vehiclePlate: rx }, { phone: rx },
        { supervisorName: rx }, { projectAr: rx }, { cityAr: rx }, { jobTitleAr: rx },
        { registerNumber: rx }, { notesAr: rx }];
    }

    let rows = await LightTransportEmployee.find(filter)
      .populate(LIST_POPULATE).sort({ name: 1 }).lean();
    rows = rows.map(decorate);
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
  return {
    total: rows.length,
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
  const [projects, cities, jobs, contracts, registers, vehicleTypes, supervisors, housings] = await Promise.all([
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
    LightTransportEmployee.distinct('supervisorName'),
    LightTransportHousing.find({ isActive: { $ne: false } }).select('name').lean(),
  ]);
  const clean = (a) => a.filter(Boolean).sort((x, y) => String(x).localeCompare(String(y), 'ar'));
  return {
    project: clean(projects), city: clean(cities), jobTitle: clean(jobs),
    contractType: clean(contracts), register: clean(registers), vehicleType: clean(vehicleTypes),
    supervisor: clean(supervisors),
    housing: housings.map((h) => ({ _id: String(h._id), name: h.name })),
  };
});


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
      ['supervisor', 'supervisorName'], ['staffKind', 'staffKind']]) {
      if (S(q[key])) filter[field] = S(q[key]);
    }
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
        .select('plateNumber registrationTypeAr departmentAr serviceStatusAr serviceStatusCode').lean(),
      LightTransportOrder.find({ status: 'active' }).select('vehicle ltEmployee').lean(),
    ]);
    let rows = rawRows.map(decorate);
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
    res.json({ employee: decorate(row), orders });
  } catch (e) {
    console.error('lt getEmployee:', e);
    res.status(500).json({ message: 'تعذّر تحميل ملفّ الموظّف' });
  }
};

const EDITABLE = ['name', 'nationalityAr', 'phone', 'cityAr', 'projectAr', 'jobTitleAr', 'contractTypeAr',
  'registerNumber', 'vehicleTypeAr', 'supervisorName', 'workStatusAr', 'housingRoom', 'notesAr', 'hireDate'];

exports.createEmployee = async (req, res) => {
  try {
    const idNumber = S(req.body.idNumber);
    if (!idNumber) return res.status(400).json({ message: 'رقمُ الهويّة مطلوب' });
    if (!S(req.body.name)) return res.status(400).json({ message: 'الاسمُ مطلوب' });
    const dup = await LightTransportEmployee.findOne({ idNumber });
    if (dup) return res.status(400).json({ message: `الهويّةُ ${idNumber} مسجَّلةٌ بالفعل لـ${dup.name}` });

    const doc = new LightTransportEmployee({ idNumber, createdBy: req.user?._id });
    for (const k of EDITABLE) if (req.body[k] !== undefined) doc[k] = req.body[k];
    // ويُربَط بملفّ الموارد البشريّة إن كانت هويّتُه هناك — بلا سؤال.
    const hr = await Employee.findOne({ $or: [{ nationalId: idNumber }, { iqamaNumber: idNumber }] }).select('_id').lean();
    if (hr) doc.employee = hr._id;
    await applyHousing(doc, req.body.housing, req.body.housingRoom, res);
    if (res.headersSent) return undefined;
    doc.history.push({ kind: 'created', by: req.user?._id, byName: byName(req.user), note: hr ? 'أُنشئ ومُرتبطٌ بملفّ الموارد البشريّة' : 'أُنشئ في القسم — لا ملفَّ له في الموارد البشريّة' });
    await doc.save();
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
    const TRACKED = { projectAr: 'project', cityAr: 'city', supervisorName: 'supervisor', workStatusAr: 'status' };
    for (const [field, kind] of Object.entries(TRACKED)) {
      if (req.body[field] !== undefined && S(req.body[field]) !== S(doc[field])) {
        doc.history.push({
          kind, by: req.user?._id, byName: byName(req.user),
          fromValue: S(doc[field]), toValue: S(req.body[field]), note: S(req.body.moveNote),
        });
      }
    }
    for (const k of EDITABLE) if (req.body[k] !== undefined) doc[k] = req.body[k];
    if (req.body.housing !== undefined) {
      await applyHousing(doc, req.body.housing, req.body.housingRoom ?? doc.housingRoom, res);
      if (res.headersSent) return undefined;
    }
    doc.lastModifiedBy = req.user?._id;
    await doc.save();
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

module.exports.optionsOf = optionsOf;
module.exports.totalsOf = totalsOf;
module.exports.decorate = decorate;
module.exports.applyHousing = applyHousing;
