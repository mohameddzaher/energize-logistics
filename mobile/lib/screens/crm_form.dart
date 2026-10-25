import 'package:flutter/material.dart';
import '../services/lang.dart';
import '../ui/theme.dart';

/// نموذجٌ صغيرٌ في ورقةٍ سفليّة — نظيرُ Modal + Field في CrmKit على الويب.
/// يُستعمل لتعديل الشركة وإضافة جهة اتصال/نشاط/مهمّة/صفقة من ملفّها، ولمهامّ
/// العلاقات وتعديل الحملة. الضوابطُ في حالة الودجت لا في دالّة البناء —
/// وإلّا أُعيد إنشاؤها مع كلّ حرف (راجع inline-components-remount).
enum CrmFieldKind { text, multiline, number, select, date, datetime, check }

class CrmField {
  final String key, ar, en;
  final CrmFieldKind kind;
  /// (القيمة، عربي، إنجليزي)
  final List<(String, String, String)> options;
  final bool required;
  final bool ltr;
  const CrmField(this.key, this.ar, this.en,
      {this.kind = CrmFieldKind.text, this.options = const [], this.required = false, this.ltr = false});
}

/// يفتح النموذج ويُرجع القيم (نصوص، أرقام، منطقيّ) أو null عند الإلغاء.
Future<Map<String, dynamic>?> showCrmForm(
  BuildContext context, {
  required String title,
  required List<CrmField> fields,
  Map<String, dynamic> initial = const {},
  Future<String?> Function(Map<String, dynamic> values)? onSave,
}) {
  return showModalBottomSheet<Map<String, dynamic>>(
    context: context,
    isScrollControlled: true,
    backgroundColor: Colors.white,
    shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(22))),
    builder: (_) => _CrmFormSheet(title: title, fields: fields, initial: initial, onSave: onSave),
  );
}

class _CrmFormSheet extends StatefulWidget {
  final String title;
  final List<CrmField> fields;
  final Map<String, dynamic> initial;
  final Future<String?> Function(Map<String, dynamic> values)? onSave;
  const _CrmFormSheet({required this.title, required this.fields, required this.initial, this.onSave});
  @override
  State<_CrmFormSheet> createState() => _CrmFormSheetState();
}

String _dateOnly(dynamic v) {
  final s = (v ?? '').toString();
  if (s.isEmpty) return '';
  final d = DateTime.tryParse(s);
  if (d == null) return s.split('T').first;
  final l = d.toLocal();
  return '${l.year}-${l.month.toString().padLeft(2, '0')}-${l.day.toString().padLeft(2, '0')}';
}

class _CrmFormSheetState extends State<_CrmFormSheet> {
  final Map<String, TextEditingController> _ctrls = {};
  final Map<String, dynamic> _vals = {};
  bool _busy = false;
  String? _err;

  @override
  void initState() {
    super.initState();
    for (final f in widget.fields) {
      final v = widget.initial[f.key];
      switch (f.kind) {
        case CrmFieldKind.text:
        case CrmFieldKind.multiline:
        case CrmFieldKind.number:
          _ctrls[f.key] = TextEditingController(text: v == null ? '' : v.toString());
        case CrmFieldKind.check:
          _vals[f.key] = v == true;
        case CrmFieldKind.date:
          _vals[f.key] = _dateOnly(v);
        case CrmFieldKind.datetime:
          _vals[f.key] = (v is String && v.isNotEmpty) ? DateTime.tryParse(v)?.toLocal() : (v is DateTime ? v : null);
        case CrmFieldKind.select:
          _vals[f.key] = (v ?? '').toString();
      }
    }
  }

  @override
  void dispose() {
    for (final c in _ctrls.values) { c.dispose(); }
    super.dispose();
  }

  Map<String, dynamic> _collect() {
    final out = <String, dynamic>{};
    for (final f in widget.fields) {
      switch (f.kind) {
        case CrmFieldKind.text:
        case CrmFieldKind.multiline:
          out[f.key] = _ctrls[f.key]!.text.trim();
        case CrmFieldKind.number:
          final t = _ctrls[f.key]!.text.trim();
          out[f.key] = t.isEmpty ? 0 : (num.tryParse(t) ?? 0);
        case CrmFieldKind.datetime:
          final d = _vals[f.key] as DateTime?;
          out[f.key] = d?.toUtc().toIso8601String();
        default:
          out[f.key] = _vals[f.key];
      }
    }
    return out;
  }

  Future<void> _save() async {
    final v = _collect();
    for (final f in widget.fields) {
      if (f.required && (v[f.key] == null || v[f.key].toString().trim().isEmpty)) {
        setState(() => _err = tr('«${f.ar}» مطلوب', '"${f.en}" is required'));
        return;
      }
    }
    if (widget.onSave == null) { Navigator.pop(context, v); return; }
    setState(() { _busy = true; _err = null; });
    final err = await widget.onSave!(v);
    if (!mounted) return;
    if (err == null) { Navigator.pop(context, v); return; }
    setState(() { _busy = false; _err = err; });
  }

