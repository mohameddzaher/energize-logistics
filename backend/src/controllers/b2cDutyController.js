/**
 * تفقُّد بداية الدوام — شاشةُ المشرف وسجلُّ الإدارة وتحليلُهما.
 *
 * ── القسمةُ التي يقوم عليها الملفّ ────────────────────────────────────────
 * المشرفُ يرى مندوبيه هو ويكتب فيهم (`myReps` / `submit`).
 * والإدارةُ ترى الجميعَ ولا تكتب إلّا مراجعتَها (`list` / `analytics` / `review`).
 *
 * وما يراه المشرفُ محسومٌ من `B2CRep.supervisor` لا من دورِه — فلو فتح الشاشةَ
 * مَن لا مندوبَ له لم يرَ شيئًا، ولو حاول أن يُفقّد مندوبَ غيره رُدَّ. راجع
 * `assertOwnsRep`.
 */
const mongoose = require('mongoose');
const B2CDutyCheck = require('../models/B2CDutyCheck');
const B2CRep = require('../models/B2CRep');
const User = require('../models/User');
// يُطلَبان ليُسجَّل مخطّطاهما: `populate('branch')` يفشل بـ MissingSchemaError
// إن لم يُحمَّل الموديل، ولا يظهر ذلك إلّا خارج الخادم (سكربت، اختبار، عامل).
require('../models/Branch');
require('../models/B2CProject');
const { saveUploadFile, deleteStoredFile } = require('../utils/fileStore');
const { sendMongooseError } = require('../utils/mongooseError');
const logAudit = require('../utils/auditLogger');
const { createNotification } = require('../services/notificationService');
const { emitToAll } = require('../websocket/socketManager');

/** مَن يصلح أن يُسنَد إليه مندوب. */
// أدوارُ الإشراف من موضعٍ واحد: سجلُّ النقل الخفيف يُسنِد بها، وهذه الشاشةُ
// تقرأ بها — وقائمتان تفترقان تعني رجلًا مُسنَدًا لا يراه مشرفُه.
const { SUPERVISOR_ROLES } = require('../utils/b2cSupervisors');
const FULL_VIEW_ROLES = ['super_admin', 'admin', 'it_manager', 'it_specialist', 'b2c_manager'];
const canSeeAll = (u) => FULL_VIEW_ROLES.includes(u?.role || '');

/** مفتاحُ اليوم بتوقيت الرياض — لا بتوقيت الخادم ولا بتوقيت متصفّح المستخدم. */
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

/** أنواعُ صور الخروج — كلُّ خروجٍ يحتاجها الثلاثة. */
// ── ثلاثٌ تُطلَب، ورابعةٌ ليوم الخميس ──────────────────────────────────────
// صورُ المندوب والدبّاب والبوكس شرطُ بدء الدوام — بها تُقارَن المركبةُ إن رجعت
// مكسورة. و«المحتوى الإعلاني» غيرُها: لقطةٌ للملصق على الدبّاب تُطلَب أسبوعيًّا
// يوم الخميس، فليست شرطًا لبدء الدوام ولا تُقبَل في غير يومها — وإلّا صارت
// «صورةَ أيّ يوم» ولا يُعرف أسبوعُها. وتتكرّر: الملصقُ أكثرُ من وجه.
const REQUIRED_PHOTO_KINDS = ['rep', 'vehicle', 'box'];
const AD_KIND = 'ad';
const PHOTO_KINDS = [...REQUIRED_PHOTO_KINDS, AD_KIND];
const PHOTO_KIND_AR = { rep: 'صورة المندوب', vehicle: 'صورة الدبّاب', box: 'صورة البوكس', ad: 'المحتوى الإعلاني' };
/** الخميس = ٤ (الأحد صفر). يُقرأ من مفتاح اليوم نفسِه لا من ساعة الخادم. */
const isThursday = (dateKey) => new Date(`${dateKey}T12:00:00Z`).getUTCDay() === 4;

