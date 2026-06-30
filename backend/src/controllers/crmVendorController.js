/**
 * crmVendorController — CRM Vendors (الموردين / carriers we subcontract in 3PL).
 * Self-contained; does not touch CrmCompany or the rest of CRM.
 */
const CrmVendor = require('../models/CrmVendor');
const { emitToAll } = require('../websocket/socketManager');

const FIELDS = [
  'name', 'isNewVendor', 'energizeRep', 'vendorType', 'representative', 'mobile', 'email',
  'destinations', 'headOffice', 'carsCount', 'hasPapers', 'vendorSideSigned',
  'ourSideSigned', 'contractDate', 'followUpStatus', 'notes',
];

const pick = (body) => {
  const out = {};
  FIELDS.forEach((f) => { if (body[f] !== undefined) out[f] = body[f]; });
  return out;
};

exports.list = async (req, res) => {
  try {
    const filter = {};
    const { search, followUpStatus, vendorType, energizeRep, isNew } = req.query;
    if (search && String(search).trim()) {
      const rx = new RegExp(String(search).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ name: rx }, { representative: rx }, { mobile: rx }, { email: rx }, { destinations: rx }, { headOffice: rx }, { energizeRep: rx }, { vendorType: rx }];
    }
    if (followUpStatus) filter.followUpStatus = followUpStatus;
    if (vendorType) filter.vendorType = vendorType;
    if (energizeRep) filter.energizeRep = energizeRep;
    if (isNew === 'true') filter.isNewVendor = true;
    if (isNew === 'false') filter.isNewVendor = false;
    const items = await CrmVendor.find(filter).sort({ name: 1 }).limit(2000).lean();
    res.json({ items, total: items.length });
  } catch (e) {
    console.error('crmVendor list error:', e.message);
    res.status(500).json({ message: 'Failed to load vendors' });
  }
};

// Distinct values to drive the filter dropdowns.
exports.options = async (req, res) => {
  try {
    const [reps, statuses, types, offices] = await Promise.all([
      CrmVendor.distinct('energizeRep'),
      CrmVendor.distinct('followUpStatus'),
      CrmVendor.distinct('vendorType'),
      CrmVendor.distinct('headOffice'),
    ]);
    const clean = (a) => a.filter((x) => x && String(x).trim()).sort();
    res.json({ energizeReps: clean(reps), followUpStatuses: clean(statuses), vendorTypes: clean(types), headOffices: clean(offices) });
  } catch (e) {
    res.status(500).json({ message: 'Failed to load options' });
  }
};

exports.getOne = async (req, res) => {
  try {
    const v = await CrmVendor.findById(req.params.id).lean();
    if (!v) return res.status(404).json({ message: 'Not found' });
    res.json({ vendor: v });
  } catch (e) { res.status(500).json({ message: 'Failed to load vendor' }); }
};

exports.create = async (req, res) => {
  try {
    if (!req.body.name || !String(req.body.name).trim()) return res.status(400).json({ message: 'Name is required' });
    const v = await CrmVendor.create({ ...pick(req.body), createdBy: req.user._id });
    try { emitToAll('crm:vendor', { id: String(v._id) }); } catch (e) {}
    res.status(201).json({ vendor: v });
  } catch (e) {
    console.error('crmVendor create error:', e.message);
    res.status(500).json({ message: 'Failed to create vendor' });
  }
};

exports.update = async (req, res) => {
  try {
    const v = await CrmVendor.findByIdAndUpdate(req.params.id, { $set: pick(req.body) }, { new: true }).lean();
    if (!v) return res.status(404).json({ message: 'Not found' });
    try { emitToAll('crm:vendor', { id: String(req.params.id) }); } catch (e) {}
    res.json({ vendor: v });
  } catch (e) {
    console.error('crmVendor update error:', e.message);
    res.status(500).json({ message: 'Failed to update vendor' });
  }
};

exports.remove = async (req, res) => {
  try {
    await CrmVendor.findByIdAndDelete(req.params.id);
    try { emitToAll('crm:vendor', { id: String(req.params.id), deleted: true }); } catch (e) {}
    res.json({ ok: true });
  } catch (e) {
    console.error('crmVendor remove error:', e.message);
    res.status(500).json({ message: 'Failed to delete vendor' });
  }
};
