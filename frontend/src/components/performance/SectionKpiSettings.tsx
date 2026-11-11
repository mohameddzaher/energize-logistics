'use client';
// A section's KPI forms: items (Arabic + English), weights that must total 100%, and which employees each form grades.
// Opened from the section's KPI board. The server decides who may edit (the section manager, top roles, the general manager); a form that grades a section head is read-only to that section's manager.
// Live: any change from another screen triggers a re-read; an open edit is kept and flagged if its form changed underneath.
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import { useDialog } from '@/components/system/DialogProvider';
import api from '@/lib/api';
import { Plus, Trash2, Save, Loader2, Lock, ArrowUp, ArrowDown, Pencil, X, Scale, AlertTriangle } from 'lucide-react';
import type { Template, Criterion, TeamMember } from '@/lib/performance';

const inputCls = 'w-full border border-slate-200 rounded-lg px-2.5 py-1.5 text-sm bg-white focus:outline-none focus:border-[#f37121]';
const labelCls = 'block text-[11px] font-medium text-slate-500 mb-0.5';

interface ListResponse { templates: (Template & { updatedAt?: string })[]; canCreate: boolean }
interface TeamResponse { members: TeamMember[] }

const round = (n: number) => Math.round(n * 10000) / 10000;
const totalOf = (list: Criterion[]) => round(list.reduce((s, c) => s + (Number(c.weight) || 0), 0));
const newKey = (i: number) => `c${i + 1}_${Date.now().toString(36)}`;
const blankItem = (i: number): Criterion => ({
  key: newKey(i), order: i, title: '', titleAr: '', description: '', descriptionAr: '',
  dataSource: '', dataSourceAr: '', group: '', groupAr: '', weight: 0, scale: [],
});

/** One item row of the editor. Defined at module level so typing never remounts the inputs. */
function ItemRow({ c, i, count, ar, onChange, onMove, onRemove }: {
  c: Criterion; i: number; count: number; ar: boolean;
  onChange: (i: number, patch: Partial<Criterion>) => void;
  onMove: (i: number, dir: -1 | 1) => void;
  onRemove: (i: number) => void;
}) {
  return (
    <div className="border border-slate-200 rounded-lg p-3 bg-slate-50/50 space-y-2">
      <div className="flex items-center gap-2">
        <span className="w-6 h-6 rounded-md bg-slate-900 text-white text-xs font-bold flex items-center justify-center shrink-0 tabular-nums">{i + 1}</span>
        <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-2">
          <div>
            <label className={labelCls}>{ar ? 'البند (عربي)' : 'Item (Arabic)'}</label>
            <input dir="rtl" className={inputCls} value={c.titleAr} onChange={(e) => onChange(i, { titleAr: e.target.value })} />
          </div>
          <div>
            <label className={labelCls}>{ar ? 'البند (إنجليزي)' : 'Item (English)'}</label>
            <input dir="ltr" className={inputCls} value={c.title} onChange={(e) => onChange(i, { title: e.target.value })} />
          </div>
        </div>
        <div className="w-24 shrink-0">
          <label className={labelCls}>{ar ? 'الوزن %' : 'Weight %'}</label>
          <input
            type="number" min={0} max={100} step="0.01" dir="ltr" className={`${inputCls} tabular-nums`}
            value={Number.isFinite(c.weight) ? c.weight : 0}
            onChange={(e) => onChange(i, { weight: e.target.value === '' ? 0 : Number(e.target.value) })}
          />
        </div>
        <div className="flex flex-col gap-0.5 shrink-0 pt-4">
          <button type="button" disabled={i === 0} onClick={() => onMove(i, -1)} className="p-1 text-slate-400 hover:text-slate-700 disabled:opacity-30" title={ar ? 'أعلى' : 'Up'}><ArrowUp className="w-3.5 h-3.5" /></button>
          <button type="button" disabled={i === count - 1} onClick={() => onMove(i, 1)} className="p-1 text-slate-400 hover:text-slate-700 disabled:opacity-30" title={ar ? 'أسفل' : 'Down'}><ArrowDown className="w-3.5 h-3.5" /></button>
        </div>
        <button type="button" onClick={() => onRemove(i)} className="p-1.5 text-slate-400 hover:text-red-600 shrink-0 pt-4" title={ar ? 'حذف البند' : 'Remove item'}><Trash2 className="w-4 h-4" /></button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-4 gap-2 ps-8">
        <div>
          <label className={labelCls}>{ar ? 'المجموعة (عربي)' : 'Group (Arabic)'}</label>
          <input dir="rtl" className={inputCls} value={c.groupAr || ''} onChange={(e) => onChange(i, { groupAr: e.target.value })} />
        </div>
        <div>
          <label className={labelCls}>{ar ? 'المجموعة (إنجليزي)' : 'Group (English)'}</label>
          <input dir="ltr" className={inputCls} value={c.group || ''} onChange={(e) => onChange(i, { group: e.target.value })} />
        </div>
        <div>
          <label className={labelCls}>{ar ? 'المستهدف (عربي)' : 'Target (Arabic)'}</label>
          <input dir="rtl" className={inputCls} value={c.descriptionAr} onChange={(e) => onChange(i, { descriptionAr: e.target.value })} />
        </div>
        <div>
          <label className={labelCls}>{ar ? 'المستهدف (إنجليزي)' : 'Target (English)'}</label>
          <input dir="ltr" className={inputCls} value={c.description} onChange={(e) => onChange(i, { description: e.target.value })} />
        </div>
      </div>
    </div>
  );
}

