import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../ui/theme.dart';
import '../ui/search_field.dart';

/// زرُّ «إضافة» في «عملاء العقود» — نظيرُ زرَّي الويب: «إضافة عميل» و«اقتراحات»
/// (عملاء يشحنون معنا ولا سجلّ لهم: GET /api/contracts/customers/suggestions،
/// مرتّبون بعدد شحناتهم، يُضاف أحدُهم بضغطةٍ ثمّ تُكمَل بياناتُ عقده بالتعديل).
/// يرجع true إن أُضيف شيء فتُعاد قراءةُ القائمة.
Future<bool?> openContractsCustomerCreate(BuildContext context) {
  return showModalBottomSheet<bool>(
    context: context, isScrollControlled: true, backgroundColor: Colors.white,
    shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(22))),
    builder: (_) => const _CreateSheet(),
  );
}

String _fmtN(num v) {
  final s = v.round().toString();
  final b = StringBuffer();
  for (int i = 0; i < s.length; i++) { if (i > 0 && (s.length - i) % 3 == 0) b.write(','); b.write(s[i]); }
  return b.toString();
}

String _fold(String s) => s
    .replaceAll(RegExp('[أإآ]'), 'ا').replaceAll('ى', 'ي').replaceAll('ة', 'ه').toLowerCase();

class _CreateSheet extends StatefulWidget {
  const _CreateSheet();
  @override
  State<_CreateSheet> createState() => _CreateSheetState();
}

class _CreateSheetState extends State<_CreateSheet> {
  List<Map<String, dynamic>>? _sugs;
  String _q = '';
  final _searchCtl = TextEditingController(); // النصُّ يبقى مطابقًا لـ_q بعد تبديل التبويب
  String? _adding;
  bool _added = false, _saving = false;
  final _name = TextEditingController(), _sector = TextEditingController(), _contact = TextEditingController(),
      _phone = TextEditingController(), _rep = TextEditingController();

  @override
  void initState() { super.initState(); _loadSuggestions(); }

  @override
  void dispose() { for (final c in [_name, _sector, _contact, _phone, _rep, _searchCtl]) { c.dispose(); } super.dispose(); }

