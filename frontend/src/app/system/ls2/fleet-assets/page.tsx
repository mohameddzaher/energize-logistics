'use client';
// Fleet Assets — سجل السطحات والتيدرات وفردات الكاوتش.
//
// The live Wialon mirror knows sensors, not hardware: it cannot tell you WHICH
// physical tire (by serial) sits at position 9 of truck 8200, or which trailer
// is hitched to it. This page is the workshop's source of truth for exactly
// that: the 61 numbered flatbeds, every trailer, every tire by serial — where
// each one is NOW, and (via the history tab) everywhere it has ever been.
// Moving a tire or a trailer here writes an immutable event; nothing is lost.
//
// The "sensors" tab cross-checks what the workshop registered (يوجد / لايوجد)
// against what the live Wialon feed actually reports, per vehicle.
import { useState, useEffect, useCallback, useMemo, Fragment } from 'react';
import { useSocket } from '@/hooks/useSocket';
import Link from 'next/link';
import { useDialog } from '@/components/system/DialogProvider';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import api from '@/lib/api';
import {
  Truck, RefreshCw, Search, Plus, Upload, ArrowLeftRight, ArrowDownToLine, Pencil,
  Trash2, History, Radio, CircleDot, Container, ChevronDown, ChevronRight, X, ExternalLink,
  Wrench, Boxes,
  Repeat,
} from 'lucide-react';

import { Spinner, PageHeader } from '@/components/hr/HRKit';
import { ls2Text, isLs2Staff, isLs2Admin, fmtNum, fmtDateTime, type Lang } from '@/lib/ls2';
import ExportMenu, { type ExportColumn } from '@/components/ls2/ExportMenu';
import SearchSelect from '@/components/ls2/SearchSelect';
import VehicleAssetSheet from '@/components/ls2/VehicleAssetSheet';
import TireActions, { type TireActionHandlers } from '@/components/ls2/TireActions';
import FilterBar, { useChipFilter, type Chip } from '@/components/ls2/FilterBar';

// ---- Types mirroring /api/ls2/assets ---------------------------------------
interface Flatbed { _id: string; numbering: number | null; plate: string; plateKey: string; batch: string; brand: string; currentTrailerNumber: string | null; notes: string; tireCount: number; unitId: number | null; driver: string; odometerKm: number | null }
interface Trailer { _id: string; trailerNumber: string; currentPlate: string | null; status: string; notes: string }
interface TireAsset { _id: string; tireNumber: string; serial: string; type: string; size?: string; sensor: 'yes' | 'no' | 'unknown'; condition?: 'new' | 'used' | 'at_factory'; conditionPercent?: number | null; status: 'mounted' | 'spare' | 'in_repair' | 'scrap' | 'damaged' | 'retired' | 'sold'; plate: string | null; positionNumber: number | null; positionLabel: string; section: string; plateKey?: string | null; isSpare?: boolean; notes: string }
interface AssetEvent { _id: string; entityType: string; label: string; action: string; fromPlate: string | null; fromPosition: string; toPlate: string | null; toPosition: string; date: string; odometerKm: number | null; reason: string; notes: string; performedByName: string }
interface SensorRow { plate: string; unitId: number | null; driver: string; registeredTotal: number; registeredWithSensor: number; registeredSensorPositions: { positionNumber: number | null; positionLabel: string; section: string; serial: string }[]; liveReporting: number; liveTotal: number; livePositions: { axle: number; position: number }[]; match: boolean | null; hasLive: boolean }

// The workshop's 14-position scheme (matches the collected JSON exactly).
//
// نسخةٌ ثانيةٌ من الجدول تعيش في backend/src/services/ls2TireSensors.js، لأن
// الخادم يشتقّ منها عدد مواضع الشاحنة التي لم تُجرَد بعد ليحسب عمود «حساسات
// الكاوتش». فأيّ تعديلٍ هنا (إضافة موضعٍ أو تغيير قسمه) يجب أن يُنقل هناك،
// وإلا اختلف ما تعرضه هذه الشاشة عمّا يعدّه العمود.
const POSITION_DEFS: { n: number; label: string; section: string }[] = [
  { n: 1, label: 'اطار 1 يسار', section: 'الرأس' },
  { n: 2, label: 'اطار 2 يمين', section: 'الرأس' },
  { n: 3, label: 'اطار 3 خارجي يمين', section: 'المحور الخلفي للرأس' },
  { n: 4, label: 'اطار 4 داخلي يمين', section: 'المحور الخلفي للرأس' },
  { n: 5, label: 'اطار 5 داخلي يسار', section: 'المحور الخلفي للرأس' },
  { n: 6, label: 'اطار 6 خارجي يسار', section: 'المحور الخلفي للرأس' },
  { n: 7, label: 'اطار 7 يسار', section: 'التيدر' },
  { n: 8, label: 'اطار 8 يسار', section: 'التيدر' },
  { n: 9, label: 'اطار 9 يسار', section: 'التيدر' },
  { n: 10, label: 'اطار 10 يمين', section: 'التيدر' },
  { n: 11, label: 'اطار 11 يمين', section: 'التيدر' },
  { n: 12, label: 'اطار 12 يمين', section: 'التيدر' },
  { n: 13, label: 'اطار 13', section: 'الاستبن' },
  { n: 14, label: 'اطار 14', section: 'الاستبن' },
];

const ACTION_LABELS: Record<string, { en: string; ar: string; cls: string }> = {
  registered: { en: 'Registered', ar: 'تسجيل', cls: 'bg-slate-100 text-slate-600' },
  mounted: { en: 'Mounted', ar: 'تركيب', cls: 'bg-emerald-100 text-emerald-700' },
  removed: { en: 'Removed', ar: 'إنزال', cls: 'bg-amber-100 text-amber-700' },
  transferred: { en: 'Transferred', ar: 'نقل', cls: 'bg-blue-100 text-blue-700' },
  retired: { en: 'Retired', ar: 'إعدام', cls: 'bg-red-100 text-red-700' },
  updated: { en: 'Edited', ar: 'تعديل', cls: 'bg-slate-100 text-slate-500' },
  to_repair: { en: 'Sent to factory', ar: 'راحت المصنع', cls: 'bg-violet-100 text-violet-700' },
  from_repair: { en: 'Back from factory', ar: 'رجعت من المصنع', cls: 'bg-emerald-100 text-emerald-700' },
  renewed: { en: 'Renewed — usable', ar: 'نجح التجديد — صالحة', cls: 'bg-blue-100 text-blue-700' },
  scrapped: { en: 'Scrapped', ar: 'سكراب — للبيع', cls: 'bg-slate-200 text-slate-700' },
  damaged: { en: 'Damaged', ar: 'تالفة', cls: 'bg-red-100 text-red-700' },
};
const ENTITY_LABELS: Record<string, { en: string; ar: string }> = {
  tire: { en: 'Tire', ar: 'فردة كاوتش' },
  trailer: { en: 'Trailer', ar: 'تيدر' },
  flatbed: { en: 'Flatbed', ar: 'سطحة' },
};
const SENSOR_LABELS: Record<string, { en: string; ar: string; cls: string }> = {
  yes: { en: 'Has sensor', ar: 'يوجد', cls: 'bg-emerald-100 text-emerald-700' },
  no: { en: 'No sensor', ar: 'لا يوجد', cls: 'bg-slate-100 text-slate-500' },
  unknown: { en: 'Unknown', ar: 'غير محدد', cls: 'bg-slate-50 text-slate-400' },
};
// The tire's lifecycle exactly as the workshop runs it:
// جديد/مستعمل في المخزن ← مركّبة ← (in ⇒ out) ← في المصنع ← صالحة أو سكراب، أو تالفة.
const TIRE_STATUS_LABELS: Record<string, { en: string; ar: string; cls: string }> = {
  mounted: { en: 'Mounted', ar: 'مركّبة', cls: 'bg-emerald-100 text-emerald-700' },
  spare: { en: 'In stock', ar: 'في المخزن', cls: 'bg-amber-100 text-amber-700' },
  in_repair: { en: 'At the factory', ar: 'في المصنع', cls: 'bg-violet-100 text-violet-700' },
  scrap: { en: 'Scrap (to sell)', ar: 'سكراب (للبيع)', cls: 'bg-slate-200 text-slate-700' },
  damaged: { en: 'Damaged (gone)', ar: 'تالفة', cls: 'bg-red-100 text-red-700' },
  sold: { en: 'Sold', ar: 'مباعة', cls: 'bg-emerald-100 text-emerald-700' },
  retired: { en: 'Retired (legacy)', ar: 'معدومة (قديم)', cls: 'bg-red-50 text-red-500' },
};
// درجة الفردة. «مجدد» كانت درجة لوحدها واندمجت في «مستعمل»: المجدَّدة مستعملة
// فعلًا، والورشة بتحطّها على نفس الرفّ وفي نفس المواضع — الفصل كان بيقسم مخزون
// واحد على خانتين وبس. و«في المصنع» درجة بتيجي من الحالة، مش اختيار يدوي.
const TIRE_CONDITION_LABELS: Record<string, { en: string; ar: string; cls: string }> = {
  new: { en: 'New', ar: 'جديد', cls: 'bg-emerald-50 text-emerald-700' },
  used: { en: 'Used', ar: 'مستعمل', cls: 'bg-slate-100 text-slate-600' },
  at_factory: { en: 'At the factory', ar: 'في المصنع', cls: 'bg-violet-100 text-violet-700' },
};

const inputCls = 'w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#f37121] bg-white';
const labelCls = 'block text-xs font-medium text-slate-500 mb-1';

// Options for the searchable pickers (61 flatbeds is far too many to scroll).
const flatbedOptions = (flatbeds: Flatbed[], ar: boolean) =>
  flatbeds.map((f) => ({
    value: f.plate,
    label: `${f.plate}${f.numbering != null ? ` (${ar ? 'ترقيم' : 'no.'} ${f.numbering})` : ''}`,
    hint: [f.brand, f.currentTrailerNumber ? `${ar ? 'تيدر' : 'trailer'} ${f.currentTrailerNumber}` : '', f.driver].filter(Boolean).join(' · '),
  }));
// Occupancy-aware: once a truck is chosen, every position says whether it is
// FREE (🟢 — ركّب هنا مباشرة) or already carries a tire (🔴 — التركيب هنا = استبدال),
// so the workshop picks an empty slot on purpose and knows a busy one means a swap.
// Matched on plateKey (digits-only) — a flatbed's plate string ("7362") often
// differs from the tire's stored plate, so a raw string match wrongly reports free.
const positionOptions = (toKey = '', tires: TireAsset[] = [], selfId = '', ar = false) =>
  POSITION_DEFS.map((p) => {
    const occ = toKey
      ? tires.find((x) => x._id !== selfId && x.status === 'mounted' && x.plateKey === toKey && x.positionNumber === p.n)
      : undefined;
    const mark = !toKey ? '' : occ ? '🔴 ' : '🟢 ';
    return {
      value: String(p.n),
      label: `${mark}${p.label} — ${p.section}`,
      hint: !toKey
        ? ''
        : occ
          ? (ar ? `عليها الفردة ${occ.serial}${occ.positionLabel ? ` (${occ.positionLabel})` : ''} — التركيب هنا = استبدال` : `holds ${occ.serial} — mounting here = replacement`)
          : (ar ? 'فارغة — لا يوجد كاوتش، ركّب هنا مباشرة' : 'empty — no tire, mount straight here'),
    };
  });

