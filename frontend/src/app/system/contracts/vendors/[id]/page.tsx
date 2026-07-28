'use client';
// ملف المورد — everything about one vendor in one place: contract state,
// اتصال ومقر وأسطول، مرفقات ملف العقد (رفع/حذف)، التقييم اليدوي، التاريخ
// التشغيلي الشهري (orders/utilisation/share), and the deep profile tables
// imported from the hand-built Excel sheets, rendered generically.
import { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import {
  Building2, ArrowRight, ArrowLeft, Star, Paperclip, Trash2, Upload, FileText,
  Phone, MapPin, Truck, CalendarDays, TrendingUp, Table2, Pencil,
} from 'lucide-react';
import { Spinner, ErrorNotice, SmallBadge, Modal, Field, TextInput, TextArea, PrimaryButton } from '@/components/hr/HRKit';
import { ContractVendor, UtilisationRow, VENDOR_STATUS, MONTH_AR, canViewContracts, canEditContracts, fmtN, fmtD, pct } from '@/lib/contracts';

const readFileAsDataUrl = (f: File) => new Promise<string>((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result));
  r.onerror = reject;
  r.readAsDataURL(f);
});

// Generic renderer for one imported profile table — layouts differ per vendor,
// so we render sourceHeaders + rows as-is (values may be numbers or shares).
function ProfileTable({ t, ar }: { t: any; ar: boolean }) {
  const TITLE: Record<string, string> = {
    branchDistribution: ar ? 'توزيع الطلبات حسب الفرع' : 'Orders by branch',
    monthlyDistribution: ar ? 'التوزيع الشهري' : 'Monthly distribution',
    destinationDistribution: ar ? 'توزيع خطوط السير' : 'Lane distribution',
    trips: ar ? 'سجل الرحلات والتسعير' : 'Trips & pricing log',
    kpis: ar ? 'مؤشرات الأداء' : 'KPIs',
    unclassified: ar ? 'بيانات إضافية' : 'Extra data',
  };
  const rows: any[] = Array.isArray(t.rows) ? t.rows : [];
  if (!rows.length) return null;
  const cols = Object.keys(rows[0]);
  const fmtCell = (v: any) => {
    if (v == null) return '—';
    if (typeof v === 'number') return v > 0 && v < 1 ? `${(v * 100).toFixed(1)}%` : v.toLocaleString('en-US');
    return String(v);
  };
  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
      <div className="px-4 py-2.5 border-b border-slate-100 flex items-center gap-1.5 font-bold text-sm text-slate-800">
        <Table2 className="w-4 h-4 text-cyan-700" />{TITLE[t.type] || t.type}
        <span className="text-[11px] text-slate-400 font-normal ms-auto">{rows.length} {ar ? 'صف' : 'rows'}</span>
      </div>
      <div className="overflow-x-auto max-h-72 overflow-y-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0">
            <tr className="bg-slate-50 text-slate-500">
              {(t.sourceHeaders?.length === cols.length ? t.sourceHeaders : cols).map((h: string, i: number) => (
                <th key={i} className="text-start font-semibold px-3 py-2 whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-t border-slate-50">
                {cols.map((c) => <td key={c} className="px-3 py-1.5 text-slate-700 whitespace-nowrap tabular-nums">{fmtCell(r[c])}</td>)}
              </tr>
            ))}
            {t.totalRow && (
              <tr className="border-t-2 border-slate-200 bg-slate-50 font-bold">
                {cols.map((c) => <td key={c} className="px-3 py-1.5 text-slate-800 tabular-nums">{fmtCell(t.totalRow[c])}</td>)}
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function VendorProfilePage() {
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const ar = lang === 'ar';
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params?.id;

  const canEdit = canEditContracts(user);
  const [vendor, setVendor] = useState<ContractVendor | null>(null);
  const [utilisation, setUtilisation] = useState<UtilisationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);
  const [attTitle, setAttTitle] = useState('');
  const [showRating, setShowRating] = useState(false);
  const [ratingDraft, setRatingDraft] = useState({ rating: 0, ratingNotes: '' });

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const d = await api.get<{ vendor: ContractVendor; utilisation: UtilisationRow[] }>(`/api/contracts/vendors/${id}`);
      setVendor(d.vendor);
      setUtilisation(d.utilisation || []);
      setError('');
    } catch (e: any) { setError(e?.message || 'Request failed'); }
    setLoading(false);
  }, [id]);
  useEffect(() => { load(); }, [load]);
  useSocket('contracts:updated', useCallback(() => load(), [load]));

  const totals = useMemo(() => {
    const orders = utilisation.reduce((s, r) => s + r.orders, 0);
    const capacity = utilisation.reduce((s, r) => s + (r.expectedMonthlyCapacity || 0), 0);
    return { orders, capacity, utilisation: capacity ? orders / capacity : 0 };
  }, [utilisation]);

  const uploadFile = async (f: File | null) => {
    if (!f || !vendor) return;
    setUploading(true);
    try {
      const dataUrl = await readFileAsDataUrl(f);
      await api.post(`/api/contracts/vendors/${vendor._id}/attachments`, { dataUrl, fileName: f.name, title: attTitle });
      setAttTitle('');
      await load();
    } catch (e: any) { alert(e?.message || 'Upload failed'); }
    setUploading(false);
  };

  const removeAttachment = async (attId: string) => {
    if (!vendor || !confirm(ar ? 'حذف هذا المرفق نهائيًا؟' : 'Delete this attachment?')) return;
    try { await api.delete(`/api/contracts/vendors/${vendor._id}/attachments/${attId}`); await load(); }
    catch (e: any) { alert(e?.message || 'Failed'); }
  };

  const saveRating = async () => {
    if (!vendor) return;
    try {
      await api.patch(`/api/contracts/vendors/${vendor._id}`, { rating: ratingDraft.rating || null, ratingNotes: ratingDraft.ratingNotes });
      setShowRating(false);
      await load();
    } catch (e: any) { alert(e?.message || 'Failed'); }
  };

  if (!canViewContracts(user)) return <div className="text-slate-500 p-8">{ar ? 'غير مصرّح لك بالوصول إلى هذه الصفحة.' : 'Not authorized.'}</div>;
  if (loading) return <Spinner />;
  if (error || !vendor) return <ErrorNotice error={error || 'Not found'} onRetry={() => { setLoading(true); load(); }} lang={lang} />;

  const st = VENDOR_STATUS[vendor.status || 'unsigned'];
  const Back = isRTL ? ArrowRight : ArrowLeft;

  const infoRows: { label: string; value: React.ReactNode }[] = [
    { label: ar ? 'السجل التجاري' : 'CR number', value: vendor.crNumber || '—' },
    { label: ar ? 'نوع المورد' : 'Type', value: vendor.vendorType || '—' },
    { label: ar ? 'مندوب التنشيط' : 'Energize rep', value: vendor.energizeRep || '—' },
    { label: ar ? 'مندوب التشغيل' : 'Operations rep', value: vendor.operationsRep || '—' },
    { label: ar ? 'ممثل المورد' : 'Contact', value: vendor.contactPerson || '—' },
    { label: ar ? 'الجوال' : 'Phone', value: vendor.phone ? <a href={`tel:${vendor.phone}`} className="text-cyan-700 hover:underline" dir="ltr">{vendor.phone}</a> : '—' },
    { label: ar ? 'المقر الرئيسي' : 'HQ', value: vendor.headquarters || '—' },
    { label: ar ? 'الوجهات' : 'Destinations', value: vendor.destinations || '—' },
    { label: ar ? 'أنواع السيارات' : 'Vehicle types', value: vendor.vehicleTypes || '—' },
    { label: ar ? 'الطاقة الشهرية المتوقعة' : 'Monthly capacity', value: fmtN(vendor.monthlyCapacity) },
    { label: ar ? 'تاريخ العقد' : 'Contract date', value: fmtD(vendor.contractDate) },
    { label: ar ? 'سياسة التجديد' : 'Renewal', value: vendor.renewalPolicy || '—' },
    { label: ar ? 'مدة السداد' : 'Payment term', value: vendor.paymentTermDays ? (ar ? `${vendor.paymentTermDays} يوم` : `${vendor.paymentTermDays} days`) : '—' },
    { label: ar ? 'التسعير' : 'Pricing', value: vendor.pricingNotes || '—' },
    { label: ar ? 'الحالة التشغيلية' : 'Operational status', value: vendor.operationalStatus || '—' },
  ];

  return (
    <div className="space-y-4" dir={isRTL ? 'rtl' : 'ltr'}>
      <div className="flex flex-wrap items-center gap-3">
        <button onClick={() => router.push('/system/contracts/vendors')} className="p-2 rounded-lg bg-white border border-slate-200 hover:border-slate-300 text-slate-500"><Back className="w-4 h-4" /></button>
        <Building2 className="w-6 h-6 text-cyan-700" />
        <div className="min-w-0">
          <h1 className="text-lg font-bold text-slate-900 truncate">{vendor.name}</h1>
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <SmallBadge bg={st.cls.split(' ')[0]} text={st.cls.split(' ')[1]} label={ar ? st.ar : st.en} />
            {vendor.status === 'signed' && !vendor.documentsReceived && (
              <span className="text-red-600 font-semibold">{ar ? `مستندات ناقصة: ${vendor.missingDocuments || 'غير محددة'}` : 'missing documents'}</span>
            )}
          </div>
        </div>
        <div className="ms-auto flex items-center gap-2">
          <button onClick={() => { setRatingDraft({ rating: vendor.rating || 0, ratingNotes: vendor.ratingNotes || '' }); setShowRating(true); }}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white border border-slate-200 hover:border-amber-400 text-sm font-medium text-slate-700">
            <Star className={`w-4 h-4 ${vendor.rating ? 'fill-amber-400 text-amber-400' : 'text-slate-300'}`} />
            {vendor.rating ? `${vendor.rating}/5` : (ar ? 'تقييم المورد' : 'Rate')}
          </button>
          {canEdit && (
            <Link href={`/system/contracts/vendors?edit=${vendor._id}`} className="hidden" aria-hidden />
          )}
        </div>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: ar ? 'عدد السيارات' : 'Fleet', value: fmtN(vendor.fleetSize), icon: <Truck className="w-4 h-4" /> },
          { label: ar ? 'إجمالي الطلبات المسجلة' : 'Total recorded orders', value: fmtN(totals.orders), icon: <TrendingUp className="w-4 h-4" /> },
          { label: ar ? 'متوسط الاستغلال' : 'Avg utilisation', value: totals.capacity ? pct(totals.utilisation) : '—', icon: <TrendingUp className="w-4 h-4" /> },
          { label: ar ? 'أشهر مسجلة' : 'Months on record', value: fmtN(utilisation.length), icon: <CalendarDays className="w-4 h-4" /> },
        ].map((s) => (
          <div key={s.label} className="bg-white border border-slate-200 rounded-xl shadow-sm p-3.5">
            <div className="flex items-center gap-1.5 text-[11px] font-medium text-slate-500">{s.icon}{s.label}</div>
            <div className="text-xl font-bold text-slate-800 tabular-nums mt-0.5">{s.value}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
        {/* Identity */}
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-4 lg:col-span-1">
          <h3 className="font-bold text-slate-800 text-sm mb-3 flex items-center gap-1.5"><FileText className="w-4 h-4 text-cyan-700" />{ar ? 'بيانات المورد والعقد' : 'Vendor & contract details'}</h3>
          <dl className="space-y-2">
            {infoRows.map((r) => (
              <div key={r.label} className="flex items-start justify-between gap-3 text-xs border-b border-slate-50 pb-2">
                <dt className="text-slate-500 font-medium shrink-0">{r.label}</dt>
                <dd className="text-slate-800 font-semibold text-end break-words min-w-0">{r.value}</dd>
              </div>
            ))}
          </dl>
          {(vendor.notes || vendor.followUpNotes) && (
            <p className="text-xs text-slate-500 bg-slate-50 rounded-lg p-2.5 mt-3 whitespace-pre-wrap">{[vendor.followUpNotes, vendor.notes].filter(Boolean).join(' — ')}</p>
          )}
          {vendor.ratingNotes && (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg p-2.5 mt-2">{ar ? 'ملاحظات التقييم: ' : 'Rating notes: '}{vendor.ratingNotes}</p>
          )}
        </div>

        <div className="lg:col-span-2 space-y-4">
          {/* Attachments */}
          <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-4">
            <h3 className="font-bold text-slate-800 text-sm mb-3 flex items-center gap-1.5"><Paperclip className="w-4 h-4 text-cyan-700" />{ar ? 'ملف العقد والمرفقات' : 'Contract file & attachments'}</h3>
            <div className="space-y-1.5">
              {(vendor.attachments || []).length === 0 && <div className="text-xs text-slate-400 py-3 text-center">{ar ? 'لا توجد مرفقات بعد — ارفع ملف العقد الموقّع.' : 'No attachments yet.'}</div>}
              {(vendor.attachments || []).map((a) => (
                <div key={a._id} className="flex items-center gap-2 text-xs bg-slate-50 border border-slate-100 rounded-lg px-3 py-2">
                  <FileText className="w-4 h-4 text-cyan-700 shrink-0" />
                  <a href={a.fileUrl} target="_blank" rel="noreferrer" className="font-semibold text-slate-800 hover:text-cyan-700 truncate">{a.title || a.fileName}</a>
                  <span className="text-slate-400 shrink-0">{(a.size / 1024).toFixed(0)} KB · {fmtD(a.uploadedAt)}{a.uploadedByName ? ` · ${a.uploadedByName}` : ''}</span>
                  {canEdit && <button onClick={() => removeAttachment(a._id)} className="ms-auto text-red-400 hover:text-red-600 shrink-0"><Trash2 className="w-3.5 h-3.5" /></button>}
                </div>
              ))}
            </div>
            {canEdit && (
              <div className="flex flex-wrap items-center gap-2 mt-3">
                <TextInput value={attTitle} onChange={(e) => setAttTitle(e.target.value)} placeholder={ar ? 'وصف المرفق (مثال: العقد الموقّع)' : 'Attachment title'} />
                <label className={`inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg bg-cyan-700 hover:bg-cyan-800 text-white text-sm font-semibold cursor-pointer shrink-0 ${uploading ? 'opacity-50 pointer-events-none' : ''}`}>
                  <Upload className="w-4 h-4" />{uploading ? (ar ? 'جارٍ الرفع…' : 'Uploading…') : (ar ? 'رفع ملف' : 'Upload')}
                  <input type="file" className="hidden" accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,.webp" onChange={(e) => uploadFile(e.target.files?.[0] || null)} />
                </label>
              </div>
            )}
          </div>

          {/* Monthly utilisation history */}
          <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
            <div className="px-4 py-2.5 border-b border-slate-100 font-bold text-sm text-slate-800 flex items-center gap-1.5">
              <TrendingUp className="w-4 h-4 text-cyan-700" />{ar ? 'التاريخ التشغيلي الشهري' : 'Monthly operating history'}
            </div>
            {utilisation.length === 0
              ? <div className="text-xs text-slate-400 py-6 text-center">{ar ? 'لا توجد بيانات تشغيل بعد لهذا المورد.' : 'No utilisation data yet.'}</div>
              : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-slate-50 text-slate-500 text-xs">
                        <th className="text-start font-semibold px-4 py-2">{ar ? 'الشهر' : 'Month'}</th>
                        <th className="text-center font-semibold px-4 py-2">{ar ? 'الطلبات' : 'Orders'}</th>
                        <th className="text-center font-semibold px-4 py-2">{ar ? 'الطاقة المتوقعة' : 'Capacity'}</th>
                        <th className="text-center font-semibold px-4 py-2">{ar ? 'الاستغلال' : 'Utilisation'}</th>
                        <th className="text-center font-semibold px-4 py-2">{ar ? 'مندوب التشغيل' : 'Ops rep'}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {utilisation.map((r) => {
                        const u = r.expectedMonthlyCapacity ? r.orders / r.expectedMonthlyCapacity : null;
                        return (
                          <tr key={r._id} className="border-t border-slate-50">
                            <td className="px-4 py-2 font-medium text-slate-700">{ar ? `${MONTH_AR[r.month]} ${r.year}` : `${r.year}-${String(r.month).padStart(2, '0')}`}</td>
                            <td className="px-4 py-2 text-center font-bold tabular-nums text-slate-800">{fmtN(r.orders)}</td>
                            <td className="px-4 py-2 text-center tabular-nums text-slate-500">{fmtN(r.expectedMonthlyCapacity)}</td>
                            <td className="px-4 py-2 text-center tabular-nums">
                              {u == null ? '—' : <span className={`font-bold ${u >= 0.3 ? 'text-emerald-600' : u >= 0.05 ? 'text-amber-600' : 'text-red-600'}`}>{pct(u)}</span>}
                            </td>
                            <td className="px-4 py-2 text-center text-xs text-slate-500">{r.operationsRep || '—'}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
          </div>
        </div>
      </div>

      {/* Deep profile tables */}
      {(vendor.profileTables || []).length > 0 && (
        <div className="space-y-3">
          <h2 className="font-bold text-slate-800 flex items-center gap-1.5"><Table2 className="w-5 h-5 text-cyan-700" />{ar ? 'الملف التحليلي التفصيلي' : 'Detailed analytical profile'}</h2>
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            {(vendor.profileTables || []).map((t, i) => <ProfileTable key={i} t={t} ar={ar} />)}
          </div>
        </div>
      )}

      {/* Rating modal */}
      <Modal open={showRating} onClose={() => setShowRating(false)} title={ar ? `تقييم المورد — ${vendor.name}` : 'Rate vendor'}
        footer={
          <div className="flex items-center gap-2 justify-end">
            <button onClick={() => setShowRating(false)} className="px-4 py-2 rounded-lg text-slate-600 hover:bg-slate-100 font-medium">{ar ? 'إلغاء' : 'Cancel'}</button>
            {canEdit && <PrimaryButton onClick={saveRating}>{ar ? 'حفظ التقييم' : 'Save'}</PrimaryButton>}
          </div>
        }>
        <div className="space-y-4">
          <div className="flex items-center justify-center gap-2 py-2">
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} onClick={() => canEdit && setRatingDraft({ ...ratingDraft, rating: n })} disabled={!canEdit}>
                <Star className={`w-8 h-8 transition-colors ${n <= ratingDraft.rating ? 'fill-amber-400 text-amber-400' : 'text-slate-200 hover:text-amber-200'}`} />
              </button>
            ))}
          </div>
          <Field label={ar ? 'ملاحظات التقييم' : 'Rating notes'}>
            <TextArea rows={3} value={ratingDraft.ratingNotes} disabled={!canEdit} onChange={(e) => setRatingDraft({ ...ratingDraft, ratingNotes: e.target.value })}
              placeholder={ar ? 'مثال: التزام ممتاز بالمواعيد، يحتاج تحسين التوثيق…' : 'e.g. reliable, needs better paperwork…'} />
          </Field>
        </div>
      </Modal>
    </div>
  );
}
