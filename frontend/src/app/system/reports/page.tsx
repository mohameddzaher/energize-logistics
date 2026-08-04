'use client';
// مركز التقارير — pick what, pick who, pick when, read it, print it.
//
// The preview on screen is drawn from the SAME block document the PDF is
// rendered from, so what you read here is exactly what comes out of the printer.
// (This page replaced a stub that redirected to the dashboard.)
import { useState, useEffect, useCallback, useMemo, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useDialog } from '@/components/system/DialogProvider';
import {
  FileBarChart, Search, Loader2, FileDown, Truck, UserSquare, Building2,
  Store, BadgeCheck, Layers, RefreshCw, Printer, CalendarCheck,
} from 'lucide-react';
import { PageHeader } from '@/components/hr/HRKit';
import ReportView from '@/components/system/ReportView';
import type { ReportDoc } from '@/components/system/ReportView';
import {
  listSubjects, listOptions, fetchReport, openReportPdf, defaultRange,
  SUBJECT_HINT, type ReportSubject, type ReportOption,
} from '@/lib/reports';

const ICONS: Record<string, any> = {
  truck: Truck, user: UserSquare, building: Building2, store: Store,
  badge: BadgeCheck, layers: Layers, calendar: CalendarCheck,
};

function ReportsInner() {
  const sp = useSearchParams();
  const router = useRouter();
  const { user } = useAuth();
  const { lang } = useLanguage();
  const { notify } = useDialog();
  const ar = lang === 'ar';
  const tx = (en: string, a: string) => (ar ? a : en);

  const [subjects, setSubjects] = useState<ReportSubject[]>([]);
  const [subject, setSubject] = useState(sp?.get('subject') || '');
  const [options, setOptions] = useState<ReportOption[]>([]);
  const [optionsLoading, setOptionsLoading] = useState(false);
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<string>(sp?.get('id') || '');
  const [range, setRange] = useState(() => ({
    from: sp?.get('from') || defaultRange().from,
    to: sp?.get('to') || defaultRange().to,
  }));

  const [doc, setDoc] = useState<ReportDoc | null>(null);
  const [building, setBuilding] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    listSubjects()
      .then((r) => {
        setSubjects(r.subjects || []);
        if (!subject && r.subjects?.length) setSubject(r.subjects[0].key);
      })
      .catch(() => setSubjects([]));
    // Mount only — `subject` is seeded from the URL and then user-driven.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // What can be reported on, for the chosen subject. Debounced: the search hits
  // every register in the company.
  useEffect(() => {
    if (!subject) return;
    let cancelled = false;
    setOptionsLoading(true);
    const t = setTimeout(() => {
      listOptions(subject, q.trim())
        .then((r) => { if (!cancelled) setOptions(r.items || []); })
        .catch(() => { if (!cancelled) setOptions([]); })
        .finally(() => { if (!cancelled) setOptionsLoading(false); });
    }, 250);
    return () => { cancelled = true; clearTimeout(t); };
  }, [subject, q]);

  const current = useMemo(() => subjects.find((s) => s.key === subject) || null, [subjects, subject]);
  const selectedOption = useMemo(() => options.find((o) => o.id === selected) || null, [options, selected]);

  const build = useCallback(async (id: string) => {
    if (!subject || !id) return;
    setBuilding(true);
    setError('');
    setDoc(null);
    try {
      setDoc(await fetchReport(subject, id, range.from, range.to, ar ? 'ar' : 'en'));
      // Keep the URL shareable — a colleague can be sent the exact report.
      router.replace(`/system/reports?subject=${subject}&id=${encodeURIComponent(id)}&from=${range.from}&to=${range.to}`);
    } catch (e: any) {
      setError(e?.message || tx('Could not build this report', 'تعذّر إصدار هذا التقرير'));
    }
    setBuilding(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subject, range.from, range.to, ar]);

  // A shared link (or a "تقرير" button on a profile page) lands here ready-made.
  useEffect(() => {
    const id = sp?.get('id');
    if (id && subject && !doc && !building) build(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subject]);

  const downloadPdf = async () => {
    if (!subject || !selected) return;
    setPdfBusy(true);
    try {
      await openReportPdf(subject, selected, range.from, range.to, ar ? 'ar' : 'en');
    } catch (e: any) {
      notify(e?.message || tx('Could not generate the PDF', 'تعذّر توليد ملف PDF'), 'error');
    }
    setPdfBusy(false);
  };

  if (!user) return null;
  if (!subjects.length) {
    return (
      <div className="space-y-5">
        <PageHeader icon={<FileBarChart className="w-5 h-5 text-[#f37121]" />} title={tx('Reports', 'مركز التقارير')} />
        <p className="text-slate-500 text-sm">{tx('You do not have access to any report.', 'لا تملك صلاحية على أي تقرير.')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        icon={<FileBarChart className="w-5 h-5 text-[#f37121]" />}
        title={tx('Reports', 'مركز التقارير')}
        subtitle={tx(
          'A complete PDF report on any vehicle, driver, customer, vendor, employee or department, over any period.',
          'تقرير PDF كامل عن أي مركبة أو سائق أو عميل أو مورد أو موظف أو قسم، خلال أي فترة.'
        )}
      />

      {/* 1 — what kind of report */}
      <div className="flex flex-wrap gap-2">
        {subjects.map((s) => {
          const Icon = ICONS[s.icon] || FileBarChart;
          const active = subject === s.key;
          return (
            <button
              key={s.key}
              type="button"
              onClick={() => { setSubject(s.key); setSelected(''); setDoc(null); setQ(''); setError(''); }}
              className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-sm font-medium border transition-colors ${
                active ? 'bg-[#f37121] text-white border-[#f37121]' : 'bg-white text-slate-700 border-slate-200 hover:border-slate-300'
              }`}
            >
              <Icon className="w-4 h-4" />
              {ar ? s.ar : s.en}
            </button>
          );
        })}
      </div>
      {current && (
        <p className="text-slate-500 text-xs -mt-2">
          {ar ? SUBJECT_HINT[current.key]?.ar : SUBJECT_HINT[current.key]?.en}
        </p>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-5 items-start">
        {/* 2 — who, and over what period */}
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm space-y-3 lg:sticky lg:top-4">
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="text-[11px] text-slate-500">{tx('From', 'من')}</span>
              <input type="date" value={range.from} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))}
                className="w-full mt-1 px-2 py-1.5 rounded-lg border border-slate-200 text-sm text-slate-800" />
            </label>
            <label className="block">
              <span className="text-[11px] text-slate-500">{tx('To', 'إلى')}</span>
              <input type="date" value={range.to} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))}
                className="w-full mt-1 px-2 py-1.5 rounded-lg border border-slate-200 text-sm text-slate-800" />
            </label>
          </div>

          {current?.searchable && (
            <div className="relative">
              <Search className="absolute top-1/2 -translate-y-1/2 start-2.5 w-4 h-4 text-slate-400" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={tx('Search…', 'ابحث…')}
                className="w-full ps-8 pe-2 py-2 rounded-lg border border-slate-200 text-sm text-slate-800 focus:outline-none focus:border-[#f37121]"
              />
            </div>
          )}

          <div className="max-h-[420px] overflow-y-auto border border-slate-200 rounded-lg divide-y divide-slate-100">
            {optionsLoading && (
              <p className="px-3 py-3 text-slate-400 text-xs flex items-center gap-2">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />{tx('Loading…', 'جارٍ التحميل…')}
              </p>
            )}
            {!optionsLoading && !options.length && (
              <p className="px-3 py-3 text-slate-400 text-xs">{tx('Nothing to report on', 'لا توجد عناصر')}</p>
            )}
            {options.map((o) => (
              <button
                key={o.id}
                type="button"
                onClick={() => { setSelected(o.id); build(o.id); }}
                className={`w-full text-start px-3 py-2 text-sm hover:bg-slate-50 ${selected === o.id ? 'bg-[#f37121]/10' : ''}`}
              >
                <span className={`block truncate ${o.inactive ? 'text-slate-400' : 'text-slate-900'}`}>{o.name}</span>
                {o.detail && <span className="block text-[11px] text-slate-400 truncate">{o.detail}</span>}
              </button>
            ))}
          </div>
          {options.length >= 500 && (
            <p className="text-[10px] text-slate-400">{tx('Showing the first 500 — refine the search.', 'يعرض أول ٥٠٠ — استخدم البحث للتضييق.')}</p>
          )}

          {selected && (
            <div className="flex gap-2 pt-1">
              <button type="button" onClick={() => build(selected)} disabled={building}
                className="flex-1 inline-flex items-center justify-center gap-1.5 border border-slate-200 text-slate-700 text-xs rounded-lg px-3 py-2 hover:bg-slate-50 disabled:opacity-50">
                {building ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                {tx('Rebuild', 'إعادة الإصدار')}
              </button>
              <button type="button" onClick={downloadPdf} disabled={pdfBusy || building}
                className="flex-1 inline-flex items-center justify-center gap-1.5 bg-[#f37121] text-white text-xs font-medium rounded-lg px-3 py-2 disabled:opacity-50">
                {pdfBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileDown className="w-3.5 h-3.5" />}
                PDF
              </button>
            </div>
          )}
        </div>

        {/* 3 — the report itself */}
        <div>
          {building && (
            <div className="bg-white border border-slate-200 rounded-xl p-10 shadow-sm text-center">
              <Loader2 className="w-6 h-6 animate-spin text-[#f37121] mx-auto" />
              <p className="text-slate-500 text-sm mt-3">{tx('Collecting the data for this report…', 'جارٍ تجميع بيانات التقرير…')}</p>
              <p className="text-slate-400 text-xs mt-1">
                {tx('Vehicle and driver reports read the tracking system live and can take a few seconds.',
                  'تقارير المركبات والسائقين تقرأ من نظام التتبّع مباشرة وقد تستغرق بضع ثوانٍ.')}
              </p>
            </div>
          )}

          {!building && error && (
            <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 text-sm">{error}</div>
          )}

          {!building && !error && doc && (
            <>
              <div className="flex items-center justify-between gap-2 mb-3">
                <p className="text-slate-500 text-xs">
                  {tx('Preview — the PDF is laid out identically on the company letterhead.',
                    'معاينة — ملف PDF بنفس هذا الترتيب على ورق الشركة الرسمي.')}
                </p>
                <button type="button" onClick={downloadPdf} disabled={pdfBusy}
                  className="inline-flex items-center gap-1.5 border border-slate-200 text-slate-700 text-xs rounded-lg px-3 py-1.5 hover:bg-slate-50 disabled:opacity-50">
                  {pdfBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Printer className="w-3.5 h-3.5" />}
                  {tx('Open PDF', 'فتح PDF')}
                </button>
              </div>
              <ReportView doc={doc} />
            </>
          )}

          {!building && !error && !doc && (
            <div className="bg-white border border-dashed border-slate-300 rounded-xl p-12 text-center">
              <FileBarChart className="w-10 h-10 text-slate-300 mx-auto" />
              <p className="text-slate-500 text-sm mt-3">
                {selectedOption
                  ? tx('Press Rebuild to generate the report.', 'اضغط «إعادة الإصدار» لإنشاء التقرير.')
                  : tx('Pick something from the list to generate its report.', 'اختر عنصرًا من القائمة لإصدار تقريره.')}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function ReportsPage() {
  return (
    <Suspense fallback={<div className="h-64 flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin text-[#f37121]" /></div>}>
      <ReportsInner />
    </Suspense>
  );
}
