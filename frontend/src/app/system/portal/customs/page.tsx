'use client';
// بوابة العميل — معاملات التخليص الجمركي.
//
// A customs customer's real question is "المعاملة وصلت لفين؟". So each file is
// drawn as its position on the 11-stage pipeline, with the documents checklist,
// the container/declaration numbers and the dates behind it.
import { useState, useEffect, useCallback, useMemo } from 'react';
import api from '@/lib/api';
import { useLanguage } from '@/context/LanguageContext';
import { Ship, Container, Search, CheckCircle2, Circle, ChevronDown, ChevronRight } from 'lucide-react';
import { KpiTile } from '@/components/system/Scorecard';
import { CUSTOMS_STAGES, customsStageIndex, customsStageText, money, fmtDate, type Lang } from '@/lib/portal';
import ExportMenu, { exportScopeLabels, type ExportColumn } from '@/components/ls2/ExportMenu';

interface CustomsFile {
  _id: string;
  refNumber: string;
  branch: string;
  stage: string;
  cancelled: boolean;
  blNumber?: string; invoiceNumber?: string; invoiceDate?: string;
  port?: string; containerCount?: number; totalWeight?: number;
  invoiceValue?: number; currency?: string;
  exporterCompany?: string; countryOfOrigin?: string; hsCode?: string;
  declarationNumber?: string; declarationDate?: string;
  doNumber?: string; exitPermitNumber?: string;
  unloadingAppointment?: string; unloadingLocation?: string;
  shippingAgent?: string;
  documents?: Record<string, boolean>;
  stageDates?: Record<string, string>;
  createdAt: string;
}

const DOC_LABEL: Record<string, { ar: string; en: string }> = {
  bl: { ar: 'البوليصة', en: 'Bill of lading' },
  commercialInvoice: { ar: 'الفاتورة التجارية', en: 'Commercial invoice' },
  certificateOfOrigin: { ar: 'شهادة المنشأ', en: 'Certificate of origin' },
  packingList: { ar: 'بيان التعبئة', en: 'Packing list' },
  saber: { ar: 'شهادة سابر', en: 'SABER certificate' },
};

