'use client';
// عقود الأقسام — every OTHER department's contracts in one register: fleet
// customers, B2C customers, 3PL customers and anything else. Tabs by
// department, full CRUD, contract-file attachments, expiry highlighting.
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import { ClipboardList, Plus, Paperclip, Trash2, Upload, FileText } from 'lucide-react';
import {
  Spinner, PageHeader, SearchInput, Modal, Field, TextInput, TextArea, Select,
  PrimaryButton, ErrorNotice, SmallBadge, Tabs,
} from '@/components/hr/HRKit';
import { DeptContract, DEPT_LABELS, DEPT_CONTRACT_STATUS, canViewContracts, canEditContracts, fmtN, fmtD, foldAr } from '@/lib/contracts';
import { useDialog } from '@/components/system/DialogProvider';

const readFileAsDataUrl = (f: File) => new Promise<string>((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result));
  r.onerror = reject;
  r.readAsDataURL(f);
});

const emptyForm = {
  department: 'fleet', partyType: 'customer', partyName: '', contactPerson: '', phone: '', email: '',
  subject: '', contractDate: '', startDate: '', endDate: '', renewalPolicy: '', paymentTermDays: '', value: '', status: 'active', notes: '',
};

export default function AgreementsPage() {
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const { confirm, notify } = useDialog();
  const ar = lang === 'ar';
  const canEdit = canEditContracts(user);

  const [contracts, setContracts] = useState<DeptContract[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('all');
  const [q, setQ] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<DeptContract | null>(null);
  const [form, setForm] = useState<any>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [openAtt, setOpenAtt] = useState<DeptContract | null>(null);
  const [attTitle, setAttTitle] = useState('');
  const [uploading, setUploading] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await api.get<{ contracts: DeptContract[] }>('/api/contracts/agreements');
      setContracts(d.contracts || []);
      setError('');
    } catch (e: any) { setError(e?.message || 'Request failed'); }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);
  useSocket('contracts:updated', useCallback(() => load(), [load]));

  // Keep the attachments modal in sync after uploads.
  const openContract = useMemo(() => contracts.find((c) => c._id === openAtt?._id) || null, [contracts, openAtt]);

  const filtered = useMemo(() => contracts.filter((c) => {
    if (tab !== 'all' && c.department !== tab) return false;
    const s = foldAr(q.trim());
    if (!s) return true;
    return [c.partyName, c.contactPerson, c.phone, c.subject, c.notes].some((x) => foldAr(String(x || '')).includes(s));
  }), [contracts, tab, q]);

  const openNew = () => { setEditing(null); setForm({ ...emptyForm, department: tab !== 'all' ? tab : 'fleet', contractDate: new Date().toISOString().slice(0, 10) }); setShowForm(true); };
  const openEdit = (c: DeptContract) => {
    setEditing(c);
    setForm({
      ...emptyForm, ...c,
      paymentTermDays: c.paymentTermDays != null ? String(c.paymentTermDays) : '',
      value: c.value != null ? String(c.value) : '',
      contractDate: c.contractDate ? new Date(c.contractDate).toISOString().slice(0, 10) : '',
      startDate: c.startDate ? new Date(c.startDate).toISOString().slice(0, 10) : '',
      endDate: c.endDate ? new Date(c.endDate).toISOString().slice(0, 10) : '',
    });
    setShowForm(true);
  };

  const save = async () => {
    if (!form.partyName.trim() || saving) return;
    setSaving(true);
    try {
      const body = {
        ...form,
        paymentTermDays: form.paymentTermDays === '' ? null : Number(form.paymentTermDays),
        value: form.value === '' ? null : Number(form.value),
        contractDate: form.contractDate || null, startDate: form.startDate || null, endDate: form.endDate || null,
      };
      delete body._id; delete body.attachments; delete body.createdByName;
      if (editing) await api.patch(`/api/contracts/agreements/${editing._id}`, body);
      else await api.post('/api/contracts/agreements', body);
      setShowForm(false);
      await load();
    } catch (e: any) { notify(e?.message || 'Request failed', 'error'); }
    setSaving(false);
  };

  const remove = async (c: DeptContract) => {
    if (!(await confirm(ar ? `حذف عقد «${c.partyName}» نهائيًا بمرفقاته؟` : 'Delete contract?'))) return;
    try { await api.delete(`/api/contracts/agreements/${c._id}`); await load(); }
    catch (e: any) { notify(e?.message || 'Request failed', 'error'); }
  };

  const uploadFile = async (f: File | null) => {
    if (!f || !openContract) return;
    setUploading(true);
    try {
      const dataUrl = await readFileAsDataUrl(f);
      await api.post(`/api/contracts/agreements/${openContract._id}/attachments`, { dataUrl, fileName: f.name, title: attTitle });
      setAttTitle('');
      await load();
    } catch (e: any) { notify(e?.message || 'Upload failed', 'error'); }
    setUploading(false);
  };

  const removeAttachment = async (attId: string) => {
    if (!openContract || !(await confirm(ar ? 'حذف هذا المرفق؟' : 'Delete attachment?'))) return;
    try { await api.delete(`/api/contracts/agreements/${openContract._id}/attachments/${attId}`); await load(); }
    catch (e: any) { notify(e?.message || 'Failed', 'error'); }
  };

  if (!canViewContracts(user)) return <div className="text-slate-500 p-8">{ar ? 'غير مصرّح لك بالوصول إلى هذه الصفحة.' : 'Not authorized.'}</div>;
  if (loading) return <Spinner />;

  const tabs = [
    { key: 'all', label: ar ? `الكل (${contracts.length})` : `All (${contracts.length})` },
    ...Object.entries(DEPT_LABELS).map(([k, l]) => ({ key: k, label: `${ar ? l.ar : l.en} (${contracts.filter((c) => c.department === k).length})` })),
  ];
  const soon = new Date(Date.now() + 60 * 86400000);

  return (
    <div className="space-y-4" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader
        icon={<ClipboardList className="w-7 h-7 text-cyan-700" />}
        title={ar ? 'عقود الأقسام' : 'Department Contracts'}
        subtitle={ar ? 'عقود العملاء والموردين لكل قسم — إدارة الأسطول وB2C و3PL وغيرها، بملفاتها المرفقة' : 'Customer & vendor contracts per department'}
      >
        {canEdit && <PrimaryButton onClick={openNew}><span className="inline-flex items-center gap-1.5"><Plus className="w-4 h-4" />{ar ? 'إضافة عقد' : 'Add contract'}</span></PrimaryButton>}
      </PageHeader>

      {error && <ErrorNotice error={error} onRetry={() => { setLoading(true); load(); }} lang={lang} />}

      <Tabs tabs={tabs} active={tab} onChange={setTab} />
      <div className="max-w-md"><SearchInput value={q} onChange={setQ} placeholder={ar ? 'ابحث بالاسم أو الموضوع…' : 'Search…'} /></div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-900 text-slate-300 text-xs">
                <th className="text-start font-semibold px-4 py-3">{ar ? 'الجهة' : 'Party'}</th>
                <th className="text-center font-semibold px-4 py-3">{ar ? 'القسم' : 'Dept'}</th>
                <th className="text-center font-semibold px-4 py-3">{ar ? 'النوع' : 'Type'}</th>
                <th className="text-start font-semibold px-4 py-3">{ar ? 'الموضوع' : 'Subject'}</th>
                <th className="text-center font-semibold px-4 py-3">{ar ? 'تاريخ العقد' : 'Date'}</th>
                <th className="text-center font-semibold px-4 py-3">{ar ? 'ينتهي في' : 'Ends'}</th>
                <th className="text-center font-semibold px-4 py-3">{ar ? 'الحالة' : 'Status'}</th>
                <th className="text-center font-semibold px-4 py-3">{ar ? 'المرفقات' : 'Files'}</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => {
                const st = DEPT_CONTRACT_STATUS[c.status] || DEPT_CONTRACT_STATUS.active;
                const dept = DEPT_LABELS[c.department] || { ar: c.department, en: c.department };
                const endSoon = c.status === 'active' && c.endDate && new Date(c.endDate) > new Date() && new Date(c.endDate) < soon;
                const ended = c.status === 'active' && c.endDate && new Date(c.endDate) < new Date();
                return (
                  <tr key={c._id} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="px-4 py-2.5">
                      <span className="font-semibold text-slate-800">{c.partyName}</span>
                      {(c.contactPerson || c.phone) && <div className="text-[11px] text-slate-400">{[c.contactPerson, c.phone].filter(Boolean).join(' · ')}</div>}
                    </td>
                    <td className="px-4 py-2.5 text-center text-xs text-slate-600">{ar ? dept.ar : dept.en}</td>
                    <td className="px-4 py-2.5 text-center text-xs text-slate-600">{c.partyType === 'vendor' ? (ar ? 'مورد' : 'Vendor') : (ar ? 'عميل' : 'Customer')}</td>
                    <td className="px-4 py-2.5 text-xs text-slate-600 max-w-56 truncate">{c.subject || '—'}</td>
                    <td className="px-4 py-2.5 text-center text-xs tabular-nums text-slate-500">{fmtD(c.contractDate)}</td>
                    <td className="px-4 py-2.5 text-center text-xs tabular-nums">
                      <span className={ended ? 'text-red-600 font-bold' : endSoon ? 'text-amber-600 font-bold' : 'text-slate-500'}>{fmtD(c.endDate)}</span>
                    </td>
                    <td className="px-4 py-2.5 text-center"><SmallBadge bg={st.cls.split(' ')[0]} text={st.cls.split(' ')[1]} label={ar ? st.ar : st.en} /></td>
                    <td className="px-4 py-2.5 text-center">
                      <button onClick={() => { setOpenAtt(c); setAttTitle(''); }} className="inline-flex items-center gap-1 text-xs font-medium text-cyan-700 hover:underline">
                        <Paperclip className="w-3.5 h-3.5" />{fmtN(c.attachments?.length || 0)}
                      </button>
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center justify-end gap-2 text-xs font-medium">
                        {canEdit && <button onClick={() => openEdit(c)} className="text-slate-500 hover:text-slate-800">{ar ? 'تعديل' : 'Edit'}</button>}
                        {canEdit && <button onClick={() => remove(c)} className="text-red-500 hover:text-red-700">{ar ? 'حذف' : 'Delete'}</button>}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && <tr><td colSpan={9} className="text-center text-slate-400 py-10">{ar ? 'لا توجد عقود بعد في هذا القسم — أضف أول عقد.' : 'No contracts yet.'}</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add / edit */}
      <Modal open={showForm} onClose={() => setShowForm(false)} title={editing ? (ar ? 'تعديل العقد' : 'Edit contract') : (ar ? 'إضافة عقد' : 'Add contract')} wide
        footer={
          <div className="flex items-center gap-2 justify-end">
            <button onClick={() => setShowForm(false)} className="px-4 py-2 rounded-lg text-slate-600 hover:bg-slate-100 font-medium">{ar ? 'إلغاء' : 'Cancel'}</button>
            <PrimaryButton onClick={save} disabled={!form.partyName.trim() || saving}>{editing ? (ar ? 'حفظ' : 'Save') : (ar ? 'إضافة' : 'Add')}</PrimaryButton>
          </div>
        }>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <Field label={ar ? 'القسم' : 'Department'}>
            <Select value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })}>
              {Object.entries(DEPT_LABELS).map(([k, l]) => <option key={k} value={k}>{ar ? l.ar : l.en}</option>)}
            </Select>
          </Field>
          <Field label={ar ? 'نوع الطرف' : 'Party type'}>
            <Select value={form.partyType} onChange={(e) => setForm({ ...form, partyType: e.target.value })}>
              <option value="customer">{ar ? 'عميل' : 'Customer'}</option>
              <option value="vendor">{ar ? 'مورد' : 'Vendor'}</option>
            </Select>
          </Field>
          <Field label={ar ? 'الحالة' : 'Status'}>
            <Select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
              {Object.entries(DEPT_CONTRACT_STATUS).map(([k, s]) => <option key={k} value={k}>{ar ? s.ar : s.en}</option>)}
            </Select>
          </Field>
          <Field label={ar ? 'اسم الجهة *' : 'Party name *'} span2><TextInput value={form.partyName} onChange={(e) => setForm({ ...form, partyName: e.target.value })} /></Field>
          <Field label={ar ? 'موضوع العقد' : 'Subject'}><TextInput value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} /></Field>
          <Field label={ar ? 'جهة الاتصال' : 'Contact'}><TextInput value={form.contactPerson} onChange={(e) => setForm({ ...form, contactPerson: e.target.value })} /></Field>
          <Field label={ar ? 'الجوال' : 'Phone'}><TextInput value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} dir="ltr" /></Field>
          <Field label={ar ? 'البريد' : 'Email'}><TextInput value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} dir="ltr" /></Field>
          <Field label={ar ? 'تاريخ العقد' : 'Contract date'}><TextInput type="date" value={form.contractDate} onChange={(e) => setForm({ ...form, contractDate: e.target.value })} /></Field>
          <Field label={ar ? 'تاريخ البدء' : 'Start'}><TextInput type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} /></Field>
          <Field label={ar ? 'تاريخ الانتهاء' : 'End'}><TextInput type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} /></Field>
          <Field label={ar ? 'مدة السداد (يوم)' : 'Payment (days)'}><TextInput type="number" value={form.paymentTermDays} onChange={(e) => setForm({ ...form, paymentTermDays: e.target.value })} dir="ltr" /></Field>
          <Field label={ar ? 'قيمة العقد' : 'Value'}><TextInput type="number" value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} dir="ltr" /></Field>
          <Field label={ar ? 'سياسة التجديد' : 'Renewal'}><TextInput value={form.renewalPolicy} onChange={(e) => setForm({ ...form, renewalPolicy: e.target.value })} placeholder={ar ? 'مثال: تلقائي ما لم يصدر إشعار' : 'e.g. automatic'} /></Field>
          <Field label={ar ? 'ملاحظات' : 'Notes'} span2><TextArea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
        </div>
      </Modal>

      {/* Attachments */}
      <Modal open={!!openContract} onClose={() => setOpenAtt(null)} title={openContract ? (ar ? `مرفقات عقد ${openContract.partyName}` : 'Attachments') : ''}>
        {openContract && (
          <div className="space-y-3">
            <div className="space-y-1.5">
              {(openContract.attachments || []).length === 0 && <div className="text-xs text-slate-400 py-3 text-center">{ar ? 'لا توجد مرفقات — ارفع ملف العقد.' : 'No files yet.'}</div>}
              {(openContract.attachments || []).map((a) => (
                <div key={a._id} className="flex items-center gap-2 text-xs bg-slate-50 border border-slate-100 rounded-lg px-3 py-2">
                  <FileText className="w-4 h-4 text-cyan-700 shrink-0" />
                  <a href={a.fileUrl} target="_blank" rel="noreferrer" className="font-semibold text-slate-800 hover:text-cyan-700 truncate">{a.title || a.fileName}</a>
                  <span className="text-slate-400 shrink-0">{(a.size / 1024).toFixed(0)} KB</span>
                  {canEdit && <button onClick={() => removeAttachment(a._id)} className="ms-auto text-red-400 hover:text-red-600"><Trash2 className="w-3.5 h-3.5" /></button>}
                </div>
              ))}
            </div>
            {canEdit && (
              <div className="flex flex-wrap items-center gap-2">
                <TextInput value={attTitle} onChange={(e) => setAttTitle(e.target.value)} placeholder={ar ? 'وصف المرفق' : 'Title'} />
                <label className={`inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg bg-cyan-700 hover:bg-cyan-800 text-white text-sm font-semibold cursor-pointer shrink-0 ${uploading ? 'opacity-50 pointer-events-none' : ''}`}>
                  <Upload className="w-4 h-4" />{uploading ? (ar ? 'جارٍ الرفع…' : 'Uploading…') : (ar ? 'رفع ملف' : 'Upload')}
                  <input type="file" className="hidden" accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,.webp" onChange={(e) => uploadFile(e.target.files?.[0] || null)} />
                </label>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
