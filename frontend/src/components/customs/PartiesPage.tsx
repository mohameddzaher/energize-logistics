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
import { useCustomsSearch, matchesSearch, searchKey } from '@/components/customs/useCustomsSearch';
import { useColumnFilters, ClearColumnFilters } from '@/components/useColumnFilters';
import { canEditSection } from '@/lib/sections';
import { Spinner, PageHeader, SearchInput, PrimaryButton, Modal, Field, TextInput, Loader2 } from '@/components/hr/HRKit';
import ExportMenu, { type ExportColumn } from '@/components/ls2/ExportMenu';
import { Users, Ship, Truck, Plus, Pencil, Trash2, Mail, Phone, ChevronLeft } from 'lucide-react';
import ScrollX from '@/components/system/ScrollX';

// ثلاثةُ أدوارٍ بالبنية نفسِها: صاحبُ البضاعة، ومخلِّصُها، وناقلُها.
export type Contact = { name: string; email: string; phone: string; description?: string };
/** جهاتُ الطرف — وما سبق الجهاتِ يُقرأ من حقوله القديمة جهةً واحدة. */
const contactsOf = (p: Partial<{ contacts?: Contact[]; contactPerson?: string; email?: string; phone?: string }> | null): Contact[] => {
  if (p?.contacts?.length) return p.contacts;
  if (p && (p.contactPerson || p.email || p.phone)) return [{ name: p.contactPerson || '', email: p.email || '', phone: p.phone || '', description: '' }];
  return [];
};

type PartyKind = 'customer' | 'agent' | 'carrier';

const KIND_META: Record<PartyKind, { ar: string; en: string; oneAr: string; oneEn: string; newAr: string; newEn: string }> = {
  customer: { ar: 'عملاء التخليص', en: 'Customs customers', oneAr: 'عملاء', oneEn: 'Customers', newAr: 'عميل جديد', newEn: 'New customer' },
  agent: { ar: 'وكلاء الشحن', en: 'Shipping agents', oneAr: 'وكلاء', oneEn: 'Agents', newAr: 'وكيل جديد', newEn: 'New agent' },
  carrier: { ar: 'الناقلون', en: 'Carriers', oneAr: 'ناقلون', oneEn: 'Carriers', newAr: 'ناقل جديد', newEn: 'New carrier' },
};

