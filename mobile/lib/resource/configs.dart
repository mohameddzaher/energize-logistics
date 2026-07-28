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
