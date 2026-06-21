const mongoose = require('mongoose');
const User = require('../models/User');
const Vendor = require('../models/Vendor');
const PurchaseRequest = require('../models/PurchaseRequest');
const PurchaseOrder = require('../models/PurchaseOrder');
const VendorBill = require('../models/VendorBill');
const procurementDefaults = require('../config/procurementDefaults');
const { CODES } = require('../config/accountingDefaults');
const { accountIdsByCode, postJournalEntry, reverseSource, round2 } = require('../utils/accountingPoster');
const { createNotification } = require('../services/notificationService');
const { emitToUser, emitToAll } = require('../websocket/socketManager');

// ── Roles / helpers ──────────────────────────────────────────────────────────
const STAFF = ['super_admin', 'admin', 'procurement_manager', 'purchasing'];
const MANAGERS = ['super_admin', 'admin', 'procurement_manager'];
const isStaff = (u) => STAFF.includes(u.role);
const isManager = (u) => MANAGERS.includes(u.role);
const denyNonStaff = (req, res) => { if (!isStaff(req.user)) { res.status(403).json({ message: 'Insufficient permissions' }); return true; } return false; };
const denyNonManager = (req, res) => { if (!isManager(req.user)) { res.status(403).json({ message: 'Only procurement managers can perform this action' }); return true; } return false; };
const badId = (id, res) => { if (!mongoose.isValidObjectId(id)) { res.status(400).json({ message: 'Invalid id' }); return true; } return false; };
const emit = (event, payload = {}) => { try { emitToAll(event, payload); } catch (e) {} };

const managerIds = async () => {
  const u = await User.find({ role: { $in: MANAGERS }, isActive: true }).select('_id').lean();
  return u.map((x) => x._id);
};
const notifyManagers = async ({ title, message, relatedEntity, relatedEntityId, event }) => {
  const ids = await managerIds();
  await Promise.all(ids.map((rid) => createNotification({ recipient: rid, type: 'system_alert', title, message, relatedEntity, relatedEntityId }).catch(() => {})));
  if (event) ids.forEach((rid) => { try { emitToUser(String(rid), event, { id: String(relatedEntityId || '') }); } catch (e) {} });
};

const seq = async (Model, prefix) => `${prefix}-${String((await Model.estimatedDocumentCount()) + 1).padStart(6, '0')}`;
const lineTotals = (items = []) => items.map((l) => ({
  description: l.description, quantity: Number(l.quantity) || 0, unitPrice: Number(l.unitPrice) || 0,
  total: round2((Number(l.quantity) || 0) * (Number(l.unitPrice) || 0)),
}));
const sumLines = (items = []) => round2(items.reduce((s, l) => s + (l.total || 0), 0));

// ── Options & dashboard ──────────────────────────────────────────────────────
exports.getOptions = async (req, res) => {
  try {
    if (denyNonStaff(req, res)) return;
    const { activeByType } = require('./lookupController');
    const [vendors, categories] = await Promise.all([
      Vendor.find({}).select('name companyName vendorName').sort({ name: 1 }).limit(500).lean(),
      activeByType('procurement_category'),
    ]);
    // Categories are now editable lookups; fall back to the static config if the
    // lookup collection hasn't been seeded yet.
    const CATEGORIES = categories.length ? categories : procurementDefaults.CATEGORIES;
    res.json({ ...procurementDefaults, CATEGORIES, vendors });
  } catch (error) {
    console.error('getOptions error:', error);
    res.status(500).json({ message: 'Failed to load options' });
  }
};

