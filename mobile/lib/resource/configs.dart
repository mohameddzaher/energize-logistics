import 'package:flutter/material.dart';
import '../services/lang.dart';
import '../ui/theme.dart';
import '../screens/crm_company_profile.dart';
import '../screens/contracts_vendor_profile.dart';
import '../screens/customs_detail.dart';
import '../screens/bd_opportunity_detail.dart';
import '../screens/marketing_campaign_detail.dart';
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
  onOpen: (c, r) => Navigator.push(c, MaterialPageRoute(builder: (_) => ContractsVendorProfileScreen(vendorId: (r['_id'] ?? '').toString(), name: (r['name'] ?? '').toString()))),
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
  onOpen: (c, r) => Navigator.push(c, MaterialPageRoute(builder: (_) => CrmCompanyProfileScreen(companyId: (r['_id'] ?? '').toString(), name: (r['name'] ?? '').toString()))),
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
  onOpen: (c, r) => Navigator.push(c, MaterialPageRoute(builder: (_) => BdOpportunityDetailScreen(opportunityId: (r['_id'] ?? '').toString(), name: (r['name'] ?? '').toString()))),
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
  onOpen: (c, r) => Navigator.push(c, MaterialPageRoute(builder: (_) => MarketingCampaignDetailScreen(campaignId: (r['_id'] ?? '').toString(), name: (r['nameAr'] ?? r['name'] ?? '').toString()))),
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

// ── إدارة العلاقات: الصفقات والمهام والأنشطة ─────────────────────────────────
final crmDealsCfg = ResourceConfig(
  arTitle: 'الصفقات', enTitle: 'Deals', icon: Icons.attach_money_outlined,
  endpoint: '/api/crm/deals', listKey: 'deals', liveEvent: 'crm:deal',
  searchFields: const ['title', 'stage', 'source'],
  titleOf: (r) => _s(r, 'title'),
  subtitleOf: (r) => [_s(r, 'source')].where((x) => x.isNotEmpty).join(' · '),
  chipsOf: (r) => [
    (_s(r, 'stage'), T.cyan),
    if (r['value'] != null) ('${r['value']} ${_s(r, 'currency')}', T.success),
    if (r['probability'] != null) ('${r['probability']}%', T.inkSoft),
  ],
  fields: const [
    FieldSpec('title', 'عنوان الصفقة', 'Title', required: true),
    FieldSpec('stage', 'المرحلة', 'Stage', type: FieldType.select, options: [
      ('lead', 'عميل محتمل', 'Lead'), ('qualified', 'مؤهلة', 'Qualified'),
      ('proposal', 'عرض مقدم', 'Proposal'), ('negotiation', 'تفاوض', 'Negotiation'),
      ('won', 'مكسوبة', 'Won'), ('lost', 'خاسرة', 'Lost'),
    ]),
    FieldSpec('value', 'القيمة', 'Value', type: FieldType.number),
    FieldSpec('probability', 'الاحتمالية %', 'Probability %', type: FieldType.number),
    FieldSpec('expectedCloseDate', 'تاريخ الإغلاق المتوقع', 'Expected close', type: FieldType.date),
    FieldSpec('source', 'المصدر', 'Source'),
    FieldSpec('notes', 'ملاحظات', 'Notes', type: FieldType.textarea),
  ],
);

final crmTasksCfg = ResourceConfig(
  arTitle: 'مهام العلاقات', enTitle: 'CRM Tasks', icon: Icons.task_alt_outlined,
  endpoint: '/api/crm/tasks', listKey: 'tasks', liveEvent: 'crm:task',
  searchFields: const ['title', 'status', 'priority'],
  titleOf: (r) => _s(r, 'title'),
  subtitleOf: (r) => _s(r, 'description'),
  chipsOf: (r) => [
    switch (_s(r, 'status')) {
      'done' => ('منجزة', T.success),
      'in_progress' => ('قيد التنفيذ', T.info),
      _ => ('مفتوحة', T.warn),
    },
    if (_s(r, 'dueDate').isNotEmpty) (_s(r, 'dueDate').split('T').first, T.inkSoft),
  ],
  fields: const [
    FieldSpec('title', 'العنوان', 'Title', required: true),
    FieldSpec('description', 'التفاصيل', 'Details', type: FieldType.textarea),
    FieldSpec('status', 'الحالة', 'Status', type: FieldType.select, options: [
      ('open', 'مفتوحة', 'Open'), ('in_progress', 'قيد التنفيذ', 'In progress'), ('done', 'منجزة', 'Done'),
    ]),
    FieldSpec('priority', 'الأولوية', 'Priority', type: FieldType.select, options: [
      ('high', 'مرتفعة', 'High'), ('medium', 'متوسطة', 'Medium'), ('low', 'منخفضة', 'Low'),
    ]),
    FieldSpec('dueDate', 'تاريخ الاستحقاق', 'Due date', type: FieldType.date),
  ],
);

