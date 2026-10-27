/**
 * ── انتهاءُ الإقامة ورخصةِ القيادة لأيّ سائق (صاحبُ الشركة، ٢٠٢٦/١٠/٢٧) ────────
 * «أيّ مكان فيه داتا عن سوّاق ضيف التاريخين دول كولومين جنبه، من ضمن الداتا
 * والفلاتر». والتاريخان لا يُحفَظان إلّا في ملفّ الموظّف في الموارد البشريّة
 * (`iqamaExpiry` / `licenseExpiry`)، وسجلّاتُ السوّاق كلُّها (بطاقاتُ السائقين،
 * سوّاقُ الأسطول، سوّاقُ طلبات الشحن، مناديبُ النقل الخفيف، سوّاقُ التشغيل)
 * تُشير إليه برقم الهويّة أو بربط الموظّف. فتُقرأ من هناك هنا، مرّةً لكلّ قائمة.
 *
 * والإقامةُ المسجَّلةُ بالهجريّ وحده تُحوَّل إلى ميلاديّ — فلا تُقرأ «غير مسجَّلة».
 */
const Employee = require('../models/Employee');

const norm = (v) => String(v || '').replace(/\s+/g, '').trim();

/** حالةُ تاريخ انتهاء: expired / soon (٣٠ يومًا) / valid / missing. */
function docState(ymd) {
  const d = String(ymd || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return 'missing';
  const today = new Date().toISOString().slice(0, 10);
  if (d < today) return 'expired';
  const soon = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  return d <= soon ? 'soon' : 'valid';
}

/**
 * @param {Array<{ idNumber?: string, employee?: any }>} people — رقمُ الهويّة و/أو معرّفُ الموظّف.
 * @returns {Promise<(p) => { iqamaExpiry: string, licenseExpiry: string, iqamaState: string, licenseState: string }>}
 */
async function docDatesFor(people) {
  const ids = new Set(); const emps = new Set();
  for (const p of people || []) {
    const id = norm(p && p.idNumber);
    if (id) ids.add(id);
    const e = p && p.employee;
    const eid = e && (e._id || e);
    if (eid && /^[0-9a-f]{24}$/i.test(String(eid))) emps.add(String(eid));
  }
  if (!ids.size && !emps.size) return () => ({ iqamaExpiry: '', licenseExpiry: '', iqamaState: 'missing', licenseState: 'missing', docsState: 'missing' });
  const rows = await Employee.find({ $or: [
    ...(ids.size ? [{ iqamaNumber: { $in: [...ids] } }, { nationalId: { $in: [...ids] } }] : []),
    ...(emps.size ? [{ _id: { $in: [...emps] } }] : []),
  ] }).select('iqamaNumber nationalId iqamaExpiry iqamaExpiryHijri licenseExpiry').lean();
  const { fromHijriString } = require('./hijri');
  const val = (e) => ({
    iqamaExpiry: e.iqamaExpiry || (e.iqamaExpiryHijri ? (fromHijriString(e.iqamaExpiryHijri) || '') : ''),
    licenseExpiry: e.licenseExpiry || '',
  });
  const byId = new Map(); const byEmp = new Map();
  for (const e of rows) {
    const v = val(e);
    byEmp.set(String(e._id), v);
    for (const k of [e.iqamaNumber, e.nationalId]) if (norm(k)) byId.set(norm(k), v);
  }
  return (p) => {
    const eid = p && p.employee && String(p.employee._id || p.employee);
    const v = (eid && byEmp.get(eid)) || byId.get(norm(p && p.idNumber)) || { iqamaExpiry: '', licenseExpiry: '' };
    const iqamaState = docState(v.iqamaExpiry); const licenseState = docState(v.licenseExpiry);
    // والأسوأُ منهما — شريحةُ تصفيةٍ واحدة في قوائم التطبيق.
    const docsState = ['expired', 'soon', 'missing'].find((k) => iqamaState === k || licenseState === k) || 'valid';
    return { ...v, iqamaState, licenseState, docsState };
  };
}

module.exports = { docDatesFor, docState };
