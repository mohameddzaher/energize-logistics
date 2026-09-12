const AuditLog = require('../models/AuditLog');
const User = require('../models/User');
const Branch = require('../models/Branch');
const { SECTIONS, sectionOf, entitiesOfSection } = require('../config/auditSections');

/**
 * ── يومٌ واحد، أو مدًى ──────────────────────────────────────────────────────
 *
 * السؤالُ الأكثرُ ورودًا على سجلّ المراجعة هو «ماذا جرى **يوم كذا**؟» — بعد
 * شكوى، أو قبل اجتماع. وكان الجوابُ يقتضي ملءَ خانتَي «من» و«إلى» بالتاريخ
 * نفسِه مرّتين، ومن ملأ واحدةً منهما فقط حصل على كلِّ شيءٍ منذ ذلك اليوم إلى
 * الأبد وهو يظنّ أنّه فلتر يومًا.
 *
 * فصار `date=YYYY-MM-DD` يومًا بحدَّيه، و`dateFrom`/`dateTo` مدًى — وأيُّ
 * واحدٍ منهما وحدَه يعمل كما يُتوقَّع.
 */
const dayBounds = (from, to) => {
  const range = {};
  if (from) range.$gte = new Date(`${String(from).slice(0, 10)}T00:00:00.000`);
  // `YYYY-MM-DD` وحدَه منتصفُ الليل، فيُدفَع إلى آخر اليوم وإلّا سقط يومُ
  // «إلى» كلُّه من النتيجة — والمستخدم اختاره ليَدخل لا ليَخرج.
  if (to) range.$lte = new Date(`${String(to).slice(0, 10)}T23:59:59.999`);
  return range;
};

exports.getAuditLogs = async (req, res) => {
  try {
    // The page historically sent from/to while this read dateFrom/dateTo — the
    // date filter never filtered anything. Accept both spellings.
    const {
      entity, action, user, section, branch, page = 1, limit = 50,
    } = req.query;
    const day = req.query.date;
    const dateFrom = day || req.query.dateFrom || req.query.from;
    const dateTo = day || req.query.dateTo || req.query.to;
    const filter = {};

    // ── القسمُ أوّلًا، والكيانُ تفصيلٌ داخله ─────────────────────────────────
    // واختيارُ كيانٍ صريحٍ يَغلِب قسمَه: من اختار «حركة عهدة» يريدها وحدَها لا
    // قسمَ العهدة كلَّه. ولو جُمع الشرطان لأعطى الاختياران المتّسقان نتيجةً
    // صحيحةً والمتعارضان فراغًا لا يُفهَم سببُه.
    if (entity) {
      filter.entity = entity;
    } else if (section) {
      if (section === 'other') {
        // «أخرى» ليست قائمةً تُعَدّ — هي كلُّ ما ليس في القائمة، بما يشمل
        // كيانًا أُضيف في الخادم أمسِ ولم يُصنَّف بعد.
        const known = SECTIONS.flatMap((s) => entitiesOfSection(s.key));
        filter.entity = { $nin: known };
      } else {
        filter.entity = { $in: entitiesOfSection(section) };
      }
    }
    if (action) filter.action = { $regex: action, $options: 'i' };
    if (user) filter.user = user;

    // ── الفرعُ يُقرأ من فاعله ────────────────────────────────────────────────
    // القيدُ لا يحمل فرعًا — وهو صحيح: الفعلُ يقع على كيانٍ قد لا يخصّ فرعًا
    // أصلًا (دورُ صلاحيّة، إعدادُ نظام). لكنّ **مَن فعله** ينتمي إلى فرع،
    // وهذا هو السؤال المقصود: «ماذا فعل ناسُ جدّة؟».
    if (branch) {
      const ids = (await User.find({ branch }).select('_id').lean()).map((u) => String(u._id));
      // ومع اختيارِ شخصٍ بعينه يتقاطع الشرطان لا يتجاوران: شخصٌ من فرعٍ آخرَ
      // مع فرعِ جدّة جوابُه «لا شيء»، لا «كلُّ ما فعله».
      filter.user = user
        ? { $in: ids.includes(String(user)) ? [user] : [] }
        : { $in: ids };
    }

    if (dateFrom || dateTo) filter.createdAt = dayBounds(dateFrom, dateTo);

    const skip = (Number(page) - 1) * Number(limit);
    const [logs, total] = await Promise.all([
      AuditLog.find(filter)
        .populate('user', 'firstName lastName email role branch')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit)),
      AuditLog.countDocuments(filter),
    ]);

    // ── الفاعلُ يُقرأ من اللقطة حين يُحذَف حسابُه ──────────────────────────
    // `populate` تعود فارغةً لمستخدمٍ محذوف، فتقرأ الشاشةُ الفعلَ منسوبًا إلى
    // «النظام». فيُكمَّل من اللقطة المحفوظة ساعةَ الفعل، ويُعلَّم أنّ حسابَه
    // أُزيل — فلا يُنسَب فعلُ إنسانٍ إلى آلة.
    const shaped = logs.map((l) => {
      const o = l.toObject ? l.toObject() : l;
      if (!o.user && (o.userName || o.userEmail)) {
        o.user = {
          _id: String(l.user || ''), firstName: o.userName || o.userEmail, lastName: '', email: o.userEmail || '', deleted: true,
        };
      }
      // القسمُ يُحسَب هنا لا في الواجهة: الخريطةُ واحدةٌ يقرؤها الفلترُ والعمود،
      // فلا يقع صفٌّ في قسمٍ عند الفلترة وفي آخرَ عند العرض.
      o.section = sectionOf(o.entity);
      return o;
    });
    res.json({
      logs: shaped, total, page: Number(page), pages: Math.ceil(total / Number(limit)),
    });
  } catch (error) {
    res.status(500).json({ message: 'Failed to load audit logs' });
  }
};

