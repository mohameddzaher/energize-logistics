/**
 * المساعد — سؤالٌ عن أيّ شيءٍ في النظام، بالدلالة لا بالتخمين.
 *
 * ── ما كان قبل ─────────────────────────────────────────────────────────────
 * قائمةُ عباراتٍ إنجليزيّةٍ تُطابَق بالنصّ («top collector»، «high risk») وتردّ
 * من جداولَ زالت — فيُجيب عن «أكبر المتأخّرين» بلا شيء، وهي إجابةٌ أسوأُ من
 * «لا أعرف»: تُقرأ «لا متأخّرات». وكان مقصورًا على أدوار المالية، ولا يعرف من
 * النظام إلّا ثلاثةَ جداول — وقد صار النظامُ سبعةً وعشرين قسمًا.
 *
 * ── وما هو الآن ────────────────────────────────────────────────────────────
 * حوارٌ موجَّه بثلاث خطوات: أيُّ قسم؟ ثمّ عمّ تسأل فيه؟ ثمّ أيُّ واحدٍ منها؟
 * والجوابُ وثيقةٌ كاملةٌ من مركز التقارير نفسِه.
 *
 * وهذا هو بيتُ القصيد: **لا يعرف المساعدُ شيئًا من عنده**. مواضيعُه هي مواضيعُ
 * التقارير (`reportSources.SUBJECTS`)، وصلاحيّاتُه صلاحيّاتُ التقارير
 * (`SUBJECT_SECTIONS`)، وجوابُه هو بناؤها. فموضوعٌ يُضاف هناك يظهر هنا في
 * اللحظة نفسِها، وحقلٌ يُضاف إلى تقريرٍ يصل إلى المساعد بلا سطرٍ واحد — ولا
 * يستطيع المساعدُ أن يقول ما لا يقوله التقرير، ولا أن يُري أحدًا ما لا يملك.
 *
 * ── والبحثُ الحرّ يبقى ──────────────────────────────────────────────────────
 * من يعرف ما يريد يكتبه: لوحةً أو اسمَ عميلٍ أو رقمَ بوليصةٍ أو رقمَ إقامة.
 * فيُبحَث في مواضيعه كلِّها معًا ويُقال: «هذه لوحةُ مركبة» — ويُفتَح جوابُها.
 */
const { getSubject, subjectMeta, PERIOD_PRESETS } = require('../services/reportSources');
const { SUBJECT_SECTIONS } = require('./reportController');
const { getOverride } = require('../utils/permissions');
const { FULL_ACCESS_ROLES } = require('../config/constants');
const { defaultAccess, SECTIONS, sectionLabel } = require('../config/sections');
const cache = require('../utils/ttlCache');

/** أيملك هذا الدورُ هذا القسم؟ (view أو edit) */
const hasSection = async (user, key) => {
  if (FULL_ACCESS_ROLES.includes(user.role)) return true;
  const override = await getOverride(user.role, key);
  const access = override == null ? defaultAccess(user.role, key) : override;
  return access === 'view' || access === 'edit';
};

/** أيملك أيًّا من أقسام هذا الموضوع؟ — نفسُ قاعدةِ مركز التقارير حرفًا. */
const canUseSubject = async (user, subjectKey) => {
  if (FULL_ACCESS_ROLES.includes(user.role)) return true;
  const sections = SUBJECT_SECTIONS[subjectKey];
  if (!sections) return true;
  for (const key of sections) {
    // eslint-disable-next-line no-await-in-loop
    if (await hasSection(user, key)) return true;
  }
  return false;
};

const langOf = (req) => (req.query.lang === 'en' ? 'en' : 'ar');

/**
 * الخطوةُ الأولى: الأقسامُ التي يملكها هذا المستخدم، ولكلٍّ ما يُسأل عنه فيه.
 *
 * ولا يُعرَض قسمٌ بلا مواضيع: زرٌّ يُضغَط فلا يفتح شيئًا أسوأُ من غيابه.
 */
