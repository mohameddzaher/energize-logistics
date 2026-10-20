/**
 * Energize — شيتات أوردرات B2C (سكربت جوجل).
 *
 * يُلصَق مرّةً في script.google.com ويُشغَّل `setup` مرّةً واحدة. بعدها:
 *   · يُنشئ ملفًّا لكلّ مشروع في فولدر «Energize — مدخلات الأوردرات (B2C)» —
 *     ورقةٌ لكلّ شهر من يناير 2026 إلى ديسمبر 2027، والقديمُ معها.
 *   · كلَّ ٥ دقائق يحدّثها من النظام: المناديب، المشرفون، النقلُ بين المشاريع،
 *     وأرقامُ الأوردرات المكتوبة على النظام.
 *   · كلُّ رقمٍ يُكتب في خانة يومٍ يصل النظامَ في لحظته (آخرُ تعديلٍ هو المعتمد).
 *   · كلُّ شيءٍ مقفولٌ إلّا خانات الأيّام في الشهور التي تُكتب (من أكتوبر 2026).
 */
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
const props = PropertiesService.getScriptProperties();

// ═══════════════════════════════════════════════════════════════════════════
//  التشغيلُ الأوّل — يُشغَّل يدويًّا مرّةً (وإن انقطع لطول الوقت شغّله ثانيةً فيكمل)
// ═══════════════════════════════════════════════════════════════════════════
function setup() {
  for (const p of PROJECTS) buildProject_(p, 'all');
  for (const t of ScriptApp.getProjectTriggers()) ScriptApp.deleteTrigger(t);
  ScriptApp.newTrigger('refresh').timeBased().everyMinutes(5).create();
  for (const p of PROJECTS) ScriptApp.newTrigger('onSheetEdit').forSpreadsheet(getSs_(p)).onEdit().create();
  Logger.log('تمّ. الملفّات في الفولدر، والتحديثُ كلَّ ٥ دقائق.');
}

// ── كلَّ ٥ دقائق: الشهرُ الماضي والحاليّ والقادم ──
function refresh() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return;
  try {
    const months = monthsAround_();
    for (const p of PROJECTS) buildProject_(p, months.join(','));
  } finally { lock.releaseLock(); }
}

