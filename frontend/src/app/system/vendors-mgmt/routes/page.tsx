'use client';
/**
 * Approved routes and purchase prices. Each route (from → to, optionally a truck type) has an approved purchase
 * range (from–to price); every shipment request on that route shows the range live to the operations team
 * (utils/approvedRanges). The from/to places come from the section settings (the shipment form's lists); places on
 * those lists with no approved route are flagged. Below, an optional search shows who carried a route and at what price.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useDialog } from '@/components/system/DialogProvider';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import { PageHeader, Modal, Field, TextInput, SearchInput, Spinner, SearchableSelect, PrimaryButton } from '@/components/hr/HRKit';
import ExportMenu from '@/components/ls2/ExportMenu';
import { Kpi, Panel, DataGrid, fmtInt, fmtMoney, fmtDay } from '@/components/analytics/AnalyticsKit';
import { KIND, kindLabel, contractTone, vendorHref, isVendorLead } from '@/lib/vendors';
import { Route as RouteIcon, Search, Plus, Pencil, Trash2, Repeat, Home, AlertTriangle, ArrowLeft, ArrowRight, ChevronDown } from 'lucide-react';

type Row = Record<string, any>;
type Places = { from: string[]; to: string[] };

export default function VendorRoutesPage() {
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const t = (a: string, e: string) => (ar ? a : e);
  const { notify, confirm } = useDialog();
  const lead = isVendorLead(user);
  const Arrow = isRTL ? ArrowLeft : ArrowRight;

  // Approved list
  const [prices, setPrices] = useState<Row[] | null>(null);
  const [places, setPlaces] = useState<Places>({ from: [], to: [] });
  const [uncovered, setUncovered] = useState<Places>({ from: [], to: [] });
  const [customers, setCustomers] = useState<{ _id: string; name: string; code?: string }[]>([]);
  const [pq, setPq] = useState('');
  const [edit, setEdit] = useState<Row | null>(null);
  const [saving, setSaving] = useState(false);
  const loadPrices = useCallback(() => {
    api.get<{ prices: Row[]; places?: Places; uncovered?: Places; customers?: { _id: string; name: string; code?: string }[] }>('/api/vendors-mgmt/prices')
      .then((r) => { setPrices(r.prices || []); setPlaces(r.places || { from: [], to: [] }); setUncovered(r.uncovered || { from: [], to: [] }); setCustomers(r.customers || []); })
      .catch(() => setPrices([]));
  }, []);
  useEffect(() => { loadPrices(); }, [loadPrices]);
  useSocket('vendors:changed', loadPrices);
  // A place added to or removed from the section settings shows here at once (picker and coverage warning).
  useSocket('shipmentOrders:fields', loadPrices);
  // A range set from the requests board (operations manager) shows here at once.
  useSocket('shipmentRequests:changed', useCallback((d: { prices?: boolean }) => { if (d?.prices) loadPrices(); }, [loadPrices]));

  // Route search (who carried it): only when asked, never from a click on the list.
  const [showSearch, setShowSearch] = useState(false);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [res, setRes] = useState<Row | null>(null);
  const [busy, setBusy] = useState(false);
  const search = useCallback(async (f = from, tt = to) => {
    if (!f.trim() && !tt.trim()) return;
    setBusy(true);
    try { setRes(await api.get(`/api/vendors-mgmt/route-search?from=${encodeURIComponent(f.trim())}&to=${encodeURIComponent(tt.trim())}`)); }
    catch (e: any) { notify(e?.message || t('تعذّر البحث', 'Search failed'), 'error'); }
    setBusy(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to]);
  const resRef = useRef(res); resRef.current = res;
  const searchRef = useRef(search); searchRef.current = search;
  const timer = useRef<any>(null);
  useSocket('shipmentOrders:updated', useCallback(() => { if (!resRef.current) return; clearTimeout(timer.current); timer.current = setTimeout(() => searchRef.current(), 1200); }, []));
  const searchRoute = (p: Row) => { setShowSearch(true); setFrom(p.fromCity); setTo(p.toCity); search(p.fromCity, p.toCity); setTimeout(() => document.getElementById('route-search')?.scrollIntoView({ behavior: 'smooth' }), 50); };

  const savePrice = async () => {
    if (!edit) return;
    setSaving(true);
    try {
      const body = { fromCity: edit.fromCity, toCity: edit.toCity, truckType: edit.truckType || '', customer: edit.customer || null, minPrice: edit.minPrice, maxPrice: edit.maxPrice, notes: edit.notes || '' };
      if (edit._id) await api.put(`/api/vendors-mgmt/prices/${edit._id}`, body); else await api.post('/api/vendors-mgmt/prices', body);
      notify(t('حُفظ السعر — ويظهر فورًا على طلبات هذا المسار', 'Saved — shows on this route’s requests at once'), 'success'); setEdit(null); loadPrices();
    } catch (e: any) { notify(e?.message || t('تعذّر الحفظ', 'Could not save'), 'error'); }
    setSaving(false);
  };
  const delPrice = async (p: Row) => {
    if (!(await confirm({ title: t('حذف السعر المعتمد', 'Delete approved price'), message: `${p.fromCity} ← ${p.toCity}`, tone: 'danger' }))) return;
    try { await api.delete(`/api/vendors-mgmt/prices/${p._id}`); loadPrices(); } catch (e: any) { notify(e?.message || t('تعذّر الحذف', 'Could not delete'), 'error'); }
  };
  const openNew = (seed: Partial<Row> = {}) => setEdit({ fromCity: '', toCity: '', truckType: '', customer: '', minPrice: '', maxPrice: '', notes: '', ...seed });

  const shownPrices = (prices || []).filter((p) => !pq || `${p.fromCity} ${p.toCity} ${p.truckType || ''} ${p.customerName || ''}`.includes(pq));
  const range = (p: Row) => (p.min != null || p.max != null
    ? <span className="tabular-nums font-bold text-slate-900">{fmtMoney(p.min)} <span className="text-slate-400 font-normal">–</span> {fmtMoney(p.max)}</span>
    : <span className="text-[12px] text-amber-700">{t('بلا سعر', 'No price')}</span>);
  const opt = (list: string[], cur: string) => [...new Set([...(cur ? [cur] : []), ...list])].map((v) => ({ value: v, label: v }));
  const gaps = uncovered.from.length + uncovered.to.length;
  const editRangeBad = edit && Number(edit.minPrice) > 0 && Number(edit.maxPrice) > 0 && Number(edit.minPrice) > Number(edit.maxPrice);

  return (
    <div className="space-y-4 pb-10" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader icon={<RouteIcon className="w-6 h-6 text-[#f37121]" />} title={t('المسارات والأسعار المعتمدة', 'Approved routes & prices')}
        subtitle={t('سعر الشراء المعتمد لكلّ مسار (من – إلى)، ويظهر تلقائيًّا لفريق العمليات على كلّ طلب شحنٍ بنفس المسار', 'The approved purchase range per route, shown live to operations on every request on that route')}>
        {lead && <PrimaryButton onClick={() => openNew()}><Plus className="w-4 h-4" />{t('مسارٌ جديد', 'New route')}</PrimaryButton>}
      </PageHeader>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Kpi ar={ar} label={t('مساراتٌ معتمدة', 'Approved routes')} value={fmtInt((prices || []).filter((p) => p.isActive !== false).length)} />
        <Kpi ar={ar} label={t('أماكن التحميل في الإعدادات', 'Loading places in settings')} value={fmtInt(places.from.length)} />
        <Kpi ar={ar} label={t('الوجهات في الإعدادات', 'Destinations in settings')} value={fmtInt(places.to.length)} />
        <Kpi ar={ar} label={t('أماكن بلا سعرٍ معتمد', 'Places without a price')} value={fmtInt(gaps)} tone={gaps ? 'warn' : 'good'} />
      </div>

      {/* Places on the section settings lists that no approved route covers yet. */}
      {gaps > 0 && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <p className="flex items-center gap-2 text-[13.5px] font-bold text-amber-900"><AlertTriangle className="w-4 h-4" />{t('أماكن في إعدادات القسم ليس لها سعر شراءٍ معتمد بعد', 'Places in the section settings with no approved purchase price yet')}</p>
          {(['from', 'to'] as const).map((k) => uncovered[k].length > 0 && (
            <div key={k} className="mt-2.5">
              <p className="mb-1.5 text-[12px] font-semibold text-amber-800">{k === 'from' ? t('أماكن تحميل (من):', 'Loading places (from):') : t('وجهات (إلى):', 'Destinations (to):')}</p>
              <div className="flex flex-wrap gap-1.5">
                {uncovered[k].map((c) => (
                  <button key={c} type="button" disabled={!lead} onClick={() => openNew(k === 'from' ? { fromCity: c } : { toCity: c })}
                    className="inline-flex items-center gap-1 rounded-lg border border-amber-300 bg-white px-2.5 py-1 text-[12.5px] font-semibold text-amber-900 hover:border-[#f37121] disabled:cursor-default">
                    {lead && <Plus className="w-3 h-3" />}{c}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <Panel title={t('قائمة الأسعار المعتمدة', 'Approved price list')} subtitle={t('سعر شراء الرحلة الواحدة من – إلى · نوع الشاحنة اختياري (بدونه يسري على كلّ الأنواع)', 'Purchase price per trip, from–to · truck type optional')}
        actions={<>
          <div className="w-52"><SearchInput value={pq} onChange={setPq} placeholder={t('بحث بالمسار…', 'Search…')} /></div>
          <ExportMenu fileName="approved-prices" lang={ar ? 'ar' : 'en'} options={[{ key: 'all', label: t('القائمة', 'List'), sheets: [{ name: t('الأسعار المعتمدة', 'Approved prices'), rows: shownPrices, columns: [{ header: t('من', 'From'), key: 'fromCity' }, { header: t('إلى', 'To'), key: 'toCity' }, { header: t('العميل', 'Customer'), key: 'customerName' }, { header: t('نوع الشاحنة', 'Truck'), key: 'truckType' }, { header: t('سعر الشراء من', 'Buy from'), key: 'min', type: 'number' as const }, { header: t('سعر الشراء إلى', 'Buy to'), key: 'max', type: 'number' as const }, { header: t('ملاحظات', 'Notes'), key: 'notes' }] }] }]} />
        </>} pad={false}>
        {prices == null ? <Spinner /> : (
          <DataGrid ar={ar} rows={shownPrices} limit={60} rowKey={(r) => r._id} empty={t('لا مسارات معتمدة بعد', 'No approved routes yet')} cols={[
            { key: 'fromCity', label: t('المسار', 'Route'), render: (r) => <span className="inline-flex items-center gap-1.5 font-semibold text-slate-900">{r.fromCity}<Arrow className="w-3.5 h-3.5 text-[#f37121]" />{r.toCity}</span> },
            { key: 'customerName', label: t('العميل', 'Customer'), render: (r) => (r.customer ? <span className="font-semibold text-slate-800">{r.customerName}</span> : <span className="text-slate-400">{t('كلّ العملاء', 'All customers')}</span>) },
            { key: 'truckType', label: t('نوع الشاحنة', 'Truck'), render: (r) => r.truckType || <span className="text-slate-400">{t('كلّ الأنواع', 'Any')}</span> },
            { key: 'min', label: t('سعر الشراء (من – إلى)', 'Purchase (from – to)'), num: true, render: range },
            { key: 'notes', label: t('ملاحظات', 'Notes'), render: (r) => <span className="text-[12px] text-slate-600">{r.notes || ''}</span> },
            { key: 'updatedByName', label: t('آخر تعديل', 'Updated'), render: (r) => <span className="text-[11.5px] text-slate-500">{r.updatedByName} · {fmtDay(r.updatedAt)}</span> },
            { key: 'act', label: '', render: (r: Row) => (
              <span className="inline-flex gap-1">
                <button type="button" title={t('من نفّذ هذا المسار؟', 'Who carried this route?')} onClick={() => searchRoute(r)} className="p-1.5 rounded text-slate-500 hover:text-[#f37121]"><Search className="w-3.5 h-3.5" /></button>
                {lead && <button type="button" title={t('تعديل', 'Edit')} onClick={() => setEdit({ ...r, minPrice: r.min ?? '', maxPrice: r.max ?? '' })} className="p-1.5 rounded text-slate-500 hover:text-[#f37121]"><Pencil className="w-3.5 h-3.5" /></button>}
                {lead && <button type="button" title={t('حذف', 'Delete')} onClick={() => delPrice(r)} className="p-1.5 rounded text-slate-500 hover:text-red-600"><Trash2 className="w-3.5 h-3.5" /></button>}
              </span>
            ) },
          ]} />
        )}
      </Panel>

      {/* Who carried a route: opened on demand. */}
      <section id="route-search" className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <button type="button" onClick={() => setShowSearch((v) => !v)} className="flex w-full items-center justify-between gap-2 px-4 py-3 text-start">
          <span className="flex items-center gap-2 text-[14px] font-bold text-slate-900"><Search className="w-4 h-4 text-[#f37121]" />{t('من نفّذ هذا المسار وبكم؟', 'Who carried a route, and at what price?')}</span>
          <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${showSearch ? 'rotate-180' : ''}`} />
        </button>
        {showSearch && (
          <div className="space-y-4 border-t border-slate-100 p-4">
            <form onSubmit={(e) => { e.preventDefault(); search(); }} className="flex flex-wrap items-end gap-2">
              <Field label={t('مكان التحميل (من)', 'Loading place (from)')}><TextInput value={from} onChange={(e) => setFrom(e.target.value)} placeholder={t('جازان · ميناء جدة', 'e.g. Jazan')} /></Field>
              <Field label={t('الوجهة (إلى)', 'Destination (to)')}><TextInput value={to} onChange={(e) => setTo(e.target.value)} placeholder={t('الرياض · القصيم', 'e.g. Riyadh')} /></Field>
              <button type="submit" disabled={busy} className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg bg-slate-900 text-white text-sm font-semibold disabled:opacity-50"><Search className="w-4 h-4" />{t('بحث', 'Search')}</button>
              <span className="text-[11.5px] text-slate-500 ms-2">{t('الخانة الفارغة تعني أيّ مكان', 'An empty box means anywhere')}</span>
            </form>
            {busy && <Spinner />}
            {res && !busy && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-5 gap-3">
                  <Kpi ar={ar} label={t('رحلاتٌ هذا العام', 'Trips this year')} value={fmtInt(res.trips)} />
                  <Kpi ar={ar} label={t('الموردون المنفّذون', 'Carriers')} value={fmtInt(res.vendors.length)} />
                  {res.price && <Kpi ar={ar} label={t('أقلّ · أعلى سعر فعلي', 'Actual min · max')} value={<span className="text-[16px]">{fmtMoney(res.price.min)} · {fmtMoney(res.price.max)}</span>} />}
                  {res.price && <Kpi ar={ar} label={t('متوسط السعر الفعلي', 'Actual average')} value={fmtMoney(res.price.avg)} tone="brand" />}
                  <Kpi ar={ar} label={t('السعر المعتمد', 'Approved range')} value={res.approved.length ? <span className="text-[15px]">{res.approved.map((a: Row) => `${fmtMoney(a.min)} – ${fmtMoney(a.max)}`).join(' · ')}</span> : <span className="text-[13px] text-slate-400">{t('غير مسعَّر', 'Not priced')}</span>} />
                </div>
                <Panel title={t('الموردون المنفّذون على المسار', 'Carriers on the route')} subtitle={t('بالأحمر = آخر سعرٍ أعلى من السقف المعتمد', 'Red = last price above the approved ceiling')} pad={false}>
                  <DataGrid ar={ar} rows={res.vendors} limit={30} rowKey={(r, i) => `${r.name}-${i}`} cols={[
                    { key: 'name', label: t('المورّد', 'Carrier'), render: (r) => <Link href={vendorHref(r)} className="font-semibold text-slate-900 hover:text-[#f37121]">{r.name}</Link> },
                    { key: 'kind', label: t('النوع', 'Kind'), render: (r) => <span className={`px-2 py-0.5 rounded-full border text-[11px] ${KIND[r.kind]?.cls}`}>{kindLabel(r.kind, ar)}</span> },
                    { key: 'owner', label: t('المسؤول · العقد', 'Owner · contract'), render: (r) => <span>{r.owner || '—'}{r.contract && <span className={`ms-1.5 px-1.5 py-0.5 rounded border text-[10.5px] ${contractTone(r.contract)}`}>{r.contract}</span>}</span> },
                    { key: 'trips', label: t('رحلات', 'Trips'), num: true }, { key: 'last', label: t('آخر رحلة', 'Last'), render: (r) => fmtDay(r.last) },
                    { key: 'lastPrice', label: t('سعر آخر رحلة', 'Last price'), num: true, render: (r: Row) => <span className={r.aboveA ? 'text-red-600 font-bold' : ''}>{fmtMoney(r.lastPrice)}</span> },
                    { key: 'avg', label: t('متوسط', 'Avg'), num: true, render: (r: Row) => fmtMoney(r.avg) },
                    { key: 'phone', label: t('الجوال', 'Phone'), render: (r) => (r.phone ? <a href={`tel:${r.phone}`} className="tabular-nums text-sky-700 hover:underline">{r.phone}</a> : '—') },
                  ]} />
                </Panel>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <Panel title={<span className="inline-flex items-center gap-1.5"><Repeat className="w-4 h-4 text-[#f37121]" />{t('موردون يصلون إلى مكان التحميل (رحلة عودة)', 'Carriers arriving at the loading place (return trip)')}</span>} subtitle={t('آخر 45 يومًا', 'Last 45 days')} pad={false}>
                    <DataGrid ar={ar} rows={res.returnTrip} rowKey={(r, i) => `${r.name}-${i}`} empty={t('لا يوجد', 'None')} cols={[
                      { key: 'name', label: t('المورّد', 'Carrier'), render: (r) => <Link href={vendorHref(r)} className="font-semibold hover:text-[#f37121]">{r.name}</Link> },
                      { key: 'trips', label: t('رحلات', 'Trips'), num: true }, { key: 'last', label: t('آخر وصول', 'Last arrival'), render: (r) => fmtDay(r.last) }, { key: 'from', label: t('حمّل من', 'Loaded at') },
                    ]} />
                  </Panel>
                  <Panel title={<span className="inline-flex items-center gap-1.5"><Home className="w-4 h-4 text-[#f37121]" />{t('موردون معتمدون يخدمون المكان', 'Master carriers serving the place')}</span>} pad={false}>
                    <DataGrid ar={ar} rows={res.masterNearby} rowKey={(r) => r.id} cols={[
                      { key: 'name', label: t('المورّد', 'Carrier'), render: (r) => <Link href={vendorHref(r)} className="font-semibold hover:text-[#f37121]">{r.name}</Link> },
                      { key: 'owner', label: t('المسؤول', 'Owner') }, { key: 'headOffice', label: t('المقر', 'HQ') },
                      { key: 'phone', label: t('الجوال', 'Phone'), render: (r) => (r.phone ? <a href={`tel:${r.phone}`} className="tabular-nums text-sky-700 hover:underline">{r.phone}</a> : '—') },
                    ]} />
                  </Panel>
                </div>
              </div>
            )}
          </div>
        )}
      </section>

      {edit && (
        <Modal open onClose={() => setEdit(null)} title={edit._id ? t('تعديل السعر المعتمد', 'Edit approved price') : t('مسارٌ معتمدٌ جديد', 'New approved route')}
          footer={<>
            <button type="button" onClick={() => setEdit(null)} className="px-4 py-2 rounded-lg text-sm text-slate-600 hover:text-slate-900">{t('إلغاء', 'Cancel')}</button>
            <PrimaryButton onClick={savePrice} disabled={saving || !edit.fromCity || !edit.toCity || !(Number(edit.minPrice) > 0) || !(Number(edit.maxPrice) > 0) || !!editRangeBad}>{t('حفظ', 'Save')}</PrimaryButton>
          </>}>
          <div className="space-y-4">
            <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3">
              <p className="mb-2 text-[12.5px] font-bold text-slate-700">{t('المسار', 'Route')}</p>
              <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_1fr] items-end gap-2">
                <Field label={t('من (مكان التحميل)', 'From (loading place)')}>
                  <SearchableSelect value={edit.fromCity} onChange={(v) => setEdit({ ...edit, fromCity: v })} options={opt(places.from, edit.fromCity)} searchAfter={0}
                    placeholder={t('اختر من إعدادات القسم', 'Pick from section settings')} searchPlaceholder={t('ابحث…', 'Search…')} />
                </Field>
                <Arrow className="mb-3 hidden w-5 h-5 text-[#f37121] sm:block" />
                <Field label={t('إلى (الوجهة)', 'To (destination)')}>
                  <SearchableSelect value={edit.toCity} onChange={(v) => setEdit({ ...edit, toCity: v })} options={opt(places.to, edit.toCity)} searchAfter={0}
                    placeholder={t('اختر من إعدادات القسم', 'Pick from section settings')} searchPlaceholder={t('ابحث…', 'Search…')} />
                </Field>
              </div>
              <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
                <Field label={t('العميل (اختياري — بدونه يسري على كلّ العملاء)', 'Customer (optional — empty applies to all)')}>
                  <SearchableSelect value={edit.customer ? String(edit.customer) : ''} onChange={(v) => setEdit({ ...edit, customer: v })} searchAfter={0}
                    options={[{ value: '', label: t('— كلّ العملاء —', '— all customers —') }, ...customers.map((c) => ({ value: String(c._id), label: c.code ? `${c.name} · ${c.code}` : c.name }))]}
                    placeholder={t('كلّ العملاء', 'All customers')} searchPlaceholder={t('ابحث بالاسم أو الكود…', 'Search name or code…')} />
                </Field>
                <Field label={t('نوع الشاحنة (اختياري — بدونه يسري على كلّ الأنواع)', 'Truck type (optional — empty applies to all)')}>
                  <TextInput value={edit.truckType || ''} onChange={(e) => setEdit({ ...edit, truckType: e.target.value })} placeholder={t('مثال: سطحة', 'e.g. flatbed')} />
                </Field>
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3">
              <p className="mb-2 text-[12.5px] font-bold text-slate-700">{t('سعر الشراء المعتمد للرحلة', 'Approved purchase price per trip')}</p>
              <div className="grid grid-cols-2 gap-3">
                <Field label={t('من', 'From')}><TextInput type="number" min={0} value={edit.minPrice ?? ''} onChange={(e) => setEdit({ ...edit, minPrice: e.target.value })} placeholder="2300" /></Field>
                <Field label={t('إلى', 'To')}><TextInput type="number" min={0} value={edit.maxPrice ?? ''} onChange={(e) => setEdit({ ...edit, maxPrice: e.target.value })} placeholder="2700" /></Field>
              </div>
              {editRangeBad && <p className="mt-1.5 text-[12px] font-semibold text-red-600">{t('سعر «من» أكبر من سعر «إلى»', '“From” is above “to”')}</p>}
              <p className="mt-1.5 text-[11.5px] text-slate-500">{t('يظهر هذا النطاق تلقائيًّا لفريق العمليات على كلّ طلب شحنٍ بنفس المسار (ولنفس العميل إن حُدِّد)، ويتحدّث فورًا عند التعديل. سعرُ العميل الخاص يسبق سعرَ المسار العام.', 'Shows on every request on this route (for this customer if set) and updates at once. A customer’s own price wins over the general one.')}</p>
            </div>
            <Field label={t('ملاحظات', 'Notes')}><TextInput value={edit.notes || ''} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} /></Field>
          </div>
        </Modal>
      )}
    </div>
  );
}
