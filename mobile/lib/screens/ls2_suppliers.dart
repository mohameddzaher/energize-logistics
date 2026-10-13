import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../services/api.dart';
import '../services/auth.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';

/// موردو مخزن النقل الثقيل — مَن تُشترى منه قطعُ الغيار.
///
/// المورد يُضاف من هنا، أو من خانة «المورد» في نموذج الصنف نفسِه (يُكتب الاسمُ
/// فيُنشأ مع الحفظ). والشاشتان تسمعان الحدثَ ذاتَه (`ls2:store`)، فما أُضيف في
/// إحداهما يظهر في الأخرى بلا إعادة تحميل.
///
/// ومع كلّ موردٍ ما اشتُري منه: عددُ الأصناف والتوريدات والقيمة وآخرُ شراء —
/// محسوبةٌ في الخادم من حركات الوارد لا مكتوبةٌ بيد. مطابقةٌ لصفحة الموقع
/// `/system/ls2/suppliers`.
class Ls2SuppliersScreen extends StatefulWidget {
  final String base;
  const Ls2SuppliersScreen({super.key, this.base = '/api/ls2/suppliers'});

  @override
  State<Ls2SuppliersScreen> createState() => _Ls2SuppliersScreenState();
}

num _numOf(dynamic v) => v is num ? v : num.tryParse(v?.toString() ?? '') ?? 0;

String _money(dynamic v) {
  final s = _numOf(v).round().toString();
  final b = StringBuffer();
  for (int i = 0; i < s.length; i++) { if (i > 0 && (s.length - i) % 3 == 0) b.write(','); b.write(s[i]); }
  return b.toString();
}

String _dmy(dynamic v) {
  final s = (v ?? '').toString();
  if (s.length < 10) return '—';
  return s.substring(0, 10).split('-').reversed.join('/');
}

class _Ls2SuppliersScreenState extends State<Ls2SuppliersScreen> {
  List<Map<String, dynamic>> _rows = [];
  bool _loading = true;
  String? _error;
  String _q = '';

  @override
  void initState() {
    super.initState();
    _load();
    Live.instance.on('ls2:store', _onLive);
  }

  @override
  void dispose() { Live.instance.off('ls2:store', _onLive); super.dispose(); }

  void _onLive() { _load(); }

