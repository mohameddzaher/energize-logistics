import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/export_sheet.dart';
import '../ui/theme.dart';
import '../ui/tire_sensor_badge.dart';
import '../ui/widgets.dart';
import '../ui/search_field.dart';
import 'package:provider/provider.dart';
import '../services/auth.dart';
import 'ls2_common.dart';
import 'ls2_vehicle_detail.dart';

/// Location Solutions vehicles, native: the live GPS fleet with maintenance state, odometer, driver and search; maintenance chips filter the list.
class Ls2VehiclesScreen extends StatefulWidget {
  const Ls2VehiclesScreen({super.key});
  @override
  State<Ls2VehiclesScreen> createState() => _Ls2VehiclesScreenState();
}

class _Ls2VehiclesScreenState extends State<Ls2VehiclesScreen> {
  List<Map<String, dynamic>> _rows = [];
  List<Map<String, dynamic>> _deferrals = [];
  bool _loading = true;
  String? _error;
  String _maint = '';
  String _q = '';
  int _seq = 0;
  late final void Function() _onLive;

  @override
  void initState() {
    super.initState();
    _load();
    _onLive = () => _load();
    Live.instance.on('ls2:updated', _onLive);
    // Plate as in the vehicle registry; edits there show here immediately.
    Live.instance.on('vreg:updated', _onLive);
  }

  @override
  void dispose() {
    Live.instance.off('ls2:updated', _onLive);
    Live.instance.off('vreg:updated', _onLive);
    super.dispose();
  }

