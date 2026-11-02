/**
 * B2C supervisors: who they are, how their name is read, and how their reps reach them.
 * Single source is the system account (the name and employee file derive from it), so the register, the operating order and the duty check agree.
 * The Arabic name comes from the linked HR file (`linkedEmployee.arabicName`), never translated or typed twice; accounts without a file show the account name.
 */
const mongoose = require('mongoose');

/**
 * Supervisory roles in the department, same as the duty-check screen (`b2cDutyController`).
 * Rep supervisors cover their riders; project and sector managers stand in when absent and can be assigned directly in small projects.
 */
const SUPERVISOR_ROLES = ['b2c_rep_supervisor', 'b2c_inspection_supervisor', 'b2c_project_lead', 'b2c_manager', 'b2c_deputy'];

/** Display order: closest to the field first. */
const ROLE_ORDER = {
  b2c_rep_supervisor: 0, b2c_inspection_supervisor: 1, b2c_project_lead: 2, b2c_deputy: 3, b2c_manager: 4,
};
const ROLE_AR = {
  b2c_rep_supervisor: 'مشرف تشغيلي',
  b2c_inspection_supervisor: 'مشرف تفقدي',
  b2c_project_lead: 'مدير مشروع',
  b2c_deputy: 'نائب مدير القطاع',
  b2c_manager: 'مدير القطاع',
};

