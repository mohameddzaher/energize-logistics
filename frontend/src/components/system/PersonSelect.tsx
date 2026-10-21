'use client';
/**
 * منسدلةُ الشخص على المركبة — القائدُ الفعليّ والمفوَّض.
 *
 * ── لماذا (صاحبُ الشركة، ٢٠٢٦/١٠/٢٢) ───────────────────────────────────────
 * «اسم القائد الفعلي» خانةٌ نصّيّة: كُتب فيها «غيرمستخدم»، وبقي فيها اسمُ رجلٍ
 * انتقل إلى مركبةٍ أخرى — فعدّت اللوحةُ المركبةَ «واقفة» وعليها اسم. فالشخصُ
 * يُختار من الموظّفين بالبحث، ويأتي معه رقمُ هويّته وجوالُه، ويُحفَظ مرجعًا.
 *
 * القائمةُ من الخادم (`/api/light-transport/people` لمركبات القسم: موظّفوه أوّلًا ثمّ
 * الموارد البشريّة؛ و`/api/vehicle-registry/people` لسجلّ المركبات) — وهي نفسُها
 * ما يقبله الحفظ (backend utils/vehiclePerson)، فلا يُعرَض ما يُرفَض.
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
/** بعد حفظٍ يغيّر الربط تُعاد القائمةُ في الفتح التالي (مركبةُ الراكب تُعرَض فيها). */
export const refreshPeople = () => cache.clear();

export default function PersonSelect({
  endpoint, idNumber, name, onChange, ar, onlyLt = false, clearLabel, disabled,
}: {
  /** `/api/light-transport/people` أو `/api/vehicle-registry/people` */
  endpoint: string;
  /** الشخصُ الحاليّ برقم هويّته — ويُعرَض اسمُه إن لم يكن في القائمة (منتهي الخدمة مثلًا). */
  idNumber: string;
  name?: string;
  onChange: (p: Person | null) => void;
  ar: boolean;
  /** الراكبُ لا يكون إلّا من موظّفي النقل الخفيف. */
  onlyLt?: boolean;
  /** نصُّ خيار «بلا» — يُفرِّغ الخانة. */
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
  // خارجَ القائمة (منتهي الخدمة، أو اسمٌ قديمٌ غيرُ مربوط): يُقال تحتها حتى يُستبدَل.
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
