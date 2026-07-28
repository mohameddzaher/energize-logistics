import 'package:flutter/material.dart';
import '../ui/theme.dart';
import 'resource.dart';

/// Page definitions on the CRUD engine — each entry IS a full native page
/// (list + search + create + edit + delete + live), matching the web page of
/// the same name and the same API.

String _s(Map<String, dynamic> r, String k) => (r[k] ?? '').toString();

// ── إدارة الأسطول ────────────────────────────────────────────────────────────
final fleetDriversCfg = ResourceConfig(
  arTitle: 'السائقون', enTitle: 'Drivers', icon: Icons.badge_outlined,
  endpoint: '/api/fleet/drivers', listKey: 'drivers', liveEvent: 'fleet:updated',
  searchFields: const ['name', 'phone', 'iqama'],
  titleOf: (r) => _s(r, 'name'),
  subtitleOf: (r) => [_s(r, 'phone'), _s(r, 'iqama')].where((x) => x.isNotEmpty).join(' · '),
  chipsOf: (r) => [
    r['working'] != false ? ('يعمل', T.success) : ('متوقف', T.inkFaint),
    if (r['onSponsorship'] == true) ('على الكفالة', T.info),
  ],
  fields: const [
    FieldSpec('name', 'اسم السائق', 'Name', required: true),
    FieldSpec('phone', 'رقم الجوال', 'Phone', type: FieldType.phone),
    FieldSpec('iqama', 'رقم الإقامة', 'Iqama', type: FieldType.number),
    FieldSpec('working', 'يعمل حاليًا', 'Working', type: FieldType.checkbox),
    FieldSpec('onSponsorship', 'على الكفالة', 'On sponsorship', type: FieldType.checkbox),
    FieldSpec('notes', 'ملاحظات', 'Notes', type: FieldType.textarea),
  ],
);

final fleetVehiclesCfg = ResourceConfig(
  arTitle: 'سيارات الأسطول', enTitle: 'Fleet Vehicles', icon: Icons.local_shipping_outlined,
  endpoint: '/api/fleet/vehicles', listKey: 'vehicles', liveEvent: 'fleet:updated',
  searchFields: const ['plate', 'name', 'trailerType', 'supervisorName'],
  titleOf: (r) => _s(r, 'plate'),
  subtitleOf: (r) => [_s(r, 'name'), _s(r, 'supervisorName')].where((x) => x.isNotEmpty).join(' · '),
  chipsOf: (r) => [
    if (_s(r, 'trailerType').isNotEmpty) (_s(r, 'trailerType'), T.navy),
    if (_s(r, 'gpsType').isNotEmpty) ('GPS: ${_s(r, 'gpsType')}', T.cyan),
  ],
  fields: const [
    FieldSpec('plate', 'اللوحة', 'Plate', required: true),
    FieldSpec('name', 'اسم السيارة', 'Name'),
    FieldSpec('trailerType', 'نوع المقطورة', 'Trailer type', type: FieldType.select, options: [
      ('سطحة', 'سطحة', 'Flatbed'), ('ستارة', 'ستارة', 'Curtain'), ('جوانب', 'جوانب', 'Sides'),
      ('براد', 'براد', 'Reefer'), ('صهريج', 'صهريج', 'Tanker'), ('لوبد', 'لوبد', 'Lowbed'),
    ]),
    FieldSpec('gpsType', 'نوع الـ GPS', 'GPS type', type: FieldType.select, options: [
      ('LS', 'LS', 'LS'), ('EX', 'EX', 'EX'),
    ]),
    FieldSpec('notes', 'ملاحظات', 'Notes', type: FieldType.textarea),
  ],
);

final fleetCustomersCfg = ResourceConfig(
  arTitle: 'عملاء الأسطول', enTitle: 'Fleet Customers', icon: Icons.people_outline,
  endpoint: '/api/fleet/customers', listKey: 'customers', liveEvent: 'fleet:customers',
  searchFields: const ['name', 'phone', 'email'],
  titleOf: (r) => _s(r, 'name'),
  subtitleOf: (r) => [_s(r, 'phone'), _s(r, 'email')].where((x) => x.isNotEmpty).join(' · '),
  fields: const [
    FieldSpec('name', 'اسم العميل', 'Name', required: true),
    FieldSpec('phone', 'رقم الجوال', 'Phone', type: FieldType.phone),
    FieldSpec('email', 'البريد الإلكتروني', 'Email', type: FieldType.email),
    FieldSpec('notes', 'ملاحظات', 'Notes', type: FieldType.textarea),
  ],
);

