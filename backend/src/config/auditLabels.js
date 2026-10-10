/**
 * auditLabels — كلُّ ما يُقرأ في سجلّ المراجعة: اسمُ الفعل، واسمُ الكيان، واسمُ
 * الحقل، وقيمتُه.
 *
 * ── لماذا في الخادم ─────────────────────────────────────────────────────────
 * كانت هذه الخرائطُ في الواجهة، والتطبيقُ يعرض السجلَّ نفسَه بمفاتيحه الخام
 * (`update_workflow · OperationsWorkflow`). خريطتان في مكانين تفترقان عند أوّل
 * فعلٍ يُضاف، فصارت واحدةً هنا يقرأ منها الموقعُ والتطبيقُ جملةً جاهزة.
 *
 * ── وأسماءُ الحقول لا تُخترَع ───────────────────────────────────────────────
 * حقلُ الموظّف يُسمّى من `hrFields`، ووثيقةُ المركبة من `vehicleDocuments`،
 * والدورُ من `roles`، والقسمُ من `sections` — الاسمُ الذي يراه المستخدمُ في
 * شاشته هو الذي يقرؤه هنا. وأعمدةُ كشف التشغيل لا مصدرَ لها في الخادم (تُعرَّف
 * في صفحة العمليات نفسِها)، فنُقلت عناوينُها كما هي من
 * `frontend/src/app/system/operations/page.tsx`.
 */

