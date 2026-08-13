'use client';
import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  X, Award, TrendingUp, TrendingDown, Minus, CheckCircle2, AlertTriangle, MapPin,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import api from '@/lib/api';
import { getB2CTranslations } from '@/lib/translations';
import type { Lang } from '@/context/LanguageContext';

const MONTH_NAMES_AR = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
const MONTH_NAMES_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const performanceColor = (pct: number) => {
  if (pct >= 100) return '#10b981';
  if (pct >= 80) return '#f59e0b';
  return '#ef4444';
};

interface NoteEntry {
  code: string;
  meta?: Record<string, any>;
}

// Localize the strength/weakness codes coming from the backend.
const formatNote = (note: NoteEntry, lang: Lang): string => {
  const m = note.meta || {};
  const enMap: Record<string, string> = {
    EXCEPTIONAL_PERFORMANCE: `Exceptional performance — averaging ${m.value}% of target`,
    AVG_PERFORMANCE_HIGH: `Above target on average (${m.value}%)`,
    CONSISTENCY_VERY_HIGH: `Very consistent month-over-month (${m.value}%)`,
    CONSISTENCY_HIGH: `Consistent monthly output (${m.value}%)`,
    TREND_RISING: `Performance trending up over time`,
    ALWAYS_ABOVE_TARGET: `Above target every month (${m.count} of ${m.count})`,
    MOSTLY_ABOVE_TARGET: `Above target in ${m.hits} of ${m.total} months`,
    ATTENDANCE_EXCELLENT: `Excellent attendance (${m.value}% of expected days worked)`,
    DAILY_TARGET_HIT_RATE_HIGH: `Hits the daily target on ${m.value}% of working days`,
    PEAK_DAY_OUTSTANDING: `Outstanding peak day — ${m.value} orders (${m.multiple}× daily target)`,
    LONG_TENURE: `Long tenure — active across ${m.months} months`,

    AVG_PERFORMANCE_AT_RISK: `At-risk performance — only ${m.value}% of target on average`,
    AVG_PERFORMANCE_LOW: `Below target on average (${m.value}%)`,
    TREND_FALLING: `Performance trending down`,
    CONSISTENCY_LOW: `Inconsistent monthly output (${m.value}%)`,
    MULTIPLE_MONTHS_BELOW: `Below target in ${m.count} months`,
    MONTHS_AT_RISK: `${m.count} month(s) at-risk (<60%)`,
    ATTENDANCE_LOW: `Low attendance (${m.value}% of expected days)`,
    DAILY_TARGET_RARELY_HIT: `Rarely hits the daily target (${m.value}%)`,
    RECENT_MONTH_POOR: `Recent month was poor — ${m.value}%`,
    ZERO_OUTPUT_MONTH: `One month with zero output`,
    MANY_DAYS_OFF: `Many days off (${m.count} days didn't work)`,
    SOME_DAYS_OFF: `Several days off (${m.count} days didn't work)`,
  };
  const arMap: Record<string, string> = {
    EXCEPTIONAL_PERFORMANCE: `أداء استثنائي — متوسط ${m.value}% من الهدف`,
    AVG_PERFORMANCE_HIGH: `متوسط الأداء فوق الهدف (${m.value}%)`,
    CONSISTENCY_VERY_HIGH: `ثبات عالي جداً شهرياً (${m.value}%)`,
    CONSISTENCY_HIGH: `ثبات شهري ممتاز (${m.value}%)`,
    TREND_RISING: `الأداء في تحسن مع الوقت`,
    ALWAYS_ABOVE_TARGET: `فوق الهدف في كل الشهور (${m.count} من ${m.count})`,
    MOSTLY_ABOVE_TARGET: `فوق الهدف في ${m.hits} من ${m.total} شهور`,
    ATTENDANCE_EXCELLENT: `حضور ممتاز (${m.value}% من الأيام المتوقعة)`,
    DAILY_TARGET_HIT_RATE_HIGH: `يحقق الهدف اليومي في ${m.value}% من أيام العمل`,
    PEAK_DAY_OUTSTANDING: `يوم ذروة استثنائي — ${m.value} طلب (${m.multiple}× الهدف اليومي)`,
    LONG_TENURE: `خبرة طويلة — نشط على مدار ${m.months} شهور`,

    AVG_PERFORMANCE_AT_RISK: `أداء في خطر — فقط ${m.value}% من الهدف`,
    AVG_PERFORMANCE_LOW: `متوسط الأداء تحت الهدف (${m.value}%)`,
    TREND_FALLING: `الأداء في تراجع`,
    CONSISTENCY_LOW: `تذبذب في الأداء الشهري (${m.value}%)`,
    MULTIPLE_MONTHS_BELOW: `تحت الهدف في ${m.count} شهور`,
    MONTHS_AT_RISK: `${m.count} شهر/شهور في خطر (<60%)`,
    ATTENDANCE_LOW: `حضور منخفض (${m.value}% من المتوقع)`,
    DAILY_TARGET_RARELY_HIT: `نادراً ما يحقق الهدف اليومي (${m.value}%)`,
    RECENT_MONTH_POOR: `الشهر الأخير ضعيف — ${m.value}%`,
    ZERO_OUTPUT_MONTH: `شهر بدون أي إنتاج`,
    MANY_DAYS_OFF: `كثرة أيام التوقّف (${m.count} يوم بلا عمل)`,
    SOME_DAYS_OFF: `عدد أيام التوقّف (${m.count} يوم بلا عمل)`,
  };
  return (lang === 'ar' ? arMap[note.code] : enMap[note.code]) || note.code;
};