final crmActivitiesCfg = ResourceConfig(
  arTitle: 'الأنشطة', enTitle: 'Activities', icon: Icons.history_outlined,
  endpoint: '/api/crm/activities', listKey: 'activities', liveEvent: 'crm:activity',
  searchFields: const ['subject', 'type', 'outcome'],
  titleOf: (r) => _s(r, 'subject'),
  subtitleOf: (r) => _s(r, 'body'),
  chipsOf: (r) => [
    (_s(r, 'type'), T.violet),
    if (_s(r, 'outcome').isNotEmpty) (_s(r, 'outcome'), T.success),
  ],
  fields: const [
    FieldSpec('subject', 'الموضوع', 'Subject', required: true),
    FieldSpec('type', 'النوع', 'Type', type: FieldType.select, options: [
      ('call', 'مكالمة', 'Call'), ('meeting', 'اجتماع', 'Meeting'),
      ('email', 'بريد', 'Email'), ('visit', 'زيارة', 'Visit'), ('whatsapp', 'واتساب', 'WhatsApp'),
    ]),
    FieldSpec('date', 'التاريخ', 'Date', type: FieldType.date),
    FieldSpec('outcome', 'النتيجة', 'Outcome'),
    FieldSpec('body', 'التفاصيل', 'Details', type: FieldType.textarea),
  ],
);

// ── المبيعات ─────────────────────────────────────────────────────────────────
final salesTargetsCfg = ResourceConfig(
  arTitle: 'الأهداف', enTitle: 'Targets', icon: Icons.track_changes_outlined,
  endpoint: '/api/sales/targets', listKey: 'targets', liveEvent: 'sales:updated',
  searchFields: const ['period', 'notes'],
  titleOf: (r) => _s(r, 'period'),
  subtitleOf: (r) => _s(r, 'notes'),
  chipsOf: (r) => [
    if (r['amountTarget'] != null) ('${r['amountTarget']} ر.س', T.success),
    if (r['dealsTarget'] != null) ('${r['dealsTarget']} صفقة', T.info),
  ],
  fields: const [
    FieldSpec('period', 'الفترة (YYYY-MM)', 'Period (YYYY-MM)', required: true),
    FieldSpec('amountTarget', 'هدف المبلغ', 'Amount target', type: FieldType.number),
    FieldSpec('dealsTarget', 'هدف الصفقات', 'Deals target', type: FieldType.number),
    FieldSpec('notes', 'ملاحظات', 'Notes', type: FieldType.textarea),
  ],
);

// ── الإدارة (Admin) ──────────────────────────────────────────────────────────
final branchesCfg = ResourceConfig(
  arTitle: 'الفروع', enTitle: 'Branches', icon: Icons.store_mall_directory_outlined,
  endpoint: '/api/branches', listKey: 'branches', liveEvent: 'branch:updated',
  searchFields: const ['name', 'code', 'city'],
  titleOf: (r) => _s(r, 'name'),
  subtitleOf: (r) => [_s(r, 'code'), _s(r, 'city')].where((x) => x.isNotEmpty).join(' · '),
  fields: const [
    FieldSpec('name', 'اسم الفرع', 'Name', required: true),
    FieldSpec('code', 'الكود', 'Code'),
    FieldSpec('city', 'المدينة', 'City'),
  ],
);

final expenseCategoriesCfg = ResourceConfig(
  arTitle: 'فئات المصروفات', enTitle: 'Expense Categories', icon: Icons.category_outlined,
  endpoint: '/api/expense-categories', listKey: 'categories', liveEvent: 'expense:updated',
  searchFields: const ['name', 'description'],
  titleOf: (r) => _s(r, 'name'),
  subtitleOf: (r) => _s(r, 'description'),
  fields: const [
    FieldSpec('name', 'اسم الفئة', 'Name', required: true),
    FieldSpec('description', 'الوصف', 'Description', type: FieldType.textarea),
  ],
);

