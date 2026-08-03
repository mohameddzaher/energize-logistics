import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';

/// تقويم العلاقات — أنشطة CRM ومهامها للشهر مجمّعة باليوم، مع تنقّل بين الشهور.
/// مطابق لصفحة الويب /system/crm/calendar (/api/crm/calendar?from&to).
class CrmCalendarScreen extends StatefulWidget {
  const CrmCalendarScreen({super.key});
  @override
  State<CrmCalendarScreen> createState() => _CrmCalendarScreenState();
}

const _months = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
const _monthsEn = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

class _CrmCalendarScreenState extends State<CrmCalendarScreen> {
  List<Map<String, dynamic>> _activities = [], _tasks = [];
  bool _loading = true;
  String? _error;
  int _year = 2026, _month = 8; // مبدئيًا؛ يُضبط في initState
  late final void Function() _onLive;

  @override
  void initState() {
    super.initState();
    final now = DateTime.now();
    _year = now.year;
    _month = now.month;
    _load();
    _onLive = () => _load();
    Live.instance.on('crm:updated', _onLive);
  }

  @override
  void dispose() { Live.instance.off('crm:updated', _onLive); super.dispose(); }

  String _iso(DateTime d) => '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';

  Future<void> _load() async {
    setState(() => _loading = true);
    try {
      final from = DateTime(_year, _month, 1);
      final to = DateTime(_year, _month + 1, 0, 23, 59, 59);
      final d = await Api.instance.get('/api/crm/calendar?from=${_iso(from)}&to=${_iso(to)}');
      if (!mounted) return;
      setState(() {
        _activities = List<Map<String, dynamic>>.from(d['activities'] ?? []);
        _tasks = List<Map<String, dynamic>>.from(d['tasks'] ?? []);
        _loading = false;
        _error = null;
      });
    } catch (e) { if (mounted) setState(() { _loading = false; _error = e.toString(); }); }
  }

  void _shift(int delta) {
    var m = _month + delta, y = _year;
    if (m < 1) { m = 12; y -= 1; } else if (m > 12) { m = 1; y += 1; }
    setState(() { _month = m; _year = y; });
    _load();
  }

  String _name(dynamic ref) {
    if (ref is Map) return (ref['name'] ?? ref['companyName'] ?? ref['fullName'] ?? '').toString();
    return '';
  }

