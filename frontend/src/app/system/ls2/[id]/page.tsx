'use client';
// Vehicle detail — everything known about one truck: live position (map), engine &
// drivetrain telemetry, full tire layout, the maintenance projection (with a
// mark-serviced action for admins), open alerts and the service history.
import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import {
  Truck, ArrowLeft, RefreshCw, Gauge, Thermometer, Fuel, Weight, Activity, Zap, MapPin, Wrench, Bell, CheckCircle2, Clock, Satellite,
} from 'lucide-react';
import { Spinner, PageHeader, Modal, Field, TextInput, TextArea, Select, PrimaryButton } from '@/components/hr/HRKit';
import {
  ls2Text, isLs2Staff, isLs2Admin, severityStyle, statusStyle, maintStyle, alertTypeLabel, alertMessage, tireTempColor, coolantColor,
  fmtNum, fmtKm, timeAgo, fmtDateTime, osmLink, type Lang, type Vehicle, type Alert, type Tire,
} from '@/lib/ls2';
import LiveMap from '@/components/ls2/LiveMap';

interface Detail { vehicle: Vehicle; alerts: Alert[]; serviceLog: any[] }

export default function Ls2VehicleDetailPage() {
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const router = useRouter();
  const { id } = useParams<{ id: string }>();
  const t = ls2Text(lang as Lang);
  const admin = isLs2Admin(user?.role);
  const [d, setD] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [svcOpen, setSvcOpen] = useState(false);
  const [form, setForm] = useState({ serviceType: 'periodic', odometerKm: '', notes: '' });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try { setD(await api.get<Detail>(`/api/ls2/vehicles/${id}`)); } catch { /* keep */ }
    setLoading(false);
  }, [id]);
  useEffect(() => { load(); }, [load]);
  useSocket('ls2:updated', useCallback(() => load(), [load]));

  if (!isLs2Staff(user?.role)) return <div className="text-slate-500 p-8">{t.notAuthorized}</div>;
  if (loading && !d) return <Spinner />;
  if (!d) return <div className="text-slate-500 p-8">{t.noData}</div>;

  const v = d.vehicle;
  const m = v.maintenance;
  const st = statusStyle(v.status);
  const openAlerts = d.alerts.filter((a) => a.status === 'open');

  const submitService = async () => {
    setSaving(true);
    try {
      await api.post(`/api/ls2/vehicles/${v.unitId}/service`, { serviceType: form.serviceType, odometerKm: form.odometerKm ? Number(form.odometerKm) : undefined, notes: form.notes });
      setSvcOpen(false); await load();
    } catch { /* ignore */ }
    setSaving(false);
  };

  const cards = [
    { label: t.speed, value: v.speed != null ? `${v.speed} km/h` : '—', icon: Gauge, accent: 'text-slate-700' },
    { label: t.ignitionLabel, value: v.ignition == null ? '—' : (v.ignition ? t.on : t.off), icon: Zap, accent: v.ignition ? 'text-emerald-600' : 'text-slate-500' },
    { label: t.coolant, value: v.coolantC != null ? `${v.coolantC}°C` : '—', icon: Thermometer, accent: coolantColor(v.coolantC) },
    { label: t.maxTireTemp, value: v.maxTireTempC != null ? `${v.maxTireTempC}°C` : '—', icon: Activity, accent: v.maxTireTempC != null && v.maxTireTempC >= 85 ? 'text-red-600' : v.maxTireTempC != null && v.maxTireTempC >= 75 ? 'text-amber-600' : 'text-slate-700' },
    { label: t.fuel, value: v.fuelPct != null ? `${v.fuelPct}%` : '—', icon: Fuel, accent: 'text-slate-700' },
    { label: t.weight, value: v.weightKg != null ? `${fmtNum(v.weightKg)} kg` : '—', icon: Weight, accent: 'text-slate-700' },
    { label: t.rpm, value: v.rpm != null ? fmtNum(v.rpm) : '—', icon: Activity, accent: 'text-slate-700' },
    { label: t.voltage, value: v.mainPowerV != null ? `${v.mainPowerV} V` : '—', icon: Zap, accent: v.mainPowerV != null && v.mainPowerV < 22 ? 'text-amber-600' : 'text-slate-700' },
    { label: t.engineHours, value: v.engineHours != null ? `${fmtNum(v.engineHours)} h` : '—', icon: Clock, accent: 'text-slate-700' },
    { label: t.totalFuelUsed, value: v.totalFuelUsedL != null ? `${fmtNum(v.totalFuelUsedL)} L` : '—', icon: Fuel, accent: 'text-slate-700' },
    { label: t.backupBattery, value: v.backupBatteryV != null ? `${v.backupBatteryV} V` : '—', icon: Zap, accent: 'text-slate-700' },
    { label: t.gsm, value: v.gsmSignal != null ? `${Math.round((v.gsmSignal / 31) * 100)}%` : '—', icon: Satellite, accent: 'text-slate-700' },
  ];

  return (
    <div className="space-y-5" dir={isRTL ? 'rtl' : 'ltr'}>
      <button type="button" onClick={() => router.back()} className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800"><ArrowLeft className={`w-4 h-4 ${isRTL ? 'rotate-180' : ''}`} /> {lang === 'ar' ? 'رجوع' : 'Back'}</button>

      <PageHeader icon={<Truck className="w-5 h-5" />} title={`${v.plate || v.name}`} subtitle={v.driver}>
        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${st.bg} ${st.text}`}><span className={`w-1.5 h-1.5 rounded-full ${st.dot}`} />{lang === 'ar' ? st.ar : st.en}</span>
        <span className="text-xs text-slate-400">{t.lastSeen}: {timeAgo(v.lastMessageAt, lang as Lang)}</span>
        <button type="button" onClick={() => load()} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm"><RefreshCw className="w-4 h-4" /> {t.refresh}</button>
      </PageHeader>

      {/* Telemetry cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {cards.map((c) => {
          const Icon = c.icon;
          return (
            <div key={c.label} className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
              <Icon className={`w-4 h-4 ${c.accent}`} />
              <p className={`text-xl font-bold mt-2 ${c.accent}`}>{c.value}</p>
              <p className="text-slate-500 text-xs mt-0.5">{c.label}</p>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Map */}
        <div className="lg:col-span-2 bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
          <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900 flex items-center gap-2"><MapPin className="w-4 h-4 text-[#f37121]" /> {lang === 'ar' ? 'الموقع المباشر' : 'Live Position'} {v.status === 'moving' && <span className="flex items-center gap-1 text-[10px] text-emerald-600"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />{lang === 'ar' ? 'يتحرك' : 'moving'}</span>}</h2>
            {v.position && <a href={osmLink(v.position.lat, v.position.lng)} target="_blank" rel="noopener noreferrer" className="text-xs text-[#f37121] hover:underline">{t.openInMap}</a>}
          </div>
          {v.position ? (
            <LiveMap lat={v.position.lat} lng={v.position.lng} label={v.plate || v.name} speed={v.speed} height={320} />
          ) : <p className="text-slate-400 text-sm py-16 text-center">{t.noData}</p>}
        </div>

        {/* Maintenance projection */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-900 mb-3 flex items-center gap-2"><Wrench className="w-4 h-4 text-amber-600" /> {t.maintenance}</h2>
          {m ? (
            <div className="space-y-2.5">
              <div className="flex items-center justify-between"><span className="text-xs text-slate-500">{t.status}</span><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${maintStyle(m.statusLevel).bg} ${maintStyle(m.statusLevel).text}`}>{lang === 'ar' ? maintStyle(m.statusLevel).ar : maintStyle(m.statusLevel).en}</span></div>
              <Row label={t.odometer} value={fmtKm(v.odometerKm)} />
              <Row label={t.nextService} value={fmtKm(m.nextServiceKm)} />
              <Row label={t.kmToService} value={m.kmToService <= 0 ? `−${fmtNum(Math.abs(m.kmToService))} km` : `${fmtNum(m.kmToService)} km`} accent={m.statusLevel === 'overdue' ? 'text-red-600' : m.statusLevel === 'due' ? 'text-amber-600' : ''} />
              <Row label={lang === 'ar' ? 'كل' : 'Interval'} value={fmtKm(m.interval)} />
              {v.lastServiceAt && <Row label={lang === 'ar' ? 'آخر صيانة' : 'Last service'} value={fmtDateTime(v.lastServiceAt, lang as Lang)} />}
              {admin && <button type="button" onClick={() => { setForm({ serviceType: 'periodic', odometerKm: String(v.odometerKm ?? ''), notes: '' }); setSvcOpen(true); }} className="mt-2 w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-50 text-emerald-700 hover:bg-emerald-100 text-sm font-medium"><CheckCircle2 className="w-4 h-4" /> {t.markServiced}</button>}
            </div>
          ) : <p className="text-slate-400 text-sm">{t.noData}</p>}
        </div>
      </div>

      {/* Tire layout */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-900 mb-4 flex items-center gap-2"><Activity className="w-4 h-4 text-[#f37121]" /> {t.tireLayout}</h2>
        <TireLayout tires={v.tires} t={t} lang={lang as Lang} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Open alerts */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-900 mb-3 flex items-center gap-2"><Bell className="w-4 h-4 text-red-600" /> {t.alerts} ({openAlerts.length})</h2>
          <div className="divide-y divide-slate-100">
            {openAlerts.map((a) => {
              const sv = severityStyle(a.severity);
              return (
                <div key={a._id} className="py-2.5 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 min-w-0"><span className={`w-1.5 h-1.5 rounded-full shrink-0 ${sv.dot}`} /><div className="min-w-0"><p className="text-sm text-slate-800 truncate">{alertTypeLabel(a.type, lang as Lang)}</p><p className="text-xs text-slate-400 truncate">{alertMessage(a, lang as Lang)}</p></div></div>
                  <span className="shrink-0 text-xs text-slate-400">{timeAgo(a.lastSeenAt, lang as Lang)}</span>
                </div>
              );
            })}
            {openAlerts.length === 0 && <p className="text-slate-400 text-sm py-3">{lang === 'ar' ? 'لا توجد تنبيهات' : 'No open alerts'}</p>}
          </div>
        </div>

        {/* Service history */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-900 mb-3 flex items-center gap-2"><Clock className="w-4 h-4 text-slate-500" /> {t.serviceHistory}</h2>
          <div className="divide-y divide-slate-100">
            {d.serviceLog.map((s: any) => (
              <div key={s._id} className="py-2.5 flex items-center justify-between gap-3">
                <div className="min-w-0"><p className="text-sm text-slate-800">{s.serviceType} · {fmtKm(s.odometerKm)}</p>{s.notes && <p className="text-xs text-slate-400 truncate">{s.notes}</p>}<p className="text-xs text-slate-400">{s.performedByName}</p></div>
                <span className="shrink-0 text-xs text-slate-400">{fmtDateTime(s.createdAt, lang as Lang)}</span>
              </div>
            ))}
            {d.serviceLog.length === 0 && <p className="text-slate-400 text-sm py-3">{t.noData}</p>}
          </div>
        </div>
      </div>

      <Modal open={svcOpen} onClose={() => setSvcOpen(false)} title={`${t.markServiced} · ${v.plate}`}
        footer={<><button type="button" onClick={() => setSvcOpen(false)} className="px-4 py-2 rounded-lg text-slate-600 hover:bg-slate-100 text-sm">{t.cancel}</button><PrimaryButton onClick={submitService} disabled={saving}>{t.confirm}</PrimaryButton></>}>
        <div className="space-y-4">
          <Field label={t.serviceType}>
            <Select value={form.serviceType} onChange={(e) => setForm((p) => ({ ...p, serviceType: e.target.value }))}>
              <option value="periodic">{lang === 'ar' ? 'صيانة دورية' : 'Periodic'}</option>
              <option value="repair">{lang === 'ar' ? 'إصلاح' : 'Repair'}</option>
              <option value="tires">{lang === 'ar' ? 'كاوتش' : 'Tires'}</option>
              <option value="other">{lang === 'ar' ? 'أخرى' : 'Other'}</option>
            </Select>
          </Field>
          <Field label={`${t.odometer} (km)`}><TextInput type="number" value={form.odometerKm} onChange={(e) => setForm((p) => ({ ...p, odometerKm: e.target.value }))} /></Field>
          <Field label={t.notes}><TextArea rows={3} value={form.notes} onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))} /></Field>
        </div>
      </Modal>
    </div>
  );
}

