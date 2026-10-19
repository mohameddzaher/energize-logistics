/**
 * archivedHidden — المؤرشَفُ يختفي كأنّه حُذف (صاحبُ الشركة، ٢٠٢٦/١٠/١٩).
 *
 * مجموعاتُ endedStaff تُقرأ مرّةً للطلب؛ وهنا شروطُ الاستعلام التي تُبنى منها،
 * لأنّ السجلّات ترتبط بالملفّ بثلاث طرق: مرجعُ الملفّ، حسابُ الدخول، رقمُ الهويّة.
 * صفحةُ الأرشيف وملفُّ المؤرشَف نفسُه لا يمرّان من هنا.
 */
const mongoose = require('mongoose');
const { endedStaff, notArchivedRef } = require('./endedStaff');

const oid = (s) => new mongoose.Types.ObjectId(s);

/** حسابُ دخولٍ مربوطٌ بمؤرشَف — في حقلٍ يحمل مرجعَ User. */
const notArchivedUserRef = (sets, field) => ({ [field]: { $nin: [...sets.archivedUserIds].map(oid) } });

/** رقمُ هويّةٍ لمؤرشَف — في حقلٍ نصّيّ (الأرقامُ مخزّنةٌ بلا مسافات). */
const notArchivedIdNumber = (sets, field) => ({ [field]: { $nin: [...sets.archivedIdNumbers] } });

/**
 * صفٌّ في سجلّ قسمٍ يحمل مرجعَ الملفّ إن رُبط، ورقمَ الهويّة دائمًا (النقل الخفيف):
 * بالمرجع إن وُجد، وإلّا برقم الهويّة.
 */
const notArchivedRow = (sets, refField = 'employee', idField = 'idNumber') => ({
  $nor: [
    { [refField]: { $in: [...sets.archivedIds].map(oid) } },
    { [refField]: null, [idField]: { $in: [...sets.archivedIdNumbers] } },
  ],
});

/**
 * صفوفُ النقل الخفيف للمؤرشَفين — لسجلّاتٍ تشير إلى الصفّ لا إلى الملفّ
 * (`B2CRep.ltEmployee`، مناديبُ التطبيق). سؤالٌ واحدٌ للطلب.
 */
async function archivedLtRowIds(sets) {
  if (!sets.archivedIds.size && !sets.archivedIdNumbers.size) return [];
  const { LightTransportEmployee } = require('../models/LightTransport');
  const rows = await LightTransportEmployee.find({
    $or: [
      { employee: { $in: [...sets.archivedIds].map(oid) } },
      { employee: null, idNumber: { $in: [...sets.archivedIdNumbers] } },
    ],
  }).select('_id').lean();
  return rows.map((r) => r._id);
}

/** يضمّ الشروطَ إلى فلترٍ قائم دون أن يطأ `$or` فيه. */
const andAll = (filter, ...frags) => ({ ...(filter || {}), $and: [...((filter && filter.$and) || []), ...frags] });

/** اختصار: الفلترُ نفسُه بلا مؤرشَفين في `field` (مرجعُ Employee). */
async function withoutArchivedRef(filter, field = 'employee') {
  const sets = await endedStaff();
  return andAll(filter, notArchivedRef(sets, field));
}

module.exports = { endedStaff, notArchivedRef, notArchivedUserRef, notArchivedIdNumber, notArchivedRow, archivedLtRowIds, andAll, withoutArchivedRef };
