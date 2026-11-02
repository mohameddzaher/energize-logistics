/* eslint-disable no-console */
/**
 * Finds records that cannot be created, edited or deleted.
 * Users who cannot correct data in the system fix it in Excel, and the system becomes a history instead of a working tool. This reads the route files and reports the gaps.
 * Actions are classified by what they do, not by name: a route like /:id/restore is create in shape but update in meaning.
 */
const fs = require('fs');
const path = require('path');

const ROUTES = path.join(__dirname, '../routes');
const SKIP = /^(auth|index|health|publicFleetApi|portal|partners|uploads|reports|lookups|notifications|sectionWork|permissions)\.js$/;

/** Routes that are business actions, not CRUD; not counted as create. */
const ACTIONY = /(login|logout|refresh|export|import|sync|seed|recalc|send|notify|resolve|assign|transfer|restore|reverse|toggle|mark|generate|preview|bulk|search|filters|options|dashboard|stats|analytics|profile|meta|summary)/i;

/** Read resources (report, alert or dashboard screens) are not records anyone creates. Counting them as gaps buries the report in ignored noise. */
const READ_ONLY = /^(overview|expiring|registers|alerts|risk-alerts|history|range|branch|daily|low-visit-customers|follow-ups|my-tasks|pending-by-customer|lookup-report|document-types|by-employee|employees|roles|suggest-manager|utilisation|permissions|users|store|me|leaves|leave|chat|reports|suggestions|shipments|config|settings|journal|bills|evaluations|announcements|daily-orders|master|requests|assets|vehicles|authorizations|accidents|insurance-policies|corporate-policies)$/;

const files = fs.readdirSync(ROUTES).filter((f) => f.endsWith('.js') && !SKIP.test(f));
const only = process.argv.includes('--section') ? process.argv[process.argv.indexOf('--section') + 1] : null;

const rows = [];
for (const f of files) {
  if (only && !f.includes(only)) continue;
  const src = fs.readFileSync(path.join(ROUTES, f), 'utf8');
  const routes = [...src.matchAll(/router\.(get|post|put|patch|delete)\(\s*['"]([^'"]+)['"]/g)]
    .map((m) => ({ verb: m[1], p: m[2] }));
  if (!routes.length) continue;

  // Routes are grouped into resources by the first path segment. /:id counts as a root too: it is the edit and delete of the base resource, and ignoring it made every file look like it had no update.
  const byResource = new Map();
  for (const r of routes) {
    const first = r.p.split('/').filter(Boolean)[0] || '/';
    const seg = first.startsWith(':') ? '/' : first;
    const cur = byResource.get(seg) || { get: 0, post: 0, put: 0, patch: 0, delete: 0, actions: 0 };
    if (r.verb === 'post' && ACTIONY.test(r.p)) cur.actions++;
    else cur[r.verb]++;
    byResource.set(seg, cur);
  }

  for (const [res, v] of byResource) {
    // Read-only resources (dashboards, analytics, options) are by design, not a gap.
    if (ACTIONY.test(res) || READ_ONLY.test(res)) continue;
    if (!v.get) continue;
    const missing = [];
    if (!v.post) missing.push('إنشاء');
    if (!v.put && !v.patch) missing.push('تعديل');
    if (!v.delete) missing.push('حذف');
    if (missing.length) rows.push({ file: f.replace('.js', ''), res, missing, has: v });
  }
}

rows.sort((a, b) => b.missing.length - a.missing.length || a.file.localeCompare(b.file));
console.log('\n  الملفّ                المورد                 الناقص');
console.log('  ' + '─'.repeat(74));
for (const r of rows) {
  console.log('  ' + r.file.padEnd(22) + r.res.padEnd(24) + r.missing.join(' · '));
}
console.log(`\n  ${rows.length} موردًا ناقص الأفعال · ${rows.filter((r) => r.missing.length === 3).length} منها بلا إنشاء ولا تعديل ولا حذف.\n`);
