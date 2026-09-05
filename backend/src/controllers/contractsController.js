const { ContractVendor, VendorUtilisation, ContractProspect, DeptContract } = require('../models/ContractModels');
const { saveUploadFile, deleteStoredFile } = require('../utils/fileStore');
const { emitToAll } = require('../websocket/socketManager');
const cache = require('../utils/ttlCache');

// إدارة العقود — controller. Every mutation broadcasts ONE event and clears the
// dashboard cache, so the analysis screens always show what was just edited.

const emit = () => {
  cache.clear('contracts:');
  try { emitToAll('contracts:updated', {}); } catch (e) { /* socket optional */ }
};

// Arabic-folding join key: hamza forms, ta marbuta, alif maqsura collapse and
// everything non-letter drops. The same vendor is spelled 3+ ways across the
// source sheets; this is what makes them one row.
const nameKey = (s) => String(s || '')
  .replace(/[أإآا]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي')
  .replace(/\bال/g, '')
  .replace(/[^؀-ۿa-zA-Z0-9]/g, '')
  .toLowerCase();
exports.nameKey = nameKey;

const actorName = (req) => `${req.user?.firstName || ''} ${req.user?.lastName || ''}`.trim();

// Signed = both sides signed. The paper trail (documentsReceived) is tracked
// separately — a signed contract with missing docs is the التنبيهات list.
const vendorStatus = (v) => (v.vendorSideContract && v.ourSideContract ? 'signed' : (v.vendorSideContract || v.ourSideContract ? 'pending' : 'unsigned'));

// «أفراد خارجية (بلا عقد)» is spelled differently across the sheets («خارجي -
// افراد» in Q1, bare «خارجي» in April/May) — match any of them on the key.
const EXTERNAL_KEY_RX = /(افراد.*خارجي|خارجي.*افراد|^خارجي$)/;
const isCashType = (t) => /كاش|نقد/.test(String(t || ''));

// ---- Dashboard --------------------------------------------------------------
exports.getDashboard = async (req, res) => {
  try {
    const cached = cache.get('contracts:dashboard');
    if (cached) return res.json(cached);

    const [vendors, prospects, deptContracts, utilMonths, customers] = await Promise.all([
      ContractVendor.find().lean(),
      ContractProspect.find({ convertedVendor: null }).lean(),
      DeptContract.find().lean(),
      VendorUtilisation.aggregate([{ $group: { _id: { year: '$year', month: '$month' }, orders: { $sum: '$orders' } } }, { $sort: { '_id.year': 1, '_id.month': 1 } }]),
      // العملاءُ يُقرآن مع المورّدين: الطرفان في لوحةٍ واحدة، لا سجلٌّ لأحدهما
      // ولوحةٌ للآخر.
      require('../models/ContractModels').ContractCustomer.find().select('-attachments').lean(),
    ]);

    const signed = vendors.filter((v) => vendorStatus(v) === 'signed');
    const byHq = {}; const byRep = {}; const signTrend = {}; const fleetBuckets = { '1-10': 0, '11-25': 0, '26-50': 0, '51-100': 0, '+100': 0 };
    for (const v of signed) {
      byHq[v.headquarters || '—'] = (byHq[v.headquarters || '—'] || 0) + 1;
      byRep[v.energizeRep || '—'] = (byRep[v.energizeRep || '—'] || 0) + 1;
      if (v.contractDate) {
        const k = `${v.contractDate.getFullYear()}-${String(v.contractDate.getMonth() + 1).padStart(2, '0')}`;
        signTrend[k] = (signTrend[k] || 0) + 1;
      }
      const f = v.fleetSize || 0;
      fleetBuckets[f > 100 ? '+100' : f > 50 ? '51-100' : f > 25 ? '26-50' : f > 10 ? '11-25' : '1-10'] += 1;
    }

    const body = {
      vendors: {
        total: vendors.length,
        signed: signed.length,
        pending: vendors.filter((v) => vendorStatus(v) === 'pending').length,
        unsigned: vendors.filter((v) => vendorStatus(v) === 'unsigned').length,
        signedFleet: signed.reduce((s, v) => s + (v.fleetSize || 0), 0),
        totalFleet: vendors.reduce((s, v) => s + (v.fleetSize || 0), 0),
        missingDocs: vendors.filter((v) => vendorStatus(v) === 'signed' && !v.documentsReceived)
          .map((v) => ({ _id: v._id, name: v.name, missingDocuments: v.missingDocuments, energizeRep: v.energizeRep })),
        reps: [...new Set(vendors.map((v) => v.energizeRep).filter(Boolean))].length,
        byHq: Object.entries(byHq).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
        byRep: Object.entries(byRep).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
        signTrend: Object.entries(signTrend).map(([month, count]) => ({ month, count })).sort((a, b) => (a.month < b.month ? -1 : 1)),
        fleetBuckets,
        topByFleet: [...signed].sort((a, b) => (b.fleetSize || 0) - (a.fleetSize || 0)).slice(0, 10)
          .map((v) => ({ _id: v._id, name: v.name, fleetSize: v.fleetSize, energizeRep: v.energizeRep, headquarters: v.headquarters })),
      },
      prospects: {
        total: prospects.length,
        interested: prospects.filter((p) => p.isInterested === true).length,
      },
      // ── والعملاء ────────────────────────────────────────────────────────
      // ثلاثةُ أرقامٍ تُقرأ في ثانية: كم عميلًا، وكم منهم بلا عقدٍ موقَّع، وكم
      // عقدًا يقارب انتهاءه. والأخيرُ هو العملُ: العقدُ يُجدَّد قبل أن ينتهي.
      customers: (() => {
        const signed = customers.filter((c) => c.customerSideContract && c.ourSideContract);
        const soon = Date.now() + 60 * 86400000;
        return {
          total: customers.length,
          signed: signed.length,
          unsigned: customers.length - signed.length,
          missingDocs: signed.filter((c) => !c.documentsReceived).length,
          expiring: customers.filter((c) => c.endDate && new Date(c.endDate).getTime() < soon).length,
          expiringList: customers
            .filter((c) => c.endDate && new Date(c.endDate).getTime() < soon)
            .sort((a, b) => new Date(a.endDate) - new Date(b.endDate))
            .slice(0, 10)
            .map((c) => ({ _id: c._id, name: c.name, endDate: c.endDate, energizeRep: c.energizeRep })),
        };
      })(),
      deptContracts: {
        total: deptContracts.length,
        byDepartment: ['3pl', 'fleet', 'b2c', 'other'].map((d) => ({ department: d, count: deptContracts.filter((c) => c.department === d).length })),
        expiringSoon: deptContracts.filter((c) => c.status === 'active' && c.endDate && c.endDate > new Date() && c.endDate < new Date(Date.now() + 60 * 86400000)).length,
      },
      utilisationMonths: utilMonths.map((m) => ({ year: m._id.year, month: m._id.month, orders: m.orders })),
    };
    cache.set('contracts:dashboard', body, 15000);
    res.json(body);
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
};

// ---- Vendors ----------------------------------------------------------------
exports.listVendors = async (req, res) => {
  try {
    // `attachments` are base64 contract files — fetching them for the whole list
    // was ~5s. The list never shows file bytes (the profile does), so exclude
    // them (and profileTables), and cache under the 'contracts:' prefix that
    // vendor writes already clear.
    const vendors = await cache.wrap('contracts:vendors-list', 20000, () =>
      ContractVendor.find().select('-profileTables -attachments').sort({ name: 1 }).lean());
    res.json({ vendors: vendors.map((v) => ({ ...v, status: vendorStatus(v) })) });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
};

const VENDOR_FIELDS = [
  'name', 'energizeRep', 'operationsRep', 'vendorType', 'contactPerson', 'phone', 'headquarters',
  'destinations', 'coverage', 'fleetSize', 'vehicleTypes', 'avgMonthlyLoadsPerVehicle', 'monthlyCapacity',
  'crNumber', 'vendorSideContract', 'ourSideContract', 'documentsReceived', 'missingDocuments',
  'contractDate', 'renewalPolicy', 'paymentTermDays', 'pricingNotes', 'operationalStatus',
  'followUpNotes', 'notes', 'rating', 'ratingNotes',
];

exports.createVendor = async (req, res) => {
  try {
    const name = String(req.body.name || '').trim();
    if (!name) return res.status(400).json({ message: 'اسم المورد مطلوب' });
    const key = nameKey(name);
    const exists = await ContractVendor.findOne({ nameKey: key });
    if (exists) return res.status(409).json({ message: `المورد مسجل بالفعل باسم «${exists.name}»` });
    const doc = { nameKey: key, createdBy: req.user?._id };
    for (const f of VENDOR_FIELDS) if (req.body[f] !== undefined) doc[f] = req.body[f];
    if (doc.fleetSize && !doc.monthlyCapacity) doc.monthlyCapacity = doc.fleetSize * (doc.avgMonthlyLoadsPerVehicle || 15);
    const vendor = await ContractVendor.create(doc);
    // Link any pre-existing utilisation rows entered under this name.
    await VendorUtilisation.updateMany({ nameKey: key }, { $set: { vendor: vendor._id } });
    emit();
    res.status(201).json({ vendor });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
};

exports.getVendor = async (req, res) => {
  try {
    const vendor = await ContractVendor.findById(req.params.id).lean();
    if (!vendor) return res.status(404).json({ message: 'المورد غير موجود' });
    const utilisation = await VendorUtilisation.find({ nameKey: vendor.nameKey }).sort({ year: 1, month: 1 }).lean();
    res.json({ vendor: { ...vendor, status: vendorStatus(vendor) }, utilisation });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
};

exports.updateVendor = async (req, res) => {
  try {
    const vendor = await ContractVendor.findById(req.params.id);
    if (!vendor) return res.status(404).json({ message: 'المورد غير موجود' });
    for (const f of VENDOR_FIELDS) if (req.body[f] !== undefined) vendor[f] = req.body[f];
    if (req.body.name) {
      const key = nameKey(req.body.name);
      const clash = await ContractVendor.findOne({ nameKey: key, _id: { $ne: vendor._id } });
      if (clash) return res.status(409).json({ message: `الاسم مستخدم بالفعل للمورد «${clash.name}»` });
      const oldKey = vendor.nameKey;
      vendor.nameKey = key;
      if (oldKey !== key) await VendorUtilisation.updateMany({ nameKey: oldKey }, { $set: { nameKey: key, vendorName: vendor.name } });
    }
    await vendor.save();
    emit();
    res.json({ vendor });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
};

exports.deleteVendor = async (req, res) => {
  try {
    const vendor = await ContractVendor.findByIdAndDelete(req.params.id);
    if (!vendor) return res.status(404).json({ message: 'المورد غير موجود' });
    for (const a of vendor.attachments || []) deleteStoredFile(a.fileUrl);
    // التاريخ التشغيلي يبقى — الأرقام الشهرية حقيقة تاريخية لا تُمحى بحذف السجل.
    await VendorUtilisation.updateMany({ vendor: vendor._id }, { $set: { vendor: null } });
    emit();
    res.json({ message: 'Deleted' });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
};

// ---- Attachments (shared by vendors + dept contracts) ----------------------
const addAttachment = (Model, subdir) => async (req, res) => {
  try {
    const doc = await Model.findById(req.params.id);
    if (!doc) return res.status(404).json({ message: 'غير موجود' });
    const { dataUrl, fileName = '', title = '' } = req.body;
    const stored = saveUploadFile(dataUrl, subdir, fileName);
    doc.attachments.push({ ...stored, title, uploadedByName: actorName(req) });
    await doc.save();
    emit();
    res.status(201).json({ attachments: doc.attachments });
  } catch (e) {
    res.status(400).json({ message: e.message });
  }
};
const removeAttachment = (Model) => async (req, res) => {
  try {
    const doc = await Model.findById(req.params.id);
    if (!doc) return res.status(404).json({ message: 'غير موجود' });
    const att = doc.attachments.id(req.params.attId);
    if (!att) return res.status(404).json({ message: 'المرفق غير موجود' });
    deleteStoredFile(att.fileUrl);
    att.deleteOne();
    await doc.save();
    emit();
    res.json({ attachments: doc.attachments });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
};
exports.addVendorAttachment = addAttachment(ContractVendor, 'contracts');
exports.removeVendorAttachment = removeAttachment(ContractVendor);
exports.addDeptContractAttachment = addAttachment(DeptContract, 'contracts');
exports.removeDeptContractAttachment = removeAttachment(DeptContract);

// ---- Utilisation ------------------------------------------------------------
exports.listUtilisation = async (req, res) => {
  try {
    const { year, month } = req.query;
    const filter = {};
    if (year) filter.year = Number(year);
    if (month) filter.month = Number(month);
    const rows = await VendorUtilisation.find(filter).sort({ year: 1, month: 1, orders: -1 }).lean();
    res.json({ rows });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
};

// Manual month entry / correction — upsert by (vendor, year, month), so typing
// this month's number for a vendor immediately re-ranks every analysis screen.
exports.upsertUtilisation = async (req, res) => {
  try {
    const { vendorName, year, month, orders = 0, fleetSize, avgMonthlyLoadsPerVehicle, vendorType = '', hasContract, operationsRep = '', isExternal = false } = req.body;
    if (!vendorName || !year || !month) return res.status(400).json({ message: 'اسم المورد والسنة والشهر مطلوبة' });
    let key = nameKey(vendorName);
    let name = vendorName;
    const external = !!isExternal || EXTERNAL_KEY_RX.test(key);
    if (external) { key = 'افرادخارجيهبلاعقد'; name = 'أفراد خارجية (بلا عقد)'; }
    const vendor = external ? null : await ContractVendor.findOne({ nameKey: key }).lean();
    const fleet = fleetSize ?? vendor?.fleetSize ?? 0;
    const avg = avgMonthlyLoadsPerVehicle ?? vendor?.avgMonthlyLoadsPerVehicle ?? 15;
    const row = await VendorUtilisation.findOneAndUpdate(
      { nameKey: key, year: Number(year), month: Number(month) },
      {
        $set: {
          vendor: vendor?._id || null, vendorName: vendor?.name || name,
          orders: Number(orders) || 0, fleetSize: fleet,
          expectedMonthlyCapacity: fleet * avg,
          vendorType: vendorType || vendor?.vendorType || '',
          hasContract: hasContract ?? (vendor ? (vendor.vendorSideContract && vendor.ourSideContract) : false),
          operationsRep: operationsRep || vendor?.operationsRep || '',
          isExternal: external,
        },
      },
      { new: true, upsert: true }
    );
    emit();
    res.json({ row });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
};

exports.deleteUtilisation = async (req, res) => {
  try {
    const row = await VendorUtilisation.findByIdAndDelete(req.params.id);
    if (!row) return res.status(404).json({ message: 'غير موجود' });
    emit();
    res.json({ message: 'Deleted' });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
};

// ---- Analysis ---------------------------------------------------------------
// GET /analysis?from=2026-01&to=2026-03 — everything the quarterly report the
// department used to build by hand computes, live from the stored rows.
exports.getAnalysis = async (req, res) => {
  try {
    const parse = (s, dYear, dMonth) => {
      const m = /^(\d{4})-(\d{1,2})$/.exec(String(s || ''));
      return m ? { year: +m[1], month: +m[2] } : { year: dYear, month: dMonth };
    };
    const now = new Date();
    const from = parse(req.query.from, now.getFullYear(), 1);
    const to = parse(req.query.to, now.getFullYear(), now.getMonth() + 1);
    const cacheKey = `contracts:analysis:${from.year}-${from.month}:${to.year}-${to.month}`;
    const cached = cache.get(cacheKey);
    if (cached) return res.json(cached);

    const lo = from.year * 100 + from.month, hi = to.year * 100 + to.month;
    const all = await VendorUtilisation.find().lean();
    const rows = all.filter((r) => { const k = r.year * 100 + r.month; return k >= lo && k <= hi; });
    const months = [...new Set(rows.map((r) => `${r.year}-${String(r.month).padStart(2, '0')}`))].sort();

    const catOf = (r) => (r.isExternal ? 'external' : r.hasContract ? 'signed' : isCashType(r.vendorType) ? 'cash' : 'credit');
    const total = rows.reduce((s, r) => s + r.orders, 0);
    const byCat = { signed: 0, credit: 0, cash: 0, external: 0 };
    const byCatVendors = { signed: new Set(), credit: new Set(), cash: new Set() };
    for (const r of rows) {
      const c = catOf(r);
      byCat[c] += r.orders;
      if (c !== 'external') byCatVendors[c].add(r.nameKey);
    }

    // Per-vendor aggregation across the window.
    const byVendor = new Map();
    for (const r of rows) {
      if (!byVendor.has(r.nameKey)) byVendor.set(r.nameKey, { nameKey: r.nameKey, vendorName: r.vendorName, vendor: r.vendor, category: catOf(r), vendorType: r.vendorType, fleetSize: r.fleetSize, months: {}, totalOrders: 0 });
      const v = byVendor.get(r.nameKey);
      v.months[`${r.year}-${String(r.month).padStart(2, '0')}`] = r.orders;
      v.totalOrders += r.orders;
      v.fleetSize = Math.max(v.fleetSize, r.fleetSize || 0);
      if (catOf(r) === 'signed') v.category = 'signed';
    }
    const vendorsArr = [...byVendor.values()].sort((a, b) => b.totalOrders - a.totalOrders);

    // Wasted capacity: signed vendors with a real fleet whose utilisation is
    // near zero — the "طاقة مهدرة" review list.
    const monthCount = Math.max(months.length, 1);
    const wasted = vendorsArr
      .filter((v) => v.category === 'signed' && v.fleetSize >= 10)
      .map((v) => {
        const capacity = v.fleetSize * 15 * monthCount;
        return { ...v, capacity, utilisation: capacity ? v.totalOrders / capacity : 0 };
      })
      .filter((v) => v.utilisation < 0.05)
      .sort((a, b) => a.utilisation - b.utilisation)
      .slice(0, 30);

    // Movers: first month vs last month inside the window.
    const first = months[0], last = months[months.length - 1];
    const movers = vendorsArr
      .map((v) => ({ vendorName: v.vendorName, nameKey: v.nameKey, category: v.category, from: v.months[first] || 0, to: v.months[last] || 0, delta: (v.months[last] || 0) - (v.months[first] || 0) }))
      .filter((v) => v.delta !== 0);
    const growth = [...movers].sort((a, b) => b.delta - a.delta).slice(0, 8);
    const decline = [...movers].sort((a, b) => a.delta - b.delta).slice(0, 8);

    // Rep performance (operationsRep on the rows).
    const byRep = new Map();
    for (const r of rows) {
      if (!r.operationsRep || r.isExternal) continue;
      if (!byRep.has(r.operationsRep)) byRep.set(r.operationsRep, { rep: r.operationsRep, orders: 0, vendors: new Set(), signedVendors: new Set() });
      const x = byRep.get(r.operationsRep);
      x.orders += r.orders;
      x.vendors.add(r.nameKey);
      if (r.hasContract) x.signedVendors.add(r.nameKey);
    }
    const reps = [...byRep.values()]
      .map((x) => ({ rep: x.rep, orders: x.orders, vendors: x.vendors.size, signed: x.signedVendors.size }))
      .sort((a, b) => b.orders - a.orders);

    // Stability: active every month vs entered/left inside the window.
    const activeIn = (m) => new Set(rows.filter((r) => `${r.year}-${String(r.month).padStart(2, '0')}` === m && !r.isExternal && r.orders > 0).map((r) => r.nameKey));
    const firstSet = activeIn(first), lastSet = activeIn(last);
    const allSets = months.map(activeIn);
    const stableAll = [...(allSets[0] || new Set())].filter((k) => allSets.every((s) => s.has(k))).length;
    const stability = {
      uniqueVendors: new Set(rows.filter((r) => !r.isExternal).map((r) => r.nameKey)).size,
      stableAllMonths: stableAll,
      newInLast: [...lastSet].filter((k) => !firstSet.has(k)).length,
      stoppedAfterFirst: [...firstSet].filter((k) => !lastSet.has(k)).length,
    };

    // Monthly trend by category.
    const trend = months.map((m) => {
      const mr = rows.filter((r) => `${r.year}-${String(r.month).padStart(2, '0')}` === m);
      const t = mr.reduce((s, r) => s + r.orders, 0);
      const cat = { signed: 0, credit: 0, cash: 0, external: 0 };
      mr.forEach((r) => { cat[catOf(r)] += r.orders; });
      return { month: m, total: t, ...cat };
    });

    const body = {
      window: { from, to, months },
      totals: { orders: total, byCategory: byCat, categoryVendorCounts: { signed: byCatVendors.signed.size, credit: byCatVendors.credit.size, cash: byCatVendors.cash.size }, uniqueVendors: stability.uniqueVendors },
      trend,
      topVendors: vendorsArr.slice(0, 20),
      topByCategory: {
        signed: vendorsArr.filter((v) => v.category === 'signed').slice(0, 12),
        credit: vendorsArr.filter((v) => v.category === 'credit').slice(0, 12),
        cash: vendorsArr.filter((v) => v.category === 'cash').slice(0, 12),
      },
      wastedCapacity: wasted,
      movers: { growth, decline },
      reps,
      stability,
    };
    cache.set(cacheKey, body, 15000);
    res.json(body);
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
};

// ---- Prospects --------------------------------------------------------------
const PROSPECT_FIELDS = ['companyName', 'contactPerson', 'phone', 'headquarters', 'destinations', 'vehicleType', 'interestStatus', 'isInterested', 'contactDate', 'assignedTo', 'notes'];

exports.listProspects = async (req, res) => {
  try {
    const prospects = await ContractProspect.find().sort({ contactDate: -1, createdAt: -1 }).lean();
    res.json({ prospects });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
};

exports.createProspect = async (req, res) => {
  try {
    const companyName = String(req.body.companyName || '').trim();
    if (!companyName) return res.status(400).json({ message: 'اسم الشركة مطلوب' });
    const doc = { nameKey: nameKey(companyName) };
    for (const f of PROSPECT_FIELDS) if (req.body[f] !== undefined) doc[f] = req.body[f];
    const prospect = await ContractProspect.create(doc);
    emit();
    res.status(201).json({ prospect });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
};

exports.updateProspect = async (req, res) => {
  try {
    const prospect = await ContractProspect.findById(req.params.id);
    if (!prospect) return res.status(404).json({ message: 'غير موجود' });
    for (const f of PROSPECT_FIELDS) if (req.body[f] !== undefined) prospect[f] = req.body[f];
    if (req.body.companyName) prospect.nameKey = nameKey(req.body.companyName);
    await prospect.save();
    emit();
    res.json({ prospect });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
};

exports.deleteProspect = async (req, res) => {
  try {
    const p = await ContractProspect.findByIdAndDelete(req.params.id);
    if (!p) return res.status(404).json({ message: 'غير موجود' });
    emit();
    res.json({ message: 'Deleted' });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
};

// ترقية شركة من سجل التنشيط إلى مورد فعلي — بياناتها تنتقل كما هي ويُختم السجل.
exports.convertProspect = async (req, res) => {
  try {
    const p = await ContractProspect.findById(req.params.id);
    if (!p) return res.status(404).json({ message: 'غير موجود' });
    if (p.convertedVendor) return res.status(400).json({ message: 'تم تحويلها بالفعل' });
    const key = nameKey(p.companyName);
    let vendor = await ContractVendor.findOne({ nameKey: key });
    if (!vendor) {
      vendor = await ContractVendor.create({
        name: p.companyName, nameKey: key,
        contactPerson: p.contactPerson, phone: p.phone,
        headquarters: p.headquarters, destinations: p.destinations,
        vehicleTypes: p.vehicleType, notes: p.notes,
        createdBy: req.user?._id,
      });
    }
    p.convertedVendor = vendor._id;
    await p.save();
    emit();
    res.json({ vendor, prospect: p });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
};

// ---- Dept contracts ---------------------------------------------------------
const DEPT_FIELDS = ['department', 'partyType', 'partyName', 'contactPerson', 'phone', 'email', 'subject', 'contractDate', 'startDate', 'endDate', 'renewalPolicy', 'paymentTermDays', 'value', 'status', 'notes'];

exports.listDeptContracts = async (req, res) => {
  try {
    const filter = {};
    if (req.query.department) filter.department = req.query.department;
    const contracts = await DeptContract.find(filter).sort({ contractDate: -1, createdAt: -1 }).lean();
    res.json({ contracts });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
};

exports.createDeptContract = async (req, res) => {
  try {
    if (!req.body.partyName || !req.body.department || !req.body.partyType) {
      return res.status(400).json({ message: 'القسم والطرف واسم الجهة مطلوبة' });
    }
    const doc = { createdBy: req.user?._id, createdByName: actorName(req) };
    for (const f of DEPT_FIELDS) if (req.body[f] !== undefined) doc[f] = req.body[f];
    const contract = await DeptContract.create(doc);
    emit();
    res.status(201).json({ contract });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
};

exports.updateDeptContract = async (req, res) => {
  try {
    const contract = await DeptContract.findById(req.params.id);
    if (!contract) return res.status(404).json({ message: 'العقد غير موجود' });
    for (const f of DEPT_FIELDS) if (req.body[f] !== undefined) contract[f] = req.body[f];
    await contract.save();
    emit();
    res.json({ contract });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
};

exports.deleteDeptContract = async (req, res) => {
  try {
    const contract = await DeptContract.findByIdAndDelete(req.params.id);
    if (!contract) return res.status(404).json({ message: 'العقد غير موجود' });
    for (const a of contract.attachments || []) deleteStoredFile(a.fileUrl);
    emit();
    res.json({ message: 'Deleted' });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
};

// ══════════════════════════════════════════════════════════════════════════════
// العملاء — الطرفُ الآخر من كلّ صفقة
// ══════════════════════════════════════════════════════════════════════════════
//
// ── وما الجديدُ فيه ──────────────────────────────────────────────────────────
// القسمُ كان يعرف نصفَ عمله: المورّدون بعقودهم ووثائقهم وحصصهم في سجلٍّ كامل،
// والعملاءُ بلا سجلٍّ إلّا صفوفًا في «عقود الأقسام» تُبحَث بالاسم. فسؤالُ كلّ
// أسبوع — «فلانٌ عقدُه موقَّعٌ وإلى متى؟» — لا جوابَ له إلّا في ورقة.
//
// ── والربطُ بالباقي ─────────────────────────────────────────────────────────
// الصفُّ هنا يحمل ما يخصّ العقدَ وحدَه؛ وما عداه يُقرأ من مصدره في كلّ نداء ولا
// يُنسَخ:
//   • ما يشحنه معنا فعلًا  ← كشوفُ التشغيل (عددًا وقيمةً وآخرَ شحنة)
//   • ما بقي عليه          ← طرفُ التحصيل (مهلتُه المتّفق عليها ورصيدُه)
//   • عقودُه المرفوعة       ← «عقود الأقسام» بنوع طرفٍ «عميل»
// ورقمٌ منسوخٌ يشيخ في يومه، ورقمٌ مقروءٌ من مصدره لا يكذب أبدًا.
const { ContractCustomer } = require('../models/ContractModels');

const customerStatus = (c) => (c.customerSideContract && c.ourSideContract
  ? 'signed'
  : (c.customerSideContract || c.ourSideContract ? 'pending' : 'unsigned'));

/** ينتهي خلال ستّين يومًا — العقدُ يُجدَّد قبل أن ينتهي لا بعده. */
const EXPIRY_WINDOW_DAYS = 60;
const expiryState = (endDate) => {
  if (!endDate) return '';
  const days = Math.floor((new Date(endDate).getTime() - Date.now()) / 86400000);
  if (days < 0) return 'expired';
  return days <= EXPIRY_WINDOW_DAYS ? 'due' : 'valid';
};

/**
 * حجمُ العملاء من كشوف التشغيل — عددًا وقيمةً وآخرَ شحنة، مطويًّا بالاسم.
 *
 * تُحسَب مرّةً لكلّ العملاء لا لكلّ صفّ: ستُّمئةِ استعلامٍ لصفحةٍ واحدةٍ تجعلها
 * تُفتَح في ثوانٍ ثمّ لا تُفتَح.
 */
async function customerVolume() {
  return cache.wrap('contracts:customer-volume', 60000, async () => {
    const OperationsWorkflow = require('../models/OperationsWorkflow');
    const rows = await OperationsWorkflow.aggregate([
      { $match: { applicationStatus: { $ne: 'cancelled' }, username: { $nin: [null, ''] } } },
      {
        $group: {
          _id: '$username',
          loads: { $sum: 1 },
          value: { $sum: { $ifNull: ['$sellingValue', 0] } },
          last: { $max: '$reportDate' },
        },
      },
    ]);
    const out = {};
    for (const r of rows) {
      const k = nameKey(r._id);
      if (!k) continue;
      if (!out[k]) out[k] = { loads: 0, value: 0, last: null, names: [] };
      out[k].loads += r.loads;
      out[k].value += r.value;
      if (!out[k].last || (r.last && new Date(r.last) > new Date(out[k].last))) out[k].last = r.last;
      out[k].names.push(r._id);
    }
    return out;
  });
}

/** أطرافُ التحصيل من نوع «عميل» — المهلةُ المتّفق عليها ورصيدُ ما بقي. */
async function collectionsByKey() {
  return cache.wrap('contracts:customer-collections', 60000, async () => {
    try {
      const CollectionsParty = require('../models/CollectionsParty');
      const rows = await CollectionsParty.find({ kind: 'customer' })
        .select('name nameKey paymentTerms creditLimit collectionOfficer').lean();
      const out = {};
      for (const r of rows) out[nameKey(r.name)] = r;
      return out;
    } catch (_) { return {}; }
  });
}

exports.listCustomers = async (req, res) => {
  try {
    const [customers, volume, coll, agreements] = await Promise.all([
      ContractCustomer.find().select('-attachments').sort({ name: 1 }).lean(),
      customerVolume(),
      collectionsByKey(),
      DeptContract.find({ partyType: 'customer' }).select('partyName status endDate').lean(),
    ]);

    const agreementsByKey = {};
    for (const a of agreements) {
      const k = nameKey(a.partyName);
      (agreementsByKey[k] = agreementsByKey[k] || []).push(a);
    }

    res.json({
      customers: customers.map((c) => {
        const v = volume[c.nameKey] || null;
        const p = coll[c.nameKey] || null;
        return {
          ...c,
          status: customerStatus(c),
          expiry: expiryState(c.endDate),
          loads: v?.loads || 0,
          value: Math.round((v?.value || 0) * 100) / 100,
          lastLoad: v?.last || null,
          collectionsTerms: p?.paymentTerms || '',
          collectionOfficer: p?.collectionOfficer || '',
          agreements: (agreementsByKey[c.nameKey] || []).length,
        };
      }),
    });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
};

/**
 * عملاءُ يشحنون معنا ولا صفَّ لهم هنا — GET /customers/suggestions
 *
 * السجلُّ يبدأ فارغًا، وملؤه بالكتابة اليدويّة من ورقةٍ يعني أن يبقى ناقصًا إلى
 * الأبد. والعملاءُ معروفون: هم مَن تحمل كشوفُنا أسماءهم. فتُعرَض أسماؤهم مرتّبةً
 * بحجمهم — الأكبرُ أوّلًا، فهو مَن يُسأل عن عقده أوّلًا — ويُضاف من يُختار بضغطة.
 */
exports.customerSuggestions = async (req, res) => {
  try {
    const [existing, volume] = await Promise.all([
      ContractCustomer.find().select('nameKey').lean(),
      customerVolume(),
    ]);
    const have = new Set(existing.map((c) => c.nameKey));
    const rows = Object.entries(volume)
      .filter(([k]) => !have.has(k))
      .map(([k, v]) => ({
        nameKey: k,
        // أطولُ الأسماء المكتوبة: الصيغُ المختصرةُ تسقط الشركةَ ونوعَها.
        name: v.names.sort((a, b) => b.length - a.length)[0],
        loads: v.loads,
        value: Math.round(v.value * 100) / 100,
        lastLoad: v.last,
      }))
      .sort((a, b) => b.loads - a.loads)
      .slice(0, 200);
    res.json({ suggestions: rows });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
};

const CUSTOMER_FIELDS = [
  'name', 'sector', 'customerType', 'contactPerson', 'phone', 'email', 'headquarters',
  'energizeRep', 'crNumber', 'taxNumber',
  'customerSideContract', 'ourSideContract', 'documentsReceived', 'missingDocuments',
  'contractDate', 'startDate', 'endDate', 'renewalPolicy', 'paymentTermDays',
  'pricingNotes', 'operationalStatus', 'followUpNotes', 'notes',
];

exports.createCustomer = async (req, res) => {
  try {
    const name = String(req.body.name || '').trim();
    if (!name) return res.status(400).json({ message: 'اسم العميل مطلوب' });
    const key = nameKey(name);
    const exists = await ContractCustomer.findOne({ nameKey: key });
    // الاسمُ المطويُّ هو الذي يمنع الصفَّ الثاني: «شركة الرياض» و«الرياض» صفٌّ
    // واحدٌ في الواقع، وصفّان في سجلٍّ يقارن الحروف.
    if (exists) return res.status(409).json({ message: `العميل مسجل بالفعل باسم «${exists.name}»` });
    const doc = { nameKey: key, createdBy: req.user?._id, createdByName: actorName(req) };
    for (const f of CUSTOMER_FIELDS) if (req.body[f] !== undefined) doc[f] = req.body[f];
    const customer = await ContractCustomer.create(doc);
    emit();
    res.status(201).json({ customer });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
};

exports.getCustomer = async (req, res) => {
  try {
    const customer = await ContractCustomer.findById(req.params.id).lean();
    if (!customer) return res.status(404).json({ message: 'العميل غير موجود' });

    const OperationsWorkflow = require('../models/OperationsWorkflow');
    const [volume, coll, agreements] = await Promise.all([
      customerVolume(),
      collectionsByKey(),
      DeptContract.find({ partyType: 'customer' }).lean(),
    ]);

    // شهورُه الاثنا عشر الأخيرة — العقدُ يُراجَع على منحنًى لا على رقمٍ واحد.
    const since = new Date();
    since.setMonth(since.getMonth() - 12);
    const monthly = await OperationsWorkflow.aggregate([
      { $match: { applicationStatus: { $ne: 'cancelled' }, reportDate: { $gte: since } } },
      { $project: { username: 1, reportDate: 1, sellingValue: 1, fromLocation: 1, toLocation: 1 } },
      {
        $group: {
          _id: { y: { $year: '$reportDate' }, m: { $month: '$reportDate' }, u: '$username' },
          loads: { $sum: 1 },
          value: { $sum: { $ifNull: ['$sellingValue', 0] } },
        },
      },
      { $sort: { '_id.y': 1, '_id.m': 1 } },
    ]);
    const mine = monthly.filter((r) => nameKey(r._id.u) === customer.nameKey);
    const byMonth = {};
    for (const r of mine) {
      const k = `${r._id.y}-${String(r._id.m).padStart(2, '0')}`;
      byMonth[k] = byMonth[k] || { month: k, loads: 0, value: 0 };
      byMonth[k].loads += r.loads;
      byMonth[k].value += r.value;
    }

    res.json({
      customer: { ...customer, status: customerStatus(customer), expiry: expiryState(customer.endDate) },
      volume: volume[customer.nameKey] || { loads: 0, value: 0, last: null, names: [] },
      collections: coll[customer.nameKey] || null,
      agreements: agreements.filter((a) => nameKey(a.partyName) === customer.nameKey),
      monthly: Object.values(byMonth).sort((a, b) => a.month.localeCompare(b.month)),
    });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
};

exports.updateCustomer = async (req, res) => {
  try {
    const customer = await ContractCustomer.findById(req.params.id);
    if (!customer) return res.status(404).json({ message: 'العميل غير موجود' });
    for (const f of CUSTOMER_FIELDS) if (req.body[f] !== undefined) customer[f] = req.body[f];
    // تغييرُ الاسم يغيّر مفتاحَ الربط معه، وإلّا انقطع الصفُّ عن كشوفه.
    if (req.body.name !== undefined) customer.nameKey = nameKey(req.body.name);
    await customer.save();
    emit();
    res.json({ customer });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
};

exports.deleteCustomer = async (req, res) => {
  try {
    const customer = await ContractCustomer.findByIdAndDelete(req.params.id);
    if (!customer) return res.status(404).json({ message: 'العميل غير موجود' });
    emit();
    res.json({ message: 'حُذف العميل' });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
};

exports.addCustomerAttachment = addAttachment(ContractCustomer, 'contracts');
exports.removeCustomerAttachment = removeAttachment(ContractCustomer);
