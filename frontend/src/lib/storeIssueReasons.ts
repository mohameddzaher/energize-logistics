// Reason for stock issue; mirrors backend/src/utils/storeIssueReasons.js character for character.
export const ISSUE_REASONS: { key: string; ar: string; en: string }[] = [
  { key: 'periodic_maintenance', ar: 'صيانة دورية', en: 'Periodic maintenance' },
  { key: 'accident', ar: 'حادث', en: 'Accident' },
  { key: 'preventive_maintenance', ar: 'صيانة وقائية', en: 'Preventive maintenance' },
  { key: 'roadside_breakdown', ar: 'عطل على الطريق', en: 'Roadside breakdown' },
  { key: 'general_maintenance', ar: 'صيانة عامة', en: 'General maintenance' },
];
export const issueReasonLabel = (key: string | undefined, ar: boolean) => {
  const r = ISSUE_REASONS.find((x) => x.key === key);
  return r ? (ar ? r.ar : r.en) : '';
};
