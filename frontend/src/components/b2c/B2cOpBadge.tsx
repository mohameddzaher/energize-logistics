'use client';
/** Daily status badge in the individuals section, shown wherever the person or their vehicle appears. Leave, suspended and accident are written only in the light-transport staff page and copied as a snapshot to the HR file (b2cOpStatus) and the vehicle (b2cRider.opStatus). Empty means working, so no badge. Quiet style: small colored dot and dark text. */
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
