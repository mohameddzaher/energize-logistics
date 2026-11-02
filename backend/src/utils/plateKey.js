// The one rule for matching a vehicle across the two systems that describe it.
// The workshop registers assets against a bare fleet number ("2708"); the live Wialon mirror names the same truck with Arabic letters, Latin letters and a driver name (Arabic letters, Latin letters, driver name, any order). Reducing both to their digits makes them the same key.
// Kept here rather than in a controller because both the ls2 asset registry and the workshop store join on it; two drifting copies would show a tire as unassigned on one screen and fitted on the other.
// Plate text with Arabic letters or Arabic-Indic digits reduces to "2708". A plate with no digits ("TR1") falls back to its uppercased text so it still matches itself.
const plateKey = (p) => {
  if (p == null) return null;
  const west = String(p).replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));
  const digits = (west.match(/\d+/g) || []).join('');
  return digits || west.trim().toUpperCase() || null;
};

// A live Wialon vehicle carries its plate in `plate` or, for older units, only
// inside `name` — try both, in that order.
const vehiclePlateKey = (v) => (v ? plateKey(v.plate) || plateKey(v.name) : null);

// Why a second key: the key above drops letters on purpose, because Wialon writes truck names in countless forms and our heavy-fleet numbers (61 trucks) are unique by digits alone.
// The vehicle registry holds 334 vehicles including 212 bikes, and there digits collide: a bike plate and a trailer plate can share "1080", and a digits key would make them one vehicle and attach the bike's accident to the trailer. There are 11 such collisions in the current file and none when letters are part of the key.
// So the difference is not neglect: each key serves a domain with different uniqueness rules, and merging them breaks one side. Both live here with the reason written.
const registryPlateKey = (p) => {
  if (p == null) return null;
  const west = String(p).replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));
  const k = west
    .replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي')
    .replace(/[ؤئ]/g, 'ي').replace(/[\u064B-\u0652\u0640]/g, '')
    .replace(/[^\u0621-\u064A0-9A-Za-z]/g, '')
    .toUpperCase();
  return k || null;
};

/**
 * One plate display format for the whole system.
 * Plates were written in four formats (letters then digits in the registry, light transport and accidents; digits then letters in fleet management and Location Solutions; carrier trucks in mixed case), with meaningless differences: two or three spaces, Latin lower/upper case, Arabic or Western digits. A row read one way on one screen and another on the next, and searching what the reader sees found nothing.
 * Rule: always Western digits, always uppercase Latin, a single space between segments, Arabic letters separated as read on the plate and Latin letters joined as written on the registration.
 * Order is never touched: a plate written digits-first in the registry or fleet stays that way. Reordering it to match the rest changes the statement, not the formatting; the plate is matched by its text on upload and import, and Location Solutions sends it that way. Spacing, alphabet and digits are normalised, order is kept as written. A plate is never moved from one alphabet to the other: the Arabic and Latin forms of one truck are the same truck, but converting between them is a guess, and matching them is the job of `registryPlateKey`, not of display.
 */
const formatPlate = (v) => {
  if (v == null) return '';
  const raw = String(v).replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).trim();
  if (!raw) return '';
  const digitsMatch = raw.match(/\d+/);
  if (!digitsMatch) return raw.replace(/\s+/g, ' ');
  const digits = digitsMatch[0];
  const before = raw.slice(0, digitsMatch.index).trim();
  const after = raw.slice((digitsMatch.index || 0) + digits.length).trim();
  // Arabic letters are separated by a space as read on the plate; Latin letters are joined and uppercase as written on the registration.
  const tidy = (part) => (/[A-Za-z]/.test(part)
    ? part.replace(/\s+/g, '').toUpperCase()
    : part.split(/\s+/).filter(Boolean).join(' '));
  // Anything on both sides stays on both sides. A plate like "Car 4263 SNA" has letters before and after the number; keeping only one side drops text that is written on the plate, which is data loss, not formatting.
  const head = before ? tidy(before) : '';
  const tail = after ? tidy(after) : '';
  if (!head && !tail) return digits;
  return [head, digits, tail].filter(Boolean).join(' ');

};

module.exports = { plateKey, vehiclePlateKey, registryPlateKey, formatPlate };

/**
 * Regex that tolerates any number of spaces.
 * Saudi plates have three letters and a number; scooters and trailers have two, leaving the third slot blank (two spaces). We store a single space, but staff copy plates from Absher or another sheet with two spaces, so nothing matches and the screen comes up empty.
 * Every blank in the search text becomes zero or more spaces, so a plate matches with one space, two, or none, and nobody needs to know how it was written.
 */
const flexSpaceRegex = (s, flags = 'i') => {
  // Whitespace is stripped from the whole search text, then allowed between every two characters, so a plate typed with one space, two spaces or none reaches the same row, and searching without spaces finds what was stored with them.
  // Arabic spelling variants are folded too: hamza forms (the name with and without hamza) and ta marbuta (copied from Absher as one letter, typed in the sheet as another). The searcher does not know which was stored, so each character becomes a class accepting its lookalikes.
  const bare = String(s || '').replace(/\s+/g, '');
  if (!bare) return new RegExp('(?:)', flags);
  const parts = [...bare].map((ch) => {
    const cls = FOLD_CLASSES[ch];
    if (cls) return cls;
    return ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  });
  return new RegExp(parts.join('[\\s\u064B-\u0652\u0640]*'), flags);
};

