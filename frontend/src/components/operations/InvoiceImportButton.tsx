'use client';
/**
 * رفعُ بيانات الفواتير — ورقةُ المبيعات (إكسل) تُكتب على كشوفها في سير عمل التشغيل.
 *
 * «امر الشحن» هو رقمُ الكشف، ومعه السند ورقمُ الفاتورة وصافيها وضريبتُها وإجماليُّها
 * وتاريخُها. يُرفع الملفُّ فتُعرض المعاينة (ما سيُكتب، وما لا كشفَ له، وما لن يُكتب
 * ولماذا) ثمّ يُطبَّق بضغطة. والفاتورةُ الضريبيّة تصل التحصيلَ في الحال.
 * راجع POST /api/workflows/import-invoices.
 */
import { useRef, useState } from 'react';
import api from '@/lib/api';
import { useDialog } from '@/components/system/DialogProvider';
import { Modal } from '@/components/hr/HRKit';
import { FileUp, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react';

type Result = {
  preview: boolean; updated?: number; fileRows: number; reports: number; toUpdate: number; unchanged: number;
  notFound: string[]; skipped: { reportNumber: string; reason: string }[]; badRows: { reportNumber: string; reason: string }[];
  sample: { reportNumber: string; before: Record<string, any>; after: Record<string, any> }[];
  /** تنبيهاتُ الرفع — الفحوصُ الثلاثةُ على أسطر هذه الورقة (راجع invoiceChecksService). */
  checks?: {
    missingReports: { invoiceNumber: string; reportNumber: string; customerName: string; total: number | null }[];
    valueDiffs: { invoiceNumber: string; customerName: string; uploadedValue: number; reportsValue: number; difference: number }[];
    nameMismatches: { invoiceNumber: string; reportNumber: string; uploadedCustomer: string; workflowCustomer: string }[];
  };
};
const LABEL: Record<string, string> = {
  documentNumber: 'رقم السند', invoiceNumber: 'رقم الفاتورة', netInvoice: 'صافي الفاتورة', tax: 'الضريبة',
  totalInvoice: 'إجمالي الفاتورة', invoiceDate: 'تاريخ الفاتورة',
};
const show = (v: any) => {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v)) return v.slice(0, 10).split('-').reverse().join('/');
  return typeof v === 'number' ? v.toLocaleString('en-US') : String(v);
};

