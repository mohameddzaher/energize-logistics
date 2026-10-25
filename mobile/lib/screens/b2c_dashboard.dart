import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/export_sheet.dart';
import '../ui/hr_quick.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';
import 'b2c_operating_orders.dart';
import 'b2c_orders_report.dart';
import 'b2c_vehicles.dart';
import 'light_transport_list.dart';

/// لوحةُ قسم الأفراد — مطابقةٌ لـ `/system/b2c/dashboard`: فلاترٌ سريعة فوقها،
/// الموظفون بفئاتهم وكفالتهم، حالةُ العمل، المركبات والتفويض، المناديبُ حسب
/// المشروع، تقريرُ الأوردرات، التوزيعات (تُفلتِر اللوحةَ بضغطة)، «ما يحتاج عملًا»،
/// والسكن — وكلُّ رقمٍ يفتح أصحابَه. وتصديرُ أرقام اللوحة Excel.
class B2cDashboardScreen extends StatefulWidget {
  const B2cDashboardScreen({super.key});
  @override
  State<B2cDashboardScreen> createState() => _B2cDashboardScreenState();
}

Map<String, dynamic> _m(dynamic v) => v is Map ? v.cast<String, dynamic>() : <String, dynamic>{};
int _i(dynamic v) => v is num ? v.toInt() : int.tryParse('${v ?? ''}') ?? 0;

const _cats = [('rep', 'مندوب', 'Reps', Color(0xFF475569)), ('admin', 'إداري', 'Admin', Color(0xFF0D9488)), ('tech', 'فني', 'Technicians', Color(0xFFA16207))];
const _states = [('يعمل', 'Working', Color(0xFF16A34A)), ('إجازة', 'On leave', Color(0xFF0284C7)), ('موقوف', 'Suspended', Color(0xFFD97706)), ('حادث', 'Accident', Color(0xFFDC2626))];
const _rest = [('trainee', 'متدرّب', 'Trainee'), ('users', 'يوزرات', 'Rented users'), ('none', 'غير محدد', 'Not set')];
const _fallbackKeys = [
  ('project', 'المشروع', 'Project'), ('rep', 'المندوب', 'Rep'), ('vehicle', 'المركبة', 'Vehicle'), ('auth', 'التفويض', 'Authorisation'),
  ('cr', 'السجل التجاري', 'Commercial register'), ('engagement', 'كفالة / فريلانسر', 'Engagement'), ('category', 'الفئة', 'Category'),
  ('city', 'المدينة', 'City'), ('status', 'حالة العمل', 'Work status'),
];

class _B2cDashboardScreenState extends State<B2cDashboardScreen> {
  Map<String, dynamic>? _d;
  bool _loading = true;
  String? _error;
  Map<String, String> _f = {};
  int _seq = 0;
  static const _events = ['lt:*', 'hr:employee', 'hr:master', 'vreg:updated', 'b2c:rep:updated'];

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

  void _onLive() { if (mounted) _load(); }

  String _qs(Map<String, String> o) => o.entries.where((e) => e.value.isNotEmpty).map((e) => '${e.key}=${Uri.encodeQueryComponent(e.value)}').join('&');

  Future<void> _load() async {
    final mine = ++_seq;
    final q = _qs(_f);
    try {
      final d = await Api.instance.get('/api/light-transport/overview${q.isEmpty ? '' : '?$q'}');
      if (!mounted || mine != _seq) return;
      setState(() { _d = _m(d); _error = null; _loading = false; });
    } catch (e) {
      if (!mounted || mine != _seq) return;
      setState(() { _error = e is ApiException ? e.message : '$e'; _loading = false; });
    }
  }

  void _toggle(String k, String v) {
    final cur = (_f[k] ?? '').split(',').where((x) => x.isNotEmpty).toList();
    cur.contains(v) ? cur.remove(v) : cur.add(v);
    setState(() { _f = Map.of(_f); if (cur.isEmpty) { _f.remove(k); } else { _f[k] = cur.join(','); } });
    _load();
  }

  // ── الأرقامُ تفتح أصحابَها: الناسُ (في الخدمة وحدَهم ما لم يُطلَب المنتهي) أو المركبات ──
  void _people(String title, [Map<String, String> extra = const {}]) {
    final includeEnded = (_f['status'] ?? '').split(',').contains('إنهاء خدمة');
    final q = {..._f, if (!includeEnded) 'inService': '1', ...extra}..removeWhere((k, v) => v.isEmpty);
    Navigator.push(context, MaterialPageRoute(builder: (_) => LightTransportListScreen(initial: q, title: title)));
  }

