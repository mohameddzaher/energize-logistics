'use client';
import { useState, useEffect, useCallback } from 'react';
import { useDialog } from '@/components/system/DialogProvider';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import { Server, Plus, Edit, Trash2, Check, ExternalLink } from 'lucide-react';
import { exportToExcel } from '@/utils/exportExcel';
import {
  Spinner, PageHeader, SearchInput, ExportButton, PrimaryButton, SmallBadge,
  Modal, Field, TextInput, TextArea, Select, StatCard, Loader2,
} from '@/components/hr/HRKit';
import {
  canViewIt, ItSystem, SYSTEM_TYPES, SYSTEM_STATUSES, ENVIRONMENTS, COST_PERIODS,
  systemTypeLabel, systemStatusLabel, environmentLabel, costPeriodLabel,
  optionsOf, fmtDate, fmtMoney, today, daysUntil, renewalTone,
} from '@/lib/it';

const EMPTY = {
  name: '', nameAr: '', type: 'saas', status: 'operational', vendor: '', url: '',
  environment: 'production', renewalDate: '', cost: 0, costPeriod: 'yearly',
  credentialsNote: '', description: '', notes: '',
};

export default function ItSystemsPage() {
  const { confirm, notify } = useDialog();
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const staff = canViewIt(user);

  const [systems, setSystems] = useState<ItSystem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<ItSystem | null>(null);
  const [form, setForm] = useState<any>(EMPTY);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const qs = new URLSearchParams();
      if (statusFilter) qs.set('status', statusFilter);
      if (typeFilter) qs.set('type', typeFilter);
      const d = await api.get<{ systems: ItSystem[] }>(`/api/it/systems?${qs.toString()}`);
      setSystems(d.systems || []);
    } catch {}
    setLoading(false);
  }, [statusFilter, typeFilter]);

  useEffect(() => { load(); }, [load]);
  useSocket('it:updated', useCallback(() => load(), [load]));

  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));
  const openCreate = () => { setEditing(null); setForm(EMPTY); setShowModal(true); };
  const openEdit = (s: ItSystem) => { setEditing(s); setForm({ ...EMPTY, ...s }); setShowModal(true); };

  const save = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      if (editing) await api.put(`/api/it/systems/${editing._id}`, form);
      else await api.post('/api/it/systems', form);
      setShowModal(false); load();
    } catch (e: any) { notify(e.message, 'error'); }
    setSaving(false);
  };

  const remove = async (s: ItSystem) => {
    if (!(await confirm(ar ? 'حذف هذا النظام؟' : 'Delete this system?'))) return;
    try { await api.delete(`/api/it/systems/${s._id}`); load(); } catch (e: any) { notify(e.message, 'error'); }
  };

  const filtered = systems.filter((s) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return [s.name, s.nameAr, s.vendor, s.url, s.description].some((v) => (v || '').toLowerCase().includes(q));
  });

  if (!staff) return <div className="text-slate-500 p-8">{ar ? 'غير مصرح لك بالوصول لهذا القسم.' : 'You are not authorized to view this section.'}</div>;
  if (loading) return <Spinner />;

  const operational = systems.filter((s) => s.status === 'operational').length;
  const down = systems.filter((s) => s.status === 'down' || s.status === 'degraded').length;
  const dueSoon = systems.filter((s) => { const d = daysUntil(s.renewalDate); return d !== null && d <= 30 && s.status !== 'retired'; }).length;
  // Annualised so monthly and yearly subscriptions are comparable in one number.
  const annualCost = systems.reduce((sum, s) => {
    if (!s.cost || s.status === 'retired') return sum;
    if (s.costPeriod === 'monthly') return sum + s.cost * 12;
    if (s.costPeriod === 'yearly') return sum + s.cost;
    return sum;
  }, 0);

  return (
    <div className="space-y-6" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader
        icon={<Server className="w-5 h-5" />}
        title={ar ? 'الأنظمة والخدمات' : 'Systems & Services'}
        subtitle={ar ? `${systems.length} نظام تحت إدارة تقنية المعلومات` : `${systems.length} systems under IT management`}
      >
        <ExportButton label={ar ? 'تصدير Excel' : 'Export Excel'} onClick={() => exportToExcel(filtered, [
          { header: 'Name', key: 'name', width: 26 },
          { header: 'Arabic name', key: 'nameAr', width: 24 },
          { header: 'Type', key: 'type', transform: (v: any) => systemTypeLabel(v, 'en'), width: 18 },
          { header: 'Status', key: 'status', transform: (v: any) => systemStatusLabel(v, 'en'), width: 14 },
          { header: 'Environment', key: 'environment', transform: (v: any) => environmentLabel(v, 'en'), width: 14 },
          { header: 'Vendor', key: 'vendor', width: 20 },
          { header: 'URL', key: 'url', width: 30 },
          { header: 'Renewal', key: 'renewalDate', width: 14 },
          { header: 'Cost', key: 'cost', width: 12 },
          { header: 'Period', key: 'costPeriod', transform: (v: any) => costPeriodLabel(v, 'en'), width: 12 },
        ], `it-systems-${today()}`, 'Systems')} />
        <PrimaryButton onClick={openCreate}><Plus className="w-4 h-4" /> {ar ? 'نظام جديد' : 'New system'}</PrimaryButton>
      </PageHeader>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label={ar ? 'تعمل بشكل طبيعي' : 'Operational'} value={operational} accent="text-green-600" />
        <StatCard label={ar ? 'متوقفة أو متعثرة' : 'Down / degraded'} value={down} accent={down ? 'text-red-600' : 'text-slate-900'} />
        <StatCard label={ar ? 'تجديدات خلال ٣٠ يوم' : 'Renewals ≤ 30d'} value={dueSoon} accent={dueSoon ? 'text-amber-600' : 'text-slate-900'} />
        <StatCard label={ar ? 'التكلفة السنوية' : 'Annualised cost'} value={fmtMoney(annualCost)} accent="text-[#f37121]" />
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex-1 min-w-[240px]">
          <SearchInput value={search} onChange={setSearch} placeholder={ar ? 'بحث بالاسم أو المورد...' : 'Search name or vendor...'} />
        </div>
        <div className="w-full sm:w-48 shrink-0">
          <Select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
            <option value="">{ar ? 'كل الأنواع' : 'All types'}</option>
            {optionsOf(SYSTEM_TYPES).map((o) => <option key={o.key} value={o.key}>{ar ? o.ar : o.en}</option>)}
          </Select>
        </div>
        <div className="w-full sm:w-48 shrink-0">
          <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">{ar ? 'كل الحالات' : 'All statuses'}</option>
            {optionsOf(SYSTEM_STATUSES).map((o) => <option key={o.key} value={o.key}>{ar ? o.ar : o.en}</option>)}
          </Select>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="bg-slate-900 border-b border-slate-200 text-slate-300">
            <th className="text-start font-semibold px-4 py-3">{ar ? 'النظام' : 'System'}</th>
            <th className="text-start font-semibold px-4 py-3">{ar ? 'النوع' : 'Type'}</th>
            <th className="text-start font-semibold px-4 py-3">{ar ? 'الحالة' : 'Status'}</th>
            <th className="text-start font-semibold px-4 py-3">{ar ? 'البيئة' : 'Environment'}</th>
            <th className="text-start font-semibold px-4 py-3">{ar ? 'المورد' : 'Vendor'}</th>
            <th className="text-start font-semibold px-4 py-3">{ar ? 'التجديد' : 'Renewal'}</th>
            <th className="text-start font-semibold px-4 py-3">{ar ? 'التكلفة' : 'Cost'}</th>
            <th className="text-end font-semibold px-4 py-3">{ar ? 'إجراءات' : 'Actions'}</th>
          </tr></thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={8} className="text-center text-slate-500 py-12">{ar ? 'لا توجد أنظمة مسجّلة.' : 'No systems found.'}</td></tr>
            ) : filtered.map((s) => {
              const d = daysUntil(s.renewalDate);
              return (
                <tr key={s._id} className="border-b border-slate-200/70 hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <div className="text-slate-900 font-medium">{ar && s.nameAr ? s.nameAr : s.name}</div>
                    {s.url && (
                      <a href={s.url} target="_blank" rel="noreferrer" className="text-xs text-slate-500 hover:text-[#f37121] inline-flex items-center gap-1">
                        {s.url} <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <SmallBadge bg={SYSTEM_TYPES[s.type]?.bg || 'bg-slate-500/15'} text={SYSTEM_TYPES[s.type]?.text || 'text-slate-700'} label={systemTypeLabel(s.type, lang)} />
                  </td>
                  <td className="px-4 py-3">
                    <SmallBadge bg={SYSTEM_STATUSES[s.status]?.bg || 'bg-slate-500/15'} text={SYSTEM_STATUSES[s.status]?.text || 'text-slate-700'} label={systemStatusLabel(s.status, lang)} />
                  </td>
                  <td className="px-4 py-3 text-slate-700 text-xs">{s.environment ? environmentLabel(s.environment, lang) : '—'}</td>
                  <td className="px-4 py-3 text-slate-700">{s.vendor || '—'}</td>
                  <td className="px-4 py-3">
                    {s.renewalDate ? (
                      <span className={`text-xs ${renewalTone(s.renewalDate)}`}>
                        {fmtDate(s.renewalDate)}
                        {d !== null && (
                          <span className="block">
                            {d < 0 ? (ar ? `متأخر ${Math.abs(d)} يوم` : `${Math.abs(d)}d overdue`) : (ar ? `بعد ${d} يوم` : `in ${d}d`)}
                          </span>
                        )}
                      </span>
                    ) : <span className="text-slate-400">—</span>}
                  </td>
                  <td className="px-4 py-3 text-slate-700">
                    {s.cost ? <>{fmtMoney(s.cost)} <span className="text-xs text-slate-500">/ {costPeriodLabel(s.costPeriod || 'yearly', lang)}</span></> : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <button type="button" onClick={() => openEdit(s)} className="p-1.5 rounded-lg text-slate-700 hover:text-[#f37121] hover:bg-slate-100" title={ar ? 'تعديل' : 'Edit'}><Edit className="w-4 h-4" /></button>
                      <button type="button" onClick={() => remove(s)} className="p-1.5 rounded-lg text-slate-700 hover:text-red-600 hover:bg-slate-100" title={ar ? 'حذف' : 'Delete'}><Trash2 className="w-4 h-4" /></button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Modal open={showModal} onClose={() => setShowModal(false)} wide
        title={editing ? (ar ? 'تعديل النظام' : 'Edit system') : (ar ? 'نظام جديد' : 'New system')}
        footer={<>
          <button type="button" onClick={() => setShowModal(false)} className="px-4 py-2 text-slate-500 hover:text-slate-900 text-sm">{ar ? 'إلغاء' : 'Cancel'}</button>
          <PrimaryButton onClick={save} disabled={saving || !form.name.trim()}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}{ar ? 'حفظ' : 'Save'}
          </PrimaryButton>
        </>}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label={ar ? 'الاسم (إنجليزي)' : 'Name (English)'}>
            <TextInput value={form.name} onChange={(e) => set('name', e.target.value)} />
          </Field>
          <Field label={ar ? 'الاسم بالعربية' : 'Arabic name'}>
            <TextInput value={form.nameAr || ''} onChange={(e) => set('nameAr', e.target.value)} />
          </Field>
          <Field label={ar ? 'النوع' : 'Type'}>
            <Select value={form.type} onChange={(e) => set('type', e.target.value)}>
              {optionsOf(SYSTEM_TYPES).map((o) => <option key={o.key} value={o.key}>{ar ? o.ar : o.en}</option>)}
            </Select>
          </Field>
          <Field label={ar ? 'الحالة' : 'Status'}>
            <Select value={form.status} onChange={(e) => set('status', e.target.value)}>
              {optionsOf(SYSTEM_STATUSES).map((o) => <option key={o.key} value={o.key}>{ar ? o.ar : o.en}</option>)}
            </Select>
          </Field>
          <Field label={ar ? 'البيئة' : 'Environment'}>
            <Select value={form.environment} onChange={(e) => set('environment', e.target.value)}>
              {optionsOf(ENVIRONMENTS).map((o) => <option key={o.key} value={o.key}>{ar ? o.ar : o.en}</option>)}
            </Select>
          </Field>
          <Field label={ar ? 'المورد' : 'Vendor'}>
            <TextInput value={form.vendor || ''} onChange={(e) => set('vendor', e.target.value)} />
          </Field>
          <Field label={ar ? 'الرابط' : 'URL'} span2>
            <TextInput value={form.url || ''} onChange={(e) => set('url', e.target.value)} placeholder="https://" />
          </Field>
          <Field label={ar ? 'تاريخ التجديد' : 'Renewal date'}>
            <TextInput type="date" value={form.renewalDate || ''} onChange={(e) => set('renewalDate', e.target.value)} />
          </Field>
          <Field label={ar ? 'التكلفة' : 'Cost'}>
            <TextInput type="number" value={form.cost ?? 0} onChange={(e) => set('cost', Number(e.target.value))} />
          </Field>
          <Field label={ar ? 'دورة التكلفة' : 'Cost period'}>
            <Select value={form.costPeriod} onChange={(e) => set('costPeriod', e.target.value)}>
              {optionsOf(COST_PERIODS).map((o) => <option key={o.key} value={o.key}>{ar ? o.ar : o.en}</option>)}
            </Select>
          </Field>
          <Field label={ar ? 'ملاحظة بيانات الدخول (بدون كلمات مرور)' : 'Credentials note (no passwords)'} span2>
            <TextInput value={form.credentialsNote || ''} onChange={(e) => set('credentialsNote', e.target.value)} placeholder={ar ? 'مثال: محفوظة في خزنة كلمات المرور' : 'e.g. stored in the password vault'} />
          </Field>
          <Field label={ar ? 'الوصف' : 'Description'} span2>
            <TextArea rows={2} value={form.description || ''} onChange={(e) => set('description', e.target.value)} />
          </Field>
          <Field label={ar ? 'ملاحظات' : 'Notes'} span2>
            <TextArea rows={2} value={form.notes || ''} onChange={(e) => set('notes', e.target.value)} />
          </Field>
        </div>
      </Modal>
    </div>
  );
}
