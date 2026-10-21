/**
 * مرفقاتُ فواتير التحصيل — ورقُ الفاتورة يعيش مع الفاتورة.
 *
 *   GET    /api/collections-dept/attachments/:kind/counts?keys=…   عددُ مرفقات صفوفٍ بعينها
 *   GET    /api/collections-dept/attachments/:kind/:key            ملفّاتُ فاتورةٍ واحدة
 *   POST   /api/collections-dept/attachments/:kind/:key            إرفاقُ ملفٍّ أو أكثر
 *   DELETE /api/collections-dept/attachments/:kind/:key/:fileId    حذفُ ملفٍّ واحد
 *
 * `kind` = tax (المفتاحُ رقمُ الفاتورة في الدفتر) أو cash (المفتاحُ معرّفُ الكشف
 * النقديّ في سير العمل) — راجع models/CollectionAttachment.
 *
 * ── ما يُرفَع ───────────────────────────────────────────────────────────────
 * صورٌ وPDF وWord وExcel — ما يُرفَق بفاتورةٍ فعلًا: نسخةٌ موقَّعة، إيصالُ
 * استلام، كشفُ حسابٍ من العميل، صورةُ شيك. والملفُّ حتى ١٠ ميغا.
 *
 * والخادمُ يقبل جسمَ طلبٍ حتى ٢٥ ميغا (server.js)، والملفُّ يُرسَل base64 فيكبر
 * الثلث. فالطلبُ الواحدُ لا يتجاوز ١٨ ميغا من الملفّات معًا ولا عشرةَ ملفّات —
 * والشاشتان تقسمان ما يُختار على طلباتٍ بهذا الحدّ، فلا يصطدم به المستخدم.
 *
 * ── مَن يفعل ماذا ───────────────────────────────────────────────────────────
 * مَن يقرأ صفحاتِ الفواتير يرى المرفقاتِ وينزّلها، ومَن يكتب فيها يرفع.
 * والحذفُ لمن رفع الملفَّ، أو لمدير التحصيل ومدير النظام والإدارة: ملفٌّ رفعه
 * زميلٌ دليلٌ على فاتورة، فلا يمحوه موظّفٌ آخر.
 *
 * ── والعددُ حيّ ──────────────────────────────────────────────────────────────
 * بعد كلّ رفعٍ أو حذفٍ يُبثّ `collections:attachments`، فيتحدّث العدّادُ عند
 * كلّ من فتح الصفحة. وقائمتا الفواتير تُقرآن حيّتين؛ ولوحةُ التحصيل تحمل العددَ
 * في ذاكرتها (`cdr:` — بطاقةُ «بلا مرفق»)، فتُمسح في `announce` قبل `emitToAll`.
 * ومن أضاف ذاكرةً أخرى تحمل العدد فليمسحها هناك أيضًا.
 */
const mongoose = require('mongoose');
const CollectionAttachment = require('../models/CollectionAttachment');
const OperationsWorkflow = require('../models/OperationsWorkflow');
const { saveUploadFile, deleteStoredFile } = require('../utils/fileStore');
const { canonicalRole } = require('../config/roles');
const logAudit = require('../utils/auditLogger');

const S = (v) => String(v == null ? '' : v).trim();
const nameOf = (u) => [u?.firstName, u?.lastName].filter(Boolean).join(' ') || u?.email || '';

const KINDS = ['tax', 'cash'];
const MB = 1024 * 1024;
const LIMITS = { file: 10 * MB, request: 18 * MB, perRequest: 10, perInvoice: 50 };

/** مَن يحذف ملفًّا لم يرفعه. */
const DELETE_ANY_ROLES = ['super_admin', 'admin', 'collections_manager'];

// الأنواعُ المقبولة — والامتدادُ يُترجَم إلى نوعه حين لا يقوله المتصفّح أو
// الهاتف (ملفّاتُ Excel وHEIC تصل كثيرًا بلا نوع أو «octet-stream»).
const MIME_BY_EXT = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', heic: 'image/heic',
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};
const ALLOWED = new Set(Object.values(MIME_BY_EXT).concat(['image/jpg']));

