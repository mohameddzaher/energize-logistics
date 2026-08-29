'use client';
// تفاصيل الحمولة — the full story of one shipment: its data, the follow-up
// calls (وقت المتابعة، الموقع الحالي، الملاحظة، متوقع الوصول), and the complete
// event log — who did what and when, from creation to the last call.
import { useState, useEffect, useCallback, Suspense } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import { useDialog } from '@/components/system/DialogProvider';
import {
  Truck, ArrowRight, PhoneCall, Loader2, Check, FileDown, Pencil,
  History, MapPin, Clock3, Satellite,
} from 'lucide-react';
import { Spinner, PageHeader, SmallBadge, PrimaryButton, ErrorNotice } from '@/components/hr/HRKit';
import {
  FleetShipment, FleetEvent, fleetStatus, fleetStatusLabel, FOLLOWUP_NOTES_AR,
  fmtDT, fmtD, hoursSince, canEditFleet, Lang,
} from '@/lib/fleet';
import type { DispatchSheetRow } from '@/lib/dispatchSheetExcelParser';
import VehicleMonthLog from '@/components/fleet/VehicleMonthLog';

const labelCls = 'block text-sm font-semibold text-slate-800 mb-1.5';
const inputCls = 'w-full px-3 py-2.5 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50';

const EVENT_LABEL: Record<string, { ar: string; en: string; cls: string }> = {
  created: { ar: 'إنشاء الحمولة', en: 'Created', cls: 'bg-emerald-100 text-emerald-700' },
  updated: { ar: 'تعديل البيانات', en: 'Updated', cls: 'bg-slate-100 text-slate-600' },
  status: { ar: 'تغيير الحالة', en: 'Status change', cls: 'bg-blue-100 text-blue-700' },
  driver_change: { ar: 'حركة سائق', en: 'Driver move', cls: 'bg-violet-100 text-violet-700' },
  followup: { ar: 'متابعة', en: 'Follow-up', cls: 'bg-amber-100 text-amber-700' },
};

const nowLocal = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

