const mongoose = require('mongoose');
const BdOpportunity = require('../models/BdOpportunity');
const BdPartner = require('../models/BdPartner');
const BdTender = require('../models/BdTender');
const BdActivity = require('../models/BdActivity');
const { emitToAll } = require('../websocket/socketManager');
const { createNotification } = require('../services/notificationService');

// ── Field whitelists ─────────────────────────────────────────────────────────
// Only these keys may ever come off the wire. `status` and `closedAt` are
// deliberately absent from the opportunity list: they are derived from `stage`
// by the model, never set by a client.
const OPP_EDITABLE = [
  'name', 'nameAr', 'type', 'stage', 'priority', 'estimatedValue', 'currency', 'probability',
  'expectedCloseDate', 'owner', 'ownerName', 'crmCompany', 'partnerName', 'region', 'city',
  'description', 'nextStep', 'nextStepDate', 'source', 'competitors', 'risks', 'notes', 'lostReason',
];
const PARTNER_EDITABLE = [
  'name', 'nameAr', 'type', 'status', 'country', 'city', 'website',
  'contactName', 'contactEmail', 'contactPhone', 'agreementStart', 'agreementEnd',
  'services', 'description', 'notes', 'owner', 'ownerName',
];
const TENDER_EDITABLE = [
  'title', 'titleAr', 'entity', 'referenceNumber', 'submissionDeadline', 'status',
  'estimatedValue', 'bidBondAmount', 'scope', 'requirements', 'documentsReady',
  'submittedAt', 'result', 'owner', 'ownerName', 'notes', 'opportunity',
];
const ACTIVITY_EDITABLE = [
  'date', 'entityType', 'refId', 'title', 'type', 'summary', 'outcome', 'nextStep',
  'performedBy', 'performedByName',
];

// Empty-string ObjectId refs arrive from <select> elements with no selection;
// they must be dropped, not cast (Mongoose would throw).
const REF_FIELDS = ['owner', 'crmCompany', 'opportunity', 'performedBy', 'refId'];

const pickWith = (list) => (body) => {
  const out = {};
  for (const k of list) if (body[k] !== undefined) out[k] = body[k];
  for (const f of REF_FIELDS) {
    // '' / null from a cleared <select> means UNSET the link — dropping it
    // silently kept the old ref forever (detaching a CRM company never stuck).
    if (out[f] === '' || out[f] === null) out[f] = null;
  }
  if (out.competitors !== undefined) out.competitors = toArray(out.competitors);
  if (out.services !== undefined) out.services = toArray(out.services);
  if (out.requirements !== undefined) out.requirements = toArray(out.requirements);
  return out;
};
// The list fields are edited as comma/newline separated text in the UI.
const toArray = (v) => {
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean);
  if (typeof v === 'string') return v.split(/[,\n]/).map((x) => x.trim()).filter(Boolean);
  return [];
};

const pickOpp = pickWith(OPP_EDITABLE);
const pickPartner = pickWith(PARTNER_EDITABLE);
const pickTender = pickWith(TENDER_EDITABLE);
const pickActivity = pickWith(ACTIVITY_EDITABLE);

const badId = (id, res) => {
  if (!mongoose.isValidObjectId(id)) {
    res.status(400).json({ message: 'Invalid id' });
    return true;
  }
  return false;
};

const emit = (event, payload = {}) => {
  try { emitToAll(event, payload); } catch (e) { /* socket layer not ready — never fail the request */ }
  // The dashboard cache must die WITH the mutation, or the socket-triggered
  // reload re-serves the pre-mutation snapshot for up to 12s.
  try { require('../utils/ttlCache').clear('dash:bd'); } catch (e) { /* cache is best-effort */ }
};

const userName = (u) => (u ? `${u.firstName || ''} ${u.lastName || ''}`.trim() : '');

// ── Date helpers ─────────────────────────────────────────────────────────────
const ymd = (d) => new Date(d).toISOString().slice(0, 10);
const todayStr = () => ymd(new Date());
const addDaysStr = (n) => ymd(new Date(Date.now() + n * 86400000));
// Days between today and a YYYY-MM-DD string (negative = past).
const daysUntil = (s) => {
  if (!s) return null;
  const d0 = new Date(`${todayStr()}T00:00:00Z`).getTime();
  const d1 = new Date(`${String(s).slice(0, 10)}T00:00:00Z`).getTime();
  if (Number.isNaN(d1)) return null;
  return Math.round((d1 - d0) / 86400000);
};

