// ── سببُ الصرف من المخزن (٢٠٢٦/١٠/٢٦) ───────────────────────────────────────
// «الملاحظة / السبب يتحوّل للسبب ويكون اختيارًا إجباريًّا»: كلُّ صادرٍ على مركبة
// يُقال لماذا خرج — صيانةٌ دوريّة أم حادثٌ أم وقائيّة أم عطلٌ على الطريق — ويظهر
// السببُ في ملفّ المركبة مع القطعة. والملاحظةُ الحرّة تبقى اختياريّةً بجانبه.
const ISSUE_REASONS = [
  { key: 'periodic_maintenance', ar: 'صيانة دورية', en: 'Periodic maintenance' },
  { key: 'accident', ar: 'حادث', en: 'Accident' },
  { key: 'preventive_maintenance', ar: 'صيانة وقائية', en: 'Preventive maintenance' },
  { key: 'roadside_breakdown', ar: 'عطل على الطريق', en: 'Roadside breakdown' },
];
const ISSUE_REASON_KEYS = ISSUE_REASONS.map((r) => r.key);
const issueReasonLabel = (key) => ISSUE_REASONS.find((r) => r.key === key)?.ar || '';

module.exports = { ISSUE_REASONS, ISSUE_REASON_KEYS, issueReasonLabel };