/** Folds Arabic letter variants so alef forms of the same name compare equal. */
const fold = (s) => String(s || '')
  .replace(/[ً-ْ]/g, '')
  .replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/ـ/g, '')
  .replace(/[^؀-ۿa-zA-Z0-9]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()
  .toLowerCase();

/**
 * Name skeleton: the same person is written in Arabic in the register and in English on accounts, so names are compared by consonant skeleton.
 * Arabic is transliterated, vowels (a e i o u and w) are dropped from both sides, and digraphs (q/k, g/j, th/t) are unified.
 * It is an approximation: accepted only when it returns exactly one account, the reason is printed in the link report, and the structural link always wins.
 */
const AR2LAT = {
  ا: 'a', أ: 'a', إ: 'a', آ: 'a', ٱ: 'a', ء: '', ئ: 'y', ؤ: 'w',
  ب: 'b', ت: 't', ث: 't', ج: 'g', ح: 'h', خ: 'k', د: 'd', ذ: 'z',
  ر: 'r', ز: 'z', س: 's', ش: 's', ص: 's', ض: 'd', ط: 't', ظ: 'z',
  ع: 'a', غ: 'g', ف: 'f', ق: 'k', ك: 'k', ل: 'l', م: 'm', ن: 'n',
  ه: 'h', ة: 'h', و: 'w', ي: 'y', ى: 'y',
};

/** Consonant skeleton of one word, Arabic or Latin. */
const skeleton = (word) => {
  let w = String(word || '').toLowerCase();
  // Letter-by-letter transliteration from Arabic
  w = [...w].map((ch) => (AR2LAT[ch] !== undefined ? AR2LAT[ch] : ch)).join('');
  // Two-letter Latin spellings are unified with their single-letter counterpart
  w = w.replace(/ph/g, 'f').replace(/kh/g, 'k').replace(/gh/g, 'g')
    .replace(/sh/g, 's').replace(/ch/g, 's').replace(/th/g, 't')
    .replace(/q/g, 'k').replace(/j/g, 'g').replace(/x/g, 'ks');
  // Vowels are dropped: they are what differs between the two spellings
  w = w.replace(/[aeiouwy]/g, '');
  // A doubled letter counts as one
  w = w.replace(/(.)\1+/g, '$1');
  // Definite article: the same name is written Elhawary, Hawary or Al-Hawary, so the leading 'l' is dropped from both sides.
  if (w.length > 2) w = w.replace(/^l/, '');
  // A final ta marbuta is not written in Latin.
  if (w.length > 2) w = w.replace(/h$/, '');
  return w;
};

/**
 * Name key for matching: skeleton of the first word plus skeleton of the last word.
 * The same name has two parts in one source and four in another; only the ends are stable.
 */
const nameSkeleton = (name) => {
  const words = fold(name).split(' ').filter((w) => w.length > 1);
  if (!words.length) return '';
  const first = skeleton(words[0]);
  const last = skeleton(words[words.length - 1]);
  return first && last ? `${first}|${last}` : (first || last);
};

/**
 * Supervisors available for assignment: active accounts with supervisory roles.
 * Returned with both Arabic (from the employee file) and English names so the screen shows Arabic and search works with either.
 */
const listSupervisors = async () => {
  const User = mongoose.model('User');
  const Employee = mongoose.model('Employee');
  // An archived supervisor is neither selectable nor shown, as if deleted.
  const { endedStaff, userArchived } = require('./endedStaff');
  const [all, sets] = await Promise.all([User.find({ role: { $in: SUPERVISOR_ROLES }, isActive: { $ne: false } })
    .select('firstName lastName email role linkedEmployee').lean(), endedStaff()]);
  const users = all.filter((u) => !userArchived(sets, u));
  const empIds = users.map((u) => u.linkedEmployee).filter(Boolean);
  const emps = empIds.length
    ? await Employee.find({ _id: { $in: empIds } }).select('arabicName firstName lastName employeeNumber').lean()
    : [];
  const byEmp = new Map(emps.map((e) => [String(e._id), e]));
  return users.map((u) => {
    const emp = u.linkedEmployee ? byEmp.get(String(u.linkedEmployee)) : null;
    const en = [u.firstName, u.lastName].filter(Boolean).join(' ').trim();
    const ar = String(emp?.arabicName || '').trim();
    return {
      _id: String(u._id),
      name: ar || en,                 // What is shown and stored as a snapshot
      nameEn: en,
      nameAr: ar,
      role: u.role,
      roleAr: ROLE_AR[u.role] || u.role,
      email: u.email || '',
      employee: u.linkedEmployee ? String(u.linkedEmployee) : null,
      employeeNumber: emp?.employeeNumber || '',
    };
  }).sort((a, b) => (ROLE_ORDER[a.role] ?? 9) - (ROLE_ORDER[b.role] ?? 9)
    || String(a.name).localeCompare(String(b.name), 'ar'));
};

/**
 * Maps a given supervisor account to what is written on the row.
 * Returns `null` for a non-supervisor or disabled account: assigning to an account that cannot open the screen leaves the rider unchecked and invisible, worse than no supervisor.
 */
const resolveSupervisor = async (userId) => {
  if (!userId || !mongoose.isValidObjectId(userId)) return null;
  const all = await listSupervisors();
  return all.find((s) => s._id === String(userId)) || null;
};

/**
 * The register rep is the duty-check rep. `LightTransportEmployee` (department register) and `B2CRep` (delivery-app account used by duty check and compliance) are two records of one person, so assigning a supervisor in the first must reach the second.
 * No shared ID exists (the app record has no ID number), so they are matched by folded name, then by first and last word when not exact.
 * Ambiguous matches (name returns more than one row) are skipped: a wrong supervisor is worse than none.
 */
const repKeys = (name) => {
  const k = fold(name);
  if (!k) return [];
  const w = k.split(' ').filter(Boolean);
  const keys = [k];
  if (w.length >= 2) keys.push(`${w[0]} ${w[w.length - 1]}`);
  // Skeleton last: the app record is in English while ours is Arabic for some riders; see `skeleton`.
  const sk = nameSkeleton(name);
  if (sk) keys.push(`~${sk}`);
  return keys;
};

const buildRepIndex = async () => {
  const B2CRep = mongoose.model('B2CRep');
  const reps = await B2CRep.find({ isActive: { $ne: false } })
    .select('englishName arabicName supervisor ltEmployee').lean();
  const idx = new Map();
  // The saved link is indexed by the department row id: a definitive key that takes priority over the name.
  for (const r of reps) if (r.ltEmployee) idx.set(`#${String(r.ltEmployee)}`, [r]);
  for (const r of reps) {
    for (const nm of [r.englishName, r.arabicName]) {
      for (const k of repKeys(nm)) {
        if (!idx.has(k)) idx.set(k, []);
        if (!idx.get(k).some((x) => String(x._id) === String(r._id))) idx.get(k).push(r);
      }
    }
  }
  return idx;
};

/**
 * The single matching row, or `null` when none matches or the match is ambiguous.
 * Saved link first (`ltId`), then the name, which is accepted only when unique.
 */
const findRep = (idx, name, ltId = null) => {
  if (ltId) {
    const linked = idx.get(`#${String(ltId)}`);
    if (linked && linked.length === 1) return linked[0];
  }
  for (const k of repKeys(name)) {
    const hits = idx.get(k);
    if (hits && hits.length === 1) return hits[0];
  }
  return null;
};

/**
 * Assigns the register supervisor to the rep row in the app register.
 * Never throws: linking is a service to the duty check and its failure must not block saving the employee.
 */
const syncRepSupervisor = async (name, supervisorUserId, { idx = null, ltId = null } = {}) => {
  try {
    const B2CRep = mongoose.model('B2CRep');
    const index = idx || await buildRepIndex();
    const rep = findRep(index, name, ltId);
    if (!rep) return null;
    const want = supervisorUserId ? String(supervisorUserId) : null;
    const set = { supervisor: want || null };
    // Once a row is found by name, the link is saved so it is not guessed again.
    if (ltId && !rep.ltEmployee) set.ltEmployee = ltId;
    if (String(rep.supervisor || '') === String(want || '') && !set.ltEmployee) return { rep, changed: false };
    await B2CRep.updateOne({ _id: rep._id }, { $set: set });
    return { rep, changed: true };
  } catch (e) {
    return null;
  }
};

module.exports = {
  SUPERVISOR_ROLES, ROLE_AR, ROLE_ORDER,
  fold, skeleton, nameSkeleton, listSupervisors, resolveSupervisor,
  buildRepIndex, findRep, syncRepSupervisor,
};
