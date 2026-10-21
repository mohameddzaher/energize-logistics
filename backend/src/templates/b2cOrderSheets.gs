/**
 * Energize — شيتات أوردرات B2C (سكربت جوجل).
 * الإصدار: 2026-10-21 (ترتيبُ المناديب + تعديلُ الشهور القديمة لمسؤولي القسم)
 *
 * يُلصَق مرّةً في script.google.com ويُشغَّل `setup` مرّةً واحدة (وبعد كلّ تحديثٍ للسكربت). بعدها:
 *   · يُنشئ ملفًّا لكلّ مشروع في فولدر «Energize — مدخلات الأوردرات (B2C)» —
 *     ورقةٌ لكلّ شهر من يناير 2026 إلى ديسمبر 2027، والقديمُ معها.
 *   · كلَّ ٥ دقائق يحدّثها من النظام: المناديب، المشرفون، النقلُ بين المشاريع،
 *     وأرقامُ الأوردرات المكتوبة على النظام، وترتيبُ المناديب. والشهورُ الأخرى يُعاد
 *     رسمُ ما تغيّر منها وحدَه (بصمةُ كلّ شهرٍ من النظام).
 *   · كلُّ رقمٍ يُكتب في خانة يومٍ يصل النظامَ في لحظته (آخرُ تعديلٍ هو المعتمد).
 *   · المشرفون: خاناتُ الأيّام في الشهور التي تُكتب (من أكتوبر 2026) وحدَها.
 *   · مسؤولو القسم (بريدُهم في «شيتات جوجل» بالنظام): محرّرو الحماية في كلّ ورقة —
 *     يكتبون في أيّ يومٍ من أيّ شهر (والشهورُ القديمةُ لهم وحدَهم)، ويسحبون الصفوفَ
 *     ليرتّبوا المناديب فيُحفظ الترتيبُ في النظام ويسري على كلّ الشهور.
 */
const VERSION = '2026-10-21';
const API = 'https://api.energize-logistics.com/api/public/b2c-sheets';
const TOKEN = '__TOKEN__';
const FOLDER_ID = '1FBDdrjmyigID-vjos0MgSSh-NJUVIUca';
const PROJECTS = [
  { key: 'Keeta', ar: 'كيتا' },
  { key: 'HungerStation', ar: 'هنجرستيشن' },
  { key: 'Ninja', ar: 'نينجا' },
];
const SYNC_FROM = '2026-10';
const MONTHS_AR = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
const HEAD = '#12325c';
const SETTINGS = 'الإعدادات';
const HELP = 'طريقة الاستخدام';
const TOTAL_LABEL = /اجمال|إجمال/;
const props = PropertiesService.getScriptProperties();

// ═══════════════════════════════════════════════════════════════════════════
//  التشغيلُ الأوّل — يُشغَّل يدويًّا مرّةً (وإن انقطع لطول الوقت شغّله ثانيةً فيكمل)
// ═══════════════════════════════════════════════════════════════════════════
function setup() {
  const lock = LockService.getScriptLock();
  lock.waitLock(60000);
  try {
    // المشغِّلاتُ أوّلًا — فإن انقطع البناءُ لطول الوقت بقي التحديثُ والإرسالُ يعملان.
    for (const t of ScriptApp.getProjectTriggers()) ScriptApp.deleteTrigger(t);
    ScriptApp.newTrigger('refresh').timeBased().everyMinutes(5).create();
    for (const p of PROJECTS) {
      const ss = getSs_(p);
      ScriptApp.newTrigger('onSheetEdit').forSpreadsheet(ss).onEdit().create();
      ScriptApp.newTrigger('onSheetChange').forSpreadsheet(ss).onChange().create();
    }
    const done = sync_(100, 300000);
    Logger.log(done
      ? 'تمّ. الملفّات في الفولدر، والتحديثُ كلَّ ٥ دقائق.'
      : 'بقيت شهورٌ لم تُرسَم بعد — شغّل setup مرّةً أخرى فيكمل (أو تُرسَم وحدَها تباعًا كلَّ ٥ دقائق).');
  } finally { lock.releaseLock(); }
}

