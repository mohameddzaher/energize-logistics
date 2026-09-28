/**
 * مشرفو قطاع الأفراد — مَن هم، وكيف يُقرأ اسمُهم، وكيف يصل إليهم مناديبُهم.
 *
 * ── لماذا ملفٌّ واحد ───────────────────────────────────────────────────────
 * «المشرف» يُسأل عنه في ثلاثة مواضع: قائمةُ الاختيار في سجلّ النقل الخفيف،
 * وأمرُ التشغيل، وشاشةُ تفقّد بداية الدوام. وكان لكلٍّ منها مصدرُه: الأولان
 * يقرآن اسمًا من قائمةٍ مُدارة، والثالثةُ تقرأ حسابًا على النظام. فمن أُسند
 * إليه رجلٌ في السجلّ لم يكن يراه في التفقّد، ومن رأى رجلًا في التفقّد لم يكن
 * مكتوبًا في سجلّه — والسببُ أنّ الاسمَ ليس الحساب.
 *
 * فصار المصدرُ واحدًا: **الحسابُ على النظام**، ومنه يُشتَقُّ الاسمُ والملفّ.
 *
 * ── والاسمُ العربيُّ يجيء من ملفّ الموظّف ───────────────────────────────────
 * الحسابُ على النظام مكتوبٌ بالإنجليزيّة («Khaled Abdelsalam») والسجلُّ يُقرأ
 * بالعربيّة («خالد عباس»). والاسمُ العربيُّ موجودٌ أصلًا في ملفّ الموارد
 * البشريّة المربوط بالحساب (`linkedEmployee.arabicName`) — فيُقرأ منه، ولا
 * يُترجَم اسمٌ ولا يُكتب مرّتين. ومن لا ملفَّ له يُعرَض اسمُه كما في حسابه.
 */
const mongoose = require('mongoose');

/**
 * أدوارُ الإشراف في القسم — نفسُها في شاشة التفقّد (`b2cDutyController`).
 * مشرفُ المناديب يقف على رجاله؛ ومديرُ المشروع ومديرُ القطاع يقفان مقامَه
 * حين يغيب، ويُسنَد إليهما مباشرةً في المشاريع الصغيرة.
 */
const SUPERVISOR_ROLES = ['b2c_rep_supervisor', 'b2c_project_lead', 'b2c_manager'];

/** ترتيبُ العرض: الأقربُ إلى الميدان أوّلًا. */
const ROLE_ORDER = { b2c_rep_supervisor: 0, b2c_project_lead: 1, b2c_manager: 2 };
const ROLE_AR = {
  b2c_rep_supervisor: 'مشرف مناديب',
  b2c_project_lead: 'مدير مشروع',
  b2c_manager: 'مدير القطاع',
};

