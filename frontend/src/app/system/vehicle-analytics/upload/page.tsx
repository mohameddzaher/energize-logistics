'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import vehicleDB, { STORES } from '@/lib/vehicleAnalyticsDB';
import type { UploadSession } from '@/lib/vehicleAnalyticsDB';
import * as XLSX from 'xlsx';
import { Upload, Fuel, MapPin, Truck, Loader2, Trash2, ChevronDown, ChevronUp, Database, CheckCircle2, AlertCircle } from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';
import { getVehicleAnalyticsUploadTranslations } from '@/lib/translations';

function simpleHash(str: string): string {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36);
}
function fileHash(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  const len = bytes.length;
  let s = '';
  for (let i = 0; i < Math.min(2000, len); i++) s += String.fromCharCode(bytes[i]);
  for (let i = Math.max(0, len - 2000); i < len; i++) s += String.fromCharCode(bytes[i]);
  return simpleHash(s + ':' + len);
}

type SourceKey = 'petro_app' | 'location_solution' | 'ht_trips';

interface SectionState {
  file: File | null;
  loading: boolean;
  progress: number;
  error: string;
  success: string;
  sessions: UploadSession[];
  recordCount: number;
  historyOpen: boolean;
  dragOver: boolean;
}

const initialSection: SectionState = {
  file: null, loading: false, progress: 0, error: '', success: '',
  sessions: [], recordCount: 0, historyOpen: false, dragOver: false,
};

function parsePetro(wb: XLSX.WorkBook): Record<string, any>[] {
  const ws = wb.Sheets['Worksheet'] || wb.Sheets[wb.SheetNames[0]];
  if (!ws) throw new Error('No worksheet found');

  // Use raw array format, skip row 0 (company header), use row 1 as headers
  const raw = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, defval: '' });
  if (raw.length < 3) throw new Error('Not enough rows');

  // Row 1 (index 1) has headers - build header map
  const headerRow = (raw[1] as any[]).map(h => String(h || '').trim().toLowerCase());

  // Map possible header names to our field names
  const headerMap: Record<string, string[]> = {
    num: ['#', 'id', 'number', 'رقم'],
    branch: ['branch', 'الفرع'],
    vehicle: ['vehicle', 'plate', 'رقم اللوحة', 'المركبة'],
    model: ['model', 'الموديل', 'النوع'],
    year: ['year', 'السنة', 'سنة الصنع'],
    fuel: ['fuel', 'الوقود', 'fuel type'],
    consType: ['constype', 'consumption type', 'نوع الاستهلاك', 'type'],
    maxConsump: ['maxconsump', 'max consumption', 'max', 'الحد الأقصى', 'maximum consumption'],
    currentRate: ['currentrate', 'current rate', 'current', 'المعدل الحالي', 'current consumption'],
    status: ['status', 'الحالة'],
    category: ['category', 'الفئة', 'vehicle category'],
  };

  // Find column index for each field
  const colIndex: Record<string, number> = {};
  for (const [field, possibleNames] of Object.entries(headerMap)) {
    const idx = headerRow.findIndex(h => possibleNames.some(n => h.includes(n.toLowerCase())));
    if (idx >= 0) colIndex[field] = idx;
  }

  // If no header matching worked, fall back to position-based (original behavior)
  if (Object.keys(colIndex).length < 5) {
    const fallbackHeaders = ['num', 'branch', 'vehicle', 'model', 'year', 'fuel', 'consType', 'maxConsump', 'currentRate', 'status', 'category'];
    fallbackHeaders.forEach((h, i) => { colIndex[h] = i; });
  }

  const rows: Record<string, any>[] = [];
  for (let i = 2; i < raw.length; i++) {
    const r = raw[i] as any[];
    if (!r || r.every(c => !c && c !== 0)) continue; // skip completely empty rows

    const obj: Record<string, any> = {};
    for (const [field, idx] of Object.entries(colIndex)) {
      obj[field] = r[idx] ?? '';
    }

    // Normalize vehicle ID
    const vehiclePlate = String(obj.vehicle || '');
    if (!vehiclePlate) continue;
    obj.vehicleId = vehicleDB.extractVehicleId('petro_app', vehiclePlate);

    // Parse numbers
    obj.maxConsump = Number(obj.maxConsump) || 0;
    obj.currentRate = Number(obj.currentRate) || 0;
    obj.year = Number(obj.year) || 0;

    rows.push(obj);
  }
  return rows;
}

