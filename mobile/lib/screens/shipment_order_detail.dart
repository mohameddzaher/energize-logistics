import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../services/api.dart';
import '../services/auth.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/contact.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';
import 'jp.dart' show JpTaskPanel;
import 'shipment_order_create.dart';
import 'shipment_orders_common.dart';

/// Shipment details: mirrors the web details dialog. The load has about 40 fields that do not fit a row, so reading has its own view instead of opening the edit form.
class ShipmentOrderDetailScreen extends StatefulWidget {
  final Map<String, dynamic> order;
  final List<SoStatus> vocab;
  const ShipmentOrderDetailScreen({super.key, required this.order, this.vocab = soBaseStatuses});
  @override
  State<ShipmentOrderDetailScreen> createState() => _ShipmentOrderDetailScreenState();
}

class _ShipmentOrderDetailScreenState extends State<ShipmentOrderDetailScreen> {
  late Map<String, dynamic> _o = widget.order;
  bool _printing = false;
  late final void Function() _onLive = _reload;

  @override
  void initState() {
    super.initState();
    _reload();
    Live.instance.on('shipmentOrders:updated', _onLive);
  }

  @override
  void dispose() {
    Live.instance.off('shipmentOrders:updated', _onLive);
    super.dispose();
  }

  Future<void> _reload() async {
    try {
      final d = await Api.instance.get('/api/shipment-orders/orders/${widget.order['_id']}');
      if (mounted && d['order'] is Map) setState(() => _o = Map<String, dynamic>.from(d['order']));
    } catch (_) {/* Keep what is shown */}
  }