// ── رقمٌ كُتب في خانة يوم → إلى النظام في لحظته ──
function onSheetEdit(e) {
  if (!e || !e.range) return;
  const sh = e.range.getSheet();
  const mk = monthOfName_(sh.getName());
  if (!mk || mk < SYNC_FROM) return;
  const ss = sh.getParent();
  const p = PROJECTS.find((x) => props.getProperty(`ss:${x.key}`) === ss.getId());
  if (!p) return;
  const days = daysIn_(mk);
  const r0 = e.range.getRow(); const c0 = e.range.getColumn();
  const vals = e.range.getValues();
  const ids = sh.getRange(r0, 1, vals.length, 1).getValues();
  const edits = [];
  const cache = CacheService.getScriptCache();
  for (let i = 0; i < vals.length; i++) {
    const id = String(ids[i][0] || '').trim();
    if (!id || id === '—' || /اجمال|إجمال/.test(id) || r0 + i < 2) continue;
    for (let j = 0; j < vals[i].length; j++) {
      const col = c0 + j; const day = col - 4;
      if (day < 1 || day > days) continue;
      const v = vals[i][j];
      if (typeof v === 'string' && v.trim() && !/^[0-9٠-٩]+$/.test(v.trim())) continue; // تسميةٌ لا رقم
      edits.push({ month: mk, id, day, value: v === '' ? null : v });
      cache.put(`edit:${ss.getId()}:${sh.getName()}:${r0 + i}:${col}`, '1', 600);
    }
  }
  if (!edits.length) return;
  const res = post_('/edit', { project: p.key, edits });
  const bad = (res.results || []).filter((x) => !x.ok);
  if (bad.length) {
    const why = { future: 'يومٌ لم يأتِ بعد', 'other-project': 'كان المندوبُ في مشروعٍ آخر في هذا اليوم', value: 'اكتب رقمًا صحيحًا', rep: 'رقم الإقامة غير موجود في النظام', month: 'شهرٌ لا يُكتب فيه' };
    ss.toast(bad.map((b) => `يوم ${b.day}: ${why[b.reason] || b.reason}`).slice(0, 3).join(' · '), 'لم يُحفَظ', 8);
    if (edits.length === 1 && e.oldValue !== undefined) e.range.setValue(e.oldValue);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  البناء
// ═══════════════════════════════════════════════════════════════════════════
function buildProject_(p, months) {
  const data = get_(`/layout?project=${encodeURIComponent(p.key)}&months=${encodeURIComponent(months)}`);
  const ss = getSs_(p);
  writeSettings_(ss, data);
  const keys = Object.keys(data.months).sort();
  for (const mk of keys) {
    if (mk < SYNC_FROM && props.getProperty(`built:${p.key}:${mk}`)) continue; // شهرٌ قديمٌ بُني مرّة
    renderMonth_(ss, mk, data.months[mk]);
    if (mk < SYNC_FROM) props.setProperty(`built:${p.key}:${mk}`, '1');
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
  for (const k of props.getKeys()) if (k.indexOf(`built:${p.key}:`) === 0) props.deleteProperty(k);
  post_('/register', { project: p.key, spreadsheetId: ss.getId(), url: ss.getUrl() });
  return ss;
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
  if (!ss.getSheetByName(HELP)) {
    const h = ss.insertSheet(HELP);
    h.setRightToLeft(true);
    const lines = [
      ['طريقة الاستخدام'],
      ['اكتب عدد أوردرات المندوب في خانة اليوم أمام اسمه — يصل الرقم إلى «مدخلات الأوردرات» في النظام في لحظته، ومسحُ الخانة يمسحه.'],
      ['آخرُ تعديلٍ هو المعتمد: ما يُكتب على النظام يظهر هنا خلال ٥ دقائق، وما يُكتب هنا يصل النظامَ فورًا.'],
      ['المناديبُ والمشرفون والمشاريع من النظام وحدَه: لا تُضاف صفوفٌ ولا تُحذف ولا تُنقل هنا — كلُّ شيءٍ مقفولٌ إلّا خانات الأيّام.'],
      ['من نُقل إلى مشروعٍ آخر يظهر في ملفّ مشروعه الجديد، ويُكتب في الأيّام التي لم يكن فيها هنا «في <المشروع>».'],
      ['الشهورُ قبل أكتوبر 2026 للرجوع إليها فقط (من الشيتات القديمة) ومقفولة.'],
      ['الألوان: أخضر = بلغ الهدف اليومي، أحمر = أقلّ منه. والهدفُ من صفحة «المشاريع» في النظام.'],
    ];
    h.getRange(1, 1, lines.length, 1).setValues(lines).setWrap(true).setVerticalAlignment('middle');
    h.setColumnWidth(1, 900); h.setRowHeights(1, lines.length, 34);
    h.getRange('A1').setFontWeight('bold').setFontSize(14);
    lockAll_(h);
  }
}

function renderMonth_(ss, mk, m) {
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

  // البنيةُ نفسُها؟ (الصفوف بأرقامها وعددُ الأيّام) — فتُحدَّث الخاناتُ المختلفة وحدَها.
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
      // الأسماءُ والمشرفون قد تتغيّر على النظام
      const names = sh.getRange(2, 2, n, 2).getValues();
      const want = rows.map((r) => [r.name, r.sup || '—']);
      if (JSON.stringify(names) !== JSON.stringify(want)) sh.getRange(2, 2, n, 2).setValues(want);
    }
  } else {
    sh.clear(); sh.clearConditionalFormatRules();
    if (sh.getMaxColumns() < width) sh.insertColumnsAfter(sh.getMaxColumns(), width - sh.getMaxColumns());
    if (sh.getMaxColumns() > width) sh.deleteColumns(width + 1, sh.getMaxColumns() - width);
    if (sh.getMaxRows() < grid.length) sh.insertRowsAfter(sh.getMaxRows(), grid.length - sh.getMaxRows());
    if (sh.getMaxRows() > grid.length + 1) sh.deleteRows(grid.length + 2, sh.getMaxRows() - grid.length - 1);
    sh.getRange(1, 1, grid.length, width).setNumberFormat('@').setValues(grid.map((r) => r.map((v) => (typeof v === 'number' ? v : v))));
    // أرقامُ الأيّام أرقام (لا نصّ) كي تُجمَع وتُلوَّن
    if (n) sh.getRange(2, 5, n + 1, days).setNumberFormat('0');
    sh.getRange(2, 4, n + 1, 1).setNumberFormat('0');
    styleMonth_(sh, n, days, width);
  }
  protectMonth_(sh, m, n, days);
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

function protectMonth_(sh, m, n, days) {
  for (const p of sh.getProtections(SpreadsheetApp.ProtectionType.SHEET)) p.remove();
  const prot = sh.protect().setDescription('من النظام — لا يُكتب إلّا عددُ الأوردرات في خانات الأيّام');
  if (m.editable && n) {
    const open = [];
    m.rows.forEach((r, i) => { if (r.editable) open.push(sh.getRange(i + 2, 5, 1, days)); });
    if (open.length) prot.setUnprotectedRanges(open);
  }
  prot.removeEditors(prot.getEditors());
  if (prot.canDomainEdit()) prot.setDomainEdit(false);
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
