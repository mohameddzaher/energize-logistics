/**
 * ltRental — «اليوزرُ المؤجَّر» تعريفٌ واحد، وربطُه بصفّ المندوب.
 *
 * ── ما وقع (صاحبُ الشركة، ٢٠٢٦/١٠/٢٢) ──────────────────────────────────────
 * اللوحةُ تقول «نينجا ١٣ يوزرًا مؤجَّرًا» وصفحةُ «تأجير اليوزرات» فارغة: اللوحةُ
 * تعدّ من نوع العقد المكتوب في صفّ المندوب («يوزرات»)، والصفحةُ تعدّ سجلّاتِ
 * التأجير — ولا رابطَ بين الاثنين. فطلب أن تكون بطاقاتُ اليوزرات مربوطةً
 * بالصفحة: نقلُ اليوزر إلى مشروعٍ آخر، أو إنهاءُ تأجيره، يظهر في الكروت فورًا.
 *
 * ── القاعدة ──────────────────────────────────────────────────────────────────
 * • اليوزرُ المؤجَّر = تأجيرٌ ساري (`LtUserRental.status = active`) مربوطٌ بصفّه
 *   (`ltEmployee`). ونوعُ العقد «يوزرات» في الصفّ **مرآةٌ** لذلك يكتبها هذا الملفّ،
 *   ويُقرأ وحدَه احتياطًا لصفٍّ لم يُربط بتأجيرٍ بعد.
 * • تسجيلُ تأجيرٍ لصفٍّ يجعل نوعَ عقده «يوزرات» (ويحفظ ما كان قبله)، وإنهاؤه
 *   يُعيد ما كان قبله (أو فراغًا «غير محدد»).
 * • ونقلُ المندوب إلى مشروعٍ آخر ينقل تأجيرَه الساري معه (خطّافُ النموذج).
 */
const S = (v) => String(v == null ? '' : v).trim();
const USERS_AR = 'يوزرات';
const isUsersText = (v) => /يوزر/.test(S(v));

/**
 * يعلّم الصفوفَ بتأجيرها: `r._rented` = true (ساري) · false (له تأجيرٌ انتهى ولا
 * ساريَ له) · undefined (لا تأجيرَ مربوطًا — يُقرأ نوعُ العقد احتياطًا). و`r.rental`
 * ملخّصُ الساري لعرضه. سؤالٌ واحدٌ للصفوف كلّها.
 */
async function markRentals(rows) {
  const ids = rows.map((r) => r._id).filter(Boolean);
  if (!ids.length) return rows;
  const LtUserRental = require('../models/LtUserRental');
  const rentals = await LtUserRental.find({ ltEmployee: { $in: ids } })
    .select('ltEmployee status renterName renterType projectAr startDate endDate').sort({ createdAt: -1 }).lean();
  const by = new Map();
  for (const x of rentals) {
    const k = String(x.ltEmployee);
    const cur = by.get(k);
    if (!cur || (x.status === 'active' && cur.status !== 'active')) by.set(k, x);
  }
  for (const r of rows) {
    const x = by.get(String(r._id));
    if (!x) continue;
    r._rented = x.status === 'active';
    if (r._rented) r.rental = { _id: String(x._id), renterName: x.renterName, renterType: x.renterType, startDate: x.startDate };
  }
  return rows;
}

/** هل هو يوزرٌ مؤجَّر؟ التأجيرُ المربوطُ أوّلًا، ونوعُ العقد احتياطًا. */
const isRented = (r) => (r && r._rented !== undefined ? r._rented === true : isUsersText(r?.contractTypeAr));

function announce() {
  try { const cache = require('./ttlCache'); for (const k of ['lt:', 'b2c:', 'dash:']) cache.clear(k); } catch (_) { /* */ }
  try {
    const { emitToAll } = require('../websocket/socketManager');
    emitToAll('lt:updated', { rentals: true });
  } catch (_) { /* */ }
}

/**
 * بعد كلّ كتابةٍ في التأجير: يجعل نوعَ عقد الصفّ المربوط يطابقه.
 * @param rental  وثيقةُ التأجير بعد الحفظ (أو null بعد الحذف — ومعها `removed`)
 * @param opts.previousLt  صفٌّ كان مربوطًا قبل التعديل (فُكّ عنه)
 */
async function syncEmployee(rental, { previousLt = null, removed = false, user = null } = {}) {
  const { LightTransportEmployee } = require('../models/LightTransport');
  const LtUserRental = require('../models/LtUserRental');
  const by = user ? { by: user._id, byName: [user.firstName, user.lastName].filter(Boolean).join(' ') } : { byName: 'النظام' };
  const touched = new Set([previousLt, rental?.ltEmployee].filter(Boolean).map(String));
  for (const id of touched) {
    const lt = await LightTransportEmployee.findById(id);
    if (!lt) continue;
    const active = await LtUserRental.findOne({ ltEmployee: lt._id, status: 'active' }).sort({ createdAt: -1 });
    const want = active ? USERS_AR : null;
    if (want) {
      if (!isUsersText(lt.contractTypeAr)) {
        // يُحفَظ ما كان قبله على التأجير ليُعاد عند إنهائه.
        if (!active.prevContractTypeAr) { active.prevContractTypeAr = S(lt.contractTypeAr); await active.save(); }
        lt.history.push({ kind: 'contract', ...by, fromValue: S(lt.contractTypeAr), toValue: USERS_AR, note: 'تأجير يوزر' });
        lt.contractTypeAr = USERS_AR;
        await lt.save();
      }
    } else if (isUsersText(lt.contractTypeAr)) {
      const last = removed && rental && String(rental.ltEmployee) === id ? rental
        : await LtUserRental.findOne({ ltEmployee: lt._id }).sort({ updatedAt: -1 }).lean();
      const back = S(last?.prevContractTypeAr);
      lt.history.push({ kind: 'contract', ...by, fromValue: S(lt.contractTypeAr), toValue: back || 'غير محدد', note: removed ? 'حُذف تأجير اليوزر' : 'انتهى تأجير اليوزر' });
      lt.contractTypeAr = isUsersText(back) ? '' : back;
      await lt.save();
    }
  }
  announce();
}

/** نقلُ المندوب إلى مشروعٍ آخر ينقل تأجيرَه الساري معه — يناديه خطّافُ النموذج. */
async function followProject(lt) {
  const LtUserRental = require('../models/LtUserRental');
  const r = await LtUserRental.updateMany({ ltEmployee: lt._id, status: 'active', projectAr: { $ne: S(lt.projectAr) } },
    { $set: { projectAr: S(lt.projectAr) } });
  if (r.modifiedCount) announce();
  return r.modifiedCount || 0;
}

module.exports = { markRentals, isRented, isUsersText, syncEmployee, followProject, announce, USERS_AR };
