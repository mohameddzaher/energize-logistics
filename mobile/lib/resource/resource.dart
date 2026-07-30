import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';

/// The native CRUD engine: one generic screen that gives ANY system resource
/// a full native page — list + Arabic-folded search + create + edit + delete,
/// live over the same socket events as the web. A new page of the system is
/// a ResourceConfig entry, not a new hand-written screen.

enum FieldType { text, textarea, number, date, checkbox, select, phone, email }

class FieldSpec {
  final String name;
  final String ar;
  final String en;
  final FieldType type;
  final bool required;
  final List<(String, String, String)>? options; // (value, ar, en)
  const FieldSpec(this.name, this.ar, this.en,
      {this.type = FieldType.text, this.required = false, this.options});

  String get label => tr(ar, en);
}

class ResourceConfig {
  final String arTitle;
  final String enTitle;
  final IconData icon;
  final String endpoint;      // '/api/fleet/drivers'
  final String listKey;       // 'drivers'
  final String listQuery;     // extra query for the LIST GET only (e.g. 'all=1') — kept off endpoint so /:id actions stay clean
  final String updateMethod;  // 'PUT' | 'PATCH'
  final String liveEvent;     // 'fleet:updated'
  final List<String> searchFields;
  final List<FieldSpec> fields;
  final String Function(Map<String, dynamic>) titleOf;
  final String Function(Map<String, dynamic>)? subtitleOf;
  final List<(String, Color)> Function(Map<String, dynamic>)? chipsOf;
  final bool canCreate;
  final bool canEdit;
  final bool canDelete;
  /// عند ضبطها: نقرة الصف تفتح ملفًا كاملًا بدل ورقة التحرير (والتحرير من أيقونة القلم).
  final void Function(BuildContext, Map<String, dynamic>)? onOpen;

  const ResourceConfig({
    required this.arTitle, required this.enTitle, required this.icon,
    required this.endpoint, required this.listKey,
    this.listQuery = '', this.updateMethod = 'PUT', required this.liveEvent,
    required this.searchFields, required this.fields, required this.titleOf,
    this.subtitleOf, this.chipsOf,
    this.canCreate = true, this.canEdit = true, this.canDelete = true,
    this.onOpen,
  });

  String get title => tr(arTitle, enTitle);
}

String _fold(String s) => s
    .replaceAll(RegExp('[أإآ]'), 'ا').replaceAll('ى', 'ي').replaceAll('ة', 'ه')
    .replaceAll('ؤ', 'و').replaceAll('ئ', 'ي').toLowerCase();

class ResourceScreen extends StatefulWidget {
  final ResourceConfig config;
  const ResourceScreen({super.key, required this.config});

  @override
  State<ResourceScreen> createState() => _ResourceScreenState();
}

class _ResourceScreenState extends State<ResourceScreen> {
  List<Map<String, dynamic>> _rows = [];
  bool _loading = true;
  String? _error;
  String _q = '';
  late final void Function() _onLive;

  ResourceConfig get cfg => widget.config;

  @override
  void initState() {
    super.initState();
    _load();
    _onLive = () => _load();
    Live.instance.on(cfg.liveEvent, _onLive);
  }

