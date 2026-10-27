import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/export_sheet.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';
import '../ui/search_field.dart';
import 'ls2_common.dart';
import 'ls2_vehicle_detail.dart';

/// تقارير لوكيشن سوليوشن — نظيرُ /system/ls2/reports: تقريران بفترةٍ واحدة.
///   • كلّ المركبات: صفٌّ لكلّ شاحنة (المسافة، ساعات الموتور، الوقود، الصيانة،
///     التنبيهات، الأعمال) مع ملخّصٍ أعلاه.
///   • مركبةٌ واحدة: ملفُّها كاملًا — الهويّة، المسافة اليوميّة، الرحلات، الوقود،
///     خطّةُ الصيانة، الصيانات، الإصلاحات، التنبيهات.
/// وكلاهما يُصدَّر Excel بأوراقٍ متعدّدة كالموقع. والوقودُ تقريرٌ لكلّ شاحنة
/// (~٢ث) فيُجلَب عند الطلب تتابعًا لا دفعةً واحدة.
class Ls2ReportsScreen extends StatefulWidget {
  const Ls2ReportsScreen({super.key});
  @override
  State<Ls2ReportsScreen> createState() => _Ls2ReportsScreenState();
}

const _sortKeys = <(String, String, String)>[
  ('km', 'كم في الفترة', 'Km in period'),
  ('plate', 'اللوحة', 'Plate'),
  ('driver', 'السائق', 'Driver'),
  ('avgKmPerDay', 'المتوسط اليومي', 'Per day'),
  ('engineHoursPeriod', 'ساعات الموتور', 'Engine hours'),
  ('odometerKm', 'العداد', 'Odometer'),
  ('kmPerL', 'الكفاءة', 'Efficiency'),
  ('kmToService', 'كم للصيانة', 'Km to service'),
  ('alertsTotal', 'التنبيهات', 'Alerts'),
];

class _Ls2ReportsScreenState extends State<Ls2ReportsScreen> with SingleTickerProviderStateMixin {
  late final TabController _tab = TabController(length: 2, vsync: this);
  DateTimeRange _range = ls2ThisMonthToDate();

  // ── تقرير الأسطول ──
  Map<String, dynamic>? _report;
  bool _loading = true;
  String? _error;
  String _q = '';
  // متحكِّمُ البحث عند الشاشة: تبديلُ التبويب يُعيد بناءَ الخانة فلا يضيع نصُّها.
  final _searchCtl = TextEditingController();
  String _maint = 'all';
  String _sortKey = 'km';
  bool _asc = false;
  // الوقودُ يُدمَج على الصفوف؛ و null يبقى null — شاحنةٌ بلا وقود CAN لا تُقرأ صفرًا.
  final Map<String, Map<String, dynamic>?> _fuel = {};
  (int, int)? _fuelProgress;
  int _seq = 0;

  // ── تقرير المركبة ──
  List<Map<String, dynamic>> _fleetList = [];
  String? _unitId;
  Map<String, dynamic>? _vr;
  bool _vrLoading = false;
  int _vrSeq = 0;

  late final void Function(dynamic) _onLive;

  String get _from => ls2Ymd(_range.start);
  String get _to => ls2Ymd(_range.end);

  @override
  void initState() {
    super.initState();
    _loadFleet();
    // نبضُ القياس كلَّ دقيقة يحمل `vehicles` ولا يغيّر ما هنا — فلا يُعاد التحميل له.
    _onLive = (d) { if (!(d is Map && d.containsKey('vehicles'))) _loadFleet(); };
    Live.instance.onData('ls2:updated', _onLive);
    _tab.addListener(() {
      if (_tab.index == 1 && _fleetList.isEmpty) _loadFleetList();
      if (mounted) setState(() {});
    });
  }

  @override
  void dispose() {
    Live.instance.offData('ls2:updated', _onLive);
    _tab.dispose();
    _searchCtl.dispose();
    super.dispose();
  }

  Future<void> _loadFleet() async {
    final seq = ++_seq;
    try {
      final d = await Api.instance.get('/api/ls2/reports/fleet?from=$_from&to=$_to');
      if (!mounted || seq != _seq) return;
      setState(() { _report = ls2Map(d); _loading = false; _error = null; });
    } catch (e) {
      if (mounted && seq == _seq) setState(() { _loading = false; _error = e is ApiException ? e.message : e.toString(); });
    }
  }

  Future<void> _loadFleetList() async {
    try {
      final d = await Api.instance.get('/api/ls2/vehicles');
      if (mounted) setState(() => _fleetList = ls2List(d['items']));
    } catch (_) {/* المنتقي يبقى فارغًا */}
  }

