import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/ht_custody_panel.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';
import 'fleet_customer_profile.dart';
import 'fleet_shipment_details.dart';
import 'ls2_vehicle_detail.dart';
import 'vehicle_registry.dart';
import 'ls2_store.dart' show storeIssueReasonLabel;

/// Analysis of one vehicle over a period, same as web screen /system/fleet/vehicles/[id]: the period is chosen and every number concerns this vehicle alone. Numbers are aggregated on the server (GET /api/fleet/vehicles/:id/analytics), not here.
class FleetVehicleAnalyticsScreen extends StatefulWidget {
  final String vehicleId;
  final String plate;
  const FleetVehicleAnalyticsScreen({super.key, required this.vehicleId, required this.plate});
  @override
  State<FleetVehicleAnalyticsScreen> createState() => _FleetVehicleAnalyticsScreenState();
}

String _money(dynamic v) {
  final n = (v is num) ? v : num.tryParse(v?.toString() ?? '') ?? 0;
  final neg = n < 0;
  final s = n.abs().round().toString();
  final b = StringBuffer();
  for (int i = 0; i < s.length; i++) {
    if (i > 0 && (s.length - i) % 3 == 0) b.write(',');
    b.write(s[i]);
  }
  return '${neg ? '-' : ''}$b';
}

num _n(dynamic v) => (v is num) ? v : num.tryParse(v?.toString() ?? '') ?? 0;

String _ymd(DateTime d) =>
    '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';

String _fmtD(dynamic v) {
  final d = v == null ? null : DateTime.tryParse(v.toString())?.toLocal();
  return d == null ? '—' : _ymd(d);
}

// The same keys as the server (resolvePeriod) literally; future ones are hidden, as on the web.
const _presets = [
  ('today', 'اليوم', 'Today'),
  ('yesterday', 'أمس', 'Yesterday'),
  ('last_7', 'آخر 7 أيام', 'Last 7 days'),
  ('this_month', 'هذا الشهر', 'This month'),
  ('last_month', 'الشهر الماضي', 'Last month'),
  ('all', 'كل الفترات', 'All time'),
];

String _presetLabel(String key) {
  for (final p in _presets) {
    if (p.$1 == key) return tr(p.$2, p.$3);
  }
  if (key == 'day') return tr('يوم محدَّد', 'Specific day');
  if (key == 'range' || key == 'month') return tr('مدى مخصَّص', 'Custom range');
  return tr('الفترة', 'Period');
}

const _statuses = {
  'requesting': ('قيد الطلب', 'Requesting', T.inkFaint),
  'loading': ('جاري التحميل', 'Loading', T.warn),
  'uploaded': ('تم التحميل', 'Uploaded', Color(0xFFCA8A04)),
  'on_way': ('في الطريق', 'On way', T.info),
  'arrived': ('وصلت', 'Arrived', Color(0xFF4F46E5)),
  'bond_sent': ('أُرسل السند', 'Bond sent', T.cyan),
  'bond_received': ('استُلم السند', 'Bond received', T.success),
  'late': ('متأخرة', 'Late', Color(0xFFEA580C)),
  'invoiced': ('تمت الفوترة', 'Invoiced', T.violet),
  'cancelled': ('ملغاة', 'Cancelled', T.danger),
};

// Vehicle register document states, REGISTRY_DOC_STATE on the web.
const _docStates = {
  'expired': ('منتهي', 'Expired', T.danger),
  'critical': ('حرج', 'Critical', Color(0xFFEA580C)),
  'warning': ('تحذير', 'Warning', T.warn),
  'upcoming': ('قريب', 'Upcoming', Color(0xFF0284C7)),
  'valid': ('ساري', 'Valid', T.success),
  'missing': ('بلا تاريخ', 'No date', T.inkFaint),
  'not_applicable': ('غير مطلوب', 'N/A', T.inkFaint),
};

class _FleetVehicleAnalyticsScreenState extends State<FleetVehicleAnalyticsScreen> {
  Map<String, dynamic>? _d;
  bool _loading = true;
  String? _error;
  // Period: a name, a day, a month or a range; only one is active (periodParams on the web).
  String _preset = 'this_month';
  String _day = '';
  String _month = '';
  String _from = '';
  String _to = '';
  int _seq = 0; // An old reply (earlier period) does not overwrite the newer.
  List<Map<String, dynamic>> _loadTypes = [];
  late final void Function() _onLive;

  @override
  void initState() {
    super.initState();
    _load();
    _loadLookups();
    _onLive = () => _load();
    Live.instance.on('fleet:updated', _onLive);
    Live.instance.on('fleet:vehicles', _onLive);
    // Identity and documents from the vehicle register, and drivers from HR.
    Live.instance.on('vreg:updated', _onLive);
    Live.instance.on('hr:employee', _onLive);
  }

