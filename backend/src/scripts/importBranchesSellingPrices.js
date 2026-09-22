/**
 * سعرُ البيع الحقيقيّ من تقرير الفروع — إلى «التشغيل — خاصّ» وإلى ملفّات العملاء.
 *
 * ── العلّة ──────────────────────────────────────────────────────────────────
 * منصّةُ التشغيل تكتب في كلّ كشفٍ سعرَ بيعٍ يساوي سعرَ الشراء، فليس عندنا في
 * النظام رقمٌ واحدٌ صحيحٌ لما نأخذه من العميل. وتقريرُ الفروع (ورقةُ `Data`)
 * يحمله منذ أوّل السنة: صفٌّ لكلّ يومٍ وعميلٍ ومسارٍ بسعر بيعه وشرائه.
 *
 * ── والربطُ بالتاريخ لا برقم الكشف ─────────────────────────────────────────
 * الورقةُ لا تحمل رقمَ كشف. فالهويّةُ المركَّبة: **اليومُ + العميلُ + المسارُ +
 * سعرُ الشراء**. وسعرُ الشراء هو الشاهد: إن اتّفق مع كشفٍ في اليوم نفسِه لنفس
 * العميل على المسار نفسِه فهو هو — واحتمالُ الخطأ بعد أربعة شروطٍ ضئيل.
 *
 * وصفُّ الورقة قد يقابل كشوفًا عدّة (العميلُ طلب خمسَ عربات، وعندنا كشفٌ لكلّ
 * عربة): السعرُ سعرُ **العربة الواحدة** — `اجمالي البيع` هو المضروب في العدد —
 * فيُكتب كما هو على كلّ كشفٍ مطابق. وهذا هو المقصود.
 *
 * ── ولا يُخمَّن مال ────────────────────────────────────────────────────────
 * اليومُ والعميلُ والمسارُ نفسُه بسعرين مختلفين في الورقة = التباسٌ لا يُحسَم
 * آليًّا، فيُترَك ويُقال. وما لم يُطابَق يُكتب في ملفٍّ بسببه.
 *
 * وتُكتب في موضعين:
 *   • `PrivateSellingPrice` — سعرُ الكشف في التقرير الخاصّ (لا يراه أحدٌ خارجنا).
 *   • مسارُ العميل في `ShipmentOrderCustomer.routes` — والأحدثُ يغلب، فيرثه
 *     كلُّ ما يُنشأ بعدُ (راجع utils/customerRoutes).
 *
 * تجربةٌ افتراضًا؛ `--apply` للكتابة.
 *   node src/scripts/importBranchesSellingPrices.js [path.xlsx] [--apply]
 */
require('dotenv').config({ quiet: true });
const path = require('path');
const XLSX = require('xlsx');
const mongoose = require('mongoose');

const ROOT = path.join(__dirname, '../../..');
const DEFAULT_FILE = path.join(ROOT, 'operation files/Copy of branches report 2026.xlsx');
const OUT = path.join(ROOT, 'مراجعة أسعار البيع من تقرير الفروع.xlsx');

const S = (v) => String(v ?? '').trim();
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
// التواريخُ أرقامٌ تسلسليّة — `cellDates` تُسقط يومًا على هذا الجهاز.
const serialToISO = (n) => {
  const x = Number(n);
  if (!Number.isFinite(x) || x <= 0) return null;
  return new Date(Date.UTC(1899, 11, 30) + x * 86400000).toISOString().slice(0, 10);
};

