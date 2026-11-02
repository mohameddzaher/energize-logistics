/**
 * Start-of-duty check: supervisor screen, management log and their analysis.
 * A supervisor sees and writes for their own reps (myReps / submit). Management sees everyone and writes only its review (list / analytics / review).
 * Visibility comes from B2CRep.supervisor, not from the role; checking another supervisor's rep is rejected (see assertOwnsRep).
 */
const mongoose = require('mongoose');
const B2CDutyCheck = require('../models/B2CDutyCheck');
const B2CRep = require('../models/B2CRep');
const User = require('../models/User');
// Required so their schemas get registered: populate('branch') fails with MissingSchemaError when the model is not loaded, which only shows outside the server (script, test, worker).
require('../models/Branch');
require('../models/B2CProject');
const { saveUploadFile, deleteStoredFile } = require('../utils/fileStore');
const { sendMongooseError } = require('../utils/mongooseError');
const logAudit = require('../utils/auditLogger');
const { createNotification } = require('../services/notificationService');
const { emitToAll } = require('../websocket/socketManager');

/** Who can be assigned a rep. */
// Supervision roles come from one place: the light-transport registry assigns with them and this screen reads with them. Two diverging lists would leave an assigned rep invisible to their supervisor.
const { SUPERVISOR_ROLES } = require('../utils/b2cSupervisors');
/**
 * A project manager reads their section's log.
 * Previously only the system admin and sector manager read the whole log, so a project manager saw only their own records and their reps' records, and missed checks done by another supervisor on their project. The check is a reviewable work trace, not a secret inside the department. Writing stays guarded (a supervisor records; review belongs to its owners).
 */
const FULL_VIEW_ROLES = ['super_admin', 'admin', 'it_manager', 'it_specialist',
  'b2c_manager', 'b2c_deputy', 'b2c_project_lead',
  // Finance roles see the whole section like the system admin, not one supervisor's reps.
  ...require('../config/financeAuthority').FINANCE_FULL_ROLES];
const canSeeAll = (u) => FULL_VIEW_ROLES.includes(u?.role || '');

/** Day key in Riyadh time, not server time or the user's browser time. */
const RIYADH = 'Asia/Riyadh';
const dayKeyOf = (d = new Date()) => {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: RIYADH, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(d).reduce((m, x) => (m[x.type] = x.value, m), {});
  return `${p.year}-${p.month}-${p.day}`;
};
const partsOf = (key) => {
  const [y, m, d] = key.split('-').map(Number);
  return { year: y, month: m, day: d, date: new Date(`${key}T00:00:00.000Z`) };
};
const validKey = (k) => /^\d{4}-\d{2}-\d{2}$/.test(String(k || ''));

/** Exit photo kinds; every exit needs all three. */
// Three photos are required and a fourth is for Thursday. Rep, scooter and box photos are the start-of-duty condition, used to compare the vehicle if it returns broken. The advertising-content photo is a weekly sticker snapshot taken on Thursday; it is not a start condition and is rejected on other days, otherwise it would be 'a photo from any day' with no known week. It can repeat since the sticker has several sides.
const REQUIRED_PHOTO_KINDS = ['rep', 'vehicle', 'box'];
const AD_KIND = 'ad';
const PHOTO_KINDS = [...REQUIRED_PHOTO_KINDS, AD_KIND];
const PHOTO_KIND_AR = { rep: 'صورة المندوب', vehicle: 'صورة الدبّاب', box: 'صورة البوكس', ad: 'المحتوى الإعلاني' };
/** Thursday = 4 (Sunday is 0); read from the day key itself, not the server clock. */
const isThursday = (dateKey) => new Date(`${dateKey}T12:00:00Z`).getUTCDay() === 4;

const populate = (q) => q
  // The rep comes with the responsible supervisor: the report says who is accountable, while `supervisor` below says who actually checked, two different questions now that any supervisor can check any rep.
  // The subject is the registry row (`ltEmployee`), and `rep` covers old rows written with the app account; both are read so history is intact.
  .populate({ path: 'ltEmployee', select: 'name idNumber vehiclePlate vehicleTypeAr projectAr cityAr supervisorUser supervisorName dutySupervisorUser dutySupervisorName',
    populate: [
      { path: 'dutySupervisorUser', select: 'firstName lastName role' },
      { path: 'supervisorUser', select: 'firstName lastName role' },
    ] })
  .populate({ path: 'rep', select: 'englishName arabicName repId phone supervisor',
    populate: { path: 'supervisor', select: 'firstName lastName role' } })
  .populate('supervisor', 'firstName lastName email role')
  .populate('branch', 'name code')
  .populate('project', 'name nameAr')
  .populate('review.by', 'firstName lastName');

// Supervisor screen

/**
 * This supervisor's reps with today's check if any.
 * Returned together, not in two calls: the screen should not offer a rep and then discover after the tap that they were already checked this morning. A checked rep shows as done with the photo.
 */
/** Vehicle type as the check screen writes it, from the registration type in the vehicle registry. The screen knows three (bike/car/other) while the registry writes values like motorcycle, van and a brand name, so the translation lives in one place. */
const vehicleTypeKey = (typeAr) => {
  const v = String(typeAr || '');
  if (/دراج/.test(v)) return 'motorcycle';
  if (/سيار|فان|كيا|خاص|بيك|نقل خفيف/.test(v)) return 'car';
  return v ? 'other' : '';
};

/**
 * Scooters come from the vehicle registry.
 * A check targets the rep or the scooter. Scooters are every vehicle registered as a bike, except stolen ones (they do not leave a station).
 * The link comes from both registries: the rider is the rep whose light-transport plate is the scooter's plate, otherwise the person authorized on it (by residence number). The key is `registryPlateKey`, which wrote VehicleMaster.plateKey and keeps letters with digits, so two plates differing only in letters are two scooters.
 */
