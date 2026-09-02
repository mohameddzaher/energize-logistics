'use client';
// أطرافُ التحصيل — الصفحةُ نفسُها تخدم العملاءَ والموردين.
//
// البنيةُ واحدة (اسمٌ، تواصلٌ، مستحقٌّ، ملفٌّ يُفتح) والفرقُ اتّجاهُ المال.
// وصفحتان متطابقتان بملفّين تعنيان إصلاحَ كلّ عطلٍ مرّتين ثمّ نسيانَ إحداهما.
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useDialog } from '@/components/system/DialogProvider';
import api from '@/lib/api';
import { useLatestRequest } from '@/hooks/useLatestRequest';
import {
  canEditCollections, receivablesOnly, kindWords, money, dt,
  type PartyKind, type CollectionsParty,
} from '@/lib/collections';
import {
  Spinner, PageHeader, SearchInput, PrimaryButton, Modal, Field, TextInput, Select, Loader2,
} from '@/components/hr/HRKit';
import ManagedSelect from '@/components/system/ManagedSelect';
import ExportMenu, { type ExportColumn } from '@/components/ls2/ExportMenu';
import {
  Users, Truck, Plus, Pencil, Trash2, Phone, Mail, ChevronLeft, SlidersHorizontal, X,
} from 'lucide-react';

const PAGE_SIZE = 100;

