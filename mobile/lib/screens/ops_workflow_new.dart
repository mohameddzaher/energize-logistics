import 'dart:convert';
import 'package:archive/archive.dart';
import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import '../ui/ops_customer_field.dart';
import 'package:provider/provider.dart';
import '../services/api.dart';
import '../services/auth.dart';
import '../services/lang.dart';
import '../ui/app_scaffold.dart';
import '../ui/export_sheet.dart';
import '../ui/lookup_field.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';
import 'ops_common.dart';

/// New operations request, counterpart of /system/operations/new: a single request with its form, or an Excel import with a template and a row preview (edit and delete) before upload.
/// Same contract: POST /api/workflows (single) and POST /api/workflows/bulk-import `{ rows }` (batch), and the same matching of Arabic and English column headers and their aliases.

// (key, Arabic label, English label, type, aliases)
typedef _F = (String, String, String, String, List<String>);

const List<_F> _appFields = [
  ('reportNumber', 'رقم أمر النقل', 'Report Number', '', ['رقم أمر النقل', 'رقم كشف الفئه', 'رقم أمر نقل الفته']),
  ('loadingTime', 'وقت التحميل', 'Loading Time', '', []),
  ('fromLocation', 'عنوان الشحن', 'Shipping Address', '', ['من', 'From']),
  ('toLocation', 'عنوان الوصول', 'Arrival Address', '', ['الي', 'To']),
  ('branch', 'الفرع', 'Branch', '', []),
  ('carOwner', 'مالك السيارة', 'Car Owner', '', ['مالك السياره']),
  ('carNumber', 'رقم السيارة', 'Car Number', '', ['رقم السياره']),
  ('ownerType', 'نوع المالك', 'Owner Type', '', []),
  ('executionStatus', 'حالة التنفيذ', 'Execution Status', '', ['حاله التنفيذ']),
  ('applicationStatus', 'الحالة', 'Status', '', ['حاله الابلكيشن', 'حالة الابلكيشن']),
  ('driverRentalType', 'نوع تأجير السائق', 'Driver Rental Type', '', []),
  ('username', 'اسم العميل', 'Customer name', '', []),
  ('paymentMethod', 'طريقة الدفع', 'Payment Method', '', ['طريقه الدفع']),
  ('purchaseValue', 'سعر الشراء', 'Purchase Value', 'number', ['قيمه الشراء', 'قيمة الشراء']),
  ('sellingValue', 'سعر البيع', 'Selling Value', 'number', ['قيمه البيع', 'قيمة البيع']),
  ('reference', 'رقم المرجع', 'Reference', '', ['المرجع']),
  ('userPhone', 'هاتف العميل', 'Customer phone', '', []),
  ('driverName', 'اسم السائق', 'Driver Name', '', []),
  ('driverPhone', 'هاتف السائق', 'Driver Phone', '', []),
  ('carName', 'اسم السيارة', 'Car Name', '', ['اسم السياره']),
  ('plateNumber', 'رقم اللوحة', 'Plate Number', '', ['رقم اللوحه']),
  ('truckType', 'نوع الشاحنة', 'Truck Type', '', ['نوع الشاحنه']),
  ('truckSize', 'حجم الشاحنة', 'Truck Size', '', ['حجم الشاحنه']),
  ('loadType', 'نوع الحمولة', 'Load Type', '', ['نوع الحموله']),
  ('quantity', 'الكمية', 'Quantity', '', ['الكميه']),
  ('goodsValue', 'قيمة البضائع', 'Goods Value', 'number', ['قيمه البضائع']),
  ('representativeName', 'اسم المندوب', 'Representative', '', []),
  ('country', 'اسم الدولة', 'Country', '', ['الدوله', 'الدولة', 'اسم الدوله']),
];
const List<_F> _opsFields = [('operationsReview', 'مراجعه التشغيل', 'Operations Review', '', [])];
const List<_F> _modFields = [
  ('paymentDate', 'تاريخ السداد', 'Payment Date', 'date', []),
  ('payingBranch', 'الفرع المسدد', 'Paying Branch', '', []),
  ('finalReportDestination', 'وجهه أمر النقل النهائي', 'Final Report Destination', '', []),
  ('documentNumber', 'رقم السند', 'Document Number', '', []),
  ('sendingDate', 'تاريخ الارسال', 'Sending Date', 'date', []),
  ('deliveryDate', 'تاريخ التسليم', 'Delivery Date', 'date', []),
  ('accountingReview', 'مراجعه الحسابات', 'Accounting Review', '', []),
];
const List<_F> _colFields = [
  ('invoiceNumber', 'رقم الفاتوره', 'Invoice Number', '', []),
  ('netInvoice', 'صافي الفاتوره', 'Net Invoice', 'number', []),
  ('tax', 'ضريبه', 'Tax', 'number', []),
  ('totalInvoice', 'اجمالى الفاتوره', 'Total Invoice', 'number', []),
  ('invoiceDate', 'تاريخ الفاتوره', 'Invoice Date', 'date', []),
  ('invoiceNotes', 'ملاحظات الفاتوره', 'Invoice Notes', '', []),
  ('collectionDate', 'تاريخ التحصيل', 'Collection Date', 'date', []),
];

