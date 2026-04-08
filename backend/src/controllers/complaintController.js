const Complaint = require('../models/Complaint');
const { emitToAll } = require('../websocket/socketManager');
const logAudit = require('../utils/auditLogger');

const getComplaints = async (req, res) => {
  try {
    const { status, category, priority, page = 1, limit = 20 } = req.query;
    const filter = {};

    if (status) filter.status = status;
    if (category) filter.category = category;
    if (priority) filter.priority = priority;

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [complaints, total] = await Promise.all([
      Complaint.find(filter)
        .populate('createdBy', 'firstName lastName')
        .populate('assignedTo', 'firstName lastName')
        .populate('resolvedBy', 'firstName lastName')
        .populate('customer', 'companyName')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit)),
      Complaint.countDocuments(filter),
    ]);

    res.json({
      complaints,
      total,
      page: parseInt(page),
      pages: Math.ceil(total / parseInt(limit)),
    });
  } catch (error) {
    console.error('Error fetching complaints:', error);
    res.status(500).json({ message: 'Failed to fetch complaints' });
  }
};

const getComplaint = async (req, res) => {
  try {
    const complaint = await Complaint.findById(req.params.id)
      .populate('createdBy', 'firstName lastName')
      .populate('assignedTo', 'firstName lastName')
      .populate('resolvedBy', 'firstName lastName')
      .populate('customer', 'companyName')
      .populate('branch', 'name');

    if (!complaint) {
      return res.status(404).json({ message: 'Complaint not found' });
    }

    res.json(complaint);
  } catch (error) {
    console.error('Error fetching complaint:', error);
    res.status(500).json({ message: 'Failed to fetch complaint' });
  }
};

const createComplaint = async (req, res) => {
  try {
    const data = {
      ...req.body,
      createdBy: req.user._id,
      branch: req.user.branch,
    };

    const complaint = await Complaint.create(data);
    const populated = await Complaint.findById(complaint._id)
      .populate('createdBy', 'firstName lastName')
      .populate('assignedTo', 'firstName lastName')
      .populate('customer', 'companyName');

    emitToAll('complaint:created', populated);

    await logAudit({
      user: req.user,
      action: 'create',
      entity: 'Complaint',
      entityId: complaint._id,
      changes: { subject: data.subject, category: data.category },
      ipAddress: req.ip,
    });

    res.status(201).json(populated);
  } catch (error) {
    console.error('Error creating complaint:', error);
    res.status(500).json({ message: 'Failed to create complaint' });
  }
};

const updateComplaint = async (req, res) => {
  try {
    const complaint = await Complaint.findByIdAndUpdate(
      req.params.id,
      { $set: req.body },
      { new: true, runValidators: true }
    )
      .populate('createdBy', 'firstName lastName')
      .populate('assignedTo', 'firstName lastName')
      .populate('resolvedBy', 'firstName lastName')
      .populate('customer', 'companyName');

    if (!complaint) {
      return res.status(404).json({ message: 'Complaint not found' });
    }

    emitToAll('complaint:updated', complaint);

    await logAudit({
      user: req.user,
      action: 'update',
      entity: 'Complaint',
      entityId: complaint._id,
      changes: req.body,
      ipAddress: req.ip,
    });

    res.json(complaint);
  } catch (error) {
    console.error('Error updating complaint:', error);
    res.status(500).json({ message: 'Failed to update complaint' });
  }
};

const resolveComplaint = async (req, res) => {
  try {
    const complaint = await Complaint.findById(req.params.id);
    if (!complaint) {
      return res.status(404).json({ message: 'Complaint not found' });
    }

    if (complaint.status === 'resolved') {
      return res.status(400).json({ message: 'Complaint already resolved' });
    }

    complaint.status = 'resolved';
    complaint.resolvedAt = new Date();
    complaint.resolvedBy = req.user._id;
    if (req.body.resolution) complaint.resolution = req.body.resolution;
    await complaint.save();

    const populated = await Complaint.findById(complaint._id)
      .populate('createdBy', 'firstName lastName')
      .populate('assignedTo', 'firstName lastName')
      .populate('resolvedBy', 'firstName lastName')
      .populate('customer', 'companyName');

    emitToAll('complaint:resolved', populated);

    await logAudit({
      user: req.user,
      action: 'resolve',
      entity: 'Complaint',
      entityId: complaint._id,
      changes: { status: 'resolved', resolution: req.body.resolution },
      ipAddress: req.ip,
    });

    res.json(populated);
  } catch (error) {
    console.error('Error resolving complaint:', error);
    res.status(500).json({ message: 'Failed to resolve complaint' });
  }
};

const deleteComplaint = async (req, res) => {
  try {
    const complaint = await Complaint.findByIdAndDelete(req.params.id);
    if (!complaint) {
      return res.status(404).json({ message: 'Complaint not found' });
    }

    emitToAll('complaint:deleted', { _id: req.params.id });

    await logAudit({
      user: req.user,
      action: 'delete',
      entity: 'Complaint',
      entityId: req.params.id,
      changes: { subject: complaint.subject },
      ipAddress: req.ip,
    });

    res.json({ message: 'Complaint deleted' });
  } catch (error) {
    console.error('Error deleting complaint:', error);
    res.status(500).json({ message: 'Failed to delete complaint' });
  }
};

module.exports = {
  getComplaints,
  getComplaint,
  createComplaint,
  updateComplaint,
  resolveComplaint,
  deleteComplaint,
};
