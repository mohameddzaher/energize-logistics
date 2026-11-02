/**
 * Media Go complaints: reports of screen faults on our motorcycles.
 * GET/POST /api/b2c/mediago-complaints, GET /meta, GET /motorcycles?q=, GET /:id, POST /:id/files, PATCH /:id/status, POST /:id/replies, DELETE /:id
 * We file and close; Media Go (`mediago_account`) reads all, sets in-progress then fixed, and replies, but cannot create, delete, edit fields or change a closed report; both talk live (`mediago:complaint`).
 * Attachments per request total at most 18 MB (body limit 25 MB, base64 adds a third): image up to 8, clip up to 15; up to five files per report.
 */
const mongoose = require('mongoose');
const MediaGoComplaint = require('../models/MediaGoComplaint');
const { MEDIAGO_VOCAB } = MediaGoComplaint;
const User = require('../models/User');
const { VehicleMaster } = require('../models/VehicleMaster');
const { saveUploadFile, deleteStoredFile } = require('../utils/fileStore');
const { MEDIAGO_ROLE, isScopedRole } = require('../config/scopedRoles');
const logAudit = require('../utils/auditLogger');

const S = (v) => String(v == null ? '' : v).trim();
const nameOf = (u) => [u?.firstName, u?.lastName].filter(Boolean).join(' ') || u?.email || '';
const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const fold = (s) => S(s).toLowerCase().replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي');

const MAX_FILES = 5;
const MB = 1024 * 1024;
const LIMITS = { image: 8 * MB, video: 15 * MB, request: 18 * MB };

/** Who files a report: section heads, their project managers and supervisors, and anyone granted edit on the section. */
const CREATE_ROLES = ['super_admin', 'admin', 'b2c_manager', 'b2c_deputy', 'b2c_project_lead', 'b2c_rep_supervisor', 'b2c_inspection_supervisor'];
/** Deletion cannot be undone: sector manager, deputy and system admin only. */
// Top management is included too; whoever can delete can edit, so it is the same list.
const DELETE_ROLES = ['super_admin', 'admin', 'b2c_manager', 'b2c_deputy'];
const EDIT_ROLES = DELETE_ROLES;
/** What Media Go can say about a report: it cannot reopen or close it. */
const PARTNER_STATUSES = ['in_progress', 'fixed'];

/**
 * Status moves forward only. Media Go used to send a fixed report back to in-progress while keeping the fix date, leaving an in-progress report with a fix date. So each status has a defined next:
 * Media Go: new -> in progress / fixed; in progress -> fixed. No going back.
 * Energize: can undo a fix by closing it, or reopen with a written reason (the fix date is cleared but stays in the log), and close any.
 */
const NEXT = {
  mediago: { new: ['in_progress', 'fixed'], in_progress: ['fixed'], fixed: [], closed: [] },
  energize: { new: ['in_progress', 'fixed', 'closed'], in_progress: ['fixed', 'closed'], fixed: ['closed', 'in_progress'], closed: ['in_progress'] },
};
/** Going backward is allowed only with a reason. */
const isReopen = (from, to) => (from === 'fixed' || from === 'closed') && (to === 'in_progress' || to === 'new');
const nextStatuses = (status, partner) => NEXT[partner ? 'mediago' : 'energize'][status] || [];

const isPartner = (user) => user?.role === MEDIAGO_ROLE || isScopedRole(user?.role);
const sideOf = (user) => (isPartner(user) ? 'mediago' : 'energize');
const canCreate = (req) => !isPartner(req.user)
  && (CREATE_ROLES.includes(req.user?.role) || req.sectionAccess === 'edit');

const label = (group, key, lang = 'ar') => {
  const x = (MEDIAGO_VOCAB[group] || []).find((v) => v.key === key);
  return x ? x[lang] : key || '';
};

/** Reader permissions: both screens read them so they never show a button the server rejects. */
const abilities = (req) => {
  const partner = isPartner(req.user);
  return {
    partner,
    create: canCreate(req),
    delete: DELETE_ROLES.includes(req.user?.role),
    edit: EDIT_ROLES.includes(req.user?.role),
    reply: true,
    statuses: partner ? PARTNER_STATUSES : MEDIAGO_VOCAB.status.map((s) => s.key),
  };
};

const kindOf = (mime) => (String(mime || '').startsWith('video/') ? 'video' : 'image');

