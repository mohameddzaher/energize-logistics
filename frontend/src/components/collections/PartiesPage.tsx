'use client';
import { EmailList } from '@/components/collections/SendStatementModal';
// Collection parties: one page serves customers and suppliers. The structure is the same (name, contact, amount due, a profile that opens) and only the money direction differs. Two identical pages in two files would mean fixing every fault twice and forgetting one.
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useDialog } from '@/components/system/DialogProvider';
import api from '@/lib/api';
import { useSocket } from '@/hooks/useSocket';
import { useLatestRequest } from '@/hooks/useLatestRequest';
import {
  canEditCollections, receivablesOnly, kindWords, money, dt, paymentTypeLabel,
  type PartyKind, type CollectionsParty,
} from '@/lib/collections';
import {
  Spinner, PageHeader, SearchInput, PrimaryButton, Modal, Field, TextInput, Select, Loader2,
} from '@/components/hr/HRKit';
import ManagedSelect from '@/components/system/ManagedSelect';
import ExportMenu, { type ExportColumn } from '@/components/ls2/ExportMenu';
import ColumnChooser, { useVisibleColumns, type ChooserColumn } from '@/components/system/ColumnChooser';
import { useColumnFilters, ClearColumnFilters } from '@/components/useColumnFilters';
import SearchSelect from '@/components/system/SearchSelect';
import { printTable } from '@/utils/printTable';
import {
  Users, Truck, Plus, Pencil, Trash2, Phone, Mail, ChevronLeft, SlidersHorizontal, X, Printer, CheckCircle2,
} from 'lucide-react';
import ScrollX from '@/components/system/ScrollX';

const PAGE_SIZE = 100;
interface ServerTotals { invoices: number; total: number; settled: number; outstanding: number; openInvoices: number }

