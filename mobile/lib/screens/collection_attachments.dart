import 'dart:convert';
import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:url_launcher/url_launcher.dart';
import '../config.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';

// ═════════════════════════════════════════════════════════════════════════
// مرفقاتُ فاتورة التحصيل — نظيرُ components/collections/InvoiceAttachments
// في الموقع.
//
// الضريبيّةُ (`tax`) تُعرَف برقمها في الدفتر، والنقديّةُ (`cash`) بمعرّف كشفها.
// مَن يقرأ الفواتير يفتح وينزّل، ومَن يكتب فيها يرفع (الخادمُ يقول ذلك في
// `abilities.upload`)، والحذفُ لمن رفع الملفَّ أو لمدير التحصيل (`canDelete`).
// والحدودُ حدودُ الخادم: صور وPDF وWord وExcel، حتى ١٠ ميغا للملف — وما يُختار
// يُرسَل على دفعاتٍ لا تتجاوز حدَّ الطلب.
// ═════════════════════════════════════════════════════════════════════════

const _mb = 1024 * 1024;
const _maxFile = 10 * _mb;
const _batchBytes = 15 * _mb;
const _batchFiles = 10;
const _exts = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'heic', 'pdf', 'doc', 'docx', 'xls', 'xlsx'];
const _mimeByExt = {
  'jpg': 'image/jpeg', 'jpeg': 'image/jpeg', 'png': 'image/png', 'webp': 'image/webp', 'gif': 'image/gif', 'heic': 'image/heic',
  'pdf': 'application/pdf',
  'doc': 'application/msword',
  'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'xls': 'application/vnd.ms-excel',
  'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

String _url(String u) => u.startsWith('http') ? u : '${AppConfig.apiBase}$u';
String _base(String kind, String key) => '/api/collections-dept/attachments/$kind/${Uri.encodeComponent(key)}';

/// يفتح شاشةَ مرفقات فاتورة — يُرجع true إن رُفع أو حُذف شيء (فتُعاد القائمة).
Future<bool> openCollectionAttachments(BuildContext context, {required String kind, required String key, required String label}) async {
  if (key.isEmpty) return false;
  final changed = await Navigator.push<bool>(context,
      MaterialPageRoute(builder: (_) => CollectionAttachmentsScreen(kind: kind, invKey: key, label: label)));
  return changed == true;
}

class CollectionAttachmentsScreen extends StatefulWidget {
  final String kind;
  final String invKey;
  final String label;
  const CollectionAttachmentsScreen({super.key, required this.kind, required this.invKey, required this.label});

  @override
  State<CollectionAttachmentsScreen> createState() => _CollectionAttachmentsScreenState();
}

class _Picked {
  final String dataUrl;
  final String fileName;
  final int size;
  const _Picked(this.dataUrl, this.fileName, this.size);
}

class _CollectionAttachmentsScreenState extends State<CollectionAttachmentsScreen> {
  List<Map<String, dynamic>> _files = [];
  bool _canUpload = false;
  bool _loading = true;
  String? _error;
  String? _progress;
  String? _removing;
  bool _changed = false;
  late final void Function() _onLive;

  @override
  void initState() {
    super.initState();
    _load();
    _onLive = () => _load();
    Live.instance.on('collections:attachments', _onLive);
  }

  @override
  void dispose() {
    Live.instance.off('collections:attachments', _onLive);
    super.dispose();
  }

  void _snack(String m) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(m)));
  }

  Future<void> _load() async {
    try {
      final d = await Api.instance.get(_base(widget.kind, widget.invKey));
      if (!mounted) return;
      setState(() {
        _files = ((d is Map ? d['files'] : null) as List? ?? const []).map((e) => Map<String, dynamic>.from(e as Map)).toList();
        _canUpload = d is Map && d['abilities'] is Map && (d['abilities'] as Map)['upload'] == true;
        _error = null;
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() { _error = e is ApiException ? e.message : e.toString(); _loading = false; });
    }
  }

  // ── الاختيار ───────────────────────────────────────────────────────────
  Future<List<_Picked>> _pick(String source) async {
    final out = <_Picked>[];
    String? problem;
    void add(List<int> bytes, String name) {
      final ext = name.contains('.') ? name.split('.').last.toLowerCase() : '';
      final mime = _mimeByExt[ext];
      if (mime == null) { problem = tr('نوع غير مدعوم: $name — صور وPDF وWord وExcel فقط', 'Unsupported: $name — images, PDF, Word or Excel only'); return; }
      if (bytes.length > _maxFile) { problem = tr('«$name» أكبر من 10 ميغا', '“$name” is larger than 10 MB'); return; }
      out.add(_Picked('data:$mime;base64,${base64Encode(bytes)}', name, bytes.length));
    }

    try {
      if (source == 'camera') {
        // صورةٌ بعد صورة حتى يقول «تمّ».
        while (true) {
          final x = await ImagePicker().pickImage(source: ImageSource.camera, maxWidth: 2000, maxHeight: 2000, imageQuality: 85);
          if (x == null) break;
          final n = x.name.toLowerCase();
          add(await x.readAsBytes(), n.endsWith('.jpg') || n.endsWith('.jpeg') || n.endsWith('.png') ? x.name : '${x.name}.jpg');
          if (!mounted) break;
          final more = await showDialog<bool>(
            context: context,
            builder: (c) => AlertDialog(
              content: Text(tr('التُقطت ${out.length} — صورة أخرى؟', '${out.length} taken — another photo?')),
              actions: [
                TextButton(onPressed: () => Navigator.pop(c, false), child: Text(tr('تمّ', 'Done'))),
                TextButton(onPressed: () => Navigator.pop(c, true), child: Text(tr('صورة أخرى', 'Another'))),
              ],
            ),
          );
          if (more != true) break;
        }
      } else if (source == 'gallery') {
        final xs = await ImagePicker().pickMultiImage(maxWidth: 2000, maxHeight: 2000, imageQuality: 85);
        for (final x in xs) {
          final n = x.name.toLowerCase();
          add(await x.readAsBytes(), n.contains('.') ? x.name : '${x.name}.jpg');
        }
      } else {
        final res = await FilePicker.platform.pickFiles(withData: true, allowMultiple: true, type: FileType.custom, allowedExtensions: _exts);
        for (final f in res?.files ?? const <PlatformFile>[]) {
          if (f.bytes != null) add(f.bytes!, f.name);
        }
      }
    } catch (e) {
      problem = e.toString();
    }
    if (problem != null) _snack(problem!);
    return out;
  }

  Future<void> _attach() async {
    final src = await showModalBottomSheet<String>(
      context: context,
      showDragHandle: true,
      builder: (c) => SafeArea(child: Column(mainAxisSize: MainAxisSize.min, children: [
        ListTile(leading: const Icon(Icons.folder_open_outlined), title: Text(tr('ملفات', 'Files')),
            subtitle: Text(tr('PDF وWord وExcel وصور — أكثر من ملف', 'PDF, Word, Excel, images — several at once')), onTap: () => Navigator.pop(c, 'files')),
        ListTile(leading: const Icon(Icons.photo_library_outlined), title: Text(tr('من المعرض', 'From gallery')), onTap: () => Navigator.pop(c, 'gallery')),
        ListTile(leading: const Icon(Icons.photo_camera_outlined), title: Text(tr('الكاميرا', 'Camera')),
            subtitle: Text(tr('التقط صورة أو أكثر', 'Take one or more photos')), onTap: () => Navigator.pop(c, 'camera')),
      ])),
    );
    if (src == null) return;
    final picked = await _pick(src);
    if (picked.isEmpty || !mounted) return;

    // دفعاتٌ بحدّ الطلب الواحد.
    final batches = <List<_Picked>>[];
    var cur = <_Picked>[];
    var bytes = 0;
    for (final p in picked) {
      if (cur.isNotEmpty && (bytes + p.size > _batchBytes || cur.length >= _batchFiles)) { batches.add(cur); cur = []; bytes = 0; }
      cur.add(p); bytes += p.size;
    }
    if (cur.isNotEmpty) batches.add(cur);

    var done = 0;
    setState(() => _progress = '0/${picked.length}');
    try {
      for (final b in batches) {
        await Api.instance.postLong(_base(widget.kind, widget.invKey), {
          'files': [for (final p in b) {'dataUrl': p.dataUrl, 'fileName': p.fileName}],
        });
        done += b.length;
        _changed = true;
        if (mounted) setState(() => _progress = '$done/${picked.length}');
      }
      _snack(picked.length > 1 ? tr('أُرفق ${picked.length} ملفات', '${picked.length} files attached') : tr('أُرفق الملف', 'File attached'));
    } catch (e) {
      _snack(e is ApiException ? e.message : e.toString());
    }
    if (mounted) setState(() => _progress = null);
    await _load();
  }

  Future<void> _delete(Map<String, dynamic> f) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: Text(tr('حذف «${f['fileName'] ?? ''}»؟', 'Delete “${f['fileName'] ?? ''}”?')),
        content: Text(tr('يُحذَف الملفُّ من الفاتورة ولا يُستعاد.', 'The file is removed from the invoice and cannot be restored.')),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c), child: Text(tr('إلغاء', 'Cancel'))),
          TextButton(onPressed: () => Navigator.pop(c, true), child: Text(tr('حذف', 'Delete'), style: const TextStyle(color: T.danger))),
        ],
      ),
    );
    if (ok != true) return;
    setState(() => _removing = '${f['_id']}');
    try {
      await Api.instance.delete('${_base(widget.kind, widget.invKey)}/${f['_id']}');
      _changed = true;
      if (mounted) setState(() => _files.removeWhere((x) => x['_id'] == f['_id']));
    } catch (e) {
      _snack(e is ApiException ? e.message : e.toString());
    }
    if (mounted) setState(() => _removing = null);
  }

  void _open(Map<String, dynamic> f, {bool download = false}) {
    final u = _url('${f['fileUrl']}');
    // التنزيلُ باسمه الأصليّ: الخادمُ يقرأ `?dl=` (راجع server.js).
    final link = download ? '$u?dl=${Uri.encodeQueryComponent('${f['fileName'] ?? 'attachment'}')}' : u;
    launchUrl(Uri.parse(link), mode: LaunchMode.externalApplication);
  }

  IconData _iconOf(String mime) {
    if (mime.startsWith('image/')) return Icons.image_outlined;
    if (mime.contains('pdf')) return Icons.picture_as_pdf_outlined;
    if (mime.contains('sheet') || mime.contains('excel')) return Icons.table_chart_outlined;
    return Icons.description_outlined;
  }

  String _size(dynamic n) {
    final b = (n is num) ? n.toInt() : 0;
    if (b <= 0) return '';
    if (b < _mb) return '${(b / 1024).ceil()} KB';
    return '${(b / _mb).toStringAsFixed(1)} MB';
  }

  String _when(dynamic v) {
    final d = DateTime.tryParse('${v ?? ''}')?.toLocal();
    if (d == null) return '';
    String two(int x) => x.toString().padLeft(2, '0');
    return '${two(d.day)}/${two(d.month)}/${d.year} ${two(d.hour)}:${two(d.minute)}';
  }

  @override
  Widget build(BuildContext context) {
    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) { if (!didPop) Navigator.pop(context, _changed); },
      child: Scaffold(
        backgroundColor: T.canvas,
        appBar: AppBar(title: Text('${tr('المرفقات', 'Attachments')} · ${widget.label}')),
        floatingActionButton: _canUpload
            ? FloatingActionButton.extended(
                backgroundColor: T.orange,
                foregroundColor: Colors.white,
                onPressed: _progress == null ? _attach : null,
                icon: _progress == null
                    ? const Icon(Icons.attach_file_rounded)
                    : const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white)),
                label: Text(_progress == null ? tr('إرفاق ملف', 'Attach files') : '${tr('جارٍ الرفع', 'Uploading')} $_progress'),
              )
            : null,
        body: _loading
            ? const Center(child: CircularProgressIndicator())
            : _error != null
                ? EmptyState(icon: Icons.error_outline, title: _error!)
                : RefreshIndicator(
                    onRefresh: _load,
                    child: _files.isEmpty
                        ? ListView(children: [
                            EmptyState(icon: Icons.attach_file_rounded, title: tr('لا مرفقات بعد', 'No attachments yet'),
                                subtitle: _canUpload ? tr('صور وPDF وWord وExcel — حتى 10 ميغا للملف', 'Images, PDF, Word or Excel — up to 10 MB each') : null),
                          ])
                        : ListView.separated(
                            padding: const EdgeInsets.fromLTRB(12, 12, 12, 96),
                            itemCount: _files.length,
                            separatorBuilder: (_, __) => const SizedBox(height: 8),
                            itemBuilder: (_, i) {
                              final f = _files[i];
                              final mime = '${f['mimeType'] ?? ''}';
                              final meta = [_size(f['size']), '${f['uploadedByName'] ?? ''}', _when(f['uploadedAt'])].where((x) => x.isNotEmpty).join(' · ');
                              final busy = _removing == '${f['_id']}';
                              return AppCard(
                                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                                child: ListTile(
                                  contentPadding: EdgeInsets.zero,
                                  onTap: () => _open(f),
                                  leading: CircleAvatar(
                                    backgroundColor: T.navy.withValues(alpha: 0.06),
                                    child: Icon(_iconOf(mime), color: T.navy, size: 20),
                                  ),
                                  title: Text('${f['fileName'] ?? tr('مرفق', 'Attachment')}', maxLines: 1, overflow: TextOverflow.ellipsis,
                                      style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13.5)),
                                  subtitle: Text(meta, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 11.5, color: T.inkSoft)),
                                  trailing: Row(mainAxisSize: MainAxisSize.min, children: [
                                    IconButton(tooltip: tr('تنزيل', 'Download'), icon: const Icon(Icons.download_rounded, color: T.orange),
                                        onPressed: () => _open(f, download: true)),
                                    if (_canUpload && f['canDelete'] == true)
                                      busy
                                          ? const Padding(padding: EdgeInsets.all(12), child: SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2)))
                                          : IconButton(tooltip: tr('حذف', 'Delete'), icon: const Icon(Icons.delete_outline, color: T.danger),
                                              onPressed: () => _delete(f)),
                                  ]),
                                ),
                              );
                            },
                          ),
                  ),
      ),
    );
  }
}
