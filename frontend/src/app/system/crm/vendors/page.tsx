'use client';
// CRM Vendors (الموردين) — carriers/transporters Energize subcontracts in 3PL.
// Self-contained; independent of the rest of CRM.
import { useState, useEffect, useCallback } from 'react';
import { useDialog } from '@/components/system/DialogProvider';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import { isCrmStaff, isCrmAdmin } from '@/lib/crm';
import { Truck, Plus, Edit, Trash2, Eye, Check, X, RefreshCw, Star } from 'lucide-react';
import { Spinner, PageHeader, PrimaryButton, Modal, Field, TextInput, TextArea, Select, ContactButtons } from '@/components/crm/CrmKit';
import PortalAccountCard from '@/components/system/PortalAccountCard';
import ReportButton from '@/components/system/ReportButton';
import ExportMenu, { exportScopeLabels, type ExportColumn } from '@/components/ls2/ExportMenu';

type Vendor = Record<string, any>;
interface Options { energizeReps: string[]; followUpStatuses: string[]; vendorTypes: string[]; headOffices: string[] }

const EMPTY = {
  name: '', isNewVendor: false, energizeRep: '', vendorType: '', representative: '', mobile: '', email: '',
  destinations: '', headOffice: '', carsCount: '', hasPapers: '', vendorSideSigned: '', ourSideSigned: '',
  contractDate: '', followUpStatus: '', notes: '',
};

const statusStyle = (s?: string) => {
  const v = s || '';
  if (v.includes('موقع')) return 'bg-emerald-100 text-emerald-700';
  if (v.includes('ارسال العقد')) return 'bg-blue-100 text-blue-700';
  if (v.includes('متابعة')) return 'bg-amber-100 text-amber-700';
  if (v.includes('معلق')) return 'bg-slate-200 text-slate-700';
  if (v.includes('معتذر') || v.includes('غير')) return 'bg-rose-100 text-rose-700';
  return 'bg-slate-100 text-slate-700';
};
const triState = (v: any, ar: boolean) => v === true ? (ar ? 'نعم' : 'Yes') : v === false ? (ar ? 'لا' : 'No') : '—';

