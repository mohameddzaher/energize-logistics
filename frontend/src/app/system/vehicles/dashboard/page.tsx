'use client';
import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import { Truck, AlertTriangle, Clock } from 'lucide-react';
import {
  VEHICLE_TYPES, VEHICLE_STATUS, ACCIDENT_SEVERITY, ACCIDENT_STATUS, FAULT_PARTY,
  isVehicleStaff, vehicleTypeLabel, faultPartyLabel, empRefName, plateOf,
  getVehiclesText, fmtDate, daysUntil,
} from '@/lib/vehicles';
import { Spinner, PageHeader, StatCard, Badge } from '@/components/hr/HRKit';

interface BranchRow { _id: string; name?: string; count: number }
interface Dash {
  totals: {
    vehicles: number; authorized: number; parked: number; available: number;
    maintenance: number; outOfService: number; activeAuthorizations: number;
    openAccidents: number; totalAccidents: number;
    estimatedAccidentCost: number; actualAccidentCost: number;
    expiringAuthorizations: number; expiredAuthorizations: number;
  };
  byType: Record<string, number>;
  byStatus: Record<string, number>;
  byBranch: BranchRow[];
  accidents: {
    bySeverity: Record<string, number>;
    byFault: Record<string, number>;
    byStatus: Record<string, number>;
  };
  expiringAuthorizations: any[];
  recentAccidents: any[];
  recentAuthorizations: any[];
}

const vehicleId = (v: any) => (typeof v === 'object' ? v?._id : v);

