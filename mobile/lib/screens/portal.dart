import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/export_sheet.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';
import '../ui/search_field.dart';
import 'customs_detail.dart' show customsStageLabel;
import 'package:printing/printing.dart';

/// بوابة العميل / المورد — the mobile half of the customer portal.
///
/// Same contract as the web (`/api/portal/*`): the partner logs in with the
/// email and password we created for them and sees only what they actually have
/// with us — transport trips, heavy-transport loads, shipment orders, customs
/// files. A customer sees no money at all (2026-10-24: «يشوف رحلاته من غير
/// أسعار»); a supplier still sees what is owed to them per load.
/// Which tabs appear is decided by the backend's service detection, so a customs
/// customer never gets an empty shipments tab.

const _statusLabels = <String, (String, String, Color)>{
  'requesting': ('قيد الطلب', 'Requested', Color(0xFF94A3B8)),
  'loading': ('جارٍ التحميل', 'Loading', Color(0xFF0EA5E9)),
  'uploaded': ('تم التحميل', 'Loaded', Color(0xFF6366F1)),
  'on_way': ('في الطريق', 'On the way', Color(0xFFF59E0B)),
  'arrived': ('وصلت', 'Arrived', Color(0xFF16A34A)),
  'bond_sent': ('أُرسلت البوليصة', 'Waybill sent', Color(0xFF22C55E)),
  'bond_received': ('استُلمت البوليصة', 'Waybill received', Color(0xFF22C55E)),
  'late': ('متأخرة', 'Late', Color(0xFFEF4444)),
  'invoiced': ('تمت الفوترة', 'Invoiced', Color(0xFF0F766E)),
  'cancelled': ('ملغاة', 'Cancelled', Color(0xFF64748B)),
};

/// A customs file as the server computed it: its `pipeline` minus the steps
/// locked for this file (a route not taken, container return on a vehicles
/// file). Without a pipeline only the current stage text is known.
({List<Map<String, dynamic>> steps, String cargo, String label, double pct, String count}) _customsProgress(Map<String, dynamic> c) {
  final p = c['pipeline'] is Map ? Map<String, dynamic>.from(c['pipeline']) : const <String, dynamic>{};
  final cargo = '${c['cargoType'] ?? p['cargoType'] ?? 'containers'}';
  final steps = [
    for (final s in (p['steps'] is List ? p['steps'] as List : const []))
      if (s is Map && s['locked'] != true) Map<String, dynamic>.from(s),
  ];
  final stage = '${c['stage'] ?? ''}';
  return (
    steps: steps, cargo: cargo,
    label: stage.isEmpty ? '—' : customsStageLabel(stage, cargo),
    pct: (_n(p['percent']) / 100).clamp(0, 1).toDouble(),
    count: p.isEmpty ? '' : '${_n(p['done']).round()}/${_n(p['total']).round()}',
  );
}

num _n(dynamic v) => v is num ? v : 0;
String _money(dynamic v) => _n(v).round().toString().replaceAllMapped(RegExp(r'\B(?=(\d{3})+(?!\d))'), (m) => ',');
String _date(dynamic v) {
  final d = v == null ? null : DateTime.tryParse(v.toString())?.toLocal();
  return d == null ? '—' : '${d.day}/${d.month}/${d.year}';
}
String _dateTime(dynamic v) {
  final d = v == null ? null : DateTime.tryParse(v.toString())?.toLocal();
  if (d == null) return '—';
  final hh = d.hour.toString().padLeft(2, '0');
  final mm = d.minute.toString().padLeft(2, '0');
  return '${d.day}/${d.month}/${d.year} $hh:$mm';
}

Widget _statusChip(dynamic status) {
  final k = (status ?? '').toString();
  final s = _statusLabels[k] ?? (k.isEmpty ? '—' : k, k.isEmpty ? '—' : k, T.inkFaint);
  return Chip2(tr(s.$1, s.$2), s.$3);
}


/// The portal shell: one screen with a tab per service the partner actually has.
class PortalScreen extends StatefulWidget {
  const PortalScreen({super.key});
  @override
  State<PortalScreen> createState() => _PortalScreenState();
}

class _PortalScreenState extends State<PortalScreen> {
  Map<String, dynamic>? _me;
  Map<String, dynamic>? _overview;
  bool _loading = true;
  String? _error;
  // حيّةٌ كالويب: أيُّ حركةٍ على رحلةٍ تُعيد قراءةَ النظرة العامّة.
  late final void Function() _onLive = _load;

  @override
  void initState() {
    super.initState();
    _load();
    Live.instance.on('fleet:updated', _onLive);
  }

  @override
  void dispose() {
    Live.instance.off('fleet:updated', _onLive);
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final me = await Api.instance.get('/api/portal/me');
      final ov = await Api.instance.get('/api/portal/overview');
      if (!mounted) return;
      setState(() {
        _me = Map<String, dynamic>.from(me);
        _overview = Map<String, dynamic>.from(ov);
        _loading = false; _error = null;
      });
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  List<String> get _services =>
      List<Map<String, dynamic>>.from(_me?['services'] ?? []).map((s) => s['key'].toString()).toList();

  bool get _isVendor => _me?['kind'] == 'vendor';

  @override
  Widget build(BuildContext context) {
    if (_loading) {
      return AppScaffold(
        title: Text(tr('بوابتي', 'My Portal')),
        body: ListView(padding: const EdgeInsets.all(14), children: const [
          Shimmer(height: 70), SizedBox(height: 12), Shimmer(), SizedBox(height: 10), Shimmer(),
        ]),
      );
    }
    if (_error != null) {
      return AppScaffold(
        title: Text(tr('بوابتي', 'My Portal')),
        body: ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); }),
      );
    }

    // Tabs are the services the partner has — never a fixed list.
    final tabs = <(String, Widget)>[
      (tr('نظرة عامة', 'Overview'), _OverviewTab(overview: _overview!, isVendor: _isVendor, onRefresh: _load)),
      if (_isVendor)
        (tr('حمولاتي', 'My loads'), const _ShipmentsTab(type: 'vendor'))
      else ...[
        // «منصة الأوبريشن» اسمٌ داخلي — العميل يراها «رحلات النقل».
        if (_services.contains('operations')) (tr('رحلات النقل', 'Transport trips'), const _ShipmentsTab(type: 'platform')),
        if (_services.contains('heavy_transport')) (tr('النقل الثقيل', 'Heavy transport'), const _ShipmentsTab(type: 'heavy')),
        if (_services.contains('shipment_orders')) (tr('طلبات الشحن', 'Shipment orders'), const _ShipmentsTab(type: 'orders')),
        if (_services.contains('customs')) (tr('التخليص', 'Customs'), const _CustomsTab()),
        if (_services.contains('finance')) (tr('الفواتير', 'Invoices'), const _FinanceTab()),
      ],
    ];

    return DefaultTabController(
      length: tabs.length,
      child: AppScaffold(
        title: Text((_me?['name'] ?? tr('بوابتي', 'My Portal')).toString()),
        appBarBottom: TabBar(
          isScrollable: true,
          tabAlignment: TabAlignment.start,
          tabs: tabs.map((t) => Tab(text: t.$1)).toList(),
        ),
        body: TabBarView(children: tabs.map((t) => t.$2).toList()),
      ),
    );
  }
}

