'use client';
// سجلُّ سيّارةٍ واحدة — صفحةٌ قائمةٌ بذاتها.
//
// كان الضغطُ على صفٍّ في «سجلّات السيارات» يفتح السجلَّ **تحت** جدولٍ من ثمانٍ
// وخمسين سيّارة، فيتغيّر الرابطُ ولا يظهر شيءٌ في الشاشة — والمستخدم ينتظر
// صفحةً تُفتح. فصار للسيّارة صفحتُها: رابطٌ يُرسَل، وسهمُ رجوعٍ يعود، وفلترُ
// فترةٍ يبقى في الرابط.
import { useState, Suspense } from 'react';
import { useParams, useSearchParams, useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { canEditFleet } from '@/lib/fleet';
import { syncUrl } from '@/lib/urlSync';
import VehicleMonthLog, { thisMonth } from '@/components/fleet/VehicleMonthLog';
import { Spinner, PageHeader } from '@/components/hr/HRKit';
import { ClipboardList, ArrowLeft, ArrowRight, ChevronLeft, ChevronRight } from 'lucide-react';

const p2 = (n: number) => String(n).padStart(2, '0');
const shiftMonth = (mk: string, by: number) => {
  const [y, m] = mk.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}`;
};

function Inner() {
  const params = useParams();
  const sp = useSearchParams();
  const router = useRouter();
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const t = (a: string, e: string) => (ar ? a : e);
  const canEdit = canEditFleet(user);

  const plate = decodeURIComponent(String((params as any)?.plate || ''));
  const [mode, setMode] = useState<'month' | 'range' | 'day'>((sp?.get('mode') as any) || 'month');
  const [month, setMonth] = useState(sp?.get('month') || thisMonth());
  const [from, setFrom] = useState(sp?.get('from') || '');
  const [to, setTo] = useState(sp?.get('to') || '');
  const [day, setDay] = useState(sp?.get('date') || '');

  const sync = (next: Partial<{ mode: string; month: string; from: string; to: string; date: string }>) => {
    const q = new URLSearchParams();
    const m = next.mode ?? mode;
    q.set('mode', m);
    if (m === 'day') q.set('date', next.date ?? day);
    else if (m === 'range') { const f = next.from ?? from; const tt = next.to ?? to; if (f) q.set('from', f); if (tt) q.set('to', tt); }
    else q.set('month', next.month ?? month);
    syncUrl(`/system/fleet/vehicle-logs/${encodeURIComponent(plate)}`, q);
  };

  const Back = isRTL ? ArrowRight : ArrowLeft;

  return (
    <div className="space-y-6">
      <button type="button" onClick={() => router.push('/system/fleet/vehicle-logs')}
        className="inline-flex items-center gap-1.5 text-sm text-slate-600 hover:text-[#f37121] font-medium">
        <Back className="w-4 h-4" /> {t('كل السيارات', 'All vehicles')}
      </button>

      <PageHeader
        icon={<ClipboardList className="w-6 h-6 text-[#f37121]" />}
        title={`${t('سجلّ السيّارة', 'Vehicle log')} · ${plate}`}
        subtitle={t('كلُّ ما جرى لهذه السيّارة في الفترة — يُقفل السجلّ الشهريّ مع أوّل الشهر التالي', 'Everything that happened to this vehicle in the period — the monthly log closes on the 1st of the next month')}
      />

      <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          {(['month', 'range', 'day'] as const).map((m) => (
            <button key={m} type="button" onClick={() => { setMode(m); sync({ mode: m }); }}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${mode === m ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
              {m === 'month' ? t('شهر', 'Month') : m === 'range' ? t('من — إلى', 'From — To') : t('يوم بعينه', 'A single day')}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-end gap-3">
          {mode === 'month' && (
            <div className="flex items-center gap-1">
              <button type="button" onClick={() => { const v = shiftMonth(month, -1); setMonth(v); sync({ month: v }); }}
                className="p-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600" aria-label="prev">
                {ar ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
              </button>
              <input type="month" value={month} onChange={(e) => { setMonth(e.target.value); sync({ month: e.target.value }); }}
                className="px-3 py-2 rounded-lg bg-white border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50 [color-scheme:light]" />
              <button type="button" onClick={() => { const v = shiftMonth(month, 1); setMonth(v); sync({ month: v }); }}
                className="p-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600" aria-label="next">
                {ar ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
              </button>
            </div>
          )}
          {mode === 'range' && (
            <>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">{t('من', 'From')}</label>
                <input type="date" value={from} onChange={(e) => { setFrom(e.target.value); sync({ from: e.target.value }); }}
                  className="px-3 py-2 rounded-lg bg-white border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50 [color-scheme:light]" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">{t('إلى', 'To')}</label>
                <input type="date" value={to} onChange={(e) => { setTo(e.target.value); sync({ to: e.target.value }); }}
                  className="px-3 py-2 rounded-lg bg-white border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50 [color-scheme:light]" />
              </div>
            </>
          )}
          {mode === 'day' && (
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">{t('اليوم', 'Day')}</label>
              <input type="date" value={day} onChange={(e) => { setDay(e.target.value); sync({ date: e.target.value }); }}
                className="px-3 py-2 rounded-lg bg-white border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50 [color-scheme:light]" />
            </div>
          )}
        </div>
      </div>

      <VehicleMonthLog
        vehicle={plate}
        month={mode === 'month' ? month : undefined}
        from={mode === 'range' ? from : undefined}
        to={mode === 'range' ? to : undefined}
        date={mode === 'day' ? day : undefined}
        canEdit={canEdit}
      />
    </div>
  );
}

export default function VehicleLogPage() {
  return <Suspense fallback={<Spinner />}><Inner /></Suspense>;
}