const fail = (status, ar, en) => { const e = new Error(`${ar} / ${en}`); e.status = status; return e; };

const badKind = (kind) => !KINDS.includes(kind);
const keyOf = (kind, raw) => {
  const k = S(raw).slice(0, 200);
  if (kind === 'cash' && !mongoose.Types.ObjectId.isValid(k)) return '';
  return k;
};

/** هل للفاتورة وجود؟ — لا يُرفَق ملفٌّ بمفتاحٍ لا يقابله شيء. */
async function invoiceExists(kind, key) {
  if (kind === 'cash') return !!(await OperationsWorkflow.exists({ _id: key, paymentType: 'cash' }));
  const CollectionInvoice = require('../models/CollectionInvoice');
  if (await CollectionInvoice.exists({ invoiceNumber: key })) return true;
  return !!(await OperationsWorkflow.exists({ invoiceNumber: key }));
}

/**
 * عددُ مرفقات كلّ مفتاح — تجميعٌ واحدٌ لصفحةٍ كاملة، تقرؤه قائمتا الفواتير.
 * يُرجع Map: المفتاح → العدد (والغائبُ صفر).
 */
async function countsFor(kind, keys) {
  const list = [...new Set((keys || []).map((k) => S(k)).filter(Boolean))];
  if (!list.length) return new Map();
  const agg = await CollectionAttachment.aggregate([
    { $match: { kind, key: { $in: list } } },
    { $group: { _id: '$key', n: { $sum: 1 } } },
  ]);
  return new Map(agg.map((x) => [x._id, x.n]));
}

/** يكتب في صفحات الفواتير؟ — بالقاعدة نفسِها التي يمرّ بها `authorize`. */
const canWrite = (req, editRoles) => editRoles.map(canonicalRole).includes(canonicalRole(req.user?.role))
  || req.sectionAccess === 'edit' || !!req.pageGranted;
const canDeleteAny = (req) => DELETE_ANY_ROLES.includes(canonicalRole(req.user?.role));
const mayDelete = (req, f) => canDeleteAny(req) || (f.uploadedBy && String(f.uploadedBy) === String(req.user?._id));

const shape = (req, f) => ({
  _id: f._id,
  fileUrl: f.fileUrl,
  fileName: f.fileName,
  mimeType: f.mimeType,
  size: f.size,
  uploadedBy: f.uploadedBy,
  uploadedByName: f.uploadedByName,
  uploadedAt: f.uploadedAt,
  canDelete: mayDelete(req, f),
});

const announce = async (kind, key) => {
  const count = await CollectionAttachment.countDocuments({ kind, key });
  // لوحةُ التحصيل تعدّ «آجل - فاتورة بلا مرفق» من ذاكرةٍ مؤقّتة (`cdr:`) —
  // تُمسح قبل البثّ، وإلّا قرأت اللوحةُ القديمَ حين تستجيب له.
  try { require('../utils/ttlCache').clear('cdr:'); } catch (_) { /* */ }
  try {
    const { emitToAll } = require('../websocket/socketManager');
    emitToAll('collections:attachments', { kind, key, count, at: Date.now() });
  } catch (_) { /* البثُّ تحسينٌ لا شرط */ }
  return count;
};

/**
 * يتحقّق من ملفّات الطلب كلِّها قبل أن يكتب واحدًا: نوعٌ غيرُ مقبول، أو ملفٌّ
 * فوق ١٠ ميغا، أو مجموعٌ فوق حدّ الطلب — فيُردّ الطلبُ كلُّه ولا يبقى نصفُه.
 */
