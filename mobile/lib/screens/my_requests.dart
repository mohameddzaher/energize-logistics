import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';

/// طلباتي — HR requests (salary certificate, letters, …): history + new request
/// + فتح الطلب لقراءة رد الموارد البشرية والرد عليه (نفس مسار الويب).
class MyRequestsScreen extends StatefulWidget {
  const MyRequestsScreen({super.key});
  @override
  State<MyRequestsScreen> createState() => _MyRequestsScreenState();
}

const _categories = [
  ('salary_certificate', 'تعريف بالراتب', 'Salary certificate'),
  ('letter', 'خطاب رسمي', 'Official letter'),
  ('document', 'مستند', 'Document'),
  ('data_update', 'تحديث بيانات', 'Data update'),
  ('complaint', 'شكوى', 'Complaint'),
  ('other', 'أخرى', 'Other'),
];

const _reqStatus = {
  'open': ('مفتوح', 'Open', Color(0xFFD97706)),
  'in_progress': ('قيد التنفيذ', 'In progress', Color(0xFF2563EB)),
  'received': ('تم الاستلام', 'Received', Color(0xFF7C3AED)),
  'resolved': ('تم التسليم', 'Delivered', Color(0xFF059669)),
  'closed': ('مغلق', 'Closed', Color(0xFF64748B)),
};

String _catLabel(String? key) {
  final c = _categories.firstWhere((x) => x.$1 == key, orElse: () => _categories.last);
  return tr(c.$2, c.$3);
}

String _fmtDate(dynamic v) {
  final s = (v ?? '').toString();
  final d = DateTime.tryParse(s);
  if (d == null) return '';
  final l = d.toLocal();
  String two(int n) => n.toString().padLeft(2, '0');
  return '${two(l.day)}/${two(l.month)} ${two(l.hour)}:${two(l.minute)}';
}