export default function CollectionsPartiesPage({ kind }: { kind: PartyKind }) {
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const t = (a: string, e: string) => (ar ? a : e);
  const { notify, confirm } = useDialog();
  const router = useRouter();
  const W = kindWords(kind, ar);

  const canEdit = canEditCollections(user);
  // Delete is treated like edit: edit permission on a section passes every endpoint in it on the server, so a button hidden by a narrower condition hides an allowed action that nothing blocks.
  const canDelete = canEdit;

  // The suppliers register is read without figures for collectors. Name, contact and commercial identity are shared work, but what we pay them is not collections' concern. The page stays open and only the money columns are dropped; hiding them all would block a legitimate search for a supplier's number or record.
  const hideMoney = kind === 'supplier' && receivablesOnly(user);

  // Row selection for export, print and assignment.
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // The collection owner is picked, not typed. It was typed by hand per account, so "Hossam", "hossam" and the Arabic spelling counted as three employees in reports, while the dashboard groups by exact text. The existing names are read and shown as a list, keeping typing for someone entering a new employee.
  const [officers, setOfficers] = useState<string[]>([]);
  useEffect(() => {
    if (kind !== 'customer') return;
    api.get<{ officers: string[] }>('/api/collections-dept/ledger/invoices/filters')
      .then((d) => setOfficers(d.officers || [])).catch(() => {});
  }, [kind]);

  // Bulk assignment of accounts: open one employee's accounts, tick ten, assign them to another. This is the manager's job after reading the scorecard, and used to mean opening and editing each account separately.
  const [assignTo, setAssignTo] = useState('');
  const [assigning, setAssigning] = useState(false);
  const assignSelected = async () => {
    if (!selected.size) return;
    setAssigning(true);
    try {
      const r = await api.put<{ updated: number }>('/api/collections-dept/ledger/team/assign', {
        parties: [...selected], officer: assignTo,
      });
      // Empty clears the assignment, so the account returns to the department manager, not to nobody.
      notify(t(`أُسند ${r.updated} حسابًا إلى ${assignTo || 'مدير القسم'}`,
        `${r.updated} accounts assigned to ${assignTo || 'the dept. manager'}`));
      setSelected(new Set());
      setAssignTo('');
      load();
    } catch (e: any) { notify(e?.message || t('تعذّر الإسناد', 'Could not assign'), 'error'); }
    setAssigning(false);
  };

  const [rows, setRows] = useState<CollectionsParty[]>([]);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Partial<CollectionsParty> | null>(null);
  const [saving, setSaving] = useState(false);

  // Filters sit behind a button: eleven open filters crowd the table users came for. Search stays visible because it is used every time.
  const [showFilters, setShowFilters] = useState(false);
  const [status, setStatus] = useState('');
  const [city, setCity] = useState('');
  const [partyType, setPartyType] = useState('');
  const [active, setActive] = useState('');
  const [onlyDue, setOnlyDue] = useState(false);
  // Customer totals come from the server over everything matching all filters, not the sum of the displayed page.
  const [serverTotals, setServerTotals] = useState<ServerTotals | null>(null);

  // A number on a board must open its rows. The team scorecard shows accounts count and "(no owner)" count with no way into them. The destination is read from the URL (?assignedTo=<id|none>), so the page opens on exactly those accounts, not the whole register.
  const searchParams = useSearchParams();
  // Owner name as the scorecard knows it, or none for accounts with no owner.
  const [assignedTo, setAssignedTo] = useState(searchParams?.get('officer') || '');
  const [assignedLabel, setAssignedLabel] = useState(searchParams?.get('officer') || '');
  // Limits the list to holders of account codes, matching what the scorecard counts.
  const [hasCode, setHasCode] = useState(searchParams?.get('hasCode') === 'true');
  const activeCount = [status, city, partyType, active, assignedTo].filter(Boolean).length + (onlyDue ? 1 : 0);

  // Responses can arrive out of order: a quick search may answer before an earlier one, so a stale character's result would show over what the user typed.
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
      if (assignedTo) p.set('officer', assignedTo);
      if (hasCode) p.set('hasCode', 'true');
      // "Has amount due" is a condition over the whole list, so it applies on the server, not to the hundred loaded rows.
      if (onlyDue && kind === 'customer') p.set('owing', 'true');
      const d = await api.get<{ parties: CollectionsParty[]; total: number; pages: number; totals?: ServerTotals | null }>(
        `/api/collections-dept/parties?${p.toString()}`,
      );
      if (!isCurrent(token)) return;
      setRows(d.parties || []);
      setServerTotals(d.totals || null);
      setTotal(d.total || 0);
      setPages(d.pages || 1);
    } catch (e: any) {
      if (isCurrent(token)) notify(e?.message || t('تعذّر التحميل', 'Could not load'), 'error');
    } finally {
      if (isCurrent(token)) setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, page, q, status, city, partyType, active, assignedTo, hasCode, onlyDue]);

  // Search is debounced: a server call per character is wasteful on a constrained cluster.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; load(); return; }
    const id = setTimeout(load, 300);
    return () => clearTimeout(id);
  }, [load]);
  // A customer card edited in any section reloads the list (debounced).
  const custTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useSocket('customers:changed', useCallback(() => {
    if (custTimer.current) clearTimeout(custTimer.current);
    custTimer.current = setTimeout(() => { load(); }, 800);
  }, [load]));
  useEffect(() => () => { if (custTimer.current) clearTimeout(custTimer.current); }, []);

  // A filter change returns to page one: staying on page seven after a filter that returns two rows leaves the screen empty for no visible reason.
  useEffect(() => { setPage(1); }, [q, status, city, partyType, active, onlyDue]);

  // Column filters are applied last, after search, the has-amount-due chip and everything else, as Excel does. base is what the funnel reads to build its list, so the other values stay visible after one is picked.
  const cf = useColumnFilters<CollectionsParty>();
  const base = useMemo(() => (onlyDue && kind !== 'customer' ? rows.filter((r) => (r.outstanding || 0) > 0) : rows), [rows, onlyDue, kind]);

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

  // Single source of columns. Screen, export and print read from here, so what is seen is what leaves.
  type Col = ExportColumn & { align?: 'start' | 'end'; cell?: (r: any) => React.ReactNode };

  const nameCell = (p: any) => (
    <span className="font-semibold text-slate-900">
      {p.name}
      {p.isActive === false && <span className="ms-1.5 text-[10px] text-slate-400">({t('معطَّل', 'inactive')})</span>}
      {/* One name was written in two forms in the statements; stated, because someone searching for the other form would take it for a different party. */}
      {p.nameVariants && p.nameVariants.length > 1 && (
        <span className="block text-[10px] text-slate-400 font-normal" title={p.nameVariants.join(' · ')}>
          {t(`${p.nameVariants.length} صيغ للاسم مدمجة`, `${p.nameVariants.length} name spellings merged`)}
        </span>
      )}
    </span>
  );

  const contactCell = (p: any) => (
    <span className="text-slate-600" onClick={(e) => e.stopPropagation()}>
      {p.phone ? (
        <a href={`tel:${p.phone}`} className="inline-flex items-center gap-1 hover:text-[#f37121]">
          <Phone className="w-3.5 h-3.5" />{p.phone}
        </a>
      ) : '—'}
      {p.email ? (
        <a href={`mailto:${(p.emails && p.emails.length ? p.emails : [p.email]).join(',')}`} className="ms-2 inline-flex items-center gap-1 hover:text-[#f37121]" title={p.email}>
          <Mail className="w-3.5 h-3.5" />
        </a>
      ) : null}
      {p.contactPerson ? <span className="text-xs text-slate-400 ms-1">· {p.contactPerson}</span> : null}
    </span>
  );

  const allCols: Col[] = [
    // Order: what is worked with first, and what most companies leave empty last. Commercial register, tax number, IBAN and payment terms are empty for most customers, so they do not come ahead of what is searched for.
    { header: t('الاسم', 'Name'), key: 'name', width: 32, cell: nameCell },
    // Code next to the name: it is what is copied from the paper and searched. A customer record may have no code, so it is read from the ledger invoices (codeShown on the server).
    { header: t('الكود', 'Code'), key: 'code', width: 16,
      transform: (v: any, r: any) => r.codeShown || v || '',
      cell: (p: any) => ((p.codeShown || p.code)
        ? <span className="font-mono text-[12.5px] text-slate-700" dir="ltr">{p.codeShown || p.code}</span>
        : <span className="text-slate-300">—</span>) },
    ...(kind === 'customer' ? [{
      header: t('نوع الدفع', 'Payment type'), key: 'paymentType', width: 14,
      transform: (v: any) => paymentTypeLabel(v, ar),
      // Account type: which ledger it sits in, not a rule on its shipments.
      cell: (p: any) => (p.paymentType ? (
        <span className={`px-2 py-0.5 rounded text-[11px] font-medium ${
          p.paymentType === 'cash' ? 'bg-emerald-50 text-emerald-700' : 'bg-sky-50 text-sky-700'}`}>
          {paymentTypeLabel(p.paymentType, ar)}
        </span>
      ) : <span className="text-slate-400">—</span>),
    } as Col] : []),
    { header: t('موظف التحصيل', 'Officer'), key: 'effectiveOfficer', width: 16 },
    { header: t('الحالة', 'Status'), key: 'status', width: 14 },
    { header: t('التقييم', 'Grade'), key: 'grade', width: 10 },
    { header: t('مهلة السداد', 'Credit days'), key: 'creditDays', width: 12, align: 'end' },
    // The file does not export what is not shown on screen.
    ...(hideMoney ? [] : ([
      { header: t('أوامر نقل', 'Reports'), key: 'reports', width: 10, align: 'end',
        cell: (p: any) => (
          <span className="tabular-nums">
            {money(p.reports)}
            {kind !== 'customer' && p.openReports > 0 && <span className="text-[11px] text-red-500 ms-1">({money(p.openReports)})</span>}
          </span>
        ) },
      { header: W.totalLabel, key: 'total', width: 16, align: 'end',
        cell: (p: any) => <span className="tabular-nums text-slate-700">{money(p.total)}</span> },
      { header: W.settledLabel, key: 'settled', width: 16, align: 'end',
        cell: (p: any) => <span className="tabular-nums text-emerald-700">{money(p.settled)}</span> },
      { header: W.dueLabel, key: 'outstanding', width: 16, align: 'end',
        cell: (p: any) => <span className={`tabular-nums font-semibold ${p.outstanding > 0 ? 'text-red-600' : 'text-slate-400'}`}>{money(p.outstanding)}</span> },
    ] as Col[])),
    { header: t('آخر أمر نقل', 'Last report'), key: 'lastReportAt', width: 14, transform: (v: any) => dt(v) },
    { header: t('التواصل', 'Contact'), key: 'phone', width: 22, cell: contactCell },
    { header: t('مسؤول التواصل', 'Contact person'), key: 'contactPerson', width: 20 },
    { header: t('المدينة', 'City'), key: 'city', width: 14 },
    { header: t('السجل التجاري', 'CR'), key: 'commercialRegister', width: 16 },
    { header: t('الرقم الضريبي', 'Tax no.'), key: 'taxNumber', width: 18 },
    ...(kind === 'supplier' ? [{ header: t('الآيبان', 'IBAN'), key: 'iban', width: 28 } as Col] : []),
    { header: t('شروط السداد', 'Payment terms'), key: 'paymentTerms', width: 14 },
  ];

  const getters = Object.fromEntries(allCols.map((c) => [c.key,
    (r: any) => (c.transform ? c.transform(r[c.key], r) : r[c.key])]));
  const shown = cf.apply(base, getters);

  // Totals follow what remains on screen after the funnel: a total over rows not visible would be read as the total of what is shown, and it is not.
  const totals = useMemo(() => shown.reduce((a, r) => ({
    reports: a.reports + (r.reports || 0),
    total: a.total + (r.total || 0),
    settled: a.settled + (r.settled || 0),
    outstanding: a.outstanding + (r.outstanding || 0),
  }), { reports: 0, total: 0, settled: 0, outstanding: 0 }), [shown]);

  const sums = serverTotals && !cf.count ? { reports: totals.reports, ...serverTotals } : totals;

  // Name and code are fixed: the code is what is searched, and an old saved selection used to hide it.
  const ALWAYS = ['name', 'code'];
  const chooserCols: ChooserColumn[] = allCols.map((c) => ({ key: c.key, label: c.header, locked: ALWAYS.includes(c.key) }));
  const { visible, setVisible } = useVisibleColumns(`collections:parties:${kind}:cols`, chooserCols);
  const visibleCols = allCols.filter((c) => ALWAYS.includes(c.key) || visible.includes(c.key));

  // Export and print follow the screen: selected columns, and selected rows if any.
  const selectedRows = shown.filter((r) => selected.has(r._id));
  const printNow = () => {
    const rowsToPrint = selected.size ? selectedRows : shown;
    const ok = printTable({
      title: W.title,
      columns: visibleCols.map((c) => ({ header: c.header, key: c.key, transform: c.transform, align: c.align })),
      rows: rowsToPrint as any,
      ar,
      meta: [
        `${t('عدد الصفوف', 'Rows')}: ${rowsToPrint.length}`,
        selected.size ? t('المحدَّد فقط', 'Selected only') : t('نتيجة الفلتر', 'Filtered result'),
      ],
    });
    if (!ok) notify(t('المتصفّح منع فتح نافذة الطباعة — اسمح بالنوافذ المنبثقة.', 'The browser blocked the print window — allow pop-ups.'), 'error');
  };

  // Export takes the selected columns; see allCols and ColumnChooser.
  const cols: ExportColumn[] = visibleCols;

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
        {/* Two scopes: shown exports immediately, and the whole register is fetched on click, not before, so five thousand rows are not loaded for someone who will not export. */}
        <ClearColumnFilters count={cf.count} onClear={cf.clear} ar={ar} />
        <ColumnChooser columns={chooserCols} visible={visible} onChange={setVisible} ar={ar} />
        <button type="button" onClick={printNow}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white border border-slate-200 text-slate-600 hover:text-slate-900 text-sm font-semibold"
          title={t('طباعة أو حفظ PDF — بالأعمدة المختارة', 'Print or save as PDF — chosen columns')}>
          <Printer className="w-4 h-4" />{t('طباعة PDF', 'Print PDF')}
        </button>
        <ExportMenu
          fileName={`collections-${kind}s`}
          lang={ar ? 'ar' : 'en'}
          options={[
            ...(selected.size ? [{
              key: 'selected',
              label: t(`المحدَّد (${selected.size})`, `Selected (${selected.size})`),
              sheets: [{ name: W.title, rows: selectedRows, columns: cols }],
            }] : []),
            { key: 'shown', label: t('المعروض', 'Shown'), sheets: [{ name: W.title, rows: shown, columns: cols }] },
            {
              key: 'all',
              label: t('الكل', 'All'),
              resolve: async () => {
                const d = await api.get<{ parties: CollectionsParty[] }>(
                  `/api/collections-dept/parties?kind=${kind}&limit=500&page=1`,
                );
                let all = d.parties || [];
                // Five thousand rows are not requested in one call: the limit is 500, so they are read page by page until done.
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
        <Stat label={t('أوامر نقل', 'Reports')} value={money(totals.reports)} />
        {!hideMoney && <Stat label={W.totalLabel} value={money(sums.total)} />}
        {!hideMoney && <Stat label={W.settledLabel} value={money(sums.settled)} accent="text-emerald-600" />}
        {!hideMoney && <Stat label={W.dueLabel} value={money(sums.outstanding)} accent={sums.outstanding > 0 ? 'text-red-600' : 'text-slate-900'} />}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex-1 min-w-[220px]">
          <SearchInput
            value={q}
            onChange={setQ}
            placeholder={t('بحث بالاسم أو الكود أو الجوال أو السجل التجاري أو الرقم الضريبي…', 'name, code, phone, CR, tax number…')}
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

      {/* A truncated list is never shown without saying so: someone arriving from the team scorecard sees one employee's accounts, and without a notice would think it is the whole register. */}
      {assignedTo && (
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#f37121]/10 text-[#f37121] text-sm font-semibold">
            {assignedTo === 'none'
              ? t('حسابات مدير القسم (غير مُسنَدة)', 'Dept. manager (unassigned accounts)')
              : t(`حسابات ${assignedLabel || 'موظّف'}`, `${assignedLabel || 'officer'}'s accounts`)}
            <button type="button" onClick={() => { setAssignedTo(''); setAssignedLabel(''); setHasCode(false); setPage(1); }}
              title={t('عرض كل الحسابات', 'Show all accounts')}>
              <X className="w-3.5 h-3.5" />
            </button>
          </span>
        </div>
      )}

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

      {/* What is selected and what is done with it: read the scorecard and act on the same screen (open an employee's accounts, tick ten, assign to another) instead of opening each account separately. */}
      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 bg-white border border-[#f37121]/30 rounded-xl p-3 shadow-sm">
          <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#f37121]/10 text-[#f37121] text-sm font-semibold">
            {t(`محدَّد: ${selected.size}`, `${selected.size} selected`)}
            <button type="button" onClick={() => setSelected(new Set())} title={t('إلغاء التحديد', 'Clear selection')}>
              <X className="w-3.5 h-3.5" />
            </button>
          </span>
          {canEdit && kind === 'customer' && (
            <>
              <span className="text-sm text-slate-500">{t('إسناد إلى', 'Assign to')}</span>
              <div className="w-56">
                <SearchSelect ar={ar} value={assignTo} onChange={setAssignTo}
                  allLabel={t('مدير القسم (غير مُسنَد)', 'Dept. manager (unassigned)')}
                  options={officers.map((o) => ({ value: o, label: o }))} />
              </div>
              <PrimaryButton onClick={assignSelected} disabled={assigning}>
                {assigning ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                {t('إسناد', 'Assign')}
              </PrimaryButton>
            </>
          )}
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
        <ScrollX>
          <table className="w-full text-sm">
            <thead className="table-head">
              <tr>
                {/* Select a whole page with one click. */}
                <th className="px-3 py-2.5 w-10">
                  <input type="checkbox" className="accent-[#f37121]"
                    checked={shown.length > 0 && shown.every((r) => selected.has(r._id))}
                    onChange={(e) => setSelected(e.target.checked ? new Set(shown.map((r) => r._id)) : new Set())} />
                </th>
                {visibleCols.map((c) => (
                  <th key={c.key} className="px-3 py-2.5 text-start font-semibold whitespace-nowrap">
                    <span className="inline-flex items-center gap-1">
                      {c.header}
                      {cf.header(c.key, base, getters[c.key], ar)}
                    </span>
                  </th>
                ))}
                <th className="px-3 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={visibleCols.length + 2} className="px-4 py-12"><Spinner /></td></tr>
              ) : shown.length === 0 ? (
                <tr><td colSpan={visibleCols.length + 2} className="px-4 py-12 text-center text-slate-400">{t('لا نتائج', 'No results')}</td></tr>
              ) : shown.map((p) => (
                <tr
                  key={p._id}
                  className={`border-b border-slate-100 hover:bg-slate-50 cursor-pointer ${p.isActive === false ? 'opacity-50' : ''} ${selected.has(p._id) ? 'bg-[#f37121]/5' : ''}`}
                  onClick={() => router.push(`/system/collections-dept/parties/${p._id}`)}
                >
                  <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" className="accent-[#f37121]" checked={selected.has(p._id)}
                      onChange={() => setSelected((prev) => {
                        const next = new Set(prev);
                        if (next.has(p._id)) next.delete(p._id); else next.add(p._id);
                        return next;
                      })} />
                  </td>
                  {visibleCols.map((c) => (
                    // The name gets a width readable in one or two lines, not a narrow column that wraps into many.
                    <td key={c.key} className={`px-3 py-2.5 ${c.align === 'end' ? 'text-end' : ''} ${c.key === 'name' ? 'min-w-[260px] max-w-[360px] leading-snug' : 'whitespace-nowrap'}`}>
                      {c.cell ? c.cell(p) : (
                        <span className="text-slate-600">
                          {(c.transform ? c.transform((p as any)[c.key], p) : (p as any)[c.key]) || '—'}
                        </span>
                      )}
                    </td>
                  ))}
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
        </ScrollX>

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
        {/* Cards, not a spilled grid: twenty-three fields in one grid make it unclear where contact ends and commercial identity begins. */}
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
            {/* Account type, not shipment type. It says which ledger the account sits in and generates its code: cash C#### and tax 1104####. It does not decide how a specific transport order is paid; that is written on the transport order in the operations workflow, since one customer pays cash on one load and tax on another. */}
            {kind === 'customer' && (
              <Field label={t('نوع الحساب', 'Account type')}>
                <Select value={editing?.paymentType || ''}
                  onChange={(e) => setEditing((p) => ({ ...p, paymentType: e.target.value as any }))}>
                  <option value="">{t('— غير محدَّد —', '— not set —')}</option>
                  <option value="cash">{t('كاش', 'Cash')}</option>
                  <option value="tax">{t('ضريبي', 'Tax')}</option>
                </Select>
              </Field>
            )}
            <Field label={t('المدينة', 'City')}>
              <ManagedSelect type="collections_city" value={editing?.city || ''}
                onChange={(v) => setEditing((p) => ({ ...p, city: v }))} storeLabel placeholder={t('— اختر —', '— select —')} />
            </Field>
            {/* The code is generated if left empty. Each account has an accounting code: cash C#### and tax 1104####. Left empty it takes the next number in its type's series; it is entered by hand during import or correction. */}
            {kind === 'customer' && (
              <Field label={t('الكود', 'Code')}>
                <TextInput value={editing?.code || ''} onChange={(e) => setEditing((p) => ({ ...p, code: e.target.value }))}
                  placeholder={editing?._id ? '' : t('يُولَّد تلقائيًّا', 'generated automatically')} />
              </Field>
            )}
          </Card>

          {kind === 'customer' && (
            <Card title={t('دفتر التحصيل', 'Collections ledger')}>
              <Field label={t('موظف التحصيل', 'Collection officer')}>
                <SearchSelect ar={ar} value={editing?.collectionOfficer || ''}
                  onChange={(v) => setEditing((p) => ({ ...p, collectionOfficer: v }))}
                  allLabel={t('مدير القسم (غير مُسنَد)', 'Dept. manager (unassigned)')}
                  options={officers.map((o) => ({ value: o, label: o }))} />
              </Field>
              <Field label={t('التقييم', 'Grade')}>
                <TextInput value={editing?.grade || ''} onChange={(e) => setEditing((p) => ({ ...p, grade: e.target.value }))} placeholder="A1 · B2 · C3" />
              </Field>
              <Field label={t('القسم', 'Department')}>
                <TextInput value={editing?.department || ''} onChange={(e) => setEditing((p) => ({ ...p, department: e.target.value }))} placeholder="Branches · Fleet · Customs Clearance" />
              </Field>
              <Field label={t('فرع العميل', 'Location')}>
                <TextInput value={editing?.hoLocation || ''} onChange={(e) => setEditing((p) => ({ ...p, hoLocation: e.target.value }))} />
              </Field>
              {/* The term counts from delivery, not the invoice date: the thirty-day term does not start before the paper reaches the customer. The difference is between late and not yet received, so it is stated in the field label, not a document. */}
              <Field label={t('مهلة السداد — من يوم تسليم الفاتورة للعميل', 'Credit days — from customer delivery')}>
                <TextInput type="number" value={editing?.creditDays ?? ''} onChange={(e) => setEditing((p) => ({ ...p, creditDays: e.target.value === '' ? undefined : Number(e.target.value) }))} />
              </Field>
              {/* Raising the limit from here: the alert says near its limit and the decision is either to chase or to raise the cap, so both are at hand. */}
              <Field label={t('حد الائتمان', 'Credit limit')}>
                <TextInput type="number" value={editing?.creditLimit ?? ''} onChange={(e) => setEditing((p) => ({ ...p, creditLimit: e.target.value === '' ? undefined : Number(e.target.value) }))} />
              </Field>
              <div className="sm:col-span-2">
                <Field label={t('مندوبو المبيعات (يفصل بينهم /)', 'Sales managers (separate with /)')}>
                  <TextInput value={(editing?.salesManagers || []).join(' / ')}
                    onChange={(e) => setEditing((p) => ({ ...p, salesManagers: e.target.value.split('/').map((x) => x.trim()).filter(Boolean) }))} />
                </Field>
              </div>
            </Card>
          )}

          <Card title={t('التواصل', 'Contact')}>
            <Field label={t('الجوال', 'Phone')}>
              <TextInput value={editing?.phone || ''} onChange={(e) => setEditing((p) => ({ ...p, phone: e.target.value }))} />
            </Field>
            {/* More than one email; the account statement is sent to all of them. */}
            <div className="sm:col-span-2">
              <EmailList ar={ar} label={t('البريد الإلكتروني (يمكن أكثر من بريد)', 'Emails (more than one allowed)')}
                value={editing?.emails && editing.emails.length ? editing.emails : (editing?.email ? [editing.email] : [])}
                onChange={(v) => setEditing((p) => ({ ...p, emails: v, email: v[0] || '' }))} />
            </div>
            <Field label={t('مسؤول التواصل', 'Contact person')}>
              <TextInput value={editing?.contactPerson || ''} onChange={(e) => setEditing((p) => ({ ...p, contactPerson: e.target.value }))} />
            </Field>
            <Field label={t('جوال المسؤول', 'Contact phone')}>
              <TextInput value={editing?.contactPhone || ''} onChange={(e) => setEditing((p) => ({ ...p, contactPhone: e.target.value }))} />
            </Field>
            {/* The party's accountant is separate from the contact owner: calling the owner about a voucher wastes a day. */}
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
