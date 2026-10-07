'use client';
/**
 * التحليلُ بالأقسام — صفٌّ لكلّ قسمٍ بأرقامه كلِّها.
 *
 * ── لماذا جدولٌ بجانب الفلتر ────────────────────────────────────────────────
 * اللوحةُ تُفلتَر بالقسم فتقول كلَّ شيءٍ عن قسمٍ واحد. والسؤالُ الذي يُسأل أوّلًا
 * ليس «ما حالُ التشغيل؟» بل **«أيُّ الأقسام أسوأ؟»** — وجوابُه لا يُقرأ إلّا
 * بالأقسام متجاورةً في شاشةٍ واحدة. وبغيره تُفتَح اللوحةُ ستًّا وعشرين مرّةً.
 *
 * وكلُّ رقمٍ يفتح صفوفَه بقسمه: لا رقمَ تُقرأ ورقتُه في مكانٍ آخر. و«اكتمالُ
 * البيانات» نسبةٌ تقارن الأقسامَ مهما اختلفت أعدادُها — قسمٌ من مئةٍ وتسعةٍ
 * وثمانين ناقصُه اثنان وخمسون أفضلُ حالًا من قسمٍ من ثلاثةٍ ناقصُه ستّة.
 */
import { useMemo, useState } from 'react';
import { Building2, ArrowUpDown } from 'lucide-react';
import ScrollX from '@/components/system/ScrollX';

export interface DeptRow {
  department: string;
  total: number; active: number; ended: number;
  saudi: number; outside: number; freelancers: number;
  missing: number; peopleWithMissing: number; completeness: number;
  docsExpired: number; docsSoon: number;
  contracts: number; custody: number; leavesPending: number; leavesApproved: number;
}
export interface DeptAnalysis { departments: DeptRow[]; fieldsPerEmployee: number; totals: Record<string, number> }

type SortKey = keyof DeptRow;