const populate = (q) => q
  // ومع المندوب مشرفُه المسؤول: التقريرُ يقول مَن يُسأل عنه، و`supervisor`
  // أدناه يقول مَن تفقّده فعلًا — سؤالان مختلفان بعد أن صار أيُّ مشرفٍ يتفقّد
  // أيَّ مندوب.
  //
  // والموضوعُ صفُّ السجلّ (`ltEmployee`)، و`rep` لصفوفٍ قديمةٍ كُتبت بحساب
  // التطبيق — يُقرآن معًا فلا ينكسر تاريخ.
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

// ═══════════════════════════════════════════════════════════════════════════
//  شاشةُ المشرف
// ═══════════════════════════════════════════════════════════════════════════

/**
 * مندوبو هذا المشرف ومعهم تفقُّدُ اليوم إن وُجد.
 *
 * يعودان معًا لا في نداءين: الشاشةُ لا تعرض «اختر مندوبًا» ثمّ تكتشف بعد
 * الضغط أنّه فُقِّد صباحًا. ومَن فُقِّد يظهر منتهيًا ومعه صورتُه.
 */
/**
 * نوعُ المركبة كما تكتبه شاشةُ التفقّد، من نوعِ تسجيلها في سجلّ المركبات.
 * الشاشةُ تعرف ثلاثةً (دراجة/سيارة/أخرى)، والسجلُّ يكتب «دراجة نارية» و«فان»
 * و«كيا» — فالترجمةُ في موضعٍ واحد.
 */
const vehicleTypeKey = (typeAr) => {
  const v = String(typeAr || '');
  if (/دراج/.test(v)) return 'motorcycle';
  if (/سيار|فان|كيا|خاص|بيك|نقل خفيف/.test(v)) return 'car';
  return v ? 'other' : '';
};

