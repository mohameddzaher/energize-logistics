import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/export_sheet.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';
import '../ui/search_field.dart';
import 'performance_evaluations.dart';

/// تقييم الأداء (للإدارة العليا) — نظرة كل الأقسام: التغطية، متوسط النسبة،
/// التوزيع حسب النطاق، وأداء كل قسم. مطابقة لصفحة الويب
/// /system/performance/overview.
class PerformanceOverviewScreen extends StatefulWidget {
  const PerformanceOverviewScreen({super.key});
  @override
  State<PerformanceOverviewScreen> createState() => _PerformanceOverviewScreenState();
}

class _PerformanceOverviewScreenState extends State<PerformanceOverviewScreen> {
  Map<String, dynamic>? _data;
  bool _loading = true;
  String? _error;
  String _q = '';
  // متحكِّمُ البحث عند الشاشة: الخانةُ وسطَ قائمةٍ تُبنى من جديد، فلا يضيع نصُّها والكلمةُ تُرشِّح.
  final _searchCtl = TextEditingController();
  // الفترة ربعٌ كالويب (currentPeriod) ويُتنقّل بينها بالأسهم.
  int _year = DateTime.now().year;
  int _quarter = (DateTime.now().month - 1) ~/ 3 + 1;
  int _seq = 0;

  void _onLive() => _load();

  String get _periodKey => '$_year-Q$_quarter';
  String get _periodLabel {
    const q = ['', 'الأول', 'الثاني', 'الثالث', 'الرابع'];
    return tr('الربع ${q[_quarter]} $_year', 'Q$_quarter $_year');
  }

  @override
  void initState() {
    super.initState();
    _load();
    Live.instance.on('performance:updated', _onLive);
  }

  @override
  void dispose() {
    Live.instance.off('performance:updated', _onLive);
    _searchCtl.dispose();
    super.dispose();
  }

  void _step(int dir) {
    var q = _quarter + dir;
    var y = _year;
    if (q > 4) { q = 1; y += 1; } else if (q < 1) { q = 4; y -= 1; }
    setState(() { _quarter = q; _year = y; _loading = _data == null; });
    _load();
  }