export default function CrmVendorsPage() {
  const { confirm, notify } = useDialog();
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const t = (en: string, a: string) => (ar ? a : en);
  const admin = isCrmAdmin(user);

  const [items, setItems] = useState<Vendor[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [opts, setOpts] = useState<Options | null>(null);
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [fStatus, setFStatus] = useState('');
  const [fRep, setFRep] = useState('');
  const [fType, setFType] = useState('');
  const [fNew, setFNew] = useState('');

  const [detail, setDetail] = useState<Vendor | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Vendor | null>(null);
  const [form, setForm] = useState<any>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => { const x = setTimeout(() => setDebounced(search.trim()), 350); return () => clearTimeout(x); }, [search]);

  const load = useCallback(async () => {
    try {
      const qs = new URLSearchParams();
      if (debounced) qs.set('search', debounced);
      if (fStatus) qs.set('followUpStatus', fStatus);
      if (fRep) qs.set('energizeRep', fRep);
      if (fType) qs.set('vendorType', fType);
      if (fNew) qs.set('isNew', fNew);
      const d = await api.get<{ items: Vendor[] }>(`/api/crm-vendors?${qs.toString()}`);
      setItems(d.items || []);
    } catch { /* keep last */ }
    setLoaded(true);
  }, [debounced, fStatus, fRep, fType, fNew]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { api.get<Options>('/api/crm-vendors/options').then(setOpts).catch(() => {}); }, []);
  useSocket('crm:vendor', useCallback(() => { load(); api.get<Options>('/api/crm-vendors/options').then(setOpts).catch(() => {}); }, [load]));

  const set = (k: string, v: any) => setForm((p: any) => ({ ...p, [k]: v }));
  const openCreate = () => { setEditing(null); setForm(EMPTY); setErr(''); setShowForm(true); };
  const openEdit = (v: Vendor) => {
    setEditing(v);
    setForm({
      ...EMPTY, ...v,
      carsCount: v.carsCount ?? '',
      hasPapers: v.hasPapers === true ? 'true' : v.hasPapers === false ? 'false' : '',
      vendorSideSigned: v.vendorSideSigned === true ? 'true' : v.vendorSideSigned === false ? 'false' : '',
      ourSideSigned: v.ourSideSigned === true ? 'true' : v.ourSideSigned === false ? 'false' : '',
    });
    setErr(''); setShowForm(true);
  };

  const tri = (v: any) => v === 'true' ? true : v === 'false' ? false : null;
  const save = async () => {
    if (!form.name.trim()) { setErr(t('Name is required', 'الاسم مطلوب')); return; }
    setSaving(true); setErr('');
    try {
      const body = {
        ...form,
        carsCount: form.carsCount === '' ? null : Number(form.carsCount),
        hasPapers: tri(form.hasPapers), vendorSideSigned: tri(form.vendorSideSigned), ourSideSigned: tri(form.ourSideSigned),
      };
      if (editing) await api.put(`/api/crm-vendors/${editing._id}`, body);
      else await api.post('/api/crm-vendors', body);
      setShowForm(false); load();
    } catch (e: any) { setErr(e?.message || t('Save failed', 'فشل الحفظ')); }
    setSaving(false);
  };
  const remove = async (v: Vendor) => {
    if (!(await confirm(t('Delete this vendor?', 'حذف هذا المورد؟')))) return;
    try { await api.delete(`/api/crm-vendors/${v._id}`); load(); } catch (e: any) { notify(e?.message || 'Failed', 'error'); }
  };

  const anyFilter = !!(debounced || fStatus || fRep || fType || fNew);
  const clearAll = () => { setSearch(''); setFStatus(''); setFRep(''); setFType(''); setFNew(''); };

  // نفس الأعمدة تُستعمل للمعروض وللسجلّ كامله، وفيها ما لا يتّسع له الجدول
  // (البريد، الأوراق، التوقيعان، تاريخ العقد، الملاحظات) لأن ملفّ الموردين
  // يُراجَع للتعاقد لا للاطّلاع السريع.
  const scope = exportScopeLabels(ar);
  const vendorCols: ExportColumn[] = [
    { header: t('Vendor', 'المورد'), key: 'name', width: 30 },
    { header: t('New?', 'مورد جديد؟'), key: 'isNewVendor', transform: (v: any) => (v ? t('New', 'جديد') : t('Existing', 'قديم')), width: 12 },
    { header: t('Representative', 'ممثل المورد'), key: 'representative', width: 22 },
    { header: t('Phone', 'الهاتف'), key: 'mobile', width: 16 },
    { header: t('Email', 'البريد'), key: 'email', width: 26 },
    { header: t('Our rep', 'مندوبنا'), key: 'energizeRep', width: 20 },
    { header: t('Type', 'النوع'), key: 'vendorType', width: 14 },
    { header: t('Routes', 'الوجهات'), key: 'destinations', width: 30 },
    { header: t('HQ', 'المقر الرئيسي'), key: 'headOffice', width: 18 },
    { header: t('Cars', 'عدد العربيات'), key: 'carsCount', width: 12 },
    { header: t('Has papers', 'الأوراق متوفرة'), key: 'hasPapers', transform: (v: any) => triState(v, ar), width: 14 },
    { header: t('Vendor signed', 'وقّع المورد'), key: 'vendorSideSigned', transform: (v: any) => triState(v, ar), width: 14 },
    { header: t('We signed', 'وقّعنا'), key: 'ourSideSigned', transform: (v: any) => triState(v, ar), width: 12 },
    { header: t('Contract date', 'تاريخ العقد'), key: 'contractDate', width: 14 },
    { header: t('Status', 'حالة المتابعة'), key: 'followUpStatus', width: 22 },
    { header: t('Notes', 'ملاحظات'), key: 'notes', width: 40 },
  ];

  if (!isCrmStaff(user)) return <div className="text-slate-500 p-8">{t('Not authorized', 'لا تملك صلاحية')}</div>;
  if (!loaded) return <Spinner />;

  return (
    <div className="space-y-5" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader icon={<Truck className="w-5 h-5" />} title={t('Vendors', 'الموردين')} subtitle={`${items.length} ${t('carrier', 'ناقل')}`}>
        <button type="button" onClick={() => load()} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm"><RefreshCw className="w-4 h-4" /> {t('Refresh', 'تحديث')}</button>
        <ExportMenu fileName="crm-vendors" lang={lang as 'ar' | 'en'}
          options={[
            { key: 'shown', label: scope.shown, sheets: [{ name: t('Vendors', 'الموردين'), rows: items, columns: vendorCols }] },
            {
              key: 'all', label: scope.all,
              hint: t('all', 'الكل'),
              // التصفية تتم على الخادم، فما في الذاكرة هو نتيجة الفلتر لا السجلّ
              // كلّه؛ ولذلك يُعاد الجلب بلا وسائط ليخرج «الكل» كلًّا بالفعل.
              resolve: async () => {
                const d = await api.get<{ items: Vendor[] }>('/api/crm-vendors');
                return [{ name: t('Vendors', 'الموردين'), rows: d.items || [], columns: vendorCols }];
              },
            },
          ]} />
        <PrimaryButton onClick={openCreate}><Plus className="w-4 h-4" /> {t('Add vendor', 'إضافة مورد')}</PrimaryButton>
      </PageHeader>

      {/* filters */}
      <div className="bg-white border border-slate-200 rounded-xl p-3 shadow-sm flex flex-col sm:flex-row sm:flex-wrap gap-2 sm:items-center">
        <div className="relative flex-1 min-w-[200px]">
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('Search name / rep / phone / email / route / city…', 'بحث بالاسم / الممثل / الهاتف / الإيميل / الوجهة / المدينة…')}
            className="w-full px-3 py-2.5 rounded-lg bg-white border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/50" />
          {search && <button type="button" aria-label={t('Clear', 'مسح')} onClick={() => setSearch('')} className="absolute end-2 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-700"><X className="w-4 h-4" /></button>}
        </div>
        <div className="w-full sm:w-44"><Select value={fStatus} onChange={(e) => setFStatus(e.target.value)}><option value="">{t('All statuses', 'كل الحالات')}</option>{(opts?.followUpStatuses || []).map((s) => <option key={s} value={s}>{s}</option>)}</Select></div>
        <div className="w-full sm:w-40"><Select value={fRep} onChange={(e) => setFRep(e.target.value)}><option value="">{t('All reps', 'كل المناديب')}</option>{(opts?.energizeReps || []).map((s) => <option key={s} value={s}>{s}</option>)}</Select></div>
        <div className="w-full sm:w-40"><Select value={fType} onChange={(e) => setFType(e.target.value)}><option value="">{t('All types', 'كل الأنواع')}</option>{(opts?.vendorTypes || []).map((s) => <option key={s} value={s}>{s}</option>)}</Select></div>
        <div className="w-full sm:w-40"><Select value={fNew} onChange={(e) => setFNew(e.target.value)}><option value="">{t('New & old', 'جديد وقديم')}</option><option value="true">{t('New only', 'الجدد فقط')}</option><option value="false">{t('Existing only', 'القدامى فقط')}</option></Select></div>
        {anyFilter && <button type="button" onClick={clearAll} className="flex items-center gap-1 px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 text-sm whitespace-nowrap"><X className="w-4 h-4" /> {t('Reset', 'مسح')}</button>}
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-900 text-slate-300">
              {[t('Vendor', 'المورد'), t('Representative', 'الممثل'), t('Phone', 'الهاتف'), t('Routes', 'الوجهات'), t('HQ', 'المقر'), t('Cars', 'العربيات'), t('Type', 'النوع'), t('Status', 'الحالة'), t('Our rep', 'مندوبنا'), t('Actions', 'إجراءات')].map((h) => <th key={h} className="text-start font-semibold px-3 py-3 whitespace-nowrap">{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr><td colSpan={10} className="text-center text-slate-800 py-12">{t('No vendors', 'لا يوجد موردين')}</td></tr>
            ) : items.map((v) => (
              <tr key={v._id} className="border-b border-slate-200/70 hover:bg-slate-50 cursor-pointer" onClick={() => setDetail(v)}>
                <td className="px-3 py-3 font-semibold text-slate-900 max-w-[220px] truncate">
                  {v.isNewVendor && <Star className="inline w-3.5 h-3.5 fill-amber-400 text-amber-600 me-1" />}{v.name}
                </td>
                <td className="px-3 py-3 text-slate-700 whitespace-nowrap">{v.representative || '—'}</td>
                <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>{(v.mobile || v.email) ? <ContactButtons phone={v.mobile} whatsapp={v.mobile} email={v.email} /> : '—'}</td>
                <td className="px-3 py-3 text-slate-800 max-w-[160px] truncate">{v.destinations || '—'}</td>
                <td className="px-3 py-3 text-slate-800 whitespace-nowrap">{v.headOffice || '—'}</td>
                <td className="px-3 py-3 text-slate-700">{v.carsCount ?? '—'}</td>
                <td className="px-3 py-3 text-slate-800 whitespace-nowrap">{v.vendorType || '—'}</td>
                <td className="px-3 py-3"><span className={`px-2 py-1 rounded-full text-xs font-medium ${statusStyle(v.followUpStatus)}`}>{v.followUpStatus || '—'}</span></td>
                <td className="px-3 py-3 text-slate-800 whitespace-nowrap">{v.energizeRep || '—'}</td>
                <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                  <div className="flex items-center justify-end gap-1">
                    <button type="button" onClick={() => setDetail(v)} className="p-1.5 rounded-lg text-slate-700 hover:text-slate-900 hover:bg-slate-100"><Eye className="w-4 h-4" /></button>
                    <button type="button" onClick={() => openEdit(v)} className="p-1.5 rounded-lg text-slate-700 hover:text-[#f37121] hover:bg-slate-100"><Edit className="w-4 h-4" /></button>
                    {admin && <button type="button" onClick={() => remove(v)} className="p-1.5 rounded-lg text-slate-700 hover:text-red-600 hover:bg-slate-100"><Trash2 className="w-4 h-4" /></button>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* detail */}
      <Modal open={!!detail} onClose={() => setDetail(null)} wide title={detail?.name || ''}>
        {detail && (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              {(detail.mobile || detail.email) && <ContactButtons phone={detail.mobile} whatsapp={detail.mobile} email={detail.email} size={18} />}
              <span className={`px-2 py-1 rounded-full text-xs font-medium ${statusStyle(detail.followUpStatus)}`}>{detail.followUpStatus || '—'}</span>
              {detail.isNewVendor && <span className="text-amber-600 text-xs flex items-center gap-1"><Star className="w-3.5 h-3.5 fill-amber-400" /> {t('New', 'جديد')}</span>}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2.5">
              {[
                [t('Representative', 'ممثل المورد'), detail.representative],
                [t('Phone', 'الهاتف'), detail.mobile],
                [t('Email', 'البريد'), detail.email],
                [t('Our rep (Energize)', 'مندوب تنشيط'), detail.energizeRep],
                [t('Type', 'النوع'), detail.vendorType],
                [t('Routes', 'الوجهات'), detail.destinations],
                [t('Head office', 'المقر الرئيسي'), detail.headOffice],
                [t('Cars count', 'عدد العربيات'), detail.carsCount],
                [t('Has papers', 'الأوراق متوفرة'), triState(detail.hasPapers, ar)],
                [t('Vendor signed', 'وقّع المورد'), triState(detail.vendorSideSigned, ar)],
                [t('We signed', 'وقّعنا'), triState(detail.ourSideSigned, ar)],
                [t('Contract date', 'تاريخ العقد'), detail.contractDate],
                [t('Follow-up status', 'حالة المتابعة'), detail.followUpStatus],
              ].map(([k, val]) => (
                <div key={k as string} className="border-b border-slate-100 pb-1.5">
                  <p className="text-slate-400 text-[11px] uppercase tracking-wide">{k}</p>
                  <p className="text-slate-800 text-sm break-words">{val === null || val === undefined || val === '' ? '—' : String(val)}</p>
                </div>
              ))}
            </div>
            {detail.notes && <div><p className="text-slate-400 text-[11px] uppercase tracking-wide mb-1">{t('Notes', 'ملاحظات')}</p><p className="text-slate-800 text-sm bg-slate-50 rounded-lg p-3 whitespace-pre-wrap">{detail.notes}</p></div>}
            <div className="flex justify-end">
              <ReportButton subject="vendor" id={detail.name} label={t('Full vendor report', 'التقرير الشامل للمورد')} />
            </div>

            {/* حساب البوابة — المورد يتابع الحمولات اللي شالها بنفسه */}
            <PortalAccountCard source="crm_vendor" refId={String(detail._id)} name={detail.name} />
            <div className="flex justify-end"><PrimaryButton onClick={() => { setDetail(null); openEdit(detail); }}><Edit className="w-4 h-4" /> {t('Edit', 'تعديل')}</PrimaryButton></div>
          </div>
        )}
      </Modal>

      {/* create / edit */}
      <Modal open={showForm} onClose={() => setShowForm(false)} wide title={editing ? t('Edit vendor', 'تعديل المورد') : t('Add vendor', 'إضافة مورد')}
        footer={<>
          <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2 text-slate-500 hover:text-slate-900 text-sm">{t('Cancel', 'إلغاء')}</button>
          <PrimaryButton onClick={save} disabled={saving}>{saving ? '…' : <Check className="w-4 h-4" />} {t('Save', 'حفظ')}</PrimaryButton>
        </>}>
        {err && <div className="bg-red-50 text-red-700 text-sm rounded-lg px-3 py-2 mb-2">{err}</div>}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label={t('Vendor name', 'اسم المورد')}><TextInput value={form.name} onChange={(e) => set('name', e.target.value)} /></Field>
          <Field label={t('Representative', 'ممثل المورد')}><TextInput value={form.representative} onChange={(e) => set('representative', e.target.value)} /></Field>
          <Field label={t('Phone', 'الهاتف')}><TextInput value={form.mobile} onChange={(e) => set('mobile', e.target.value)} dir="ltr" /></Field>
          <Field label={t('Email', 'البريد')}><TextInput type="email" value={form.email} onChange={(e) => set('email', e.target.value)} dir="ltr" /></Field>
          <Field label={t('Our rep (Energize)', 'مندوب تنشيط')}><TextInput value={form.energizeRep} onChange={(e) => set('energizeRep', e.target.value)} /></Field>
          <Field label={t('Type', 'النوع')}><TextInput value={form.vendorType} onChange={(e) => set('vendorType', e.target.value)} placeholder="ضريبي / كاش / آجل" /></Field>
          <Field label={t('Cars count', 'عدد العربيات')}><TextInput type="number" value={form.carsCount} onChange={(e) => set('carsCount', e.target.value)} dir="ltr" /></Field>
          <Field label={t('Routes', 'الوجهات')} span2><TextInput value={form.destinations} onChange={(e) => set('destinations', e.target.value)} /></Field>
          <Field label={t('Head office', 'المقر الرئيسي')}><TextInput value={form.headOffice} onChange={(e) => set('headOffice', e.target.value)} /></Field>
          <Field label={t('Follow-up status', 'حالة المتابعة')}><TextInput value={form.followUpStatus} onChange={(e) => set('followUpStatus', e.target.value)} placeholder="موقع / تم ارسال العقد / قيد متابعة …" /></Field>
          <Field label={t('Contract date', 'تاريخ العقد')}><TextInput value={form.contractDate} onChange={(e) => set('contractDate', e.target.value)} placeholder="25/1/2026" /></Field>
          <Field label={t('Has papers', 'الأوراق متوفرة')}><Select value={form.hasPapers} onChange={(e) => set('hasPapers', e.target.value)}><option value="">—</option><option value="true">{t('Yes', 'نعم')}</option><option value="false">{t('No', 'لا')}</option></Select></Field>
          <Field label={t('Vendor signed', 'وقّع المورد')}><Select value={form.vendorSideSigned} onChange={(e) => set('vendorSideSigned', e.target.value)}><option value="">—</option><option value="true">{t('Yes', 'نعم')}</option><option value="false">{t('No', 'لا')}</option></Select></Field>
          <Field label={t('We signed', 'وقّعنا')}><Select value={form.ourSideSigned} onChange={(e) => set('ourSideSigned', e.target.value)}><option value="">—</option><option value="true">{t('Yes', 'نعم')}</option><option value="false">{t('No', 'لا')}</option></Select></Field>
          <Field label={t('New vendor?', 'مورد جديد؟')}><Select value={form.isNewVendor ? 'true' : 'false'} onChange={(e) => set('isNewVendor', e.target.value === 'true')}><option value="false">{t('Existing', 'قديم')}</option><option value="true">{t('New', 'جديد')}</option></Select></Field>
          <Field label={t('Notes', 'ملاحظات')} span2><TextArea rows={2} value={form.notes} onChange={(e) => set('notes', e.target.value)} /></Field>
        </div>
      </Modal>
    </div>
  );
}
