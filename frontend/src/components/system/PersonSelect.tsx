'use client';
/**
 * Person dropdown on a vehicle: actual driver and authorized person.
 * The actual-driver name was a free text field holding junk values and stale names of drivers moved elsewhere, so the dashboard counted vehicles as parked. The person is now picked by search from employees, with ID number and mobile, and stored as a reference.
 * The list comes from the server (`/api/light-transport/people` for the section's vehicles: its employees first then HR; `/api/vehicle-registry/people` for the vehicle register) and matches what save accepts (backend utils/vehiclePerson), so nothing shown gets rejected.
 */
import { useEffect, useMemo, useState } from 'react';
import api from '@/lib/api';
import SearchSelect from '@/components/system/SearchSelect';

export type Person = {
  key: string; source: 'lt' | 'hr'; ltId: string; employeeId: string;
  name: string; idNumber: string; phone: string; jobTitleAr: string; projectAr: string; vehiclePlate: string;
};

const cache = new Map<string, Promise<Person[]>>();
const load = (endpoint: string) => {
  if (!cache.has(endpoint)) {
    const p = api.get<{ people: Person[] }>(endpoint).then((d) => d.people || []);
    p.catch(() => cache.delete(endpoint));
    cache.set(endpoint, p);
  }
  return cache.get(endpoint)!;
};
/** After a save that changes the link, the list reloads on the next open (a rider's vehicle is shown in it). */
export const refreshPeople = () => cache.clear();

export default function PersonSelect({
  endpoint, idNumber, name, onChange, ar, onlyLt = false, clearLabel, disabled,
}: {
  /** `/api/light-transport/people` or `/api/vehicle-registry/people` */
  endpoint: string;
  /** Current person by ID number; shown by name even if not in the list (e.g. ended service). */
  idNumber: string;
  name?: string;
  onChange: (p: Person | null) => void;
  ar: boolean;
  /** A rider can only be a light-transport employee. */
  onlyLt?: boolean;
  /** Label of the "none" option; clears the field. */
  clearLabel?: string;
  disabled?: boolean;
}) {
  const [people, setPeople] = useState<Person[] | null>(null);
  useEffect(() => {
    let live = true;
    load(endpoint).then((p) => { if (live) setPeople(p); }).catch(() => { if (live) setPeople([]); });
    return () => { live = false; };
  }, [endpoint]);
  const list = useMemo(() => (people || []).filter((p) => !onlyLt || p.source === 'lt'), [people, onlyLt]);
  const options = useMemo(() => list.map((p) => ({
    value: p.key,
    label: p.name,
    hint: [p.idNumber, p.source === 'lt' ? (ar ? 'النقل الخفيف' : 'Light transport') : (ar ? 'الموارد البشرية' : 'HR'),
      p.projectAr, p.vehiclePlate].filter(Boolean).join(' · '),
  })), [list, ar]);
  const id = String(idNumber || '').replace(/\s+/g, '');
  const current = id ? list.find((p) => p.idNumber === id) : undefined;
  // Outside the list (ended service, or an old unlinked name): noted underneath until replaced.
  const outside = !current && !!(name || id) && people !== null;
  return (
    <div>
      <SearchSelect ar={ar} disabled={disabled || people === null}
        value={current?.key || ''}
        options={options}
        allLabel={clearLabel}
        placeholder={people === null ? (ar ? 'جارٍ التحميل…' : 'Loading…') : (ar ? 'اختر من الموظّفين…' : 'Pick an employee…')}
        onChange={(k) => onChange(k ? list.find((p) => p.key === k) || null : null)}
      />
      {outside && (
        <p className="mt-1 text-[11.5px] text-amber-700">
          {ar ? `المسجَّل الآن: ${name || id} — ليس في القائمة؛ اختر موظّفًا أو «بلا».` : `Currently: ${name || id} — not in the list; pick an employee or clear.`}
        </p>
      )}
    </div>
  );
}