  Future<void> _load() async {
    try {
      final d = await Api.instance.get(widget.base);
      if (!mounted) return;
      setState(() { _rows = List<Map<String, dynamic>>.from(d['suppliers'] ?? []); _loading = false; _error = null; });
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  void _toast(String msg) {
    if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg)));
  }

  Future<void> _openForm(Map<String, dynamic>? supplier) async {
    final saved = await showModalBottomSheet<bool>(
      context: context, isScrollControlled: true, backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (_) => _SupplierFormSheet(base: widget.base, supplier: supplier),
    );
    if (saved != true) return;
    _toast(tr('تم الحفظ', 'Saved'));
    _load();
  }

  Future<void> _delete(Map<String, dynamic> s) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: Text(tr('حذف المورد «${s['name']}»؟', 'Delete supplier “${s['name']}”?')),
        content: Text(tr('يختفي من قائمة الاختيار. مشترياتُه السابقةُ تبقى باسمه في سجلّ الحركات.',
            'It leaves the pick list. Its past purchases stay under its name in the log.')),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: Text(tr('إلغاء', 'Cancel'))),
          FilledButton(style: FilledButton.styleFrom(backgroundColor: T.danger), onPressed: () => Navigator.pop(c, true), child: Text(tr('حذف', 'Delete'))),
        ],
      ),
    );
    if (ok != true) return;
    try {
      await Api.instance.delete('${widget.base}/${s['_id']}');
      _toast(tr('حُذف المورد', 'Deleted'));
      _load();
    } catch (e) {
      _toast(e.toString());
    }
  }

  @override
  Widget build(BuildContext context) {
    // الخطُّ نفسُه الذي ترسمه شاشةُ المخزن: من يكتب في القسم يكتب في مورديه،
    // ومن يقرأ وحسبُ لا تُعرَض له أزرارٌ تُرفَض.
    final auth = context.watch<AuthProvider>();
    final canEdit = const ['super_admin', 'admin', 'it_manager', 'operations_manager',
      'operations_staff', 'moderator'].contains(auth.role)
        || auth.canEditSection('Location Solutions');
    final k = _q.trim().toLowerCase();
    final shown = _rows.where((s) => k.isEmpty
        || [s['name'], s['phone'], s['city'], s['taxNumber']].any((v) => (v ?? '').toString().toLowerCase().contains(k))).toList();
    final purchases = _rows.fold<num>(0, (a, s) => a + _numOf(s['purchases']));
    final value = _rows.fold<num>(0, (a, s) => a + _numOf(s['total']));
    final idle = _rows.where((s) => _numOf(s['purchases']) == 0).length;
    return AppScaffold(
      title: Text(tr('الموردون', 'Suppliers')),
      floatingActionButton: !canEdit ? null : FloatingActionButton.extended(
        backgroundColor: const Color(0xFF12325C), foregroundColor: Colors.white,
        icon: const Icon(Icons.add), label: Text(tr('مورد جديد', 'New supplier')), onPressed: () => _openForm(null),
      ),
      body: _loading && _rows.isEmpty
          ? ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(height: 70), SizedBox(height: 10), Shimmer(), SizedBox(height: 10), Shimmer()])
          : _error != null && _rows.isEmpty
              ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
              : Column(children: [
                  Padding(
                    padding: const EdgeInsets.fromLTRB(12, 12, 12, 4),
                    child: Row(children: [
                      Expanded(child: _tile(tr('الموردون', 'Suppliers'), '${_rows.length}', T.orange)),
                      const SizedBox(width: 6),
                      Expanded(child: _tile(tr('التوريدات', 'Purchases'), '$purchases', T.navy)),
                      const SizedBox(width: 6),
                      Expanded(child: _tile(tr('قيمة المشتريات', 'Value'), _money(value), T.success)),
                      const SizedBox(width: 6),
                      Expanded(child: _tile(tr('بلا مشتريات', 'No purchases'), '$idle', T.inkSoft)),
                    ]),
                  ),
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                    child: TextField(
                      onChanged: (v) => setState(() => _q = v),
                      decoration: InputDecoration(hintText: tr('ابحث بالاسم / الجوال / المدينة…', 'name / phone / city…'), prefixIcon: const Icon(Icons.search), isDense: true),
                    ),
                  ),
                  Expanded(
                    child: RefreshIndicator(
                      onRefresh: _load,
                      child: shown.isEmpty
                          ? ListView(children: [
                              const SizedBox(height: 60),
                              EmptyState(
                                icon: Icons.storefront_outlined,
                                title: _rows.isEmpty ? tr('لا موردين بعد', 'No suppliers yet') : tr('لا موردَ يطابق البحث', 'No supplier matches'),
                                subtitle: _rows.isEmpty ? tr('أضف أوّلَ مورد، أو اكتب اسمَه في خانة «المورد» عند إضافة صنف.', 'Add the first supplier, or type its name in the item form.') : null,
                              ),
                            ])
                          : ListView.separated(
                              padding: const EdgeInsets.fromLTRB(12, 12, 12, 88),
                              itemCount: shown.length,
                              separatorBuilder: (_, __) => const SizedBox(height: 8),
                              itemBuilder: (c, i) => _card(shown[i], canEdit),
                            ),
                    ),
                  ),
                ]),
    );
  }

  Widget _card(Map<String, dynamic> s, bool canEdit) {
    final contact = [s['phone'], s['city']].where((x) => (x ?? '').toString().isNotEmpty).join(' · ');
    final extra = [
      if ((s['taxNumber'] ?? '').toString().isNotEmpty) '${tr('الرقم الضريبي', 'Tax no.')}: ${s['taxNumber']}',
      if ((s['notes'] ?? '').toString().isNotEmpty) s['notes'].toString(),
    ].join(' · ');
    return AppCard(
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          Expanded(child: Text((s['name'] ?? '').toString(), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14))),
          if (canEdit) ...[
            IconButton(
              visualDensity: VisualDensity.compact,
              icon: const Icon(Icons.edit_outlined, size: 18, color: T.inkSoft),
              tooltip: tr('تعديل', 'Edit'),
              onPressed: () => _openForm(s),
            ),
            IconButton(
              visualDensity: VisualDensity.compact,
              icon: const Icon(Icons.delete_outline, size: 18, color: T.danger),
              tooltip: tr('حذف', 'Delete'),
              onPressed: () => _delete(s),
            ),
          ],
        ]),
        if (contact.isNotEmpty) Text(contact, style: const TextStyle(fontSize: 12, color: T.inkSoft)),
        if (extra.isNotEmpty)
          Padding(padding: const EdgeInsets.only(top: 2), child: Text(extra, style: const TextStyle(fontSize: 11, color: T.inkFaint), maxLines: 2, overflow: TextOverflow.ellipsis)),
        const SizedBox(height: 8),
        // ما اشتُري منه — محسوبٌ من حركات الوارد.
        Wrap(spacing: 14, runSpacing: 4, children: [
          _kv(tr('الأصناف', 'Items'), '${_numOf(s['items'])}', T.ink),
          _kv(tr('التوريدات', 'Purchases'), '${_numOf(s['purchases'])}', T.ink),
          _kv(tr('قيمة المشتريات', 'Value'), _money(s['total']), T.success),
          _kv(tr('آخر شراء', 'Last purchase'), _dmy(s['lastPurchase']), T.inkSoft),
        ]),
      ]),
    );
  }

  Widget _kv(String label, String value, Color color) => Row(mainAxisSize: MainAxisSize.min, children: [
        Text('$label: ', style: const TextStyle(fontSize: 11.5, color: T.inkFaint)),
        Text(value, style: TextStyle(fontWeight: FontWeight.w800, fontSize: 12.5, color: color)),
      ]);

  Widget _tile(String label, String value, Color color) => AppCard(
        padding: const EdgeInsets.all(10),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          FittedBox(fit: BoxFit.scaleDown, alignment: AlignmentDirectional.centerStart, child: Text(value, style: TextStyle(fontSize: 17, fontWeight: FontWeight.w900, color: color, height: 1))),
          const SizedBox(height: 2),
          Text(label, style: const TextStyle(fontSize: 10, color: T.inkSoft, fontWeight: FontWeight.w600), maxLines: 1, overflow: TextOverflow.ellipsis),
        ]),
      );
}

