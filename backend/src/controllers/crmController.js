const mongoose = require('mongoose');
const User = require('../models/User');
const Customer = require('../models/Customer');
const CrmCompany = require('../models/CrmCompany');
const CrmContact = require('../models/CrmContact');
const CrmActivity = require('../models/CrmActivity');
const CrmTask = require('../models/CrmTask');
const CrmDeal = require('../models/CrmDeal');
const { createNotification } = require('../services/notificationService');
const { emitToUser } = require('../websocket/socketManager');
const crmDefaults = require('../config/crmDefaults');

// ── Roles / helpers ──────────────────────────────────────────────────────────
// Tiered CRM roles: crm_manager (full) > crm_team_lead (delete/reassign) >
// crm_specialist (write, no delete) > crm_agent (entry level). Admin tier
// (manager + team lead) can delete and perform privileged ops.
const { CRM_STAFF_ROLES, CRM_ADMIN_ROLES } = require('../config/constants');
const { grantedBySection } = require('../utils/sectionAccess');
const isCrmStaff = (user) => CRM_STAFF_ROLES.includes(user.role);
// A role the super_admin granted this section to counts as staff too —
// otherwise the grant passes the route gate but the handler still rejects it.
const crmStaffReq = (req) => isCrmStaff(req.user) || grantedBySection(req);
const isCrmAdmin = (user) => CRM_ADMIN_ROLES.includes(user.role);

const denyNonStaff = (req, res) => {
  if (!crmStaffReq(req)) {
    res.status(403).json({ message: 'Insufficient permissions' });
    return true;
  }
  return false;
};
const denyNonAdmin = (req, res) => {
  if (!isCrmAdmin(req.user)) {
    res.status(403).json({ message: 'Only CRM managers can perform this action' });
    return true;
  }
  return false;
};

const badId = (id, res) => {
  if (!mongoose.isValidObjectId(id)) {
    res.status(400).json({ message: 'Invalid id' });
    return true;
  }
  return false;
};

// Realtime fan-out to every active CRM user so their open lists refresh.
// Sales staff ride along: their dashboard/pipeline/performance pages subscribe
// to crm:deal — restricting the fan-out to CRM roles left them permanently stale.
const crmStaffIds = async () => {
  const roles = [...new Set([...CRM_STAFF_ROLES, 'sales_manager', 'sales_rep'])];
  const staff = await User.find({ role: { $in: roles }, isActive: true }).select('_id').lean();
  return staff.map((s) => s._id);
};
const emitCrm = async (event, payload = {}) => {
  try {
    const ids = await crmStaffIds();
    ids.forEach((rid) => { try { emitToUser(String(rid), event, payload); } catch (e) {} });
  } catch (e) {}
};
const notifyUser = async (userId, { title, message, relatedEntity, relatedEntityId, event }) => {
  if (!userId) return;
  await createNotification({ recipient: userId, type: 'system_alert', title, message, relatedEntity, relatedEntityId }).catch(() => {});
  if (event) { try { emitToUser(String(userId), event, { id: String(relatedEntityId || '') }); } catch (e) {} }
};

// Apply only the provided fields onto a document (skip undefined).
const applyFields = (doc, body, fields) => {
  for (const f of fields) if (body[f] !== undefined) doc[f] = body[f];
};

// ── Populate helpers ─────────────────────────────────────────────────────────
const popCompany = (q) => q
  .populate('owner', 'firstName lastName email')
  .populate('linkedCustomer', 'companyName customerNumber')
  .populate('createdBy', 'firstName lastName');
const popContact = (q) => q
  .populate('company', 'name arabicName')
  .populate('owner', 'firstName lastName');
const popActivity = (q) => q
  .populate('company', 'name arabicName')
  .populate('contact', 'firstName lastName')
  .populate('deal', 'title')
  .populate('createdBy', 'firstName lastName');
const popTask = (q) => q
  .populate('company', 'name arabicName')
  .populate('contact', 'firstName lastName')
  .populate('deal', 'title')
  .populate('assignedTo', 'firstName lastName email')
  .populate('createdBy', 'firstName lastName');