exports.getDashboard = async (req, res) => {
  try {
    if (denyNonStaff(req, res)) return;
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const [prPending, openPOs, unpaid, spendMonth] = await Promise.all([
      PurchaseRequest.countDocuments({ status: 'pending_approval' }),
      PurchaseOrder.aggregate([{ $match: { status: { $in: ['draft', 'sent', 'partially_received', 'received'] } } }, { $group: { _id: null, count: { $sum: 1 }, value: { $sum: '$total' } } }]),
      VendorBill.aggregate([{ $match: { status: { $in: ['unpaid', 'partial'] } } }, { $group: { _id: null, total: { $sum: '$balance' } } }]),
      VendorBill.aggregate([{ $match: { billDate: { $gte: startOfMonth } } }, { $group: { _id: null, total: { $sum: '$total' } } }]),
    ]);
    res.json({
      prPending,
      openPOs: openPOs[0]?.count || 0,
      openPOValue: round2(openPOs[0]?.value || 0),
      unpaidBills: round2(unpaid[0]?.total || 0),
      spendThisMonth: round2(spendMonth[0]?.total || 0),
    });
  } catch (error) {
    console.error('getDashboard error:', error);
    res.status(500).json({ message: 'Failed to load dashboard' });
  }
};

// ── Purchase Requests ────────────────────────────────────────────────────────
const popPR = (q) => q.populate('requester', 'firstName lastName').populate('suggestedVendor', 'name companyName vendorName').populate('approval.by', 'firstName lastName').populate('purchaseOrder', 'poNumber');