export default function PortalCustomsPage() {
  const { lang } = useLanguage();
  const ar = lang === 'ar';
  const tx = (en: string, a: string) => (ar ? a : en);

  const [items, setItems] = useState<CustomsFile[]>([]);
  const [containers, setContainers] = useState(0);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [stage, setStage] = useState('');
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await api.get<{ items: CustomsFile[]; containers: number }>('/api/portal/customs');
      setItems(r.items || []);
      setContainers(r.containers || 0);
    } catch { setItems([]); }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    let list = items;
    if (stage) list = list.filter((c) => c.stage === stage);
    const t = q.trim().toLowerCase();
    if (t) list = list.filter((c) => `${c.refNumber} ${c.blNumber} ${c.declarationNumber} ${c.port} ${c.exporterCompany}`.toLowerCase().includes(t));
    return list;
  }, [items, q, stage]);

  const active = items.filter((c) => !c.cancelled);
  const done = active.filter((c) => c.stage === 'invoiced').length;

  const exportColumns: ExportColumn[] = [
    { header: tx('Reference', 'الرقم المرجعي'), key: 'refNumber', width: 16 },
    { header: tx('BL number', 'رقم البوليصة'), key: 'blNumber', width: 18 },
    { header: tx('Declaration', 'رقم البيان'), key: 'declarationNumber', width: 18 },
    { header: tx('Stage', 'المرحلة'), key: 'stage', transform: (v: string) => customsStageText(v, lang as Lang), width: 24 },
    { header: tx('Port', 'الميناء'), key: 'port', width: 16 },
    { header: tx('Containers', 'الحاويات'), key: 'containerCount', width: 12 },
    { header: tx('Weight', 'الوزن'), key: 'totalWeight', width: 14 },
    { header: tx('Invoice value', 'قيمة الفاتورة'), key: 'invoiceValue', transform: (v: number) => money(v), width: 16 },
    { header: tx('Exporter', 'الشركة المصدّرة'), key: 'exporterCompany', width: 24 },
    { header: tx('Opened', 'تاريخ الفتح'), key: 'createdAt', transform: (v: string) => fmtDate(v), width: 14 },
  ];
  // `/api/portal/customs` يسلّم معاملات العميل كلَّها دفعةً واحدة، وفلترُ المرحلة
  // والبحث يعملان في المتصفّح؛ فالزرّ الواحد كان يصدّر المرحلة المختارة ويسمّيها الملفَّ كلَّه.
  const sheetName = tx('My customs files', 'معاملات التخليص');
  const scope = exportScopeLabels(ar);
  const exportOptions = [
    { key: 'shown', label: scope.shown, sheets: [{ name: sheetName, rows: filtered, columns: exportColumns }] },
    { key: 'all', label: scope.all, sheets: [{ name: sheetName, rows: items, columns: exportColumns }] },
  ];

  if (loading) {
    return <div className="flex items-center justify-center h-64"><div className="w-8 h-8 border-2 border-[#f37121] border-t-transparent rounded-full animate-spin" /></div>;
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{tx('My customs files', 'معاملات التخليص الجمركي')}</h1>
          <p className="text-slate-500 text-sm mt-1">
            {tx('Where each shipment stands on the clearance pipeline, with its documents and numbers.', 'موقع كل معاملة على مسار التخليص، مع أوراقها وأرقامها.')}
          </p>
        </div>
        <ExportMenu fileName="my-customs-files" lang={ar ? 'ar' : 'en'} variant="subtle" label={tx('Export Excel', 'تصدير Excel')} options={exportOptions} />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiTile label={tx('Files', 'المعاملات')} value={active.length} icon={<Ship className="w-4 h-4" />} />
        <KpiTile label={tx('Containers', 'الحاويات')} value={containers.toLocaleString()} accent="#0ea5e9" icon={<Container className="w-4 h-4" />} />
        <KpiTile label={tx('In progress', 'جارية')} value={active.length - done} accent="#f59e0b" />
        <KpiTile label={tx('Completed', 'مكتملة')} value={done} accent="#16a34a" icon={<CheckCircle2 className="w-4 h-4" />} />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative max-w-sm flex-1 min-w-[220px]">
          <Search className="absolute top-1/2 -translate-y-1/2 start-3 w-4 h-4 text-slate-400" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={tx('Search reference, BL, declaration…', 'ابحث بالرقم المرجعي أو البوليصة أو البيان…')}
            className="w-full ps-9 pe-3 py-2 rounded-lg border border-slate-200 text-sm text-slate-800 focus:outline-none focus:border-[#f37121]"
          />
        </div>
        <select value={stage} onChange={(e) => setStage(e.target.value)} className="px-3 py-2 rounded-lg border border-slate-200 text-sm text-slate-700">
          <option value="">{tx('All stages', 'كل المراحل')}</option>
          {CUSTOMS_STAGES.map((s) => <option key={s.key} value={s.key}>{ar ? s.ar : s.en}</option>)}
        </select>
      </div>

      <div className="space-y-3">
        {filtered.map((c) => {
          const idx = customsStageIndex(c.stage);
          const pct = idx < 0 ? 0 : ((idx + 1) / CUSTOMS_STAGES.length) * 100;
          const isOpen = open === c._id;
          return (
            <div key={c._id} className={`bg-white border rounded-xl p-4 shadow-sm ${c.cancelled ? 'border-slate-200 opacity-60' : 'border-slate-200'}`}>
              <button type="button" onClick={() => setOpen(isOpen ? null : c._id)} className="w-full text-start">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-slate-900 font-semibold text-sm flex items-center gap-2">
                      {isOpen ? <ChevronDown className="w-4 h-4 text-slate-400" /> : <ChevronRight className="w-4 h-4 text-slate-400 rtl:rotate-180" />}
                      {c.refNumber || c.blNumber || '—'}
                      {c.cancelled && <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-200 text-slate-600">{tx('Cancelled', 'ملغاة')}</span>}
                    </p>
                    <p className="text-slate-500 text-xs mt-0.5">
                      {[c.port, c.exporterCompany, c.countryOfOrigin].filter(Boolean).join(' · ') || '—'}
                    </p>
                  </div>
                  <div className="text-end">
                    <p className="text-[#f37121] text-xs font-medium">{customsStageText(c.stage, lang as Lang)}</p>
                    <p className="text-slate-400 text-[11px]">{(c.containerCount || 0)} {tx('containers', 'حاوية')} · {fmtDate(c.createdAt)}</p>
                  </div>
                </div>

                {/* The pipeline as a bar — position, not just a label. */}
                <div className="mt-3">
                  <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
                    <div className="h-full rounded-full bg-[#f37121]" style={{ width: `${pct}%` }} />
                  </div>
                  <p className="text-slate-400 text-[10px] mt-1">
                    {tx(`Stage ${idx + 1} of ${CUSTOMS_STAGES.length}`, `المرحلة ${idx + 1} من ${CUSTOMS_STAGES.length}`)}
                  </p>
                </div>
              </button>

              {isOpen && (
                <div className="mt-4 space-y-4 border-t border-slate-100 pt-4">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-2">
                    {([
                      [tx('BL number', 'رقم البوليصة'), c.blNumber],
                      [tx('Declaration', 'رقم البيان'), c.declarationNumber],
                      [tx('Declaration date', 'تاريخ البيان'), c.declarationDate],
                      [tx('Delivery order', 'إذن التسليم'), c.doNumber],
                      [tx('Exit permit', 'تصريح الخروج'), c.exitPermitNumber],
                      [tx('Invoice number', 'رقم الفاتورة'), c.invoiceNumber],
                      [tx('Invoice value', 'قيمة الفاتورة'), c.invoiceValue ? `${money(c.invoiceValue)} ${c.currency || ''}` : ''],
                      [tx('Total weight', 'الوزن الإجمالي'), c.totalWeight],
                      [tx('HS code', 'البند الجمركي'), c.hsCode],
                      [tx('Shipping agent', 'الوكيل الملاحي'), c.shippingAgent],
                      [tx('Unloading appointment', 'موعد التفريغ'), c.unloadingAppointment],
                      [tx('Unloading location', 'مكان التفريغ'), c.unloadingLocation],
                    ] as [string, any][]).map(([k, v]) => (
                      <div key={k} className="border-b border-slate-100 pb-1.5">
                        <p className="text-slate-400 text-[10px] uppercase tracking-wide">{k}</p>
                        <p className="text-slate-800 text-sm break-words">{v === null || v === undefined || v === '' ? '—' : String(v)}</p>
                      </div>
                    ))}
                  </div>

                  {c.documents && (
                    <div>
                      <p className="text-slate-700 text-xs font-semibold mb-1.5">{tx('Documents on file', 'الأوراق المستلمة')}</p>
                      <div className="flex flex-wrap gap-2">
                        {Object.entries(DOC_LABEL).map(([key, l]) => {
                          const ok = !!c.documents?.[key];
                          return (
                            <span key={key} className={`inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-lg border ${ok ? 'bg-green-50 border-green-200 text-green-700' : 'bg-slate-50 border-slate-200 text-slate-500'}`}>
                              {ok ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Circle className="w-3.5 h-3.5" />}
                              {ar ? l.ar : l.en}
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  <div>
                    <p className="text-slate-700 text-xs font-semibold mb-1.5">{tx('Clearance pipeline', 'مسار التخليص')}</p>
                    <ol className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1.5">
                      {CUSTOMS_STAGES.map((st, i) => {
                        const passed = idx >= i;
                        return (
                          <li key={st.key} className={`flex items-center gap-1.5 text-[11px] px-2 py-1 rounded ${passed ? 'text-slate-800' : 'text-slate-400'}`}>
                            {passed ? <CheckCircle2 className="w-3.5 h-3.5 text-green-600" /> : <Circle className="w-3.5 h-3.5" />}
                            {ar ? st.ar : st.en}
                          </li>
                        );
                      })}
                    </ol>
                  </div>
                </div>
              )}
            </div>
          );
        })}
        {!filtered.length && (
          <p className="text-slate-400 text-sm text-center py-10">{tx('No customs files', 'لا توجد معاملات تخليص')}</p>
        )}
      </div>
    </div>
  );
}