  @override
  void dispose() {
    Live.instance.off('fleet:updated', _onLive);
    Live.instance.off('fleet:vehicles', _onLive);
    Live.instance.off('vreg:updated', _onLive);
    Live.instance.off('hr:employee', _onLive);
    super.dispose();
  }

  Map<String, String> get _params {
    if (_day.isNotEmpty) return {'day': _day};
    if (_from.isNotEmpty || _to.isNotEmpty) {
      return {if (_from.isNotEmpty) 'from': _from, if (_to.isNotEmpty) 'to': _to};
    }
    if (_month.isNotEmpty) return {'month': _month};
    if (_preset.isNotEmpty) return {'preset': _preset};
    return {};
  }

  Future<void> _load() async {
    final mine = ++_seq;
    try {
      final qs = Uri(queryParameters: _params).query;
      final r = await Api.instance.get('/api/fleet/vehicles/${widget.vehicleId}/analytics${qs.isEmpty ? '' : '?$qs'}');
      if (!mounted || mine != _seq) return;
      setState(() { _d = Map<String, dynamic>.from(r); _loading = false; _error = null; });
    } catch (e) {
      if (!mounted || mine != _seq) return;
      setState(() { _loading = false; _error = e is ApiException ? e.message : e.toString(); });
    }
  }

  Future<void> _loadLookups() async {
    try {
      final r = await Api.instance.get('/api/lookups?type=fleet_load_type&active=true');
      if (!mounted) return;
      setState(() => _loadTypes = List<Map<String, dynamic>>.from(r['items'] ?? const []));
    } catch (_) {/* The label falls back to the key. */}
  }

  String _loadTypeLabel(dynamic key) {
    final k = (key ?? '').toString();
    if (k.isEmpty) return '';
    final it = _loadTypes.firstWhere((x) => (x['key'] ?? '').toString() == k, orElse: () => const {});
    if (it.isEmpty) return k;
    return (Lang.instance.ar ? (it['nameAr'] ?? it['nameEn']) : (it['nameEn'] ?? it['nameAr'])).toString();
  }

  void _setPeriod({String preset = '', String day = '', String month = '', String from = '', String to = ''}) {
    setState(() {
      _preset = preset; _day = day; _month = month; _from = from; _to = to;
      _loading = _d == null;
    });
    _load();
  }

  Future<void> _pickDay() async {
    final now = DateTime.now();
    final p = await showDatePicker(
      context: context,
      initialDate: DateTime.tryParse(_day) ?? now,
      firstDate: DateTime(2020), lastDate: DateTime(now.year + 1, 12, 31),
    );
    if (p != null) _setPeriod(day: _ymd(p));
  }

  Future<void> _pickRange() async {
    final now = DateTime.now();
    final f = DateTime.tryParse(_from), t = DateTime.tryParse(_to);
    final p = await showDateRangePicker(
      context: context,
      firstDate: DateTime(2020), lastDate: DateTime(now.year + 1, 12, 31),
      initialDateRange: f != null && t != null ? DateTimeRange(start: f, end: t) : null,
    );
    if (p != null) _setPeriod(from: _ymd(p.start), to: _ymd(p.end));
  }

  Future<void> _pickMonth() async {
    final now = DateTime.now();
    final months = List.generate(24, (i) {
      final m = DateTime(now.year, now.month - i, 1);
      return '${m.year}-${m.month.toString().padLeft(2, '0')}';
    });
    final p = await showModalBottomSheet<String>(
      context: context,
      builder: (c) => SafeArea(
        child: ListView(shrinkWrap: true, children: [
          for (final m in months)
            ListTile(
              title: Text(m),
              trailing: m == _month ? const Icon(Icons.check_rounded, color: T.orange) : null,
              onTap: () => Navigator.pop(c, m),
            ),
        ]),
      ),
    );
    if (p != null) _setPeriod(month: p);
  }

  void _open(Widget w) => Navigator.push(context, MaterialPageRoute(builder: (_) => w));

  @override
  Widget build(BuildContext context) {
    return AppScaffold(
      title: Text('${tr('تحليل السيارة', 'Vehicle analysis')} — ${widget.plate}'),
      body: _loading && _d == null
          ? ListView(padding: const EdgeInsets.all(14), children: const [
              Shimmer(height: 80), SizedBox(height: 10), Shimmer(height: 44), SizedBox(height: 10),
              Shimmer(height: 160), SizedBox(height: 10), Shimmer(height: 200),
            ])
          : _error != null && _d == null
              ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
              : RefreshIndicator(onRefresh: _load, child: _body()),
    );
  }

