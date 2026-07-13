// Driver report → professional multi-page PDF on the company letterhead.
// Shows what a driver actually did over a period: distance driven, the trucks
// they were on (with km per truck) and their full assignment history — including
// when they moved from one truck to another.
import api from '@/lib/api';
import { downloadReport, type Block } from '@/lib/reportPdf';
import { fmtNum, type Lang } from '@/lib/ls2';

const dt = (s?: string | null) => (s ? new Date(s).toLocaleDateString('en-GB') : '—');

export async function downloadDriverReport(driver: string, from: string, to: string, lang: Lang) {
  const ar = lang === 'ar';
  const t = (en: string, a: string) => (ar ? a : en);

  const d = await api.get<any>(`/api/ls2/drivers/${encodeURIComponent(driver)}?from=${from}&to=${to}`);

  const blocks: Block[] = [];

  blocks.push({
    kind: 'title',
    text: t('Driver Report', 'تقرير سائق'),
    sub: `${d.driver}  ·  ${from} → ${to}`,
  });

  blocks.push({ kind: 'section', text: t('Summary', 'الملخص') });
  blocks.push({
    kind: 'stats',
    items: [
      { label: t('Distance Driven', 'المسافة المقطوعة'), value: `${fmtNum(Math.round(d.km || 0))} km`, accent: true },
      { label: t('Trucks Driven', 'عدد المركبات'), value: String((d.vehicles || []).length) },
      { label: t('Current Truck', 'المركبة الحالية'), value: d.currentVehicle?.plate || '—' },
    ],
  });

  // Km per truck in the period.
  if ((d.vehicles || []).length) {
    blocks.push({ kind: 'section', text: t('Distance by Truck', 'المسافة لكل مركبة') });
    blocks.push({
      kind: 'table',
      head: [t('Plate', 'اللوحة'), t('Distance (km)', 'المسافة (كم)')],
      align: ['start', 'end'],
      rows: d.vehicles.map((v: any) => [v.plate || String(v.unitId), fmtNum(Math.round(v.km))]),
    });
  } else {
    blocks.push({ kind: 'note', text: t('No distance recorded for this driver in this period.', 'لا توجد مسافة مسجّلة لهذا السائق في هذه الفترة.') });
  }

  // Full assignment history (which truck, from when to when).
  if ((d.history || []).length) {
    blocks.push({ kind: 'section', text: t('Assignment History', 'سجل التعيينات') });
    blocks.push({
      kind: 'table',
      head: [t('Truck', 'المركبة'), t('From', 'من'), t('To', 'إلى')],
      align: ['start', 'start', 'start'],
      rows: d.history.map((h: any) => [
        h.plate || String(h.unitId),
        dt(h.from),
        h.to ? dt(h.to) : t('Current', 'حالي'),
      ]),
    });
    blocks.push({
      kind: 'note',
      text: t(
        'Driver changes are recorded from the moment tracking started; earlier periods are attributed to the truck\'s current driver.',
        'تغييرات السواقين تُسجَّل من وقت بدء التتبّع؛ الفترات الأقدم تُنسب للسائق الحالي للمركبة.'
      ),
    });
  }

  await downloadReport({
    fileName: `driver-${d.driver.replace(/\s+/g, '_')}-${from}_${to}`,
    lang,
    blocks,
    footerNote: `${t('Driver Report', 'تقرير سائق')} · ${d.driver} · ${from} → ${to}`,
  });
}
