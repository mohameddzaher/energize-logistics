import 'package:flutter/material.dart';
import '../config.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../ui/app_scaffold.dart';
import '../services/live.dart';

/// طلباتي — HR requests (salary certificate, letters, …): history + new request.
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

class _MyRequestsScreenState extends State<MyRequestsScreen> {
  List<Map<String, dynamic>> _requests = [];
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

  String _catLabel(String? key) {
    final c = _categories.firstWhere((x) => x.$1 == key, orElse: () => _categories.last);
    return tr(c.$2, c.$3);
  }

  @override
  Widget build(BuildContext context) {
    return AppScaffold(
      title: Text(tr('طلباتي', 'My Requests')),
      floatingActionButton: FloatingActionButton.extended(
        backgroundColor: const Color(AppConfig.navy),
        foregroundColor: Colors.white,
        onPressed: _newRequest,
        icon: const Icon(Icons.add),
        label: Text(tr('طلب جديد', 'New request')),
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? Center(child: Column(mainAxisSize: MainAxisSize.min, children: [
                  Text(_error!, textAlign: TextAlign.center),
                  TextButton(onPressed: _load, child: Text(tr('إعادة المحاولة', 'Retry'))),
                ]))
              : RefreshIndicator(
                  onRefresh: _load,
                  child: _requests.isEmpty
                      ? ListView(children: [
                          Padding(
                            padding: const EdgeInsets.only(top: 100),
                            child: Center(child: Text(tr('لا توجد طلبات بعد', 'No requests yet'), style: const TextStyle(color: Color(0xFF94A3B8)))),
                          ),
                        ])
                      : ListView.separated(
                          padding: const EdgeInsets.all(14),
                          itemCount: _requests.length,
                          separatorBuilder: (_, __) => const SizedBox(height: 10),
                          itemBuilder: (c, i) {
                            final r = _requests[i];
                            final st = _reqStatus[r['status']] ?? ('—', '—', const Color(0xFF64748B));
                            return Container(
                              padding: const EdgeInsets.all(14),
                              decoration: BoxDecoration(
                                color: Colors.white,
                                borderRadius: BorderRadius.circular(14),
                                border: Border.all(color: const Color(0xFFE2E8F0)),
                              ),
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Row(children: [
                                    Expanded(child: Text(r['subject'] ?? '', style: const TextStyle(fontWeight: FontWeight.bold))),
                                    Container(
                                      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                                      decoration: BoxDecoration(color: st.$3.withValues(alpha: 0.1), borderRadius: BorderRadius.circular(20)),
                                      child: Text(tr(st.$1, st.$2), style: TextStyle(color: st.$3, fontSize: 12, fontWeight: FontWeight.bold)),
                                    ),
                                  ]),
                                  const SizedBox(height: 4),
                                  Text(_catLabel(r['category']), style: const TextStyle(fontSize: 12, color: Color(0xFF64748B))),
                                ],
                              ),
                            );
                          },
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
