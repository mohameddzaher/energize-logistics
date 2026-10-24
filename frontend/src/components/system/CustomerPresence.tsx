'use client';
/**
 * «نفس العميل في: …» — العميلُ واحدٌ في كلّ الأقسام (صاحبُ الشركة، ٢٠٢٦/١٠/٢٤).
 *
 * يُوضع في ملفّ العميل في أيّ قسم: يقرأ من الخادم أين يوجد العميلُ نفسُه
 * (/api/customer-hub/presence — services/customerHub) ويعرضها روابطَ. ويستمع
 * لـ`customers:changed`: ما عُدِّل في العميل من أيّ شاشةٍ يُعيد قراءةَ الصفحة
 * التي هو فيها (onChanged) في اللحظة.
 */
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import api from '@/lib/api';
import { useSocket } from '@/hooks/useSocket';
import { Link2 } from 'lucide-react';

type Reg = 'crm' | 'collections' | 'shipment' | 'fleet' | 'customs' | 'contracts';
interface Place { reg: Reg; ar: string; id: string; href: string; name: string }

export default function CustomerPresence({ reg, id, ar, onChanged }: { reg: Reg; id: string; ar: boolean; onChanged?: () => void }) {
  const [data, setData] = useState<{ master: string | null; places: Place[] } | null>(null);
  const load = useCallback(() => {
    if (!id) return;
    api.get<{ master: string | null; places: Place[] }>(`/api/customer-hub/presence/${reg}/${id}`).then(setData).catch(() => setData(null));
  }, [reg, id]);
  useEffect(() => { load(); }, [load]);
  useSocket('customers:changed', useCallback((d: { master?: string }) => {
    if (!data?.master || !d?.master || d.master === data.master) { load(); onChanged?.(); }
  }, [data, load, onChanged]));

  const others = (data?.places || []).filter((p) => !(p.reg === reg && p.id === id));
  if (!others.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-[12.5px]">
      <Link2 className="h-4 w-4 text-[#f37121]" />
      <span className="font-semibold text-slate-700">{ar ? 'نفس العميل في:' : 'Same customer in:'}</span>
      {others.map((p) => (
        <Link key={`${p.reg}-${p.id}`} href={p.href}
          className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 font-semibold text-slate-700 hover:border-[#f37121] hover:text-[#f37121]">
          {p.ar}
        </Link>
      ))}
      <span className="text-[11.5px] text-slate-500">{ar ? '— بياناتُ التواصل واحدةٌ وتتحدّث في كلّها فورًا' : '— contact details are shared and update everywhere'}</span>
    </div>
  );
}
