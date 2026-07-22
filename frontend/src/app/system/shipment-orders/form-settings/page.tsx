'use client';
// إعدادات نموذج الشحنة — the page that decides how every input on the create
// form looks and behaves: dropdown, tappable cards, or typed; its label, its
// options, whether it is required, and its order. New questions are added here
// and appear on the form immediately, no deploy.
//
// System fields (المرتبطة بحسابات النظام) can be reshaped, relabelled, reordered
// and hidden — but not deleted, because deleting سعر البيع would not remove a
// question, it would break the pricing logic.
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import api from '@/lib/api';
import { useDialog } from '@/components/system/DialogProvider';
import {
  SlidersHorizontal, Plus, Pencil, Trash2, Check, Loader2, X,
  ChevronUp, ChevronDown, Eye, EyeOff, Lock,
} from 'lucide-react';
import {
  Spinner, PageHeader, PrimaryButton, Modal, Field, TextInput, Select, SmallBadge, ErrorNotice,
} from '@/components/hr/HRKit';
import { FormField, GROUP_LABELS, fieldLabel, canAdminOrders, CORE_FIELD_KEYS, Lang } from '@/lib/shipmentOrders';

const TYPE_LABELS: Record<FormField['inputType'], { ar: string; en: string }> = {
  select: { ar: 'قائمة منسدلة', en: 'Dropdown' },
  cards: { ar: 'بطاقات اختيار', en: 'Cards' },
  text: { ar: 'خانة كتابة', en: 'Text' },
  number: { ar: 'رقم', en: 'Number' },
  datetime: { ar: 'تاريخ ووقت', en: 'Date & time' },
  textarea: { ar: 'نص طويل', en: 'Long text' },
};

const EMPTY = {
  labelAr: '', labelEn: '', group: 'shipment' as FormField['group'],
  inputType: 'text' as FormField['inputType'],
  options: [] as { key: string; ar: string; en: string }[],
  required: false,
};

