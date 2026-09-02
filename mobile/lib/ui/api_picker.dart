import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../ui/widgets.dart';

/// منتقي بحثٍ عام: يجلب من endpoint ويعرض قائمةً قابلةً للبحث، ويرجّع المختار.
///
/// كان يعيش داخل شاشة «التحصيلات والنزاعات» ويستورده منها قسمُ المشتريات —
/// فحذفُ الشاشة كسر قسمًا لا علاقة له بها. الأداةُ المشتركة موضعُها `ui/`،
/// لا جوفُ شاشةٍ تصادف أنّها أوّلُ من احتاجها.

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
      setState(() { _rows = raw is List ? List<Map<String, dynamic>>.from(raw.whereType<Map>().map((e) => Map<String, dynamic>.from(e))) : []; _loading = false; _error = null; });
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