function parseLocationSolution(wb: XLSX.WorkBook): { movements: Record<string, any>[]; odometer: Record<string, any>[] } {
  const movements: Record<string, any>[] = [];
  const odometer: Record<string, any>[] = [];

  // Parse DISTANCE,SPEED sheet
  const movSheet = wb.Sheets['DISTANCE,SPEED'];
  if (movSheet) {
    const data = XLSX.utils.sheet_to_json<any>(movSheet, { defval: '' });
    for (const row of data) {
      const beginning = String(row['Beginning'] || row['بداية'] || '');
      const end = String(row['End'] || row['نهاية'] || '');
      const distance = Number(String(row['Distance'] || row['المسافة'] || '0').replace(/[^\d.]/g, '')) || 0;
      const maxSpeed = Number(String(row['Max speed'] || row['أقصى سرعة'] || '0').replace(/[^\d.]/g, '')) || 0;
      const avgSpeed = Number(String(row['Avg speed'] || row['متوسط السرعة'] || '0').replace(/[^\d.]/g, '')) || 0;

      movements.push({
        vehicleId: vehicleDB.extractVehicleId('gps_grouping', String(row['Unit'] || row['Grouping'] || row['المجموعة'] || '')),
        beginning,
        initialLocation: String(row['Initial location'] || row['الموقع الأول'] || ''),
        end,
        finalLocation: String(row['Final location'] || row['الموقع النهائي'] || ''),
        duration: String(row['Duration'] || row['المدة'] || ''),
        distance,
        maxSpeed,
        avgSpeed,
      });
    }
  }

  // Parse Odometer Report
  const odoSheet = wb.Sheets['Odometer Report'] || wb.Sheets['تقرير العداد'];
  if (odoSheet) {
    const raw = XLSX.utils.sheet_to_json<any[]>(odoSheet, { header: 1, defval: '' });
    if (raw.length > 0) {
      // Find header row (usually row 0 or 1)
      let headerRowIdx = 0;
      for (let i = 0; i < Math.min(3, raw.length); i++) {
        const r = raw[i] as any[];
        const joined = r.map(c => String(c || '')).join(' ').toLowerCase();
        if (joined.includes('km') || joined.includes('odometer') || joined.includes('grouping') || joined.includes('مجموعة') || joined.includes('كم')) {
          headerRowIdx = i;
          break;
        }
      }

      const headers = (raw[headerRowIdx] as any[]).map(h => String(h || '').toLowerCase());

      // Detect column indexes
      const findCol = (keywords: string[]) => headers.findIndex(h => keywords.some(k => h.includes(k)));
      const groupingCol = findCol(['grouping', 'vehicle', 'unit', 'مجموعة', 'مركبة', 'تجميع']);
      const totalKmCol = findCol(['total km', 'total kilometers', 'totalkm', 'إجمالي الكم', 'المسافة الإجمالية']);
      const beginOdoCol = findCol(['begin odometer', 'begin', 'initial', 'بداية', 'البداية']);
      const endOdoCol = findCol(['end odometer', 'end', 'final', 'نهاية', 'النهاية']);

      for (let i = headerRowIdx + 1; i < raw.length; i++) {
        const r = raw[i] as any[];
        const grouping = String(r[groupingCol >= 0 ? groupingCol : 0] || '').trim();
        if (!grouping || !grouping.match(/\d/)) continue;

        const vehicleId = vehicleDB.extractVehicleId('gps_grouping', grouping);
        const parts = grouping.split(/\s+/);
        const plateLetters = parts[1] || '';
        const driver = parts.slice(2).join(' ');

        const totalKm = totalKmCol >= 0 ? Number(String(r[totalKmCol] || '0').replace(/[^\d.-]/g, '')) || 0 : 0;
        const beginOdo = beginOdoCol >= 0 ? Number(String(r[beginOdoCol] || '0').replace(/[^\d.-]/g, '')) || 0 : 0;
        const endOdo = endOdoCol >= 0 ? Number(String(r[endOdoCol] || '0').replace(/[^\d.-]/g, '')) || 0 : 0;

        if (vehicleId && (totalKm > 0 || endOdo > 0)) {
          odometer.push({
            vehicleId,
            plateLetters,
            driver,
            distance: totalKm,
            beginOdometer: beginOdo,
            endOdometer: endOdo,
          });
        }
      }
    }
  }

  return { movements, odometer };
}