export default function FormSettingsPage() {
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const { confirm, notify } = useDialog();
  const admin = canAdminOrders(user?.role);

  const [fields, setFields] = useState<FormField[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<FormField | null>(null);
  const [form, setForm] = useState<any>(EMPTY);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await api.get<{ fields: FormField[] }>('/api/shipment-orders/fields?all=1');
      setFields(d.fields || []);
      setError('');
    } catch (e: any) { setError(e?.message || 'Request failed'); }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const openCreate = () => { setEditing(null); setForm(JSON.parse(JSON.stringify(EMPTY))); setShowModal(true); };
  const openEdit = (f: FormField) => {
    setEditing(f);
    setForm({
      labelAr: f.labelAr, labelEn: f.labelEn || '', group: f.group,
      inputType: f.inputType, options: (f.options || []).map((o) => ({ ...o })), required: f.required,
    });
    setShowModal(true);
  };

  const save = async () => {
    if (!form.labelAr.trim()) return;
    setSaving(true);
    try {
      const payload = {
        ...form,
        options: ['select', 'cards'].includes(form.inputType)
          ? form.options.filter((o: any) => (o.ar || o.en || o.key).trim())
            .map((o: any) => ({ key: o.key || o.ar || o.en, ar: o.ar || o.key, en: o.en || o.key }))
          : [],
      };
      if (editing) await api.put(`/api/shipment-orders/fields/${editing._id}`, payload);
      else await api.post('/api/shipment-orders/fields', payload);
      setShowModal(false); load();
    } catch (e: any) { notify(e.message, 'error'); }
    setSaving(false);
  };

  const toggleActive = async (f: FormField) => {
    try { await api.put(`/api/shipment-orders/fields/${f._id}`, { active: !f.active }); load(); }
    catch (e: any) { notify(e.message, 'error'); }
  };

  // Reorder within the group by swapping `order` with the neighbour.
  const nudge = async (f: FormField, dir: -1 | 1) => {
    const siblings = fields.filter((x) => x.group === f.group).sort((a, b) => a.order - b.order);
    const i = siblings.findIndex((x) => x._id === f._id);
    const other = siblings[i + dir];
    if (!other) return;
    try {
      await Promise.all([
        api.put(`/api/shipment-orders/fields/${f._id}`, { order: other.order }),
        api.put(`/api/shipment-orders/fields/${other._id}`, { order: f.order }),
      ]);
      load();
    } catch (e: any) { notify(e.message, 'error'); }
  };

  const remove = async (f: FormField) => {
    if (!(await confirm(ar
      ? `حذف الحقل «${f.labelAr}»؟ إجابات الشحنات السابقة عليه ستبقى محفوظة.`
      : `Delete “${f.labelAr}”? Past answers stay stored.`))) return;
    try { await api.delete(`/api/shipment-orders/fields/${f._id}`); load(); }
    catch (e: any) { notify(e.message, 'error'); }
  };

  if (!admin) return <div className="text-slate-500 p-8">{ar ? 'إعدادات النموذج للمشرفين فقط.' : 'Admins only.'}</div>;
  if (loading) return <Spinner />;

  const hasOptions = ['select', 'cards'].includes(form.inputType);
  const groups: FormField['group'][] = ['pickup_delivery', 'shipment', 'pricing_time', 'payment'];

  return (
    <div className="space-y-6 w-full" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader icon={<SlidersHorizontal className="w-5 h-5" />} title={ar ? 'إعدادات نموذج الشحنة' : 'Shipment form settings'}
        subtitle={ar ? 'حدِّد شكل كل حقل: قائمة أو بطاقات أو كتابة — وأضف أسئلة جديدة' : 'Decide each input: dropdown, cards or typed — and add new questions'}>
        <PrimaryButton onClick={openCreate}><Plus className="w-4 h-4" /> {ar ? 'إضافة حقل جديد' : 'Add a field'}</PrimaryButton>
      </PageHeader>

      {error && <ErrorNotice error={error} lang={lang} onRetry={load} />}

      {groups.map((g) => {
        const gf = fields.filter((f) => f.group === g).sort((a, b) => a.order - b.order);
        if (!gf.length) return null;
        return (
          <div key={g} className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
            <p className="px-5 py-3 bg-slate-50 border-b border-slate-200 text-sm font-bold text-slate-900">
              {ar ? GROUP_LABELS[g].ar : GROUP_LABELS[g].en}
            </p>
            <div className="divide-y divide-slate-100">
              {gf.map((f) => (
                <div key={f._id} className={`px-4 sm:px-5 py-3 flex flex-wrap sm:flex-nowrap items-center gap-2 sm:gap-3 ${!f.active ? 'opacity-50' : ''}`}>
                  <div className="flex flex-col gap-0.5 shrink-0">
                    <button type="button" onClick={() => nudge(f, -1)} className="text-slate-300 hover:text-slate-600" aria-label="up"><ChevronUp className="w-4 h-4" /></button>
                    <button type="button" onClick={() => nudge(f, 1)} className="text-slate-300 hover:text-slate-600" aria-label="down"><ChevronDown className="w-4 h-4" /></button>
                  </div>
                  <div className="flex-1 min-w-[55%] sm:min-w-0">
                    <p className="text-sm font-medium text-slate-900 flex items-center gap-2">
                      {fieldLabel(f, lang as Lang)}
                      {f.required && <span className="text-red-500">*</span>}
                      {CORE_FIELD_KEYS.has(f.key) && <Lock className="w-3 h-3 text-slate-300" aria-label="core" />}
                    </p>
                    <p className="text-xs text-slate-400">
                      {ar ? TYPE_LABELS[f.inputType].ar : TYPE_LABELS[f.inputType].en}
                      {f.options?.length ? ` · ${f.options.length} ${ar ? 'خيار' : 'options'}` : ''}
                    </p>
                  </div>
                  {!f.active && <SmallBadge bg="bg-slate-500/15" text="text-slate-600" label={ar ? 'مخفي' : 'Hidden'} />}
                  <div className="flex items-center gap-1 shrink-0 ms-auto">
                    <button type="button" onClick={() => toggleActive(f)} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100"
                      title={f.active ? (ar ? 'إخفاء من النموذج' : 'Hide from the form') : (ar ? 'إظهار' : 'Show')}>
                      {f.active ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                    </button>
                    <button type="button" onClick={() => openEdit(f)} className="p-1.5 rounded-lg text-slate-400 hover:text-[#f37121] hover:bg-slate-100" title={ar ? 'تعديل' : 'Edit'}>
                      <Pencil className="w-4 h-4" />
                    </button>
                    {!CORE_FIELD_KEYS.has(f.key) && (
                      <button type="button" onClick={() => remove(f)} className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-slate-100" title={ar ? 'حذف' : 'Delete'}>
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}

      <Modal open={showModal} onClose={() => setShowModal(false)} wide
        title={editing ? (ar ? `تعديل «${editing.labelAr}»` : `Edit “${editing.labelAr}”`) : (ar ? 'حقل جديد' : 'New field')}
        footer={<>
          <button type="button" onClick={() => setShowModal(false)} className="px-4 py-2 text-slate-500 hover:text-slate-900 text-sm">{ar ? 'إلغاء' : 'Cancel'}</button>
          <PrimaryButton onClick={save} disabled={saving || !form.labelAr.trim()}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}{ar ? 'حفظ' : 'Save'}
          </PrimaryButton>
        </>}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label={ar ? 'الاسم بالعربية *' : 'Arabic label *'}><TextInput value={form.labelAr} onChange={(e) => setForm((f: any) => ({ ...f, labelAr: e.target.value }))} /></Field>
          <Field label={ar ? 'الاسم بالإنجليزية' : 'English label'}><TextInput value={form.labelEn} onChange={(e) => setForm((f: any) => ({ ...f, labelEn: e.target.value }))} /></Field>
          <Field label={ar ? 'المجموعة' : 'Group'}>
            <Select value={form.group} disabled={!!editing?.isSystem} onChange={(e) => setForm((f: any) => ({ ...f, group: e.target.value }))}>
              {groups.map((g) => <option key={g} value={g}>{ar ? GROUP_LABELS[g].ar : GROUP_LABELS[g].en}</option>)}
            </Select>
          </Field>
          <Field label={ar ? 'شكل الإدخال' : 'Input type'}>
            <Select value={form.inputType} onChange={(e) => setForm((f: any) => ({ ...f, inputType: e.target.value }))}>
              {(Object.keys(TYPE_LABELS) as FormField['inputType'][]).map((t) => (
                <option key={t} value={t}>{ar ? TYPE_LABELS[t].ar : TYPE_LABELS[t].en}</option>
              ))}
            </Select>
          </Field>
          <label className="sm:col-span-2 flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={form.required} onChange={(e) => setForm((f: any) => ({ ...f, required: e.target.checked }))} className="w-4 h-4 accent-[#f37121]" />
            {ar ? 'حقل مطلوب' : 'Required'}
          </label>
        </div>

        {hasOptions && (
          <div className="mt-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold text-slate-600">{ar ? 'الخيارات' : 'Options'}</p>
              <button type="button"
                onClick={() => setForm((f: any) => ({ ...f, options: [...f.options, { key: '', ar: '', en: '' }] }))}
                className="text-xs text-[#f37121] hover:underline flex items-center gap-1"><Plus className="w-3 h-3" /> {ar ? 'إضافة خيار' : 'Add option'}</button>
            </div>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {form.options.map((o: any, i: number) => (
                <div key={i} className="flex items-center gap-2">
                  <TextInput value={o.ar} onChange={(e) => setForm((f: any) => ({ ...f, options: f.options.map((x: any, k: number) => (k === i ? { ...x, ar: e.target.value } : x)) }))} placeholder={ar ? 'عربي' : 'Arabic'} />
                  <TextInput value={o.en} onChange={(e) => setForm((f: any) => ({ ...f, options: f.options.map((x: any, k: number) => (k === i ? { ...x, en: e.target.value } : x)) }))} placeholder="English" />
                  <button type="button" onClick={() => setForm((f: any) => ({ ...f, options: f.options.filter((_: any, k: number) => k !== i) }))}
                    className="p-2 text-slate-400 hover:text-red-600 shrink-0" aria-label="remove"><X className="w-4 h-4" /></button>
                </div>
              ))}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