// ── إدارة العقود ─────────────────────────────────────────────────────────────
final contractsVendorsCfg = ResourceConfig(
  arTitle: 'سجل موردي 3PL', enTitle: '3PL Vendors', icon: Icons.business_outlined,
  endpoint: '/api/contracts/vendors', listKey: 'vendors',
  updateMethod: 'PATCH', liveEvent: 'contracts:updated',
  searchFields: const ['name', 'energizeRep', 'contactPerson', 'phone', 'headquarters'],
  titleOf: (r) => _s(r, 'name'),
  subtitleOf: (r) => [_s(r, 'headquarters'), _s(r, 'energizeRep')].where((x) => x.isNotEmpty).join(' · '),
  chipsOf: (r) => [
    r['status'] == 'signed'
        ? ('موقّع', T.success)
        : r['status'] == 'pending'
            ? ('قيد التوقيع', T.warn)
            : ('غير موقّع', T.inkFaint),
    ('${r['fleetSize'] ?? 0} سيارة', T.navy),
    if (r['status'] == 'signed' && r['documentsReceived'] != true) ('مستندات ناقصة', T.danger),
    if (r['rating'] != null) ('★ ${r['rating']}', T.warn),
  ],
  fields: const [
    FieldSpec('name', 'اسم المورد', 'Vendor name', required: true),
    FieldSpec('energizeRep', 'مندوب التنشيط', 'Energize rep'),
    FieldSpec('vendorType', 'نوع المورد', 'Type', type: FieldType.select, options: [
      ('ضريبي', 'ضريبي', 'Tax'), ('آجل', 'آجل', 'Credit'), ('كاش', 'كاش', 'Cash'),
    ]),
    FieldSpec('contactPerson', 'ممثل المورد', 'Contact person'),
    FieldSpec('phone', 'رقم الجوال', 'Phone', type: FieldType.phone),
    FieldSpec('headquarters', 'المقر الرئيسي', 'Headquarters'),
    FieldSpec('destinations', 'الوجهات', 'Destinations'),
    FieldSpec('fleetSize', 'عدد السيارات', 'Fleet size', type: FieldType.number),
    FieldSpec('contractDate', 'تاريخ العقد', 'Contract date', type: FieldType.date),
    FieldSpec('vendorSideContract', 'وقّع المورد', 'Vendor signed', type: FieldType.checkbox),
    FieldSpec('ourSideContract', 'وقّعنا نحن', 'We signed', type: FieldType.checkbox),
    FieldSpec('documentsReceived', 'المستندات مكتملة', 'Documents complete', type: FieldType.checkbox),
    FieldSpec('missingDocuments', 'المستندات الناقصة', 'Missing documents'),
    FieldSpec('rating', 'التقييم (1-5)', 'Rating (1-5)', type: FieldType.number),
    FieldSpec('notes', 'ملاحظات', 'Notes', type: FieldType.textarea),
  ],
);

