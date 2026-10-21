/**
 * b2cRepLink — حسابُ تطبيق التوصيل (`B2CRep`) لأيّ رجلٍ في سجلّ النقل الخفيف؟
 *
 * ── الحال (٢٠٢٦/١٠/٢١) ─────────────────────────────────────────────────────
 * سبعُمئةٍ وأربعون حسابًا كلُّها «نشطة»، والمربوطُ منها بصفٍّ في السجلّ
 * (`ltEmployee`) مئةٌ واثنان وثمانون. والباقي اسمٌ إنجليزيٌّ واسمٌ عربيٌّ كتبهما
 * الشيتُ يومًا، لا هويّةَ فيهما ولا جوال — فيُعرَض الرجلُ في شاشةٍ باسمٍ وفي
 * أخرى بغيره، ويُعَدّ الحسابُ «مندوبًا» وصاحبُه ترك العمل من شهور.
 *
 * ── مفاتيحُ الربط بالترتيب، من اليقين إلى الأضعف ──────────────────────────
 *   ١. رقمُ الهويّة — مكتوبًا عند الإنشاء، أو رقمُ الحساب (`repId`) إن كان هويّةً
 *   ٢. الجوال (آخرُ تسعة أرقام: «0545…» و«966545…» رقمٌ واحد)
 *   ٣. الاسمُ المطويُّ **تامًّا** — العربيُّ أو الإنجليزيّ، على اسم السجلّ أو اسم
 *      الملفّ في الموارد البشريّة. ويُقبَل إن دلّت الأسماءُ كلُّها على صفٍّ واحد؛
 *      اسمان يدلّان على رجلين = ملتبسٌ يُترَك لليد.
 *
 * ولا «قريبٌ من الاسم» هنا: ربطُ حسابٍ بغير صاحبه يحسب طلباتِ رجلٍ على آخر، وهو
 * أسوأُ من حسابٍ يبقى «غير مرتبط» ويُراجَع. (درجاتُ الاسم الأضعف — أوّلٌ وآخر،
 * هيكلُ الحروف — في `scripts/linkRepsToRegister.js` وتُشغَّل بيدٍ ومراجعة.)
 *
 * ── وحسابان لرجلٍ واحد صحيح ─────────────────────────────────────────────────
 * الحسابُ ليس الشخص: الرجلُ يُعطى حسابًا ثانيًا حين يُنقل أو يُغلق الأوّل. فيُربط
 * الحسابان بصفّه، وتُجمَع طلباتُهما له (`b2cEntryController` يجمع بالصفّ لا بالحساب).
 */
const { fold } = require('./b2cSupervisors');
const { idKey, displayName } = require('./personLookup');

const S = (v) => String(v == null ? '' : v).trim();
/** الجوالُ بآخر تسعة أرقام — المفتاحُ الذي يتّفق عليه «05…» و«9665…» و«+966 5…». */
const phoneKey = (v) => {
  const d = idKey(v).replace(/\D/g, '');
  return d.length >= 9 ? d.slice(-9) : '';
};
/** رقمُ حسابٍ يصلح أن يكون هويّة: عشرةُ أرقامٍ تبدأ بـ١ أو ٢. */
const looksLikeId = (v) => /^[12]\d{9}$/.test(idKey(v));

/** فهرسُ سجلّ النقل الخفيف للمطابقة — يُبنى مرّةً لكلّ دفعة. */
async function buildIndex() {
  const { LightTransportEmployee } = require('../models/LightTransport');
  const Employee = require('../models/Employee');
  const lts = await LightTransportEmployee.find({ isActive: { $ne: false } })
    .select('_id name idNumber phone employee staffKind').lean();
  const emps = await Employee.find({ _id: { $in: lts.map((l) => l.employee).filter(Boolean) } })
    .select('_id firstName lastName arabicName phone iqamaNumber nationalId').lean();
  const empById = new Map(emps.map((e) => [String(e._id), e]));

  const byId = new Map(); const byPhone = new Map(); const byName = new Map();
  const add = (map, k, id) => { if (!k) return; if (!map.has(k)) map.set(k, new Set()); map.get(k).add(id); };
  for (const l of lts) {
    const id = String(l._id);
    const e = l.employee ? empById.get(String(l.employee)) : null;
    add(byId, idKey(l.idNumber), id);
    if (e) { add(byId, idKey(e.iqamaNumber), id); add(byId, idKey(e.nationalId), id); }
    add(byPhone, phoneKey(l.phone), id);
    if (e) add(byPhone, phoneKey(e.phone), id);
    add(byName, fold(l.name), id);
    if (e) { add(byName, fold(e.arabicName), id); add(byName, fold(`${S(e.firstName)} ${S(e.lastName)}`), id); }
  }
  return { lts: new Map(lts.map((l) => [String(l._id), l])), empById, byId, byPhone, byName };
}

