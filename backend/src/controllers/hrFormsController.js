/**
 * النماذجُ والخطاباتُ الرسميّة — مكتبةُ أوراق القسم.
 *
 * القراءةُ لكلّ موظّفٍ داخليّ: من يحتاج «نموذج طلب إجازة» يأخذه بنفسه، ولا
 * يسأل الموارد البشريّة عن ورقةٍ لا سرَّ فيها. والرفعُ والحذفُ للقسم وحدَه.
 * راجع models/HrFormTemplate لسببِ وجودها سجلًّا مستقلًّا.
 */
const HrFormTemplate = require('../models/HrFormTemplate');
const { saveUploadFile } = require('../utils/fileStore');
const logAudit = require('../utils/auditLogger');
const { emitToAll } = require('../websocket/socketManager');

const emit = () => { try { emitToAll('hr:forms', {}); } catch (e) { /* الحدثُ زيادة */ } };

const CATEGORIES = [
  { key: 'forms', ar: 'نماذج', en: 'Forms' },
  { key: 'letters', ar: 'خطابات رسمية', en: 'Official letters' },
  { key: 'policies', ar: 'لوائح وسياسات', en: 'Policies' },
  { key: 'contracts', ar: 'عقود ونماذجها', en: 'Contracts' },
  { key: 'hse', ar: 'السلامة', en: 'HSE' },
  { key: 'other', ar: 'أخرى', en: 'Other' },
];

// GET /api/hr/forms?category=&q=&includeArchived=1
exports.list = async (req, res) => {
  try {
    const f = {};
    if (req.query.includeArchived !== '1') f.isActive = true;
    if (req.query.category) f.category = String(req.query.category);
    if (req.query.q) {
      const rx = new RegExp(String(req.query.q).trim().slice(0, 80).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      f.$or = [{ title: rx }, { titleEn: rx }, { description: rx }, { fileName: rx }];
    }
    const items = await HrFormTemplate.find(f).sort({ category: 1, title: 1 }).lean();
    const counts = {};
    for (const c of CATEGORIES) counts[c.key] = 0;
    items.forEach((i) => { counts[i.category] = (counts[i.category] || 0) + 1; });
    res.json({ items, categories: CATEGORIES, counts, total: items.length });
  } catch (e) {
    res.status(500).json({ message: 'تعذّر تحميل النماذج' });
  }
};

// POST /api/hr/forms — { title, titleEn, category, description, file: dataUrl, fileName }
exports.create = async (req, res) => {
  try {
    const title = String(req.body?.title || '').trim();
    if (!title) return res.status(400).json({ message: 'اسمُ النموذج مطلوب' });
    if (!req.body?.file) return res.status(400).json({ message: 'الملفُّ مطلوب' });
    let saved;
    try {
      saved = saveUploadFile(req.body.file, 'hr-forms', req.body.fileName || title);
    } catch (err) {
      return res.status(400).json({ message: err.message });
    }
    const doc = await HrFormTemplate.create({
      title,
      titleEn: String(req.body.titleEn || '').trim(),
      category: String(req.body.category || 'forms').trim(),
      description: String(req.body.description || '').trim(),
      fileUrl: saved.fileUrl,
      fileName: saved.fileName || req.body.fileName || '',
      mimeType: saved.mimeType,
      size: saved.size,
      uploadedBy: req.user?._id,
      uploadedByName: [req.user?.firstName, req.user?.lastName].filter(Boolean).join(' ').trim(),
    });
    await logAudit({
      user: req.user?._id, action: 'create', entity: 'HrFormTemplate', entityId: doc._id,
      changes: { after: { title, category: doc.category } }, ipAddress: req.ip,
    }).catch(() => {});
    emit();
    res.status(201).json({ item: doc });
  } catch (e) {
    res.status(500).json({ message: 'تعذّر الحفظ' });
  }
};

/**
 * PUT /api/hr/forms/:id — تسميتُه ووصفُه، أو **استبدالُ ملفّه**.
 * واستبدالُ الملفّ يرفع رقمَ النسخة: من يقرأ «نسخة ٣» يعرف أنّ ما عنده أقدم.
 */
exports.update = async (req, res) => {
  try {
    const doc = await HrFormTemplate.findById(req.params.id);
    if (!doc) return res.status(404).json({ message: 'غير موجود' });
    if (req.body.title !== undefined) doc.title = String(req.body.title).trim() || doc.title;
    if (req.body.titleEn !== undefined) doc.titleEn = String(req.body.titleEn).trim();
    if (req.body.category !== undefined) doc.category = String(req.body.category).trim() || doc.category;
    if (req.body.description !== undefined) doc.description = String(req.body.description).trim();
    if (req.body.isActive !== undefined) doc.isActive = !!req.body.isActive;
    if (req.body.file) {
      let saved;
      try { saved = saveUploadFile(req.body.file, 'hr-forms', req.body.fileName || doc.title); }
      catch (err) { return res.status(400).json({ message: err.message }); }
      doc.fileUrl = saved.fileUrl;
      doc.fileName = saved.fileName || req.body.fileName || doc.fileName;
      doc.mimeType = saved.mimeType;
      doc.size = saved.size;
      doc.version = (doc.version || 1) + 1;
      doc.uploadedBy = req.user?._id;
      doc.uploadedByName = [req.user?.firstName, req.user?.lastName].filter(Boolean).join(' ').trim();
    }
    await doc.save();
    await logAudit({
      user: req.user?._id, action: 'update', entity: 'HrFormTemplate', entityId: doc._id,
      changes: { after: { title: doc.title, version: doc.version } }, ipAddress: req.ip,
    }).catch(() => {});
    emit();
    res.json({ item: doc });
  } catch (e) {
    res.status(500).json({ message: 'تعذّر الحفظ' });
  }
};

/**
 * DELETE /api/hr/forms/:id — يُؤرشَف لا يُمحى.
 * من وقّع على نسخةٍ قديمةٍ يحتاج أن يجدها، و`?purge=1` لصاحب النظام وحدَه.
 */
exports.remove = async (req, res) => {
  try {
    const doc = await HrFormTemplate.findById(req.params.id);
    if (!doc) return res.status(404).json({ message: 'غير موجود' });
    if (req.query.purge === '1' && req.user?.role === 'super_admin') {
      await HrFormTemplate.deleteOne({ _id: doc._id });
      emit();
      return res.json({ message: 'حُذف' });
    }
    doc.isActive = false;
    await doc.save();
    await logAudit({
      user: req.user?._id, action: 'delete', entity: 'HrFormTemplate', entityId: doc._id,
      changes: { after: { isActive: false } }, ipAddress: req.ip,
    }).catch(() => {});
    emit();
    res.json({ message: 'أُرشِف', item: doc });
  } catch (e) {
    res.status(500).json({ message: 'تعذّر الحذف' });
  }
};

/** POST /api/hr/forms/:id/downloaded — يعدّ التنزيل. لا يُعيد الملفّ: المسارُ عامٌّ ثابت. */
exports.countDownload = async (req, res) => {
  try {
    await HrFormTemplate.updateOne({ _id: req.params.id }, { $inc: { downloads: 1 }, $set: { lastDownloadAt: new Date() } });
    res.json({ ok: true });
  } catch (e) {
    res.json({ ok: false });
  }
};

exports.CATEGORIES = CATEGORIES;