  Widget _group(String title, List<(String, dynamic)> rows) {
    final shown = rows.where((r) => r.$2 == 0 || '${r.$2 ?? ''}'.trim().isNotEmpty).toList();
    if (shown.isEmpty) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: AppCard(child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Text(title, style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w800, color: T.inkSoft)),
        const SizedBox(height: 6),
        for (final r in shown)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 4),
            child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
              SizedBox(width: 120, child: Text(r.$1, style: const TextStyle(fontSize: 12, color: T.inkFaint))),
              Expanded(child: Text('${r.$2}', style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700))),
            ]),
          ),
      ])),
    );
  }

  Future<void> _delete() async {
    final no = soRef(_o);
    final ok = await showDialog<bool>(context: context, builder: (c) => AlertDialog(
      content: Text(tr('حذف الشحنة $no نهائيًّا من صفحة الشحنات وسير عمل التشغيل؟', 'Delete shipment $no from Shipments and the workflow?')),
      actions: [
        TextButton(onPressed: () => Navigator.pop(c, false), child: Text(tr('إلغاء', 'Cancel'))),
        TextButton(onPressed: () => Navigator.pop(c, true), child: Text(tr('حذف', 'Delete'))),
      ],
    ));
    if (ok != true) return;
    try {
      await Api.instance.delete('/api/shipment-orders/orders/${_o['_id']}');
      if (mounted) Navigator.pop(context, true);
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
    }
  }

  @override
  Widget build(BuildContext context) {
    final d = _o;
    final st = soStatusOf(widget.vocab, d['status']);
    final cust = d['customer'] is Map ? d['customer'] as Map : const {};
    final by = d['createdBy'] is Map ? d['createdBy'] as Map : const {};
    final editor = canEditOrders(context);
    final custom = d['customFields'] is Map ? Map<String, dynamic>.from(d['customFields']) : <String, dynamic>{};
    final log = List.from(d['statusLog'] ?? const []);
    return AppScaffold(
      title: Text('${tr('أمر نقل', 'Transport order')} ${soRef(d)}'),
      actions: [
        IconButton(
          tooltip: tr('تحميل أمر النقل PDF', 'Download transport order PDF'),
          icon: _printing ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2)) : const Icon(Icons.picture_as_pdf_outlined),
          onPressed: _printing ? null : () async {
            setState(() => _printing = true);
            await soPrintWaybills(context, [d]);
            if (mounted) setState(() => _printing = false);
          },
        ),
        if (const ['super_admin', 'admin', 'it_manager', 'it_specialist', 'operations_manager'].contains(context.read<AuthProvider>().role))
          IconButton(
            tooltip: tr('حذف الشحنة', 'Delete shipment'),
            icon: const Icon(Icons.delete_outline),
            onPressed: _delete,
          ),
        if (editor)
          IconButton(
            tooltip: tr('تعديل', 'Edit'),
            icon: const Icon(Icons.edit_outlined),
            onPressed: () async {
              final saved = await Navigator.push<bool>(context, MaterialPageRoute(builder: (_) => ShipmentOrderCreateScreen(order: d)));
              if (saved == true) _reload();
            },
          ),
      ],
      body: RefreshIndicator(
        onRefresh: _reload,
        child: ListView(padding: const EdgeInsets.all(14), children: [
          Row(children: [
            Expanded(child: Text('${d['customerName'] ?? '—'}${'${d['fromCity'] ?? ''}'.isNotEmpty ? ' · ${d['fromCity']} → ${d['toCity'] ?? ''}' : ''}',
                style: const TextStyle(fontSize: 13, color: T.inkSoft, fontWeight: FontWeight.w600))),
            InkWell(
              onTap: editor ? () async { if (await soFollowUp(context, d, widget.vocab)) _reload(); } : null,
              child: Chip2(tr(st.$2, st.$3), st.$4, icon: editor ? Icons.sync : null),
            ),
          ]),
          const SizedBox(height: 10),
          _group(tr('الرحلة', 'Trip'), [
            (tr('من مدينة', 'From city'), d['fromCity']),
            (tr('عنوان التحميل', 'Pickup address'), d['addressFrom']),
            (tr('إلى مدينة', 'To city'), d['toCity']),
            (tr('عنوان التسليم', 'Delivery address'), d['addressTo']),
            (tr('موعد التحميل', 'Pickup time'), soFmtDT(d['pickupTime'])),
            (tr('وقت الانطلاق', 'Start time'), soFmtDT(d['startTime'])),
            (tr('وقت الوصول', 'Arrival time'), soFmtDT(d['arrivalTime'])),
            (tr('ملاحظة الرحلة', 'Trip note'), d['notes']),
          ]),
          if ('${d['blNumber'] ?? ''}${d['containerNumber'] ?? ''}'.trim().isNotEmpty || d['customsLink']?['clearance'] != null)
            _group(tr('التخليص الجمركي', 'Customs'), [
              (tr('رقم البوليصة', 'B/L number'), d['blNumber']),
              (tr('رقم الحاوية', 'Container number'), d['containerNumber']),
              (tr('معاملة التخليص', 'Clearance'), d['customsLink']?['clearance'] != null
                  ? d['customsLink']['refNumber']
                  : tr('لا توجد معاملة بهذا الرقم', 'No clearance has this number')),
            ]),
          _group(tr('الحمولة والمركبة', 'Load & vehicle'), [
            (tr('نوع الشاحنة', 'Truck type'), d['truckType']),
            (tr('طول الشاحنة', 'Truck length'), d['truckLength']),
            (tr('نوع الحمولة', 'Cargo type'), d['cargoType']),
            (tr('السائق', 'Driver'), d['driverName']),
            (tr('جوال السائق', 'Driver phone'), d['driverPhone']),
            (tr('المركبة', 'Vehicle'), d['vehicleName']),
            (tr('اللوحة', 'Plate'), d['vehiclePlate']),
            (tr('الوسيط', 'Agent'), d['agentName']),
          ]),
          if ('${d['driverPhone'] ?? ''}'.trim().isNotEmpty)
            Padding(padding: const EdgeInsets.only(bottom: 10), child: Row(children: [
              Text(tr('تواصل مع السائق', 'Contact the driver'), style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700)),
              const Spacer(),
              ContactButtons(phone: '${d['driverPhone']}'),
            ])),
          _group(tr('العميل', 'Customer'), [
            (tr('الاسم', 'Name'), d['customerName']),
            (tr('الجوال', 'Phone'), cust['phone']),
            (tr('الفرع', 'Branch'), d['branch']),
            (tr('المصدر', 'Source'), d['source'] == 'platform' ? tr('منصّة التشغيل', 'Operations platform') : tr('النظام', 'System')),
            (tr('أنشأها', 'Created by'), '${by['firstName'] ?? ''} ${by['lastName'] ?? ''}'.trim()),
            (tr('تاريخ الإنشاء', 'Created at'), soFmtDT(d['createdAt'])),
          ]),
          _group(tr('الأجرة والدفع', 'Fare & payment'), [
            (tr('سعر البيع', 'Selling price'), d['sellPrice'] == null ? null : soMoney(d['sellPrice'])),
            (tr('سعر الشراء', 'Buying price'), d['buyPrice'] == null ? null : soMoney(d['buyPrice'])),
            (tr('نوع الدفع', 'Payment type'), soPaymentKindLabel(d['paymentSubtype'])),
            (tr('نوع تأجير السائق', 'Driver rent type'), d['driverRentType']),
            (tr('أجرة السائق', 'Driver rent'), d['driverRentPrice'] == null ? null : soMoney(d['driverRentPrice'])),
            (tr('طريقة الدفع', 'Payment method'), d['paymentMethod']),
          ]),
          if (custom.isNotEmpty) _group(tr('حقول إضافية', 'Extra fields'), [for (final e in custom.entries) (e.key, e.value)]),
          if (log.isNotEmpty)
            Padding(padding: const EdgeInsets.only(bottom: 10), child: AppCard(child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              Text(tr('سجلّ الحالات', 'Status history'), style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w800, color: T.inkSoft)),
              const SizedBox(height: 6),
              SoStatusLog(log: log, vocab: widget.vocab),
            ]))),
          // JP tasks linked to this shipment; added from here.
          JpTaskPanel(section: 'shipment-orders', kind: 'shipment', refId: '${d['_id']}'),
        ]),
      ),
    );
  }
}
