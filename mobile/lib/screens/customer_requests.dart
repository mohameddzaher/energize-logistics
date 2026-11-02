import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';

/// Customer requests: the portal side (customer) and the Operations customer-communication screen.
/// Mirrors web /system/portal/requests and /system/operations/customer-requests.

String _fmt(dynamic v) {
  final d = DateTime.tryParse('${v ?? ''}')?.toLocal();
  if (d == null) return '';
  String p(int n) => n.toString().padLeft(2, '0');
  return '${p(d.day)}/${p(d.month)}/${d.year} ${p(d.hour)}:${p(d.minute)}';
}

const _refAr = {'invoice': 'فاتورة', 'shipment': 'شحنة', 'date': 'تاريخ', 'other': 'مرجع'};
const _refEn = {'invoice': 'Invoice', 'shipment': 'Shipment', 'date': 'Date', 'other': 'Ref'};

(String, Color) _status(String s) => switch (s) {
      'answered' => (tr('تم الرد', 'Replied'), T.success),
      'closed' => (tr('مغلق', 'Closed'), T.inkFaint),
      _ => (tr('مفتوح', 'Open'), T.warn),
    };

Widget _thread(Map<String, dynamic> r, {required bool staffView}) {
  final items = List<Map<String, dynamic>>.from(r['items'] ?? []);
  final msgs = List<Map<String, dynamic>>.from(r['messages'] ?? []);
  return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
    for (final e in items.asMap().entries)
      Container(
        margin: const EdgeInsets.only(bottom: 6),
        padding: const EdgeInsets.all(10),
        decoration: BoxDecoration(color: T.canvas, borderRadius: BorderRadius.circular(10)),
        child: Text('${e.key + 1}. ${e.value['text'] ?? ''}${'${e.value['ref'] ?? ''}'.isEmpty ? '' : '  [${tr(_refAr[e.value['refType']] ?? 'مرجع', _refEn[e.value['refType']] ?? 'Ref')}: ${e.value['ref']}]'}',
            style: const TextStyle(fontSize: 13)),
      ),
    const SizedBox(height: 6),
    for (final m in msgs)
      Align(
        alignment: (m['side'] == 'staff') == staffView ? AlignmentDirectional.centerEnd : AlignmentDirectional.centerStart,
        child: Container(
          constraints: const BoxConstraints(maxWidth: 320),
          margin: const EdgeInsets.only(bottom: 8),
          padding: const EdgeInsets.all(10),
          decoration: BoxDecoration(
            color: m['side'] == 'staff' ? T.navy : Colors.white,
            borderRadius: BorderRadius.circular(14),
            border: m['side'] == 'staff' ? null : Border.all(color: T.line),
          ),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text('${m['byName'] ?? ''} · ${_fmt(m['at'])}${m['via'] == 'email' ? ' · ${tr('بالإيميل', 'by email')}' : ''}',
                style: TextStyle(fontSize: 10.5, color: m['side'] == 'staff' ? Colors.white70 : T.inkFaint)),
            const SizedBox(height: 3),
            Text('${m['text'] ?? ''}', style: TextStyle(fontSize: 13.5, color: m['side'] == 'staff' ? Colors.white : T.ink)),
          ]),
        ),
      ),
  ]);
}

// ── Portal: the customer's requests ─────────────────────────────────────────
class PortalRequestsTab extends StatefulWidget {
  const PortalRequestsTab({super.key});
  @override
  State<PortalRequestsTab> createState() => _PortalRequestsTabState();
}

class _PortalRequestsTabState extends State<PortalRequestsTab> {
  List<Map<String, dynamic>> _rows = [];
  bool _loading = true;
  late final void Function() _onLive = _load;

  @override
  void initState() {
    super.initState();
    _load();
    Live.instance.on('customer-requests:mine', _onLive);
  }