// ── كلَّ ٥ دقائق: الشهرُ الماضي والحاليّ والقادم، وما تغيّر من غيرها ──
function refresh() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return;
  try { sync_(2, 240000); } finally { lock.releaseLock(); }
}

/**
 * لكلّ مشروع: يقرأ ترتيبًا سحبه أحدُ المسؤولين، ثمّ يرسم الشهورَ الثلاثة، ثمّ ما تغيّرت
 * بصمتُه من الشهور الأخرى (الأحدثُ أوّلًا، و`maxStale` منها على الأكثر، في حدود الوقت).
 * يُرجع true إن لم يبقَ شهرٌ متغيّرٌ لم يُرسَم.
 */
function sync_(maxStale, budget) {
  const t0 = Date.now();
  const around = monthsAround_();
  let complete = true;
  for (const p of PROJECTS) {
    const ss = getSs_(p);
    readOrder_(ss, p);
    const st = get_(`/stamps?project=${encodeURIComponent(p.key)}`);
    shareHeads_(ss, st.headEmails || []);
    const stamps = st.stamps || {};
    buildProject_(p, ss, around);
    const stale = Object.keys(stamps)
      .filter((mk) => around.indexOf(mk) < 0 && (props.getProperty(`stamp:${p.key}:${mk}`) !== stamps[mk] || !ss.getSheetByName(nameOfMonth_(mk))))
      .sort().reverse();
    let doneHere = 0;
    while (doneHere < stale.length) {
      if (doneHere >= maxStale || Date.now() - t0 > budget) { complete = false; break; }
      const batch = stale.slice(doneHere, Math.min(doneHere + 3, maxStale, stale.length));
      buildProject_(p, ss, batch);
      doneHere += batch.length;
    }
  }
  return complete;
}

// ── رقمٌ كُتب في خانة يوم → إلى النظام في لحظته ──
function onSheetEdit(e) {
  if (!e || !e.range) return;
  const sh = e.range.getSheet();
  const mk = monthOfName_(sh.getName());
  if (!mk) return;
  const ss = sh.getParent();
  const p = PROJECTS.find((x) => props.getProperty(`ss:${x.key}`) === ss.getId());
  if (!p) return;
  const days = daysIn_(mk);
  const r0 = e.range.getRow(); const c0 = e.range.getColumn();
  const vals = e.range.getValues();
  const ids = sh.getRange(r0, 1, vals.length, 1).getValues();
  const edits = [];
  let skipped = 0;
  const cache = CacheService.getScriptCache();
  for (let i = 0; i < vals.length; i++) {
    const id = String(ids[i][0] || '').trim();
    if (!id || TOTAL_LABEL.test(id) || r0 + i < 2) continue;
    for (let j = 0; j < vals[i].length; j++) {
      const col = c0 + j; const day = col - 4;
      if (day < 1 || day > days) continue;
      if (id === '—') { skipped += 1; continue; } // حسابٌ قديمٌ بلا مندوبٍ في السجلّ
      const v = vals[i][j];
      if (typeof v === 'string' && v.trim() && !/^[0-9٠-٩]+$/.test(v.trim())) continue; // تسميةٌ لا رقم
      edits.push({ month: mk, id, day, value: v === '' ? null : v });
      cache.put(`edit:${ss.getId()}:${sh.getName()}:${r0 + i}:${col}`, '1', 600);
    }
  }
  if (skipped) {
    ss.toast('هذا صفُّ حسابٍ قديمٍ بلا مندوبٍ في سجلّ النظام — لا يُكتب فيه.', 'لم يُحفَظ', 8);
    if (vals.length === 1 && vals[0].length === 1 && e.oldValue !== undefined) e.range.setValue(e.oldValue);
    else props.deleteProperty(`stamp:${p.key}:${mk}`); // يُعاد رسمُ الشهر في التحديث القادم
  }
  if (!edits.length) return;
  const res = post_('/edit', { project: p.key, edits });
  const bad = (res.results || []).filter((x) => !x.ok);
  if (bad.length || !res.results) {
    const why = { future: 'يومٌ لم يأتِ بعد', 'other-project': 'كان المندوبُ في مشروعٍ آخر في هذا اليوم', value: 'اكتب رقمًا صحيحًا', rep: 'رقم الإقامة غير موجود في النظام', month: 'شهرٌ لا يُكتب فيه' };
    const msg = bad.length ? bad.map((b) => `يوم ${b.day}: ${why[b.reason] || b.reason}`).slice(0, 3).join(' · ') : 'تعذّر الوصول إلى النظام';
    ss.toast(msg, 'لم يُحفَظ', 8);
    if (edits.length === 1 && e.oldValue !== undefined) e.range.setValue(e.oldValue);
    else props.deleteProperty(`stamp:${p.key}:${mk}`);
  }
}