function parseHTTrips(wb: XLSX.WorkBook): { trips: Record<string, any>[]; kms: Record<string, any>[] } {
  const tripSheet = wb.Sheets['Row Data (2)'] || wb.Sheets[wb.SheetNames[0]];
  const trips: Record<string, any>[] = [];
  if (tripSheet) {
    const data = XLSX.utils.sheet_to_json<any>(tripSheet, { defval: '' });
    const colMap: Record<string, string> = {
      '#': 'num', 'الشهر': 'month', 'مسلسل': 'serial', 'نوع السياره': 'vehicleType',
      'رقم السياره': 'vehicleNumber', 'سائق اول': 'driver1', 'سائق ثاني': 'driver2',
      'بدايه ال trip': 'tripStart', 'نهايه ال trip': 'tripEnd',
      'عدد الايام': 'days', 'الفرع': 'branch',
      'مكان التحميل': 'loadingPlace', 'مكان التنزيل': 'unloadingPlace',
      'نوع الدفع للايجار': 'rentalPaymentType', 'الايجار كامل': 'fullRental',
      'revenue': 'revenue', 'البيع': 'selling',
      'مصروف السائق الفعلي': 'actualDriverExpense',
      'بانشر': 'puncture', 'قطع غيار': 'spareParts', 'غسيل / شحم': 'washing',
      'وقود': 'fuelCost', 'عموله البيع قدام': 'salesCommission',
      'عموله الدلال': 'brokerCommission', 'الجمعه': 'fridayBonus',
      'بونص': 'bonus', 'اجمالى المصروفات': 'totalExpenses',
      'اسم المصنع': 'manufacturer', 'نوع الحموله': 'cargoType',
      'نوع العميل': 'clientType', 'العميل': 'client',
      'المستحق': 'amountDue', 'علي عهده': 'custody',
      'تم التحميل': 'loadedDone', 'تم النزيل': 'unloadedDone',
      'تم ارسال صوره السند': 'receiptSent', 'تم تسليم السند': 'receiptDelivered',
      'ملاحظات': 'notes', 'المسئول': 'supervisor',
      'How to Collect': 'collectionMethod', 'مكان التحصيل': 'collectionPlace',
    };

    const numericFields = new Set(['fullRental', 'revenue', 'selling', 'actualDriverExpense', 'puncture', 'spareParts', 'washing', 'fuelCost', 'salesCommission', 'brokerCommission', 'fridayBonus', 'bonus', 'totalExpenses', 'amountDue', 'days']);

    for (const row of data) {
      const obj: Record<string, any> = {};
      // Map known Arabic columns
      for (const [arCol, key] of Object.entries(colMap)) {
        if (row[arCol] !== undefined) obj[key] = row[arCol];
      }
      // Also keep unmapped columns with their original names
      for (const [k, v] of Object.entries(row)) {
        if (!Object.keys(colMap).includes(k)) obj[k] = v;
      }

      // Parse numeric fields
      for (const field of numericFields) {
        if (obj[field] !== undefined) obj[field] = Number(obj[field]) || 0;
      }

      obj.vehicleId = String(obj.vehicleNumber || '').trim();
      if (!obj.vehicleId) continue; // Skip rows with no vehicle

      trips.push(obj);
    }
  }

  // KMs from "KMs Record 2026"
  const kmsSheet = wb.Sheets['KMs Record 2026'];
  const kms: Record<string, any>[] = [];
  if (kmsSheet) {
    const data = XLSX.utils.sheet_to_json<any>(kmsSheet, { defval: '' });
    for (const row of data) {
      const vehicleId = String(row['رقم السياره'] || row['Vehicle'] || row['Vehicle ID'] || row[Object.keys(row)[0]] || '').trim();
      if (!vehicleId || !vehicleId.match(/\d/)) continue;
      kms.push({ ...row, vehicleId });
    }
  }
  return { trips, kms };
}

