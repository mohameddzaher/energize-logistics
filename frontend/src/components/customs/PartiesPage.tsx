'use client';
// صفحةُ أطرافِ التخليص — تخدم العملاءَ ووكلاءَ الشحن بالكود نفسِه.
//
// البنيةُ واحدة (اسمٌ، تواصلٌ، أرقامٌ، ملفٌّ يُفتح) والفرقُ دورُ الطرف لا شكلُه.
// وصفحتان متطابقتان بملفّين تعنيان إصلاحَ كلّ عطلٍ مرّتين ثمّ نسيانَ إحداهما.
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useDialog } from '@/components/system/DialogProvider';
import api from '@/lib/api';
import { canEditSection } from '@/lib/sections';
import { Spinner, PageHeader, SearchInput, PrimaryButton, Modal, Field, TextInput, Loader2 } from '@/components/hr/HRKit';
import ExportMenu, { type ExportColumn } from '@/components/ls2/ExportMenu';
import { Users, Ship, Plus, Pencil, Trash2, Mail, Phone, ChevronLeft } from 'lucide-react';

export type PartyKind = 'customer' | 'agent';

export interface Party {
  _id: string; kind: PartyKind; name: string; email?: string; phone?: string;
  contactPerson?: string; commercialRegister?: string; taxNumber?: string;
  address?: string; city?: string; notes?: string; isActive?: boolean;
  deals: number; revenue: number; profit: number; containers: number; lastDealAt?: string | null;
}

const money = (n?: number) => (Number(n) || 0).toLocaleString('en-US');
const dt = (v?: string | null) => (v ? new Date(v).toLocaleDateString('en-GB') : '—');

