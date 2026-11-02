import 'dart:convert';
import 'package:file_picker/file_picker.dart';

/// Result of picking a file: a base64 data URL ready to send, plus file name and size.
class PickedFile {
  final String dataUrl;
  final String fileName;
  final int sizeBytes;
  const PickedFile(this.dataUrl, this.fileName, this.sizeBytes);
}

const _mime = {
  'pdf': 'application/pdf',
  'png': 'image/png', 'jpg': 'image/jpeg', 'jpeg': 'image/jpeg', 'webp': 'image/webp', 'gif': 'image/gif',
  'doc': 'application/msword',
  'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'xls': 'application/vnd.ms-excel',
  'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

/// Opens the file picker and returns the chosen file as a data URL (base64); null if cancelled.
Future<PickedFile?> pickFileAsDataUrl() async {
  final res = await FilePicker.platform.pickFiles(
    withData: true,
    type: FileType.custom,
    allowedExtensions: const ['pdf', 'png', 'jpg', 'jpeg', 'webp', 'doc', 'docx', 'xls', 'xlsx'],
  );
  if (res == null || res.files.isEmpty) return null;
  final f = res.files.first;
  final bytes = f.bytes;
  if (bytes == null) return null;
  final ext = (f.extension ?? '').toLowerCase();
  final mime = _mime[ext] ?? 'application/octet-stream';
  final dataUrl = 'data:$mime;base64,${base64Encode(bytes)}';
  return PickedFile(dataUrl, f.name, bytes.length);
}

/// Like `pickFileAsDataUrl` but allows several files at once; empty list if cancelled.
Future<List<PickedFile>> pickFilesAsDataUrls() async {
  final res = await FilePicker.platform.pickFiles(
    withData: true,
    allowMultiple: true,
    type: FileType.custom,
    allowedExtensions: const ['pdf', 'png', 'jpg', 'jpeg', 'webp', 'doc', 'docx', 'xls', 'xlsx'],
  );
  if (res == null) return const [];
  return [
    for (final f in res.files)
      if (f.bytes != null)
        PickedFile(
          'data:${_mime[(f.extension ?? '').toLowerCase()] ?? 'application/octet-stream'};base64,${base64Encode(f.bytes!)}',
          f.name,
          f.bytes!.length,
        ),
  ];
}
