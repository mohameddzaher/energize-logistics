import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';
import 'collections_disputes.dart' show pickFromApi;

/// المشتريات — طلبات الشراء (المسار الكامل: مسودة → اعتماد → أمر شراء)،
/// أوامر الشراء (استلام)، وفواتير الموردين (تسجيل دفعات).

const _prStatuses = {
  'draft': ('مسودة', 'Draft', T.inkFaint),
  'pending_approval': ('بانتظار الموافقة', 'Pending', T.warn),
  'approved': ('معتمد', 'Approved', T.success),
  'rejected': ('مرفوض', 'Rejected', T.danger),
  'ordered': ('تم الطلب', 'Ordered', T.violet),
};

const _poStatuses = {
  'draft': ('مسودة', 'Draft', T.inkFaint),
  'sent': ('مُرسل', 'Sent', T.info),
  'partially_received': ('مستلم جزئيًا', 'Partial', T.warn),
  'received': ('مستلم', 'Received', T.success),
  'billed': ('مفوتر', 'Billed', T.violet),
  'cancelled': ('ملغي', 'Cancelled', T.danger),
};

const _billStatuses = {
  'unpaid': ('غير مدفوع', 'Unpaid', T.danger),
  'partial': ('مدفوع جزئيًا', 'Partial', T.warn),
  'paid': ('مدفوع', 'Paid', T.success),
};

const _priorities = {
  'low': ('منخفضة', 'Low'),
  'medium': ('متوسطة', 'Medium'),
  'high': ('عالية', 'High'),
  'urgent': ('عاجلة', 'Urgent'),
};

String _money(dynamic v) {
  final n = (v is num) ? v : num.tryParse(v?.toString() ?? '') ?? 0;
  return n.toStringAsFixed(n.truncateToDouble() == n ? 0 : 2);
}

String _vendorName(dynamic v) =>
    v is Map ? (v['name'] ?? v['companyName'] ?? v['vendorName'] ?? '—').toString() : '—';

// ── طلبات الشراء ─────────────────────────────────────────────────────────────
class ProcRequestsScreen extends StatefulWidget {
  const ProcRequestsScreen({super.key});
  @override
  State<ProcRequestsScreen> createState() => _ProcRequestsScreenState();
}

class _ProcRequestsScreenState extends State<ProcRequestsScreen> {
  List<Map<String, dynamic>> _rows = [];
  List<Map<String, dynamic>> _vendors = [];
  List<Map<String, dynamic>> _categories = [];
  bool _loading = true;
  String? _error;
  String _q = '';
  String _status = '';
  late final void Function() _onLive;

  @override
  void initState() {
    super.initState();
    _load();
    _onLive = () => _load();
    Live.instance.on('procurement:pr', _onLive);
  }

