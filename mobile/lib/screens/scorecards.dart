import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../ui/app_scaffold.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';
import 'reports.dart';

/// بطاقات التقييم — the mobile side of the four scorecards the web grew:
///
///   • تقييم أداء السائقين (لوكيشن سوليوشن) — from telemetry: عدد الرحلات،
///     مدة الوصول، مدة التحميل، أيام العمل، المسافة، السرعة.
///   • تقييم أداء السائقين (إدارة الأسطول) — from the loads they carried.
///   • مؤشرات العملاء / الموردين (CRM).
///
/// They all return the same shape — a 0–100 `score`, a coloured band, and a
/// weighted `breakdown` — so one widget set renders all four and only the row
/// summary line differs per kind.

Color _hex(String? s, [Color fallback = T.inkFaint]) {
  if (s == null || !s.startsWith('#') || s.length != 7) return fallback;
  return Color(int.parse('FF${s.substring(1)}', radix: 16));
}

num _n(dynamic v) => v is num ? v : 0;
String _num(dynamic v) => v == null ? '—' : _n(v).round().toString();

/// The 0–100 bar every row shows.
class _ScoreBar extends StatelessWidget {
  final num value;
  final Color color;
  const _ScoreBar(this.value, this.color);
  @override
  Widget build(BuildContext context) {
    final v = (value.toDouble() / 100).clamp(0.0, 1.0);
    return ClipRRect(
      borderRadius: BorderRadius.circular(4),
      child: LinearProgressIndicator(
        value: v, minHeight: 5,
        backgroundColor: T.line,
        valueColor: AlwaysStoppedAnimation(color),
      ),
    );
  }
}

/// The "why is the score what it is" panel, shared by every scorecard sheet.
class _Breakdown extends StatelessWidget {
  final List items;
  final Color color;
  const _Breakdown(this.items, this.color);
  @override
  Widget build(BuildContext context) {
    if (items.isEmpty) {
      return Text(tr('لا توجد بيانات كافية للتقييم', 'Not enough data to score'),
          style: const TextStyle(fontSize: 12, color: T.inkFaint));
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: items.map<Widget>((raw) {
        final b = Map<String, dynamic>.from(raw as Map);
        final weight = b['weightPct'] ?? b['weight'];
        return Padding(
          padding: const EdgeInsets.only(bottom: 10),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(children: [
              Expanded(
                child: Text('${tr(b['ar'] ?? '', b['en'] ?? '')}  ($weight%)',
                    style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700)),
              ),
              Text(_num(b['value']), style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w800)),
            ]),
            const SizedBox(height: 4),
            _ScoreBar(_n(b['value']), color),
          ]),
        );
      }).toList(),
    );
  }
}

Widget _bandChip(Map<String, dynamic> row) {
  final color = _hex(row['bandColor'] as String?);
  return Chip2('${_num(row['score'])} · ${tr(row['bandAr'] ?? '', row['bandEn'] ?? '')}', color);
}

// ─────────────────────────────────────────────────────────────────────────────
// تقييم أداء السائقين — لوكيشن سوليوشن (من بيانات التتبّع)
// ─────────────────────────────────────────────────────────────────────────────
class Ls2DriverPerformanceScreen extends StatefulWidget {
  const Ls2DriverPerformanceScreen({super.key});
  @override
  State<Ls2DriverPerformanceScreen> createState() => _Ls2DriverPerformanceScreenState();
}

class _Ls2DriverPerformanceScreenState extends State<Ls2DriverPerformanceScreen> {
  List<Map<String, dynamic>> _rows = [];
  Map<String, dynamic> _summary = {};
  bool _loading = true;
  bool _deep = false;
  String? _error;
  String _q = '';

  @override
  void initState() { super.initState(); _load(); }

