/**
 * Reads the owner's KPI workbooks ("company kpis/" at the repo root) and writes
 * seeds/data/sectionKpis.json: one form per section and job, criteria with weights in percent.
 * Identical forms (same items and weights) are merged; their employees and job titles are kept as assignment hints.
 * English (or Arabic, for the English-only IT sheet) text is kept from the existing JSON by source text, so a re-run never loses translations;
 * `--translations file.json` adds a { source: translation } map. Missing translations are listed at the end.
 *
 * Run: node src/scripts/extractSectionKpis.js ["../company kpis"] [--translations map.json]
 */
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const args = process.argv.slice(2);
const trIdx = args.indexOf('--translations');
const trFile = trIdx >= 0 ? args[trIdx + 1] : null;
const DIR = path.resolve(args.find((a, i) => !a.startsWith('--') && i !== trIdx + 1) || path.join(__dirname, '../../../company kpis'));
const OUT = path.join(__dirname, '../seeds/data/sectionKpis.json');
const { DATA_DEPT } = require('../config/roles');

// Latin digits everywhere in the UI, so Arabic-Indic digits in the workbooks are converted.
const clean = (v) => String(v ?? '').replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/٫/g, '.').replace(/\s+/g, ' ').trim();
const num = (v) => {
  const s = clean(v);
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};
const book = (file) => XLSX.readFile(path.join(DIR, file));
const rowsOf = (wb, sheet) => XLSX.utils.sheet_to_json(wb.Sheets[sheet || wb.SheetNames[0]], { header: 1, defval: '', raw: true })
  .map((r) => r.map(clean));

const forms = [];

// Layout A (one sheet, employee blocks): م | الموظف | المسمى الوظيفي | المؤشر | المستهدف المقترح | [مصدر القياس] | الوزن
function layoutA(file, sheet, section) {
  const rows = rowsOf(book(file), sheet);
  const hi = rows.findIndex((r) => r.includes('المؤشر'));
  const h = rows[hi];
  const cI = h.indexOf('المؤشر'), tI = h.indexOf('المستهدف المقترح'), sI = h.indexOf('مصدر القياس'), wI = h.indexOf('الوزن');
  let cur = null;
  for (const c of rows.slice(hi + 1)) {
    if (c[1] && c[2] && c[cI] && num(c[0]) != null) {
      cur = { file, sheet, section, employee: c[1], jobTitle: c[2], items: [] };
      forms.push(cur);
    }
    if (!cur) continue;
    if (c.some((x) => x.startsWith('الدرجة المرجّحة'))) { cur = null; continue; }
    if (c[cI] && num(c[wI]) != null) {
      cur.items.push({ ar: c[cI], targetAr: tI >= 0 ? c[tI] : '', sourceAr: sI >= 0 ? c[sI] : '', w: num(c[wI]) });
    }
  }
}

// Layout B (collections): an axis weight shared evenly by the axis's tasks.
function layoutB(file, sheet, section) {
  const rows = rowsOf(book(file), sheet);
  let cur = null; let axis = null;
  const flush = () => {
    if (axis && cur && axis.items.length) axis.items.forEach((t) => cur.items.push({ ar: t, groupSrc: axis.name, w: axis.w / axis.items.length }));
    axis = null;
  };
  for (const c of rows.slice(3)) {
    if (c[4].startsWith('المستوى')) { flush(); cur = { file, sheet, section, employee: c[0], jobTitle: c[1], items: [] }; forms.push(cur); continue; }
    if (c[4].startsWith('النتيجة النهائية')) { flush(); cur = null; continue; }
    if (!cur) continue;
    if (c[2]) { flush(); axis = { name: c[2], items: [], w: 0 }; }
    if (axis && c[4]) { axis.items.push(c[4]); if (num(c[5]) != null) axis.w = num(c[5]); }
  }
  flush();
}

// Layout C (IT, English only): Employee | Job Title | KPI | Weight; a 'Tier:'/'Reports to:' row opens an employee.
function layoutC(file, sheet, section) {
  const rows = rowsOf(book(file), sheet);
  let cur = null;
  for (const c of rows.slice(2)) {
    if (c[2].startsWith('Final Score')) { cur = null; continue; }
    if (/^(Tier:|Reports to:)/.test(c[2])) { cur = { file, sheet, section, employee: c[0], jobTitleEn: c[1], items: [] }; forms.push(cur); continue; }
    if (cur && c[2] && num(c[3]) != null) cur.items.push({ en: c[2], w: num(c[3]) });
  }
}

