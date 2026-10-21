/**
 * تحصيلُ المحفظة على الكشف النقديّ.
 *
 * ── القاعدة (صاحبُ الشركة) ─────────────────────────────────────────────────
 * مندوبٌ قبض من العميل فسجّل في المحفظة «تحصيلًا» برقم كشف التخريج. فإن كان
 * الكشفُ نقديًّا فقد حُصِّل — ويظهر «محصَّلًا» في فواتير الكاش لحظتَها، لا حين
 * يتذكّر قسمُ التحصيل أن يكتبه ثانيةً. والتاريخُ تاريخُ قيد المحفظة، والمبلغُ
 * مبلغُه (ومجموعُ القيود إن تعدّدت للكشف الواحد).
 *
 * وكان التحصيلُ في المحفظة لا يصل شيئًا: ستّةٌ وثلاثون قيدًا على كشوفٍ نقديّة،
 * ولا واحدٌ منها «محصَّل» في شاشة التحصيل — فيُطالَب العميلُ بمالٍ دفعه.
 *
 * ── يتبع القيدَ في الاتّجاهين ───────────────────────────────────────────────
 * يُسجَّل فيُكتب، ويُعدَّل مبلغُه أو تاريخُه أو رقمُ كشفه فيتبعه (ويُرفع عن
 * الكشف القديم)، ويُحذف فيُرفع التحصيلُ إن لم يبقَ للكشف قيدٌ آخر. ويتغيّر نوعُ
 * الكشف فيُعاد النظر: صار نقديًّا فيُحصَّل، وكفّ عن النقد فيُرفع.
 *
 * ── وما كتبته يدُ التحصيل لا يُمسّ ─────────────────────────────────────────
 * `collectedByWallet` على الكشف يقول إنّ التحصيلَ المكتوبَ عليه كتبته المحفظة.
 * فما ليس عليه هذا العلمُ — تحصيلٌ سجّله القسمُ بيده (تاريخٌ أو «محصَّل» من
 * الدفتر) — لا يُكتب فوقه ولا يُرفع. ومتى كتب القسمُ بيده على الكشف (سجّل أو
 * عدّل أو رفع التحصيل) صار العلمُ `false`: الكشفُ في يده، ولا تعود المحفظةُ
 * إليه (راجع handCollected و collectionsDeptController).
 *
 * ── والتاريخ ───────────────────────────────────────────────────────────────
 * يُكتب كما يكتبه زرُّ «تسجيل التحصيل» في القسم حرفًا: `new Date('YYYY-MM-DD')`
 * — منتصفُ ليل ذلك اليوم بالتوقيت العالميّ — فلا يختلف كشفٌ حصّلته المحفظةُ عن
 * كشفٍ حصّله القسمُ في أيّ فلترٍ أو عمرٍ أو تقرير. وإن تعدّدت القيودُ فآخرُ
 * تاريخٍ منها: التحصيلُ اكتمل بآخر دفعة.
 */
const { flexSpaceRegex, flexNormalize } = require('./plateKey');
const cache = require('./ttlCache');

const clean = (v) => String(v == null ? '' : v).trim();
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const keyOf = (v) => flexNormalize(clean(v));

// ── المطابقةُ كاملةً لا بالتضمين ─────────────────────────────────────────────
// `flexSpaceRegex` تُطابق بالتضمين: «1234» تجد «12345». وذلك صحيحٌ في البحث،
// وخطأٌ في جمع المال: يُضاف تحصيلُ كشفٍ إلى غيره. فتُثبَّت من الطرفين — ويبقى
// التسامحُ مع المسافات الزائدة والرسم العربيّ كما هو.
const exactFlex = (rn) => {
  const inner = flexSpaceRegex(clean(rn)).source;
  return new RegExp(`^[\\sً-ْـ]*(?:${inner})[\\sً-ْـ]*$`, 'i');
};
// أشكالُ الرقم التي تُطلب بالفهرس قبل اللجوء إلى التعبير.
const variantsOf = (rn) => {
  const t = clean(rn);
  const bare = t.replace(/\s+/g, '');
  return [...new Set([t, bare, t.toUpperCase(), t.toLowerCase(), bare.toUpperCase(), bare.toLowerCase()].filter(Boolean))];
};

const WF_FIELDS = 'reportNumber paymentType collectionDate collectedAmount cashCollectionStatus collectedByWallet invoiceNumber';

