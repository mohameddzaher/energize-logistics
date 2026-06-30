'use client';
// Driver profile — driver details + their complete live shipment history (the
// analytics + list live in the shared <OpsShipmentHistory/> component).
import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import { ArrowLeft, Users as UsersIcon, Phone, Mail, IdCard } from 'lucide-react';
import { Spinner } from '@/components/hr/HRKit';
import OpsShipmentHistory from '@/components/ops/OpsShipmentHistory';
import { locName, fmtDateTime, isOpsStaff, opsText } from '@/lib/ops';

type Row = Record<string, any>;

export default function DriverProfilePage() {
  const { user } = useAuth();
  const { lang, isRTL } = useLanguage();
  const router = useRouter();
  const params = useParams();
  const id = String(params?.id || '');
  const tx = opsText(lang);

  const [driver, setDriver] = useState<Row | null>(null);
  const [loaded, setLoaded] = useState(false);

  const loadDriver = useCallback(async () => {
    try { setDriver(await api.get<Row>(`/api/ops/drivers/${id}?lang=${lang}`)); } catch { /* keep */ }
    setLoaded(true);
  }, [id, lang]);

  useEffect(() => { loadDriver(); }, [loadDriver]);
  useSocket('ops:drivers:changed', useCallback(() => loadDriver(), [loadDriver]));

  if (!isOpsStaff(user?.role)) return <div className="text-slate-500 p-8">{tx.notAuthorized}</div>;
  if (!loaded) return <Spinner />;

  const name = locName(driver?.admin?.name, lang) || locName(driver?.name, lang) || '—';
  const phone = driver?.admin?.phone;
  const email = driver?.admin?.email;
  const info: [string, any][] = [
    [lang === 'ar' ? 'الجنسية' : 'Nationality', driver?.nationality],
    [lang === 'ar' ? 'رقم الإقامة' : 'Residence #', driver?.residence_number],
    [lang === 'ar' ? 'رقم بطاقة السائق' : 'Driver card #', driver?.driver_card_number],
    [lang === 'ar' ? 'انتهاء البطاقة' : 'Card expiry', driver?.driver_card_expiry ? fmtDateTime(driver.driver_card_expiry, lang) : null],
    [lang === 'ar' ? 'الشركة' : 'Company', driver?.company_name],
    [lang === 'ar' ? 'الكفيل' : 'Sponsor', driver?.sponsor_name],
  ];

  return (
    <div className="space-y-5" dir={isRTL ? 'rtl' : 'ltr'}>
      <button type="button" onClick={() => router.push('/system/ops/drivers')} className="flex items-center gap-1 text-slate-500 hover:text-slate-900 text-sm">
        <ArrowLeft className={`w-4 h-4 ${isRTL ? 'rotate-180' : ''}`} /> {lang === 'ar' ? 'السائقون' : 'Drivers'}
      </button>

      <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="w-12 h-12 rounded-lg bg-[#f37121]/20 flex items-center justify-center text-[#f37121]"><UsersIcon className="w-6 h-6" /></div>
            <div>
              <h1 className="text-2xl font-bold text-slate-900">{name}</h1>
              <p className="text-slate-500 text-sm mt-0.5 flex items-center gap-1.5"><IdCard className="w-3.5 h-3.5" /> {driver?.driver_card_number || '—'}</p>
            </div>
          </div>
          <div className="text-sm text-slate-600 space-y-1 sm:text-end">
            {phone && <a href={`tel:${phone}`} className="flex items-center gap-2 text-[#f37121]" dir="ltr"><Phone className="w-3.5 h-3.5" /> {phone}</a>}
            {email && <a href={`mailto:${email}`} className="flex items-center gap-2" dir="ltr"><Mail className="w-3.5 h-3.5 text-slate-400" /> {email}</a>}
            <div className="text-slate-400 text-xs">{lang === 'ar' ? 'مُسجّل منذ' : 'Registered'} {fmtDateTime(driver?.created_at, lang)}</div>
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-2.5 mt-4 pt-4 border-t border-slate-100">
          {info.map(([k, v]) => (
            <div key={k}>
              <p className="text-slate-400 text-[11px] uppercase tracking-wide">{k}</p>
              <p className="text-slate-800 text-sm break-words">{v == null || v === '' ? '—' : String(v)}</p>
            </div>
          ))}
        </div>
      </div>

      <OpsShipmentHistory filterKey="driver_id" filterValue={id} />
    </div>
  );
}
