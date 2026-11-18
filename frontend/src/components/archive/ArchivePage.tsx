'use client';
/**
 * Customers archive and vendors archive (backend services/customerArchive).
 * A customer deleted from any section lands here with every section it was in; restoring brings it back everywhere, deleting here is permanent.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Archive, RotateCcw, Trash2, Loader2, Users, Truck } from 'lucide-react';
import api from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import { useDialog } from '@/components/system/DialogProvider';
import { PageHeader, SearchInput, Spinner, ErrorNotice, StatCard } from '@/components/hr/HRKit';
import ExportMenu, { exportScopeLabels, type ExportColumn } from '@/components/ls2/ExportMenu';
import ScrollX from '@/components/system/ScrollX';

type Kind = 'customers' | 'vendors';
interface Row {
  _id: string; name: string; code?: string; phone?: string; email?: string; master?: boolean; reg?: string;
  archivedAt: string; archivedByName?: string; archivedFromAr?: string;
  sections?: { reg: string; ar: string }[]; activity?: Record<string, number>; orders?: number;
}

const TOP = ['super_admin', 'admin', 'it_manager', 'it_team_leader', 'it_specialist', 'business_consultant'];
const PURGE_ROLES = [...TOP, 'cfo', 'moderator', 'operations_manager', 'operations_team_leader', 'vendors_manager', 'vendors_team_leader', 'collections_manager', 'collections_team_leader'];
const ACTIVITY: Record<string, { ar: string; en: string }> = {
  orders: { ar: 'أوامر نقل', en: 'Transport orders' },
  loads: { ar: 'حمولات الأسطول', en: 'Fleet loads' },
  clearances: { ar: 'معاملات تخليص', en: 'Clearances' },
  invoices: { ar: 'فواتير تحصيل', en: 'Invoices' },
};
const fmt = (v: string) => (v ? new Date(v).toLocaleString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
const fold = (s: string) => String(s || '').toLowerCase().replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/\s+/g, ' ').trim();

export default function ArchivePage({ kind }: { kind: Kind }) {
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const t = (a: string, e: string) => (ar ? a : e);
  const { confirm, notify } = useDialog();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState('');
  const base = kind === 'customers' ? '/api/customer-archive' : '/api/vendor-archive';
  // role-only: permanent delete is irreversible; the server uses authorize.strict, which no matrix grant opens.
  const canPurge = PURGE_ROLES.includes(String(user?.role || ''));

  const load = useCallback(async () => {
    try { const d = await api.get<{ rows: Row[] }>(base); setRows(d.rows || []); setError(''); }
    catch (e: any) { setError(e?.message || t('تعذّر التحميل', 'Could not load')); setRows([]); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base]);
  useEffect(() => { load(); }, [load]);
  useSocket(kind === 'customers' ? 'customers:changed' : 'vendors:archive', load);

  const shown = useMemo(() => {
    const f = fold(q);
    return (rows || []).filter((r) => !f || fold(`${r.name} ${r.code || ''} ${r.phone || ''} ${r.archivedByName || ''}`).includes(f));
  }, [rows, q]);

  const qs = (r: Row) => (kind === 'customers' && !r.master && r.reg ? `?reg=${r.reg}` : '');
  const restore = async (r: Row) => {
    setBusy(r._id);
    try { await api.post(`${base}/${r._id}/restore${qs(r)}`, {}); notify(t(`استُعيد «${r.name}» في كلّ الأقسام`, `“${r.name}” restored everywhere`), 'success'); load(); }
    catch (e: any) { notify(e?.message || t('تعذّرت الاستعادة', 'Could not restore'), 'error'); }
    setBusy('');
  };
  const purge = async (r: Row) => {
    const had = Object.entries(r.activity || {}).map(([k, n]) => `${n} ${ACTIVITY[k]?.[ar ? 'ar' : 'en'] || k}`);
    if (kind === 'vendors' && r.orders) had.push(`${r.orders} ${t('أوامر نقل', 'transport orders')}`);
    const ok = await confirm({
      title: t('حذف نهائي', 'Delete for good'),
      message: t(
        `حذف «${r.name}» نهائيًّا من النظام؟ لا يمكن التراجع.${had.length ? ` له ${had.join('، ')} تبقى بأسمائها دون ربطٍ به.` : ''}`,
        `Delete “${r.name}” for good? This cannot be undone.${had.length ? ` Its ${had.join(', ')} keep their names without a link.` : ''}`),
    });
    if (!ok) return;
    setBusy(r._id);
    try { await api.delete(`${base}/${r._id}${qs(r)}`); notify(t('حُذف نهائيًّا', 'Deleted for good'), 'success'); load(); }
    catch (e: any) { notify(e?.message || t('تعذّر الحذف', 'Could not delete'), 'error'); }
    setBusy('');
  };

  const columns: ExportColumn[] = [
    { header: t('الاسم', 'Name'), key: 'name', width: 34 },
    { header: t('الكود', 'Code'), key: 'code', width: 14 },
    { header: t('الجوال', 'Phone'), key: 'phone', width: 16 },
    ...(kind === 'customers' ? [
      { header: t('الأقسام', 'Sections'), key: 'sections', transform: (_: any, r: Row) => (r.sections || []).map((s) => s.ar).join('، '), width: 50 },
      { header: t('المعاملات', 'Activity'), key: 'activity', transform: (_: any, r: Row) => Object.entries(r.activity || {}).map(([k, n]) => `${ACTIVITY[k]?.ar || k}: ${n}`).join('، '), width: 40 },
      { header: t('حُذف من', 'Deleted from'), key: 'archivedFromAr', width: 26 },
    ] : [{ header: t('أوامر النقل', 'Transport orders'), key: 'orders', type: 'number' as const, width: 12 }]),
    { header: t('تاريخ الحذف', 'Deleted on'), key: 'archivedAt', type: 'date', width: 18 },
    { header: t('حذفه', 'Deleted by'), key: 'archivedByName', width: 22 },
  ];
  const L = exportScopeLabels(ar);
  const title = kind === 'customers' ? t('أرشيف العملاء', 'Customers archive') : t('أرشيف الموردين', 'Vendors archive');
  const withActivity = (rows || []).filter((r) => Object.keys(r.activity || {}).length || r.orders).length;

  if (rows === null) return <Spinner />;
  return (
    <div className="space-y-4" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader icon={<Archive className="w-6 h-6 text-[#f37121]" />} title={title}
        subtitle={kind === 'customers'
          ? t('كلّ عميلٍ يُحذف من أيّ قسمٍ ينتقل إلى هنا ويختفي من كلّ القوائم. الاستعادة تعيده إلى كلّ الأقسام، والحذف من هنا نهائي.', 'Customers deleted from any section land here and leave every list. Restoring brings them back everywhere; deleting here is permanent.')
          : t('كلّ مورّدٍ يُحذف ينتقل إلى هنا. الاستعادة تعيده إلى القوائم، والحذف من هنا نهائي.', 'Deleted vendors land here. Restore brings them back; deleting here is permanent.')}>
        <ExportMenu fileName={title} lang={lang} options={[
          { key: 'shown', label: L.shown, sheets: [{ name: title, rows: shown, columns }] },
          { key: 'all', label: L.all, sheets: [{ name: title, rows: rows || [], columns }] },
        ]} />
      </PageHeader>
      {error && <ErrorNotice error={error} lang={ar ? "ar" : "en"} />}
      <div className="grid grid-cols-2 gap-3 sm:max-w-md">
        <StatCard label={t('في الأرشيف', 'Archived')} value={rows.length} />
        <StatCard label={t('لهم معاملات', 'With activity')} value={withActivity} accent="text-amber-600" />
      </div>
      <div className="max-w-md"><SearchInput value={q} onChange={setQ} placeholder={t('ابحث بالاسم أو الكود أو الجوال', 'Search name, code or phone')} /></div>

      {!shown.length ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center text-slate-500">
          {kind === 'customers' ? <Users className="mx-auto mb-2 h-8 w-8 text-slate-300" /> : <Truck className="mx-auto mb-2 h-8 w-8 text-slate-300" />}
          {rows.length ? t('لا نتائج للبحث', 'No matches') : t('الأرشيف فارغ', 'The archive is empty')}
        </div>
      ) : (
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <ScrollX>
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="px-3 py-2.5 text-start font-semibold">{t('الاسم', 'Name')}</th>
                  {kind === 'customers' ? <th className="px-3 py-2.5 text-start font-semibold">{t('كان في', 'Was in')}</th> : <th className="px-3 py-2.5 text-center font-semibold">{t('أوامر النقل', 'Orders')}</th>}
                  {kind === 'customers' && <th className="px-3 py-2.5 text-start font-semibold">{t('المعاملات', 'Activity')}</th>}
                  <th className="px-3 py-2.5 text-start font-semibold">{t('الحذف', 'Deleted')}</th>
                  <th className="px-3 py-2.5 text-end font-semibold">{t('إجراء', 'Action')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {shown.map((r) => (
                  <tr key={r._id} className="hover:bg-slate-50/70 align-top">
                    <td className="px-3 py-2.5">
                      <div className="font-semibold text-slate-900">{r.name}</div>
                      <div className="text-[12px] text-slate-500 tabular-nums">{[r.code, r.phone].filter(Boolean).join(' · ')}</div>
                    </td>
                    {kind === 'customers' ? (
                      <td className="px-3 py-2.5">
                        <div className="flex flex-wrap gap-1">
                          {(r.sections || []).map((s) => <span key={s.reg} className="rounded-full bg-slate-100 px-2 py-0.5 text-[11.5px] font-semibold text-slate-700">{s.ar}</span>)}
                        </div>
                      </td>
                    ) : <td className="px-3 py-2.5 text-center tabular-nums">{r.orders || 0}</td>}
                    {kind === 'customers' && (
                      <td className="px-3 py-2.5 text-[12.5px] text-slate-700">
                        {Object.entries(r.activity || {}).length
                          ? Object.entries(r.activity || {}).map(([k, n]) => <div key={k}><span className="font-bold tabular-nums">{n}</span> {ACTIVITY[k]?.[ar ? 'ar' : 'en'] || k}</div>)
                          : <span className="text-slate-400">{t('لا معاملات', 'None')}</span>}
                      </td>
                    )}
                    <td className="px-3 py-2.5 text-[12.5px]">
                      <div className="tabular-nums text-slate-800">{fmt(r.archivedAt)}</div>
                      <div className="text-slate-500">{[r.archivedByName, r.archivedFromAr && t(`من ${r.archivedFromAr}`, `from ${r.archivedFromAr}`)].filter(Boolean).join(' · ')}</div>
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex justify-end gap-1.5">
                        <button type="button" disabled={busy === r._id} onClick={() => restore(r)}
                          className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-[12.5px] font-bold text-emerald-700 hover:bg-emerald-100 disabled:opacity-50">
                          {busy === r._id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}{t('استعادة', 'Restore')}
                        </button>
                        {canPurge && (
                          <button type="button" disabled={busy === r._id} onClick={() => purge(r)}
                            className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-white px-2.5 py-1.5 text-[12.5px] font-bold text-red-600 hover:bg-red-50 disabled:opacity-50">
                            <Trash2 className="h-3.5 w-3.5" />{t('حذف نهائي', 'Delete for good')}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollX>
        </div>
      )}
    </div>
  );
}
