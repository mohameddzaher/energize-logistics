/**
 * التفويض — مصدرٌ واحدٌ لـ«مَن المفوَّضُ على هذه المركبة الآن؟».
 *
 * ── ما وقع ───────────────────────────────────────────────────────────────────
 * «ق أ 4723» في مركبات النقل الخفيف بلا مفوَّض، وفي ملفّ الموظّف في الموارد
 * البشريّة «مُفوَّضةٌ لـ MD Rakib Hossen منذ ٢٦/٠٨»، وإنهاءُ خدمته يقول «أَلغِ
 * التفويضَ أوّلًا». والسببُ أنّ التفويضَ مكتوبٌ في سجلَّين:
 *
 *   ١) `VehicleMaster.authorizedPerson` — ورقةُ التفويض على المركبة، تقرؤها
 *      شاشاتُ المركبات والنقل الخفيف. **وهي المرجع.**
 *   ٢) `VehicleAuthorization` (+ مؤشّراتُ `Vehicle` القديم و`Employee.vehiclePlate`)
 *      — سجلُّ الإسناد بالموظّف، يقرؤه ملفُّ الموظّف وإخلاءُ الطرف.
 *
 * وكان كلُّ بابٍ يكتب في واحدٍ منهما: صفحةُ التفاويض تكتب في الاثنين، وتعديلُ
 * مركبات القسم من B2C وأوامرُ التشغيل وتعديلُ المركبة من السجلّ يكتبون في
 * الأوّل وحدَه، وأزرارُ صفحة المركبة القديمة في الثاني وحدَه. فافترقا: 4723
 * أُلغي تفويضُها من B2C يوم ٢١/١٠ والإسنادُ المفتوح يوم ١١/١٠ بقي «ساريًا».
 *
 * ── القاعدة ──────────────────────────────────────────────────────────────────
 * • الحالُ الحاضرةُ تُكتب وتُقرأ من الورقة (`authorizedPerson`) وحدَها.
 * • سجلُّ الإسناد **مرآةٌ وتاريخ**: يتبع الورقةَ بعد كلّ كتابةٍ فيها — من أيّ
 *   باب — عبر `syncLegacyFromMaster`. وخطّافاتُ النموذج (models/VehicleMaster)
 *   تناديها، فلا يحتاج بابٌ جديدٌ أن يتذكّرها.
 * • والكتابةُ من الباب القديم (صفحة المركبة في الموارد البشريّة) تمرّ بـ
 *   `setHolder`: تكتب الورقةَ أوّلًا، ثمّ تتبعها المرآة.
 * • القرّاءُ (الملفّ، إخلاءُ الطرف، بطاقاتُ السائقين) يسألون `currentFor`.
 *   ولا يُقرأ الإسنادُ وحدَه إلّا لمركبةٍ قديمةٍ لا ورقةَ لها في السجلّ.
 *
 * والربطُ بين `Vehicle` و`VehicleMaster` باللوحة (`orderlessPlateKey`: لا ترتيبَ
 * ولا مسافات — «ق أ  4723» بمسافتين هي «ق أ 4723»)، ثمّ يُثبَّت في
 * `Vehicle.master` فلا يُعاد التخمين.
 */
const mongoose = require('mongoose');
const { orderlessPlateKey } = require('./plateKey');