  Future<void> _loadVehicle() async {
    if (_unitId == null) return;
    final seq = ++_vrSeq;
    setState(() => _vrLoading = true);
    try {
      final d = await Api.instance.get('/api/ls2/reports/vehicle/$_unitId?from=$_from&to=$_to');
      if (!mounted || seq != _vrSeq) return;
      setState(() { _vr = ls2Map(d); _vrLoading = false; });
    } catch (e) {
      if (!mounted || seq != _vrSeq) return;
      setState(() { _vr = null; _vrLoading = false; });
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e is ApiException ? e.message : e.toString())));
    }
  }

  void _setRange(DateTimeRange r) {
    setState(() { _range = r; _fuel.clear(); _loading = true; });
    _loadFleet();
    _loadVehicle();
  }

  Map<String, dynamic> _withFuel(Map<String, dynamic> r) {
    final k = '${r['unitId']}';
    if (!_fuel.containsKey(k)) return r;
    final f = _fuel[k];
    return {...r, 'fuelL': f?['fuelL'], 'kmPerL': f?['efficiencyKmL']};
  }

  List<Map<String, dynamic>> get _allRows => ls2List(_report?['items']).map(_withFuel).toList();

  List<Map<String, dynamic>> get _rows {
    var list = _allRows;
    if (_maint != 'all') list = list.where((r) => r['maintenanceStatus'] == _maint).toList();
    final t = _q.trim().toLowerCase();
    if (t.isNotEmpty) {
      list = list.where((r) => '${r['plate']} ${r['driver']} ${r['name']} ${r['brand']} ${r['vin']} ${r['unitId']}'.toLowerCase().contains(t)).toList();
    }
    final dir = _asc ? 1 : -1;
    list.sort((a, b) {
      final va = a[_sortKey], vb = b[_sortKey];
      if (va is String || vb is String) return (va ?? '').toString().compareTo((vb ?? '').toString()) * dir;
      if (va == null) return 1; // الغائبُ يغرق أيًّا كان الاتجاه
      if (vb == null) return -1;
      return ((va as num) - (vb as num)).sign.toInt() * dir;
    });
    return list;
  }

  Future<void> _loadAllFuel() async {
    final list = _rows;
    setState(() => _fuelProgress = (0, list.length));
    for (var i = 0; i < list.length; i++) {
      final k = '${list[i]['unitId']}';
      try {
        final f = await Api.instance.get('/api/ls2/vehicles/$k/fuel?from=$_from&to=$_to');
        if (mounted) setState(() => _fuel[k] = ls2Map(f));
      } catch (_) {
        if (mounted) setState(() => _fuel[k] = null);
      }
      if (mounted) setState(() => _fuelProgress = (i + 1, list.length));
    }
    if (mounted) setState(() => _fuelProgress = null);
  }

  // ── Excel ────────────────────────────────────────────────────────────────
  static dynamic _n(dynamic v) => v ?? '';
  static final _kvCols = [ExportCol('البند', 'Item', (r) => r['k']), ExportCol('القيمة', 'Value', (r) => r['v'])];

  List<ExportCol> get _vehCols => [
        ExportCol('اللوحة', 'Plate', (r) => r['plate'] ?? ''),
        ExportCol('السائق', 'Driver', (r) => r['driver'] ?? ''),
        ExportCol('الماركة', 'Brand', (r) => r['brand'] ?? ''),
        ExportCol('سنة الصنع', 'Model year', (r) => r['modelYear'] ?? ''),
        ExportCol('النوع', 'Type', (r) => r['vehicleType'] ?? ''),
        ExportCol('رقم الشاسيه', 'VIN', (r) => r['vin'] ?? ''),
        ExportCol('شريحة الاتصال', 'SIM ICCID', (r) => r['simIccid'] ?? ''),
        ExportCol('كم في الفترة', 'Km in period', (r) => ls2Num(r['km'])?.round() ?? ''),
        ExportCol('المتوسط اليومي (كم)', 'Avg km/day', (r) => ls2Num(r['avgKmPerDay'])?.round() ?? ''),
        ExportCol('أيام النشاط', 'Active days', (r) => _n(r['activeDays'])),
        ExportCol('عداد البداية', 'Odometer start', (r) => _n(r['odoStart'])),
        ExportCol('عداد النهاية', 'Odometer end', (r) => _n(r['odoEnd'])),
        ExportCol('ساعات الموتور بالفترة', 'Engine hours (period)', (r) => _n(r['engineHoursPeriod'])),
        ExportCol('إجمالي ساعات الموتور', 'Engine hours (total)', (r) => _n(r['engineHoursTotal'])),
        ExportCol('الوقود (لتر)', 'Fuel (L)', (r) => r['fuelL'] == null ? tr('غير متاح', 'n/a') : ls2Num(r['fuelL'])?.round()),
        ExportCol('الكفاءة (كم/لتر)', 'Efficiency (km/L)', (r) => r['kmPerL'] ?? tr('غير متاح', 'n/a')),
        ExportCol('حالة الصيانة', 'Maintenance', (r) => tr(ls2Maint(r['maintenanceStatus']).$1, '${r['maintenanceStatus'] ?? ''}')),
        ExportCol('كم للصيانة', 'Km to service', (r) => _n(r['kmToService'])),
        ExportCol('الصيانة القادمة', 'Next service', (r) => r['nextServiceName'] ?? ''),
        ExportCol('تنبيهات حرِجة', 'Critical alerts', (r) => _n(r['alertsCritical'])),
        ExportCol('تحذيرات', 'Warnings', (r) => _n(r['alertsWarning'])),
        ExportCol('كل التنبيهات', 'All open alerts', (r) => _n(r['alertsTotal'])),
        ExportCol('صيانات بالفترة', 'Services in period', (r) => _n(r['servicesInPeriod'])),
        ExportCol('إصلاحات بالفترة', 'Repairs in period', (r) => _n(r['repairsInPeriod'])),
        ExportCol('تكلفة الإصلاحات', 'Repair cost', (r) => _n(r['repairCost'])),
        ExportCol('بيانات جزئية', 'Partial data', (r) => r['clipped'] == true ? tr('نعم', 'Yes') : ''),
      ];

  List<ExportCol> get _alertCols => [
        ExportCol('اللوحة', 'Plate', (r) => r['plate'] ?? ''),
        ExportCol('السائق', 'Driver', (r) => r['driver'] ?? ''),
        ExportCol('النوع', 'Type', (r) => ls2AlertType(r['type'])),
        ExportCol('الخطورة', 'Severity', (r) => r['severity'] ?? ''),
        const ExportCol('الوصف', 'Description', ls2AlertMessage),
        ExportCol('القيمة', 'Value', (r) => _n(r['value'])),
        ExportCol('الحد', 'Threshold', (r) => _n(r['threshold'])),
        ExportCol('أول ظهور', 'First seen', (r) => ls2DateTime(r['firstSeenAt'])),
        ExportCol('آخر ظهور', 'Last seen', (r) => ls2DateTime(r['lastSeenAt'])),
      ];

  List<ExportCol> get _serviceCols => [
        ExportCol('اللوحة', 'Plate', (r) => r['plate'] ?? ''),
        ExportCol('الخدمة', 'Service', (r) => r['intervalName'] ?? ''),
        ExportCol('التاريخ', 'Date', (r) => ls2Date(r['serviceDate'] ?? r['createdAt'])),
        ExportCol('العداد (كم)', 'Odometer (km)', (r) => _n(r['odometerKm'])),
        ExportCol('ساعات الموتور', 'Engine hours', (r) => _n(r['engineHours'])),
        ExportCol('التكلفة', 'Cost', (r) => _n(r['cost'])),
        ExportCol('نُفّذت بمعرفة', 'Performed by', (r) => r['performedByName'] ?? ''),
        ExportCol('ملاحظات', 'Notes', (r) => r['notes'] ?? ''),
      ];

  List<ExportCol> get _repairCols => [
        ExportCol('اللوحة', 'Plate', (r) => r['plate'] ?? ''),
        ExportCol('ما الذي حدث', 'What happened', (r) => r['title'] ?? ''),
        ExportCol('التصنيف', 'Category', (r) => ls2RepairCategory(r['category'])),
        ExportCol('الخطورة', 'Severity', (r) => r['severity'] ?? ''),
        ExportCol('الحالة', 'Status', (r) => r['status'] ?? ''),
        ExportCol('التاريخ', 'Date', (r) => r['repairDate'] == null ? '' : ls2Date(r['repairDate'])),
        ExportCol('العداد (كم)', 'Odometer (km)', (r) => _n(r['odometerKm'])),
        ExportCol('التكلفة', 'Cost', (r) => _n(r['cost'])),
        ExportCol('الورشة', 'Workshop', (r) => r['workshop'] ?? ''),
        ExportCol('القطع المستبدلة', 'Parts replaced', (r) => r['partsReplaced'] ?? ''),
      ];

  String get _period => '$_from → $_to';

  List<Map<String, dynamic>> _fleetSummary() {
    final rep = _report;
    if (rep == null) return const [];
    final s = ls2Map(rep['summary']);
    return [
      {'k': tr('فترة التقرير', 'Report period'), 'v': _period},
      {'k': tr('وقت الإصدار', 'Generated at'), 'v': ls2DateTime(rep['generatedAt'])},
      {'k': tr('إجمالي المركبات', 'Total vehicles'), 'v': s['vehicles']},
      {'k': tr('إجمالي المسافة', 'Total distance'), 'v': s['totalKm']},
      {'k': tr('متوسط المركبة', 'Avg per vehicle'), 'v': s['avgKm']},
      {'k': tr('مركبات تحركت', 'Vehicles moved'), 'v': s['movedVehicles']},
      {'k': tr('مركبات لم تتحرك', 'Idle vehicles'), 'v': s['idleVehicles']},
      {'k': tr('ساعات الموتور', 'Engine hours'), 'v': s['totalEngineHours'] ?? ''},
      {'k': tr('صيانة متأخرة', 'Service overdue'), 'v': s['overdueVehicles']},
      {'k': tr('صيانة قريبة', 'Service due'), 'v': s['dueVehicles']},
      {'k': tr('تنبيهات مفتوحة', 'Open alerts'), 'v': s['openAlerts']},
      {'k': tr('تنبيهات حرجة', 'Critical alerts'), 'v': s['criticalAlerts']},
      {'k': tr('تحذيرات', 'Warnings'), 'v': s['warningAlerts']},
      {'k': tr('صيانات منفّذة', 'Services done'), 'v': s['services']},
      {'k': tr('إصلاحات منفّذة', 'Repairs done'), 'v': s['repairs']},
      {'k': tr('إصلاحات منفّذة — التكلفة', 'Repairs done — Cost'), 'v': s['repairCost'] ?? ''},
    ];
  }

  Future<void> _export() async {
    if (_tab.index == 0) {
      final rep = _report;
      List<(String, List<ExportCol>, List<Map<String, dynamic>>)> build(List<Map<String, dynamic>> vehicles) => [
            (tr('الملخص', 'Summary'), _kvCols, _fleetSummary()),
            (tr('المركبات', 'Vehicles'), _vehCols, vehicles),
            (tr('التنبيهات', 'Alerts'), _alertCols, ls2List(rep?['alerts'])),
            (tr('الصيانات', 'Services'), _serviceCols, ls2List(rep?['services'])),
            (tr('الإصلاحات', 'Repairs'), _repairCols, ls2List(rep?['repairs'])),
          ];
      await ls2ExportMenu(context, fileName: 'ls2-fleet-report-${_from}_$_to', options: [
        ('كل المركبات', 'All vehicles', build(_allRows)),
        ('النتائج الحالية (بعد الفلتر)', 'Current filtered results', build(_rows)),
      ]);
      return;
    }
    final vr = _vr;
    if (vr == null) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(tr('اختر مركبة أولاً', 'Pick a vehicle first'))));
      return;
    }
    final v = ls2Map(vr['vehicle']);
    final p = ls2Map(v['profile']);
    final d = ls2Map(vr['distance']);
    final trips = vr['trips'] is Map ? ls2Map(vr['trips']) : null;
    final ts = ls2Map(trips?['summary']);
    final fuel = vr['fuel'] is Map ? ls2Map(vr['fuel']) : null;
    final m = ls2Map(vr['maintenance']);
    final tot = ls2Map(vr['totals']);
    final summary = [
      {'k': tr('اللوحة', 'Plate'), 'v': v['plate']},
      {'k': tr('السائق', 'Driver'), 'v': v['driver']},
      {'k': tr('فترة التقرير', 'Report period'), 'v': _period},
      {'k': tr('وقت الإصدار', 'Generated at'), 'v': ls2DateTime(vr['generatedAt'])},
      {'k': tr('الماركة', 'Brand'), 'v': p['brand'] ?? ''},
      {'k': tr('سنة الصنع', 'Model year'), 'v': p['modelYear'] ?? ''},
      {'k': tr('النوع', 'Type'), 'v': p['vehicleType'] ?? ''},
      {'k': tr('رقم الشاسيه', 'VIN'), 'v': p['vin'] ?? ''},
      {'k': tr('شريحة الاتصال', 'SIM ICCID'), 'v': p['simIccid'] ?? ''},
      {'k': tr('تاريخ التركيب', 'Install date'), 'v': p['installDate'] ?? ''},
      {'k': tr('المسافة المقطوعة', 'Distance traveled'), 'v': ls2Num(d['km'])?.round() ?? ''},
      {'k': tr('المتوسط اليومي', 'Per day'), 'v': ls2Num(d['avgKmPerDay'])?.round() ?? ''},
      {'k': tr('أيام النشاط', 'Active days'), 'v': '${d['activeDays']} / ${vr['days']}'},
      {'k': tr('ساعات الموتور', 'Engine hours'), 'v': d['engineHours'] ?? ''},
      {'k': tr('العداد', 'Odometer'), 'v': v['odometerKm'] ?? ''},
      {'k': tr('عدد الرحلات', 'Trips'), 'v': ts['tripCount'] ?? ''},
      {'k': tr('وقت القيادة', 'Drive time'), 'v': trips == null ? '' : ls2Duration(ts['totalDriveSec'])},
      {'k': tr('أقصى سرعة', 'Max speed'), 'v': ts['maxSpeed'] ?? ''},
      {'k': tr('الوقود المستهلك', 'Fuel used'), 'v': fuel?['fuelL'] ?? tr('غير متاح', 'n/a')},
      {'k': tr('الكفاءة', 'Efficiency'), 'v': fuel?['efficiencyKmL'] ?? tr('غير متاح', 'n/a')},
      {'k': tr('كم للصيانة', 'Km to service'), 'v': m['kmToService'] ?? ''},
      {'k': tr('الصيانة القادمة', 'Next service'), 'v': m['nextServiceName'] ?? ''},
      {'k': tr('صيانات منفّذة', 'Services done'), 'v': tot['services']},
      {'k': tr('إصلاحات منفّذة', 'Repairs done'), 'v': tot['repairs']},
      {'k': tr('تنبيهات مفتوحة', 'Open alerts'), 'v': tot['openAlerts']},
    ];
    await exportExcel(context, fileName: 'ls2-vehicle-report-${v['plate'] ?? ''}-${_from}_$_to', sheets: [
      (tr('الملخص', 'Summary'), _kvCols, summary),
      (tr('المسافة اليومية', 'Daily distance'), [
        ExportCol('التاريخ', 'Date', (r) => r['date'] ?? ''),
        ExportCol('المسافة (كم)', 'Distance (km)', (r) => _n(r['km'])),
        ExportCol('عدد الأيام المغطاة', 'Days covered', (r) => _n(r['spanDays'])),
      ], ls2List(d['daily'])),
      (tr('الرحلات', 'Trips'), [
        ExportCol('البداية', 'Start', (r) => r['beginTime'] ?? ''),
        ExportCol('مكان البداية', 'From', (r) => r['beginLocation'] ?? ''),
        ExportCol('النهاية', 'End', (r) => r['endTime'] ?? ''),
        ExportCol('مكان النهاية', 'To', (r) => r['endLocation'] ?? ''),
        ExportCol('المسافة (كم)', 'Distance (km)', (r) => _n(r['km'])),
        ExportCol('المدة', 'Duration', (r) => ls2Duration(r['durationSec'])),
        ExportCol('أقصى سرعة', 'Max speed', (r) => _n(r['maxSpeed'])),
        ExportCol('متوسط السرعة', 'Avg speed', (r) => _n(r['avgSpeed'])),
      ], ls2List(trips?['trips'])),
      (tr('الوقفات', 'Stops'), [
        ExportCol('المكان', 'Location', (r) => r['location'] ?? ''),
        ExportCol('من', 'From', (r) => r['from'] ?? ''),
        ExportCol('إلى', 'To', (r) => r['to'] ?? ''),
        ExportCol('المدة', 'Duration', (r) => ls2Duration(r['durationSec'])),
      ], ls2List(trips?['stops'])),
      (tr('خطة الصيانة', 'Service plan'), [
        ExportCol('الخدمة', 'Service', (r) => r['name'] ?? ''),
        ExportCol('كل (كم)', 'Interval (km)', (r) => _n(r['intervalKm'])),
        ExportCol('آخر صيانة', 'Last service', (r) => r['lastServiceAt'] == null ? '' : ls2Date(r['lastServiceAt'])),
        ExportCol('عداد آخر صيانة', 'Last service (km)', (r) => _n(r['lastServiceKm'])),
        ExportCol('تستحق عند (كم)', 'Due at (km)', (r) => _n(r['nextServiceKm'])),
        ExportCol('المتبقّي (كم)', 'Remaining (km)', (r) => _n(r['remainingKm'])),
        ExportCol('الحالة', 'Status', (r) => r['statusLevel'] ?? ''),
      ], ls2List(m['intervals'])),
      (tr('الصيانات', 'Services'), _serviceCols, ls2List(vr['services'])),
      (tr('الإصلاحات', 'Repairs'), _repairCols, ls2List(vr['repairs'])),
      (tr('التنبيهات', 'Alerts'), _alertCols, ls2List(vr['alerts'])),
    ]);
  }

  Future<void> _pickVehicle() async {
    if (_fleetList.isEmpty) await _loadFleetList();
    if (!mounted) return;
    final picked = await showModalBottomSheet<Map<String, dynamic>>(
      context: context, isScrollControlled: true, backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (c) {
        String q = '';
        return StatefulBuilder(builder: (c, setS) {
          final t = q.trim().toLowerCase();
          final list = _fleetList.where((v) => t.isEmpty || '${v['plate']} ${v['name']} ${v['driver']} ${v['unitId']}'.toLowerCase().contains(t)).toList();
          return SafeArea(child: Padding(
            padding: EdgeInsets.only(bottom: MediaQuery.of(c).viewInsets.bottom),
            child: SizedBox(
              height: MediaQuery.of(c).size.height * 0.7,
              child: Column(children: [
                Padding(
                  padding: const EdgeInsets.all(14),
                  child: SearchField(autofocus: true, hint: tr('اللوحة أو السائق…', 'Plate or driver…'), onChanged: (v) => setS(() => q = v)),
                ),
                Expanded(child: ListView.builder(
                  keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
                  itemCount: list.length,
                  itemBuilder: (c, i) {
                    final v = list[i];
                    return ListTile(
                      dense: true,
                      title: Text('${v['plate'] ?? v['name'] ?? ''}', style: const TextStyle(fontWeight: FontWeight.w700)),
                      subtitle: Text('${v['driver'] ?? '—'}'),
                      onTap: () => Navigator.pop(c, v),
                    );
                  },
                )),
              ]),
            ),
          ));
        });
      },
    );
    if (picked == null) return;
    setState(() => _unitId = '${picked['unitId']}');
    _loadVehicle();
  }

  @override
  Widget build(BuildContext context) {
    return AppScaffold(
      title: Text(tr('التقارير', 'Reports')),
      actions: [
        IconButton(tooltip: tr('تصدير Excel', 'Export to Excel'), icon: const Icon(Icons.file_download_outlined), onPressed: _export),
        IconButton(
          tooltip: tr('تحديث', 'Refresh'), icon: const Icon(Icons.refresh),
          onPressed: () => _tab.index == 0 ? _loadFleet() : _loadVehicle(),
        ),
      ],
      appBarBottom: TabBar(
        controller: _tab,
        labelColor: Colors.white, unselectedLabelColor: Colors.white70, indicatorColor: T.orange, indicatorWeight: 3,
        tabs: [
          Tab(text: '${tr('تقرير الأسطول', 'Fleet report')}${_report != null ? ' (${ls2List(_report!['items']).length})' : ''}'),
          Tab(text: tr('تقرير مركبة', 'Vehicle report')),
        ],
      ),
      body: Column(children: [
        const SizedBox(height: 8),
        Ls2RangeBar(value: _range, onChanged: _setRange),
        Expanded(child: TabBarView(controller: _tab, children: [_fleetTab(), _vehicleTab()])),
      ]),
    );
  }

  Widget _stat(String label, String value, {Color color = T.ink}) => SizedBox(
        width: 150,
        child: AppCard(
          padding: const EdgeInsets.all(10),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(label, style: const TextStyle(fontSize: 11, color: T.inkFaint, fontWeight: FontWeight.w600)),
            const SizedBox(height: 3),
            Text(value, style: TextStyle(fontSize: 16, fontWeight: FontWeight.w900, color: color)),
          ]),
        ),
      );

  Widget _fleetTab() {
    if (_loading && _report == null) {
      return ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(height: 90), SizedBox(height: 10), Shimmer(), SizedBox(height: 10), Shimmer()]);
    }
    if (_error != null && _report == null) {
      return ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _loadFleet(); });
    }
    final s = ls2Map(_report?['summary']);
    final rows = _rows;
    return RefreshIndicator(
      onRefresh: _loadFleet,
      child: ListView(keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag, padding: const EdgeInsets.fromLTRB(14, 6, 14, 24), children: [
        if (_error != null) Padding(padding: const EdgeInsets.only(bottom: 8), child: Text(_error!, style: const TextStyle(color: T.danger, fontSize: 12))),
        Wrap(spacing: 8, runSpacing: 8, children: [
          _stat(tr('إجمالي المركبات', 'Total vehicles'), ls2Fmt(s['vehicles'])),
          _stat(tr('إجمالي المسافة', 'Total distance'), ls2Km(s['totalKm']), color: T.orange),
          _stat(tr('متوسط المركبة', 'Avg per vehicle'), ls2Km(s['avgKm'])),
          _stat(tr('مركبات تحركت', 'Vehicles moved'), '${ls2Fmt(s['movedVehicles'])} / ${ls2Fmt(s['vehicles'])}'),
          _stat(tr('ساعات الموتور', 'Engine hours'), ls2Fmt(s['totalEngineHours'])),
          _stat(tr('صيانة متأخرة', 'Service overdue'), ls2Fmt(s['overdueVehicles']), color: (ls2Num(s['overdueVehicles']) ?? 0) > 0 ? T.danger : T.ink),
          _stat(tr('صيانة قريبة', 'Service due'), ls2Fmt(s['dueVehicles']), color: (ls2Num(s['dueVehicles']) ?? 0) > 0 ? T.warn : T.ink),
          _stat(tr('تنبيهات حرجة', 'Critical alerts'), ls2Fmt(s['criticalAlerts']), color: (ls2Num(s['criticalAlerts']) ?? 0) > 0 ? T.danger : T.ink),
          _stat(tr('تنبيهات مفتوحة', 'Open alerts'), ls2Fmt(s['openAlerts'])),
          _stat(tr('صيانات منفّذة', 'Services done'), ls2Fmt(s['services'])),
          _stat(tr('إصلاحات منفّذة', 'Repairs done'), ls2Fmt(s['repairs'])),
          _stat(tr('مركبات لم تتحرك', 'Idle vehicles'), ls2Fmt(s['idleVehicles'])),
        ]),
        if ((ls2Num(s['partialVehicles']) ?? 0) > 0)
          Padding(
            padding: const EdgeInsets.only(top: 8),
            child: Text(tr('${s['partialVehicles']} مركبة بياناتها جزئية في الفترة', '${s['partialVehicles']} vehicles have partial data in the period'),
                style: const TextStyle(fontSize: 12, color: T.warn, fontWeight: FontWeight.w700)),
          ),
        const SizedBox(height: 10),
        SearchField(controller: _searchCtl, hint: tr('بحث لوحة / سائق / ماركة / VIN…', 'Search plate / driver / brand / VIN…'), dense: true, onChanged: (v) => setState(() => _q = v)),
        const SizedBox(height: 8),
        Wrap(spacing: 6, runSpacing: 6, crossAxisAlignment: WrapCrossAlignment.center, children: [
          for (final f in const [('all', 'الكل', 'All'), ('due', 'صيانة قريبة', 'Service due'), ('overdue', 'صيانة متأخرة', 'Overdue')])
            ChoiceChip(
              selected: _maint == f.$1, label: Text(tr(f.$2, f.$3)), showCheckmark: false,
              selectedColor: T.orange, labelStyle: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: _maint == f.$1 ? Colors.white : T.navy),
              onSelected: (_) => setState(() => _maint = f.$1),
            ),
          PopupMenuButton<String>(
            tooltip: tr('ترتيب', 'Sort'),
            onSelected: (k) => setState(() {
              if (k == _sortKey) { _asc = !_asc; } else { _sortKey = k; _asc = k == 'plate' || k == 'driver'; }
            }),
            itemBuilder: (_) => [for (final k in _sortKeys) PopupMenuItem(value: k.$1, child: Text(tr(k.$2, k.$3)))],
            child: Chip(
              avatar: Icon(_asc ? Icons.arrow_upward : Icons.arrow_downward, size: 15),
              label: Text(tr(_sortKeys.firstWhere((k) => k.$1 == _sortKey).$2, _sortKeys.firstWhere((k) => k.$1 == _sortKey).$3), style: const TextStyle(fontSize: 12)),
            ),
          ),
          FilledButton.tonalIcon(
            onPressed: _fuelProgress != null || rows.isEmpty ? null : _loadAllFuel,
            icon: _fuelProgress != null ? const SizedBox(width: 14, height: 14, child: CircularProgressIndicator(strokeWidth: 2)) : const Icon(Icons.water_drop_outlined, size: 16),
            label: Text(_fuelProgress != null ? '${_fuelProgress!.$1}/${_fuelProgress!.$2}' : tr('تحميل الوقود', 'Load fuel')),
          ),
        ]),
        Padding(
          padding: const EdgeInsets.only(top: 4, bottom: 8),
          child: Text(tr('الوقود تقريرٌ من لوكيشن سوليوشن لكل شاحنة (~2ث) — يُحمَّل عند الطلب.', 'Fuel is a per-truck Location Solutions report (~2s each) — loaded on demand.'),
              style: const TextStyle(fontSize: 11, color: T.inkFaint)),
        ),
        if (rows.isEmpty)
          Padding(padding: const EdgeInsets.only(top: 40), child: EmptyState(icon: Icons.summarize_outlined, title: _q.trim().isNotEmpty ? tr('لا نتائج مطابقة للبحث', 'No matches') : tr('لا توجد بيانات', 'No data'))),
        for (final r in rows) _fleetRow(r),
      ]),
    );
  }

  Widget _fleetRow(Map<String, dynamic> r) {
    final ms = ls2Maint(r['maintenanceStatus']);
    final st = ls2Status(r['status']);
    final k = '${r['unitId']}';
    final kmTo = ls2Num(r['kmToService']);
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Pressable(
        onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => Ls2VehicleDetailScreen(vehicleId: k, plate: '${r['plate'] ?? ''}'))),
        child: AppCard(
          topAccent: ms.$3,
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(children: [
              Container(width: 8, height: 8, decoration: BoxDecoration(color: st.$3, shape: BoxShape.circle)),
              const SizedBox(width: 6),
              Text('${r['plate'] ?? ''}', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14)),
              if (r['clipped'] == true) const Text(' *', style: TextStyle(color: T.warn, fontWeight: FontWeight.w900)),
              const SizedBox(width: 6),
              Expanded(child: Text('${r['driver'] ?? '—'}', style: const TextStyle(fontSize: 12, color: T.inkSoft), overflow: TextOverflow.ellipsis)),
              Text(ls2Km(r['km']), style: const TextStyle(fontWeight: FontWeight.w900, color: T.orange)),
            ]),
            if ((r['brand'] ?? '').toString().isNotEmpty)
              Text('${r['brand']}${(r['modelYear'] ?? '').toString().isNotEmpty ? ' · ${r['modelYear']}' : ''}', style: const TextStyle(fontSize: 11, color: T.inkFaint)),
            const SizedBox(height: 6),
            Wrap(spacing: 6, runSpacing: 6, children: [
              Chip2('${tr('يوميًا', 'Per day')}: ${ls2Fmt(r['avgKmPerDay'])}', T.inkSoft),
              Chip2('${tr('ساعات الموتور', 'Engine h')}: ${ls2Fmt(r['engineHoursPeriod'])}', T.inkSoft),
              Chip2('${tr('العداد', 'Odo')}: ${ls2Km(r['odometerKm'])}', T.navy),
              if (_fuel.containsKey(k))
                Chip2(
                  r['fuelL'] == null ? tr('الوقود: غير متاح', 'Fuel: n/a') : '${tr('الوقود', 'Fuel')}: ${ls2Fmt(r['fuelL'])} ${tr('لتر', 'L')} · ${r['kmPerL'] ?? '—'} ${tr('كم/لتر', 'km/L')}',
                  T.cyan, icon: Icons.water_drop_outlined,
                ),
              Chip2(
                kmTo == null ? tr(ms.$1, ms.$2) : '${tr(ms.$1, ms.$2)} · ${kmTo < 0 ? '−${ls2Fmt(kmTo.abs())}' : ls2Fmt(kmTo)}',
                ms.$3, icon: Icons.build_outlined,
              ),
              if ((ls2Num(r['alertsCritical']) ?? 0) > 0) Chip2('${r['alertsCritical']}', T.danger, icon: Icons.warning_amber_rounded),
              if ((ls2Num(r['alertsWarning']) ?? 0) > 0) Chip2('${r['alertsWarning']}', T.warn, icon: Icons.warning_amber_rounded),
              if ((ls2Num(r['alertsInfo']) ?? 0) > 0) Chip2('${r['alertsInfo']}', T.inkFaint, icon: Icons.info_outline),
              if ((ls2Num(r['servicesInPeriod']) ?? 0) > 0) Chip2('${r['servicesInPeriod']}', T.success, icon: Icons.build_circle_outlined),
              if ((ls2Num(r['repairsInPeriod']) ?? 0) > 0) Chip2('${r['repairsInPeriod']}', T.warn, icon: Icons.handyman_outlined),
            ]),
          ]),
        ),
      ),
    );
  }

  Widget _card(String title, IconData icon, List<Widget> children) => Padding(
        padding: const EdgeInsets.only(bottom: 10),
        child: AppCard(
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Row(children: [
              Icon(icon, size: 18, color: T.orange),
              const SizedBox(width: 6),
              Expanded(child: Text(title, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14))),
            ]),
            const SizedBox(height: 8),
            ...children,
          ]),
        ),
      );

  Widget _info(String label, dynamic value) {
    final v = (value ?? '').toString();
    if (v.isEmpty) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(bottom: 4),
      child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        SizedBox(width: 120, child: Text(label, style: const TextStyle(fontSize: 11.5, color: T.inkFaint))),
        Expanded(child: SelectableText(v, style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600))),
      ]),
    );
  }

  Widget _vehicleTab() {
    final vr = _vr;
    return ListView(padding: const EdgeInsets.fromLTRB(14, 6, 14, 24), children: [
      Row(children: [
        FilledButton.icon(
          style: FilledButton.styleFrom(backgroundColor: T.orange),
          onPressed: _pickVehicle,
          icon: const Icon(Icons.local_shipping_outlined, size: 18),
          label: Text(vr != null ? tr('تغيير المركبة', 'Change vehicle') : tr('اختر مركبة', 'Pick a vehicle')),
        ),
        const SizedBox(width: 10),
        if (vr != null)
          Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text('${ls2Map(vr['vehicle'])['plate'] ?? ''}', style: const TextStyle(fontWeight: FontWeight.w900)),
            Text('${ls2Map(vr['vehicle'])['driver'] ?? '—'} · $_period', style: const TextStyle(fontSize: 11, color: T.inkFaint)),
          ])),
      ]),
      if (vr != null)
        Align(
          alignment: AlignmentDirectional.centerStart,
          child: TextButton.icon(
            onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => Ls2VehicleDetailScreen(vehicleId: '${ls2Map(vr['vehicle'])['unitId'] ?? _unitId}', plate: '${ls2Map(vr['vehicle'])['plate'] ?? ''}'))),
            icon: const Icon(Icons.open_in_new, size: 16),
            label: Text(tr('ملف المركبة الكامل', 'Full vehicle profile')),
          ),
        ),
      const SizedBox(height: 8),
      if (_unitId == null)
        AppCard(child: Text(tr('اختر مركبة لعرض تقريرها الكامل عن الفترة.', 'Pick a vehicle to see its full report for the period.'), textAlign: TextAlign.center, style: const TextStyle(color: T.inkFaint))),
      if (_vrLoading)
        AppCard(child: Column(children: [
          const CircularProgressIndicator(color: T.orange),
          const SizedBox(height: 10),
          Text(tr('جارٍ بناء التقرير…', 'Building the report…')),
          Text(tr('الرحلات والوقود تقارير حيّة من لوكيشن سوليوشن — قد تأخذ ثوانٍ.', 'Trips and fuel are live Location Solutions reports — may take a few seconds.'), style: const TextStyle(fontSize: 11, color: T.inkFaint), textAlign: TextAlign.center),
        ])),
      if (!_vrLoading && vr != null) ..._vehicleBody(vr),
    ]);
  }

  List<Widget> _vehicleBody(Map<String, dynamic> vr) {
    final v = ls2Map(vr['vehicle']);
    final p = ls2Map(v['profile']);
    final d = ls2Map(vr['distance']);
    final trips = vr['trips'] is Map ? ls2Map(vr['trips']) : null;
    final ts = ls2Map(trips?['summary']);
    final fuel = vr['fuel'] is Map ? ls2Map(vr['fuel']) : null;
    final m = ls2Map(vr['maintenance']);
    final tot = ls2Map(vr['totals']);
    final daily = ls2List(d['daily']);
    final maxDaily = daily.fold<num>(1, (a, x) => (ls2Num(x['km']) ?? 0) > a ? ls2Num(x['km'])! : a);
    final services = ls2List(vr['services']);
    final repairs = ls2List(vr['repairs']);
    final alerts = ls2List(vr['alerts']);
    return [
      Wrap(spacing: 8, runSpacing: 8, children: [
        _stat(tr('المسافة المقطوعة', 'Distance'), ls2Km(d['km']), color: T.orange),
        _stat(tr('يوميًا', 'Per day'), ls2Fmt(d['avgKmPerDay'])),
        _stat(tr('أيام النشاط', 'Active days'), '${ls2Fmt(d['activeDays'])} / ${ls2Fmt(vr['days'])}'),
        _stat(tr('ساعات الموتور', 'Engine hours'), ls2Fmt(d['engineHours'])),
        _stat(tr('العداد', 'Odometer'), ls2Km(v['odometerKm'])),
        _stat(tr('تنبيهات مفتوحة', 'Open alerts'), ls2Fmt(tot['openAlerts']), color: (ls2Num(tot['criticalAlerts']) ?? 0) > 0 ? T.danger : T.ink),
      ]),
      if (d['clipped'] == true)
        Padding(padding: const EdgeInsets.only(top: 6), child: Text(tr('بيانات جزئية في هذه الفترة', 'Partial data for this period'), style: const TextStyle(fontSize: 12, color: T.warn, fontWeight: FontWeight.w700))),
      const SizedBox(height: 10),
      _card(tr('الهوية', 'Identity'), Icons.local_shipping_outlined, [
        _info(tr('اللوحة', 'Plate'), v['plate']),
        _info(tr('السائق', 'Driver'), v['driver']),
        _info(tr('الماركة', 'Brand'), p['brand']),
        _info(tr('سنة الصنع', 'Model year'), p['modelYear']),
        _info(tr('النوع', 'Type'), p['vehicleType']),
        _info(tr('رقم الشاسيه', 'VIN'), p['vin']),
        _info(tr('شريحة الاتصال', 'SIM ICCID'), p['simIccid']),
        _info(tr('تاريخ التركيب', 'Install date'), p['installDate']),
        _info(tr('رقم الوحدة', 'LS unit id'), p['lsUnitId']),
        _info(tr('ماركة الكاوتش', 'Tire brand'), v['tireBrand']),
        for (final e in ls2List(p['extra'])) _info('${e['label']}', e['value']),
      ]),
      _card(tr('النشاط · الوقود', 'Activity · Fuel'), Icons.route_outlined, [
        if (trips != null)
          Wrap(spacing: 6, runSpacing: 6, children: [
            Chip2('${tr('الرحلات', 'Trips')}: ${ls2Fmt(ts['tripCount'])}', T.navy),
            Chip2('${tr('الوقفات', 'Stops')}: ${ls2Fmt(ts['stopCount'])}', T.navy),
            Chip2('${tr('وقت القيادة', 'Drive time')}: ${ls2Duration(ts['totalDriveSec'])}', T.navy),
            Chip2('${tr('أقصى سرعة', 'Max speed')}: ${ls2Fmt(ts['maxSpeed'])} km/h', T.navy),
          ])
        else
          Text(tr('لا توجد بيانات', 'No data'), style: const TextStyle(fontSize: 12, color: T.inkFaint)),
        const Divider(),
        if (fuel != null)
          Wrap(spacing: 6, runSpacing: 6, children: [
            Chip2('${tr('الوقود', 'Fuel')}: ${fuel['fuelL'] == null ? tr('غير متاح', 'n/a') : '${ls2Fmt(fuel['fuelL'])} ${tr('لتر', 'L')}'}', T.cyan),
            Chip2('${tr('الكفاءة', 'Efficiency')}: ${fuel['efficiencyKmL'] ?? tr('غير متاح', 'n/a')} ${tr('كم/لتر', 'km/L')}', T.cyan),
            Chip2('${tr('تشغيل الموتور', 'Engine on')}: ${ls2Duration(fuel['engineOnSec'])}', T.cyan),
            Chip2('${tr('المسافة', 'Distance')}: ${ls2Km(fuel['distanceKm'])}', T.cyan),
          ])
        else
          Text(tr('لا توجد بيانات وقود لهذه المركبة', 'No fuel data for this vehicle'), style: const TextStyle(fontSize: 12, color: T.inkFaint)),
      ]),
      if (daily.isNotEmpty)
        _card(tr('المسافة اليومية', 'Daily distance'), Icons.speed_outlined, [
          SizedBox(
            height: 120,
            child: Row(crossAxisAlignment: CrossAxisAlignment.end, children: [
              for (final x in daily)
                Expanded(
                  child: Tooltip(
                    message: '${x['date']} · ${ls2Km(x['km'])}',
                    child: Column(mainAxisAlignment: MainAxisAlignment.end, children: [
                      Container(
                        margin: const EdgeInsets.symmetric(horizontal: 0.5),
                        height: ((ls2Num(x['km']) ?? 0) / maxDaily * 100).clamp(2, 100).toDouble(),
                        color: (ls2Num(x['spanDays']) ?? 1) > 1 ? const Color(0xFFFCD34D) : T.orange,
                      ),
                    ]),
                  ),
                ),
            ]),
          ),
        ]),
      _card(tr('خطة الصيانة', 'Service plan'), Icons.build_outlined, [
        for (final iv in ls2List(m['intervals'])) () {
          final st = ls2Maint(iv['statusLevel']);
          final rem = ls2Num(iv['remainingKm']);
          return ListTile(
            dense: true, contentPadding: EdgeInsets.zero,
            title: Text('${iv['name'] ?? ''}', style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13)),
            subtitle: Text('${tr('آخر صيانة', 'Last service')}: ${ls2Date(iv['lastServiceAt'])}${iv['lastServiceKm'] != null ? ' · ${ls2Km(iv['lastServiceKm'])}' : ''}', style: const TextStyle(fontSize: 11)),
            trailing: Chip2(rem == null ? '—' : rem < 0 ? '−${ls2Fmt(rem.abs())} ${tr('متأخرة', 'over')}' : '${ls2Fmt(rem)} ${tr('متبقي', 'left')}', st.$3),
          );
        }(),
        if (ls2List(m['intervals']).isEmpty) Text(tr('لا توجد بيانات', 'No data'), style: const TextStyle(fontSize: 12, color: T.inkFaint)),
      ]),
      _card('${tr('سجل الصيانات', 'Service history')} (${tot['services'] ?? services.length})', Icons.build_circle_outlined, [
        if (services.isEmpty) Text(tr('لا توجد بيانات', 'No data'), style: const TextStyle(fontSize: 12, color: T.inkFaint)),
        for (final sv in services)
          ListTile(
            dense: true, contentPadding: EdgeInsets.zero,
            title: Text('${sv['intervalName'] ?? sv['serviceType'] ?? ''}', style: const TextStyle(fontSize: 13)),
            subtitle: Text('${ls2Date(sv['serviceDate'] ?? sv['createdAt'])} · ${ls2Km(sv['odometerKm'])}${(sv['performedByName'] ?? '').toString().isNotEmpty ? ' · ${sv['performedByName']}' : ''}', style: const TextStyle(fontSize: 11)),
            trailing: sv['cost'] == null ? null : Text(ls2Fmt(sv['cost'])),
          ),
      ]),
      _card('${tr('الإصلاحات', 'Repairs')} (${tot['repairs'] ?? repairs.length})', Icons.handyman_outlined, [
        if (repairs.isEmpty) Text(tr('لا إصلاحات', 'No repairs'), style: const TextStyle(fontSize: 12, color: T.inkFaint)),
        for (final rp in repairs)
          ListTile(
            dense: true, contentPadding: EdgeInsets.zero,
            title: Text('${rp['title'] ?? ''}', style: const TextStyle(fontSize: 13)),
            subtitle: Text('${ls2Date(rp['repairDate'])} · ${ls2RepairCategory(rp['category'])}${(rp['workshop'] ?? '').toString().isNotEmpty ? ' · ${rp['workshop']}' : ''}', style: const TextStyle(fontSize: 11)),
            trailing: rp['cost'] == null ? null : Text(ls2Fmt(rp['cost'])),
          ),
      ]),
      _card('${tr('التنبيهات', 'Alerts')} (${alerts.length})', Icons.warning_amber_rounded, [
        if (alerts.isEmpty) Text(tr('لا توجد بيانات', 'No data'), style: const TextStyle(fontSize: 12, color: T.inkFaint)),
        for (final a in alerts) () {
          final sv = ls2Severity(a['severity']);
          return ListTile(
            dense: true, contentPadding: EdgeInsets.zero,
            title: Text(ls2AlertType(a['type']), style: const TextStyle(fontSize: 13)),
            subtitle: Text('${ls2AlertMessage(a)}\n${ls2DateTime(a['lastSeenAt'])}', style: const TextStyle(fontSize: 11)),
            trailing: Chip2(tr(sv.$1, sv.$2), sv.$3),
          );
        }(),
      ]),
    ];
  }
}