final contractsAgreementsCfg = ResourceConfig(
  arTitle: 'عقود الأقسام', enTitle: 'Department Contracts', icon: Icons.folder_copy_outlined,
  endpoint: '/api/contracts/agreements', listKey: 'contracts',
  updateMethod: 'PATCH', liveEvent: 'contracts:updated',
  searchFields: const ['partyName', 'contactPerson', 'phone', 'subject'],
  titleOf: (r) => _s(r, 'partyName'),
  subtitleOf: (r) => _s(r, 'subject'),
  chipsOf: (r) => [
    switch (_s(r, 'department')) {
      '3pl' => ('موردو 3PL', T.cyan),
      'fleet' => ('عملاء الأسطول', T.navy),
      'b2c' => ('عملاء B2C', T.violet),
      _ => ('أخرى', T.inkSoft),
    },
    switch (_s(r, 'status')) {
      'active' => ('ساري', T.success),
      'expired' => ('منتهي', T.danger),
      'terminated' => ('مفسوخ', T.inkFaint),
      _ => ('مسودة', T.inkSoft),
    },
  ],
  fields: const [
    FieldSpec('department', 'القسم', 'Department', type: FieldType.select, required: true, options: [
      ('3pl', 'موردو 3PL', '3PL Vendors'), ('fleet', 'عملاء إدارة الأسطول', 'Fleet Customers'),
      ('b2c', 'عملاء B2C', 'B2C Customers'), ('other', 'أخرى', 'Other'),
    ]),
    FieldSpec('partyType', 'نوع الطرف', 'Party type', type: FieldType.select, required: true, options: [
      ('customer', 'عميل', 'Customer'), ('vendor', 'مورد', 'Vendor'),
    ]),
    FieldSpec('partyName', 'اسم الجهة', 'Party name', required: true),
    FieldSpec('subject', 'موضوع العقد', 'Subject'),
    FieldSpec('contactPerson', 'جهة الاتصال', 'Contact'),
    FieldSpec('phone', 'رقم الجوال', 'Phone', type: FieldType.phone),
    FieldSpec('contractDate', 'تاريخ العقد', 'Contract date', type: FieldType.date),
    FieldSpec('startDate', 'تاريخ البدء', 'Start date', type: FieldType.date),
    FieldSpec('endDate', 'تاريخ الانتهاء', 'End date', type: FieldType.date),
    FieldSpec('paymentTermDays', 'مدة السداد (يوم)', 'Payment days', type: FieldType.number),
    FieldSpec('value', 'قيمة العقد', 'Value', type: FieldType.number),
    FieldSpec('status', 'الحالة', 'Status', type: FieldType.select, options: [
      ('active', 'ساري', 'Active'), ('draft', 'مسودة', 'Draft'),
      ('expired', 'منتهي', 'Expired'), ('terminated', 'مفسوخ', 'Terminated'),
    ]),
    FieldSpec('notes', 'ملاحظات', 'Notes', type: FieldType.textarea),
  ],
);

// ── إدارة العلاقات (CRM) ─────────────────────────────────────────────────────
final crmCompaniesCfg = ResourceConfig(
  arTitle: 'الشركات', enTitle: 'Companies', icon: Icons.apartment_outlined,
  endpoint: '/api/crm/companies', listKey: 'companies', liveEvent: 'crm:company',
  searchFields: const ['name', 'arabicName', 'phone', 'email', 'city', 'industry'],
  titleOf: (r) => _s(r, 'arabicName').isNotEmpty ? _s(r, 'arabicName') : _s(r, 'name'),
  subtitleOf: (r) => [_s(r, 'industry'), _s(r, 'city')].where((x) => x.isNotEmpty).join(' · '),
  chipsOf: (r) => [
    if (_s(r, 'status').isNotEmpty) (_s(r, 'status'), T.cyan),
    if (r['rating'] != null && r['rating'] != 0) ('★ ${r['rating']}', T.warn),
  ],
  fields: const [
    FieldSpec('name', 'اسم الشركة', 'Company name', required: true),
    FieldSpec('arabicName', 'الاسم العربي', 'Arabic name'),
    FieldSpec('industry', 'المجال', 'Industry'),
    FieldSpec('phone', 'رقم الهاتف', 'Phone', type: FieldType.phone),
    FieldSpec('whatsapp', 'واتساب', 'WhatsApp', type: FieldType.phone),
    FieldSpec('email', 'البريد الإلكتروني', 'Email', type: FieldType.email),
    FieldSpec('city', 'المدينة', 'City'),
    FieldSpec('website', 'الموقع الإلكتروني', 'Website'),
    FieldSpec('notes', 'ملاحظات', 'Notes', type: FieldType.textarea),
  ],
);

final crmContactsCfg = ResourceConfig(
  arTitle: 'جهات الاتصال', enTitle: 'Contacts', icon: Icons.contact_phone_outlined,
  endpoint: '/api/crm/contacts', listKey: 'contacts', liveEvent: 'crm:contact',
  searchFields: const ['firstName', 'lastName', 'arabicName', 'phone', 'mobile', 'email'],
  titleOf: (r) => _s(r, 'arabicName').isNotEmpty
      ? _s(r, 'arabicName')
      : '${_s(r, 'firstName')} ${_s(r, 'lastName')}'.trim(),
  subtitleOf: (r) => [_s(r, 'title'), _s(r, 'mobile'), _s(r, 'phone')].where((x) => x.isNotEmpty).join(' · '),
  fields: const [
    FieldSpec('firstName', 'الاسم الأول', 'First name', required: true),
    FieldSpec('lastName', 'اسم العائلة', 'Last name'),
    FieldSpec('arabicName', 'الاسم العربي', 'Arabic name'),
    FieldSpec('title', 'المسمى الوظيفي', 'Job title'),
    FieldSpec('mobile', 'الجوال', 'Mobile', type: FieldType.phone),
    FieldSpec('email', 'البريد الإلكتروني', 'Email', type: FieldType.email),
    FieldSpec('whatsapp', 'واتساب', 'WhatsApp', type: FieldType.phone),
    FieldSpec('notes', 'ملاحظات', 'Notes', type: FieldType.textarea),
  ],
);