  @override
  void dispose() {
    Live.instance.off('procurement:pr', _onLive);
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final qs = _status.isEmpty ? '' : '?status=$_status';
      final results = await Future.wait([
        Api.instance.get('/api/procurement/requests$qs'),
        if (_vendors.isEmpty) Api.instance.get('/api/procurement/options').catchError((_) => <String, dynamic>{}),
      ]);
      if (!mounted) return;
      setState(() {
        _rows = List<Map<String, dynamic>>.from(results[0]['requests'] ?? []);
        if (results.length > 1) {
          _vendors = List<Map<String, dynamic>>.from(results[1]['vendors'] ?? []);
          _categories = List<Map<String, dynamic>>.from(results[1]['CATEGORIES'] ?? []);
        }
        _loading = false;
        _error = null;
      });
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  String _fold(String s) => s.replaceAll(RegExp('[أإآ]'), 'ا').replaceAll('ى', 'ي').replaceAll('ة', 'ه').toLowerCase();

  Future<void> _act(Future<dynamic> Function() run, String okMsg) async {
    try {
      await run();
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(okMsg)));
      _load();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    }
  }

  @override
  Widget build(BuildContext context) {
    final q = _fold(_q.trim());
    final filtered = _rows.where((r) {
      if (q.isEmpty) return true;
      return [r['title'], r['requestNumber'], r['department']].any((x) => _fold((x ?? '').toString()).contains(q));
    }).toList();

    return AppScaffold(
      title: Text(tr('طلبات الشراء', 'Purchase Requests')),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => _editSheet(context, null),
        icon: const Icon(Icons.add),
        label: Text(tr('طلب جديد', 'New')),
      ),
      body: _loading
          ? ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(height: 48), SizedBox(height: 10), Shimmer(), SizedBox(height: 10), Shimmer()])
          : _error != null
              ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
              : Column(children: [
                  Padding(
                    padding: const EdgeInsets.fromLTRB(14, 12, 14, 0),
                    child: TextField(
                      onChanged: (v) => setState(() => _q = v),
                      decoration: InputDecoration(hintText: tr('ابحث بالعنوان أو الرقم…', 'Search…'), prefixIcon: const Icon(Icons.search)),
                    ),
                  ),
                  Padding(
                    padding: const EdgeInsets.fromLTRB(14, 8, 14, 4),
                    child: SingleChildScrollView(
                      scrollDirection: Axis.horizontal,
                      child: Row(
                        children: _prStatuses.entries.map((e) {
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
                      child: filtered.isEmpty
                          ? EmptyState(icon: Icons.request_quote_outlined, title: tr('لا توجد طلبات مطابقة', 'No matches'))
                          : ListView.separated(
                              padding: const EdgeInsets.all(14),
                              itemCount: filtered.length,
                              separatorBuilder: (_, __) => const SizedBox(height: 8),
                              itemBuilder: (c, i) {
                                final r = filtered[i];
                                final st = _prStatuses[r['status']] ?? ('—', '—', T.inkFaint);
                                return FadeSlideIn(
                                  delayMs: (i * 15).clamp(0, 150),
                                  child: Pressable(
                                    onTap: () => _actionsSheet(context, r),
                                    child: AppCard(
                                      topAccent: st.$3,
                                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                        Row(children: [
                                          Expanded(child: Text((r['title'] ?? '').toString(), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14))),
                                          Chip2(tr(st.$1, st.$2), st.$3),
                                        ]),
                                        const SizedBox(height: 5),
                                        Wrap(spacing: 6, runSpacing: 6, children: [
                                          Chip2((r['requestNumber'] ?? '').toString(), T.navy),
                                          Chip2('${_money(r['totalEstimate'])} ${tr('ر.س', 'SAR')}', T.info, icon: Icons.payments_outlined),
                                          if ((r['priority'] ?? '') != '' && r['priority'] != 'medium')
                                            Chip2(tr(_priorities[r['priority']]?.$1 ?? '', _priorities[r['priority']]?.$2 ?? ''), r['priority'] == 'urgent' ? T.danger : T.warn),
                                        ]),
                                      ]),
                                    ),
                                  ),
                                );
                              },
                            ),
                    ),
                  ),
                ]),
    );
  }

  Future<void> _actionsSheet(BuildContext context, Map<String, dynamic> r) async {
    final st = (r['status'] ?? '').toString();
    await showModalBottomSheet(
      context: context,
      builder: (sheet) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text((r['title'] ?? '').toString(), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
            const SizedBox(height: 4),
            Text('${r['requestNumber'] ?? ''} · ${_money(r['totalEstimate'])} ${tr('ر.س', 'SAR')}',
                style: const TextStyle(fontSize: 12.5, color: T.inkSoft)),
            if ((r['items'] as List?)?.isNotEmpty ?? false) ...[
              const SizedBox(height: 8),
              ...List<Map<String, dynamic>>.from(r['items']).map((l) => Text(
                  '• ${l['description'] ?? ''} — ${_money(l['quantity'])} × ${_money(l['unitPrice'])} = ${_money(l['total'])}',
                  style: const TextStyle(fontSize: 12))),
            ],
            const SizedBox(height: 14),
            Wrap(spacing: 8, runSpacing: 8, children: [
              if (st == 'draft' || st == 'pending_approval' || st == 'rejected')
                _chip(sheet, Icons.edit_outlined, tr('تعديل', 'Edit'), T.navy, () => _editSheet(context, r)),
              if (st == 'draft')
                _chip(sheet, Icons.send_rounded, tr('إرسال للاعتماد', 'Submit'), T.info,
                    () => _act(() => Api.instance.post('/api/procurement/requests/${r['_id']}/submit'), tr('أُرسل الطلب للاعتماد', 'Submitted'))),
              if (st == 'pending_approval') ...[
                _chip(sheet, Icons.check_circle_outline, tr('اعتماد', 'Approve'), T.success,
                    () => _act(() => Api.instance.patch('/api/procurement/requests/${r['_id']}/decision', {'decision': 'approved'}), tr('اعتُمد الطلب', 'Approved'))),
                _chip(sheet, Icons.cancel_outlined, tr('رفض', 'Reject'), T.danger, () => _reject(context, r)),
              ],
              if (st == 'approved')
                _chip(sheet, Icons.shopping_cart_checkout_rounded, tr('تحويل لأمر شراء', 'Convert to PO'), T.violet, () => _convert(context, r)),
              if (st != 'ordered')
                _chip(sheet, Icons.delete_outline, tr('حذف', 'Delete'), T.danger,
                    () => _act(() => Api.instance.delete('/api/procurement/requests/${r['_id']}'), tr('حُذف الطلب', 'Deleted'))),
            ]),
            const SizedBox(height: 6),
          ]),
        ),
      ),
    );
  }

  Widget _chip(BuildContext sheet, IconData icon, String label, Color color, Future<void> Function() run) =>
      ActionChip(
        avatar: Icon(icon, size: 17, color: color),
        label: Text(label, style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700, color: color)),
        backgroundColor: color.withValues(alpha: 0.08),
        side: BorderSide.none,
        onPressed: () { Navigator.pop(sheet); run(); },
      );

  Future<void> _reject(BuildContext context, Map<String, dynamic> r) async {
    final note = TextEditingController();
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: Text(tr('رفض الطلب', 'Reject request')),
        content: TextField(controller: note, decoration: InputDecoration(labelText: tr('سبب الرفض', 'Reason'))),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: Text(tr('إلغاء', 'Cancel'))),
          FilledButton(style: FilledButton.styleFrom(backgroundColor: T.danger), onPressed: () => Navigator.pop(c, true), child: Text(tr('رفض', 'Reject'))),
        ],
      ),
    );
    if (ok != true) return;
    await _act(
        () => Api.instance.patch('/api/procurement/requests/${r['_id']}/decision',
            {'decision': 'rejected', if (note.text.trim().isNotEmpty) 'note': note.text.trim()}),
        tr('رُفض الطلب', 'Rejected'));
  }

  Future<void> _convert(BuildContext context, Map<String, dynamic> r) async {
    if (_vendors.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(tr('لا يوجد موردون بعد', 'No vendors yet'))));
      return;
    }
    String q = '';
    final vendor = await showModalBottomSheet<Map<String, dynamic>>(
      context: context,
      isScrollControlled: true,
      builder: (c) => StatefulBuilder(builder: (c, setS) {
        final fq = _fold(q.trim());
        final list = _vendors.where((v) => fq.isEmpty || _fold(_vendorName(v)).contains(fq)).toList();
        return SafeArea(
          child: Padding(
            padding: EdgeInsets.only(bottom: MediaQuery.of(c).viewInsets.bottom),
            child: SizedBox(
              height: MediaQuery.of(c).size.height * 0.7,
              child: Column(children: [
                Padding(
                  padding: const EdgeInsets.all(14),
                  child: TextField(
                    autofocus: true,
                    onChanged: (v) => setS(() => q = v),
                    decoration: InputDecoration(hintText: tr('ابحث عن المورد…', 'Search vendor…'), prefixIcon: const Icon(Icons.search)),
                  ),
                ),
                Expanded(
                  child: ListView.builder(
                    itemCount: list.length,
                    itemBuilder: (c, i) => ListTile(
                      title: Text(_vendorName(list[i]), style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 14)),
                      onTap: () => Navigator.pop(c, list[i]),
                    ),
                  ),
                ),
              ]),
            ),
          ),
        );
      }),
    );
    if (vendor == null) return;
    await _act(() => Api.instance.post('/api/procurement/requests/${r['_id']}/convert', {'vendor': vendor['_id']}),
        tr('أُنشئ أمر الشراء', 'PO created'));
  }

  Future<void> _editSheet(BuildContext context, Map<String, dynamic>? r) async {
    final title = TextEditingController(text: (r?['title'] ?? '').toString());
    final department = TextEditingController(text: (r?['department'] ?? '').toString());
    final justification = TextEditingController(text: (r?['justification'] ?? '').toString());
    String priority = (r?['priority'] ?? 'medium').toString();
    String category = (r?['category'] ?? '').toString();
    final items = List<Map<String, dynamic>>.from(r?['items'] ?? [])
        .map((l) => (
              desc: TextEditingController(text: (l['description'] ?? '').toString()),
              qty: TextEditingController(text: _money(l['quantity'])),
              price: TextEditingController(text: _money(l['unitPrice'])),
            ))
        .toList();
    if (items.isEmpty) {
      items.add((desc: TextEditingController(), qty: TextEditingController(text: '1'), price: TextEditingController()));
    }

    await showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (c) => StatefulBuilder(builder: (c, setS) => SafeArea(
        child: Padding(
          padding: EdgeInsets.fromLTRB(16, 16, 16, MediaQuery.of(c).viewInsets.bottom + 16),
          child: SingleChildScrollView(
            child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(r == null ? tr('طلب شراء جديد', 'New purchase request') : tr('تعديل الطلب', 'Edit request'),
                  style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
              const SizedBox(height: 12),
              TextField(controller: title, decoration: InputDecoration(labelText: tr('العنوان *', 'Title *'))),
              const SizedBox(height: 10),
              if (_categories.isNotEmpty) ...[
                DropdownButtonFormField<String>(
                  initialValue: _categories.any((x) => x['key'] == category) ? category : null,
                  decoration: InputDecoration(labelText: tr('التصنيف', 'Category')),
                  items: _categories
                      .map((x) => DropdownMenuItem(value: (x['key'] ?? '').toString(), child: Text(tr((x['nameAr'] ?? '').toString(), (x['nameEn'] ?? '').toString()))))
                      .toList(),
                  onChanged: (v) => setS(() => category = v ?? category),
                ),
                const SizedBox(height: 10),
              ],
              Row(children: [
                Expanded(child: TextField(controller: department, decoration: InputDecoration(labelText: tr('القسم الطالب', 'Department')))),
                const SizedBox(width: 10),
                Expanded(
                  child: DropdownButtonFormField<String>(
                    initialValue: priority,
                    decoration: InputDecoration(labelText: tr('الأولوية', 'Priority')),
                    items: _priorities.entries.map((e) => DropdownMenuItem(value: e.key, child: Text(tr(e.value.$1, e.value.$2)))).toList(),
                    onChanged: (v) => setS(() => priority = v ?? priority),
                  ),
                ),
              ]),
              const SizedBox(height: 10),
              TextField(controller: justification, decoration: InputDecoration(labelText: tr('المبرر', 'Justification'))),
              const SizedBox(height: 14),
              Text(tr('البنود', 'Items'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13.5)),
              const SizedBox(height: 6),
              ...items.asMap().entries.map((e) => Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: Row(children: [
                  Expanded(flex: 3, child: TextField(controller: e.value.desc, decoration: InputDecoration(labelText: tr('الوصف', 'Description'), isDense: true))),
                  const SizedBox(width: 6),
                  Expanded(child: TextField(controller: e.value.qty, keyboardType: TextInputType.number, decoration: InputDecoration(labelText: tr('كمية', 'Qty'), isDense: true))),
                  const SizedBox(width: 6),
                  Expanded(flex: 2, child: TextField(controller: e.value.price, keyboardType: TextInputType.number, decoration: InputDecoration(labelText: tr('سعر الوحدة', 'Unit price'), isDense: true))),
                  IconButton(
                    icon: const Icon(Icons.remove_circle_outline, size: 20, color: T.danger),
                    onPressed: items.length == 1 ? null : () => setS(() => items.removeAt(e.key)),
                  ),
                ]),
              )),
              TextButton.icon(
                onPressed: () => setS(() => items.add((desc: TextEditingController(), qty: TextEditingController(text: '1'), price: TextEditingController()))),
                icon: const Icon(Icons.add, size: 18),
                label: Text(tr('إضافة بند', 'Add item')),
              ),
              const SizedBox(height: 10),
              Row(children: [
                Expanded(
                  child: OutlinedButton(
                    onPressed: () => _savePR(c, r, title, category, department, priority, justification, items, submit: false),
                    child: Text(tr('حفظ كمسودة', 'Save draft')),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: FilledButton(
                    onPressed: () => _savePR(c, r, title, category, department, priority, justification, items, submit: true),
                    child: Text(tr('حفظ وإرسال', 'Save & submit')),
                  ),
                ),
              ]),
            ]),
          ),
        ),
      )),
    );
  }

  Future<void> _savePR(
    BuildContext sheet,
    Map<String, dynamic>? r,
    TextEditingController title,
    String category,
    TextEditingController department,
    String priority,
    TextEditingController justification,
    List<({TextEditingController desc, TextEditingController qty, TextEditingController price})> items, {
    required bool submit,
  }) async {
    if (title.text.trim().isEmpty) return;
    final body = {
      'title': title.text.trim(),
      if (category.isNotEmpty) 'category': category,
      if (department.text.trim().isNotEmpty) 'department': department.text.trim(),
      'priority': priority,
      if (justification.text.trim().isNotEmpty) 'justification': justification.text.trim(),
      'items': items
          .where((l) => l.desc.text.trim().isNotEmpty)
          .map((l) => {'description': l.desc.text.trim(), 'quantity': num.tryParse(l.qty.text) ?? 1, 'unitPrice': num.tryParse(l.price.text) ?? 0})
          .toList(),
    };
    try {
      if (r == null) {
        await Api.instance.post('/api/procurement/requests', {...body, if (submit) 'status': 'pending_approval'});
      } else {
        await Api.instance.put('/api/procurement/requests/${r['_id']}', body);
        if (submit && r['status'] == 'draft') {
          await Api.instance.post('/api/procurement/requests/${r['_id']}/submit');
        }
      }
      if (sheet.mounted) Navigator.pop(sheet);
      _load();
    } catch (e) {
      if (sheet.mounted) ScaffoldMessenger.of(sheet).showSnackBar(SnackBar(content: Text(e.toString())));
    }
  }
}

