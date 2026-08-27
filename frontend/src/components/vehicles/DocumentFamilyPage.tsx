'use client';
// ── صفحةُ عائلةِ مستندٍ واحدة: بطاقات التشغيل، التفاويض، رخص السير… ──────────
//
// المشكلة التي تحلّها ليست نقصًا في البيانات. أرقام بطاقات التشغيل مسجَّلة على
// مئتين وعشرين مركبة، وأرقام التفاويض على مئتين وإحدى وعشرين، وكلُّها في قاعدة
// البيانات منذ الاستيراد. الذي كان ناقصًا هو **عمودٌ يعرضها**: قائمةُ المركبات
// العامّة تعرض اللوحة والقطاع والمالك، فمن يفلتر على بطاقة التشغيل يحصل على
// الصفوف الصحيحة ولا يرى رقمَ بطاقةٍ واحدة فيها — فيظنّ الملف لم يُستورَد.
//
// ولماذا صفحةٌ لكل عائلة لا أعمدةٌ إضافية في القائمة العامّة: أعمدةُ المستندات
// الستّة مجتمعةً تجاوز الأربعين عمودًا، وجدولٌ بأربعين عمودًا لا يُقرأ. وفي
// الملف المصدر كانت كلُّ عائلةٍ مجموعةً بلونها وحدها — والشاشة تتبع الورقة التي
// يعرفها القسم.
//
// وكلُّ صفحةٍ من السبع لا تكتب من هذا شيئًا: تصف أعمدتها وتنتهي. لو نُسخ الهيكل
// سبع مرات لافترقت النسخُ عند أوّل تعديل — يُصلَح ترتيبُ العنوان في واحدة ويبقى
// في ستّ، ويُضاف زرُّ التجديد في واحدة ويغيب عن ستّ.
import { useState, useEffect, useCallback, useMemo, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useLanguage } from '@/context/LanguageContext';
import { useAuth } from '@/context/AuthContext';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import { useDialog } from '@/components/system/DialogProvider';
import { Spinner, PageHeader } from '@/components/hr/HRKit';
import ExportMenu, { type ExportColumn } from '@/components/ls2/ExportMenu';
import FilterPanel, { type FilterValues } from '@/components/system/FilterPanel';
import FilterBar, { useChipFilter, type Chip } from '@/components/ls2/FilterBar';
import { RenewModal, BulkRenewModal, type RenewTarget } from '@/components/vehicles/RenewModals';
import { ArrowRight, RefreshCw } from 'lucide-react';
import { VReg, DOC_TYPES, daysText, STATE_META, canEditVehicles } from '@/lib/vehicleRegistry';

/** عمودٌ واحد: كيف يُقرأ من المركبة، وكيف يُسمّى، وكيف يُرسَم. */
export type DocColumn = {
  key: string;
  ar: string; en: string;
  /** القيمة الخام — يُبنى منها العمود والتصدير معًا فلا يفترق الملفّ عن الشاشة. */
  get: (v: VReg) => string | number | null | undefined;
  /** أرقامُ الأوراق تُقرأ يسارًا إلى يمين مهما كانت لغة الصفحة. */
  mono?: boolean;
  width?: number;
};

/**
 * حالةُ هذا المستند على هذه المركبة، بالاسم الذي يفهمه `STATE_META`.
 * تُقرأ من `docStatuses` الذي يحسبه الخادم بعتبات الإعدادات — لا تُحسَب هنا،
 * وإلا لاختلفت ألوان هذه الشاشة عن شاشة التنبيهات على نفس المركبة نفسِها.
 */
const stateOf = (v: VReg, docKey: string) => {
  const s = v.docStatuses?.[docKey];
  if (!s) return { state: 'missing', days: null as number | null };
  const state = s.status === 'none' ? 'missing' : s.status === ('not_required' as any) ? 'not_applicable' : s.status;
  return { state, days: s.days };
};

