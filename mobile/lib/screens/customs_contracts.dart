import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/customs_contract_pricing.dart';
import '../ui/file_upload.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';
import 'customs_party.dart' show customsOpenFile;

/// Customs contracts on mobile, counterpart of components/customs/CustomsContracts:
/// - Contract attachments: upload the signed copy (POST /contracts/:id/files with a data URL, like the web), open it, delete it (DELETE /contracts/:id/files/:attId).
/// - "Our contracts with them" panel in the party profile: only its contracts, with create/edit/delete; prices apply to the customer contract. Same source as the contracts page (customs:contract).

List<Map<String, dynamic>> _maps(dynamic v) =>
    v is List ? [for (final e in v) if (e is Map) Map<String, dynamic>.from(e)] : [];
String _s(Map r, String k) => '${r[k] ?? ''}';
String _dt(dynamic v) {
  final d = DateTime.tryParse('${v ?? ''}');
  return d == null ? '—' : '${d.day.toString().padLeft(2, '0')}/${d.month.toString().padLeft(2, '0')}/${d.year}';
}

const _stateMeta = {
  'active': ('ساري', 'Active', T.success),
  'draft': ('مسودّة', 'Draft', T.inkSoft),
  'expired': ('منتهٍ', 'Expired', T.danger),
  'terminated': ('مفسوخ', 'Terminated', T.warn),
};
const _basis = [
  ('', '—', '—'), ('total', 'إجمالي العقد', 'Total'), ('per_container', 'للحاوية', 'Per container'),
  ('per_month', 'شهريًّا', 'Per month'), ('per_shipment', 'للشحنة', 'Per shipment'),
];

/// Contract attachments sheet, opened from its row. Returns true if anything changed.
Future<bool> manageCustomsContractFiles(BuildContext context, Map<String, dynamic> contract, {bool canEdit = true}) async {
  final changed = await showModalBottomSheet<bool>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    builder: (_) => _FilesSheet(contract: contract, canEdit: canEdit),
  );
  return changed == true;
}

class _FilesSheet extends StatefulWidget {
  final Map<String, dynamic> contract;
  final bool canEdit;
  const _FilesSheet({required this.contract, required this.canEdit});
  @override
  State<_FilesSheet> createState() => _FilesSheetState();
}

class _FilesSheetState extends State<_FilesSheet> {
  late List<Map<String, dynamic>> _files = _maps(widget.contract['attachments']);
  bool _busy = false, _changed = false;

  String get _id => '${widget.contract['_id']}';

  /// The contract is re-read from the list after every write; the server does not always return attachments.
  Future<void> _refresh() async {
    try {
      final d = await Api.instance.get('/api/customs-clearance/contracts?party=${Uri.encodeQueryComponent(_s(widget.contract, 'party'))}');
      final hit = _maps(d['contracts']).where((c) => '${c['_id']}' == _id);
      if (hit.isNotEmpty && mounted) setState(() => _files = _maps(hit.first['attachments']));
    } catch (_) {/* */}
  }

  Future<void> _upload() async {
    final picked = await pickFilesAsDataUrls();
    if (picked.isEmpty || !mounted) return;
    setState(() => _busy = true);
    final messenger = ScaffoldMessenger.of(context);
    try {
      final r = await Api.instance.post('/api/customs-clearance/contracts/$_id/files', {
        'files': [for (final f in picked) {'dataUrl': f.dataUrl, 'fileName': f.fileName, 'title': f.fileName}],
      });
      _changed = true;
      final c = r is Map && r['contract'] is Map ? r['contract'] as Map : null;
      if (c != null && mounted) {
        setState(() => _files = _maps(c['attachments']));
      } else {
        await _refresh();
      }
    } catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(e.toString().isNotEmpty ? e.toString() : tr('تعذّر رفع الملف', 'Upload failed'))));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _drop(Map<String, dynamic> a) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: Text(tr('حذف المرفق؟', 'Delete attachment?')),
        content: Text('${a['title'] ?? a['fileName'] ?? ''}'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: Text(tr('إلغاء', 'Cancel'))),
          FilledButton(style: FilledButton.styleFrom(backgroundColor: T.danger), onPressed: () => Navigator.pop(c, true), child: Text(tr('حذف', 'Delete'))),
        ],
      ),
    );
    if (ok != true || !mounted) return;
    setState(() => _busy = true);
    final messenger = ScaffoldMessenger.of(context);
    try {
      await Api.instance.delete('/api/customs-clearance/contracts/$_id/files/${a['_id']}');
      _changed = true;
      setState(() => _files.removeWhere((x) => '${x['_id']}' == '${a['_id']}'));
    } catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(e.toString())));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) { if (!didPop) Navigator.pop(context, _changed); },
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 20),
        child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Text('${tr('مرفقات العقد', 'Contract files')} — ${_s(widget.contract, 'title')}', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
          const SizedBox(height: 10),
          if (_files.isEmpty) Text(tr('لا مرفقات بعد.', 'No files yet.'), style: const TextStyle(color: T.inkFaint, fontSize: 12.5)),
          for (final a in _files)
            ListTile(
              dense: true,
              contentPadding: EdgeInsets.zero,
              leading: const Icon(Icons.attach_file_rounded, color: T.navy),
              title: Text('${a['title'] ?? a['fileName'] ?? '—'}', maxLines: 1, overflow: TextOverflow.ellipsis),
              onTap: () => customsOpenFile(context, a['fileUrl']),
              trailing: widget.canEdit
                  ? IconButton(icon: const Icon(Icons.delete_outline, color: T.danger), onPressed: _busy ? null : () => _drop(a))
                  : null,
            ),
          if (widget.canEdit) ...[
            const SizedBox(height: 10),
            FilledButton.icon(
              onPressed: _busy ? null : _upload,
              icon: _busy ? const SizedBox(width: 14, height: 14, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white)) : const Icon(Icons.upload_rounded),
              label: Text(tr('رفع ملف', 'Upload file')),
            ),
          ],
        ]),
      ),
    );
  }
}