exports.listPRs = async (req, res) => {
  try {
    if (denyNonStaff(req, res)) return;
    const { status, q, mine } = req.query;
    const filter = {};
    if (status) filter.status = status;
    if (mine === 'true') filter.requester = req.user._id;
    if (q && q.trim()) { const rx = new RegExp(q.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'); filter.$or = [{ title: rx }, { requestNumber: rx }, { department: rx }]; }
    const prs = await popPR(PurchaseRequest.find(filter)).sort({ createdAt: -1 }).limit(500).lean();
    res.json({ requests: prs });
  } catch (error) {
    console.error('listPRs error:', error);
    res.status(500).json({ message: 'Failed to load requests' });
  }
};

exports.createPR = async (req, res) => {
  try {
    if (denyNonStaff(req, res)) return;
    if (!req.body.title || !req.body.title.trim()) return res.status(400).json({ message: 'Title is required' });
    const items = lineTotals(req.body.items);
    const pr = await PurchaseRequest.create({
      requestNumber: await seq(PurchaseRequest, 'PR'),
      title: req.body.title, category: req.body.category, department: req.body.department,
      items, totalEstimate: sumLines(items), justification: req.body.justification,
      neededBy: req.body.neededBy || undefined, priority: req.body.priority || 'medium',
      suggestedVendor: req.body.suggestedVendor || undefined, notes: req.body.notes,
      requester: req.user._id, createdBy: req.user._id,
      status: req.body.status === 'pending_approval' ? 'pending_approval' : 'draft',
    });
    emit('procurement:pr', { id: String(pr._id) });
    if (pr.status === 'pending_approval') await notifyManagers({ title: 'New purchase request', message: pr.title, relatedEntity: 'PurchaseRequest', relatedEntityId: pr._id, event: 'procurement:pr' });
    res.status(201).json({ request: await popPR(PurchaseRequest.findById(pr._id)).lean() });
  } catch (error) {
    console.error('createPR error:', error);
    res.status(500).json({ message: 'Failed to create request' });
  }
};

exports.updatePR = async (req, res) => {
  try {
    if (denyNonStaff(req, res)) return;
    const { id } = req.params; if (badId(id, res)) return;
    const pr = await PurchaseRequest.findById(id);
    if (!pr) return res.status(404).json({ message: 'Request not found' });
    if (['approved', 'ordered'].includes(pr.status)) return res.status(400).json({ message: 'Approved requests cannot be edited' });
    ['title', 'category', 'department', 'justification', 'neededBy', 'priority', 'suggestedVendor', 'notes'].forEach((f) => { if (req.body[f] !== undefined) pr[f] = req.body[f] || undefined; });
    if (req.body.items !== undefined) { pr.items = lineTotals(req.body.items); pr.totalEstimate = sumLines(pr.items); }
    await pr.save();
    emit('procurement:pr', { id: String(id) });
    res.json({ request: await popPR(PurchaseRequest.findById(id)).lean() });
  } catch (error) {
    console.error('updatePR error:', error);
    res.status(500).json({ message: 'Failed to update request' });
  }
};

// Submit a draft for approval.
exports.submitPR = async (req, res) => {
  try {
    if (denyNonStaff(req, res)) return;
    const { id } = req.params; if (badId(id, res)) return;
    const pr = await PurchaseRequest.findById(id);
    if (!pr) return res.status(404).json({ message: 'Request not found' });
    if (pr.status !== 'draft') return res.status(400).json({ message: 'Only drafts can be submitted' });
    pr.status = 'pending_approval'; await pr.save();
    emit('procurement:pr', { id: String(id) });
    await notifyManagers({ title: 'Purchase request submitted', message: pr.title, relatedEntity: 'PurchaseRequest', relatedEntityId: pr._id, event: 'procurement:pr' });
    res.json({ request: await popPR(PurchaseRequest.findById(id)).lean() });
  } catch (error) {
    console.error('submitPR error:', error);
    res.status(500).json({ message: 'Failed to submit request' });
  }
};

// Approve / reject (managers only).
exports.decidePR = async (req, res) => {
  try {
    if (denyNonManager(req, res)) return;
    const { id } = req.params; if (badId(id, res)) return;
    const { decision, note } = req.body;
    if (!['approved', 'rejected'].includes(decision)) return res.status(400).json({ message: 'Invalid decision' });
    const pr = await PurchaseRequest.findById(id);
    if (!pr) return res.status(404).json({ message: 'Request not found' });
    if (pr.status !== 'pending_approval') return res.status(400).json({ message: 'Request is not pending approval' });
    pr.status = decision; pr.approval = { by: req.user._id, at: new Date(), note };
    await pr.save();
    emit('procurement:pr', { id: String(id) });
    if (pr.requester) await createNotification({ recipient: pr.requester, type: 'system_alert', title: `Purchase request ${decision}`, message: pr.title, relatedEntity: 'PurchaseRequest', relatedEntityId: pr._id }).catch(() => {});
    res.json({ request: await popPR(PurchaseRequest.findById(id)).lean() });
  } catch (error) {
    console.error('decidePR error:', error);
    res.status(500).json({ message: 'Failed to decide request' });
  }
};

exports.deletePR = async (req, res) => {
  try {
    if (denyNonManager(req, res)) return;
    const { id } = req.params; if (badId(id, res)) return;
    const pr = await PurchaseRequest.findByIdAndDelete(id);
    if (!pr) return res.status(404).json({ message: 'Request not found' });
    emit('procurement:pr', { id: String(id), deleted: true });
    res.json({ message: 'Request deleted' });
  } catch (error) {
    console.error('deletePR error:', error);
    res.status(500).json({ message: 'Failed to delete request' });
  }
};

// Convert an approved PR into a PO for a vendor.
exports.convertPR = async (req, res) => {
  try {
    if (denyNonStaff(req, res)) return;
    const { id } = req.params; if (badId(id, res)) return;
    const { vendor, vatRate, expectedDate } = req.body;
    if (!vendor || !mongoose.isValidObjectId(vendor)) return res.status(400).json({ message: 'Vendor is required' });
    const pr = await PurchaseRequest.findById(id);
    if (!pr) return res.status(404).json({ message: 'Request not found' });
    if (pr.status !== 'approved') return res.status(400).json({ message: 'Only approved requests can be converted' });
    const items = lineTotals(pr.items);
    const subtotal = sumLines(items);
    const rate = vatRate !== undefined ? Number(vatRate) : 15;
    const vatAmount = round2(subtotal * rate / 100);
    const po = await PurchaseOrder.create({
      poNumber: await seq(PurchaseOrder, 'PO'), vendor, purchaseRequest: pr._id, items,
      subtotal, vatRate: rate, vatAmount, total: round2(subtotal + vatAmount),
      expectedDate: expectedDate || undefined, status: 'draft', approvedBy: req.user._id, createdBy: req.user._id,
    });
    pr.status = 'ordered'; pr.purchaseOrder = po._id; await pr.save();
    emit('procurement:pr', { id: String(pr._id) }); emit('procurement:po', { id: String(po._id) });
    res.status(201).json({ order: await popPO(PurchaseOrder.findById(po._id)).lean() });
  } catch (error) {
    console.error('convertPR error:', error);
    res.status(500).json({ message: 'Failed to convert request' });
  }
};

// ── Purchase Orders ──────────────────────────────────────────────────────────
const popPO = (q) => q.populate('vendor', 'name companyName vendorName').populate('purchaseRequest', 'requestNumber title').populate('createdBy', 'firstName lastName');

const recalcPO = (po) => {
  po.items = lineTotals(po.items);
  po.subtotal = sumLines(po.items);
  po.vatAmount = round2(po.subtotal * (po.vatRate || 0) / 100);
  po.total = round2(po.subtotal + po.vatAmount);
};

exports.listPOs = async (req, res) => {
  try {
    if (denyNonStaff(req, res)) return;
    const { status, q, vendor } = req.query;
    const filter = {};
    if (status) filter.status = status;
    if (vendor && mongoose.isValidObjectId(vendor)) filter.vendor = vendor;
    if (q && q.trim()) { const rx = new RegExp(q.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'); filter.poNumber = rx; }
    const orders = await popPO(PurchaseOrder.find(filter)).sort({ createdAt: -1 }).limit(500).lean();
    res.json({ orders });
  } catch (error) {
    console.error('listPOs error:', error);
    res.status(500).json({ message: 'Failed to load orders' });
  }
};

exports.createPO = async (req, res) => {
  try {
    if (denyNonStaff(req, res)) return;
    if (!req.body.vendor || !mongoose.isValidObjectId(req.body.vendor)) return res.status(400).json({ message: 'Vendor is required' });
    const po = new PurchaseOrder({
      poNumber: await seq(PurchaseOrder, 'PO'), vendor: req.body.vendor, items: req.body.items || [],
      vatRate: req.body.vatRate !== undefined ? Number(req.body.vatRate) : 15, currency: req.body.currency || 'SAR',
      expectedDate: req.body.expectedDate || undefined, notes: req.body.notes, status: req.body.status || 'draft',
      createdBy: req.user._id,
    });
    recalcPO(po);
    await po.save();
    emit('procurement:po', { id: String(po._id) });
    res.status(201).json({ order: await popPO(PurchaseOrder.findById(po._id)).lean() });
  } catch (error) {
    console.error('createPO error:', error);
    res.status(500).json({ message: 'Failed to create order' });
  }
};

exports.updatePO = async (req, res) => {
  try {
    if (denyNonStaff(req, res)) return;
    const { id } = req.params; if (badId(id, res)) return;
    const po = await PurchaseOrder.findById(id);
    if (!po) return res.status(404).json({ message: 'Order not found' });
    if (['billed', 'cancelled'].includes(po.status)) return res.status(400).json({ message: 'This order can no longer be edited' });
    ['vendor', 'expectedDate', 'notes', 'currency', 'status'].forEach((f) => { if (req.body[f] !== undefined) po[f] = req.body[f]; });
    if (req.body.vatRate !== undefined) po.vatRate = Number(req.body.vatRate);
    if (req.body.items !== undefined) po.items = req.body.items;
    recalcPO(po);
    await po.save();
    emit('procurement:po', { id: String(id) });
    res.json({ order: await popPO(PurchaseOrder.findById(id)).lean() });
  } catch (error) {
    console.error('updatePO error:', error);
    res.status(500).json({ message: 'Failed to update order' });
  }
};

exports.receivePO = async (req, res) => {
  try {
    if (denyNonStaff(req, res)) return;
    const { id } = req.params; if (badId(id, res)) return;
    const po = await PurchaseOrder.findById(id);
    if (!po) return res.status(404).json({ message: 'Order not found' });
    po.status = 'received'; po.receivedDate = new Date(); await po.save();
    emit('procurement:po', { id: String(id) });
    res.json({ order: await popPO(PurchaseOrder.findById(id)).lean() });
  } catch (error) {
    console.error('receivePO error:', error);
    res.status(500).json({ message: 'Failed to receive order' });
  }
};

exports.deletePO = async (req, res) => {
  try {
    if (denyNonManager(req, res)) return;
    const { id } = req.params; if (badId(id, res)) return;
    const billed = await VendorBill.countDocuments({ purchaseOrder: id });
    if (billed > 0) return res.status(400).json({ message: 'Order has vendor bills and cannot be deleted' });
    const po = await PurchaseOrder.findByIdAndDelete(id);
    if (!po) return res.status(404).json({ message: 'Order not found' });
    emit('procurement:po', { id: String(id), deleted: true });
    res.json({ message: 'Order deleted' });
  } catch (error) {
    console.error('deletePO error:', error);
    res.status(500).json({ message: 'Failed to delete order' });
  }
};

// ── Vendor Bills (accounts payable) ──────────────────────────────────────────
const popBill = (q) => q.populate('vendor', 'name companyName vendorName').populate('purchaseOrder', 'poNumber').populate('createdBy', 'firstName lastName');

// Post the A/P journal for a bill: Dr Expense + Dr VAT, Cr Accounts Payable.
const postBillJournal = async (bill, userId) => {
  try {
    const map = await accountIdsByCode([CODES.OPEX, CODES.VAT_PAYABLE, CODES.AP]);
    if (!map[CODES.OPEX] || !map[CODES.AP]) return;
    const lines = [{ account: map[CODES.OPEX], debit: bill.subtotal, credit: 0, description: 'Purchase expense' }];
    if (bill.vatAmount > 0 && map[CODES.VAT_PAYABLE]) lines.push({ account: map[CODES.VAT_PAYABLE], debit: bill.vatAmount, credit: 0, description: 'Input VAT' });
    lines.push({ account: map[CODES.AP], debit: 0, credit: bill.total, description: 'Accounts payable' });
    await postJournalEntry({ date: bill.billDate, memo: `Vendor bill ${bill.billNumber}`, lines, source: { type: 'vendorbill', refId: bill._id, auto: true }, createdBy: userId });
    emit('accounting:journal', {});
  } catch (e) { console.error('postBillJournal error:', e.message); }
};
// Post the payment journal: Dr Accounts Payable, Cr Cash.
const postBillPayment = async (bill, amount, userId) => {
  try {
    const map = await accountIdsByCode([CODES.AP, CODES.CASH]);
    if (!map[CODES.AP] || !map[CODES.CASH]) return;
    await postJournalEntry({ date: new Date(), memo: `Payment to vendor — bill ${bill.billNumber}`, lines: [
      { account: map[CODES.AP], debit: round2(amount), credit: 0, description: 'A/P settlement' },
      { account: map[CODES.CASH], debit: 0, credit: round2(amount), description: 'Cash paid' },
    ], source: { type: 'vendorpayment', refId: bill._id, auto: true }, createdBy: userId });
    emit('accounting:journal', {});
  } catch (e) { console.error('postBillPayment error:', e.message); }
};

exports.listBills = async (req, res) => {
  try {
    if (denyNonStaff(req, res)) return;
    const { status, q, vendor } = req.query;
    const filter = {};
    if (status) filter.status = status;
    if (vendor && mongoose.isValidObjectId(vendor)) filter.vendor = vendor;
    if (q && q.trim()) { const rx = new RegExp(q.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'); filter.$or = [{ billNumber: rx }, { vendorInvoiceNumber: rx }]; }
    const bills = await popBill(VendorBill.find(filter)).sort({ createdAt: -1 }).limit(500).lean();
    res.json({ bills });
  } catch (error) {
    console.error('listBills error:', error);
    res.status(500).json({ message: 'Failed to load bills' });
  }
};

exports.createBill = async (req, res) => {
  try {
    if (denyNonStaff(req, res)) return;
    const { vendor, purchaseOrder, subtotal, vatAmount, vendorInvoiceNumber, billDate, dueDate, category, notes } = req.body;
    if (!vendor || !mongoose.isValidObjectId(vendor)) return res.status(400).json({ message: 'Vendor is required' });
    const sub = round2(subtotal); const vat = round2(vatAmount || 0); const total = round2(sub + vat);
    if (total <= 0) return res.status(400).json({ message: 'Bill total must be greater than zero' });
    const bill = await VendorBill.create({
      billNumber: await seq(VendorBill, 'BILL'), vendorInvoiceNumber, vendor, purchaseOrder: purchaseOrder || undefined,
      subtotal: sub, vatAmount: vat, total, balance: total, billDate: billDate || new Date(), dueDate: dueDate || undefined,
      category, notes, status: 'unpaid', createdBy: req.user._id,
    });
    if (purchaseOrder && mongoose.isValidObjectId(purchaseOrder)) await PurchaseOrder.findByIdAndUpdate(purchaseOrder, { status: 'billed' });
    await postBillJournal(bill, req.user._id); // auto-post A/P
    emit('procurement:bill', { id: String(bill._id) });
    res.status(201).json({ bill: await popBill(VendorBill.findById(bill._id)).lean() });
  } catch (error) {
    console.error('createBill error:', error);
    res.status(500).json({ message: 'Failed to create bill' });
  }
};

// Record a payment against a bill (full or partial). Posts the payment journal.
exports.payBill = async (req, res) => {
  try {
    if (denyNonStaff(req, res)) return;
    const { id } = req.params; if (badId(id, res)) return;
    const bill = await VendorBill.findById(id);
    if (!bill) return res.status(404).json({ message: 'Bill not found' });
    if (bill.status === 'paid') return res.status(400).json({ message: 'Bill is already paid' });
    const amount = round2(req.body.amount || bill.balance);
    if (amount <= 0 || amount > bill.balance + 0.001) return res.status(400).json({ message: 'Invalid payment amount' });
    bill.paidAmount = round2(bill.paidAmount + amount);
    bill.balance = round2(bill.total - bill.paidAmount);
    bill.status = bill.balance <= 0.001 ? 'paid' : 'partial';
    if (bill.status === 'paid') bill.paidAt = new Date();
    await bill.save();
    await postBillPayment(bill, amount, req.user._id);
    emit('procurement:bill', { id: String(id) });
    res.json({ bill: await popBill(VendorBill.findById(id)).lean() });
  } catch (error) {
    console.error('payBill error:', error);
    res.status(500).json({ message: 'Failed to record payment' });
  }
};

exports.deleteBill = async (req, res) => {
  try {
    if (denyNonManager(req, res)) return;
    const { id } = req.params; if (badId(id, res)) return;
    const bill = await VendorBill.findByIdAndDelete(id);
    if (!bill) return res.status(404).json({ message: 'Bill not found' });
    // Keep the ledger consistent — remove the auto-posted A/P + payment entries.
    await reverseSource('vendorbill', id);
    await reverseSource('vendorpayment', id);
    emit('procurement:bill', { id: String(id), deleted: true });
    emit('accounting:journal', {});
    res.json({ message: 'Bill deleted' });
  } catch (error) {
    console.error('deleteBill error:', error);
    res.status(500).json({ message: 'Failed to delete bill' });
  }
};