// ── نظرة عامة ────────────────────────────────────────────────────────────────
class _OverviewTab extends StatelessWidget {
  final Map<String, dynamic> overview;
  final bool isVendor;
  final Future<void> Function() onRefresh;
  const _OverviewTab({required this.overview, required this.isVendor, required this.onRefresh});

  @override
  Widget build(BuildContext context) {
    final t = Map<String, dynamic>.from(overview['totals'] ?? {});
    final inTransit = List<Map<String, dynamic>>.from(overview['inTransit'] ?? []);
    final monthly = List<Map<String, dynamic>>.from(overview['monthly'] ?? []);
    final recent = Map<String, dynamic>.from(overview['recent'] ?? {});
    final platformTrips = List<Map<String, dynamic>>.from(recent['platformTrips'] ?? []);
    final maxMonth = monthly.fold<num>(1, (m, x) => _n(x['count']) > m ? _n(x['count']) : m);

    return RefreshIndicator(
      onRefresh: onRefresh,
      child: ListView(padding: const EdgeInsets.fromLTRB(14, 14, 14, 24), children: [
        if (isVendor) ...[
          Row(children: [
            Expanded(child: StatCard(label: tr('حمولات نفّذتها', 'Loads carried'), value: _n(t['loads']), color: T.navy, icon: Icons.local_shipping_outlined)),
            const SizedBox(width: 8),
            Expanded(child: StatCard(label: tr('تم التسليم', 'Delivered'), value: _n(t['delivered']), color: T.success, icon: Icons.check_circle_outline)),
            const SizedBox(width: 8),
            Expanded(child: StatCard(label: tr('في الطريق', 'In transit'), value: _n(t['inTransit']), color: T.warn, icon: Icons.route_outlined)),
          ]),
          const SizedBox(height: 10),
          AppCard(
            child: Row(children: [
              Expanded(child: Text(tr('إجمالي المستحق', 'Total earnings'), style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700))),
              Text(_money(t['earnings']), style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800, color: T.success)),
            ]),
          ),
        ] else ...[
          Row(children: [
            Expanded(child: StatCard(label: tr('الشحنات', 'Shipments'), value: _n(t['shipments']), color: T.navy, icon: Icons.local_shipping_outlined)),
            const SizedBox(width: 8),
            Expanded(child: StatCard(label: tr('في الطريق', 'In transit'), value: _n(t['inTransit']), color: T.warn, icon: Icons.route_outlined)),
            const SizedBox(width: 8),
            Expanded(child: StatCard(label: tr('تم التسليم', 'Delivered'), value: _n(t['delivered']), color: T.success, icon: Icons.check_circle_outline)),
          ]),
          const SizedBox(height: 8),
          Row(children: [
            // بلا أيّ مبلغ للعميل — أعدادٌ فقط.
            Expanded(child: StatCard(label: tr('رحلات النقل', 'Transport trips'), value: _n(t['platformTrips']), color: T.violet, icon: Icons.assignment_outlined)),
            const SizedBox(width: 8),
            Expanded(child: StatCard(label: tr('معاملات تخليص', 'Customs files'), value: _n(t['customsFiles']), color: T.cyan, icon: Icons.directions_boat_outlined)),
            const SizedBox(width: 8),
            Expanded(child: StatCard(label: tr('حاويات', 'Containers'), value: _n(t['containers']), color: T.orange, icon: Icons.inventory_2_outlined)),
          ]),
        ],

        if (inTransit.isNotEmpty) ...[
          const SizedBox(height: 16),
          Text(tr('على الطريق الآن', 'On the road now'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14)),
          const SizedBox(height: 8),
          ...inTransit.take(8).map((s) => Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: AppCard(
                  padding: const EdgeInsets.all(12),
                  child: Row(children: [
                    Expanded(
                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Text('#${s['waybillNumber']}', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13)),
                        Text('${s['fromCity'] ?? '—'} ← ${s['toCity'] ?? '—'}', style: const TextStyle(fontSize: 12, color: T.inkSoft)),
                      ]),
                    ),
                    _statusChip(s['status']),
                  ]),
                ),
              )),
        ],

        if (!isVendor && platformTrips.isNotEmpty) ...[
          const SizedBox(height: 16),
          Text(tr('أحدث رحلات النقل', 'Latest transport trips'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14)),
          const SizedBox(height: 8),
          ...platformTrips.take(8).map((s) => Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: AppCard(
                  padding: const EdgeInsets.all(12),
                  child: Row(children: [
                    Expanded(
                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Text('#${s['waybillNumber'] ?? '—'}', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13)),
                        Text('${s['fromCity'] ?? '—'} ← ${s['toCity'] ?? '—'}', style: const TextStyle(fontSize: 12, color: T.inkSoft)),
                        Text(_date(s['loadDate'] ?? s['createdAt']), style: const TextStyle(fontSize: 10.5, color: T.inkFaint)),
                      ]),
                    ),
                    _statusChip(s['status']),
                  ]),
                ),
              )),
        ],

        if (monthly.isNotEmpty) ...[
          const SizedBox(height: 16),
          Text(tr('آخر ١٢ شهرًا', 'Last 12 months'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14)),
          const SizedBox(height: 10),
          AppCard(
            child: SizedBox(
              height: 90,
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: monthly.map((m) {
                  final h = (_n(m['count']) / maxMonth * 74).clamp(2.0, 74.0);
                  return Expanded(
                    child: Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 2),
                      child: Column(mainAxisAlignment: MainAxisAlignment.end, children: [
                        Container(height: h.toDouble(), decoration: BoxDecoration(color: T.orange, borderRadius: BorderRadius.circular(3))),
                        const SizedBox(height: 3),
                        Text(m['month'].toString().substring(5), style: const TextStyle(fontSize: 8, color: T.inkFaint)),
                      ]),
                    ),
                  );
                }).toList(),
              ),
            ),
          ),
        ],
      ]),
    );
  }
}