  void _vehicles(String title, [Map<String, String> extra = const {}]) {
    final q = {..._f, ...extra}..removeWhere((k, v) => v.isEmpty);
    Navigator.push(context, MaterialPageRoute(builder: (_) => B2cVehiclesScreen(query: q, title: title)));
  }

  List<Map<String, dynamic>> _flat(Map<String, dynamic> d) {
    final b = _m(d['board']);
    final e = _m(d['employees']);
    final cats = _m(b['categories']);
    final st = _m(b['status']);
    final auth = _m(_m(b['vehicles'])['auth']);
    Map<String, dynamic> row(String g, String v, int n) => {'group': g, 'value': v, 'count': n};
    return [
      row(tr('الإجمالي', 'Total'), '', _i(b['total'])),
      for (final c in _cats)
        for (final k in const ['sponsored', 'freelance', 'trainee', 'users', 'none'])
          row(tr(c.$2, c.$3), k, _i(_m(cats[c.$1])[k])),
      for (final s in _states) row(tr('حالة العمل', 'Work status'), s.$1, _i(_m(st[s.$1])['total'])),
      row(tr('المركبات', 'Vehicles'), tr('الإجمالي', 'Total'), _i(_m(b['vehicles'])['total'])),
      row(tr('المركبات', 'Vehicles'), tr('مفوَّضة', 'Authorised'), _i(auth['authorized'])),
      row(tr('المركبات', 'Vehicles'), tr('تفويض منتهٍ', 'Expired'), _i(auth['expired'])),
      row(tr('المركبات', 'Vehicles'), tr('بلا تفويض', 'Not authorised'), _i(auth['none'])),
      for (final x in _m(e['byProject']).entries) row(tr('المشروع', 'Project'), x.key, _i(x.value)),
      for (final x in _m(e['byCity']).entries) row(tr('الفرع', 'Branch'), x.key, _i(x.value)),
      for (final x in _m(e['byRegister']).entries) row(tr('السجل', 'Register'), x.key, _i(x.value)),
    ];
  }

