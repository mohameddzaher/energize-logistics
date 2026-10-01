const express = require('express');

const router = express.Router();

/**
 * توثيقُ الـ API — وثيقتان وصفحةٌ تعرضهما.
 *
 * ── ولماذا تُولَّد عند الطلب ────────────────────────────────────────────────
 * الوثيقةُ تُبنى من `app._router` في اللحظة التي تُطلَب فيها، فما رُكِّب فعلًا
 * هو ما يُعرَض. ومسارٌ يُضاف اليوم يظهر فيها اليوم بلا أن يتذكّر أحدٌ شيئًا،
 * ومسارٌ يُحذَف يختفي منها — وهذا هو الشرطُ الذي طُلب.
 *
 * ── ومن يرى ماذا ────────────────────────────────────────────────────────────
 *   • `/api/docs/partner.json` — واجهةُ الشركاء. تُفتَح بمفتاح التكامل نفسِه،
 *     فيأخذها من يتكامل معنا بالمفتاح الذي سُلِّم له ولا يحتاج حسابًا.
 *   • `/api/docs/internal.json` — السطحُ كلُّه. حسابٌ إداريٌّ فقط: هي خريطةُ
 *     ما نملك، ولا تُعطى لخارج الشركة.
 *   • `/api/docs` — صفحةٌ تعرض الأولى، وتعرض الثانيةَ لمن سجّل دخولَه إداريًّا.
 */
const { buildOpenApi, stats } = require('../services/apiDocs');
const { requireApiKey } = require('../middleware/apiKey');
const authenticate = require('../middleware/auth');
const { FULL_ACCESS_ROLES } = require('../config/constants');

/** عنوانُ الخادم كما يراه القارئ — خلفَ nginx تُقرأ الترويسةُ المرسَلة. */
const baseUrlOf = (req) => {
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'https';
  const host = req.headers['x-forwarded-host'] || req.get('host');
  return `${proto}://${host}`;
};

/** وثيقةُ الشركاء — بمفتاح التكامل. */
router.get('/partner.json', requireApiKey('FLEET_API_KEY', 'توثيق واجهة الشركاء'), (req, res) => {
  res.json(buildOpenApi(req.app, { scope: 'partner', baseUrl: baseUrlOf(req) }));
});

/** وثيقةُ السطح الداخليّ — للإدارة وحدَها. */
router.get('/internal.json', authenticate, (req, res) => {
  if (!FULL_ACCESS_ROLES.includes(req.user?.role)) {
    return res.status(403).json({ message: 'وثيقةُ السطح الداخليّ للإدارة وحدَها' });
  }
  return res.json(buildOpenApi(req.app, { scope: 'internal', baseUrl: baseUrlOf(req) }));
});

/** عدّادٌ سريع: كم مسارًا وكم مجموعة — تقرؤه الصفحةُ قبل أن تُحمّل الوثيقة. */
router.get('/stats', authenticate, (req, res) => {
  if (!FULL_ACCESS_ROLES.includes(req.user?.role)) return res.status(403).json({ message: 'للإدارة وحدَها' });
  return res.json(stats(req.app));
});

/**
 * الصفحةُ التي تُقرأ بالعين.
 *
 * تُرسَل لمن يتكامل معنا مع مفتاحه، فيفتحها ويجرّب النداءات منها. وتُحمَّل
 * أداةُ العرض من شبكة توزيعٍ عامّة؛ وإن تعذّرت فالوثيقةُ نفسُها تبقى متاحةً
 * بصيغة JSON — وهي الأصل، والصفحةُ عرضٌ لها.
 */
router.get('/', (req, res) => {
  const key = String(req.query.key || '');
  const src = key ? `partner.json?key=${encodeURIComponent(key)}` : 'partner.json';
  res.type('html').send(`<!doctype html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Energize Logistics — API</title>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/swagger-ui/5.17.14/swagger-ui.min.css" />
  <style>
    body { margin: 0; font-family: system-ui, -apple-system, 'Segoe UI', sans-serif; }
    .bar { background: #12325C; color: #fff; padding: 14px 20px; display: flex; align-items: center; gap: 14px; }
    .bar b { font-size: 16px; }
    .bar span { opacity: .75; font-size: 13px; }
    .bar .k { margin-inline-start: auto; font-size: 12px; opacity: .85; }
    .note { background: #FFF7ED; border-bottom: 1px solid #FED7AA; color: #7C2D12; padding: 10px 20px; font-size: 13px; }
    .swagger-ui .topbar { display: none; }
  </style>
</head>
<body>
  <div class="bar">
    <b>Energize Logistics API</b>
    <span>واجهةُ الأسطول للشركاء — قراءةٌ بمفتاح</span>
    <span class="k">x-api-key</span>
  </div>
  <div class="note">
    هذه الوثيقةُ تُبنى من الخادم لحظةَ فتحِها، فهي تطابق ما هو مُركَّبٌ فعلًا — لا نسخةٌ تُحدَّث بيد.
    وللتجربة من هنا: افتحها بـ <code>?key=&lt;مفتاحك&gt;</code>.
  </div>
  <div id="ui"></div>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/swagger-ui/5.17.14/swagger-ui-bundle.min.js"></script>
  <script>
    window.ui = SwaggerUIBundle({
      url: ${JSON.stringify(src)},
      dom_id: '#ui',
      docExpansion: 'list',
      defaultModelsExpandDepth: -1,
      tryItOutEnabled: true,
      requestInterceptor: (r) => {
        // المفتاحُ المكتوبُ في العنوان يُرسَل في الترويسة — وهي الموصى بها.
        const k = new URLSearchParams(location.search).get('key');
        if (k) r.headers['x-api-key'] = k;
        return r;
      },
    });
  </script>
</body>
</html>`);
});

module.exports = router;
