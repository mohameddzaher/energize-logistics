import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/lang.dart';
import 'theme.dart';

/// One editable field of a bulk edit: text, number, date, or multi-line.
class BulkFieldSpec {
  final String key;
  final String ar;
  final String en;
  final String type; // text | number | date | textarea
  const BulkFieldSpec(this.key, this.ar, this.en, [this.type = 'text']);
}

/// «تعديل بيانات» for a selection, mirror of the web BulkEditPanel: only filled fields are sent, and the server runs the single edit on each row
/// (backend utils/bulkViaSingle), reporting the rows it refused with the reason. Returns true when anything was saved.
Future<bool> openBulkEdit(BuildContext context, {required List<String> ids, required String endpoint, required List<BulkFieldSpec> fields}) async {
  final ctrls = {for (final f in fields) f.key: TextEditingController()};
  bool saved = false;
  await showModalBottomSheet(
    context: context,
    isScrollControlled: true,
    builder: (ctx) {
      bool busy = false;
      List failed = const [];
      return StatefulBuilder(builder: (ctx, setS) {
        Future<void> save() async {
          final body = <String, dynamic>{};
          for (final f in fields) {
            final v = ctrls[f.key]!.text.trim();
            if (v.isEmpty) continue;
            body[f.key] = f.type == 'number' ? (num.tryParse(v) ?? v) : v;
          }
          if (body.isEmpty) return;
          setS(() => busy = true);
          try {
            final r = await Api.instance.post(endpoint, {'ids': ids, 'fields': body}) as Map;
            saved = saved || (r['done'] ?? 0) > 0;
            if (ctx.mounted) ScaffoldMessenger.of(ctx).showSnackBar(SnackBar(content: Text('${r['message'] ?? ''}')));
            if ((r['failedCount'] ?? 0) == 0) {
              if (ctx.mounted) Navigator.pop(ctx);
              return;
            }
            setS(() => failed = (r['failed'] as List?) ?? const []);
          } catch (e) {
            if (ctx.mounted) ScaffoldMessenger.of(ctx).showSnackBar(SnackBar(content: Text(e is ApiException ? e.message : e.toString())));
          }
          setS(() => busy = false);
        }

        return Padding(
          padding: EdgeInsets.only(bottom: MediaQuery.of(ctx).viewInsets.bottom),
          child: SafeArea(
            child: SizedBox(
              height: MediaQuery.of(ctx).size.height * 0.8,
              child: ListView(padding: const EdgeInsets.all(16), children: [
                Text(tr('تعديل بيانات ${ids.length} صفًّا', 'Edit ${ids.length} rows'), style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w900)),
                const SizedBox(height: 4),
                Text(tr('غيِّر ما تريد فقط — ما تتركه فارغًا لا يُغيَّر.', 'Change only what you need — blank fields stay unchanged.'), style: const TextStyle(fontSize: 12, color: T.inkFaint)),
                const SizedBox(height: 12),
                for (final f in fields)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 10),
                    child: f.type == 'date'
                        ? TextField(
                            controller: ctrls[f.key], readOnly: true,
                            decoration: InputDecoration(labelText: tr(f.ar, f.en), suffixIcon: const Icon(Icons.event_outlined)),
                            onTap: () async {
                              final d = await showDatePicker(context: ctx, initialDate: DateTime.now(), firstDate: DateTime(2020), lastDate: DateTime(2100));
                              if (d != null) setS(() => ctrls[f.key]!.text = d.toIso8601String().substring(0, 10));
                            },
                          )
                        : TextField(
                            controller: ctrls[f.key],
                            maxLines: f.type == 'textarea' ? 3 : 1,
                            keyboardType: f.type == 'number' ? const TextInputType.numberWithOptions(decimal: true) : TextInputType.text,
                            decoration: InputDecoration(labelText: tr(f.ar, f.en)),
                          ),
                  ),
                if (failed.isNotEmpty)
                  Container(
                    padding: const EdgeInsets.all(10),
                    decoration: BoxDecoration(color: T.danger.withValues(alpha: 0.08), borderRadius: BorderRadius.circular(10)),
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Text(tr('لم يُحفظ:', 'Not saved:'), style: const TextStyle(fontWeight: FontWeight.w800, color: T.danger)),
                      for (final x in failed) Text('${(x as Map)['label']} — ${x['message']}', style: const TextStyle(fontSize: 12, color: T.danger)),
                    ]),
                  ),
                const SizedBox(height: 8),
                FilledButton(
                  onPressed: busy ? null : save,
                  style: FilledButton.styleFrom(backgroundColor: const Color(0xFF7C3AED)),
                  child: busy ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white)) : Text(tr('حفظ على ${ids.length}', 'Save on ${ids.length}')),
                ),
              ]),
            ),
          ),
        );
      });
    },
  );
  for (final c in ctrls.values) { c.dispose(); }
  return saved;
}
