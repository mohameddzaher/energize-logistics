import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/contact.dart';
import '../ui/portal_account_card.dart';
import '../ui/report_button.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';

/// تفاصيلُ مورد CRM (3PL) — نظيرُ نافذة التفاصيل في /system/crm/vendors:
/// بياناتُه، التقرير الشامل للمورد، وحسابُ البوابة (المورد يتابع حمولاته).
class CrmVendorDetailScreen extends StatefulWidget {
  final Map<String, dynamic> vendor;
  const CrmVendorDetailScreen({super.key, required this.vendor});
  @override
  State<CrmVendorDetailScreen> createState() => _CrmVendorDetailScreenState();
}

String _tri(dynamic v) => v == true ? tr('نعم', 'Yes') : v == false ? tr('لا', 'No') : '—';

class _CrmVendorDetailScreenState extends State<CrmVendorDetailScreen> {
  late Map<String, dynamic> _v = widget.vendor;
  late final void Function() _onLive;

  @override
  void initState() {
    super.initState();
    _onLive = _reload;
    Live.instance.on('crm:vendor', _onLive);
    _reload();
  }

  @override
  void dispose() { Live.instance.off('crm:vendor', _onLive); super.dispose(); }

  Future<void> _reload() async {
    try {
      final d = await Api.instance.get('/api/crm-vendors/${widget.vendor['_id']}');
      final item = d is Map ? (d['item'] ?? d['vendor'] ?? d) : null;
      if (item is Map && mounted) setState(() => _v = Map<String, dynamic>.from(item));
    } catch (_) {}
  }

  @override
  Widget build(BuildContext context) {
    final v = _v;
    final rows = <(String, dynamic)>[
      (tr('ممثل المورد', 'Representative'), v['representative']),
      (tr('الهاتف', 'Phone'), v['mobile']),
      (tr('البريد', 'Email'), v['email']),
      (tr('مندوب تنشيط', 'Our rep (Energize)'), v['energizeRep']),
      (tr('النوع', 'Type'), v['vendorType']),
      (tr('الوجهات', 'Routes'), v['destinations']),
      (tr('المقر الرئيسي', 'Head office'), v['headOffice']),
      (tr('عدد العربيات', 'Cars count'), v['carsCount']),
      (tr('الأوراق متوفرة', 'Has papers'), _tri(v['hasPapers'])),
      (tr('وقّع المورد', 'Vendor signed'), _tri(v['vendorSideSigned'])),
      (tr('وقّعنا', 'We signed'), _tri(v['ourSideSigned'])),
      (tr('تاريخ العقد', 'Contract date'), v['contractDate']),
      (tr('حالة المتابعة', 'Follow-up status'), v['followUpStatus']),
    ];
    return AppScaffold(
      title: Text('${v['name'] ?? ''}'),
      body: RefreshIndicator(
        onRefresh: _reload,
        child: ListView(padding: const EdgeInsets.all(14), children: [
          AppCard(
            topAccent: T.navy,
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Row(children: [
                Expanded(child: Text('${v['name'] ?? ''}', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16))),
                if (v['isNewVendor'] == true) Chip2(tr('جديد', 'New'), T.warn, icon: Icons.star_rounded),
              ]),
              const SizedBox(height: 6),
              Row(children: [
                if ('${v['followUpStatus'] ?? ''}'.isNotEmpty) Chip2('${v['followUpStatus']}', T.info),
                const Spacer(),
                ContactButtons(phone: v['mobile']?.toString(), compact: true),
              ]),
              const Divider(height: 18),
              for (final r in rows)
                Padding(
                  padding: const EdgeInsets.only(bottom: 6),
                  child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    SizedBox(width: 120, child: Text(r.$1, style: const TextStyle(fontSize: 12, color: T.inkFaint))),
                    Expanded(child: SelectableText(r.$2 == null || '${r.$2}'.isEmpty ? '—' : '${r.$2}', style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600))),
                  ]),
                ),
              if ('${v['notes'] ?? ''}'.isNotEmpty) ...[
                const SizedBox(height: 4),
                Text(tr('ملاحظات', 'Notes'), style: const TextStyle(fontSize: 12, color: T.inkFaint)),
                Text('${v['notes']}', style: const TextStyle(fontSize: 12.5)),
              ],
            ]),
          ),
          const SizedBox(height: 10),
          Align(
            alignment: AlignmentDirectional.centerEnd,
            child: ReportButton(subject: 'vendor', id: '${v['name'] ?? ''}', label: tr('التقرير الشامل للمورد', 'Full vendor report')),
          ),
          const SizedBox(height: 6),
          PortalAccountCard(source: 'crm_vendor', refId: '${v['_id']}', name: '${v['name'] ?? ''}'),
          const SizedBox(height: 20),
        ]),
      ),
    );
  }
}
