import 'dart:async';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../services/api.dart';
import '../services/auth.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/customs_link.dart';
import '../ui/export_sheet.dart';
import '../ui/lookup_field.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';
import '../ui/search_field.dart';
import 'ops_common.dart';
import 'ops_workflow_detail.dart';
import 'ops_workflow_new.dart';

/// التشغيل — سيرُ عمل الكشوف (نظيرُ /system/operations): البطاقات، شريطُ
/// الفلترة وفلاترُ الأعمدة، الفترة (يوم / شهر / مدى)، التحديدُ والإجراءاتُ
/// الجماعيّة (تسجيلُ السداد والحذف و«كلُّ نتائج الفلتر»)، التصديرُ بنطاقاته،
/// الطلبُ الجديد والاستيراد، وأقفالُ الصفوف حيّةً.
class OpsWorkflowsScreen extends StatefulWidget {
  const OpsWorkflowsScreen({super.key});
  @override
  State<OpsWorkflowsScreen> createState() => _OpsWorkflowsScreenState();
}

/// أهلُ المال يملكون في هذه الصفحة ما يملكه مديرُ النظام (lib/financeAuthority).
const _financeFullRoles = ['cfo', 'accounting_manager', 'accountant'];

/// أعمدةُ شريط الفلترة — نفسُ أعمدة الويب (WorkflowFilterBar).
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
  ('invoiceState', 'رقم الفاتورة', 'Invoice number', false),
  ('customsRef', 'التخليص', 'Customs', false),
];

/// بقيّةُ أعمدة الجدول — لكلٍّ فلترُه على رأسه في الويب (ColHead).
/// (المفتاح، العربيّ، الإنجليزيّ، مالٌ؟)
const _colFields = [
  ('reportNumber', 'رقم الكشف', 'Report #', false),
  ('reportDate', 'تاريخ الكشف', 'Report date', false),
  ('userPhone', 'هاتف العميل', 'Customer phone', false),
  ('purchaseValue', 'قيمة الشراء', 'Purchase value', false),
  ('sellingValue', 'قيمة البيع', 'Selling value', false),
  ('truckSize', 'حجم الشاحنة', 'Truck size', false),
  ('representativeName', 'المندوب', 'Representative', false),
  ('operationsReview', 'مراجعة التشغيل', 'Ops review', false),
  ('paymentDate', 'تاريخ السداد', 'Payment date', false),
  ('dataOwnerShown', 'مسؤول البيانات', 'Data owner', false),
  ('paymentAmount', 'مبلغ السداد', 'Payment amount', false),
  ('finalReportDestination', 'وجهة الكشف النهائية', 'Final destination', false),
  ('documentNumber', 'رقم السند', 'Voucher no.', false),
  ('sendingDate', 'تاريخ الإرسال', 'Sending date', false),
  ('branchDeliveryDate', 'تاريخ التسليم للفرع', 'Delivered to branch', false),
  ('accountingReview', 'مراجعة المحاسبة', 'Accounting review', false),
  ('invoiceNumber', 'رقم الفاتورة', 'Invoice #', false),
  ('netInvoice', 'صافي الفاتورة', 'Net invoice', true),
  ('tax', 'الضريبة', 'Tax', true),
  ('totalInvoice', 'إجمالي الفاتورة', 'Total invoice', true),
  ('invoiceDate', 'تاريخ الفاتورة', 'Invoice date', true),
  ('deliveryDate', 'تاريخ التسليم للعميل', 'Delivered to customer', false),
  ('collectedAmount', 'المبلغ المحصّل', 'Collected', true),
  ('collectionDate', 'تاريخ التحصيل', 'Collection date', true),
];

const _dateFields = {'reportDate', 'paymentDate', 'sendingDate', 'branchDeliveryDate', 'deliveryDate', 'invoiceDate', 'collectionDate'};
const _numFields = {'purchaseValue', 'sellingValue', 'netInvoice', 'tax', 'totalInvoice', 'paymentAmount', 'collectedAmount'};

/// أعمدةُ تصدير الصفحة — مكتوبةٌ لا مشتقّة، وأعمدةُ المال تُحذف لمن لا يملكها.
const _moneyExportKeys = {'netInvoice', 'tax', 'totalInvoice', 'invoiceDate', 'invoiceNotes', 'collectionDate'};
const _exportCols = [
  ('reportNumber', 'رقم الطلب', 'Report #'), ('reportDate', 'تاريخ الطلب', 'Report date'), ('fromLocation', 'من', 'From'),
  ('toLocation', 'إلى', 'To'), ('branch', 'الفرع', 'Branch'), ('carOwner', 'مالك السيارة', 'Car owner'),
  ('carNumber', 'رقم السيارة', 'Car #'), ('applicationStatus', 'حالة الطلب', 'Status'), ('username', 'العميل', 'Customer'),
  ('userPhone', 'هاتف العميل', 'Customer phone'), ('purchaseValue', 'قيمة الشراء', 'Purchase value'), ('sellingValue', 'قيمة البيع', 'Selling value'),
  ('driverName', 'السائق', 'Driver'), ('truckType', 'نوع الشاحنة', 'Truck type'), ('truckSize', 'حجم الشاحنة', 'Truck size'),
  ('representativeName', 'المندوب', 'Representative'), ('operationsReview', 'مراجعة العمليات', 'Ops review'), ('paymentDate', 'تاريخ السداد', 'Payment date'),
  ('dataOwnerShown', 'مسؤول البيانات', 'Data owner'), ('payingBranch', 'فرع السداد', 'Paying branch'), ('paymentType', 'نوع الدفع', 'Payment type'),
  ('finalReportDestination', 'وجهة الكشف النهائية', 'Final destination'), ('documentNumber', 'رقم المستند', 'Document #'), ('customsRef', 'معاملة التخليص', 'Customs ref'),
  ('customsBl', 'البوليصة', 'B/L'), ('sendingDate', 'تاريخ الإرسال', 'Sending date'), ('branchDeliveryDate', 'تاريخ التسليم للفرع', 'Delivered to branch'),
  ('deliveryDate', 'تاريخ التسليم للعميل', 'Delivered to customer'), ('accountingReview', 'مراجعة المحاسبة', 'Accounting review'), ('invoiceNumber', 'رقم الفاتورة', 'Invoice #'),
  ('netInvoice', 'صافي الفاتورة', 'Net invoice'), ('tax', 'الضريبة', 'Tax'), ('totalInvoice', 'إجمالي الفاتورة', 'Total invoice'),
  ('invoiceDate', 'تاريخ الفاتورة', 'Invoice date'), ('collectionDate', 'تاريخ التحصيل', 'Collection date'),
];

/// بطاقاتُ فحص الفواتير الأربع — نفسُ بطاقات الويب (InvoiceCheckCards).
const _checkKinds = [
  ('gaps', 'فواتير لم تُفوتَر', 'Missing invoice numbers', T.violet),
  ('missing-reports', 'فواتير بكشوفات غير موجودة', 'Invoices citing missing reports', T.warn),
  ('value-diffs', 'فرق قيمة الفاتورة', 'Invoice value differences', T.danger),
  ('name-mismatches', 'عدم تطابق اسم العميل', 'Customer name mismatch', T.info),
];