  Widget _body() {
    final d = _d!;
    final v = Map<String, dynamic>.from(d['vehicle'] ?? const {});
    final t = Map<String, dynamic>.from(d['totals'] ?? const {});
    final period = Map<String, dynamic>.from(d['period'] ?? const {});
    final tech = d['tech'] == null ? null : Map<String, dynamic>.from(d['tech']);
    final trend = List<Map<String, dynamic>>.from(d['monthlyTrend'] ?? const []);
    final byRoute = List<Map<String, dynamic>>.from(d['byRoute'] ?? const []);
    final byCustomer = List<Map<String, dynamic>>.from(d['byCustomer'] ?? const []);
    final ships = List<Map<String, dynamic>>.from(d['shipments'] ?? const []);
    final ls2 = tech?['ls2'] == null ? null : Map<String, dynamic>.from(tech!['ls2']);
    final sub = [
      v['name'], v['trailerType'], v['gpsType'],
      if ((v['supervisorName'] ?? '').toString().isNotEmpty) '${tr('المشرف: ', 'Supervisor: ')}${v['supervisorName']}',
    ].where((x) => (x ?? '').toString().isNotEmpty).join(' · ');

    return ListView(
      padding: const EdgeInsets.all(14),
      children: [
        if (sub.isNotEmpty) ...[
          Text(sub, style: const TextStyle(fontSize: 12.5, color: T.inkSoft, fontWeight: FontWeight.w600)),
          const SizedBox(height: 10),
        ],
        if (_error != null) ...[
          Text(_error!, style: const TextStyle(fontSize: 12, color: T.danger)),
          const SizedBox(height: 8),
        ],

        _registryCard(v),
        const SizedBox(height: 10),
        _nowCard(v),
        const SizedBox(height: 10),

        // Period.
        _periodBar(),
        const SizedBox(height: 8),
        _periodBanner(period, _n(t['trips']).toInt()),
        const SizedBox(height: 10),

        // Indicator cards.
        GridView.count(
          crossAxisCount: 2,
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          childAspectRatio: 1.9,
          mainAxisSpacing: 8,
          crossAxisSpacing: 8,
          children: [
            _tile(tr('عدد الرحلات', 'Trips'), '${t['trips'] ?? 0}', T.orange, Icons.route_outlined),
            _tile(tr('الدخل (سعر البيع)', 'Income'), _money(t['income']), T.success, Icons.payments_outlined),
            _tile(tr('مصروف السائقين', 'Driver expense'), _money(t['driverExpense']), T.warn, Icons.account_balance_wallet_outlined),
            _tile(tr('الصافي', 'Net'), _money(t['net']), T.navy, Icons.calculate_outlined),
            _tile(tr('متوسط دخل الرحلة', 'Avg / trip'), _money(t['avgTripIncome']), T.info, Icons.trending_up_rounded),
          ],
        ),
        const SizedBox(height: 10),

        _targetCard(t, period),
        const SizedBox(height: 10),

        if (tech != null && (ls2 != null || _n(tech['partsCount']) > 0 || _n(tech['mountedTires']) > 0)) ...[
          _techCard(tech, ls2),
          const SizedBox(height: 10),
        ],

        if (trend.isNotEmpty) ...[
          _section(tr('أداء السيارة خلال آخر 12 شهرًا', 'Last 12 months')),
          AppCard(child: _trendBars(trend)),
          const SizedBox(height: 14),
        ],

        _section(tr('المسارات التي سارتها', 'Routes travelled')),
        if (byRoute.isEmpty) _dash(),
        ...byRoute.map((r) => _breakRow(
              '${r['fromCity'] ?? '—'} ← ${r['toCity'] ?? '—'}', r, null)),
        const SizedBox(height: 14),

        _section(tr('العملاء الذين نقلت لهم', 'Customers served')),
        if (byCustomer.isEmpty) _dash(),
        ...byCustomer.map((c) {
          final cid = (c['_id'] ?? '').toString();
          return _breakRow((c['name'] ?? '—').toString(), c,
              cid.isEmpty ? null : () => _open(FleetCustomerProfileScreen(customerId: cid)));
        }),
        const SizedBox(height: 14),

        Row(children: [
          Expanded(child: _section('${tr('رحلات السيارة في هذه الفترة', 'Trips in this period')} (${ships.length})')),
        ]),
        if (d['truncated'] == true)
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: Chip2(tr('المعروض مقتطع — المجاميع أعلاه كاملة', 'Rows truncated — totals above are complete'), T.warn),
          ),
        if (ships.isEmpty)
          EmptyState(icon: Icons.route_outlined, title: tr('لا رحلات لهذه السيارة ضمن الفترة المختارة.', 'No trips for this vehicle in the selected period.')),
        ...ships.map(_tripRow),

        // Heavy transport custody on this truck, like the web, once its Location Solutions unit is known.
        if (ls2?['unitId'] != null) ...[
          const SizedBox(height: 14),
          HtCustodyPanel(vehicleUnitId: '${ls2!['unitId']}'),
        ],
        const SizedBox(height: 24),
      ],
    );
  }

  // Identity and documents from the vehicle register.
  Widget _registryCard(Map<String, dynamic> v) {
    final reg = v['registry'] == null ? null : Map<String, dynamic>.from(v['registry']);
    if (reg == null) {
      return AppCard(
        padding: const EdgeInsets.all(12),
        child: Text(tr('هذه السيارة غير مربوطة بسجل المركبات بعد.', 'This vehicle is not linked to the vehicle registry yet.'),
            style: const TextStyle(fontSize: 12, color: T.warn)),
      );
    }
    final docs = List<Map<String, dynamic>>.from(reg['docs'] ?? const []);
    final fields = [
      (tr('اللوحة في السجل', 'Registry plate'), reg['plateNumber']),
      (tr('الماركة', 'Brand'), reg['brand']),
      (tr('الطراز', 'Model'), reg['model']),
      (tr('سنة الصنع', 'Year'), reg['year']),
      (tr('اللون', 'Colour'), reg['color']),
      (tr('رقم الهيكل', 'Chassis'), reg['chassis']),
    ];
    final regId = (reg['_id'] ?? '').toString();
    return AppCard(
      padding: const EdgeInsets.all(12),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Wrap(spacing: 14, runSpacing: 4, children: [
          for (final f in fields)
            Text.rich(TextSpan(children: [
              TextSpan(text: '${f.$1}: ', style: const TextStyle(fontSize: 11, color: T.inkFaint)),
              TextSpan(text: (f.$2 ?? '').toString().isEmpty ? '—' : f.$2.toString(),
                  style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: T.ink)),
            ])),
        ]),
        if (regId.isNotEmpty)
          Align(
            alignment: AlignmentDirectional.centerStart,
            child: TextButton.icon(
              style: TextButton.styleFrom(foregroundColor: T.orange, padding: EdgeInsets.zero, visualDensity: VisualDensity.compact),
              onPressed: () => _open(VehicleRegistryDetailScreen(id: regId, plate: (reg['plateNumber'] ?? widget.plate).toString())),
              icon: const Icon(Icons.open_in_new_rounded, size: 14),
              label: Text(tr('فتح في سجل المركبات', 'Open in vehicle registry'), style: const TextStyle(fontSize: 12)),
            ),
          ),
        if (docs.isNotEmpty)
          Wrap(spacing: 6, runSpacing: 6, children: [
            for (final doc in docs) () {
              final st = _docStates[doc['state']] ?? _docStates['missing']!;
              final days = doc['days'];
              return Chip2(
                '${tr((doc['ar'] ?? '').toString(), (doc['en'] ?? '').toString())}: '
                '${doc['expiryDate'] != null ? _fmtD(doc['expiryDate']) : '—'} · ${tr(st.$1, st.$2)}'
                '${days != null && doc['state'] != 'valid' ? ' ($days ${tr('يوم', 'd')})' : ''}',
                st.$3,
              );
            }(),
          ]),
      ]),
    );
  }

  // Vehicle state now: the analysis concerns a past period, and this line concerns the moment.
  Widget _nowCard(Map<String, dynamic> v) {
    final drivers = List<Map<String, dynamic>>.from(v['drivers'] ?? const []);
    final trip = v['currentTrip'] == null ? null : Map<String, dynamic>.from(v['currentTrip']);
    return AppCard(
      padding: const EdgeInsets.all(12),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Wrap(spacing: 6, runSpacing: 6, crossAxisAlignment: WrapCrossAlignment.center, children: [
          const Icon(Icons.people_outline, size: 16, color: T.inkFaint),
          Text(tr('السائقون:', 'Drivers:'), style: const TextStyle(fontSize: 11.5, color: T.inkFaint)),
          if (drivers.isEmpty) Chip2(tr('بدون سائق', 'No driver'), T.danger),
          for (final x in drivers)
            Chip2('${x['name'] ?? ''}${x['working'] == false ? tr(' · لا يعمل', ' · off') : ''}',
                x['working'] == false ? T.warn : T.inkSoft),
        ]),
        const SizedBox(height: 8),
        Row(children: [
          const Icon(Icons.route_outlined, size: 16, color: T.inkFaint),
          const SizedBox(width: 6),
          Text(tr('الآن:', 'Now:'), style: const TextStyle(fontSize: 11.5, color: T.inkFaint)),
          const SizedBox(width: 6),
          if (trip == null)
            Chip2(tr('فاضية — بدون حمولة', 'Idle — no load'), T.inkSoft)
          else
            Expanded(
              child: InkWell(
                onTap: () => _open(FleetShipmentDetailsScreen(shipmentId: (trip['_id'] ?? '').toString())),
                child: Text(
                  '${tr('أمر نقل', 'WB')} ${trip['waybillNumber'] ?? ''} → ${trip['toCity'] ?? '—'}'
                  '${trip['expectedArrival'] != null ? ' · ${tr('متوقع', 'ETA')} ${_fmtDT(trip['expectedArrival'])}' : ''}',
                  style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700, color: T.orange),
                ),
              ),
            ),
        ]),
      ]),
    );
  }

  String _fmtDT(dynamic v) {
    final d = v == null ? null : DateTime.tryParse(v.toString())?.toLocal();
    if (d == null) return '—';
    return '${_ymd(d)} ${d.hour.toString().padLeft(2, '0')}:${d.minute.toString().padLeft(2, '0')}';
  }

  Widget _periodBar() {
    final custom = _day.isNotEmpty || _month.isNotEmpty || _from.isNotEmpty || _to.isNotEmpty;
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      child: Row(children: [
        for (final p in _presets)
          _chip(tr(p.$2, p.$3), !custom && _preset == p.$1, () => _setPeriod(preset: p.$1)),
        _chip(_day.isNotEmpty ? _day : tr('يوم بعينه', 'A day'), _day.isNotEmpty, _pickDay, icon: Icons.today_outlined),
        _chip(_month.isNotEmpty ? _month : tr('شهر', 'Month'), _month.isNotEmpty, _pickMonth, icon: Icons.calendar_month_outlined),
        _chip(_from.isNotEmpty || _to.isNotEmpty ? '$_from → $_to' : tr('من — إلى', 'Range'),
            _from.isNotEmpty || _to.isNotEmpty, _pickRange, icon: Icons.date_range_outlined),
      ]),
    );
  }

  Widget _chip(String label, bool sel, VoidCallback onTap, {IconData? icon}) => Padding(
        padding: const EdgeInsetsDirectional.only(end: 6),
        child: FilterChip(
          selected: sel,
          showCheckmark: icon == null,
          avatar: icon == null ? null : Icon(icon, size: 15, color: sel ? Colors.white : T.navy),
          onSelected: (_) => onTap(),
          label: Text(label),
          labelStyle: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: sel ? Colors.white : T.navy),
          selectedColor: T.orange,
          backgroundColor: T.navy.withValues(alpha: 0.08),
          checkmarkColor: Colors.white,
          side: BorderSide.none,
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
        ),
      );

  /// The period decided by the server, not the one the screen assumed (PeriodBanner on the web). The range end is exclusive on the server, so a day is subtracted when displayed.
  Widget _periodBanner(Map<String, dynamic> p, int count) {
    final from = DateTime.tryParse((p['from'] ?? '').toString());
    if (from == null) return const SizedBox.shrink();
    final to = DateTime.tryParse((p['to'] ?? '').toString());
    final isAll = p['preset'] == 'all';
    final toShown = to?.subtract(const Duration(milliseconds: 1));
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
      decoration: BoxDecoration(
        color: T.warn.withValues(alpha: 0.07),
        border: Border.all(color: T.warn.withValues(alpha: 0.3)),
        borderRadius: BorderRadius.circular(10),
      ),
      child: Row(children: [
        const Icon(Icons.date_range_outlined, size: 15, color: T.warn),
        const SizedBox(width: 6),
        Text(_presetLabel((p['preset'] ?? '').toString()), style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w800)),
        if (!isAll) ...[
          const SizedBox(width: 6),
          Flexible(child: Text('${_fmtD(from.toIso8601String())} → ${toShown == null ? '' : _fmtD(toShown.toIso8601String())}',
              style: const TextStyle(fontSize: 11.5, color: T.inkSoft), overflow: TextOverflow.ellipsis)),
        ],
        const Spacer(),
        Text(tr('$count نتيجة', '$count results'), style: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.w700, color: T.inkSoft)),
      ]),
    );
  }

  // The target scaled by the number of months in the period, not one month.
  Widget _targetCard(Map<String, dynamic> t, Map<String, dynamic> period) {
    final pct = t['achievedPct'];
    final achieved = t['achieved'] == true;
    final months = _n(period['monthsInRange']) == 0 ? 1 : _n(period['monthsInRange']);
    final c = achieved ? T.success : T.orange;
    return AppCard(
      padding: const EdgeInsets.all(12),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          const Icon(Icons.track_changes_rounded, size: 16, color: T.orange),
          const SizedBox(width: 6),
          Text(tr('مقابل الهدف', 'Against target'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13.5)),
          const Spacer(),
          if (pct != null) Chip2('$pct%', achieved ? T.success : T.danger),
        ]),
        const SizedBox(height: 4),
        Text(
          tr('الهدف الشهري ${_money(t['monthlyTarget'])} × $months شهر = ${_money(t['periodTarget'])}',
              '${_money(t['monthlyTarget'])} / month × $months = ${_money(t['periodTarget'])}'),
          style: const TextStyle(fontSize: 11.5, color: T.inkFaint),
        ),
        const SizedBox(height: 8),
        ClipRRect(
          borderRadius: BorderRadius.circular(8),
          child: LinearProgressIndicator(
            minHeight: 10,
            value: pct is num ? (pct / 100).clamp(0.0, 1.0).toDouble() : 0,
            backgroundColor: T.navy.withValues(alpha: 0.07),
            valueColor: AlwaysStoppedAnimation(c),
          ),
        ),
      ]),
    );
  }

  // Technical state: Location Solutions and the heavy transport store.
  Widget _techCard(Map<String, dynamic> tech, Map<String, dynamic>? ls2) {
    final ms = ls2?['maintenanceStatus'];
    final Color border = ms == 'overdue' ? T.danger : (ms == 'due' ? T.warn : T.line);
    final msLabel = ls2 == null
        ? '—'
        : ms == 'overdue' ? tr('متأخّرة', 'Overdue') : ms == 'due' ? tr('مستحقّة', 'Due') : tr('سليمة', 'OK');
    final msColor = ms == 'overdue' ? T.danger : ms == 'due' ? T.warn : T.success;
    final repairs = List<Map<String, dynamic>>.from(tech['openRepairs'] ?? const []);
    final parts = List<Map<String, dynamic>>.from(tech['partsIssued'] ?? const []);
    final services = List<Map<String, dynamic>>.from(tech['recentServices'] ?? const []);
    final unitId = ls2?['unitId'];

    Widget cell(String label, String value, {Color color = T.ink, String? hint}) => Container(
          padding: const EdgeInsets.all(10),
          decoration: BoxDecoration(color: Colors.white, border: Border.all(color: T.line), borderRadius: BorderRadius.circular(10)),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
            Text(label, style: const TextStyle(fontSize: 10.5, color: T.inkFaint)),
            const SizedBox(height: 2),
            Text(value, style: TextStyle(fontSize: 13, fontWeight: FontWeight.w800, color: color)),
            if (hint != null && hint.isNotEmpty)
              Text(hint, style: const TextStyle(fontSize: 10, color: T.inkFaint), overflow: TextOverflow.ellipsis),
          ]),
        );

    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: ms == 'overdue' ? T.danger.withValues(alpha: 0.04) : ms == 'due' ? T.warn.withValues(alpha: 0.04) : T.card,
        border: Border.all(color: border),
        borderRadius: BorderRadius.circular(16),
      ),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          const Icon(Icons.build_outlined, size: 16, color: T.inkFaint),
          const SizedBox(width: 6),
          Expanded(child: Text(tr('الحالة الفنّية — لوكيشن سوليوشن والمخزن', 'Technical state — Location Solutions & store'),
              style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13))),
          if (unitId != null)
            IconButton(
              tooltip: tr('فتحها في لوكيشن سوليوشن', 'Open in Location Solutions'),
              icon: const Icon(Icons.open_in_new_rounded, size: 18, color: T.cyan),
              onPressed: () => _open(Ls2VehicleDetailScreen(vehicleId: '$unitId', plate: (ls2?['plate'] ?? widget.plate).toString())),
            ),
        ]),
        const SizedBox(height: 8),
        Wrap(spacing: 8, runSpacing: 8, children: [
          cell(tr('الصيانة', 'Maintenance'), msLabel, color: ls2 == null ? T.ink : msColor),
          cell(tr('المتبقّي للصيانة', 'Km to service'),
              ls2?['kmToService'] != null ? '${_money(ls2!['kmToService'])} ${tr('كم', 'km')}' : '—',
              hint: (ls2?['nextServiceName'] ?? '').toString()),
          cell(tr('العدّاد', 'Odometer'), ls2?['odometerKm'] != null ? _money(ls2!['odometerKm']) : '—'),
          cell(tr('إطاراتٌ مركّبة', 'Mounted tyres'), _n(tech['mountedTires']) > 0 ? '${tech['mountedTires']}' : '—'),
          cell(tr('إصلاحاتٌ مفتوحة', 'Open repairs'), repairs.isEmpty ? '—' : '${repairs.length}',
              color: repairs.isEmpty ? T.ink : T.danger),
        ]),
        if (parts.isNotEmpty) ...[
          const SizedBox(height: 10),
          Text(tr('قطعٌ صُرفت عليها من المخزن (${tech['partsCount'] ?? parts.length})', 'Parts issued from the store (${tech['partsCount'] ?? parts.length})'),
              style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w800, color: T.inkSoft)),
          const SizedBox(height: 4),
          for (final m in parts.take(20))
            // The reason for the issue beside the part: periodic maintenance / accident / preventive / breakdown on the road.
            _kv(
              '${m['itemName'] ?? ''}${storeIssueReasonLabel(m['issueReason']).isNotEmpty ? ' — ${storeIssueReasonLabel(m['issueReason'])}' : ''}',
              '×${m['quantity'] ?? ''} · ${_fmtD((m['date'] ?? '').toString().isNotEmpty ? m['date'] : m['createdAt'])}${(m['issueRequestNo'] ?? '').toString().isNotEmpty ? ' · ${m['issueRequestNo']}' : ''}',
            ),
        ],
        if (services.isNotEmpty) ...[
          const SizedBox(height: 10),
          Text(tr('آخر الصيانات', 'Recent services'), style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w800, color: T.inkSoft)),
          const SizedBox(height: 4),
          for (final sv in services)
            _kv(
              '${List<Map<String, dynamic>>.from(sv['items'] ?? const []).where((i) => i['status'] == 'done').length} ${tr('بندًا', 'items')}'
              '${(sv['byName'] ?? '').toString().isNotEmpty ? ' · ${sv['byName']}' : ''}',
              _fmtD(sv['createdAt']),
            ),
        ],
      ]),
    );
  }

  Widget _kv(String k, String v) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 2),
        child: Row(children: [
          Expanded(child: Text(k, style: const TextStyle(fontSize: 11.5, color: T.inkSoft), overflow: TextOverflow.ellipsis)),
          const SizedBox(width: 8),
          Text(v, style: const TextStyle(fontSize: 11, color: T.inkFaint)),
        ]),
      );

  /// 12-month trend: income and expense bars per month with trip count beside them, with no chart library.
  Widget _trendBars(List<Map<String, dynamic>> trend) {
    final maxV = trend.fold<double>(1, (m, r) {
      final a = _n(r['income']).toDouble(), b = _n(r['driverExpense']).toDouble();
      return [m, a, b].reduce((x, y) => x > y ? x : y);
    });
    Widget bar(double v, Color c) {
      final frac = (v / maxV).clamp(0.0, 1.0);
      return Stack(children: [
        Container(height: 9, decoration: BoxDecoration(color: T.navy.withValues(alpha: 0.05), borderRadius: BorderRadius.circular(5))),
        FractionallySizedBox(
          widthFactor: frac == 0 ? 0.01 : frac,
          child: Container(height: 9, decoration: BoxDecoration(color: c, borderRadius: BorderRadius.circular(5))),
        ),
      ]);
    }

    return Column(children: [
      Row(children: [
        _legend(T.orange, tr('الدخل', 'Income')),
        const SizedBox(width: 12),
        _legend(const Color(0xFFF59E0B), tr('المصروف', 'Expense')),
        const SizedBox(width: 12),
        _legend(T.info, tr('الرحلات', 'Trips')),
      ]),
      const SizedBox(height: 8),
      for (final r in trend)
        Padding(
          padding: const EdgeInsets.symmetric(vertical: 4),
          child: Row(children: [
            SizedBox(
              width: 46,
              child: Text(() {
                final m = (r['month'] ?? '').toString();
                return m.length >= 7 ? m.substring(2) : m;
              }(), style: const TextStyle(fontSize: 11, color: T.inkFaint)),
            ),
            Expanded(
              child: Column(children: [
                bar(_n(r['income']).toDouble(), T.orange),
                const SizedBox(height: 2),
                bar(_n(r['driverExpense']).toDouble(), const Color(0xFFF59E0B)),
              ]),
            ),
            const SizedBox(width: 8),
            SizedBox(
              width: 70,
              child: Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
                Text(_money(r['income']), style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w800)),
                Text('${r['trips'] ?? 0} ${tr('رحلة', 'trips')}', style: const TextStyle(fontSize: 10, color: T.info, fontWeight: FontWeight.w700)),
              ]),
            ),
          ]),
        ),
    ]);
  }

  Widget _legend(Color c, String label) => Row(mainAxisSize: MainAxisSize.min, children: [
        Container(width: 10, height: 10, decoration: BoxDecoration(color: c, borderRadius: BorderRadius.circular(3))),
        const SizedBox(width: 4),
        Text(label, style: const TextStyle(fontSize: 11, color: T.inkSoft)),
      ]);

  Widget _section(String t) => Padding(
        padding: const EdgeInsets.only(bottom: 8),
        child: Text(t, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
      );

  Widget _dash() => const Padding(
        padding: EdgeInsets.symmetric(vertical: 6),
        child: Center(child: Text('—', style: TextStyle(color: T.inkFaint))),
      );

  Widget _tile(String label, String value, Color color, IconData icon) => AppCard(
        padding: const EdgeInsets.all(12),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Container(
            padding: const EdgeInsets.all(6),
            decoration: BoxDecoration(color: color.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(10)),
            child: Icon(icon, size: 16, color: color),
          ),
          const Spacer(),
          FittedBox(fit: BoxFit.scaleDown, alignment: AlignmentDirectional.centerStart,
              child: Text(value, style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800, color: color, height: 1))),
          const SizedBox(height: 2),
          Text(label, style: const TextStyle(fontSize: 10.5, color: T.inkSoft, fontWeight: FontWeight.w600), overflow: TextOverflow.ellipsis),
        ]),
      );

  /// Detail row (route or customer): name, trips, income, expense.
  Widget _breakRow(String name, Map<String, dynamic> r, VoidCallback? onTap) => Padding(
        padding: const EdgeInsets.only(bottom: 6),
        child: Pressable(
          onTap: onTap,
          child: AppCard(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
            child: Row(children: [
              Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(name, style: TextStyle(fontWeight: FontWeight.w700, fontSize: 13, color: onTap != null ? T.orange : T.ink)),
                Text('${r['trips'] ?? 0} ${tr('رحلة', 'trips')} · ${tr('المصروف', 'Expense')} ${_money(r['driverExpense'])}',
                    style: const TextStyle(fontSize: 11, color: T.inkFaint)),
              ])),
              Text(_money(r['income']), style: const TextStyle(fontWeight: FontWeight.w800, color: T.success)),
              if (onTap != null) Icon(Lang.instance.ar ? Icons.chevron_left : Icons.chevron_right, color: T.inkFaint, size: 18),
            ]),
          ),
        ),
      );

  Widget _tripRow(Map<String, dynamic> s) {
    final st = _statuses[s['status']];
    final id = (s['_id'] ?? '').toString();
    final drivers = [s['driverName'], s['secondDriverName']].where((x) => (x ?? '').toString().isNotEmpty).join(' + ');
    final lt = _loadTypeLabel(s['loadType']);
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Pressable(
        onTap: id.isEmpty ? null : () => _open(FleetShipmentDetailsScreen(shipmentId: id)),
        child: AppCard(
          padding: const EdgeInsets.all(12),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(children: [
              Text('${tr('أمر نقل', 'WB')} ${s['waybillNumber'] ?? ''}', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13.5)),
              const SizedBox(width: 8),
              Text(_fmtD(s['loadDate'] ?? s['createdAt']), style: const TextStyle(fontSize: 11, color: T.inkFaint)),
              const Spacer(),
              Chip2(st == null ? (s['status'] ?? '—').toString() : tr(st.$1, st.$2), st?.$3 ?? T.inkSoft),
            ]),
            const SizedBox(height: 4),
            Text('${s['fromCity'] ?? '—'} ← ${s['toCity'] ?? '—'}', style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600)),
            if ((s['customerName'] ?? '').toString().isNotEmpty)
              Text(s['customerName'].toString(), style: const TextStyle(fontSize: 11.5, color: T.inkSoft), overflow: TextOverflow.ellipsis),
            if (drivers.isNotEmpty || lt.isNotEmpty)
              Text([drivers, lt].where((x) => x.isNotEmpty).join(' · '),
                  style: const TextStyle(fontSize: 11, color: T.inkFaint), overflow: TextOverflow.ellipsis),
            const SizedBox(height: 6),
            Row(children: [
              Text('${tr('سعر البيع', 'Selling')} ${_money(s['price'])}',
                  style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: T.success)),
              const Spacer(),
              Text('${tr('مصروف السائق', 'Driver exp.')} ${_money(s['driverExpense'])}',
                  style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w800, color: T.warn)),
            ]),
          ]),
        ),
      ),
    );
  }
}