function FleetShipmentDetailsInner() {
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const router = useRouter();
  const params = useParams();
  const id = (params as any)?.id as string;
  const { notify } = useDialog();
  const editor = canEditFleet(user);

  const [shipment, setShipment] = useState<FleetShipment | null>(null);
  const [events, setEvents] = useState<FleetEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [downloading, setDownloading] = useState(false);

  // The follow-up form — the thing the operations team fills several times a day.
  const [fu, setFu] = useState({ contactTime: nowLocal(), currentLocation: '', note: '', expectedArrival: '' });
  const [savingFu, setSavingFu] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const d = await api.get<{ shipment: FleetShipment; events: FleetEvent[] }>(`/api/fleet/shipments/${id}`);
      setShipment(d.shipment);
      setEvents(d.events || []);
      setError('');
    } catch (e: any) { setError(e?.message || 'Request failed'); }
    setLoading(false);
  }, [id]);

  useEffect(() => { load(); }, [load]);
  useSocket('fleet:updated', useCallback(() => load(), [load]));

  const submitFollowUp = async () => {
    if (!fu.currentLocation.trim() && !fu.note.trim()) {
      notify(ar ? 'اكتب الموقع الحالي أو ملاحظة على الأقل.' : 'Enter a location or a note.', 'error');
      return;
    }
    setSavingFu(true);
    try {
      await api.post(`/api/fleet/shipments/${id}/followups`, {
        contactTime: fu.contactTime ? new Date(fu.contactTime).toISOString() : undefined,
        currentLocation: fu.currentLocation.trim(),
        note: fu.note.trim(),
        expectedArrival: fu.expectedArrival ? new Date(fu.expectedArrival).toISOString() : null,
      });
      setFu({ contactTime: nowLocal(), currentLocation: '', note: '', expectedArrival: '' });
      notify(ar ? 'سُجّلت المتابعة.' : 'Follow-up recorded.', 'success');
      load();
    } catch (e: any) { notify(e.message, 'error'); }
    setSavingFu(false);
  };

  const downloadWaybill = async () => {
    if (!shipment) return;
    setDownloading(true);
    try {
      const gen = await import('@/lib/dispatchSheetGenerator');
      const row: DispatchSheetRow = {
        rowIndex: 1, rentalType: '', carBrand: '', carColor: '',
        carType: shipment.trailerType || '', plateNumber: shipment.vehiclePlate || '',
        driverAdvance: '', driverPhone: shipment.driverPhone || '', driverIqama: '', driverNationality: '',
        driverName: [shipment.driverName, shipment.secondDriverName].filter(Boolean).join(' + '),
        customerName: shipment.customerName || '', branch: '',
        toLocation: shipment.toCity || '', fromLocation: shipment.fromCity || '',
        date: fmtD(shipment.loadDate || shipment.createdAt), dispatchNumber: String(shipment.waybillNumber),
        missingRequired: [],
      };
      const { blob } = await gen.generateSingleDispatchPdf(row);
      const d = new Date(shipment.loadDate || shipment.createdAt || Date.now());
      gen.triggerDownload(blob, `بوليصة-${shipment.waybillNumber}-${shipment.customerName || 'عميل'}-${d.getDate()}-${d.getMonth() + 1}-${d.getFullYear()}.pdf`);
    } catch (e: any) { notify(e?.message || 'PDF failed', 'error'); }
    setDownloading(false);
  };

  if (loading) return <Spinner />;
  if (!shipment) return <div className="p-8"><ErrorNotice error={error || 'Not found'} lang={lang} onRetry={load} /></div>;

  const st = fleetStatus(shipment.status);
  const hrs = hoursSince(shipment.lastContactAt);
  const followups = events.filter((e) => e.type === 'followup');

  // لوحةُ السيّارة قد تصل كائنًا مُعبّأً أو لقطةً نصّية — والسجلُّ يُطلب بأيّهما.
  const vehiclePlate: string = (typeof (shipment as any)?.vehicle === 'object' && (shipment as any)?.vehicle?.plate)
    || (shipment as any)?.vehiclePlate || '';
  // شهرُ الحمولة لا الشهرُ الجاري: من يفتح بوليصةً من مايو يريد سجلَّ مايو.
  const shipmentMonth = (() => {
    const d = new Date((shipment as any)?.loadDate || (shipment as any)?.createdAt || Date.now());
    if (Number.isNaN(d.getTime())) return undefined;
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  })();

  const info: [string, React.ReactNode][] = [
    [ar ? 'العميل' : 'Customer', shipment.customerName || '—'],
    [ar ? 'المسار' : 'Route', `${shipment.fromCity || '—'} ← ${shipment.toCity || '—'}`],
    [ar ? 'رقم السيارة' : 'Plate', shipment.vehiclePlate || '—'],
    [ar ? 'نوع التيدر' : 'Trailer', shipment.trailerType || '—'],
    ['GPS', shipment.gpsType || '—'],
    [ar ? 'السائق' : 'Driver', [shipment.driverName, shipment.driverPhone].filter(Boolean).join(' · ') || '—'],
    [ar ? 'سائق ثانٍ' : 'Second driver', shipment.secondDriverName || '—'],
    [ar ? 'المشرف' : 'Supervisor', shipment.supervisorName || '—'],
    [ar ? 'تاريخ التحميل' : 'Load date', fmtD(shipment.loadDate)],
    [ar ? 'متوقع الوصول' : 'Expected arrival', fmtDT(shipment.expectedArrival, lang as Lang)],
    [ar ? 'آخر تواصل' : 'Last contact', shipment.lastContactAt
      ? `${fmtDT(shipment.lastContactAt, lang as Lang)} (${ar ? `منذ ${hrs} س` : `${hrs}h ago`})`
      : (ar ? 'لم يُتواصل بعد' : 'Never')],
    [ar ? 'ملاحظات' : 'Notes', shipment.notes || '—'],
  ];

  return (
    <div className="space-y-5 w-full" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader icon={<Truck className="w-5 h-5" />}
        title={`${ar ? 'بوليصة رقم' : 'Waybill'} ${shipment.waybillNumber}`}
        subtitle={shipment.customerName || ''}>
        <span className={`px-3 py-1.5 rounded-full text-sm font-semibold ${st?.bg} ${st?.text}`}>
          {fleetStatusLabel(shipment.status, lang as Lang)}
        </span>
        <button type="button" onClick={downloadWaybill} disabled={downloading}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm disabled:opacity-60">
          {downloading ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileDown className="w-4 h-4" />}
          {ar ? 'تحميل البوليصة' : 'Waybill PDF'}
        </button>
        {editor && (
          <button type="button" onClick={() => router.push(`/system/fleet/new?id=${shipment._id}`)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm">
            <Pencil className="w-4 h-4" /> {ar ? 'تعديل' : 'Edit'}
          </button>
        )}
        <button type="button" onClick={() => router.push('/system/fleet')}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm">
          <ArrowRight className="w-4 h-4" /> {ar ? 'القائمة' : 'List'}
        </button>
      </PageHeader>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5 items-start">
        {/* البيانات */}
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-5">
          <p className="text-sm font-bold text-slate-900 mb-3 flex items-center gap-2"><Satellite className="w-4 h-4 text-[#f37121]" /> {ar ? 'بيانات الحمولة' : 'Shipment data'}</p>
          <dl className="space-y-2 text-sm">
            {info.map(([k, v], i) => (
              <div key={i} className="flex items-start justify-between gap-3 border-b border-slate-100 pb-1.5 last:border-0">
                <dt className="text-slate-500 shrink-0">{k}</dt>
                <dd className="font-semibold text-slate-900 text-end">{v}</dd>
              </div>
            ))}
          </dl>
        </div>

        {/* المتابعة */}
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-5 space-y-4">
          <p className="text-sm font-bold text-slate-900 flex items-center gap-2"><PhoneCall className="w-4 h-4 text-[#f37121]" /> {ar ? 'تسجيل متابعة' : 'Record a follow-up'}</p>
          {editor && (
            <div className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>{ar ? 'وقت المتابعة' : 'Contact time'}</label>
                  <input type="datetime-local" value={fu.contactTime} onChange={(e) => setFu((f) => ({ ...f, contactTime: e.target.value }))} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>{ar ? 'متوقع الوصول (اختياري)' : 'Expected arrival (optional)'}</label>
                  <input type="datetime-local" value={fu.expectedArrival} onChange={(e) => setFu((f) => ({ ...f, expectedArrival: e.target.value }))} className={inputCls} />
                </div>
              </div>
              <div>
                <label className={labelCls}>{ar ? 'الموقع الحالي' : 'Current location'}</label>
                <input value={fu.currentLocation} onChange={(e) => setFu((f) => ({ ...f, currentLocation: e.target.value }))}
                  placeholder={ar ? 'أين هو وقت المكالمة؟' : 'Where is he right now?'} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>{ar ? 'الملاحظة' : 'Note'}</label>
                {/* The usual outcomes as one-tap chips — typing is the exception. */}
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {FOLLOWUP_NOTES_AR.map((n) => (
                    <button key={n} type="button" onClick={() => setFu((f) => ({ ...f, note: n }))}
                      className={`px-2.5 py-1 rounded-full border text-xs font-medium transition-colors ${fu.note === n
                        ? 'border-[#f37121] bg-[#f37121] text-white' : 'border-slate-300 bg-white text-slate-600 hover:border-[#f37121]/50'}`}>
                      {n}
                    </button>
                  ))}
                </div>
                <input value={fu.note} onChange={(e) => setFu((f) => ({ ...f, note: e.target.value }))}
                  placeholder={ar ? 'أو اكتب ملاحظة أخرى…' : 'Or type another note…'} className={inputCls} />
              </div>
              <PrimaryButton onClick={submitFollowUp} disabled={savingFu}>
                {savingFu ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                {ar ? 'تسجيل المتابعة' : 'Record'}
              </PrimaryButton>
            </div>
          )}

          {followups.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-slate-500 mb-2">{ar ? `المتابعات (${followups.length})` : `Follow-ups (${followups.length})`}</p>
              <div className="space-y-2 max-h-72 overflow-y-auto pe-1">
                {followups.map((e) => (
                  <div key={e._id} className="rounded-xl border border-amber-200 bg-amber-50/60 p-3 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-slate-900 flex items-center gap-1.5">
                        <MapPin className="w-3.5 h-3.5 text-amber-600" /> {e.data?.currentLocation || '—'}
                      </span>
                      <span className="text-xs text-slate-500 whitespace-nowrap">{fmtDT(e.data?.contactTime || e.createdAt, lang as Lang)}</span>
                    </div>
                    {e.data?.note && <p className="text-slate-700 mt-1">{e.data.note}</p>}
                    <div className="flex items-center justify-between mt-1">
                      {e.data?.expectedArrival
                        ? <span className="text-xs text-emerald-700 flex items-center gap-1"><Clock3 className="w-3 h-3" /> {ar ? 'متوقع الوصول:' : 'ETA:'} {fmtDT(e.data.expectedArrival, lang as Lang)}</span>
                        : <span />}
                      <span className="text-[11px] text-slate-400">{e.byName}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ── السجلّ الكامل: للسيّارة لا للشحنة ────────────────────────────
            متابعاتُ هذه الحمولة أعلاه تجيب «أين هي الآن». وهذا يجيب السؤال
            الآخر: ماذا جرى لهذه السيّارة هذا الشهر — عطلٌ وإطارٌ وسائقٌ تغيّر
            وستُّ حمولاتٍ بينها، وفيها أحداثُ هذه الشحنة موسومةً برقم بوليصتها.
            والشهرُ يُقفل مع أوّل الشهر التالي. */}
        {vehiclePlate ? (
          <VehicleMonthLog
            vehicle={vehiclePlate}
            month={shipmentMonth}
            canEdit={editor}
            compact
            shipmentId={id}
          />
        ) : (
          <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-5">
            <p className="text-sm font-bold text-slate-900 mb-3 flex items-center gap-2"><History className="w-4 h-4 text-[#f37121]" /> {ar ? 'السجل الكامل' : 'Full history'}</p>
            <p className="text-sm text-slate-400 py-6 text-center">{ar ? 'هذه الحمولة غير مرتبطة بسيّارة — لا سجلّ شهريّ لها.' : 'This shipment has no vehicle, so it has no monthly log.'}</p>
          </div>
        )}
      </div>
    </div>
  );
}

export default function Page() {
  return <Suspense fallback={<Spinner />}><FleetShipmentDetailsInner /></Suspense>;
}
