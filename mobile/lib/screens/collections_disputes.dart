import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';

/// التحصيلات والنزاعات — متابعات التحصيل المعلّقة (إنهاء/تأجيل) وسجل النزاعات
/// على الفواتير (فتح/مراجعة/حل).

String _money(dynamic v) {
  final n = (v is num) ? v : num.tryParse(v?.toString() ?? '') ?? 0;
  return n.toStringAsFixed(0).replaceAllMapped(RegExp(r'\B(?=(\d{3})+(?!\d))'), (m) => ',');
}

String _customerName(dynamic c) => c is Map ? (c['companyName'] ?? '—').toString() : '—';
String _d(dynamic v) {
  final d = v != null ? DateTime.tryParse(v.toString())?.toLocal() : null;
  return d == null ? (v ?? '—').toString() : '${d.day}/${d.month}/${d.year}';
}

String _foldAr(String s) => s.replaceAll(RegExp('[أإآ]'), 'ا').replaceAll('ى', 'ي').replaceAll('ة', 'ه').toLowerCase();

/// منتقي بحث عام: يجلب من endpoint ويعرض قائمة قابلة للبحث، يرجّع العنصر المختار.
Future<Map<String, dynamic>?> pickFromApi(BuildContext context, {
  required String endpoint,
  required String listKey,
  required String Function(Map<String, dynamic>) label,
  required String title,
}) {
  return showModalBottomSheet<Map<String, dynamic>>(
    context: context,
    isScrollControlled: true,
    backgroundColor: Colors.white,
    shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
    builder: (c) => _ApiPicker(endpoint: endpoint, listKey: listKey, label: label, title: title),
  );
}

class _ApiPicker extends StatefulWidget {
  final String endpoint, listKey, title;
  final String Function(Map<String, dynamic>) label;
  const _ApiPicker({required this.endpoint, required this.listKey, required this.label, required this.title});
  @override
  State<_ApiPicker> createState() => _ApiPickerState();
}

class _ApiPickerState extends State<_ApiPicker> {
  List<Map<String, dynamic>> _rows = [];
  bool _loading = true;
  String? _error;
  String _q = '';

  @override
  void initState() { super.initState(); _load(); }

  Future<void> _load() async {
    try {
      final sep = widget.endpoint.contains('?') ? '&' : '?';
      final d = await Api.instance.get('${widget.endpoint}${sep}limit=200');
      final raw = d is Map ? d[widget.listKey] : d;
      if (!mounted) return;
      setState(() { _rows = raw is List ? List<Map<String, dynamic>>.from(raw.whereType<Map>().map((e) => Map<String, dynamic>.from(e))) : []; _loading = false; });
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  @override
  Widget build(BuildContext context) {
    final q = _foldAr(_q.trim());
    final filtered = _rows.where((r) => q.isEmpty || _foldAr(widget.label(r)).contains(q)).toList();
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
      child: DraggableScrollableSheet(
        expand: false,
        initialChildSize: 0.7,
        maxChildSize: 0.92,
        builder: (c, scroll) => Column(children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(14, 14, 14, 6),
            child: TextField(
              autofocus: true,
              onChanged: (v) => setState(() => _q = v),
              decoration: InputDecoration(hintText: '${widget.title}…', prefixIcon: const Icon(Icons.search)),
            ),
          ),
          Expanded(
            child: _loading
                ? const Center(child: CircularProgressIndicator())
                : _error != null
                    ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
                    : filtered.isEmpty
                        ? EmptyState(icon: Icons.search_off_rounded, title: tr('لا نتائج', 'No results'))
                        : ListView.builder(
                            controller: scroll,
                            padding: const EdgeInsets.fromLTRB(8, 6, 8, 20),
                            itemCount: filtered.length,
                            itemBuilder: (c2, i) => ListTile(
                              title: Text(widget.label(filtered[i]), style: const TextStyle(fontSize: 14)),
                              onTap: () => Navigator.pop(c, filtered[i]),
                            ),
                          ),
          ),
        ]),
      ),
    );
  }
}

// ── متابعات التحصيل ─────────────────────────────────────────────────────────
class CollectionsScreen extends StatefulWidget {
  const CollectionsScreen({super.key});
  @override
  State<CollectionsScreen> createState() => _CollectionsScreenState();
}

const _actTypes = {
  'call': ('مكالمة', 'Call'),
  'email': ('بريد', 'Email'),
  'visit': ('زيارة', 'Visit'),
  'promise': ('وعد بالدفع', 'Promise'),
  'follow_up': ('متابعة', 'Follow-up'),
  'note': ('ملاحظة', 'Note'),
  'whatsapp': ('واتساب', 'WhatsApp'),
};

