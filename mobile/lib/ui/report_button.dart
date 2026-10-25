import 'package:flutter/material.dart';
import 'package:printing/printing.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../screens/reports.dart';
import 'theme.dart';

/// «تقرير» — نظيرُ ReportButton في الويب: يفتح تقرير PDF الشامل لأيّ ملفٍّ
/// (عميل، مورد، مركبة، سائق، موظّف) عن آخر ١٢ شهرًا، والسهمُ يفتح مركزَ
/// التقارير لمن يريد تغيير الفترة. الملفُّ يُولَّد في الخادم على الترويسة.
class ReportButton extends StatefulWidget {
  final String subject; // vehicle | tire | driver | customer | vendor | employee | section
  final String id;
  final String? label;
  final bool compact;
  const ReportButton({super.key, required this.subject, required this.id, this.label, this.compact = false});

  @override
  State<ReportButton> createState() => _ReportButtonState();
}

String _iso(DateTime d) => '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';

class _ReportButtonState extends State<ReportButton> {
  bool _busy = false;

  Future<void> _open() async {
    if (widget.id.isEmpty) return;
    setState(() => _busy = true);
    final to = DateTime.now();
    final from = DateTime(to.year - 1, to.month, to.day);
    try {
      final bytes = await Api.instance.getBytes(
        '/api/reports/${widget.subject}/${Uri.encodeComponent(widget.id)}'
        '?from=${_iso(from)}&to=${_iso(to)}&lang=${Lang.instance.ar ? 'ar' : 'en'}&format=pdf',
      );
      await Printing.layoutPdf(onLayout: (_) async => bytes, name: '${widget.subject}-report');
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: Text(e is ApiException ? e.message : tr('تعذّر إصدار التقرير', 'Could not generate the report')),
        ));
      }
    }
    if (mounted) setState(() => _busy = false);
  }

  void _centre() => Navigator.of(context).push(MaterialPageRoute(
        builder: (_) => ReportsScreen(subject: widget.subject, entityId: widget.id, entityName: widget.id),
      ));

  @override
  Widget build(BuildContext context) {
    final icon = _busy
        ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2))
        : const Icon(Icons.summarize_outlined, color: T.orange, size: 18);
    if (widget.compact) {
      return IconButton(tooltip: tr('تقرير PDF', 'PDF report'), onPressed: _busy ? null : _open, icon: icon);
    }
    return Row(mainAxisSize: MainAxisSize.min, children: [
      OutlinedButton.icon(
        onPressed: _busy || widget.id.isEmpty ? null : _open,
        icon: icon,
        label: Text(widget.label ?? tr('تقرير PDF', 'PDF report')),
      ),
      IconButton(
        tooltip: tr('فتح في مركز التقارير (لتغيير الفترة)', 'Open in the report centre (to change the period)'),
        onPressed: _centre,
        icon: const Icon(Icons.open_in_new, size: 18, color: T.inkFaint),
      ),
    ]);
  }
}