  Future<void> _load() async {
    final my = ++_seq;
    try {
      final d = await Api.instance.get('/api/performance/overview?period=$_periodKey');
      if (!mounted || my != _seq) return;
      setState(() { _data = Map<String, dynamic>.from(d); _loading = false; _error = null; });
    } catch (e) {
      if (mounted && my == _seq) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  /// نطاق التقييم (للّون) من إعدادات الخادم — bandOf في الويب.
  Color _bandFor(dynamic v) {
    if (v is! num) return T.navy;
    final bands = List<Map<String, dynamic>>.from(_data?['settings']?['bands'] ?? []);
    for (var i = 0; i < bands.length; i++) {
      final b = bands[i];
      final min = (b['min'] ?? 0) as num, max = (b['max'] ?? 0) as num;
      if (v >= min && (i == bands.length - 1 ? v <= max : v < max)) return _bandColor((b['color'] ?? '').toString());
    }
    return T.navy;
  }

  String _fold(String s) => s.replaceAll(RegExp('[أإآ]'), 'ا').replaceAll('ى', 'ي').replaceAll('ة', 'ه').toLowerCase();
  String _pct(dynamic v) => v == null ? '—' : '${(v is num ? v : num.tryParse(v.toString()) ?? 0)}%';

  @override
  Widget build(BuildContext context) {
    final d = _data;
    final totals = Map<String, dynamic>.from(d?['totals'] ?? {});
    final byBand = List<Map<String, dynamic>>.from(totals['byBand'] ?? []);
    final departments = List<Map<String, dynamic>>.from(d?['departments'] ?? []);
    final q = _fold(_q.trim());
    final deps = q.isEmpty ? departments : departments.where((x) => _fold((x['department'] ?? '').toString()).contains(q)).toList();

    return AppScaffold(
      title: Text(tr('نظرة كل الأقسام', 'All Departments')),
      actions: [
        // صفٌّ لكلّ قسمٍ في الفترة المختارة — نطاقٌ واحد كالويب.
        ExportButton(
          fileName: 'performance-overview-$_periodKey',
          sheetName: tr('تفصيل الأقسام', 'Department breakdown'),
          columns: [
            ExportCol('القسم', 'Department', (r) => r['department']),
            ExportCol('عدد الموظفين', 'Headcount', (r) => r['headcount']),
            ExportCol('تم تقييمهم', 'Evaluated', (r) => r['evaluated']),
            ExportCol('التغطية %', 'Coverage %', (r) => r['coverage']),
            ExportCol('متوسط الأداء %', 'Avg %', (r) => r['avgPercentage'] ?? ''),
            ExportCol('الطبقة', 'Tier', (r) => r['tier'] ?? ''),
            ExportCol('البونص (رواتب)', 'Bonus (salaries)', (r) => r['bonusSalaries']),
          ],
          rows: () => departments,
        ),
      ],
      body: _loading
          ? ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(height: 90), SizedBox(height: 10), Shimmer(height: 140)])
          : _error != null
              ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView(keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag, padding: const EdgeInsets.all(14), children: [
                    AppCard(
                      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                      child: Row(children: [
                        IconButton(onPressed: () => _step(-1), icon: const Icon(Icons.chevron_left), tooltip: tr('السابق', 'Previous')),
                        Expanded(
                          child: Column(children: [
                            Text(_periodLabel, textAlign: TextAlign.center, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14)),
                            Text('${totals['evaluated'] ?? 0}/${totals['headcount'] ?? 0} ${tr('تم تقييمهم', 'evaluated')}', style: const TextStyle(fontSize: 11, color: T.inkFaint)),
                          ]),
                        ),
                        IconButton(onPressed: () => _step(1), icon: const Icon(Icons.chevron_right), tooltip: tr('التالي', 'Next')),
                      ]),
                    ),
                    const SizedBox(height: 10),
                    GridView.count(
                      crossAxisCount: 2, shrinkWrap: true, physics: const NeverScrollableScrollPhysics(),
                      childAspectRatio: 1.7, mainAxisSpacing: 8, crossAxisSpacing: 8,
                      children: [
                        _tile(tr('إجمالي الموظفين', 'Headcount'), '${totals['headcount'] ?? 0}', T.navy, Icons.groups_outlined),
                        _tile(tr('تم تقييمهم', 'Evaluated'), '${totals['evaluated'] ?? 0}', T.success, Icons.fact_check_outlined),
                        _tile(tr('نسبة التغطية', 'Coverage'), _pct(totals['coverage']), T.info, Icons.donut_large_outlined),
                        _tile(tr('متوسط النسبة', 'Avg %'), _pct(totals['avgPercentage']), T.orange, Icons.percent_rounded),
                        _tile(tr('مسودّات', 'Drafts'), '${totals['drafts'] ?? 0}', T.warn, Icons.edit_note_outlined),
                        _tile(tr('رواتب المكافآت', 'Bonus salaries'), '${totals['totalBonusSalaries'] ?? 0}', T.violet, Icons.card_giftcard_outlined),
                      ],
                    ),
                    const SizedBox(height: 10),
                    Container(
                      padding: const EdgeInsets.all(10),
                      decoration: BoxDecoration(color: T.info.withValues(alpha: 0.07), borderRadius: BorderRadius.circular(10), border: Border.all(color: T.info.withValues(alpha: 0.25))),
                      child: Text(
                        tr('إجمالي البونص معروض بعدد مضاعفات الرواتب وليس بمبالغ نقدية، لأن المنظومة لا تتضمن بيانات الرواتب. لتحويله لتكلفة فعلية يُضرب بونص كل موظف في راتبه.',
                            'The bonus total is a count of salary multiples, not cash — the system holds no payroll data. Multiply each employee’s bonus by their salary for the real cost.'),
                        style: const TextStyle(fontSize: 11, color: T.info),
                      ),
                    ),
                    if (byBand.isNotEmpty) ...[
                      const SizedBox(height: 14),
                      AppCard(
                        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          Text(tr('التوزيع حسب النطاق', 'By band'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14)),
                          const SizedBox(height: 10),
                          Wrap(spacing: 8, runSpacing: 8, children: byBand.map((b) {
                            final color = _bandColor((b['color'] ?? '').toString());
                            final name = (Lang.instance.ar ? b['ar'] : b['en'])?.toString() ?? (b['key'] ?? '').toString();
                            return Chip2('$name: ${b['count'] ?? 0}', color);
                          }).toList()),
                        ]),
                      ),
                    ],
                    const SizedBox(height: 14),
                    SearchField(controller: _searchCtl, hint: tr('ابحث بالقسم…', 'Search department…'), onChanged: (v) => setState(() => _q = v)),
                    const SizedBox(height: 10),
                    Text(tr('الأقسام', 'Departments'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
                    const SizedBox(height: 8),
                    if (deps.isEmpty)
                      EmptyState(icon: Icons.workspaces_outline, title: _q.trim().isNotEmpty ? tr('لا نتائج مطابقة للبحث', 'No matches') : tr('لا توجد أقسام', 'No departments'))
                    else
                      ...deps.map((dep) {
                        final cov = (dep['coverage'] is num) ? (dep['coverage'] as num) : 0;
                        return Padding(
                          padding: const EdgeInsets.only(bottom: 8),
                          child: AppCard(
                            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                              Row(children: [
                                Expanded(child: Text((dep['department'] ?? '—').toString(), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14))),
                                if (dep['avgPercentage'] != null) Chip2(_pct(dep['avgPercentage']), _bandFor(dep['avgPercentage'])),
                              ]),
                              // من أيّ صفحةِ قسمٍ يُقيَّم — كما في الويب.
                              Text(
                                (dep['sectionAr'] ?? '').toString().isNotEmpty
                                    ? tr('يُقيَّم من صفحة: ${dep['sectionAr']}', 'Evaluated from: ${dep['section']}')
                                    : tr('لا يتبع صفحة قسم — يقيّمه مدير النظام', 'No section page — evaluated by the system admin'),
                                style: const TextStyle(fontSize: 11, color: T.inkFaint),
                              ),
                              const SizedBox(height: 8),
                              Row(children: [
                                Expanded(child: Stack(children: [
                                  Container(height: 8, decoration: BoxDecoration(color: T.navy.withValues(alpha: 0.06), borderRadius: BorderRadius.circular(6))),
                                  FractionallySizedBox(widthFactor: (cov / 100).clamp(0.0, 1.0).toDouble(), child: Container(height: 8, decoration: BoxDecoration(color: T.success.withValues(alpha: 0.85), borderRadius: BorderRadius.circular(6)))),
                                ])),
                                const SizedBox(width: 8),
                                Text('${dep['evaluated'] ?? 0}/${dep['headcount'] ?? 0}', style: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.w700, color: T.inkFaint)),
                              ]),
                              const SizedBox(height: 6),
                              Wrap(spacing: 6, runSpacing: 6, children: [
                                Chip2('${tr('التغطية', 'Coverage')}: ${_pct(dep['coverage'])}', T.info),
                                Chip2('${tr('الطبقة', 'Tier')}: ${dep['tier'] ?? '—'}', T.navy),
                                Chip2('${tr('البونص (رواتب)', 'Bonus')}: ${(dep['bonusSalaries'] ?? 0) == 0 ? '—' : dep['bonusSalaries']}', T.violet),
                              ]),
                            ]),
                          ),
                        );
                      }),
                    const SizedBox(height: 24),
                  ]),
                ),
    );
  }

  Color _bandColor(String c) {
    switch (c.toLowerCase()) {
      case 'green': case 'success': return T.success;
      case 'blue': return T.info;
      case 'amber': case 'orange': case 'yellow': return T.warn;
      case 'red': return T.danger;
      case 'purple': case 'violet': return T.violet;
      default: return T.navy;
    }
  }

  Widget _tile(String label, String value, Color color, IconData icon) => AppCard(
        padding: const EdgeInsets.all(12),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Container(padding: const EdgeInsets.all(6), decoration: BoxDecoration(color: color.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(10)), child: Icon(icon, size: 16, color: color)),
          const SizedBox(height: 8),
          FittedBox(fit: BoxFit.scaleDown, alignment: AlignmentDirectional.centerStart, child: Text(value, style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800, color: color, height: 1))),
          const SizedBox(height: 2),
          Text(label, style: const TextStyle(fontSize: 10.5, color: T.inkSoft, fontWeight: FontWeight.w600)),
        ]),
      );
}

