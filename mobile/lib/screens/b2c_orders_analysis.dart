import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/export_sheet.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';
import 'b2c_orders_report.dart';
import 'dash_specs.dart' show B2cProjectsTotal;

/// تحليل الأوردرات — مطابقٌ لـ `/system/b2c/orders-analysis`:
/// فلاتر (سنة · شهر · مشروع · فرع · مندوب · من/إلى)، شريطُ الشهور، ثلاثةُ
/// تبويبات (نظرة عامة · تقييم المناديب · تحليلات)، تفاصيلُ اليوم، ملفُّ المندوب،
/// قائمةُ «دون الهدف»، وتصديرٌ Excel بثلاثة نطاقات كالموقع.
class B2cOrdersAnalysisScreen extends StatefulWidget {
  const B2cOrdersAnalysisScreen({super.key});
  @override
  State<B2cOrdersAnalysisScreen> createState() => _B2cOrdersAnalysisScreenState();
}

Map<String, dynamic> _m(dynamic v) => v is Map ? v.cast<String, dynamic>() : <String, dynamic>{};
List<Map<String, dynamic>> _l(dynamic v) => [for (final x in (v as List?) ?? const []) _m(x)];
num _n(dynamic v) => v is num ? v : num.tryParse('${v ?? ''}') ?? 0;
String _pct(dynamic v) => '${_n(v).toStringAsFixed(1)}%';
String _fmt(dynamic v) {
  final s = _n(v).round().toString();
  return s.replaceAllMapped(RegExp(r'\B(?=(\d{3})+(?!\d))'), (_) => ',');
}

const _monthsAr = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
const _monthsEn = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const _dowAr = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
const _dowEn = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
String _monthName(int m) => tr(_monthsAr[(m - 1).clamp(0, 11)], _monthsEn[(m - 1).clamp(0, 11)]);
String _monthKey(String key) {
  final p = key.split('-');
  return p.length < 2 ? key : '${_monthName(int.tryParse(p[1]) ?? 1)} ${p[0]}';
}

Color _perfColor(num p) => p >= 100 ? const Color(0xFF10B981) : p >= 80 ? const Color(0xFFF59E0B) : const Color(0xFFEF4444);
Color _gradeColor(String g) => g == 'A+' || g == 'A' ? const Color(0xFF10B981) : g == 'B' ? const Color(0xFF3B82F6) : g == 'C' ? const Color(0xFFF59E0B) : const Color(0xFFEF4444);
String _trend(String t) => t == 'rising' ? tr('صاعد', 'Rising') : t == 'falling' ? tr('هابط', 'Falling') : tr('مستقر', 'Stable');

class _B2cOrdersAnalysisScreenState extends State<B2cOrdersAnalysisScreen> {
  int? _year, _month;
  String _project = '', _branch = '', _rep = '', _from = '', _to = '';
  List<Map<String, dynamic>> _projects = [], _branches = [], _reps = [];
  List<Map<String, dynamic>> _months = [];
  bool _monthsInit = false;
  Map<String, dynamic>? _d;
  List<Map<String, dynamic>> _evals = [];
  bool _loading = true;
  String _tab = 'overview';
  String _grade = '';
  int _seq = 0;
  final Map<String, Map<String, dynamic>> _cache = {};
  static const _events = ['b2c:order:upserted', 'b2c:bulk:upserted', 'b2c:rep:created', 'b2c:rep:deleted', 'b2c:cleanup'];

  @override
  void initState() {
    super.initState();
    _options();
    _initMonths();
    for (final e in _events) { Live.instance.on(e, _onLive); }
  }

  @override
  void dispose() {
    for (final e in _events) { Live.instance.off(e, _onLive); }
    super.dispose();
  }

  void _onLive() {
    if (!mounted) return;
    _cache.clear();
    _options();
    _load();
    _loadMonths();
    if (_tab == 'evaluation') _loadEvals();
  }

  Future<void> _options() async {
    try {
      final r = await Future.wait([
        Api.instance.get('/api/b2c/projects'),
        Api.instance.get('/api/branches?active=true'),
        Api.instance.get('/api/b2c/reps'),
      ]);
      if (!mounted) return;
      setState(() { _projects = _l(r[0]['projects']); _branches = _l(r[1]['branches']); _reps = _l(r[2]['reps']); });
    } catch (_) {}
  }

  String get _scopeQs => [
        if (_project.isNotEmpty) 'project=$_project',
        if (_branch.isNotEmpty) 'branch=$_branch',
      ].join('&');

  Future<void> _loadMonths() async {
    try {
      final d = await Api.instance.get('/api/b2c/months?$_scopeQs');
      if (mounted) setState(() => _months = _l(d['months']));
    } catch (_) {}
  }

  // أوّلَ مرّة: يُفتح على آخر شهرٍ فيه بيانات — كالموقع.
  Future<void> _initMonths() async {
    await _loadMonths();
    if (!mounted) return;
    if (!_monthsInit && _months.isNotEmpty && _year == null && _month == null && _from.isEmpty && _to.isEmpty) {
      _year = _n(_months.last['year']).toInt();
      _month = _n(_months.last['month']).toInt();
    }
    _monthsInit = true;
    _load();
  }

  String get _qs => [
        if (_year != null) 'year=$_year',
        if (_month != null) 'month=$_month',
        if (_project.isNotEmpty) 'project=$_project',
        if (_branch.isNotEmpty) 'branch=$_branch',
        if (_rep.isNotEmpty) 'rep=$_rep',
        if (_from.isNotEmpty) 'dateFrom=$_from',
        if (_to.isNotEmpty) 'dateTo=$_to',
      ].join('&');

  Future<void> _load() async {
    final mine = ++_seq;
    final key = _qs;
    final cached = _cache[key];
    setState(() { if (cached != null) { _d = cached; _loading = false; } else { _loading = true; } });
    try {
      final d = _m(await Api.instance.get('/api/b2c/dashboard?$key'));
      if (!mounted || mine != _seq) return;
      _cache[key] = d;
      if (_cache.length > 8) _cache.remove(_cache.keys.first);
      setState(() { _d = d; _loading = false; });
    } catch (_) {
      if (mounted && mine == _seq) setState(() => _loading = false);
    }
  }

  Future<void> _loadEvals() async {
    try {
      final d = await Api.instance.get('/api/b2c/evaluations?$_scopeQs');
      if (mounted) setState(() => _evals = _l(d['evaluations']));
    } catch (_) {}
  }

  void _changed({bool scope = false}) {
    if (scope) { _loadMonths(); if (_tab == 'evaluation') _loadEvals(); }
    _load();
  }

  void _clear() {
    setState(() { _project = ''; _branch = ''; _rep = ''; _from = ''; _to = ''; _year = null; _month = null; });
    _changed(scope: true);
  }

  String _scopeText() => [
        _year != null && _month != null ? '${_monthName(_month!)} $_year' : tr('كل الشهور', 'All months'),
        if (_project.isNotEmpty) '${_projects.firstWhere((p) => '${p['_id']}' == _project, orElse: () => {})['name'] ?? ''}',
        if (_branch.isNotEmpty) '${_branches.firstWhere((p) => '${p['_id']}' == _branch, orElse: () => {})['name'] ?? ''}',
        if (_rep.isNotEmpty) '${_reps.firstWhere((p) => '${p['_id']}' == _rep, orElse: () => {})['englishName'] ?? ''}',
        if (_from.isNotEmpty || _to.isNotEmpty) '${_from.isEmpty ? '…' : _from} → ${_to.isEmpty ? '…' : _to}',
      ].where((x) => x.isNotEmpty).join(' · ');

