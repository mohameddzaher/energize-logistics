/**
 * كودُ الحساب — يُولَّد على سياقة الدفتر، لا على سياقةٍ نخترعها.
 *
 * ── السياقتان ──────────────────────────────────────────────────────────────
 * في دفتر التحصيل سلسلتان قائمتان:
 *   الضريبيّ  `1104xxxx`  — رقمُ الحساب في دفاتر المحاسبة
 *   النقديّ   `C####`     — بحرف C، من C0001 صعودًا
 *
 * فالحسابُ الجديد يأخذ التاليَ في سلسلة نوعِه. ولو وُلِّد بصيغةٍ أخرى لصار في
 * العمود الواحد صيغتان، وانكسر كلُّ ما يُرتَّب أو يُطابَق بالكود.
 *
 * ── والتالي يُقرأ من القاعدة لا من عدّادٍ محفوظ ────────────────────────────
 * العدّادُ المنفصل يفترق عن الواقع عند أوّل استيرادٍ أو حذف. فيُقرأ أكبرُ كودٍ
 * موجودٍ فعلًا ويُزاد واحدًا — وهو صحيحٌ دائمًا بلا صيانة.
 */
const TAX_PREFIX = '1104';
const CASH_PREFIX = 'C';

/**
 * @param {'cash'|'tax'} paymentType
 * @returns {Promise<string>} الكودُ التالي في سلسلة النوع.
 */
async function nextPartyCode(paymentType) {
  const CollectionsParty = require('../models/CollectionsParty');
  const cash = paymentType === 'cash';
  const rx = cash ? /^C(\d+)$/i : new RegExp(`^${TAX_PREFIX}(\\d+)$`);

  const codes = await CollectionsParty.distinct('code', { code: { $type: 'string', $gt: '' } });
  let max = 0;
  for (const c of codes) {
    const m = rx.exec(String(c).trim());
    if (m) max = Math.max(max, Number(m[1]) || 0);
  }

  if (cash) return `${CASH_PREFIX}${String(max + 1).padStart(4, '0')}`;
  // الضريبيُّ يبدأ من حيث انتهى الدفتر؛ ولو خلا فمن أوّل السلسلة.
  return `${TAX_PREFIX}${String(max + 1).padStart(4, '0')}`;
}

module.exports = { nextPartyCode, TAX_PREFIX, CASH_PREFIX };
