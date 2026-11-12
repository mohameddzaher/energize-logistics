'use client';
/**
 * Demurrage (floor) and container-return deadlines: a header button with a popup listing every open deadline,
 * and a banner for one transaction. Data from GET /api/customs-clearance/deadline-alerts; the countdown ticks locally.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import api from '@/lib/api';
import { useSocket } from '@/hooks/useSocket';
import { Modal } from '@/components/hr/HRKit';
import { useDialog } from '@/components/system/DialogProvider';
import { BellRing, Timer, Anchor, RotateCcw, AlertTriangle, Loader2 } from 'lucide-react';

export type DeadlineAlert = {
  type: 'demurrage' | 'return'; date: string; deadlineAt: string; clearanceId: string; refNumber: string; blNumber: string;
  customerName: string; cargoType: 'containers' | 'vehicles'; units: number; unloadingAppointment: string; demurrageDays?: number;
};

const DAY = 86400000;
const stateOf = (ms: number) => (ms < 0 ? 'overdue' : ms <= DAY ? 'today' : ms <= 3 * DAY ? 'soon' : 'ok');
const TONE: Record<string, string> = {
  overdue: 'bg-red-50 text-red-700 ring-red-200',
  today: 'bg-orange-50 text-orange-700 ring-orange-200',
  soon: 'bg-amber-50 text-amber-800 ring-amber-200',
  ok: 'bg-slate-50 text-slate-600 ring-slate-200',
};

export function countdown(ms: number, ar: boolean) {
  const a = Math.abs(ms);
  const d = Math.floor(a / DAY), h = Math.floor((a % DAY) / 3600000), m = Math.floor((a % 3600000) / 60000);
  const parts = ar
    ? [d && `${d} يوم`, (d || h) && `${h} ساعة`, `${m} دقيقة`]
    : [d && `${d}d`, (d || h) && `${h}h`, `${m}m`];
  const txt = parts.filter(Boolean).join(ar ? ' و' : ' ');
  if (ms < 0) return ar ? `متأخّرة منذ ${txt}` : `Overdue by ${txt}`;
  return ar ? `متبقٍّ ${txt}` : `${txt} left`;
}

export const typeLabel = (t: string, cargo: string, ar: boolean) => (t === 'demurrage'
  ? (ar ? 'موعد الأرضيات' : 'Demurrage date')
  : (ar ? (cargo === 'vehicles' ? 'آخر موعد إرجاع' : 'آخر موعد إرجاع الحاويات') : 'Container return deadline'));

/** Shared feed: refetches on customs events and ticks every 30 s. */
function useDeadlineAlerts() {
  const [items, setItems] = useState<DeadlineAlert[] | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const load = useCallback(() => {
    api.get<{ items: DeadlineAlert[] }>('/api/customs-clearance/deadline-alerts').then((d) => setItems(d.items || [])).catch(() => setItems((x) => x || []));
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(t); }, []);
  useSocket('customs:updated', load);
  useSocket('customs:created', load);
  useSocket('customs:deleted', load);
  return { items, now, reload: load };
}

/** A vehicles transaction's free days, edited in place (the floor date follows on the server). */
function DaysCell({ a, ar }: { a: DeadlineAlert; ar: boolean }) {
  const { notify } = useDialog();
  const [v, setV] = useState(String(a.demurrageDays || 15));
  const [busy, setBusy] = useState(false);
  useEffect(() => { setV(String(a.demurrageDays || 15)); }, [a.demurrageDays]);
  if (a.type !== 'demurrage') return <span className="text-slate-300">—</span>;
  if (a.cargoType !== 'vehicles') return <span className="tabular-nums text-slate-600">3 {ar ? 'أيام (ثابتة)' : 'days (fixed)'}</span>;
  const save = async () => {
    const n = Math.round(Number(v));
    if (!(n > 0) || n === Number(a.demurrageDays || 15)) { setV(String(a.demurrageDays || 15)); return; }
    setBusy(true);
    try { await api.put(`/api/customs-clearance/${a.clearanceId}`, { demurrageDays: n }); notify(ar ? 'حُدِّثت أيام الأرضيات' : 'Free days updated', 'success'); }
    catch (e: any) { notify(e?.message || (ar ? 'تعذّر الحفظ' : 'Could not save'), 'error'); setV(String(a.demurrageDays || 15)); }
    setBusy(false);
  };
  return (
    <span className="inline-flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
      <input type="number" min={1} max={365} value={v} disabled={busy} onChange={(e) => setV(e.target.value)} onBlur={save}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
        className="w-16 rounded-lg border border-slate-300 px-2 py-1 text-center text-[13px] font-bold tabular-nums focus:outline-none focus:ring-2 focus:ring-[#f37121]/40" />
      <span className="text-[12px] text-slate-500">{ar ? 'يومًا' : 'days'}</span>
      {busy && <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400" />}
    </span>
  );
}

const PILL: Record<string, string> = {
  overdue: 'bg-red-600 text-white', today: 'bg-orange-500 text-white', soon: 'bg-amber-100 text-amber-900 ring-1 ring-amber-300', ok: 'bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200',
};

/** Summary tile that also filters the table; module level so it is never remounted per render. */
function Stat({ label, n, tone, on, onClick }: { label: string; n: number; tone: string; on: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}
      className={`flex-1 rounded-2xl border p-4 text-start transition ${on ? 'border-slate-900 ring-2 ring-slate-900/10' : 'border-slate-200 hover:border-slate-300'} ${tone}`}>
      <p className="text-[12.5px] font-bold opacity-80">{label}</p>
      <p className="mt-1 text-3xl font-black tabular-nums">{n}</p>
    </button>
  );
}