interface Props {
  repId: string | null;
  onClose: () => void;
  lang: Lang;
}

export default function B2CRepProfileModal({ repId, onClose, lang }: Props) {
  const T = getB2CTranslations(lang);
  const monthNames = lang === 'ar' ? MONTH_NAMES_AR : MONTH_NAMES_EN;

  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!repId) return;
    setLoading(true);
    setData(null);
    api.get<any>(`/api/b2c/reps/${repId}/profile`)
      .then((d) => setData(d))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [repId]);

  if (!repId) return null;

  return (
    <>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        onClick={onClose} className="fixed inset-0 bg-black/60 z-50" />
      <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
        className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="bg-white border border-slate-200 rounded-xl w-full max-w-4xl shadow-2xl max-h-[92vh] overflow-y-auto"
          onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between p-5 border-b border-slate-200 sticky top-0 bg-white z-10">
            <h2 className="bg-slate-900 px-3 py-2 rounded-lg text-white font-semibold text-lg flex items-center gap-2 mb-3">
              <Award className="w-5 h-5 text-[#f37121]" />
              {T.repProfile}
            </h2>
            <button type="button" onClick={onClose} className="text-slate-500 hover:text-slate-900" title="Close">
              <X className="w-5 h-5" />
            </button>
          </div>
          <div className="p-5">
            {loading ? (
              <div className="flex items-center justify-center h-48">
                <div className="w-8 h-8 border-2 border-[#f37121] border-t-transparent rounded-full animate-spin" />
              </div>
            ) : !data ? (
              <p className="text-slate-500 text-sm text-center py-8">{T.noData}</p>
            ) : (
              <ProfileBody data={data} lang={lang} T={T} monthNames={monthNames} />
            )}
          </div>
        </div>
      </motion.div>
    </>
  );
}

