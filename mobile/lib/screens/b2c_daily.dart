import 'dart:async';
import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';

/// مدخلات الأوردرات — نظيرُ /system/b2c/daily-entry في الموقع (صاحبُ الشركة، ٢٠٢٦/١٠/١٩).
///
/// الأوردراتُ تُكتب على النظام لا في شيتات جوجل. لكلّ مندوبٍ سطرٌ: اسمُه ورقمُ إقامته
/// ومشروعُه ومشرفُه، وخانةُ اليوم يُكتب فيها الرقم. وفوقها كروتُ الشيت: عددُ المناديب
/// بالجهة، وملخّصُ التحقيق حسب المشرف والمشروع. ومديرُ المشروع والمشرفُ يرى مشاريعَه
/// وحدَها (يحسمه الخادم)، وما يُكتب يصل تحليلَ الأوردرات ولوحةَ B2C في اللحظة.
class B2cDailyEntryScreen extends StatefulWidget {
  const B2cDailyEntryScreen({super.key});
  @override
  State<B2cDailyEntryScreen> createState() => _B2cDailyEntryScreenState();
}

class _B2cDailyEntryScreenState extends State<B2cDailyEntryScreen> {
  Map<String, dynamic>? _d;
  String? _error;
  String _date = '';
  String _q = '';
  String _project = '';
  String _sup = '';
  String _kind = '';
  String _eval = '';
  bool _missing = false;
  final Map<String, TextEditingController> _ctrls = {};
  final Set<String> _dirty = {};
  final Map<String, String> _state = {}; // saving | saved | error
  Timer? _debounce;
  late final void Function() _onLive;

  @override
  void initState() {
    super.initState();
    _load();
    _onLive = () { _debounce?.cancel(); _debounce = Timer(const Duration(milliseconds: 700), _load); };
    for (final e in ['b2c:order:upserted', 'lt:updated', 'b2c:entry:scope']) { Live.instance.on(e, _onLive); }
  }

