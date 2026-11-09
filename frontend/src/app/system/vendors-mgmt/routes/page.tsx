'use client';
/**
 * Route search and the approved price list. Who carried a route this year and at what price against the approved
 * tiers, which carriers recently delivered to the loading place (a return trip), and which master carriers are based
 * at or serve either end. The approved list is kept here by the team leads and is what the price alerts measure.
 */
import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useDialog } from '@/components/system/DialogProvider';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import { PageHeader, Modal, Field, TextInput, SearchInput, Spinner } from '@/components/hr/HRKit';
import ExportMenu from '@/components/ls2/ExportMenu';
import { Kpi, Panel, DataGrid, fmtInt, fmtMoney, fmtDay } from '@/components/analytics/AnalyticsKit';
import { KIND, kindLabel, contractTone, vendorHref, isVendorLead } from '@/lib/vendors';
import { Route as RouteIcon, Search, Plus, Pencil, Trash2, Repeat, Home } from 'lucide-react';

type Row = Record<string, any>;

export default function VendorRoutesPage() {
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const t = (a: string, e: string) => (ar ? a : e);
  const { notify, confirm } = useDialog();
  const [from, setFrom] = useState(() => (typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('from') || '' : ''));
  const [to, setTo] = useState(() => (typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('to') || '' : ''));
  const [res, setRes] = useState<Row | null>(null);
  const [busy, setBusy] = useState(false);
  const [prices, setPrices] = useState<Row[] | null>(null);
  const [pq, setPq] = useState('');
  const [edit, setEdit] = useState<Row | null>(null);
  const lead = isVendorLead(user);

  const search = useCallback(async () => {
    if (!from.trim() && !to.trim()) return;
    setBusy(true);
    try { setRes(await api.get(`/api/vendors-mgmt/route-search?from=${encodeURIComponent(from.trim())}&to=${encodeURIComponent(to.trim())}`)); }
    catch (e: any) { notify(e?.message || t('تعذّر البحث', 'Search failed'), 'error'); }
    setBusy(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to]);
  useEffect(() => { if (from || to) search(); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const loadPrices = useCallback(() => { api.get<{ prices: Row[] }>('/api/vendors-mgmt/prices').then((r) => setPrices(r.prices || [])).catch(() => setPrices([])); }, []);
  useEffect(() => { loadPrices(); }, [loadPrices]);
  useSocket('vendors:changed', loadPrices);

  const savePrice = async () => {
    try {
      if (edit?._id) await api.put(`/api/vendors-mgmt/prices/${edit._id}`, edit); else await api.post('/api/vendors-mgmt/prices', edit);
      notify(t('حُفظ السعر', 'Saved'), 'success'); setEdit(null); loadPrices();
    } catch (e: any) { notify(e?.message || t('تعذّر الحفظ', 'Could not save'), 'error'); }
  };
  const delPrice = async (p: Row) => {
    if (!(await confirm({ title: t('حذف السعر', 'Delete price'), message: `${p.fromCity} → ${p.toCity}`, tone: 'danger' }))) return;
    try { await api.delete(`/api/vendors-mgmt/prices/${p._id}`); loadPrices(); } catch (e: any) { notify(e?.message || t('تعذّر الحذف', 'Could not delete'), 'error'); }
  };
  const shownPrices = (prices || []).filter((p) => !pq || `${p.fromCity} ${p.toCity}`.includes(pq));
  const money = res ? res.price != null || (res.vendors?.[0]?.avg !== undefined) : true;

  return (
    <div className="space-y-4 pb-10" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader icon={<RouteIcon className="w-6 h-6 text-[#f37121]" />} title={t('بحث بالمسار والأسعار المعتمدة', 'Route search & approved prices')}
        subtitle={t('من نفّذ المسار وبكم مقابل القائمة المعتمدة، ومن يمكنه رحلة عودة', 'Who carried the route and at what price against the approved list, and who can take a return trip')} />

      <form onSubmit={(e) => { e.preventDefault(); search(); }} className="rounded-2xl border border-slate-200 bg-white shadow-sm p-3 flex flex-wrap items-end gap-2">
        <Field label={t('مكان التحميل (من)', 'Loading place (from)')}><TextInput value={from} onChange={(e) => setFrom(e.target.value)} placeholder={t('جازان · ميناء جدة · الجبيل', 'e.g. Jazan, Jeddah port')} /></Field>
        <Field label={t('الوجهة (إلى)', 'Destination (to)')}><TextInput value={to} onChange={(e) => setTo(e.target.value)} placeholder={t('رابغ · الرياض · القصيم', 'e.g. Rabigh, Riyadh')} /></Field>
        <button type="submit" disabled={busy} className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg bg-[#f37121] text-white text-sm font-semibold disabled:opacity-50"><Search className="w-4 h-4" />{t('بحث', 'Search')}</button>
        <span className="text-[11.5px] text-slate-500 ms-2">{t('الخانة الفارغة تعني أيّ مكان · يُقبل جزءٌ من الاسم', 'An empty box means anywhere · part of a name works')}</span>
      </form>

      {busy && <Spinner />}
      {res && !busy && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
            <Kpi ar={ar} label={t('رحلاتٌ محقّقة هذا العام', 'Trips this year')} value={fmtInt(res.trips)} />
            <Kpi ar={ar} label={t('الموردون المنفّذون', 'Carriers')} value={fmtInt(res.vendors.length)} sub={t('بدون أسطول تنشيط', 'excl. our fleet')} />
            {res.price && <Kpi ar={ar} label={t('أقلّ · أعلى سعر', 'Min · max price')} value={<span className="text-[16px]">{fmtMoney(res.price.min)} · {fmtMoney(res.price.max)}</span>} />}
            {res.price && <Kpi ar={ar} label={t('متوسط السعر', 'Average price')} value={fmtMoney(res.price.avg)} tone="brand" />}
            <Kpi ar={ar} label={t('السعر المعتمد A / B / C', 'Approved A / B / C')} value={res.approved.length ? <span className="text-[15px]">{res.approved.map((a: Row) => `${fmtMoney(a.A)} / ${fmtMoney(a.B)} / ${fmtMoney(a.C)}`).join(' · ')}</span> : <span className="text-[13px] text-slate-400">{t('المسار غير مدرج في القائمة', 'Not on the list')}</span>} />
            <Kpi ar={ar} label={t('مساراتٌ مطابقة', 'Matching routes')} value={fmtInt(res.routes.length)} sub={res.routes.slice(0, 2).map((r: Row) => r.route).join(' · ')} />
          </div>
          <Panel title={t('الموردون المنفّذون على المسار', 'Carriers on the route')} subtitle={t('السعر بالأحمر = آخر سعرٍ أعلى من الفئة A المعتمدة', 'Red = last price above approved tier A')} pad={false}>
            <DataGrid ar={ar} rows={res.vendors} limit={30} rowKey={(r, i) => `${r.name}-${i}`} cols={[
              { key: 'name', label: t('المورّد', 'Carrier'), render: (r) => <Link href={vendorHref(r)} className="font-semibold text-slate-900 hover:text-[#f37121]">{r.name}</Link> },
              { key: 'kind', label: t('النوع', 'Kind'), render: (r) => <span className={`px-2 py-0.5 rounded-full border text-[11px] ${KIND[r.kind]?.cls}`}>{kindLabel(r.kind, ar)}</span> },
              { key: 'owner', label: t('المسؤول · العقد', 'Owner · contract'), render: (r) => <span>{r.owner || '—'}{r.contract && <span className={`ms-1.5 px-1.5 py-0.5 rounded border text-[10.5px] ${contractTone(r.contract)}`}>{r.contract}</span>}</span> },
              { key: 'trips', label: t('رحلات', 'Trips'), num: true }, { key: 'last', label: t('آخر رحلة', 'Last'), render: (r) => fmtDay(r.last) },
              ...(money ? [
                { key: 'lastPrice', label: t('سعر آخر رحلة', 'Last price'), num: true, render: (r: Row) => <span className={r.aboveA ? 'text-red-600 font-bold' : ''}>{fmtMoney(r.lastPrice)}</span> },
                { key: 'avg', label: t('متوسط', 'Avg'), num: true, render: (r: Row) => fmtMoney(r.avg) },
                { key: 'min', label: t('أقلّ · أعلى', 'Min · max'), num: true, render: (r: Row) => `${fmtMoney(r.min)} · ${fmtMoney(r.max)}` },
              ] : []),
              { key: 'routes', label: t('المسارات', 'Routes'), render: (r) => <span className="text-[11.5px] text-slate-600">{r.routes.slice(0, 3).join(' · ')}</span> },
              { key: 'phone', label: t('الجوال', 'Phone'), render: (r) => (r.phone ? <a href={`tel:${r.phone}`} className="tabular-nums text-sky-700 hover:underline">{r.phone}</a> : '—') },
            ]} />
          </Panel>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Panel title={<span className="inline-flex items-center gap-1.5"><Repeat className="w-4 h-4 text-[#f37121]" />{t('موردون يصلون إلى مكان التحميل (فرصة رحلة عودة)', 'Carriers arriving at the loading place (return trip)')}</span>} subtitle={t('آخر 45 يومًا · الأحدث أوّلًا', 'Last 45 days · newest first')} pad={false}>
              <DataGrid ar={ar} rows={res.returnTrip} rowKey={(r, i) => `${r.name}-${i}`} empty={from ? t('لا يوجد', 'None') : t('أدخل مكان التحميل', 'Enter a loading place')} cols={[
                { key: 'name', label: t('المورّد', 'Carrier'), render: (r) => <Link href={vendorHref(r)} className="font-semibold hover:text-[#f37121]">{r.name}</Link> },
                { key: 'kind', label: t('النوع', 'Kind'), render: (r) => kindLabel(r.kind, ar) }, { key: 'trips', label: t('رحلات', 'Trips'), num: true },
                { key: 'last', label: t('آخر وصول', 'Last arrival'), render: (r) => fmtDay(r.last) }, { key: 'from', label: t('حمّل من', 'Loaded at') },
              ]} />
            </Panel>
            <Panel title={<span className="inline-flex items-center gap-1.5"><Home className="w-4 h-4 text-[#f37121]" />{t('موردو الماستر الذين يشمل مقرُّهم أو وجهاتُهم المكان', 'Master carriers based at or serving the place')}</span>} pad={false}>
              <DataGrid ar={ar} rows={res.masterNearby} rowKey={(r) => r.id} cols={[
                { key: 'name', label: t('المورّد', 'Carrier'), render: (r) => <Link href={vendorHref(r)} className="font-semibold hover:text-[#f37121]">{r.name}</Link> },
                { key: 'owner', label: t('المسؤول', 'Owner') },
                { key: 'contract', label: t('العقد', 'Contract'), render: (r) => (r.contract ? <span className={`px-2 py-0.5 rounded-full border text-[11px] ${contractTone(r.contract)}`}>{r.contract}</span> : '—') },
                { key: 'headOffice', label: t('المقر', 'HQ') }, { key: 'vehicleTypes', label: t('السيارات', 'Trucks'), render: (r) => `${r.vehicleTypes || '—'}${r.fleetSize ? ` · ${r.fleetSize}` : ''}` },
                { key: 'phone', label: t('الجوال', 'Phone'), render: (r) => (r.phone ? <a href={`tel:${r.phone}`} className="tabular-nums text-sky-700 hover:underline">{r.phone}</a> : '—') },
              ]} />
            </Panel>
          </div>
        </div>
      )}

      <Panel title={t('قائمة الأسعار المعتمدة', 'Approved price list')} subtitle={t('سعر شراء الرحلة لكلّ مسارٍ حسب فئة المورّد (A أعلى سقف، B وC للمفضّلين والمتعاقدين)', 'Trip purchase price per route by carrier tier')}
        actions={<>
          <div className="w-52"><SearchInput value={pq} onChange={setPq} placeholder={t('بحث بالمسار…', 'Search…')} /></div>
          <ExportMenu fileName="approved-prices" lang={ar ? 'ar' : 'en'} options={[{ key: 'all', label: t('القائمة', 'List'), sheets: [{ name: t('الأسعار المعتمدة', 'Approved prices'), rows: shownPrices, columns: [{ header: t('من', 'From'), key: 'fromCity' }, { header: t('إلى', 'To'), key: 'toCity' }, { header: t('نوع الشاحنة', 'Truck'), key: 'truckType' }, { header: 'A', key: 'priceA' }, { header: 'B', key: 'priceB' }, { header: 'C', key: 'priceC' }, { header: t('ملاحظات', 'Notes'), key: 'notes' }] }] }]} />
          {lead && <button type="button" onClick={() => setEdit({ fromCity: '', toCity: '', truckType: '', priceA: '', priceB: '', priceC: '', notes: '' })} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[#f37121] text-white text-[12.5px] font-semibold"><Plus className="w-3.5 h-3.5" />{t('مسار', 'Route')}</button>}
        </>} pad={false}>
        {prices == null ? <Spinner /> : (
          <DataGrid ar={ar} rows={shownPrices} limit={40} rowKey={(r) => r._id} onRow={(r) => { setFrom(r.fromCity); setTo(r.toCity); setTimeout(search, 0); window.scrollTo({ top: 0, behavior: 'smooth' }); }} cols={[
            { key: 'fromCity', label: t('من', 'From'), render: (r) => <span className="font-semibold">{r.fromCity}</span> },
            { key: 'toCity', label: t('إلى', 'To'), render: (r) => <span className="font-semibold">{r.toCity}</span> },
            { key: 'truckType', label: t('نوع الشاحنة', 'Truck'), render: (r) => r.truckType || t('الكلّ', 'Any') },
            { key: 'priceA', label: 'A', num: true, render: (r) => fmtMoney(r.priceA) }, { key: 'priceB', label: 'B', num: true, render: (r) => fmtMoney(r.priceB) }, { key: 'priceC', label: 'C', num: true, render: (r) => fmtMoney(r.priceC) },
            { key: 'updatedByName', label: t('آخر تعديل', 'Updated by'), render: (r) => <span className="text-[11.5px] text-slate-500">{r.updatedByName} · {fmtDay(r.updatedAt)}</span> },
            ...(lead ? [{ key: 'act', label: '', render: (r: Row) => (
              <span className="inline-flex gap-1" onClick={(e) => e.stopPropagation()}>
                <button type="button" onClick={() => setEdit({ ...r })} className="p-1.5 rounded text-slate-500 hover:text-[#f37121]"><Pencil className="w-3.5 h-3.5" /></button>
                <button type="button" onClick={() => delPrice(r)} className="p-1.5 rounded text-slate-500 hover:text-red-600"><Trash2 className="w-3.5 h-3.5" /></button>
              </span>
            ) }] : []),
          ]} />
        )}
      </Panel>

      {edit && (
        <Modal open onClose={() => setEdit(null)} title={edit._id ? t('تعديل السعر المعتمد', 'Edit approved price') : t('سعرٌ معتمدٌ جديد', 'New approved price')}
          footer={<button type="button" onClick={savePrice} className="ms-auto px-5 py-2.5 rounded-xl bg-[#f37121] text-white text-sm font-bold">{t('حفظ', 'Save')}</button>}>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('من', 'From')}><TextInput value={edit.fromCity} onChange={(e) => setEdit({ ...edit, fromCity: e.target.value })} /></Field>
            <Field label={t('إلى', 'To')}><TextInput value={edit.toCity} onChange={(e) => setEdit({ ...edit, toCity: e.target.value })} /></Field>
            <Field label={t('نوع الشاحنة (اختياري)', 'Truck type (optional)')} span2><TextInput value={edit.truckType} onChange={(e) => setEdit({ ...edit, truckType: e.target.value })} /></Field>
            <Field label="A"><TextInput type="number" value={edit.priceA ?? ''} onChange={(e) => setEdit({ ...edit, priceA: e.target.value })} /></Field>
            <Field label="B"><TextInput type="number" value={edit.priceB ?? ''} onChange={(e) => setEdit({ ...edit, priceB: e.target.value })} /></Field>
            <Field label="C"><TextInput type="number" value={edit.priceC ?? ''} onChange={(e) => setEdit({ ...edit, priceC: e.target.value })} /></Field>
            <Field label={t('ملاحظات', 'Notes')} span2><TextInput value={edit.notes || ''} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} /></Field>
          </div>
        </Modal>
      )}
    </div>
  );
}
