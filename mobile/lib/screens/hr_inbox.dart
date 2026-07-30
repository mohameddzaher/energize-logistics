import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';

/// HR — طلبات الإجازات (قرارات الموارد البشرية) وطلبات الموظفين (الرد وتغيير
/// الحالة): the two HR inboxes, native.

// ── طلبات الإجازات ───────────────────────────────────────────────────────────
class HrLeavesScreen extends StatefulWidget {
  const HrLeavesScreen({super.key});
  @override
  State<HrLeavesScreen> createState() => _HrLeavesScreenState();
}

const _leaveStatuses = {
  'pending_manager': ('عند المدير', 'With manager', T.warn),
  'pending_hr': ('عند الموارد البشرية', 'With HR', T.info),
  'approved': ('مقبولة', 'Approved', T.success),
  'rejected': ('مرفوضة', 'Rejected', T.danger),
  'cancelled': ('ملغاة', 'Cancelled', T.inkFaint),
};

class _HrLeavesScreenState extends State<HrLeavesScreen> {
  List<Map<String, dynamic>> _rows = [];
  bool _loading = true;
  String? _error;
  String _status = '';
  late final void Function() _onLive;

  @override
  void initState() {
    super.initState();
    _load();
    _onLive = () => _load();
    Live.instance.on('hr:leave', _onLive);
  }

