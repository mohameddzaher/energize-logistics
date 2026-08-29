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
const REPORT_ROLES = [
  'super_admin', 'admin', 'it_manager', 'it_specialist', 'moderator',
  'operations_manager', 'operations_staff', 'fleet_manager', 'fleet_supervisor',
  'hr_manager', 'hr_specialist', 'finance_manager', 'accountant',
  'crm_manager', 'crm_team_lead', 'sales_manager', 'contracts_manager',
  'customs_manager', 'workshop_manager', 'procurement_manager',
  'bd_manager', 'marketing_manager', 'administration_staff',
  // قسم لوكيشن سوليوشن: تقريرا المركبة والفردة من صميم عمله، وكان محرومًا
  // منهما لأنّ القائمة كُتبت قبل أن يوجدا.
  'location_manager', 'location_staff',
  // وقسم المركبات والتفاويض: صفحةُ بروفايل المركبة فيه هي أكثرُ ما يُطبع من
  // هذه التقارير، وأهلُها كانوا وحدَهم الممنوعين منها.
  'vehicles_manager', 'vehicles_staff',
];

// Some subjects are more sensitive than the section they sit in: an employee
// report carries salary, iqama and evaluation data, so it stays with HR and the
// admin tier even though the reports page itself is broadly available.
const SUBJECT_ROLES = {
  employee: ['super_admin', 'admin', 'it_manager', 'it_specialist', 'hr_manager', 'hr_specialist'],
};

const canUse = (user, subject) => {
  if (!REPORT_ROLES.includes(user.role)) return false;
  const extra = SUBJECT_ROLES[subject];
  return !extra || extra.includes(user.role);
};

const langOf = (req) => (req.query.lang === 'en' ? 'en' : 'ar');

exports.getSubjects = async (req, res) => {
  const subjects = subjectMeta().filter((s) => canUse(req.user, s.key));
  res.json({ subjects, company: COMPANY });
};

/** What can be reported on, for one subject. Cached briefly — the pickers poll it. */
exports.getOptions = async (req, res) => {
  try {
    const subject = getSubject(req.params.subject);
    if (!subject) return res.status(404).json({ message: 'Unknown report subject' });
    if (!canUse(req.user, subject.key)) return res.status(403).json({ message: 'Insufficient permissions' });

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
    if (!canUse(req.user, subject.key)) return res.status(403).json({ message: 'Insufficient permissions' });

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

module.exports.REPORT_ROLES = REPORT_ROLES;
module.exports.SUBJECT_ROLES = SUBJECT_ROLES;
