import 'dart:convert';
import 'dart:typed_data';
import 'package:flutter/material.dart';
import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;
import 'package:printing/printing.dart';
import '../services/api.dart';
import '../services/hijri.dart';
import '../services/lang.dart';

/// Official leave sheet PDF, counterpart of downloadLeaveSheet (lib/leavePdf.ts) on the web: company letterhead as background, leave details and three signature boxes (employee, direct manager, HR) with ink if signed.
/// The full leave (with signatures) is read from GET /api/hr/leaves/:id, the sheet is built on the device, and the print/share dialog opens.
Future<void> downloadLeaveSheet(BuildContext context, String leaveId) async {
  final messenger = ScaffoldMessenger.of(context);
  try {
    final d = await Api.instance.get('/api/hr/leaves/$leaveId');
    final leave = Map<String, dynamic>.from((d as Map)['leave'] as Map);
    final bytes = await _build(leave);
    final emp = leave['employee'] is Map ? leave['employee'] as Map : const {};
    await Printing.layoutPdf(onLayout: (_) async => bytes,
        name: 'leave-${_person(emp).replaceAll(RegExp(r'\s+'), '_')}-${'${leave['startDate'] ?? ''}'.split('T').first}');
  } catch (e) {
    messenger.showSnackBar(SnackBar(content: Text(tr('تعذّر إصدار الورقة: $e', 'Could not build the sheet: $e'))));
  }
}

String _person(dynamic p) {
  if (p is! Map) return '—';
  final ar = Lang.instance.ar;
  final en = '${p['firstName'] ?? ''} ${p['lastName'] ?? ''}'.trim();
  if (ar && '${p['arabicName'] ?? ''}'.isNotEmpty) return '${p['arabicName']}';
  return en.isNotEmpty ? en : '${p['email'] ?? '—'}';
}

String _short(dynamic v) {
  final g = gregDay(v);
  if (g.isEmpty) return '—';
  final h = hijriDay(v);
  return h.isEmpty ? g : '$g ($h ${tr('هـ', 'AH')})';
}

pw.ImageProvider? _ink(dynamic dataUrl) {
  final s = '${dataUrl ?? ''}';
  final i = s.indexOf('base64,');
  if (i < 0) return null;
  try { return pw.MemoryImage(base64Decode(s.substring(i + 7))); } catch (_) { return null; }
}