/// طلبات تعديل التقييم — قيد الانتظار تُقرَّر (موافقة/رفض بملاحظة) والمقرَّرة
/// تُراجَع. مطابقة لـ /system/performance/requests.
class PerformanceEditRequestsScreen extends StatefulWidget {
  const PerformanceEditRequestsScreen({super.key});
  @override
  State<PerformanceEditRequestsScreen> createState() => _PerformanceEditRequestsScreenState();
}

class _PerformanceEditRequestsScreenState extends State<PerformanceEditRequestsScreen> {
  List<Map<String, dynamic>> _pending = [], _recent = [];
  bool _loading = true;
  String? _error;
  String? _busy;
  // البطاقة تُفرِد قائمتها: '' / pending / approved / rejected.
  String _show = '';

  void _onLive() => _load();

  @override
  void initState() {
    super.initState();
    _load();
    Live.instance.on('performance:editRequest', _onLive);
    Live.instance.on('performance:updated', _onLive);
  }

  @override
  void dispose() {
    Live.instance.off('performance:editRequest', _onLive);
    Live.instance.off('performance:updated', _onLive);
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final d = await Api.instance.get('/api/performance/edit-requests');
      if (!mounted) return;
      setState(() {
        _pending = List<Map<String, dynamic>>.from(d['pending'] ?? []);
        _recent = List<Map<String, dynamic>>.from(d['recent'] ?? []);
        _loading = false;
        _error = null;
      });
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  Map<String, dynamic> _er(Map<String, dynamic> r) => r['editRequest'] is Map ? Map<String, dynamic>.from(r['editRequest']) : {};

  String _dt(dynamic v) {
    final d = v == null ? null : DateTime.tryParse(v.toString())?.toLocal();
    return d == null ? '—' : '${d.day}/${d.month}/${d.year} ${d.hour.toString().padLeft(2, '0')}:${d.minute.toString().padLeft(2, '0')}';
  }

  String _pct(dynamic v) => v == null ? '—' : '${v is num ? (v % 1 == 0 ? v.toInt() : v.toStringAsFixed(1)) : v}%';

  Future<void> _decide(Map<String, dynamic> r, String decision) async {
    final note = TextEditingController();
    final approve = decision == 'approve';
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: Text(approve ? tr('الموافقة على التعديل', 'Approve the edit') : tr('رفض طلب التعديل', 'Reject the request')),
        content: Column(mainAxisSize: MainAxisSize.min, children: [
          Text(
            approve
                ? tr('هيقدر يعدّل التقييم مرة واحدة، وبعدها يتقفل تاني تلقائيًا.', 'They will be able to correct it once, then it locks again automatically.')
                : tr('التقييم هيفضل مقفول، والسبب هيظهر للمُقيِّم.', 'The evaluation stays locked and your reason is shown to the evaluator.'),
            style: const TextStyle(fontSize: 12, color: T.inkSoft),
          ),
          const SizedBox(height: 10),
          TextField(controller: note, maxLines: 3, decoration: InputDecoration(hintText: tr('ملاحظة (اختيارية)', 'Note (optional)'))),
        ]),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: Text(tr('إلغاء', 'Cancel'))),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: approve ? T.success : T.danger),
            onPressed: () => Navigator.pop(c, true),
            child: Text(tr('تأكيد', 'Confirm')),
          ),
        ],
      ),
    );
    if (ok != true) return;
    setState(() => _busy = r['_id'].toString());
    try {
      await Api.instance.post('/api/performance/evaluations/${r['_id']}/edit-decision', {'decision': decision, 'note': note.text});
      await _load();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e is ApiException ? e.message : tr('فشل حفظ القرار', 'Could not record the decision'))));
    } finally {
      if (mounted) setState(() => _busy = null);
    }
  }

  List<ExportCol> get _baseCols => [
        ExportCol('الموظف', 'Employee', (r) => r['employeeName']),
        ExportCol('المسمى الوظيفي', 'Job title', (r) => r['jobTitle']),
        ExportCol('القسم', 'Department', (r) => r['department']),
        ExportCol('الفترة', 'Period', (r) => r['periodKey']),
        ExportCol('المُقيِّم', 'Evaluator', (r) => r['evaluatorName']),
        ExportCol('النتيجة الحالية', 'Current result', (r) => _pct(r['percentage'])),
        ExportCol('سبب طلب التعديل', 'Reason', (r) => _er(r)['reason']),
        ExportCol('مُقدِّم الطلب', 'Requested by', (r) => _er(r)['requestedByName']),
        ExportCol('تاريخ الطلب', 'Requested at', (r) => _dt(_er(r)['requestedAt'])),
      ];

  List<ExportCol> get _decidedCols => [
        ..._baseCols,
        ExportCol('القرار', 'Decision', (r) => _er(r)['status'] == 'approved' ? tr('موافق', 'Approved') : _er(r)['status'] == 'rejected' ? tr('مرفوض', 'Rejected') : '—'),
        ExportCol('صاحب القرار', 'Decided by', (r) => _er(r)['decidedByName']),
        ExportCol('تاريخ القرار', 'Decided at', (r) => _dt(_er(r)['decidedAt'])),
        ExportCol('ملاحظة القرار', 'Decision note', (r) => _er(r)['decisionNote']),
      ];

  Future<void> _export() async {
    final k = await showModalBottomSheet<String>(
      context: context,
      builder: (c) => SafeArea(
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          ListTile(title: Text(tr('الطلبات المعلّقة', 'Pending requests')), onTap: () => Navigator.pop(c, 'pending')),
          ListTile(title: Text(tr('القرارات السابقة', 'Recent decisions')), onTap: () => Navigator.pop(c, 'decided')),
          ListTile(title: Text(tr('الكل (شيتان)', 'All (2 sheets)')), onTap: () => Navigator.pop(c, 'all')),
        ]),
      ),
    );
    if (k == null || !mounted) return;
    final pendingSheet = (tr('قيد المراجعة', 'Pending'), _baseCols, _pending);
    final decidedSheet = (tr('قرارات سابقة', 'Decided'), _decidedCols, _recent);
    await exportExcel(context, fileName: 'performance-edit-requests',
        sheets: k == 'pending' ? [pendingSheet] : k == 'decided' ? [decidedSheet] : [pendingSheet, decidedSheet]);
  }

  Widget _statCard(String key, String label, int n, Color color) => Expanded(
        child: Pressable(
          onTap: () => setState(() => _show = _show == key ? '' : key),
          child: AppCard(
            topAccent: _show == key ? color : null,
            padding: const EdgeInsets.all(10),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text('$n', style: TextStyle(fontSize: 20, fontWeight: FontWeight.w900, color: color)),
              Text(label, style: const TextStyle(fontSize: 10.5, color: T.inkSoft), maxLines: 2),
            ]),
          ),
        ),
      );

  @override
  Widget build(BuildContext context) {
    final approved = _recent.where((r) => _er(r)['status'] == 'approved').length;
    final rejected = _recent.where((r) => _er(r)['status'] == 'rejected').length;
    final recentShown = _show == 'approved' || _show == 'rejected' ? _recent.where((r) => _er(r)['status'] == _show).toList() : _recent;
    return AppScaffold(
      title: Text(tr('طلبات تعديل التقييمات', 'Evaluation edit requests')),
      actions: [IconButton(tooltip: tr('تصدير Excel', 'Export Excel'), icon: const Icon(Icons.file_download_outlined), onPressed: _export)],
      body: _loading
          ? ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(height: 70), SizedBox(height: 10), Shimmer(height: 70)])
          : _error != null
              ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView(padding: const EdgeInsets.all(14), children: [
                    Row(children: [
                      _statCard('pending', tr('قيد المراجعة', 'Pending'), _pending.length, T.warn),
                      const SizedBox(width: 8),
                      _statCard('approved', tr('تمت الموافقة (آخر ٥٠)', 'Approved (last 50)'), approved, T.success),
                      const SizedBox(width: 8),
                      _statCard('rejected', tr('مرفوضة (آخر ٥٠)', 'Rejected (last 50)'), rejected, T.danger),
                    ]),
                    const SizedBox(height: 14),
                    if (_show == '' || _show == 'pending') ...[
                      Text(tr('في انتظار القرار', 'Awaiting decision'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
                      const SizedBox(height: 8),
                      if (_pending.isEmpty) EmptyState(icon: Icons.inbox_outlined, title: tr('لا توجد طلبات معلّقة', 'No pending requests')),
                      ..._pending.map(_pendingCard),
                    ],
                    if (_show != 'pending' && recentShown.isNotEmpty) ...[
                      const SizedBox(height: 14),
                      Text(tr('قرارات سابقة', 'Recent decisions'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
                      const SizedBox(height: 8),
                      ...recentShown.map(_decidedCard),
                    ],
                    const SizedBox(height: 24),
                  ]),
                ),
    );
  }

  Widget _pendingCard(Map<String, dynamic> r) {
    final er = _er(r);
    final busy = _busy == r['_id'];
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: AppCard(
        topAccent: T.warn,
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            Expanded(child: Text((r['employeeName'] ?? '—').toString(), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14))),
            TextButton.icon(
              onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => EvaluateEmployeeScreen(
                    employeeId: (r['employee'] ?? '').toString(), name: (r['employeeName'] ?? '').toString(), periodKey: (r['periodKey'] ?? '').toString()))),
              icon: const Icon(Icons.open_in_new, size: 15),
              label: Text(tr('فتح التقييم', 'Open evaluation'), style: const TextStyle(fontSize: 11.5)),
            ),
          ]),
          Text([r['jobTitle'], r['department'], r['periodKey']].where((x) => x != null && '$x'.isNotEmpty).join(' · '), style: const TextStyle(fontSize: 11, color: T.inkFaint)),
          const SizedBox(height: 4),
          Text('${tr('المُقيِّم: ', 'Evaluator: ')}${r['evaluatorName'] ?? '—'} · ${tr('النتيجة الحالية: ', 'Current result: ')}${_pct(r['percentage'])}',
              style: const TextStyle(fontSize: 11.5, color: T.inkSoft)),
          Container(
            width: double.infinity,
            margin: const EdgeInsets.only(top: 8),
            padding: const EdgeInsets.all(8),
            decoration: BoxDecoration(color: T.canvas, borderRadius: BorderRadius.circular(8)),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text('${tr('سبب طلب التعديل', 'Reason for the request')} — ${er['requestedByName'] ?? ''} · ${_dt(er['requestedAt'])}', style: const TextStyle(fontSize: 10.5, color: T.inkFaint)),
              Text((er['reason'] ?? '—').toString(), style: const TextStyle(fontSize: 12.5)),
            ]),
          ),
          const SizedBox(height: 8),
          if (busy)
            const LinearProgressIndicator(minHeight: 2)
          else
            Wrap(spacing: 8, runSpacing: 6, children: [
              FilledButton.icon(
                style: FilledButton.styleFrom(backgroundColor: T.success),
                onPressed: () => _decide(r, 'approve'),
                icon: const Icon(Icons.check, size: 17),
                label: Text(tr('موافقة — فتح التعديل', 'Approve — unlock edit'), style: const TextStyle(fontSize: 12)),
              ),
              OutlinedButton.icon(
                style: OutlinedButton.styleFrom(foregroundColor: T.danger),
                onPressed: () => _decide(r, 'reject'),
                icon: const Icon(Icons.close, size: 17),
                label: Text(tr('رفض — يظل مغلقًا', 'Reject — keep locked'), style: const TextStyle(fontSize: 12)),
              ),
            ]),
        ]),
      ),
    );
  }

  Widget _decidedCard(Map<String, dynamic> r) {
    final er = _er(r);
    final approved = er['status'] == 'approved';
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: AppCard(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            Expanded(child: Text((r['employeeName'] ?? '—').toString(), style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13.5))),
            Chip2(approved ? tr('موافق', 'Approved') : tr('مرفوض', 'Rejected'), approved ? T.success : T.danger),
          ]),
          Text('${r['periodKey'] ?? ''} · ${tr('المُقيِّم', 'Evaluator')}: ${r['evaluatorName'] ?? '—'} · ${_dt(er['decidedAt'])}', style: const TextStyle(fontSize: 11, color: T.inkFaint)),
          if ((er['reason'] ?? '').toString().isNotEmpty) Text(er['reason'].toString(), style: const TextStyle(fontSize: 12, color: T.inkSoft), maxLines: 2, overflow: TextOverflow.ellipsis),
        ]),
      ),
    );
  }
}