/** The editor of one form. */
function FormEditor({ draft, setDraft, members, ar, saving, stale, onSave, onCancel }: {
  draft: Template; setDraft: (fn: (t: Template) => Template) => void;
  members: TeamMember[]; ar: boolean; saving: boolean; stale: boolean;
  onSave: () => void; onCancel: () => void;
}) {
  const total = totalOf(draft.criteria);
  const ok = Math.abs(total - 100) < 0.01;
  const assigned = new Set((draft.employees || []).map(String));
  const setItem = (i: number, patch: Partial<Criterion>) =>
    setDraft((t) => ({ ...t, criteria: t.criteria.map((c, j) => (j === i ? { ...c, ...patch } : c)) }));
  const move = (i: number, dir: -1 | 1) => setDraft((t) => {
    const list = [...t.criteria];
    const [x] = list.splice(i, 1);
    list.splice(i + dir, 0, x);
    return { ...t, criteria: list.map((c, k) => ({ ...c, order: k })) };
  });
  const remove = (i: number) => setDraft((t) => ({ ...t, criteria: t.criteria.filter((_, j) => j !== i).map((c, k) => ({ ...c, order: k })) }));
  // Equal split that still totals exactly 100: the last item absorbs the rounding.
  const equalise = () => setDraft((t) => {
    const n = t.criteria.length || 1;
    const each = round(100 / n);
    return { ...t, criteria: t.criteria.map((c, k) => ({ ...c, weight: k === n - 1 ? round(100 - each * (n - 1)) : each })) };
  });
  const toggleEmployee = (id: string) => setDraft((t) => {
    const set = new Set((t.employees || []).map(String));
    if (set.has(id)) set.delete(id); else set.add(id);
    return { ...t, employees: [...set] };
  });

  return (
    <div className="bg-white border border-[#f37121]/40 rounded-xl p-4 shadow-sm space-y-4">
      {stale && (
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4" />
          {ar ? 'عُدِّل هذا النموذج من شاشة أخرى بعد فتحه؛ الحفظ سيستبدل ذلك التعديل.' : 'This form was changed elsewhere after you opened it; saving will replace that change.'}
        </p>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className={labelCls}>{ar ? 'اسم النموذج (عربي)' : 'Form name (Arabic)'}</label>
          <input dir="rtl" className={inputCls} value={draft.nameAr} onChange={(e) => setDraft((t) => ({ ...t, nameAr: e.target.value }))} />
        </div>
        <div>
          <label className={labelCls}>{ar ? 'اسم النموذج (إنجليزي)' : 'Form name (English)'}</label>
          <input dir="ltr" className={inputCls} value={draft.name} onChange={(e) => setDraft((t) => ({ ...t, name: e.target.value }))} />
        </div>
      </div>

      <div className="space-y-2">
        {draft.criteria.map((c, i) => (
          <ItemRow key={c.key} c={c} i={i} count={draft.criteria.length} ar={ar} onChange={setItem} onMove={move} onRemove={remove} />
        ))}
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => setDraft((t) => ({ ...t, criteria: [...t.criteria, blankItem(t.criteria.length)] }))} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-medium">
            <Plus className="w-3.5 h-3.5" /> {ar ? 'إضافة بند' : 'Add item'}
          </button>
          <button type="button" onClick={equalise} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-medium">
            <Scale className="w-3.5 h-3.5" /> {ar ? 'توزيع الأوزان بالتساوي' : 'Split weights equally'}
          </button>
          <span className={`ms-auto text-sm font-bold tabular-nums px-3 py-1 rounded-lg ${ok ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
            {ar ? 'مجموع الأوزان' : 'Total weight'}: {total}%
          </span>
        </div>
      </div>

      {!!members.length && (
        <div>
          <p className="text-xs font-semibold text-slate-600 mb-2">{ar ? 'الموظفون الذين يُقيَّمون بهذا النموذج' : 'Employees graded with this form'}</p>
          <div className="flex flex-wrap gap-1.5">
            {members.map((m) => {
              const on = assigned.has(String(m._id));
              return (
                <button
                  key={m._id} type="button" onClick={() => toggleEmployee(String(m._id))}
                  className={`px-2.5 py-1 rounded-full text-xs border ${on ? 'bg-[#f37121] text-white border-[#f37121]' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'}`}
                >
                  {m.name}
                </button>
              );
            })}
          </div>
          <p className="text-[11px] text-slate-400 mt-1.5">
            {ar ? 'من لم يُحدَّد له نموذج يُطابَق بمسمّاه الوظيفي ثم بدوره في النظام.' : 'Employees not chosen here are matched by job title, then by account role.'}
          </p>
        </div>
      )}

      <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
        <button type="button" onClick={onCancel} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm">
          <X className="w-4 h-4" /> {ar ? 'إلغاء' : 'Cancel'}
        </button>
        <button type="button" disabled={!ok || saving} onClick={onSave} className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#f37121] hover:bg-[#e0621a] text-white text-sm font-medium disabled:opacity-50">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} {ar ? 'حفظ' : 'Save'}
        </button>
      </div>
    </div>
  );
}

