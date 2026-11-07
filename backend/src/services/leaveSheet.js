/**
 * The official leave-request sheet, rendered on the server so web and mobile download the same file.
 * Signatures are resolved when the sheet is printed, not only when a stage acted: a stamp made before the person saved a signature in self-service is filled from their current default, so the sheet never shows a blank box for someone who has since signed up a signature.
 * The finance and HR boxes carry their department head (User.leaveSheetSigner), whoever in the department approved.
 * Only process viewers (utils/leaveChain.seesProcess) see an open request's stage boxes and stage status; everyone else sees it as under review until it is decided.
 */
const fs = require('fs');
const path = require('path');
const { withPage, getFontCss } = require('../utils/pdfBrowser');
const chain = require('../utils/leaveChain');
const { toHijri } = require('../utils/hijri');

const LETTERHEAD = path.join(__dirname, '..', 'assets', 'hr', 'payroll.png');
let letterheadUri = null;
const getLetterhead = () => (letterheadUri ||= `data:image/png;base64,${fs.readFileSync(LETTERHEAD).toString('base64')}`);

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[c]);
const nameOf = (p, ar = true) => {
  if (!p) return '';
  if (ar && p.arabicName) return p.arabicName;
  return `${p.firstName || ''} ${p.lastName || ''}`.trim();
};
const dmy = (v) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(typeof v === 'string' ? v : (v ? new Date(v).toISOString() : ''));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
};
const hijriDmy = (v) => {
  const h = toHijri(v);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(h);
  return m ? `${m[3]}/${m[2]}/${m[1]} هـ` : '';
};
const bothDates = (v) => [dmy(v), hijriDmy(v)].filter(Boolean).join('  ·  ');

// Whole days from today (Riyadh) to a YYYY-MM-DD date; negative once it has passed.
function daysUntil(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(ymd || ''));
  if (!m) return null;
  const today = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Riyadh' }));
  const t0 = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((Date.UTC(+m[1], +m[2] - 1, +m[3]) - t0) / 86400000);
}

const STATUS_AR = {
  pending_manager: 'عند المدير المباشر', pending_finance: 'عند المدير المالي', pending_hr: 'عند الموارد البشرية',
  pending_executive: 'عند الإدارة العليا', pending_chairman: 'عند رئيس مجلس الإدارة', info_requested: 'مطلوب إيضاح من الموظف',
  approved: 'معتمدة', rejected: 'مرفوضة', cancelled: 'ملغاة',
};
const IN_REVIEW_AR = 'قيد المراجعة';
const statusFor = (leave, fullView) => (fullView || !chain.PENDING_STATUSES.includes(leave.status) ? STATUS_AR[leave.status] || leave.status : IN_REVIEW_AR);

/** The finance and HR box holders by stage, with their default signature. */
async function boxSigners() {
  const User = require('../models/User');
  const rows = await User.find({ leaveSheetSigner: { $in: ['finance', 'hr'] }, isActive: { $ne: false } }).select('firstName lastName leaveSheetSigner +signatures').lean();
  const out = {};
  for (const u of rows) {
    const sigs = u.signatures || [];
    out[u.leaveSheetSigner] = { _id: u._id, firstName: u.firstName, lastName: u.lastName, ink: ((sigs.find((x) => x.isDefault) || sigs[0]) || {}).dataUrl || '' };
  }
  return out;
}

/** The default (else first) saved signature of each user id, in one query. */
async function liveSignatures(ids) {
  const User = require('../models/User');
  const uniq = [...new Set(ids.filter(Boolean).map(String))];
  if (!uniq.length) return new Map();
  const users = await User.find({ _id: { $in: uniq } }).select('+signatures').lean();
  return new Map(users.map((u) => {
    const sigs = u.signatures || [];
    return [String(u._id), ((sigs.find((s) => s.isDefault) || sigs[0]) || {}).dataUrl || ''];
  }));
}

const idOf = (x) => (x && typeof x === 'object' ? String(x._id || '') : String(x || ''));

/**
 * The six signature boxes, in the owner's layout: employee, direct manager, finance on the first row; HR, top management (general manager), chairman on the second.
 * A box is filled by the stage's approval only; a rejection or a question leaves it unsigned.
 * `fullView` false (the employee and staff outside the process) leaves the stage boxes of an open request empty, so the sheet does not tell where it stands.
 */
