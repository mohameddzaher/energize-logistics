'use client';
// Complete customer files: one search over every customer, each opening its file across all sections (top management only).
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { FolderSearch } from 'lucide-react';
import api from '@/lib/api';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import { PageHeader, SearchInput, Spinner, ErrorNotice } from '@/components/hr/HRKit';
import ScrollX from '@/components/system/ScrollX';
import ExportMenu, { exportScopeLabels } from '@/components/ls2/ExportMenu';

interface Row { _id: string; name: string; code: string; phone: string; city: string; status: string }
const fold = (s: string) => String(s || '').toLowerCase().replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/\s+/g, ' ').trim();

export default function CustomerFilesPage() {
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const t = (a: string, e: string) => (ar ? a : e);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const load = () => api.get<{ rows: Row[] }>('/api/customer-hub/files').then((d) => { setRows(d.rows); setError(''); }).catch((e) => { setError(e?.message || 'Error'); setRows([]); });
  useEffect(() => { load(); }, []);
  useSocket('customers:changed', load);
  const shown = useMemo(() => { const f = fold(q); return (rows || []).filter((r) => !f || fold(`${r.name} ${r.code} ${r.phone} ${r.city}`).includes(f)); }, [rows, q]);
  if (!rows) return <Spinner />;
  const cols = [
    { header: t('العميل', 'Customer'), key: 'name', width: 36 }, { header: t('الكود', 'Code'), key: 'code', width: 14 },
    { header: t('الجوال', 'Phone'), key: 'phone', width: 16 }, { header: t('المدينة', 'City'), key: 'city', width: 16 },
  ];
  const L = exportScopeLabels(ar);
  return (
    <div className="space-y-4" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader icon={<FolderSearch className="w-6 h-6 text-[#f37121]" />} title={t('ملفات العملاء الشاملة', 'Complete customer files')}
        subtitle={t('كلّ عميلٍ بملفٍّ واحد يجمع شحناته وتخليصه وتحصيله وعقده وطلباته من كلّ الأقسام.', 'One file per customer with shipments, customs, collections, contract and requests from every section.')}>
        <ExportMenu fileName={t('العملاء', 'Customers')} lang={lang} options={[
          { key: 'shown', label: L.shown, sheets: [{ name: t('العملاء', 'Customers'), rows: shown, columns: cols }] },
          { key: 'all', label: L.all, sheets: [{ name: t('العملاء', 'Customers'), rows, columns: cols }] },
        ]} />
      </PageHeader>
      {error && <ErrorNotice error={error} lang={ar ? "ar" : "en"} />}
      <div className="flex flex-wrap items-center gap-3">
        <div className="w-full max-w-md"><SearchInput value={q} onChange={setQ} placeholder={t('ابحث بالاسم أو الكود أو الجوال', 'Search name, code or phone')} /></div>
        <span className="text-[13px] text-slate-500 tabular-nums">{shown.length.toLocaleString('en-US')} {t('عميل', 'customers')}</span>
      </div>
      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <ScrollX>
          <table className="w-full text-sm">
            <thead><tr>
              <th className="px-3 py-2.5 text-start font-semibold">{t('العميل', 'Customer')}</th>
              <th className="px-3 py-2.5 text-start font-semibold">{t('الكود', 'Code')}</th>
              <th className="px-3 py-2.5 text-start font-semibold">{t('الجوال', 'Phone')}</th>
              <th className="px-3 py-2.5 text-start font-semibold">{t('المدينة', 'City')}</th>
            </tr></thead>
            <tbody className="divide-y divide-slate-100">
              {shown.slice(0, 500).map((r) => (
                <tr key={r._id} className="hover:bg-orange-50/40">
                  <td className="px-3 py-2"><Link href={`/system/customers/${r._id}`} className="font-semibold text-slate-900 hover:text-[#c2410c]">{r.name}</Link></td>
                  <td className="px-3 py-2 tabular-nums">{r.code || '—'}</td>
                  <td className="px-3 py-2 tabular-nums" dir="ltr">{r.phone || '—'}</td>
                  <td className="px-3 py-2">{r.city || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollX>
        {shown.length > 500 && <p className="border-t border-slate-100 px-3 py-2 text-[12px] text-slate-500">{t('ابحث لتضييق النتائج؛ يظهر أوّل 500.', 'Search to narrow; first 500 shown.')}</p>}
      </div>
    </div>
  );
}