function parseFiles(list, already) {
  const files = Array.isArray(list) ? list.filter((f) => f && typeof f.dataUrl === 'string' && f.dataUrl) : [];
  if (!files.length) throw fail(400, 'لم يُرسَل ملف', 'No file sent');
  if (files.length > LIMITS.perRequest) {
    throw fail(400, `الحدّ ${LIMITS.perRequest} ملفّات في المرّة الواحدة`, `At most ${LIMITS.perRequest} files per upload`);
  }
  if (already + files.length > LIMITS.perInvoice) {
    throw fail(400, `الحدّ ${LIMITS.perInvoice} ملفًّا للفاتورة`, `At most ${LIMITS.perInvoice} files per invoice`);
  }
  let total = 0;
  return files.map((f) => {
    const name = S(f.fileName).replace(/[\\/\r\n]+/g, ' ').slice(0, 200);
    const m = /^data:([^;,]*)(;base64)?,/.exec(f.dataUrl);
    if (!m || !m[2]) throw fail(400, `ملفٌّ غير صالح: ${name || '—'}`, `Invalid file data: ${name || '—'}`);
    let mime = S(m[1]).toLowerCase();
    // نوعٌ لم يُقَل → من الامتداد.
    if (!ALLOWED.has(mime)) {
      const ext = name.includes('.') ? name.split('.').pop().toLowerCase() : '';
      if ((!mime || mime === 'application/octet-stream') && MIME_BY_EXT[ext]) mime = MIME_BY_EXT[ext];
    }
    if (!ALLOWED.has(mime)) {
      throw fail(400, `نوعٌ غير مدعوم «${name || mime}» — صور وPDF وWord وExcel فقط`, `Unsupported file “${name || mime}” — images, PDF, Word or Excel only`);
    }
    const body = f.dataUrl.slice(m[0].length);
    const bytes = Math.floor((body.length * 3) / 4) - (body.endsWith('==') ? 2 : body.endsWith('=') ? 1 : 0);
    if (bytes > LIMITS.file) throw fail(400, `«${name}» أكبر من ١٠ ميغا`, `“${name}” is larger than 10 MB`);
    total += bytes;
    if (total > LIMITS.request) {
      throw fail(400, 'مجموع الملفّات في المرّة الواحدة أكبر من ١٨ ميغا — أرفقها على دفعات', 'Files exceed 18 MB in one upload — attach them in batches');
    }
    return { dataUrl: `data:${mime};base64,${body}`, name };
  });
}

// ── القراءة ─────────────────────────────────────────────────────────────────

exports.counts = async (req, res) => {
  try {
    const kind = S(req.params.kind);
    if (badKind(kind)) return res.status(400).json({ message: 'نوعٌ غير معروف / Unknown kind' });
    const raw = req.query.keys;
    const keys = (Array.isArray(raw) ? raw : S(raw) ? [raw] : []).slice(0, 500);
    const map = await countsFor(kind, keys);
    res.json({ counts: Object.fromEntries(map) });
  } catch (e) {
    res.status(500).json({ message: 'تعذّر قراءة المرفقات', error: e.message });
  }
};

exports.list = (editRoles) => async (req, res) => {
  try {
    const kind = S(req.params.kind);
    if (badKind(kind)) return res.status(400).json({ message: 'نوعٌ غير معروف / Unknown kind' });
    const key = keyOf(kind, req.params.key);
    if (!key) return res.status(400).json({ message: 'مفتاحُ الفاتورة غير صالح / Invalid invoice key' });
    const files = await CollectionAttachment.find({ kind, key }).sort({ uploadedAt: -1 }).lean();
    res.json({
      files: files.map((f) => shape(req, f)),
      abilities: { upload: canWrite(req, editRoles), deleteAny: canDeleteAny(req) },
      limits: { fileMB: LIMITS.file / MB, requestMB: LIMITS.request / MB, perRequest: LIMITS.perRequest, perInvoice: LIMITS.perInvoice },
    });
  } catch (e) {
    res.status(500).json({ message: 'تعذّر قراءة المرفقات', error: e.message });
  }
};