// ── تطوير الأعمال ────────────────────────────────────────────────────────────
final bdOpportunitiesCfg = ResourceConfig(
  arTitle: 'الفرص الاستراتيجية', enTitle: 'Opportunities', icon: Icons.explore_outlined,
  endpoint: '/api/business-development/opportunities', listKey: 'opportunities',
  liveEvent: 'bd:updated',
  searchFields: const ['name', 'nameAr', 'partnerName', 'region', 'city'],
  titleOf: (r) => _s(r, 'nameAr').isNotEmpty ? _s(r, 'nameAr') : _s(r, 'name'),
  subtitleOf: (r) => [_s(r, 'partnerName'), _s(r, 'city')].where((x) => x.isNotEmpty).join(' · '),
  chipsOf: (r) => [
    switch (_s(r, 'stage')) {
      'identified' => ('مرصودة', T.inkSoft),
      'researching' => ('قيد الدراسة', T.info),
      'qualified' => ('مؤهلة', T.cyan),
      'proposal' => ('عرض مقدم', T.violet),
      'negotiation' => ('تفاوض', T.warn),
      'won' => ('مكسوبة', T.success),
      'lost' => ('خاسرة', T.danger),
      _ => ('معلقة', T.inkFaint),
    },
    if (r['estimatedValue'] != null) ('${r['estimatedValue']}', T.navy),
  ],
  fields: const [
    FieldSpec('name', 'اسم الفرصة', 'Name', required: true),
    FieldSpec('nameAr', 'الاسم العربي', 'Arabic name'),
    FieldSpec('stage', 'المرحلة', 'Stage', type: FieldType.select, options: [
      ('identified', 'مرصودة', 'Identified'), ('researching', 'قيد الدراسة', 'Researching'),
      ('qualified', 'مؤهلة', 'Qualified'), ('proposal', 'عرض مقدم', 'Proposal'),
      ('negotiation', 'تفاوض', 'Negotiation'), ('won', 'مكسوبة', 'Won'),
      ('lost', 'خاسرة', 'Lost'), ('on_hold', 'معلقة', 'On hold'),
    ]),
    FieldSpec('priority', 'الأولوية', 'Priority', type: FieldType.select, options: [
      ('high', 'مرتفعة', 'High'), ('medium', 'متوسطة', 'Medium'), ('low', 'منخفضة', 'Low'),
    ]),
    FieldSpec('estimatedValue', 'القيمة التقديرية', 'Estimated value', type: FieldType.number),
    FieldSpec('partnerName', 'الشريك', 'Partner'),
    FieldSpec('region', 'المنطقة', 'Region'),
    FieldSpec('city', 'المدينة', 'City'),
    FieldSpec('expectedCloseDate', 'تاريخ الإغلاق المتوقع', 'Expected close', type: FieldType.date),
    FieldSpec('nextStep', 'الخطوة التالية', 'Next step'),
    FieldSpec('description', 'الوصف', 'Description', type: FieldType.textarea),
  ],
);