export default function DepartmentAnalysis({
  data, ar, onOpen, onFilter, active,
}: {
  data: DeptAnalysis;
  ar: boolean;
  /** يفتح الصفوفَ وراء رقمٍ بعينه: القسمُ + أيُّ شرطٍ آخر. */
  onOpen: (q: Record<string, string>) => void;
  /** يقصر اللوحةَ كلَّها على قسمٍ واحد. */
  onFilter: (dept: string) => void;
  active?: string;
}) {
  const t = (a: string, e: string) => (ar ? a : e);
  const [sort, setSort] = useState<SortKey>('total');
  const [desc, setDesc] = useState(true);

  const rows = useMemo(() => {
    const r = [...(data.departments || [])];
    r.sort((a, b) => {
      const x = a[sort]; const y = b[sort];
      const n = typeof x === 'number' && typeof y === 'number'
        ? x - y
        : String(x).localeCompare(String(y), ar ? 'ar' : 'en');
      return desc ? -n : n;
    });
    return r;
  }, [data.departments, sort, desc, ar]);

  const head = (key: SortKey, label: string, cls = 'text-end') => (
    <th className={`${cls} font-semibold px-3 py-2.5 whitespace-nowrap`}>
      <button type="button"
        onClick={() => { if (sort === key) setDesc((v) => !v); else { setSort(key); setDesc(true); } }}
        className={`inline-flex items-center gap-1 hover:text-white ${sort === key ? 'text-white' : ''}`}>
        {label}<ArrowUpDown className="w-3 h-3 opacity-50" />
      </button>
    </th>
  );

  // رقمٌ يُضغَط فيفتح صفوفَه، وصفرٌ لا يُضغَط — الضغطُ على صفرٍ يفتح جدولًا
  // فارغًا فيُقرأ عطلًا.
  const Cell = ({ n, q, tone = '' }: { n: number; q?: Record<string, string>; tone?: string }) => (
    <td className="px-3 py-2 text-end tabular-nums">
      {n > 0 && q ? (
        <button type="button" onClick={() => onOpen(q)}
          className={`font-semibold hover:underline ${tone || 'text-slate-800'}`}>{n.toLocaleString('en-US')}</button>
      ) : <span className={n > 0 ? (tone || 'text-slate-800') : 'text-slate-300'}>{n.toLocaleString('en-US')}</span>}
    </td>
  );

  const barColor = (pct: number) => (pct >= 99 ? 'bg-emerald-500' : pct >= 95 ? 'bg-amber-500' : 'bg-red-500');

  return (
    <section className="space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <Building2 className="w-4 h-4 text-[#12325c]" />
        <h2 className="text-sm font-bold text-slate-800">{t('تحليل الأقسام', 'By department')}</h2>
        <span className="text-[11px] text-slate-400">
          {t('اضغط أيّ رقم لعرض مَن فيه · واضغط اسمَ القسم لقصر اللوحة كلّها عليه',
             'Click any number to see who is in it · click a department to scope the whole board to it')}
        </span>
      </div>
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
        <ScrollX>
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-900 text-slate-300 text-xs">
                {head('department', t('القسم', 'Department'), 'text-start')}
                {head('total', t('الكل', 'All'))}
                {head('active', t('على رأس العمل', 'Active'))}
                {head('ended', t('منتهي خدماته', 'Ended'))}
                {head('contracts', t('عقود سارية', 'Contracts'))}
                {head('completeness', t('اكتمال البيانات', 'Data complete'))}
                {head('missing', t('خانات ناقصة', 'Missing fields'))}
                {head('peopleWithMissing', t('موظفون ناقصون', 'People missing data'))}
                {head('docsExpired', t('مستندات منتهية', 'Docs expired'))}
                {head('docsSoon', t('تنتهي قريبًا', 'Docs due soon'))}
                {head('leavesApproved', t('إجازات معتمدة', 'Leaves approved'))}
                {head('leavesPending', t('إجازات منتظرة', 'Leaves pending'))}
                {head('custody', t('عهد', 'Custody'))}
                {head('saudi', t('سعوديون', 'Saudis'))}
                {head('outside', t('خارج المملكة', 'Outside KSA'))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const dept = r.department || '';
                const q = dept ? { department: dept } : { department: '—' };
                const on = active === dept;
                return (
                  <tr key={dept || '—'} className={`border-b border-slate-100 ${on ? 'bg-[#f37121]/5' : 'hover:bg-slate-50'}`}>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <button type="button" onClick={() => onFilter(dept)}
                        className={`font-medium text-start hover:text-[#f37121] ${on ? 'text-[#f37121]' : 'text-slate-800'}`}>
                        {dept || t('(بلا قسم)', '(no department)')}
                      </button>
                    </td>
                    <Cell n={r.total} q={q} />
                    <Cell n={r.active} q={{ ...q, employment: 'active' }} tone="text-emerald-700" />
                    <Cell n={r.ended} q={{ ...q, employment: 'inactive' }} tone="text-slate-500" />
                    <Cell n={r.contracts} q={q} />
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1.5 justify-end">
                        <span className="tabular-nums text-xs font-semibold text-slate-700">{r.completeness}%</span>
                        <span className="w-14 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                          <span className={`block h-full ${barColor(r.completeness)}`} style={{ width: `${Math.max(2, r.completeness)}%` }} />
                        </span>
                      </div>
                    </td>
                    <Cell n={r.missing} q={{ ...q, status: 'required' }} tone="text-red-600" />
                    <Cell n={r.peopleWithMissing} q={{ ...q, status: 'required' }} tone="text-red-600" />
                    <Cell n={r.docsExpired} q={{ ...q, state: 'expired' }} tone="text-red-600" />
                    <Cell n={r.docsSoon} q={{ ...q, state: 'attention' }} tone="text-amber-600" />
                    <Cell n={r.leavesApproved} q={q} />
                    <Cell n={r.leavesPending} q={q} tone="text-sky-700" />
                    <Cell n={r.custody} q={q} />
                    <Cell n={r.saudi} q={{ ...q, nationality: 'سعودي' }} />
                    <Cell n={r.outside} q={{ ...q, outsideKingdom: '1' }} />
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="bg-slate-50 border-t border-slate-200 text-slate-800 font-semibold">
                <td className="px-3 py-2">{t('الإجمالي', 'Total')}</td>
                <td className="px-3 py-2 text-end tabular-nums">{(data.totals?.total || 0).toLocaleString('en-US')}</td>
                <td className="px-3 py-2 text-end tabular-nums">{(data.totals?.active || 0).toLocaleString('en-US')}</td>
                <td className="px-3 py-2 text-end tabular-nums">{(data.totals?.ended || 0).toLocaleString('en-US')}</td>
                <td className="px-3 py-2 text-end tabular-nums">{(data.totals?.contracts || 0).toLocaleString('en-US')}</td>
                <td className="px-3 py-2" />
                <td className="px-3 py-2 text-end tabular-nums">{(data.totals?.missing || 0).toLocaleString('en-US')}</td>
                <td className="px-3 py-2" />
                <td className="px-3 py-2 text-end tabular-nums">{(data.totals?.docsExpired || 0).toLocaleString('en-US')}</td>
                <td className="px-3 py-2 text-end tabular-nums">{(data.totals?.docsSoon || 0).toLocaleString('en-US')}</td>
                <td className="px-3 py-2 text-end tabular-nums">{(data.totals?.leavesApproved || 0).toLocaleString('en-US')}</td>
                <td className="px-3 py-2 text-end tabular-nums">{(data.totals?.leavesPending || 0).toLocaleString('en-US')}</td>
                <td className="px-3 py-2 text-end tabular-nums">{(data.totals?.custody || 0).toLocaleString('en-US')}</td>
                <td className="px-3 py-2" />
                <td className="px-3 py-2" />
              </tr>
            </tfoot>
          </table>
        </ScrollX>
      </div>
      <p className="text-[11px] text-slate-400">
        {t(`«اكتمال البيانات» من ${data.fieldsPerEmployee} خانةً لكلّ موظّف — وما عُلِّم «غير مطلوب» لا يُحسب ناقصًا.`,
           `"Data complete" is out of ${data.fieldsPerEmployee} fields per employee — a field marked not-required is not counted missing.`)}
      </p>
    </section>
  );
}
