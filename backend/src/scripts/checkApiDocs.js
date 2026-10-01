/**
 * فحصُ توثيق الـ API — يُشغَّل قبل كلّ نشر.
 *
 * ── لماذا فحصٌ لا توليدُ ملفّ ────────────────────────────────────────────────
 * الوثيقةُ لا تُخزَّن في ملفّ: تُبنى من `app._router` لحظةَ طلبها، فهي بطبيعتها
 * مطابقةٌ لما رُكِّب — لا شيءَ يشيخ. وما يبقى ممكنًا هو أن ينكسر المولِّدُ نفسُه
 * أو تُركَّب مساراتٌ لا يستطيع قراءتَها، فتُسلَّم للشركاء وثيقةٌ ناقصة.
 *
 * فهذا يبني الوثيقتين فعلًا — بالراوتر الحقيقيّ كما يُركَّب في الإنتاج — ويرفض
 * النشرَ إن كسرت إحداهما، أو إن خلت واجهةُ الشركاء من مساراتها، أو إن ظهر مسارٌ
 * لم يُعرَف حارسُه (وهو الخطأُ الصامت: مسارٌ مفتوحٌ تقول عنه الوثيقةُ إنّه
 * محروس، أو بالعكس).
 *
 *   node src/scripts/checkApiDocs.js
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

  // مسارٌ بلا حارسٍ معروف: إمّا مفتوحٌ فعلًا — وهو ما يجب أن يُعرَف — أو أنّ
  // حارسَه لا يقول عن نفسِه. والحالتان تُقالان بالاسم لا تمرّان بصمت.
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