exports.myReps = async (req, res) => {
  try {
    const dateKey = validKey(req.query.date) ? req.query.date : dayKeyOf();
    // الإدارةُ قد تفتح الشاشةَ نيابةً عن مشرف — تُمرَّر `supervisor` صراحةً.
    const asUser = canSeeAll(req.user) && req.query.supervisor ? req.query.supervisor : req.user._id;
    const { LightTransportEmployee } = require('../models/LightTransport');

    /**
     * ── كشفُ المناديب هو سجلُّ النقل الخفيف ─────────────────────────────────
     *
     * لا `B2CRep`: ذلك سجلُّ حساباتِ تطبيق التوصيل، خمسُمئةٍ وثلاثةٌ وتسعون صفًّا
     * من قديمها وجديدها، لا يعرف القسمُ أكثرَها. وكشفُ مناديبنا هو هذا: مئةٌ
     * وسبعةٌ وخمسون مندوبًا، لكلٍّ هويّتُه ولوحتُه ومشرفُه وكفالتُه.
     *
     * وبه سقط كلُّ الربطِ بالاسم: المشرفُ (`supervisorUser`) واللوحةُ والهويّةُ
     * ونوعُ المركبة كلُّها في الصفّ نفسِه — تُقرأ لا تُطابَق.
     *
     * والتفقّدُ للدبّابات: من مركبتُه سيّارةٌ أو فان يُرفَع — صورةُ الدبّاب
     * والبوكس لا معنى لهما فيه، وظهورُه كلَّ صباحٍ بلا ما يُصوَّر يُعَدُّ تقصيرًا
     * وهو لا شيءَ عليه.
     */
    const all = await LightTransportEmployee.find({ isActive: { $ne: false }, staffKind: 'rep' })
      .select('name idNumber phone vehiclePlate vehicleTypeAr projectAr cityAr supervisorUser supervisorName dutySupervisorUser dutySupervisorName workStatusAr')
      .populate('supervisorUser', 'firstName lastName role')
      .populate('dutySupervisorUser', 'firstName lastName role')
      .sort({ name: 1 }).lean();

    const rows = all.filter((e) => vehicleTypeKey(e.vehicleTypeAr) !== 'car');
    const carsExcluded = all.length - rows.length;

    const checks = rows.length
      ? await B2CDutyCheck.find({ dateKey, ltEmployee: { $in: rows.map((r) => r._id) } })
        .select('ltEmployee outcome checkedAt photos conditionAr hasDamage damageNotes notes vehicleType vehiclePlate supervisorName')
        .lean()
      : [];
    const byEmp = new Map(checks.map((c) => [String(c.ltEmployee), c]));

    // دبّاباتُ القسم — تُعرَض قائمةً لمن لا لوحةَ في صفّه بعد.
    const vehicleOptions = all
      .filter((e) => String(e.vehiclePlate || '').trim() && vehicleTypeKey(e.vehicleTypeAr) !== 'car')
      .map((e) => ({ plate: e.vehiclePlate, typeAr: e.vehicleTypeAr || '', rider: e.name || '' }))
      .sort((a, b) => a.plate.localeCompare(b.plate, 'ar'));

    /**
     * ── و«مناديبي» هنا إشرافُ تفقّدٍ لا تشغيل ───────────────────────────────
     * الإشرافُ التشغيليُّ مسؤوليّةُ اليوم كلِّه (مشروعُه وفرعُه وعملُه)، وهذه
     * الشاشةُ عن ساعةٍ واحدة: مَن يقف على المحطّة صباحًا ويصوّره قبل الخروج.
     * فالقائمةُ تُقسَم بمشرف التفقّد، وكلُّ المناديب تبقى مرئيّةً للجميع.
     */
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
          // الشاشةُ تقرأ الاسمَين، والسجلُّ يكتب اسمًا واحدًا — فيُعطى للاثنين.
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
          // مشرفُ التفقّد هو صاحبُ هذه الشاشة، والتشغيليُّ يُعرَض للعلم.
          ownerName: duty ? [duty.firstName, duty.lastName].filter(Boolean).join(' ') : (e.dutySupervisorName || ''),
          opsSupervisorName: owner ? [owner.firstName, owner.lastName].filter(Boolean).join(' ') : (e.supervisorName || ''),
          hasDutySupervisor: !!(e.dutySupervisorUser),
          mine: mineOf(e),
          check: byEmp.get(String(e._id)) || null,
        };
      }),
      // «كم أنجزتُ من رجالي» — المقياسُ الذي يُسأل عنه المشرف.
      mineTotal: rows.filter(mineOf).length,
      mineDone: checks.filter((c) => {
        const e = rows.find((x) => String(x._id) === String(c.ltEmployee));
        return e && mineOf(e);
      }).length,
      // ومن لا مشرفَ تفقّدٍ له لا يقع في قائمة أحد — يُقال عددُه صراحةً.
      unassigned: rows.filter((e) => !e.dutySupervisorUser).length,
      done: checks.length,
      total: rows.length,
    });
  } catch (e) { res.status(500).json({ message: 'تعذّر تحميل مندوبيك' }); }
};

/**
 * حارسُ المندوب — أموجودٌ ونشط، وأهو مندوبُ دبّاب؟
 *
 * ── والموضوعُ صفُّ السجلّ لا حسابُ التطبيق ──────────────────────────────────
 * يُرسَل `ltEmployee` (أو `rep` من نسخةٍ قديمة). والصفُّ يُقرأ من سجلّ النقل
 * الخفيف: فيه هويّتُه ولوحتُه ومشرفُه — فلا مطابقةَ باسمٍ ولا ربطٌ يُخمَّن.
 *
 * ولم يبقَ شرطُ «من رجالك»: يغيب مشرفٌ فيقوم زميلُه مقامَه، ومَن فعل يُثبَّت في
 * القيد (`supervisor` + `supervisorName`) والإسنادُ في السجلّ باقٍ للمسؤوليّة.
 */
