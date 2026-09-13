/**
 * bondStatus — «هل وصل السند؟» يُسأل عنه المنصّةُ نفسُها لحظةَ السؤال.
 *
 * ── لماذا ───────────────────────────────────────────────────────────────────
 * تسجيلُ المشتريات موقوفٌ على أن تصير حالةُ الكشف «استُلم السند»، والحالةُ تُقرأ
 * من مرآتنا (`OperationsWorkflow.applicationStatus`) لا من المنصّة. والمرآةُ
 * تتأخّر: المنصّةُ لا تُرتِّب قائمتَها بآخر تعديل — تتجاهل `sort` كلَّه وتردّ
 * مرتَّبةً بتاريخ الإنشاء — فكشفٌ أُنشئ قبل أيّامٍ ثمّ استُلم سندُه اليومَ يقع
 * خارج الصفحة التي يقرؤها الاستطلاع، وينتظر المزامنةَ الكاملة.
 *
 * فكان الموظّف يغيّرها هناك ويُمنَع من الشراء هنا ساعاتٍ بلا سبب يفهمه.
 *
 * ── وما يفعله هذا الملفّ ────────────────────────────────────────────────────
 * قبل المنع — وقبلَه وحدَه — يُسأل عن هذا الكشف مفردًا. فإن كانت المنصّةُ تقول
 * «استُلم السند» صُحِّحت المرآةُ ومضى الشراء. ولا يُنادى إلّا في لحظة المنع:
 * الطريقُ السعيد لا يزيده هذا نداءً واحدًا.
 *
 * وهو شبكةُ أمانٍ لا بديلٌ عن المزامنة — راجع jobs/opsPoll.pollMovingShipments،
 * فهو الذي يُبقي المرآةَ حيّةً للشاشات كلِّها لا لهذه اللحظة فقط.
 */
const upl = require('../services/uplClient');

/**
 * يعيد الحالةَ الحيّةَ للكشف، ويكتبها في المرآة إن اختلفت.
 * ويعيد `null` إن تعذّر السؤال — فيُحكَم بما في المرآة كما كان.
 */
async function refreshApplicationStatus(workflow) {
  if (!workflow || !workflow.externalId) return null;
  if (String(workflow.externalSource || '') !== 'ops_upl') return null;
  if (!upl.isConfigured()) return null;
  try {
    const out = await upl.get(`/admin/shipments/${workflow.externalId}`);
    const live = String((out && out.data && out.data.status) || '').trim();
    if (!live || live === String(workflow.applicationStatus || '').trim()) return live || null;
    // تُكتب الحالةُ وحدَها هنا. بقيّةُ الأعمدة شأنُ المزامنة، وتعديلُها في
    // مسارِ طلبٍ من مستخدمٍ يجعل حفظَ المحفظة يتعلّق بنجاح نداءٍ خارجيّ.
    const OperationsWorkflow = require('../models/OperationsWorkflow');
    await OperationsWorkflow.updateOne(
      { _id: workflow._id },
      { $set: { applicationStatus: live, executionStatus: live, lastSyncedAt: new Date() } },
    );
    workflow.applicationStatus = live;
    workflow.executionStatus = live;
    return live;
  } catch (e) {
    // المنصّةُ لا تردّ الآن — لا يُفتَح الشرطُ بالشكّ، ولا يُعطَّل الحفظُ به.
    return null;
  }
}

/** هل صار الكشفُ «استُلم السند»؟ — تُسأل المنصّةُ إن كانت المرآةُ تقول لا. */
async function isBondReceived(workflow) {
  if (String(workflow?.applicationStatus || '').trim() === 'bond_received') return true;
  return (await refreshApplicationStatus(workflow)) === 'bond_received';
}

module.exports = { refreshApplicationStatus, isBondReceived };