class _OpsWorkflowsScreenState extends State<OpsWorkflowsScreen> {
  List<Map<String, dynamic>> _rows = [];
  Map<String, dynamic> _stats = {};
  bool _loading = true;
  bool _refreshing = false;
  String? _error;
  String _q = '';
  final _qCtrl = TextEditingController();
  Timer? _debounce;
  final Map<String, Set<String>> _cf = {};
  bool _pendingOnly = false;
  bool _excludeCancelled = false;
  String _customs = '';
  final OpsPeriod _period = OpsPeriod();
  /// حقولُ هذا الدور كما يحسبها الخادم — `null` حتى يصل الجواب.
  Set<String>? _myFields;
  Map<String, dynamic>? _checks;
  int _page = 1;
  int _pages = 1;
  int _total = 0;
  int _pageSize = 50;
  final Set<String> _sel = {};
  bool _allMatching = false;
  bool _busy = false;
  final Set<String> _statusSaving = {};
  Timer? _liveTimer;

  late final void Function() _onLive;
  late final void Function(dynamic) _onUpdated;
  late final void Function(dynamic) _onDeleted;
  late final void Function(dynamic) _onLocked;
  late final void Function(dynamic) _onUnlocked;
  late final void Function(dynamic) _onUnlockAll;

  String get _role => context.read<AuthProvider>().role;
  bool get _full => const ['super_admin', 'admin'].contains(_role) || _financeFullRoles.contains(_role);
  bool _has(String f) => _myFields?.contains(f) ?? false;
  bool get _canCreate => _full || _role == 'moderator';
  bool get _canDelete => _full;
  // Invoice amounts (net invoice onward): the server decides who sees them.
  bool _seesAmounts = false;
  bool _seesSelling = false;
  bool get _canViewFinancials => _full || _seesAmounts;
  bool get _canEditOpsReview => _full || _has('operationsReview');
  bool get _canEditAccReview => _full || _has('accountingReview');
  bool get _canSeeSelling => _has('sellingValue') || _seesSelling;
  bool _owns(String f) => _myFields == null || _full || _myFields!.contains(f);

  @override
  void initState() {
    super.initState();
    _load();
    // دفعةُ إشعاراتٍ = تحميلٌ واحد (الاستطلاعُ يبثّ كلَّ بضع ثوانٍ).
    _onLive = () {
      _liveTimer?.cancel();
      _liveTimer = Timer(const Duration(milliseconds: 600), () { if (mounted) _load(background: true); });
    };
    _onUpdated = (d) {
      // صفٌّ كاملٌ يُستبدَل في مكانه؛ والإشعارُ المختصرُ يعيد التحميل.
      if (d is Map && d['_id'] != null && d.containsKey('reportNumber')) {
        final i = _rows.indexWhere((r) => r['_id'] == d['_id']);
        if (i >= 0 && mounted) { setState(() => _rows[i] = Map<String, dynamic>.from(d)); return; }
      }
      _onLive();
    };
    _onDeleted = (d) {
      if (d is! Map || !mounted) return;
      setState(() {
        _rows.removeWhere((r) => r['_id'] == d['_id']);
        _sel.remove(d['_id']);
        _total = _total > 0 ? _total - 1 : 0;
      });
    };
    _onLocked = (d) {
      if (d is! Map || !mounted) return;
      final i = _rows.indexWhere((r) => r['_id'] == d['_id']);
      if (i >= 0) setState(() => _rows[i] = {..._rows[i], 'lockedBy': d['lockedBy'], 'lockedByName': d['lockedByName'], 'lockedAt': d['lockedAt']});
    };
    _onUnlocked = (d) {
      if (d is! Map || !mounted) return;
      final i = _rows.indexWhere((r) => r['_id'] == d['_id']);
      if (i >= 0) setState(() => _rows[i] = {..._rows[i], 'lockedBy': null, 'lockedByName': '', 'lockedAt': null});
    };
    _onUnlockAll = (d) {
      if (d is! Map || !mounted) return;
      setState(() {
        for (var i = 0; i < _rows.length; i++) {
          final lb = _rows[i]['lockedBy'];
          if (lb is Map && '${lb['_id']}' == '${d['userId']}') _rows[i] = {..._rows[i], 'lockedBy': null, 'lockedByName': '', 'lockedAt': null};
        }
      });
    };
    Live.instance.on('workflow:created', _onLive);
    Live.instance.onData('workflow:updated', _onUpdated);
    Live.instance.onData('workflow:stageChanged', _onUpdated);
    Live.instance.onData('workflow:deleted', _onDeleted);
    Live.instance.on('workflow:bulkImported', _onLive);
    Live.instance.onData('workflow:locked', _onLocked);
    Live.instance.onData('workflow:unlocked', _onUnlocked);
    Live.instance.onData('workflow:unlockAll', _onUnlockAll);
    Api.instance.get('/api/workflows/permissions').then((d) {
      if (!mounted) return;
      final list = (d is Map ? (d['myFields'] ?? (d['roleAccess'] is Map ? d['roleAccess'][_role] : null)) : null) as List?;
      final view = d is Map && d['view'] is Map ? d['view'] as Map : const {};
      setState(() {
        _myFields = Set<String>.from((list ?? const []).map((e) => '$e'));
        _seesAmounts = view['amounts'] == true;
        _seesSelling = view['selling'] == true;
      });
    }).catchError((_) { if (mounted) setState(() => _myFields = <String>{}); });
  }

  @override
  void dispose() {
    Live.instance.off('workflow:created', _onLive);
    Live.instance.offData('workflow:updated', _onUpdated);
    Live.instance.offData('workflow:stageChanged', _onUpdated);
    Live.instance.offData('workflow:deleted', _onDeleted);
    Live.instance.off('workflow:bulkImported', _onLive);
    Live.instance.offData('workflow:locked', _onLocked);
    Live.instance.offData('workflow:unlocked', _onUnlocked);
    Live.instance.offData('workflow:unlockAll', _onUnlockAll);
    _liveTimer?.cancel();
    _debounce?.cancel();
    _qCtrl.dispose();
    super.dispose();
  }

  /// شروطُ القائمة كلُّها كما يرسلها الويب (buildParams).
  List<(String, String)> _params({String? skip}) {
    final (from, to) = _period.dates;
    return [
      if (_q.trim().isNotEmpty) ('search', _q.trim()),
      if (from != null) ('dateFrom', from),
      if (to != null) ('dateTo', to),
      if (_pendingOnly) ('pendingOnly', 'true'),
      if (_customs.isNotEmpty) ('customs', _customs),
      if (_excludeCancelled) ('excludeCancelled', '1'),
      for (final e in _cf.entries)
        if (e.key != skip)
          for (final v in e.value) ('cf_${e.key}', v),
    ];
  }

  int _seq = 0;
  int _statsSeq = 0;
  Future<void> _load({bool background = false}) async {
    // الأحدثُ يفوز — للجدول وللبطاقات حارسان مستقلّان.
    final mine = ++_seq;
    final mineStats = ++_statsSeq;
    if (!background && !_loading && mounted) setState(() => _refreshing = true);
    final p = _params();
    final statsF = Api.instance.get('/api/workflows/stats?${opsQs(p)}').then((d) {
      if (!mounted || mineStats != _statsSeq) return;
      setState(() => _stats = Map<String, dynamic>.from(d));
    }).catchError((_) {});
    Api.instance.get('/api/workflows/invoice-checks').then((d) {
      if (!mounted) return;
      final c = Map<String, dynamic>.from(d is Map ? d : const {});
      setState(() => _checks = c.containsKey('gaps') ? c : null);
    }).catchError((_) {});
    try {
      final d = await Api.instance.get('/api/workflows?${opsQs([...p, ('page', '$_page'), ('limit', '$_pageSize')])}');
      if (!mounted || mine != _seq) return;
      setState(() {
        _rows = List<Map<String, dynamic>>.from(d['workflows'] ?? []);
        _total = ((d['total'] ?? 0) as num).toInt();
        _pages = ((d['pages'] ?? ((_total + _pageSize - 1) ~/ _pageSize)) as num).toInt().clamp(1, 1 << 30);
        _loading = false;
        _error = null;
      });
    } catch (e) {
      if (mounted && mine == _seq) setState(() { _loading = false; _error = opsErr(e); });
    } finally {
      if (mounted && !background) setState(() => _refreshing = false);
    }
    await statsF;
  }