const { registryPlateKey } = require('../utils/plateKey');
const bikeKey = (v) => v.plateKey || registryPlateKey(v.plateNumber) || '';
async function dutyBikes() {
  const { VehicleMaster } = require('../models/VehicleMaster');
  return VehicleMaster.find({ registrationTypeAr: /دراج/, sectorAr: { $ne: 'مسروق' }, isActive: { $ne: false } })
    .select('plateNumber plateKey sectorAr departmentAr cityAr authorizedPerson.name authorizedPerson.iqamaNumber').lean();
}
/** Builds the 'rider of this scooter' lookup from the rep rows (excluding car drivers). */
function riderFinder(reps) {
  const byPlate = new Map();
  const byId = new Map();
  for (const e of reps) {
    const k = registryPlateKey(e.vehiclePlate);
    if (k && !byPlate.has(k)) byPlate.set(k, e);
    if (e.idNumber) byId.set(String(e.idNumber).trim(), e);
  }
  return (bike) => byPlate.get(bikeKey(bike))
    || byId.get(String(bike.authorizedPerson?.iqamaNumber || '').trim())
    || null;
}
/** Ended service, in the section registry or in HR, is not checked, counted, or assigned a scooter. Same rule as every section (see isEnded in lightTransportController). */
// Work status comes from HR when a file exists, otherwise the last value written in the registry.
const endedRep = (e) => (e.employee && typeof e.employee === 'object' && e.employee.employmentStatus
  ? e.employee.employmentStatus === 'terminated'
  : e.workStatusAr === 'إنهاء خدمة');

const riderReps = async () => {
  const { LightTransportEmployee } = require('../models/LightTransport');
  const all = await LightTransportEmployee.find({ isActive: { $ne: false }, staffKind: 'rep' })
    .select('name idNumber vehiclePlate vehicleTypeAr workStatusAr employee').populate('employee', 'employmentStatus').lean();
  return all.filter((e) => vehicleTypeKey(e.vehicleTypeAr) !== 'car' && !endedRep(e));
};

exports.myReps = async (req, res) => {
  try {
    const dateKey = validKey(req.query.date) ? req.query.date : dayKeyOf();
    // Management may open the screen on behalf of a supervisor, so `supervisor` is passed explicitly.
    const asUser = canSeeAll(req.user) && req.query.supervisor ? req.query.supervisor : req.user._id;
    const { LightTransportEmployee } = require('../models/LightTransport');

    /**
     * The rep list is the light-transport registry, not B2CRep. B2CRep holds delivery-app accounts (593 rows, old and new) that the section mostly does not know; our reps are the registry's 157, each with ID, plate, supervisor and sponsorship.
     * This removes all name-based linking: supervisorUser, plate, ID and vehicle type are in the same row.
     * The check is for scooters: someone on a car or van is excluded, since the scooter and box photos mean nothing for them and they would count as negligent for nothing to photograph.
     */
    const all = await LightTransportEmployee.find({ isActive: { $ne: false }, staffKind: 'rep' })
      .select('name idNumber phone vehiclePlate vehicleTypeAr projectAr cityAr supervisorUser supervisorName dutySupervisorUser dutySupervisorName workStatusAr employee')
      .populate('supervisorUser', 'firstName lastName role')
      .populate('dutySupervisorUser', 'firstName lastName role')
      .populate('employee', 'employmentStatus')
      .sort({ name: 1 }).lean()
      .then((list) => list.filter((e) => !endedRep(e)));

    const rows = all.filter((e) => vehicleTypeKey(e.vehicleTypeAr) !== 'car');
    const carsExcluded = all.length - rows.length;

    // All of today's checks, those on a rep and those on a scooter, read from both sides, so a scooter check shows on its rider and a rep check on their scooter.
    const [checks, bikes] = await Promise.all([
      B2CDutyCheck.find({ dateKey })
        .select('ltEmployee vehicle vehicleKey outcome checkedAt photos conditionAr hasDamage damageNotes notes vehicleType vehiclePlate supervisorName')
        .lean(),
      dutyBikes(),
    ]);
    const byEmp = new Map(checks.filter((c) => c.ltEmployee).map((c) => [String(c.ltEmployee), c]));
    const byVeh = new Map();
    for (const c of checks) {
      const k = c.vehicleKey || registryPlateKey(c.vehiclePlate);
      if (k && !byVeh.has(k)) byVeh.set(k, c);
    }
    const repCheck = (e) => byEmp.get(String(e._id)) || byVeh.get(registryPlateKey(e.vehiclePlate)) || null;
    const riderOf = riderFinder(rows);

    // The section's scooters, listed for those with no plate in their row yet.
    const vehicleOptions = all
      .filter((e) => String(e.vehiclePlate || '').trim() && vehicleTypeKey(e.vehicleTypeAr) !== 'car')
      .map((e) => ({ plate: e.vehiclePlate, typeAr: e.vehicleTypeAr || '', rider: e.name || '' }))
      .sort((a, b) => a.plate.localeCompare(b.plate, 'ar'));

    /** 'My reps' here is check supervision, not operational supervision. Operational supervision covers the whole day (project, branch, work); this screen covers one hour: who stands at the station in the morning and photographs before leaving. The list is split by check supervisor, and all reps stay visible to everyone. */
    const mineOf = (e) => String(e.dutySupervisorUser?._id || e.dutySupervisorUser || '') === String(asUser);
    res.json({
      dateKey,
      isToday: dateKey === dayKeyOf(),
      carsExcluded,
      vehicleOptions,
      reps: rows.map((e) => {
        const duty = e.dutySupervisorUser && typeof e.dutySupervisorUser === 'object' ? e.dutySupervisorUser : null;
        const owner = e.supervisorUser && typeof e.supervisorUser === 'object' ? e.supervisorUser : null;
        return {
          _id: String(e._id),
          // The screen reads two names while the registry stores one, so it is given to both.
          englishName: e.name,
          arabicName: e.name,
          repId: e.idNumber || '',
          idNumber: e.idNumber || '',
          phone: e.phone || '',
          branch: e.cityAr ? { name: e.cityAr } : null,
          project: e.projectAr ? { name: e.projectAr } : null,
          vehicle: String(e.vehiclePlate || '').trim()
            ? { plate: e.vehiclePlate, typeAr: e.vehicleTypeAr || '', typeKey: vehicleTypeKey(e.vehicleTypeAr) }
            : null,
          // The check supervisor owns this screen; the operational supervisor is shown for information.
          ownerName: duty ? [duty.firstName, duty.lastName].filter(Boolean).join(' ') : (e.dutySupervisorName || ''),
          opsSupervisorName: owner ? [owner.firstName, owner.lastName].filter(Boolean).join(' ') : (e.supervisorName || ''),
          hasDutySupervisor: !!(e.dutySupervisorUser),
          mine: mineOf(e),
          check: repCheck(e),
        };
      }),
      // Scooters: any can be checked directly, with its rider when known.
      bikes: bikes.map((b) => {
        const rider = riderOf(b);
        return {
          _id: String(b._id),
          plate: b.plateNumber || '',
          sectorAr: b.sectorAr || '',
          cityAr: b.cityAr || '',
          departmentAr: b.departmentAr || '',
          authorizedName: b.authorizedPerson?.name || '',
          rider: rider ? { _id: String(rider._id), name: rider.name || '', idNumber: rider.idNumber || '' } : null,
          check: byVeh.get(bikeKey(b)) || (rider ? byEmp.get(String(rider._id)) : null) || null,
        };
      }).sort((a, b) => a.plate.localeCompare(b.plate, 'ar')),
      // 'How many of my men did I complete': the metric a supervisor is asked about.
      mineTotal: rows.filter(mineOf).length,
      mineDone: rows.filter((e) => mineOf(e) && repCheck(e)).length,
      // A rep with no check supervisor appears in nobody's list, so the count is reported explicitly.
      unassigned: rows.filter((e) => !e.dutySupervisorUser).length,
      done: rows.filter(repCheck).length,
      total: rows.length,
    });
  } catch (e) { res.status(500).json({ message: 'تعذّر تحميل مندوبيك' }); }
};

