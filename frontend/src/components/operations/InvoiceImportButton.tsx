'use client';
/**
 * Invoice data upload: the sales sheet (Excel) is written onto its manifests in the operations workflow.
 * The shipping order is the manifest number, with voucher, invoice number, net, tax, total and date. Upload shows a preview (what will be written, what has no manifest, what will not be written and why), then applies in one click. A tax invoice reaches collections at once. See POST /api/workflows/import-invoices.
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
  /** Upload warnings: the three checks on this sheet's lines (see invoiceChecksService). */
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
        <div className="space-y-4 text-sm" dir={ar ? 'rtl' : 'ltr'}>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3">
            <div>
              <p className="font-bold text-slate-900">{t('ارفع ملفّ إكسل الفواتير', 'Upload the invoices Excel file')}</p>
              <p className="text-[12.5px] text-slate-500">{t('تظهر لك معاينةٌ أوّلًا، ولا يُكتب شيءٌ قبل أن تضغط «تطبيق».', 'You see a preview first; nothing is written until you press Apply.')}</p>
            </div>
            <input ref={input} type="file" accept=".xlsx,.xls" hidden onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ''; }} />
            <button type="button" onClick={() => input.current?.click()} disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#f37121] px-4 py-2 text-[13px] font-bold text-white disabled:opacity-50">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileUp className="h-4 w-4" />}
              {file ? t('اختيار ملفّ آخر', 'Choose another file') : t('اختر الملفّ', 'Choose the file')}
            </button>
            {file && <p className="w-full text-[12px] text-slate-500">{t('الملفّ الحالي:', 'Current file:')} <b className="text-slate-700">{file.name}</b></p>}
          </div>

          <details className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-[12.5px] text-slate-700">
            <summary className="cursor-pointer font-bold">{t('الأعمدة التي يقرؤها النظام من الملفّ', 'Columns read from the file')}</summary>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {[['امر الشحن', 'رقم الكشف'], ['السند', ''], ['رقم الفاتورة', ''], ['اجمالي السعر', 'صافي الفاتورة'], ['ضريبة البند', ''], ['المجموع الصافي', 'إجمالي الفاتورة'], ['التاريخ', ''], ['العميل', 'للمقارنة فقط']].map(([c, n]) => (
                <span key={c} className="rounded-full border border-slate-300 bg-white px-2.5 py-1"><b>{c}</b>{n ? <span className="text-slate-500"> — {n}</span> : null}</span>
              ))}
            </div>
            <p className="mt-2 text-slate-500">{t('أيّ عمودٍ آخر يحمل اسمَ عمودٍ في سير العمل (مثل «تاريخ السداد») يُكتب أيضًا. الخانة الفارغة لا تمسح شيئًا.', 'Any other column named like a workflow column is written too. Empty cells erase nothing.')}</p>
          </details>

          {res && (() => {
            const c = res.checks;
            const fmt = (v: any) => (v === null || v === undefined ? '—' : Number(v).toLocaleString('en-US', { maximumFractionDigits: 2 }));
            const th = 'px-3 py-2 text-start font-semibold whitespace-nowrap';
            const td = 'px-3 py-2 whitespace-nowrap';
            const Block = ({ tone, icon, title, hint, children }: any) => (
              <section className={`overflow-hidden rounded-xl border ${tone}`}>
                <header className="px-3 py-2">
                  <p className="flex items-center gap-1.5 font-bold">{icon}{title}</p>
                  {hint && <p className="text-[12px] opacity-80">{hint}</p>}
                </header>
                <div className="max-h-56 overflow-auto bg-white">{children}</div>
              </section>
            );
            return (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {[
                    [t('أسطر في الملفّ', 'Rows in file'), res.fileRows, 'text-slate-900'],
                    [res.preview ? t('كشوف ستُحدَّث', 'Will update') : t('كشوف حُدِّثت', 'Updated'), res.preview ? res.toUpdate : res.updated, 'text-emerald-700'],
                    [t('بلا تغيير', 'Unchanged'), res.unchanged, 'text-slate-500'],
                    [t('رقم كشف غير موجود', 'No such report'), res.notFound.length, 'text-amber-700'],
                  ].map(([l, v, cl]) => (
                    <div key={String(l)} className="rounded-xl border border-slate-200 bg-white px-3 py-2">
                      <p className={`text-xl font-extrabold tabular-nums ${cl}`}>{v as any}</p>
                      <p className="text-[11.5px] text-slate-500">{l as any}</p>
                    </div>
                  ))}
                </div>

                {res.preview && !!res.sample.length && (
                  <Block tone="border-slate-200 bg-slate-900 text-white" icon={<CheckCircle2 className="h-4 w-4 text-emerald-400" />}
                    title={t('ما سيتغيّر في سير العمل', 'What will change in the workflow')}>
                    <table className="w-full text-[12.5px] text-slate-800">
                      <thead className="bg-slate-100 text-slate-600"><tr><th className={th}>{t('رقم الكشف', 'Report')}</th><th className={th}>{t('الخانة', 'Field')}</th><th className={th}>{t('القيمة الحالية', 'Current')}</th><th className={th}>{t('القيمة الجديدة من الملفّ', 'New from file')}</th></tr></thead>
                      <tbody className="divide-y divide-slate-100">
                        {res.sample.flatMap((x) => Object.keys(x.after).map((k, i) => (
                          <tr key={`${x.reportNumber}-${k}`}>
                            <td className={`${td} font-bold tabular-nums`}>{i === 0 ? x.reportNumber : ''}</td>
                            <td className={td}>{LABEL[k] || k}</td>
                            <td className={`${td} text-slate-400 line-through`}>{show(x.before[k])}</td>
                            <td className={`${td} font-bold text-emerald-700`}>{show(x.after[k])}</td>
                          </tr>
                        )))}
                      </tbody>
                    </table>
                    {res.toUpdate > res.sample.length && <p className="px-3 py-1.5 text-[11px] text-slate-400">{t(`أوّل ${res.sample.length} من ${res.toUpdate} كشفًا`, `first ${res.sample.length} of ${res.toUpdate}`)}</p>}
                  </Block>
                )}

                {c && !!c.valueDiffs.length && (
                  <Block tone="border-rose-200 bg-rose-50 text-rose-900" icon={<AlertTriangle className="h-4 w-4" />}
                    title={t(`فرق في قيمة الفاتورة (${c.valueDiffs.length})`, `Invoice value differences (${c.valueDiffs.length})`)}
                    hint={t('قيمة الفاتورة في الملفّ لا تساوي مجموع الكشوف المرتبطة بها في سير العمل.', 'The invoice value in the file differs from the sum of its reports in the workflow.')}>
                    <table className="w-full text-[12.5px] text-slate-800">
                      <thead className="bg-rose-100/60 text-rose-900"><tr><th className={th}>{t('رقم الفاتورة', 'Invoice')}</th><th className={th}>{t('العميل', 'Customer')}</th><th className={th}>{t('في الملفّ', 'In file')}</th><th className={th}>{t('في سير العمل', 'In workflow')}</th><th className={th}>{t('الفرق', 'Difference')}</th></tr></thead>
                      <tbody className="divide-y divide-slate-100">
                        {c.valueDiffs.slice(0, 200).map((v, i) => (
                          <tr key={i}><td className={`${td} font-bold`}>{v.invoiceNumber}</td><td className={td}>{v.customerName || '—'}</td><td className={`${td} tabular-nums`}>{fmt(v.uploadedValue)}</td><td className={`${td} tabular-nums`}>{fmt(v.reportsValue)}</td><td className={`${td} font-bold tabular-nums text-rose-700`}>{fmt(v.difference)}</td></tr>
                        ))}
                      </tbody>
                    </table>
                  </Block>
                )}

                {c && !!c.nameMismatches.length && (
                  <Block tone="border-sky-200 bg-sky-50 text-sky-900" icon={<AlertTriangle className="h-4 w-4" />}
                    title={t(`اسم العميل مختلف (${c.nameMismatches.length})`, `Customer name differs (${c.nameMismatches.length})`)}
                    hint={t('للتنبيه فقط: يبقى اسمُ العميل في سير العمل كما هو ولا يتغيّر بالرفع، وتُكتب بيانات الفاتورة فقط.', 'Warning only: the workflow customer stays as it is; only the invoice data is written.')}>
                    <table className="w-full text-[12.5px] text-slate-800">
                      <thead className="bg-sky-100/60 text-sky-900"><tr><th className={th}>{t('رقم الكشف', 'Report')}</th><th className={th}>{t('رقم الفاتورة', 'Invoice')}</th><th className={th}>{t('العميل في الملفّ', 'Customer in file')}</th><th className={th}>{t('العميل في سير العمل (يبقى)', 'Customer in workflow (kept)')}</th></tr></thead>
                      <tbody className="divide-y divide-slate-100">
                        {c.nameMismatches.slice(0, 200).map((m, i) => (
                          <tr key={i}><td className={`${td} font-bold tabular-nums`}>{m.reportNumber}</td><td className={td}>{m.invoiceNumber}</td><td className={td}>{m.uploadedCustomer}</td><td className={`${td} font-bold`}>{m.workflowCustomer}</td></tr>
                        ))}
                      </tbody>
                    </table>
                  </Block>
                )}

                {c && !!c.missingReports.length && (
                  <Block tone="border-amber-200 bg-amber-50 text-amber-900" icon={<AlertTriangle className="h-4 w-4" />}
                    title={t(`فواتير برقم كشف غير موجود (${c.missingReports.length})`, `Invoices citing missing reports (${c.missingReports.length})`)}
                    hint={t('رقم الكشف المكتوب في الملفّ غير موجود في سير العمل، فلن يُكتب شيءٌ لهذه الأسطر.', 'The report number in the file is not in the workflow; nothing is written for these rows.')}>
                    <table className="w-full text-[12.5px] text-slate-800">
                      <thead className="bg-amber-100/60 text-amber-900"><tr><th className={th}>{t('رقم الفاتورة', 'Invoice')}</th><th className={th}>{t('رقم الكشف في الملفّ', 'Report no. in file')}</th><th className={th}>{t('العميل', 'Customer')}</th><th className={th}>{t('القيمة', 'Value')}</th></tr></thead>
                      <tbody className="divide-y divide-slate-100">
                        {c.missingReports.slice(0, 200).map((m, i) => (
                          <tr key={i}><td className={`${td} font-bold`}>{m.invoiceNumber}</td><td className={`${td} tabular-nums`}>{m.reportNumber}</td><td className={td}>{m.customerName || '—'}</td><td className={`${td} tabular-nums`}>{fmt(m.total)}</td></tr>
                        ))}
                      </tbody>
                    </table>
                  </Block>
                )}

                {!!res.skipped.length && (
                  <Block tone="border-amber-200 bg-amber-50 text-amber-900" icon={<AlertTriangle className="h-4 w-4" />} title={t(`لن تُكتب (${res.skipped.length})`, `Not written (${res.skipped.length})`)}>
                    <table className="w-full text-[12.5px] text-slate-800"><tbody className="divide-y divide-slate-100">
                      {res.skipped.map((x) => <tr key={x.reportNumber}><td className={`${td} font-bold tabular-nums`}>{x.reportNumber}</td><td className="px-3 py-2">{x.reason}</td></tr>)}
                    </tbody></table>
                  </Block>
                )}

                {c && !c.valueDiffs.length && !c.nameMismatches.length && !c.missingReports.length && (
                  <p className="flex items-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-[12.5px] font-semibold text-emerald-800"><CheckCircle2 className="h-4 w-4" />{t('لا فروق: كلّ أرقام الكشوف موجودة، والقيم وأسماء العملاء مطابقة.', 'No differences: all reports exist, values and customers match.')}</p>
                )}

                {res.preview ? (
                  <div className="flex items-center justify-end gap-2 border-t border-slate-200 pt-3">
                    <button type="button" onClick={() => setOpen(false)} className="rounded-lg px-4 py-2 font-semibold text-slate-600 hover:bg-slate-100">{t('إلغاء', 'Cancel')}</button>
                    <button type="button" onClick={() => send(true)} disabled={busy || !res.toUpdate}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-5 py-2 text-[13px] font-bold text-white disabled:opacity-40">
                      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}{t(`تطبيق على ${res.toUpdate} كشفًا`, `Apply to ${res.toUpdate} reports`)}
                    </button>
                  </div>
                ) : (
                  <p className="flex items-center gap-1.5 font-semibold text-emerald-700"><CheckCircle2 className="h-4 w-4" />{t('تمّ التطبيق — والفواتير الضريبيّة وصلت التحصيل.', 'Applied — tax invoices are in Collections.')}</p>
                )}
              </div>
            );
          })()}
        </div>
      </Modal>
    </>
  );
}
