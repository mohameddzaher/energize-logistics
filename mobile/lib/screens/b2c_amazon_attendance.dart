import 'dart:async';
import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';
import 'b2c_daily.dart' show AttendanceToggle;

/// متابعةُ مناديب أمازون — نظيرُ /system/b2c/amazon-attendance.
///
/// أمازون حضورٌ لا أوردرات: الجميعُ حاضرون افتراضيًّا، ويُعلَّم الغائبُ وحدَه.
/// يحسم الخادمُ مَن يراها (مدير مشروع أمازون ومدير القسم) ويردّ ٤٠٣ لغيرهما.
class B2cAmazonAttendanceScreen extends StatefulWidget {
  const B2cAmazonAttendanceScreen({super.key});
  @override
  State<B2cAmazonAttendanceScreen> createState() => _B2cAmazonAttendanceScreenState();
}

class _B2cAmazonAttendanceScreenState extends State<B2cAmazonAttendanceScreen> {
  Map<String, dynamic>? _d;
  String? _error;
  bool _forbidden = false;
  String _date = '';
  String _q = '';
  String _filter = ''; // '' | present | absent
  final Map<String, String> _state = {}; // saving | error
  Timer? _debounce;
  late final void Function() _onLive;

  @override
  void initState() {
    super.initState();
    _load();
    _onLive = () { _debounce?.cancel(); _debounce = Timer(const Duration(milliseconds: 700), _load); };
    for (final e in ['b2c:attendance', 'lt:updated']) { Live.instance.on(e, _onLive); }
  }

  @override
  void dispose() {
    for (final e in ['b2c:attendance', 'lt:updated']) { Live.instance.off(e, _onLive); }
    _debounce?.cancel();
    super.dispose();
  }

  Future<void> _load() async {
    final want = _date;
    try {
      final d = Map<String, dynamic>.from(await Api.instance.get('/api/b2c/attendance${want.isEmpty ? '' : '?date=$want'}') as Map);
      // ردٌّ متأخّرٌ ليومٍ سابقٍ لا يغلب اليومَ المختار.
      if (!mounted || want != _date) return;
      setState(() { _d = d; _error = null; _forbidden = false; _date = '${d['date']}'; });
    } on ApiException catch (e) {
      if (mounted) setState(() { _forbidden = e.status == 403; _error = e.message; });
    } catch (e) {
      if (mounted) setState(() => _error = e.toString());
    }
  }

  Future<void> _toggle(Map<String, dynamic> r) async {
    final id = '${r['lt']}';
    if (_state[id] == 'saving') return;
    final prev = r['present'] != false;
    setState(() { r['present'] = !prev; _state[id] = 'saving'; _recount(); });
    try {
      await Api.instance.put('/api/b2c/attendance', {'lt': id, 'dateKey': _date, 'present': !prev});
      if (!mounted) return;
      setState(() => _state.remove(id));
      _onLive(); // غيابُ الشهر يعدّه الخادم — نعيد القراءة.
    } catch (e) {
      if (!mounted) return;
      setState(() { r['present'] = prev; _state[id] = 'error'; _recount(); });
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    }
  }

  void _recount() {
    final rows = List<Map<String, dynamic>>.from(_d?['rows'] ?? []);
    final present = rows.where((r) => r['present'] != false).length;
    _d?['summary'] = {'total': rows.length, 'present': present, 'absent': rows.length - present};
  }

  String _fold(String s) => s.replaceAll(RegExp('[أإآ]'), 'ا').replaceAll('ى', 'ي').replaceAll('ة', 'ه').toLowerCase();
  String _iso(DateTime d) => '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';
  String _shift(int days) => _iso(DateTime.parse(_date).add(Duration(days: days)));

