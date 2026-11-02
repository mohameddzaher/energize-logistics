/**
 * reportController: reports center. Endpoints: GET /api/reports/subjects, GET /api/reports/:subject/options?q=, GET /api/reports/:subject/:id (JSON or PDF).
 * A report is described once (services/reportSources.js) and rendered as blocks and as PDF, so preview, download and mobile cannot disagree.
 */
const { getSubject, subjectMeta, COMPANY } = require('../services/reportSources');
const { renderReportPdf } = require('../services/reportBuilder');
const cache = require('../utils/ttlCache');

// Reports read across every section, so they are limited to the roles that are
// already trusted with cross-section visibility. A `client` (partner) login must
// never reach them — they have the portal, which is scoped to themselves.
/**
 * Who may enter the reports center at all.
 * A hand-written role list drops new roles (a new manager role saw no report, not even its own section's). So every internal role enters, and what it sees inside is decided by the section permission matrix (SUBJECT_SECTIONS below), the single place access is configured. Only external partners are blocked; they have their portal.
 */
const { EXTERNAL_ROLES } = require('../config/scopedRoles');
const canOpenReports = (role) => !!role && !EXTERNAL_ROLES.includes(role);


/**
 * Each report belongs to a section, or several.
 * A role list would show every report to everyone (an HR manager could print a tire report), yet customer reports carry prices and supplier reports carry contracts. Permission is decided by the section permission matrix: granting a section shows its reports at once.
 * A subject owned by several sections needs only one: a vehicle belongs to the register, fleet management and Location Solutions.
 */
const SUBJECT_SECTIONS = {
  vehicle: ['Vehicles', 'Fleet Management', 'Location Solutions'],
  tire: ['Location Solutions'],
  driver: ['Fleet Management', 'Location Solutions'],
  customer: ['CRM', 'Collections', 'Sales'],
  vendor: ['CRM', 'Contracts', 'Procurement'],
  // The employee report carries salary, residency and evaluation: HR only.
  employee: ['HR'],
  meeting: ['Business Review'],
  // The department report is issued by each department's owner for his own department, so it is not tied to one section.
  section: null,
  // Added subjects.
  // Shipment and carrier belong to the shipment orders section plus accounting and collections (the sheet is requested in financial disputes); the rep belongs to B2C and HR.
  shipment: ['Shipment Orders', 'Accounting', 'Collections'],
  carrier: ['Shipment Orders', 'Procurement', 'Accounting'],
  rider: ['B2C', 'HR'],
};

const { getOverride } = require('../utils/permissions');
const { FULL_ACCESS_ROLES } = require('../config/constants');
const { defaultAccess } = require('../config/sections');

/** Does this role own any of this report's sections? */
const canUse = async (user, subject) => {
  if (!canOpenReports(user.role)) return false;
  if (FULL_ACCESS_ROLES.includes(user.role)) return true;
  const sections = SUBJECT_SECTIONS[subject];
  if (!sections) return true;                       // Department report: for everyone, about their own department
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
  // Filter in parallel: each check reads the matrix from a cache, and awaiting one by one slows opening the page for no reason.
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

    // Caching serves the two consecutive clicks only.
    // A report is usually requested twice (preview, then PDF), so one minute is enough. Closed periods used to be cached for an hour because a closed period does not change, which holds only for period figures. File reports (vehicle, employee, driver) also carry today's state (valid insurance, licence expiring, authorization in force), so someone who renewed a document and printed got the stale sheet for an hour, a sheet sent to outside parties and used for decisions.
    // The vehicle report is also cleared explicitly on any write in its section (`vehicleRegistryController.emit`), so the minute is an upper bound, not a real wait.
    const { resolvePeriod } = require('../services/reportSources');
    resolvePeriod(req.query);
    const docScope = subject.userScoped ? String(req.user._id) : 'all';
    const docKey = `reports:doc:${subject.key}:${docScope}:${id}:${req.query.from || ''}:${req.query.to || ''}:${lang}`;
    const cached = cache.get(docKey);
    let built = cached;
    if (built === undefined) {
      built = await subject.build(id, req.query, lang, req.user);
      if (built) cache.set(docKey, built, 60 * 1000);
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