  /// As on the web: service intervals and "where is it now" are requested explicitly, and filtering happens client-side so the export reads the whole fleet, not what is left after the search.
  Future<void> _load() async {
    final seq = ++_seq;
    try {
      final res = await Future.wait([
        Api.instance.get('/api/ls2/vehicles?include=intervals,whereabouts'),
        Api.instance.get('/api/ls2/deferrals').catchError((_) => <String, dynamic>{}),
      ]);
      if (!mounted || seq != _seq) return;
      setState(() {
        _rows = ls2List(res[0]['items'] ?? res[0]['vehicles']);
        _deferrals = ls2List(ls2Map(res[1])['deferrals']);
        _loading = false;
        _error = null;
      });
    } catch (e) {
      if (mounted && seq == _seq) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  bool _isAdmin(AuthProvider a) =>
      const ['super_admin', 'admin', 'it_manager', 'it_specialist', 'operations_manager', 'operations_team_leader', 'workshop_manager', 'location_manager', 'vehicles_manager', 'data_manager', 'data_analyst', 'data_entry'].contains(a.role)
      || a.canEditSection('Location Solutions');

  List<Map<String, dynamic>> get _shown {
    var r = _rows;
    if (_maint.isNotEmpty) r = r.where((v) => v['maintenanceStatus'] == _maint).toList();
    final t = _q.trim().toLowerCase();
    if (t.isNotEmpty) {
      r = r.where((v) => [v['plate'], v['name'], v['driver'], v['unitId']].any((x) => (x ?? '').toString().toLowerCase().contains(t))).toList();
    }
    return r;
  }

  void _openVehicle(Map<String, dynamic> v) => Navigator.push(context, MaterialPageRoute(
      builder: (_) => Ls2VehicleDetailScreen(
          // Path uses the unit number, not the Mongo id (the `/vehicles/:id` guard is numeric).
          vehicleId: (v['unitId'] ?? v['_id'] ?? '').toString(),
          plate: (v['plate'] ?? v['name'] ?? '').toString())));

  // Workshop reports (Excel), same as the web export
  static dynamic _remainOf(Map<String, dynamic> iv) => iv['remainingKm'] ?? iv['remainingDays'] ?? iv['remaining'];
  static String _unitOf(Map<String, dynamic> iv) => iv['remainingKm'] != null ? 'km' : iv['remainingDays'] != null ? 'd' : 'h';
  static String _statusText(dynamic s) => tr(s == 'overdue' ? 'متأخرة' : s == 'due' ? 'قريبة' : 'سليمة', '${s ?? ''}');

  List<Map<String, dynamic>> _intervalRows(bool Function(Map<String, dynamic>) pick) {
    final rows = <Map<String, dynamic>>[];
    for (final v in _rows) {
      for (final iv in ls2List(v['serviceIntervals'])) {
        if (!pick(iv)) continue;
        final rem = ls2Num(_remainOf(iv));
        rows.add({
          'plate': v['plate'] ?? v['name'], 'driver': v['driver'] ?? '', 'odometerKm': v['odometerKm'] ?? '', 'odometerAt': v['lastMessageAt'],
          'service': iv['name'], 'intervalKm': iv['intervalKm'] ?? '', 'lastServiceAt': iv['lastServiceAt'], 'lastServiceKm': iv['lastServiceKm'] ?? '',
          'nextDue': iv['nextServiceKm'] ?? (iv['nextServiceAt'] != null ? ls2Date(iv['nextServiceAt']) : iv['nextServiceValue'] ?? ''),
          'remaining': rem, 'overdueBy': rem != null && rem < 0 ? rem.abs() : '',
          'unit': iv['remainingKm'] != null ? 'km' : iv['remainingDays'] != null ? 'days' : 'h',
          'serviceCount': iv['serviceCount'] ?? 0, 'status': iv['statusLevel'],
        });
      }
    }
    rows.sort((a, b) => (ls2Num(a['remaining']) ?? 1e9).compareTo(ls2Num(b['remaining']) ?? 1e9));
    return rows;
  }

  static String _svcKey(dynamic name) => (name ?? '').toString().replaceFirst(RegExp(r'^\s*\d+\s*-\s*'), '').trim();

  List<String> _groups() {
    final seen = <String, (int, num)>{};
    for (final v in _rows) {
      for (final iv in ls2List(v['serviceIntervals'])) {
        final k = _svcKey(iv['name']);
        if (k.isEmpty) continue;
        final m = RegExp(r'^\s*(\d+)\s*-').firstMatch('${iv['name']}');
        final order = m == null ? 99 : int.parse(m.group(1)!);
        final g = seen[k];
        seen[k] = g == null ? (order, ls2Num(iv['intervalKm']) ?? 0) : (order < g.$1 ? order : g.$1, g.$2);
      }
    }
    final keys = seen.keys.toList()
      ..sort((a, b) { final x = seen[a]!, y = seen[b]!; return x.$1 != y.$1 ? x.$1 - y.$1 : x.$2 != y.$2 ? x.$2.compareTo(y.$2) : a.compareTo(b); });
    return keys;
  }

  List<Map<String, dynamic>> _vehicleRows(bool Function(Map<String, dynamic>) pick) {
    final groups = _groups();
    final rows = <Map<String, dynamic>>[];
    for (final v in _rows) {
      final ivs = ls2List(v['serviceIntervals']);
      final matched = ivs.where(pick).toList();
      if (matched.isEmpty) continue;
      final w = ls2Map(v['whereabouts']);
      final needed = matched.where((iv) => iv['statusLevel'] == 'overdue' || iv['statusLevel'] == 'due').toList()
        ..sort((a, b) => (ls2Num(a['remainingKm']) ?? 1e9).compareTo(ls2Num(b['remainingKm']) ?? 1e9));
      final row = <String, dynamic>{
        'plate': v['plate'] ?? v['name'], 'driver': v['driver'] ?? '', 'odometerKm': v['odometerKm'] ?? '', 'odometerAt': v['lastMessageAt'],
        'status': _statusText(v['maintenanceStatus']),
        'whereNow': w.isEmpty ? '' : tr('${w['whereAr'] ?? ''}', '${w['whereEn'] ?? ''}'),
        'whereEta': w['expectedArrival'], 'whereWaybill': w['waybillNumber'] ?? '', 'whereCustomer': w['customerName'] ?? '',
        'neededCount': needed.length,
        'needed': needed.map((iv) {
          final r = ls2Num(_remainOf(iv)) ?? 0;
          final amount = '${ls2Fmt(r.abs())} ${_unitOf(iv)}';
          return '${_svcKey(iv['name'])} (${r < 0 ? tr('متأخرة $amount', 'late $amount') : tr('باقي $amount', '$amount left')})';
        }).join(' | '),
      };
      for (var i = 0; i < groups.length; i++) {
        final iv = ivs.where((x) => _svcKey(x['name']) == groups[i]).firstOrNull;
        row['g${i}_last'] = iv?['lastServiceAt'];
        row['g${i}_lastKm'] = iv?['lastServiceKm'] ?? '';
        row['g${i}_due'] = iv == null ? '' : (iv['nextServiceKm'] != null ? '${ls2Fmt(iv['nextServiceKm'])} km' : iv['nextServiceAt'] != null ? ls2Date(iv['nextServiceAt']) : iv['nextServiceValue'] != null ? '${iv['nextServiceValue']} h' : '—');
        row['g${i}_remain'] = iv == null ? '' : _remainOf(iv) ?? 0;
        row['g${i}_status'] = iv == null ? '' : _statusText(iv['statusLevel']);
      }
      row['_worst'] = matched.fold<num>(1e9, (m, iv) { final r = ls2Num(_remainOf(iv)) ?? 0; return r < m ? r : m; });
      rows.add(row);
    }
    rows.sort((a, b) => (a['_worst'] as num).compareTo(b['_worst'] as num));
    return rows;
  }

  List<ExportCol> _vehicleCols() {
    final cols = <ExportCol>[
      ExportCol('اللوحة', 'Plate', (r) => r['plate'] ?? ''),
      ExportCol('السائق', 'Driver', (r) => r['driver'] ?? ''),
      ExportCol('العداد الحالي (كم)', 'Odometer (km)', (r) => r['odometerKm']),
      ExportCol('وقت قراءة العداد', 'Odometer read at', (r) => ls2DateTime(r['odometerAt'])),
      ExportCol('الحالة العامة', 'Overall status', (r) => r['status']),
      ExportCol('عدد الصيانات المطلوبة', 'Services needed', (r) => r['neededCount']),
      ExportCol('الصيانات المطلوبة', 'Which services are needed', (r) => r['needed']),
      ExportCol('أين هي الآن', 'Where it is now', (r) => r['whereNow']),
      ExportCol('الوصول المتوقع', 'Expected arrival', (r) => ls2DateTime(r['whereEta'])),
      ExportCol('بوليصة الحمولة', 'Waybill', (r) => r['whereWaybill']),
      ExportCol('عميل الحمولة', 'Load customer', (r) => r['whereCustomer']),
    ];
    final groups = _groups();
    for (var i = 0; i < groups.length; i++) {
      final g = groups[i];
      cols.addAll([
        ExportCol('$g — آخر صيانة', '$g — last service', (r) => r['g${i}_last'] == null ? '' : ls2Date(r['g${i}_last'])),
        ExportCol('$g — عداد آخرها (كم)', '$g — last km', (r) => r['g${i}_lastKm']),
        ExportCol('$g — تستحق عند', '$g — due at', (r) => r['g${i}_due']),
        ExportCol('$g — المتبقي', '$g — remaining', (r) => r['g${i}_remain']),
        ExportCol('$g — الحالة', '$g — status', (r) => r['g${i}_status']),
      ]);
    }
    return cols;
  }

  List<ExportCol> _flatCols(String kind) => [
        ExportCol('اللوحة', 'Plate', (r) => r['plate'] ?? ''),
        ExportCol('السائق', 'Driver', (r) => r['driver'] ?? ''),
        ExportCol('العداد الحالي (كم)', 'Odometer (km)', (r) => r['odometerKm']),
        ExportCol('وقت قراءة العداد', 'Odometer read at', (r) => ls2DateTime(r['odometerAt'])),
        ExportCol('الخدمة', 'Service', (r) => r['service'] ?? ''),
        if (kind == 'both') ExportCol('الحالة', 'Status', (r) => r['status'] == 'overdue' ? tr('متأخرة', 'overdue') : tr('قريبة', 'due')),
        if (kind != 'due') ExportCol('متأخرة بـ (كم)', 'Overdue by (km)', (r) => r['overdueBy']),
        if (kind != 'overdue') ExportCol('المتبقي (كم)', 'Remaining (km)', (r) { final n = ls2Num(r['remaining']); return n != null && n > 0 ? n : ''; }),
        ExportCol('تستحق عند (كم)', 'Due at (km)', (r) => r['nextDue']),
        ExportCol('آخر صيانة (تاريخ)', 'Last service (date)', (r) => r['lastServiceAt'] == null ? '' : ls2Date(r['lastServiceAt'])),
        ExportCol('عداد آخر صيانة (كم)', 'Last service (km)', (r) => r['lastServiceKm']),
      ];

  List<ExportCol> get _detailCols => [
        ExportCol('اللوحة', 'Plate', (r) => r['plate'] ?? ''),
        ExportCol('السائق', 'Driver', (r) => r['driver'] ?? ''),
        ExportCol('العداد الحالي (كم)', 'Odometer (km)', (r) => r['odometerKm']),
        ExportCol('وقت قراءة العداد', 'Odometer read at', (r) => ls2DateTime(r['odometerAt'])),
        ExportCol('الخدمة', 'Service', (r) => r['service'] ?? ''),
        ExportCol('كل (كم)', 'Interval (km)', (r) => r['intervalKm']),
        ExportCol('آخر صيانة (تاريخ)', 'Last service (date)', (r) => r['lastServiceAt'] == null ? '' : ls2Date(r['lastServiceAt'])),
        ExportCol('عداد آخر صيانة (كم)', 'Last service (km)', (r) => r['lastServiceKm']),
        ExportCol('تستحق عند', 'Due at', (r) => r['nextDue']),
        ExportCol('المتبقي', 'Remaining', (r) => r['remaining'] ?? ''),
        ExportCol('متأخرة بـ', 'Overdue by', (r) => r['overdueBy']),
        ExportCol('الوحدة', 'Unit', (r) => r['unit']),
        ExportCol('عدد الصيانات السابقة', 'Past services', (r) => r['serviceCount']),
        ExportCol('الحالة', 'Status', (r) => _statusText(r['status'])),
      ];

  Future<void> _export() async {
    final shown = _shown;
    await ls2ExportMenu(context, fileName: 'ls2-maintenance', options: [
      ('المتأخرات فقط (فات موعدها)', 'Overdue only', [(tr('المتأخرات', 'Overdue'), _flatCols('overdue'), _intervalRows((iv) => iv['statusLevel'] == 'overdue'))]),
      ('القريبة فقط (اقترب موعدها)', 'Due soon only', [(tr('القريبة', 'Due soon'), _flatCols('due'), _intervalRows((iv) => iv['statusLevel'] == 'due'))]),
      ('المتأخر والقريب معًا', 'Overdue + due soon', [(tr('المتأخر والقريب', 'Overdue + due'), _flatCols('both'), _intervalRows((iv) => iv['statusLevel'] == 'overdue' || iv['statusLevel'] == 'due'))]),
      ('العرض الحالي (ملخص العربيات)', 'Current view (vehicle summary)', [(tr('الصيانة', 'Maintenance'), [
        ExportCol('اللوحة', 'Plate', (v) => v['plate'] ?? v['name'] ?? ''),
        ExportCol('السائق', 'Driver', (v) => v['driver'] ?? ''),
        ExportCol('العداد (كم)', 'Odometer (km)', (v) => v['odometerKm'] ?? ''),
        ExportCol('وقت قراءة العداد', 'Odometer read at', (v) => ls2DateTime(v['lastMessageAt'])),
        ExportCol('الحالة', 'Status', (v) => _statusText(v['maintenanceStatus'])),
        ExportCol('الأكثر تأخرًا', 'Most overdue', (v) => v['nextServiceName'] ?? ''),
        ExportCol('متبقّي/متأخرة (كم)', 'Remaining (km)', (v) => v['kmToService'] ?? ''),
        ExportCol('الأقرب القادمة', 'Next upcoming', (v) => v['upcomingServiceName'] ?? ''),
        ExportCol('متبقّي لها (كم)', 'Its remaining (km)', (v) => v['upcomingKm'] ?? ''),
      ], shown)]),
      ('كل العربيات وصياناتها', 'All vehicles & their services', [
        (tr('العربيات', 'Vehicles'), _vehicleCols(), _vehicleRows((_) => true)),
        (tr('تفصيلي', 'Detailed'), _detailCols, _intervalRows((_) => true)),
      ]),
    ]);
  }

  /// Near maintenance: a workshop sheet of every service due within a distance entered each time.
  Future<void> _dueSoon() async {
    final ctrl = TextEditingController(text: '3000');
    bool includeOverdue = true;
    final go = await showDialog<bool>(context: context, builder: (c) => StatefulBuilder(builder: (c, setS) => AlertDialog(
      title: Text(tr('تصدير القريبة من الصيانة', 'Export services due soon')),
      content: Column(mainAxisSize: MainAxisSize.min, children: [
        Text(tr('كشف للورشة بجميع الخدمات المستحقّة خلال هذه المسافة.', 'A workshop sheet of every service coming due within this distance.'), style: const TextStyle(fontSize: 12, color: T.inkFaint)),
        const SizedBox(height: 10),
        TextField(controller: ctrl, keyboardType: TextInputType.number, decoration: InputDecoration(labelText: tr('الخدمات المتبقّي لها أقل من (كم)', 'Services with less than (km) remaining'))),
        CheckboxListTile(
          contentPadding: EdgeInsets.zero, value: includeOverdue, onChanged: (v) => setS(() => includeOverdue = v ?? true),
          title: Text(tr('تضمين المتأخرة أيضًا', 'Also include overdue ones'), style: const TextStyle(fontSize: 13)),
        ),
      ]),
      actions: [
        TextButton(onPressed: () => Navigator.pop(c, false), child: Text(tr('إلغاء', 'Cancel'))),
        FilledButton(onPressed: () => Navigator.pop(c, true), child: Text(tr('تصدير Excel', 'Export Excel'))),
      ],
    )));
    if (go != true || !mounted) return;
    final within = num.tryParse(ctrl.text) ?? 3000;
    bool pick(Map<String, dynamic> iv) {
      final r = ls2Num(iv['remainingKm']);
      if (r == null) return false;
      if (r <= 0) return includeOverdue;
      return r <= within;
    }
    final detail = _intervalRows(pick);
    if (detail.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(tr('لا صفوف للتصدير', 'Nothing to export'))));
      return;
    }
    await exportExcel(context, fileName: 'ls2-due-within-${within}km', sheets: [
      (tr('العربيات', 'Vehicles'), _vehicleCols(), _vehicleRows(pick)),
      (tr('تفصيلي', 'Detailed'), _detailCols, detail),
    ]);
  }