  @override
  Widget build(BuildContext context) {
    final d = _d;
    return AppScaffold(
      title: Text(tr('لوحة قسم الأفراد', 'B2C board')),
      actions: [
        if (d != null)
          ExportButton(
            fileName: 'b2c-board', sheetName: 'Board',
            columns: [ExportCol('التقسيم', 'Breakdown', (r) => r['group']), ExportCol('القيمة', 'Value', (r) => r['value']), ExportCol('العدد', 'Count', (r) => r['count'])],
            rows: () => _flat(d),
          ),
      ],
      body: _loading
          ? ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(height: 60), SizedBox(height: 10), Shimmer(height: 200), SizedBox(height: 10), Shimmer(height: 200)])
          : d == null || _m(d['board']).isEmpty
              ? ErrorRetry(message: _error ?? tr('تعذّر تحميل اللوحة', 'Could not load the board'), onRetry: () { setState(() => _loading = true); _load(); })
              : RefreshIndicator(onRefresh: _load, child: _body(d)),
    );
  }

  Widget _title(String t, [String? hint]) => Padding(
        padding: const EdgeInsets.only(top: 14, bottom: 6),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(t, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14, color: T.ink)),
          if (hint != null) Text(hint, style: const TextStyle(fontSize: 11, color: T.inkFaint)),
        ]),
      );

  Widget _box(List<Widget> children) => Container(
        margin: const EdgeInsets.only(bottom: 8),
        decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(16), border: Border.all(color: T.line)),
        clipBehavior: Clip.antiAlias,
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: children),
      );

  Widget _big(String label, int value, VoidCallback? onTap, {Color? dot, String? sub, double size = 24}) => InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 12, horizontal: 10),
          child: Column(children: [
            Row(mainAxisAlignment: MainAxisAlignment.center, children: [
              if (dot != null) ...[Container(width: 7, height: 7, decoration: BoxDecoration(color: dot, shape: BoxShape.circle)), const SizedBox(width: 5)],
              Text(label, style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: T.inkSoft)),
            ]),
            Text('$value', style: TextStyle(fontSize: size, fontWeight: FontWeight.w800)),
            if (sub != null) Text(sub, textAlign: TextAlign.center, style: const TextStyle(fontSize: 11, color: T.inkFaint)),
          ]),
        ),
      );

  Widget _halves(List<(String, int, VoidCallback?, int?)> xs) => Container(
        decoration: const BoxDecoration(border: Border(top: BorderSide(color: T.line))),
        child: Row(children: [
          for (final x in xs)
            Expanded(
              child: InkWell(
                onTap: x.$3,
                child: Padding(
                  padding: const EdgeInsets.symmetric(vertical: 9, horizontal: 4),
                  child: Column(children: [
                    Text(x.$1, textAlign: TextAlign.center, style: const TextStyle(fontSize: 11, color: T.inkSoft)),
                    Text('${x.$2}', style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w800)),
                    if ((x.$4 ?? 0) > 0) Text('${(x.$2 / x.$4! * 100).round()}%', style: const TextStyle(fontSize: 10, color: T.inkFaint)),
                  ]),
                ),
              ),
            ),
        ]),
      );

  Widget _small(String label, int v, {VoidCallback? onTap, String? hint}) => SizedBox(
        width: (MediaQuery.of(context).size.width - 24 - 8) / 2,
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(14),
          child: Container(
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(14), border: Border.all(color: T.line)),
            child: Column(children: [
              Text(label, textAlign: TextAlign.center, style: const TextStyle(fontSize: 11.5, color: T.inkSoft)),
              Text('$v', style: const TextStyle(fontSize: 19, fontWeight: FontWeight.w800)),
              if (hint != null) Text(hint, textAlign: TextAlign.center, style: const TextStyle(fontSize: 10.5, color: T.inkFaint)),
            ]),
          ),
        ),
      );

  /// توزيعٌ يُفلتِر اللوحةَ بضغطة (المشروع، الفرع، الوظيفة، المشرف، نوع المركبة).
  Widget _breakdown(String title, Map<String, dynamic> data, {String? filterKey}) {
    final rows = data.entries.where((e) => _i(e.value) > 0 && e.key != '—').toList()
      ..sort((a, b) { final c = _i(b.value).compareTo(_i(a.value)); return c != 0 ? c : a.key.compareTo(b.key); });
    if (rows.isEmpty) return const SizedBox.shrink();
    final max = _i(rows.first.value);
    final total = rows.fold<int>(0, (n, e) => n + _i(e.value));
    final picked = (filterKey == null ? '' : _f[filterKey] ?? '').split(',');
    return _box([
      Padding(
        padding: const EdgeInsets.fromLTRB(12, 10, 12, 4),
        child: Text('$title ($total)', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13)),
      ),
      for (final e in rows)
        InkWell(
          onTap: filterKey == null ? null : () => _toggle(filterKey, e.key),
          child: Container(
            color: picked.contains(e.key) ? T.canvas : null,
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 5),
            child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              Row(children: [
                Expanded(child: Text(e.key, overflow: TextOverflow.ellipsis, style: TextStyle(fontSize: 12.5, fontWeight: picked.contains(e.key) ? FontWeight.w800 : FontWeight.w500))),
                Text('${_i(e.value)} · ${(_i(e.value) / total * 100).round()}%', style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700)),
              ]),
              const SizedBox(height: 3),
              ClipRRect(
                borderRadius: BorderRadius.circular(3),
                child: LinearProgressIndicator(value: _i(e.value) / max, minHeight: 4, backgroundColor: T.canvas,
                    color: picked.contains(e.key) ? T.orange : const Color(0xFF94A3B8)),
              ),
            ]),
          ),
        ),
      const SizedBox(height: 8),
    ]);
  }

  Widget _body(Map<String, dynamic> d) {
    final b = _m(d['board']);
    final e = _m(d['employees']);
    final v = _m(d['vehicles']);
    final cats = _m(b['categories']);
    final st = _m(b['status']);
    final bv = _m(b['vehicles']);
    final auth = _m(bv['auth']);
    final gaps = _m(d['gaps']);
    final reps = _m(d['reps']);
    final housing = List<Map<String, dynamic>>.from(((d['housing'] as List?) ?? const []).map(_m));
    final total = _i(b['total']);
    final none = _i(_m(cats['none'])['total']);
    final qk = ((d['quickFilters'] as List?) ?? const []).map(_m).map((x) => ('${x['key']}', '${x['ar']}', '${x['en']}')).toList();
    final facets = [for (final x in _m(d['filterOptions']).entries) {'key': x.key, 'values': x.value}];
    final projects = List<Map<String, dynamic>>.from(((reps['projects'] as List?) ?? const []).map(_m));

    return ListView(padding: const EdgeInsets.fromLTRB(12, 12, 12, 30), children: [
      HrQuickFilters(
        value: _f,
        keys: qk.isEmpty ? _fallbackKeys : qk,
        facets: facets,
        onChanged: (n) { setState(() => _f = n); _load(); },
      ),
      _title(tr('الموظفون', 'People')),
      _box([
        _big(tr('الإجمالي', 'Total'), total, () => _people(tr('الموظفون', 'People')), size: 32,
            sub: [for (final c in _cats) '${tr(c.$2, c.$3)} ${_i(_m(cats[c.$1])['total'])}', if (none > 0) '${tr('غير مصنَّف', 'Uncategorised')} $none'].join(' · ')),
      ]),
      for (final c in _cats)
        Builder(builder: (_) {
          final n = _m(cats[c.$1]);
          final name = tr(c.$2, c.$3);
          final rest = _rest.where((r) => _i(n[r.$1]) > 0).toList();
          return _box([
            _big(name, _i(n['total']), () => _people(name, {'category': c.$1}), dot: c.$4),
            _halves([
              (tr('على الكفالة', 'Sponsored'), _i(n['sponsored']), () => _people('$name — ${tr('على الكفالة', 'Sponsored')}', {'category': c.$1, 'engagement': 'sponsored'}), _i(n['total'])),
              (tr('فريلانسر', 'Freelance'), _i(n['freelance']), () => _people('$name — ${tr('فريلانسر', 'Freelance')}', {'category': c.$1, 'engagement': 'freelance'}), _i(n['total'])),
            ]),
            if (rest.isNotEmpty)
              Container(
                decoration: const BoxDecoration(border: Border(top: BorderSide(color: T.line))),
                padding: const EdgeInsets.symmetric(vertical: 6),
                child: Wrap(alignment: WrapAlignment.center, spacing: 12, children: [
                  for (final r in rest)
                    InkWell(
                      onTap: () => _people('$name — ${tr(r.$2, r.$3)}', {'category': c.$1, 'engagement': r.$1}),
                      child: Text('${tr(r.$2, r.$3)} ${_i(n[r.$1])}', style: const TextStyle(fontSize: 11.5, color: T.inkSoft)),
                    ),
                ]),
              ),
          ]);
        }),
      if (none > 0)
        TextButton(
          onPressed: () => _people(tr('غير مصنَّف', 'Uncategorised'), {'category': 'none'}),
          child: Text(tr('$none بلا فئة (لا وظيفة ولا فئة وظيفية) — اضغط لعرضهم وتحديدها', '$none uncategorised — tap to see them'), style: const TextStyle(fontSize: 12)),
        ),
      _title(tr('حالة العمل', 'Work status'),
          tr('تُعدَّل من صفّ الموظف في «موظفو النقل الخفيف» — والإجازة والإيقاف من الموارد البشرية يغلبان', 'Set from the employee row — HR leave and suspension take precedence')),
      for (final s in _states)
        Builder(builder: (_) {
          final n = _m(st[s.$1]);
          final name = tr(s.$1, s.$2);
          return _box([
            _big(name, _i(n['total']), () => _people(name, {'status': s.$1}), dot: s.$3,
                sub: total > 0 ? '${(_i(n['total']) / total * 100).round()}%' : null),
            _halves([
              for (final c in _cats) (tr(c.$2, c.$3), _i(n[c.$1]), () => _people('$name — ${tr(c.$2, c.$3)}', {'status': s.$1, 'category': c.$1}), null),
            ]),
            if (_i(n['none']) > 0)
              InkWell(
                onTap: () => _people('$name — ${tr('غير مصنَّف', 'Uncategorised')}', {'status': s.$1, 'category': 'none'}),
                child: Padding(padding: const EdgeInsets.all(5), child: Text(tr('غير مصنَّف ${_i(n['none'])}', 'Uncategorised ${_i(n['none'])}'), textAlign: TextAlign.center, style: const TextStyle(fontSize: 10.5, color: T.inkSoft))),
              ),
          ]);
        }),
      _title(tr('المركبات', 'Vehicles'), tr('كل ما ينسبه قسم المركبات إلى النقل الخفيف وما عليه راكب من القسم — والتفويض من سجلّ المركبات', 'Everything assigned to light transport plus anything ridden by the section')),
      _box([
        _big(tr('مركبات القسم', 'Section vehicles'), _i(bv['total']), () => _vehicles(tr('مركبات القسم', 'Section vehicles')),
            sub: tr('عليها أمر تشغيل سارٍ ${_i(bv['onActiveOrder'])}', 'Under an active order ${_i(bv['onActiveOrder'])}')),
        _halves([
          (tr('عليها راكب', 'With a rider'), _i(bv['withRider']), () => _vehicles(tr('عليها راكب', 'With a rider'), {'vstate': 'withRider'}), _i(bv['total'])),
          (tr('بانتظار التسليم', 'Awaiting hand-over'), _i(bv['hold']), () => _vehicles(tr('بانتظار التسليم', 'Awaiting hand-over'), {'vstate': 'hold'}), _i(bv['total'])),
          (tr('واقفة بلا راكب', 'Idle'), _i(bv['idle']), () => _vehicles(tr('واقفة بلا راكب', 'Idle'), {'vstate': 'idle'}), _i(bv['total'])),
        ]),
      ]),
      _box([
        _big(tr('التفويض', 'Authorisation'), _i(auth['authorized']) + _i(auth['expired']) + _i(auth['none']), () => _vehicles(tr('التفويض', 'Authorisation')),
            sub: tr('حسب «المفوَّض بالقيادة» في سجلّ المركبات', 'By the authorised person in the vehicle register')),
        _halves([
          (tr('مفوَّض', 'Authorised'), _i(auth['authorized']), () => _vehicles(tr('مفوَّض', 'Authorised'), {'auth': 'authorized'}), _i(bv['total'])),
          (tr('تفويض منتهٍ', 'Expired'), _i(auth['expired']), () => _vehicles(tr('تفويض منتهٍ', 'Expired'), {'auth': 'expired'}), _i(bv['total'])),
          (tr('بلا تفويض', 'Not authorised'), _i(auth['none']), () => _vehicles(tr('بلا تفويض', 'Not authorised'), {'auth': 'none'}), _i(bv['total'])),
        ]),
      ]),
      if (projects.isNotEmpty) ...[
        _title(tr('المناديب حسب المشروع', 'Reps by project'), tr('(${_i(reps['total'])} — ومعهم اليوزرات المؤجَّرة)', '(${_i(reps['total'])} incl. rented users)')),
        for (final p in projects)
          Builder(builder: (_) {
            final name = '${p['project']}';
            Map<String, String> q([String kind = '']) => {'staffKind': 'rep', 'project': name, if (kind.isNotEmpty) 'contractKind': kind};
            return _box([
              InkWell(
                onTap: () => _people(name, q()),
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
                  child: Row(children: [
                    Expanded(child: Text(name, style: const TextStyle(fontWeight: FontWeight.w700))),
                    Text('${_i(p['total'])}', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
                  ]),
                ),
              ),
              _halves([
                (tr('كفالة', 'Sponsored'), _i(p['sponsored']), () => _people('$name — ${tr('كفالة', 'Sponsored')}', q('sponsored')), null),
                (tr('فريلانسر', 'Freelance'), _i(p['freelance']), () => _people('$name — ${tr('فريلانسر', 'Freelance')}', q('freelance')), null),
                (tr('يوزرات', 'Users'), _i(p['users']), () => _people('$name — ${tr('يوزرات', 'Users')}', q('users')), null),
              ]),
              if (_i(p['noContract']) > 0)
                InkWell(
                  onTap: () => _people('$name — ${tr('غير محدد', 'Not set')}', q('none')),
                  child: Padding(padding: const EdgeInsets.all(5), child: Text(tr('${_i(p['noContract'])} غير محدد — اضغط لعرضهم', '${_i(p['noContract'])} not set — tap to see them'), textAlign: TextAlign.center, style: const TextStyle(fontSize: 10.5, color: T.inkSoft))),
                ),
            ]);
          }),
      ],
      const SizedBox(height: 6),
      const B2cOrdersReportCard(),
      const SizedBox(height: 8),
      _breakdown(tr('بالمشروع', 'By project'), _m(e['byProject']), filterKey: 'project'),
      _breakdown(tr('بالفرع', 'By branch'), _m(e['byCity']), filterKey: 'city'),
      _breakdown(tr('بالوظيفة', 'By job'), _m(e['byJob']), filterKey: 'jobTitle'),
      _breakdown(tr('بالمشرف', 'By supervisor'), _m(e['bySupervisor']), filterKey: 'supervisor'),
      _breakdown(tr('بنوع المركبة', 'By vehicle type'), _m(v['byType']), filterKey: 'vehicleType'),
      _breakdown(tr('مركبات بحالة التشغيل', 'Vehicles by service status'), _m(v['byServiceStatus'])),
      _title(tr('ما يحتاج عملًا', 'Needs attention')),
      Wrap(spacing: 8, runSpacing: 8, children: [
        _small(tr('يعملون بلا مركبة', 'Working without a vehicle'), _i(gaps['workingWithoutVehicle']),
            onTap: () => _people(tr('يعملون بلا مركبة', 'Working without a vehicle'), {'hasVehicle': 'no', 'status': 'يعمل,إجازة'})),
        _small(tr('مركبات واقفة', 'Idle vehicles'), _i(gaps['idleVehicles']), onTap: () => _vehicles(tr('مركبات واقفة', 'Idle vehicles'), {'vstate': 'idle'})),
        _small(tr('تفويض باسم غير الراكب', 'Authorised to someone else'), _i(gaps['authorizationMismatch']),
            hint: tr('يُصحَّح من أوامر التشغيل', 'fix from operating orders'),
            onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const LtOperatingOrdersScreen()))),
        _small(tr('مناديب بلا مشرف', 'Reps with no supervisor'), _i(gaps['noSupervisor']),
            onTap: () => _people(tr('مناديب بلا مشرف', 'Reps with no supervisor'), {'staffKind': 'rep', 'supervisor': 'none'})),
        _small(tr('بلا سكن', 'Unhoused'), _i(gaps['unhoused']), onTap: () => _people(tr('بلا سكن', 'Unhoused'), {'housing': 'none'})),
        _small(tr('بلا ملفّ في الموارد البشرية', 'No HR file'), _i(gaps['noHrFile']), hint: tr('القسم يملك سجلّهم', 'owned by the section')),
        _small(tr('قسمه في الموارد البشرية غير ${b['b2cDepartment'] ?? ''}', 'HR department is not ${b['b2cDepartment'] ?? ''}'), _i(b['otherDepartment']),
            hint: tr('نُقل هناك — يُراجَع هنا', 'moved in HR — review here')),
        _small(tr('أوامر تشغيل سارية', 'Active orders'), _i(_m(d['orders'])['active']),
            onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const LtOperatingOrdersScreen()))),
      ]),
      _title(tr('السكن', 'Housing')),
      Wrap(spacing: 8, runSpacing: 8, children: [
        _small(tr('لهم سكن', 'Housed'), _i(e['housed'])),
        _small(tr('بلا سكن', 'Unhoused'), _i(e['unhoused']), onTap: () => _people(tr('بلا سكن', 'Unhoused'), {'housing': 'none'})),
        _small(tr('سعة السكن', 'Total capacity'), housing.fold<int>(0, (n, h) => n + _i(h['capacity']))),
        _small(tr('الأماكن المتاحة', 'Places free'), housing.fold<int>(0, (n, h) => n + _i(h['free']))),
      ]),
      const SizedBox(height: 8),
      for (final h in housing)
        Builder(builder: (_) {
          final full = _i(h['capacity']) > 0 && _i(h['occupied']) >= _i(h['capacity']);
          final rooms = List<Map<String, dynamic>>.from(((h['rooms'] as List?) ?? const []).map(_m));
          return AppCard(
            padding: const EdgeInsets.all(10),
            child: InkWell(
              onTap: () => _people('${h['name']}', {'housing': '${h['_id']}'}),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Row(children: [
                  Expanded(child: Text('${h['name']}${(h['cityAr'] ?? '').toString().isEmpty ? '' : ' · ${h['cityAr']}'}', style: const TextStyle(fontWeight: FontWeight.w800))),
                  Text('${_i(h['occupied'])}/${_i(h['capacity'])} · ${full ? tr('مكتمل', 'full') : '${tr('متاح', 'free')} ${_i(h['free'])}'}',
                      style: const TextStyle(fontSize: 12, color: T.inkSoft)),
                ]),
                const SizedBox(height: 4),
                rooms.isEmpty
                    ? Text(tr('بلا غرف', 'no rooms'), style: const TextStyle(fontSize: 11.5, color: T.inkFaint))
                    : Wrap(spacing: 4, runSpacing: 4, children: [
                        for (final r in rooms) Chip2('${r['name']} ${_i(r['occupied'])}/${_i(r['capacity'])}', r['kind'] == 'rep' ? T.info : r['kind'] == 'admin' ? T.success : T.inkFaint),
                      ]),
              ]),
            ),
          );
        }),
    ]);
  }
}