// ── الشحنات ──────────────────────────────────────────────────────────────────
class _ShipmentsTab extends StatefulWidget {
  final String type; // platform | heavy | orders | vendor
  const _ShipmentsTab({required this.type});
  @override
  State<_ShipmentsTab> createState() => _ShipmentsTabState();
}

class _ShipmentsTabState extends State<_ShipmentsTab> {
  List<Map<String, dynamic>> _rows = [];
  bool _loading = true;
  String? _error;
  String _q = '';
  // متحكِّمُ البحث عند الشاشة: خطأُ تحديثٍ حيٍّ ثمّ إعادةُ المحاولة لا يُفرغ الخانةَ والكلمةُ تُرشِّح.
  final _searchCtl = TextEditingController();
  String _status = '';
  late final void Function() _onLive = _load;

  @override
  void initState() {
    super.initState();
    _load();
    Live.instance.on('fleet:updated', _onLive);
  }

  @override
  void dispose() {
    Live.instance.off('fleet:updated', _onLive);
    _searchCtl.dispose();
    super.dispose();
  }

  // أعمدةُ تصدير الويب — والمبلغُ للمورّد وحدَه: العميلُ لا يرى سعرًا.
  List<ExportCol> get _exportCols => [
        ExportCol(_isPlatform ? 'رقم الكشف' : 'رقم البوليصة', _isPlatform ? 'Report #' : 'Waybill #', (r) => r['waybillNumber']),
        ExportCol('التاريخ', 'Date', (r) => _date(r['loadDate'] ?? r['createdAt'])),
        ExportCol('من', 'From', (r) => r['fromCity']),
        ExportCol('إلى', 'To', (r) => r['toCity']),
        ExportCol('المركبة', 'Truck', (r) => r['vehiclePlate'] ?? r['vehicleName'] ?? '—'),
        ExportCol('السائق', 'Driver', (r) => r['driverName']),
        if (_isPlatform) ExportCol('نوع المركبة', 'Truck type', (r) {
          final v = [r['truckType'], r['truckSize']].where((x) => '${x ?? ''}'.isNotEmpty).join(' · ');
          return v.isEmpty ? '—' : v;
        }),
        ExportCol('الحالة', 'Status', (r) {
          final l = _statusLabels['${r['status'] ?? ''}'];
          return l == null ? '${r['status'] ?? ''}' : tr(l.$1, l.$2);
        }),
        if (widget.type == 'vendor') ExportCol('المبلغ', 'Amount', (r) => _money(r['buyPrice'])),
      ];