  // Deferred items across the whole fleet, settled from here without visiting the vehicle file
  Future<void> _openDeferrals(bool admin) async {
    await showModalBottomSheet(
      context: context, isScrollControlled: true, backgroundColor: const Color(0xFFF8FAFC),
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (c) => StatefulBuilder(builder: (c, setS) => SafeArea(child: SizedBox(
        height: MediaQuery.of(c).size.height * 0.85,
        child: Column(children: [
          Padding(
            padding: const EdgeInsets.all(14),
            child: Row(children: [
              const Icon(Icons.schedule, color: T.warn),
              const SizedBox(width: 6),
              Expanded(child: Text('${tr('البنود المؤجّلة', 'Deferred tasks')} (${_deferrals.length})', style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 16))),
              IconButton(onPressed: () => Navigator.pop(c), icon: const Icon(Icons.close)),
            ]),
          ),
          Expanded(
            child: _deferrals.isEmpty
                ? EmptyState(icon: Icons.task_alt, title: tr('لا توجد بنود مؤجّلة مفتوحة في الأسطول.', 'No open deferred tasks in the fleet.'))
                : ListView.separated(
                    padding: const EdgeInsets.fromLTRB(14, 0, 14, 14),
                    itemCount: _deferrals.length,
                    separatorBuilder: (_, __) => const SizedBox(height: 8),
                    itemBuilder: (_, i) => _deferralCard(_deferrals[i], admin, () async {
                      final done = await _settle(_deferrals[i]);
                      if (done) { await _load(); setS(() {}); }
                    }),
                  ),
          ),
        ]),
      ))),
    );
  }

  Widget _deferralCard(Map<String, dynamic> d, bool admin, VoidCallback onSettle) {
    final rem = ls2Num(d['remainingKm']);
    final over = rem != null && rem < 0;
    final n = ls2Num(d['estimatedDaysLeft']);
    final dueIn = over
        ? tr('مستحق الآن', 'due now')
        : n == null ? '—' : tr(n == 0 ? '≈ أقل من يوم' : n == 1 ? '≈ يوم تقريبًا' : n == 2 ? '≈ يومين تقريبًا' : '≈ $n يومًا تقريبًا', n == 0 ? '≈ under a day' : '≈ ~$n day${n == 1 ? '' : 's'}');
    Widget cell(String label, String value, {Color? color}) => Expanded(child: Container(
          padding: const EdgeInsets.symmetric(vertical: 6, horizontal: 4),
          decoration: BoxDecoration(color: (color ?? T.inkFaint).withValues(alpha: 0.08), borderRadius: BorderRadius.circular(8)),
          child: Column(children: [
            Text(label, style: const TextStyle(fontSize: 10, color: T.inkFaint)),
            Text(value, textAlign: TextAlign.center, style: TextStyle(fontSize: 12, fontWeight: FontWeight.w800, color: color ?? T.ink)),
          ]),
        ));
    return AppCard(
      topAccent: over ? T.danger : T.warn,
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          Expanded(child: Text(Lang.instance.ar ? '${d['labelAr'] ?? d['label'] ?? ''}' : '${d['label'] ?? d['labelAr'] ?? ''}', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13.5))),
          if ((d['plate'] ?? '').toString().isNotEmpty)
            ActionChip(
              label: Text('${d['plate']}', style: const TextStyle(color: T.orange, fontWeight: FontWeight.w800, fontSize: 11.5)),
              backgroundColor: T.orange.withValues(alpha: 0.1), side: BorderSide.none, visualDensity: VisualDensity.compact,
              onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => Ls2VehicleDetailScreen(vehicleId: '${d['unitId']}', plate: '${d['plate']}'))),
            ),
        ]),
        if ((d['intervalName'] ?? '').toString().isNotEmpty) Text('${d['intervalName']}', style: const TextStyle(fontSize: 11, color: T.inkFaint)),
        const SizedBox(height: 6),
        Chip2(rem == null ? '—' : over ? tr('متأخر ${ls2Fmt(rem.abs())} كم', '${ls2Fmt(rem.abs())} km overdue') : tr('متبقٍّ ${ls2Fmt(rem)} كم', '${ls2Fmt(rem)} km left'), over ? T.danger : T.warn),
        const SizedBox(height: 6),
        Row(children: [
          cell(tr('العداد الحالي', 'Odometer now'), ls2Km(d['currentOdometerKm'])),
          const SizedBox(width: 6),
          cell(tr('الاستحقاق عند', 'Due at'), ls2Km(d['dueAtOdometerKm'])),
          const SizedBox(width: 6),
          cell(tr('الاستحقاق خلال', 'Due in'), '$dueIn${!over && n != null && d['estimatedDueDate'] != null ? '\n${ls2Date(d['estimatedDueDate'])}' : ''}', color: over ? T.danger : T.warn),
        ]),
        const SizedBox(height: 6),
        Row(children: [
          Expanded(child: Text(
            '${tr('أُجِّل بتاريخ', 'Deferred on')} ${ls2Date(d['deferredAt'])}${d['deferKm'] != null ? ' · +${ls2Fmt(d['deferKm'])} ${tr('كم', 'km')}' : ''}${(d['note'] ?? '').toString().isNotEmpty ? ' · ${d['note']}' : ''}',
            style: const TextStyle(fontSize: 11, color: T.inkFaint),
          )),
          if (admin)
            FilledButton(
              style: FilledButton.styleFrom(backgroundColor: T.orange, visualDensity: VisualDensity.compact),
              onPressed: onSettle, child: Text(tr('تسوية البند', 'Settle')),
            ),
        ]),
      ]),
    );
  }

  /// Settle one item: done / further deferral / will not be done, without logging a full maintenance record.
  Future<bool> _settle(Map<String, dynamic> d) async {
    String action = 'done';
    final odo = TextEditingController(text: d['currentOdometerKm'] != null ? '${d['currentOdometerKm']}' : '');
    final addKm = TextEditingController();
    final note = TextEditingController();
    final ok = await showDialog<bool>(context: context, builder: (c) => StatefulBuilder(builder: (c, setS) {
      Widget opt(String key, String ar, String en, String hintAr, String hintEn, IconData icon, Color color) => Padding(
            padding: const EdgeInsets.only(bottom: 6),
            child: InkWell(
              onTap: () => setS(() => action = key),
              borderRadius: BorderRadius.circular(12),
              child: Container(
                padding: const EdgeInsets.all(10),
                decoration: BoxDecoration(
                  color: action == key ? color : Colors.white,
                  border: Border.all(color: action == key ? color : T.line),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Row(children: [
                  Icon(icon, color: action == key ? Colors.white : color),
                  const SizedBox(width: 8),
                  Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text(tr(ar, en), style: TextStyle(fontWeight: FontWeight.w800, color: action == key ? Colors.white : T.ink)),
                    Text(tr(hintAr, hintEn), style: TextStyle(fontSize: 11, color: action == key ? Colors.white70 : T.inkFaint)),
                  ])),
                ]),
              ),
            ),
          );
      return AlertDialog(
        title: Text(tr('تسوية بند مؤجّل', 'Settle deferred task')),
        content: SingleChildScrollView(child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Text('${d['labelAr'] ?? d['label'] ?? ''}${(d['plate'] ?? '').toString().isNotEmpty ? ' · ${d['plate']}' : ''}', style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700)),
          const SizedBox(height: 8),
          opt('done', 'تم التنفيذ', 'Done now', 'نُفِّذ فعلًا — يُغلَق البند ويُغلَق تنبيهه.', 'It was done. Close it and clear the alert.', Icons.check_circle_outline, T.success),
          opt('defer', 'تأجيل إضافي', 'Defer again', 'ما زالت بحالة جيدة — تُمنَح مسافة إضافية.', 'Still fine — grant it more km.', Icons.schedule, T.warn),
          opt('skip', 'لن يُنفَّذ', "Won't do", 'تقرر عدم تنفيذه — يُغلَق البند.', 'Decided not to do it. Close it.', Icons.cancel_outlined, T.inkSoft),
          if (action == 'defer')
            TextField(controller: addKm, keyboardType: TextInputType.number, decoration: InputDecoration(labelText: tr('مسافة إضافية (كم) *', 'Extra km *'), helperText: tr('يبدأ العدّ من العداد الحالي.', 'Counted from the current odometer.'))),
          TextField(controller: odo, keyboardType: TextInputType.number, decoration: InputDecoration(labelText: tr('العداد الحالي', 'Odometer now'))),
          TextField(controller: note, decoration: InputDecoration(labelText: tr('ملاحظة', 'Note'))),
        ])),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: Text(tr('إلغاء', 'Cancel'))),
          FilledButton(
            onPressed: () {
              if (action == 'defer' && !((num.tryParse(addKm.text) ?? 0) > 0)) {
                ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(tr('اكتب المسافة الإضافية', 'Enter the extra km'))));
                return;
              }
              Navigator.pop(c, true);
            },
            child: Text(tr('تأكيد', 'Confirm')),
          ),
        ],
      );
    }));
    if (ok != true) return false;
    try {
      await Api.instance.post('/api/ls2/vehicles/${d['unitId']}/resolve-deferral', {
        'logId': d['logId'], 'label': d['label'], 'action': action,
        if (odo.text.trim().isNotEmpty) 'odometerKm': num.tryParse(odo.text.trim()),
        if (action == 'defer') 'addKm': num.tryParse(addKm.text.trim()),
        if (note.text.trim().isNotEmpty) 'note': note.text.trim(),
      });
      return true;
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
      return false;
    }
  }

  @override
  Widget build(BuildContext context) {
    final admin = _isAdmin(context.watch<AuthProvider>());
    final overdue = _rows.where((v) => v['maintenanceStatus'] == 'overdue').length;
    final due = _rows.where((v) => v['maintenanceStatus'] == 'due').length;
    final rows = _shown;

    return AppScaffold(
      title: Text(tr('مركبات لوكيشن سوليوشن', 'LS Fleet')),
      actions: [
        IconButton(
          tooltip: tr('البنود المؤجّلة', 'Deferred tasks'),
          onPressed: () => _openDeferrals(admin),
          icon: Badge(isLabelVisible: _deferrals.isNotEmpty, label: Text('${_deferrals.length}'), child: const Icon(Icons.schedule)),
        ),
        IconButton(tooltip: tr('القريبة من الصيانة', 'Due soon'), onPressed: _dueSoon, icon: const Icon(Icons.assignment_late_outlined)),
        IconButton(tooltip: tr('تصدير Excel', 'Export to Excel'), onPressed: _export, icon: const Icon(Icons.file_download_outlined)),
      ],
      body: Column(children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(14, 12, 14, 0),
          child: SearchField(hint: tr('ابحث باللوحة أو السائق…', 'Search plate or driver…'), suffixText: '${rows.length}', onChanged: (v) => setState(() => _q = v)),
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(14, 8, 14, 4),
          child: Row(children: [
            FilterChip(
              selected: _maint == 'overdue',
              onSelected: (_) => setState(() => _maint = _maint == 'overdue' ? '' : 'overdue'),
              label: Text(tr('صيانة متأخرة ($overdue)', 'Overdue ($overdue)')),
              labelStyle: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: _maint == 'overdue' ? Colors.white : T.danger),
              selectedColor: T.danger,
              backgroundColor: T.danger.withValues(alpha: 0.1),
              checkmarkColor: Colors.white,
              side: BorderSide.none,
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
            ),
            const SizedBox(width: 6),
            FilterChip(
              selected: _maint == 'due',
              onSelected: (_) => setState(() => _maint = _maint == 'due' ? '' : 'due'),
              label: Text(tr('صيانة قريبة ($due)', 'Due soon ($due)')),
              labelStyle: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: _maint == 'due' ? Colors.white : T.warn),
              selectedColor: T.warn,
              backgroundColor: T.warn.withValues(alpha: 0.1),
              checkmarkColor: Colors.white,
              side: BorderSide.none,
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
            ),
          ]),
        ),
        Expanded(
          child: _loading
              ? ListView(padding: const EdgeInsets.all(14), children: const [
                  Shimmer(), SizedBox(height: 10), Shimmer(), SizedBox(height: 10), Shimmer(), SizedBox(height: 10), Shimmer(),
                ])
              : _error != null
                  ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
                  : RefreshIndicator(
                      onRefresh: _load,
                      child: rows.isEmpty
                          ? ListView(children: [const SizedBox(height: 80), EmptyState(icon: Icons.local_shipping_outlined, title: tr('لا توجد مركبات مطابقة', 'No matching vehicles'))])
                          : ListView.separated(
                              keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
                              padding: const EdgeInsets.all(14),
                              itemCount: rows.length,
                              separatorBuilder: (_, __) => const SizedBox(height: 8),
                              itemBuilder: (c, i) {
                                final v = rows[i];
                                final maint = v['maintenanceStatus'] ?? 'ok';
                                final color = maint == 'overdue' ? T.danger : maint == 'due' ? T.warn : T.success;
                                final w = ls2Map(v['whereabouts']);
                                return FadeSlideIn(
                                  delayMs: (i * 15).clamp(0, 150),
                                  child: Pressable(
                                    onTap: () => _openVehicle(v),
                                    child: AppCard(
                                    topAccent: color,
                                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                      Row(children: [
                                        Text(((v['registry'] is Map ? v['registry']['plateNumber'] : null) ?? v['name'] ?? v['plate'] ?? '').toString(), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14)),
                                        const SizedBox(width: 6),
                                        if (v['status'] == 'offline') const Icon(Icons.wifi_off_rounded, size: 15, color: T.danger),
                                        const Spacer(),
                                        Chip2(
                                          maint == 'overdue' ? tr('صيانة متأخرة', 'Overdue') : maint == 'due' ? tr('صيانة قريبة', 'Due soon') : tr('سليمة', 'OK'),
                                          color,
                                        ),
                                      ]),
                                      const SizedBox(height: 8),
                                      Wrap(spacing: 6, runSpacing: 6, children: [
                                        // Tire sensor coverage (e.g. 7 / 5 / 2), digit for digit the same number as the web; tapping it opens the missing positions by name.
                                        if (v['tireSensors'] is Map)
                                          TireSensorBadge(
                                            cov: Map<String, dynamic>.from(v['tireSensors'] as Map),
                                            plate: (v['plate'] ?? v['name'] ?? '').toString(),
                                            unitId: v['unitId'] is num ? (v['unitId'] as num).toInt() : int.tryParse((v['unitId'] ?? '').toString()),
                                          ),
                                        if (v['status'] == 'offline') Chip2(tr('غير متصلة', 'Offline'), T.danger, icon: Icons.wifi_off_rounded),
                                        if ((v['driver'] ?? '').toString().isNotEmpty) Chip2(v['driver'], T.inkSoft, icon: Icons.person_outline),
                                        Chip2('${tr('العداد', 'Odo')}: ${ls2Km(v['odometerKm'])}', T.navy, icon: Icons.speed_outlined),
                                        if (v['kmToService'] != null)
                                          Chip2('${tr('للصيانة', 'To service')}: ${ls2Km(v['kmToService'])}', color, icon: Icons.build_outlined),
                                        if ((v['nextServiceName'] ?? '').toString().isNotEmpty)
                                          Chip2(v['nextServiceName'], T.violet, icon: Icons.handyman_outlined),
                                        // Where is it now, from live fleet-management loads.
                                        if (w.isNotEmpty)
                                          Chip2(tr('${w['whereAr'] ?? ''}', '${w['whereEn'] ?? ''}'), T.cyan, icon: Icons.place_outlined),
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