function Row({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return <div className="flex items-center justify-between"><span className="text-xs text-slate-500">{label}</span><span className={`text-sm font-semibold tabular-nums ${accent || 'text-slate-800'}`}>{value}</span></div>;
}

function TireLayout({ tires, t, lang }: { tires: Tire[]; t: any; lang: Lang }) {
  if (!tires || tires.length === 0) return <p className="text-slate-400 text-sm py-4 text-center">{t.noTireData}</p>;
  const axles = [...new Set(tires.map((x) => x.axle))].sort((a, b) => a - b);
  return (
    <div className="space-y-3">
      {axles.map((axle) => {
        const row = tires.filter((x) => x.axle === axle).sort((a, b) => a.position - b.position);
        return (
          <div key={axle} className="flex items-center gap-3">
            <span className="w-16 shrink-0 text-xs font-semibold text-slate-500">{t.axle} {axle}</span>
            <div className="flex flex-wrap gap-2">
              {row.map((tire) => (
                <div key={`${axle}-${tire.position}`} className={`rounded-lg px-3 py-2 min-w-[92px] text-center border ${tire.fault ? 'bg-slate-50 border-slate-200 text-slate-400' : `${tireTempColor(tire.tempC)} border-transparent`}`}>
                  <p className="text-[10px] opacity-70">{lang === 'ar' ? 'إطار' : 'Tire'} {tire.position}</p>
                  <p className="text-sm font-bold">{tire.fault ? (lang === 'ar' ? 'عطل' : 'Fault') : (tire.tempC != null ? `${tire.tempC}°C` : '—')}</p>
                  <p className="text-[10px] opacity-80">{tire.pressurePsi != null ? `${tire.pressurePsi} psi` : '—'}</p>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
