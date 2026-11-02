/**
 * Sales/relations customers missing from the customer register (ShipmentOrderCustomer), since sales now opens that register.
 * Matches by externalId first, then by folded name (not literal; names carry odd spaces and hamza variants).
 * Dry run by default; --apply adds only active customers, --include-leads adds all. Add-only.
 * node src/scripts/auditSalesCustomersVsRegister.js [--apply] [--include-leads] [--list]
 */
require('dotenv').config({ quiet: true });
const mongoose = require('mongoose');

(async () => {
  const apply = process.argv.includes('--apply');
  const includeLeads = process.argv.includes('--include-leads');
  const list = process.argv.includes('--list');
  // A dry run builds no index and creates no collection: pure read.
  await mongoose.connect(process.env.MONGODB_URI, apply ? {} : { autoIndex: false, autoCreate: false });

  const CrmCompany = require('../models/CrmCompany');
  const CrmDeal = require('../models/CrmDeal');
  const ShipmentOrderCustomer = require('../models/ShipmentOrderCustomer');
  const { fold } = require('../models/CollectionsParty');

  const [companies, register, dealCompanies] = await Promise.all([
    CrmCompany.find({}).select('name arabicName status type phone email city address notes externalId externalSource').lean(),
    ShipmentOrderCustomer.find({}).select('name externalId isActive').lean(),
    CrmDeal.distinct('company', { company: { $ne: null } }),
  ]);
  const withDeals = new Set(dealCompanies.map(String));

  const byKey = new Map();
  const byExt = new Map();
  for (const c of register) {
    const k = fold(c.name);
    if (k) byKey.set(k, c);
    if (c.externalId) byExt.set(String(c.externalId), c);
  }

  const matched = { byId: 0, byName: 0 };
  const missing = [];
  const blank = [];
  for (const co of companies) {
    if (co.externalId && byExt.has(String(co.externalId))) { matched.byId += 1; continue; }
    const keys = [fold(co.arabicName), fold(co.name)].filter(Boolean);
    if (!keys.length) { blank.push(co); continue; }
    if (keys.some((k) => byKey.has(k))) { matched.byName += 1; continue; }
    missing.push(co);
  }

  const count = (rows, f) => rows.reduce((m, r) => { const k = f(r) || '—'; m[k] = (m[k] || 0) + 1; return m; }, {});
  console.log('\n══ عملاء المبيعات/العلاقات مقابل سجلّ العملاء ══');
  console.log(`شركاتُ العلاقات (CrmCompany): ${companies.length}`);
  console.log(`سجلُّ العملاء (ShipmentOrderCustomer): ${register.length}`);
  console.log(`مطابَقةٌ بمعرّف المنصّة: ${matched.byId} · مطابَقةٌ بالاسم المطويّ: ${matched.byName}`);
  console.log(`بلا اسمٍ يُطابَق به: ${blank.length}`);
  console.log(`غيرُ موجودةٍ في السجلّ: ${missing.length}`);
  console.log('  حسب الحالة:', JSON.stringify(count(missing, (r) => r.status)));
  console.log('  حسب النوع:', JSON.stringify(count(missing, (r) => r.type)));
  console.log('  حسب المصدر:', JSON.stringify(count(missing, (r) => r.externalSource || 'يدويّ')));
  console.log(`  منها لها صفقات: ${missing.filter((r) => withDeals.has(String(r._id))).length}`);

  const eligible = missing.filter((r) => includeLeads || r.status === 'active');
  console.log(`\nما تضيفه --apply${includeLeads ? ' --include-leads' : ' (النشطون وحدَهم)'}: ${eligible.length}`);
  const sample = list ? missing : missing.slice(0, 15);
  if (sample.length) console.log(list ? 'القائمةُ كاملةً:' : 'عيّنة (أضف --list للقائمة كاملةً):');
  for (const r of sample) {
    console.log(`  • ${r.arabicName || r.name}${r.arabicName && r.name && r.arabicName !== r.name ? ` (${r.name})` : ''} — ${r.status}/${r.type || '—'}${r.externalId ? ` — منصّة #${r.externalId}` : ''}`);
  }

  if (!apply) {
    console.log('\nتجربة — لم يُكتب شيء. أعد التشغيل بـ --apply للإضافة.');
    await mongoose.disconnect();
    return;
  }

  let added = 0;
  for (const co of eligible) {
    // The Arabic name is what is written on statements; the English one is the fallback.
    const name = String(co.arabicName || co.name || '').replace(/\s+/g, ' ').trim();
    if (!name) continue;
    // Second read before writing, so two consecutive runs do not add a customer twice.
    const k = fold(name);
    if (byKey.has(k)) continue;
    const doc = await ShipmentOrderCustomer.create({
      name, phone: co.phone || '', email: co.email || '', city: co.city || '', address: co.address || '',
      notes: co.notes || '', externalId: co.externalId || '', isActive: co.status !== 'inactive' && co.status !== 'churned',
    });
    byKey.set(k, doc);
    added += 1;
  }
  console.log(`\nأُضيف إلى السجلّ: ${added}`);
  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