/** فعلٌ بعينه → جملتُه. */
const ACTION_AR = {
  // الدخول والحسابات
  login: 'تسجيل دخول',
  logout: 'تسجيل خروج',
  create_user: 'إنشاء مستخدم',
  update_user: 'تعديل بيانات مستخدم',
  delete_user: 'حذف مستخدم',
  reset_password: 'إعادة تعيين كلمة مرور',
  change_password: 'تغيير كلمة المرور',
  lock_user: 'قفل حساب',
  unlock_user: 'فتح حساب',
  update_profile: 'تعديل الملف الشخصي',
  create_partner_account: 'إنشاء حساب شريك',
  update_role_permissions: 'تعديل صلاحيات دور',

  // المحفظة والعهدة
  wallet_transaction: 'تسجيل حركة في المحفظة',
  update_wallet_transaction: 'تعديل حركة في المحفظة',
  delete_wallet_transaction: 'حذف حركة من المحفظة',
  close_wallet_day: 'إقفال يوم المحفظة',
  auto_close_wallet_day: 'إقفال تلقائي ليوم المحفظة',
  reopen_wallet_day: 'إعادة فتح يوم مُقفل',
  set_opening_balance: 'ضبط الرصيد الافتتاحي',
  cash_difference_alert: 'تنبيه فرق نقدي',

  // الموارد البشرية
  create_employee: 'إضافة موظف',
  update_employee: 'تعديل ملف موظف',
  update_employee_fields: 'تعديل حقول في ملف موظف',
  delete_employee: 'حذف موظف',
  terminate_employee: 'إنهاء خدمة موظف',
  reactivate_employee: 'إعادة موظف للخدمة',
  add_employee_document: 'رفع مستند لموظف',
  update_employee_document: 'تعديل مستند موظف',
  delete_employee_document: 'حذف مستند موظف',
  renew_document: 'تجديد مستند موظف',
  renew_contract: 'تجديد عقد',
  data_fix: 'تصحيح بيانات',

  // التشغيل والتحصيل
  create_workflow: 'إنشاء عملية تشغيل',
  update_workflow: 'تعديل عملية تشغيل',
  delete_workflow: 'حذف عملية تشغيل',
  workflow_stage_change: 'تغيير مرحلة عملية تشغيل',
  bulk_update: 'تعديل جماعي',
  bulk_import_workflows: 'استيراد عمليات تشغيل',
  record_collection: 'تسجيل تحصيل',
  record_delivery: 'تسجيل تسليم',
  set_collection_detail: 'تعديل تفاصيل تحصيل',
  apply_collections_book: 'مطابقة دفتر التحصيل',
  apply_payment_types: 'تطبيق أنواع السداد',
  create_collections_party: 'إضافة طرف تحصيل',
  update_collections_party: 'تعديل طرف تحصيل',
  delete_collections_party: 'حذف طرف تحصيل',
  deactivate_collections_party: 'إيقاف طرف تحصيل',
  log_collections_follow_up: 'تسجيل متابعة تحصيل',
  delete_collections_follow_up: 'حذف متابعة تحصيل',
  set_customer_payment_type: 'تحديد نوع سداد عميل',
  unify_customer_payment_type: 'توحيد نوع سداد عميل',
  create_customer: 'إضافة عميل',
  update_payment: 'تعديل دفعة',

  // المركبات
  renew_vehicle_document: 'تجديد مستند مركبة',
  add_vehicle_document: 'إضافة مستند مركبة',
  update_vehicle_document: 'تعديل مستند مركبة',
  update_vehicle_alert_settings: 'تعديل عتبات تنبيه المركبات',
  assign_vehicle_authorization: 'إسناد تفويض مركبة',
  revoke_vehicle_authorization: 'إلغاء تفويض مركبة',
  assign_fuel_card: 'ربط شريحة وقود',
  remove_fuel_card: 'فكّ شريحة وقود',
  renew_insurance_policy: 'تجديد وثيقة تأمين',
  update_corporate_policy: 'تعديل وثيقة شركة',
  renew_corporate_policy: 'تجديد وثيقة شركة',
  end_corporate_policy: 'إنهاء وثيقة شركة',
  create_vehicle_claim: 'تسجيل حادث مركبة',
  update_vehicle_claim: 'تعديل حادث مركبة',
  add_claim_attachment: 'إرفاق ملف بحادث',
  delete_claim_attachment: 'حذف مرفق من حادث',
  renew_driver_card: 'تجديد بطاقة سائق',
  add_driver_to_policy: 'ضمّ سائق لوثيقة خيانة الأمانة',
  remove_driver_from_policy: 'رفع سائق من وثيقة خيانة الأمانة',

  // النقل الخفيف و b2c
  create_lt_employee: 'إضافة موظف نقل خفيف',
  update_lt_employee: 'تعديل موظف نقل خفيف',
  create_lt_order: 'إنشاء أمر تشغيل',
  end_lt_order: 'إنهاء أمر تشغيل',
  move_lt_authorization: 'نقل تفويض مركبة (من النقل الخفيف)',
  assign_lt_supervisors: 'إسناد مشرف لموظفي النقل الخفيف',
  create_b2c_rep: 'إضافة مندوب',
  update_b2c_rep: 'تعديل مندوب',
  assign_b2c_supervisor: 'إسناد مشرف لمندوبين',
  create_b2c_duty_check: 'تسجيل تفقّد بداية الدوام',
  update_b2c_duty_check: 'تعديل تفقّد بداية الدوام',
  review_b2c_duty_check: 'مراجعة تفقّد بداية الدوام',
  create_b2c_project: 'إنشاء مشروع b2c',
  update_b2c_project: 'تعديل مشروع b2c',
  b2c_cleanup_all: 'تنظيف بيانات b2c',
  b2c_cleanup_orders: 'تنظيف طلبات b2c',

  // الأسطول والورشة والمخزن
  assign_supervisor: 'إسناد مشرف لسيارة',
  pay_driver_expense: 'صرف مصروف سائق',
  unpay_driver_expense: 'تراجع عن صرف مصروف سائق',
  create_fleet_vehicle_log: 'تسجيل في سجلّ سيارة',
  delete_fleet_vehicle_log: 'حذف من سجلّ سيارة',
  reverse_store_movement: 'عكس حركة مخزن',
  correct_store_movement: 'تصحيح حركة مخزن',
  issue: 'صرف صنف',
  unissue: 'إلغاء صرف صنف',
  receive: 'استلام',
  fulfill: 'تنفيذ',
  complete: 'إكمال',
  updateStatus: 'تغيير الحالة',

  // التخليص الجمركي
  create_customs_clearance: 'إنشاء معاملة تخليص',
  update_customs_clearance: 'تعديل معاملة تخليص',
  complete_customs_clearance: 'إنهاء معاملة تخليص',
  reopen_customs_clearance: 'إعادة فتح معاملة تخليص',
  add_customs_payment_stage: 'إضافة مرحلة سداد جمركي',
  add_customs_attachment: 'إرفاق ملف بمعاملة تخليص',
  delete_customs_attachment: 'حذف مرفق من معاملة تخليص',

  // إدارية
  create_branch: 'إنشاء فرع',
  create_lookup: 'إضافة قيمة لقائمة',
  update_lookup: 'تعديل قيمة في قائمة',
  delete_lookup: 'حذف قيمة من قائمة',
  create_company_email: 'إنشاء بريد شركة',
  update_company_email: 'تعديل بريد شركة',
  delete_company_email: 'حذف بريد شركة',
  reveal_company_email_password: 'كشف كلمة مرور بريد',
  export_company_email_passwords: 'تصدير كلمات مرور البريد',
  repair_integrity: 'إصلاح تكامل البيانات',
};

/** أفعالٌ عامّة تُقرأ مع اسم الكيان: «إنشاء · حمولة أسطول». */
const GENERIC_AR = {
  create: 'إنشاء', add: 'إضافة', update: 'تعديل', edit: 'تعديل',
  delete: 'حذف', remove: 'إزالة', assign: 'إسناد', revoke: 'إلغاء',
  transfer: 'نقل', import: 'استيراد', export: 'تصدير',
  activate: 'تفعيل', deactivate: 'إيقاف', approve: 'اعتماد', reject: 'رفض',
  lock: 'قفل', unlock: 'فتح', renew: 'تجديد', close: 'إقفال', reopen: 'إعادة فتح',
};


