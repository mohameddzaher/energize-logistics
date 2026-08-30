/**
 * reportController — مركز التقارير.
 *
 * Three endpoints, and they are the whole API:
 *   GET /api/reports/subjects              — what can I report on?
 *   GET /api/reports/:subject/options?q=   — which ones? (searchable)
 *   GET /api/reports/:subject/:id          — the report, as JSON or as a PDF
 *
 * The report itself is DESCRIBED once (services/reportSources.js) and rendered
 * twice: as blocks the screen draws, and as a PDF the printer draws. That is why
 * the on-screen preview and the downloaded file can never disagree, and why the
 * mobile app gets the identical document without duplicating a single line.
 */
const { getSubject, subjectMeta, COMPANY } = require('../services/reportSources');
const { renderReportPdf } = require('../services/reportBuilder');
const cache = require('../utils/ttlCache');

// Reports read across every section, so they are limited to the roles that are
// already trusted with cross-section visibility. A `client` (partner) login must
// never reach them — they have the portal, which is scoped to themselves.
/**
 * من يدخل مركزَ التقارير أصلًا.
 *
 * كانت قائمةً تُكتب باليد، فيسقط منها الدورُ الجديد: «مدير قطاع الأفراد» لم
 * يكن يرى تقريرًا واحدًا — ولا حتى تقريرَ قسمِه. وقد رأينا ما تفعله القوائمُ
 * اليدويّة في أسماء الأدوار وفي القوائم المرجعيّة وفي الخدمة الذاتيّة.
 *
 * فصارت القاعدةُ: كلُّ دورٍ داخليّ يدخل، و**ما يراه** داخلَها محسومٌ بمصفوفة
 * صلاحيّات الأقسام (SUBJECT_SECTIONS أدناه) — وهي المكانُ الوحيد الذي يُضبط
 * منه الوصول. والشريكُ الخارجيّ وحدَه يُمنع: له بوابتُه.
 */
const EXTERNAL_ROLES = ['client'];
const canOpenReports = (role) => !!role && !EXTERNAL_ROLES.includes(role);


/**
 * كلُّ تقريرٍ يخصُّ قسمًا — أو أقسامًا.
 *
 * ── لماذا لا تكفي قائمةُ أدوار ──────────────────────────────────────────────
 * كانت الصفحةُ تعرض التقاريرَ كلَّها لكلّ من دخلها: يفتح مديرُ الموارد البشريّة
 * حسابَه فيطبع تقريرَ فردةِ كاوتش. وليس هذا عبثًا في الشكل فقط — تقريرُ العميل
 * يحمل أسعارَه، وتقريرُ المورّد يحمل عقودَه.
 *
 * ولا تُعالَج بقائمةِ أدوارٍ ثالثة: عندنا قوائمُ تشيخ في كلّ مكان، وقد رأينا
 * ما تفعله. الصلاحيّةُ محسومةٌ في مكانٍ واحد — مصفوفةُ صلاحيّات الأقسام التي
 * يضبطها مديرُ النظام — فيُسأل عنها: أتملك قسمَ هذا التقرير؟ فمن مُنح قسمًا
 * في المصفوفة رأى تقاريرَه في اللحظة نفسِها، ومن سُحب منه اختفت.
 *
 * وموضوعٌ يخصُّ أكثرَ من قسم يكفيه واحدٌ منها: المركبةُ تخصّ سجلَّ المركبات
 * وإدارةَ الأسطول ولوكيشن سوليوشن معًا، وكلُّ واحدٍ منهم يسأل عنها بحقّ.
 */
const SUBJECT_SECTIONS = {
  vehicle: ['Vehicles', 'Fleet Management', 'Location Solutions', 'Workshop'],
  tire: ['Location Solutions', 'Workshop'],
  driver: ['Fleet Management', 'Location Solutions'],
  customer: ['CRM', 'Customers & Finance', 'Sales'],
  vendor: ['CRM', 'Contracts', 'Procurement'],
  // تقريرُ الموظّف يحمل الراتبَ والإقامةَ والتقييم — الموارد البشريّة وحدَها.
  employee: ['HR'],
  meeting: ['Business Review'],
  // تقريرُ القسم يُصدره صاحبُ كلِّ قسمٍ عن قسمِه، فلا يُقيَّد بقسمٍ بعينه.
  section: null,
};

const { getOverride } = require('../utils/permissions');
const { FULL_ACCESS_ROLES } = require('../config/constants');
const { defaultAccess } = require('../config/sections');

/** أيملك هذا الدورُ أيًّا من أقسام هذا التقرير؟ */
const canUse = async (user, subject) => {
  if (!canOpenReports(user.role)) return false;
  if (FULL_ACCESS_ROLES.includes(user.role)) return true;
  const sections = SUBJECT_SECTIONS[subject];
  if (!sections) return true;                       // تقريرُ القسم: للجميع عن قسمهم
  for (const key of sections) {
    // eslint-disable-next-line no-await-in-loop
    const override = await getOverride(user.role, key);
    const access = override == null ? defaultAccess(user.role, key) : override;
    if (access === 'view' || access === 'edit') return true;
  }
  return false;
};

