import 'dart:async';
import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';

/// مدخلات الأوردرات — للإدخال وحدَه، نظيرُ /system/b2c/daily-entry (صاحبُ الشركة، ٢٠٢٦/١٠/١٩).
///
/// يكتب مديرُ المشروع هنا أوردراتِ كلّ مندوبٍ بدل الإكسيل: الاسمُ ورقمُ الإقامة والمشروعُ
/// وخانةُ اليوم لا غير. والإجماليّاتُ والتقييمُ مكانُها اللوحةُ وتحليلُ الأوردرات. ولا يرى
/// إلّا مناديبَ المشاريع المُسندة إليه (يحسمه الخادم)، ومَن نُقل إلى مشروعه يظهر في الحال.
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

  /// أمازون حضورٌ لا أوردرات: الأصلُ «حضر»، والنقرُ يقلبه — تحديثٌ متفائلٌ يُرَدّ عند الخطأ.
  Future<void> _toggleAttendance(Map<String, dynamic> r) async {
    final id = '${r['lt']}';
    if (_state[id] == 'saving') return;
    final prev = r['present'] != false;
    setState(() { r['present'] = !prev; _state[id] = 'saving'; });
    try {
      await Api.instance.put('/api/b2c/attendance', {'lt': id, 'dateKey': _date, 'present': !prev});
      if (mounted) setState(() => _state[id] = 'saved');
    } catch (e) {
      if (!mounted) return;
      setState(() { r['present'] = prev; _state[id] = 'error'; });
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    }
  }

  String _fold(String s) => s.replaceAll(RegExp('[أإآ]'), 'ا').replaceAll('ى', 'ي').replaceAll('ة', 'ه').toLowerCase();
  String _shift(int days) {
    final d = DateTime.parse(_date).add(Duration(days: days));
    return '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';
  }

  @override
  Widget build(BuildContext context) {
    final d = _d;
    if (d == null) {
      return AppScaffold(title: Text(tr('مدخلات الأوردرات', 'Orders entry')),
          body: _error != null ? ErrorRetry(message: _error!, onRetry: _load) : const Center(child: CircularProgressIndicator()));
    }
    final all = List<Map<String, dynamic>>.from(d['rows'] ?? []);
    final needle = _fold(_q.trim());
    final rows = all.where((r) => (needle.isEmpty || _fold('${r['name']} ${r['idNumber']} ${r['projectAr']}').contains(needle))
        && (_project.isEmpty || r['projectAr'] == _project)).toList();
    final projects = {for (final r in all) '${r['projectAr']}'}.toList();
    final scope = d['scope'];
    final today = '${d['today']}';

    return AppScaffold(
      title: Text(tr('مدخلات الأوردرات', 'Orders entry')),
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(padding: const EdgeInsets.all(12), children: [
          if (scope is List) Padding(
            padding: const EdgeInsets.only(bottom: 6),
            child: Text(tr('المشاريع المُسندة إليك: ${scope.isEmpty ? 'لم يُسنَد إليك مشروعٌ بعد' : scope.join('، ')}', 'Your projects: ${scope.join(', ')}'),
                style: const TextStyle(fontSize: 12, color: T.inkFaint)),
          ),
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
          TextField(
            onChanged: (v) => setState(() => _q = v),
            decoration: InputDecoration(isDense: true, prefixIcon: const Icon(Icons.search), hintText: tr('ابحث بالاسم أو رقم الإقامة أو المشروع', 'Search…')),
          ),
          if (projects.length > 1)
            Padding(
              padding: const EdgeInsets.only(top: 6),
              child: Wrap(spacing: 6, children: [
                for (final p in ['', ...projects])
                  ChoiceChip(label: Text(p.isEmpty ? tr('جميع المشاريع', 'All') : p), selected: _project == p, onSelected: (_) => setState(() => _project = p)),
              ]),
            ),
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 6),
            child: Text(tr('${rows.length} مندوبًا', '${rows.length} reps'), style: const TextStyle(fontSize: 12, color: T.inkFaint)),
          ),
          for (final r in rows)
            Padding(
              padding: const EdgeInsets.only(bottom: 6),
              child: AppCard(child: Row(children: [
                Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text('${r['name']}', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14)),
                  Text([r['idNumber'], r['projectAr'], if ('${r['status']}' != 'يعمل') r['status']].where((x) => '${x ?? ''}'.isNotEmpty).join(' · '),
                      style: const TextStyle(fontSize: 11.5, color: T.inkFaint)),
                ])),
                if (r['mode'] == 'attendance') AttendanceToggle(
                  present: r['present'] != false,
                  busy: _state['${r['lt']}'] == 'saving',
                  enabled: r['ended'] != true,
                  onTap: () => _toggleAttendance(r),
                ) else SizedBox(
                  width: 84,
                  child: TextField(
                    controller: _ctrls['${r['lt']}'],
                    enabled: r['ended'] != true,
                    keyboardType: TextInputType.number,
                    textAlign: TextAlign.center,
                    textInputAction: TextInputAction.next,
                    style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w900),
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
          if (rows.isEmpty) EmptyState(icon: Icons.inbox_outlined, title: scope is List && scope.isEmpty ? tr('لم يُسنَد إليك مشروعٌ بعد', 'No project assigned yet') : tr('لا توجد نتائج مطابقة', 'No matches')),
        ]),
      ),
    );
  }
}

/// زرُّ الحضور: ✓ حضر / ✗ لم يحضر — يُستعمَل في المدخلات وفي متابعة أمازون.
class AttendanceToggle extends StatelessWidget {
  final bool present;
  final bool busy;
  final bool enabled;
  final VoidCallback onTap;
  const AttendanceToggle({super.key, required this.present, required this.onTap, this.busy = false, this.enabled = true});

  @override
  Widget build(BuildContext context) {
    final c = present ? T.success : T.danger;
    return InkWell(
      borderRadius: BorderRadius.circular(20),
      onTap: enabled && !busy ? onTap : null,
      child: Container(
        width: 100,
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 8),
        decoration: BoxDecoration(
          color: c.withValues(alpha: enabled ? 0.12 : 0.05),
          borderRadius: BorderRadius.circular(20),
          border: Border.all(color: c.withValues(alpha: 0.4)),
        ),
        child: Row(mainAxisAlignment: MainAxisAlignment.center, children: [
          busy
              ? SizedBox(width: 14, height: 14, child: CircularProgressIndicator(strokeWidth: 2, color: c))
              : Icon(present ? Icons.check : Icons.close, size: 16, color: c),
          const SizedBox(width: 4),
          Text(present ? tr('حضر', 'Present') : tr('لم يحضر', 'Absent'),
              style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w800, color: c)),
        ]),
      ),
    );
  }
}