  void _snack(Object e) { if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e is ApiException ? e.message : e.toString()))); }

  Future<void> _loadSuggestions() async {
    try {
      final d = await Api.instance.get('/api/contracts/customers/suggestions');
      if (mounted) setState(() => _sugs = List<Map<String, dynamic>>.from((d['suggestions'] as List? ?? const []).whereType<Map>().map((e) => Map<String, dynamic>.from(e))));
    } catch (e) { _snack(e); if (mounted) setState(() => _sugs = const []); }
  }

  Future<void> _addSuggested(Map<String, dynamic> s) async {
    setState(() => _adding = s['nameKey']?.toString());
    try {
      await Api.instance.post('/api/contracts/customers', {'name': s['name']});
      _added = true;
      if (mounted) setState(() => _sugs = _sugs!.where((x) => x['nameKey'] != s['nameKey']).toList());
    } catch (e) { _snack(e); }
    if (mounted) setState(() => _adding = null);
  }

  Future<void> _createNew() async {
    if (_name.text.trim().isEmpty) { _snack(tr('اسم العميل مطلوب', 'Customer name is required')); return; }
    setState(() => _saving = true);
    try {
      await Api.instance.post('/api/contracts/customers', {
        'name': _name.text.trim(), 'sector': _sector.text.trim(), 'contactPerson': _contact.text.trim(),
        'phone': _phone.text.trim(), 'energizeRep': _rep.text.trim(),
      });
      if (mounted) Navigator.pop(context, true);
      return;
    } catch (e) { _snack(e); }
    if (mounted) setState(() => _saving = false);
  }

  @override
  Widget build(BuildContext context) {
    final q = _fold(_q.trim());
    final shown = (_sugs ?? const <Map<String, dynamic>>[]).where((s) => q.isEmpty || _fold('${s['name']}').contains(q)).toList();
    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (did, _) { if (!did) Navigator.pop(context, _added); },
      child: Padding(
        padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
        child: SizedBox(
          height: MediaQuery.of(context).size.height * 0.88,
          child: DefaultTabController(
            length: 2,
            child: Column(children: [
              TabBar(labelColor: T.orange, indicatorColor: T.orange, tabs: [
                Tab(text: tr('إضافة عميل', 'Add customer')),
                Tab(text: tr('اقتراحات', 'Suggestions')),
              ]),
              Expanded(child: TabBarView(children: [
                ListView(padding: const EdgeInsets.all(16), children: [
                  TextField(controller: _name, decoration: InputDecoration(labelText: '${tr('اسم العميل', 'Customer name')} *')),
                  const SizedBox(height: 10),
                  TextField(controller: _sector, decoration: InputDecoration(labelText: tr('القطاع', 'Sector'))),
                  const SizedBox(height: 10),
                  TextField(controller: _contact, decoration: InputDecoration(labelText: tr('جهة الاتصال', 'Contact person'))),
                  const SizedBox(height: 10),
                  TextField(controller: _phone, keyboardType: TextInputType.phone, decoration: InputDecoration(labelText: tr('رقم الجوال', 'Phone'))),
                  const SizedBox(height: 10),
                  TextField(controller: _rep, decoration: InputDecoration(labelText: tr('مسؤول التنشيط لدينا', 'Our rep'))),
                  const SizedBox(height: 6),
                  Text(tr('بقيّةُ بيانات العقد تُكمَل بالتعديل من القائمة.', 'Complete the contract details by editing it from the list.'),
                      style: const TextStyle(fontSize: 11.5, color: T.inkFaint)),
                  const SizedBox(height: 12),
                  FilledButton.icon(
                    style: FilledButton.styleFrom(backgroundColor: T.orange),
                    onPressed: _saving ? null : _createNew,
                    icon: const Icon(Icons.save_outlined), label: Text(tr('حفظ', 'Save')),
                  ),
                ]),
                Column(children: [
                  Padding(
                    padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
                    child: Text(
                      tr('عملاء يشحنون معنا ولا سجل لهم — مأخوذون من كشوف التشغيل ومرتّبون بعدد شحناتهم. تُضيفه بضغطة ثم تكمل بيانات عقده.',
                         'Customers shipping with us, not registered — from the operations reports, largest first. One tap registers them; fill their contract after.'),
                      style: const TextStyle(fontSize: 12, color: T.inkSoft),
                    ),
                  ),
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
                    child: SearchField(
                      controller: _searchCtl,
                      hint: tr('ابحث بالاسم…', 'Search by name…'),
                      onChanged: (v) => setState(() => _q = v),
                    ),
                  ),
                  Expanded(
                    child: _sugs == null
                        ? const Center(child: CircularProgressIndicator())
                        : shown.isEmpty
                            ? Center(child: Padding(
                                padding: const EdgeInsets.all(24),
                                child: Text(q.isNotEmpty ? tr('لا نتائج مطابقة', 'No matches') : tr('لا عميلَ خارج السجل — كلُّ من يشحن معنا مسجَّل.', 'Nobody outside the register — everyone shipping with us is registered.'),
                                    textAlign: TextAlign.center, style: const TextStyle(color: T.inkFaint)),
                              ))
                            : ListView.separated(
                                keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
                                itemCount: shown.length,
                                separatorBuilder: (_, __) => const Divider(height: 1),
                                itemBuilder: (_, i) {
                                  final s = shown[i];
                                  final busy = _adding == s['nameKey']?.toString();
                                  final last = (s['lastLoad'] ?? '').toString();
                                  return ListTile(
                                    title: Text('${s['name'] ?? ''}', style: const TextStyle(fontWeight: FontWeight.w700)),
                                    subtitle: Text(
                                      '${tr('${_fmtN(s['loads'] ?? 0)} شحنة', '${_fmtN(s['loads'] ?? 0)} loads')} · ${_fmtN(s['value'] ?? 0)} ${tr('ر.س', 'SAR')}'
                                      '${last.isNotEmpty ? ' · ${tr('آخر شحنة', 'last')} ${last.split('T').first}' : ''}',
                                      style: const TextStyle(fontSize: 11.5),
                                    ),
                                    trailing: FilledButton.tonalIcon(
                                      onPressed: busy ? null : () => _addSuggested(s),
                                      icon: busy ? const SizedBox(width: 14, height: 14, child: CircularProgressIndicator(strokeWidth: 2)) : const Icon(Icons.add, size: 16),
                                      label: Text(tr('إضافة', 'Add')),
                                    ),
                                  );
                                },
                              ),
                  ),
                ]),
              ])),
            ]),
          ),
        ),
      ),
    );
  }
}
