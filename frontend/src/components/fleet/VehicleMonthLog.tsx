'use client';
// سجلّ السيّارة الشهريّ — مكوّنٌ واحد يُقرأ في موضعين.
//
// في صفحة الحمولة يُعرض تحت متابعاتها: «هذه الشحنة أين هي» شيء، و«ماذا جرى
// لهذه السيّارة هذا الشهر» شيءٌ آخر — عطلٌ يوم ٩ وإطارٌ يوم ١٤ وستُّ حمولاتٍ
// بينها. وفي صفحة «سجلّات السيارات» يُعرض وحده لأيّ سيّارةٍ وأيّ فترة.
//
// والشهرُ يُقفل من نفسِه: متى جاء أوّلُ الشهر التالي صار ما قبله للقراءة فقط —
// حقيقةٌ عن الزمن لا خانةٌ يضغطها أحد. وما يُضاف إلى شهرٍ مقفل يظهر موسومًا
// «قيد متأخّر»، فلا يُدَسّ بين ما كُتب في حينه.
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import api from '@/lib/api';
import { useLanguage } from '@/context/LanguageContext';
import { useDialog } from '@/components/system/DialogProvider';
import { useSocket } from '@/hooks/useSocket';
import {
  History, Plus, Loader2, Lock, Trash2, Truck, Wrench, CircleDot, Fuel,
  AlertTriangle, FileWarning, UserSquare, PauseCircle, StickyNote, PhoneCall, ArrowLeftRight,
} from 'lucide-react';

export interface LogPeriod { from: string; to: string; monthKey: string; label: string; scope: string }
export interface LogRow {
  id: string; source: 'entry' | 'shipment' | 'event'; at: string; kind: string;
  text?: string; location?: string; cost?: number; waybillNumber?: number | null;
  shipment?: string | null; driverName?: string; byName?: string; lateEntry?: boolean;
  price?: number; driverExpense?: number; status?: string;
}
export interface LogSummary {
  loads: number; income: number; driverExpense: number; logCost: number; net: number;
  entries: number; followups: number; byKind: Record<string, number>; target: number;
}
export interface VehicleLogResponse {
  vehicle: { _id: string; plate: string; name?: string; trailerType?: string; supervisorName?: string; monthlyTarget?: number };
  period: LogPeriod;
  closed: boolean;
  kinds: { key: string; ar: string; en: string }[];
  timeline: LogRow[];
  summary: LogSummary;
}

const ICONS: Record<string, any> = {
  load: Truck, breakdown: AlertTriangle, maintenance: Wrench, tire: CircleDot, fuel: Fuel,
  accident: AlertTriangle, violation: FileWarning, driver: UserSquare, idle: PauseCircle,
  note: StickyNote, 'event:followup': PhoneCall, 'event:status': ArrowLeftRight,
  'event:created': Truck, 'event:updated': StickyNote, 'event:driver_change': UserSquare,
};
const TONES: Record<string, string> = {
  load: 'bg-emerald-100 text-emerald-700', breakdown: 'bg-red-100 text-red-700',
  maintenance: 'bg-orange-100 text-orange-700', tire: 'bg-slate-200 text-slate-700',
  fuel: 'bg-sky-100 text-sky-700', accident: 'bg-red-100 text-red-700',
  violation: 'bg-rose-100 text-rose-700', driver: 'bg-violet-100 text-violet-700',
  idle: 'bg-slate-100 text-slate-600', note: 'bg-amber-100 text-amber-700',
  'event:followup': 'bg-amber-100 text-amber-700', 'event:status': 'bg-blue-100 text-blue-700',
};
const EVENT_AR: Record<string, [string, string]> = {
  'event:followup': ['متابعة', 'Follow-up'], 'event:status': ['تغيير الحالة', 'Status change'],
  'event:created': ['إنشاء الحمولة', 'Created'], 'event:updated': ['تعديل البيانات', 'Updated'],
  'event:driver_change': ['حركة سائق', 'Driver move'],
};

const p2 = (n: number) => String(n).padStart(2, '0');
export const thisMonth = () => { const d = new Date(); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}`; };
const nowLocal = () => { const d = new Date(); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}`; };
const money = (n?: number) => (Number(n) || 0).toLocaleString('en-US', { maximumFractionDigits: 2 });

