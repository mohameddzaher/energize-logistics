import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';
import '../config.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../services/live.dart';
import 'file_upload.dart';
import 'theme.dart';

/// «متابعات الكشف» — نظيرُ components/operations/ReportFollowUps في الموقع.
///
/// سجلٌّ واحدٌ على كشف التشغيل يكتبه التشغيلُ والتخليصُ والتحصيل، ولكلّ قسمٍ
/// بابُه إليه (`basePath`) لأنّ كلًّا منهم يصل إلى الكشف بحارس قسمه:
///   /api/workflows/:id/follow-ups
///   /api/customs-clearance/:id/ops-reports/:reportId/follow-ups
///   /api/collections-dept/reports/:reportId/follow-ups
/// مَن يرى الكشفَ يكتب متابعة ومعها مرفقٌ اختياريّ؛ والحذفُ لكاتبها أو للإدارة
/// (`canDelete` من الخادم). ويتحدّث على `workflow:followUps`.
class ReportFollowUpsView extends StatefulWidget {
  final String basePath;
  final String workflowId;
  const ReportFollowUpsView({super.key, required this.basePath, required this.workflowId});
  @override
  State<ReportFollowUpsView> createState() => _ReportFollowUpsViewState();
}

const _maxFile = 10 * 1024 * 1024;
const _sources = {
  'operations': ('التشغيل', 'Operations'),
  'customs': ('التخليص', 'Customs'),
  'collections': ('التحصيل', 'Collections'),
};

class _ReportFollowUpsViewState extends State<ReportFollowUpsView> {
  List<Map<String, dynamic>>? _rows;
  String? _error;
  String? _formError;
  PickedFile? _file;
  bool _saving = false;
  int _seq = 0;
  final _text = TextEditingController();
  late final void Function(dynamic) _onLive;

  @override
  void initState() {
    super.initState();
    _load();
    _onLive = (p) {
      final id = p is Map ? '${p['workflowId'] ?? ''}' : '';
      if (id.isEmpty || id == widget.workflowId) _load();
    };
    Live.instance.onData('workflow:followUps', _onLive);
  }

  @override
  void dispose() {
    Live.instance.offData('workflow:followUps', _onLive);
    _text.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    final mine = ++_seq;
    try {
      final d = await Api.instance.get(widget.basePath);
      if (!mounted || mine != _seq) return;
      setState(() {
        _rows = [for (final x in (d is Map ? d['followUps'] as List? : null) ?? const []) Map<String, dynamic>.from(x as Map)];
        _error = null;
      });
    } catch (e) {
      if (mounted && mine == _seq) setState(() => _error = e.toString());
    }
  }

  Future<void> _pick() async {
    try {
      final f = await pickFileAsDataUrl();
      if (f == null || !mounted) return;
      if (f.sizeBytes > _maxFile) { setState(() => _formError = tr('الملفُّ أكبرُ من ١٠ ميغا', 'The file is larger than 10 MB')); return; }
      setState(() { _file = f; _formError = null; });
    } catch (e) {
      if (mounted) setState(() => _formError = e.toString());
    }
  }

