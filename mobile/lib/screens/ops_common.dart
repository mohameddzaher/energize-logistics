import 'dart:io';
import 'package:flutter/material.dart';
import 'package:path_provider/path_provider.dart';
import 'package:share_plus/share_plus.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../ui/theme.dart';

/// ما تشترك فيه شاشاتُ التشغيل: الحالات، أنواعُ الدفع، فلاترُ الأعمدة،
/// أوضاعُ الفترة، وتصديرُ ملفّات الخادم — نظيرُ lib/ops.ts وlib/paymentKind
/// وColumnFilter وbackgroundExport في الويب.

/// حالاتُ الطلب في منصّة التشغيل — نفسُ قائمة الويب (lib/ops.ts).
const opsAppStatuses = {
  'requesting': ('قيد الطلب', 'Requesting', T.inkFaint),
  'loading': ('جاري التحميل', 'Loading', T.warn),
  'uploaded': ('تم التحميل', 'Uploaded', Color(0xFFCA8A04)),
  'on_way': ('في الطريق', 'On Way', T.info),
  'arrived': ('وصلت', 'Arrived', Color(0xFF4F46E5)),
  'bond_sent': ('أُرسل السند', 'Bond Sent', T.cyan),
  'bond_received': ('استُلم السند', 'Bond Received', T.success),
  'late': ('متأخرة', 'Late', Color(0xFFEA580C)),
  'invoiced': ('تمت الفوترة', 'Invoiced', T.violet),
  'cancelled': ('ملغاة', 'Cancelled', T.danger),
};

String opsStatusLabel(dynamic v) {
  final st = opsAppStatuses[(v ?? '').toString()];
  return st != null ? tr(st.$1, st.$2) : (v ?? '').toString();
}

/// طريقةُ الدفع القادمةُ من المنصّة (PAYMENT_METHODS).
String opsPayMethodLabel(dynamic v) {
  final s = (v ?? '').toString();
  if (s == 'cash') return tr('كاش', 'Cash');
  if (s == 'late') return tr('آجل', 'Deferred');
  return s;
}

/// ── نوعُ الدفع: ستُّ قيمٍ تُعرَض وأربعٌ تُختار (lib/paymentKind) ──────────────
const opsPaymentChoices = [
  ('deferred_invoice', 'آجل - فاتورة', 'Deferred – invoice', 'tax'),
  ('deferred_cash', 'آجل - كاش', 'Deferred – cash', 'cash'),
  ('cash_3pl', 'نقدي - 3PL', 'Cash – 3PL', 'cash'),
  ('cash_ht', 'نقدي - HT', 'Cash – HT', 'cash'),
];

bool opsIsSubtype(String k) => opsPaymentChoices.any((c) => c.$1 == k);

String opsPaymentKindLabel(dynamic k) {
  final s = (k ?? '').toString();
  for (final c in opsPaymentChoices) {
    if (c.$1 == s) return tr(c.$2, c.$3);
  }
  if (s == 'cash') return tr('كاش', 'Cash');
  if (s == 'tax') return tr('ضريبي', 'Tax');
  return '';
}

/// ما تعرضه الخانة: النوعُ إن وُجد، وإلّا العائلة.
String opsPaymentKindOf(Map<String, dynamic> w) {
  final pt = (w['paymentType'] ?? '').toString();
  if (opsIsSubtype(pt)) return pt;
  final sub = (w['paymentSubtype'] ?? '').toString();
  if (opsIsSubtype(sub)) return sub;
  return pt == 'cash' || pt == 'tax' ? pt : '';
}

String opsMoney(dynamic v, {bool dash = true}) {
  if (v == null || v == '') return dash ? '—' : '';
  final n = (v is num) ? v : num.tryParse(v.toString());
  if (n == null) return v.toString();
  final fixed = n == n.truncateToDouble() ? n.toStringAsFixed(0) : n.toStringAsFixed(2);
  final parts = fixed.split('.');
  final whole = parts[0].replaceAllMapped(RegExp(r'\B(?=(\d{3})+(?!\d))'), (m) => ',');
  return parts.length > 1 ? '$whole.${parts[1]}' : whole;
}

String opsDate(dynamic v) {
  if (v == null || v.toString().isEmpty) return '—';
  final d = DateTime.tryParse(v.toString())?.toLocal();
  return d == null ? v.toString() : '${d.day.toString().padLeft(2, '0')}/${d.month.toString().padLeft(2, '0')}/${d.year}';
}