  void _export(List<Map<String, dynamic>> shown, String scope) {
    final rows = scope == 'shown' ? shown : _rows;
    if (rows.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(tr('لا صفوف للتصدير', 'Nothing to export'))));
      return;
    }
    exportExcel(context, fileName: 'my-shipments-${widget.type}', sheets: [(tr('شحناتي', 'My shipments'), _exportCols, rows)]);
  }

  Future<void> _load() async {
    try {
      final d = await Api.instance.get('/api/portal/shipments?type=${widget.type}');
      if (!mounted) return;
      setState(() { _rows = List<Map<String, dynamic>>.from(d['items'] ?? []); _loading = false; _error = null; });
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  Future<void> _open(Map<String, dynamic> row) async {
    Map<String, dynamic>? d;
    try {
      d = Map<String, dynamic>.from(await Api.instance.get('/api/portal/shipments/${widget.type}/${row['_id']}'));
    } catch (_) {}
    if (!mounted) return;
    final s = Map<String, dynamic>.from((d?['shipment'] ?? row) as Map);
    final timeline = List<Map<String, dynamic>>.from((d?['timeline'] ?? []) as List);
    final waybillUrl = d?['waybillUrl']?.toString();
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (c) => SafeArea(
        child: SizedBox(
          height: MediaQuery.of(c).size.height * 0.85,
          child: ListView(padding: const EdgeInsets.all(18), children: [
            Row(children: [
              Expanded(child: Text('#${s['waybillNumber']}', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 18))),
              _statusChip(s['status']),
            ]),
            const SizedBox(height: 4),
            Text('${s['fromCity'] ?? '—'} ← ${s['toCity'] ?? '—'}', style: const TextStyle(fontSize: 13, color: T.inkSoft)),
            if (waybillUrl != null) ...[
              const SizedBox(height: 12),
              // The بوليصة is rendered SERVER-side (Puppeteer + pdf-lib) so the
              // customer's copy is byte-identical to ours — we only print bytes.
              FilledButton.icon(
                onPressed: () async {
                  try {
                    final bytes = await Api.instance.getBytes(waybillUrl);
                    await Printing.layoutPdf(onLayout: (_) async => bytes, name: 'waybill-${s['waybillNumber']}');
                  } catch (e) {
                    if (c.mounted) {
                      ScaffoldMessenger.of(c).showSnackBar(SnackBar(
                        content: Text(e is ApiException ? e.message : tr('تعذّر توليد البوليصة', 'Could not generate the waybill')),
                      ));
                    }
                  }
                },
                icon: const Icon(Icons.picture_as_pdf_outlined, size: 18),
                label: Text(tr('البوليصة (PDF)', 'Waybill (PDF)')),
              ),
            ],
            const SizedBox(height: 16),
            ..._rowsFor(s).map((e) => Padding(
                  padding: const EdgeInsets.only(bottom: 8),
                  child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    SizedBox(width: 140, child: Text(e.$1, style: const TextStyle(fontSize: 11.5, color: T.inkFaint))),
                    Expanded(child: Text(e.$2, style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600))),
                  ]),
                )),
            if (timeline.isNotEmpty) ...[
              const SizedBox(height: 16),
              Text(tr('سجل التتبّع', 'Tracking history'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14)),
              const SizedBox(height: 8),
              ...timeline.map((e) => Padding(
                    padding: const EdgeInsets.only(bottom: 10),
                    child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      const Padding(padding: EdgeInsets.only(top: 3), child: Icon(Icons.circle, size: 8, color: T.orange)),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          Text(
                            e['status'] != null
                                ? tr(_statusLabels[e['status']]?.$1 ?? '', _statusLabels[e['status']]?.$2 ?? '')
                                : (e['type'] == 'followup' ? tr('متابعة', 'Follow-up') : tr('تم الإنشاء', 'Created')),
                            style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 12.5),
                          ),
                          if ((e['location'] ?? '').toString().isNotEmpty)
                            Text(e['location'].toString(), style: const TextStyle(fontSize: 11.5, color: T.inkSoft)),
                          if ((e['note'] ?? '').toString().isNotEmpty)
                            Text(e['note'].toString(), style: const TextStyle(fontSize: 11, color: T.inkFaint)),
                          Text(_dateTime(e['at']), style: const TextStyle(fontSize: 10.5, color: T.inkFaint)),
                        ]),
                      ),
                    ]),
                  )),
            ],
          ]),
        ),
      ),
    );
  }

  bool get _isPlatform => widget.type == 'platform';

  // المبلغ للمورد وحده (مستحقُّه عن الحمولة) — العميل لا يرى أيّ مبلغ.
  List<(String, String)> _rowsFor(Map<String, dynamic> s) => [
        if (_isPlatform) (tr('رقم الكشف', 'Report number'), '#${s['waybillNumber'] ?? '—'}'),
        (_isPlatform ? tr('تاريخ الكشف', 'Report date') : tr('تاريخ التحميل', 'Load date'), _date(s['loadDate'] ?? s['pickupTime'] ?? s['createdAt'])),
        (tr('نوع الحمولة', 'Cargo type'), (s['loadType'] ?? s['cargoType'] ?? '—').toString()),
        (tr('نوع المركبة', 'Truck type'), (s['trailerType'] ?? s['truckType'] ?? '—').toString()),
        if (_isPlatform) ...[
          (tr('حجم المركبة', 'Truck size'), (s['truckSize'] ?? '—').toString()),
          (tr('رقم المستند', 'Document number'), (s['documentNumber'] ?? '—').toString()),
          (tr('تاريخ التسليم', 'Delivered at'), _date(s['deliveredAt'])),
        ],
        (tr('المركبة', 'Truck'), (s['vehiclePlate'] ?? s['vehicleName'] ?? '—').toString()),
        (tr('السائق', 'Driver'), (s['driverName'] ?? '—').toString()),
        (tr('جوال السائق', 'Driver phone'), (s['driverPhone'] ?? '—').toString()),
        (tr('عنوان الاستلام', 'Pickup address'), (s['addressFrom'] ?? '—').toString()),
        (tr('عنوان التسليم', 'Delivery address'), (s['addressTo'] ?? '—').toString()),
        (tr('الفرع', 'Branch'), (s['branch'] ?? '—').toString()),
        if (widget.type == 'vendor') (tr('المبلغ', 'Amount'), _money(s['buyPrice'])),
        (tr('الوصول المتوقع', 'Expected arrival'), _dateTime(s['expectedArrival'] ?? s['arrivalTime'])),
        if ((s['notes'] ?? '').toString().isNotEmpty) (tr('ملاحظات', 'Notes'), s['notes'].toString()),
      ];

  @override
  Widget build(BuildContext context) {
    if (_loading) {
      return ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(height: 48), SizedBox(height: 10), Shimmer(), SizedBox(height: 10), Shimmer()]);
    }
    if (_error != null) {
      return ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); });
    }
    final q = _q.trim().toLowerCase();
    final rows = _rows.where((r) {
      if (_status.isNotEmpty && r['status'] != _status) return false;
      if (q.isEmpty) return true;
      return '${r['waybillNumber']} ${r['fromCity']} ${r['toCity']} ${r['driverName']} ${r['vehiclePlate'] ?? r['vehicleName']}'.toLowerCase().contains(q);
    }).toList();

    final statuses = <String, int>{};
    for (final r in _rows) {
      final k = (r['status'] ?? '').toString();
      statuses[k] = (statuses[k] ?? 0) + 1;
    }

    return Column(children: [
      Padding(
        padding: const EdgeInsets.fromLTRB(14, 12, 14, 4),
        // زرُّ التصدير بجوار الخانة — مكانُه داخلها صار لزرّ ✕.
        child: Row(children: [
          Expanded(child: SearchField(
            controller: _searchCtl,
            hint: tr('ابحث برقم البوليصة أو المدينة…', 'Search waybill or city…'),
            suffixText: '${rows.length}',
            onChanged: (v) => setState(() => _q = v),
          )),
          _exportMenu((scope) => _export(rows, scope)),
        ]),
      ),
      SizedBox(
        height: 42,
        child: ListView(
          scrollDirection: Axis.horizontal,
          padding: const EdgeInsets.symmetric(horizontal: 14),
          children: [
            Padding(
              padding: const EdgeInsetsDirectional.only(end: 6),
              child: ChoiceChip(
                label: Text('${tr('الكل', 'All')} (${_rows.length})'),
                selected: _status.isEmpty,
                onSelected: (_) => setState(() => _status = ''),
              ),
            ),
            ...statuses.entries.map((e) {
              final lbl = _statusLabels[e.key] ?? (e.key.isEmpty ? '—' : e.key, e.key.isEmpty ? '—' : e.key, T.inkFaint);
              return Padding(
                padding: const EdgeInsetsDirectional.only(end: 6),
                child: ChoiceChip(
                  label: Text('${tr(lbl.$1, lbl.$2)} (${e.value})'),
                  selected: _status == e.key,
                  onSelected: (_) => setState(() => _status = _status == e.key ? '' : e.key),
                ),
              );
            }),
          ],
        ),
      ),
      Expanded(
        child: RefreshIndicator(
          onRefresh: _load,
          child: rows.isEmpty
              ? ListView(children: [
                  Padding(
                    padding: const EdgeInsets.only(top: 60),
                    child: EmptyState(icon: Icons.local_shipping_outlined, title: q.isNotEmpty ? tr('لا نتائج مطابقة للبحث', 'No matches') : tr('لا توجد شحنات', 'No shipments')),
                  ),
                ])
              : ListView.builder(
                  keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
                  padding: const EdgeInsets.fromLTRB(14, 8, 14, 20),
                  itemCount: rows.length,
                  itemBuilder: (c, i) {
                    final r = rows[i];
                    return Padding(
                      padding: const EdgeInsets.only(bottom: 10),
                      child: Pressable(
                        onTap: () => _open(r),
                        child: AppCard(
                          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                            Row(children: [
                              Expanded(child: Text('#${r['waybillNumber']}', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14))),
                              _statusChip(r['status']),
                            ]),
                            const SizedBox(height: 6),
                            Text('${r['fromCity'] ?? '—'} ← ${r['toCity'] ?? '—'}', style: const TextStyle(fontSize: 12.5, color: T.inkSoft)),
                            const SizedBox(height: 6),
                            Wrap(spacing: 6, runSpacing: 6, children: [
                              Chip2(_date(r['loadDate'] ?? r['createdAt']), T.info, icon: Icons.event_outlined),
                              if ((r['vehiclePlate'] ?? r['vehicleName']) != null)
                                Chip2((r['vehiclePlate'] ?? r['vehicleName']).toString(), T.violet, icon: Icons.local_shipping_outlined),
                              if ((r['driverName'] ?? '').toString().isNotEmpty)
                                Chip2(r['driverName'].toString(), T.cyan, icon: Icons.person_outline),
                              if (_isPlatform && (r['truckType'] ?? '').toString().isNotEmpty)
                                Chip2(r['truckType'].toString(), T.navy, icon: Icons.category_outlined),
                              if (widget.type == 'vendor') Chip2(_money(r['buyPrice']), T.success),
                            ]),
                          ]),
                        ),
                      ),
                    );
                  },
                ),
        ),
      ),
    ]);
  }
}

