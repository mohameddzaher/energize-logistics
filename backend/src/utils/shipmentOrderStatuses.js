/**
 * Vocabulary of shipment statuses: the contract is in code and the label is in settings.
 * Why both: the section's settings were asked to control shipment statuses, but a status is not just a label. `arrived` is counted by analytics, `late` triggers alerts, `bond_received` gates the purchasing condition in the wallet, and the external platform speaks these same keys. Deleting a key from a screen would silence logic in another section.
 * So the ten keys are written here and cannot be deleted. What the section owns in its settings is the display name, colour, order and whether it is currently in use, and it may add an eleventh status of its own, which is accepted on save and shown in cards and every list.
 * What is stored on a shipment is the key, not the name: renaming "arrived" tomorrow changes nothing in the 33,000 records.
 */

// The ten base statuses, matching the operations platform mirror exactly.
const CORE = [
  { key: 'requesting', en: 'Requesting', ar: 'قيد الطلب', color: '#64748b' },
  { key: 'loading', en: 'Loading', ar: 'جاري التحميل', color: '#d97706' },
  { key: 'uploaded', en: 'Uploaded', ar: 'تم التحميل', color: '#ca8a04' },
  { key: 'on_way', en: 'On Way', ar: 'في الطريق', color: '#2563eb' },
  { key: 'arrived', en: 'Arrived', ar: 'وصلت', color: '#4f46e5' },
  { key: 'bond_sent', en: 'Bond Sent', ar: 'أُرسل السند', color: '#0891b2' },
  { key: 'bond_received', en: 'Bond Received', ar: 'استُلم السند', color: '#059669' },
  { key: 'late', en: 'Late', ar: 'متأخرة', color: '#ea580c' },
  { key: 'invoiced', en: 'Invoiced', ar: 'تمت الفوترة', color: '#7c3aed' },
  { key: 'cancelled', en: 'Cancelled', ar: 'ملغاة', color: '#dc2626' },
];

const CORE_KEYS = new Set(CORE.map((s) => s.key));

/**
 * The list as the user sees it now: base statuses with their configured labels, then any added ones.
 * Read from the DB on every call, uncached: the list is ten rows, and caching would make someone who edits a label in settings see it only after a minute, which defeats "live".
 */
async function statusVocabulary({ includeInactive = false } = {}) {
  let rows = [];
  try {
    const Lookup = require('../models/Lookup');
    rows = await Lookup.find({ type: 'so_status', deleted: { $ne: true } })
      .sort({ order: 1, createdAt: 1 }).lean();
  } catch (_) { rows = []; }

  const byKey = new Map(rows.map((r) => [r.key, r]));
  const out = [];

  // Base statuses first, in their cycle order unless reordered.
  CORE.forEach((s, i) => {
    const r = byKey.get(s.key);
    byKey.delete(s.key);
    const active = r ? r.isActive !== false : true;
    if (!active && !includeInactive) return;
    out.push({
      key: s.key,
      ar: (r && r.nameAr) || s.ar,
      en: (r && r.nameEn) || s.en,
      color: (r && r.color) || s.color,
      order: r && typeof r.order === 'number' ? r.order : i,
      active,
      isCore: true,
    });
  });

  // Then the section's own additions — skipping one named like a status already listed.
  const fold = (v) => String(v || '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/\s+/g, ' ').trim();
  const names = new Set(out.map((x) => fold(x.ar)));
  byKey.forEach((r) => {
    const active = r.isActive !== false;
    if (!active && !includeInactive) return;
    if (names.has(fold(r.nameAr || r.key))) return;
    names.add(fold(r.nameAr || r.key));
    out.push({
      key: r.key,
      ar: r.nameAr || r.key,
      en: r.nameEn || r.key,
      color: r.color || '#64748b',
      order: typeof r.order === 'number' ? r.order : 99,
      active,
      isCore: false,
    });
  });

  return out.sort((a, b) => a.order - b.order);
}

/**
 * Is this status accepted on save?
 * A base key is always accepted even if hidden from the screen: old records carry it, and rejecting it on edit would block saving a shipment whose status nobody touched. A section-added status is accepted while it exists and is not deleted.
 */
async function isValidStatus(key) {
  const k = String(key || '').trim();
  if (!k) return false;
  if (CORE_KEYS.has(k)) return true;
  const all = await statusVocabulary({ includeInactive: true });
  return all.some((s) => s.key === k);
}

module.exports = { CORE, CORE_KEYS, statusVocabulary, isValidStatus };
