'use client';
// The workshop store (المستودع) in one screen: every physical thing the shop
// holds, and for each piece whether it is FITTED to a truck (which one, which
// position) or sitting on the shelf.
//
// The workshop is the shop floor for the Location Solutions fleet, so the tires,
// flatbeds and trailers here are the same registry that section tracks — read
// only. Fitting and moving stays on /system/ls2/fleet-assets, which owns the
// event trail; duplicating those actions here would give one asset two histories.
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import { canAccessSection } from '@/lib/sections';
import Link from 'next/link';
import { Boxes, CircleDot, Container, Truck, Wrench, AlertTriangle, ExternalLink } from 'lucide-react';
import { exportMultiSheet } from '@/utils/exportExcel';
import {
  Spinner, PageHeader, SearchInput, ExportButton, StatCard, SmallBadge, Select, Tabs, ErrorNotice,
} from '@/components/hr/HRKit';
import { getWorkshopStoreTranslations } from '@/lib/translations';
// The spare-parts tab mounts the same panel that /workshop/inventory serves, so
// the add/edit/approve/delete CRUD has exactly ONE implementation.
import { InventoryPanel } from '@/components/workshop/InventoryPanel';

const STAFF = ['super_admin', 'it_manager', 'it_specialist', 'workshop_manager', 'workshop_employee', 'procurement_staff'];

interface StoreTire {
  _id: string; serial: string; tireNumber?: string; type?: string; sensor?: string;
  status: string; plate?: string | null; positionNumber?: number | null;
  positionLabel?: string; section?: string; notes?: string;
  fitted: boolean; vehicleName?: string;
}
interface StoreFlatbed {
  _id: string; numbering?: number | null; plate: string; batch?: string; brand?: string;
  currentTrailerNumber?: string | null; vehicleName?: string; notes?: string;
}
interface StoreTrailer {
  _id: string; trailerNumber: string; currentPlate?: string | null; status: string;
  fitted: boolean; vehicleName?: string; notes?: string;
}
interface StorePart {
  _id: string; code: string; name: string; category?: string; quantity: number;
  minQuantity?: number; unit?: string; costPrice?: number; location?: string;
  supplier?: string; notes?: string; isLow: boolean; totalValue: number;
}
interface StoreData {
  summary: {
    tires: { total: number; mounted: number; spare: number; inRepair?: number; retired: number; withSensor: number };
    flatbeds: { total: number; hitched: number };
    trailers: { total: number; fitted: number; spare: number; retired: number };
    parts: { lines: number; units: number; low: number; outOfStock: number; value: number };
  };
  tires: StoreTire[]; flatbeds: StoreFlatbed[]; trailers: StoreTrailer[]; parts: StorePart[];
}

const money = (n: number) => (n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });

export default function WorkshopStorePage() {
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const tx = getWorkshopStoreTranslations(lang);
  // Role list OR a permissions-matrix grant — a granted role otherwise gets
  // the nav link and a dead not-authorized screen.
  const staff = (!!user?.role && STAFF.includes(user.role)) || canAccessSection((user as any)?.permissions, 'Workshop');

  const [data, setData] = useState<StoreData | null>(null);
  const [loading, setLoading] = useState(true);
  // Never swallow a load failure: an expired session and an empty store look
  // identical once the tables render blank, and the user goes looking for lost
  // records instead of signing back in.
  const [error, setError] = useState('');
  const [tab, setTab] = useState('overview');
  const [search, setSearch] = useState('');
  // The question this screen exists to answer, so it gets a first-class filter
  // rather than being buried in a column.
  const [placement, setPlacement] = useState<'' | 'fitted' | 'store' | 'repair'>('');

  const load = useCallback(async () => {
    try {
      const d = await api.get<StoreData>('/api/workshop/store');
      setData(d);
      setError('');
    } catch (e: any) {
      setError(e?.message || 'Request failed');
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);
  // The ls2 section owns the mounting actions, so listen to its events too —
  // fitting a tire there must not leave this screen stale.
  useSocket('ls2:updated', useCallback(() => load(), [load]));
  // Stock moves on these two — 'workshop:updated' never existed as an event.
  useSocket('inventory:updated', useCallback(() => load(), [load]));
  useSocket('purchase:received', useCallback(() => load(), [load]));

  const hit = useCallback((...fields: (string | number | null | undefined)[]) => {
    const s = search.trim().toLowerCase();
    if (!s) return true;
    return fields.some((v) => String(v ?? '').toLowerCase().includes(s));
  }, [search]);

  const tires = useMemo(() => (data?.tires || [])
    .filter((t) => {
      if (!placement) return true;
      if (placement === 'fitted') return t.fitted;
      if (placement === 'repair') return t.status === 'in_repair';
      return !t.fitted && t.status !== 'in_repair'; // the shelf, strictly
    })
    .filter((t) => hit(t.serial, t.tireNumber, t.type, t.vehicleName, t.plate, t.positionLabel, t.section)),
  [data, placement, hit]);

  const flatbeds = useMemo(() => (data?.flatbeds || [])
    .filter((f) => hit(f.plate, f.numbering, f.batch, f.brand, f.vehicleName, f.currentTrailerNumber)),
  [data, hit]);

  const trailers = useMemo(() => (data?.trailers || [])
    .filter((t) => !placement || (placement === 'fitted' ? t.fitted : !t.fitted))
    .filter((t) => hit(t.trailerNumber, t.currentPlate, t.vehicleName)),
  [data, hit, placement]);

  const parts = useMemo(() => (data?.parts || [])
    .filter((p) => hit(p.code, p.name, p.category, p.location, p.supplier)),
  [data, hit]);

  if (!staff) return <div className="text-slate-500 p-8">{tx.notAuthorized}</div>;
  if (loading) return <Spinner />;
  const s = data?.summary;

  const exportAll = () => exportMultiSheet([
    {
      name: 'Summary',
      columns: [{ header: 'Item', key: 'k', width: 34 }, { header: 'Count', key: 'v', width: 14 }],
      data: [
        { k: 'Tires — total', v: s?.tires.total ?? 0 },
        { k: 'Tires — fitted to a vehicle', v: s?.tires.mounted ?? 0 },
        { k: 'Tires — in store (spare)', v: s?.tires.spare ?? 0 },
        { k: 'Tires — in repair', v: s?.tires.inRepair ?? 0 },
        { k: 'Tires — retired', v: s?.tires.retired ?? 0 },
        { k: 'Tires — with a sensor', v: s?.tires.withSensor ?? 0 },
        { k: 'Flatbeds — total', v: s?.flatbeds.total ?? 0 },
        { k: 'Flatbeds — with a trailer hitched', v: s?.flatbeds.hitched ?? 0 },
        { k: 'Trailers — total', v: s?.trailers.total ?? 0 },
        { k: 'Trailers — fitted', v: s?.trailers.fitted ?? 0 },
        { k: 'Spare parts — lines', v: s?.parts.lines ?? 0 },
        { k: 'Spare parts — units', v: s?.parts.units ?? 0 },
        { k: 'Spare parts — below minimum', v: s?.parts.low ?? 0 },
        { k: 'Spare parts — stock value', v: s?.parts.value ?? 0 },
      ],
    },
    {
      name: 'Tires',
      columns: [
        { header: 'Serial', key: 'serial', width: 20 },
        { header: 'Tag no.', key: 'tireNumber', width: 10 },
        { header: 'Brand', key: 'type', width: 16 },
        { header: 'Sensor', key: 'sensor', width: 10 },
        { header: 'Placement', key: 'fitted', transform: (v: any) => (v ? 'Fitted to vehicle' : 'In store'), width: 18 },
        { header: 'Vehicle', key: 'vehicleName', width: 26 },
        { header: 'Position', key: 'positionLabel', width: 20 },
        { header: 'Section', key: 'section', width: 20 },
      ],
      data: data?.tires || [],
    },
    {
      name: 'Flatbeds',
      columns: [
        { header: 'No.', key: 'numbering', width: 8 },
        { header: 'Plate', key: 'plate', width: 14 },
        { header: 'Batch', key: 'batch', width: 12 },
        { header: 'Brand', key: 'brand', width: 16 },
        { header: 'Live unit', key: 'vehicleName', width: 26 },
        { header: 'Trailer hitched', key: 'currentTrailerNumber', width: 16 },
      ],
      data: data?.flatbeds || [],
    },
    {
      name: 'Trailers',
      columns: [
        { header: 'Trailer no.', key: 'trailerNumber', width: 12 },
        { header: 'Status', key: 'status', width: 12 },
        { header: 'Placement', key: 'fitted', transform: (v: any) => (v ? 'Fitted to vehicle' : 'In store'), width: 18 },
        { header: 'Vehicle', key: 'vehicleName', width: 26 },
      ],
      data: data?.trailers || [],
    },
    {
      name: 'Spare parts',
      columns: [
        { header: 'Code', key: 'code', width: 14 },
        { header: 'Name', key: 'name', width: 28 },
        { header: 'Category', key: 'category', width: 18 },
        { header: 'Quantity', key: 'quantity', width: 10 },
        { header: 'Minimum', key: 'minQuantity', width: 10 },
        { header: 'Unit', key: 'unit', width: 10 },
        { header: 'Unit cost', key: 'costPrice', width: 12 },
        { header: 'Total value', key: 'totalValue', width: 14 },
        { header: 'Location', key: 'location', width: 18 },
        { header: 'Supplier', key: 'supplier', width: 20 },
      ],
      data: data?.parts || [],
    },
  ], `workshop-store-${new Date().toISOString().slice(0, 10)}`);

  const placementBadge = (fitted: boolean, vehicleName?: string, status?: string) => (fitted
    ? <SmallBadge bg="bg-blue-500/15" text="text-blue-700" label={`${tx.fitted}${vehicleName ? ` · ${vehicleName}` : ''}`} />
    : status === 'in_repair'
      ? <SmallBadge bg="bg-violet-500/15" text="text-violet-700" label={tx.inRepair} />
      : <SmallBadge bg="bg-emerald-500/15" text="text-emerald-700" label={tx.inStore} />);

  const th = 'text-start font-semibold px-4 py-3';
  const emptyRow = (cols: number) => (
    <tr><td colSpan={cols} className="text-center text-slate-500 py-12">{tx.noRows}</td></tr>
  );

  return (
    <div className="space-y-6" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader icon={<Boxes className="w-5 h-5" />} title={tx.pageTitle} subtitle={tx.subtitle}>
        <ExportButton label={tx.exportExcel} onClick={exportAll} />
      </PageHeader>

      {error && <ErrorNotice error={error} lang={lang} onRetry={load} />}

      {/* Serial-tracked assets and counted consumables are different kinds of
          thing; saying so up front stops people reading "140" as stock on hand. */}
      <div className="rounded-xl border border-blue-200 bg-blue-50/70 p-4 flex items-start gap-3">
        <Wrench className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
        <p className="text-xs text-blue-800 leading-relaxed">{tx.introNote}</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label={tx.statTires} value={`${s?.tires.total ?? 0}`} accent="text-[#f37121]" />
        <StatCard label={tx.statTiresSpare} value={`${s?.tires.spare ?? 0}`} accent={s?.tires.spare ? 'text-emerald-600' : 'text-red-600'} />
        <StatCard label={tx.statFlatbeds} value={`${s?.flatbeds.total ?? 0}`} accent="text-slate-900" />
        <StatCard label={tx.statTrailers} value={`${s?.trailers.total ?? 0}`} accent="text-slate-900" />
        <StatCard label={tx.statPartLines} value={`${s?.parts.lines ?? 0}`} accent="text-slate-900" />
        <StatCard label={tx.statPartUnits} value={`${s?.parts.units ?? 0}`} accent="text-slate-900" />
        <StatCard label={tx.statPartsLow} value={`${s?.parts.low ?? 0}`} accent={s?.parts.low ? 'text-red-600' : 'text-green-600'} />
        <StatCard label={tx.statPartsValue} value={money(s?.parts.value ?? 0)} accent="text-slate-900" />
      </div>

      {/* An empty shelf is a finding, not a blank screen — say it out loud. */}
      {s?.tires.spare === 0 && (s?.tires.total ?? 0) > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <p className="text-xs text-amber-900 leading-relaxed">{tx.noSpareTiresNote}</p>
        </div>
      )}

      <Tabs
        active={tab}
        onChange={setTab}
        tabs={[
          { key: 'overview', label: tx.tabOverview },
          { key: 'tires', label: tx.tabTires, badge: data?.tires.length },
          { key: 'flatbeds', label: tx.tabFlatbeds, badge: data?.flatbeds.length },
          { key: 'trailers', label: tx.tabTrailers, badge: data?.trailers.length },
          { key: 'parts', label: tx.tabParts, badge: data?.parts.length },
        ]}
      />

      {tab !== 'overview' && tab !== 'parts' && (
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="flex-1 min-w-[240px]"><SearchInput value={search} onChange={setSearch} placeholder={tx.searchPlaceholder} /></div>
          {/* These tabs are read-only here on purpose, so give the edit path a
              visible door instead of leaving people looking for a button. */}
          <Link href="/system/ls2/fleet-assets"
            className="shrink-0 flex items-center gap-1.5 px-3 py-2.5 rounded-lg bg-[#f37121]/10 text-[#f37121] hover:bg-[#f37121]/20 text-sm font-medium transition-colors">
            <ExternalLink className="w-4 h-4" /> {tx.manageAssets}
          </Link>
          {(tab === 'tires' || tab === 'trailers') && (
            <div className="w-full sm:w-52 shrink-0">
              <Select value={placement} onChange={(e) => setPlacement(e.target.value as any)}>
                <option value="">{tx.filterAllPlacements}</option>
                <option value="fitted">{tx.fitted}</option>
                <option value="store">{tx.inStore}</option>
                {tab === 'tires' && <option value="repair">{tx.inRepair}</option>}
              </Select>
            </div>
          )}
        </div>
      )}

      {tab === 'overview' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-5">
            <p className="text-sm font-semibold text-slate-900 mb-3 flex items-center gap-2"><CircleDot className="w-4 h-4 text-[#f37121]" /> {tx.tabTires}</p>
            <dl className="space-y-2 text-sm">
              {[
                [tx.rowTotal, s?.tires.total],
                [tx.rowFitted, s?.tires.mounted],
                [tx.rowInStore, s?.tires.spare],
                [tx.inRepair, s?.tires.inRepair],
                [tx.rowRetired, s?.tires.retired],
                [tx.rowWithSensor, s?.tires.withSensor],
              ].map(([k, v]) => (
                <div key={k as string} className="flex items-center justify-between border-b border-slate-100 pb-1.5 last:border-0">
                  <dt className="text-slate-500">{k}</dt><dd className="font-semibold text-slate-900">{v ?? 0}</dd>
                </div>
              ))}
            </dl>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-5">
            <p className="text-sm font-semibold text-slate-900 mb-3 flex items-center gap-2"><Container className="w-4 h-4 text-[#f37121]" /> {tx.tabFlatbeds} · {tx.tabTrailers}</p>
            <dl className="space-y-2 text-sm">
              {[
                [tx.rowFlatbedsTotal, s?.flatbeds.total],
                [tx.rowFlatbedsHitched, s?.flatbeds.hitched],
                [tx.rowTrailersTotal, s?.trailers.total],
                [tx.rowTrailersFitted, s?.trailers.fitted],
                [tx.rowInStore, s?.trailers.spare],
              ].map(([k, v]) => (
                <div key={k as string} className="flex items-center justify-between border-b border-slate-100 pb-1.5 last:border-0">
                  <dt className="text-slate-500">{k}</dt><dd className="font-semibold text-slate-900">{v ?? 0}</dd>
                </div>
              ))}
            </dl>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-5 lg:col-span-2">
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-semibold text-slate-900 flex items-center gap-2"><Boxes className="w-4 h-4 text-[#f37121]" /> {tx.tabParts}</p>
              <Link href="/system/workshop/inventory" className="text-xs text-[#f37121] hover:underline flex items-center gap-1">
                {tx.manageParts} <ExternalLink className="w-3 h-3" />
              </Link>
            </div>
            <dl className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
              {[
                [tx.rowPartLines, s?.parts.lines],
                [tx.rowPartUnits, s?.parts.units],
                [tx.rowPartsLow, s?.parts.low],
                [tx.rowPartsOut, s?.parts.outOfStock],
              ].map(([k, v]) => (
                <div key={k as string}>
                  <dt className="text-slate-500 text-xs mb-0.5">{k}</dt>
                  <dd className="font-semibold text-slate-900 text-lg">{v ?? 0}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      )}

      {tab === 'tires' && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto shadow-sm">
          <table className="w-full text-sm">
            <thead><tr className="bg-slate-900 border-b border-slate-200 text-slate-300">
              <th className={th}>{tx.colSerial}</th>
              <th className={th}>{tx.colTag}</th>
              <th className={th}>{tx.colBrand}</th>
              <th className={th}>{tx.colSensor}</th>
              <th className={th}>{tx.colPlacement}</th>
              <th className={th}>{tx.colPosition}</th>
            </tr></thead>
            <tbody>
              {tires.length === 0 ? emptyRow(6) : tires.map((t) => (
                <tr key={t._id} className="border-b border-slate-200/70 hover:bg-slate-50">
                  <td className="px-4 py-3 text-slate-900 font-mono text-xs">{t.serial}</td>
                  <td className="px-4 py-3 text-slate-700">{t.tireNumber || '—'}</td>
                  <td className="px-4 py-3 text-slate-700">{t.type || '—'}</td>
                  <td className="px-4 py-3">
                    {t.sensor === 'yes'
                      ? <SmallBadge bg="bg-green-500/15" text="text-green-700" label={tx.sensorYes} />
                      : t.sensor === 'no'
                        ? <SmallBadge bg="bg-slate-500/15" text="text-slate-700" label={tx.sensorNo} />
                        : <SmallBadge bg="bg-amber-500/15" text="text-amber-700" label={tx.sensorUnknown} />}
                  </td>
                  <td className="px-4 py-3">{placementBadge(t.fitted, t.vehicleName, t.status)}</td>
                  <td className="px-4 py-3 text-slate-700 text-xs">
                    {t.fitted ? [t.positionLabel, t.section].filter(Boolean).join(' — ') || '—' : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'flatbeds' && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto shadow-sm">
          <table className="w-full text-sm">
            <thead><tr className="bg-slate-900 border-b border-slate-200 text-slate-300">
              <th className={th}>{tx.colNumber}</th>
              <th className={th}>{tx.colPlate}</th>
              <th className={th}>{tx.colBatch}</th>
              <th className={th}>{tx.colBrand}</th>
              <th className={th}>{tx.colLiveUnit}</th>
              <th className={th}>{tx.colTrailer}</th>
            </tr></thead>
            <tbody>
              {flatbeds.length === 0 ? emptyRow(6) : flatbeds.map((f) => (
                <tr key={f._id} className="border-b border-slate-200/70 hover:bg-slate-50">
                  <td className="px-4 py-3 text-slate-900 font-semibold">{f.numbering ?? '—'}</td>
                  <td className="px-4 py-3 text-slate-700">{f.plate}</td>
                  <td className="px-4 py-3 text-slate-700">{f.batch || '—'}</td>
                  <td className="px-4 py-3 text-slate-700">{f.brand || '—'}</td>
                  <td className="px-4 py-3 text-slate-700 text-xs">
                    {f.vehicleName || <span className="text-amber-600">{tx.noLiveUnit}</span>}
                  </td>
                  <td className="px-4 py-3">
                    {f.currentTrailerNumber
                      ? <SmallBadge bg="bg-blue-500/15" text="text-blue-700" label={`${tx.trailerNo} ${f.currentTrailerNumber}`} />
                      : <span className="text-slate-400">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'trailers' && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto shadow-sm">
          <table className="w-full text-sm">
            <thead><tr className="bg-slate-900 border-b border-slate-200 text-slate-300">
              <th className={th}>{tx.colTrailerNo}</th>
              <th className={th}>{tx.colStatus}</th>
              <th className={th}>{tx.colPlacement}</th>
            </tr></thead>
            <tbody>
              {trailers.length === 0 ? emptyRow(3) : trailers.map((t) => (
                <tr key={t._id} className="border-b border-slate-200/70 hover:bg-slate-50">
                  <td className="px-4 py-3 text-slate-900 font-semibold">{t.trailerNumber}</td>
                  <td className="px-4 py-3 text-slate-700">{t.status}</td>
                  <td className="px-4 py-3">{placementBadge(t.fitted, t.vehicleName)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'parts' && (
        <div className="-mt-2">
          <InventoryPanel embedded />
        </div>
      )}

      <p className="text-xs text-slate-400 flex items-center gap-1.5">
        <Truck className="w-3.5 h-3.5" />
        {tx.footNote}{' '}
        <Link href="/system/ls2/fleet-assets" className="text-[#f37121] hover:underline">{tx.fleetAssetsLink}</Link>
      </p>
    </div>
  );
}