const assertOwnsRep = async (req, repId, ltId) => {
  const { LightTransportEmployee } = require('../models/LightTransport');
  const id = ltId || repId;
  if (!id) return { error: 400, message: 'اختر المندوب' };

  // الأصلُ: صفٌّ في سجلّ النقل الخفيف.
  const emp = await LightTransportEmployee.findById(id)
    .select('name idNumber vehiclePlate vehicleTypeAr projectAr cityAr isActive staffKind').lean();
  if (emp) {
    if (emp.isActive === false) return { error: 400, message: 'هذا المندوب خارج سجلّ القسم' };
    if (vehicleTypeKey(emp.vehicleTypeAr) === 'car') {
      return { error: 400, message: 'التفقّد للدبّابات — هذا الموظّف على سيّارة' };
    }
    return { emp, rep: { _id: emp._id, englishName: emp.name, branch: null, project: null } };
  }

  // ونسخةٌ قديمةٌ ترسل حسابَ التطبيق — تُقبَل حتّى تُحدَّث.
  const rep = await B2CRep.findById(id).select('supervisor branch project englishName isActive ltEmployee').lean();
  if (!rep) return { error: 404, message: 'المندوب غير موجود' };
  if (rep.isActive === false) return { error: 400, message: 'هذا المندوب غير نشط' };
  return { rep };
};

/**
 * تسجيلُ التفقّد.
 *
 * ── ولماذا لا تُقبَل صورةٌ بلا التقاط ────────────────────────────────────
 * الصورةُ هي الحجّة كلُّها؛ فإن جاز أن تُرفَع من الملفّات صار الصفُّ ورقةً
 * تُملأ من المكتب. ولا يُصدَّق المتصفّحُ فيما يقوله عن نفسه، لكنّ الواجهةَ لا
 * تعرض بابًا آخرَ أصلًا، والمصدرُ يُثبَّت في الصفّ فيُسأل عنه لو خالف.
 *
 * ولا يُقبَل «بدأ الدوام» بلا صورة: هذا هو الشرطُ الذي وُجدت الشاشةُ لأجله.
 * أمّا الغائبُ والممنوعُ فلا صورةَ لهما — لا مركبةَ خرجت لتُصوَّر.
 */