/** Saves the request's attachments and returns what is written on the report. Rejects before writing anything: a type that is not image or clip, a file over its limit, or a total over the request limit. */
function saveFiles(list, already, user) {
  const files = Array.isArray(list) ? list.filter((f) => f && f.dataUrl) : [];
  if (!files.length) return [];
  if (already + files.length > MAX_FILES) {
    const e = new Error(`الحدّ ${MAX_FILES} ملفّات للبلاغ / At most ${MAX_FILES} files per complaint`); e.status = 400; throw e;
  }
  let total = 0;
  const parsed = files.map((f) => {
    const m = /^data:([^;]+);base64,/.exec(f.dataUrl);
    const mime = m ? m[1].toLowerCase() : '';
    if (!/^(image|video)\//.test(mime)) {
      const e = new Error('المرفقات صور أو مقاطع فيديو فقط / Images or videos only'); e.status = 400; throw e;
    }
    const bytes = Math.floor((f.dataUrl.length - f.dataUrl.indexOf(',') - 1) * 3 / 4);
    const kind = kindOf(mime);
    if (bytes > LIMITS[kind]) {
      const e = new Error(kind === 'video'
        ? 'المقطع أكبر من 15 ميغا / Video larger than 15 MB'
        : 'الصورة أكبر من 8 ميغا / Image larger than 8 MB');
      e.status = 400; throw e;
    }
    total += bytes;
    return { f, kind };
  });
  if (total > LIMITS.request) {
    const e = new Error('مجموع المرفقات أكبر من 18 ميغا — أرفق الباقي بعد الحفظ / Attachments exceed 18 MB in one go — add the rest after saving');
    e.status = 400; throw e;
  }
  const saved = [];
  try {
    for (const { f, kind } of parsed) {
      const meta = saveUploadFile(f.dataUrl, 'mediago', S(f.fileName || f.title).slice(0, 200), { allowVideo: true, maxBytes: LIMITS[kind] });
      saved.push({ ...meta, kind, uploadedBy: user?._id || null, uploadedAt: new Date() });
    }
  } catch (err) {
    saved.forEach((x) => deleteStoredFile(x.fileUrl));
    const e = new Error(err.message || 'تعذّر حفظ الملف'); e.status = 400; throw e;
  }
  return saved;
}

// Notification and broadcast.
const announce = (id, action) => {
  try {
    const { emitToAll, emitToRole } = require('../websocket/socketManager');
    const payload = { id: String(id), action, at: Date.now() };
    emitToAll('mediago:complaint', payload);
    emitToRole(MEDIAGO_ROLE, 'mediago:complaint', payload);
  } catch (_) { /* Broadcast is an enhancement, not a requirement. */ }
};

/** To all Media Go accounts (normally one). */
async function notifyPartner({ type, title, message, id }) {
  try {
    const { createNotification } = require('../services/notificationService');
    const users = await User.find({ role: MEDIAGO_ROLE, isActive: true }).select('_id').lean();
    await Promise.all(users.map((u) => createNotification({
      recipient: u._id, type, title, message, relatedEntity: 'MediaGoComplaint', relatedEntityId: id,
    }).catch(() => null)));
  } catch (_) { /* A notification failure must not fail the action. */ }
}

/** To our side: the section notification (its manager sees it) and the reporter by name if they are not among those who see it. */
async function notifyOurSide(doc, { type, title, message }) {
  try {
    const { createNotification, notifySection } = require('../services/notificationService');
    await notifySection('B2C', { type, title, message, relatedEntity: 'MediaGoComplaint', relatedEntityId: doc._id });
    if (doc.createdBy) {
      const creator = await User.findById(doc.createdBy).select('role isActive').lean();
      if (creator && creator.isActive && !['super_admin', 'b2c_manager'].includes(creator.role)) {
        await createNotification({ recipient: creator._id, type, title, message, relatedEntity: 'MediaGoComplaint', relatedEntityId: doc._id });
      }
    }
  } catch (_) { /* A notification failure must not fail the action. */ }
}

// Row as displayed.
const listRow = (d) => ({
  _id: d._id, ref: d.ref, seq: d.seq, vehicle: d.vehicle || null,
  motorcycleNumber: d.motorcycleNumber, plateNumber: d.plateNumber || '', serialNumber: d.serialNumber || '', project: d.project || '',
  screenNumber: d.screenNumber || '',
  issue: d.issue, issueOther: d.issueOther || '',
  location: d.location, availability: d.availability, availabilityOther: d.availabilityOther || '',
  status: d.status, fixedAt: d.fixedAt, closedAt: d.closedAt,
  fileCount: (d.files || []).length,
  cover: ((d.files || []).find((f) => f.kind === 'image') || {}).fileUrl || '',
  hasVideo: (d.files || []).some((f) => f.kind === 'video'),
  replyCount: (d.replies || []).length,
  lastReply: (d.replies || []).length ? d.replies[d.replies.length - 1] : null,
  createdByName: d.createdByName || '', createdAt: d.createdAt, updatedAt: d.updatedAt,
});