// ── تغييرٌ في البنية (سحبُ صفوف) → الترتيبُ الجديد إلى النظام ──
function onSheetChange(e) {
  if (e && /^(EDIT|FORMAT)$/.test(String(e.changeType || ''))) return;
  const ss = e && e.source ? e.source : null;
  if (!ss) return;
  const p = PROJECTS.find((x) => props.getProperty(`ss:${x.key}`) === ss.getId());
  if (!p) return;
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return; // التحديثُ الدوريُّ يقرأ الترتيبَ قبل الرسم
  try {
    if (readOrder_(ss, p)) buildProject_(p, ss, monthsAround_());
  } finally { lock.releaseLock(); }
}

/**
 * هل سحب أحدٌ الصفوف؟ يقارن رقمَ الإقامة في كلّ صفٍّ بما رُسم آخرَ مرّة: إن كانت
 * الصفوفُ نفسَها بترتيبٍ آخر أُرسل الترتيبُ إلى النظام. (وما ليس ترتيبًا — صفٌّ حُذف
 * أو أُضيف — يُعاد رسمُه من النظام.) يُرجع true إن حُفظ ترتيبٌ جديد.
 */
function readOrder_(ss, p) {
  let changed = false;
  for (const sh of ss.getSheets()) {
    const mk = monthOfName_(sh.getName());
    if (!mk) continue;
    const key = `ids:${p.key}:${mk}`;
    const last = props.getProperty(key);
    if (!last) continue;
    const n = sh.getLastRow();
    if (n < 2) continue;
    const ids = sh.getRange(2, 1, n - 1, 1).getValues().map((r) => String(r[0]).trim()).filter((x) => x && !TOTAL_LABEL.test(x));
    let was;
    try { was = JSON.parse(last); } catch (err) { continue; }
    if (ids.join('|') === was.join('|')) continue;
    if (ids.slice().sort().join('|') !== was.slice().sort().join('|')) continue;
    const res = post_('/order', { project: p.key, month: mk, ids: ids.filter((x) => x !== '—') });
    if (res && res.ok) {
      props.setProperty(key, JSON.stringify(ids));
      changed = true;
      ss.toast('حُفظ ترتيبُ المناديب في النظام — ويسري على كلّ الشهور.', 'الترتيب', 6);
    }
  }
  return changed;
}

// ═══════════════════════════════════════════════════════════════════════════
//  البناء
// ═══════════════════════════════════════════════════════════════════════════
function buildProject_(p, ss, months) {
  if (!months.length) return;
  const data = get_(`/layout?project=${encodeURIComponent(p.key)}&months=${encodeURIComponent(months.join(','))}`);
  writeSettings_(ss, data);
  const heads = data.headEmails || [];
  const keys = Object.keys(data.months).sort();
  for (const mk of keys) {
    renderMonth_(ss, p, mk, data.months[mk], heads);
    props.setProperty(`stamp:${p.key}:${mk}`, data.months[mk].stamp || '');
  }
  const sheet1 = ss.getSheetByName('Sheet1') || ss.getSheetByName('ورقة1');
  if (sheet1 && ss.getSheets().length > 1) ss.deleteSheet(sheet1);
  orderSheets_(ss);
}