  // ── التصدير: الأوراقُ والأعمدةُ نفسُها في الموقع ─────────────────────────
  List<(String, List<ExportCol>, List<Map<String, dynamic>>)> _overviewSheets(Map<String, dynamic> d, String scope) {
    final k = _m(d['kpis']);
    final kpiRows = <Map<String, dynamic>>[
      {'label': tr('النطاق', 'Scope'), 'value': scope},
      {'label': tr('إجمالي الطلبات', 'Total orders'), 'value': _n(k['totalOrders'])},
      for (final p in _l(d['byProject'])) {'label': '${tr('إجمالي الطلبات', 'Total orders')} — ${p['name']}', 'value': _n(p['totalOrders'])},
      {'label': tr('مناديب نشطون', 'Active reps'), 'value': _n(k['repsActive'])},
      {'label': tr('متوسط الأداء', 'Avg performance'), 'value': _pct(k['avgPerformance'])},
      {'label': tr('فوق الهدف', 'Above target'), 'value': _n(k['aboveTargetReps'])},
      {'label': tr('على المسار', 'On track'), 'value': _n(k['onTrackReps'])},
      {'label': tr('تحت الهدف', 'Below target'), 'value': _n(k['belowTargetReps'])},
      {'label': tr('أفضل مندوب', 'Best rep'), 'value': _m(k['bestRep'])['englishName'] ?? '—'},
      {'label': tr('أفضل يوم', 'Best day'), 'value': _m(k['bestDay'])['dateKey'] ?? '—'},
      {'label': tr('إجمالي أيام التوقف', 'Total days off'), 'value': _n(k['totalDaysOff'])},
      {'label': tr('أيام بلا بيانات', 'No-data days'), 'value': _n(k['totalNoDataDays'])},
    ];
    return [
      (tr('المؤشرات', 'KPIs'), [ExportCol('المؤشر', 'Metric', (r) => r['label']), ExportCol('القيمة', 'Value', (r) => r['value'])], kpiRows),
      (tr('حسب المندوب', 'By rep'), [
        ExportCol('المندوب', 'Rep', (r) => r['englishName']), ExportCol('الاسم العربي', 'Arabic name', (r) => r['arabicName']),
        ExportCol('المشروع', 'Project', (r) => r['project'] ?? '—'), ExportCol('الفرع', 'Branch', (r) => r['branch'] ?? r['city'] ?? '—'),
        ExportCol('الهدف الشهري', 'Monthly target', (r) => r['monthlyTarget']), ExportCol('إجمالي الطلبات', 'Total orders', (r) => r['totalOrders']),
        ExportCol('أيام العمل', 'Working days', (r) => r['workingDays']), ExportCol('المعدل اليومي', 'Daily rate', (r) => _n(r['dailyRate']).toStringAsFixed(1)),
        ExportCol('الأداء', 'Performance', (r) => _pct(r['performancePercent'])),
      ], _l(d['byRep'])),
      (tr('الأيام', 'Days'), [
        ExportCol('اليوم', 'Date', (r) => r['dateKey']), ExportCol('إجمالي الطلبات', 'Total orders', (r) => r['totalOrders']),
        ExportCol('مناديب نشطون', 'Active reps', (r) => r['repsActive']), ExportCol('لم يعمل', "Didn't work", (r) => r['repsNotWorked'] ?? 0),
        ExportCol('الهدف', 'Target', (r) => r['targetSum'] ?? '—'), ExportCol('نسبة التحقيق', 'Achievement', (r) => r['achievementPercent'] == null ? '—' : _pct(r['achievementPercent'])),
        ExportCol('فوق الهدف', 'Above target', (r) => r['repsAboveTarget'] ?? 0),
      ], _l(d['byDay'])),
      (tr('حسب الشهر', 'By month'), [
        ExportCol('الشهر', 'Month', (r) => _monthKey('${r['key']}')), ExportCol('إجمالي الطلبات', 'Total orders', (r) => r['totalOrders']),
        ExportCol('أيام العمل', 'Working days', (r) => r['workingDays']), ExportCol('مناديب نشطون', 'Active reps', (r) => r['repsActive']),
        ExportCol('المعدل اليومي', 'Daily rate', (r) => _n(r['avgDailyRate']).toStringAsFixed(1)),
      ], _l(d['byMonth'])),
      (tr('حسب المشروع', 'By project'), [
        ExportCol('المشروع', 'Project', (r) => r['name']), ExportCol('إجمالي الطلبات', 'Total orders', (r) => r['totalOrders']), ExportCol('مناديب نشطون', 'Active reps', (r) => r['repsActive']),
      ], _l(d['byProject'])),
      (tr('حسب الفرع', 'By branch'), [
        ExportCol('الفرع', 'Branch', (r) => r['name']), ExportCol('المدينة', 'City', (r) => r['city'] ?? '—'),
        ExportCol('إجمالي الطلبات', 'Total orders', (r) => r['totalOrders']), ExportCol('مناديب نشطون', 'Active reps', (r) => r['repsActive']),
      ], _l(d['byBranch'])),
    ];
  }

  List<(String, List<ExportCol>, List<Map<String, dynamic>>)> _analyticsSheets(Map<String, dynamic> d) {
    final delta = [
      ExportCol('المندوب', 'Rep', (r) => r['englishName']),
      ExportCol('أول شهر (طلب/يوم)', 'First month (orders/day)', (r) => _n(r['firstMonthAvg']).toStringAsFixed(1)),
      ExportCol('آخر شهر (طلب/يوم)', 'Last month (orders/day)', (r) => _n(r['lastMonthAvg']).toStringAsFixed(1)),
      ExportCol('نسبة التغيّر', 'Change', (r) => _pct(r['deltaPercent'])),
    ];
    return [
      (tr('الأكثر تحسّنًا', 'Improvers'), delta, _l(d['topImprovers'])),
      (tr('الأكثر تراجعًا', 'Decliners'), delta, _l(d['topDecliners'])),
      (tr('الأكثر ثباتًا', 'Most consistent'), [
        ExportCol('المندوب', 'Rep', (r) => r['englishName']), ExportCol('إجمالي الطلبات', 'Total orders', (r) => r['totalOrders']),
        ExportCol('أشهر النشاط', 'Months active', (r) => r['monthsActive']), ExportCol('الثبات', 'Consistency', (r) => '${_n(r['consistency']).toStringAsFixed(0)}%'),
      ], _l(d['mostConsistent'])),
      (tr('أفضل الأيام الفردية', 'Best single days'), [
        ExportCol('المندوب', 'Rep', (r) => r['englishName']), ExportCol('اليوم', 'Date', (r) => r['dateKey']),
        ExportCol('المشروع', 'Project', (r) => r['project'] ?? '—'), ExportCol('إجمالي الطلبات', 'Total orders', (r) => r['orders']),
      ], _l(d['bestSingleDays'])),
      (tr('أفضل أيام الفريق', 'Best team days'), [
        ExportCol('اليوم', 'Date', (r) => r['dateKey']), ExportCol('إجمالي الطلبات', 'Total orders', (r) => r['totalOrders']), ExportCol('مناديب نشطون', 'Active reps', (r) => r['repsActive']),
      ], _l(d['topTeamDays'])),
      (tr('أيام الأسبوع', 'Day of week'), [
        ExportCol('يوم الأسبوع', 'Day of week', (r) => tr(_dowAr[_n(r['dow']).toInt() % 7], _dowEn[_n(r['dow']).toInt() % 7])),
        ExportCol('متوسط الطلبات لكل مندوب', 'Avg orders per rep', (r) => _n(r['avgPerWorker']).toStringAsFixed(1)),
        ExportCol('إجمالي الطلبات', 'Total orders', (r) => r['totalOrders']),
      ], _l(d['byDayOfWeek'])),
    ];
  }

  (String, List<ExportCol>, List<Map<String, dynamic>>) _evalSheet(List<Map<String, dynamic>> rows) => (tr('تقييم المناديب', 'Rep evaluation'), [
        ExportCol('المندوب', 'Rep', (r) => r['englishName']), ExportCol('الاسم العربي', 'Arabic name', (r) => r['arabicName']),
        ExportCol('المشروع', 'Project', (r) => r['project'] ?? '—'), ExportCol('الدرجة', 'Grade', (r) => r['grade']),
        ExportCol('إجمالي الطلبات', 'Total orders', (r) => r['totalOrders']), ExportCol('أشهر النشاط', 'Months active', (r) => r['monthsActive']),
        ExportCol('متوسط الأداء', 'Avg performance', (r) => '${_n(r['avgPerformance']).toStringAsFixed(1)}%'),
        ExportCol('الثبات', 'Consistency', (r) => '${_n(r['consistency']).toStringAsFixed(0)}%'),
        ExportCol('الاتجاه', 'Trend', (r) => _trend('${r['trend']}')),
      ], rows);