/** أسماءُ الكيانات — كلُّ نموذجٍ يُقيَّد عليه فعلٌ في الخادم له اسمٌ يُقرأ. */
const ENTITY_LABELS = {
  User: ['مستخدم', 'User'], Customer: ['عميل', 'Customer'], Invoice: ['فاتورة', 'Invoice'],
  Payment: ['دفعة', 'Payment'], Dispute: ['نزاع', 'Dispute'], Branch: ['فرع', 'Branch'],
  Vendor: ['مورد', 'Vendor'], Employee: ['موظف', 'Employee'], Contract: ['عقد', 'Contract'],
  Asset: ['عهدة', 'Asset'], ShipmentOrder: ['طلب شحن', 'Shipment order'],
  FleetShipment: ['حمولة أسطول', 'Fleet shipment'], FleetDriver: ['سائق أسطول', 'Fleet driver'],
  FleetVehicle: ['سيارة أسطول', 'Fleet vehicle'], FleetCustomer: ['عميل أسطول', 'Fleet customer'],
  FleetRequest: ['طلب صيانة أسطول', 'Fleet service request'],
  FleetVehicleLog: ['سجل سيارة أسطول', 'Fleet vehicle log'], FleetDriverExpense: ['مصروف سائق', 'Driver expense'],
  MaintenanceRequest: ['طلب صيانة', 'Maintenance request'], InventoryItem: ['صنف مستودع', 'Store item'],
  WorkshopPurchaseRequest: ['طلب شراء ورشة', 'Workshop purchase request'], WorkshopTask: ['مهمة ورشة', 'Workshop task'],
  Ls2StoreMovement: ['حركة مستودع', 'Store movement'], Ls2Asset: ['أصل مستودع', 'Store asset'],
  WalletTransaction: ['حركة عهدة', 'Wallet transaction'], DailyWallet: ['يومية عهدة', 'Wallet day'],
  CustomsClearance: ['معاملة تخليص', 'Customs clearance'], CustomsContract: ['عقد تخليص', 'Customs contract'],
  B2C: ['بيانات قطاع الأفراد', 'B2C data'], B2CProject: ['مشروع قطاع الأفراد', 'B2C project'],
  B2CRep: ['مندوب', 'B2C rep'], B2CDutyCheck: ['تفقّد بداية الدوام', 'Duty check'],
  B2CWalletEntry: ['قيد عهدة مشروع', 'B2C wallet entry'],
  LightTransportEmployee: ['موظف نقل خفيف', 'Light-transport employee'],
  LightTransportOrder: ['أمر تشغيل نقل خفيف', 'Light-transport order'],
  CompanyLicense: ['ترخيص شركة', 'Company licence'], LeaveRequest: ['طلب إجازة', 'Leave request'],
  HrFormTemplate: ['نموذج موارد بشرية', 'HR form template'], StaffStatusRequest: ['طلب تغيير حالة موظف', 'Staff status request'],
  VehicleMaster: ['مركبة', 'Vehicle'], VehicleInsurancePolicy: ['وثيقة تأمين مركبات', 'Vehicle insurance policy'],
  VehicleRegistryConfig: ['إعدادات سجل المركبات', 'Vehicle registry settings'],
  VehicleAuthorization: ['تفويض مركبة', 'Vehicle authorisation'], VehicleAccident: ['حادث مركبة', 'Vehicle accident'],
  VehicleClaim: ['حادث مركبة', 'Vehicle claim'], DriverCard: ['بطاقة سائق', 'Driver card'],
  CorporatePolicy: ['وثيقة تأمين الشركة', 'Corporate policy'], Driver: ['سائق', 'Driver'],
  OperationsWorkflow: ['كشف تشغيل', 'Operations report'], PrivateSellingPrice: ['سعر البيع الخاص', 'Private selling price'],
  CollectionsParty: ['طرف تحصيل', 'Collections party'], CollectionsFollowUp: ['متابعة تحصيل', 'Collections follow-up'],
  CompanyEmail: ['بريد شركة', 'Company email'], RolePermission: ['صلاحيات دور', 'Role permissions'],
  CustomRole: ['دور مخصص', 'Custom role'], Lookup: ['قيمة قائمة', 'Lookup value'], System: ['النظام', 'System'],
  PartnerAccount: ['حساب شريك', 'Partner account'], CrmVendor: ['مورد نقل', 'Carrier'],
  JournalEntry: ['قيد محاسبي', 'Journal entry'], Complaint: ['شكوى', 'Complaint'],
  tender: ['مناقصة', 'Tender'], partner: ['شريك أعمال', 'Business partner'],
  opportunity: ['فرصة أعمال', 'Opportunity'], activity: ['نشاط تطوير أعمال', 'BD activity'],
  BrMeeting: ['اجتماع مراجعة', 'Review meeting'], BrAction: ['بند اجتماع', 'Meeting action'],
  BrAssignment: ['تكليف اجتماع', 'Meeting assignment'],
};