/** الكشفُ بهذا الرقم — بالفهرس أوّلًا، ثمّ بالتعبير (رقمٌ كُتب بمسافة). */
async function findWorkflow(rn) {
  const OperationsWorkflow = require('../models/OperationsWorkflow');
  if (!clean(rn)) return null;
  const exact = await OperationsWorkflow.findOne({ reportNumber: { $in: variantsOf(rn) } }).select(WF_FIELDS).lean();
  if (exact) return exact;
  return OperationsWorkflow.findOne({ reportNumber: exactFlex(rn) }).select(WF_FIELDS).lean();
}

/** يجمع قيودَ التحصيل: المبلغُ مجموعُها، والتاريخُ آخرُها. */
const summarise = (rows) => {
  if (!rows || !rows.length) return null;
  const dates = rows.map((r) => clean(r.date).slice(0, 10)).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
  return {
    amount: r2(rows.reduce((a, r) => a + (Number(r.amount) || 0), 0)),
    date: dates.length ? dates[dates.length - 1] : null,
    count: rows.length,
  };
};

/** قيودُ تحصيل المحفظة على هذا الكشف، مجموعةً — أو `null`. */
async function walletCollectionFor(reportNumber) {
  const rn = clean(reportNumber);
  if (!rn) return null;
  const WalletTransaction = require('../models/WalletTransaction');
  const rows = await WalletTransaction.find({ type: 'collection', deliveryStatementNumber: exactFlex(rn) })
    .select('amount date').lean();
  return summarise(rows);
}

/**
 * أهذا الكشفُ في يد القسم؟ — العلمُ ثلاثُ حالات:
 *   `true`  كتبته المحفظة، فهي تتبعه وترفعه.
 *   `false` كتب فيه القسمُ بيده (سجّل التحصيلَ أو عدّله أو رفعه): لا تعود
 *           المحفظةُ إليه أبدًا — ولا حين يُرفع التحصيلُ بيدٍ عن قصد، فإعادتُه
 *           في أوّل مطابقةٍ نقضٌ لقرار القسم.
 *   غائبٌ   لم يمسّه أحد — إلّا أن يكون محصَّلًا من الدفتر أو الشيت، فهو للقسم.
 */
const handCollected = (wf) => wf.collectedByWallet === false
  || (!wf.collectedByWallet && (!!wf.collectionDate || wf.cashCollectionStatus === 'collected'));

/**
 * ما يجب أن يكون على الكشف — بلا كتابة. تقرؤه المزامنةُ وسكربتُ التعبئة معًا.
 * @returns {{action: 'collect'|'update'|'undo'|'hand'|'none', set?: object}}
 */
function plan(wf, wallet) {
  const owned = !!wf.collectedByWallet;
  if (wallet && wallet.date && wf.paymentType === 'cash') {
    if (handCollected(wf)) return { action: 'hand' };
    const date = new Date(wallet.date); // كما يكتبه recordCollection — راجع الترويسة
    const same = owned && wf.collectionDate
      && new Date(wf.collectionDate).getTime() === date.getTime()
      && Math.abs((Number(wf.collectedAmount) || 0) - wallet.amount) < 0.01;
    if (same) return { action: 'none' };
    return {
      action: owned ? 'update' : 'collect',
      set: { collectionDate: date, collectedAmount: wallet.amount, collectedByWallet: true },
    };
  }
  // لا قيدَ بقي، أو لم يعد الكشفُ نقديًّا: يُرفع ما كتبته المحفظة وحدَه.
  // والعلمُ يُمحى لا يُكتب `false`: تلك حالةُ «في يد القسم» (راجع handCollected).
  if (owned) return { action: 'undo', set: { collectionDate: null, collectedAmount: 0 }, unset: { collectedByWallet: 1 } };
  return { action: 'none' };
}

const AR = { collect: 'تحصيلٌ من المحفظة', update: 'تحديثُ تحصيل المحفظة', undo: 'رفعُ تحصيل المحفظة' };
const ymd = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '—');

/**
 * يكتب الخطط، ثمّ الدفترَ والذاكرة، ثمّ يُعلن — بهذا الترتيب: الإعلانُ قبل
 * الإبطال يجعل المستمعَ يقرأ القديمَ ويتأخّر خطوة (announce-before-invalidate).
 */
