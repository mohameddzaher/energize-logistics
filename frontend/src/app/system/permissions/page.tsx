'use client';
/**
 * الأدوارُ والصلاحيّات — من هنا يُقرَّر مَن يرى ماذا.
 *
 * ── طبقتان لا واحدة ─────────────────────────────────────────────────────────
 * كانت الشاشةُ تسأل سؤالًا واحدًا: أيقرأ هذا الدورُ هذا القسمَ أم يكتب فيه؟ وهو
 * صحيحٌ وناقص — قسمُ المركبات تسعَ عشرةَ صفحة، ومن مُنح «تعديل» أخذها كلَّها:
 * سجلَّ المركبات وبترو آب وإعداداتِ القسم وتقييمَ الأداء معًا.
 *
 * فصار للسؤال وجهان:
 *   • **القسم** → ممنوع / مشاهدة / تعديل. يقرّر ماذا يُفعَل: قراءةٌ أم كتابة.
 *   • **الصفحة** → مفتوحةٌ أو مغلقة، داخلَ ما منحه القسم. تقرّر أين.
 *
 * والصفحةُ لا تتجاوز قسمَها أبدًا: من لا يملك القسمَ لا تُفتَح له صفحةٌ منه.
 *
 * ── وكلاهما يحرس البيانات ────────────────────────────────────────────────────
 * كانت صلاحيّةُ الصفحة تُخفي الشاشةَ ولا تمنع نقاطَ الـ API، فمن يعرف النقطةَ
 * ينادِيها من خارج الشاشة. صار الخادمُ يعرف أيَّ الصفحات تنادي كلَّ نقطة
 * (`config/pageApis`، مستخرجةً من الشيفرة): فإن كانت كلُّها مغلقةً على الدور
 * رُدَّت النقطةُ ٤٠٣.
 *
 * ── وأنواعُ المستخدمين تُصنَع من هنا ──────────────────────────────────────────
 * الهيكلُ الوظيفيُّ في الشيفرة (مديرٌ وموظّفٌ لكلّ قسم) لا يسع كلَّ حالة: يجيء
 * من يحتاج «مراجعًا يرى المالَ ولا يكتب فيه». فيُصنَع نوعُه بضغطة، ويُولَد لا
 * يملك شيئًا حتّى يُمنَح صراحةً.
 */
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useDialog } from '@/components/system/DialogProvider';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import api from '@/lib/api';
import {
  ShieldCheck, Check, Eye, Ban, Save, Loader2, ChevronDown, ChevronLeft,
  UserPlus, Trash2, Search, X, Home, Layers, Lock,
} from 'lucide-react';
import { getPermissionsTranslations, getSectionLabel } from '@/lib/translations';
import { Spinner, PageHeader, Modal, Field, TextInput, PrimaryButton } from '@/components/hr/HRKit';

type Access = 'none' | 'view' | 'edit';
interface CatalogPage { key: string; section: string; ar: string; en: string }
interface RoleLabel { ar: string; en: string; custom: boolean; description: string }
interface Payload {
  sections: string[];
  roles: string[];
  roleLabels: Record<string, RoleLabel>;
  accessLevels: Access[];
  catalog: CatalogPage[];
  permissions: Record<string, Record<string, Access>>;
  pages: Record<string, Record<string, boolean>>;
  explicit: Record<string, { pages: Record<string, boolean>; homePage: string }>;
}

const LEVELS: { key: Access; icon: any; en: string; ar: string; active: string }[] = [
  { key: 'none', icon: Ban, en: 'None', ar: 'ممنوع', active: 'bg-red-500 text-white border-red-500' },
  { key: 'view', icon: Eye, en: 'View', ar: 'مشاهدة', active: 'bg-amber-500 text-white border-amber-500' },
  { key: 'edit', icon: Check, en: 'Edit', ar: 'تعديل', active: 'bg-green-600 text-white border-green-600' },
];

const fold = (x: string) => x.toLowerCase().replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه');