const humanise = (k) => String(k || '')
  .replace(/(Ar|Sar)$/, '')
  .replace(/_/g, ' ')
  .replace(/([a-z\d])([A-Z])/g, '$1 $2')
  .trim()
  .toLowerCase();

const entityLabel = (e, lang = 'ar') => {
  const m = ENTITY_LABELS[e];
  if (!m) return lang === 'en' ? humanise(e) : String(e || '');
  return lang === 'en' ? m[1] : m[0];
};

/** ما جرى، جملةً واحدة. الفعلُ العامّ («create») يُقرأ مع كيانه. */
const actionLabel = (action, entity, lang = 'ar') => {
  const a = String(action || '');
  if (lang === 'en') return humanise(a);
  if (ACTION_AR[a]) return ACTION_AR[a];
  const ent = entity ? entityLabel(entity, 'ar') : '';
  if (GENERIC_AR[a]) return ent ? `${GENERIC_AR[a]} ${ent}` : GENERIC_AR[a];
  const [verb, ...rest] = a.split('_');
  // فعلٌ مُركَّبٌ لم يُكتب بعد: يُقرأ بفعله وكيانه، لا ببقيّةٍ إنجليزيّة.
  if (GENERIC_AR[verb]) return ent ? `${GENERIC_AR[verb]} ${ent}` : `${GENERIC_AR[verb]} ${rest.join(' ')}`.trim();
  return a.replace(/_/g, ' ');
};

// ── أعمدةُ كشف التشغيل — عناوينُ صفحة العمليات كما هي ──────────────────────
const WORKFLOW_FIELDS = {
  reportNumber: ['رقم الطلب', 'Report number'], reportDate: ['تاريخ الطلب', 'Report date'],
  fromLocation: ['من', 'From'], toLocation: ['إلى', 'To'], branch: ['الفرع', 'Branch'],
  username: ['العميل', 'Customer'], userPhone: ['هاتف العميل', 'Customer phone'],
  carOwner: ['مالك السيارة', 'Car owner'], carNumber: ['رقم السيارة', 'Car number'],
  carName: ['اسم السيارة', 'Car name'], plateNumber: ['رقم اللوحة', 'Plate number'],
  ownerType: ['نوع الملكية', 'Owner type'], driverName: ['السائق', 'Driver'],
  driverPhone: ['هاتف السائق', 'Driver phone'], driverRentalType: ['نوع تأجير السائق', 'Driver rental type'],
  representativeName: ['المندوب', 'Representative'], truckType: ['نوع الشاحنة', 'Truck type'],
  truckSize: ['حجم الشاحنة', 'Truck size'], loadType: ['نوع الحمولة', 'Load type'],
  loadingTime: ['وقت التحميل', 'Loading time'], quantity: ['الكمية', 'Quantity'],
  goodsValue: ['قيمة البضائع', 'Goods value'], reference: ['رقم المرجع', 'Reference'],
  country: ['الدولة', 'Country'], applicationStatus: ['حالة الطلب', 'Request status'],
  executionStatus: ['حالة التنفيذ', 'Execution status'], paymentMethod: ['طريقة الدفع', 'Payment method'],
  purchaseValue: ['قيمة الشراء', 'Purchase value'], sellingValue: ['قيمة البيع', 'Selling value'],
  driverCost: ['تكلفة السائق', 'Driver cost'], payingBranch: ['فرع السداد', 'Paying branch'],
  paymentDate: ['تاريخ السداد', 'Payment date'], paymentAmount: ['مبلغ السداد', 'Payment amount'],
  paymentType: ['نوع السداد', 'Payment type'], documentNumber: ['رقم المستند', 'Document number'],
  finalReportDestination: ['وجهة الكشف النهائية', 'Final report destination'],
  sendingDate: ['تاريخ الإرسال', 'Sending date'], branchDeliveryDate: ['تاريخ التسليم للفرع', 'Branch delivery date'],
  deliveryDate: ['تاريخ التسليم للعميل', 'Customer delivery date'],
  invoiceNumber: ['رقم الفاتورة', 'Invoice number'], invoiceDate: ['تاريخ الفاتورة', 'Invoice date'],
  invoiceNotes: ['ملاحظات الفاتورة', 'Invoice notes'], netInvoice: ['صافي الفاتورة', 'Net invoice'],
  tax: ['الضريبة', 'Tax'], totalInvoice: ['إجمالي الفاتورة', 'Invoice total'],
  collectionDate: ['تاريخ التحصيل', 'Collection date'], collectedAmount: ['المبلغ المحصَّل', 'Collected amount'],
  collectionDetail: ['تفصيل التحصيل', 'Collection detail'], cashCollectionStatus: ['حالة تحصيل النقد', 'Cash collection status'],
  operationsReview: ['مراجعة العمليات', 'Operations review'], accountingReview: ['مراجعة المحاسبة', 'Accounting review'],
  stage: ['المرحلة', 'Stage'], ownerName: ['اسم المالك', 'Owner name'], ownerPhone: ['هاتف المالك', 'Owner phone'],
};

