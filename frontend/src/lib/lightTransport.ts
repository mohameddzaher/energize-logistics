/**
 * النقلُ الخفيف — أنواعُه ونداءاتُه وأعمدةُ جدوله.
 *
 * والأعمدةُ تُعرَّف مرّةً واحدةً هنا: الترويسةُ والقمعُ والتصديرُ يقرؤون
 * التعريفَ نفسَه، فما يُفلتَر عليه هو ما يُعرَض وهو ما يُصدَّر حرفًا بحرف.
 * تعريفان يفترقان بعد أسبوعٍ من التعديل، فيُصدَّر عمودٌ لا يُرى ويُفلتَر على
 * قيمةٍ لا تُعرض.
 */
import api from '@/lib/api';

export interface LTEmployee {
  _id: string;
  idNumber: string;
  name: string;
  nationalityAr?: string;
  phone?: string;
  hireDate?: string | null;
  cityAr?: string;
  projectAr?: string;
  jobTitleAr?: string;
  staffKind?: 'rep' | 'admin';
  contractTypeAr?: string;
  registerNumber?: string;
  vehicleTypeAr?: string;
  vehiclePlate?: string;
  supervisorName?: string;
  workStatusAr?: string;
  /** الحالةُ كما تُقرأ: حالةُ القسم، تغلبها الموارد البشريّةُ حين تنفي. */
  workStatusShown?: string;
  statusSource?: 'hr' | 'section';
  hrLinked?: boolean;
  employeeNumber?: string;
  notesAr?: string;
  isActive?: boolean;
  housingRoom?: string;
  vehicle?: { _id: string; plateNumber?: string; serialNumber?: string; registrationTypeAr?: string; brandAr?: string; modelAr?: string } | null;
  housing?: { _id: string; name?: string; cityAr?: string } | null;
  employee?: { _id: string; employeeNumber?: string; arabicName?: string; employmentStatus?: string } | null;
  supervisor?: { _id: string; arabicName?: string; employeeNumber?: string } | null;
  history?: LTHistory[];
  createdAt?: string;
  updatedAt?: string;
}

export interface LTHistory {
  _id?: string; at?: string; byName?: string; kind?: string;
  fromValue?: string; toValue?: string; note?: string;
}

export interface LTTotals {
  total: number; reps: number; admins: number; working: number; notWorking: number;
  onLeave: number; terminated: number; withVehicle: number; withoutVehicle: number;
  hrLinked: number; ownedHere: number; housed: number; unhoused: number;
  byProject: Record<string, number>; byCity: Record<string, number>; byJob: Record<string, number>;
  byContract: Record<string, number>; byRegister: Record<string, number>;
  byVehicleType: Record<string, number>; bySupervisor: Record<string, number>;
  byStatus: Record<string, number>;
}

export interface LTOptions {
  project: string[]; city: string[]; jobTitle: string[]; contractType: string[];
  register: string[]; vehicleType: string[]; supervisor: string[];
  housing: { _id: string; name: string }[];
}

export interface LTRoom { _id?: string; name: string; kind: 'rep' | 'admin' | 'any'; capacity: number; notes?: string; occupied?: number; free?: number }
export interface LTHousing {
  _id: string; name: string; cityAr?: string; addressAr?: string;
  declaredCapacity?: number; rooms: LTRoom[]; isActive?: boolean; notes?: string;
  totalCapacity?: number; occupied?: number; free?: number;
}

export interface LTOrder {
  _id: string; orderNumber: string;
  ltEmployee: string; employeeName: string; employeeIdNumber: string;
  vehicle?: { _id: string; plateNumber?: string; registrationTypeAr?: string } | string | null;
  vehiclePlate?: string; vehicleTypeAr?: string;
  projectAr?: string; cityAr?: string; supervisorName?: string;
  housing?: { _id: string; name?: string } | string | null; housingRoom?: string;
  startDate?: string; endDate?: string | null; status: 'active' | 'ended'; endReasonAr?: string;
  authorizationMoved?: boolean; authorizationNumber?: string;
  authorizationStart?: string | null; authorizationEnd?: string | null;
  notesAr?: string; createdByName?: string; createdAt?: string;
}

const qs = (o: Record<string, string>) =>
  Object.entries(o).filter(([, v]) => v !== '' && v != null)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');