  Future<void> _export() async {
    final d = _d;
    if (d == null) return;
    final which = await showModalBottomSheet<String>(
      context: context,
      builder: (c) => SafeArea(child: Column(mainAxisSize: MainAxisSize.min, children: [
        ListTile(leading: const Icon(Icons.tab_outlined), title: Text(tr('المعروض', 'Shown')), onTap: () => Navigator.pop(c, 'tab')),
        ListTile(leading: const Icon(Icons.layers_outlined), title: Text(tr('كل التبويبات (بالفلتر الحالي)', 'All tabs (current filter)')), subtitle: Text(_scopeText()), onTap: () => Navigator.pop(c, 'allTabs')),
        ListTile(leading: const Icon(Icons.all_inclusive), title: Text(tr('الكل', 'All')), subtitle: Text(tr('كل الفترات', 'all periods')), onTap: () => Navigator.pop(c, 'unfiltered')),
      ])),
    );
    if (which == null || !mounted) return;
    final scope = _scopeText();
    var sheets = <(String, List<ExportCol>, List<Map<String, dynamic>>)>[];
    try {
      if (which == 'tab') {
        sheets = _tab == 'evaluation' ? [_evalSheet(_evals)] : _tab == 'analytics' ? [_overviewSheets(d, scope).first, ..._analyticsSheets(d)] : _overviewSheets(d, scope);
      } else if (which == 'allTabs') {
        final ev = _evals.isNotEmpty ? _evals : _l((await Api.instance.get('/api/b2c/evaluations?$_scopeQs'))['evaluations']);
        sheets = [..._overviewSheets(d, scope), ..._analyticsSheets(d), _evalSheet(ev)];
      } else {
        final r = await Future.wait([Api.instance.get('/api/b2c/dashboard'), Api.instance.get('/api/b2c/evaluations')]);
        final all = _m(r[0]);
        sheets = [..._overviewSheets(all, tr('كل الفترات — بلا فلاتر', 'All periods — no filters')), ..._analyticsSheets(all), _evalSheet(_l(r[1]['evaluations']))];
      }
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e is ApiException ? e.message : '$e')));
      return;
    }
    sheets = sheets.where((s) => s.$3.isNotEmpty).toList();
    if (!mounted) return;
    if (sheets.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(tr('لا صفوف للتصدير', 'Nothing to export'))));
      return;
    }
    await exportExcel(context, fileName: 'b2c-dashboard', sheets: sheets);
  }

  // ── الفلاتر ───────────────────────────────────────────────────────────────
  Future<void> _filters() async {
    int? y = _year, mo = _month;
    String p = _project, b = _branch, r = _rep, f = _from, t = _to;
    final yearCtl = TextEditingController(text: y?.toString() ?? '');
    final ok = await showModalBottomSheet<bool>(
      context: context, isScrollControlled: true, showDragHandle: true,
      builder: (c) => StatefulBuilder(builder: (c, setD) {
        Widget drop(String label, String value, List<(String, String)> opts, ValueChanged<String> on, String all) => Padding(
              padding: const EdgeInsets.only(bottom: 10),
              child: DropdownButtonFormField<String>(
                isExpanded: true, initialValue: opts.any((o) => o.$1 == value) ? value : '',
                decoration: InputDecoration(labelText: label, isDense: true),
                items: [DropdownMenuItem(value: '', child: Text(all)), for (final o in opts) DropdownMenuItem(value: o.$1, child: Text(o.$2, overflow: TextOverflow.ellipsis))],
                onChanged: (v) => setD(() => on(v ?? '')),
              ),
            );
        Widget date(String label, String v, ValueChanged<String> on) => Expanded(
              child: InkWell(
                onTap: () async {
                  final d = await showDatePicker(context: c, firstDate: DateTime(2020), lastDate: DateTime(2100), initialDate: DateTime.tryParse(v) ?? DateTime.now());
                  if (d != null) setD(() => on(d.toIso8601String().substring(0, 10)));
                },
                child: InputDecorator(
                  decoration: InputDecoration(labelText: label, isDense: true,
                      suffixIcon: v.isEmpty ? const Icon(Icons.event, size: 18) : IconButton(icon: const Icon(Icons.close, size: 18), onPressed: () => setD(() => on('')))),
                  child: Text(v),
                ),
              ),
            );
        return SafeArea(
          child: SingleChildScrollView(
            padding: EdgeInsets.fromLTRB(16, 0, 16, MediaQuery.of(c).viewInsets.bottom + 16),
            child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              Text(tr('الفلاتر', 'Filters'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
              const SizedBox(height: 10),
              Row(children: [
                Expanded(child: TextField(controller: yearCtl, keyboardType: TextInputType.number,
                    decoration: InputDecoration(labelText: tr('السنة', 'Year'), hintText: tr('كل السنوات', 'All years'), isDense: true),
                    onChanged: (v) => y = int.tryParse(v.trim()))),
                const SizedBox(width: 10),
                Expanded(child: DropdownButtonFormField<int>(
                  isExpanded: true, initialValue: mo ?? 0,
                  decoration: InputDecoration(labelText: tr('الشهر', 'Month'), isDense: true),
                  items: [DropdownMenuItem(value: 0, child: Text(tr('كل الشهور', 'All months'))), for (var i = 1; i <= 12; i++) DropdownMenuItem(value: i, child: Text(_monthName(i)))],
                  onChanged: (v) => setD(() => mo = (v ?? 0) == 0 ? null : v),
                )),
              ]),
              const SizedBox(height: 10),
              drop(tr('المشروع', 'Project'), p, [for (final x in _projects) ('${x['_id']}', '${x['name']}')], (v) => p = v, tr('كل المشاريع', 'All projects')),
              drop(tr('الفرع', 'Branch'), b, [for (final x in _branches) ('${x['_id']}', '${x['name']}')], (v) => b = v, tr('كل الفروع', 'All branches')),
              drop(tr('المندوب', 'Rep'), r, [for (final x in _reps) ('${x['_id']}', '${x['englishName']}')], (v) => r = v, tr('كل المناديب', 'All reps')),
              Row(children: [date(tr('من تاريخ', 'From'), f, (v) => f = v), const SizedBox(width: 10), date(tr('إلى تاريخ', 'To'), t, (v) => t = v)]),
              const SizedBox(height: 14),
              Row(children: [
                TextButton(onPressed: () => setD(() { y = null; mo = null; p = ''; b = ''; r = ''; f = ''; t = ''; yearCtl.clear(); }), child: Text(tr('مسح الفلاتر', 'Clear filters'))),
                const Spacer(),
                FilledButton(onPressed: () => Navigator.pop(c, true), child: Text(tr('تطبيق', 'Apply'))),
              ]),
            ]),
          ),
        );
      }),
    );
    yearCtl.dispose();
    if (ok != true) return;
    final scope = p != _project || b != _branch;
    setState(() { _year = y; _month = mo; _project = p; _branch = b; _rep = r; _from = f; _to = t; });
    _changed(scope: scope);
  }

  @override
  Widget build(BuildContext context) {
    final d = _d;
    return AppScaffold(
      title: Text(tr('تحليل الأوردرات', 'Orders analysis')),
      actions: [
        IconButton(tooltip: tr('الفلاتر', 'Filters'), icon: const Icon(Icons.tune), onPressed: _filters),
        if (d != null) IconButton(tooltip: tr('تصدير Excel', 'Export to Excel'), icon: const Icon(Icons.file_download_outlined), onPressed: _export),
      ],
      body: RefreshIndicator(
        onRefresh: () async { _cache.clear(); await _load(); },
        child: ListView(padding: const EdgeInsets.fromLTRB(12, 10, 12, 30), children: [
          const B2cOrdersReportCard(),
          const SizedBox(height: 10),
          if (_months.isNotEmpty) _monthBar(),
          const SizedBox(height: 8),
          SegmentedButton<String>(
            segments: [
              ButtonSegment(value: 'overview', label: Text(tr('نظرة عامة', 'Overview'))),
              ButtonSegment(value: 'evaluation', label: Text(tr('تقييم المناديب', 'Evaluation'))),
              ButtonSegment(value: 'analytics', label: Text(tr('تحليلات', 'Analytics'))),
            ],
            selected: {_tab},
            onSelectionChanged: (s) { setState(() => _tab = s.first); if (_tab == 'evaluation') _loadEvals(); },
          ),
          const SizedBox(height: 10),
          if (_loading && d == null)
            const Shimmer(height: 300)
          else if (d == null)
            const SizedBox.shrink()
          else if (_n(_m(d['kpis'])['totalOrders']) == 0 && _n(_m(d['kpis'])['repsActive']) == 0)
            Column(children: [
              EmptyState(icon: Icons.bar_chart, title: tr('لا بيانات في هذا النطاق', 'No data in this scope'), subtitle: tr('غيّر الفترة أو الفلاتر', 'Change the period or filters')),
              if (_year != null || _month != null || _project.isNotEmpty || _branch.isNotEmpty || _rep.isNotEmpty || _from.isNotEmpty || _to.isNotEmpty)
                FilledButton(onPressed: _clear, child: Text(tr('مسح الفلاتر', 'Clear filters'))),
            ])
          else if (_tab == 'overview')
            ..._overview(d)
          else if (_tab == 'evaluation')
            ..._evaluation()
          else
            ..._analytics(d),
        ]),
      ),
    );
  }

  Widget _monthBar() => Directionality(
        textDirection: TextDirection.ltr,
        child: SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          reverse: true,
          child: Row(children: [
            Padding(
              padding: const EdgeInsets.only(right: 6),
              child: ChoiceChip(
                label: Text(tr('📊 كل الفترات', '📊 Overview')),
                selected: _year == null && _month == null,
                onSelected: (_) { setState(() { _year = null; _month = null; _from = ''; _to = ''; }); _load(); },
              ),
            ),
            for (final m in _months)
              Padding(
                padding: const EdgeInsets.only(right: 6),
                child: ChoiceChip(
                  label: Text('${_monthName(_n(m['month']).toInt())} ${m['year']}'),
                  selected: _year == _n(m['year']).toInt() && _month == _n(m['month']).toInt(),
                  onSelected: (_) { setState(() { _year = _n(m['year']).toInt(); _month = _n(m['month']).toInt(); _from = ''; _to = ''; }); _load(); },
                ),
              ),
          ]),
        ),
      );

  Widget _card(String title, List<Widget> children) => Padding(
        padding: const EdgeInsets.only(bottom: 10),
        child: AppCard(
          padding: const EdgeInsets.all(12),
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Text(title, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13.5)),
            const SizedBox(height: 8),
            ...children,
          ]),
        ),
      );

  Widget _kpi(String label, String value, Color c, {VoidCallback? onTap}) => SizedBox(
        width: (MediaQuery.of(context).size.width - 24 - 8) / 2,
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(12),
          child: Container(
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(12), border: Border.all(color: T.line)),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(label, style: const TextStyle(fontSize: 11, color: T.inkSoft)),
              Text(value, style: TextStyle(fontSize: 19, fontWeight: FontWeight.w800, color: c)),
            ]),
          ),
        ),
      );

  Widget _repRow(Map<String, dynamic> r, int i, {bool bad = false}) => ListTile(
        dense: true, contentPadding: EdgeInsets.zero,
        leading: CircleAvatar(radius: 13, backgroundColor: (bad ? T.danger : T.orange).withValues(alpha: 0.15),
            child: Text(bad ? '!' : '${i + 1}', style: TextStyle(fontSize: 11, fontWeight: FontWeight.w800, color: bad ? T.danger : T.orange))),
        title: Text('${r['englishName'] ?? ''}', style: const TextStyle(fontWeight: FontWeight.w700)),
        subtitle: (r['project'] ?? '').toString().isEmpty ? null : Text('${r['project']}'),
        trailing: Column(mainAxisAlignment: MainAxisAlignment.center, crossAxisAlignment: CrossAxisAlignment.end, children: [
          Text(_fmt(r['totalOrders']), style: const TextStyle(fontWeight: FontWeight.w800)),
          Text(_pct(r['performancePercent']), style: TextStyle(fontSize: 11, color: _perfColor(_n(r['performancePercent'])))),
        ]),
        onTap: (r['repId'] ?? '').toString().isEmpty ? null : () => _openRep('${r['repId']}'),
      );

  Widget _bars(List<Map<String, dynamic>> rows, String Function(Map<String, dynamic>) label, num Function(Map<String, dynamic>) value, {Color color = T.orange, String Function(Map<String, dynamic>)? sub}) {
    if (rows.isEmpty) return Text(tr('لا بيانات', 'No data'), style: const TextStyle(color: T.inkFaint));
    final max = rows.map(value).fold<num>(1, (a, b) => b > a ? b : a);
    return Column(children: [
      for (final r in rows)
        Padding(
          padding: const EdgeInsets.symmetric(vertical: 3),
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Row(children: [
              Expanded(child: Text(label(r), style: const TextStyle(fontSize: 12.5), overflow: TextOverflow.ellipsis)),
              Text(sub?.call(r) ?? _fmt(value(r)), style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700)),
            ]),
            const SizedBox(height: 2),
            ClipRRect(borderRadius: BorderRadius.circular(3), child: LinearProgressIndicator(value: value(r) / max, minHeight: 5, color: color, backgroundColor: T.canvas)),
          ]),
        ),
    ]);
  }

  List<Widget> _overview(Map<String, dynamic> d) {
    final k = _m(d['kpis']);
    final byRep = _l(d['byRep']);
    final buckets = {'excellent': 0, 'good': 0, 'acceptable': 0, 'poor': 0};
    for (final r in byRep) {
      final p = _n(r['performancePercent']);
      buckets[p >= 120 ? 'excellent' : p >= 100 ? 'good' : p >= 80 ? 'acceptable' : 'poor'] = buckets[p >= 120 ? 'excellent' : p >= 100 ? 'good' : p >= 80 ? 'acceptable' : 'poor']! + 1;
    }
    final best = _m(k['bestRep']);
    final bestDay = _m(k['bestDay']);
    return [
      B2cProjectsTotal(data: d),
      const SizedBox(height: 8),
      Wrap(spacing: 8, runSpacing: 8, children: [
        _kpi(tr('مناديب نشطون', 'Active reps'), _fmt(k['repsActive']), T.info),
        _kpi(tr('متوسط الأداء', 'Avg performance'), _pct(k['avgPerformance']), _perfColor(_n(k['avgPerformance']))),
        _kpi(tr('فوق الهدف', 'Above target'), _fmt(k['aboveTargetReps']), const Color(0xFF10B981)),
        _kpi(tr('على المسار', 'On track'), _fmt(k['onTrackReps']), const Color(0xFFF59E0B)),
        _kpi(tr('تحت الهدف', 'Below target'), _fmt(k['belowTargetReps']), const Color(0xFFEF4444), onTap: () => _belowTarget(byRep)),
      ]),
      const SizedBox(height: 10),
      Row(children: [
        Expanded(child: _kpiHighlight(tr('أفضل مندوب', 'Best rep'), '${best['englishName'] ?? '—'}',
            best.isEmpty ? '' : '${_fmt(best['totalOrders'])} ${tr('طلب', 'orders')}', const Color(0xFF10B981),
            onTap: (best['repId'] ?? '').toString().isEmpty ? null : () => _openRep('${best['repId']}'))),
        const SizedBox(width: 8),
        Expanded(child: _kpiHighlight(tr('أفضل يوم', 'Best day'), '${bestDay['dateKey'] ?? '—'}',
            bestDay.isEmpty ? '' : '${_fmt(bestDay['totalOrders'])} ${tr('طلب', 'orders')}', const Color(0xFF3B82F6),
            onTap: (bestDay['dateKey'] ?? '').toString().isEmpty ? null : () => _openDay('${bestDay['dateKey']}'))),
      ]),
      const SizedBox(height: 10),
      _days(_l(d['byDay'])),
      _card(tr('حسب الشهر', 'By month'), [
        _bars(_l(d['byMonth']), (r) => _monthKey('${r['key']}'), (r) => _n(r['totalOrders']), sub: (r) => '${_fmt(r['totalOrders'])} · ${_fmt(r['repsActive'])} ${tr('مندوب', 'reps')}'),
      ]),
      _card(tr('توزيع الأداء', 'Performance distribution'), [
        Wrap(spacing: 6, runSpacing: 6, children: [
          Chip2('${tr('ممتاز', 'Excellent')} ${buckets['excellent']}', const Color(0xFF10B981)),
          Chip2('${tr('جيد', 'Good')} ${buckets['good']}', const Color(0xFF22C55E)),
          Chip2('${tr('مقبول', 'Acceptable')} ${buckets['acceptable']}', const Color(0xFFF59E0B)),
          Chip2('${tr('ضعيف', 'Poor')} ${buckets['poor']}', const Color(0xFFEF4444)),
        ]),
      ]),
      _card(tr('حسب المشروع', 'By project'), [_bars(_l(d['byProject']), (r) => '${r['name']}', (r) => _n(r['totalOrders']))]),
      _card(tr('حسب الفرع', 'By branch'), [_bars(_l(d['byBranch']), (r) => '${r['name']}', (r) => _n(r['totalOrders']), color: T.info)]),
      _card(tr('أفضل المناديب', 'Top reps'), [
        if (_l(d['topReps']).isEmpty) Text(tr('لا بيانات', 'No data'), style: const TextStyle(color: T.inkFaint)),
        for (final e in _l(d['topReps']).asMap().entries) _repRow(e.value, e.key),
      ]),
      _card(tr('أضعف المناديب', 'Bottom reps'), [
        if (_l(d['bottomReps']).isEmpty) Text(tr('لا بيانات', 'No data'), style: const TextStyle(color: T.inkFaint)),
        for (final e in _l(d['bottomReps']).asMap().entries) _repRow(e.value, e.key, bad: true),
      ]),
      _card(tr('حسب المندوب', 'By rep'), [
        if (byRep.isEmpty) Text(tr('لا بيانات', 'No data'), style: const TextStyle(color: T.inkFaint)),
        for (final e in byRep.asMap().entries)
          ListTile(
            dense: true, contentPadding: EdgeInsets.zero,
            title: Text('${e.key + 1}. ${e.value['englishName'] ?? ''}', style: const TextStyle(fontWeight: FontWeight.w700)),
            subtitle: Text([
              if ((e.value['arabicName'] ?? '').toString().isNotEmpty) '${e.value['arabicName']}',
              '${e.value['project'] ?? '—'}',
              '${tr('أيام', 'days')} ${e.value['workingDays']}',
              '${tr('يوميًا', 'daily')} ${_n(e.value['dailyRate']).toStringAsFixed(1)}',
            ].join(' · ')),
            trailing: Column(mainAxisAlignment: MainAxisAlignment.center, crossAxisAlignment: CrossAxisAlignment.end, children: [
              Text(_fmt(e.value['totalOrders']), style: const TextStyle(fontWeight: FontWeight.w800)),
              Text(_pct(e.value['performancePercent']), style: TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: _perfColor(_n(e.value['performancePercent'])))),
            ]),
            onTap: (e.value['repId'] ?? '').toString().isEmpty ? null : () => _openRep('${e.value['repId']}'),
          ),
      ]),
    ];
  }

  Widget _kpiHighlight(String title, String value, String sub, Color c, {VoidCallback? onTap}) => InkWell(
        onTap: onTap,
        // حدٌّ رماديٌّ مستدير، وشريطُ اللون في البداية داخله — إذ لا تُقبَل
        // زوايا مستديرةً لحدودٍ مختلفةِ الألوان (Flutter).
        child: Container(
          clipBehavior: Clip.antiAlias,
          decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(12), border: Border.all(color: T.line)),
          child: Container(
          padding: const EdgeInsets.all(10),
          decoration: BoxDecoration(border: BorderDirectional(start: BorderSide(color: c, width: 4))),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(title, style: const TextStyle(fontSize: 11, color: T.inkSoft)),
            Text(value, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
            if (sub.isNotEmpty) Text(sub, style: const TextStyle(fontSize: 11, color: T.inkFaint)),
          ]),
          ),
        ),
      );

  /// بطاقاتُ الأيام — شهرًا شهرًا؛ والضغطُ يفتح تفاصيلَ اليوم.
  Widget _days(List<Map<String, dynamic>> days) {
    if (days.isEmpty) return const SizedBox.shrink();
    final byMonth = <String, List<Map<String, dynamic>>>{};
    for (final d in days) { byMonth.putIfAbsent('${d['dateKey']}'.substring(0, 7), () => []).add(d); }
    final keys = byMonth.keys.toList()..sort();
    final single = _year != null && _month != null;
    return _card(single ? tr('أيام ${_monthName(_month!)} $_year — اضغط يومًا للتفاصيل', 'Days of ${_monthName(_month!)} $_year — tap a day') : tr('العرض اليومي — كل الشهور', 'Daily view — all months'), [
      for (final mk in keys) ...[
        if (!single) Padding(padding: const EdgeInsets.only(top: 6, bottom: 4), child: Text(_monthKey(mk), style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: T.inkSoft))),
        Wrap(spacing: 6, runSpacing: 6, children: [
          for (final d in byMonth[mk]!) _dayTile(d),
        ]),
      ],
    ]);
  }

  Widget _dayTile(Map<String, dynamic> d) {
    final key = '${d['dateKey']}';
    final day = int.tryParse(key.substring(8, 10)) ?? 0;
    final dow = DateTime.tryParse('${key}T00:00:00Z')?.weekday ?? 7;
    final ach = _n(d['achievementPercent']);
    final has = _n(d['totalOrders']) > 0 || _n(d['repsActive']) > 0;
    final stripe = !has ? T.line : ach >= 100 ? const Color(0xFF22C55E) : ach >= 70 ? const Color(0xFFF59E0B) : const Color(0xFFEF4444);
    final avg = _n(d['repsActive']) > 0 ? _n(d['totalOrders']) / _n(d['repsActive']) : 0;
    return InkWell(
      onTap: () => _openDay(key),
      child: Opacity(
        opacity: has ? 1 : 0.5,
        child: Container(
          width: 98,
          decoration: BoxDecoration(color: T.canvas, borderRadius: BorderRadius.circular(10), border: Border.all(color: T.line)),
          clipBehavior: Clip.antiAlias,
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Container(height: 3, color: stripe),
            Padding(
              padding: const EdgeInsets.all(6),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Row(children: [
                  Text('$day', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
                  const Spacer(),
                  Text(tr(_dowAr[dow % 7], _dowEn[dow % 7]), style: const TextStyle(fontSize: 9.5, color: T.inkFaint)),
                ]),
                if (has) ...[
                  Text(_fmt(d['totalOrders']), style: const TextStyle(color: T.orange, fontWeight: FontWeight.w800)),
                  Text('${_fmt(d['repsActive'])} ${tr('عمل', 'worked')} · ${avg.toStringAsFixed(1)} ${tr('متوسط', 'avg')}', style: const TextStyle(fontSize: 9.5, color: T.inkFaint)),
                  if (_n(d['repsNotWorked']) > 0) Text('🛌 ${_fmt(d['repsNotWorked'])} ${tr('إجازة', 'off')}', style: const TextStyle(fontSize: 9.5, color: T.inkFaint)),
                  if (d['targetSum'] != null) Text('${ach.toStringAsFixed(0)}% ${tr('من الهدف', 'of target')}', style: TextStyle(fontSize: 9.5, color: stripe)),
                ] else
                  Text(tr('لا بيانات', 'No data'), style: const TextStyle(fontSize: 10.5, color: T.inkFaint)),
              ]),
            ),
          ]),
        ),
      ),
    );
  }

  List<Widget> _evaluation() {
    final buckets = {'A+': 0, 'A': 0, 'B': 0, 'C': 0, 'D': 0, 'F': 0};
    for (final e in _evals) { buckets['${e['grade']}'] = (buckets['${e['grade']}'] ?? 0) + 1; }
    final rows = _grade.isEmpty ? _evals : _evals.where((e) => e['grade'] == _grade).toList();
    return [
      Wrap(spacing: 6, runSpacing: 6, children: [
        for (final g in buckets.entries)
          InkWell(
            onTap: () => setState(() => _grade = _grade == g.key ? '' : g.key),
            child: Container(
              width: 70, padding: const EdgeInsets.all(8),
              decoration: BoxDecoration(color: _grade == g.key ? T.orange.withValues(alpha: 0.1) : Colors.white, borderRadius: BorderRadius.circular(12), border: Border.all(color: _grade == g.key ? T.orange : T.line)),
              child: Column(children: [
                Text(g.key, style: TextStyle(fontSize: 20, fontWeight: FontWeight.w800, color: _gradeColor(g.key))),
                Text('${g.value} ${tr('مندوب', 'reps')}', style: const TextStyle(fontSize: 10.5, color: T.inkSoft)),
              ]),
            ),
          ),
      ]),
      const SizedBox(height: 10),
      if (rows.isEmpty) EmptyState(icon: Icons.grading_outlined, title: tr('لا بيانات', 'No data')),
      for (final e in rows.asMap().entries)
        AppCard(
          padding: const EdgeInsets.all(10),
          child: InkWell(
            onTap: () => _openRep('${e.value['repId']}'),
            child: Row(children: [
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                decoration: BoxDecoration(color: _gradeColor('${e.value['grade']}').withValues(alpha: 0.15), borderRadius: BorderRadius.circular(6)),
                child: Text('${e.value['grade']}', style: TextStyle(fontWeight: FontWeight.w800, color: _gradeColor('${e.value['grade']}'))),
              ),
              const SizedBox(width: 10),
              Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text('${e.key + 1}. ${e.value['englishName'] ?? ''}', style: const TextStyle(fontWeight: FontWeight.w700)),
                if ((e.value['arabicName'] ?? '').toString().isNotEmpty) Text('${e.value['arabicName']}', style: const TextStyle(fontSize: 12, color: T.inkSoft)),
                Text([
                  '${e.value['project'] ?? '—'}',
                  '${_fmt(e.value['totalOrders'])} ${tr('طلب', 'orders')}',
                  '${e.value['monthsActive']} ${tr('شهر', 'months')}',
                  '${tr('أداء', 'perf')} ${_n(e.value['avgPerformance']).toStringAsFixed(1)}%',
                  '${tr('ثبات', 'consistency')} ${_n(e.value['consistency']).toStringAsFixed(0)}%',
                  _trend('${e.value['trend']}'),
                ].join(' · '), style: const TextStyle(fontSize: 11.5, color: T.inkFaint)),
              ])),
              Icon(e.value['trend'] == 'rising' ? Icons.trending_up : e.value['trend'] == 'falling' ? Icons.trending_down : Icons.remove,
                  color: e.value['trend'] == 'rising' ? T.success : e.value['trend'] == 'falling' ? T.danger : T.inkFaint, size: 18),
            ]),
          ),
        ),
    ];
  }

  List<Widget> _analytics(Map<String, dynamic> d) {
    final k = _m(d['kpis']);
    final byRep = _l(d['byRep']);
    final top = [...byRep]..sort((a, b) => _n(b['performancePercent']).compareTo(_n(a['performancePercent'])));
    final atRisk = byRep.where((r) => _n(r['performancePercent']) < 60).toList();
    final cap = _n(k['teamCapacity']);
    final used = _n(k['totalOrders']);
    final months = _n(k['monthsCount']);
    final total = byRep.length;
    String share(num n) => total > 0 ? _pct(n / total * 100) : '0%';
    Widget box(String label, String v, Color c, [String? hint]) => Expanded(
          child: Container(
            margin: const EdgeInsets.all(3), padding: const EdgeInsets.all(8),
            decoration: BoxDecoration(color: c.withValues(alpha: 0.08), borderRadius: BorderRadius.circular(10)),
            child: Column(children: [
              Text(v, style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800, color: c)),
              Text(label, textAlign: TextAlign.center, style: const TextStyle(fontSize: 10.5, color: T.inkSoft)),
              if (hint != null) Text(hint, textAlign: TextAlign.center, style: const TextStyle(fontSize: 9.5, color: T.inkFaint)),
            ]),
          ),
        );
    Widget simple(String title, List<Map<String, dynamic>> rows, Widget Function(Map<String, dynamic>, int) row, String empty) =>
        _card(title, [if (rows.isEmpty) Text(empty, style: const TextStyle(color: T.inkFaint, fontSize: 12.5)), for (final e in rows.asMap().entries) row(e.value, e.key)]);
    Widget line(String a, String b, String v, Color c, {String? repId}) => ListTile(
          dense: true, contentPadding: EdgeInsets.zero, title: Text(a), subtitle: b.isEmpty ? null : Text(b),
          trailing: Text(v, style: TextStyle(fontWeight: FontWeight.w800, color: c)),
          onTap: repId == null || repId.isEmpty ? null : () => _openRep(repId),
        );
    final dow = _l(d['byDayOfWeek']);
    return [
      _card(tr('تحقيق الهدف الإجمالي', 'Total target achievement'), [
        Text(tr('الهدف = مجموع أهداف المناديب × $months شهر', 'Target = sum of rep targets × $months months'), style: const TextStyle(fontSize: 11, color: T.inkFaint)),
        const SizedBox(height: 6),
        Row(children: [
          Expanded(child: ClipRRect(borderRadius: BorderRadius.circular(4), child: LinearProgressIndicator(value: (_n(k['capacityUsedPercent']) / 100).clamp(0, 1).toDouble(), minHeight: 8, color: used >= cap ? T.success : T.orange, backgroundColor: T.canvas))),
          const SizedBox(width: 8),
          Text(_pct(k['capacityUsedPercent']), style: TextStyle(fontWeight: FontWeight.w800, color: used >= cap ? T.success : T.warn)),
        ]),
        Row(children: [
          box(tr('الطلبات الفعلية', 'Actual orders'), _fmt(used), T.ink),
          box(tr('الهدف', 'Target'), _fmt(cap), T.ink),
          box(tr('الفرق', 'Delta'), '${used >= cap ? '+' : ''}${_fmt(used - cap)}', used >= cap ? T.success : T.danger),
          box(tr('متوسط المندوب/شهر', 'Avg per rep/month'), total > 0 && months > 0 ? _fmt(used / total / months) : '0', T.ink),
        ]),
      ]),
      _card(tr('توزيع الأداء ($total مندوب)', 'Performance distribution ($total reps)'), [
        Row(children: [
          box(tr('فوق الهدف', 'Above target'), _fmt(k['aboveTargetReps']), T.success, share(_n(k['aboveTargetReps']))),
          box(tr('على المسار', 'On track'), _fmt(k['onTrackReps']), T.warn, share(_n(k['onTrackReps']))),
          box(tr('تحت الهدف', 'Below target'), _fmt(k['belowTargetReps']), T.orange, share(_n(k['belowTargetReps']))),
          box(tr('في خطر', 'At risk'), _fmt(k['atRiskReps'] ?? atRisk.length), T.danger, share(_n(k['atRiskReps'] ?? atRisk.length))),
        ]),
      ]),
      _card(tr('ملخص حضور الفريق', 'Team attendance summary'), [
        Row(children: [
          box(tr('أيام العمل', 'Worked days'), _fmt(k['totalWorkingDays']), T.success),
          box(tr('أيام التوقف', 'Days off'), _fmt(k['totalDaysOff']), T.warn, tr('صفر في الشيت', 'zero in sheet')),
          box(tr('أيام بلا بيانات', 'No-data days'), _fmt(k['totalNoDataDays']), T.inkSoft, tr('لم تُدخل بعد', 'not entered yet')),
        ]),
      ]),
      simple(tr('الأعلى أداءً (%)', 'Top performers (%)'), top.take(5).toList(),
          (r, i) => line('${i + 1}. ${r['englishName']}', '${r['project'] ?? ''}', '${_pct(r['performancePercent'])} · ${_fmt(r['totalOrders'])}', T.success, repId: '${r['repId'] ?? ''}'), tr('لا بيانات', 'No data')),
      simple(tr('مناديب في خطر (<60%)', 'At-risk reps (<60%)'), atRisk.take(5).toList(),
          (r, i) => line('${i + 1}. ${r['englishName']}', '${r['project'] ?? ''}', '${_pct(r['performancePercent'])} · ${_fmt(r['totalOrders'])}', T.danger, repId: '${r['repId'] ?? ''}'), tr('لا مناديب في خطر', 'No at-risk reps')),
      simple(tr('الأكثر تحسّنًا', 'Top improvers'), _l(d['topImprovers']),
          (r, i) => line('${r['englishName']}', '${_n(r['firstMonthAvg']).toStringAsFixed(1)} → ${_n(r['lastMonthAvg']).toStringAsFixed(1)} ${tr('طلب/يوم', 'orders/day')}', '+${_pct(r['deltaPercent'])}', T.success), tr('يحتاج شهرين من البيانات', 'Needs two months of data')),
      simple(tr('الأكثر تراجعًا', 'Top decliners'), _l(d['topDecliners']),
          (r, i) => line('${r['englishName']}', '${_n(r['firstMonthAvg']).toStringAsFixed(1)} → ${_n(r['lastMonthAvg']).toStringAsFixed(1)} ${tr('طلب/يوم', 'orders/day')}', _pct(r['deltaPercent']), T.danger), tr('لا تراجع', 'No decliners')),
      simple(tr('الأكثر ثباتًا', 'Most consistent'), _l(d['mostConsistent']),
          (r, i) => line('${r['englishName']}', '${_fmt(r['totalOrders'])} ${tr('طلب على', 'orders over')} ${r['monthsActive']} ${tr('شهر', 'months')}', '${_n(r['consistency']).toStringAsFixed(0)}%', T.info), tr('يحتاج شهرين', 'Needs two months')),
      simple(tr('أفضل الأيام الفردية', 'Best single-day records'), _l(d['bestSingleDays']),
          (r, i) => line('${r['englishName']}', '${r['dateKey']} · ${r['project'] ?? '—'}', '${r['orders']} ${tr('طلب', 'orders')}', T.orange), tr('لا بيانات', 'No data')),
      _card(tr('تحليل أيام الأسبوع — متوسط الطلبات لكل مندوب', 'Day-of-week analysis — avg orders per rep'), [
        _bars(dow, (r) => tr(_dowAr[_n(r['dow']).toInt() % 7], _dowEn[_n(r['dow']).toInt() % 7]), (r) => _n(r['avgPerWorker']),
            sub: (r) => '${_n(r['avgPerWorker']).toStringAsFixed(1)} · ${_fmt(r['totalOrders'])} ${tr('إجمالي', 'total')}', color: T.info),
      ]),
      simple(tr('أكثر أيام الفريق إنتاجًا', 'Most productive team days'), _l(d['topTeamDays']),
          (r, i) => line('${i + 1}. ${r['dateKey']}', '${r['repsActive']} ${tr('مندوب نشط', 'active reps')}', _fmt(r['totalOrders']), T.success), tr('لا بيانات', 'No data')),
    ];
  }

  // ── المناديب دون الهدف (<80%): حسب الفرع، وكلُّ مشروعٍ بفروعه، ثمّ القائمة ──
  void _belowTarget(List<Map<String, dynamic>> byRep) {
    final below = byRep.where((r) => _n(r['workingDays']) > 0 && _n(r['performancePercent']) < 80).toList()
      ..sort((a, b) => _n(a['performancePercent']).compareTo(_n(b['performancePercent'])));
    String loc(Map<String, dynamic> r) => '${r['branch'] ?? r['city'] ?? ''}'.isEmpty ? tr('بدون فرع', 'No branch') : '${r['branch'] ?? r['city']}';
    final byBranch = <String, List<num>>{};
    final projBranch = <String, Map<String, int>>{};
    for (final r in below) {
      byBranch.putIfAbsent(loc(r), () => []).add(_n(r['performancePercent']));
      final p = '${r['project'] ?? ''}'.isEmpty ? tr('بدون مشروع', 'No project') : '${r['project']}';
      projBranch.putIfAbsent(p, () => {})[loc(r)] = (projBranch[p]![loc(r)] ?? 0) + 1;
    }
    final period = _year != null && _month != null ? '${_monthName(_month!)} $_year' : tr('كل الفترات المحددة', 'Selected period');
    showModalBottomSheet(
      context: context, isScrollControlled: true, showDragHandle: true,
      builder: (c) => SafeArea(
        child: SizedBox(
          height: MediaQuery.of(c).size.height * 0.85,
          child: ListView(padding: const EdgeInsets.fromLTRB(14, 0, 14, 14), children: [
            Text('${tr('المناديب دون الهدف', 'Reps below target')} (${below.length})', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
            Text('${tr('أداء أقل من 80% من الهدف', 'Below 80% of target')} · $period', style: const TextStyle(fontSize: 11.5, color: T.inkFaint)),
            const SizedBox(height: 10),
            if (byBranch.isNotEmpty) ...[
              Text(tr('حسب الفرع', 'By branch'), style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 12)),
              const SizedBox(height: 4),
              Wrap(spacing: 6, runSpacing: 6, children: [
                for (final e in (byBranch.entries.toList()..sort((a, b) => b.value.length.compareTo(a.value.length))))
                  Chip2('${e.key}: ${e.value.length} · ${tr('متوسط', 'avg')} ${(e.value.fold<num>(0, (a, b) => a + b) / e.value.length).toStringAsFixed(0)}%', T.danger),
              ]),
              const SizedBox(height: 8),
              Text(tr('كل مشروع وفروعه المتأثرة', 'Each project → its branches'), style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 12)),
              for (final p in projBranch.entries)
                Padding(
                  padding: const EdgeInsets.only(top: 4),
                  child: Text('${p.key} · ${p.value.entries.map((e) => '${e.key}: ${e.value}').join('، ')}', style: const TextStyle(fontSize: 12, color: T.inkSoft)),
                ),
              const Divider(height: 20),
            ],
            if (below.isEmpty) Text(tr('لا يوجد مناديب دون الهدف 🎉', 'None below target 🎉'), textAlign: TextAlign.center),
            for (final e in below.asMap().entries)
              ListTile(
                dense: true, contentPadding: EdgeInsets.zero,
                title: Text('${e.key + 1}. ${tr('${e.value['arabicName'] ?? e.value['englishName']}', '${e.value['englishName'] ?? e.value['arabicName']}')}'),
                subtitle: Text('${loc(e.value)} · ${e.value['project'] ?? '—'} · ${_fmt(e.value['totalOrders'])} ${tr('طلب', 'orders')} · ${e.value['workingDays']} ${tr('يوم', 'days')}'),
                trailing: Text('${_n(e.value['performancePercent']).toStringAsFixed(0)}%', style: TextStyle(fontWeight: FontWeight.w800, color: _perfColor(_n(e.value['performancePercent'])))),
              ),
          ]),
        ),
      ),
    );
  }

  void _openDay(String date) => showModalBottomSheet(
        context: context, isScrollControlled: true, showDragHandle: true,
        builder: (_) => _DaySheet(date: date, project: _project, branch: _branch, onRep: (id) { Navigator.pop(context); _openRep(id); }),
      );

  void _openRep(String id) {
    if (id.isEmpty) return;
    showModalBottomSheet(context: context, isScrollControlled: true, showDragHandle: true, builder: (_) => B2cRepProfileSheet(repId: id));
  }
}

