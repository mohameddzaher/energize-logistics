/**
 * QA seed — a fresh, fake, local database for the whole system.
 *
 *   node qa/seed.js            (the local mongod must be up: qa/start-local.sh)
 *
 * 1. Refuses anything but the local QA database (qa/guard.js), then DROPS it.
 * 2. One user per role in config/roles (74): qa-<role>@local.test / QaTest@12345.
 * 3. Fake records for every model, generated from its own schema: valid enum
 *    values, dates around today, numbers, Arabic/English names, references that
 *    point at records seeded before them. Each record goes through the model's
 *    validation (Model.create) so the data has the shape real data has; a model
 *    whose records cannot be built is listed, not forced in.
 *
 * Nothing here reads backend/.env. Nothing here can reach production.
 */
const path = require('path');
const fs = require('fs');
const { QA_URI, assertLocal, PASSWORD } = require('./guard');

assertLocal(QA_URI);
const B = path.join(__dirname, '..', 'backend');
const mongoose = require(path.join(B, 'node_modules', 'mongoose'));

const PER_MODEL = Number(process.env.QA_PER_MODEL || 6);
const DAY = 86400000;
const AR_NAMES = ['شركة النخبة للنقليات', 'مؤسسة سريع اللوجستية', 'محمد أحمد العتيبي', 'خالد سعد الغامدي', 'فهد ناصر الحربي', 'مكتب الأبطال للنقل البري', 'شركة الأفق للتجارة', 'عبدالله محمد الدوسري'];
const CITIES = ['الرياض', 'جدة', 'الدمام', 'مكة', 'المدينة'];

// ── every model ────────────────────────────────────────────────────────────
for (const f of fs.readdirSync(path.join(B, 'src', 'models'))) {
  if (f.endsWith('.js')) { try { require(path.join(B, 'src', 'models', f)); } catch (e) { console.warn('model load', f, e.message); } }
}

const ids = new Map(); // model name → [ids]
const pick = (arr, i) => arr[i % arr.length];
const words = (n) => String(n || '').replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().split(/[\s_.]+/).filter(Boolean);

function valueFor(p, type, i, modelName) {
  const o = type.options || {};
  const inst = type.instance;
  const w = words(p.split('.').pop());
  const last = w[w.length - 1] || '';
  if (inst === 'ObjectId' || inst === 'ObjectID') {
    const ref = o.ref || (type.caster && type.caster.options && type.caster.options.ref);
    const pool = ref && ids.get(typeof ref === 'function' ? '' : ref);
    if (pool && pool.length) return pick(pool, i);
    const users = ids.get('User');
    return users && users.length ? pick(users, i) : new mongoose.Types.ObjectId();
  }
  if (inst === 'Date') return new Date(Date.now() + ((i % 7) - 3) * 9 * DAY + (last === 'expiry' || w.includes('expiry') ? 60 * DAY : 0));
  if (inst === 'Number') {
    if (o.enum && o.enum.length) return pick(o.enum, i);
    const min = typeof o.min === 'number' ? o.min : (Array.isArray(o.min) ? o.min[0] : 0);
    const max = typeof o.max === 'number' ? o.max : (Array.isArray(o.max) ? o.max[0] : null);
    let v = ['year'].includes(last) ? 2026 : ['month'].includes(last) ? (i % 12) + 1 : (i + 1) * 125;
    if (max != null && v > max) v = max; if (v < min) v = min;
    return v;
  }
  if (inst === 'Boolean') return i % 2 === 0;
  if (inst === 'String') {
    const en = type.enumValues && type.enumValues.length ? type.enumValues : (Array.isArray(o.enum) ? o.enum : (o.enum && o.enum.values));
    if (en && en.length) { const vals = en.filter((x) => x !== '' && x != null); return vals.length ? String(pick(vals, i)) : ''; }
    if (o.match) {
      const src = String(o.match.source || o.match);
      if (/@/.test(src)) return `qa${i}@local.test`;
      if (/\\d\{4\}-\\d\{2\}/.test(src) || /YYYY/.test(src)) return new Date().toISOString().slice(0, 7);
    }
    if (last === 'email' || last === 'emails') return `qa${i}.${modelName.toLowerCase()}@local.test`;
    if (['phone', 'mobile', 'whatsapp'].includes(last)) return `05${String(10000000 + i * 7919).slice(0, 8)}`;
    if (['iqama', 'national', 'identity'].some((k) => w.includes(k)) || (w.includes('id') && w.includes('number'))) return String(2000000000 + i * 1373);
    if (w.includes('plate')) return `ا ب ج ${1000 + i}`;
    if (last === 'city' || w.includes('city')) return pick(CITIES, i);
    if (last === 'code') return `QA${100 + i}`;
    if (last === 'number' || last === 'no') return String(90000 + i);
    if (last === 'key' || w.includes('key')) return `qa-${modelName.toLowerCase()}-${i}`;
    if (['name', 'title', 'customer', 'username', 'party', 'supplier', 'owner'].includes(last)) return `${pick(AR_NAMES, i)} QA${i}`;
    if (last === 'month') return new Date().toISOString().slice(0, 7);
    if (last === 'date' || last === 'day') return new Date(Date.now() - (i % 5) * DAY).toISOString().slice(0, 10);
    if (o.minlength || o.minLength) return 'x'.repeat(Number(o.minlength || o.minLength) + 2);
    return `QA ${p.split('.').pop()} ${i}`;
  }
  if (inst === 'Mixed' || inst === 'Map') return undefined;
  return undefined;
}

