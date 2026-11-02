/**
 * Audit safety net: every successful write in a known section is recorded, even if its controller forgot (a whole section once recorded nothing, and a missing action reads as proof it did not happen).
 * After any POST/PUT/PATCH/DELETE that succeeded, if the controller wrote no entry (see utils/auditContext) a generic one is written: who, section, path and what was sent. Detailed controller entries stay the ones read.
 * Reads and non-actions (search, export, preview, mark-read) are not recorded.
 */
const ctx = require('../utils/auditContext');
const logAudit = require('../utils/auditLogger');
const { SECTIONS } = require('../config/sections');

const WRITE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
// The longest matching prefix wins, as in the other section guards.
const PREFIXES = SECTIONS.flatMap((s) => (s.apiPrefixes || []).map((p) => [p, s.key]))
  .sort((a, b) => b[0].length - a[0].length);
const sectionOfPath = (path) => { const hit = PREFIXES.find(([p]) => path === p || path.startsWith(`${p}/`)); return hit ? hit[1] : null; };
// Sent via a write method but not a change.
const NOT_A_CHANGE = /\/(search|export|exports|preview|query|filters?|check|validate|verify|lookup|refresh|ping|read|seen|mark-read|webhook|reports?)(\/|$)/i;
const SECRET = /pass|token|secret|otp|pin/i;
const HEAVY = /dataurl|file|image|photo|base64|attachment/i;

/** What was sent, shortened: no secrets or files, and each value capped to a readable length. */
function summarise(body, depth = 0) {
  if (body === null || body === undefined) return body;
  if (typeof body === 'string') return body.length > 120 ? `${body.slice(0, 120)}…` : body;
  if (typeof body !== 'object') return body;
  if (depth > 2) return Array.isArray(body) ? `[${body.length}]` : '{…}';
  if (Array.isArray(body)) return body.length > 12 ? `[${body.length} عنصرًا]` : body.map((x) => summarise(x, depth + 1));
  const out = {};
  for (const [k, v] of Object.entries(body).slice(0, 40)) {
    if (SECRET.test(k)) continue;
    if (HEAVY.test(k)) { out[k] = '(ملفّ)'; continue; }
    out[k] = summarise(v, depth + 1);
  }
  return out;
}

const VERB = { POST: 'api_create', PUT: 'api_update', PATCH: 'api_update', DELETE: 'api_delete' };

module.exports = function auditTrail(req, res, next) {
  if (!WRITE.has(req.method)) return next();
  return ctx.run(() => {
    const store = ctx.store();
    res.on('finish', () => {
      if (res.statusCode >= 400 || !req.user) return;
      const path = (req.originalUrl || '').split('?')[0];
      const section = sectionOfPath(path);
      if (!section || NOT_A_CHANGE.test(path)) return;
      // Some controllers respond and then record (reply before the tail), so the entry is given a moment.
      setTimeout(() => {
        if (store.audited) return;
        const route = `${req.baseUrl || ''}${(req.route && req.route.path) || ''}` || path;
        logAudit({
          user: req.user, action: VERB[req.method], entity: `Api:${section}`,
          entityId: req.params && (req.params.id || req.params.repairId || req.params.movementId),
          changes: { details: `${req.method} ${route}`, path, sent: summarise(req.body) },
          ipAddress: req.ip,
        });
      }, 1500).unref();
    });
    next();
  });
};
module.exports.sectionOfPath = sectionOfPath;
module.exports.summarise = summarise;