String opsDateTime(dynamic v) {
  if (v == null || v.toString().isEmpty) return '—';
  final d = DateTime.tryParse(v.toString())?.toLocal();
  if (d == null) return v.toString();
  return '${opsDate(v)} ${d.hour.toString().padLeft(2, '0')}:${d.minute.toString().padLeft(2, '0')}';
}

String opsYmd(DateTime d) => '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';

/// اسمُ قيمةٍ محلّيّة من المنصّة: نصٌّ أو {ar,en} أو علاقةٌ تحمل اسمَها في `name`.
String opsLoc(dynamic v) {
  if (v == null) return '';
  if (v is String || v is num) return v.toString();
  if (v is Map) {
    final pick = v[Lang.instance.ar ? 'ar' : 'en'] ?? v['en'] ?? v['ar'];
    if (pick is String || pick is num) return pick.toString();
    if (v['name'] != null) return opsLoc(v['name']);
  }
  return '';
}

void opsSnack(BuildContext context, String msg, {bool error = false}) {
  ScaffoldMessenger.of(context).showSnackBar(SnackBar(
    content: Text(msg),
    backgroundColor: error ? T.danger : null,
  ));
}

String opsErr(Object e) => e is ApiException ? e.message : e.toString();

/// ── شروطُ القائمة أزواجًا (مفتاح، قيمة) ─────────────────────────────────────
/// القيمُ المكرّرة (`cf_x=a&cf_x=b`) تُرسل مكرّرةً كما في الويب، وتُحوَّل إلى
/// خريطةٍ (قيمةٌ أو قائمة) حين تُرسل في جسم الطلب (allMatching، التصدير الخلفيّ).
String opsQs(List<(String, String)> p) =>
    p.map((x) => '${x.$1}=${Uri.encodeQueryComponent(x.$2)}').join('&');

Map<String, dynamic> opsQueryMap(List<(String, String)> p) {
  final out = <String, dynamic>{};
  for (final (k, v) in p) {
    final cur = out[k];
    if (cur == null) {
      out[k] = v;
    } else if (cur is List) {
      cur.add(v);
    } else {
      out[k] = [cur, v];
    }
  }
  return out;
}

/// ── خيارُ فترة: يومٌ أو شهرٌ أو مدى ─────────────────────────────────────────
enum OpsDateMode { day, month, range }

/// المدى المشتقّ من الوضع — `(from, to)` بصيغة YYYY-MM-DD أو (null, null).
class OpsPeriod {
  OpsDateMode mode;
  DateTime? day;
  DateTime? month;
  DateTimeRange? range;
  OpsPeriod({this.mode = OpsDateMode.range, this.day, this.month, this.range});

  (String?, String?) get dates {
    switch (mode) {
      case OpsDateMode.day:
        return day == null ? (null, null) : (opsYmd(day!), opsYmd(day!));
      case OpsDateMode.month:
        if (month == null) return (null, null);
        return (opsYmd(month!), opsYmd(DateTime(month!.year, month!.month + 1, 0)));
      case OpsDateMode.range:
        return range == null ? (null, null) : (opsYmd(range!.start), opsYmd(range!.end));
    }
  }

  String get label {
    final (from, to) = dates;
    if (from == null) return tr('كل الفترات', 'Any time');
    if (mode == OpsDateMode.month) return '${month!.month.toString().padLeft(2, '0')}/${month!.year}';
    return from == to ? opsDate(from) : '${opsDate(from)} → ${opsDate(to)}';
  }

  void clear() { day = null; month = null; range = null; }
}

/// منتقي الشهر — سنةٌ وأشهرُها الاثنا عشر (نظيرُ MonthPicker في الويب).
Future<DateTime?> opsPickMonth(BuildContext context, DateTime? initial) {
  var year = (initial ?? DateTime.now()).year;
  return showDialog<DateTime>(
    context: context,
    builder: (c) => StatefulBuilder(builder: (c, set) => AlertDialog(
      title: Row(children: [
        IconButton(onPressed: () => set(() => year--), icon: const Icon(Icons.chevron_left)),
        Expanded(child: Center(child: Text('$year'))),
        IconButton(onPressed: () => set(() => year++), icon: const Icon(Icons.chevron_right)),
      ]),
      content: SizedBox(
        width: 300,
        child: GridView.count(
          shrinkWrap: true,
          crossAxisCount: 3,
          childAspectRatio: 2,
          children: [
            for (var m = 1; m <= 12; m++)
              Padding(
                padding: const EdgeInsets.all(3),
                child: OutlinedButton(
                  style: OutlinedButton.styleFrom(
                    backgroundColor: initial != null && initial.year == year && initial.month == m ? T.orange : null,
                    foregroundColor: initial != null && initial.year == year && initial.month == m ? Colors.white : T.ink,
                    padding: EdgeInsets.zero,
                  ),
                  onPressed: () => Navigator.pop(c, DateTime(year, m)),
                  child: Text(m.toString().padLeft(2, '0')),
                ),
              ),
          ],
        ),
      ),
    )),
  );
}