const langOf = (req) => (req.query.lang === 'en' ? 'en' : 'ar');

exports.getSubjects = async (req, res) => {
  // تُصفّى بالتوازي: كلُّ سؤالٍ يقرأ المصفوفةَ من مخزنٍ مؤقّت، والانتظارُ
  // واحدًا تلو الآخر يجعل فتحَ الصفحة أبطأ بلا سبب.
  const allowed = await Promise.all(subjectMeta().map((s) => canUse(req.user, s.key)));
  const subjects = subjectMeta().filter((_, i) => allowed[i]);
  res.json({ subjects, company: COMPANY });
};

/** What can be reported on, for one subject. Cached briefly — the pickers poll it. */
exports.getOptions = async (req, res) => {
  try {
    const subject = getSubject(req.params.subject);
    if (!subject) return res.status(404).json({ message: 'Unknown report subject' });
    if (!(await canUse(req.user, subject.key))) return res.status(403).json({ message: 'Insufficient permissions' });

    const q = (req.query.q || '').trim();
    // A user-scoped subject (meetings — you only list the ones you attended)
    // MUST key its cache by the caller, or one manager's list gets served to
    // another. Everything else is the same for everybody and shares one entry.
    const scope = subject.userScoped ? String(req.user._id) : 'all';
    const key = `reports:opts:${subject.key}:${scope}:${q}`;
    const hit = cache.get(key);
    if (hit !== undefined) return res.json(hit);

    const items = await subject.options(q, req.user);
    const payload = { subject: subject.key, total: items.length, items: items.slice(0, 500) };
    cache.set(key, payload, 60 * 1000);
    res.json(payload);
  } catch (error) {
    console.error('report options error:', error);
    res.status(500).json({ message: 'Failed to load report options' });
  }
};

/**
 * The report. `?format=pdf` streams the PDF; anything else returns the block
 * document the frontend renders as a live preview.
 */
exports.getReport = async (req, res) => {
  try {
    const subject = getSubject(req.params.subject);
    if (!subject) return res.status(404).json({ message: 'Unknown report subject' });
    if (!(await canUse(req.user, subject.key))) return res.status(403).json({ message: 'Insufficient permissions' });

    const lang = langOf(req);
    const id = decodeURIComponent(req.params.id || '');
    if (!id) return res.status(400).json({ message: 'Report subject id is required' });

    // The same report is very often asked for twice in a row — preview, then
    // PDF; or a manager and their director opening it minutes apart. A closed
    // period can be cached hard because nothing behind it can change; a window
    // that includes today is cached briefly so it still moves with the day.
    const { resolvePeriod } = require('../services/reportSources');
    const { toKey } = resolvePeriod(req.query);
    const closed = toKey < new Date().toISOString().slice(0, 10);
    const docScope = subject.userScoped ? String(req.user._id) : 'all';
    const docKey = `reports:doc:${subject.key}:${docScope}:${id}:${req.query.from || ''}:${req.query.to || ''}:${lang}`;
    const cached = cache.get(docKey);
    let built = cached;
    if (built === undefined) {
      built = await subject.build(id, req.query, lang, req.user);
      if (built) cache.set(docKey, built, closed ? 60 * 60 * 1000 : 3 * 60 * 1000);
    }
    if (!built) {
      return res.status(404).json({ message: lang === 'en' ? 'Nothing found to report on' : 'لا توجد بيانات لإصدار هذا التقرير' });
    }

    const who = `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim();
    const stamp = new Date().toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' });
    // COPY before stamping. The cached document is a shared object; writing the
    // requester's name onto it would put THIS user's name in the footer of the
    // next person's PDF — the one line on the page that has to be true.
    const doc = {
      ...built,
      lang,
      footerNote: lang === 'en'
        ? `${COMPANY} · Generated by ${who} · ${stamp}`
        : `${COMPANY} · أصدره ${who} · ${stamp}`,
    };

    if (req.query.format !== 'pdf') {
      return res.json({ ...doc, generatedBy: who, generatedAt: new Date() });
    }

    const pdf = await renderReportPdf(doc);
    const safe = `${subject.key}-report`.replace(/[^a-z0-9-]/gi, '');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${safe}-${Date.now()}.pdf"`);
    res.send(pdf);
  } catch (error) {
    // A builder may refuse deliberately — printing must not be a way around a
    // section's own visibility rules. Pass that refusal through as-is.
    if (error.status && error.status >= 400 && error.status < 500) {
      return res.status(error.status).json({ message: error.message });
    }
    console.error('report build error:', error);
    res.status(500).json({ message: 'Failed to build the report' });
  }
};

module.exports.canOpenReports = canOpenReports;
module.exports.SUBJECT_SECTIONS = SUBJECT_SECTIONS;