  Widget _filterCard(String key, String label, num value, Color color, IconData icon) => Expanded(
        child: Pressable(
          onTap: () => setState(() => _filter = _filter == key ? '' : key),
          child: Container(
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(18),
              border: Border.all(color: _filter == key ? color : Colors.transparent, width: 2),
            ),
            child: StatCard(label: label, value: value, color: color, icon: icon),
          ),
        ),
      );

  @override
  Widget build(BuildContext context) {
    final title = Text(tr('متابعة مناديب أمازون', 'Amazon reps attendance'));
    final d = _d;
    if (_forbidden) {
      return AppScaffold(title: title, body: EmptyState(icon: Icons.lock_outline,
          title: tr('هذه الصفحة لمدير مشروع أمازون ومدير القسم', 'This page is for the Amazon project manager and the section manager'),
          subtitle: _error));
    }
    if (d == null) {
      return AppScaffold(title: title,
          body: _error != null ? ErrorRetry(message: _error!, onRetry: _load) : const Center(child: CircularProgressIndicator()));
    }
    final all = List<Map<String, dynamic>>.from(d['rows'] ?? []);
    final sum = Map<String, dynamic>.from(d['summary'] ?? {});
    final needle = _fold(_q.trim());
    final rows = all.where((r) =>
        (needle.isEmpty || _fold('${r['name']} ${r['idNumber']} ${r['supervisorName']}').contains(needle)) &&
        (_filter.isEmpty || (_filter == 'present') == (r['present'] != false))).toList();
    final today = '${d['today']}';
    final projects = List<String>.from((d['projects'] ?? []).map((e) => '$e'));

    return AppScaffold(
      title: title,
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(padding: const EdgeInsets.all(12), children: [
          if (projects.isNotEmpty) Padding(
            padding: const EdgeInsets.only(bottom: 6),
            child: Text(tr('المشاريع: ${projects.join('، ')}', 'Projects: ${projects.join(', ')}'), style: const TextStyle(fontSize: 12, color: T.inkFaint)),
          ),
          AppCard(child: Row(children: [
            IconButton(icon: const Icon(Icons.chevron_right), onPressed: () { setState(() => _date = _shift(-1)); _load(); }),
            Expanded(child: InkWell(
              onTap: () async {
                final p = await showDatePicker(context: context, initialDate: DateTime.parse(_date), firstDate: DateTime(2025), lastDate: DateTime.parse(today));
                if (p != null) { setState(() => _date = _iso(p)); _load(); }
              },
              child: Center(child: Text(_date.split('-').reversed.join('/'), style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w800))),
            )),
            IconButton(icon: const Icon(Icons.chevron_left), onPressed: _date.compareTo(today) >= 0 ? null : () { setState(() => _date = _shift(1)); _load(); }),
          ])),
          const SizedBox(height: 8),
          Row(children: [
            _filterCard('', tr('العدد', 'Total'), (sum['total'] as num?) ?? 0, T.navy, Icons.groups_outlined),
            const SizedBox(width: 8),
            _filterCard('present', tr('حضر', 'Present'), (sum['present'] as num?) ?? 0, T.success, Icons.check_circle_outline),
            const SizedBox(width: 8),
            _filterCard('absent', tr('لم يحضر', 'Absent'), (sum['absent'] as num?) ?? 0, T.danger, Icons.cancel_outlined),
          ]),
          const SizedBox(height: 8),
          Text(tr('الجميع حاضرون افتراضيًّا — علِّم مَن لم يحضر فقط.', 'Everyone is present by default — mark only the absent.'),
              style: const TextStyle(fontSize: 12, color: T.inkSoft)),
          const SizedBox(height: 8),
          TextField(
            onChanged: (v) => setState(() => _q = v),
            decoration: InputDecoration(isDense: true, prefixIcon: const Icon(Icons.search), hintText: tr('ابحث بالاسم أو رقم الإقامة أو المشرف', 'Search…')),
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
                  Text([r['idNumber'], if ('${r['supervisorName'] ?? ''}'.isNotEmpty) tr('المشرف: ${r['supervisorName']}', 'Supervisor: ${r['supervisorName']}'),
                        if (r['onLeave'] == true) tr('في إجازة', 'On leave')]
                      .where((x) => '${x ?? ''}'.isNotEmpty).join(' · '),
                      style: const TextStyle(fontSize: 11.5, color: T.inkFaint)),
                  const SizedBox(height: 4),
                  Chip2(tr('غياب الشهر: ${r['monthAbsences'] ?? 0}', 'Month absences: ${r['monthAbsences'] ?? 0}'),
                      ((r['monthAbsences'] as num?) ?? 0) > 0 ? T.warn : T.inkSoft),
                ])),
                AttendanceToggle(
                  present: r['present'] != false,
                  busy: _state['${r['lt']}'] == 'saving',
                  onTap: () => _toggle(r),
                ),
              ])),
            ),
          if (rows.isEmpty) EmptyState(icon: Icons.inbox_outlined, title: tr('لا توجد نتائج مطابقة', 'No matches')),
        ]),
      ),
    );
  }
}
