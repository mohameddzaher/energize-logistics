/**
 * اسمُ العميل يُعدَّل في منصّة التشغيل — فيتبعه قسمُ التحصيل والكشوف.
 *
 * ── العلّة ──────────────────────────────────────────────────────────────────
 * اسمُ العميل في التشغيل هو مفتاحُه في التحصيل: الكشفُ يحمل الاسمَ نصًّا
 * (`username`)، وطرفُ التحصيل يُطابَق باسمه المطويّ (`nameKey`). فتصحيحُ حرفٍ
 * في المنصّة كان يقطع الصلة: الكشوفُ الجديدة تأتي بالاسم الجديد فلا تجد طرفًا،
 * فيُنشأ طرفٌ ثانٍ بلا كود — ويصير للعميل الواحد حسابان ودَينٌ مقسوم.
 *
 * فمتى تغيّر الاسمُ هناك، يتبعه هنا في نداءٍ واحد:
 *   • طرفُ التحصيل يُعاد تسميتُه، **والاسمُ القديم يبقى صيغةً أخرى له**
 *     (`aliases`/`aliasKeys`) فلا ينقطع ما كُتب به قبل اليوم.
 *   • وإن كان الاسمُ الجديد لطرفٍ قائمٍ أصلًا، لم يُنشأ ثالثٌ: يُضاف القديمُ
 *     صيغةً للقائم ويُعطَّل المكرَّر — وهو ما يفعله «ربط الحسابات» بيد المدير.
 *   • وكشوفُ التشغيل المحفوظة يُكتب عليها الاسمُ الجديد فورًا، ولا تُنتظَر
 *     دورةُ المزامنة الشاملة (المزامنةُ تكتب الاسمَ من المنصّة في كلّ مرور،
 *     فالقيمتان تتّفقان على كلّ حال).
 *
 * ولا يُمسّ اسمُ الفاتورة المحفوظ في الدفتر (`CollectionInvoice.partyName`):
 * هو لقطةٌ لما كُتب على الورقة يومَ صدرت، والربطُ الحقيقيّ بالمعرّف والكود.
 */
const fold = (v) => require('../models/CollectionsParty').fold(v);

async function renameOpsCustomer(oldName, newName) {
  const from = String(oldName || '').trim();
  const to = String(newName || '').trim();
  if (!from || !to || fold(from) === fold(to)) return null;

  const CollectionsParty = require('../models/CollectionsParty');
  const OperationsWorkflow = require('../models/OperationsWorkflow');
  const out = { from, to, party: null, merged: false, sheets: 0 };

  const oldKey = fold(from);
  const newKey = fold(to);

  const current = await CollectionsParty.findOne({
    kind: 'customer', $or: [{ nameKey: oldKey }, { aliasKeys: oldKey }],
  });
  const target = await CollectionsParty.findOne({
    kind: 'customer', isActive: { $ne: false }, $or: [{ nameKey: newKey }, { aliasKeys: newKey }],
  });

  if (current && target && String(current._id) !== String(target._id)) {
    // الاسمُ الجديد لطرفٍ قائم: يُضاف القديمُ صيغةً له، ويُعطَّل المكرَّر.
    await CollectionsParty.updateOne({ _id: target._id }, {
      $addToSet: { aliases: from, aliasKeys: oldKey },
    });
    await CollectionsParty.updateOne({ _id: current._id }, {
      $set: { isActive: false, notes: `دُمج في «${target.name}» بعد تعديل الاسم في منصّة التشغيل` },
    });
    out.party = String(target._id);
    out.merged = true;
  } else if (current) {
    await CollectionsParty.updateOne({ _id: current._id }, {
      $set: { name: to, nameKey: newKey },
      $addToSet: { aliases: from, aliasKeys: oldKey },
    });
    out.party = String(current._id);
  } else if (target) {
    await CollectionsParty.updateOne({ _id: target._id }, { $addToSet: { aliases: from, aliasKeys: oldKey } });
    out.party = String(target._id);
  }

  // الكشوفُ المحفوظة بالاسم القديم — تُكتب بالجديد الآن لا بعد دورة مزامنة.
  const r = await OperationsWorkflow.updateMany({ username: from }, { $set: { username: to } });
  out.sheets = r.modifiedCount || 0;

  try {
    const cache = require('./ttlCache');
    cache.clear('wf:'); cache.clear('collections:'); cache.clear('coll:');
  } catch (_) { /* */ }
  try { require('../controllers/collectionsLedgerController').invalidate(); } catch (_) { /* */ }
  try {
    const { emitToAll } = require('../websocket/socketManager');
    emitToAll('collections:party', { renamed: true });
    emitToAll('workflow:updated', { renamed: true });
  } catch (_) { /* */ }

  return out;
}

module.exports = { renameOpsCustomer };