// ── لوكيشن سوليوشن: الإصلاحات ────────────────────────────────────────────────
final ls2RepairsCfg = ResourceConfig(
  arTitle: 'الإصلاحات', enTitle: 'Repairs', icon: Icons.home_repair_service_outlined,
  endpoint: '/api/ls2/repairs', listKey: 'items', liveEvent: 'ls2:updated',
  searchFields: const ['description', 'category', 'status', 'plate'],
  titleOf: (r) => _s(r, 'title').isNotEmpty ? _s(r, 'title') : (_s(r, 'description').isNotEmpty ? _s(r, 'description') : _s(r, 'category')),
  subtitleOf: (r) => [_s(r, 'plate'), _s(r, 'vehicleName')].where((x) => x.isNotEmpty).join(' · '),
  chipsOf: (r) => [
    if (_s(r, 'category').isNotEmpty) (_s(r, 'category'), T.violet),
    switch (_s(r, 'severity')) {
      'high' => ('خطيرة', T.danger),
      'low' => ('بسيطة', T.inkFaint),
      'medium' => ('متوسطة', T.warn),
      _ => ('', T.warn),
    },
    if (r['cost'] != null) ('${r['cost']} ر.س', T.success),
    switch (_s(r, 'status')) {
      'done' => ('منجز', T.success),
      'in_progress' => ('قيد التنفيذ', T.info),
      _ => (_s(r, 'status').isEmpty ? 'مفتوح' : _s(r, 'status'), T.warn),
    },
  ],
  fields: const [
    FieldSpec('unitId', 'رقم الوحدة (Unit ID)', 'Unit ID', type: FieldType.number, required: true),
    FieldSpec('title', 'ماذا حدث؟', 'What happened?', required: true),
    FieldSpec('category', 'التصنيف', 'Category', type: FieldType.select, options: [
      ('breakdown', 'عطل', 'Breakdown'), ('accident', 'حادث', 'Accident'), ('tires', 'كاوتش', 'Tires'),
      ('electrical', 'كهرباء', 'Electrical'), ('engine', 'موتور', 'Engine'), ('body', 'هيكل', 'Body'), ('other', 'أخرى', 'Other'),
    ]),
    FieldSpec('severity', 'الخطورة', 'Severity', type: FieldType.select, options: [
      ('low', 'بسيطة', 'Low'), ('medium', 'متوسطة', 'Medium'), ('high', 'خطيرة', 'High'),
    ]),
    FieldSpec('status', 'الحالة', 'Status', type: FieldType.select, options: [
      ('open', 'مفتوح', 'Open'), ('in_progress', 'قيد التنفيذ', 'In progress'), ('done', 'منجز', 'Done'),
    ]),
    FieldSpec('repairDate', 'تاريخ الإصلاح', 'Repair date', type: FieldType.date),
    FieldSpec('odometerKm', 'العداد وقتها (كم)', 'Odometer (km)', type: FieldType.number),
    FieldSpec('cost', 'التكلفة', 'Cost', type: FieldType.number),
    FieldSpec('workshop', 'الورشة / الفني', 'Workshop', ),
    FieldSpec('partsReplaced', 'القطع المستبدلة', 'Parts replaced', type: FieldType.textarea),
    FieldSpec('driver', 'السائق وقتها', 'Driver'),
    FieldSpec('description', 'تفاصيل الإصلاح', 'Details', type: FieldType.textarea),
  ],
);

// ── الموارد البشرية: التراخيص وأنواع الإجازات ────────────────────────────────
final hrLicensesCfg = ResourceConfig(
  arTitle: 'التراخيص والاشتراكات', enTitle: 'Licenses', icon: Icons.workspace_premium_outlined,
  endpoint: '/api/hr/licenses', listKey: 'items', liveEvent: 'hr:license',
  searchFields: const ['name', 'category', 'issuer', 'city'],
  titleOf: (r) => _s(r, 'name'),
  subtitleOf: (r) => [_s(r, 'category'), _s(r, 'city')].where((x) => x.isNotEmpty).join(' · '),
  chipsOf: (r) {
    final end = DateTime.tryParse(_s(r, 'endDate'));
    final days = end?.difference(DateTime.now()).inDays;
    return [
      if (days != null)
        days < 0 ? ('منتهية', T.danger) : days <= 60 ? ('باقي $days يوم', T.warn) : ('سارية', T.success),
    ];
  },
  fields: const [
    FieldSpec('name', 'اسم الترخيص', 'Name', required: true),
    FieldSpec('category', 'التصنيف', 'Category', required: true),
    FieldSpec('issuer', 'الجهة المصدرة', 'Issuer'),
    FieldSpec('city', 'المدينة', 'City'),
    FieldSpec('startDate', 'تاريخ الإصدار', 'Start date', type: FieldType.date),
    FieldSpec('endDate', 'تاريخ الانتهاء', 'End date', type: FieldType.date),
    FieldSpec('cost', 'التكلفة', 'Cost', type: FieldType.number),
    FieldSpec('notes', 'ملاحظات', 'Notes', type: FieldType.textarea),
  ],
);

