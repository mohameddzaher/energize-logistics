import 'package:flutter/material.dart';
import '../resource/configs.dart' show shipmentOrdersFieldsCfg;
import '../resource/resource.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';
import 'fleet_reference_lists.dart';
import 'reference_data.dart' show LookupValuesScreen;
import 'shipment_orders_common.dart';
import 'shipment_orders_fleet.dart';

/// Shipment orders section settings, mirrors /system/shipment-orders/settings: the create form, section lists, waybill numbering and shipment statuses.
class ShipmentOrdersSettingsScreen extends StatefulWidget {
  const ShipmentOrdersSettingsScreen({super.key});
  @override
  State<ShipmentOrdersSettingsScreen> createState() => _ShipmentOrdersSettingsScreenState();
}

class _ShipmentOrdersSettingsScreenState extends State<ShipmentOrdersSettingsScreen> {
  String _tab = 'form';
  int? _next;
  final _start = TextEditingController();
  bool _saving = false;
  List<Map<String, dynamic>> _statuses = [];
  late final void Function() _onLookup = _loadStatuses;

  @override
  void initState() {
    super.initState();
    _loadCounter();
    _loadStatuses();
    Live.instance.on('lookup:changed', _onLookup);
  }

  @override
  void dispose() {
    Live.instance.off('lookup:changed', _onLookup);
    _start.dispose();
    super.dispose();
  }

  Future<void> _loadCounter() async {
    try {
      final d = await Api.instance.get('/api/shipment-orders/counter');
      if (!mounted) return;
      setState(() { _next = (d['next'] as num?)?.toInt(); _start.text = '${d['start'] ?? ''}'; });
    } catch (_) {/* Optional */}
  }

  // Includes the switched-off ones: the settings page shows what was hidden so it can be restored.
  Future<void> _loadStatuses() async {
    try {
      final d = await Api.instance.get('/api/shipment-orders/statuses?all=1');
      if (mounted) setState(() => _statuses = List<Map<String, dynamic>>.from(d['statuses'] ?? const []));
    } catch (_) {}
  }

  int? get _startN => int.tryParse(_start.text.trim());
  bool get _startBad => _next != null && (_startN == null || _startN! < _next!);