const BASE = '/api/light-transport';

export const getLTEmployees = (q: Record<string, string> = {}) =>
  api.get<{ employees: LTEmployee[]; totals: LTTotals; options: LTOptions }>(`${BASE}/employees${qs(q) ? `?${qs(q)}` : ''}`);
export const getLTEmployee = (id: string) =>
  api.get<{ employee: LTEmployee; orders: LTOrder[] }>(`${BASE}/employees/${id}`);
export const createLTEmployee = (body: any) => api.post<{ employee: LTEmployee }>(`${BASE}/employees`, body);
export const updateLTEmployee = (id: string, body: any) => api.put<{ employee: LTEmployee }>(`${BASE}/employees/${id}`, body);
export const deactivateLTEmployee = (id: string, reason: string) => api.post(`${BASE}/employees/${id}/deactivate`, { reason });

export const getLTHousing = () => api.get<{ housing: LTHousing[] }>(`${BASE}/housing`);
export const saveLTHousing = (id: string | null, body: any) =>
  (id ? api.put<{ housing: LTHousing }>(`${BASE}/housing/${id}`, body) : api.post<{ housing: LTHousing }>(`${BASE}/housing`, body));
export const deleteLTHousing = (id: string) => api.delete(`${BASE}/housing/${id}`);

export const getLTOrders = (q: Record<string, string> = {}) =>
  api.get<{ orders: LTOrder[]; totals: { total: number; active: number; ended: number; authorizationMoved: number } }>(`${BASE}/orders${qs(q) ? `?${qs(q)}` : ''}`);
export const getLTOrderOptions = () => api.get<{
  employees: { _id: string; name: string; idNumber: string; jobTitleAr?: string; staffKind?: string; projectAr?: string; cityAr?: string; vehiclePlate?: string; supervisorName?: string }[];
  vehicles: { _id: string; plateNumber: string; serialNumber?: string; typeAr?: string; brand?: string; authorizedName?: string; authorizedId?: string }[];
  housing: { _id: string; name: string; rooms: { name: string; kind: string; capacity: number }[] }[];
  supervisors: string[];
}>(`${BASE}/orders/options`);
export const createLTOrder = (body: any) => api.post<{ order: LTOrder }>(`${BASE}/orders`, body);
export const endLTOrder = (id: string, body: any) => api.post<{ order: LTOrder }>(`${BASE}/orders/${id}/end`, body);

// ── العرض ───────────────────────────────────────────────────────────────────
export const fmtDate = (d?: string | null) => (d ? new Date(d).toISOString().slice(0, 10) : '');

/** شرائحُ الحالة بلونها — «إنهاء خدمة» و«متوقف» ليستا محايدتين. */
export const LT_STATUS: Record<string, { cls: string }> = {
  'يعمل': { cls: 'bg-emerald-100 text-emerald-700' },
  'إجازة': { cls: 'bg-sky-100 text-sky-700' },
  'متوقف': { cls: 'bg-amber-100 text-amber-700' },
  'إنهاء خدمة': { cls: 'bg-red-100 text-red-700' },
};
export const statusCls = (s?: string) => LT_STATUS[String(s || '')]?.cls || 'bg-slate-100 text-slate-600';

export const KIND_AR: Record<string, string> = { rep: 'مندوب', admin: 'إداري' };
export const KIND_EN: Record<string, string> = { rep: 'Rep', admin: 'Admin' };

/** أسبابُ قيدِ السجلّ بلغةٍ تُقرأ — لا مفاتيحُ إنجليزيّة في شاشةٍ عربيّة. */
export const HISTORY_KIND: Record<string, { ar: string; en: string }> = {
  created: { ar: 'أُنشئ السجلّ', en: 'Record created' },
  project: { ar: 'نقلٌ بين المشاريع', en: 'Project moved' },
  city: { ar: 'نقلٌ بين الفروع', en: 'Branch moved' },
  supervisor: { ar: 'تغييرُ المشرف', en: 'Supervisor changed' },
  vehicle: { ar: 'تغييرُ المركبة', en: 'Vehicle changed' },
  housing: { ar: 'تغييرُ السكن', en: 'Housing changed' },
  status: { ar: 'تغييرُ الحالة', en: 'Status changed' },
  order: { ar: 'أمرُ تشغيل', en: 'Operating order' },
  authorization: { ar: 'نقلُ تفويض', en: 'Authorisation moved' },
};