export default function CollectionsPartiesPage({ kind }: { kind: PartyKind }) {
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const t = (a: string, e: string) => (ar ? a : e);
  const { notify, confirm } = useDialog();
  const router = useRouter();
  const W = kindWords(kind, ar);

  const canEdit = canEditCollections(user);
  // الحذفُ كالتعديل: منحُ «تعديل» على قسمٍ يمرّ كلَّ نقطةٍ فيه على الخادم،
  // فزرٌّ مخفيٌّ بشرطٍ أضيق يُخفي فعلًا مسموحًا لا يمنعه.
  const canDelete = canEdit;

  // ── وسجلُّ الموردين يُقرأ بلا أرقام لمن يُحصِّل ──────────────────────────
  // الاسمُ والتواصلُ والهويّةُ التجاريّة شغلٌ مشترك؛ أمّا ما ندفعه لهم فليس
  // شأنَ التحصيل. فالصفحةُ تبقى مفتوحةً وتسقط أعمدةُ المال وحدَها — إخفاؤها
  // كلِّها كان سيمنع بحثًا مشروعًا عن رقمِ مورّدٍ أو سجلِّه.
  const hideMoney = kind === 'supplier' && receivablesOnly(user);

  const [rows, setRows] = useState<CollectionsParty[]>([]);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Partial<CollectionsParty> | null>(null);
  const [saving, setSaving] = useState(false);

  // الفلاترُ خلف زرّ: أحدَ عشرَ فلترًا مبسوطةً تزاحم الجدولَ الذي جاء المستخدمُ
  // لأجله. والبحثُ يبقى ظاهرًا لأنّه ما يُستعمَل كلَّ مرّة.
  const [showFilters, setShowFilters] = useState(false);
  const [status, setStatus] = useState('');
  const [city, setCity] = useState('');
  const [partyType, setPartyType] = useState('');
  const [active, setActive] = useState('');
  const [onlyDue, setOnlyDue] = useState(false);
  const activeCount = [status, city, partyType, active].filter(Boolean).length + (onlyDue ? 1 : 0);

  // ترتيبُ وصول الردود ليس ترتيبَ إرسالها: بحثٌ سريعٌ قد يسبق ردُّه ردَّ ما
  // قبله، فتُعرض نتيجةُ حرفٍ قديم فوق ما كتبه المستخدم.
  const { begin, isCurrent } = useLatestRequest();

  const load = useCallback(async () => {
    const token = begin();
    setLoading(true);
    try {
      const p = new URLSearchParams({ kind, page: String(page), limit: String(PAGE_SIZE) });
      if (q.trim()) p.set('q', q.trim());
      if (status) p.set('status', status);
      if (city) p.set('city', city);
      if (partyType) p.set('partyType', partyType);
      if (active) p.set('active', active);
      const d = await api.get<{ parties: CollectionsParty[]; total: number; pages: number }>(
        `/api/collections-dept/parties?${p.toString()}`,
      );
      if (!isCurrent(token)) return;
      setRows(d.parties || []);
      setTotal(d.total || 0);
      setPages(d.pages || 1);
    } catch (e: any) {
      if (isCurrent(token)) notify(e?.message || t('تعذّر التحميل', 'Could not load'), 'error');
    } finally {
      if (isCurrent(token)) setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, page, q, status, city, partyType, active]);

  // البحثُ يُمهَل: نداءُ الخادم عند كلّ حرفٍ إسرافٌ على عنقودٍ مقيَّد.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; load(); return; }
    const id = setTimeout(load, 300);
    return () => clearTimeout(id);
  }, [load]);

  // تغييرُ الفلتر يعيد إلى الصفحة الأولى: البقاءُ على الصفحة السابعة بعد فلترٍ
  // يعيد صفّين هو ما يجعل الشاشة تظهر فارغةً بلا سبب.
  useEffect(() => { setPage(1); }, [q, status, city, partyType, active]);

  const shown = useMemo(() => (onlyDue ? rows.filter((r) => (r.outstanding || 0) > 0) : rows), [rows, onlyDue]);

  const totals = useMemo(() => shown.reduce((a, r) => ({
    reports: a.reports + (r.reports || 0),
    total: a.total + (r.total || 0),
    settled: a.settled + (r.settled || 0),
    outstanding: a.outstanding + (r.outstanding || 0),
  }), { reports: 0, total: 0, settled: 0, outstanding: 0 }), [shown]);

  const save = async () => {
    if (!editing?.name?.trim()) { notify(t('الاسم مطلوب', 'Name required'), 'error'); return; }
    setSaving(true);
    try {
      if (editing._id) await api.put(`/api/collections-dept/parties/${editing._id}`, editing);
      else await api.post('/api/collections-dept/parties', { ...editing, kind });
      setEditing(null);
      load();
    } catch (e: any) { notify(e?.message || t('تعذّر الحفظ', 'Could not save'), 'error'); }
    setSaving(false);
  };

  const remove = async (p: CollectionsParty) => {
    const ok = await confirm({ message: t(`حذف «${p.name}»؟`, `Delete “${p.name}”?`) });
    if (!ok) return;
    try {
      const r = await api.delete<{ deactivated?: boolean; message?: string }>(`/api/collections-dept/parties/${p._id}`);
      if (r?.deactivated) notify(r.message || t('عُطِّل', 'Deactivated'));
      load();
    } catch (e: any) { notify(e?.message || t('تعذّر الحذف', 'Could not delete'), 'error'); }
  };

  const cols: ExportColumn[] = [
    { header: t('الاسم', 'Name'), key: 'name', width: 32 },
    { header: t('الجوال', 'Phone'), key: 'phone', width: 16 },
    { header: t('مسؤول التواصل', 'Contact'), key: 'contactPerson', width: 20 },
    { header: t('السجل التجاري', 'CR'), key: 'commercialRegister', width: 16 },
    { header: t('الرقم الضريبي', 'Tax no.'), key: 'taxNumber', width: 18 },
    ...(kind === 'supplier' ? [{ header: t('الآيبان', 'IBAN'), key: 'iban', width: 28 }] : []),
    { header: t('المدينة', 'City'), key: 'city', width: 14 },
    { header: t('شروط السداد', 'Payment terms'), key: 'paymentTerms', width: 14 },
    { header: t('الحالة', 'Status'), key: 'status', width: 14 },
    // الملفُّ لا يخرج بما لا يُعرَض على الشاشة.
    ...(hideMoney ? [] : [
      { header: t('كشوف', 'Reports'), key: 'reports', width: 10 },
      { header: W.totalLabel, key: 'total', width: 16 },
      { header: W.settledLabel, key: 'settled', width: 16 },
      { header: W.dueLabel, key: 'outstanding', width: 16 },
    ]),
    { header: t('آخر كشف', 'Last report'), key: 'lastReportAt', width: 14 },
  ];

  const Icon = kind === 'supplier' ? Truck : Users;

  const Stat = ({ label, value, accent }: { label: string; value: string | number; accent?: string }) => (
    <div className="bg-white border border-slate-200 rounded-xl px-4 py-3 shadow-sm min-w-0">
      <p className="text-[11px] text-slate-500 truncate">{label}</p>
      <p className={`text-xl font-bold tabular-nums break-words ${accent || 'text-slate-900'}`}>{value}</p>
    </div>
  );

  return (
    <div className="space-y-4 pb-10" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader
        icon={<Icon className="w-6 h-6 text-[#f37121]" />}
        title={W.title}
        subtitle={t('اضغط على أيّ اسم ليُفتح ملفُّه الكامل بكشوفه وأرقامه', 'Tap any name for its full profile')}
      >
        {/* ── نطاقان لا واحد ────────────────────────────────────────────────
            المعروضُ يخرج فورًا، والسجلُّ كلُّه يُجلب عند الضغط لا قبله — فلا
            يُحمَّل خمسةُ آلافِ صفٍّ لمن فتح الصفحة ولن يصدّر. */}
        <ExportMenu
          fileName={`collections-${kind}s`}
          lang={ar ? 'ar' : 'en'}
          options={[
            { key: 'shown', label: t('المعروض', 'Shown'), sheets: [{ name: W.title, rows: shown, columns: cols }] },
            {
              key: 'all',
              label: t('الكل', 'All'),
              resolve: async () => {
                const d = await api.get<{ parties: CollectionsParty[] }>(
                  `/api/collections-dept/parties?kind=${kind}&limit=500&page=1`,
                );
                let all = d.parties || [];
                // خمسةُ آلافِ صفٍّ لا تُطلب في نداءٍ واحد: الحدُّ خمسُمئة، فتُقرأ
                // صفحةً صفحةً حتى تنتهي.
                let p = 2;
                for (;;) {
                  const more = await api.get<{ parties: CollectionsParty[]; pages: number }>(
                    `/api/collections-dept/parties?kind=${kind}&limit=500&page=${p}`,
                  );
                  all = all.concat(more.parties || []);
                  if (p >= (more.pages || 1)) break;
                  p += 1;
                }
                return [{ name: W.title, rows: all, columns: cols }];
              },
            },
          ]}
        />
        {canEdit && (
          <PrimaryButton onClick={() => setEditing({ name: '', kind })}>
            <Plus className="w-4 h-4" /> {W.newOne}
          </PrimaryButton>
        )}
      </PageHeader>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <Stat label={W.title} value={money(total)} />
        <Stat label={t('كشوف', 'Reports')} value={money(totals.reports)} />
        {!hideMoney && <Stat label={W.totalLabel} value={money(totals.total)} />}
        {!hideMoney && <Stat label={W.settledLabel} value={money(totals.settled)} accent="text-emerald-600" />}
        {!hideMoney && <Stat label={W.dueLabel} value={money(totals.outstanding)} accent={totals.outstanding > 0 ? 'text-red-600' : 'text-slate-900'} />}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex-1 min-w-[220px]">
          <SearchInput
            value={q}
            onChange={setQ}
            placeholder={t('بحث بالاسم أو الجوال أو السجل التجاري أو الرقم الضريبي أو الآيبان…', 'name, phone, CR, tax number, IBAN…')}
          />
        </div>
        <button
          type="button"
          onClick={() => setShowFilters((p) => !p)}
          className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-semibold border transition-colors ${
            activeCount ? 'bg-[#f37121] text-white border-[#f37121]' : 'bg-white border-slate-200 text-slate-600 hover:text-slate-900'}`}
        >
          <SlidersHorizontal className="w-4 h-4" />
          {t('فلاتر', 'Filters')}{activeCount ? ` (${activeCount})` : ''}
        </button>
      </div>

      {showFilters && (
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <Field label={t('حالة التحصيل', 'Collection status')}>
            <ManagedSelect type="collections_status" value={status} onChange={setStatus} storeLabel noAdd placeholder={t('الكل', 'All')} />
          </Field>
          <Field label={t('المدينة', 'City')}>
            <ManagedSelect type="collections_city" value={city} onChange={setCity} storeLabel noAdd placeholder={t('الكل', 'All')} />
          </Field>
          <Field label={t('التصنيف', 'Type')}>
            <ManagedSelect type="collections_party_type" value={partyType} onChange={setPartyType} storeLabel noAdd placeholder={t('الكل', 'All')} />
          </Field>
          <Field label={t('التفعيل', 'Active')}>
            <Select value={active} onChange={(e) => setActive(e.target.value)}>
              <option value="">{t('جميع الحالات', 'All')}</option>
              <option value="true">{t('مفعَّل', 'Active')}</option>
              <option value="false">{t('معطَّل', 'Inactive')}</option>
            </Select>
          </Field>
          <div className="flex items-end gap-2">
            {!hideMoney && (
              <label className="inline-flex items-center gap-2 text-sm text-slate-700 pb-2">
                <input type="checkbox" checked={onlyDue} onChange={(e) => setOnlyDue(e.target.checked)} className="accent-[#f37121]" />
                {t('عليه مستحق فقط', 'Has outstanding only')}
              </label>
            )}
            {activeCount > 0 && (
              <button
                type="button"
                onClick={() => { setStatus(''); setCity(''); setPartyType(''); setActive(''); setOnlyDue(false); }}
                className="pb-2 text-slate-400 hover:text-red-600"
                title={t('إزالة الفلاتر', 'Clear filters')}
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs">
              <tr>
                {[t('الاسم', 'Name'), t('التواصل', 'Contact'), t('المدينة', 'City'), t('الحالة', 'Status'),
                  ...(hideMoney ? [] : [t('كشوف', 'Reports'), W.totalLabel, W.settledLabel, W.dueLabel]),
                  t('آخر كشف', 'Last report'), ''].map((h, i) => (
                  <th key={i} className="px-3 py-2.5 text-start font-semibold whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={hideMoney ? 6 : 10} className="px-4 py-12"><Spinner /></td></tr>
              ) : shown.length === 0 ? (
                <tr><td colSpan={hideMoney ? 6 : 10} className="px-4 py-12 text-center text-slate-400">{t('لا نتائج', 'No results')}</td></tr>
              ) : shown.map((p) => (
                <tr
                  key={p._id}
                  className={`border-b border-slate-100 hover:bg-slate-50 cursor-pointer ${p.isActive === false ? 'opacity-50' : ''}`}
                  onClick={() => router.push(`/system/collections-dept/parties/${p._id}`)}
                >
                  <td className="px-3 py-2.5 font-semibold text-slate-900">
                    {p.name}
                    {p.isActive === false && <span className="ms-1.5 text-[10px] text-slate-400">({t('معطَّل', 'inactive')})</span>}
                    {/* الاسمُ الواحدُ كُتب بصيغتين في الكشوف — يُقال، لأنّ من يبحث
                        عن الصيغة الأخرى يظنّها طرفًا آخر. */}
                    {p.nameVariants && p.nameVariants.length > 1 && (
                      <span className="block text-[10px] text-slate-400" title={p.nameVariants.join(' · ')}>
                        {t(`${p.nameVariants.length} صيغ للاسم مدمجة`, `${p.nameVariants.length} name spellings merged`)}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-slate-600 whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                    {p.phone ? (
                      <a href={`tel:${p.phone}`} className="inline-flex items-center gap-1 hover:text-[#f37121]">
                        <Phone className="w-3.5 h-3.5" />{p.phone}
                      </a>
                    ) : '—'}
                    {p.email ? (
                      <a href={`mailto:${p.email}`} className="ms-2 inline-flex items-center gap-1 hover:text-[#f37121]" title={p.email}>
                        <Mail className="w-3.5 h-3.5" />
                      </a>
                    ) : null}
                    {p.contactPerson ? <span className="text-xs text-slate-400 ms-1">· {p.contactPerson}</span> : null}
                  </td>
                  <td className="px-3 py-2.5 text-slate-600 whitespace-nowrap">{p.city || '—'}</td>
                  <td className="px-3 py-2.5 text-slate-600 whitespace-nowrap">{p.status || '—'}</td>
                  {!hideMoney && (
                    <td className="px-3 py-2.5 tabular-nums">
                      {money(p.reports)}
                      {p.openReports > 0 && <span className="text-[11px] text-red-500 ms-1">({money(p.openReports)})</span>}
                    </td>
                  )}
                  {!hideMoney && <td className="px-3 py-2.5 tabular-nums text-slate-700">{money(p.total)}</td>}
                  {!hideMoney && <td className="px-3 py-2.5 tabular-nums text-emerald-700">{money(p.settled)}</td>}
                  {!hideMoney && <td className={`px-3 py-2.5 tabular-nums font-semibold ${p.outstanding > 0 ? 'text-red-600' : 'text-slate-400'}`}>{money(p.outstanding)}</td>}
                  <td className="px-3 py-2.5 text-slate-500 whitespace-nowrap">{dt(p.lastReportAt)}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center gap-1">
                      {canEdit && (
                        <button type="button" onClick={() => setEditing(p)} className="p-1 text-slate-400 hover:text-[#f37121]" title={t('تعديل', 'Edit')}>
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                      )}
                      {canDelete && (
                        <button type="button" onClick={() => remove(p)} className="p-1 text-slate-400 hover:text-red-600" title={t('حذف', 'Delete')}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                      <ChevronLeft className={`w-4 h-4 text-slate-300 ${isRTL ? '' : 'rotate-180'}`} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {pages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100 text-sm">
            <span className="text-slate-500">
              {t(`صفحة ${page} من ${pages} · ${money(total)} ${W.one}`, `Page ${page} of ${pages} · ${money(total)} ${W.one}s`)}
            </span>
            <div className="flex items-center gap-2">
              <button type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}
                className="px-3 py-1.5 rounded-lg border border-slate-200 disabled:opacity-40">{t('السابق', 'Prev')}</button>
              <button type="button" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}
                className="px-3 py-1.5 rounded-lg border border-slate-200 disabled:opacity-40">{t('التالي', 'Next')}</button>
            </div>
          </div>
        )}
      </div>

      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing?._id ? t('تعديل', 'Edit') : W.newOne}
        footer={<>
          <button type="button" onClick={() => setEditing(null)} className="px-4 py-2 text-slate-500 text-sm">{t('إلغاء', 'Cancel')}</button>
          <PrimaryButton onClick={save} disabled={saving}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}{t('حفظ', 'Save')}
          </PrimaryButton>
        </>}
      >
        {/* ── بطاقاتٌ لا خاناتٌ مسكوبة ────────────────────────────────────────
            ثلاثةٌ وعشرون حقلًا في شبكةٍ واحدةٍ لا يُعرف أين ينتهي التواصلُ
            وتبدأ الهويّةُ التجاريّة. */}
        <div className="space-y-4">
          <Card title={t('الأساس', 'Basics')}>
            <div className="sm:col-span-2">
              <Field label={t('الاسم *', 'Name *')}>
                <TextInput value={editing?.name || ''} onChange={(e) => setEditing((p) => ({ ...p, name: e.target.value }))} />
              </Field>
            </div>
            <Field label={t('التصنيف', 'Type')}>
              <ManagedSelect type="collections_party_type" value={editing?.partyType || ''}
                onChange={(v) => setEditing((p) => ({ ...p, partyType: v }))} storeLabel placeholder={t('— اختر —', '— select —')} />
            </Field>
            <Field label={t('المدينة', 'City')}>
              <ManagedSelect type="collections_city" value={editing?.city || ''}
                onChange={(v) => setEditing((p) => ({ ...p, city: v }))} storeLabel placeholder={t('— اختر —', '— select —')} />
            </Field>
          </Card>

          <Card title={t('التواصل', 'Contact')}>
            <Field label={t('الجوال', 'Phone')}>
              <TextInput value={editing?.phone || ''} onChange={(e) => setEditing((p) => ({ ...p, phone: e.target.value }))} />
            </Field>
            <Field label={t('البريد الإلكتروني', 'Email')}>
              <TextInput type="email" value={editing?.email || ''} onChange={(e) => setEditing((p) => ({ ...p, email: e.target.value }))} />
            </Field>
            <Field label={t('مسؤول التواصل', 'Contact person')}>
              <TextInput value={editing?.contactPerson || ''} onChange={(e) => setEditing((p) => ({ ...p, contactPerson: e.target.value }))} />
            </Field>
            <Field label={t('جوال المسؤول', 'Contact phone')}>
              <TextInput value={editing?.contactPhone || ''} onChange={(e) => setEditing((p) => ({ ...p, contactPhone: e.target.value }))} />
            </Field>
            {/* محاسبُ الطرف مفصولٌ عن مسؤول التواصل: الاتّصالُ بالمالك في شأن
                سندٍ يضيّع يومًا. */}
            <Field label={t('محاسب الطرف', 'Their accountant')}>
              <TextInput value={editing?.accountantName || ''} onChange={(e) => setEditing((p) => ({ ...p, accountantName: e.target.value }))} />
            </Field>
            <Field label={t('جوال المحاسب', 'Accountant phone')}>
              <TextInput value={editing?.accountantPhone || ''} onChange={(e) => setEditing((p) => ({ ...p, accountantPhone: e.target.value }))} />
            </Field>
          </Card>

          <Card title={t('الهوية التجارية', 'Commercial identity')}>
            <Field label={t('السجل التجاري', 'Commercial register')}>
              <TextInput value={editing?.commercialRegister || ''} onChange={(e) => setEditing((p) => ({ ...p, commercialRegister: e.target.value }))} />
            </Field>
            <Field label={t('الرقم الضريبي', 'Tax number')}>
              <TextInput value={editing?.taxNumber || ''} onChange={(e) => setEditing((p) => ({ ...p, taxNumber: e.target.value }))} />
            </Field>
            <Field label={t('الآيبان', 'IBAN')}>
              <TextInput value={editing?.iban || ''} onChange={(e) => setEditing((p) => ({ ...p, iban: e.target.value }))} />
            </Field>
            <Field label={t('البنك', 'Bank')}>
              <TextInput value={editing?.bankName || ''} onChange={(e) => setEditing((p) => ({ ...p, bankName: e.target.value }))} />
            </Field>
            <div className="sm:col-span-2">
              <Field label={t('العنوان', 'Address')}>
                <TextInput value={editing?.address || ''} onChange={(e) => setEditing((p) => ({ ...p, address: e.target.value }))} />
              </Field>
            </div>
          </Card>

          <Card title={t('شروط التحصيل', 'Collection terms')}>
            <Field label={t('شروط السداد', 'Payment terms')}>
              <ManagedSelect type="collections_payment_terms" value={editing?.paymentTerms || ''}
                onChange={(v) => setEditing((p) => ({ ...p, paymentTerms: v }))} storeLabel placeholder={t('— اختر —', '— select —')} />
            </Field>
            <Field label={t('حالة التحصيل', 'Collection status')}>
              <ManagedSelect type="collections_status" value={editing?.status || ''}
                onChange={(v) => setEditing((p) => ({ ...p, status: v }))} storeLabel placeholder={t('— اختر —', '— select —')} />
            </Field>
            <Field label={t('حد الائتمان', 'Credit limit')}>
              <TextInput type="number" value={String(editing?.creditLimit ?? '')}
                onChange={(e) => setEditing((p) => ({ ...p, creditLimit: e.target.value === '' ? 0 : Number(e.target.value) }))} />
            </Field>
            <Field label={t('المتابعة القادمة', 'Next follow-up')}>
              <TextInput type="date" value={(editing?.nextFollowUpAt || '').slice(0, 10)}
                onChange={(e) => setEditing((p) => ({ ...p, nextFollowUpAt: e.target.value }))} />
            </Field>
            <div className="sm:col-span-2">
              <Field label={t('ملاحظات', 'Notes')}>
                <TextInput value={editing?.notes || ''} onChange={(e) => setEditing((p) => ({ ...p, notes: e.target.value }))} />
              </Field>
            </div>
          </Card>
        </div>
      </Modal>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border border-slate-200 rounded-xl p-4">
      <p className="text-[13px] font-bold text-slate-900 mb-3">{title}</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">{children}</div>
    </div>
  );
}