exports.submit = async (req, res) => {
  const saved = [];
  try {
    const { rep: repId, ltEmployee: ltId, outcome = 'started', photos = [] } = req.body;
    if (!repId && !ltId) return res.status(400).json({ message: 'اختر المندوب' });
    if (!['started', 'absent', 'blocked'].includes(outcome)) {
      return res.status(400).json({ message: 'حالة غير معروفة' });
    }
    const own = await assertOwnsRep(req, repId, ltId);
    if (own.error) return res.status(own.error).json({ message: own.message });

    /**
     * ── ومَن لم يخرج يُسأل: لماذا ────────────────────────────────────────────
     *
     * «بدأ الدوام» تشهد له ثلاثُ صور. أمّا «لم يحضر» و«مُنع من الخروج» فليس
     * لهما شاهدٌ إلّا كلمةُ المشرف — ويومٌ كاملٌ من الدخل يسقط بضغطةٍ واحدةٍ لا
     * يُعرَف سببُها. ثمّ يُسأل بعد أسبوع «إيه اللي حصل يوم كذا؟» فلا جواب.
     *
     * فالملاحظةُ شرطٌ لهما: مرضَ، أو عطلت دبّابُه، أو مُنع لأنّ كارتَ تشغيله
     * منتهٍ. سطرٌ واحدٌ يُكتب مرّةً ويُقرأ في كلّ مراجعة.
     */
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

    // بدءُ الدوام يحتاج الصورَ الثلاث: المندوب والدبّاب والبوكس. وما حُفظ
    // صباحًا يُحسب — التصحيحُ لا يُلزم بإعادة التقاط ما التُقط.
    // الواجهةُ القديمة (قبل التقسيم) لا ترسل `kind` — تُقبَل منها صورةٌ واحدة
    // حتّى تُحدَّث، فلا يُحبَس المشرفون بين نشر الخادم ونشر الموقع/التطبيق.
    const legacyClient = photos.length > 0 && photos.every((p) => !p?.kind);
    if (outcome === 'started' && legacyClient) {
      // تكفي الصورةُ المرسلة.
    } else if (outcome === 'started') {
      const prior = await B2CDutyCheck.findOne({ rep: repId, dateKey }).select('photos.kind').lean();
      const have = new Set([
        ...(prior?.photos || []).map((p) => p.kind || 'vehicle'),
        ...photos.map((p) => p?.kind).filter((k) => PHOTO_KINDS.includes(k)),
      ]);
      const lacking = REQUIRED_PHOTO_KINDS.filter((k) => !have.has(k));
      if (lacking.length) {
        return res.status(400).json({ message: `لا بدّ من ${lacking.map((k) => PHOTO_KIND_AR[k]).join(' و')} لتسجيل بدء الدوام` });
      }
    }

    // صورةُ المحتوى الإعلانيّ لا تُقبَل في غير الخميس — يُقال ولا تُحفَظ صامتة.
    if (photos.some((p) => p?.kind === AD_KIND) && !isThursday(dateKey)) {
      return res.status(400).json({ message: 'صور المحتوى الإعلاني تُضاف يوم الخميس فقط' });
    }

    // الثلاثُ المطلوبة، ومعها ما يُضاف من صور المحتوى — فحدُّها أوسع.
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
      // الموضوعُ: صفُّ السجلّ. و`rep` يُكتب فقط إن جاء الطلبُ بحساب تطبيق
      // (نسخةٌ قديمة) — فلا يُخلَق ربطٌ لم يُطلَب.
      ltEmployee: own.emp ? own.emp._id : (own.rep.ltEmployee || null),
      rep: own.emp ? undefined : own.rep._id,
      supervisor: req.user._id,
      supervisorName: [me?.firstName, me?.lastName].filter(Boolean).join(' '),
      branch: own.emp ? null : (own.rep.branch || null),
      project: own.emp ? null : (own.rep.project || null),
      date, dateKey, year, month, day,
      checkedAt: new Date(),
      outcome,
      vehicleType: req.body.vehicleType || '',
      vehiclePlate: String(req.body.vehiclePlate || '').trim(),
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

    // التصحيحُ يُعدِّل صفَّ اليوم ولا يضيف ثانيًا — راجع الفهرس الفريد.
    const existing = await B2CDutyCheck.findOne(
      own.emp ? { ltEmployee: own.emp._id, dateKey } : { rep: own.rep._id, dateKey });
    let check;
    if (existing) {
      // الصورُ تُضاف ولا تُمحى: صورةُ الصباح حجّةٌ لا تُستبدَل بأخرى بعد الحادث.
      doc.photos = [...(existing.photos || []), ...saved];
      Object.assign(existing, doc);
      check = await existing.save();
    } else {
      check = await B2CDutyCheck.create({ ...doc, photos: saved });
    }

    /**
     * ── وتُختار اللوحةُ مرّةً لا كلَّ يوم ──────────────────────────────────────
     *
     * المندوبُ الذي لا صلةَ لحسابه بصفّ السجلّ (الاسمُ التبس، فرُفضت المطابقة)
     * يختار مشرفُه لوحتَه من قائمة دبّابات القسم. وتلك الاختيارةُ **خبرٌ**: هذا
     * الرجلُ على هذا الدبّاب. فإن كانت اللوحةُ لصفٍّ واحدٍ في السجلّ حُفظت الصلةُ
     * منها — فصباحُ الغد يجد اللوحةَ مملوءةً، ويُقرأ رقمُ هويّته ونوعُ مركبته معها.
     *
     * ولا تُكتب الصلةُ إن كانت اللوحةُ لصفّين (دبّابٌ تبادله رجلان في السجلّ):
     * الظنُّ لا يُثبَّت. ولا تُبدَّل صلةٌ قائمة — تلك تُغيَّر من السجلّ لا من هنا.
     */
    // والربطُ بحساب التطبيق يُحفَظ إن جاء الطلبُ منه ولوحتُه معروفةٌ في السجلّ —
    // خدمةٌ للنسخة القديمة وحدَها؛ والشاشةُ الجديدة موضوعُها صفُّ السجلّ أصلًا.
    if (!own.emp && !own.rep.ltEmployee && doc.vehiclePlate) {
      try {
        const { LightTransportEmployee: LTE2 } = require('../models/LightTransport');
        const hit = await LTE2.find({ isActive: { $ne: false }, vehiclePlate: doc.vehiclePlate })
          .select('_id').limit(2).lean();
        if (hit.length === 1) await B2CRep.updateOne({ _id: own.rep._id }, { $set: { ltEmployee: hit[0]._id } });
      } catch (e) { /* الربطُ خدمةٌ للغد، وفشلُه لا يمسّ تفقّدَ اليوم */ }
    }

    await logAudit({
      user: req.user._id, action: existing ? 'update_b2c_duty_check' : 'create_b2c_duty_check',
      entity: 'B2CDutyCheck', entityId: check._id,
      changes: { after: { rep: (own.emp?.name || own.rep.englishName), dateKey, outcome } }, ipAddress: req.ip,
    });

    // ما لا يُخرَج يُعلَم به فورًا: مركبةٌ بها تلفٌ أو مندوبٌ مُنع من العمل.
    if (doc.hasDamage || outcome === 'blocked') {
      const heads = await User.find({ role: { $in: ['b2c_manager', 'super_admin'] }, isActive: true })
        .select('_id').lean();
      await Promise.all(heads.map((h) => createNotification({
        recipient: h._id, type: 'system_alert',
        title: outcome === 'blocked' ? 'مندوب مُنع من الخروج' : 'تلف في مركبة مندوب',
        message: `${own.emp?.name || own.rep.englishName || ''} — ${doc.damageNotes || doc.conditionAr || ''}`.trim(),
        relatedEntity: 'B2CDutyCheck', relatedEntityId: check._id,
      }).catch(() => {})));
    }

    try { emitToAll('b2c:duty', { dateKey }); } catch (e) { /* */ }
    const out = await populate(B2CDutyCheck.findById(check._id)).lean();
    res.status(existing ? 200 : 201).json({ check: out });
  } catch (e) {
    // ملفٌّ كُتب ثمّ فشل الحفظ لا يُترَك يتيمًا على القرص.
    saved.forEach((f) => { try { deleteStoredFile(f.fileUrl); } catch (x) { /* */ } });
    if (e?.code === 11000) return res.status(409).json({ message: 'سُجِّل تفقّدٌ لهذا المندوب اليوم' });
    return sendMongooseError(res, e, 'تعذّر حفظ التفقّد');
  }
};

