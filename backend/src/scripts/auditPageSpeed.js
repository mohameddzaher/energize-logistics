/* eslint-disable no-console */
/**
 * auditPageSpeed — أيُّ نداءٍ يُبطئ أيَّ شاشة؟
 *
 *   node src/scripts/auditPageSpeed.js
 *
 * الشكوى «السيستم بطيء» لا تُصلَح، والنداء الذي يستغرق ثانيتين يُصلَح. فيُقاس
 * كلُّ نداءٍ تفتحه الشاشة عند فتحها، مرّتين: باردًا (أوّل مرّة) ودافئًا (بعد
 * التخزين المؤقّت) — والفرق بينهما يقول أين ينفع التخزين وأين لا ينفع لأنّ
 * الاستعلام نفسه بطيء.
 *
 * ويُستدعى المتحكّم مباشرةً لا عبر الشبكة: القياس يخصّ الخادم وقاعدة البيانات،
 * ولو مرّ بالشبكة لاختلط زمنُ الاستعلام بزمن الرحلة إلى الخادم.
 */
require('dotenv').config();
const mongoose = require('mongoose');

const SCREENS = [
  ['قسم المركبات — سجلّ المركبات', 'vehicleRegistryController', [
    ['list', { limit: '2000' }], ['filterOptions', {}],
  ]],
  ['قسم المركبات — النظرة الشاملة', 'vehicleRegistryController', [['overview', {}]]],
  ['قسم المركبات — الانتهاءات', 'vehicleRegistryController', [['expiring', {}]]],
  ['قسم المركبات — سجلّات القسم', 'vehicleRegistryController', [['registers', {}]]],
  ['قسم المركبات — التحليلات', 'vehicleRegistryController', [['dashboard', {}]]],
  ['العمليات — سير العمل', 'workflowController', [
    ['getWorkflows', { page: '1', limit: '50' }], ['getWorkflowStats', {}],
  ]],
  ['الموارد البشرية — الماستر', 'hrMasterController', [
    ['list', { limit: '100' }], ['filters', {}],
  ]],
  ['لوكيشن سوليوشن — الأصول', 'ls2AssetsController', [['getFleetAssets', {}]]],
  ['إدارة الأسطول — اللوحة', 'fleetController', [
    ['listVehicles', {}], ['getDashboard', {}], ['listCustomers', {}],
  ]],
];

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const User = require('../models/User');
  const user = await User.findOne({ email: 'admin@energize.com' }).lean();

  const call = (fn, query) => new Promise((resolve) => {
    const t0 = Date.now();
    const res = {
      statusCode: 200,
      status(c) { this.statusCode = c; return this; },
      json(d) { resolve({ ms: Date.now() - t0, code: this.statusCode, size: JSON.stringify(d || {}).length }); },
      setHeader() {}, set() {}, end() { resolve({ ms: Date.now() - t0, code: this.statusCode, size: 0 }); },
    };
    Promise.resolve(fn({ user, query, params: {}, body: {}, ip: '127.0.0.1' }, res))
      .catch((e) => resolve({ ms: Date.now() - t0, code: 500, err: String(e.message || e) }));
  });

  console.log('\n  الشاشة                              النداء              بارد    دافئ    الحجم');
  console.log('  ' + '─'.repeat(88));
  const slow = [];
  for (const [screen, mod, calls] of SCREENS) {
    let ctrl;
    try { ctrl = require(`../controllers/${mod}`); } catch (e) { console.log(`  ✗ ${screen}: ${e.message}`); continue; }
    let first = true;
    for (const [name, query] of calls) {
      const fn = ctrl[name];
      if (typeof fn !== 'function') { console.log(`  ✗ ${screen} · ${name}: غير موجود`); continue; }
      const cold = await call(fn, query);
      const warm = await call(fn, query);
      const kb = cold.size ? `${Math.round(cold.size / 1024)}KB` : '—';
      console.log('  ' + (first ? screen : '').padEnd(36) + name.padEnd(20)
        + `${cold.ms}ms`.padStart(7) + `${warm.ms}ms`.padStart(8) + kb.padStart(9)
        + (cold.code !== 200 ? `   ✗ ${cold.err || cold.code}` : ''));
      first = false;
      if (cold.ms > 800 || warm.ms > 800) slow.push({ screen, name, cold: cold.ms, warm: warm.ms, size: cold.size });
    }
  }

  console.log('');
  if (slow.length) {
    console.log('  ⚠ نداءاتٌ تتجاوز ٨٠٠ مللي ثانية:');
    slow.sort((a, b) => b.warm - a.warm)
      .forEach((s) => console.log(`     ${s.screen} · ${s.name} — بارد ${s.cold}ms · دافئ ${s.warm}ms · ${Math.round(s.size / 1024)}KB`));
  } else console.log('  ✓ لا نداء يتجاوز ٨٠٠ مللي ثانية.');
  console.log('');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
