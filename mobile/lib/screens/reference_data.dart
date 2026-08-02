import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../ui/app_scaffold.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';

/// البيانات المرجعية — إدارة كل القوائم المنسدلة القابلة للتعديل في النظام.
/// مطابقة لصفحة الويب /system/settings/reference-data: قائمة الأنواع مجمّعة
/// حسب الوحدة، وكل نوع يُفتح على محرّر قيمه (إضافة/تعديل/حذف).
class ReferenceDataScreen extends StatefulWidget {
  const ReferenceDataScreen({super.key});
  @override
  State<ReferenceDataScreen> createState() => _ReferenceDataScreenState();
}

class _ReferenceDataScreenState extends State<ReferenceDataScreen> {
  List<Map<String, dynamic>> _types = [];
  bool _loading = true;
  String? _error;
  String _q = '';

  @override
  void initState() { super.initState(); _load(); }

  Future<void> _load() async {
    try {
      final d = await Api.instance.get('/api/lookups/types');
      if (!mounted) return;
      setState(() { _types = List<Map<String, dynamic>>.from(d['types'] ?? []); _loading = false; _error = null; });
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  String _fold(String s) => s.replaceAll(RegExp('[أإآ]'), 'ا').replaceAll('ى', 'ي').replaceAll('ة', 'ه').toLowerCase();
  String _name(Map<String, dynamic> t) => (Lang.instance.ar ? t['nameAr'] : t['nameEn'])?.toString() ?? (t['type'] ?? '').toString();

  @override
  Widget build(BuildContext context) {
    final q = _fold(_q.trim());
    final types = q.isEmpty ? _types : _types.where((t) => _fold('${_name(t)} ${t['module'] ?? ''} ${t['type'] ?? ''}').contains(q)).toList();
    final byModule = <String, List<Map<String, dynamic>>>{};
    for (final t in types) {
      final m = (t['module'] ?? '—').toString();
      byModule.putIfAbsent(m, () => []).add(t);
    }

    return AppScaffold(
      title: Text(tr('البيانات المرجعية', 'Reference Data')),
      body: _loading
          ? ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(height: 50), SizedBox(height: 10), Shimmer(height: 120)])
          : _error != null
              ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
              : Column(children: [
                  Padding(
                    padding: const EdgeInsets.fromLTRB(14, 12, 14, 6),
                    child: TextField(
                      onChanged: (v) => setState(() => _q = v),
                      decoration: InputDecoration(hintText: tr('ابحث عن قائمة…', 'Search a list…'), prefixIcon: const Icon(Icons.search)),
                    ),
                  ),
                  Expanded(
                    child: ListView(
                      padding: const EdgeInsets.all(14),
                      children: byModule.entries.map((g) => Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Padding(
                                padding: const EdgeInsets.symmetric(vertical: 8),
                                child: Text(g.key, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13.5, color: T.inkSoft)),
                              ),
                              ...g.value.map((t) => Padding(
                                    padding: const EdgeInsets.only(bottom: 8),
                                    child: Pressable(
                                      onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => LookupValuesScreen(
                                            type: (t['type'] ?? '').toString(), title: _name(t), canManage: t['canManage'] == true))),
                                      child: AppCard(
                                        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 13),
                                        child: Row(children: [
                                          const Icon(Icons.list_alt_outlined, color: T.navy, size: 20),
                                          const SizedBox(width: 10),
                                          Expanded(child: Text(_name(t), style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13.5))),
                                          if (t['canManage'] != true) const Icon(Icons.lock_outline, size: 15, color: T.inkFaint),
                                          Icon(Lang.instance.ar ? Icons.chevron_left : Icons.chevron_right, color: T.inkFaint),
                                        ]),
                                      ),
                                    ),
                                  )),
                            ],
                          )).toList(),
                    ),
                  ),
                ]),
    );
  }
}

/// محرّر قيم قائمة مرجعية واحدة — إضافة/تعديل/حذف (لو canManage).
class LookupValuesScreen extends StatefulWidget {
  final String type, title;
  final bool canManage;
  const LookupValuesScreen({super.key, required this.type, required this.title, required this.canManage});
  @override
  State<LookupValuesScreen> createState() => _LookupValuesScreenState();
}

class _LookupValuesScreenState extends State<LookupValuesScreen> {
  List<Map<String, dynamic>> _items = [];
  bool _loading = true;
  String? _error;

  @override
  void initState() { super.initState(); _load(); }