/// شريطُ الفترة: يوم / شهر / مدى ثمّ منتقيه. يغيّر `period` ثمّ ينادي `onChanged`.
class OpsPeriodBar extends StatefulWidget {
  final OpsPeriod period;
  final VoidCallback onChanged;
  const OpsPeriodBar({super.key, required this.period, required this.onChanged});
  @override
  State<OpsPeriodBar> createState() => _OpsPeriodBarState();
}

class _OpsPeriodBarState extends State<OpsPeriodBar> {
  OpsPeriod get period => widget.period;
  void onChanged() { if (mounted) setState(() {}); widget.onChanged(); }

  Future<void> _pick(BuildContext context) async {
    final now = DateTime.now();
    switch (period.mode) {
      case OpsDateMode.day:
        final d = await showDatePicker(context: context, initialDate: period.day ?? now, firstDate: DateTime(2018), lastDate: DateTime(now.year + 2));
        if (d != null) { period.day = d; onChanged(); }
      case OpsDateMode.month:
        final m = await opsPickMonth(context, period.month ?? DateTime(now.year, now.month));
        if (m != null) { period.month = m; onChanged(); }
      case OpsDateMode.range:
        final r = await showDateRangePicker(context: context, initialDateRange: period.range, firstDate: DateTime(2018), lastDate: DateTime(now.year + 2));
        if (r != null) { period.range = r; onChanged(); }
    }
  }

  @override
  Widget build(BuildContext context) {
    final has = period.dates.$1 != null;
    return Row(children: [
      for (final m in OpsDateMode.values) ...[
        ChoiceChip(
          visualDensity: VisualDensity.compact,
          label: Text(switch (m) { OpsDateMode.day => tr('يوم', 'Day'), OpsDateMode.month => tr('شهر', 'Month'), OpsDateMode.range => tr('مدى', 'Range') }),
          selected: period.mode == m,
          onSelected: (_) {
            if (period.mode == m) return;
            // تبديلُ الوضع يمسح ما اختاره السابق — بقاؤه فلترٌ لا يراه أحد.
            final had = period.dates.$1 != null;
            setState(() { period.mode = m; period.clear(); });
            if (had) onChanged();
            _pick(context);
          },
        ),
        const SizedBox(width: 4),
      ],
      Expanded(
        child: OutlinedButton.icon(
          style: OutlinedButton.styleFrom(padding: const EdgeInsets.symmetric(horizontal: 8)),
          onPressed: () => _pick(context),
          icon: const Icon(Icons.calendar_month_outlined, size: 16),
          label: Text(period.label, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 11.5)),
        ),
      ),
      if (has)
        IconButton(
          visualDensity: VisualDensity.compact,
          tooltip: tr('مسح', 'Clear'),
          onPressed: () { period.clear(); onChanged(); },
          icon: const Icon(Icons.close, size: 18),
        ),
    ]);
  }
}