  @override
  void dispose() {
    Live.instance.off('customer-requests:mine', _onLive);
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final d = await Api.instance.get('/api/portal/requests');
      if (!mounted) return;
      setState(() { _rows = List<Map<String, dynamic>>.from(((d as Map)['items'] as List? ?? const []).map((e) => Map<String, dynamic>.from(e as Map))); _loading = false; });
    } catch (_) { if (mounted) setState(() => _loading = false); }
  }

  Future<void> _new() async {
    final ok = await Navigator.of(context).push<bool>(MaterialPageRoute(builder: (_) => const _NewRequestScreen()));
    if (ok == true) _load();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.transparent,
      floatingActionButton: FloatingActionButton.extended(onPressed: _new, icon: const Icon(Icons.add_comment_outlined), label: Text(tr('طلب جديد', 'New request'))),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : RefreshIndicator(
              onRefresh: _load,
              child: _rows.isEmpty
                  ? ListView(children: [EmptyState(icon: Icons.forum_outlined, title: tr('لا توجد طلبات بعد', 'No requests yet'))])
                  : ListView.separated(
                      padding: const EdgeInsets.fromLTRB(14, 14, 14, 90),
                      itemCount: _rows.length,
                      separatorBuilder: (_, __) => const SizedBox(height: 8),
                      itemBuilder: (c, i) {
                        final r = _rows[i];
                        final st = _status('${r['status']}');
                        return Pressable(
                          onTap: () async { await Navigator.of(context).push(MaterialPageRoute(builder: (_) => _RequestScreen(id: '${r['_id']}', staff: false))); _load(); },
                          child: AppCard(child: Row(children: [
                            Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                              Text('#${r['number']} · ${r['subject']}', style: const TextStyle(fontWeight: FontWeight.w800), maxLines: 1, overflow: TextOverflow.ellipsis),
                              Text(_fmt(r['lastActivityAt']), style: const TextStyle(fontSize: 11.5, color: T.inkFaint)),
                            ])),
                            if (r['unread'] == true) Container(width: 8, height: 8, margin: const EdgeInsets.symmetric(horizontal: 6), decoration: const BoxDecoration(color: T.orange, shape: BoxShape.circle)),
                            Chip2(st.$1, st.$2),
                          ])),
                        );
                      },
                    ),
            ),
    );
  }
}

class _NewRequestScreen extends StatefulWidget {
  const _NewRequestScreen();
  @override
  State<_NewRequestScreen> createState() => _NewRequestScreenState();
}

class _NewRequestScreenState extends State<_NewRequestScreen> {
  final _subject = TextEditingController();
  final _note = TextEditingController();
  final List<(TextEditingController, String, TextEditingController)> _items = [(TextEditingController(), '', TextEditingController())];
  bool _busy = false;

  @override
  void dispose() {
    _subject.dispose();
    _note.dispose();
    for (final x in _items) { x.$1.dispose(); x.$3.dispose(); }
    super.dispose();
  }