const popDeal = (q) => q
  .populate('company', 'name arabicName phone email')
  .populate('contact', 'firstName lastName phone email')
  .populate('owner', 'firstName lastName email')
  .populate('createdBy', 'firstName lastName');

// ── Options ──────────────────────────────────────────────────────────────────
exports.getOptions = async (req, res) => {
  try {
    if (denyNonStaff(req, res)) return;
    const { activeByType } = require('./lookupController');
    const [owners, industries, sources, companyTypes, companySizes] = await Promise.all([
      User.find({ role: { $in: CRM_STAFF_ROLES }, isActive: true })
        .select('firstName lastName email role').sort({ firstName: 1 }).lean(),
      activeByType('crm_industry'),
      activeByType('crm_source'),
      activeByType('crm_company_type'),
      activeByType('crm_company_size'),
    ]);
    // Descriptive classification lists are editable lookups now; fall back to the
    // static config until the lookup collection is seeded.
    res.json({
      ...crmDefaults,
      INDUSTRIES: industries.length ? industries : crmDefaults.INDUSTRIES,
      SOURCES: sources.length ? sources : crmDefaults.SOURCES,
      COMPANY_TYPES: companyTypes.length ? companyTypes : crmDefaults.COMPANY_TYPES,
      COMPANY_SIZES: companySizes.length ? companySizes : crmDefaults.COMPANY_SIZES,
      owners,
    });
  } catch (error) {
    console.error('getOptions error:', error);
    res.status(500).json({ message: 'Failed to load options' });
  }
};

// ── Dashboard ────────────────────────────────────────────────────────────────
exports.getDashboard = async (req, res) => {
  try {
    if (denyNonStaff(req, res)) return;
    // Dashboard data is identical for every staff viewer, so cache it briefly: a
    // burst of concurrent loads (and the socket-driven reloads) then share one
    // computation instead of each hitting the high-latency cluster.
    const cache = require('../utils/ttlCache');
    const _ck = `dash:crm:${JSON.stringify(req.query)}`;
    const _hit = cache.get(_ck);
    if (_hit !== undefined) return res.json(_hit);
    const _send = res.json.bind(res);
    res.json = (b) => { if (res.statusCode < 300) cache.set(_ck, b, 12000); return _send(b); };
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endOfDay = new Date(startOfDay.getTime() + 86400000);
    // Start of the current week (Saturday → Friday, matching local business week).
    const startOfWeek = new Date(startOfDay);
    startOfWeek.setDate(startOfWeek.getDate() - ((startOfWeek.getDay() + 1) % 7));

    const [
      companiesTotal, companiesByStatus, contactsTotal,
      openDeals, dealsByStage, wonThisMonth, lostThisMonth,
      openTasks, overdueTasks, tasksDueToday,
      activitiesThisWeek, activitiesByType,
      recentActivities, topCompanies,
      topDeals, upcomingTasks, recentDeals,
    ] = await Promise.all([
      CrmCompany.countDocuments({}),
      CrmCompany.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
      CrmContact.countDocuments({}),
      CrmDeal.find({ status: 'open' }).select('value stage').lean(),
      CrmDeal.aggregate([
        { $match: { status: 'open' } },
        { $group: { _id: '$stage', count: { $sum: 1 }, value: { $sum: '$value' } } },
      ]),
      CrmDeal.aggregate([
        { $match: { status: 'won', wonAt: { $gte: startOfMonth } } },
        { $group: { _id: null, count: { $sum: 1 }, value: { $sum: '$value' } } },
      ]),
      CrmDeal.aggregate([
        { $match: { status: 'lost', lostAt: { $gte: startOfMonth } } },
        { $group: { _id: null, count: { $sum: 1 }, value: { $sum: '$value' } } },
      ]),
      CrmTask.countDocuments({ status: { $in: ['todo', 'in_progress'] } }),
      CrmTask.countDocuments({ status: { $in: ['todo', 'in_progress'] }, dueDate: { $lt: startOfDay } }),
      CrmTask.countDocuments({ status: { $in: ['todo', 'in_progress'] }, dueDate: { $gte: startOfDay, $lt: endOfDay } }),
      CrmActivity.countDocuments({ date: { $gte: startOfWeek } }),
      CrmActivity.aggregate([
        { $match: { date: { $gte: startOfWeek } } },
        { $group: { _id: '$type', count: { $sum: 1 } } },
      ]),
      popActivity(CrmActivity.find({}).sort({ date: -1 }).limit(10)).lean(),
      popCompany(CrmCompany.find({}).sort({ rating: -1, score: -1 }).limit(5)).lean(),
      // Largest open opportunities (clickable to the deals page).
      popDeal(CrmDeal.find({ status: 'open' }).sort({ value: -1 }).limit(5)).lean(),
      // Next tasks due (open, soonest due date first).
      popTask(CrmTask.find({ status: { $in: ['todo', 'in_progress'] }, dueDate: { $gte: startOfDay } })
        .sort({ dueDate: 1 }).limit(6)).lean(),
      // Latest deals created/updated.
      popDeal(CrmDeal.find({}).sort({ updatedAt: -1 }).limit(5)).lean(),
    ]);

    const pipelineValue = openDeals.reduce((s, d) => s + (d.value || 0), 0);
    const won = wonThisMonth[0] || { count: 0, value: 0 };
    const lost = lostThisMonth[0] || { count: 0, value: 0 };
    const closedThisMonth = won.count + lost.count;
    // Win rate = won / (won + lost) closed this month, as a 0–100 percentage.
    const winRate = closedThisMonth ? Math.round((won.count / closedThisMonth) * 100) : 0;

    res.json({
      companiesTotal,
      companiesByStatus: companiesByStatus.reduce((a, x) => ({ ...a, [x._id || 'unknown']: x.count }), {}),
      contactsTotal,
      openDealsCount: openDeals.length,
      pipelineValue,
      dealsByStage: dealsByStage.reduce((a, x) => ({ ...a, [x._id || 'new']: { count: x.count, value: x.value } }), {}),
      wonThisMonth: won,
      lostThisMonth: lost,
      winRate,
      activitiesThisWeek,
      activitiesByType: activitiesByType.reduce((a, x) => ({ ...a, [x._id || 'note']: x.count }), {}),
      openTasks,
      overdueTasks,
      tasksDueToday,
      recentActivities,
      topCompanies,
      topDeals,
      upcomingTasks,
      recentDeals,
    });
  } catch (error) {
    console.error('getDashboard error:', error);
    res.status(500).json({ message: 'Failed to load dashboard' });
  }
};

