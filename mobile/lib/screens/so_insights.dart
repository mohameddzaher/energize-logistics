import 'dart:async';
import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/search_field.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';
import 'insight_kit.dart';
import 'shipment_order_detail.dart';
import 'shipment_orders_common.dart';

/// Shipment orders analytics, counterpart of /system/shipment-orders/analytics (it replaced the dashboard and the old analytics).
/// One computation on the server (/api/shipment-orders/insights) under every filter; money keys are absent when this reader may not see them.
class SoInsightsScreen extends StatefulWidget {
  const SoInsightsScreen({super.key});
  @override
  State<SoInsightsScreen> createState() => _SoInsightsScreenState();
}

/// Filter dimensions as the server names them, with their Arabic label.
const _dims = <(String, String, String)>[
  ('customer', 'العميل', 'Customer'),
  ('route', 'المسار', 'Route'),
  ('fromCity', 'من', 'From'),
  ('toCity', 'إلى', 'To'),
  ('branch', 'الفرع', 'Branch'),
  ('truckType', 'نوع الشاحنة', 'Truck type'),
  ('truckLength', 'طول الشاحنة', 'Truck length'),
  ('cargoType', 'نوع الحمولة', 'Cargo type'),
  ('payment', 'نوع الدفع', 'Payment'),
  ('salesRep', 'السيلز التشغيلي', 'Operational sales'),
  ('agent', 'مُنشئ الشحنة', 'Created by'),
  ('supplier', 'المورّد', 'Supplier'),
  ('status', 'الحالة', 'Status'),
  ('cancelReason', 'سبب الإلغاء', 'Cancel reason'),
  ('source', 'المصدر', 'Source'),
];

const _presets = [('today', 'اليوم', 'Today'), ('7d', '7 أيام', '7 days'), ('month', 'هذا الشهر', 'This month'), ('lastMonth', 'الشهر الماضي', 'Last month'), ('30d', '30 يومًا', '30 days'), ('90d', '90 يومًا', '90 days'), ('year', 'هذه السنة', 'This year')];

const _tabs = <(String, String, String)>[
  ('customers', 'العملاء', 'Customers'),
  ('routes', 'المسارات', 'Routes'),
  ('suppliers', 'الموردون', 'Suppliers'),
  ('branches', 'الفروع', 'Branches'),
  ('truckTypes', 'أنواع الشاحنات', 'Truck types'),
  ('payments', 'أنواع الدفع', 'Payments'),
  ('salesReps', 'السيلز التشغيلي', 'Operational sales'),
  ('agents', 'مُنشئو الشحنات', 'Creators'),
  ('toCities', 'الوجهات', 'Destinations'),
  ('cargoTypes', 'أنواع الحمولة', 'Cargo types'),
];

class _SoInsightsScreenState extends State<SoInsightsScreen> {
  Map<String, dynamic>? _d;
  Map<String, dynamic> _opts = {};
  bool _loading = true;
  String? _error;
  int _seq = 0;
  String _preset = 'month';
  String _from = '', _to = '';
  String _dateBy = 'pickup';
  String _q = '';
  String _supplierType = '';
  String _request = '';
  final Map<String, List<String>> _f = {};
  String _tab = 'customers';
  // Which part of the page: the overview, the sales requests and their fulfilment, or cancellations.
  String _view = 'overview';
  Timer? _debounce;
  Timer? _liveDebounce;
  List<SoStatus> _vocab = soBaseStatuses;
  late final void Function() _onLive = _liveReload;

  @override
  void initState() {
    super.initState();
    _applyPreset('month', load: false);
    _load();
    loadSoStatuses().then((v) { if (mounted) setState(() => _vocab = v); });
    Live.instance.on('shipmentOrders:updated', _onLive);
    Live.instance.on('shipmentRequests:changed', _onLive);
  }

  @override
  void dispose() {
    Live.instance.off('shipmentOrders:updated', _onLive);
    Live.instance.off('shipmentRequests:changed', _onLive);
    _debounce?.cancel();
    _liveDebounce?.cancel();
    super.dispose();
  }

  void _liveReload() {
    _liveDebounce?.cancel();
    _liveDebounce = Timer(const Duration(milliseconds: 700), _load);
  }

  void _applyPreset(String p, {bool load = true}) {
    final now = DateTime.now();
    final today = DateTime(now.year, now.month, now.day);
    DateTime from = today;
    DateTime to = today;
    switch (p) {
      case '7d': from = today.subtract(const Duration(days: 6)); break;
      case '30d': from = today.subtract(const Duration(days: 29)); break;
      case '90d': from = today.subtract(const Duration(days: 89)); break;
      case 'month': from = DateTime(now.year, now.month, 1); break;
      case 'lastMonth': from = DateTime(now.year, now.month - 1, 1); to = DateTime(now.year, now.month, 0); break;
      case 'year': from = DateTime(now.year, 1, 1); break;
    }
    _preset = p;
    _from = ymd(from);
    _to = ymd(to);
    if (load) { setState(() {}); _load(); }
  }

