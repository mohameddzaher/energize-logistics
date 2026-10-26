import 'package:flutter/material.dart';
import '../resource/configs.dart' show shipmentOrdersSuppliersCfg, shipmentOrdersVehiclesCfg, shipmentOrdersDriversCfg;
import '../resource/resource.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/export_sheet.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';

/// الموردون والمركبات — رأسُ /system/shipment-orders/fleet في الويب: أعدادُ السجلّ
/// (`fleet-summary`) ونواقصُه صريحةً، والتصديرُ الكامل في ثلاث أوراق. والسجلّاتُ
/// الثلاثة تُفتَح من هنا بقوائمها (إضافةٌ وتعديلٌ وحذفٌ وتصديرُ المعروض).
class ShipmentOrdersFleetScreen extends StatefulWidget {
  const ShipmentOrdersFleetScreen({super.key});
  @override
  State<ShipmentOrdersFleetScreen> createState() => _ShipmentOrdersFleetScreenState();
}

String _s(dynamic v) => '${v ?? ''}';

class _ShipmentOrdersFleetScreenState extends State<ShipmentOrdersFleetScreen> {
  Map<String, dynamic> _sum = {};
  bool _loading = true;
  bool _exporting = false;
  String? _error;
  late final void Function() _onLive = _load;

  @override
  void initState() {
    super.initState();
    _load();
    Live.instance.on('shipmentOrders:fleet', _onLive);
    Live.instance.on('vreg:updated', _onLive);
  }