/**
 * Rep guard: does the rep exist, is active, and is a scooter rep.
 * The subject is the registry row, not the app account. `ltEmployee` (or `rep` from an old client) is read from the light-transport registry, which holds ID, plate and supervisor, so no name matching or guessed link is needed.
 * The 'one of your men' condition is gone: a colleague covers an absent supervisor, and who did it is stored on the record (`supervisor` + `supervisorName`) while the registry assignment keeps responsibility.
 */
const assertOwnsRep = async (req, repId, ltId) => {
  const { LightTransportEmployee } = require('../models/LightTransport');
  const id = ltId || repId;
  if (!id) return { error: 400, message: 'اختر المندوب' };

  // Primary: a row in the light-transport registry.
  const emp = await LightTransportEmployee.findById(id)
    .select('name idNumber vehiclePlate vehicleTypeAr projectAr cityAr isActive staffKind workStatusAr employee')
    .populate('employee', 'employmentStatus').lean();
  if (emp) {
    if (emp.isActive === false) return { error: 400, message: 'هذا المندوب خارج سجلّ القسم' };
    if (endedRep(emp)) return { error: 400, message: 'هذا المندوب منتهي الخدمة — لا يُتفقَّد' };
    if (vehicleTypeKey(emp.vehicleTypeAr) === 'car') {
      return { error: 400, message: 'التفقّد للدبّابات — هذا الموظّف على سيّارة' };
    }
    return { emp, rep: { _id: emp._id, englishName: emp.name, branch: null, project: null } };
  }

  // An old client sends the app account; accepted until it updates.
  const rep = await B2CRep.findById(id).select('supervisor branch project englishName isActive ltEmployee').lean();
  if (!rep) return { error: 404, message: 'المندوب غير موجود' };
  if (rep.isActive === false) return { error: 400, message: 'هذا المندوب غير نشط' };
  return { rep };
};

/**
 * Recording the check.
 * Why a photo without a capture is rejected: the photo is the whole evidence, and allowing uploads from files would turn the row into a form filled from the office. The browser's claim about itself is not trusted, but the UI offers no other path and the source is stored on the row for questions.
 * 'Started duty' requires photos, the condition the screen exists for. Absent and blocked have none, since no vehicle left to photograph.
 */
