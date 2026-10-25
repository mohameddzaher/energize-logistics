import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../services/api.dart';
import '../services/auth.dart';
import '../services/lang.dart';
import '../ui/app_scaffold.dart';
import '../ui/export_sheet.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';
import 'remote_filters.dart';

/// الحضور والانصراف (العمل عن بُعد) — كالويب: الموظف يرى زرَّ اليوم وسجلَّه،
/// والمشرف يرى سجلَّ الفريق بفلتر الموظف/من/إلى مع تصدير Excel.
class RemoteAttendanceScreen extends StatelessWidget {
  const RemoteAttendanceScreen({super.key});
  @override
  Widget build(BuildContext context) {
    final staff = isRemoteStaff(context.watch<AuthProvider>());
    return staff ? const _StaffAttendance() : const _EmployeeAttendance();
  }
}

// ── الموظف: زرٌّ كبير ───────────────────────────────────────────────────────
class _EmployeeAttendance extends StatefulWidget {
  const _EmployeeAttendance();
  @override
  State<_EmployeeAttendance> createState() => _EmployeeAttendanceState();
}

class _EmployeeAttendanceState extends State<_EmployeeAttendance> {
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
        Api.instance.get('/api/remote/attendance/today'),
        Api.instance.get('/api/remote/attendance').catchError((_) => <String, dynamic>{}),
      ]);
      if (!mounted) return;
      setState(() {
        final rec = results[0]['record'];
        _today = rec is Map ? Map<String, dynamic>.from(rec) : null;
        _rows = List<Map<String, dynamic>>.from(results[1]['records'] ?? []);
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
      final d = await Api.instance.post('/api/remote/attendance/toggle');
      if (mounted && d is Map && d['record'] is Map) setState(() => _today = Map<String, dynamic>.from(d['record']));
      _load();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Widget _stat(String label, String value) => Expanded(
        child: Container(
          padding: const EdgeInsets.all(10),
          decoration: BoxDecoration(color: T.canvas, borderRadius: BorderRadius.circular(12)),
          child: Column(children: [
            Text(label, style: const TextStyle(fontSize: 11, color: T.inkSoft)),
            const SizedBox(height: 3),
            Text(value, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w900)),
          ]),
        ),
      );

  @override
  Widget build(BuildContext context) {
    final notStarted = _today == null;
    final checkedIn = _today?['checkIn'] != null && _today?['checkOut'] == null;
    final done = _today?['checkIn'] != null && _today?['checkOut'] != null;
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
                        topAccent: done ? T.success : checkedIn ? T.danger : T.success,
                        child: Column(children: [
                          if (checkedIn) ...[
                            Text(tr('أنت مسجّل حضور منذ', 'You are checked in since'), style: const TextStyle(color: T.success, fontWeight: FontWeight.w700)),
                            Text(fmtClock(_today?['checkIn']), style: const TextStyle(fontSize: 30, fontWeight: FontWeight.w900)),
                            const SizedBox(height: 10),
                          ],
                          if (done) ...[
                            const Icon(Icons.check_circle_outline, size: 52, color: T.success),
                            const SizedBox(height: 6),
                            Text(tr('تم تسجيل يومك', 'Day recorded'), style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w900)),
                            const SizedBox(height: 10),
                            Row(children: [
                              _stat(tr('حضور', 'In'), fmtClock(_today?['checkIn'])),
                              const SizedBox(width: 8),
                              _stat(tr('انصراف', 'Out'), fmtClock(_today?['checkOut'])),
                              const SizedBox(width: 8),
                              _stat(tr('الساعات', 'Hours'), fmtDuration(_today?['durationMinutes'])),
                            ]),
                          ],
                          if (notStarted || checkedIn)
                            SizedBox(
                              width: double.infinity,
                              height: 110,
                              child: FilledButton.icon(
                                style: FilledButton.styleFrom(
                                  backgroundColor: checkedIn ? T.danger : T.success,
                                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(22)),
                                ),
                                icon: _busy
                                    ? const SizedBox(width: 30, height: 30, child: CircularProgressIndicator(color: Colors.white, strokeWidth: 3))
                                    : Icon(checkedIn ? Icons.logout_rounded : Icons.login_rounded, size: 36),
                                onPressed: _busy ? null : _toggle,
                                label: Text(checkedIn ? tr('تسجيل انصراف', 'Check out') : tr('تسجيل حضور', 'Check in'),
                                    style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w900)),
                              ),
                            ),
                        ]),
                      ),
                    ),
                    const SizedBox(height: 14),
                    Text(tr('السجل', 'History'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
                    const SizedBox(height: 8),
                    if (_rows.isEmpty) EmptyState(icon: Icons.event_note_outlined, title: tr('لا توجد سجلات بعد', 'No records yet')),
                    ..._rows.take(30).map((r) => _AttRow(r: r, showUser: false)),
                  ]),
                ),
    );
  }
}

