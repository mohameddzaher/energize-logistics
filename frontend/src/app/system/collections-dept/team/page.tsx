'use client';
/**
 * إدارةُ الفريق — مَن يتولّى مَن، وكيف يعمل كلٌّ منهم.
 *
 * ── لوحتان في صفحة ─────────────────────────────────────────────────────────
 * الأعلى: تقييمُ الفريق — كم حصّل كلُّ موظّف، وكم بقي عليه، وفي كم يومٍ يُحصِّل
 * في المتوسّط. والأسفل: إسنادُ الحسابات — يختار المديرُ حساباتٍ ويسمّي لها
 * مسؤولًا.
 *
 * وهما في صفحةٍ واحدةٍ عن قصد: القرارُ الذي يُتّخذ بعد قراءة التقييم هو نقلُ
 * حساباتٍ من موظّفٍ إلى آخر، وفصلُهما يجعل المدير يقرأ في شاشةٍ ويتصرّف في
 * أخرى وقد نسي ما قرأ.
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useLanguage } from '@/context/LanguageContext';
import { useAuth } from '@/context/AuthContext';
import api from '@/lib/api';
import { canEditCollections, money, gradeTone, type OfficerStat, type AgingRow } from '@/lib/collections';
import SearchSelect from '@/components/system/SearchSelect';
import { Loader2, Users, Search, UserCog, Check, TrendingUp } from 'lucide-react';

export default function CollectionsTeamPage() {
  const router = useRouter();
  const { lang, isRTL } = useLanguage();
  const { user } = useAuth();
  const ar = lang === 'ar';
  const canEdit = canEditCollections(user);

  const [perf, setPerf] = useState<OfficerStat[]>([]);
  const [team, setTeam] = useState<any[]>([]);
  const [rows, setRows] = useState<AgingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [officerFilter, setOfficerFilter] = useState('');

  /** يفتح سجلَّ العملاء على حسابات موظّفٍ بعينه — أو على ما لا مسؤولَ له. */
  // `hasCode` يُطابق ما تحسبه هذه اللوحة: أصحابُ أكواد الحسابات وحدَهم — وإلّا
  // فُتح صفُّ «بلا مسؤول» على أربعمئةٍ وسبعةٍ وعشرين بدل اثنَي عشر.
  const openAccounts = (officer?: string) =>
    router.push(`/system/collections-dept/customers?officer=${encodeURIComponent(officer || 'none')}&hasCode=true`);

  const [sel, setSel] = useState<Set<string>>(new Set());
  const [assignTo, setAssignTo] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [search, setSearch] = useState('');

  const loadPerf = useCallback(async () => {
    const p = new URLSearchParams();
    if (from) p.append('from', from);
    if (to) p.append('to', to);
    if (officerFilter) p.append('officer', officerFilter);
    const [a, b] = await Promise.all([
      api.get<any>(`/api/collections-dept/ledger/performance?${p.toString()}`),
      api.get<any>('/api/collections-dept/ledger/team'),
    ]);
    setPerf(a.rows || []); setTeam(b.officers || []);
  }, [from, to, officerFilter]);

  const loadRows = useCallback(async () => {
    const p = new URLSearchParams();
    p.append('limit', '500');
    if (search) p.append('search', search);
    if (officerFilter) p.append('officer', officerFilter);
    const d = await api.get<any>(`/api/collections-dept/ledger/aging?${p.toString()}`);
    setRows(d.rows || []);
  }, [search, officerFilter]);

  useEffect(() => { Promise.all([loadPerf(), loadRows()]).finally(() => setLoading(false)); }, [loadPerf, loadRows]);

  const officers = useMemo(() => [...new Set(team.map((t) => t.officer).filter(Boolean))].sort(), [team]);

  const assign = async () => {
    if (!sel.size) return;
    setSaving(true); setMsg('');
    try {
      const r = await api.put<any>('/api/collections-dept/ledger/team/assign', { parties: [...sel], officer: assignTo });
      setMsg(ar ? `نُقل ${r.updated} حسابًا إلى ${assignTo || '(بلا مسؤول)'}` : `${r.updated} accounts moved to ${assignTo || '(unassigned)'}`);
      setSel(new Set());
      await Promise.all([loadPerf(), loadRows()]);
    } catch (e: any) { setMsg(e.message); }
    finally { setSaving(false); }
  };

  if (loading) return <div className="flex items-center justify-center py-24"><Loader2 className="w-6 h-6 animate-spin text-[#f37121]" /></div>;
  const th = 'px-3 py-3 text-start text-xs text-slate-300 font-semibold whitespace-nowrap';

  return (
    <div className="space-y-5" dir={isRTL ? 'rtl' : 'ltr'}>
      <div>
        <h1 className="text-xl font-bold text-slate-900">{ar ? 'الفريق' : 'The team'}</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          {ar ? 'أداءُ كل موظف تحصيل، ومَن يتولّى أي عميل.' : 'How each collection officer is doing, and who handles which customer.'}
        </p>
      </div>

      {/* ── التقييم ────────────────────────────────────────────────────────── */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-slate-200">
          <TrendingUp className="w-4 h-4 text-[#f37121]" />
          <h2 className="text-sm font-semibold text-slate-900">{ar ? 'تقييم الفريق' : 'Team performance'}</h2>
          <div className="flex-1" />
          <input type="date" title={ar ? 'من' : 'From'} value={from} onChange={(e) => setFrom(e.target.value)}
            className="px-3 py-1.5 rounded-lg border border-slate-300 text-sm" />
          <input type="date" title={ar ? 'إلى' : 'To'} value={to} onChange={(e) => setTo(e.target.value)}
            className="px-3 py-1.5 rounded-lg border border-slate-300 text-sm" />
          <div className="w-52">
            <SearchSelect ar={ar} value={officerFilter} onChange={setOfficerFilter}
              allLabel={ar ? 'كل الفريق' : 'Whole team'}
              options={officers.map((o) => ({ value: o, label: o }))} />
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1100px]">
            <thead><tr className="table-head border-b border-slate-200">
              <th className={th}>{ar ? 'الموظف' : 'Officer'}</th>
              <th className={`${th} text-end`}>{ar ? 'حسابات' : 'Accounts'}</th>
              <th className={`${th} text-end`}>{ar ? 'محصَّل' : 'Collected'}</th>
              <th className={`${th} text-end`}>{ar ? 'عدد المحصَّل' : 'Invoices'}</th>
              <th className={`${th} text-end`}>{ar ? 'باقٍ' : 'Outstanding'}</th>
              <th className={`${th} text-end`}>{ar ? 'متأخر' : 'Past due'}</th>
              <th className={`${th} text-end`}>{ar ? 'نسبة التحصيل' : 'Collection rate'}</th>
              <th className={`${th} text-end`}>{ar ? 'متوسط أيام التحصيل' : 'Avg days'}</th>
              <th className={`${th} text-end`}>{ar ? 'المهام' : 'Tasks'}</th>
            </tr></thead>
            <tbody className="divide-y divide-slate-200">
              {perf.map((r) => (
                <tr key={r.officer || '_'} className="hover:bg-slate-50">
                  {/* ── ورقمٌ في لوحةٍ يجب أن يفتح صفوفَه ────────────────────
                      «(بلا مسؤول) ١٢ حسابًا» سطرٌ يُقرأ ولا يُسأل: أيُّ اثنَي
                      عشرَ حسابًا؟ فالاسمُ والعددُ بابٌ إلى الحسابات نفسِها. */}
                  <td className="px-3 py-2.5 text-sm font-medium">
                    <button type="button" onClick={() => openAccounts(r.officer)}
                      className="text-[#f37121] hover:underline font-medium text-start"
                      title={ar ? 'افتح حسابات هذا الموظّف' : 'Open these accounts'}>
                      {r.officer || (ar ? '(بلا مسؤول)' : '(unassigned)')}
                    </button>
                  </td>
                  <td className="px-3 py-2.5 text-sm text-end tabular-nums">
                    <button type="button" onClick={() => openAccounts(r.officer)}
                      className="text-slate-700 hover:text-[#f37121] hover:underline tabular-nums">{r.accounts}</button>
                  </td>
                  <td className="px-3 py-2.5 text-sm text-end tabular-nums text-emerald-700 font-semibold">{money(r.collectedAmount)}</td>
                  <td className="px-3 py-2.5 text-sm text-end tabular-nums text-slate-500">{r.collectedCount}</td>
                  <td className="px-3 py-2.5 text-sm text-end tabular-nums text-slate-900">{money(r.openAmount)}</td>
                  <td className="px-3 py-2.5 text-sm text-end tabular-nums text-red-600">{money(r.overdueAmount)}</td>
                  <td className="px-3 py-2.5 text-sm text-end tabular-nums">
                    {r.collectionRate == null ? <span className="text-slate-300">—</span> : (
                      <span className={r.collectionRate >= 80 ? 'text-emerald-600 font-semibold' : r.collectionRate >= 50 ? 'text-amber-600' : 'text-red-600'}>
                        {Math.round(r.collectionRate)}%
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-sm text-end tabular-nums text-slate-700">{r.avgDaysToCollect ?? '—'}</td>
                  <td className="px-3 py-2.5 text-sm text-end tabular-nums text-slate-500">{r.tasksDone || 0}<span className="text-slate-300">/{r.tasks || 0}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── الإسناد ────────────────────────────────────────────────────────── */}
      {canEdit && (
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
          <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-slate-200">
            <UserCog className="w-4 h-4 text-[#f37121]" />
            <h2 className="text-sm font-semibold text-slate-900">{ar ? 'إسناد الحسابات' : 'Assign accounts'}</h2>
            <div className="relative min-w-[200px]">
              <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder={ar ? 'ابحث عن حساب…' : 'Find an account…'}
                className="w-full ps-9 pe-3 py-1.5 rounded-lg border border-slate-300 text-sm" />
            </div>
            <div className="flex-1" />
            {sel.size > 0 && (
              <>
                <span className="text-xs text-slate-500">{ar ? `${sel.size} محدَّد` : `${sel.size} selected`}</span>
                <input list="collections-officers" value={assignTo} onChange={(e) => setAssignTo(e.target.value)}
                  placeholder={ar ? 'اسم الموظف' : 'Officer name'}
                  className="px-3 py-1.5 rounded-lg border border-slate-300 text-sm" />
                <datalist id="collections-officers">{officers.map((o) => <option key={o} value={o} />)}</datalist>
                <button type="button" onClick={assign} disabled={saving}
                  className="px-3 py-1.5 rounded-lg bg-[#f37121] hover:bg-[#d95f13] text-white text-sm font-medium flex items-center gap-1.5 disabled:opacity-60">
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                  {ar ? 'إسناد' : 'Assign'}
                </button>
              </>
            )}
          </div>
          {msg && <p className="px-4 py-2 text-xs text-emerald-700 bg-emerald-50 border-b border-emerald-100">{msg}</p>}
          <div className="overflow-x-auto max-h-[480px] overflow-y-auto">
            <table className="w-full min-w-[900px]">
              <thead className="sticky top-0"><tr className="table-head border-b border-slate-200">
                <th className={`${th} w-10`}>
                  <input type="checkbox" title={ar ? 'تحديد الكل' : 'Select all'}
                    checked={rows.length > 0 && rows.every((r) => sel.has(r._id))}
                    onChange={(e) => setSel(e.target.checked ? new Set(rows.map((r) => r._id)) : new Set())}
                    className="w-4 h-4 accent-[#f37121]" />
                </th>
                <th className={th}>{ar ? 'الكود' : 'Code'}</th>
                <th className={th}>{ar ? 'الحساب' : 'Account'}</th>
                <th className={th}>{ar ? 'المسؤول الحالي' : 'Current officer'}</th>
                <th className={th}>{ar ? 'التقييم' : 'Grade'}</th>
                <th className={`${th} text-end`}>{ar ? 'المديونية' : 'Outstanding'}</th>
              </tr></thead>
              <tbody className="divide-y divide-slate-200">
                {rows.map((r) => (
                  <tr key={r._id} className={`hover:bg-slate-50 ${sel.has(r._id) ? 'bg-[#f37121]/5' : ''}`}>
                    <td className="px-3 py-2">
                      <input type="checkbox" title={r.name} checked={sel.has(r._id)}
                        onChange={() => setSel((p) => { const n = new Set(p); n.has(r._id) ? n.delete(r._id) : n.add(r._id); return n; })}
                        className="w-4 h-4 accent-[#f37121]" />
                    </td>
                    <td className="px-3 py-2 text-sm font-mono text-slate-600">{r.code}</td>
                    <td className="px-3 py-2 text-sm text-slate-900 max-w-[300px] truncate" title={r.name}>{r.name}</td>
                    <td className="px-3 py-2 text-sm text-slate-700">{r.collectionOfficer || <span className="text-slate-400">—</span>}</td>
                    <td className="px-3 py-2">{r.grade ? <span className={`px-1.5 py-0.5 rounded border text-[11px] font-semibold ${gradeTone(r.grade)}`}>{r.grade}</span> : '—'}</td>
                    <td className="px-3 py-2 text-sm text-end tabular-nums text-slate-900">{money(r.outstanding)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