  String _query() {
    final p = <String>['from=$_from', 'to=$_to', 'dateBy=$_dateBy'];
    _f.forEach((k, vals) { for (final v in vals) { p.add('f_$k=${Uri.encodeQueryComponent(v)}'); } });
    if (_supplierType.isNotEmpty) p.add('f_supplierType=$_supplierType');
    if (_request.isNotEmpty) p.add('f_request=$_request');
    if (_q.trim().isNotEmpty) p.add('q=${Uri.encodeQueryComponent(_q.trim())}');
    return p.join('&');
  }

  Future<void> _load() async {
    final mine = ++_seq;
    try {
      final d = await Api.instance.get('/api/shipment-orders/insights?${_query()}');
      if (!mounted || mine != _seq) return;
      setState(() { _d = Map<String, dynamic>.from(d); _loading = false; _error = null; });
    } catch (e) {
      if (mounted && mine == _seq) setState(() { _loading = false; _error = e.toString(); });
    }
    try {
      final o = await Api.instance.get('/api/shipment-orders/insights/options?from=$_from&to=$_to&dateBy=$_dateBy');
      if (mounted && mine == _seq) setState(() => _opts = Map<String, dynamic>.from(o['options'] ?? {}));
    } catch (_) {/* filters keep their last lists */}
  }

  Future<void> _pickRange() async {
    final r = await showDateRangePicker(
      context: context, firstDate: DateTime(2020), lastDate: DateTime(2100),
      initialDateRange: DateTimeRange(start: DateTime.tryParse(_from) ?? DateTime.now(), end: DateTime.tryParse(_to) ?? DateTime.now()),
    );
    if (r == null) return;
    setState(() { _preset = ''; _from = ymd(r.start); _to = ymd(r.end); });
    _load();
  }

  String _valueLabel(String dim, String v) {
    if (dim == 'payment') return v.isEmpty ? tr('(فارغ)', '(blank)') : soPaymentKindLabel(v);
    if (dim == 'status') return tr(soStatusOf(_vocab, v).$2, soStatusOf(_vocab, v).$3);
    if (dim == 'source') return v == 'platform' ? tr('المنصّة', 'Platform') : tr('النظام', 'System');
    return v;
  }

  Future<void> _openDim(String key, String title) async {
    final opts = List<Map<String, dynamic>>.from((_opts[key] as List?)?.map((e) => Map<String, dynamic>.from(e)) ?? const []);
    final res = await pickValues(context, title: title, options: opts, selected: _f[key] ?? const [], labelOf: (v) => _valueLabel(key, v));
    if (res == null) return;
    setState(() { if (res.isEmpty) { _f.remove(key); } else { _f[key] = res; } });
    _load();
  }