const popOpp = (q) => q
  .populate('owner', 'firstName lastName email')
  .populate('crmCompany', 'name arabicName')
  .populate('createdBy', 'firstName lastName');
const popPartner = (q) => q
  .populate('owner', 'firstName lastName email')
  .populate('createdBy', 'firstName lastName');
const popTender = (q) => q
  .populate('owner', 'firstName lastName email')
  .populate('opportunity', 'name nameAr')
  .populate('createdBy', 'firstName lastName');
const popActivity = (q) => q
  .populate('performedBy', 'firstName lastName')
  .populate('createdBy', 'firstName lastName');

// A case-insensitive contains-match across the given fields.
const searchOr = (q, fields) => {
  const rx = new RegExp(String(q).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  return { $or: fields.map((f) => ({ [f]: rx })) };
};

const OPEN_STAGES = ['identified', 'researching', 'qualified', 'proposal', 'negotiation'];
const FUNNEL_STAGES = [...OPEN_STAGES, 'won', 'lost', 'on_hold'];
const PARTNER_STATUSES = ['prospect', 'in_discussion', 'active', 'paused', 'ended'];
const TENDER_STATUSES = ['watching', 'preparing', 'submitted', 'shortlisted', 'won', 'lost', 'cancelled'];

// Turn an [{_id, count, …}] aggregation into a plain keyed object, with every
// known key present so the frontend never has to guard for undefined.
const keyBy = (rows, keys, field = 'count') => {
  const out = {};
  keys.forEach((k) => { out[k] = 0; });
  rows.forEach((r) => { if (r._id) out[r._id] = r[field] || 0; });
  return out;
};

// ── Dashboard ────────────────────────────────────────────────────────────────
exports.getDashboard = async (req, res) => {
  try {
    const { from, to } = req.query;
    // Every BD viewer sees the same numbers, so a short TTL lets a burst of
    // socket-driven reloads share one computation against the remote cluster.
    const cache = require('../utils/ttlCache');
    const ck = `dash:bd:${from || ''}:${to || ''}`;
    const hit = cache.get(ck);
    if (hit !== undefined) return res.json(hit);

    // Activity window: defaults to the last 30 days.
    const periodStart = from ? new Date(`${String(from).slice(0, 10)}T00:00:00.000Z`) : new Date(Date.now() - 30 * 86400000);
    const periodEnd = to ? new Date(`${String(to).slice(0, 10)}T23:59:59.999Z`) : new Date();
    const soonCutoff = addDaysStr(30);
    const today = todayStr();

    const [
      opportunities, stageAgg, partnerAgg, tenderAgg,
      tendersDueSoon, activitiesThisPeriod, timeline, topOpportunities, upcomingDeadlines,
    ] = await Promise.all([
      BdOpportunity.find({}).select('stage status estimatedValue probability').lean(),
      BdOpportunity.aggregate([
        { $group: { _id: '$stage', count: { $sum: 1 }, value: { $sum: '$estimatedValue' } } },
      ]),
      BdPartner.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
      BdTender.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
      BdTender.countDocuments({
        status: { $in: ['watching', 'preparing'] },
        submissionDeadline: { $gte: today, $lte: soonCutoff },
      }),
      BdActivity.countDocuments({ date: { $gte: periodStart, $lte: periodEnd } }),
      popActivity(BdActivity.find({ date: { $gte: periodStart, $lte: periodEnd } }).sort({ date: -1 }).limit(15)).lean(),
      popOpp(BdOpportunity.find({ status: 'open' }).sort({ estimatedValue: -1 }).limit(5)).lean(),
      popTender(
        BdTender.find({
          status: { $nin: ['won', 'lost', 'cancelled'] },
          submissionDeadline: { $gte: today },
        }).sort({ submissionDeadline: 1 }).limit(8)
      ).lean(),
    ]);

    const open = opportunities.filter((o) => o.status === 'open');
    const pipelineValue = open.reduce((s, o) => s + (o.estimatedValue || 0), 0);
    const weightedPipelineValue = Math.round(
      open.reduce((s, o) => s + (o.estimatedValue || 0) * ((o.probability || 0) / 100), 0)
    );
    const won = opportunities.filter((o) => o.status === 'won').length;
    const lost = opportunities.filter((o) => o.status === 'lost').length;
    const winRate = won + lost > 0 ? Math.round((won / (won + lost)) * 100) : 0;

    const byStageCount = keyBy(stageAgg, FUNNEL_STAGES);
    const byStageValue = keyBy(stageAgg, FUNNEL_STAGES, 'value');

    const body = {
      totals: {
        opportunities: opportunities.length,
        openOpportunities: open.length,
        byStage: byStageCount,
        pipelineValue,
        weightedPipelineValue,
        won,
        lost,
        winRate,
        partners: keyBy(partnerAgg, PARTNER_STATUSES),
        tenders: keyBy(tenderAgg, TENDER_STATUSES),
        tendersDueSoon,
        activitiesThisPeriod,
      },
      // Ordered so the frontend can render it as a funnel without re-sorting.
      funnel: FUNNEL_STAGES.map((stage) => ({
        stage,
        count: byStageCount[stage] || 0,
        value: byStageValue[stage] || 0,
      })),
      timeline,
      topOpportunities,
      upcomingDeadlines: upcomingDeadlines.map((t) => ({ ...t, daysLeft: daysUntil(t.submissionDeadline) })),
      period: { from: ymd(periodStart), to: ymd(periodEnd) },
    };

    cache.set(ck, body, 12000);
    res.json(body);
  } catch (error) {
    console.error('bd getDashboard error:', error);
    res.status(500).json({ message: 'Failed to load business development dashboard' });
  }
};

// ── Opportunities ────────────────────────────────────────────────────────────
exports.listOpportunities = async (req, res) => {
  try {
    const { stage, status, type, priority, owner, q } = req.query;
    const filter = {};
    if (stage) filter.stage = stage;
    if (status) filter.status = status;
    if (type) filter.type = type;
    if (priority) filter.priority = priority;
    if (owner && mongoose.isValidObjectId(owner)) filter.owner = owner;
    if (q && String(q).trim()) {
      Object.assign(filter, searchOr(q, ['name', 'nameAr', 'partnerName', 'region', 'city', 'description', 'source']));
    }
    const opportunities = await popOpp(BdOpportunity.find(filter).sort({ updatedAt: -1 })).lean();
    res.json({ opportunities });
  } catch (error) {
    res.status(500).json({ message: 'Failed to load opportunities' });
  }
};

exports.getOpportunity = async (req, res) => {
  try {
    if (badId(req.params.id, res)) return;
    const opportunity = await popOpp(BdOpportunity.findById(req.params.id)).lean();
    if (!opportunity) return res.status(404).json({ message: 'Opportunity not found' });
    const activities = await popActivity(
      BdActivity.find({ entityType: 'opportunity', refId: opportunity._id }).sort({ date: -1 })
    ).lean();
    res.json({ opportunity, activities });
  } catch (error) {
    res.status(500).json({ message: 'Failed to load opportunity' });
  }
};

exports.createOpportunity = async (req, res) => {
  try {
    const data = pickOpp(req.body);
    if (!data.name || !String(data.name).trim()) return res.status(400).json({ message: 'Name is required' });
    data.createdBy = req.user._id;
    if (!data.owner) { data.owner = req.user._id; data.ownerName = userName(req.user); }
    const opportunity = await BdOpportunity.create(data);
    // Notify the owner if the opportunity was assigned to someone else.
    if (opportunity.owner && String(opportunity.owner) !== String(req.user._id)) {
      try {
        await createNotification({
          recipient: opportunity.owner,
          type: 'task_assigned',
          title: 'فرصة تطوير أعمال جديدة',
          message: `تم إسناد الفرصة "${opportunity.name}" إليك.`,
          relatedEntity: 'BdOpportunity',
          relatedEntityId: opportunity._id,
        });
      } catch (e) {}
    }
    emit('bd:updated', { entity: 'opportunity', action: 'created', id: opportunity._id });
    res.status(201).json({ opportunity });
  } catch (error) {
    res.status(500).json({ message: error.message || 'Failed to create opportunity' });
  }
};

exports.updateOpportunity = async (req, res) => {
  try {
    if (badId(req.params.id, res)) return;
    const opportunity = await BdOpportunity.findById(req.params.id);
    if (!opportunity) return res.status(404).json({ message: 'Opportunity not found' });
    const prevStage = opportunity.stage;
    // set()+save() rather than findByIdAndUpdate so the pre-save hook that keeps
    // `status`/`closedAt` in sync with `stage` actually runs.
    opportunity.set(pickOpp(req.body));
    await opportunity.save();
    // Notify the owner when the opportunity moves to a new stage (if not the actor).
    if (opportunity.stage !== prevStage && opportunity.owner && String(opportunity.owner) !== String(req.user._id)) {
      try {
        await createNotification({
          recipient: opportunity.owner,
          type: 'status_changed',
          title: 'تغيّرت مرحلة الفرصة',
          message: `انتقلت الفرصة "${opportunity.name}" إلى مرحلة: ${opportunity.stage}.`,
          relatedEntity: 'BdOpportunity',
          relatedEntityId: opportunity._id,
        });
      } catch (e) {}
    }
    const populated = await popOpp(BdOpportunity.findById(opportunity._id)).lean();
    emit('bd:updated', { entity: 'opportunity', action: 'updated', id: opportunity._id });
    res.json({ opportunity: populated });
  } catch (error) {
    res.status(500).json({ message: error.message || 'Failed to update opportunity' });
  }
};

exports.deleteOpportunity = async (req, res) => {
  try {
    if (badId(req.params.id, res)) return;
    const opportunity = await BdOpportunity.findByIdAndDelete(req.params.id);
    if (!opportunity) return res.status(404).json({ message: 'Opportunity not found' });
    // Its log entries would otherwise dangle.
    await BdActivity.deleteMany({ entityType: 'opportunity', refId: opportunity._id });
    emit('bd:updated', { entity: 'opportunity', action: 'deleted', id: opportunity._id });
    res.json({ message: 'Opportunity deleted' });
  } catch (error) {
    res.status(500).json({ message: 'Failed to delete opportunity' });
  }
};

// ── Partners ─────────────────────────────────────────────────────────────────
exports.listPartners = async (req, res) => {
  try {
    const { status, type, owner, q } = req.query;
    const filter = {};
    if (status) filter.status = status;
    if (type) filter.type = type;
    if (owner && mongoose.isValidObjectId(owner)) filter.owner = owner;
    if (q && String(q).trim()) {
      Object.assign(filter, searchOr(q, ['name', 'nameAr', 'country', 'city', 'contactName', 'contactEmail', 'contactPhone', 'description']));
    }
    const partners = await popPartner(BdPartner.find(filter).sort({ updatedAt: -1 })).lean();
    res.json({ partners });
  } catch (error) {
    res.status(500).json({ message: 'Failed to load partners' });
  }
};

exports.getPartner = async (req, res) => {
  try {
    if (badId(req.params.id, res)) return;
    const partner = await popPartner(BdPartner.findById(req.params.id)).lean();
    if (!partner) return res.status(404).json({ message: 'Partner not found' });
    const activities = await popActivity(
      BdActivity.find({ entityType: 'partner', refId: partner._id }).sort({ date: -1 })
    ).lean();
    res.json({ partner, activities });
  } catch (error) {
    res.status(500).json({ message: 'Failed to load partner' });
  }
};

exports.createPartner = async (req, res) => {
  try {
    const data = pickPartner(req.body);
    if (!data.name || !String(data.name).trim()) return res.status(400).json({ message: 'Name is required' });
    data.createdBy = req.user._id;
    if (!data.owner) { data.owner = req.user._id; data.ownerName = userName(req.user); }
    const partner = await BdPartner.create(data);
    // Notify the owner if the partner was assigned to someone else.
    if (partner.owner && String(partner.owner) !== String(req.user._id)) {
      try {
        await createNotification({
          recipient: partner.owner,
          type: 'task_assigned',
          title: 'شريك جديد',
          message: `تم إسناد الشريك "${partner.name}" إليك.`,
          relatedEntity: 'BdPartner',
          relatedEntityId: partner._id,
        });
      } catch (e) {}
    }
    emit('bd:updated', { entity: 'partner', action: 'created', id: partner._id });
    res.status(201).json({ partner });
  } catch (error) {
    res.status(500).json({ message: error.message || 'Failed to create partner' });
  }
};

exports.updatePartner = async (req, res) => {
  try {
    if (badId(req.params.id, res)) return;
    const beforePartner = await BdPartner.findById(req.params.id).select('status').lean();
    const partner = await popPartner(
      BdPartner.findByIdAndUpdate(req.params.id, pickPartner(req.body), { new: true, runValidators: true })
    ).lean();
    if (!partner) return res.status(404).json({ message: 'Partner not found' });
    // Notify the owner when the partner's status changes (if not the actor).
    if (beforePartner && partner.status !== beforePartner.status && partner.owner && String(partner.owner._id || partner.owner) !== String(req.user._id)) {
      try {
        await createNotification({
          recipient: partner.owner._id || partner.owner,
          type: 'status_changed',
          title: 'تغيّرت حالة الشريك',
          message: `أصبحت حالة الشريك "${partner.name}": ${partner.status}.`,
          relatedEntity: 'BdPartner',
          relatedEntityId: partner._id,
        });
      } catch (e) {}
    }
    emit('bd:updated', { entity: 'partner', action: 'updated', id: partner._id });
    res.json({ partner });
  } catch (error) {
    res.status(500).json({ message: error.message || 'Failed to update partner' });
  }
};

exports.deletePartner = async (req, res) => {
  try {
    if (badId(req.params.id, res)) return;
    const partner = await BdPartner.findByIdAndDelete(req.params.id);
    if (!partner) return res.status(404).json({ message: 'Partner not found' });
    await BdActivity.deleteMany({ entityType: 'partner', refId: partner._id });
    emit('bd:updated', { entity: 'partner', action: 'deleted', id: partner._id });
    res.json({ message: 'Partner deleted' });
  } catch (error) {
    res.status(500).json({ message: 'Failed to delete partner' });
  }
};

// ── Tenders ──────────────────────────────────────────────────────────────────
exports.listTenders = async (req, res) => {
  try {
    const { status, owner, q, dueWithin } = req.query;
    const filter = {};
    if (status) filter.status = status;
    if (owner && mongoose.isValidObjectId(owner)) filter.owner = owner;
    if (dueWithin) {
      filter.submissionDeadline = { $gte: todayStr(), $lte: addDaysStr(Number(dueWithin) || 30) };
    }
    if (q && String(q).trim()) {
      Object.assign(filter, searchOr(q, ['title', 'titleAr', 'entity', 'referenceNumber', 'scope']));
    }
    // Deadline-first ordering is what the page shows; blank deadlines sort last.
    const tenders = await popTender(BdTender.find(filter).sort({ submissionDeadline: 1, updatedAt: -1 })).lean();
    res.json({ tenders: tenders.map((t) => ({ ...t, daysLeft: daysUntil(t.submissionDeadline) })) });
  } catch (error) {
    res.status(500).json({ message: 'Failed to load tenders' });
  }
};

exports.getTender = async (req, res) => {
  try {
    if (badId(req.params.id, res)) return;
    const tender = await popTender(BdTender.findById(req.params.id)).lean();
    if (!tender) return res.status(404).json({ message: 'Tender not found' });
    const activities = await popActivity(
      BdActivity.find({ entityType: 'tender', refId: tender._id }).sort({ date: -1 })
    ).lean();
    res.json({ tender: { ...tender, daysLeft: daysUntil(tender.submissionDeadline) }, activities });
  } catch (error) {
    res.status(500).json({ message: 'Failed to load tender' });
  }
};

exports.createTender = async (req, res) => {
  try {
    const data = pickTender(req.body);
    if (!data.title || !String(data.title).trim()) return res.status(400).json({ message: 'Title is required' });
    data.createdBy = req.user._id;
    if (!data.owner) { data.owner = req.user._id; data.ownerName = userName(req.user); }
    const tender = await BdTender.create(data);
    // Notify the owner if the tender was assigned to someone else.
    if (tender.owner && String(tender.owner) !== String(req.user._id)) {
      try {
        await createNotification({
          recipient: tender.owner,
          type: 'task_assigned',
          title: 'مناقصة جديدة',
          message: `تم إسناد المناقصة "${tender.title}" إليك.`,
          relatedEntity: 'BdTender',
          relatedEntityId: tender._id,
        });
      } catch (e) {}
    }
    emit('bd:updated', { entity: 'tender', action: 'created', id: tender._id });
    res.status(201).json({ tender });
  } catch (error) {
    res.status(500).json({ message: error.message || 'Failed to create tender' });
  }
};

exports.updateTender = async (req, res) => {
  try {
    if (badId(req.params.id, res)) return;
    const beforeTender = await BdTender.findById(req.params.id).select('status').lean();
    const tender = await popTender(
      BdTender.findByIdAndUpdate(req.params.id, pickTender(req.body), { new: true, runValidators: true })
    ).lean();
    if (!tender) return res.status(404).json({ message: 'Tender not found' });
    // Notify the owner when the tender's status changes (if not the actor).
    if (beforeTender && tender.status !== beforeTender.status && tender.owner && String(tender.owner._id || tender.owner) !== String(req.user._id)) {
      try {
        await createNotification({
          recipient: tender.owner._id || tender.owner,
          type: 'status_changed',
          title: 'تغيّرت حالة المناقصة',
          message: `أصبحت حالة المناقصة "${tender.title}": ${tender.status}.`,
          relatedEntity: 'BdTender',
          relatedEntityId: tender._id,
        });
      } catch (e) {}
    }
    emit('bd:updated', { entity: 'tender', action: 'updated', id: tender._id });
    res.json({ tender: { ...tender, daysLeft: daysUntil(tender.submissionDeadline) } });
  } catch (error) {
    res.status(500).json({ message: error.message || 'Failed to update tender' });
  }
};

exports.deleteTender = async (req, res) => {
  try {
    if (badId(req.params.id, res)) return;
    const tender = await BdTender.findByIdAndDelete(req.params.id);
    if (!tender) return res.status(404).json({ message: 'Tender not found' });
    await BdActivity.deleteMany({ entityType: 'tender', refId: tender._id });
    emit('bd:updated', { entity: 'tender', action: 'deleted', id: tender._id });
    res.json({ message: 'Tender deleted' });
  } catch (error) {
    res.status(500).json({ message: 'Failed to delete tender' });
  }
};

// ── Activities ───────────────────────────────────────────────────────────────
exports.listActivities = async (req, res) => {
  try {
    const { entityType, refId, from, to, type } = req.query;
    const filter = {};
    if (entityType) filter.entityType = entityType;
    if (refId) {
      if (badId(refId, res)) return;
      filter.refId = refId;
    }
    if (type) filter.type = type;
    if (from || to) {
      filter.date = {};
      if (from) filter.date.$gte = new Date(`${String(from).slice(0, 10)}T00:00:00.000Z`);
      if (to) filter.date.$lte = new Date(`${String(to).slice(0, 10)}T23:59:59.999Z`);
    }
    const activities = await popActivity(BdActivity.find(filter).sort({ date: -1 }).limit(500)).lean();
    res.json({ activities });
  } catch (error) {
    res.status(500).json({ message: 'Failed to load activities' });
  }
};

exports.createActivity = async (req, res) => {
  try {
    const data = pickActivity(req.body);
    if (!data.entityType || !data.refId) return res.status(400).json({ message: 'entityType and refId are required' });
    if (!data.title || !String(data.title).trim()) return res.status(400).json({ message: 'Title is required' });
    data.createdBy = req.user._id;
    if (!data.performedBy) { data.performedBy = req.user._id; data.performedByName = userName(req.user); }
    const activity = await BdActivity.create(data);
    // Notify the person the activity was logged for (if not the actor).
    if (activity.performedBy && String(activity.performedBy) !== String(req.user._id)) {
      try {
        await createNotification({
          recipient: activity.performedBy,
          type: 'task_assigned',
          title: 'نشاط تطوير أعمال جديد',
          message: `تم إسناد نشاط "${activity.title}" إليك.`,
          relatedEntity: 'BdActivity',
          relatedEntityId: activity._id,
        });
      } catch (e) {}
    }
    emit('bd:updated', { entity: 'activity', action: 'created', id: activity._id });
    res.status(201).json({ activity });
  } catch (error) {
    res.status(500).json({ message: error.message || 'Failed to create activity' });
  }
};

exports.updateActivity = async (req, res) => {
  try {
    if (badId(req.params.id, res)) return;
    const activity = await popActivity(
      BdActivity.findByIdAndUpdate(req.params.id, pickActivity(req.body), { new: true, runValidators: true })
    ).lean();
    if (!activity) return res.status(404).json({ message: 'Activity not found' });
    emit('bd:updated', { entity: 'activity', action: 'updated', id: activity._id });
    res.json({ activity });
  } catch (error) {
    res.status(500).json({ message: error.message || 'Failed to update activity' });
  }
};

exports.deleteActivity = async (req, res) => {
  try {
    if (badId(req.params.id, res)) return;
    const activity = await BdActivity.findByIdAndDelete(req.params.id);
    if (!activity) return res.status(404).json({ message: 'Activity not found' });
    emit('bd:updated', { entity: 'activity', action: 'deleted', id: activity._id });
    res.json({ message: 'Activity deleted' });
  } catch (error) {
    res.status(500).json({ message: 'Failed to delete activity' });
  }
};