  Widget _field(CrmField f) {
    final label = tr(f.ar, f.en);
    switch (f.kind) {
      case CrmFieldKind.text:
      case CrmFieldKind.multiline:
      case CrmFieldKind.number:
        return TextField(
          controller: _ctrls[f.key],
          maxLines: f.kind == CrmFieldKind.multiline ? 3 : 1,
          keyboardType: f.kind == CrmFieldKind.number ? const TextInputType.numberWithOptions(decimal: true) : null,
          textDirection: f.ltr || f.kind == CrmFieldKind.number ? TextDirection.ltr : null,
          decoration: InputDecoration(labelText: label),
        );
      case CrmFieldKind.check:
        return CheckboxListTile(
          contentPadding: EdgeInsets.zero, dense: true,
          value: _vals[f.key] == true, title: Text(label),
          onChanged: (x) => setState(() => _vals[f.key] = x == true),
        );
      case CrmFieldKind.select:
        final cur = (_vals[f.key] ?? '').toString();
        final opts = [...f.options];
        if (cur.isNotEmpty && !opts.any((o) => o.$1 == cur)) opts.add((cur, cur, cur));
        return DropdownButtonFormField<String>(
          initialValue: cur,
          isExpanded: true,
          decoration: InputDecoration(labelText: label),
          items: [
            if (!opts.any((o) => o.$1 == '')) const DropdownMenuItem(value: '', child: Text('—')),
            for (final o in opts) DropdownMenuItem(value: o.$1, child: Text(tr(o.$2, o.$3), overflow: TextOverflow.ellipsis)),
          ],
          onChanged: (x) => setState(() => _vals[f.key] = x ?? ''),
        );
      case CrmFieldKind.date:
        final s = (_vals[f.key] ?? '').toString();
        return InkWell(
          onTap: () async {
            final d = await showDatePicker(
              context: context,
              initialDate: DateTime.tryParse(s) ?? DateTime.now(),
              firstDate: DateTime(2015), lastDate: DateTime(2040),
            );
            if (d != null) setState(() => _vals[f.key] = _dateOnly(d.toIso8601String()));
          },
          child: InputDecorator(
            decoration: InputDecoration(
              labelText: label,
              suffixIcon: s.isEmpty ? const Icon(Icons.event) : IconButton(icon: const Icon(Icons.clear), onPressed: () => setState(() => _vals[f.key] = '')),
            ),
            child: Text(s.isEmpty ? '—' : s),
          ),
        );
      case CrmFieldKind.datetime:
        final d = _vals[f.key] as DateTime?;
        return InkWell(
          onTap: () async {
            final base = d ?? DateTime.now();
            final day = await showDatePicker(context: context, initialDate: base, firstDate: DateTime(2015), lastDate: DateTime(2040));
            if (day == null || !mounted) return;
            final t = await showTimePicker(context: context, initialTime: TimeOfDay.fromDateTime(base));
            setState(() => _vals[f.key] = DateTime(day.year, day.month, day.day, t?.hour ?? base.hour, t?.minute ?? base.minute));
          },
          child: InputDecorator(
            decoration: InputDecoration(labelText: label, suffixIcon: const Icon(Icons.schedule)),
            child: Text(d == null ? '—' : '${_dateOnly(d.toIso8601String())} ${d.hour.toString().padLeft(2, '0')}:${d.minute.toString().padLeft(2, '0')}'),
          ),
        );
    }
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
      child: SafeArea(
        child: ConstrainedBox(
          constraints: BoxConstraints(maxHeight: MediaQuery.of(context).size.height * 0.88),
          child: ListView(shrinkWrap: true, padding: const EdgeInsets.fromLTRB(18, 16, 18, 18), children: [
            Text(widget.title, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16)),
            const SizedBox(height: 10),
            for (final f in widget.fields) Padding(padding: const EdgeInsets.only(bottom: 10), child: _field(f)),
            if (_err != null) Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Text(_err!, style: const TextStyle(color: T.danger, fontSize: 12.5)),
            ),
            Row(children: [
              Expanded(
                child: FilledButton(
                  style: FilledButton.styleFrom(backgroundColor: T.orange),
                  onPressed: _busy ? null : _save,
                  child: _busy
                      ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                      : Text(tr('حفظ', 'Save')),
                ),
              ),
              const SizedBox(width: 8),
              TextButton(onPressed: () => Navigator.pop(context), child: Text(tr('إلغاء', 'Cancel'))),
            ]),
          ]),
        ),
      ),
    );
  }
}

/// قائمةُ خياراتٍ من /api/crm/options: [{key,nameAr,nameEn}] → (value, ar, en).
List<(String, String, String)> crmOpts(dynamic list) => [
      if (list is List)
        for (final o in list.whereType<Map>())
          ('${o['key'] ?? ''}', '${o['nameAr'] ?? o['key'] ?? ''}', '${o['nameEn'] ?? o['key'] ?? ''}'),
    ];

/// المسؤولون من /api/crm/options.owners → (id, اسم, اسم).
List<(String, String, String)> crmOwners(dynamic list) => [
      if (list is List)
        for (final o in list.whereType<Map>())
          () {
            final n = '${o['firstName'] ?? ''} ${o['lastName'] ?? ''}'.trim();
            return ('${o['_id']}', n, n);
          }(),
    ];

/// نصُّ خيارٍ بمفتاحه.
String crmOptLabel(List<(String, String, String)> opts, dynamic key) {
  final k = (key ?? '').toString();
  for (final o in opts) {
    if (o.$1 == k) return tr(o.$2, o.$3);
  }
  return k;
}