final hrLeaveTypesCfg = ResourceConfig(
  arTitle: 'أنواع الإجازات', enTitle: 'Leave Types', icon: Icons.event_note_outlined,
  endpoint: '/api/hr/leave-types', listKey: 'leaveTypes', liveEvent: 'hr:leave',
  searchFields: const ['nameAr', 'nameEn', 'code'],
  titleOf: (r) => _s(r, 'nameAr').isNotEmpty ? _s(r, 'nameAr') : _s(r, 'nameEn'),
  subtitleOf: (r) => _s(r, 'code'),
  fields: const [
    FieldSpec('nameAr', 'الاسم بالعربية', 'Arabic name', required: true),
    FieldSpec('nameEn', 'الاسم بالإنجليزية', 'English name'),
    FieldSpec('code', 'الكود', 'Code'),
  ],
);

// ── التخليص الجمركي ──────────────────────────────────────────────────────────
final customsCfg = ResourceConfig(
  onOpen: (c, r) => Navigator.push(c, MaterialPageRoute(builder: (_) => CustomsDetailScreen(clearanceId: (r['_id'] ?? '').toString(), ref: (r['refNumber'] ?? '').toString()))),
  arTitle: 'التخليص الجمركي', enTitle: 'Customs Clearance', icon: Icons.directions_boat_outlined,
  endpoint: '/api/customs-clearance', listKey: 'clearances', liveEvent: 'customs:updated',
  searchFields: const ['refNumber', 'customerName', 'blNumber', 'declarationNumber', 'exporterCompany', 'city'],
  titleOf: (r) => _s(r, 'refNumber').isNotEmpty ? '${_s(r, 'refNumber')} — ${_s(r, 'customerName')}' : _s(r, 'customerName'),
  subtitleOf: (r) => [
    if (_s(r, 'blNumber').isNotEmpty) 'BL: ${_s(r, 'blNumber')}',
    if (_s(r, 'exporterCompany').isNotEmpty) _s(r, 'exporterCompany'),
  ].join(' · '),
  chipsOf: (r) => [
    switch (_s(r, 'stage')) {
      'papers_received' => ('استلام الأوراق', T.inkSoft),
      'declaration_paid' => ('سداد البيان', T.info),
      'do_requested' => ('طلب إذن التسليم', T.info),
      'do_linked' => ('ربط إذن التسليم', T.cyan),
      'port_fees_paid' => ('سداد أجور الموانئ', T.cyan),
      'unloading_fees_paid' => ('سداد أجور التفريغ', T.cyan),
      'transport_order' => ('أمر نقل', T.violet),
      'containers_transported' => ('نقل الحاويات', T.violet),
      'unloaded_stored' => ('التفريغ والتخزين', T.warn),
      'containers_returned' => ('إرجاع الحاويات', T.warn),
      'invoiced' => ('تمت الفوترة', T.success),
      _ => (_s(r, 'stage'), T.inkFaint),
    },
    if (r['containerCount'] != null) ('${r['containerCount']} حاوية', T.navy),
    (_s(r, 'branch') == 'dammam' ? 'الدمام' : 'جدة', T.inkSoft),
  ],
  fields: const [
    FieldSpec('refNumber', 'الرقم المرجعي', 'Ref number'),
    FieldSpec('customerName', 'اسم العميل', 'Customer', required: true),
    FieldSpec('blNumber', 'رقم البوليصة BL', 'BL number'),
    FieldSpec('declarationNumber', 'رقم البيان الجمركي', 'Declaration no.'),
    FieldSpec('exporterCompany', 'الشركة المصدّرة', 'Exporter'),
    FieldSpec('countryOfOrigin', 'بلد المنشأ', 'Origin country'),
    FieldSpec('containerCount', 'عدد الحاويات', 'Containers', type: FieldType.number),
    FieldSpec('invoiceValue', 'قيمة الفاتورة', 'Invoice value', type: FieldType.number),
    FieldSpec('branch', 'الفرع', 'Branch', type: FieldType.select, options: [
      ('jeddah', 'جدة', 'Jeddah'), ('dammam', 'الدمام', 'Dammam'),
    ]),
    FieldSpec('stage', 'المرحلة', 'Stage', type: FieldType.select, options: [
      ('papers_received', 'استلام الأوراق', 'Papers received'),
      ('declaration_paid', 'طباعة البيان وسداده', 'Declaration paid'),
      ('do_requested', 'طلب إذن التسليم', 'DO requested'),
      ('do_linked', 'ربط إذن التسليم', 'DO linked'),
      ('port_fees_paid', 'سداد أجور الموانئ', 'Port fees paid'),
      ('unloading_fees_paid', 'سداد أجور التفريغ', 'Unloading fees paid'),
      ('transport_order', 'أمر نقل', 'Transport order'),
      ('containers_transported', 'نقل الحاويات', 'Containers moved'),
      ('unloaded_stored', 'التفريغ والتخزين', 'Unloaded & stored'),
      ('containers_returned', 'إرجاع الحاويات', 'Containers returned'),
      ('invoiced', 'عمل الفواتير', 'Invoiced'),
    ]),
    FieldSpec('declarationDate', 'تاريخ البيان', 'Declaration date', type: FieldType.date),
    FieldSpec('notes', 'ملاحظات', 'Notes', type: FieldType.textarea),
  ],
);