class _MyRequestsScreenState extends State<MyRequestsScreen> {
  List<Map<String, dynamic>> _requests = [];
  bool _loading = true;
  String? _error;
  String _filter = ''; // '' = الكل
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
      final d = await Api.instance.get('/api/hr/me/requests');
      if (!mounted) return;
      setState(() {
        _requests = List<Map<String, dynamic>>.from(d['requests'] ?? []);
        _loading = false;
        _error = null;
      });
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  void _newRequest() {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (c) => _NewRequestSheet(onDone: _load),
    );
  }

  void _open(Map<String, dynamic> r) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (c) => _RequestThreadSheet(requestId: (r['_id'] ?? '').toString(), onChanged: _load),
    );
  }

  int _countFor(String status) => status.isEmpty
      ? _requests.length
      : _requests.where((r) => (r['status'] ?? '').toString() == status).length;

  @override
  Widget build(BuildContext context) {
    final list = _filter.isEmpty
        ? _requests
        : _requests.where((r) => (r['status'] ?? '').toString() == _filter).toList();

    return AppScaffold(
      title: Text(tr('طلباتي', 'My Requests')),
      appBarBottom: (!_loading && _error == null && _requests.isNotEmpty)
          ? PreferredSize(
              preferredSize: const Size.fromHeight(46),
              child: SizedBox(
                height: 46,
                child: ListView(
                  scrollDirection: Axis.horizontal,
                  padding: const EdgeInsets.fromLTRB(12, 4, 12, 8),
                  children: [
                    _Chip(tr('الكل', 'All'), _countFor(''), _filter.isEmpty, () => setState(() => _filter = '')),
                    for (final e in _reqStatus.entries)
                      Padding(
                        padding: const EdgeInsets.only(right: 6),
                        child: _Chip(tr(e.value.$1, e.value.$2), _countFor(e.key), _filter == e.key,
                            () => setState(() => _filter = _filter == e.key ? '' : e.key), e.value.$3),
                      ),
                  ],
                ),
              ),
            )
          : null,
      floatingActionButton: FloatingActionButton.extended(
        backgroundColor: T.navy,
        foregroundColor: Colors.white,
        onPressed: _newRequest,
        icon: const Icon(Icons.add),
        label: Text(tr('طلب جديد', 'New request')),
      ),
      body: _loading
          ? ListView(padding: const EdgeInsets.all(14), children: const [
              Shimmer(height: 76), SizedBox(height: 10), Shimmer(height: 76), SizedBox(height: 10), Shimmer(height: 76),
            ])
          : _error != null
              ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
              : RefreshIndicator(
                  onRefresh: _load,
                  child: list.isEmpty
                      ? ListView(children: [
                          const SizedBox(height: 80),
                          EmptyState(icon: Icons.assignment_outlined, title: tr('لا توجد طلبات', 'No requests')),
                        ])
                      : ListView.separated(
                          padding: const EdgeInsets.fromLTRB(14, 8, 14, 90),
                          itemCount: list.length,
                          separatorBuilder: (_, __) => const SizedBox(height: 10),
                          itemBuilder: (c, i) {
                            final r = list[i];
                            final st = _reqStatus[r['status']] ?? ('—', '—', const Color(0xFF64748B));
                            final thread = List<Map<String, dynamic>>.from(r['thread'] ?? []);
                            final unread = r['readByRequester'] == false;
                            return FadeSlideIn(
                              delayMs: (i * 18).clamp(0, 180),
                              child: Pressable(
                                onTap: () => _open(r),
                                child: AppCard(
                                  child: Column(
                                    crossAxisAlignment: CrossAxisAlignment.start,
                                    children: [
                                      Row(children: [
                                        Expanded(child: Text(r['subject'] ?? '', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14))),
                                        if (unread)
                                          Container(
                                            margin: const EdgeInsets.only(left: 6),
                                            padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
                                            decoration: BoxDecoration(color: T.danger, borderRadius: BorderRadius.circular(10)),
                                            child: Text(tr('رد جديد', 'New reply'), style: const TextStyle(color: Colors.white, fontSize: 10, fontWeight: FontWeight.w800)),
                                          ),
                                        Chip2(tr(st.$1, st.$2), st.$3),
                                      ]),
                                      const SizedBox(height: 4),
                                      Row(children: [
                                        Text(_catLabel(r['category']), style: const TextStyle(fontSize: 12, color: T.inkSoft)),
                                        const Spacer(),
                                        if (thread.isNotEmpty) ...[
                                          const Icon(Icons.forum_outlined, size: 13, color: T.inkFaint),
                                          const SizedBox(width: 3),
                                          Text('${thread.length}', style: const TextStyle(fontSize: 12, color: T.inkFaint)),
                                        ],
                                        const SizedBox(width: 8),
                                        Icon(Lang.instance.ar ? Icons.chevron_left : Icons.chevron_right, size: 17, color: T.inkFaint),
                                      ]),
                                      if (thread.isNotEmpty) ...[
                                        const SizedBox(height: 6),
                                        Text('${tr('آخر رسالة', 'Latest')}: ${thread.last['body'] ?? ''}',
                                            maxLines: 1, overflow: TextOverflow.ellipsis,
                                            style: const TextStyle(fontSize: 12, color: T.inkSoft)),
                                      ],
                                    ],
                                  ),
                                ),
                              ),
                            );
                          },
                        ),
                ),
    );
  }
}

/// شيت المحادثة: كامل الـ thread + مربع رد (نفس endpoint الويب: /requests/:id/reply).
class _RequestThreadSheet extends StatefulWidget {
  final String requestId;
  final Future<void> Function() onChanged;
  const _RequestThreadSheet({required this.requestId, required this.onChanged});
  @override
  State<_RequestThreadSheet> createState() => _RequestThreadSheetState();
}

