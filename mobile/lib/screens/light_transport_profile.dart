import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../services/api.dart';
import '../services/auth.dart';
import '../ui/hr_quick.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';

/// ملفُّ موظّف النقل الخفيف — مطابقٌ لصفحة الويب
/// `/system/b2c/light-transport/[id]`.
///
/// ── لماذا ملفٌّ لا سطرٌ في قائمة ────────────────────────────────────────────
/// القائمةُ تقول أين هو اليوم ولا تقول كيف صار هناك. و«نقلناه من مشروعٍ إلى
/// مشروع» و«أنزلناه عن المركبة وأركبنا غيره» أسئلةٌ تُسأل بعد شهور — عند خلافٍ
/// على مخالفةٍ أو أجرةٍ أو عهدة — وخانةٌ تُستبدَل لا تحفظ جوابها.
///
/// فهنا: ما هو عليه الآن، وأوامرُ تشغيله من الأحدث، وسجلُّ كلّ نقلٍ بصاحبه
/// ووقته. وحالتُه تأتي مشتقّةً من الخادم (`workStatusShown`) — تُكتب في القسم
/// وتغلبها الموارد البشريّةُ حين تقول «أُنهيت خدمتُه».
class LightTransportProfileScreen extends StatefulWidget {
  final String id;
  const LightTransportProfileScreen({super.key, required this.id});
  @override
  State<LightTransportProfileScreen> createState() => _LightTransportProfileScreenState();
}

String _s(Map<String, dynamic>? m, String k) => (m?[k] ?? '').toString().trim();

String _day(dynamic v) {
  final d = v == null ? null : DateTime.tryParse(v.toString())?.toLocal();
  if (d == null) return '—';
  return '${d.day}/${d.month}/${d.year}';
}

/// أسبابُ قيدِ السجلّ بلغةٍ تُقرأ — لا مفاتيحُ إنجليزيّةٌ في شاشةٍ عربيّة.
const _kindAr = {
  'created': 'أُنشئ السجلّ',
  'project': 'نقلٌ بين المشاريع',
  'city': 'نقلٌ بين الفروع',
  'supervisor': 'تغييرُ المشرف',
  'vehicle': 'تغييرُ المركبة',
  'housing': 'تغييرُ السكن',
  'status': 'تغييرُ الحالة',
  'order': 'أمرُ تشغيل',
  'authorization': 'نقلُ تفويض',
};

Color _statusColor(String s) {
  if (s == 'إنهاء خدمة') return T.danger;
  if (s == 'متوقف') return T.warn;
  if (s == 'إجازة') return T.navy;
  return T.success;
}

class _LightTransportProfileScreenState extends State<LightTransportProfileScreen> {
  Map<String, dynamic>? _e;
  List<dynamic> _orders = const [];
  bool _loading = true;
  String? _error;
  @override
  void initState() {
    super.initState();
    _load();
    // ما يمسّ القسمَ أو ملفَّ الموارد البشريّة يمسّ ما يُعرَض هنا.
    Live.instance.on('lt:*', _onLive);
    Live.instance.on('hr:employee', _onLive);
    Live.instance.on('b2c:order:upserted', _onLive);
  }

  void _onLive() { if (mounted) _load(); }

  @override
  void dispose() {
    Live.instance.off('lt:*', _onLive);
    Live.instance.off('hr:employee', _onLive);
    Live.instance.off('b2c:order:upserted', _onLive);
    super.dispose();
  }

  /// «نقل المشروع» — الطريقُ الوحيدُ لتغيير مشروع المندوب، ولمن يملكه وحدَه (كالموقع).
  Future<void> _transfer(Map<String, dynamic> e) async {
    if (await transferLtProject(context, e)) await _load();
  }

  List _months = const [];