class _CollectionsScreenState extends State<CollectionsScreen> {
  List<Map<String, dynamic>> _rows = [];
  bool _loading = true;
  String? _error;
  late final void Function() _onLive;

  @override
  void initState() {
    super.initState();
    _load();
    _onLive = () => _load();
    Live.instance.on('collection:updated', _onLive);
    Live.instance.on('collection:logged', _onLive);
  }

  @override
  void dispose() {
    Live.instance.off('collection:updated', _onLive);
    Live.instance.off('collection:logged', _onLive);
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final d = await Api.instance.get('/api/collections/follow-ups');
      if (!mounted) return;
      setState(() { _rows = List<Map<String, dynamic>>.from(d['followUps'] ?? []); _loading = false; _error = null; });
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  Future<void> _complete(Map<String, dynamic> f) async {
    final amount = TextEditingController();
    final notes = TextEditingController();
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: Text(tr('إنهاء المتابعة', 'Complete follow-up')),
        content: Column(mainAxisSize: MainAxisSize.min, children: [
          TextField(controller: amount, keyboardType: TextInputType.number, decoration: InputDecoration(labelText: tr('المبلغ المحصّل (اختياري)', 'Amount collected (optional)'))),
          const SizedBox(height: 10),
          TextField(controller: notes, decoration: InputDecoration(labelText: tr('ملاحظات', 'Notes'))),
        ]),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: Text(tr('إلغاء', 'Cancel'))),
          FilledButton(onPressed: () => Navigator.pop(c, true), child: Text(tr('إنهاء', 'Complete'))),
        ],
      ),
    );
    if (ok != true) return;
    try {
      await Api.instance.put('/api/collections/${f['_id']}/complete', {
        if (amount.text.trim().isNotEmpty) 'amountCollected': num.tryParse(amount.text),
        if (notes.text.trim().isNotEmpty) 'notes': notes.text.trim(),
      });
      _load();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    }
  }

  // تسجيل متابعة تحصيل جديدة: اختيار العميل + النوع + الملاحظات (+ مبلغ محصّل).
  Future<void> _logActivity() async {
    final customer = await pickFromApi(context,
        endpoint: '/api/customers', listKey: 'customers',
        label: (r) => (r['companyName'] ?? '').toString(), title: tr('اختر العميل', 'Pick customer'));
    if (customer == null || !mounted) return;
    String type = 'call';
    final notes = TextEditingController();
    final amount = TextEditingController();
    const types = [
      ('call', 'مكالمة', 'Call'), ('visit', 'زيارة', 'Visit'), ('email', 'بريد', 'Email'),
      ('whatsapp', 'واتساب', 'WhatsApp'), ('promise', 'وعد بالدفع', 'Promise'),
      ('follow_up', 'متابعة', 'Follow up'), ('note', 'ملاحظة', 'Note'),
    ];
    final ok = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (c) => StatefulBuilder(builder: (c, setS) => Padding(
        padding: EdgeInsets.fromLTRB(18, 18, 18, MediaQuery.of(c).viewInsets.bottom + 18),
        child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text('${tr('متابعة تحصيل', 'Collection activity')} — ${customer['companyName'] ?? ''}', style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w800)),
          const SizedBox(height: 12),
          DropdownButtonFormField<String>(
            initialValue: type,
            decoration: InputDecoration(labelText: tr('النوع', 'Type')),
            items: types.map((t) => DropdownMenuItem(value: t.$1, child: Text(tr(t.$2, t.$3)))).toList(),
            onChanged: (v) => setS(() => type = v ?? type),
          ),
          const SizedBox(height: 10),
          TextField(controller: notes, maxLines: 2, decoration: InputDecoration(labelText: tr('الملاحظات *', 'Notes *'))),
          const SizedBox(height: 10),
          TextField(controller: amount, keyboardType: TextInputType.number, decoration: InputDecoration(labelText: tr('المبلغ المحصّل (اختياري)', 'Amount collected (optional)'))),
          const SizedBox(height: 14),
          SizedBox(width: double.infinity, child: FilledButton(onPressed: () => Navigator.pop(c, true), child: Text(tr('تسجيل', 'Log')))),
        ]),
      )),
    );
    if (ok != true) return;
    if (notes.text.trim().isEmpty) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(tr('الملاحظات مطلوبة', 'Notes required'))));
      return;
    }
    try {
      await Api.instance.post('/api/collections', {
        'customer': customer['_id'],
        'type': type,
        'notes': notes.text.trim(),
        if (amount.text.trim().isNotEmpty) 'amountCollected': num.tryParse(amount.text.trim()),
      });
      _load();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    }
  }

  @override
  Widget build(BuildContext context) {
    return AppScaffold(
      title: Text(tr('متابعات التحصيل', 'Collection follow-ups')),
      floatingActionButton: FloatingActionButton.extended(
        backgroundColor: T.navy, foregroundColor: Colors.white,
        onPressed: _logActivity,
        icon: const Icon(Icons.add), label: Text(tr('متابعة', 'Log')),
      ),
      body: _loading
          ? ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(), SizedBox(height: 10), Shimmer(), SizedBox(height: 10), Shimmer()])
          : _error != null
              ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
              : RefreshIndicator(
                  onRefresh: _load,
                  child: _rows.isEmpty
                      ? ListView(children: [const SizedBox(height: 80), EmptyState(icon: Icons.task_alt_outlined, title: tr('لا توجد متابعات معلّقة 👌', 'No pending follow-ups 👌'))])
                      : ListView.separated(
                          padding: const EdgeInsets.all(14),
                          itemCount: _rows.length,
                          separatorBuilder: (_, __) => const SizedBox(height: 8),
                          itemBuilder: (c, i) {
                            final f = _rows[i];
                            final ty = _actTypes[f['type']] ?? ('—', '—');
                            final due = DateTime.tryParse((f['followUpDate'] ?? f['nextFollowUpDate'] ?? '').toString());
                            final overdue = due != null && due.isBefore(DateTime.now());
                            return FadeSlideIn(
                              delayMs: (i * 12).clamp(0, 120),
                              child: AppCard(
                                topAccent: overdue ? T.danger : T.warn,
                                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                  Row(children: [
                                    Expanded(child: Text(_customerName(f['customer']), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13.5))),
                                    Chip2(tr(ty.$1, ty.$2), T.navy),
                                  ]),
                                  const SizedBox(height: 5),
                                  Wrap(spacing: 6, runSpacing: 6, children: [
                                    if (f['invoice'] is Map) Chip2('${f['invoice']['invoiceNumber'] ?? ''} · ${_money(f['invoice']['balance'] ?? f['invoice']['amount'])}', T.info),
                                    if (due != null) Chip2('${tr('الموعد', 'Due')}: ${_d(due.toIso8601String())}', overdue ? T.danger : T.warn, icon: Icons.event),
                                    if (f['promiseAmount'] != null) Chip2('${tr('وعد', 'Promise')}: ${_money(f['promiseAmount'])}', T.violet),
                                  ]),
                                  if ((f['notes'] ?? '').toString().isNotEmpty) ...[
                                    const SizedBox(height: 5),
                                    Text(f['notes'], style: const TextStyle(fontSize: 12, color: T.inkSoft)),
                                  ],
                                  const SizedBox(height: 6),
                                  Align(
                                    alignment: AlignmentDirectional.centerEnd,
                                    child: FilledButton.tonalIcon(
                                      onPressed: () => _complete(f),
                                      icon: const Icon(Icons.check, size: 17),
                                      label: Text(tr('إنهاء', 'Complete'), style: const TextStyle(fontSize: 12.5)),
                                    ),
                                  ),
                                ]),
                              ),
                            );
                          },
                        ),
                ),
    );
  }
}

