/**
 * توثيقُ الـ API — يُبنى من الراوتر نفسِه، فلا يستطيع أن يبعد عنه.
 *
 * ── لماذا لا يُكتب بيد ──────────────────────────────────────────────────────
 * وثيقةٌ تُكتب يدويًّا لثمانٍ وخمسين مجموعةَ مساراتٍ تشيخ في أوّل أسبوع،
 * وشيخوختُها صامتة: يُضاف مسارٌ فلا يُذكَر، ويُحذَف آخرُ فيبقى مكتوبًا — فيبني
 * عليه مَن يتكامل معنا شيئًا لا وجود له، ويكتشف ذلك في الإنتاج.
 *
 * فهذه الوثيقةُ تُقرأ من `app._router`: كلُّ ما رُكِّب فعلًا، بمسارِه وطريقتِه
 * ومعاملاتِه وحارسِه. وإضافةُ مسارٍ تظهر فيها في اللحظة نفسِها بلا أن يتذكّر
 * أحدٌ شيئًا — وهذا هو الشرطُ الذي طُلب: أيُّ تعديلٍ يُصلَح في التوثيق فورًا.
 *
 * ── وحارسُ المسار يُقرأ منه لا يُخمَّن ──────────────────────────────────────
 * `authenticate` و`sectionGate('HR')` و`authorize(...)` و`requireApiKey(...)`
 * دوالُّ مغلقةٌ بعد تركيبها، فعُلِّق على كلٍّ منها ما تحرسه (`__section`،
 * `__roles`) — راجع `middleware/rbac` و`middleware/sectionGate`. فتقول الوثيقةُ
 * عن كلّ مسار: أيحتاج تسجيلَ دخول؟ وأيَّ قسمٍ يلزم؟ وأيَّ الأدوار يقبل؟
 *
 * ── ووثيقتان لا واحدة ───────────────────────────────────────────────────────
 *   • **واجهةُ الشركاء** (`/api/fleet-api`): تُفتَح بمفتاح، وتُرسَل لمن يتكامل
 *     معنا. سطحُها صغيرٌ مقصودٌ ومستقرّ.
 *   • **الواجهةُ الداخليّة**: سطحُ النظام كلُّه — لا تُعطى لأحدٍ من خارجنا،
 *     فهي خريطةُ ما نملك. تُقرأ بحسابٍ إداريّ.
 */
const { version } = require('../../package.json');

/** ‏`/api/hr/employees/:id` → `/api/hr/employees/{id}` بصيغة OpenAPI. */
const toOpenApiPath = (p) => p.replace(/:([A-Za-z0-9_]+)/g, '{$1}');

/** معاملاتُ المسار كما تُقرأ منه — لا تُكتب في جدولٍ على حدة فتتأخّر عنه. */
const pathParams = (p) => (p.match(/:([A-Za-z0-9_]+)/g) || []).map((m) => m.slice(1));

/**
 * تعبيرُ المسار الذي بناه إكسبرس → نصُّه كما كُتب.
 *
 * إكسبرس يحوّل `'/employees/:id'` إلى تعبيرٍ نمطيّ ويحتفظ بالمفاتيح بأسمائها،
 * فيُعاد تركيبُ النصّ منهما. ولا يُقرأ المصدرُ النصّيُّ للملفّات: المركَّبُ
 * فعلًا هو الحقيقة، وما في الملفّ قد يكون معلَّقًا أو مشروطًا.
 */