class _AttRow extends StatelessWidget {
  final Map<String, dynamic> r;
  final bool showUser;
  const _AttRow({required this.r, required this.showUser});
  @override
  Widget build(BuildContext context) {
    final present = r['status'] == 'present';
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: AppCard(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 11),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            Expanded(
              child: Text(showUser ? remoteUserName(r['user']) : (r['date'] ?? '—').toString(),
                  style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13.5)),
            ),
            Chip2(present ? tr('مكتمل', 'Complete') : tr('مفتوح', 'Open'), present ? T.success : T.warn),
          ]),
          const SizedBox(height: 6),
          Wrap(spacing: 6, runSpacing: 6, children: [
            if (showUser) Chip2((r['date'] ?? '—').toString(), T.navy, icon: Icons.event),
            Chip2('${tr('حضور', 'In')}: ${fmtClock(r['checkIn'])}', T.success),
            Chip2('${tr('انصراف', 'Out')}: ${r['checkOut'] != null ? fmtClock(r['checkOut']) : '—'}', r['checkOut'] != null ? T.navy : T.inkFaint),
            Chip2(fmtDuration(r['durationMinutes']), T.info, icon: Icons.schedule_outlined),
          ]),
        ]),
      ),
    );
  }
}

// ── المشرف: حضور الفريق ─────────────────────────────────────────────────────
class _StaffAttendance extends StatefulWidget {
  const _StaffAttendance();
  @override
  State<_StaffAttendance> createState() => _StaffAttendanceState();
}

class _StaffAttendanceState extends State<_StaffAttendance> {
  List<Map<String, dynamic>> _rows = [];
  bool _loading = true;
  String? _error;
  String _userId = '';
  String? _from, _to;
  int _seq = 0;

  @override
  void initState() { super.initState(); _load(); }

  String _qs({bool all = false}) {
    if (all) return '';
    final q = <String>[
      if (_userId.isNotEmpty) 'userId=$_userId',
      if (_from != null) 'from=$_from',
      if (_to != null) 'to=$_to',
    ];
    return q.isEmpty ? '' : '?${q.join('&')}';
  }

  Future<void> _load() async {
    final my = ++_seq;
    try {
      final d = await Api.instance.get('/api/remote/attendance${_qs()}');
      if (!mounted || my != _seq) return;
      setState(() { _rows = List<Map<String, dynamic>>.from(d['records'] ?? []); _loading = false; _error = null; });
    } catch (e) {
      if (mounted && my == _seq) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  static final _cols = [
    ExportCol('الموظف', 'Employee', (r) => remoteUserName(r['user'])),
    ExportCol('التاريخ', 'Date', (r) => r['date']),
    ExportCol('حضور', 'In', (r) => fmtClock(r['checkIn'])),
    ExportCol('انصراف', 'Out', (r) => r['checkOut'] != null ? fmtClock(r['checkOut']) : '—'),
    ExportCol('الساعات', 'Hours', (r) => fmtDuration(r['durationMinutes'])),
    ExportCol('الحالة', 'Status', (r) => r['status'] == 'present' ? tr('مكتمل', 'Complete') : tr('مفتوح', 'Open')),
  ];

  /// كالويب: المعروض تحت الفلتر، أو سجلّ الفريق كلّه بنداءٍ جديد بلا فلتر.
  Future<void> _export() async {
    final filtered = _userId.isNotEmpty || _from != null || _to != null;
    String? scope = 'shown';
    if (filtered) {
      scope = await showModalBottomSheet<String>(
        context: context,
        builder: (c) => SafeArea(
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            ListTile(leading: const Icon(Icons.filter_alt_outlined), title: Text(tr('المعروض', 'Shown')), onTap: () => Navigator.pop(c, 'shown')),
            ListTile(leading: const Icon(Icons.select_all), title: Text(tr('الكل', 'All')), onTap: () => Navigator.pop(c, 'all')),
          ]),
        ),
      );
    }
    if (scope == null || !mounted) return;
    var rows = _rows;
    if (scope == 'all') {
      try {
        final d = await Api.instance.get('/api/remote/attendance');
        rows = List<Map<String, dynamic>>.from(d['records'] ?? []);
      } catch (e) {
        if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
        return;
      }
    }
    if (!mounted) return;
    await exportExcel(context, fileName: 'remote-attendance', sheets: [(tr('حضور الفريق', 'Team attendance'), _cols, rows)]);
  }

  @override
  Widget build(BuildContext context) {
    return AppScaffold(
      title: Text(tr('حضور الفريق', 'Team attendance')),
      actions: [IconButton(tooltip: tr('تصدير Excel', 'Export Excel'), icon: const Icon(Icons.file_download_outlined), onPressed: _export)],
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(padding: const EdgeInsets.all(14), children: [
          RemoteFilterBar(
            userId: _userId, from: _from, to: _to,
            onChanged: (u, f, t) { setState(() { _userId = u; _from = f; _to = t; _loading = true; }); _load(); },
          ),
          const SizedBox(height: 12),
          if (_loading) ...const [Shimmer(), SizedBox(height: 10), Shimmer()]
          else if (_error != null) ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
          else if (_rows.isEmpty) EmptyState(icon: Icons.event_note_outlined, title: tr('لا توجد سجلات', 'No records'))
          else ..._rows.map((r) => _AttRow(r: r, showUser: true)),
        ]),
      ),
    );
  }
}
