'use client';
/**
 * شارةُ حالة اليوم في قسم الأفراد — تُرى حيث يُرى الإنسان أو مركبتُه.
 *
 * إجازة · موقوف · حادث تُكتب في «موظفو النقل الخفيف» وحدَه، وتُنسَخ لقطةً إلى ملفّه
 * في الموارد البشريّة (`b2cOpStatus`) وإلى مركبته (`b2cRider.opStatus`) — فتظهر
 * هذه الشارةُ هناك (صاحبُ الشركة، ٢٠٢٦/١٠/٢١: «يسمع في كل حته»). والفراغُ «يعمل»
 * فلا شارة. هادئة: نقطةُ لونٍ صغيرةٌ ونصٌّ داكن.
 */
const LABEL: Record<string, [string, string, string]> = {
  leave: ['إجازة', 'On leave', '#0284c7'],
  suspended: ['موقوف', 'Suspended', '#d97706'],
  accident: ['حادث', 'Accident', '#dc2626'],
};

export default function B2cOpBadge({ status, ar, who }: { status?: string | null; ar: boolean; who?: string }) {
  const l = LABEL[String(status || '')];
  if (!l) return null;
  return (
    <span title={ar ? 'حالته اليوم في قسم الأفراد (B2C)' : 'Today’s status in B2C'}
      className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-700 whitespace-nowrap">
      <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: l[2] }} />
      B2C: {ar ? l[0] : l[1]}{who ? ` — ${who}` : ''}
    </span>
  );
}