export default function PermissionsPage() {
  const { notify, confirm } = useDialog();
  const { user, refreshUser } = useAuth();
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const t = (a: string, e: string) => (ar ? a : e);
  const tx = getPermissionsTranslations(lang);
  const isSuper = ['super_admin', 'it_manager', 'it_specialist'].includes(user?.role || '');
  // صنعُ الأنواع لصاحب النظام وحدَه — نوعٌ جديدٌ بابٌ جديدٌ في البيت.
  const canMakeRoles = user?.role === 'super_admin';

  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedRole, setSelectedRole] = useState<string>('');
  const [roleSearch, setRoleSearch] = useState('');

  // النسخةُ العاملة للدور المختار.
  const [draft, setDraft] = useState<Record<string, Access>>({});
  const [pageDraft, setPageDraft] = useState<Record<string, boolean>>({});
  const [homePage, setHomePage] = useState('');
  const [openSections, setOpenSections] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);

  const [newRoleOpen, setNewRoleOpen] = useState(false);
  const [newRole, setNewRole] = useState({ key: '', nameAr: '', nameEn: '', description: '' });
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await api.get<Payload>('/api/admin/permissions');
      setData(d);
      setSelectedRole((cur) => cur || d.roles[0] || '');
    } catch (e: any) { notify(e?.message || t('تعذّر التحميل', 'Could not load'), 'error'); }
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { load(); }, [load]);

  /**
   * ── ولا تُمسَح شهادةُ الحفظ باليد التي كتبتها ───────────────────────────────
   *
   * هذا الأثرُ يُعيد بذرَ النسخة العاملة كلّما تغيّر `data` — وهو صحيحٌ عند
   * تغيير الدور أو إعادة التحميل. لكنّ `save()` يكتب في `data` أيضًا، فكان
   * الأثرُ يُطلَق بعد كلّ حفظٍ ناجحٍ ويُصفّر `savedFlash` في نفس الرسمة: يُضغَط
   * «حفظ» فلا تظهر «تم الحفظ» أبدًا، ويخبو الزرُّ لأنّ `dirty` صارت كذبًا —
   * فيُقرأ أنّ الشاشةَ لم تستجب، ويُعاد الضغطُ مرّةً ومرّتين.
   *
   * فالتصفيرُ مشروطٌ بتغيُّر الدور لا بتغيُّر البيانات: الشهادةُ تبقى حتى
   * يُنتقَل إلى دورٍ آخر أو يُعدَّل شيءٌ جديد.
   */
  const seededFor = useRef('');
  useEffect(() => {
    if (!data || !selectedRole) return;
    setDraft({ ...(data.permissions[selectedRole] || {}) });
    setPageDraft({ ...(data.pages[selectedRole] || {}) });
    setHomePage(data.explicit?.[selectedRole]?.homePage || '');
    if (seededFor.current !== selectedRole) {
      seededFor.current = selectedRole;
      setSavedFlash(false);
    }
  }, [data, selectedRole]);

  const roleLabel = useCallback((r: string) => {
    const l = data?.roleLabels?.[r];
    return l ? (ar ? l.ar : l.en) : r;
  }, [data, ar]);

  const original = useMemo(() => (data && selectedRole ? data.permissions[selectedRole] || {} : {}), [data, selectedRole]);
  const originalPages = useMemo(() => (data && selectedRole ? data.pages[selectedRole] || {} : {}), [data, selectedRole]);
  const originalHome = data?.explicit?.[selectedRole]?.homePage || '';

  const dirty = useMemo(() => {
    if (!data) return false;
    if (data.sections.some((s) => (draft[s] || 'none') !== (original[s] || 'none'))) return true;
    if (data.catalog.some((p) => !!pageDraft[p.key] !== !!originalPages[p.key])) return true;
    return homePage !== originalHome;
  }, [data, draft, original, pageDraft, originalPages, homePage, originalHome]);

  // ── تغييرُ القسم يجرّ صفحاتِه معه ────────────────────────────────────────────
  // من يمنع قسمًا يقصد منعَ شاشاته؛ ومن يمنحه يقصد فتحَها. وترْكُ الصفحات على
  // حالها يجعل الضغطةَ الواحدة تبدو بلا أثر، فتُضغَط ثانيةً وثالثة.
  const setLevel = (section: string, level: Access) => {
    setDraft((d) => ({ ...d, [section]: level }));
    const on = level !== 'none';
    setPageDraft((p) => {
      const next = { ...p };
      (data?.catalog || []).filter((x) => x.section === section).forEach((x) => { next[x.key] = on; });
      return next;
    });
  };

  const setAll = (level: Access) => {
    if (!data) return;
    const next: Record<string, Access> = {};
    data.sections.forEach((s) => { next[s] = level; });
    setDraft(next);
    const on = level !== 'none';
    const np: Record<string, boolean> = {};
    data.catalog.forEach((p) => { np[p.key] = data.sections.includes(p.section) ? on : !!pageDraft[p.key]; });
    setPageDraft(np);
  };

  const togglePage = (key: string) => setPageDraft((p) => ({ ...p, [key]: !p[key] }));

  /**
   * ── والمربّعُ المعطَّلُ كان بابًا مسدودًا بلا لافتة ──────────────────────────
   *
   * صفحةٌ في قسمٍ غيرِ ممنوحٍ لا تُفتَح مهما أُشِّرت — والقاعدةُ صحيحة. وكان
   * مربّعُها `disabled`: يُضغَط فلا يحدث شيء، ولا سطرَ يقول لماذا. فمن أراد أن
   * يُعطي متدرّبًا شاشةً واحدةً في قسمٍ آخر ضغط عليها عشرَ مرّاتٍ ثمّ قال
   * «الصلاحيّاتُ لا تُحفَظ» — وهي لم تُطلَب أصلًا.
   *
   * فالضغطةُ الآن **تفعل المقصود**: تمنح القسمَ «مشاهدة» (لا تعديل)، وتفتح
   * هذه الصفحةَ وحدَها فيه وتُغلق بقيّتَه. وهو عينُ ما كان يُفعَل بثلاث خطواتٍ
   * يدويّة، ويُقال في سطرٍ تحت القائمة.
   */
  const openOnePage = (section: string, key: string) => {
    setDraft((d) => ({ ...d, [section]: 'view' }));
    setPageDraft((p) => {
      const next = { ...p };
      (data?.catalog || []).filter((x) => x.section === section).forEach((x) => { next[x.key] = x.key === key; });
      return next;
    });
    notify(ar
      ? `مُنح القسمُ «${getSectionLabel(section, lang)}» مشاهدةً، وفُتحت هذه الصفحةُ وحدَها فيه — اضغط «حفظ» ليسري.`
      : `Granted “${getSectionLabel(section, lang)}” view access with only this page open — press Save to apply.`, 'info');
  };
  const setSectionPages = (section: string, on: boolean) => {
    setPageDraft((p) => {
      const next = { ...p };
      (data?.catalog || []).filter((x) => x.section === section).forEach((x) => { next[x.key] = on; });
      return next;
    });
  };

  const toggleOpen = (s: string) => setOpenSections((prev) => {
    const n = new Set(prev); n.has(s) ? n.delete(s) : n.add(s); return n;
  });

  const save = async () => {
    if (!selectedRole || !data) return;
    setSaving(true);
    try {
      // ── وتُرسَل الخريطةُ كما تُرى، ويختصرها مَن يملك القاعدة ────────────────
      // ما يوافق قسمَه لا يُكتب في القاعدة (وإلّا صار تغييرُ قسمٍ بعد اليوم بلا
      // أثرٍ على صفحاته)، لكنّ **حسابَ** «ما يوافق قسمَه» كان هنا، وكان يقول
      // عن قسمٍ غيرِ مُدارٍ بالمصفوفة — ملفي، إجازاتي، طلباتي، الإعدادات،
      // مركزُ التقارير — إنّه مفتوحٌ للجميع، والخادمُ يقول إنّه مغلقٌ على
      // الدور المصنوع. فمن أشّر لمتدرّبٍ على «ملفي» لم تُرسَل تأشيرتُه أصلًا:
      // تُقال «حُفِظ» ثمّ تختفي العلامةُ ولا تُفتَح الصفحة.
      //
      // فلم يبقَ للشاشة رأيٌ في القاعدة: تُرسَل الخريطةُ كاملةً مع `pagesAll`،
      // ويختصرها الخادمُ بالدالّة نفسِها التي يقرأ بها عند المنح.
      const pages: Record<string, boolean> = {};
      data.catalog.forEach((p) => { pages[p.key] = !!pageDraft[p.key]; });
      const res = await api.put<{ role: string; permissions: Record<string, Access>; pages: Record<string, boolean> }>(
        `/api/admin/permissions/${selectedRole}`,
        { sections: draft, pages, pagesAll: true, homePage },
      );

      // ── والحفظُ يُثبت نفسَه بما عاد من الخادم ─────────────────────────────
      // ما يُعرَض بعد الحفظ هو **الصلاحيّةُ الفعليّةُ** التي ردّها الخادمُ لا
      // ما أرسلناه: لو اختلف حرفٌ (قاعدةٌ في الخادم تمنع، أو صفحةٌ لا تتجاوز
      // قسمَها) ظهر الاختلافُ في الحال بدل أن يُقرأ «حُفظ» ثمّ يُفتَح الغدَ
      // فيُرى غيرُه. وما يختلف يُقال صريحًا.
      const asked = Object.entries(draft).filter(([k]) => (data.sections || []).includes(k));
      const differ = asked.filter(([k, v]) => (res.permissions?.[k] || 'none') !== (v || 'none'));
      // ما صار ساريًا فعلًا — من ردّ الخادم لا من النسخة العاملة.
      const grantedNow = Object.values(res.permissions || {}).filter((v) => v !== 'none').length;
      const pagesNow = Object.values(res.pages || {}).filter(Boolean).length;

      setData((prev) => (prev ? {
        ...prev,
        permissions: { ...prev.permissions, [selectedRole]: res.permissions },
        pages: { ...prev.pages, [selectedRole]: res.pages },
        // و«الصريح» صار قرارَ الخادم لا قرارَنا — تُقرأ صفحةُ الدخول وحدَها
        // منه هنا، والصفحاتُ الصريحةُ تُقرأ في التحميل التالي.
        explicit: { ...prev.explicit, [selectedRole]: { pages: prev.explicit?.[selectedRole]?.pages || {}, homePage } },
      } : prev));
      setSavedFlash(true);

      if (differ.length) {
        notify(ar
          ? `حُفِظ، وفي ${differ.length} قسمًا اختلفت النتيجةُ عمّا طُلب: ${differ.map(([k]) => getSectionLabel(k, lang)).join('، ')}`
          : `Saved, but ${differ.length} section(s) came back different: ${differ.map(([k]) => getSectionLabel(k, lang)).join(', ')}`, 'error');
      } else {
        notify(ar
          ? `حُفِظت صلاحيّاتُ «${roleLabel(selectedRole)}» — ${grantedNow} قسمًا و${pagesNow} صفحة`
          : `Saved “${roleLabel(selectedRole)}” — ${grantedNow} sections, ${pagesNow} pages`, 'success');
      }
      if (user?.role === selectedRole) refreshUser();
    } catch (e: any) { notify(e?.message || t('تعذّر الحفظ', 'Could not save'), 'error'); }
    setSaving(false);
  };

  const createRole = async () => {
    setCreating(true);
    try {
      await api.post('/api/admin/roles', newRole);
      notify(t(`صُنع النوع «${newRole.nameAr}» — امنحه أقسامَه وصفحاتِه الآن`, 'Role created — grant its sections and pages now'), 'success');
      setNewRoleOpen(false);
      const key = newRole.key;
      setNewRole({ key: '', nameAr: '', nameEn: '', description: '' });
      const d = await api.get<Payload>('/api/admin/permissions');
      setData(d);
      setSelectedRole(key);
    } catch (e: any) { notify(e?.message || t('تعذّر الإنشاء', 'Could not create'), 'error'); }
    setCreating(false);
  };

  const removeRole = async (key: string) => {
    if (!(await confirm(t(`حذف النوع «${roleLabel(key)}»؟`, `Delete role “${roleLabel(key)}”?`)))) return;
    try {
      await api.delete(`/api/admin/roles/${key}`);
      const d = await api.get<Payload>('/api/admin/permissions');
      setData(d);
      setSelectedRole(d.roles[0] || '');
    } catch (e: any) { notify(e?.message || t('تعذّر الحذف', 'Could not delete'), 'error'); }
  };

  if (!isSuper) return <div className="text-slate-500 p-8">{tx.notAuthorized}</div>;
  if (loading) return <Spinner />;

  const catalog = data?.catalog || [];
  // أقسامُ الفهرس بترتيب ظهورها، والمُدارةُ أوّلًا — تلك هي التي تحرس الـ API.
  const managed = data?.sections || [];
  const unmanaged = [...new Set(catalog.map((p) => p.section))].filter((s) => !managed.includes(s));
  const allSections = [...managed, ...unmanaged];

  const q = fold(roleSearch.trim());
  const shownRoles = (data?.roles || []).filter((r) => !q || fold(`${r} ${roleLabel(r)}`).includes(q));

  const grantedPages = catalog.filter((p) => pageDraft[p.key]).length;

  return (
    <div className="space-y-5" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader icon={<ShieldCheck className="w-5 h-5" />} title={tx.pageTitle}>
        {canMakeRoles && (
          <PrimaryButton onClick={() => setNewRoleOpen(true)}>
            <UserPlus className="w-4 h-4" /> {t('نوع مستخدم جديد', 'New user type')}
          </PrimaryButton>
        )}
      </PageHeader>

      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-5 items-start">
        {/* ── الأدوار ──────────────────────────────────────────────────────── */}
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
          <div className="px-3 py-2.5 border-b border-slate-200">
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute top-1/2 -translate-y-1/2 start-2.5" />
              <input value={roleSearch} onChange={(e) => setRoleSearch(e.target.value)}
                placeholder={t('ابحث عن دور…', 'Search a role…')}
                className="w-full ps-8 pe-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/40" />
            </div>
          </div>
          <div className="max-h-[65vh] overflow-y-auto p-2 space-y-1">
            {shownRoles.map((r) => {
              const active = r === selectedRole;
              const custom = data?.roleLabels?.[r]?.custom;
              return (
                <button key={r} type="button" onClick={() => setSelectedRole(r)}
                  className={`w-full text-start px-3 py-2 rounded-lg text-sm transition-colors flex items-center gap-2 ${active ? 'bg-[#f37121] text-white font-medium' : 'text-slate-700 hover:bg-slate-100'}`}>
                  <span className="flex-1 truncate">{roleLabel(r)}</span>
                  {/* المصنوعُ يُعلَّم: من يقرأ القائمةَ يجب أن يعرف ما صنعه بنفسه
                      عمّا هو جزءٌ من هيكل الشركة. */}
                  {custom && (
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full shrink-0 ${active ? 'bg-white/25' : 'bg-[#f37121]/10 text-[#f37121]'}`}>
                      {t('مُصنَّع', 'custom')}
                    </span>
                  )}
                </button>
              );
            })}
            {!shownRoles.length && <p className="text-slate-400 text-sm text-center py-6">{t('لا نتائج', 'No matches')}</p>}
          </div>
        </div>

        {/* ── القسم والصفحات ──────────────────────────────────────────────── */}
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-slate-900 font-bold">{selectedRole ? roleLabel(selectedRole) : tx.sectionsTitle}</p>
              <p className="text-[11.5px] text-slate-500 mt-0.5">
                {t(`${grantedPages} صفحة مفتوحة من ${catalog.length}`, `${grantedPages} of ${catalog.length} pages open`)}
                {data?.roleLabels?.[selectedRole]?.description ? ` · ${data.roleLabels[selectedRole].description}` : ''}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {data?.roleLabels?.[selectedRole]?.custom && canMakeRoles && (
                <button type="button" onClick={() => removeRole(selectedRole)}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50" title={t('حذف النوع', 'Delete role')}>
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
              <button type="button" onClick={() => setAll('none')} className="text-xs px-2 py-1 rounded-md border border-slate-200 text-slate-600 hover:bg-slate-100">{tx.allNone}</button>
              <button type="button" onClick={() => setAll('view')} className="text-xs px-2 py-1 rounded-md border border-slate-200 text-slate-600 hover:bg-slate-100">{tx.allView}</button>
              <button type="button" onClick={() => setAll('edit')} className="text-xs px-2 py-1 rounded-md border border-slate-200 text-slate-600 hover:bg-slate-100">{tx.allEdit}</button>
            </div>
          </div>

          {!selectedRole ? (
            <p className="text-slate-500 text-sm p-8 text-center">{tx.pickRole}</p>
          ) : (
            <div className="divide-y divide-slate-100 max-h-[62vh] overflow-y-auto">
              {allSections.map((section) => {
                const pages = catalog.filter((p) => p.section === section);
                const isManaged = managed.includes(section);
                const cur = draft[section] || 'none';
                const open = openSections.has(section);
                const on = pages.filter((p) => pageDraft[p.key]).length;
                return (
                  <div key={section}>
                    <div className="flex items-center justify-between gap-3 px-4 py-3">
                      <button type="button" onClick={() => toggleOpen(section)}
                        className="flex items-center gap-2 min-w-0 flex-1 text-start group">
                        {open ? <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" />
                          : <ChevronLeft className={`w-4 h-4 text-slate-400 shrink-0 ${isRTL ? '' : 'rotate-180'}`} />}
                        <span className="text-slate-800 text-sm font-semibold truncate group-hover:text-[#f37121]">{getSectionLabel(section, lang)}</span>
                        <span className={`text-[11px] shrink-0 tabular-nums ${on ? 'text-slate-400' : 'text-slate-300'}`}>
                          {on}/{pages.length}
                        </span>
                      </button>
                      {isManaged ? (
                        <div className="inline-flex rounded-lg border border-slate-200 overflow-hidden shrink-0">
                          {LEVELS.map((lv) => {
                            const Icon = lv.icon;
                            const sel = cur === lv.key;
                            return (
                              <button key={lv.key} type="button" onClick={() => setLevel(section, lv.key)}
                                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border-e last:border-e-0 border-slate-200 transition-colors ${sel ? lv.active : 'bg-white text-slate-500 hover:bg-slate-50'}`}>
                                <Icon className="w-3.5 h-3.5" /> {ar ? lv.ar : lv.en}
                              </button>
                            );
                          })}
                        </div>
                      ) : (
                        // ── أقسامٌ لا تحرسها المصفوفة ────────────────────────
                        // الرئيسيّة والأدوات والإدارة والخدمة الذاتيّة والبوّابة
                        // تحرسها قوائمُ الأدوار في الشيفرة. فلا يُعرَض لها
                        // «مشاهدة/تعديل» يوهم بأنّه يفعل شيئًا — وتبقى صفحاتُها
                        // تُفتَح وتُغلَق، وذلك يعمل.
                        <span className="text-[11px] text-slate-400 shrink-0">{t('بالصفحات فقط', 'pages only')}</span>
                      )}
                    </div>

                    {open && (
                      <div className="px-4 pb-4 -mt-1">
                        <div className="flex items-center gap-2 mb-2 flex-wrap">
                          <button type="button" onClick={() => setSectionPages(section, true)}
                            className="text-[11px] px-2 py-1 rounded-md border border-slate-200 text-slate-600 hover:bg-slate-100">{t('فتح الكل', 'Open all')}</button>
                          <button type="button" onClick={() => setSectionPages(section, false)}
                            className="text-[11px] px-2 py-1 rounded-md border border-slate-200 text-slate-600 hover:bg-slate-100">{t('إغلاق الكل', 'Close all')}</button>
                          {isManaged && cur === 'none' && (
                            <span className="text-[11px] text-amber-700">
                              {t('القسمُ غيرُ ممنوح — اضغط أيّ صفحةٍ لمنحه «مشاهدة» وفتحِها وحدَها.',
                                 'Section not granted — click a page to grant view and open just it.')}
                            </span>
                          )}
                          {/* ── وما تفعله التأشيرةُ هنا يُقال، لا يُترك يُكتشَف ──
                              شاشاتُ هذه الأقسام يحرسها سطرُ أدوارٍ في كلّ مسار، لا
                              قسمٌ يُمنَح. فالتأشيرةُ تفتحها **للمشاهدة**: تُقرأ
                              بياناتُها، وتبقى أفعالُها (إنشاءُ مستخدمٍ، تعديلُ
                              فرعٍ) لمن يملكها بدوره — وإلّا صار مربّعٌ واحدٌ
                              طريقًا إلى إنشاء حسابِ مديرِ نظام. */}
                          {!isManaged && (
                            <span className="text-[11px] text-slate-500">
                              {t('هذه الشاشاتُ تُفتَح للمشاهدة بالتأشير — وأفعالُها تبقى لمن يملكها بدوره.',
                                 'Ticking opens these screens for viewing — their actions still need the role itself.')}
                            </span>
                          )}
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-1.5">
                          {pages.map((pg) => {
                            const allowed = !!pageDraft[pg.key];
                            // صفحةٌ في قسمٍ ممنوع لا تُفتَح مهما أُشِّرت — تُقال
                            // لا تُخفى، كي يُعرف السببُ ويُرفَع القسمُ أوّلًا.
                            const blockedBySection = isManaged && cur === 'none';
                            if (blockedBySection) {
                              // لا مربّعَ معطَّلًا: زرٌّ يفعل المقصود ويقول ما سيفعله.
                              return (
                                <button key={pg.key} type="button" onClick={() => openOnePage(section, pg.key)}
                                  title={ar
                                    ? `قسمُ «${getSectionLabel(section, lang)}» غيرُ ممنوح — اضغط لمنحه مشاهدةً وفتحِ هذه الصفحة وحدَها`
                                    : `Section not granted — click to grant view and open only this page`}
                                  className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-dashed border-slate-300 bg-slate-50 text-[13px] text-slate-500 text-start hover:border-[#f37121] hover:text-[#f37121] transition-colors">
                                  <Lock className="w-3.5 h-3.5 shrink-0 opacity-60" />
                                  <span className="truncate" title={pg.key}>{ar ? pg.ar : pg.en}</span>
                                </button>
                              );
                            }
                            return (
                              <label key={pg.key}
                                className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg border text-[13px] cursor-pointer transition-colors ${
                                  allowed ? 'border-emerald-200 bg-emerald-50/60 text-slate-800' : 'border-slate-200 bg-white text-slate-500'}`}>
                                <input type="checkbox" className="w-4 h-4 accent-[#f37121] shrink-0"
                                  checked={allowed}
                                  onChange={() => togglePage(pg.key)} />
                                <span className="truncate" title={pg.key}>{ar ? pg.ar : pg.en}</span>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {selectedRole && (
            <div className="px-4 py-3 border-t border-slate-200 space-y-3">
              {/* ── أوّلُ شاشةٍ تُفتَح ──────────────────────────────────────────
                  الدورُ المصنوع لا تعرفه خريطةُ الصفحات الرئيسيّة، فقد يُلقى به
                  بعد الدخول على شاشةٍ ممنوعةٍ عليه — فيقرأ «هذه الصفحة ليست ضمن
                  صلاحيّاتك» أوّلَ ما يدخل. */}
              <div className="flex flex-wrap items-center gap-2">
                <Home className="w-4 h-4 text-slate-400" />
                <span className="text-[12.5px] text-slate-600">{t('صفحة الدخول', 'Landing page')}</span>
                <select value={homePage} onChange={(e) => setHomePage(e.target.value)}
                  className="flex-1 min-w-[200px] px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-[13px] focus:outline-none focus:ring-2 focus:ring-[#f37121]/40">
                  <option value="">{t('الافتراضيّة لهذا الدور', 'Default for this role')}</option>
                  {catalog.filter((p) => pageDraft[p.key]).map((p) => (
                    <option key={p.key} value={p.key}>{`${getSectionLabel(p.section, lang)} — ${ar ? p.ar : p.en}`}</option>
                  ))}
                </select>
              </div>

              <div className="flex items-center justify-between gap-3">
                <p className="text-[11.5px] text-slate-400 flex items-center gap-1.5 min-w-0">
                  <Layers className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">
                    {t('القسمُ يقرّر القراءةَ والكتابة، والصفحةُ تقرّر أين — وكلاهما محروسٌ على الخادم لا في المتصفّح.',
                       'The section decides read vs write, the page decides where — and both are enforced on the server, not in the browser.')}
                  </span>
                </p>
                <div className="flex items-center gap-3 shrink-0">
                  {dirty && <span className="text-amber-600 text-xs">{tx.unsaved}</span>}
                  {savedFlash && !dirty && <span className="text-green-600 text-xs flex items-center gap-1"><Check className="w-3.5 h-3.5" /> {tx.saved}</span>}
                  <button type="button" onClick={() => { setDraft({ ...original }); setPageDraft({ ...originalPages }); setHomePage(originalHome); }}
                    disabled={!dirty || saving}
                    className="px-4 py-2 text-slate-500 hover:text-slate-900 text-sm disabled:opacity-40">{tx.reset}</button>
                  <button type="button" onClick={save} disabled={!dirty || saving}
                    className="flex items-center gap-2 px-4 py-2 bg-[#f37121] text-white rounded-lg text-sm font-medium hover:bg-[#e06010] transition-colors disabled:opacity-50">
                    {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}{saving ? tx.saving : tx.save}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <Modal open={newRoleOpen} onClose={() => setNewRoleOpen(false)}
        title={t('نوع مستخدم جديد', 'New user type')}
        footer={<>
          <button type="button" onClick={() => setNewRoleOpen(false)} className="px-4 py-2 text-slate-500 text-sm">{t('إلغاء', 'Cancel')}</button>
          <PrimaryButton onClick={createRole} disabled={creating || !newRole.key.trim() || !newRole.nameAr.trim() || !newRole.nameEn.trim()}>
            {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}{t('إنشاء', 'Create')}
          </PrimaryButton>
        </>}>
        <div className="space-y-3">
          <Field label={t('الاسم بالعربية *', 'Arabic name *')}>
            <TextInput value={newRole.nameAr} onChange={(e) => setNewRole((r) => ({ ...r, nameAr: e.target.value }))}
              placeholder={t('مثال: مراجع مالي', 'e.g. Financial reviewer')} />
          </Field>
          <Field label={t('الاسم بالإنجليزية *', 'English name *')}>
            <TextInput value={newRole.nameEn} onChange={(e) => setNewRole((r) => ({ ...r, nameEn: e.target.value }))}
              placeholder="Financial reviewer" />
          </Field>
          <Field label={t('المفتاح *', 'Key *')}>
            <TextInput value={newRole.key}
              onChange={(e) => setNewRole((r) => ({ ...r, key: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_') }))}
              placeholder="financial_reviewer" />
            {/* المفتاحُ يُكتب على كلّ مستخدمٍ يحمله ولا يُغيَّر بعدها — يُقال ذلك
                قبل الإنشاء لا بعده. */}
            <p className="text-[11.5px] text-slate-500 mt-1.5 leading-relaxed">
              {t('حروفٌ لاتينيّةٌ صغيرةٌ وأرقامٌ وشرطةٌ سفليّة. يُكتب على كلّ مستخدمٍ يحمل هذا النوع ولا يُغيَّر بعد الإنشاء — أمّا الاسمُ العربيّ فيُعدَّل متى شئت. ولاحقة «_manager» محجوزةٌ لمديري الأقسام.',
                 'Lowercase letters, digits and underscores. It is written onto every user of this type and cannot change afterwards — the Arabic name can. The “_manager” suffix is reserved for section managers.')}
            </p>
          </Field>
          <Field label={t('لماذا صُنع هذا النوع', 'Why this type exists')}>
            <TextInput value={newRole.description} onChange={(e) => setNewRole((r) => ({ ...r, description: e.target.value }))}
              placeholder={t('يُقرأ في هذه الشاشة بعد شهور', 'Read on this screen months from now')} />
          </Field>
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-[12.5px] text-slate-600 leading-relaxed flex items-start gap-2">
            <ShieldCheck className="w-4 h-4 text-[#f37121] shrink-0 mt-0.5" />
            <span>
              {t('يُولَد بلا صلاحيّةٍ واحدة: لا قسمَ ولا صفحة. تُمنَح له من هذه الشاشة بعد إنشائه مباشرةً — والذي يُنسى يبقى مغلقًا.',
                 'It is born with nothing: no section, no page. You grant them on this screen right after creating it — and whatever is forgotten stays closed.')}
            </span>
          </div>
        </div>
      </Modal>
    </div>
  );
}