/// ── قائمةُ قيم عمودٍ بأعدادها — `/api/workflows/filters` ──────────────────
/// الطلبُ يحمل الفلاترَ النشطة كلَّها عدا فلترِ العمود نفسِه (كما في الويب).
Future<Set<String>?> opsPickColumnFilter(
  BuildContext context, {
  required String field,
  required String label,
  required List<(String, String)> params,
  required Set<String> current,
  required String Function(String field, String value) labelOf,
}) async {
  final picked = Set<String>.from(current);
  List<Map<String, dynamic>> opts = [];
  String q = '';
  bool busy = true;
  bool started = false;
  bool truncated = false;
  int seq = 0;
  Future<void> fetch(StateSetter set) async {
    final mine = ++seq;
    try {
      final d = await Api.instance.get('/api/workflows/filters?${opsQs([...params, ('field', field), if (q.isNotEmpty) ('q', q)])}');
      if (mine != seq) return;
      final f = (d['filters'] as List?)?.cast<Map>().firstOrNull;
      opts = List<Map<String, dynamic>>.from((f?['values'] as List?) ?? const []);
      truncated = f?['truncated'] == true;
    } catch (_) {
      if (mine != seq) return;
      opts = [];
    }
    busy = false;
    set(() {});
  }
  final ok = await showModalBottomSheet<bool>(
    context: context,
    isScrollControlled: true,
    backgroundColor: Colors.white,
    shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
    builder: (c) => StatefulBuilder(builder: (c, set) {
      if (!started) { started = true; fetch(set); }
      return SafeArea(
        child: Padding(
          padding: EdgeInsets.only(bottom: MediaQuery.of(c).viewInsets.bottom),
          child: SizedBox(
            height: MediaQuery.of(c).size.height * 0.7,
            child: Column(children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 14, 16, 6),
                child: Row(children: [
                  Expanded(child: Text(label, style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w800))),
                  if (picked.isNotEmpty) TextButton(onPressed: () => set(picked.clear), child: Text(tr('مسح', 'Clear'))),
                ]),
              ),
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16),
                child: TextField(
                  textInputAction: TextInputAction.search,
                  decoration: InputDecoration(hintText: tr('ابحث…', 'Search…'), prefixIcon: const Icon(Icons.search), isDense: true),
                  onSubmitted: (v) { q = v.trim(); busy = true; set(() {}); fetch(set); },
                ),
              ),
              if (truncated)
                Padding(
                  padding: const EdgeInsets.fromLTRB(16, 6, 16, 0),
                  child: Text(tr('القائمة مختصرة — ابحث لتجد قيمةً بعينها', 'List truncated — search to find a value'),
                      style: const TextStyle(fontSize: 11, color: T.warn)),
                ),
              Expanded(
                child: busy
                    ? const Center(child: CircularProgressIndicator())
                    : opts.isEmpty
                        ? Center(child: Text(tr('لا نتائج', 'No matches'), style: const TextStyle(color: T.inkFaint)))
                        : ListView(children: [
                            for (final o in opts)
                              CheckboxListTile(
                                dense: true,
                                value: picked.contains((o['value'] ?? '').toString()),
                                onChanged: (on) => set(() {
                                  final v = (o['value'] ?? '').toString();
                                  if (on == true) { picked.add(v); } else { picked.remove(v); }
                                }),
                                title: Text(labelOf(field, (o['value'] ?? '').toString()), style: const TextStyle(fontSize: 13.5)),
                                secondary: Text('${o['count'] ?? 0}', style: const TextStyle(fontSize: 12, color: T.inkFaint)),
                              ),
                          ]),
              ),
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 4, 16, 10),
                child: SizedBox(width: double.infinity, child: FilledButton(onPressed: () => Navigator.pop(c, true), child: Text(tr('تطبيق', 'Apply')))),
              ),
            ]),
          ),
        ),
      );
    }),
  );
  return ok == true ? picked : null;
}

/// قائمةُ أعمدة الفلترة: يُختار العمودُ ثمّ قيمُه.
Future<String?> opsPickFilterField(BuildContext context, List<(String, String, String)> fields, Map<String, Set<String>> active) {
  return showModalBottomSheet<String>(
    context: context,
    isScrollControlled: true,
    backgroundColor: Colors.white,
    shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
    builder: (c) => SafeArea(
      child: SizedBox(
        height: MediaQuery.of(c).size.height * 0.7,
        child: ListView(children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 14, 16, 6),
            child: Text(tr('فلترة بعمود', 'Filter by column'), style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w800)),
          ),
          for (final f in fields)
            ListTile(
              dense: true,
              title: Text(tr(f.$2, f.$3)),
              trailing: (active[f.$1] ?? const {}).isNotEmpty
                  ? Chip(label: Text('${active[f.$1]!.length}'), visualDensity: VisualDensity.compact)
                  : const Icon(Icons.chevron_left, size: 18),
              onTap: () => Navigator.pop(c, f.$1),
            ),
        ]),
      ),
    ),
  );
}

/// ── خياراتُ التصدير — نظيرُ ExportMenu: كلُّ خيارٍ عنوانُه ودالّتُه ────────
Future<void> opsExportMenu(BuildContext context, List<(String, Future<void> Function())> options) async {
  final pick = await showModalBottomSheet<int>(
    context: context,
    backgroundColor: Colors.white,
    shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
    builder: (c) => SafeArea(
      child: Column(mainAxisSize: MainAxisSize.min, children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(18, 14, 18, 6),
          child: Align(alignment: AlignmentDirectional.centerStart, child: Text(tr('تصدير Excel', 'Export to Excel'), style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w800))),
        ),
        for (var i = 0; i < options.length; i++)
          ListTile(
            leading: const Icon(Icons.file_download_outlined, color: T.navy),
            title: Text(options[i].$1, style: const TextStyle(fontSize: 14)),
            onTap: () => Navigator.pop(c, i),
          ),
        const SizedBox(height: 6),
      ]),
    ),
  );
  if (pick == null) return;
  await options[pick].$2();
}