// ═══════════════════════════════════════════════════════════════════════════
//  سجلُّ الإدارة
// ═══════════════════════════════════════════════════════════════════════════

/** شرطُ القراءة: الإدارةُ ترى الكلَّ، والمشرفُ يرى ما سجّله هو. */
/**
 * ── ما يراه المشرفُ في التقرير ──────────────────────────────────────────────
 *
 * كان: ما سجّلتَه بيدك. وصار أيُّ مشرفٍ يتفقّد أيَّ مندوب، فالمقصورُ على فعله
 * وحدَه يُخفي عنه **رجالَه أنفسَهم** حين يتفقّدهم زميله — وهو أوّلُ ما يُسأل
 * عنه: «مين خرّج رجالي النهاردة؟».
 *
 * فصار يرى: ما فعله هو، وما وقع على مناديبه من أيٍّ كان. والاثنان معنى واحد:
 * ما يُسأل عنه.
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
  // يومٌ واحد، أو مدًى بين تاريخين. وغيابُ الاثنين يعني اليوم.
  if (validKey(q.from) && validKey(q.to)) and.push({ dateKey: { $gte: q.from, $lte: q.to } });
  else if (validKey(q.date)) and.push({ dateKey: q.date });
  else if (validKey(q.from)) and.push({ dateKey: { $gte: q.from } });
  else if (validKey(q.to)) and.push({ dateKey: { $lte: q.to } });
  else and.push({ dateKey: dayKeyOf() });

  const oid = (v) => (mongoose.isValidObjectId(v) ? new mongoose.Types.ObjectId(String(v)) : null);
  if (oid(q.supervisor)) and.push({ supervisor: oid(q.supervisor) });
  if (oid(q.branch)) and.push({ branch: oid(q.branch) });
  if (oid(q.project)) and.push({ project: oid(q.project) });
  // «مندوبٌ بعينه» — بمعرِّف صفّ السجلّ أو بحساب التطبيق القديم.
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
 * مراجعةُ الإدارة على صفٍّ بعينه.
 *
 * وهي نصفُ الغرض من الشاشة: الصورةُ تُلتقَط ليقرأها أحدٌ ويقول «سليم» أو
 * «يُحاسَب». وبلا هذا الحقل يبقى السجلُّ أرشيفًا لا يُبنى عليه قرار.
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
    // المشرفُ يُخبَر بما قيل عن تفقّده — وإلّا كانت المحاسبةُ بلا علم.
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

// ═══════════════════════════════════════════════════════════════════════════
//  التحليل
// ═══════════════════════════════════════════════════════════════════════════

/**
 * تحليلُ الالتزام — لا تحليلَ الطلبات.
 *
 * السؤالُ هنا واحد: هل وقف المشرفُ على رجاله؟ فالمقياسُ ليس عددَ التفقّدات بل
 * **نسبتُها إلى مَن كان يجب أن يُفقَّد** — عشرةُ تفقّداتٍ من عشرة التزامٌ تامّ،
 * وعشرةٌ من ثلاثين تقصير. ولا يُعرَف المقامُ من جدول التفقّد نفسِه (الصفُّ لا
 * يُكتب أصلًا لمن أُهمل)، فيُقرأ من `B2CRep`.
 *
 * والحسابُ في قاعدة البيانات لا في Node — راجع dashboard-performance.
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

    // عددُ الأيّام في المدى — مقامُ نسبة الالتزام.
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
          // متى يقف عادةً؟ متأخّرٌ كلَّ يومٍ سؤالٌ في ذاته.
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
      // المقام: كم مندوبًا لكلّ مشرفٍ كان يجب أن يُفقَّد كلَّ يوم — من كشف
      // مناديبنا (سجلّ النقل الخفيف)، دبّاباتٍ لا سيّارات.
      (async () => {
        const { LightTransportEmployee } = require('../models/LightTransport');
        const rows = await LightTransportEmployee.find({ isActive: { $ne: false }, staffKind: 'rep', dutySupervisorUser: { $ne: null } })
          .select('dutySupervisorUser vehicleTypeAr').lean();
        const by = new Map();
        for (const e of rows) {
          if (vehicleTypeKey(e.vehicleTypeAr) === 'car') continue;
          const k = String(e.dutySupervisorUser);
          by.set(k, (by.get(k) || 0) + 1);
        }
        return [...by].map(([id, reps]) => ({ _id: id, reps }));
      })(),
      // مَن تتكرّر مركبتُه تالفة — الرجلُ لا اليوم.
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

    // اسمُ المشرف يُقرأ من الحساب لا من اللقطة وحدَها — قد يكون له مندوبون
    // ولم يُفقّد أحدًا قطّ، فلا لقطةَ اسمٍ له في الجدول أصلًا.
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

/**
 * مَن لم يُفقَّد اليوم — القائمةُ التي لا يعرضها جدولُ التفقّد لأنّ صفَّها
 * غيرُ مكتوب. وهي أهمُّ ما تفتحه الإدارةُ صباحًا.
 */
