'use client';
/**
 * بطاقاتُ فحص الفواتير في سير عمل التشغيل — أربعٌ حيّة.
 *
 *  · «فواتير لم تُفوتَر»: أرقامٌ ناقصةٌ في تسلسل الفواتير الضريبيّة — من بدايته
 *    إلى أعلى رقمٍ مكتوبٍ على كشف (والأعلى يتحرّك مع كلّ فاتورةٍ تُكتب).
 *  · «فواتير بكشوفات غير موجودة»: سطرٌ في ورقة المبيعات المرفوعة يذكر كشفًا لا يوجد.
 *  · «فرق قيمة الفاتورة»: ما تقوله الورقةُ غيرُ مجموع كشوف الفاتورة.
 *  · «عدم تطابق اسم العميل»: عميلُ الورقة غيرُ عميل الكشف (بعد طيّ المسافات والهمزات).
 *
 * الأعدادُ من `GET /api/workflows/invoice-checks` — على التسلسل كلِّه وأوراق الرفع
 * كلِّها، لا على فلتر الجدول: رقمٌ ناقصٌ في التسلسل لا يخصّ عميلًا ولا فرعًا.
 * وكلُّ تعديلٍ على الكشوف يُعيدها (البثُّ الحيّ) — والخادمُ يمسح ذاكرتَه قبل أن يبثّ.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import api from '@/lib/api';
import { useSocket } from '@/hooks/useSocket';
import { useLatestRequest } from '@/hooks/useLatestRequest';
import { Modal } from '@/components/hr/HRKit';
import ExportMenu, { type ExportColumn } from '@/components/ls2/ExportMenu';
import { Hash, FileX2, Scale, UserX, Loader2, Search } from 'lucide-react';

type Kind = 'gaps' | 'missing-reports' | 'value-diffs' | 'name-mismatches';
type Summary = {
  gaps: { count: number; reserved: number; cancelled: number; inLedger: number; inUpload: number; unknown: number; start: number | null; end: number | null; startSource: string; outliers: number[]; textual: string[]; capped?: boolean };
  missingReports: { count: number };
  valueDiffs: { count: number; sumAbs: number };
  nameMismatches: { count: number };
  uploadedLines: number;
  lastUpload: { uploadedAt: string; uploadedByName: string; fileName: string } | null;
};

const money = (v: any) => (v === null || v === undefined || v === '' ? '—' : Number(v).toLocaleString('en-US', { maximumFractionDigits: 2 }));
const day = (v: any) => (v ? new Date(v).toLocaleDateString('en-GB') : '—');

export default function InvoiceCheckCards({ ar }: { ar: boolean }) {
  const t = (a: string, e: string) => (ar ? a : e);
  const [sum, setSum] = useState<Summary | null>(null);
  const [open, setOpen] = useState<Kind | null>(null);
  const [rows, setRows] = useState<any[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [q, setQ] = useState('');
  const guard = useLatestRequest();
  const listGuard = useLatestRequest();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    const mine = guard.begin();
    try {
      const d = await api.get<Summary>('/api/workflows/invoice-checks');
      if (guard.isCurrent(mine)) setSum(d);
    } catch { /* البطاقاتُ زيادة — لا تُسقط الصفحة */ }
  }, [guard]);

  const loadList = useCallback(async (k: Kind) => {
    const mine = listGuard.begin();
    setLoadingList(true);
    try {
      const d = await api.get<{ rows: any[] }>(`/api/workflows/invoice-checks/${k}`);
      if (listGuard.isCurrent(mine)) setRows(d.rows || []);
    } catch { if (listGuard.isCurrent(mine)) setRows([]); }
    finally { if (listGuard.isCurrent(mine)) setLoadingList(false); }
  }, [listGuard]);

  useEffect(() => { load(); }, [load]);

  // ── حيّة: كلُّ كتابةٍ على الكشوف تعيدها، مجمَّعةً في ثانيةٍ ونصف ──────────
  // المزامنةُ تبثّ كلَّ بضع ثوانٍ؛ والتجميعُ يجعل عشرين بثًّا في الدقيقة طلبًا أو اثنين.
  const poke = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { load(); if (open) loadList(open); }, 1500);
  }, [load, loadList, open]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  useSocket('workflow:updated', poke);
  useSocket('workflow:created', poke);
  useSocket('workflow:deleted', poke);
  useSocket('workflow:bulkImported', poke);

  const show = (k: Kind) => { setOpen(k); setRows([]); setQ(''); loadList(k); };

  if (!sum) return null;
  const g = sum.gaps;
  // ── الأرقامُ الناقصةُ وحدَها ───────────────────────────────────────────────
  // كانت القائمةُ تكتب بجانب الرقم عميلًا وقيمةً من دفتر التحصيل — فقرأها صاحبُ
  // الشركة بياناتٍ مخترَعة (٢٠٢٦/١٠/٢١). والمطلوبُ هو الأرقامُ التي لا كشفَ عليها
  // في سير عمل التشغيل بين أوّل فاتورةٍ وأحدثِها، يبحث هو عنها.

  const cards: { k: Kind; n: number; title: string; sub: string; icon: any; tone: string }[] = [
    {
      k: 'gaps', n: g.count, icon: Hash, tone: 'violet',
      title: t('فواتير لم تُفوتَر', 'Missing invoice numbers'),
      sub: g.start != null
        ? `${t('أرقامٌ بلا كشف بين', 'numbers with no report between')} ${g.start} ${t('و', 'and')} ${g.end}`
        : t('لا أرقام فواتير بعد', 'No invoice numbers yet'),
    },
    {
      k: 'missing-reports', n: sum.missingReports.count, icon: FileX2, tone: 'amber',
      title: t('فواتير بكشوفات غير موجودة', 'Invoices citing missing reports'),
      sub: t('من أوراق المبيعات المرفوعة', 'from uploaded sales sheets'),
    },
    {
      k: 'value-diffs', n: sum.valueDiffs.count, icon: Scale, tone: 'rose',
      title: t('فرق قيمة الفاتورة', 'Invoice value differences'),
      sub: sum.valueDiffs.count ? `${t('مجموع الفروق', 'total gap')} ${money(sum.valueDiffs.sumAbs)}` : t('الورقة = مجموع الكشوف', 'sheet = reports total'),
    },
    {
      k: 'name-mismatches', n: sum.nameMismatches.count, icon: UserX, tone: 'sky',
      title: t('عدم تطابق اسم العميل', 'Customer name mismatch'),
      sub: t('عميل الورقة ≠ عميل الكشف', 'sheet customer ≠ report customer'),
    },
  ];
  // ── ألوانٌ هادئة: بطاقةٌ بيضاء ورقمٌ بالحبر، والنبرةُ نقطةٌ صغيرة لا خلفيّة ──
  const TONE: Record<string, string> = {
    violet: '#8b5cf6', amber: '#f59e0b', rose: '#e11d48', sky: '#0ea5e9',
  };

  // ── أعمدةُ كلّ قائمة — للجدول وللإكسل معًا ──────────────────────────────
  const COLS: Record<Kind, { key: string; ar: string; en: string; kind?: 'money' | 'date' }[]> = {
    gaps: [
      { key: 'invoiceNumber', ar: 'رقم الفاتورة الناقص', en: 'Missing invoice #' },
    ],
    'missing-reports': [
      { key: 'invoiceNumber', ar: 'رقم الفاتورة', en: 'Invoice #' },
      { key: 'reportNumber', ar: 'رقم الكشف (في الورقة)', en: 'Report # (sheet)' },
      { key: 'customerName', ar: 'العميل (في الورقة)', en: 'Customer (sheet)' },
      { key: 'total', ar: 'القيمة', en: 'Value', kind: 'money' },
      { key: 'uploadedAt', ar: 'تاريخ الرفع', en: 'Uploaded', kind: 'date' },
      { key: 'uploadedByName', ar: 'رفعها', en: 'By' },
    ],
    'value-diffs': [
      { key: 'invoiceNumber', ar: 'رقم الفاتورة', en: 'Invoice #' },
      { key: 'customerName', ar: 'العميل (في الورقة)', en: 'Customer (sheet)' },
      { key: 'uploadedValue', ar: 'القيمة المرفوعة', en: 'Uploaded value', kind: 'money' },
      { key: 'reportsValue', ar: 'قيمة الكشوف', en: 'Reports value', kind: 'money' },
      { key: 'difference', ar: 'الفرق', en: 'Difference', kind: 'money' },
      { key: 'uploadedLines', ar: 'أسطر الورقة', en: 'Sheet lines' },
      { key: 'reportsCount', ar: 'كشوف الفاتورة', en: 'Reports' },
    ],
    'name-mismatches': [
      { key: 'invoiceNumber', ar: 'رقم الفاتورة', en: 'Invoice #' },
      { key: 'reportNumber', ar: 'رقم الكشف', en: 'Report #' },
      { key: 'uploadedCustomer', ar: 'العميل في الورقة', en: 'Customer (sheet)' },
      { key: 'workflowCustomer', ar: 'العميل في الكشف', en: 'Customer (report)' },
      { key: 'uploadedAt', ar: 'تاريخ الرفع', en: 'Uploaded', kind: 'date' },
    ],
  };
  const cur = open ? cards.find((c) => c.k === open)! : null;
  const cols = open ? COLS[open] : [];
  const needle = q.trim().toLowerCase();
  const shown = needle ? rows.filter((r) => cols.some((c) => String(r[c.key] ?? '').toLowerCase().includes(needle))) : rows;
  const exportCols: ExportColumn[] = cols.map((c) => ({
    header: t(c.ar, c.en), key: c.key, width: 18,
    type: c.kind === 'money' ? 'number' : c.kind === 'date' ? 'date' : 'text',
  }));

  return (
    <>
      {cards.map((c) => {
        const Icon = c.icon;
        return (
          <button key={c.k} type="button" onClick={() => show(c.k)}
            title={t('اعرض القائمة', 'Show the list')}
            className="flex w-full h-full min-w-0 items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 sm:px-5 py-3.5 text-start shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-colors hover:bg-slate-50/60">
            <Icon className="h-4 w-4 shrink-0 text-slate-400" />
            <div className="flex flex-col items-start">
              <span className="text-xl sm:text-2xl font-bold tabular-nums tracking-tight text-slate-900">{c.n.toLocaleString('en-US')}</span>
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500">
                <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: c.n ? TONE[c.tone] : '#cbd5e1' }} />
                {c.title}
              </span>
              <span className="text-[10.5px] leading-snug text-slate-400">{c.sub}</span>
            </div>
          </button>
        );
      })}

      <Modal open={!!open} onClose={() => setOpen(null)} wide={open !== 'gaps'} title={cur ? `${cur.title} (${cur.n.toLocaleString('en-US')})` : ''}>
        <div className="space-y-3 text-sm" dir={ar ? 'rtl' : 'ltr'}>
          {open === 'gaps' && (
            <p className="rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-[12.5px] leading-6 text-violet-900">
              {t(
                `كلُّ رقمٍ بين بداية التسلسل (${g.start ?? '—'}${g.startSource === 'env' ? '، مثبَّتة من الإعدادات' : ''}) وأعلى رقمٍ مكتوبٍ على كشف (${g.end ?? '—'}) لا يحمله أيُّ كشف. ما يعرفه دفترُ التحصيل عن الرقم مكتوبٌ بجانبه ولا يُخفى.`,
                `Every number between the sequence start (${g.start ?? '—'}) and the highest invoice on a report (${g.end ?? '—'}) that no report carries. What the collections ledger knows is shown beside it.`,
              )}
              {!!g.outliers?.length && <><br />{t('أرقامٌ شاذّة خارج التسلسل (لم تُحسب حدودًا): ', 'Outliers outside the sequence (not used as bounds): ')}{g.outliers.slice(0, 20).join('، ')}</>}
              {!!g.textual?.length && <><br />{t(`أرقام فواتير غير رقميّة (${g.textual.length}): `, `Non-numeric invoice numbers (${g.textual.length}): `)}{g.textual.slice(0, 10).join('، ')}</>}
            </p>
          )}
          {open === 'value-diffs' && (
            <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[12.5px] leading-6 text-rose-900">
              {t('القيمةُ المرفوعة = مجموع «المجموع الصافي» لأسطر الفاتورة في أوراق المبيعات. وقيمةُ الكشوف = مجموع «إجمالي الفاتورة» للكشوف الضريبيّة غير الملغاة التي تحمل الرقم — ما يجمعه دفترُ التحصيل نفسُه. الفرقُ أقلُّ من ريالٍ لا يُعَدّ.',
                'Uploaded value = sum of the sheet lines’ totals. Reports value = sum of the invoice total on non-cancelled tax reports carrying that number (what the collections ledger sums). Differences under 1 SAR are ignored.')}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[200px] flex-1">
              <Search className="pointer-events-none absolute start-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('ابحث في القائمة…', 'Search the list…')}
                className="w-full rounded-lg border border-slate-200 bg-white py-2 pe-2 ps-8 text-sm focus:border-[#f37121] focus:outline-none" />
            </div>
            <ExportMenu fileName={`invoice-check-${open || ''}`} lang={ar ? 'ar' : 'en'}
              options={[{ key: 'all', label: t(`القائمة كلّها (${rows.length})`, `Whole list (${rows.length})`), sheets: [{ name: cur?.title.slice(0, 30) || 'list', rows: shown.length === rows.length ? rows : shown, columns: exportCols }] }]} />
          </div>
          {loadingList ? (
            <p className="flex items-center justify-center gap-2 py-8 text-slate-400"><Loader2 className="h-4 w-4 animate-spin" />{t('جارٍ التحميل…', 'Loading…')}</p>
          ) : !shown.length ? (
            <p className="py-8 text-center text-slate-400">{t('لا شيء هنا', 'Nothing here')}</p>
          ) : (
            open === 'gaps' ? (
              /* رقمٌ واحدٌ في كلّ صفّ كان يُمدّ بعرض النافذة كلِّها — فصارت الأرقامُ
                 شبكةً متراصّة (صاحبُ الشركة، ٢٠٢٦/١٠/٢٢). */
              <div className="max-h-[55vh] overflow-auto rounded-lg border border-slate-200 bg-white p-2">
                <div className="grid grid-cols-[repeat(auto-fill,minmax(84px,1fr))] gap-1.5">
                  {shown.slice(0, 3000).map((r, i) => (
                    <span key={`${r.invoiceNumber}-${i}`} className="rounded-md border border-violet-100 bg-violet-50/60 px-2 py-1 text-center text-[12.5px] font-semibold tabular-nums text-violet-900">
                      {r.invoiceNumber}
                    </span>
                  ))}
                </div>
                {shown.length > 3000 && <p className="px-1 pt-2 text-[11px] text-slate-400">{t(`أوّل ٣٠٠٠ من ${shown.length} — الإكسل فيه الكلّ`, `First 3000 of ${shown.length} — the Excel file has all`)}</p>}
              </div>
            ) : (
            <div className="max-h-[55vh] overflow-auto rounded-lg border border-slate-200 bg-white">
              <table className="w-full text-[12.5px]">
                <thead className="sticky top-0 bg-slate-900 text-slate-200">
                  <tr>{cols.map((c) => <th key={c.key} className="whitespace-nowrap px-2 py-1.5 text-start font-semibold">{t(c.ar, c.en)}</th>)}</tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {shown.slice(0, 1000).map((r, i) => (
                    <tr key={`${r.invoiceNumber}-${r.reportNumber || ''}-${i}`} className="hover:bg-slate-50">
                      {cols.map((c) => (
                        <td key={c.key} className={`whitespace-nowrap px-2 py-1.5 ${c.kind === 'money' ? 'tabular-nums' : ''} ${c.key === 'difference' ? (Number(r[c.key]) > 0 ? 'font-bold text-rose-700' : 'font-bold text-emerald-700') : 'text-slate-700'}`}>
                          {c.kind === 'money' ? money(r[c.key]) : c.kind === 'date' ? day(r[c.key]) : (r[c.key] === '' || r[c.key] == null ? '—' : String(r[c.key]))}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              {shown.length > 1000 && <p className="px-2 py-1 text-[11px] text-slate-400">{t(`أوّل ١٠٠٠ من ${shown.length} — الإكسل فيه الكلّ`, `First 1000 of ${shown.length} — the Excel file has all`)}</p>}
            </div>
            )
          )}
          {sum.lastUpload && (
            <p className="text-[11px] text-slate-400">
              {t('آخر رفع: ', 'Last upload: ')}{day(sum.lastUpload.uploadedAt)}{sum.lastUpload.uploadedByName ? ` · ${sum.lastUpload.uploadedByName}` : ''}{sum.lastUpload.fileName ? ` · ${sum.lastUpload.fileName}` : ''}
            </p>
          )}
        </div>
      </Modal>
    </>
  );
}