exports.sections = async (req, res) => {
  try {
    const lang = langOf(req);
    const subjects = subjectMeta();
    const allowed = await Promise.all(subjects.map((s) => canUseSubject(req.user, s.key)));
    const mine = subjects.filter((_, i) => allowed[i]);

    // موضوعٌ لأقسامٍ عدّة يظهر تحت كلٍّ منها: المركبةُ يسأل عنها سجلُّ المركبات
    // وإدارةُ الأسطول ولوكيشن سوليوشن، وكلٌّ يسأل بحقّ.
    const bySection = new Map();
    for (const s of mine) {
      const keys = SUBJECT_SECTIONS[s.key] || ['*'];
      for (const key of keys) {
        if (key !== '*' && !SECTIONS.some((x) => x.key === key)) continue;
        // eslint-disable-next-line no-await-in-loop
        if (key !== '*' && !(await hasSection(req.user, key))) continue;
        if (!bySection.has(key)) bySection.set(key, []);
        bySection.get(key).push({ key: s.key, ar: s.ar, en: s.en, icon: s.icon, searchable: s.searchable });
      }
    }

    const out = [...bySection.entries()]
      .filter(([, list]) => list.length)
      .map(([key, topics]) => ({
        key,
        label: key === '*' ? (lang === 'en' ? 'Across the company' : 'على مستوى الشركة') : sectionLabel(key, lang),
        topics,
      }))
      .sort((a, b) => a.label.localeCompare(b.label, 'ar'));

    res.json({ sections: out, periods: PERIOD_PRESETS });
  } catch (error) {
    console.error('assistant sections', error);
    res.status(500).json({ message: 'تعذّر تحميل الأقسام' });
  }
};

/** الخطوةُ الثانية: أيُّ واحدٍ من هذا الموضوع؟ — نفسُ قوائم مركز التقارير. */
exports.options = async (req, res) => {
  try {
    const subject = getSubject(req.params.topic);
    if (!subject) return res.status(404).json({ message: 'موضوعٌ غير معروف' });
    if (!(await canUseSubject(req.user, subject.key))) return res.status(403).json({ message: 'لا صلاحيّة' });
    const q = String(req.query.q || '').trim();
    const key = `assistant:opts:${subject.key}:${subject.userScoped ? String(req.user._id) : 'all'}:${q}`;
    const hit = cache.get(key);
    if (hit !== undefined) return res.json(hit);
    const items = await subject.options(q, req.user);
    const payload = { topic: subject.key, total: items.length, items: items.slice(0, 60) };
    cache.set(key, payload, 60 * 1000);
    return res.json(payload);
  } catch (error) {
    console.error('assistant options', error);
    return res.status(500).json({ message: 'تعذّر البحث' });
  }
};

/**
 * ── البحثُ الحرّ: اكتبْ ما تعرفه ─────────────────────────────────────────────
 *
 * لوحةٌ أو اسمُ عميلٍ أو رقمُ بوليصةٍ أو رقمُ إقامة — يُبحَث في مواضيعه كلِّها
 * معًا ويُقال من أيّ نوعٍ هو. ومن لا يعرف أيَّ قسمٍ يسأل فيه — وهو الغالب —
 * يجد جوابَه بلا أن يعرف بنيةَ النظام.
 *
 * والمواضيعُ تُسأل بالتوازي: ثمانيةُ أسئلةٍ متتابعةٍ تجعل الكتابةَ بطيئة.
 */
