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
const crypto = require('crypto');
const { routeFields } = require('./apiFieldScan');
const { routeSamples } = require('./apiSamples');

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
      // `router.get('/')` تحت `/api/x` يصير `/api/x/` — والمسارُ واحد، فبلا الشرطة الأخيرة.
      const full = `${prefix}${layer.route.path}`.replace(/\/{2,}/g, '/').replace(/(.)\/$/, '$1');
      const base = inheritedFor(layer.route.path);
      for (const method of methods) {
        // الطبقاتُ نفسُها تُحمَل غيرَ قابلةٍ للعدّ — منها تُقرأ الحقول (apiFieldScan) ولا تظهر في الإحصاء.
        const r = { method: method.toUpperCase(), path: full, ...base, ...own };
        Object.defineProperty(r, 'stack', { value: layer.route.stack, enumerable: false });
        out.push(r);
      }
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

/** Route groups: the first segment after `/api` is the business area. */
const groupOf = (p) => {
  const m = /^\/api\/([^/]+)/.exec(p);
  return m ? m[1] : 'root';
};

/** Group descriptions (English only — the docs page is English). Unlisted groups show their name. */
const GROUP_INFO = {
  'fleet-api': 'Fleet automation API — key-authenticated, read-only. This is the surface given to partners.',
  auth: 'Sign-in, sessions and tokens',
  users: 'Users, roles and access',
  permissions: 'Role × section permission matrix',
  hr: 'Human resources — employees, contracts, leave, payroll',
  crm: 'Customer relationship management',
  'crm-vendors': 'Carrier / 3PL vendor register',
  fleet: 'Fleet management — own trucks, drivers, loads',
  ls2: 'Location Solutions — GPS tracking, telemetry and maintenance',
  'vehicle-registry': 'Vehicle register — documents, authorisations, driver cards',
  vehicles: 'Vehicles and authorisations',
  'shipment-orders': 'Shipment orders — bookings, waybills, carrier drivers',
  'light-transport': 'Light transport — riders, housing, custody',
  b2c: 'B2C project',
  collections: 'Collections',
  'collections-dept': 'Collections department — invoices, ledger, aging, parties',
  finance: 'Finance management',
  accounting: 'Accounting',
  reports: 'Report centre — branded PDFs',
  ops: 'Operations platform mirror',
  workflows: 'Operations workflow sheets',
  wallet: 'Daily cash wallet',
  customs: 'Customs clearance',
  contracts: 'Contracts',
  audit: 'Audit log',
  notifications: 'Notifications',
  lookups: 'Reference data lists',
  portal: 'Partner portal',
  partners: 'Partner accounts',
  docs: 'This documentation',
  jp: 'Work plans (JP)',
  'section-work': 'Section tasks and complaints',
  analytics: 'Analytics and executive overview',
  it: 'IT — assets, emails, custody',
};

/** Standard responses — errors are uniform across the system: `{ message }`. */
const ERROR_EXAMPLE = (message) => ({ 'application/json': { example: { message } } });
const RESPONSES = {
  400: { description: 'Bad request — a required field is missing or invalid', content: ERROR_EXAMPLE('Required fields are missing') },
  401: { description: 'Not authenticated — no session, token or key', content: ERROR_EXAMPLE('Not authenticated') },
  403: { description: 'Forbidden — the section or role does not allow this', content: ERROR_EXAMPLE('Access denied') },
  404: { description: 'Not found', content: ERROR_EXAMPLE('Not found') },
  500: { description: 'Server error', content: ERROR_EXAMPLE('Server error') },
};
const ERRORS = Object.entries(RESPONSES).map(([status, r]) => ({ status: Number(status), description: r.description }));