  Future<void> _add() async {
    final text = _text.text.trim();
    if (text.isEmpty) { setState(() => _formError = tr('اكتب نصَّ المتابعة', 'Write the follow-up')); return; }
    setState(() { _saving = true; _formError = null; });
    try {
      await Api.instance.post(widget.basePath, {
        'text': text,
        if (_file != null) 'file': {'name': _file!.fileName, 'dataUrl': _file!.dataUrl},
      });
      _text.clear();
      _file = null;
      await _load();
    } catch (e) {
      if (mounted) setState(() => _formError = e.toString());
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Future<void> _remove(Map<String, dynamic> f) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: Text(tr('حذف المتابعة', 'Delete follow-up')),
        content: Text('${f['text'] ?? ''}', maxLines: 4, overflow: TextOverflow.ellipsis),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: Text(tr('إلغاء', 'Cancel'))),
          FilledButton(onPressed: () => Navigator.pop(c, true), child: Text(tr('حذف', 'Delete'))),
        ],
      ),
    );
    if (ok != true) return;
    try {
      await Api.instance.delete('${widget.basePath}/${f['_id']}');
      await _load();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    }
  }

  String _when(dynamic v) {
    final d = v != null ? DateTime.tryParse('$v')?.toLocal() : null;
    if (d == null) return '';
    String two(int n) => n.toString().padLeft(2, '0');
    return '${d.day}/${d.month}/${d.year} ${two(d.hour)}:${two(d.minute)}';
  }

  @override
  Widget build(BuildContext context) {
    final rows = _rows;
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      TextField(
        controller: _text,
        minLines: 1,
        maxLines: 4,
        maxLength: 2000,
        decoration: InputDecoration(
          hintText: tr('اكتب متابعةً على هذا الكشف…', 'Write a follow-up on this report…'),
          counterText: '',
          isDense: true,
        ),
      ),
      const SizedBox(height: 6),
      Row(children: [
        Expanded(
          child: TextButton.icon(
            style: TextButton.styleFrom(alignment: AlignmentDirectional.centerStart),
            onPressed: _saving ? null : _pick,
            icon: const Icon(Icons.attach_file_rounded, size: 16),
            label: Text(_file?.fileName ?? tr('إرفاق ملف (اختياريّ)', 'Attach a file (optional)'),
                maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 12)),
          ),
        ),
        if (_file != null) IconButton(onPressed: () => setState(() => _file = null), icon: const Icon(Icons.close, size: 16)),
        FilledButton.icon(
          onPressed: _saving ? null : _add,
          icon: _saving ? const SizedBox(width: 14, height: 14, child: CircularProgressIndicator(strokeWidth: 2)) : const Icon(Icons.send_rounded, size: 16),
          label: Text(tr('إضافة', 'Add')),
        ),
      ]),
      if (_formError != null) Text(_formError!, style: const TextStyle(fontSize: 12, color: T.danger)),
      const SizedBox(height: 6),
      if (_error != null)
        Text(_error!, style: const TextStyle(fontSize: 12, color: T.danger))
      else if (rows == null)
        const LinearProgressIndicator(minHeight: 2)
      else if (rows.isEmpty)
        Text(tr('لا متابعاتٍ على هذا الكشف بعد.', 'No follow-ups on this report yet.'), style: const TextStyle(fontSize: 12, color: T.inkSoft))
      else
        for (final f in rows)
          Container(
            margin: const EdgeInsets.only(top: 6),
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(color: T.canvas, borderRadius: BorderRadius.circular(10)),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Expanded(child: Text('${f['text'] ?? ''}', style: const TextStyle(fontSize: 13))),
                if (f['canDelete'] == true)
                  InkWell(onTap: () => _remove(f), child: const Padding(padding: EdgeInsets.all(2), child: Icon(Icons.delete_outline, size: 16, color: T.inkFaint))),
              ]),
              if (f['attachment'] is Map && '${(f['attachment'] as Map)['fileUrl'] ?? ''}'.isNotEmpty)
                InkWell(
                  onTap: () {
                    final u = '${(f['attachment'] as Map)['fileUrl']}';
                    launchUrl(Uri.parse(u.startsWith('http') ? u : '${AppConfig.apiBase}$u'), mode: LaunchMode.externalApplication);
                  },
                  child: Padding(
                    padding: const EdgeInsets.only(top: 4),
                    child: Row(mainAxisSize: MainAxisSize.min, children: [
                      const Icon(Icons.attach_file_rounded, size: 13, color: T.navy),
                      Flexible(child: Text('${(f['attachment'] as Map)['fileName'] ?? tr('المرفق', 'Attachment')}',
                          overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 11.5, color: T.navy))),
                    ]),
                  ),
                ),
              const SizedBox(height: 3),
              Text([
                '${f['byName'] ?? '—'}',
                if (_sources[f['source']] != null) tr(_sources[f['source']]!.$1, _sources[f['source']]!.$2),
                _when(f['at']),
              ].where((x) => x.isNotEmpty).join(' · '), style: const TextStyle(fontSize: 10.5, color: T.inkFaint)),
            ]),
          ),
    ]);
  }
}
