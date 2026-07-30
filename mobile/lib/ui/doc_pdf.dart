import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;
import 'package:printing/printing.dart';

/// طباعة/مشاركة أي مستند (بوليصة، تفاصيل، …) كـ PDF عربي RTL من داخل التطبيق.
/// `Printing.layoutPdf` بيفتح شيت النظام: طباعة (AirPrint)، حفظ، أو مشاركة.
///
/// نبنيه من عنوان + رقم + صفوف (label, value) عشان يشتغل لأي شاشة.
Future<void> printDocument({
  required String title,
  String? number,
  String? subtitle,
  required List<(String, String)> rows,
  String company = 'Energize Logistics — الطاقة اللوجستية',
}) async {
  final regular = await PdfGoogleFonts.tajawalRegular();
  final bold = await PdfGoogleFonts.tajawalBold();
  final theme = pw.ThemeData.withFont(base: regular, bold: bold);

  const navy = PdfColor.fromInt(0xFF12325C);
  const orange = PdfColor.fromInt(0xFFF37121);
  const line = PdfColor.fromInt(0xFFE2E8F0);

  final doc = pw.Document();
  doc.addPage(
    pw.Page(
      pageFormat: PdfPageFormat.a4,
      theme: theme,
      textDirection: pw.TextDirection.rtl,
      build: (ctx) => pw.Column(
        crossAxisAlignment: pw.CrossAxisAlignment.stretch,
        children: [
          // رأس الصفحة
          pw.Container(
            padding: const pw.EdgeInsets.all(14),
            decoration: const pw.BoxDecoration(color: navy),
            child: pw.Row(
              mainAxisAlignment: pw.MainAxisAlignment.spaceBetween,
              children: [
                pw.Text(company, style: const pw.TextStyle(color: PdfColors.white, fontWeight: pw.FontWeight.bold, fontSize: 14)),
                if (number != null && number.isNotEmpty)
                  pw.Text('#$number', style: const pw.TextStyle(color: orange, fontWeight: pw.FontWeight.bold, fontSize: 16)),
              ],
            ),
          ),
          pw.SizedBox(height: 14),
          pw.Text(title, style: const pw.TextStyle(fontWeight: pw.FontWeight.bold, fontSize: 18)),
          if (subtitle != null && subtitle.isNotEmpty) ...[
            pw.SizedBox(height: 2),
            pw.Text(subtitle, style: const pw.TextStyle(color: PdfColors.grey700, fontSize: 11)),
          ],
          pw.SizedBox(height: 12),
          // جدول التفاصيل
          pw.Table(
            border: pw.TableBorder.all(color: line, width: 0.8),
            columnWidths: const {0: pw.FlexColumnWidth(2), 1: pw.FlexColumnWidth(3)},
            children: [
              for (final r in rows)
                pw.TableRow(
                  decoration: const pw.BoxDecoration(color: PdfColor.fromInt(0xFFF8FAFC)),
                  children: [
                    pw.Padding(padding: const pw.EdgeInsets.all(8), child: pw.Text(r.$1, style: const pw.TextStyle(color: PdfColors.grey700, fontSize: 11))),
                    pw.Padding(padding: const pw.EdgeInsets.all(8), child: pw.Text(r.$2.isEmpty ? '—' : r.$2, style: const pw.TextStyle(fontWeight: pw.FontWeight.bold, fontSize: 11.5))),
                  ],
                ),
            ],
          ),
          pw.Spacer(),
          pw.Divider(color: line),
          pw.Row(
            mainAxisAlignment: pw.MainAxisAlignment.spaceBetween,
            children: [
              pw.Text('طُبع من تطبيق Energize Logistics', style: const pw.TextStyle(color: PdfColors.grey500, fontSize: 9)),
              pw.Text(DateTime.now().toString().split('.').first, style: const pw.TextStyle(color: PdfColors.grey500, fontSize: 9)),
            ],
          ),
        ],
      ),
    ),
  );

  await Printing.layoutPdf(onLayout: (format) async => doc.save(), name: '$title${number != null ? '-$number' : ''}');
}
