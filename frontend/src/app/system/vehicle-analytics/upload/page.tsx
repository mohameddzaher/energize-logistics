'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import vehicleDB, { STORES } from '@/lib/vehicleAnalyticsDB';
import type { UploadSession } from '@/lib/vehicleAnalyticsDB';
import * as XLSX from 'xlsx';
import { Upload, Fuel, MapPin, Truck, Loader2, Trash2, ChevronDown, ChevronUp, Database, CheckCircle2, AlertCircle } from 'lucide-react';

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
  const ws = wb.Sheets['Worksheet'];
  if (!ws) throw new Error('Sheet "Worksheet" not found');
  const raw = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, defval: '' });
  if (raw.length < 3) throw new Error('Not enough rows in Worksheet');
  const headers = ['num', 'branch', 'vehicle', 'model', 'year', 'fuel', 'consType', 'maxConsump', 'currentRate', 'status', 'category'];
  const rows: Record<string, any>[] = [];
  for (let i = 2; i < raw.length; i++) {
    const r = raw[i] as any[];
    if (!r || !r[2]) continue; // skip empty vehicle rows
    const obj: Record<string, any> = {};
    headers.forEach((h, idx) => { obj[h] = r[idx] ?? ''; });
    obj.vehicleId = vehicleDB.extractVehicleId('petro_app', String(r[2]));
    rows.push(obj);
  }
  return rows;
}

function parseLocationSolution(wb: XLSX.WorkBook): { movements: Record<string, any>[]; odometer: Record<string, any>[] } {
  // Movements from "DISTANCE,SPEED" sheet
  const movSheet = wb.Sheets['DISTANCE,SPEED'];
  const movements: Record<string, any>[] = [];
  if (movSheet) {
    const data = XLSX.utils.sheet_to_json<any>(movSheet, { defval: '' });
    const colMap: Record<string, string> = {
      'Beginning': 'beginning', 'Initial location': 'initialLocation', 'End': 'end',
      'Final location': 'finalLocation', 'Duration': 'duration', 'Distance': 'distance',
      'Max speed': 'maxSpeed', 'Avg speed': 'avgSpeed',
    };
    for (const row of data) {
      const obj: Record<string, any> = {};
      for (const [excelCol, key] of Object.entries(colMap)) {
        obj[key] = row[excelCol] ?? '';
      }
      // Try to extract vehicleId from the row context or group name
      obj.vehicleId = vehicleDB.extractVehicleId('gps_grouping', String(row['Unit'] || row['Vehicle'] || ''));
      movements.push(obj);
    }
  }

  // Odometer from "Odometer Report" sheet
  const odoSheet = wb.Sheets['Odometer Report'];
  const odometer: Record<string, any>[] = [];
  if (odoSheet) {
    const raw = XLSX.utils.sheet_to_json<any[]>(odoSheet, { header: 1, defval: '' });
    let currentVehicle = '';
    let currentDriver = '';
    for (const row of raw) {
      const firstCell = String(row[0] || '').trim();
      // Grouping rows contain vehicle info - e.g. "1234 - Driver Name"
      if (firstCell && !firstCell.match(/^\d{4}[-/]/) && firstCell.match(/\d/)) {
        const parts = firstCell.split(/\s*[-–]\s*/);
        currentVehicle = vehicleDB.extractVehicleId('gps_grouping', parts[0] || '');
        currentDriver = parts[1] || '';
        continue;
      }
      // Data rows with date-like first cell
      if (firstCell.match(/^\d{4}[-/]\d{2}/) && currentVehicle) {
        odometer.push({
          vehicleId: currentVehicle, driver: currentDriver,
          date: row[0], initial: row[1], final: row[2], distance: row[3],
        });
      }
    }
  }
  return { movements, odometer };
}