export default function VehicleMonthLog({
  vehicle, month, from, to, date, canEdit, compact, shipmentId,
}: {
  vehicle: string;              // معرّف السيّارة أو لوحتها
  month?: string;               // YYYY-MM
  from?: string; to?: string; date?: string;
  canEdit: boolean;
  compact?: boolean;            // داخل صفحة الحمولة
  shipmentId?: string;          // لربط القيد بالحمولة المفتوحة
}) {
  const { lang } = useLanguage();
  const ar = lang === 'ar';
  const t = (a: string, e: string) => (ar ? a : e);
  const { notify } = useDialog();

  const [data, setData] = useState<VehicleLogResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ kind: 'breakdown', at: nowLocal(), text: '', location: '', cost: '', linkShipment: true });

  const qs = new URLSearchParams({ vehicle });
  if (date) qs.set('date', date);
  else if (from || to) { if (from) qs.set('from', from); if (to) qs.set('to', to); }
  else qs.set('month', month || thisMonth());
  const query = qs.toString();

  const load = useCallback(async () => {
    if (!vehicle) { setLoading(false); return; }
    try { setData(await api.get<VehicleLogResponse>(`/api/fleet/vehicle-logs?${query}`)); }
    catch (e: any) { notify(e?.message || t('تعذّر تحميل السجلّ', 'Could not load the log'), 'error'); }
    setLoading(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vehicle, query]);

  useEffect(() => { setLoading(true); load(); }, [load]);
  useSocket('fleet:updated', useCallback(() => { load(); }, [load]));

  const submit = async () => {
    if (!form.text.trim()) { notify(t('اكتب ما حدث', 'Say what happened'), 'error'); return; }
    setSaving(true);
    try {
      const r = await api.post<any>('/api/fleet/vehicle-logs', {
        vehicle,
        kind: form.kind,
        at: new Date(form.at).toISOString(),
        text: form.text.trim(),
        location: form.location.trim(),
        cost: form.cost ? Number(form.cost) : 0,
        shipment: compact && form.linkShipment && shipmentId ? shipmentId : undefined,
      });
      setForm({ kind: 'breakdown', at: nowLocal(), text: '', location: '', cost: '', linkShipment: true });
      setAdding(false);
      if (r?.lateEntry) notify(t('أُضيف كقيدٍ متأخّر — شهرُه مقفل', 'Added as a late entry — its month is closed'), 'info');
      load();
    } catch (e: any) { notify(e?.message || t('لم يُحفظ القيد', 'Not saved'), 'error'); }
    setSaving(false);
  };

  const remove = async (id: string) => {
    if (!window.confirm(t('حذف هذا القيد؟', 'Delete this entry?'))) return;
    try { await api.delete(`/api/fleet/vehicle-logs/${id}`); load(); }
    catch (e: any) { notify(e?.message || t('تعذّر الحذف', 'Delete failed'), 'error'); }
  };

  if (loading) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm flex items-center justify-center h-40">
        <Loader2 className="w-5 h-5 animate-spin text-[#f37121]" />
      </div>
    );
  }
  if (!data) return null;

  const kindLabel = (k: string) => {
    if (k === 'load') return t('حمولة', 'Load');
    if (EVENT_AR[k]) return EVENT_AR[k][ar ? 0 : 1];
    const m = data.kinds.find((x) => x.key === k);
    return m ? (ar ? m.ar : m.en) : k;
  };
  const dtm = (s: string) => new Date(s).toLocaleString(ar ? 'ar-EG' : 'en-GB', { dateStyle: 'short', timeStyle: 'short' });
  const s = data.summary;

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <h3 className="bg-slate-900 px-3 py-2 rounded-lg text-white font-semibold flex items-center gap-2">
            <History className="w-4 h-4" />
            {t('السجلّ الكامل للسيّارة', 'Full vehicle log')}
            <span className="text-slate-400 text-xs font-normal">{data.vehicle.plate}</span>
          </h3>
          <span className="px-2 py-1 rounded-full text-xs font-semibold bg-slate-100 text-slate-600">{data.period.label}</span>
          {data.closed && (
            <span className="px-2 py-1 rounded-full text-xs font-semibold bg-slate-200 text-slate-600 inline-flex items-center gap-1">
              <Lock className="w-3 h-3" /> {t('مقفل', 'Closed')}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {compact && (
            <Link href={`/system/fleet/vehicle-logs?vehicle=${encodeURIComponent(data.vehicle.plate)}&month=${data.period.monthKey || thisMonth()}`}
              className="px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold">
              {t('فتح سجلّات السيارات', 'Open vehicle logs')}
            </Link>
          )}
          {canEdit && (
            <button type="button" onClick={() => setAdding((v) => !v)}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#f37121] text-white text-sm font-medium hover:bg-[#e06010] transition-colors">
              <Plus className="w-4 h-4" /> {t('إضافة قيد', 'Add entry')}
            </button>
          )}
        </div>
      </div>

      {/* ملخّص الشهر */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 mb-4">
        {([
          [t('حمولات', 'Loads'), String(s.loads)],
          [t('الدخل', 'Income'), money(s.income)],
          [t('مصروف السائق', 'Driver expense'), money(s.driverExpense)],
          [t('تكلفة السجلّ', 'Log cost'), money(s.logCost)],
          [t('الصافي', 'Net'), money(s.net)],
          [t('قيود', 'Entries'), String(s.entries)],
        ] as [string, string][]).map(([l, v]) => (
          <div key={l} className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2">
            <p className="text-[11px] text-slate-500">{l}</p>
            <p className="text-sm font-bold text-slate-900">{v}</p>
          </div>
        ))}
      </div>

      {adding && canEdit && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 mb-4 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">{t('النوع', 'Kind')}</label>
              <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}
                className="w-full px-3 py-2 rounded-lg bg-white border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50">
                {data.kinds.map((k) => <option key={k.key} value={k.key}>{ar ? k.ar : k.en}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">{t('وقت الحدث', 'When it happened')}</label>
              <input type="datetime-local" value={form.at} onChange={(e) => setForm({ ...form, at: e.target.value })}
                className="w-full px-3 py-2 rounded-lg bg-white border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50 [color-scheme:light]" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">{t('الموقع', 'Location')}</label>
              <input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })}
                className="w-full px-3 py-2 rounded-lg bg-white border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">{t('التكلفة (ر.س)', 'Cost (SAR)')}</label>
              <input type="number" value={form.cost} onChange={(e) => setForm({ ...form, cost: e.target.value })}
                className="w-full px-3 py-2 rounded-lg bg-white border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">{t('ماذا حدث', 'What happened')}</label>
            <textarea value={form.text} onChange={(e) => setForm({ ...form, text: e.target.value })} rows={2}
              className="w-full px-3 py-2 rounded-lg bg-white border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50" />
          </div>
          {compact && shipmentId && (
            <label className="flex items-center gap-2 text-xs text-slate-600">
              <input type="checkbox" checked={form.linkShipment} onChange={(e) => setForm({ ...form, linkShipment: e.target.checked })} />
              {t('اربط القيد بهذه الحمولة', 'Link this entry to the open shipment')}
            </label>
          )}
          <div className="flex items-center gap-2">
            <button type="button" onClick={submit} disabled={saving}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#f37121] text-white text-sm font-medium hover:bg-[#e06010] disabled:opacity-60">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} {t('حفظ', 'Save')}
            </button>
            <button type="button" onClick={() => setAdding(false)} className="px-4 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium">
              {t('إلغاء', 'Cancel')}
            </button>
          </div>
        </div>
      )}

      {data.timeline.length === 0 ? (
        <p className="text-sm text-slate-500 py-8 text-center">
          {t('لا شيء مسجَّل على هذه السيّارة في هذه الفترة.', 'Nothing recorded for this vehicle in this period.')}
        </p>
      ) : (
        <ul className={`space-y-2 ${compact ? 'max-h-[28rem] overflow-y-auto pe-1' : ''}`}>
          {data.timeline.map((r) => {
            const Icon = ICONS[r.kind] || StickyNote;
            const tone = TONES[r.kind] || 'bg-slate-100 text-slate-600';
            return (
              <li key={`${r.source}-${r.id}`} className="flex items-start gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2.5">
                <span className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${tone}`}>
                  <Icon className="w-4 h-4" />
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${tone}`}>{kindLabel(r.kind)}</span>
                    {r.waybillNumber ? (
                      r.shipment
                        ? <Link href={`/system/fleet/${r.shipment}`} className="text-[11.5px] font-bold text-[#f37121] hover:underline">#{r.waybillNumber}</Link>
                        : <span className="text-[11.5px] font-bold text-slate-500">#{r.waybillNumber}</span>
                    ) : null}
                    {r.lateEntry && (
                      <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-slate-200 text-slate-600">{t('قيد متأخّر', 'Late entry')}</span>
                    )}
                    <span className="text-[11px] text-slate-400">{dtm(r.at)}</span>
                  </div>
                  {r.text ? <p className="text-[13px] text-slate-700 mt-1 break-words">{r.text}</p> : null}
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-0.5 text-[11px] text-slate-500">
                    {r.location ? <span>{r.location}</span> : null}
                    {r.driverName ? <span>{r.driverName}</span> : null}
                    {r.source === 'shipment' && r.price ? <span>{t('الإيجار', 'Rent')} {money(r.price)}</span> : null}
                    {r.cost ? <span>{t('التكلفة', 'Cost')} {money(r.cost)}</span> : null}
                    {r.byName ? <span>{r.byName}</span> : null}
                  </div>
                </div>
                {canEdit && r.source === 'entry' && !data.closed && (
                  <button type="button" onClick={() => remove(r.id)}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-slate-50 shrink-0" title={t('حذف', 'Delete')}>
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
