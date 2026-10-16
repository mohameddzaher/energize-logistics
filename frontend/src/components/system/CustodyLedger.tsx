'use client';
/**
 * دفترُ العهدة — الكاش، وكارت المشتريات، والورشة. شاشةٌ واحدةٌ لعهدتين:
 * النقلُ الخفيف (/system/b2c/light-transport/custody) والنقلُ الثقيل
 * (/system/ls2/custody). وما يختلف بينهما يأتي في `cfg`.
 *
 * ثلاثةُ حساباتٍ في أعلى الصفحة، ولكلٍّ واردُه وصادرُه ورصيدُه:
 *   الكاش    واردُه من الكارت أو الورشة أو البنك
 *   الكارت   واردُه من البنك
 *   الورشة   واردُها من الصيانة
 * والصادرُ إلى متحمِّل: مندوبٌ/موظّفٌ (يُكتب رقمُ إقامته فتأتي بياناتُه من
 * الموارد البشريّة) أو الشركة (ويُكتب البيان). والكارتُ والورشةُ يصرفان إلى
 * الكاش أيضًا — وذاك تحويلٌ يُكتب في الحسابين معًا.
 *
 * وعهدةُ النقل الثقيل تزيد السيّارة (`cfg.vehicles`): الواردُ أو الصادرُ يُنسب —
 * اختيارًا — إلى شاحنةٍ من أسطول لوكيشن سوليوشن، تُختار من منسدلةٍ فيها بحث.
 *
 * القواعدُ في الخادم (controllers/custodyLedgerController) وتصل هنا في `rules`:
 * الشاشةُ ترسم ما يُسمَح به ولا تعيد كتابتَه.
 *
 * ونقطةُ الـ API تأتي من الصفحة (`cfg.api`) نصًّا كاملًا هناك لا هنا: منها
 * تُبنى خريطةُ الصفحات والنقاط (scripts/genPageApis)، فلا تُنسَب نقاطُ عهدةٍ
 * إلى صفحة الأخرى.
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useDialog } from '@/components/system/DialogProvider';
import { useSocket } from '@/hooks/useSocket';
import { useLatestRequest } from '@/hooks/useLatestRequest';
import api from '@/lib/api';
import { Spinner, PageHeader, Modal, Field, TextInput, PrimaryButton } from '@/components/hr/HRKit';
import PeriodFilter from '@/components/system/PeriodFilter';
import ExportMenu, { type ExportColumn } from '@/components/ls2/ExportMenu';
import SearchSelect from '@/components/system/SearchSelect';
import ScrollX from '@/components/system/ScrollX';
import { useColumnFilters, ClearColumnFilters } from '@/components/useColumnFilters';
import {
  Paperclip, Pencil, X, Wallet, Banknote, CreditCard, Wrench, ArrowDownLeft, ArrowUpRight, Trash2, Loader2, Search, RotateCcw, UserCheck, AlertTriangle, ArrowLeftRight, Truck,
} from 'lucide-react';

type Account = 'cash' | 'card' | 'workshop';
interface Entry {
  _id: string; account: Account; direction: 'in' | 'out'; amount: number; date: string;
  source?: string; target?: string; repIdNumber?: string; repName?: string; repNationality?: string; repProject?: string;
  detail?: string; transferId?: string | null; createdByName?: string; createdAt?: string;
  attachments?: Attachment[]; editedByName?: string; editedAt?: string | null;
  vehicleUnitId?: number | null; vehiclePlate?: string; vehicleName?: string;
}
interface Attachment { _id: string; title?: string; fileUrl: string; fileName?: string }
interface Bal { in: number; out: number; balance: number; count: number }
interface Payload {
  entries: Entry[]; balances: Record<Account, Bal>; shown: { in: number; out: number; net: number; count: number };
  rules: { inSources: Record<Account, string[]>; toCash: Account[]; vehicles?: boolean }; canDelete: boolean; canEdit: boolean; today: string;
}
interface Vehicle { unitId: number; plate: string; name: string; driver: string }
type Pair = [string, string];
export interface CustodyConfig {
  /** نقطةُ الـ API — تُكتب نصًّا كاملًا في الصفحة نفسِها (light-transport/custody أو ls2/custody). */
  api: string;
  /** بثُّ التغيير من الخادم. */
  event: string;
  title: Pair;
  /** مطابقةٌ لحارس المسار في الخادم (`CUSTODY_ROLES`). العهدةُ مالٌ لا تُفتَح بمنح القسم. */
  roles: string[];
  exportPrefix: string;
  /** المتحمِّلُ برقم الهويّة: «مندوب» في الخفيف، «موظف / سائق» في الثقيل. */
  rep: Pair;
  repMissing: Pair;
  /** السيّارةُ من أسطول لوكيشن سوليوشن على كلّ وارد/صادر — اختياريّة. */
  vehicles?: boolean;
}
interface Rep { idNumber: string; name: string; nationality: string; project: string; jobTitle: string; employeeNumber: string; status: string; inHr: boolean }