// ── الورشة: طلبات الصيانة ────────────────────────────────────────────────────
final workshopMaintenanceCfg = ResourceConfig(
  arTitle: 'طلبات الصيانة', enTitle: 'Maintenance Requests', icon: Icons.build_circle_outlined,
  endpoint: '/api/workshop/maintenance', listKey: 'requests',
  liveEvent: 'maintenance:updated',
  searchFields: const ['vehicleNumber', 'driverName', 'technicianName', 'status'],
  titleOf: (r) => _s(r, 'vehicleNumber'),
  subtitleOf: (r) => [_s(r, 'driverName'), _s(r, 'technicianName')].where((x) => x.isNotEmpty).join(' · '),
  chipsOf: (r) => [
    switch (_s(r, 'status')) {
      'completed' => ('مكتملة', T.success),
      'in_progress' => ('قيد الإصلاح', T.info),
      _ => ('جديدة', T.warn),
    },
    if (_s(r, 'vehicleType').isNotEmpty) (_s(r, 'vehicleType'), T.navy),
  ],
  fields: const [
    FieldSpec('vehicleNumber', 'رقم السيارة', 'Vehicle number', required: true),
    FieldSpec('vehicleType', 'نوع السيارة', 'Vehicle type'),
    FieldSpec('driverName', 'اسم السائق', 'Driver'),
    FieldSpec('technicianName', 'الفني المسؤول', 'Technician'),
    FieldSpec('notes', 'ملاحظات / الأعطال', 'Notes', type: FieldType.textarea),
  ],
);

// ── تقنية المعلومات ──────────────────────────────────────────────────────────
final itTicketsCfg = ResourceConfig(
  arTitle: 'التذاكر والمشكلات', enTitle: 'IT Tickets', icon: Icons.confirmation_number_outlined,
  endpoint: '/api/it/tickets', listKey: 'tickets', liveEvent: 'it:updated',
  searchFields: const ['title', 'requesterName', 'category', 'status', 'device'],
  titleOf: (r) => _s(r, 'title'),
  subtitleOf: (r) => [_s(r, 'requesterName'), _s(r, 'device')].where((x) => x.isNotEmpty).join(' · '),
  chipsOf: (r) => [
    switch (_s(r, 'status')) {
      'resolved' => ('محلولة', T.success),
      'closed' => ('مغلقة', T.inkFaint),
      'in_progress' => ('قيد الحل', T.info),
      _ => ('مفتوحة', T.warn),
    },
    switch (_s(r, 'priority')) {
      'high' => ('مرتفعة', T.danger),
      'low' => ('منخفضة', T.inkFaint),
      _ => ('متوسطة', T.warn),
    },
  ],
  fields: const [
    FieldSpec('title', 'عنوان المشكلة', 'Title', required: true),
    FieldSpec('requesterName', 'مقدم الطلب', 'Requester'),
    FieldSpec('category', 'التصنيف', 'Category'),
    FieldSpec('device', 'الجهاز', 'Device'),
    FieldSpec('priority', 'الأولوية', 'Priority', type: FieldType.select, options: [
      ('high', 'مرتفعة', 'High'), ('medium', 'متوسطة', 'Medium'), ('low', 'منخفضة', 'Low'),
    ]),
    FieldSpec('status', 'الحالة', 'Status', type: FieldType.select, options: [
      ('open', 'مفتوحة', 'Open'), ('in_progress', 'قيد الحل', 'In progress'),
      ('resolved', 'محلولة', 'Resolved'), ('closed', 'مغلقة', 'Closed'),
    ]),
    FieldSpec('description', 'الوصف', 'Description', type: FieldType.textarea),
    FieldSpec('resolution', 'الحل', 'Resolution', type: FieldType.textarea),
    FieldSpec('rootCause', 'السبب الجذري', 'Root cause'),
  ],
);