  @override
  void dispose() {
    for (final e in ['b2c:order:upserted', 'lt:updated', 'b2c:entry:scope']) { Live.instance.off(e, _onLive); }
    _debounce?.cancel();
    for (final c in _ctrls.values) { c.dispose(); }
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final d = Map<String, dynamic>.from(await Api.instance.get('/api/b2c/entry${_date.isEmpty ? '' : '?date=$_date'}') as Map);
      if (!mounted) return;
      setState(() {
        _d = d; _error = null; _date = '${d['date']}';
        for (final r in List<Map<String, dynamic>>.from(d['rows'] ?? [])) {
          final id = '${r['lt']}';
          final c = _ctrls.putIfAbsent(id, () => TextEditingController());
          if (!_dirty.contains(id)) c.text = r['orders'] == null ? '' : '${r['orders']}';
        }
      });
    } catch (e) {
      if (mounted) setState(() => _error = e.toString());
    }
  }

  Future<void> _save(Map<String, dynamic> r) async {
    final id = '${r['lt']}';
    if (!_dirty.contains(id)) return;
    final v = _ctrls[id]!.text.trim();
    final prev = r['orders'] == null ? '' : '${r['orders']}';
    if (v == prev) { _dirty.remove(id); return; }
    setState(() => _state[id] = 'saving');
    try {
      await Api.instance.put('/api/b2c/entry', {'lt': id, 'dateKey': _date, 'orders': v.isEmpty ? null : int.parse(v)});
      _dirty.remove(id);
      if (mounted) setState(() => _state[id] = 'saved');
    } catch (e) {
      if (!mounted) return;
      setState(() => _state[id] = 'error');
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    }
  }

  String _fold(String s) => s.replaceAll(RegExp('[أإآ]'), 'ا').replaceAll('ى', 'ي').replaceAll('ة', 'ه').toLowerCase();
  String _shift(int days) {
    final d = DateTime.parse(_date).add(Duration(days: days));
    return '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';
  }

  Color _evalColor(String e) => e == 'حقق' ? T.success : e == 'قريب' ? T.warn : e == 'بعيد' ? T.danger : T.inkFaint;

  Widget _drop(String label, String value, List<String> opts, ValueChanged<String> on) => Padding(
        padding: const EdgeInsetsDirectional.only(end: 6),
        child: DropdownButton<String>(
          value: value, isDense: true, underline: const SizedBox(),
          items: [DropdownMenuItem(value: '', child: Text(label)), ...opts.map((o) => DropdownMenuItem(value: o, child: Text(o)))],
          onChanged: (v) => setState(() => on(v ?? '')),
        ),
      );

  @override
  Widget build(BuildContext context) {
    final d = _d;
    if (d == null) {
      return AppScaffold(title: Text(tr('مدخلات الأوردرات', 'Orders entry')),
          body: _error != null ? ErrorRetry(message: _error!, onRetry: _load) : const Center(child: CircularProgressIndicator()));
    }
    final all = List<Map<String, dynamic>>.from(d['rows'] ?? []);
    final cards = Map<String, dynamic>.from(d['cards'] ?? {});
    final reps = Map<String, dynamic>.from(cards['reps'] ?? {});
    final summary = List<Map<String, dynamic>>.from(d['summary'] ?? []);
    final tot = Map<String, dynamic>.from(d['summaryTotal'] ?? {});
    final needle = _fold(_q.trim());
    final rows = all.where((r) {
      final id = '${r['lt']}';
      return (needle.isEmpty || _fold('${r['name']} ${r['idNumber']} ${r['projectAr']} ${r['supervisorName']}').contains(needle))
          && (_project.isEmpty || r['projectAr'] == _project) && (_sup.isEmpty || r['supervisorName'] == _sup)
          && (_kind.isEmpty || r['kind'] == _kind) && (_eval.isEmpty || r['evaluation'] == _eval)
          && (!_missing || (_ctrls[id]?.text ?? '').isEmpty);
    }).toList();
    final projects = {for (final r in all) '${r['projectAr']}'}.toList();
    final sups = {for (final r in all) if ('${r['supervisorName'] ?? ''}'.isNotEmpty) '${r['supervisorName']}'}.toList()..sort();
    final scope = d['scope'];
    final today = '${d['today']}';

    return AppScaffold(
      title: Text(tr('مدخلات الأوردرات', 'Orders entry')),
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(padding: const EdgeInsets.all(12), children: [
          if (scope is List) Padding(
            padding: const EdgeInsets.only(bottom: 6),
            child: Text(tr('مشاريعك: ${scope.isEmpty ? 'لم يُسنَد لك مشروع بعد' : scope.join('، ')}', 'Your projects: ${scope.join(', ')}'),
                style: const TextStyle(fontSize: 12, color: T.inkFaint)),
          ),
          // ── اليوم ──
          AppCard(child: Row(children: [
            IconButton(icon: const Icon(Icons.chevron_right), onPressed: () { setState(() => _date = _shift(-1)); _load(); }),
            Expanded(child: InkWell(
              onTap: () async {
                final p = await showDatePicker(context: context, initialDate: DateTime.parse(_date), firstDate: DateTime(2025), lastDate: DateTime.parse(today));
                if (p != null) { setState(() => _date = '${p.year}-${p.month.toString().padLeft(2, '0')}-${p.day.toString().padLeft(2, '0')}'); _load(); }
              },
              child: Center(child: Text(_date.split('-').reversed.join('/'), style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w800))),
            )),
            IconButton(icon: const Icon(Icons.chevron_left), onPressed: _date.compareTo(today) >= 0 ? null : () { setState(() => _date = _shift(1)); _load(); }),
          ])),
          const SizedBox(height: 8),
          // ── الكروت ──
          Wrap(spacing: 6, runSpacing: 6, children: [
            for (final c in [
              (tr('إجمالي المناديب', 'Reps'), '${reps['total'] ?? 0}', ''),
              ('كفالة', '${reps['كفالة'] ?? 0}', 'كفالة'),
              ('فري لانسر', '${reps['فري لانسر'] ?? 0}', 'فري لانسر'),
              ('يوزرات', '${reps['يوزرات'] ?? 0}', 'يوزرات'),
            ])
              ActionChip(
                onPressed: () => setState(() => _kind = _kind == c.$3 ? '' : c.$3),
                backgroundColor: _kind == c.$3 && c.$3.isNotEmpty ? T.orange : Colors.white,
                label: Text('${c.$1}: ${c.$2}', style: TextStyle(fontWeight: FontWeight.w800, color: _kind == c.$3 && c.$3.isNotEmpty ? Colors.white : T.ink)),
              ),
          ]),
          const SizedBox(height: 6),
          Row(children: [
            Expanded(child: StatCard(label: tr('أوردرات اليوم', 'Today'), value: cards['dayTotal'] ?? 0, color: T.orange, icon: Icons.local_mall_outlined)),
            const SizedBox(width: 6),
            Expanded(child: StatCard(label: tr('مُدخَل لهم', 'Entered'), value: cards['dayEntered'] ?? 0, color: T.navy, icon: Icons.edit_note)),
            const SizedBox(width: 6),
            Expanded(child: StatCard(label: tr('إجمالي الشهر', 'Month'), value: cards['periodTotal'] ?? 0, color: T.success, icon: Icons.summarize_outlined)),
          ]),
          const SizedBox(height: 8),
          // ── ملخّص التحقيق ──
          AppCard(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(tr('ملخص التحقيق حسب المشرف والمشروع', 'Achievement by supervisor & project'), style: const TextStyle(fontWeight: FontWeight.w800)),
            const SizedBox(height: 6),
            for (final s in summary)
              InkWell(
                onTap: () => setState(() { _sup = s['supervisor'] == '—' ? '' : '${s['supervisor']}'; _project = '${s['project']}'; }),
                child: Padding(
                  padding: const EdgeInsets.symmetric(vertical: 4),
                  child: Row(children: [
                    Expanded(child: Text('${s['supervisor']} · ${s['project']}', style: const TextStyle(fontSize: 12.5))),
                    Text('${s['reps']}  ', style: const TextStyle(fontSize: 12, color: T.inkFaint)),
                    Text('${s['achieved']}', style: const TextStyle(fontSize: 12.5, color: T.success, fontWeight: FontWeight.w800)),
                    const Text(' / '),
                    Text('${s['near']}', style: const TextStyle(fontSize: 12.5, color: T.warn, fontWeight: FontWeight.w800)),
                    const Text(' / '),
                    Text('${s['far']}', style: const TextStyle(fontSize: 12.5, color: T.danger, fontWeight: FontWeight.w800)),
                    SizedBox(width: 46, child: Text(s['rate'] == null ? '—' : '${((s['rate'] as num) * 100).round()}%', textAlign: TextAlign.end, style: const TextStyle(fontWeight: FontWeight.w800))),
                  ]),
                ),
              ),
            const Divider(),
            Text(tr('الإجمالي: حقق ${tot['achieved']} · قريب ${tot['near']} · بعيد ${tot['far']} · ${tot['rate'] == null ? '—' : '${((tot['rate'] as num) * 100).round()}%'}', 'Total'),
                style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 12.5)),
          ])),
          const SizedBox(height: 8),
          // ── البحث والفلاتر ──
          TextField(
            onChanged: (v) => setState(() => _q = v),
            decoration: InputDecoration(isDense: true, prefixIcon: const Icon(Icons.search), hintText: tr('ابحث: اسم، رقم إقامة، مشروع، مشرف…', 'Search…')),
          ),
          SingleChildScrollView(scrollDirection: Axis.horizontal, child: Row(children: [
            _drop(tr('كل المشاريع', 'All projects'), _project, projects, (v) => _project = v),
            _drop(tr('كل المشرفين', 'All supervisors'), _sup, sups, (v) => _sup = v),
            _drop(tr('كل التقييمات', 'All evaluations'), _eval, const ['حقق', 'قريب', 'بعيد', 'شحنات', 'لا طلبات'], (v) => _eval = v),
            FilterChip(label: Text(tr('لم يُدخَل', 'Not entered')), selected: _missing, onSelected: (v) => setState(() => _missing = v)),
          ])),
          Text(tr('${rows.length} مندوب', '${rows.length} reps'), style: const TextStyle(fontSize: 12, color: T.inkFaint)),
          const SizedBox(height: 6),
          // ── المناديب: كلُّ سطرٍ بخانته ──
          for (final r in rows)
            Padding(
              padding: const EdgeInsets.only(bottom: 6),
              child: AppCard(child: Row(children: [
                Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text('${r['name']}', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13.5)),
                  Text([r['idNumber'], r['projectAr'], r['supervisorName'], r['kind']].where((x) => '${x ?? ''}'.isNotEmpty).join(' · '),
                      style: const TextStyle(fontSize: 11, color: T.inkFaint)),
                  Text(tr('الشهر ${r['total']} · هدفه ${r['target'] ?? '—'} · ${r['pct'] == null ? '—' : '${((r['pct'] as num) * 100).round()}%'}', 'Month ${r['total']}'),
                      style: TextStyle(fontSize: 11.5, fontWeight: FontWeight.w700, color: _evalColor('${r['evaluation']}'))),
                ])),
                SizedBox(
                  width: 76,
                  child: TextField(
                    controller: _ctrls['${r['lt']}'],
                    enabled: r['ended'] != true,
                    keyboardType: TextInputType.number,
                    textAlign: TextAlign.center,
                    textInputAction: TextInputAction.next,
                    style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w900),
                    decoration: InputDecoration(isDense: true, hintText: r['unit'] == 'شحنة' ? tr('شحنات', 'Ship.') : '—',
                        suffixIcon: _state['${r['lt']}'] == 'saving' ? const Padding(padding: EdgeInsets.all(10), child: SizedBox(width: 12, height: 12, child: CircularProgressIndicator(strokeWidth: 2)))
                            : _state['${r['lt']}'] == 'saved' ? const Icon(Icons.check, size: 16, color: T.success)
                            : _state['${r['lt']}'] == 'error' ? const Icon(Icons.error_outline, size: 16, color: T.danger) : null),
                    onChanged: (v) { _dirty.add('${r['lt']}'); setState(() => _state.remove('${r['lt']}')); },
                    onEditingComplete: () { _save(r); FocusScope.of(context).nextFocus(); },
                    onTapOutside: (_) => _save(r),
                  ),
                ),
              ])),
            ),
          if (rows.isEmpty) EmptyState(icon: Icons.inbox_outlined, title: scope is List && scope.isEmpty ? tr('لم يُسنَد لك مشروع بعد', 'No project assigned yet') : tr('لا نتائج', 'Nothing matches')),
        ]),
      ),
    );
  }
}
