const Lookup = require('../models/Lookup');
const { byType, canManage, typesForRole, REGISTRY } = require('../config/lookupTypes');
const logAudit = require('../utils/auditLogger');
const { emitToAll } = require('../websocket/socketManager');
const LISTS = require('../utils/hrLists');

const emit = (event, payload = {}) => { try { emitToAll(event, payload); } catch (e) {} };

const slugify = (s) =>
  String(s || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40) || 'item';

// Build a key that is unique within a type, deriving from the English name.
const uniqueKey = async (type, base) => {
  let key = slugify(base);
  let n = 1;
  // eslint-disable-next-line no-await-in-loop
  while (await Lookup.exists({ type, key })) {
    n += 1;
    key = `${slugify(base)}_${n}`;
  }
  return key;
};

// GET /api/lookups/types — registry metadata for the management UI.
exports.getTypes = async (req, res) => {
  try {
    res.json({ types: typesForRole(req.user.role) });
  } catch (error) {
    res.status(500).json({ message: 'Failed to load lookup types' });
  }
};

// GET /api/lookups?type=...&active=true — rows for one type (any authenticated user
// may read, so dropdowns work everywhere). Without `type` it returns nothing useful.
exports.getLookups = async (req, res) => {
  try {
    const { type, active } = req.query;
    if (!type || !byType(type)) return res.status(400).json({ message: 'Unknown lookup type' });
    // المحذوفةُ لا تظهر في أيّ قائمة — ولا حتّى في شاشة الإدارة.
    const filter = { type, deleted: { $ne: true } };
    if (active === 'true') filter.isActive = true;
    const items = await Lookup.find(filter).sort({ order: 1, nameEn: 1 }).lean();
    res.json({ items });
  } catch (error) {
    res.status(500).json({ message: 'Failed to load lookups' });
  }
};

// POST /api/lookups — create a row (also used by the inline "+ add" in dropdowns).
exports.createLookup = async (req, res) => {
  try {
    const { type, nameAr, color } = req.body;
    // الاسمُ العربيُّ وحدَه يكفي: يُستعمل للإنجليزيّ إن لم يُكتب.
    const nameEn = String(req.body.nameEn || '').trim() || String(nameAr || '').trim();
    const entry = byType(type);
    if (!entry) return res.status(400).json({ message: 'Unknown lookup type' });
    if (!canManage(type, req.user.role)) return res.status(403).json({ message: 'Insufficient permissions' });
    if (!nameEn || !nameEn.trim()) return res.status(400).json({ message: 'English name is required' });

    // بندان بالاسم نفسِه يُقرآن بندًا واحدًا في كلّ ملفّ — فلا يُضاف الثاني.
    if (LISTS.isHrList(type)) {
      const ar = String((nameAr && nameAr.trim()) || nameEn.trim());
      if (await Lookup.exists({ type, nameAr: ar, deleted: { $ne: true } })) return res.status(409).json({ message: `«${ar}» موجود بالفعل في القائمة` });
    }

    const key = await uniqueKey(type, nameEn);
    const count = await Lookup.countDocuments({ type });
    const item = await Lookup.create({
      type,
      key,
      nameEn: nameEn.trim(),
      nameAr: (nameAr && nameAr.trim()) || nameEn.trim(),
      color: color || undefined,
      order: count,
      isActive: true,
      isSystem: false,
      createdBy: req.user._id,
    });

    await logAudit({ user: req.user._id, action: 'create_lookup', entity: 'Lookup', entityId: item._id, changes: { after: { type, key, nameEn } }, ipAddress: req.ip }).catch(() => {});
    if (LISTS.isHrList(type)) LISTS.forget();
    emit('lookup:changed', { type });
    res.status(201).json({ item });
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ message: 'This item already exists' });
    res.status(500).json({ message: 'Failed to create lookup' });
  }
};