  Future<void> _load() async {
    try {
      final d = await Api.instance.get('/api/ls2/drivers/performance${_deep ? '?deep=1' : ''}');
      if (!mounted) return;
      setState(() {
        _rows = List<Map<String, dynamic>>.from(d['items'] ?? []);
        _summary = Map<String, dynamic>.from(d['summary'] ?? {});
        _loading = false; _error = null;
      });
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  /// One driver's full card is ALWAYS deep — the trip report runs for their
  /// trucks on open, which is why the list keeps it opt-in.
  Future<void> _open(Map<String, dynamic> row) async {
    final name = (row['driver'] ?? '').toString();
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (c) => FutureBuilder<dynamic>(
        future: Api.instance.get('/api/ls2/drivers/performance/${Uri.encodeComponent(name)}'),
        builder: (c, snap) {
          final d = snap.hasData ? Map<String, dynamic>.from(snap.data as Map) : row;
          final metrics = d['metrics'] is Map ? Map<String, dynamic>.from(d['metrics'] as Map) : null;
          return SafeArea(
            child: SizedBox(
              height: MediaQuery.of(c).size.height * 0.78,
              child: ListView(padding: const EdgeInsets.all(18), children: [
                Row(children: [
                  Expanded(child: Text(name, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16))),
                  IconButton(
                    tooltip: tr('تقرير السائق (PDF)', 'Driver report (PDF)'),
                    icon: const Icon(Icons.assessment_outlined, size: 20, color: T.orange),
                    onPressed: () => Navigator.push(c, MaterialPageRoute(builder: (_) => ReportsScreen(
                      subject: 'driver', entityId: name, entityName: name))),
                  ),
                ]),
                const SizedBox(height: 8),
                Wrap(spacing: 6, runSpacing: 6, children: [
                  _bandChip(Map<String, dynamic>.from(d)),
                  Chip2('${_num(d['km'])} ${tr('كم', 'km')}', T.violet),
                  Chip2('${tr('أيام عمل', 'Active days')}: ${d['activeDays'] ?? 0}/${d['periodDays'] ?? 0}', T.info),
                ]),
                if (snap.connectionState == ConnectionState.waiting) ...[
                  const SizedBox(height: 18),
                  const Shimmer(height: 60),
                  const SizedBox(height: 8),
                  Text(tr('جارٍ قراءة تقارير الرحلات…', 'Reading the trip reports…'),
                      style: const TextStyle(fontSize: 12, color: T.inkFaint)),
                ],
                if (metrics != null) ...[
                  const SizedBox(height: 14),
                  Wrap(spacing: 6, runSpacing: 6, children: [
                    Chip2('${tr('رحلات', 'Trips')}: ${_num(metrics['tripCount'])}', T.navy),
                    Chip2('${tr('متوسط الرحلة', 'Avg trip')}: ${metrics['avgTripHours'] ?? '—'}${tr('س', 'h')}', T.cyan),
                    Chip2('${tr('متوسط التحميل', 'Avg loading')}: ${metrics['avgLoadingHours'] ?? '—'}${tr('س', 'h')}', T.warn),
                    Chip2('${tr('أطول انتظار', 'Longest wait')}: ${metrics['longestLoadingHours'] ?? '—'}${tr('س', 'h')}', T.danger),
                    Chip2('${tr('ساعات القيادة', 'Driving')}: ${metrics['drivingHours'] ?? '—'}${tr('س', 'h')}', T.success),
                    Chip2('${tr('أقصى سرعة', 'Max speed')}: ${_num(metrics['maxSpeed'])}', T.violet),
                  ]),
                ],
                const SizedBox(height: 18),
                Text(tr('تفصيل التقييم', 'Score breakdown'),
                    style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14)),
                const SizedBox(height: 10),
                _Breakdown(List.from(d['breakdown'] ?? row['breakdown'] ?? []), _hex(d['bandColor'] as String?)),
                if ((d['stops'] as List?)?.isNotEmpty ?? false) ...[
                  const SizedBox(height: 10),
                  Text(tr('أطول فترات التوقف (تحميل/انتظار)', 'Longest stops (loading / waiting)'),
                      style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14)),
                  const SizedBox(height: 6),
                  ...List.from(d['stops']).take(6).map((raw) {
                    final s = Map<String, dynamic>.from(raw as Map);
                    final h = (_n(s['durationSec']) / 3600).toStringAsFixed(1);
                    return Padding(
                      padding: const EdgeInsets.only(bottom: 6),
                      child: Row(children: [
                        Expanded(child: Text((s['location'] ?? '—').toString(),
                            style: const TextStyle(fontSize: 12.5), overflow: TextOverflow.ellipsis)),
                        Chip2('$h${tr('س', 'h')}', T.warn),
                      ]),
                    );
                  }),
                ],
              ]),
            ),
          );
        },
      ),
    );
  }

  String _fold(String s) => s.replaceAll(RegExp('[أإآ]'), 'ا').replaceAll('ى', 'ي').replaceAll('ة', 'ه').toLowerCase();

  @override
  Widget build(BuildContext context) {
    final q = _fold(_q.trim());
    final rows = _rows.where((r) => q.isEmpty || _fold((r['driver'] ?? '').toString()).contains(q)).toList();

    return AppScaffold(
      title: Text(tr('تقييم السواقين', 'Driver performance')),
      body: _loading
          ? ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(height: 70), SizedBox(height: 10), Shimmer(), SizedBox(height: 10), Shimmer()])
          : _error != null
              ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
              : Column(children: [
                  Padding(
                    padding: const EdgeInsets.fromLTRB(14, 12, 14, 6),
                    child: Row(children: [
                      Expanded(child: StatCard(label: tr('متوسط التقييم', 'Avg score'), value: _n(_summary['averageScore']), color: T.success, icon: Icons.speed_outlined)),
                      const SizedBox(width: 8),
                      Expanded(child: StatCard(label: tr('ممتاز', 'Excellent'), value: _n(_summary['excellent']), color: T.info, icon: Icons.emoji_events_outlined)),
                      const SizedBox(width: 8),
                      Expanded(child: StatCard(label: tr('يحتاج تحسين', 'Needs work'), value: _n(_summary['weak']), color: T.danger, icon: Icons.warning_amber_outlined)),
                    ]),
                  ),
                  // The deep pass runs one trip report per truck — never implicit.
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 14),
                    child: SwitchListTile.adaptive(
                      contentPadding: EdgeInsets.zero,
                      dense: true,
                      value: _deep,
                      onChanged: (v) { setState(() { _deep = v; _loading = true; }); _load(); },
                      title: Text(tr('التحليل التفصيلي (تقارير الرحلات)', 'Detailed analysis (trip reports)'),
                          style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700)),
                      subtitle: Text(
                        _deep
                            ? tr('يقيس عدد الرحلات ومدة الوصول ومدة التحميل لكل سائق.', 'Measures trips, delivery time and loading time for every driver.')
                            : tr('الوضع السريع: المسافة وأيام العمل. افتح أي سائق لبطاقته الكاملة.', 'Quick mode: distance and working days. Open a driver for their full card.'),
                        style: const TextStyle(fontSize: 11, color: T.inkSoft),
                      ),
                    ),
                  ),
                  Padding(
                    padding: const EdgeInsets.fromLTRB(14, 4, 14, 4),
                    child: TextField(
                      onChanged: (v) => setState(() => _q = v),
                      decoration: InputDecoration(hintText: tr('ابحث عن السائق…', 'Search driver…'), prefixIcon: const Icon(Icons.search), suffixText: '${rows.length}'),
                    ),
                  ),
                  Expanded(
                    child: RefreshIndicator(
                      onRefresh: _load,
                      child: ListView.builder(
                        padding: const EdgeInsets.fromLTRB(14, 4, 14, 20),
                        itemCount: rows.length,
                        itemBuilder: (c, i) {
                          final r = rows[i];
                          final color = _hex(r['bandColor'] as String?);
                          return Padding(
                            padding: const EdgeInsets.only(bottom: 10),
                            child: Pressable(
                              onTap: () => _open(r),
                              child: AppCard(
                                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                  Row(children: [
                                    Expanded(child: Text((r['driver'] ?? '').toString(), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14))),
                                    _bandChip(r),
                                  ]),
                                  const SizedBox(height: 8),
                                  _ScoreBar(_n(r['score']), color),
                                  const SizedBox(height: 8),
                                  Wrap(spacing: 6, runSpacing: 6, children: [
                                    if (r['trips'] != null) Chip2('${tr('رحلات', 'Trips')}: ${_num(r['trips'])}', T.navy),
                                    if (r['avgTripHours'] != null) Chip2('${tr('مدة الوصول', 'Delivery')}: ${r['avgTripHours']}${tr('س', 'h')}', T.cyan),
                                    if (r['avgLoadingHours'] != null) Chip2('${tr('التحميل', 'Loading')}: ${r['avgLoadingHours']}${tr('س', 'h')}', T.warn),
                                    Chip2('${_num(r['km'])} ${tr('كم', 'km')}', T.violet),
                                    Chip2('${tr('أيام', 'Days')}: ${r['activeDays'] ?? 0}/${r['periodDays'] ?? 0}', T.info),
                                    if (r['currentVehicle'] != null)
                                      Chip2((r['currentVehicle']['plate'] ?? '').toString(), T.success, icon: Icons.local_shipping_outlined),
                                  ]),
                                ]),
                              ),
                            ),
                          );
                        },
                      ),
                    ),
                  ),
                ]),
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// تقييم أداء السائقين — إدارة الأسطول (من الحمولات)
// ─────────────────────────────────────────────────────────────────────────────
class FleetDriverKpisScreen extends StatefulWidget {
  const FleetDriverKpisScreen({super.key});
  @override
  State<FleetDriverKpisScreen> createState() => _FleetDriverKpisScreenState();
}