const _sections = [
  ('application', 'بيانات الطلب', 'Application Details', T.cyan, _appFields),
  ('operations', 'التشغيل', 'Operations', Color(0xFF0D9488), _opsFields),
  ('manual_moderator', 'بيانات المودريتور', 'Manual Moderator', T.orange, _modFields),
  ('collections', 'التحصيل', 'Collections', T.info, _colFields),
];

/// Role to the groups it writes in the form, same table as the web.
const _roleEditable = {
  'super_admin': ['application', 'operations_staff', 'manual_moderator', 'collections'],
  'moderator': ['application', 'manual_moderator'],
  'operations_manager': ['operations_staff'],
  'operations': ['application'],
  'admin': ['collections'],
  'employee': ['collections'],
};

const _allFields = [..._appFields, ..._opsFields, ..._modFields, ..._colFields];
const _dateKeys = {'reportDate', 'paymentDate', 'sendingDate', 'deliveryDate', 'invoiceDate', 'collectionDate'};

/// Preview columns: statement number, from, to, branch, owner, vehicle number, purchase, sale.
final _previewCols = [_appFields[0], _appFields[2], _appFields[3], _appFields[4], _appFields[5], _appFields[6], _appFields[13], _appFields[14]];

Map<String, String> _buildHeaderMap() {
  final m = <String, String>{};
  for (final f in _allFields) {
    m[f.$2] = f.$1;
    m[f.$2.trim()] = f.$1;
    m[f.$3] = f.$1;
    m[f.$3.toLowerCase()] = f.$1;
    m[f.$1] = f.$1;
    for (final a in f.$5) { m[a] = f.$1; m[a.trim()] = f.$1; }
  }
  return m;
}

class OpsWorkflowNewScreen extends StatefulWidget {
  final bool importMode;
  const OpsWorkflowNewScreen({super.key, this.importMode = false});
  @override
  State<OpsWorkflowNewScreen> createState() => _OpsWorkflowNewScreenState();
}

class _OpsWorkflowNewScreenState extends State<OpsWorkflowNewScreen> {
  late bool _import = widget.importMode;
  final Map<String, TextEditingController> _form = {};
  bool _saving = false;
  List<Map<String, String>> _rows = [];
  String _fileName = '';
  List<String> _unmapped = [];
  bool _importing = false;
  final _headerMap = _buildHeaderMap();

  @override
  void dispose() {
    for (final c in _form.values) { c.dispose(); }
    super.dispose();
  }

  TextEditingController _c(String k) => _form[k] ??= TextEditingController();

