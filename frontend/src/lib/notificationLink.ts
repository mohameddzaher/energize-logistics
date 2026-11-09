/**
 * Where a notification opens.
 * The bell list showed the notification but did not navigate: `onClick` was written only for the export-file notification, and every other one was a div with no handler, so clicking did nothing. This maps each notification to its destination.
 */

/** Entities that have a detail page by id. */
const BY_ID: Record<string, (id: string) => string> = {
  Employee: (id) => `/system/hr/employees/${id}`,
  FleetShipment: (id) => `/system/fleet/${id}`,
  CustomsClearance: (id) => `/system/customs/${id}`,
  // A Media Go complaint opens in its list, and the id opens its detail; one screen serves both parties.
  MediaGoComplaint: (id) => `/system/b2c/mediago-complaints?id=${id}`,
  MediaGoAdRequest: (id) => `/system/b2c/mediago-ads/${id}`,
  // An HR request to Finance arrives in Finance's inbox, and the reply reaches the requester in the Finance follow-up page: two entities, two destinations, and the id opens the request itself.
  HrFinanceRequest: (id) => `/system/finance/hr/residency?tab=requests&id=${id}`,
  HrFinanceRequestReply: (id) => `/system/hr/finance-follow?tab=requests&id=${id}`,
  // A sales request reaches the vendors team's inbox; the answer (placed or rejected) reaches the sales member's requests.
  ShipmentRequest: (id) => `/system/vendors-mgmt/requests?id=${id}`,
  ShipmentRequestReply: (id) => `/system/shipment-orders/request?id=${id}`,
};

/** Entities that open on their section's screen. */
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
  // A task does not know its owner's section: `/system/jp` asks the server and goes to its plan.
  JpTask: '/system/jp',
};

export type NotificationLike = {
  relatedEntity?: string | null;
  relatedEntityId?: string | null;
  type?: string | null;
};

/** Notification destination, or `null` if unknown, in which case it is not clickable. */
export function notificationHref(n: NotificationLike): string | null {
  const e = String(n?.relatedEntity || '');
  const id = n?.relatedEntityId ? String(n.relatedEntityId) : '';
  if (e && id && BY_ID[e]) return BY_ID[e](id);
  if (e && BY_ENTITY[e]) return BY_ENTITY[e];
  return null;
}

/** An icon read before the text: a lucide icon name that the caller translates. */
export function notificationTone(n: NotificationLike): 'alert' | 'task' | 'ok' | 'info' {
  const t = String(n?.type || '');
  if (t === 'invoice_overdue' || t === 'dispute_opened' || t === 'system_alert') return 'alert';
  if (t === 'task_assigned' || t === 'complaint_assigned' || t === 'approval_needed') return 'task';
  if (t === 'payment_received' || t === 'dispute_resolved') return 'ok';
  return 'info';
}

/** Time since, in Arabic or English, with no library. */
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
  return new Date(iso).toLocaleDateString(ar ? 'ar-EG-u-nu-latn' : 'en-GB');
}
