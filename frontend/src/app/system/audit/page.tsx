'use client';
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useLanguage } from '@/context/LanguageContext';
import { getAuditTranslations, getAuditExtraTranslations } from '@/lib/translations';
import api from '@/lib/api';
import { motion, AnimatePresence } from 'framer-motion';
import {
  RefreshCw, Filter, ChevronDown, ChevronUp,
  ChevronLeft, ChevronRight, Calendar, X,
} from 'lucide-react';
import { fmt } from '@/utils/exportExcel';
import ExportMenu, { exportScopeLabels, type ExportColumn } from '@/components/ls2/ExportMenu';
import { SearchableSelect } from '@/components/hr/HRKit';
import { useLatestRequest } from '@/hooks/useLatestRequest';

/**
 * ── ما يقوله الصفُّ يكتبه الخادم ─────────────────────────────────────────────
 * اسمُ الفعل والكيان والقسم، والسجلُّ الذي وقع عليه الفعل، وجملةُ ما تغيّر —
 * كلُّها تصل جاهزةً من `/api/audit` (راجع utils/auditDescribe في الخادم).
 * كانت تُبنى هنا من خرائطَ محلّيّة، والتطبيقُ يعرض السجلَّ نفسَه بمفاتيحه
 * الخام: شاشتان لسجلٍّ واحدٍ تقولان شيئين.
 */
interface DetailRow {
  key: string;
  label: string;
  /** `null` فارغ، و`undefined` لم يُسجَّل (أو مرجعٌ لم يُعرَف صاحبُه). */
  before?: string | null;
  after?: string | null;
  kind: 'changed' | 'value' | 'cleared' | 'field';
  text: string;
}
interface AuditLog {
  _id: string;
  user: { _id: string; firstName: string; lastName: string; email: string; deleted?: boolean; unnamed?: boolean } | null;
  userName?: string;
  action: string;
  actionLabel: string;
  entity: string;
  entityLabel: string;
  entityId?: string;
  entityKey?: string;
  /** القسمُ يحسبه الخادم من الكيان — خريطةٌ واحدة يقرؤها الفلترُ والعمود. */
  section?: string;
  sectionLabel?: string;
  /** على أيِّ سجلٍّ وقع الفعل: «كشف 89400»، اسمُ موظّف، لوحة. */
  subject?: string;
  /** جملةُ ما جرى — تُعرَض في الخانة كما هي. */
  summary?: string;
  kind?: 'none' | 'update' | 'create' | 'set' | 'delete' | 'fields' | 'bulk' | 'info';
  hasDetails?: boolean;
  detail?: { rows: DetailRow[]; unchanged: { key: string; label: string; value: string }[]; bulkCount: number | null };
  ipAddress?: string;
  createdAt: string;
}

interface AuditActor { _id: string; firstName: string; lastName: string; email: string; deleted?: boolean; count: number }
interface AuditSection { key: string; ar: string; en: string; count: number }
interface AuditEntityOpt { key: string; section: string; count: number; label: string }
interface AuditActionOpt { key: string; count: number; label: string }
interface AuditBranch { _id: string; name: string }
interface AuditOptions {
  entities: AuditEntityOpt[]; sections: AuditSection[]; actions: AuditActionOpt[];
  users: AuditActor[]; branches: AuditBranch[]; systemCount: number; unnamedCount: number;
}

interface PaginationInfo {
  page: number;
  limit: number;
  total: number;
  pages: number;
}

const PAGE_SIZE = 25;

/**
 * ── اليومُ يومُ الشركة لا يومُ المتصفّح ──────────────────────────────────────
 * «اليوم» و«أمس» كانا يُحسَبان بساعة الجهاز، والخادمُ يقطع اليومَ بتوقيت
 * الرياض: من فتح الشاشةَ من بلدٍ آخر بعد منتصف ليلِه طلب يومًا لم يبدأ في
 * الرياض بعد. فاليومُ يُسأل عنه بالمنطقة نفسِها التي يُفلتَر بها.
 */
const COMPANY_TZ = 'Asia/Riyadh';
const companyDay = (offsetDays = 0) => {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: COMPANY_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - offsetDays);
  return d.toISOString().slice(0, 10);
};

