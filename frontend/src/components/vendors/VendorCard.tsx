'use client';
/**
 * A carrier's card: its file (what the team knows), how it works for us this year (from the shipments), the team's
 * follow-ups with it, its trucks and drivers, and the other names it is written under. `id` for a registered carrier,
 * `name` for one seen only in shipments (which can be registered from here).
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useDialog } from '@/components/system/DialogProvider';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import { Spinner, ErrorNotice, Modal, Field, TextInput, TextArea } from '@/components/hr/HRKit';
import SearchableManagedSelect from '@/components/system/SearchableManagedSelect';
import { Kpi, Panel, BarList, DataGrid, Grade, TrendChip, fmtInt, fmtMoney, fmtDay, fmtPct, ORANGE } from '@/components/analytics/AnalyticsKit';
import { KIND, kindLabel, contractTone, monthName, canEditVendors, CHANNELS, isVendorLead } from '@/lib/vendors';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import { ArrowRight, Pencil, Phone, MessageCircle, Plus, Trash2, AlertTriangle, Truck, UserRound, Tags, CalendarClock, Building2 } from 'lucide-react';

type Row = Record<string, any>;
const FILE: [string, string, string, ('text' | 'number' | 'bool' | 'textarea' | 'owner' | 'contract' | 'tax' | 'type')?][] = [
  ['name', 'الاسم', 'Name'], ['type', 'النوع', 'Type', 'type'], ['masterNo', 'رقم الماستر', 'Master no.', 'number'], ['followOwner', 'مسؤول المتابعة', 'Follow-up owner', 'owner'],
  ['contractStatus', 'حالة التعاقد', 'Contract status', 'contract'], ['contractDate', 'تاريخ التعاقد', 'Contract date'], ['vendorSigned', 'عقد طرف المورد', 'Signed by carrier', 'bool'], ['ourSigned', 'عقد طرفنا', 'Signed by us', 'bool'],
  ['hasPapers', 'الأوراق مكتملة', 'Papers complete', 'bool'], ['taxClass', 'التصنيف الضريبي', 'Tax classification', 'tax'], ['financeCode', 'كود المورد (المالية)', 'Finance code'], ['paymentTermDays', 'مدّة السداد (يوم)', 'Payment term (days)', 'number'],
  ['representative', 'ممثّل المورد', 'Representative'], ['phone', 'الجوال', 'Phone'], ['email', 'البريد', 'Email'], ['energizeRep', 'مندوب تنشيط', 'Our rep'],
  ['headOffice', 'المقرّ الرئيسي', 'Head office'], ['destinations', 'الوجهات', 'Destinations'], ['vehicleTypes', 'نوع السيارات', 'Truck types'], ['fleetSize', 'عدد السيارات', 'Fleet size', 'number'],
  ['commercialRegister', 'السجلّ التجاري', 'Commercial register'], ['taxCard', 'الرقم الضريبي', 'Tax number'], ['iban', 'الآيبان', 'IBAN'], ['bankName', 'البنك', 'Bank'],
  ['leadPriority', 'أولويّة المتابعة', 'Follow-up priority'], ['previousName', 'الاسم السابق في الماستر', 'Previous master name'], ['rating', 'تقييم الفريق (1-5)', 'Team rating (1-5)', 'number'], ['ratingNote', 'ملاحظة التقييم', 'Rating note'],
  ['notes', 'ملاحظات', 'Notes', 'textarea'],
];

export default function VendorCard({ id, name }: { id?: string; name?: string }) {
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const t = (a: string, e: string) => (ar ? a : e);
  const router = useRouter();
  const { notify, confirm } = useDialog();
  const [d, setD] = useState<Row | null>(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<'activity' | 'file' | 'follow' | 'fleet' | 'names'>('activity');
  const [editing, setEditing] = useState<Row | null>(null);
  const [follow, setFollow] = useState<Row | null>(null);
  const [owners, setOwners] = useState<string[]>([]);
  const editor = canEditVendors(user);

  const load = useCallback(async () => {
    try {
      const r = await api.get<Row>(id ? `/api/vendors-mgmt/vendors/${id}` : `/api/vendors-mgmt/vendors/by-name?name=${encodeURIComponent(name || '')}`);
      if (r.redirect) { router.replace(`/system/vendors-mgmt/vendors/${r.redirect}`); return; }
      setD(r); setError('');
    } catch (e: any) { setError(e?.message || t('تعذّر التحميل', 'Could not load')); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, name]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { api.get<{ team: { owners: string[] } }>('/api/vendors-mgmt/settings').then((r) => setOwners(r.team?.owners || [])).catch(() => {}); }, []);
  const timer = useRef<any>(null);
  const soon = useCallback(() => { clearTimeout(timer.current); timer.current = setTimeout(load, 800); }, [load]);
  useSocket('vendors:changed', soon);
  useSocket('shipmentOrders:updated', soon);
  useSocket('shipmentOrders:fleet', soon);

  if (!d && !error) return <Spinner />;
  if (!d) return <ErrorNotice error={error} onRetry={load} lang={ar ? 'ar' : 'en'} />;
  const v = d.vendor;
  const A = d.activity;
  const money = A.buy != null;
  const cm = d.curMonth || (new Date().getMonth() + 1);
  const monthly = (A.mon || []).slice(0, cm).map((n: number, i: number) => ({ name: monthName(i + 1, ar), trips: n, buy: A.monBuy?.[i] }));

  const saveFile = async () => {
    try {
      if (v.unregistered) {
        const r = await api.post<{ vendor: Row }>('/api/vendors-mgmt/vendors', { ...editing, aliases: d.names || [] });
        notify(t('سُجّل المورّد', 'Carrier registered'), 'success');
        router.replace(`/system/vendors-mgmt/vendors/${r.vendor._id}`);
      } else {
        await api.put(`/api/vendors-mgmt/vendors/${v._id}`, editing);
        notify(t('حُفظ الملف', 'Saved'), 'success'); load();
      }
      setEditing(null);
    } catch (e: any) { notify(e?.message || t('تعذّر الحفظ', 'Could not save'), 'error'); }
  };
  const saveFollow = async () => {
    try { await api.post(`/api/vendors-mgmt/vendors/${v._id}/follow-ups`, follow); notify(t('سُجّلت المتابعة', 'Follow-up saved'), 'success'); setFollow(null); load(); }
    catch (e: any) { notify(e?.message || t('تعذّر الحفظ', 'Could not save'), 'error'); }
  };
  const delFollow = async (f: Row) => {
    if (!(await confirm({ title: t('حذف المتابعة', 'Delete follow-up'), message: t('تُحذف هذه المتابعة من سجلّ المورّد.', 'This follow-up is deleted.'), tone: 'danger' }))) return;
    try { await api.delete(`/api/vendors-mgmt/follow-ups/${f._id}`); load(); } catch (e: any) { notify(e?.message || t('تعذّر الحذف', 'Could not delete'), 'error'); }
  };

  return (
    <div className="space-y-4 pb-10" dir={isRTL ? 'rtl' : 'ltr'}>
      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-4">
        <div className="flex flex-wrap items-start gap-3">
          <button type="button" onClick={() => router.push('/system/vendors-mgmt/vendors')} className="p-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600"><ArrowRight className={`w-4 h-4 ${isRTL ? '' : 'rotate-180'}`} /></button>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-extrabold text-slate-900">{v.name}</h1>
              {v.kind && <span className={`px-2 py-0.5 rounded-full border text-[11.5px] font-semibold ${KIND[v.kind]?.cls}`}>{kindLabel(v.kind, ar)}</span>}
              {v.unregistered && <span className="px-2 py-0.5 rounded-full border border-red-200 bg-red-50 text-red-700 text-[11.5px] font-semibold">{t('غير مسجّل في السجلّ', 'Not in the register')}</span>}
              {v.inMaster && <span className="px-2 py-0.5 rounded-full border border-emerald-200 bg-emerald-50 text-emerald-700 text-[11.5px] font-semibold">{t(`ضمن الماستر${v.masterNo ? ` · رقم ${v.masterNo}` : ''}`, `On the master${v.masterNo ? ` · #${v.masterNo}` : ''}`)}</span>}
              {v.contractStatus && <span className={`px-2 py-0.5 rounded-full border text-[11.5px] ${contractTone(v.contractStatus)}`}>{t('العقد', 'Contract')}: {v.contractStatus}</span>}
              {d.trend && <TrendChip t={d.trend} ar={ar} />}
            </div>
            <p className="mt-1 text-[12.5px] text-slate-600 flex flex-wrap gap-x-4 gap-y-1">
              {v.followOwner && <span>{t('مسؤول المتابعة', 'Owner')}: <b>{v.followOwner}</b></span>}
              {v.representative && <span>{t('الممثّل', 'Representative')}: {v.representative}</span>}
              {v.headOffice && <span className="inline-flex items-center gap-1"><Building2 className="w-3.5 h-3.5" />{v.headOffice}</span>}
              {v.vehicleTypes && <span className="inline-flex items-center gap-1"><Truck className="w-3.5 h-3.5" />{v.vehicleTypes}{v.fleetSize ? ` · ${v.fleetSize}` : ''}</span>}
              {v.lastFollowUpAt && <span className="inline-flex items-center gap-1"><CalendarClock className="w-3.5 h-3.5" />{t('آخر متابعة', 'Last follow-up')} {fmtDay(v.lastFollowUpAt)}</span>}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {d.grade && <div className="text-center"><Grade g={d.grade} score={d.score} /><p className="text-[10.5px] text-slate-500 mt-0.5">{t('تقييم المورّد', 'Score')}</p></div>}
            {v.phone && <a href={`tel:${v.phone}`} className="p-2 rounded-lg border border-slate-200 text-slate-600 hover:text-[#f37121]"><Phone className="w-4 h-4" /></a>}
            {v.phone && <a href={`https://wa.me/${String(v.phone).replace(/\D/g, '').replace(/^0/, '966')}`} target="_blank" rel="noreferrer" className="p-2 rounded-lg border border-slate-200 text-emerald-600 hover:bg-emerald-50"><MessageCircle className="w-4 h-4" /></a>}
            {editor && !v.unregistered && <button type="button" onClick={() => setFollow({ channel: 'call', outcome: '', note: '', contractStatus: '', nextAt: '' })} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-900 text-white text-sm font-semibold"><Plus className="w-4 h-4" />{t('متابعة', 'Follow-up')}</button>}
            {editor && <button type="button" onClick={() => setEditing(Object.fromEntries(FILE.map(([k]) => [k, v[k] ?? (k === 'type' ? 'company' : '')])))} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#f37121] text-white text-sm font-semibold"><Pencil className="w-4 h-4" />{v.unregistered ? t('تسجيله في السجلّ', 'Register it') : t('تعديل الملف', 'Edit file')}</button>}
          </div>
        </div>
        {d.missing?.length > 0 && (
          <div className="mt-3 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-800">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>{t(`الملف مكتمل ${d.completeness}% — ينقصه: `, `File ${d.completeness}% complete — missing: `)}{d.missing.map((m: Row) => m.label).join('، ')}</span>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <Kpi ar={ar} label={t('رحلاتٌ محقّقة هذا العام', 'Trips this year')} value={fmtInt(A.trips)} tone="brand" />
        <Kpi ar={ar} label={t(`رحلات ${monthName(cm, true)}`, `Trips in ${monthName(cm, false)}`)} value={fmtInt(A.mon?.[cm - 1])} />
        {money && <Kpi ar={ar} label={t('إجمالي الشراء', 'Total purchase')} value={fmtMoney(A.buy)} />}
        {money && <Kpi ar={ar} label={t('متوسط سعر الرحلة', 'Avg trip price')} value={fmtMoney(A.avg)} />}
        <Kpi ar={ar} label={t('أوّل رحلة · آخر رحلة', 'First · last trip')} value={<span className="text-[15px]">{fmtDay(A.first)} · {fmtDay(A.last)}</span>} />
        <Kpi ar={ar} label={t('ملغاة', 'Cancelled')} value={fmtInt(A.cancelled)} tone={A.cancelled ? 'warn' : 'muted'} />
      </div>

      <div className="flex flex-wrap gap-1 rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
        {([['activity', 'النشاط والأسعار', 'Activity & prices'], ['file', 'الملف', 'File'], ['follow', `المتابعات (${(d.followUps || []).length})`, `Follow-ups (${(d.followUps || []).length})`], ['fleet', `السيارات والسائقون (${(d.vehicles || []).length}/${(d.drivers || []).length})`, `Trucks & drivers`], ['names', `الأسماء على النظام (${(d.names || []).length})`, `Names (${(d.names || []).length})`]] as const).map(([k, a, e]) => (
          <button key={k} type="button" onClick={() => setTab(k)} className={`px-3 py-1.5 rounded-lg text-[13px] font-semibold ${tab === k ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>{ar ? a : e}</button>
        ))}
      </div>

      {tab === 'activity' && (
        <div className="space-y-4">
          <Panel title={t('الرحلات كلّ شهر', 'Trips per month')} subtitle={t('الشهر الحالي باللون البرتقالي', 'Current month in orange')}>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={monthly}><CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" /><XAxis dataKey="name" tick={{ fontSize: 11 }} /><YAxis tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(val: any, n: any) => [fmtInt(Number(val)), n]} />
                  <Bar dataKey="trips" name={t('رحلات', 'Trips')} radius={[6, 6, 0, 0]} fill="#94a3b8" shape={(p: any) => <rect x={p.x} y={p.y} width={p.width} height={p.height} rx={5} fill={p.index === cm - 1 ? ORANGE : '#94a3b8'} />} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Panel>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <Panel title={t('حسب الفرع', 'By branch')}><BarList ar={ar} rows={A.branches.map((b: Row) => ({ key: b.name, label: b.name, value: b.trips, hint: fmtPct(b.share) }))} /></Panel>
            <Panel title={t('مناديب التشغيل المتعاملون', 'Operations reps dealing')}><BarList ar={ar} rows={A.opsReps.map((b: Row) => ({ key: b.name, label: b.name, value: b.trips, hint: fmtPct(b.share) }))} color="#8b5cf6" /></Panel>
            <Panel title={t('أهمّ العملاء', 'Top customers')}><BarList ar={ar} rows={A.customers.map((b: Row) => ({ key: b.name, label: b.name, value: b.trips, hint: fmtPct(b.share) }))} color="#0ea5e9" /></Panel>
          </div>
          <Panel title={t('المسارات وأسعارها', 'Routes and prices')} subtitle={money ? t('سعر شراء الرحلة مقابل القائمة المعتمدة (A/B/C) · الأحمر = آخر سعرٍ أعلى من الفئة A', 'Trip purchase price vs the approved list · red = last price above tier A') : undefined} pad={false}>
            <DataGrid ar={ar} rows={A.routes} rowKey={(r) => r.route} cols={[
              { key: 'route', label: t('المسار', 'Route'), render: (r) => <span className="font-semibold">{r.route}</span> },
              { key: 'trips', label: t('رحلات', 'Trips'), num: true },
              ...(money ? [
                { key: 'min', label: t('أقلّ', 'Min'), num: true, render: (r: Row) => fmtMoney(r.min) },
                { key: 'avg', label: t('متوسط', 'Avg'), num: true, render: (r: Row) => fmtMoney(r.avg) },
                { key: 'max', label: t('أعلى', 'Max'), num: true, render: (r: Row) => fmtMoney(r.max) },
                { key: 'lastPrice', label: t('آخر سعر', 'Last'), num: true, render: (r: Row) => <span className={r.aboveA ? 'text-red-600 font-bold' : ''}>{fmtMoney(r.lastPrice)}</span> },
                { key: 'approved', label: t('المعتمد A / B / C', 'Approved A/B/C'), num: true, render: (r: Row) => (r.approved ? `${fmtMoney(r.approved.A)} / ${fmtMoney(r.approved.B)} / ${fmtMoney(r.approved.C)}` : <span className="text-slate-400">{t('غير مدرج', 'Not listed')}</span>) },
              ] : []),
              { key: 'last', label: t('آخر رحلة', 'Last trip'), render: (r) => fmtDay(r.last) },
            ]} />
          </Panel>
          <Panel title={t('آخر الرحلات', 'Latest trips')} subtitle={t('أحدث 25 سجلًّا', 'Latest 25')} pad={false}>
            <DataGrid ar={ar} rows={A.lastTrips} limit={25} rowKey={(r, i) => `${r.waybillNumber}-${i}`} cols={[
              { key: 'day', label: t('التاريخ', 'Date'), render: (r) => <span className="tabular-nums">{r.day}</span> },
              { key: 'waybillNumber', label: t('أمر النقل', 'Order'), render: (r) => <Link href={`/system/shipment-orders?q=${r.waybillNumber}`} className="font-mono text-[#f37121] hover:underline">{r.waybillNumber}</Link> },
              { key: 'branch', label: t('الفرع', 'Branch') }, { key: 'route', label: t('المسار', 'Route') }, { key: 'customer', label: t('العميل', 'Customer') },
              ...(money ? [{ key: 'price', label: t('سعر الرحلة', 'Price'), num: true, render: (r: Row) => fmtMoney(r.price) }] : []),
              { key: 'rep', label: t('مندوب التشغيل', 'Rep') }, { key: 'plate', label: t('اللوحة', 'Plate') }, { key: 'driver', label: t('السائق', 'Driver') },
              { key: 'name', label: t('الاسم على النظام', 'Name in system'), render: (r) => <span className="text-[11.5px] text-slate-500">{r.name}</span> },
            ]} />
          </Panel>
        </div>
      )}

      {tab === 'file' && (
        <Panel title={t('ملف المورّد', 'Carrier file')}>
          <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-3">
            {FILE.map(([k, a, e, kind]) => (
              <div key={k} className={kind === 'textarea' ? 'sm:col-span-2 lg:col-span-4' : ''}>
                <dt className="text-[11.5px] font-semibold text-slate-500">{ar ? a : e}</dt>
                <dd className="text-[13.5px] text-slate-900 mt-0.5 break-words">{kind === 'bool' ? (v[k] ? t('نعم', 'Yes') : t('لا', 'No')) : k === 'type' ? (v.type === 'freelancer' ? t('سائق فرد', 'Freelancer') : t('شركة / مؤسسة', 'Company')) : (v[k] ?? '') === '' || v[k] == null ? <span className="text-slate-300">—</span> : String(v[k])}</dd>
              </div>
            ))}
          </dl>
        </Panel>
      )}

      {tab === 'follow' && (
        <Panel title={t('سجلّ المتابعات', 'Follow-up log')} actions={editor && !v.unregistered ? <button type="button" onClick={() => setFollow({ channel: 'call', outcome: '', note: '', contractStatus: '', nextAt: '' })} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-slate-900 text-white text-[12.5px] font-semibold"><Plus className="w-3.5 h-3.5" />{t('متابعة جديدة', 'New')}</button> : null}>
          {!(d.followUps || []).length ? <p className="py-6 text-center text-sm text-slate-400">{t('لا متابعات مسجّلة بعد', 'No follow-ups yet')}</p> : (
            <ol className="relative border-s border-slate-200 ms-2 space-y-4">
              {d.followUps.map((f: Row) => (
                <li key={f._id} className="ms-4">
                  <span className="absolute -start-1.5 mt-1.5 w-3 h-3 rounded-full bg-[#f37121] border-2 border-white" />
                  <div className="flex flex-wrap items-center gap-2 text-[12px] text-slate-500">
                    <span className="tabular-nums">{fmtDay(f.at)}</span><span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-700">{(CHANNELS[f.channel] || CHANNELS.other)[ar ? 'ar' : 'en']}</span>
                    <span>{f.byName}</span>{f.source === 'import' && <span className="text-slate-400">{t('من الماستر شيت', 'from the master sheet')}</span>}
                    {f.contractStatus && <span className={`px-2 py-0.5 rounded-full border text-[11px] ${contractTone(f.contractStatus)}`}>{f.contractStatus}</span>}
                    {f.nextAt && <span className="text-amber-700">{t('المتابعة القادمة', 'Next')} {fmtDay(f.nextAt)}</span>}
                    {editor && (String(f.by) === String(user?._id) || isVendorLead(user)) && <button type="button" onClick={() => delFollow(f)} className="ms-auto text-slate-400 hover:text-red-600"><Trash2 className="w-3.5 h-3.5" /></button>}
                  </div>
                  {f.outcome && <p className="text-[13.5px] font-semibold text-slate-900 mt-0.5">{f.outcome}</p>}
                  {f.note && <p className="text-[13px] text-slate-700">{f.note}</p>}
                </li>
              ))}
            </ol>
          )}
        </Panel>
      )}

      {tab === 'fleet' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Panel title={t('سيارات المورّد في السجلّ', 'Registered trucks')} subtitle={t('ومن الشحنات: اللوحات الأكثر تشغيلًا هذا العام', 'Plus the most used plates this year')} pad={false}>
            <DataGrid ar={ar} rows={d.vehicles || []} rowKey={(r) => r._id} empty={t('لا سيارات مسجّلة — تُسجَّل من «السيارات» أو عند إكمال الشحنة', 'No trucks registered')} cols={[
              { key: 'plate', label: t('اللوحة', 'Plate'), render: (r) => <span className="font-semibold"><Truck className="inline w-3.5 h-3.5 me-1 text-slate-400" />{r.plate}</span> },
              { key: 'truckType', label: t('النوع', 'Type') }, { key: 'brand', label: t('الماركة', 'Make') }, { key: 'defaultDriverName', label: t('السائق المعتاد', 'Usual driver') },
              { key: 'operationCardExpiry', label: t('بطاقة التشغيل', 'Op. card'), render: (r) => r.operationCardExpiry || '—' },
            ]} />
            {!!A.plates?.length && <div className="p-4 border-t border-slate-100"><BarList ar={ar} rows={A.plates.map((p: Row) => ({ key: p.name, label: p.name, value: p.trips }))} limit={8} color="#64748b" /></div>}
          </Panel>
          <Panel title={t('سائقو المورّد', 'Carrier drivers')} pad={false}>
            <DataGrid ar={ar} rows={d.drivers || []} rowKey={(r) => r._id} empty={t('لا سائقين مسجّلين', 'No drivers registered')} cols={[
              { key: 'name', label: t('السائق', 'Driver'), render: (r) => <span className="font-semibold"><UserRound className="inline w-3.5 h-3.5 me-1 text-slate-400" />{r.name}</span> },
              { key: 'phone', label: t('الجوال', 'Phone') }, { key: 'nationality', label: t('الجنسية', 'Nationality') },
              { key: 'driverCardExpiry', label: t('بطاقة السائق', 'Driver card'), render: (r) => r.driverCardExpiry || '—' },
            ]} />
            {!!A.drivers?.length && <div className="p-4 border-t border-slate-100"><BarList ar={ar} rows={A.drivers.map((p: Row) => ({ key: p.name, label: p.name, value: p.trips }))} limit={8} color="#0ea5e9" /></div>}
          </Panel>
        </div>
      )}

      {tab === 'names' && (
        <Panel title={t('الأسماء التي يُكتب بها المورّد على النظام', 'Names the carrier is written under')} subtitle={t('كلّ اسمٍ هنا تُحسب شحناتُه لهذا المورّد · أضِف الأسماء من «تعديل الملف»', 'Every name here counts toward this carrier · add names from “Edit file”')}>
          <div className="flex flex-wrap gap-1.5">
            {[...(v.aliases || []), ...(d.names || []).filter((n: string) => !(v.aliases || []).includes(n))].map((n: string) => (
              <span key={n} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-[12.5px]"><Tags className="w-3.5 h-3.5 text-slate-400" />{n}</span>
            ))}
          </div>
        </Panel>
      )}

      {editing && (
        <Modal open wide onClose={() => setEditing(null)} title={v.unregistered ? t('تسجيل المورّد في السجلّ', 'Register the carrier') : t('تعديل ملف المورّد', 'Edit carrier file')}
          footer={<button type="button" onClick={saveFile} className="ms-auto px-5 py-2.5 rounded-xl bg-[#f37121] text-white text-sm font-bold">{t('حفظ', 'Save')}</button>}>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <label className="flex items-center gap-2 text-sm font-semibold sm:col-span-2 lg:col-span-3"><input type="checkbox" checked={!!editing.inMaster} onChange={(e) => setEditing({ ...editing, inMaster: e.target.checked })} className="accent-[#f37121]" />{t('ضمن الماستر', 'On the master')}</label>
            {FILE.map(([k, a, e, kind]) => (
              <Field key={k} label={ar ? a : e} span2={kind === 'textarea'}>
                {kind === 'bool' ? <input type="checkbox" checked={!!editing[k]} onChange={(ev) => setEditing({ ...editing, [k]: ev.target.checked })} className="accent-[#f37121] w-5 h-5" />
                  : kind === 'type' ? <select value={editing[k]} onChange={(ev) => setEditing({ ...editing, [k]: ev.target.value })} className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm"><option value="company">{t('شركة / مؤسسة', 'Company')}</option><option value="freelancer">{t('سائق فرد', 'Freelancer')}</option></select>
                    : kind === 'contract' ? <SearchableManagedSelect storeLabel type="vendor_contract_status" value={editing[k] || ''} onChange={(x) => setEditing({ ...editing, [k]: x })} />
                      : kind === 'tax' ? <SearchableManagedSelect storeLabel type="vendor_tax_class" value={editing[k] || ''} onChange={(x) => setEditing({ ...editing, [k]: x })} />
                        : kind === 'owner' ? <><TextInput list="vc-owners" value={editing[k] || ''} onChange={(ev) => setEditing({ ...editing, [k]: ev.target.value })} /><datalist id="vc-owners">{owners.map((o) => <option key={o} value={o} />)}</datalist></>
                          : kind === 'textarea' ? <TextArea rows={2} value={editing[k] || ''} onChange={(ev) => setEditing({ ...editing, [k]: ev.target.value })} />
                            : <TextInput type={kind === 'number' ? 'number' : 'text'} value={editing[k] ?? ''} onChange={(ev) => setEditing({ ...editing, [k]: ev.target.value })} />}
              </Field>
            ))}
            {!v.unregistered && (
              <Field label={t('أسماءٌ أخرى على النظام (اسمٌ في كلّ سطر)', 'Other names in the system (one per line)')} span2>
                <TextArea rows={4} value={(editing.aliases ?? v.aliases ?? []).join('\n')} onChange={(ev) => setEditing({ ...editing, aliases: ev.target.value.split('\n') })} />
              </Field>
            )}
          </div>
        </Modal>
      )}
      {follow && (
        <Modal open onClose={() => setFollow(null)} title={t('متابعة جديدة', 'New follow-up')}
          footer={<button type="button" onClick={saveFollow} className="ms-auto px-5 py-2.5 rounded-xl bg-[#f37121] text-white text-sm font-bold">{t('حفظ', 'Save')}</button>}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label={t('الوسيلة', 'Channel')}><select value={follow.channel} onChange={(e) => setFollow({ ...follow, channel: e.target.value })} className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm">{Object.entries(CHANNELS).map(([k, l]) => <option key={k} value={k}>{ar ? l.ar : l.en}</option>)}</select></Field>
            <Field label={t('حالة التعاقد بعدها', 'Contract status after')}><SearchableManagedSelect storeLabel type="vendor_contract_status" value={follow.contractStatus || ''} onChange={(x) => setFollow({ ...follow, contractStatus: x })} placeholder={t('بلا تغيير', 'Unchanged')} /></Field>
            <Field label={t('ما تمّ', 'Outcome')} span2><TextInput value={follow.outcome} onChange={(e) => setFollow({ ...follow, outcome: e.target.value })} placeholder={t('مثلًا: أُرسل العقد، طُلبت الأوراق، وافق على سعر الرياض…', 'e.g. contract sent, papers requested…')} /></Field>
            <Field label={t('ملاحظة', 'Note')} span2><TextArea rows={3} value={follow.note} onChange={(e) => setFollow({ ...follow, note: e.target.value })} /></Field>
            <Field label={t('موعد المتابعة القادمة', 'Next follow-up')}><TextInput type="date" value={follow.nextAt} onChange={(e) => setFollow({ ...follow, nextAt: e.target.value })} /></Field>
          </div>
        </Modal>
      )}
    </div>
  );
}