final bdPartnersCfg = ResourceConfig(
  arTitle: 'الشراكات', enTitle: 'Partners', icon: Icons.handshake_outlined,
  endpoint: '/api/business-development/partners', listKey: 'partners',
  liveEvent: 'bd:updated',
  searchFields: const ['name', 'nameAr', 'contactName', 'contactPhone', 'city'],
  titleOf: (r) => _s(r, 'nameAr').isNotEmpty ? _s(r, 'nameAr') : _s(r, 'name'),
  subtitleOf: (r) => [_s(r, 'contactName'), _s(r, 'city')].where((x) => x.isNotEmpty).join(' · '),
  chipsOf: (r) => [
    switch (_s(r, 'status')) {
      'active' => ('نشطة', T.success),
      'in_discussion' => ('قيد النقاش', T.info),
      'prospect' => ('مرشحة', T.inkSoft),
      'paused' => ('متوقفة مؤقتًا', T.warn),
      _ => ('منتهية', T.inkFaint),
    },
  ],
  fields: const [
    FieldSpec('name', 'اسم الشريك', 'Name', required: true),
    FieldSpec('nameAr', 'الاسم العربي', 'Arabic name'),
    FieldSpec('status', 'الحالة', 'Status', type: FieldType.select, options: [
      ('prospect', 'مرشحة', 'Prospect'), ('in_discussion', 'قيد النقاش', 'In discussion'),
      ('active', 'نشطة', 'Active'), ('paused', 'متوقفة مؤقتًا', 'Paused'), ('ended', 'منتهية', 'Ended'),
    ]),
    FieldSpec('contactName', 'جهة الاتصال', 'Contact'),
    FieldSpec('contactPhone', 'جوال جهة الاتصال', 'Contact phone', type: FieldType.phone),
    FieldSpec('contactEmail', 'البريد', 'Email', type: FieldType.email),
    FieldSpec('city', 'المدينة', 'City'),
    FieldSpec('services', 'الخدمات', 'Services'),
    FieldSpec('agreementStart', 'بداية الاتفاقية', 'Agreement start', type: FieldType.date),
    FieldSpec('agreementEnd', 'نهاية الاتفاقية', 'Agreement end', type: FieldType.date),
    FieldSpec('notes', 'ملاحظات', 'Notes', type: FieldType.textarea),
  ],
);

final bdTendersCfg = ResourceConfig(
  arTitle: 'المناقصات', enTitle: 'Tenders', icon: Icons.gavel_outlined,
  endpoint: '/api/business-development/tenders', listKey: 'tenders',
  liveEvent: 'bd:updated',
  searchFields: const ['title', 'titleAr', 'entity', 'referenceNumber'],
  titleOf: (r) => _s(r, 'titleAr').isNotEmpty ? _s(r, 'titleAr') : _s(r, 'title'),
  subtitleOf: (r) => [_s(r, 'entity'), _s(r, 'referenceNumber')].where((x) => x.isNotEmpty).join(' · '),
  chipsOf: (r) => [
    switch (_s(r, 'status')) {
      'watching' => ('قيد الرصد', T.inkSoft),
      'preparing' => ('قيد التجهيز', T.info),
      'submitted' => ('مقدمة', T.cyan),
      'shortlisted' => ('قائمة قصيرة', T.violet),
      'won' => ('مكسوبة', T.success),
      'lost' => ('خاسرة', T.danger),
      _ => ('ملغاة', T.inkFaint),
    },
    if (r['daysLeft'] != null && r['daysLeft'] >= 0) ('باقي ${r['daysLeft']} يوم', T.warn),
  ],
  fields: const [
    FieldSpec('title', 'عنوان المناقصة', 'Title', required: true),
    FieldSpec('titleAr', 'العنوان العربي', 'Arabic title'),
    FieldSpec('entity', 'الجهة الطارحة', 'Entity'),
    FieldSpec('referenceNumber', 'الرقم المرجعي', 'Reference no.'),
    FieldSpec('status', 'الحالة', 'Status', type: FieldType.select, options: [
      ('watching', 'قيد الرصد', 'Watching'), ('preparing', 'قيد التجهيز', 'Preparing'),
      ('submitted', 'مقدمة', 'Submitted'), ('shortlisted', 'قائمة قصيرة', 'Shortlisted'),
      ('won', 'مكسوبة', 'Won'), ('lost', 'خاسرة', 'Lost'), ('cancelled', 'ملغاة', 'Cancelled'),
    ]),
    FieldSpec('submissionDeadline', 'موعد التقديم', 'Deadline', type: FieldType.date),
    FieldSpec('estimatedValue', 'القيمة التقديرية', 'Estimated value', type: FieldType.number),
    FieldSpec('documentsReady', 'المستندات جاهزة', 'Documents ready', type: FieldType.checkbox),
    FieldSpec('scope', 'نطاق العمل', 'Scope', type: FieldType.textarea),
    FieldSpec('notes', 'ملاحظات', 'Notes', type: FieldType.textarea),
  ],
);