  /// تغيُّرُ أيّ فلتر: الصفحةُ الأولى، ويُلغى التحديد (صفوفٌ لم تعد معروضة).
  void _reload() {
    setState(() { _page = 1; _sel.clear(); _allMatching = false; });
    _load();
  }

  String _valueLabel(String field, String v) {
    if (field == 'customsRef' && v.isEmpty) return tr('غير مرتبط', 'Not linked');
    if (v.isEmpty) return tr('(فارغ)', '(blank)');
    if (field == 'applicationStatus' || field == 'executionStatus') return opsStatusLabel(v);
    if (field == 'paymentMethod') return opsPayMethodLabel(v);
    if (field == 'paymentType') { final l = opsPaymentKindLabel(v); return l.isEmpty ? v : l; }
    if (field == 'invoiceState') {
      return {'has': tr('عليه رقم فاتورة', 'Has a number'), 'none': tr('فارغ', 'Blank'), 'placeholder': tr('بديل (no inv / بدون)', 'Placeholder (no inv)')}[v] ?? v;
    }
    if (_dateFields.contains(field)) {
      final m = RegExp(r'^(\d{4})-(\d{2})-(\d{2})$').firstMatch(v);
      return m != null ? '${m[3]}/${m[2]}/${m[1]}' : opsDate(v);
    }
    if (_numFields.contains(field)) return opsMoney(num.tryParse(v));
    return v;
  }

  Future<void> _pickFilter(String field, String label) async {
    final picked = await opsPickColumnFilter(context,
        field: field, label: label, params: _params(skip: field), current: _cf[field] ?? const {}, labelOf: _valueLabel);
    if (picked == null) return;
    setState(() { if (picked.isEmpty) { _cf.remove(field); } else { _cf[field] = picked; } });
    _reload();
  }

  Future<void> _pickColumn() async {
    final fields = [for (final f in _colFields) if (!f.$4 || _canViewFinancials) if (f.$1 != 'sellingValue' || _canSeeSelling) (f.$1, f.$2, f.$3)];
    final k = await opsPickFilterField(context, fields, _cf);
    if (k == null || !mounted) return;
    final f = fields.firstWhere((x) => x.$1 == k);
    _pickFilter(k, tr(f.$2, f.$3));
  }

  /// بطاقاتُ الحالة قائمةُ اختيار: ضغطةٌ تُدخل وأخرى تُخرج، و'' تمسح.
  void _toggleStatus(String key) {
    if (key.isEmpty) { _cf.remove('applicationStatus'); return; }
    final cur = Set<String>.from(_cf['applicationStatus'] ?? const {});
    if (!cur.remove(key)) cur.add(key);
    if (cur.isEmpty) { _cf.remove('applicationStatus'); } else { _cf['applicationStatus'] = cur; }
  }

  bool _lockedByOther(Map<String, dynamic> w) {
    final lb = w['lockedBy'];
    if (lb == null) return false;
    final at = DateTime.tryParse('${w['lockedAt'] ?? ''}');
    if (at != null && DateTime.now().difference(at).inMinutes > 5) return false;
    final me = (context.read<AuthProvider>().user?['_id'] ?? '').toString();
    return (lb is Map ? '${lb['_id']}' : '$lb') != me;
  }

  void _patchRow(String id, dynamic row, [Map<String, dynamic>? fallback]) {
    final i = _rows.indexWhere((r) => r['_id'] == id);
    if (i < 0) return;
    setState(() => _rows[i] = {..._rows[i], ...(row is Map && row['_id'] != null ? Map<String, dynamic>.from(row) : (fallback ?? const {}))});
  }

  // ── إجراءاتُ الصفّ الواحد ───────────────────────────────────────────────
  Future<void> _openDetail(Map<String, dynamic> w, {bool edit = false}) async {
    await Navigator.push(context, MaterialPageRoute(builder: (_) => OpsWorkflowDetailScreen(id: '${w['_id']}', initial: w, startInEdit: edit)));
    if (mounted) _load(background: true);
  }

  Future<void> _deleteOne(Map<String, dynamic> w) async {
    if (!await opsConfirm(context, tr('هل أنت متأكد من حذف هذا الطلب؟', 'Are you sure you want to delete this request?'), danger: true)) return;
    try { await Api.instance.delete('/api/workflows/${w['_id']}'); }
    catch (e) { if (mounted) opsSnack(context, opsErr(e), error: true); }
  }

