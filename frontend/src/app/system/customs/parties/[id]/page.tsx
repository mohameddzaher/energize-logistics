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
import { useColumnFilters, ClearColumnFilters } from '@/components/useColumnFilters';
import { Spinner, PageHeader } from '@/components/hr/HRKit';
import ExportMenu, { type ExportColumn } from '@/components/ls2/ExportMenu';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from 'recharts';
import { Users, Ship, Mail, Phone, MapPin, FileText, ArrowRight } from 'lucide-react';
import ScrollX from '@/components/system/ScrollX';
import PartyAttachments from '@/components/customs/PartyAttachments';
import CustomsContracts from '@/components/customs/CustomsContracts';
import { useAuth } from '@/context/AuthContext';
import { canEditSection } from '@/lib/sections';
import ClearanceTasks from '@/components/customs/ClearanceTasks';
import { getCustomsTranslations } from '@/lib/translations';
import { stageName } from '@/lib/customsPipeline';

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
  const { user } = useAuth();
  const canEdit = ['super_admin', 'admin', 'operations_manager', 'customs_manager', 'customs_officer']
    .includes((user as any)?.role || '') || canEditSection((user as any)?.permissions, 'Customs');

  const [d, setD] = useState<any>(null);
  const cf = useColumnFilters<any>();
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
  // الربحُ والهامش للإدارة وحدَها — الخادمُ لا يرسلهما لغيرها (`money`).
  const seesMoney = !!d.money;
  const stageText = (c: any) => (c.cancelled ? t('ملغاة', 'Cancelled') : c.isCompleted ? t('مغلقة', 'Closed') : stageName(getCustomsTranslations(lang).stages, c.pipeline?.next || c.stage, c.cargoType));
  const isAgent = p.kind === 'agent';

  const Stat = ({ label, value, accent, hint }: { label: string; value: any; accent?: string; hint?: string }) => (
    // البطاقةُ لا تنكمش تحت محتواها والرقمُ لا يُلَفّ — فيُمنَع الفيضُ صراحةً.
    <div className="min-w-0 bg-white border border-slate-200 rounded-xl px-3 sm:px-4 py-3 shadow-sm overflow-hidden">
      <p className="text-[11px] text-slate-500 truncate" title={label}>{label}</p>
      <p className={`text-base sm:text-lg lg:text-xl font-bold tabular-nums truncate ${accent || 'text-slate-900'}`} title={String(value)}>{value}</p>
      {hint && <p className="text-[10px] text-slate-400 mt-0.5 truncate" title={hint}>{hint}</p>}
    </div>
  );

  // فلاترُ أعمدة جدول المعاملات — على طريقة إكسل.
  const dealGetters: Record<string, (c: any) => any> = {
    ref: (c) => c.refNumber, bl: (c) => c.blNumber, other: (c) => (isAgent ? c.customerName : c.shippingAgent),
    port: (c) => c.port, stage: (c) => stageText(c), units: (c) => c.containerCount || 0, month: (c) => String(c.createdAt || '').slice(0, 7),
  };
  const deals: any[] = cf.apply(d.deals || [], dealGetters);
  const dealCols: ExportColumn[] = [
    { header: t('المرجع', 'Ref'), key: 'refNumber', width: 14 },
    { header: t('البوليصة', 'BL'), key: 'blNumber', width: 18 },
    { header: isAgent ? t('العميل', 'Customer') : t('وكيل الشحن', 'Agent'), key: isAgent ? 'customerName' : 'shippingAgent', width: 22 },
    { header: t('الميناء', 'Port'), key: 'port', width: 12 },
    { header: t('المرحلة', 'Stage'), key: 'stage', width: 30, transform: (_v: any, r: any) => stageText(r) },
    { header: t('حاويات', 'Containers'), key: 'containerCount', width: 10 },
    { header: t('الإيراد', 'Revenue'), key: 'revenue.totalInvoiced', width: 14 },
    { header: t('التكلفة', 'Cost'), key: 'costs.total', width: 14 },
    ...(seesMoney ? [{ header: t('الربح', 'Profit'), key: 'revenue.profit', width: 14 }] : []),
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
        subtitle={isAgent ? t('وكيل شحن', 'Shipping agent') : p.kind === 'carrier' ? t('ناقل', 'Carrier') : t('عميل تخليص', 'Customs customer')}>
        <button type="button" onClick={() => router.push(isAgent ? '/system/customs/agents' : p.kind === 'carrier' ? '/system/customs/carriers' : '/system/customs/customers')}
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

      {/* مرفقاتُ الطرف — سجلُّه وشهادتُه وعقدُه؛ تُقرأ كذلك من كلّ معاملةٍ هو طرفٌ فيها. */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
        <p className="text-sm font-bold text-slate-800 mb-2">{t('المرفقات', 'Attachments')}</p>
        <PartyAttachments partyId={p._id} items={p.attachments || []} canEdit={canEdit} ar={ar}
          onChanged={(items) => setD((x: any) => ({ ...x, party: { ...x.party, attachments: items } }))} />
      </div>

      <div className={`grid grid-cols-2 sm:grid-cols-4 gap-3 ${seesMoney ? 'lg:grid-cols-7' : 'lg:grid-cols-5'}`}>
        <Stat label={t('معاملات', 'Deals')} value={money(T.deals)} hint={T.cancelled ? t(`${T.cancelled} ملغاة`, `${T.cancelled} cancelled`) : undefined} />
        <Stat label={t('حاويات', 'Containers')} value={money(T.containers)} />
        <Stat label={t('الإيراد', 'Revenue')} value={money(T.revenue)} accent="text-emerald-600" />
        <Stat label={t('التكلفة', 'Cost')} value={money(T.cost)} accent="text-slate-700" />
        {seesMoney && <Stat label={t('الربح', 'Profit')} value={money(T.profit)} accent={T.profit >= 0 ? 'text-emerald-600' : 'text-red-600'} />}
        {seesMoney && <Stat label={t('الهامش', 'Margin')} value={`${T.margin}%`} accent={T.margin >= 0 ? 'text-emerald-600' : 'text-red-600'} />}
        {/* «لم تُفوتَر» أوّلُ ما يُسأل عنه في ملفّ عميل. */}
        <Stat label={t('لم تُفوتَر', 'Uninvoiced')} value={money(T.uninvoiced)} accent={T.uninvoiced ? 'text-amber-600' : undefined} />
      </div>

      <div className={`grid grid-cols-2 gap-3 ${seesMoney ? 'sm:grid-cols-4' : 'sm:grid-cols-3'}`}>
        {seesMoney && <Stat label={t('متوسط الربح للمعاملة', 'Avg profit / deal')} value={money(T.avgProfit)} />}
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
                {seesMoney && <Bar dataKey="profit" name={t('الربح', 'Profit')} fill="#f37121" radius={[3, 3, 0, 0]} />}
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
            <FileText className="w-4 h-4 text-slate-400" /> {t('كلّ المعاملات', 'All deals')} ({deals.length !== d.deals.length ? `${deals.length} / ` : ''}{d.deals.length})
          </p>
          <ExportMenu fileName={`customs-${p.name}`} lang={ar ? 'ar' : 'en'}
            options={[{ key: 'all', label: t('كل المعاملات', 'All deals'), sheets: [{ name: t('معاملات', 'Deals'), rows: deals, columns: dealCols }] }]} />
          <ClearColumnFilters count={cf.count} onClear={cf.clear} ar={ar} />
        </div>
        <ScrollX className="max-h-[32rem]">
          <table className="w-full text-sm">
            <thead className="table-head sticky top-0">
              <tr>
                {([[t('رقم المعاملة', 'Transaction no.'), 'ref'], [t('البوليصة', 'BL'), 'bl'], [isAgent ? t('العميل', 'Customer') : t('الوكيل', 'Agent'), 'other'],
                  [t('الميناء', 'Port'), 'port'], [t('المرحلة', 'Stage'), 'stage'], [t('حاويات', 'Cntrs'), 'units'], [t('الإيراد', 'Revenue'), ''],
                  [t('التكلفة', 'Cost'), ''], ...(seesMoney ? [[t('الربح', 'Profit'), '']] : []), [t('التاريخ', 'Date'), 'month']] as [string, string][]).map(([h, k], i) => (
                  <th key={i} className="px-3 py-2.5 text-start font-semibold whitespace-nowrap">
                    <span className="inline-flex items-center gap-1">{h}{k ? cf.header(k, d.deals || [], dealGetters[k], ar) : null}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {deals.map((c: any) => (
                <tr key={c._id} className={`border-b border-slate-100 hover:bg-slate-50 cursor-pointer ${c.cancelled ? 'opacity-50 line-through' : ''}`}
                  onClick={() => router.push(`/system/customs/${c._id}`)}>
                  <td className="px-3 py-2.5 font-mono font-semibold text-slate-900 whitespace-nowrap">{c.refNumber || '—'}</td>
                  <td className="px-3 py-2.5 font-mono text-slate-600 whitespace-nowrap">{c.blNumber || '—'}</td>
                  <td className="px-3 py-2.5 text-slate-700 max-w-[180px] truncate">{isAgent ? c.customerName : c.shippingAgent}</td>
                  <td className="px-3 py-2.5 text-slate-600">{c.port || '—'}</td>
                  <td className="px-3 py-2.5 text-slate-600 whitespace-nowrap max-w-[16rem] truncate">{stageText(c)}</td>
                  <td className="px-3 py-2.5 tabular-nums">{c.containerCount || 0}</td>
                  <td className="px-3 py-2.5 tabular-nums text-emerald-700">{money(c.revenue?.totalInvoiced)}</td>
                  <td className="px-3 py-2.5 tabular-nums text-slate-600">{money(c.costs?.total)}</td>
                  {seesMoney && <td className={`px-3 py-2.5 tabular-nums font-semibold ${(c.revenue?.profit || 0) >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>{money(c.revenue?.profit)}</td>}
                  <td className="px-3 py-2.5 text-slate-500 whitespace-nowrap">{dt(c.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollX>
      </div>

      {/* عقودُنا معه — تُقرأ في ملفّه، والمصدرُ صفحةُ العقود نفسُها. */}
      <CustomsContracts ar={ar} canEdit={canEdit} party={{ _id: p._id, name: p.name, kind: p.kind }} notify={notify} embedded />

      {/* مهامُّ خطّة العمل (JP) المربوطةُ بهذا الطرف. */}
      <ClearanceTasks kind={p.kind} refId={String(p._id)} ar={ar} />
    </div>
  );
}