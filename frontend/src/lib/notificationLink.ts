/**
 * أين يفتح الإشعار؟
 *
 * ── العلّة ──────────────────────────────────────────────────────────────────
 * قائمةُ الجرس كانت تعرض الإشعارَ ولا تذهب إليه: `onClick` مكتوبٌ لإشعارِ ملفِّ
 * التصدير وحدَه، وكلُّ ما عداه `div` بلا معالج. فيُقرأ «أُسنِدت إليك مهمّة»
 * ويُضغَط فلا يحدث شيء — ويُبحَث عن الشاشة بالقائمة الجانبيّة.
 *
 * والإشعارُ يحمل `relatedEntity` و`relatedEntityId`؛ منهما تُبنى الوجهة. وما
 * لا نعرف له وجهةً لا يُخمَّن: يبقى سطرًا يُقرأ ولا يُضغَط — ضغطةٌ تفتح شاشةً
 * خاطئةً أسوأُ من ضغطةٍ لا تفتح شيئًا.
 *
 * المسارات كلُّها مُتحقَّقٌ منها في `backend/src/config/pages.json`.
 */

/** الكياناتُ التي لها صفحةُ تفصيلٍ بالمعرّف. */
const BY_ID: Record<string, (id: string) => string> = {
  Employee: (id) => `/system/hr/employees/${id}`,
  FleetShipment: (id) => `/system/fleet/${id}`,
  CustomsClearance: (id) => `/system/customs/${id}`,
};

/** الكياناتُ التي تُفتَح على شاشةِ قسمِها. */
const BY_ENTITY: Record<string, string> = {
  Ls2Alert: '/system/ls2/alerts',
  Contract: '/system/hr/contracts',
  Asset: '/system/hr/custody',
  LeaveRequest: '/system/hr/leaves',
  HRRequest: '/system/hr/requests',
  CompanyLicense: '/system/hr/licenses',
  B2CDutyCheck: '/system/b2c/duty',
  FleetRequest: '/system/fleet/board',
  BrAction: '/system/business-review/my-actions',
  BrMeeting: '/system/business-review',
  RemoteTask: '/system/remote/dashboard',
  RemoteLeaveRequest: '/system/remote/leave',
  RemoteReport: '/system/remote/dashboard',
  SectionComplaint: '/system/operations/complaints',
};

export type NotificationLike = {
  relatedEntity?: string | null;
  relatedEntityId?: string | null;
  type?: string | null;
};

/** وجهةُ الإشعار، أو `null` إن لم تُعرَف — فلا يُضغَط. */
export function notificationHref(n: NotificationLike): string | null {
  const e = String(n?.relatedEntity || '');
  const id = n?.relatedEntityId ? String(n.relatedEntityId) : '';
  if (e && id && BY_ID[e]) return BY_ID[e](id);
  if (e && BY_ENTITY[e]) return BY_ENTITY[e];
  return null;
}

/** أيقونةٌ تُقرأ قبل النصّ — اسمُ أيقونةٍ من lucide يُترجمه المستدعي. */
export function notificationTone(n: NotificationLike): 'alert' | 'task' | 'ok' | 'info' {
  const t = String(n?.type || '');
  if (t === 'invoice_overdue' || t === 'dispute_opened' || t === 'system_alert') return 'alert';
  if (t === 'task_assigned' || t === 'complaint_assigned' || t === 'approval_needed') return 'task';
  if (t === 'payment_received' || t === 'dispute_resolved') return 'ok';
  return 'info';
}

/** «منذ كم» — بالعربيّة أو الإنجليزيّة، بلا مكتبة. */
export function sinceLabel(iso: string | Date | undefined, ar: boolean): string {
  if (!iso) return '';
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return '';
  const m = Math.floor(ms / 60000);
  if (m < 1) return ar ? 'الآن' : 'now';
  if (m < 60) return ar ? `منذ ${m} د` : `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return ar ? `منذ ${h} س` : `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return ar ? `منذ ${d} ي` : `${d}d ago`;
  return new Date(iso).toLocaleDateString(ar ? 'ar-EG' : 'en-GB');
}