function DocumentFamilyPageInner({
  docKey, path, icon, titleAr, titleEn, subtitleAr, subtitleEn, columns, fileName, searchIn, chips,
}: {
  /**
   * مفتاح المستند ذي تاريخ الانتهاء — أو `null` لعائلةٍ لا تنتهي.
   *
   * شريحةُ بترو اب من هذا الثاني: لها رقمٌ وحالةٌ وسقفُ صرف ولا تاريخَ انتهاء
   * لها. وإقحامُها في عمود «الأيام المتبقية» كان سيجعل ثلاثمئة مركبة تظهر
   * «بلا تاريخ» في شاشةٍ لا معنى للتاريخ فيها أصلًا — نقصٌ مُختلَق يُوهم أن
   * ثَمّ عملًا مطلوبًا. ومعه يسقط زرُّ التجديد: لا يُجدَّد ما لا ينتهي.
   */
  docKey: string | null;
  /** مسار هذه الصفحة — الفلاتر تعيش في عنوانها هي لا في عنوان غيرها. */
  path: string;
  icon: React.ReactNode;
  titleAr: string; titleEn: string;
  subtitleAr: string; subtitleEn: string;
  columns: DocColumn[];
  fileName: string;
  /** الحقول التي يمسّها البحث السريع فوق الجدول. */
  searchIn?: (v: VReg) => (string | number | null | undefined)[];
  /** شرائح خاصة بالعائلة — تحلّ محلّ شرائح الحالة حين لا مستندَ ينتهي. */
  chips?: Chip[];
}) {
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const t = (a: string, e: string) => (ar ? a : e);
  const { user } = useAuth();
  const { notify } = useDialog();
  const sp = useSearchParams();
  const router = useRouter();
  const canEdit = canEditVehicles(user);

  const doc = docKey ? DOC_TYPES.find((d) => d.key === docKey) : undefined;
  const renewable = !!doc && canEdit;

  const [rows, setRows] = useState<VReg[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState(sp?.get('q') || '');
  const [chip, setChip] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [renewing, setRenewing] = useState<RenewTarget | null>(null);
  const [bulk, setBulk] = useState<RenewTarget[] | null>(null);

  // كل ما في العنوان فلترٌ يُمرَّر للخادم كما هو. القائمة المكتوبة بالاسم كانت
  // تُسقِط أي فلترٍ خارجها في صمت، فتفتح الشاشةُ الأسطول كلَّه وهي تقول إنها
  // مفلترة — ورقمٌ يفتح غير ما يقول أسوأ من رقمٍ لا يُضغَط.
  const UI_ONLY = ['limit', 'page', 'q'];
  const [filters, setFilters] = useState<FilterValues>(() =>
    Object.fromEntries([...(sp?.entries() || [])].filter(([k]) => !UI_ONLY.includes(k))));

  const qs = useMemo(() => {
    const p = new URLSearchParams();
    if (q.trim()) p.set('q', q.trim());
    for (const [k, v] of Object.entries(filters)) if (v !== '' && v != null) p.set(k, String(v));
    p.set('limit', '2000');
    return p.toString();
  }, [q, JSON.stringify(filters)]);

  const load = useCallback(async () => {
    try {
      const d = await api.get<{ vehicles: VReg[]; total: number }>(`/api/vehicle-registry?${qs}`);
      setRows(d.vehicles || []); setTotal(d.total || 0);
      // الاختيارُ الذي خرج من النتيجة لا يبقى محفوظًا في الخفاء: من يفلتر ثم
      // يضغط «تجديد جماعي» لا يقصد مركباتٍ لم تعد أمامه.
      setPicked((prev) => new Set([...prev].filter((id) => (d.vehicles || []).some((v) => v._id === id))));
    } catch (e: any) { notify(e?.message || 'Failed', 'error'); } finally { setLoading(false); }
  }, [qs, notify]);

  useEffect(() => { const h = setTimeout(load, 200); return () => clearTimeout(h); }, [load]);
  useSocket('vreg:updated', useCallback(() => load(), [load]));

  // ما تختاره يعيش في العنوان: الرجوعُ والتقدّم يعملان، والرابط يُرسَل كما هو.
  useEffect(() => {
    const p = new URLSearchParams();
    if (q.trim()) p.set('q', q.trim());
    for (const [k, v] of Object.entries(filters)) if (v !== '' && v != null) p.set(k, String(v));
    const s = p.toString();
    router.replace(`${path}${s ? `?${s}` : ''}`, { scroll: false });
  }, [q, JSON.stringify(filters), router, path]);

  // ── الشرائح: حالةُ **هذا** المستند وحده ──────────────────────────────────
  // لا حالة المركبة العامّة: مركبةٌ تأمينها منتهٍ وبطاقةُ تشغيلها سارية ليست
  // «منتهية» في صفحة بطاقات التشغيل، ولو عُدَّت كذلك لفتحت الشريحةُ صفوفًا لا
  // علاقة لها بالعمل الذي فُتحت الشاشة من أجله.
  const CHIPS: Chip[] = useMemo(() => (chips || (!docKey ? [{ key: '', label: t('الكل', 'All') }] : [
    { key: '', label: t('الكل', 'All') },
    { key: 'expired', label: t('منتهٍ', 'Expired'), tone: 'red', test: (v: VReg) => stateOf(v, docKey).state === 'expired' },
    { key: 'critical', label: t('ينتهي قريبًا جدًا', 'Critical'), tone: 'amber', test: (v: VReg) => stateOf(v, docKey).state === 'critical' },
    { key: 'warning', label: t('قارب على الانتهاء', 'Due soon'), tone: 'amber', test: (v: VReg) => stateOf(v, docKey).state === 'warning' },
    { key: 'valid', label: t('ساري', 'Valid'), tone: 'green', test: (v: VReg) => stateOf(v, docKey).state === 'valid' },
    // «بلا تاريخ» ليست حالةً فرعية — هي قائمةُ العمل الأولى: مستندٌ لا يُعرَف
    // متى ينتهي لا يظهر في أي تنبيه، فينتهي ولا يعلم أحد.
    { key: 'missing', label: t('بلا تاريخ مسجَّل', 'No date on file'), tone: 'slate', test: (v: VReg) => stateOf(v, docKey).state === 'missing' },
  ])), [ar, docKey, chips]);

  const search = useCallback((v: VReg) => (searchIn ? searchIn(v) : [v.plateNumber, v.ownerNameAr]), [searchIn]);
  const f = useChipFilter(rows, CHIPS, chip, q, search);

  // صفٌّ مسطَّح للتصدير: نفس الدوالّ التي تُرسم بها الخلايا، فالملفّ لا يختلف
  // عن الشاشة ولا يحتاج تعريفًا ثانيًا للأعمدة.
  const flat = (v: VReg) => {
    const o: Record<string, any> = {};
    for (const c of columns) o[c.key] = c.get(v) ?? '';
    if (docKey) {
      const st = stateOf(v, docKey);
      o.__state = ar ? (STATE_META[st.state]?.ar || st.state) : (STATE_META[st.state]?.en || st.state);
      o.__days = st.days ?? '';
    }
    return o;
  };
  const exportCols: ExportColumn[] = [
    ...columns.map((c) => ({ header: ar ? c.ar : c.en, key: c.key, width: c.width || 18 })),
    ...(docKey ? [
      { header: t('الحالة', 'State'), key: '__state', width: 14 },
      { header: t('الأيام المتبقية', 'Days left'), key: '__days', width: 12 },
    ] : []),
  ];

  const targetOf = (v: VReg): RenewTarget => ({
    vehicleId: v._id, plateNumber: v.plateNumber, docKey: docKey || '',
    docAr: doc?.ar, docEn: doc?.en, expiryDate: doc?.datePath(v) || null,
    documentNumber: doc?.numberOf(v) || '',
  });

  const allShownPicked = f.shown.length > 0 && f.shown.every((v: VReg) => picked.has(v._id));
  const toggleAll = () => setPicked((p) => {
    const n = new Set(p);
    if (allShownPicked) f.shown.forEach((v: VReg) => n.delete(v._id));
    else f.shown.forEach((v: VReg) => n.add(v._id));
    return n;
  });

  if (loading && !rows.length) return <Spinner />;

  return (
    <div className="space-y-4 w-full pb-10" dir={isRTL ? 'rtl' : 'ltr'}>
      <Link href="/system/vehicles/registry/overview"
        className="inline-flex items-center gap-1.5 text-slate-500 text-sm hover:text-slate-900">
        <ArrowRight className="w-4 h-4 rtl:rotate-0 ltr:rotate-180" />
        {t('النظرة الشاملة', 'Overview')}
      </Link>

      <PageHeader icon={icon} title={t(titleAr, titleEn)} subtitle={t(subtitleAr, subtitleEn)}>
        {renewable && picked.size > 0 && (
          <button
            onClick={() => setBulk(rows.filter((v) => picked.has(v._id)).map(targetOf))}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold">
            <RefreshCw className="w-4 h-4" />
            {t(`تجديد ${picked.size} مستند`, `Renew ${picked.size}`)}
          </button>
        )}
        <ExportMenu fileName={fileName} lang={lang as 'ar' | 'en'}
          options={[{
            key: 'shown',
            // الملفّ هو المعروض بالضبط — بعد الفلتر والشريحة والبحث. تصديرُ
            // الأسطول كلِّه من شاشةٍ مفلترة يجعل من يفتح الملف يظنّ فلترَه ضاع.
            label: t('تصدير المعروض (بعد الفلتر)', 'Export what is shown (filtered)'),
            sheets: [{ name: t(titleAr, titleEn).slice(0, 28), rows: f.shown.map(flat), columns: exportCols }],
          }]} />
      </PageHeader>

      <div className="flex flex-wrap items-center gap-2">
        <FilterPanel
          optionsUrl="/api/vehicle-registry/filters"
          value={filters}
          onChange={setFilters}
          resultCount={total}
          resultLabel={t('المركبات المطابقة', 'Matching vehicles')}
        />
      </div>

      <FilterBar chips={CHIPS} counts={f.counts} active={chip} onChange={setChip}
        query={q} onQuery={setQ} placeholder={t('ابحث بلوحة أو رقم…', 'Search plate or number…')}
        shown={f.shown.length} total={rows.length} ar={ar} />

      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-900 text-slate-200 text-[12.5px]">
              <tr>
                {renewable && (
                  <th className="px-3 py-3 w-8">
                    <input type="checkbox" checked={allShownPicked} onChange={toggleAll}
                      title={t('اختيار كل المعروض', 'Select all shown')} className="accent-[#f37121]" />
                  </th>
                )}
                {columns.map((c) => (
                  <th key={c.key} className="px-3 py-3 text-start font-bold whitespace-nowrap">{ar ? c.ar : c.en}</th>
                ))}
                {docKey && <th className="px-3 py-3 text-start font-bold whitespace-nowrap">{t('الحالة', 'State')}</th>}
                {renewable && <th className="px-3 py-3" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {f.shown.map((v: VReg) => {
                const st = docKey ? stateOf(v, docKey) : null;
                const meta = st ? (STATE_META[st.state] || STATE_META.valid) : null;
                return (
                  <tr key={v._id} className={`hover:bg-slate-50 ${picked.has(v._id) ? 'bg-orange-50/60' : ''}`}>
                    {renewable && (
                      <td className="px-3 py-2">
                        <input type="checkbox" checked={picked.has(v._id)} className="accent-[#f37121]"
                          onChange={() => setPicked((p) => {
                            const n = new Set(p); if (n.has(v._id)) n.delete(v._id); else n.add(v._id); return n;
                          })} />
                      </td>
                    )}
                    {columns.map((c, i) => {
                      const val = c.get(v);
                      const text = val === null || val === undefined || val === '' ? '—' : String(val);
                      return (
                        <td key={c.key}
                          className={`px-3 py-2 whitespace-nowrap ${c.mono ? 'font-mono text-[12.5px]' : 'text-[13px]'} ${i === 0 ? 'font-semibold text-slate-900' : 'text-slate-700'}`}
                          {...(c.mono ? { dir: 'ltr' } : {})}>
                          {i === 0
                            ? <Link href={`/system/vehicles/registry/${v._id}`} className="text-[#f37121] hover:underline">{text}</Link>
                            : text}
                        </td>
                      );
                    })}
                    {st && meta && (
                      <td className="px-3 py-2 whitespace-nowrap">
                        <span className={`px-2 py-0.5 rounded-full text-[11.5px] font-semibold ${meta.bg}`}>
                          {st.days == null ? (ar ? meta.ar : meta.en) : daysText(st.days, ar)}
                        </span>
                      </td>
                    )}
                    {renewable && (
                      <td className="px-3 py-2">
                        <button onClick={() => setRenewing(targetOf(v))}
                          className="px-2 py-1 rounded-lg bg-emerald-50 text-emerald-800 border border-emerald-200 text-[11.5px] font-semibold hover:bg-emerald-100 whitespace-nowrap">
                          {t('تجديد', 'Renew')}
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
              {!f.shown.length && (
                <tr><td colSpan={columns.length + 3} className="px-3 py-12 text-center text-slate-500">
                  {t('لا نتائج مطابقة', 'No matching rows')}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {renewing && (
        <RenewModal row={renewing} ar={ar} onClose={() => setRenewing(null)}
          onDone={() => { setRenewing(null); load(); }} />
      )}
      {bulk && (
        <BulkRenewModal rows={bulk} ar={ar} onClose={() => setBulk(null)}
          onDone={() => { setBulk(null); setPicked(new Set()); load(); }} />
      )}
    </div>
  );
}

// `useSearchParams` يوجب حدَّ Suspense في موجِّه Next، وإلا صار البناءُ فشلًا
// صريحًا عند أوّل تعديلٍ في غلاف القسم.
export default function DocumentFamilyPage(props: Parameters<typeof DocumentFamilyPageInner>[0]) {
  return <Suspense fallback={<Spinner />}><DocumentFamilyPageInner {...props} /></Suspense>;
}

/** أعمدةٌ تتكرّر في كل عائلة: اللوحة أوّلًا، ثم ما يُعرَف به موضعُ المركبة. */
export const commonColumns = (): DocColumn[] => [
  { key: 'plateNumber', ar: 'رقم اللوحة', en: 'Plate', get: (v) => v.plateNumber, width: 16 },
  { key: 'sectorAr', ar: 'القطاع', en: 'Sector', get: (v) => v.sectorAr, width: 16 },
  { key: 'departmentAr', ar: 'الإدارة', en: 'Department', get: (v) => v.departmentAr, width: 18 },
  { key: 'cityAr', ar: 'المدينة', en: 'City', get: (v) => v.cityAr, width: 14 },
  { key: 'ownerNameAr', ar: 'المالك', en: 'Owner', get: (v) => v.ownerNameAr, width: 26 },
];
