'use client';
/**
 * Invoicing request to Finance: the prices billed to the customer, one per line, with an optional note and attachment.
 * Payment stages are what we pay and play no part here. Invoice total = these lines x 1.15, computed by backend/utils/customsInvoice; the preview mirrors that rule.
 * Lines flagged `optional` by the server (transport legs, labour) may stay empty.
 */
import { useState, useMemo, useRef, useEffect } from 'react';
import { X, Loader2, Paperclip, Receipt, AlertTriangle } from 'lucide-react';
import api from '@/lib/api';

export interface SaleDef { key: string; nameAr: string; nameEn: string; optional?: boolean }
export interface StageEntry { key: string; label: string; amount: number | null; date?: string; payStatus?: string }

const money = (n: number) => (Math.round((n || 0) * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: 2 });
const VAT = 0.15;

export default function CloseWithInvoice({
  open, onClose, clearanceId, stages, ar, onDone, notify, transportReceived,
}: {
  open: boolean; onClose: () => void; clearanceId: string;
  stages: StageEntry[]; ar: boolean;
  /** Transport invoice already arrived (from payment stages or attached), so it is not asked for. */
  transportReceived?: boolean;
  onDone: (clearance: any) => void; notify: (m: string, tone?: any) => void;
}) {
  const t = (a: string, e: string) => (ar ? a : e);
  const [defs, setDefs] = useState<SaleDef[]>([]);
  const [rows, setRows] = useState<Record<string, { amount: string; note: string; file?: { dataUrl: string; fileName: string } }>>({});
  const [busy, setBusy] = useState(false);
  // Attachments from an earlier issue remain and are shown so they do not look lost.
  const [kept, setKept] = useState<Record<string, string>>({});
  const fileFor = useRef<string>('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    api.get<{ saleItemDefs: SaleDef[]; invoice: any }>(`/api/customs-clearance/${clearanceId}/invoice`)
      .then((d) => {
        setDefs(d.saleItemDefs || []);
        // Previously written values are read, not wiped, so re-closing does not start from empty.
        const pre: typeof rows = {};
        const files: Record<string, string> = {};
        (d.invoice?.lines || []).filter((l: any) => l.from === 'sale').forEach((l: any) => {
          pre[l.key] = { amount: String(l.amount ?? ''), note: l.note || '' };
          if (l.fileUrl) files[l.key] = l.fileUrl;
        });
        setRows(pre);
        setKept(files);
      })
      .catch(() => {});
  }, [open, clearanceId]);

  const set = (key: string, patch: Partial<{ amount: string; note: string; file: any }>) =>
    setRows((r) => ({ ...r, [key]: { ...{ amount: '', note: '' }, ...r[key], ...patch } }));

  const pick = (f: File | null) => {
    if (!f || !fileFor.current) return;
    const fr = new FileReader();
    fr.onload = () => set(fileFor.current, { file: { dataUrl: String(fr.result), fileName: f.name } });
    fr.readAsDataURL(f);
  };

  const preview = useMemo(() => {
    const priced = Object.entries(rows)
      .filter(([, v]) => v && String(v.amount).trim() !== '' && Number.isFinite(Number(v.amount)))
      .map(([key, v]) => ({ key, amount: Number(v.amount) }));
    const have = new Set(priced.map((x) => x.key));
    const saleNet = priced.reduce((a, p) => a + p.amount, 0);
    const vat = saleNet * VAT;
    return {
      saleNet: Math.round(saleNet * 100) / 100,
      vat: Math.round(vat * 100) / 100,
      grand: Math.round((saleNet + vat) * 100) / 100,
      missing: defs.filter((d) => !d.optional && !have.has(d.key)).map((d) => (ar ? d.nameAr : d.nameEn)),
      empty: priced.length === 0,
    };
  }, [rows, defs, ar]);
  // Is the transport invoice present now: arrived earlier or attached in this window.

  const save = async () => {
    const saleItems = Object.entries(rows)
      .filter(([, v]) => String(v.amount).trim() !== '')
      .map(([key, v]) => ({ key, amount: Number(v.amount), note: v.note, file: v.file?.dataUrl, fileName: v.file?.fileName }));
    if (preview.empty) { notify(t('اكتب سعرَ بندٍ واحدٍ على الأقلّ', 'Enter at least one price'), 'error'); return; }
    if (preview.missing.length) { notify(t(`اكتب سعرَ: ${preview.missing.join('، ')}`, `Enter the price of: ${preview.missing.join(', ')}`), 'error'); return; }
    setBusy(true);
    try {
      const d = await api.patch<any>(`/api/customs-clearance/${clearanceId}/invoice`, { saleItems });
      // A request to Finance, not an invoice: the transaction is invoiced when Finance says so.
      notify(d.closed
        ? t('أُرسل طلبُ الفوترة إلى الإدارة الماليّة وأُغلقت المعاملة', 'Invoice request sent to Finance — transaction closed')
        : t('أُرسل طلبُ الفوترة إلى الإدارة الماليّة', 'Invoice request sent to Finance'), 'success');
      onDone(d.clearance);
      onClose();
    } catch (e: any) { notify(e?.message || t('تعذّر إرسال طلب الفوترة', 'Failed'), 'error'); }
    setBusy(false);
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white w-full max-w-3xl max-h-[92vh] rounded-2xl shadow-xl flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-3.5 border-b border-slate-200 flex items-center gap-2">
          <Receipt className="w-4 h-4 text-[#f37121]" />
          <h3 className="font-bold text-slate-900">{t('طلب فوترة من الإدارة الماليّة', 'Request invoicing from Finance')}</h3>
          <button type="button" onClick={onClose} className="ms-auto text-slate-400 hover:text-slate-900"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-5 space-y-4 overflow-auto">
          <p className="text-[12px] text-slate-500">
            {t('اكتب الأسعارَ التي سيُحاسَب بها العميل. هذه البنودُ مستقلّةٌ عن مراحل السداد (ما ندفعه نحن)، وعليها تُحسَب ضريبة 15%. البنودُ المعلَّمة «اختياري» يجوز تركُها فارغة.',
               'Enter the prices the customer will be billed. These lines are separate from the payment stages (what we pay); 15% VAT applies to them. Lines marked optional may be left empty.')}
          </p>

          <div className="space-y-2">
            {defs.map((d) => {
              const r = rows[d.key] || { amount: '', note: '' };
              return (
                <div key={d.key} className="rounded-xl border border-slate-200 p-3">
                  <div className="flex flex-wrap items-end gap-2">
                    <div className="min-w-[9rem] flex-1">
                      <p className="text-[13px] font-semibold text-slate-800">{ar ? d.nameAr : d.nameEn}
                        {d.optional && <span className="ms-1.5 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500">{t('اختياري', 'optional')}</span>}</p>
                      <p className="text-[11px] text-slate-400">{t('+ ضريبة 15%', '+ 15% VAT')}</p>
                    </div>
                    <label className="block">
                      <span className="mb-1 block text-[10.5px] font-semibold text-slate-500">{t('سعر البيع', 'Selling price')}</span>
                      <input type="number" value={r.amount} onChange={(e) => set(d.key, { amount: e.target.value })}
                        className="w-28 rounded-lg border border-slate-200 px-2 py-1.5 text-sm text-end" />
                    </label>
                    <label className="block flex-1 min-w-[8rem]">
                      <span className="mb-1 block text-[10.5px] font-semibold text-slate-500">{t('ملاحظة', 'Note')}</span>
                      <input value={r.note} onChange={(e) => set(d.key, { note: e.target.value })}
                        className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-xs" />
                    </label>
                    <button type="button"
                      onClick={() => { fileFor.current = d.key; inputRef.current?.click(); }}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-slate-100 px-3 py-2 text-[11px] font-semibold text-slate-700 hover:bg-slate-200">
                      <Paperclip className="h-3.5 w-3.5" />
                      {r.file ? r.file.fileName.slice(0, 18) : kept[d.key] ? t('مُرفَق — استبدال', 'Attached — replace') : t('إرفاق', 'Attach')}
                    </button>
                  </div>
                </div>
              );
            })}
            <input ref={inputRef} type="file" className="hidden"
              accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx"
              onChange={(e) => pick(e.target.files?.[0] || null)} />
          </div>

          {/* Preview before saving, using the same rule the server computes with. */}
          <div className="rounded-xl bg-slate-50 border border-slate-200 p-3.5 space-y-1.5">
            <p className="text-[12px] font-bold text-slate-800">{t('معاينة الفاتورة', 'Invoice preview')}</p>
            <div className="flex items-center justify-between text-[12px] text-slate-700">
              <span>{t('البنود (قبل الضريبة)', 'Lines (before VAT)')}</span>
              <span className="tabular-nums">{money(preview.saleNet)}</span>
            </div>
            <div className="flex items-center justify-between text-[12px] text-slate-700">
              <span>{t('ضريبة 15%', '15% VAT')}</span>
              <span className="tabular-nums">{money(preview.vat)}</span>
            </div>
            <div className="flex items-center justify-between text-sm font-extrabold text-slate-900 border-t border-slate-300 pt-1.5">
              <span>{t('إجمالي الفاتورة', 'Invoice total')}</span>
              <span className="tabular-nums">{money(preview.grand)}</span>
            </div>
            {!!preview.missing.length && (
              <p className="text-[11px] text-red-700 flex items-center gap-1.5 pt-1">
                <AlertTriangle className="w-3.5 h-3.5" />
                {t(`مطلوبٌ قبل الإرسال: ${preview.missing.join('، ')}`, `Required before sending: ${preview.missing.join(', ')}`)}
              </p>
            )}
          </div>
        </div>

        <div className="px-5 py-3.5 border-t border-slate-200 flex items-center gap-2">
          <p className="text-[11px] text-slate-400 flex-1">
            {t('يذهب الطلبُ إلى «ماليات التخليص الجمركي»، ولا تُعَدّ المعاملةُ مفوترةً حتى تقول الإدارةُ الماليّة «تمّت الفوترة» وترفق الفاتورة النهائيّة.',
               'The request goes to Customs Finance; the transaction counts as invoiced only when Finance marks it invoiced.')}
          </p>
          <button type="button" onClick={onClose} className="px-4 py-2 text-slate-500 hover:text-slate-900 text-sm">{t('إلغاء', 'Cancel')}</button>
          <button type="button" onClick={save} disabled={busy || !!preview.missing.length || preview.empty}
            title={preview.missing.length ? t(`اكتب سعرَ: ${preview.missing.join('، ')}`, `Enter: ${preview.missing.join(', ')}`) : undefined}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#f37121] px-4 py-2 text-xs font-bold text-white disabled:opacity-40">
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Receipt className="h-3.5 w-3.5" />}
            {t('طلب الفوترة وإغلاق المعاملة', 'Request invoicing & close')}
          </button>
        </div>
      </div>
    </div>
  );
}