// Layout D (delivery): a sheet per employee, four weighted groups of items.
function layoutD(file, section) {
  const wb = book(file);
  for (const sn of wb.SheetNames) {
    if (!/^\d\d /.test(sn)) continue;
    const rows = rowsOf(wb, sn);
    const f = {
      file, sheet: sn, section,
      employee: rows[0][0].replace('تقييم أداء:', '').trim(),
      jobTitle: clean((/الوظيفة:\s*([^|]*)/.exec(rows[1].join(' | ')) || [])[1]),
      items: [],
    };
    let group = null;
    for (const c of rows.slice(9)) {
      if (/^(أولاً|ثانياً|ثالثاً|رابعاً):/.test(c[0])) { group = c[0]; continue; }
      if (c[0] === 'البند' || /^(درجة القسم|الدرجة النهائية|توقيع)/.test(c[0])) continue;
      if (group && c[0] && num(c[1]) != null) f.items.push({ ar: c[0], groupSrc: group, w: num(c[1]) });
    }
    forms.push(f);
  }
}

// Layout E (finance): الوظيفة | # | المؤشر | الوزن; a 'إجمالي <job> / <name>' row closes a job.
function layoutE(file, section) {
  const rows = rowsOf(book(file));
  let cur = null;
  for (const c of rows.slice(1)) {
    if (c[0].startsWith('إجمالي')) { if (cur) cur.employee = clean(c[0].split('/')[1]); cur = null; continue; }
    if (c[0]) { cur = { file, sheet: '', section, employee: '', jobTitle: c[0], items: [] }; forms.push(cur); }
    if (cur && c[2] && num(c[3]) != null) cur.items.push({ ar: c[2], w: num(c[3]) });
  }
}

const AHMED = 'Ahmed Mahmoud Teams - KPIs 2026.xlsx';
const SALES = 'Sales Team KPIs - Oct 2026.xlsx';
const OPS = 'operation & vendors team.xlsx';
layoutA(AHMED, 'التخليص الجمركى', 'Customs');
layoutA(AHMED, 'اسطول النقل', 'Fleet Management');
layoutA(AHMED, 'ادارة المعلومات ودعم القرار', DATA_DEPT);
layoutB('Energize_Performance_Evaluation KPI.xlsx', 'التحصيل', 'Collections');
layoutA('HR_Team_KPIs_-_Oct_2026.xlsx', 'الموارد البشرية', 'HR');
layoutA(SALES, 'المؤشرات', 'Sales');
layoutC('Software_and_IT_KPIs (1).xlsx', 'IT KPIs', 'Software & IT');
layoutA(OPS, 'تشغيل 3PL', 'Operations');
layoutA(OPS, 'إدارة الموردين', 'Vendors Management');
layoutD('تقييم_الاداء_تشغيل_الدليفري.xlsx', 'B2C');
layoutE('مؤشرات اداء الادارة المالية .xlsx', 'Accounting');

// The sales workbook is one team under the sales manager, but customer service and marketing accounts sit in other sections; a form only applies inside its section.
const SECTION_BY_JOB = [
  [/خدمة العملاء/, 'CRM'],
  [/التسويق/, 'Marketing'],
];
// Forms that grade a section head or team leader: also matched by account role, and closed to the section manager's own editing.
const ROLES_BY_JOB = [
  [/^مدير التخليص الجمركى$/, ['customs_manager']],
  [/^مدير التشغيل$/, ['fleet_manager']],
  [/^مدير التحصيل$/, ['collections_manager']],
  [/^مديرة إدارة وتطوير الموارد البشرية$/, ['hr_manager']],
  [/^مدير خدمة العملاء/, ['crm_manager']],
  [/^Software Engineering & IT Infrastructure Manager$/, ['it_manager']],
  [/^قائد فريق إدارة الموردين/, ['vendors_team_leader']],
  [/^مدير تشغيل الدليفري/, ['b2c_manager']],
  [/^المدير المالي التنفيذي$/, ['cfo']],
  [/^رئيس الحسابات$/, ['accounting_manager']],
];
// Stated in the workbook header (الطبقة الأولى); other workbooks name no tier.
const TIER_BY_FILE = { 'HR_Team_KPIs_-_Oct_2026.xlsx': 1, [SALES]: 1 };
// Display name of a merged form when its members carry different titles.
const NAME_OVERRIDES = {
  'Operations|محمد مصطفى': 'مشرف تشغيل منطقة',
  'Operations|محمد عثمان': 'مندوب فرع',
  'Vendors Management|حنين': 'متدرب — فريق إدارة الموردين',
  'B2C|عبدالرحمن رحومه': 'مسؤول مشروع أمازون ومساعده',
  'B2C|الشرقاوي|مسؤول مشروع كيتا': 'مسؤول ومشرفو مشروع كيتا',
  'B2C|ادهم': 'ميكانيكي',
  'Accounting|هيثم مليجي': 'أمين مخزن',
};
const GROUPS = {
  'المهام و المسؤوليات - Tasks': ['المهام والمسؤوليات', 'Tasks and responsibilities'],
  'Attendance – الالتزام بالحضور': ['الالتزام بالحضور', 'Attendance'],
  'Appearance – المظهر العام': ['المظهر العام', 'Appearance'],
  'أولاً: المهام الوظيفية (من وصف الوظيفة في لوحة الهيكل)': ['المهام الوظيفية', 'Job duties'],
  'ثانياً: الالتزامات ومؤشرات الأداء (KPIs)': ['الالتزامات ومؤشرات الأداء', 'Commitments and KPIs'],
  'ثالثاً: الحضور والالتزام': ['الحضور والالتزام', 'Attendance and discipline'],
  'رابعاً: السلوك': ['السلوك', 'Conduct'],
};