function getSs_(p) {
  const id = props.getProperty(`ss:${p.key}`);
  if (id) { try { const f = DriveApp.getFileById(id); if (!f.isTrashed()) return SpreadsheetApp.openById(id); } catch (err) { /* أُنشئ غيره */ } }
  const ss = SpreadsheetApp.create(`أوردرات ${p.ar}`);
  ss.setSpreadsheetLocale('ar');
  DriveApp.getFileById(ss.getId()).moveTo(DriveApp.getFolderById(FOLDER_ID));
  props.setProperty(`ss:${p.key}`, ss.getId());
  for (const k of props.getKeys()) {
    if (k.indexOf(`built:${p.key}:`) === 0 || k.indexOf(`stamp:${p.key}:`) === 0 || k.indexOf(`ids:${p.key}:`) === 0) props.deleteProperty(k);
  }
  post_('/register', { project: p.key, spreadsheetId: ss.getId(), url: ss.getUrl() });
  return ss;
}

/** مسؤولو القسم محرّرون للملفّ نفسه — شرطٌ ليعمل إذنُهم في الحماية. */
function shareHeads_(ss, heads) {
  if (!heads.length) return;
  let have;
  try { have = ss.getEditors().map((u) => String(u.getEmail()).toLowerCase()); } catch (err) { return; }
  for (const m of heads) {
    if (have.indexOf(String(m).toLowerCase()) >= 0) continue;
    try { ss.addEditor(m); } catch (err) { Logger.log(`تعذّرت مشاركة الملفّ مع ${m}: ${err}`); }
  }
}

function writeSettings_(ss, data) {
  let sh = ss.getSheetByName(SETTINGS);
  if (!sh) {
    sh = ss.insertSheet(SETTINGS);
    sh.setRightToLeft(true);
    sh.getRange('A1:C2').setValues([
      ['الهدف اليومي (من النظام)', '', 'يُكتب تلقائيًّا من صفحة «المشاريع» في النظام — أخضر إن بلغ الرقمُ الهدف، وأحمر إن قلّ عنه.'],
      ['المشروع', data.project, ''],
    ]).setHorizontalAlignment('center').setVerticalAlignment('middle').setWrap(true);
    sh.setColumnWidths(1, 1, 220); sh.setColumnWidth(2, 120); sh.setColumnWidth(3, 520);
    sh.setRowHeights(1, 2, 40);
    sh.getRange('A1:A2').setFontWeight('bold');
    lockAll_(sh);
  }
  const cur = sh.getRange('B1').getValue();
  if (cur !== data.dailyTarget) sh.getRange('B1').setValue(data.dailyTarget).setFontWeight('bold').setFontSize(14).setFontColor(HEAD);
  // صفحةُ الشرح تُعاد كتابتُها مع كلّ إصدارٍ جديدٍ للسكربت.
  let h = ss.getSheetByName(HELP);
  if (!h || props.getProperty(`help:${ss.getId()}`) !== VERSION) {
    if (h) ss.deleteSheet(h);
    h = ss.insertSheet(HELP);
    h.setRightToLeft(true);
    const lines = [
      ['طريقة الاستخدام'],
      ['اكتب عدد أوردرات المندوب في خانة اليوم أمام اسمه — يصل الرقم إلى «مدخلات الأوردرات» في النظام في لحظته، ومسحُ الخانة يمسحه.'],
      ['آخرُ تعديلٍ هو المعتمد: ما يُكتب على النظام يظهر هنا خلال ٥ دقائق، وما يُكتب هنا يصل النظامَ فورًا.'],
      ['المناديبُ والمشرفون والمشاريع من النظام وحدَه: الأسماءُ وأرقامُ الإقامة والمشرفون لا تُغيَّر هنا (يُعاد كتابتُها من النظام).'],
      ['المشرفون: لا يكتبون إلّا في خانات الأيّام من أكتوبر 2026، وكلُّ شيءٍ آخر مقفول.'],
      ['مسؤولو القسم (مدير القسم ونائبه والإدارة — بريدُهم في «شيتات جوجل» بالنظام): يكتبون في أيّ يومٍ مضى من أيّ شهر، والشهورُ قبل أكتوبر 2026 لهم وحدَهم، ويصل تعديلُهم النظامَ فورًا.'],
      ['ترتيبُ المناديب: يسحب مسؤولُ القسم الصفَّ من رقمه على اليمين إلى مكانه — فيُحفظ الترتيبُ في النظام ويسري على كلّ الشهور وعلى «مدخلات الأوردرات». ويُغيَّر أيضًا من «شيتات جوجل ← ترتيب المناديب» في النظام. ومَن يُضاف جديدًا يأتي في الآخر.'],
      ['من نُقل إلى مشروعٍ آخر يظهر في ملفّ مشروعه الجديد، ويُكتب في الأيّام التي لم يكن فيها هنا «في <المشروع>».'],
      ['الألوان: أخضر = بلغ الهدف اليومي، أحمر = أقلّ منه. والهدفُ من صفحة «المشاريع» في النظام.'],
    ];
    h.getRange(1, 1, lines.length, 1).setValues(lines).setWrap(true).setVerticalAlignment('middle');
    h.setColumnWidth(1, 900); h.setRowHeights(1, lines.length, 34);
    h.getRange('A1').setFontWeight('bold').setFontSize(14);
    lockAll_(h);
    props.setProperty(`help:${ss.getId()}`, VERSION);
  }
}

