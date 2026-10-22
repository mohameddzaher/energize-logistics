/**
 * المحتوى الإعلانيّ — طلباتُ Media Go لتصوير إعلاناتها على مركباتنا (راجع models/MediaGoAdRequest).
 *
 *   GET    /api/b2c/mediago-ads                         القائمة + العدّادات + المفردات + ما يملكه القارئ
 *   GET    /api/b2c/mediago-ads/meta                    المفرداتُ وشركاتُ الإعلان
 *   GET    /api/b2c/mediago-ads/vehicles?q=             مركباتُ النقل الخفيف (للطرفين)
 *   POST   /api/b2c/mediago-ads                         طلبٌ جديد (Media Go، ومَن في القسم نيابةً عنها)
 *   GET    /api/b2c/mediago-ads/:id                     الطلبُ كاملًا
 *   POST   /api/b2c/mediago-ads/:id/items/:itemId/files ملفّاتُ تحقّق مركبة (نحن)
 *   DELETE /api/b2c/mediago-ads/:id/items/:itemId/files/:fileId
 *   PATCH  /api/b2c/mediago-ads/:id/items/:itemId       جاهزة/غير جاهزة، نوعُ التصوير، ملاحظة (نحن)
 *   POST   /api/b2c/mediago-ads/:id/files               ملفّاتُ طلبٍ بلا مركبات (نحن)
 *   DELETE /api/b2c/mediago-ads/:id/files/:fileId
 *   POST   /api/b2c/mediago-ads/:id/deliver             «تمّ» — يصل Media Go (نحن، وكلُّ مركبةٍ جاهزة)
 *   PATCH  /api/b2c/mediago-ads/:id/status              إغلاقٌ أو إعادةُ فتح (نحن) · إلغاءٌ قبل التسليم (Media Go)
 *   POST   /api/b2c/mediago-ads/:id/replies             ملاحظةٌ في المحادثة (الطرفان)
 *   DELETE /api/b2c/mediago-ads/:id                     حذف (رؤوسُ القسم)
 */
const mongoose = require('mongoose');
const MediaGoAdRequest = require('../models/MediaGoAdRequest');
const { AD_VOCAB } = MediaGoAdRequest;
const User = require('../models/User');
const { VehicleMaster } = require('../models/VehicleMaster');
const { saveUploadFile, deleteStoredFile } = require('../utils/fileStore');
const { MEDIAGO_ROLE, isScopedRole } = require('../config/scopedRoles');
const logAudit = require('../utils/auditLogger');

const S = (v) => String(v == null ? '' : v).trim();
const nameOf = (u) => [u?.firstName, u?.lastName].filter(Boolean).join(' ') || u?.email || '';
const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const fold = (s) => S(s).toLowerCase().replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي');

const MB = 1024 * 1024;
const LIMITS = { image: 8 * MB, video: 15 * MB, request: 18 * MB };
const MAX_VIDEO_SEC = 15;
const MAX_FILES_PER_ITEM = 10;

/** رؤوسُ القسم ومشرفوه — يصوّرون ويسلّمون ويغلقون. */
const OUR_ROLES = ['super_admin', 'admin', 'b2c_manager', 'b2c_deputy', 'b2c_project_lead', 'b2c_rep_supervisor', 'b2c_inspection_supervisor'];
const DELETE_ROLES = ['super_admin', 'admin', 'b2c_manager', 'b2c_deputy'];
const COMPANY_TYPE = 'mediago_ad_company';
/** شركتُنا — الطلبُ لها يُختار فيه مركباتُنا. */
const OUR_COMPANY_KEY = 'energize';

const isPartner = (u) => u?.role === MEDIAGO_ROLE || isScopedRole(u?.role);
const sideOf = (u) => (isPartner(u) ? 'mediago' : 'energize');
const ours = (req) => !isPartner(req.user) && (OUR_ROLES.includes(req.user?.role) || req.sectionAccess === 'edit');
const label = (group, key, lang = 'ar') => ((AD_VOCAB[group] || []).find((v) => v.key === key) || {})[lang] || key || '';
const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });

