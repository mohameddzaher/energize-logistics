import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';
import '../config.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../services/live.dart';
import 'theme.dart';
import 'widgets.dart';

/// نافذةُ المعاملة — كلُّ ما في معاملة التخليص للقراءة، من شاشة الماليّة.
///
/// شاشةُ التخليص لا تُفتح للماليّة، والمحاسبُ يحتاج أن يرى لا أن يعدّل. فهي
/// ورقةٌ فوق شاشته، حيّةٌ على `customs:updated` — نفسُ نافذة الموقع
/// (components/customs/ClearanceQuickView).
Future<void> showClearanceQuickView(BuildContext context, String id) {
  return showModalBottomSheet(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    backgroundColor: T.canvas,
    shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(22))),
    builder: (_) => FractionallySizedBox(heightFactor: 0.92, child: _QuickView(id: id)),
  );
}

const _stageOrder = [
  'papers_received', 'declaration_paid', 'do_requested', 'do_linked', 'port_fees_paid',
  'unloading_fees_paid', 'transport_order', 'containers_transported', 'unloaded_stored',
  'containers_returned', 'invoiced',
];
const _stageAr = {
  'papers_received': 'استلام الأوراق', 'declaration_paid': 'سداد البيان', 'do_requested': 'طلب إذن التسليم',
  'do_linked': 'ربط إذن التسليم', 'port_fees_paid': 'سداد الموانئ', 'unloading_fees_paid': 'سداد التفريغ',
  'transport_order': 'أمر النقل', 'containers_transported': 'نقل الحاويات', 'unloaded_stored': 'التفريغ والتخزين',
  'containers_returned': 'إرجاع الحاويات', 'invoiced': 'الفوترة',
};
const _costs = [
  ('deliveryOrder', 'قيمة إذن التسليم', 'Delivery order'), ('customsDuty', 'الرسوم الجمركية', 'Customs duty'),
  ('portFees', 'أجور الموانى', 'Port fees'), ('unloadingFees', 'أجور التفريغ', 'Unloading fees'),
  ('inspection', 'أجور الكشف', 'Inspection'), ('transport', 'سعر النقل من المورد', 'Transport — supplier'),
  ('transportToYard', 'النقل إلى الساحة', 'Transport to yard'), ('appointmentBooking', 'حجز الموعد', 'Appointment'),
  ('storage', 'تخزين', 'Storage'), ('yardFees', 'أجور الساحة', 'Yard fees'),
  ('exitPermit', 'تصريح الخروج (الأرضيات)', 'Exit permit'), ('demurrage', 'أرضيات', 'Demurrage'),
  ('extension', 'تمديد', 'Extension'), ('consolidator', 'الدامج', 'Consolidator'),
  ('commissions', 'عمولات', 'Commissions'), ('extraFees', 'أجور إضافية', 'Extra fees'),
  ('returnInvoice', 'فاتورة الإرجاع', 'Return invoice'),
];
const _margin = [
  ('clearanceFee', 'أجور التخليص', 'Clearance fee'), ('transportSelling', 'سعر النقل للعميل', 'Transport price'),
  ('transportNet', 'صافي النقل', 'Transport net'), ('transportToYardNet', 'صافي النقل إلى الساحة', 'Yard transport net'),
  ('yardNet', 'صافي الساحة', 'Yard net'), ('storageNet', 'صافي التخزين', 'Storage net'),
  ('securityScan', 'فحص أمني', 'Security scan'), ('labour', 'عمال', 'Labour'),
];

num _n(dynamic v) => v is num ? v : num.tryParse('${v ?? ''}') ?? 0;
String _money(dynamic v) =>
    _n(v).toStringAsFixed(_n(v) % 1 == 0 ? 0 : 2).replaceAllMapped(RegExp(r'\B(?=(\d{3})+(?!\d))'), (m) => ',');
String _date(dynamic v) {
  final s = '${v ?? ''}';
  if (s.isEmpty) return '';
  final d = DateTime.tryParse(s)?.toLocal();
  return d == null ? s : '${d.day}/${d.month}/${d.year}';
}