// Filter vocabulary for the audit page: the entities that actually occur in the
// log, and the people who actually performed something — so the person filter
// offers real actors, not the whole user table.
exports.getAuditOptions = async (req, res) => {
  try {
    const [entityCounts, userIds] = await Promise.all([
      AuditLog.aggregate([{ $group: { _id: '$entity', count: { $sum: 1 } } }]),
      AuditLog.distinct('user'),
    ]);
    const users = await User.find({ _id: { $in: userIds.filter(Boolean) } })
      .select('firstName lastName email role branch')
      .lean();
    users.sort((a, b) => `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`));

    // ── كلُّ كيانٍ يحمل قسمَه وعددَه ────────────────────────────────────────
    // العددُ ليس زينة: قائمةُ الأقسام بلا أعداد تُقرأ كلُّها سواء، فيُفتَح قسمٌ
    // فيه أربعةُ قيودٍ بحثًا عن حادثةٍ وقعت في قسمٍ فيه أربعةُ آلاف.
    const entities = entityCounts
      .filter((e) => e._id)
      .map((e) => ({ key: e._id, section: sectionOf(e._id), count: e.count }))
      .sort((a, b) => b.count - a.count);

    // والأقسامُ التي لا قيدَ فيها لا تُعرَض: خيارٌ يُختار فيُفرِغ الجدولَ دائمًا.
    const counts = {};
    for (const e of entities) counts[e.section] = (counts[e.section] || 0) + e.count;
    const sections = SECTIONS
      .filter((s) => counts[s.key])
      .map((s) => ({ ...s, count: counts[s.key] }));

    // والفروعُ كاملةً: الفلترُ يسأل «مَن في هذا الفرع فعل شيئًا؟»، وفرعٌ لم
    // يفعل أحدٌ فيه شيئًا جوابٌ صحيحٌ لا خيارٌ يُخفى.
    const branches = await Branch.find({}).select('name').sort({ name: 1 }).lean();

    res.json({
      entities, sections, users, branches,
    });
  } catch (error) {
    res.status(500).json({ message: 'Failed to load audit options' });
  }
};
