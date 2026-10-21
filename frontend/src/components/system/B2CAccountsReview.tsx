'use client';
/**
 * حساباتُ تطبيق التوصيل — مراجعةُ «غير المرتبط».
 *
 * ── لماذا ─────────────────────────────────────────────────────────────────
 * كلُّ حسابٍ على التطبيق (`B2CRep`) يجب أن يكون لرجلٍ في سجلّ النقل الخفيف: به
 * يُعرَض اسمُه من ملفّه في الموارد البشريّة، وتُجمَع طلباتُه له. والربطُ الآليُّ
 * (utils/b2cRepLink) لا يربط إلّا ما لا يلتبس — والباقي يُراجَع هنا بيد القسم:
 * يُربط بصاحبه، أو يُوقَف إن كان صاحبُه قد ترك العمل.
 *
 * و«مقترحٌ إيقافُه» اقتراحٌ يُعرَض لا إيقافٌ يُنفَّذ: لا طلبَ له منذ ستّين يومًا
 * ولا صفَّ له في السجلّ. القرارُ لمن يعرف الرجال.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { useDialog } from '@/components/system/DialogProvider';
import { useSocket } from '@/hooks/useSocket';
import { useLatestRequest } from '@/hooks/useLatestRequest';
import SearchSelect from '@/components/system/SearchSelect';
import { Spinner } from '@/components/hr/HRKit';
import { getLTEmployees } from '@/lib/lightTransport';
import { Link2, PowerOff, Power, Search } from 'lucide-react';

type Rep = {
  _id: string; repId?: string; englishName?: string; arabicName?: string; isActive?: boolean;
  displayName?: string; displayPhone?: string; linkStatus?: 'linked' | 'unlinked';
  person?: { source?: 'hr' | 'lt' | 'account' };
  ltEmployee?: { _id: string; name?: string; idNumber?: string } | null;
  lastOrderDate?: string | null; orderDays?: number; suggestDeactivate?: boolean;
  project?: { name?: string } | null;
};

type Filter = 'unlinked' | 'suggest' | 'linked' | 'all';

export default function B2CAccountsReview({ ar, canEdit }: { ar: boolean; canEdit: boolean }) {
  const t = (a: string, e: string) => (ar ? a : e);
  const { notify, confirm } = useDialog();
  const [rows, setRows] = useState<Rep[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>('unlinked');
  const [q, setQ] = useState('');
  const [lts, setLts] = useState<{ value: string; label: string }[]>([]);
  const [linking, setLinking] = useState<Record<string, string>>({});
  const guard = useLatestRequest();

  const load = useCallback(async () => {
    const linked = filter === 'linked' ? 'true' : filter === 'all' ? '' : 'false';
    const mine = guard.begin();
    try {
      const d = await api.get<{ reps: Rep[] }>(`/api/b2c/reps?review=1${linked ? `&linked=${linked}` : ''}`);
      if (!guard.isCurrent(mine)) return;
      setRows(d.reps || []);
    } catch (e: any) { notify(e?.message || t('تعذّر التحميل', 'Could not load'), 'error'); }
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, guard]);
  useEffect(() => { load(); }, [load]);
  useSocket('b2c:rep:updated', useCallback(() => load(), [load]));

  useEffect(() => {
    if (!canEdit) return;
    getLTEmployees({ limit: '2000' })
      .then((d) => setLts((d.employees || []).map((e: any) => ({ value: e._id, label: `${e.name}${e.idNumber ? ` · ${e.idNumber}` : ''}` }))))
      .catch(() => {});
  }, [canEdit]);

  const shown = useMemo(() => {
    const k = q.trim().toLowerCase();
    return rows
      .filter((r) => filter !== 'suggest' || r.suggestDeactivate)
      .filter((r) => !k || [r.displayName, r.englishName, r.arabicName, r.repId, r.displayPhone]
        .some((v) => String(v || '').toLowerCase().includes(k)));
  }, [rows, filter, q]);

  const save = async (r: Rep, body: Record<string, unknown>, ok: string) => {
    try { await api.put(`/api/b2c/reps/${r._id}`, body); notify(ok, 'success'); load(); }
    catch (e: any) { notify(e?.message || t('تعذّر الحفظ', 'Could not save'), 'error'); }
  };
  const link = (r: Rep) => {
    const lt = linking[r._id];
    if (!lt) return;
    save(r, { ltEmployee: lt }, t('رُبط الحساب بصاحبه', 'Account linked'));
  };
  const toggle = async (r: Rep) => {
    const off = r.isActive !== false;
    const ok = await confirm({
      message: off
        ? t(`يُوقَف حساب «${r.englishName}»؟ تبقى طلباتُه في التاريخ.`, `Deactivate "${r.englishName}"? Its orders stay in the history.`)
        : t(`يُعاد تفعيل حساب «${r.englishName}»؟`, `Reactivate "${r.englishName}"?`),
      tone: off ? 'error' : 'info', confirmLabel: off ? t('إيقاف', 'Deactivate') : t('تفعيل', 'Reactivate'),
    });
    if (ok) save(r, { isActive: !off }, off ? t('أُوقف الحساب', 'Deactivated') : t('فُعّل الحساب', 'Reactivated'));
  };

  const counts = useMemo(() => ({
    suggest: rows.filter((r) => r.suggestDeactivate).length,
  }), [rows]);

  if (loading) return <Spinner />;

  return (
    <div className="space-y-3">
      <p className="text-[12.5px] text-slate-500 leading-relaxed max-w-3xl">
        {t('كلُّ حسابٍ على تطبيق التوصيل يجب أن يكون لرجلٍ في سجلّ النقل الخفيف — به يظهر اسمُه وجوالُه من ملفّه، وتُجمَع طلباتُه له. «غير مرتبط» لم يُعرَف صاحبُه آليًّا: يُربط هنا بيدٍ أو يُوقَف. و«مقترحٌ إيقافُه» لا طلبَ له منذ ستّين يومًا — اقتراحٌ لا إيقاف.',
           'Every delivery-app account should belong to someone in the light-transport register — that is where its name and phone come from, and where its orders add up. “Unlinked” accounts could not be matched automatically: link them by hand or deactivate them. “Suggested” ones have had no orders for 60 days — a suggestion, nothing is deactivated automatically.')}
      </p>
      <div className="flex items-center gap-2 flex-wrap">
        {([['unlinked', 'غير مرتبط', 'Unlinked'], ['suggest', 'مقترحٌ إيقافُه', 'Suggested to deactivate'], ['linked', 'مرتبط', 'Linked'], ['all', 'الكل', 'All']] as [Filter, string, string][])
          .map(([k, a, e]) => (
            <button key={k} type="button" onClick={() => { setLoading(true); setFilter(k); }}
              className={`px-3 py-1.5 rounded-lg text-[12.5px] font-semibold ${filter === k ? 'bg-slate-900 text-white' : 'bg-white border border-slate-200 text-slate-600'}`}>
              {t(a, e)}{k === 'suggest' && filter !== 'linked' && filter !== 'all' ? ` (${counts.suggest})` : ''}
            </button>
          ))}
        <div className="relative ms-auto">
          <Search className="w-4 h-4 text-slate-400 absolute top-2 start-2.5" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('بحث بالاسم أو رقم الحساب', 'Search name or account ID')}
            className="ps-8 pe-3 py-1.5 rounded-lg border border-slate-300 text-sm w-64" />
        </div>
      </div>
      <div className="text-[12px] text-slate-500">{t(`${shown.length} حسابًا`, `${shown.length} accounts`)}</div>
      <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600 text-xs">
            <tr>
              <th className="px-3 py-2 text-start">{t('الحساب على التطبيق', 'App account')}</th>
              <th className="px-3 py-2 text-start">{t('صاحبه', 'Belongs to')}</th>
              <th className="px-3 py-2 text-start">{t('آخر طلب', 'Last order')}</th>
              <th className="px-3 py-2 text-start">{t('أيام العمل', 'Days worked')}</th>
              <th className="px-3 py-2 text-start">{t('الحالة', 'Status')}</th>
              {canEdit && <th className="px-3 py-2 text-start">{t('إجراء', 'Action')}</th>}
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r._id} className={`border-t border-slate-100 ${r.isActive === false ? 'opacity-60' : ''}`}>
                <td className="px-3 py-2">
                  <div className="font-semibold text-slate-900">{r.englishName || '—'}</div>
                  <div className="text-[11.5px] text-slate-500">{[r.arabicName, r.repId].filter(Boolean).join(' · ')}</div>
                </td>
                <td className="px-3 py-2">
                  {r.linkStatus === 'linked' ? (
                    <div>
                      <div className="text-slate-900">{r.displayName}</div>
                      <div className="text-[11.5px] text-slate-500">
                        {[r.ltEmployee?.idNumber, r.displayPhone].filter(Boolean).join(' · ')}
                        {r.person?.source === 'hr' && <span className="ms-1 px-1 rounded bg-emerald-50 text-emerald-700">{t('من الموارد البشرية', 'from HR')}</span>}
                      </div>
                    </div>
                  ) : (
                    <span className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 text-[11.5px] font-bold">{t('غير مرتبط', 'Unlinked')}</span>
                  )}
                </td>
                <td className="px-3 py-2 font-mono text-slate-700">{r.lastOrderDate || t('لا طلبات', 'none')}</td>
                <td className="px-3 py-2 text-slate-700">{r.orderDays ?? 0}</td>
                <td className="px-3 py-2">
                  {r.isActive === false
                    ? <span className="text-slate-500">{t('موقوف', 'Inactive')}</span>
                    : r.suggestDeactivate
                      ? <span className="px-1.5 py-0.5 rounded bg-red-50 text-red-700 text-[11.5px] font-bold">{t('مقترحٌ إيقافُه', 'Suggest deactivate')}</span>
                      : <span className="text-emerald-700">{t('نشط', 'Active')}</span>}
                </td>
                {canEdit && (
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1.5">
                      {r.linkStatus !== 'linked' && (
                        <>
                          <div className="w-56">
                            <SearchSelect ar={ar} value={linking[r._id] || ''} options={lts}
                              onChange={(v) => setLinking((m) => ({ ...m, [r._id]: v }))}
                              placeholder={t('اختر صاحبه من السجلّ', 'Pick from the register')} />
                          </div>
                          <button type="button" onClick={() => link(r)} disabled={!linking[r._id]} title={t('ربط', 'Link')}
                            className="p-1.5 rounded-lg bg-[#f37121] text-white disabled:opacity-40"><Link2 className="w-4 h-4" /></button>
                        </>
                      )}
                      <button type="button" onClick={() => toggle(r)} title={r.isActive === false ? t('تفعيل', 'Reactivate') : t('إيقاف', 'Deactivate')}
                        className="p-1.5 rounded-lg border border-slate-200 text-slate-600 hover:text-slate-900">
                        {r.isActive === false ? <Power className="w-4 h-4" /> : <PowerOff className="w-4 h-4" />}
                      </button>
                    </div>
                  </td>
                )}
              </tr>
            ))}
            {!shown.length && <tr><td colSpan={canEdit ? 6 : 5} className="text-center text-slate-500 py-10">{t('لا حسابات هنا', 'No accounts here')}</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