/// نموذجُ المورد. يحفظ بنفسه ويبقى مفتوحًا إن رُفض — فالخطأُ يُكتب فيه، لا في
/// شريطٍ يظهر خلف الورقة المفتوحة.
class _SupplierFormSheet extends StatefulWidget {
  final String base;
  final Map<String, dynamic>? supplier;
  const _SupplierFormSheet({required this.base, required this.supplier});

  @override
  State<_SupplierFormSheet> createState() => _SupplierFormSheetState();
}

class _SupplierFormSheetState extends State<_SupplierFormSheet> {
  late final _name = TextEditingController(text: widget.supplier?['name']?.toString() ?? '');
  late final _phone = TextEditingController(text: widget.supplier?['phone']?.toString() ?? '');
  late final _city = TextEditingController(text: widget.supplier?['city']?.toString() ?? '');
  late final _tax = TextEditingController(text: widget.supplier?['taxNumber']?.toString() ?? '');
  late final _notes = TextEditingController(text: widget.supplier?['notes']?.toString() ?? '');
  String? _nameErr;
  String? _err;
  bool _busy = false;

  @override
  void dispose() {
    for (final c in [_name, _phone, _city, _tax, _notes]) { c.dispose(); }
    super.dispose();
  }

  Future<void> _save() async {
    if (_name.text.trim().isEmpty) { setState(() => _nameErr = tr('اسم المورد مطلوب', 'Name required')); return; }
    final body = {
      'name': _name.text.trim(), 'phone': _phone.text.trim(), 'city': _city.text.trim(),
      'taxNumber': _tax.text.trim(), 'notes': _notes.text.trim(),
    };
    setState(() { _busy = true; _err = null; });
    try {
      if (widget.supplier == null) { await Api.instance.post(widget.base, body); }
      else { await Api.instance.put('${widget.base}/${widget.supplier!['_id']}', body); }
      if (mounted) Navigator.pop(context, true);
    } catch (e) {
      if (mounted) setState(() { _busy = false; _err = e.toString(); });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.fromLTRB(18, 16, 18, MediaQuery.of(context).viewInsets.bottom + 18),
      child: SingleChildScrollView(child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(widget.supplier == null ? tr('مورد جديد', 'New supplier') : tr('تعديل مورد', 'Edit supplier'), style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 16)),
        const SizedBox(height: 12),
        if (_err != null)
          Container(
            width: double.infinity,
            margin: const EdgeInsets.only(bottom: 10),
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
            decoration: BoxDecoration(color: T.danger.withValues(alpha: 0.08), borderRadius: BorderRadius.circular(10)),
            child: Text(_err!, style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: T.danger)),
          ),
        TextField(controller: _name, autofocus: widget.supplier == null, onChanged: (_) { if (_nameErr != null) setState(() => _nameErr = null); }, decoration: InputDecoration(labelText: tr('اسم المورد *', 'Name *'), errorText: _nameErr)),
        const SizedBox(height: 10),
        Row(children: [
          Expanded(child: TextField(controller: _phone, keyboardType: TextInputType.phone, textDirection: TextDirection.ltr, decoration: InputDecoration(labelText: tr('الجوال', 'Phone')))),
          const SizedBox(width: 10),
          Expanded(child: TextField(controller: _city, decoration: InputDecoration(labelText: tr('المدينة', 'City')))),
        ]),
        const SizedBox(height: 10),
        TextField(controller: _tax, keyboardType: TextInputType.number, textDirection: TextDirection.ltr, decoration: InputDecoration(labelText: tr('الرقم الضريبي', 'Tax number'))),
        const SizedBox(height: 10),
        TextField(controller: _notes, maxLines: 2, decoration: InputDecoration(labelText: tr('ملاحظات', 'Notes'))),
        const SizedBox(height: 14),
        SizedBox(width: double.infinity, child: FilledButton.icon(
          icon: const Icon(Icons.save_outlined, size: 18),
          label: Text(_busy ? tr('جارٍ الحفظ…', 'Saving…') : tr('حفظ', 'Save')),
          onPressed: _busy ? null : _save,
        )),
      ])),
    );
  }
}
