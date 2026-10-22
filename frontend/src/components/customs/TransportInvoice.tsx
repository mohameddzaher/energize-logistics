'use client';
/**
 * «بانتظار فاتورة النقل» — الشريطُ الأحمر على معاملةٍ فُوترت ولم تُنهَ.
 *
 * الفاتورةُ تصدر بلا انتظار فاتورة النقل (تتأخّر عند الناقل أسابيع)، وتذهب إلى
 * الإدارة الماليّة كأيّ فاتورة. والثمنُ ألّا يُنسى ما تأخّر: فيبقى هذا الشريطُ
 * أحمرَ في رأس المعاملة حتى تُرفَق فاتورةُ النقل — فتُنهى المعاملةُ عندها في
 * الحال — أو يُقال صراحةً إنّها لا تُنتظَر (نُقلت بسيّارات الشركة).
 */
import { useRef, useState } from 'react';
import api from '@/lib/api';
import { useDialog } from '@/components/system/DialogProvider';
import { AlertTriangle, Loader2, Paperclip } from 'lucide-react';

export default function TransportInvoiceBanner({
  clearanceId, invoiceNumber, canEdit, ar, onChanged,
}: {
  clearanceId: string; invoiceNumber: string; canEdit: boolean; ar: boolean;
  onChanged: (clearance: any) => void;
}) {
  const { notify, confirm } = useDialog();
  const t = (a: string, e: string) => (ar ? a : e);
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const send = async (body: any) => {
    setBusy(true);
    try {
      const d = await api.post<any>(`/api/customs-clearance/${clearanceId}/transport-invoice`, body);
      onChanged(d.clearance);
      notify(d.closed ? t('أُرفقت فاتورةُ النقل وأُنهيت المعاملة', 'Transport invoice attached — transaction closed')
        : t('حُفظت فاتورةُ النقل', 'Transport invoice saved'), 'success');
    } catch (e: any) { notify(e?.message || t('تعذّر الحفظ', 'Failed'), 'error'); }
    setBusy(false);
  };

  const pick = (f: File | null) => {
    if (!f) return;
    if (f.size > 20 * 1024 * 1024) { notify(t('الملفّ أكبر من ٢٠ ميغابايت', 'File larger than 20MB'), 'error'); return; }
    const r = new FileReader();
    r.onload = () => send({ dataUrl: String(r.result), fileName: f.name, date: new Date().toISOString().slice(0, 10) });
    r.readAsDataURL(f);
    if (ref.current) ref.current.value = '';
  };

  const notRequired = async () => {
    if (!(await confirm({
      title: t('لا فاتورةَ نقلٍ لهذه المعاملة؟', 'No transport invoice for this transaction?'),
      message: t('يُقال هذا حين تُنقَل الشحنةُ بسيّارات الشركة فلا فاتورةَ ناقلٍ تُنتظَر. ستُنهى المعاملةُ في الحال.',
                 'Use this when the cargo moved on company trucks, so no carrier invoice is expected. The transaction closes at once.'),
      confirmLabel: t('نعم، أنهِ المعاملة', 'Yes, close it'),
    }))) return;
    send({ notRequired: true });
  };

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-red-300 bg-red-50 px-4 py-3">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-red-600 text-white"><AlertTriangle className="h-4 w-4" /></span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold text-red-800">
          {invoiceNumber ? <>{t('فُوترت', 'Invoiced')} <bdi>{invoiceNumber}</bdi></> : t('أُرسل طلبُ الفوترة', 'Invoice request sent')} — {t('بانتظار فاتورة النقل', 'awaiting the transport invoice')}
        </p>
        <p className="text-[12px] text-red-700/80">
          {t('الطلبُ عند الإدارة الماليّة، والمعاملةُ تبقى مفتوحةً حتى تُرفَق فاتورةُ النقل — فتُغلَق عندها.',
             'Finance has the invoice. The transaction stays open until the transport invoice is attached — then it closes.')}
        </p>
      </div>
      {canEdit && (
        <div className="flex flex-wrap items-center gap-2">
          <input ref={ref} type="file" hidden accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx" onChange={(e) => pick(e.target.files?.[0] || null)} />
          <button type="button" disabled={busy} onClick={() => ref.current?.click()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-2 text-xs font-bold text-white hover:bg-red-700 disabled:opacity-60">
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Paperclip className="h-3.5 w-3.5" />}
            {t('إرفاق فاتورة النقل وإنهاء المعاملة', 'Attach transport invoice & close')}
          </button>
          <button type="button" disabled={busy} onClick={notRequired}
            className="rounded-lg bg-white px-3 py-2 text-xs font-semibold text-red-700 ring-1 ring-red-200 hover:bg-red-100 disabled:opacity-60">
            {t('لا فاتورةَ نقلٍ لهذه المعاملة', 'No transport invoice')}
          </button>
        </div>
      )}
    </div>
  );
}