final itSystemsCfg = ResourceConfig(
  arTitle: 'الأنظمة والخدمات', enTitle: 'Systems & Services', icon: Icons.dns_outlined,
  endpoint: '/api/it/systems', listKey: 'systems', liveEvent: 'it:updated',
  searchFields: const ['name', 'nameAr', 'type', 'vendor', 'url'],
  titleOf: (r) => _s(r, 'nameAr').isNotEmpty ? _s(r, 'nameAr') : _s(r, 'name'),
  subtitleOf: (r) => [_s(r, 'type'), _s(r, 'vendor')].where((x) => x.isNotEmpty).join(' · '),
  chipsOf: (r) => [
    switch (_s(r, 'status')) {
      'active' => ('نشط', T.success),
      'retired' => ('متوقف', T.inkFaint),
      _ => (_s(r, 'status').isEmpty ? 'نشط' : _s(r, 'status'), T.info),
    },
    if (r['cost'] != null) ('${r['cost']} ${_s(r, 'costPeriod')}', T.navy),
  ],
  fields: const [
    FieldSpec('name', 'اسم النظام', 'Name', required: true),
    FieldSpec('nameAr', 'الاسم العربي', 'Arabic name'),
    FieldSpec('type', 'النوع', 'Type'),
    FieldSpec('vendor', 'المزود', 'Vendor'),
    FieldSpec('url', 'الرابط', 'URL'),
    FieldSpec('renewalDate', 'تاريخ التجديد', 'Renewal date', type: FieldType.date),
    FieldSpec('cost', 'التكلفة', 'Cost', type: FieldType.number),
    FieldSpec('description', 'الوصف', 'Description', type: FieldType.textarea),
  ],
);

final itStockCfg = ResourceConfig(
  arTitle: 'مستودع الأجهزة', enTitle: 'IT Stock', icon: Icons.inventory_outlined,
  endpoint: '/api/it/stock', listKey: 'items', liveEvent: 'it:updated',
  searchFields: const ['name', 'type', 'serialNumber', 'brand', 'model'],
  titleOf: (r) => _s(r, 'name'),
  subtitleOf: (r) => [_s(r, 'brand'), _s(r, 'model'), _s(r, 'serialNumber')].where((x) => x.isNotEmpty).join(' · '),
  chipsOf: (r) => [
    if (r['quantity'] != null) ('الكمية: ${r['quantity']}', T.navy),
    if (_s(r, 'condition').isNotEmpty) (_s(r, 'condition'), T.cyan),
  ],
  fields: const [
    FieldSpec('name', 'اسم الجهاز', 'Name', required: true),
    FieldSpec('type', 'النوع', 'Type'),
    FieldSpec('brand', 'الماركة', 'Brand'),
    FieldSpec('model', 'الموديل', 'Model'),
    FieldSpec('serialNumber', 'السيريال', 'Serial', ),
    FieldSpec('quantity', 'الكمية', 'Quantity', type: FieldType.number),
    FieldSpec('condition', 'الحالة', 'Condition'),
    FieldSpec('location', 'المكان', 'Location'),
    FieldSpec('notes', 'ملاحظات', 'Notes', type: FieldType.textarea),
  ],
);

// ── B2C ──────────────────────────────────────────────────────────────────────
final b2cProjectsCfg = ResourceConfig(
  arTitle: 'مشاريع B2C', enTitle: 'B2C Projects', icon: Icons.folder_special_outlined,
  endpoint: '/api/b2c/projects', listKey: 'projects', liveEvent: 'b2c:*',
  searchFields: const ['name', 'code'],
  titleOf: (r) => _s(r, 'name'),
  subtitleOf: (r) => _s(r, 'code'),
  chipsOf: (r) => [
    if (r['monthlyTarget'] != null) ('هدف شهري: ${r['monthlyTarget']}', T.navy),
    if (r['dailyTarget'] != null) ('يومي: ${r['dailyTarget']}', T.cyan),
  ],
  fields: const [
    FieldSpec('name', 'اسم المشروع', 'Name', required: true),
    FieldSpec('code', 'الكود', 'Code'),
    FieldSpec('monthlyTarget', 'الهدف الشهري', 'Monthly target', type: FieldType.number),
    FieldSpec('dailyTarget', 'الهدف اليومي', 'Daily target', type: FieldType.number),
    FieldSpec('expectedWorkingDays', 'أيام العمل المتوقعة', 'Working days', type: FieldType.number),
    FieldSpec('description', 'الوصف', 'Description', type: FieldType.textarea),
  ],
);

