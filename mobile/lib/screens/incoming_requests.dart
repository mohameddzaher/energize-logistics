import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';

/// Employee requests reaching the reader as direct manager, as the department they were sent to, or as top
/// management; the holder forwards, handles or rejects them. Same API and rules as the web (IncomingRequests.tsx,
/// backend utils/requestRouting). `target` narrows to one department's desk (HR, finance, top management).

const reqStatusLabels = {
  'open': ('مفتوح', 'Open', Color(0xFFD97706)),
  'in_progress': ('قيد التنفيذ', 'In progress', Color(0xFF2563EB)),
  'received': ('تم الاستلام', 'Received', Color(0xFF7C3AED)),
  'resolved': ('تم الإنجاز', 'Resolved', Color(0xFF059669)),
  'closed': ('مغلق', 'Closed', Color(0xFF64748B)),
  'rejected': ('مرفوض', 'Rejected', Color(0xFFDC2626)),
  'cancelled': ('ملغى', 'Cancelled', Color(0xFF64748B)),
};
const _openStatuses = ['open', 'in_progress', 'received'];
const _actionLabels = {
  'created': ('قُدِّم الطلب', 'Submitted'), 'forwarded': ('حُوِّل', 'Forwarded'), 'in_progress': ('بدأ التنفيذ', 'Started'),
  'resolved': ('أُنجز', 'Resolved'), 'rejected': ('رُفض', 'Rejected'), 'closed': ('أُغلق', 'Closed'),
  'cancelled': ('ألغاه صاحبه', 'Cancelled by the requester'), 'status': ('تغيّرت الحالة', 'Status changed'),
};

String _person(dynamic u) => u is Map ? '${u['firstName'] ?? ''} ${u['lastName'] ?? ''}'.trim() : '';
String targetLabel(String? key, List<Map<String, dynamic>> targets) {
  if (key == null || key.isEmpty) return '';
  if (key == 'manager') return tr('المدير المباشر', 'Direct manager');
  final t = targets.firstWhere((x) => x['key'] == key, orElse: () => {});
  return t.isEmpty ? key : tr('${t['ar']}', '${t['en']}');
}

/// Who holds the request now.
String whereNow(Map r, List<Map<String, dynamic>> targets) {
  final stage = '${r['stage'] ?? (_openStatuses.contains(r['status']) ? 'department' : 'done')}';
  if (stage == 'manager') {
    final m = _person(r['manager']);
    return '${tr('عند المدير المباشر', 'With the direct manager')}${m.isEmpty ? '' : ' — $m'}';
  }
  if (stage == 'department') return '${tr('عند', 'With')} ${targetLabel('${r['targetSection'] ?? 'HR'}', targets)}';
  return tr('منتهٍ', 'Finished');
}

String _fmt(dynamic v) {
  final d = DateTime.tryParse('${v ?? ''}')?.toLocal();
  if (d == null) return '';
  String two(int n) => n.toString().padLeft(2, '0');
  return '${two(d.day)}/${two(d.month)}/${d.year} ${two(d.hour)}:${two(d.minute)}';
}

/// The request's route: where it is now and every hand-over.
class RequestRouteCard extends StatelessWidget {
  final Map r;
  final List<Map<String, dynamic>> targets;
  const RequestRouteCard({super.key, required this.r, required this.targets});
  @override
  Widget build(BuildContext context) {
    final history = List<Map>.from(r['history'] ?? const []);
    final done = '${r['stage']}' == 'done' || !_openStatuses.contains(r['status']);
    return AppCard(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Row(children: [
        Icon(done ? Icons.check_circle_outline : Icons.schedule, size: 18, color: done ? T.success : T.warn),
        const SizedBox(width: 6),
        Expanded(child: Text(whereNow(r, targets), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13.5))),
      ]),
      for (final h in history) Padding(
        padding: const EdgeInsets.only(top: 6),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text([
            tr(_actionLabels[h['action']]?.$1 ?? '${h['action']}', _actionLabels[h['action']]?.$2 ?? '${h['action']}'),
            if (h['action'] == 'forwarded') '${targetLabel('${h['fromSection'] ?? ''}', targets)} ${tr('←', '→')} ${targetLabel('${h['toSection'] ?? ''}', targets)}',
            if (h['action'] == 'created' && '${h['toSection'] ?? ''}'.isNotEmpty) '${tr('إلى', 'to')} ${targetLabel('${h['toSection']}', targets)}',
            if ('${h['byName'] ?? ''}'.isNotEmpty) '${h['byName']}',
            _fmt(h['at']),
          ].join(' · '), style: const TextStyle(fontSize: 12, color: T.inkSoft)),
          if ('${h['note'] ?? ''}'.isNotEmpty) Text('${h['note']}', style: const TextStyle(fontSize: 12.5)),
        ]),
      ),
    ]));
  }
}