Future<Uint8List> _build(Map<String, dynamic> leave) async {
  final ar = Lang.instance.ar;
  String t(String en, String a) => ar ? a : en;
  final regular = await PdfGoogleFonts.tajawalRegular();
  final bold = await PdfGoogleFonts.tajawalBold();
  // The same letterhead the web draws as the sheet background.
  pw.ImageProvider? letterhead;
  try { letterhead = await networkImage('https://energize-logistics.com/images/payroll.png'); } catch (_) {}

  final emp = leave['employee'] is Map ? Map<String, dynamic>.from(leave['employee']) : <String, dynamic>{};
  final empDisplay = _person(emp);
  final lt = leave['leaveType'];
  final type = lt is Map ? (ar ? (lt['nameAr'] ?? lt['nameEn']) : (lt['nameEn'] ?? lt['nameAr'])) : '—';
  final rows = <(String, String)>[
    (t('Employee', 'الموظف'), empDisplay),
    (t('Employee No.', 'الرقم الوظيفي'), '${emp['employeeNumber'] ?? emp['iqamaNumber'] ?? '—'}'),
    (t('Leave Type', 'نوع الإجازة'), '${type ?? '—'}'),
    (t('From', 'من'), _short(leave['startDate'])),
    (t('To', 'إلى'), _short(leave['endDate'])),
    (t('Days', 'عدد الأيام'), '${leave['days'] ?? '—'}'),
    (t('Request Date', 'تاريخ الطلب'), _short(leave['createdAt'])),
    (t('Status', 'الحالة'), '${leave['status'] ?? '—'}'),
    if ('${leave['reason'] ?? ''}'.isNotEmpty) (t('Reason', 'السبب'), '${leave['reason']}'),
  ];
  final md = leave['managerDecision'] is Map ? leave['managerDecision'] as Map : const {};
  final hd = leave['hrDecision'] is Map ? leave['hrDecision'] as Map : const {};

  pw.Widget sig(String label, dynamic ink, String name, dynamic at) {
    final img = _ink(ink);
    return pw.Expanded(child: pw.Column(children: [
      pw.SizedBox(height: 60, child: img == null ? pw.SizedBox() : pw.Image(img, height: 56, fit: pw.BoxFit.contain)),
      pw.Divider(color: PdfColors.grey800, thickness: 0.8),
      pw.Text(label, style: pw.TextStyle(font: bold, fontSize: 12)),
      pw.Text(name.isEmpty ? '—' : name, style: const pw.TextStyle(fontSize: 11, color: PdfColors.grey700)),
      pw.Text(gregDay(at), style: const pw.TextStyle(fontSize: 10, color: PdfColors.grey600)),
    ]));
  }

  final doc = pw.Document();
  doc.addPage(pw.Page(
    pageFormat: PdfPageFormat.a4,
    margin: pw.EdgeInsets.zero,
    theme: pw.ThemeData.withFont(base: regular, bold: bold),
    textDirection: ar ? pw.TextDirection.rtl : pw.TextDirection.ltr,
    build: (ctx) => pw.Stack(children: [
      if (letterhead != null) pw.Positioned.fill(child: pw.Image(letterhead, fit: pw.BoxFit.fill)),
      pw.Padding(
        // Space between the letterhead header and footer, same dimensions as the web (170 top, 175 bottom out of 1123).
        padding: const pw.EdgeInsets.fromLTRB(45, 127, 45, 131),
        child: pw.Column(crossAxisAlignment: pw.CrossAxisAlignment.stretch, children: [
          pw.Center(child: pw.Text(t('Leave Request', 'طلب إجازة'), style: pw.TextStyle(font: bold, fontSize: 20))),
          pw.Center(child: pw.Text(t('Energize Logistics', 'إنرجايز لوجيستيك'), style: pw.TextStyle(font: bold, fontSize: 11, color: const PdfColor.fromInt(0xFFF37121)))),
          pw.SizedBox(height: 14),
          pw.Table(
            border: pw.TableBorder.all(color: const PdfColor.fromInt(0xFFE5E7EB), width: 0.8),
            columnWidths: const {0: pw.FlexColumnWidth(38), 1: pw.FlexColumnWidth(62)},
            children: [
              for (var i = 0; i < rows.length; i++)
                pw.TableRow(
                  decoration: pw.BoxDecoration(color: i.isOdd ? const PdfColor.fromInt(0xFFF8FAFC) : PdfColors.white),
                  children: [
                    pw.Padding(padding: const pw.EdgeInsets.all(6), child: pw.Text(rows[i].$1, style: pw.TextStyle(font: bold, fontSize: 11, color: PdfColors.grey800))),
                    pw.Padding(padding: const pw.EdgeInsets.all(6), child: pw.Text(rows[i].$2, style: const pw.TextStyle(fontSize: 11))),
                  ],
                ),
            ],
          ),
          pw.Spacer(),
          pw.Row(children: [
            sig(t('Employee', 'الموظف'), leave['employeeSignature'], empDisplay, leave['createdAt']),
            pw.SizedBox(width: 14),
            sig(t('Direct Manager', 'المدير المباشر'), md['signature'], md['by'] is Map ? _person(md['by']) : '', md['at']),
            pw.SizedBox(width: 14),
            sig(t('Human Resources', 'الموارد البشرية'), hd['signature'], hd['by'] is Map ? _person(hd['by']) : '', hd['at']),
          ]),
        ]),
      ),
    ]),
  ));
  return doc.save();
}
