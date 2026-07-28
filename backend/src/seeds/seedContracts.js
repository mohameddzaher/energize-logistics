/**
 * Seed إدارة العقود from the four source workbooks (data/masters/*.json):
 *   vendors_master_and_utilisation.json — 212-vendor master list + Q1/April/May
 *   vendor_profiles.json                — 29 deep per-vendor profile sheets
 *   prospect_outreach_nariman.json      — 27-company cold-outreach log
 *   vendors_INDEX.json                  — (metadata only, not imported)
 *
 * Idempotent: vendors upsert by nameKey, utilisation by (nameKey, year, month),
 * prospects by nameKey. Data files stay untracked; re-running is safe.
 *
 * Run: node src/seeds/seedContracts.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const mongoose = require('mongoose');
const { ContractVendor, VendorUtilisation, ContractProspect } = require('../models/ContractModels');
const { nameKey } = require('../controllers/contractsController');

const master = require('../data/masters/vendors_master_and_utilisation.json');
const profiles = require('../data/masters/vendor_profiles.json');
const outreach = require('../data/masters/prospect_outreach_nariman.json');

const d = (v) => (v ? new Date(v) : null);
const EXTERNAL_RX = /(افراد.*خارجي|خارجي.*افراد|^خارجي$)/; // «أفراد خارجية» / «خارجي - افراد» / «خارجي»

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected');
  const stats = { vendorsNew: 0, vendorsUpdated: 0, profilesMerged: 0, profilesUnmatched: [], utilRows: 0, prospects: 0 };

  // ---- 1. Vendor master list (the base register) ----------------------------
  for (const r of master.vendorsMasterList.rows) {
    const name = String(r.vendorName || '').trim();
    if (!name) continue;
    const key = nameKey(name);
    if (!key || EXTERNAL_RX.test(key)) continue;
    const doc = {
      name, nameKey: key,
      energizeRep: r.energizeRep || '',
      vendorType: r.vendorType || '',
      contactPerson: r.vendorContact || '',
      phone: r.phone || '',
      headquarters: r.headquarters || '',
      destinations: r.destinations || '',
      fleetSize: Number(r.fleetSize) || 0,
      documentsReceived: !!r.documentsReceived,
      vendorSideContract: !!r.vendorSideContract,
      ourSideContract: !!r.ourSideContract,
      contractDate: d(r.contractDate),
      followUpNotes: r.followUpNotes || '',
      notes: r.notes || '',
    };
    doc.monthlyCapacity = doc.fleetSize * 15;
    const res = await ContractVendor.updateOne({ nameKey: key }, { $setOnInsert: { renewalPolicy: 'تلقائي ما لم يصدر إشعار بعدم الرغبة', paymentTermDays: 30 }, $set: doc }, { upsert: true });
    if (res.upsertedCount) stats.vendorsNew += 1; else stats.vendorsUpdated += 1;
  }

  // ---- 2. Deep profiles merge onto matching vendors -------------------------
  // The profile sheets spell names loosely ("توصيل التجارية - فلو - شركة شخص
  // واحد" vs the master's "شركة توصيل التجارية"), so exact nameKey misses most.
  // Fallback: distinctive-token overlap — legal boilerplate words don't count.
  const fold = (w) => w.replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي').replace(/^وال/, '').replace(/^ال/, '').replace(/^لل/, '');
  // Legal boilerplate — compared AFTER folding, so مؤسسة/المؤسسه/موسسه all stop.
  const STOP = new Set(['شركه', 'موسسه', 'محل', 'محدوده', 'نقليات', 'نقل', 'بري', 'تجاره', 'خدمات', 'لوجستيه', 'لوجيستيه', 'لوچستيه', 'عالميه', 'قابضه', 'ابناء', 'ابن', 'واحد', 'شخص', 'فلو', 'صناعه', 'مقاولات', 'خدمات'].map(fold));
  const tokens = (s) => new Set(String(s || '').split(/[\s\-–—]+/).map(fold).filter((w) => w.length >= 3 && !STOP.has(w)));
  const allVendors = await ContractVendor.find().select('name nameKey').lean();
  const fuzzyFind = (name) => {
    const t = tokens(name);
    if (!t.size) return null;
    let best = null;
    for (const v of allVendors) {
      const vt = tokens(v.name);
      if (!vt.size) continue;
      const inter = [...t].filter((x) => vt.has(x)).length;
      const score = inter / Math.min(t.size, vt.size);
      const cand = { v, score, inter };
      // Higher overlap COUNT wins before ratio — «المناور المحدوده» must not
      // beat «طلال محمد الحربي» just because its distinctive set is tiny.
      if (!best || cand.inter > best.inter || (cand.inter === best.inter && cand.score > best.score)) best = cand;
    }
    if (!best) return null;
    const need = Math.min(t.size, 2);
    return best.score >= 1 && best.inter >= need ? best.v : null;
  };
  for (const p of profiles.vendors) {
    const profileName = String(p.companyName || p.sheetName || '').trim();
    if (!profileName) { stats.profilesUnmatched.push('(بدون اسم)'); continue; }
    const key = nameKey(profileName);
    let vendor = await ContractVendor.findOne({ nameKey: key });
    if (!vendor) {
      const fz = fuzzyFind(profileName);
      if (fz) { vendor = await ContractVendor.findById(fz._id); console.log(`  fuzzy: «${profileName}» → «${fz.name}»`); }
    }
    if (!vendor) {
      // Not in the master list at all (cash/اجل vendors the profiles track
      // anyway) — the register must still know them, so create the row from
      // the profile itself.
      vendor = await ContractVendor.create({
        name: profileName, nameKey: key,
        crNumber: p.crNumber || '',
        headquarters: p.headquarters || '',
        destinations: p.destinations || '',
        vendorType: p.vendorType || '',
        fleetSize: Number(p.fleetSize) || 0,
        monthlyCapacity: Number(p.monthlyCapacity) || (Number(p.fleetSize) || 0) * 15,
        vehicleTypes: p.vehicleTypes || '',
        operationsRep: p.operationsRep || '',
        operationalStatus: p.operationalStatus || '',
        pricingNotes: p.pricing || '',
        contactPerson: (Array.isArray(p.contactNumbers) ? p.contactNumbers.find((x) => /[؀-ۿ]/.test(String(x))) : '') || '',
        phone: (Array.isArray(p.contactNumbers) ? p.contactNumbers.find((x) => /\d{6,}/.test(String(x))) : '') || '',
        vendorSideContract: String(p.contract) === '1',
        ourSideContract: String(p.contract) === '1',
        documentsReceived: String(p.documents) === '1',
        contractDate: p.contractDate ? new Date(p.contractDate) : null,
      });
      allVendors.push({ _id: vendor._id, name: vendor.name, nameKey: vendor.nameKey });
      console.log(`  created from profile: «${profileName}»`);
      stats.vendorsNew += 1;
    }
    const set = {
      crNumber: p.crNumber || vendor.crNumber,
      vehicleTypes: p.vehicleTypes || vendor.vehicleTypes,
      operationsRep: p.operationsRep || vendor.operationsRep,
      operationalStatus: p.operationalStatus || vendor.operationalStatus,
      pricingNotes: p.pricing || vendor.pricingNotes,
      profileTables: p.tables || [],
    };
    if (p.monthlyCapacity) set.monthlyCapacity = Number(p.monthlyCapacity) || vendor.monthlyCapacity;
    if (p.destinations && !vendor.destinations) set.destinations = p.destinations;
    await ContractVendor.updateOne({ _id: vendor._id }, { $set: set });
    stats.profilesMerged += 1;
  }

  // ---- 3. Utilisation rows --------------------------------------------------
  const vendorByKey = new Map((await ContractVendor.find().select('nameKey name').lean()).map((v) => [v.nameKey, v]));
  const upsertRow = async (vendorName, year, month, orders, extra) => {
    // The May sheet carries summary/footer rows ("21.9%", "0.206", section
    // titles) with orders=null — data rows always have a numeric order count.
    if (orders == null || Number.isNaN(Number(orders))) return;
    if (!/[؀-ۿa-zA-Z]/.test(String(vendorName || ''))) return; // numeric junk "1", "0.472"
    let key = nameKey(vendorName);
    if (!key) return;
    // Canonicalise the external-individuals bucket: three spellings across the
    // sheets must land on ONE row per month or the analyses double-count it.
    const isExternal = EXTERNAL_RX.test(key);
    if (isExternal) { key = 'افرادخارجيهبلاعقد'; vendorName = 'أفراد خارجية (بلا عقد)'; }
    const vendor = isExternal ? null : (vendorByKey.get(key) || null);
    await VendorUtilisation.updateOne(
      { nameKey: key, year, month },
      {
        $set: {
          vendor: vendor?._id || null,
          vendorName: vendor?.name || vendorName,
          orders: Number(orders) || 0,
          fleetSize: Number(extra.fleetSize) || 0,
          expectedMonthlyCapacity: Number(extra.expectedMonthlyCapacity) || (Number(extra.fleetSize) || 0) * 15,
          hasContract: !!extra.hasContract,
          vendorType: extra.vendorType || '',
          operationsRep: extra.operationsRep || '',
          isExternal,
        },
      },
      { upsert: true }
    );
    stats.utilRows += 1;
  };

  const MONTHS = { january: 1, february: 2, march: 3 };
  for (const r of master.utilisationQ1_2026.rows) {
    for (const [mName, mNum] of Object.entries(MONTHS)) {
      const orders = r.orders?.[mName];
      if (orders == null) continue;
      await upsertRow(r.vendorName, 2026, mNum, orders, r);
    }
  }
  for (const r of master.utilisationApril2026.rows) await upsertRow(r.vendorName, 2026, 4, r.orders, r);
  for (const r of master.utilisationMay2026.rows) await upsertRow(r.vendorName, 2026, 5, r.orders, r);

  // ---- 4. Prospects ---------------------------------------------------------
  for (const p of outreach.prospects) {
    const companyName = String(p.companyName || '').trim();
    if (!companyName) continue;
    await ContractProspect.updateOne(
      { nameKey: nameKey(companyName) },
      {
        $set: {
          companyName, contactPerson: p.contactPerson || '', phone: p.phone || '',
          headquarters: p.headquarters || '', destinations: p.destinations || '',
          vehicleType: p.vehicleType || '', interestStatus: p.interestStatus || '',
          isInterested: p.isInterested ?? null, contactDate: d(p.contactDate), notes: p.notes || '',
        },
      },
      { upsert: true }
    );
    stats.prospects += 1;
  }

  console.log('Seeded:', JSON.stringify({ ...stats, profilesUnmatched: stats.profilesUnmatched.length }, null, 1));
  if (stats.profilesUnmatched.length) {
    console.log('\nProfiles with no master-list match (imported nothing for these):');
    stats.profilesUnmatched.forEach((n) => console.log(' -', n));
  }
  const counts = {
    vendors: await ContractVendor.countDocuments(),
    utilisation: await VendorUtilisation.countDocuments(),
    prospects: await ContractProspect.countDocuments(),
  };
  console.log('\nDB totals:', counts);
  process.exit(0);
})().catch((e) => { console.error('Seed error:', e); process.exit(1); });
