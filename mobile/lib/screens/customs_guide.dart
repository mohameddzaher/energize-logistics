import 'package:flutter/material.dart';
import '../services/lang.dart';
import '../ui/app_scaffold.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';
import 'customs_detail.dart' show customsStages;

/// دليل التخليص الجمركي — محتوى ثابت: دورة التخليص، المنصات، المستندات
/// والبيانات المطلوبة، أوراق الوكيل، وقوالب البريد — نفس دليل الويب.
class CustomsGuideScreen extends StatelessWidget {
  const CustomsGuideScreen({super.key});

  static const _platforms = [
    ('TRACE TRACK', 'تتبّع مسارات السفن والحاويات برقم البوليصة أو الحاوية', 'Track vessel & container routes by BL or container number'),
    ('فسح / زاتكا (Fasah)', 'إنشاء البيانات (الإقرارات) وطباعتها، وطباعة أجور التفريغ', 'Create declarations, print them, print unloading fees'),
    ('منصة مواني (Mawani)', 'طباعة فواتير أجور الموانئ لجدة والدمام', 'Print port fee invoices for Jeddah & Dammam'),
  ];

  static const _requiredDocs = [
    ('بوليصة الشحن', 'Bill of Lading'),
    ('الفاتورة التجارية', 'Commercial Invoice'),
    ('شهادة المنشأ', 'Certificate of Origin'),
    ('قائمة التعبئة', 'Packing List'),
    ('شهادة سابر (إن وُجدت)', 'SABER Certificate (if any)'),
  ];

  static const _requiredData = [
    ('رقم البوليصة', 'BL number'),
    ('رقم الفاتورة وتاريخها', 'Invoice number & date'),
    ('اسم الميناء', 'Port name'),
    ('اسم العميل', 'Customer name'),
    ('نوع الفاتورة (C&F/CIF/FOB)', 'Invoice type'),
    ('عدد الحاويات والوزن الإجمالي', 'Containers & total weight'),
    ('قيمة الفاتورة والعملة', 'Invoice value & currency'),
    ('الشركة المصدّرة وبلد المنشأ', 'Exporter & country of origin'),
    ('رمز التعريفة الجمركية (HS)', 'HS tariff code'),
    ('رقم شهادة سابر (إن وُجد)', 'SABER number (if any)'),
  ];

  static const _agentPapers = [
    ('البوليصة مختومة بختم التخليص ومكتوب عليها رقم المستورد', 'BL stamped with clearance seal + importer number'),
    ('تفويض العميل للشركة', "Customer's authorization to the company"),
    ('تفويض الشركة لمندوب التخليص', "Company's authorization to the rep"),
  ];

  static const _emails = [
    ('طلب فاتورة إذن التسليم', 'Request Delivery Order invoice', 'Dear,\nGreetings,\n\nKindly find attached file & issue DO invoice.', 'أرفق أوراق الوكيل، أضف التوقيع، واكتب رقم البوليصة في الموضوع.'),
    ('طلب ربط إذن التسليم', 'Request DO linking', 'Dear,\nGreetings,\n\nKindly find attached files & link DO.', 'أرفق الملفات المطلوبة للربط.'),
    ('طلب موعد الوصول (ETA)', 'Request ETA', 'Dear,\nGreetings,\n\nKindly Provide ETA for the following BL/s:\n1- ...', 'اذكر أرقام البوالص المطلوب موعدها.'),
  ];

  @override
  Widget build(BuildContext context) {
    return AppScaffold(
      title: Text(tr('دليل التخليص الجمركي', 'Customs Guide')),
      body: ListView(padding: const EdgeInsets.all(14), children: [
        // ── دورة التخليص ──
        _card(Icons.route_outlined, tr('دورة التخليص', 'Clearance cycle'),
          Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            ...customsStages.asMap().entries.map((e) => Padding(
              padding: const EdgeInsets.symmetric(vertical: 4),
              child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                CircleAvatar(radius: 12, backgroundColor: T.navy.withValues(alpha: 0.1), child: Text('${e.key + 1}', style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w800, color: T.navy))),
                const SizedBox(width: 10),
                Expanded(child: Text(tr(e.value.$2, e.value.$3), style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600))),
              ]),
            )),
          ]),
        ),
        // ── المنصات ──
        _card(Icons.dns_outlined, tr('المنصات المستخدمة', 'Platforms'),
          Column(children: _platforms.map((p) => Padding(
            padding: const EdgeInsets.symmetric(vertical: 5),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(p.$1, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13, color: T.orange)),
              Text(tr(p.$2, p.$3), style: const TextStyle(fontSize: 12, color: T.inkSoft)),
            ]),
          )).toList()),
        ),
        // ── المستندات المطلوبة ──
        _bulletCard(Icons.description_outlined, tr('المستندات المطلوبة للمعاملات', 'Documents required'), _requiredDocs),
        // ── البيانات المطلوبة على فسح ──
        _bulletCard(Icons.list_alt_outlined, tr('البيانات المطلوبة لإنشاء المعاملة على فسح', 'Data required on Fasah'), _requiredData),
        // ── أوراق الوكيل ──
        _bulletCard(Icons.folder_shared_outlined, tr('أوراق الوكيل', 'Agent papers'), _agentPapers),
        // ── قوالب البريد ──
        _card(Icons.mail_outline, tr('قوالب البريد للوكيل', 'Email templates'),
          Column(children: _emails.map((m) => Padding(
            padding: const EdgeInsets.only(bottom: 10),
            child: Container(
              width: double.infinity,
              padding: const EdgeInsets.all(11),
              decoration: BoxDecoration(color: T.navy.withValues(alpha: 0.04), borderRadius: BorderRadius.circular(10), border: Border.all(color: T.navy.withValues(alpha: 0.08))),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(tr(m.$1, m.$2), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 12.5)),
                const SizedBox(height: 4),
                Directionality(textDirection: TextDirection.ltr, child: Text(m.$3, style: const TextStyle(fontSize: 11.5, color: T.ink, fontFamily: 'monospace'))),
                const SizedBox(height: 4),
                Text('📌 ${m.$4}', style: const TextStyle(fontSize: 11, color: T.inkFaint)),
              ]),
            ),
          )).toList()),
        ),
        const SizedBox(height: 20),
      ]),
    );
  }

  Widget _card(IconData icon, String title, Widget body) => Padding(
        padding: const EdgeInsets.only(bottom: 12),
        child: AppCard(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(children: [Icon(icon, size: 18, color: T.orange), const SizedBox(width: 8), Text(title, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14.5))]),
            const SizedBox(height: 10),
            body,
          ]),
        ),
      );

  Widget _bulletCard(IconData icon, String title, List<(String, String)> items) => _card(icon, title,
        Column(crossAxisAlignment: CrossAxisAlignment.start, children: items.map((it) => Padding(
          padding: const EdgeInsets.symmetric(vertical: 3),
          child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            const Padding(padding: EdgeInsets.only(top: 5), child: Icon(Icons.check_circle_outline, size: 14, color: T.success)),
            const SizedBox(width: 8),
            Expanded(child: Text(tr(it.$1, it.$2), style: const TextStyle(fontSize: 12.5))),
          ]),
        )).toList()),
      );
}