exports.search = async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    if (q.length < 2) return res.json({ groups: [] });
    const subjects = subjectMeta().filter((s) => s.searchable);
    const allowed = await Promise.all(subjects.map((s) => canUseSubject(req.user, s.key)));
    const mine = subjects.filter((_, i) => allowed[i]);

    const results = await Promise.all(mine.map(async (s) => {
      try {
        const items = await getSubject(s.key).options(q, req.user);
        return { topic: s.key, ar: s.ar, en: s.en, icon: s.icon, items: items.slice(0, 6), total: items.length };
      } catch { return { topic: s.key, ar: s.ar, en: s.en, icon: s.icon, items: [], total: 0 }; }
    }));

    // ── والترتيبُ بالمطابقة لا بالعدد ────────────────────────────────────
    // «3449» لوحةُ شاحنةٍ عندنا، وهي أيضًا جزءٌ من سريالات ستِّ فردات كاوتش.
    // والترتيبُ بالعدد يضع الكاوتشَ أوّلًا ويدفن ما سأل عنه السائلُ فعلًا.
    // فيُقاس القربُ: مطابقةٌ تامّةٌ أعلى من بدايةٍ، والبدايةُ أعلى من تضمين.
    const fold = (v) => String(v || '').toLowerCase().replace(/\s+/g, '');
    const needle = fold(q);
    const score = (g) => Math.max(...g.items.map((it) => {
      const hay = fold(`${it.name} ${it.detail || ''}`);
      const name = fold(it.name);
      if (name === needle) return 4;
      if (name.startsWith(needle)) return 3;
      if (name.includes(needle)) return 2;
      return hay.includes(needle) ? 1 : 0;
    }), 0);
    res.json({
      groups: results
        .filter((g) => g.items.length)
        .map((g) => ({ ...g, score: score(g) }))
        .sort((a, b) => b.score - a.score || b.items.length - a.items.length),
    });
  } catch (error) {
    console.error('assistant search', error);
    res.status(500).json({ message: 'تعذّر البحث' });
  }
};

/**
 * الجواب — وثيقةُ التقرير نفسُها، تُعرَض في المحادثة وتُطبَع كما هي.
 *
 * ولا يُبنى جوابٌ ثانٍ بصيغةٍ أخرى: ما يراه السائلُ هنا هو ما يخرج من الطابعة
 * ومن الهاتف، حرفًا بحرف.
 */
exports.answer = async (req, res) => {
  try {
    const subject = getSubject(req.params.topic);
    if (!subject) return res.status(404).json({ message: 'موضوعٌ غير معروف' });
    if (!(await canUseSubject(req.user, subject.key))) return res.status(403).json({ message: 'لا صلاحيّة' });
    const id = decodeURIComponent(req.params.id || '');
    if (!id) return res.status(400).json({ message: 'لم يُحدَّد الموضوع' });
    const lang = langOf(req);
    const doc = await subject.build(id, req.query, lang, req.user);
    if (!doc) return res.status(404).json({ message: lang === 'en' ? 'Nothing found' : 'لا توجد بيانات' });

    // ── وملخّصٌ يُقرأ قبل الوثيقة ────────────────────────────────────────────
    // الوثيقةُ طويلةٌ عمدًا، والسائلُ يريد سطرَين أوّلًا. فتُستخرَج أوّلُ خاناتٍ
    // مملوءةٍ من أوّل كتلة — وهي بالتعريف أهمُّها، إذ تبدأ كلُّ وثيقةٍ بالهويّة.
    const firstKv = (doc.blocks || []).find((b) => b.kind === 'kv');
    const highlights = (firstKv?.items || [])
      .filter((i) => i[1] != null && i[1] !== '')
      .slice(0, 6)
      .map(([k, v]) => ({ label: k, value: String(v) }));

    res.json({
      topic: subject.key,
      title: doc.title,
      subtitle: doc.subtitle,
      highlights,
      doc,
      // رابطُ الوثيقة في مركز التقارير — من أراد طباعتَها أو مشاركتَها.
      reportPath: `/system/reports?subject=${subject.key}&id=${encodeURIComponent(id)}`,
    });
  } catch (error) {
    if (error.status && error.status >= 400 && error.status < 500) {
      return res.status(error.status).json({ message: error.message });
    }
    console.error('assistant answer', error);
    return res.status(500).json({ message: 'تعذّر بناء الجواب' });
  }
};
