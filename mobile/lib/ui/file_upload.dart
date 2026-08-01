import 'dart:convert';
import 'package:file_picker/file_picker.dart';

/// نتيجة اختيار ملف: رابط بيانات base64 جاهز للإرسال + اسم الملف + الحجم.
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

/// يفتح منتقي الملفات ويرجّع الملف المختار كـ data URL (base64). null لو أُلغي.
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