exports.submit = async (req, res) => {
  const saved = [];
  try {
    const { rep: repId, outcome = 'started', photos = [] } = req.body;
    let ltId = req.body.ltEmployee;
    if (!repId && !ltId && !req.body.vehicle) return res.status(400).json({ message: 'اختر المندوب أو الدبّاب' });
    if (!['started', 'absent', 'blocked'].includes(outcome)) {
      return res.status(400).json({ message: 'حالة غير معروفة' });
    }

    /**
     * Scooter and rider are one row.
     * A request with a scooter resolves its rider (plate in the registry, or the authorized person), so the check is also theirs. A request with a rep resolves the scooter from the plate. A scooter with no rider is checked alone.
     */
    const { VehicleMaster } = require('../models/VehicleMaster');
    let bike = null;
    if (req.body.vehicle) {
      if (!mongoose.isValidObjectId(req.body.vehicle)) return res.status(400).json({ message: 'الدبّاب غير معروف' });
      bike = await VehicleMaster.findById(req.body.vehicle)
        .select('plateNumber plateKey registrationTypeAr sectorAr authorizedPerson.iqamaNumber').lean();
      if (!bike) return res.status(404).json({ message: 'الدبّاب غير موجود في سجلّ المركبات' });
      if (!ltId && !repId) {
        const rider = riderFinder(await riderReps())(bike);
        if (rider) ltId = rider._id;
      }
    }
    const own = (ltId || repId) ? await assertOwnsRep(req, repId, ltId) : { bikeOnly: true };
    if (own.error) return res.status(own.error).json({ message: own.message });
    if (!bike && own.emp) {
      const k = registryPlateKey(String(req.body.vehiclePlate || '').trim() || own.emp.vehiclePlate);
      if (k) bike = await VehicleMaster.findOne({ plateKey: k }).select('plateNumber plateKey registrationTypeAr').lean();
    }
    const subjectName = own.emp?.name || own.rep?.englishName || (bike ? `دبّاب ${bike.plateNumber}` : '');

    /** Anyone who did not go out is asked why. 'Started duty' is backed by three photos; 'absent' and 'blocked' have only the supervisor's word, and a whole day of income drops with one tap and no recorded reason. So the note is required for both (sick, scooter broke down, blocked for an expired operating card): one line written once and read in every review. */
    if (outcome !== 'started' && !String(req.body.notes || '').trim()) {
      return res.status(400).json({
        code: 'NOTE_REQUIRED',
        message: outcome === 'absent'
          ? 'اكتب سببَ عدم الحضور — «لم يحضر» بلا سببٍ لا يُراجَع'
          : 'اكتب سببَ المنع من الخروج — «مُنع» بلا سببٍ لا يُراجَع',
      });
    }

    const dateKey = validKey(req.body.date) && canSeeAll(req.user) ? req.body.date : dayKeyOf();
    const { year, month, day, date } = partsOf(dateKey);

    // Today's row if any, by rep or by scooter. If both exist as two rows (scooter checked alone, then the rider became known), the scooter row merges into the rep row.
    const [byRep, bikeRow] = await Promise.all([
      own.emp ? B2CDutyCheck.findOne({ ltEmployee: own.emp._id, dateKey })
        : own.rep ? B2CDutyCheck.findOne({ rep: own.rep._id, dateKey }) : null,
      bike ? B2CDutyCheck.findOne({ vehicle: bike._id, dateKey }) : null,
    ]);
    // A scooter shared by two men is checked with the first; the second is recorded alone without the scooter link, since the index allows one row per scooter per day.
    const bikeTaken = !!(bikeRow && bikeRow.ltEmployee && own.emp && String(bikeRow.ltEmployee) !== String(own.emp._id));
    const byBike = bikeTaken ? null : bikeRow;
    if (bikeTaken) bike = null;
    const existing = byRep || byBike;
    const merged = byRep && byBike && String(byRep._id) !== String(byBike._id) ? byBike : null;

    // Starting duty needs all three photos: rep, scooter and box. What was saved in the morning counts, so a correction does not force retaking photos.
    // The old UI (before the split) sends no `kind`; one photo is accepted from it until it updates, so supervisors are not locked out between the server deploy and the web/app deploy.
    const legacyClient = photos.length > 0 && photos.every((p) => !p?.kind);
    if (outcome === 'started' && legacyClient) {
      // The single photo sent is enough.
    } else if (outcome === 'started') {
      const have = new Set([
        ...(existing?.photos || []).map((p) => p.kind || 'vehicle'),
        ...(merged?.photos || []).map((p) => p.kind || 'vehicle'),
        ...photos.map((p) => p?.kind).filter((k) => PHOTO_KINDS.includes(k)),
      ]);
      // All three photos in every case, even when the rider is not authorized or known beforehand: whoever takes the scooter out today is photographed.
      const required = REQUIRED_PHOTO_KINDS;
      const lacking = required.filter((k) => !have.has(k));
      if (lacking.length) {
        return res.status(400).json({ message: `لا بدّ من ${lacking.map((k) => PHOTO_KIND_AR[k]).join(' و')} لتسجيل بدء الدوام` });
      }
    }

    // The advertising-content photo is rejected on days other than Thursday, reported instead of silently saved.
    if (photos.some((p) => p?.kind === AD_KIND) && !isThursday(dateKey)) {
      return res.status(400).json({ message: 'صور المحتوى الإعلاني تُضاف يوم الخميس فقط' });
    }

    // The three required photos plus any content photos, so the limit is wider.
    for (const p of photos.slice(0, 12)) {
      const src = String(p?.dataUrl || '');
      if (!src.startsWith('data:image/')) {
        return res.status(400).json({ message: 'الصورة يجب أن تُلتقَط من الكاميرا' });
      }
      try {
        const f = saveUploadFile(src, 'b2c-duty', p.fileName || 'duty.jpg');
        saved.push({
          ...f,
          captureSource: p.captureSource === 'camera' ? 'camera' : 'unknown',
          kind: PHOTO_KINDS.includes(p.kind) ? p.kind : 'vehicle',
          takenAt: new Date(),
        });
      } catch (err) { return res.status(400).json({ message: err.message }); }
    }

    const me = await User.findById(req.user._id).select('firstName lastName').lean();
    const doc = {
      // The subject is the registry row. `rep` is written only if the request came with an app account (old client), so no unrequested link is created.
      ltEmployee: own.emp ? own.emp._id : (own.rep?.ltEmployee || null),
      rep: own.rep && !own.emp ? own.rep._id : undefined,
      vehicle: bike ? bike._id : undefined,
      vehicleKey: bike ? bikeKey(bike) : undefined,
      supervisor: req.user._id,
      supervisorName: [me?.firstName, me?.lastName].filter(Boolean).join(' '),
      branch: own.rep && !own.emp ? (own.rep.branch || null) : null,
      project: own.rep && !own.emp ? (own.rep.project || null) : null,
      date, dateKey, year, month, day,
      checkedAt: new Date(),
      outcome,
      vehicleType: req.body.vehicleType || (bike ? 'motorcycle' : ''),
      vehiclePlate: String(req.body.vehiclePlate || '').trim() || (bike ? bike.plateNumber : ''),
      conditionAr: String(req.body.conditionAr || '').trim(),
      hasDamage: !!req.body.hasDamage,
      damageNotes: String(req.body.damageNotes || '').trim(),
      notes: String(req.body.notes || '').trim(),
      location: req.body.location && Number.isFinite(Number(req.body.location.lat))
        ? {
          lat: Number(req.body.location.lat),
          lng: Number(req.body.location.lng),
          accuracy: Number(req.body.location.accuracy) || undefined,
        } : undefined,
      createdBy: req.user._id,
    };

    // A correction updates the day's row instead of adding a second; see the unique index.
    if (merged) await B2CDutyCheck.deleteOne({ _id: merged._id });
    let check;
    if (existing) {
      // Photos are appended and never erased: the morning photo is evidence and is not replaced after an incident.
      doc.photos = [...(existing.photos || []), ...(merged?.photos || []), ...saved];
      Object.assign(existing, doc);
      check = await existing.save();
    } else {
      check = await B2CDutyCheck.create({ ...doc, photos: saved });
    }

    /**
     * The plate is chosen once, not every day.
     * For a rep whose account has no link to a registry row (the name was ambiguous and matching was refused), the supervisor picks the plate from the section's scooter list. That choice is a fact: this man is on this scooter. If the plate belongs to exactly one registry row, the link is saved from it, so tomorrow's screen has the plate filled and reads his ID number and vehicle type with it.
     * The link is not written when the plate belongs to two rows (a scooter shared by two men): a guess is not stored. An existing link is not replaced; that is changed from the registry, not here.
     */
    // The app-account link is saved when the request came from it and its plate is known in the registry; only for the old client, since the new screen's subject is the registry row.
    if (own.rep && !own.emp && !own.rep.ltEmployee && doc.vehiclePlate) {
      try {
        const { LightTransportEmployee: LTE2 } = require('../models/LightTransport');
        const hit = await LTE2.find({ isActive: { $ne: false }, vehiclePlate: doc.vehiclePlate })
          .select('_id').limit(2).lean();
        if (hit.length === 1) await B2CRep.updateOne({ _id: own.rep._id }, { $set: { ltEmployee: hit[0]._id } });
      } catch (e) { /* Linking serves tomorrow; its failure must not affect today's check. */ }
    }

    await logAudit({
      user: req.user._id, action: existing ? 'update_b2c_duty_check' : 'create_b2c_duty_check',
      entity: 'B2CDutyCheck', entityId: check._id,
      changes: { after: { rep: subjectName, vehicle: doc.vehiclePlate || undefined, dateKey, outcome } }, ipAddress: req.ip,
    });

    // What does not go out is notified immediately: a damaged vehicle or a rep blocked from work.
    if (doc.hasDamage || outcome === 'blocked') {
      const heads = await User.find({ role: { $in: ['b2c_manager', 'b2c_deputy', 'super_admin'] }, isActive: true })
        .select('_id').lean();
      await Promise.all(heads.map((h) => createNotification({
        recipient: h._id, type: 'system_alert',
        title: outcome === 'blocked' ? 'مندوب مُنع من الخروج' : 'تلف في مركبة مندوب',
        message: `${subjectName || ''} — ${doc.damageNotes || doc.conditionAr || ''}`.trim(),
        relatedEntity: 'B2CDutyCheck', relatedEntityId: check._id,
      }).catch(() => {})));
    }

    try { emitToAll('b2c:duty', { dateKey }); } catch (e) { /* */ }
    const out = await populate(B2CDutyCheck.findById(check._id)).lean();
    res.status(existing ? 200 : 201).json({ check: out });
  } catch (e) {
    // A file written whose save then failed is removed, not left orphaned on disk.
    saved.forEach((f) => { try { deleteStoredFile(f.fileUrl); } catch (x) { /* */ } });
    if (e?.code === 11000) return res.status(409).json({ message: 'سُجِّل تفقّدٌ لهذا المندوب أو الدبّاب اليوم — افتحه من القائمة' });
    return sendMongooseError(res, e, 'تعذّر حفظ التفقّد');
  }
};

