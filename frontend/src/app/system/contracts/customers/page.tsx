'use client';
/**
 * عملاءُ العقود — الطرفُ الآخر من كلّ صفقة.
 *
 * ── ما كان ناقصًا ────────────────────────────────────────────────────────────
 * القسمُ كان يعرف نصفَ عمله: سجلٌّ كاملٌ للمورّدين بعقودهم ووثائقهم وحصصهم،
 * وأمّا العملاء فلا سجلَّ لهم إلّا صفوفًا في «عقود الأقسام» تُبحَث بالاسم. فسؤالُ
 * كلّ أسبوع — «فلانٌ عقدُه موقَّعٌ وإلى متى؟» — لا جوابَ له إلّا في ورقة.
 *
 * ── والصفُّ مربوطٌ لا منسوخ ────────────────────────────────────────────────────
 * ما يخصّ العقدَ يُكتب هنا؛ وما عداه يُقرأ من مصدره في كلّ فتحة: كم شحنةً شحن
 * معنا وبكم (من كشوف التشغيل)، ومهلتُه ومحصِّلُه (من التحصيل)، وكم عقدًا مرفوعًا
 * له (من عقود الأقسام). ورقمٌ منسوخٌ يشيخ في يومه.
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import { useDialog } from '@/components/system/DialogProvider';
import {
  Handshake, Plus, Pencil, Trash2, Loader2, Check, Sparkles, ExternalLink, X,
} from 'lucide-react';
import {
  Spinner, PageHeader, SearchInput, Modal, Field, TextInput, TextArea, Select,
  PrimaryButton, ErrorNotice, SmallBadge, StatCard,
} from '@/components/hr/HRKit';
import ExportMenu, { exportScopeLabels, type ExportColumn } from '@/components/ls2/ExportMenu';
import {
  ContractCustomer, CUSTOMER_STATUS, EXPIRY_META,
  canViewContracts, canEditContracts, fmtN, fmtD, foldAr,
} from '@/lib/contracts';

const emptyForm = {
  name: '', sector: '', customerType: '', contactPerson: '', phone: '', email: '',
  headquarters: '', energizeRep: '', crNumber: '', taxNumber: '',
  customerSideContract: false, ourSideContract: false, documentsReceived: false, missingDocuments: '',
  contractDate: '', startDate: '', endDate: '', paymentTermDays: '30',
  renewalPolicy: 'تلقائي ما لم يصدر إشعار بعدم الرغبة',
  pricingNotes: '', operationalStatus: '', followUpNotes: '', notes: '',
};

interface Suggestion { nameKey: string; name: string; loads: number; value: number; lastLoad: string | null }

export default function ContractCustomersPage() {
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const t = (a: string, e: string) => (ar ? a : e);
  const { confirm, notify } = useDialog();
  const canEdit = canEditContracts(user);

  const [customers, setCustomers] = useState<ContractCustomer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState<'' | 'signed' | 'pending' | 'unsigned' | 'expiring'>('');

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<ContractCustomer | null>(null);
  const [form, setForm] = useState<any>(emptyForm);
  const [saving, setSaving] = useState(false);

  const [suggestOpen, setSuggestOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null);
  const [suggestQ, setSuggestQ] = useState('');
  const [adding, setAdding] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const d = await api.get<{ customers: ContractCustomer[] }>('/api/contracts/customers');
      setCustomers(d.customers || []);
      setError('');
    } catch (e: any) { setError(e?.message || 'Request failed'); }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);
  useSocket('contracts:updated', useCallback(() => load(), [load]));

  const openSuggest = async () => {
    setSuggestOpen(true);
    if (suggestions) return;
    try {
      const d = await api.get<{ suggestions: Suggestion[] }>('/api/contracts/customers/suggestions');
      setSuggestions(d.suggestions || []);
    } catch (e: any) { notify(e?.message || t('تعذّر التحميل', 'Could not load'), 'error'); setSuggestions([]); }
  };

  const addSuggested = async (s: Suggestion) => {
    setAdding(s.nameKey);
    try {
      await api.post('/api/contracts/customers', { name: s.name });
      setSuggestions((p) => (p || []).filter((x) => x.nameKey !== s.nameKey));
      load();
    } catch (e: any) { notify(e?.message || t('تعذّرت الإضافة', 'Could not add'), 'error'); }
    setAdding(null);
  };

  const openNew = () => { setEditing(null); setForm({ ...emptyForm }); setShowForm(true); };
  const openEdit = (c: ContractCustomer) => {
    setEditing(c);
    setForm({
      ...emptyForm,
      ...c,
      contractDate: c.contractDate?.slice(0, 10) || '',
      startDate: c.startDate?.slice(0, 10) || '',
      endDate: c.endDate?.slice(0, 10) || '',
      paymentTermDays: String(c.paymentTermDays ?? 30),
    });
    setShowForm(true);
  };

  const save = async () => {
    if (!String(form.name || '').trim()) { notify(t('اسم العميل مطلوب', 'Name required'), 'error'); return; }
    setSaving(true);
    try {
      const body = { ...form, paymentTermDays: Number(form.paymentTermDays) || null };
      if (editing) await api.patch(`/api/contracts/customers/${editing._id}`, body);
      else await api.post('/api/contracts/customers', body);
      setShowForm(false);
      load();
    } catch (e: any) { notify(e?.message || t('تعذّر الحفظ', 'Could not save'), 'error'); }
    setSaving(false);
  };

  const remove = async (c: ContractCustomer) => {
    if (!(await confirm(t(`حذف «${c.name}» من سجل العملاء؟ كشوفُه وعقودُه لا تُمسّ.`,
      `Delete “${c.name}”? Their reports and contracts are untouched.`)))) return;
    try { await api.delete(`/api/contracts/customers/${c._id}`); load(); }
    catch (e: any) { notify(e?.message || t('تعذّر الحذف', 'Could not delete'), 'error'); }
  };

  const shown = useMemo(() => {
    const f = foldAr(q.trim());
    return customers.filter((c) => {
      if (f && !foldAr(`${c.name} ${c.contactPerson || ''} ${c.energizeRep || ''} ${c.headquarters || ''}`).includes(f)) return false;
      if (statusFilter === 'expiring') return c.expiry === 'due' || c.expiry === 'expired';
      if (statusFilter) return c.status === statusFilter;
      return true;
    });
  }, [customers, q, statusFilter]);

  const counts = useMemo(() => ({
    total: customers.length,
    signed: customers.filter((c) => c.status === 'signed').length,
    pending: customers.filter((c) => c.status === 'pending').length,
    unsigned: customers.filter((c) => c.status === 'unsigned').length,
    expiring: customers.filter((c) => c.expiry === 'due' || c.expiry === 'expired').length,
  }), [customers]);

  const cols: ExportColumn[] = [
    { header: t('العميل', 'Customer'), key: 'name', width: 34 },
    { header: t('القطاع', 'Sector'), key: 'sector', width: 16 },
    { header: t('النوع', 'Type'), key: 'customerType', width: 12 },
    { header: t('حالة العقد', 'Contract'), key: 'status', width: 14,
      transform: (v: any) => (v ? (ar ? CUSTOMER_STATUS[v as keyof typeof CUSTOMER_STATUS].ar : CUSTOMER_STATUS[v as keyof typeof CUSTOMER_STATUS].en) : '') },
    { header: t('تاريخ العقد', 'Signed on'), key: 'contractDate', width: 14, transform: (v: any) => fmtD(v) },
    { header: t('ينتهي في', 'Ends'), key: 'endDate', width: 14, transform: (v: any) => fmtD(v) },
    { header: t('مهلة السداد (يوم)', 'Term (days)'), key: 'paymentTermDays', width: 16 },
    { header: t('عدد الشحنات', 'Loads'), key: 'loads', width: 12 },
    { header: t('قيمة البيع', 'Sold value'), key: 'value', width: 16 },
    { header: t('آخر شحنة', 'Last load'), key: 'lastLoad', width: 14, transform: (v: any) => fmtD(v) },
    { header: t('العقود المرفوعة', 'Agreements'), key: 'agreements', width: 14 },
    { header: t('مسؤول التنشيط', 'Our rep'), key: 'energizeRep', width: 18 },
    { header: t('جهة الاتصال', 'Contact'), key: 'contactPerson', width: 20 },
    { header: t('الجوال', 'Phone'), key: 'phone', width: 16 },
    { header: t('المقر', 'HQ'), key: 'headquarters', width: 14 },
    { header: t('السجل التجاري', 'CR'), key: 'crNumber', width: 16 },
    { header: t('الرقم الضريبي', 'VAT no.'), key: 'taxNumber', width: 18 },
    { header: t('وثائق ناقصة', 'Missing docs'), key: 'missingDocuments', width: 24 },
    { header: t('ملاحظات', 'Notes'), key: 'notes', width: 30 },
  ];

  if (!canViewContracts(user)) return <div className="text-slate-500 p-8">{t('غير مصرّح', 'Not authorized')}</div>;
  if (loading) return <Spinner />;

  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));
  const th = 'text-start font-semibold px-4 py-3 whitespace-nowrap';

  const sq = foldAr(suggestQ.trim());
  const shownSuggestions = (suggestions || []).filter((s) => !sq || foldAr(s.name).includes(sq));

  return (
    <div className="space-y-5" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader icon={<Handshake className="w-5 h-5" />}
        title={t('العملاء', 'Customers')}
        subtitle={t('الطرف الآخر من كل صفقة — عقودُهم وشروطُهم، وما يشحنونه معنا فعلًا',
                    'The other side of every deal — their contracts and terms, and what they actually ship with us')}>
        <ExportMenu fileName="contracts-customers" lang={ar ? 'ar' : 'en'}
          options={[
            { key: 'shown', label: exportScopeLabels(ar).shown, sheets: [{ name: t('العملاء', 'Customers'), rows: shown as any[], columns: cols }] },
            { key: 'all', label: exportScopeLabels(ar).all, sheets: [{ name: t('العملاء', 'Customers'), rows: customers as any[], columns: cols }] },
          ]} />
        {canEdit && (
          <>
            {/* ── ولا يُملأ السجلُّ بالكتابة من ورقة ────────────────────────────
                العملاءُ معروفون: هم من تحمل كشوفُنا أسماءهم. فيُقترَحون مرتّبين
                بحجمهم — الأكبرُ أوّلًا، وهو مَن يُسأل عن عقده أوّلًا. */}
            <button type="button" onClick={openSuggest}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#f37121]/10 text-[#f37121] hover:bg-[#f37121]/20 text-sm font-semibold">
              <Sparkles className="w-4 h-4" /> {t('عملاء بلا سجل', 'Unregistered customers')}
            </button>
            <PrimaryButton onClick={openNew}><Plus className="w-4 h-4" /> {t('إضافة عميل', 'Add customer')}</PrimaryButton>
          </>
        )}
      </PageHeader>

      {error && <ErrorNotice error={error} lang={lang} onRetry={load} />}

      {/* البطاقاتُ فلترٌ أيضًا: «أرِني غيرَ الموقَّعين» سؤالٌ يُسأل كلَّ أسبوع. */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {([
          ['', t('كل العملاء', 'All customers'), counts.total, 'text-[#f37121]'],
          ['signed', t('موقّعون', 'Signed'), counts.signed, 'text-emerald-600'],
          ['pending', t('قيد التوقيع', 'Pending'), counts.pending, 'text-amber-600'],
          ['unsigned', t('بلا عقد', 'Unsigned'), counts.unsigned, 'text-red-600'],
          ['expiring', t('ينتهي أو انتهى', 'Ending / ended'), counts.expiring, counts.expiring ? 'text-red-600' : 'text-slate-400'],
        ] as [any, string, number, string][]).map(([k, label, value, accent]) => (
          <button key={k || 'all'} type="button" onClick={() => setStatusFilter(statusFilter === k ? '' : k)}
            className={`text-start rounded-xl transition-all ${statusFilter === k ? 'ring-2 ring-[#f37121] rounded-xl' : ''}`}>
            <StatCard label={label} value={fmtN(value)} accent={accent} />
          </button>
        ))}
      </div>

      <div className="max-w-md">
        <SearchInput value={q} onChange={setQ}
          placeholder={t('ابحث بالاسم أو جهة الاتصال أو المندوب…', 'Name, contact or rep…')} />
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto shadow-sm">
        <table className="w-full text-sm">
          <thead><tr className="bg-slate-900 border-b border-slate-200 text-slate-300">
            <th className={th}>{t('العميل', 'Customer')}</th>
            <th className={th}>{t('حالة العقد', 'Contract')}</th>
            <th className={th}>{t('المدة', 'Period')}</th>
            <th className={th}>{t('مهلة السداد', 'Term')}</th>
            <th className={th}>{t('شحناته معنا', 'Loads with us')}</th>
            <th className={th}>{t('قيمة البيع', 'Sold value')}</th>
            <th className={th}>{t('آخر شحنة', 'Last load')}</th>
            <th className={th}>{t('العقود', 'Agreements')}</th>
            <th className={th}>{t('إجراءات', 'Actions')}</th>
          </tr></thead>
          <tbody>
            {shown.map((c) => {
              const st = CUSTOMER_STATUS[(c.status || 'unsigned') as keyof typeof CUSTOMER_STATUS];
              const ex = c.expiry && c.expiry !== 'valid' ? EXPIRY_META[c.expiry as 'due' | 'expired'] : null;
              return (
                <tr key={c._id} className="border-b border-slate-200/70 hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <p className="font-bold text-slate-900">{c.name}</p>
                    <p className="text-[11.5px] text-slate-500">
                      {[c.sector, c.headquarters, c.energizeRep].filter(Boolean).join(' · ') || '—'}
                    </p>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <span className={`text-xs font-semibold rounded-full px-2.5 py-1 ${st.cls}`}>{ar ? st.ar : st.en}</span>
                    {/* الوثائقُ الناقصةُ تُقال مع الحالة: عقدٌ موقَّعٌ بلا سجلٍّ
                        تجاريٍّ ليس عقدًا مكتملًا، وهي أوّلُ ما يُسأل عنه. */}
                    {c.status === 'signed' && !c.documentsReceived && (
                      <span className="ms-1.5 text-[11px] text-amber-600">{t('وثائق ناقصة', 'docs missing')}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-slate-600 text-[13px]">
                    {c.startDate || c.endDate ? (
                      <>
                        {fmtD(c.startDate)} — {fmtD(c.endDate)}
                        {ex && <span className={`ms-1.5 text-[11px] font-semibold rounded-full px-2 py-0.5 ${ex.cls}`}>{ar ? ex.ar : ex.en}</span>}
                      </>
                    ) : <span className="text-slate-300">—</span>}
                  </td>
                  <td className="px-4 py-3 text-slate-700 tabular-nums whitespace-nowrap">
                    {c.paymentTermDays ? t(`${c.paymentTermDays} يوم`, `${c.paymentTermDays} days`) : '—'}
                    {/* ومهلةُ التحصيل إن اختلفت عمّا في العقد — الاختلافُ نفسُه
                        هو الخبر: أحدُ الرقمين خطأ ويُطالَب به عميل. */}
                    {c.collectionsTerms && String(c.collectionsTerms) !== String(c.paymentTermDays) && (
                      <span className="block text-[11px] text-amber-600">{t('التحصيل:', 'collections:')} {c.collectionsTerms}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 tabular-nums text-slate-800 font-semibold">{c.loads ? fmtN(c.loads) : <span className="text-slate-300">—</span>}</td>
                  <td className="px-4 py-3 tabular-nums text-slate-800">{c.value ? fmtN(Math.round(c.value)) : <span className="text-slate-300">—</span>}</td>
                  <td className="px-4 py-3 text-slate-600 whitespace-nowrap text-[13px]">{c.lastLoad ? fmtD(c.lastLoad) : <span className="text-slate-300">—</span>}</td>
                  <td className="px-4 py-3">
                    {c.agreements
                      ? <SmallBadge bg="bg-blue-500/15" text="text-blue-700" label={String(c.agreements)} />
                      : <span className="text-slate-300">—</span>}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      {canEdit && (
                        <button type="button" onClick={() => openEdit(c)}
                          className="p-1.5 rounded-lg text-slate-500 hover:text-[#f37121] hover:bg-slate-100" title={t('تعديل', 'Edit')}>
                          <Pencil className="w-4 h-4" />
                        </button>
                      )}
                      {canEdit && (
                        <button type="button" onClick={() => remove(c)}
                          className="p-1.5 rounded-lg text-slate-500 hover:text-red-600 hover:bg-slate-100" title={t('حذف', 'Delete')}>
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
            {!shown.length && (
              <tr><td colSpan={9} className="text-center text-slate-500 py-14">
                {customers.length
                  ? t('لا نتائج مطابقة', 'No matches')
                  : t('السجل فارغ — ابدأ من «عملاء بلا سجل»، فهم في كشوفنا بالفعل.',
                       'Empty register — start from “Unregistered customers”; they are already in our reports.')}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* ── الاقتراحات ─────────────────────────────────────────────────────── */}
      <Modal open={suggestOpen} onClose={() => setSuggestOpen(false)}
        title={t('عملاء يشحنون معنا ولا سجل لهم', 'Customers shipping with us, not registered')}
        footer={<button type="button" onClick={() => setSuggestOpen(false)} className="px-4 py-2 text-slate-500 text-sm">{t('إغلاق', 'Close')}</button>}>
        <p className="text-[12.5px] text-slate-500 mb-3 leading-relaxed">
          {t('مأخوذون من كشوف التشغيل ومرتّبون بعدد شحناتهم — الأكبر أوّلًا. تُضيفه بضغطة ثم تكمل بيانات عقده.',
             'Taken from the operations reports, largest first. One tap registers them; fill their contract after.')}
        </p>
        <div className="mb-3">
          <SearchInput value={suggestQ} onChange={setSuggestQ} placeholder={t('ابحث بالاسم…', 'Search by name…')} />
        </div>
        {suggestions === null ? <Spinner /> : (
          <div className="max-h-[50vh] overflow-y-auto divide-y divide-slate-100">
            {shownSuggestions.map((s) => (
              <div key={s.nameKey} className="flex items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-slate-900 truncate">{s.name}</p>
                  <p className="text-[11.5px] text-slate-500">
                    {t(`${fmtN(s.loads)} شحنة · ${fmtN(Math.round(s.value))} ر.س`, `${fmtN(s.loads)} loads · ${fmtN(Math.round(s.value))} SAR`)}
                    {s.lastLoad ? ` · ${t('آخر شحنة', 'last')} ${fmtD(s.lastLoad)}` : ''}
                  </p>
                </div>
                <button type="button" onClick={() => addSuggested(s)} disabled={adding === s.nameKey}
                  className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#f37121]/10 text-[#f37121] text-xs font-semibold hover:bg-[#f37121]/20 disabled:opacity-50">
                  {adding === s.nameKey ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                  {t('إضافة', 'Add')}
                </button>
              </div>
            ))}
            {!shownSuggestions.length && (
              <p className="text-slate-400 text-sm text-center py-8">
                {t('لا عميلَ خارج السجل — كلُّ من يشحن معنا مسجَّل.', 'Nobody outside the register — everyone shipping with us is registered.')}
              </p>
            )}
          </div>
        )}
      </Modal>

      {/* ── الإضافة والتعديل ───────────────────────────────────────────────── */}
      <Modal open={showForm} onClose={() => setShowForm(false)}
        title={editing ? t(`تعديل — ${editing.name}`, `Edit — ${editing.name}`) : t('إضافة عميل', 'Add customer')}
        footer={<>
          <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2 text-slate-500 text-sm">{t('إلغاء', 'Cancel')}</button>
          <PrimaryButton onClick={save} disabled={saving}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}{t('حفظ', 'Save')}
          </PrimaryButton>
        </>}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label={t('اسم العميل *', 'Customer name *')} span2>
            <TextInput value={form.name} onChange={(e) => set('name', e.target.value)} />
          </Field>
          <Field label={t('القطاع', 'Sector')}><TextInput value={form.sector} onChange={(e) => set('sector', e.target.value)} /></Field>
          <Field label={t('نوع العميل', 'Customer type')}>
            <Select value={form.customerType} onChange={(e) => set('customerType', e.target.value)}>
              <option value="">—</option>
              <option value="ضريبي">{t('ضريبي', 'Tax')}</option>
              <option value="كاش">{t('كاش', 'Cash')}</option>
              <option value="آجل">{t('آجل', 'Credit')}</option>
            </Select>
          </Field>
          <Field label={t('جهة الاتصال', 'Contact person')}><TextInput value={form.contactPerson} onChange={(e) => set('contactPerson', e.target.value)} /></Field>
          <Field label={t('الجوال', 'Phone')}><TextInput value={form.phone} onChange={(e) => set('phone', e.target.value)} /></Field>
          <Field label={t('البريد', 'Email')}><TextInput value={form.email} onChange={(e) => set('email', e.target.value)} /></Field>
          <Field label={t('المقر', 'Headquarters')}><TextInput value={form.headquarters} onChange={(e) => set('headquarters', e.target.value)} /></Field>
          <Field label={t('مسؤول التنشيط لدينا', 'Our rep')}><TextInput value={form.energizeRep} onChange={(e) => set('energizeRep', e.target.value)} /></Field>
          <Field label={t('السجل التجاري', 'CR number')}><TextInput value={form.crNumber} onChange={(e) => set('crNumber', e.target.value)} /></Field>
          <Field label={t('الرقم الضريبي', 'VAT number')}><TextInput value={form.taxNumber} onChange={(e) => set('taxNumber', e.target.value)} /></Field>

          {/* ── التوقيعان ────────────────────────────────────────────────────
              العقدُ عقدٌ حين يوقّعه الطرفان. وفصلُهما ليس تفصيلًا: «أرسلناه ولم
              يعُد» هي أكثرُ الحالات، ولا تُقال بخانةٍ واحدة. */}
          <div className="sm:col-span-2 rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-2">
            <p className="text-[12.5px] font-bold text-slate-700">{t('حالة العقد', 'Contract state')}</p>
            {([
              ['customerSideContract', t('موقَّع من العميل', 'Signed by customer')],
              ['ourSideContract', t('موقَّع من طرفنا', 'Signed by us')],
              ['documentsReceived', t('الوثائق مستلمة', 'Documents received')],
            ] as [string, string][]).map(([k, label]) => (
              <label key={k} className="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" className="w-4 h-4 accent-[#f37121]" checked={!!form[k]} onChange={(e) => set(k, e.target.checked)} />
                {label}
              </label>
            ))}
            <TextInput value={form.missingDocuments} onChange={(e) => set('missingDocuments', e.target.value)}
              placeholder={t('الوثائق الناقصة — تُكتب كما هي: «السجل ورقم الآيبان»', 'Missing documents, as they are')} />
          </div>

          <Field label={t('تاريخ التوقيع', 'Signed on')}><TextInput type="date" value={form.contractDate} onChange={(e) => set('contractDate', e.target.value)} /></Field>
          <Field label={t('مهلة السداد (يوم)', 'Payment term (days)')}><TextInput type="number" value={form.paymentTermDays} onChange={(e) => set('paymentTermDays', e.target.value)} /></Field>
          <Field label={t('بداية العقد', 'Start date')}><TextInput type="date" value={form.startDate} onChange={(e) => set('startDate', e.target.value)} /></Field>
          <Field label={t('نهاية العقد', 'End date')}><TextInput type="date" value={form.endDate} onChange={(e) => set('endDate', e.target.value)} /></Field>
          <Field label={t('سياسة التجديد', 'Renewal policy')} span2><TextInput value={form.renewalPolicy} onChange={(e) => set('renewalPolicy', e.target.value)} /></Field>
          <Field label={t('ملاحظات التسعير', 'Pricing notes')} span2><TextArea rows={2} value={form.pricingNotes} onChange={(e) => set('pricingNotes', e.target.value)} /></Field>
          <Field label={t('حالة التشغيل', 'Operational status')}><TextInput value={form.operationalStatus} onChange={(e) => set('operationalStatus', e.target.value)} /></Field>
          <Field label={t('ملاحظات المتابعة', 'Follow-up notes')}><TextInput value={form.followUpNotes} onChange={(e) => set('followUpNotes', e.target.value)} /></Field>
          <Field label={t('ملاحظات', 'Notes')} span2><TextArea rows={2} value={form.notes} onChange={(e) => set('notes', e.target.value)} /></Field>
        </div>
      </Modal>
    </div>
  );
}