const fullRow = (d, partner = false) => ({
  ...listRow(d),
  // What it may become now; both screens read it so they never offer a status the server rejects.
  nextStatuses: nextStatuses(d.status, partner),
  files: d.files || [],
  statusHistory: d.statusHistory || [],
  replies: d.replies || [],
});

const dayStart = (iso) => (/^\d{4}-\d{2}-\d{2}$/.test(S(iso)) ? new Date(`${iso}T00:00:00+03:00`) : null);

// List.
exports.list = async (req, res) => {
  try {
    const q = req.query || {};
    const base = {};
    const from = dayStart(q.from); const to = dayStart(q.to);
    if (from || to) {
      base.createdAt = {};
      if (from) base.createdAt.$gte = from;
      if (to) base.createdAt.$lt = new Date(to.getTime() + 86400000);
    }
    const docs = await MediaGoComplaint.find(base).sort({ createdAt: -1 }).limit(5000).lean();

    // Search reads what is written in the report, with Arabic folded as elsewhere in the system.
    const needle = fold(q.q);
    const searched = needle
      ? docs.filter((d) => fold([d.ref, d.motorcycleNumber, d.plateNumber, d.serialNumber, d.screenNumber, d.project,
        d.issueOther, d.availabilityOther, d.createdByName, label('issue', d.issue), label('issue', d.issue, 'en')].join(' ')).includes(needle))
      : docs;

    // Counters must not jump on click: each group is counted with all filters except its own, so status cards stay the same when one is selected and their sum equals what was shown before selecting.
    const FIELDS = ['status', 'issue', 'location', 'availability'];
    const want = Object.fromEntries(FIELDS.map((f) => [f, S(q[f])]));
    const pass = (d, skip) => FIELDS.every((f) => f === skip || !want[f] || d[f] === want[f]);
    const counts = {};
    for (const f of FIELDS) {
      counts[f] = {};
      for (const d of searched) if (pass(d, f)) counts[f][d[f]] = (counts[f][d[f]] || 0) + 1;
    }
    const rows = searched.filter((d) => pass(d, null));
    res.json({
      items: rows.map(listRow),
      total: rows.length,
      grandTotal: searched.filter((d) => pass(d, 'status')).length,
      counts,
      meta: MEDIAGO_VOCAB,
      can: abilities(req),
    });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
};

exports.meta = async (req, res) => {
  res.json({ meta: MEDIAGO_VOCAB, can: abilities(req), limits: { maxFiles: MAX_FILES, imageMB: 8, videoMB: 15, requestMB: 18 } });
};

// Light-transport motorcycles: from the vehicle register itself (light-transport sector or its projects), type motorcycle (registered as one label in the register and another in the section sheet; see lightTransportController).
const LT_VEHICLE_PROJECTS = /^(كيتا|هنجرستيشن|هنقرستيشن|امازون|أمازون|نينجا)$/;
exports.motorcycles = async (req, res) => {
  try {
    const q = S(req.query.q).slice(0, 40);
    const and = [
      { isActive: { $ne: false } },
      { $or: [{ sectorAr: /خفيف/ }, { departmentAr: LT_VEHICLE_PROJECTS }] },
      { registrationTypeAr: /دراج/ },
    ];
    if (q) {
      const rx = new RegExp(esc(q).replace(/\s+/g, '\\s*'), 'i');
      const digits = q.replace(/\D/g, '');
      and.push({ $or: [
        { plateNumber: rx }, { serialNumber: rx }, { 'actualDriver.name': rx }, { departmentAr: rx },
        ...(digits ? [{ plateDigits: new RegExp(esc(digits)) }] : []),
      ] });
    }
    const rows = await VehicleMaster.find({ $and: and })
      .select('plateNumber serialNumber departmentAr cityAr actualDriver registrationTypeAr')
      .sort({ plateNumber: 1 }).limit(q ? 40 : 400).lean();
    res.json({
      items: rows.map((v) => ({
        _id: v._id, plateNumber: v.plateNumber || '', serialNumber: v.serialNumber || '',
        project: v.departmentAr || '', city: v.cityAr || '', driverName: v.actualDriver?.name || '',
      })),
    });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
};

exports.getOne = async (req, res) => {
  try {
    const d = await MediaGoComplaint.findById(req.params.id).lean();
    if (!d) return res.status(404).json({ message: 'البلاغ غير موجود / Complaint not found' });
    res.json({ item: fullRow(d, isPartner(req.user)), meta: MEDIAGO_VOCAB, can: abilities(req) });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
};

// Filing a report.
// Report fields themselves, read by both create and edit.
async function readFields(b) {
  const keys = (g) => MEDIAGO_VOCAB[g].map((x) => x.key);
  const issue = S(b.issue); const availability = S(b.availability);
  const problems = [];
  if (!keys('issue').includes(issue)) problems.push('المشكلة / Issue');
  if (issue === 'other' && !S(b.issueOther)) problems.push('وصف المشكلة / Describe the issue');
  if (!keys('availability').includes(availability)) problems.push('وقت التوفّر / Availability');
  if (availability === 'other' && !S(b.availabilityOther)) problems.push('الوقت المناسب / Preferred time');
  let vehicle = null;
  if (b.vehicle && mongoose.Types.ObjectId.isValid(String(b.vehicle))) {
    vehicle = await VehicleMaster.findById(b.vehicle).select('plateNumber serialNumber departmentAr').lean();
  }
  const motorcycleNumber = S(b.motorcycleNumber) || (vehicle ? (vehicle.plateNumber || vehicle.serialNumber) : '');
  if (!motorcycleNumber) problems.push('رقم الدبّاب / Motorcycle number');
  return {
    problems,
    fields: {
      vehicle: vehicle?._id || null,
      motorcycleNumber: motorcycleNumber.slice(0, 60),
      plateNumber: vehicle?.plateNumber || '', serialNumber: vehicle?.serialNumber || '', project: vehicle?.departmentAr || '',
      screenNumber: S(b.screenNumber).slice(0, 60),
      issue, issueOther: issue === 'other' ? S(b.issueOther).slice(0, 500) : '',
      // Maintenance location is always Energize, never read from the request.
      location: 'energize',
      availability, availabilityOther: availability === 'other' ? S(b.availabilityOther).slice(0, 200) : '',
    },
  };
}

// Editing a report: system admin, top management and the two section heads.
const EDIT_FIELDS = ['vehicle', 'motorcycleNumber', 'plateNumber', 'serialNumber', 'project', 'screenNumber', 'issue', 'issueOther', 'location', 'availability', 'availabilityOther'];
exports.update = async (req, res) => {
  try {
    const doc = await MediaGoComplaint.findById(req.params.id);
    if (!doc) return res.status(404).json({ message: 'البلاغ غير موجود / Complaint not found' });
    const { problems, fields } = await readFields(req.body || {});
    if (problems.length) return res.status(400).json({ message: `حقول مطلوبة: ${problems.join('، ')}`, fields: problems });
    const val = (v) => (v == null ? '' : String(v));
    const before = {}; const after = {};
    for (const k of EDIT_FIELDS) {
      if (val(doc[k]) !== val(fields[k])) { before[k] = doc[k] ?? null; after[k] = fields[k]; doc[k] = fields[k]; }
    }
    if (!Object.keys(after).length) return res.json({ item: fullRow(doc.toObject(), isPartner(req.user)), unchanged: true });
    await doc.save();
    await logAudit({
      user: req.user, action: 'update', entity: 'MediaGoComplaint', entityId: doc._id,
      changes: { before, after }, details: `${doc.ref} — ${Object.keys(after).join(', ')}`,
    });
    announce(doc._id, 'updated');
    await notifyPartner({
      type: 'general', id: doc._id,
      title: `عُدِّل البلاغ ${doc.ref} / Complaint ${doc.ref} updated`,
      message: `${doc.motorcycleNumber} — ${label('issue', doc.issue)} / ${label('issue', doc.issue, 'en')}`,
    });
    res.json({ item: fullRow(doc.toObject(), isPartner(req.user)) });
  } catch (e) {
    res.status(400).json({ message: e.message });
  }
};

exports.create = async (req, res) => {
  if (!canCreate(req)) return res.status(403).json({ message: 'رفع البلاغات لقسم الأفراد' });
  const b = req.body || {};
  const keys = (g) => MEDIAGO_VOCAB[g].map((x) => x.key);
  // Maintenance location is always Energize. The Hero Mail option is not ours, so the question was removed from the form and the location is written here. The field stays in the form model for older reports and is shown read-only in the detail.
  const issue = S(b.issue); const location = 'energize'; const availability = S(b.availability);
  const problems = [];
  if (!keys('issue').includes(issue)) problems.push('المشكلة / Issue');
  if (issue === 'other' && !S(b.issueOther)) problems.push('وصف المشكلة / Describe the issue');
  if (!keys('availability').includes(availability)) problems.push('وقت التوفّر / Availability');
  if (availability === 'other' && !S(b.availabilityOther)) problems.push('الوقت المناسب / Preferred time');

  // Motorcycle: from the register if selected, otherwise what was typed.
  let vehicle = null;
  if (b.vehicle && mongoose.Types.ObjectId.isValid(String(b.vehicle))) {
    vehicle = await VehicleMaster.findById(b.vehicle).select('plateNumber serialNumber departmentAr').lean();
  }
  const motorcycleNumber = S(b.motorcycleNumber) || (vehicle ? (vehicle.plateNumber || vehicle.serialNumber) : '');
  if (!motorcycleNumber) problems.push('رقم الدبّاب / Motorcycle number');
  if (problems.length) return res.status(400).json({ message: `حقول مطلوبة: ${problems.join('، ')}`, fields: problems });

  let files = [];
  try {
    files = saveFiles(b.files, 0, req.user);
  } catch (e) {
    return res.status(e.status || 400).json({ message: e.message });
  }
  try {
    const by = nameOf(req.user);
    const doc = new MediaGoComplaint({
      vehicle: vehicle?._id || null,
      motorcycleNumber: motorcycleNumber.slice(0, 60),
      plateNumber: vehicle?.plateNumber || '', serialNumber: vehicle?.serialNumber || '', project: vehicle?.departmentAr || '',
      screenNumber: S(b.screenNumber).slice(0, 60),
      files,
      issue, issueOther: issue === 'other' ? S(b.issueOther).slice(0, 500) : '',
      location,
      availability, availabilityOther: availability === 'other' ? S(b.availabilityOther).slice(0, 200) : '',
      status: 'new',
      statusHistory: [{ status: 'new', by: req.user._id, byName: by, side: 'energize', at: new Date() }],
      createdBy: req.user._id, createdByName: by,
    });
    await doc.save();
    await logAudit({ user: req.user, action: 'create', entity: 'MediaGoComplaint', entityId: doc._id, details: `${doc.ref} — ${doc.motorcycleNumber}` });
    announce(doc._id, 'created');
    await notifyPartner({
      type: 'complaint_assigned', id: doc._id,
      title: `بلاغ جديد ${doc.ref} / New complaint ${doc.ref}`,
      message: `${label('issue', issue)} — ${doc.motorcycleNumber} / ${label('issue', issue, 'en')}`,
    });
    res.status(201).json({ item: fullRow(doc.toObject(), isPartner(req.user)) });
  } catch (e) {
    files.forEach((f) => deleteStoredFile(f.fileUrl));
    res.status(400).json({ message: e.message });
  }
};

// Later attachment.
exports.addFiles = async (req, res) => {
  if (!canCreate(req)) return res.status(403).json({ message: 'الإرفاق لقسم الأفراد' });
  try {
    const doc = await MediaGoComplaint.findById(req.params.id);
    if (!doc) return res.status(404).json({ message: 'البلاغ غير موجود / Complaint not found' });
    let files;
    try { files = saveFiles(req.body?.files, doc.files.length, req.user); } catch (e) { return res.status(e.status || 400).json({ message: e.message }); }
    if (!files.length) return res.status(400).json({ message: 'لا ملفات / No files' });
    doc.files.push(...files);
    await doc.save();
    await logAudit({ user: req.user, action: 'update', entity: 'MediaGoComplaint', entityId: doc._id, details: `${doc.ref} — +${files.length} مرفق` });
    announce(doc._id, 'files');
    res.json({ item: fullRow(doc.toObject(), isPartner(req.user)) });
  } catch (e) {
    res.status(400).json({ message: e.message });
  }
};

// Status.
exports.setStatus = async (req, res) => {
  try {
    const status = S(req.body?.status);
    const note = S(req.body?.note).slice(0, 500);
    const can = abilities(req);
    if (!can.statuses.includes(status)) {
      return res.status(can.partner ? 403 : 400).json({ message: 'حالة غير مسموحة / Status not allowed' });
    }
    const doc = await MediaGoComplaint.findById(req.params.id);
    if (!doc) return res.status(404).json({ message: 'البلاغ غير موجود / Complaint not found' });
    if (can.partner && doc.status === 'closed') {
      return res.status(403).json({ message: 'البلاغ مغلق / This complaint is closed' });
    }
    if (doc.status === status && !note) return res.json({ item: fullRow(doc.toObject(), isPartner(req.user)) });
    if (doc.status !== status && !nextStatuses(doc.status, can.partner).includes(status)) {
      return res.status(400).json({ message: `لا يُنقَل البلاغ من «${label('status', doc.status)}» إلى «${label('status', status)}» / Not allowed from “${label('status', doc.status, 'en')}” to “${label('status', status, 'en')}”` });
    }
    if (isReopen(doc.status, status) && !note) {
      return res.status(400).json({ message: 'اكتب سبب إعادة الفتح / Write why it is reopened' });
    }
    const side = sideOf(req.user);
    const by = nameOf(req.user);
    const prev = doc.status;
    doc.status = status;
    // The fix date applies only to the fixed state and later ones: reopening clears it (it stays in the log) and a second fix writes its own date.
    if (status === 'fixed') doc.fixedAt = new Date();
    if (status === 'closed') doc.closedAt = new Date();
    if (status === 'new' || status === 'in_progress') { doc.closedAt = null; doc.fixedAt = null; }
    doc.statusHistory.push({ status, note, by: req.user._id, byName: by, side, at: new Date() });
    // A note given with a status also appears in the conversation, where the other party looks for it.
    if (note) doc.replies.push({ text: note, by: req.user._id, byName: by, side, at: new Date() });
    await doc.save();
    await logAudit({ user: req.user, action: 'status_change', entity: 'MediaGoComplaint', entityId: doc._id, details: `${doc.ref}: ${prev} → ${status}` });
    announce(doc._id, 'status');
    const msg = {
      type: 'status_changed',
      title: `${doc.ref}: ${label('status', status)} / ${label('status', status, 'en')}`,
      message: `${doc.motorcycleNumber}${note ? ` — ${note}` : ''}`,
    };
    if (side === 'mediago') await notifyOurSide(doc, msg);
    else await notifyPartner({ ...msg, id: doc._id });
    res.json({ item: fullRow(doc.toObject(), isPartner(req.user)) });
  } catch (e) {
    res.status(400).json({ message: e.message });
  }
};

// Replies.
exports.reply = async (req, res) => {
  try {
    const text = S(req.body?.text).slice(0, 2000);
    if (!text) return res.status(400).json({ message: 'اكتب الرد / Write a reply' });
    const doc = await MediaGoComplaint.findById(req.params.id);
    if (!doc) return res.status(404).json({ message: 'البلاغ غير موجود / Complaint not found' });
    const side = sideOf(req.user);
    doc.replies.push({ text, by: req.user._id, byName: nameOf(req.user), side, at: new Date() });
    await doc.save();
    await logAudit({ user: req.user, action: 'reply', entity: 'MediaGoComplaint', entityId: doc._id, details: `${doc.ref}: ${text.slice(0, 120)}` });
    announce(doc._id, 'reply');
    const msg = {
      type: 'general',
      title: side === 'mediago' ? `ردّ من Media Go على ${doc.ref}` : `Reply from Energize on ${doc.ref} / ردّ على ${doc.ref}`,
      message: text.slice(0, 200),
    };
    if (side === 'mediago') await notifyOurSide(doc, msg);
    else await notifyPartner({ ...msg, id: doc._id });
    res.json({ item: fullRow(doc.toObject(), isPartner(req.user)) });
  } catch (e) {
    res.status(400).json({ message: e.message });
  }
};

exports.remove = async (req, res) => {
  try {
    const doc = await MediaGoComplaint.findById(req.params.id);
    if (!doc) return res.status(404).json({ message: 'البلاغ غير موجود / Complaint not found' });
    await doc.deleteOne();
    (doc.files || []).forEach((f) => deleteStoredFile(f.fileUrl));
    await logAudit({ user: req.user, action: 'delete', entity: 'MediaGoComplaint', entityId: doc._id, details: `${doc.ref} — ${doc.motorcycleNumber}` });
    announce(doc._id, 'deleted');
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ message: e.message });
  }
};

exports.CREATE_ROLES = CREATE_ROLES;
exports.DELETE_ROLES = DELETE_ROLES;
exports.EDIT_ROLES = EDIT_ROLES;