export default function InvoiceImportButton({ ar, onDone }: { ar: boolean; onDone: () => void }) {
  const t = (a: string, e: string) => (ar ? a : e);
  const { notify } = useDialog();
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [file, setFile] = useState<{ name: string; dataUrl: string } | null>(null);
  const [res, setRes] = useState<Result | null>(null);

  const send = async (apply: boolean, f = file) => {
    if (!f) return;
    setBusy(true);
    try {
      const r = await api.post<Result>('/api/workflows/import-invoices', { dataUrl: f.dataUrl, apply, fileName: f.name });
      setRes(r);
      if (apply) { notify(t(`كُتبت بياناتُ ${r.updated} كشفًا`, `${r.updated} reports updated`), 'success'); onDone(); }
    } catch (e: any) { notify(e?.message || t('تعذّر الرفع', 'Upload failed'), 'error'); }
    setBusy(false);
  };

  const pick = (fl: File | undefined) => {
    if (!fl) return;
    if (fl.size > 15 * 1024 * 1024) { notify(t('الملفّ أكبر من 15 ميجا', 'File larger than 15 MB'), 'error'); return; }
    const rd = new FileReader();
    rd.onload = () => { const f = { name: fl.name, dataUrl: String(rd.result) }; setFile(f); setRes(null); send(false, f); };
    rd.readAsDataURL(fl);
  };

  return (
    <>
      <button type="button" onClick={() => { setOpen(true); setFile(null); setRes(null); }}
        className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white border border-slate-200 text-slate-700 hover:border-[#f37121]/60 text-sm font-medium">
        <FileUp className="w-4 h-4 text-[#f37121]" /> {t('رفع بيانات فواتير', 'Upload invoice data')}
      </button>
      <Modal open={open} onClose={() => setOpen(false)} wide title={t('رفع بيانات فواتير من إكسل', 'Upload invoice data (Excel)')}>
        <div className="space-y-3 text-sm" dir={ar ? 'rtl' : 'ltr'}>
          <p className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-[12.5px] leading-6 text-blue-900">
            {t('الأعمدة: «امر الشحن» (رقم الكشف) · «السند» · «رقم الفاتورة» · «اجمالي السعر» (صافي الفاتورة) · «ضريبة البند» · «المجموع الصافي» (إجمالي الفاتورة) · «التاريخ» · «العميل». العميلُ لا يُكتب على الكشف — يُقارَن بعميله. الأحدثُ يكتب فوق القديم، والضريبةُ تُحسب من الصافي، والفاتورةُ الضريبيّة تصل التحصيل فورًا. وتُحفظ أسطرُ الورقة لبطاقات الفحص في سير العمل. وأيُّ عمودٍ آخر باسم عمودٍ في الجدول — «تاريخ التسليم للعميل»، «تاريخ السداد»، «نوع الدفع»، «الفرع المسدد»، «تاريخ الارسال»… — يُكتب كذلك على كشفه، والخانةُ الفارغةُ لا تمحو شيئًا.',
              'Columns: shipment order (report no.), voucher, invoice no., net, VAT, total, date, customer. The customer is not written — it is compared with the report’s. Newer data overwrites; VAT is computed from the net; tax invoices reach Collections at once. Sheet lines are kept for the workflow check cards. Any other column named like a table column (customer delivery date, payment date, payment type, paying branch…) is written on its report too; blank cells erase nothing.')}
          </p>
          <input ref={input} type="file" accept=".xlsx,.xls" hidden onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ''; }} />
          <button type="button" onClick={() => input.current?.click()} disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#f37121] px-3 py-2 text-[13px] font-bold text-white disabled:opacity-50">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileUp className="h-4 w-4" />}
            {file ? t(`ملفّ آخر (الحالي: ${file.name})`, `Another file (current: ${file.name})`) : t('اختر ملفّ الإكسل', 'Choose the Excel file')}
          </button>

          {res && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {[
                  [t('صفوف في الملفّ', 'Rows in file'), res.fileRows, 'text-slate-900'],
                  [res.preview ? t('ستُكتب', 'Will update') : t('كُتبت', 'Updated'), res.preview ? res.toUpdate : res.updated, 'text-emerald-700'],
                  [t('بلا تغيير', 'Unchanged'), res.unchanged, 'text-slate-500'],
                  [t('لا كشفَ بالرقم', 'No such report'), res.notFound.length, 'text-amber-700'],
                ].map(([l, v, c]) => (
                  <div key={String(l)} className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                    <p className={`text-xl font-extrabold tabular-nums ${c}`}>{v as any}</p>
                    <p className="text-[11.5px] text-slate-500">{l as any}</p>
                  </div>
                ))}
              </div>
              {!!res.skipped.length && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-[12px] text-amber-900">
                  <p className="mb-1 flex items-center gap-1 font-bold"><AlertTriangle className="h-3.5 w-3.5" />{t(`لن يُكتب ${res.skipped.length}`, `${res.skipped.length} not written`)}</p>
                  <div className="max-h-32 overflow-auto">{res.skipped.map((s) => <p key={s.reportNumber}>{s.reportNumber} — {s.reason}</p>)}</div>
                </div>
              )}
              {!!res.notFound.length && (
                <p className="rounded-lg border border-slate-200 bg-slate-50 p-2.5 text-[12px] text-slate-600">
                  {t('أرقامُ كشوفٍ غير موجودة في سير العمل: ', 'Not found: ')}{res.notFound.slice(0, 60).join('، ')}{res.notFound.length > 60 ? ' …' : ''}
                </p>
              )}
              {/* ── تنبيهاتُ الرفع ─────────────────────────────────────────────
                  كشفٌ غيرُ موجود، وفاتورةٌ قيمتُها غيرُ مجموع كشوفها، وعميلٌ غيرُ
                  عميل الكشف. وتبقى بعد التطبيق بطاقاتٍ في سير العمل — تسقط منها
                  حين يُصحَّح الكشف. */}
              {res.checks && (() => {
                const c = res.checks;
                const fmt = (v: any) => (v === null || v === undefined ? '—' : Number(v).toLocaleString('en-US', { maximumFractionDigits: 2 }));
                const blocks: { n: number; title: string; tone: string; lines: string[] }[] = [
                  {
                    n: c.missingReports.length, tone: 'border-amber-200 bg-amber-50 text-amber-900',
                    title: t('فواتير بكشوفات غير موجودة', 'Invoices citing missing reports'),
                    lines: c.missingReports.map((m) => `${t('فاتورة', 'Invoice')} ${m.invoiceNumber} — ${t('كشف', 'report')} ${m.reportNumber}${m.customerName ? ` · ${m.customerName}` : ''}`),
                  },
                  {
                    n: c.valueDiffs.length, tone: 'border-rose-200 bg-rose-50 text-rose-900',
                    title: t('فرق قيمة الفاتورة', 'Invoice value differences'),
                    lines: c.valueDiffs.map((v) => `${t('فاتورة', 'Invoice')} ${v.invoiceNumber}: ${t('الورقة', 'sheet')} ${fmt(v.uploadedValue)} · ${t('الكشوف', 'reports')} ${fmt(v.reportsValue)} · ${t('الفرق', 'diff')} ${fmt(v.difference)}`),
                  },
                  {
                    n: c.nameMismatches.length, tone: 'border-sky-200 bg-sky-50 text-sky-900',
                    title: t('عدم تطابق اسم العميل', 'Customer name mismatch'),
                    lines: c.nameMismatches.map((m) => `${t('كشف', 'Report')} ${m.reportNumber} (${m.invoiceNumber}): ${t('الورقة', 'sheet')} «${m.uploadedCustomer}» ≠ ${t('الكشف', 'report')} «${m.workflowCustomer}»`),
                  },
                ];
                if (!blocks.some((b) => b.n)) {
                  return <p className="flex items-center gap-1.5 text-[12px] font-semibold text-emerald-700"><CheckCircle2 className="h-3.5 w-3.5" />{t('لا تنبيهات: كلُّ الكشوف موجودة، والقيمُ والعملاءُ مطابقة.', 'No alerts: all reports exist, values and customers match.')}</p>;
                }
                return blocks.filter((b) => b.n).map((b) => (
                  <div key={b.title} className={`rounded-lg border p-2.5 text-[12px] ${b.tone}`}>
                    <p className="mb-1 flex items-center gap-1 font-bold"><AlertTriangle className="h-3.5 w-3.5" />{b.title} ({b.n})</p>
                    <div className="max-h-32 overflow-auto">{b.lines.slice(0, 200).map((l, i) => <p key={i}>{l}</p>)}</div>
                  </div>
                ));
              })()}
              {res.preview && !!res.sample.length && (
                <div className="max-h-64 overflow-auto rounded-lg border border-slate-200">
                  <table className="w-full text-[12px]">
                    <thead className="sticky top-0 bg-slate-900 text-slate-200"><tr><th className="px-2 py-1.5 text-start">{t('الكشف', 'Report')}</th><th className="px-2 py-1.5 text-start">{t('التغيير', 'Change')}</th></tr></thead>
                    <tbody className="divide-y divide-slate-100">
                      {res.sample.map((s) => (
                        <tr key={s.reportNumber}>
                          <td className="px-2 py-1.5 font-semibold tabular-nums">{s.reportNumber}</td>
                          <td className="px-2 py-1.5 text-slate-600">
                            {Object.keys(s.after).map((k) => <span key={k} className="me-3 inline-block">{LABEL[k] || k}: <span className="text-slate-400 line-through">{show(s.before[k])}</span> ← <b className="text-slate-900">{show(s.after[k])}</b></span>)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {res.toUpdate > res.sample.length && <p className="px-2 py-1 text-[11px] text-slate-400">{t(`أوّل ${res.sample.length} من ${res.toUpdate}`, `first ${res.sample.length} of ${res.toUpdate}`)}</p>}
                </div>
              )}
              {res.preview ? (
                <div className="flex justify-end gap-2">
                  <button type="button" onClick={() => setOpen(false)} className="px-3 py-2 text-slate-500">{t('إلغاء', 'Cancel')}</button>
                  <button type="button" onClick={() => send(true)} disabled={busy || !res.toUpdate}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-[13px] font-bold text-white disabled:opacity-40">
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}{t(`تطبيق على ${res.toUpdate} كشفًا`, `Apply to ${res.toUpdate} reports`)}
                  </button>
                </div>
              ) : (
                <p className="flex items-center gap-1.5 font-semibold text-emerald-700"><CheckCircle2 className="h-4 w-4" />{t('تمّ — والفواتيرُ الضريبيّة في التحصيل.', 'Done — tax invoices are in Collections.')}</p>
              )}
            </div>
          )}
        </div>
      </Modal>
    </>
  );
}