  Future<void> _send() async {
    if (_subject.text.trim().isEmpty) { ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(tr('اكتب الموضوع', 'Write a subject')))); return; }
    setState(() => _busy = true);
    try {
      await Api.instance.post('/api/portal/requests', {
        'subject': _subject.text.trim(),
        'message': _note.text.trim(),
        'items': [for (final x in _items) if (x.$1.text.trim().isNotEmpty || x.$3.text.trim().isNotEmpty) {'text': x.$1.text.trim(), 'refType': x.$2, 'ref': x.$3.text.trim()}],
      });
      if (mounted) Navigator.pop(context, true);
    } catch (e) {
      if (mounted) { setState(() => _busy = false); ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString()))); }
    }
  }

  @override
  Widget build(BuildContext context) {
    return AppScaffold(
      title: Text(tr('طلب جديد', 'New request')),
      body: ListView(padding: const EdgeInsets.all(14), children: [
        TextField(controller: _subject, decoration: InputDecoration(labelText: tr('الموضوع *', 'Subject *'))),
        const SizedBox(height: 12),
        for (final e in _items.asMap().entries) ...[
          AppCard(child: Column(children: [
            Row(children: [
              Text('${tr('نقطة', 'Point')} ${e.key + 1}', style: const TextStyle(fontWeight: FontWeight.w800, color: T.inkSoft)),
              const Spacer(),
              if (_items.length > 1) IconButton(icon: const Icon(Icons.delete_outline, color: T.danger, size: 20), onPressed: () => setState(() => _items.removeAt(e.key))),
            ]),
            TextField(controller: e.value.$1, maxLines: 2, decoration: InputDecoration(labelText: tr('ماذا تحتاج؟', 'What do you need?'))),
            const SizedBox(height: 8),
            Row(children: [
              Expanded(child: DropdownButtonFormField<String>(
                initialValue: e.value.$2, isExpanded: true,
                decoration: InputDecoration(labelText: tr('المرجع', 'Reference'), isDense: true),
                items: [
                  DropdownMenuItem(value: '', child: Text(tr('بدون', 'None'))),
                  DropdownMenuItem(value: 'invoice', child: Text(tr('فاتورة', 'Invoice'))),
                  DropdownMenuItem(value: 'shipment', child: Text(tr('شحنة', 'Shipment'))),
                  DropdownMenuItem(value: 'date', child: Text(tr('تاريخ', 'Date'))),
                  DropdownMenuItem(value: 'other', child: Text(tr('آخر', 'Other'))),
                ],
                onChanged: (v) => setState(() => _items[e.key] = (e.value.$1, v ?? '', e.value.$3)),
              )),
              const SizedBox(width: 8),
              if (e.value.$2.isNotEmpty)
                Expanded(child: TextField(
                  controller: e.value.$3,
                  readOnly: e.value.$2 == 'date',
                  onTap: e.value.$2 != 'date' ? null : () async {
                    final d = await showDatePicker(context: context, initialDate: DateTime.now(), firstDate: DateTime(2024), lastDate: DateTime(2030));
                    if (d != null) e.value.$3.text = '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';
                  },
                  decoration: InputDecoration(isDense: true, labelText: e.value.$2 == 'invoice' ? tr('رقم الفاتورة', 'Invoice no.') : e.value.$2 == 'shipment' ? tr('رقم الشحنة', 'Shipment no.') : e.value.$2 == 'date' ? tr('التاريخ', 'Date') : tr('المرجع', 'Reference')),
                )),
            ]),
          ])),
          const SizedBox(height: 8),
        ],
        Align(alignment: AlignmentDirectional.centerStart, child: TextButton.icon(
          onPressed: () => setState(() => _items.add((TextEditingController(), '', TextEditingController()))),
          icon: const Icon(Icons.add), label: Text(tr('أضف نقطة', 'Add a point')),
        )),
        TextField(controller: _note, maxLines: 3, decoration: InputDecoration(labelText: tr('رسالة (اختياري)', 'Message (optional)'))),
        const SizedBox(height: 14),
        FilledButton.icon(onPressed: _busy ? null : _send, icon: const Icon(Icons.send), label: Text(tr('إرسال الطلب', 'Send request'))),
      ]),
    );
  }
}

// ── One request (customer or Operations) ────────────────────────────────────
class _RequestScreen extends StatefulWidget {
  final String id;
  final bool staff;
  const _RequestScreen({required this.id, required this.staff});
  @override
  State<_RequestScreen> createState() => _RequestScreenState();
}

class _RequestScreenState extends State<_RequestScreen> {
  Map<String, dynamic>? _r;
  final _reply = TextEditingController();
  bool _busy = false;
  String get _base => widget.staff ? '/api/customer-requests/${widget.id}' : '/api/portal/requests/${widget.id}';

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() { _reply.dispose(); super.dispose(); }

  Future<void> _load() async {
    try {
      final d = await Api.instance.get(_base);
      if (mounted) setState(() => _r = Map<String, dynamic>.from((d as Map)['request'] as Map));
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    }
  }

  Future<void> _send() async {
    if (_reply.text.trim().isEmpty) return;
    setState(() => _busy = true);
    try {
      await Api.instance.post('$_base/reply', {'text': _reply.text.trim()});
      _reply.clear();
      await _load();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    }
    if (mounted) setState(() => _busy = false);
  }

  Future<void> _status(String s) async {
    try { await Api.instance.patch('$_base/status', {'status': s}); await _load(); } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    }
  }

  @override
  Widget build(BuildContext context) {
    final r = _r;
    return AppScaffold(
      title: Text(r == null ? '' : '#${r['number']}'),
      actions: [
        if (widget.staff && r != null) ...[
          IconButton(tooltip: tr('الرد بالإيميل', 'Reply by email'), icon: const Icon(Icons.mail_outline),
              onPressed: () async { final ok = await showModalBottomSheet<bool>(context: context, isScrollControlled: true, builder: (_) => _EmailSheet(req: r)); if (ok == true) _load(); }),
          IconButton(tooltip: r['status'] == 'closed' ? tr('إعادة فتح', 'Reopen') : tr('إغلاق', 'Close'),
              icon: Icon(r['status'] == 'closed' ? Icons.lock_open_outlined : Icons.lock_outline),
              onPressed: () => _status(r['status'] == 'closed' ? 'open' : 'closed')),
        ],
      ],
      body: r == null
          ? const Center(child: CircularProgressIndicator())
          : Column(children: [
              Expanded(child: ListView(padding: const EdgeInsets.all(14), children: [
                Text('${r['subject']}', style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 16)),
                if (widget.staff) Text('${r['customerName'] ?? ''} · ${r['accountEmail'] ?? ''}', style: const TextStyle(fontSize: 12, color: T.inkSoft)),
                const SizedBox(height: 10),
                _thread(r, staffView: widget.staff),
              ])),
              if (r['status'] != 'closed' || widget.staff)
                SafeArea(child: Padding(
                  padding: const EdgeInsets.fromLTRB(12, 4, 12, 8),
                  child: Row(children: [
                    Expanded(child: TextField(controller: _reply, minLines: 1, maxLines: 4, decoration: InputDecoration(hintText: widget.staff ? tr('رد داخل البوابة…', 'Reply in the portal…') : tr('اكتب رسالة…', 'Write a message…')))),
                    IconButton(onPressed: _busy ? null : _send, icon: const Icon(Icons.send, color: T.orange)),
                  ]),
                )),
            ]),
    );
  }
}