  /// قيمةُ البيع — في منصّة التشغيل وهنا معًا (PUT /api/workflows/:id).
  Future<void> _editSelling(Map<String, dynamic> w) async {
    final ctrl = TextEditingController(text: (w['sellingValue'] ?? '').toString());
    final v = await showDialog<String>(
      context: context,
      builder: (c) => AlertDialog(
        title: Text(tr('قيمة البيع', 'Selling value')),
        content: TextField(
          controller: ctrl, autofocus: true,
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
    if (n == null || n < 0) { if (mounted) opsSnack(context, tr('أدخل رقمًا صحيحًا', 'Enter a valid number'), error: true); return; }
    await _put(w, {'sellingValue': n}, okMsg: null);
  }

  Future<void> _put(Map<String, dynamic> w, Map<String, dynamic> patch, {String? okMsg}) async {
    try {
      final row = await Api.instance.put('/api/workflows/${w['_id']}', patch);
      if (!mounted) return;
      _patchRow('${w['_id']}', row, patch);
      if (row is Map && row['refusedMessage'] != null) {
        opsSnack(context, '${row['refusedMessage']}', error: true);
      } else if (row is Map && row['sellingPlatform'] is bool) {
        opsSnack(context, row['sellingPlatform'] == true
            ? tr('حُفظت قيمة البيع هنا وفي منصّة التشغيل', 'Selling value saved here and on the platform')
            : tr('حُفظت قيمة البيع — الكشف ليس من منصّة التشغيل', 'Selling value saved — not a platform shipment'));
      } else if (okMsg != null) {
        opsSnack(context, okMsg);
      }
      _loadStatsOnly();
    } catch (e) {
      if (mounted) opsSnack(context, opsErr(e), error: true);
      _load(background: true);
    }
  }

  void _loadStatsOnly() {
    final mine = ++_statsSeq;
    Api.instance.get('/api/workflows/stats?${opsQs(_params())}').then((d) {
      if (mounted && mine == _statsSeq) setState(() => _stats = Map<String, dynamic>.from(d));
    }).catchError((_) {});
  }

  /// نوعُ الدفع — الأربعةُ وحدَها تُختار، والخادمُ يطبّق قواعدها.
  Future<void> _editPaymentType(Map<String, dynamic> w) async {
    final cur = opsPaymentKindOf(w);
    final picked = await showModalBottomSheet<String>(
      context: context,
      builder: (c) => SafeArea(
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(18, 16, 18, 4),
            child: Text(tr('نوع الدفع', 'Payment type'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
          ),
          if (cur == 'cash' || cur == 'tax')
            Text('${tr('الحالي', 'Current')}: ${opsPaymentKindLabel(cur)}', style: const TextStyle(fontSize: 12, color: T.inkSoft)),
          for (final o in opsPaymentChoices)
            ListTile(
              title: Text(tr(o.$2, o.$3)),
              trailing: o.$1 == cur ? const Icon(Icons.check_rounded, color: T.success) : null,
              onTap: () => Navigator.pop(c, o.$1),
            ),
        ]),
      ),
    );
    if (picked == null || picked == cur) return;
    await _put(w, {'paymentType': picked}, okMsg: tr('حُفظ نوع الدفع', 'Payment type saved'));
  }

  Future<void> _toggleReview(Map<String, dynamic> w, String field) async {
    final next = (w[field] ?? '').toString().isNotEmpty ? '' : 'تم';
    _patchRow('${w['_id']}', null, {field: next}); // تفاؤلٌ: العلامةُ فوريّة
    try {
      await Api.instance.put('/api/workflows/${w['_id']}', {field: next});
    } catch (e) {
      if (mounted) opsSnack(context, opsErr(e), error: true);
      _load(background: true);
    }
  }

  /// حالةُ الطلب — تُكتب في منصّة التشغيل أوّلًا ثمّ تعود (لا تفاؤل هنا).
  Future<void> _changeAppStatus(Map<String, dynamic> w) async {
    if ((w['externalSource'] ?? '') != 'ops_upl') {
      opsSnack(context, tr('كشفٌ ليس من منصّة التشغيل', 'Not a platform shipment'));
      return;
    }
    if (!_owns('applicationStatus')) { opsSnack(context, tr('صلاحيّتك لا تسمح بتعديل هذا العمود', 'Your role cannot edit this column')); return; }
    if (_lockedByOther(w)) return;
    final picked = await showModalBottomSheet<String>(
      context: context,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (c) => SafeArea(
        child: ListView(shrinkWrap: true, children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(18, 14, 18, 6),
            child: Text(tr('تغيير حالة الطلب', 'Change application status'), style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w800)),
          ),
          for (final e in opsAppStatuses.entries)
            ListTile(
              leading: Container(width: 12, height: 12, decoration: BoxDecoration(color: e.value.$3, shape: BoxShape.circle)),
              title: Text(tr(e.value.$1, e.value.$2), style: const TextStyle(fontSize: 14)),
              trailing: w['applicationStatus'] == e.key ? const Icon(Icons.check, color: T.navy) : null,
              onTap: () => Navigator.pop(c, e.key),
            ),
        ]),
      ),
    );
    if (picked == null || picked == w['applicationStatus']) return;
    setState(() => _statusSaving.add('${w['_id']}'));
    try {
      final row = await Api.instance.patch('/api/workflows/${w['_id']}/application-status', {'status': picked});
      if (mounted) _patchRow('${w['_id']}', row, {'applicationStatus': picked});
    } catch (e) {
      if (mounted) opsSnack(context, opsErr(e), error: true);
      _load(background: true);
    } finally {
      if (mounted) setState(() => _statusSaving.remove('${w['_id']}'));
    }
  }

  Future<void> _rowMenu(Map<String, dynamic> w) async {
    final locked = _lockedByOther(w);
    final actions = <(IconData, String, Color, Future<void> Function())>[
      (Icons.open_in_new, tr('فتح الكشف', 'Open report'), T.navy, () => _openDetail(w)),
      if (!locked) (Icons.edit_outlined, tr('تعديل', 'Edit'), T.navy, () => _openDetail(w, edit: true)),
      if (!locked && _owns('paymentType')) (Icons.swap_horiz_rounded, tr('تغيير نوع الدفع', 'Change payment type'), T.violet, () => _editPaymentType(w)),
      if (!locked && _canSeeSelling) (Icons.sell_outlined, tr('تعديل قيمة البيع', 'Edit selling value'), T.success, () => _editSelling(w)),
      if (!locked && (w['externalSource'] ?? '') == 'ops_upl' && _owns('applicationStatus'))
        (Icons.flag_outlined, tr('تغيير حالة الطلب', 'Change status'), T.info, () => _changeAppStatus(w)),
      if (!locked && _canEditOpsReview)
        (Icons.fact_check_outlined, (w['operationsReview'] ?? '').toString().isNotEmpty ? tr('إزالة مراجعة التشغيل', 'Clear ops review') : tr('تمّت مراجعة التشغيل', 'Mark ops reviewed'), T.warn, () => _toggleReview(w, 'operationsReview')),
      if (!locked && _canViewFinancials && _canEditAccReview)
        (Icons.rule_outlined, (w['accountingReview'] ?? '').toString().isNotEmpty ? tr('إزالة مراجعة المحاسبة', 'Clear accounting review') : tr('تمّت مراجعة المحاسبة', 'Mark accounting reviewed'), T.violet, () => _toggleReview(w, 'accountingReview')),
      if (_canDelete) (Icons.delete_outline, tr('حذف', 'Delete'), T.danger, () => _deleteOne(w)),
    ];
    final i = await showModalBottomSheet<int>(
      context: context,
      builder: (c) => SafeArea(
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(18, 14, 18, 4),
            child: Text('${tr('كشف', 'Report')} ${w['reportNumber'] ?? ''}', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
          ),
          if (locked)
            Text(tr('يحرّره الآن ${w['lockedByName'] ?? ''}', 'Being edited by ${w['lockedByName'] ?? ''}'), style: const TextStyle(fontSize: 12, color: T.danger)),
          for (var k = 0; k < actions.length; k++)
            ListTile(
              leading: Icon(actions[k].$1, color: actions[k].$3),
              title: Text(actions[k].$2),
              onTap: () => Navigator.pop(c, k),
            ),
        ]),
      ),
    );
    if (i != null) await actions[i].$4();
  }

  // ── التحديدُ والإجراءاتُ الجماعيّة ───────────────────────────────────────
  int get _selectedCount => _allMatching ? _total : _sel.length;

  Map<String, dynamic> _selectionPayload() => _allMatching
      ? {'allMatching': true, 'query': opsQueryMap(_params()), 'expectedCount': _total}
      : {'ids': _sel.toList()};

  void _toggleSel(String id) => setState(() {
        _allMatching = false;
        if (!_sel.remove(id)) _sel.add(id);
      });

  void _toggleSelectPage() => setState(() {
        final ids = _rows.map((r) => '${r['_id']}').toList();
        final all = ids.isNotEmpty && ids.every(_sel.contains);
        if (all) { _sel.removeAll(ids); _allMatching = false; } else { _sel.addAll(ids); }
      });

  Future<void> _bulkDelete() async {
    final n = _selectedCount;
    if (n == 0) return;
    final msg = _allMatching
        ? tr('سيُحذف $n كشفًا — كلُّ نتائج الفلتر الحاليّ في كلّ الصفحات، لا الصفحةُ المعروضة وحدَها. لا يمكن التراجع. متابعة؟',
            'This deletes $n reports — every result of the current filter across all pages. This cannot be undone. Continue?')
        : tr('حذف $n طلبًا محدّدًا؟ لا يمكن التراجع.', 'Delete $n selected requests? This cannot be undone.');
    if (!await opsConfirm(context, msg, danger: true)) return;
    setState(() => _busy = true);
    try {
      await Api.instance.post('/api/workflows/bulk-delete', _selectionPayload());
      if (!mounted) return;
      setState(() { _sel.clear(); _allMatching = false; });
      _load(background: true);
    } catch (e) {
      if (mounted) opsSnack(context, opsErr(e), error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  /// تسجيلُ سدادٍ لدفعةٍ واحدة — الخانةُ الفارغة تعني «لا تلمس هذا العمود».
  Future<void> _bulkPay() async {
    final date = TextEditingController(), send = TextEditingController(), bdel = TextEditingController();
    final branch = TextEditingController(), dest = TextEditingController(), doc = TextEditingController();
    String ptype = '', opsReview = '';
    bool running = false;
    String? resultMsg;
    List<Map> skipped = [];
    int more = 0;
    await showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (c) => StatefulBuilder(builder: (c, set) {
        Widget dateField(TextEditingController ctrl, String label) => Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: TextField(
                controller: ctrl, readOnly: true,
                decoration: InputDecoration(labelText: label, isDense: true,
                    suffixIcon: ctrl.text.isEmpty ? const Icon(Icons.calendar_month_outlined, size: 18)
                        : IconButton(icon: const Icon(Icons.close, size: 18), onPressed: () => set(ctrl.clear))),
                onTap: () async {
                  final d = await showDatePicker(context: c, initialDate: DateTime.now(), firstDate: DateTime(2018), lastDate: DateTime(2040));
                  if (d != null) set(() => ctrl.text = opsYmd(d));
                },
              ),
            );
        Future<void> run() async {
          final fields = <String, dynamic>{
            if (date.text.trim().isNotEmpty) 'paymentDate': date.text.trim(),
            if (branch.text.trim().isNotEmpty) 'payingBranch': branch.text.trim(),
            if (ptype.isNotEmpty) 'paymentType': ptype,
            if (dest.text.trim().isNotEmpty) 'finalReportDestination': dest.text.trim(),
            if (doc.text.trim().isNotEmpty) 'documentNumber': doc.text.trim(),
            if (send.text.trim().isNotEmpty) 'sendingDate': send.text.trim(),
            if (bdel.text.trim().isNotEmpty) 'branchDeliveryDate': bdel.text.trim(),
            if (opsReview == 'تم') 'operationsReview': 'تم',
            // «إزالة العلامة» فراغٌ مقصود.
            if (opsReview == 'clear') 'operationsReview': '',
          };
          if (fields.isEmpty) return;
          if (_allMatching) {
            final n = fields.length;
            final ok = await opsConfirm(c, tr('سيُطبَّق التعديل ($n ${n == 1 ? 'عمود' : 'أعمدة'}) على $_total كشفًا — كلُّ نتائج الفلتر الحاليّ في كلّ الصفحات. متابعة؟',
                'Apply this change ($n field${n == 1 ? '' : 's'}) to $_total reports — every result of the current filter. Continue?'));
            if (!ok) return;
          }
          set(() { running = true; resultMsg = null; skipped = []; });
          // ما حُفظ يظهر في اللحظة على الكشوف المحدَّدة — لا ينتظر إعادةَ القائمة (٢٠٢٦/١٠/٢٦).
          final picked = _allMatching ? null : Set<String>.of(_sel);
          try {
            final r = await Api.instance.post('/api/workflows/bulk-update', {..._selectionPayload(), 'fields': fields});
            skipped = List<Map>.from((r['skipped'] as List?) ?? const []);
            if (picked != null && mounted) {
              final skippedNos = skipped.map((x) => '${x['reportNumber']}').toSet();
              final shown = Map<String, dynamic>.from(fields);
              final pt = '${shown['paymentType'] ?? ''}';
              if (pt.isNotEmpty && pt != 'cash' && pt != 'tax') {
                shown['paymentSubtype'] = pt;
                shown['paymentType'] = pt == 'deferred_invoice' ? 'tax' : 'cash';
              }
              setState(() {
                _rows = _rows.map((w) => picked.contains('${w['_id']}') && !skippedNos.contains('${w['reportNumber']}') ? {...w, ...shown} : w).toList();
              });
            }
            more = (((r['skippedCount'] ?? skipped.length) as num).toInt() - skipped.length).clamp(0, 1 << 30);
            resultMsg = '${r['message'] ?? ''}';
            if (skipped.isEmpty && c.mounted) {
              Navigator.pop(c);
              if (mounted) { setState(() { _sel.clear(); _allMatching = false; }); opsSnack(context, resultMsg!); }
            }
          } catch (e) {
            resultMsg = opsErr(e);
          }
          if (mounted) _load(background: true);
          // والعاملُ الآخرُ في الخادم يمسح ذاكرتَه خلال ثانية — إعادةٌ ثانيةٌ تلتقط ما فاته.
          Future.delayed(const Duration(milliseconds: 1500), () { if (mounted) _load(background: true); });
          if (c.mounted) set(() => running = false);
        }
        return SafeArea(
          child: Padding(
            padding: EdgeInsets.fromLTRB(16, 14, 16, MediaQuery.of(c).viewInsets.bottom + 12),
            child: SingleChildScrollView(
              child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, mainAxisSize: MainAxisSize.min, children: [
                Text(tr('تسجيل سداد', 'Record payment'), style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w800)),
                const SizedBox(height: 8),
                Text(tr('يُطبَّق على', 'Apply to'), style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 12.5)),
                const SizedBox(height: 4),
                SegmentedButton<bool>(
                  segments: [
                    ButtonSegment(value: false, label: Text(tr('المحدَّد (${_sel.length})', 'Selected (${_sel.length})'))),
                    ButtonSegment(value: true, enabled: _total > _sel.length, label: Text(tr('كل نتائج الفلتر ($_total)', 'All filter results ($_total)'))),
                  ],
                  selected: {_allMatching},
                  onSelectionChanged: (s) { setState(() => _allMatching = s.first); set(() {}); },
                ),
                const SizedBox(height: 6),
                Text(tr('غيِّر ما تريد فقط — ما تتركه فارغًا لا يُغيَّر.', 'Change only what you need — blank fields are left unchanged.'),
                    style: const TextStyle(fontSize: 11, color: T.inkFaint)),
                const SizedBox(height: 10),
                dateField(date, tr('تاريخ السداد', 'Payment date')),
                Padding(padding: const EdgeInsets.only(bottom: 8), child: LookupField(type: 'workflow_paying_branch', controller: branch, label: tr('الفرع المسدِّد', 'Paying branch'), noAdd: true)),
                Padding(
                  padding: const EdgeInsets.only(bottom: 8),
                  child: DropdownButtonFormField<String>(
                    initialValue: ptype,
                    isExpanded: true,
                    decoration: InputDecoration(labelText: tr('نوع الدفع', 'Payment type'), isDense: true),
                    items: [
                      DropdownMenuItem(value: '', child: Text(tr('— لا يُغيَّر —', '— leave unchanged —'))),
                      for (final o in opsPaymentChoices) DropdownMenuItem(value: o.$1, child: Text(tr(o.$2, o.$3))),
                    ],
                    onChanged: (v) => set(() => ptype = v ?? ''),
                  ),
                ),
                Padding(padding: const EdgeInsets.only(bottom: 8), child: LookupField(type: 'workflow_final_destination', controller: dest, label: tr('وجهة الكشف النهائية', 'Final destination'), noAdd: true)),
                Padding(
                  padding: const EdgeInsets.only(bottom: 8),
                  child: TextField(controller: doc, decoration: InputDecoration(labelText: tr('رقم السند', 'Voucher no.'), hintText: tr('اختياري', 'Optional'), isDense: true)),
                ),
                dateField(send, tr('تاريخ الإرسال', 'Sending date')),
                dateField(bdel, tr('تاريخ التسليم للفرع', 'Delivered to branch')),
                if (_canEditOpsReview)
                  DropdownButtonFormField<String>(
                    initialValue: opsReview,
                    isExpanded: true,
                    decoration: InputDecoration(labelText: tr('مراجعة التشغيل', 'Ops review'), isDense: true),
                    items: [
                      DropdownMenuItem(value: '', child: Text(tr('— لا تُغيَّر —', '— leave unchanged —'))),
                      DropdownMenuItem(value: 'تم', child: Text(tr('تمّت المراجعة', 'Reviewed'))),
                      DropdownMenuItem(value: 'clear', child: Text(tr('إزالة العلامة', 'Clear the mark'))),
                    ],
                    onChanged: (v) => set(() => opsReview = v ?? ''),
                  ),
                if (resultMsg != null) ...[
                  const SizedBox(height: 10),
                  Container(
                    padding: const EdgeInsets.all(8),
                    decoration: BoxDecoration(color: T.canvas, borderRadius: BorderRadius.circular(10), border: Border.all(color: T.line)),
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Text(resultMsg!, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 12)),
                      if (more > 0) Text(tr('و$more أخرى لم تُحفظ', 'and $more more not saved'), style: const TextStyle(fontSize: 11, color: T.inkFaint)),
                      for (final s in skipped) Text('${s['reportNumber']} — ${s['reason']}', style: const TextStyle(fontSize: 11, color: T.warn)),
                    ]),
                  ),
                ],
                const SizedBox(height: 12),
                FilledButton(
                  style: FilledButton.styleFrom(backgroundColor: T.violet),
                  onPressed: running ? null : run,
                  child: running ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white)) : Text(tr('حفظ', 'Save')),
                ),
              ]),
            ),
          ),
        );
      }),
    );
    for (final c in [date, send, bdel, branch, dest, doc]) { c.dispose(); }
  }

  // ── التصدير ──────────────────────────────────────────────────────────────
  dynamic _exportValue(Map<String, dynamic> w, String k) {
    final v = w[k];
    switch (k) {
      case 'applicationStatus': return opsStatusLabel(v);
      case 'paymentType': return opsPaymentKindLabel(opsPaymentKindOf(w));
      case 'operationsReview':
      case 'accountingReview': return (v ?? '').toString().isNotEmpty ? tr('تمّت', 'Done') : '';
      case 'dataOwnerShown': return (w['dataOwnerShown'] ?? w['paymentDateByName'] ?? '').toString();
      case 'customsRef':
        final l = w['customsLink'];
        return l is Map && l['clearance'] != null ? (l['refNumber'] ?? '').toString() : '';
      case 'customsBl':
        final l = w['customsLink'];
        return l is Map && l['clearance'] != null ? (l['blNumber'] ?? '').toString() : '';
    }
    if (_dateFields.contains(k)) return v == null || '$v'.isEmpty ? '-' : opsDate(v);
    if (v is num) return v;
    return v?.toString() ?? '';
  }

  void _exportLocal(List<Map<String, dynamic>> rows) {
    final cols = [
      for (final c in _exportCols)
        if ((_canViewFinancials || !_moneyExportKeys.contains(c.$1)) && (_canSeeSelling || c.$1 != 'sellingValue'))
          ExportCol(c.$2, c.$3, (r) => _exportValue(r, c.$1)),
    ];
    exportExcel(context, fileName: 'operations', sheets: [(tr('الطلبات', 'Workflows'), cols, rows)]);
  }

  Future<void> _export() async {
    final filtered = '/api/workflows/export?${opsQs(_params())}';
    await opsExportMenu(context, [
      if (_selectedCount > 0)
        _allMatching
            ? (tr('المحدَّد — كلّ نتائج الفلتر ($_total)', 'Selected — all filter results ($_total)'), () => opsServerExport(context, filtered, 'operations'))
            : (tr('المحدَّد (${_sel.length})', 'Selected (${_sel.length})'), () async => _exportLocal(_rows.where((w) => _sel.contains('${w['_id']}')).toList())),
      (tr('الصفحة المعروضة (${_rows.length})', 'Current page (${_rows.length})'), () async => _exportLocal(_rows)),
      (tr('كلّ ما طابق الفلتر ($_total)', 'Everything matching the filter ($_total)'), () => opsServerExport(context, filtered, 'operations')),
      (tr('الجدول كلّه (بلا فلتر)', 'The whole table (no filter)'), () => opsBackgroundExport(context, 'workflows', {'scope': 'all'})),
    ]);
  }

  Future<void> _openNew() async {
    final mode = await showModalBottomSheet<bool>(
      context: context,
      builder: (c) => SafeArea(
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          ListTile(leading: const Icon(Icons.add_circle_outline, color: T.orange), title: Text(tr('طلب واحد', 'Single request')), onTap: () => Navigator.pop(c, false)),
          ListTile(leading: const Icon(Icons.upload_file, color: T.success), title: Text(tr('استيراد من Excel', 'Import from Excel')), onTap: () => Navigator.pop(c, true)),
        ]),
      ),
    );
    if (mode == null || !mounted) return;
    final done = await Navigator.push<bool>(context, MaterialPageRoute(builder: (_) => OpsWorkflowNewScreen(importMode: mode)));
    if (done == true && mounted) _load(background: true);
  }

  // ── فحوصُ الفواتير ───────────────────────────────────────────────────────
  Future<void> _openCheck(String kind, String title) async {
    List<dynamic> rows = [];
    bool busy = true;
    bool started = false;
    await showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (c) => StatefulBuilder(builder: (c, set) {
        if (!started) {
          started = true;
          Api.instance.get('/api/workflows/invoice-checks/$kind').then((d) { rows = (d['rows'] as List?) ?? []; busy = false; if (c.mounted) set(() {}); })
              .catchError((_) { busy = false; if (c.mounted) set(() {}); });
        }
        String line(Map r) {
          switch (kind) {
            case 'gaps':
              return '${r['invoiceNumber']}';
            case 'missing-reports':
              return '${tr('فاتورة', 'Invoice')} ${r['invoiceNumber']} — ${tr('كشف', 'report')} ${r['reportNumber']}${(r['customerName'] ?? '').toString().isNotEmpty ? ' · ${r['customerName']}' : ''}';
            case 'value-diffs':
              return '${tr('فاتورة', 'Invoice')} ${r['invoiceNumber']}: ${tr('الورقة', 'sheet')} ${opsMoney(r['uploadedValue'])} · ${tr('الكشوف', 'reports')} ${opsMoney(r['reportsValue'])} · ${tr('الفرق', 'diff')} ${opsMoney(r['difference'])}';
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

  String _checkKey(String kind) => {'gaps': 'gaps', 'missing-reports': 'missingReports', 'value-diffs': 'valueDiffs', 'name-mismatches': 'nameMismatches'}[kind]!;

  Widget _statCard(String label, String value, Color color, {String? sub, bool active = false, VoidCallback? onTap, bool alarm = false}) => Padding(
        padding: const EdgeInsetsDirectional.only(end: 8),
        child: SizedBox(
          width: 158,
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
                Text(value, style: TextStyle(fontSize: 16, fontWeight: FontWeight.w800, color: alarm ? T.danger : T.ink)),
                if (sub != null) Text(sub, style: const TextStyle(fontSize: 9.5, color: T.inkFaint), maxLines: 1, overflow: TextOverflow.ellipsis),
              ]),
            ),
          ),
        ),
      );

  Widget _chip(String label, bool on, VoidCallback onTap, {IconData? icon}) => Padding(
        padding: const EdgeInsetsDirectional.only(end: 6),
        child: FilterChip(
          selected: on,
          onSelected: (_) => onTap(),
          avatar: icon != null ? Icon(icon, size: 14) : null,
          label: Text(label),
          labelStyle: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: T.ink),
          selectedColor: const Color(0xFFF1F5F9),
          backgroundColor: Colors.white,
          checkmarkColor: T.ink,
          showCheckmark: icon == null,
          side: BorderSide(color: on ? T.ink : T.line),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
        ),
      );

  Widget _header() {
    final statusSel = _cf['applicationStatus'] ?? const <String>{};
    final pbr = ((_stats['pendingBondReceived'] ?? 0) as num).toInt();
    final contradictionOn = _pendingOnly && statusSel.length == 1 && statusSel.contains('bond_received');
    final colActive = _cf.keys.where((k) => !_barFields.any((b) => b.$1 == k)).length;
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      // ارتفاعُ الشريط يتبع محتواه (حجمُ خطّ النظام) — لا ارتفاعَ ثابتًا يقصّ البطاقات.
      SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.fromLTRB(14, 10, 14, 0),
        child: IntrinsicHeight(child: Row(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            _statCard(tr('سندات لم تصل', 'Pending bonds'), '${_stats['pendingInvoices'] ?? 0}', T.warn,
                sub: tr('بلا تاريخ سداد · عدا الملغاة', 'no payment date · excludes cancelled'),
                active: _pendingOnly && !contradictionOn,
                onTap: () { _pendingOnly = !_pendingOnly; _reload(); }),
            // التناقض: سندٌ لم يصل وحالتُه «استُلم السند».
            _statCard(tr('سند لم يصل وحالته «استُلم السند»', 'Pending bond, status says received'), '$pbr', pbr > 0 ? T.danger : T.line,
                sub: tr('تاريخُ السداد ناقص أو الحالة خطأ', 'missing payment date or wrong status'),
                alarm: pbr > 0, active: contradictionOn,
                onTap: () {
                  _pendingOnly = !contradictionOn;
                  _cf.remove('applicationStatus');
                  if (!contradictionOn) _toggleStatus('bond_received');
                  _reload();
                }),
            _statCard(tr('عدد الصفوف (حسب الفلتر)', 'Rows (filtered)'), '${_stats['total'] ?? _total}', T.inkFaint),
            if (_full || _has('purchaseValue'))
              _statCard(tr('مجموع قيمة الشراء (حسب الفلتر)', 'Total purchase value (filtered)'), opsMoney(_stats['sumPurchaseValue'] ?? 0), T.inkFaint),
            if (_checks != null && _canViewFinancials)
              for (final k in _checkKinds)
                _statCard(tr(k.$2, k.$3), '${(_checks![_checkKey(k.$1)] as Map?)?['count'] ?? 0}', k.$4,
                    sub: k.$1 == 'gaps' && (_checks!['gaps'] as Map?)?['start'] != null
                        ? '${(_checks!['gaps'] as Map)['start']} → ${(_checks!['gaps'] as Map)['end']}'
                        : null,
                    onTap: () => _openCheck(k.$1, tr(k.$2, k.$3))),
          ],
        )),
      ),
      Padding(
        padding: const EdgeInsets.fromLTRB(14, 8, 14, 0),
        child: SearchField(
          controller: _qCtrl, dense: true,
          hint: tr('ابحث برقم الكشف، العميل، السائق، الإقامة، الجوال، اللوحة…', 'Report, customer, driver, iqama, phone, plate…'),
          onChanged: (v) {
            _debounce?.cancel();
            _debounce = Timer(const Duration(milliseconds: 350), () { if (!mounted) return; _q = v; _reload(); });
          },
        ),
      ),
      Padding(
        padding: const EdgeInsets.fromLTRB(14, 6, 14, 0),
        child: OpsPeriodBar(period: _period, onChanged: _reload),
      ),
      Padding(
        padding: const EdgeInsets.fromLTRB(14, 6, 14, 2),
        child: SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          child: Row(children: [
            _chip(tr('باستثناء الملغاة', 'Excluding cancelled'), _excludeCancelled, () { _excludeCancelled = !_excludeCancelled; _reload(); }, icon: Icons.block),
            for (final f in _barFields)
              if (!f.$4 || _canViewFinancials)
                _chip(
                  (_cf[f.$1] ?? const {}).isEmpty
                      ? tr(f.$2, f.$3)
                      : (_cf[f.$1]!.length == 1 ? '${tr(f.$2, f.$3)}: ${_valueLabel(f.$1, _cf[f.$1]!.first)}' : '${tr(f.$2, f.$3)} (${_cf[f.$1]!.length})'),
                  (_cf[f.$1] ?? const {}).isNotEmpty,
                  () => _pickFilter(f.$1, tr(f.$2, f.$3)),
                ),
            _chip(colActive > 0 ? tr('أعمدة أخرى ($colActive)', 'Other columns ($colActive)') : tr('أعمدة أخرى', 'Other columns'), colActive > 0, _pickColumn, icon: Icons.filter_alt_outlined),
            for (final m in [('linked', 'مرتبطة بالتخليص', 'Customs linked'), ('unlinked', 'غير مرتبطة', 'Not linked')])
              _chip(tr(m.$2, m.$3), _customs == m.$1, () { _customs = _customs == m.$1 ? '' : m.$1; _reload(); },
                  icon: m.$1 == 'linked' ? Icons.directions_boat_outlined : Icons.link_off),
            if (_customs.isNotEmpty && _customs != 'linked' && _customs != 'unlinked')
              _chip(tr('كشوف معاملةٍ محدّدة ✕', 'One clearance ✕'), true, () { _customs = ''; _reload(); }),
            if (_cf.isNotEmpty)
              TextButton(onPressed: () { _cf.clear(); _reload(); }, child: Text(tr('مسح الفلاتر (${_cf.length})', 'Clear filters (${_cf.length})'))),
          ]),
        ),
      ),
      // ── شريطُ التحديد ──────────────────────────────────────────────────
      if (_sel.isNotEmpty || _allMatching)
        Container(
          margin: const EdgeInsets.fromLTRB(14, 6, 14, 0),
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
          decoration: BoxDecoration(color: T.canvas, borderRadius: BorderRadius.circular(12), border: Border.all(color: T.line)),
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Row(children: [
              Expanded(
                child: Text(_allMatching
                    ? tr('تم تحديد كلّ الـ $_total نتيجة — في كلّ الصفحات', 'All $_total results selected — across all pages')
                    : tr('محدَّد: ${_sel.length}', 'Selected: ${_sel.length}'),
                    style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700)),
              ),
              TextButton(onPressed: _toggleSelectPage, child: Text(tr('الصفحة كلّها', 'Whole page'))),
              TextButton(onPressed: () => setState(() { _sel.clear(); _allMatching = false; }), child: Text(tr('إلغاء', 'Clear'))),
            ]),
            if (!_allMatching && _total > _rows.length && _rows.isNotEmpty && _rows.every((r) => _sel.contains('${r['_id']}')))
              Align(
                alignment: AlignmentDirectional.centerStart,
                child: TextButton(onPressed: () => setState(() => _allMatching = true), child: Text(tr('تحديد كلّ الـ $_total نتيجة؟', 'Select all $_total results?'))),
              ),
            Wrap(spacing: 8, children: [
              FilledButton.icon(
                style: FilledButton.styleFrom(backgroundColor: T.violet, visualDensity: VisualDensity.compact),
                onPressed: _busy ? null : _bulkPay,
                icon: const Icon(Icons.task_alt, size: 16),
                label: Text(tr('تسجيل سداد ($_selectedCount)', 'Record payment ($_selectedCount)')),
              ),
              if (_canDelete)
                FilledButton.icon(
                  style: FilledButton.styleFrom(backgroundColor: T.danger, visualDensity: VisualDensity.compact),
                  onPressed: _busy ? null : _bulkDelete,
                  icon: const Icon(Icons.delete_outline, size: 16),
                  label: Text(tr('حذف ($_selectedCount)', 'Delete ($_selectedCount)')),
                ),
            ]),
          ]),
        ),
    ]);
  }

  Widget _rowCard(Map<String, dynamic> w, int i) {
    final id = '${w['_id']}';
    final appSt = opsAppStatuses[w['applicationStatus']] ?? ('—', '—', T.inkFaint);
    final selected = _sel.contains(id) || _allMatching;
    final locked = _lockedByOther(w);
    final selecting = _sel.isNotEmpty || _allMatching;
    final ptype = opsPaymentKindLabel(opsPaymentKindOf(w));
    return FadeSlideIn(
      delayMs: (i * 12).clamp(0, 120),
      child: Pressable(
        onTap: () => selecting ? _toggleSel(id) : _openDetail(w),
        onLongPress: () => _toggleSel(id),
        child: Opacity(
          opacity: locked ? 0.65 : 1,
          child: AppCard(
            topAccent: appSt.$3,
            padding: const EdgeInsets.fromLTRB(8, 10, 4, 10),
            child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Checkbox(visualDensity: VisualDensity.compact, value: selected, onChanged: (_) => _toggleSel(id)),
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Row(children: [
                    Expanded(child: Text((w['reportNumber'] ?? '—').toString(), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13.5, color: T.orange))),
                    if (locked) const Icon(Icons.lock_outline, size: 14, color: T.danger),
                    if ((w['dataOwnerShown'] ?? '').toString().isNotEmpty)
                      Flexible(
                        child: Text(w['dataOwnerShown'].toString(), maxLines: 1, overflow: TextOverflow.ellipsis,
                            style: TextStyle(fontSize: 10.5, fontWeight: FontWeight.w600, color: w['dataOwnerFrom'] == 'import' ? T.inkFaint : T.violet)),
                      ),
                  ]),
                  const SizedBox(height: 3),
                  Text('${w['fromLocation'] ?? '—'} ← ${w['toLocation'] ?? '—'} · ${opsDate(w['reportDate'])}', style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600)),
                  Text([w['username'], w['carOwner'], w['carNumber'], w['branch']].where((x) => (x ?? '').toString().isNotEmpty).join(' · '),
                      maxLines: 2, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 11.5, color: T.inkSoft)),
                  const SizedBox(height: 6),
                  Wrap(spacing: 6, runSpacing: 4, crossAxisAlignment: WrapCrossAlignment.center, children: [
                    if ((w['applicationStatus'] ?? '').toString().isNotEmpty)
                      Pressable(
                        onTap: () => _changeAppStatus(w),
                        child: _statusSaving.contains(id)
                            ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2))
                            : Chip2(tr(appSt.$1, appSt.$2), appSt.$3, icon: (w['externalSource'] ?? '') == 'ops_upl' ? Icons.unfold_more : null),
                      ),
                    if (ptype.isNotEmpty) Chip2(ptype, T.violet),
                    if (w['purchaseValue'] != null && w['purchaseValue'] != 0) Chip2('${tr('شراء', 'buy')} ${opsMoney(w['purchaseValue'])}', T.inkSoft),
                    if (_canSeeSelling && w['sellingValue'] != null && w['sellingValue'] != 0) Chip2('${tr('بيع', 'sell')} ${opsMoney(w['sellingValue'])}', T.success),
                    if ((w['paymentDate'] ?? '').toString().isNotEmpty) Chip2('${tr('سداد', 'paid')} ${opsDate(w['paymentDate'])}', T.violet, icon: Icons.event_available),
                    if ((w['operationsReview'] ?? '').toString().isNotEmpty) Chip2(tr('مراجعة التشغيل ✓', 'Ops ✓'), T.warn),
                    if ((w['accountingReview'] ?? '').toString().isNotEmpty) Chip2(tr('مراجعة المحاسبة ✓', 'Acc ✓'), T.violet),
                    if ((w['invoiceNumber'] ?? '').toString().isNotEmpty) Chip2('${tr('فاتورة', 'inv')} ${w['invoiceNumber']}', T.success),
                    if (customsIdOf(w['customsLink']).isNotEmpty) CustomsLinkChip(w['customsLink'], compact: true),
                  ]),
                ]),
              ),
              IconButton(
                visualDensity: VisualDensity.compact,
                icon: const Icon(Icons.more_vert, size: 20, color: T.inkFaint),
                onPressed: () => _rowMenu(w),
              ),
            ]),
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    context.watch<AuthProvider>();
    return AppScaffold(
      title: Text(tr('التشغيل', 'Operations')),
      actions: [
        IconButton(tooltip: tr('تصدير Excel', 'Export to Excel'), icon: const Icon(Icons.file_download_outlined), onPressed: _export),
      ],
      floatingActionButton: _canCreate
          ? FloatingActionButton.extended(
              backgroundColor: T.orange, foregroundColor: Colors.white,
              onPressed: _openNew,
              icon: const Icon(Icons.add),
              label: Text(tr('طلب جديد', 'New request')),
            )
          : null,
      body: _loading
          ? ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(height: 60), SizedBox(height: 10), Shimmer(), SizedBox(height: 10), Shimmer()])
          : _error != null && _rows.isEmpty
              ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView(
                    keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
                    padding: const EdgeInsets.only(bottom: 90),
                    children: [
                      _header(),
                      if (_refreshing) const Padding(padding: EdgeInsets.fromLTRB(14, 6, 14, 0), child: LinearProgressIndicator(minHeight: 2)),
                      const SizedBox(height: 8),
                      if (_rows.isEmpty)
                        EmptyState(
                          icon: Icons.workspaces_outline,
                          title: _pendingOnly ? tr('لا توجد فواتير معلقة', 'No pending invoices') : (_cf.isNotEmpty || _q.trim().isNotEmpty ? tr('لا نتائج للفلتر المحدد', 'No rows match the filters') : tr('لا توجد كشوف', 'No sheets')),
                        )
                      else
                        for (var i = 0; i < _rows.length; i++)
                          Padding(padding: const EdgeInsets.fromLTRB(14, 0, 14, 8), child: _rowCard(_rows[i], i)),
                      if (_total > 0)
                        Padding(
                          padding: const EdgeInsets.symmetric(horizontal: 14),
                          child: Row(children: [
                            Expanded(
                              child: Text(tr('${(_page - 1) * _pageSize + 1}-${(_page * _pageSize).clamp(0, _total)} من $_total', '${(_page - 1) * _pageSize + 1}-${(_page * _pageSize).clamp(0, _total)} of $_total'),
                                  style: const TextStyle(fontSize: 11.5, color: T.inkSoft)),
                            ),
                            PopupMenuButton<int>(
                              tooltip: tr('صفوف في الصفحة', 'Rows per page'),
                              initialValue: _pageSize,
                              onSelected: (n) { _pageSize = n; _reload(); },
                              itemBuilder: (_) => [for (final n in const [25, 50, 100, 200, 500]) PopupMenuItem(value: n, child: Text('$n'))],
                              child: Padding(padding: const EdgeInsets.all(6), child: Text('$_pageSize ▾', style: const TextStyle(fontWeight: FontWeight.w700))),
                            ),
                            IconButton(onPressed: _page > 1 ? () { setState(() { _page--; _sel.clear(); _allMatching = false; }); _load(); } : null, icon: Icon(Lang.instance.ar ? Icons.chevron_right : Icons.chevron_left)),
                            Text('$_page / $_pages', style: const TextStyle(fontWeight: FontWeight.w800)),
                            IconButton(onPressed: _page < _pages ? () { setState(() { _page++; _sel.clear(); _allMatching = false; }); _load(); } : null, icon: Icon(Lang.instance.ar ? Icons.chevron_left : Icons.chevron_right)),
                          ]),
                        ),
                    ],
                  ),
                ),
    );
  }
}
