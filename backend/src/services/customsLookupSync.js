/**
 * إعادةُ تسمية بندٍ في إعدادات قسم التخليص تسري في الحال — وعلى ما مضى.
 *
 * كلُّ إدخالٍ في «مراحل السداد» وكلُّ بندٍ في فاتورة العميل يلقط اسمَ بنده
 * وقتَ الإضافة (`label`)، ومرفقُه في «مرفقات المعاملة» يحمل الاسمَ عنوانًا.
 * فكان من يصحّح اسمًا في الإعدادات يراه في القوائم الجديدة وحدَها، ويبقى
 * القديمُ على كلّ ما سُجِّل قبله — في الشاشة وفي التصدير وعند الماليّة.
 *
 * فيُنقَل الاسمُ الجديدُ إلى اللقطات: ما كان يحمل الاسمَ القديمَ حرفًا بحرف
 * يصير بالجديد. وعنوانُ مرفقٍ غيّره صاحبُه بيده لا يُمسّ — ليس اسمَ البند.
 */
const cache = require('../utils/ttlCache');

const SYNCED = {
  customs_payment_stage: { list: 'paymentStages', titles: (n) => [n, `إثبات دفع · ${n}`] },
  customs_sale_item: { list: 'saleItems', titles: (n) => [`فاتورة العميل — ${n}`] },
};

async function lookupRenamed({ type, key, from, to }) {
  const def = SYNCED[type];
  if (!def || !from || !to || from === to) return { touched: 0 };
  const CustomsClearance = require('../models/CustomsClearance');
  let touched = 0;
  const r = await CustomsClearance.updateMany(
    { [`${def.list}.key`]: key },
    { $set: { [`${def.list}.$[e].label`]: to } },
    { arrayFilters: [{ 'e.key': key }] },
  );
  touched += r.modifiedCount || 0;
  const oldTitles = def.titles(from); const newTitles = def.titles(to);
  for (let i = 0; i < oldTitles.length; i += 1) {
    const a = await CustomsClearance.updateMany(
      { 'attachments.title': oldTitles[i] },
      { $set: { 'attachments.$[a].title': newTitles[i] } },
      { arrayFilters: [{ 'a.title': oldTitles[i] }] },
    );
    touched += a.modifiedCount || 0;
  }
  try { cache.clear('customs:'); cache.clear('finance:'); } catch (_) { /* */ }
  // الشاشاتُ المفتوحةُ تعيد القراءة: المعاملةُ وقائمتُها ولوحةُ القسم والماليّة.
  try { require('../websocket/socketManager').emitToAll('customs:updated', { renamed: { type, key } }); } catch (_) { /* */ }
  return { touched };
}

module.exports = { lookupRenamed, SYNCED };