async function signatureBoxes(leave, { fullView = true } = {}) {
  const filer = leave.filedByManager ? leave.filedBy : null;
  const employeeSigner = filer || leave.requester;
  const hidden = !fullView && leave.status !== 'approved';
  const decided = (f) => (!hidden && leave[f] && leave[f].at && leave[f].decision === 'approved' ? leave[f] : null);
  const [live, heads] = await Promise.all([
    liveSignatures([idOf(employeeSigner), ...Object.values(chain.DECISION_FIELD).map((f) => idOf(decided(f)?.by))]),
    boxSigners(),
  ]);

  const emp = leave.employee || {};
  const boxes = [{
    label: 'الموظف', en: 'Employee',
    ink: leave.employeeSignature || live.get(idOf(employeeSigner)) || '',
    name: nameOf(emp) || nameOf(leave.requester),
    // The manager who filed it signs in the employee's place, and says so.
    note: filer ? `وقّع عنه مديره ${nameOf(filer, false)}` : '',
    date: dmy(leave.createdAt),
  }];
  const STAGE_BOX = [
    ['manager', 'المدير المباشر', 'Direct Manager'],
    ['finance', 'المدير المالي', 'Finance Manager'],
    ['hr', 'مدير الموارد البشرية', 'HR Manager'],
    ['executive', 'المدير العام', 'General Manager'],
    ['chairman', 'رئيس مجلس الإدارة', 'Chairman of the Board'],
  ];
  for (const [stage, label, en] of STAGE_BOX) {
    const d = decided(chain.DECISION_FIELD[stage]);
    // The department head signs the box when set and signed up; without a saved signature the approver's own stands, so an approved box is never blank.
    const head = d && heads[stage] && heads[stage].ink ? heads[stage] : null;
    boxes.push({
      label, en,
      ink: head ? head.ink : d ? (d.signature || live.get(idOf(d.by)) || '') : '',
      name: head ? nameOf(head, false) : d ? nameOf(d.by, false) : '',
      note: '',
      date: d ? dmy(d.at) : '',
    });
  }
  return boxes;
}

async function registerName(value) {
  const v = String(value || '').trim();
  if (!v) return '';
  try {
    const Lookup = require('../models/Lookup');
    const it = await Lookup.findOne({ type: 'hr_register', $or: [{ key: v }, { nameAr: v }, { nameEn: v }] }).select('key nameAr').lean();
    if (it && it.nameAr && it.nameAr !== v) return `${it.nameAr} — ${v}`;
  } catch (e) { /* the raw value is still printed */ }
  return v;
}

function field(label, value, { wide = false, tone = '' } = {}) {
  const shown = String(value ?? '').trim();
  return `<div class="f${wide ? ' wide' : ''}"><div class="k">${esc(label)}</div><div class="v ${tone}">${shown ? esc(shown) : '—'}</div></div>`;
}

function sigBox(b) {
  const ink = b.ink ? `<img src="${esc(b.ink)}" alt="" />` : '';
  return `<div class="sig">
    <div class="ink">${ink}</div>
    <div class="line"></div>
    <div class="role">${esc(b.label)} <span>${esc(b.en)}</span></div>
    <div class="who">${esc(b.name || '')}</div>
    ${b.note ? `<div class="note">${esc(b.note)}</div>` : ''}
    <div class="when">${esc(b.date || '')}</div>
  </div>`;
}

