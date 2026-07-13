// Generates the official leave-request sheet as a PDF: the company letterhead
// (payroll.png) as the page background, the leave details, and the three
// signature slots (employee / direct manager / HR). We render an off-screen A4
// HTML node (so Arabic shapes correctly), rasterise it with html2canvas, then
// place that image on an A4 pdf-lib page.
import html2canvas from 'html2canvas';
import { PDFDocument } from 'pdf-lib';

const LETTERHEAD = '/images/payroll.png';

const esc = (s: any) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' } as any)[c]);

function personName(p: any, ar: boolean) {
  if (!p) return '—';
  if (ar && p.arabicName) return p.arabicName;
  return `${p.firstName || ''} ${p.lastName || ''}`.trim() || p.email || '—';
}
const fmtDate = (d: any) => (d ? new Date(d).toLocaleDateString('en-GB') : '—');

// One signature block: the ink image (or a blank line) + role + name + date.
function sigBlock(label: string, dataUrl: string, name: string, date: string) {
  const ink = dataUrl
    ? `<img src="${dataUrl}" style="max-height:56px;max-width:150px;object-fit:contain;" />`
    : `<div style="height:56px"></div>`;
  return `
    <div style="text-align:center;flex:1">
      <div style="height:60px;display:flex;align-items:flex-end;justify-content:center">${ink}</div>
      <div style="border-top:1px solid #1f2937;margin:4px 12px 0"></div>
      <div style="font-size:12px;font-weight:700;color:#111827;margin-top:4px">${esc(label)}</div>
      <div style="font-size:11px;color:#374151">${esc(name || '—')}</div>
      <div style="font-size:10px;color:#6b7280">${esc(date || '')}</div>
    </div>`;
}

export async function downloadLeaveSheet(leave: any, lang: 'ar' | 'en') {
  const ar = lang === 'ar';
  const t = (en: string, a: string) => (ar ? a : en);

  const emp = leave.employee || {};
  const empDisplay = ar ? (emp.arabicName || `${emp.firstName || ''} ${emp.lastName || ''}`.trim()) : `${emp.firstName || ''} ${emp.lastName || ''}`.trim();
  const type = leave.leaveType ? (ar ? (leave.leaveType.nameAr || leave.leaveType.nameEn) : (leave.leaveType.nameEn || leave.leaveType.nameAr)) : '—';

  const rows: [string, string][] = [
    [t('Employee', 'الموظف'), empDisplay || '—'],
    [t('Employee No.', 'الرقم الوظيفي'), emp.employeeNumber || emp.iqamaNumber || '—'],
    [t('Leave Type', 'نوع الإجازة'), type],
    [t('From', 'من'), fmtDate(leave.startDate)],
    [t('To', 'إلى'), fmtDate(leave.endDate)],
    [t('Days', 'عدد الأيام'), String(leave.days ?? '—')],
    [t('Request Date', 'تاريخ الطلب'), fmtDate(leave.createdAt)],
    [t('Status', 'الحالة'), leave.status || '—'],
  ];
  if (leave.reason) rows.push([t('Reason', 'السبب'), leave.reason]);

  const detailRows = rows.map(([k, v], i) => `
    <tr style="background:${i % 2 ? '#f8fafc' : '#fff'}">
      <td style="padding:7px 12px;font-weight:700;color:#374151;width:38%;border:1px solid #e5e7eb">${esc(k)}</td>
      <td style="padding:7px 12px;color:#111827;border:1px solid #e5e7eb">${esc(v)}</td>
    </tr>`).join('');

  const el = document.createElement('div');
  el.setAttribute('dir', ar ? 'rtl' : 'ltr');
  el.style.cssText = `position:fixed;left:-99999px;top:0;width:794px;height:1123px;background:#fff;font-family:'Segoe UI',Tahoma,Arial,sans-serif;`;
  el.innerHTML = `
    <img src="${LETTERHEAD}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:fill" crossorigin="anonymous" />
    <div style="position:absolute;left:0;right:0;top:170px;bottom:175px;padding:0 60px;display:flex;flex-direction:column">
      <h1 style="text-align:center;font-size:22px;font-weight:800;color:#0f172a;margin:0 0 4px">${t('Leave Request', 'طلب إجازة')}</h1>
      <div style="text-align:center;font-size:12px;color:#f37121;font-weight:700;margin-bottom:16px">${t('Energize Logistics', 'إنرجايز لوجيستيك')}</div>
      <table style="width:100%;border-collapse:collapse;font-size:13px">${detailRows}</table>
      <div style="flex:1"></div>
      <div style="display:flex;gap:16px;margin-top:24px">
        ${sigBlock(t('Employee', 'الموظف'), leave.employeeSignature || '', empDisplay, fmtDate(leave.createdAt))}
        ${sigBlock(t('Direct Manager', 'المدير المباشر'), leave.managerDecision?.signature || '', personName(leave.managerDecision?.by, ar), fmtDate(leave.managerDecision?.at))}
        ${sigBlock(t('Human Resources', 'الموارد البشرية'), leave.hrDecision?.signature || '', personName(leave.hrDecision?.by, ar), fmtDate(leave.hrDecision?.at))}
      </div>
    </div>`;
  document.body.appendChild(el);

  try {
    // Wait for the letterhead + signature images to decode before rasterising.
    await Promise.all(Array.from(el.querySelectorAll('img')).map((img) =>
      img.complete && img.naturalWidth ? Promise.resolve() : new Promise<void>((r) => { img.onload = () => r(); img.onerror = () => r(); })
    ));
    const canvas = await html2canvas(el, { scale: 2, useCORS: true, backgroundColor: '#ffffff' });
    const imgData = canvas.toDataURL('image/png');

    const pdf = await PDFDocument.create();
    const page = pdf.addPage([595.28, 841.89]); // A4 in points
    const png = await pdf.embedPng(imgData);
    page.drawImage(png, { x: 0, y: 0, width: 595.28, height: 841.89 });
    const bytes = await pdf.save();

    const blob = new Blob([bytes as BlobPart], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `leave-${(empDisplay || 'request').replace(/\s+/g, '_')}-${leave.startDate || ''}.pdf`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  } finally {
    document.body.removeChild(el);
  }
}