class _FleetDriverKpisScreenState extends State<FleetDriverKpisScreen> {
  List<Map<String, dynamic>> _rows = [];
  Map<String, dynamic> _summary = {};
  bool _loading = true;
  String? _error;
  String _q = '';

  @override
  void initState() { super.initState(); _load(); }

  Future<void> _load() async {
    try {
      final d = await Api.instance.get('/api/fleet/driver-kpis');
      if (!mounted) return;
      setState(() {
        _rows = List<Map<String, dynamic>>.from(d['items'] ?? []);
        _summary = Map<String, dynamic>.from(d['summary'] ?? {});
        _loading = false; _error = null;
      });
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  void _open(Map<String, dynamic> r) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (c) => SafeArea(
        child: SizedBox(
          height: MediaQuery.of(c).size.height * 0.72,
          child: ListView(padding: const EdgeInsets.all(18), children: [
            Row(children: [
              Expanded(child: Text((r['name'] ?? '').toString(), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16))),
              IconButton(
                tooltip: tr('تقرير السائق (PDF)', 'Driver report (PDF)'),
                icon: const Icon(Icons.assessment_outlined, size: 20, color: T.orange),
                onPressed: () => Navigator.push(c, MaterialPageRoute(builder: (_) => ReportsScreen(
                  subject: 'driver', entityId: (r['name'] ?? '').toString(), entityName: (r['name'] ?? '').toString()))),
              ),
            ]),
            if ((r['phone'] ?? '').toString().isNotEmpty)
              Text(r['phone'].toString(), style: const TextStyle(fontSize: 12, color: T.inkSoft)),
            const SizedBox(height: 10),
            Wrap(spacing: 6, runSpacing: 6, children: [
              _bandChip(r),
              Chip2('${tr('حمولات', 'Loads')}: ${_num(r['trips'])}', T.navy),
              Chip2('${tr('وصلت', 'Delivered')}: ${_num(r['done'])}', T.success),
              Chip2('${tr('متأخرة', 'Late')}: ${_num(r['late'])}', T.danger),
              Chip2('${tr('ملغاة', 'Cancelled')}: ${_num(r['cancelled'])}', T.inkFaint),
              Chip2('${tr('الدخل', 'Income')}: ${_num(r['income'])}', T.success),
              Chip2('${tr('مصروفاته', 'Expenses')}: ${_num(r['expense'])}', T.warn),
              if (r['onTimeRate'] != null) Chip2('${tr('في الموعد', 'On time')}: ${r['onTimeRate']}%', T.info),
              if (r['followUpRate'] != null) Chip2('${tr('المتابعة', 'Follow-up')}: ${r['followUpRate']}%', T.cyan),
            ]),
            const SizedBox(height: 18),
            Text(tr('تفصيل التقييم', 'Score breakdown'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14)),
            const SizedBox(height: 10),
            _Breakdown(List.from(r['breakdown'] ?? []), _hex(r['bandColor'] as String?)),
            const SizedBox(height: 10),
            Text('${tr('مكالمات المتابعة', 'Follow-up calls')}: ${_num(r['followUpsDone'])}/${_num(r['followUpsExpected'])}',
                style: const TextStyle(fontSize: 11.5, color: T.inkFaint)),
          ]),
        ),
      ),
    );
  }

  String _fold(String s) => s.replaceAll(RegExp('[أإآ]'), 'ا').replaceAll('ى', 'ي').replaceAll('ة', 'ه').toLowerCase();

  @override
  Widget build(BuildContext context) {
    final q = _fold(_q.trim());
    final rows = _rows.where((r) => q.isEmpty || _fold('${r['name']} ${r['phone']}').contains(q)).toList();

    return AppScaffold(
      title: Text(tr('تقييم السائقين', 'Driver KPIs')),
      body: _loading
          ? ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(height: 70), SizedBox(height: 10), Shimmer(), SizedBox(height: 10), Shimmer()])
          : _error != null
              ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
              : Column(children: [
                  Padding(
                    padding: const EdgeInsets.fromLTRB(14, 12, 14, 6),
                    child: Row(children: [
                      Expanded(child: StatCard(label: tr('عملوا في الفترة', 'Worked'), value: _n(_summary['activeDrivers']), color: T.success, icon: Icons.badge_outlined)),
                      const SizedBox(width: 8),
                      Expanded(child: StatCard(label: tr('متوسط التقييم', 'Avg score'), value: _n(_summary['averageScore']), color: T.info, icon: Icons.speed_outlined)),
                      const SizedBox(width: 8),
                      Expanded(child: StatCard(label: tr('حمولات متأخرة', 'Late loads'), value: _n(_summary['lateTrips']), color: T.danger, icon: Icons.schedule_outlined)),
                    ]),
                  ),
                  Padding(
                    padding: const EdgeInsets.fromLTRB(14, 4, 14, 4),
                    child: TextField(
                      onChanged: (v) => setState(() => _q = v),
                      decoration: InputDecoration(hintText: tr('ابحث عن السائق…', 'Search driver…'), prefixIcon: const Icon(Icons.search), suffixText: '${rows.length}'),
                    ),
                  ),
                  Expanded(
                    child: RefreshIndicator(
                      onRefresh: _load,
                      child: ListView.builder(
                        padding: const EdgeInsets.fromLTRB(14, 4, 14, 20),
                        itemCount: rows.length,
                        itemBuilder: (c, i) {
                          final r = rows[i];
                          final color = _hex(r['bandColor'] as String?);
                          return Padding(
                            padding: const EdgeInsets.only(bottom: 10),
                            child: Pressable(
                              onTap: () => _open(r),
                              child: AppCard(
                                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                  Row(children: [
                                    Expanded(child: Text((r['name'] ?? '').toString(), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14))),
                                    _bandChip(r),
                                  ]),
                                  const SizedBox(height: 8),
                                  _ScoreBar(_n(r['score']), color),
                                  const SizedBox(height: 8),
                                  Wrap(spacing: 6, runSpacing: 6, children: [
                                    Chip2('${tr('حمولات', 'Loads')}: ${_num(r['trips'])}', T.navy),
                                    Chip2('${tr('الدخل', 'Income')}: ${_num(r['income'])}', T.success),
                                    if (r['onTimeRate'] != null) Chip2('${tr('في الموعد', 'On time')}: ${r['onTimeRate']}%', T.info),
                                    if (r['followUpRate'] != null) Chip2('${tr('المتابعة', 'Follow-up')}: ${r['followUpRate']}%', T.cyan),
                                    if (r['vehicle'] != null) Chip2((r['vehicle']['plate'] ?? '').toString(), T.violet, icon: Icons.local_shipping_outlined),
                                    if (r['working'] == false) Chip2(tr('متوقف', 'Off duty'), T.danger),
                                  ]),
                                ]),
                              ),
                            ),
                          );
                        },
                      ),
                    ),
                  ),
                ]),
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// مؤشرات العملاء / الموردين — CRM
// ─────────────────────────────────────────────────────────────────────────────
class CrmKpisScreen extends StatefulWidget {
  /// 'customers' or 'vendors'.
  final String kind;
  const CrmKpisScreen({super.key, required this.kind});
  @override
  State<CrmKpisScreen> createState() => _CrmKpisScreenState();
}

