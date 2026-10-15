'use client';
/**
 * ما يُعرَف عن صاحب رقم الإقامة — تاريخُ ميلاده ورقمُ جواله — يظهر تحت الخانة
 * لحظةَ يُكتب الرقم.
 *
 * يُقرأ من البحث نفسِه الذي يملأ الاستمارة (`person-lookup`: الموارد البشريّة
 * وسجلُّ النقل الخفيف وبطاقاتُ السائقين)، ويُطابَق بالرقم كاملًا لا بجزئه:
 * رقمٌ ناقصٌ لا يُظهر بياناتِ رجلٍ آخر.
 */
import { useEffect, useState } from 'react';
import api from '@/lib/api';
import { Loader2, Cake, Phone, UserCheck } from 'lucide-react';
import type { FoundPerson } from '@/components/vehicles/PersonLookup';

const dmy = (v?: string | null) => (v ? String(v).slice(0, 10).split('-').reverse().join('/') : '');

export default function IqamaPersonInfo({ idNumber, ar, onFound }: {
  idNumber?: string; ar: boolean;
  /** يُنادى بالشخص حين يُعرَف — لمن يريد أن يملأ خاناته (الجوال وتاريخ الميلاد). */
  onFound?: (p: FoundPerson) => void;
}) {
  const t = (a: string, e: string) => (ar ? a : e);
  const id = String(idNumber || '').replace(/\s+/g, '');
  const [p, setP] = useState<FoundPerson | null>(null);
  const [state, setState] = useState<'' | 'loading' | 'missing'>('');

  useEffect(() => {
    setP(null);
    if (!/^\d{8,}$/.test(id)) { setState(''); return undefined; }
    setState('loading');
    let live = true;
    const timer = setTimeout(() => {
      api.get<{ people: FoundPerson[] }>(`/api/vehicle-registry/person-lookup?q=${encodeURIComponent(id)}`)
        .then((d) => {
          if (!live) return;
          const hit = (d.people || []).find((x) => String(x.idNumber || '').replace(/\s+/g, '') === id) || null;
          setP(hit); setState(hit ? '' : 'missing');
          if (hit && onFound) onFound(hit);
        })
        .catch(() => { if (live) setState('missing'); });
    }, 350);
    return () => { live = false; clearTimeout(timer); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (state === 'loading') return <p className="mt-1 flex items-center gap-1.5 text-[11.5px] text-slate-400"><Loader2 className="h-3 w-3 animate-spin" />{t('يُبحَث عن صاحب الرقم…', 'Looking up…')}</p>;
  if (state === 'missing') return <p className="mt-1 text-[11.5px] text-slate-400">{t('لا بياناتَ لهذا الرقم في الموارد البشريّة ولا في بطاقات السائقين.', 'No record for this number.')}</p>;
  if (!p) return null;
  const phone = p.phone || p.absherPhone || '';
  return (
    <div className="mt-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-[12px] text-emerald-900">
      <p className="flex items-center gap-1 font-bold"><UserCheck className="h-3.5 w-3.5" />{p.name}</p>
      <p className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5">
        <span className="inline-flex items-center gap-1"><Cake className="h-3 w-3" />{t('تاريخ الميلاد', 'Date of birth')}: <b>{dmy(p.dateOfBirth) || t('غير مسجَّل', 'not recorded')}</b></span>
        <span className="inline-flex items-center gap-1"><Phone className="h-3 w-3" />{t('الجوال', 'Mobile')}: <b dir="ltr">{phone || t('غير مسجَّل', 'not recorded')}</b></span>
      </p>
    </div>
  );
}