async function companies() {
  const Lookup = require('../models/Lookup');
  const rows = await Lookup.find({ type: COMPANY_TYPE, isActive: { $ne: false }, deleted: { $ne: true } }).sort({ order: 1 }).lean().catch(() => []);
  if (rows.length) return rows.map((r) => ({ key: r.key, nameAr: r.nameAr, nameEn: r.nameEn || r.nameAr }));
  const { byType } = require('../config/lookupTypes');
  return (byType(COMPANY_TYPE)?.seed || []).map((r) => ({ key: r.key, nameAr: r.nameAr, nameEn: r.nameEn }));
}

const abilities = (req) => {
  const partner = isPartner(req.user);
  return {
    partner,
    create: partner || ours(req),
    shoot: ours(req),
    deliver: ours(req),
    close: ours(req),
    cancel: partner || ours(req),
    delete: DELETE_ROLES.includes(req.user?.role),
    reply: true,
  };
};

/** البثُّ إلى الطرفين — Media Go لا يصلها البثُّ العامّ فيُرسَل إلى دورها. */
const announce = (id, action) => {
  try {
    const { emitToAll, emitToRole } = require('../websocket/socketManager');
    const payload = { id: String(id), action, at: Date.now() };
    emitToAll('mediago:ad', payload);
    emitToRole(MEDIAGO_ROLE, 'mediago:ad', payload);
  } catch (_) { /* تحسين */ }
};
async function notifyPartner({ title, message, id }) {
  try {
    const { createNotification } = require('../services/notificationService');
    const users = await User.find({ role: MEDIAGO_ROLE, isActive: true }).select('_id').lean();
    await Promise.all(users.map((u) => createNotification({
      recipient: u._id, type: 'status_changed', title, message, relatedEntity: 'MediaGoAdRequest', relatedEntityId: id,
    }).catch(() => null)));
  } catch (_) { /* */ }
}
async function notifyOurSide({ title, message, id }) {
  try {
    const { notifySection } = require('../services/notificationService');
    await notifySection('B2C', { type: 'status_changed', title, message, relatedEntity: 'MediaGoAdRequest', relatedEntityId: id });
  } catch (_) { /* */ }
}

