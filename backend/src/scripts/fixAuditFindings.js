/**
 * fixAuditFindings — علاجُ ما كشفه `systemAudit`.
 *
 *   node src/scripts/fixAuditFindings.js [--yes]
 *
 * ثلاثةُ أشياء، ولكلٍّ سببُ علاجه:
 *
 *  ١ · موظّفٌ مكرَّر: سجلّان لشخصٍ واحدٍ برقم الهويّة نفسِه. يُدمَجان في الذي
 *      يحمل الارتباطات (تفويضٌ، عهدةٌ، حساب) لأنّ حذفَه يقطعها، ويُنقَل إليه ما
 *      يملأ فراغاتِه من الآخر — فلا تُفقَد بياناتٌ ولا يبقى نصفُ الرجل في سجلٍّ
 *      ونصفُه في آخر.
 *
 *  ٢ · إشعاراتٌ لمستخدمين محذوفين: لا أحدَ سيقرؤها أبدًا. تُمسح — بخلاف سجلّ
 *      المراجعة الذي يبقى وإن حُذف صاحبُه، فهو تاريخٌ لا بريد.
 *
 *  ٣ · حساباتُ الدخول المرتبطةُ بموظّفٍ محذوف: تُفَكّ ولا تُحذَف.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

const APPLY = process.argv.includes('--yes');

const fold = (s) => String(s || '')
  .replace(/[أإآٱ]/g, 'ا').replace(/[ةه]/g, 'ه').replace(/[ىئي]/g, 'ي')
  .replace(/\s+/g, '').toLowerCase();

(async () => {
  console.log('\n' + '='.repeat(72));
  console.log(APPLY ? '  علاجُ ما كشفه الفحص — تنفيذ' : '  علاجُ ما كشفه الفحص — فحصٌ فقط');
  console.log('='.repeat(72));
  await mongoose.connect(process.env.MONGODB_URI);
  for (const f of fs.readdirSync(path.join(__dirname, '../models')).filter((x) => x.endsWith('.js'))) {
    try { require(`../models/${f}`); } catch (e) { /* لا يمنع البقيّة */ }
  }
  const Employee = mongoose.model('Employee');
  const Notification = mongoose.model('Notification');
  const User = mongoose.model('User');

  // ── ١ · الموظّفون المكرَّرون ────────────────────────────────────────────────
  const all = await Employee.find({}).lean();
  const groups = new Map();
  for (const e of all) {
    const key = fold(e.iqamaNumber || e.nationalId) || `name:${fold(e.arabicName || [e.firstName, e.lastName].filter(Boolean).join(' '))}`;
    if (!key || key === 'name:') continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(e);
  }
  const dups = [...groups.values()].filter((v) => v.length > 1);

  // ما يشير إلى الموظّف — يُنقَل كلُّه إلى الباقي.
  const REFS = [];
  for (const name of mongoose.modelNames()) {
    const M = mongoose.model(name);
    for (const [p, def] of Object.entries(M.schema.paths)) {
      if (def.options && def.options.ref === 'Employee') REFS.push({ model: name, path: p });
    }
  }

  const plans = [];
  for (const g of dups) {
    // الباقي هو الأكثرُ ارتباطًا؛ فإن تساويا فالأقدم — هو الذي بُني عليه العمل.
    const scored = [];
    for (const e of g) {
      let links = 0;
      for (const r of REFS) {
        // eslint-disable-next-line no-await-in-loop
        links += await mongoose.model(r.model).countDocuments({ [r.path]: e._id });
      }
      scored.push({ e, links });
    }
    scored.sort((a, b) => (b.links - a.links) || (new Date(a.e.createdAt) - new Date(b.e.createdAt)));
    const keep = scored[0].e;
    const drop = scored.slice(1).map((x) => x.e);
    // ما يملأ فراغَ الباقي يُؤخَذ من المحذوف — ولا يُكتب فوق قيمةٍ موجودة.
    const fill = {};
    for (const d of drop) {
      for (const [k, v] of Object.entries(d)) {
        if (['_id', '__v', 'createdAt', 'updatedAt'].includes(k)) continue;
        const cur = keep[k];
        const empty = cur === undefined || cur === null || cur === '' || (Array.isArray(cur) && !cur.length);
        const has = v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && !v.length);
        if (empty && has && fill[k] === undefined) fill[k] = v;
      }
    }
    plans.push({ keep, drop, fill, links: scored.map((s) => s.links) });
  }

  console.log(`\n  ١ · موظّفون مكرَّرون: ${plans.length}`);
  plans.forEach((p) => {
    const nm = (e) => e.arabicName || [e.firstName, e.lastName].filter(Boolean).join(' ') || String(e._id).slice(-6);
    console.log(`     «${nm(p.keep)}» — يبقى ${String(p.keep._id).slice(-6)} (${p.links[0]} ارتباطًا)`
      + ` · يُدمَج ${p.drop.map((d) => String(d._id).slice(-6)).join(', ')}`
      + (Object.keys(p.fill).length ? ` · يُنقَل ${Object.keys(p.fill).length} حقلًا` : ''));
  });

  // ── ٢ · إشعاراتٌ لمستخدمين محذوفين ─────────────────────────────────────────
  const liveUsers = new Set((await User.find({}).select('_id').lean()).map((x) => String(x._id)));
  const notif = await Notification.find({}).select('recipient').lean();
  const deadNotif = notif.filter((n) => n.recipient && !liveUsers.has(String(n.recipient))).map((n) => n._id);
  console.log(`\n  ٢ · إشعاراتٌ لمستخدمين محذوفين: ${deadNotif.length} من ${notif.length}`);

  // ── ٣ · حساباتُ دخولٍ تشير إلى موظّفٍ محذوف ────────────────────────────────
  const liveEmp = new Set(all.map((e) => String(e._id)));
  const users = await User.find({ employee: { $ne: null } }).select('employee email').lean();
  const brokenLinks = users.filter((u) => !liveEmp.has(String(u.employee)));
  console.log(`\n  ٣ · حساباتُ دخولٍ مرتبطةٌ بموظّفٍ محذوف: ${brokenLinks.length}`);
  brokenLinks.slice(0, 5).forEach((u) => console.log(`     ${u.email}`));

  if (!APPLY) { console.log('\n  فحصٌ فقط — أضِف --yes للتنفيذ.\n'); await mongoose.disconnect(); return; }

  const dir = path.join(__dirname, '../../backups');
  fs.mkdirSync(dir, { recursive: true });
  const backup = path.join(dir, `auditFix-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(backup, JSON.stringify({
    at: new Date(),
    merged: plans.map((p) => ({ keep: p.keep, drop: p.drop, fill: p.fill })),
    notifications: deadNotif.length,
    brokenLinks,
  }, null, 1));
  console.log(`\n  نسخةٌ محفوظة: ${path.relative(process.cwd(), backup)}`);

  let moved = 0;
  for (const p of plans) {
    for (const d of p.drop) {
      for (const r of REFS) {
        // eslint-disable-next-line no-await-in-loop
        const w = await mongoose.model(r.model).updateMany({ [r.path]: d._id }, { $set: { [r.path]: p.keep._id } });
        moved += w.modifiedCount || 0;
      }
    }
    if (Object.keys(p.fill).length) await Employee.updateOne({ _id: p.keep._id }, { $set: p.fill });
    await Employee.deleteMany({ _id: { $in: p.drop.map((d) => d._id) } });
  }
  console.log(`  دُمج ${plans.length} موظّفًا · نُقل ${moved} ارتباطًا`);

  if (deadNotif.length) {
    const r = await Notification.deleteMany({ _id: { $in: deadNotif } });
    console.log(`  مُسح ${r.deletedCount} إشعارًا لا قارئَ له`);
  }
  if (brokenLinks.length) {
    const r = await User.updateMany({ _id: { $in: brokenLinks.map((u) => u._id) } }, { $unset: { employee: 1 } });
    console.log(`  فُكَّ ربطُ ${r.modifiedCount} حسابًا`);
  }
  console.log('');
  await mongoose.disconnect();
})().catch(async (e) => { console.error(e); try { await mongoose.disconnect(); } catch (_) {} process.exit(1); });