// ── Companies ────────────────────────────────────────────────────────────────
const COMPANY_FIELDS = [
  'name', 'arabicName', 'status', 'type', 'rating', 'score', 'industry', 'size',
  'website', 'phone', 'whatsapp', 'email', 'address', 'city', 'country',
  'source', 'tags', 'owner', 'linkedCustomer', 'notes',
];

exports.listCompanies = async (req, res) => {
  try {
    if (denyNonStaff(req, res)) return;
    const { q, status, type, owner, minRating, tag } = req.query;
    const filter = {};
    if (status) filter.status = status;
    if (type) filter.type = type;
    if (owner && mongoose.isValidObjectId(owner)) filter.owner = owner;
    if (minRating) filter.rating = { $gte: Number(minRating) };
    if (tag) filter.tags = tag;
    if (q && q.trim()) {
      const rx = new RegExp(q.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ name: rx }, { arabicName: rx }, { email: rx }, { phone: rx }, { city: rx }, { industry: rx }];
    }
    const runQuery = () => Promise.all([
      popCompany(CrmCompany.find(filter)).sort({ updatedAt: -1 }).limit(2000).lean(),
      CrmCompany.countDocuments(filter),
    ]);
    // Cache the common team-load (no search term); live-typed searches skip cache.
    // CrmCompany writes clear 'crm:companies' via the model post-hooks.
    let companies, total;
    if (q && q.trim()) {
      [companies, total] = await runQuery();
    } else {
      const cache = require('../utils/ttlCache');
      const ck = `crm:companies:${status || ''}:${type || ''}:${owner || ''}:${minRating || ''}:${tag || ''}`;
      [companies, total] = await cache.wrap(ck, 20000, runQuery);
    }
    res.json({ companies, total });
  } catch (error) {
    console.error('listCompanies error:', error);
    res.status(500).json({ message: 'Failed to load companies' });
  }
};