class _CrmKpisScreenState extends State<CrmKpisScreen> {
  List<Map<String, dynamic>> _rows = [];
  Map<String, dynamic> _summary = {};
  bool _loading = true;
  String? _error;
  String _q = '';

  bool get _isVendors => widget.kind == 'vendors';

  @override
  void initState() { super.initState(); _load(); }

  Future<void> _load() async {
    try {
      final d = await Api.instance.get('/api/crm/kpis/${widget.kind}');
      if (!mounted) return;
      setState(() {
        _rows = List<Map<String, dynamic>>.from(d['items'] ?? []);
        _summary = Map<String, dynamic>.from(d['summary'] ?? {});
        _loading = false; _error = null;
      });
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  void _open(Map<String, dynamic> r) {
    final flags = List.from(r['flags'] ?? []);
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (c) => SafeArea(
        child: SizedBox(
          height: MediaQuery.of(c).size.height * 0.78,
          child: ListView(padding: const EdgeInsets.all(18), children: [
            Text((r['name'] ?? '').toString(), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16)),
            const SizedBox(height: 10),
            Wrap(spacing: 6, runSpacing: 6, children: [
              _bandChip(r),
              if (_isVendors) ...[
                Chip2('${tr('حمولات', 'Loads')}: ${_num(r['loads'])}', T.navy),
                Chip2('${tr('التكلفة', 'Cost')}: ${_num(r['cost'])}', T.warn),
                if (r['marginPct'] != null) Chip2('${tr('الهامش', 'Margin')}: ${r['marginPct']}%', T.success),
                Chip2('${tr('اكتمال العقد', 'Contract')}: ${_num(r['contractScore'])}%',
                    _n(r['contractScore']) == 100 ? T.success : T.danger),
                if (r['carsCount'] != null) Chip2('${tr('سيارات', 'Cars')}: ${_num(r['carsCount'])}', T.violet),
              ] else ...[
                Chip2('${tr('الإيرادات', 'Revenue')}: ${_num(r['revenue'])}', T.success),
                Chip2('${tr('شحنات', 'Shipments')}: ${_num(r['shipments'])}', T.navy),
                Chip2('${tr('المستحق', 'Outstanding')}: ${_num(r['outstanding'])}', T.warn),
                if (_n(r['overdueAmount']) > 0) Chip2('${tr('متأخر', 'Overdue')}: ${_num(r['overdueAmount'])}', T.danger),
                if (r['avgDaysLate'] != null) Chip2('${tr('متوسط التأخير', 'Avg days late')}: ${r['avgDaysLate']}', T.cyan),
              ],
              if (r['daysSinceLastTouch'] != null)
                Chip2('${tr('آخر تعامل', 'Last contact')}: ${r['daysSinceLastTouch']} ${tr('يوم', 'd')}', T.info),
              if (r['daysSinceLastLoad'] != null)
                Chip2('${tr('آخر تشغيل', 'Last load')}: ${r['daysSinceLastLoad']} ${tr('يوم', 'd')}', T.info),
            ]),
            if (flags.isNotEmpty) ...[
              const SizedBox(height: 12),
              Wrap(spacing: 6, runSpacing: 6, children: flags.map<Widget>((raw) {
                final f = Map<String, dynamic>.from(raw as Map);
                return Chip2(tr(f['ar'] ?? '', f['en'] ?? ''), T.danger, icon: Icons.flag_outlined);
              }).toList()),
            ],
            const SizedBox(height: 18),
            Text(tr('تفصيل التقييم', 'Score breakdown'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14)),
            const SizedBox(height: 10),
            _Breakdown(List.from(r['breakdown'] ?? []), _hex(r['bandColor'] as String?)),
          ]),
        ),
      ),
    );
  }