class _RequestThreadSheetState extends State<_RequestThreadSheet> {
  Map<String, dynamic>? _r;
  bool _loading = true;
  bool _sending = false;
  final _reply = TextEditingController();

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _reply.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      // نجلب القائمة ونلتقط الطلب المطلوب (لا يوجد endpoint مفرد للموظف).
      final d = await Api.instance.get('/api/hr/me/requests');
      final all = List<Map<String, dynamic>>.from(d['requests'] ?? []);
      final found = all.firstWhere((x) => (x['_id'] ?? '').toString() == widget.requestId, orElse: () => {});
      if (!mounted) return;
      setState(() { _r = found.isEmpty ? null : found; _loading = false; });
    } catch (e) {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _send() async {
    final text = _reply.text.trim();
    if (text.isEmpty || _sending) return;
    setState(() => _sending = true);
    try {
      await Api.instance.post('/api/hr/requests/${widget.requestId}/reply', {'body': text});
      _reply.clear();
      await _load();
      await widget.onChanged();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  String _senderName(dynamic sender) {
    if (sender is Map) {
      final ar = (sender['arabicName'] ?? '').toString();
      if (ar.isNotEmpty) return ar;
      final n = '${sender['firstName'] ?? ''} ${sender['lastName'] ?? ''}'.trim();
      if (n.isNotEmpty) return n;
    }
    return tr('الموارد البشرية', 'HR');
  }

  @override
  Widget build(BuildContext context) {
    final r = _r;
    final thread = List<Map<String, dynamic>>.from(r?['thread'] ?? []);
    final st = _reqStatus[r?['status']] ?? ('—', '—', const Color(0xFF64748B));
    final closed = (r?['status'] == 'closed');
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
      child: DraggableScrollableSheet(
        expand: false,
        initialChildSize: 0.85,
        maxChildSize: 0.95,
        builder: (c, scroll) => _loading
            ? const SizedBox(height: 260, child: Center(child: CircularProgressIndicator()))
            : r == null
                ? SizedBox(height: 220, child: EmptyState(icon: Icons.error_outline, title: tr('تعذّر فتح الطلب', 'Could not open request')))
                : Column(
                    children: [
                      Expanded(
                        child: ListView(
                          controller: scroll,
                          padding: const EdgeInsets.fromLTRB(18, 16, 18, 8),
                          children: [
                            Row(children: [
                              Expanded(child: Text(r['subject'] ?? '', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 17))),
                              Chip2(tr(st.$1, st.$2), st.$3),
                            ]),
                            const SizedBox(height: 4),
                            Text(_catLabel(r['category']), style: const TextStyle(fontSize: 12.5, color: T.inkSoft)),
                            if ((r['body'] ?? '').toString().isNotEmpty) ...[
                              const SizedBox(height: 10),
                              AppCard(child: Text(r['body'].toString(), style: const TextStyle(fontSize: 13.5, height: 1.4))),
                            ],
                            const Divider(height: 26),
                            Text(tr('المحادثة', 'Conversation'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13.5, color: T.inkSoft)),
                            const SizedBox(height: 8),
                            if (thread.isEmpty)
                              Padding(
                                padding: const EdgeInsets.symmetric(vertical: 14),
                                child: Text(tr('لا توجد ردود بعد — سيظهر رد الموارد البشرية هنا.', 'No replies yet — HR responses will appear here.'),
                                    style: const TextStyle(color: T.inkFaint, fontSize: 12.5)),
                              ),
                            ...thread.map((m) {
                              final fromHR = m['sender'] is! Map ||
                                  ((m['sender'] as Map)['role'] ?? '').toString().contains('hr') ||
                                  (m['fromHR'] == true);
                              return Align(
                                alignment: fromHR ? AlignmentDirectional.centerStart : AlignmentDirectional.centerEnd,
                                child: Container(
                                  margin: const EdgeInsets.symmetric(vertical: 4),
                                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
                                  constraints: BoxConstraints(maxWidth: MediaQuery.of(c).size.width * 0.72),
                                  decoration: BoxDecoration(
                                    color: fromHR ? T.navy.withValues(alpha: 0.07) : T.success.withValues(alpha: 0.10),
                                    borderRadius: BorderRadius.circular(12),
                                  ),
                                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                    Text(_senderName(m['sender']), style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w800, color: T.inkSoft)),
                                    const SizedBox(height: 2),
                                    if ((m['body'] ?? '').toString().isNotEmpty)
                                      Text(m['body'].toString(), style: const TextStyle(fontSize: 13.5, height: 1.35)),
                                    if ((m['link'] ?? '').toString().isNotEmpty)
                                      Padding(
                                        padding: const EdgeInsets.only(top: 4),
                                        child: Text(m['link'].toString(), style: const TextStyle(fontSize: 12, color: T.info, decoration: TextDecoration.underline)),
                                      ),
                                    const SizedBox(height: 3),
                                    Text(_fmtDate(m['createdAt']), style: const TextStyle(fontSize: 10, color: T.inkFaint)),
                                  ]),
                                ),
                              );
                            }),
                          ],
                        ),
                      ),
                      if (!closed)
                        Padding(
                          padding: const EdgeInsets.fromLTRB(12, 6, 12, 12),
                          child: Row(children: [
                            Expanded(
                              child: TextField(
                                controller: _reply,
                                minLines: 1,
                                maxLines: 4,
                                decoration: InputDecoration(
                                  hintText: tr('اكتب ردًا…', 'Write a reply…'),
                                  contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                                ),
                              ),
                            ),
                            const SizedBox(width: 8),
                            FilledButton(
                              onPressed: _sending ? null : _send,
                              style: FilledButton.styleFrom(backgroundColor: T.navy, minimumSize: const Size(52, 48)),
                              child: _sending
                                  ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                                  : const Icon(Icons.send_rounded, size: 20),
                            ),
                          ]),
                        ),
                    ],
                  ),
      ),
    );
  }
}

