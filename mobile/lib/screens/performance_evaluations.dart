import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';

/// تقييم الأداء — قائمة التقييمات، وتقييم موظف عبر قالب معاييره الموزونة
/// (كل معيار من ٥) مع حساب النسبة والفئة مباشرة — /api/performance.

const _bands = {
  'excellent': ('ممتاز', 'Excellent', T.success),
  'very_good': ('جيد جدًا', 'Very good', T.info),
  'good': ('جيد', 'Good', T.warn),
  'not_eligible': ('غير مؤهّل', 'Not eligible', T.danger),
};

List<Map<String, dynamic>> _l(dynamic v) =>
    v is List ? List<Map<String, dynamic>>.from(v.whereType<Map>().map((e) => Map<String, dynamic>.from(e))) : const [];

// ── قائمة التقييمات ─────────────────────────────────────────────────────────
class EvaluationsScreen extends StatefulWidget {
  const EvaluationsScreen({super.key});
  @override
  State<EvaluationsScreen> createState() => _EvaluationsScreenState();
}

class _EvaluationsScreenState extends State<EvaluationsScreen> {
  List<Map<String, dynamic>> _rows = [];
  List<Map<String, dynamic>> _team = [];
  bool _loading = true;
  String? _error;
  String _status = '';
  late final void Function() _onLive;

  @override
  void initState() {
    super.initState();
    _load();
    _onLive = () => _load();
    Live.instance.on('performance:updated', _onLive);
  }

  @override
  void dispose() {
    Live.instance.off('performance:updated', _onLive);
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final qs = _status.isEmpty ? '' : '?status=$_status';
      final results = await Future.wait([
        Api.instance.get('/api/performance/evaluations$qs'),
        Api.instance.get('/api/performance/team').catchError((_) => <String, dynamic>{}),
      ]);
      if (!mounted) return;
      setState(() {
        _rows = _l(results[0]['evaluations']);
        _team = _l(results[1]['members']);
        _loading = false;
        _error = null;
      });
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  Future<void> _pickToEvaluate() async {
    final emp = await showModalBottomSheet<Map<String, dynamic>>(
      context: context,
      isScrollControlled: true,
      builder: (c) {
        String q = '';
        return StatefulBuilder(builder: (c, setS) {
          String fold(String s) => s.replaceAll(RegExp('[أإآ]'), 'ا').replaceAll('ى', 'ي').replaceAll('ة', 'ه').toLowerCase();
          final list = _team.where((m) {
            final e = m['employee'] as Map<String, dynamic>? ?? m;
            final name = (e['arabicName'] ?? '${e['firstName'] ?? ''} ${e['lastName'] ?? ''}').toString();
            return q.isEmpty || fold(name).contains(fold(q));
          }).toList();
          return SafeArea(
            child: Padding(
              padding: EdgeInsets.only(bottom: MediaQuery.of(c).viewInsets.bottom),
              child: SizedBox(
                height: MediaQuery.of(c).size.height * 0.7,
                child: Column(children: [
                  Padding(
                    padding: const EdgeInsets.all(14),
                    child: TextField(autofocus: true, onChanged: (v) => setS(() => q = v),
                        decoration: InputDecoration(hintText: tr('اختر موظفًا للتقييم…', 'Choose employee…'), prefixIcon: const Icon(Icons.search))),
                  ),
                  Expanded(
                    child: list.isEmpty
                        ? EmptyState(icon: Icons.groups_outlined, title: tr('لا يوجد أعضاء فريق', 'No team members'))
                        : ListView.builder(
                            itemCount: list.length,
                            itemBuilder: (c, i) {
                              final e = list[i]['employee'] as Map<String, dynamic>? ?? list[i];
                              final name = (e['arabicName'] ?? '${e['firstName'] ?? ''} ${e['lastName'] ?? ''}').toString().trim();
                              return ListTile(
                                title: Text(name, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 14)),
                                subtitle: Text((e['jobTitle'] ?? '').toString(), style: const TextStyle(fontSize: 12)),
                                onTap: () => Navigator.pop(c, {'_id': (e['_id'] ?? '').toString(), 'name': name}),
                              );
                            },
                          ),
                  ),
                ]),
              ),
            ),
          );
        });
      },
    );
    if (emp == null || !mounted) return;
    await Navigator.push(context, MaterialPageRoute(builder: (_) => EvaluateEmployeeScreen(employeeId: emp['_id'], name: emp['name'])));
    _load();
  }