// ── النزاعات ────────────────────────────────────────────────────────────────
class DisputesScreen extends StatefulWidget {
  const DisputesScreen({super.key});
  @override
  State<DisputesScreen> createState() => _DisputesScreenState();
}

const _disputeStatus = {
  'open': ('مفتوح', 'Open', T.warn),
  'under_review': ('قيد المراجعة', 'Under review', T.info),
  'resolved': ('محلول', 'Resolved', T.success),
};

class _DisputesScreenState extends State<DisputesScreen> {
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
    Live.instance.on('dispute:updated', _onLive);
    Live.instance.on('dispute:opened', _onLive);
  }

  @override
  void dispose() {
    Live.instance.off('dispute:updated', _onLive);
    Live.instance.off('dispute:opened', _onLive);
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final qs = _status.isEmpty ? '' : '?status=$_status';
      final d = await Api.instance.get('/api/disputes$qs');
      if (!mounted) return;
      setState(() { _rows = List<Map<String, dynamic>>.from(d['disputes'] ?? []); _loading = false; _error = null; });
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  Future<void> _update(Map<String, dynamic> disp, String status) async {
    final resolution = TextEditingController();
    final needsResolution = status == 'resolved';
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: Text(status == 'resolved' ? tr('حل النزاع', 'Resolve dispute') : tr('بدء المراجعة', 'Start review')),
        content: needsResolution
            ? TextField(controller: resolution, maxLines: 2, decoration: InputDecoration(labelText: tr('القرار / الحل', 'Resolution')))
            : Text(tr('نقل النزاع إلى قيد المراجعة؟', 'Move to under review?')),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: Text(tr('إلغاء', 'Cancel'))),
          FilledButton(onPressed: () => Navigator.pop(c, true), child: Text(tr('تأكيد', 'Confirm'))),
        ],
      ),
    );
    if (ok != true) return;
    try {
      await Api.instance.put('/api/disputes/${disp['_id']}', {
        'status': status,
        if (needsResolution && resolution.text.trim().isNotEmpty) 'resolution': resolution.text.trim(),
      });
      _load();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    }
  }

  // فتح نزاع جديد على فاتورة: اختيار الفاتورة + سبب النزاع.
  Future<void> _openDispute() async {
    final invoice = await pickFromApi(context,
        endpoint: '/api/invoices', listKey: 'invoices',
        label: (r) => '${r['invoiceNumber'] ?? ''} · ${_customerName(r['customer'])}', title: tr('اختر الفاتورة', 'Pick invoice'));
    if (invoice == null || !mounted) return;
    final reason = TextEditingController();
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: Text('${tr('فتح نزاع', 'Open dispute')} — ${invoice['invoiceNumber'] ?? ''}'),
        content: TextField(controller: reason, autofocus: true, maxLines: 2, decoration: InputDecoration(labelText: tr('سبب النزاع *', 'Reason *'))),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: Text(tr('إلغاء', 'Cancel'))),
          FilledButton(onPressed: () => Navigator.pop(c, true), child: Text(tr('فتح', 'Open'))),
        ],
      ),
    );
    if (ok != true || reason.text.trim().isEmpty) return;
    try {
      await Api.instance.post('/api/disputes', {'invoice': invoice['_id'], 'reason': reason.text.trim()});
      _load();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    }
  }

  @override
  Widget build(BuildContext context) {
    return AppScaffold(
      title: Text(tr('النزاعات', 'Disputes')),
      floatingActionButton: FloatingActionButton.extended(
        backgroundColor: T.navy, foregroundColor: Colors.white,
        onPressed: _openDispute,
        icon: const Icon(Icons.add), label: Text(tr('نزاع', 'Dispute')),
      ),
      body: _loading
          ? ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(height: 48), SizedBox(height: 10), Shimmer(), SizedBox(height: 10), Shimmer()])
          : _error != null
              ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
              : Column(children: [
                  Padding(
                    padding: const EdgeInsets.fromLTRB(14, 10, 14, 4),
                    child: Row(
                      children: _disputeStatus.entries.map((e) {
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
                  Expanded(
                    child: RefreshIndicator(
                      onRefresh: _load,
                      child: _rows.isEmpty
                          ? ListView(children: [const SizedBox(height: 80), EmptyState(icon: Icons.gavel_outlined, title: tr('لا توجد نزاعات', 'No disputes'))])
                          : ListView.separated(
                              padding: const EdgeInsets.all(14),
                              itemCount: _rows.length,
                              separatorBuilder: (_, __) => const SizedBox(height: 8),
                              itemBuilder: (c, i) {
                                final disp = _rows[i];
                                final st = _disputeStatus[disp['status']] ?? ('—', '—', T.inkFaint);
                                return FadeSlideIn(
                                  delayMs: (i * 12).clamp(0, 120),
                                  child: AppCard(
                                    topAccent: st.$3,
                                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                      Row(children: [
                                        Expanded(child: Text(_customerName(disp['customer']), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13.5))),
                                        Chip2(tr(st.$1, st.$2), st.$3),
                                      ]),
                                      const SizedBox(height: 4),
                                      Text((disp['reason'] ?? '').toString(), style: const TextStyle(fontSize: 12.5, color: T.inkSoft)),
                                      const SizedBox(height: 5),
                                      Wrap(spacing: 6, runSpacing: 6, children: [
                                        if (disp['invoice'] is Map) Chip2('${disp['invoice']['invoiceNumber'] ?? ''} · ${_money(disp['invoice']['balance'] ?? disp['invoice']['amount'])}', T.info),
                                        Chip2(_d(disp['createdAt']), T.inkFaint, icon: Icons.event),
                                      ]),
                                      if ((disp['resolution'] ?? '').toString().isNotEmpty) ...[
                                        const SizedBox(height: 5),
                                        Text('${tr('الحل', 'Resolution')}: ${disp['resolution']}', style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: T.success)),
                                      ],
                                      if (disp['status'] != 'resolved') ...[
                                        const SizedBox(height: 6),
                                        Row(mainAxisAlignment: MainAxisAlignment.end, children: [
                                          if (disp['status'] == 'open')
                                            TextButton(onPressed: () => _update(disp, 'under_review'), child: Text(tr('مراجعة', 'Review'), style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700, color: T.info))),
                                          const SizedBox(width: 4),
                                          FilledButton.tonal(
                                            style: FilledButton.styleFrom(padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 6)),
                                            onPressed: () => _update(disp, 'resolved'),
                                            child: Text(tr('حل', 'Resolve'), style: const TextStyle(fontSize: 12.5)),
                                          ),
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
