// The custody / store vocabulary shared by the Software & IT and HR sections.
//
// These are seeded into the `Lookup` collection (types `asset_type` and
// `asset_condition`) so the section can rename them or add new ones from
// Settings → Reference Data without a deploy. They are NOT a Mongoose enum for
// that reason — `Asset.type` and `Asset.condition` store the key as free text
// and the controllers validate against the active lookup rows.
//
// `itHandsOut: false` marks a type that belongs to another section, so it is
// kept out of the IT dropdowns (vehicles are the fleet's; `tool` is HR's own
// gear). The flag lives here rather than in the Lookup row because it is a
// routing rule between sections, not a label a user should be able to edit.

const TYPES = [
  { key: 'laptop', nameEn: 'Laptop', nameAr: 'حاسب محمول' },
  { key: 'desktop', nameEn: 'Desktop', nameAr: 'حاسب مكتبي' },
  { key: 'phone', nameEn: 'Phone', nameAr: 'هاتف' },
  { key: 'tablet', nameEn: 'Tablet', nameAr: 'جهاز لوحي' },
  { key: 'sim', nameEn: 'SIM Card', nameAr: 'شريحة اتصال' },
  { key: 'monitor', nameEn: 'Monitor', nameAr: 'شاشة' },
  { key: 'keyboard', nameEn: 'Keyboard', nameAr: 'لوحة مفاتيح' },
  { key: 'mouse', nameEn: 'Mouse', nameAr: 'فأرة' },
  { key: 'keyboard_mouse', nameEn: 'Keyboard & Mouse', nameAr: 'لوحة مفاتيح وفأرة' },
  { key: 'headset', nameEn: 'Headset', nameAr: 'سماعة رأس' },
  { key: 'printer', nameEn: 'Printer', nameAr: 'طابعة' },
  { key: 'router', nameEn: 'Router', nameAr: 'موجّه شبكة' },
  { key: 'charger', nameEn: 'Charger', nameAr: 'شاحن' },
  { key: 'cable', nameEn: 'Cable', nameAr: 'كبل' },
  { key: 'laptop_bag', nameEn: 'Laptop Bag', nameAr: 'حقيبة حاسب' },
  { key: 'accessory', nameEn: 'Accessory', nameAr: 'ملحق' },
  { key: 'access_card', nameEn: 'Access Card', nameAr: 'بطاقة دخول' },
  { key: 'vehicle', nameEn: 'Vehicle', nameAr: 'مركبة', itHandsOut: false },
  { key: 'tool', nameEn: 'Tool', nameAr: 'أداة', itHandsOut: false },
  { key: 'other', nameEn: 'Other', nameAr: 'أخرى' },
];

const CONDITIONS = [
  { key: 'new', nameEn: 'New', nameAr: 'جديد' },
  { key: 'good', nameEn: 'Good', nameAr: 'جيد' },
  { key: 'fair', nameEn: 'Fair', nameAr: 'مقبول' },
  { key: 'damaged', nameEn: 'Damaged', nameAr: 'تالف' },
];

// Seed rows must not carry the routing flag into the Lookup collection.
const seedRows = (rows) => rows.map(({ key, nameEn, nameAr }) => ({ key, nameEn, nameAr }));

// The types IT offers in its own dropdowns.
const IT_TYPE_KEYS = TYPES.filter((t) => t.itHandsOut !== false).map((t) => t.key);

module.exports = {
  TYPES,
  CONDITIONS,
  TYPE_SEED: seedRows(TYPES),
  CONDITION_SEED: seedRows(CONDITIONS),
  IT_TYPE_KEYS,
  ALL_TYPE_KEYS: TYPES.map((t) => t.key),
};