/**
 * أسماءُ الحقول العامّة — لما لا مصدرَ له في إعدادات قسمه.
 * وما ليس هنا ولا هناك يظهر باسمه مفكوكًا («credit days»): عرضُه بالإنجليزيّة
 * أهونُ من إخفاء تغييرٍ وقع.
 */
const FIELD_LABELS = {
  rep: ['المندوب', 'Rep'], employee: ['الموظف', 'Employee'], employeeName: ['الموظف', 'Employee'],
  name: ['الاسم', 'Name'], nameAr: ['الاسم بالعربية', 'Arabic name'], nameEn: ['الاسم بالإنجليزية', 'English name'],
  englishName: ['الاسم بالإنجليزية', 'English name'], firstName: ['الاسم الأول', 'First name'],
  lastName: ['اسم العائلة', 'Last name'], companyName: ['اسم الشركة', 'Company name'],
  dateKey: ['اليوم', 'Day'], date: ['التاريخ', 'Date'], at: ['الوقت', 'Time'], from: ['من تاريخ', 'From'], to: ['إلى تاريخ', 'To'],
  outcome: ['النتيجة', 'Outcome'], notes: ['ملاحظات', 'Notes'], note: ['ملاحظة', 'Note'], notesAr: ['ملاحظات', 'Notes'],
  plate: ['اللوحة', 'Plate'], plateNumber: ['اللوحة', 'Plate'], vehicle: ['المركبة', 'Vehicle'],
  vehiclePlate: ['اللوحة', 'Plate'], vehicleNumber: ['رقم المركبة', 'Vehicle number'],
  amount: ['المبلغ', 'Amount'], type: ['النوع', 'Type'], kind: ['النوع', 'Kind'], category: ['التصنيف', 'Category'],
  status: ['الحالة', 'Status'], statusCode: ['الحالة', 'Status'], statusAr: ['الحالة', 'Status'],
  stage: ['المرحلة', 'Stage'], reason: ['السبب', 'Reason'], order: ['رقم الأمر', 'Order number'],
  idNumber: ['رقم الهوية', 'ID number'], iqamaNumber: ['رقم الإقامة', 'Iqama number'],
  authorizedTo: ['المفوَّض له', 'Authorised to'], authorizationMoved: ['نُقل التفويض', 'Authorisation moved'],
  authorizationNumber: ['رقم التفويض', 'Authorisation number'], previousHolder: ['الحائز السابق', 'Previous holder'],
  closedAssignments: ['تفاويض أُغلقت', 'Assignments closed'], linked: ['مرتبط بملف موظف', 'Linked to employee'],
  supervisor: ['المشرف', 'Supervisor'], supervisorName: ['المشرف', 'Supervisor'],
  supervisorUser: ['المشرف التشغيلي', 'Operating supervisor'],
  dutySupervisorUser: ['مشرف التفقّد', 'Duty supervisor'], dutySupervisorName: ['مشرف التفقّد', 'Duty supervisor'],
  claimId: ['رقم الحادث', 'Claim number'], accidentNumber: ['رقم الحادث', 'Accident number'],
  accidentDate: ['تاريخ الحادث', 'Accident date'], claimNumber: ['رقم المطالبة', 'Claim number'],
  faultPercent: ['نسبة الخطأ', 'Fault percent'], driverNameAr: ['السائق', 'Driver'], driver: ['السائق', 'Driver'],
  driverIdNumber: ['هوية السائق', 'Driver ID'], insurerAr: ['شركة التأمين', 'Insurer'],
  estimatedAmountSar: ['المبلغ التقديري', 'Estimated amount'], expectedRecoverySar: ['الاسترداد المتوقَّع', 'Expected recovery'],
  document: ['المستند', 'Document'], documents: ['المستندات', 'Documents'], title: ['العنوان', 'Title'],
  file: ['الملف', 'File'], files: ['الملفات', 'Files'], fileName: ['الملف', 'File'],
  newExpiry: ['الانتهاء الجديد', 'New expiry'], previousExpiry: ['الانتهاء السابق', 'Previous expiry'],
  expiry: ['تاريخ الانتهاء', 'Expiry'], expiryDate: ['تاريخ الانتهاء', 'Expiry date'], startDate: ['تاريخ البدء', 'Start date'],
  endedAt: ['تاريخ الإنهاء', 'Ended at'], number: ['الرقم', 'Number'], newNumber: ['الرقم الجديد', 'New number'],
  docType: ['نوع المستند', 'Document type'], cardNumber: ['رقم البطاقة', 'Card number'],
  policy: ['الوثيقة', 'Policy'], policyNumbers: ['أرقام الوثائق', 'Policy numbers'], covered: ['مشمول بالوثيقة', 'Covered'],
  policyholderAr: ['حامل الوثيقة', 'Policyholder'], companyAr: ['الشركة', 'Company'], scopeAr: ['نطاق التغطية', 'Scope'],
  premiumSar: ['القسط', 'Premium'], premiumPerPersonSar: ['القسط للفرد', 'Premium per person'],
  premiumPerVehicleSar: ['القسط للمركبة', 'Premium per vehicle'], vehicleCount: ['عدد المركبات', 'Vehicle count'],
  coversDrivers: ['تشمل السائقين', 'Covers drivers'], coverageSubject: ['موضوع التغطية', 'Coverage subject'],
  cost: ['التكلفة', 'Cost'], price: ['السعر', 'Price'], quantity: ['الكمية', 'Quantity'], item: ['الصنف', 'Item'],
  remaining: ['المتبقّي', 'Remaining'], service: ['الخدمة', 'Service'], lines: ['عدد البنود', 'Lines'],
  totalQty: ['إجمالي الكمية', 'Total quantity'],
  count: ['عدد السجلات المتأثّرة', 'Records affected'], changed: ['عدد السجلات المعدَّلة', 'Records changed'],
  updated: ['عدد السجلات المعدَّلة', 'Records updated'], reps: ['عدد المناديب', 'Reps'],
  vehicles: ['عدد المركبات', 'Vehicles'], reports: ['عدد الكشوف', 'Reports'],
  reportsChanged: ['عدد الكشوف المعدَّلة', 'Reports changed'], exported: ['عدد المصدَّر', 'Exported'],
  withPassword: ['منها بكلمة مرور', 'With password'], ordersDeleted: ['طلبات حُذفت', 'Orders deleted'],
  uploadsDeleted: ['ملفات رفع حُذفت', 'Uploads deleted'], repsDeleted: ['مناديب حُذفوا', 'Reps deleted'],
  numbersChanged: ['أرقام تغيّرت', 'Numbers changed'], carriedOverDays: ['أيام مرحَّلة', 'Days carried over'],
  branch: ['الفرع', 'Branch'], project: ['المشروع', 'Project'], projectAr: ['المشروع', 'Project'],
  closingBalance: ['رصيد الإقفال', 'Closing balance'], openingBalance: ['الرصيد الافتتاحي', 'Opening balance'],
  previousDayClosing: ['إقفال اليوم السابق', 'Previous day closing'], counted: ['عُدّ نقدًا', 'Cash counted'],
  actualCash: ['النقد الفعلي', 'Actual cash'], expected: ['المتوقَّع', 'Expected'], actual: ['الفعلي', 'Actual'],
  difference: ['الفرق', 'Difference'], autoClosedNote: ['ملاحظة الإقفال', 'Closing note'],
  email: ['البريد', 'Email'], phone: ['الجوال', 'Phone'], role: ['الدور', 'Role'], page: ['الصفحة', 'Page'],
  pages: ['الصفحات', 'Pages'], sections: ['الأقسام', 'Sections'], homePage: ['الصفحة الرئيسية', 'Home page'],
  section: ['القسم', 'Section'], user: ['المستخدم', 'User'], key: ['المفتاح', 'Key'], code: ['الرمز', 'Code'],
  city: ['المدينة', 'City'], cityAr: ['المدينة', 'City'], address: ['العنوان', 'Address'], region: ['المنطقة', 'Region'],
  passwordChanged: ['غُيِّرت كلمة المرور', 'Password changed'], hasPassword: ['له كلمة مرور محفوظة', 'Has stored password'],
  replacedBy: ['استُبدل به', 'Replaced by'], isActive: ['نشط', 'Active'], source: ['المصدر', 'Source'],
  contactPerson: ['مسؤول التواصل', 'Contact person'], contactPhone: ['جوال مسؤول التواصل', 'Contact phone'],
  accountantName: ['المحاسب', 'Accountant'], accountantPhone: ['جوال المحاسب', 'Accountant phone'],
  commercialRegister: ['السجل التجاري', 'Commercial register'], taxNumber: ['الرقم الضريبي', 'Tax number'],
  iban: ['الآيبان', 'IBAN'], bankName: ['البنك', 'Bank'], partyType: ['نوع الطرف', 'Party type'],
  paymentType: ['نوع السداد', 'Payment type'], paymentTerms: ['شروط السداد', 'Payment terms'],
  paymentMethod: ['طريقة الدفع', 'Payment method'], paymentDate: ['تاريخ السداد', 'Payment date'],
  creditLimit: ['الحد الائتماني', 'Credit limit'], creditDays: ['أيام الائتمان', 'Credit days'],
  creditTerm: ['مدة الائتمان', 'Credit term'], collectionOfficer: ['مسؤول التحصيل', 'Collection officer'],
  hoLocation: ['موقع الإدارة', 'HO location'], grade: ['التصنيف', 'Grade'], salesManagers: ['مديرو المبيعات', 'Sales managers'],
  salesManager: ['مدير المبيعات', 'Sales manager'], aliases: ['أسماء أخرى', 'Aliases'], party: ['الطرف', 'Party'],
  customerName: ['العميل', 'Customer'], customerNumber: ['رقم العميل', 'Customer number'],
  clientStatus: ['حالة العميل', 'Client status'], office: ['المكتب', 'Office'],
  waybillNumber: ['رقم البوليصة', 'Waybill number'], refNumber: ['رقم المعاملة', 'Reference'],
  paymentDecision: ['قرار السداد', 'Payment decision'], entry: ['القيد', 'Entry'], upcoming: ['المعاملات القادمة', 'Upcoming'],
  housing: ['السكن', 'Housing'], housingRoom: ['الغرفة', 'Room'], nationalityAr: ['الجنسية', 'Nationality'],
  jobTitleAr: ['المسمى الوظيفي', 'Job title'], contractTypeAr: ['نوع العقد', 'Contract type'],
  vehicleTypeAr: ['نوع المركبة', 'Vehicle type'], workStatusAr: ['حالة العمل', 'Work status'],
  staffKind: ['فئة الموظف', 'Staff kind'], registerNumber: ['رقم السجل', 'Register number'],
  hireDate: ['تاريخ التعيين', 'Hire date'], employeeNumber: ['الرقم الوظيفي', 'Employee no.'],
  operatingCard: ['بطاقة التشغيل', 'Operating card'], inspection: ['الفحص الدوري', 'Inspection'],
  hrLinked: ['مرتبط بالموارد البشرية', 'Linked to HR'], subject: ['الموضوع', 'Subject'],
  incidentSubjectAr: ['موضوع الحادث', 'Incident subject'], isVehicleIncident: ['حادث مركبة', 'Vehicle incident'],
  reportOrEstimateNumber: ['رقم التقرير أو التقدير', 'Report/estimate number'], reportedViaAr: ['جهة البلاغ', 'Reported via'],
  lastInsurerUpdateDate: ['آخر تحديث من التأمين', 'Last insurer update'], counterpartyNameAr: ['الطرف الآخر', 'Counterparty'],
  employmentStatus: ['حالة التوظيف', 'Employment status'], contractStatus: ['حالة العقد', 'Contract status'],
  documentNumber: ['رقم المستند', 'Document number'], deletedCounts: ['ما حُذف', 'Deleted counts'],
  paymentTypeSetToCash: ['حُوِّل نوع سدادها إلى كاش', 'Payment type set to cash'],
  sellingValueRewritten: ['أُعيدت كتابة قيمة بيعها', 'Selling value rewritten'],
  cashStatusSet: ['ضُبطت حالة نقدها', 'Cash status set'], netValueChange: ['صافي تغيّر القيمة', 'Net value change'],
  onlyEmpty: ['الفارغة فقط', 'Only empty'], moves: ['التحويلات', 'Moves'], bulk: ['إجراء جماعي', 'Bulk'],
  walletTotals: ['مجاميع عهدة صُحِّحت', 'Wallet totals fixed'], walletChain: ['سلاسل عهدة صُحِّحت', 'Wallet chain fixed'],
  cashInvoiceCleared: ['فواتير نقدية أُفرغت', 'Cash invoices cleared'],
  employeeNumberCleared: ['أرقام وظيفية أُفرغت', 'Employee numbers cleared'],
  details: ['التفاصيل', 'Details'], sharedPolicy: ['وثيقة مشتركة', 'Shared policy'], policyUpdated: ['حُدِّثت الوثيقة', 'Policy updated'],
  filters: ['الفلاتر', 'Filters'], customerUpdates: ['تحديثات العملاء', 'Customer updates'],
  department: ['الإدارة', 'Department'], subjects: ['عدد المعنيّين', 'Subjects'],
  directManager: ['المدير المباشر', 'Direct manager'], licenseNumber: ['رقم الرخصة', 'Licence number'],
  driverCardType: ['نوع بطاقة السائق', 'Driver card type'], classification: ['التصنيف', 'Classification'],
  actualWorkStartDate: ['تاريخ المباشرة الفعلي', 'Actual start date'], workLocation: ['موقع العمل', 'Work location'],
  nationalId: ['رقم الهوية الوطنية', 'National ID'], repId: ['رقم المندوب', 'Rep ID'], sponsorName: ['الكفيل', 'Sponsor'],
  fileStatus: ['حالة الملف', 'File status'], lightTransport: ['نقل خفيف', 'Light transport'],
  emergencyContactName: ['جهة اتصال الطوارئ', 'Emergency contact'], emergencyContactPhone: ['جوال الطوارئ', 'Emergency phone'],
  visaExpiry: ['انتهاء التأشيرة', 'Visa expiry'], basicSalary: ['الراتب الأساسي', 'Basic salary'],
  absherStatus: ['حالة أبشر', 'Absher status'], branches: ['الفروع', 'Branches'], penaltyClause: ['الشرط الجزائي', 'Penalty clause'],
  Workshop: ['الورشة', 'Workshop'],
  enabled: ['مفعَّل', 'Enabled'], warnDays: ['أيام التنبيه', 'Warn days'], criticalDays: ['أيام الحرج', 'Critical days'],
  soonDays: ['أيام الاقتراب', 'Soon days'], driverCard: ['بطاقة السائق', 'Driver card'],
  corporatePolicy: ['وثيقة تأمين الشركة', 'Corporate policy'],
};

