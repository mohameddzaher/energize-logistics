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
import { BellRing, Timer, Anchor, RotateCcw, AlertTriangle } from 'lucide-react';

export type DeadlineAlert = {
  type: 'demurrage' | 'return'; date: string; deadlineAt: string; clearanceId: string; refNumber: string; blNumber: string;
  customerName: string; cargoType: 'containers' | 'vehicles'; units: number; unloadingAppointment: string;
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

export function DeadlineAlertsButton({ ar }: { ar: boolean }) {
  const t = (a: string, e: string) => (ar ? a : e);
  const { items, now } = useDeadlineAlerts();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'all' | 'demurrage' | 'return'>('all');
  const rows = useMemo(() => (items || []).map((a) => ({ ...a, ms: new Date(a.deadlineAt).getTime() - now })), [items, now]);
  const urgent = rows.filter((r) => stateOf(r.ms) !== 'ok').length;
  const overdue = rows.filter((r) => r.ms < 0).length;
  const shown = rows.filter((r) => tab === 'all' || r.type === tab);
  const count = (k: string) => rows.filter((r) => k === 'all' || r.type === k).length;

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}
        className={`relative inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${overdue ? 'bg-red-600 text-white hover:bg-red-700' : urgent ? 'bg-amber-500 text-white hover:bg-amber-600' : 'bg-slate-100 text-slate-700 hover:text-[#f37121]'}`}>
        <BellRing className="h-4 w-4" />{t('التنبيهات', 'Alerts')}
        {rows.length > 0 && <span className={`min-w-[1.4rem] rounded-full px-1.5 text-center text-[11px] font-bold ${overdue || urgent ? 'bg-white/25' : 'bg-[#f37121] text-white'}`}>{rows.length}</span>}
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title={t('تنبيهات الأرضيات وإرجاع الحاويات', 'Demurrage & container-return alerts')}>
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2">
            {[
              [t('متأخّرة', 'Overdue'), overdue, 'text-red-700 bg-red-50'],
              [t('خلال 3 أيام', 'Within 3 days'), urgent - overdue, 'text-amber-800 bg-amber-50'],
              [t('الإجمالي', 'Total'), rows.length, 'text-slate-800 bg-slate-50'],
            ].map(([l, n, c]) => (
              <div key={String(l)} className={`rounded-xl px-3 py-2 ${c}`}><p className="text-[11.5px] font-semibold opacity-80">{l}</p><p className="text-xl font-extrabold tabular-nums">{n}</p></div>
            ))}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {([['all', t('الكل', 'All')], ['demurrage', t('الأرضيات', 'Demurrage')], ['return', t('إرجاع الحاويات', 'Returns')]] as const).map(([k, l]) => (
              <button key={k} type="button" onClick={() => setTab(k)}
                className={`rounded-full px-3 py-1 text-[12.5px] font-semibold ${tab === k ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
                {l} <span className="tabular-nums opacity-70">{count(k)}</span>
              </button>
            ))}
          </div>
          {items === null ? <p className="py-8 text-center text-sm text-slate-400">{t('جارٍ التحميل…', 'Loading…')}</p>
            : !shown.length ? <p className="py-8 text-center text-sm text-slate-400">{t('لا مواعيد مفتوحة.', 'No open deadlines.')}</p>
            : (
              <ul className="max-h-[60vh] space-y-2 overflow-y-auto pe-1">
                {shown.map((r) => {
                  const st = stateOf(r.ms);
                  return (
                    <li key={`${r.clearanceId}-${r.type}`}>
                      <Link href={`/system/customs/${r.clearanceId}`} onClick={() => setOpen(false)}
                        className={`flex items-start gap-3 rounded-xl px-3 py-2.5 ring-1 transition hover:shadow-sm ${TONE[st]}`}>
                        <span className="mt-0.5 rounded-lg bg-white/70 p-1.5">{r.type === 'demurrage' ? <Anchor className="h-4 w-4" /> : <RotateCcw className="h-4 w-4" />}</span>
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center gap-x-2 text-[13.5px] font-bold text-slate-900">
                            <bdi>{r.blNumber || r.refNumber}</bdi><span className="text-[11.5px] font-semibold text-slate-400"><bdi>{r.refNumber}</bdi></span>
                          </span>
                          <span className="block text-[12.5px] text-slate-600">{typeLabel(r.type, r.cargoType, ar)} · <span className="tabular-nums" dir="ltr">{r.date}</span>{r.customerName ? ` · ${r.customerName}` : ''}</span>
                        </span>
                        <span className="shrink-0 text-end text-[12.5px] font-bold"><Timer className="mb-0.5 me-1 inline h-3.5 w-3.5" />{countdown(r.ms, ar)}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          <p className="text-[11.5px] text-slate-500">{t('يُغلق تنبيه الأرضيات عند نقل كل الوحدات من الميناء (إلى الساحة أو إلى العميل)، ويُغلق تنبيه الإرجاع عند إرجاع كل الحاويات.', 'A demurrage alert closes once every unit leaves the port; a return alert closes once every container is returned.')}</p>
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