  @override
  void dispose() {
    Live.instance.off('hr:leave', _onLive);
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final qs = _status.isEmpty ? '' : '?status=$_status';
      final d = await Api.instance.get('/api/hr/leaves$qs');
      if (!mounted) return;
      setState(() { _rows = List<Map<String, dynamic>>.from(d['leaves'] ?? []); _loading = false; _error = null; });
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  Future<void> _decide(Map<String, dynamic> l, String decision) async {
    final note = TextEditingController();
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: Text(decision == 'approved' ? tr('اعتماد الطلب', 'Approve') : tr('رفض الطلب', 'Reject')),
        content: TextField(controller: note, decoration: InputDecoration(labelText: tr('ملاحظة (اختياري)', 'Note'))),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: Text(tr('إلغاء', 'Cancel'))),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: decision == 'approved' ? T.success : T.danger),
            onPressed: () => Navigator.pop(c, true),
            child: Text(decision == 'approved' ? tr('اعتماد', 'Approve') : tr('رفض', 'Reject')),
          ),
        ],
      ),
    );
    if (ok != true) return;
    try {
      await Api.instance.patch('/api/hr/leaves/${l['_id']}/decision', {'decision': decision, 'note': note.text});
      _load();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    }
  }

  String _d(dynamic v) {
    final d = v != null ? DateTime.tryParse(v.toString()) : null;
    return d == null ? '—' : '${d.day}/${d.month}/${d.year}';
  }

  @override
  Widget build(BuildContext context) {
    return AppScaffold(
      title: Text(tr('طلبات الإجازات', 'Leave Requests')),
      body: _loading
          ? ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(height: 44), SizedBox(height: 10), Shimmer(), SizedBox(height: 10), Shimmer()])
          : _error != null
              ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
              : Column(children: [
                  Padding(
                    padding: const EdgeInsets.fromLTRB(14, 10, 14, 4),
                    child: SingleChildScrollView(
                      scrollDirection: Axis.horizontal,
                      child: Row(
                        children: _leaveStatuses.entries.map((e) {
                          final selected = _status == e.key;
                          return Padding(
                            padding: const EdgeInsets.only(left: 6),
                            child: FilterChip(
                              selected: selected,
                              onSelected: (_) { setState(() { _status = selected ? '' : e.key; _loading = true; }); _load(); },
                              label: Text(tr(e.value.$1, e.value.$2)),
                              labelStyle: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: selected ? Colors.white : e.value.$3),
                              selectedColor: e.value.$3,
                              backgroundColor: e.value.$3.withValues(alpha: 0.1),
                              checkmarkColor: Colors.white,
                              side: BorderSide.none,
                              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
                            ),
                          );
                        }).toList(),
                      ),
                    ),
                  ),
                  Expanded(
                    child: RefreshIndicator(
                      onRefresh: _load,
                      child: _rows.isEmpty
                          ? EmptyState(icon: Icons.event_available_outlined, title: tr('لا توجد طلبات', 'No requests'))
                          : ListView.separated(
                              padding: const EdgeInsets.all(14),
                              itemCount: _rows.length,
                              separatorBuilder: (_, __) => const SizedBox(height: 8),
                              itemBuilder: (c, i) {
                                final l = _rows[i];
                                final st = _leaveStatuses[l['status']] ?? ('—', '—', T.inkFaint);
                                final emp = l['employee'] is Map
                                    ? ((l['employee']['arabicName'] ?? '').toString().isNotEmpty
                                        ? l['employee']['arabicName']
                                        : '${l['employee']['firstName'] ?? ''} ${l['employee']['lastName'] ?? ''}'.trim())
                                    : (l['requester'] is Map ? '${l['requester']['firstName'] ?? ''} ${l['requester']['lastName'] ?? ''}'.trim() : '—');
                                final type = l['leaveType'] is Map ? (l['leaveType']['nameAr'] ?? l['leaveType']['nameEn'] ?? '') : '';
                                final actionable = l['status'] == 'pending_hr';
                                return FadeSlideIn(
                                  delayMs: (i * 15).clamp(0, 150),
                                  child: AppCard(
                                    topAccent: st.$3,
                                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                      Row(children: [
                                        Expanded(child: Text(emp.toString(), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14))),
                                        Chip2(tr(st.$1, st.$2), st.$3),
                                      ]),
                                      const SizedBox(height: 4),
                                      Text('$type · ${_d(l['startDate'])} ← ${_d(l['endDate'])} · ${l['days'] ?? '—'} ${tr('يوم', 'days')}',
                                          style: const TextStyle(fontSize: 12.5, color: T.inkSoft)),
                                      if ((l['reason'] ?? '').toString().isNotEmpty)
                                        Text(l['reason'], style: const TextStyle(fontSize: 12, color: T.inkFaint)),
                                      if (actionable) ...[
                                        const SizedBox(height: 8),
                                        Row(children: [
                                          Expanded(child: FilledButton(
                                            style: FilledButton.styleFrom(backgroundColor: T.success, minimumSize: const Size.fromHeight(38)),
                                            onPressed: () => _decide(l, 'approved'),
                                            child: Text(tr('اعتماد', 'Approve')),
                                          )),
                                          const SizedBox(width: 8),
                                          Expanded(child: FilledButton(
                                            style: FilledButton.styleFrom(backgroundColor: T.danger, minimumSize: const Size.fromHeight(38)),
                                            onPressed: () => _decide(l, 'rejected'),
                                            child: Text(tr('رفض', 'Reject')),
                                          )),
                                        ]),
                                      ],
                                    ]),
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

// ── طلبات الموظفين ───────────────────────────────────────────────────────────
class HrRequestsScreen extends StatefulWidget {
  const HrRequestsScreen({super.key});
  @override
  State<HrRequestsScreen> createState() => _HrRequestsScreenState();
}

const _reqStatuses = {
  'open': ('مفتوح', 'Open', T.warn),
  'in_progress': ('قيد التنفيذ', 'In progress', T.info),
  'received': ('تم الاستلام', 'Received', T.violet),
  'resolved': ('تم التسليم', 'Delivered', T.success),
  'closed': ('مغلق', 'Closed', T.inkFaint),
};

class _HrRequestsScreenState extends State<HrRequestsScreen> {
  List<Map<String, dynamic>> _rows = [];
  bool _loading = true;
  String? _error;
  late final void Function() _onLive;

  @override
  void initState() {
    super.initState();
    _load();
    _onLive = () => _load();
    Live.instance.on('hr:request', _onLive);
  }

  @override
  void dispose() {
    Live.instance.off('hr:request', _onLive);
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final d = await Api.instance.get('/api/hr/requests');
      if (!mounted) return;
      setState(() { _rows = List<Map<String, dynamic>>.from(d['requests'] ?? []); _loading = false; _error = null; });
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  Future<void> _reply(Map<String, dynamic> r) async {
    final body = TextEditingController();
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: Text(tr('الرد على الطلب', 'Reply')),
        content: TextField(controller: body, maxLines: 3, decoration: InputDecoration(labelText: tr('نص الرد', 'Reply text'))),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: Text(tr('إلغاء', 'Cancel'))),
          FilledButton(onPressed: () => Navigator.pop(c, true), child: Text(tr('إرسال', 'Send'))),
        ],
      ),
    );
    if (ok != true || body.text.trim().isEmpty) return;
    try {
      await Api.instance.post('/api/hr/requests/${r['_id']}/reply', {'body': body.text});
      _load();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    }
  }

  Future<void> _setStatus(Map<String, dynamic> r, String status) async {
    try {
      await Api.instance.patch('/api/hr/requests/${r['_id']}/status', {'status': status});
      _load();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    }
  }

  @override
  Widget build(BuildContext context) {
    return AppScaffold(
      title: Text(tr('طلبات الموظفين', 'Employee Requests')),
      body: _loading
          ? ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(height: 44), SizedBox(height: 10), Shimmer(), SizedBox(height: 10), Shimmer()])
          : _error != null
              ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
              : RefreshIndicator(
                  onRefresh: _load,
                  child: _rows.isEmpty
                      ? ListView(children: [const SizedBox(height: 80), EmptyState(icon: Icons.mark_email_unread_outlined, title: tr('لا توجد طلبات', 'No requests'))])
                      : ListView.separated(
                          padding: const EdgeInsets.all(14),
                          itemCount: _rows.length,
                          separatorBuilder: (_, __) => const SizedBox(height: 8),
                          itemBuilder: (c, i) {
                            final r = _rows[i];
                            final st = _reqStatuses[r['status']] ?? ('—', '—', T.inkFaint);
                            final requester = r['requester'] is Map ? '${r['requester']['firstName'] ?? ''} ${r['requester']['lastName'] ?? ''}'.trim() : '';
                            final thread = List<Map<String, dynamic>>.from(r['thread'] ?? []);
                            return FadeSlideIn(
                              delayMs: (i * 15).clamp(0, 150),
                              child: AppCard(
                                topAccent: st.$3,
                                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                  Row(children: [
                                    Expanded(child: Text((r['subject'] ?? '').toString(), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14))),
                                    Chip2(tr(st.$1, st.$2), st.$3),
                                  ]),
                                  Text(requester, style: const TextStyle(fontSize: 12, color: T.inkSoft)),
                                  if (thread.isNotEmpty) ...[
                                    const SizedBox(height: 6),
                                    Text(thread.last['body']?.toString() ?? '',
                                        style: const TextStyle(fontSize: 12, color: T.inkFaint), maxLines: 2, overflow: TextOverflow.ellipsis),
                                  ],
                                  const SizedBox(height: 8),
                                  Row(children: [
                                    TextButton.icon(
                                      onPressed: () => _reply(r),
                                      icon: const Icon(Icons.reply_outlined, size: 17),
                                      label: Text(tr('رد', 'Reply'), style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700)),
                                    ),
                                    const Spacer(),
                                    DropdownButton<String>(
                                      value: _reqStatuses.containsKey(r['status']) ? r['status'] : null,
                                      hint: Text(tr('الحالة', 'Status'), style: const TextStyle(fontSize: 12)),
                                      underline: const SizedBox.shrink(),
                                      style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700, color: T.ink),
                                      items: _reqStatuses.entries
                                          .map((e) => DropdownMenuItem(value: e.key, child: Text(tr(e.value.$1, e.value.$2))))
                                          .toList(),
                                      onChanged: (v) { if (v != null) _setStatus(r, v); },
                                    ),
                                  ]),
                                ]),
                              ),
                            );
                          },
                        ),
                ),
    );
  }
}
