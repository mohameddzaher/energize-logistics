'use client';
/**
 * Payment kinds: each customer's attribute in one place
 * The kind used to be written on each statement, yet most customers have a fixed attribute. Writing it 34,000 times is repeated work that gets forgotten and mistyped, and one mistake sends a tax customer's statement to the cash invoices. The full rule is in `backend/src/utils/paymentType.js`: a hand choice on the statement beats everything, then the payment method from the operations platform when it says cash, then the customer's attribute from this page.
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
import ScrollX from '@/components/system/ScrollX';

interface Row {
  _id: string; name: string; code: string; paymentType: '' | 'cash' | 'tax';
  officer: string; department: string;
  reports: number; cashReports: number; taxReports: number;
  manualReports: number; methodCashReports: number; value: number;
  /** Statements whose kind differs from their customer's attribute; shown to be resolved, not flipped automatically. */
  conflicts: number;
}

const WRITE_ROLES = ['super_admin', 'admin', 'it_manager', 'it_specialist', 'operations_manager', 'moderator', 'cfo', 'accounting_manager', 'collections_manager'];

export default function PaymentTypesPage() {
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const t = (a: string, e: string) => (ar ? a : e);
  const { notify, confirm } = useDialog();
  const canWrite = WRITE_ROLES.includes(String((user as any)?.role || ''));

  const [rows, setRows] = useState<Row[]>([]);
  const [totals, setTotals] = useState({ customers: 0, cash: 0, tax: 0, none: 0, reports: 0, conflictCustomers: 0, conflictReports: 0 });
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<'' | 'cash' | 'tax' | 'none' | 'conflict'>('');
  const [saving, setSaving] = useState<string | null>(null);
  const [unifying, setUnifying] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await api.get<{ rows: Row[]; totals: typeof totals }>('/api/workflows/payment-types');
      setRows(d.rows || []);
      setTotals(d.totals || { customers: 0, cash: 0, tax: 0, none: 0, reports: 0, conflictCustomers: 0, conflictReports: 0 });
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
      if (filter === 'conflict') { if (!r.conflicts) return false; }
      else if (filter === 'none' ? !!r.paymentType : filter && r.paymentType !== filter) return false;
      if (!needle) return true;
      return fold(r.name).includes(needle) || fold(r.code).includes(needle);
    });
  }, [rows, q, filter]);

  /**
   * A customer's attribute is saved and applies to their statements
   * Two steps, not one: statements with no kind are filled at once, since that completes rather than changes. Those with a conflicting kind are counted and confirmed first, because flipping them changes where they are invoiced and collected, a decision whose count should be seen before it is taken, not a side effect of a list choice.
   */
  const setType = async (row: Row, paymentType: '' | 'cash' | 'tax') => {
    if (paymentType === row.paymentType) return;
    setSaving(row._id);
    try {
      const r = await api.put<{ changed: number; skippedManual: number; remaining: number }>(
        `/api/workflows/payment-types/${row._id}`, { paymentType, onlyEmpty: true },
      );
      setRows((prev) => prev.map((x) => (x._id === row._id ? { ...x, paymentType } : x)));
      notify(
        r.changed
          ? t(`حُفظ — وسرى على ${r.changed} أمر نقل بلا نوع`, `Saved — applied to ${r.changed} reports`)
          : t('حُفظ', 'Saved'),
        'success',
      );

      if (r.remaining > 0) {
        const goAll = await confirm(t(
          `ولهذا العميل ${r.remaining} أمر نقل بنوعٍ مخالفٍ لصفته الجديدة. أحوّلها كلَّها؟\n\nالتحويل يغيّر أين تُفوتَر هذه أوامر النقل وأين تُحصَّل — وما اختاره موظّفٌ بيده لا يُمسّ على كلّ حال.`,
          `${r.remaining} of this customer's reports carry a different type. Convert them all?\n\nThis changes where those reports are invoiced and collected. Types chosen by hand are never touched.`,
        ));
        if (goAll) {
          const all = await api.put<{ changed: number; skippedManual: number }>(
            `/api/workflows/payment-types/${row._id}`, { paymentType, onlyEmpty: false },
          );
          notify(t(`حُوِّل ${all.changed} أمر نقل${all.skippedManual ? ` · وتُرك ${all.skippedManual} باختيارٍ يدويّ` : ''}`,
                   `Converted ${all.changed} reports${all.skippedManual ? ` · ${all.skippedManual} left as hand-picked` : ''}`), 'success');
        }
      }
      load();
    } catch (e: any) { notify(e?.message || t('تعذّر الحفظ', 'Could not save'), 'error'); }
    setSaving(null);
  };

  /**
   * Unify a customer's statements to its attribute
   * The written kind came from the tax / non-tax column of the follow-up sheet, which is Operations' statement about that load. Overriding it shows the count first and then asks.
   */
  const unify = async (row: Row) => {
    if (!row.conflicts) return;
    const to = row.paymentType === 'cash' ? t('كاش', 'cash') : t('ضريبي', 'tax');
    if (!(await confirm(t(
      `توحيد ${row.conflicts} أمر نقل لـ«${row.name}» على «${to}»؟\n\nهذه أوامر نقل نوعُها مكتوبٌ من شيت المتابعة ويخالف صفة العميل. التوحيد يغيّر أين تُفوتَر وأين تُحصَّل، ولا يمسّ ما اختير باليد ولا ما صدرت له فاتورة.`,
      `Unify ${row.conflicts} reports of “${row.name}” to ${to}?\n\nTheir type came from the follow-up sheet and differs from the customer. This changes where they are invoiced and collected. Hand-picked types and already-invoiced reports are untouched.`,
    )))) return;
    setUnifying(row._id);
    try {
      const r = await api.post<{ changed: number; message?: string }>(`/api/workflows/payment-types/${row._id}/unify`, {});
      notify(r?.message || t(`وُحِّد ${r.changed} أمر نقل`, `Unified ${r.changed} reports`), 'success');
      load();
    } catch (e: any) { notify(e?.message || t('تعذّر التوحيد', 'Could not unify'), 'error'); }
    setUnifying(null);
  };

  /** Run the rule over all statements with no kind; its effect is shown before it runs. */
  const applyAll = async () => {
    setApplying(true);
    try {
      const p = await api.post<{ wouldChange: number; skippedManual: number; unknown: number; moves: Record<string, number> }>(
        '/api/workflows/payment-types/apply', { preview: true, onlyEmpty: true },
      );
      if (!p.wouldChange) { notify(t('لا أمر نقل بلا نوعٍ يمكن ملؤه', 'Nothing to fill'), 'info'); setApplying(false); return; }
      const detail = Object.entries(p.moves || {}).map(([k, v]) => `${k}: ${v}`).join('\n');
      const go = await confirm(
        t(`سيُملأ نوعُ الدفع على ${p.wouldChange} أمر نقل بلا نوع.\n\n${detail}\n\nولن يُمَسّ أمر نقل اختار موظّفٌ نوعَه بيده.`,
          `${p.wouldChange} reports will be filled.\n\n${detail}`),
      );
      if (!go) { setApplying(false); return; }
      const r = await api.post<{ changed: number }>('/api/workflows/payment-types/apply', { onlyEmpty: true });
      notify(t(`مُلئ ${r.changed} أمر نقل`, `${r.changed} reports filled`), 'success');
      load();
    } catch (e: any) { notify(e?.message || t('تعذّر التطبيق', 'Could not apply'), 'error'); }
    setApplying(false);
  };

  const cols: ExportColumn[] = [
    { header: t('كود الحساب', 'Code'), key: 'code', width: 14 },
    { header: t('العميل', 'Customer'), key: 'name', width: 36 },
    { header: t('نوع الدفع', 'Payment type'), key: 'paymentType', width: 14,
      transform: (v: any) => (v === 'cash' ? t('كاش', 'Cash') : v === 'tax' ? t('ضريبي', 'Tax') : t('بلا نوع', 'Not set')) },
    { header: t('الإدارة', 'Department'), key: 'department', width: 16 },
    { header: t('عدد أوامر النقل', 'Reports'), key: 'reports', width: 12 },
    { header: t('منها كاش', 'Cash reports'), key: 'cashReports', width: 12 },
    { header: t('منها ضريبي', 'Tax reports'), key: 'taxReports', width: 12 },
    { header: t('مخالف لصفته', 'Conflicting'), key: 'conflicts', width: 14 },
    { header: t('قيمة البيع', 'Selling value'), key: 'value', width: 16 },
  ];

  if (loading) return <Spinner />;

  const Chip = ({ k, label, n, tone }: { k: '' | 'cash' | 'tax' | 'none' | 'conflict'; label: string; n: number; tone: string }) => (
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
            {t('ملء أوامر النقل بلا نوع', 'Fill untyped reports')}
          </button>
        )}
      </PageHeader>

      {/* The rule is written where it applies Whoever opens the page needs to know why a tax customer's statement came out cash, otherwise the system seems to contradict what is written in it. */}
      <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-[12.5px] text-slate-600 leading-relaxed">
        <span className="font-semibold text-slate-800">{t('كيف يُقرَّر نوعُ الكشف؟', 'How a report gets its type')}</span>{' '}
        {t('اختيارُ الموظّف على أمر النقل يغلب كلَّ شيء. فإن لم يُختَر: متى قالت منصّةُ التشغيل إنّ طريقة دفع الحمولة «كاش» فهي نقديّة ولو كان العميلُ ضريبيًّا — وهو الاستثناء الوحيد. وما عدا ذلك يأخذ صفةَ العميل من هذه الصفحة.',
           "A choice made on the report wins. Otherwise: if the platform says the load is paid cash it is cash even for a taxed customer — the only exception. Everything else takes the customer's type from this page.")}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <SearchInput value={q} onChange={setQ} placeholder={t('ابحث باسم العميل أو الكود…', 'Customer or code…')} />
        <Chip k="cash" label={t('كاش', 'Cash')} n={totals.cash} tone="text-emerald-700" />
        <Chip k="tax" label={t('ضريبي', 'Tax')} n={totals.tax} tone="text-sky-700" />
        <Chip k="none" label={t('بلا نوع', 'Not set')} n={totals.none} tone="text-amber-700" />
        {/* Conflicts are shown to be resolved Transport orders whose kind differs from their customer's attribute are not flipped automatically: the written kind came from the tax / non-tax column of the follow-up sheet, Operations' statement about that exact load. Overriding it is a per-customer decision taken after seeing the count. */}
        {!!totals.conflictCustomers && (
          <Chip k="conflict"
            label={t(`مخالف لصفته · ${totals.conflictReports.toLocaleString()} أمر نقل`,
                     `Conflicting · ${totals.conflictReports.toLocaleString()} reports`)}
            n={totals.conflictCustomers} tone="text-red-700" />
        )}
        <span className="text-xs text-slate-400 ms-auto tabular-nums">
          {t(`${shown.length} من ${totals.customers} عميلًا · ${totals.reports.toLocaleString()} أمر نقل`,
             `${shown.length} of ${totals.customers} customers`)}
        </span>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <ScrollX>
          <table className="w-full text-sm">
            <thead className="bg-slate-900 text-slate-200 text-[12.5px]">
              <tr>
                <th className="px-3 py-3 text-start font-bold whitespace-nowrap">{t('كود الحساب', 'Code')}</th>
                <th className="px-3 py-3 text-start font-bold">{t('العميل', 'Customer')}</th>
                <th className="px-3 py-3 text-start font-bold whitespace-nowrap">{t('نوع الدفع', 'Payment type')}</th>
                <th className="px-3 py-3 text-start font-bold whitespace-nowrap">{t('كشوفه', 'Reports')}</th>
                <th className="px-3 py-3 text-start font-bold whitespace-nowrap">{t('منها كاش / ضريبي', 'cash / tax')}</th>
                <th className="px-3 py-3" />
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
                    {/* Conflicts are shown here Count of this customer's statements whose kind differs from its attribute; resolved with the Unify button. */}
                    {r.conflicts > 0 && (
                      <span className="ms-2 text-[11px] font-semibold text-red-600"
                        title={t('أوامر نقل نوعُها يخالف صفةَ هذا العميل', "Reports whose type differs from this customer's")}>
                        {t(`مخالف: ${r.conflicts}`, `differs: ${r.conflicts}`)}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {canWrite && r.conflicts > 0 && (
                      <button type="button" onClick={() => unify(r)} disabled={unifying === r._id}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-red-50 text-red-700 border border-red-200 text-[11.5px] font-semibold hover:bg-red-100 disabled:opacity-50">
                        {unifying === r._id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />}
                        {t('توحيد', 'Unify')}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {!shown.length && (
                <tr><td colSpan={5} className="px-3 py-12 text-center text-slate-400">
                  {t('لا عملاءَ مطابقين', 'No matching customers')}
                </td></tr>
              )}
            </tbody>
          </table>
        </ScrollX>
      </div>

      <p className="text-[12px] text-slate-400 flex items-start gap-1.5 leading-relaxed">
        <HelpCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
        {t('تغييرُ صفةِ عميلٍ هنا يملأ كشوفَه التي لا نوعَ لها، ولا يمسّ أمر نقل اختار موظّفٌ نوعَه بيده — تلك واقعةٌ على حمولةٍ بعينها، وهذه صفةٌ عامّة.',
           "Changing a customer's type fills their untyped reports and never touches a report someone typed by hand.")}
      </p>
    </div>
  );
}