  @override
  Widget build(BuildContext context) {
    return AppScaffold(
      title: Text(tr('تقييم الأداء', 'Performance Evaluations')),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: _pickToEvaluate,
        icon: const Icon(Icons.rate_review_outlined),
        label: Text(tr('تقييم موظف', 'Evaluate')),
      ),
      body: _loading
          ? ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(height: 48), SizedBox(height: 10), Shimmer(), SizedBox(height: 10), Shimmer()])
          : _error != null
              ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
              : Column(children: [
                  Padding(
                    padding: const EdgeInsets.fromLTRB(14, 10, 14, 4),
                    child: Row(children: [
                      for (final e in [('', tr('الكل', 'All')), ('draft', tr('مسودة', 'Draft')), ('submitted', tr('مُعتمدة', 'Submitted'))])
                        Padding(
                          padding: const EdgeInsets.only(left: 6),
                          child: FilterChip(
                            selected: _status == e.$1,
                            onSelected: (_) { setState(() { _status = e.$1; _loading = true; }); _load(); },
                            label: Text(e.$2),
                            labelStyle: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: _status == e.$1 ? Colors.white : T.navy),
                            selectedColor: T.navy,
                            backgroundColor: T.navy.withValues(alpha: 0.08),
                            checkmarkColor: Colors.white,
                            side: BorderSide.none,
                            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
                          ),
                        ),
                    ]),
                  ),
                  Expanded(
                    child: RefreshIndicator(
                      onRefresh: _load,
                      child: _rows.isEmpty
                          ? ListView(children: [const SizedBox(height: 80), EmptyState(icon: Icons.assessment_outlined, title: tr('لا توجد تقييمات', 'No evaluations'))])
                          : ListView.separated(
                              padding: const EdgeInsets.all(14),
                              itemCount: _rows.length,
                              separatorBuilder: (_, __) => const SizedBox(height: 8),
                              itemBuilder: (c, i) {
                                final ev = _rows[i];
                                final band = _bands[ev['band']] ?? ('—', '—', T.inkFaint);
                                final pct = ev['percentage'];
                                return FadeSlideIn(
                                  delayMs: (i * 12).clamp(0, 120),
                                  child: Pressable(
                                    onTap: () async {
                                      await Navigator.push(context, MaterialPageRoute(builder: (_) => EvaluateEmployeeScreen(
                                          employeeId: (ev['employee'] ?? '').toString(), name: (ev['employeeName'] ?? '').toString(), periodKey: (ev['periodKey'] ?? '').toString())));
                                      _load();
                                    },
                                    child: AppCard(
                                      topAccent: band.$3,
                                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                        Row(children: [
                                          Expanded(child: Text((ev['employeeName'] ?? '').toString(), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13.5))),
                                          if (pct != null) Chip2('${(pct as num).round()}%', band.$3),
                                        ]),
                                        const SizedBox(height: 5),
                                        Wrap(spacing: 6, runSpacing: 6, children: [
                                          if ((ev['periodKey'] ?? '').toString().isNotEmpty) Chip2(ev['periodKey'].toString(), T.navy),
                                          if ((ev['department'] ?? '').toString().isNotEmpty) Chip2(ev['department'].toString(), T.violet),
                                          Chip2(ev['status'] == 'submitted' ? tr('مُعتمدة', 'Submitted') : tr('مسودة', 'Draft'), ev['status'] == 'submitted' ? T.success : T.warn),
                                          if (ev['band'] != null) Chip2(tr(band.$1, band.$2), band.$3),
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

// ── نموذج تقييم موظف ────────────────────────────────────────────────────────
class EvaluateEmployeeScreen extends StatefulWidget {
  final String employeeId;
  final String name;
  final String? periodKey;
  const EvaluateEmployeeScreen({super.key, required this.employeeId, required this.name, this.periodKey});
  @override
  State<EvaluateEmployeeScreen> createState() => _EvaluateEmployeeScreenState();
}

class _EvaluateEmployeeScreenState extends State<EvaluateEmployeeScreen> {
  Map<String, dynamic>? _form;
  bool _loading = true;
  String? _error;
  bool _saving = false;
  final Map<String, int> _scores = {};
  final Map<String, TextEditingController> _notes = {};

  @override
  void initState() { super.initState(); _load(); }

  Future<void> _load() async {
    try {
      final qs = widget.periodKey != null && widget.periodKey!.isNotEmpty ? '?period=${widget.periodKey}' : '';
      final d = await Api.instance.get('/api/performance/evaluations/form/${widget.employeeId}$qs');
      if (!mounted) return;
      final existing = d['evaluation'] is Map ? Map<String, dynamic>.from(d['evaluation']) : null;
      _scores.clear();
      if (existing != null) {
        for (final a in _l(existing['answers'])) {
          final k = (a['criterionKey'] ?? '').toString();
          if (a['score'] != null) _scores[k] = (a['score'] as num).toInt();
          _notes[k] = TextEditingController(text: (a['note'] ?? '').toString());
        }
      }
      setState(() { _form = Map<String, dynamic>.from(d); _loading = false; _error = null; });
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  List<Map<String, dynamic>> get _criteria {
    final t = _form?['template'];
    return t is Map ? _l(t['criteria']) : const [];
  }

  ({double weighted, double pct, int answered}) _totals() {
    double sumW = 0, weightedScore = 0;
    int answered = 0;
    for (final c in _criteria) {
      final w = (c['weight'] as num?)?.toDouble() ?? 0;
      sumW += w;
      final k = (c['key'] ?? '').toString();
      if (_scores[k] != null) {
        answered++;
        weightedScore += (_scores[k]! / 5.0) * w;
      }
    }
    final pct = sumW > 0 ? (weightedScore / sumW) * 100 : 0.0;
    return (weighted: weightedScore, pct: pct.toDouble(), answered: answered);
  }

  Future<void> _save({required bool submit}) async {
    final t = _form?['template'];
    if (t is! Map || (t['_id'] ?? '').toString().isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(tr('لا يوجد قالب تقييم لهذا الموظف', 'No evaluation template for this employee'))));
      return;
    }
    if (submit && _totals().answered < _criteria.length) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(tr('أكمل تقييم كل المعايير قبل الاعتماد', 'Score every criterion before submitting'))));
      return;
    }
    setState(() => _saving = true);
    try {
      await Api.instance.post('/api/performance/evaluations', {
        'employee': widget.employeeId,
        'template': t['_id'],
        'periodKey': _form?['periodKey'],
        'status': submit ? 'submitted' : 'draft',
        'answers': _criteria.map((c) {
          final k = (c['key'] ?? '').toString();
          return {'criterionKey': k, if (_scores[k] != null) 'score': _scores[k], 'note': _notes[k]?.text.trim() ?? ''};
        }).toList(),
      });
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(submit ? tr('اعتُمد التقييم ✔', 'Submitted ✔') : tr('حُفظت المسودة', 'Draft saved'))));
        Navigator.pop(context);
      }
    } catch (e) {
      if (mounted) { setState(() => _saving = false); ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString()))); }
    }
  }

  @override
  Widget build(BuildContext context) {
    final template = _form?['template'];
    final locked = _form?['permissions'] is Map && _form!['permissions']['locked'] == true;
    final totals = _loading ? (weighted: 0.0, pct: 0.0, answered: 0) : _totals();
    final band = totals.pct >= 90 ? _bands['excellent']! : totals.pct >= 80 ? _bands['very_good']! : totals.pct >= 70 ? _bands['good']! : _bands['not_eligible']!;

    return AppScaffold(
      title: Text('${tr('تقييم', 'Evaluate')} ${widget.name}'),
      body: _loading
          ? ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(height: 90), SizedBox(height: 10), Shimmer(height: 120), SizedBox(height: 10), Shimmer(height: 120)])
          : _error != null
              ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
              : template is! Map || _criteria.isEmpty
                  ? EmptyState(icon: Icons.assignment_late_outlined, title: tr('لا يوجد قالب تقييم لهذا الموظف/القسم', 'No template for this employee'))
                  : Column(children: [
                      // live score header
                      Container(
                        width: double.infinity,
                        margin: const EdgeInsets.fromLTRB(14, 12, 14, 0),
                        padding: const EdgeInsets.all(14),
                        decoration: BoxDecoration(
                          borderRadius: BorderRadius.circular(16),
                          gradient: LinearGradient(colors: [band.$3, band.$3.withValues(alpha: 0.7)]),
                        ),
                        child: Row(children: [
                          Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                            Text(tr('النتيجة', 'Score'), style: const TextStyle(color: Colors.white70, fontSize: 12, fontWeight: FontWeight.w700)),
                            Text('${totals.pct.round()}%', style: const TextStyle(color: Colors.white, fontSize: 26, fontWeight: FontWeight.w900)),
                            Text(tr(band.$1, band.$2), style: const TextStyle(color: Colors.white, fontSize: 12.5, fontWeight: FontWeight.w700)),
                          ]),
                          const Spacer(),
                          Text('${totals.answered}/${_criteria.length}\n${tr('معيار', 'criteria')}', textAlign: TextAlign.center, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w800, fontSize: 13)),
                        ]),
                      ),
                      Expanded(
                        child: ListView(padding: const EdgeInsets.all(14), children: [
                          ..._criteria.map((c) {
                            final k = (c['key'] ?? '').toString();
                            final w = (c['weight'] as num?)?.toDouble() ?? 0;
                            return Padding(
                              padding: const EdgeInsets.only(bottom: 10),
                              child: AppCard(
                                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                  Row(children: [
                                    Expanded(child: Text(tr((c['titleAr'] ?? c['title'] ?? '').toString(), (c['title'] ?? c['titleAr'] ?? '').toString()), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13.5))),
                                    Chip2('${w.round()}%', T.navy),
                                  ]),
                                  if ((c['descriptionAr'] ?? c['description'] ?? '').toString().isNotEmpty) ...[
                                    const SizedBox(height: 3),
                                    Text(tr((c['descriptionAr'] ?? c['description'] ?? '').toString(), (c['description'] ?? '').toString()), style: const TextStyle(fontSize: 11.5, color: T.inkSoft)),
                                  ],
                                  const SizedBox(height: 8),
                                  Row(children: List.generate(5, (n) {
                                    final score = n + 1;
                                    final selected = _scores[k] == score;
                                    return Expanded(
                                      child: Padding(
                                        padding: const EdgeInsets.symmetric(horizontal: 3),
                                        child: InkWell(
                                          onTap: locked ? null : () => setState(() => _scores[k] = score),
                                          borderRadius: BorderRadius.circular(10),
                                          child: Container(
                                            height: 40,
                                            decoration: BoxDecoration(
                                              color: selected ? T.navy : T.navy.withValues(alpha: 0.06),
                                              borderRadius: BorderRadius.circular(10),
                                            ),
                                            child: Center(child: Text('$score', style: TextStyle(fontWeight: FontWeight.w900, fontSize: 15, color: selected ? Colors.white : T.navy))),
                                          ),
                                        ),
                                      ),
                                    );
                                  })),
                                ]),
                              ),
                            );
                          }),
                          const SizedBox(height: 4),
                        ]),
                      ),
                      if (!locked)
                        SafeArea(
                          top: false,
                          child: Padding(
                            padding: const EdgeInsets.fromLTRB(14, 6, 14, 10),
                            child: Row(children: [
                              Expanded(child: OutlinedButton(onPressed: _saving ? null : () => _save(submit: false), child: Text(tr('حفظ مسودة', 'Save draft')))),
                              const SizedBox(width: 10),
                              Expanded(
                                child: FilledButton(
                                  onPressed: _saving ? null : () => _save(submit: true),
                                  child: _saving ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white)) : Text(tr('اعتماد', 'Submit')),
                                ),
                              ),
                            ]),
                          ),
                        ),
                    ]),
    );
  }
}
