import 'package:flutter/material.dart';
import '../services/lang.dart';
import 'file_upload.dart';
import 'theme.dart';

/// Attachments for an outgoing email (web EmailAttachments): pick several files, remove any before sending.
/// The server re-checks the caps (20 files, 20 MB).
class EmailAttachmentsField extends StatelessWidget {
  final List<PickedFile> files;
  final ValueChanged<List<PickedFile>> onChanged;
  const EmailAttachmentsField({super.key, required this.files, required this.onChanged});

  static const _maxTotal = 20 * 1024 * 1024;
  String _size(int n) => n >= 1024 * 1024 ? '${(n / 1024 / 1024).toStringAsFixed(1)} MB' : '${(n / 1024).ceil()} KB';

  @override
  Widget build(BuildContext context) {
    final total = files.fold<int>(0, (a, f) => a + f.sizeBytes);
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Text(tr('المرفقات — اختياري', 'Attachments — optional'), style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700)),
      const SizedBox(height: 6),
      OutlinedButton.icon(
        onPressed: () async {
          final picked = await pickFilesAsDataUrls();
          if (picked.isEmpty) return;
          final next = [...files, ...picked];
          if (next.fold<int>(0, (a, f) => a + f.sizeBytes) > _maxTotal) {
            if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(tr('حجم المرفقات أكبر من 20 ميجابايت.', 'Attachments exceed 20 MB.'))));
            return;
          }
          onChanged(next);
        },
        icon: const Icon(Icons.attach_file),
        label: Text(tr('إرفاق ملفات (أكثر من ملف)', 'Attach files (several)')),
      ),
      for (var i = 0; i < files.length; i++)
        Container(
          margin: const EdgeInsets.only(top: 6),
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
          decoration: BoxDecoration(border: Border.all(color: T.line), borderRadius: BorderRadius.circular(10)),
          child: Row(children: [
            const Icon(Icons.insert_drive_file_outlined, size: 18, color: T.inkFaint),
            const SizedBox(width: 8),
            Expanded(child: Text(files[i].fileName, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 12.5))),
            Text(_size(files[i].sizeBytes), style: const TextStyle(fontSize: 11.5, color: T.inkFaint)),
            IconButton(visualDensity: VisualDensity.compact, icon: const Icon(Icons.close, size: 18), onPressed: () => onChanged([...files]..removeAt(i))),
          ]),
        ),
      if (files.isNotEmpty)
        Padding(padding: const EdgeInsets.only(top: 4), child: Text(tr('${files.length} ملف · ${_size(total)} من 20 MB', '${files.length} files · ${_size(total)} of 20 MB'), textAlign: TextAlign.end, style: const TextStyle(fontSize: 11, color: T.inkFaint))),
    ]);
  }
}

List<Map<String, String>> attachmentsPayload(List<PickedFile> files) => [for (final f in files) {'dataUrl': f.dataUrl, 'fileName': f.fileName}];
