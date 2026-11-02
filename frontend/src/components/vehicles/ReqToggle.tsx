'use client';
// Toggle for whether this document is required of us, shown where the document is edited.
// Not every registry vehicle is ours (e.g. only a tracker is fitted), so missing papers are not a gap; silence used to read as missing. The value is `<root>.statusCode` on the vehicle, read by docNeed and stateOf on the server, so it is the same whichever page writes it.

/** Recorded statuses meaning not required, as read by docNeed in lib/vehicleRegistry. */
export const isNotRequiredCode = (code?: string | null) =>
  code === 'not_required' || code === 'not_in_use';

/**
 * A third stored status that two buttons must not overwrite.
 * Statuses such as held by bank, held by garage and active were recorded by import or earlier users; they are neither required nor not-required, so they show as an existing state and only an explicit action clears them.
 */
export const isOtherCode = (code?: string | null) =>
  !!code && !isNotRequiredCode(code) && code !== 'required' && code !== 'none';

export const ReqToggle = ({ label, code, onChange, ar }: {
  label: string;
  code: string;
  onChange: (v: string) => void;
  ar: boolean;
}) => {
  const off = isNotRequiredCode(code);
  const other = isOtherCode(code);
  const pill = (on: boolean, tone: string) =>
    `px-2 py-[3px] rounded-md text-[11px] font-semibold border transition ${
      on ? tone : 'bg-white border-slate-200 text-slate-400 hover:text-slate-600'}`;
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <span className="text-[11px] text-slate-500">{label}</span>
      <button type="button" onClick={() => onChange('required')}
        className={pill(!off && !other, 'bg-emerald-50 border-emerald-300 text-emerald-700')}>
        {ar ? 'مطلوب' : 'Required'}
      </button>
      <button type="button" onClick={() => onChange('not_required')}
        className={pill(off, 'bg-slate-200 border-slate-300 text-slate-700')}>
        {ar ? 'غير مطلوب' : 'Not required'}
      </button>
      {other && <span className="text-[10.5px] text-blue-600">{ar ? 'وضعٌ مسجَّل' : 'recorded state'}</span>}
    </div>
  );
};

export default ReqToggle;
