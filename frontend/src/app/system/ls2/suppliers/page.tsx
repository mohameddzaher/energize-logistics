'use client';
/**
 * موردو مخزن النقل الثقيل — مَن تُشترى منه قطعُ الغيار.
 *
 * المورد يُضاف من هنا، أو من خانة «المورد» في استمارة الصنف نفسِها (يُكتب الاسمُ
 * فيُنشأ مع الحفظ). والقائمتان تسمعان الحدثَ ذاتَه (`ls2:store`)، فما أُضيف في
 * إحداهما يظهر في الأخرى بلا إعادة تحميل.
 *
 * ومع كلّ موردٍ ما اشتُري منه: عددُ الأصناف والتوريدات والقيمة وآخرُ شراء —
 * محسوبةٌ من حركات الوارد لا مكتوبةٌ بيد.
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useDialog } from '@/components/system/DialogProvider';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import { isLs2Staff, isLs2Admin, type Lang } from '@/lib/ls2';
import { Spinner, PageHeader, StatCard } from '@/components/hr/HRKit';
import ExportMenu, { type ExportColumn } from '@/components/ls2/ExportMenu';
import ScrollX from '@/components/system/ScrollX';
import { useColumnFilters, ClearColumnFilters } from '@/components/useColumnFilters';
import type { Supplier } from '@/components/store/StoreScreen';
import { Truck, Plus, Edit, Trash2, X, Save, Search } from 'lucide-react';

const BASE = '/api/ls2/suppliers';
const money = (n: unknown) => (Number(n) || 0).toLocaleString('en-US', { maximumFractionDigits: 2 });
const dmy = (d?: string) => (d ? String(d).slice(0, 10).split('-').reverse().join('/') : '—');

export default function Ls2SuppliersPage() {
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const t = (a: string, e: string) => (ar ? a : e);
  const { notify, confirm } = useDialog();
  const canEdit = isLs2Admin(user);
  const [rows, setRows] = useState<Supplier[] | null>(null);
  const [q, setQ] = useState('');
  const [form, setForm] = useState<Supplier | 'new' | null>(null);
  const cf = useColumnFilters<Supplier>();

  const load = useCallback(() => {
    api.get<{ suppliers: Supplier[] }>(BASE).then((d) => setRows(d.suppliers || []))
      .catch((e: any) => { setRows((p) => p || []); notify(e?.message || t('تعذّر التحميل', 'Could not load'), 'error'); });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { load(); }, [load]);
  useSocket('ls2:store', load);

  const getters: Record<string, (s: Supplier) => any> = useMemo(() => ({
    city: (s) => s.city || '', month: (s) => String(s.lastPurchase || '').slice(0, 7),
  }), []);
  const shown = useMemo(() => {
    const k = q.trim().toLowerCase();
    const base = (rows || []).filter((s) => !k || [s.name, s.phone, s.city, s.taxNumber].some((v) => String(v || '').toLowerCase().includes(k)));
    return cf.apply(base, getters);
  }, [rows, q, cf, getters]);

  if (!isLs2Staff(user)) return <div className="p-8 text-slate-500">{t('غير مصرّح', 'Not authorized')}</div>;
  if (!rows) return <Spinner />;

  const remove = async (s: Supplier) => {
    if (!(await confirm({
      title: t(`حذف المورد «${s.name}»؟`, `Delete supplier “${s.name}”?`),
      message: t('يختفي من قائمة الاختيار. مشترياتُه السابقةُ تبقى باسمه في سجلّ الحركات.', 'It leaves the pick list. Its past purchases stay under its name in the log.'),
      confirmLabel: t('حذف', 'Delete'), tone: 'danger',
    }))) return;
    try { await api.delete(`${BASE}/${s._id}`); notify(t('حُذف المورد', 'Deleted'), 'success'); load(); }
    catch (e: any) { notify(e?.message || t('تعذّر الحذف', 'Delete failed'), 'error'); }
  };

  const cols: ExportColumn[] = [
    { header: t('المورد', 'Supplier'), key: 'name', width: 30 },
    { header: t('الجوال', 'Phone'), key: 'phone', width: 16 },
    { header: t('المدينة', 'City'), key: 'city', width: 14 },
    { header: t('الرقم الضريبي', 'Tax no.'), key: 'taxNumber', width: 18 },
    { header: t('الأصناف', 'Items'), key: 'items', width: 10 },
    { header: t('التوريدات', 'Purchases'), key: 'purchases', width: 11 },
    { header: t('القطع', 'Units'), key: 'units', width: 10 },
    { header: t('قيمة المشتريات', 'Purchases value'), key: 'total', width: 16 },
    { header: t('آخر شراء', 'Last purchase'), key: 'lastPurchase', transform: (v) => (v ? dmy(v) : ''), width: 13 },
    { header: t('ملاحظات', 'Notes'), key: 'notes', width: 30 },
  ];

  return (
    <div className="space-y-4 w-full pb-10" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader icon={<Truck className="w-5 h-5" />} title={t('الموردون', 'Suppliers')} subtitle={t('مَن تُشترى منه قطعُ غيار مخزن النقل الثقيل', 'Who the heavy-transport store buys from')}>
        <div className="flex items-center gap-2">
          <ExportMenu fileName="ls2-suppliers" lang={lang as Lang}
            options={[{ key: 'shown', label: t('المعروض', 'Shown'), sheets: [{ name: t('الموردون', 'Suppliers'), rows: shown, columns: cols }] }]} />
          {canEdit && <button onClick={() => setForm('new')} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#f37121] hover:bg-[#e5651a] text-white text-sm"><Plus className="w-4 h-4" />{t('مورد جديد', 'New supplier')}</button>}
        </div>
      </PageHeader>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label={t('عدد الموردين', 'Suppliers')} value={rows.length} accent="text-[#f37121]" />
        <StatCard label={t('توريدات مسجَّلة', 'Recorded purchases')} value={rows.reduce((a, s) => a + (s.purchases || 0), 0)} />
        <StatCard label={t('قيمة المشتريات (ر.س)', 'Purchases value')} value={money(rows.reduce((a, s) => a + (s.total || 0), 0))} accent="text-emerald-600" />
        <StatCard label={t('موردون بلا مشتريات', 'With no purchases')} value={rows.filter((s) => !s.purchases).length} accent="text-slate-500" />
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute top-1/2 -translate-y-1/2 start-2.5" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('ابحث بالاسم / الجوال / المدينة…', 'name / phone / city…')} className="ps-8 pe-3 py-2 rounded-lg border border-slate-200 text-sm w-72 max-w-full" />
        </div>
        <ClearColumnFilters count={cf.count} onClear={cf.clear} ar={ar} />
        <span className="ms-auto text-xs text-slate-400">{shown.length} {t('مورد', 'suppliers')}</span>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <ScrollX>
          <table className="w-full min-w-[900px] text-sm">
            <thead className="bg-slate-900 text-slate-300 text-xs"><tr>
              <th className="px-3 py-2.5 text-start font-semibold">{t('المورد', 'Supplier')}</th>
              <th className="px-3 py-2.5 text-start font-semibold">{t('الجوال', 'Phone')}</th>
              <th className="px-3 py-2.5 text-start font-semibold"><span className="inline-flex items-center gap-1">{t('المدينة', 'City')}{cf.header('city', rows, getters.city, ar)}</span></th>
              <th className="px-3 py-2.5 text-start font-semibold">{t('الأصناف', 'Items')}</th>
              <th className="px-3 py-2.5 text-start font-semibold">{t('التوريدات', 'Purchases')}</th>
              <th className="px-3 py-2.5 text-start font-semibold">{t('قيمة المشتريات', 'Value')}</th>
              <th className="px-3 py-2.5 text-start font-semibold"><span className="inline-flex items-center gap-1">{t('آخر شراء', 'Last purchase')}{cf.header('month', rows, getters.month, ar)}</span></th>
              <th className="px-3 py-2.5" />
            </tr></thead>
            <tbody className="divide-y divide-slate-100">
              {shown.map((s) => (
                <tr key={s._id} className="hover:bg-slate-50">
                  <td className="px-3 py-2">
                    <p className="font-semibold text-slate-800">{s.name}</p>
                    {(s.taxNumber || s.notes) ? <p className="text-[11px] text-slate-400">{[s.taxNumber && `${t('ضريبي', 'Tax')}: ${s.taxNumber}`, s.notes].filter(Boolean).join(' · ')}</p> : null}
                  </td>
                  <td className="px-3 py-2 text-slate-600 whitespace-nowrap"><bdi>{s.phone || '—'}</bdi></td>
                  <td className="px-3 py-2 text-slate-600">{s.city || '—'}</td>
                  <td className="px-3 py-2 tabular-nums text-slate-700">{s.items || 0}</td>
                  <td className="px-3 py-2 tabular-nums text-slate-700">{s.purchases || 0}</td>
                  <td className="px-3 py-2 font-semibold text-emerald-700 tabular-nums whitespace-nowrap">{money(s.total)}</td>
                  <td className="px-3 py-2 text-slate-500 whitespace-nowrap">{dmy(s.lastPurchase)}</td>
                  <td className="px-3 py-2">
                    {canEdit && (
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => setForm(s)} title={t('تعديل', 'Edit')} className="p-1.5 rounded hover:bg-slate-100 text-slate-400"><Edit className="w-3.5 h-3.5" /></button>
                        <button onClick={() => remove(s)} title={t('حذف', 'Delete')} className="p-1.5 rounded hover:bg-red-50 text-red-500"><Trash2 className="w-3.5 h-3.5" /></button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
              {shown.length === 0 && <tr><td colSpan={8} className="px-3 py-10 text-center text-slate-400">{rows.length ? t('لا موردَ يطابق البحث', 'No supplier matches') : t('لا موردين بعد — أضف أوّلَ مورد، أو اكتب اسمَه في خانة «المورد» عند إضافة صنف.', 'No suppliers yet.')}</td></tr>}
            </tbody>
          </table>
        </ScrollX>
      </div>

      {form && <SupplierForm supplier={form === 'new' ? null : form} ar={ar} onClose={() => setForm(null)} onSaved={() => { setForm(null); load(); }} />}
    </div>
  );
}

const label = 'block text-xs font-semibold text-slate-600 mb-1';
const input = 'w-full px-3 py-2 rounded-lg border border-slate-200 text-sm';

function SupplierForm({ supplier, ar, onClose, onSaved }: { supplier: Supplier | null; ar: boolean; onClose: () => void; onSaved: () => void }) {
  const { notify } = useDialog();
  const t = (a: string, e: string) => (ar ? a : e);
  const [f, setF] = useState({ name: supplier?.name || '', phone: supplier?.phone || '', city: supplier?.city || '', taxNumber: supplier?.taxNumber || '', notes: supplier?.notes || '' });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }));
  const save = async () => {
    if (!f.name.trim()) { notify(t('اسم المورد مطلوب', 'Name required'), 'error'); return; }
    setBusy(true);
    try {
      if (supplier) await api.put(`${BASE}/${supplier._id}`, f); else await api.post(BASE, f);
      notify(t('تم الحفظ', 'Saved'), 'success'); onSaved();
    } catch (e: any) { notify(e?.message || t('تعذّر الحفظ', 'Could not save'), 'error'); } finally { setBusy(false); }
  };
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4"><h3 className="font-bold text-lg">{supplier ? t('تعديل مورد', 'Edit supplier') : t('مورد جديد', 'New supplier')}</h3><button onClick={onClose}><X className="w-5 h-5 text-slate-400" /></button></div>
        <div className="space-y-3">
          <div><label className={label}>{t('اسم المورد', 'Name')} *</label><input className={input} value={f.name} onChange={(e) => set('name', e.target.value)} autoFocus /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className={label}>{t('الجوال', 'Phone')}</label><input className={input} dir="ltr" value={f.phone} onChange={(e) => set('phone', e.target.value)} /></div>
            <div><label className={label}>{t('المدينة', 'City')}</label><input className={input} value={f.city} onChange={(e) => set('city', e.target.value)} /></div>
          </div>
          <div><label className={label}>{t('الرقم الضريبي', 'Tax number')}</label><input className={input} dir="ltr" value={f.taxNumber} onChange={(e) => set('taxNumber', e.target.value)} /></div>
          <div><label className={label}>{t('ملاحظات', 'Notes')}</label><textarea className={input} rows={2} value={f.notes} onChange={(e) => set('notes', e.target.value)} /></div>
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="px-4 py-2 rounded-lg bg-slate-100 text-slate-600 text-sm">{t('إلغاء', 'Cancel')}</button>
          <button onClick={save} disabled={busy} className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#f37121] hover:bg-[#e5651a] text-white text-sm font-semibold disabled:opacity-50"><Save className="w-4 h-4" />{t('حفظ', 'Save')}</button>
        </div>
      </div>
    </div>
  );
}