// ── الكتابة ─────────────────────────────────────────────────────────────────

exports.upload = async (req, res) => {
  const saved = [];
  try {
    const kind = S(req.params.kind);
    if (badKind(kind)) return res.status(400).json({ message: 'نوعٌ غير معروف / Unknown kind' });
    const key = keyOf(kind, req.params.key);
    if (!key) return res.status(400).json({ message: 'مفتاحُ الفاتورة غير صالح / Invalid invoice key' });
    if (!(await invoiceExists(kind, key))) {
      return res.status(404).json({ message: 'الفاتورة غير موجودة / Invoice not found' });
    }

    const already = await CollectionAttachment.countDocuments({ kind, key });
    let parsed;
    try { parsed = parseFiles(req.body?.files, already); } catch (e) { return res.status(e.status || 400).json({ message: e.message }); }

    const who = nameOf(req.user);
    try {
      for (const p of parsed) {
        const meta = saveUploadFile(p.dataUrl, 'collections', p.name, { maxBytes: LIMITS.file });
        saved.push(meta);
      }
    } catch (err) {
      saved.forEach((x) => deleteStoredFile(x.fileUrl));
      saved.length = 0;
      return res.status(400).json({ message: err.message || 'تعذّر حفظ الملف / Could not save the file' });
    }

    const docs = await CollectionAttachment.insertMany(saved.map((m) => ({
      kind, key, ...m, uploadedBy: req.user?._id || null, uploadedByName: who, uploadedAt: new Date(),
    })));

    await logAudit({
      user: req.user?._id, action: 'upload_collection_attachment', entity: 'CollectionAttachment',
      entityKey: `${kind}:${key}`,
      changes: { after: { kind, key, files: docs.map((d) => d.fileName) } }, ipAddress: req.ip,
    });
    const count = await announce(kind, key);
    res.status(201).json({
      message: docs.length > 1 ? `أُرفق ${docs.length} ملفّات` : 'أُرفق الملف',
      files: docs.map((d) => shape(req, d.toObject())),
      count,
    });
  } catch (e) {
    // ما كُتب على القرص ولم يُسجَّل في القاعدة يُمحى — لا ملفّاتٌ يتيمة.
    saved.forEach((x) => deleteStoredFile(x.fileUrl));
    res.status(500).json({ message: 'تعذّر رفع المرفقات', error: e.message });
  }
};

exports.remove = async (req, res) => {
  try {
    const kind = S(req.params.kind);
    if (badKind(kind)) return res.status(400).json({ message: 'نوعٌ غير معروف / Unknown kind' });
    const key = keyOf(kind, req.params.key);
    const fileId = S(req.params.fileId);
    if (!key || !mongoose.Types.ObjectId.isValid(fileId)) return res.status(400).json({ message: 'طلبٌ غير صالح / Invalid request' });

    const f = await CollectionAttachment.findOne({ _id: fileId, kind, key }).lean();
    if (!f) return res.status(404).json({ message: 'المرفق غير موجود / Attachment not found' });
    if (!mayDelete(req, f)) {
      return res.status(403).json({ message: 'الحذفُ لمن رفع الملف أو لمدير التحصيل / Only the uploader or the collections manager can delete this file' });
    }

    await CollectionAttachment.deleteOne({ _id: f._id });
    deleteStoredFile(f.fileUrl);
    await logAudit({
      user: req.user?._id, action: 'delete_collection_attachment', entity: 'CollectionAttachment',
      entityId: f._id,
      changes: { before: { kind, key, fileName: f.fileName, uploadedByName: f.uploadedByName } }, ipAddress: req.ip,
    });
    const count = await announce(kind, key);
    res.json({ message: 'حُذف المرفق', count });
  } catch (e) {
    res.status(500).json({ message: 'تعذّر حذف المرفق', error: e.message });
  }
};

exports.countsFor = countsFor;
exports.LIMITS = LIMITS;