// ── أوامر الشراء ─────────────────────────────────────────────────────────────
class ProcOrdersScreen extends StatefulWidget {
  const ProcOrdersScreen({super.key});
  @override
  State<ProcOrdersScreen> createState() => _ProcOrdersScreenState();
}

class _ProcOrdersScreenState extends State<ProcOrdersScreen> {
  List<Map<String, dynamic>> _rows = [];
  bool _loading = true;
  String? _error;
  String _q = '';
  late final void Function() _onLive;

  @override
  void initState() {
    super.initState();
    _load();
    _onLive = () => _load();
    Live.instance.on('procurement:po', _onLive);
  }

  @override
  void dispose() {
    Live.instance.off('procurement:po', _onLive);
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final d = await Api.instance.get('/api/procurement/orders');
      if (!mounted) return;
      setState(() { _rows = List<Map<String, dynamic>>.from(d['orders'] ?? []); _loading = false; _error = null; });
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  String _fold(String s) => s.replaceAll(RegExp('[أإآ]'), 'ا').replaceAll('ى', 'ي').replaceAll('ة', 'ه').toLowerCase();

  // أمر شراء مستقل: اختيار المورد + بنود + تاريخ متوقع → POST /orders (مسودة).
  Future<void> _createPO() async {
    final vendor = await pickFromApi(context,
        endpoint: '/api/procurement/options', listKey: 'vendors',
        label: (v) => _vendorName(v), title: tr('اختر المورد', 'Pick vendor'));
    if (vendor == null || !mounted) return;
    final notes = TextEditingController();
    DateTime? expected;
    final items = <({TextEditingController desc, TextEditingController qty, TextEditingController price})>[
      (desc: TextEditingController(), qty: TextEditingController(text: '1'), price: TextEditingController()),
    ];
    final ok = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (c) => StatefulBuilder(builder: (c, setS) => Padding(
        padding: EdgeInsets.fromLTRB(16, 16, 16, MediaQuery.of(c).viewInsets.bottom + 16),
        child: SingleChildScrollView(
          child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text('${tr('أمر شراء جديد', 'New PO')} — ${_vendorName(vendor)}', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
            const SizedBox(height: 12),
            OutlinedButton.icon(
              icon: const Icon(Icons.event, size: 17),
              style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(46), alignment: AlignmentDirectional.centerStart),
              label: Text('${tr('التاريخ المتوقع', 'Expected date')}: ${expected == null ? tr('اختر', 'Pick') : expected!.toIso8601String().split('T').first}'),
              onPressed: () async {
                final d = await showDatePicker(context: c, initialDate: DateTime.now().add(const Duration(days: 7)), firstDate: DateTime.now().subtract(const Duration(days: 30)), lastDate: DateTime(2035));
                if (d != null) setS(() => expected = d);
              },
            ),
            const SizedBox(height: 12),
            Text(tr('البنود', 'Items'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13.5)),
            const SizedBox(height: 6),
            ...items.asMap().entries.map((e) => Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Row(children: [
                Expanded(flex: 3, child: TextField(controller: e.value.desc, decoration: InputDecoration(labelText: tr('الوصف', 'Description'), isDense: true))),
                const SizedBox(width: 6),
                Expanded(child: TextField(controller: e.value.qty, keyboardType: TextInputType.number, decoration: InputDecoration(labelText: tr('كمية', 'Qty'), isDense: true))),
                const SizedBox(width: 6),
                Expanded(flex: 2, child: TextField(controller: e.value.price, keyboardType: TextInputType.number, decoration: InputDecoration(labelText: tr('سعر', 'Price'), isDense: true))),
                IconButton(icon: const Icon(Icons.remove_circle_outline, size: 20, color: T.danger), onPressed: items.length == 1 ? null : () => setS(() => items.removeAt(e.key))),
              ]),
            )),
            TextButton.icon(
              onPressed: () => setS(() => items.add((desc: TextEditingController(), qty: TextEditingController(text: '1'), price: TextEditingController()))),
              icon: const Icon(Icons.add, size: 18), label: Text(tr('إضافة بند', 'Add item')),
            ),
            const SizedBox(height: 8),
            TextField(controller: notes, decoration: InputDecoration(labelText: tr('ملاحظات', 'Notes'))),
            const SizedBox(height: 14),
            SizedBox(width: double.infinity, child: FilledButton(onPressed: () => Navigator.pop(c, true), child: Text(tr('إنشاء أمر الشراء', 'Create PO')))),
          ]),
        ),
      )),
    );
    if (ok != true) return;
    final lines = items.where((l) => l.desc.text.trim().isNotEmpty)
        .map((l) => {'description': l.desc.text.trim(), 'quantity': num.tryParse(l.qty.text) ?? 1, 'unitPrice': num.tryParse(l.price.text) ?? 0}).toList();
    if (lines.isEmpty) { if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(tr('أضِف بندًا واحدًا على الأقل', 'Add at least one item')))); return; }
    try {
      await Api.instance.post('/api/procurement/orders', {
        'vendor': vendor['_id'], 'items': lines, 'status': 'draft',
        if (expected != null) 'expectedDate': expected!.toIso8601String().split('T').first,
        if (notes.text.trim().isNotEmpty) 'notes': notes.text.trim(),
      });
      _load();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    }
  }

  Future<void> _receive(Map<String, dynamic> r) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: Text(tr('تأكيد الاستلام', 'Confirm receipt')),
        content: Text('${r['poNumber'] ?? ''} · ${_money(r['total'])} ${tr('ر.س', 'SAR')}'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: Text(tr('إلغاء', 'Cancel'))),
          FilledButton(onPressed: () => Navigator.pop(c, true), child: Text(tr('تم الاستلام', 'Received'))),
        ],
      ),
    );
    if (ok != true) return;
    try {
      await Api.instance.post('/api/procurement/orders/${r['_id']}/receive');
      _load();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    }
  }

  @override
  Widget build(BuildContext context) {
    final q = _fold(_q.trim());
    final filtered = _rows.where((r) {
      if (q.isEmpty) return true;
      return [r['poNumber'], _vendorName(r['vendor'])].any((x) => _fold((x ?? '').toString()).contains(q));
    }).toList();

    return AppScaffold(
      title: Text(tr('أوامر الشراء', 'Purchase Orders')),
      floatingActionButton: FloatingActionButton.extended(
        backgroundColor: T.navy, foregroundColor: Colors.white,
        onPressed: _createPO,
        icon: const Icon(Icons.add), label: Text(tr('أمر شراء', 'New PO')),
      ),
      body: _loading
          ? ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(height: 48), SizedBox(height: 10), Shimmer(), SizedBox(height: 10), Shimmer()])
          : _error != null
              ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
              : Column(children: [
                  Padding(
                    padding: const EdgeInsets.fromLTRB(14, 12, 14, 4),
                    child: TextField(
                      onChanged: (v) => setState(() => _q = v),
                      decoration: InputDecoration(hintText: tr('ابحث برقم الأمر أو المورد…', 'Search…'), prefixIcon: const Icon(Icons.search)),
                    ),
                  ),
                  Expanded(
                    child: RefreshIndicator(
                      onRefresh: _load,
                      child: filtered.isEmpty
                          ? EmptyState(icon: Icons.shopping_cart_outlined, title: tr('لا توجد أوامر شراء', 'No orders'))
                          : ListView.separated(
                              padding: const EdgeInsets.all(14),
                              itemCount: filtered.length,
                              separatorBuilder: (_, __) => const SizedBox(height: 8),
                              itemBuilder: (c, i) {
                                final r = filtered[i];
                                final st = _poStatuses[r['status']] ?? ('—', '—', T.inkFaint);
                                final receivable = ['draft', 'sent', 'partially_received'].contains(r['status']);
                                return FadeSlideIn(
                                  delayMs: (i * 15).clamp(0, 150),
                                  child: AppCard(
                                    topAccent: st.$3,
                                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                      Row(children: [
                                        Expanded(child: Text((r['poNumber'] ?? '').toString(), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14))),
                                        Chip2(tr(st.$1, st.$2), st.$3),
                                      ]),
                                      const SizedBox(height: 4),
                                      Text(_vendorName(r['vendor']), style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600)),
                                      const SizedBox(height: 6),
                                      Row(children: [
                                        Chip2('${_money(r['total'])} ${tr('ر.س', 'SAR')}', T.info, icon: Icons.payments_outlined),
                                        const Spacer(),
                                        if (receivable)
                                          TextButton.icon(
                                            onPressed: () => _receive(r),
                                            icon: const Icon(Icons.inventory_2_outlined, size: 17),
                                            label: Text(tr('تم الاستلام', 'Receive'), style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700)),
                                          ),
                                      ]),
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

// ── فواتير الموردين ──────────────────────────────────────────────────────────
class ProcBillsScreen extends StatefulWidget {
  const ProcBillsScreen({super.key});
  @override
  State<ProcBillsScreen> createState() => _ProcBillsScreenState();
}

class _ProcBillsScreenState extends State<ProcBillsScreen> {
  List<Map<String, dynamic>> _rows = [];
  bool _loading = true;
  String? _error;
  String _q = '';
  String _status = '';
  late final void Function() _onLive;

  @override
  void initState() {
    super.initState();
    _load();
    _onLive = () => _load();
    Live.instance.on('procurement:bill', _onLive);
  }

  @override
  void dispose() {
    Live.instance.off('procurement:bill', _onLive);
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final qs = _status.isEmpty ? '' : '?status=$_status';
      final d = await Api.instance.get('/api/procurement/bills$qs');
      if (!mounted) return;
      setState(() { _rows = List<Map<String, dynamic>>.from(d['bills'] ?? []); _loading = false; _error = null; });
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  String _fold(String s) => s.replaceAll(RegExp('[أإآ]'), 'ا').replaceAll('ى', 'ي').replaceAll('ة', 'ه').toLowerCase();

  void _createBill() => _billSheet();

  /// فاتورة مورد: إنشاءً وتعديلًا في استمارةٍ واحدة.
  ///
  /// والمورّد لا يُغيَّر عند التعديل: ذاك التزامٌ لجهةٍ أخرى، يُحذف ويُسجَّل
  /// باسمها. والقيد المحاسبيّ يُعاد ترحيله في الخادم مع تغيّر المبلغ، فلا
  /// يُقفَل الشهر بميزانٍ لا يطابق فواتيره.
  Future<void> _billSheet({Map<String, dynamic>? existing}) async {
    Map<String, dynamic>? vendor;
    if (existing == null) {
      vendor = await pickFromApi(context,
          endpoint: '/api/procurement/options', listKey: 'vendors',
          label: (v) => _vendorName(v), title: tr('اختر المورد', 'Pick vendor'));
      if (vendor == null || !mounted) return;
    }
    final subtotal = TextEditingController(text: existing == null ? '' : _money(existing['subtotal']).replaceAll(',', ''));
    final vat = TextEditingController(text: existing == null ? '' : _money(existing['vatAmount']).replaceAll(',', ''));
    final invoiceNo = TextEditingController(text: (existing?['vendorInvoiceNumber'] ?? '').toString());
    final notes = TextEditingController(text: (existing?['notes'] ?? '').toString());
    DateTime billDate = DateTime.tryParse((existing?['billDate'] ?? '').toString()) ?? DateTime.now();
    DateTime? dueDate = DateTime.tryParse((existing?['dueDate'] ?? '').toString());
    final ok = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (c) => StatefulBuilder(builder: (c, setS) => Padding(
        padding: EdgeInsets.fromLTRB(16, 16, 16, MediaQuery.of(c).viewInsets.bottom + 16),
        child: SingleChildScrollView(
          child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(existing == null
                ? '${tr('فاتورة مورد جديدة', 'New vendor bill')} — ${_vendorName(vendor)}'
                : '${tr('تعديل الفاتورة', 'Edit bill')} ${existing['billNumber'] ?? ''} — ${_vendorName(existing['vendor'])}',
                style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
            const SizedBox(height: 12),
            TextField(controller: invoiceNo, decoration: InputDecoration(labelText: tr('رقم فاتورة المورد', 'Vendor invoice #'))),
            const SizedBox(height: 10),
            Row(children: [
              Expanded(child: TextField(controller: subtotal, keyboardType: TextInputType.number, decoration: InputDecoration(labelText: tr('قبل الضريبة *', 'Subtotal *')))),
              const SizedBox(width: 10),
              Expanded(child: TextField(controller: vat, keyboardType: TextInputType.number, decoration: InputDecoration(labelText: tr('الضريبة', 'VAT')))),
            ]),
            const SizedBox(height: 10),
            Row(children: [
              Expanded(child: OutlinedButton.icon(
                icon: const Icon(Icons.event, size: 16),
                label: Text('${tr('تاريخ الفاتورة', 'Bill date')}: ${billDate.toIso8601String().split('T').first}', style: const TextStyle(fontSize: 11.5)),
                onPressed: () async { final d = await showDatePicker(context: c, initialDate: billDate, firstDate: DateTime(2020), lastDate: DateTime(2035)); if (d != null) setS(() => billDate = d); },
              )),
              const SizedBox(width: 8),
              Expanded(child: OutlinedButton.icon(
                icon: const Icon(Icons.event_available, size: 16),
                label: Text('${tr('الاستحقاق', 'Due')}: ${dueDate == null ? '—' : dueDate!.toIso8601String().split('T').first}', style: const TextStyle(fontSize: 11.5)),
                onPressed: () async { final d = await showDatePicker(context: c, initialDate: DateTime.now().add(const Duration(days: 30)), firstDate: DateTime(2020), lastDate: DateTime(2035)); if (d != null) setS(() => dueDate = d); },
              )),
            ]),
            const SizedBox(height: 10),
            TextField(controller: notes, decoration: InputDecoration(labelText: tr('ملاحظات', 'Notes'))),
            const SizedBox(height: 14),
            SizedBox(width: double.infinity, child: FilledButton(onPressed: () => Navigator.pop(c, true), child: Text(existing == null ? tr('إنشاء الفاتورة', 'Create bill') : tr('حفظ', 'Save')))),
          ]),
        ),
      )),
    );
    if (ok != true) return;
    if ((num.tryParse(subtotal.text) ?? 0) <= 0) { if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(tr('أدخل المبلغ قبل الضريبة', 'Enter the subtotal')))); return; }
    final body = {
      if (existing == null) 'vendor': vendor!['_id'],
      'subtotal': num.tryParse(subtotal.text) ?? 0,
      'vatAmount': num.tryParse(vat.text) ?? 0,
      'vendorInvoiceNumber': invoiceNo.text.trim(),
      'billDate': billDate.toIso8601String().split('T').first,
      if (dueDate != null) 'dueDate': dueDate!.toIso8601String().split('T').first,
      'notes': notes.text.trim(),
    };
    try {
      if (existing == null) {
        await Api.instance.post('/api/procurement/bills', body);
      } else {
        await Api.instance.put('/api/procurement/bills/${existing['_id']}', body);
      }
      _load();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    }
  }

  Future<void> _deleteBill(Map<String, dynamic> r) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: Text(tr('حذف الفاتورة', 'Delete bill')),
        content: Text(tr(
            'حذف الفاتورة ${r['billNumber'] ?? ''} نهائيًّا؟ يُعكَس معها قيدُها المحاسبيّ.',
            'Permanently delete bill ${r['billNumber'] ?? ''}? Its journal entry is reversed with it.')),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: Text(tr('إلغاء', 'Cancel'))),
          FilledButton(onPressed: () => Navigator.pop(c, true), child: Text(tr('حذف', 'Delete'))),
        ],
      ),
    );
    if (ok != true) return;
    try { await Api.instance.delete('/api/procurement/bills/${r['_id']}'); _load(); }
    catch (e) { if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString()))); }
  }

  Future<void> _pay(Map<String, dynamic> r) async {
    final amount = TextEditingController(text: _money(r['balance']));
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: Text(tr('تسجيل دفعة', 'Record payment')),
        content: TextField(
          controller: amount,
          keyboardType: TextInputType.number,
          decoration: InputDecoration(labelText: tr('المبلغ (المتبقي ${_money(r['balance'])})', 'Amount (balance ${_money(r['balance'])})')),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: Text(tr('إلغاء', 'Cancel'))),
          FilledButton(onPressed: () => Navigator.pop(c, true), child: Text(tr('تسجيل', 'Record'))),
        ],
      ),
    );
    if (ok != true) return;
    try {
      await Api.instance.post('/api/procurement/bills/${r['_id']}/pay', {'amount': num.tryParse(amount.text) ?? 0});
      _load();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    }
  }

  @override
  Widget build(BuildContext context) {
    final q = _fold(_q.trim());
    final filtered = _rows.where((r) {
      if (q.isEmpty) return true;
      return [r['billNumber'], r['vendorInvoiceNumber'], _vendorName(r['vendor'])].any((x) => _fold((x ?? '').toString()).contains(q));
    }).toList();

    return AppScaffold(
      title: Text(tr('فواتير الموردين', 'Vendor Bills')),
      floatingActionButton: FloatingActionButton.extended(
        backgroundColor: T.navy, foregroundColor: Colors.white,
        onPressed: _createBill,
        icon: const Icon(Icons.add), label: Text(tr('فاتورة', 'New bill')),
      ),
      body: _loading
          ? ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(height: 48), SizedBox(height: 10), Shimmer(), SizedBox(height: 10), Shimmer()])
          : _error != null
              ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
              : Column(children: [
                  Padding(
                    padding: const EdgeInsets.fromLTRB(14, 12, 14, 0),
                    child: TextField(
                      onChanged: (v) => setState(() => _q = v),
                      decoration: InputDecoration(hintText: tr('ابحث برقم الفاتورة أو المورد…', 'Search…'), prefixIcon: const Icon(Icons.search)),
                    ),
                  ),
                  Padding(
                    padding: const EdgeInsets.fromLTRB(14, 8, 14, 4),
                    child: Row(
                      children: _billStatuses.entries.map((e) {
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
                      child: filtered.isEmpty
                          ? EmptyState(icon: Icons.receipt_long_outlined, title: tr('لا توجد فواتير', 'No bills'))
                          : ListView.separated(
                              padding: const EdgeInsets.all(14),
                              itemCount: filtered.length,
                              separatorBuilder: (_, __) => const SizedBox(height: 8),
                              itemBuilder: (c, i) {
                                final r = filtered[i];
                                final st = _billStatuses[r['status']] ?? ('—', '—', T.inkFaint);
                                return FadeSlideIn(
                                  delayMs: (i * 15).clamp(0, 150),
                                  child: AppCard(
                                    topAccent: st.$3,
                                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                      Row(children: [
                                        Expanded(child: Text((r['billNumber'] ?? '').toString(), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14))),
                                        Chip2(tr(st.$1, st.$2), st.$3),
                                      ]),
                                      const SizedBox(height: 4),
                                      Text(_vendorName(r['vendor']), style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600)),
                                      const SizedBox(height: 6),
                                      Row(children: [
                                        Chip2('${_money(r['total'])} ${tr('ر.س', 'SAR')}', T.info, icon: Icons.payments_outlined),
                                        const SizedBox(width: 6),
                                        if (r['status'] != 'paid') Chip2('${tr('المتبقي', 'Due')}: ${_money(r['balance'])}', T.danger),
                                        const Spacer(),
                                        if (r['status'] != 'paid')
                                          TextButton.icon(
                                            onPressed: () => _pay(r),
                                            icon: const Icon(Icons.payment_rounded, size: 17),
                                            label: Text(tr('دفع', 'Pay'), style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700)),
                                          ),
                                        IconButton(
                                          visualDensity: VisualDensity.compact,
                                          tooltip: tr('تعديل', 'Edit'),
                                          onPressed: () => _billSheet(existing: r),
                                          icon: const Icon(Icons.edit_outlined, size: 18, color: T.inkSoft),
                                        ),
                                        IconButton(
                                          visualDensity: VisualDensity.compact,
                                          tooltip: tr('حذف', 'Delete'),
                                          onPressed: () => _deleteBill(r),
                                          icon: const Icon(Icons.delete_outline, size: 18, color: T.danger),
                                        ),
                                      ]),
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