function parseHTTrips(wb: XLSX.WorkBook): { trips: Record<string, any>[]; kms: Record<string, any>[] } {
  // Trips from "Row Data (2)"
  const tripSheet = wb.Sheets['Row Data (2)'];
  const trips: Record<string, any>[] = [];
  if (tripSheet) {
    const data = XLSX.utils.sheet_to_json<any>(tripSheet, { defval: '' });
    const colMap: Record<string, string> = {
      'الشهر': 'month', 'مسلسل': 'serial', 'نوع السياره': 'vehicleType',
      'رقم السياره': 'vehicleNumber', 'سائق اول': 'driver1',
      'بدايه ال trip': 'tripStart', 'نهايه ال trip': 'tripEnd',
      'عدد الايام': 'days', 'الفرع': 'branch',
      'مكان التحميل': 'loadingPlace', 'مكان التنزيل': 'unloadingPlace',
      'نوع الدفع للايجار': 'rentalPaymentType', 'الايجار كامل': 'fullRental',
      'revenue': 'revenue', 'البيع': 'selling',
      'مصروف السائق الفعلي': 'actualDriverExpense',
    };
    for (const row of data) {
      const obj: Record<string, any> = {};
      for (const [arCol, key] of Object.entries(colMap)) {
        obj[key] = row[arCol] ?? '';
      }
      for (const [k, v] of Object.entries(row)) { if (!Object.keys(colMap).includes(k) && !obj[k]) obj[k] = v; }
      obj.vehicleId = String(obj.vehicleNumber || '');
      trips.push(obj);
    }
  }

  // KMs from "KMs Record 2026"
  const kmsSheet = wb.Sheets['KMs Record 2026'];
  const kms: Record<string, any>[] = [];
  if (kmsSheet) {
    const data = XLSX.utils.sheet_to_json<any>(kmsSheet, { defval: '' });
    for (const row of data) {
      kms.push({ ...row, vehicleId: String(row['رقم السياره'] || row['Vehicle'] || '') });
    }
  }
  return { trips, kms };
}

const SECTIONS: { key: SourceKey; title: string; subtitle: string; icon: typeof Fuel; stores: string[] }[] = [
  { key: 'petro_app', title: 'Petro App', subtitle: 'Fuel consumption data', icon: Fuel, stores: [STORES.PETRO] },
  { key: 'location_solution', title: 'Location Solution', subtitle: 'GPS movements & odometer', icon: MapPin, stores: [STORES.GPS_MOVEMENTS, STORES.GPS_ODOMETER] },
  { key: 'ht_trips', title: 'HT Trips', subtitle: 'Trip records & KM data', icon: Truck, stores: [STORES.HT_TRIPS, STORES.HT_KMS] },
];