  @override
  void dispose() {
    Live.instance.off(cfg.liveEvent, _onLive);
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final qs = [if (cfg.listQuery.isNotEmpty) cfg.listQuery, 'limit=200'].join('&');
      final d = await Api.instance.get('${cfg.endpoint}?$qs');
      if (!mounted) return;
      // نتحمّل أي شكل استجابة: {listKey:[...]} أو مصفوفة مباشرة — بلا كراش.
      final raw = d is Map ? d[cfg.listKey] : (d is List ? d : null);
      setState(() {
        _rows = raw is List ? List<Map<String, dynamic>>.from(raw.whereType<Map>().map((e) => Map<String, dynamic>.from(e))) : [];
        _loading = false;
        _error = null;
      });
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  Future<void> _delete(Map<String, dynamic> row) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: Text(tr('تأكيد الحذف', 'Confirm delete')),
        content: Text(tr('هل تريد حذف «${cfg.titleOf(row)}» نهائيًا؟', 'Delete "${cfg.titleOf(row)}"?')),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: Text(tr('إلغاء', 'Cancel'))),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: T.danger),
            onPressed: () => Navigator.pop(c, true),
            child: Text(tr('حذف', 'Delete')),
          ),
        ],
      ),
    );
    if (ok != true) return;
    try {
      await Api.instance.delete('${cfg.endpoint}/${row['_id']}');
      _load();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    }
  }

  void _openForm({Map<String, dynamic>? row}) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(22))),
      builder: (c) => _ResourceForm(
        cfg: cfg,
        row: row,
        onDone: _load,
        onDelete: row != null && cfg.canDelete ? () { Navigator.pop(c); _delete(row); } : null,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final q = _fold(_q.trim());
    final filtered = _rows.where((r) {
      if (q.isEmpty) return true;
      return cfg.searchFields.any((f) => _fold((r[f] ?? '').toString()).contains(q));
    }).toList();

    return AppScaffold(
      title: Text(cfg.title),
      floatingActionButton: cfg.canCreate
          ? FloatingActionButton.extended(
              backgroundColor: T.navy,
              foregroundColor: Colors.white,
              onPressed: () => _openForm(),
              icon: const Icon(Icons.add),
              label: Text(tr('إضافة', 'Add')),
            )
          : null,
      body: _loading
          ? ListView(padding: const EdgeInsets.all(14), children: const [
              Shimmer(height: 48), SizedBox(height: 10), Shimmer(), SizedBox(height: 10),
              Shimmer(), SizedBox(height: 10), Shimmer(),
            ])
          : _error != null
              ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
              : Column(children: [
                  Padding(
                    padding: const EdgeInsets.fromLTRB(14, 12, 14, 4),
                    child: TextField(
                      onChanged: (v) => setState(() => _q = v),
                      decoration: InputDecoration(
                        hintText: tr('ابحث…', 'Search…'),
                        prefixIcon: const Icon(Icons.search),
                        suffixText: '${filtered.length}',
                      ),
                    ),
                  ),
                  Expanded(
                    child: RefreshIndicator(
                      onRefresh: _load,
                      child: filtered.isEmpty
                          ? EmptyState(icon: cfg.icon, title: tr('لا توجد بيانات مطابقة', 'No matches'))
                          : ListView.separated(
                              padding: const EdgeInsets.fromLTRB(14, 8, 14, 90),
                              itemCount: filtered.length,
                              separatorBuilder: (_, __) => const SizedBox(height: 8),
                              itemBuilder: (c, i) {
                                final r = filtered[i];
                                final chips = cfg.chipsOf?.call(r) ?? const [];
                                return FadeSlideIn(
                                  delayMs: (i * 15).clamp(0, 150),
                                  child: Pressable(
                                    onTap: cfg.onOpen != null
                                        ? () => cfg.onOpen!(context, r)
                                        : cfg.canEdit ? () => _openForm(row: r) : null,
                                    onLongPress: cfg.onOpen != null && cfg.canEdit ? () => _openForm(row: r) : null,
                                    child: AppCard(
                                      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                                      child: Row(children: [
                                        Container(
                                          padding: const EdgeInsets.all(9),
                                          decoration: BoxDecoration(
                                            color: T.navy.withValues(alpha: 0.07),
                                            borderRadius: BorderRadius.circular(11),
                                          ),
                                          child: Icon(cfg.icon, size: 19, color: T.navy),
                                        ),
                                        const SizedBox(width: 10),
                                        Expanded(
                                          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                            Text(cfg.titleOf(r),
                                                style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13.5),
                                                maxLines: 1, overflow: TextOverflow.ellipsis),
                                            if (cfg.subtitleOf != null && cfg.subtitleOf!(r).isNotEmpty)
                                              Text(cfg.subtitleOf!(r),
                                                  style: const TextStyle(fontSize: 11.5, color: T.inkSoft),
                                                  maxLines: 1, overflow: TextOverflow.ellipsis),
                                            if (chips.any((c2) => c2.$1.isNotEmpty)) ...[
                                              const SizedBox(height: 4),
                                              Wrap(spacing: 4, runSpacing: 4, children: chips.where((c2) => c2.$1.isNotEmpty).map((c2) => Chip2(c2.$1, c2.$2)).toList()),
                                            ],
                                          ]),
                                        ),
                                        if (cfg.canEdit)
                                          Icon(Lang.instance.ar ? Icons.chevron_left : Icons.chevron_right, color: T.inkFaint),
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
}

/// The generic create/edit form: builds inputs from FieldSpecs, saves with
/// POST (create) or the configured PUT/PATCH (edit), delete in the header.
class _ResourceForm extends StatefulWidget {
  final ResourceConfig cfg;
  final Map<String, dynamic>? row;
  final Future<void> Function() onDone;
  final VoidCallback? onDelete;
  const _ResourceForm({required this.cfg, this.row, required this.onDone, this.onDelete});

  @override
  State<_ResourceForm> createState() => _ResourceFormState();
}

class _ResourceFormState extends State<_ResourceForm> {
  final Map<String, dynamic> _values = {};
  final Map<String, TextEditingController> _ctrls = {};
  bool _busy = false;

  bool get isEdit => widget.row != null;

  @override
  void initState() {
    super.initState();
    for (final f in widget.cfg.fields) {
      final v = widget.row?[f.name];
      switch (f.type) {
        case FieldType.checkbox:
          _values[f.name] = v == true;
        case FieldType.select:
          _values[f.name] = (v ?? '').toString();
        case FieldType.date:
          _values[f.name] = v != null ? (v.toString().split('T').first) : '';
        default:
          _ctrls[f.name] = TextEditingController(text: (v ?? '').toString());
      }
    }
  }

  @override
  void dispose() {
    for (final c in _ctrls.values) { c.dispose(); }
    super.dispose();
  }

  Future<void> _save() async {
    final body = <String, dynamic>{};
    for (final f in widget.cfg.fields) {
      switch (f.type) {
        case FieldType.checkbox:
          body[f.name] = _values[f.name] == true;
        case FieldType.select:
          body[f.name] = _values[f.name];
        case FieldType.date:
          body[f.name] = (_values[f.name] as String).isEmpty ? null : _values[f.name];
        case FieldType.number:
          final t = _ctrls[f.name]!.text.trim();
          body[f.name] = t.isEmpty ? null : num.tryParse(t);
        default:
          body[f.name] = _ctrls[f.name]!.text.trim();
      }
      if (f.required && (body[f.name] == null || body[f.name].toString().trim().isEmpty)) {
        ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text(tr('حقل «${f.label}» مطلوب', '"${f.label}" is required'))));
        return;
      }
    }
    setState(() => _busy = true);
    try {
      if (isEdit) {
        final path = '${widget.cfg.endpoint}/${widget.row!['_id']}';
        widget.cfg.updateMethod == 'PATCH'
            ? await Api.instance.patch(path, body)
            : await Api.instance.put(path, body);
      } else {
        await Api.instance.post(widget.cfg.endpoint, body);
      }
      await widget.onDone();
      if (mounted) Navigator.pop(context);
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
      child: DraggableScrollableSheet(
        expand: false,
        initialChildSize: 0.8,
        maxChildSize: 0.95,
        builder: (c, scroll) => ListView(
          controller: scroll,
          padding: const EdgeInsets.all(18),
          children: [
            Row(children: [
              Expanded(
                child: Text(
                  isEdit ? tr('تعديل — ${widget.cfg.titleOf(widget.row!)}', 'Edit') : tr('إضافة ${widget.cfg.arTitle}', 'Add ${widget.cfg.enTitle}'),
                  style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w800),
                  maxLines: 1, overflow: TextOverflow.ellipsis,
                ),
              ),
              if (widget.onDelete != null)
                IconButton(
                  icon: const Icon(Icons.delete_outline, color: T.danger),
                  tooltip: tr('حذف', 'Delete'),
                  onPressed: widget.onDelete,
                ),
            ]),
            const SizedBox(height: 12),
            ...widget.cfg.fields.map(_buildField),
            const SizedBox(height: 14),
            FilledButton(
              onPressed: _busy ? null : _save,
              child: _busy
                  ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                  : Text(isEdit ? tr('حفظ التعديلات', 'Save changes') : tr('إضافة', 'Add')),
            ),
            const SizedBox(height: 10),
          ],
        ),
      ),
    );
  }

  Widget _buildField(FieldSpec f) {
    const pad = EdgeInsets.only(bottom: 10);
    switch (f.type) {
      case FieldType.checkbox:
        return Padding(
          padding: pad,
          child: SwitchListTile(
            contentPadding: EdgeInsets.zero,
            title: Text(f.label, style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600)),
            value: _values[f.name] == true,
            activeTrackColor: T.success,
            onChanged: (v) => setState(() => _values[f.name] = v),
          ),
        );
      case FieldType.select:
        // قيمة الصف قد تكون null أو قيمة قديمة مش في options — نتحمّل الاتنين بلا كراش.
        final current = (_values[f.name] ?? '').toString();
        final opts = f.options ?? const <(String, String, String)>[];
        final known = opts.any((o) => o.$1 == current);
        return Padding(
          padding: pad,
          child: DropdownButtonFormField<String>(
            initialValue: current.isEmpty ? null : current,
            decoration: InputDecoration(labelText: f.label + (f.required ? ' *' : '')),
            items: [
              ...opts.map((o) => DropdownMenuItem(value: o.$1, child: Text(tr(o.$2, o.$3)))),
              if (current.isNotEmpty && !known) DropdownMenuItem(value: current, child: Text(current)),
            ],
            onChanged: (v) => setState(() => _values[f.name] = v ?? ''),
          ),
        );
      case FieldType.date:
        final val = _values[f.name] as String;
        return Padding(
          padding: pad,
          child: OutlinedButton.icon(
            icon: const Icon(Icons.calendar_month_outlined, size: 18),
            style: OutlinedButton.styleFrom(
              minimumSize: const Size.fromHeight(48),
              alignment: AlignmentDirectional.centerStart,
            ),
            label: Text('${f.label}: ${val.isEmpty ? tr('اختر التاريخ', 'Pick date') : val}',
                style: const TextStyle(fontSize: 14)),
            onPressed: () async {
              final d = await showDatePicker(
                context: context,
                initialDate: DateTime.tryParse(val) ?? DateTime.now(),
                firstDate: DateTime(2020),
                lastDate: DateTime(2032),
              );
              if (d != null) setState(() => _values[f.name] = d.toIso8601String().split('T').first);
            },
          ),
        );
      default:
        return Padding(
          padding: pad,
          child: TextField(
            controller: _ctrls[f.name],
            maxLines: f.type == FieldType.textarea ? 3 : 1,
            keyboardType: f.type == FieldType.number
                ? TextInputType.number
                : f.type == FieldType.phone
                    ? TextInputType.phone
                    : f.type == FieldType.email
                        ? TextInputType.emailAddress
                        : TextInputType.text,
            textDirection: (f.type == FieldType.number || f.type == FieldType.phone || f.type == FieldType.email)
                ? TextDirection.ltr
                : null,
            decoration: InputDecoration(labelText: f.label + (f.required ? ' *' : '')),
          ),
        );
    }
  }
}
