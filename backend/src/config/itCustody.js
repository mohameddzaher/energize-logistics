// IT custody vocabulary: the five buckets custody is displayed in, and the standard type written for each.
// The register held about fifteen detailed types and sixty-six free names for ~400 items, so no honest category total was possible without a fixed grouping layer.
// Buckets are read, not written: the detailed type stays in the database and the bucket is derived at display time.

// SIM cards are not department custody (the lines belong to another party), so they are excluded from all IT lists. Excluding them here keeps any new path from bringing them back, since every screen reads this list.
const EXCLUDED_TYPES = ['vehicle', 'tool', 'sim'];

const BUCKETS = [
  {
    key: 'laptops',
    nameAr: 'لابتوبات',
    nameEn: 'Laptops',
    // The type written when a new item is added from this bucket.
    canonicalType: 'laptop',
    types: ['laptop', 'desktop'],
  },
  // Mouse is its own bucket and keyboard its own: no set.
  // They were one 'mouse and keyboard' bucket, but the store holds mice without keyboards and keyboards without mice, so adding a mouse had no category except the one that writes 'mouse and keyboard' (a single item recorded as a set, and no way to know how many mice exist). A third 'mouse and keyboard set' bucket followed, then the decision that mouse and keyboard are unrelated: each is issued, returned and damaged alone. So every set was split into a mouse and a keyboard (scripts/splitKeyboardMouseSets.js) and the bucket removed.
  // The type `keyboard_mouse` stays readable in the keyboard bucket and is not written for new items (see RETIRED_TYPES), so any unsplit old row still counts with a 'mouse and keyboard' badge instead of vanishing.
  {
    key: 'mice',
    nameAr: 'ماوس',
    nameEn: 'Mouse',
    canonicalType: 'mouse',
    types: ['mouse'],
  },
  {
    key: 'keyboards',
    nameAr: 'كيبورد',
    nameEn: 'Keyboard',
    canonicalType: 'keyboard',
    types: ['keyboard', 'keyboard_mouse'],
  },
  {
    key: 'phones',
    nameAr: 'موبايلات',
    nameEn: 'Phones',
    canonicalType: 'phone',
    types: ['phone'],
  },
  // Tablet is its own bucket. It was a hidden type inside the mobiles bucket, and adding from that bucket wrote 'mobile', so a tablet could not be registered. Now items can be added from it and it counts separately.
  {
    key: 'tablets',
    nameAr: 'تابلت',
    nameEn: 'Tablets',
    canonicalType: 'tablet',
    types: ['tablet'],
  },
  {
    key: 'monitors',
    nameAr: 'شاشات',
    nameEn: 'Monitors',
    canonicalType: 'monitor',
    types: ['monitor'],
  },
  {
    key: 'other',
    nameAr: 'أخرى',
    nameEn: 'Other',
    canonicalType: 'other',
    // Bags, cables, chargers and the like. The bucket is open on purpose: a type added from reference data that fits no known bucket falls here instead of vanishing from the count.
    types: ['laptop_bag', 'charger', 'cable', 'headset', 'printer', 'router', 'access_card', 'accessory', 'other'],
  },
];

const BUCKET_KEYS = BUCKETS.map((b) => b.key);

// Types that are read, not written: their old rows are shown, but no new item is created with them and no item is converted to them. The value is the rejection message.
const RETIRED_TYPES = {
  keyboard_mouse: 'لم يعد «طقم ماوس وكيبورد» صنفًا — سجّل الماوس والكيبورد كلًّا وحده.',
};

/**
 * The rejection message if the request writes a retired type, else null.
 * `currentType` is the item's type before the edit: editing an old row without changing its type is accepted.
 */
const retiredTypeError = (type, currentType) => {
  const t = String(type || '').trim();
  if (!t || !RETIRED_TYPES[t]) return null;
  if (currentType && String(currentType).trim() === t) return null;
  return RETIRED_TYPES[t];
};

// Type to bucket map, built once: the derivation is called for every row on every load.
const TYPE_TO_BUCKET = new Map();
BUCKETS.forEach((b) => b.types.forEach((t) => TYPE_TO_BUCKET.set(t, b.key)));

/** The bucket a detailed type belongs to. Any unknown type counts as 'other'. */
const bucketOf = (type) => TYPE_TO_BUCKET.get(String(type || '').trim()) || 'other';

/** The detailed types a bucket covers; used for filtering in queries. */
const typesInBucket = (bucketKey) => {
  const b = BUCKETS.find((x) => x.key === bucketKey);
  return b ? b.types.slice() : [];
};

// Arabic type names for deriving the display name. Sourced from assetDefaults but duplicated here only as needed, so derivation does not read the database on every save.
const TYPE_NAME_AR = {
  laptop: 'لابتوب',
  desktop: 'حاسب مكتبي',
  phone: 'موبايل',
  tablet: 'تابلت',
  monitor: 'شاشة',
  keyboard: 'كيبورد',
  mouse: 'ماوس',
  keyboard_mouse: 'ماوس وكيبورد', // Retired type; for old rows only.
  headset: 'سماعة رأس',
  printer: 'طابعة',
  router: 'راوتر',
  charger: 'شاحن',
  cable: 'كابل',
  laptop_bag: 'شنطة لابتوب',
  accessory: 'ملحق',
  access_card: 'بطاقة دخول',
  other: 'صنف آخر',
};

/**
 * The display name is derived from type and brand instead of being typed.
 * Free names produced sixty-six spellings of the same devices ('Dell', 'Dell laptop', 'Laptop HP', 'ASUS' are rows for one idea). Deriving the name makes one item read one way whoever enters it.
 */
const deriveAssetName = (type, brand) => {
  const base = TYPE_NAME_AR[String(type || '').trim()] || TYPE_NAME_AR.other;
  const b = String(brand || '').trim();
  return b ? `${base} ${b}` : base;
};

/** Normalizes brand spelling. The data held Honor, HONOR, Asus, ASUS, logitech and Logitech as separate rows, and every group-by-brand split on them. */
const normalizeBrand = (brand) => {
  const b = String(brand || '').trim().replace(/\s+/g, ' ');
  if (!b) return '';
  // Acronyms that are always uppercase stay as they are.
  const UPPER = ['HP', 'MSI', 'LG', 'SMI', 'ASUS', 'AOC'];
  const hit = UPPER.find((u) => u.toLowerCase() === b.toLowerCase());
  if (hit) return hit;
  return b.charAt(0).toUpperCase() + b.slice(1).toLowerCase();
};

module.exports = {
  BUCKETS,
  BUCKET_KEYS,
  EXCLUDED_TYPES,
  bucketOf,
  typesInBucket,
  deriveAssetName,
  normalizeBrand,
  TYPE_NAME_AR,
  RETIRED_TYPES,
  retiredTypeError,
};
