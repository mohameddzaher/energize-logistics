'use client';
/**
 * أطرافُ المعاملة — العميلُ والوكيلُ والناقل: بياناتُهم ومرفقاتُهم في مكانٍ واحد.
 *
 * يُقرأ من ملفّ كلِّ طرف (`/:id/parties-card`)، فما يُرفَع هنا يُرفَع في ملفّه
 * ويُرى من كلّ معاملةٍ هو طرفٌ فيها. والطرفُ المكتوبُ اسمًا بلا ملفٍّ يُقال عنه ذلك.
 */
import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import api from '@/lib/api';
import { useSocket } from '@/hooks/useSocket';
import PartyAttachments, { type PartyFile } from '@/components/customs/PartyAttachments';
import { Users, Ship, Truck, Phone, Mail, ExternalLink } from 'lucide-react';

interface Card {
  _id?: string; kind: 'customer' | 'agent' | 'carrier'; name: string; phone?: string; email?: string; contactPerson?: string;
  commercialRegister?: string; taxNumber?: string; address?: string; city?: string; notes?: string; attachments: PartyFile[]; unlinked?: boolean;
}

export default function ClearanceParties({ clearanceId, canEdit, ar }: { clearanceId: string; canEdit: boolean; ar: boolean }) {
  const t = (a: string, e: string) => (ar ? a : e);
  const [d, setD] = useState<{ customer: Card | null; agent: Card | null; carrier: Card | null } | null>(null);
  const load = useCallback(() => {
    api.get<any>(`/api/customs-clearance/${clearanceId}/parties-card`).then(setD).catch(() => {});
  }, [clearanceId]);
  useEffect(() => { load(); }, [load]);
  useSocket('customs:updated', load);
  if (!d) return null;

  const meta = { customer: [t('العميل', 'Customer'), Users], agent: [t('وكيل الشحن', 'Shipping agent'), Ship], carrier: [t('الناقل', 'Carrier'), Truck] } as const;
  const cards = (['customer', 'agent', 'carrier'] as const).map((k) => [k, d[k]] as const).filter(([, c]) => !!c);

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="mb-3 text-sm font-bold text-slate-800">{t('بيانات العملاء والناقلين ومرفقاتهم', 'Customer, agent & carrier — details and files')}</p>
      {cards.length === 0 && <p className="text-[12.5px] text-slate-400">{t('لا أطرافَ مختارةً لهذه المعاملة.', 'No parties picked for this clearance.')}</p>}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        {cards.map(([k, c]) => {
          const [label, Icon] = meta[k];
          return (
            <div key={k} className="rounded-xl border border-slate-200 p-3">
              <p className="flex items-center gap-1.5 text-[11.5px] font-bold text-slate-500"><Icon className="h-3.5 w-3.5 text-[#f37121]" />{label}</p>
              <p className="mt-0.5 flex items-center gap-1.5 text-[14px] font-bold text-slate-900">
                {c!.name}
                {c!._id && <Link href={`/system/customs/parties/${c!._id}`} title={t('ملفّه الكامل', 'Full profile')} className="text-slate-400 hover:text-[#f37121]"><ExternalLink className="h-3.5 w-3.5" /></Link>}
              </p>
              {c!.unlinked ? (
                <p className="mt-1 text-[11.5px] text-amber-700">{t('مكتوبٌ اسمًا بلا ملفّ — اختره من القائمة في بيانات المعاملة لتُرفَق ملفّاتُه.', 'Typed as text with no profile — pick it from the list to attach files.')}</p>
              ) : (
                <>
                  <div className="mt-1.5 space-y-0.5 text-[12px] text-slate-600">
                    {c!.phone && <a href={`tel:${c!.phone}`} className="flex items-center gap-1 hover:text-[#f37121]"><Phone className="h-3 w-3" /><bdi>{c!.phone}</bdi></a>}
                    {c!.email && <a href={`mailto:${c!.email}`} className="flex items-center gap-1 hover:text-[#f37121]"><Mail className="h-3 w-3" />{c!.email}</a>}
                    {c!.contactPerson && <p>{t('المسؤول', 'Contact')}: <b>{c!.contactPerson}</b></p>}
                    {c!.commercialRegister && <p>{t('السجل التجاري', 'CR')}: <b className="font-mono">{c!.commercialRegister}</b></p>}
                    {c!.taxNumber && <p>{t('الرقم الضريبي', 'Tax no.')}: <b className="font-mono">{c!.taxNumber}</b></p>}
                    {(c!.city || c!.address) && <p>{[c!.city, c!.address].filter(Boolean).join(' — ')}</p>}
                    {c!.notes && <p className="text-slate-500">{c!.notes}</p>}
                  </div>
                  <div className="mt-2 border-t border-slate-100 pt-2">
                    <PartyAttachments partyId={c!._id!} items={c!.attachments || []} canEdit={canEdit} ar={ar} compact
                      onChanged={(items) => setD((p) => (p ? { ...p, [k]: { ...p[k]!, attachments: items } } : p))} />
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