// PUT /api/lookups/:id — edit names/color/active/order. `key` is immutable so
// existing documents that reference it stay valid.
exports.updateLookup = async (req, res) => {
  try {
    const item = await Lookup.findById(req.params.id);
    if (!item) return res.status(404).json({ message: 'Lookup not found' });
    if (!canManage(item.type, req.user.role)) return res.status(403).json({ message: 'Insufficient permissions' });

    const { nameEn, nameAr, color, isActive, order } = req.body;
    const nameBefore = item.nameAr;
    if (LISTS.isHrList(item.type)) {
      const next = nameAr !== undefined ? String(nameAr).trim() : '';
      if (next && next !== nameBefore && await Lookup.exists({ type: item.type, nameAr: next, deleted: { $ne: true }, _id: { $ne: item._id } })) {
        return res.status(409).json({ message: `«${next}» موجود بالفعل في القائمة` });
      }
      // إيقافُ البند حذفٌ له من القائمة — فلا يُوقَف وعليه موظّفون.
      if (isActive === false && item.isActive) {
        const u = await LISTS.usage(item.type, nameBefore);
        if (u.total) return res.status(409).json({ message: inUse(nameBefore, u) });
      }
    }
    if (nameEn !== undefined) item.nameEn = String(nameEn).trim() || item.nameEn;
    if (nameAr !== undefined) item.nameAr = String(nameAr).trim() || item.nameAr;
    if (color !== undefined) item.color = color || undefined;
    if (isActive !== undefined) item.isActive = !!isActive;
    if (order !== undefined) item.order = Number(order) || 0;
    await item.save();

    await logAudit({ user: req.user._id, action: 'update_lookup', entity: 'Lookup', entityId: item._id, changes: { after: { nameEn: item.nameEn } }, ipAddress: req.ip }).catch(() => {});
    // الاسمُ الملقوطُ على ما سُجِّل من قبل يتبع الاسمَ الجديد — فالتعديلُ من
    // الإعدادات يسري في الحال وعلى ما مضى (راجع services/customsLookupSync).
    if (nameBefore !== item.nameAr) {
      await require('../services/customsLookupSync')
        .lookupRenamed({ type: item.type, key: item.key, from: nameBefore, to: item.nameAr }).catch(() => {});
    }
    // وقوائمُ ملفّ الموظّف (القسم، الجنسيّة، المدينة، المشروع): الاسمُ الجديدُ على
    // ملفّات أصحابه كلِّهم في الحال — راجع utils/hrLists.
    if (LISTS.isHrList(item.type)) {
      LISTS.forget();
      if (nameBefore !== item.nameAr) {
        const r = await LISTS.renamed(item.type, nameBefore, item.nameAr);
        await logAudit({ user: req.user._id, action: 'rename_hr_list_item', entity: 'Lookup', entityId: item._id, changes: { details: `«${nameBefore}» ← «${item.nameAr}» على ${r.touched} ملفّ`, before: { nameAr: nameBefore }, after: { nameAr: item.nameAr, employees: r.touched } }, ipAddress: req.ip }).catch(() => {});
      }
    }
    emit('lookup:changed', { type: item.type });
    res.json({ item });
  } catch (error) {
    res.status(500).json({ message: 'Failed to update lookup' });
  }
};

// DELETE /api/lookups/:id — تُحذَف القيمة.
//
// المضافةُ يدويًّا تُمحى. والمبذورةُ تُعلَّم محذوفةً بدل أن تُمحى: البذرُ عند
// الإقلاع ينشئ ما لا يجده، فمحوُها يعيدها في أوّل إعادة تشغيل. وكان الحلُّ
// السابقُ إخفاءَ زرّ الحذف عنها — فتمتلئ القائمةُ بقيمٍ لا تُستعمل ولا تُزال.
exports.deleteLookup = async (req, res) => {
  try {
    const item = await Lookup.findById(req.params.id);
    if (!item) return res.status(404).json({ message: 'Lookup not found' });
    if (!canManage(item.type, req.user.role)) return res.status(403).json({ message: 'Insufficient permissions' });
    if (LISTS.isHrList(item.type)) {
      const u = await LISTS.usage(item.type, item.nameAr);
      if (u.total) return res.status(409).json({ message: inUse(item.nameAr, u) });
      LISTS.forget();
    }
    if (item.isSystem) {
      // لا تُمحى من القاعدة بل تُعلَّم محذوفةً: المحوُ يعيدها البذرُ في أوّل
      // إقلاع، والشاهدةُ تُخبره ألّا يفعل.
      item.deleted = true;
      item.isActive = false;
      await item.save();
      await logAudit({ user: req.user._id, action: 'delete_lookup', entity: 'Lookup', entityId: item._id, changes: { before: { type: item.type, key: item.key } }, ipAddress: req.ip }).catch(() => {});
      emit('lookup:changed', { type: item.type });
      return res.json({ message: 'Lookup deleted', tombstoned: true });
    }

    await item.deleteOne();
    await logAudit({ user: req.user._id, action: 'delete_lookup', entity: 'Lookup', entityId: item._id, changes: { before: { type: item.type, key: item.key } }, ipAddress: req.ip }).catch(() => {});
    emit('lookup:changed', { type: item.type });
    res.json({ message: 'Lookup deleted' });
  } catch (error) {
    res.status(500).json({ message: 'Failed to delete lookup' });
  }
};

// بندٌ عليه موظّفون لا يُحذف ولا يُوقَف: يُنقَلون أوّلًا (أو يُغيَّر اسمُه بدلَ حذفه).
const inUse = (name, u) => `لا يمكن حذف «${name}»: عليه ${u.total} موظّف${u.archived ? ` (منهم ${u.archived} في الأرشيف)` : ''}. انقلهم إلى غيره أوّلًا، أو غيّر الاسمَ بدلَ الحذف.`;

// Helper for other controllers: active rows for a type as {key,nameEn,nameAr,color}.
// Falls back to [] (callers can default to their config list) on error.
exports.activeByType = async (type) => {
  try {
    return await Lookup.find({ type, isActive: true, deleted: { $ne: true } }).sort({ order: 1, nameEn: 1 }).select('key nameEn nameAr color -_id').lean();
  } catch (e) {
    return [];
  }
};

exports.REGISTRY = REGISTRY;