// ── التخليص الجمركي ──────────────────────────────────────────────────────────
class _CustomsTab extends StatefulWidget {
  const _CustomsTab();
  @override
  State<_CustomsTab> createState() => _CustomsTabState();
}

class _CustomsTabState extends State<_CustomsTab> {
  List<Map<String, dynamic>> _rows = [];
  bool _loading = true;
  String? _error;

  @override
  void initState() { super.initState(); _load(); }

  Future<void> _load() async {
    try {
      final d = await Api.instance.get('/api/portal/customs');
      if (!mounted) return;
      setState(() { _rows = List<Map<String, dynamic>>.from(d['items'] ?? []); _loading = false; _error = null; });
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  void _open(Map<String, dynamic> c) {
    final pr = _customsProgress(c);
    final vehicles = pr.cargo == 'vehicles';
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (ctx) => SafeArea(
        child: SizedBox(
          height: MediaQuery.of(ctx).size.height * 0.85,
          child: ListView(padding: const EdgeInsets.all(18), children: [
            Text((c['refNumber'] ?? c['blNumber'] ?? '—').toString(),
                style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 17)),
            const SizedBox(height: 6),
            Text('${tr('المرحلة', 'Stage')}${pr.count.isEmpty ? '' : ' ${pr.count}'} — ${pr.label}',
                style: const TextStyle(fontSize: 12.5, color: T.orange, fontWeight: FontWeight.w700)),
            const SizedBox(height: 14),
            ...[
              (tr('رقم البوليصة', 'BL number'), c['blNumber']),
              (tr('رقم البيان', 'Declaration'), c['declarationNumber']),
              (tr('تاريخ البيان', 'Declaration date'), c['declarationDate']),
              (tr('إذن التسليم', 'Delivery order'), c['doNumber']),
              (tr('تصريح الخروج', 'Exit permit'), c['exitPermitNumber']),
              (tr('الميناء', 'Port'), c['port']),
              (vehicles ? tr('عدد السيّارات', 'Vehicles') : tr('عدد الحاويات', 'Containers'), c['containerCount']),
              (tr('الوزن الإجمالي', 'Total weight'), c['totalWeight']),
              (tr('قيمة الفاتورة', 'Invoice value'), c['invoiceValue']),
              (tr('الشركة المصدّرة', 'Exporter'), c['exporterCompany']),
              (tr('بلد المنشأ', 'Country of origin'), c['countryOfOrigin']),
              (tr('الوكيل الملاحي', 'Shipping agent'), c['shippingAgent']),
              (tr('موعد التفريغ', 'Unloading appointment'), c['unloadingAppointment']),
              (tr('مكان التفريغ', 'Unloading location'), c['unloadingLocation']),
            ].map((e) => Padding(
                  padding: const EdgeInsets.only(bottom: 8),
                  child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    SizedBox(width: 140, child: Text(e.$1, style: const TextStyle(fontSize: 11.5, color: T.inkFaint))),
                    Expanded(child: Text(
                      (e.$2 == null || e.$2.toString().isEmpty) ? '—' : e.$2.toString(),
                      style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600),
                    )),
                  ]),
                )),
            const SizedBox(height: 14),
            Text(tr('مسار التخليص', 'Clearance pipeline'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14)),
            const SizedBox(height: 8),
            if (pr.steps.isEmpty) Text(pr.label, style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600)),
            ...pr.steps.map((e) {
              final passed = e['done'] == true;
              return Padding(
                padding: const EdgeInsets.only(bottom: 6),
                child: Row(children: [
                  Icon(passed ? Icons.check_circle : Icons.radio_button_unchecked,
                      size: 16, color: passed ? T.success : T.inkFaint),
                  const SizedBox(width: 8),
                  Expanded(child: Text('${customsStageLabel('${e['key']}', pr.cargo)}${e['unitsOf'] != null ? ' (${_n(e['unitsDone']).round()}/${_n(e['unitsOf']).round()})' : ''}',
                      style: TextStyle(fontSize: 12.5, color: passed ? T.ink : T.inkFaint,
                          fontWeight: passed ? FontWeight.w600 : FontWeight.w400))),
                ]),
              );
            }),
          ]),
        ),
      ),
    );
  }

  void _export() {
    if (_rows.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(tr('لا صفوف للتصدير', 'Nothing to export'))));
      return;
    }
    exportExcel(context, fileName: 'my-customs-files', sheets: [(tr('معاملاتي', 'My customs files'), [
      ExportCol('الرقم المرجعي', 'Reference', (c) => c['refNumber']),
      ExportCol('رقم البوليصة', 'BL number', (c) => c['blNumber']),
      ExportCol('رقم البيان', 'Declaration', (c) => c['declarationNumber']),
      ExportCol('المرحلة', 'Stage', (c) => _customsProgress(c).label),
      ExportCol('الميناء', 'Port', (c) => c['port']),
      ExportCol('الحاويات', 'Containers', (c) => c['containerCount']),
      ExportCol('الوزن', 'Weight', (c) => c['totalWeight']),
      ExportCol('قيمة الفاتورة', 'Invoice value', (c) => _money(c['invoiceValue'])),
      ExportCol('الشركة المصدّرة', 'Exporter', (c) => c['exporterCompany']),
      ExportCol('تاريخ الفتح', 'Opened', (c) => _date(c['createdAt'])),
    ], _rows)]);
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) {
      return ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(), SizedBox(height: 10), Shimmer()]);
    }
    if (_error != null) {
      return ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); });
    }
    if (_rows.isEmpty) {
      return ListView(children: [
        Padding(padding: const EdgeInsets.only(top: 60), child: EmptyState(icon: Icons.directions_boat_outlined, title: tr('لا توجد معاملات تخليص', 'No customs files'))),
      ]);
    }
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView.builder(
        padding: const EdgeInsets.fromLTRB(14, 12, 14, 20),
        itemCount: _rows.length + 1,
        itemBuilder: (ctx, i) {
          if (i == 0) {
            return Align(alignment: AlignmentDirectional.centerEnd, child: TextButton.icon(
              onPressed: _export,
              icon: const Icon(Icons.file_download_outlined, size: 18),
              label: Text(tr('تصدير Excel', 'Export Excel')),
            ));
          }
          final c = _rows[i - 1];
          final pr = _customsProgress(c);
          return Padding(
            padding: const EdgeInsets.only(bottom: 10),
            child: Pressable(
              onTap: () => _open(c),
              child: AppCard(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Row(children: [
                    Expanded(child: Text((c['refNumber'] ?? c['blNumber'] ?? '—').toString(),
                        style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14))),
                    Chip2('${_n(c['containerCount']).round()} ${pr.cargo == 'vehicles' ? tr('سيّارة', 'veh') : tr('حاوية', 'ctnr')}', T.violet),
                  ]),
                  const SizedBox(height: 6),
                  Text(pr.label,
                      style: const TextStyle(fontSize: 12, color: T.orange, fontWeight: FontWeight.w700)),
                  const SizedBox(height: 8),
                  ClipRRect(
                    borderRadius: BorderRadius.circular(4),
                    child: LinearProgressIndicator(
                      value: pr.pct, minHeight: 5,
                      backgroundColor: T.line,
                      valueColor: const AlwaysStoppedAnimation(T.orange),
                    ),
                  ),
                  const SizedBox(height: 6),
                  Text([c['port'], c['exporterCompany']].where((x) => (x ?? '').toString().isNotEmpty).join(' · '),
                      style: const TextStyle(fontSize: 11.5, color: T.inkSoft)),
                ]),
              ),
            ),
          );
        },
      ),
    );
  }
}