export default function VehicleAnalyticsUploadPage() {
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
      if (dup) { updateSection(key, { loading: false, error: 'This file was already imported.' }); return; }
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

      if (totalRecords === 0) { updateSection(key, { loading: false, error: 'No records found in file.' }); return; }

      // Log session
      await vehicleDB.addSession({
        source: key, uploadDate: new Date().toISOString(), periodStart: '', periodEnd: '',
        recordCount: totalRecords, fileName: file.name, fileHash: hash,
      });
      updateSection(key, { progress: 100, loading: false, success: `Imported ${totalRecords} records from ${file.name}` });
      await loadStats();
    } catch (err: any) {
      updateSection(key, { loading: false, error: err.message || 'Failed to parse file' });
    }
  };

  const handleClear = async (key: SourceKey) => {
    if (!confirm('Clear all data for this source? This cannot be undone.')) return;
    await vehicleDB.clearSource(key);
    updateSection(key, { file: null, success: '', error: '', sessions: [], recordCount: 0 });
    await loadStats();
  };

  const onDrop = (key: SourceKey) => (e: React.DragEvent) => {
    e.preventDefault();
    updateSection(key, { dragOver: false });
    const file = e.dataTransfer.files?.[0];
    if (file && (file.name.endsWith('.xlsx') || file.name.endsWith('.xls'))) handleImport(key, file);
    else updateSection(key, { error: 'Please upload an .xlsx or .xls file' });
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
        <h1 className="text-2xl font-bold text-white flex items-center gap-3">
          <Database className="w-7 h-7 text-[#f37121]" />
          Vehicle Analytics Upload Center
        </h1>
        <p className="text-gray-400 text-sm mt-1">Import data from Petro App, Location Solution, and HT Trips</p>
      </div>

      {/* Upload Sections */}
      {SECTIONS.map(({ key, title, subtitle, icon: Icon }) => {
        const s = sections[key];
        const lastSession = s.sessions[s.sessions.length - 1];
        return (
          <div key={key} className="bg-gray-800 border border-gray-700 rounded-xl overflow-hidden">
            {/* Card Header */}
            <div className="px-5 py-4 border-b border-gray-700 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-[#f37121]/15 flex items-center justify-center">
                  <Icon className="w-5 h-5 text-[#f37121]" />
                </div>
                <div>
                  <h2 className="text-white font-semibold">{title}</h2>
                  <p className="text-gray-500 text-xs">{subtitle}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                {s.recordCount > 0 && (
                  <span className="text-xs text-gray-400 bg-gray-700 px-2.5 py-1 rounded-full">
                    {s.recordCount.toLocaleString()} records
                  </span>
                )}
                {s.recordCount > 0 && (
                  <button onClick={() => handleClear(key)} title="Clear data"
                    className="p-1.5 text-gray-500 hover:text-red-400 hover:bg-red-400/10 rounded-lg transition-colors">
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>

            {/* Last import info */}
            {lastSession && (
              <div className="px-5 py-2.5 bg-gray-750 border-b border-gray-700 text-xs text-gray-400 flex items-center gap-4">
                <span>Last: <span className="text-gray-300">{lastSession.fileName}</span></span>
                <span>{new Date(lastSession.uploadDate).toLocaleDateString()}</span>
                <span>{lastSession.recordCount} records</span>
              </div>
            )}

            {/* Drop Zone */}
            <div className="p-5">
              {s.error && (
                <div className="mb-3 flex items-center gap-2 text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                  <AlertCircle className="w-4 h-4 shrink-0" /> {s.error}
                </div>
              )}
              {s.success && (
                <div className="mb-3 flex items-center gap-2 text-green-400 text-sm bg-green-500/10 border border-green-500/20 rounded-lg px-3 py-2">
                  <CheckCircle2 className="w-4 h-4 shrink-0" /> {s.success}
                </div>
              )}

              <div
                onDragOver={(e) => { e.preventDefault(); updateSection(key, { dragOver: true }); }}
                onDragLeave={() => updateSection(key, { dragOver: false })}
                onDrop={onDrop(key)}
                onClick={() => !s.loading && fileRefs[key].current?.click()}
                className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-all ${
                  s.dragOver ? 'border-[#f37121] bg-[#f37121]/5' : 'border-gray-600 hover:border-[#f37121]/50 hover:bg-gray-700/30'
                } ${s.loading ? 'pointer-events-none opacity-60' : ''}`}
              >
                {s.loading ? (
                  <div className="space-y-3">
                    <Loader2 className="w-8 h-8 text-[#f37121] mx-auto animate-spin" />
                    <p className="text-gray-400 text-sm">Importing... {s.progress}%</p>
                    <div className="w-48 mx-auto h-1.5 bg-gray-700 rounded-full overflow-hidden">
                      <div className="h-full bg-[#f37121] rounded-full transition-all duration-300" style={{ width: `${s.progress}%` }} />
                    </div>
                  </div>
                ) : (
                  <>
                    <Upload className="w-7 h-7 text-gray-500 mx-auto mb-2" />
                    <p className="text-gray-400 text-sm">Drop Excel file here or click to browse</p>
                    <p className="text-gray-600 text-xs mt-1">.xlsx / .xls</p>
                  </>
                )}
              </div>
              <input ref={fileRefs[key]} type="file" accept=".xlsx,.xls" onChange={onFileChange(key)} className="hidden" />
            </div>

            {/* Import History */}
            {s.sessions.length > 0 && (
              <div className="border-t border-gray-700">
                <button onClick={() => updateSection(key, { historyOpen: !s.historyOpen })}
                  className="w-full px-5 py-2.5 flex items-center justify-between text-xs text-gray-400 hover:bg-gray-700/30 transition-colors">
                  <span>Import History ({s.sessions.length})</span>
                  {s.historyOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                </button>
                {s.historyOpen && (
                  <div className="px-5 pb-3 space-y-1.5">
                    {[...s.sessions].reverse().map((sess, i) => (
                      <div key={i} className="flex items-center justify-between text-xs bg-gray-900/50 rounded-lg px-3 py-2">
                        <span className="text-gray-300 truncate max-w-[200px]">{sess.fileName}</span>
                        <div className="flex items-center gap-3 text-gray-500">
                          <span>{sess.recordCount} records</span>
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
      <div className="bg-gray-800 border border-gray-700 rounded-xl p-5">
        <h3 className="text-white font-semibold text-sm mb-3 flex items-center gap-2">
          <Database className="w-4 h-4 text-[#f37121]" /> Data Summary
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {[
            { label: 'Petro App', count: summary.petroCount },
            { label: 'GPS Movements', count: summary.gpsMovCount },
            { label: 'GPS Odometer', count: summary.gpsOdoCount },
            { label: 'HT Trips', count: summary.htTripsCount },
            { label: 'HT KMs', count: summary.htKmsCount },
          ].map(({ label, count }) => (
            <div key={label} className="bg-gray-900 rounded-lg px-3 py-2.5 text-center">
              <p className="text-lg font-bold text-white">{count.toLocaleString()}</p>
              <p className="text-gray-500 text-xs mt-0.5">{label}</p>
            </div>
          ))}
        </div>
        <div className="mt-3 text-right text-xs text-gray-500">
          Total: <span className="text-[#f37121] font-medium">{totalRecords.toLocaleString()}</span> records across all sources
        </div>
      </div>
    </div>
  );
}
