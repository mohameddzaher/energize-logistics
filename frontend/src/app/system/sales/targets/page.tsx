'use client';
import { useState, useEffect, useCallback } from 'react';
import MonthPicker from '@/components/system/MonthPicker';
import { useDialog } from '@/components/system/DialogProvider';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import { useLatestRequest } from '@/hooks/useLatestRequest';
import api from '@/lib/api';
import { Target, Plus, Trash2, Edit } from 'lucide-react';
import { isSalesStaff, canSetSalesTargets, SalesTarget, money, userName, thisPeriod, periodFromUrl } from '@/lib/finance';
import { Spinner, PageHeader, PrimaryButton, Modal, Field, TextInput, TextArea, Select, ErrorNotice } from '@/components/hr/HRKit';
import { getSalesTargetsTranslations } from '@/lib/translations';
import ExportMenu, { exportScopeLabels, type ExportColumn } from '@/components/ls2/ExportMenu';
import ScrollX from '@/components/system/ScrollX';

const EMPTY = { rep: '', period: thisPeriod(), amountTarget: 0, dealsTarget: 0, notes: '' };

export default function SalesTargetsPage() {
  const { confirm, notify } = useDialog();
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const tx = getSalesTargetsTranslations(lang);
  const [items, setItems] = useState<SalesTarget[]>([]);
  const [reps, setReps] = useState<any[]>([]);
  // الشهرُ من الرابط إن جاء من بطاقة «الهدف» في اللوحة.
  const [period, setPeriod] = useState(() => periodFromUrl(thisPeriod()));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const guard = useLatestRequest();
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<SalesTarget | null>(null);
  const [form, setForm] = useState<any>(EMPTY);
  const [saving, setSaving] = useState(false);

  // الهدفُ يضعه المدير: القاعدةُ نفسُها التي يحرس بها الخادم (راجع canSetSalesTargets).
  const canEdit = canSetSalesTargets(user);

  const load = useCallback(async () => {
    const mine = guard.begin();
    try {
      const d = await api.get<{ targets: SalesTarget[] }>(`/api/sales/targets?period=${period}`);
      if (!guard.isCurrent(mine)) return;
      setItems(d.targets || []); setError('');
    } catch (e: any) {
      if (!guard.isCurrent(mine)) return;
      setError(e?.message || 'Request failed');
    }
    setLoading(false);
  }, [period, guard]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { api.get<{ reps: any[] }>('/api/sales/options').then((d) => setReps(d.reps || [])).catch(() => {}); }, []);
  useSocket('sales:updated', useCallback(() => load(), [load]));

  const openCreate = () => { setEditing(null); setForm({ ...EMPTY, period }); setShowModal(true); };
  const openEdit = (t: SalesTarget) => { setEditing(t); setForm({ ...EMPTY, ...t, notes: t.notes || '', rep: typeof t.rep === 'object' ? t.rep?._id : (t.rep || '') }); setShowModal(true); };
  const save = async () => {
    if (!form.period) { notify(ar ? 'اختر الشهر أوّلًا' : 'Pick a month first', 'error'); return; }
    // هدفٌ جديدٌ لمندوبٍ له هدفٌ في الشهر نفسِه يستبدله على الخادم — فيُسأل قبله.
    if (!editing) {
      const clash = items.find((t) => t.period === form.period
        && String((typeof t.rep === 'object' ? t.rep?._id : t.rep) || '') === String(form.rep || ''));
      if (clash && !(await confirm(ar
        ? 'لهذا المندوب هدفٌ محدَّدٌ في هذا الشهر. هل تريد استبداله؟'
        : 'A target already exists for this rep and month. Replace it?'))) return;
    }
    setSaving(true);
    try {
      // لا يُرسَل إلّا ما يقرؤه الخادم — لا السجلُّ كلُّه بمعرّفه وتواريخه.
      const payload = {
        rep: form.rep || null, period: form.period, notes: form.notes || '',
        amountTarget: Number(form.amountTarget) || 0, dealsTarget: Number(form.dealsTarget) || 0,
      };
      if (editing) await api.put(`/api/sales/targets/${editing._id}`, payload);
      else await api.post('/api/sales/targets', payload);
      // الشهرُ المحفوظُ هو المعروض: هدفٌ يُحفَظ لشهرٍ آخر كان يختفي من الجدول فيُظنّ أنّه لم يُحفَظ.
      setShowModal(false);
      if (!editing && form.period !== period) setPeriod(form.period); else load();
    } catch (e: any) { notify(e.message, 'error'); } finally { setSaving(false); }
  };
  const remove = async (t: SalesTarget) => {
    if (!(await confirm(tx.confirmDelete))) return;
    try { await api.delete(`/api/sales/targets/${t._id}`); load(); } catch (e: any) { notify(e.message, 'error'); }
  };

  const exportColumns: ExportColumn[] = [
    { header: tx.rep, key: 'rep', width: 24, transform: (v) => (v ? userName(v) : tx.wholeTeam) },
    { header: tx.period, key: 'period', width: 14 },
    { header: tx.amountTarget, key: 'amountTarget', width: 18, transform: (v) => money(v) },
    { header: tx.dealsTarget, key: 'dealsTarget', width: 14 },
    { header: ar ? 'ملاحظات' : 'Notes', key: 'notes', width: 30 },
  ];
  // الشاشة لا تُظهر إلّا مستهدفات الشهر المختار لأنّ الفلترة على الخادم، ومن صدّر
  // «الأهداف» ظنَّها كلَّها؛ فصار «الكلّ» نداءً بلا معامل الفترة يجلب كلَّ الشهور.
  const fetchAllForExport = async () => {
    const d = await api.get<{ targets: SalesTarget[] }>('/api/sales/targets');
    return [{ name: tx.pageTitle, rows: (d.targets || []) as unknown as Record<string, any>[], columns: exportColumns }];
  };
  const scope = exportScopeLabels(ar);
  const exportOptions = [
    { key: 'shown', label: scope.shown, sheets: [{ name: tx.pageTitle, rows: items as unknown as Record<string, any>[], columns: exportColumns }] },
    { key: 'all', label: scope.all, resolve: fetchAllForExport },
  ];

  if (!isSalesStaff(user)) return <div className="text-slate-500 p-8">{tx.notAuthorized}</div>;
  if (loading) return <Spinner />;

  return (
    <div className="space-y-6" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader icon={<Target className="w-5 h-5" />} title={tx.pageTitle}>
        <MonthPicker value={period} onChange={setPeriod} ar={lang === 'ar'} label={tx.period} />
        <ExportMenu fileName="sales-targets" lang={ar ? 'ar' : 'en'} variant="subtle" label={ar ? 'تصدير Excel' : 'Export Excel'} options={exportOptions} />
        {canEdit && <PrimaryButton onClick={openCreate}><Plus className="w-4 h-4" /> {tx.setTarget}</PrimaryButton>}
      </PageHeader>

      {error && <ErrorNotice error={error} lang={lang} onRetry={load} />}

      <ScrollX className="bg-white border border-slate-200 rounded-xl shadow-sm">
        <table className="w-full text-sm">
          <thead><tr className="bg-slate-900 border-b border-slate-200 text-start text-slate-300">
            <th className="px-4 py-3">{tx.rep}</th>
            <th className="px-4 py-3">{tx.period}</th>
            <th className="px-4 py-3 text-end">{tx.amountTarget}</th>
            <th className="px-4 py-3 text-end">{tx.dealsTarget}</th>
            <th className="px-4 py-3 text-end">{tx.actions}</th>
          </tr></thead>
          <tbody className="divide-y divide-slate-200">
            {items.length === 0 ? <tr><td colSpan={5} className="px-4 py-10 text-center text-slate-800">—</td></tr> : items.map((t) => (
              <tr key={t._id} className="hover:bg-slate-100">
                <td className="px-4 py-3 text-slate-900">{t.rep ? userName(t.rep) : tx.wholeTeam}</td>
                <td className="px-4 py-3 text-slate-700">{t.period}</td>
                <td className="px-4 py-3 text-end text-slate-900">{money(t.amountTarget)}</td>
                <td className="px-4 py-3 text-end text-slate-700">{t.dealsTarget}</td>
                <td className="px-4 py-3"><div className="flex items-center justify-end gap-2">
                  {canEdit && <button type="button" title={tx.edit} onClick={() => openEdit(t)} className="text-blue-600 hover:text-blue-700"><Edit className="w-4 h-4" /></button>}
                  {canEdit && <button type="button" title={tx.delete} onClick={() => remove(t)} className="text-red-600 hover:text-red-700"><Trash2 className="w-4 h-4" /></button>}
                </div></td>
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollX>

      <Modal open={showModal} onClose={() => setShowModal(false)} title={editing ? tx.editTarget : tx.newTarget}
        footer={<><button type="button" onClick={() => setShowModal(false)} className="px-4 py-2 bg-slate-100 text-slate-700 rounded-lg text-sm">{tx.cancel}</button>
          <PrimaryButton onClick={save} disabled={saving}>{saving ? '...' : tx.save}</PrimaryButton></>}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label={tx.rep} span2><Select value={form.rep} onChange={(e) => setForm({ ...form, rep: e.target.value })} disabled={!!editing}>
            <option value="">{tx.wholeTeam}</option>
            {reps.map((r) => <option key={r._id} value={r._id}>{r.firstName} {r.lastName}</option>)}
          </Select></Field>
          {/* الشهرُ قائمتان لا حقلٌ أصليّ: سفاري وفايرفوكس يرسمانه خانةَ نصّ. */}
          <Field label={tx.period}>
            {editing
              ? <TextInput value={form.period} disabled onChange={() => {}} />
              : <MonthPicker value={form.period} onChange={(v) => setForm({ ...form, period: v })} ar={lang === 'ar'} allowEmpty={false} />}
          </Field>
          <Field label={tx.amountTarget}><TextInput type="number" min={0} value={form.amountTarget} onChange={(e) => setForm({ ...form, amountTarget: e.target.value })} dir="ltr" /></Field>
          <Field label={tx.dealsTarget}><TextInput type="number" min={0} value={form.dealsTarget} onChange={(e) => setForm({ ...form, dealsTarget: e.target.value })} dir="ltr" /></Field>
          {/* الملاحظةُ في النموذج والهاتف، وكانت الشاشةُ لا تعرضها ولا تكتبها. */}
          <Field label={ar ? 'ملاحظات' : 'Notes'} span2><TextArea value={form.notes || ''} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} /></Field>
        </div>
      </Modal>
    </div>
  );
}