  Future<void> _load() async {
    try {
      final d = await Api.instance.get('/api/lookups?type=${Uri.encodeComponent(widget.type)}');
      if (!mounted) return;
      setState(() { _items = List<Map<String, dynamic>>.from(d['items'] ?? []); _loading = false; _error = null; });
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  Future<void> _edit({Map<String, dynamic>? item}) async {
    final ar = TextEditingController(text: item?['nameAr']?.toString() ?? '');
    final en = TextEditingController(text: item?['nameEn']?.toString() ?? '');
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: Text(item == null ? tr('إضافة قيمة', 'Add value') : tr('تعديل القيمة', 'Edit value')),
        content: Column(mainAxisSize: MainAxisSize.min, children: [
          TextField(controller: ar, decoration: InputDecoration(labelText: tr('الاسم بالعربي', 'Arabic name'))),
          const SizedBox(height: 10),
          TextField(controller: en, decoration: InputDecoration(labelText: tr('الاسم بالإنجليزي', 'English name'))),
        ]),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: Text(tr('إلغاء', 'Cancel'))),
          FilledButton(onPressed: () => Navigator.pop(c, true), child: Text(tr('حفظ', 'Save'))),
        ],
      ),
    );
    if (ok != true) return;
    final nameAr = ar.text.trim(), nameEn = en.text.trim();
    if (nameAr.isEmpty && nameEn.isEmpty) return;
    try {
      if (item == null) {
        await Api.instance.post('/api/lookups', {'type': widget.type, 'nameEn': nameEn.isEmpty ? nameAr : nameEn, 'nameAr': nameAr.isEmpty ? nameEn : nameAr});
      } else {
        await Api.instance.put('/api/lookups/${item['_id']}', {'nameEn': nameEn, 'nameAr': nameAr});
      }
      _load();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    }
  }

  Future<void> _delete(Map<String, dynamic> item) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: Text(tr('حذف', 'Delete')),
        content: Text(tr('حذف «${item['nameAr'] ?? item['nameEn']}»؟', 'Delete "${item['nameEn'] ?? item['nameAr']}"?')),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: Text(tr('إلغاء', 'Cancel'))),
          FilledButton(style: FilledButton.styleFrom(backgroundColor: T.danger), onPressed: () => Navigator.pop(c, true), child: Text(tr('حذف', 'Delete'))),
        ],
      ),
    );
    if (ok != true) return;
    try { await Api.instance.delete('/api/lookups/${item['_id']}'); _load(); }
    catch (e) { if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString()))); }
  }

  @override
  Widget build(BuildContext context) {
    return AppScaffold(
      title: Text(widget.title),
      floatingActionButton: widget.canManage
          ? FloatingActionButton.extended(
              backgroundColor: const Color(0xFF12325C), foregroundColor: Colors.white,
              icon: const Icon(Icons.add), label: Text(tr('إضافة', 'Add')), onPressed: () => _edit())
          : null,
      body: _loading
          ? ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(height: 54), SizedBox(height: 10), Shimmer(height: 54)])
          : _error != null
              ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
              : RefreshIndicator(
                  onRefresh: _load,
                  child: _items.isEmpty
                      ? EmptyState(icon: Icons.list_outlined, title: tr('لا توجد قيم بعد', 'No values yet'))
                      : ListView.separated(
                          padding: const EdgeInsets.all(14),
                          itemCount: _items.length,
                          separatorBuilder: (_, __) => const SizedBox(height: 8),
                          itemBuilder: (c, i) {
                            final it = _items[i];
                            return AppCard(
                              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                              child: Row(children: [
                                Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                  Text((it['nameAr'] ?? '').toString(), style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13.5)),
                                  if ((it['nameEn'] ?? '').toString().isNotEmpty)
                                    Text((it['nameEn']).toString(), style: const TextStyle(fontSize: 11.5, color: T.inkFaint)),
                                ])),
                                if (it['isSystem'] == true) Chip2(tr('نظام', 'System'), T.inkFaint),
                                if (widget.canManage) ...[
                                  IconButton(icon: const Icon(Icons.edit_outlined, size: 19, color: T.navy), onPressed: () => _edit(item: it)),
                                  if (it['isSystem'] != true)
                                    IconButton(icon: const Icon(Icons.delete_outline, size: 19, color: T.danger), onPressed: () => _delete(it)),
                                ],
                              ]),
                            );
                          },
                        ),
                ),
    );
  }
}