function renderMonth_(ss, p, mk, m, heads) {
  const name = nameOfMonth_(mk);
  let sh = ss.getSheetByName(name);
  const fresh = !sh;
  if (!sh) { sh = ss.insertSheet(name); sh.setRightToLeft(true); }
  const days = m.days; const rows = m.rows; const n = rows.length;
  const width = 4 + days;
  const L = (c) => columnLetter_(c);

  // القيمُ المطلوبة
  const header = ['رقم الإقامة', 'اسم المندوب', 'المشرف', 'الإجمالي'];
  for (let d = 1; d <= days; d++) header.push(d);
  const grid = [header];
  rows.forEach((r, i) => {
    const line = [r.id, r.name, r.sup || '—', `=SUM(E${i + 2}:${L(width)}${i + 2})`];
    for (let d = 1; d <= days; d++) { const v = r.cells[d]; line.push(v === undefined || v === null ? '' : v); }
    grid.push(line);
  });
  const tot = ['الإجمالي', 'إجمالي اليوم', '', n ? `=SUM(D2:D${n + 1})` : 0];
  for (let c = 5; c <= width; c++) tot.push(n ? `=SUM(${L(c)}2:${L(c)}${n + 1})` : 0);
  grid.push(tot);

  // البنيةُ نفسُها؟ (الصفوف بأرقامها وترتيبها وعددُ الأيّام) — فتُحدَّث الخاناتُ المختلفة وحدَها.
  const lastRow = sh.getLastRow(); const lastCol = sh.getLastColumn();
  const sameShape = !fresh && lastRow === grid.length && lastCol === width
    && sh.getRange(1, 1, lastRow, 1).getValues().every((x, i) => String(x[0]) === String(grid[i][0]));
  const cache = CacheService.getScriptCache();
  if (sameShape) {
    if (n) {
      const cur = sh.getRange(2, 5, n, days).getValues();
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < days; j++) {
          const want = grid[i + 1][4 + j];
          const have = cur[i][j];
          if (String(want) === String(have)) continue;
          if (cache.get(`edit:${ss.getId()}:${name}:${i + 2}:${j + 5}`)) continue; // عُدِّلت للتوّ هنا
          sh.getRange(i + 2, j + 5).setValue(want);
        }
      }
      // الأسماءُ والمشرفون قد تتغيّر على النظام (أو كتب فيها مسؤولٌ بالخطأ)
      const names = sh.getRange(2, 2, n, 2).getValues();
      const want = rows.map((r) => [r.name, r.sup || '—']);
      if (JSON.stringify(names) !== JSON.stringify(want)) sh.getRange(2, 2, n, 2).setValues(want);
      // ومجموعُ الصفّ معادلةٌ تتبع صفَّها — تُعاد إن كُتب فوقها.
      const sums = sh.getRange(2, 4, n, 1).getFormulas();
      const wantSums = grid.slice(1, n + 1).map((r) => [r[3]]);
      if (JSON.stringify(sums) !== JSON.stringify(wantSums)) sh.getRange(2, 4, n, 1).setFormulas(wantSums);
    }
  } else {
    sh.clear(); sh.clearConditionalFormatRules();
    if (sh.getMaxColumns() < width) sh.insertColumnsAfter(sh.getMaxColumns(), width - sh.getMaxColumns());
    if (sh.getMaxColumns() > width) sh.deleteColumns(width + 1, sh.getMaxColumns() - width);
    if (sh.getMaxRows() < grid.length) sh.insertRowsAfter(sh.getMaxRows(), grid.length - sh.getMaxRows());
    if (sh.getMaxRows() > grid.length + 1) sh.deleteRows(grid.length + 2, sh.getMaxRows() - grid.length - 1);
    sh.getRange(1, 1, grid.length, width).setNumberFormat('@').setValues(grid);
    // أرقامُ الأيّام أرقام (لا نصّ) كي تُجمَع وتُلوَّن
    if (n) sh.getRange(2, 5, n + 1, days).setNumberFormat('0');
    sh.getRange(2, 4, n + 1, 1).setNumberFormat('0');
    styleMonth_(sh, n, days, width);
  }
  protectMonth_(sh, m, n, days, heads);
  // آخرُ ما رُسم — به يُعرف إن سحب أحدٌ الصفوف (readOrder_).
  props.setProperty(`ids:${p.key}:${mk}`, JSON.stringify(rows.map((r) => String(r.id))));
}