// ── الفواتير والمدفوعات ─────────────────────────────────────────────────────
class _FinanceTab extends StatefulWidget {
  const _FinanceTab();
  @override
  State<_FinanceTab> createState() => _FinanceTabState();
}

class _FinanceTabState extends State<_FinanceTab> {
  Map<String, dynamic>? _data;
  bool _loading = true;
  String? _error;
  // أحداثُ صفحتي الفواتير والمدفوعات في الويب.
  static const _events = ['invoice:created', 'invoice:updated', 'payment:received', 'payment:logged', 'payment:deleted'];
  late final void Function() _onLive = _load;

  @override
  void initState() {
    super.initState();
    _load();
    for (final e in _events) { Live.instance.on(e, _onLive); }
  }

  @override
  void dispose() {
    for (final e in _events) { Live.instance.off(e, _onLive); }
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final d = await Api.instance.get('/api/portal/finance');
      if (!mounted) return;
      setState(() { _data = Map<String, dynamic>.from(d); _loading = false; _error = null; });
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) {
      return ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(height: 70), SizedBox(height: 10), Shimmer()]);
    }
    if (_error != null) {
      return ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); });
    }
    final totals = Map<String, dynamic>.from(_data?['totals'] ?? {});
    final invoices = List<Map<String, dynamic>>.from(_data?['invoices'] ?? []);
    final payments = List<Map<String, dynamic>>.from(_data?['payments'] ?? []);

    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(padding: const EdgeInsets.fromLTRB(14, 14, 14, 24), children: [
        Row(children: [
          Expanded(child: StatCard(label: tr('مفوتر', 'Invoiced'), value: _n(totals['invoiced']), color: T.navy, icon: Icons.receipt_long_outlined)),
          const SizedBox(width: 8),
          Expanded(child: StatCard(label: tr('مدفوع', 'Paid'), value: _n(totals['paid']), color: T.success, icon: Icons.payments_outlined)),
          const SizedBox(width: 8),
          Expanded(child: StatCard(label: tr('متأخر', 'Overdue'), value: _n(totals['overdue']), color: T.danger, icon: Icons.warning_amber_outlined)),
        ]),
        const SizedBox(height: 16),
        Row(children: [
          Expanded(child: Text(tr('الفواتير', 'Invoices'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14))),
          if (invoices.isNotEmpty)
            TextButton.icon(
              onPressed: () => exportExcel(context, fileName: 'My_Invoices', sheets: [('Invoices', _invoiceCols, invoices)]),
              icon: const Icon(Icons.file_download_outlined, size: 18),
              label: Text(tr('تصدير', 'Export')),
            ),
        ]),
        const SizedBox(height: 4),
        if (invoices.isEmpty) Text(tr('لا توجد فواتير', 'No invoices'), style: const TextStyle(fontSize: 12, color: T.inkFaint)),
        ...invoices.map((inv) {
          final overdue = inv['isOverdue'] == true;
          return Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: Pressable(
              onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => _InvoiceDetailScreen(invoiceId: '${inv['_id']}', number: '${inv['invoiceNumber'] ?? ''}'))),
              child: AppCard(
              padding: const EdgeInsets.all(12),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Row(children: [
                  Expanded(child: Text('#${inv['invoiceNumber']}', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13))),
                  Chip2(
                    overdue
                        ? '${_n(inv['overdueDays']).round()} ${tr('يوم تأخير', 'd overdue')}'
                        : (inv['status'] == 'paid' ? tr('مدفوعة', 'Paid') : '${_n(inv['remainingDays']).round()} ${tr('يوم متبقي', 'd left')}'),
                    overdue ? T.danger : (inv['status'] == 'paid' ? T.success : T.warn),
                  ),
                ]),
                const SizedBox(height: 6),
                Row(children: [
                  Expanded(child: Text('${tr('المبلغ', 'Amount')}: ${_money(inv['amount'])}', style: const TextStyle(fontSize: 12, color: T.inkSoft))),
                  Text('${tr('المتبقي', 'Balance')}: ${_money(inv['balance'])}',
                      style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w800, color: overdue ? T.danger : T.ink)),
                ]),
                Text('${tr('الاستحقاق', 'Due')}: ${_date(inv['dueDate'])}', style: const TextStyle(fontSize: 11, color: T.inkFaint)),
              ]),
            ),
            ),
          );
        }),
        if (payments.isNotEmpty) ...[
          const SizedBox(height: 16),
          Row(children: [
            Expanded(child: Text(tr('المدفوعات', 'Payments'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14))),
            // السجلُّ كاملًا في شاشته — هنا أحدثُها وحدَها.
            TextButton(
              onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const _PaymentsScreen())),
              child: Text(tr('كل المدفوعات', 'All payments')),
            ),
          ]),
          const SizedBox(height: 4),
          ...payments.take(30).map((p) => Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: AppCard(
                  padding: const EdgeInsets.all(12),
                  child: Row(children: [
                    Expanded(child: Text(_date(p['paymentDate']), style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600))),
                    Chip2(_money(p['amount']), T.success),
                  ]),
                ),
              )),
        ],
      ]),
    );
  }
}