function Modal({ title, onClose, children, wide = false }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className={`bg-white rounded-xl shadow-xl w-full ${wide ? 'max-w-2xl' : 'max-w-md'} p-5 space-y-4 max-h-[90vh] overflow-y-auto`} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-slate-800">{title}</h3>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600"><X className="w-4 h-4" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

export default function Ls2FleetAssetsPage() {
  const { confirm, notify } = useDialog();
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const router = useRouter();
  const t = ls2Text(lang as Lang);
  const ar = lang === 'ar';
  const admin = isLs2Admin(user);

  // Deep-linkable: /system/ls2/fleet-assets?tab=tires&q=7360 lands filtered on
  // one truck's tires (the vehicle profile links here that way).
  const params = useSearchParams();
  const initialTab = params?.get('tab');
  const [tab, setTab] = useState<'flatbeds' | 'trailers' | 'tires' | 'store' | 'history' | 'sensors'>(
    initialTab === 'trailers' || initialTab === 'tires' || initialTab === 'history' || initialTab === 'sensors' ? initialTab : 'flatbeds'
  );
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState(params?.get('q') || '');
  const [flatbeds, setFlatbeds] = useState<Flatbed[]>([]);
  const [trailers, setTrailers] = useState<Trailer[]>([]);
  const [tires, setTires] = useState<TireAsset[]>([]);
  const [counts, setCounts] = useState<any>({});
  const [events, setEvents] = useState<AssetEvent[]>([]);
  const [sensorRows, setSensorRows] = useState<SensorRow[]>([]);
  const [openSensor, setOpenSensor] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  // بطاقات الحالة أعلى تبويب الكاوتشات تعمل كفلاتر — نقرة تحصر الجدول فيها.
  const [tireFilter, setTireFilter] = useState<'' | 'mounted' | 'unmounted' | 'store' | 'new' | 'used' | 'in_repair' | 'scrap' | 'damaged' | 'sold'>('');

  // ملف أصول عربية واحدة (الكاوتش + التاريخ) — بيتفتح من رقم الكاوتش في الجدول
  const [sheetPlate, setSheetPlate] = useState<string | null>(null);
  // بيتزوّد بعد أي عملية أو أي تحديث حي، فالشيت المفتوح يعيد تحميل نفسه بدل
  // ما يفضل شايف الحالة القديمة بعد ما المستخدم غيّرها من جوّاه.
  const [refreshKey, setRefreshKey] = useState(0);
  // Modals
  const [moveTire, setMoveTire] = useState<TireAsset | null>(null);
  const [downTire, setDownTire] = useState<TireAsset | null>(null); // إنزال: مخزن/تجديد/تالفة/سكراب + بديل
  const [editTire, setEditTire] = useState<TireAsset | null>(null);
  const [renewalTire, setRenewalTire] = useState<TireAsset | null>(null); // نتيجة التجديد: صالحة/سكراب
  const [retireTire, setRetireTire] = useState<TireAsset | null>(null);   // تالفة/سكراب
  const [statusTire, setStatusTire] = useState<TireAsset | null>(null);   // نقل بين الحالات
  const [addTire, setAddTire] = useState(false);
  const [moveTrailer, setMoveTrailer] = useState<Trailer | null>(null);
  const [addTrailer, setAddTrailer] = useState(false);
  const [editFlatbed, setEditFlatbed] = useState<Flatbed | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api.get<any>('/api/ls2/assets/overview');
      setFlatbeds(res.flatbeds || []); setTrailers(res.trailers || []); setTires(res.tires || []); setCounts(res.counts || {});
    } catch { /* keep */ }
    setLoading(false);
  }, []);
  const loadEvents = useCallback(async () => {
    try { const res = await api.get<{ events: AssetEvent[] }>('/api/ls2/assets/events?limit=500'); setEvents(res.events || []); } catch { /* keep */ }
  }, []);
  const loadSensors = useCallback(async () => {
    try { const res = await api.get<{ rows: SensorRow[] }>('/api/ls2/assets/sensor-check'); setSensorRows(res.rows || []); } catch { /* keep */ }
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (tab === 'history') loadEvents(); if (tab === 'sensors') loadSensors(); }, [tab, loadEvents, loadSensors]);
  // أي حركة على الأصول (تركيب/إنزال/تبديل/بيع…) — من هذه الشاشة أو أي مستخدم آخر —
  // تصل فورًا وتلقائيًا عبر السوكت، فتُحدَّث القوائم والسجل والسينسورات بلا تحديث يدوي.
  useSocket('ls2:updated', useCallback(() => {
    load();
    setRefreshKey((k) => k + 1);   // والشيت المفتوح كمان
    if (tab === 'history') loadEvents();
    if (tab === 'sensors') loadSensors();
  }, [load, loadEvents, loadSensors, tab]));

  const refreshAll = () => { setLoading(true); load(); if (tab === 'history') loadEvents(); if (tab === 'sensors') loadSensors(); };

  // ---- Filters ---------------------------------------------------------------
  // Fold Arabic orthography so a plain-alef query matches a hamza-alef record
  // (and ة/ه, ى/ي, ؤ/و, ئ/ي) — otherwise Arabic names/types silently miss.
  const norm = (s: any) => String(s ?? '')
    .replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه')
    .replace(/ؤ/g, 'و').replace(/ئ/g, 'ي').replace(/ـ/g, '')
    .replace(/[ً-ْ]/g, '')
    .toLowerCase().trim();
  // السطحات: الأسئلة اللي بتتسأل على الشاشة دي — مين ناقص كاوتش، ومين ماشي
  // من غير تيدر، ومين لسه ما اتجردش أصلاً.
  const [flatbedFilter, setFlatbedFilter] = useState('');
  const FLATBED_CHIPS: Chip[] = useMemo(() => [
    { key: '', label: ar ? 'الكل' : 'All' },
    { key: 'full', label: ar ? 'كاوتشها مكتمل (14)' : 'Full set (14)', tone: 'green', test: (f: any) => (f.tireCount || 0) >= 14 },
    { key: 'short', label: ar ? 'ناقصة كاوتش' : 'Short of tires', tone: 'amber', test: (f: any) => (f.tireCount || 0) > 0 && (f.tireCount || 0) < 14 },
    { key: 'none', label: ar ? 'لم تُجرَد بعد' : 'Not inventoried', tone: 'red', test: (f: any) => !(f.tireCount || 0) },
    { key: 'noTrailer', label: ar ? 'من غير تيدر' : 'No trailer', tone: 'violet', test: (f: any) => !f.currentTrailerNumber },
    { key: 'noGps', label: ar ? 'خارج نظام التتبّع' : 'Not on GPS', tone: 'slate', test: (f: any) => f.unitId == null },
  ], [ar]);
  const flatbedSearch = useCallback((f: any) => [f.plate, f.batch, f.brand, f.currentTrailerNumber, f.numbering, f.driver], []);
  const flatbedF = useChipFilter(flatbeds, FLATBED_CHIPS, flatbedFilter, q, flatbedSearch);
  const fFlatbeds = flatbedF.shown;
  // التيدرات: السؤال اليومي «مين واقف ومين مركّب» ماكانش ليه فلتر — بحث نصّي وبس.
  const [trailerFilter, setTrailerFilter] = useState('');
  const TRAILER_CHIPS: Chip[] = useMemo(() => [
    { key: '', label: ar ? 'الكل' : 'All' },
    { key: 'mounted', label: ar ? 'مركّبة على عربية' : 'On a vehicle', tone: 'green', test: (x: any) => !!x.currentPlate },
    { key: 'free', label: ar ? 'واقفة (غير مركّبة)' : 'Standing (unhitched)', tone: 'amber', test: (x: any) => !x.currentPlate && x.status !== 'retired' },
    { key: 'retired', label: ar ? 'خارج الخدمة' : 'Retired', tone: 'slate', test: (x: any) => x.status === 'retired' },
  ], [ar]);
  const trailerSearch = useCallback((x: any) => [x.trailerNumber, x.currentPlate, x.status, x.notes], []);
  const trailerF = useChipFilter(trailers, TRAILER_CHIPS, trailerFilter, q, trailerSearch);
  const fTrailers = trailerF.shown;
  const matchesTireFilter = useCallback((ti: TireAsset) => {
    switch (tireFilter) {
      case 'mounted': return ti.status === 'mounted';
      // «غير مركّبة» = أي فردة مش على مركبة حاليًا، مهما كانت حالتها: مخزن،
      // في المصنع، سكراب، تالفة، مباعة. مش نفس «في المخزن» — دي المتاحة
      // للتركيب بس، وفردة عند المصنع مش متاحة رغم إنها برضه غير مركّبة.
      case 'unmounted': return ti.status !== 'mounted';
      case 'store': return ti.status === 'spare';
      case 'new': return ti.status === 'spare' && (ti.condition || 'used') === 'new';
      case 'used': return ti.status === 'spare' && (ti.condition || 'used') !== 'new';
      case 'in_repair': return ti.status === 'in_repair';
      case 'scrap': return ti.status === 'scrap';
      case 'damaged': return ti.status === 'damaged';
      case 'sold': return ti.status === 'sold';
      default: return true;
    }
  }, [tireFilter]);
  const fTires = useMemo(() => tires.filter((ti) => matchesTireFilter(ti) && (!q || [ti.serial, ti.tireNumber, ti.type, ti.size, ti.condition, ti.plate, ti.section, ti.positionLabel, ti.status].some((x) => norm(x).includes(norm(q))))), [tires, q, matchesTireFilter]);
  const fEvents = useMemo(() => !q ? events : events.filter((e) => [e.label, e.fromPlate, e.toPlate, e.reason, e.action, e.performedByName].some((x) => norm(x).includes(norm(q)))), [events, q]);
  const fSensors = useMemo(() => !q ? sensorRows : sensorRows.filter((r) => [r.plate, r.driver].some((x) => norm(x).includes(norm(q)))), [sensorRows, q]);

  // ---- Export columns --------------------------------------------------------
  const flatbedCols: ExportColumn[] = [
    { header: ar ? 'الترقيم' : 'No.', key: 'numbering', width: 8 },
    { header: ar ? 'اللوحة' : 'Plate', key: 'plate', width: 10 },
    { header: ar ? 'الدفعة' : 'Batch', key: 'batch', width: 10 },
    { header: ar ? 'الماركة' : 'Brand', key: 'brand', width: 12 },
    { header: ar ? 'التيدر الحالي' : 'Trailer', key: 'currentTrailerNumber', transform: (v) => v ?? '', width: 10 },
    { header: ar ? 'السائق' : 'Driver', key: 'driver', width: 20 },
    { header: ar ? 'العداد (كم)' : 'Odometer (km)', key: 'odometerKm', transform: (v) => v ?? '', width: 13 },
    { header: ar ? 'كاوتشات مسجّلة' : 'Registered tires', key: 'tireCount', width: 13 },
  ];
  const trailerCols: ExportColumn[] = [
    { header: ar ? 'رقم التيدر' : 'Trailer no.', key: 'trailerNumber', width: 10 },
    { header: ar ? 'مركّب على' : 'On flatbed', key: 'currentPlate', transform: (v) => v ?? (ar ? 'غير مركّب' : 'unhitched'), width: 12 },
    { header: ar ? 'الحالة' : 'Status', key: 'status', width: 10 },
    { header: ar ? 'ملاحظات' : 'Notes', key: 'notes', width: 24 },
  ];
  const tireCols: ExportColumn[] = [
    { header: ar ? 'رقم الفردة' : 'Tire no.', key: 'tireNumber', width: 9 },
    { header: ar ? 'السيريال' : 'Serial', key: 'serial', width: 16 },
    { header: ar ? 'النوع' : 'Type', key: 'type', width: 12 },
    { header: ar ? 'المقاس' : 'Size', key: 'size', width: 12 },
    { header: ar ? 'سينسور' : 'Sensor', key: 'sensor', transform: (v) => (SENSOR_LABELS[v] ? (ar ? SENSOR_LABELS[v].ar : SENSOR_LABELS[v].en) : v), width: 9 },
    { header: ar ? 'الدرجة' : 'Grade', key: 'condition', transform: (v) => (TIRE_CONDITION_LABELS[v] ? (ar ? TIRE_CONDITION_LABELS[v].ar : TIRE_CONDITION_LABELS[v].en) : (ar ? 'مستعمل' : 'used')), width: 9 },
    { header: ar ? 'الحالة ٪' : 'Cond. %', key: 'conditionPercent', transform: (v) => (v != null ? `${v}%` : ''), width: 9 },
    { header: ar ? 'الحالة' : 'Status', key: 'status', transform: (v) => (TIRE_STATUS_LABELS[v] ? (ar ? TIRE_STATUS_LABELS[v].ar : TIRE_STATUS_LABELS[v].en) : v), width: 12 },
    { header: ar ? 'على السطحة' : 'On flatbed', key: 'plate', transform: (v) => v ?? '', width: 10 },
    { header: ar ? 'الموقع' : 'Position', key: 'positionLabel', width: 18 },
    { header: ar ? 'القسم' : 'Section', key: 'section', width: 16 },
    { header: ar ? 'استبن؟' : 'Spare?', key: 'isSpare', transform: (v) => (v ? (ar ? 'نعم' : 'Yes') : ''), width: 8 },
    { header: ar ? 'ملاحظات' : 'Notes', key: 'notes', width: 20 },
  ];
  const eventCols: ExportColumn[] = [
    { header: ar ? 'التاريخ' : 'Date', key: 'date', transform: (v) => (v ? new Date(v).toLocaleString('en-GB') : ''), width: 16 },
    { header: ar ? 'النوع' : 'Entity', key: 'entityType', transform: (v) => (ENTITY_LABELS[v] ? (ar ? ENTITY_LABELS[v].ar : ENTITY_LABELS[v].en) : v), width: 11 },
    { header: ar ? 'الأصل' : 'Asset', key: 'label', width: 14 },
    { header: ar ? 'الحركة' : 'Action', key: 'action', transform: (v) => (ACTION_LABELS[v] ? (ar ? ACTION_LABELS[v].ar : ACTION_LABELS[v].en) : v), width: 9 },
    { header: ar ? 'من' : 'From', key: 'fromPlate', transform: (v, r) => [v, r.fromPosition].filter(Boolean).join(' · '), width: 22 },
    { header: ar ? 'إلى' : 'To', key: 'toPlate', transform: (v, r) => [v, r.toPosition].filter(Boolean).join(' · '), width: 22 },
    { header: ar ? 'العداد (كم)' : 'Odometer', key: 'odometerKm', transform: (v) => v ?? '', width: 11 },
    { header: ar ? 'السبب' : 'Reason', key: 'reason', width: 24 },
    { header: ar ? 'بواسطة' : 'By', key: 'performedByName', width: 16 },
  ];
  const sensorCols: ExportColumn[] = [
    { header: ar ? 'اللوحة' : 'Plate', key: 'plate', width: 10 },
    { header: ar ? 'السائق' : 'Driver', key: 'driver', width: 20 },
    { header: ar ? 'كاوتشات مسجّلة' : 'Registered tires', key: 'registeredTotal', width: 13 },
    { header: ar ? 'مسجّل بها سينسور' : 'Registered w/ sensor', key: 'registeredWithSensor', width: 15 },
    { header: ar ? 'يرسل فعليًا (مباشر)' : 'Actually reporting', key: 'liveReporting', width: 15 },
    { header: ar ? 'مطابقة؟' : 'Match?', key: 'match', transform: (v) => (v == null ? (ar ? 'لا توجد بيانات حية' : 'no live data') : v ? (ar ? 'متطابق' : 'match') : (ar ? 'غير متطابق' : 'MISMATCH')), width: 14 },
  ];

  const currentTabExport = () => {
    switch (tab) {
      case 'flatbeds': return { name: ar ? 'السطحات' : 'Flatbeds', rows: fFlatbeds, columns: flatbedCols };
      case 'trailers': return { name: ar ? 'التيدرات' : 'Trailers', rows: fTrailers, columns: trailerCols };
      case 'tires': return { name: ar ? 'الكاوتشات' : 'Tires', rows: fTires, columns: tireCols };
      case 'history': return { name: ar ? 'سجل الحركات' : 'History', rows: fEvents, columns: eventCols };
      case 'sensors': return { name: ar ? 'مطابقة السينسورات' : 'Sensor check', rows: fSensors, columns: sensorCols };
    }
  };

  // ---- Mutations -------------------------------------------------------------
  const tireActions: TireActionHandlers = {
    onMove: (t) => setMoveTire(t as TireAsset),
    onDismount: (t) => setDownTire(t as TireAsset),
    onRenewal: (t) => setRenewalTire(t as TireAsset),
    onStatus: (t) => setStatusTire(t as TireAsset),
    onEdit: (t) => setEditTire(t as TireAsset),
    onRetire: (t) => setRetireTire(t as TireAsset),
    onSell: async (t) => {
      if (await confirm(ar ? `تسجيل بيع الفردة ${t.serial} كخردة؟` : `Sell ${t.serial} as scrap?`)) {
        doRetireTire(t as TireAsset, 'sold', '');
      }
    },
  };

  const doMoveTire = async (tire: TireAsset, body: any) => {
    setBusy(true);
    try { await api.post(`/api/ls2/assets/tires/${tire._id}/move`, body); await load(); setRefreshKey((k) => k + 1); setMoveTire(null); }
    catch (e: any) { notify(e?.message || 'Failed', 'error'); }
    setBusy(false);
  };
  const doRetireTire = async (tire: TireAsset, kind: 'damaged' | 'scrap' | 'sold', reason: string) => {
    setBusy(true);
    try { await api.post(`/api/ls2/assets/tires/${tire._id}/retire`, { kind, reason }); await load(); setRefreshKey((k) => k + 1); setRetireTire(null); }
    catch (e: any) { notify(e?.message || 'Failed', 'error'); }
    setBusy(false);
  };
  const doSetStatus = async (tire: TireAsset, body: { status: string; condition?: string; conditionPercent?: number | null; reason?: string }) => {
    setBusy(true);
    try { await api.post(`/api/ls2/assets/tires/${tire._id}/status`, body); await load(); setRefreshKey((k) => k + 1); setStatusTire(null); }
    catch (e: any) { notify(e?.message || 'Failed', 'error'); }
    setBusy(false);
  };
  const doRenewalResult = async (tire: TireAsset, result: 'renewed' | 'scrap', notes: string) => {
    setBusy(true);
    try { await api.post(`/api/ls2/assets/tires/${tire._id}/renewal-result`, { result, notes }); await load(); setRefreshKey((k) => k + 1); setRenewalTire(null); }
    catch (e: any) { notify(e?.message || 'Failed', 'error'); }
    setBusy(false);
  };
  const doMoveTrailer = async (trailer: Trailer, body: any) => {
    setBusy(true);
    try { await api.post(`/api/ls2/assets/trailers/${trailer._id}/move`, body); await load(); setRefreshKey((k) => k + 1); setMoveTrailer(null); }
    catch (e: any) { notify(e?.message || 'Failed', 'error'); }
    setBusy(false);
  };

  if (!isLs2Staff(user)) return <div className="text-slate-500 p-8">{t.notAuthorized}</div>;
  if (loading && !flatbeds.length) return <Spinner />;

  const TABS = [
    { key: 'flatbeds', label: ar ? 'السطحات' : 'Flatbeds', icon: <Truck className="w-3.5 h-3.5" />, count: counts.flatbeds },
    { key: 'trailers', label: ar ? 'التيدرات' : 'Trailers', icon: <Container className="w-3.5 h-3.5" />, count: counts.trailers },
    { key: 'tires', label: ar ? 'الكاوتشات' : 'Tires', icon: <CircleDot className="w-3.5 h-3.5" />, count: counts.tires },
    { key: 'store', label: ar ? 'المستودع' : 'Store', icon: <Boxes className="w-3.5 h-3.5" />, count: tires.filter((x) => x.status !== 'mounted').length + trailers.filter((x) => !x.currentPlate).length },
    { key: 'history', label: ar ? 'سجل الحركات' : 'History', icon: <History className="w-3.5 h-3.5" /> },
    { key: 'sensors', label: ar ? 'مطابقة السينسورات' : 'Sensor check', icon: <Radio className="w-3.5 h-3.5" /> },
  ] as const;

  return (
    <div className="space-y-5" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader
        icon={<Truck className="w-5 h-5" />}
        title={ar ? 'أصول الأسطول — سطحات وتيدرات وكاوتش' : 'Fleet Assets — Flatbeds, Trailers & Tires'}
        subtitle={ar
          ? `${counts.flatbeds ?? 0} سطحة · ${counts.trailers ?? 0} تيدر · ${counts.mounted ?? 0} فردة مركّبة · ${counts.spare ?? 0} في المخزن · ${counts.inRepair ?? 0} في المصنع · ${tires.filter((x) => x.status === 'scrap').length} سكراب · ${tires.filter((x) => x.status === 'damaged').length} تالفة`
          : `${counts.flatbeds ?? 0} flatbeds · ${counts.trailers ?? 0} trailers · ${counts.mounted ?? 0} tires mounted · ${counts.spare ?? 0} in stock · ${counts.inRepair ?? 0} at the factory · ${tires.filter((x) => x.status === 'scrap').length} scrap · ${tires.filter((x) => x.status === 'damaged').length} damaged`}
      >
        {admin && (
          <button type="button" onClick={() => setImportOpen(true)} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#f37121] hover:bg-[#d95f13] text-white text-sm font-medium">
            <Upload className="w-4 h-4" /> {ar ? 'استيراد JSON الورشة' : 'Import workshop JSON'}
          </button>
        )}
        <ExportMenu
          fileName={`ls2-assets-${tab}`} lang={lang as Lang}
          options={[
            { key: 'tab', label: ar ? 'التبويب الحالي (بعد الفلتر)' : 'Current tab (filtered)', sheets: [currentTabExport()!] },
            {
              key: 'all', label: ar ? 'كل الأصول (٣ شيتات)' : 'All assets (3 sheets)',
              sheets: [
                { name: ar ? 'السطحات' : 'Flatbeds', rows: flatbeds, columns: flatbedCols },
                { name: ar ? 'التيدرات' : 'Trailers', rows: trailers, columns: trailerCols },
                { name: ar ? 'الكاوتشات' : 'Tires', rows: tires, columns: tireCols },
              ],
            },
          ]}
        />
        <button type="button" onClick={refreshAll} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm"><RefreshCw className="w-4 h-4" /> {t.refresh}</button>
      </PageHeader>

      {/* Tabs + search */}
      <div className="flex flex-wrap items-center gap-2">
        {TABS.map((tb) => (
          <button key={tb.key} type="button" onClick={() => setTab(tb.key)} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border ${tab === tb.key ? 'bg-[#f37121] text-white border-[#f37121]' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'}`}>
            {tb.icon} {tb.label}{'count' in tb && tb.count != null && <span className={`tabular-nums ${tab === tb.key ? 'text-white/80' : 'text-slate-400'}`}>({tb.count})</span>}
          </button>
        ))}
        <div className="relative ms-auto">
          <Search className={`w-4 h-4 text-slate-400 absolute top-2.5 ${isRTL ? 'right-3' : 'left-3'}`} />
          <input
            value={q} onChange={(e) => setQ(e.target.value)}
            placeholder={ar ? 'بحث: لوحة / سيريال / تيدر / نوع…' : 'Search: plate / serial / trailer / type…'}
            className={`w-72 border border-slate-200 rounded-lg py-2 text-sm bg-white focus:outline-none focus:border-[#f37121] ${isRTL ? 'pr-9 pl-3' : 'pl-9 pr-3'}`}
          />
        </div>
      </div>

      {/* ---- Flatbeds -------------------------------------------------------- */}
      {tab === 'flatbeds' && (
        <div className="space-y-3">
        <FilterBar
          chips={FLATBED_CHIPS} counts={flatbedF.counts} active={flatbedFilter}
          onChange={setFlatbedFilter} query={q} onQuery={setQ}
          placeholder={ar ? 'لوحة · دفعة · سائق · تيدر…' : 'Plate · batch · driver · trailer…'}
          shown={fFlatbeds.length} total={flatbeds.length} ar={ar} />
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-900 text-slate-300 text-xs">
                  <th className="text-start font-semibold px-4 py-3">{ar ? 'الترقيم' : 'No.'}</th>
                  <th className="text-start font-semibold px-4 py-3">{t.plate}</th>
                  <th className="text-start font-semibold px-4 py-3">{ar ? 'الدفعة' : 'Batch'}</th>
                  <th className="text-start font-semibold px-4 py-3">{t.brand}</th>
                  <th className="text-start font-semibold px-4 py-3">{ar ? 'التيدر' : 'Trailer'}</th>
                  <th className="text-start font-semibold px-4 py-3">{t.driver}</th>
                  <th className="text-end font-semibold px-4 py-3">{ar ? 'كاوتش مسجّل' : 'Tires'}</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {fFlatbeds.map((f) => (
                  <tr key={f._id} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="px-4 py-3 tabular-nums text-slate-500">{f.numbering ?? '—'}</td>
                    <td className="px-4 py-3 font-medium text-slate-800">{f.plate}</td>
                    <td className="px-4 py-3 text-slate-600">{f.batch || '—'}</td>
                    <td className="px-4 py-3 text-slate-600">{f.brand || '—'}</td>
                    <td className="px-4 py-3">
                      {f.currentTrailerNumber
                        ? <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700">{ar ? `تيدر ${f.currentTrailerNumber}` : `Trailer ${f.currentTrailerNumber}`}</span>
                        : <span className="text-slate-300 text-xs">—</span>}
                    </td>
                    <td className="px-4 py-3 text-slate-600">{f.driver || '—'}</td>
                    {/* الرقم ده كان مجرد عدد — بقى مدخل. الضغط عليه بيفتح الكاوتش
                        نفسه ببياناته وتاريخ العربية كله في مكان واحد. */}
                    <td className="px-4 py-3 text-end">
                      <button type="button" onClick={() => setSheetPlate(f.plate)}
                        title={ar ? 'اعرض الكاوتش والتاريخ' : 'Show tires & history'}
                        className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-lg text-[13px] font-bold tabular-nums border transition
                          ${(f.tireCount || 0) >= 14 ? 'bg-emerald-50 text-emerald-800 border-emerald-200 hover:bg-emerald-100'
                            : (f.tireCount || 0) > 0 ? 'bg-amber-50 text-amber-800 border-amber-200 hover:bg-amber-100'
                            : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'}`}>
                        {f.tireCount || 0}/14
                      </button>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1.5">
                        {f.unitId != null && (
                          <button type="button" title={ar ? 'ملف المركبة' : 'Vehicle profile'} onClick={() => router.push(`/system/ls2/${f.unitId}`)} className="p-1.5 rounded-md hover:bg-slate-100 text-slate-400 hover:text-[#f37121]"><ExternalLink className="w-4 h-4" /></button>
                        )}
                        {admin && (
                          <button type="button" title={t.edit} onClick={() => setEditFlatbed(f)} className="p-1.5 rounded-md hover:bg-slate-100 text-slate-400 hover:text-slate-700"><Pencil className="w-4 h-4" /></button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {fFlatbeds.length === 0 && <tr><td colSpan={8} className="text-center text-slate-400 py-10">{t.noData}</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
        </div>
      )}

      {/* ---- Trailers -------------------------------------------------------- */}
      {tab === 'trailers' && (
        <div className="space-y-3">
          <FilterBar
            chips={TRAILER_CHIPS} counts={trailerF.counts} active={trailerFilter}
            onChange={setTrailerFilter} query={q} onQuery={setQ}
            placeholder={ar ? 'رقم التيدر أو اللوحة…' : 'Trailer no. or plate…'}
            shown={fTrailers.length} total={trailers.length} ar={ar} />
          {admin && (
            <button type="button" onClick={() => setAddTrailer(true)} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white border border-slate-200 hover:border-[#f37121] text-slate-700 text-sm">
              <Plus className="w-4 h-4 text-[#f37121]" /> {ar ? 'إضافة تيدر' : 'Add trailer'}
            </button>
          )}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-900 text-slate-300 text-xs">
                    <th className="text-start font-semibold px-4 py-3">{ar ? 'رقم التيدر' : 'Trailer no.'}</th>
                    <th className="text-start font-semibold px-4 py-3">{ar ? 'مركّب على السطحة' : 'On flatbed'}</th>
                    <th className="text-start font-semibold px-4 py-3">{t.status}</th>
                    <th className="text-start font-semibold px-4 py-3">{t.notes}</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {fTrailers.map((tr) => (
                    <tr key={tr._id} className="border-b border-slate-100 hover:bg-slate-50">
                      <td className="px-4 py-3 font-medium text-slate-800">{ar ? `تيدر ${tr.trailerNumber}` : `Trailer ${tr.trailerNumber}`}</td>
                      <td className="px-4 py-3">{tr.currentPlate ? <span className="font-medium text-slate-700">{tr.currentPlate}</span> : <span className="text-amber-600 text-xs">{ar ? 'غير مركّب' : 'Unhitched'}</span>}</td>
                      <td className="px-4 py-3 text-slate-600 text-xs">{tr.status}</td>
                      <td className="px-4 py-3 text-slate-500 text-xs">{tr.notes || '—'}</td>
                      <td className="px-4 py-3">
                        {admin && (
                          <div className="flex items-center justify-end gap-1.5">
                            <button type="button" title={ar ? 'نقل لسطحة' : 'Move to flatbed'} onClick={() => setMoveTrailer(tr)} className="p-1.5 rounded-md hover:bg-blue-50 text-slate-400 hover:text-blue-600"><ArrowLeftRight className="w-4 h-4" /></button>
                            {tr.currentPlate && (
                              <button
                                type="button" title={ar ? 'إنزال' : 'Unhitch'} disabled={busy}
                                onClick={async () => { const reason = await prompt(ar ? `سبب إنزال التيدر ${tr.trailerNumber}؟` : 'Reason?'); if (reason != null) doMoveTrailer(tr, { toPlate: null, reason }); }}
                                className="p-1.5 rounded-md hover:bg-amber-50 text-slate-400 hover:text-amber-600"
                              ><ArrowDownToLine className="w-4 h-4" /></button>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                  {fTrailers.length === 0 && <tr><td colSpan={5} className="text-center text-slate-400 py-10">{t.noData}</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ---- Tires ----------------------------------------------------------- */}
      {tab === 'tires' && (
        <div className="space-y-3">
          {/* بطاقات الحالة = فلاتر: نقرة تحصر الجدول، نقرة ثانية تلغي الفلتر */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-10 gap-2">
            {([
              { key: '', label: ar ? 'الكل' : 'All', count: tires.length, cls: 'text-slate-700', dot: 'bg-slate-400' },
              { key: 'mounted', label: ar ? 'مركّبة' : 'Mounted', count: tires.filter((x) => x.status === 'mounted').length, cls: 'text-emerald-700', dot: 'bg-emerald-500' },
              { key: 'unmounted', label: ar ? 'غير مركّبة' : 'Unmounted', count: tires.filter((x) => x.status !== 'mounted').length, cls: 'text-amber-700', dot: 'bg-amber-500' },
              { key: 'store', label: ar ? 'في المخزن' : 'In store', count: tires.filter((x) => x.status === 'spare').length, cls: 'text-blue-700', dot: 'bg-blue-500' },
              { key: 'new', label: ar ? 'الجديد' : 'New', count: tires.filter((x) => x.status === 'spare' && (x.condition || 'used') === 'new').length, cls: 'text-sky-700', dot: 'bg-sky-500' },
              { key: 'used', label: ar ? 'المستعمل' : 'Used', count: tires.filter((x) => x.status === 'spare' && (x.condition || 'used') !== 'new').length, cls: 'text-indigo-700', dot: 'bg-indigo-500' },
              { key: 'in_repair', label: ar ? 'في المصنع' : 'At factory', count: tires.filter((x) => x.status === 'in_repair').length, cls: 'text-violet-700', dot: 'bg-violet-500' },
              { key: 'scrap', label: ar ? 'السكراب' : 'Scrap', count: tires.filter((x) => x.status === 'scrap').length, cls: 'text-slate-600', dot: 'bg-slate-500' },
              { key: 'damaged', label: ar ? 'التالف' : 'Damaged', count: tires.filter((x) => x.status === 'damaged').length, cls: 'text-red-700', dot: 'bg-red-500' },
              { key: 'sold', label: ar ? 'المباع' : 'Sold', count: tires.filter((x) => x.status === 'sold').length, cls: 'text-emerald-700', dot: 'bg-emerald-500' },
            ] as const).map((c) => (
              <button key={c.key} type="button" onClick={() => setTireFilter(tireFilter === c.key ? '' : c.key)}
                className={`bg-white rounded-xl border px-3 py-2.5 text-start shadow-sm transition-all ${tireFilter === c.key ? 'border-[#f37121] ring-1 ring-[#f37121]/40' : 'border-slate-200 hover:border-slate-300'}`}>
                <div className="flex items-center gap-1.5 text-[11px] font-medium text-slate-500"><span className={`w-2 h-2 rounded-full ${c.dot}`} />{c.label}</div>
                <div className={`text-xl font-bold tabular-nums mt-0.5 ${c.cls}`}>{c.count}</div>
              </button>
            ))}
          </div>
          {admin && (
            <button type="button" onClick={() => setAddTire(true)} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white border border-slate-200 hover:border-[#f37121] text-slate-700 text-sm">
              <Plus className="w-4 h-4 text-[#f37121]" /> {ar ? 'تسجيل فردة كاوتش' : 'Register tire'}
            </button>
          )}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-900 text-slate-300 text-xs">
                    <th className="text-start font-semibold px-4 py-3">{ar ? 'رقم' : 'No.'}</th>
                    <th className="text-start font-semibold px-4 py-3">{ar ? 'السيريال' : 'Serial'}</th>
                    <th className="text-start font-semibold px-4 py-3">{ar ? 'النوع' : 'Type'}</th>
                    <th className="text-start font-semibold px-4 py-3">{ar ? 'المقاس' : 'Size'}</th>
                    <th className="text-center font-semibold px-4 py-3">{ar ? 'سينسور' : 'Sensor'}</th>
                    <th className="text-center font-semibold px-4 py-3">{ar ? 'الدرجة' : 'Grade'}</th>
                    <th className="text-center font-semibold px-4 py-3">{ar ? 'الحالة ٪' : 'Cond. %'}</th>
                    <th className="text-start font-semibold px-4 py-3">{ar ? 'على السطحة' : 'On flatbed'}</th>
                    <th className="text-start font-semibold px-4 py-3">{ar ? 'الموقع' : 'Position'}</th>
                    <th className="text-center font-semibold px-4 py-3">{t.status}</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {fTires.map((ti) => {
                    const sen = SENSOR_LABELS[ti.sensor] || SENSOR_LABELS.unknown;
                    const st = TIRE_STATUS_LABELS[ti.status] || TIRE_STATUS_LABELS.spare;
                    const grade = TIRE_CONDITION_LABELS[ti.condition || 'used'] || TIRE_CONDITION_LABELS.used;
                    const terminal = ti.status === 'retired' || ti.status === 'damaged' || ti.status === 'sold';
                    return (
                      <tr key={ti._id} className="border-b border-slate-100 hover:bg-slate-50">
                        <td className="px-4 py-3 tabular-nums text-slate-500">{ti.tireNumber || '—'}</td>
                        <td className="px-4 py-3 font-mono text-xs font-medium text-slate-800">{ti.serial}</td>
                        <td className="px-4 py-3 text-slate-600">{ti.type || '—'}</td>
                        <td className="px-4 py-3 text-slate-600 tabular-nums">{ti.size || '—'}</td>
                        <td className="px-4 py-3 text-center"><span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${sen.cls}`}>{ar ? sen.ar : sen.en}</span></td>
                        <td className="px-4 py-3 text-center"><span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${grade.cls}`}>{ar ? grade.ar : grade.en}</span></td>
                        <td className="px-4 py-3 text-center tabular-nums text-xs">
                          {ti.conditionPercent != null
                            ? <span className={`font-semibold ${ti.conditionPercent >= 70 ? 'text-emerald-600' : ti.conditionPercent >= 40 ? 'text-amber-600' : 'text-red-600'}`}>{ti.conditionPercent}%</span>
                            : <span className="text-slate-300">—</span>}
                        </td>
                        <td className="px-4 py-3 font-medium text-slate-700">{ti.plate || <span className="text-slate-300">—</span>}</td>
                        <td className="px-4 py-3 text-xs text-slate-600">{ti.positionLabel ? `${ti.positionLabel}${ti.section ? ` · ${ti.section}` : ''}` : '—'}</td>
                        <td className="px-4 py-3 text-center"><span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${st.cls}`}>{ar ? st.ar : st.en}</span></td>
                        <td className="px-4 py-3">
                          <TireActions tire={ti} ar={ar} busy={busy} admin={admin} on={tireActions} />
                        </td>
                      </tr>
                    );
                  })}
                  {fTires.length === 0 && <tr><td colSpan={11} className="text-center text-slate-400 py-10">{t.noData}</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ---- Store ------------------------------------------------------------
           نفس مستودع الورشة تمامًا — سجل واحد مشترك، فكل حركة هناك تظهر هنا
           لحظيًا والعكس. هذا العرض يحصر ما هو خارج السيارات فقط. */}
      {tab === 'store' && (() => {
        const storeTires = tires.filter((x) => x.status !== 'mounted' && (!q || [x.serial, x.tireNumber, x.type, x.size].some((f) => norm(f).includes(norm(q)))));
        const groups: { key: string; label: string; cls: string; items: TireAsset[] }[] = [
          { key: 'new', label: ar ? 'جديد' : 'New', cls: 'bg-sky-50 text-sky-700 border-sky-200', items: storeTires.filter((x) => x.status === 'spare' && (x.condition || 'used') === 'new') },
          // «مستعمل» بقت خانة واحدة تضمّ المجدَّد: أي فردة على الرف مش جديدة.
          // القراءة بالنفي مقصودة — لو فضلت صفوف قديمة بدرجة قديمة قبل ما
          // migrateTireConditions يجري، تفضل بتتعدّ هنا بدل ما تختفي من المخزن.
          { key: 'used', label: ar ? 'مستعمل صالح' : 'Used (good)', cls: 'bg-blue-50 text-blue-700 border-blue-200', items: storeTires.filter((x) => x.status === 'spare' && (x.condition || 'used') !== 'new') },
          { key: 'in_repair', label: ar ? 'في المصنع' : 'At the factory', cls: 'bg-violet-50 text-violet-700 border-violet-200', items: storeTires.filter((x) => x.status === 'in_repair') },
          { key: 'scrap', label: ar ? 'سكراب (للبيع)' : 'Scrap (to sell)', cls: 'bg-slate-100 text-slate-600 border-slate-200', items: storeTires.filter((x) => x.status === 'scrap') },
          { key: 'damaged', label: ar ? 'تالف' : 'Damaged', cls: 'bg-red-50 text-red-700 border-red-200', items: storeTires.filter((x) => x.status === 'damaged' || x.status === 'retired') },
        ];
        const freeTrailers = trailers.filter((x) => !x.currentPlate);
        return (
          <div className="space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <p className="text-xs text-slate-500">
                {ar
                  ? 'هذا هو مستودع الورشة نفسه — سجل واحد مشترك: أي حركة هنا أو هناك تظهر في المكانين لحظيًا.'
                  : 'This IS the workshop store — one shared registry: every movement shows in both places live.'}
              </p>
              <Link href="/system/workshop/store" className="inline-flex items-center gap-1 text-xs font-medium text-[#f37121] hover:underline">
                <ExternalLink className="w-3.5 h-3.5" />{ar ? 'قطع الغيار في مستودع الورشة' : 'Spare parts in the workshop store'}
              </Link>
            </div>
            {groups.map((g) => (
              <div key={g.key} className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
                <div className={`flex items-center justify-between px-4 py-2.5 border-b ${g.cls}`}>
                  <span className="font-bold text-sm">{g.label}</span>
                  <span className="text-xs font-bold tabular-nums">{g.items.length}</span>
                </div>
                {g.items.length === 0
                  ? <div className="text-center text-xs text-slate-300 py-4">{ar ? 'لا يوجد' : 'None'}</div>
                  : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <tbody>
                          {g.items.map((ti) => (
                            <tr key={ti._id} className="border-b border-slate-50 hover:bg-slate-50">
                              <td className="px-4 py-2 tabular-nums text-slate-500 text-xs w-16">{ti.tireNumber || '—'}</td>
                              <td className="px-4 py-2 font-mono text-xs font-medium text-slate-800">{ti.serial}</td>
                              <td className="px-4 py-2 text-slate-600 text-xs">{ti.type || '—'}</td>
                              <td className="px-4 py-2 text-slate-600 text-xs tabular-nums">{ti.size || '—'}</td>
                              <td className="px-4 py-2 text-center text-xs w-20">
                                {ti.conditionPercent != null
                                  ? <span className={`font-semibold tabular-nums ${ti.conditionPercent >= 70 ? 'text-emerald-600' : ti.conditionPercent >= 40 ? 'text-amber-600' : 'text-red-600'}`}>{ti.conditionPercent}%</span>
                                  : <span className="text-slate-300">—</span>}
                              </td>
                              <td className="px-4 py-2 text-end w-24">
                                {admin && ti.status === 'spare' && (
                                  <button type="button" onClick={() => setMoveTire(ti)} className="text-[11px] font-medium text-[#f37121] hover:underline">{ar ? 'تركيب' : 'Mount'}</button>
                                )}
                                {admin && ti.status === 'in_repair' && (
                                  <button type="button" onClick={() => setRenewalTire(ti)} className="text-[11px] font-medium text-violet-600 hover:underline">{ar ? 'نتيجة التجديد' : 'Result'}</button>
                                )}
                                {/* السكراب/التالف: خطوة البيع كخردة — منفصلة عن وضعها سكراب. */}
                                {admin && (ti.status === 'scrap' || ti.status === 'damaged') && (
                                  <button type="button" disabled={busy}
                                    onClick={async () => { if (await confirm(ar ? `تسجيل بيع الفردة ${ti.serial} كخردة؟` : `Sell ${ti.serial} as scrap?`)) doRetireTire(ti, 'sold', ''); }}
                                    className="text-[11px] font-medium text-emerald-600 hover:underline">{ar ? 'بيع كخردة' : 'Sell'}</button>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
              </div>
            ))}
            <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
              <div className="flex items-center justify-between px-4 py-2.5 border-b bg-amber-50 text-amber-700 border-amber-200">
                <span className="font-bold text-sm">{ar ? 'تيدرات غير مركّبة' : 'Unhitched trailers'}</span>
                <span className="text-xs font-bold tabular-nums">{freeTrailers.length}</span>
              </div>
              {freeTrailers.length === 0
                ? <div className="text-center text-xs text-slate-300 py-4">{ar ? 'كل التيدرات مركّبة' : 'All trailers hitched'}</div>
                : freeTrailers.map((tr) => (
                  <div key={tr._id} className="flex items-center justify-between px-4 py-2 border-b border-slate-50 text-sm">
                    <span className="font-medium text-slate-700">{ar ? `تيدر ${tr.trailerNumber}` : `Trailer ${tr.trailerNumber}`}</span>
                    {admin && <button type="button" onClick={() => setMoveTrailer(tr)} className="text-[11px] font-medium text-[#f37121] hover:underline">{ar ? 'تركيب' : 'Hitch'}</button>}
                  </div>
                ))}
            </div>
          </div>
        );
      })()}

      {/* ---- History --------------------------------------------------------- */}
      {tab === 'history' && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-900 text-slate-300 text-xs">
                  <th className="text-start font-semibold px-4 py-3">{ar ? 'التاريخ' : 'Date'}</th>
                  <th className="text-start font-semibold px-4 py-3">{ar ? 'الأصل' : 'Asset'}</th>
                  <th className="text-center font-semibold px-4 py-3">{ar ? 'الحركة' : 'Action'}</th>
                  <th className="text-start font-semibold px-4 py-3">{ar ? 'من' : 'From'}</th>
                  <th className="text-start font-semibold px-4 py-3">{ar ? 'إلى' : 'To'}</th>
                  <th className="text-start font-semibold px-4 py-3">{ar ? 'السبب' : 'Reason'}</th>
                  <th className="text-start font-semibold px-4 py-3">{ar ? 'بواسطة' : 'By'}</th>
                </tr>
              </thead>
              <tbody>
                {fEvents.map((e) => {
                  const act = ACTION_LABELS[e.action] || ACTION_LABELS.updated;
                  const ent = ENTITY_LABELS[e.entityType] || { en: e.entityType, ar: e.entityType };
                  return (
                    <tr key={e._id} className="border-b border-slate-100 hover:bg-slate-50">
                      <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">{fmtDateTime(e.date, lang as Lang)}</td>
                      <td className="px-4 py-3"><span className="text-xs text-slate-400">{ar ? ent.ar : ent.en}</span> <span className="font-mono text-xs font-medium text-slate-800">{e.label}</span></td>
                      <td className="px-4 py-3 text-center"><span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${act.cls}`}>{ar ? act.ar : act.en}</span></td>
                      <td className="px-4 py-3 text-xs text-slate-600">{[e.fromPlate, e.fromPosition].filter(Boolean).join(' · ') || '—'}</td>
                      <td className="px-4 py-3 text-xs text-slate-600">{[e.toPlate, e.toPosition].filter(Boolean).join(' · ') || '—'}</td>
                      <td className="px-4 py-3 text-xs text-slate-500 max-w-[260px]">{e.reason || e.notes || '—'}</td>
                      <td className="px-4 py-3 text-xs text-slate-500">{e.performedByName || '—'}</td>
                    </tr>
                  );
                })}
                {fEvents.length === 0 && <tr><td colSpan={7} className="text-center text-slate-400 py-10">{ar ? 'لا توجد حركات بعد' : 'No movements yet'}</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ---- Sensor check ---------------------------------------------------- */}
      {tab === 'sensors' && (
        <div className="space-y-3">
          <p className="text-xs text-slate-500">
            {ar
              ? 'مقارنة بين المسجَّل في كشف الورشة (يوجد / لا يوجد حسّاس) وبين ما يصل فعليًا من Wialon. ترقيم Wialon (محور/إطار) يختلف عن ترقيم الورشة (١–١٤)، لذلك تتم المقارنة بالعدد مع عرض الترقيمين معًا للمطابقة اليدوية.'
              : 'Registered sensor flags (workshop sheet) vs what Wialon actually reports. Wialon numbers tires by axle, the workshop by 1–14, so we compare counts and show both layouts.'}
          </p>
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-900 text-slate-300 text-xs">
                    <th className="px-3 py-3 w-8" />
                    <th className="text-start font-semibold px-4 py-3">{t.plate}</th>
                    <th className="text-start font-semibold px-4 py-3">{t.driver}</th>
                    <th className="text-end font-semibold px-4 py-3">{ar ? 'مسجّل (كل الفردات)' : 'Registered'}</th>
                    <th className="text-end font-semibold px-4 py-3">{ar ? 'مسجّل بسينسور' : 'With sensor'}</th>
                    <th className="text-end font-semibold px-4 py-3">{ar ? 'يرسل فعليًا' : 'Reporting'}</th>
                    <th className="text-center font-semibold px-4 py-3">{ar ? 'المطابقة' : 'Match'}</th>
                  </tr>
                </thead>
                <tbody>
                  {fSensors.map((r) => {
                    const isOpen = openSensor.has(r.plate);
                    return (
                      <Fragment key={r.plate}>
                        <tr className="border-b border-slate-100 hover:bg-slate-50 cursor-pointer" onClick={() => setOpenSensor((p) => { const n = new Set(p); n.has(r.plate) ? n.delete(r.plate) : n.add(r.plate); return n; })}>
                          <td className="px-3 py-3 text-slate-400">{isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className={`w-4 h-4 ${isRTL ? 'rotate-180' : ''}`} />}</td>
                          <td className="px-4 py-3 font-medium text-slate-800">{r.plate}</td>
                          <td className="px-4 py-3 text-slate-600">{r.driver || '—'}</td>
                          <td className="px-4 py-3 text-end tabular-nums">{r.registeredTotal}</td>
                          <td className="px-4 py-3 text-end tabular-nums font-medium text-slate-700">{r.registeredWithSensor}</td>
                          <td className="px-4 py-3 text-end tabular-nums font-medium text-slate-700">{r.hasLive ? r.liveReporting : '—'}</td>
                          <td className="px-4 py-3 text-center">
                            {r.match == null
                              ? <span className="px-2 py-0.5 rounded-full text-[11px] bg-slate-100 text-slate-500">{ar ? 'لا بيانات حية' : 'No live data'}</span>
                              : r.match
                                ? <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-emerald-100 text-emerald-700">{ar ? 'متطابق' : 'Match'}</span>
                                : <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-red-100 text-red-700">{ar ? 'غير متطابق' : 'MISMATCH'}</span>}
                          </td>
                        </tr>
                        {isOpen && (
                          <tr className="bg-slate-50/60 border-b border-slate-100">
                            <td colSpan={7} className="px-6 py-3">
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                                <div>
                                  <p className="font-semibold text-slate-600 mb-1.5">{ar ? 'المسجّل بسينسور (كشف الورشة)' : 'Registered with sensor (workshop)'}</p>
                                  {r.registeredSensorPositions.length === 0 && <p className="text-slate-400">—</p>}
                                  <ul className="space-y-1">
                                    {r.registeredSensorPositions.map((p, i) => (
                                      <li key={i} className="text-slate-600">{p.positionLabel || `اطار ${p.positionNumber}`} · {p.section} — <span className="font-mono">{p.serial}</span></li>
                                    ))}
                                  </ul>
                                </div>
                                <div>
                                  <p className="font-semibold text-slate-600 mb-1.5">{ar ? 'ما يُرسِل فعليًا (Wialon)' : 'Actually reporting (Wialon)'}</p>
                                  {!r.hasLive && <p className="text-slate-400">{ar ? 'العربية غير موجودة في Wialon' : 'Vehicle not in Wialon'}</p>}
                                  {r.hasLive && r.livePositions.length === 0 && <p className="text-slate-400">—</p>}
                                  <ul className="space-y-1">
                                    {r.livePositions.map((p, i) => (
                                      <li key={i} className="text-slate-600">{ar ? `محور ${p.axle} · إطار ${p.position}` : `Axle ${p.axle} · tire ${p.position}`}</li>
                                    ))}
                                  </ul>
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                  {fSensors.length === 0 && <tr><td colSpan={7} className="text-center text-slate-400 py-10">{t.noData}</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ---- Modals ---------------------------------------------------------- */}
      {sheetPlate && (
        <VehicleAssetSheet
          plate={sheetPlate} ar={ar} admin={admin} busy={busy}
          actions={tireActions} refreshKey={refreshKey}
          onClose={() => setSheetPlate(null)}
        />
      )}
      {moveTire && <MoveTireModal tire={moveTire} flatbeds={flatbeds} tires={tires} ar={ar} busy={busy} onClose={() => setMoveTire(null)} onSubmit={(body) => doMoveTire(moveTire, body)} />}
      {downTire && <DismountTireModal tire={downTire} tires={tires} ar={ar} busy={busy} onClose={() => setDownTire(null)} onSubmit={(body) => doMoveTire(downTire, body).then(() => setDownTire(null))} />}
      {renewalTire && <RenewalResultModal tire={renewalTire} ar={ar} busy={busy} onClose={() => setRenewalTire(null)} onSubmit={(result, notes) => doRenewalResult(renewalTire, result, notes)} />}
      {retireTire && <RetireTireModal tire={retireTire} ar={ar} busy={busy} onClose={() => setRetireTire(null)} onSubmit={(kind, reason) => doRetireTire(retireTire, kind, reason)} />}
      {statusTire && <TireStatusModal tire={statusTire} ar={ar} busy={busy} onClose={() => setStatusTire(null)} onSubmit={(body) => doSetStatus(statusTire, body)} />}
      {(addTire || editTire) && (
        <TireFormModal
          tire={editTire} flatbeds={flatbeds} ar={ar}
          onClose={() => { setAddTire(false); setEditTire(null); }}
          onSaved={() => { setAddTire(false); setEditTire(null); load(); setRefreshKey((k) => k + 1); }}
        />
      )}
      {moveTrailer && <MoveTrailerModal trailer={moveTrailer} flatbeds={flatbeds} ar={ar} busy={busy} onClose={() => setMoveTrailer(null)} onSubmit={(body) => doMoveTrailer(moveTrailer, body)} />}
      {addTrailer && (
        <Modal title={ar ? 'إضافة تيدر' : 'Add trailer'} onClose={() => setAddTrailer(false)}>
          <AddTrailerForm flatbeds={flatbeds} ar={ar} onSaved={() => { setAddTrailer(false); load(); }} />
        </Modal>
      )}
      {editFlatbed && (
        <Modal title={ar ? `تعديل السطحة ${editFlatbed.plate}` : `Edit flatbed ${editFlatbed.plate}`} onClose={() => setEditFlatbed(null)}>
          <EditFlatbedForm flatbed={editFlatbed} ar={ar} onSaved={() => { setEditFlatbed(null); load(); }} />
        </Modal>
      )}
      {importOpen && <ImportModal ar={ar} onClose={() => setImportOpen(false)} onDone={() => { setImportOpen(false); load(); }} />}
    </div>
  );
}

// خيار «فردة بديلة من المخزن» — يظهر في مودالي الإنزال والنقل: البديل يُركَّب
// في الموقع الذي أخلته الفردة، فتكتمل العمليتان (نزول + تركيب) بحركة واحدة.
// The replacement can be a spare from the store, a tire on ANOTHER truck (a
// swap), OR another tire on the SAME truck — including the الاستبن (spare
// mounted on the truck): a roadside blowout swaps the burst tire with the truck's
// own spare. Order: store spares → same-truck → other trucks. Only the tire being
// worked on itself is excluded.
const spareOptions = (tires: TireAsset[], source: TireAsset | string, ar: boolean) => {
  const excludeId = typeof source === 'string' ? source : source._id;
  const srcKey = typeof source === 'string' ? null : source.plateKey;
  const rank = (x: TireAsset) => x.status === 'spare' ? 0 : (x.plateKey && x.plateKey === srcKey ? 1 : 2);
  return tires
    .filter((x) => x._id !== excludeId && (x.status === 'spare' || (x.status === 'mounted' && !!x.plateKey)))
    .sort((a, b) => rank(a) - rank(b))
    .map((x) => {
      const sameTruck = x.plateKey && x.plateKey === srcKey;
      return {
        value: x._id,
        label: `${x.serial}${x.tireNumber ? ` — ${ar ? 'رقم' : 'no.'} ${x.tireNumber}` : ''}`,
        hint: [
          x.isSpare ? (ar ? '⭐ استبن' : '⭐ spare') : '',
          x.status === 'mounted'
            ? (sameTruck
                ? (ar ? `نفس المركبة · ${x.positionLabel || x.positionNumber || ''}` : `same truck · ${x.positionLabel || x.positionNumber || ''}`)
                : (ar ? `مركّبة على ${x.plate} · ${x.positionLabel || x.positionNumber || ''}` : `on ${x.plate} · ${x.positionLabel || x.positionNumber || ''}`))
            : (ar ? 'في المخزن' : 'in store'),
          x.type,
          x.condition === 'new' ? (ar ? 'جديد' : 'new') : (ar ? 'مستعمل' : 'used'),
          x.conditionPercent != null ? `${x.conditionPercent}%` : '',
        ].filter(Boolean).join(' · '),
      };
    });
};

// ---- Dismount: مخزن / تجديد / تالفة / سكراب + بديل اختياري -------------------
function DismountTireModal({ tire, tires, ar, busy, onClose, onSubmit }: {
  tire: TireAsset; tires: TireAsset[]; ar: boolean; busy: boolean;
  onClose: () => void; onSubmit: (body: any) => void;
}) {
  const [destination, setDestination] = useState<'' | 'store' | 'repair' | 'damaged' | 'scrap'>('');
  const [percent, setPercent] = useState('');
  const [replacementId, setReplacementId] = useState('');
  const [swap, setSwap] = useState(false);
  const [secondId, setSecondId] = useState('');
  const [reason, setReason] = useState('');
  // الاستبن هو الموقع الوحيد اللي مسموح يفضل فاضي — العربية بتمشي من غيره.
  // أي موقع تاني لازم يتملي، فالبديل إجباري (أو تبديل متبادل).
  const spareSlot = tire.isSpare || /استبن/.test(tire.section || '');
  const needsReplacement = !spareSlot;
  // Is the chosen replacement a tire mounted on ANOTHER truck? Only then can we
  // offer a two-way swap (this tire takes the replacement's old slot over there)
  // OR backfill the replacement's slot with a third tire (store / another truck).
  const replTire = tires.find((x) => x._id === replacementId);
  const canSwap = replTire?.status === 'mounted' && !!replTire.plateKey;
  const DESTS: { key: 'store' | 'repair' | 'damaged' | 'scrap'; ar: string; en: string; hint: string; hintEn: string; accent: string }[] = [
    { key: 'store', ar: 'سليمة إلى المخزن', en: 'Fine → store', hint: 'صالحة للاستخدام — سجِّل نسبة حالتها للتسكين لاحقًا', hintEn: 'still usable — record its condition % for later placement', accent: 'border-blue-400 bg-blue-50 accent-blue-600' },
    { key: 'repair', ar: 'في المصنع', en: 'At the factory', hint: 'تُرسَل للتجديد — تعود صالحة أو سكراب', hintEn: 'sent for retreading — comes back usable or scrap', accent: 'border-violet-400 bg-violet-50 accent-violet-600' },
    { key: 'scrap', ar: 'سكراب مباشرة', en: 'Straight to scrap', hint: 'غير قابلة للاستخدام — تُخزَّن حتى تُباع', hintEn: 'unusable — stored until sold', accent: 'border-slate-500 bg-slate-100 accent-slate-600' },
    { key: 'damaged', ar: 'تالفة', en: 'Damaged', hint: 'انفجرت أو تآكلت — لا وجود لها', hintEn: 'blown / worn out — gone', accent: 'border-red-400 bg-red-50 accent-red-600' },
  ];
  return (
    <Modal title={ar ? `إنزال الفردة ${tire.serial}` : `Dismount tire ${tire.serial}`} onClose={onClose}>
      <div className="space-y-3">
        <p className="text-xs text-slate-500">{ar ? `حاليًا على ${tire.plate} — ${tire.positionLabel}${tire.section ? ` · ${tire.section}` : ''}` : `Currently on ${tire.plate} — ${tire.positionLabel}`}</p>
        <div className="space-y-1.5">
          {DESTS.map((d) => (
            <label key={d.key} className={`flex items-start gap-2 px-3 py-2 rounded-lg cursor-pointer border ${destination === d.key ? d.accent : 'border-slate-200 hover:bg-slate-50'}`}>
              <input type="radio" name="dismountDest" checked={destination === d.key} onChange={() => setDestination(d.key)} className={`mt-0.5 ${destination === d.key ? d.accent.split(' ').pop() : ''}`} />
              <span>
                <span className="font-semibold text-slate-800 text-sm">{ar ? d.ar : d.en}</span>
                <span className="block text-[11px] text-slate-500">{ar ? d.hint : d.hintEn}</span>
              </span>
            </label>
          ))}
        </div>
        {destination === 'store' && (
          <div>
            <label className={labelCls}>{ar ? 'نسبة حالة الفردة (٪)' : 'Condition (%)'}</label>
            <input type="number" min={0} max={100} value={percent} onChange={(e) => setPercent(e.target.value)}
              placeholder={ar ? 'مثال: 70' : 'e.g. 70'} className={inputCls} dir="ltr" />
          </div>
        )}
        <div>
          <label className={labelCls}>
            {needsReplacement
              ? (ar ? 'فردة بديلة تُركَّب مكانها (إلزامي)' : 'Replacement mounted in its place (required)')
              : (ar ? 'فردة بديلة تُركَّب مكانها (اختياري — الاستبن)' : 'Replacement (optional — spare slot)')}
          </label>
          <SearchSelect value={replacementId} onChange={setReplacementId}
            options={[...(needsReplacement ? [] : [{ value: '', label: ar ? '— دون بديل —' : '— none —' }]), ...spareOptions(tires, tire, ar)]} ar={ar}
            placeholder={needsReplacement ? (ar ? 'اختر الفردة البديلة' : 'Choose the replacement') : (ar ? '— دون بديل —' : '— none —')}
            searchPlaceholder={ar ? 'ابحث بالسيريال أو الرقم…' : 'Search serial / number…'} />
          <p className="text-[11px] text-slate-600 mt-1">{ar ? 'من المخزن، أو فردة مركّبة على مركبة أخرى (تُنقل تلقائيًا).' : 'From store, or a tire mounted on another truck (auto-transferred).'}</p>
          {needsReplacement && !replacementId && !(swap && canSwap) && (
            <p className="text-[11.5px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mt-1.5 font-medium">
              {ar ? `الموقع «${tire.positionLabel || tire.positionNumber}» لا يجوز أن يبقى فارغًا — اختر فردة تُركَّب مكانها، أو نفّذ تبديلًا.`
                  : `Position «${tire.positionLabel || tire.positionNumber}» cannot be left empty — pick a replacement or swap.`}
            </p>
          )}
          {canSwap && (
            <label className="flex items-start gap-2 mt-2 px-3 py-2 rounded-lg cursor-pointer border border-amber-200 bg-amber-50/60">
              <input type="checkbox" checked={swap} onChange={(e) => { setSwap(e.target.checked); if (e.target.checked) setSecondId(''); }} className="mt-0.5 accent-amber-600" />
              <span className="text-xs text-amber-800 font-medium leading-relaxed">
                {ar
                  ? `تبديل متبادل: هذه الفردة تُركَّب مكان ${replTire?.serial} على المركبة ${replTire?.plate} (بدل نزولها).`
                  : `Two-way swap: this tire takes ${replTire?.serial}'s slot on truck ${replTire?.plate} (instead of coming off).`}
              </span>
            </label>
          )}
          {canSwap && !swap && (
            <div className="mt-2">
              <label className="block text-xs font-semibold text-slate-600 mb-1">
                {ar ? `يملأ مكان ${replTire?.serial} على ${replTire?.plate} (اختياري):` : `Fills ${replTire?.serial}'s slot on ${replTire?.plate} (optional):`}
              </label>
              <SearchSelect value={secondId} onChange={setSecondId} ar={ar}
                options={[{ value: '', label: ar ? '— دون —' : '— none —' }, ...spareOptions(tires, replTire!, ar).filter((o) => o.value !== replacementId)]}
                placeholder={ar ? '— دون —' : '— none —'} searchPlaceholder={ar ? 'ابحث بالسيريال…' : 'Search serial…'} />
              <p className="text-[11px] text-slate-400 mt-1">{ar ? 'من المخزن أو من عربية ثالثة.' : 'From store, or a third truck.'}</p>
            </div>
          )}
        </div>
        <div>
          <label className={labelCls}>{ar ? 'السبب' : 'Reason'}</label>
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={ar ? 'مثال: تآكل / تدوير / انفجار…' : 'e.g. wear / rotation / blowout…'} className={inputCls} />
        </div>
        <button
          type="button"
          disabled={busy || (!(swap && canSwap) && !destination)
            || (needsReplacement && !replacementId && !(swap && canSwap))}
          onClick={() => onSubmit(
            swap && canSwap
              ? { toPlate: null, destination: 'swap', replacementTireId: replacementId, reason }
              : {
                  toPlate: null, destination, reason,
                  ...(destination === 'store' && percent !== '' ? { conditionPercent: Number(percent) } : {}),
                  ...(replacementId ? { replacementTireId: replacementId } : {}),
                  ...(secondId ? { secondReplacementTireId: secondId } : {}),
                }
          )}
          className="w-full py-2 rounded-lg bg-[#f37121] hover:bg-[#d95f13] text-white text-sm font-medium disabled:opacity-40"
        >
          {swap && canSwap
            ? (ar ? `تبديل الفردتين بين المركبتين` : 'Swap the two tires')
            : !destination ? (ar ? 'اختر وجهة الفردة أولًا' : 'Choose a destination first')
            : needsReplacement && !replacementId ? (ar ? 'اختر الفردة البديلة أولًا' : 'Choose the replacement first')
            : replacementId ? (ar ? 'تنفيذ الإنزال وتركيب البديل' : 'Dismount & mount replacement')
            : (ar ? 'تنفيذ الإنزال' : 'Dismount')}
        </button>
      </div>
    </Modal>
  );
}

// ---- Move tire --------------------------------------------------------------
function MoveTireModal({ tire, flatbeds, tires, ar, busy, onClose, onSubmit }: {
  tire: TireAsset; flatbeds: Flatbed[]; tires: TireAsset[]; ar: boolean; busy: boolean;
  onClose: () => void; onSubmit: (body: any) => void;
}) {
  const [toPlate, setToPlate] = useState(tire.plate || '');
  const [posN, setPosN] = useState<number>(tire.positionNumber || 1);
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');
  // The mandatory OUT: when the slot is occupied, where does the removed tire go?
  const [displacedTo, setDisplacedTo] = useState<'' | 'repair' | 'damaged' | 'scrap' | 'store'>('');
  // لو رجعت سليمة للمخزن — كام في المية؟ (تُقرأ لاحقًا عند التسكين)
  const [displacedPercent, setDisplacedPercent] = useState('');
  // بديل من المخزن يُركَّب في الموقع الذي ستخليه هذه الفردة على سطحتها الحالية.
  const [replacementId, setReplacementId] = useState('');
  const pos = POSITION_DEFS.find((p) => p.n === posN) || POSITION_DEFS[0];
  // نطابق بالـ plateKey (أرقام فقط): لوحة السطحة كثيرًا ما تختلف عن لوحة الفردة المخزّنة.
  const toKey = flatbeds.find((f) => f.plate === toPlate)?.plateKey || String(toPlate || '').replace(/[^0-9]/g, '') || String(toPlate || '').trim().toUpperCase();
  const occupant = tires.find((x) => x._id !== tire._id && x.status === 'mounted' && x.plateKey === toKey && x.positionNumber === posN);
  // شاحنة بلا كاوتشات مسجّلة أصلًا — كل المواقع ستظهر فارغة لأن الأصول لم تُدخَل بعد.
  const truckHasTires = !!toKey && tires.some((x) => x.status === 'mounted' && x.plateKey === toKey);
  const FATES: { key: 'repair' | 'damaged' | 'scrap' | 'store'; ar: string; en: string; hint: string; hintEn: string }[] = [
    { key: 'repair', ar: 'في المصنع', en: 'At the factory', hint: 'تُرسَل للتجديد — تعود صالحة أو سكراب', hintEn: 'sent for retreading — comes back usable or scrap' },
    { key: 'scrap', ar: 'سكراب', en: 'Scrap', hint: 'غير قابلة للاستخدام — تُخزَّن حتى تُباع', hintEn: 'unusable — stored until sold' },
    { key: 'damaged', ar: 'تالفة', en: 'Damaged', hint: 'انفجرت أو تآكلت — لا وجود لها', hintEn: 'blown / worn out — gone' },
    { key: 'store', ar: 'سليمة إلى المخزن', en: 'Fine → stock', hint: 'صالحة للاستخدام، أُزيلت فقط (تدوير مثلًا)', hintEn: 'still good, just swapped out' },
  ];
  return (
    <Modal title={ar ? `نقل / تركيب الفردة ${tire.serial}` : `Move tire ${tire.serial}`} onClose={onClose}>
      <div className="space-y-3">
        {tire.plate && <p className="text-xs text-slate-500">{ar ? `حاليًا على ${tire.plate} — ${tire.positionLabel}` : `Currently on ${tire.plate} — ${tire.positionLabel}`}</p>}
        <div>
          <label className={labelCls}>{ar ? 'إلى السطحة' : 'To flatbed'}</label>
          <SearchSelect value={toPlate} onChange={setToPlate} options={flatbedOptions(flatbeds, ar)} ar={ar}
            placeholder={ar ? '— اختر السطحة —' : '— choose flatbed —'} searchPlaceholder={ar ? 'ابحث برقم السطحة…' : 'Search flatbed…'} />
        </div>
        <div>
          <label className={labelCls}>{ar ? 'الموقع (1–14)' : 'Position (1–14)'}</label>
          <SearchSelect value={String(posN)} onChange={(v) => setPosN(Number(v))} options={positionOptions(toKey, tires, tire._id, ar)} ar={ar}
            placeholder={ar ? (toPlate ? '— اختر الموقع —' : '— اختر السطحة أولًا —') : '— choose position —'}
            searchPlaceholder={ar ? 'ابحث عن الموقع…' : 'Search position…'} />
        </div>
        {/* شاحنة لسه مادخلناش كاوتشاتها — نصارح المستخدم عشان ميتغرش بـ«فارغ». */}
        {toPlate && !truckHasTires && (
          <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 font-medium">
            {ar
              ? `⚠ لا توجد كاوتشات مسجّلة للسطحة ${toPlate} بعد — كل المواقع ستظهر فارغة. تأكد قبل التركيب.`
              : `⚠ No tires registered for flatbed ${toPlate} yet — every slot shows empty. Verify before mounting.`}
          </p>
        )}
        {/* الموقع فاضي؟ نطمئن المستخدم إنه تركيب مباشر لا استبدال. */}
        {toPlate && truckHasTires && !occupant && (
          <p className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 font-medium">
            {ar
              ? `🟢 الموقع ${posN} على ${toPlate} فارغ — لا يوجد عليه كاوتش، سيُركَّب هنا مباشرة.`
              : `🟢 Position ${posN} on ${toPlate} is empty — no tire here, it mounts straight in.`}
          </p>
        )}
        {occupant && (
          <div className="text-xs bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 space-y-2">
            <p className="text-amber-700 font-medium">
              {ar
                ? `🔴 استبدال: الموقع ${posN} عليه الفردة ${occupant.serial} — لازم تحدد الفردة القديمة دي هتروح فين؟`
                : `🔴 Replacement: position ${posN} holds ${occupant.serial} — where does the old tire go?`}
            </p>
            <div className="space-y-1">
              {FATES.map((f) => (
                <label key={f.key} className={`flex items-start gap-2 px-2 py-1.5 rounded-md cursor-pointer border ${displacedTo === f.key ? 'bg-white border-[#f37121]' : 'border-transparent hover:bg-white/60'}`}>
                  <input type="radio" name="displacedTo" checked={displacedTo === f.key} onChange={() => setDisplacedTo(f.key)} className="mt-0.5 accent-[#f37121]" />
                  <span>
                    <span className="font-semibold text-slate-800">{ar ? f.ar : f.en}</span>
                    <span className="block text-[11px] text-slate-500">{ar ? f.hint : f.hintEn}</span>
                  </span>
                </label>
              ))}
            </div>
            {/* سليمة للمخزن → نكمّل السايكل: نسجّل نسبة حالتها لأجل التسكين لاحقًا. */}
            {displacedTo === 'store' && (
              <div className="pt-1">
                <label className={labelCls}>{ar ? `حالة الفردة ${occupant.serial} عند التخزين (النسبة المئوية)` : `Condition % of ${occupant.serial} on storing`}</label>
                <div className="flex items-center gap-2">
                  <input type="number" min={0} max={100} value={displacedPercent} onChange={(e) => setDisplacedPercent(e.target.value)}
                    placeholder={ar ? 'مثال: 60' : 'e.g. 60'} className={`${inputCls} w-28`} />
                  <span className="text-slate-500">%</span>
                </div>
              </div>
            )}
          </div>
        )}
        {tire.status === 'mounted' && tire.plate && tire.plate !== toPlate && (
          <div>
            <label className={labelCls}>{ar ? `بديل يُركَّب مكانها على ${tire.plate} (اختياري)` : `Replacement for its old slot on ${tire.plate} (optional)`}</label>
            <SearchSelect value={replacementId} onChange={setReplacementId} options={[{ value: '', label: ar ? '— دون بديل —' : '— none —' }, ...spareOptions(tires, tire, ar)]} ar={ar}
              placeholder={ar ? '— دون بديل —' : '— none —'} searchPlaceholder={ar ? 'ابحث بالسيريال أو الرقم…' : 'Search serial / number…'} />
          </div>
        )}
        <div>
          <label className={labelCls}>{ar ? 'السبب' : 'Reason'}</label>
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={ar ? 'مثال: تآكل / لحام / تدوير…' : 'e.g. wear / puncture / rotation…'} className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>{ar ? 'ملاحظات' : 'Notes'}</label>
          <input value={notes} onChange={(e) => setNotes(e.target.value)} className={inputCls} />
        </div>
        <button
          type="button" disabled={busy || !toPlate || (!!occupant && !displacedTo)}
          onClick={() => onSubmit({
            toPlate, positionNumber: posN, positionLabel: pos.label, section: pos.section, reason, notes,
            ...(occupant ? { displacedTo } : {}),
            ...(occupant && displacedTo === 'store' && displacedPercent !== '' ? { displacedConditionPercent: Number(displacedPercent) } : {}),
            ...(replacementId && tire.plate && tire.plate !== toPlate ? { replacementTireId: replacementId } : {}),
          })}
          className="w-full py-2 rounded-lg bg-[#f37121] hover:bg-[#d95f13] text-white text-sm font-medium disabled:opacity-40"
        >
          {occupant && !displacedTo ? (ar ? 'حدد مصير الفردة القديمة أولًا' : 'Choose the old tire’s fate first') : (ar ? 'تنفيذ النقل' : 'Move')}
        </button>
      </div>
    </Modal>
  );
}

// ---- Renewal result: the ONLY exit from «في المصنع» --------------------------
function RenewalResultModal({ tire, ar, busy, onClose, onSubmit }: {
  tire: TireAsset; ar: boolean; busy: boolean; onClose: () => void; onSubmit: (result: 'renewed' | 'scrap', notes: string) => void;
}) {
  const [result, setResult] = useState<'' | 'renewed' | 'scrap'>('');
  const [notes, setNotes] = useState('');
  return (
    <Modal title={ar ? `نتيجة التجديد — الفردة ${tire.serial}` : `Renewal result — ${tire.serial}`} onClose={onClose}>
      <div className="space-y-3">
        <p className="text-xs text-slate-500">{ar ? 'رجعت الفردة من المصنع — ما النتيجة؟' : 'The tire is back from the factory — what came out?'}</p>
        <label className={`flex items-start gap-2 px-3 py-2.5 rounded-lg cursor-pointer border ${result === 'renewed' ? 'border-blue-400 bg-blue-50' : 'border-slate-200 hover:bg-slate-50'}`}>
          <input type="radio" name="renewalResult" checked={result === 'renewed'} onChange={() => setResult('renewed')} className="mt-0.5 accent-blue-600" />
          <span>
            <span className="font-semibold text-slate-800">{ar ? 'نجح التجديد — قابلة للاستخدام' : 'Renewed — usable'}</span>
            <span className="block text-[11px] text-slate-500">{ar ? 'تعود إلى المخزن مستعملة صالحة — تُركَّب في أي موضع، رأس أو تيدر' : 'Back to stock as a usable used tire — mounts anywhere, head or trailer'}</span>
          </span>
        </label>
        <label className={`flex items-start gap-2 px-3 py-2.5 rounded-lg cursor-pointer border ${result === 'scrap' ? 'border-slate-500 bg-slate-100' : 'border-slate-200 hover:bg-slate-50'}`}>
          <input type="radio" name="renewalResult" checked={result === 'scrap'} onChange={() => setResult('scrap')} className="mt-0.5 accent-slate-600" />
          <span>
            <span className="font-semibold text-slate-800">{ar ? 'سكراب — غير قابلة للاستخدام' : 'Scrap — not usable'}</span>
            <span className="block text-[11px] text-slate-500">{ar ? 'تُخزَّن سكراب حتى تُباع' : 'Kept as scrap in store until sold'}</span>
          </span>
        </label>
        <div>
          <label className={labelCls}>{ar ? 'ملاحظات' : 'Notes'}</label>
          <input value={notes} onChange={(e) => setNotes(e.target.value)} className={inputCls} />
        </div>
        <button type="button" disabled={busy || !result} onClick={() => result && onSubmit(result, notes)}
          className="w-full py-2 rounded-lg bg-[#f37121] hover:bg-[#d95f13] text-white text-sm font-medium disabled:opacity-40">
          {ar ? 'تسجيل النتيجة' : 'Record result'}
        </button>
      </div>
    </Modal>
  );
}

// ---- Damaged / scrap (outside the renewal loop) ------------------------------
function RetireTireModal({ tire, ar, busy, onClose, onSubmit }: {
  tire: TireAsset; ar: boolean; busy: boolean; onClose: () => void; onSubmit: (kind: 'damaged' | 'scrap', reason: string) => void;
}) {
  const [kind, setKind] = useState<'' | 'damaged' | 'scrap'>('');
  const [reason, setReason] = useState('');
  return (
    <Modal title={ar ? `إخراج الفردة ${tire.serial} من الخدمة` : `Take ${tire.serial} out of service`} onClose={onClose}>
      <div className="space-y-3">
        <label className={`flex items-start gap-2 px-3 py-2.5 rounded-lg cursor-pointer border ${kind === 'damaged' ? 'border-red-400 bg-red-50' : 'border-slate-200 hover:bg-slate-50'}`}>
          <input type="radio" name="retireKind" checked={kind === 'damaged'} onChange={() => setKind('damaged')} className="mt-0.5 accent-red-600" />
          <span>
            <span className="font-semibold text-slate-800">{ar ? 'تالفة' : 'Damaged'}</span>
            <span className="block text-[11px] text-slate-500">{ar ? 'انفجرت أو تآكلت تمامًا — لا وجود لها ولا يمكن إصلاحها' : 'Blown / fully worn — gone, unrepairable'}</span>
          </span>
        </label>
        <label className={`flex items-start gap-2 px-3 py-2.5 rounded-lg cursor-pointer border ${kind === 'scrap' ? 'border-slate-500 bg-slate-100' : 'border-slate-200 hover:bg-slate-50'}`}>
          <input type="radio" name="retireKind" checked={kind === 'scrap'} onChange={() => setKind('scrap')} className="mt-0.5 accent-slate-600" />
          <span>
            <span className="font-semibold text-slate-800">{ar ? 'سكراب' : 'Scrap'}</span>
            <span className="block text-[11px] text-slate-500">{ar ? 'موجودة لكنها غير صالحة — تُخزَّن حتى تُباع' : 'Exists but unusable — stored until sold'}</span>
          </span>
        </label>
        <div>
          <label className={labelCls}>{ar ? 'السبب' : 'Reason'}</label>
          <input value={reason} onChange={(e) => setReason(e.target.value)} className={inputCls} />
        </div>
        <button type="button" disabled={busy || !kind} onClick={() => kind && onSubmit(kind, reason)}
          className="w-full py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm font-medium disabled:opacity-40">
          {ar ? 'تنفيذ' : 'Confirm'}
        </button>
      </div>
    </Modal>
  );
}

// ---- Change tire status (نقل بين الحالات) -----------------------------------
function TireStatusModal({ tire, ar, busy, onClose, onSubmit }: {
  tire: TireAsset; ar: boolean; busy: boolean; onClose: () => void;
  onSubmit: (body: { status: string; conditionPercent?: number | null; reason?: string }) => void;
}) {
  const OPTS: { v: string; ar: string; en: string; sub: string; subEn: string; cls: string }[] = [
    { v: 'spare', ar: 'في المخزن', en: 'In stock', sub: 'سليمة/احتياطي جاهز للتركيب', subEn: 'Usable spare', cls: 'border-amber-400 bg-amber-50' },
    { v: 'in_repair', ar: 'في المصنع', en: 'At the factory', sub: 'راحت مصنع التجديد', subEn: 'Sent to the retreading factory', cls: 'border-blue-400 bg-blue-50' },
    { v: 'scrap', ar: 'سكراب', en: 'Scrap', sub: 'غير صالحة — تُخزَّن حتى تُباع', subEn: 'Unusable — kept to sell', cls: 'border-slate-500 bg-slate-100' },
    { v: 'damaged', ar: 'تالفة', en: 'Damaged', sub: 'انفجرت/تآكلت — لا يمكن إصلاحها', subEn: 'Blown — unrepairable', cls: 'border-red-400 bg-red-50' },
    { v: 'retired', ar: 'معدومة', en: 'Retired', sub: 'خارج الخدمة نهائيًا', subEn: 'Out of service', cls: 'border-red-300 bg-red-50' },
    { v: 'sold', ar: 'مُباعة', en: 'Sold', sub: 'بيعت كخردة', subEn: 'Sold as scrap', cls: 'border-emerald-400 bg-emerald-50' },
  ];
  const [status, setStatus] = useState('');
  const [pct, setPct] = useState<string>(tire.conditionPercent != null ? String(tire.conditionPercent) : '');
  const [reason, setReason] = useState('');
  const mounted = tire.status === 'mounted';
  return (
    <Modal title={ar ? `نقل الفردة ${tire.serial} إلى حالة أخرى` : `Move ${tire.serial} to another status`} onClose={onClose}>
      <div className="space-y-2.5">
        {mounted && <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">{ar ? 'هذه الفردة مركّبة حاليًا — سيتم فكّها تلقائيًا من المركبة عند النقل.' : 'This tire is mounted — it will be auto-unmounted.'}</p>}
        <div className="grid grid-cols-2 gap-2">
          {OPTS.map((o) => (
            <label key={o.v} className={`flex items-start gap-2 px-3 py-2 rounded-lg cursor-pointer border text-xs ${status === o.v ? o.cls : 'border-slate-200 hover:bg-slate-50'}`}>
              <input type="radio" name="tstatus" checked={status === o.v} onChange={() => setStatus(o.v)} className="mt-0.5" />
              <span>
                <span className="font-semibold text-slate-800">{ar ? o.ar : o.en}</span>
                <span className="block text-[10px] text-slate-500">{ar ? o.sub : o.subEn}</span>
              </span>
            </label>
          ))}
        </div>
        {(status === 'spare' || status === 'in_repair') && (
          <div>
            <label className={labelCls}>{ar ? 'نسبة الحالة %' : 'Condition %'}</label>
            <input type="number" min={0} max={100} value={pct} onChange={(e) => setPct(e.target.value)} className={inputCls} placeholder="0–100" />
          </div>
        )}
        <div>
          <label className={labelCls}>{ar ? 'السبب / ملاحظة' : 'Reason / note'}</label>
          <input value={reason} onChange={(e) => setReason(e.target.value)} className={inputCls} />
        </div>
        <button type="button" disabled={busy || !status}
          onClick={() => status && onSubmit({ status, conditionPercent: pct === '' ? null : Number(pct), reason })}
          className="w-full py-2 rounded-lg bg-[#12325c] hover:bg-[#0f2748] text-white text-sm font-medium disabled:opacity-40">
          {ar ? 'تنفيذ النقل' : 'Confirm'}
        </button>
      </div>
    </Modal>
  );
}

// ---- Add / edit tire --------------------------------------------------------
function TireFormModal({ tire, flatbeds, ar, onClose, onSaved }: {
  tire: TireAsset | null; flatbeds: Flatbed[]; ar: boolean; onClose: () => void; onSaved: () => void;
}) {
  const { notify } = useDialog();
  const isEdit = !!tire;
  const [serial, setSerial] = useState(tire?.serial || '');
  const [tireNumber, setTireNumber] = useState(tire?.tireNumber || '');
  const [type, setType] = useState(tire?.type || '');
  const [size, setSize] = useState(tire?.size || '');
  const [condition, setCondition] = useState<'new' | 'used'>(tire?.condition === 'used' ? 'used' : 'new');
  const [sensor, setSensor] = useState(tire?.sensor || 'unknown');
  const [notes, setNotes] = useState(tire?.notes || '');
  const [mountPlate, setMountPlate] = useState('');
  const [posN, setPosN] = useState<number>(1);
  const [busy, setBusy] = useState(false);
  const pos = POSITION_DEFS.find((p) => p.n === posN) || POSITION_DEFS[0];

  const save = async () => {
    if (!serial.trim()) { notify(ar ? 'السيريال مطلوب' : 'Serial required'); return; }
    setBusy(true);
    try {
      if (isEdit) {
        await api.patch(`/api/ls2/assets/tires/${tire!._id}`, { serial: serial.trim(), tireNumber, type, size, sensor, notes });
      } else {
        await api.post('/api/ls2/assets/tires', {
          serial: serial.trim(), tireNumber, type, size, sensor, notes, condition,
          ...(mountPlate ? { plate: mountPlate, positionNumber: posN, positionLabel: pos.label, section: pos.section } : {}),
        });
      }
      onSaved();
    } catch (e: any) { notify(e?.message || 'Failed', 'error'); }
    setBusy(false);
  };

  return (
    <Modal title={isEdit ? (ar ? `تعديل الفردة ${tire!.serial}` : `Edit tire ${tire!.serial}`) : (ar ? 'تسجيل فردة كاوتش جديدة' : 'Register new tire')} onClose={onClose}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>{ar ? 'السيريال' : 'Serial'} *</label>
            <input value={serial} onChange={(e) => setSerial(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>{ar ? 'رقم الفردة' : 'Tire number'}</label>
            <input value={tireNumber} onChange={(e) => setTireNumber(e.target.value)} className={inputCls} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>{ar ? 'النوع / الماركة' : 'Type / brand'}</label>
            <input value={type} onChange={(e) => setType(e.target.value)} placeholder="Michelin / Bridgestone / Conti / China" className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>{ar ? 'المقاس' : 'Size'}</label>
            <input value={size} onChange={(e) => setSize(e.target.value)} placeholder="315/80 R22.5" className={inputCls} dir="ltr" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>{ar ? 'سينسور' : 'Sensor'}</label>
            <select value={sensor} onChange={(e) => setSensor(e.target.value as any)} className={inputCls}>
              <option value="yes">{ar ? 'يوجد' : 'Yes'}</option>
              <option value="no">{ar ? 'لا يوجد' : 'No'}</option>
              <option value="unknown">{ar ? 'غير محدد' : 'Unknown'}</option>
            </select>
          </div>
          {!isEdit && (
            <div>
              <label className={labelCls}>{ar ? 'الدرجة' : 'Grade'}</label>
              <select value={condition} onChange={(e) => setCondition(e.target.value as any)} className={inputCls}>
                <option value="new">{ar ? 'جديد (من الشراء)' : 'New (from purchase)'}</option>
                <option value="used">{ar ? 'مستعمل (يشمل المجدَّد)' : 'Used (incl. retreaded)'}</option>
              </select>
            </div>
          )}
        </div>
        {!isEdit && (
          <div className="border border-slate-200 rounded-lg p-3 space-y-3">
            <p className="text-xs font-medium text-slate-500">{ar ? 'تركيب فوري (اختياري — اتركه فارغًا إذا كانت داخلة إلى المخزن)' : 'Mount now (optional — leave empty for stock)'}</p>
            <SearchSelect value={mountPlate} onChange={setMountPlate} options={flatbedOptions(flatbeds, ar)} ar={ar}
              placeholder={ar ? '— المخزن —' : '— stock —'} emptyLabel={ar ? '— المخزن —' : '— stock —'}
              searchPlaceholder={ar ? 'ابحث برقم السطحة…' : 'Search flatbed…'} />
            {mountPlate && (
              <SearchSelect value={String(posN)} onChange={(v) => setPosN(Number(v))} options={positionOptions()} ar={ar}
                searchPlaceholder={ar ? 'ابحث عن الموقع…' : 'Search position…'} />
            )}
          </div>
        )}
        <div>
          <label className={labelCls}>{ar ? 'ملاحظات' : 'Notes'}</label>
          <input value={notes} onChange={(e) => setNotes(e.target.value)} className={inputCls} />
        </div>
        <button type="button" disabled={busy} onClick={save} className="w-full py-2 rounded-lg bg-[#f37121] hover:bg-[#d95f13] text-white text-sm font-medium disabled:opacity-40">
          {isEdit ? (ar ? 'حفظ' : 'Save') : (ar ? 'تسجيل' : 'Register')}
        </button>
      </div>
    </Modal>
  );
}

// ---- Move trailer -----------------------------------------------------------
function MoveTrailerModal({ trailer, flatbeds, ar, busy, onClose, onSubmit }: {
  trailer: Trailer; flatbeds: Flatbed[]; ar: boolean; busy: boolean; onClose: () => void; onSubmit: (body: any) => void;
}) {
  const [toPlate, setToPlate] = useState('');
  const [reason, setReason] = useState('');
  // التيدر اللي على العربية المستقبِلة لازم يروح مكان محدّد — زي الداخل ⇐ الخارج
  // بتاع الكاوتش بالظبط. من غير الاختيار ده، تيدر بيختفي من غير ما حد يقول راح فين.
  const [displacedTo, setDisplacedTo] = useState<'standing' | 'swap'>('standing');
  const target = flatbeds.find((f) => f.plate === toPlate);
  const occupied = !!target?.currentTrailerNumber;
  const canSwap = occupied && !!trailer.currentPlate;
  return (
    <Modal title={ar ? `نقل التيدر ${trailer.trailerNumber}` : `Move trailer ${trailer.trailerNumber}`} onClose={onClose}>
      <div className="space-y-3">
        {trailer.currentPlate && <p className="text-xs text-slate-500">{ar ? `حاليًا على السطحة ${trailer.currentPlate}` : `Currently on ${trailer.currentPlate}`}</p>}
        <div>
          <label className={labelCls}>{ar ? 'إلى السطحة' : 'To flatbed'}</label>
          <SearchSelect value={toPlate} onChange={setToPlate}
            options={flatbedOptions(flatbeds.filter((f) => f.plate !== trailer.currentPlate), ar)} ar={ar}
            placeholder={ar ? '— اختر السطحة —' : '— choose flatbed —'} searchPlaceholder={ar ? 'ابحث برقم السطحة…' : 'Search flatbed…'} />
        </div>
        <p className="text-[11.5px] text-slate-700 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
          {ar ? 'التيدر بيتنقل بكاوتشه — كل فردة عليه بتتنقل معاه وبتتسجّل في التاريخ.'
              : 'The trailer moves with its tires — each one is carried and logged.'}
        </p>
        {occupied && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 space-y-1.5">
            <p className="text-xs text-amber-800 font-semibold">
              {ar ? `السطحة دي عليها التيدر ${target!.currentTrailerNumber} — يروح فين؟`
                  : `That flatbed carries trailer ${target!.currentTrailerNumber} — where does it go?`}
            </p>
            {([
              { key: 'standing' as const, ar: 'يقف لوحده بكاوتشه (من غير عربية)', en: 'Stands alone with its tires' },
              { key: 'swap' as const,
                ar: `يروح مكان التيدر ${trailer.trailerNumber} على ${trailer.currentPlate || '—'} (تبديل كامل)`,
                en: `Takes trailer ${trailer.trailerNumber}'s place on ${trailer.currentPlate || '—'} (full swap)` },
            ]).map((o) => (
              <label key={o.key}
                className={`flex items-start gap-2 px-2 py-1.5 rounded-md border cursor-pointer ${
                  o.key === 'swap' && !canSwap ? 'opacity-40 cursor-not-allowed border-transparent'
                    : displacedTo === o.key ? 'bg-white border-[#f37121]' : 'border-transparent hover:bg-white/70'}`}>
                <input type="radio" name="displacedTo" className="mt-0.5 accent-[#f37121]"
                  disabled={o.key === 'swap' && !canSwap}
                  checked={displacedTo === o.key} onChange={() => setDisplacedTo(o.key)} />
                <span className="text-[11.5px] text-slate-800 font-medium">{ar ? o.ar : o.en}</span>
              </label>
            ))}
            {!canSwap && (
              <p className="text-[11px] text-amber-700">
                {ar ? `التبديل متاح عندما يكون التيدر ${trailer.trailerNumber} مركَّبًا على مركبة — وهو حاليًا واقف بمفرده.`
                    : `Swap needs trailer ${trailer.trailerNumber} to be on a vehicle — it is standing alone.`}
              </p>
            )}
          </div>
        )}
        <div>
          <label className={labelCls}>{ar ? 'السبب' : 'Reason'}</label>
          <input value={reason} onChange={(e) => setReason(e.target.value)} className={inputCls} />
        </div>
        <button type="button" disabled={busy || !toPlate}
          onClick={() => onSubmit({ toPlate, reason, displacedTo })}
          className="w-full py-2 rounded-lg bg-[#f37121] hover:bg-[#d95f13] text-white text-sm font-medium disabled:opacity-40">
          {!toPlate ? (ar ? 'اختر السطحة' : 'Choose a flatbed')
            : occupied && displacedTo === 'swap' ? (ar ? `تبديل التيدرين` : 'Swap the two trailers')
            : occupied ? (ar ? `نقل ${trailer.trailerNumber} وإيقاف ${target!.currentTrailerNumber}` : 'Move & stand the other down')
            : (ar ? 'تنفيذ النقل' : 'Move')}
        </button>
      </div>
    </Modal>
  );
}

function AddTrailerForm({ flatbeds, ar, onSaved }: { flatbeds: Flatbed[]; ar: boolean; onSaved: () => void }) {
  const { notify } = useDialog();
  const [trailerNumber, setTrailerNumber] = useState('');
  const [plate, setPlate] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!trailerNumber.trim()) return;
    setBusy(true);
    try { await api.post('/api/ls2/assets/trailers', { trailerNumber: trailerNumber.trim(), plate: plate || null }); onSaved(); }
    catch (e: any) { notify(e?.message || 'Failed', 'error'); }
    setBusy(false);
  };
  return (
    <div className="space-y-3">
      <div>
        <label className={labelCls}>{ar ? 'رقم التيدر' : 'Trailer number'} *</label>
        <input value={trailerNumber} onChange={(e) => setTrailerNumber(e.target.value)} className={inputCls} />
      </div>
      <div>
        <label className={labelCls}>{ar ? 'مركّب على (اختياري)' : 'On flatbed (optional)'}</label>
        <SearchSelect value={plate} onChange={setPlate} options={flatbedOptions(flatbeds, ar)} ar={ar}
          placeholder={ar ? '— غير مركّب —' : '— unhitched —'} emptyLabel={ar ? '— غير مركّب —' : '— unhitched —'}
          searchPlaceholder={ar ? 'ابحث برقم السطحة…' : 'Search flatbed…'} />
      </div>
      <button type="button" disabled={busy || !trailerNumber.trim()} onClick={save} className="w-full py-2 rounded-lg bg-[#f37121] hover:bg-[#d95f13] text-white text-sm font-medium disabled:opacity-40">
        {ar ? 'إضافة' : 'Add'}
      </button>
    </div>
  );
}

function EditFlatbedForm({ flatbed, ar, onSaved }: { flatbed: Flatbed; ar: boolean; onSaved: () => void }) {
  const { notify } = useDialog();
  const [numbering, setNumbering] = useState<string>(flatbed.numbering != null ? String(flatbed.numbering) : '');
  const [batch, setBatch] = useState(flatbed.batch || '');
  const [brand, setBrand] = useState(flatbed.brand || '');
  const [notes, setNotes] = useState(flatbed.notes || '');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try { await api.patch(`/api/ls2/assets/flatbeds/${flatbed._id}`, { numbering: numbering === '' ? null : Number(numbering), batch, brand, notes }); onSaved(); }
    catch (e: any) { notify(e?.message || 'Failed', 'error'); }
    setBusy(false);
  };
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className={labelCls}>{ar ? 'الترقيم' : 'Numbering'}</label>
          <input type="number" value={numbering} onChange={(e) => setNumbering(e.target.value)} className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>{ar ? 'الدفعة' : 'Batch'}</label>
          <input value={batch} onChange={(e) => setBatch(e.target.value)} className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>{ar ? 'الماركة' : 'Brand'}</label>
          <input value={brand} onChange={(e) => setBrand(e.target.value)} className={inputCls} />
        </div>
      </div>
      <div>
        <label className={labelCls}>{ar ? 'ملاحظات' : 'Notes'}</label>
        <input value={notes} onChange={(e) => setNotes(e.target.value)} className={inputCls} />
      </div>
      <button type="button" disabled={busy} onClick={save} className="w-full py-2 rounded-lg bg-[#f37121] hover:bg-[#d95f13] text-white text-sm font-medium disabled:opacity-40">
        {ar ? 'حفظ' : 'Save'}
      </button>
    </div>
  );
}

// ---- Import workshop JSON ---------------------------------------------------
function ImportModal({ ar, onClose, onDone }: { ar: boolean; onClose: () => void; onDone: () => void }) {
  const { notify } = useDialog();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<any>(null);
  const run = async () => {
    let payload: any;
    try { payload = JSON.parse(text); } catch { notify(ar ? 'JSON غير صالح' : 'Invalid JSON'); return; }
    setBusy(true);
    try {
      const res = await api.post<any>('/api/ls2/assets/import', payload);
      setResult(res.summary);
    } catch (e: any) { notify(e?.message || 'Failed', 'error'); }
    setBusy(false);
  };
  return (
    <Modal title={ar ? 'استيراد كشف الورشة (JSON)' : 'Import workshop JSON'} onClose={onClose} wide>
      <div className="space-y-3">
        <p className="text-xs text-slate-500">
          {ar
            ? 'ألصِق صيغة JSON نفسها المستخدَمة في الورشة: { "vehicles": [...] } و/أو { "flatbeds": [...] }. الاستيراد آمن للتكرار: الفردة التي تظهر على مركبة أخرى تُسجَّل كنقل بتاريخه، لا كتسجيل جديد.'
            : 'Paste the workshop-collected JSON: { "vehicles": [...] } and/or { "flatbeds": [...] }. Idempotent: a serial appearing on another truck is recorded as a transfer, not a duplicate.'}
        </p>
        <textarea
          value={text} onChange={(e) => setText(e.target.value)} rows={12} dir="ltr"
          placeholder='{ "vehicles": [ { "vehicle_number": "2708", "trailer_number": "23", "tires": [ ... ] } ] }'
          className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs font-mono focus:outline-none focus:border-[#f37121]"
        />
        {result && (
          <p className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
            {ar
              ? `تم: ${result.flatbeds} سطحة · ${result.trailers} حركة تيدر · ${result.tiresNew} فردة جديدة · ${result.tiresMoved} نُقلت · ${result.tiresUnchanged} بدون تغيير`
              : `Done: ${result.flatbeds} flatbeds · ${result.trailers} trailer moves · ${result.tiresNew} new tires · ${result.tiresMoved} moved · ${result.tiresUnchanged} unchanged`}
          </p>
        )}
        <div className="flex gap-2">
          <button type="button" disabled={busy || !text.trim()} onClick={run} className="flex-1 py-2 rounded-lg bg-[#f37121] hover:bg-[#d95f13] text-white text-sm font-medium disabled:opacity-40">
            {busy ? (ar ? 'جارٍ الاستيراد…' : 'Importing…') : (ar ? 'استيراد' : 'Import')}
          </button>
          {result && (
            <button type="button" onClick={onDone} className="flex-1 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium">
              {ar ? 'إغلاق وتحديث' : 'Close & refresh'}
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