// Classes of visually similar letters, built once and not on every search.
const FOLD_GROUPS = [
  'اأإآٱ', 'هة', 'يىئ', 'وؤ', '٠0', '١1', '٢2', '٣3', '٤4', '٥5', '٦6', '٧7', '٨8', '٩9',
];
const FOLD_CLASSES = {};
for (const g of FOLD_GROUPS) for (const ch of g) FOLD_CLASSES[ch] = `[${g}]`;

/**
 * In-memory counterpart of `flexSpaceRegex`.
 * Some section lists are fetched whole from cache and filtered in Node with `includes`, a literal match that tolerates neither an extra space nor a missing hamza, so staff searching the very plate they see find nothing. The same rule is applied here.
 */
const flexNormalize = (v) => String(v == null ? '' : v)
  .replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d))
  .replace(/[أإآٱ]/g, 'ا').replace(/[ةه]/g, 'ه').replace(/[ىئي]/g, 'ي').replace(/[ؤو]/g, 'و')
  .replace(/[\u064B-\u0652\u0640]/g, '')
  .replace(/\s+/g, '')
  .toLowerCase();

/** Whether any field contains the search text, after folding spaces and spelling variants. */
const flexIncludes = (needle, ...fields) => {
  const n = flexNormalize(needle);
  if (!n) return true;
  return fields.some((f) => flexNormalize(f).includes(n));
};

/**
 * A full number is matched as a full number.
 * `flexSpaceRegex` is containment matching, right for plates and names: a partial plate should find what contains it. But an invoice number is typed whole and means itself; containment makes a search for "9719" return six rows over two invoices (the invoice, a statement numbered 9719, and a voucher numbered 9719 under invoice 9669), so staff think the invoice has copies.
 * Rule by length: our invoice, statement and voucher numbers are four digits or more, so four typed digits is a full number meant exactly; one or two digits is exploring, and containment is wanted.
 * Returns `{ exact, loose }`; `exact` is empty when the text is not a full number, so callers use `exact || loose` unconditionally.
 */
const numberSearchRegex = (s) => {
  const bare = String(s || '').trim();
  const loose = flexSpaceRegex(bare);
  if (!/^[\d٠-٩\s]+$/.test(bare)) return { exact: null, loose };
  const digits = bare.replace(/\s/g, '').replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));
  if (digits.length < 4) return { exact: null, loose };
  return { exact: new RegExp(`^\\s*${digits}\\s*$`), loose };
};

module.exports.numberSearchRegex = numberSearchRegex;

module.exports.flexSpaceRegex = flexSpaceRegex;
module.exports.flexNormalize = flexNormalize;
module.exports.flexIncludes = flexIncludes;

/**
 * Are these one vehicle? A key independent of order and spaces.
 * The vehicle registry (`VehicleMaster`) and the legacy assignment registry (`Vehicle`) write one plate two ways ("letters digits" here, "digits letters" there; one space vs two). So letters are sorted alphabetically, separated from digits, and hamza and ta marbuta are folded.
 * Letters stay in the key: two scooters can share digits with different letters, and a bike and a trailer can share "1080"; dropping letters would merge them.
 * It first lived only in vehicleRegistryController (`samePlate`) and moved here because the authorization service (utils/vehicleAuthorization) joins the two registries with it too.
 */
const orderlessPlateKey = (p) => {
  if (p == null) return null;
  const west = String(p).replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d))
    .replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/[ىئ]/g, 'ي').replace(/ؤ/g, 'و');
  const digits = (west.match(/\d+/g) || []).join('');
  const letters = (west.match(/[ء-يA-Za-z]/g) || []).map((c) => c.toUpperCase()).sort().join('');
  const k = `${digits}|${letters}`;
  return k === '|' ? null : k;
};
module.exports.orderlessPlateKey = orderlessPlateKey;

/**
 * The unified plate key, whether written in Arabic or Latin.
 * The vehicle registry writes plates in Arabic letters, while fleet management, Location Solutions and shipment-order trucks write them in Latin, and none of the five other keys converted between the alphabets, so one vehicle never met itself across sections (zero of 62 fleet trucks, 60 LS2 units and 117 of our trucks in orders).
 * This key = digits | letters, sorted, after mapping to Latin with the Saudi plate letter table. It matched 62/62, 60/60 and 117/117 with no collision in the registry (the digits-only key collides 11 times: a bike and a trailer share "1080"). It is the basis of every cross-section vehicle link; see utils/vehicleRef.
 */
const AR2LAT = {
  'ا': 'A', 'أ': 'A', 'إ': 'A', 'آ': 'A', 'ٱ': 'A', 'ب': 'B', 'ح': 'J', 'د': 'D', 'ر': 'R', 'س': 'S',
  'ص': 'X', 'ط': 'T', 'ع': 'E', 'ق': 'G', 'ك': 'K', 'ل': 'L', 'م': 'Z', 'ن': 'N', 'ه': 'H', 'ة': 'H',
  'و': 'U', 'ي': 'V', 'ى': 'V',
};
const canonicalPlateKey = (p) => {
  if (p == null) return null;
  const w = String(p).replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));
  const digits = (w.match(/\d+/g) || []).join('');
  if (!digits) return null;
  const letters = [...w].map((c) => AR2LAT[c] || (/[A-Za-z]/.test(c) ? c.toUpperCase() : '')).join('')
    .split('').sort().join('');
  return `${digits}|${letters}`;
};
module.exports.canonicalPlateKey = canonicalPlateKey;
module.exports.AR2LAT = AR2LAT;
