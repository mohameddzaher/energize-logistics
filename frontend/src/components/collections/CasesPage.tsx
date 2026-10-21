'use client';
/**
 * القضايا — العملاءُ الذين عليهم حالةُ خلاف: «تحت التفاوض» أو «قضايا».
 *
 * ── لماذا صفحةٌ لها ─────────────────────────────────────────────────────────
 * كانت حالةُ الخلاف فلترًا في اللوحة وزرًّا على صفّ فاتورة، ولا مكانَ يُسأل فيه:
 * مَن عندنا في القضاء؟ منذ متى؟ وما بيانُ قضيّته؟ وكم عليه؟ فهذه الصفحةُ تجيب.
 *
 * ── العميلُ هو الوحدة ───────────────────────────────────────────────────────
 * الحالةُ صفةُ العميل (`CollectionsParty.issue`) وكلُّ فواتيره تتبعه، فالصفُّ
 * عميل — ومن صار في القضاء يبقى هنا **ولو سُوِّيت فواتيرُه**: القضيّةُ قائمةٌ
 * حتى تُرفَع. والمبالغُ من صفوف الدفتر نفسِها التي تعدّها اللوحة، فالضغطُ على
 * عميلٍ يفتح صفحةَ المديونيّة على فواتيره بحالته، بالعدد والقيمة نفسيهما.
 */
import { useState, useEffect, useCallback, useMemo, useRef, Fragment } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Scale, Handshake, Ban, ChevronDown, ChevronLeft, Search, X, ExternalLink } from 'lucide-react';
import api from '@/lib/api';
import { useLanguage } from '@/context/LanguageContext';
import { useAuth } from '@/context/AuthContext';
import { useDialog } from '@/components/system/DialogProvider';
import { useSocket } from '@/hooks/useSocket';
import { useLatestRequest } from '@/hooks/useLatestRequest';
import { canEditCollections, money, dt } from '@/lib/collections';
import { paymentKindLabel } from '@/lib/paymentKind';
import { PageHeader, Spinner } from '@/components/hr/HRKit';
import ScrollX from '@/components/system/ScrollX';
import ExportMenu from '@/components/ls2/ExportMenu';
import MultiSearchSelect from '@/components/system/MultiSearchSelect';
import { BANDS } from '@/components/collections/ReceivablesTree';
import { receivablesHref, NO_FILTERS, PAY_ORDER, DUE_LABELS } from '@/components/collections/receivablesFilters';

const PATH = '/system/collections-dept/cases';

interface CaseParty {
  party: string; key: string; name: string; code: string;
  state: 'negotiating' | 'legal'; note: string; since: string | null; updatedByName: string;
  officer: string; officerIsDefault?: boolean; creditDays: number; term: number;
  count: number; tax: number; cash: number; value: number; lateValue: number; hardValue: number; oldest: number | null;
  bands: Record<string, number>;
}
interface CasesResp {
  parties: CaseParty[];
  summary: Record<'negotiating' | 'legal', { customers: number; count: number; value: number }>;
  officers: string[];
  manager?: { name: string } | null;
}
interface MiniRow {
  _id: string; invoiceNumber: string; kind: string; source?: string; workflowId?: string; payKind: string;
  total: number; invoiceDate: string | null; deliveryDate: string | null; dueDate: string | null;
  age: number | null; daysLate: number | null; risk: string;
}

const STATE_CLS: Record<string, string> = {
  negotiating: 'bg-sky-50 text-sky-700',
  legal: 'bg-[#7c2d12]/10 text-[#7c2d12]',
};