export interface Party {
  _id: string; kind: PartyKind; name: string; email?: string; phone?: string;
  contactPerson?: string; commercialRegister?: string; taxNumber?: string;
  address?: string; city?: string; notes?: string; isActive?: boolean;
  /** جهاتُ التواصل — مسؤولٌ ببريده وجوّاله، ووصفٌ اختياريّ (٢٠٢٦/١٠/٢٢). */
  contacts?: Contact[];
  /** للناقل: رابطُ موقع الساحة. */
  yardLocationUrl?: string;
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
  const cf = useColumnFilters<Party>();
  // الربحُ والهامش للإدارة وحدَها — الخادمُ يقول من يراهما ولا يرسلهما لغيره.
  const [seesMoney, setSeesMoney] = useState(false);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Partial<Party> | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await api.get<{ parties: Party[]; money?: boolean }>(`/api/customs-clearance/parties?kind=${kind}`);
      setSeesMoney(!!d.money);
      setRows(d.parties || []);
    } catch (e: any) { notify(e?.message || t('تعذّر التحميل', 'Could not load'), 'error'); }
    setLoading(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind]);
  useEffect(() => { load(); }, [load]);

  // البحثُ في المتصفّح: القائمةُ عشراتٌ لا آلاف. والطيُّ هو الطيُّ نفسُه
  // المستعمَل في الخادم (searchKey): المسافاتُ والشرطاتُ وصورُ الحروف سواء.
  // ويُوجَد الطرفُ كذلك بما في معاملاته — رقمِ حاويةٍ أو بوليصةٍ أو بيان: الخادمُ
  // يجيب بأطراف المعاملات المطابقة (راجع useCustomsSearch).
  const hits = useCustomsSearch(q, rows);
  const searched = useMemo(() => {
    if (!searchKey(q)) return rows;
    return rows.filter((r) => matchesSearch(q, [r.name, r.email, r.phone, r.contactPerson, r.commercialRegister, r.taxNumber, r.city])
      || !!hits?.parties.has(String(r._id)));
  }, [rows, q, hits]);

  // فلاترُ الأعمدة (على طريقة إكسل) — آخرُ ما يُطبَّق، بعد البحث.
  const colGetters: Record<string, (p: Party) => any> = {
    name: (p) => p.name, deals: (p) => p.deals, containers: (p) => p.containers,
    active: (p) => (p.isActive === false ? t('معطَّل', 'Inactive') : t('نشط', 'Active')),
    last: (p) => (p.lastDealAt ? String(p.lastDealAt).slice(0, 7) : ''),
  };
  const shown = cf.apply(searched, colGetters);
  const totals = useMemo(() => shown.reduce((t2, r) => ({
    deals: t2.deals + (r.deals || 0), revenue: t2.revenue + (r.revenue || 0),
    profit: t2.profit + (r.profit || 0), containers: t2.containers + (r.containers || 0),
  }), { deals: 0, revenue: 0, profit: 0, containers: 0 }), [shown]);

  const save = async () => {
    if (!editing?.name?.trim()) { notify(t('الاسم مطلوب', 'Name required'), 'error'); return; }
    setSaving(true);
    try {
      if (editing._id) await api.put(`/api/customs-clearance/parties/${editing._id}`, { ...editing, contacts: contactsOf(editing) });
      else await api.post('/api/customs-clearance/parties', { ...editing, contacts: contactsOf(editing), kind });
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
    ...(kind !== 'customer' ? [{ header: t('البريد', 'Email'), key: 'email', width: 26 }] : []),
    { header: t('الجوال', 'Phone'), key: 'phone', width: 16 },
    { header: t('معاملات', 'Deals'), key: 'deals', width: 10 },
    { header: t('حاويات', 'Containers'), key: 'containers', width: 10 },
    { header: t('الإيراد', 'Revenue'), key: 'revenue', width: 14 },
    ...(seesMoney ? [{ header: t('الربح', 'Profit'), key: 'profit', width: 14 }] : []),
  ];

  if (loading) return <Spinner />;
  const Icon = kind === 'agent' ? Ship : kind === 'carrier' ? Truck : Users;
  const meta = KIND_META[kind];
  const title = t(meta.ar, meta.en);

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
            <Plus className="w-4 h-4" /> {t(meta.newAr, meta.newEn)}
          </PrimaryButton>
        )}
      </PageHeader>

      <div className={`grid grid-cols-2 gap-3 ${seesMoney ? 'sm:grid-cols-5' : 'sm:grid-cols-4'}`}>
        <Stat label={t(meta.oneAr, meta.oneEn)} value={shown.length} />
        <Stat label={t('معاملات', 'Deals')} value={money(totals.deals)} />
        <Stat label={t('حاويات', 'Containers')} value={money(totals.containers)} />
        <Stat label={t('الإيراد', 'Revenue')} value={money(totals.revenue)} accent="text-emerald-600" />
        {seesMoney && <Stat label={t('الربح', 'Profit')} value={money(totals.profit)} accent={totals.profit >= 0 ? 'text-emerald-600' : 'text-red-600'} />}
      </div>

      <ClearColumnFilters count={cf.count} onClear={cf.clear} ar={ar} />
      <SearchInput value={q} onChange={setQ}
        placeholder={t('ابحث بالاسم أو الجوال أو البريد أو السجل أو الرقم الضريبي — أو برقم حاويةٍ أو بوليصةٍ من معاملاته…', 'Name, phone, email, CR, tax no. — or a container / BL number from their deals…')} />

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
        <ScrollX>
          <table className="w-full text-sm">
            <thead className="table-head">
              <tr>
                {([[t('الاسم', 'Name'), 'name'], ...(kind !== 'customer' ? [[t('البريد', 'Email'), '']] : []), [t('التواصل', 'Contact'), ''],
                  [t('معاملات', 'Deals'), 'deals'], [t('حاويات', 'Containers'), 'containers'], [t('الإيراد', 'Revenue'), ''],
                  ...(seesMoney ? [[t('الربح', 'Profit'), ''], [t('الهامش', 'Margin'), '']] : []), [t('آخر معاملة', 'Last deal'), 'last'], ['', '']] as [string, string][]).map(([h, k], i) => (
                  <th key={i} className="px-3 py-2.5 text-start font-semibold whitespace-nowrap">
                    <span className="inline-flex items-center gap-1">{h}{k ? cf.header(k, searched, colGetters[k], ar) : null}</span>
                  </th>
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
                    {kind !== 'customer' && (
                      <td className="px-3 py-2.5 text-slate-600">
                        {p.email ? <a href={`mailto:${p.email}`} onClick={(e) => e.stopPropagation()} className="inline-flex items-center gap-1 hover:text-[#f37121]"><Mail className="w-3.5 h-3.5" />{p.email}</a>
                          : <span className="text-red-400 text-xs">{t('بلا بريد', 'no email')}</span>}
                        {contactsOf(p).length > 1 && <span className="ms-1 rounded-full bg-slate-100 px-1.5 text-[10.5px] text-slate-500">+{contactsOf(p).length - 1}</span>}
                      </td>
                    )}
                    <td className="px-3 py-2.5 text-slate-600 whitespace-nowrap">
                      {p.phone ? <a href={`tel:${p.phone}`} onClick={(e) => e.stopPropagation()} className="inline-flex items-center gap-1 hover:text-[#f37121]"><Phone className="w-3.5 h-3.5" />{p.phone}</a> : '—'}
                      {p.contactPerson ? <span className="text-xs text-slate-400 ms-1">· {p.contactPerson}</span> : null}
                    </td>
                    <td className="px-3 py-2.5 tabular-nums">{money(p.deals)}</td>
                    <td className="px-3 py-2.5 tabular-nums">{money(p.containers)}</td>
                    <td className="px-3 py-2.5 tabular-nums text-emerald-700">{money(p.revenue)}</td>
                    {seesMoney && <td className={`px-3 py-2.5 tabular-nums font-semibold ${p.profit >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>{money(p.profit)}</td>}
                    {seesMoney && <td className="px-3 py-2.5 tabular-nums text-slate-600">{p.revenue ? `${margin}%` : '—'}</td>}
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
        </ScrollX>
      </div>

      <Modal open={!!editing} onClose={() => setEditing(null)}
        title={editing?._id ? t('تعديل', 'Edit') : t(meta.newAr, meta.newEn)}
        footer={<>
          <button type="button" onClick={() => setEditing(null)} className="px-4 py-2 text-slate-500 text-sm">{t('إلغاء', 'Cancel')}</button>
          <PrimaryButton onClick={save} disabled={saving}>{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}{t('حفظ', 'Save')}</PrimaryButton>
        </>}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="sm:col-span-2"><Field label={t('الاسم *', 'Name *')}>
            <TextInput value={editing?.name || ''} onChange={(e) => setEditing((p) => ({ ...p, name: e.target.value }))} /></Field></div>
          {/* ── جهاتُ التواصل: أكثرُ من واحدة، كلُّ مسؤولٍ ببريده وجوّاله (٢٠٢٦/١٠/٢٢).
              الأولى هي الأساسيّة — بريدُها يُملأ وحدَه في معاملات الوكيل. */}
          <div className="sm:col-span-2 space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-[13px] font-semibold text-slate-700">{t('جهات التواصل', 'Contacts')}</p>
              <button type="button" onClick={() => setEditing((p) => ({ ...p, contacts: [...contactsOf(p), { name: '', email: '', phone: '', description: '' }] }))}
                className="inline-flex items-center gap-1 rounded-lg bg-[#f37121]/10 px-2.5 py-1 text-[12px] font-semibold text-[#f37121] hover:bg-[#f37121]/20">
                <Plus className="h-3.5 w-3.5" />{t('إضافة جهة', 'Add contact')}
              </button>
            </div>
            {(contactsOf(editing).length ? contactsOf(editing) : [{ name: '', email: '', phone: '', description: '' }]).map((c, i, arr) => {
              const setC = (patch: Partial<Contact>) => setEditing((p) => {
                const list = contactsOf(p).length ? [...contactsOf(p)] : [{ name: '', email: '', phone: '', description: '' }];
                list[i] = { ...list[i], ...patch };
                return { ...p, contacts: list };
              });
              return (
                <div key={i} className="grid grid-cols-1 gap-2 rounded-xl border border-slate-200 bg-slate-50/60 p-2.5 sm:grid-cols-3">
                  <TextInput placeholder={t('مسؤول التواصل', 'Contact person')} value={c.name} onChange={(e) => setC({ name: e.target.value })} />
                  <TextInput type="email" placeholder={t('البريد الإلكتروني', 'Email')} value={c.email} onChange={(e) => setC({ email: e.target.value })} />
                  <div className="flex items-center gap-2">
                    <TextInput placeholder={t('الجوال', 'Phone')} value={c.phone} onChange={(e) => setC({ phone: e.target.value })} />
                    {arr.length > 1 && (
                      <button type="button" title={t('حذف الجهة', 'Remove')} onClick={() => setEditing((p) => ({ ...p, contacts: contactsOf(p).filter((_, j) => j !== i) }))}
                        className="shrink-0 p-1.5 text-slate-400 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>
                    )}
                  </div>
                  {/* وصفُ البريد اختياريّ لوكلاء الشحن: «للفواتير»، «لإذن التسليم»… */}
                  {kind === 'agent' && (
                    <div className="sm:col-span-3">
                      <TextInput placeholder={t('وصف البريد (اختياري) — مثلًا: للفواتير، لإذن التسليم', 'Email description (optional) — e.g. invoices, delivery orders')}
                        value={c.description || ''} onChange={(e) => setC({ description: e.target.value })} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {kind === 'carrier' && (
            <div className="sm:col-span-2"><Field label={t('موقع الساحة (رابط خرائط)', 'Yard location (map link)')}>
              <TextInput type="url" dir="ltr" placeholder="https://maps.google.com/…" value={editing?.yardLocationUrl || ''} onChange={(e) => setEditing((p) => ({ ...p, yardLocationUrl: e.target.value }))} /></Field></div>
          )}
          <Field label={t('المدينة', 'City')}>
            <TextInput value={editing?.city || ''} onChange={(e) => setEditing((p) => ({ ...p, city: e.target.value }))} /></Field>
          <Field label={t('السجل التجاري', 'Commercial register')}>
            <TextInput value={editing?.commercialRegister || ''} onChange={(e) => setEditing((p) => ({ ...p, commercialRegister: e.target.value }))} /></Field>
          <Field label={t('الرقم الضريبي', 'Tax number')}>
            <TextInput value={editing?.taxNumber || ''} onChange={(e) => setEditing((p) => ({ ...p, taxNumber: e.target.value }))} /></Field>
          <div className="sm:col-span-2"><Field label={t('العنوان', 'Address')}>
            <TextInput value={editing?.address || ''} onChange={(e) => setEditing((p) => ({ ...p, address: e.target.value }))} /></Field></div>
          <div className="sm:col-span-2"><Field label={t('ملاحظات', 'Notes')}>
            <textarea rows={3} value={editing?.notes || ''} onChange={(e) => setEditing((p) => ({ ...p, notes: e.target.value }))}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#f37121]/40" /></Field></div>
        </div>
      </Modal>
    </div>
  );
}
