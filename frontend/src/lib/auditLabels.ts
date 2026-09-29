/**
 * أسماءُ ما جرى في سجلّ المراجعة — بالعربيّة، جملةً تُقرأ لا مفتاحًا تقنيًّا.
 *
 * ── لماذا خريطةٌ كاملةٌ لا اشتقاقٌ من المفتاح ───────────────────────────────
 * كانت الترجمةُ تُفكّك المفتاحَ إلى فعلٍ وبقيّة: `create_b2c_duty_check` تُقرأ
 * «إنشاء b2c duty check». وسجلُّ المراجعة يُقرأ حين يُسأل عن رجلٍ ما فعل —
 * وسطرٌ نصفُه إنجليزيٌّ تقنيٌّ لا يصلح أن يُبنى عليه سؤالٌ، فضلًا عن عقوبة.
 *
 * فالأفعالُ مكتوبةٌ واحدًا واحدًا، مأخوذةً من الموجود في القاعدة فعلًا لا من
 * التخمين. وما لم يُكتب هنا يظهر بفعله وكيانه معًا («إنشاء · مركبة») لا بمفتاحه
 * الخام — فالسطرُ يبقى مفهومًا حتّى لفعلٍ أُضيف اليوم.
 */

/** فعلٌ بعينه → جملتُه. */
export const ACTION_AR: Record<string, string> = {
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
export const GENERIC_AR: Record<string, string> = {
  create: 'إنشاء', add: 'إضافة', update: 'تعديل', edit: 'تعديل',
  delete: 'حذف', remove: 'إزالة', assign: 'إسناد', revoke: 'إلغاء',
  transfer: 'نقل', import: 'استيراد', export: 'تصدير',
  activate: 'تفعيل', deactivate: 'إيقاف', approve: 'اعتماد', reject: 'رفض',
  lock: 'قفل', unlock: 'فتح', renew: 'تجديد', close: 'إقفال', reopen: 'إعادة فتح',
};

/**
 * أسماءُ الحقول في تفاصيل السطر — «rep» لا تُقرأ، «المندوب» تُقرأ.
 * وما ليس هنا يظهر باسمه كما هو: إخفاؤه أسوأُ من عرضه بالإنجليزيّة.
 */
export const FIELD_AR: Record<string, string> = {
  rep: 'المندوب', employee: 'الموظف', employeeName: 'الموظف', name: 'الاسم',
  dateKey: 'اليوم', date: 'التاريخ', outcome: 'النتيجة', notes: 'ملاحظات', note: 'ملاحظة',
  plate: 'اللوحة', plateNumber: 'اللوحة', vehicle: 'المركبة', vehiclePlate: 'اللوحة',
  amount: 'المبلغ', type: 'النوع', status: 'الحالة', statusCode: 'الحالة',
  reason: 'السبب', order: 'رقم الأمر', idNumber: 'رقم الهوية', iqamaNumber: 'رقم الإقامة',
  authorizedTo: 'المفوَّض له', authorizationMoved: 'نُقل التفويض', authorizationNumber: 'رقم التفويض',
  supervisor: 'المشرف', supervisorName: 'المشرف', dutySupervisorUser: 'مشرف التفقّد',
  supervisorUser: 'المشرف التشغيلي', dutySupervisorName: 'مشرف التفقّد',
  claimId: 'رقم الحادث', accidentNumber: 'رقم الحادث', document: 'المستند',
  newExpiry: 'الانتهاء الجديد', previousExpiry: 'الانتهاء السابق', cost: 'التكلفة',
  count: 'العدد', reps: 'عدد المناديب', branch: 'الفرع', project: 'المشروع',
  closingBalance: 'رصيد الإقفال', openingBalance: 'الرصيد الافتتاحي', counted: 'عُدّ نقدًا',
  email: 'البريد', role: 'الدور', page: 'الصفحة', section: 'القسم',
  passportNumber: 'رقم الجواز', passportExpiry: 'انتهاء الجواز',
  insuranceClass: 'فئة التأمين', healthCertNumber: 'رقم الشهادة الصحية',
  iqamaExpiry: 'انتهاء الإقامة', contractEnd: 'نهاية العقد', salary: 'الراتب',
  jobTitle: 'المسمى الوظيفي', department: 'الإدارة', city: 'المدينة',
  customerName: 'العميل', waybillNumber: 'رقم البوليصة', price: 'السعر',
  fromValue: 'من', toValue: 'إلى', updated: 'عدد المعدَّل',
};

/** ما جرى، جملةً واحدة. `entityAr` اسمُ الكيان بالعربيّة إن عُرف. */
export const actionSentence = (action: string, entityAr: string, ar: boolean): string => {
  if (!ar) return String(action || '').replace(/_/g, ' ');
  const a = String(action || '');
  if (ACTION_AR[a]) return ACTION_AR[a];
  // فعلٌ عامٌّ وحدَه («create») يُقرأ مع كيانه.
  if (GENERIC_AR[a]) return entityAr ? `${GENERIC_AR[a]} ${entityAr}` : GENERIC_AR[a];
  const [verb, ...rest] = a.split('_');
  if (GENERIC_AR[verb]) {
    // فعلٌ مُركَّبٌ لم يُكتب بعد: يُقرأ بفعله وكيانه، لا ببقيّةٍ إنجليزيّة.
    return entityAr ? `${GENERIC_AR[verb]} ${entityAr}` : `${GENERIC_AR[verb]} ${rest.join(' ')}`.trim();
  }
  return a.replace(/_/g, ' ');
};

/**
 * قيمٌ مخزَّنةٌ بالإنجليزيّة وتُقرأ بالعربيّة — «started» ليست جوابًا لمن يسأل
 * «عمل إيه؟». وما ليس هنا يُعرَض كما هو: رقمٌ أو اسمٌ أو نصٌّ حرّ.
 */
export const VALUE_AR: Record<string, string> = {
  started: 'بدأ الدوام', absent: 'لم يحضر', blocked: 'مُنع من الخروج',
  collection: 'تحصيل', expense: 'مصروف', purchase: 'مشتريات', tax_invoice: 'فاتورة ضريبية',
  pending: 'قيد المتابعة', closed: 'مقفولة', active: 'نشط', terminated: 'إنهاء خدمة',
  suspended: 'موقوف', on_leave: 'إجازة', none: 'بلا', edit: 'تعديل', view: 'اطّلاع',
  true: 'نعم', false: 'لا',
};

export const fieldLabel = (k: string, ar: boolean) => (ar && FIELD_AR[k]) || k;

/**
 * قيمةٌ تُعرَض في التفاصيل. والغيابُ يُحذَف لا يُكتب «undefined»: سطرٌ يقول
 * «lockedBy: undefined» يُقرأ كأنّ شيئًا وقع، ولم يقع شيء.
 */
export const valueLabel = (v: unknown, ar: boolean): string | null => {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v === 'boolean') return ar ? (v ? 'نعم' : 'لا') : String(v);
  if (typeof v === 'object') {
    const j = JSON.stringify(v);
    return j === '{}' || j === '[]' ? null : j.slice(0, 60);
  }
  const sv = String(v);
  return (ar && VALUE_AR[sv]) || sv;
};