class _DaySheet extends StatefulWidget {
  final String date, project, branch;
  final void Function(String id) onRep;
  const _DaySheet({required this.date, required this.project, required this.branch, required this.onRep});
  @override
  State<_DaySheet> createState() => _DaySheetState();
}

class _DaySheetState extends State<_DaySheet> {
  Map<String, dynamic>? _d;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    final q = ['date=${widget.date}', if (widget.project.isNotEmpty) 'project=${widget.project}', if (widget.branch.isNotEmpty) 'branch=${widget.branch}'].join('&');
    Api.instance.get('/api/b2c/day-details?$q').then((d) { if (mounted) setState(() { _d = _m(d); _loading = false; }); })
        .catchError((_) { if (mounted) setState(() => _loading = false); });
  }

  static const _status = {
    'above': ('فوق الهدف', 'Above', Color(0xFF16A34A)),
    'on_track': ('على المسار', 'On track', Color(0xFFB45309)),
    'below': ('تحت الهدف', 'Below', Color(0xFFDC2626)),
    'not_worked': ('لم يعمل', 'Off', Color(0xFF475569)),
  };

  @override
  Widget build(BuildContext context) {
    final d = _d;
    Widget kpi(String l, String v, Color c) => SizedBox(
          width: (MediaQuery.of(context).size.width - 28 - 12) / 3,
          child: Container(
            padding: const EdgeInsets.all(8),
            decoration: BoxDecoration(color: T.canvas, borderRadius: BorderRadius.circular(10)),
            child: Column(children: [
              Text(l, textAlign: TextAlign.center, style: const TextStyle(fontSize: 10.5, color: T.inkSoft)),
              Text(v, style: TextStyle(fontSize: 17, fontWeight: FontWeight.w800, color: c)),
            ]),
          ),
        );
    return SafeArea(
      child: SizedBox(
        height: MediaQuery.of(context).size.height * 0.85,
        child: _loading
            ? const Center(child: CircularProgressIndicator())
            : d == null
                ? Center(child: Text(tr('لا بيانات', 'No data')))
                : ListView(padding: const EdgeInsets.fromLTRB(14, 0, 14, 14), children: [
                    Text('${widget.date} — ${tr(_dowAr[_n(d['dow']).toInt() % 7], _dowEn[_n(d['dow']).toInt() % 7])}', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
                    const SizedBox(height: 10),
                    Wrap(spacing: 6, runSpacing: 6, children: [
                      kpi(tr('إجمالي الطلبات', 'Total orders'), _fmt(d['totalOrders']), T.orange),
                      kpi(tr('عملوا اليوم', 'Worked today'), _fmt(d['repsActive']), const Color(0xFF3B82F6)),
                      kpi(tr('متوسط المندوب', 'Avg per rep'), _n(d['avgPerRep']).toStringAsFixed(1), const Color(0xFF8B5CF6)),
                      kpi(tr('أعلى مندوب', 'Top rep'), _fmt(d['bestRepOrders'] ?? _m(d['bestRep'])['orders']), const Color(0xFFEAB308)),
                      kpi(tr('حققوا الهدف', 'Hit target'), _fmt(d['repsAboveTarget']), const Color(0xFF10B981)),
                      kpi(tr('نسبة التحقيق', 'Achievement'), '${_n(d['hitTargetPercent']).toStringAsFixed(0)}%', _perfColor(_n(d['hitTargetPercent']))),
                      kpi(tr('لم يعمل', "Didn't work"), _fmt(d['repsNotWorked']), const Color(0xFF9CA3AF)),
                      kpi(tr('تحت الهدف', 'Below target'), _fmt(d['repsBelowTarget']), const Color(0xFFEF4444)),
                      kpi(tr('بلا بيانات', 'No data'), _fmt(d['noDataCount']), const Color(0xFF6B7280)),
                    ]),
                    if (_m(d['bestRep']).isNotEmpty) ...[
                      const SizedBox(height: 10),
                      AppCard(
                        topAccent: T.orange,
                        padding: const EdgeInsets.all(10),
                        child: InkWell(
                          onTap: () => widget.onRep('${_m(d['bestRep'])['repId']}'),
                          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                            Text('🏆 ${tr('أفضل مندوب اليوم', 'Top rep today')}', style: const TextStyle(fontSize: 11.5, color: T.orange)),
                            Text('${_m(d['bestRep'])['englishName']}', style: const TextStyle(fontWeight: FontWeight.w800)),
                            Text('${_m(d['bestRep'])['orders']} ${tr('طلب', 'orders')}', style: const TextStyle(fontSize: 12, color: T.inkSoft)),
                          ]),
                        ),
                      ),
                    ],
                    const SizedBox(height: 10),
                    if (_l(d['reps']).isEmpty) Text(tr('لا بيانات', 'No data'), textAlign: TextAlign.center),
                    for (final r in _l(d['reps']))
                      ListTile(
                        dense: true, contentPadding: EdgeInsets.zero,
                        onTap: (r['repId'] ?? '').toString().isEmpty ? null : () => widget.onRep('${r['repId']}'),
                        title: Text('${r['englishName'] ?? ''}${(r['arabicName'] ?? '').toString().isEmpty ? '' : ' · ${r['arabicName']}'}'),
                        subtitle: Text([
                          '${r['project'] ?? '—'}',
                          if ((r['accountId'] ?? '').toString().isNotEmpty) '#${r['accountId']}',
                          (r['sourceSheet'] ?? '').toString().isNotEmpty ? '${r['sourceSheet']} · ${tr('صف', 'row')} ${r['sourceRow'] ?? '?'}' : tr('يدوي', 'manual'),
                        ].join(' · ')),
                        trailing: Column(mainAxisAlignment: MainAxisAlignment.center, crossAxisAlignment: CrossAxisAlignment.end, children: [
                          Text(r['orders'] == null ? '—' : '${r['orders']}${r['diff'] == null ? '' : ' (${_n(r['diff']) >= 0 ? '+' : ''}${r['diff']})'}',
                              style: TextStyle(fontWeight: FontWeight.w800, color: r['diff'] == null ? T.ink : _n(r['diff']) >= 0 ? T.success : T.danger)),
                          if (_status.containsKey(r['status']))
                            Text(tr(_status[r['status']]!.$1, _status[r['status']]!.$2), style: TextStyle(fontSize: 10.5, color: _status[r['status']]!.$3)),
                        ]),
                      ),
                  ]),
      ),
    );
  }
}

