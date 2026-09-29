'use client';
/**
 * بحثُ شخصٍ في نماذج قسم المركبات — يُكتب رقمٌ فتُملأ الخانات.
 *
 * ── لماذا بحثٌ لا قائمةُ اختيار ──────────────────────────────────────────────
 * كلُّ نموذجٍ في هذا القسم يسأل عن شخص: المالك، والمفوَّض، والقائدُ الفعليّ،
 * وسائقُ الحادث، وصاحبُ البطاقة. وقائمةٌ منسدلةٌ تعرض الناسَ كلَّهم في كلّ مرّة
 * ثقيلةٌ ولا تُقرأ — ومن يملأ النموذجَ يعرف من يقصد، في يده اسمُه أو رقمُه.
 *
 * فيُكتب ما في اليد (اسمًا أو هويّةً أو إقامة) فيُردُّ عليه، وتُملأ الخاناتُ من
 * الجواب. ومن لا يوجد يُقال فيه صراحةً أنّ الموارد البشريّة هي التي تسجّله —
 * لا يُترَك المستخدمُ يظنّ البحثَ معطَّلًا.
 *
 * والكتابةُ باليد تبقى كما هي: هذا زيادةٌ تُسرّع، لا بابٌ يُغلق غيرَه.
 */
import { useState, useCallback, useRef } from 'react';
import { Search, Loader2, UserCheck, X } from 'lucide-react';
import api from '@/lib/api';

export interface FoundPerson {
  idNumber?: string;
  name?: string;
  phone?: string;
  absherPhone?: string;
  employeeNumber?: string;
  jobTitleAr?: string;
  departmentAr?: string;
  employmentStatus?: string;
  hireDate?: string | null;
  dateOfBirth?: string;
  cardNumber?: string;
  cardExpiryDate?: string | null;
  transportTypeAr?: string;
  projectAr?: string;
  cityAr?: string;
  vehiclePlate?: string;
  employeeId?: string;
  sources?: string[];
}

const SOURCE_AR: Record<string, string> = {
  hr: 'الموارد البشرية', light_transport: 'النقل الخفيف', driver_card: 'بطاقة سائق',
};
const SOURCE_EN: Record<string, string> = {
  hr: 'HR', light_transport: 'Light transport', driver_card: 'Driver card',
};

export default function PersonLookup({ ar, onPick, label, hint }: {
  ar: boolean;
  /** يُستدعى بالشخص المختار — على الشاشة أن تملأ خاناتها منه. */
  onPick: (p: FoundPerson) => void;
  label?: string;
  hint?: string;
}) {
  const t = (a: string, e: string) => (ar ? a : e);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [people, setPeople] = useState<FoundPerson[] | null>(null);
  // آخرُ بحثٍ يفوز: الكتابةُ أسرعُ من الشبكة، وردُّ «مح» يصل بعد ردّ «محمد».
  const seq = useRef(0);

  const run = useCallback(async () => {
    const term = q.trim();
    if (term.length < 3) { setPeople(null); return; }
    const mine = ++seq.current;
    setBusy(true);
    try {
      const d = await api.get<{ people: FoundPerson[] }>(
        `/api/vehicle-registry/person-lookup?q=${encodeURIComponent(term)}`);
      if (seq.current === mine) setPeople(d.people || []);
    } catch { if (seq.current === mine) setPeople([]); }
    if (seq.current === mine) setBusy(false);
  }, [q]);

  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/70 p-2.5">
      <p className="text-[11.5px] font-bold text-slate-600 mb-1.5 flex items-center gap-1.5">
        <UserCheck className="w-3.5 h-3.5 text-[#f37121]" />
        {label || t('ابحث عن الشخص وتُملأ الخانات', 'Find the person and fill the fields')}
      </p>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute top-1/2 -translate-y-1/2 start-2.5" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); run(); } }}
            placeholder={t('الاسم أو رقم الهوية أو الإقامة…', 'Name, national ID or iqama…')}
            className="w-full ps-8 pe-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:border-[#f37121]" />
        </div>
        <button type="button" onClick={run} disabled={busy || q.trim().length < 3}
          className="px-3 py-2 rounded-lg bg-slate-900 text-white text-[12.5px] font-bold disabled:opacity-40">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : t('بحث', 'Search')}
        </button>
        {people && (
          <button type="button" onClick={() => { setPeople(null); setQ(''); }}
            className="px-2 py-2 rounded-lg text-slate-400 hover:text-slate-700" aria-label={t('إغلاق', 'Close')}>
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {hint && !people && <p className="mt-1 text-[11px] text-slate-400">{hint}</p>}

      {people && people.length === 0 && (
        <p className="mt-2 rounded-lg bg-amber-50 border border-amber-200 px-2.5 py-2 text-[11.5px] text-amber-800">
          {t('غير موجود في السجلات — كلّم الموارد البشرية لتسجيله، أو اكتب البيانات يدويًّا.',
             'Not found — ask HR to register him, or type the details by hand.')}
        </p>
      )}

      {!!people?.length && (
        <ul className="mt-2 space-y-1 max-h-56 overflow-y-auto">
          {people.map((p, i) => (
            <li key={`${p.idNumber || p.name}-${i}`}>
              <button type="button"
                onClick={() => { onPick(p); setPeople(null); setQ(''); }}
                className="w-full text-start rounded-lg border border-slate-200 bg-white px-2.5 py-2 hover:border-[#f37121] transition-colors">
                <span className="block text-[13px] font-bold text-slate-900">{p.name}</span>
                <span className="block text-[11px] text-slate-500 font-mono">
                  {[p.idNumber, p.phone || p.absherPhone, p.employeeNumber && `#${p.employeeNumber}`]
                    .filter(Boolean).join(' · ')}
                </span>
                <span className="mt-0.5 inline-flex flex-wrap gap-1">
                  {(p.sources || []).map((s) => (
                    <span key={s} className="px-1.5 py-[1px] rounded bg-slate-100 text-slate-500 text-[10px] font-semibold">
                      {ar ? SOURCE_AR[s] || s : SOURCE_EN[s] || s}
                    </span>
                  ))}
                  {p.employmentStatus === 'terminated' && (
                    <span className="px-1.5 py-[1px] rounded bg-red-100 text-red-700 text-[10px] font-bold">
                      {t('أُنهيت خدمته', 'Terminated')}
                    </span>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
