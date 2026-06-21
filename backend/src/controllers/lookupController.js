const Lookup = require('../models/Lookup');
const { byType, canManage, typesForRole, REGISTRY } = require('../config/lookupTypes');
const logAudit = require('../utils/auditLogger');
const { emitToAll } = require('../websocket/socketManager');

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
    const filter = { type };
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
    const { type, nameEn, nameAr, color } = req.body;
    const entry = byType(type);
    if (!entry) return res.status(400).json({ message: 'Unknown lookup type' });
    if (!canManage(type, req.user.role)) return res.status(403).json({ message: 'Insufficient permissions' });
    if (!nameEn || !nameEn.trim()) return res.status(400).json({ message: 'English name is required' });

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
    if (nameEn !== undefined) item.nameEn = String(nameEn).trim() || item.nameEn;
    if (nameAr !== undefined) item.nameAr = String(nameAr).trim() || item.nameAr;
    if (color !== undefined) item.color = color || undefined;
    if (isActive !== undefined) item.isActive = !!isActive;
    if (order !== undefined) item.order = Number(order) || 0;
    await item.save();

    await logAudit({ user: req.user._id, action: 'update_lookup', entity: 'Lookup', entityId: item._id, changes: { after: { nameEn: item.nameEn } }, ipAddress: req.ip }).catch(() => {});
    emit('lookup:changed', { type: item.type });
    res.json({ item });
  } catch (error) {
    res.status(500).json({ message: 'Failed to update lookup' });
  }
};

// DELETE /api/lookups/:id — remove a custom row. Seeded defaults (isSystem) are
// protected: deactivate them instead of deleting, so workflow keys never vanish.
exports.deleteLookup = async (req, res) => {
  try {
    const item = await Lookup.findById(req.params.id);
    if (!item) return res.status(404).json({ message: 'Lookup not found' });
    if (!canManage(item.type, req.user.role)) return res.status(403).json({ message: 'Insufficient permissions' });
    if (item.isSystem) return res.status(400).json({ message: 'Default items cannot be deleted — deactivate them instead' });

    await item.deleteOne();
    await logAudit({ user: req.user._id, action: 'delete_lookup', entity: 'Lookup', entityId: item._id, changes: { before: { type: item.type, key: item.key } }, ipAddress: req.ip }).catch(() => {});
    emit('lookup:changed', { type: item.type });
    res.json({ message: 'Lookup deleted' });
  } catch (error) {
    res.status(500).json({ message: 'Failed to delete lookup' });
  }
};

// Helper for other controllers: active rows for a type as {key,nameEn,nameAr,color}.
// Falls back to [] (callers can default to their config list) on error.
exports.activeByType = async (type) => {
  try {
    return await Lookup.find({ type, isActive: true }).sort({ order: 1, nameEn: 1 }).select('key nameEn nameAr color -_id').lean();
  } catch (e) {
    return [];
  }
};

exports.REGISTRY = REGISTRY;
