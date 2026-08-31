'use client';
// ملفُّ طرفٍ في التخليص — عميلٍ أو وكيلِ شحن.
//
// «كم اشتغلنا معه وكم حقّقنا» سؤالٌ كان جوابُه تصديرَ الجدول كلِّه وفلترتَه في
// إكسل. وهو هنا: أرقامُه، ونموُّه بالشهر، ومع مَن يعمل، وكلُّ معاملاته بتفاصيلها.
import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useLanguage } from '@/context/LanguageContext';
import { useDialog } from '@/components/system/DialogProvider';
import api from '@/lib/api';
import { Spinner, PageHeader } from '@/components/hr/HRKit';
import ExportMenu, { type ExportColumn } from '@/components/ls2/ExportMenu';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from 'recharts';
import { Users, Ship, Mail, Phone, MapPin, FileText, ArrowRight } from 'lucide-react';

const money = (n?: number) => (Number(n) || 0).toLocaleString('en-US');
const dt = (v?: string | null) => (v ? new Date(v).toLocaleDateString('en-GB') : '—');

export default function CustomsPartyProfile() {
  const params = useParams();
  const id = (params as any)?.id as string;
  const router = useRouter();
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const t = (a: string, e: string) => (ar ? a : e);
  const { notify } = useDialog();

  const [d, setD] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try { setD(await api.get<any>(`/api/customs-clearance/parties/${id}`)); }
    catch (e: any) { notify(e?.message || t('تعذّر التحميل', 'Could not load'), 'error'); }
    setLoading(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  useEffect(() => { load(); }, [load]);

  if (loading) return <Spinner />;
  if (!d) return null;
  const p = d.party; const T = d.totals;
  const isAgent = p.kind === 'agent';

  const Stat = ({ label, value, accent, hint }: { label: string; value: any; accent?: string; hint?: string }) => (
    <div className="bg-white border border-slate-200 rounded-xl px-4 py-3 shadow-sm">
      <p className="text-[11px] text-slate-500">{label}</p>
      <p className={`text-xl font-bold tabular-nums ${accent || 'text-slate-900'}`}>{value}</p>
      {hint && <p className="text-[10px] text-slate-400 mt-0.5">{hint}</p>}
    </div>
  );

  const dealCols: ExportColumn[] = [
    { header: t('المرجع', 'Ref'), key: 'refNumber', width: 14 },
    { header: t('البوليصة', 'BL'), key: 'blNumber', width: 18 },
    { header: isAgent ? t('العميل', 'Customer') : t('وكيل الشحن', 'Agent'), key: isAgent ? 'customerName' : 'shippingAgent', width: 22 },
    { header: t('الميناء', 'Port'), key: 'port', width: 12 },
    { header: t('المرحلة', 'Stage'), key: 'stage', width: 18 },
    { header: t('حاويات', 'Containers'), key: 'containerCount', width: 10 },
    { header: t('الإيراد', 'Revenue'), key: 'revenue.totalInvoiced', width: 14 },
    { header: t('التكلفة', 'Cost'), key: 'costs.total', width: 14 },
    { header: t('الربح', 'Profit'), key: 'revenue.profit', width: 14 },
    { header: t('التاريخ', 'Date'), key: 'createdAt', width: 14, transform: (v: any) => dt(v) },
  ];

  const Bars = ({ title, rows }: { title: string; rows: { name: string; n: number }[] }) => (
    !rows?.length ? null : (
      <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
        <p className="text-sm font-bold text-slate-800 mb-2">{title}</p>
        <div className="space-y-1.5">
          {rows.map((r) => {
            const max = Math.max(...rows.map((x) => x.n)) || 1;
            return (
              <div key={r.name} className="flex items-center gap-2">
                <span className="text-xs text-slate-600 w-40 truncate" title={r.name}>{r.name}</span>
                <div className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden">
                  <div className="h-full bg-[#f37121]" style={{ width: `${(r.n / max) * 100}%` }} />
                </div>
                <span className="text-xs tabular-nums text-slate-500 w-8 text-end">{r.n}</span>
              </div>
            );
          })}
        </div>
      </div>
    )
  );

  return (
    <div className="space-y-4 pb-10" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader icon={isAgent ? <Ship className="w-6 h-6 text-[#f37121]" /> : <Users className="w-6 h-6 text-[#f37121]" />}
        title={p.name}
        subtitle={isAgent ? t('وكيل شحن', 'Shipping agent') : t('عميل تخليص', 'Customs customer')}>
        <button type="button" onClick={() => router.push(isAgent ? '/system/customs/agents' : '/system/customs/customers')}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm">
          <ArrowRight className="w-4 h-4" /> {t('رجوع', 'Back')}
        </button>
      </PageHeader>

      {/* بياناتُ التواصل — تُقرأ وتُضغط، لا تُنسَخ باليد. */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
        {p.email && <a href={`mailto:${p.email}`} className="inline-flex items-center gap-1.5 text-slate-700 hover:text-[#f37121]"><Mail className="w-4 h-4" />{p.email}</a>}
        {p.phone && <a href={`tel:${p.phone}`} className="inline-flex items-center gap-1.5 text-slate-700 hover:text-[#f37121]"><Phone className="w-4 h-4" />{p.phone}</a>}
        {p.contactPerson && <span className="text-slate-600">{t('المسؤول', 'Contact')}: <b>{p.contactPerson}</b></span>}
        {p.city && <span className="inline-flex items-center gap-1.5 text-slate-600"><MapPin className="w-4 h-4" />{p.city}</span>}
        {p.commercialRegister && <span className="text-slate-600">{t('السجل التجاري', 'CR')}: <b className="font-mono">{p.commercialRegister}</b></span>}
        {p.taxNumber && <span className="text-slate-600">{t('الرقم الضريبي', 'Tax')}: <b className="font-mono">{p.taxNumber}</b></span>}
        {!p.email && !p.phone && <span className="text-slate-400">{t('لا بيانات تواصل مسجَّلة', 'No contact details recorded')}</span>}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
        <Stat label={t('معاملات', 'Deals')} value={money(T.deals)} hint={T.cancelled ? t(`${T.cancelled} ملغاة`, `${T.cancelled} cancelled`) : undefined} />
        <Stat label={t('حاويات', 'Containers')} value={money(T.containers)} />
        <Stat label={t('الإيراد', 'Revenue')} value={money(T.revenue)} accent="text-emerald-600" />
        <Stat label={t('التكلفة', 'Cost')} value={money(T.cost)} accent="text-slate-700" />
        <Stat label={t('الربح', 'Profit')} value={money(T.profit)} accent={T.profit >= 0 ? 'text-emerald-600' : 'text-red-600'} />
        <Stat label={t('الهامش', 'Margin')} value={`${T.margin}%`} accent={T.margin >= 0 ? 'text-emerald-600' : 'text-red-600'} />
        {/* «لم تُفوتَر» أوّلُ ما يُسأل عنه في ملفّ عميل. */}
        <Stat label={t('لم تُفوتَر', 'Uninvoiced')} value={money(T.uninvoiced)} accent={T.uninvoiced ? 'text-amber-600' : undefined} />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat label={t('متوسط الربح للمعاملة', 'Avg profit / deal')} value={money(T.avgProfit)} />
        <Stat label={t('إجمالي الوزن', 'Total weight')} value={money(T.weight)} />
        <Stat label={t('أول معاملة', 'First deal')} value={dt(T.firstDealAt)} />
        <Stat label={t('آخر معاملة', 'Last deal')} value={dt(T.lastDealAt)} />
      </div>

      {d.byMonth?.length > 1 && (
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
          <p className="text-sm font-bold text-slate-800 mb-3">{t('بالشهر', 'By month')}</p>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={d.byMonth}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="key" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v: any) => money(v as number)} />
                <Legend />
                <Bar dataKey="revenue" name={t('الإيراد', 'Revenue')} fill="#10b981" radius={[3, 3, 0, 0]} />
                <Bar dataKey="profit" name={t('الربح', 'Profit')} fill="#f37121" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <Bars title={t('حسب المرحلة', 'By stage')} rows={d.byStage} />
        <Bars title={t('حسب الميناء', 'By port')} rows={d.byPort} />
        <Bars title={isAgent ? t('أكثر العملاء معه', 'Top customers') : t('أكثر الوكلاء معه', 'Top agents')} rows={d.byCounterparty} />
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
        <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
          <p className="text-sm font-bold text-slate-800 flex items-center gap-2">
            <FileText className="w-4 h-4 text-slate-400" /> {t('كلّ المعاملات', 'All deals')} ({d.deals.length})
          </p>
          <ExportMenu fileName={`customs-${p.name}`} lang={ar ? 'ar' : 'en'}
            options={[{ key: 'all', label: t('كل المعاملات', 'All deals'), sheets: [{ name: t('معاملات', 'Deals'), rows: d.deals, columns: dealCols }] }]} />
        </div>
        <div className="overflow-x-auto max-h-[32rem]">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs sticky top-0">
              <tr>
                {[t('المرجع', 'Ref'), t('البوليصة', 'BL'), isAgent ? t('العميل', 'Customer') : t('الوكيل', 'Agent'),
                  t('الميناء', 'Port'), t('المرحلة', 'Stage'), t('حاويات', 'Cntrs'), t('الإيراد', 'Revenue'),
                  t('التكلفة', 'Cost'), t('الربح', 'Profit'), t('التاريخ', 'Date')].map((h, i) => (
                  <th key={i} className="px-3 py-2.5 text-start font-semibold whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {d.deals.map((c: any) => (
                <tr key={c._id} className={`border-b border-slate-100 hover:bg-slate-50 cursor-pointer ${c.cancelled ? 'opacity-50 line-through' : ''}`}
                  onClick={() => router.push(`/system/customs/${c._id}`)}>
                  <td className="px-3 py-2.5 font-mono font-semibold text-slate-900 whitespace-nowrap">{c.refNumber || '—'}</td>
                  <td className="px-3 py-2.5 font-mono text-slate-600 whitespace-nowrap">{c.blNumber || '—'}</td>
                  <td className="px-3 py-2.5 text-slate-700 max-w-[180px] truncate">{isAgent ? c.customerName : c.shippingAgent}</td>
                  <td className="px-3 py-2.5 text-slate-600">{c.port || '—'}</td>
                  <td className="px-3 py-2.5 text-slate-600 whitespace-nowrap">{c.stage || '—'}</td>
                  <td className="px-3 py-2.5 tabular-nums">{c.containerCount || 0}</td>
                  <td className="px-3 py-2.5 tabular-nums text-emerald-700">{money(c.revenue?.totalInvoiced)}</td>
                  <td className="px-3 py-2.5 tabular-nums text-slate-600">{money(c.costs?.total)}</td>
                  <td className={`px-3 py-2.5 tabular-nums font-semibold ${(c.revenue?.profit || 0) >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>{money(c.revenue?.profit)}</td>
                  <td className="px-3 py-2.5 text-slate-500 whitespace-nowrap">{dt(c.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