/** Read-only summary card of one form. */
function FormCard({ t, ar, members, onEdit, onDelete }: {
  t: Template; ar: boolean; members: Map<string, string>;
  onEdit: () => void; onDelete: () => void;
}) {
  const names = (t.employees || []).map((id) => members.get(String(id))).filter(Boolean);
  return (
    <div className={`bg-white border rounded-xl p-4 shadow-sm space-y-2 ${t.active ? 'border-slate-200' : 'border-dashed border-slate-300 opacity-70'}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold text-slate-900">{ar ? t.nameAr : (t.name || t.nameAr)}</p>
          <p className="text-xs text-slate-500">{ar ? (t.name || '') : t.nameAr}</p>
        </div>
        {t.canEdit ? (
          <div className="flex items-center gap-1 shrink-0">
            <button type="button" onClick={onEdit} className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 hover:text-[#f37121]" title={ar ? 'تعديل' : 'Edit'}><Pencil className="w-4 h-4" /></button>
            <button type="button" onClick={onDelete} className="p-1.5 rounded-lg text-slate-500 hover:bg-red-50 hover:text-red-600" title={ar ? 'حذف' : 'Delete'}><Trash2 className="w-4 h-4" /></button>
          </div>
        ) : (
          <span className="inline-flex items-center gap-1 text-[10px] text-slate-500 bg-slate-100 rounded-full px-2 py-0.5 shrink-0" title={ar ? 'يعدّله المدير العام أو الإدارة العليا' : 'Edited by top management'}>
            <Lock className="w-3 h-3" /> {ar ? 'للإدارة العليا' : 'Top management'}
          </span>
        )}
      </div>
      <ol className="space-y-1">
        {t.criteria.map((c) => (
          <li key={c.key} className="flex items-start justify-between gap-3 text-xs">
            <span className="text-slate-700">{ar ? (c.titleAr || c.title) : (c.title || c.titleAr)}</span>
            <span className="shrink-0 font-bold text-[#f37121] tabular-nums">{c.weight}%</span>
          </li>
        ))}
      </ol>
      {(!!names.length || !!(t.jobTitles || []).length) && (
        <p className="text-[11px] text-slate-500 pt-1 border-t border-slate-100">
          {names.length ? names.join('، ') : (t.jobTitles || []).join('، ')}
        </p>
      )}
    </div>
  );
}

export default function SectionKpiSettings({ section }: { section: string }) {
  const { lang } = useLanguage();
  const { confirm } = useDialog();
  const ar = lang === 'ar';
  const [data, setData] = useState<ListResponse | null>(null);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [draft, setDraftState] = useState<Template | null>(null);
  const [base, setBase] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const [t, team] = await Promise.all([
        api.get<ListResponse>(`/api/performance/templates?section=${encodeURIComponent(section)}`),
        api.get<TeamResponse>(`/api/performance/team?section=${encodeURIComponent(section)}`),
      ]);
      setData(t); setMembers(team.members || []);
    } catch (e: any) { setMsg({ kind: 'err', text: e?.message || 'Failed to load' }); }
  }, [section]);
  useEffect(() => { load(); }, [load]);
  // Another screen changed a form or an evaluation: re-read this section.
  useSocket('performance:updated', useCallback((d: any) => { if (!d?.section || d.section === section) load(); }, [load, section]));

  const memberNames = useMemo(() => new Map(members.map((m) => [String(m._id), m.name] as const)), [members]);
  const setDraft = useCallback((fn: (t: Template) => Template) => setDraftState((t) => (t ? fn(t) : t)), []);
  const live = draft?._id ? data?.templates.find((t) => t._id === draft._id) : null;
  const stale = !!(live && base && (live as any).updatedAt && (live as any).updatedAt !== base);
  const flash = (kind: 'ok' | 'err', text: string) => { setMsg({ kind, text }); setTimeout(() => setMsg(null), 4000); };

  const edit = (t: Template & { updatedAt?: string }) => {
    setDraftState(JSON.parse(JSON.stringify(t)));
    setBase(t.updatedAt || '');
  };
  const startNew = () => {
    setDraftState({
      _id: '', name: '', nameAr: '', description: '', descriptionAr: '', department: '', section,
      jobTitles: [], tier: 1, active: true, roles: [], employees: [], criteria: [blankItem(0)],
    });
    setBase('');
  };
  const save = async () => {
    if (!draft) return;
    if (!draft.nameAr.trim()) return flash('err', ar ? 'اسم النموذج بالعربية مطلوب' : 'The Arabic form name is required');
    if (draft.criteria.some((c) => !c.titleAr.trim())) return flash('err', ar ? 'لكل بند اسم بالعربية' : 'Every item needs an Arabic name');
    setSaving(true);
    const body = {
      name: draft.name, nameAr: draft.nameAr, section, criteria: draft.criteria, employees: draft.employees || [],
    };
    try {
      if (draft._id) await api.put(`/api/performance/templates/${draft._id}`, body);
      else await api.post('/api/performance/templates', body);
      flash('ok', ar ? 'تمّ حفظ النموذج' : 'Form saved');
      setDraftState(null);
      await load();
    } catch (e: any) { flash('err', e?.message || 'Save failed'); }
    setSaving(false);
  };
  const remove = async (t: Template) => {
    if (!(await confirm(ar ? `حذف نموذج «${t.nameAr}»؟ النموذج المستخدم في تقييمات سابقة يُعطَّل ولا يُحذف.` : `Delete form "${t.name || t.nameAr}"? A form used by past evaluations is deactivated instead.`))) return;
    try {
      await api.delete(`/api/performance/templates/${t._id}`);
      flash('ok', ar ? 'تمّ' : 'Done');
      await load();
    } catch (e: any) { flash('err', e?.message || 'Delete failed'); }
  };

  if (!data) return <div className="p-8 text-center text-slate-400"><Loader2 className="w-5 h-5 animate-spin inline" /></div>;
  const forms = data.templates.filter((t) => t.active);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm text-slate-600">
          {ar
            ? 'لكل نموذج بنود بأوزان مجموعها 100٪؛ تقييم الموظف = مجموع (الدرجة من 1 إلى 5 × الوزن)، ثم النسبة والشريحة والبونص.'
            : 'Each form has items whose weights total 100%; a score = Σ (rating 1-5 × weight), then the percentage, band and bonus.'}
        </p>
        {data.canCreate && !draft && (
          <button type="button" onClick={startNew} className="ms-auto flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-sm">
            <Plus className="w-4 h-4" /> {ar ? 'نموذج جديد' : 'New form'}
          </button>
        )}
      </div>
      {msg && (
        <p className={`text-sm rounded-lg px-3 py-2 ${msg.kind === 'ok' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>{msg.text}</p>
      )}
      {draft && (
        <FormEditor
          draft={draft} setDraft={setDraft} members={members} ar={ar} saving={saving} stale={stale}
          onSave={save} onCancel={() => setDraftState(null)}
        />
      )}
      {forms.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-10 text-center text-slate-500">{ar ? 'لا توجد نماذج لهذا القسم بعد' : 'No forms for this section yet'}</div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {forms.map((t) => (
            <FormCard key={t._id} t={t} ar={ar} members={memberNames} onEdit={() => edit(t)} onDelete={() => remove(t)} />
          ))}
        </div>
      )}
    </div>
  );
}