// Management log

/** Read condition: management sees all; a supervisor sees what they recorded. */
/**
 * What a supervisor sees in the report.
 * It used to be only what they recorded themselves. Now any supervisor can check any rep, so that scope would hide their own men when a colleague checks them, which is the first thing they are asked ('who sent out my men today?').
 * They now see what they did and what happened to their reps by anyone; both mean what they are accountable for.
 */
const scopeOf = async (req) => {
  if (canSeeAll(req.user)) return {};
  const { LightTransportEmployee } = require('../models/LightTransport');
  const [mineEmp, mineRep] = await Promise.all([
    LightTransportEmployee.find({ dutySupervisorUser: req.user._id }).select('_id').lean(),
    B2CRep.find({ supervisor: req.user._id }).select('_id').lean(),
  ]);
  const or = [{ supervisor: req.user._id }];
  if (mineEmp.length) or.push({ ltEmployee: { $in: mineEmp.map((r) => r._id) } });
  if (mineRep.length) or.push({ rep: { $in: mineRep.map((r) => r._id) } });
  return or.length === 1 ? or[0] : { $or: or };
};

const listFilter = async (req) => {
  const q = req.query || {};
  const and = [await scopeOf(req)];
  // One day, or a range between two dates; neither means today.
  if (validKey(q.from) && validKey(q.to)) and.push({ dateKey: { $gte: q.from, $lte: q.to } });
  else if (validKey(q.date)) and.push({ dateKey: q.date });
  else if (validKey(q.from)) and.push({ dateKey: { $gte: q.from } });
  else if (validKey(q.to)) and.push({ dateKey: { $lte: q.to } });
  else and.push({ dateKey: dayKeyOf() });

  const oid = (v) => (mongoose.isValidObjectId(v) ? new mongoose.Types.ObjectId(String(v)) : null);
  if (oid(q.supervisor)) and.push({ supervisor: oid(q.supervisor) });
  if (oid(q.branch)) and.push({ branch: oid(q.branch) });
  if (oid(q.project)) and.push({ project: oid(q.project) });
  // A specific rep, by registry row id or by the old app account.
  if (oid(q.rep)) and.push({ $or: [{ ltEmployee: oid(q.rep) }, { rep: oid(q.rep) }] });
  if (['started', 'absent', 'blocked'].includes(q.outcome)) and.push({ outcome: q.outcome });
  if (q.damage === '1') and.push({ hasDamage: true });
  if (q.flagged === '1') and.push({ 'review.verdict': 'flagged' });
  if (q.unreviewed === '1') and.push({ $or: [{ 'review.verdict': '' }, { 'review.verdict': { $exists: false } }] });
  if (q.withPhoto === '1') and.push({ 'photos.0': { $exists: true } });
  if (PHOTO_KINDS.includes(q.photoKind)) and.push({ 'photos.kind': q.photoKind });
  return and.length === 1 ? and[0] : { $and: and };
};