  String _fold(String s) => s.replaceAll(RegExp('[أإآ]'), 'ا').replaceAll('ى', 'ي').replaceAll('ة', 'ه').toLowerCase();

  @override
  Widget build(BuildContext context) {
    final q = _fold(_q.trim());
    final rows = _rows.where((r) => q.isEmpty || _fold((r['name'] ?? '').toString()).contains(q)).toList();

    return AppScaffold(
      title: Text(_isVendors ? tr('مؤشرات الموردين', 'Vendor KPIs') : tr('مؤشرات العملاء', 'Customer KPIs')),
      body: _loading
          ? ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(height: 70), SizedBox(height: 10), Shimmer(), SizedBox(height: 10), Shimmer()])
          : _error != null
              ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
              : Column(children: [
                  Padding(
                    padding: const EdgeInsets.fromLTRB(14, 12, 14, 6),
                    child: Row(children: [
                      Expanded(child: StatCard(
                        label: _isVendors ? tr('يعملون معنا', 'Working') : tr('نشط', 'Active'),
                        value: _n(_isVendors ? _summary['working'] : _summary['active']),
                        color: T.success, icon: Icons.verified_outlined)),
                      const SizedBox(width: 8),
                      Expanded(child: StatCard(label: tr('متوسط التقييم', 'Avg score'), value: _n(_summary['averageScore']), color: T.info, icon: Icons.speed_outlined)),
                      const SizedBox(width: 8),
                      Expanded(child: StatCard(
                        label: _isVendors ? tr('متوقف', 'Idle') : tr('يحتاج متابعة', 'At risk'),
                        value: _n(_isVendors ? _summary['idle'] : _summary['atRisk']),
                        color: T.danger, icon: Icons.warning_amber_outlined)),
                    ]),
                  ),
                  Padding(
                    padding: const EdgeInsets.fromLTRB(14, 4, 14, 4),
                    child: TextField(
                      onChanged: (v) => setState(() => _q = v),
                      decoration: InputDecoration(
                        hintText: _isVendors ? tr('ابحث عن مورد…', 'Search vendor…') : tr('ابحث عن عميل…', 'Search customer…'),
                        prefixIcon: const Icon(Icons.search), suffixText: '${rows.length}',
                      ),
                    ),
                  ),
                  Expanded(
                    child: RefreshIndicator(
                      onRefresh: _load,
                      child: ListView.builder(
                        padding: const EdgeInsets.fromLTRB(14, 4, 14, 20),
                        itemCount: rows.length,
                        itemBuilder: (c, i) {
                          final r = rows[i];
                          final color = _hex(r['bandColor'] as String?);
                          return Padding(
                            padding: const EdgeInsets.only(bottom: 10),
                            child: Pressable(
                              onTap: () => _open(r),
                              child: AppCard(
                                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                  Row(children: [
                                    Expanded(child: Text((r['name'] ?? '').toString(),
                                        style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14), overflow: TextOverflow.ellipsis)),
                                    _bandChip(r),
                                  ]),
                                  const SizedBox(height: 8),
                                  _ScoreBar(_n(r['score']), color),
                                  const SizedBox(height: 8),
                                  Wrap(spacing: 6, runSpacing: 6, children: _isVendors
                                      ? [
                                          Chip2('${tr('حمولات', 'Loads')}: ${_num(r['loads'])}', T.navy),
                                          Chip2('${tr('التكلفة', 'Cost')}: ${_num(r['cost'])}', T.warn),
                                          Chip2('${tr('العقد', 'Contract')}: ${_num(r['contractScore'])}%',
                                              _n(r['contractScore']) == 100 ? T.success : T.danger),
                                        ]
                                      : [
                                          Chip2('${tr('إيرادات', 'Revenue')}: ${_num(r['revenue'])}', T.success),
                                          Chip2('${tr('شحنات', 'Shipments')}: ${_num(r['shipments'])}', T.navy),
                                          if (_n(r['overdueAmount']) > 0) Chip2('${tr('متأخر', 'Overdue')}: ${_num(r['overdueAmount'])}', T.danger),
                                        ]),
                                ]),
                              ),
                            ),
                          );
                        },
                      ),
                    ),
                  ),
                ]),
    );
  }
}