class _Chip extends StatelessWidget {
  final String label;
  final int count;
  final bool selected;
  final VoidCallback onTap;
  final Color? color;
  const _Chip(this.label, this.count, this.selected, this.onTap, [this.color]);
  @override
  Widget build(BuildContext context) {
    final c = color ?? T.navy;
    return Material(
      color: selected ? c : c.withValues(alpha: 0.06),
      borderRadius: BorderRadius.circular(20),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(20),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 13, vertical: 8),
          child: Row(mainAxisSize: MainAxisSize.min, children: [
            Text(label, style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700, color: selected ? Colors.white : T.ink)),
            const SizedBox(width: 5),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
              decoration: BoxDecoration(
                color: selected ? Colors.white.withValues(alpha: 0.25) : c.withValues(alpha: 0.12),
                borderRadius: BorderRadius.circular(9),
              ),
              child: Text('$count', style: TextStyle(fontSize: 11, fontWeight: FontWeight.w800, color: selected ? Colors.white : c)),
            ),
          ]),
        ),
      ),
    );
  }
}

class _NewRequestSheet extends StatefulWidget {
  final Future<void> Function() onDone;
  const _NewRequestSheet({required this.onDone});
  @override
  State<_NewRequestSheet> createState() => _NewRequestSheetState();
}

class _NewRequestSheetState extends State<_NewRequestSheet> {
  String _category = 'salary_certificate';
  final _subject = TextEditingController();
  final _body = TextEditingController();
  bool _busy = false;

  @override
  void dispose() {
    _subject.dispose();
    _body.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    if (_subject.text.trim().isEmpty || _busy) return;
    setState(() => _busy = true);
    try {
      await Api.instance.post('/api/hr/me/requests', {
        'category': _category,
        'subject': _subject.text,
        'body': _body.text,
      });
      widget.onDone();
      if (mounted) Navigator.pop(context);
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.fromLTRB(18, 18, 18, MediaQuery.of(context).viewInsets.bottom + 18),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(tr('طلب جديد', 'New request'), style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
          const SizedBox(height: 14),
          DropdownButtonFormField<String>(
            initialValue: _category,
            decoration: InputDecoration(labelText: tr('نوع الطلب', 'Request type')),
            items: _categories.map((c) => DropdownMenuItem(value: c.$1, child: Text(tr(c.$2, c.$3)))).toList(),
            onChanged: (v) => setState(() => _category = v ?? 'other'),
          ),
          const SizedBox(height: 10),
          TextField(controller: _subject, decoration: InputDecoration(labelText: tr('الموضوع *', 'Subject *'))),
          const SizedBox(height: 10),
          TextField(controller: _body, maxLines: 3, decoration: InputDecoration(labelText: tr('التفاصيل', 'Details'))),
          const SizedBox(height: 14),
          FilledButton(
            onPressed: _busy ? null : _save,
            child: _busy
                ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                : Text(tr('إرسال الطلب', 'Submit')),
          ),
        ],
      ),
    );
  }
}