  Future<void> _load() async {
    try {
      final d = await Api.instance.get('/api/light-transport/employees/${widget.id}') as Map<String, dynamic>;
      // أوردراتُه موزّعةً على مشاريعه شهرًا شهرًا — من الأوردرات نفسِها (كالموقع).
      List months = const [];
      try { months = ((await Api.instance.get('/api/light-transport/employees/${widget.id}/orders'))['months'] as List?) ?? const []; } catch (_) {}
      if (!mounted) return;
      setState(() {
        _months = months;
        _e = (d['employee'] as Map?)?.cast<String, dynamic>();
        _orders = (d['orders'] as List?) ?? const [];
        _error = null;
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() { _error = e.toString(); _loading = false; });
    }
  }

  Widget _row(String label, String value, {bool mono = false}) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 5),
        child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Expanded(flex: 4, child: Text(label, style: const TextStyle(fontSize: 12, color: Colors.black54))),
          Expanded(
            flex: 6,
            child: Text(value.isEmpty ? '—' : value,
                textAlign: TextAlign.end,
                style: TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w700,
                    fontFamily: mono ? 'monospace' : null,
                    color: value.isEmpty ? Colors.black26 : Colors.black87)),
          ),
        ]),
      );

  @override
  Widget build(BuildContext context) {
    final e = _e;
    return AppScaffold(
      title: Text(e == null ? tr('ملف الموظف', 'Employee') : _s(e, 'name')),
      actions: [
        if (e != null && ltTransferRoles.contains(context.read<AuthProvider>().role))
          TextButton.icon(onPressed: () => _transfer(e), icon: const Icon(Icons.swap_horiz, color: Colors.white), label: Text(tr('نقل المشروع', 'Transfer'), style: const TextStyle(color: Colors.white))),
      ],
      body: _loading
          ? ListView(padding: const EdgeInsets.all(14), children: const [
              Shimmer(height: 110), SizedBox(height: 10), Shimmer(height: 180), SizedBox(height: 10), Shimmer(height: 160),
            ])
          : _error != null || e == null
              ? ErrorRetry(
                  message: _error ?? '—',
                  onRetry: () { setState(() => _loading = true); _load(); })
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView(padding: const EdgeInsets.all(14), children: [
                    // ── الترويسة ───────────────────────────────────────────
                    AppCard(
                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Text(_s(e, 'name'), style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w800)),
                        const SizedBox(height: 6),
                        Wrap(spacing: 6, runSpacing: 6, children: [
                          Chip2(_s(e, 'workStatusShown'), _statusColor(_s(e, 'workStatusShown'))),
                          Chip2(_s(e, 'staffKind') == 'rep' ? 'مندوب' : 'إداري',
                              _s(e, 'staffKind') == 'rep' ? T.orange : T.navy),
                          if (_s(e, 'vehiclePlate').isNotEmpty) Chip2(_s(e, 'vehiclePlate'), T.navy),
                          // ومن أين جاء خبرُ الحالة — فلا يُسأل «مَن غيّرها؟».
                          if (_s(e, 'statusSource') == 'hr')
                            Chip2(tr('الحالة من الموارد البشرية', 'status from HR'), T.inkFaint),
                          if (e['hrLinked'] == false)
                            Chip2(tr('بلا ملفّ HR — القسم يملك السجل', 'no HR file'), T.warn),
                        ]),
                      ]),
                    ),
                    const SizedBox(height: 10),

                    AppCard(
                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Text(tr('الموظف', 'Employee'), style: const TextStyle(fontWeight: FontWeight.w800)),
                        const Divider(height: 16),
                        _row(tr('رقم الهوية', 'ID number'), _s(e, 'idNumber'), mono: true),
                        _row(tr('الجنسية', 'Nationality'), _s(e, 'nationalityAr')),
                        _row(tr('الجوال', 'Phone'), _s(e, 'phone'), mono: true),
                        _row(tr('تاريخ التعيين', 'Hire date'), _day(e['hireDate']), mono: true),
                        _row(tr('نوع التعاقد', 'Contract'), _s(e, 'contractTypeAr')),
                        // الشركةُ لها أكثرُ من سجلّ، ومن ليس على كفالتنا لا سجلَّ له.
                        _row(tr('رقم السجل (الكفالة)', 'Register'), _s(e, 'registerNumber'), mono: true),
                      ]),
                    ),
                    const SizedBox(height: 10),

                    AppCard(
                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Text(tr('التشغيل', 'Deployment'), style: const TextStyle(fontWeight: FontWeight.w800)),
                        const Divider(height: 16),
                        _row(tr('الوظيفة', 'Job'), _s(e, 'jobTitleAr')),
                        _row(tr('المشروع', 'Project'), _s(e, 'projectAr')),
                        _row(tr('الفرع', 'Branch'), _s(e, 'cityAr')),
                        _row(tr('المشرف', 'Supervisor'), _s(e, 'supervisorName')),
                        _row(tr('نوع المركبة', 'Vehicle type'),
                            _s(e, 'vehicleTypeShown').isNotEmpty ? _s(e, 'vehicleTypeShown') : _s(e, 'vehicleTypeAr')),
                        _row(tr('رقم اللوحة', 'Plate'), _s(e, 'vehiclePlate'), mono: true),
                        _row(tr('الرقم التسلسلي', 'Serial'),
                            _s((e['vehicle'] as Map?)?.cast<String, dynamic>(), 'serialNumber'), mono: true),
                        _row(tr('السكن', 'Housing'),
                            _s((e['housing'] as Map?)?.cast<String, dynamic>(), 'name')),
                        _row(tr('الغرفة', 'Room'), _s(e, 'housingRoom')),
                      ]),
                    ),
                    if (_s(e, 'notesAr').isNotEmpty) ...[
                      const SizedBox(height: 10),
                      AppCard(
                        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          Text(tr('ملاحظات', 'Notes'), style: const TextStyle(fontWeight: FontWeight.w800)),
                          const SizedBox(height: 6),
                          Text(_s(e, 'notesAr'), style: const TextStyle(fontSize: 13, height: 1.5)),
                        ]),
                      ),
                    ],
                    const SizedBox(height: 10),

                    // ── أوامرُ التشغيل: واحدٌ سارٍ والباقي مُغلَق ────────────
                    AppCard(
                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Row(children: [
                          Text(tr('أوامر التشغيل', 'Operating orders'),
                              style: const TextStyle(fontWeight: FontWeight.w800)),
                          const Spacer(),
                          Text('${_orders.length}', style: const TextStyle(color: Colors.black45)),
                        ]),
                        const Divider(height: 16),
                        if (_orders.isEmpty)
                          Text(tr('لا أوامر تشغيل بعد.', 'No operating orders yet.'),
                              style: const TextStyle(fontSize: 12.5, color: Colors.black38))
                        else
                          ..._orders.map((raw) {
                            final o = (raw as Map).cast<String, dynamic>();
                            final active = o['status'] == 'active';
                            return Padding(
                              padding: const EdgeInsets.only(bottom: 8),
                              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                Row(children: [
                                  Text(_s(o, 'orderNumber'),
                                      style: const TextStyle(fontWeight: FontWeight.w700, fontFamily: 'monospace')),
                                  const SizedBox(width: 8),
                                  Chip2(active ? 'سارٍ' : 'مُغلَق', active ? T.success : T.inkFaint),
                                  if (o['authorizationMoved'] == true) ...[
                                    const SizedBox(width: 6),
                                    const Chip2('نُقل التفويض', T.navy),
                                  ],
                                ]),
                                const SizedBox(height: 2),
                                Text(
                                  [
                                    _s(o, 'vehiclePlate'), _s(o, 'projectAr'), _s(o, 'cityAr'),
                                    '${_day(o['startDate'])} → ${o['endDate'] == null ? '—' : _day(o['endDate'])}',
                                  ].where((x) => x.isNotEmpty).join(' · '),
                                  style: const TextStyle(fontSize: 12, color: Colors.black54),
                                ),
                              ]),
                            );
                          }),
                      ]),
                    ),
                    const SizedBox(height: 10),

                    // ── الأوردرات حسب المشروع ─────────────────────────────────
                    // المندوبُ قد يعمل في أكثرَ من مشروعٍ في الشهر، والأوردرُ يبقى على
                    // مشروعه يومَ كُتب — فلا يتحرّك ماضيه إذا نُقل.
                    AppCard(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Text(tr('الأوردرات حسب المشروع', 'Orders by project'), style: const TextStyle(fontWeight: FontWeight.w800)),
                      const SizedBox(height: 6),
                      if (_months.isEmpty) Text(tr('لا توجد أوردرات مسجَّلة لهذا المندوب', 'No orders recorded'), style: const TextStyle(color: T.inkFaint, fontSize: 12.5)),
                      for (final m in _months) ...[
                        Text('${'${m['month']}'.split('-').reversed.join('/')} — ${tr('الإجمالي', 'Total')} ${m['total']}', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13)),
                        for (final p in (m['projects'] as List? ?? const []))
                          Padding(
                            padding: const EdgeInsetsDirectional.only(start: 8, top: 2, bottom: 2),
                            child: Text('${p['project']} · ${tr('من', 'from')} ${'${p['from']}'.substring(8)}/${'${p['from']}'.substring(5, 7)} ${tr('إلى', 'to')} ${'${p['to']}'.substring(8)}/${'${p['to']}'.substring(5, 7)} · ${p['days']} ${tr('يومًا', 'days')} · ${p['total']} ${p['unit'] == 'شحنة' ? tr('شحنة', 'shipments') : tr('أوردر', 'orders')}',
                                style: const TextStyle(fontSize: 12.5, color: T.inkSoft)),
                          ),
                        const SizedBox(height: 6),
                      ],
                    ])),
                    const SizedBox(height: 10),

                    // ── سجلُّ النقل ─────────────────────────────────────────
                    // كلُّ تغييرٍ في مشروعٍ أو فرعٍ أو مشرفٍ أو مركبةٍ أو سكنٍ
                    // أو حالةٍ يُقيَّد بصاحبه ووقته — وهو ما يُقرأ حين يُسأل
                    // «إمتى نقلناه؟».
                    AppCard(
                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Text(tr('سجل الملف', 'File history'), style: const TextStyle(fontWeight: FontWeight.w800)),
                        const Divider(height: 16),
                        Builder(builder: (_) {
                          final h = [...((e['history'] as List?) ?? const [])]
                            ..sort((a, b) => (b['at'] ?? '').toString().compareTo((a['at'] ?? '').toString()));
                          if (h.isEmpty) {
                            return Text(tr('لا قيود بعد.', 'No entries yet.'),
                                style: const TextStyle(fontSize: 12.5, color: Colors.black38));
                          }
                          return Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: h.map((raw) {
                              final x = (raw as Map).cast<String, dynamic>();
                              final from = _s(x, 'fromValue');
                              final to = _s(x, 'toValue');
                              return Padding(
                                padding: const EdgeInsets.only(bottom: 10),
                                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                  Row(children: [
                                    Container(width: 7, height: 7,
                                        decoration: const BoxDecoration(color: T.orange, shape: BoxShape.circle)),
                                    const SizedBox(width: 7),
                                    Text(_kindAr[_s(x, 'kind')] ?? _s(x, 'kind'),
                                        style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700)),
                                  ]),
                                  Padding(
                                    padding: const EdgeInsetsDirectional.only(start: 14, top: 2),
                                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                      if (from.isNotEmpty || to.isNotEmpty)
                                        Text(
                                          from.isNotEmpty && to.isNotEmpty ? '$from ← $to' : (to.isNotEmpty ? to : from),
                                          style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600),
                                        ),
                                      Text(
                                        [_day(x['at']), _s(x, 'byName')].where((s) => s.isNotEmpty && s != '—').join(' · '),
                                        style: const TextStyle(fontSize: 11, color: Colors.black45),
                                      ),
                                      if (_s(x, 'note').isNotEmpty)
                                        Text(_s(x, 'note'),
                                            style: const TextStyle(fontSize: 11, color: Colors.black38)),
                                    ]),
                                  ),
                                ]),
                              );
                            }).toList(),
                          );
                        }),
                      ]),
                    ),
                  ]),
                ),
    );
  }
}