class IncomingRequestsScreen extends StatefulWidget {
  final String? target;
  final (String, String)? title;
  const IncomingRequestsScreen({super.key, this.target, this.title});
  @override
  State<IncomingRequestsScreen> createState() => _IncomingRequestsScreenState();
}

class _IncomingRequestsScreenState extends State<IncomingRequestsScreen> {
  static const _tabs = [('pending', 'تنتظر إجراءك', 'Waiting on you'), ('open', 'مفتوحة', 'Open'), ('done', 'منتهية', 'Finished'), ('all', 'الكل', 'All')];
  String _tab = 'pending';
  List<Map<String, dynamic>> _rows = [];
  List<Map<String, dynamic>> _targets = [];
  bool _loading = true;
  String? _error;
  late final void Function() _onLive = _load;

  @override
  void initState() { super.initState(); _load(); Live.instance.on('hr:request', _onLive); }
  @override
  void dispose() { Live.instance.off('hr:request', _onLive); super.dispose(); }

  Future<void> _load() async {
    try {
      final d = await Api.instance.get('/api/hr/me/incoming-requests');
      if (!mounted) return;
      setState(() {
        _rows = List<Map<String, dynamic>>.from(d['requests'] ?? []);
        _targets = List<Map<String, dynamic>>.from(d['targets'] ?? []);
        _loading = false; _error = null;
      });
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  List<Map<String, dynamic>> get _scoped {
    final t = widget.target;
    if (t == null) return _rows;
    return _rows.where((r) => r['targetSection'] == t || ((r['history'] as List?) ?? const []).any((h) => h is Map && h['toSection'] == t)).toList();
  }

  bool _inTab(Map r, String tab) => switch (tab) {
        'pending' => r['canAct'] == true,
        'open' => _openStatuses.contains(r['status']),
        'done' => !_openStatuses.contains(r['status']),
        _ => true,
      };

  @override
  Widget build(BuildContext context) {
    final scoped = _scoped;
    final shown = scoped.where((r) => _inTab(r, _tab)).toList();
    return AppScaffold(
      title: Text(widget.title == null ? tr('الطلبات الواردة', 'Incoming Requests') : tr(widget.title!.$1, widget.title!.$2)),
      body: Column(children: [
        SizedBox(height: 50, child: ListView(scrollDirection: Axis.horizontal, padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8), children: [
          for (final t in _tabs) Padding(padding: const EdgeInsetsDirectional.only(end: 6), child: ChoiceChip(
            selected: _tab == t.$1,
            label: Text('${tr(t.$2, t.$3)} ${scoped.where((r) => _inTab(r, t.$1)).length}'),
            onSelected: (_) => setState(() => _tab = t.$1),
          )),
        ])),
        Expanded(child: _loading ? const Center(child: CircularProgressIndicator()) : _error != null && _rows.isEmpty
            ? ErrorRetry(message: _error!, onRetry: _load)
            : RefreshIndicator(
                onRefresh: _load,
                child: shown.isEmpty
                    ? ListView(children: [EmptyState(icon: Icons.inbox_outlined, title: _tab == 'pending' ? tr('لا شيء ينتظر إجراءك', 'Nothing waits on you') : tr('لا توجد طلبات هنا', 'Nothing here'))])
                    : ListView(padding: const EdgeInsets.all(12), children: [
                        for (final r in shown) Padding(padding: const EdgeInsets.only(bottom: 8), child: InkWell(
                          borderRadius: BorderRadius.circular(14),
                          onTap: () => _open(r),
                          child: AppCard(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                            Row(children: [
                              Expanded(child: Text(_person(r['requester']), style: const TextStyle(fontWeight: FontWeight.w800))),
                              if (r['canAct'] == true) Padding(padding: const EdgeInsetsDirectional.only(end: 6), child: Chip2(tr('عندك', 'Yours'), T.orange)),
                              Chip2(tr(reqStatusLabels[r['status']]?.$1 ?? '${r['status']}', reqStatusLabels[r['status']]?.$2 ?? '${r['status']}'), reqStatusLabels[r['status']]?.$3 ?? T.inkSoft),
                            ]),
                            const SizedBox(height: 4),
                            Text('${r['subject'] ?? ''}', style: const TextStyle(fontSize: 13.5, fontWeight: FontWeight.w600)),
                            Text([whereNow(r, _targets), if (r['employee'] is Map && '${r['employee']['department'] ?? ''}'.isNotEmpty) '${r['employee']['department']}', _fmt(r['updatedAt'])].join(' · '),
                                style: const TextStyle(fontSize: 12, color: T.inkSoft)),
                          ])),
                        )),
                      ]),
              )),
      ]),
    );
  }

  Future<void> _open(Map<String, dynamic> r) async {
    await showModalBottomSheet(
      context: context, isScrollControlled: true, useSafeArea: true,
      builder: (_) => _RequestSheet(r: r, targets: _targets, onChanged: _load),
    );
    _load();
  }
}

