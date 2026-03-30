const CollectionActivity = require('../models/CollectionActivity');
const logAudit = require('../utils/auditLogger');
const { emitToAll } = require('../websocket/socketManager');

exports.logActivity = async (req, res) => {
  try {
    const { customer, invoice, type, promiseDate, promiseAmount, followUpDate, notes, contactType, status, amountCollected, nextFollowUpDate } = req.body;

    const activity = await CollectionActivity.create({
      customer,
      invoice,
      collector: req.user._id,
      type,
      promiseDate,
      promiseAmount,
      followUpDate,
      notes,
      contactType,
      status,
      amountCollected,
      nextFollowUpDate,
    });

    await logAudit({
      user: req.user._id,
      action: 'log_collection_activity',
      entity: 'CollectionActivity',
      entityId: activity._id,
      changes: { after: { customer, type, notes } },
      ipAddress: req.ip,
    });

    const populated = await CollectionActivity.findById(activity._id)
      .populate('customer', 'companyName')
      .populate('invoice', 'invoiceNumber')
      .populate('collector', 'firstName lastName');

    try { emitToAll('collection:logged', { activity: populated }); } catch (e) {}

    res.status(201).json({ activity: populated });
  } catch (error) {
    res.status(500).json({ message: 'Failed to log collection activity' });
  }
};

exports.getActivities = async (req, res) => {
  try {
    const { customer, collector, type, page = 1, limit = 50 } = req.query;
    const filter = {};

    if (customer) filter.customer = customer;
    if (collector) filter.collector = collector;
    if (type) filter.type = type;

    const skip = (Number(page) - 1) * Number(limit);
    const [activities, total] = await Promise.all([
      CollectionActivity.find(filter)
        .populate('customer', 'companyName')
        .populate('invoice', 'invoiceNumber amount')
        .populate('collector', 'firstName lastName')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit)),
      CollectionActivity.countDocuments(filter),
    ]);

    res.json({ activities, total, page: Number(page), pages: Math.ceil(total / Number(limit)) });
  } catch (error) {
    res.status(500).json({ message: 'Failed to load collection activities' });
  }
};

exports.getFollowUps = async (req, res) => {
  try {
    const filter = {
      completed: { $ne: true },
      $or: [
        { followUpDate: { $gte: new Date() }, type: 'follow_up' },
        { nextFollowUpDate: { $gte: new Date() } },
      ],
    };

    const followUps = await CollectionActivity.find(filter)
      .populate('customer', 'companyName creditTerm')
      .populate('invoice', 'invoiceNumber amount balance dueDate')
      .populate('collector', 'firstName lastName')
      .sort({ followUpDate: 1 })
      .limit(50);

    res.json({ followUps });
  } catch (error) {
    res.status(500).json({ message: 'Failed to load follow-ups' });
  }
};

exports.completeFollowUp = async (req, res) => {
  try {
    const activity = await CollectionActivity.findById(req.params.id);
    if (!activity) {
      return res.status(404).json({ message: 'Activity not found' });
    }

    activity.completed = true;
    activity.completedAt = new Date();
    activity.completedBy = req.user._id;
    if (req.body.notes) {
      activity.completionNotes = req.body.notes;
    }
    await activity.save();

    await logAudit({
      user: req.user._id,
      action: 'complete_follow_up',
      entity: 'CollectionActivity',
      entityId: activity._id,
      changes: { after: { completed: true, completionNotes: req.body.notes || '' } },
      ipAddress: req.ip,
    });

    const populated = await CollectionActivity.findById(activity._id)
      .populate('customer', 'companyName')
      .populate('invoice', 'invoiceNumber amount')
      .populate('collector', 'firstName lastName');

    try { emitToAll('collection:updated', { activity: populated }); } catch (e) {}

    res.json({ activity: populated });
  } catch (error) {
    res.status(500).json({ message: 'Failed to complete follow-up' });
  }
};

exports.markPromiseFulfilled = async (req, res) => {
  try {
    const activity = await CollectionActivity.findById(req.params.id);
    if (!activity) {
      return res.status(404).json({ message: 'Activity not found' });
    }

    activity.promiseFulfilled = req.body.fulfilled;
    await activity.save();

    res.json({ activity });
  } catch (error) {
    res.status(500).json({ message: 'Failed to update promise status' });
  }
};