/// ملفٌّ من الخادم (بايتات) يُحفظ ثمّ تُفتح نافذةُ المشاركة.
Future<void> opsShareBytes(BuildContext context, List<int> bytes, String fileName) async {
  final dir = await getTemporaryDirectory();
  final file = File('${dir.path}/$fileName');
  await file.writeAsBytes(bytes, flush: true);
  await SharePlus.instance.share(ShareParams(files: [XFile(file.path, mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')]));
}

/// تصديرُ «كلّ ما طابق الفلتر» يبنيه الخادم ملفًّا (GET <path>/export).
Future<void> opsServerExport(BuildContext context, String path, String fileStem) async {
  final messenger = ScaffoldMessenger.of(context);
  messenger.showSnackBar(SnackBar(content: Text(tr('جارٍ تجهيز الملف…', 'Preparing the file…'))));
  try {
    final bytes = await Api.instance.getBytes(path);
    if (!context.mounted) return;
    await opsShareBytes(context, bytes, '$fileStem-${opsYmd(DateTime.now())}.xlsx');
  } catch (e) {
    messenger.showSnackBar(SnackBar(content: Text(tr('تعذّر التصدير: ${opsErr(e)}', 'Export failed: ${opsErr(e)}'))));
  }
}

/// «الجدولُ كلُّه» يُبنى في الخلفيّة — يُسجَّل الطلبُ، ويُسأل عنه، ثمّ يُنزَّل
/// (lib/backgroundExport). ويصل إشعارٌ بالرابط من الخادم على كلّ حال.
Future<void> opsBackgroundExport(BuildContext context, String kind, Map<String, dynamic> query) async {
  final messenger = ScaffoldMessenger.of(context);
  messenger.showSnackBar(SnackBar(content: Text(tr('جارٍ تجهيز الملف… سيُفتح حين يجهز، وسيصلك إشعار.', 'Preparing the file… it opens when ready, and you will get a notification.'))));
  try {
    final r = await Api.instance.post('/api/exports/jobs', {'kind': kind, 'query': query});
    final id = (r['job']?['_id'] ?? '').toString();
    final deadline = DateTime.now().add(const Duration(minutes: 10));
    while (DateTime.now().isBefore(deadline)) {
      await Future.delayed(const Duration(milliseconds: 2500));
      Map? job;
      try { job = (await Api.instance.get('/api/exports/jobs/$id'))['job'] as Map?; } catch (_) { continue; }
      if (job == null) continue;
      if (job['status'] == 'done') {
        messenger.showSnackBar(SnackBar(content: Text(tr('جهز الملف — ${job['rows'] ?? ''} صفًّا', 'Ready — ${job['rows'] ?? ''} rows'))));
        final bytes = await Api.instance.getBytes('/api/exports/jobs/$id/download');
        if (!context.mounted) return;
        await opsShareBytes(context, bytes, (job['fileName'] ?? 'export.xlsx').toString());
        return;
      }
      if (job['status'] == 'failed') {
        messenger.showSnackBar(SnackBar(content: Text((job['error'] ?? tr('تعذّر التصدير', 'Export failed')).toString())));
        return;
      }
    }
  } catch (e) {
    messenger.showSnackBar(SnackBar(content: Text(tr('تعذّر التصدير: ${opsErr(e)}', 'Export failed: ${opsErr(e)}'))));
  }
}

Future<bool> opsConfirm(BuildContext context, String message, {String? title, bool danger = false}) async {
  final ok = await showDialog<bool>(
    context: context,
    builder: (c) => AlertDialog(
      title: Text(title ?? tr('تأكيد', 'Confirm')),
      content: Text(message),
      actions: [
        TextButton(onPressed: () => Navigator.pop(c, false), child: Text(tr('إلغاء', 'Cancel'))),
        FilledButton(
          style: danger ? FilledButton.styleFrom(backgroundColor: T.danger) : null,
          onPressed: () => Navigator.pop(c, true),
          child: Text(tr('تأكيد', 'Confirm')),
        ),
      ],
    ),
  );
  return ok == true;
}