export default function CasesPage() {
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const t = (a: string, e: string) => (ar ? a : e);
  const router = useRouter();
  const { user } = useAuth();
  const canEdit = canEditCollections(user);
  const { notify, prompt } = useDialog();

  // الفلاترُ في الرابط — كصفحة المديونيّة: تُرسَل وتُحفَظ.
  const searchParams = useSearchParams();
  const qs = searchParams?.toString() || '';
  const params = useMemo(() => new URLSearchParams(qs), [qs]);
  const split = (v: string | null) => (v ? v.split(',').filter(Boolean) : []);
  const state = split(params.get('state'));
  const officer = split(params.get('officer'));
  const pay = split(params.get('pay'));
  const dueState = split(params.get('dueState'));
  const qParam = params.get('q') || '';
  const update = useCallback((k: string, v: string[] | string) => {
    const p = new URLSearchParams(qs);
    const val = Array.isArray(v) ? v.join(',') : v;
    if (val) p.set(k, val); else p.delete(k);
    const s = p.toString();
    router.replace(s ? `${PATH}?${s}` : PATH, { scroll: false });
  }, [qs, router]);

  const [q, setQ] = useState(qParam);
  useEffect(() => { setQ(qParam); }, [qParam]);
  useEffect(() => {
    if (q.trim() === qParam) return undefined;
    const id = setTimeout(() => update('q', q.trim()), 350);
    return () => clearTimeout(id);
  }, [q, qParam, update]);

  const [data, setData] = useState<CasesResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const guard = useLatestRequest();
  const apiQs = useMemo(() => {
    const p = new URLSearchParams(qs);
    return p.toString();
  }, [qs]);
  const load = useCallback(async () => {
    const mine = guard.begin();
    try {
      const d = await api.get<CasesResp>(`/api/collections-dept/receivables/cases?${apiQs}`);
      if (guard.isCurrent(mine)) setData(d);
    } catch (e: any) {
      if (guard.isCurrent(mine)) notify(e?.message || t('تعذّر التحميل', 'Could not load'), 'error');
    }
    if (guard.isCurrent(mine)) setLoading(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiQs, guard]);
  useEffect(() => { load(); }, [load]);

  const tick = useRef<ReturnType<typeof setTimeout> | null>(null);
  const soon = useCallback(() => {
    if (tick.current) clearTimeout(tick.current);
    tick.current = setTimeout(() => { load(); }, 800);
  }, [load]);
  useEffect(() => () => { if (tick.current) clearTimeout(tick.current); }, []);
  useSocket('collections:changed', soon);
  useSocket('collections:party', soon);
  useSocket('workflow:updated', soon);

  // ── فواتيرُ عميلٍ تُفتَح تحت صفّه ────────────────────────────────────────
  const [open, setOpen] = useState<string>('');
  const [mini, setMini] = useState<{ key: string; rows: MiniRow[]; total: number } | null>(null);
  const miniGuard = useLatestRequest();
  const toggle = async (p: CaseParty) => {
    if (open === p.key) { setOpen(''); return; }
    setOpen(p.key); setMini(null);
    const mine = miniGuard.begin();
    try {
      const sp = new URLSearchParams({ parties: p.key, issue: p.state, limit: '50' });
      if (pay.length) sp.set('pay', pay.join(','));
      if (dueState.length) sp.set('dueState', dueState.join(','));
      const d = await api.get<{ rows: MiniRow[]; total: number }>(`/api/collections-dept/receivables/rows?${sp.toString()}`);
      if (miniGuard.isCurrent(mine)) setMini({ key: p.key, rows: d.rows || [], total: d.total || 0 });
    } catch (e: any) {
      if (miniGuard.isCurrent(mine)) notify(e?.message || t('تعذّر التحميل', 'Could not load'), 'error');
    }
  };

  const openReceivables = (p: CaseParty) => router.push(receivablesHref({ ...NO_FILTERS, parties: [p.key], issue: [p.state], pay, dueState }));

  const setIssue = async (p: CaseParty, next: 'none' | 'negotiating' | 'legal') => {
    let note = '';
    if (next !== 'none') {
      const ask = await prompt({
        title: next === 'legal' ? t('قضايا', 'Legal') : t('تحت التفاوض', 'Negotiating'),
        message: next === 'legal'
          ? t(`رقمُ القضيّة أو بيانُها — «${p.name}»`, `Case number or details — “${p.name}”`)
          : t(`ما المتَّفقُ عليه مع «${p.name}»؟`, `What was agreed with “${p.name}”?`),
        defaultValue: p.state === next ? p.note : '',
        confirmLabel: t('حفظ', 'Save'),
      } as any);
      if (!ask || !String(ask).trim()) return;
      note = String(ask).trim();
    }
    setBusy(p.key);
    try {
      await api.put(`/api/collections-dept/parties/${p.party}/issue`, { state: next, note });
      notify(next === 'none' ? t('رُفعت الحالة', 'Cleared') : t('سُجِّلت الحالة', 'Recorded'), 'success');
      await load();
    } catch (e: any) { notify(e?.message || t('تعذّر الحفظ', 'Could not save'), 'error'); }
    setBusy('');
  };

  if (loading && !data) return <Spinner />;
  const parties = data?.parties || [];
  const stateLabel = (s: string) => (s === 'legal' ? t('قضايا', 'Legal') : t('تحت التفاوض', 'Negotiating'));
  const active = state.length + officer.length + pay.length + dueState.length + (qParam ? 1 : 0);
  const total = parties.reduce((a, p) => ({ value: a.value + p.value, count: a.count + p.count, late: a.late + p.lateValue, hard: a.hard + p.hardValue }), { value: 0, count: 0, late: 0, hard: 0 });

  const exportCols = [
    { header: t('العميل', 'Customer'), key: 'name', width: 32 },
    { header: t('الكود', 'Code'), key: 'code', width: 12 },
    { header: t('الحالة', 'State'), key: 'state', width: 14, transform: (v: any) => stateLabel(String(v)) },
    { header: t('البيان', 'Note'), key: 'note', width: 34 },
    { header: t('منذ', 'Since'), key: 'since', width: 14, type: 'date' as const },
    { header: t('سجّلها', 'Recorded by'), key: 'updatedByName', width: 18 },
    { header: t('مسؤول التحصيل', 'Collector'), key: 'officer', width: 18 },
    { header: t('فواتير مفتوحة', 'Open invoices'), key: 'count', width: 10, type: 'number' as const },
    { header: t('المديونية', 'Outstanding'), key: 'value', width: 14, type: 'number' as const },
    { header: t('منها متأخر', 'Of which late'), key: 'lateValue', width: 14, type: 'number' as const },
    { header: t('منها مرتفع الخطورة', 'Of which hard risk'), key: 'hardValue', width: 14, type: 'number' as const },
    { header: t('أقدم عمر (يوم)', 'Oldest (days)'), key: 'oldest', width: 10, type: 'number' as const },
  ];

  return (
    <div className="space-y-4 pb-10" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader
        icon={<Scale className="w-6 h-6 text-[#f37121]" />}
        title={t('القضايا', 'Cases')}
        subtitle={t('العملاءُ تحت التفاوض أو في القضاء — وما عليهم من الدفتر', 'Customers under negotiation or in legal proceedings — and what they owe')}
      >
        <ExportMenu fileName="collections-cases" lang={ar ? 'ar' : 'en'}
          options={[{ key: 'shown', label: t('المعروض', 'Shown'), sheets: [{ name: t('القضايا', 'Cases'), rows: parties, columns: exportCols }] }]} />
      </PageHeader>

      {/* الحالتان — كلٌّ تختار نفسَها فلترًا */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {(['negotiating', 'legal'] as const).map((s) => {
          const n = data?.summary?.[s] || { customers: 0, count: 0, value: 0 };
          const on = state.length === 1 && state[0] === s;
          return (
            <button key={s} type="button" onClick={() => update('state', on ? [] : [s])}
              className={`text-center bg-white border rounded-2xl shadow-[0_1px_2px_rgba(15,23,42,0.04)] px-4 py-4 transition-colors ${on ? 'border-slate-400' : 'border-slate-200 hover:bg-slate-50/60'}`}>
              <p className="text-[12px] font-medium text-slate-500 inline-flex items-center gap-1.5">
                {s === 'legal' ? <Scale className="w-3.5 h-3.5" /> : <Handshake className="w-3.5 h-3.5" />}{stateLabel(s)}
              </p>
              <p className="mt-1 text-[24px] font-bold tabular-nums tracking-tight text-slate-900">{money(n.value)}</p>
              <p className="mt-0.5 text-[11.5px] text-slate-400 tabular-nums">
                {money(n.customers)} {t('عميل', 'customers')} · {money(n.count)} {t('فاتورة مفتوحة', 'open invoices')}
              </p>
            </button>
          );
        })}
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl px-4 py-3 shadow-sm space-y-2.5">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
          <MultiSearchSelect ar={ar} label={t('الحالة', 'State')} value={state} onChange={(v) => update('state', v)} searchable={false}
            options={(['negotiating', 'legal'] as const).map((s) => ({ value: s, label: stateLabel(s), count: data?.summary?.[s]?.customers }))} />
          <MultiSearchSelect ar={ar} label={t('مسؤول التحصيل', 'Collector')} value={officer} onChange={(v) => update('officer', v)}
            options={(data?.officers || []).map((o) => ({ value: o, label: o === data?.manager?.name ? `${o} — ${t('مدير القسم', 'Dept. manager')}` : o }))} />
          <MultiSearchSelect ar={ar} label={t('نوع الدفع', 'Payment type')} value={pay} onChange={(v) => update('pay', v)} searchable={false}
            options={PAY_ORDER.map((k) => ({ value: k, label: paymentKindLabel(k, ar) }))} />
          <MultiSearchSelect ar={ar} label={t('الاستحقاق', 'Due status')} value={dueState} onChange={(v) => update('dueState', v)} searchable={false}
            options={['late', 'noterm', 'within'].map((k) => ({ value: k, label: t(...DUE_LABELS[k]) }))} />
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="relative flex-1 min-w-[220px] max-w-md">
            <Search className="w-4 h-4 text-slate-400 absolute top-1/2 -translate-y-1/2 start-3" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('ابحث باسم العميل أو كوده…', 'Search customer or code…')}
              className="w-full ps-9 pe-3 py-2 rounded-lg border border-slate-200 bg-white text-sm focus:outline-none focus:border-[#f37121]" />
          </div>
          {active > 0 && (
            <button type="button" onClick={() => router.replace(PATH, { scroll: false })}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-slate-400 hover:text-red-600 text-sm">
              <X className="w-4 h-4" />{t(`إزالة الفلاتر (${active})`, `Clear filters (${active})`)}
            </button>
          )}
          <span className="ms-auto text-[12px] text-slate-500 tabular-nums">
            {t(`${parties.length} عميل · ${money(total.value)}`, `${parties.length} customers · ${money(total.value)}`)}
          </span>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
        <ScrollX>
          <table className="w-full text-sm">
            <thead className="table-head">
              <tr>
                <th className="px-2 py-2.5 w-8" />
                <th className="px-3 py-2.5 text-start font-semibold">{t('العميل', 'Customer')}</th>
                <th className="px-3 py-2.5 text-start font-semibold">{t('الحالة', 'State')}</th>
                <th className="px-3 py-2.5 text-start font-semibold">{t('البيان', 'Note')}</th>
                <th className="px-3 py-2.5 text-start font-semibold whitespace-nowrap">{t('منذ', 'Since')}</th>
                <th className="px-3 py-2.5 text-start font-semibold whitespace-nowrap">{t('مسؤول التحصيل', 'Collector')}</th>
                <th className="px-3 py-2.5 text-end font-semibold whitespace-nowrap">{t('فواتير مفتوحة', 'Open')}</th>
                <th className="px-3 py-2.5 text-end font-semibold whitespace-nowrap">{t('المديونية', 'Outstanding')}</th>
                <th className="px-3 py-2.5 text-end font-semibold whitespace-nowrap">{t('منها متأخر', 'Late')}</th>
                <th className="px-3 py-2.5 text-end font-semibold whitespace-nowrap">{t('مرتفع الخطورة', 'Hard risk')}</th>
                <th className="px-3 py-2.5 text-end font-semibold whitespace-nowrap">{t('أقدم عمر', 'Oldest')}</th>
                <th className="px-3 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {!parties.length ? (
                <tr><td colSpan={12} className="px-4 py-12 text-center text-slate-400">
                  {t('لا عملاءَ تحت التفاوض أو في القضايا', 'No customers under negotiation or in legal')}
                </td></tr>
              ) : parties.map((p) => (
                <Fragment key={p.key}>
                  <tr className="border-b border-slate-100 hover:bg-slate-50 cursor-pointer" onClick={() => toggle(p)}>
                    <td className="px-2 py-2.5 text-slate-400">
                      <ChevronDown className={`w-4 h-4 transition-transform ${open === p.key ? '' : (isRTL ? 'rotate-90' : '-rotate-90')}`} />
                    </td>
                    <td className="px-3 py-2.5 max-w-[260px]">
                      <button type="button" onClick={(e) => { e.stopPropagation(); router.push(`/system/collections-dept/parties/${p.party}`); }}
                        className="font-semibold text-slate-800 hover:text-[#f37121] hover:underline text-start truncate block max-w-full" title={p.name}>{p.name}</button>
                      {p.code ? <span className="text-[10px] text-slate-400">{p.code}</span> : null}
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${STATE_CLS[p.state]}`}>{stateLabel(p.state)}</span>
                    </td>
                    <td className="px-3 py-2.5 text-slate-600 max-w-[280px]">
                      <span className="line-clamp-2" title={p.note}>{p.note || '—'}</span>
                      {p.updatedByName ? <span className="text-[10px] text-slate-400">{p.updatedByName}</span> : null}
                    </td>
                    <td className="px-3 py-2.5 tabular-nums text-slate-600 whitespace-nowrap">{dt(p.since)}</td>
                    <td className="px-3 py-2.5 text-slate-600 whitespace-nowrap">
                      {p.officer || '—'}
                      {p.officerIsDefault ? <span className="block text-[10px] text-slate-400">{t('غير مُسنَد', 'unassigned')}</span> : null}
                    </td>
                    <td className="px-3 py-2.5 text-end tabular-nums text-slate-700">{money(p.count)}</td>
                    <td className="px-3 py-2.5 text-end tabular-nums font-semibold text-slate-900">
                      <button type="button" disabled={!p.count} onClick={(e) => { e.stopPropagation(); openReceivables(p); }}
                        className="hover:text-[#f37121] hover:underline disabled:no-underline disabled:text-slate-400"
                        title={t('افتح فواتيره في تفاصيل المديونية', 'Open the invoices in receivables detail')}>{money(p.value)}</button>
                    </td>
                    <td className="px-3 py-2.5 text-end tabular-nums text-slate-600">{money(p.lateValue)}</td>
                    <td className="px-3 py-2.5 text-end tabular-nums text-slate-600">{money(p.hardValue)}</td>
                    <td className="px-3 py-2.5 text-end tabular-nums text-slate-600">{p.oldest == null ? '—' : p.oldest}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                      <span className="inline-flex items-center gap-1">
                        {canEdit && (
                          <>
                            <button type="button" disabled={busy === p.key} title={t('تحت التفاوض', 'Negotiating')} onClick={() => setIssue(p, 'negotiating')}
                              className="p-1 rounded-md border border-slate-200 text-slate-500 hover:text-slate-900 disabled:opacity-40"><Handshake className="w-3.5 h-3.5" /></button>
                            <button type="button" disabled={busy === p.key} title={t('قضايا', 'Legal')} onClick={() => setIssue(p, 'legal')}
                              className="p-1 rounded-md border border-slate-200 text-slate-500 hover:text-slate-900 disabled:opacity-40"><Scale className="w-3.5 h-3.5" /></button>
                            <button type="button" disabled={busy === p.key} title={t('رفعُ الحالة', 'Clear')} onClick={() => setIssue(p, 'none')}
                              className="p-1 rounded-md border border-slate-200 text-slate-400 hover:text-slate-900 disabled:opacity-40"><Ban className="w-3.5 h-3.5" /></button>
                          </>
                        )}
                        <button type="button" disabled={!p.count} onClick={() => openReceivables(p)} title={t('تفاصيل المديونية', 'Receivables detail')}
                          className="p-1 rounded-md border border-slate-200 text-slate-500 hover:text-[#f37121] disabled:opacity-40"><ExternalLink className="w-3.5 h-3.5" /></button>
                      </span>
                    </td>
                  </tr>
                  {open === p.key && (
                    <tr className="bg-slate-50/70 border-b border-slate-100">
                      <td />
                      <td colSpan={11} className="px-3 py-3">
                        {/* شرائحُ العمر لهذا العميل — قيمٌ لا ألوان */}
                        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] text-slate-500 tabular-nums mb-2">
                          {BANDS.map((b) => <span key={b.key}>{t(b.ar, b.en)}: <b className="text-slate-800 font-semibold">{money(p.bands?.[b.key])}</b></span>)}
                          <span>{t('المدّة', 'Term')}: <b className="text-slate-800 font-semibold">{p.term}</b>{!p.creditDays ? ` (${t('افتراضية', 'default')})` : ''}</span>
                        </div>
                        {!mini || mini.key !== p.key ? (
                          <p className="text-[12px] text-slate-400">{t('جارٍ التحميل…', 'Loading…')}</p>
                        ) : !mini.rows.length ? (
                          <p className="text-[12px] text-slate-400">{t('لا فواتير مفتوحة', 'No open invoices')}</p>
                        ) : (
                          <table className="w-full text-[12.5px] bg-white border border-slate-200 rounded-lg overflow-hidden">
                            <thead>
                              <tr className="text-slate-500 border-b border-slate-200">
                                <th className="px-2 py-1.5 text-start font-medium">{t('الرقم', 'Number')}</th>
                                <th className="px-2 py-1.5 text-start font-medium">{t('نوع الدفع', 'Payment type')}</th>
                                <th className="px-2 py-1.5 text-start font-medium">{t('الإصدار', 'Issued')}</th>
                                <th className="px-2 py-1.5 text-start font-medium">{t('التسليم', 'Delivered')}</th>
                                <th className="px-2 py-1.5 text-start font-medium">{t('الاستحقاق', 'Due')}</th>
                                <th className="px-2 py-1.5 text-end font-medium">{t('العمر', 'Age')}</th>
                                <th className="px-2 py-1.5 text-end font-medium">{t('التأخير', 'Late')}</th>
                                <th className="px-2 py-1.5 text-end font-medium">{t('القيمة', 'Value')}</th>
                              </tr>
                            </thead>
                            <tbody>
                              {mini.rows.map((r) => (
                                <tr key={r._id} className="border-b border-slate-100 last:border-0">
                                  <td className="px-2 py-1.5">
                                    <button type="button" className="text-[#f37121] hover:underline font-medium"
                                      onClick={() => {
                                        if (r.kind === 'tax') router.push(`/system/collections-dept/invoices/tax/${encodeURIComponent(r.invoiceNumber)}`);
                                        else if (r.workflowId) router.push(`/system/operations/${r.workflowId}`);
                                      }}>{r.invoiceNumber}</button>
                                  </td>
                                  <td className="px-2 py-1.5 text-slate-600">{paymentKindLabel(r.payKind, ar)}</td>
                                  <td className="px-2 py-1.5 tabular-nums text-slate-600">{dt(r.invoiceDate)}</td>
                                  <td className="px-2 py-1.5 tabular-nums text-slate-600">{dt(r.deliveryDate)}</td>
                                  <td className="px-2 py-1.5 tabular-nums text-slate-600">{dt(r.dueDate)}</td>
                                  <td className="px-2 py-1.5 text-end tabular-nums">{r.age ?? '—'}</td>
                                  <td className="px-2 py-1.5 text-end tabular-nums">{r.daysLate != null && r.daysLate > 0 ? r.daysLate : '—'}</td>
                                  <td className="px-2 py-1.5 text-end tabular-nums font-semibold">{money(r.total)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                        {mini && mini.key === p.key && mini.total > mini.rows.length && (
                          <button type="button" onClick={() => openReceivables(p)} className="mt-2 text-[12px] text-slate-500 hover:text-[#f37121] inline-flex items-center gap-1">
                            {t(`يُعرَض ${mini.rows.length} من ${mini.total} — افتح الكلّ`, `Showing ${mini.rows.length} of ${mini.total} — open all`)}
                            <ChevronLeft className={`w-3 h-3 ${isRTL ? '' : 'rotate-180'}`} />
                          </button>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
            {!!parties.length && (
              <tfoot>
                <tr className="bg-slate-50 border-t border-slate-200 font-semibold text-slate-800">
                  <td />
                  <td className="px-3 py-2.5" colSpan={5}>{t('المجموع', 'Total')} · <span className="font-normal text-slate-500">{parties.length} {t('عميل', 'customers')}</span></td>
                  <td className="px-3 py-2.5 text-end tabular-nums">{money(total.count)}</td>
                  <td className="px-3 py-2.5 text-end tabular-nums">{money(total.value)}</td>
                  <td className="px-3 py-2.5 text-end tabular-nums">{money(total.late)}</td>
                  <td className="px-3 py-2.5 text-end tabular-nums">{money(total.hard)}</td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            )}
          </table>
        </ScrollX>
      </div>
    </div>
  );
}
