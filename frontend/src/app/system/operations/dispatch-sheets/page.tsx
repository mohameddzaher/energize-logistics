'use client';
import { useState, useRef, useCallback, useMemo } from 'react';
import { useLanguage } from '@/context/LanguageContext';
import { getDispatchSheetsTranslations } from '@/lib/translations';
import {
  Upload, FileSpreadsheet, X, AlertCircle, Loader2, Download,
  CheckCircle2, FileText, ChevronDown, ChevronUp, RotateCcw,
} from 'lucide-react';
import { parseDispatchSheetExcel, type DispatchSheetParseResult } from '@/lib/dispatchSheetExcelParser';
import {
  generateDispatchSheetsZip,
  triggerDownload,
  type GenerateProgress,
} from '@/lib/dispatchSheetGenerator';

const ORANGE = '#f37121';

export default function DispatchSheetsPage() {
  const { lang, isRTL } = useLanguage();
  const T = getDispatchSheetsTranslations(lang);

  const [file, setFile] = useState<File | null>(null);
  const [parsing, setParsing] = useState(false);
  const [parseResult, setParseResult] = useState<DispatchSheetParseResult | null>(null);
  const [error, setError] = useState('');
  const [dragOver, setDragOver] = useState(false);

  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState<GenerateProgress | null>(null);
  const [zipBlob, setZipBlob] = useState<Blob | null>(null);
  const [zipName, setZipName] = useState('');
  const [showRowDetails, setShowRowDetails] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const reset = useCallback(() => {
    setFile(null);
    setParseResult(null);
    setError('');
    setProgress(null);
    setZipBlob(null);
    setZipName('');
    setShowRowDetails(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, []);

  const handleFile = useCallback(async (f: File) => {
    setError('');
    setParseResult(null);
    setZipBlob(null);
    setProgress(null);

    if (!/\.xlsx$/i.test(f.name)) {
      setError(T.invalidFileType);
      return;
    }
    setFile(f);
    setParsing(true);
    try {
      const buffer = await f.arrayBuffer();
      const result = parseDispatchSheetExcel(buffer, f.name);
      setParseResult(result);
      if (result.missingColumns.length > 0) {
        setError(result.warnings[0] || T.errorTitle);
      }
    } catch (e: any) {
      setError(e?.message || T.unexpectedError);
    } finally {
      setParsing(false);
    }
  }, [T]);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) handleFile(f);
  }, [handleFile]);

  const onSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) handleFile(f);
  }, [handleFile]);

  const handleGenerate = useCallback(async () => {
    if (!parseResult || parseResult.rows.length === 0) return;
    setGenerating(true);
    setError('');
    setZipBlob(null);
    abortRef.current = new AbortController();
    try {
      const { blob, fileName } = await generateDispatchSheetsZip({
        rows: parseResult.rows,
        signal: abortRef.current.signal,
        onProgress: setProgress,
      });
      setZipBlob(blob);
      setZipName(fileName);
    } catch (e: any) {
      if (e?.message !== 'Aborted') setError(e?.message || T.unexpectedError);
    } finally {
      setGenerating(false);
      abortRef.current = null;
    }
  }, [parseResult, T]);

  const handleCancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const handleDownload = useCallback(() => {
    if (zipBlob && zipName) triggerDownload(zipBlob, zipName);
  }, [zipBlob, zipName]);

  const rowsWithMissing = useMemo(
    () => (parseResult?.rows || []).filter((r) => r.missingRequired.length > 0),
    [parseResult],
  );

  const progressPct = progress ? Math.round((progress.current / progress.total) * 100) : 0;
  const canGenerate = !!parseResult && parseResult.rows.length > 0 && parseResult.missingColumns.length === 0;

  return (
    <div className="max-w-5xl mx-auto" dir={isRTL ? 'rtl' : 'ltr'}>
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-white text-2xl font-bold flex items-center gap-2">
          <FileSpreadsheet className="w-6 h-6" style={{ color: ORANGE }} />
          {T.title}
        </h1>
        <p className="text-gray-400 text-sm mt-1">{T.subtitle}</p>
      </div>

      {/* Upload zone (hide once a file is parsed) */}
      {!parseResult && !parsing && (
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-colors ${
            dragOver ? 'border-[#f37121] bg-[#f37121]/10' : 'border-gray-600 hover:border-[#f37121]/70 bg-gray-800/40'
          }`}
        >
          <Upload className="w-12 h-12 text-gray-400 mx-auto mb-3" />
          <p className="text-white text-lg font-semibold">{T.dropHere}</p>
          <p className="text-gray-400 text-sm mt-1">{T.orClick}</p>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx"
            className="hidden"
            onChange={onSelect}
            aria-label="Excel file"
          />
        </div>
      )}

      {/* Parsing spinner */}
      {parsing && (
        <div className="bg-gray-800 rounded-xl p-8 text-center border border-gray-700">
          <Loader2 className="w-8 h-8 animate-spin mx-auto mb-2" style={{ color: ORANGE }} />
          <p className="text-gray-300">{T.parsing}</p>
        </div>
      )}

      {/* Error banner */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 my-4 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-red-300 font-semibold text-sm">{T.errorTitle}</p>
            <p className="text-red-200 text-sm mt-1">{error}</p>
            {parseResult?.missingColumns && parseResult.missingColumns.length > 0 && (
              <ul className="text-red-200 text-sm mt-2 list-disc list-inside">
                {parseResult.missingColumns.map((c) => <li key={c}>{c}</li>)}
              </ul>
            )}
          </div>
          <button onClick={reset} className="text-red-300 hover:text-red-100" aria-label="dismiss">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* File summary + generate controls */}
      {parseResult && parseResult.missingColumns.length === 0 && (
        <div className="bg-gray-800 border border-gray-700 rounded-xl p-5 mt-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3">
              <FileSpreadsheet className="w-6 h-6" style={{ color: ORANGE }} />
              <div>
                <p className="text-white font-semibold text-sm">{file?.name}</p>
                <p className="text-gray-400 text-xs mt-0.5">
                  {T.rowsDetected}: <span className="text-white font-bold">{parseResult.totalRows}</span>
                  {parseResult.rowsWithMissingFields > 0 && (
                    <>
                      <span className="mx-2">•</span>
                      <span className="text-yellow-400">
                        {T.rowsWithMissing}: {parseResult.rowsWithMissingFields}
                      </span>
                    </>
                  )}
                </p>
              </div>
            </div>
            {!generating && !zipBlob && (
              <button
                onClick={reset}
                className="text-gray-400 hover:text-white text-sm flex items-center gap-1"
              >
                <X className="w-4 h-4" /> {T.remove}
              </button>
            )}
          </div>

          {/* Missing-rows warning */}
          {rowsWithMissing.length > 0 && !generating && !zipBlob && (
            <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4 mt-4">
              <div className="flex items-start gap-2">
                <AlertCircle className="w-5 h-5 text-yellow-400 flex-shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="text-yellow-200 font-semibold text-sm">{T.rowMissingTitle}</p>
                  <p className="text-yellow-100/80 text-xs mt-1">{T.rowMissingHint}</p>
                  <button
                    onClick={() => setShowRowDetails((s) => !s)}
                    className="text-yellow-300 hover:text-yellow-100 text-xs mt-2 inline-flex items-center gap-1"
                  >
                    {showRowDetails ? T.hideRows : T.showRows}
                    {showRowDetails ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                  </button>
                  {showRowDetails && (
                    <div className="mt-3 max-h-56 overflow-y-auto border border-yellow-500/20 rounded p-2 bg-black/20">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-yellow-200/80 text-start">
                            <th className="text-start pb-1 pe-2">{T.rowNumber}</th>
                            <th className="text-start pb-1">{T.missingFields}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rowsWithMissing.map((r) => (
                            <tr key={r.rowIndex} className="text-yellow-100">
                              <td className="py-0.5 pe-2 font-mono">{r.rowIndex}</td>
                              <td className="py-0.5">{r.missingRequired.join('، ')}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Action row */}
          <div className="mt-5 flex items-center gap-3 flex-wrap">
            {!zipBlob && !generating && (
              <button
                onClick={handleGenerate}
                disabled={!canGenerate}
                className="px-5 py-2.5 rounded-lg bg-[#f37121] hover:bg-[#d96218] text-white font-semibold text-sm flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <FileText className="w-4 h-4" />
                {T.generate}
              </button>
            )}
            {generating && (
              <button
                onClick={handleCancel}
                className="px-4 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-white text-sm flex items-center gap-2"
              >
                <X className="w-4 h-4" />
                {T.cancel}
              </button>
            )}
            {zipBlob && (
              <>
                <button
                  onClick={handleDownload}
                  className="px-5 py-2.5 rounded-lg bg-green-600 hover:bg-green-700 text-white font-semibold text-sm flex items-center gap-2"
                >
                  <Download className="w-4 h-4" />
                  {T.downloadAll}
                </button>
                <button
                  onClick={reset}
                  className="px-4 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-200 text-sm flex items-center gap-2"
                >
                  <RotateCcw className="w-4 h-4" />
                  {T.reset}
                </button>
              </>
            )}
          </div>

          {/* Progress bar */}
          {generating && progress && (
            <div className="mt-5">
              <div className="flex items-center justify-between text-sm mb-2">
                <span className="text-gray-300 inline-flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" style={{ color: ORANGE }} />
                  {T.generatingProgress
                    .replace('{current}', String(progress.current))
                    .replace('{total}', String(progress.total))}
                </span>
                <span className="text-white font-mono">{progressPct}%</span>
              </div>
              <div className="w-full h-2 bg-gray-700 rounded-full overflow-hidden">
                <div
                  className="h-full transition-all duration-200"
                  style={{ width: `${progressPct}%`, background: ORANGE }}
                />
              </div>
              <p className="text-gray-500 text-xs mt-2 truncate" title={progress.currentFileName}>
                {progress.currentFileName}
              </p>
            </div>
          )}

          {/* Success banner */}
          {zipBlob && (
            <div className="mt-5 bg-green-500/10 border border-green-500/30 rounded-lg p-4 flex items-start gap-3">
              <CheckCircle2 className="w-5 h-5 text-green-400 flex-shrink-0 mt-0.5" />
              <p className="text-green-200 text-sm">
                {T.successMessage.replace('{count}', String(parseResult.rows.length))}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
