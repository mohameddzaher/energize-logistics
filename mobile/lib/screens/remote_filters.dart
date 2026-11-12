import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/auth.dart';
import '../services/lang.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';

/// Shared helpers for the remote-work screens, like lib/remote.ts on the web.

const remoteStaffRoles = ['super_admin', 'admin', 'it_manager', 'it_team_leader', 'it_specialist', 'remote_manager', 'remote_team_leader'];

/// Supervisor: a role from the list, or the section grant from the permissions matrix, as on the web and the server.
bool isRemoteStaff(AuthProvider auth) =>
    remoteStaffRoles.contains(auth.role) || auth.canAccessSection('Remote');

String remoteUserName(dynamic u) =>
    u is Map ? '${u['firstName'] ?? ''} ${u['lastName'] ?? ''}'.trim() : '—';

String ymd(DateTime d) =>
    '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';

/// Minutes to "X h Y m", fmtDuration on the web.
String fmtDuration(dynamic minutes) {
  final m = ((minutes is num ? minutes : num.tryParse('$minutes') ?? 0).round()).clamp(0, 1 << 30);
  final h = m ~/ 60, mm = m % 60;
  if (Lang.instance.ar) {
    if (h > 0 && mm > 0) return '$h س $mm د';
    if (h > 0) return '$h س';
    return '$mm د';
  }
  if (h > 0 && mm > 0) return '${h}h ${mm}m';
  if (h > 0) return '${h}h';
  return '${mm}m';
}

String fmtClock(dynamic v) {
  final d = v != null ? DateTime.tryParse(v.toString())?.toLocal() : null;
  return d == null ? '—' : '${d.hour.toString().padLeft(2, '0')}:${d.minute.toString().padLeft(2, '0')}';
}

/// Remote-work employee list (for supervisors); fetched once and shared between screens.
class RemoteEmployees {
  static List<Map<String, dynamic>>? _cache;
  static Future<List<Map<String, dynamic>>> load() async {
    if (_cache != null) return _cache!;
    try {
      final d = await Api.instance.get('/api/remote/employees');
      _cache = List<Map<String, dynamic>>.from(d['employees'] ?? []);
    } catch (_) {
      return [];
    }
    return _cache!;
  }
}

/// Supervisor filter bar: employee + optional from/to + optional status.
class RemoteFilterBar extends StatefulWidget {
  final String userId;
  final String? from;
  final String? to;
  final bool withDates;
  final String allLabelAr;
  final String allLabelEn;
  final Widget? extra;
  final void Function(String userId, String? from, String? to) onChanged;
  const RemoteFilterBar({
    super.key,
    required this.userId,
    required this.onChanged,
    this.from,
    this.to,
    this.withDates = true,
    this.allLabelAr = 'الكل',
    this.allLabelEn = 'All',
    this.extra,
  });
  @override
  State<RemoteFilterBar> createState() => _RemoteFilterBarState();
}

class _RemoteFilterBarState extends State<RemoteFilterBar> {
  List<Map<String, dynamic>> _emps = [];

  @override
  void initState() {
    super.initState();
    RemoteEmployees.load().then((v) { if (mounted) setState(() => _emps = v); });
  }

  Future<void> _pick(bool isFrom) async {
    final cur = DateTime.tryParse((isFrom ? widget.from : widget.to) ?? '') ?? DateTime.now();
    final v = await showDatePicker(context: context, initialDate: cur, firstDate: DateTime(2020), lastDate: DateTime.now().add(const Duration(days: 365)));
    if (v == null) return;
    widget.onChanged(widget.userId, isFrom ? ymd(v) : widget.from, isFrom ? widget.to : ymd(v));
  }

  Widget _dateBtn(bool isFrom) {
    final val = isFrom ? widget.from : widget.to;
    final has = val != null && val.isNotEmpty;
    return Expanded(
      child: OutlinedButton(
        style: OutlinedButton.styleFrom(padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 10)),
        onPressed: () => _pick(isFrom),
        onLongPress: has ? () => widget.onChanged(widget.userId, isFrom ? null : widget.from, isFrom ? widget.to : null) : null,
        child: Row(mainAxisSize: MainAxisSize.min, children: [
          const Icon(Icons.event, size: 16),
          const SizedBox(width: 4),
          Flexible(child: Text(has ? val : (isFrom ? tr('من', 'From') : tr('إلى', 'To')), overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 12.5))),
          if (has) ...[
            const SizedBox(width: 2),
            InkWell(
              onTap: () => widget.onChanged(widget.userId, isFrom ? null : widget.from, isFrom ? widget.to : null),
              child: const Icon(Icons.close, size: 15, color: T.inkFaint),
            ),
          ],
        ]),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final valid = _emps.any((e) => e['_id'] == widget.userId) ? widget.userId : '';
    return AppCard(
      padding: const EdgeInsets.all(10),
      child: Column(children: [
        DropdownButtonFormField<String>(
          initialValue: valid,
          isExpanded: true,
          decoration: InputDecoration(labelText: tr('الموظف', 'Employee'), isDense: true),
          items: [
            DropdownMenuItem(value: '', child: Text(tr(widget.allLabelAr, widget.allLabelEn))),
            ..._emps.map((e) => DropdownMenuItem(value: (e['_id'] ?? '').toString(), child: Text(remoteUserName(e), overflow: TextOverflow.ellipsis))),
          ],
          onChanged: (v) => widget.onChanged(v ?? '', widget.from, widget.to),
        ),
        if (widget.extra != null) ...[const SizedBox(height: 8), widget.extra!],
        if (widget.withDates) ...[
          const SizedBox(height: 8),
          Row(children: [_dateBtn(true), const SizedBox(width: 8), _dateBtn(false)]),
        ],
      ]),
    );
  }
}