export default function PartiesPage({ kind }: { kind: PartyKind }) {
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const t = (a: string, e: string) => (ar ? a : e);
  const { notify, confirm } = useDialog();
  const router = useRouter();

  const canEdit = ['super_admin', 'admin', 'operations_manager', 'customs_manager', 'customs_officer']
    .includes((user as any)?.role || '') || canEditSection((user as any)?.permissions, 'Customs');

  const [rows, setRows] = useState<Party[]>([]);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Partial<Party> | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await api.get<{ parties: Party[] }>(`/api/customs-clearance/parties?kind=${kind}`);
      setRows(d.parties || []);
    } catch (e: any) { notify(e?.message || t('تعذّر التحميل', 'Could not load'), 'error'); }
    setLoading(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind]);
  useEffect(() => { load(); }, [load]);

  // البحثُ في المتصفّح: القائمةُ عشراتٌ لا آلاف، ونداءُ الخادم لكلّ حرفٍ إسرافٌ
  // على عنقودٍ مقيَّد. والطيُّ هو الطيُّ نفسُه المستعمَل في الخادم.
  const fold = (v: any) => String(v ?? '')
    .replace(/[أإآٱ]/g, 'ا').replace(/[ةه]/g, 'ه').replace(/[ىئي]/g, 'ي')
    .replace(/\s+/g, '').toLowerCase();
  const shown = useMemo(() => {
    const n = fold(q);
    if (!n) return rows;
    return rows.filter((r) => [r.name, r.email, r.phone, r.contactPerson, r.commercialRegister, r.taxNumber, r.city]
      .some((v) => fold(v).includes(n)));
  }, [rows, q]);

  const totals = useMemo(() => shown.reduce((t2, r) => ({
    deals: t2.deals + (r.deals || 0), revenue: t2.revenue + (r.revenue || 0),
    profit: t2.profit + (r.profit || 0), containers: t2.containers + (r.containers || 0),
  }), { deals: 0, revenue: 0, profit: 0, containers: 0 }), [shown]);

  const save = async () => {
    if (!editing?.name?.trim()) { notify(t('الاسم مطلوب', 'Name required'), 'error'); return; }
    setSaving(true);
    try {
      if (editing._id) await api.put(`/api/customs-clearance/parties/${editing._id}`, editing);
      else await api.post('/api/customs-clearance/parties', { ...editing, kind });
      setEditing(null); load();
    } catch (e: any) { notify(e?.message || t('تعذّر الحفظ', 'Could not save'), 'error'); }
    setSaving(false);
  };

  const remove = async (p: Party) => {
    const ok = await confirm({ message: t(`حذف «${p.name}»؟`, `Delete “${p.name}”?`) });
    if (!ok) return;
    try {
      const r = await api.delete<{ deactivated?: boolean; message?: string }>(`/api/customs-clearance/parties/${p._id}`);
      if (r?.deactivated) notify(r.message || t('عُطِّل', 'Deactivated'));
      load();
    } catch (e: any) { notify(e?.message || t('تعذّر الحذف', 'Could not delete'), 'error'); }
  };

  const cols: ExportColumn[] = [
    { header: t('الاسم', 'Name'), key: 'name', width: 28 },
    ...(kind === 'agent' ? [{ header: t('البريد', 'Email'), key: 'email', width: 26 }] : []),
    { header: t('الجوال', 'Phone'), key: 'phone', width: 16 },
    { header: t('معاملات', 'Deals'), key: 'deals', width: 10 },
    { header: t('حاويات', 'Containers'), key: 'containers', width: 10 },
    { header: t('الإيراد', 'Revenue'), key: 'revenue', width: 14 },
    { header: t('الربح', 'Profit'), key: 'profit', width: 14 },
  ];

  if (loading) return <Spinner />;
  const Icon = kind === 'agent' ? Ship : Users;
  const title = kind === 'agent' ? t('وكلاء الشحن', 'Shipping agents') : t('عملاء التخليص', 'Customs customers');

  const Stat = ({ label, value, accent }: { label: string; value: string | number; accent?: string }) => (
    <div className="bg-white border border-slate-200 rounded-xl px-4 py-3 shadow-sm">
      <p className="text-[11px] text-slate-500">{label}</p>
      <p className={`text-xl font-bold ${accent || 'text-slate-900'}`}>{value}</p>
    </div>
  );

  return (
    <div className="space-y-4 pb-10" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader icon={<Icon className="w-6 h-6 text-[#f37121]" />} title={title}
        subtitle={t('اضغط على أيّ اسم ليُفتح ملفُّه الكامل', 'Tap any name to open its full profile')}>
        <ExportMenu fileName={`customs-${kind}s`} lang={ar ? 'ar' : 'en'}
          options={[{ key: 'shown', label: t('المعروض', 'Shown'), sheets: [{ name: title, rows: shown, columns: cols }] }]} />
        {canEdit && (
          <PrimaryButton onClick={() => setEditing({ name: '', kind })}>
            <Plus className="w-4 h-4" /> {kind === 'agent' ? t('وكيل جديد', 'New agent') : t('عميل جديد', 'New customer')}
          </PrimaryButton>
        )}
      </PageHeader>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <Stat label={kind === 'agent' ? t('وكلاء', 'Agents') : t('عملاء', 'Customers')} value={shown.length} />
        <Stat label={t('معاملات', 'Deals')} value={money(totals.deals)} />
        <Stat label={t('حاويات', 'Containers')} value={money(totals.containers)} />
        <Stat label={t('الإيراد', 'Revenue')} value={money(totals.revenue)} accent="text-emerald-600" />
        <Stat label={t('الربح', 'Profit')} value={money(totals.profit)} accent={totals.profit >= 0 ? 'text-emerald-600' : 'text-red-600'} />
      </div>

      <SearchInput value={q} onChange={setQ}
        placeholder={t('بحث بالاسم أو البريد أو الجوال أو السجل التجاري أو الرقم الضريبي…', 'name, email, phone, CR, tax number…')} />

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="table-head">
              <tr>
                {[t('الاسم', 'Name'), ...(kind === 'agent' ? [t('البريد', 'Email')] : []), t('التواصل', 'Contact'),
                  t('معاملات', 'Deals'), t('حاويات', 'Containers'), t('الإيراد', 'Revenue'), t('الربح', 'Profit'),
                  t('الهامش', 'Margin'), t('آخر معاملة', 'Last deal'), ''].map((h, i) => (
                  <th key={i} className="px-3 py-2.5 text-start font-semibold whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.length === 0 ? (
                <tr><td colSpan={10} className="px-4 py-12 text-center text-slate-400">{t('لا نتائج', 'No results')}</td></tr>
              ) : shown.map((p) => {
                const margin = p.revenue ? Math.round((p.profit / p.revenue) * 1000) / 10 : 0;
                return (
                  <tr key={p._id} className={`border-b border-slate-100 hover:bg-slate-50 cursor-pointer ${p.isActive === false ? 'opacity-50' : ''}`}
                    onClick={() => router.push(`/system/customs/parties/${p._id}`)}>
                    <td className="px-3 py-2.5 font-semibold text-slate-900 whitespace-nowrap">
                      {p.name}
                      {p.isActive === false && <span className="ms-1.5 text-[10px] text-slate-400">({t('معطَّل', 'inactive')})</span>}
                    </td>
                    {kind === 'agent' && (
                      <td className="px-3 py-2.5 text-slate-600">
                        {p.email ? <a href={`mailto:${p.email}`} onClick={(e) => e.stopPropagation()} className="inline-flex items-center gap-1 hover:text-[#f37121]"><Mail className="w-3.5 h-3.5" />{p.email}</a>
                          : <span className="text-red-400 text-xs">{t('بلا بريد', 'no email')}</span>}
                      </td>
                    )}
                    <td className="px-3 py-2.5 text-slate-600 whitespace-nowrap">
                      {p.phone ? <a href={`tel:${p.phone}`} onClick={(e) => e.stopPropagation()} className="inline-flex items-center gap-1 hover:text-[#f37121]"><Phone className="w-3.5 h-3.5" />{p.phone}</a> : '—'}
                      {p.contactPerson ? <span className="text-xs text-slate-400 ms-1">· {p.contactPerson}</span> : null}
                    </td>
                    <td className="px-3 py-2.5 tabular-nums">{money(p.deals)}</td>
                    <td className="px-3 py-2.5 tabular-nums">{money(p.containers)}</td>
                    <td className="px-3 py-2.5 tabular-nums text-emerald-700">{money(p.revenue)}</td>
                    <td className={`px-3 py-2.5 tabular-nums font-semibold ${p.profit >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>{money(p.profit)}</td>
                    <td className="px-3 py-2.5 tabular-nums text-slate-600">{p.revenue ? `${margin}%` : '—'}</td>
                    <td className="px-3 py-2.5 text-slate-500 whitespace-nowrap">{dt(p.lastDealAt)}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center gap-1">
                        {canEdit && <button type="button" onClick={() => setEditing(p)} className="p-1 text-slate-400 hover:text-[#f37121]" title={t('تعديل', 'Edit')}><Pencil className="w-3.5 h-3.5" /></button>}
                        {canEdit && <button type="button" onClick={() => remove(p)} className="p-1 text-slate-400 hover:text-red-600" title={t('حذف', 'Delete')}><Trash2 className="w-3.5 h-3.5" /></button>}
                        <ChevronLeft className={`w-4 h-4 text-slate-300 ${isRTL ? '' : 'rotate-180'}`} />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <Modal open={!!editing} onClose={() => setEditing(null)}
        title={editing?._id ? t('تعديل', 'Edit') : (kind === 'agent' ? t('وكيل جديد', 'New agent') : t('عميل جديد', 'New customer'))}
        footer={<>
          <button type="button" onClick={() => setEditing(null)} className="px-4 py-2 text-slate-500 text-sm">{t('إلغاء', 'Cancel')}</button>
          <PrimaryButton onClick={save} disabled={saving}>{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}{t('حفظ', 'Save')}</PrimaryButton>
        </>}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="sm:col-span-2"><Field label={t('الاسم *', 'Name *')}>
            <TextInput value={editing?.name || ''} onChange={(e) => setEditing((p) => ({ ...p, name: e.target.value }))} /></Field></div>
          {/* بريدُ الوكيل هنا لا في كلّ معاملة: يُملأ وحدَه حين يُختار الوكيل،
              فلا يُكتب من الذاكرة ولا يُرسَل طلبٌ إلى بريدٍ خاطئ. */}
          <Field label={t('البريد الإلكتروني', 'Email')}>
            <TextInput type="email" value={editing?.email || ''} onChange={(e) => setEditing((p) => ({ ...p, email: e.target.value }))} /></Field>
          <Field label={t('الجوال', 'Phone')}>
            <TextInput value={editing?.phone || ''} onChange={(e) => setEditing((p) => ({ ...p, phone: e.target.value }))} /></Field>
          <Field label={t('مسؤول التواصل', 'Contact person')}>
            <TextInput value={editing?.contactPerson || ''} onChange={(e) => setEditing((p) => ({ ...p, contactPerson: e.target.value }))} /></Field>
          <Field label={t('المدينة', 'City')}>
            <TextInput value={editing?.city || ''} onChange={(e) => setEditing((p) => ({ ...p, city: e.target.value }))} /></Field>
          <Field label={t('السجل التجاري', 'Commercial register')}>
            <TextInput value={editing?.commercialRegister || ''} onChange={(e) => setEditing((p) => ({ ...p, commercialRegister: e.target.value }))} /></Field>
          <Field label={t('الرقم الضريبي', 'Tax number')}>
            <TextInput value={editing?.taxNumber || ''} onChange={(e) => setEditing((p) => ({ ...p, taxNumber: e.target.value }))} /></Field>
          <div className="sm:col-span-2"><Field label={t('العنوان', 'Address')}>
            <TextInput value={editing?.address || ''} onChange={(e) => setEditing((p) => ({ ...p, address: e.target.value }))} /></Field></div>
          <div className="sm:col-span-2"><Field label={t('ملاحظات', 'Notes')}>
            <TextInput value={editing?.notes || ''} onChange={(e) => setEditing((p) => ({ ...p, notes: e.target.value }))} /></Field></div>
        </div>
      </Modal>
    </div>
  );
}