const S = (v) => String(v == null ? '' : v).trim();
const fold = (x) => String(x || '')
  .replace(/[أإآا]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه')
  .replace(/[^؀-ۿa-zA-Z0-9]/g, '').toLowerCase();
const ymd = (d) => {
  if (!d) return '';
  if (typeof d === 'string') return d.slice(0, 10);
  const t = new Date(d);
  return Number.isNaN(t.getTime()) ? '' : t.toISOString().slice(0, 10);
};
const todayKey = () => { try { return require('./companyDay').todayKey(); } catch (_) { return new Date().toISOString().slice(0, 10); } };

const M = () => ({
  VehicleMaster: require('../models/VehicleMaster').VehicleMaster,
  Vehicle: require('../models/Vehicle'),
  VehicleAuthorization: require('../models/VehicleAuthorization'),
  Employee: require('../models/Employee'),
});

/** مَن على الورقة؟ — `null` إن كانت فارغة. */
function holderOf(vm) {
  const a = vm?.authorizedPerson || {};
  const name = S(a.name); const id = S(a.iqamaNumber).replace(/\s+/g, '');
  return (name || id) ? { name, idNumber: id, authorizationNumber: S(a.authorizationNumber), startDate: a.startDate || null, expiryDate: a.expiryDate || null } : null;
}

const empName = (e) => S(`${e?.firstName || ''} ${e?.lastName || ''}`) || S(e?.arabicName) || S(e?.fullName);
const empIds = (e) => [S(e?.iqamaNumber), S(e?.nationalId)].filter(Boolean);

/** الموظّفُ برقم هويّته (العمودان معًا) — ملفُّ الموارد البشريّة الساري أوّلًا. */
async function employeeByIdNumber(id) {
  const n = S(id);
  if (!n) return null;
  const { Employee } = M();
  const rows = await Employee.find({ $or: [{ iqamaNumber: n }, { nationalId: n }] })
    .select('firstName lastName arabicName iqamaNumber nationalId vehiclePlate isHrRecord employmentStatus').lean();
  if (!rows.length) return null;
  const rank = (e) => (e.isHrRecord !== false ? 2 : 0) + (e.employmentStatus !== 'terminated' ? 1 : 0);
  return rows.sort((a, b) => rank(b) - rank(a))[0];
}

/** مركباتُ السجلّ القديم التي هي هذه المركبة — بالمؤشّر أوّلًا ثمّ باللوحة. */
async function legacyVehiclesOf(vm) {
  const { Vehicle } = M();
  const key = orderlessPlateKey(vm.plateNumber);
  const all = await Vehicle.find({}).select('plateNumber master status currentEmployee currentAuthorization type').lean();
  return all.filter((x) => (x.master && String(x.master) === String(vm._id)) || (key && orderlessPlateKey(x.plateNumber) === key));
}

/** مركبةُ السجلّ (الورقة) لمركبةٍ قديمة — أو null إن لم تكن في السجلّ. */
async function masterOfLegacy(vehicle) {
  const { VehicleMaster } = M();
  if (!vehicle) return null;
  if (vehicle.master) {
    const vm = await VehicleMaster.findById(vehicle.master);
    if (vm) return vm;
  }
  const key = orderlessPlateKey(vehicle.plateNumber);
  if (!key) return null;
  const digits = key.split('|')[0];
  const cands = await VehicleMaster.find(digits ? { plateNumber: new RegExp(digits.split('').join('\\D*')) } : {})
    .select('_id plateNumber');
  const hit = cands.find((v) => orderlessPlateKey(v.plateNumber) === key);
  return hit ? VehicleMaster.findById(hit._id) : null;
}

/** تُنشأ مرآةٌ قديمةٌ للمركبة حين يلزم فتحُ إسنادٍ ولا مرآةَ لها. */
async function ensureLegacyMirror(vm) {
  const { Vehicle } = M();
  const reg = S(vm.registrationTypeAr);
  const type = /دراج/.test(reg) ? 'motorcycle' : /نقل|شاحن/.test(reg) ? 'heavy_truck' : 'car';
  try {
    return (await Vehicle.create({
      plateNumber: vm.plateNumber, type, master: vm._id,
      department: S(vm.sectorAr), project: S(vm.departmentAr), status: 'available',
    })).toObject();
  } catch (e) {
    // سباقٌ مع كاتبٍ آخر على اللوحة نفسِها (فريدة) — تُقرأ الموجودة.
    const again = await legacyVehiclesOf(vm);
    if (again.length) return again[0];
    throw e;
  }
}

/** يجعل مؤشّرات المركبة القديمة تطابق إسنادَها الساري الوحيد. */
async function syncPointers(vehicleId, masterId) {
  const { Vehicle, VehicleAuthorization } = M();
  const active = await VehicleAuthorization.findOne({ vehicle: vehicleId, status: 'active' }).sort({ createdAt: -1 });
  const cur = await Vehicle.findById(vehicleId).select('status').lean();
  const keepStatus = cur && ['maintenance', 'out_of_service'].includes(cur.status);
  const set = active
    ? { currentAuthorization: active._id, currentEmployee: active.employee, ...(keepStatus ? {} : { status: 'authorized' }) }
    : { ...(keepStatus ? {} : { status: cur?.status === 'authorized' ? 'parked' : (cur?.status || 'available') }) };
  if (masterId) set.master = masterId;
  await Vehicle.updateOne({ _id: vehicleId }, active ? { $set: set } : { $set: set, $unset: { currentAuthorization: 1, currentEmployee: 1 } });
}

/**
 * سجلُّ الإسناد يتبع الورقة.
 *
 * @param vmOrId  مركبةُ السجلّ (مستندٌ أو معرّف)
 * @param opts.employee  الموظّفُ إن عُرف بغير رقم الهويّة (من الباب القديم)
 * @param opts.meta      حقولٌ للإسناد الجديد: authorizationType, issuedBy, notes
 * @param opts.reason    سببُ الإغلاق حين تُفرَّغ الورقة
 * @param opts.userId    مَن فعل
 * @returns {{ changed, opened, closed, employees: string[], vehicles: string[], unlinkedHolder }}
 */
async function syncLegacyFromMaster(vmOrId, opts = {}) {
  const { VehicleMaster, VehicleAuthorization, Employee } = M();
  const vm = vmOrId && vmOrId.plateNumber ? vmOrId : await VehicleMaster.findById(vmOrId).lean();
  const out = { changed: false, opened: 0, closed: 0, updated: 0, employees: [], vehicles: [], unlinkedHolder: false };
  if (!vm) return out;
  const holder = holderOf(vm);
  const at = S(opts.at).slice(0, 10) || todayKey();
  const userId = opts.userId || null;

  let emp = opts.employee || null;
  if (emp && !emp._id) emp = await Employee.findById(emp).lean();
  if (!emp && holder?.idNumber) emp = await employeeByIdNumber(holder.idNumber);

  let legacy = await legacyVehiclesOf(vm);
  const legacyIds = legacy.map((x) => x._id);
  const actives = legacyIds.length
    ? await VehicleAuthorization.find({ vehicle: { $in: legacyIds }, status: 'active' })
      .populate('employee', 'firstName lastName arabicName iqamaNumber nationalId').sort({ createdAt: -1 })
    : [];

  // أيُّ إسنادٍ ساريٍ هو صاحبُ الورقة؟ بالموظّف إن عُرف، وإلّا بالاسم المطويّ
  // (ورقةٌ بلا رقم هويّة كتبها الباب القديم لموظّفٍ بلا إقامة مسجَّلة).
  const isHolder = (a) => {
    if (!holder) return false;
    const e = a.employee || {};
    if (emp) return String(e._id || a.employee) === String(emp._id);
    if (holder.idNumber && empIds(e).includes(holder.idNumber)) return true;
    return !!holder.name && [fold(empName(e)), fold(e.arabicName)].includes(fold(holder.name));
  };
  const keep = actives.find(isHolder) || null;
  const touched = new Set();

  for (const a of actives) {
    if (keep && String(a._id) === String(keep._id)) continue;
    const prev = a.employee?._id || a.employee;
    a.status = holder && emp ? 'transferred' : 'revoked';
    a.endDate = at;
    a.endReason = a.status;
    if (a.status === 'transferred') a.transferredTo = emp._id;
    else {
      a.revokedReason = S(opts.reason) || (holder
        ? `نُقل التفويضُ إلى ${holder.name || holder.idNumber} في سجل المركبات`
        : 'أُلغي التفويض في سجل المركبات');
    }
    a.endedBy = userId || a.endedBy;
    a.depopulate?.('employee');
    await a.save();
    out.closed += 1; out.changed = true;
    if (prev) touched.add(String(prev));
  }

  if (keep) {
    // الورقةُ هي المرجع في رقمها ومدّتها أيضًا.
    const want = { documentNumber: holder.authorizationNumber, documentExpiry: ymd(holder.expiryDate) };
    const diff = Object.entries(want).filter(([k, v]) => v && S(keep[k]) !== v);
    if (diff.length) {
      for (const [k, v] of diff) keep[k] = v;
      keep.depopulate?.('employee');
      await keep.save();
      out.updated += 1; out.changed = true;
    }
  } else if (holder && emp) {
    if (!legacy.length) legacy = [await ensureLegacyMirror(vm)];
    const meta = opts.meta || {};
    await VehicleAuthorization.create({
      vehicle: legacy[0]._id, employee: emp._id, status: 'active',
      startDate: ymd(holder.startDate) || at,
      documentNumber: holder.authorizationNumber || undefined,
      documentExpiry: ymd(holder.expiryDate) || undefined,
      authorizationType: S(meta.authorizationType) || undefined,
      issuedBy: S(meta.issuedBy) || undefined,
      notes: S(meta.notes) || undefined,
      transferredFrom: actives[0]?.employee?._id || actives[0]?.employee || undefined,
      createdBy: userId || undefined,
    });
    out.opened += 1; out.changed = true;
  } else if (holder && !emp) {
    out.unlinkedHolder = true; // ورقةٌ باسم مَن ليس له ملفٌّ في الموارد البشريّة
  }

  for (const v of legacy) { await syncPointers(v._id, vm._id); out.vehicles.push(String(v._id)); }

  // ── ولقطةُ اللوحة على ملفّ الموظّف (`vehiclePlate`) ─────────────────────
  // قد يُفوَّض الواحدُ على مركبتين، والخانةُ واحدة: كانت تأخذ لوحةَ آخر مركبةٍ
  // مُزامَنة، فتتقافز بين اللوحتين في كلّ مرور. فهي لوحاتُه كلُّها مرتّبةً.
  const key = orderlessPlateKey(vm.plateNumber);
  if (emp) {
    touched.add(String(emp._id));
    if (await refreshPlateSnapshot(emp)) out.changed = true;
  }
  const digits = (key || '').split('|')[0];
  if (digits) {
    const others = await Employee.find({ vehiclePlate: new RegExp(digits.split('').join('\\D*')) })
      .select('_id vehiclePlate iqamaNumber nationalId').lean();
    for (const o of others) {
      if (emp && String(o._id) === String(emp._id)) continue;
      if (!plateKeysOf(o.vehiclePlate).includes(key)) continue;
      if (await refreshPlateSnapshot(o)) { touched.add(String(o._id)); out.changed = true; }
    }
  }
  out.employees = [...touched];
  return out;
}

/**
 * يُمسَح كلُّ ما يُقرأ منه التفويض ثمّ يُعلَن — الإبطالُ قبل الإعلان، وإلّا جلب
 * المستمعُ حالًا قديمةً وتأخّرت الشاشةُ تغييرًا واحدًا (راجع ذاكرة
 * «announce before invalidate»).
 */
/** لوحاتُ الخانة: قد تحمل أكثرَ من لوحةٍ مفصولةً بـ « · ». */
const PLATE_SEP = ' · ';
const plateKeysOf = (txt) => S(txt).split(/\s*[·،,]\s*/).map(orderlessPlateKey).filter(Boolean);

/** اللوحاتُ التي يحملها الموظّفُ الآن في سجلّ المركبات — مرتّبة. */
async function currentPlatesOf(emp) {
  const ids = empIds(emp);
  if (!ids.length) return [];
  const { VehicleMaster } = M();
  const rows = await VehicleMaster.find({ 'authorizedPerson.iqamaNumber': { $in: ids } }).select('plateNumber').lean();
  return [...new Set(rows.map((r) => S(r.plateNumber)).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ar'));
}

/** أتطابق الخانةُ ما يحمله؟ (مجموعةً لا ترتيبًا.) */
async function plateSnapshotOk(emp) {
  const want = (await currentPlatesOf(emp)).map(orderlessPlateKey).sort();
  if (!want.length) return true; // لا تفويضَ له: الخانةُ لا تُمَسّ (قد تقول «غير مطلوب»)
  const have = plateKeysOf(emp.vehiclePlate).sort();
  return want.length === have.length && want.every((k, i) => k === have[i]);
}

/** يكتب لوحاتِه في الخانة إن اختلفت — ويفرّغها إن كانت لوحةً لم يعد يحملها. */
async function refreshPlateSnapshot(emp) {
  const { Employee } = M();
  const plates = await currentPlatesOf(emp);
  if (plates.length) {
    if (await plateSnapshotOk(emp)) return false;
    await Employee.updateOne({ _id: emp._id }, { $set: { vehiclePlate: plates.join(PLATE_SEP) } });
    return true;
  }
  if (plateKeysOf(emp.vehiclePlate).length) {
    await Employee.updateOne({ _id: emp._id }, { $set: { vehiclePlate: '' } });
    return true;
  }
  return false;
}

// المسحُ والإعلانُ من الباب المشترك (utils/vehicleAnnounce)، وحدثا التفويض
// وملفِّ الموظّف بعدهما.
function announce(result = {}) {
  const vs = result.vehicles || [];
  require('./vehicleAnnounce').announceVehicles({}, {
    events: [
      ...(vs.length ? vs.map((v) => ['vehicle:authorization', { vehicle: v }]) : [['vehicle:authorization', {}]]),
      ...(result.employees || []).map((e) => ['hr:employee', { id: e }]),
    ],
  });
}

/** بعد كلّ كتابةٍ في الورقة (من خطّافات النموذج). لا يُسقط الكتابةَ إن فشل. */
async function afterMasterWrite(vmId, ctx = {}) {
  try {
    const r = await syncLegacyFromMaster(vmId, ctx);
    announce(r);
    return r;
  } catch (e) {
    console.error('[vehicle-auth] sync failed:', e.message);
    return null;
  }
}

/**
 * يكتب صاحبَ الورقة (أو يفرّغها) ثمّ يُتبعها سجلَّ الإسناد — للباب القديم ولكلّ
 * من يعرف الموظّفَ بمعرّفه.
 *
 * @param holder  null للإلغاء، أو { employee?, name?, idNumber?, jobTitleAr?, phone?,
 *                authorizationNumber?, startDate?, expiryDate? }
 * @param ctx     { userId, byName, reason, note, meta }
 */
async function setHolder(vmOrId, holder, ctx = {}) {
  const { VehicleMaster, Employee } = M();
  const vm = vmOrId && vmOrId.save ? vmOrId : await VehicleMaster.findById(vmOrId);
  if (!vm) throw Object.assign(new Error('المركبة غير موجودة في سجل المركبات'), { status: 404 });
  const before = holderOf(vm);
  let emp = null;
  if (holder) {
    if (holder.employee) emp = holder.employee._id ? holder.employee : await Employee.findById(holder.employee).lean();
    const ids = emp ? empIds(emp) : [];
    vm.authorizedPerson = {
      ...(vm.authorizedPerson?.toObject ? vm.authorizedPerson.toObject() : (vm.authorizedPerson || {})),
      // اسمُ الموارد البشريّة يغلب متى عُرف الموظّف — utils/personRef.
      name: (emp && require('./personRef').canonicalName(emp)) || S(holder.name) || empName(emp),
      iqamaNumber: S(holder.idNumber) || ids[0] || '',
      jobTitleAr: holder.jobTitleAr !== undefined ? S(holder.jobTitleAr) : S(vm.authorizedPerson?.jobTitleAr),
      phone: holder.phone !== undefined ? S(holder.phone) : S(vm.authorizedPerson?.phone),
      authorizationNumber: S(holder.authorizationNumber),
      startDate: holder.startDate || new Date(`${todayKey()}T00:00:00.000Z`),
      expiryDate: holder.expiryDate || null,
      statusCode: '',
    };
  } else {
    vm.authorizedPerson = { name: '', iqamaNumber: '', jobTitleAr: '', phone: '', authorizationNumber: '', startDate: null, expiryDate: null, statusCode: '' };
  }
  // قيدٌ في سجلّ المركبة: مَن قبلَ مَن، ومن أيّ باب.
  if (ctx.note !== false) {
    vm.renewals = vm.renewals || [];
    vm.renewals.push({
      document: 'authorization',
      newExpiry: vm.authorizedPerson.expiryDate || new Date(),
      previousNumber: before?.name || '',
      newNumber: vm.authorizedPerson.name || '',
      note: S(ctx.note) || (holder ? 'فُوِّضت المركبة' : `أُلغي التفويض${S(ctx.reason) ? ` — ${S(ctx.reason)}` : ''}`),
      byName: S(ctx.byName), at: new Date(),
    });
  }
  vm.$locals.skipAuthSync = true; // المزامنةُ تُنادى هنا صراحةً ومعها الموظّف
  await vm.save();
  const r = await syncLegacyFromMaster(vm.toObject(), { employee: emp, meta: ctx.meta, reason: ctx.reason, userId: ctx.userId });
  announce(r);
  return { vehicle: vm, ...r };
}

/**
 * ما بيد هذا الموظّف الآن — الجوابُ الواحد لملفّه ولإخلاء طرفه ولبطاقات السائقين.
 * من الورقة برقم الهويّة (ثمّ بالاسم المطويّ إن لم يُطابَق رقم)، ومن الإسناد
 * القديم **فقط** لمركبةٍ لا ورقةَ لها في السجلّ.
 */
async function currentFor(employeeOrId) {
  const { VehicleMaster, VehicleAuthorization, Employee } = M();
  const emp = employeeOrId && employeeOrId._id && (employeeOrId.firstName !== undefined || employeeOrId.iqamaNumber !== undefined)
    ? employeeOrId
    : await Employee.findById(employeeOrId).select('firstName lastName arabicName fullName iqamaNumber nationalId').lean();
  if (!emp) return [];
  const ids = empIds(emp);
  const SEL = 'plateNumber authorizedPerson registrationTypeAr registrationTypeCode sectorAr departmentAr ownerNameAr fuelCard.cardNumber';
  let regs = ids.length ? await VehicleMaster.find({ 'authorizedPerson.iqamaNumber': { $in: ids } }).select(SEL).lean() : [];
  if (!regs.length) {
    const names = [fold(empName(emp)), fold(emp.arabicName), fold(emp.fullName)].filter(Boolean);
    if (names.length) {
      const all = await VehicleMaster.find({ 'authorizedPerson.name': { $nin: ['', null] }, 'authorizedPerson.iqamaNumber': { $in: ['', null] } }).select(SEL).lean();
      regs = all.filter((v) => names.includes(fold(v.authorizedPerson?.name)));
    }
  }
  const out = regs.map((v) => ({
    source: 'registry',
    registryId: String(v._id),
    plateNumber: v.plateNumber,
    registrationTypeAr: v.registrationTypeAr || '',
    registrationTypeCode: v.registrationTypeCode || '',
    sectorAr: v.sectorAr || '', projectAr: v.departmentAr || '',
    authorizationNumber: S(v.authorizedPerson?.authorizationNumber),
    startDate: ymd(v.authorizedPerson?.startDate),
    expiryDate: ymd(v.authorizedPerson?.expiryDate),
  }));

  // الإسنادُ القديم: يُقرأ لمركبةٍ لا ورقةَ لها — وإلّا فالورقةُ قالت كلمتَها.
  const legacy = await VehicleAuthorization.find({ employee: emp._id, status: 'active' })
    .populate('vehicle', 'plateNumber type department project master').lean();
  if (legacy.length) {
    const regKeys = new Set((await VehicleMaster.find({}).select('plateNumber').lean()).map((v) => orderlessPlateKey(v.plateNumber)));
    for (const a of legacy) {
      const v = a.vehicle || {};
      if (v.master || regKeys.has(orderlessPlateKey(v.plateNumber))) continue;
      out.push({
        source: 'legacy', legacyVehicleId: String(v._id || ''), authorizationId: String(a._id),
        plateNumber: v.plateNumber || '', registrationTypeAr: v.department || v.type || '', registrationTypeCode: '',
        sectorAr: v.department || '', projectAr: v.project || '',
        authorizationNumber: S(a.documentNumber), startDate: S(a.startDate), expiryDate: S(a.documentExpiry),
      });
    }
  }
  return out;
}

/** «هل للورقة رأيٌ في هذه المركبة القديمة؟» — مجموعةُ مفاتيح لوحات السجلّ. */
async function registryPlateKeys() {
  const { VehicleMaster } = M();
  return new Set((await VehicleMaster.find({}).select('plateNumber').lean()).map((v) => orderlessPlateKey(v.plateNumber)));
}

module.exports = {
  holderOf, employeeByIdNumber, legacyVehiclesOf, masterOfLegacy, syncLegacyFromMaster,
  syncPointers, announce, afterMasterWrite, setHolder, currentFor, registryPlateKeys, fold, empName, ymd,
  plateSnapshotOk, refreshPlateSnapshot, currentPlatesOf, plateKeysOf,
};