function ProfileBody({ data, lang, T, monthNames }: any) {
  const lifetime = data.lifetime || {};
  const strengths: NoteEntry[] = data.strengths || [];
  const weaknesses: NoteEntry[] = data.weaknesses || [];
  const months = data.months || [];

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <h3 className="bg-slate-900 px-3 py-2 rounded-lg text-white text-xl font-bold mb-3">{data.rep.englishName}</h3>
        <p className="text-slate-500 text-[11px] uppercase tracking-wide">
          {lang === 'ar' ? 'اسم المندوب الحالي على الحساب' : 'Current rep on this account'}
        </p>
        {data.rep.arabicName && (
          <p className="text-slate-500 text-sm mt-1">
            <span className="text-slate-500 text-xs">{lang === 'ar' ? 'اسم اليوزر: ' : 'Username: '}</span>
            {data.rep.arabicName}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-3 mt-2 text-xs">
          {data.rep.repId && (
            <span className="text-slate-500 font-mono" title={lang === 'ar' ? 'رقم الحساب' : 'Account ID'}>
              #{data.rep.repId}
            </span>
          )}
          {data.rep.project && (
            <span className="px-2 py-0.5 rounded"
              style={{ backgroundColor: `${data.rep.project.color || '#f37121'}20`, color: data.rep.project.color || '#f37121' }}>
              {data.rep.project.name}
            </span>
          )}
          {data.rep.branch && (
            <span className="text-slate-500 inline-flex items-center gap-1">
              <MapPin className="w-3 h-3" /> {data.rep.branch.name}
            </span>
          )}
          {data.rep.joiningDate && (
            <span className="text-slate-500">
              {lang === 'ar' ? 'انضم في' : 'Joined'} {new Date(data.rep.joiningDate).toLocaleDateString()}
            </span>
          )}
        </div>
      </div>

      {/* Top KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <ProfileKpi label={T.totalOrders} value={lifetime.totalOrders?.toLocaleString() || 0} />
        <ProfileKpi label={T.avgPerformance}
          value={`${lifetime.avgPerformancePercent?.toFixed(1) || 0}%`}
          color={performanceColor(lifetime.avgPerformancePercent || 0)} />
        <ProfileKpi label={T.consistency} value={`${lifetime.consistency?.toFixed(0) || 0}%`} />
        <ProfileKpi label={T.trend}
          value={
            <span className="inline-flex items-center justify-center gap-1">
              {lifetime.trend === 'rising' && <TrendingUp className="w-4 h-4 text-green-600" />}
              {lifetime.trend === 'falling' && <TrendingDown className="w-4 h-4 text-red-600" />}
              {lifetime.trend === 'stable' && <Minus className="w-4 h-4 text-slate-500" />}
              <span className="capitalize text-sm">{T[lifetime.trend] || lifetime.trend}</span>
            </span>
          } />
      </div>

      {/* Secondary KPIs — attendance + daily hit rate + off days */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <ProfileKpi label={lang === 'ar' ? '✅ أيام اشتغل' : '✅ Worked Days'}
          value={`${lifetime.actualWorkingDays || 0} / ${lifetime.expectedTotalDays || 0}`} />
        <ProfileKpi label={lang === 'ar' ? '🛌 أيام بلا عمل' : "🛌 Days Off"}
          value={lifetime.daysNotWorked || 0}
          color={(lifetime.daysNotWorked || 0) > 5 ? '#ef4444' : undefined} />
        <ProfileKpi label={lang === 'ar' ? 'نسبة الحضور' : 'Attendance'}
          value={`${(lifetime.attendanceRate || 0).toFixed(0)}%`} />
        <ProfileKpi label={lang === 'ar' ? 'تحقيق الهدف اليومي' : 'Daily Target Hit Rate'}
          value={`${(lifetime.dailyHitRate || 0).toFixed(0)}%`} />
      </div>

      {/* Best / Worst month */}
      {lifetime.bestMonth && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-3">
            <p className="text-green-600 text-xs uppercase font-medium mb-1">⭐ {T.bestMonth}</p>
            <p className="text-slate-900 font-bold">{monthNames[lifetime.bestMonth.month - 1]} {lifetime.bestMonth.year}</p>
            <p className="text-slate-700 text-sm mt-0.5">{lifetime.bestMonth.totalOrders.toLocaleString()} {T.totalOrders.toLowerCase()}</p>
          </div>
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3">
            <p className="text-red-600 text-xs uppercase font-medium mb-1">⚠️ {T.worstMonth}</p>
            <p className="text-slate-900 font-bold">{monthNames[lifetime.worstMonth.month - 1]} {lifetime.worstMonth.year}</p>
            <p className="text-slate-700 text-sm mt-0.5">{lifetime.worstMonth.totalOrders.toLocaleString()} {T.totalOrders.toLowerCase()}</p>
          </div>
        </div>
      )}

      {/* Strengths + Weaknesses */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="bg-green-500/5 border border-green-500/20 rounded-xl p-4">
          <h4 className="text-green-600 font-semibold text-sm flex items-center gap-2 mb-3">
            <CheckCircle2 className="w-4 h-4" />
            {lang === 'ar' ? '✅ نقاط القوة' : '✅ Strengths'}
          </h4>
          <ul className="space-y-2">
            {strengths.length === 0 ? (
              <li className="text-slate-500 text-xs">
                {lang === 'ar' ? 'لا يوجد نقاط قوة بارزة بعد — يحتاج بيانات أكثر' : 'No standout strengths yet — needs more data'}
              </li>
            ) : strengths.map((s, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-slate-800">
                <span className="text-green-600 mt-0.5">✓</span>
                <span>{formatNote(s, lang)}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="bg-red-500/5 border border-red-500/20 rounded-xl p-4">
          <h4 className="text-red-600 font-semibold text-sm flex items-center gap-2 mb-3">
            <AlertTriangle className="w-4 h-4" />
            {lang === 'ar' ? '⚠️ نقاط للتحسين' : '⚠️ Areas to Improve'}
          </h4>
          <ul className="space-y-2">
            {weaknesses.length === 0 ? (
              <li className="text-green-600 text-xs">
                {lang === 'ar' ? '🎉 لا توجد ملاحظات سلبية' : '🎉 No concerns flagged'}
              </li>
            ) : weaknesses.map((w, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-slate-800">
                <span className="text-red-600 mt-0.5">!</span>
                <span>{formatNote(w, lang)}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Monthly trend chart */}
      {months.length > 0 && (
        <div className="bg-slate-100 rounded-lg p-3">
          <h4 className="text-slate-900 text-sm font-semibold mb-2">{T.monthHistory}</h4>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={months.map((m: any) => ({ ...m, label: `${monthNames[m.month - 1].slice(0, 3)} ${m.year}` }))}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis dataKey="label" stroke="#9ca3af" fontSize={10} />
              <YAxis stroke="#9ca3af" fontSize={11} />
              <Tooltip contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: 8 }} />
              <Bar dataKey="totalOrders" name={T.totalOrders} fill="#f37121" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Months table */}
      <div className="bg-slate-100 rounded-lg overflow-x-auto">
        <table className="w-full min-w-[700px]">
          <thead>
            <tr className="bg-slate-900 text-slate-300 text-xs uppercase">
              <th className="text-start py-2 px-3">{lang === 'ar' ? 'الشهر' : 'Month'}</th>
              <th className="text-center py-2 px-3">{T.totalOrders}</th>
              <th className="text-center py-2 px-3" title={lang === 'ar' ? 'أيام اشتغل فيها' : 'Days worked'}>
                {lang === 'ar' ? '✅ اشتغل' : '✅ Worked'}
              </th>
              <th className="text-center py-2 px-3" title={lang === 'ar' ? 'أيام بلا عمل (القيمة صفر)' : "Days off (cell = 0)"}>
                {lang === 'ar' ? '🛌 بلا عمل' : '🛌 Off'}
              </th>
              <th className="text-center py-2 px-3">{T.avgDailyRate}</th>
              <th className="text-center py-2 px-3">{T.performance}</th>
              <th className="text-center py-2 px-3">{T.shortOfTarget}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {months.map((m: any) => (
              <tr key={m.key}>
                <td className="py-2 px-3 text-slate-900 text-sm font-medium">{monthNames[m.month - 1]} {m.year}</td>
                <td className="py-2 px-3 text-center text-slate-900">{m.totalOrders}</td>
                <td className="py-2 px-3 text-center text-green-700">{m.workingDays}</td>
                <td className="py-2 px-3 text-center">
                  <span className={(m.daysOff ?? 0) > 0 ? 'text-amber-700' : 'text-slate-700'}>
                    {m.daysOff ?? 0}
                  </span>
                </td>
                <td className="py-2 px-3 text-center text-slate-700">{m.dailyRate.toFixed(1)}</td>
                <td className="py-2 px-3 text-center">
                  <span className="font-bold" style={{ color: performanceColor(m.performancePercent) }}>
                    {m.performancePercent.toFixed(1)}%
                  </span>
                </td>
                <td className="py-2 px-3 text-center">
                  <span className={m.shortOfTarget >= 0 ? 'text-green-600' : 'text-red-600'}>
                    {m.shortOfTarget >= 0 ? '+' : ''}{m.shortOfTarget}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ProfileKpi({ label, value, color }: { label: string; value: any; color?: string }) {
  return (
    <div className="bg-slate-100 rounded-lg p-3 text-center">
      <p className="text-slate-500 text-xs uppercase">{label}</p>
      <p className="text-slate-900 font-bold text-xl mt-1" style={color ? { color } : undefined}>{value}</p>
    </div>
  );
}
