import 'dart:io';
import 'dart:convert';
import 'package:archive/archive.dart';
import 'package:flutter/material.dart';
import 'package:path_provider/path_provider.dart';
import 'package:share_plus/share_plus.dart';
import '../services/lang.dart';

/// Excel export on mobile, twin of the web ExportMenu. The screen supplies columns (title plus how to read the value from a row) and the displayed rows, so the export matches what is visible under the filter, as on the web. The file is built on the device, then the share sheet opens.
class ExportCol {
  final String ar;
  final String en;
  final dynamic Function(Map<String, dynamic> row) value;
  const ExportCol(this.ar, this.en, this.value);
}

/// Builds an xlsx file and shares it. `sheets` is one or more sheets: (sheet name, columns, rows).
Future<void> exportExcel(
  BuildContext context, {
  required String fileName,
  required List<(String, List<ExportCol>, List<Map<String, dynamic>>)> sheets,
}) async {
  final messenger = ScaffoldMessenger.of(context);
  try {
    final bytes = buildXlsx(sheets.map((x) {
      final (name, cols, rows) = x;
      return (name, [
        cols.map((c) => tr(c.ar, c.en) as Object?).toList(),
        for (final r in rows) cols.map((c) => c.value(r) as Object?).toList(),
      ]);
    }).toList(), rtl: Lang.instance.ar);
    final dir = await getTemporaryDirectory();
    final stamp = DateTime.now().toIso8601String().substring(0, 10);
    final file = File('${dir.path}/${fileName.replaceAll(RegExp(r'[^\w؀-ۿ-]+'), '-')}-$stamp.xlsx');
    await file.writeAsBytes(bytes, flush: true);
    await SharePlus.instance.share(ShareParams(files: [XFile(file.path, mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')]));
  } catch (e) {
    messenger.showSnackBar(SnackBar(content: Text(tr('تعذّر التصدير: $e', 'Export failed: $e'))));
  }
}

// The xlsx is built here as XML in a zip with no Excel library: the excel package requires old archive versions that pdf/printing (waybill) depends on and would break them. The format is simple: text/number cells and a bold header row.
String _esc(String v) => v
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
    .replaceAll(RegExp(r'[\x00-\x08\x0B\x0C\x0E-\x1F]'), '');

String _col(int i) { var n = i + 1; var s = ''; while (n > 0) { final m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = (n - m - 1) ~/ 26; } return s; }

String _cell(int r, int c, Object? v, {bool head = false}) {
  final ref = '${_col(c)}${r + 1}';
  final style = head ? ' s="1"' : '';
  if (v == null) return '<c r="$ref"$style/>';
  if (v is num && v.isFinite) return '<c r="$ref"$style><v>$v</v></c>';
  final t = v is bool ? (v ? tr('نعم', 'Yes') : tr('لا', 'No')) : v.toString();
  return '<c r="$ref" t="inlineStr"$style><is><t xml:space="preserve">${_esc(t)}</t></is></c>';
}

/// Sheets: (name, rows); the first row is headers.
List<int> buildXlsx(List<(String, List<List<Object?>>)> sheets, {bool rtl = false}) {
  final a = Archive();
  void add(String name, String xml) { final b = utf8.encode(xml); a.addFile(ArchiveFile(name, b.length, b)); }
  final names = <String>[];
  for (var i = 0; i < sheets.length; i++) {
    final safe = sheets[i].$1.replaceAll(RegExp(r'[\\/?*\[\]:]'), ' ').trim();
    var base = safe.isEmpty ? 'Sheet${i + 1}' : safe;
    if (base.length > 31) base = base.substring(0, 31); // Excel's limit for a sheet name
    while (names.contains(base)) { base = '${base.substring(0, base.length > 28 ? 28 : base.length)}-${i + 1}'; }
    names.add(base);
  }
  add('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
      '<Default Extension="xml" ContentType="application/xml"/>'
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
      '${[for (var i = 0; i < sheets.length; i++) '<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'].join()}'
      '</Types>');
  add('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
      '</Relationships>');
  add('xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>'
      '${[for (var i = 0; i < names.length; i++) '<sheet name="${_esc(names[i])}" sheetId="${i + 1}" r:id="rId${i + 1}"/>'].join()}'
      '</sheets></workbook>');
  add('xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      '${[for (var i = 0; i < names.length; i++) '<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>'].join()}'
      '<Relationship Id="rId${names.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
      '</Relationships>');
  add('xl/styles.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
      '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>'
      '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>'
      '<borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs>'
      '<cellXfs count="2"><xf fontId="0"/><xf fontId="1" applyFont="1"/></cellXfs></styleSheet>');
  for (var i = 0; i < sheets.length; i++) {
    final rows = sheets[i].$2;
    final body = StringBuffer();
    for (var r = 0; r < rows.length; r++) {
      body.write('<row r="${r + 1}">');
      for (var c = 0; c < rows[r].length; c++) { body.write(_cell(r, c, rows[r][c], head: r == 0)); }
      body.write('</row>');
    }
    add('xl/worksheets/sheet${i + 1}.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        '<sheetViews><sheetView workbookViewId="0"${rtl ? ' rightToLeft="1"' : ''}><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
        '<sheetData>$body</sheetData></worksheet>');
  }
  return ZipEncoder().encode(a);
}

/// Export button in the screen bar.
class ExportButton extends StatelessWidget {
  final String fileName;
  final List<ExportCol> columns;
  final List<Map<String, dynamic>> Function() rows;
  final String? sheetName;
  const ExportButton({super.key, required this.fileName, required this.columns, required this.rows, this.sheetName});

  @override
  Widget build(BuildContext context) {
    return IconButton(
      tooltip: tr('تصدير Excel', 'Export to Excel'),
      icon: const Icon(Icons.file_download_outlined),
      onPressed: () {
        final r = rows();
        if (r.isEmpty) {
          ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(tr('لا صفوف للتصدير', 'Nothing to export'))));
          return;
        }
        exportExcel(context, fileName: fileName, sheets: [(sheetName ?? fileName, columns, r)]);
      },
    );
  }
}
