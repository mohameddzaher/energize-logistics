/**
 * تنبيهاتُ الأسطول تصل مَن يتصرّف فيها — لا تنتظر في شاشة.
 *
 * ── العلّة ──────────────────────────────────────────────────────────────────
 * محرّكُ التنبيهات يفتح `Ls2Alert` عند كلّ تجاوز: حرارةُ كاوتشٍ أو مبرِّد، أو
 * ضغطٌ تحت الحدّ، أو صيانةٌ فات موعدُها. وكان الأثرُ كلُّه سطرًا في شاشة
 * التنبيهات: من لم يفتحها لم يعلم. والحرارةُ لا تنتظر فتحَ شاشة.
 *
 * فتُرسَل إشعارًا إلى مَن يملك التصرّف: فريقُ لوكيشن سوليوشن (الذي يقرأ
 * الأجهزة)، **ومديرُ الأسطول وفريقُه** (الذي يوقف الشاحنة أو يدخلها الورشة)،
 * والإشعارُ يصل الجوّالَ كما يصل
 * الموقعَ — راجع services/notificationService.
 *
 * ── وما يُرسَل منها ─────────────────────────────────────────────────────────
 * الحرجُ وحدَه وما فات موعدُه: «إطارٌ على ١١٠°» و«صيانةٌ متأخّرة» خبرٌ يُوقظ،
 * أمّا التوقّفُ والتباطؤُ فسطورٌ تُقرأ في الشاشة. وإشعارٌ واحدٌ لكلّ تنبيهٍ
 * جديدٍ لا في كلّ دورةِ استطلاع: يُرسَل عند فتحه فقط (المحرّك لا يفتحه ثانيةً
 * ما دام مفتوحًا).
 */
const { ALERT_TYPES: T } = require('../config/ls2Config');

// الأدوارُ التي تتصرّف: قارئو الأجهزة، وأصحابُ الشاحنات أنفسُهم.
const ROLES = ['location_manager', 'location_staff', 'fleet_manager', 'fleet_supervisor'];
const SECTIONS = ['Location Solutions', 'Fleet Management'];

// ما يُرسَل إشعارًا مهما كانت درجتُه — فوتُ موعدِ الصيانة ليس «تحذيرًا» يُقرأ لاحقًا.
const ALWAYS = new Set([T.MAINTENANCE_OVERDUE, T.TIRE_PRESSURE_CRITICAL, T.TIRE_FAULT]);

let cached = { at: 0, ids: [] };

/** مَن يُخطَر: أدوارُ الأسطول ولوكيشن. تُقرأ كلَّ خمس دقائق. */
async function recipients() {
  if (Date.now() - cached.at < 5 * 60 * 1000) return cached.ids;
  const User = require('../models/User');
  const ids = new Set();
  const users = await User.find({ isActive: { $ne: false }, role: { $in: ROLES } }).select('_id role').lean();
  users.forEach((u) => ids.add(String(u._id)));
  // ── وبالدور وحدَه ────────────────────────────────────────────────────────
  // جُرّب أن يُخطَر كلُّ مَن يملك «تعديلًا» على أحد القسمين، فخرجت القائمةُ
  // خمسةً وعشرين: محاسبون لهم تعديلٌ على لوكيشن، وموظّفو تشغيلٍ لهم تعديلٌ على
  // الأسطول — ولا أحدَ منهم يوقف شاحنةً لحرارة إطار. وإشعارٌ يصل من لا يتصرّف
  // فيه يُدرَّب الناسُ على تجاهله، فيضيع معه ما يجب أن يُقرأ.
  cached = { at: Date.now(), ids: [...ids] };
  return cached.ids;
}

/**
 * @param {Array} alerts تنبيهاتٌ فُتحت الآن: { unitId, plate, type, severity, message }
 */
async function notifyNewAlerts(alerts) {
  const worth = (alerts || []).filter((a) => a && (a.severity === 'critical' || ALWAYS.has(a.type)));
  if (!worth.length) return 0;
  const ids = await recipients();
  if (!ids.length) return 0;

  const { createNotification } = require('./notificationService');
  // دفعةٌ واحدةٌ فيها عشرُ شاحنات لا تُرسِل عشرةَ إشعاراتٍ لكلّ شخص: تُجمع.
  const title = worth.length === 1
    ? `تنبيه أسطول: ${worth[0].plate || worth[0].unitId}`
    : `تنبيهات أسطول جديدة (${worth.length})`;
  const message = worth.slice(0, 6).map((a) => `${a.plate || a.unitId}: ${a.message}`).join(' · ')
    + (worth.length > 6 ? ` … +${worth.length - 6}` : '');

  await Promise.all(ids.map((rid) => createNotification({
    recipient: rid,
    type: 'system_alert',
    title,
    message,
    relatedEntity: 'Ls2Alert',
    relatedEntityId: worth[0]._id || undefined,
  }).catch(() => {})));
  return worth.length;
}

module.exports = { notifyNewAlerts, _recipients: recipients };