/// "Our contracts with them" in the party profile: contracts of one party (`?party=`), with the party filled in automatically.
class CustomsPartyContracts extends StatefulWidget {
  final String partyId, partyName, partyKind;
  final bool canEdit;
  const CustomsPartyContracts({super.key, required this.partyId, required this.partyName, required this.partyKind, required this.canEdit});
  @override
  State<CustomsPartyContracts> createState() => _CustomsPartyContractsState();
}

class _CustomsPartyContractsState extends State<CustomsPartyContracts> {
  List<Map<String, dynamic>>? _rows;
  int _seq = 0;
  late final void Function() _onLive;

  @override
  void initState() {
    super.initState();
    _onLive = () => _load();
    _load();
    // A contract written from the contracts page appears here instantly, and the reverse.
    Live.instance.on('customs:contract', _onLive);
  }

  @override
  void dispose() {
    Live.instance.off('customs:contract', _onLive);
    super.dispose();
  }

  Future<void> _load() async {
    final mine = ++_seq;
    try {
      final d = await Api.instance.get('/api/customs-clearance/contracts?party=${Uri.encodeQueryComponent(widget.partyId)}');
      if (mounted && mine == _seq) setState(() => _rows = _maps(d['contracts']));
    } catch (_) {
      if (mounted && mine == _seq) setState(() => _rows = const []);
    }
  }