/**
 * ── أعمدةُ الجدول: تعريفٌ واحدٌ للترويسة والقمع والتصدير ────────────────────
 * كلُّ عمودٍ يقول اسمَه وكيف يُقرأ. و«اللوحة» و«الإجراءات» تُثبَّتان في الأوّل
 * (راجع components/vehicles/stickyLead): الجدولُ عرضُه عشرون عمودًا، ومن يمرّ
 * يمينًا يفقد مَن يقرأ عنه.
 */
export type LTCol = { key: string; ar: string; en: string; get: (e: LTEmployee) => any; width?: number; mono?: boolean };

export const LT_COLUMNS: LTCol[] = [
  { key: 'plate', ar: 'رقم اللوحة', en: 'Plate', get: (e) => e.vehiclePlate || '', width: 14, mono: true },
  { key: 'name', ar: 'الاسم', en: 'Name', get: (e) => e.name, width: 30 },
  { key: 'idNumber', ar: 'رقم الهوية', en: 'ID number', get: (e) => e.idNumber, width: 14, mono: true },
  { key: 'jobTitleAr', ar: 'الوظيفة', en: 'Job', get: (e) => e.jobTitleAr || '', width: 12 },
  { key: 'staffKind', ar: 'النوع', en: 'Kind', get: (e) => KIND_AR[e.staffKind || ''] || '', width: 10 },
  { key: 'projectAr', ar: 'المشروع', en: 'Project', get: (e) => e.projectAr || '', width: 14 },
  { key: 'cityAr', ar: 'الفرع', en: 'Branch', get: (e) => e.cityAr || '', width: 12 },
  { key: 'supervisorName', ar: 'المشرف', en: 'Supervisor', get: (e) => e.supervisorName || '', width: 18 },
  { key: 'vehicleTypeAr', ar: 'نوع المركبة', en: 'Vehicle type', get: (e) => e.vehicleTypeAr || '', width: 14 },
  { key: 'contractTypeAr', ar: 'نوع التعاقد', en: 'Contract', get: (e) => e.contractTypeAr || '', width: 12 },
  { key: 'registerNumber', ar: 'رقم السجل', en: 'Register', get: (e) => e.registerNumber || '', width: 16, mono: true },
  { key: 'workStatus', ar: 'حالة العمل', en: 'Status', get: (e) => e.workStatusShown || '', width: 12 },
  { key: 'nationalityAr', ar: 'الجنسية', en: 'Nationality', get: (e) => e.nationalityAr || '', width: 12 },
  { key: 'hireDate', ar: 'تاريخ التعيين', en: 'Hire date', get: (e) => fmtDate(e.hireDate), width: 13, mono: true },
  { key: 'phone', ar: 'الجوال', en: 'Phone', get: (e) => e.phone || '', width: 13, mono: true },
  { key: 'housing', ar: 'السكن', en: 'Housing', get: (e) => e.housing?.name || '', width: 14 },
  { key: 'housingRoom', ar: 'الغرفة', en: 'Room', get: (e) => e.housingRoom || '', width: 12 },
  { key: 'serialNumber', ar: 'الرقم التسلسلي', en: 'Serial', get: (e) => e.vehicle?.serialNumber || '', width: 15, mono: true },
  { key: 'hrLinked', ar: 'ملفّ الموارد البشرية', en: 'HR file', get: (e) => (e.hrLinked ? (e.employeeNumber || 'مربوط') : 'لا ملفّ'), width: 16 },
  { key: 'notesAr', ar: 'ملاحظات', en: 'Notes', get: (e) => e.notesAr || '', width: 28 },
];

/** ما يُثبَّت في أوّل الجدول — واللوحةُ أوّلُ ما يُسأل عنه في هذا القسم. */
export const LT_PINNED = ['plate'];

export const canEditLT = (u?: { role?: string | null; permissions?: Record<string, string> | null } | null) =>
  ['super_admin', 'admin', 'b2c_manager', 'b2c_project_lead', 'it_manager'].includes(String(u?.role || ''))
  || u?.permissions?.B2C === 'edit';