/// قائمةُ التصدير: المعروضُ أو الكلّ — كـ ExportMenu في الويب.
Widget _exportMenu(void Function(String scope) onPick) => PopupMenuButton<String>(
      tooltip: tr('تصدير Excel', 'Export Excel'),
      icon: const Icon(Icons.file_download_outlined),
      onSelected: onPick,
      itemBuilder: (_) => [
        PopupMenuItem(value: 'shown', child: Text(tr('المعروض', 'Shown'))),
        PopupMenuItem(value: 'all', child: Text(tr('الكل', 'All'))),
      ],
    );

String _daysText(Map inv) => inv['isOverdue'] == true
    ? '-${_n(inv['overdueDays']).round()}${tr('ي', 'd')}'
    : inv['status'] == 'paid' ? tr('مدفوعة', 'Paid') : '${_n(inv['remainingDays']).round()}${tr('ي', 'd')}';

/// أعمدةُ تصدير «فواتيري» في الويب.
List<ExportCol> get _invoiceCols => [
      ExportCol('رقم الفاتورة', 'Invoice #', (r) => r['invoiceNumber']),
      ExportCol('المبلغ', 'Amount', (r) => r['amount']),
      ExportCol('المدفوع', 'Paid', (r) => r['paidAmount']),
      ExportCol('المتبقي', 'Balance', (r) => r['balance']),
      ExportCol('تاريخ الفاتورة', 'Invoice date', (r) => _date(r['invoiceDate'])),
      ExportCol('الاستحقاق', 'Due date', (r) => _date(r['dueDate'])),
      ExportCol('الأيام', 'Days', (r) => _daysText(r)),
      ExportCol('الحالة', 'Status', (r) => r['status']),
    ];

String _method(dynamic v) => '${v ?? ''}'.replaceFirst('_', ' ');

/// ── تفاصيلُ الفاتورة ومدفوعاتُها — نظيرُ /system/portal/invoices/[id] ──────
class _InvoiceDetailScreen extends StatefulWidget {
  final String invoiceId;
  final String number;
  const _InvoiceDetailScreen({required this.invoiceId, required this.number});
  @override
  State<_InvoiceDetailScreen> createState() => _InvoiceDetailScreenState();
}

class _InvoiceDetailScreenState extends State<_InvoiceDetailScreen> {
  Map<String, dynamic>? _inv;
  List<Map<String, dynamic>> _payments = [];
  bool _loading = true;
  String? _error;
  static const _events = ['invoice:updated', 'payment:received', 'payment:logged', 'payment:deleted'];
  late final void Function() _onLive = _load;

  @override
  void initState() {
    super.initState();
    _load();
    for (final e in _events) { Live.instance.on(e, _onLive); }
  }

  @override
  void dispose() {
    for (final e in _events) { Live.instance.off(e, _onLive); }
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final r = await Future.wait([
        Api.instance.get('/api/invoices/${widget.invoiceId}'),
        Api.instance.get('/api/payments?invoice=${widget.invoiceId}'),
      ]);
      if (!mounted) return;
      setState(() {
        _inv = r[0]['invoice'] is Map ? Map<String, dynamic>.from(r[0]['invoice']) : null;
        _payments = List<Map<String, dynamic>>.from(r[1]['payments'] ?? const []);
        _loading = false;
        _error = null;
      });
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  void _export() {
    final inv = _inv;
    if (inv == null) return;
    exportExcel(context, fileName: 'Invoice_${inv['invoiceNumber']}', sheets: [
      ('Invoice', [
        ExportCol('رقم الفاتورة', 'Invoice #', (r) => r['invoiceNumber']),
        ExportCol('الحالة', 'Status', (r) => r['status']),
        ExportCol('مدة الائتمان (أيام)', 'Credit Term (Days)', (r) => r['creditTerm']),
        ExportCol('المبلغ', 'Amount', (r) => r['amount']),
        ExportCol('المدفوع', 'Paid', (r) => r['paidAmount']),
        ExportCol('المتبقي', 'Balance', (r) => r['balance']),
        ExportCol('تاريخ الفاتورة', 'Invoice Date', (r) => _date(r['invoiceDate'])),
        ExportCol('الاستحقاق', 'Due Date', (r) => _date(r['dueDate'])),
        ExportCol('متأخرة', 'Overdue', (r) => r['isOverdue'] == true),
        ExportCol('أيام التأخير', 'Overdue Days', (r) => r['overdueDays']),
        ExportCol('الأيام المتبقية', 'Remaining Days', (r) => r['remainingDays']),
      ], [inv]),
      ('Payments', [
        ExportCol('التاريخ', 'Date', (r) => _date(r['paymentDate'])),
        ExportCol('المبلغ', 'Amount', (r) => r['amount']),
        ExportCol('الطريقة', 'Method', (r) => _method(r['paymentMethod'])),
        ExportCol('المرجع', 'Reference', (r) => r['reference']),
      ], _payments),
    ]);
  }

  @override
  Widget build(BuildContext context) {
    final inv = _inv;
    final overdue = inv?['isOverdue'] == true;
    final soon = !overdue && inv?['status'] != 'paid' && _n(inv?['remainingDays']) <= 5;
    final color = overdue ? T.danger : soon ? T.warn : T.success;
    return AppScaffold(
      title: Text('${tr('فاتورة', 'Invoice')} #${inv?['invoiceNumber'] ?? widget.number}'),
      actions: [if (inv != null) IconButton(tooltip: tr('تصدير', 'Export'), icon: const Icon(Icons.file_download_outlined), onPressed: _export)],
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
              : inv == null
                  ? EmptyState(icon: Icons.receipt_long_outlined, title: tr('لا توجد فواتير', 'No invoices'))
                  : RefreshIndicator(
                      onRefresh: _load,
                      child: ListView(padding: const EdgeInsets.all(14), children: [
                        AppCard(topAccent: color, child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                          Row(children: [
                            Expanded(child: Text('${tr('مدة الائتمان', 'Credit term')}: ${inv['creditTerm'] ?? '—'} ${tr('يوم', 'days')}',
                                style: const TextStyle(fontSize: 12.5, color: T.inkSoft))),
                            Chip2('${inv['status'] ?? ''}'.toUpperCase(), color),
                          ]),
                          if (overdue)
                            Padding(padding: const EdgeInsets.only(top: 8), child: Text(
                              tr('هذه الفاتورة متأخرة ${_n(inv['overdueDays']).round()} يومًا عن مدة الائتمان (${inv['creditTerm']} يومًا).',
                                  'This invoice is ${_n(inv['overdueDays']).round()} days overdue past the ${inv['creditTerm']}-day credit term.'),
                              style: const TextStyle(fontSize: 12.5, color: T.danger, fontWeight: FontWeight.w700))),
                          if (soon)
                            Padding(padding: const EdgeInsets.only(top: 8), child: Text(
                              tr('يجب سداد الفاتورة #${inv['invoiceNumber']} خلال ${_n(inv['remainingDays']).round()} يومًا (مدة الائتمان ${inv['creditTerm']} يومًا).',
                                  'Invoice #${inv['invoiceNumber']} must be paid within ${_n(inv['remainingDays']).round()} days (${inv['creditTerm']}-day term).'),
                              style: const TextStyle(fontSize: 12.5, color: Color(0xFF92400E), fontWeight: FontWeight.w700))),
                          const SizedBox(height: 12),
                          Row(children: [
                            for (final x in [
                              (tr('المبلغ', 'Amount'), _money(inv['amount']), T.ink),
                              (tr('المدفوع', 'Paid'), _money(inv['paidAmount']), T.success),
                              (tr('المتبقي', 'Balance'), _money(inv['balance']), T.danger),
                              (overdue ? tr('أيام التأخير', 'Overdue days') : tr('الأيام المتبقية', 'Remaining days'),
                                  '${_n(overdue ? inv['overdueDays'] : inv['remainingDays']).round()}', overdue ? T.danger : T.success),
                            ])
                              Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                Text(x.$1, style: const TextStyle(fontSize: 10.5, color: T.inkFaint)),
                                Text(x.$2, style: TextStyle(fontSize: 15, fontWeight: FontWeight.w900, color: x.$3)),
                              ])),
                          ]),
                          const Divider(height: 20),
                          Text('${tr('تاريخ الفاتورة', 'Invoice date')}: ${_date(inv['invoiceDate'])}    ${tr('الاستحقاق', 'Due date')}: ${_date(inv['dueDate'])}',
                              style: const TextStyle(fontSize: 12, color: T.inkSoft)),
                        ])),
                        const SizedBox(height: 14),
                        Text(tr('المدفوعات', 'Payments'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14)),
                        const SizedBox(height: 8),
                        if (_payments.isEmpty) Text(tr('لا توجد مدفوعات', 'No payments'), style: const TextStyle(fontSize: 12, color: T.inkFaint)),
                        for (final p in _payments)
                          Padding(padding: const EdgeInsets.only(bottom: 8), child: AppCard(padding: const EdgeInsets.all(12), child: Row(children: [
                            Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                              Text(_date(p['paymentDate']), style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700)),
                              Text('${_method(p['paymentMethod'])}${'${p['reference'] ?? ''}'.isNotEmpty ? ' · ${p['reference']}' : ''}', style: const TextStyle(fontSize: 11.5, color: T.inkFaint)),
                            ])),
                            Chip2(_money(p['amount']), T.success),
                          ]))),
                      ]),
                    ),
    );
  }
}