void _open(String u) {
  if (u.isEmpty) return;
  launchUrl(Uri.parse(u.startsWith('http') ? u : '${AppConfig.apiBase}$u'), mode: LaunchMode.externalApplication);
}

class _QuickView extends StatefulWidget {
  const _QuickView({required this.id});
  final String id;
  @override
  State<_QuickView> createState() => _QuickViewState();
}

class _QuickViewState extends State<_QuickView> {
  Map<String, dynamic>? _c;
  String? _error;
  int _seq = 0;
  late final void Function(dynamic) _onLive;

  @override
  void initState() {
    super.initState();
    _load();
    _onLive = (p) {
      final pid = p is Map ? '${(p['clearance'] is Map ? p['clearance']['_id'] : null) ?? p['id'] ?? ''}' : '';
      if (pid.isEmpty || pid == widget.id) _load();
    };
    Live.instance.onData('customs:updated', _onLive);
  }

  @override
  void dispose() {
    Live.instance.offData('customs:updated', _onLive);
    super.dispose();
  }

  Future<void> _load() async {
    final mine = ++_seq;
    try {
      final d = await Api.instance.get('/api/customs-clearance/${widget.id}');
      if (!mounted || mine != _seq) return;
      setState(() { _c = Map<String, dynamic>.from(d['clearance'] ?? const {}); _error = null; });
    } catch (e) {
      if (mounted && mine == _seq) setState(() => _error = e.toString());
    }
  }

