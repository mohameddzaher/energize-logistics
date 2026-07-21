'use client';
// Performance settings — super-admin only (إعداد المؤشرات).
//
// Three things live here, and nowhere else:
//   1. النماذج — the criteria each department is graded on, their weights and
//      their 1..5 wording. A form whose weights don't total 100% cannot be saved.
//   2. الشرائح — the performance bands (0-70 / 70-80 / 80-90 / 90-100).
//   3. الطبقات — the bonus table per tier, and which tier each department sits in.
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useDialog } from '@/components/system/DialogProvider';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import api from '@/lib/api';
import {
  Settings as SettingsIcon, Plus, Trash2, Save, Loader2, GripVertical,
  AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, Copy,
} from 'lucide-react';
import { Spinner, PageHeader } from '@/components/hr/HRKit';
import {
  canConfigurePerf, bandStyle, type Band, type Tier, type Template, type Criterion, type Settings,
} from '@/lib/performance';

const inputCls = 'w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:border-[#f37121]';
const labelCls = 'block text-xs font-medium text-slate-500 mb-1';

const DEFAULT_SCALE = [
  { score: 1, label: 'Poor', labelAr: 'ضعيف' },
  { score: 2, label: 'Below', labelAr: 'دون' },
  { score: 3, label: 'Acceptable', labelAr: 'مقبول' },
  { score: 4, label: 'Good', labelAr: 'جيد' },
  { score: 5, label: 'Excellent', labelAr: 'ممتاز' },
];
const blankCriterion = (i: number): Criterion => ({
  key: `c${i + 1}_${Date.now().toString(36)}`, order: i,
  title: '', titleAr: '', description: '', descriptionAr: '',
  dataSource: '', dataSourceAr: '', weight: 0,
  scale: DEFAULT_SCALE.map((s) => ({ ...s })),
});