function regexpToPath(layer) {
  if (layer.route) return layer.route.path;
  const src = layer.regexp && layer.regexp.source;
  if (!src) return '';
  if (src === '^\\/?(?=\\/|$)') return '/';
  let out = src
    .replace(/^\^/, '')
    .replace(/\\\/\?\(\?=\\\/\|\$\)$/, '')
    .replace(/\$$/, '')
    .replace(/\\\//g, '/')
    .replace(/\(\?:\(\[\^\\\/\]\+\?\)\)/g, '§');
  const keys = (layer.keys || []).map((k) => `:${k.name}`);
  keys.forEach((k) => { out = out.replace('§', k); });
  return out.replace(/§/g, ':param').replace(/\/$/, '') || '/';
}

/** ما يحرسه وسيطٌ ما — يُقرأ من تعليقِه لا من اسمِه. */
function guardOf(fn) {
  if (typeof fn !== 'function') return {};
  const out = {};
  if (fn.__section) out.section = fn.__section;
  if (fn.__roles) out.roles = fn.__roles;
  if (fn.name === 'authenticate') out.auth = true;
  if (fn.name === 'requireKey' || fn.__apiKey) out.apiKey = fn.__apiKey || true;
  return out;
}

/**
 * مَسحُ شجرةِ الراوتر إلى قائمةِ مساراتٍ مسطَّحة.
 *
 * كلُّ طبقةٍ إمّا مسارٌ له طرقُه، أو راوترٌ مركَّبٌ تحت بادئة — فيُنزَل فيه
 * بالبادئة نفسِها، وتُورَّث حُرّاسُه إلى ما تحته (الحارسُ المركَّب على
 * `/api/hr` يحرس كلَّ ما فيه).
 */
function walk(stack, prefix = '', inherited = {}) {
  const out = [];
  // ── والحارسُ لا يتعدّى موضعَه ──────────────────────────────────────────────
  // `app.use('/api/hr', authenticate, sectionGate('HR'), hrRouter)` يصير في
  // إكسبرس أربعَ طبقاتٍ متجاورة. فلو جُمعت حُرّاسُ الطبقات في كائنٍ واحدٍ
  // يمرّ على الإخوة لورث `/api/crm` حارسَ `/api/hr` — فتقول الوثيقةُ إنّ مسارًا
  // يلزمه قسمٌ ليس قسمَه. فيُحفَظ مع كلّ حارسٍ موضعُه، ولا يرِثه إلّا ما كان
  // تحته.
  const atThisLevel = [];
  const inheritedFor = (mount) => {
    const merged = { ...inherited };
    for (const { at, guard } of atThisLevel) {
      if (at === '/' || at === '' || mount === at || mount.startsWith(`${at}/`)) Object.assign(merged, guard);
    }
    return merged;
  };

  for (const layer of stack || []) {
    if (layer.route) {
      const methods = Object.keys(layer.route.methods || {}).filter((m) => m !== '_all');
      const own = (layer.route.stack || []).reduce((acc, l) => ({ ...acc, ...guardOf(l.handle) }), {});
      const full = `${prefix}${layer.route.path}`.replace(/\/{2,}/g, '/');
      const base = inheritedFor(layer.route.path);
      for (const method of methods) out.push({ method: method.toUpperCase(), path: full, ...base, ...own });
      continue;
    }
    if (layer.name === 'router' && layer.handle && layer.handle.stack) {
      const mount = regexpToPath(layer);
      const at = mount === '/' ? '' : mount;
      out.push(...walk(layer.handle.stack, `${prefix}${at}`, inheritedFor(at || '/')));
      continue;
    }
    const g = guardOf(layer.handle);
    if (Object.keys(g).length) {
      const mount = regexpToPath(layer);
      atThisLevel.push({ at: mount === '/' ? '' : mount, guard: g });
    }
  }
  return out;
}

/** مجموعاتُ المسارات: البادئةُ الأولى بعد `/api` هي القسم العمليّ. */
const groupOf = (p) => {
  const m = /^\/api\/([^/]+)/.exec(p);
  return m ? m[1] : 'root';
};

/** وصفٌ عربيٌّ للمجموعات التي يُحتاج إلى شرحها — وما لا وصفَ له يُعرَض باسمه. */
const GROUP_AR = {
  'fleet-api': 'واجهةُ الأسطول للأتمتة — قراءةٌ بمفتاح، وهي الواجهةُ التي تُعطى للشركاء',
  auth: 'تسجيلُ الدخول والجلسات',
  users: 'المستخدمون والصلاحيّات',
  hr: 'الموارد البشريّة',
  crm: 'إدارةُ العلاقات',
  fleet: 'إدارةُ الأسطول',
  ls2: 'لوكيشن سوليوشن — التتبّع والصيانة',
  'vehicle-registry': 'سجلُّ المركبات',
  'shipment-orders': 'طلباتُ الشحنات',
  'light-transport': 'النقلُ الخفيف',
  b2c: 'مشروعُ B2C',
  collections: 'التحصيل',
  'collections-dept': 'قسمُ التحصيل',
  finance: 'الإدارةُ الماليّة',
  accounting: 'المحاسبة',
  reports: 'مركزُ التقارير',
  ops: 'مرآةُ منصّة الأوبريشن',
  wallet: 'العهدةُ اليوميّة',
  audit: 'سجلُّ المراجعة',
  notifications: 'التنبيهات',
  lookups: 'القوائمُ المرجعيّة',
  portal: 'بوّابةُ الشركاء',
  partners: 'حساباتُ الشركاء',
};

/** ردٌّ قياسيٌّ لكلّ مسار — الأخطاءُ موحَّدةٌ في النظام كلِّه. */
const RESPONSES = {
  200: { description: 'نجح' },
  400: { description: 'طلبٌ ناقصٌ أو غيرُ صالح' },
  401: { description: 'غيرُ مُصادَق — لا جلسةَ ولا مفتاح' },
  403: { description: 'لا صلاحيّةَ لهذا القسم أو لهذا الدور' },
  404: { description: 'غيرُ موجود' },
  500: { description: 'خطأٌ في الخادم' },
};

/**
 * بناءُ وثيقةِ OpenAPI من تطبيق إكسبرس.
 *
 * `scope: 'partner'` تقتصر على ما يُعطى لمن يتكامل معنا، و`'internal'` تشمل
 * السطحَ كلَّه.
 */
function buildOpenApi(app, { scope = 'partner', baseUrl = 'https://api.energize-logistics.com' } = {}) {
  const all = walk(app._router && app._router.stack);
  const seen = new Set();
  const routes = all.filter((r) => {
    if (!r.path.startsWith('/api')) return false;
    const key = `${r.method} ${r.path}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return scope === 'internal' ? true : r.path.startsWith('/api/fleet-api');
  }).sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));

  const paths = {};
  for (const r of routes) {
    const key = toOpenApiPath(r.path);
    paths[key] = paths[key] || {};
    const params = pathParams(r.path).map((name) => ({
      name, in: 'path', required: true, schema: { type: 'string' },
      description: name === 'id' ? 'معرّفُ السجلّ (ObjectId)' : undefined,
    }));
    const security = [];
    if (r.apiKey) security.push({ apiKey: [] });
    if (r.auth || r.section || r.roles) { security.push({ bearer: [] }); security.push({ cookie: [] }); }

    const notes = [];
    if (r.section) notes.push(`يتطلّب صلاحيّةَ قسم **${r.section}**.`);
    if (r.roles) notes.push(`الأدوارُ المقبولة: ${r.roles.join('، ')} — أو من مُنح القسمَ «تعديلًا» من مصفوفة الصلاحيّات.`);
    if (r.apiKey) notes.push('يُفتَح بترويسة `x-api-key`.');
    if (!security.length) notes.push('مفتوحٌ بلا مصادقة.');

    paths[key][r.method.toLowerCase()] = {
      tags: [groupOf(r.path)],
      summary: `${r.method} ${key}`,
      description: notes.join(' '),
      ...(params.length ? { parameters: params } : {}),
      ...(security.length ? { security } : {}),
      ...(['POST', 'PUT', 'PATCH'].includes(r.method)
        ? { requestBody: { required: false, content: { 'application/json': { schema: { type: 'object' } } } } }
        : {}),
      responses: RESPONSES,
    };
  }

  const tags = [...new Set(routes.map((r) => groupOf(r.path)))]
    .sort()
    .map((name) => ({ name, description: GROUP_AR[name] || name }));

  return {
    openapi: '3.0.3',
    info: {
      title: scope === 'partner' ? 'Energize Logistics — Partner API' : 'Energize Logistics — Internal API',
      version,
      description: scope === 'partner'
        ? [
          'واجهةُ قراءةٍ لأسطول إنرجايز اللوجستية — للأنظمة لا للبشر.',
          '',
          '**المصادقة:** ترويسة `x-api-key` بالمفتاح الذي يُسلَّم لك. وتُقبل أيضًا في',
          '`?key=` لأدواتِ الأتمتة التي لا ترسل ترويسات — لكنّها تُسجَّل في سجلّات',
          'الوصول، فالترويسةُ هي الموصى بها.',
          '',
          '**القراءةُ فقط:** لا كتابةَ في هذه الواجهة بحال. من يملك أن يغيّر شيئًا',
          'يدخل النظامَ بحسابه.',
          '',
          '**عمرُ القراءة:** كلُّ مركبةٍ تحمل `ageSec` — ثوانيَ منذ آخر إشارة. قراءةٌ',
          'عمرُها ساعةٌ ليست قراءةً حاليّة، فابنِ شرطَك عليه.',
          '',
          `**الأساس:** \`${baseUrl}\``,
        ].join('\n')
        : 'سطحُ النظام الداخليُّ كلُّه — خريطةٌ لا تُعطى لخارج الشركة.',
      contact: { name: 'Energize Logistics', url: 'https://energize-logistics.com' },
    },
    servers: [{ url: baseUrl }],
    tags,
    components: {
      securitySchemes: {
        apiKey: { type: 'apiKey', in: 'header', name: 'x-api-key', description: 'مفتاحُ التكامل — يُسلَّم لكلّ شريك على حدة.' },
        bearer: { type: 'http', scheme: 'bearer', description: 'رمزُ دخولِ مستخدم — تستعمله تطبيقاتُنا (الهاتف).' },
        cookie: { type: 'apiKey', in: 'cookie', name: 'token', description: 'جلسةُ المتصفّح — للموقع نفسِه.' },
      },
    },
    paths,
  };
}

/** إحصاءٌ سريعٌ يُعرَض في الصفحة: كم مسارًا، وكم مجموعة. */
function stats(app) {
  const all = walk(app._router && app._router.stack).filter((r) => r.path.startsWith('/api'));
  const groups = new Set(all.map((r) => groupOf(r.path)));
  return { routes: all.length, groups: groups.size, partner: all.filter((r) => r.path.startsWith('/api/fleet-api')).length };
}

module.exports = { buildOpenApi, stats, walk };