  Future<void> _create() async {
    setState(() => _saving = true);
    final body = <String, String>{for (final e in _form.entries) if (e.value.text.trim().isNotEmpty) e.key: e.value.text};
    try {
      await Api.instance.post('/api/workflows', body);
      if (!mounted) return;
      opsSnack(context, tr('تم إنشاء الطلب', 'Request created'));
      Navigator.pop(context, true);
    } catch (e) {
      if (mounted) opsSnack(context, opsErr(e).isEmpty ? tr('تعذّر إنشاء الطلب', 'Failed to create') : opsErr(e), error: true);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  // Reading the file
  Future<void> _pickFile() async {
    final res = await FilePicker.platform.pickFiles(withData: true, type: FileType.custom, allowedExtensions: ['xlsx', 'xls', 'csv']);
    final f = res?.files.firstOrNull;
    if (f == null || f.bytes == null) return;
    try {
      final table = f.name.toLowerCase().endsWith('.csv') ? _readCsv(utf8.decode(f.bytes!, allowMalformed: true)) : _readXlsx(f.bytes!);
      if (table.length < 2) {
        if (mounted) opsSnack(context, tr('ملف الإكسل فارغ', 'The Excel file is empty'), error: true);
        return;
      }
      final headers = table.first.map((e) => (e ?? '').toString()).toList();
      final notMapped = <String>{};
      final mapped = <Map<String, String>>[];
      for (final row in table.skip(1)) {
        if (row.every((x) => x == null || x.toString().trim().isEmpty)) continue;
        final out = <String, String>{};
        for (var i = 0; i < headers.length; i++) {
          final h = headers[i];
          final t = h.trim();
          final key = _headerMap[h] ?? _headerMap[t] ?? _headerMap[t.toLowerCase()];
          final v = i < row.length ? row[i] : null;
          if (key != null) {
            if (_dateKeys.contains(key) && v is num) {
              // An Excel date is a serial number; read it raw (see xlsx-date-epoch-trap).
              final d = DateTime.utc(1899, 12, 30).add(Duration(days: v.floor()));
              out[key] = opsYmd(d);
            } else {
              out[key] = v == null ? '' : (v is num && v == v.truncateToDouble() ? v.toInt().toString() : v.toString());
            }
          } else if (t.isNotEmpty && (v ?? '').toString().trim().isNotEmpty) {
            notMapped.add(t);
          }
        }
        mapped.add(out);
      }
      setState(() { _fileName = f.name; _rows = mapped; _unmapped = notMapped.toList(); });
    } catch (_) {
      if (mounted) opsSnack(context, tr('تعذّر قراءة ملف الإكسل', 'Failed to parse the Excel file'), error: true);
    }
  }

  List<List<Object?>> _readCsv(String text) {
    final out = <List<Object?>>[];
    for (final line in const LineSplitter().convert(text)) {
      final cells = <Object?>[];
      final sb = StringBuffer();
      var q = false;
      for (var i = 0; i < line.length; i++) {
        final ch = line[i];
        if (ch == '"') {
          if (q && i + 1 < line.length && line[i + 1] == '"') { sb.write('"'); i++; } else { q = !q; }
        } else if (ch == ',' && !q) {
          cells.add(sb.toString()); sb.clear();
        } else {
          sb.write(ch);
        }
      }
      cells.add(sb.toString());
      out.add(cells);
    }
    return out;
  }

  /// Small xlsx reader: the first sheet with its values (shared/inline strings and numbers).
  List<List<Object?>> _readXlsx(List<int> bytes) {
    final zip = ZipDecoder().decodeBytes(bytes);
    String? read(String name) {
      final f = zip.findFile(name);
      return f == null ? null : utf8.decode(f.content as List<int>, allowMalformed: true);
    }
    String unesc(String s) => s
        .replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&quot;', '"').replaceAll('&apos;', "'")
        .replaceAllMapped(RegExp(r'&#(\d+);'), (m) => String.fromCharCode(int.parse(m[1]!)))
        .replaceAllMapped(RegExp(r'&#x([0-9a-fA-F]+);'), (m) => String.fromCharCode(int.parse(m[1]!, radix: 16)))
        .replaceAll('&amp;', '&');
    String textOf(String xml) => RegExp(r'<t[^>]*>([\s\S]*?)</t>').allMatches(xml).map((m) => unesc(m[1]!)).join();

    final shared = <String>[];
    final ss = read('xl/sharedStrings.xml');
    if (ss != null) {
      for (final m in RegExp(r'<si>([\s\S]*?)</si>').allMatches(ss)) { shared.add(textOf(m[1]!)); }
    }
    // First sheet of the workbook, then its target in the relationships.
    var sheetPath = 'xl/worksheets/sheet1.xml';
    final wb = read('xl/workbook.xml');
    final rels = read('xl/_rels/workbook.xml.rels');
    if (wb != null && rels != null) {
      final rid = RegExp(r'<sheet\b[^>]*r:id="([^"]+)"').firstMatch(wb)?[1];
      if (rid != null) {
        final rel = RegExp('<Relationship\\b[^>]*Id="$rid"[^>]*>').firstMatch(rels)?[0];
        final target = rel == null ? null : RegExp(r'Target="([^"]+)"').firstMatch(rel)?[1];
        if (target != null) sheetPath = target.startsWith('/') ? target.substring(1) : 'xl/$target';
      }
    }
    final sheet = read(sheetPath) ?? '';
    int colIndex(String ref) {
      final letters = RegExp(r'^[A-Z]+').firstMatch(ref)?[0] ?? 'A';
      var n = 0;
      for (final ch in letters.codeUnits) { n = n * 26 + (ch - 64); }
      return n - 1;
    }
    final rows = <List<Object?>>[];
    for (final rm in RegExp(r'<row\b[^>]*>([\s\S]*?)</row>').allMatches(sheet)) {
      final row = <Object?>[];
      for (final cm in RegExp(r'<c\b([^>]*?)(?:/>|>([\s\S]*?)</c>)').allMatches(rm[1]!)) {
        final attrs = cm[1] ?? '';
        final inner = cm[2] ?? '';
        final ref = RegExp(r'r="([A-Z]+\d+)"').firstMatch(attrs)?[1];
        final t = RegExp(r't="([^"]+)"').firstMatch(attrs)?[1];
        final idx = ref == null ? row.length : colIndex(ref);
        while (row.length < idx) { row.add(null); }
        final v = RegExp(r'<v>([\s\S]*?)</v>').firstMatch(inner)?[1];
        Object? val;
        if (t == 's') {
          final i = int.tryParse(v ?? '');
          val = i != null && i < shared.length ? shared[i] : '';
        } else if (t == 'inlineStr') {
          val = textOf(inner);
        } else if (t == 'str' || t == 'e') {
          val = v == null ? '' : unesc(v);
        } else if (t == 'b') {
          val = v == '1' ? 'TRUE' : 'FALSE';
        } else {
          val = v == null ? null : (num.tryParse(v) ?? unesc(v));
        }
        if (row.length == idx) { row.add(val); } else { row[idx] = val; }
      }
      rows.add(row);
    }
    return rows;
  }

  Future<void> _bulkImport() async {
    if (_rows.isEmpty) { opsSnack(context, tr('لا صفوف للاستيراد', 'No rows to import'), error: true); return; }
    setState(() => _importing = true);
    try {
      final r = await Api.instance.post('/api/workflows/bulk-import', {'rows': _rows});
      if (!mounted) return;
      opsSnack(context, tr('تم استيراد ${r['imported'] ?? 0} طلبًا', 'Successfully imported ${r['imported'] ?? 0}'));
      Navigator.pop(context, true);
    } catch (e) {
      if (mounted) opsSnack(context, opsErr(e).isEmpty ? tr('فشل الاستيراد', 'Import failed') : opsErr(e), error: true);
    } finally {
      if (mounted) setState(() => _importing = false);
    }
  }

  /// Template: the 28 request field headers in Arabic.
  void _downloadTemplate() {
    final bytes = buildXlsx([('Template', [_appFields.map((f) => f.$2 as Object?).toList()])], rtl: true);
    opsShareBytes(context, bytes, 'operations-import-template.xlsx');
  }

  void _exportPreview() {
    List<ExportCol> cols(List<_F> defs) => [for (final f in defs) ExportCol(f.$2, f.$3, (r) => r[f.$1] ?? '')];
    final rows = _rows.map((r) => Map<String, dynamic>.from(r)).toList();
    opsExportMenu(context, [
      (tr('أعمدة المعاينة', 'Preview columns'), () => exportExcel(context, fileName: 'operations-import-preview', sheets: [(tr('المعاينة', 'Preview'), cols(_previewCols), rows)])),
      // The preview shows eight columns; the import uploads every matched row.
      (tr('كل الحقول (${_allFields.length} عموداً)', 'All fields (${_allFields.length} columns)'),
          () => exportExcel(context, fileName: 'operations-import-preview', sheets: [(tr('كل الحقول', 'All fields'), cols(_allFields), rows)])),
    ]);
  }

  Future<void> _editRow(int i) async {
    final ctrls = {for (final f in _previewCols) f.$1: TextEditingController(text: _rows[i][f.$1] ?? '')};
    final ok = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      builder: (c) => SafeArea(
        child: Padding(
          padding: EdgeInsets.fromLTRB(16, 16, 16, MediaQuery.of(c).viewInsets.bottom + 16),
          child: SingleChildScrollView(
            child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              Text('${tr('الصف', 'Row')} ${i + 1}', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
              const SizedBox(height: 10),
              for (final f in _previewCols)
                Padding(
                  padding: const EdgeInsets.only(bottom: 8),
                  child: TextField(
                    controller: ctrls[f.$1],
                    keyboardType: f.$4 == 'number' ? TextInputType.number : TextInputType.text,
                    decoration: InputDecoration(labelText: f.$2, isDense: true),
                  ),
                ),
              FilledButton(onPressed: () => Navigator.pop(c, true), child: Text(tr('حفظ', 'Save'))),
            ]),
          ),
        ),
      ),
    );
    if (ok == true) {
      setState(() { for (final e in ctrls.entries) { _rows[i][e.key] = e.value.text; } });
    }
    for (final c in ctrls.values) { c.dispose(); }
  }

