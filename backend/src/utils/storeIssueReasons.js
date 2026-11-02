// Reason for a store issue. Every issue against a vehicle states why it left (periodic maintenance, accident, preventive, roadside breakdown), shown in the vehicle file with the part. The free-text note stays optional beside it.
const ISSUE_REASONS = [
  { key: 'periodic_maintenance', ar: 'صيانة دورية', en: 'Periodic maintenance' },
  { key: 'accident', ar: 'حادث', en: 'Accident' },
  { key: 'preventive_maintenance', ar: 'صيانة وقائية', en: 'Preventive maintenance' },
  { key: 'roadside_breakdown', ar: 'عطل على الطريق', en: 'Roadside breakdown' },
  // "General maintenance" was added at the owner's request.
  { key: 'general_maintenance', ar: 'صيانة عامة', en: 'General maintenance' },
];
const ISSUE_REASON_KEYS = ISSUE_REASONS.map((r) => r.key);
const issueReasonLabel = (key) => ISSUE_REASONS.find((r) => r.key === key)?.ar || '';

module.exports = { ISSUE_REASONS, ISSUE_REASON_KEYS, issueReasonLabel };