async function applyPlans(items, { user = null, reason = '' } = {}) {
  const todo = items.filter((x) => x.plan && x.plan.set);
  if (!todo.length) return [];
  const OperationsWorkflow = require('../models/OperationsWorkflow');
  const logAudit = require('./auditLogger');

  for (const { wf, plan: p } of todo) {
    const $set = { ...p.set };
    if (user && user._id) $set.lastModifiedBy = user._id;
    // eslint-disable-next-line no-await-in-loop
    await OperationsWorkflow.updateOne({ _id: wf._id }, { $set, ...(p.unset ? { $unset: p.unset } : {}) });
  }

  // دفترُ التحصيل (صفُّ الشحنة النقديّة) يتبع الكشف — ويُبطل ذاكرةَ القسم والدفتر.
  try {
    await require('../controllers/collectionsDeptController').syncLedgerFromWorkflows(
      todo.map(({ wf, plan: p }) => ({ _id: wf._id, invoiceNumber: wf.invoiceNumber, collectionDate: p.set.collectionDate })),
      { collectionDate: true },
    );
  } catch (e) { console.error('wallet→collections ledger sync:', e.message); }
  // وذاكرةُ سير العمل وما يقرأ التحصيلَ — `clear` يختم الإبطالَ للعامل الآخر أيضًا.
  try {
    cache.clear('wf:');
    cache.clear('collections-dept:'); cache.clear('cdr:');
    require('../controllers/collectionsLedgerController').invalidate();
  } catch (_) { /* */ }

  for (const { wf, plan: p, wallet } of todo) {
    const details = p.action === 'undo'
      ? `${AR.undo} عن الكشف ${wf.reportNumber}${reason ? ` — ${reason}` : ''}`
      : `${AR[p.action]} على الكشف النقديّ ${wf.reportNumber}: ${wallet.amount} ريال بتاريخ ${wallet.date}`
        + `${wallet.count > 1 ? ` (مجموعُ ${wallet.count} قيود)` : ''}${reason ? ` — ${reason}` : ''}`;
    // eslint-disable-next-line no-await-in-loop
    await logAudit({
      user: user || undefined,
      bySystem: !user,
      action: 'wallet_cash_collection',
      entity: 'OperationsWorkflow',
      entityId: wf._id,
      entityKey: wf.reportNumber,
      details,
      changes: {
        details,
        before: { collectionDate: wf.collectionDate || null, collectedAmount: wf.collectedAmount || 0, collectedByWallet: !!wf.collectedByWallet },
        after: { collectionDate: p.set.collectionDate ? ymd(p.set.collectionDate) : null, collectedAmount: p.set.collectedAmount },
      },
    });
  }

  try {
    const { emitToAll } = require('../websocket/socketManager');
    // بلا `_id`: شاشةُ التشغيل تستبدل الصفَّ بما يصلها في `workflow:updated`،
    // فخبرٌ بمعرّفٍ ولا صفّ يمحو الصفَّ من الشاشة. فهذا لشاشة الكاش (تعيد
    // الجلب)، و`bulkImported` لشاشة التشغيل (تعيد الجلب)، و`collections:changed`
    // للوحة القسم.
    emitToAll('workflow:updated', { bulk: true, collection: true, fromWallet: true });
    emitToAll('workflow:bulkImported', { fromWallet: true, collection: true, count: todo.length });
    emitToAll('collections:changed', { source: 'wallet', field: 'collectionDate', reportNumbers: todo.map((x) => x.wf.reportNumber) });
  } catch (_) { /* */ }

  return todo.map(({ wf, plan: p }) => ({ _id: wf._id, reportNumber: wf.reportNumber, action: p.action }));
}

/**
 * يُطابق تحصيلَ الكشوف بهذه الأرقام مع المحفظة ويكتب ما اختلف.
 * يُنادى بعد كلّ إنشاءٍ أو تعديلٍ أو نقلٍ أو حذفٍ لقيد تحصيل، وبعد تغيّر نوع الكشف.
 * @param {string|string[]} reportNumbers
 */
async function syncWalletCollection(reportNumbers, opts = {}) {
  const list = [...new Set((Array.isArray(reportNumbers) ? reportNumbers : [reportNumbers]).map(clean).filter(Boolean))];
  const items = [];
  const seen = new Set();
  for (const rn of list) {
    // eslint-disable-next-line no-await-in-loop
    const wf = await findWorkflow(rn);
    if (!wf || seen.has(String(wf._id))) continue;
    seen.add(String(wf._id));
    // eslint-disable-next-line no-await-in-loop
    const wallet = await walletCollectionFor(wf.reportNumber);
    items.push({ wf, wallet, plan: plan(wf, wallet) });
  }
  return applyPlans(items, opts);
}