exports.getCompany = async (req, res) => {
  try {
    if (denyNonStaff(req, res)) return;
    const { id } = req.params;
    if (badId(id, res)) return;
    const company = await popCompany(CrmCompany.findById(id)).lean();
    if (!company) return res.status(404).json({ message: 'Company not found' });

    const [contacts, activities, tasks, deals] = await Promise.all([
      popContact(CrmContact.find({ company: id })).sort({ isPrimary: -1, createdAt: -1 }).lean(),
      popActivity(CrmActivity.find({ company: id })).sort({ date: -1 }).limit(100).lean(),
      popTask(CrmTask.find({ company: id })).sort({ dueDate: 1, createdAt: -1 }).lean(),
      popDeal(CrmDeal.find({ company: id })).sort({ createdAt: -1 }).lean(),
    ]);
    res.json({ company, contacts, activities, tasks, deals });
  } catch (error) {
    console.error('getCompany error:', error);
    res.status(500).json({ message: 'Failed to load company' });
  }
};

exports.createCompany = async (req, res) => {
  try {
    if (denyNonStaff(req, res)) return;
    if (!req.body.name || !req.body.name.trim()) return res.status(400).json({ message: 'Company name is required' });
    const data = { createdBy: req.user._id };
    COMPANY_FIELDS.forEach((f) => { if (req.body[f] !== undefined) data[f] = req.body[f]; });
    if (!data.owner) data.owner = req.user._id;
    const company = await CrmCompany.create(data);
    await emitCrm('crm:company', { id: String(company._id) });
    const full = await popCompany(CrmCompany.findById(company._id)).lean();
    res.status(201).json({ company: full });
  } catch (error) {
    console.error('createCompany error:', error);
    res.status(500).json({ message: 'Failed to create company' });
  }
};

exports.updateCompany = async (req, res) => {
  try {
    if (denyNonStaff(req, res)) return;
    const { id } = req.params;
    if (badId(id, res)) return;
    const company = await CrmCompany.findById(id);
    if (!company) return res.status(404).json({ message: 'Company not found' });
    applyFields(company, req.body, COMPANY_FIELDS);
    await company.save();
    await emitCrm('crm:company', { id: String(id) });
    const full = await popCompany(CrmCompany.findById(id)).lean();
    res.json({ company: full });
  } catch (error) {
    console.error('updateCompany error:', error);
    res.status(500).json({ message: 'Failed to update company' });
  }
};

exports.deleteCompany = async (req, res) => {
  try {
    if (denyNonAdmin(req, res)) return;
    const { id } = req.params;
    if (badId(id, res)) return;
    const company = await CrmCompany.findById(id);
    if (!company) return res.status(404).json({ message: 'Company not found' });
    // Cascade: remove the company's contacts, activities, tasks and deals.
    await Promise.all([
      CrmContact.deleteMany({ company: id }),
      CrmActivity.deleteMany({ company: id }),
      CrmTask.deleteMany({ company: id }),
      CrmDeal.deleteMany({ company: id }),
    ]);
    await company.deleteOne();
    await emitCrm('crm:company', { id: String(id), deleted: true });
    res.json({ message: 'Company deleted' });
  } catch (error) {
    console.error('deleteCompany error:', error);
    res.status(500).json({ message: 'Failed to delete company' });
  }
};

// Quick star-rating update (used by the inline star widget).
exports.rateCompany = async (req, res) => {
  try {
    if (denyNonStaff(req, res)) return;
    const { id } = req.params;
    if (badId(id, res)) return;
    const rating = Math.max(0, Math.min(5, Number(req.body.rating) || 0));
    const company = await CrmCompany.findByIdAndUpdate(id, { rating }, { new: true });
    if (!company) return res.status(404).json({ message: 'Company not found' });
    await emitCrm('crm:company', { id: String(id) });
    res.json({ company });
  } catch (error) {
    console.error('rateCompany error:', error);
    res.status(500).json({ message: 'Failed to rate company' });
  }
};