async function buildLeaveSheetHTML(leave, { fullView = true } = {}) {
  const emp = leave.employee || {};
  const saudi = emp.idType === 'national_id';
  const idNumber = (saudi ? (emp.nationalId || emp.iqamaNumber) : (emp.iqamaNumber || emp.nationalId)) || '';
  const left = emp.iqamaExpiry ? daysUntil(emp.iqamaExpiry) : null;
  let expiry = '';
  let tone = '';
  if (emp.iqamaExpiry) {
    const when = [dmy(emp.iqamaExpiry), emp.iqamaExpiryHijri ? `${emp.iqamaExpiryHijri.split('-').reverse().join('/')} هـ` : hijriDmy(emp.iqamaExpiry)].filter(Boolean).join('  ·  ');
    if (left === null) expiry = when;
    else if (left < 0) { expiry = `${when}  —  منتهية منذ ${-left} يوم`; tone = 'bad'; }
    else { expiry = `${when}  —  متبقي ${left} يوم`; tone = left <= 60 ? 'warn' : ''; }
  }
  const type = leave.leaveType ? (leave.leaveType.nameAr || leave.leaveType.nameEn) : '';
  const boxes = await signatureBoxes(leave, { fullView });
  const reg = await registerName(emp.registerNumber);

  return `<!DOCTYPE html>
<html lang="ar" dir="rtl"><head><meta charset="UTF-8" />
<style>
${getFontCss()}
  @page { size: 210mm 297mm; margin: 0; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { width: 210mm; height: 297mm; font-family: 'Tajawal', 'Noto Naskh Arabic', sans-serif; color: #0f172a; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .page { position: relative; width: 210mm; height: 297mm; overflow: hidden; }
  .bg { position: absolute; inset: 0; width: 100%; height: 100%; }
  .body { position: absolute; top: 44mm; bottom: 44mm; left: 15mm; right: 15mm; display: flex; flex-direction: column; }
  h1 { text-align: center; font-size: 21px; font-weight: 800; color: #12325C; }
  .sub { text-align: center; font-size: 11px; font-weight: 700; color: #f37121; margin: 2px 0 5mm; letter-spacing: .3px; }
  .sec { margin-bottom: 4mm; }
  .sec-h { display: flex; justify-content: space-between; align-items: baseline; border-bottom: 2px solid #f37121; padding-bottom: 1.2mm; margin-bottom: 2.5mm; }
  .sec-h b { font-size: 13px; font-weight: 800; color: #12325C; }
  .sec-h span { font-size: 9.5px; font-weight: 700; color: #94a3b8; direction: ltr; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 2mm 3mm; }
  .f { border: 1px solid #e2e8f0; border-radius: 2mm; padding: 1.6mm 3mm; background: #f8fafc; }
  .f.wide { grid-column: 1 / -1; }
  .f .k { font-size: 9.5px; font-weight: 700; color: #64748b; }
  .f .v { font-size: 12.5px; font-weight: 700; color: #0f172a; margin-top: .6mm; unicode-bidi: plaintext; text-align: right; }
  .f .v.warn { color: #b45309; }
  .f .v.bad { color: #b91c1c; }
  .sigs { margin-top: auto; display: grid; grid-template-columns: repeat(3, 1fr); gap: 3mm 5mm; }
  .sig { text-align: center; }
  .sig .ink { height: 15mm; display: flex; align-items: flex-end; justify-content: center; }
  .sig .ink img { max-height: 14mm; max-width: 40mm; object-fit: contain; }
  .sig .line { border-top: 1px solid #1f2937; margin: 1mm 3mm 0; }
  .sig .role { font-size: 11px; font-weight: 800; color: #12325C; margin-top: 1mm; }
  .sig .role span { font-size: 8.5px; font-weight: 700; color: #94a3b8; }
  .sig .who { font-size: 10px; color: #334155; min-height: 12px; }
  .sig .note { font-size: 8.5px; color: #b45309; }
  .sig .when { font-size: 9px; color: #64748b; min-height: 11px; direction: ltr; }
</style></head>
<body><div class="page">
  <img class="bg" src="${getLetterhead()}" alt="" />
  <div class="body">
    <h1>طلب إجازة</h1>
    <div class="sub">LEAVE REQUEST</div>

    <div class="sec">
      <div class="sec-h"><b>بيانات الموظف</b><span>Employee</span></div>
      <div class="grid">
        ${field('اسم الموظف', nameOf(emp) || nameOf(leave.requester), { wide: true })}
        ${field('الرقم الوظيفي', emp.employeeNumber)}
        ${field(saudi ? 'رقم الهوية' : 'رقم الإقامة', idNumber)}
        ${field('المسمى الوظيفي', emp.jobTitle)}
        ${field('القسم', emp.department)}
        ${field('السجل التجاري', reg)}
        ${field(saudi ? 'تاريخ انتهاء الهوية' : 'تاريخ انتهاء الإقامة', expiry, { tone })}
      </div>
    </div>

    <div class="sec">
      <div class="sec-h"><b>بيانات الإجازة</b><span>Leave</span></div>
      <div class="grid">
        ${field('نوع الإجازة', type)}
        ${field('عدد الأيام', leave.days != null ? `${leave.days} يوم` : '')}
        ${(leave.excludedFridays || []).length ? field('أيام جمعة لا تُحسب إجازة', leave.excludedFridays.map(dmy).join('  ·  '), { wide: true }) : ''}
        ${field('من', bothDates(leave.startDate))}
        ${field('إلى', bothDates(leave.endDate))}
        ${field('تاريخ الطلب', bothDates(leave.createdAt))}
        ${field('الحالة', statusFor(leave, fullView))}
        ${leave.reason ? field('السبب', leave.reason, { wide: true }) : ''}
      </div>
    </div>

    <div class="sigs">${boxes.map(sigBox).join('')}</div>
  </div>
</div></body></html>`;
}

/** The sheet as a vector PDF; `leave` must be populated (employee with identity, expiry and register; decision `by`). */
async function renderLeaveSheet(leave, opts = {}) {
  const html = await buildLeaveSheetHTML(leave, opts);
  const pdf = await withPage(async (page) => {
    await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 30000 });
    try { await page.evaluateHandle('document.fonts.ready'); } catch (e) { /* fallback font */ }
    return page.pdf({ printBackground: true, preferCSSPageSize: true, margin: { top: 0, right: 0, bottom: 0, left: 0 } });
  });
  return Buffer.from(pdf);
}

module.exports = { renderLeaveSheet, buildLeaveSheetHTML, signatureBoxes };