  @override
  void dispose() {
    Live.instance.off('shipmentOrders:fleet', _onLive);
    Live.instance.off('vreg:updated', _onLive);
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final d = await Api.instance.get('/api/shipment-orders/fleet-summary');
      if (mounted) setState(() { _sum = Map<String, dynamic>.from(d); _loading = false; _error = null; });
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  // ── أعمدةُ تصدير الويب نفسُها ──
  String _owner(Map<String, dynamic> v) {
    final sup = v['supplier'];
    final name = sup is Map ? _s(sup['name']) : '';
    if (name.isNotEmpty) return name;
    return v['ownership'] == 'ours' ? tr('أسطولنا', 'Our fleet') : tr('غير مسجَّل', 'Not recorded');
  }

  String _orDash(dynamic v) => _s(v).isEmpty ? '—' : _s(v);

  List<ExportCol> get _vehicleCols => [
        ExportCol('اللوحة', 'Plate', (r) => r['plate']),
        ExportCol('الوصف', 'Description', (r) => _orDash(r['name'])),
        ExportCol('النوع', 'Type', (r) => _orDash(r['truckType'])),
        ExportCol('الماركة', 'Brand', (r) => _orDash(r['brand'])),
        ExportCol('اللون', 'Color', (r) => _orDash(r['color'])),
        ExportCol('بطاقة التشغيل', 'Operation card', (r) => _orDash(r['operationCardNumber'])),
        ExportCol('انتهاؤها', 'Card expiry', (r) => _s(r['operationCardExpiry']).length >= 10 ? _s(r['operationCardExpiry']).substring(0, 10) : '—'),
        ExportCol('المالك', 'Owner', _owner),
        ExportCol('السائق المعتاد', 'Usual driver', (r) => _orDash(r['defaultDriverName'])),
        ExportCol('جواله', 'Driver phone', (r) => _orDash(r['defaultDriverPhone'])),
        ExportCol('ملاحظات', 'Notes', (r) => r['notes']),
      ];
  List<ExportCol> get _supplierCols => [
        ExportCol('الاسم', 'Name', (r) => r['name']),
        ExportCol('النوع', 'Type', (r) => r['type'] == 'freelancer' ? tr('فريلانسر', 'Freelancer') : tr('شركة', 'Company')),
        ExportCol('الجوال', 'Phone', (r) => r['phone']),
        ExportCol('البريد', 'Email', (r) => r['email']),
        ExportCol('عدد السيارات', 'Vehicles', (r) => num.tryParse(_s(r['vehicleCount'])) ?? 0),
        ExportCol('عدد السائقين', 'Drivers', (r) => num.tryParse(_s(r['driverCount'])) ?? 0),
        ExportCol('ملاحظات', 'Notes', (r) => r['notes']),
      ];
  List<ExportCol> get _driverCols => [
        ExportCol('الاسم', 'Name', (r) => r['name']),
        ExportCol('الجوال', 'Phone', (r) => r['phone']),
        ExportCol('الجنسية', 'Nationality', (r) => r['nationality']),
        ExportCol('رقم الإقامة', 'Iqama', (r) => r['residenceNumber']),
        ExportCol('بطاقة التشغيل', 'Driver card', (r) => r['driverCardNumber']),
        ExportCol('انتهاء البطاقة', 'Card expiry', (r) => r['driverCardExpiry']),
        ExportCol('المورّد', 'Supplier', (r) => r['supplier'] is Map ? r['supplier']['name'] : ''),
        ExportCol('الشاحنة', 'Truck', (r) => r['vehicle'] is Map ? r['vehicle']['plate'] : ''),
        ExportCol('الكفيل', 'Sponsor', (r) => r['sponsorName']),
        ExportCol('ملاحظات', 'Notes', (r) => r['notes']),
      ];

  /// التصديرُ الكامل يُجلَب عند طلبه — الصفحاتُ تعرض جزءًا من ثلاثةَ عشرَ ألفًا.
  Future<void> _exportAll() async {
    setState(() => _exporting = true);
    try {
      final r = await Future.wait([
        Api.instance.get('/api/shipment-orders/vehicles?limit=5000'),
        Api.instance.get('/api/shipment-orders/suppliers?limit=5000'),
      ]);
      final dr = await Api.instance.get('/api/shipment-orders/drivers?limit=5000');
      if (!mounted) return;
      await exportExcel(context, fileName: 'shipment-orders-fleet', sheets: [
        (tr('المركبات', 'Vehicles'), _vehicleCols, List<Map<String, dynamic>>.from(r[0]['vehicles'] ?? const [])),
        (tr('الموردون', 'Suppliers'), _supplierCols, List<Map<String, dynamic>>.from(r[1]['suppliers'] ?? const [])),
        (tr('السائقون', 'Drivers'), _driverCols, List<Map<String, dynamic>>.from(dr['drivers'] ?? const [])),
      ]);
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e is ApiException ? e.message : '$e')));
    } finally {
      if (mounted) setState(() => _exporting = false);
    }
  }

  void _open(ResourceConfig c) => Navigator.push(context, MaterialPageRoute(builder: (_) => ResourceScreen(config: c)));

  int _n(dynamic v) => (v as num?)?.toInt() ?? int.tryParse(_s(v)) ?? 0;

  @override
  Widget build(BuildContext context) {
    final gaps = Map<String, dynamic>.from(_sum['gaps'] ?? {});
    final vehicles = _n(_sum['vehicles']);
    final ours = _n(_sum['ours']);
    return AppScaffold(
      title: Text(tr('الموردون والمركبات', 'Suppliers & vehicles')),
      actions: [
        IconButton(
          tooltip: tr('تصدير الكل (ثلاث أوراق)', 'Export all (three sheets)'),
          icon: _exporting ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white)) : const Icon(Icons.file_download_outlined),
          onPressed: _exporting ? null : _exportAll,
        ),
      ],
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? ErrorRetry(message: _error!, onRetry: _load)
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView(padding: const EdgeInsets.all(14), children: [
                    Text(tr('${_n(_sum['suppliers'])} مورّدًا · $vehicles شاحنة · ${_n(_sum['drivers'])} سائقًا — المورّدُ أوّلًا، ومنه تُفتَح شاحناتُه وسوّاقُه',
                        '${_n(_sum['suppliers'])} suppliers · $vehicles trucks · ${_n(_sum['drivers'])} drivers — start from the supplier'),
                        style: const TextStyle(fontSize: 12.5, color: T.inkSoft)),
                    const SizedBox(height: 10),
                    for (final x in [
                      (tr('الموردون', 'Suppliers'), _n(_sum['suppliers']), Icons.storefront_outlined, shipmentOrdersSuppliersCfg),
                      (tr('المركبات', 'Vehicles'), vehicles, Icons.local_shipping_outlined, shipmentOrdersVehiclesCfg),
                      (tr('السائقون', 'Drivers'), _n(_sum['drivers']), Icons.badge_outlined, shipmentOrdersDriversCfg),
                    ])
                      Padding(padding: const EdgeInsets.only(bottom: 8), child: Pressable(
                        onTap: () => _open(x.$4),
                        child: AppCard(child: Row(children: [
                          Icon(x.$3, color: T.orange),
                          const SizedBox(width: 10),
                          Expanded(child: Text(x.$1, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14))),
                          Text('${x.$2}', style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 18)),
                          const Icon(Icons.chevron_right, color: T.inkFaint),
                        ])),
                      )),
                    // ── الملكيّة: «أرِني ما لا أعرف مالكَه» ──
                    AppCard(child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                      Text(tr('ملكيّة الشاحنات', 'Truck ownership'), style: const TextStyle(fontWeight: FontWeight.w800)),
                      const SizedBox(height: 6),
                      Wrap(spacing: 6, runSpacing: 6, children: [
                        Chip2('${tr('شاحنات الناقلين', 'Carrier trucks')} ${vehicles - ours}', T.navy),
                        Chip2('${tr('مالكُها مسجَّل', 'Owner recorded')} ${_n(_sum['supplier'])}', T.success),
                        Chip2('${tr('مالكُها غير مسجَّل', 'Owner not recorded')} ${_n(_sum['unknown'])}', T.warn),
                        Chip2('${tr('أسطولنا', 'Ours')} $ours', T.orange),
                      ]),
                    ])),
                    // ── نواقصُ السجلّ تُقال ولا تُترَك تُقرأ خرابًا ──
                    if (_n(gaps['unknown']) > 0 || _n(gaps['noBrand']) > 0 || _n(gaps['supNoVehicle']) > 0)
                      Container(
                        margin: const EdgeInsets.only(top: 10),
                        padding: const EdgeInsets.all(12),
                        decoration: BoxDecoration(color: T.warn.withValues(alpha: 0.08), borderRadius: BorderRadius.circular(12), border: Border.all(color: T.warn.withValues(alpha: 0.3))),
                        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          Text(tr('ينقص السجلَّ:', 'The register is missing:'), style: const TextStyle(fontWeight: FontWeight.w800, color: Color(0xFF92400E))),
                          if (_n(gaps['unknown']) > 0) Text(tr('${gaps['unknown']} شاحنة بلا مورّد', '${gaps['unknown']} trucks with no supplier'), style: const TextStyle(fontSize: 12.5, color: Color(0xFF92400E))),
                          if (_n(gaps['noBrand']) > 0) Text(tr('${gaps['noBrand']} بلا ماركة أو لون — تُطبَع فارغةً في البوليصة', '${gaps['noBrand']} with no brand or colour — they print blank on the waybill'), style: const TextStyle(fontSize: 12.5, color: Color(0xFF92400E))),
                          if (_n(gaps['supNoVehicle']) > 0) Text(tr('${gaps['supNoVehicle']} مورّدًا بلا شاحنة', '${gaps['supNoVehicle']} suppliers with no truck'), style: const TextStyle(fontSize: 12.5, color: Color(0xFF92400E))),
                        ]),
                      ),
                  ]),
                ),
    );
  }
}