exports.list = async (req, res) => {
  try {
    const filter = await listFilter(req);
    const limit = Math.min(Number(req.query.limit) || 300, 1000);
    const page = Math.max(Number(req.query.page) || 1, 1);
    const [rows, total] = await Promise.all([
      populate(B2CDutyCheck.find(filter)).sort({ checkedAt: -1 })
        .skip((page - 1) * limit).limit(limit).lean(),
      B2CDutyCheck.countDocuments(filter),
    ]);
    res.json({ rows, total, page, pages: Math.ceil(total / limit) || 1 });
  } catch (e) { res.status(500).json({ message: 'تعذّر تحميل السجلّ' }); }
};

exports.getOne = async (req, res) => {
  try {
    const row = await populate(B2CDutyCheck.findById(req.params.id)).lean();
    if (!row) return res.status(404).json({ message: 'غير موجود' });
    if (!canSeeAll(req.user) && String(row.supervisor?._id || row.supervisor) !== String(req.user._id)) {
      return res.status(403).json({ message: 'غير مصرّح' });
    }
    res.json({ check: row });
  } catch (e) { res.status(500).json({ message: 'تعذّر التحميل' }); }
};

/**
 * Management review of a specific row.
 * Half the purpose of the screen: the photo is taken so someone reads it and rules it fine or accountable. Without this field the log is an archive no decision builds on.
 */
exports.review = async (req, res) => {
  try {
    if (!canSeeAll(req.user)) return res.status(403).json({ message: 'المراجعة للإدارة' });
    const verdict = req.body.verdict === 'flagged' ? 'flagged' : req.body.verdict === 'ok' ? 'ok' : '';
    const row = await B2CDutyCheck.findByIdAndUpdate(
      req.params.id,
      { $set: { review: { by: req.user._id, at: new Date(), verdict, note: String(req.body.note || '').trim() } } },
      { new: true },
    );
    if (!row) return res.status(404).json({ message: 'غير موجود' });
    // The supervisor is told what was said about their check; otherwise accountability happens without their knowledge.
    if (verdict === 'flagged') {
      await createNotification({
        recipient: row.supervisor, type: 'system_alert',
        title: 'ملاحظة على تفقّد بداية الدوام',
        message: String(req.body.note || '').trim() || 'راجع الإدارةُ أحد تفقّداتك.',
        relatedEntity: 'B2CDutyCheck', relatedEntityId: row._id,
      }).catch(() => {});
    }
    try { emitToAll('b2c:duty', { dateKey: row.dateKey }); } catch (e) { /* */ }
    res.json({ check: await populate(B2CDutyCheck.findById(row._id)).lean() });
  } catch (e) { return sendMongooseError(res, e, 'تعذّر حفظ المراجعة'); }
};

// Analysis

/**
 * Compliance analysis, not order analysis.
 * The question is whether the supervisor stood by their men, so the metric is the ratio of checks to who should have been checked (10 of 10 is full compliance, 10 of 30 is a shortfall), not the check count. The denominator cannot come from the check table (no row is written for the neglected), so it is read from `B2CRep`.
 * Computed in the database, not Node; see dashboard-performance.
 */