class _EmailSheet extends StatefulWidget {
  final Map<String, dynamic> req;
  const _EmailSheet({required this.req});
  @override
  State<_EmailSheet> createState() => _EmailSheetState();
}

class _EmailSheetState extends State<_EmailSheet> {
  List<Map<String, dynamic>> _boxes = [];
  String _from = '';
  late final _to = TextEditingController(text: '${widget.req['accountEmail'] ?? ''}');
  final _cc = TextEditingController();
  late final _subject = TextEditingController(text: 'Re: ${widget.req['subject']} (#${widget.req['number']})');
  final _text = TextEditingController();
  String _lang = 'en';
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    Api.instance.get('/api/customer-requests/mailboxes').then((d) {
      if (!mounted) return;
      final boxes = List<Map<String, dynamic>>.from(((d as Map)['mailboxes'] as List? ?? const []).map((e) => Map<String, dynamic>.from(e as Map)));
      final pref = '${d['preferred'] ?? ''}';
      setState(() { _boxes = boxes; _from = boxes.any((b) => b['email'] == pref) ? pref : (boxes.isEmpty ? '' : '${boxes.first['email']}'); });
    }).catchError((_) {});
  }

  @override
  void dispose() { _to.dispose(); _cc.dispose(); _subject.dispose(); _text.dispose(); super.dispose(); }

  Future<void> _send() async {
    setState(() => _busy = true);
    try {
      await Api.instance.post('/api/customer-requests/${widget.req['_id']}/email', {
        'from': _from, 'to': _to.text, 'cc': _cc.text, 'subject': _subject.text.trim(), 'text': _text.text.trim(), 'lang': _lang,
      });
      if (mounted) Navigator.pop(context, true);
    } catch (e) {
      if (mounted) { setState(() => _busy = false); ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString()))); }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.fromLTRB(16, 16, 16, MediaQuery.of(context).viewInsets.bottom + 16),
      child: SingleChildScrollView(child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, mainAxisSize: MainAxisSize.min, children: [
        Text(tr('الرد بالإيميل', 'Reply by email'), style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 16)),
        const SizedBox(height: 10),
        if (_boxes.isEmpty)
          Text(tr('لا يوجد صندوق بريد محفوظةٌ كلمةُ مروره (تقنية المعلومات ← إيميلات الشركة).', 'No company mailbox with a stored password (IT → Company emails).'), style: const TextStyle(color: T.warn))
        else
          DropdownButtonFormField<String>(
            initialValue: _from, isExpanded: true,
            decoration: InputDecoration(labelText: tr('من صندوق', 'From')),
            items: _boxes.map((b) => DropdownMenuItem(value: '${b['email']}', child: Text('${b['email']}', overflow: TextOverflow.ellipsis))).toList(),
            onChanged: (v) => setState(() => _from = v ?? ''),
          ),
        TextField(controller: _to, keyboardType: TextInputType.emailAddress, decoration: InputDecoration(labelText: tr('إلى (افصل بفاصلة)', 'To (comma-separated)'))),
        TextField(controller: _cc, keyboardType: TextInputType.emailAddress, decoration: InputDecoration(labelText: tr('نسخة CC (اختياري)', 'CC (optional)'))),
        TextField(controller: _subject, decoration: InputDecoration(labelText: tr('الموضوع', 'Subject'))),
        const SizedBox(height: 8),
        Wrap(spacing: 8, children: [
          ChoiceChip(label: const Text('English'), selected: _lang == 'en', onSelected: (_) => setState(() => _lang = 'en')),
          ChoiceChip(label: const Text('العربية'), selected: _lang == 'ar', onSelected: (_) => setState(() => _lang = 'ar')),
        ]),
        TextField(controller: _text, minLines: 5, maxLines: 10, textDirection: _lang == 'ar' ? TextDirection.rtl : TextDirection.ltr,
            decoration: InputDecoration(labelText: tr('الرسالة', 'Message'), helperText: tr('طلبُ العميل يُضاف تحت ردّك تلقائيًّا', 'The request is quoted under your reply'))),
        const SizedBox(height: 12),
        FilledButton.icon(onPressed: _busy || _from.isEmpty ? null : _send, icon: const Icon(Icons.send), label: Text(tr('إرسال', 'Send'))),
      ])),
    );
  }
}