  Future<void> _edit([Map<String, dynamic>? c]) async {
    final saved = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (_) => FractionallySizedBox(heightFactor: 0.92, child: _ContractForm(contract: c, partyId: widget.partyId)),
    );
    if (saved == true) _load();
  }

  Future<void> _remove(Map<String, dynamic> c) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (d) => AlertDialog(
        content: Text(tr('حذف العقد «${_s(c, 'title')}»؟ يُحذف معه مرفقُه.', 'Delete "${_s(c, 'title')}"? Its files go with it.')),
        actions: [
          TextButton(onPressed: () => Navigator.pop(d, false), child: Text(tr('إلغاء', 'Cancel'))),
          FilledButton(style: FilledButton.styleFrom(backgroundColor: T.danger), onPressed: () => Navigator.pop(d, true), child: Text(tr('حذف', 'Delete'))),
        ],
      ),
    );
    if (ok != true || !mounted) return;
    final messenger = ScaffoldMessenger.of(context);
    try {
      await Api.instance.delete('/api/customs-clearance/contracts/${c['_id']}');
      _load();
    } catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(e.toString())));
    }
  }

  @override
  Widget build(BuildContext context) {
    final rows = _rows;
    return AppCard(
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Row(children: [
          const Icon(Icons.assignment_outlined, size: 16, color: T.orange),
          const SizedBox(width: 6),
          Expanded(child: Text(tr('العقود', 'Contracts'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14))),
          if (widget.canEdit)
            TextButton.icon(onPressed: () => _edit(), icon: const Icon(Icons.add, size: 16), label: Text(tr('عقد جديد', 'New contract'))),
        ]),
        if (rows == null) const LinearProgressIndicator(minHeight: 2)
        else if (rows.isEmpty) Text(tr('لا عقود بعد', 'No contracts yet'), style: const TextStyle(fontSize: 12.5, color: T.inkFaint)),
        for (final c in rows ?? const <Map<String, dynamic>>[])
          () {
            final st = _stateMeta[_s(c, 'state').isNotEmpty ? _s(c, 'state') : _s(c, 'status')] ?? _stateMeta['draft']!;
            final files = _maps(c['attachments']);
            final days = c['daysLeft'];
            return Container(
              margin: const EdgeInsets.only(top: 8),
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(color: T.canvas, borderRadius: BorderRadius.circular(10)),
              child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                Row(children: [
                  Expanded(child: Text(_s(c, 'title'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13))),
                  Chip2(tr(st.$1, st.$2), st.$3),
                ]),
                Text([
                  if (_s(c, 'contractNumber').isNotEmpty) '#${_s(c, 'contractNumber')}',
                  '${_dt(c['startDate'])} → ${_dt(c['endDate'])}',
                  if (c['value'] != null) '${c['value']}${_s(c, 'valueBasis').isNotEmpty ? ' (${tr(_basis.firstWhere((b) => b.$1 == _s(c, 'valueBasis'), orElse: () => _basis.first).$2, _basis.firstWhere((b) => b.$1 == _s(c, 'valueBasis'), orElse: () => _basis.first).$3)})' : ''}',
                  if ((c['paymentTermDays'] ?? 0) is num && (c['paymentTermDays'] as num) > 0) tr('سداد ${c['paymentTermDays']} يومًا', '${c['paymentTermDays']} days terms'),
                  if (c['autoRenew'] == true) tr('تجديد تلقائي', 'auto-renews'),
                ].join(' · '), style: const TextStyle(fontSize: 11.5, color: T.inkSoft)),
                if (days is num && days >= 0 && days <= 60)
                  Text(tr('$days يومًا', '$days days left'), style: const TextStyle(fontSize: 11, color: T.warn)),
                Wrap(spacing: 4, children: [
                  TextButton.icon(
                    onPressed: () async { if (await manageCustomsContractFiles(context, c, canEdit: widget.canEdit)) _load(); },
                    icon: const Icon(Icons.attach_file_rounded, size: 16),
                    label: Text('${tr('المرفقات', 'Files')} (${files.length})'),
                  ),
                  if (widget.canEdit && widget.partyKind == 'customer')
                    TextButton.icon(
                      onPressed: () async { if (await editCustomsContractPricing(context, c)) _load(); },
                      icon: const Icon(Icons.price_change_outlined, size: 16),
                      label: Text(tr('الأسعار', 'Prices')),
                    ),
                  if (widget.canEdit) ...[
                    IconButton(visualDensity: VisualDensity.compact, icon: const Icon(Icons.edit_outlined, size: 18), onPressed: () => _edit(c)),
                    IconButton(visualDensity: VisualDensity.compact, icon: const Icon(Icons.delete_outline, size: 18, color: T.danger), onPressed: () => _remove(c)),
                  ],
                ]),
              ]),
            );
          }(),
      ]),
    );
  }
}

/// Contract form: the web form fields; the party is the profile owner.
class _ContractForm extends StatefulWidget {
  final Map<String, dynamic>? contract;
  final String partyId;
  const _ContractForm({required this.contract, required this.partyId});
  @override
  State<_ContractForm> createState() => _ContractFormState();
}

class _ContractFormState extends State<_ContractForm> {
  late final Map<String, dynamic> _c = widget.contract ?? const {};
  late final _title = TextEditingController(text: _s(_c, 'title'));
  late final _number = TextEditingController(text: _s(_c, 'contractNumber'));
  late final _value = TextEditingController(text: _c['value'] == null ? '' : '${_c['value']}');
  late final _terms = TextEditingController(text: '${_c['paymentTermDays'] ?? 0}');
  late final _scope = TextEditingController(text: _s(_c, 'scope'));
  late final _notes = TextEditingController(text: _s(_c, 'notes'));
  late String _start = _s(_c, 'startDate').length >= 10 ? _s(_c, 'startDate').substring(0, 10) : '';
  late String _end = _s(_c, 'endDate').length >= 10 ? _s(_c, 'endDate').substring(0, 10) : '';
  late String _valueBasis = _s(_c, 'valueBasis');
  late String _status = _s(_c, 'status').isEmpty ? 'active' : _s(_c, 'status');
  late bool _autoRenew = _c['autoRenew'] == true;
  bool _saving = false;
  String? _error;