/// ── سجلُّ المدفوعات كاملًا — نظيرُ /system/portal/payments ────────────────────
class _PaymentsScreen extends StatefulWidget {
  const _PaymentsScreen();
  @override
  State<_PaymentsScreen> createState() => _PaymentsScreenState();
}

class _PaymentsScreenState extends State<_PaymentsScreen> {
  List<Map<String, dynamic>> _rows = [];
  bool _loading = true;
  String? _error;
  static const _events = ['payment:received', 'payment:logged', 'payment:deleted'];
  late final void Function() _onLive = _load;

  @override
  void initState() {
    super.initState();
    _load();
    for (final e in _events) { Live.instance.on(e, _onLive); }
  }

  @override
  void dispose() {
    for (final e in _events) { Live.instance.off(e, _onLive); }
    super.dispose();
  }

  // الخادمُ يرقّم بخمسين افتراضيًّا — والسجلُّ هنا كاملٌ بلا سقفٍ عمليّ.
  Future<void> _load() async {
    try {
      final d = await Api.instance.get('/api/payments?page=1&limit=100000');
      if (!mounted) return;
      setState(() { _rows = List<Map<String, dynamic>>.from(d['payments'] ?? const []); _loading = false; _error = null; });
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  @override
  Widget build(BuildContext context) {
    final total = _rows.fold<num>(0, (s, p) => s + _n(p['amount']));
    return AppScaffold(
      title: Text(tr('مدفوعاتي', 'My Payments')),
      actions: [
        if (_rows.isNotEmpty)
          ExportButton(fileName: 'Payment_History', sheetName: 'Payments', rows: () => _rows, columns: [
            ExportCol('تاريخ الدفع', 'Payment date', (r) => _date(r['paymentDate'])),
            ExportCol('رقم الفاتورة', 'Invoice #', (r) => r['invoice'] is Map ? r['invoice']['invoiceNumber'] : ''),
            ExportCol('المبلغ', 'Amount', (r) => r['amount']),
            ExportCol('طريقة الدفع', 'Payment method', (r) => _method(r['paymentMethod'])),
            ExportCol('المرجع', 'Reference', (r) => r['reference']),
          ]),
      ],
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView(padding: const EdgeInsets.all(14), children: [
                    AppCard(child: Row(children: [
                      Expanded(child: Text(tr('إجمالي المدفوع', 'Total paid'), style: const TextStyle(fontWeight: FontWeight.w700))),
                      Text(_money(total), style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w900, color: T.success)),
                    ])),
                    const SizedBox(height: 10),
                    if (_rows.isEmpty) EmptyState(icon: Icons.payments_outlined, title: tr('لا توجد مدفوعات', 'No payments')),
                    for (final p in _rows)
                      Padding(padding: const EdgeInsets.only(bottom: 8), child: AppCard(padding: const EdgeInsets.all(12), child: Row(children: [
                        Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          Text('#${p['invoice'] is Map ? p['invoice']['invoiceNumber'] : '-'} · ${_date(p['paymentDate'])}', style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700)),
                          Text('${_method(p['paymentMethod'])}${'${p['reference'] ?? ''}'.isNotEmpty ? ' · ${p['reference']}' : ''}', style: const TextStyle(fontSize: 11.5, color: T.inkFaint)),
                        ])),
                        Chip2(_money(p['amount']), T.success),
                      ]))),
                  ]),
                ),
    );
  }
}