class _RequestSheet extends StatefulWidget {
  final Map<String, dynamic> r;
  final List<Map<String, dynamic>> targets;
  final Future<void> Function() onChanged;
  const _RequestSheet({required this.r, required this.targets, required this.onChanged});
  @override
  State<_RequestSheet> createState() => _RequestSheetState();
}

class _RequestSheetState extends State<_RequestSheet> {
  late Map<String, dynamic> _r = widget.r;
  final _reply = TextEditingController();
  final _note = TextEditingController();
  String? _act; // forward | resolve | reject
  String? _to;
  bool _busy = false;

  @override
  void dispose() { _reply.dispose(); _note.dispose(); super.dispose(); }

  void _snack(String m) { if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(m))); }

  Future<void> _send() async {
    if (_reply.text.trim().isEmpty || _busy) return;
    setState(() => _busy = true);
    try {
      final d = await Api.instance.post('/api/hr/requests/${_r['_id']}/reply', {'body': _reply.text.trim()});
      _reply.clear();
      setState(() => _r = {..._r, ...Map<String, dynamic>.from(d['request'] ?? {})});
      await widget.onChanged();
    } catch (e) { _snack(e.toString()); }
    if (mounted) setState(() => _busy = false);
  }

  Future<void> _run(String action) async {
    setState(() => _busy = true);
    try {
      final d = await Api.instance.post('/api/hr/me/requests/${_r['_id']}/action', {
        'action': action, 'note': _note.text.trim(), if (action == 'forward') 'toSection': _to,
      });
      setState(() { _r = {..._r, ...Map<String, dynamic>.from(d['request'] ?? {}), 'canAct': false}; _act = null; _note.clear(); });
      await widget.onChanged();
      _snack(tr('تمّ', 'Done'));
    } catch (e) { _snack(e.toString()); }
    if (mounted) setState(() => _busy = false);
  }

  @override
  Widget build(BuildContext context) {
    final r = _r;
    final open = _openStatuses.contains(r['status']);
    final st = reqStatusLabels[r['status']];
    final thread = List<Map>.from(r['thread'] ?? const []);
    final emp = r['employee'] is Map ? r['employee'] as Map : const {};
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
      child: DraggableScrollableSheet(
        expand: false, initialChildSize: 0.9, maxChildSize: 0.95,
        builder: (c, scroll) => ListView(controller: scroll, padding: const EdgeInsets.fromLTRB(16, 16, 16, 24), children: [
          Row(children: [
            Expanded(child: Text('${r['subject'] ?? ''}', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 17))),
            if (st != null) Chip2(tr(st.$1, st.$2), st.$3),
          ]),
          const SizedBox(height: 4),
          Text([_person(r['requester']), '${emp['department'] ?? ''}', '${emp['jobTitle'] ?? ''}'].where((x) => x.isNotEmpty).join(' · '), style: const TextStyle(fontSize: 12.5, color: T.inkSoft)),
          const SizedBox(height: 10),
          RequestRouteCard(r: r, targets: widget.targets),
          const SizedBox(height: 12),
          Text(tr('المحادثة', 'Conversation'), style: const TextStyle(fontWeight: FontWeight.w800, color: T.inkSoft)),
          if (thread.isEmpty) Padding(padding: const EdgeInsets.symmetric(vertical: 10), child: Text(tr('لا رسائل بعد', 'No messages yet'), style: const TextStyle(color: T.inkFaint))),
          for (final m in thread) Container(
            margin: const EdgeInsets.symmetric(vertical: 4), padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(color: T.navy.withValues(alpha: 0.06), borderRadius: BorderRadius.circular(12)),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text('${_person(m['sender'])} · ${_fmt(m['at'])}', style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: T.inkSoft)),
              if ('${m['body'] ?? ''}'.isNotEmpty) Text('${m['body']}', style: const TextStyle(fontSize: 13.5)),
              if ('${m['link'] ?? ''}'.isNotEmpty) Text('${m['link']}', style: const TextStyle(fontSize: 12, color: T.info, decoration: TextDecoration.underline)),
              for (final a in List<Map>.from(m['attachments'] ?? const [])) Text('📎 ${a['title'] ?? a['fileName'] ?? ''}', style: const TextStyle(fontSize: 12, color: T.info)),
            ]),
          ),
          if (open) Padding(
            padding: const EdgeInsets.only(top: 6),
            child: Row(children: [
              Expanded(child: TextField(controller: _reply, minLines: 1, maxLines: 4, decoration: InputDecoration(hintText: tr('اكتب ردًّا للموظف…', 'Reply to the employee…')))),
              const SizedBox(width: 8),
              IconButton.filled(onPressed: _busy ? null : _send, icon: const Icon(Icons.send_rounded)),
            ]),
          ),
          if (open && r['canAct'] == true) ...[
            const Divider(height: 28),
            Wrap(spacing: 8, runSpacing: 8, children: [
              ChoiceChip(selected: _act == 'forward', avatar: const Icon(Icons.swap_horiz, size: 18), label: Text(tr('تحويل إلى قسم', 'Forward')), onSelected: (_) => setState(() => _act = 'forward')),
              if ('${r['stage']}' == 'department' && r['status'] == 'open')
                ActionChip(avatar: const Icon(Icons.play_arrow, size: 18), label: Text(tr('بدء التنفيذ', 'Start')), onPressed: _busy ? null : () => _run('in_progress')),
              ChoiceChip(selected: _act == 'resolve', avatar: const Icon(Icons.check, size: 18), label: Text(tr('إنجاز الطلب', 'Mark handled')), onSelected: (_) => setState(() => _act = 'resolve')),
              ChoiceChip(selected: _act == 'reject', avatar: const Icon(Icons.close, size: 18), label: Text(tr('رفض', 'Reject')), onSelected: (_) => setState(() => _act = 'reject')),
            ]),
            if (_act != null) ...[
              const SizedBox(height: 10),
              if (_act == 'forward') DropdownButtonFormField<String>(
                initialValue: _to, isExpanded: true,
                decoration: InputDecoration(labelText: tr('القسم الذي يُحوَّل إليه', 'Send to')),
                items: [for (final t in widget.targets) if (!('${r['stage']}' == 'department' && t['key'] == r['targetSection'])) DropdownMenuItem(value: '${t['key']}', child: Text(tr('${t['ar']}', '${t['en']}')))],
                onChanged: (v) => setState(() => _to = v),
              ),
              const SizedBox(height: 8),
              TextField(controller: _note, maxLines: 2, onChanged: (_) => setState(() {}),
                  decoration: InputDecoration(labelText: _act == 'reject' ? tr('سبب الرفض (يصل إلى الموظف)', 'Reason (sent to the employee)') : tr('ملاحظة (اختيارية، تصل إلى الموظف)', 'Note (optional)'))),
              const SizedBox(height: 10),
              FilledButton(
                onPressed: _busy || (_act == 'forward' && _to == null) || (_act == 'reject' && _note.text.trim().isEmpty) ? null : () => _run(_act!),
                child: Text(_act == 'forward' ? tr('تحويل', 'Forward') : _act == 'resolve' ? tr('تأكيد الإنجاز', 'Confirm') : tr('تأكيد الرفض', 'Reject')),
              ),
            ],
          ],
        ]),
      ),
    );
  }
}
