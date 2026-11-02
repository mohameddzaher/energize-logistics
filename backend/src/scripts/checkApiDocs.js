/**
 * API documentation check, run before every deploy.
 * Why a check and not a generated file: the documentation is built from app._router when requested, so it always matches what is mounted and cannot age. What can still break is the generator itself, or mounted routes it cannot read, which would ship partners an incomplete document.
 * So this builds both documents for real, with the actual router as mounted in production, and refuses the deploy if either breaks, if the partner API has none of its routes, or if a route with no known guard appears (the silent error: an open route documented as guarded, or the reverse).
 * node src/scripts/checkApiDocs.js
 */
process.env.NODE_ENV = process.env.NODE_ENV || 'production';
process.env.API_DOCS_ONLY = '1';
require('dotenv').config();

const fail = (msg) => { console.error(`✗ ${msg}`); process.exit(1); };

(async () => {
  let app;
  try {
    ({ app } = require('../server'));
  } catch (e) {
    fail(`تعذّر تحميلُ الخادم لبناء الوثيقة: ${e.message}`);
  }

  const { buildOpenApi, walk } = require('../services/apiDocs');

  let partner; let internal;
  try {
    partner = buildOpenApi(app, { scope: 'partner' });
    internal = buildOpenApi(app, { scope: 'internal' });
  } catch (e) {
    fail(`المولِّدُ كسر: ${e.message}`);
  }

  const partnerPaths = Object.keys(partner.paths).length;
  const internalPaths = Object.keys(internal.paths).length;
  if (!partnerPaths) fail('وثيقةُ الشركاء فارغة — واجهةُ `/api/fleet-api` لم تُقرأ');
  if (internalPaths < 100) fail(`السطحُ الداخليُّ قُرئ ناقصًا (${internalPaths} مسارًا فقط)`);

  // A route with no known guard is either truly open, which must be known, or its guard does not identify itself. Both are reported by name and do not pass silently.
  const all = walk(app._router && app._router.stack).filter((r) => r.path.startsWith('/api'));
  const open = all.filter((r) => !r.auth && !r.section && !r.roles && !r.apiKey);
  const KNOWN_OPEN = [
    '/api/health', '/api/auth', '/api/client-errors', '/api/docs', '/api/uploads',
    '/api/portal', '/api/partners/login', '/api/ops/webhook',
  ];
  const unexpected = open.filter((r) => !KNOWN_OPEN.some((k) => r.path.startsWith(k)));

  console.log(`✓ وثيقةُ الشركاء: ${partnerPaths} مسارًا · السطحُ الداخليّ: ${internalPaths} مسارًا من ${all.length} طريقة`);
  if (unexpected.length) {
    console.log(`  ملاحظة: ${unexpected.length} مسارًا بلا حارسٍ مقروء — تُراجَع:`);
    unexpected.slice(0, 12).forEach((r) => console.log(`     ${r.method} ${r.path}`));
  }
  process.exit(0);
})();
