import 'package:flutter/material.dart';
import 'package:printing/printing.dart';
import '../services/api.dart';
import '../services/lang.dart';

/// Official leave sheet PDF, the same file the web downloads: built on the server (backend services/leaveSheet), which also reads each signer's current signature.
Future<void> downloadLeaveSheet(BuildContext context, String leaveId) async {
  final messenger = ScaffoldMessenger.of(context);
  try {
    // The server names the file: employee three-part name, ID number, leave date.
    final (bytes, name) = await Api.instance.getBytesNamed('/api/hr/leaves/$leaveId/sheet.pdf');
    await Printing.layoutPdf(onLayout: (_) async => bytes, name: name.isNotEmpty ? name.replaceAll(RegExp(r'\.pdf$'), '') : 'leave-$leaveId');
  } catch (e) {
    messenger.showSnackBar(SnackBar(content: Text(e is ApiException ? e.message : tr('تعذّر إصدار ورقة الإجازة', 'Could not build the leave sheet'))));
  }
}
