import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/customs_link.dart';
import '../ui/report_follow_ups.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';

/// التشغيل — كشوف التخريج (Operations Workflows): قائمة بمراحلها الخمس،
/// إحصائيات علوية، تقدّم المرحلة، وشاشة تفاصيل بكل الحقول.
class OpsWorkflowsScreen extends StatefulWidget {
  const OpsWorkflowsScreen({super.key});
  @override
  State<OpsWorkflowsScreen> createState() => _OpsWorkflowsScreenState();
}

/// حالاتُ الطلب في منصّة التشغيل — نفسُ قائمة الويب (lib/ops.ts) ونفسُ ألوان
/// شاشة المنصّة (screens/ops_platform.dart)، فالحالةُ الواحدة تُقرأ لونًا
/// واحدًا في الشاشتين.
const _appStatuses = {
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

/// ── نوعُ الدفع: ستُّ قيمٍ تُعرَض وأربعٌ تُختار ─────────────────────────────
/// «آجل - فاتورة» محلَّ «ضريبي»، و«آجل - كاش» و«نقدي - 3PL» و«نقدي - HT» محلَّ
/// «كاش» (صاحبُ الشركة، ٢٠٢٦/١٠/٢١). والخادمُ يحفظ العائلةَ (`paymentType`) والنوعَ
/// (`paymentSubtype`) — نفسُ lib/paymentKind في الويب.
const _paymentChoices = [
  ('deferred_invoice', 'آجل - فاتورة', 'Deferred – invoice'),
  ('deferred_cash', 'آجل - كاش', 'Deferred – cash'),
  ('cash_3pl', 'نقدي - 3PL', 'Cash – 3PL'),
  ('cash_ht', 'نقدي - HT', 'Cash – HT'),
];

String _paymentKindLabel(String k) {
  for (final c in _paymentChoices) {
    if (c.$1 == k) return tr(c.$2, c.$3);
  }
  if (k == 'cash') return tr('كاش', 'Cash');
  if (k == 'tax') return tr('ضريبي', 'Tax');
  return k;
}

/// ما تعرضه الخانة: النوعُ إن وُجد، وإلّا العائلة.
String _paymentKindOf(Map<String, dynamic> w) {
  final sub = (w['paymentSubtype'] ?? '').toString();
  if (_paymentChoices.any((c) => c.$1 == sub)) return sub;
  return (w['paymentType'] ?? '').toString();
}

String _money(dynamic v) {
  final n = (v is num) ? v : num.tryParse(v?.toString() ?? '') ?? 0;
  return n.toStringAsFixed(0).replaceAllMapped(RegExp(r'\B(?=(\d{3})+(?!\d))'), (m) => ',');
}

/// أعمدةُ شريط الفلترة — نفسُ أعمدة الويب (WorkflowFilterBar)، وتكتب في فلاتر
/// الأعمدة نفسِها (`cf_<العمود>`). و`invoiceState` عمودٌ محسوبٌ في الخادم.
const _barFields = [
  ('username', 'العميل', 'Customer', false),
  ('branch', 'الفرع', 'Branch', false),
  ('fromLocation', 'من', 'From', false),
  ('toLocation', 'إلى', 'To', false),
  ('paymentType', 'نوع الدفع', 'Payment type', false),
  ('applicationStatus', 'حالة الطلب', 'Status', false),
  ('driverName', 'السائق', 'Driver', false),
  ('carNumber', 'رقم السيارة', 'Vehicle', false),
  ('carOwner', 'مالك السيارة', 'Car owner', false),
  ('truckType', 'نوع الشاحنة', 'Truck type', false),
  ('payingBranch', 'الفرع المسدِّد', 'Paying branch', false),
  ('invoiceState', 'رقم الفاتورة', 'Invoice number', true),
  // معاملةُ التخليص: أرقامُ المعاملات، و«غير مرتبط» = بلا معاملة.
  ('customsRef', 'التخليص', 'Customs', false),
];

/// بطاقاتُ فحص الفواتير الأربع — نفسُ بطاقات الويب (InvoiceCheckCards).
const _checkKinds = [
  ('gaps', 'فواتير لم تُفوتَر', 'Missing invoice numbers', T.violet),
  ('missing-reports', 'فواتير بكشوفات غير موجودة', 'Invoices citing missing reports', T.warn),
  ('value-diffs', 'فرق قيمة الفاتورة', 'Invoice value differences', T.danger),
  ('name-mismatches', 'عدم تطابق اسم العميل', 'Customer name mismatch', T.info),
];

String _d(dynamic v) {
  final d = v != null ? DateTime.tryParse(v.toString())?.toLocal() : null;
  return d == null ? (v ?? '—').toString() : '${d.day}/${d.month}/${d.year}';
}

class _OpsWorkflowsScreenState extends State<OpsWorkflowsScreen> {
  List<Map<String, dynamic>> _rows = [];
  Map<String, dynamic> _stats = {};
  bool _loading = true;
  String? _error;
  String _q = '';
  /// فلاترُ الأعمدة — العمود ← القيم المختارة. شريطُ الفلترة يكتب فيها كما في
  /// الويب، وبطاقاتُ الحالات الإحدى عشرة أُزيلت (صارت قيمًا في «حالة الطلب»).
  final Map<String, Set<String>> _cf = {};
  /// «سندات لم تصل» — الإجماليُّ وحدَه (أُزيلت بطاقتا الكاش والضريبيّ كالويب).
  bool _pendingOnly = false;
  /// «التخليص»: '' الكلّ، `linked` المرتبطة، `unlinked` غيرُ المرتبطة — كالويب.
  String _customs = '';
  /// ربطُ الكشف بمعاملة تخليص — يقوله الخادم (canLinkCustoms).
  bool _canLinkCustoms = false;
  /// حقولُ هذا الدور كما يحسبها الخادم — قيمةُ البيع تُكتب لمن هي فيها.
  Set<String> _myFields = {};
  /// فحوصُ الفواتير (لمن يملك أعمدةَ المال — وغيرُه يُردّ ٤٠٣ فتُخفى).
  Map<String, dynamic>? _checks;
  int _page = 1;
  int _pages = 1;
  late final void Function() _onLive;

  @override
  void initState() {
    super.initState();
    _load();
    _onLive = () => _load();
    Live.instance.on('workflow:stageChanged', _onLive);
    Live.instance.on('workflow:created', _onLive);
    Live.instance.on('workflow:updated', _onLive);
    // المزامنةُ الحيّة مع منصّة التشغيل تبثّ هذا عند كلّ تغيُّرِ حالة.
    Live.instance.on('workflow:bulkImported', _onLive);
    Live.instance.on('workflow:deleted', _onLive);
    Api.instance.get('/api/workflows/permissions').then((d) {
      if (!mounted) return;
      setState(() {
        _myFields = Set<String>.from((d is Map ? d['myFields'] : null) ?? const []);
        _canLinkCustoms = d is Map && d['canLinkCustoms'] == true;
      });
    }).catchError((_) {});
  }

  @override
  void dispose() {
    Live.instance.off('workflow:stageChanged', _onLive);
    Live.instance.off('workflow:created', _onLive);
    Live.instance.off('workflow:updated', _onLive);
    Live.instance.off('workflow:bulkImported', _onLive);
    Live.instance.off('workflow:deleted', _onLive);
    super.dispose();
  }

  /// شروطُ القائمة كلُّها كما يرسلها الويب — تقرؤها القائمةُ والبطاقاتُ وأعدادُ الفلاتر.
  List<String> _filterParams({String? skip}) => [
        for (final e in _cf.entries)
          if (e.key != skip)
            for (final v in e.value) 'cf_${e.key}=${Uri.encodeQueryComponent(v)}',
        if (_q.trim().isNotEmpty) 'search=${Uri.encodeQueryComponent(_q.trim())}',
        if (_pendingOnly) 'pendingOnly=true',
        if (_customs.isNotEmpty) 'customs=$_customs',
      ];

  int _seq = 0;
  Future<void> _load() async {
    // الأحدثُ يفوز: ردٌّ قديمٌ لا يكتب فوق ردٍّ أحدث (البحثُ والبثُّ الحيّ يتسابقان).
    final mine = ++_seq;
    try {
      final f = _filterParams();
      final params = ['page=$_page', 'limit=40', ...f];
      final results = await Future.wait([
        Api.instance.get('/api/workflows?${params.join('&')}'),
        // البطاقاتُ تُحسب تحت الفلاتر نفسِها — كما في الويب.
        Api.instance.get('/api/workflows/stats?${f.join('&')}').catchError((_) => <String, dynamic>{}),
        Api.instance.get('/api/workflows/invoice-checks').catchError((_) => <String, dynamic>{}),
      ]);
      if (!mounted || mine != _seq) return;
      setState(() {
        _rows = List<Map<String, dynamic>>.from(results[0]['workflows'] ?? []);
        _pages = ((results[0]['pages'] ?? 1) as num).toInt();
        _stats = Map<String, dynamic>.from(results[1]);
        final c = Map<String, dynamic>.from(results[2] is Map ? results[2] : const {});
        _checks = c.containsKey('gaps') ? c : null;
        _loading = false;
        _error = null;
      });
    } catch (e) {
      if (mounted && mine == _seq) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  void _reload() { setState(() { _page = 1; _loading = true; }); _load(); }

  String _valueLabel(String field, String v) {
    if (field == 'customsRef' && v.isEmpty) return tr('غير مرتبط', 'Not linked');
    if (v.isEmpty) return tr('(فارغ)', '(blank)');
    if (field == 'applicationStatus' || field == 'executionStatus') {
      final st = _appStatuses[v];
      return st != null ? tr(st.$1, st.$2) : v;
    }
    if (field == 'paymentType') return _paymentKindLabel(v);
    if (field == 'invoiceState') {
      return {'has': tr('عليه رقم فاتورة', 'Has a number'), 'none': tr('فارغ', 'Blank'), 'placeholder': tr('بديل (no inv / بدون)', 'Placeholder')}[v] ?? v;
    }
    return v;
  }

  /// قائمةُ قيم عمودٍ بأعدادها — من `/api/workflows/filters` التي تعدّ بكلّ
  /// الفلاتر عدا فلتر العمود نفسِه، كما في شريط الويب.
  Future<void> _pickFilter(String field, String label) async {
    final picked = Set<String>.from(_cf[field] ?? const {});
    List<Map<String, dynamic>> opts = [];
    String q = '';
    bool busy = true;
    Future<void> fetch(StateSetter set) async {
      try {
        final d = await Api.instance.get('/api/workflows/filters?${[..._filterParams(skip: field), 'field=$field', if (q.isNotEmpty) 'q=${Uri.encodeQueryComponent(q)}'].join('&')}');
        final f = (d['filters'] as List?)?.cast<Map>().firstOrNull;
        opts = List<Map<String, dynamic>>.from((f?['values'] as List?) ?? const []);
      } catch (_) { opts = []; }
      busy = false;
      set(() {});
    }
    final ok = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (c) => StatefulBuilder(builder: (c, set) {
        if (busy && opts.isEmpty) fetch(set);
        return SafeArea(
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
                                title: Text(_valueLabel(field, (o['value'] ?? '').toString()), style: const TextStyle(fontSize: 13.5)),
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
        );
      }),
    );
    if (ok != true) return;
    setState(() { if (picked.isEmpty) { _cf.remove(field); } else { _cf[field] = picked; } });
    _reload();
  }

  /// قائمةُ فحصٍ من فحوص الفواتير — نفسُ قائمة الويب.
  Future<void> _openCheck(String kind, String title) async {
    List<dynamic> rows = [];
    bool busy = true;
    await showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (c) => StatefulBuilder(builder: (c, set) {
        if (busy && rows.isEmpty) {
          Api.instance.get('/api/workflows/invoice-checks/$kind').then((d) { rows = (d['rows'] as List?) ?? []; busy = false; set(() {}); })
              .catchError((_) { busy = false; set(() {}); });
        }
        String line(Map r) {
          switch (kind) {
            case 'gaps':
              return '${r['invoiceNumber']}';
            case 'missing-reports':
              return '${tr('فاتورة', 'Invoice')} ${r['invoiceNumber']} — ${tr('كشف', 'report')} ${r['reportNumber']}${(r['customerName'] ?? '').toString().isNotEmpty ? ' · ${r['customerName']}' : ''}';
            case 'value-diffs':
              return '${tr('فاتورة', 'Invoice')} ${r['invoiceNumber']}: ${tr('الورقة', 'sheet')} ${_money(r['uploadedValue'])} · ${tr('الكشوف', 'reports')} ${_money(r['reportsValue'])} · ${tr('الفرق', 'diff')} ${_money(r['difference'])}';
            default:
              return '${tr('كشف', 'Report')} ${r['reportNumber']} (${r['invoiceNumber']}): «${r['uploadedCustomer']}» ≠ «${r['workflowCustomer']}»';
          }
        }
        return SafeArea(
          child: SizedBox(
            height: MediaQuery.of(c).size.height * 0.75,
            child: Column(children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 14, 16, 8),
                child: Align(alignment: AlignmentDirectional.centerStart, child: Text('$title (${rows.length})', style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w800))),
              ),
              Expanded(
                child: busy
                    ? const Center(child: CircularProgressIndicator())
                    : rows.isEmpty
                        ? Center(child: Text(tr('لا شيء هنا', 'Nothing here'), style: const TextStyle(color: T.inkFaint)))
                        : ListView.separated(
                            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
                            itemCount: rows.length.clamp(0, 1000),
                            separatorBuilder: (_, __) => const Divider(height: 1),
                            itemBuilder: (_, i) => Padding(
                              padding: const EdgeInsets.symmetric(vertical: 8),
                              child: Text(line(Map<String, dynamic>.from(rows[i] as Map)), style: const TextStyle(fontSize: 12.5)),
                            ),
                          ),
              ),
            ]),
          ),
        );
      }),
    );
  }

  /// قيمةُ البيع تُكتب لمن يملكها — في منصّة التشغيل وهنا معًا (الخادمُ يكتب
  /// هناك أوّلًا، ولا يحفظ شيئًا إن رفضت المنصّة). نفسُ عقد الويب: PUT /api/workflows/:id.
  Future<void> _editSelling(Map<String, dynamic> w) async {
    final ctrl = TextEditingController(text: (w['sellingValue'] ?? '').toString());
    final v = await showDialog<String>(
      context: context,
      builder: (c) => AlertDialog(
        title: Text(tr('قيمة البيع', 'Selling value')),
        content: TextField(
          controller: ctrl,
          autofocus: true,
          keyboardType: const TextInputType.numberWithOptions(decimal: true),
          decoration: InputDecoration(helperText: tr('تُحفظ هنا وفي منصّة التشغيل معًا', 'Saved here and on the operations platform')),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c), child: Text(tr('إلغاء', 'Cancel'))),
          FilledButton(onPressed: () => Navigator.pop(c, ctrl.text.trim()), child: Text(tr('حفظ', 'Save'))),
        ],
      ),
    );
    if (v == null || v.isEmpty) return;
    final n = num.tryParse(v);
    if (n == null || n < 0) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(tr('أدخل رقمًا صحيحًا', 'Enter a valid number'))));
      return;
    }
    try {
      final row = await Api.instance.put('/api/workflows/${w['_id']}', {'sellingValue': n});
      if (!mounted) return;
      final onPlatform = row is Map && row['sellingPlatform'] == true;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(onPlatform
          ? tr('حُفظت قيمة البيع هنا وفي منصّة التشغيل', 'Saved here and on the platform')
          : tr('حُفظت قيمة البيع', 'Selling value saved'))));
      _load();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e is ApiException ? e.message : e.toString())));
    }
  }

  /// نوعُ الدفع — الأربعةُ وحدَها تُختار، والخادمُ يكتب العائلةَ معها ويطبّق قواعدَها
  /// (رقمُ الفاتورة، صفحتا التحصيل، تحصيلُ المحفظة). نفسُ PUT الويب.
  Future<void> _editPaymentType(Map<String, dynamic> w) async {
    final cur = _paymentKindOf(w);
    final picked = await showModalBottomSheet<String>(
      context: context,
      builder: (c) => SafeArea(
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(18, 16, 18, 4),
            child: Text(tr('نوع الدفع', 'Payment type'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
          ),
          if (cur == 'cash' || cur == 'tax')
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 18),
              child: Text('${tr('الحالي', 'Current')}: ${_paymentKindLabel(cur)}',
                  style: const TextStyle(fontSize: 12, color: T.inkSoft)),
            ),
          ..._paymentChoices.map((o) => ListTile(
                title: Text(tr(o.$2, o.$3)),
                trailing: o.$1 == cur ? const Icon(Icons.check_rounded, color: T.success) : null,
                onTap: () => Navigator.pop(c, o.$1),
              )),
        ]),
      ),
    );
    if (picked == null || picked == cur) return;
    try {
      final row = await Api.instance.put('/api/workflows/${w['_id']}', {'paymentType': picked});
      if (!mounted) return;
      setState(() {
        final i = _rows.indexWhere((r) => r['_id'] == w['_id']);
        if (i >= 0 && row is Map) _rows[i] = {..._rows[i], ...Map<String, dynamic>.from(row)};
      });
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(tr('حُفظ نوع الدفع', 'Payment type saved'))));
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e is ApiException ? e.message : e.toString())));
    }
  }

  /// حالةُ الطلب تُغيَّر من هنا وتُكتب في منصّة التشغيل — نفسُ عقد الويب:
  /// PATCH /api/workflows/:id/application-status. والخادمُ يكتب هناك أوّلًا
  /// ثمّ يعيد صفَّنا بما استقرّ في المنصّة، فلا تتغيّر الحالةُ ثمّ تعود.
  Future<void> _changeAppStatus(Map<String, dynamic> w) async {
    if ((w['externalSource'] ?? '') != 'ops_upl') {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(tr('كشفٌ ليس من منصّة التشغيل', 'Not a platform shipment'))));
      return;
    }
    final picked = await showModalBottomSheet<String>(
      context: context,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (c) => SafeArea(
        child: ListView(shrinkWrap: true, children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(18, 14, 18, 6),
            child: Align(alignment: AlignmentDirectional.centerStart, child: Text(tr('تغيير حالة الطلب', 'Change application status'), style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w800))),
          ),
          for (final e in _appStatuses.entries)
            ListTile(
              leading: Container(width: 12, height: 12, decoration: BoxDecoration(color: e.value.$3, shape: BoxShape.circle)),
              title: Text(tr(e.value.$1, e.value.$2), style: const TextStyle(fontSize: 14)),
              trailing: w['applicationStatus'] == e.key ? const Icon(Icons.check, color: T.navy) : null,
              onTap: () => Navigator.pop(c, e.key),
            ),
          const SizedBox(height: 6),
        ]),
      ),
    );
    if (picked == null || picked == w['applicationStatus']) return;
    try {
      final row = await Api.instance.patch('/api/workflows/${w['_id']}/application-status', {'status': picked});
      if (!mounted) return;
      setState(() {
        final i = _rows.indexWhere((r) => r['_id'] == w['_id']);
        if (i >= 0) _rows[i] = {..._rows[i], ...Map<String, dynamic>.from(row is Map ? row : {'applicationStatus': picked})};
      });
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    }
  }

  void _detail(Map<String, dynamic> w) {
    final fields = [
      (tr('رقم الكشف', 'Report #'), w['reportNumber']),
      (tr('تاريخ الكشف', 'Report date'), _d(w['reportDate'])),
      (tr('من', 'From'), w['fromLocation']),
      (tr('إلى', 'To'), w['toLocation']),
      (tr('الفرع', 'Branch'), w['branch']),
      (tr('مالك السيارة', 'Car owner'), w['carOwner']),
      (tr('رقم السيارة', 'Car #'), w['carNumber']),
      (tr('اللوحة', 'Plate'), w['plateNumber']),
      (tr('السائق', 'Driver'), w['driverName']),
      (tr('هاتف السائق', 'Driver phone'), w['driverPhone']),
      (tr('نوع الدفع', 'Payment type'), _paymentKindLabel(_paymentKindOf(w))),
      (tr('قيمة الشراء', 'Purchase value'), w['purchaseValue'] != null ? '${_money(w['purchaseValue'])} ر.س' : null),
      // قيمةُ البيع لا تصل مَن ليس في قائمتها أصلًا — الخادمُ يحجبها.
      (tr('قيمة البيع', 'Selling value'), w['sellingValue'] != null ? '${_money(w['sellingValue'])} ر.س' : null),
      (tr('رقم الفاتورة', 'Invoice #'), w['invoiceNumber']),
      (tr('تاريخ الدفع', 'Payment date'), w['paymentDate']),
      (tr('المرجع', 'Reference'), w['reference']),
      (tr('رقم السند', 'Document #'), w['documentNumber']),
    ].where((x) => (x.$2 ?? '').toString().isNotEmpty).toList();
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (c) => SafeArea(
        child: SizedBox(
          height: MediaQuery.of(c).size.height * 0.75,
          child: ListView(padding: const EdgeInsets.all(18), children: [
            Text('${tr('كشف', 'Sheet')} ${w['reportNumber'] ?? ''}', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16)),
            const SizedBox(height: 12),
            ...fields.map((f) => Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                SizedBox(width: 130, child: Text(f.$1, style: const TextStyle(fontSize: 12, color: T.inkSoft))),
                Expanded(child: Text(f.$2.toString(), style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600))),
              ]),
            )),
            // معاملةُ التخليص التي يخدمها الكشف — وربطُها يدويًّا (كالويب).
            WorkflowCustomsSection(
              workflow: w,
              canLink: _canLinkCustoms,
              onChanged: (wf) {
                Navigator.pop(c);
                if (!mounted) return;
                setState(() { final i = _rows.indexWhere((r) => r['_id'] == wf['_id']); if (i >= 0) _rows[i] = wf; });
                ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(tr('حُفظ الربط', 'Link saved'))));
              },
            ),
            // متابعاتُ الكشف — السجلُّ نفسُه الذي يكتبه التخليصُ والتحصيل (كالويب).
            Padding(
              padding: const EdgeInsets.only(bottom: 10),
              child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                Text(tr('متابعات الكشف', 'Report follow-ups'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13)),
                const SizedBox(height: 6),
                ReportFollowUpsView(workflowId: '${w['_id']}', basePath: '/api/workflows/${w['_id']}/follow-ups'),
              ]),
            ),
            if (_myFields.contains('paymentType'))
              Align(
                alignment: AlignmentDirectional.centerStart,
                child: OutlinedButton.icon(
                  onPressed: () { Navigator.pop(c); _editPaymentType(w); },
                  icon: const Icon(Icons.swap_horiz_rounded, size: 16),
                  label: Text(tr('تغيير نوع الدفع', 'Change payment type')),
                ),
              ),
            if (_myFields.contains('sellingValue'))
              Align(
                alignment: AlignmentDirectional.centerStart,
                child: OutlinedButton.icon(
                  onPressed: () { Navigator.pop(c); _editSelling(w); },
                  icon: const Icon(Icons.edit_outlined, size: 16),
                  label: Text(tr('تعديل قيمة البيع', 'Edit selling value')),
                ),
              ),
          ]),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return AppScaffold(
      title: Text(tr('التشغيل', 'Operations')),
      body: _loading
          ? ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(height: 60), SizedBox(height: 10), Shimmer(), SizedBox(height: 10), Shimmer()])
          : _error != null
              ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
              : Column(children: [
                  // ── البطاقات: صفٌّ أفقيّ كما في الويب ─────────────────────────
                  // «سندات لم تصل» (الإجماليُّ وحدَه — بطاقتا الكاش والضريبيّ أُزيلتا
                  // كالويب)، وبطاقاتُ فحص الفواتير الأربع لمن يملك أعمدةَ المال.
                  // والضغطةُ تصفّي أو تفتح القائمة.
                  if (_stats.isNotEmpty)
                    SizedBox(
                      height: 84,
                      child: ListView(
                        scrollDirection: Axis.horizontal,
                        padding: const EdgeInsets.fromLTRB(14, 12, 14, 0),
                        children: [
                          _statCard(tr('الإجمالي', 'Total'), '${_stats['total'] ?? 0}', T.inkFaint),
                          _statCard(tr('سندات لم تصل', 'Pending bonds'), '${_stats['pendingInvoices'] ?? 0}', T.warn,
                              sub: tr('بلا تاريخ سداد · عدا الملغاة', 'no payment date'),
                              active: _pendingOnly,
                              onTap: () { _pendingOnly = !_pendingOnly; _reload(); }),
                          _statCard(tr('سند لم يصل وحالته «استُلم»', 'Pending, status received'), '${_stats['pendingBondReceived'] ?? 0}', T.danger),
                          if (_stats['sumPurchaseValue'] != null)
                            // المجموعُ، وتحته: سيّاراتُ تنشيط · سيّاراتٌ خارجيّة (٢٠٢٦/١٠/٢٢).
                            _statCard(tr('قيمة الشراء', 'Purchase'), _money(_stats['sumPurchaseValue']), T.violet,
                                sub: _stats['purchaseSplit'] is Map
                                    ? '${tr('تنشيط', 'Tanshit')} ${_money((_stats['purchaseSplit'] as Map)['own'])} · ${tr('خارجية', 'External')} ${_money((_stats['purchaseSplit'] as Map)['external'])}'
                                    : null),
                          if (_checks != null)
                            for (final k in _checkKinds)
                              _statCard(tr(k.$2, k.$3), '${(_checks![_checkKey(k.$1)] as Map?)?['count'] ?? 0}', k.$4,
                                  sub: k.$1 == 'gaps' && (_checks!['gaps'] as Map?)?['start'] != null
                                      ? '${(_checks!['gaps'] as Map)['start']} → ${(_checks!['gaps'] as Map)['end']}'
                                      : null,
                                  onTap: () => _openCheck(k.$1, tr(k.$2, k.$3))),
                        ],
                      ),
                    ),
                  Padding(
                    padding: const EdgeInsets.fromLTRB(14, 10, 14, 0),
                    child: TextField(
                      onSubmitted: (v) { _q = v; _reload(); },
                      onChanged: (v) => _q = v,
                      textInputAction: TextInputAction.search,
                      decoration: InputDecoration(hintText: tr('ابحث بالكشف أو المالك ثم إدخال…', 'Search then enter…'), prefixIcon: const Icon(Icons.search)),
                    ),
                  ),
                  Padding(
                    padding: const EdgeInsets.fromLTRB(14, 8, 14, 4),
                    child: SingleChildScrollView(
                      scrollDirection: Axis.horizontal,
                      // ── شريطُ الفلترة مكانَ شرائح الحالات ───────────────────
                      // نفسُ أعمدة الويب: العميل، الفرع، من/إلى، نوع الدفع، الحالة…
                      // وكلُّ قيمةٍ بعددها (بكلّ الفلاتر عدا فلترها).
                      child: Row(
                        children: [
                          for (final f in _barFields)
                            if (!f.$4 || _checks != null)
                              Padding(
                                padding: const EdgeInsetsDirectional.only(end: 6),
                                child: FilterChip(
                                  selected: (_cf[f.$1] ?? const {}).isNotEmpty,
                                  onSelected: (_) => _pickFilter(f.$1, tr(f.$2, f.$3)),
                                  label: Text((_cf[f.$1] ?? const {}).isEmpty
                                      ? tr(f.$2, f.$3)
                                      : (_cf[f.$1]!.length == 1
                                          ? '${tr(f.$2, f.$3)}: ${_valueLabel(f.$1, _cf[f.$1]!.first)}'
                                          : '${tr(f.$2, f.$3)} (${_cf[f.$1]!.length})')),
                                  labelStyle: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: T.ink),
                                  selectedColor: const Color(0xFFF1F5F9),
                                  backgroundColor: Colors.white,
                                  checkmarkColor: T.ink,
                                  side: BorderSide(color: (_cf[f.$1] ?? const {}).isNotEmpty ? T.ink : T.line),
                                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
                                ),
                              ),
                          // التخليص بكلمة: المرتبطة / غيرُ المرتبطة.
                          for (final m in [('linked', 'مرتبطة بالتخليص', 'Customs linked'), ('unlinked', 'غير مرتبطة', 'Not linked')])
                            Padding(
                              padding: const EdgeInsetsDirectional.only(end: 6),
                              child: ChoiceChip(
                                selected: _customs == m.$1,
                                onSelected: (on) { _customs = on ? m.$1 : ''; _reload(); },
                                avatar: m.$1 == 'linked' ? const Icon(Icons.directions_boat_outlined, size: 14) : null,
                                label: Text(tr(m.$2, m.$3)),
                                labelStyle: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: T.ink),
                                selectedColor: const Color(0xFFF1F5F9),
                                backgroundColor: Colors.white,
                                side: BorderSide(color: _customs == m.$1 ? T.ink : T.line),
                                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
                              ),
                            ),
                          if (_cf.isNotEmpty)
                            TextButton(onPressed: () { _cf.clear(); _reload(); }, child: Text(tr('مسح الكل', 'Clear all'))),
                        ],
                      ),
                    ),
                  ),
                  Expanded(
                    child: RefreshIndicator(
                      onRefresh: _load,
                      child: _rows.isEmpty
                          ? ListView(children: [const SizedBox(height: 80), EmptyState(icon: Icons.workspaces_outline, title: tr('لا توجد كشوف', 'No sheets'))])
                          : ListView.separated(
                              padding: const EdgeInsets.all(14),
                              itemCount: _rows.length,
                              separatorBuilder: (_, __) => const SizedBox(height: 8),
                              itemBuilder: (c, i) {
                                final w = _rows[i];
                                // ── و«المرحلة» لم تبقَ تقول شيئًا ──────────────
                                // سبعةٌ وثلاثون ألفًا وواحدٌ وأربعون كشفًا في
                                // «مسودة» وواحدٌ في غيرها: المراحلُ صُمّمت حين
                                // كانت الكشوفُ تُنشأ عندنا وتتنقّل بين أقسامنا،
                                // وهي تصل الآن من المنصّة وقد جرت هناك. فسقطت
                                // الشارةُ وزرُّ «نقل المرحلة» معها، كما سقط
                                // عمودُها في الويب. والحالةُ الحقيقيّةُ هي
                                // «حالة الطلب» — وهي تُضغَط فتُغيَّر.
                                final appSt = _appStatuses[w['applicationStatus']] ?? ('—', '—', T.inkFaint);
                                return FadeSlideIn(
                                  delayMs: (i * 12).clamp(0, 120),
                                  child: Pressable(
                                    onTap: () => _detail(w),
                                    child: AppCard(
                                      topAccent: appSt.$3,
                                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                        Row(children: [
                                          Expanded(child: Text((w['reportNumber'] ?? '—').toString(), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13.5))),
                                          // ومسؤولُ البيانات يُقرأ في الصفّ: من
                                          // كتب تاريخَ السداد، أو من سجّل الشراء
                                          // في المحفظة، أو «منقول من المنصّة».
                                          if ((w['dataOwnerShown'] ?? '').toString().isNotEmpty)
                                            Text(
                                              w['dataOwnerShown'].toString(),
                                              style: TextStyle(
                                                fontSize: 10.5,
                                                fontWeight: FontWeight.w600,
                                                color: w['dataOwnerFrom'] == 'import' ? T.inkFaint : T.violet,
                                              ),
                                            ),
                                        ]),
                                        const SizedBox(height: 4),
                                        Text('${w['fromLocation'] ?? '—'} ← ${w['toLocation'] ?? '—'}${(w['carOwner'] ?? '').toString().isNotEmpty ? ' · ${w['carOwner']}' : ''}',
                                            style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600)),
                                        const SizedBox(height: 6),
                                        Wrap(spacing: 0, runSpacing: 4, crossAxisAlignment: WrapCrossAlignment.center, children: [
                                          if ((w['plateNumber'] ?? '').toString().isNotEmpty) Chip2(w['plateNumber'], T.navy, icon: Icons.local_shipping_outlined),
                                          // حالةُ الطلب تُضغط فتُغيَّر — في المنصّة وعندنا معًا.
                                          if ((w['applicationStatus'] ?? '').toString().isNotEmpty) ...[
                                            const SizedBox(width: 6),
                                            Pressable(
                                              onTap: () => _changeAppStatus(w),
                                              child: Chip2(
                                                tr(appSt.$1, appSt.$2),
                                                appSt.$3,
                                                icon: Icons.unfold_more,
                                              ),
                                            ),
                                          ],
                                          // معاملةُ التخليص المرتبطة — تُضغط فتفتح نافذتَها.
                                          if (customsIdOf(w['customsLink']).isNotEmpty) ...[
                                            const SizedBox(width: 6),
                                            CustomsLinkChip(w['customsLink'], compact: true),
                                          ],
                                        ]),
                                      ]),
                                    ),
                                  ),
                                );
                              },
                            ),
                    ),
                  ),
                  if (_pages > 1)
                    SafeArea(
                      top: false,
                      child: Row(mainAxisAlignment: MainAxisAlignment.center, children: [
                        IconButton(onPressed: _page > 1 ? () { setState(() { _page--; _loading = true; }); _load(); } : null, icon: const Icon(Icons.chevron_right)),
                        Text('$_page / $_pages', style: const TextStyle(fontWeight: FontWeight.w800)),
                        IconButton(onPressed: _page < _pages ? () { setState(() { _page++; _loading = true; }); _load(); } : null, icon: const Icon(Icons.chevron_left)),
                      ]),
                    ),
                ]),
    );
  }

  /// مفتاحُ الفحص في ملخّص الخادم (`missing-reports` ← `missingReports`).
  String _checkKey(String kind) => {
        'gaps': 'gaps', 'missing-reports': 'missingReports', 'value-diffs': 'valueDiffs', 'name-mismatches': 'nameMismatches',
      }[kind]!;

  // ── بطاقةٌ هادئة: بيضاءُ بحدٍّ رماديّ، رقمٌ بالحبر، والنبرةُ نقطةٌ صغيرة ──
  // (الأحمرُ للإنذار الحقيقيّ وحدَه، والمفعَّلةُ يحدُّها الحبرُ لا لونٌ صارخ.)
  Widget _statCard(String label, String value, Color color, {String? sub, bool active = false, VoidCallback? onTap}) => Padding(
        padding: const EdgeInsetsDirectional.only(end: 8),
        child: SizedBox(
          width: 150,
          child: Pressable(
            onTap: onTap ?? () {},
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
              decoration: BoxDecoration(
                color: active ? const Color(0xFFF8FAFC) : T.card,
                borderRadius: BorderRadius.circular(16),
                border: Border.all(color: active ? T.ink : T.line, width: active ? 1.2 : 1),
              ),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Row(children: [
                  Container(width: 6, height: 6, decoration: BoxDecoration(color: color, shape: BoxShape.circle)),
                  const SizedBox(width: 5),
                  Expanded(child: Text(label, style: const TextStyle(fontSize: 10.5, color: T.inkSoft, fontWeight: FontWeight.w600), maxLines: 1, overflow: TextOverflow.ellipsis)),
                ]),
                const SizedBox(height: 2),
                Text(value, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w800, color: T.ink)),
                if (sub != null) Text(sub, style: const TextStyle(fontSize: 9.5, color: T.inkFaint), maxLines: 1, overflow: TextOverflow.ellipsis),
              ]),
            ),
          ),
        ),
      );
}
