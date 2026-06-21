'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import { ArrowLeft, ArrowRight, Check, Loader2, Ship, Copy, Mail, Ban, RotateCcw, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { useLanguage } from '@/context/LanguageContext';
import { getCustomsTranslations } from '@/lib/translations';

const STAGE_ORDER = [
  'papers_received', 'declaration_paid', 'do_requested', 'do_linked', 'port_fees_paid',
  'unloading_fees_paid', 'transport_order', 'containers_transported', 'unloaded_stored',
  'containers_returned', 'invoiced',
];

export default function CustomsDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { user } = useAuth();
  const canEdit = ['super_admin', 'admin', 'operations_manager', 'customs_manager', 'customs_officer'].includes(user?.role || '');
  const { lang, isRTL } = useLanguage();
  const T = getCustomsTranslations(lang);

  const [c, setC] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState('');

  const fetchOne = useCallback(async () => {
    try {
      const data = await api.get<any>(`/api/customs-clearance/${params.id}`);
      setC(data.clearance);
    } catch {
      router.push('/system/customs');
    }
    setLoading(false);
  }, [params.id, router]);

  useEffect(() => { fetchOne(); }, [fetchOne]);
  useSocket('customs:updated', useCallback((d: any) => { if (d?.clearance?._id === params.id) setC(d.clearance); }, [params.id]));

  // Persist a partial change immediately (gives the "automatic / instant" feel).
  const patch = async (partial: any) => {
    if (!canEdit || !c) return;
    setSaving(true);
    const optimistic = { ...c, ...partial, documents: { ...c.documents, ...(partial.documents || {}) }, agentPapers: { ...c.agentPapers, ...(partial.agentPapers || {}) } };
    setC(optimistic);
    try {
      const data = await api.put<any>(`/api/customs-clearance/${c._id}`, optimistic);
      if (data?.clearance) setC(data.clearance);
    } catch { fetchOne(); }
    setSaving(false);
  };

  const copy = (key: string, text: string) => {
    navigator.clipboard?.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(''), 1400);
  };

  if (loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-[#f37121] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }
  if (!c) return null;

  const currentIdx = STAGE_ORDER.indexOf(c.stage);
  const bl = c.blNumber || '';
  const emails = {
    doInvoiceRequest: { subject: `BL ${bl}`, body: 'Dear,\nGreetings,\n\nKindly find attached file & issue DO invoice.' },
    linkDoRequest: { subject: `BL ${bl}`, body: 'Dear,\nGreetings,\n\nKindly find attached files & link DO.' },
    etaEnquiry: { subject: 'ETA enquiry', body: `Dear,\nGreetings,\n\nKindly Provide ETA for the following BL/s:\n1- ${bl}` },
  };
  const mailto = (s: string, b: string) =>
    `mailto:${c.shippingAgentEmail || ''}?subject=${encodeURIComponent(s)}&body=${encodeURIComponent(b)}`;

  const Back = isRTL ? ArrowRight : ArrowLeft;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link href="/system/customs" className="p-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors"><Back className="w-4 h-4" /></Link>
          <div className="w-10 h-10 rounded-lg bg-[#f37121]/20 flex items-center justify-center"><Ship className="w-5 h-5 text-[#f37121]" /></div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900">{c.refNumber}</h1>
            <p className="text-slate-500 text-sm">{c.branch === 'dammam' ? T.dammam : T.jeddah} · {c.cancelled ? T.cancelled : (T.stages[c.stage] || c.stage)}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {saving && <span className="text-slate-400 text-xs flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /></span>}
          {canEdit && (
            c.cancelled
              ? <button type="button" onClick={() => patch({ cancelled: false })} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-green-500/15 text-green-600 text-sm font-medium hover:bg-green-500/25 transition-colors"><RotateCcw className="w-4 h-4" /> {T.reactivate}</button>
              : <button type="button" onClick={() => patch({ cancelled: true })} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-red-500/15 text-red-600 text-sm font-medium hover:bg-red-500/25 transition-colors"><Ban className="w-4 h-4" /> {T.markCancelled}</button>
          )}
        </div>
      </div>

      {/* Stage pipeline (dark card on the light page) */}
      <div className="relative overflow-hidden rounded-xl bg-slate-900 border border-slate-800 p-5 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-white font-semibold">{T.progress}</h3>
          {canEdit && currentIdx < STAGE_ORDER.length - 1 && !c.cancelled && (
            <button type="button" onClick={() => patch({ stage: STAGE_ORDER[currentIdx + 1] })}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#f37121] text-white text-xs font-medium hover:bg-[#e06010] transition-colors">
              {T.advanceStage} <ChevronRight className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {STAGE_ORDER.map((s, i) => {
            const done = i < currentIdx;
            const cur = i === currentIdx && !c.cancelled;
            return (
              <button key={s} type="button" disabled={!canEdit} onClick={() => patch({ stage: s })}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-left transition-colors ${canEdit ? 'cursor-pointer' : 'cursor-default'} ${
                  cur ? 'bg-[#f37121] text-white' : done ? 'bg-slate-800 text-slate-200 hover:bg-slate-700' : 'bg-slate-800/50 text-slate-400 hover:bg-slate-800'
                }`}>
                <span className={`w-5 h-5 shrink-0 rounded-full flex items-center justify-center text-[10px] font-bold ${cur ? 'bg-white/20' : done ? 'bg-green-500/30 text-green-300' : 'bg-slate-700 text-slate-400'}`}>
                  {done ? <Check className="w-3 h-3" /> : i + 1}
                </span>
                <span className="truncate">{T.stages[s]}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Transaction data */}
        <div className="lg:col-span-2 bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
          <h3 className="bg-slate-900 px-3 py-2 rounded-lg text-white font-semibold mb-4">{T.transactionData}</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FieldInput label={T.blNumber} value={c.blNumber} onSave={(v) => patch({ blNumber: v })} disabled={!canEdit} />
            <FieldInput label={T.customerName} value={c.customerName} onSave={(v) => patch({ customerName: v })} disabled={!canEdit} />
            <FieldInput label={T.invoiceNumber} value={c.invoiceNumber} onSave={(v) => patch({ invoiceNumber: v })} disabled={!canEdit} />
            <FieldInput label={T.invoiceDate} type="date" value={c.invoiceDate ? String(c.invoiceDate).slice(0, 10) : ''} onSave={(v) => patch({ invoiceDate: v || null })} disabled={!canEdit} />
            <FieldInput label={T.port} value={c.port} onSave={(v) => patch({ port: v })} disabled={!canEdit} />
            <FieldSelect label={T.invoiceType} value={c.invoiceType || ''} options={[['', '—'], ['C&F', 'C&F'], ['CIF', 'CIF'], ['FOB', 'FOB']]} onSave={(v) => patch({ invoiceType: v })} disabled={!canEdit} />
            <FieldInput label={T.containerCount} type="number" value={c.containerCount} onSave={(v) => patch({ containerCount: Number(v) || 0 })} disabled={!canEdit} />
            <FieldInput label={T.totalWeight} type="number" value={c.totalWeight} onSave={(v) => patch({ totalWeight: Number(v) || 0 })} disabled={!canEdit} />
            <FieldInput label={T.invoiceValue} type="number" value={c.invoiceValue} onSave={(v) => patch({ invoiceValue: Number(v) || 0 })} disabled={!canEdit} />
            <FieldInput label={T.currency} value={c.currency} onSave={(v) => patch({ currency: v })} disabled={!canEdit} />
            <FieldInput label={T.exporterCompany} value={c.exporterCompany} onSave={(v) => patch({ exporterCompany: v })} disabled={!canEdit} />
            <FieldInput label={T.countryOfOrigin} value={c.countryOfOrigin} onSave={(v) => patch({ countryOfOrigin: v })} disabled={!canEdit} />
            <FieldInput label={T.hsCode} value={c.hsCode} onSave={(v) => patch({ hsCode: v })} disabled={!canEdit} />
            <FieldInput label={T.saberNumber} value={c.saberNumber} onSave={(v) => patch({ saberNumber: v })} disabled={!canEdit} />
            <FieldInput label={T.assignedTo} value={c.assignedTo} onSave={(v) => patch({ assignedTo: v })} disabled={!canEdit} />
            <FieldSelect label={T.branch} value={c.branch} options={[['jeddah', T.jeddah], ['dammam', T.dammam]]} onSave={(v) => patch({ branch: v })} disabled={!canEdit} />
            <FieldInput label={T.shippingAgent} value={c.shippingAgent} onSave={(v) => patch({ shippingAgent: v })} disabled={!canEdit} />
            <FieldInput label={T.shippingAgentEmail} value={c.shippingAgentEmail} onSave={(v) => patch({ shippingAgentEmail: v })} disabled={!canEdit} />
          </div>
          <div className="mt-4">
            <FieldInput label={T.notes} value={c.notes} onSave={(v) => patch({ notes: v })} disabled={!canEdit} />
          </div>
        </div>

        {/* Side column: checklists + emails */}
        <div className="space-y-6">
          <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
            <h3 className="bg-slate-900 px-3 py-2 rounded-lg text-white font-semibold mb-3">{T.documentsChecklist}</h3>
            <div className="space-y-1">
              <Toggle label={T.docBl} on={c.documents?.bl} onToggle={(v) => patch({ documents: { bl: v } })} disabled={!canEdit} />
              <Toggle label={T.docCommercialInvoice} on={c.documents?.commercialInvoice} onToggle={(v) => patch({ documents: { commercialInvoice: v } })} disabled={!canEdit} />
              <Toggle label={T.docCertificateOfOrigin} on={c.documents?.certificateOfOrigin} onToggle={(v) => patch({ documents: { certificateOfOrigin: v } })} disabled={!canEdit} />
              <Toggle label={T.docPackingList} on={c.documents?.packingList} onToggle={(v) => patch({ documents: { packingList: v } })} disabled={!canEdit} />
              <Toggle label={T.docSaber} on={c.documents?.saber} onToggle={(v) => patch({ documents: { saber: v } })} disabled={!canEdit} />
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
            <h3 className="bg-slate-900 px-3 py-2 rounded-lg text-white font-semibold mb-3">{T.agentPapersChecklist}</h3>
            <div className="space-y-1">
              <Toggle label={T.paperBlStamped} on={c.agentPapers?.blStamped} onToggle={(v) => patch({ agentPapers: { blStamped: v } })} disabled={!canEdit} />
              <Toggle label={T.paperCustomerAuth} on={c.agentPapers?.customerAuthorization} onToggle={(v) => patch({ agentPapers: { customerAuthorization: v } })} disabled={!canEdit} />
              <Toggle label={T.paperCompanyAuth} on={c.agentPapers?.companyAuthorization} onToggle={(v) => patch({ agentPapers: { companyAuthorization: v } })} disabled={!canEdit} />
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
            <h3 className="bg-slate-900 px-3 py-2 rounded-lg text-white font-semibold mb-3">{T.emailTemplates}</h3>
            <div className="space-y-3">
              {([['doInvoiceRequest', T.doInvoiceRequest], ['linkDoRequest', T.linkDoRequest], ['etaEnquiry', T.etaEnquiry]] as const).map(([key, label]) => {
                const e = emails[key];
                const full = `Subject: ${e.subject}\n\n${e.body}`;
                return (
                  <div key={key} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <p className="text-slate-900 text-sm font-medium mb-1">{label}</p>
                    <pre className="text-slate-600 text-xs whitespace-pre-wrap font-sans mb-2">{e.body}</pre>
                    <div className="flex items-center gap-2">
                      <button type="button" onClick={() => copy(key, full)} className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs transition-colors">
                        <Copy className="w-3.5 h-3.5" /> {copied === key ? T.copied : T.copyText}
                      </button>
                      <a href={mailto(e.subject, e.body)} className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#f37121] text-white text-xs hover:bg-[#e06010] transition-colors">
                        <Mail className="w-3.5 h-3.5" /> {T.openEmail}
                      </a>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Inline-editable text/number/date field that saves on blur.
function FieldInput({ label, value, onSave, type = 'text', disabled }: { label: string; value: any; onSave: (v: string) => void; type?: string; disabled?: boolean }) {
  const [v, setV] = useState<string>(value ?? '');
  useEffect(() => { setV(value ?? ''); }, [value]);
  return (
    <div>
      <label className="text-slate-500 text-xs mb-1 block">{label}</label>
      <input
        type={type}
        value={v}
        disabled={disabled}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => { if (String(v) !== String(value ?? '')) onSave(v); }}
        className="w-full px-3 py-2 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50 disabled:opacity-60 [color-scheme:light]"
      />
    </div>
  );
}

function FieldSelect({ label, value, options, onSave, disabled }: { label: string; value: string; options: [string, string][]; onSave: (v: string) => void; disabled?: boolean }) {
  return (
    <div>
      <label className="text-slate-500 text-xs mb-1 block">{label}</label>
      <select value={value} disabled={disabled} onChange={(e) => onSave(e.target.value)}
        className="w-full px-3 py-2 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50 disabled:opacity-60">
        {options.map(([val, lbl]) => <option key={val} value={val}>{lbl}</option>)}
      </select>
    </div>
  );
}

function Toggle({ label, on, onToggle, disabled }: { label: string; on?: boolean; onToggle: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button type="button" disabled={disabled} onClick={() => onToggle(!on)}
      className={`w-full flex items-center gap-2.5 px-2 py-2 rounded-lg text-sm text-left transition-colors ${disabled ? 'cursor-default' : 'hover:bg-slate-50'}`}>
      <span className={`w-5 h-5 shrink-0 rounded-md border flex items-center justify-center transition-colors ${on ? 'bg-green-500 border-green-500 text-white' : 'bg-white border-slate-300'}`}>
        {on && <Check className="w-3.5 h-3.5" />}
      </span>
      <span className={on ? 'text-slate-900' : 'text-slate-600'}>{label}</span>
    </button>
  );
}