export default function AuditPage() {
  const { lang } = useLanguage();
  const ar = lang === 'ar';
  const T = getAuditTranslations(lang);
  const txx = getAuditExtraTranslations(lang);
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [pagination, setPagination] = useState<PaginationInfo>({ page: 1, limit: PAGE_SIZE, total: 0, pages: 0 });
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [showUnchanged, setShowUnchanged] = useState(false);
  const [loadedOnce, setLoadedOnce] = useState(false);

  // Filters — the vocabulary (real actors + entities that actually occur)
  // comes from /api/audit/options, not a hardcoded list.
  const [entityFilter, setEntityFilter] = useState('');
  const [userFilter, setUserFilter] = useState('');
  // ── الفعلُ اختيارٌ لا بحثٌ نصّيّ ───────────────────────────────────────────
  // الخانةُ كانت تبحث في المفتاح الإنجليزيّ (`update_workflow`) والعمودُ يعرض
  // «تعديل عملية تشغيل»: من كتب ما يقرؤه لم يجد شيئًا. فصارت قائمةً بالأفعال
  // الواقعة فعلًا داخل القسم والكيان المختارَين، بأسمائها المعروضة.
  const [actionFilter, setActionFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [options, setOptions] = useState<AuditOptions>({
    entities: [], sections: [], actions: [], users: [], branches: [], systemCount: 0, unnamedCount: 0,
  });
  // ── القسمُ أوّلًا، والكيانُ تفصيلٌ داخله ──────────────────────────────────
  // القائمةُ كانت خمسةً وثلاثين اسمَ نموذجٍ برمجيّ مسرودةً بلا ترتيب، وأربعةٌ
  // منها تبدو للقارئ «B2C» مكرَّرةً أربعَ مرّات. والسؤالُ المقصودُ «أيُّ قسم؟»
  // لا «أيُّ نموذج؟».
  const [sectionFilter, setSectionFilter] = useState('');
  // والفرعُ يُقرأ من فاعل القيد — راجع تعليقَ `branch` في auditController.
  const [branchFilter, setBranchFilter] = useState('');
  // ── يومٌ واحد، أو مدّة ────────────────────────────────────────────────────
  // «ماذا جرى يوم كذا؟» أكثرُ ما يُسأل، وكان يقتضي كتابةَ التاريخ نفسِه في
  // خانتين. ومن كتبه في واحدةٍ حصل على كلِّ شيءٍ منذ ذلك اليوم وهو يظنّ أنّه
  // فلتر يومًا.
  const [dateMode, setDateMode] = useState<'day' | 'range'>('day');
  const [day, setDay] = useState('');

  const { sections, entities, actions, branches } = options;

  /**
   * الفلاتر كما تُرسَل — دالّةٌ واحدةٌ يقرؤها الجدولُ وقوائمُ الخيارات والتصدير.
   * ثلاثُ نسخٍ منها كانت ستفترق عند أوّل فلترٍ يُضاف، فيُصدَّر غيرُ ما يُعرَض.
   */
  const filterParams = useCallback(() => {
    const params = new URLSearchParams();
    params.set('lang', ar ? 'ar' : 'en');
    if (entityFilter) params.set('entity', entityFilter);
    if (sectionFilter) params.set('section', sectionFilter);
    if (userFilter) params.set('user', userFilter);
    if (branchFilter) params.set('branch', branchFilter);
    if (actionFilter) params.set('action', actionFilter);
    // اليومُ الواحد يُرسَل حدًّا واحدًا، والخادمُ يجعله يومًا بطرفيه — فلا
    // يُكتب التاريخُ مرّتين ولا يُنسى أحدُ الطرفين.
    if (dateMode === 'day') { if (day) params.set('date', day); } else {
      if (dateFrom) params.set('dateFrom', dateFrom);
      if (dateTo) params.set('dateTo', dateTo);
    }
    return params;
  }, [ar, entityFilter, sectionFilter, userFilter, branchFilter, actionFilter, dateMode, day, dateFrom, dateTo]);

  /**
   * ── القوائمُ تتبع ما اختير ───────────────────────────────────────────────
   * كانت تُجلَب مرّةً عند الفتح، فأعدادُها أعدادُ السجلّ كلِّه مهما فُلتر:
   * يُختار «أمس» ويُقرأ أمام القسم عددُه منذ بدأ السجلّ. فتُعاد مع كلِّ تغييرٍ
   * في الفلاتر، والخادمُ يحسب كلَّ قائمةٍ بالفلاتر الأخرى سواها.
   */
  const optionsGuard = useLatestRequest();
  useEffect(() => {
    const mine = optionsGuard.begin();
    api.get<AuditOptions>(`/api/audit/options?${filterParams().toString()}`)
      .then((d) => {
        if (!optionsGuard.isCurrent(mine)) return;
        setOptions({
          entities: d.entities || [], sections: d.sections || [], actions: d.actions || [],
          users: d.users || [], branches: d.branches || [],
          systemCount: d.systemCount || 0, unnamedCount: d.unnamedCount || 0,
        });
      })
      .catch(() => { /* القوائمُ تبقى على آخر ما وصل */ });
  }, [filterParams, optionsGuard]);

  /** كياناتُ القسم المختار وحدَها. */
  const entityOptions = useMemo(
    () => (sectionFilter ? entities.filter((e) => e.section === sectionFilter) : entities),
    [entities, sectionFilter],
  );

  // ── الفلترُ التابع يسقط حين يتغيّر متبوعُه ────────────────────────────────
  // الكيانُ داخل القسم، والفعلُ داخل الكيان: تغييرُ القسم مع بقاء كيانٍ من
  // قسمٍ آخر كان يُبقي الجدولَ على الكيان القديم والقائمةُ تقول قسمًا جديدًا.
  const changeSection = (v: string) => {
    setSectionFilter(v);
    if (entityFilter && v && entities.find((e) => e.key === entityFilter)?.section !== v) setEntityFilter('');
    setActionFilter('');
  };
  const changeEntity = (v: string) => {
    setEntityFilter(v);
    setActionFilter('');
  };

  // لا يكتب ردٌّ قديمٌ فوق ردٍّ أحدث — راجع hooks/useLatestRequest. الفلاتر
  // تتغيّر بنقراتٍ متتابعة، والطلبُ غيرُ المفلتَر أبطؤها: يصل آخرًا فيعرض
  // السجلَّ كلَّه تحت فلترٍ مختار.
  const guard = useLatestRequest();
  const fetchLogs = useCallback(async (page = 1) => {
    const mine = guard.begin();
    try {
      setLoading(true);
      setError('');
      const params = filterParams();
      params.set('page', page.toString());
      params.set('limit', String(PAGE_SIZE));
      const data = await api.get<{ logs: AuditLog[]; total: number; page: number; pages: number }>(`/api/audit?${params.toString()}`);
      if (!guard.isCurrent(mine)) return;
      setLogs(data.logs || []);
      setExpandedRow(null);
      setPagination({
        page: data.page || page, limit: PAGE_SIZE, total: data.total || 0, pages: data.pages || 0,
      });
    } catch (err) {
      if (!guard.isCurrent(mine)) return;
      setError((err as Error)?.message || txx.failedToLoad);
    } finally {
      if (guard.isCurrent(mine)) { setLoading(false); setLoadedOnce(true); }
    }
  }, [filterParams, guard, txx.failedToLoad]);

  // أيُّ تغييرٍ في الفلاتر يعيد إلى الصفحة الأولى: الصفحةُ السابعةُ من نتيجةٍ
  // لم يبقَ فيها إلّا صفحتان جدولٌ فارغ.
  useEffect(() => {
    fetchLogs(1);
  }, [fetchLogs]);

  const handlePageChange = (newPage: number) => {
    if (newPage < 1 || newPage > pagination.pages) return;
    fetchLogs(newPage);
  };

  const clearFilters = () => {
    setEntityFilter('');
    setSectionFilter('');
    setUserFilter('');
    setBranchFilter('');
    setActionFilter('');
    setDay('');
    setDateFrom('');
    setDateTo('');
  };

  const hasActiveFilters = !!(entityFilter || sectionFilter || userFilter || branchFilter
    || actionFilter || (dateMode === 'day' ? day : (dateFrom || dateTo)));

  /** اختصاراتُ ما يُسأل عنه فعلًا — أكثرُه «اليوم» و«أمس». */
  const setQuickDay = (offset: number) => {
    setDateMode('day'); setDay(companyDay(offset));
  };
  const setQuickRange = (days: number) => {
    setDateMode('range'); setDateFrom(companyDay(days - 1)); setDateTo(companyDay(0));
  };
  // والتبديلُ بين «يوم» و«فترة» يحمل التاريخَ معه: من اختار يومًا ثمّ أراد
  // توسيعَه لا يبدأ من خانتين فارغتين وجدولٍ عاد إلى كلِّ الوقت.
  const changeDateMode = (m: 'day' | 'range') => {
    if (m === dateMode) return;
    if (m === 'range' && day && !dateFrom && !dateTo) { setDateFrom(day); setDateTo(day); }
    if (m === 'day' && !day && dateFrom && dateFrom === dateTo) setDay(dateFrom);
    setDateMode(m);
  };

  // حسابٌ محذوفٌ لم يُلتقَط اسمُه لا سطرَ له في قائمة الأشخاص — مجموعٌ مع أمثاله
  // في خيارٍ واحد، فالنقرُ على اسمه يفتح ذلك الخيار لا قائمةً بلا اختيار.
  const filterByActor = (log: AuditLog) => {
    if (!log.user) return;
    const listed = options.users.some((u) => u._id === log.user!._id);
    setUserFilter(listed || !log.user.deleted ? log.user._id : 'unnamed');
    setShowFilters(true);
  };

  const actorName = (log: AuditLog) => (log.user ? `${log.user.firstName} ${log.user.lastName}`.trim() : txx.system);
  const exportColumns: ExportColumn[] = [
    { header: T.date, key: 'createdAt', transform: fmt.datetime, width: 22 },
    { header: T.user, key: 'user', transform: (_: unknown, row: AuditLog) => actorName(row), width: 20 },
    { header: T.email, key: 'user.email', width: 24 },
    { header: T.action, key: 'actionLabel', width: 28 },
    { header: ar ? 'القسم' : 'Section', key: 'sectionLabel', width: 18 },
    { header: T.entity, key: 'entityLabel', width: 18 },
    { header: ar ? 'السجل' : 'Record', key: 'subject', width: 26 },
    { header: T.details, key: 'summary', width: 70 },
    { header: T.ipAddress, key: 'ipAddress', width: 16 },
  ];
  // السجلّ مرقَّمٌ على الخادم بخمسةٍ وعشرين سطرًا، والسجلّ نفسه يبلغ عشرات الآلاف؛
  // فتصدير ما في الذاكرة كان يعطي ربع دقيقةٍ من التاريخ ويُسمّيه «تحميل السجلّ».
  // لذلك نُعيد الجلب بحدٍّ مفتوح قبل التصدير كلّما طُلب أكثر من الصفحة الحاضرة.
  const fetchForExport = async (withFilters: boolean) => {
    const params = withFilters ? filterParams() : new URLSearchParams({ lang: ar ? 'ar' : 'en' });
    params.set('page', '1');
    params.set('limit', '100000');
    const data = await api.get<{ logs: AuditLog[] }>(`/api/audit?${params.toString()}`);
    return [{ name: T.title, rows: data.logs || [], columns: exportColumns }];
  };
  const scope = exportScopeLabels(ar);
  const exportOptions = [
    { key: 'page', label: scope.page, sheets: [{ name: T.title, rows: logs, columns: exportColumns }] },
    { key: 'matching', label: hasActiveFilters ? scope.matching : scope.all, resolve: () => fetchForExport(true), hint: String(pagination.total) },
    ...(hasActiveFilters ? [{ key: 'all', label: scope.all, resolve: () => fetchForExport(false) }] : []),
  ];

  // الوقتُ المعروض بتوقيت الشركة — هو الذي يُفلتَر به اليوم، فصفٌّ يُعرَض
  // «١١:٤٠ م يوم ٨» بساعة المتصفّح قد يكون في فلتر يوم ٩.
  const formatTimestamp = (date: string) => {
    const d = new Date(date);
    return d.toLocaleDateString('en-US', {
      timeZone: COMPANY_TZ,
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  const formatRelativeTime = (date: string) => {
    const now = new Date();
    const d = new Date(date);
    const diffMs = now.getTime() - d.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) return txx.justNow;
    if (diffMins < 60) return `${diffMins}${txx.minutesAgo}`;
    if (diffHours < 24) return `${diffHours}${txx.hoursAgo}`;
    if (diffDays < 7) return `${diffDays}${txx.daysAgo}`;
    return '';
  };

  const getActionColor = (action: string) => {
    const a = action.toLowerCase();
    if (a.includes('create') || a.includes('add')) return 'text-green-600 bg-green-500/10';
    if (a.includes('delete') || a.includes('remove') || a.includes('deactivate')) return 'text-red-600 bg-red-500/10';
    if (a.includes('update') || a.includes('edit') || a.includes('modify')) return 'text-blue-600 bg-blue-500/10';
    if (a.includes('login') || a.includes('auth')) return 'text-purple-600 bg-purple-500/10';
    if (a.includes('lock') || a.includes('unlock')) return 'text-yellow-700 bg-yellow-500/10';
    return 'text-slate-500 bg-slate-500/10';
  };

  /** عنوانُ التفصيل يقول نوعَ القيد قبل صفوفه. */
  const kindNote = (log: AuditLog): string => {
    const n = log.detail?.rows.length || 0;
    switch (log.kind) {
      case 'update': return n
        ? (ar ? 'ما تغيّر في هذا التعديل' : 'What this edit changed')
        : (ar ? 'حُفظ السجلّ ولم تتغيّر فيه أيُّ قيمة' : 'The record was saved with no value changed');
      case 'create': return ar ? 'سجلٌّ جديد — البيانات التي أُنشئ بها' : 'New record — the data it was created with';
      case 'delete': return ar ? 'سجلٌّ حُذف — بياناته قبل الحذف' : 'Deleted record — its data before deletion';
      case 'set': return ar ? 'القيم الجديدة — لم تُسجَّل القيم السابقة في هذا القيد' : 'New values — previous values were not recorded';
      case 'fields': return ar ? 'الحقول التي عُدِّلت — لم تُسجَّل قيمُها في هذا القيد' : 'Fields edited — their values were not recorded';
      case 'bulk': return ar
        ? `إجراء جماعي — عدد السجلات: ${log.detail?.bulkCount ?? '—'}`
        : `Bulk action — records: ${log.detail?.bulkCount ?? '—'}`;
      default: return ar ? 'بيانات القيد' : 'Entry data';
    }
  };

  const cell = (v: string | null | undefined, tone: string) => {
    if (v === null) return <span className="text-slate-400">{ar ? 'فارغ' : 'empty'}</span>;
    if (v === undefined) return <span className="text-slate-400">{ar ? 'غير مسجَّل' : 'not recorded'}</span>;
    return <span className={`${tone} break-words`} dir="auto">{v}</span>;
  };

  /**
   * ── التفصيلُ الكامل: الحقلُ، وما كان، وما صار ───────────────────────────────
   * ثلاثةُ أعمدةٍ بأسماء الحقول كما تُقرأ في شاشاتها. وما لم يتغيّر من السجلّ
   * مطويٌّ تحتها: يُفتَح لمن أراد أن يعرف حالَ السجلّ كلِّه ساعةَ التعديل،
   * ولا يدفن التغييرَ تحته — وهو ما كان يجعل تعديلَ حقلين يُقرأ خمسين سطرًا.
   */
  const renderDetail = (log: AuditLog) => {
    const d = log.detail;
    if (!d || (!d.rows.length && !d.unchanged.length)) return <p className="text-slate-500 text-xs">{txx.noChangeDetails}</p>;
    const twoSided = log.kind === 'update' && d.rows.some((r) => r.kind === 'changed');
    const namesOnly = log.kind === 'fields';
    return (
      <div className="space-y-3">
        <p className="text-slate-600 text-xs">{kindNote(log)}</p>
        {namesOnly ? (
          <div className="flex flex-wrap gap-1.5">
            {d.rows.map((r) => (
              <span key={r.key} className="px-2 py-1 rounded bg-white border border-slate-200 text-xs text-slate-800">{r.label}</span>
            ))}
          </div>
        ) : d.rows.length > 0 && (
          <table className="w-full text-xs">
            <thead>
              <tr className="text-slate-500">
                <th className="px-3 py-1.5 text-start font-medium w-[26%]">{ar ? 'الحقل' : 'Field'}</th>
                {twoSided && <th className="px-3 py-1.5 text-start font-medium w-[37%]">{ar ? 'قبل' : 'Before'}</th>}
                <th className="px-3 py-1.5 text-start font-medium">
                  {twoSided ? (ar ? 'بعد' : 'After') : (ar ? 'القيمة' : 'Value')}
                </th>
              </tr>
            </thead>
            <tbody>
              {d.rows.map((r) => (
                <tr key={r.key} className="bg-white border-t border-slate-100 align-top">
                  <td className="px-3 py-1.5 text-slate-700 font-medium">{r.label}</td>
                  {twoSided && (
                    <td className="px-3 py-1.5">
                      {r.kind === 'changed' ? cell(r.before, 'text-red-700') : <span className="text-slate-400">—</span>}
                    </td>
                  )}
                  <td className="px-3 py-1.5">
                    {log.kind === 'delete'
                      ? cell(r.before, 'text-slate-800')
                      : r.kind === 'cleared' ? cell(null, '')
                        : cell(r.after, r.kind === 'changed' ? 'text-green-700' : 'text-slate-900')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {d.unchanged.length > 0 && (
          <div>
            <button type="button" onClick={() => setShowUnchanged((v) => !v)}
              className="text-[11.5px] text-[#f37121] hover:underline flex items-center gap-1">
              {showUnchanged ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              {ar
                ? `بقيّة بيانات السجل وقت التعديل — لم تتغيّر (${d.unchanged.length})`
                : `Rest of the record at the time — unchanged (${d.unchanged.length})`}
            </button>
            {showUnchanged && (
              <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-1">
                {d.unchanged.map((u) => (
                  <div key={u.key} className="flex items-start gap-2 text-xs">
                    <span className="text-slate-500 shrink-0">{u.label}:</span>
                    <span className="text-slate-800 break-words" dir="auto">{u.value}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  const toggleRow = (id: string) => {
    setExpandedRow(expandedRow === id ? null : id);
  };

  // الدائرةُ بملء الشاشة للفتح الأوّل وحدَه. كانت تعود كلَّما فرغ الجدول ثمّ
  // تغيّر فلتر: تُزال لوحةُ الفلاتر من تحت يد المستخدم وتُبنى من جديد.
  if (!loadedOnce) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-[#f37121] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{T.title}</h1>
          <p className="text-slate-500 text-sm mt-1">
            {pagination.total > 0 && (
              <span className="text-slate-500">{pagination.total.toLocaleString()}</span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <ExportMenu fileName="audit-log" lang={ar ? 'ar' : 'en'} variant="subtle" label={T.downloadExcel} options={exportOptions} />
          <button
            type="button"
            onClick={() => setShowFilters(!showFilters)}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors border ${
              hasActiveFilters
                ? 'border-[#f37121] text-[#f37121] bg-[#f37121]/10'
                : 'border-slate-200 text-slate-500 hover:text-slate-900 hover:bg-slate-100'
            }`}
          >
            <Filter className="w-4 h-4" />
            {T.filters}
            {hasActiveFilters && (
              <span className="w-2 h-2 rounded-full bg-[#f37121]" />
            )}
          </button>
          <button
            type="button"
            onClick={() => fetchLogs(pagination.page)}
            className="p-2 text-slate-500 hover:text-slate-900 rounded-lg hover:bg-slate-100 transition-colors"
            title={txx.refresh}
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 text-red-600 text-sm">
          {error}
        </div>
      )}

      {/* Filters Panel */}
      <AnimatePresence>
        {showFilters && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4 shadow-sm">
              <div className="flex items-center justify-between">
                <h3 className="text-slate-900 font-medium text-sm">{T.filters}</h3>
                {hasActiveFilters && (
                  <button
                    type="button"
                    onClick={clearFilters}
                    className="text-[#f37121] text-xs hover:underline flex items-center gap-1"
                  >
                    <X className="w-3 h-3" />
                    {T.clearFilters}
                  </button>
                )}
              </div>
              {/* ── الصفُّ الأوّل: مَن، ومن أيّ فرع، وفي أيّ قسم ────────────
                  الترتيبُ مقصود: هذه هي الأسئلةُ الثلاثةُ التي يُفتَح السجلّ
                  من أجلها. والكيانُ والفعلُ تفصيلٌ يأتي بعدها لمن أراده. */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {/* Person — the whole point: one user's own history */}
                <div>
                  <label className="block text-slate-600 text-xs font-medium mb-1.5">{ar ? 'الشخص' : 'Person'}</label>
                  <SearchableSelect
                    value={userFilter}
                    onChange={setUserFilter}
                    placeholder={ar ? 'كل المستخدمين' : 'All users'}
                    searchPlaceholder={ar ? 'ابحث بالاسم أو الإيميل…' : 'Search name or email…'}
                    options={[
                      { value: '', label: ar ? 'كل المستخدمين' : 'All users' },
                      ...options.users.map((u) => ({
                        value: u._id,
                        label: (`${u.firstName} ${u.lastName}`.trim() || u.email)
                          + (u.deleted ? (ar ? ' (حساب محذوف)' : ' (deleted account)') : ''),
                        hint: `${u.email ? `${u.email} · ` : ''}${u.count.toLocaleString()}`,
                      })),
                      // النظامُ فاعلٌ أيضًا (الإقفالُ التلقائيّ)، وقيودُه لم يكن
                      // إليها سبيلٌ من هذه القائمة.
                      ...(options.systemCount || userFilter === 'system' ? [{
                        value: 'system', label: ar ? 'النظام (إجراءات تلقائية)' : 'System (automatic)',
                        hint: options.systemCount.toLocaleString(),
                      }] : []),
                      ...(options.unnamedCount || userFilter === 'unnamed' ? [{
                        value: 'unnamed', label: ar ? 'حسابات محذوفة لم يُسجَّل اسمها' : 'Deleted accounts with no recorded name',
                        hint: options.unnamedCount.toLocaleString(),
                      }] : []),
                    ]}
                  />
                </div>

                {/* ── الفرع ────────────────────────────────────────────────
                    القيدُ لا يحمل فرعًا، ولا ينبغي: الفعلُ قد يقع على شيءٍ لا
                    فرعَ له. لكنّ **فاعلَه** له فرع، وهو المقصود بالسؤال. */}
                <div>
                  <label className="block text-slate-600 text-xs font-medium mb-1.5">{ar ? 'الفرع' : 'Branch'}</label>
                  <SearchableSelect
                    value={branchFilter}
                    onChange={setBranchFilter}
                    placeholder={ar ? 'كل الفروع' : 'All branches'}
                    options={[
                      { value: '', label: ar ? 'كل الفروع' : 'All branches' },
                      ...branches.map((b) => ({ value: b._id, label: b.name })),
                      // الإدارةُ ومديرو النظام لا فرعَ لهم، ولهم نصفُ السجلّ.
                      { value: 'none', label: ar ? 'بلا فرع (الإدارة العامة)' : 'No branch (head office)' },
                    ]}
                  />
                  <p className="mt-1 text-[10.5px] text-slate-400">
                    {ar ? 'فرع مَن قام بالإجراء، لا فرع السجلّ' : 'the branch of whoever acted, not of the record'}
                  </p>
                </div>

                {/* ── القسم ────────────────────────────────────────────────
                    ومعه عددُ قيوده: قائمةٌ بلا أعداد تُقرأ كلُّها سواء، فيُفتَح
                    قسمٌ فيه أربعةُ قيودٍ بحثًا عمّا وقع في قسمٍ فيه أربعةُ آلاف. */}
                <div>
                  <label className="block text-slate-600 text-xs font-medium mb-1.5">{ar ? 'القسم' : 'Section'}</label>
                  <SearchableSelect
                    value={sectionFilter}
                    onChange={changeSection}
                    placeholder={ar ? 'كل الأقسام' : 'All sections'}
                    options={[
                      { value: '', label: ar ? 'كل الأقسام' : 'All sections' },
                      ...sections.map((sec) => ({
                        value: sec.key,
                        label: ar ? sec.ar : sec.en,
                        hint: `${sec.count.toLocaleString()}`,
                      })),
                    ]}
                  />
                </div>
              </div>

              {/* ── الصفُّ الثاني: التفصيل داخل القسم ───────────────────────── */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Entity Type — the entities that actually occur in the log */}
                <div>
                  <label className="block text-slate-600 text-xs font-medium mb-1.5">
                    {T.entity}
                    {sectionFilter && (
                      <span className="font-normal text-slate-400">
                        {' '}— {ar ? 'داخل القسم المختار' : 'within the chosen section'}
                      </span>
                    )}
                  </label>
                  <SearchableSelect
                    value={entityFilter}
                    onChange={changeEntity}
                    placeholder={ar ? 'كل الأنواع' : 'All entities'}
                    options={[
                      { value: '', label: ar ? 'كل الأنواع' : 'All entities' },
                      ...entityOptions.map((e) => ({
                        value: e.key,
                        label: e.label,
                        hint: `${e.count.toLocaleString()}`,
                      })),
                    ]}
                  />
                </div>

                {/* ── الإجراء — داخل القسم والكيان المختارَين ─────────────── */}
                <div>
                  <label className="block text-slate-600 text-xs font-medium mb-1.5">
                    {T.action}
                    {(sectionFilter || entityFilter) && (
                      <span className="font-normal text-slate-400">
                        {' '}— {ar ? 'ضمن ما اختير أعلاه' : 'within the selection above'}
                      </span>
                    )}
                  </label>
                  <SearchableSelect
                    value={actionFilter}
                    onChange={setActionFilter}
                    placeholder={ar ? 'كل الإجراءات' : 'All actions'}
                    searchPlaceholder={ar ? 'ابحث في الإجراءات…' : 'Search actions…'}
                    options={[
                      { value: '', label: ar ? 'كل الإجراءات' : 'All actions' },
                      ...actions.map((a) => ({ value: a.key, label: a.label, hint: a.count.toLocaleString() })),
                    ]}
                  />
                </div>
              </div>

              {/* ── الزمن: يومٌ بعينه، أو مدّة ─────────────────────────────── */}
              <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-3 space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-slate-600 text-xs font-medium">{ar ? 'الزمن' : 'When'}</span>
                  <div className="flex rounded-lg border border-slate-200 bg-white p-0.5">
                    {([
                      ['day', ar ? 'يوم بعينه' : 'A single day'],
                      ['range', ar ? 'فترة' : 'A period'],
                    ] as const).map(([k, lbl]) => (
                      <button key={k} type="button" onClick={() => changeDateMode(k)}
                        className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                          dateMode === k ? 'bg-[#f37121] text-white' : 'text-slate-600 hover:text-slate-900'}`}>
                        {lbl}
                      </button>
                    ))}
                  </div>

                  {dateMode === 'day' ? (
                    <div className="relative">
                      <Calendar className="w-3.5 h-3.5 absolute start-3 top-1/2 -translate-y-1/2 text-slate-500" />
                      <input type="date" value={day} onChange={(e) => setDay(e.target.value)}
                        aria-label={ar ? 'اليوم' : 'Day'}
                        className="ps-9 pe-3 py-2 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50 [color-scheme:light]" />
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <div className="relative">
                        <Calendar className="w-3.5 h-3.5 absolute start-3 top-1/2 -translate-y-1/2 text-slate-500" />
                        <input type="date" value={dateFrom} max={dateTo || undefined} onChange={(e) => setDateFrom(e.target.value)}
                          aria-label={T.from}
                          className="ps-9 pe-3 py-2 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50 [color-scheme:light]" />
                      </div>
                      <span className="text-slate-400 text-sm">→</span>
                      <div className="relative">
                        <Calendar className="w-3.5 h-3.5 absolute start-3 top-1/2 -translate-y-1/2 text-slate-500" />
                        <input type="date" value={dateTo} min={dateFrom || undefined} onChange={(e) => setDateTo(e.target.value)}
                          aria-label={T.to}
                          className="ps-9 pe-3 py-2 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50 [color-scheme:light]" />
                      </div>
                    </div>
                  )}
                </div>

                {/* اختصاراتُ ما يُسأل عنه فعلًا — «اليوم» و«أمس» أكثرُه. */}
                <div className="flex flex-wrap gap-1.5">
                  {([
                    [ar ? 'اليوم' : 'Today', () => setQuickDay(0)],
                    [ar ? 'أمس' : 'Yesterday', () => setQuickDay(1)],
                    [ar ? 'آخر ٧ أيام' : 'Last 7 days', () => setQuickRange(7)],
                    [ar ? 'آخر ٣٠ يومًا' : 'Last 30 days', () => setQuickRange(30)],
                    [ar ? 'كل الوقت' : 'All time', () => { setDay(''); setDateFrom(''); setDateTo(''); }],
                  ] as [string, () => void][]).map(([lbl, fn]) => (
                    <button key={lbl} type="button" onClick={fn}
                      className="px-2.5 py-1 rounded-lg border border-slate-200 bg-white text-slate-600 text-[11.5px] font-medium hover:border-[#f37121] hover:text-[#f37121] transition-colors">
                      {lbl}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Audit Logs Table */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full">
            <thead>
              <tr className="bg-slate-900 border-b border-slate-200">
                <th className="px-4 py-3 text-start text-xs font-semibold text-slate-300 uppercase tracking-wider w-8" />
                <th className="px-4 py-3 text-start text-xs font-semibold text-slate-300 uppercase tracking-wider">{T.date}</th>
                <th className="px-4 py-3 text-start text-xs font-semibold text-slate-300 uppercase tracking-wider">{T.user}</th>
                <th className="px-4 py-3 text-start text-xs font-semibold text-slate-300 uppercase tracking-wider">{T.action}</th>
                {/* القسمُ عمودٌ لا فلترٌ فقط: من يقرأ صفًّا يحتاج أن يعرف أين
                    وقع قبل أن يعرف على أيّ نموذجٍ وقع. */}
                <th className="px-4 py-3 text-start text-xs font-semibold text-slate-300 uppercase tracking-wider">{ar ? 'القسم' : 'Section'}</th>
                <th className="px-4 py-3 text-start text-xs font-semibold text-slate-300 uppercase tracking-wider">{T.entity}</th>
                <th className="px-4 py-3 text-start text-xs font-semibold text-slate-300 uppercase tracking-wider">{T.details}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {logs.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-slate-800 text-sm">
                    {T.noLogs}
                  </td>
                </tr>
              ) : (
                logs.map((log) => (
                  <React.Fragment key={log._id}>
                    <tr
                      onClick={() => (log.hasDetails ? toggleRow(log._id) : undefined)}
                      className={`bg-slate-50 hover:bg-slate-100 transition-colors ${log.hasDetails ? 'cursor-pointer' : ''}`}
                    >
                      <td className="px-4 py-3 text-sm text-slate-800">
                        {log.hasDetails && (
                          expandedRow === log._id ? (
                            <ChevronUp className="w-4 h-4" />
                          ) : (
                            <ChevronDown className="w-4 h-4" />
                          )
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm">
                        <div>
                          <span className="text-slate-700 text-xs">{formatTimestamp(log.createdAt)}</span>
                          <span className="text-slate-500 text-[11px] block">{formatRelativeTime(log.createdAt)}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm">
                        {log.user ? (
                          <div>
                            {/* Clicking a name filters straight to that person's history */}
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); filterByActor(log); }}
                              className="text-slate-900 text-xs font-medium hover:text-[#f37121] hover:underline text-start"
                              title={ar ? 'عرض كل نشاط هذا المستخدم' : "Show this user's full history"}
                            >
                              {log.user.firstName} {log.user.lastName}
                            </button>
                            {/* حسابٌ أُزيل: الفعلُ فعلُ إنسانٍ وإن ذهب حسابُه —
                                وتركُه بلا علامةٍ يجعل الاسمَ يبدو حسابًا قائمًا. */}
                            {log.user.deleted && (
                              <span className="ms-1 text-[10px] text-amber-600">{ar ? '(حساب محذوف)' : '(deleted account)'}</span>
                            )}
                            <span className="text-slate-700 text-xs block">{log.user.email}</span>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); setUserFilter('system'); setShowFilters(true); }}
                            className="text-slate-700 text-xs hover:text-[#f37121] hover:underline"
                          >
                            {txx.system}
                          </button>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm">
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${getActionColor(log.action)}`}>
                          {log.actionLabel}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm">
                        {/* الضغطُ يفلتر على القسم — كما يفعل الاسمُ مع الشخص. */}
                        <button type="button"
                          onClick={(e) => { e.stopPropagation(); changeSection(log.section || ''); setShowFilters(true); }}
                          className="text-xs font-medium text-slate-600 hover:text-[#f37121] hover:underline text-start whitespace-nowrap">
                          {log.sectionLabel}
                        </button>
                      </td>
                      <td className="px-4 py-3 text-sm">
                        {/* السجلُّ باسمه لا بمعرّفه: «كشف 89400» يُقرأ، وأربعةٌ
                            وعشرون حرفًا لا تُقرأ. */}
                        <span className="font-medium text-xs text-slate-600">{log.entityLabel}</span>
                        {log.subject && (
                          <span className="text-slate-900 text-xs block max-w-[200px] break-words" dir="auto">
                            {log.subject}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-800 max-w-[420px]">
                        <span className="line-clamp-3 break-words leading-relaxed" title={log.summary || ''} dir="auto">
                          {log.summary || '—'}
                        </span>
                      </td>
                    </tr>
                    <AnimatePresence>
                      {expandedRow === log._id && log.hasDetails && (
                        <tr>
                          <td colSpan={7}>
                            <motion.div
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: 'auto', opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              transition={{ duration: 0.2 }}
                              className="overflow-hidden"
                            >
                              <div className="px-6 py-4 bg-slate-100 border-t border-slate-200/70">
                                <h4 className="text-slate-900 text-xs font-semibold uppercase tracking-wider mb-3">{T.changes}</h4>
                                <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 overflow-x-auto">
                                  {renderDetail(log)}
                                </div>
                                {log.ipAddress && (
                                  <p className="text-slate-700 text-xs mt-3">{T.ipAddress}: {log.ipAddress}</p>
                                )}
                              </div>
                            </motion.div>
                          </td>
                        </tr>
                      )}
                    </AnimatePresence>
                  </React.Fragment>
                ))
              )}
            </tbody>
          </table>
        </div>
      </motion.div>

      {/* Pagination */}
      {pagination.pages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-slate-500 text-sm">
            {T.page} {pagination.page} {T.of} {pagination.pages}
            <span className="text-slate-500"> &middot; {pagination.total.toLocaleString()}</span>
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => handlePageChange(pagination.page - 1)}
              disabled={pagination.page <= 1}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm bg-white border border-slate-200 text-slate-700 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
              {T.previous}
            </button>
            {/* Page number buttons */}
            <div className="hidden sm:flex items-center gap-1">
              {Array.from({ length: Math.min(5, pagination.pages) }, (_, i) => {
                let page: number;
                if (pagination.pages <= 5) {
                  page = i + 1;
                } else if (pagination.page <= 3) {
                  page = i + 1;
                } else if (pagination.page >= pagination.pages - 2) {
                  page = pagination.pages - 4 + i;
                } else {
                  page = pagination.page - 2 + i;
                }
                return (
                  <button
                    key={page}
                    type="button"
                    onClick={() => handlePageChange(page)}
                    className={`w-8 h-8 rounded-lg text-sm font-medium transition-colors ${
                      page === pagination.page
                        ? 'bg-[#f37121] text-white'
                        : 'bg-white border border-slate-200 text-slate-500 hover:text-slate-900 hover:bg-slate-100'
                    }`}
                  >
                    {page}
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              onClick={() => handlePageChange(pagination.page + 1)}
              disabled={pagination.page >= pagination.pages}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm bg-white border border-slate-200 text-slate-700 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {T.next}
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Loading overlay for pagination */}
      {loading && (
        <div className="fixed inset-0 bg-black/20 z-40 flex items-center justify-center pointer-events-none">
          <div className="w-8 h-8 border-2 border-[#f37121] border-t-transparent rounded-full animate-spin" />
        </div>
      )}
    </div>
  );
}