exports.missing = async (req, res) => {
  try {
    const dateKey = validKey(req.query.date) ? req.query.date : dayKeyOf();
    // «مَن لم يُتفقَّد اليوم» — من كشف مناديبنا (سجلّ النقل الخفيف) لا من حسابات
    // التطبيق. والدبّاباتُ وحدَها: من على سيّارةٍ لا تفقّدَ عليه.
    const { LightTransportEmployee } = require('../models/LightTransport');
    const repScope = { isActive: { $ne: false }, staffKind: 'rep', dutySupervisorUser: { $ne: null } };
    if (!canSeeAll(req.user)) repScope.dutySupervisorUser = req.user._id;
    else if (mongoose.isValidObjectId(req.query.supervisor)) repScope.dutySupervisorUser = new mongoose.Types.ObjectId(String(req.query.supervisor));

    const allRows = await LightTransportEmployee.find(repScope)
      .select('name idNumber vehiclePlate vehicleTypeAr cityAr dutySupervisorUser dutySupervisorName')
      .populate('dutySupervisorUser', 'firstName lastName').lean();
    const reps = allRows
      .filter((e) => vehicleTypeKey(e.vehicleTypeAr) !== 'car')
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

/** المشرفون الذين لهم مندوبون — تُبنى منهم قوائمُ الفلترة والإسناد. */
exports.supervisors = async (req, res) => {
  try {
    // المرشَّحون للإشراف: كلُّ حسابٍ نشطٍ بدورٍ من أدوار القسم — لا مَن له
    // مندوبون فقط. كانت القائمةُ تُكمَّل في الواجهة من `/api/users`، وتلك لا
    // يفتحها مديرُ المشروع، فكان لا يرى إلّا المشرفين الذين أُسند إليهم سابقًا.
    const [counts, users] = await Promise.all([
      // عددُ مناديب كلِّ مشرف — من كشف القسم لا من حسابات التطبيق.
      (async () => {
        const { LightTransportEmployee } = require('../models/LightTransport');
        const rows = await LightTransportEmployee.find({ isActive: { $ne: false }, staffKind: 'rep', dutySupervisorUser: { $ne: null } })
          .select('dutySupervisorUser').lean();
        const by = new Map();
        for (const e of rows) {
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
    // مَن له مندوبون وتغيّر دورُه يبقى ظاهرًا حتّى تُنقل مناديبه.
    const missing = counts.map((c) => String(c._id)).filter((id) => !byId.has(id));
    if (missing.length) {
      (await User.find({ _id: { $in: missing } }).select('firstName lastName role').lean())
        .forEach((u) => byId.set(String(u._id), u));
    }
    const ORDER = { b2c_rep_supervisor: 0, b2c_project_lead: 1, b2c_manager: 2 };
    const supervisors = [...byId.values()].map((u) => ({
      _id: u._id,
      name: [u.firstName, u.lastName].filter(Boolean).join(' ') || '—',
      role: u.role,
      reps: repsBy.get(String(u._id)) || 0,
    })).sort((a, b) => (ORDER[a.role] ?? 9) - (ORDER[b.role] ?? 9) || b.reps - a.reps || a.name.localeCompare(b.name));
    res.json({ supervisors });
  } catch (e) { res.status(500).json({ message: 'تعذّر التحميل' }); }
};

/** إسنادُ مندوبين إلى مشرف — دفعةً واحدة من شاشة المندوبين. */
exports.assign = async (req, res) => {
  try {
    const ids = (Array.isArray(req.body.reps) ? req.body.reps : []).filter((x) => mongoose.isValidObjectId(x));
    if (!ids.length) return res.status(400).json({ message: 'اختر مندوبًا واحدًا على الأقلّ' });
    const sup = req.body.supervisor;
    // فراغٌ يعني «بلا مشرف» — وهو فعلٌ مقصودٌ لا خطأ إدخال.
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