const ACCOUNTS: { key: Account; ar: string; en: string; Icon: any; tone: string }[] = [
  { key: 'cash', ar: 'الكاش', en: 'Cash', Icon: Banknote, tone: 'emerald' },
  { key: 'card', ar: 'الكارت (كارت المشتريات)', en: 'Purchases card', Icon: CreditCard, tone: 'sky' },
  { key: 'workshop', ar: 'الورشة', en: 'Workshop', Icon: Wrench, tone: 'amber' },
];
const WORD: Record<string, [string, string]> = {
  cash: ['الكاش', 'Cash'], card: ['الكارت', 'Card'], workshop: ['الورشة', 'Workshop'],
  bank: ['البنك', 'Bank'], maintenance: ['الصيانة', 'Maintenance'], company: ['الشركة', 'Company'], opening: ['رصيد افتتاحي', 'Opening balance'],
};
const money = (n?: number) => (Math.round((Number(n) || 0) * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: 2 });
const fmt = (d?: string) => (d ? d.slice(0, 10).split('-').reverse().join('/') : '—');
const carLabel = (v: { plate?: string; name?: string; vehiclePlate?: string; vehicleName?: string }) => (v.plate ?? v.vehiclePlate) || (v.name ?? v.vehicleName) || '';

export default function CustodyLedger({ cfg }: { cfg: CustodyConfig }) {
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const t = (a: string, e: string) => (ar ? a : e);
  const w = (k?: string) => (k === 'rep' ? (ar ? cfg.rep[0] : cfg.rep[1]) : k && WORD[k] ? (ar ? WORD[k][0] : WORD[k][1]) : (k || ''));
  const { notify, confirm } = useDialog();
  // يطابق حارسَ المسار في الخادم (`CUSTODY_ROLES`). وتعديلُ قيدٍ مسجَّلٍ وحذفُه يقرّرهما
  // الخادم (`canEdit` / `canDelete` في الجواب) لمدير النظام وأهل المال وحدَهم.
  // role-only: العهدةُ مالٌ لا تُفتَح بمنح القسم؛ الخادمُ يحرسها بـ`authorize.strict`.
  const canEdit = cfg.roles.includes(user?.role || '');
  const { api: API } = cfg;

  const [d, setD] = useState<Payload | null>(null);
  // كلُّ القيود في الحسابات الثلاثة بلا فلتر — لتصدير «الكلّ».
  const [all, setAll] = useState<Entry[]>([]);
  const [account, setAccount] = useState<Account>('cash');
  const EMPTY = { direction: '', target: '', vehicle: '', from: '', to: '', q: '' };
  const [f, setF] = useState<typeof EMPTY>(EMPTY);
  // سيّاراتُ الأسطول للمنسدلة — مرّةً واحدة.
  const [cars, setCars] = useState<Vehicle[]>([]);
  useEffect(() => {
    if (!cfg.vehicles) return;
    api.get<{ vehicles: Vehicle[] }>(`${API}/vehicles`).then((r) => setCars(r.vehicles || [])).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const carOptions = useMemo(() => cars.map((v) => ({ value: String(v.unitId), label: carLabel(v), hint: [v.plate && v.name !== v.plate ? v.name : '', v.driver].filter(Boolean).join(' · ') })), [cars]);
  const [form, setForm] = useState<{ direction: 'in' | 'out'; entry?: Entry } | null>(null);
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
      const r = await api.get<Payload>(`${API}?${qs}`);
      if (isCurrent(token)) setD(r);
      api.get<Payload>(API).then((x) => setAll(x.entries || [])).catch(() => {});
    } catch (e: any) { if (isCurrent(token)) notify(e?.message || t('تعذّر التحميل', 'Could not load'), 'error'); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qs]);
  useEffect(() => { load(); }, [load]);
  useSocket(cfg.event, load);

  // من أين / إلى أين — كما تُقرأ في الجدول والتصدير.
  const party = useCallback((e: Entry) => {
    if (e.source === 'opening') return w('opening');
    if (e.source === 'rep') return `${ar ? 'من' : 'From'} ${w('rep')}: ${e.repName || ''}`;
    if (e.direction === 'in') return `${ar ? 'من' : 'From'} ${w(e.source)}`;
    if (e.target === 'rep') return `${w('rep')}: ${e.repName || ''}`;
    if (e.target === 'company') return ar ? 'الشركة' : 'Company';
    return `${ar ? 'إلى' : 'To'} ${w(e.target)}`;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ar]);

  if (!d) return <Spinner />;
  const getters: Record<string, (e: Entry) => any> = {
    date: (e) => e.date, month: (e) => e.date.slice(0, 7),
    direction: (e) => (e.direction === 'in' ? t('وارد', 'In') : t('صادر', 'Out')),
    party, detail: (e) => e.detail || '', by: (e) => e.createdByName || '', vehicle: (e) => carLabel(e) || '—',
  };
  const rows = cf.apply(d.entries, getters);
  const active = [f.direction, f.target, f.vehicle, f.from, f.to, f.q].filter(Boolean).length;
  const cur = ACCOUNTS.find((a) => a.key === account)!;

  const remove = async (e: Entry) => {
    if (!(await confirm({
      title: t('حذف هذا القيد؟', 'Delete this entry?'),
      message: e.transferId
        ? t('هذا تحويلٌ بين حسابين — يُحذَف طرفاه معًا ويعود الرصيدان كما كانا.', 'This is a transfer between two accounts — both sides are removed.')
        : t('يُحذَف القيدُ ويتغيّر رصيدُ الحساب. يُقيَّد الحذفُ باسمك.', 'The entry is removed and the balance changes. Recorded under your name.'),
      confirmLabel: t('حذف', 'Delete'), tone: 'danger',
    }))) return;
    try { await api.delete(`${API}/${e._id}`); notify(t('حُذف القيد', 'Deleted'), 'success'); load(); }
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
    ...(cfg.vehicles ? [{ header: t('السيارة', 'Vehicle'), key: '_vehicle', width: 18, transform: (v: any) => v || '—' }] : []),
    { header: t('البيان', 'Detail'), key: 'detail', width: 34, transform: (v) => v || '—' },
    { header: t('المرفقات', 'Files'), key: 'attachments', width: 10, transform: (v) => (Array.isArray(v) && v.length ? v.length : '') },
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
        title={ar ? cfg.title[0] : cfg.title[1]}
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
          list={[['rep', w('rep')], ['company', t('الشركة', 'Company')], ...(account !== 'cash' ? [['cash', t('إلى الكاش', 'To cash')] as [string, string]] : [])]} />
        {cfg.vehicles && (
          <SearchSelect className="w-56" ar={ar} value={f.vehicle} onChange={(v) => setF((p) => ({ ...p, vehicle: v }))}
            options={carOptions} allLabel={t('كلّ السيارات', 'All vehicles')} />
        )}
        <PeriodFilter ar={ar} from={f.from} to={f.to} onChange={(a, b) => setF((p) => ({ ...p, from: a, to: b }))} />
        <div className="relative">
          <Search className="absolute start-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <input value={f.q} onChange={(e) => setF((p) => ({ ...p, q: e.target.value }))} placeholder={cfg.vehicles ? t('الاسم، رقم الإقامة، اللوحة، البيان…', 'Name, ID no., plate, detail…') : t('اسم المندوب، رقم الإقامة، البيان…', 'Rep name, ID no., detail…')}
            className="w-64 rounded-lg border border-slate-200 bg-white py-2 pe-2 ps-8 text-[13px] focus:outline-none focus:ring-2 focus:ring-[#f37121]/40" />
        </div>
        {active > 0 && (
          <button type="button" onClick={() => setF(EMPTY)}
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
            <ExportMenu fileName={`${cfg.exportPrefix}-${account}`} lang={ar ? 'ar' : 'en'} variant="subtle"
              options={[
                { key: 'shown', label: t('المعروض حاليًا (بعد الفلتر)', 'Current view (filtered)'), sheets: [{ name: ar ? cur.ar : cur.en, rows: rows.map((e) => ({ ...e, _party: party(e), _vehicle: carLabel(e) })), columns: exportCols }] },
                { key: 'account', label: t(`كلُّ قيود ${ar ? cur.ar : cur.en}`, `All ${cur.en} entries`), sheets: [{ name: ar ? cur.ar : cur.en, rows: all.filter((e) => e.account === account).map((e) => ({ ...e, _party: party(e), _vehicle: carLabel(e) })), columns: exportCols }], disabled: !all.length },
                // ورقةٌ لكلّ حساب — الدفترُ كلُّه في ملفٍّ واحد.
                { key: 'all', label: t('الكلّ — الحساباتُ الثلاثة', 'Everything — all three accounts'), sheets: ACCOUNTS.map((a) => ({ name: ar ? WORD[a.key][0] : a.en, rows: all.filter((e) => e.account === a.key).map((e) => ({ ...e, _party: party(e), _vehicle: carLabel(e) })), columns: exportCols })), disabled: !all.length },
              ]} />
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
                {cfg.vehicles && th('vehicle', t('السيارة', 'Vehicle'))}
                {th('detail', t('البيان', 'Detail'))}
                {th('by', t('سجّله', 'Recorded by'))}
                <th className="px-3 py-2.5 text-start font-semibold">{t('المرفقات', 'Files')}</th>
                {(d.canDelete || d.canEdit) && <th className="px-3 py-2.5" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.length === 0 ? (
                <tr><td colSpan={cfg.vehicles ? 9 : 8} className="py-12 text-center text-slate-400">{t('لا قيودَ في هذا العرض.', 'No entries in this view.')}</td></tr>
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
                    {(e.target === 'rep' || e.source === 'rep') && (
                      <span className="block text-[11.5px] text-slate-500">
                        <bdi>{e.repIdNumber}</bdi>{e.repNationality ? ` · ${e.repNationality}` : ''}{e.repProject ? ` · ${e.repProject}` : ''}
                      </span>
                    )}
                  </td>
                  {cfg.vehicles && (
                    <td className="whitespace-nowrap px-3 py-2.5 text-slate-700">
                      {carLabel(e) ? <span className="inline-flex items-center gap-1"><Truck className="h-3.5 w-3.5 text-slate-400" /><bdi>{carLabel(e)}</bdi></span> : <span className="text-slate-300">—</span>}
                    </td>
                  )}
                  <td className="max-w-[20rem] truncate px-3 py-2.5 text-slate-600" title={e.detail || ''}>{e.detail || '—'}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-slate-500">{e.createdByName || '—'}</td>
                  <td className="px-3 py-2.5">
                    {(e.attachments || []).length ? (
                      <span className="flex flex-wrap gap-1">
                        {(e.attachments || []).map((a) => (
                          <a key={a._id} href={a.fileUrl} target="_blank" rel="noreferrer" title={a.fileName || a.title}
                            className="inline-flex max-w-[9rem] items-center gap-1 truncate rounded-md bg-slate-100 px-1.5 py-0.5 text-[11.5px] font-semibold text-[#12325c] hover:bg-slate-200">
                            <Paperclip className="h-3 w-3 shrink-0" /><span className="truncate">{a.title || a.fileName}</span>
                          </a>
                        ))}
                      </span>
                    ) : <span className="text-slate-300">—</span>}
                  </td>
                  {(d.canDelete || d.canEdit) && (
                    <td className="whitespace-nowrap px-3 py-2.5 text-end">
                      {d.canEdit && e.source !== 'opening' && (
                        <button type="button" onClick={() => setForm({ direction: e.direction, entry: e })} title={t('تعديل القيد', 'Edit entry')} className="p-1 text-slate-300 hover:text-[#f37121]">
                          <Pencil className="h-4 w-4" />
                        </button>
                      )}
                      {d.canDelete && (
                        <button type="button" onClick={() => remove(e)} title={t('حذف القيد', 'Delete entry')} className="p-1 text-slate-300 hover:text-red-600">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollX>
      </div>

      {form && (
        <EntryForm cfg={cfg} carOptions={carOptions} key={form.entry?._id || 'new'} entry={form.entry} account={form.entry?.account || account} direction={form.direction} rules={d.rules} today={d.today} ar={ar}
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

/** الملفُّ يُرسَل نصًّا (base64) في الطلب نفسِه — كبقيّة مرفقات النظام. */
const readAsDataUrl = (file: File) => new Promise<string>((resolve, reject) => {
  const r = new FileReader(); r.onload = () => resolve(String(r.result)); r.onerror = () => reject(new Error('read')); r.readAsDataURL(file);
});

/**
 * نموذجُ القيد: واردٌ (من أين) أو صادرٌ (إلى مَن) — بأقلّ ما يُكتب.
 *
 * وبـ`entry` يصير تعديلًا لقيدٍ مسجَّل: يُصحَّح المبلغُ واليومُ والبيانُ والمندوبُ
 * والمرفقات. ونوعُ القيد لا يتغيّر — ما كُتب في غير موضعه يُحذَف ويُكتب من جديد.
 */
function EntryForm({ cfg, carOptions, account, direction, rules, today, ar, onClose, onSaved, notify, entry }: {
  cfg: CustodyConfig; carOptions: { value: string; label: string; hint?: string }[];
  account: Account; direction: 'in' | 'out'; rules: Payload['rules']; today: string; ar: boolean;
  onClose: () => void; onSaved: () => void; notify: (m: string, tone?: any) => void; entry?: Entry;
}) {
  const t = (a: string, e: string) => (ar ? a : e);
  const w = (k: string) => (k === 'rep' ? (ar ? cfg.rep[0] : cfg.rep[1]) : WORD[k] ? (ar ? WORD[k][0] : WORD[k][1]) : k);
  const API = cfg.api;
  const isIn = direction === 'in';
  const editing = !!entry;
  const sources = rules.inSources[account];
  const targets: string[] = ['rep', 'company', ...(rules.toCash.includes(account) ? ['cash'] : [])];
  const [amount, setAmount] = useState(entry ? String(entry.amount) : '');
  const [date, setDate] = useState(entry?.date || today);
  const [source, setSource] = useState(entry?.source || (sources.length === 1 ? sources[0] : ''));
  const [target, setTarget] = useState(entry?.target || 'rep');
  const [idNumber, setIdNumber] = useState(entry?.repIdNumber || '');
  const [rep, setRep] = useState<Rep | null>(null);
  const [repState, setRepState] = useState<'' | 'loading' | 'missing'>('');
  const [detail, setDetail] = useState(entry?.detail || '');
  const [vehicle, setVehicle] = useState(entry?.vehicleUnitId != null ? String(entry.vehicleUnitId) : '');
  const [files, setFiles] = useState<File[]>([]);
  const [removed, setRemoved] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const accName = ar ? ACCOUNTS.find((a) => a.key === account)!.ar : ACCOUNTS.find((a) => a.key === account)!.en;
  // المندوبُ يُسأل عنه في الصادر إلى مندوب، وفي واردِ الكاش من مندوب.
  const needsRep = isIn ? source === 'rep' : target === 'rep';

  // رقمُ الإقامة يُكتب فتأتي بياناتُ المندوب من الموارد البشريّة — بلا زرّ بحث.
  useEffect(() => {
    const id = idNumber.replace(/\s+/g, '');
    setRep(null);
    if (!needsRep || id.length < 8) { setRepState(''); return undefined; }
    setRepState('loading');
    let live = true;
    const timer = setTimeout(() => {
      api.get<{ rep: Rep }>(`${API}/rep?id=${encodeURIComponent(id)}`)
        .then((r) => { if (live) { setRep(r.rep); setRepState(''); } })
        .catch(() => { if (live) setRepState('missing'); });
    }, 350);
    return () => { live = false; clearTimeout(timer); };
  }, [idNumber, needsRep, API]);

  const save = async () => {
    if (!(Number(amount) > 0)) { notify(t('اكتب المبلغ', 'Enter the amount'), 'error'); return; }
    if (isIn && !source) { notify(t('اختر مصدرَ الوارد', 'Pick where it came from'), 'error'); return; }
    if (needsRep && !rep) { notify(t(`اكتب رقمَ إقامة ${cfg.rep[0]}`, `Enter the ${cfg.rep[1].toLowerCase()}’s ID number`), 'error'); return; }
    if (!isIn && target === 'company' && !detail.trim()) { notify(t('اكتب البيان: ما الصرف؟', 'Enter what it was spent on'), 'error'); return; }
    setSaving(true);
    try {
      const sent = await Promise.all(files.map(async (f) => ({ fileName: f.name, title: f.name.replace(/\.[^.]+$/, ''), dataUrl: await readAsDataUrl(f) })));
      if (editing) {
        await api.put(`${API}/${entry!._id}`, {
          amount: Number(amount), date, detail: detail.trim(), files: sent, removeAttachments: removed,
          ...(needsRep ? { repIdNumber: rep?.idNumber } : {}),
          ...(withCar ? { vehicleUnitId: vehicle } : {}),
        });
      } else {
        await api.post(API, {
          account, direction, amount: Number(amount), date, detail: detail.trim(), files: sent,
          ...(isIn ? { source } : { target }), ...(needsRep ? { repIdNumber: rep?.idNumber } : {}),
          ...(withCar && vehicle ? { vehicleUnitId: vehicle } : {}),
        });
      }
      notify(editing ? t('عُدِّل القيد', 'Entry updated') : t('سُجِّلت الحركة', 'Recorded'), 'success');
      onSaved();
    } catch (e: any) { notify(e?.message || t('تعذّر الحفظ', 'Could not save'), 'error'); }
    setSaving(false);
  };

  const chip = (on: boolean) => `rounded-lg px-3 py-2 text-[13px] font-bold transition-colors ${on ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:ring-slate-300'} disabled:opacity-60`;
  const transfer = isIn ? ['card', 'workshop'].includes(source) : target === 'cash';
  // السيّارةُ على كلّ واردٍ وصادر — إلّا التحويلَ بين حسابين: مالٌ انتقل لا سيّارةَ له.
  const withCar = !!cfg.vehicles && !transfer && !entry?.transferId;
  // المرفقاتُ للصادر (فاتورة، إيصال، صورة تحويل) — ولواردِ المندوب كذلك.
  const canAttach = !isIn || source === 'rep' || (entry?.attachments || []).length > 0;
  const kept = (entry?.attachments || []).filter((a) => !removed.includes(a._id));

  return (
    <Modal open onClose={onClose}
      title={editing ? t(`تعديل قيد — ${accName}`, `Edit entry — ${accName}`) : isIn ? t(`وارد إلى ${accName}`, `In to ${accName}`) : t(`صادر من ${accName}`, `Out from ${accName}`)}
      footer={<>
        <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-slate-500">{t('إلغاء', 'Cancel')}</button>
        <PrimaryButton onClick={save} disabled={saving}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}{editing ? t('حفظ التعديل', 'Save changes') : t('تسجيل', 'Record')}</PrimaryButton>
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
              {sources.map((s) => <button key={s} type="button" disabled={editing} onClick={() => setSource(s)} className={chip(source === s)}>{w(s)}</button>)}
            </div>
          </Field>
        ) : (
          <Field label={t('المتحمِّل *', 'Bearer *')}>
            <div className="flex flex-wrap gap-2">
              {targets.map((k) => (
                <button key={k} type="button" disabled={editing} onClick={() => setTarget(k)} className={chip(target === k)}>
                  {k === 'cash' ? t('إلى الكاش', 'To cash') : w(k)}
                </button>
              ))}
            </div>
          </Field>
        )}
        {editing && <p className="-mt-2 text-[11.5px] text-slate-400">{t('نوعُ القيد لا يُعدَّل — ما كُتب في غير موضعه يُحذَف ويُكتب من جديد.', 'The entry type cannot change — delete and re-enter it instead.')}</p>}

        {needsRep && (
          <Field label={t(`رقم إقامة ${cfg.rep[0]} *`, `${cfg.rep[1]} ID number *`)}>
            <TextInput value={idNumber} onChange={(e) => setIdNumber(e.target.value)} inputMode="numeric" dir="ltr" placeholder="2xxxxxxxxx" />
            {repState === 'loading' && <p className="mt-1.5 flex items-center gap-1.5 text-[12px] text-slate-500"><Loader2 className="h-3.5 w-3.5 animate-spin" />{t('يُبحَث في الموارد البشريّة…', 'Looking up HR…')}</p>}
            {repState === 'missing' && <p className="mt-1.5 flex items-center gap-1.5 text-[12px] font-semibold text-red-600"><AlertTriangle className="h-3.5 w-3.5" />{ar ? cfg.repMissing[0] : cfg.repMissing[1]}</p>}
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

        {transfer ? (
          <p className="flex items-center gap-1.5 rounded-lg bg-slate-50 px-3 py-2 text-[12.5px] text-slate-600">
            <ArrowLeftRight className="h-4 w-4 shrink-0 text-slate-400" />
            {isIn ? t(`تحويل: يُسجَّل صادرًا على ${w(source)} وواردًا على ${accName} بالمبلغ نفسِه.`, `Transfer: recorded as out on ${w(source)} and in on ${accName}.`)
              : t(`تحويل: يُسجَّل صادرًا على ${accName} وواردًا على الكاش بالمبلغ نفسِه.`, `Transfer: recorded as out on ${accName} and in on cash.`)}
          </p>
        ) : null}

        {withCar && (
          <Field label={t('السيارة (اختياري) — من سيارات لوكيشن سوليوشن', 'Vehicle (optional) — from the Location Solutions fleet')}>
            <SearchSelect ar={ar} value={vehicle} onChange={setVehicle} options={carOptions} allLabel={t('بدون سيارة', 'No vehicle')} />
          </Field>
        )}

        <Field label={!isIn && target === 'company' ? t('البيان * — ما الصرف؟', 'Detail * — what was it for?') : t('البيان (اختياري)', 'Detail (optional)')}>
          <TextInput value={detail} onChange={(e) => setDetail(e.target.value)}
            placeholder={!isIn && target === 'company' ? t('مثال: فاتورة كهرباء السكن · صرف مياه · صيانة مكيّف', 'e.g. housing electricity bill · water · AC repair') : ''} />
        </Field>

        {canAttach && (
          <Field label={t('مرفقات (اختياري) — فاتورة، إيصال، صورة تحويل', 'Attachments (optional) — invoice, receipt, transfer slip')}>
            <input type="file" multiple accept="image/*,.pdf,.doc,.docx,.xls,.xlsx"
              onChange={(e) => { const add = Array.from(e.target.files || []); setFiles((p) => [...p, ...add]); e.target.value = ''; }}
              className="block w-full text-[12.5px] text-slate-600 file:me-2 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-[12.5px] file:font-semibold" />
            {(kept.length > 0 || files.length > 0) && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {kept.map((a) => (
                  <span key={a._id} className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-1 text-[12px] text-slate-700">
                    <Paperclip className="h-3 w-3" /><a href={a.fileUrl} target="_blank" rel="noreferrer" className="max-w-[12rem] truncate hover:underline">{a.title || a.fileName}</a>
                    <button type="button" onClick={() => setRemoved((p) => [...p, a._id])} title={t('إزالة', 'Remove')} className="text-slate-400 hover:text-red-600"><X className="h-3 w-3" /></button>
                  </span>
                ))}
                {files.map((f, i) => (
                  <span key={`${f.name}-${i}`} className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-1 text-[12px] text-emerald-800">
                    <Paperclip className="h-3 w-3" /><span className="max-w-[12rem] truncate">{f.name}</span>
                    <button type="button" onClick={() => setFiles((p) => p.filter((_, j) => j !== i))} title={t('إزالة', 'Remove')} className="text-emerald-600 hover:text-red-600"><X className="h-3 w-3" /></button>
                  </span>
                ))}
              </div>
            )}
          </Field>
        )}
      </div>
    </Modal>
  );
}
