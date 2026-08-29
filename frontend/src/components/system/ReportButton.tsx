'use client';
// «تقرير» — the button that turns any profile page into a printed report.
//
// Dropped onto a vehicle, customer, employee, vendor or driver profile with the
// subject and the entity's id. It opens the PDF directly (the common case) and
// offers the report centre for anyone who wants to change the period first.
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLanguage } from '@/context/LanguageContext';
import { useDialog } from '@/components/system/DialogProvider';
import { FileBarChart, Loader2, ExternalLink } from 'lucide-react';
import { openReportPdf, defaultRange } from '@/lib/reports';

export default function ReportButton({
  subject, id, from, to, label, compact, onDark,
}: {
  subject: 'vehicle' | 'tire' | 'driver' | 'customer' | 'vendor' | 'employee' | 'section';
  /**
   * الزرّ موضوعٌ على خلفيةٍ داكنة (ترويسة الملفّ).
   * بلونه الافتراضيّ — نصٌّ رماديّ داكن على حدٍّ فاتح — يصير داكنًا على داكن
   * فلا يُقرأ، وهو مكتوبٌ فعلًا لكنّه غير مرئيّ.
   */
  onDark?: boolean;
  id: string;
  from?: string;
  to?: string;
  label?: string;
  compact?: boolean;
}) {
  const router = useRouter();
  const { lang } = useLanguage();
  const { notify } = useDialog();
  const ar = lang === 'ar';
  const [busy, setBusy] = useState(false);

  const range = { ...defaultRange(), ...(from ? { from } : {}), ...(to ? { to } : {}) };
  const open = async () => {
    if (!id) return;
    setBusy(true);
    try {
      await openReportPdf(subject, id, range.from, range.to, ar ? 'ar' : 'en');
    } catch (e: any) {
      notify(e?.message || (ar ? 'تعذّر إصدار التقرير' : 'Could not generate the report'), 'error');
    }
    setBusy(false);
  };

  const goToCentre = () =>
    router.push(`/system/reports?subject=${subject}&id=${encodeURIComponent(id)}&from=${range.from}&to=${range.to}`);

  if (compact) {
    return (
      <button
        type="button"
        onClick={open}
        disabled={busy || !id}
        title={ar ? 'تقرير PDF' : 'PDF report'}
        className="p-1.5 rounded-lg text-slate-500 hover:text-[#f37121] hover:bg-slate-100 disabled:opacity-50"
      >
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileBarChart className="w-4 h-4" />}
      </button>
    );
  }

  return (
    <span className={`inline-flex items-center rounded-lg overflow-hidden border ${onDark ? 'border-white/20 bg-white/10' : 'border-slate-200'}`}>
      <button
        type="button"
        onClick={open}
        disabled={busy || !id}
        className={`inline-flex items-center gap-1.5 text-sm px-3 py-1.5 disabled:opacity-50 ${
          onDark ? 'text-white hover:bg-white/15 font-medium' : 'text-slate-700 hover:bg-slate-50'}`}
      >
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileBarChart className="w-4 h-4 text-[#f37121]" />}
        {label || (ar ? 'تقرير PDF' : 'PDF report')}
      </button>
      <button
        type="button"
        onClick={goToCentre}
        title={ar ? 'فتح في مركز التقارير (لتغيير الفترة)' : 'Open in the report centre (to change the period)'}
        className={`px-2 py-1.5 border-s ${onDark ? 'text-white/60 hover:text-white hover:bg-white/15 border-white/20' : 'text-slate-400 hover:text-slate-700 hover:bg-slate-50 border-slate-200'}`}
      >
        <ExternalLink className="w-3.5 h-3.5" />
      </button>
    </span>
  );
}
