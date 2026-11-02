/**
 * Assistant: ask about anything in the system, answered from the reports engine rather than guessed.
 * A guided three-step dialog (section, topic, item). The assistant knows nothing of its own: topics are the report subjects (reportSources.SUBJECTS), permissions are the report permissions (SUBJECT_SECTIONS), and the answer is the built report document, so new subjects and fields appear here automatically and it cannot show anyone more than the report would.
 * Free search stays: type a plate, customer name, waybill or residency number and all subjects are searched together.
 */
const { getSubject, subjectMeta, PERIOD_PRESETS } = require('../services/reportSources');
const { SUBJECT_SECTIONS } = require('./reportController');
const { getOverride } = require('../utils/permissions');
const { FULL_ACCESS_ROLES } = require('../config/constants');
const { defaultAccess, SECTIONS, sectionLabel } = require('../config/sections');
const cache = require('../utils/ttlCache');

/** Does this role own this section? (view or edit) */
const hasSection = async (user, key) => {
  if (FULL_ACCESS_ROLES.includes(user.role)) return true;
  const override = await getOverride(user.role, key);
  const access = override == null ? defaultAccess(user.role, key) : override;
  return access === 'view' || access === 'edit';
};

/** Does it own any of this subject's sections? Same rule as the reports center. */
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

/** Step one: the sections this user owns, each with its askable subjects. A section with no subjects is hidden, since a button that opens nothing is worse than none. */
exports.sections = async (req, res) => {
  try {
    const lang = langOf(req);
    const subjects = subjectMeta();
    const allowed = await Promise.all(subjects.map((s) => canUseSubject(req.user, s.key)));
    const mine = subjects.filter((_, i) => allowed[i]);

    // A subject shared by several sections appears under each: a vehicle is asked about from the vehicle register, fleet management and location solutions.
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

/** Step two: which item of this subject; same lists as the reports center. */
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

/** Free search: type what you know (plate, customer name, waybill or residency number); all subjects are searched together and the match type is reported. Queries run in parallel because eight sequential ones make typing slow. */
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

    // Rank by match quality, not count. For example 3449 is a truck plate and also part of six tire serials; count ranking would bury the plate. Exact match beats prefix, prefix beats contains.
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

/** The answer is the report document itself, shown in chat and printable as is. No second format, so the chat, printer and phone show the same content. */
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

    // Summary read before the document: it is long on purpose and users want two lines first. Takes the first filled fields of the first block, which by definition are the most important since every document starts with identity.
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
      // Link to the document in the reports center, for printing or sharing.
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
