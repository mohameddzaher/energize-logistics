// Full vehicle report (Location Solutions) → professional multi-page PDF on the
// company letterhead. Pulls everything we hold for one truck over a date range:
// identity, live status, distance, maintenance plan + service history, trips &
// stops, fuel, driver history and alerts. Bilingual (follows the site language).
import api from '@/lib/api';
import { downloadReport, type Block } from '@/lib/reportPdf';
import { fmtNum, fmtDuration, type Lang } from '@/lib/ls2';

const dt = (s?: string | null) => (s ? String(s).slice(0, 16).replace('T', ' ') : '—');
const day = (s?: string | null) => (s ? new Date(s).toLocaleDateString('en-GB') : '—');

export async function downloadVehicleReport(unitId: number, from: string, to: string, lang: Lang) {
  const ar = lang === 'ar';
  const t = (en: string, a: string) => (ar ? a : en);

  // Everything in parallel — each of these endpoints already exists.
  const [detail, mileage, history, trips, fuel] = await Promise.all([
    api.get<any>(`/api/ls2/vehicles/${unitId}`),
    api.get<any>(`/api/ls2/vehicles/${unitId}/mileage?from=${from}&to=${to}`).catch(() => null),
    api.get<any>(`/api/ls2/vehicles/${unitId}/history?from=${from}&to=${to}`).catch(() => ({ series: [] })),
    api.get<any>(`/api/ls2/vehicles/${unitId}/trips?from=${from}&to=${to}`).catch(() => null),
    api.get<any>(`/api/ls2/vehicles/${unitId}/fuel?from=${from}&to=${to}`).catch(() => null),
  ]);

  const v = detail.vehicle || {};
  const p = v.profile || {};
  const alerts: any[] = detail.alerts || [];
  const serviceLog: any[] = detail.serviceLog || [];
  const drivers: any[] = detail.driverHistory || [];

  const blocks: Block[] = [];

  blocks.push({
    kind: 'title',
    text: t('Vehicle Report', 'تقرير مركبة'),
    sub: `${v.plate || v.name || unitId}  ·  ${from} → ${to}`,
  });

  // ---- Identity -----------------------------------------------------------
  blocks.push({ kind: 'section', text: t('Vehicle Identity', 'بيانات المركبة') });
  blocks.push({
    kind: 'kv',
    items: [
      [t('Plate', 'اللوحة'), v.plate || '—'],
      [t('Current Driver', 'السائق الحالي'), v.driver || '—'],
      [t('Brand / Year', 'الماركة / السنة'), [p.brand, p.modelYear].filter(Boolean).join(' · ') || '—'],
      [t('Vehicle Type', 'نوع المركبة'), p.vehicleType || '—'],
      [t('VIN', 'رقم الشاسيه'), p.vin || '—'],
      [t('Tire Brand / Type', 'ماركة / نوع الكاوتش'), v.tireBrand || t('Not set', 'غير محدد')],
      [t('SIM (ICCID)', 'شريحة الاتصال'), p.simIccid || '—'],
      [t('Install Date', 'تاريخ التركيب'), p.installDate || '—'],
      [t('LS Unit ID', 'رقم الوحدة'), p.lsUnitId || '—'],
    ],
  });

  // ---- Current status -----------------------------------------------------
  blocks.push({ kind: 'section', text: t('Current Status', 'الحالة الحالية') });
  blocks.push({
    kind: 'stats',
    items: [
      { label: t('Odometer', 'العداد'), value: v.odometerKm != null ? `${fmtNum(v.odometerKm)} km` : '—', accent: true },
      { label: t('Engine Hours', 'ساعات الموتور'), value: v.engineHours != null ? `${fmtNum(Math.round(v.engineHours))} h` : '—' },
      { label: t('Coolant', 'حرارة الموتور'), value: v.coolantC != null ? `${v.coolantC}°C` : '—' },
      { label: t('Tire Temp max/min', 'حرارة الكاوتش أقصى/أقل'), value: v.maxTireTempC != null ? `${v.maxTireTempC}° / ${v.minTireTempC}°` : '—' },
      { label: t('Tire Press max/min', 'ضغط الكاوتش أقصى/أقل'), value: v.maxTirePressurePsi != null ? `${v.maxTirePressurePsi} / ${v.minTirePressurePsi}` : '—' },
    ],
  });

  // ---- Distance ------------------------------------------------------------
  blocks.push({ kind: 'section', text: t('Distance Travelled', 'المسافة المقطوعة') });
  blocks.push({
    kind: 'stats',
    items: [
      { label: t('Distance in period', 'المسافة في الفترة'), value: mileage?.km != null ? `${fmtNum(Math.round(mileage.km))} km` : '—', accent: true },
      { label: t('Odometer start', 'العداد بداية'), value: mileage?.odoStart != null ? `${fmtNum(mileage.odoStart)}` : '—' },
      { label: t('Odometer end', 'العداد نهاية'), value: mileage?.odoEnd != null ? `${fmtNum(mileage.odoEnd)}` : '—' },
      { label: t('Active days', 'أيام النشاط'), value: String(mileage?.activeDays ?? '—') },
    ],
  });
  const series: any[] = (history?.series || []).filter((d: any) => d.km > 0);
  if (series.length) {
    blocks.push({
      kind: 'table',
      head: [t('Date', 'التاريخ'), t('Distance (km)', 'المسافة (كم)')],
      align: ['start', 'end'],
      rows: series.map((d) => [d.date, fmtNum(Math.round(d.km))]),
    });
  }

  // ---- Maintenance ---------------------------------------------------------
  blocks.push({ kind: 'section', text: t('Maintenance Plan', 'خطة الصيانة') });
  const ivs: any[] = [...(v.serviceIntervals || [])].sort((a, b) => (a.intervalKm || 0) - (b.intervalKm || 0));
  if (ivs.length) {
    blocks.push({
      kind: 'table',
      head: [t('Service', 'الخدمة'), t('Every', 'كل'), t('Last Service', 'آخر صيانة'), t('Next At', 'الجاية عند'), t('Remaining', 'المتبقي'), t('Status', 'الحالة')],
      align: ['start', 'end', 'start', 'end', 'end', 'center'],
      rows: ivs.map((iv) => {
        const rem = iv.remainingKm;
        const over = rem != null && rem < 0;
        return [
          iv.name || '—',
          iv.intervalKm ? `${fmtNum(iv.intervalKm)} km` : '—',
          iv.lastServiceAt ? `${day(iv.lastServiceAt)}${iv.lastServiceKm != null ? ` · ${fmtNum(iv.lastServiceKm)}` : ''}` : '—',
          iv.nextServiceKm != null ? fmtNum(iv.nextServiceKm) : '—',
          { t: rem == null ? '—' : over ? `−${fmtNum(Math.abs(rem))}` : fmtNum(rem), color: over ? '#dc2626' : undefined },
          { t: over ? t('Overdue', 'متأخرة') : iv.statusLevel === 'due' ? t('Due soon', 'قريبة') : t('OK', 'سليم'), color: over ? '#dc2626' : iv.statusLevel === 'due' ? '#d97706' : '#059669' },
        ];
      }),
    });
  } else {
    blocks.push({ kind: 'note', text: t('No service intervals configured.', 'لا توجد خدمات صيانة مسجّلة.') });
  }

  if (serviceLog.length) {
    blocks.push({ kind: 'section', text: t('Service History', 'سجل الصيانة') });
    blocks.push({
      kind: 'table',
      head: [t('Date', 'التاريخ'), t('Type', 'النوع'), t('Odometer', 'العداد'), t('By', 'بواسطة'), t('Notes', 'ملاحظات')],
      align: ['start', 'start', 'end', 'start', 'start'],
      rows: serviceLog.map((s: any) => [day(s.createdAt), s.serviceType || '—', s.odometerKm != null ? fmtNum(s.odometerKm) : '—', s.performedByName || '—', s.notes || '—']),
    });
  }

  // ---- Driver history ------------------------------------------------------
  if (drivers.length) {
    blocks.push({ kind: 'section', text: t('Driver History', 'سجل السواقين') });
    blocks.push({
      kind: 'table',
      head: [t('Driver', 'السائق'), t('From', 'من'), t('To', 'إلى')],
      align: ['start', 'start', 'start'],
      rows: drivers.map((d: any) => [d.driver || '—', dt(d.from), d.to ? dt(d.to) : t('Current', 'حالي')]),
    });
  }

  // ---- Trips & stops -------------------------------------------------------
  if (trips?.summary) {
    blocks.push({ kind: 'section', text: t('Trips & Stops', 'الرحلات والوقفات') });
    blocks.push({
      kind: 'stats',
      items: [
        { label: t('Trips', 'الرحلات'), value: fmtNum(trips.summary.tripCount), accent: true },
        { label: t('Stops', 'الوقفات'), value: fmtNum(trips.summary.stopCount) },
        { label: t('Total Distance', 'إجمالي المسافة'), value: `${fmtNum(Math.round(trips.summary.totalKm))} km` },
        { label: t('Drive Time', 'زمن القيادة'), value: fmtDuration(trips.summary.totalDriveSec, lang) },
        { label: t('Max Speed', 'أقصى سرعة'), value: `${trips.summary.maxSpeed} km/h` },
      ],
    });
    if (trips.trips?.length) {
      blocks.push({
        kind: 'table',
        head: [t('Start', 'البداية'), t('From', 'من'), t('End', 'النهاية'), t('To', 'إلى'), t('Km', 'كم'), t('Duration', 'المدة')],
        align: ['start', 'start', 'start', 'start', 'end', 'end'],
        rows: trips.trips.map((tr: any) => [
          (tr.beginTime || '').slice(5, 16), (tr.beginLocation || '').slice(0, 34),
          (tr.endTime || '').slice(5, 16), (tr.endLocation || '').slice(0, 34),
          fmtNum(Math.round(tr.km)), fmtDuration(tr.durationSec, lang),
        ]),
      });
    }
  }

  // ---- Fuel ----------------------------------------------------------------
  if (fuel && (fuel.fuelL || fuel.efficiencyKmL)) {
    blocks.push({ kind: 'section', text: t('Fuel (from the truck\'s CAN bus)', 'الوقود (من كمبيوتر العربية)') });
    blocks.push({
      kind: 'stats',
      items: [
        { label: t('Fuel Consumed', 'الوقود المستهلك'), value: `${fmtNum(Math.round(fuel.fuelL))} L`, accent: true },
        { label: t('Efficiency', 'الكفاءة'), value: fuel.efficiencyKmL ? `${fuel.efficiencyKmL} km/L` : '—' },
        { label: t('Distance', 'المسافة'), value: fuel.distanceKm != null ? `${fmtNum(Math.round(fuel.distanceKm))} km` : '—' },
        { label: t('Engine-on Time', 'زمن تشغيل الموتور'), value: fmtDuration(fuel.engineOnSec, lang) },
      ],
    });
  }

  // ---- Alerts --------------------------------------------------------------
  if (alerts.length) {
    blocks.push({ kind: 'section', text: t('Alerts', 'التنبيهات') });
    blocks.push({
      kind: 'table',
      head: [t('Severity', 'الخطورة'), t('Type', 'النوع'), t('Message', 'الرسالة'), t('Since', 'منذ'), t('Status', 'الحالة')],
      align: ['center', 'start', 'start', 'start', 'center'],
      rows: alerts.slice(0, 60).map((a: any) => [
        { t: a.severity, color: a.severity === 'critical' ? '#dc2626' : a.severity === 'warning' ? '#d97706' : undefined },
        a.type, (a.message || '').slice(0, 46), dt(a.firstSeenAt),
        a.status === 'open' ? t('Open', 'مفتوح') : t('Resolved', 'مغلق'),
      ]),
    });
  }

  await downloadReport({
    fileName: `vehicle-${(v.plate || unitId).toString().replace(/\s+/g, '_')}-${from}_${to}`,
    lang,
    blocks,
    footerNote: `${t('Vehicle Report', 'تقرير مركبة')} · ${v.plate || unitId} · ${from} → ${to}`,
  });
}