  @override
  Widget build(BuildContext context) {
    final role = context.watch<AuthProvider>().role;
    final editable = _roleEditable[role] ?? const <String>[];
    final mappedCount = _rows.isEmpty ? 0 : _rows.expand((r) => r.entries.where((e) => e.value.isNotEmpty).map((e) => e.key)).toSet().length;
    return AppScaffold(
      title: Text(_import ? tr('استيراد من Excel', 'Import from Excel') : tr('طلب تشغيل جديد', 'New workflow request')),
      actions: [
        if (_import && _rows.isNotEmpty) IconButton(tooltip: tr('تصدير', 'Export'), icon: const Icon(Icons.file_download_outlined), onPressed: _exportPreview),
      ],
      body: ListView(padding: const EdgeInsets.fromLTRB(14, 12, 14, 30), children: [
        Text(_import ? tr('ارفع ملف Excel لاستيراد عدة طلبات دفعةً واحدة', 'Upload an Excel file to import many requests at once') : tr('املأ البيانات أدناه', 'Fill in the details below'),
            style: const TextStyle(fontSize: 12, color: T.inkSoft)),
        const SizedBox(height: 8),
        SegmentedButton<bool>(
          segments: [
            ButtonSegment(value: false, icon: const Icon(Icons.add, size: 16), label: Text(tr('طلب واحد', 'Single request'))),
            ButtonSegment(value: true, icon: const Icon(Icons.upload_file, size: 16), label: Text(tr('استيراد Excel', 'Import Excel'))),
          ],
          selected: {_import},
          onSelectionChanged: (s) => setState(() => _import = s.first),
        ),
        const SizedBox(height: 12),
        if (!_import) ...[
          for (final s in _sections)
            Padding(
              padding: const EdgeInsets.only(bottom: 10),
              child: Opacity(
                opacity: editable.contains(s.$1) ? 1 : 0.6,
                child: AppCard(
                  topAccent: s.$4,
                  child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                    Row(children: [
                      Expanded(child: Text(tr(s.$2, s.$3), style: TextStyle(fontWeight: FontWeight.w800, color: s.$4))),
                      if (!editable.contains(s.$1)) Text(tr('للعرض فقط', 'View only'), style: const TextStyle(fontSize: 11, color: T.inkFaint, fontStyle: FontStyle.italic)),
                    ]),
                    const SizedBox(height: 8),
                    for (final f in s.$5)
                      Padding(
                        padding: const EdgeInsets.only(bottom: 8),
                        child: f.$1 == 'username'
                            ? OpsCustomerField(controller: _c(f.$1), label: '${f.$2} (${f.$3})', enabled: editable.contains(s.$1))
                            : (f.$1 == 'branch' || f.$1 == 'payingBranch') && editable.contains(s.$1)
                                ? LookupField(type: 'workflow_paying_branch', controller: _c(f.$1), label: '${f.$2} (${f.$3})', noAdd: true)
                                : TextField(
                          controller: _c(f.$1),
                          enabled: editable.contains(s.$1),
                          readOnly: f.$4 == 'date',
                          keyboardType: f.$4 == 'number' ? const TextInputType.numberWithOptions(decimal: true) : TextInputType.text,
                          decoration: InputDecoration(labelText: '${f.$2} (${f.$3})', isDense: true,
                              suffixIcon: f.$4 == 'date' ? const Icon(Icons.calendar_month_outlined, size: 18) : null),
                          onTap: f.$4 == 'date'
                              ? () async {
                                  final d = await showDatePicker(context: context, initialDate: DateTime.tryParse(_c(f.$1).text) ?? DateTime.now(), firstDate: DateTime(2015), lastDate: DateTime(2040));
                                  if (d != null) setState(() => _c(f.$1).text = opsYmd(d));
                                }
                              : null,
                        ),
                      ),
                  ]),
                ),
              ),
            ),
          FilledButton.icon(
            style: FilledButton.styleFrom(backgroundColor: T.orange, minimumSize: const Size.fromHeight(46)),
            onPressed: _saving ? null : _create,
            icon: _saving ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white)) : const Icon(Icons.check),
            label: Text(tr('إنشاء الطلب', 'Create request')),
          ),
        ] else ...[
          AppCard(
            child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              Row(children: [
                const Icon(Icons.table_view_outlined, color: T.success),
                const SizedBox(width: 6),
                Expanded(child: Text(tr('رفع ملف Excel', 'Upload Excel file'), style: const TextStyle(fontWeight: FontWeight.w800))),
                TextButton.icon(onPressed: _downloadTemplate, icon: const Icon(Icons.download, size: 16), label: Text(tr('تحميل القالب', 'Download template'))),
              ]),
              Text(tr('يدعم رؤوس الأعمدة بالعربية والإنجليزية', 'Supports Arabic and English column headers'), style: const TextStyle(fontSize: 11, color: T.inkFaint)),
              const SizedBox(height: 10),
              Pressable(
                onTap: _pickFile,
                child: Container(
                  padding: const EdgeInsets.all(22),
                  decoration: BoxDecoration(border: Border.all(color: T.line, width: 1.5), borderRadius: BorderRadius.circular(14), color: T.canvas),
                  child: Column(children: [
                    const Icon(Icons.upload_rounded, size: 30, color: T.inkFaint),
                    const SizedBox(height: 6),
                    if (_fileName.isEmpty) ...[
                      Text(tr('اضغط لاختيار ملف', 'Tap to choose a file'), style: const TextStyle(color: T.inkSoft)),
                      const Text('.xlsx · .xls · .csv', style: TextStyle(fontSize: 11, color: T.inkFaint)),
                    ] else ...[
                      Text(_fileName, style: const TextStyle(fontWeight: FontWeight.w700)),
                      Text(tr('${_rows.length} صفًّا · $mappedCount حقلًا مطابقًا', '${_rows.length} rows · $mappedCount fields mapped'), style: const TextStyle(fontSize: 11.5, color: T.success)),
                    ],
                  ]),
                ),
              ),
            ]),
          ),
          if (_unmapped.isNotEmpty) ...[
            const SizedBox(height: 10),
            Container(
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(color: T.warn.withValues(alpha: 0.08), borderRadius: BorderRadius.circular(12), border: Border.all(color: T.warn.withValues(alpha: 0.3))),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(tr('أعمدة لم تُطابَق (تُتجاهل):', 'Columns not matched (ignored):'), style: const TextStyle(fontWeight: FontWeight.w700, color: T.warn)),
                Text(_unmapped.join(' • '), style: const TextStyle(fontSize: 11.5, color: T.inkSoft)),
              ]),
            ),
          ],
          if (_rows.isNotEmpty) ...[
            const SizedBox(height: 12),
            Row(children: [
              Expanded(child: Text('${tr('المعاينة', 'Preview')} (${_rows.length})', style: const TextStyle(fontWeight: FontWeight.w800))),
              Text(tr('أعمدة رئيسيّة · تُستورد كل الحقول المطابقة', 'Key columns · all mapped fields import'), style: const TextStyle(fontSize: 10.5, color: T.inkFaint)),
            ]),
            const SizedBox(height: 6),
            for (var i = 0; i < _rows.length; i++)
              Padding(
                padding: const EdgeInsets.only(bottom: 6),
                child: AppCard(
                  padding: const EdgeInsets.fromLTRB(12, 8, 4, 8),
                  child: Row(children: [
                    Text('${i + 1}', style: const TextStyle(fontSize: 11, color: T.inkFaint)),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Pressable(
                        onTap: () => _editRow(i),
                        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          Text(_rows[i]['reportNumber']?.isNotEmpty == true ? _rows[i]['reportNumber']! : '—', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13)),
                          Text('${_rows[i]['fromLocation'] ?? '—'} ← ${_rows[i]['toLocation'] ?? '—'} · ${_rows[i]['branch'] ?? ''}', style: const TextStyle(fontSize: 11.5)),
                          Text([
                            _rows[i]['carOwner'], _rows[i]['carNumber'],
                            if ((_rows[i]['purchaseValue'] ?? '').isNotEmpty) '${tr('شراء', 'buy')} ${_rows[i]['purchaseValue']}',
                            if ((_rows[i]['sellingValue'] ?? '').isNotEmpty) '${tr('بيع', 'sell')} ${_rows[i]['sellingValue']}',
                          ].where((x) => (x ?? '').isNotEmpty).join(' · '), style: const TextStyle(fontSize: 11, color: T.inkSoft)),
                        ]),
                      ),
                    ),
                    IconButton(tooltip: tr('تعديل', 'Edit'), icon: const Icon(Icons.edit_outlined, size: 18), onPressed: () => _editRow(i)),
                    IconButton(tooltip: tr('حذف الصف', 'Remove row'), icon: const Icon(Icons.delete_outline, size: 18, color: T.danger), onPressed: () => setState(() => _rows.removeAt(i))),
                  ]),
                ),
              ),
            const SizedBox(height: 8),
            Row(children: [
              OutlinedButton(onPressed: () => setState(() { _rows = []; _fileName = ''; _unmapped = []; }), child: Text(tr('مسح', 'Clear'))),
              const SizedBox(width: 10),
              Expanded(
                child: FilledButton.icon(
                  style: FilledButton.styleFrom(backgroundColor: T.orange),
                  onPressed: _importing ? null : _bulkImport,
                  icon: _importing ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white)) : const Icon(Icons.upload),
                  label: Text(tr('استيراد ${_rows.length} طلبًا', 'Import ${_rows.length} requests')),
                ),
              ),
            ]),
          ],
        ],
      ]),
    );
  }
}