  @override
  Widget build(BuildContext context) {
    // دمج الأنشطة والمهام في أحداث مرتّبة باليوم.
    final events = <Map<String, dynamic>>[];
    for (final a in _activities) {
      final dt = DateTime.tryParse((a['date'] ?? '').toString())?.toLocal();
      if (dt == null) continue;
      events.add({'day': dt.day, 'dt': dt, 'kind': 'activity', 'title': (a['subject'] ?? a['type'] ?? 'نشاط').toString(),
        'sub': [_name(a['company']), _name(a['contact']), (a['type'] ?? '').toString()].where((x) => x.isNotEmpty).join(' · '), 'color': T.info});
    }
    for (final t in _tasks) {
      final dt = DateTime.tryParse((t['dueDate'] ?? '').toString())?.toLocal();
      if (dt == null) continue;
      final done = t['status'] == 'completed';
      events.add({'day': dt.day, 'dt': dt, 'kind': 'task', 'title': (t['title'] ?? 'مهمة').toString(),
        'sub': [_name(t['company']), _name(t['contact']), if ((t['priority'] ?? '').toString().isNotEmpty) 'أولوية ${t['priority']}'].where((x) => x.isNotEmpty).join(' · '),
        'color': done ? T.success : (t['priority'] == 'high' ? T.danger : T.warn), 'done': done});
    }
    events.sort((a, b) => (a['dt'] as DateTime).compareTo(b['dt'] as DateTime));
    // تجميع باليوم.
    final byDay = <int, List<Map<String, dynamic>>>{};
    for (final e in events) { byDay.putIfAbsent(e['day'] as int, () => []).add(e); }
    final days = byDay.keys.toList()..sort();

    return AppScaffold(
      title: Text(tr('تقويم العلاقات', 'CRM Calendar')),
      body: _loading
          ? ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(height: 50), SizedBox(height: 10), Shimmer(height: 80), SizedBox(height: 10), Shimmer(height: 80)])
          : _error != null
              ? ErrorRetry(message: _error!, onRetry: _load)
              : Column(children: [
                  // شريط تنقّل الشهور
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                    color: T.navy.withValues(alpha: 0.04),
                    child: Row(children: [
                      IconButton(onPressed: () => _shift(-1), icon: Icon(Lang.instance.ar ? Icons.chevron_right : Icons.chevron_left)),
                      Expanded(child: Text('${Lang.instance.ar ? _months[_month - 1] : _monthsEn[_month - 1]} $_year',
                          textAlign: TextAlign.center, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16))),
                      IconButton(onPressed: () => _shift(1), icon: Icon(Lang.instance.ar ? Icons.chevron_left : Icons.chevron_right)),
                    ]),
                  ),
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
                    child: Row(children: [
                      Chip2('${_activities.length} ${tr('نشاط', 'activities')}', T.info),
                      const SizedBox(width: 8),
                      Chip2('${_tasks.length} ${tr('مهمة', 'tasks')}', T.warn),
                    ]),
                  ),
                  Expanded(
                    child: RefreshIndicator(
                      onRefresh: _load,
                      child: days.isEmpty
                          ? EmptyState(icon: Icons.event_available_outlined, title: tr('لا أنشطة أو مهام هذا الشهر', 'Nothing this month'))
                          : ListView(
                              padding: const EdgeInsets.all(14),
                              children: days.map((day) {
                                final list = byDay[day]!;
                                final dt = list.first['dt'] as DateTime;
                                return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                  Padding(
                                    padding: const EdgeInsets.symmetric(vertical: 6),
                                    child: Row(children: [
                                      Container(
                                        width: 38, height: 38,
                                        decoration: BoxDecoration(color: T.navy, borderRadius: BorderRadius.circular(10)),
                                        alignment: Alignment.center,
                                        child: Text('$day', style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w800, fontSize: 15)),
                                      ),
                                      const SizedBox(width: 8),
                                      Text(_weekday(dt), style: const TextStyle(fontSize: 12.5, color: T.inkFaint, fontWeight: FontWeight.w600)),
                                      const Spacer(),
                                      Text('${list.length}', style: const TextStyle(fontSize: 12, color: T.inkFaint)),
                                    ]),
                                  ),
                                  ...list.map((e) => Padding(
                                        padding: const EdgeInsets.only(bottom: 6, right: 4, left: 4),
                                        child: AppCard(
                                          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
                                          child: Row(children: [
                                            Container(width: 4, height: 34, decoration: BoxDecoration(color: e['color'] as Color, borderRadius: BorderRadius.circular(2))),
                                            const SizedBox(width: 10),
                                            Icon(e['kind'] == 'task' ? Icons.checklist_rounded : Icons.event_note_outlined, size: 16, color: e['color'] as Color),
                                            const SizedBox(width: 8),
                                            Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                              Text(e['title'].toString(), style: TextStyle(fontWeight: FontWeight.w700, fontSize: 13, decoration: e['done'] == true ? TextDecoration.lineThrough : null, color: e['done'] == true ? T.inkFaint : T.ink)),
                                              if ((e['sub'] ?? '').toString().isNotEmpty)
                                                Text(e['sub'].toString(), style: const TextStyle(fontSize: 11, color: T.inkFaint)),
                                            ])),
                                            Text('${(e['dt'] as DateTime).hour.toString().padLeft(2, '0')}:${(e['dt'] as DateTime).minute.toString().padLeft(2, '0')}', style: const TextStyle(fontSize: 11, color: T.inkFaint)),
                                          ]),
                                        ),
                                      )),
                                ]);
                              }).toList(),
                            ),
                    ),
                  ),
                ]),
    );
  }

  String _weekday(DateTime d) {
    const ar = ['الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت', 'الأحد'];
    const en = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    return Lang.instance.ar ? ar[d.weekday - 1] : en[d.weekday - 1];
  }
}
