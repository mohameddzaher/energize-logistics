'use client';
/**
 * كلُّ بيانات الموظّف في ملفّه — مجموعاتُ الماستر نفسُها بخاناتها وحالاتها.
 *
 * صاحبُ الشركة (٢٠٢٦/١٠/١٩): «فيه داتا في الماستر مش بتظهر في بروفايله — إيميل
 * الشركة ورقم الشركة… المفروض ألاقي كل التفاصيل وأقدر أعدل عليها من هنا ويسمع
 * في الماستر وفي كل حتة والعكس».
 *
 * فلا قائمةَ ثانيةَ هنا تشيخ: المجموعاتُ تأتي من الخادم (config/hrFields)، وكلُّ
 * خانةٍ هي `MasterCell` نفسُها التي في الماستر — تكتب بالطريق نفسِه
 * (PATCH /master/employees/:id/fields) فيبثّ الخادم `hr:master` و`hr:employee`،
 * وتسمعهما هذه الشاشةُ والماسترُ واللوحة فتتحدّث كلُّها في اللحظة نفسِها.
 */
import { useCallback, useEffect, useState } from 'react';
import api from '@/lib/api';
import { useSocket } from '@/hooks/useSocket';
import { useDialog } from '@/components/system/DialogProvider';
import MasterCell, { type Choices, type MasterField } from '@/components/hr/MasterCell';

type F = MasterField & { value: any; status?: string; locked?: boolean; note?: string; derived?: boolean };
type G = { key: string; ar: string; en: string; fields: F[] };

export default function EmployeeMasterFields({ id, fieldsUrl, choicesUrl, canEdit, ar }: {
  id: string;
  /** نقطتا البيانات — تُمرَّران من الصفحة (راجع genPageApis). */
  fieldsUrl: string;
  choicesUrl: string;
  canEdit: boolean;
  ar: boolean;
}) {
  const { notify } = useDialog();
  const [groups, setGroups] = useState<G[] | null>(null);
  const [choices, setChoices] = useState<Choices>({});
  const [q, setQ] = useState('');

  const load = useCallback(() => {
    api.get<{ groups: G[] }>(fieldsUrl).then((d) => setGroups(d.groups || [])).catch(() => setGroups([]));
  }, [fieldsUrl]);
  const loadChoices = useCallback(() => {
    api.get<{ choices: Choices }>(choicesUrl).then((d) => setChoices(d.choices || {})).catch(() => {});
  }, [choicesUrl]);
  useEffect(() => { load(); loadChoices(); }, [load, loadChoices]);
  useSocket('hr:master', useCallback(() => { load(); loadChoices(); }, [load, loadChoices]));
  useSocket('hr:employee', load);
  useSocket('hr:contract', load);
  useSocket('lt:updated', load);

  if (!groups) return <div className="py-10 text-center text-sm text-slate-400">{ar ? 'جارٍ التحميل…' : 'Loading…'}</div>;
  const needle = q.trim();
  const shown = groups
    .map((g) => ({ ...g, fields: g.fields.filter((f) => !needle || (ar ? f.ar : f.en).includes(needle) || String(f.value ?? '').includes(needle)) }))
    .filter((g) => g.fields.length);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[12.5px] text-slate-500">
          {ar ? 'كل بيانات الموظف كما في ماستر الموارد البشرية — اضغط أي خانة لتعديلها، والتعديل يظهر في كل مكان فورًا.'
            : 'Every field from the HR master — click any cell to edit; the change shows everywhere at once.'}
        </p>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={ar ? 'ابحث في البيانات…' : 'Search fields…'}
          className="w-56 max-w-full rounded-lg border border-slate-200 px-3 py-1.5 text-sm" />
      </div>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {shown.map((g) => (
          <div key={g.key} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="mb-2 text-[13px] font-extrabold text-slate-800">{ar ? g.ar : g.en}</p>
            <div className="divide-y divide-slate-100">
              {g.fields.map((f) => (
                <div key={f.key} className="flex items-center justify-between gap-3 py-1.5">
                  <span className="text-[12.5px] text-slate-500">
                    {ar ? f.ar : f.en}
                    {f.note && <span className="ms-1.5 rounded bg-violet-50 px-1.5 py-0.5 text-[10.5px] font-semibold text-violet-700">{f.note}</span>}
                  </span>
                  <span className="text-end">
                    <MasterCell id={id} f={f} raw={f.value} st={f.status} choices={choices} ar={ar}
                      canEdit={canEdit && !(f.derived && f.type !== 'hijri')} onSaved={load} notify={notify} compact />
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