  Future<void> _saveStart() async {
    if (_startBad) return;
    setState(() => _saving = true);
    final m = ScaffoldMessenger.of(context);
    try {
      final d = await Api.instance.put('/api/shipment-orders/counter', {'start': _startN});
      if (mounted) setState(() { _next = (d['next'] as num?)?.toInt() ?? _next; _start.text = '${d['start'] ?? _start.text}'; });
      m.showSnackBar(SnackBar(content: Text(tr('حُفظ', 'Saved'))));
    } catch (e) {
      m.showSnackBar(SnackBar(content: Text(e is ApiException ? e.message : tr('لم يُحفظ', 'Not saved'))));
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Widget _link(IconData icon, String title, String sub, VoidCallback onTap) => Padding(
        padding: const EdgeInsets.only(bottom: 8),
        child: Pressable(onTap: onTap, child: AppCard(child: Row(children: [
          Icon(icon, color: T.orange),
          const SizedBox(width: 10),
          Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(title, style: const TextStyle(fontWeight: FontWeight.w800)),
            Text(sub, style: const TextStyle(fontSize: 11.5, color: T.inkFaint)),
          ])),
          const Icon(Icons.chevron_right, color: T.inkFaint),
        ]))),
      );

  @override
  Widget build(BuildContext context) {
    final admin = canAdminOrders(context);
    if (!admin) {
      return AppScaffold(title: Text(tr('إعدادات القسم', 'Section settings')),
          body: EmptyState(icon: Icons.lock_outline, title: tr('غير مصرّح', 'Not authorized')));
    }
    return AppScaffold(
      title: Text(tr('إعدادات القسم', 'Section settings')),
      body: ListView(padding: const EdgeInsets.all(14), children: [
        SingleChildScrollView(scrollDirection: Axis.horizontal, child: Row(children: [
          for (final t in const [
            ('form', Icons.tune, 'نموذج الإنشاء', 'Create form'),
            ('lists', Icons.sell_outlined, 'قوائم القسم', 'Section lists'),
            ('numbering', Icons.tag, 'ترقيم أوامر النقل', 'Transport order numbering'),
            ('statuses', Icons.checklist, 'حالات الشحنة', 'Shipment statuses'),
          ])
            Padding(padding: const EdgeInsetsDirectional.only(end: 6), child: ChoiceChip(
              showCheckmark: false,
              selected: _tab == t.$1,
              selectedColor: T.navy,
              avatar: Icon(t.$2, size: 16, color: _tab == t.$1 ? T.orange : T.inkFaint),
              labelStyle: TextStyle(fontWeight: FontWeight.w700, color: _tab == t.$1 ? Colors.white : T.inkSoft),
              label: Text(tr(t.$3, t.$4)),
              onSelected: (_) => setState(() => _tab = t.$1),
            )),
        ])),
        const SizedBox(height: 12),
        if (_tab == 'form') ...[
          Text(tr('كلُّ سطرٍ هنا خانةٌ في نموذج إنشاء الشحنة: اسمُها، وشكلُها، وخياراتُها، وترتيبُها، وهل هي مطلوبة. ما يُغيَّر يظهر في النموذج فورًا.',
              'Each row is one input on the create-shipment form: its label, how it renders, its options, its order, and whether it is required. Changes appear on the form at once.'),
              style: const TextStyle(fontSize: 12.5, color: T.inkSoft)),
          const SizedBox(height: 10),
          _link(Icons.tune, tr('خانات النموذج', 'Form fields'), tr('إضافةٌ وتعديلٌ وترتيبٌ وخيارات', 'Add, edit, order and options'),
              () => Navigator.push(context, MaterialPageRoute(builder: (_) => ResourceScreen(config: shipmentOrdersFieldsCfg)))),
        ],
        if (_tab == 'lists') ...[
          Text(tr('القوائم المشتركة التي تُغذّي خانات النموذج والجداول.', 'The shared lists that feed the form inputs and the tables.'),
              style: const TextStyle(fontSize: 12.5, color: T.inkSoft)),
          const SizedBox(height: 10),
          const FleetReferenceLists(module: 'shipment_orders', alsoType: 'jp_task_shipment-orders'),
          const SizedBox(height: 10),
          _link(Icons.local_shipping_outlined, tr('الموردون والمركبات', 'Suppliers & vehicles'), tr('من يُنفِّذ الحمولة وبأيّ شاحنة', 'Who executes the load, and with which truck'),
              () => Navigator.push(context, MaterialPageRoute(builder: (_) => const ShipmentOrdersFleetScreen()))),
        ],
        if (_tab == 'numbering')
          AppCard(child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Text(tr('ترقيم أوامر النقل', 'Transport order numbering'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
            const SizedBox(height: 6),
            // The number is never decremented or reused: two waybills with the same number would be in circulation.
            Text(tr('رقمُ أمر النقل يُكتب على ورقٍ يُسلَّم للسائق ويُحاسَب عليه، فلا يُعاد رقمٌ صُرف. يمكن تقديمُ العدّاد إلى رقمٍ أكبر، ولا يمكن إرجاعُه.',
                'The waybill number goes on paper handed to a driver and is accounted for, so a used number is never reissued. The counter may be moved forward, never back.'),
                style: const TextStyle(fontSize: 12.5, color: T.inkSoft)),
            const SizedBox(height: 12),
            Row(children: [
              Expanded(child: InputDecorator(
                decoration: InputDecoration(labelText: tr('الرقم القادم', 'Next number')),
                child: Text('${_next ?? '—'}', style: const TextStyle(fontWeight: FontWeight.w800, fontFamily: 'monospace')),
              )),
              const SizedBox(width: 10),
              Expanded(child: TextField(
                controller: _start,
                keyboardType: TextInputType.number,
                onChanged: (_) => setState(() {}),
                decoration: InputDecoration(labelText: tr('ابدأ من', 'Start from')),
              )),
            ]),
            const SizedBox(height: 10),
            FilledButton(
              onPressed: _saving || _startBad ? null : _saveStart,
              child: _saving ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white)) : Text(tr('حفظ', 'Save')),
            ),
            if (_startBad && _next != null)
              Padding(padding: const EdgeInsets.only(top: 6), child: Text(
                tr('لا يقلّ عن $_next — الأرقام التي صُرفت لا تُعاد.', 'Cannot be below $_next — issued numbers are never reused.'),
                style: const TextStyle(fontSize: 12, color: T.danger))),
          ])),
        if (_tab == 'statuses') ...[
          AppCard(child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Text(tr('دورةُ الشحنة الآن', 'The lifecycle as it stands'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
            const SizedBox(height: 6),
            Text(tr('تُعدَّل تسميتُها ولونُها وترتيبُها — وتُخفى أو يُزاد عليها — من «قائمة الحالات». والمفاتيحُ العشرة الأساسيّة لا تُحذف: التحليلاتُ تعدّ عليها والتنبيهاتُ تُطلق منها والمنصّةُ الخارجيّة تتكلّم بها.',
                'Label, colour and order are edited — and statuses hidden or added — from the status list. The ten core keys are never deleted.'),
                style: const TextStyle(fontSize: 12, color: T.inkSoft)),
            const SizedBox(height: 8),
            for (final (i, st) in _statuses.indexed)
              Opacity(
                opacity: st['active'] == false ? 0.55 : 1,
                child: Padding(padding: const EdgeInsets.symmetric(vertical: 3), child: Row(children: [
                  SizedBox(width: 24, child: Text('${i + 1}', style: const TextStyle(fontSize: 11, color: T.inkFaint))),
                  Chip2(tr('${st['ar'] ?? st['key']}', '${st['en'] ?? st['key']}'), soHex(st['color'] as String?)),
                  if (st['active'] == false) Text('  ${tr('غيرُ مستعملة', 'not in use')}', style: const TextStyle(fontSize: 11, color: T.inkFaint)),
                  if (st['isCore'] == false) Text('  ${tr('مُضافة', 'added')}', style: const TextStyle(fontSize: 11, color: T.orange)),
                  const Spacer(),
                  Text('${st['key']}', style: const TextStyle(fontSize: 11, color: T.inkFaint, fontFamily: 'monospace')),
                ])),
              ),
          ])),
          const SizedBox(height: 10),
          _link(Icons.checklist, tr('قائمة الحالات', 'Status list'), tr('التسمية واللون والترتيب والإخفاء والإضافة', 'Label, colour, order, hide and add'),
              () => Navigator.push(context, MaterialPageRoute(builder: (_) => LookupValuesScreen(type: 'so_status', title: tr('حالات الشحنة', 'Shipment statuses'), canManage: admin)))
                  .then((_) => _loadStatuses())),
          Text(tr('المخزَّن على الشحنة هو المفتاح لا الاسم — فتغييرُ التسمية آمنٌ على السجلّات كلِّها. وإخفاءُ حالةٍ يُخرجها من الشاشات ولا يمسّ شحنةً تحملها.',
              'What a shipment stores is the key, not the label — renaming is safe across every record. Hiding a status takes it off the screens without touching a shipment that carries it.'),
              style: const TextStyle(fontSize: 11.5, color: T.inkFaint)),
        ],
      ]),
    );
  }
}