  @override
  void dispose() {
    for (final c in [_title, _number, _value, _terms, _scope, _notes]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _save() async {
    if (_title.text.trim().isEmpty) { setState(() => _error = tr('اكتب اسم العقد', 'Name the contract')); return; }
    setState(() { _saving = true; _error = null; });
    final body = {
      'title': _title.text.trim(),
      'contractNumber': _number.text.trim(),
      'party': widget.partyId,
      'startDate': _start.isEmpty ? null : _start,
      'endDate': _end.isEmpty ? null : _end,
      'value': _value.text.trim().isEmpty ? null : num.tryParse(_value.text.trim()),
      'valueBasis': _valueBasis,
      'paymentTermDays': int.tryParse(_terms.text.trim()) ?? 0,
      'autoRenew': _autoRenew,
      'status': _status,
      'scope': _scope.text.trim(),
      'notes': _notes.text.trim(),
    };
    try {
      if (_c['_id'] != null) {
        await Api.instance.put('/api/customs-clearance/contracts/${_c['_id']}', body);
      } else {
        await Api.instance.post('/api/customs-clearance/contracts', body);
      }
      if (mounted) Navigator.pop(context, true);
    } catch (e) {
      if (mounted) setState(() { _saving = false; _error = e.toString(); });
    }
  }

  Widget _date(String label, String value, void Function(String) set) => Expanded(
        child: OutlinedButton(
          onPressed: () async {
            final d = await showDatePicker(context: context, initialDate: DateTime.tryParse(value) ?? DateTime.now(), firstDate: DateTime(2015), lastDate: DateTime(2100));
            if (d != null) setState(() => set(d.toIso8601String().substring(0, 10)));
          },
          onLongPress: () => setState(() => set('')),
          child: Text('$label: ${value.isEmpty ? '—' : value}', style: const TextStyle(fontSize: 12)),
        ),
      );

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.fromLTRB(16, 16, 16, MediaQuery.of(context).viewInsets.bottom + 12),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Text(_c['_id'] != null ? tr('تعديل العقد', 'Edit contract') : tr('عقد جديد', 'New contract'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16)),
        const SizedBox(height: 10),
        Expanded(
          child: ListView(children: [
            TextField(controller: _title, decoration: InputDecoration(labelText: tr('اسم العقد', 'Contract name'))),
            TextField(controller: _number, decoration: InputDecoration(labelText: tr('رقم العقد', 'Contract no.'))),
            const SizedBox(height: 10),
            Row(children: [_date(tr('يبدأ', 'Starts'), _start, (v) => _start = v), const SizedBox(width: 8), _date(tr('ينتهي', 'Ends'), _end, (v) => _end = v)]),
            TextField(controller: _value, keyboardType: const TextInputType.numberWithOptions(decimal: true), decoration: InputDecoration(labelText: tr('القيمة', 'Value'))),
            DropdownButtonFormField<String>(
              initialValue: _basis.any((b) => b.$1 == _valueBasis) ? _valueBasis : '',
              decoration: InputDecoration(labelText: tr('أساس القيمة', 'Value basis')),
              items: [for (final b in _basis) DropdownMenuItem(value: b.$1, child: Text(tr(b.$2, b.$3)))],
              onChanged: (v) => setState(() => _valueBasis = v ?? ''),
            ),
            TextField(controller: _terms, keyboardType: TextInputType.number, decoration: InputDecoration(labelText: tr('مهلة السداد (يوم)', 'Payment terms (days)'))),
            DropdownButtonFormField<String>(
              initialValue: _status,
              decoration: InputDecoration(labelText: tr('الحالة', 'State')),
              items: [for (final e in _stateMeta.entries) DropdownMenuItem(value: e.key, child: Text(tr(e.value.$1, e.value.$2)))],
              onChanged: (v) => setState(() => _status = v ?? 'active'),
            ),
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              title: Text(tr('تجديد تلقائي', 'Auto-renews')),
              value: _autoRenew,
              onChanged: (v) => setState(() => _autoRenew = v),
            ),
            TextField(controller: _scope, decoration: InputDecoration(labelText: tr('ما يغطّيه العقد', 'Scope'))),
            TextField(controller: _notes, minLines: 2, maxLines: 4, decoration: InputDecoration(labelText: tr('ملاحظات', 'Notes'))),
            if (_error != null) Padding(padding: const EdgeInsets.only(top: 8), child: Text(_error!, style: const TextStyle(color: T.danger, fontSize: 12.5))),
          ]),
        ),
        const SizedBox(height: 8),
        FilledButton(onPressed: _saving ? null : _save, child: Text(tr('حفظ', 'Save'))),
      ]),
    );
  }
}
