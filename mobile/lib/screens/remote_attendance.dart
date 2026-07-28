import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../ui/app_scaffold.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';

/// الحضور والانصراف (العمل عن بُعد) — زر تسجيل حضور/انصراف اليوم + السجل.
class RemoteAttendanceScreen extends StatefulWidget {
  const RemoteAttendanceScreen({super.key});
  @override
  State<RemoteAttendanceScreen> createState() => _RemoteAttendanceScreenState();
}

class _RemoteAttendanceScreenState extends State<RemoteAttendanceScreen> {
  Map<String, dynamic>? _today;
  List<Map<String, dynamic>> _rows = [];
  bool _loading = true;
  String? _error;
  bool _busy = false;

  @override
  void initState() { super.initState(); _load(); }

  Future<void> _load() async {
    try {
      final results = await Future.wait([
        Api.instance.get('/api/remote/attendance/today').catchError((_) => {}),
        Api.instance.get('/api/remote/attendance'),
      ]);
      if (!mounted) return;
      setState(() {
        _today = results[0]['attendance'] as Map<String, dynamic>? ?? (results[0] is Map<String, dynamic> ? results[0] : null);
        _rows = List<Map<String, dynamic>>.from(results[1]['attendance'] ?? results[1]['items'] ?? []);
        _loading = false;
        _error = null;
      });
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  Future<void> _toggle() async {
    if (_busy) return;
    setState(() => _busy = true);
    try {
      await Api.instance.post('/api/remote/attendance/toggle');
      await _load();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  String _t(dynamic v) {
    final d = v != null ? DateTime.tryParse(v.toString())?.toLocal() : null;
    return d == null ? '—' : '${d.hour}:${d.minute.toString().padLeft(2, '0')}';
  }

  @override
  Widget build(BuildContext context) {
    final checkedIn = _today?['checkIn'] != null && _today?['checkOut'] == null;
    return AppScaffold(
      title: Text(tr('الحضور والانصراف', 'Attendance')),
      body: _loading
          ? ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(height: 130), SizedBox(height: 10), Shimmer(), SizedBox(height: 10), Shimmer()])
          : _error != null
              ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView(padding: const EdgeInsets.all(14), children: [
                    FadeSlideIn(
                      child: AppCard(
                        topAccent: checkedIn ? T.success : T.navy,
                        child: Column(children: [
                          Text(
                            checkedIn
                                ? tr('أنت مسجّل حضور منذ ${_t(_today?['checkIn'])}', 'Checked in since ${_t(_today?['checkIn'])}')
                                : _today?['checkOut'] != null
                                    ? tr('انصرفت اليوم ${_t(_today?['checkOut'])}', 'Checked out at ${_t(_today?['checkOut'])}')
                                    : tr('لم تسجّل حضورك اليوم بعد', 'Not checked in today'),
                            style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15),
                          ),
                          const SizedBox(height: 12),
                          FilledButton.icon(
                            style: FilledButton.styleFrom(backgroundColor: checkedIn ? T.danger : T.success),
                            icon: Icon(checkedIn ? Icons.logout_rounded : Icons.login_rounded),
                            onPressed: _busy ? null : _toggle,
                            label: Text(checkedIn ? tr('تسجيل انصراف', 'Check out') : tr('تسجيل حضور', 'Check in')),
                          ),
                        ]),
                      ),
                    ),
                    const SizedBox(height: 14),
                    Text(tr('السجل', 'History'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
                    const SizedBox(height: 8),
                    if (_rows.isEmpty)
                      EmptyState(icon: Icons.event_note_outlined, title: tr('لا توجد سجلات بعد', 'No records yet')),
                    ..._rows.take(30).map((r) {
                      final date = DateTime.tryParse((r['date'] ?? r['createdAt'] ?? '').toString());
                      return Padding(
                        padding: const EdgeInsets.only(bottom: 8),
                        child: AppCard(
                          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 11),
                          child: Row(children: [
                            Expanded(
                              child: Text(date != null ? '${date.day}/${date.month}/${date.year}' : '—',
                                  style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13.5)),
                            ),
                            Chip2('${tr('حضور', 'In')}: ${_t(r['checkIn'])}', T.success),
                            const SizedBox(width: 6),
                            Chip2('${tr('انصراف', 'Out')}: ${_t(r['checkOut'])}', r['checkOut'] != null ? T.navy : T.inkFaint),
                          ]),
                        ),
                      );
                    }),
                  ]),
                ),
    );
  }
}
