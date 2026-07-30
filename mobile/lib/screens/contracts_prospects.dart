import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';

/// تنشيط الموردين الجدد — native: the outreach log with interest states and
/// the one-tap «تحويل إلى مورد».
class ContractsProspectsScreen extends StatefulWidget {
  const ContractsProspectsScreen({super.key});
  @override
  State<ContractsProspectsScreen> createState() => _ContractsProspectsScreenState();
}

class _ContractsProspectsScreenState extends State<ContractsProspectsScreen> {
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
    Live.instance.on('contracts:updated', _onLive);
  }

  @override
  void dispose() {
    Live.instance.off('contracts:updated', _onLive);
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final d = await Api.instance.get('/api/contracts/prospects');
      if (!mounted) return;
      setState(() {
        _rows = List<Map<String, dynamic>>.from(d['prospects'] ?? []);
        _loading = false;
        _error = null;
      });
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  Future<void> _convert(Map<String, dynamic> p) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: Text(tr('تحويل إلى مورد', 'Convert to vendor')),
        content: Text(tr('تحويل «${p['companyName']}» إلى مورد في السجل الرسمي؟', 'Convert "${p['companyName']}" to a vendor?')),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: Text(tr('إلغاء', 'Cancel'))),
          FilledButton(onPressed: () => Navigator.pop(c, true), child: Text(tr('تحويل', 'Convert'))),
        ],
      ),
    );
    if (ok != true) return;
    try {
      await Api.instance.post('/api/contracts/prospects/${p['_id']}/convert');
      _load();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(tr('تم التحويل — الشركة الآن في سجل الموردين', 'Converted to the vendor register'))));
      }
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    }
  }

  // إضافة/تعديل شركة تنشيط — نفس حقول الويب.
  Future<void> _form([Map<String, dynamic>? p]) async {
    final companyName = TextEditingController(text: (p?['companyName'] ?? '').toString());
    final contactPerson = TextEditingController(text: (p?['contactPerson'] ?? '').toString());
    final phone = TextEditingController(text: (p?['phone'] ?? '').toString());
    final headquarters = TextEditingController(text: (p?['headquarters'] ?? '').toString());
    final destinations = TextEditingController(text: (p?['destinations'] ?? '').toString());
    final vehicleType = TextEditingController(text: (p?['vehicleType'] ?? '').toString());
    final notes = TextEditingController(text: (p?['notes'] ?? '').toString());
    String interest = p == null ? 'following' : (p['isInterested'] == true ? 'interested' : p['isInterested'] == false ? 'not' : 'following');
    final ok = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      builder: (c) => StatefulBuilder(builder: (c, setS) => SafeArea(
        child: Padding(
          padding: EdgeInsets.fromLTRB(16, 12, 16, MediaQuery.of(c).viewInsets.bottom + 16),
          child: SingleChildScrollView(
            child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(p == null ? tr('شركة جديدة للتنشيط', 'New prospect') : tr('تعديل الشركة', 'Edit prospect'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
              const SizedBox(height: 12),
              TextField(controller: companyName, decoration: InputDecoration(labelText: tr('اسم الشركة *', 'Company *'))),
              const SizedBox(height: 10),
              Row(children: [
                Expanded(child: TextField(controller: contactPerson, decoration: InputDecoration(labelText: tr('جهة الاتصال', 'Contact')))),
                const SizedBox(width: 10),
                Expanded(child: TextField(controller: phone, keyboardType: TextInputType.phone, textDirection: TextDirection.ltr, decoration: InputDecoration(labelText: tr('الهاتف', 'Phone')))),
              ]),
              const SizedBox(height: 10),
              TextField(controller: headquarters, decoration: InputDecoration(labelText: tr('المقر', 'Headquarters'))),
              const SizedBox(height: 10),
              Row(children: [
                Expanded(child: TextField(controller: destinations, decoration: InputDecoration(labelText: tr('الوجهات', 'Destinations')))),
                const SizedBox(width: 10),
                Expanded(child: TextField(controller: vehicleType, decoration: InputDecoration(labelText: tr('نوع المركبات', 'Vehicle type')))),
              ]),
              const SizedBox(height: 10),
              DropdownButtonFormField<String>(
                initialValue: interest,
                decoration: InputDecoration(labelText: tr('حالة الاهتمام', 'Interest')),
                items: [
                  DropdownMenuItem(value: 'following', child: Text(tr('قيد المتابعة', 'Following up'))),
                  DropdownMenuItem(value: 'interested', child: Text(tr('مهتم', 'Interested'))),
                  DropdownMenuItem(value: 'not', child: Text(tr('غير مهتم', 'Not interested'))),
                ],
                onChanged: (v) => setS(() => interest = v ?? interest),
              ),
              const SizedBox(height: 10),
              TextField(controller: notes, maxLines: 2, decoration: InputDecoration(labelText: tr('ملاحظات', 'Notes'))),
              const SizedBox(height: 14),
              SizedBox(width: double.infinity, child: FilledButton(onPressed: () => Navigator.pop(c, true), child: Text(tr('حفظ', 'Save')))),
            ]),
          ),
        ),
      )),
    );
    if (ok != true || companyName.text.trim().isEmpty) return;
    final body = {
      'companyName': companyName.text.trim(),
      'contactPerson': contactPerson.text.trim(),
      'phone': phone.text.trim(),
      'headquarters': headquarters.text.trim(),
      'destinations': destinations.text.trim(),
      'vehicleType': vehicleType.text.trim(),
      'notes': notes.text.trim(),
      'isInterested': interest == 'interested' ? true : interest == 'not' ? false : null,
    };
    try {
      if (p == null) {
        await Api.instance.post('/api/contracts/prospects', body);
      } else {
        await Api.instance.patch('/api/contracts/prospects/${p['_id']}', body);
      }
      _load();
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(tr('تم الحفظ', 'Saved'))));
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    }
  }

  Future<void> _delete(Map<String, dynamic> p) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: Text(tr('حذف', 'Delete')),
        content: Text(tr('حذف «${p['companyName']}» من سجل التنشيط؟', 'Delete "${p['companyName']}"?')),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: Text(tr('إلغاء', 'Cancel'))),
          FilledButton(style: FilledButton.styleFrom(backgroundColor: T.danger), onPressed: () => Navigator.pop(c, true), child: Text(tr('حذف', 'Delete'))),
        ],
      ),
    );
    if (ok != true) return;
    try {
      await Api.instance.delete('/api/contracts/prospects/${p['_id']}');
      _load();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    }
  }

  String _fold(String s) => s.replaceAll(RegExp('[أإآ]'), 'ا').replaceAll('ى', 'ي').replaceAll('ة', 'ه').toLowerCase();

  @override
  Widget build(BuildContext context) {
    final q = _fold(_q.trim());
    final filtered = _rows.where((p) {
      if (q.isEmpty) return true;
      return [p['companyName'], p['contactPerson'], p['phone'], p['headquarters']].any((x) => _fold((x ?? '').toString()).contains(q));
    }).toList();

    return AppScaffold(
      title: Text(tr('تنشيط الموردين الجدد', 'Prospect Outreach')),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => _form(),
        icon: const Icon(Icons.add),
        label: Text(tr('شركة جديدة', 'New prospect')),
      ),
      body: _loading
          ? ListView(padding: const EdgeInsets.all(14), children: const [
              Shimmer(height: 48), SizedBox(height: 10), Shimmer(height: 110), SizedBox(height: 10), Shimmer(height: 110),
            ])
          : _error != null
              ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
              : Column(children: [
                  Padding(
                    padding: const EdgeInsets.fromLTRB(14, 12, 14, 4),
                    child: TextField(
                      onChanged: (v) => setState(() => _q = v),
                      decoration: InputDecoration(
                        hintText: tr('ابحث بالاسم أو المقر…', 'Search…'),
                        prefixIcon: const Icon(Icons.search),
                      ),
                    ),
                  ),
                  Expanded(
                    child: RefreshIndicator(
                      onRefresh: _load,
                      child: filtered.isEmpty
                          ? EmptyState(icon: Icons.phone_in_talk_outlined, title: tr('لا توجد شركات في سجل التنشيط', 'No prospects'))
                          : ListView.separated(
                              padding: const EdgeInsets.all(14),
                              itemCount: filtered.length,
                              separatorBuilder: (_, __) => const SizedBox(height: 8),
                              itemBuilder: (c, i) {
                                final p = filtered[i];
                                final converted = p['convertedVendor'] != null;
                                final interested = p['isInterested'] == true;
                                final notInterested = p['isInterested'] == false;
                                final color = converted ? T.cyan : interested ? T.success : notInterested ? T.danger : T.inkFaint;
                                final label = converted
                                    ? tr('تحوّلت إلى مورد', 'Converted')
                                    : interested
                                        ? tr('مهتم', 'Interested')
                                        : notInterested
                                            ? tr('غير مهتم', 'Not interested')
                                            : tr('قيد المتابعة', 'Following up');
                                return FadeSlideIn(
                                  delayMs: (i * 25).clamp(0, 250),
                                  child: AppCard(
                                    topAccent: color,
                                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                      Row(children: [
                                        Expanded(child: Text(p['companyName'] ?? '', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14))),
                                        Chip2(label, color),
                                      ]),
                                      const SizedBox(height: 6),
                                      Wrap(spacing: 6, runSpacing: 6, children: [
                                        if ((p['contactPerson'] ?? '').toString().isNotEmpty) Chip2(p['contactPerson'], T.inkSoft, icon: Icons.person_outline),
                                        if ((p['phone'] ?? '').toString().isNotEmpty) Chip2(p['phone'], T.navy, icon: Icons.phone_outlined),
                                        if ((p['headquarters'] ?? '').toString().isNotEmpty) Chip2(p['headquarters'], T.cyan, icon: Icons.location_on_outlined),
                                      ]),
                                      if ((p['notes'] ?? '').toString().isNotEmpty) ...[
                                        const SizedBox(height: 6),
                                        Text(p['notes'], style: const TextStyle(fontSize: 12, color: T.inkSoft), maxLines: 2, overflow: TextOverflow.ellipsis),
                                      ],
                                      const SizedBox(height: 6),
                                      Row(children: [
                                        TextButton.icon(
                                          onPressed: () => _form(p),
                                          icon: const Icon(Icons.edit_outlined, size: 17),
                                          label: Text(tr('تعديل', 'Edit'), style: const TextStyle(fontSize: 12.5)),
                                          style: TextButton.styleFrom(padding: const EdgeInsets.symmetric(horizontal: 8), minimumSize: const Size(0, 34)),
                                        ),
                                        TextButton.icon(
                                          onPressed: () => _delete(p),
                                          icon: const Icon(Icons.delete_outline, size: 17, color: T.danger),
                                          label: Text(tr('حذف', 'Delete'), style: const TextStyle(fontSize: 12.5, color: T.danger)),
                                          style: TextButton.styleFrom(padding: const EdgeInsets.symmetric(horizontal: 8), minimumSize: const Size(0, 34)),
                                        ),
                                        const Spacer(),
                                        if (!converted)
                                          FilledButton.tonalIcon(
                                            onPressed: () => _convert(p),
                                            style: FilledButton.styleFrom(minimumSize: const Size(0, 34), padding: const EdgeInsets.symmetric(horizontal: 12)),
                                            icon: const Icon(Icons.upgrade_rounded, size: 16),
                                            label: Text(tr('تحويل', 'Convert'), style: const TextStyle(fontSize: 12.5)),
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