function docFor(model, i) {
  const out = {};
  const set = (obj, p, v) => { const parts = p.split('.'); let cur = obj; for (let k = 0; k < parts.length - 1; k += 1) { cur[parts[k]] = cur[parts[k]] || {}; cur = cur[parts[k]]; } cur[parts[parts.length - 1]] = v; };
  model.schema.eachPath((p, type) => {
    if (['_id', '__v', 'createdAt', 'updatedAt', 'password'].includes(p) || p.startsWith('__') || p.includes('$*')) return;
    // A required free-form field gets an empty object rather than nothing.
    if ((type.instance === 'Mixed' || type.instance === 'Map') && type.isRequired) { set(out, p, {}); return; }
    if (type.instance === 'Array' || type.instance === 'DocumentArray') {
      if (type.schema) {
        const sub = {};
        type.schema.eachPath((sp, st) => { if (!['_id', '__v'].includes(sp)) { const v = valueFor(sp, st, i, model.modelName); if (v !== undefined) set(sub, sp, v); } });
        set(out, p, [sub]);
      } else if (type.caster) {
        const v = valueFor(p, type.caster, i, model.modelName);
        if (v !== undefined) set(out, p, [v]);
      }
      return;
    }
    if (type.instance === 'Embedded' && type.schema) {
      const sub = {};
      type.schema.eachPath((sp, st) => { const v = valueFor(sp, st, i, model.modelName); if (v !== undefined) set(sub, sp, v); });
      set(out, p, sub);
      return;
    }
    const v = valueFor(p, type, i, model.modelName);
    if (v !== undefined) set(out, p, v);
  });
  // Models keyed by text (counters, caches) need their own _id.
  const idType = model.schema.path('_id');
  if (idType && idType.instance === 'String') out._id = `qa-${model.modelName.toLowerCase()}-${i}`;
  if (idType && idType.instance === 'Number') out._id = i + 1;
  return out;
}

(async () => {
  await mongoose.connect(QA_URI);
  const host = mongoose.connection.host;
  if (!['127.0.0.1', 'localhost'].includes(host)) { console.error('QA GUARD: connected host is', host); process.exit(2); }
  await mongoose.connection.db.dropDatabase();
  console.log('QA database dropped and re-created at', QA_URI);

  // ── users: one per role ──
  const { ALL_ROLES } = require(path.join(B, 'src', 'config', 'roles'));
  const User = mongoose.model('User');
  const roles = [...new Set(['super_admin', 'admin', ...ALL_ROLES])];
  const made = [];
  for (const role of roles) {
    try {
      const u = await User.create({ firstName: 'QA', lastName: role, email: `qa-${role}@local.test`, password: PASSWORD, role, isActive: true });
      made.push(u._id);
    } catch (e) { console.warn('user', role, e.message.slice(0, 120)); }
  }
  ids.set('User', made);
  console.log(`users: ${made.length}/${roles.length} roles`);

  // ── every other model: two passes so references find their targets ──
  const names = mongoose.modelNames().filter((n) => n !== 'User');
  const failed = new Map();
  for (let pass = 0; pass < 2; pass += 1) {
    for (const n of names) {
      if (pass === 1 && !failed.has(n)) continue;
      const M = mongoose.model(n);
      const got = [];
      let lastErr = '';
      for (let i = 0; i < PER_MODEL; i += 1) {
        try { const d = await M.create(docFor(M, i)); got.push(d._id); } catch (e) { lastErr = e.message; }
      }
      if (got.length) { ids.set(n, [...(ids.get(n) || []), ...got]); failed.delete(n); } else failed.set(n, lastErr);
    }
  }
  const seeded = names.filter((n) => ids.has(n));
  console.log(`models seeded: ${seeded.length}/${names.length} (${PER_MODEL} records each)`);
  fs.mkdirSync(path.join(__dirname, 'out'), { recursive: true });
  fs.writeFileSync(path.join(__dirname, 'out', 'seed-report.json'), JSON.stringify({
    at: new Date().toISOString(), users: made.length, roles: roles.length, seeded,
    failed: Object.fromEntries([...failed.entries()].map(([k, v]) => [k, String(v).slice(0, 300)])),
  }, null, 2));
  // A few real ids per model — the sweeps use them for /:id routes.
  fs.writeFileSync(path.join(__dirname, 'out', 'seed-ids.json'), JSON.stringify(Object.fromEntries([...ids.entries()].map(([k, v]) => [k, v.slice(0, 3).map(String)])), null, 1));
  if (failed.size) console.log('not seeded (see qa/out/seed-report.json):', [...failed.keys()].join(', '));
  await mongoose.disconnect();
  process.exit(0);
})().catch((e) => { console.error('seed failed:', e); process.exit(1); });