const SECTIONS: { key: SourceKey; titleKey: 'petroAppTitle' | 'locationSolutionTitle' | 'htTripsTitle'; subtitleKey: 'petroAppSubtitle' | 'locationSolutionSubtitle' | 'htTripsSubtitle'; icon: typeof Fuel; stores: string[] }[] = [
  { key: 'petro_app', titleKey: 'petroAppTitle', subtitleKey: 'petroAppSubtitle', icon: Fuel, stores: [STORES.PETRO] },
  { key: 'location_solution', titleKey: 'locationSolutionTitle', subtitleKey: 'locationSolutionSubtitle', icon: MapPin, stores: [STORES.GPS_MOVEMENTS, STORES.GPS_ODOMETER] },
  { key: 'ht_trips', titleKey: 'htTripsTitle', subtitleKey: 'htTripsSubtitle', icon: Truck, stores: [STORES.HT_TRIPS, STORES.HT_KMS] },
];

export default function VehicleAnalyticsUploadPage() {
  const { lang } = useLanguage();
  const tx = getVehicleAnalyticsUploadTranslations(lang);
  const [sections, setSections] = useState<Record<SourceKey, SectionState>>({ petro_app: { ...initialSection }, location_solution: { ...initialSection }, ht_trips: { ...initialSection } });
  const [summary, setSummary] = useState({ petroCount: 0, gpsMovCount: 0, gpsOdoCount: 0, htTripsCount: 0, htKmsCount: 0 });
  const fileRefs = { petro_app: useRef<HTMLInputElement>(null), location_solution: useRef<HTMLInputElement>(null), ht_trips: useRef<HTMLInputElement>(null) };

  const updateSection = useCallback((key: SourceKey, patch: Partial<SectionState>) => {
    setSections(prev => ({ ...prev, [key]: { ...prev[key], ...patch } }));
  }, []);

  const loadStats = useCallback(async () => {
    try {
      const s = await vehicleDB.getStoreSummary();
      setSummary({ petroCount: s.petroCount, gpsMovCount: s.gpsMovCount, gpsOdoCount: s.gpsOdoCount, htTripsCount: s.htTripsCount, htKmsCount: s.htKmsCount });
      for (const sec of SECTIONS) {
        const sessions = await vehicleDB.getSessions(sec.key);
        let count = 0;
        for (const st of sec.stores) count += await vehicleDB.countStore(st);
        updateSection(sec.key, { sessions, recordCount: count });
      }
    } catch { /* IndexedDB may not be available in SSR */ }
  }, [updateSection]);

  useEffect(() => { loadStats(); }, [loadStats]);

  const handleImport = async (key: SourceKey, file: File) => {
    updateSection(key, { file, loading: true, progress: 10, error: '', success: '' });
    try {
      const buf = await file.arrayBuffer();
      const hash = fileHash(buf);
      updateSection(key, { progress: 20 });

      // Duplicate check
      const dup = await vehicleDB.isDuplicate(key, hash);
      if (dup) { updateSection(key, { loading: false, error: tx.errorDuplicate }); return; }
      updateSection(key, { progress: 40 });

      // Parse
      const wb = XLSX.read(new Uint8Array(buf), { type: 'array' });
      let totalRecords = 0;

      if (key === 'petro_app') {
        const rows = parsePetro(wb);
        updateSection(key, { progress: 70 });
        await vehicleDB.addMany(STORES.PETRO, rows.map(r => ({ ...r, sessionHash: hash })));
        totalRecords = rows.length;
      } else if (key === 'location_solution') {
        const { movements, odometer } = parseLocationSolution(wb);
        updateSection(key, { progress: 60 });
        if (movements.length) await vehicleDB.addMany(STORES.GPS_MOVEMENTS, movements.map(r => ({ ...r, sessionHash: hash })));
        updateSection(key, { progress: 80 });
        if (odometer.length) await vehicleDB.addMany(STORES.GPS_ODOMETER, odometer.map(r => ({ ...r, sessionHash: hash })));
        totalRecords = movements.length + odometer.length;
      } else if (key === 'ht_trips') {
        const { trips, kms } = parseHTTrips(wb);
        updateSection(key, { progress: 60 });
        if (trips.length) await vehicleDB.addMany(STORES.HT_TRIPS, trips.map(r => ({ ...r, sessionHash: hash })));
        updateSection(key, { progress: 80 });
        if (kms.length) await vehicleDB.addMany(STORES.HT_KMS, kms.map(r => ({ ...r, sessionHash: hash })));
        totalRecords = trips.length + kms.length;
      }

      if (totalRecords === 0) { updateSection(key, { loading: false, error: tx.errorNoRecords }); return; }

      // Log session
      await vehicleDB.addSession({
        source: key, uploadDate: new Date().toISOString(), periodStart: '', periodEnd: '',
        recordCount: totalRecords, fileName: file.name, fileHash: hash,
      });
      updateSection(key, { progress: 100, loading: false, success: `${tx.importedPrefix} ${totalRecords} ${tx.recordsFromMid} ${file.name}` });
      await loadStats();
    } catch (err: any) {
      updateSection(key, { loading: false, error: err.message || tx.errorParseFailed });
    }
  };

  const handleClear = async (key: SourceKey) => {
    if (!confirm(tx.confirmClear)) return;
    await vehicleDB.clearSource(key);
    updateSection(key, { file: null, success: '', error: '', sessions: [], recordCount: 0 });
    await loadStats();
  };

  const onDrop = (key: SourceKey) => (e: React.DragEvent) => {
    e.preventDefault();
    updateSection(key, { dragOver: false });
    const file = e.dataTransfer.files?.[0];
    if (file && (file.name.endsWith('.xlsx') || file.name.endsWith('.xls'))) handleImport(key, file);
    else updateSection(key, { error: tx.errorFileType });
  };

  const onFileChange = (key: SourceKey) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleImport(key, file);
    e.target.value = '';
  };

  const totalRecords = summary.petroCount + summary.gpsMovCount + summary.gpsOdoCount + summary.htTripsCount + summary.htKmsCount;

  return (
    <div className="space-y-6 w-full max-w-4xl mx-auto">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-3">
          <Database className="w-7 h-7 text-[#f37121]" />
          {tx.pageTitle}
        </h1>
        <p className="text-slate-500 text-sm mt-1">{tx.pageSubtitle}</p>
      </div>

      {/* Upload Sections */}
      {SECTIONS.map(({ key, titleKey, subtitleKey, icon: Icon }) => {
        const s = sections[key];
        const lastSession = s.sessions[s.sessions.length - 1];
        return (
          <div key={key} className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
            {/* Card Header */}
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-[#f37121]/15 flex items-center justify-center">
                  <Icon className="w-5 h-5 text-[#f37121]" />
                </div>
                <div>
                  <h2 className="bg-slate-900 px-3 py-2 rounded-lg text-white font-semibold mb-3">{tx[titleKey]}</h2>
                  <p className="text-slate-500 text-xs">{tx[subtitleKey]}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                {s.recordCount > 0 && (
                  <span className="text-xs text-slate-500 bg-slate-100 px-2.5 py-1 rounded-full">
                    {s.recordCount.toLocaleString()} {tx.records}
                  </span>
                )}
                {s.recordCount > 0 && (
                  <button onClick={() => handleClear(key)} title={tx.clearData}
                    className="p-1.5 text-slate-500 hover:text-red-600 hover:bg-red-400/10 rounded-lg transition-colors">
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>

            {/* Last import info */}
            {lastSession && (
              <div className="px-5 py-2.5 bg-slate-100 border-b border-slate-200 text-xs text-slate-500 flex items-center gap-4">
                <span>{tx.lastLabel} <span className="text-slate-700">{lastSession.fileName}</span></span>
                <span>{new Date(lastSession.uploadDate).toLocaleDateString()}</span>
                <span>{lastSession.recordCount} {tx.records}</span>
              </div>
            )}

            {/* Drop Zone */}
            <div className="p-5">
              {s.error && (
                <div className="mb-3 flex items-center gap-2 text-red-600 text-sm bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                  <AlertCircle className="w-4 h-4 shrink-0" /> {s.error}
                </div>
              )}
              {s.success && (
                <div className="mb-3 flex items-center gap-2 text-green-600 text-sm bg-green-500/10 border border-green-500/20 rounded-lg px-3 py-2">
                  <CheckCircle2 className="w-4 h-4 shrink-0" /> {s.success}
                </div>
              )}

              <div
                onDragOver={(e) => { e.preventDefault(); updateSection(key, { dragOver: true }); }}
                onDragLeave={() => updateSection(key, { dragOver: false })}
                onDrop={onDrop(key)}
                onClick={() => !s.loading && fileRefs[key].current?.click()}
                className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-all ${
                  s.dragOver ? 'border-[#f37121] bg-[#f37121]/5' : 'border-slate-300 hover:border-[#f37121]/50 hover:bg-slate-100'
                } ${s.loading ? 'pointer-events-none opacity-60' : ''}`}
              >
                {s.loading ? (
                  <div className="space-y-3">
                    <Loader2 className="w-8 h-8 text-[#f37121] mx-auto animate-spin" />
                    <p className="text-slate-500 text-sm">{tx.importing} {s.progress}%</p>
                    <div className="w-48 mx-auto h-1.5 bg-slate-100 rounded-full overflow-hidden">
                      <div className="h-full bg-[#f37121] rounded-full transition-all duration-300" style={{ width: `${s.progress}%` }} />
                    </div>
                  </div>
                ) : (
                  <>
                    <Upload className="w-7 h-7 text-slate-500 mx-auto mb-2" />
                    <p className="text-slate-500 text-sm">{tx.dropZone}</p>
                    <p className="text-slate-600 text-xs mt-1">.xlsx / .xls</p>
                  </>
                )}
              </div>
              <input ref={fileRefs[key]} type="file" accept=".xlsx,.xls" onChange={onFileChange(key)} className="hidden" />
            </div>

            {/* Import History */}
            {s.sessions.length > 0 && (
              <div className="border-t border-slate-200">
                <button onClick={() => updateSection(key, { historyOpen: !s.historyOpen })}
                  className="w-full px-5 py-2.5 flex items-center justify-between text-xs text-slate-500 hover:bg-slate-100 transition-colors">
                  <span>{tx.importHistory} ({s.sessions.length})</span>
                  {s.historyOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                </button>
                {s.historyOpen && (
                  <div className="px-5 pb-3 space-y-1.5">
                    {[...s.sessions].reverse().map((sess, i) => (
                      <div key={i} className="flex items-center justify-between text-xs bg-slate-100 rounded-lg px-3 py-2">
                        <span className="text-slate-700 truncate max-w-[200px]">{sess.fileName}</span>
                        <div className="flex items-center gap-3 text-slate-500">
                          <span>{sess.recordCount} {tx.records}</span>
                          <span>{new Date(sess.uploadDate).toLocaleString()}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}

      {/* Summary Footer */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
        <h3 className="bg-slate-900 px-3 py-2 rounded-lg text-white font-semibold text-sm mb-3 flex items-center gap-2">
          <Database className="w-4 h-4 text-[#f37121]" /> {tx.dataSummary}
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {[
            { label: tx.summaryPetro, count: summary.petroCount },
            { label: tx.summaryGpsMovements, count: summary.gpsMovCount },
            { label: tx.summaryGpsOdometer, count: summary.gpsOdoCount },
            { label: tx.summaryHtTrips, count: summary.htTripsCount },
            { label: tx.summaryHtKms, count: summary.htKmsCount },
          ].map(({ label, count }) => (
            <div key={label} className="bg-slate-50 rounded-lg px-3 py-2.5 text-center">
              <p className="text-lg font-bold text-slate-900">{count.toLocaleString()}</p>
              <p className="text-slate-500 text-xs mt-0.5">{label}</p>
            </div>
          ))}
        </div>
        <div className="mt-3 text-end text-xs text-slate-500">
          {tx.totalLabel} <span className="text-[#f37121] font-medium">{totalRecords.toLocaleString()}</span> {tx.recordsAcrossAllSources}
        </div>
      </div>
    </div>
  );
}
