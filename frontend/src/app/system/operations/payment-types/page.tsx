'use client';
/**
 * أنواعُ الدفع — صفةُ كلّ عميلٍ في مكانٍ واحد.
 *
 * ── لماذا صفحةٌ بذاتها ─────────────────────────────────────────────────────
 * كان النوعُ يُكتب على كلّ كشفٍ على حدة، وأكثرُ العملاء صفتُهم ثابتة. فكتابتُه
 * أربعةً وثلاثين ألفَ مرّةٍ عملٌ مكرَّرٌ يُنسى ويُخطأ، وخطأٌ واحدٌ يُرسل كشفَ
 * عميلٍ ضريبيّ إلى فواتير الكاش.
 *
 * والقاعدةُ الكاملةُ مشروحةٌ في `backend/src/utils/paymentType.js`، وخلاصتُها:
 * اختيارُ اليد على الكشف يغلب كلَّ شيء، ثمّ «طريقة الدفع» القادمةُ من منصّة
 * التشغيل حين تقول نقدًا، ثمّ صفةُ العميل من هذه الصفحة.
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useDialog } from '@/components/system/DialogProvider';
import api from '@/lib/api';
import { useSocket } from '@/hooks/useSocket';
import { Spinner, PageHeader, SearchInput } from '@/components/hr/HRKit';
import ExportMenu, { type ExportColumn } from '@/components/ls2/ExportMenu';
import { Banknote, Receipt, HelpCircle, Wand2, Loader2 } from 'lucide-react';

interface Row {
  _id: string; name: string; code: string; paymentType: '' | 'cash' | 'tax';
  officer: string; department: string;
  reports: number; cashReports: number; taxReports: number;
  manualReports: number; methodCashReports: number; value: number;
}

const WRITE_ROLES = ['super_admin', 'admin', 'operations_manager', 'moderator', 'finance_manager', 'collections_manager'];

export default function PaymentTypesPage() {
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const t = (a: string, e: string) => (ar ? a : e);
  const { notify, confirm } = useDialog();
  const canWrite = WRITE_ROLES.includes(String((user as any)?.role || ''));

  const [rows, setRows] = useState<Row[]>([]);
  const [totals, setTotals] = useState({ customers: 0, cash: 0, tax: 0, none: 0, reports: 0 });
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<'' | 'cash' | 'tax' | 'none'>('');
  const [saving, setSaving] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await api.get<{ rows: Row[]; totals: typeof totals }>('/api/workflows/payment-types');
      setRows(d.rows || []);
      setTotals(d.totals || { customers: 0, cash: 0, tax: 0, none: 0, reports: 0 });
    } catch (e: any) { notify(e?.message || t('تعذّر التحميل', 'Could not load'), 'error'); }
    setLoading(false);
  }, [notify, t]);
  useEffect(() => { load(); }, [load]);
  useSocket('workflow:updated', useCallback(() => { load(); }, [load]));

  const fold = (v: string) => String(v ?? '')
    .replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/[ىئي]/g, 'ي')
    .replace(/\s+/g, ' ').trim().toLowerCase();

  const shown = useMemo(() => {
    const needle = fold(q);
    return rows.filter((r) => {
      if (filter === 'none' ? !!r.paymentType : filter && r.paymentType !== filter) return false;
      if (!needle) return true;
      return fold(r.name).includes(needle) || fold(r.code).includes(needle);
    });
  }, [rows, q, filter]);

  const setType = async (row: Row, paymentType: '' | 'cash' | 'tax') => {
    if (paymentType === row.paymentType) return;
    setSaving(row._id);
    try {
      const r = await api.put<{ changed: number; skippedManual: number }>(
        `/api/workflows/payment-types/${row._id}`, { paymentType, onlyEmpty: true },
      );
      setRows((prev) => prev.map((x) => (x._id === row._id ? { ...x, paymentType } : x)));
      notify(
        r.changed
          ? t(`حُفظ — وسرى على ${r.changed} كشفًا بلا نوع`, `Saved — applied to ${r.changed} reports`)
          : t('حُفظ', 'Saved'),
        'success',
      );
      load();
    } catch (e: any) { notify(e?.message || t('تعذّر الحفظ', 'Could not save'), 'error'); }
    setSaving(null);
  };

  /** تمريرُ القاعدة على كلّ الكشوف بلا نوع — يُعرَض أثرُها قبل تنفيذها. */
  const applyAll = async () => {
    setApplying(true);
    try {
      const p = await api.post<{ wouldChange: number; skippedManual: number; unknown: number; moves: Record<string, number> }>(
        '/api/workflows/payment-types/apply', { preview: true, onlyEmpty: true },
      );
      if (!p.wouldChange) { notify(t('لا كشفَ بلا نوعٍ يمكن ملؤه', 'Nothing to fill'), 'info'); setApplying(false); return; }
      const detail = Object.entries(p.moves || {}).map(([k, v]) => `${k}: ${v}`).join('\n');
      const go = await confirm(
        t(`سيُملأ نوعُ الدفع على ${p.wouldChange} كشفًا بلا نوع.\n\n${detail}\n\nولن يُمَسّ كشفٌ اختار موظّفٌ نوعَه بيده.`,
          `${p.wouldChange} reports will be filled.\n\n${detail}`),
      );
      if (!go) { setApplying(false); return; }
      const r = await api.post<{ changed: number }>('/api/workflows/payment-types/apply', { onlyEmpty: true });
      notify(t(`مُلئ ${r.changed} كشفًا`, `${r.changed} reports filled`), 'success');
      load();
    } catch (e: any) { notify(e?.message || t('تعذّر التطبيق', 'Could not apply'), 'error'); }
    setApplying(false);
  };

  const cols: ExportColumn[] = [
    { header: t('كود الحساب', 'Code'), key: 'code', width: 14 },
    { header: t('العميل', 'Customer'), key: 'name', width: 36 },
    { header: t('نوع الدفع', 'Payment type'), key: 'paymentType', width: 14,
      transform: (v: any) => (v === 'cash' ? t('كاش', 'Cash') : v === 'tax' ? t('ضريبي', 'Tax') : t('بلا نوع', 'Not set')) },
    { header: t('مسؤول التحصيل', 'Officer'), key: 'officer', width: 18 },
    { header: t('الإدارة', 'Department'), key: 'department', width: 16 },
    { header: t('عدد الكشوف', 'Reports'), key: 'reports', width: 12 },
    { header: t('منها كاش', 'Cash reports'), key: 'cashReports', width: 12 },
    { header: t('منها ضريبي', 'Tax reports'), key: 'taxReports', width: 12 },
    { header: t('اختيرت باليد', 'Chosen by hand'), key: 'manualReports', width: 14 },
    { header: t('طريقة دفعها كاش (من المنصّة)', 'Platform says cash'), key: 'methodCashReports', width: 22 },
    { header: t('قيمة البيع', 'Selling value'), key: 'value', width: 16 },
  ];

  if (loading) return <Spinner />;

  const Chip = ({ k, label, n, tone }: { k: '' | 'cash' | 'tax' | 'none'; label: string; n: number; tone: string }) => (
    <button type="button" onClick={() => setFilter(filter === k ? '' : k)}
      className={`px-3 py-1.5 rounded-lg text-[12.5px] font-semibold border transition-colors ${
        filter === k ? 'bg-slate-900 text-white border-slate-900' : `bg-white ${tone} border-slate-200 hover:border-slate-400`}`}>
      {label} <span className="tabular-nums">{n}</span>
    </button>
  );

  return (
    <div className="space-y-4 pb-10" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader
        icon={<Banknote className="w-5 h-5" />}
        title={t('أنواع الدفع', 'Payment types')}
        subtitle={t('صفةُ كلّ عميل — ومنها يُملأ نوعُ الدفع على كشوفه', "Each customer's type — reports inherit it")}
      >
        <ExportMenu fileName="payment-types" lang={ar ? 'ar' : 'en'}
          options={[{ key: 'shown', label: t('تصدير المعروض', 'Export shown'), sheets: [{ name: t('أنواع الدفع', 'Payment types'), rows: shown as any[], columns: cols }] }]} />
        {canWrite && (
          <button type="button" onClick={applyAll} disabled={applying}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#12325c] hover:bg-[#0d2544] text-white text-sm font-semibold disabled:opacity-50">
            {applying ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
            {t('ملء الكشوف بلا نوع', 'Fill untyped reports')}
          </button>
        )}
      </PageHeader>

      {/* ── القاعدةُ مكتوبةٌ حيث تُطبَّق ────────────────────────────────────────
          مَن يفتح الصفحةَ يحتاج أن يعرف لماذا كشفُ عميلٍ ضريبيّ خرج نقديًّا،
          وإلّا بدا النظامُ يخالف ما كُتب فيه. */}
      <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-[12.5px] text-slate-600 leading-relaxed">
        <span className="font-semibold text-slate-800">{t('كيف يُقرَّر نوعُ الكشف؟', 'How a report gets its type')}</span>{' '}
        {t('اختيارُ الموظّف على الكشف يغلب كلَّ شيء. فإن لم يُختَر: متى قالت منصّةُ التشغيل إنّ طريقة دفع الحمولة «كاش» فهي نقديّة ولو كان العميلُ ضريبيًّا — وهو الاستثناء الوحيد. وما عدا ذلك يأخذ صفةَ العميل من هذه الصفحة.',
           "A choice made on the report wins. Otherwise: if the platform says the load is paid cash it is cash even for a taxed customer — the only exception. Everything else takes the customer's type from this page.")}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <SearchInput value={q} onChange={setQ} placeholder={t('ابحث باسم العميل أو الكود…', 'Customer or code…')} />
        <Chip k="cash" label={t('كاش', 'Cash')} n={totals.cash} tone="text-emerald-700" />
        <Chip k="tax" label={t('ضريبي', 'Tax')} n={totals.tax} tone="text-sky-700" />
        <Chip k="none" label={t('بلا نوع', 'Not set')} n={totals.none} tone="text-amber-700" />
        <span className="text-xs text-slate-400 ms-auto tabular-nums">
          {t(`${shown.length} من ${totals.customers} عميلًا · ${totals.reports.toLocaleString()} كشفًا`,
             `${shown.length} of ${totals.customers} customers`)}
        </span>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-900 text-slate-200 text-[12.5px]">
              <tr>
                <th className="px-3 py-3 text-start font-bold whitespace-nowrap">{t('كود الحساب', 'Code')}</th>
                <th className="px-3 py-3 text-start font-bold">{t('العميل', 'Customer')}</th>
                <th className="px-3 py-3 text-start font-bold whitespace-nowrap">{t('نوع الدفع', 'Payment type')}</th>
                <th className="px-3 py-3 text-start font-bold whitespace-nowrap">{t('كشوفه', 'Reports')}</th>
                <th className="px-3 py-3 text-start font-bold whitespace-nowrap">{t('منها كاش / ضريبي', 'cash / tax')}</th>
                <th className="px-3 py-3 text-start font-bold whitespace-nowrap">{t('اختيرت باليد', 'By hand')}</th>
                <th className="px-3 py-3 text-start font-bold whitespace-nowrap">{t('مسؤول التحصيل', 'Officer')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {shown.map((r) => (
                <tr key={r._id} className="hover:bg-slate-50">
                  <td className="px-3 py-2 font-mono text-[12.5px] text-slate-500 whitespace-nowrap" dir="ltr">{r.code || '—'}</td>
                  <td className="px-3 py-2 font-semibold text-slate-900">{r.name}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {canWrite ? (
                      <select
                        value={r.paymentType} disabled={saving === r._id}
                        onChange={(e) => setType(r, e.target.value as '' | 'cash' | 'tax')}
                        aria-label={t('نوع الدفع', 'Payment type')}
                        className={`px-2.5 py-1.5 rounded-lg border text-[12.5px] font-semibold ${
                          r.paymentType === 'cash' ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                            : r.paymentType === 'tax' ? 'bg-sky-50 border-sky-200 text-sky-800'
                              : 'bg-amber-50 border-amber-200 text-amber-800'}`}>
                        <option value="">{t('بلا نوع', 'Not set')}</option>
                        <option value="cash">{t('كاش', 'Cash')}</option>
                        <option value="tax">{t('ضريبي', 'Tax')}</option>
                      </select>
                    ) : (
                      <span className={`px-2 py-0.5 rounded-full text-[11.5px] font-semibold ${
                        r.paymentType === 'cash' ? 'bg-emerald-100 text-emerald-700'
                          : r.paymentType === 'tax' ? 'bg-sky-100 text-sky-700' : 'bg-amber-100 text-amber-700'}`}>
                        {r.paymentType === 'cash' ? t('كاش', 'Cash') : r.paymentType === 'tax' ? t('ضريبي', 'Tax') : t('بلا نوع', 'Not set')}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 tabular-nums text-slate-700">{r.reports.toLocaleString()}</td>
                  <td className="px-3 py-2 tabular-nums text-[12.5px] whitespace-nowrap">
                    <span className="text-emerald-700">{r.cashReports}</span>
                    <span className="text-slate-300 mx-1">/</span>
                    <span className="text-sky-700">{r.taxReports}</span>
                    {r.methodCashReports > 0 && (
                      <span className="ms-2 text-[11px] text-slate-400"
                        title={t('كشوفٌ قالت المنصّةُ إنّ طريقة دفعها كاش — وهي الاستثناء الذي يغلب صفةَ العميل',
                                 'Reports the platform marks as paid cash — the exception that overrides the customer type')}>
                        {t(`المنصّة: ${r.methodCashReports} كاش`, `platform: ${r.methodCashReports} cash`)}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 tabular-nums text-slate-500">
                    {r.manualReports || <span className="text-slate-300">—</span>}
                  </td>
                  <td className="px-3 py-2 text-slate-600 whitespace-nowrap">{r.officer || '—'}</td>
                </tr>
              ))}
              {!shown.length && (
                <tr><td colSpan={7} className="px-3 py-12 text-center text-slate-400">
                  {t('لا عملاءَ مطابقين', 'No matching customers')}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-[12px] text-slate-400 flex items-start gap-1.5 leading-relaxed">
        <HelpCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
        {t('تغييرُ صفةِ عميلٍ هنا يملأ كشوفَه التي لا نوعَ لها، ولا يمسّ كشفًا اختار موظّفٌ نوعَه بيده — تلك واقعةٌ على حمولةٍ بعينها، وهذه صفةٌ عامّة.',
           "Changing a customer's type fills their untyped reports and never touches a report someone typed by hand.")}
      </p>
    </div>
  );
}