function styleMonth_(sh, n, days, width) {
  const all = sh.getRange(1, 1, n + 2, width);
  all.setHorizontalAlignment('center').setVerticalAlignment('middle').setWrap(true)
    .setBorder(true, true, true, true, true, true, '#d5dce6', SpreadsheetApp.BorderStyle.SOLID);
  sh.getRange(1, 1, 1, width).setBackground(HEAD).setFontColor('#ffffff').setFontWeight('bold').setFontSize(12);
  sh.getRange(n + 2, 1, 1, width).setBackground('#334155').setFontColor('#ffffff').setFontWeight('bold');
  if (n) {
    sh.getRange(2, 2, n, 1).setFontWeight('bold');
    sh.getRange(2, 4, n, 1).setBackground('#eef2f7').setFontWeight('bold').setFontColor(HEAD);
  }
  sh.setRowHeight(1, 36);
  sh.setRowHeights(2, n + 1, 30);
  sh.setColumnWidth(1, 120); sh.setColumnWidth(2, 220); sh.setColumnWidth(3, 150); sh.setColumnWidth(4, 80);
  sh.setColumnWidths(5, days, 46);
  sh.setFrozenRows(1); sh.setFrozenColumns(4);
  if (n) {
    const range = sh.getRange(2, 5, n, days);
    const tgt = `INDIRECT("'${SETTINGS}'!B1")`;
    sh.setConditionalFormatRules([
      SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied(`=ISTEXT(E2)`).setBackground('#eceff3').setFontColor('#64748b').setRanges([range]).build(),
      SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied(`=AND(ISNUMBER(E2),E2>=${tgt})`).setBackground('#d9f2e3').setFontColor('#166534').setRanges([range]).build(),
      SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied(`=AND(ISNUMBER(E2),E2<${tgt})`).setBackground('#fce4e4').setFontColor('#991b1b').setRanges([range]).build(),
    ]);
  }
}

/**
 * الحماية: الورقةُ كلُّها محميّة، ومحرّروها مسؤولو القسم وحدَهم (يكتبون في أيّ خانة
 * يومٍ ويسحبون الصفوف). وخاناتُ الأيّام للمناديب المكتوب فيهم في الشهور التي تُكتب
 * مفتوحةٌ لكلّ من شُورك في الملفّ (المشرفون).
 */