export default function PerformanceSettingsPage() {
  const { confirm } = useDialog();
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';

  const [tab, setTab] = useState<'templates' | 'bands' | 'tiers'>('templates');
  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [departments, setDepartments] = useState<string[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [editing, setEditing] = useState<Template | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const [s, t] = await Promise.all([
        api.get<{ settings: Settings; departments: string[] }>('/api/performance/settings'),
        api.get<{ templates: Template[] }>('/api/performance/templates'),
      ]);
      setSettings(s.settings); setDepartments(s.departments || []); setTemplates(t.templates || []);
    } catch (e: any) { setMsg({ kind: 'err', text: e?.message || 'Failed to load' }); }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const flash = (kind: 'ok' | 'err', text: string) => { setMsg({ kind, text }); setTimeout(() => setMsg(null), 4000); };

  // ---- Template editing ----
  const editTotal = useMemo(
    () => (editing?.criteria || []).reduce((s, c) => s + (Number(c.weight) || 0), 0),
    [editing]
  );
  const weightsOk = Math.abs(editTotal - 100) < 0.01;

  const startNew = () => setEditing({
    _id: '', name: '', nameAr: '', description: '', descriptionAr: '',
    department: departments[0] || '', jobTitles: [], tier: 1, active: true,
    criteria: [blankCriterion(0)],
  });

  const setC = (idx: number, patch: Partial<Criterion>) =>
    setEditing((t) => t ? { ...t, criteria: t.criteria.map((c, i) => i === idx ? { ...c, ...patch } : c) } : t);
  const setScale = (ci: number, si: number, patch: Partial<{ label: string; labelAr: string }>) =>
    setEditing((t) => t ? {
      ...t,
      criteria: t.criteria.map((c, i) => i === ci
        ? { ...c, scale: c.scale.map((s, j) => j === si ? { ...s, ...patch } : s) } : c),
    } : t);

  const saveTemplate = async () => {
    if (!editing) return;
    if (!editing.nameAr.trim()) return flash('err', ar ? 'اسم النموذج مطلوب' : 'Template name is required');
    if (!editing.department) return flash('err', ar ? 'اختر القسم' : 'Choose a department');
    if (!weightsOk) return flash('err', ar ? `مجموع الأوزان لازم يساوي ١٠٠٪ (حالياً ${Math.round(editTotal * 100) / 100}٪)` : `Weights must total 100% (currently ${Math.round(editTotal * 100) / 100}%)`);
    setSaving(true);
    try {
      if (editing._id) await api.put(`/api/performance/templates/${editing._id}`, editing);
      else await api.post('/api/performance/templates', editing);
      flash('ok', ar ? 'تم حفظ النموذج' : 'Template saved');
      setEditing(null); await load();
    } catch (e: any) { flash('err', e?.message || 'Save failed'); }
    setSaving(false);
  };

  const removeTemplate = async (t: Template) => {
    if (!(await confirm(ar ? `حذف نموذج "${t.nameAr}"؟` : `Delete template "${t.nameAr}"?`))) return;
    try {
      const r = await api.delete<{ deactivated?: boolean; message?: string }>(`/api/performance/templates/${t._id}`);
      flash('ok', r?.deactivated ? (r.message || (ar ? 'تم تعطيل النموذج' : 'Template deactivated')) : (ar ? 'تم الحذف' : 'Deleted'));
      await load();
    } catch (e: any) { flash('err', e?.message || 'Delete failed'); }
  };

  const duplicate = (t: Template) => setEditing({
    ...t, _id: '', nameAr: `${t.nameAr} (${ar ? 'نسخة' : 'copy'})`,
    criteria: t.criteria.map((c, i) => ({ ...c, key: `c${i + 1}_${Date.now().toString(36)}` })),
  });

  // ---- Settings (bands / tiers) ----
  const saveSettings = async () => {
    if (!settings) return;
    setSaving(true);
    try {
      await api.put('/api/performance/settings', settings);
      flash('ok', ar ? 'تم حفظ الإعدادات' : 'Settings saved');
      await load();
    } catch (e: any) { flash('err', e?.message || 'Save failed'); }
    setSaving(false);
  };
  const setBand = (i: number, patch: Partial<Band>) =>
    setSettings((s) => s ? { ...s, bands: s.bands.map((b, j) => j === i ? { ...b, ...patch } : b) } : s);
  const setTier = (i: number, patch: Partial<Tier>) =>
    setSettings((s) => s ? { ...s, tiers: s.tiers.map((t, j) => j === i ? { ...t, ...patch } : t) } : s);
  const setTierBonus = (i: number, bandKey: string, v: number) =>
    setSettings((s) => s ? { ...s, tiers: s.tiers.map((t, j) => j === i ? { ...t, bonus: { ...t.bonus, [bandKey]: v } } : t) } : s);

  if (!canConfigurePerf(user?.role)) {
    return (
      <div className="p-8 text-slate-500">
        {ar ? 'هذه الصفحة للمدير العام فقط (super admin).' : 'This page is restricted to super admins.'}
      </div>
    );
  }
  if (loading || !settings) return <Spinner />;

  const TABS = [
    { key: 'templates', ar: 'نماذج المؤشرات', en: 'Criteria templates' },
    { key: 'bands', ar: 'شرائح الأداء', en: 'Performance bands' },
    { key: 'tiers', ar: 'الطبقات والبونص', en: 'Tiers & bonus' },
  ] as const;

  return (
    <div className="space-y-5" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader
        icon={<SettingsIcon className="w-5 h-5" />}
        title={ar ? 'إعداد تقييم الأداء' : 'Performance configuration'}
        subtitle={ar ? 'المؤشرات وأوزانها وشرائح الأداء وجدول البونص — للمدير العام فقط' : 'Criteria, weights, bands and bonus tables — super admin only'}
      >
        {tab !== 'templates' && (
          <button type="button" onClick={saveSettings} disabled={saving} className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#f37121] hover:bg-[#d95f13] text-white text-sm font-medium disabled:opacity-50">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} {ar ? 'حفظ' : 'Save'}
          </button>
        )}
      </PageHeader>

      {msg && (
        <div className={`rounded-lg px-4 py-2.5 text-sm flex items-center gap-2 ${msg.kind === 'ok' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
          {msg.kind === 'ok' ? <CheckCircle2 className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}{msg.text}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button key={t.key} type="button" onClick={() => { setTab(t.key); setEditing(null); }}
            className={`px-3 py-1.5 rounded-full text-xs font-medium border ${tab === t.key ? 'bg-[#f37121] text-white border-[#f37121]' : 'bg-white text-slate-600 border-slate-200'}`}>
            {ar ? t.ar : t.en}
          </button>
        ))}
      </div>

      {/* ============ TEMPLATES ============ */}
      {tab === 'templates' && !editing && (
        <div className="space-y-3">
          <button type="button" onClick={startNew} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white border border-slate-200 hover:border-[#f37121] text-slate-700 text-sm">
            <Plus className="w-4 h-4 text-[#f37121]" /> {ar ? 'نموذج جديد' : 'New template'}
          </button>
          {templates.length === 0 && (
            <div className="bg-white border border-slate-200 rounded-xl p-10 text-center text-slate-500 shadow-sm">
              {ar ? 'لا توجد نماذج بعد — ابدأ بإضافة نموذج لكل قسم.' : 'No templates yet — add one per department.'}
            </div>
          )}
          {templates.map((t) => {
            const total = (t.criteria || []).reduce((s, c) => s + (Number(c.weight) || 0), 0);
            const ok = Math.abs(total - 100) < 0.01;
            const isOpen = open.has(t._id);
            return (
              <div key={t._id} className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
                <div className="flex items-center gap-3 p-4">
                  <button type="button" onClick={() => setOpen((p) => { const n = new Set(p); n.has(t._id) ? n.delete(t._id) : n.add(t._id); return n; })} className="text-slate-400">
                    {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className={`w-4 h-4 ${isRTL ? 'rotate-180' : ''}`} />}
                  </button>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-slate-900 truncate">{t.nameAr}{!t.active && <span className="ms-2 text-[11px] text-slate-400">({ar ? 'معطّل' : 'inactive'})</span>}</p>
                    <p className="text-xs text-slate-500">
                      {t.department} · {(t.criteria || []).length} {ar ? 'مؤشرات' : 'criteria'} · {ar ? 'الطبقة' : 'Tier'} {t.tier}
                      {(t.jobTitles || []).length > 0 && ` · ${t.jobTitles.join('، ')}`}
                    </p>
                  </div>
                  <span className={`px-2 py-0.5 rounded-full text-xs font-bold tabular-nums ${ok ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>{total}%</span>
                  <button type="button" onClick={() => duplicate(t)} title={ar ? 'نسخ' : 'Duplicate'} className="p-1.5 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100"><Copy className="w-4 h-4" /></button>
                  <button type="button" onClick={() => setEditing(JSON.parse(JSON.stringify(t)))} className="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-medium">{ar ? 'تعديل' : 'Edit'}</button>
                  <button type="button" onClick={() => removeTemplate(t)} className="p-1.5 rounded-md text-slate-400 hover:text-red-600 hover:bg-red-50"><Trash2 className="w-4 h-4" /></button>
                </div>
                {isOpen && (
                  <div className="border-t border-slate-100 px-4 py-3 bg-slate-50/60 space-y-1.5">
                    {[...(t.criteria || [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).map((c, i) => (
                      <div key={c.key} className="flex items-start gap-2 text-sm">
                        <span className="text-slate-400 tabular-nums w-5">{i + 1}.</span>
                        <span className="flex-1 text-slate-700">{c.titleAr || c.title}</span>
                        <span className="text-[#f37121] font-semibold tabular-nums">{c.weight}%</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Template editor */}
      {tab === 'templates' && editing && (
        <div className="space-y-4">
          <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="lg:col-span-2">
                <label className={labelCls}>{ar ? 'اسم النموذج (عربي)' : 'Template name (Arabic)'} *</label>
                <input value={editing.nameAr} onChange={(e) => setEditing({ ...editing, nameAr: e.target.value })} className={inputCls} placeholder={ar ? 'مثال: التخليص والمعقبون' : ''} />
              </div>
              <div>
                <label className={labelCls}>{ar ? 'القسم' : 'Department'} *</label>
                <input list="perf-depts" value={editing.department} onChange={(e) => setEditing({ ...editing, department: e.target.value })} className={inputCls} />
                <datalist id="perf-depts">{departments.map((d) => <option key={d} value={d} />)}</datalist>
              </div>
              <div>
                <label className={labelCls}>{ar ? 'الطبقة (البونص)' : 'Tier (bonus)'}</label>
                <select value={editing.tier} onChange={(e) => setEditing({ ...editing, tier: Number(e.target.value) })} className={inputCls}>
                  {settings.tiers.map((t) => <option key={t.tier} value={t.tier}>{ar ? t.ar : t.en} — {ar ? 'سقف' : 'cap'} {t.cap}</option>)}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>{ar ? 'المسميات الوظيفية (اختياري، مفصولة بفاصلة)' : 'Job titles (optional, comma separated)'}</label>
                <input
                  value={(editing.jobTitles || []).join(', ')}
                  onChange={(e) => setEditing({ ...editing, jobTitles: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })}
                  className={inputCls} placeholder={ar ? 'اتركها فاضية لتطبيق النموذج على القسم كله' : 'Leave empty to apply to the whole department'}
                />
              </div>
              <div>
                <label className={labelCls}>{ar ? 'وصف مختصر' : 'Short description'}</label>
                <input value={editing.descriptionAr} onChange={(e) => setEditing({ ...editing, descriptionAr: e.target.value })} className={inputCls} />
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-600">
              <input type="checkbox" checked={editing.active} onChange={(e) => setEditing({ ...editing, active: e.target.checked })} className="accent-[#f37121]" />
              {ar ? 'نموذج مفعّل' : 'Active'}
            </label>
          </div>

          {/* Weight total banner */}
          <div className={`rounded-xl px-4 py-3 flex items-center justify-between ${weightsOk ? 'bg-emerald-50 border border-emerald-200' : 'bg-red-50 border border-red-200'}`}>
            <span className={`text-sm font-medium ${weightsOk ? 'text-emerald-700' : 'text-red-700'}`}>
              {ar ? 'مجموع الأوزان' : 'Total weight'}: <b className="tabular-nums">{Math.round(editTotal * 100) / 100}%</b>
              {!weightsOk && <span className="ms-2">{ar ? '— لازم يساوي ١٠٠٪ قبل الحفظ' : '— must equal 100% before saving'}</span>}
            </span>
            <button type="button" onClick={() => setEditing({ ...editing, criteria: [...editing.criteria, blankCriterion(editing.criteria.length)] })}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-slate-200 hover:border-[#f37121] text-slate-700 text-xs font-medium">
              <Plus className="w-3.5 h-3.5 text-[#f37121]" /> {ar ? 'إضافة مؤشر' : 'Add criterion'}
            </button>
          </div>

          {editing.criteria.map((c, i) => (
            <div key={c.key} className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm space-y-3">
              <div className="flex items-center gap-2">
                <GripVertical className="w-4 h-4 text-slate-300" />
                <span className="w-6 h-6 rounded-md bg-slate-900 text-white text-xs font-bold flex items-center justify-center">{i + 1}</span>
                <div className="flex-1" />
                <div className="flex items-center gap-1.5">
                  <label className="text-xs text-slate-500">{ar ? 'الوزن' : 'Weight'}</label>
                  <input
                    type="number" min={0} max={100} value={c.weight}
                    onChange={(e) => setC(i, { weight: Number(e.target.value) })}
                    className="w-20 border border-slate-200 rounded-lg px-2 py-1 text-sm tabular-nums text-center focus:outline-none focus:border-[#f37121]"
                  />
                  <span className="text-xs text-slate-500">%</span>
                </div>
                <button type="button" onClick={() => setEditing({ ...editing, criteria: editing.criteria.filter((_, j) => j !== i) })}
                  className="p-1.5 rounded-md text-slate-400 hover:text-red-600 hover:bg-red-50"><Trash2 className="w-4 h-4" /></button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>{ar ? 'اسم المؤشر (عربي)' : 'Criterion (Arabic)'} *</label>
                  <input value={c.titleAr} onChange={(e) => setC(i, { titleAr: e.target.value })} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>{ar ? 'الاسم بالإنجليزية' : 'English name'}</label>
                  <input value={c.title} onChange={(e) => setC(i, { title: e.target.value })} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>{ar ? 'الوصف' : 'Description'}</label>
                  <input value={c.descriptionAr} onChange={(e) => setC(i, { descriptionAr: e.target.value })} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>{ar ? 'مصدر البيانات' : 'Data source'}</label>
                  <input value={c.dataSourceAr} onChange={(e) => setC(i, { dataSourceAr: e.target.value })} className={inputCls} placeholder={ar ? 'مثال: تقارير التشغيل' : ''} />
                </div>
              </div>
              <div>
                <p className={labelCls}>{ar ? 'سلّم التقييم (وصف كل درجة)' : 'Rating scale (wording per score)'}</p>
                <div className="grid grid-cols-5 gap-2">
                  {c.scale.map((s, si) => (
                    <div key={s.score} className="text-center">
                      <span className="block text-xs font-bold text-slate-700 mb-1">{s.score}</span>
                      <input
                        value={s.labelAr} onChange={(e) => setScale(i, si, { labelAr: e.target.value })}
                        className="w-full border border-slate-200 rounded-lg px-1.5 py-1 text-[11px] text-center focus:outline-none focus:border-[#f37121]"
                      />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ))}

          <div className="flex items-center gap-2">
            <button type="button" onClick={saveTemplate} disabled={saving || !weightsOk}
              className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-[#f37121] hover:bg-[#d95f13] text-white text-sm font-semibold disabled:opacity-50">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} {ar ? 'حفظ النموذج' : 'Save template'}
            </button>
            <button type="button" onClick={() => setEditing(null)} className="px-4 py-2.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm">{ar ? 'إلغاء' : 'Cancel'}</button>
          </div>
        </div>
      )}

      {/* ============ BANDS ============ */}
      {tab === 'bands' && (
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm space-y-3">
          <p className="text-sm text-slate-500">
            {ar ? 'النسبة المئوية = الدرجة المرجّحة × ٢٠. الشرائح دي بتحدد التقدير والبونص.' : 'Percentage = weighted score × 20. These bands drive the rating and the bonus.'}
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-900 text-slate-300 text-xs">
                  <th className="text-start font-semibold px-3 py-2">{ar ? 'الاسم بالعربية' : 'Arabic label'}</th>
                  <th className="text-start font-semibold px-3 py-2">{ar ? 'بالإنجليزية' : 'English'}</th>
                  <th className="text-center font-semibold px-3 py-2">{ar ? 'من %' : 'From %'}</th>
                  <th className="text-center font-semibold px-3 py-2">{ar ? 'إلى %' : 'To %'}</th>
                  <th className="text-center font-semibold px-3 py-2">{ar ? 'اللون' : 'Colour'}</th>
                </tr>
              </thead>
              <tbody>
                {settings.bands.map((b, i) => (
                  <tr key={b.key} className="border-b border-slate-100">
                    <td className="px-3 py-2"><input value={b.ar} onChange={(e) => setBand(i, { ar: e.target.value })} className={inputCls} /></td>
                    <td className="px-3 py-2"><input value={b.en} onChange={(e) => setBand(i, { en: e.target.value })} className={inputCls} /></td>
                    <td className="px-3 py-2"><input type="number" value={b.min} onChange={(e) => setBand(i, { min: Number(e.target.value) })} className={`${inputCls} text-center tabular-nums`} /></td>
                    <td className="px-3 py-2"><input type="number" value={b.max} onChange={(e) => setBand(i, { max: Number(e.target.value) })} className={`${inputCls} text-center tabular-nums`} /></td>
                    <td className="px-3 py-2">
                      <select value={b.color} onChange={(e) => setBand(i, { color: e.target.value })} className={inputCls}>
                        {['red', 'amber', 'blue', 'emerald', 'slate'].map((c) => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div>
            <label className={labelCls}>{ar ? 'حد الاستحقاق للبونص (%)' : 'Bonus eligibility threshold (%)'}</label>
            <input type="number" value={settings.eligibilityThreshold}
              onChange={(e) => setSettings({ ...settings, eligibilityThreshold: Number(e.target.value) })}
              className={`${inputCls} w-40 tabular-nums`} />
          </div>
        </div>
      )}

      {/* ============ TIERS ============ */}
      {tab === 'tiers' && (
        <div className="space-y-4">
          <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm space-y-4">
            <p className="text-sm text-slate-500">
              {ar ? 'البونص بعدد الرواتب الشهرية ويُصرف عن الفترة. لكل طبقة سقف مختلف.' : 'Bonus in monthly salaries, paid per period. Each tier has its own cap.'}
            </p>
            {settings.tiers.map((t, i) => (
              <div key={t.tier} className="border border-slate-200 rounded-lg p-3">
                <div className="flex flex-wrap items-center gap-3 mb-3">
                  <input value={t.ar} onChange={(e) => setTier(i, { ar: e.target.value })} className={`${inputCls} w-48`} />
                  <div className="flex items-center gap-1.5">
                    <label className="text-xs text-slate-500">{ar ? 'السقف' : 'Cap'}</label>
                    <input type="number" step={0.25} value={t.cap} onChange={(e) => setTier(i, { cap: Number(e.target.value) })}
                      className="w-24 border border-slate-200 rounded-lg px-2 py-1.5 text-sm tabular-nums text-center focus:outline-none focus:border-[#f37121]" />
                  </div>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {settings.bands.map((b) => (
                    <div key={b.key}>
                      <label className={`${labelCls} flex items-center gap-1.5`}>
                        <span className={`w-2 h-2 rounded-full ${bandStyle(b).bar}`} />{ar ? b.ar : b.en}
                      </label>
                      <input
                        type="number" step={0.25} min={0} value={t.bonus?.[b.key] ?? 0}
                        onChange={(e) => setTierBonus(i, b.key, Number(e.target.value))}
                        className={`${inputCls} tabular-nums text-center`}
                      />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
            <p className="text-sm font-semibold text-slate-800 mb-1">{ar ? 'طبقة كل قسم' : 'Tier per department'}</p>
            <p className="text-xs text-slate-500 mb-3">
              {ar ? 'الطبقة الافتراضية للقسم — النموذج يقدر يحدد طبقة مختلفة لو حبيت.' : "A department's default tier — a template may override it."}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {departments.map((d) => (
                <div key={d} className="flex items-center gap-2">
                  <span className="text-sm text-slate-700 flex-1 truncate">{d}</span>
                  <select
                    value={settings.departmentTiers?.[d] ?? ''}
                    onChange={(e) => setSettings({
                      ...settings,
                      departmentTiers: { ...(settings.departmentTiers || {}), [d]: e.target.value === '' ? undefined as any : Number(e.target.value) },
                    })}
                    className="w-40 border border-slate-200 rounded-lg px-2 py-1.5 text-sm bg-white focus:outline-none focus:border-[#f37121]"
                  >
                    <option value="">{ar ? '— افتراضي —' : '— default —'}</option>
                    {settings.tiers.map((t) => <option key={t.tier} value={t.tier}>{ar ? t.ar : t.en}</option>)}
                  </select>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
