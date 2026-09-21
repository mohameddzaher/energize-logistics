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
 * ── وكلُّ مكانٍ يُكتب فيه اسمُ العميل ────────────────────────────────────────
 * الاسمُ مكتوبٌ نصًّا في أكثر من سجلّ: كشوفُ التشغيل، وطلباتُ الشحنات، وحمولاتُ
 * الأسطول، وأطرافُ التخليص ومعاملاتُها، واسمُ الطرف على فاتورة الدفتر. وتصحيحٌ
 * في موضعٍ دون البقيّة يجعل العميلَ الواحد صفَّين في شاشةٍ وصفًّا في أخرى.
 * فيُصحَّح في كلّها بنداءٍ واحد.
 *
 * واسمُ الطرف على الفاتورة يُصحَّح كذلك: هو اسمُ صاحبها لا نصُّ الورقة، والورقةُ
 * محفوظةٌ بمرفقها ورقمها.
 */
const fold = (v) => require('../models/CollectionsParty').fold(v);
const S = (v) => String(v ?? '').trim();

async function renameOpsCustomer(oldName, newName) {
  const from = String(oldName || '').trim();
  const to = String(newName || '').trim();
  // ── وتصحيحُ الرسم تصحيحٌ ──────────────────────────────────────────────────
  // كان الشرطُ يقارن الاسمين **بعد الطيّ**، والطيُّ يسوّي بين «العالميه»
  // و«العالمية» و«مؤسسه» و«مؤسسة». فأحدَ عشرَ سطرًا من شيت المطابقة لم يُنفَّذ
  // أصلًا: قُرئ «لا فرق» وهو فرقٌ يراه القارئُ في الشاشة، وتبحث عنه المنصّةُ
  // حرفيًّا فلا تجده. وما دام النصُّ مختلفًا فهناك ما يُكتب — والطيُّ إنّما
  // يقرّر هل هو العميلُ نفسُه (فلا دمجَ ولا حسابٌ ثانٍ) لا هل يُكتب.
  if (!from || !to || from === to) return null;

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

  const sameCode = current && target && S(current.code) && S(current.code) === S(target.code);
  if (current && target && String(current._id) !== String(target._id) && (!S(current.code) || sameCode)) {
    // الاسمُ الجديد لطرفٍ قائم، والقديمُ **بلا كودٍ خاصّ**: يُضاف اسمُه صيغةً
    // للحساب ويُعطَّل المكرَّر — فلا يبقى سجلّان لعميلٍ واحد.
    await CollectionsParty.updateOne({ _id: target._id }, {
      // والاسمُ المُعتمَد يُكتب بحرفه: قد يكون القائمُ مكتوبًا «العالميه»
      // والمطلوبُ «العالمية» — الطيُّ يسوّي بينهما، والقارئُ لا.
      ...(target.name !== to ? { $set: { name: to, nameKey: newKey } } : {}),
      $addToSet: { aliases: from, aliasKeys: oldKey },
    });
    await CollectionsParty.updateOne({ _id: current._id }, {
      $set: { isActive: false, notes: `دُمج في «${target.name}» بعد تعديل الاسم في منصّة التشغيل` },
    });
    out.party = String(target._id);
    out.merged = true;
  } else if (current && target && String(current._id) !== String(target._id)) {
    // ── وحسابٌ له كودُه لا يُدمَج في آخر ──────────────────────────────────
    // الشركةُ الواحدة قد تحمل حسابين: نقديًّا (Cxxxx) وضريبيًّا (1104xxxx)،
    // لكلٍّ رصيدُه ومهلتُه وفواتيرُه. ودمجُهما لاتّفاق الاسم يُخفي حسابًا
    // بفواتيره — وقد وقع: سبعةٌ وثلاثون حسابًا وألفٌ وأربعَ عشرةَ فاتورة.
    // فيُصحَّح اسمُه ويبقى حسابًا قائمًا بكوده، والقديمُ صيغةٌ له.
    await CollectionsParty.updateOne({ _id: current._id }, {
      $set: { name: to, nameKey: newKey },
      $addToSet: { aliases: from, aliasKeys: oldKey },
    });
    out.party = String(current._id);
    out.keptSeparate = S(current.code);
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

  // ── كلُّ صيغِ الاسم لا الحرفيّةَ وحدَها ────────────────────────────────────
  // الكشوفُ تحمل الاسمَ كما كُتب يومَها: «شركه شحن» و«شركة شحن». والمطابقةُ
  // الحرفيّة تترك الباقي — أربعةُ آلافٍ منها بقيت في أوّل تشغيل.
  //
  // والصيغُ تُجمَع من طرفَي التعديل: القديمِ والجديد. فمَن كُتب له «العالميه»
  // ومَن كُتب له «العالمية» كلاهما هذا العميل، وتركُ أحدهما يجعله صفَّين في
  // شاشةٍ تجمع بالنصّ — والمقصودُ حرفٌ واحدٌ مُعتمَد.
  const KEYS = new Set([oldKey, newKey]);
  const variantsOf = async (coll, field) => {
    const names = await coll.distinct(field);
    return (names || []).filter((n) => n && KEYS.has(fold(n)) && n !== to);
  };

  const wfNames = await variantsOf(OperationsWorkflow, 'username');
  if (wfNames.length) {
    const r = await OperationsWorkflow.updateMany({ username: { $in: wfNames } }, { $set: { username: to } });
    out.sheets = r.modifiedCount || 0;
  }

  // بقيّةُ المواضع — كلٌّ باسم حقله.
  const also = [
    ['ShipmentOrder', 'customerName', 'shipmentOrders'],
    ['FleetModels', 'customerName', 'fleetShipments', 'FleetShipment'],
    ['CustomsParty', 'name', 'customsParties'],
    ['CustomsClearance', 'customerName', 'customsClearances'],
  ];
  for (const [modelName, field, key, exportName] of also) {
    try {
      const Model = require(`../models/${modelName}`);
      const M = Model[exportName || modelName] || Model;
      if (!M || typeof M.distinct !== 'function') continue;
      const names = (await M.distinct(field)).filter((n) => n && KEYS.has(fold(n)) && n !== to);
      if (!names.length) continue;
      const r = await M.updateMany({ [field]: { $in: names } }, { $set: { [field]: to } });
      out[key] = r.modifiedCount || 0;
    } catch (_) { /* سجلٌّ غيرُ موجودٍ في هذه النسخة */ }
  }

  // واسمُ الطرف على فواتير الدفتر — لمن ربطُه بهذا الطرف أو باسمه القديم.
  try {
    const CollectionInvoice = require('../models/CollectionInvoice');
    const names = (await CollectionInvoice.distinct('partyName')).filter((n) => n && KEYS.has(fold(n)) && n !== to);
    const or = [];
    if (names.length) or.push({ partyName: { $in: names } });
    if (out.party) or.push({ party: out.party });
    if (or.length) {
      const r = await CollectionInvoice.updateMany({ $or: or }, { $set: { partyName: to } });
      out.invoices = r.modifiedCount || 0;
    }
  } catch (_) { /* */ }

  try {
    const cache = require('./ttlCache');
    // `wfparty:` خريطتا الاسمِ المعتمَد ونوعِ العميل — تتبعان الأطرافَ لا الكشوف.
    cache.clear('wf:'); cache.clear('wfparty:'); cache.clear('collections:'); cache.clear('coll:');
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
