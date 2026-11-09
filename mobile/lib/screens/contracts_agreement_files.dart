import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';
import '../config.dart';
import '../services/api.dart';
import '../services/auth.dart';
import '../services/lang.dart';
import '../ui/file_upload.dart';
import '../ui/theme.dart';

/// Section contract attachments, the counterpart of the contract attachments dialog in /system/contracts/agreements: files are listed and opened, and whoever can edit uploads and deletes the contract file.
const _contractsEditRoles = ['super_admin', 'admin', 'contracts_manager', 'contracts_staff', 'it_manager', 'it_specialist', 'sales_manager', 'sales_rep', 'vendors_manager', 'vendors_team_leader', 'vendors_staff'];

Future<bool> openAgreementFiles(BuildContext context, Map<String, dynamic> row) async {
  await showModalBottomSheet(
    context: context, isScrollControlled: true, backgroundColor: Colors.white,
    shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(22))),
    builder: (_) => _FilesSheet(row: row),
  );
  return true; // The list reloads so the attachment counter updates.
}

class _FilesSheet extends StatefulWidget {
  final Map<String, dynamic> row;
  const _FilesSheet({required this.row});
  @override
  State<_FilesSheet> createState() => _FilesSheetState();
}

class _FilesSheetState extends State<_FilesSheet> {
  late List<Map<String, dynamic>> _files = _list(widget.row['attachments']);
  final _title = TextEditingController();
  bool _busy = false;

  static List<Map<String, dynamic>> _list(dynamic v) =>
      List<Map<String, dynamic>>.from((v as List? ?? const []).whereType<Map>().map((e) => Map<String, dynamic>.from(e)));

  String get _id => (widget.row['_id'] ?? '').toString();

  @override
  void dispose() { _title.dispose(); super.dispose(); }

  void _snack(Object e) { if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e is ApiException ? e.message : e.toString()))); }

  // After upload/delete the contract is read from the list (there is no GET route for a single contract).
  Future<void> _reload() async {
    try {
      final d = await Api.instance.get('/api/contracts/agreements');
      final c = _list(d['contracts']).firstWhere((x) => x['_id'] == _id, orElse: () => const {});
      if (mounted && c.isNotEmpty) setState(() => _files = _list(c['attachments']));
    } catch (_) {}
  }

  Future<void> _upload() async {
    final f = await pickFileAsDataUrl();
    if (f == null) return;
    setState(() => _busy = true);
    try {
      await Api.instance.post('/api/contracts/agreements/$_id/attachments', {'dataUrl': f.dataUrl, 'fileName': f.fileName, 'title': _title.text.trim()});
      _title.clear();
      await _reload();
    } catch (e) { _snack(e); }
    if (mounted) setState(() => _busy = false);
  }

  Future<void> _remove(Map<String, dynamic> a) async {
    final ok = await showDialog<bool>(context: context, builder: (c) => AlertDialog(
      content: Text(tr('حذف هذا المرفق؟', 'Delete attachment?')),
      actions: [
        TextButton(onPressed: () => Navigator.pop(c, false), child: Text(tr('إلغاء', 'Cancel'))),
        FilledButton(style: FilledButton.styleFrom(backgroundColor: T.danger), onPressed: () => Navigator.pop(c, true), child: Text(tr('حذف', 'Delete'))),
      ],
    ));
    if (ok != true) return;
    try {
      await Api.instance.delete('/api/contracts/agreements/$_id/attachments/${a['_id']}');
      await _reload();
    } catch (e) { _snack(e); }
  }

  void _open(dynamic url) {
    final u = (url ?? '').toString();
    if (u.isEmpty) return;
    launchUrl(Uri.parse(u.startsWith('http') ? u : '${AppConfig.apiBase}$u'), mode: LaunchMode.externalApplication);
  }

  @override
  Widget build(BuildContext context) {
    final a = context.read<AuthProvider>();
    final canEdit = _contractsEditRoles.contains(a.role) || a.canEditSection('Contracts');
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
      child: ConstrainedBox(
        constraints: BoxConstraints(maxHeight: MediaQuery.of(context).size.height * 0.8),
        child: ListView(shrinkWrap: true, padding: const EdgeInsets.all(16), children: [
          Text(tr('مرفقات عقد ${widget.row['partyName'] ?? ''}', 'Attachments'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16)),
          const SizedBox(height: 10),
          if (_files.isEmpty)
            Padding(padding: const EdgeInsets.symmetric(vertical: 12), child: Text(tr('لا توجد مرفقات — ارفع ملف العقد.', 'No files yet.'), textAlign: TextAlign.center, style: const TextStyle(color: T.inkFaint))),
          for (final f in _files)
            ListTile(
              contentPadding: EdgeInsets.zero,
              leading: const Icon(Icons.description_outlined, color: T.cyan),
              title: Text((f['title'] ?? '').toString().isNotEmpty ? f['title'].toString() : (f['fileName'] ?? '—').toString(), style: const TextStyle(fontWeight: FontWeight.w700)),
              subtitle: Text('${((f['size'] as num? ?? 0) / 1024).toStringAsFixed(0)} KB', style: const TextStyle(fontSize: 11.5)),
              onTap: () => _open(f['fileUrl']),
              trailing: canEdit ? IconButton(icon: const Icon(Icons.delete_outline, color: T.danger), onPressed: () => _remove(f)) : null,
            ),
          if (canEdit) ...[
            const SizedBox(height: 10),
            TextField(controller: _title, decoration: InputDecoration(labelText: tr('وصف المرفق', 'Title'))),
            const SizedBox(height: 8),
            FilledButton.icon(
              style: FilledButton.styleFrom(backgroundColor: T.cyan),
              onPressed: _busy ? null : _upload,
              icon: _busy ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white)) : const Icon(Icons.upload_file_outlined),
              label: Text(_busy ? tr('جارٍ الرفع…', 'Uploading…') : tr('رفع ملف', 'Upload')),
            ),
          ],
        ]),
      ),
    );
  }
}