/** All mounted `/api` routes, unique by method + path, sorted. */
function apiRoutes(app, scope) {
  const all = walk(app._router && app._router.stack);
  const seen = new Set();
  return all.filter((r) => {
    if (!r.path.startsWith('/api')) return false;
    const key = `${r.method} ${r.path}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return scope === 'internal' ? true : r.path.startsWith('/api/fleet-api');
  }).sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
}

/** Everything known about one route, in plain English — shared by OpenAPI and the catalog. */
function describe(r) {
  const handler = r.stack && r.stack.length ? r.stack[r.stack.length - 1].handle : null;
  const fields = routeFields(r.stack);
  const sm = routeSamples({ method: r.method, path: r.path, handler, fields });
  const params = pathParams(r.path).map((name) => ({
    name, in: 'path', required: true, type: name === 'id' || /Id$/.test(name) ? 'objectId' : 'string',
    description: name === 'id' || /Id$/.test(name) ? 'Record id (ObjectId)' : '',
    example: name === 'id' || /Id$/.test(name) ? '6a96c6b71dabbd8fad1405e6' : name,
  }));
  const pathNames = new Set(params.map((x) => x.name));
  const query = sm.query.filter((f) => !pathNames.has(f.name));
  const auth = r.apiKey ? 'apiKey' : (r.auth || r.section || r.roles) ? 'user' : 'public';
  const notes = [];
  if (r.section) notes.push(`Requires access to the **${r.section}** section.`);
  if (r.roles) notes.push(`Accepted roles: ${r.roles.join(', ')} — or anyone granted edit on the section in the permission matrix.`);
  if (r.apiKey) notes.push('Authenticated with the `x-api-key` header.');
  if (auth === 'public') notes.push('Open — no authentication.');
  if (['POST', 'PUT', 'PATCH'].includes(r.method) && !fields.body.length && fields.wholeBody) {
    notes.push('Accepts the record fields as sent (the handler does not list its fields).');
  }
  return {
    id: `${r.method} ${r.path}`,
    method: r.method,
    path: r.path,
    group: groupOf(r.path),
    auth,
    section: r.section || '',
    roles: r.roles || [],
    model: sm.model || '',
    params,
    query,
    body: sm.body,
    wholeBody: !!fields.wholeBody,
    requestExample: sm.requestExample,
    responseExample: sm.responseExample,
    notes: notes.join(' '),
  };
}

/** A short, stable fingerprint of the surface: changes with any route or field change. */
function signatureOf(items) {
  const h = crypto.createHash('sha1');
  for (const d of items) h.update(`${d.id}|${d.auth}|${d.section}|${d.roles.join(',')}|${d.query.map((f) => f.name).join(',')}|${d.body.map((f) => f.name).join(',')}|${d.model}\n`);
  return h.digest('hex').slice(0, 12);
}

/**
 * The OpenAPI 3 document. `scope: 'partner'` keeps only what partners get;
 * `'internal'` is the whole surface.
 */
function buildOpenApi(app, { scope = 'partner', baseUrl = 'https://api.energize-logistics.com' } = {}) {
  const items = apiRoutes(app, scope).map(describe);
  const paths = {};
  for (const d of items) {
    const key = toOpenApiPath(d.path);
    paths[key] = paths[key] || {};
    const parameters = [
      ...d.params.map((p) => ({ name: p.name, in: 'path', required: true, schema: { type: 'string' }, description: p.description || undefined, example: p.example })),
      ...d.query.map((f) => ({ name: f.name, in: 'query', required: !!f.required, schema: { type: f.type === 'number' ? 'number' : f.type === 'boolean' ? 'boolean' : 'string' }, example: f.example })),
    ];
    const security = d.auth === 'apiKey' ? [{ apiKey: [] }] : d.auth === 'user' ? [{ bearer: [] }, { cookie: [] }] : [];
    const writes = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(d.method);
    const ok = { description: 'Success', ...(d.responseExample ? { content: { 'application/json': { example: d.responseExample } } } : {}) };
    paths[key][d.method.toLowerCase()] = {
      tags: [d.group],
      summary: `${d.method} ${key}`,
      description: [d.notes, d.model ? `Record model: \`${d.model}\`.` : ''].filter(Boolean).join(' '),
      ...(parameters.length ? { parameters } : {}),
      ...(security.length ? { security } : {}),
      ...(writes && d.body.length ? {
        requestBody: {
          required: d.body.some((f) => f.required),
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: Object.fromEntries(d.body.map((f) => [f.name, { type: f.type === 'objectId' || f.type === 'date' ? 'string' : f.type, ...(f.type === 'date' ? { format: 'date' } : {}) }])),
                ...(d.body.some((f) => f.required) ? { required: d.body.filter((f) => f.required).map((f) => f.name) } : {}),
              },
              example: d.requestExample,
            },
          },
        },
      } : (['POST', 'PUT', 'PATCH'].includes(d.method) ? { requestBody: { required: false, content: { 'application/json': { schema: { type: 'object' } } } } } : {})),
      responses: { 200: ok, ...RESPONSES },
      ...(d.model ? { 'x-model': d.model } : {}),
    };
  }
  const tags = [...new Set(items.map((d) => d.group))].sort().map((name) => ({ name, description: GROUP_INFO[name] || name }));
  return {
    openapi: '3.0.3',
    info: {
      title: scope === 'partner' ? 'Energize Logistics — Partner API' : 'Energize Logistics — Internal API',
      version,
      description: scope === 'partner'
        ? [
          'Read-only fleet API for Energize Logistics — built for systems, not people.',
          '',
          '**Authentication:** send the key you were given in the `x-api-key` header. `?key=` is also accepted for automation tools that cannot send headers, but it is written to access logs — the header is recommended.',
          '',
          '**Read-only:** this API never writes. Changes are made by signing in to the system.',
          '',
          '**Freshness:** every vehicle carries `ageSec` — seconds since its last signal. Base your conditions on it.',
          '',
          `**Base URL:** \`${baseUrl}\``,
        ].join('\n')
        : 'The whole internal surface of the system — generated from the running code. Not for distribution outside the company.',
      contact: { name: 'Energize Logistics', url: 'https://energize-logistics.com' },
      'x-signature': signatureOf(items),
      'x-generated-at': new Date().toISOString(),
    },
    servers: [{ url: baseUrl }],
    tags,
    components: {
      securitySchemes: {
        apiKey: { type: 'apiKey', in: 'header', name: 'x-api-key', description: 'Integration key — issued per partner.' },
        bearer: { type: 'http', scheme: 'bearer', description: 'User access token — used by our mobile app.' },
        cookie: { type: 'apiKey', in: 'cookie', name: 'token', description: 'Browser session — used by the web app.' },
      },
    },
    paths,
  };
}

/** The compact catalog the docs page renders — same facts as the OpenAPI document. */
function buildCatalog(app, { baseUrl = 'https://api.energize-logistics.com' } = {}) {
  const items = apiRoutes(app, 'internal').map(describe);
  const counts = new Map();
  for (const d of items) counts.set(d.group, (counts.get(d.group) || 0) + 1);
  return {
    title: 'Energize Logistics API',
    version,
    baseUrl,
    generatedAt: new Date().toISOString(),
    signature: signatureOf(items),
    groups: [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]))
      .map(([name, count]) => ({ name, count, description: GROUP_INFO[name] || '' })),
    errors: ERRORS,
    endpoints: items,
  };
}

/** Quick counters for the page header, plus the surface signature. */
function stats(app) {
  const items = apiRoutes(app, 'internal').map(describe);
  return {
    routes: items.length,
    groups: new Set(items.map((d) => d.group)).size,
    partner: items.filter((d) => d.path.startsWith('/api/fleet-api')).length,
    withFields: items.filter((d) => d.query.length || d.body.length).length,
    withModel: items.filter((d) => d.model).length,
    signature: signatureOf(items),
  };
}

module.exports = { buildOpenApi, buildCatalog, stats, walk };
