// Full vehicle report (Location Solutions) → professional multi-page PDF on the
// company letterhead. Pulls everything we hold for one truck over a date range:
// identity, live status, distance, the maintenance plan with the full service
// history (including each service's checklist and any deferred tasks), the
// exceptional repairs, fuel, driver history and alerts. Bilingual (follows the
// site language).
import api from '@/lib/api';
import { downloadReport, type Block } from '@/lib/reportPdf';
import { fmtNum, fmtDuration, repairCategoryLabel, REPAIR_SEVERITIES, REPAIR_STATUSES, type Lang } from '@/lib/ls2';

const dt = (s?: string | null) => (s ? String(s).slice(0, 16).replace('T', ' ') : '—');
const day = (s?: string | null) => (s ? new Date(s).toLocaleDateString('en-GB') : '—');

export async function downloadVehicleReport(unitId: number, from: string, to: string, lang: Lang) {
  const ar = lang === 'ar';
  const t = (en: string, a: string) => (ar ? a : en);

  // Everything in parallel — each of these endpoints already exists.
  const [detail, mileage, history, maint, fuel] = await Promise.all([
    api.get<any>(`/api/ls2/vehicles/${unitId}`),
    api.get<any>(`/api/ls2/vehicles/${unitId}/mileage?from=${from}&to=${to}`).catch(() => null),
    api.get<any>(`/api/ls2/vehicles/${unitId}/history?from=${from}&to=${to}`).catch(() => ({ series: [] })),
    api.get<any>(`/api/ls2/vehicles/${unitId}/maintenance`).catch(() => null),
    api.get<any>(`/api/ls2/vehicles/${unitId}/fuel?from=${from}&to=${to}`).catch(() => null),
  ]);

  const v = detail.vehicle || {};
  const p = v.profile || {};
  const alerts: any[] = detail.alerts || [];
  // The maintenance endpoint carries the richer history (checklists) — fall back
  // to the vehicle detail's own log if it is unavailable.
  const serviceLog: any[] = maint?.history || detail.serviceLog || [];
  const deferrals: any[] = maint?.deferrals || [];
  const repairs: any[] = maint?.repairs || [];
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

  // ---- Deferred tasks: inspected, granted extra km, still outstanding -------
  if (deferrals.length) {
    blocks.push({ kind: 'section', text: t('Deferred Tasks', 'البنود المؤجّلة') });
    blocks.push({ kind: 'note', text: t('Inspected during a service and judged serviceable for a further distance — each is alerted on before that distance runs out.', 'تم فحصها أثناء الصيانة واعتُبرت صالحة لمسافة إضافية — ويصدر تنبيه قبل انتهاء تلك المسافة.') });
    blocks.push({
      kind: 'table',
      head: [t('Task', 'البند'), t('Service', 'الخدمة'), t('Deferred On', 'أُجِّل بتاريخ'), t('Extra Km', 'كم إضافية'), t('Due At', 'الاستحقاق عند'), t('Remaining', 'المتبقي')],
      align: ['start', 'start', 'start', 'end', 'end', 'end'],
      rows: deferrals.map((d: any) => {
        const over = d.remainingKm != null && d.remainingKm < 0;
        return [
          d.label || '—',
          d.intervalName || '—',
          `${day(d.deferredAt)}${d.deferredAtOdometerKm != null ? ` · ${fmtNum(d.deferredAtOdometerKm)}` : ''}`,
          d.deferKm != null ? fmtNum(d.deferKm) : '—',
          fmtNum(d.dueAtOdometerKm),
          { t: d.remainingKm == null ? '—' : over ? `−${fmtNum(Math.abs(d.remainingKm))}` : fmtNum(d.remainingKm), color: over ? '#dc2626' : '#d97706' },
        ];
      }),
    });
  }

  // ---- Service history, with what was actually done on each visit -----------
  if (serviceLog.length) {
    blocks.push({ kind: 'section', text: t('Service History', 'سجل الصيانة') });
    blocks.push({
      kind: 'table',
      head: [t('Date', 'التاريخ'), t('Service', 'الخدمة'), t('Odometer', 'العداد'), t('Cost', 'التكلفة'), t('By', 'بواسطة'), t('Notes', 'ملاحظات')],
      align: ['start', 'start', 'end', 'end', 'start', 'start'],
      rows: serviceLog.map((s: any) => [
        day(s.serviceDate || s.createdAt),
        s.intervalName || s.serviceType || '—',
        s.odometerKm != null ? fmtNum(s.odometerKm) : '—',
        s.cost != null ? fmtNum(s.cost) : '—',
        s.performedByName || '—',
        s.notes || '—',
      ]),
    });

    // Per-visit checklist detail — only for visits that recorded one.
    const withChecklist = serviceLog.filter((s: any) => (s.checklist?.length || 0) > 0);
    if (withChecklist.length) {
      blocks.push({ kind: 'section', text: t('Service Checklists', 'قوائم فحص الصيانة') });
      for (const s of withChecklist) {
        blocks.push({ kind: 'note', text: `${s.intervalName || t('Service', 'صيانة')} · ${day(s.serviceDate || s.createdAt)}${s.odometerKm != null ? ` · ${fmtNum(s.odometerKm)} km` : ''}` });
        blocks.push({
          kind: 'table',
          head: [t('Task', 'البند'), t('Outcome', 'النتيجة'), t('Extra Km', 'كم إضافية'), t('Due At', 'الاستحقاق عند'), t('Note', 'ملاحظة')],
          align: ['start', 'center', 'end', 'end', 'start'],
          rows: s.checklist.map((c: any) => [
            c.label || '—',
            c.status === 'done'
              ? { t: t('Done', 'تم'), color: '#059669' }
              : c.status === 'deferred'
                ? { t: c.resolved ? t('Deferred · since done', 'مؤجّل · تم لاحقًا') : t('Deferred', 'مؤجّل'), color: c.resolved ? '#059669' : '#d97706' }
                : { t: t('Not needed', 'غير مطلوب'), color: '#64748b' },
            c.deferKm != null ? fmtNum(c.deferKm) : '—',
            c.dueAtOdometerKm != null ? fmtNum(c.dueAtOdometerKm) : '—',
            c.note || '—',
          ]),
        });
      }
    }
  }

  // ---- Exceptional repairs: breakdowns, accidents, faults ------------------
  if (repairs.length) {
    blocks.push({ kind: 'section', text: t('Exceptional Repairs', 'الصيانة الاستثنائية') });
    blocks.push({ kind: 'note', text: t('Unscheduled work — not part of the periodic service plan.', 'أعمال غير مجدولة — ليست ضمن خطة الصيانة الدورية.') });
    blocks.push({
      kind: 'table',
      head: [t('Date', 'التاريخ'), t('What happened', 'ما الذي حدث'), t('Category', 'التصنيف'), t('Severity', 'الأهمية'), t('Odometer', 'العداد'), t('Cost', 'التكلفة'), t('Workshop', 'الورشة'), t('Status', 'الحالة')],
      align: ['start', 'start', 'start', 'center', 'end', 'end', 'start', 'center'],
      rows: repairs.map((r: any) => {
        const sev = REPAIR_SEVERITIES[r.severity];
        const st = REPAIR_STATUSES[r.status];
        return [
          day(r.repairDate),
          [r.title, r.partsReplaced ? `(${r.partsReplaced})` : ''].filter(Boolean).join(' ').slice(0, 46),
          repairCategoryLabel(r.category, lang),
          { t: sev ? (ar ? sev.ar : sev.en) : r.severity, color: r.severity === 'high' ? '#dc2626' : r.severity === 'medium' ? '#d97706' : undefined },
          r.odometerKm != null ? fmtNum(r.odometerKm) : '—',
          r.cost != null ? fmtNum(r.cost) : '—',
          (r.workshop || '—').slice(0, 24),
          { t: st ? (ar ? st.ar : st.en) : r.status, color: r.status === 'done' ? '#059669' : r.status === 'open' ? '#dc2626' : '#d97706' },
        ];
      }),
    });
    const totalCost = repairs.reduce((a: number, r: any) => a + (r.cost || 0), 0);
    if (totalCost) blocks.push({ kind: 'note', text: `${t('Total repair cost', 'إجمالي تكلفة الإصلاحات')}: ${fmtNum(totalCost)}` });
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