// Logistics customers available to link (hybrid). Lightweight search.
exports.searchCustomers = async (req, res) => {
  try {
    if (denyNonStaff(req, res)) return;
    const { q } = req.query;
    const filter = {};
    if (q && q.trim()) {
      const rx = new RegExp(q.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ companyName: rx }, { customerNumber: rx }, { phone: rx }, { email: rx }];
    }
    const customers = await Customer.find(filter)
      .select('companyName customerNumber phone email contactPerson')
      .sort({ companyName: 1 }).limit(20).lean();
    res.json({ customers });
  } catch (error) {
    console.error('searchCustomers error:', error);
    res.status(500).json({ message: 'Failed to search customers' });
  }
};

// ── Contacts ─────────────────────────────────────────────────────────────────
const CONTACT_FIELDS = [
  'company', 'firstName', 'lastName', 'arabicName', 'title', 'department',
  'email', 'phone', 'mobile', 'whatsapp', 'linkedinUrl', 'isPrimary', 'rating', 'tags', 'owner', 'notes',
];

exports.listContacts = async (req, res) => {
  try {
    if (denyNonStaff(req, res)) return;
    const { q, company } = req.query;
    const filter = {};
    if (company && mongoose.isValidObjectId(company)) filter.company = company;
    if (q && q.trim()) {
      const rx = new RegExp(q.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ firstName: rx }, { lastName: rx }, { arabicName: rx }, { email: rx }, { phone: rx }, { mobile: rx }, { title: rx }];
    }
    const contacts = await popContact(CrmContact.find(filter)).sort({ updatedAt: -1 }).limit(500).lean();
    res.json({ contacts });
  } catch (error) {
    console.error('listContacts error:', error);
    res.status(500).json({ message: 'Failed to load contacts' });
  }
};

exports.createContact = async (req, res) => {
  try {
    if (denyNonStaff(req, res)) return;
    if (!req.body.firstName || !req.body.firstName.trim()) return res.status(400).json({ message: 'First name is required' });
    const data = { createdBy: req.user._id };
    CONTACT_FIELDS.forEach((f) => { if (req.body[f] !== undefined) data[f] = req.body[f]; });
    if (!data.owner) data.owner = req.user._id;
    // Only one primary per company.
    if (data.isPrimary && data.company) await CrmContact.updateMany({ company: data.company }, { isPrimary: false });
    const contact = await CrmContact.create(data);
    await emitCrm('crm:contact', { id: String(contact._id) });
    const full = await popContact(CrmContact.findById(contact._id)).lean();
    res.status(201).json({ contact: full });
  } catch (error) {
    console.error('createContact error:', error);
    res.status(500).json({ message: 'Failed to create contact' });
  }
};

exports.updateContact = async (req, res) => {
  try {
    if (denyNonStaff(req, res)) return;
    const { id } = req.params;
    if (badId(id, res)) return;
    const contact = await CrmContact.findById(id);
    if (!contact) return res.status(404).json({ message: 'Contact not found' });
    applyFields(contact, req.body, CONTACT_FIELDS);
    if (req.body.isPrimary && contact.company) {
      await CrmContact.updateMany({ company: contact.company, _id: { $ne: id } }, { isPrimary: false });
    }
    await contact.save();
    await emitCrm('crm:contact', { id: String(id) });
    const full = await popContact(CrmContact.findById(id)).lean();
    res.json({ contact: full });
  } catch (error) {
    console.error('updateContact error:', error);
    res.status(500).json({ message: 'Failed to update contact' });
  }
};

exports.deleteContact = async (req, res) => {
  try {
    if (denyNonStaff(req, res)) return;
    const { id } = req.params;
    if (badId(id, res)) return;
    const contact = await CrmContact.findByIdAndDelete(id);
    if (!contact) return res.status(404).json({ message: 'Contact not found' });
    await emitCrm('crm:contact', { id: String(id), deleted: true });
    res.json({ message: 'Contact deleted' });
  } catch (error) {
    console.error('deleteContact error:', error);
    res.status(500).json({ message: 'Failed to delete contact' });
  }
};

// ── Activities ───────────────────────────────────────────────────────────────
const ACTIVITY_FIELDS = ['type', 'subject', 'body', 'company', 'contact', 'deal', 'direction', 'outcome', 'date', 'durationMinutes'];