/**
 * المطابقةُ كلُّها: كلُّ قيد تحصيلٍ برقم كشف، وكلُّ كشفٍ كتبته المحفظة.
 * تُنادى بعد ما يغيّر نوعَ الدفع جملةً (المزامنة، صفحة «أنواع الدفع»، التصفير)،
 * وهي سكربتُ التعبئة نفسُه (`apply: false` للتجربة).
 *
 * `regexFallback`: رقمٌ لم يُوجد بالفهرس يُطلب بالتعبير — مسحٌ للمجموعة، فيُترك
 * في الدورات الدوريّة ويُستعمَل في السكربت.
 */
async function resyncAllWalletCollections({ apply = true, regexFallback = false, ...opts } = {}) {
  const WalletTransaction = require('../models/WalletTransaction');
  const OperationsWorkflow = require('../models/OperationsWorkflow');
  const entries = await WalletTransaction.find({ type: 'collection', deliveryStatementNumber: { $nin: [null, ''] } })
    .select('deliveryStatementNumber amount date').lean();

  const groups = new Map(); // المفتاحُ المطويّ → القيود
  for (const e of entries) {
    const k = keyOf(e.deliveryStatementNumber);
    if (!k) continue;
    if (!groups.has(k)) groups.set(k, { raw: clean(e.deliveryStatementNumber), rows: [] });
    groups.get(k).rows.push(e);
  }

  const variants = [...new Set([...groups.values()].flatMap((g) => g.rows.flatMap((r) => variantsOf(r.deliveryStatementNumber))))];
  const [matched, owned] = await Promise.all([
    variants.length ? OperationsWorkflow.find({ reportNumber: { $in: variants } }).select(WF_FIELDS).lean() : [],
    OperationsWorkflow.find({ collectedByWallet: true }).select(WF_FIELDS).lean(),
  ]);
  const byId = new Map();
  for (const w of [...matched, ...owned]) byId.set(String(w._id), w);
  const foundKeys = new Set([...byId.values()].map((w) => keyOf(w.reportNumber)));

  const notFound = [];
  for (const [k, g] of groups) {
    if (foundKeys.has(k)) continue;
    if (regexFallback) {
      // eslint-disable-next-line no-await-in-loop
      const w = await OperationsWorkflow.findOne({ reportNumber: exactFlex(g.raw) }).select(WF_FIELDS).lean();
      if (w) { byId.set(String(w._id), w); foundKeys.add(keyOf(w.reportNumber)); continue; }
    }
    notFound.push(g.raw);
  }

  const items = [...byId.values()].map((wf) => {
    const g = groups.get(keyOf(wf.reportNumber));
    const wallet = g ? summarise(g.rows) : null;
    return { wf, wallet, plan: plan(wf, wallet) };
  });

  const summary = {
    entries: entries.length,
    reports: groups.size,
    notFound,
    cash: items.filter((x) => x.wallet && x.wf.paymentType === 'cash').length,
    nonCash: items.filter((x) => x.wallet && x.wf.paymentType !== 'cash').length,
    byAction: items.reduce((m, x) => { m[x.plan.action] = (m[x.plan.action] || 0) + 1; return m; }, {}),
    items,
  };
  summary.applied = apply ? await applyPlans(items, opts) : [];
  return summary;
}

// ── ومن المزامنة: مرّةً بعد أن تهدأ ─────────────────────────────────────────
// استطلاعُ المنصّة يكتب كلَّ بضع ثوانٍ، وقد يغيّر نوعَ كشفٍ عليه تحصيلُ محفظة.
// فتُجمَع النداءاتُ في واحدٍ بعد ثوانٍ — والمطابقةُ ثلاثةُ استعلاماتٍ صغيرة.
let pending = null;
function scheduleResync(delayMs = 5000) {
  if (pending) return;
  pending = setTimeout(() => {
    pending = null;
    resyncAllWalletCollections({ reason: 'تغيّر نوع الدفع' })
      .catch((e) => console.error('wallet cash-collection resync:', e.message));
  }, delayMs);
  if (pending.unref) pending.unref();
}

module.exports = {
  syncWalletCollection, resyncAllWalletCollections, scheduleResync,
  walletCollectionFor, plan, exactFlex,
};