/**
 * قيمٌ مخزَّنةٌ بالإنجليزيّة وتُقرأ بالعربيّة. مفتاحُها الحقلُ أوّلًا: `cash` نوعُ
 * سدادٍ في حقلٍ وطريقةُ دفعٍ في آخر، وكلمةٌ واحدةٌ لهما معًا تُخطئ في أحدهما.
 */
const SHIPMENT_STATUS_AR = {
  requesting: 'قيد الطلب', loading: 'جاري التحميل', uploaded: 'تم التحميل', on_way: 'في الطريق',
  arrived: 'وصلت', bond_sent: 'أُرسل السند', bond_received: 'استُلم السند', late: 'متأخرة',
  invoiced: 'تمت الفوترة', cancelled: 'ملغاة',
};
const FIELD_VALUES_AR = {
  applicationStatus: SHIPMENT_STATUS_AR,
  executionStatus: SHIPMENT_STATUS_AR,
  paymentMethod: { cash: 'كاش', late: 'آجل' },
  paymentType: { cash: 'نقدي', tax: 'ضريبي' },
  // مراحلُ دورة التخليص — بترتيب وأسماء `models/CustomsClearance`.
  stage: {
    papers_received: 'استلام الأوراق', declaration_paid: 'طباعة البيان الجمركي وسداده',
    do_requested: 'إرسال أوراق الوكيل وطلب فاتورة إذن التسليم', do_linked: 'ربط إذن التسليم',
    port_fees_paid: 'طباعة فاتورة أجور الموانئ وسدادها', unloading_fees_paid: 'طباعة فاتورة أجور التفريغ وسدادها',
    transport_order: 'عمل أمر نقل', containers_transported: 'نقل الحاويات إلى العميل أو الساحة',
    unloaded_stored: 'التفريغ والتخزين', containers_returned: 'إرجاع الحاويات إلى الوكيل', invoiced: 'عمل الفواتير',
    draft: 'مسودة', submitted_to_ops: 'أُرسل إلى العمليات',
  },
  type: { in: 'وارد', out: 'صادر', collection: 'تحصيل', expense: 'مصروف', purchase: 'مشتريات',
    tax_invoice: 'فاتورة ضريبية', call: 'اتصال', visit: 'زيارة', email: 'بريد', whatsapp: 'واتساب' },
  kind: { customer: 'عميل', vendor: 'مورد', note: 'ملاحظة' },
  docType: { iqama: 'الإقامة', passport: 'الجواز', license: 'الرخصة', contract: 'العقد' },
};
const VALUE_AR = {
  started: 'بدأ الدوام', absent: 'لم يحضر', blocked: 'مُنع من الخروج',
  pending: 'قيد المتابعة', closed: 'مقفولة', active: 'نشط', terminated: 'منتهية خدمته',
  suspended: 'موقوف', on_leave: 'في إجازة', none: 'بلا صلاحية', edit: 'تعديل', view: 'اطّلاع',
  open: 'مفتوح', other: 'أخرى', goods: 'بضائع', individual: 'فرد', operation: 'تشغيل', auto: 'تلقائي',
};

module.exports = {
  ACTION_AR, GENERIC_AR, ENTITY_LABELS, WORKFLOW_FIELDS, FIELD_LABELS, FIELD_VALUES_AR, VALUE_AR,
  entityLabel, actionLabel, humanise,
};
