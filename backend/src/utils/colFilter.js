/**
 * فلاترُ الأعمدة (إكسل) — ما تعرضه القائمةُ هو ما يُرجعه اختيارُه، بالعدد نفسِه.
 *
 * ── العلّة التي يُعالجها هذا الملفّ ──────────────────────────────────────────
 * القيمُ تصل القاعدةَ من طرقٍ لا يمرّ أكثرُها على `trim` في المخطّط: المزامنةُ
 * تكتب بخطّ تجميع، والاستيرادُ يكتب بـ`insertMany`/`bulkWrite`، والشيتُ يحمل
 * مسافاتٍ في آخر الخانة ومسافةً صلبة (U+00A0) ومسافتين بين كلمتين. فيصير في
 * القاعدة «الدمام» و«الدمام » و«الدمام » ثلاثَ قيمٍ تُقرأ في الجدول شيئًا واحدًا.
 *
 * ووقع من ذلك عطلان معًا:
 *   • القائمةُ تعرض «الدمام» مرّتين لا يفرّق بينهما شيء؛
 *   • واختيارُ «الدمام » يُرجع صفرًا: Mongoose يقصّ القيمةَ في الاستعلام نفسِه
 *     (`trim` يسري على الشرط) فيبحث عن «الدمام» ويترك ٩٣٥١ كشفًا كُتبت بمسافة.
 *
 * ── القاعدة ─────────────────────────────────────────────────────────────────
 * قيمتان تُقرآن على الشاشة متطابقتين **هما قيمةٌ واحدة**: تُجمعان في القائمة
 * سطرًا واحدًا بعددهما معًا، واختيارُ ذلك السطر يُرجع الصيغتين معًا.
 * «يُقرآن متطابقتين» = لا فرقَ بينهما إلّا في الفراغ: مسافاتُ الطرفين، وتكرارُ
 * المسافة، والمسافاتُ غيرُ العاديّة (الصلبة والرفيعة)، وعلاماتُ الاتّجاه
 * والعرضِ الصفريّ التي لا تُرسَم.
 *
 * وما يُرى مختلفًا يبقى مختلفًا — «أحمد» و«احمد»، «١٢» و«12»، «Ali» و«ALI»:
 * إكسلُ نفسُه يعرضها قيمًا مختلفة، وطيُّها يجعل القائمةَ تعدّ شيئًا وتعرض غيره.
 *
 * والشرطُ نمطٌ مثبَّتٌ لا نصّ: النمطُ لا يقصّه Mongoose، ويطابق الصيغَ كلَّها.
 */

// كلُّ ما يُرسَم فراغًا أو لا يُرسَم أصلًا. (`\s` في محرّك أنماط مونجو لا يشمل
// المسافةَ الصلبة ولا أخواتِها، فتُذكَر صراحةً.)
// والمحارفُ تُكتب أنفسَها لا رموزَ هروبها: `\u00a0` صيغةُ JavaScript، ومحرّكُ
// مونجو (PCRE) يرفضها — فيُبنى الصنفُ من المحارف ذاتها.
const SPACE_CHARS = `\\s\u00a0\u1680\u180e\u2000-\u200f\u202a-\u202f\u205f\u2060-\u206f\u3000\ufeff`;
const SP = `[${SPACE_CHARS}]`;
const SPACE_RUN_RX = new RegExp(`${SP}+`, 'g');
const BLANK_RX = new RegExp(`^${SP}*$`);

/** القيمةُ كما تُقرأ: فراغٌ واحدٌ بين الكلمات ولا شيء على الطرفين. */
function normKey(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? '' : v.toISOString();
  return String(v).replace(SPACE_RUN_RX, ' ').trim();
}

const escapeRx = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * نمطٌ يطابق كلَّ قيمةٍ مخزَّنةٍ تُقرأ `v` — أيًّا كان فراغُها.
 * القيمةُ الفارغةُ (أو الفراغُ وحدَه) تُطابَق بنمط «لا شيء إلّا فراغ».
 */
function textMatcher(v) {
  const k = normKey(v);
  if (!k) return BLANK_RX;
  return new RegExp(`^${SP}*${k.split(' ').map(escapeRx).join(`${SP}+`)}${SP}*$`);
}

/** ما يعنيه «(فارغ)»: الحقلُ غائبٌ أو null أو نصٌّ فارغ أو فراغٌ وحدَه. */
const BLANK_VALUES = ['', null, BLANK_RX];

/**
 * شرطُ «العمود يساوي إحدى هذه القيم» لعمودٍ نصّيّ.
 * `values` كما وصلت من القائمة؛ و`''` (أو ما يقرؤه المستدعي فارغًا) = «(فارغ)».
 */
function textIn(field, values) {
  const list = [];
  let blank = false;
  for (const v of values || []) {
    if (!normKey(v)) { blank = true; continue; }
    list.push(textMatcher(v));
  }
  if (blank) list.push(...BLANK_VALUES);
  if (!list.length) return null;
  return { [field]: { $in: list } };
}

/**
 * يجمع قيمَ قائمةٍ تُقرأ متطابقةً سطرًا واحدًا (`value` = الصيغةُ المقروءة).
 * `rows`: [{ value, count }] — والترتيبُ يُعاد بعد الجمع بعدد كلّ سطر.
 * `keyOf` لمن عنده قيمةٌ غيرُ نصّيّة (تاريخ/رقم) فيتركها كما هي.
 */
function mergeOptions(rows, { keyOf = normKey } = {}) {
  const m = new Map();
  for (const r of rows || []) {
    const k = keyOf(r.value);
    m.set(k, (m.get(k) || 0) + (Number(r.count) || 0));
  }
  return [...m.entries()].map(([value, count]) => ({ value, count }));
}

/** عدُّ قيمِ عمودٍ من صفوفٍ في الذاكرة — بالمفتاح المقروء. */
function tallyRows(rows, read, { blank = '' } = {}) {
  const m = new Map();
  for (const r of rows || []) {
    const k = normKey(read(r)) || blank;
    m.set(k, (m.get(k) || 0) + 1);
  }
  return [...m.entries()].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count);
}

module.exports = {
  SPACE_CHARS, BLANK_RX, BLANK_VALUES, normKey, textMatcher, textIn, mergeOptions, tallyRows,
};
