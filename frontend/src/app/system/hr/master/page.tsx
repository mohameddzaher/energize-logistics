'use client';
// نظرة الموارد البشرية الشاملة — كارت لكل عمود، وقايمة شغل مش أرقام.
//
// كل رقم «مطلوب» معناه بيانات ناقصة لازم التيم يجمّعها، والضغط عليه بيفتح
// الناس اللي وراه عشان يتملي من هناك على طول. و«غير مطلوب» متعدّة لوحدها —
// سعودي مالوش إقامة مش «ناقص إقامة»، وحطّه في قايمة الشغل بيضيّع وقت الناس.
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import { useDialog } from '@/components/system/DialogProvider';
import { Spinner, PageHeader } from '@/components/hr/HRKit';
import {
  Users, CalendarClock, ChevronLeft, TriangleAlert, ClipboardList, Search,
} from 'lucide-react';
import {
  getHrOverview, STATUS_META, STATE_META, statusLabel, stateLabel,
  type HrOverview, type GroupCard, type FieldCard,
} from '@/lib/hrMaster';

export default function HrMasterPage() {
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const t = (a: string, e: string) => (ar ? a : e);
  const router = useRouter();
  const { notify } = useDialog();

  const [d, setD] = useState<HrOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [onlyActive, setOnlyActive] = useState(true);

  const load = useCallback(async () => {
    try { setD(await getHrOverview(onlyActive ? { status: 'active' } : {})); }
    catch (e: any) { notify(e?.message || 'Failed', 'error'); }
    setLoading(false);
  }, [onlyActive, notify]);
  useEffect(() => { load(); }, [load]);
  useSocket('hr:master', useCallback(() => { load(); }, [load]));

  /** يفتح صفحة المجموعة مفلترة على الحاجة اللي المستخدم دوس عليها بالظبط. */
  const open = (group: string, q: Record<string, string> = {}) => {
    const p = new URLSearchParams(q).toString();
    router.push(`/system/hr/master/${group}${p ? `?${p}` : ''}`);
  };

  if (loading) return <Spinner />;
  if (!d) return <div className="text-slate-500 p-8">{t('تعذّر التحميل', 'Could not load')}</div>;

  return (
    <div className="space-y-5 w-full pb-10" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader
        icon={<Users className="w-5 h-5" />}
        title={t('نظرة الموارد البشرية الشاملة', 'HR Overview')}
        subtitle={t('كل عمود له كارت — اضغط أي رقم لتفتح الناس اللي وراه وتملّي بياناتهم',
                    'A card per column — click any number to open the people behind it and fill their data')}
      >
        <div className="flex items-center gap-2">
          <label className="inline-flex items-center gap-1.5 text-sm text-slate-600 cursor-pointer">
            <input type="checkbox" checked={onlyActive} onChange={(e) => setOnlyActive(e.target.checked)} className="accent-[#f37121]" />
            {t('على رأس العمل فقط', 'Active only')}
          </label>
          <button onClick={() => router.push('/system/hr/master/expiring')}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#f37121] hover:bg-[#e5651a] text-white text-sm">
            <CalendarClock className="w-4 h-4" /> {t('الانتهاءات', 'Expiries')}
          </button>
        </div>
      </PageHeader>

      {/* الأرقام الكبيرة */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-2.5">
        <Big label={t('الموظفون', 'Employees')} value={d.totals.employees} c="#f37121" />
        <Big label={t('على رأس العمل', 'Active')} value={d.totals.active} c="#16a34a" />
        <Big label={t('بيانات مطلوبة', 'Required fields')} value={d.totals.required} c="#dc2626" />
        <Big label={t('ينتهي قريبًا', 'Expiring soon')} value={d.totals.expiringSoon} c="#ea580c"
          onClick={() => router.push('/system/hr/master/expiring')} />
        <Big label={t('مسجّل بالتأمينات', 'GOSI registered')} value={d.totals.gosiRegistered} c="#0ea5e9" />
        <Big label={t('راتب نقدي', 'Cash payroll')} value={d.totals.cashPayroll} c="#8b5cf6" />
        <Big label={t('خارج المملكة', 'Outside kingdom')} value={d.totals.outsideKingdom} c="#64748b" />
        <Big label={t('عمل حر', 'Freelancers')} value={d.totals.freelancers} c="#0f172a" />
      </div>

      {/* ابدأ من هنا — أكتر البيانات نقصًا */}
      {!!d.topRequired.length && (
        <section className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
          <div className="flex items-center gap-2 mb-3">
            <ClipboardList className="w-4 h-4 text-red-600" />
            <h2 className="text-sm font-bold text-slate-800">{t('ابدأ من هنا — أكتر البيانات نقصًا', 'Start here — most missing')}</h2>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
            {d.topRequired.map((f) => (
              <button key={`${f.groupKey}.${f.key}`}
                onClick={() => open(f.groupKey, { field: f.key, status: 'required' })}
                className="text-start rounded-lg border border-red-100 bg-red-50/50 hover:border-red-300 px-3 py-2 transition-colors">
                <p className="text-xl font-extrabold text-red-600 leading-none">{f.required}</p>
                <p className="text-[11px] text-slate-700 mt-1 leading-tight">{ar ? f.ar : f.en}</p>
                <p className="text-[10px] text-slate-400">{f.groupAr}</p>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* المستندات ذات التاريخ */}
      <section className="space-y-2">
        <h2 className="text-sm font-bold text-slate-800">{t('المستندات ومواعيد انتهائها', 'Documents and their expiry')}</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {d.groups.filter((g) => g.document).map((g) => (
            <DocGroupCard key={g.key} g={g} ar={ar} t={t} onOpen={open} />
          ))}
        </div>
      </section>

      {/* كل مجموعة وكل حقل جواها */}
      <section className="space-y-2">
        <h2 className="text-sm font-bold text-slate-800">{t('كل عمود بالتفصيل', 'Every column in detail')}</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {d.groups.map((g) => <GroupBlock key={g.key} g={g} ar={ar} t={t} onOpen={open} />)}
        </div>
      </section>
    </div>
  );
}

function Big({ label, value, c, onClick }: { label: string; value: any; c: string; onClick?: () => void }) {
  const inner = (
    <div className="bg-white border border-slate-200 rounded-xl p-3 shadow-sm h-full">
      <p className="text-xl font-extrabold leading-none" style={{ color: c }}>{value}</p>
      <p className="text-[10.5px] text-slate-500 mt-1.5 leading-tight">{label}</p>
    </div>
  );
  return onClick ? <button onClick={onClick} className="text-start hover:opacity-90">{inner}</button> : <div>{inner}</div>;
}

// كارت مستند: حالات التاريخ فوق، وحالة الحقول تحت.
function DocGroupCard({ g, ar, t, onOpen }: { g: GroupCard; ar: boolean; t: any; onOpen: any }) {
  const s = g.states!;
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
      <div className="flex items-center justify-between gap-2 mb-3">
        <button onClick={() => onOpen(g.key)} className="font-bold text-slate-900 text-sm hover:text-[#f37121]">
          {ar ? g.ar : g.en}
        </button>
        {!!g.needsAttention && (
          <button onClick={() => onOpen(g.key, { state: 'expired' })}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-50 text-red-600 text-[11px] font-bold">
            <TriangleAlert className="w-3 h-3" />{g.needsAttention}
          </button>
        )}
      </div>
      <div className="grid grid-cols-4 gap-1.5">
        {(['expired', 'critical', 'warning', 'valid'] as const).map((k) => (
          <button key={k} onClick={() => onOpen(g.key, { state: k })}
            className="rounded-lg border border-slate-100 py-2 hover:border-slate-300 transition-colors">
            <p className="text-lg font-extrabold leading-none" style={{ color: STATE_META[k].color }}>{s[k]}</p>
            <p className="text-[9.5px] text-slate-500 mt-1 leading-tight px-0.5">{stateLabel(k, ar)}</p>
          </button>
        ))}
      </div>
      <div className="mt-2 flex items-center justify-between text-[11px] text-slate-400">
        <button onClick={() => onOpen(g.key, { state: 'not_applicable' })} className="hover:text-slate-700">
          {t('لا ينطبق', 'N/A')}: {s.not_applicable}
        </button>
        <button onClick={() => onOpen(g.key, { state: 'missing' })} className="hover:text-slate-700">
          {t('بدون تاريخ', 'No date')}: {s.missing}
        </button>
      </div>
    </div>
  );
}

// كارت مجموعة: كل حقل بعدّاداته الأربعة.
function GroupBlock({ g, ar, t, onOpen }: { g: GroupCard; ar: boolean; t: any; onOpen: any }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
      <div className="flex items-center justify-between gap-2 mb-2.5">
        <button onClick={() => onOpen(g.key)} className="font-bold text-slate-900 text-sm hover:text-[#f37121] inline-flex items-center gap-1">
          {ar ? g.ar : g.en}
          <ChevronLeft className="w-3.5 h-3.5 text-slate-300 rtl:rotate-0 ltr:rotate-180" />
        </button>
        {g.required > 0 && (
          <button onClick={() => onOpen(g.key, { status: 'required' })}
            className="px-2 py-0.5 rounded-full bg-red-50 text-red-600 text-[11px] font-bold">
            {g.required} {t('مطلوب', 'required')}
          </button>
        )}
      </div>

      <div className="space-y-1.5">
        {g.fields.map((f) => <FieldRow key={f.key} f={f} g={g} ar={ar} t={t} onOpen={onOpen} />)}
      </div>
    </div>
  );
}

function FieldRow({ f, g, ar, t, onOpen }: { f: FieldCard; g: GroupCard; ar: boolean; t: any; onOpen: any }) {
  const [open, setOpen] = useState(false);
  const c = f.counts;
  const chip = (code: string, n: number) => n > 0 && (
    <button key={code} onClick={() => onOpen(g.key, { field: f.key, status: code })}
      className={`px-1.5 py-0.5 rounded text-[10.5px] font-semibold ${STATUS_META[code]?.bg || 'bg-slate-100 text-slate-600'} hover:opacity-80`}>
      {statusLabel(code, ar)} {n}
    </button>
  );

  return (
    <div className="border-b border-slate-50 last:border-0 pb-1.5 last:pb-0">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12px] text-slate-700 truncate">{ar ? f.ar : f.en}</span>
        <div className="flex items-center gap-1 shrink-0">
          {chip('required', c.required)}
          {chip('not_required', c.not_required)}
          {chip('cash_payroll', c.cash_payroll)}
          {chip('filled', c.filled)}
          {chip('none', c.none)}
        </div>
      </div>
      {/* الحقول اللي ليها قيم متكرّرة (القسم، الجنسية…) بتتفتح بتوزيعها */}
      {!!f.values?.length && (
        <>
          <button onClick={() => setOpen((v) => !v)} className="text-[10px] text-slate-400 hover:text-slate-700 mt-0.5">
            {open ? t('إخفاء التوزيع', 'Hide breakdown') : t(`التوزيع (${f.values.length})`, `Breakdown (${f.values.length})`)}
          </button>
          {open && (
            <div className="mt-1 space-y-0.5 ps-2 border-s-2 border-slate-100">
              {f.values.slice(0, 20).map((v) => (
                <button key={v.value} onClick={() => onOpen(g.key, { [f.key]: v.value })}
                  className="w-full flex items-center justify-between gap-2 text-[11px] text-slate-500 hover:text-slate-900">
                  <span className="truncate">{v.value}</span>
                  <b className="text-slate-700 tabular-nums">{v.count}</b>
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