final b2cRepsCfg = ResourceConfig(
  arTitle: 'مناديب B2C', enTitle: 'B2C Reps', icon: Icons.sports_motorsports_outlined,
  endpoint: '/api/b2c/reps', listKey: 'reps', liveEvent: 'b2c:*',
  searchFields: const ['arabicName', 'englishName', 'repId', 'phone'],
  titleOf: (r) => _s(r, 'arabicName').isNotEmpty ? _s(r, 'arabicName') : _s(r, 'englishName'),
  subtitleOf: (r) => [_s(r, 'repId'), _s(r, 'phone')].where((x) => x.isNotEmpty).join(' · '),
  chipsOf: (r) => [
    if (r['monthlyTarget'] != null) ('هدف: ${r['monthlyTarget']}', T.navy),
  ],
  fields: const [
    FieldSpec('repId', 'رقم المندوب', 'Rep ID', required: true),
    FieldSpec('arabicName', 'الاسم بالعربية', 'Arabic name', required: true),
    FieldSpec('englishName', 'الاسم بالإنجليزية', 'English name'),
    FieldSpec('phone', 'الجوال', 'Phone', type: FieldType.phone),
    FieldSpec('joiningDate', 'تاريخ الانضمام', 'Joining date', type: FieldType.date),
    FieldSpec('monthlyTarget', 'الهدف الشهري', 'Monthly target', type: FieldType.number),
    FieldSpec('dailyTarget', 'الهدف اليومي', 'Daily target', type: FieldType.number),
    FieldSpec('notes', 'ملاحظات', 'Notes', type: FieldType.textarea),
  ],
);

// ── طلبات الشحنات (التجربة المستقلة) ────────────────────────────────────────
final shipmentOrdersCustomersCfg = ResourceConfig(
  arTitle: 'عملاء طلبات الشحن', enTitle: 'SO Customers', icon: Icons.people_outline,
  endpoint: '/api/shipment-orders/customers', listKey: 'customers', liveEvent: 'shipmentOrders:customers',
  searchFields: const ['name', 'phone'],
  titleOf: (r) => _s(r, 'name'),
  subtitleOf: (r) => _s(r, 'phone'),
  fields: const [
    FieldSpec('name', 'اسم العميل', 'Name', required: true),
    FieldSpec('phone', 'الجوال', 'Phone', type: FieldType.phone),
    FieldSpec('notes', 'ملاحظات', 'Notes', type: FieldType.textarea),
  ],
);

final shipmentOrdersSuppliersCfg = ResourceConfig(
  arTitle: 'موردو الشاحنات', enTitle: 'SO Suppliers', icon: Icons.business_outlined,
  endpoint: '/api/shipment-orders/suppliers', listKey: 'suppliers', liveEvent: 'shipmentOrders:fleet',
  searchFields: const ['name', 'phone'],
  titleOf: (r) => _s(r, 'name'),
  subtitleOf: (r) => _s(r, 'phone'),
  chipsOf: (r) => [(r['type'] == 'freelancer' ? tr('مستقل', 'Freelancer') : tr('شركة', 'Company'), const Color(0xFF4F46E5))],
  fields: const [
    FieldSpec('name', 'اسم المورد', 'Name', required: true),
    FieldSpec('type', 'النوع', 'Type', type: FieldType.select, options: [
      ('company', 'شركة', 'Company'),
      ('freelancer', 'مستقل', 'Freelancer'),
    ]),
    FieldSpec('phone', 'الجوال', 'Phone', type: FieldType.phone),
    FieldSpec('email', 'البريد', 'Email', type: FieldType.email),
    FieldSpec('notes', 'ملاحظات', 'Notes', type: FieldType.textarea),
  ],
);