(async () => {
  const file = process.argv.find((a) => a.endsWith('.xlsx')) || DEFAULT_FILE;
  const apply = process.argv.includes('--apply');
  await mongoose.connect(process.env.MONGODB_URI);

  const CollectionsParty = require('../models/CollectionsParty');
  const { fold } = CollectionsParty;
  const OperationsWorkflow = require('../models/OperationsWorkflow');
  const PrivateSellingPrice = require('../models/PrivateSellingPrice');
  const ShipmentOrderCustomer = require('../models/ShipmentOrderCustomer');
  const { routeKey, applyRoute } = require('../utils/customerRoutes');

  // ── ١ · الورقة ────────────────────────────────────────────────────────────
  const wb = XLSX.readFile(file, { cellDates: false });
  const raw = XLSX.utils.sheet_to_json(wb.Sheets.Data, {
    header: 1, defval: null, blankrows: false, raw: true,
  });
  // الصفُّ الأوّل أرقامٌ مجمّعة، والثاني هو العناوين.
  const head = raw.findIndex((r) => (r || []).some((c) => S(c) === 'اسم العميل'));
  const H = {};
  (raw[head] || []).forEach((c, i) => { H[S(c)] = i; });
  const col = (r, name) => r[H[name]];

  const sheetRows = raw.slice(head + 1).map((r) => ({
    date: serialToISO(col(r, 'التاريخ')),
    customer: S(col(r, 'اسم العميل')),
    from: S(col(r, 'من')),
    to: S(col(r, 'الى ') ?? col(r, 'الى')),
    sell: num(col(r, 'سعر البيع')),
    buy: num(col(r, 'سعر الشراء')),
    qty: num(col(r, 'عدد الطلبات ') ?? col(r, 'عدد الطلبات')),
  })).filter((x) => x.date && x.customer && x.sell > 0);

  // ── ٢ · الاسمُ المعتمَد ───────────────────────────────────────────────────
  // أسماءُ الورقة مختصرةٌ وقديمة؛ وسجلُّ التحصيل يحمل لكلّ عميلٍ اسمَه المعتمَد
  // وصيغَه السابقة (راجع utils/renameOpsCustomer). فيُردّ الاسمُ إليه.
  const parties = await CollectionsParty.find({ kind: 'customer' }).select('name nameKey aliasKeys').lean();
  const canon = {};
  for (const p of parties) {
    for (const k of [p.nameKey || fold(p.name), ...(p.aliasKeys || [])]) if (k && !canon[k]) canon[k] = p.name;
  }

  // ── والاسمُ المختصر يُردّ إلى صاحبه إن كان واحدًا لا أكثر ────────────────
  // الورقةُ تكتب «شركه كانو» و«مصنع الراجحي»، والكشوفُ تحمل «شركة كانو لخدمات
  // مراكز الشحن المحدودة» و«مصنع الراجحي للمياه». والمطابقةُ التامّة تتركها
  // كلَّها — ألفان وثمانُمئةٍ وثلاثةٌ وستّون صفًّا بلا عميل.
  //
  // فيُبحَث عن اسمٍ في الكشوف يحتوي اسمَ الورقة (أو العكس). **وإن وُجد اسمان
  // فأكثر فلا يُخمَّن**: اسمٌ يحتمل عميلين يحتمل أن يُكتب سعرُ أحدهما على
  // حمولة الآخر، وهو مالٌ لا يُخمَّن.
  const wfNames = [...new Set((await OperationsWorkflow.distinct('username')).map(S).filter(Boolean))];
  const resolveName = (raw) => {
    const k = fold(raw);
    if (canon[k]) return canon[k];
    const hits = wfNames.filter((n) => {
      const f = fold(n);
      return f && (f === k || f.includes(k) || k.includes(f));
    });
    return hits.length === 1 ? hits[0] : null;
  };

  // ── ٣ · كشوفُ المدّة مرّةً واحدة ──────────────────────────────────────────
  const days = [...new Set(sheetRows.map((r) => r.date))].sort();
  const wfs = await OperationsWorkflow.find({
    reportDate: { $gte: new Date(`${days[0]}T00:00:00.000Z`), $lte: new Date(`${days[days.length - 1]}T23:59:59.999Z`) },
  }).select('reportNumber reportDate username fromLocation toLocation purchaseValue sellingValue').lean();

  const dayOf = (d) => new Date(d).toISOString().slice(0, 10);
  const byDayCust = new Map();
  for (const w of wfs) {
    const k = `${dayOf(w.reportDate)}|${fold(w.username || '')}`;
    if (!byDayCust.has(k)) byDayCust.set(k, []);
    byDayCust.get(k).push(w);
  }

  // ── ٤ · الالتباس يُحسَم قبل الكتابة ───────────────────────────────────────
  // اليومُ والعميلُ والمسارُ نفسُه بسعرين: لا يُكتب شيءٌ ويُقال.
  const groups = new Map();
  for (const r of sheetRows) {
    const name = resolveName(r.customer) || r.customer;
    const k = `${r.date}|${fold(name)}|${routeKey(r.from, r.to)}|${r.buy}`;
    if (!groups.has(k)) groups.set(k, { ...r, name, prices: new Set(), rows: 0 });
    const g = groups.get(k);
    g.prices.add(r.sell);
    g.rows += 1;
    g.sell = r.sell;
  }

  const sameRoute = (w, r) => {
    const a = fold(w.fromLocation || '');
    const b = fold(r.from);
    const c = fold(w.toLocation || '');
    const d = fold(r.to);
    const near = (x, y) => !!x && !!y && (x === y || x.includes(y) || y.includes(x));
    return near(a, b) && near(c, d);
  };

  const priceByWorkflow = new Map();   // معرّفُ الكشف ← { price, row }
  const routeLearn = new Map();        // عميل|مسار ← { name, from, to, price, at }
  const unmatched = [];
  const ambiguous = [];
  let matchedGroups = 0;

  for (const g of groups.values()) {
    if (g.prices.size > 1) {
      ambiguous.push({ ...g, prices: [...g.prices].join(' / ') });
      continue;
    }
    const list = byDayCust.get(`${g.date}|${fold(g.name)}`) || [];
    const byBuy = list.filter((w) => Math.abs(num(w.purchaseValue) - g.buy) < 0.5);
    const hits = byBuy.filter((w) => sameRoute(w, g));
    if (!hits.length) {
      unmatched.push({
        ...g,
        reason: !list.length ? 'لا كشوفَ لهذا العميل في هذا اليوم'
          : (!byBuy.length ? 'لا كشفَ بسعر الشراء نفسِه' : 'المسارُ مختلف'),
        candidates: list.slice(0, 3).map((w) => `${w.reportNumber}: ${w.fromLocation}→${w.toLocation} · ${w.purchaseValue}`).join(' | '),
      });
      continue;
    }
    matchedGroups += 1;
    for (const w of hits) {
      // ── وكشفٌ يتنازعه سعران لا يُسعَّر ──────────────────────────────────
      // مجموعتان من الورقة قد تصلان إلى الكشف نفسِه (اليومُ والعميلُ وسعرُ
      // الشراء واحد، والمسارُ مكتوبٌ بصيغتين متقاربتين). فلو كُتب الأخيرُ
      // منهما صامتًا لصار رقمُ المال رهنَ ترتيب الصفوف في الملفّ. فيُعلَّم
      // ويُنزَع بعد المرور كلِّه، ويُقال في ورقة المراجعة.
      const id = String(w._id);
      const prev = priceByWorkflow.get(id);
      if (prev && prev.price !== g.sell) { prev.conflict = true; prev.other = g.sell; continue; }
      priceByWorkflow.set(id, { price: g.sell, reportNumber: w.reportNumber, group: g });
    }
    // ── والمسارُ يُتعلَّم بسعر يومه ─────────────────────────────────────────
    const rk = `${fold(g.name)}|${routeKey(g.from, g.to)}`;
    const prev = routeLearn.get(rk);
    if (!prev || prev.at < g.date) {
      routeLearn.set(rk, { name: g.name, from: g.from, to: g.to, price: g.sell, at: g.date });
    }
  }

  // ── ممرٌّ ثانٍ: المسارُ يُكتب في الورقة مدينةً وفي الكشف عنوانًا ──────────
  // «جدة ← رابغ» في الورقة، و«ص 2 ← الخمره» في الكشف: المسارُ واحدٌ والكتابةُ
  // اثنتان، فلا تُطابِقهما مقارنةُ نصّ. ويقع أيضًا أن يُكتب الاتّجاهُ معكوسًا.
  //
  // فما بقي بلا مطابقةٍ يُسأل مرّةً أخرى بلا شرط المسار — **بشرطين يمنعان
  // الخلط**: أن تكون هذه المجموعةَ الوحيدةَ المتبقّية لذلك اليوم والعميل وسعر
  // الشراء (فلا سعرَ آخرَ ينازعها)، وألّا يكون الكشفُ قد سُعِّر في الممرّ الأوّل.
  const stillOpen = new Map();
  for (const u of unmatched) {
    const k = `${u.date}|${fold(u.name)}|${u.buy}`;
    if (!stillOpen.has(k)) stillOpen.set(k, []);
    stillOpen.get(k).push(u);
  }
  let secondPass = 0;
  const rescued = new Set();
  for (const [k, list] of stillOpen) {
    if (list.length !== 1) continue;            // سعران يتنازعان اليومَ نفسَه
    const g = list[0];
    const cands = (byDayCust.get(`${g.date}|${fold(g.name)}`) || [])
      .filter((w) => Math.abs(num(w.purchaseValue) - g.buy) < 0.5)
      .filter((w) => !priceByWorkflow.has(String(w._id)));
    if (!cands.length) continue;
    for (const w of cands) priceByWorkflow.set(String(w._id), { price: g.sell, reportNumber: w.reportNumber });
    const rk = `${fold(g.name)}|${routeKey(g.from, g.to)}`;
    const prev = routeLearn.get(rk);
    if (!prev || prev.at < g.date) routeLearn.set(rk, { name: g.name, from: g.from, to: g.to, price: g.sell, at: g.date });
    rescued.add(k);
    secondPass += 1;
  }
  const stillUnmatched = unmatched.filter((u) => !rescued.has(`${u.date}|${fold(u.name)}|${u.buy}`));

  // الكشوفُ المتنازَعُ عليها تُنزَع من الكتابة وتُعرَض.
  const conflicts = [];
  for (const [id, v] of [...priceByWorkflow]) {
    if (!v.conflict) continue;
    conflicts.push({
      'رقم الكشف': v.reportNumber,
      'التاريخ': v.group ? v.group.date : '',
      'العميل': v.group ? v.group.name : '',
      'سعرٌ في الورقة': v.price,
      'وسعرٌ آخر': v.other,
    });
    priceByWorkflow.delete(id);
  }

  console.log({
    'أسطر الورقة': sheetRows.length,
    'مجموعات (يوم+عميل+مسار+شراء)': groups.size,
    'طوبقت (المسار نفسُه)': matchedGroups,
    'طوبقت (ممرٌّ ثانٍ بلا شرط المسار)': secondPass,
    'كشوف ستُسعَّر': priceByWorkflow.size,
    'مسارات ستُتعلَّم': routeLearn.size,
    'ملتبسة (سعران في الورقة)': ambiguous.length,
    'كشوف تنازعها سعران — نُزعت': conflicts.length,
    'لم تُطابَق': stillUnmatched.length,
    applied: apply,
  });

  // ── ٥ · ورقةُ المراجعة: ما لم يُكتب ولماذا ────────────────────────────────
  const book = XLSX.utils.book_new();
  const add = (name, rows, cols) => {
    const ws = XLSX.utils.json_to_sheet(rows.length ? rows : [{ 'لا صفوف': '' }]);
    ws['!cols'] = cols;
    ws['!sheetViews'] = [{ RTL: true }];
    XLSX.utils.book_append_sheet(book, ws, name);
  };
  const w = (n) => Array.from({ length: n }, () => ({ wch: 20 }));
  add('الشرح', [
    { 'البند': 'أسطر الورقة', 'العدد': sheetRows.length, 'المعنى': 'صفوفٌ لها تاريخٌ وعميلٌ وسعرُ بيع' },
    { 'البند': 'كشوف سُعِّرت', 'العدد': priceByWorkflow.size, 'المعنى': 'كُتب لها سعرُ البيع الحقيقيّ في «التشغيل — خاصّ»' },
    { 'البند': 'مسارات تعلّمها العملاء', 'العدد': routeLearn.size, 'المعنى': 'صارت السعرَ المقترَح لأيّ شحنةٍ جديدةٍ على المسار' },
    { 'البند': 'ملتبسة', 'العدد': ambiguous.length, 'المعنى': 'اليوم والعميل والمسار نفسُه بسعرين — لم يُكتب شيء' },
    { 'البند': 'لم تُطابَق', 'العدد': stillUnmatched.length, 'المعنى': 'لا كشفَ يقابلها — السببُ في العمود' },
  ], [{ wch: 26 }, { wch: 10 }, { wch: 70 }]);
  add('١ لم تُطابَق', stillUnmatched.map((u) => ({
    'التاريخ': u.date, 'العميل (الورقة)': u.customer, 'العميل (عندنا)': u.name,
    'من': u.from, 'إلى': u.to, 'سعر الشراء': u.buy, 'سعر البيع': u.sell,
    'السبب': u.reason, 'كشوفٌ مرشَّحة': u.candidates,
  })), w(9));
  add('٣ كشوف تنازعها سعران', conflicts, w(5));
  add('٢ ملتبسة', ambiguous.map((a) => ({
    'التاريخ': a.date, 'العميل': a.name, 'من': a.from, 'إلى': a.to,
    'سعر الشراء': a.buy, 'الأسعار في الورقة': a.prices, 'عدد الأسطر': a.rows,
  })), w(7));
  XLSX.writeFile(book, OUT);
  console.log('ورقةُ المراجعة:', OUT);

  if (!apply) { console.log('\n— تجربةٌ فقط —'); process.exit(0); }

  // ── ٦ · الكتابة ───────────────────────────────────────────────────────────
  const ops = [...priceByWorkflow.entries()].map(([id, v]) => ({
    updateOne: {
      filter: { workflow: new mongoose.Types.ObjectId(id) },
      update: {
        $set: { reportNumber: S(v.reportNumber), sellingValue: v.price, source: 'sheet' },
      },
      upsert: true,
    },
  }));
  const CHUNK = 500;
  for (let i = 0; i < ops.length; i += CHUNK) {
    await PrivateSellingPrice.bulkWrite(ops.slice(i, i + CHUNK), { ordered: false });
  }
  console.log(`✓ سُعِّر ${ops.length} كشفًا.`);

  // والمسارات — عميلًا عميلًا، فالأحدثُ يغلب داخل كلّ ملفّ.
  const byCustomer = new Map();
  for (const r of routeLearn.values()) {
    const k = fold(r.name);
    if (!byCustomer.has(k)) byCustomer.set(k, { name: r.name, routes: [] });
    byCustomer.get(k).routes.push(r);
  }
  let touched = 0;
  let created = 0;
  for (const { name, routes } of byCustomer.values()) {
    const key = fold(name);
    const all = await ShipmentOrderCustomer.find({}).select('name').lean();
    const hit = all.find((c) => fold(c.name) === key);
    let doc = hit ? await ShipmentOrderCustomer.findById(hit._id) : null;
    if (!doc) { doc = await ShipmentOrderCustomer.create({ name, routes: [] }); created += 1; }
    for (const r of routes.sort((a, b) => (a.at < b.at ? -1 : 1))) {
      applyRoute(doc, {
        fromCity: r.from, toCity: r.to, price: r.price, at: new Date(`${r.at}T12:00:00.000Z`), source: 'sheet',
      });
    }
    await doc.save();
    touched += 1;
  }
  try { require('../utils/ttlCache').clear('so:'); } catch (_) { /* */ }
  console.log(`✓ ملفّات عملاء: ${touched} (جديدٌ منها ${created}).`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