function protectMonth_(sh, m, n, days, heads) {
  for (const p of sh.getProtections(SpreadsheetApp.ProtectionType.SHEET)) p.remove();
  const prot = sh.protect().setDescription('من النظام — المشرفون: عددُ الأوردرات في خانات الأيّام · مسؤولو القسم: كلُّ الأيّام وترتيبُ المناديب');
  if (m.editable && n) {
    const open = [];
    m.rows.forEach((r, i) => { if (r.editable) open.push(sh.getRange(i + 2, 5, 1, days)); });
    if (open.length) prot.setUnprotectedRanges(open);
  }
  prot.removeEditors(prot.getEditors());
  if (prot.canDomainEdit()) prot.setDomainEdit(false);
  for (const mail of heads || []) {
    try { prot.addEditor(mail); } catch (err) { Logger.log(`تعذّرت إضافة ${mail} لحماية ${sh.getName()}: ${err}`); }
  }
}

function lockAll_(sh) {
  const prot = sh.protect().setDescription('من النظام');
  prot.removeEditors(prot.getEditors());
  if (prot.canDomainEdit()) prot.setDomainEdit(false);
}

function orderSheets_(ss) {
  const sheets = ss.getSheets();
  const order = sheets.map((s) => ({ s, mk: monthOfName_(s.getName()) || (s.getName() === HELP ? '9998' : '9999') }))
    .sort((a, b) => (a.mk < b.mk ? -1 : a.mk > b.mk ? 1 : 0));
  order.forEach((o, i) => {
    if (ss.getSheets()[i].getSheetId() !== o.s.getSheetId()) { ss.setActiveSheet(o.s); ss.moveActiveSheet(i + 1); }
  });
  const cur = ss.getSheetByName(nameOfMonth_(Utilities.formatDate(new Date(), 'Asia/Riyadh', 'yyyy-MM')));
  if (cur) ss.setActiveSheet(cur);
}

// ═══════════════════════════════════════════════════════════════════════════
//  أدوات
// ═══════════════════════════════════════════════════════════════════════════
function get_(path) {
  const r = UrlFetchApp.fetch(`${API}${path}${path.indexOf('?') >= 0 ? '&' : '?'}token=${TOKEN}`, { muteHttpExceptions: true });
  if (r.getResponseCode() !== 200) throw new Error(`النظام ردّ ${r.getResponseCode()}: ${r.getContentText().slice(0, 200)}`);
  return JSON.parse(r.getContentText());
}
function post_(path, body) {
  const r = UrlFetchApp.fetch(`${API}${path}`, {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    payload: JSON.stringify(Object.assign({ token: TOKEN }, body)),
  });
  try { return JSON.parse(r.getContentText()); } catch (err) { return {}; }
}
function monthsAround_() {
  const now = new Date();
  const out = [];
  for (const off of [-1, 0, 1]) {
    const d = new Date(now.getFullYear(), now.getMonth() + off, 1);
    out.push(Utilities.formatDate(d, 'Asia/Riyadh', 'yyyy-MM'));
  }
  return out;
}
function nameOfMonth_(mk) { const [y, m] = mk.split('-').map(Number); return `${MONTHS_AR[m - 1]} ${y}`; }
function monthOfName_(name) {
  const m = String(name).match(/^(\S+)\s+(\d{4})$/);
  if (!m) return null;
  const i = MONTHS_AR.indexOf(m[1]);
  return i < 0 ? null : `${m[2]}-${String(i + 1).padStart(2, '0')}`;
}
function daysIn_(mk) { const [y, m] = mk.split('-').map(Number); return new Date(y, m, 0).getDate(); }
function columnLetter_(c) { let s = ''; while (c > 0) { const r = (c - 1) % 26; s = String.fromCharCode(65 + r) + s; c = Math.floor((c - 1) / 26); } return s; }
