'use client';
/**
 * المساعد — سؤالٌ عن أيّ شيءٍ في النظام.
 *
 * ── ما كان قبل ─────────────────────────────────────────────────────────────
 * صندوقُ نصٍّ يُطابِق عباراتٍ إنجليزيّةً مكتوبةً في الخادم («top collector»)
 * ويردّ من جداولَ ماليّةٍ أكثرُها زال — فيُجيب بلا شيء، وهي إجابةٌ أسوأُ من
 * «لا أعرف»: تُقرأ «لا متأخّرات». وكان يعرف ثلاثةَ جداولَ والنظامُ سبعةٌ
 * وعشرون قسمًا.
 *
 * ── وما هو الآن ────────────────────────────────────────────────────────────
 * طريقان إلى الجواب، لأنّ السائلين صنفان:
 *   • مَن يعرف ما يريد يكتبه — لوحةً أو اسمًا أو رقمَ بوليصةٍ أو إقامة — فيُقال
 *     له من أيّ نوعٍ هو ويُفتَح جوابُه.
 *   • ومَن لا يعرف أين يسأل — وهو الغالب — يُمشى به: أيُّ قسم؟ ثمّ عمّ تسأل؟
 *     ثمّ أيُّ واحد؟
 *
 * والجوابُ وثيقةُ مركز التقارير نفسُها (`ReportView`) لا صياغةٌ ثانية: ما يُقرأ
 * هنا هو ما يخرج من الطابعة ومن الهاتف حرفًا بحرف. ولا يعرف المساعدُ شيئًا من
 * عنده — مواضيعُه وصلاحيّاتُه وجوابُه كلُّها من هناك، فما يُضاف هناك يصل هنا
 * بلا سطرٍ واحد.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useLanguage } from '@/context/LanguageContext';
import api from '@/lib/api';
import { PageHeader } from '@/components/hr/HRKit';
import ReportView, { type ReportDoc } from '@/components/system/ReportView';
import {
  Sparkles, Search, ArrowRight, Loader2, FileText, Truck, User, Building2,
  Store, Badge as BadgeIcon, Layers, Calendar, Circle, ChevronLeft,
} from 'lucide-react';

type Topic = { key: string; ar: string; en: string; icon: string; searchable: boolean };
type Section = { key: string; label: string; topics: Topic[] };
type Option = { id: string; name: string; detail?: string };
type Group = { topic: string; ar: string; en: string; icon: string; items: Option[]; total: number };
type Answer = {
  topic: string; title: string; subtitle: string;
  highlights: { label: string; value: string }[];
  doc: ReportDoc; reportPath: string;
};

const ICONS: Record<string, any> = {
  truck: Truck, user: User, building: Building2, store: Store,
  badge: BadgeIcon, layers: Layers, calendar: Calendar, circle: Circle, file: FileText,
};
const Icon = ({ name, className }: { name: string; className?: string }) => {
  const C = ICONS[name] || FileText;
  return <C className={className} />;
};

export default function AssistantPage() {
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const t = (a: string, e: string) => (ar ? a : e);
  const router = useRouter();

  const [sections, setSections] = useState<Section[]>([]);
  const [periods, setPeriods] = useState<{ key: string; ar: string; en: string }[]>([]);
  const [period, setPeriod] = useState('last_12m');

  // الخطواتُ الثلاث: قسمٌ ثمّ موضوعٌ ثمّ واحدٌ منه.
  const [section, setSection] = useState<Section | null>(null);
  const [topic, setTopic] = useState<Topic | null>(null);
  const [options, setOptions] = useState<Option[]>([]);
  const [optQ, setOptQ] = useState('');
  const [optBusy, setOptBusy] = useState(false);

  // البحثُ الحرّ — الطريقُ الآخرُ إلى الجواب نفسِه.
  const [q, setQ] = useState('');
  const [groups, setGroups] = useState<Group[]>([]);
  const [searching, setSearching] = useState(false);

  const [answer, setAnswer] = useState<Answer | null>(null);
  // ما سُئل عنه آخرًا — تغييرُ الفترة يُعيد السؤالَ نفسَه بفترةٍ أخرى، فلا بدّ
  // من معرّفه: الجوابُ لا يحمله، والسؤالُ بلا معرّفٍ يُردّ ٤٠٠.
  const [asked, setAsked] = useState<{ topic: string; id: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get<{ sections: Section[]; periods: any[] }>(`/api/assistant/sections?lang=${ar ? 'ar' : 'en'}`)
      .then((d) => { setSections(d.sections || []); setPeriods(d.periods || []); })
      .catch((e) => setError(e?.message || 'Request failed'));
  }, [ar]);

  // ── والبحثُ يُرسَل بعد سكونِ الكتابة ───────────────────────────────────────
  // طلبٌ لكلّ حرفٍ يسأل ثمانيةَ سجلّاتٍ في وقتٍ واحد، والحارسُ يمنع ردًّا قديمًا
  // أن يكتب فوق أحدث منه.
  const seq = useRef(0);
  useEffect(() => {
    if (q.trim().length < 2) { setGroups([]); return undefined; }
    const mine = ++seq.current;
    setSearching(true);
    const timer = setTimeout(() => {
      api.get<{ groups: Group[] }>(`/api/assistant/search?q=${encodeURIComponent(q.trim())}`)
        .then((d) => { if (seq.current === mine) setGroups(d.groups || []); })
        .catch(() => { if (seq.current === mine) setGroups([]); })
        .finally(() => { if (seq.current === mine) setSearching(false); });
    }, 300);
    return () => clearTimeout(timer);
  }, [q]);

  const loadOptions = useCallback(async (tp: Topic, search = '') => {
    setOptBusy(true);
    try {
      const d = await api.get<{ items: Option[] }>(
        `/api/assistant/topics/${tp.key}/options${search ? `?q=${encodeURIComponent(search)}` : ''}`);
      setOptions(d.items || []);
    } catch { setOptions([]); }
    setOptBusy(false);
  }, []);

  const ask = async (topicKey: string, id: string, forPeriod = period) => {
    setLoading(true); setError('');
    setAsked({ topic: topicKey, id });
    try {
      const d = await api.get<Answer>(
        `/api/assistant/topics/${topicKey}/${encodeURIComponent(id)}?period=${forPeriod}&lang=${ar ? 'ar' : 'en'}`);
      setAnswer(d);
    } catch (e: any) { setError(e?.message || 'Request failed'); setAnswer(null); }
    setLoading(false);
  };

  const reset = () => { setSection(null); setTopic(null); setOptions([]); setOptQ(''); setAnswer(null); setAsked(null); setError(''); };

  const chip = 'px-3 py-1.5 rounded-xl border text-sm font-semibold transition-colors';

  return (
    <div className="space-y-5" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader icon={<Sparkles className="w-5 h-5" />} title={t('المساعد', 'Assistant')}
        subtitle={t('اسأل عن أيّ شيءٍ في النظام — مركبة أو عميل أو شحنة أو موظّف — وخذ ملفَّه كاملًا',
                   'Ask about anything in the system — a truck, a customer, a shipment, an employee — and get its full file')}>
        {answer && (
          <button type="button" onClick={() => router.push(answer.reportPath)}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 text-slate-700 text-sm font-semibold hover:border-[#f37121] hover:text-[#f37121]">
            <FileText className="w-4 h-4" /> {t('افتحه في مركز التقارير للطباعة', 'Open in Reports to print')}
          </button>
        )}
      </PageHeader>

      {/* ── ١: اكتبْ ما تعرفه ──────────────────────────────────────────────── */}
      <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm space-y-3">
        <div className="relative">
          <Search className="absolute top-1/2 -translate-y-1/2 start-3 w-4 h-4 text-slate-400" />
          <input
            value={q} onChange={(e) => setQ(e.target.value)} autoFocus
            placeholder={t('اكتب لوحةً أو اسمَ عميلٍ أو رقمَ بوليصةٍ أو رقمَ إقامة…',
                           'Type a plate, a customer name, a waybill number or an iqama…')}
            className="w-full ps-10 pe-3 py-3 rounded-xl bg-slate-50 border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/40" />
          {searching && <Loader2 className="absolute top-1/2 -translate-y-1/2 end-3 w-4 h-4 text-slate-400 animate-spin" />}
        </div>

        {/* الفترةُ تخصّ ما له فترة (الحمولات والتفقّد والفواتير) ولا تضرّ البقيّة. */}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-slate-400">{t('الفترة', 'Period')}</span>
          {periods.map((p) => (
            <button key={p.key} type="button"
              onClick={() => { setPeriod(p.key); if (asked) ask(asked.topic, asked.id, p.key); }}
              className={`px-2 py-1 rounded-lg border text-[11px] font-semibold ${
                period === p.key ? 'border-[#f37121] bg-[#f37121] text-white' : 'border-slate-200 bg-white text-slate-600'}`}>
              {ar ? p.ar : p.en}
            </button>
          ))}
        </div>

        {groups.length > 0 && (
          <div className="space-y-2">
            {groups.map((g) => (
              <div key={g.topic}>
                <p className="text-[11px] font-bold text-slate-500 mb-1 flex items-center gap-1.5">
                  <Icon name={g.icon} className="w-3.5 h-3.5" />
                  {ar ? g.ar : g.en}
                  <span className="font-normal text-slate-400">({g.total})</span>
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {g.items.map((it) => (
                    <button key={it.id} type="button" onClick={() => ask(g.topic, it.id)}
                      className="text-start px-3 py-2 rounded-xl border border-slate-200 bg-white hover:border-[#f37121] hover:bg-[#f37121]/[0.04]">
                      <span className="block text-sm font-semibold text-slate-900">{it.name}</span>
                      {it.detail && <span className="block text-[11px] text-slate-500">{it.detail}</span>}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
        {q.trim().length >= 2 && !searching && groups.length === 0 && (
          <p className="text-xs text-slate-400">{t('لا شيءَ بهذا الاسم أو الرقم — جرّب جزءًا منه، أو اختر من الأقسام تحت.',
                                                    'Nothing by that name or number — try part of it, or pick a section below.')}</p>
        )}
      </div>

      {/* ── ٢: أو امشِ بالأقسام ────────────────────────────────────────────── */}
      {!answer && (
        <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm space-y-3">
          <div className="flex items-center gap-2 text-sm">
            <button type="button" onClick={reset}
              className={`font-bold ${section ? 'text-slate-400 hover:text-[#f37121]' : 'text-slate-900'}`}>
              {t('الأقسام', 'Sections')}
            </button>
            {section && (<>
              <ChevronLeft className={`w-3.5 h-3.5 text-slate-300 ${isRTL ? '' : 'rotate-180'}`} />
              <button type="button" onClick={() => { setTopic(null); setOptions([]); }}
                className={`font-bold ${topic ? 'text-slate-400 hover:text-[#f37121]' : 'text-slate-900'}`}>{section.label}</button>
            </>)}
            {topic && (<>
              <ChevronLeft className={`w-3.5 h-3.5 text-slate-300 ${isRTL ? '' : 'rotate-180'}`} />
              <span className="font-bold text-slate-900">{ar ? topic.ar : topic.en}</span>
            </>)}
          </div>

          {!section && (
            <div className="flex flex-wrap gap-2">
              {sections.map((s) => (
                <button key={s.key} type="button" onClick={() => setSection(s)}
                  className={`${chip} border-slate-200 bg-white text-slate-700 hover:border-[#f37121] hover:text-[#f37121]`}>
                  {s.label} <span className="text-slate-400 font-normal">({s.topics.length})</span>
                </button>
              ))}
              {!sections.length && !error && <p className="text-xs text-slate-400">{t('جارٍ…', 'Loading…')}</p>}
            </div>
          )}

          {section && !topic && (
            <div className="flex flex-wrap gap-2">
              {section.topics.map((tp) => (
                <button key={tp.key} type="button"
                  onClick={() => { setTopic(tp); setOptQ(''); loadOptions(tp); }}
                  className={`${chip} inline-flex items-center gap-1.5 border-slate-200 bg-white text-slate-700 hover:border-[#f37121] hover:text-[#f37121]`}>
                  <Icon name={tp.icon} className="w-4 h-4" /> {ar ? tp.ar : tp.en}
                </button>
              ))}
            </div>
          )}

          {topic && (
            <div className="space-y-2">
              {topic.searchable && (
                <div className="relative max-w-md">
                  <Search className="absolute top-1/2 -translate-y-1/2 start-2.5 w-4 h-4 text-slate-400" />
                  <input value={optQ}
                    onChange={(e) => { setOptQ(e.target.value); loadOptions(topic, e.target.value); }}
                    placeholder={t('ابحث…', 'Search…')}
                    className="w-full ps-9 pe-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-sm" />
                </div>
              )}
              {optBusy && <p className="text-xs text-slate-400">{t('جارٍ…', 'Loading…')}</p>}
              <div className="flex flex-wrap gap-1.5">
                {options.map((it) => (
                  <button key={it.id} type="button" onClick={() => ask(topic.key, it.id)}
                    className="text-start px-3 py-2 rounded-xl border border-slate-200 bg-white hover:border-[#f37121] hover:bg-[#f37121]/[0.04]">
                    <span className="block text-sm font-semibold text-slate-900">{it.name}</span>
                    {it.detail && <span className="block text-[11px] text-slate-500">{it.detail}</span>}
                  </button>
                ))}
              </div>
              {!optBusy && !options.length && (
                <p className="text-xs text-slate-400">{t('لا نتائج — جرّب كلمةً أخرى.', 'No matches — try another word.')}</p>
              )}
            </div>
          )}
        </div>
      )}

      {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-3">{error}</p>}
      {loading && (
        <div className="flex items-center gap-2 text-sm text-slate-500 bg-white border border-slate-200 rounded-2xl px-4 py-6 justify-center">
          <Loader2 className="w-4 h-4 animate-spin" /> {t('يجمع البيانات من الأقسام…', 'Gathering across sections…')}
        </div>
      )}

      {/* ── الجواب: سطورٌ تُقرأ أوّلًا، ثمّ الوثيقةُ كاملةً ───────────────── */}
      {answer && !loading && (
        <div className="space-y-4">
          <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3 mb-3">
              <div>
                <h2 className="font-bold text-slate-900">{answer.title}</h2>
                <p className="text-sm text-slate-500">{answer.subtitle}</p>
              </div>
              <button type="button" onClick={() => { setAnswer(null); setAsked(null); setError(''); }}
                className="text-xs font-semibold text-slate-400 hover:text-[#f37121] inline-flex items-center gap-1">
                {t('سؤالٌ آخر', 'Ask something else')} <ArrowRight className={`w-3.5 h-3.5 ${isRTL ? 'rotate-180' : ''}`} />
              </button>
            </div>
            {answer.highlights.length > 0 && (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
                {answer.highlights.map((h, i) => (
                  <div key={i} className="rounded-xl bg-slate-50 border border-slate-200 px-3 py-2">
                    <p className="text-[10.5px] text-slate-500">{h.label}</p>
                    <p className="text-sm font-bold text-slate-900 truncate" title={h.value}>{h.value}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm overflow-x-auto">
            <ReportView doc={answer.doc} />
          </div>
        </div>
      )}
    </div>
  );
}