export function DeadlineAlertsButton({ ar }: { ar: boolean }) {
  const t = (a: string, e: string) => (ar ? a : e);
  const { items, now } = useDeadlineAlerts();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'all' | 'demurrage' | 'return'>('all');
  const [urgency, setUrgency] = useState<'' | 'overdue' | 'soon'>('');
  const [q, setQ] = useState('');
  const rows = useMemo(() => (items || []).map((a) => ({ ...a, ms: new Date(a.deadlineAt).getTime() - now })), [items, now]);
  const overdue = rows.filter((r) => r.ms < 0).length;
  const soonN = rows.filter((r) => r.ms >= 0 && r.ms <= 3 * DAY).length;
  const s = q.trim().toLowerCase();
  const shown = rows.filter((r) => (tab === 'all' || r.type === tab)
    && (!urgency || (urgency === 'overdue' ? r.ms < 0 : r.ms >= 0 && r.ms <= 3 * DAY))
    && (!s || [r.blNumber, r.refNumber, r.customerName].some((x) => String(x || '').toLowerCase().includes(s))));
  const count = (k: string) => rows.filter((r) => k === 'all' || r.type === k).length;
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}
        className={`relative inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${overdue ? 'bg-red-600 text-white hover:bg-red-700' : soonN ? 'bg-amber-500 text-white hover:bg-amber-600' : 'bg-slate-100 text-slate-700 hover:text-[#f37121]'}`}>
        <BellRing className="h-4 w-4" />{t('التنبيهات', 'Alerts')}
        {rows.length > 0 && <span className={`min-w-[1.4rem] rounded-full px-1.5 text-center text-[11px] font-bold ${overdue || soonN ? 'bg-white/25' : 'bg-[#f37121] text-white'}`}>{rows.length}</span>}
      </button>
      <Modal open={open} onClose={() => setOpen(false)} wide="xl" title={t('تنبيهات الأرضيات وإرجاع الحاويات', 'Demurrage & container-return alerts')}>
        <div className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row">
            <Stat label={t('متأخّرة', 'Overdue')} n={overdue} tone="bg-red-50 text-red-800" on={urgency === 'overdue'} onClick={() => setUrgency(urgency === 'overdue' ? '' : 'overdue')} />
            <Stat label={t('تنتهي خلال 3 أيام', 'Due within 3 days')} n={soonN} tone="bg-amber-50 text-amber-900" on={urgency === 'soon'} onClick={() => setUrgency(urgency === 'soon' ? '' : 'soon')} />
            <Stat label={t('كل المواعيد المفتوحة', 'All open deadlines')} n={rows.length} tone="bg-white text-slate-900" on={!urgency} onClick={() => setUrgency('')} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex overflow-hidden rounded-xl border border-slate-200 bg-white text-[13px] font-semibold">
              {([['all', t('الكل', 'All')], ['demurrage', t('الأرضيات', 'Demurrage')], ['return', t('إرجاع الحاويات', 'Container returns')]] as const).map(([k, l]) => (
                <button key={k} type="button" onClick={() => setTab(k)}
                  className={`px-4 py-2 ${tab === k ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>
                  {l} <span className="tabular-nums opacity-70">({count(k)})</span>
                </button>
              ))}
            </div>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('بحث برقم البوليصة أو المعاملة أو العميل…', 'Search BL, ref or customer…')}
              className="min-w-[14rem] flex-1 rounded-xl border border-slate-300 px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-[#f37121]/40" />
          </div>
          <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
            <table className="w-full min-w-[860px] text-[13px]">
              <thead className="bg-slate-900 text-slate-200">
                <tr>
                  {[t('المعاملة', 'Transaction'), t('العميل', 'Customer'), t('النوع', 'Cargo'), t('التنبيه', 'Alert'), t('موعد التفريغ', 'Unloading'), t('الموعد النهائي', 'Deadline'), t('أيام الأرضيات', 'Free days'), t('المتبقّي', 'Time left')]
                    .map((h) => <th key={h} className="whitespace-nowrap px-3 py-3 text-start font-semibold">{h}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items === null && <tr><td colSpan={8} className="py-12 text-center text-slate-400">{t('جارٍ التحميل…', 'Loading…')}</td></tr>}
                {items !== null && !shown.length && <tr><td colSpan={8} className="py-12 text-center text-slate-400">{t('لا مواعيد مفتوحة بهذا الاختيار.', 'No open deadlines for this choice.')}</td></tr>}
                {shown.map((r) => {
                  const st = stateOf(r.ms);
                  return (
                    <tr key={`${r.clearanceId}-${r.type}`} className={st === 'overdue' ? 'bg-red-50/50' : st === 'today' ? 'bg-orange-50/50' : 'hover:bg-slate-50'}>
                      <td className="px-3 py-3">
                        <Link href={`/system/customs/${r.clearanceId}`} onClick={() => setOpen(false)} className="font-bold text-slate-900 hover:text-[#f37121]">
                          <bdi>{r.blNumber || r.refNumber}</bdi>
                        </Link>
                        <span className="block text-[11.5px] text-slate-400"><bdi>{r.refNumber}</bdi></span>
                      </td>
                      <td className="max-w-[200px] truncate px-3 py-3 text-slate-700" title={r.customerName}>{r.customerName || '—'}</td>
                      <td className="whitespace-nowrap px-3 py-3 text-slate-600">{r.cargoType === 'vehicles' ? t('سيّارات', 'Vehicles') : t('حاويات', 'Containers')} · <span className="tabular-nums">{r.units}</span></td>
                      <td className="whitespace-nowrap px-3 py-3">
                        <span className="inline-flex items-center gap-1.5 font-semibold text-slate-800">
                          {r.type === 'demurrage' ? <Anchor className="h-4 w-4 text-sky-600" /> : <RotateCcw className="h-4 w-4 text-violet-600" />}
                          {r.type === 'demurrage' ? t('الأرضيات', 'Demurrage') : t('إرجاع الحاويات', 'Container return')}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 tabular-nums text-slate-600" dir="ltr">{r.unloadingAppointment || '—'}</td>
                      <td className="whitespace-nowrap px-3 py-3 font-bold tabular-nums text-slate-900" dir="ltr">{r.date}</td>
                      <td className="whitespace-nowrap px-3 py-3"><DaysCell a={r} ar={ar} /></td>
                      <td className="whitespace-nowrap px-3 py-3">
                        <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12.5px] font-bold ${PILL[st]}`}>
                          {st === 'overdue' ? <AlertTriangle className="h-3.5 w-3.5" /> : <Timer className="h-3.5 w-3.5" />}{countdown(r.ms, ar)}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="rounded-xl bg-slate-50 px-4 py-3 text-[12.5px] leading-6 text-slate-600">
            <p>• {t('موعد الأرضيات للحاويات: موعد التفريغ + 3 أيام (ثابت).', 'Container demurrage: unloading + 3 days (fixed).')}</p>
            <p>• {t('موعد الأرضيات للسيّارات: موعد التفريغ + أيام الأرضيات (15 افتراضيًّا، وتُعدَّل من هنا أو من صفحة المعاملة).', 'Vehicle demurrage: unloading + free days (15 by default; edit here or on the transaction).')}</p>
            <p>• {t('يُغلق تنبيه الأرضيات عند نقل كل الوحدات من الميناء، ويُغلق تنبيه الإرجاع عند إرجاع كل الحاويات.', 'Demurrage closes once every unit leaves the port; return closes once every container is returned.')}</p>
          </div>
        </div>
      </Modal>
    </>
  );
}

/** One transaction's open deadlines, shown above its details. */
export function DeadlineBanner({ clearanceId, ar }: { clearanceId: string; ar: boolean }) {
  const { items, now } = useDeadlineAlerts();
  const mine = (items || []).filter((a) => String(a.clearanceId) === String(clearanceId));
  if (!mine.length) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {mine.map((a) => {
        const ms = new Date(a.deadlineAt).getTime() - now;
        const st = stateOf(ms);
        return (
          <div key={a.type} className={`flex items-center gap-2 rounded-xl px-3 py-2 text-[13px] font-semibold ring-1 ${TONE[st]}`}>
            {st === 'overdue' ? <AlertTriangle className="h-4 w-4" /> : a.type === 'demurrage' ? <Anchor className="h-4 w-4" /> : <RotateCcw className="h-4 w-4" />}
            <span>{typeLabel(a.type, a.cargoType, ar)} <span className="tabular-nums" dir="ltr">{a.date}</span></span>
            <span className="font-extrabold">· {countdown(ms, ar)}</span>
          </div>
        );
      })}
    </div>
  );
}