// ── التسويق ──────────────────────────────────────────────────────────────────
final marketingCampaignsCfg = ResourceConfig(
  arTitle: 'الحملات', enTitle: 'Campaigns', icon: Icons.flag_outlined,
  endpoint: '/api/marketing/campaigns', listKey: 'items',
  liveEvent: 'marketing:updated',
  searchFields: const ['name', 'nameAr', 'platform', 'objective'],
  titleOf: (r) => _s(r, 'nameAr').isNotEmpty ? _s(r, 'nameAr') : _s(r, 'name'),
  subtitleOf: (r) => [_s(r, 'platform'), _s(r, 'objective')].where((x) => x.isNotEmpty).join(' · '),
  chipsOf: (r) => [
    switch (_s(r, 'status')) {
      'active' => ('نشطة', T.success),
      'paused' => ('متوقفة', T.warn),
      'completed' => ('منتهية', T.inkSoft),
      _ => ('مخططة', T.info),
    },
    if (r['budget'] != null) ('الميزانية: ${r['budget']}', T.navy),
  ],
  fields: const [
    FieldSpec('name', 'اسم الحملة', 'Name', required: true),
    FieldSpec('nameAr', 'الاسم العربي', 'Arabic name'),
    FieldSpec('platform', 'المنصة', 'Platform'),
    FieldSpec('objective', 'الهدف', 'Objective'),
    FieldSpec('status', 'الحالة', 'Status', type: FieldType.select, options: [
      ('planned', 'مخططة', 'Planned'), ('active', 'نشطة', 'Active'),
      ('paused', 'متوقفة', 'Paused'), ('completed', 'منتهية', 'Completed'),
    ]),
    FieldSpec('startDate', 'تاريخ البدء', 'Start', type: FieldType.date),
    FieldSpec('endDate', 'تاريخ الانتهاء', 'End', type: FieldType.date),
    FieldSpec('budget', 'الميزانية', 'Budget', type: FieldType.number),
    FieldSpec('spend', 'المصروف', 'Spend', type: FieldType.number),
    FieldSpec('leads', 'العملاء المحتملون', 'Leads', type: FieldType.number),
    FieldSpec('notes', 'ملاحظات', 'Notes', type: FieldType.textarea),
  ],
);

// ── الورشة ───────────────────────────────────────────────────────────────────
final workshopPurchasesCfg = ResourceConfig(
  arTitle: 'المشتريات', enTitle: 'Purchases', icon: Icons.shopping_cart_outlined,
  endpoint: '/api/workshop/purchases', listKey: 'purchases',
  liveEvent: 'purchase:received',
  canEdit: false, // التسجيل هو الاستلام — التعديل غير مفتوح في السيستم أصلًا
  searchFields: const ['itemName', 'supplier', 'vehicleNumber', 'invoiceNumber'],
  titleOf: (r) => _s(r, 'itemName'),
  subtitleOf: (r) => [
    if (_s(r, 'supplier').isNotEmpty) _s(r, 'supplier'),
    if (_s(r, 'vehicleNumber').isNotEmpty) _s(r, 'vehicleNumber'),
  ].join(' · '),
  chipsOf: (r) => [
    ('الكمية: ${r['quantity'] ?? 1}', T.navy),
    if (r['cost'] != null) ('${r['cost']} ر.س', T.success),
    switch (_s(r, 'status')) {
      'received' => ('في المستودع', T.success),
      'pending' => ('قيد الطلب', T.warn),
      _ => (_s(r, 'status'), T.inkSoft),
    },
  ],
  fields: const [
    FieldSpec('itemName', 'اسم الصنف', 'Item name', required: true),
    FieldSpec('quantity', 'الكمية', 'Quantity', type: FieldType.number, required: true),
    FieldSpec('supplier', 'المورد', 'Supplier'),
    FieldSpec('cost', 'التكلفة', 'Cost', type: FieldType.number),
    FieldSpec('invoiceNumber', 'رقم الفاتورة', 'Invoice no.'),
    FieldSpec('vehicleNumber', 'رقم السيارة (إن وجدت)', 'Vehicle no.'),
    FieldSpec('description', 'الوصف', 'Description', type: FieldType.textarea),
  ],
);
