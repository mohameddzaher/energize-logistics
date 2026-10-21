'use client';
/**
 * تأجيرُ اليوزرات — حسابُ توصيلٍ على أحد مشاريعنا يُؤجَّر لشركةٍ أو لشخص.
 *
 * يُسجَّل المشروع، ولمن (شركة أو شخص) واسمُه ورقمُ إقامته، والتاريخُ يُكتب
 * تلقائيًّا يومَ التسجيل. والمؤجَّرُ الآن يُعَدّ في لوحة قسم الأفراد ضمن «إجمالي
 * المناديب» (كفالة + فري لانسر + يوزرات) ولكلّ مشروع. والتأجيرُ يُنهى ولا يُمحى.
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useDialog } from '@/components/system/DialogProvider';
import { useSocket } from '@/hooks/useSocket';
import { useLatestRequest } from '@/hooks/useLatestRequest';
import api from '@/lib/api';
import { canEditSection } from '@/lib/sections';
import { Spinner, PageHeader, Modal, Field, TextInput, TextArea, PrimaryButton } from '@/components/hr/HRKit';
import ManagedSelect from '@/components/system/ManagedSelect';
import PersonSelect from '@/components/system/PersonSelect';
import Link from 'next/link';
import ScrollX from '@/components/system/ScrollX';
import ExportMenu, { type ExportColumn } from '@/components/ls2/ExportMenu';
import { KeySquare, Plus, Pencil, Trash2, Ban, Search, Building2, User, Loader2 } from 'lucide-react';

interface Rental {
  _id: string; projectAr: string; renterType: 'company' | 'person'; renterName: string; idNumber: string;
  phone?: string; userAccount?: string; notes?: string; startDate: string; status: 'active' | 'ended';
  endDate?: string; endedByName?: string; createdByName?: string;
  /** صفُّ اليوزر في «موظفي النقل الخفيف» — الرابطُ بكروت اللوحة (backend utils/ltRental). */
  ltEmployee?: string | null;
  rep?: { _id: string; name: string; idNumber: string; projectAr: string; cityAr: string; vehiclePlate: string; status: string } | null;
}
interface Payload { items: Rental[]; counts: { active: number; byProject: Record<string, number> }; canDelete: boolean; today: string }

const EDIT_ROLES = ['super_admin', 'admin', 'b2c_manager', 'b2c_deputy', 'b2c_project_lead', 'it_manager', 'cfo', 'accounting_manager', 'accountant'];
const fmt = (d?: string) => (d ? d.slice(0, 10).split('-').reverse().join('/') : '—');
type Form = Partial<Rental>;