  Future<void> _filterSheet() async {
    await showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (c) => StatefulBuilder(builder: (c, setSheet) => SafeArea(child: SizedBox(
        height: MediaQuery.of(c).size.height * 0.8,
        child: ListView(padding: const EdgeInsets.all(14), children: [
          Text(tr('الفلاتر', 'Filters'), style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 16)),
          const SizedBox(height: 6),
          Text(tr('أساس التاريخ', 'Date basis'), style: const TextStyle(fontSize: 12, color: T.inkFaint)),
          Wrap(spacing: 6, children: [
            for (final x in [('pickup', 'تاريخ الاستلام', 'Pickup date'), ('created', 'تاريخ الإنشاء', 'Created date')])
              ChoiceChip(label: Text(tr(x.$2, x.$3)), selected: _dateBy == x.$1, onSelected: (_) { setState(() => _dateBy = x.$1); setSheet(() {}); _load(); }),
          ]),
          const SizedBox(height: 8),
          Text(tr('نوع المورّد', 'Supplier kind'), style: const TextStyle(fontSize: 12, color: T.inkFaint)),
          Wrap(spacing: 6, children: [
            for (final x in [('', 'الكل', 'All'), ('company', 'شركات', 'Companies'), ('freelancer', 'سائقون أفراد', 'Freelancers'), ('none', 'بلا مورّد', 'None')])
              ChoiceChip(label: Text(tr(x.$2, x.$3)), selected: _supplierType == x.$1, onSelected: (_) { setState(() => _supplierType = x.$1); setSheet(() {}); _load(); }),
          ]),
          const SizedBox(height: 8),
          Text(tr('طريقة الإنشاء', 'How created'), style: const TextStyle(fontSize: 12, color: T.inkFaint)),
          Wrap(spacing: 6, children: [
            for (final x in [('', 'الكل', 'All'), ('yes', 'من طلبات المبيعات', 'From sales requests'), ('no', 'إنشاءٌ مباشر', 'Direct')])
              ChoiceChip(label: Text(tr(x.$2, x.$3)), selected: _request == x.$1, onSelected: (_) { setState(() => _request = x.$1); setSheet(() {}); _load(); }),
          ]),
          const Divider(height: 22),
          for (final d in _dims)
            ListTile(
              dense: true, contentPadding: EdgeInsets.zero,
              title: Text(tr(d.$2, d.$3), style: const TextStyle(fontWeight: FontWeight.w700)),
              subtitle: (_f[d.$1] ?? const []).isEmpty ? Text(tr('الكل', 'All')) : Text((_f[d.$1]!).map((v) => _valueLabel(d.$1, v)).join('، '), maxLines: 2, overflow: TextOverflow.ellipsis),
              trailing: const Icon(Icons.chevron_left),
              onTap: () async { await _openDim(d.$1, tr(d.$2, d.$3)); setSheet(() {}); },
            ),
        ]),
      ))),
    );
  }

  int get _activeCount => _f.values.fold<int>(0, (a, v) => a + v.length) + (_supplierType.isEmpty ? 0 : 1) + (_request.isEmpty ? 0 : 1) + (_q.trim().isEmpty ? 0 : 1);

  void _reset() {
    _debounce?.cancel();
    setState(() { _f.clear(); _supplierType = ''; _request = ''; _q = ''; _dateBy = 'pickup'; });
    _applyPreset('month');
  }

  List<Map<String, dynamic>> _rows(String k) => List<Map<String, dynamic>>.from(((_d?[k] as List?) ?? const []).map((e) => Map<String, dynamic>.from(e)));

  String _rowName(String tab, Map r) => tab == 'payments' ? soPaymentKindLabel(r['key'] ?? '') : '${r['name'] ?? '—'}';

  /// One group row: name, executed count, share, and the money this reader may see.
  Widget _groupRow(String tab, Map<String, dynamic> r) {
    final parts = <String>[
      '${tr('منفّذة', 'Executed')} ${fmtNum(r['live'])}',
      if (inum(r['cancelled']) > 0) '${tr('ملغاة', 'Cancelled')} ${fmtNum(r['cancelled'])} (${r['cancelRate']}%)',
      if (has(r, 'sell')) '${tr('بيع', 'Sell')} ${soMoney(r['sell'])}',
      if (has(r, 'buy')) '${tr('شراء', 'Buy')} ${soMoney(r['buy'])}',
      if (has(r, 'avgSell')) '${tr('متوسط البيع', 'Avg sell')} ${soMoney(r['avgSell'])}',
      if (has(r, 'avgBuy')) '${tr('متوسط الشراء', 'Avg buy')} ${soMoney(r['avgBuy'])}',
      if (has(r, 'minBuy')) '${tr('الشراء', 'Buy')} ${soMoney(r['minBuy'])}–${soMoney(r['maxBuy'])}',
      if (has(r, 'minSell')) '${tr('البيع', 'Sell')} ${soMoney(r['minSell'])}–${soMoney(r['maxSell'])}',
    ];
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Row(children: [
          Expanded(child: Text(_rowName(tab, r), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13), overflow: TextOverflow.ellipsis)),
          if (tab == 'customers') ...[gradeBadge(r['grade'], score: r['score']), const SizedBox(width: 4), trendChip(r['trend'])],
          if (has(r, 'margin') && tab != 'customers')
            Text(soMoney(r['margin']), style: TextStyle(fontWeight: FontWeight.w800, color: inum(r['margin']) >= 0 ? T.success : T.danger)),
          if (tab != 'customers' && !has(r, 'margin')) Text('${r['share'] ?? 0}%', style: const TextStyle(fontSize: 12, color: T.inkSoft)),
        ]),
        Text(parts.join(' · '), style: const TextStyle(fontSize: 11, color: T.inkFaint)),
        if (tab == 'customers')
          Text([
            '${tr('أشهرٌ نشطة', 'Active months')} ${r['activeMonths'] ?? 0}',
            '${tr('مسارات', 'Routes')} ${r['routes'] ?? 0}',
            if (r['daysSinceLast'] != null) '${tr('آخر شحنة منذ', 'Last')} ${r['daysSinceLast']} ${tr('يومًا', 'days')}',
            if (has(r, 'margin')) '${tr('الربح', 'Profit')} ${soMoney(r['margin'])}${r['marginPct'] == null ? '' : ' (${r['marginPct']}%)'}',
          ].join(' · '), style: const TextStyle(fontSize: 11, color: T.inkSoft)),
      ]),
    );
  }

  List<Map<String, dynamic>> _list(dynamic v) => List<Map<String, dynamic>>.from(((v as List?) ?? const []).map((e) => Map<String, dynamic>.from(e)));

  /// Cancellations: reasons (tap to filter) and the branch × reason counts.
  List<Widget> _cancelView(List<Map<String, dynamic>> reasons) {
    final t = Map<String, dynamic>.from(_d?['totals'] ?? {});
    final byBranch = _rows('cancelByBranch');
    return [
      TileWrap([
        KpiTile(tr('الملغاة', 'Cancelled'), fmtNum(t['cancelled']), color: T.danger),
        KpiTile(tr('نسبة الإلغاء', 'Cancel rate'), '${t['cancelRate'] ?? 0}%', color: T.danger),
      ]),
      SectionCard(
        title: tr('أسباب الإلغاء', 'Cancellation reasons'),
        child: BarList([for (final x in reasons) ('${x['reason']}'.isEmpty ? tr('بلا سببٍ مسجّل', 'No reason recorded') : '${x['reason']}', inum(x['count']), '${fmtNum(x['count'])} · ${x['pct']}%')], color: T.danger,
            onTap: (i) { final r = '${reasons[i]['reason']}'; setState(() => _f['cancelReason'] = [r.isEmpty ? '__blank__' : r]); _load(); }),
      ),
      if (byBranch.isNotEmpty)
        SectionCard(
          title: tr('الإلغاء حسب الفرع والسبب', 'By branch and reason'),
          child: BarList([for (final x in byBranch) ('${x['branch'] == '' ? '—' : x['branch']} · ${'${x['reason']}'.isEmpty ? tr('بلا سبب', 'No reason') : x['reason']}', inum(x['n']), fmtNum(x['n']))], color: T.danger),
        ),
    ];
  }

  /// One funnel row (sales member, customer, route, branch, truck type): asked, placed, rejected, open, fulfilment and reasons.
  Widget _funnelRow(Map<String, dynamic> r) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 6),
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Row(children: [
            Expanded(child: Text('${r['name'] ?? '—'}', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13), overflow: TextOverflow.ellipsis)),
            Text('${r['fulfilment'] ?? 0}%', style: TextStyle(fontWeight: FontWeight.w800, color: inum(r['fulfilment']) >= 80 ? T.success : T.warn)),
          ]),
          Text([
            '${tr('طلبات', 'Requests')} ${fmtNum(r['requests'])}',
            '${tr('شاحنات', 'Trucks')} ${fmtNum(r['trucks'])}',
            '${tr('حُقّقت', 'Placed')} ${fmtNum(r['placed'])}',
            if (inum(r['rejected']) > 0) '${tr('رُفضت', 'Rejected')} ${fmtNum(r['rejected'])}',
            if (inum(r['open']) > 0) '${tr('مفتوحة', 'Open')} ${fmtNum(r['open'])}',
            if (inum(r['cancelled']) > 0) '${tr('مسحوبة', 'Withdrawn')} ${fmtNum(r['cancelled'])}',
          ].join(' · '), style: const TextStyle(fontSize: 11, color: T.inkFaint)),
          if (_list(r['reasons']).isNotEmpty)
            Text('${tr('أسباب الرفض', 'Reasons')}: ${_list(r['reasons']).map((x) => '${x['reason']} (${x['n']})').join('، ')}', style: const TextStyle(fontSize: 11, color: T.danger)),
        ]),
      );

  Widget _funnelCard(String title, dynamic rows) {
    final list = _list(rows);
    if (list.isEmpty) return const SizedBox.shrink();
    return SectionCard(
      title: title,
      trailing: Text('${list.length}', style: const TextStyle(fontSize: 12, color: T.inkFaint)),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [for (final r in list.take(40)) _funnelRow(r)]),
    );
  }

  /// Sales requests: what sales asked, what the vendors team placed, and why the rest fell short.
  List<Widget> _requestsView(Map<String, dynamic> req) {
    if (inum(req['requests']) == 0) {
      return [Padding(padding: const EdgeInsets.all(20), child: Text(tr('لا طلبات مبيعات في هذه الفترة', 'No sales requests in this period'), textAlign: TextAlign.center, style: const TextStyle(color: T.inkFaint)))];
    }
    final reasonTrucks = Map<String, dynamic>.from(req['reasonTrucks'] ?? {});
    final gap = <(String, num, String)>[
      for (final e in reasonTrucks.entries) ('${tr('رفض', 'Rejected')}: ${e.key}', inum(e.value), fmtNum(e.value)),
      if (inum(req['openTrucks']) > 0) (tr('مفتوحة لم يُسند لها مورّدٌ بعد', 'Open, not yet placed'), inum(req['openTrucks']), fmtNum(req['openTrucks'])),
      if (inum(req['cancelledTrucks']) > 0) (tr('سحبها فريقُ المبيعات', 'Withdrawn by sales'), inum(req['cancelledTrucks']), fmtNum(req['cancelledTrucks'])),
    ]..sort((a, b) => b.$2.compareTo(a.$2));
    final trend = _list(req['trend']);
    final resub = Map<String, dynamic>.from(req['resubmitted'] ?? {});
    final bySales = _list(req['reasonBySales']);
    return [
      TileWrap([
        KpiTile(tr('طلبات المبيعات', 'Sales requests'), fmtNum(req['requests']), foot: Text('${fmtNum(req['trucks'])} ${tr('شاحنة مطلوبة', 'trucks asked')}', style: const TextStyle(fontSize: 10.5, color: T.inkFaint))),
        KpiTile(tr('حقّقها الموردون', 'Placed by vendors'), fmtNum(req['placed']), color: T.success),
        KpiTile(tr('نسبة التحقيق', 'Fulfilment'), '${req['fulfilment'] ?? 0}%', color: inum(req['fulfilment']) >= 80 ? T.success : T.warn),
        KpiTile(tr('مرفوضة', 'Rejected'), fmtNum(req['rejectedTrucks']), color: T.danger),
        KpiTile(tr('ما زالت مفتوحة', 'Still open'), fmtNum(req['openTrucks']), color: T.warn),
        KpiTile(tr('سحبها السيلز', 'Withdrawn'), fmtNum(req['cancelledTrucks']), color: T.inkSoft),
        KpiTile(tr('أوّل إسنادٍ بعد', 'First placement after'), req['avgHoursToFirstPlace'] == null ? '—' : '${fmtNum(req['avgHoursToFirstPlace'])} ${tr('ساعة', 'h')}'),
        KpiTile(tr('إكمال الطلب بعد', 'Completed after'), req['avgHoursToComplete'] == null ? '—' : '${fmtNum(req['avgHoursToComplete'])} ${tr('ساعة', 'h')}'),
        KpiTile(tr('أُعيد إرسالها بعد الرفض', 'Resent after rejection'), fmtNum(resub['requests']), foot: Text('${tr('نُفّذ منها', 'placed')} ${fmtNum(resub['placedAfter'])}', style: const TextStyle(fontSize: 10.5, color: T.inkFaint))),
      ]),
      SectionCard(
        title: tr('الفجوة بين المطلوب والمحقَّق وأسبابها', 'The gap between asked and placed, and why'),
        note: tr('كلّ شاحنةٍ طلبها السيلز ولم تصر أمرَ نقل', 'Every asked truck that did not become an order'),
        child: gap.isEmpty ? Text(tr('لا فجوة — كلّ المطلوب تحقّق', 'No gap'), style: const TextStyle(color: T.success)) : BarList(gap, color: T.danger),
      ),
      if (trend.length > 1)
        SectionCard(
          title: tr('الطلبات يومًا بيوم', 'Requests day by day'),
          note: tr('المحقَّق (أخضر) والمرفوض (أحمر)', 'Placed (green) and rejected (red)'),
          child: ColumnChart(labels: [for (final x in trend) '${x['day']}'.length > 5 ? '${x['day']}'.substring(5) : '${x['day']}'], a: [for (final x in trend) inum(x['placed'])], b: [for (final x in trend) inum(x['rejected'])], colorA: T.success),
        ),
      _funnelCard(tr('ماذا جاب كلُّ موظّف مبيعات، وكم تحقّق منه', 'What each sales member brought'), req['bySalesRep']),
      if (bySales.isNotEmpty)
        SectionCard(
          title: tr('أسباب الرفض لكلّ موظّف مبيعات', 'Rejection reasons per sales member'),
          child: BarList([for (final x in bySales) ('${x['sales']} · ${x['reason']}', inum(x['trucks']), '${fmtNum(x['requests'])} ${tr('طلب', 'req')} · ${fmtNum(x['trucks'])} ${tr('شاحنة', 'trucks')}')], color: T.danger),
        ),
      _funnelCard(tr('حسب العميل', 'By customer'), req['byCustomer']),
      _funnelCard(tr('حسب المسار', 'By route'), req['byRoute']),
      _funnelCard(tr('حسب الفرع', 'By branch'), req['byBranch']),
      _funnelCard(tr('حسب نوع الشاحنة', 'By truck type'), req['byTruckType']),
      if (_list(req['reasons']).isNotEmpty)
        SectionCard(
          title: tr('أسباب الرفض', 'Rejection reasons'),
          child: BarList([for (final x in _list(req['reasons'])) ('${x['reason']}', inum(x['count']), '${fmtNum(x['count'])} · ${fmtNum(reasonTrucks['${x['reason']}'])} ${tr('شاحنة', 'trucks')}')], color: T.danger),
        ),
      if (_list(req['byHandler']).isNotEmpty)
        SectionCard(
          title: tr('مَن أنجز من فريق الموردين', 'Placed by (vendors team)'),
          child: BarList([for (final x in _list(req['byHandler'])) ('${x['name']}', inum(x['placed']), fmtNum(x['placed']))], color: T.success),
        ),
      if (_list(req['openAge']).isNotEmpty)
        SectionCard(
          title: tr('عمرُ الطلبات المفتوحة', 'Age of open requests'),
          child: BarList([for (final x in _list(req['openAge'])) ('${x['key']}', inum(x['trucks']), '${fmtNum(x['trucks'])} ${tr('شاحنة', 'trucks')} · ${fmtNum(x['requests'])} ${tr('طلب', 'req')}')], color: T.warn),
        ),
    ];
  }

  @override
  Widget build(BuildContext context) {
    final d = _d;
    final t = Map<String, dynamic>.from(d?['totals'] ?? {});
    final p = Map<String, dynamic>.from(d?['previous'] ?? {});
    final trend = _rows('trend');
    final byStatus = Map<String, dynamic>.from(d?['byStatus'] ?? {});
    final reasons = _rows('cancelReasons');
    final losing = _rows('losing');
    final req = Map<String, dynamic>.from(d?['requests'] ?? {});
    final kinds = _rows('supplierKinds');
    final rows = _rows(_tab);
    final money = has(t, 'sell') || has(t, 'buy');
    return AppScaffold(
      title: Text(tr('تحليلات الشحنات', 'Shipment analytics')),
      actions: [
        IconButton(
          tooltip: tr('الفلاتر', 'Filters'),
          icon: Badge(isLabelVisible: _activeCount > 0, label: Text('$_activeCount'), child: const Icon(Icons.filter_alt_outlined)),
          onPressed: _filterSheet,
        ),
      ],
      body: _loading && d == null
          ? const Center(child: CircularProgressIndicator())
          : _error != null && d == null
              ? ErrorRetry(message: _error!, onRetry: _load)
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView(keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag, padding: const EdgeInsets.all(14), children: [
                    SingleChildScrollView(scrollDirection: Axis.horizontal, child: Row(children: [
                      for (final x in _presets)
                        Padding(padding: const EdgeInsetsDirectional.only(end: 5), child: ChoiceChip(
                          label: Text(tr(x.$2, x.$3)), selected: _preset == x.$1, onSelected: (_) => _applyPreset(x.$1))),
                      ActionChip(avatar: const Icon(Icons.date_range, size: 15), label: Text('$_from ← $_to'), onPressed: _pickRange),
                    ])),
                    const SizedBox(height: 6),
                    SearchField(hint: tr('بحث: عميل، مورّد، مدينة، سائق، أمر نقل…', 'Search: customer, supplier, city, driver…'),
                        onChanged: (v) { _debounce?.cancel(); _debounce = Timer(const Duration(milliseconds: 400), () { _q = v; _load(); }); }),
                    if (_activeCount > 0)
                      Padding(padding: const EdgeInsets.only(top: 6), child: Wrap(spacing: 5, runSpacing: 5, children: [
                        for (final e in _f.entries)
                          for (final v in e.value)
                            InputChip(
                              label: Text('${tr(_dims.firstWhere((x) => x.$1 == e.key).$2, _dims.firstWhere((x) => x.$1 == e.key).$3)}: ${_valueLabel(e.key, v)}', style: const TextStyle(fontSize: 11.5)),
                              onDeleted: () { setState(() { e.value.remove(v); if (e.value.isEmpty) _f.remove(e.key); }); _load(); },
                            ),
                        ActionChip(avatar: const Icon(Icons.restart_alt, size: 15), label: Text(tr('مسح الكل', 'Clear all')), onPressed: _reset),
                      ])),
                    const SizedBox(height: 8),
                    SingleChildScrollView(scrollDirection: Axis.horizontal, child: Row(children: [
                      for (final x in const [('overview', 'نظرة عامة', 'Overview'), ('requests', 'طلبات المبيعات والموردين', 'Sales requests & vendors'), ('cancel', 'الإلغاء', 'Cancellations')])
                        Padding(padding: const EdgeInsetsDirectional.only(end: 5), child: ChoiceChip(
                          showCheckmark: false, selected: _view == x.$1, selectedColor: T.navy,
                          labelStyle: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700, color: _view == x.$1 ? Colors.white : T.inkSoft),
                          label: Text(tr(x.$2, x.$3)), onSelected: (_) => setState(() => _view = x.$1))),
                    ])),
                    const SizedBox(height: 10),
                    if (_view == 'requests') ..._requestsView(req),
                    if (_view == 'cancel') ..._cancelView(reasons),
                    if (_view == 'overview') ...[
                    TileWrap([
                      KpiTile(tr('الشحنات', 'Shipments'), fmtNum(t['orders']), foot: deltaText(t['orders'], p['orders'])),
                      KpiTile(tr('المنفّذة', 'Executed'), fmtNum(t['live']), color: T.navy, foot: deltaText(t['live'], p['live'])),
                      KpiTile(tr('الملغاة', 'Cancelled'), '${fmtNum(t['cancelled'])} (${t['cancelRate'] ?? 0}%)', color: T.danger, foot: deltaText(t['cancelled'], p['cancelled'], lowerIsBetter: true)),
                      if (has(t, 'sell')) KpiTile(tr('الإيرادات', 'Revenue'), soMoney(t['sell']), color: T.success, foot: deltaText(t['sell'], p['sell'])),
                      if (has(t, 'buy')) KpiTile(tr('التكلفة', 'Cost'), soMoney(t['buy']), color: T.inkSoft, foot: deltaText(t['buy'], p['buy'], lowerIsBetter: true)),
                      if (has(t, 'margin')) KpiTile(tr('الربح', 'Profit'), soMoney(t['margin']), color: inum(t['margin']) >= 0 ? T.success : T.danger, foot: deltaText(t['margin'], p['margin'])),
                      if (has(t, 'marginPct')) KpiTile(tr('هامش الربح', 'Margin'), '${t['marginPct'] ?? '—'}%'),
                      if (has(t, 'avgSell')) KpiTile(tr('متوسط البيع للرحلة', 'Avg sell / trip'), soMoney(t['avgSell'])),
                      if (has(t, 'avgBuy')) KpiTile(tr('متوسط الشراء للرحلة', 'Avg buy / trip'), soMoney(t['avgBuy'])),
                      KpiTile(tr('العملاء', 'Customers'), fmtNum(t['customers']), foot: deltaText(t['customers'], p['customers'])),
                      KpiTile(tr('الموردون', 'Suppliers'), fmtNum(t['suppliers'])),
                      KpiTile(tr('المسارات', 'Routes'), fmtNum(t['routes'])),
                      if (has(t, 'losing')) KpiTile(tr('شحنات خاسرة', 'Losing'), fmtNum(t['losing']), color: inum(t['losing']) > 0 ? T.danger : T.ink),
                      if (has(t, 'noSell') && has(t, 'sell')) KpiTile(tr('بلا سعر بيع', 'No sell price'), fmtNum(t['noSell']), color: inum(t['noSell']) > 0 ? T.warn : T.ink),
                      if (has(t, 'noBuy') && has(t, 'buy')) KpiTile(tr('بلا سعر شراء', 'No buy price'), fmtNum(t['noBuy']), color: inum(t['noBuy']) > 0 ? T.warn : T.ink),
                      KpiTile(tr('من طلبات المبيعات', 'From sales requests'), fmtNum(t['fromRequests'])),
                      KpiTile(tr('بلا سيلز تشغيلي', 'No operational sales'), fmtNum(t['noSalesRep']), color: inum(t['noSalesRep']) > 0 ? T.warn : T.ink),
                    ]),
                    if (money && has(t, 'margin') && inum(t['priced']) < inum(t['live']))
                      Padding(padding: const EdgeInsets.only(top: 4), child: Text(
                        tr('الربحُ محسوبٌ على ${fmtNum(t['priced'])} شحنةً لها سعرا البيع والشراء من ${fmtNum(t['live'])} منفّذة.',
                            'Profit is computed on ${fmtNum(t['priced'])} shipments with both prices out of ${fmtNum(t['live'])} executed.'),
                        style: const TextStyle(fontSize: 11.5, color: T.warn))),
                    if (trend.length > 1)
                      SectionCard(
                        title: tr('الاتجاه', 'Trend'),
                        note: tr('المنفّذة (برتقالي) والملغاة (أحمر) لكل ${d?['span']?['unit'] == 'month' ? 'شهر' : 'يوم'}', 'Executed (orange) and cancelled (red) per ${d?['span']?['unit'] ?? 'day'}'),
                        child: ColumnChart(
                          labels: [for (final x in trend) '${x['key']}'.length > 7 ? '${x['key']}'.substring(5) : '${x['key']}'],
                          a: [for (final x in trend) inum(x['live'])],
                          b: [for (final x in trend) inum(x['cancelled'])],
                        ),
                      ),
                    if (byStatus.isNotEmpty)
                      SectionCard(
                        title: tr('أين تقف الشحنات', 'Where shipments stand'),
                        child: Wrap(spacing: 6, runSpacing: 6, children: [
                          for (final e in byStatus.entries)
                            InkWell(
                              onTap: () { setState(() => _f['status'] = [e.key]); _load(); },
                              child: Chip2('${tr(soStatusOf(_vocab, e.key).$2, soStatusOf(_vocab, e.key).$3)} · ${fmtNum(e.value)}', soStatusOf(_vocab, e.key).$4),
                            ),
                        ]),
                      ),
                    if (kinds.isNotEmpty)
                      SectionCard(
                        title: tr('من يُنفّذ', 'Who executes'),
                        child: BarList([
                          for (final k in kinds)
                            (k['key'] == 'freelancer' ? tr('سائقون أفراد', 'Freelancers') : k['key'] == 'none' ? tr('بلا مورّد', 'No supplier') : tr('شركات', 'Companies'),
                                inum(k['live']), '${fmtNum(k['live'])} · ${k['share']}%${has(k, 'avgBuy') ? ' · ${soMoney(k['avgBuy'])}' : ''}'),
                        ], color: T.navy),
                      ),
                    SectionCard(
                      title: tr('التفصيل', 'Breakdown'),
                      trailing: Text('${rows.length}', style: const TextStyle(fontSize: 12, color: T.inkFaint)),
                      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                        SingleChildScrollView(scrollDirection: Axis.horizontal, child: Row(children: [
                          for (final x in _tabs)
                            Padding(padding: const EdgeInsetsDirectional.only(end: 5), child: ChoiceChip(
                              showCheckmark: false, selected: _tab == x.$1, selectedColor: T.navy,
                              labelStyle: TextStyle(fontSize: 12, color: _tab == x.$1 ? Colors.white : T.inkSoft),
                              label: Text(tr(x.$2, x.$3)), onSelected: (_) => setState(() => _tab = x.$1))),
                        ])),
                        const SizedBox(height: 4),
                        if (_tab == 'customers')
                          Text(tr('التقييم من 100: الحجم والإيرادات وانتظام العمل وقلّة الإلغاء وحداثة آخر شحنة.', 'Score out of 100: volume, revenue, regular work, few cancellations, recency.'),
                              style: const TextStyle(fontSize: 11, color: T.inkFaint)),
                        if (rows.isEmpty) Padding(padding: const EdgeInsets.all(14), child: Text(tr('لا بيانات ضمن هذه الفلاتر', 'No data for these filters'), textAlign: TextAlign.center, style: const TextStyle(color: T.inkFaint))),
                        for (final r in rows.take(60)) _groupRow(_tab, r),
                        if (rows.length > 60) Text(tr('يظهر أوّل 60 — ضيّق الفلاتر للمزيد', 'First 60 shown — narrow the filters'), style: const TextStyle(fontSize: 11, color: T.inkFaint)),
                      ]),
                    ),
                    if (_rows('weekday').isNotEmpty)
                      SectionCard(
                        title: tr('أيام الأسبوع', 'Weekdays'),
                        child: BarList([
                          for (final w in _rows('weekday'))
                            (const ['', 'الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'][inum(w['day']).toInt().clamp(0, 7)], inum(w['live']), fmtNum(w['live'])),
                        ]),
                      ),
                    if ((d?['duration']?['trips'] ?? 0) != 0)
                      SectionCard(
                        title: tr('مدّة الرحلة', 'Trip duration'),
                        note: '${tr('المتوسط', 'Average')} ${d?['duration']?['avgHours'] ?? '—'} ${tr('ساعة', 'h')} · ${fmtNum(d?['duration']?['trips'])} ${tr('رحلة', 'trips')}',
                        child: BarList([for (final b in List.from(d?['duration']?['buckets'] ?? const [])) ('${b['key']} ${tr('ساعة', 'h')}', inum(b['n']), fmtNum(b['n']))], color: T.cyan),
                      ),
                    if (losing.isNotEmpty)
                      SectionCard(
                        title: tr('شحنات بيعُها أقلُّ من شرائها', 'Orders sold below cost'),
                        accent: T.danger,
                        child: Column(children: [
                          for (final o in losing)
                            ListTile(
                              dense: true, contentPadding: EdgeInsets.zero,
                              title: Text('${o['waybillNumber'] ?? ''} · ${o['customerName'] ?? '—'}', style: const TextStyle(fontWeight: FontWeight.w700, color: T.orange)),
                              subtitle: Text('${o['supplierName'] ?? '—'} · ${o['fromCity'] ?? '—'} ← ${o['toCity'] ?? '—'} · ${soMoney(o['sellPrice'])} / ${soMoney(o['buyPrice'])}'),
                              trailing: Text(soMoney(o['margin']), style: const TextStyle(fontWeight: FontWeight.w800, color: T.danger)),
                              onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => ShipmentOrderDetailScreen(order: o, vocab: _vocab))),
                            ),
                        ]),
                      ),
                    ],
                    const SizedBox(height: 20),
                  ]),
                ),
    );
  }
}