exports.listActivities = async (req, res) => {
  try {
    if (denyNonStaff(req, res)) return;
    const { q, company, contact, deal, type, from, to } = req.query;
    const filter = {};
    if (company && mongoose.isValidObjectId(company)) filter.company = company;
    if (contact && mongoose.isValidObjectId(contact)) filter.contact = contact;
    if (deal && mongoose.isValidObjectId(deal)) filter.deal = deal;
    if (type) filter.type = type;
    if (from || to) {
      filter.date = {};
      if (from) filter.date.$gte = new Date(from);
      if (to) filter.date.$lte = new Date(to);
    }
    if (q && q.trim()) {
      const rx = new RegExp(q.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ subject: rx }, { body: rx }];
    }
    const activities = await popActivity(CrmActivity.find(filter)).sort({ date: -1 }).limit(500).lean();
    res.json({ activities });
  } catch (error) {
    console.error('listActivities error:', error);
    res.status(500).json({ message: 'Failed to load activities' });
  }
};

exports.createActivity = async (req, res) => {
  try {
    if (denyNonStaff(req, res)) return;
    if (!req.body.subject || !req.body.subject.trim()) return res.status(400).json({ message: 'Subject is required' });
    const data = { createdBy: req.user._id };
    ACTIVITY_FIELDS.forEach((f) => { if (req.body[f] !== undefined) data[f] = req.body[f]; });
    const activity = await CrmActivity.create(data);
    await emitCrm('crm:activity', { id: String(activity._id) });
    const full = await popActivity(CrmActivity.findById(activity._id)).lean();
    res.status(201).json({ activity: full });
  } catch (error) {
    console.error('createActivity error:', error);
    res.status(500).json({ message: 'Failed to create activity' });
  }
};

exports.updateActivity = async (req, res) => {
  try {
    if (denyNonStaff(req, res)) return;
    const { id } = req.params;
    if (badId(id, res)) return;
    const activity = await CrmActivity.findById(id);
    if (!activity) return res.status(404).json({ message: 'Activity not found' });
    applyFields(activity, req.body, ACTIVITY_FIELDS);
    await activity.save();
    await emitCrm('crm:activity', { id: String(id) });
    const full = await popActivity(CrmActivity.findById(id)).lean();
    res.json({ activity: full });
  } catch (error) {
    console.error('updateActivity error:', error);
    res.status(500).json({ message: 'Failed to update activity' });
  }
};

exports.deleteActivity = async (req, res) => {
  try {
    if (denyNonStaff(req, res)) return;
    const { id } = req.params;
    if (badId(id, res)) return;
    const activity = await CrmActivity.findByIdAndDelete(id);
    if (!activity) return res.status(404).json({ message: 'Activity not found' });
    await emitCrm('crm:activity', { id: String(id), deleted: true });
    res.json({ message: 'Activity deleted' });
  } catch (error) {
    console.error('deleteActivity error:', error);
    res.status(500).json({ message: 'Failed to delete activity' });
  }
};

// ── Tasks ────────────────────────────────────────────────────────────────────
const TASK_FIELDS = ['title', 'description', 'company', 'contact', 'deal', 'assignedTo', 'dueDate', 'dueTime', 'priority', 'status'];

exports.listTasks = async (req, res) => {
  try {
    if (denyNonStaff(req, res)) return;
    const { q, status, priority, assignedTo, company, deal, mine, from, to } = req.query;
    const filter = {};
    if (status) filter.status = status;
    if (priority) filter.priority = priority;
    if (mine === 'true') filter.assignedTo = req.user._id;
    else if (assignedTo && mongoose.isValidObjectId(assignedTo)) filter.assignedTo = assignedTo;
    if (company && mongoose.isValidObjectId(company)) filter.company = company;
    if (deal && mongoose.isValidObjectId(deal)) filter.deal = deal;
    if (from || to) {
      filter.dueDate = {};
      if (from) filter.dueDate.$gte = new Date(from);
      if (to) filter.dueDate.$lte = new Date(to);
    }
    if (q && q.trim()) {
      const rx = new RegExp(q.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ title: rx }, { description: rx }];
    }
    const tasks = await popTask(CrmTask.find(filter)).sort({ status: 1, dueDate: 1, createdAt: -1 }).limit(500).lean();
    res.json({ tasks });
  } catch (error) {
    console.error('listTasks error:', error);
    res.status(500).json({ message: 'Failed to load tasks' });
  }
};