const kindOf = (mime) => (String(mime || '').startsWith('video/') ? 'video' : 'image');
/** يحفظ ملفّاتِ تحقّق — صورًا (حتى ٨ ميغا) أو مقاطعَ (١٥ ثانيةً و١٥ ميغا على الأكثر). */
function saveFiles(list, user, want) {
  const files = Array.isArray(list) ? list.filter((f) => f && f.dataUrl) : [];
  if (!files.length) throw bad('لا ملفات / No files');
  let total = 0;
  const parsed = files.map((f) => {
    const m = /^data:([^;]+);base64,/.exec(f.dataUrl);
    const mime = m ? m[1].toLowerCase() : '';
    if (!/^(image|video)\//.test(mime)) throw bad('صور أو مقاطع فيديو فقط / Images or videos only');
    const kind = kindOf(mime);
    if (want === 'photo' && kind !== 'image') throw bad('المطلوب صور لهذه المركبة / Photos are required here');
    if (want === 'video' && kind !== 'video') throw bad('المطلوب فيديو لهذه المركبة / A video is required here');
    const bytes = Math.floor((f.dataUrl.length - f.dataUrl.indexOf(',') - 1) * 3 / 4);
    if (bytes > LIMITS[kind]) throw bad(kind === 'video' ? 'المقطع أكبر من 15 ميغا / Video over 15 MB' : 'الصورة أكبر من 8 ميغا / Image over 8 MB');
    const dur = f.durationSec == null || f.durationSec === '' ? null : Number(f.durationSec);
    if (kind === 'video' && dur != null && Number.isFinite(dur) && dur > MAX_VIDEO_SEC + 0.5) {
      throw bad(`المقطع ${Math.round(dur)} ثانية — الحدّ ${MAX_VIDEO_SEC} ثانية / Video is longer than ${MAX_VIDEO_SEC}s`);
    }
    total += bytes;
    return { f, kind, dur: Number.isFinite(dur) ? Math.round(dur * 10) / 10 : null };
  });
  if (total > LIMITS.request) throw bad('مجموع الملفات أكبر من 18 ميغا في الرفعة الواحدة — ارفع الباقي بعدها / Over 18 MB in one upload');
  const saved = [];
  try {
    for (const { f, kind, dur } of parsed) {
      const meta = saveUploadFile(f.dataUrl, 'mediago', S(f.fileName).slice(0, 200), { allowVideo: true, maxBytes: LIMITS[kind] });
      saved.push({ ...meta, kind, durationSec: dur, uploadedBy: user?._id || null, uploadedByName: nameOf(user), uploadedAt: new Date() });
    }
  } catch (err) {
    saved.forEach((x) => deleteStoredFile(x.fileUrl));
    throw bad(err.message || 'تعذّر حفظ الملف');
  }
  return saved;
}

// ── الصفّ كما يُعرَض ─────────────────────────────────────────────────────────
const listRow = (d) => {
  const items = d.items || [];
  const cover = (items.flatMap((i) => i.files || []).concat(d.files || [])).find((f) => f.kind === 'image');
  return {
    _id: d._id, ref: d.ref, adName: d.adName, company: d.company, companyKey: d.companyKey,
    mediaType: d.mediaType, location: d.location, note: d.note || '', neededBy: d.neededBy || '',
    status: d.status, vehicles: items.map((i) => i.plateNumber).filter(Boolean),
    vehicleCount: items.length, readyCount: items.filter((i) => i.ready).length,
    fileCount: items.reduce((a, i) => a + (i.files || []).length, 0) + (d.files || []).length,
    cover: cover ? cover.fileUrl : '',
    replyCount: (d.replies || []).length,
    deliveredAt: d.deliveredAt, createdByName: d.createdByName, createdAt: d.createdAt, updatedAt: d.updatedAt,
  };
};
const fullRow = (d) => ({ ...listRow(d), items: d.items || [], files: d.files || [], statusHistory: d.statusHistory || [], replies: d.replies || [] });

const dayStart = (iso) => (/^\d{4}-\d{2}-\d{2}$/.test(S(iso)) ? new Date(`${iso}T00:00:00+03:00`) : null);

// ── القائمة ─────────────────────────────────────────────────────────────────
exports.list = async (req, res) => {
  try {
    const q = req.query || {};
    const base = {};
    const from = dayStart(q.from); const to = dayStart(q.to);
    if (from || to) base.createdAt = { ...(from ? { $gte: from } : {}), ...(to ? { $lt: new Date(to.getTime() + 86400000) } : {}) };
    if (q.vehicle && mongoose.isValidObjectId(q.vehicle)) base['items.vehicle'] = new mongoose.Types.ObjectId(String(q.vehicle));
    const rows = await MediaGoAdRequest.find(base)
      .select('ref adName company companyKey mediaType location note neededBy status items.plateNumber items.ready items.files.kind items.files.fileUrl files.kind files.fileUrl replies deliveredAt createdByName createdAt updatedAt')
      .sort({ createdAt: -1 }).lean();
    const needle = fold(q.q);
    const searched = needle ? rows.filter((d) => fold([d.ref, d.adName, d.company, d.note, ...(d.items || []).map((i) => i.plateNumber)].join(' ')).includes(needle)) : rows;
    // العددُ بجانب كلّ قيمةٍ بكلّ الفلاتر عدا فلترها — كفلاتر الأقسام.
    const FIELDS = ['status', 'company', 'mediaType', 'location'];
    const pick = Object.fromEntries(FIELDS.map((f) => [f, S(q[f]).split(',').map(S).filter(Boolean)]));
    const pass = (d, skip) => FIELDS.every((f) => f === skip || !pick[f].length || pick[f].includes(S(d[f])));
    const counts = {};
    for (const f of FIELDS) {
      counts[f] = {};
      for (const d of searched) if (pass(d, f)) counts[f][S(d[f])] = (counts[f][S(d[f])] || 0) + 1;
    }
    const shown = searched.filter((d) => pass(d, null));
    res.json({ items: shown.map(listRow), total: shown.length, grandTotal: rows.length, counts, meta: { ...AD_VOCAB, companies: await companies() }, can: abilities(req) });
  } catch (e) { res.status(500).json({ message: e.message }); }
};

exports.meta = async (req, res) => {
  try { res.json({ meta: { ...AD_VOCAB, companies: await companies() }, can: abilities(req) }); }
  catch (e) { res.status(500).json({ message: e.message }); }
};

/** مركباتُ النقل الخفيف — يختار منها الطرفان. (بلا أسماء السائقين لـ Media Go.) */
exports.vehicles = async (req, res) => {
  try {
    const q = S(req.query.q).slice(0, 40);
    const and = [{ isActive: { $ne: false } }, { sectorAr: /خفيف/ }];
    if (q) {
      const rx = new RegExp(esc(q).replace(/\s+/g, '\\s*'), 'i');
      const digits = q.replace(/\D/g, '');
      and.push({ $or: [{ plateNumber: rx }, { serialNumber: rx }, { departmentAr: rx }, ...(digits ? [{ plateDigits: new RegExp(esc(digits)) }] : [])] });
    }
    const rows = await VehicleMaster.find({ $and: and })
      .select('plateNumber serialNumber departmentAr cityAr registrationTypeAr')
      .sort({ plateNumber: 1 }).limit(q ? 60 : 600).lean();
    res.json({ items: rows.map((v) => ({ _id: v._id, plateNumber: v.plateNumber || '', serialNumber: v.serialNumber || '', project: v.departmentAr || '', city: v.cityAr || '', type: v.registrationTypeAr || '' })) });
  } catch (e) { res.status(500).json({ message: e.message }); }
};

exports.create = async (req, res) => {
  try {
    const can = abilities(req);
    if (!can.create) return res.status(403).json({ message: 'غير مسموح / Not allowed' });
    const b = req.body || {};
    const adName = S(b.adName).slice(0, 200);
    const list = await companies();
    const comp = list.find((c) => c.key === S(b.companyKey)) || list.find((c) => fold(c.nameAr) === fold(b.company));
    const mediaType = S(b.mediaType); const location = S(b.location);
    const problems = [];
    if (!adName) problems.push('اسم الإعلان / Ad name');
    if (!comp) problems.push('الشركة / Company');
    if (!AD_VOCAB.mediaType.some((x) => x.key === mediaType)) problems.push('صور أم فيديو / Photo or video');
    if (!AD_VOCAB.location.some((x) => x.key === location)) problems.push('بالإيواء أم بالطريق / Shelter or road');
    const neededBy = S(b.neededBy);
    if (neededBy && !/^\d{4}-\d{2}-\d{2}$/.test(neededBy)) problems.push('التاريخ / Date');
    const ids = [...new Set((Array.isArray(b.vehicleIds) ? b.vehicleIds : []).map(String))].filter((x) => mongoose.isValidObjectId(x)).slice(0, 200);
    if (comp && comp.key === OUR_COMPANY_KEY && !ids.length) problems.push('المركبات / Vehicles');
    if (problems.length) return res.status(400).json({ message: `حقول مطلوبة / Required: ${problems.join('، ')}`, fields: problems });
    const vs = ids.length ? await VehicleMaster.find({ _id: { $in: ids } }).select('plateNumber serialNumber departmentAr').lean() : [];
    const doc = await MediaGoAdRequest.create({
      adName, company: comp.nameAr, companyKey: comp.key, mediaType, location,
      note: S(b.note).slice(0, 2000), neededBy,
      items: vs.map((v) => ({ vehicle: v._id, plateNumber: v.plateNumber || '', serialNumber: v.serialNumber || '', project: v.departmentAr || '', mediaType })),
      status: 'new',
      statusHistory: [{ status: 'new', by: req.user._id, byName: nameOf(req.user), side: sideOf(req.user) }],
      createdBy: req.user._id, createdByName: nameOf(req.user), createdSide: sideOf(req.user),
    });
    await logAudit({ user: req.user, action: 'create', entity: 'MediaGoAdRequest', entityId: doc._id, details: `${doc.ref}: ${adName}` }).catch(() => {});
    announce(doc._id, 'created');
    const msg = { title: `طلب محتوى إعلاني ${doc.ref}`, message: `${adName} · ${comp.nameAr}${vs.length ? ` · ${vs.length} مركبة` : ''}`, id: doc._id };
    if (sideOf(req.user) === 'mediago') await notifyOurSide(msg); else await notifyPartner(msg);
    res.status(201).json({ item: fullRow(doc.toObject()) });
  } catch (e) { res.status(e.status || 400).json({ message: e.message }); }
};

exports.getOne = async (req, res) => {
  try {
    const d = await MediaGoAdRequest.findById(req.params.id).lean();
    if (!d) return res.status(404).json({ message: 'الطلب غير موجود / Request not found' });
    res.json({ item: fullRow(d), meta: { ...AD_VOCAB, companies: await companies() }, can: abilities(req) });
  } catch (e) { res.status(500).json({ message: e.message }); }
};

/** طلبٌ يُصوَّر الآن: لا يُرفع إلى مسلَّمٍ أو مغلقٍ أو ملغى. */
async function loadOpen(req) {
  const doc = await MediaGoAdRequest.findById(req.params.id);
  if (!doc) throw bad('الطلب غير موجود / Request not found', 404);
  if (!['new', 'in_progress'].includes(doc.status)) throw bad('الطلب سُلّم أو أُغلق — أعد فتحه أوّلًا / Delivered or closed — reopen it first');
  return doc;
}
const startIfNew = (doc, req) => {
  if (doc.status !== 'new') return;
  doc.status = 'in_progress';
  doc.statusHistory.push({ status: 'in_progress', by: req.user._id, byName: nameOf(req.user), side: 'energize' });
};

exports.addItemFiles = async (req, res) => {
  try {
    if (!abilities(req).shoot) return res.status(403).json({ message: 'التصوير لقسم الأفراد / Our side only' });
    const doc = await loadOpen(req);
    const item = doc.items.id(req.params.itemId);
    if (!item) throw bad('المركبة غير موجودة في الطلب', 404);
    if (req.body.mediaType && AD_VOCAB.mediaType.some((x) => x.key === req.body.mediaType)) item.mediaType = req.body.mediaType;
    const saved = saveFiles(req.body.files, req.user, item.mediaType);
    if (item.files.length + saved.length > MAX_FILES_PER_ITEM) { saved.forEach((x) => deleteStoredFile(x.fileUrl)); throw bad(`الحدّ ${MAX_FILES_PER_ITEM} ملفّات للمركبة`); }
    item.files.push(...saved);
    item.ready = false; item.readyAt = null; item.readyByName = '';
    startIfNew(doc, req);
    await doc.save();
    announce(doc._id, 'files');
    res.json({ item: fullRow(doc.toObject()) });
  } catch (e) { res.status(e.status || 400).json({ message: e.message }); }
};

exports.removeItemFile = async (req, res) => {
  try {
    if (!abilities(req).shoot) return res.status(403).json({ message: 'لقسم الأفراد / Our side only' });
    const doc = await loadOpen(req);
    const item = doc.items.id(req.params.itemId);
    const f = item && item.files.id(req.params.fileId);
    if (!f) throw bad('الملف غير موجود', 404);
    const url = f.fileUrl; f.deleteOne();
    if (!item.files.length) { item.ready = false; item.readyAt = null; item.readyByName = ''; }
    await doc.save(); deleteStoredFile(url);
    announce(doc._id, 'files');
    res.json({ item: fullRow(doc.toObject()) });
  } catch (e) { res.status(e.status || 400).json({ message: e.message }); }
};

/** «جاهزة» بعد المراجعة — ولا تكون جاهزةً بلا ملفّ. ونوعُ التصوير وملاحظةُ المركبة. */
exports.updateItem = async (req, res) => {
  try {
    if (!abilities(req).shoot) return res.status(403).json({ message: 'لقسم الأفراد / Our side only' });
    const doc = await loadOpen(req);
    const item = doc.items.id(req.params.itemId);
    if (!item) throw bad('المركبة غير موجودة في الطلب', 404);
    const b = req.body || {};
    if (b.mediaType !== undefined) {
      if (!AD_VOCAB.mediaType.some((x) => x.key === b.mediaType)) throw bad('نوعٌ غير معروف');
      if (item.files.length && item.mediaType !== b.mediaType) throw bad('احذف الملفّات أوّلًا ثمّ غيّر النوع');
      item.mediaType = b.mediaType;
    }
    if (b.note !== undefined) item.note = S(b.note).slice(0, 500);
    if (b.ready !== undefined) {
      if (b.ready && !item.files.length) throw bad('ارفع صور المركبة أو الفيديو أوّلًا / Upload first');
      item.ready = !!b.ready; item.readyAt = b.ready ? new Date() : null; item.readyByName = b.ready ? nameOf(req.user) : '';
    }
    await doc.save();
    announce(doc._id, 'item');
    res.json({ item: fullRow(doc.toObject()) });
  } catch (e) { res.status(e.status || 400).json({ message: e.message }); }
};

exports.addFiles = async (req, res) => {
  try {
    if (!abilities(req).shoot) return res.status(403).json({ message: 'لقسم الأفراد / Our side only' });
    const doc = await loadOpen(req);
    const saved = saveFiles(req.body.files, req.user, doc.mediaType);
    if (doc.files.length + saved.length > 20) { saved.forEach((x) => deleteStoredFile(x.fileUrl)); throw bad('الحدّ 20 ملفًّا للطلب'); }
    doc.files.push(...saved);
    startIfNew(doc, req);
    await doc.save();
    announce(doc._id, 'files');
    res.json({ item: fullRow(doc.toObject()) });
  } catch (e) { res.status(e.status || 400).json({ message: e.message }); }
};

exports.removeFile = async (req, res) => {
  try {
    if (!abilities(req).shoot) return res.status(403).json({ message: 'لقسم الأفراد / Our side only' });
    const doc = await loadOpen(req);
    const f = doc.files.id(req.params.fileId);
    if (!f) throw bad('الملف غير موجود', 404);
    const url = f.fileUrl; f.deleteOne();
    await doc.save(); deleteStoredFile(url);
    announce(doc._id, 'files');
    res.json({ item: fullRow(doc.toObject()) });
  } catch (e) { res.status(e.status || 400).json({ message: e.message }); }
};

/** «تمّ» — كلُّ مركبةٍ جاهزة (أو للطلب ملفّاتُه)، فيصل Media Go. */
exports.deliver = async (req, res) => {
  try {
    if (!abilities(req).deliver) return res.status(403).json({ message: 'التسليم لقسم الأفراد / Our side only' });
    const doc = await loadOpen(req);
    if (doc.items.length) {
      const notReady = doc.items.filter((i) => !i.ready).map((i) => i.plateNumber || i.serialNumber);
      if (notReady.length) throw bad(`لم تُراجَع بعد: ${notReady.slice(0, 8).join('، ')}${notReady.length > 8 ? '…' : ''}`);
    } else if (!doc.files.length) throw bad('ارفع الصور أو الفيديو أوّلًا / Upload first');
    const note = S(req.body?.note).slice(0, 2000);
    doc.status = 'delivered'; doc.deliveredAt = new Date(); doc.deliveredByName = nameOf(req.user);
    doc.statusHistory.push({ status: 'delivered', note, by: req.user._id, byName: nameOf(req.user), side: 'energize' });
    if (note) doc.replies.push({ text: note, by: req.user._id, byName: nameOf(req.user), side: 'energize' });
    await doc.save();
    await logAudit({ user: req.user, action: 'status_change', entity: 'MediaGoAdRequest', entityId: doc._id, details: `${doc.ref}: delivered` }).catch(() => {});
    announce(doc._id, 'delivered');
    await notifyPartner({ title: `${doc.ref}: المحتوى جاهز / Content delivered`, message: `${doc.adName}${doc.items.length ? ` · ${doc.items.length} مركبة` : ''}`, id: doc._id });
    res.json({ item: fullRow(doc.toObject()) });
  } catch (e) { res.status(e.status || 400).json({ message: e.message }); }
};

/**
 * الحالة: نحن نغلق المسلَّمَ ونعيد فتحَه (بسبب)، وMedia Go تلغي طلبَها قبل أن يُسلَّم.
 */
exports.setStatus = async (req, res) => {
  try {
    const status = S(req.body?.status); const note = S(req.body?.note).slice(0, 500);
    const doc = await MediaGoAdRequest.findById(req.params.id);
    if (!doc) return res.status(404).json({ message: 'الطلب غير موجود / Request not found' });
    const partner = isPartner(req.user);
    const from = doc.status;
    const allowed = partner
      ? { new: ['cancelled'], in_progress: ['cancelled'] }[from] || []
      : ({ new: ['cancelled'], in_progress: ['cancelled'], delivered: ['closed', 'in_progress'], closed: ['in_progress'], cancelled: ['new'] }[from] || []);
    if (!allowed.includes(status)) return res.status(400).json({ message: `لا يُنقَل من «${label('status', from)}» إلى «${label('status', status)}» / Not allowed` });
    if (!partner && !ours(req)) return res.status(403).json({ message: 'غير مسموح / Not allowed' });
    if ((status === 'in_progress' || status === 'cancelled') && ['delivered', 'closed'].includes(from) && !note) {
      return res.status(400).json({ message: 'اكتب السبب / Write the reason' });
    }
    doc.status = status;
    if (status === 'in_progress') { doc.deliveredAt = null; doc.deliveredByName = ''; }
    doc.statusHistory.push({ status, note, by: req.user._id, byName: nameOf(req.user), side: sideOf(req.user) });
    if (note) doc.replies.push({ text: note, by: req.user._id, byName: nameOf(req.user), side: sideOf(req.user) });
    await doc.save();
    announce(doc._id, 'status');
    const msg = { title: `${doc.ref}: ${label('status', status)} / ${label('status', status, 'en')}`, message: `${doc.adName}${note ? ` — ${note}` : ''}`, id: doc._id };
    if (partner) await notifyOurSide(msg); else await notifyPartner(msg);
    res.json({ item: fullRow(doc.toObject()) });
  } catch (e) { res.status(e.status || 400).json({ message: e.message }); }
};

exports.reply = async (req, res) => {
  try {
    const text = S(req.body?.text).slice(0, 2000);
    if (!text) return res.status(400).json({ message: 'اكتب الملاحظة / Write a note' });
    const doc = await MediaGoAdRequest.findById(req.params.id);
    if (!doc) return res.status(404).json({ message: 'الطلب غير موجود / Request not found' });
    const side = sideOf(req.user);
    doc.replies.push({ text, by: req.user._id, byName: nameOf(req.user), side });
    await doc.save();
    announce(doc._id, 'reply');
    const msg = { title: `${doc.ref}: ملاحظة جديدة / New note`, message: `${doc.adName} — ${text.slice(0, 140)}`, id: doc._id };
    if (side === 'mediago') await notifyOurSide(msg); else await notifyPartner(msg);
    res.json({ item: fullRow(doc.toObject()) });
  } catch (e) { res.status(400).json({ message: e.message }); }
};

exports.remove = async (req, res) => {
  try {
    if (!DELETE_ROLES.includes(req.user?.role)) return res.status(403).json({ message: 'الحذف لرؤوس القسم' });
    const doc = await MediaGoAdRequest.findById(req.params.id);
    if (!doc) return res.status(404).json({ message: 'الطلب غير موجود' });
    const urls = [...doc.files, ...doc.items.flatMap((i) => i.files)].map((f) => f.fileUrl);
    await doc.deleteOne();
    urls.forEach((u) => deleteStoredFile(u));
    await logAudit({ user: req.user, action: 'delete', entity: 'MediaGoAdRequest', entityId: doc._id, details: `${doc.ref}: ${doc.adName}` }).catch(() => {});
    announce(doc._id, 'deleted');
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ message: e.message }); }
};

exports.OUR_ROLES = OUR_ROLES;
