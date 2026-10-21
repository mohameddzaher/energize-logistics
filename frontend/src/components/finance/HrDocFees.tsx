'use client';
/**
 * رسومُ تجديد الإقامات ورخص العمل — شاشةٌ واحدةٌ تُقرأ من جهتين.
 *
 *   · الإدارة الماليّة (`canPay`): تختار صفًّا أو أكثر — أو كلَّ نتائج الفلتر —
 *     وتسجّل «تمّ دفع الرسوم» بملاحظةٍ ومبلغٍ ومرفقات، ويتراجع مديروها عن دفعة.
 *   · الموارد البشريّة: الصفوفُ نفسُها بحالة دفعها، قراءةً فقط.
 *
 * ── الصفُّ مستندٌ لا موظّف ──────────────────────────────────────────────────
 * الإقامةُ ورخصةُ العمل تُدفعان منفصلتين، فقد يظهر الموظّفُ صفّين.
 *
 * ── والفلاترُ كلُّها في الخادم ──────────────────────────────────────────────
 * شرائحُ المدّة والمستند والدفع والفلاترُ السريعةُ وفلاترُ الأعمدة تُرسَل كلُّها،
 * وكلُّ مجموعةٍ تُعَدّ هناك بدون فلترها — فلا يقفز رقمٌ تحت مَن يضغطه، ولا
 * يقول عدّادٌ غيرَ ما يفتحه. و«تحديد كلّ نتائج الفلتر» يُرسل الفلترَ نفسَه،
 * فتُدفع النتائجُ كلُّها لا الصفحةُ المعروضةُ وحدَها.
 *
 * والدفعُ ليس تجديدًا: التجديدُ يبقى في ملفّ الموظّف بالموارد البشريّة.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLanguage } from '@/context/LanguageContext';
import { useDialog } from '@/components/system/DialogProvider';
import { useSocket } from '@/hooks/useSocket';
import { useLatestRequest } from '@/hooks/useLatestRequest';
import api from '@/lib/api';
import { Search, X, CheckCircle2, Undo2, Paperclip, CalendarClock, Wallet, Loader2 } from 'lucide-react';
import { Spinner, Modal, Field, TextInput, TextArea, PrimaryButton } from '@/components/hr/HRKit';
import HrQuickFilters, { QUICK_KEYS } from '@/components/hr/HrQuickFilters';
import { ColumnFilter } from '@/components/ColumnFilter';
import FilePicker, { type PickedFile } from '@/components/system/FilePicker';
import ExportMenu, { exportScopeLabels, type ExportColumn } from '@/components/ls2/ExportMenu';
import ScrollX from '@/components/system/ScrollX';
import { hijriCell } from '@/lib/hrDates';
import {
  DOC_LABEL, PAID_LABEL, daysLeftText, fmtStamp, type HrDocRow, type HrDocsPayload,
} from '@/lib/hrFinance';
import type { FilterValues } from '@/components/system/FilterPanel';

const PAGE = 50;
const EMPTY: Set<string> = new Set();

export default function HrDocFees({ listUrl, optionsUrl, payUrl, unpayUrl, profileLinks = false }: {
  /** نقاطُ الـ API تُمرَّر من الصفحة — فتُنسب إليها في خريطة الصلاحيّات (genPageApis). */
  listUrl: string;
  optionsUrl: string;
  payUrl?: string;
  unpayUrl?: string;
  /** اسمُ الموظّف يفتح ملفَّه — للموارد البشريّة وحدَها (الماليّةُ لا تملك صفحةَ الملفّ). */
  profileLinks?: boolean;
}) {
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const t = (a: string, e: string) => (ar ? a : e);
  const { notify, confirm } = useDialog();
  const router = useRouter();

  // ── الفلاتر ──
  const [win, setWin] = useState('');           // '' = منتهية + خلال ٢٠ يومًا
  const [doc, setDoc] = useState('');
  const [paid, setPaid] = useState('');
  const [q, setQ] = useState('');
  const [qDeb, setQDeb] = useState('');
  const [quick, setQuick] = useState<FilterValues>({});
  const [cf, setCf] = useState<Record<string, string[]>>({});
  useEffect(() => { const h = setTimeout(() => setQDeb(q.trim()), 300); return () => clearTimeout(h); }, [q]);

  const query = useMemo(() => {
    const p: Record<string, string> = {};
    if (win) p.window = win;
    if (doc) p.doc = doc;
    if (paid) p.paid = paid;
    if (qDeb) p.q = qDeb;
    for (const k of QUICK_KEYS) { const v = quick[k.key]; if (v) p[k.key] = String(v); }
    if (Object.keys(cf).length) p.cf = JSON.stringify(cf);
    return p;
  }, [win, doc, paid, qDeb, quick, cf]);
  const queryKey = JSON.stringify(query);

  // ── البيانات ──
  const [d, setD] = useState<HrDocsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const guard = useLatestRequest();
  const load = useCallback(async () => {
    const mine = guard.begin();
    try {
      const qs = new URLSearchParams(query).toString();
      const res = await api.get<HrDocsPayload>(`${listUrl}${qs ? `?${qs}` : ''}`);
      if (!guard.isCurrent(mine)) return;
      setD(res); setError('');
    } catch (e: any) {
      if (guard.isCurrent(mine)) setError(e?.message || t('تعذّر التحميل', 'Could not load'));
    }
    if (guard.isCurrent(mine)) setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listUrl, queryKey, guard]);
  useEffect(() => { load(); }, [load]);
  const live = useCallback(() => { load(); }, [load]);
  useSocket('hr-finance:changed', live);
  useSocket('hr:master', live);
  useSocket('hr:employee', live);

  // ── التحديد: صفوفٌ بعينها، أو كلُّ نتائج الفلتر ──
  const [sel, setSel] = useState<Set<string>>(EMPTY);
  const [allMatching, setAllMatching] = useState(false);
  const [page, setPage] = useState(0);
  // فلترٌ جديد = نتائجُ جديدة: التحديدُ القديمُ لا يُحمَل إليها.
  useEffect(() => { setSel(EMPTY); setAllMatching(false); setPage(0); }, [queryKey]);

  const rows = d?.rows || [];
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const pageRows = rows.slice(page * PAGE, page * PAGE + PAGE);
  const canPay = !!(d?.can?.pay && payUrl);
  const canUndo = !!(d?.can?.undo && unpayUrl);
  const selCount = allMatching ? rows.length : sel.size;
  const selectedRows = allMatching ? rows : rows.filter((r) => sel.has(r.key));
  const pageAllOn = pageRows.length > 0 && pageRows.every((r) => allMatching || sel.has(r.key));

  const toggle = (k: string) => {
    if (allMatching) { setAllMatching(false); setSel(new Set(rows.map((r) => r.key).filter((x) => x !== k))); return; }
    const n = new Set(sel); if (n.has(k)) n.delete(k); else n.add(k); setSel(n);
  };
  const togglePage = () => {
    if (pageAllOn) {
      if (allMatching) { setAllMatching(false); setSel(new Set(rows.filter((r) => !pageRows.includes(r)).map((r) => r.key))); return; }
      const n = new Set(sel); pageRows.forEach((r) => n.delete(r.key)); setSel(n);
    } else {
      const n = new Set(sel); pageRows.forEach((r) => n.add(r.key)); setSel(n);
    }
  };
  const target = () => (allMatching
    ? { all: true, query }
    : { items: selectedRows.map((r) => ({ employeeId: r.employeeId, docType: r.docType })) });

  // ── الدفع ──
  const [payOpen, setPayOpen] = useState(false);
  const [payForm, setPayForm] = useState({ note: '', amount: '' });
  const [payFiles, setPayFiles] = useState<PickedFile[]>([]);
  const [busy, setBusy] = useState(false);
  const unpaidSelected = selectedRows.filter((r) => !r.paid).length;
  const paidSelected = selectedRows.filter((r) => r.paid).length;

  const submitPay = async () => {
    if (!payUrl) return;
    setBusy(true);
    try {
      const r = await api.post<{ paid: number; already: number; missing: number }>(payUrl, {
        ...target(), note: payForm.note, amount: payForm.amount === '' ? null : Number(payForm.amount),
        files: payFiles.map((f) => ({ dataUrl: f.dataUrl, fileName: f.fileName, title: f.title })),
      });
      notify(t(`سُجّل دفعُ رسوم ${r.paid} مستند${r.already ? ` · ${r.already} مدفوعٌ من قبل` : ''}`,
        `Fees recorded for ${r.paid} document(s)${r.already ? ` · ${r.already} already paid` : ''}`), 'success');
      setPayOpen(false); setSel(EMPTY); setAllMatching(false); load();
    } catch (e: any) { notify(e?.message || t('تعذّر تسجيل الدفع', 'Could not record payment'), 'error'); }
    setBusy(false);
  };

  const undo = async () => {
    if (!unpayUrl) return;
    if (!(await confirm(t(`التراجع عن دفع رسوم ${paidSelected} مستند؟ تبقى الدفعةُ في السجلّ ملغاة.`,
      `Undo the payment of ${paidSelected} document(s)? The payment stays in the log as voided.`)))) return;
    setBusy(true);
    try {
      const r = await api.post<{ undone: number }>(unpayUrl, target());
      notify(t(`أُلغي دفعُ ${r.undone} مستند`, `${r.undone} payment(s) voided`), 'success');
      setSel(EMPTY); setAllMatching(false); load();
    } catch (e: any) { notify(e?.message || t('تعذّر التراجع', 'Could not undo'), 'error'); }
    setBusy(false);
  };

  // ── التصدير ──
  const cols: ExportColumn[] = [
    { header: t('الرقم الوظيفي', 'Employee no.'), key: 'employeeNumber', width: 14 },
    { header: t('الاسم', 'Name'), key: 'name', width: 30 },
    { header: t('رقم الإقامة', 'Iqama no.'), key: 'idNumber', width: 16 },
    { header: t('المستند', 'Document'), key: 'docType', width: 14, transform: (v) => (DOC_LABEL[v] || [v, v])[ar ? 0 : 1] },
    { header: t('تاريخ الانتهاء', 'Expiry date'), key: 'expiryDate', width: 14, type: 'date' },
    { header: t('تاريخ الانتهاء (هجري)', 'Expiry (Hijri)'), key: 'expiryDate', width: 14, type: 'hijri' },
    { header: t('المتبقي (يوم)', 'Days left'), key: 'daysLeft', width: 12, type: 'number' },
    { header: t('القسم', 'Department'), key: 'department', width: 18 },
    { header: t('الفئة الوظيفية', 'Staff category'), key: 'staffCategory', width: 14 },
    { header: t('المشروع', 'Project'), key: 'project', width: 16 },
    { header: t('المدينة', 'City'), key: 'branchName', width: 14 },
    { header: t('الجنسية', 'Nationality'), key: 'nationality', width: 14 },
    { header: t('السجل التجاري', 'Register'), key: 'registerNumber', width: 16 },
    { header: t('حالة الدفع', 'Payment'), key: 'paid', width: 12, transform: (v) => PAID_LABEL[v ? 'paid' : 'unpaid'][ar ? 0 : 1] },
    { header: t('المبلغ', 'Amount'), key: 'payment', width: 12, type: 'number', transform: (v) => v?.amount ?? '' },
    { header: t('دفعها', 'Paid by'), key: 'payment', width: 18, transform: (v) => v?.paidByName || '' },
    { header: t('تاريخ الدفع', 'Paid at'), key: 'payment', width: 18, transform: (v) => (v?.paidAt ? fmtStamp(v.paidAt, ar) : '') },
    { header: t('ملاحظة الدفع', 'Payment note'), key: 'payment', width: 26, transform: (v) => v?.note || '' },
  ];
  const sheetName = t('الإقامات ورخص العمل', 'Iqamas & permits');
  const hasFilters = Object.keys(query).length > 0;
  const scope = exportScopeLabels(ar);
  const exportOptions = hasFilters
    ? [
        { key: 'shown', label: scope.shown, sheets: [{ name: sheetName, rows, columns: cols }] },
        { key: 'all', label: scope.all, resolve: async () => {
          const full = await api.get<HrDocsPayload>(listUrl);
          return [{ name: sheetName, rows: full.rows || [], columns: cols }];
        } },
      ]
    : [{ key: 'all', label: scope.all, sheets: [{ name: sheetName, rows, columns: cols }] }];

  // ── فلترُ عمود: قائمتُه من الخادم بعدد صفوف كلّ قيمة ──
  const colHead = (key: string, format?: (v: string) => string) => (
    <ColumnFilter field={key} options={d?.columnOptions?.[key] || []}
      selected={cf[key] ? new Set(cf[key]) : EMPTY}
      onChange={(s) => setCf((prev) => { const n = { ...prev }; if (s.size) n[key] = [...s]; else delete n[key]; return n; })}
      format={format} lang={ar ? 'ar' : 'en'} />
  );
  const docFmt = (v: string) => (DOC_LABEL[v] || [v, v])[ar ? 0 : 1];
  const paidFmt = (v: string) => (PAID_LABEL[v] || [v, v])[ar ? 0 : 1];

  if (loading && !d) return <Spinner />;
  if (!d) return <div className="p-8 text-slate-500">{error || t('تعذّر التحميل', 'Could not load')}</div>;

  const W = d.counts.windows;
  const chips: { key: string; label: string; n: number; tone: string }[] = [
    { key: '', label: t(`الكل — منتهية وخلال ${d.horizon} يومًا`, `All — expired & within ${d.horizon} days`), n: W.all, tone: 'slate' },
    { key: 'expired', label: t('منتهية', 'Expired'), n: W.expired, tone: 'red' },
    ...d.windows.map((n) => ({ key: String(n), label: t(`خلال ${n} يومًا`, `Within ${n} days`), n: W[n] ?? 0, tone: 'orange' })),
  ];
  const chipCls = (on: boolean, tone: string) => {
    if (on) return tone === 'red' ? 'bg-red-600 text-white border-red-600' : tone === 'slate' ? 'bg-slate-900 text-white border-slate-900' : 'bg-[#f37121] text-white border-[#f37121]';
    return tone === 'red' ? 'bg-white text-red-700 border-red-200 hover:border-red-400' : 'bg-white text-slate-700 border-slate-200 hover:border-[#f37121]/60';
  };
  const seg = (on: boolean) => `px-3 py-1.5 rounded-lg text-[12.5px] font-semibold border transition ${on ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-700 border-slate-200 hover:border-slate-400'}`;
  const thCls = 'px-3 py-3 text-center font-bold whitespace-nowrap';

  return (
    <div className="space-y-4" dir={isRTL ? 'rtl' : 'ltr'}>
      {/* ── شرائحُ المدّة: الرقمُ في كلٍّ منها بكلّ الفلاتر عدا المدّة ── */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <CalendarClock className="w-4 h-4 text-slate-400" />
          {chips.map((c) => (
            <button key={c.key || 'all'} type="button" onClick={() => setWin(c.key)}
              className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-[13px] font-bold shadow-sm transition ${chipCls(win === c.key, c.tone)}`}>
              {c.label}
              <span className={`min-w-[2rem] rounded-full px-2 py-0.5 text-center text-[12px] tabular-nums ${win === c.key ? 'bg-white/20' : 'bg-slate-100 text-slate-700'}`}>{c.n}</span>
            </button>
          ))}
          <div className="ms-auto">
            <ExportMenu fileName="iqama-work-permit-fees" lang={ar ? 'ar' : 'en'} options={exportOptions} label={t('تصدير Excel', 'Export Excel')} />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
          <span className="text-[12px] font-semibold text-slate-500">{t('المستند', 'Document')}</span>
          <button type="button" className={seg(!doc)} onClick={() => setDoc('')}>{t('الكل', 'All')} <b className="tabular-nums">{d.counts.docs.all}</b></button>
          {(['iqama', 'workPermit'] as const).map((k) => (
            <button key={k} type="button" className={seg(doc === k)} onClick={() => setDoc(doc === k ? '' : k)}>
              {docFmt(k)} <b className="tabular-nums">{d.counts.docs[k] ?? 0}</b>
            </button>
          ))}
          <span className="mx-1 text-slate-300">|</span>
          <span className="text-[12px] font-semibold text-slate-500">{t('الدفع', 'Payment')}</span>
          <button type="button" className={seg(!paid)} onClick={() => setPaid('')}>{t('الكل', 'All')} <b className="tabular-nums">{d.counts.paid.all}</b></button>
          <button type="button" className={seg(paid === 'unpaid')} onClick={() => setPaid(paid === 'unpaid' ? '' : 'unpaid')}>
            {t('غير مدفوع', 'Unpaid')} <b className="tabular-nums">{d.counts.paid.unpaid}</b>
          </button>
          <button type="button" className={seg(paid === 'paid')} onClick={() => setPaid(paid === 'paid' ? '' : 'paid')}>
            {t('مدفوع', 'Paid')} <b className="tabular-nums">{d.counts.paid.paid}</b>
          </button>
          <div className="relative ms-auto">
            <Search className="pointer-events-none absolute start-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input value={q} onChange={(e) => setQ(e.target.value)}
              placeholder={t('ابحث بالاسم أو رقم الإقامة أو الرقم الوظيفي', 'Name, iqama or employee no.')}
              className="w-72 max-w-full rounded-lg border border-slate-200 py-2 pe-8 ps-8 text-sm focus:border-[#f37121] focus:outline-none" />
            {q && <button type="button" onClick={() => setQ('')} className="absolute end-2.5 top-1/2 -translate-y-1/2 text-slate-400"><X className="h-3.5 w-3.5" /></button>}
          </div>
        </div>

        <div className="border-t border-slate-100 pt-3">
          <HrQuickFilters optionsUrl={optionsUrl} value={quick} onChange={setQuick} ar={ar}
            optionsParams={Object.fromEntries(Object.entries(query).filter(([k]) => !QUICK_KEYS.some((x) => x.key === k)))} />
        </div>
        {(hasFilters) && (
          <button type="button" onClick={() => { setWin(''); setDoc(''); setPaid(''); setQ(''); setQuick({}); setCf({}); }}
            className="inline-flex items-center gap-1 text-[12.5px] font-semibold text-slate-500 hover:text-slate-800">
            <X className="h-3.5 w-3.5" />{t('مسح كلّ الفلاتر', 'Clear all filters')}
            {Object.keys(cf).length ? ` · ${t(`فلاتر الأعمدة ${Object.keys(cf).length}`, `${Object.keys(cf).length} column filters`)}` : ''}
          </button>
        )}
      </div>

      {/* ── شريطُ التحديد والأفعال ── */}
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-[13px] font-semibold text-slate-700">
          {t(`المعروض: ${d.total} مستند`, `Shown: ${d.total} documents`)}
          <span className="text-slate-400"> · {t(`غير مدفوع ${d.unpaidShown}`, `${d.unpaidShown} unpaid`)}</span>
        </p>
        {loading && <Loader2 className="w-4 h-4 animate-spin text-slate-400" />}
        {canPay && (
          <div className="ms-auto flex flex-wrap items-center gap-2">
            {selCount > 0 && (
              <span className="rounded-lg bg-orange-50 px-3 py-1.5 text-[12.5px] font-bold text-[#c2410c]">
                {allMatching ? t(`كلّ نتائج الفلتر (${selCount})`, `All ${selCount} results`) : t(`${selCount} محدّد`, `${selCount} selected`)}
              </span>
            )}
            {!allMatching && rows.length > 0 && (
              <button type="button" onClick={() => { setAllMatching(true); setSel(EMPTY); }}
                className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[12.5px] font-semibold text-slate-700 hover:border-[#f37121]">
                {t(`تحديد كلّ نتائج الفلتر (${rows.length})`, `Select all ${rows.length} results`)}
              </button>
            )}
            {selCount > 0 && (
              <button type="button" onClick={() => { setSel(EMPTY); setAllMatching(false); }}
                className="rounded-lg px-2 py-1.5 text-[12.5px] font-semibold text-slate-500 hover:text-slate-800">{t('إلغاء التحديد', 'Clear')}</button>
            )}
            <button type="button" disabled={!unpaidSelected || busy}
              onClick={() => { setPayForm({ note: '', amount: '' }); setPayFiles([]); setPayOpen(true); }}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-[13px] font-bold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-40">
              <CheckCircle2 className="w-4 h-4" />{t('تمّ دفع الرسوم', 'Fees paid')}{unpaidSelected ? ` (${unpaidSelected})` : ''}
            </button>
            {canUndo && (
              <button type="button" disabled={!paidSelected || busy} onClick={undo}
                className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-white px-3 py-2 text-[12.5px] font-semibold text-red-700 hover:bg-red-50 disabled:opacity-40">
                <Undo2 className="w-4 h-4" />{t('تراجع عن الدفع', 'Undo payment')}{paidSelected ? ` (${paidSelected})` : ''}
              </button>
            )}
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <ScrollX>
          <table className="w-full text-sm">
            <thead className="bg-slate-900 text-slate-200 text-[13px]">
              <tr>
                {canPay && (
                  <th className="px-3 py-3 w-10">
                    <input type="checkbox" checked={pageAllOn} onChange={togglePage} className="w-4 h-4 accent-[#f37121]"
                      title={t('تحديد الصفحة', 'Select page')} />
                  </th>
                )}
                <th className={thCls}>{t('الرقم الوظيفي', 'Emp. no.')} {colHead('employeeNumber')}</th>
                <th className={thCls}>{t('الموظف', 'Employee')} {colHead('name')}</th>
                <th className={thCls}>{t('رقم الإقامة', 'Iqama no.')} {colHead('idNumber')}</th>
                <th className={thCls}>{t('المستند', 'Document')} {colHead('doc', docFmt)}</th>
                <th className={thCls}>{t('تاريخ الانتهاء', 'Expiry')} {colHead('expiryDate')}</th>
                <th className={thCls}>{t('الانتهاء (هجري)', 'Expiry (Hijri)')}</th>
                <th className={thCls}>{t('المتبقي', 'Left')} {colHead('daysLeft')}</th>
                <th className={thCls}>{t('القسم', 'Department')} {colHead('department')}</th>
                <th className={thCls}>{t('الفئة', 'Category')} {colHead('staffCategory')}</th>
                <th className={thCls}>{t('المشروع', 'Project')} {colHead('project')}</th>
                <th className={thCls}>{t('المدينة', 'City')} {colHead('branchName')}</th>
                <th className={thCls}>{t('حالة الدفع', 'Payment')} {colHead('paid', paidFmt)}</th>
                <th className={thCls}>{t('دفعها', 'Paid by')} {colHead('paidByName')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {pageRows.map((r: HrDocRow) => {
                const on = allMatching || sel.has(r.key);
                return (
                  <tr key={r.key} className={`text-center ${on ? 'bg-orange-50/60' : 'hover:bg-slate-50'}`}>
                    {canPay && (
                      <td className="px-3 py-2.5">
                        <input type="checkbox" checked={on} onChange={() => toggle(r.key)} className="w-4 h-4 accent-[#f37121]" />
                      </td>
                    )}
                    <td className="px-3 py-2.5 whitespace-nowrap tabular-nums text-[13px] text-slate-700">{r.employeeNumber || '—'}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      {profileLinks
                        ? <button type="button" onClick={() => router.push(`/system/hr/employees/${r.employeeId}`)} className="font-semibold text-slate-900 hover:text-[#f37121] text-[13.5px]">{r.name}</button>
                        : <span className="font-semibold text-slate-900 text-[13.5px]">{r.name}</span>}
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap tabular-nums text-[13px] text-slate-700">{r.idNumber || '—'}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      <span className={`rounded-full px-2 py-0.5 text-[11.5px] font-semibold ${r.docType === 'iqama' ? 'bg-sky-50 text-sky-700' : 'bg-violet-50 text-violet-700'}`}>{docFmt(r.docType)}</span>
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap tabular-nums text-[13px] text-slate-800">{r.expiryDate}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap tabular-nums text-[13px] text-slate-600" dir="ltr">{hijriCell(r.expiryDate)}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      {r.expired
                        ? <span className="rounded-full bg-red-50 px-2 py-0.5 text-[11.5px] font-bold text-red-700 border border-red-200">{t('منتهية', 'Expired')} · {-r.daysLeft}</span>
                        : <span className={`text-[12.5px] font-bold ${r.daysLeft <= 5 ? 'text-red-600' : r.daysLeft <= 10 ? 'text-orange-600' : 'text-amber-600'}`}>{daysLeftText(r.daysLeft, ar)}</span>}
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap text-[13px] text-slate-700">{r.department || '—'}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap text-[13px] text-slate-700">{r.staffCategory || '—'}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap text-[13px] text-slate-700">{r.project || '—'}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap text-[13px] text-slate-700">{r.branchName || '—'}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      {r.paid
                        ? <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11.5px] font-bold text-emerald-700"><CheckCircle2 className="w-3 h-3" />{t('مدفوع', 'Paid')}</span>
                        : <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11.5px] font-semibold text-slate-600">{t('غير مدفوع', 'Unpaid')}</span>}
                    </td>
                    <td className="px-3 py-2.5 text-start text-[12px] text-slate-600 min-w-[180px]">
                      {r.payment ? (
                        <div className="space-y-0.5">
                          <p className="font-semibold text-slate-800">{r.payment.paidByName || '—'}</p>
                          <p className="text-[11px] text-slate-400">{fmtStamp(r.payment.paidAt, ar)}{r.payment.amount != null ? ` · ${r.payment.amount.toLocaleString('en-US')} ${t('ر.س', 'SAR')}` : ''}</p>
                          {r.payment.note && <p className="text-[11.5px] text-slate-600 whitespace-pre-wrap">{r.payment.note}</p>}
                          {r.payment.files?.length > 0 && (
                            <div className="flex flex-wrap gap-1">
                              {r.payment.files.map((f, i) => (
                                <a key={i} href={f.fileUrl} target="_blank" rel="noreferrer"
                                  className="inline-flex items-center gap-1 rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-700 hover:text-[#f37121]">
                                  <Paperclip className="w-3 h-3" />{f.fileName || t('مرفق', 'File')}
                                </a>
                              ))}
                            </div>
                          )}
                        </div>
                      ) : '—'}
                    </td>
                  </tr>
                );
              })}
              {!rows.length && (
                <tr><td colSpan={canPay ? 14 : 13} className="px-3 py-12 text-center text-slate-400">
                  {t('لا مستنداتٍ تطابق الفلاتر', 'No documents match the filters')}
                </td></tr>
              )}
            </tbody>
          </table>
        </ScrollX>
        {pages > 1 && (
          <div className="flex items-center justify-center gap-2 border-t border-slate-100 p-3 text-[13px]">
            <button type="button" disabled={page === 0} onClick={() => setPage(page - 1)} className="rounded-lg border border-slate-200 px-3 py-1 disabled:opacity-40">{t('السابق', 'Prev')}</button>
            <span className="tabular-nums text-slate-600">{page + 1} / {pages}</span>
            <button type="button" disabled={page >= pages - 1} onClick={() => setPage(page + 1)} className="rounded-lg border border-slate-200 px-3 py-1 disabled:opacity-40">{t('التالي', 'Next')}</button>
          </div>
        )}
      </div>

      <Modal open={payOpen} onClose={() => setPayOpen(false)} title={t('تمّ دفع الرسوم', 'Fees paid')}
        footer={<>
          <button type="button" onClick={() => setPayOpen(false)} className="px-4 py-2 text-slate-500 hover:text-slate-900 text-sm">{t('إلغاء', 'Cancel')}</button>
          <PrimaryButton onClick={submitPay} disabled={busy}><Wallet className="w-4 h-4" /> {t('تسجيل الدفع', 'Record payment')}</PrimaryButton>
        </>}>
        <div className="space-y-3">
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-[13px] text-emerald-900">
            <p className="font-bold">{t(`سيُسجَّل دفعُ رسوم ${unpaidSelected} مستند`, `${unpaidSelected} document(s) will be marked paid`)}</p>
            {paidSelected > 0 && <p className="text-[12px] mt-0.5">{t(`و${paidSelected} مدفوعٌ من قبل يُترك كما هو`, `${paidSelected} already paid are left as they are`)}</p>}
            <p className="text-[12px] mt-1 text-emerald-800">{t('هذا تسجيلُ دفعٍ فقط — التجديدُ يبقى للموارد البشرية من ملف الموظف.', 'This records payment only — HR still renews the document in the employee profile.')}</p>
          </div>
          <Field label={t('المبلغ لكلّ مستند (اختياري)', 'Amount per document (optional)')}>
            <TextInput type="number" min={0} step="0.01" value={payForm.amount} dir="ltr"
              onChange={(e: any) => setPayForm((f) => ({ ...f, amount: e.target.value }))} />
          </Field>
          <Field label={t('ملاحظة (اختياري)', 'Note (optional)')}>
            <TextArea rows={3} value={payForm.note} onChange={(e: any) => setPayForm((f) => ({ ...f, note: e.target.value }))}
              placeholder={t('رقم السداد، طريقة الدفع…', 'Payment ref, method…')} />
          </Field>
          <Field label={t('مرفقات (اختياري)', 'Attachments (optional)')}>
            <FilePicker files={payFiles} onChange={setPayFiles} />
          </Field>
        </div>
      </Modal>
    </div>
  );
}