// Operations: customer communication.
class CustomerRequestsScreen extends StatefulWidget {
  const CustomerRequestsScreen({super.key});
  @override
  State<CustomerRequestsScreen> createState() => _CustomerRequestsScreenState();
}

class _CustomerRequestsScreenState extends State<CustomerRequestsScreen> {
  List<Map<String, dynamic>> _rows = [];
  bool _loading = true;
  String _st = '';
  late final void Function() _onLive = _load;

  @override
  void initState() {
    super.initState();
    _load();
    Live.instance.on('customer-requests:changed', _onLive);
  }

  @override
  void dispose() {
    Live.instance.off('customer-requests:changed', _onLive);
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final d = await Api.instance.get('/api/customer-requests');
      if (!mounted) return;
      setState(() { _rows = List<Map<String, dynamic>>.from(((d as Map)['items'] as List? ?? const []).map((e) => Map<String, dynamic>.from(e as Map))); _loading = false; });
    } catch (_) { if (mounted) setState(() => _loading = false); }
  }

  @override
  Widget build(BuildContext context) {
    final list = _st.isEmpty ? _rows : _rows.where((r) => r['status'] == _st).toList();
    return AppScaffold(
      title: Text(tr('التواصل مع العملاء', 'Customer Communication')),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : Column(children: [
              SizedBox(height: 48, child: ListView(scrollDirection: Axis.horizontal, padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 6), children: [
                for (final s in ['', 'open', 'answered', 'closed'])
                  Padding(padding: const EdgeInsetsDirectional.only(end: 6), child: ChoiceChip(
                    label: Text(s.isEmpty ? '${tr('الكل', 'All')} (${_rows.length})' : '${_status(s).$1} (${_rows.where((r) => r['status'] == s).length})'),
                    selected: _st == s, onSelected: (_) => setState(() => _st = s),
                  )),
              ])),
              Expanded(child: RefreshIndicator(
                onRefresh: _load,
                child: list.isEmpty
                    ? ListView(children: [EmptyState(icon: Icons.forum_outlined, title: tr('لا توجد طلبات', 'No requests'))])
                    : ListView.separated(
                        padding: const EdgeInsets.all(14),
                        itemCount: list.length,
                        separatorBuilder: (_, __) => const SizedBox(height: 8),
                        itemBuilder: (c, i) {
                          final r = list[i];
                          final st = _status('${r['status']}');
                          return Pressable(
                            onTap: () async { await Navigator.of(context).push(MaterialPageRoute(builder: (_) => _RequestScreen(id: '${r['_id']}', staff: true))); _load(); },
                            child: AppCard(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                              Row(children: [
                                Text('#${r['number']}', style: const TextStyle(fontWeight: FontWeight.w900, color: T.navy)),
                                if (r['unreadStaff'] == true) Container(width: 8, height: 8, margin: const EdgeInsets.symmetric(horizontal: 6), decoration: const BoxDecoration(color: T.orange, shape: BoxShape.circle)),
                                const Spacer(),
                                Chip2(st.$1, st.$2),
                              ]),
                              Text('${r['subject']}', style: const TextStyle(fontWeight: FontWeight.w800), maxLines: 1, overflow: TextOverflow.ellipsis),
                              Text('${r['customerName'] ?? r['accountName'] ?? ''} · ${_fmt(r['lastActivityAt'])}', style: const TextStyle(fontSize: 11.5, color: T.inkFaint)),
                            ])),
                          );
                        },
                      ),
              )),
            ]),
    );
  }
}
