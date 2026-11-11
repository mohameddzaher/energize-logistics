'use client';
/**
 * Heavy-transport freelancers: one person working with his own truck. Companies live on the carriers page; light-transport
 * freelancers belong to B2C. Adding one registers the person, his truck and the driver in one step (no papers, no approval).
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useLanguage } from '@/context/LanguageContext';
import { useDialog } from '@/components/system/DialogProvider';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import { Spinner, PageHeader, Modal, TextInput } from '@/components/hr/HRKit';
import SearchSelect from '@/components/system/SearchSelect';
import ExportMenu, { type ExportColumn } from '@/components/ls2/ExportMenu';
import { Truck, Plus, Search, Loader2, X, Phone } from 'lucide-react';

type Row = Record<string, any>;

/** Labelled field, at module level so inputs keep focus while typing. */
function L({ label, req, children, hint }: { label: string; req?: boolean; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[13px] font-bold text-slate-800">{label}{req && <span className="text-red-600"> *</span>}</span>
      {children}
      {hint && <span className="mt-1 block text-[11.5px] text-slate-500">{hint}</span>}
    </label>
  );
}

const EMPTY = { name: '', phone: '', residenceNumber: '', plate: '', truckType: '', followOwner: '', notes: '' };

export default function HeavyFreelancersPage() {
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const t = (a: string, e: string) => (ar ? a : e);
  const { notify } = useDialog();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ ...EMPTY });
  const [bad, setBad] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [people, setPeople] = useState<{ value: string; label: string; roleAr?: string }[]>([]);

  const load = useCallback(() => {
    api.get<{ freelancers: Row[] }>('/api/vendors-mgmt/freelancers').then((d) => setRows(d.freelancers || [])).catch(() => setRows([]));
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { api.get<{ options: any[] }>('/api/shipment-requests/team-members?team=helpers').then((d) => setPeople(d.options || [])).catch(() => {}); }, []);
  useSocket('vendors:changed', load);

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s || !rows) return rows || [];
    return rows.filter((r) => [r.name, r.phone, ...(r.vehicles || []).map((v: Row) => v.plate), ...(r.drivers || []).map((d: Row) => `${d.name} ${d.residenceNumber}`)]
      .some((x) => String(x || '').toLowerCase().includes(s)));
  }, [rows, q]);

  const save = async () => {
    setBusy(true); setBad([]);
    try {
      await api.post('/api/vendors-mgmt/freelancers', f);
      notify(t('أُضيف الفريلانسر بسيارته', 'Freelancer added with his truck'), 'success');
      setOpen(false); setF({ ...EMPTY }); load();
    } catch (e: any) {
      if (e?.data?.fields) setBad(e.data.fields);
      notify(e?.message || t('تعذّرت الإضافة', 'Could not add'), 'error');
    }
    setBusy(false);
  };
  const err = (k: string) => (bad.includes(k) ? 'border-red-400 ring-1 ring-red-200' : '');

  const cols: ExportColumn[] = [
    { header: t('الاسم', 'Name'), key: 'name', width: 26 },
    { header: t('الجوال', 'Phone'), key: 'phone', width: 14 },
    { header: t('رقم الإقامة', 'Iqama'), key: 'drivers', width: 14, transform: (v: Row[]) => (v || []).map((d) => d.residenceNumber).filter(Boolean).join('، ') },
    { header: t('اللوحة', 'Plate'), key: 'vehicles', width: 14, transform: (v: Row[]) => (v || []).map((x) => x.plate).join('، ') },
    { header: t('نوع الشاحنة', 'Truck type'), key: 'vehicles', width: 14, transform: (v: Row[]) => (v || []).map((x) => x.truckType).filter(Boolean).join('، ') },
    { header: t('مسؤول المتابعة', 'Follow-up owner'), key: 'followOwner', width: 18 },
  ];

  if (!rows) return <Spinner />;
  return (
    <div className="space-y-4 pb-10" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader icon={<Truck className="w-6 h-6 text-[#f37121]" />}
        title={t('الفريلانسرز — النقل الثقيل', 'Freelancers — heavy transport')}
        subtitle={t('أفرادٌ يعملون بسياراتهم مباشرةً. الشركات في صفحة الموردين، وفريلانسر النقل الخفيف في B2C.', 'Individuals working with their own trucks. Companies are on the carriers page; light-transport freelancers are in B2C.')}>
        <ExportMenu fileName="heavy-freelancers" lang={ar ? 'ar' : 'en'} options={[{ key: 'shown', label: t('المعروض', 'Shown'), sheets: [{ name: t('الفريلانسرز', 'Freelancers'), rows: shown, columns: cols }] }]} />
        <button type="button" onClick={() => { setF({ ...EMPTY }); setBad([]); setOpen(true); }}
          className="inline-flex items-center gap-1.5 rounded-lg bg-[#f37121] px-4 py-2 text-sm font-bold text-white shadow-sm hover:bg-[#e06010]">
          <Plus className="h-4 w-4" />{t('إضافة فريلانسر نقل ثقيل', 'Add heavy-transport freelancer')}
        </button>
      </PageHeader>

      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
        <div className="relative flex-1 min-w-[16rem] max-w-md">
          <Search className="absolute start-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('ابحث بالاسم أو الجوال أو اللوحة أو رقم الإقامة…', 'Name, phone, plate or iqama…')}
            className="w-full rounded-lg border border-slate-300 py-2 pe-8 ps-8 text-[13px] focus:outline-none focus:ring-2 focus:ring-[#f37121]/40" />
          {q && <button type="button" onClick={() => setQ('')} className="absolute end-2 top-1/2 -translate-y-1/2 text-slate-400"><X className="h-4 w-4" /></button>}
        </div>
        <span className="text-[13px] font-semibold text-slate-600">{t(`${shown.length} فريلانسر`, `${shown.length} freelancers`)}</span>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full min-w-[820px] text-[13px]">
          <thead className="bg-slate-900 text-slate-200">
            <tr>{[t('الفريلانسر', 'Freelancer'), t('الجوال', 'Phone'), t('رقم الإقامة', 'Iqama'), t('اللوحة', 'Plate'), t('نوع الشاحنة', 'Truck type'), t('مسؤول المتابعة', 'Follow-up'), t('أُضيف', 'Added')].map((h) => <th key={h} className="px-3 py-2.5 text-start font-semibold whitespace-nowrap">{h}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {!shown.length && <tr><td colSpan={7} className="py-12 text-center text-slate-400">{t('لا فريلانسرز بعد — أضِف أوّلهم.', 'No freelancers yet.')}</td></tr>}
            {shown.map((r) => (
              <tr key={r._id} className="hover:bg-slate-50/60">
                <td className="px-3 py-2.5 font-semibold text-slate-900">{r.name}</td>
                <td className="px-3 py-2.5 tabular-nums" dir="ltr">{r.phone ? <a href={`tel:${r.phone}`} className="inline-flex items-center gap-1 text-slate-700 hover:text-[#f37121]"><Phone className="h-3.5 w-3.5" />{r.phone}</a> : '—'}</td>
                <td className="px-3 py-2.5 font-mono text-slate-600">{(r.drivers || []).map((d: Row) => d.residenceNumber).filter(Boolean).join('، ') || '—'}</td>
                <td className="px-3 py-2.5 font-semibold text-slate-800">{(r.vehicles || []).map((v: Row) => v.plate).join('، ') || '—'}</td>
                <td className="px-3 py-2.5 text-slate-600">{(r.vehicles || []).map((v: Row) => v.truckType).filter(Boolean).join('، ') || '—'}</td>
                <td className="px-3 py-2.5 text-slate-600">{r.followOwner || '—'}</td>
                <td className="px-3 py-2.5 text-slate-500 whitespace-nowrap">{r.createdAt ? new Date(r.createdAt).toLocaleDateString('en-GB') : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title={t('إضافة فريلانسر نقل ثقيل', 'Add a heavy-transport freelancer')}
        footer={<button type="button" onClick={save} disabled={busy} className="ms-auto inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-[#f37121] text-white text-sm font-bold disabled:opacity-50">{busy && <Loader2 className="w-4 h-4 animate-spin" />}{t('إضافة', 'Add')}</button>}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <L label={t('اسم الفريلانسر (السائق)', 'Freelancer (driver) name')} req><TextInput value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} className={err('name')} /></L>
          <L label={t('رقم الجوال', 'Mobile')} req><TextInput dir="ltr" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} className={err('phone')} /></L>
          <L label={t('رقم الإقامة / الهوية', 'Iqama / ID')} req hint={t('10 أرقام تبدأ بـ1 أو 2', '10 digits starting with 1 or 2')}><TextInput dir="ltr" value={f.residenceNumber} onChange={(e) => setF({ ...f, residenceNumber: e.target.value })} className={err('residenceNumber')} /></L>
          <L label={t('رقم لوحة الشاحنة', 'Truck plate')} req><TextInput value={f.plate} onChange={(e) => setF({ ...f, plate: e.target.value })} className={err('plate')} /></L>
          <L label={t('نوع الشاحنة', 'Truck type')}><TextInput value={f.truckType} onChange={(e) => setF({ ...f, truckType: e.target.value })} placeholder={t('سطحة، ستارة، ثلاجة…', 'Flatbed, curtain…')} /></L>
          <div>
            <span className="mb-1.5 block text-[13px] font-bold text-slate-800">{t('مسؤول المتابعة', 'Follow-up owner')}</span>
            <SearchSelect ar={ar} value={f.followOwner} onChange={(x) => setF({ ...f, followOwner: x })} placeholder={t('اختر الشخص…', 'Pick a person…')}
              options={people.map((p) => ({ value: p.label, label: p.label, hint: p.roleAr || '' }))} />
          </div>
          <div className="sm:col-span-2"><L label={t('ملاحظات', 'Notes')}><TextInput value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></L></div>
        </div>
      </Modal>
    </div>
  );
}