/** طيُّ صور الحرف العربيّ — «أحمد» و«احمد» اسمٌ واحد. */
const fold = (s) => String(s || '')
  .replace(/[ً-ْ]/g, '')
  .replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/ـ/g, '')
  .replace(/[^؀-ۿa-zA-Z0-9]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()
  .toLowerCase();

/**
 * ── وهيكلُ الاسم: «احمد يونس» و«Ahmed Younis» رجلٌ واحد ────────────────────
 *
 * السجلُّ عربيٌّ والحساباتُ إنجليزيّة، وبينهما ملفُّ الموظّف — فحين يكون الملفُّ
 * واحدًا فالربطُ بنيويٌّ لا ظنَّ فيه. لكنّ حسابًا قد لا يكون مربوطًا بملفٍّ بعد،
 * فلا يبقى إلّا الاسم.
 *
 * والمقارنةُ على **هيكل الحروف الساكنة**: تُنقَل العربيّةُ إلى حروفٍ لاتينيّة،
 * ثمّ تُنزَع الصوائتُ من الطرفين (a e i o u و«w» لأنّ الواوَ تُكتب «ou» و«oo»
 * و«u»)، ويُوحَّد ما يُكتب بحرفين («q/k»، «g/j»، «th/t»). فيبقى «hmd» و«yns»
 * من «احمد يونس» ومن «Ahmed Younis» سواءً.
 *
 * وهو تقريبٌ لا برهان — فلذلك **لا يُقبَل إلّا إن ردّ حسابًا واحدًا**، ويُطبَع
 * سببُ المطابقة في تقرير الربط ليُراجَع بالعين. والطريقُ البنيويُّ يُقدَّم عليه
 * دائمًا.
 */
const AR2LAT = {
  ا: 'a', أ: 'a', إ: 'a', آ: 'a', ٱ: 'a', ء: '', ئ: 'y', ؤ: 'w',
  ب: 'b', ت: 't', ث: 't', ج: 'g', ح: 'h', خ: 'k', د: 'd', ذ: 'z',
  ر: 'r', ز: 'z', س: 's', ش: 's', ص: 's', ض: 'd', ط: 't', ظ: 'z',
  ع: 'a', غ: 'g', ف: 'f', ق: 'k', ك: 'k', ل: 'l', م: 'm', ن: 'n',
  ه: 'h', ة: 'h', و: 'w', ي: 'y', ى: 'y',
};

/** الهيكلُ الساكن لكلمةٍ واحدة — بالعربيّة أو باللاتينيّة. */
const skeleton = (word) => {
  let w = String(word || '').toLowerCase();
  // النقلُ من العربيّة حرفًا حرفًا
  w = [...w].map((ch) => (AR2LAT[ch] !== undefined ? AR2LAT[ch] : ch)).join('');
  // ما يُكتب بحرفين في اللاتينيّة يُوحَّد مع مقابله المفرد
  w = w.replace(/ph/g, 'f').replace(/kh/g, 'k').replace(/gh/g, 'g')
    .replace(/sh/g, 's').replace(/ch/g, 's').replace(/th/g, 't')
    .replace(/q/g, 'k').replace(/j/g, 'g').replace(/x/g, 'ks');
  // الصوائتُ تُنزَع: هي ما يختلف بين الكتابتين
  w = w.replace(/[aeiouwy]/g, '');
  // حرفٌ مضاعفٌ حرفٌ واحد
  w = w.replace(/(.)\1+/g, '$1');
  // أداةُ التعريف: «الهواري» تُكتب Elhawary وHawary وAl-Hawary — فتُنزَع اللامُ
  // الأولى من الطرفين معًا، فيتساوى ما اختلف في كتابتها وحدَها.
  if (w.length > 2) w = w.replace(/^l/, '');
  // والتاءُ في آخر الاسم («رحومة» → Rahoma) لا تُكتب لاتينيًّا.
  if (w.length > 2) w = w.replace(/h$/, '');
  return w;
};

/**
 * مفتاحُ الاسم للمطابقة: هيكلُ أوّلِ كلمةٍ وهيكلُ آخرِها.
 * الاسمُ يُكتب بمقطعين هنا وبأربعةٍ هناك، والثابتُ طرفاه.
 */
const nameSkeleton = (name) => {
  const words = fold(name).split(' ').filter((w) => w.length > 1);
  if (!words.length) return '';
  const first = skeleton(words[0]);
  const last = skeleton(words[words.length - 1]);
  return first && last ? `${first}|${last}` : (first || last);
};

/**
 * قائمةُ المشرفين المتاحين للإسناد — حساباتٌ نشطةٌ بأدوار الإشراف.
 *
 * تُعاد بالاسم العربيّ (من ملفّ الموظّف) والإنجليزيّ معًا: الشاشةُ تعرض
 * العربيَّ ويُبحَث بأيّهما — فمن يعرف الحسابَ بالإنجليزيّة يجده كما يجده من
 * يعرف صاحبَه بالعربيّة.
 */
const listSupervisors = async () => {
  const User = mongoose.model('User');
  const Employee = mongoose.model('Employee');
  const users = await User.find({ role: { $in: SUPERVISOR_ROLES }, isActive: { $ne: false } })
    .select('firstName lastName email role linkedEmployee').lean();
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
      name: ar || en,                 // ما يُعرَض ويُحفَظ لقطةً
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
 * حسابُ مشرفٍ بعينه → ما يُكتب في الصفّ.
 *
 * يردّ `null` لمن ليس مشرفًا أو لحسابٍ معطَّل: الإسنادُ إلى حسابٍ لا يفتح
 * الشاشةَ يعني رجلًا بلا مَن يتفقّده، وهو أسوأُ من «بلا مشرف» لأنّه لا يُرى.
 */
const resolveSupervisor = async (userId) => {
  if (!userId || !mongoose.isValidObjectId(userId)) return null;
  const all = await listSupervisors();
  return all.find((s) => s._id === String(userId)) || null;
};

/**
 * ── ومندوبُ السجلّ هو مندوبُ التفقّد ──────────────────────────────────────
 *
 * سجلّانِ لرجلٍ واحد: `LightTransportEmployee` (سجلُّ القسم: هويّةٌ وكفالةٌ
 * وسكنٌ ومركبة) و`B2CRep` (حسابُه على تطبيق التوصيل، وعليه يقوم التفقّد
 * والامتثال). فإسنادُ مشرفٍ في الأوّل لا يُري المشرفَ رجلَه في الثاني.
 *
 * والمفتاحُ بينهما هو الاسمُ — لا هويّةٌ مشتركة: سجلُّ التطبيق لا يحمل رقمَ
 * هويّة. فيُطابَق الاسمُ مطويًّا (إنجليزيًّا كان أو عربيًّا)، ثمّ — إن لم
 * يُطابِق تامًّا — بأوّل كلمةٍ وآخرِها، لأنّ الاسمَ يُكتب بعددِ مقاطعَ مختلف
 * في السجلّين («HAMID ALI ARSHAD MEHMOOD» و«Hamid Mehmood»).
 *
 * والمطابقةُ الملتبسة (اسمٌ يردّ أكثرَ من صفّ) تُترَك: إسنادُ رجلٍ إلى مشرفٍ
 * ليس مشرفَه أسوأُ من عدم الإسناد.
 */
const repKeys = (name) => {
  const k = fold(name);
  if (!k) return [];
  const w = k.split(' ').filter(Boolean);
  const keys = [k];
  if (w.length >= 2) keys.push(`${w[0]} ${w[w.length - 1]}`);
  // والهيكلُ آخرًا: سجلُّ التطبيق يُكتب بالإنجليزيّة والسجلُّ عندنا بالعربيّة
  // لبعض الرجال — «ANTOR MIA MD ABDUL HELIM» و«انتور ميا». راجع `skeleton`.
  const sk = nameSkeleton(name);
  if (sk) keys.push(`~${sk}`);
  return keys;
};

const buildRepIndex = async () => {
  const B2CRep = mongoose.model('B2CRep');
  const reps = await B2CRep.find({ isActive: { $ne: false } })
    .select('englishName arabicName supervisor ltEmployee').lean();
  const idx = new Map();
  // الصلةُ المحفوظةُ تُفهرَس بمعرِّف صفّ القسم: مفتاحٌ قاطعٌ يُقدَّم على الاسم.
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
 * الصفُّ الواحدُ المطابق، أو `null` إن لم يُطابِق أو التبس.
 * الصلةُ المحفوظةُ أوّلًا (`ltId`)، ثمّ الاسمُ — والاسمُ لا يُقبَل إلّا فردًا.
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
 * إسنادُ مشرفِ السجلّ إلى صفّ المندوب في سجلّ التطبيق.
 * لا يرمي أبدًا: الربطُ خدمةٌ للتفقّد، وفشلُه لا يمنع حفظَ الموظّف.
 */
const syncRepSupervisor = async (name, supervisorUserId, { idx = null, ltId = null } = {}) => {
  try {
    const B2CRep = mongoose.model('B2CRep');
    const index = idx || await buildRepIndex();
    const rep = findRep(index, name, ltId);
    if (!rep) return null;
    const want = supervisorUserId ? String(supervisorUserId) : null;
    const set = { supervisor: want || null };
    // ومتى عُرف الصفُّ بالاسم، حُفظت الصلةُ فلا يُعاد الظنُّ في المرّة القادمة.
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
