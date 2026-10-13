'use client';
/**
 * عهدةُ النقل الخفيف — الكاش، وكارت المشتريات، والورشة.
 *
 * ثلاثةُ حساباتٍ في أعلى الصفحة، ولكلٍّ واردُه وصادرُه ورصيدُه:
 *   الكاش    واردُه من الكارت أو الورشة أو البنك
 *   الكارت   واردُه من البنك
 *   الورشة   واردُها من الصيانة
 * والصادرُ إلى متحمِّل: مندوبٌ (يُكتب رقمُ إقامته فتأتي بياناتُه من الموارد
 * البشريّة) أو الشركة (ويُكتب البيان). والكارتُ والورشةُ يصرفان إلى الكاش أيضًا —
 * وذاك تحويلٌ يُكتب في الحسابين معًا.
 *
 * القواعدُ في الخادم (controllers/ltCustodyController) وتصل هنا في `rules`:
 * الشاشةُ ترسم ما يُسمَح به ولا تعيد كتابتَه.
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useDialog } from '@/components/system/DialogProvider';
import { useSocket } from '@/hooks/useSocket';
import { useLatestRequest } from '@/hooks/useLatestRequest';
import api from '@/lib/api';
import { canEditSection } from '@/lib/sections';
import { Spinner, PageHeader, Modal, Field, TextInput, PrimaryButton } from '@/components/hr/HRKit';
import PeriodFilter from '@/components/system/PeriodFilter';
import ExportMenu, { type ExportColumn } from '@/components/ls2/ExportMenu';
import ScrollX from '@/components/system/ScrollX';
import { useColumnFilters, ClearColumnFilters } from '@/components/useColumnFilters';
import {
  Wallet, Banknote, CreditCard, Wrench, ArrowDownLeft, ArrowUpRight, Trash2, Loader2, Search, RotateCcw, UserCheck, AlertTriangle, ArrowLeftRight,
} from 'lucide-react';

type Account = 'cash' | 'card' | 'workshop';
interface Entry {
  _id: string; account: Account; direction: 'in' | 'out'; amount: number; date: string;
  source?: string; target?: string; repIdNumber?: string; repName?: string; repNationality?: string; repProject?: string;
  detail?: string; transferId?: string | null; createdByName?: string; createdAt?: string;
}
interface Bal { in: number; out: number; balance: number; count: number }
interface Payload {
  entries: Entry[]; balances: Record<Account, Bal>; shown: { in: number; out: number; net: number; count: number };
  rules: { inSources: Record<Account, string[]>; toCash: Account[] }; canDelete: boolean; today: string;
}
interface Rep { idNumber: string; name: string; nationality: string; project: string; jobTitle: string; employeeNumber: string; status: string; inHr: boolean }

const ACCOUNTS: { key: Account; ar: string; en: string; Icon: any; tone: string }[] = [
  { key: 'cash', ar: 'الكاش', en: 'Cash', Icon: Banknote, tone: 'emerald' },
  { key: 'card', ar: 'الكارت (كارت المشتريات)', en: 'Purchases card', Icon: CreditCard, tone: 'sky' },
  { key: 'workshop', ar: 'الورشة', en: 'Workshop', Icon: Wrench, tone: 'amber' },
];
const WORD: Record<string, [string, string]> = {
  cash: ['الكاش', 'Cash'], card: ['الكارت', 'Card'], workshop: ['الورشة', 'Workshop'],
  bank: ['البنك', 'Bank'], maintenance: ['الصيانة', 'Maintenance'], rep: ['مندوب', 'Rep'], company: ['الشركة', 'Company'], opening: ['رصيد افتتاحي', 'Opening balance'],
};
const money = (n?: number) => (Math.round((Number(n) || 0) * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: 2 });
const fmt = (d?: string) => (d ? d.slice(0, 10).split('-').reverse().join('/') : '—');

export default function LightCustodyPage() {
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const t = (a: string, e: string) => (ar ? a : e);
  const w = (k?: string) => (k && WORD[k] ? (ar ? WORD[k][0] : WORD[k][1]) : (k || ''));
  const { notify, confirm } = useDialog();
  // يطابق حارسَ المسار في الخادم (EDIT في routes/lightTransport) ومنحَ القسم.
  const canEdit = ['super_admin', 'admin', 'b2c_manager', 'b2c_project_lead', 'it_manager', 'cfo', 'accounting_manager', 'accountant'].includes(user?.role || '')
    || canEditSection((user as any)?.permissions, 'B2C');

  const [d, setD] = useState<Payload | null>(null);
  const [account, setAccount] = useState<Account>('cash');
  const [f, setF] = useState<{ direction: string; target: string; from: string; to: string; q: string }>({ direction: '', target: '', from: '', to: '', q: '' });
  const [form, setForm] = useState<{ direction: 'in' | 'out' } | null>(null);
  const cf = useColumnFilters<Entry>();
  const { begin, isCurrent } = useLatestRequest();

  const qs = useMemo(() => {
    const p = new URLSearchParams({ account });
    Object.entries(f).forEach(([k, v]) => { if (v) p.set(k, v); });
    return p.toString();
  }, [account, f]);
  const load = useCallback(async () => {
    const token = begin();
    try {
      const r = await api.get<Payload>(`/api/light-transport/custody?${qs}`);
      if (isCurrent(token)) setD(r);
    } catch (e: any) { if (isCurrent(token)) notify(e?.message || t('تعذّر التحميل', 'Could not load'), 'error'); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qs]);
  useEffect(() => { load(); }, [load]);
  useSocket('lt:custody', load);

  // من أين / إلى أين — كما تُقرأ في الجدول والتصدير.
  const party = useCallback((e: Entry) => {
    if (e.source === 'opening') return w('opening');
    if (e.direction === 'in') return `${ar ? 'من' : 'From'} ${w(e.source)}`;
    if (e.target === 'rep') return `${ar ? 'مندوب' : 'Rep'}: ${e.repName || ''}`;
    if (e.target === 'company') return ar ? 'الشركة' : 'Company';
    return `${ar ? 'إلى' : 'To'} ${w(e.target)}`;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ar]);

  if (!d) return <Spinner />;
  const getters: Record<string, (e: Entry) => any> = {
    date: (e) => e.date, month: (e) => e.date.slice(0, 7),
    direction: (e) => (e.direction === 'in' ? t('وارد', 'In') : t('صادر', 'Out')),
    party, detail: (e) => e.detail || '', by: (e) => e.createdByName || '',
  };
  const rows = cf.apply(d.entries, getters);
  const active = [f.direction, f.target, f.from, f.to, f.q].filter(Boolean).length;
  const cur = ACCOUNTS.find((a) => a.key === account)!;

  const remove = async (e: Entry) => {
    if (!(await confirm({
      title: t('حذف هذا القيد؟', 'Delete this entry?'),
      message: e.transferId
        ? t('هذا تحويلٌ بين حسابين — يُحذَف طرفاه معًا ويعود الرصيدان كما كانا.', 'This is a transfer between two accounts — both sides are removed.')
        : t('يُحذَف القيدُ ويتغيّر رصيدُ الحساب. يُقيَّد الحذفُ باسمك.', 'The entry is removed and the balance changes. Recorded under your name.'),
      confirmLabel: t('حذف', 'Delete'), tone: 'danger',
    }))) return;
    try { await api.delete(`/api/light-transport/custody/${e._id}`); notify(t('حُذف القيد', 'Deleted'), 'success'); load(); }
    catch (err: any) { notify(err?.message || t('تعذّر الحذف', 'Delete failed'), 'error'); }
  };

  const exportCols: ExportColumn[] = [
    { header: t('التاريخ', 'Date'), key: 'date', width: 13 },
    { header: t('الحساب', 'Account'), key: 'account', width: 12, transform: (v) => w(v) },
    { header: t('الحركة', 'Movement'), key: 'direction', width: 10, transform: (v) => (v === 'in' ? t('وارد', 'In') : t('صادر', 'Out')) },
    { header: t('المبلغ', 'Amount'), key: 'amount', width: 14 },
    { header: t('من / إلى', 'From / to'), key: '_party', width: 30 },
    { header: t('رقم الإقامة', 'ID no.'), key: 'repIdNumber', width: 16, transform: (v) => v || '—' },
    { header: t('الجنسية', 'Nationality'), key: 'repNationality', width: 14, transform: (v) => v || '—' },
    { header: t('المشروع', 'Project'), key: 'repProject', width: 16, transform: (v) => v || '—' },
    { header: t('البيان', 'Detail'), key: 'detail', width: 34, transform: (v) => v || '—' },
    { header: t('سجّله', 'Recorded by'), key: 'createdByName', width: 20 },
  ];

  const th = (k: string, label: string, cls = '') => (
    <th key={k} className={`px-3 py-2.5 text-start font-semibold whitespace-nowrap ${cls}`}>
      <span className="inline-flex items-center gap-1">{label}{cf.header(k, d.entries, getters[k], ar)}</span>
    </th>
  );

  return (
    <div className="space-y-5 pb-10" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader icon={<Wallet className="w-6 h-6 text-[#f37121]" />}
        title={t('عهدة النقل الخفيف', 'Light transport custody')}
        subtitle={t('الكاش وكارت المشتريات والورشة — واردُ كلٍّ وصادرُه ورصيدُه', 'Cash, purchases card and workshop — in, out and balance for each')} />

      {/* ── الحساباتُ الثلاثة بالعرض ───────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {ACCOUNTS.map((a) => {
          const b = d.balances[a.key]; const on = account === a.key;
          return (
            <button key={a.key} type="button" onClick={() => { setAccount(a.key); cf.clear(); }}
              className={`rounded-2xl border bg-white p-4 text-start shadow-sm transition-all ${on ? 'border-[#f37121] ring-2 ring-[#f37121]/30' : 'border-slate-200 hover:border-slate-300'}`}>
              <span className="flex items-center gap-2.5">
                <span className={`flex h-10 w-10 items-center justify-center rounded-xl ${on ? 'bg-[#f37121] text-white' : 'bg-slate-100 text-slate-600'}`}><a.Icon className="h-5 w-5" /></span>
                <span className="text-[14px] font-bold text-slate-900">{ar ? a.ar : a.en}</span>
              </span>
              <span className={`mt-3 block text-2xl font-extrabold tabular-nums ${b.balance < 0 ? 'text-red-600' : 'text-slate-900'}`}>
                {money(b.balance)} <span className="text-[11px] font-semibold text-slate-400">{t('ر.س', 'SAR')}</span>
              </span>
              <span className="mt-1 flex flex-wrap gap-x-3 text-[12px]">
                <span className="text-emerald-700">{t('وارد', 'In')} {money(b.in)}</span>
                <span className="text-[#c2410c]">{t('صادر', 'Out')} {money(b.out)}</span>
              </span>
              {b.balance < 0 && (
                <span className="mt-1 flex items-center gap-1 text-[11.5px] font-semibold text-red-600"><AlertTriangle className="h-3.5 w-3.5" />{t('الصادرُ أكثرُ من الوارد', 'Out exceeds in')}</span>
              )}
            </button>
          );
        })}
      </div>

      {/* ── الواردُ والصادر للحساب المختار ──────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
        <span className="me-1 flex items-center gap-2 text-[13px] font-bold text-slate-800"><cur.Icon className="h-4 w-4 text-[#f37121]" />{ar ? cur.ar : cur.en}</span>
        {canEdit && (
          <>
            <button type="button" onClick={() => setForm({ direction: 'in' })}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-700">
              <ArrowDownLeft className="h-4 w-4" />{t('وارد (In)', 'In')}
            </button>
            <button type="button" onClick={() => setForm({ direction: 'out' })}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#f37121] px-4 py-2 text-sm font-bold text-white hover:bg-[#e06010]">
              <ArrowUpRight className="h-4 w-4" />{t('صادر (Out)', 'Out')}
            </button>
          </>
        )}
        <span className="ms-auto text-[12px] text-slate-500">
          {t('واردُه من:', 'In from:')} {d.rules.inSources[account].map((s) => w(s)).join(t('، ', ', '))}
          {d.rules.toCash.includes(account) ? t(' · ويصرف إلى الكاش', ' · can pay out to cash') : ''}
        </span>
      </div>

      {/* ── الفلاتر ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
        <Sel value={f.direction} onChange={(v) => setF((p) => ({ ...p, direction: v }))} label={t('وارد وصادر', 'In & out')}
          list={[['in', t('وارد', 'In')], ['out', t('صادر', 'Out')]]} />
        <Sel value={f.target} onChange={(v) => setF((p) => ({ ...p, target: v }))} label={t('كلّ المتحمِّلين', 'All bearers')}
          list={[['rep', t('مندوب', 'Rep')], ['company', t('الشركة', 'Company')], ...(account !== 'cash' ? [['cash', t('إلى الكاش', 'To cash')] as [string, string]] : [])]} />
        <PeriodFilter ar={ar} from={f.from} to={f.to} onChange={(a, b) => setF((p) => ({ ...p, from: a, to: b }))} />
        <div className="relative">
          <Search className="absolute start-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <input value={f.q} onChange={(e) => setF((p) => ({ ...p, q: e.target.value }))} placeholder={t('اسم المندوب، رقم الإقامة، البيان…', 'Rep name, ID no., detail…')}
            className="w-64 rounded-lg border border-slate-200 bg-white py-2 pe-2 ps-8 text-[13px] focus:outline-none focus:ring-2 focus:ring-[#f37121]/40" />
        </div>
        {active > 0 && (
          <button type="button" onClick={() => setF({ direction: '', target: '', from: '', to: '', q: '' })}
            className="inline-flex items-center gap-1 rounded-lg bg-[#f37121]/10 px-3 py-2 text-sm font-semibold text-[#f37121] hover:bg-[#f37121]/20">
            <RotateCcw className="h-4 w-4" />{t(`مسح (${active})`, `Clear (${active})`)}
          </button>
        )}
        <ClearColumnFilters count={cf.count} onClear={cf.clear} ar={ar} />
      </div>

      {/* ── القيود ──────────────────────────────────────────────────────────── */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 bg-slate-50 px-4 py-3 text-[13px]">
          <span className="font-bold text-slate-900">{t('قيود', 'Entries')} {ar ? cur.ar : cur.en}</span>
          <span className="rounded-full bg-slate-900 px-2 py-0.5 text-[12px] font-bold tabular-nums text-white">{rows.length}</span>
          <span className="text-emerald-700">{t('وارد المعروض', 'In shown')}: <b className="tabular-nums">{money(rows.filter((e) => e.direction === 'in').reduce((a, e) => a + e.amount, 0))}</b></span>
          <span className="text-[#c2410c]">{t('صادر المعروض', 'Out shown')}: <b className="tabular-nums">{money(rows.filter((e) => e.direction === 'out').reduce((a, e) => a + e.amount, 0))}</b></span>
          <span className="ms-auto">
            <ExportMenu fileName={`light-custody-${account}`} lang={ar ? 'ar' : 'en'} variant="subtle"
              options={[{ key: 'shown', label: t('المعروض', 'Shown'), sheets: [{ name: ar ? cur.ar : cur.en, rows: rows.map((e) => ({ ...e, _party: party(e) })), columns: exportCols }] }]} />
          </span>
        </div>
        <ScrollX className="max-h-[36rem]">
          <table className="w-full min-w-[980px] text-[13px]">
            <thead className="sticky top-0 z-10">
              <tr className="bg-slate-900 text-slate-300">
                {th('month', t('التاريخ', 'Date'))}
                {th('direction', t('الحركة', 'Movement'))}
                <th className="px-3 py-2.5 text-start font-semibold">{t('المبلغ', 'Amount')}</th>
                {th('party', t('من / إلى', 'From / to'))}
                {th('detail', t('البيان', 'Detail'))}
                {th('by', t('سجّله', 'Recorded by'))}
                {d.canDelete && <th className="px-3 py-2.5" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.length === 0 ? (
                <tr><td colSpan={7} className="py-12 text-center text-slate-400">{t('لا قيودَ في هذا العرض.', 'No entries in this view.')}</td></tr>
              ) : rows.map((e) => (
                <tr key={e._id} className="hover:bg-slate-50">
                  <td className="whitespace-nowrap px-3 py-2.5 text-slate-600">{fmt(e.date)}</td>
                  <td className="px-3 py-2.5">
                    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11.5px] font-bold ${e.direction === 'in' ? 'bg-emerald-100 text-emerald-700' : 'bg-orange-100 text-[#c2410c]'}`}>
                      {e.direction === 'in' ? <ArrowDownLeft className="h-3 w-3" /> : <ArrowUpRight className="h-3 w-3" />}
                      {e.direction === 'in' ? t('وارد', 'In') : t('صادر', 'Out')}
                    </span>
                    {e.transferId && <span className="ms-1.5 inline-flex items-center gap-0.5 text-[11px] text-slate-400"><ArrowLeftRight className="h-3 w-3" />{t('تحويل', 'transfer')}</span>}
                  </td>
                  <td className={`whitespace-nowrap px-3 py-2.5 font-bold tabular-nums ${e.direction === 'in' ? 'text-emerald-700' : 'text-[#c2410c]'}`}>{money(e.amount)}</td>
                  <td className="px-3 py-2.5 text-slate-800">
                    <span className="font-semibold">{party(e)}</span>
                    {e.target === 'rep' && (
                      <span className="block text-[11.5px] text-slate-500">
                        <bdi>{e.repIdNumber}</bdi>{e.repNationality ? ` · ${e.repNationality}` : ''}{e.repProject ? ` · ${e.repProject}` : ''}
                      </span>
                    )}
                  </td>
                  <td className="max-w-[20rem] truncate px-3 py-2.5 text-slate-600" title={e.detail || ''}>{e.detail || '—'}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-slate-500">{e.createdByName || '—'}</td>
                  {d.canDelete && (
                    <td className="px-3 py-2.5 text-end">
                      <button type="button" onClick={() => remove(e)} title={t('حذف القيد', 'Delete entry')} className="p-1 text-slate-300 hover:text-red-600">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollX>
      </div>

      {form && (
        <EntryForm account={account} direction={form.direction} rules={d.rules} today={d.today} ar={ar}
          onClose={() => setForm(null)} onSaved={() => { setForm(null); load(); }} notify={notify} />
      )}
    </div>
  );
}

function Sel({ value, onChange, label, list }: { value: string; onChange: (v: string) => void; label: string; list: [string, string][] }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}
      className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#f37121]/40">
      <option value="">{label}</option>
      {list.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  );
}

/** نموذجُ القيد: واردٌ (من أين) أو صادرٌ (إلى مَن) — بأقلّ ما يُكتب. */
function EntryForm({ account, direction, rules, today, ar, onClose, onSaved, notify }: {
  account: Account; direction: 'in' | 'out'; rules: Payload['rules']; today: string; ar: boolean;
  onClose: () => void; onSaved: () => void; notify: (m: string, tone?: any) => void;
}) {
  const t = (a: string, e: string) => (ar ? a : e);
  const w = (k: string) => (WORD[k] ? (ar ? WORD[k][0] : WORD[k][1]) : k);
  const isIn = direction === 'in';
  const sources = rules.inSources[account];
  const targets: string[] = ['rep', 'company', ...(rules.toCash.includes(account) ? ['cash'] : [])];
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(today);
  const [source, setSource] = useState(sources.length === 1 ? sources[0] : '');
  const [target, setTarget] = useState('rep');
  const [idNumber, setIdNumber] = useState('');
  const [rep, setRep] = useState<Rep | null>(null);
  const [repState, setRepState] = useState<'' | 'loading' | 'missing'>('');
  const [detail, setDetail] = useState('');
  const [saving, setSaving] = useState(false);
  const accName = ar ? ACCOUNTS.find((a) => a.key === account)!.ar : ACCOUNTS.find((a) => a.key === account)!.en;

  // رقمُ الإقامة يُكتب فتأتي بياناتُ المندوب من الموارد البشريّة — بلا زرّ بحث.
  useEffect(() => {
    const id = idNumber.replace(/\s+/g, '');
    setRep(null);
    if (isIn || target !== 'rep' || id.length < 8) { setRepState(''); return undefined; }
    setRepState('loading');
    let live = true;
    const timer = setTimeout(() => {
      api.get<{ rep: Rep }>(`/api/light-transport/custody/rep?id=${encodeURIComponent(id)}`)
        .then((r) => { if (live) { setRep(r.rep); setRepState(''); } })
        .catch(() => { if (live) setRepState('missing'); });
    }, 350);
    return () => { live = false; clearTimeout(timer); };
  }, [idNumber, target, isIn]);

  const save = async () => {
    if (!(Number(amount) > 0)) { notify(t('اكتب المبلغ', 'Enter the amount'), 'error'); return; }
    if (isIn && !source) { notify(t('اختر مصدرَ الوارد', 'Pick where it came from'), 'error'); return; }
    if (!isIn && target === 'rep' && !rep) { notify(t('اكتب رقمَ إقامة المندوب', 'Enter the rep’s ID number'), 'error'); return; }
    if (!isIn && target === 'company' && !detail.trim()) { notify(t('اكتب البيان: ما الصرف؟', 'Enter what it was spent on'), 'error'); return; }
    setSaving(true);
    try {
      await api.post('/api/light-transport/custody', {
        account, direction, amount: Number(amount), date, detail: detail.trim(),
        ...(isIn ? { source } : { target, ...(target === 'rep' ? { repIdNumber: rep?.idNumber } : {}) }),
      });
      notify(t('سُجِّلت الحركة', 'Recorded'), 'success');
      onSaved();
    } catch (e: any) { notify(e?.message || t('تعذّر الحفظ', 'Could not save'), 'error'); }
    setSaving(false);
  };

  const chip = (on: boolean) => `rounded-lg px-3 py-2 text-[13px] font-bold transition-colors ${on ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:ring-slate-300'}`;
  const transfer = isIn ? ['card', 'workshop'].includes(source) : target === 'cash';

  return (
    <Modal open onClose={onClose}
      title={isIn ? t(`وارد إلى ${accName}`, `In to ${accName}`) : t(`صادر من ${accName}`, `Out from ${accName}`)}
      footer={<>
        <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-slate-500">{t('إلغاء', 'Cancel')}</button>
        <PrimaryButton onClick={save} disabled={saving}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}{t('تسجيل', 'Record')}</PrimaryButton>
      </>}>
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label={t('المبلغ (ر.س) *', 'Amount (SAR) *')}>
            <TextInput type="number" min={0} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
          </Field>
          <Field label={t('التاريخ', 'Date')}>
            <TextInput type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
        </div>

        {isIn ? (
          <Field label={t('الوارد من *', 'In from *')}>
            <div className="flex flex-wrap gap-2">
              {sources.map((s) => <button key={s} type="button" onClick={() => setSource(s)} className={chip(source === s)}>{w(s)}</button>)}
            </div>
          </Field>
        ) : (
          <>
            <Field label={t('المتحمِّل *', 'Bearer *')}>
              <div className="flex flex-wrap gap-2">
                {targets.map((k) => (
                  <button key={k} type="button" onClick={() => setTarget(k)} className={chip(target === k)}>
                    {k === 'cash' ? t('إلى الكاش', 'To cash') : w(k)}
                  </button>
                ))}
              </div>
            </Field>
            {target === 'rep' && (
              <Field label={t('رقم إقامة المندوب *', 'Rep ID number *')}>
                <TextInput value={idNumber} onChange={(e) => setIdNumber(e.target.value)} inputMode="numeric" dir="ltr" placeholder="2xxxxxxxxx" />
                {repState === 'loading' && <p className="mt-1.5 flex items-center gap-1.5 text-[12px] text-slate-500"><Loader2 className="h-3.5 w-3.5 animate-spin" />{t('يُبحَث في الموارد البشريّة…', 'Looking up HR…')}</p>}
                {repState === 'missing' && <p className="mt-1.5 flex items-center gap-1.5 text-[12px] font-semibold text-red-600"><AlertTriangle className="h-3.5 w-3.5" />{t('لا مندوبَ بهذا الرقم في الموارد البشريّة ولا في سجلّ النقل الخفيف.', 'No rep with this number in HR or the light-transport register.')}</p>}
                {rep && (
                  <div className="mt-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-[13px]">
                    <p className="flex items-center gap-1.5 font-bold text-emerald-900"><UserCheck className="h-4 w-4" />{rep.name}</p>
                    <p className="mt-0.5 text-[12px] text-emerald-900/80">
                      {[rep.nationality && `${t('الجنسية', 'Nationality')}: ${rep.nationality}`, rep.project && `${t('المشروع', 'Project')}: ${rep.project}`,
                        rep.jobTitle, rep.employeeNumber && `${t('الرقم الوظيفي', 'Emp. no.')}: ${rep.employeeNumber}`].filter(Boolean).join(' · ')}
                    </p>
                    {rep.status === 'terminated' && <p className="mt-1 text-[12px] font-semibold text-red-700">{t('تنبيه: منتهي الخدمة في الموارد البشريّة.', 'Note: service ended in HR.')}</p>}
                  </div>
                )}
              </Field>
            )}
          </>
        )}

        {transfer ? (
          <p className="flex items-center gap-1.5 rounded-lg bg-slate-50 px-3 py-2 text-[12.5px] text-slate-600">
            <ArrowLeftRight className="h-4 w-4 shrink-0 text-slate-400" />
            {isIn ? t(`تحويل: يُسجَّل صادرًا على ${w(source)} وواردًا على ${accName} بالمبلغ نفسِه.`, `Transfer: recorded as out on ${w(source)} and in on ${accName}.`)
              : t(`تحويل: يُسجَّل صادرًا على ${accName} وواردًا على الكاش بالمبلغ نفسِه.`, `Transfer: recorded as out on ${accName} and in on cash.`)}
          </p>
        ) : null}

        <Field label={!isIn && target === 'company' ? t('البيان * — ما الصرف؟', 'Detail * — what was it for?') : t('البيان (اختياري)', 'Detail (optional)')}>
          <TextInput value={detail} onChange={(e) => setDetail(e.target.value)}
            placeholder={!isIn && target === 'company' ? t('مثال: فاتورة كهرباء السكن · صرف مياه · صيانة مكيّف', 'e.g. housing electricity bill · water · AC repair') : ''} />
        </Field>
      </div>
    </Modal>
  );
}
