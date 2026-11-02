import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/lang.dart';
import 'theme.dart';

/// Values of a reference list in their Arabic text, which is what the record stores. The list may be empty or hidden from this role, so `fallback` is returned instead of throwing; the field stays writable either way.
Future<List<String>> loadLookupNames(String type, {List<String> fallback = const []}) async {
  try {
    final d = await Api.instance.get('/api/lookups?type=${Uri.encodeComponent(type)}&active=true');
    final names = <String>[];
    for (final x in List<Map<String, dynamic>>.from(d['items'] ?? [])) {
      final n = (x['nameAr'] ?? x['nameEn'] ?? '').toString().trim();
      if (n.isNotEmpty && !names.contains(n)) names.add(n);
    }
    return names.isEmpty ? fallback : names;
  } catch (_) {
    return fallback;
  }
}

/// Field picked from a reference list (`/api/lookups`) that also accepts typed text. The list is managed from Reference Data, and a field user may meet a value not yet added; blocking would mean a record that cannot be written. So the typed value is accepted and added to the list if allowed; without list-management rights the request is rejected (403) silently and the value stays in the field. The controller belongs to the form that places the field, so it is neither created nor disposed here.
class LookupField extends StatefulWidget {
  final String type;
  final TextEditingController controller;
  final String label;
  final String? hint;
  final List<String> fallback;
  final VoidCallback? onChanged;
  /// List owned by another section: a typed value is accepted in the field but not added to its list.
  final bool noAdd;
  const LookupField({
    super.key,
    required this.type,
    required this.controller,
    required this.label,
    this.hint,
    this.fallback = const [],
    this.onChanged,
    this.noAdd = false,
  });

  @override
  State<LookupField> createState() => _LookupFieldState();
}

class _LookupFieldState extends State<LookupField> {
  late List<String> _options = List.of(widget.fallback);

  @override
  void initState() {
    super.initState();
    _fetch();
  }

  Future<void> _fetch() async {
    final names = await loadLookupNames(widget.type, fallback: widget.fallback);
    if (mounted) setState(() => _options = names);
  }

  Future<void> _open() async {
    final picked = await showModalBottomSheet<_LookupPick>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (_) => _LookupSheet(title: widget.label, options: _options, current: widget.controller.text.trim()),
    );
    if (picked == null || !mounted) return;
    widget.controller.text = picked.value;
    widget.onChanged?.call();
    setState(() {});
    if (picked.isNew && picked.value.isNotEmpty && !widget.noAdd) {
      // Appears in the list immediately for the author and is saved there if permitted.
      setState(() => _options = [..._options, picked.value]);
      try {
        await Api.instance.post('/api/lookups', {'type': widget.type, 'nameEn': picked.value, 'nameAr': picked.value});
      } catch (_) {/* No list-management rights; the value stays in the field. */}
    }
  }

  @override
  Widget build(BuildContext context) {
    return TextField(
      controller: widget.controller,
      readOnly: true,
      onTap: _open,
      decoration: InputDecoration(
        labelText: widget.label,
        hintText: widget.hint,
        suffixIcon: const Icon(Icons.arrow_drop_down),
      ),
    );
  }
}

class _LookupPick {
  final String value;
  final bool isNew;
  const _LookupPick(this.value, {this.isNew = false});
}

class _LookupSheet extends StatefulWidget {
  final String title;
  final List<String> options;
  final String current;
  const _LookupSheet({required this.title, required this.options, required this.current});

  @override
  State<_LookupSheet> createState() => _LookupSheetState();
}

class _LookupSheetState extends State<_LookupSheet> {
  final _q = TextEditingController();

  @override
  void dispose() { _q.dispose(); super.dispose(); }

  @override
  Widget build(BuildContext context) {
    final typed = _q.text.trim();
    final k = typed.toLowerCase();
    final list = widget.options.where((o) => k.isEmpty || o.toLowerCase().contains(k)).toList();
    final exact = widget.options.any((o) => o.toLowerCase() == k);
    return SafeArea(
      child: Padding(
        padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
        child: SizedBox(
          height: MediaQuery.of(context).size.height * 0.6,
          child: Column(children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(14, 14, 14, 6),
              // The field carries the list title so it stays a TextField, with a clear button that also closes the sheet.
              child: TextField(
                controller: _q,
                onChanged: (_) => setState(() {}),
                textInputAction: TextInputAction.search,
                onSubmitted: (_) => FocusScope.of(context).unfocus(),
                onTapOutside: (_) => FocusScope.of(context).unfocus(),
                decoration: InputDecoration(
                  labelText: widget.title,
                  hintText: tr('ابحث أو اكتب قيمةً جديدة…', 'Search or type a new value…'),
                  prefixIcon: const Icon(Icons.search),
                  suffixIcon: _q.text.isEmpty ? null : IconButton(
                    icon: const Icon(Icons.close_rounded),
                    tooltip: tr('مسح البحث', 'Clear search'),
                    onPressed: () { _q.clear(); setState(() {}); FocusScope.of(context).unfocus(); },
                  ),
                ),
              ),
            ),
            Expanded(
              child: ListView(keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag, children: [
                if (typed.isNotEmpty && !exact)
                  ListTile(
                    dense: true,
                    leading: const Icon(Icons.add_circle_outline, color: T.orange, size: 20),
                    title: Text(tr('إضافة «$typed»', 'Add “$typed”'), style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13.5, color: T.orange)),
                    onTap: () => Navigator.pop(context, _LookupPick(typed, isNew: true)),
                  ),
                if (widget.current.isNotEmpty)
                  ListTile(
                    dense: true,
                    leading: const Icon(Icons.clear, color: T.inkFaint, size: 20),
                    title: Text(tr('— بلا قيمة —', '— none —'), style: const TextStyle(fontSize: 13, color: T.inkSoft)),
                    onTap: () => Navigator.pop(context, const _LookupPick('')),
                  ),
                ...list.map((o) => ListTile(
                      dense: true,
                      title: Text(o, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13.5)),
                      trailing: o == widget.current ? const Icon(Icons.check, color: T.success, size: 18) : null,
                      onTap: () => Navigator.pop(context, _LookupPick(o)),
                    )),
                if (list.isEmpty && typed.isEmpty)
                  Padding(
                    padding: const EdgeInsets.all(20),
                    child: Text(tr('القائمة فارغة — اكتب القيمة في خانة البحث لإضافتها.', 'The list is empty — type a value above to add it.'),
                        textAlign: TextAlign.center, style: const TextStyle(fontSize: 12.5, color: T.inkFaint)),
                  ),
              ]),
            ),
          ]),
        ),
      ),
    );
  }
}
