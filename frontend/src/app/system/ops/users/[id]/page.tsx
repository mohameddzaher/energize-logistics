'use client';
// Customer profile — full details + edit + their complete live shipment history
// (the analytics + list live in the shared <OpsShipmentHistory/> component).
import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import { ArrowLeft, User as UserIcon, MapPin, Phone, Mail, Pencil, Check, Loader2 } from 'lucide-react';
import { Spinner, Modal, PrimaryButton, Field, TextInput, Select } from '@/components/hr/HRKit';
import OpsShipmentHistory from '@/components/ops/OpsShipmentHistory';
import { locName, fmtDateTime, isOpsStaff, isOpsAdmin, opsText } from '@/lib/ops';

type Row = Record<string, any>;

export default function CustomerProfilePage() {
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const router = useRouter();
  const params = useParams();
  const id = String(params?.id || '');
  const tx = opsText(lang);
  const admin = isOpsAdmin(user);

  const [customer, setCustomer] = useState<Row | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [editForm, setEditForm] = useState<Row>({});
  const [savingEdit, setSavingEdit] = useState(false);
  const [editErr, setEditErr] = useState('');

  const loadCustomer = useCallback(async () => {
    try { setCustomer(await api.get<Row>(`/api/ops/users/${id}?lang=${lang}`)); } catch { /* keep */ }
    setLoaded(true);
  }, [id, lang]);

  useEffect(() => { loadCustomer(); }, [loadCustomer]);
  useSocket('ops:users:changed', useCallback(() => loadCustomer(), [loadCustomer]));

  const openEditCustomer = () => {
    setEditForm({
      name: locName(customer?.name, lang) || customer?.name || '',
      phone: customer?.phone || '', email: customer?.email || '', user_type: customer?.user_type || '',
      address: customer?.address || '', zip_code: customer?.zip_code ?? '',
      active: customer?.active ? 'true' : 'false', verified: customer?.verified ? 'true' : 'false',
    });
    setEditErr(''); setShowEdit(true);
  };
  const saveCustomer = async () => {
    if (!String(editForm.phone || '').trim()) { setEditErr(lang === 'ar' ? 'الهاتف مطلوب' : 'Phone is required'); return; }
    setSavingEdit(true); setEditErr('');
    try {
      const body: Row = {
        name: editForm.name, phone: editForm.phone, email: editForm.email, user_type: editForm.user_type,
        address: editForm.address, active: editForm.active, verified: editForm.verified,
      };
      if (editForm.zip_code !== '' && editForm.zip_code != null) body.zip_code = Number(editForm.zip_code);
      await api.patch(`/api/ops/users/${id}`, body);
      setShowEdit(false); loadCustomer();
    } catch (e: any) { setEditErr(e?.message || (lang === 'ar' ? 'فشل الحفظ' : 'Save failed')); }
    setSavingEdit(false);
  };

  if (!isOpsStaff(user)) return <div className="text-slate-500 p-8">{tx.notAuthorized}</div>;
  if (!loaded) return <Spinner />;

  const cityName = locName(customer?.city, lang);

  return (
    <div className="space-y-5" dir={isRTL ? 'rtl' : 'ltr'}>
      <button type="button" onClick={() => router.push('/system/ops/users')} className="flex items-center gap-1 text-slate-500 hover:text-slate-900 text-sm">
        <ArrowLeft className={`w-4 h-4 ${isRTL ? 'rotate-180' : ''}`} /> {lang === 'ar' ? 'العملاء' : 'Customers'}
      </button>

      <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="w-12 h-12 rounded-lg bg-[#f37121]/20 flex items-center justify-center text-[#f37121]"><UserIcon className="w-6 h-6" /></div>
            <div>
              <h1 className="text-2xl font-bold text-slate-900">{locName(customer?.name, lang) || '—'}</h1>
              <div className="flex items-center flex-wrap gap-3 mt-1 text-sm text-slate-500">
                <span>{customer?.user_type || '—'}</span>
                {customer?.verified ? <span className="text-emerald-600">✓ {lang === 'ar' ? 'موثّق' : 'Verified'}</span> : null}
                {customer?.active ? <span className="text-emerald-600">✓ {lang === 'ar' ? 'مُفعّل' : 'Active'}</span> : <span className="text-slate-400">{lang === 'ar' ? 'غير مُفعّل' : 'Inactive'}</span>}
              </div>
            </div>
          </div>
          <div className="flex flex-col sm:items-end gap-2">
            {admin && (
              <button type="button" onClick={openEditCustomer} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#f37121] text-white text-sm font-medium hover:bg-[#e06010]">
                <Pencil className="w-4 h-4" /> {lang === 'ar' ? 'تعديل' : 'Edit'}
              </button>
            )}
            <div className="text-sm text-slate-600 space-y-1 sm:text-end">
              {customer?.phone && <a href={`tel:${customer.phone}`} className="flex items-center gap-2 text-[#f37121]" dir="ltr"><Phone className="w-3.5 h-3.5" /> {customer.phone}</a>}
              {customer?.email && <a href={`mailto:${customer.email}`} className="flex items-center gap-2" dir="ltr"><Mail className="w-3.5 h-3.5 text-slate-400" /> {customer.email}</a>}
              {(cityName || customer?.address) && <div className="flex items-center gap-2"><MapPin className="w-3.5 h-3.5 text-slate-400" /> {[cityName, customer?.address].filter(Boolean).join(' · ')}</div>}
              <div className="text-slate-400 text-xs">{lang === 'ar' ? 'عميل منذ' : 'Customer since'} {fmtDateTime(customer?.created_at, lang)}</div>
            </div>
          </div>
        </div>
      </div>

      <OpsShipmentHistory filterKey="user_id" filterValue={id} />

      {admin && (
        <Modal open={showEdit} onClose={() => setShowEdit(false)} wide title={lang === 'ar' ? 'تعديل العميل' : 'Edit Customer'}
          footer={<>
            <button type="button" onClick={() => setShowEdit(false)} className="px-4 py-2 text-slate-500 hover:text-slate-900 text-sm">{lang === 'ar' ? 'إلغاء' : 'Cancel'}</button>
            <PrimaryButton onClick={saveCustomer} disabled={savingEdit}>{savingEdit ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} {lang === 'ar' ? 'حفظ' : 'Save'}</PrimaryButton>
          </>}>
          {editErr && <div className="bg-red-50 text-red-700 text-sm rounded-lg px-3 py-2 mb-2">{editErr}</div>}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label={lang === 'ar' ? 'الاسم' : 'Name'}><TextInput value={editForm.name || ''} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} /></Field>
            <Field label={lang === 'ar' ? 'الهاتف' : 'Phone'}><TextInput value={editForm.phone || ''} onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })} dir="ltr" /></Field>
            <Field label={lang === 'ar' ? 'البريد' : 'Email'}><TextInput type="email" value={editForm.email || ''} onChange={(e) => setEditForm({ ...editForm, email: e.target.value })} dir="ltr" /></Field>
            <Field label={lang === 'ar' ? 'النوع' : 'Type'}><TextInput value={editForm.user_type || ''} onChange={(e) => setEditForm({ ...editForm, user_type: e.target.value })} placeholder="individual / business" /></Field>
            <Field label={lang === 'ar' ? 'العنوان' : 'Address'} span2><TextInput value={editForm.address || ''} onChange={(e) => setEditForm({ ...editForm, address: e.target.value })} /></Field>
            <Field label={lang === 'ar' ? 'الرمز البريدي' : 'Zip'}><TextInput type="number" value={editForm.zip_code ?? ''} onChange={(e) => setEditForm({ ...editForm, zip_code: e.target.value })} dir="ltr" /></Field>
            <Field label={lang === 'ar' ? 'مُفعّل' : 'Active'}><Select value={editForm.active} onChange={(e) => setEditForm({ ...editForm, active: e.target.value })}><option value="true">{lang === 'ar' ? 'نعم' : 'Yes'}</option><option value="false">{lang === 'ar' ? 'لا' : 'No'}</option></Select></Field>
            <Field label={lang === 'ar' ? 'موثّق' : 'Verified'}><Select value={editForm.verified} onChange={(e) => setEditForm({ ...editForm, verified: e.target.value })}><option value="true">{lang === 'ar' ? 'نعم' : 'Yes'}</option><option value="false">{lang === 'ar' ? 'لا' : 'No'}</option></Select></Field>
          </div>
        </Modal>
      )}
    </div>
  );
}