// Existing translations, by source text.
const known = new Map();
if (fs.existsSync(OUT)) {
  const prev = JSON.parse(fs.readFileSync(OUT, 'utf8'));
  for (const t of prev.templates || []) {
    const pairs = [[t.nameAr, t.name], ...(t.jobTitles || []).map((j, i) => [j, (t.jobTitlesEn || [])[i]])];
    for (const c of t.criteria || []) pairs.push([c.titleAr, c.title], [c.descriptionAr, c.description], [c.dataSourceAr, c.dataSource]);
    for (const [a, e] of pairs) {
      if (a && e) { known.set(a, e); known.set(e, a); }
    }
  }
}
if (trFile) for (const [k, v] of Object.entries(JSON.parse(fs.readFileSync(trFile, 'utf8')))) if (v) known.set(k, v);
const missing = new Set();
const tr = (s) => { if (!s) return ''; const v = known.get(s); if (!v) missing.add(s); return v || ''; };

const shortTitle = (t) => clean(String(t || '').split(' · ')[0].replace(/\s+—\s+(قسم جديد|الغربية|الشرقية والوسطى)$/, ''));
const toPercent = (items) => {
  const raw = items.map((i) => Math.round(i.w * 100 * 10000) / 10000);
  const diff = Math.round((100 - raw.reduce((s, x) => s + x, 0)) * 10000) / 10000;
  if (raw.length && Math.abs(diff) > 0) raw[raw.length - 1] = Math.round((raw[raw.length - 1] + diff) * 10000) / 10000;
  return raw;
};

const byKey = new Map();
for (const f of forms.filter((x) => x.items.length)) {
  const title = f.jobTitle || '';
  const section = (SECTION_BY_JOB.find(([re]) => re.test(title)) || [])[1] || f.section;
  const sig = `${section}||${f.items.map((i) => `${i.ar || i.en}@${i.w.toFixed(6)}`).join('##')}`;
  if (!byKey.has(sig)) byKey.set(sig, { section, forms: [] });
  byKey.get(sig).forms.push({ ...f, section });
}

const templates = [];
for (const { section, forms: group } of byKey.values()) {
  const f0 = group[0];
  const english = !f0.jobTitle;
  const titleAr = english ? tr(f0.jobTitleEn) : f0.jobTitle;
  const nameAr = NAME_OVERRIDES[`${section}|${f0.employee}|${f0.jobTitle}`] || NAME_OVERRIDES[`${section}|${f0.employee}`] || shortTitle(titleAr);
  const roles = (ROLES_BY_JOB.find(([re]) => re.test(f0.jobTitle || f0.jobTitleEn)) || [])[1] || [];
  const weights = toPercent(f0.items);
  const jobTitles = [...new Set(group.map((g) => (english ? tr(g.jobTitleEn) : g.jobTitle)).filter(Boolean))];
  templates.push({
    section,
    nameAr,
    name: english ? shortTitle(f0.jobTitleEn) : tr(nameAr),
    jobTitles,
    jobTitlesEn: jobTitles.map((j) => (english ? group.find((g) => tr(g.jobTitleEn) === j)?.jobTitleEn || '' : tr(j))),
    roles,
    employeeNames: [...new Set(group.map((g) => g.employee).filter(Boolean))],
    tier: TIER_BY_FILE[f0.file] || null,
    source: `${f0.file}${f0.sheet ? ` / ${f0.sheet}` : ''}`,
    criteria: f0.items.map((i, k) => {
      const g = GROUPS[i.groupSrc] || ['', ''];
      return {
        order: k,
        titleAr: english ? tr(i.en) : i.ar,
        title: english ? i.en : tr(i.ar),
        groupAr: g[0], group: g[1],
        descriptionAr: i.targetAr || '', description: tr(i.targetAr),
        dataSourceAr: i.sourceAr || '', dataSource: tr(i.sourceAr),
        weight: weights[k],
      };
    }),
  });
}

fs.writeFileSync(OUT, `${JSON.stringify({ source: 'company kpis/*.xlsx', templates }, null, 2)}\n`);
console.log(`${forms.length} employee forms → ${templates.length} templates → ${path.relative(process.cwd(), OUT)}`);
const bySection = {};
for (const t of templates) bySection[t.section] = (bySection[t.section] || 0) + 1;
console.log(bySection);
if (missing.size) {
  console.log(`missing translations: ${missing.size}`);
  if (args.includes('--list-missing')) console.log(JSON.stringify([...missing], null, 1));
}