  Widget _section(String title, List<Widget> children, {String? trailing}) => Padding(
        padding: const EdgeInsets.only(top: 12),
        child: AppCard(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(children: [
              Expanded(child: Text(title, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13))),
              if (trailing != null) Text(trailing, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 12.5)),
            ]),
            const SizedBox(height: 8),
            ...children,
          ]),
        ),
      );

  Widget _kv(String k, String v) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 3),
        child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          SizedBox(width: 120, child: Text(k, style: const TextStyle(fontSize: 11.5, color: T.inkSoft))),
          Expanded(child: Text(v.isEmpty ? '—' : v, style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700))),
        ]),
      );

  @override
  Widget build(BuildContext context) {
    final c = _c;
    if (c == null) {
      return _error != null
          ? ErrorRetry(message: _error!, onRetry: _load)
          : const Center(child: CircularProgressIndicator(strokeWidth: 2));
    }
    final costs = Map<String, dynamic>.from(c['costs'] ?? const {});
    final rev = Map<String, dynamic>.from(c['revenue'] ?? const {});
    final done = List<String>.from((c['stagesDone'] ?? const []).map((e) => '$e'));
    final doneCount = _stageOrder.where(done.contains).length;
    final profit = _n(rev['profit']);
    final stages = List<Map<String, dynamic>>.from((c['paymentStages'] ?? const []).map((e) => Map<String, dynamic>.from(e)))
      ..sort((a, b) => '${b['date'] ?? b['addedAt'] ?? ''}'.compareTo('${a['date'] ?? a['addedAt'] ?? ''}'));
    final containers = List<Map<String, dynamic>>.from((c['containers'] ?? const []).map((e) => Map<String, dynamic>.from(e)));
    final atts = List<Map<String, dynamic>>.from((c['attachments'] ?? const []).map((e) => Map<String, dynamic>.from(e)));
    final status = c['cancelled'] == true
        ? tr('ملغاة', 'Cancelled')
        : c['isCompleted'] == true
            ? tr('مُقفلة', 'Closed')
            : c['upcoming'] == true ? tr('قادمة', 'Upcoming') : tr(_stageAr['${c['stage']}'] ?? '${c['stage']}', '${c['stage']}');

    return ListView(padding: const EdgeInsets.fromLTRB(14, 8, 14, 24), children: [
      Center(child: Container(width: 40, height: 4, decoration: BoxDecoration(color: T.inkFaint.withValues(alpha: 0.3), borderRadius: BorderRadius.circular(4)))),
      const SizedBox(height: 10),
      Row(children: [
        Expanded(child: Text('${c['refNumber'] ?? ''}', style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 18))),
        Chip2(status, T.warn),
        IconButton(onPressed: () => Navigator.pop(context), icon: const Icon(Icons.close)),
      ]),
      Text('${c['customerName'] ?? '—'}${'${c['blNumber'] ?? ''}'.isNotEmpty ? ' · ${c['blNumber']}' : ''}',
          style: const TextStyle(fontSize: 12.5, color: T.inkSoft)),
      const SizedBox(height: 12),
      Row(children: [
        for (final x in [
          (tr('المصروفات', 'Costs'), costs['total'], T.ink),
          (tr('الفاتورة', 'Invoiced'), rev['totalInvoiced'], T.ink),
          (tr('الربح', 'Profit'), profit, profit < 0 ? T.danger : T.success),
        ])
          Expanded(
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 3),
              child: AppCard(
                padding: const EdgeInsets.all(10),
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text(x.$1, style: const TextStyle(fontSize: 10.5, color: T.inkSoft, fontWeight: FontWeight.w600)),
                  const SizedBox(height: 3),
                  Text(_money(x.$2), style: TextStyle(fontWeight: FontWeight.w900, fontSize: 14, color: x.$3)),
                ]),
              ),
            ),
          ),
      ]),
      _section(tr('مراحل المعاملة', 'Progress'), [
        ClipRRect(
          borderRadius: BorderRadius.circular(6),
          child: LinearProgressIndicator(value: doneCount / _stageOrder.length, minHeight: 7,
              backgroundColor: T.inkFaint.withValues(alpha: 0.12), color: T.success),
        ),
        const SizedBox(height: 8),
        Wrap(spacing: 5, runSpacing: 5, children: [
          for (final s in _stageOrder)
            Chip2(tr(_stageAr[s] ?? s, s), c['stage'] == s ? T.warn : done.contains(s) ? T.success : T.inkFaint),
        ]),
      ], trailing: '$doneCount/${_stageOrder.length}'),
      _section(tr('بيانات المعاملة', 'Details'), [
        _kv(tr('رقم البوليصة', 'BL'), '${c['blNumber'] ?? ''}'),
        _kv(tr('الوكيل الملاحي', 'Shipping agent'), '${c['shippingAgent'] ?? ''}'),
        _kv(tr('الميناء', 'Port'), '${c['port'] ?? ''}'),
        _kv(tr('الحاويات', 'Containers'), '${c['containerCount'] ?? containers.length}'),
        _kv(tr('الشهر', 'Period'), c['periodYear'] != null ? '${c['periodYear']}-${'${c['periodMonth'] ?? ''}'.padLeft(2, '0')}' : ''),
        _kv(tr('رقم البيان', 'Declaration'), '${c['declarationNumber'] ?? ''}'),
        _kv(tr('إذن التسليم', 'DO number'), '${c['doNumber'] ?? ''}'),
        _kv(tr('موعد التفريغ', 'Unloading'), [_date(c['unloadingAppointment']), '${c['unloadingLocation'] ?? ''}'].where((e) => e.isNotEmpty).join(' · ')),
        _kv(tr('آخر موعد للإرجاع', 'Return deadline'), _date(c['returnDeadline'])),
        _kv(tr('الفوترة', 'Invoicing'), [
          '${(c['billing'] ?? const {})['invoiceStatus'] ?? ''}',
          '${(c['billing'] ?? const {})['ourInvoiceNumber'] ?? ''}',
        ].where((e) => e.isNotEmpty).join(' · ')),
      ]),
      _section(tr('المصروفات', 'Costs'), [
        for (final k in _costs.where((k) => _n(costs[k.$1]) != 0)) _kv(tr(k.$2, k.$3), _money(costs[k.$1])),
        if (_costs.every((k) => _n(costs[k.$1]) == 0)) Text(tr('لا مصروفات مسجّلة', 'No costs'), style: const TextStyle(fontSize: 11.5, color: T.inkFaint)),
      ], trailing: _money(costs['total'])),
      _section(tr('الإيراد والهامش', 'Revenue & margin'), [
        for (final k in _margin.where((k) => _n(rev[k.$1]) != 0)) _kv(tr(k.$2, k.$3), _money(rev[k.$1])),
        if (_margin.every((k) => _n(rev[k.$1]) == 0)) Text(tr('لا إيراد مسجّل', 'No revenue'), style: const TextStyle(fontSize: 11.5, color: T.inkFaint)),
      ], trailing: _money(profit)),
      _section(tr('مراحل السداد وطلبات الصرف', 'Payment stages'), [
        if (stages.isEmpty) Text(tr('لا مراحل سداد بعد', 'None yet'), style: const TextStyle(fontSize: 11.5, color: T.inkFaint)),
        for (final s in stages)
          Container(
            margin: const EdgeInsets.only(bottom: 6),
            padding: const EdgeInsets.all(9),
            decoration: BoxDecoration(color: T.inkFaint.withValues(alpha: 0.05), borderRadius: BorderRadius.circular(10)),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Row(children: [
                Expanded(child: Text('${s['label'] ?? s['key'] ?? ''}', style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w800))),
                Chip2(_payLabel('${s['payStatus'] ?? 'pending'}'), _payColor('${s['payStatus'] ?? 'pending'}')),
              ]),
              const SizedBox(height: 3),
              Text([
                _date(s['date']).isNotEmpty ? _date(s['date']) : _date(s['addedAt']),
                if (s['amount'] != null) _money(s['amount']),
                if ('${s['note'] ?? ''}'.isNotEmpty) '${s['note']}',
                if ('${s['decisionNote'] ?? ''}'.isNotEmpty) '— ${s['decisionNote']}',
              ].join(' · '), style: const TextStyle(fontSize: 11.5, color: T.inkSoft)),
              if ('${s['fileUrl'] ?? ''}'.isNotEmpty || (s['proofFiles'] ?? const []).isNotEmpty)
                Wrap(spacing: 8, children: [
                  if ('${s['fileUrl'] ?? ''}'.isNotEmpty)
                    TextButton.icon(onPressed: () => _open('${s['fileUrl']}'), icon: const Icon(Icons.attach_file, size: 14),
                        label: Text('${s['fileName'] ?? tr('المرفق', 'file')}', style: const TextStyle(fontSize: 11))),
                  for (final f in (s['proofFiles'] ?? const []))
                    TextButton.icon(onPressed: () => _open('${f['fileUrl'] ?? ''}'), icon: const Icon(Icons.verified_outlined, size: 14, color: T.success),
                        label: Text('${f['fileName'] ?? tr('إثبات الدفع', 'proof')}', style: const TextStyle(fontSize: 11, color: T.success))),
                ]),
            ]),
          ),
      ], trailing: '${stages.length}'),
      if (containers.isNotEmpty)
        _section(tr('الحاويات', 'Containers'), [
          Wrap(spacing: 5, runSpacing: 5, children: [
            for (final k in containers) Chip2('${k['containerNumber'] ?? '—'}', T.inkSoft),
          ]),
        ], trailing: '${containers.length}'),
      if (atts.isNotEmpty)
        _section(tr('المرفقات', 'Attachments'), [
          for (final a in atts)
            ListTile(
              dense: true,
              contentPadding: EdgeInsets.zero,
              leading: const Icon(Icons.attach_file, size: 18),
              title: Text('${a['title'] ?? ''}'.isNotEmpty ? '${a['title']}' : '${a['fileName'] ?? tr('مرفق', 'file')}',
                  style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700)),
              trailing: Text(_date(a['uploadedAt']), style: const TextStyle(fontSize: 11, color: T.inkFaint)),
              onTap: () => _open('${a['fileUrl'] ?? ''}'),
            ),
        ], trailing: '${atts.length}'),
    ]);
  }
}

String _payLabel(String s) => switch (s) {
      'paid' => tr('مدفوع', 'Paid'),
      'returned' => tr('مُعاد', 'Returned'),
      'rejected' => tr('مرفوض', 'Rejected'),
      _ => tr('بانتظار الدفع', 'Awaiting'),
    };
Color _payColor(String s) => switch (s) {
      'paid' => T.success,
      'returned' => T.info,
      'rejected' => T.danger,
      _ => T.warn,
    };