export default function UserRentalsPage() {
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const t = (a: string, e: string) => (ar ? a : e);
  const { notify, confirm } = useDialog();
  const canEdit = EDIT_ROLES.includes(user?.role || '') || canEditSection(user?.permissions, 'B2C');

  const [d, setD] = useState<Payload | null>(null);
  const [status, setStatus] = useState<'active' | 'ended' | ''>('active');
  const [project, setProject] = useState('');
  const [q, setQ] = useState('');
  const [form, setForm] = useState<Form | null>(null);
  const [saving, setSaving] = useState(false);
  const { begin, isCurrent } = useLatestRequest();

  const load = useCallback(async () => {
    const token = begin();
    const p = new URLSearchParams();
    if (status) p.set('status', status);
    if (project) p.set('project', project);
    if (q.trim()) p.set('q', q.trim());
    try {
      const r = await api.get<Payload>(`/api/light-transport/user-rentals?${p.toString()}`);
      if (isCurrent(token)) setD(r);
    } catch (e: any) { if (isCurrent(token)) notify(e?.message || t('تعذّر التحميل', 'Could not load'), 'error'); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, project, q]);
  useEffect(() => { const id = setTimeout(load, 250); return () => clearTimeout(id); }, [load]);
  useSocket('lt:updated', load);

  const projects = useMemo(() => Object.entries(d?.counts.byProject || {}).sort((a, b) => b[1] - a[1]), [d]);

  /**
   * ── والمشروعُ يُورَث من رابط اللوحة (?project=) ─────────────────────────
   * خليّةُ «يوزرات» في «إجمالي المناديب» تفتح هذه الصفحةَ على مشروعها. واللوحةُ
   * تطوي «هنقرستيشن» و«هنجرستيشن» مشروعًا واحدًا، فإن لم يطابق الاسمُ حرفيًّا
   * مشروعًا هنا يُؤخذ أوّلُ ما يطابقه مطويًّا — مرّةً واحدةً عند الفتح.
   */
  const [urlProject, setUrlProject] = useState('');
  useEffect(() => {
    try {
      const p = new URLSearchParams(window.location.search).get('project') || '';
      if (p) { setProject(p); setUrlProject(p); }
    } catch { /* بلا رابطٍ تُفتح الصفحةُ على الكلّ */ }
  }, []);
  useEffect(() => {
    if (!urlProject || !d) return;
    const fold = (v: string) => v.replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/ق/g, 'ج').replace(/\s+/g, '');
    const names = Object.keys(d.counts.byProject || {});
    if (!names.includes(urlProject)) {
      const hit = names.find((n) => fold(n) === fold(urlProject));
      if (hit) setProject(hit);
    }
    setUrlProject('');
  }, [d, urlProject]);

  const save = async () => {
    if (!form) return;
    if (!form.projectAr) { notify(t('اختر المشروع', 'Pick the project'), 'error'); return; }
    if (!form.renterType) { notify(t('لشركة أم لشخص؟', 'Company or person?'), 'error'); return; }
    if (!String(form.renterName || '').trim()) { notify(t('اكتب اسم الشركة أو الشخص', 'Enter the company or person name'), 'error'); return; }
    if (!String(form.idNumber || '').trim()) { notify(t('اكتب رقم الإقامة', 'Enter the iqama number'), 'error'); return; }
    setSaving(true);
    try {
      const body = { projectAr: form.projectAr, renterType: form.renterType, renterName: form.renterName, idNumber: form.idNumber, phone: form.phone || '', userAccount: form.userAccount || '', notes: form.notes || '', ltEmployee: form.ltEmployee || '' };
      if (form._id) await api.put(`/api/light-transport/user-rentals/${form._id}`, body);
      else await api.post('/api/light-transport/user-rentals', body);
      notify(form._id ? t('عُدِّل التأجير', 'Updated') : t('سُجِّل التأجير', 'Rental recorded'), 'success');
      setForm(null); load();
    } catch (e: any) { notify(e?.message || t('تعذّر الحفظ', 'Could not save'), 'error'); }
    setSaving(false);
  };

  const end = async (r: Rental) => {
    if (!(await confirm({ title: t('إنهاء التأجير؟', 'End this rental?'), message: t(`يوزر ${r.projectAr} المؤجَّر لـ${r.renterName} — يُسجَّل منتهيًا اليوم ويخرج من أرقام اللوحة، ويبقى في السجلّ.`, 'It is recorded as ended today, leaves the dashboard counts and stays in the register.'), confirmLabel: t('إنهاء', 'End') }))) return;
    try { await api.post(`/api/light-transport/user-rentals/${r._id}/end`, {}); notify(t('انتهى التأجير', 'Rental ended'), 'success'); load(); }
    catch (e: any) { notify(e?.message || t('تعذّر', 'Failed'), 'error'); }
  };
  const remove = async (r: Rental) => {
    if (!(await confirm({ title: t('حذف هذا التأجير؟', 'Delete this rental?'), message: t('الحذفُ لتصحيح إدخالٍ خاطئ — لإنهاء تأجيرٍ فعليّ استخدم «إنهاء».', 'Delete is for a wrong entry — to end a real rental use «End».'), confirmLabel: t('حذف', 'Delete'), tone: 'danger' }))) return;
    try { await api.delete(`/api/light-transport/user-rentals/${r._id}`); notify(t('حُذف', 'Deleted'), 'success'); load(); }
    catch (e: any) { notify(e?.message || t('تعذّر الحذف', 'Delete failed'), 'error'); }
  };

  if (!d) return <Spinner />;
  const exportCols: ExportColumn[] = [
    { header: t('المشروع', 'Project'), key: 'projectAr', width: 14 },
    { header: t('لمن', 'To'), key: 'renterType', width: 10, transform: (v) => (v === 'company' ? t('شركة', 'Company') : t('شخص', 'Person')) },
    { header: t('الاسم', 'Name'), key: 'renterName', width: 28 },
    { header: t('رقم الإقامة', 'Iqama no.'), key: 'idNumber', width: 16 },
    { header: t('الجوال', 'Phone'), key: 'phone', width: 14, transform: (v) => v || '—' },
    { header: t('اليوزر', 'User account'), key: 'userAccount', width: 16, transform: (v) => v || '—' },
    { header: t('تاريخ التأجير', 'Rented on'), key: 'startDate', width: 13, transform: (v) => fmt(v) },
    { header: t('الحالة', 'Status'), key: 'status', width: 10, transform: (v) => (v === 'active' ? t('مؤجَّر', 'Active') : t('منتهٍ', 'Ended')) },
    { header: t('تاريخ الإنهاء', 'Ended on'), key: 'endDate', width: 13, transform: (v) => fmt(v) },
    { header: t('ملاحظات', 'Notes'), key: 'notes', width: 30, transform: (v) => v || '—' },
  ];

  return (
    <div className="space-y-4 pb-10" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader icon={<KeySquare className="w-6 h-6 text-[#f37121]" />}
        title={t('تأجير اليوزرات', 'User rentals')}
        subtitle={t('يوزر على أحد مشاريعنا مؤجَّر لشركة أو شخص — يُعَدّ في لوحة القسم ضمن إجمالي المناديب', 'A delivery account on one of our projects rented to a company or person — counted in the section dashboard with the reps')}>
        {canEdit && (
          <PrimaryButton onClick={() => setForm({ renterType: 'person' })}><Plus className="h-4 w-4" />{t('تأجير يوزر', 'Rent a user')}</PrimaryButton>
        )}
      </PageHeader>

      {/* المؤجَّرُ الآن — والضغطُ على مشروعٍ يفلتر الجدول. */}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-5">
        <button type="button" onClick={() => setProject('')}
          className={`rounded-xl border bg-white px-3.5 py-3 text-start shadow-sm ${!project ? 'border-[#f37121] ring-2 ring-[#f37121]/20' : 'border-slate-200'}`}>
          <p className="text-[11px] text-slate-500">{t('يوزرات مؤجَّرة الآن', 'Rented now')}</p>
          <p className="text-[21px] font-extrabold tabular-nums text-[#f37121]">{d.counts.active}</p>
        </button>
        {projects.map(([p, n]) => (
          <button key={p} type="button" onClick={() => setProject(project === p ? '' : p)}
            className={`rounded-xl border bg-white px-3.5 py-3 text-start shadow-sm ${project === p ? 'border-[#f37121] ring-2 ring-[#f37121]/20' : 'border-slate-200'}`}>
            <p className="text-[11px] text-slate-500">{p}</p>
            <p className="text-[21px] font-extrabold tabular-nums text-slate-900">{n}</p>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
        {([['active', t('المؤجَّرة الآن', 'Active')], ['ended', t('المنتهية', 'Ended')], ['', t('الكل', 'All')]] as const).map(([k, label]) => (
          <button key={k || 'all'} type="button" onClick={() => setStatus(k)}
            className={`rounded-lg px-3 py-1.5 text-[12.5px] font-semibold ${status === k ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>{label}</button>
        ))}
        <div className="relative">
          <Search className="absolute start-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('الاسم، رقم الإقامة، اليوزر…', 'Name, iqama, account…')}
            className="w-60 rounded-lg border border-slate-200 py-2 pe-2 ps-8 text-[13px] focus:outline-none focus:ring-2 focus:ring-[#f37121]/40" />
        </div>
        <span className="ms-auto">
          <ExportMenu fileName="user-rentals" lang={ar ? 'ar' : 'en'} variant="subtle"
            options={[{ key: 'shown', label: t('المعروض', 'Shown'), sheets: [{ name: t('تأجير اليوزرات', 'User rentals'), rows: d.items, columns: exportCols }] }]} />
        </span>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <ScrollX>
          <table className="w-full min-w-[900px] text-[13px]">
            <thead>
              <tr className="bg-slate-900 text-slate-300">
                {[t('المشروع', 'Project'), t('اليوزر في سجلّ القسم', 'User in the section register'), t('لمن', 'To'), t('رقم الإقامة', 'Iqama no.'), t('اليوزر', 'Account'), t('تاريخ التأجير', 'Rented on'), t('الحالة', 'Status'), t('سجّله', 'By'), ''].map((h, i) => (
                  <th key={i} className="px-3 py-2.5 text-start font-semibold whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {d.items.length === 0 ? (
                <tr><td colSpan={9} className="py-12 text-center text-slate-400">{t('لا تأجيرات في هذا العرض.', 'No rentals in this view.')}</td></tr>
              ) : d.items.map((r) => (
                <tr key={r._id} className={`hover:bg-slate-50 ${r.status === 'ended' ? 'opacity-60' : ''}`}>
                  <td className="px-3 py-2.5 font-semibold text-slate-800">{r.projectAr}</td>
                  <td className="px-3 py-2.5">
                    {r.rep ? (
                      <Link href={`/system/b2c/light-transport/${r.rep._id}`} className="font-semibold text-[#f37121] hover:underline">{r.rep.name}</Link>
                    ) : <span className="text-[12px] text-amber-700">{t('غير مربوط — عدِّله واختر اليوزر', 'Not linked — edit and pick the user')}</span>}
                    {r.rep && (
                      <span className="block text-[11.5px] text-slate-500">
                        {[r.rep.projectAr, r.rep.vehiclePlate, r.rep.status].filter(Boolean).join(' · ')}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    <span className="inline-flex items-center gap-1.5 font-semibold text-slate-800">
                      {r.renterType === 'company' ? <Building2 className="h-3.5 w-3.5 text-slate-400" /> : <User className="h-3.5 w-3.5 text-slate-400" />}
                      {r.renterName}
                    </span>
                    {(r.phone || r.notes) && <span className="block text-[11.5px] text-slate-500">{[r.phone, r.notes].filter(Boolean).join(' · ')}</span>}
                  </td>
                  <td className="px-3 py-2.5 font-mono text-slate-700"><bdi>{r.idNumber}</bdi></td>
                  <td className="px-3 py-2.5 text-slate-600">{r.userAccount || '—'}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-slate-600">{fmt(r.startDate)}</td>
                  <td className="px-3 py-2.5">
                    {r.status === 'active'
                      ? <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11.5px] font-bold text-emerald-700">{t('مؤجَّر', 'Active')}</span>
                      : <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11.5px] font-bold text-slate-500">{t(`منتهٍ ${fmt(r.endDate)}`, `Ended ${fmt(r.endDate)}`)}</span>}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-slate-500">{r.createdByName || '—'}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-end">
                    {canEdit && (
                      <>
                        <button type="button" onClick={() => setForm(r)} title={t('تعديل', 'Edit')} className="p-1 text-slate-300 hover:text-[#f37121]"><Pencil className="h-4 w-4" /></button>
                        {r.status === 'active' && <button type="button" onClick={() => end(r)} title={t('إنهاء التأجير', 'End rental')} className="p-1 text-slate-300 hover:text-amber-600"><Ban className="h-4 w-4" /></button>}
                      </>
                    )}
                    {d.canDelete && <button type="button" onClick={() => remove(r)} title={t('حذف', 'Delete')} className="p-1 text-slate-300 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollX>
      </div>

      {form && (
        <Modal open onClose={() => setForm(null)} title={form._id ? t('تعديل تأجير يوزر', 'Edit rental') : t('تأجير يوزر', 'Rent a user')}
          footer={<>
            <button type="button" onClick={() => setForm(null)} className="px-4 py-2 text-sm text-slate-500">{t('إلغاء', 'Cancel')}</button>
            <PrimaryButton onClick={save} disabled={saving}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}{t('حفظ', 'Save')}</PrimaryButton>
          </>}>
          <div className="space-y-3">
            {/* اليوزرُ صفٌّ في «موظفي النقل الخفيف»: يُختار فيُربط التأجيرُ بكروت اللوحة،
                ويتبعه مشروعُه (نقلُ مشروعه ينقل التأجير) ونوعُ عقده («يوزرات» ما دام مؤجَّرًا). */}
            <Field label={t('اليوزر (من موظفي النقل الخفيف)', 'User (from light-transport staff)')}>
              <PersonSelect endpoint="/api/light-transport/people" ar={ar} onlyLt clearLabel={t('غير مربوط', 'Not linked')}
                idNumber={form.ltEmployee ? (form.rep?.idNumber || form.idNumber || '') : ''}
                name={form.ltEmployee ? (form.rep?.name || '') : ''}
                onChange={(p) => setForm((prev) => ({
                  ...prev!,
                  ltEmployee: p ? p.ltId : null,
                  rep: p ? { _id: p.ltId, name: p.name, idNumber: p.idNumber, projectAr: p.projectAr, cityAr: '', vehiclePlate: p.vehiclePlate, status: '' } : null,
                  ...(p ? { projectAr: p.projectAr || prev?.projectAr, userAccount: prev?.userAccount || p.name, idNumber: prev?.idNumber || p.idNumber } : {}),
                }))} />
            </Field>
            <Field label={t('المشروع *', 'Project *')}>
              <ManagedSelect storeLabel type="lt_project" value={form.projectAr || ''} disabled={!!form.ltEmployee} onChange={(v) => setForm((p) => ({ ...p!, projectAr: v }))} />
              {form.ltEmployee && <span className="mt-1 block text-[11px] text-slate-400">{t('مشروعُ اليوزر في سجلّ القسم — يتغيّر بـ«نقل مشروع» من صفحته.', 'The user’s project in the section register — changed with «Transfer project» on his page.')}</span>}
            </Field>
            <Field label={t('مؤجَّر لـ *', 'Rented to *')}>
              <div className="flex gap-2">
                {([['person', t('شخص', 'Person')], ['company', t('شركة', 'Company')]] as const).map(([k, label]) => (
                  <button key={k} type="button" onClick={() => setForm((p) => ({ ...p!, renterType: k }))}
                    className={`rounded-lg px-4 py-2 text-[13px] font-bold ${form.renterType === k ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200'}`}>{label}</button>
                ))}
              </div>
            </Field>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label={form.renterType === 'company' ? t('اسم الشركة *', 'Company name *') : t('اسم الشخص *', 'Person name *')}>
                <TextInput value={form.renterName || ''} onChange={(e) => setForm((p) => ({ ...p!, renterName: e.target.value }))} />
              </Field>
              <Field label={t('رقم الإقامة *', 'Iqama number *')}>
                <TextInput value={form.idNumber || ''} dir="ltr" inputMode="numeric" onChange={(e) => setForm((p) => ({ ...p!, idNumber: e.target.value }))} />
              </Field>
              <Field label={t('الجوال', 'Phone')}>
                <TextInput value={form.phone || ''} dir="ltr" onChange={(e) => setForm((p) => ({ ...p!, phone: e.target.value }))} />
              </Field>
              <Field label={t('اليوزر (اسم الحساب أو رقمه)', 'User account')}>
                <TextInput value={form.userAccount || ''} dir="ltr" onChange={(e) => setForm((p) => ({ ...p!, userAccount: e.target.value }))} />
              </Field>
            </div>
            <Field label={t('ملاحظات', 'Notes')}>
              <TextArea rows={2} value={form.notes || ''} onChange={(e) => setForm((p) => ({ ...p!, notes: e.target.value }))} />
            </Field>
            <p className="text-[11.5px] text-slate-500">
              {form._id ? t(`تاريخ التأجير: ${fmt(form.startDate)} — لا يُعدَّل.`, `Rented on ${fmt(form.startDate)} — not editable.`)
                : t(`تاريخ التأجير يُسجَّل تلقائيًّا: ${fmt(d.today)}`, `The rental date is recorded automatically: ${fmt(d.today)}`)}
            </p>
          </div>
        </Modal>
      )}
    </div>
  );
}