export default function VehiclesDashboardPage() {
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const tx = getVehiclesText(lang);
  const staff = isVehicleStaff(user);
  const [data, setData] = useState<Dash | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try { setData(await api.get<Dash>('/api/vehicles/dashboard')); } catch {}
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);
  useSocket('vehicle:updated', useCallback(() => load(), [load]));
  useSocket('vehicle:authorization', useCallback(() => load(), [load]));
  useSocket('vehicle:accident', useCallback(() => load(), [load]));

  if (!staff) return <div className="text-slate-500 p-8">{tx.notAuthorized}</div>;
  if (loading || !data) return <Spinner />;

  const t = data.totals;
  const fmtSAR = (n: number) => `${(n || 0).toLocaleString(ar ? 'ar-EG' : 'en-US')} ${ar ? 'ر.س' : 'SAR'}`;

  // Reusable clickable breakdown row.
  const Row = ({ href, label, count, badge }: { href: string; label: React.ReactNode; count: number; badge?: React.ReactNode }) => (
    <Link href={href} className="flex justify-between items-center border-b border-slate-200/70 pb-2 hover:bg-slate-50 rounded px-1">
      <span className="text-slate-600 text-sm flex items-center gap-2">{badge}{label}</span>
      <span className="text-slate-900 font-semibold">{count}</span>
    </Link>
  );

  return (
    <div className="space-y-6" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader icon={<Truck className="w-5 h-5" />} title={tx.dashboardTitle} subtitle={tx.dashboardSubtitle} />

      {/* KPI row 1 — fleet status */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Link href="/system/vehicles"><StatCard label={tx.totalVehicles} value={t.vehicles} /></Link>
        <Link href="/system/vehicles?status=authorized"><StatCard label={tx.authorized} value={t.authorized} accent="text-green-600" /></Link>
        <Link href="/system/vehicles?status=parked"><StatCard label={tx.parked} value={t.parked} accent="text-amber-700" /></Link>
        <Link href="/system/vehicles?status=available"><StatCard label={tx.available} value={t.available} accent="text-slate-600" /></Link>
      </div>

      {/* KPI row 2 — maintenance / accidents / costs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Link href="/system/vehicles?status=maintenance"><StatCard label={tx.maintenance} value={t.maintenance} accent="text-blue-600" /></Link>
        <Link href="/system/vehicles?status=out_of_service"><StatCard label={tx.outOfService} value={t.outOfService} accent="text-red-600" /></Link>
        <Link href="/system/vehicles/accidents?status=reported"><StatCard label={tx.openAccidents} value={t.openAccidents} accent="text-red-600" /></Link>
        <Link href="/system/vehicles/accidents"><StatCard label={tx.totalAccidents} value={t.totalAccidents} /></Link>
      </div>

      {/* KPI row 3 — costs + expiry */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Link href="/system/vehicles/accidents"><StatCard label={tx.estimatedCostTotal} value={fmtSAR(t.estimatedAccidentCost)} accent="text-amber-700" /></Link>
        <Link href="/system/vehicles/accidents"><StatCard label={tx.actualCostTotal} value={fmtSAR(t.actualAccidentCost)} accent="text-red-600" /></Link>
        <Link href="/system/vehicles?status=authorized"><StatCard label={tx.activeAuthorizations} value={t.activeAuthorizations} accent="text-green-600" /></Link>
        <StatCard label={tx.expiringAuthorizations} value={t.expiringAuthorizations} accent={t.expiredAuthorizations > 0 ? 'text-red-600' : 'text-amber-700'} />
      </div>

      {/* By Type / By Status (now clickable) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
          <h3 className="text-[#f37121] text-sm font-semibold mb-3">{tx.byType}</h3>
          <div className="space-y-2">
            {VEHICLE_TYPES.filter((ty) => data.byType[ty.key]).map((ty) => (
              <Row key={ty.key} href={`/system/vehicles?type=${ty.key}`} label={ar ? ty.ar : ty.en} count={data.byType[ty.key]} />
            ))}
            {Object.keys(data.byType).length === 0 && <p className="text-slate-400 text-sm">{tx.noData}</p>}
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
          <h3 className="text-[#f37121] text-sm font-semibold mb-3">{tx.byStatus}</h3>
          <div className="space-y-2">
            {Object.entries(VEHICLE_STATUS).filter(([k]) => data.byStatus[k]).map(([k, v]) => (
              <Row key={k} href={`/system/vehicles?status=${k}`} label={ar ? v.ar : v.en} count={data.byStatus[k]} />
            ))}
            {Object.keys(data.byStatus).length === 0 && <p className="text-slate-400 text-sm">{tx.noData}</p>}
          </div>
        </div>
      </div>

      {/* By Branch (only if any populated) */}
      {data.byBranch.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
          <h3 className="text-[#f37121] text-sm font-semibold mb-3">{tx.byBranch}</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-2">
            {data.byBranch.map((b) => (
              <Row key={b._id} href={`/system/vehicles?branch=${b._id}`} label={b.name || '—'} count={b.count} />
            ))}
          </div>
        </div>
      )}

      {/* Accidents breakdown: severity / fault / status (all clickable to register) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
          <h3 className="text-[#f37121] text-sm font-semibold mb-3">{tx.accidentsBySeverity}</h3>
          <div className="space-y-2">
            {Object.entries(ACCIDENT_SEVERITY).filter(([k]) => data.accidents.bySeverity[k]).map(([k, v]) => (
              <Row key={k} href="/system/vehicles/accidents" label={ar ? v.ar : v.en}
                count={data.accidents.bySeverity[k]} badge={<span className={`inline-block w-2 h-2 rounded-full ${v.text.replace('text-', 'bg-')}`} />} />
            ))}
            {Object.keys(data.accidents.bySeverity).length === 0 && <p className="text-slate-400 text-sm">{tx.noData}</p>}
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
          <h3 className="text-[#f37121] text-sm font-semibold mb-3">{tx.accidentsByFault}</h3>
          <div className="space-y-2">
            {FAULT_PARTY.filter((f) => data.accidents.byFault[f.key]).map((f) => (
              <Row key={f.key} href="/system/vehicles/accidents" label={ar ? f.ar : f.en} count={data.accidents.byFault[f.key]} />
            ))}
            {Object.keys(data.accidents.byFault).length === 0 && <p className="text-slate-400 text-sm">{tx.noData}</p>}
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
          <h3 className="text-[#f37121] text-sm font-semibold mb-3">{tx.accidentsByStatus}</h3>
          <div className="space-y-2">
            {Object.entries(ACCIDENT_STATUS).filter(([k]) => data.accidents.byStatus[k]).map(([k, v]) => (
              <Row key={k} href={`/system/vehicles/accidents?status=${k}`} label={ar ? v.ar : v.en} count={data.accidents.byStatus[k]} />
            ))}
            {Object.keys(data.accidents.byStatus).length === 0 && <p className="text-slate-400 text-sm">{tx.noData}</p>}
          </div>
        </div>
      </div>

      {/* Authorization document expiry alert feed */}
      {data.expiringAuthorizations.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
          <h3 className="text-slate-900 font-semibold mb-1 flex items-center gap-2">
            <Clock className="w-4 h-4 text-amber-600" /> {tx.expiringAuthorizations}
          </h3>
          <p className="text-slate-400 text-xs mb-3">{tx.expiringAuthsSubtitle}</p>
          <div className="space-y-2">
            {data.expiringAuthorizations.map((a) => {
              const d = daysUntil(a.documentExpiry);
              const expired = d !== null && d < 0;
              return (
                <Link key={a._id} href={`/system/vehicles/${vehicleId(a.vehicle)}`}
                  className="flex justify-between items-center border-b border-slate-200/70 pb-2 hover:bg-slate-50 rounded px-1">
                  <div className="text-sm">
                    <span className="text-slate-900 font-medium">{plateOf(a.vehicle)}</span>
                    <span className="text-slate-500 text-xs"> · {empRefName(a.employee, lang)}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-slate-400 text-xs">{fmtDate(a.documentExpiry)}</span>
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded ${expired ? 'bg-red-500/20 text-red-600' : 'bg-amber-500/20 text-amber-700'}`}>
                      {expired ? tx.expired : (ar ? `باقي ${d} يوم` : `${d}d`)}
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {/* Recent authorizations / accidents */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
          <h3 className="text-slate-900 font-semibold mb-3">{tx.recentAuthorizations}</h3>
          {data.recentAuthorizations.length === 0 ? <p className="text-slate-400 text-sm">{tx.noData}</p> : (
            <div className="space-y-2">
              {data.recentAuthorizations.map((a) => (
                <Link key={a._id} href={`/system/vehicles/${vehicleId(a.vehicle)}`} className="block border-b border-slate-200/70 pb-2 hover:bg-slate-50 rounded px-1">
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-900 font-medium">{plateOf(a.vehicle)}</span>
                    <span className="text-slate-400 text-xs">{fmtDate(a.startDate)}</span>
                  </div>
                  <span className="text-slate-500 text-xs">{empRefName(a.employee, lang)}</span>
                </Link>
              ))}
            </div>
          )}
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
          <h3 className="text-slate-900 font-semibold mb-3 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-red-500" /> {tx.recentAccidents}
          </h3>
          {data.recentAccidents.length === 0 ? <p className="text-slate-400 text-sm">{tx.noData}</p> : (
            <div className="space-y-2">
              {data.recentAccidents.map((a) => (
                <Link key={a._id} href={`/system/vehicles/${vehicleId(a.vehicle)}`} className="block border-b border-slate-200/70 pb-2 hover:bg-slate-50 rounded px-1">
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-slate-900 font-medium">{plateOf(a.vehicle)}</span>
                    <Badge style={ACCIDENT_SEVERITY[a.severity || 'minor']} lang={lang} />
                  </div>
                  <span className="text-slate-500 text-xs">{fmtDate(a.date)} · {empRefName(a.employee, lang)}{a.faultParty ? ` · ${faultPartyLabel(a.faultParty, lang)}` : ''}</span>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
