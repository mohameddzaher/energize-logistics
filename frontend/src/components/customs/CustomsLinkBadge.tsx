'use client';
/**
 * شارةُ «التخليص» على كشف التشغيل — رقمُ المعاملة · البوليصة · عددُ الحاويات.
 *
 * تُرسم في جدول سير العمل وفي شاشات التحصيل (الكاش والضريبيّ وأعمار الديون
 * وتفصيل الفاتورة) من النسخة المحفوظة على الكشف نفسِه (`customsLink`)، فلا
 * طلبَ ثانيًا. وتفتح صفحةَ المعاملة لمن يدخل قسمَ التخليص؛ ولغيره تبقى نصًّا
 * يقرؤه — فلا يُفضي الضغطُ إلى صفحةٍ مرفوضة.
 *
 * والمصدرُ يُقال عند المرور: من خانة النقل في المعاملة، أو رقمُ السند يطابق
 * البوليصة أو الحاوية، أو ربطٌ يدويّ. راجع backend/src/services/customsOpsLink.
 */
import Link from 'next/link';
import { Ship } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { canAccessSection } from '@/lib/sections';

export type CustomsLinkView = {
  clearanceId?: string;
  clearance?: string | { _id: string } | null;
  refNumber?: string;
  blNumber?: string;
  customerName?: string;
  containers?: string[];
  via?: string;
  reports?: number;
};

const VIA: Record<string, [string, string]> = {
  move: ['رقمُ الكشف مكتوبٌ في خانة النقل بالمعاملة', 'Report number written in the clearance transport entry'],
  bl: ['رقمُ السند يطابق رقمَ البوليصة', 'Document number matches the bill of lading'],
  container: ['رقمُ السند يطابق رقمَ الحاوية', 'Document number matches a container'],
  manual: ['رُبط يدويًّا', 'Linked by hand'],
};

export const customsIdOf = (l?: CustomsLinkView | null): string => {
  if (!l) return '';
  if (l.clearanceId) return l.clearanceId;
  const c = l.clearance;
  return c ? (typeof c === 'string' ? c : c._id) : '';
};

/** مَن يفتح صفحةَ المعاملة: مَن له القسم. */
export function useCanOpenCustoms(): boolean {
  const { user } = useAuth();
  if (!user) return false;
  return user.role === 'super_admin' || canAccessSection(user.permissions, 'Customs');
}

export const viaLabel = (via: string | undefined, ar: boolean) => {
  const v = VIA[String(via || '')];
  return v ? (ar ? v[0] : v[1]) : '';
};

export default function CustomsLinkBadge({ link, ar, compact = false }: {
  link?: CustomsLinkView | null; ar: boolean; compact?: boolean;
}) {
  const canOpen = useCanOpenCustoms();
  const id = customsIdOf(link);
  if (!link || !id) return null;
  const n = (link.containers || []).length;
  const units = n ? (ar ? `${n} ${n === 1 ? 'حاوية' : n === 2 ? 'حاويتان' : n <= 10 ? 'حاويات' : 'حاوية'}` : `${n} unit${n === 1 ? '' : 's'}`) : '';
  const title = [
    `${ar ? 'معاملة التخليص' : 'Clearance'} ${link.refNumber || ''}`,
    link.customerName ? `${ar ? 'العميل' : 'Customer'}: ${link.customerName}` : '',
    link.blNumber ? `${ar ? 'البوليصة' : 'B/L'}: ${link.blNumber}` : '',
    n ? `${ar ? 'الحاويات' : 'Containers'}: ${(link.containers || []).join('، ')}` : '',
    viaLabel(link.via, ar),
    link.reports && link.reports > 1 ? (ar ? `${link.reports} كشوف` : `${link.reports} reports`) : '',
  ].filter(Boolean).join('\n');
  const body = (
    <>
      <Ship className="w-3 h-3 shrink-0 text-sky-700" />
      <span className="font-semibold text-slate-800">{link.refNumber || '—'}</span>
      {!compact && link.blNumber && <span className="text-slate-500" dir="ltr">· {link.blNumber}</span>}
      {units && <span className="text-slate-500">· {units}</span>}
    </>
  );
  const cls = 'inline-flex items-center gap-1 rounded-md border border-sky-200 bg-sky-50 px-1.5 py-0.5 text-[11px] whitespace-nowrap';
  return canOpen ? (
    <Link href={`/system/customs/${id}`} title={title} onClick={(e) => e.stopPropagation()}
      className={`${cls} hover:border-sky-400 hover:bg-sky-100`}>
      {body}
    </Link>
  ) : (
    <span title={title} className={cls}>{body}</span>
  );
}

/** أكثرُ من معاملةٍ على صفٍّ واحد (فاتورةٌ تضمّ كشوفًا) — الأولى، والباقي عددٌ. */
export function CustomsLinkBadges({ links, ar, compact = true }: { links?: CustomsLinkView[] | null; ar: boolean; compact?: boolean }) {
  const list = (links || []).filter((l) => customsIdOf(l));
  if (!list.length) return null;
  return (
    <span className="inline-flex items-center gap-1">
      <CustomsLinkBadge link={list[0]} ar={ar} compact={compact} />
      {list.length > 1 && (
        <span className="text-[11px] text-slate-500" title={list.slice(1).map((l) => l.refNumber).join('، ')}>+{list.length - 1}</span>
      )}
    </span>
  );
}