/// مَن يملك «نقل المشروع» — نائبُ مدير القطاع ومديرُ القسم والسوبر أدمن والأدمن (وأهلُ المال).
const ltTransferRoles = ['super_admin', 'admin', 'b2c_manager', 'b2c_deputy', 'cfo', 'accounting_manager', 'accountant'];

/// «نقل المشروع» — من ملفّ المندوب ومن قائمة موظفي النقل الخفيف. يُرجع true إن نُقل.
/// ومن يومه تُكتب أوردراتُه على مشروعه الجديد، ويظهر عند مديري ذلك المشروع في الحال.
Future<bool> transferLtProject(BuildContext context, Map<String, dynamic> e) async {
  String s(String k) => (e[k] ?? '').toString();
  final projects = (await loadLookupNamesHr('lt_project')).where((p) => p != s('projectAr')).toList();
  if (!context.mounted) return false;
  final to = await pickFromList(context, title: tr('نقل ${s('name')} إلى مشروع', 'Move to project'), options: projects);
  if (to == null || to.isEmpty || !context.mounted) return false;
  final note = TextEditingController();
  final ok = await showDialog<bool>(
    context: context,
    builder: (c) => AlertDialog(
      title: Text(tr('نقل المشروع', 'Transfer project')),
      content: Column(mainAxisSize: MainAxisSize.min, children: [
        Text(tr('«${s('projectAr')}» ← «$to». أوردراتُه من اليوم تُكتب على المشروع الجديد.', 'Move to $to?')),
        TextField(controller: note, decoration: InputDecoration(labelText: tr('السبب (يُكتب في سجلّه)', 'Reason'))),
      ]),
      actions: [
        TextButton(onPressed: () => Navigator.pop(c, false), child: Text(tr('إلغاء', 'Cancel'))),
        FilledButton(onPressed: () => Navigator.pop(c, true), child: Text(tr('نقل', 'Transfer'))),
      ],
    ),
  );
  if (ok != true || !context.mounted) return false;
  try {
    await Api.instance.post('/api/light-transport/employees/${s('_id')}/transfer-project', {'projectAr': to, 'note': note.text.trim()});
    if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(tr('نُقل إلى $to', 'Moved to $to'))));
    return true;
  } catch (err) {
    if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(err.toString())));
    return false;
  }
}