exports.analytics = async (req, res) => {
  try {
    const q = req.query || {};
    const to = validKey(q.to) ? q.to : dayKeyOf();
    const from = validKey(q.from) ? q.from : to;
    const base = { ...(await scopeOf(req)), dateKey: { $gte: from, $lte: to } };
    const oid = (v) => (mongoose.isValidObjectId(v) ? new mongoose.Types.ObjectId(String(v)) : null);
    if (oid(q.branch)) base.branch = oid(q.branch);
    if (oid(q.project)) base.project = oid(q.project);
    if (oid(q.supervisor)) base.supervisor = oid(q.supervisor);

    // Number of days in the range; the denominator of the compliance ratio.
    const days = Math.max(
      1,
      Math.round((new Date(`${to}T00:00:00Z`) - new Date(`${from}T00:00:00Z`)) / 86400000) + 1,
    );

    const repScope = { isActive: { $ne: false }, supervisor: { $ne: null } };
    if (base.branch) repScope.branch = base.branch;
    if (base.project) repScope.project = base.project;
    if (base.supervisor) repScope.supervisor = base.supervisor;
    else if (!canSeeAll(req.user)) repScope.supervisor = req.user._id;

    const [totals, bySupervisor, byDay, byCondition, byBranch, expected, topDamage] = await Promise.all([
      B2CDutyCheck.aggregate([
        { $match: base },
        { $group: {
          _id: null,
          checks: { $sum: 1 },
          started: { $sum: { $cond: [{ $eq: ['$outcome', 'started'] }, 1, 0] } },
          absent: { $sum: { $cond: [{ $eq: ['$outcome', 'absent'] }, 1, 0] } },
          blocked: { $sum: { $cond: [{ $eq: ['$outcome', 'blocked'] }, 1, 0] } },
          damaged: { $sum: { $cond: ['$hasDamage', 1, 0] } },
          withPhoto: { $sum: { $cond: [{ $gt: [{ $size: { $ifNull: ['$photos', []] } }, 0] }, 1, 0] } },
          ...Object.fromEntries(PHOTO_KINDS.map((k) => [`photo_${k}`, {
            $sum: { $size: { $filter: { input: { $ifNull: ['$photos', []] }, as: 'p', cond: { $eq: ['$$p.kind', k] } } } },
          }])),
          flagged: { $sum: { $cond: [{ $eq: ['$review.verdict', 'flagged'] }, 1, 0] } },
          reviewed: { $sum: { $cond: [{ $in: ['$review.verdict', ['ok', 'flagged']] }, 1, 0] } },
        } },
      ]),
      B2CDutyCheck.aggregate([
        { $match: base },
        { $group: {
          _id: '$supervisor',
          name: { $last: '$supervisorName' },
          checks: { $sum: 1 },
          started: { $sum: { $cond: [{ $eq: ['$outcome', 'started'] }, 1, 0] } },
          absent: { $sum: { $cond: [{ $eq: ['$outcome', 'absent'] }, 1, 0] } },
          blocked: { $sum: { $cond: [{ $eq: ['$outcome', 'blocked'] }, 1, 0] } },
          damaged: { $sum: { $cond: ['$hasDamage', 1, 0] } },
          flagged: { $sum: { $cond: [{ $eq: ['$review.verdict', 'flagged'] }, 1, 0] } },
          reps: { $addToSet: '$rep' },
          // When does the supervisor usually stand? Late every day is a question in itself.
          avgHour: { $avg: { $hour: { date: '$checkedAt', timezone: RIYADH } } },
        } },
        { $project: { name: 1, checks: 1, started: 1, absent: 1, blocked: 1, damaged: 1, flagged: 1, avgHour: 1, repCount: { $size: '$reps' } } },
        { $sort: { checks: -1 } },
      ]),
      B2CDutyCheck.aggregate([
        { $match: base },
        { $group: {
          _id: '$dateKey',
          checks: { $sum: 1 },
          started: { $sum: { $cond: [{ $eq: ['$outcome', 'started'] }, 1, 0] } },
          damaged: { $sum: { $cond: ['$hasDamage', 1, 0] } },
        } },
        { $sort: { _id: 1 } },
      ]),
      B2CDutyCheck.aggregate([
        { $match: { ...base, conditionAr: { $nin: ['', null] } } },
        { $group: { _id: '$conditionAr', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),
      B2CDutyCheck.aggregate([
        { $match: base },
        { $group: { _id: '$branch', checks: { $sum: 1 }, damaged: { $sum: { $cond: ['$hasDamage', 1, 0] } } } },
        { $lookup: { from: 'branches', localField: '_id', foreignField: '_id', as: 'b' } },
        { $project: { name: { $ifNull: [{ $first: '$b.name' }, '—'] }, checks: 1, damaged: 1 } },
        { $sort: { checks: -1 } },
      ]),
      // Denominator: how many reps per supervisor should be checked each day, from the rep roster (light-transport registry), scooters not cars.
      (async () => {
        const { LightTransportEmployee } = require('../models/LightTransport');
        // Ended-service reps are not expected to be checked, so they are out of the denominator; see `endedRep`.
        const rows = await LightTransportEmployee.find({ isActive: { $ne: false }, staffKind: 'rep', dutySupervisorUser: { $ne: null } })
          .select('dutySupervisorUser vehicleTypeAr workStatusAr employee').populate('employee', 'employmentStatus').lean();
        const by = new Map();
        for (const e of rows) {
          if (vehicleTypeKey(e.vehicleTypeAr) === 'car' || endedRep(e)) continue;
          const k = String(e.dutySupervisorUser);
          by.set(k, (by.get(k) || 0) + 1);
        }
        return [...by].map(([id, reps]) => ({ _id: id, reps }));
      })(),
      // Whoever's vehicle is repeatedly damaged: the person, not the day.
      B2CDutyCheck.aggregate([
        { $match: { ...base, hasDamage: true } },
        { $group: { _id: { $ifNull: ['$ltEmployee', '$rep'] }, times: { $sum: 1 }, last: { $max: '$dateKey' } } },
        { $sort: { times: -1 } },
        { $limit: 10 },
        { $lookup: { from: 'b2creps', localField: '_id', foreignField: '_id', as: 'r' } },
        { $project: { times: 1, last: 1, name: { $ifNull: [{ $first: '$r.englishName' }, '—'] } } },
      ]),
    ]);

    const expectedBySup = new Map(expected.map((e) => [String(e._id), e.reps]));
    const totalExpected = expected.reduce((a, b) => a + b.reps, 0) * days;
    const t = totals[0] || {};

    // The supervisor's name is read from the account, not only from the snapshot: they may have reps and never have checked anyone, so no name snapshot exists for them in the table.
    const supIds = [...new Set([...bySupervisor.map((x) => String(x._id)), ...expected.map((x) => String(x._id))])]
      .filter((x) => mongoose.isValidObjectId(x));
    const users = await User.find({ _id: { $in: supIds } }).select('firstName lastName').lean();
    const nameById = new Map(users.map((u) => [String(u._id), [u.firstName, u.lastName].filter(Boolean).join(' ')]));

    const supervisors = supIds.map((id) => {
      const row = bySupervisor.find((x) => String(x._id) === id) || {};
      const reps = expectedBySup.get(id) || 0;
      const due = reps * days;
      return {
        _id: id,
        name: nameById.get(id) || row.name || '—',
        reps,
        due,
        checks: row.checks || 0,
        started: row.started || 0,
        absent: row.absent || 0,
        blocked: row.blocked || 0,
        damaged: row.damaged || 0,
        flagged: row.flagged || 0,
        avgHour: row.avgHour != null ? Math.round(row.avgHour * 10) / 10 : null,
        compliance: due ? Math.round(((row.checks || 0) / due) * 1000) / 10 : null,
      };
    }).sort((a, b) => (b.compliance ?? -1) - (a.compliance ?? -1));

    res.json({
      from, to, days,
      totals: {
        checks: t.checks || 0,
        started: t.started || 0,
        absent: t.absent || 0,
        blocked: t.blocked || 0,
        damaged: t.damaged || 0,
        withPhoto: t.withPhoto || 0,
        photosByKind: Object.fromEntries(PHOTO_KINDS.map((k) => [k, t[`photo_${k}`] || 0])),
        flagged: t.flagged || 0,
        reviewed: t.reviewed || 0,
        expected: totalExpected,
        compliance: totalExpected ? Math.round(((t.checks || 0) / totalExpected) * 1000) / 10 : null,
      },
      supervisors,
      byDay,
      byCondition,
      byBranch,
      topDamage,
    });
  } catch (e) {
    console.error('b2c duty analytics', e);
    res.status(500).json({ message: 'تعذّر تحميل التحليل' });
  }
};

/** Who was not checked today: the list the check table cannot show because their row is not written. The first thing management opens in the morning. */
exports.missing = async (req, res) => {
  try {
    const dateKey = validKey(req.query.date) ? req.query.date : dayKeyOf();
    // 'Not checked today' comes from the rep roster (light-transport registry), not app accounts. Scooters only: someone on a car has no check.
    const { LightTransportEmployee } = require('../models/LightTransport');
    const repScope = { isActive: { $ne: false }, staffKind: 'rep', dutySupervisorUser: { $ne: null } };
    if (!canSeeAll(req.user)) repScope.dutySupervisorUser = req.user._id;
    else if (mongoose.isValidObjectId(req.query.supervisor)) repScope.dutySupervisorUser = new mongoose.Types.ObjectId(String(req.query.supervisor));

    const allRows = await LightTransportEmployee.find(repScope)
      .select('name idNumber vehiclePlate vehicleTypeAr cityAr dutySupervisorUser dutySupervisorName workStatusAr employee')
      .populate('dutySupervisorUser', 'firstName lastName')
      .populate('employee', 'employmentStatus').lean();
    const reps = allRows
      .filter((e) => vehicleTypeKey(e.vehicleTypeAr) !== 'car' && !endedRep(e))
      .map((e) => ({
        _id: e._id, englishName: e.name, arabicName: e.name, repId: e.idNumber || '',
        vehiclePlate: e.vehiclePlate || '',
        branch: e.cityAr ? { name: e.cityAr } : null,
        supervisor: e.dutySupervisorUser || null,
      }));
    const done = new Set((await B2CDutyCheck.find({ dateKey, ltEmployee: { $in: reps.map((r) => r._id) } })
      .select('ltEmployee').lean()).map((c) => String(c.ltEmployee)));

    const rows = reps.filter((r) => !done.has(String(r._id)));
    res.json({ dateKey, missing: rows, total: reps.length, done: done.size });
  } catch (e) { res.status(500).json({ message: 'تعذّر التحميل' }); }
};

/** Supervisors that have reps; filter and assignment lists are built from them. */
exports.supervisors = async (req, res) => {
  try {
    // Supervisor candidates: every active account with a section role, not only those with reps. The list used to be completed in the UI from `/api/users`, which a project manager cannot open, so they saw only previously assigned supervisors.
    const [counts, users] = await Promise.all([
      // Rep count per supervisor, from the section roster, not app accounts.
      (async () => {
        const { LightTransportEmployee } = require('../models/LightTransport');
        // Only those currently working, scooters not cars, same as the analysis denominator.
        const rows = await LightTransportEmployee.find({ isActive: { $ne: false }, staffKind: 'rep', dutySupervisorUser: { $ne: null } })
          .select('dutySupervisorUser vehicleTypeAr workStatusAr employee').populate('employee', 'employmentStatus').lean();
        const by = new Map();
        for (const e of rows) {
          if (vehicleTypeKey(e.vehicleTypeAr) === 'car' || endedRep(e)) continue;
          const k = String(e.dutySupervisorUser);
          by.set(k, (by.get(k) || 0) + 1);
        }
        return [...by].map(([id, reps]) => ({ _id: id, reps }));
      })(),
      User.find({ role: { $in: SUPERVISOR_ROLES }, isActive: { $ne: false } })
        .select('firstName lastName role').lean(),
    ]);
    const repsBy = new Map(counts.map((c) => [String(c._id), c.reps]));
    const byId = new Map(users.map((u) => [String(u._id), u]));
    // A supervisor who has reps and changed role stays visible until the reps are moved.
    const missing = counts.map((c) => String(c._id)).filter((id) => !byId.has(id));
    if (missing.length) {
      (await User.find({ _id: { $in: missing } }).select('firstName lastName role').lean())
        .forEach((u) => byId.set(String(u._id), u));
    }
    const ORDER = { b2c_rep_supervisor: 0, b2c_inspection_supervisor: 1, b2c_project_lead: 2, b2c_deputy: 3, b2c_manager: 4 };
    // An archived supervisor is not shown even if reps are still assigned to them, as if deleted.
    const { endedStaff, userArchived } = require('../utils/endedStaff');
    const archSets = await endedStaff();
    const supervisors = [...byId.values()].filter((u) => !userArchived(archSets, u)).map((u) => ({
      _id: u._id,
      name: [u.firstName, u.lastName].filter(Boolean).join(' ') || '—',
      role: u.role,
      reps: repsBy.get(String(u._id)) || 0,
    })).sort((a, b) => (ORDER[a.role] ?? 9) - (ORDER[b.role] ?? 9) || b.reps - a.reps || a.name.localeCompare(b.name));
    res.json({ supervisors });
  } catch (e) { res.status(500).json({ message: 'تعذّر التحميل' }); }
};

/** Assign reps to a supervisor in one batch from the reps screen. */
exports.assign = async (req, res) => {
  try {
    const ids = (Array.isArray(req.body.reps) ? req.body.reps : []).filter((x) => mongoose.isValidObjectId(x));
    if (!ids.length) return res.status(400).json({ message: 'اختر مندوبًا واحدًا على الأقلّ' });
    const sup = req.body.supervisor;
    // Empty means 'no supervisor', an intentional action and not an input error.
    if (sup && !mongoose.isValidObjectId(sup)) return res.status(400).json({ message: 'مشرف غير صالح' });
    if (sup) {
      const su = await User.findById(sup).select('role isActive').lean();
      if (!su || su.isActive === false || !SUPERVISOR_ROLES.includes(su.role)) {
        return res.status(400).json({ message: 'هذا الحساب ليس مشرف مناديب ولا مدير مشروع' });
      }
    }
    const r = await B2CRep.updateMany({ _id: { $in: ids } }, { $set: { supervisor: sup || null } });
    await logAudit({
      user: req.user._id, action: 'assign_b2c_supervisor', entity: 'B2CRep',
      changes: { after: { reps: ids.length, supervisor: sup || null } }, ipAddress: req.ip,
    });
    try { emitToAll('b2c:duty', {}); } catch (e) { /* */ }
    res.json({ updated: r.modifiedCount ?? r.nModified ?? 0 });
  } catch (e) { return sendMongooseError(res, e, 'تعذّر الإسناد'); }
};

module.exports.dayKeyOf = dayKeyOf;
module.exports.canSeeAll = canSeeAll;
module.exports.populate = populate;
module.exports.validKey = validKey;