const one = (set) => (set && set.size === 1 ? [...set][0] : null);

/**
 * مطابقةُ حسابٍ واحد. `extra.idNumber` رقمُ هويّةٍ يُكتب عند الإنشاء (لا يُخزَّن
 * على الحساب — مكانُه السجلّ). يُرجع `{ lt, via }` أو `{ ambiguous }` أو null.
 */
function matchRep(rep, index, extra = {}) {
  // ── والشيتُ كتب الهويّةَ والجوالَ أحيانًا في خانة الاسم ────────────────────
  // «2553949062» و«569632109» في `arabicName` — فيُقرأ كلُّ حقلٍ بما يحمله لا
  // بعنوانه: عشرةُ أرقامٍ تبدأ بـ١ أو ٢ هويّة، وتسعةٌ فأكثر جوال.
  const fields = [extra.idNumber, rep.repId, rep.arabicName, rep.englishName];
  for (const raw of fields) {
    if (!looksLikeId(raw)) continue;
    const hit = index.byId.get(idKey(raw));
    if (hit && hit.size === 1) return { lt: one(hit), via: 'idNumber' };
    if (hit && hit.size > 1) return { ambiguous: hit.size, via: 'idNumber' };
  }
  for (const raw of [extra.phone, rep.phone, rep.arabicName, rep.englishName]) {
    if (!/^[\d٠-٩\s+()-]+$/.test(S(raw)) || looksLikeId(raw)) continue;
    const ph = index.byPhone.get(phoneKey(raw));
    if (ph && ph.size === 1) return { lt: one(ph), via: 'phone' };
  }

  const ids = new Set();
  for (const n of [rep.arabicName, rep.englishName]) {
    const hit = index.byName.get(fold(n));
    if (hit) hit.forEach((x) => ids.add(x));
  }
  if (ids.size === 1) return { lt: one(ids), via: 'name' };
  if (ids.size > 1) return { ambiguous: ids.size, via: 'name' };
  return null;
}

/** يربط حسابًا جديدًا ساعةَ إنشائه إن عُرف صاحبُه يقينًا. يُرجع معرّفَ الصفّ أو null. */
async function linkAtCreate(rep, extra = {}) {
  if (rep.ltEmployee) return rep.ltEmployee;
  const m = matchRep(rep, await buildIndex(), extra);
  return m && m.lt ? m.lt : null;
}

/**
 * هويّةُ الحساب كما تُعرَض: من ملفّ الموارد البشريّة إن كان الصفُّ مربوطًا به،
 * وإلّا من صفّ النقل الخفيف، وإلّا ما كتبه الشيت. `lt` مأهولٌ بـ`employee`.
 */
function personOf(rep, lt) {
  const e = lt && lt.employee && typeof lt.employee === 'object' ? lt.employee : null;
  if (e && displayName(e)) {
    return { name: displayName(e), phone: S(e.phone) || S(lt.phone), idNumber: S(e.iqamaNumber) || S(e.nationalId) || S(lt.idNumber), source: 'hr' };
  }
  if (lt && S(lt.name)) return { name: S(lt.name), phone: S(lt.phone), idNumber: S(lt.idNumber), source: 'lt' };
  return { name: S(rep.arabicName) || S(rep.englishName), phone: S(rep.phone), idNumber: '', source: 'account' };
}

module.exports = { buildIndex, matchRep, linkAtCreate, personOf, phoneKey, looksLikeId };