/// ملفُّ المندوب — نظيرُ B2CRepProfileModal (GET /api/b2c/reps/:id/profile).
class B2cRepProfileSheet extends StatefulWidget {
  final String repId;
  const B2cRepProfileSheet({super.key, required this.repId});
  @override
  State<B2cRepProfileSheet> createState() => _B2cRepProfileSheetState();
}

class _B2cRepProfileSheetState extends State<B2cRepProfileSheet> {
  Map<String, dynamic>? _d;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    Api.instance.get('/api/b2c/reps/${widget.repId}/profile').then((d) { if (mounted) setState(() { _d = _m(d); _loading = false; }); })
        .catchError((_) { if (mounted) setState(() => _loading = false); });
  }

  static String _note(Map<String, dynamic> n) {
    final m = _m(n['meta']);
    final v = m['value'], c = m['count'];
    final ar = <String, String>{
      'EXCEPTIONAL_PERFORMANCE': 'أداء استثنائي — متوسط $v% من الهدف', 'AVG_PERFORMANCE_HIGH': 'متوسط الأداء فوق الهدف ($v%)',
      'CONSISTENCY_VERY_HIGH': 'ثبات عالي جداً شهرياً ($v%)', 'CONSISTENCY_HIGH': 'ثبات شهري ممتاز ($v%)', 'TREND_RISING': 'الأداء في تحسن مع الوقت',
      'ALWAYS_ABOVE_TARGET': 'فوق الهدف في كل الشهور ($c من $c)', 'MOSTLY_ABOVE_TARGET': 'فوق الهدف في ${m['hits']} من ${m['total']} شهور',
      'ATTENDANCE_EXCELLENT': 'حضور ممتاز ($v% من الأيام المتوقعة)', 'DAILY_TARGET_HIT_RATE_HIGH': 'يحقق الهدف اليومي في $v% من أيام العمل',
      'PEAK_DAY_OUTSTANDING': 'يوم ذروة استثنائي — $v طلب (${m['multiple']}× الهدف اليومي)', 'LONG_TENURE': 'خبرة طويلة — نشط على مدار ${m['months']} شهور',
      'AVG_PERFORMANCE_AT_RISK': 'أداء في خطر — فقط $v% من الهدف', 'AVG_PERFORMANCE_LOW': 'متوسط الأداء تحت الهدف ($v%)', 'TREND_FALLING': 'الأداء في تراجع',
      'CONSISTENCY_LOW': 'تذبذب في الأداء الشهري ($v%)', 'MULTIPLE_MONTHS_BELOW': 'تحت الهدف في $c شهور', 'MONTHS_AT_RISK': '$c شهر/شهور في خطر (<60%)',
      'ATTENDANCE_LOW': 'حضور منخفض ($v% من المتوقع)', 'DAILY_TARGET_RARELY_HIT': 'نادراً ما يحقق الهدف اليومي ($v%)', 'RECENT_MONTH_POOR': 'الشهر الأخير ضعيف — $v%',
      'ZERO_OUTPUT_MONTH': 'شهر بدون أي إنتاج', 'MANY_DAYS_OFF': 'كثرة أيام التوقّف ($c يوم بلا عمل)', 'SOME_DAYS_OFF': 'عدد أيام التوقّف ($c يوم بلا عمل)',
    };
    final en = <String, String>{
      'EXCEPTIONAL_PERFORMANCE': 'Exceptional performance — averaging $v% of target', 'AVG_PERFORMANCE_HIGH': 'Above target on average ($v%)',
      'CONSISTENCY_VERY_HIGH': 'Very consistent month-over-month ($v%)', 'CONSISTENCY_HIGH': 'Consistent monthly output ($v%)', 'TREND_RISING': 'Performance trending up over time',
      'ALWAYS_ABOVE_TARGET': 'Above target every month ($c of $c)', 'MOSTLY_ABOVE_TARGET': 'Above target in ${m['hits']} of ${m['total']} months',
      'ATTENDANCE_EXCELLENT': 'Excellent attendance ($v% of expected days worked)', 'DAILY_TARGET_HIT_RATE_HIGH': 'Hits the daily target on $v% of working days',
      'PEAK_DAY_OUTSTANDING': 'Outstanding peak day — $v orders (${m['multiple']}× daily target)', 'LONG_TENURE': 'Long tenure — active across ${m['months']} months',
      'AVG_PERFORMANCE_AT_RISK': 'At-risk performance — only $v% of target on average', 'AVG_PERFORMANCE_LOW': 'Below target on average ($v%)', 'TREND_FALLING': 'Performance trending down',
      'CONSISTENCY_LOW': 'Inconsistent monthly output ($v%)', 'MULTIPLE_MONTHS_BELOW': 'Below target in $c months', 'MONTHS_AT_RISK': '$c month(s) at-risk (<60%)',
      'ATTENDANCE_LOW': 'Low attendance ($v% of expected days)', 'DAILY_TARGET_RARELY_HIT': 'Rarely hits the daily target ($v%)', 'RECENT_MONTH_POOR': 'Recent month was poor — $v%',
      'ZERO_OUTPUT_MONTH': 'One month with zero output', 'MANY_DAYS_OFF': "Many days off ($c days didn't work)", 'SOME_DAYS_OFF': "Several days off ($c days didn't work)",
    };
    final code = '${n['code']}';
    return tr(ar[code] ?? code, en[code] ?? code);
  }

  @override
  Widget build(BuildContext context) {
    final d = _d;
    final rep = _m(d?['rep']);
    final life = _m(d?['lifetime']);
    Widget kv(String k, String v, [Color? c]) => Padding(
          padding: const EdgeInsets.symmetric(vertical: 3),
          child: Row(children: [Expanded(child: Text(k, style: const TextStyle(fontSize: 12, color: T.inkSoft))), Text(v, style: TextStyle(fontWeight: FontWeight.w700, color: c))]),
        );
    return SafeArea(
      child: SizedBox(
        height: MediaQuery.of(context).size.height * 0.85,
        child: _loading
            ? const Center(child: CircularProgressIndicator())
            : d == null
                ? Center(child: Text(tr('لا بيانات', 'No data')))
                : ListView(padding: const EdgeInsets.fromLTRB(14, 0, 14, 14), children: [
                    Text('${rep['englishName'] ?? ''}', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16)),
                    if ((rep['arabicName'] ?? '').toString().isNotEmpty) Text('${rep['arabicName']}', style: const TextStyle(color: T.inkSoft)),
                    Text([
                      if ((rep['repId'] ?? '').toString().isNotEmpty) '#${rep['repId']}',
                      if (_m(rep['project']).isNotEmpty) '${_m(rep['project'])['name']}',
                      if (_m(rep['branch']).isNotEmpty) '${_m(rep['branch'])['name']}',
                      if ((rep['joiningDate'] ?? '').toString().isNotEmpty) '${tr('انضم', 'Joined')} ${'${rep['joiningDate']}'.substring(0, 10)}',
                    ].join(' · '), style: const TextStyle(fontSize: 12, color: T.inkFaint)),
                    const Divider(height: 18),
                    kv(tr('إجمالي الطلبات', 'Total orders'), _fmt(life['totalOrders'])),
                    kv(tr('متوسط الأداء', 'Avg performance'), _pct(life['avgPerformancePercent']), _perfColor(_n(life['avgPerformancePercent']))),
                    kv(tr('الثبات', 'Consistency'), '${_n(life['consistency']).toStringAsFixed(0)}%'),
                    kv(tr('الاتجاه', 'Trend'), _trend('${life['trend']}')),
                    kv(tr('أيام العمل / المتوقعة', 'Worked / expected days'), '${_fmt(life['actualWorkingDays'])} / ${_fmt(life['expectedTotalDays'])}'),
                    kv(tr('أيام لم يعمل', "Days didn't work"), _fmt(life['daysNotWorked']), _n(life['daysNotWorked']) > 5 ? T.danger : null),
                    kv(tr('نسبة الحضور', 'Attendance rate'), '${_n(life['attendanceRate']).toStringAsFixed(0)}%'),
                    kv(tr('تحقيق الهدف اليومي', 'Daily target hit rate'), '${_n(life['dailyHitRate']).toStringAsFixed(0)}%'),
                    if (_m(life['bestMonth']).isNotEmpty)
                      kv(tr('أفضل شهر', 'Best month'), '${_monthName(_n(_m(life['bestMonth'])['month']).toInt())} ${_m(life['bestMonth'])['year']} · ${_fmt(_m(life['bestMonth'])['totalOrders'])}', T.success),
                    if (_m(life['worstMonth']).isNotEmpty)
                      kv(tr('أضعف شهر', 'Worst month'), '${_monthName(_n(_m(life['worstMonth'])['month']).toInt())} ${_m(life['worstMonth'])['year']} · ${_fmt(_m(life['worstMonth'])['totalOrders'])}', T.danger),
                    if (_l(d['strengths']).isNotEmpty) ...[
                      const SizedBox(height: 8),
                      Text(tr('نقاط القوة', 'Strengths'), style: const TextStyle(fontWeight: FontWeight.w800, color: T.success)),
                      for (final n in _l(d['strengths'])) Text('• ${_note(n)}', style: const TextStyle(fontSize: 12.5)),
                    ],
                    if (_l(d['weaknesses']).isNotEmpty) ...[
                      const SizedBox(height: 8),
                      Text(tr('نقاط الضعف', 'Weaknesses'), style: const TextStyle(fontWeight: FontWeight.w800, color: T.danger)),
                      for (final n in _l(d['weaknesses'])) Text('• ${_note(n)}', style: const TextStyle(fontSize: 12.5)),
                    ],
                    const SizedBox(height: 8),
                    Text(tr('الأشهر', 'Months'), style: const TextStyle(fontWeight: FontWeight.w800)),
                    for (final m in _l(d['months']))
                      ListTile(
                        dense: true, contentPadding: EdgeInsets.zero,
                        title: Text('${_monthName(_n(m['month']).toInt())} ${m['year']}'),
                        subtitle: Text('${_fmt(m['totalOrders'])} ${tr('طلب', 'orders')} · ${m['workingDays']} ${tr('يوم', 'days')} · ${_n(m['dailyRate']).toStringAsFixed(1)}/${tr('يوم', 'day')}'
                            '${_n(m['daysOff']) > 0 ? ' · ${tr('توقف', 'off')} ${m['daysOff']}' : ''}${_n(m['shortOfTarget']) > 0 ? ' · ${tr('ناقص', 'short')} ${_fmt(m['shortOfTarget'])}' : ''}'),
                        trailing: Text(_pct(m['performancePercent']), style: TextStyle(fontWeight: FontWeight.w800, color: _perfColor(_n(m['performancePercent'])))),
                      ),
                  ]),
      ),
    );
  }
}