exports.createTask = async (req, res) => {
  try {
    if (denyNonStaff(req, res)) return;
    if (!req.body.title || !req.body.title.trim()) return res.status(400).json({ message: 'Task title is required' });
    const data = { createdBy: req.user._id };
    TASK_FIELDS.forEach((f) => { if (req.body[f] !== undefined) data[f] = req.body[f]; });
    if (!data.assignedTo) data.assignedTo = req.user._id;
    const task = await CrmTask.create(data);
    await emitCrm('crm:task', { id: String(task._id) });
    // Notify the assignee (unless they assigned it to themselves).
    if (String(data.assignedTo) !== String(req.user._id)) {
      await notifyUser(data.assignedTo, {
        title: 'New CRM task assigned',
        message: task.title,
        relatedEntity: 'CrmTask',
        relatedEntityId: task._id,
        event: 'crm:task',
      });
    }
    const full = await popTask(CrmTask.findById(task._id)).lean();
    res.status(201).json({ task: full });
  } catch (error) {
    console.error('createTask error:', error);
    res.status(500).json({ message: 'Failed to create task' });
  }
};

exports.updateTask = async (req, res) => {
  try {
    if (denyNonStaff(req, res)) return;
    const { id } = req.params;
    if (badId(id, res)) return;
    const task = await CrmTask.findById(id);
    if (!task) return res.status(404).json({ message: 'Task not found' });
    const prevAssignee = String(task.assignedTo || '');
    applyFields(task, req.body, TASK_FIELDS);
    if (req.body.status !== undefined) {
      task.completedAt = req.body.status === 'done' ? new Date() : undefined;
    }
    await task.save();
    await emitCrm('crm:task', { id: String(id) });
    // Notify on re-assignment.
    if (req.body.assignedTo && String(req.body.assignedTo) !== prevAssignee && String(req.body.assignedTo) !== String(req.user._id)) {
      await notifyUser(req.body.assignedTo, {
        title: 'CRM task assigned to you',
        message: task.title,
        relatedEntity: 'CrmTask',
        relatedEntityId: task._id,
        event: 'crm:task',
      });
    }
    const full = await popTask(CrmTask.findById(id)).lean();
    res.json({ task: full });
  } catch (error) {
    console.error('updateTask error:', error);
    res.status(500).json({ message: 'Failed to update task' });
  }
};

exports.deleteTask = async (req, res) => {
  try {
    if (denyNonStaff(req, res)) return;
    const { id } = req.params;
    if (badId(id, res)) return;
    const task = await CrmTask.findByIdAndDelete(id);
    if (!task) return res.status(404).json({ message: 'Task not found' });
    await emitCrm('crm:task', { id: String(id), deleted: true });
    res.json({ message: 'Task deleted' });
  } catch (error) {
    console.error('deleteTask error:', error);
    res.status(500).json({ message: 'Failed to delete task' });
  }
};

// ── Deals ────────────────────────────────────────────────────────────────────
const DEAL_FIELDS = ['title', 'company', 'contact', 'stage', 'value', 'currency', 'probability', 'expectedCloseDate', 'source', 'owner', 'notes'];

exports.listDeals = async (req, res) => {
  try {
    if (denyNonStaff(req, res)) return;
    const { q, status, stage, owner, company } = req.query;
    const filter = {};
    if (status) filter.status = status;
    if (stage) filter.stage = stage;
    if (owner && mongoose.isValidObjectId(owner)) filter.owner = owner;
    if (company && mongoose.isValidObjectId(company)) filter.company = company;
    if (q && q.trim()) {
      const rx = new RegExp(q.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ title: rx }, { notes: rx }];
    }
    const deals = await popDeal(CrmDeal.find(filter)).sort({ updatedAt: -1 }).limit(500).lean();
    res.json({ deals });
  } catch (error) {
    console.error('listDeals error:', error);
    res.status(500).json({ message: 'Failed to load deals' });
  }
};

