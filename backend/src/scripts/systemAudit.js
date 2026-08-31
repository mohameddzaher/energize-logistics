/**
 * systemAudit — فحصُ النظام كلِّه: هل كلُّ شيءٍ يعمل، ومربوطٌ بما بعده؟
 *
 *   node src/scripts/systemAudit.js
 *
 * لا يكتب شيئًا. يقرأ ويشغّل ويقارن، ويعدّ ما وجده.
 */
process.env.AUDIT_SUPPRESS = '1';
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

const P = (s) => console.log(s);
const problems = [];
const warn = (area, msg, detail) => problems.push({ level: 'warn', area, msg, detail });
const bad = (area, msg, detail) => problems.push({ level: 'bad', area, msg, detail });

(async () => {
  P('\n' + '='.repeat(78));
  P('  فحصُ النظام');
  P('='.repeat(78));

  // ── ١ · كلُّ الملفّات تُحمَّل ───────────────────────────────────────────────
  const dirs = ['models', 'controllers', 'services', 'routes', 'jobs', 'utils', 'middleware', 'config'];
  let loaded = 0;
  for (const d of dirs) {
    const dir = path.join(__dirname, '..', d);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.js'))) {
      try { require(path.join(dir, f)); loaded += 1; }
      catch (e) { bad('تحميل', `${d}/${f}`, e.message.split('\n')[0]); }
    }
  }
  P(`\n  ١ · التحميل: ${loaded} ملفًّا · أعطال: ${problems.filter((p) => p.area === 'تحميل').length}`);

  await mongoose.connect(process.env.MONGODB_URI);

  // ── ٢ · المراجعُ المعلّقة ─────────────────────────────────────────────────
  // حقلٌ يشير إلى مستندٍ لم يعد موجودًا: الشاشةُ تعرض فراغًا ولا تقول لماذا.
  P('\n  ٢ · المراجعُ المعلّقة (حقلٌ يشير إلى مستندٍ محذوف)');
  const refChecks = [];
  for (const name of mongoose.modelNames()) {
    const M = mongoose.model(name);
    for (const [pathName, def] of Object.entries(M.schema.paths)) {
      const ref = def.options && def.options.ref;
      if (!ref || !mongoose.modelNames().includes(ref)) continue;
      if (pathName.includes('.')) continue; // المتداخلةُ تُفحص بعينةٍ لا بجملة
      refChecks.push({ model: name, path: pathName, ref });
    }
  }
  let danglingTotal = 0;
  for (const c of refChecks) {
    const M = mongoose.model(c.model);
    const R = mongoose.model(c.ref);
    // eslint-disable-next-line no-await-in-loop
    const ids = await M.distinct(c.path, { [c.path]: { $ne: null } });
    if (!ids.length) continue;
    // eslint-disable-next-line no-await-in-loop
    const found = await R.countDocuments({ _id: { $in: ids } });
    const missing = ids.length - found;
    if (missing > 0) {
      danglingTotal += missing;
      // eslint-disable-next-line no-await-in-loop
      const alive = new Set((await R.find({ _id: { $in: ids } }).select('_id').lean()).map((x) => String(x._id)));
      const dead = ids.filter((i) => !alive.has(String(i))).slice(0, 3);
      // eslint-disable-next-line no-await-in-loop
      const rows = await M.countDocuments({ [c.path]: { $in: dead } });
      warn('مراجع', `${c.model}.${c.path} → ${c.ref}`, `${missing} معرّفًا مفقودًا · ${rows}+ صفًّا متأثّرًا`);
    }
  }
  P(`     فُحص ${refChecks.length} مرجعًا · معلّق: ${danglingTotal}`);

  // ── ٣ · القوائمُ المرجعيّةُ التي تطلبها الشاشات ─────────────────────────────
  // `<ManagedSelect type="x">` بنوعٍ غيرِ مسجَّلٍ يعرض قائمةً فارغةً أبدًا.
  P('\n  ٣ · القوائم المرجعية');
  const { REGISTRY } = require('../config/lookupTypes');
  const known = new Set(REGISTRY.map((r) => r.type));
  const feDir = path.join(__dirname, '../../../frontend/src');
  const used = new Set();
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== 'node_modules') walk(full); continue; }
      if (!/\.tsx?$/.test(e.name)) continue;
      const txt = fs.readFileSync(full, 'utf8');
      for (const m of txt.matchAll(/type=["']([a-z0-9_]+)["']/g)) {
        if (/^(text|date|number|email|password|checkbox|submit|button|tel|search|time|datetime|month|week|url|file|radio|color|range|hidden)$/.test(m[1])) continue;
        used.add(m[1]);
      }
    }
  };
  if (fs.existsSync(feDir)) walk(feDir);
  const unknownTypes = [...used].filter((t) => !known.has(t) && /_/.test(t));
  if (unknownTypes.length) warn('قوائم', 'أنواعٌ تطلبها الشاشاتُ وليست مسجَّلة', unknownTypes.join(', '));
  const Lookup = mongoose.model('Lookup');
  const empty = [];
  for (const r of REGISTRY) {
    // eslint-disable-next-line no-await-in-loop
    const n = await Lookup.countDocuments({ type: r.type, isActive: true, deleted: { $ne: true } });
    if (n === 0) empty.push(r.type);
  }
  if (empty.length) warn('قوائم', 'قوائمُ مسجَّلةٌ لا قيمةَ فيها', empty.join(', '));
  P(`     مسجَّلة ${REGISTRY.size || REGISTRY.length} · تطلبها الشاشات ${used.size} · غير مسجَّل ${unknownTypes.length} · فارغة ${empty.length}`);

  // ── ٤ · تشغيلُ نقاط القراءة بكلّ دور ───────────────────────────────────────
  P('\n  ٤ · نقاطُ القراءة');
  const { testUser } = require('./lib/testUser');
  const { ALL_ROLES } = require('../config/roles');
  const call = (fn, req) => new Promise((resolve) => {
    let done = false;
    const finish = (code, body) => { if (!done) { done = true; resolve({ code, body }); } };
    const res = {
      statusCode: 200,
      status(c) { this.statusCode = c; return this; },
      json(b) { finish(this.statusCode, b); },
      send(b) { finish(this.statusCode, b); },
      end() { finish(this.statusCode, null); },
      setHeader() { return this; },
    };
    try {
      const r = fn({ user: testUser(), ip: '127.0.0.1', params: {}, query: {}, body: {}, headers: {}, ...req }, res);
      if (r && r.catch) r.catch((e) => finish(500, { message: e.message }));
    } catch (e) { finish(500, { message: e.message }); }
    setTimeout(() => finish(-1, { message: 'timeout' }), 25000);
  });

  const LIST_ENDPOINTS = [
    ['customsClearanceController', 'getClearances'], ['customsClearanceController', 'getAnalytics'],
    ['customsClearanceController', 'getFilterOptions'], ['customsClearanceController', 'listParties'],
    ['vehicleRegistryController', 'list'], ['vehicleRegistryController', 'dashboard'],
    ['vehicleRegistryController', 'filterOptions'], ['vehicleRegistryController', 'alerts'],
    ['vehicleRegistryController', 'listDriverCards'], ['vehicleRegistryController', 'registers'],
    ['vehicleController', 'listVehicles'], ['vehicleController', 'listAccidents'],
    ['vehicleController', 'listAuthorizations'], ['vehicleController', 'getDashboard'],
    ['workflowController', 'getWorkflows'], ['workflowController', 'getWorkflowStats'],
    ['workflowController', 'filterOptions'],
    ['shipmentOrdersController', 'listOrders'], ['shipmentOrdersController', 'getAnalytics'],
    ['hrController', 'listEmployees'], ['hrMasterController', 'dashboard'],
    ['walletController', 'getAllBranchesDashboard'],
    ['fleetController', 'getDashboard'],
    ['crmController', 'getDashboard'],
  ];
  let ran = 0;
  for (const [file, fn] of LIST_ENDPOINTS) {
    let mod;
    try { mod = require(`../controllers/${file}`); } catch (e) { bad('نقاط', `${file}`, e.message); continue; }
    if (typeof mod[fn] !== 'function') { warn('نقاط', `${file}.${fn}`, 'غير موجودة'); continue; }
    // eslint-disable-next-line no-await-in-loop
    const t = Date.now();
    // eslint-disable-next-line no-await-in-loop
    const r = await call(mod[fn], {});
    const ms = Date.now() - t;
    ran += 1;
    if (r.code >= 500 || r.code === -1) bad('نقاط', `${file}.${fn}`, `${r.code} · ${(r.body && r.body.message) || ''}`);
    else if (ms > 8000) warn('بطء', `${file}.${fn}`, `${(ms / 1000).toFixed(1)} ثانية`);
  }
  P(`     شُغّلت ${ran} نقطة`);

  // ── ٥ · اتّساقُ الأرقام بين الشاشات ────────────────────────────────────────
  P('\n  ٥ · اتّساقُ الأرقام');
  const W = mongoose.model('OperationsWorkflow');
  const wf = require('../controllers/workflowController');
  const noPay = { $or: [{ paymentDate: null }, { paymentDate: '' }, { paymentDate: { $exists: false } }] };
  const direct = await W.countDocuments({ $and: [noPay], applicationStatus: { $nin: ['cancelled', 'canceled'] } });
  const viaStats = (await call(wf.getWorkflowStats, { query: { pendingOnly: 'true' } })).body;
  if (Number(viaStats.total) !== direct) {
    bad('اتّساق', 'فواتير لم تصل', `الشاشة ${viaStats.total} · القاعدة ${direct}`);
  } else P(`     «فواتير لم تصل» تطابق القاعدة: ${direct}`);

  const CP = mongoose.model('CustomsParty');
  const CC = mongoose.model('CustomsClearance');
  const linkedC = await CC.countDocuments({ customerParty: { $ne: null } });
  const totalC = await CC.countDocuments({ customerName: { $nin: ['', null] } });
  if (linkedC < totalC) warn('اتّساق', 'معاملاتُ تخليصٍ بلا ملفِّ عميل', `${totalC - linkedC} من ${totalC}`);
  else P(`     معاملاتُ التخليص مربوطةٌ بملفّات العملاء: ${linkedC}`);

  const DC = mongoose.model('DriverCard');
  const unlinkedCards = await DC.countDocuments({ $or: [{ employee: null }, { employee: { $exists: false } }] });
  if (unlinkedCards) warn('اتّساق', 'بطاقاتُ سائقين بلا موظّف', String(unlinkedCards));
  else P(`     بطاقاتُ السائقين كلُّها مربوطةٌ بموظّفين`);

  // ── ٦ · تكرارُ ما يجب أن يكون فريدًا ───────────────────────────────────────
  P('\n  ٦ · التكرار');
  const dupChecks = [
    ['Employee', 'iqamaNumber'], ['Employee', 'employeeNumber'],
    ['OperationsWorkflow', 'reportNumber'], ['ShipmentOrder', 'externalId'],
    ['VehicleMaster', 'plateNumber'], ['DriverCard', 'idNumber'], ['User', 'email'],
  ];
  for (const [model, field] of dupChecks) {
    if (!mongoose.modelNames().includes(model)) continue;
    // eslint-disable-next-line no-await-in-loop
    const dups = await mongoose.model(model).aggregate([
      { $match: { [field]: { $nin: ['', null] } } },
      { $group: { _id: `$${field}`, n: { $sum: 1 } } },
      { $match: { n: { $gt: 1 } } }, { $limit: 5 },
    ]);
    if (dups.length) warn('تكرار', `${model}.${field}`, dups.map((d) => `${d._id}×${d.n}`).join(' '));
  }
  P(`     فُحص ${dupChecks.length} حقلًا`);

  // ── ٧ · الحقولُ التي تُكتب ولا تُخزَّن ──────────────────────────────────────
  // حقلٌ في `EDITABLE` وليس في المخطّط يُسقَط صامتًا — وهو العطلُ الذي أضاع
  // ثلاثةً وثلاثين ألفَ اسمِ مورّد.
  P('\n  ٧ · حقولٌ تُقبَل ولا تُخزَّن');
  const editableChecks = [
    ['customsClearanceController', 'EDITABLE', 'CustomsClearance'],
  ];
  for (const [file, , model] of editableChecks) {
    const src = fs.readFileSync(path.join(__dirname, `../controllers/${file}.js`), 'utf8');
    const m = src.match(/const EDITABLE = \[([\s\S]*?)\];/);
    if (!m) continue;
    const fields = [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
    const paths = new Set(Object.keys(mongoose.model(model).schema.paths));
    const missing = fields.filter((f) => !paths.has(f));
    if (missing.length) bad('مخطّط', `${model}: حقولٌ يقبلها الخادمُ ولا يخزّنها`, missing.join(', '));
    else P(`     ${model}: كلُّ الحقول المقبولة مخزَّنة (${fields.length})`);
  }

  // ── ٨ · التوقيت ───────────────────────────────────────────────────────────
  P('\n  ٨ · التوقيت');
  const { todayKey, startOfDay } = require('../utils/companyDay');
  const tk = todayKey();
  const utcKey = new Date().toISOString().slice(0, 10);
  P(`     يوم الشركة: ${tk} · يوم غرينتش: ${utcKey}${tk !== utcKey ? '  ← مختلفان الآن' : ''}`);
  const leftoverUtc = [];
  for (const d of ['controllers', 'services']) {
    const dir = path.join(__dirname, '..', d);
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.js'))) {
      const txt = fs.readFileSync(path.join(dir, f), 'utf8');
      for (const line of txt.split('\n')) {
        if (/\$gte|\$lte/.test(line) && /T00:00:00|T23:59:59/.test(line) && !/^\s*(\/\/|\*)/.test(line)) {
          leftoverUtc.push(`${d}/${f}`);
          break;
        }
      }
    }
  }
  if (leftoverUtc.length) warn('توقيت', 'مِصفاةُ مدًى ما زالت تبني حدَّها بغرينتش', [...new Set(leftoverUtc)].join(', '));
  else P('     لا مِصفاةَ مدًى تبني حدَّها بغرينتش');

  // ── التقرير ───────────────────────────────────────────────────────────────
  P('\n' + '='.repeat(78));
  const bads = problems.filter((p) => p.level === 'bad');
  const warns = problems.filter((p) => p.level === 'warn');
  P(`  النتيجة: ${bads.length} عطلًا · ${warns.length} تنبيهًا`);
  P('='.repeat(78));
  for (const p of [...bads, ...warns]) {
    P(`  ${p.level === 'bad' ? '✗' : '⚠'} [${p.area}] ${p.msg}`);
    if (p.detail) P(`      ${String(p.detail).slice(0, 160)}`);
  }
  P('');
  await mongoose.disconnect();
})().catch(async (e) => { console.error(e); try { await mongoose.disconnect(); } catch (_) {} process.exit(1); });