final shipmentOrdersVehiclesCfg = ResourceConfig(
  arTitle: 'شاحنات طلبات الشحن', enTitle: 'SO Vehicles', icon: Icons.local_shipping_outlined,
  endpoint: '/api/shipment-orders/vehicles', listKey: 'vehicles', liveEvent: 'shipmentOrders:fleet',
  searchFields: const ['plate', 'name', 'defaultDriverName'],
  titleOf: (r) => _s(r, 'plate'),
  subtitleOf: (r) => '${_s(r, 'name')} ${_s(r, 'defaultDriverName')}'.trim(),
  fields: const [
    FieldSpec('plate', 'اللوحة', 'Plate', required: true),
    FieldSpec('name', 'وصف الشاحنة', 'Description'),
    FieldSpec('truckType', 'نوع الشاحنة', 'Truck type'),
    FieldSpec('defaultDriverName', 'السائق الافتراضي', 'Default driver'),
    FieldSpec('defaultDriverPhone', 'هاتف السائق', 'Driver phone', type: FieldType.phone),
    FieldSpec('notes', 'ملاحظات', 'Notes', type: FieldType.textarea),
  ],
);

final vendorsCfg = ResourceConfig(
  arTitle: 'الموردون', enTitle: 'Vendors', icon: Icons.store_outlined,
  endpoint: '/api/vendors', listKey: 'vendors', liveEvent: 'vendor:updated',
  searchFields: const ['name', 'contactPerson', 'phone', 'category'],
  titleOf: (r) => _s(r, 'name'),
  subtitleOf: (r) => [_s(r, 'contactPerson'), _s(r, 'phone')].where((x) => x.isNotEmpty).join(' · '),
  chipsOf: (r) => [
    if (_s(r, 'category').isNotEmpty) (_s(r, 'category'), T.navy),
    if ((r['totalOutstanding'] ?? 0) != 0) ('مستحق: ${r['totalOutstanding']}', T.danger),
  ],
  fields: const [
    FieldSpec('name', 'اسم المورد', 'Name', required: true),
    FieldSpec('contactPerson', 'جهة الاتصال', 'Contact person'),
    FieldSpec('phone', 'الجوال', 'Phone', type: FieldType.phone),
    FieldSpec('email', 'البريد', 'Email', type: FieldType.email),
    FieldSpec('category', 'الفئة', 'Category'),
    FieldSpec('address', 'العنوان', 'Address'),
    FieldSpec('notes', 'ملاحظات', 'Notes', type: FieldType.textarea),
  ],
);

final shipmentOrdersFieldsCfg = ResourceConfig(
  arTitle: 'إعدادات النموذج', enTitle: 'Form Settings', icon: Icons.tune_outlined,
  endpoint: '/api/shipment-orders/fields?all=1', listKey: 'fields', liveEvent: 'shipmentOrders:fields',
  searchFields: const ['labelAr', 'labelEn', 'group'],
  titleOf: (r) => _s(r, 'labelAr'),
  subtitleOf: (r) => [_s(r, 'labelEn'), _s(r, 'inputType')].where((x) => x.isNotEmpty).join(' · '),
  chipsOf: (r) => [
    switch (_s(r, 'group')) {
      'pickup_delivery' => ('الاستلام والتسليم', T.info),
      'shipment' => ('الشحنة', T.navy),
      'pricing_time' => ('التسعير والمواعيد', T.violet),
      'payment' => ('الدفع', T.orange),
      _ => (_s(r, 'group'), T.inkFaint),
    },
    r['active'] != false ? ('مُفعّل', T.success) : ('معطّل', T.inkFaint),
    if (r['required'] == true) ('إلزامي', T.danger),
    if (r['isSystem'] == true) ('نظامي', T.cyan),
  ],
  fields: const [
    FieldSpec('labelAr', 'التسمية بالعربية', 'Arabic label', required: true),
    FieldSpec('labelEn', 'التسمية بالإنجليزية', 'English label'),
    FieldSpec('group', 'المجموعة', 'Group', type: FieldType.select, options: [
      ('pickup_delivery', 'الاستلام والتسليم', 'Pickup & delivery'),
      ('shipment', 'الشحنة', 'Shipment'),
      ('pricing_time', 'التسعير والمواعيد', 'Pricing & times'),
      ('payment', 'الدفع', 'Payment'),
    ]),
    FieldSpec('inputType', 'نوع الحقل', 'Input type', type: FieldType.select, options: [
      ('text', 'نص', 'Text'), ('number', 'رقم', 'Number'), ('textarea', 'نص طويل', 'Textarea'),
      ('select', 'قائمة', 'Select'), ('cards', 'بطاقات', 'Cards'), ('datetime', 'تاريخ ووقت', 'Datetime'),
    ]),
    FieldSpec('required', 'إلزامي', 'Required', type: FieldType.checkbox),
    FieldSpec('active', 'مُفعّل', 'Active', type: FieldType.checkbox),
    FieldSpec('order', 'الترتيب', 'Order', type: FieldType.number),
  ],
);