exports.createDeal = async (req, res) => {
  try {
    if (denyNonStaff(req, res)) return;
    if (!req.body.title || !req.body.title.trim()) return res.status(400).json({ message: 'Deal title is required' });
    const data = { createdBy: req.user._id };
    DEAL_FIELDS.forEach((f) => { if (req.body[f] !== undefined) data[f] = req.body[f]; });
    if (!data.owner) data.owner = req.user._id;
    const deal = await CrmDeal.create(data);
    await emitCrm('crm:deal', { id: String(deal._id) });
    const full = await popDeal(CrmDeal.findById(deal._id)).lean();
    res.status(201).json({ deal: full });
  } catch (error) {
    console.error('createDeal error:', error);
    res.status(500).json({ message: 'Failed to create deal' });
  }
};

exports.updateDeal = async (req, res) => {
  try {
    if (denyNonStaff(req, res)) return;
    const { id } = req.params;
    if (badId(id, res)) return;
    const deal = await CrmDeal.findById(id);
    if (!deal) return res.status(404).json({ message: 'Deal not found' });
    applyFields(deal, req.body, DEAL_FIELDS);
    await deal.save();
    await emitCrm('crm:deal', { id: String(id) });
    const full = await popDeal(CrmDeal.findById(id)).lean();
    res.json({ deal: full });
  } catch (error) {
    console.error('updateDeal error:', error);
    res.status(500).json({ message: 'Failed to update deal' });
  }
};

// Move a deal to another pipeline stage (drag-and-drop on the board). Moving to
// the terminal 'won'/'lost' stages also sets the deal status + timestamp.
exports.moveDeal = async (req, res) => {
  try {
    if (denyNonStaff(req, res)) return;
    const { id } = req.params;
    if (badId(id, res)) return;
    const { stage } = req.body;
    if (!stage) return res.status(400).json({ message: 'Stage is required' });
    const deal = await CrmDeal.findById(id);
    if (!deal) return res.status(404).json({ message: 'Deal not found' });
    deal.stage = stage;
    if (stage === 'won') { deal.status = 'won'; deal.wonAt = new Date(); deal.probability = 100; }
    else if (stage === 'lost') { deal.status = 'lost'; deal.lostAt = new Date(); deal.probability = 0; if (req.body.lostReason) deal.lostReason = req.body.lostReason; }
    else { deal.status = 'open'; }
    await deal.save();
    await emitCrm('crm:deal', { id: String(id) });
    const full = await popDeal(CrmDeal.findById(id)).lean();
    res.json({ deal: full });
  } catch (error) {
    console.error('moveDeal error:', error);
    res.status(500).json({ message: 'Failed to move deal' });
  }
};

exports.deleteDeal = async (req, res) => {
  try {
    if (denyNonStaff(req, res)) return;
    const { id } = req.params;
    if (badId(id, res)) return;
    const deal = await CrmDeal.findByIdAndDelete(id);
    if (!deal) return res.status(404).json({ message: 'Deal not found' });
    await emitCrm('crm:deal', { id: String(id), deleted: true });
    res.json({ message: 'Deal deleted' });
  } catch (error) {
    console.error('deleteDeal error:', error);
    res.status(500).json({ message: 'Failed to delete deal' });
  }
};

// ── Calendar ─────────────────────────────────────────────────────────────────
// Combined feed of activities (by date) and tasks (by dueDate) in a window, for
// the calendar view.
exports.getCalendar = async (req, res) => {
  try {
    if (denyNonStaff(req, res)) return;
    const { from, to, mine } = req.query;
    const start = from ? new Date(from) : new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const end = to ? new Date(to) : new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0, 23, 59, 59);

    const taskFilter = { dueDate: { $gte: start, $lte: end } };
    if (mine === 'true') taskFilter.assignedTo = req.user._id;

    const [activities, tasks] = await Promise.all([
      popActivity(CrmActivity.find({ date: { $gte: start, $lte: end } })).sort({ date: 1 }).lean(),
      popTask(CrmTask.find(taskFilter)).sort({ dueDate: 1 }).lean(),
    ]);
    res.json({ activities, tasks });
  } catch (error) {
    console.error('getCalendar error:', error);
    res.status(500).json({ message: 'Failed to load calendar' });
  }
};
