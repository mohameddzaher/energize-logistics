import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';
import '../config.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';
import '../ui/file_upload.dart';
import 'jp.dart' show jpDeadline;
import 'customs_party.dart';

/// تفاصيل التخليص الجمركي — دورةُ المراحل كما يحسبها الخادم (`pipeline`)،
/// الوحداتُ (حاوياتٍ أو سيّارات) وبيانُ نقلها، إصدارُ الفاتورة وفاتورةُ النقل،
/// مهامُّ الإنجاز بتواريخها، المستندات، مراحلُ السداد، والتكاليف.
class CustomsDetailScreen extends StatefulWidget {
  final String clearanceId;
  final String ref;
  const CustomsDetailScreen({super.key, required this.clearanceId, required this.ref});
  @override
  State<CustomsDetailScreen> createState() => _CustomsDetailScreenState();
}

/// مراحلُ الدورة بالترتيب — المفاتيحُ من STAGES في الخادم
/// (models/CustomsClearance) والأسماءُ من config/customsStages.
///
/// والدورةُ ليست خطًّا: بعد «أمر النقل» طريقان يتنافيان، ومراحلُ تُغلَق على
/// معاملةٍ دون أخرى. فما يُنجَز وما يُغلَق يُقرأ من `pipeline.steps` لا من هنا.
const customsStages = [
  ('papers_received', 'استلام الأوراق', 'Papers received'),
  ('declaration_paid', 'سداد البيان الجمركي', 'Customs declaration paid'),
  ('do_requested', 'طلب فاتورة إذن التسليم', 'DO invoice requested'),
  ('do_invoice_paid', 'سداد فاتورة إذن التسليم', 'DO invoice paid'),
  ('do_linked', 'ربط إذن التسليم', 'DO linked'),
  ('port_fees_paid', 'سداد أجور الموانئ', 'Port fees paid'),
  ('unloading_fees_paid', 'سداد أجور التفريغ', 'Unloading fees paid'),
  ('transport_order', 'أمر النقل', 'Transport order'),
  ('transport_to_yard', 'نقل الحاويات من الميناء إلى الساحة', 'Containers: port to yard'),
  ('transport_to_customer', 'نقل الحاويات من الميناء إلى العميل', 'Containers: port to customer'),
  ('unloaded_stored', 'التفريغ والتخزين', 'Unloading & storage'),
  ('yard_to_customer', 'نقل الحاويات من الساحة إلى العميل', 'Containers: yard to customer'),
  ('containers_returned', 'إرجاع الحاويات', 'Containers returned'),
  ('invoiced', 'إصدار الفاتورة', 'Invoice issued'),
];

// مفتاحُ ما قبل تفريع النقل — باقٍ في `stage` على معاملاتٍ قديمة.
const _legacyStage = ('containers_transported', 'نقل الحاويات', 'Containers transported');

/// اسمُ المرحلة — و«الحاويات» فيه تصير «السيّارات» في معاملة السيّارات.
String customsStageLabel(String key, [String cargoType = 'containers']) {
  final hit = [...customsStages, _legacyStage].where((s) => s.$1 == key);
  if (hit.isEmpty) return key;
  final (_, ar, en) = hit.first;
  if (cargoType != 'vehicles') return tr(ar, en);
  return tr(ar.replaceFirst('الحاويات', 'السيّارات'), en.replaceFirst('Containers', 'Vehicles'));
}

/// رابطُ الملفّ باسمٍ يُعرَف به عند التنزيل: «{البوليصة} - {العنوان}[ (n)].{ext}».
/// الخادمُ يكرّم `dl` على `/api/uploads/...` فيردّ الملفَّ بهذا الاسم؛ والرقمُ (n)
/// يُعطى حين يتكرّر العنوانُ نفسُه وحدَه.
String customsFileUrl(dynamic fileUrl, {required String base, required String title, int n = 0, dynamic fileName}) {
  final u = '${fileUrl ?? ''}';
  if (!u.contains('/api/uploads/')) return u;
  String extOf(String v) => RegExp(r'\.([A-Za-z0-9]{1,5})$').firstMatch(v.split('?').first)?.group(1)?.toLowerCase() ?? '';
  final ext = extOf('${fileName ?? ''}').isNotEmpty ? extOf('${fileName ?? ''}') : extOf(u);
  final name = '${[base, title].where((x) => x.trim().isNotEmpty).join(' - ')}${n > 0 ? ' ($n)' : ''}'
      .replaceAll(RegExp(r'[\\/:*?"<>|]'), '').trim();
  if (name.isEmpty) return u;
  return '$u${u.contains('?') ? '&' : '?'}dl=${Uri.encodeComponent(ext.isEmpty ? name : '$name.$ext')}';
}

/// حالةُ طلب الصرف عند الماليّة — اسمُها ولونُها.
(String, Color) customsPayStatus(dynamic status) => switch ('${status ?? 'pending'}') {
      'paid' => (tr('تمّ الدفع', 'Paid'), T.success),
      'returned' => (tr('أُعيد للتصحيح', 'Returned for correction'), T.info),
      'rejected' => (tr('مرفوض', 'Rejected'), T.danger),
      _ => (tr('بانتظار الدفع', 'Awaiting payment'), T.warn),
    };

// المراحلُ التي هي نقلٌ — لكلٍّ منها بيانُ سيّارتها على كلّ وحدة (containers.moves).
const _transportLegs = ['transport_to_yard', 'transport_to_customer', 'yard_to_customer'];

const _stageDoneItems = [
  ('doInvoiceEmailed', 'إرسال بريد فاتورة إذن التسليم', 'DO invoice emailed'),
  ('doInvoicePaid', 'سداد فاتورة إذن التسليم', 'DO invoice paid'),
  ('doLinkEmailed', 'إرسال بريد ربط إذن التسليم', 'DO link emailed'),
  ('dutyPaid', 'سداد الرسوم الجمركية', 'Duty paid'),
  ('portFeesPaid', 'سداد الموانئ', 'Port fees paid'),
  ('unloadingFeesPaid', 'سداد التفريغ', 'Unloading fees paid'),
  ('containersReturned', 'إرجاع الحاويات', 'Containers returned'),
  ('returnInvoiceDate', 'فاتورة الإرجاع', 'Return invoice'),
];

const _documentItems = [
  ('bl', 'البوليصة', 'Bill of lading'),
  ('commercialInvoice', 'الفاتورة التجارية', 'Commercial invoice'),
  ('certificateOfOrigin', 'شهادة المنشأ', 'Certificate of origin'),
  ('packingList', 'بيان التعبئة', 'Packing list'),
  ('saber', 'شهادة سابر', 'Saber certificate'),
];


/// بنود المصروفات — مبالغُ تُدفع للغير وتُمرَّر على العميل كما هي. الترتيب
/// والمحتوى مطابقان لـCOST_KEYS في الخادم؛ نقصانُ بندٍ هنا يجعل إجماليَّ
/// الجوّال أقلَّ من إجمالي الويب في المعاملة نفسها.
const _costItems = [
  ('deliveryOrder', 'قيمة إذن التسليم', 'Delivery order'),
  ('customsDuty', 'الرسوم الجمركية', 'Customs duty'),
  ('portFees', 'أجور الموانئ', 'Port fees'),
  ('unloadingFees', 'أجور التفريغ', 'Unloading fees'),
  ('inspection', 'أجور الكشف', 'Inspection'),
  // ما ندفعه للناقل في كلّ جزءٍ من أجزاء النقل — ومنه يُطرَح سعرُ بيعنا
  // للجزء نفسِه فيظهر صافيه.
  ('transport', 'النقل من الميناء إلى العميل', 'Transport: port → customer'),
  ('transportToYard', 'النقل من الميناء إلى الساحة', 'Transport: port → yard'),
  ('transportYardToCustomer', 'النقل من الساحة إلى العميل', 'Transport: yard → customer'),
  ('appointmentBooking', 'حجز الموعد', 'Appointment booking'),
  ('storage', 'تخزين', 'Storage'),
  ('yardFees', 'أجور الساحة', 'Yard fees'),
  // «الأرضيات» و«تصريح الخروج» بندٌ واحد — جُمع ما كان في الأوّل إلى الثاني.
  ('exitPermit', 'تصريح الخروج (الأرضيات)', 'Exit permit (demurrage)'),
  ('extension', 'تمديد', 'Extension'),
  ('consolidator', 'الدامج', 'Consolidator'),
  ('commissions', 'عمولات', 'Commissions'),
  ('extraFees', 'أجور إضافية', 'Extra fees'),
  ('returnInvoice', 'فاتورة الإرجاع', 'Return invoice'),
  ('labourExpenses', 'مصاريف عمال', 'Labour expenses'),
];

/// بنود الإيراد — ما يُضاف فوق المصروفات، والفاتورة = المصروفات + الصوافي
/// والأجور (MARGIN_KEYS في الخادم). وأسعارُ النقل للعميل تُعرَض بجانب صافيها
/// ولا تُجمع وحدَها: الصافي هو ما يدخل الفاتورة فوق تكلفة الجزء.
const _marginItems = [
  ('clearanceFee', 'أجور التخليص', 'Clearance fee'),
  ('transportSelling', 'سعر النقل من الميناء إلى العميل', 'Price: port → customer'),
  // يُحسب في الخادم: سعرُ النقل ناقصَ تكلفته — لا يُكتب بيد.
  ('transportNet', 'صافي النقل', 'Transport net'),
  ('transportToYardSelling', 'سعر النقل من الميناء إلى الساحة', 'Price: port → yard'),
  ('transportToYardNet', 'صافي النقل إلى الساحة', 'Transport-to-yard net'),
  ('yardToCustomerSelling', 'سعر النقل من الساحة إلى العميل', 'Price: yard → customer'),
  ('yardToCustomerNet', 'صافي النقل من الساحة إلى العميل', 'Yard-to-customer net'),
  ('yardNet', 'صافي الساحة', 'Yard net'),
  ('storageNet', 'صافي التخزين', 'Storage net'),
  ('securityScan', 'فحص أمني', 'Security scan'),
  ('labour', 'عمال', 'Labour'),
];

/// مراحلُ السداد التي يُكتب مبلغُها في بند تكلفةٍ حين تؤكّد الماليّةُ الدفع
/// (STAGE_COST في الخادم) — فلا تُضاف ولا تُعدَّل بلا مبلغ (AMOUNT_REQUIRED).
const customsCostMappedStages = {
  'doInvoicePaid', 'dutyPaid', 'portFeesPaid', 'unloadingFeesPaid', 'extension',
  'transportPortToCustomer', 'transportPortToYard', 'transportYardToCustomer',
  'appointmentBooking', 'inspection', 'exitPermit', 'consolidator', 'commissions', 'labourExpenses',
};

/// ما يُقرأ «فاتورةَ نقل» للإنهاء: البندُ القديم وأجزاءُ النقل الثلاثة بملفّها.
const customsTransportInvoiceKeys = {
  'transportInvoice', 'transportPortToCustomer', 'transportPortToYard', 'transportYardToCustomer',
};

Map<String, dynamic> _m(dynamic v) => v is Map ? Map<String, dynamic>.from(v) : {};
List<Map<String, dynamic>> _maps(dynamic v) =>
    v is List ? [for (final e in v) if (e is Map) Map<String, dynamic>.from(e)] : [];

String _arDigits(int n) =>
    Lang.instance.ar ? '$n'.split('').map((d) => '٠١٢٣٤٥٦٧٨٩'[int.parse(d)]).join() : '$n';

class _CustomsDetailScreenState extends State<CustomsDetailScreen> {
  Map<String, dynamic>? _c;
  final TextEditingController _note = TextEditingController();
  bool _loading = true;
  String? _error;
  bool _saving = false;
  // أرقامُ كشوف التخريج الموجودةُ في سير عمل التشغيل — null ما لم يُسأل الخادم.
  Map<String, dynamic>? _sheets;
  String _sheetsKey = '';
  // مهامُّ خطّة العمل المرتبطةُ بالمعاملة — null: القسمُ لا يُعرَض (٤٠٣ أو تعذّر).
  List<Map<String, dynamic>>? _tasks;
  // أيُّ وحدةٍ تُعرَض مراحلُها في «النقل وما بعده» — ‎-1: الكلُّ معًا.
  int _unitSel = -1;
  // تعريفاتُ مراحل السداد من إعدادات القسم (`customs_payment_stage`) — أسماؤها
  // تُقرأ منها وحدَها، فتغييرُ اسمٍ هناك يظهر هنا في الحال.
  List<Map<String, dynamic>> _payDefs = const [];
  // عقدُ العميل الساري بأسعاره (GET /:id/contract-pricing) — null: لا عقد،
  // و`_contractKey` العميلُ وعددُ الوحدات اللذان قُرئ بهما، فلا يُعاد السؤالُ
  // إلّا حين يتغيّر أحدُهما.
  Map<String, dynamic>? _contract;
  bool _contractLoaded = false;
  String _contractKey = '';
  late final void Function() _onLive;
  late final void Function() _onJp;
  late final void Function(dynamic) _onLookup;

  @override
  void initState() {
    super.initState();
    _load();
    _loadTasks();
    _onLive = () => _load();
    _onJp = () => _loadTasks();
    _onLookup = (p) { if (p is Map && p['type'] == 'customs_payment_stage') _loadPayDefs(); };
    _loadPayDefs();
    Live.instance.on('customs:updated', _onLive);
    Live.instance.on('jp:changed', _onJp);
    Live.instance.onData('lookup:changed', _onLookup);
  }

  @override
  void dispose() {
    Live.instance.off('customs:updated', _onLive);
    Live.instance.off('jp:changed', _onJp);
    Live.instance.offData('lookup:changed', _onLookup);
    _note.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final d = await Api.instance.get('/api/customs-clearance/${widget.clearanceId}');
      if (!mounted) return;
      setState(() {
        _c = d['clearance'] is Map ? Map<String, dynamic>.from(d['clearance']) : Map<String, dynamic>.from(d);
        _loading = false;
        _error = null;
      });
      _checkSheets();
      _loadContract();
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  Future<void> _loadPayDefs() async {
    try {
      final d = await Api.instance.get('/api/lookups?type=customs_payment_stage&active=true');
      if (mounted) setState(() => _payDefs = _maps(d['items']));
    } catch (_) {
      // تبقى الإدخالاتُ مقروءةً بأسمائها المحفوظة؛ والإضافةُ تنتظر التعريفات.
    }
  }

  Future<void> _loadTasks() async {
    try {
      final d = await Api.instance.get(
          '/api/jp/tasks?scope=section&section=customs&linkKind=clearance&linkRef=${widget.clearanceId}');
      if (mounted) setState(() => _tasks = _maps(d['tasks']));
    } catch (_) {
      // الخطّةُ لفريق القسم ومديره — ومَن ليس منهم لا يرى قسمَها هنا أصلًا.
      if (mounted) setState(() => _tasks = null);
    }
  }

  /// أسعارُ عقد العميل لهذه المعاملة — تُقرأ من جديد حين يتغيّر العميلُ أو عددُ الوحدات.
  Future<void> _loadContract({bool force = false}) async {
    final key = '${_c?['customerParty'] ?? ''}|${_c?['containerCount'] ?? ''}';
    if (!force && key == _contractKey && _contractLoaded) return;
    _contractKey = key;
    try {
      final d = await Api.instance.get('/api/customs-clearance/${widget.clearanceId}/contract-pricing');
      if (mounted) setState(() { _contract = d['contract'] is Map ? Map<String, dynamic>.from(d['contract']) : null; _contractLoaded = true; });
    } catch (_) {
      // الشريطُ زيادةٌ على البطاقة — تعذُّره لا يُعلَن، ويُعاد السؤالُ في القراءة التالية.
      _contractKey = '';
    }
  }

  /// «تعبئة من العقد»: يكتب الخادمُ أسعارَ العقد في خانات الإيراد كلِّها، وباختيار
  /// وجهةٍ يُكتب سعرُ النقل من الميناء إلى العميل بحسبها.
  Future<void> _applyContract({String? from, String? to}) async {
    final r = await _send(
      () => Api.instance.post('/api/customs-clearance/${widget.clearanceId}/apply-contract',
          {if (from != null) 'from': from, if (to != null) 'to': to}),
      ok: tr('عُبّئت الإيرادات من العقد', 'Revenue filled from the contract'),
    );
    if (r != null && mounted && _m(r)['contract'] is Map) {
      setState(() => _contract = _m(_m(r)['contract']));
    }
  }

  /// رقمُ كشف التخريج يُكتب على الوحدة حين تُنقَل بسيّارة الشركة، وهو نفسُه في
  /// سير عمل التشغيل — فيُقال أمرتبطٌ هو أم لا. والتلميحُ زيادة: تعذُّره لا يُعلَن.
  Future<void> _checkSheets() async {
    final refs = <String>{
      for (final u in _maps(_c?['containers']))
        for (final mv in _maps(u['moves']))
          if (mv['vehicleKind'] == 'energize' && '${mv['ref'] ?? ''}'.trim().isNotEmpty) '${mv['ref']}'.trim(),
    };
    final key = (refs.toList()..sort()).join(',');
    if (key == _sheetsKey) return;
    if (refs.isEmpty) { _sheetsKey = ''; if (mounted) setState(() => _sheets = null); return; }
    try {
      final d = await Api.instance.get('/api/customs-clearance/release-sheets?numbers=${Uri.encodeQueryComponent(key)}');
      if (mounted) setState(() { _sheets = _m(d['found']); _sheetsKey = key; });
    } catch (_) {}
  }

  void _say(String msg) {
    if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg)));
  }

  /// نداءُ كتابةٍ واحد: يُنفَّذ، تُعاد القراءة، وتُعرَض رسالةُ الخادم إن رفض.
  /// يردّ جسمَ الردّ، أو null إن تعذّر.
  Future<dynamic> _send(Future<dynamic> Function() call, {String? ok}) async {
    if (_saving) return null;
    setState(() => _saving = true);
    try {
      final r = await call();
      await _load();
      if (ok != null) _say(ok);
      return r ?? const {};
    } catch (e) {
      _say(e.toString());
      return null;
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Future<void> _patch(Map<String, dynamic> body, String okMsg) =>
      _send(() => Api.instance.put('/api/customs-clearance/${widget.clearanceId}', body), ok: okMsg);

  Future<bool> _confirm(String title, String body, {required String action, bool danger = true}) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: Text(title),
        content: Text(body),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: Text(tr('إلغاء', 'Cancel'))),
          FilledButton(
            style: danger ? FilledButton.styleFrom(backgroundColor: T.danger) : null,
            onPressed: () => Navigator.pop(c, true),
            child: Text(action),
          ),
        ],
      ),
    );
    return ok == true;
  }

  /// تعليمُ مرحلةٍ أو رفعُ علامتها — والقواعدُ في الخادم (PATCH /:id/stage):
  /// ما يُرفَض يعود برسالته فتُعرَض كما هي.
  ///
  /// `unit`: رقمُ صفّ الوحدة (من صفر) أو 'all' لمراحل النقل وما بعده — وهي
  /// تُتابَع لكلّ حاويةٍ على حدة. والمراحلُ التي قبل النقل تُرسَل بلا `unit`.
  Future<void> _setStage(String key, bool done, {Object? unit}) async {
    if (!done && (key == 'transport_to_yard' || key == 'transport_to_customer')) {
      final ok = await _confirm(
        tr('رفع علامة المرحلة', 'Untick stage'),
        tr('رفعُ علامة هذه المرحلة يعيد فتح اختيار طريق النقل، ويرفع ما بُني عليه من مراحل الساحة.',
            'Unticking reopens the route choice and clears the yard stages built on it.'),
        action: tr('رفع العلامة', 'Untick'),
      );
      if (!ok) return;
    }
    await _send(
      () => Api.instance.patch('/api/customs-clearance/${widget.clearanceId}/stage', {'key': key, 'done': done, if (unit != null) 'unit': unit}),
      ok: tr('تم تحديث المرحلة', 'Stage updated'),
    );
  }

  /// إصدارُ فاتورة العميل. وفاتورةُ النقل ليست شرطًا لها: تصدر الفاتورةُ بما هو
  /// معروف، وتُنهى المعاملةُ وحدَها حين تُرفَق فاتورةُ النقل.
  Future<void> _issueInvoice() async {
    if (_saving) return;
    List<Map<String, dynamic>> defs;
    setState(() => _saving = true);
    try {
      final d = await Api.instance.get('/api/customs-clearance/${widget.clearanceId}/invoice');
      defs = _maps(d['saleItemDefs']);
    } catch (e) {
      _say(e.toString());
      return;
    } finally {
      if (mounted) setState(() => _saving = false);
    }
    if (!mounted) return;
    final items = await showModalBottomSheet<List<Map<String, dynamic>>>(
      context: context,
      isScrollControlled: true,
      builder: (_) => _InvoiceSheet(
        defs: defs, existing: _maps(_c?['saleItems']),
        transportReceived: _c?['transportInvoiceReceived'] == true,
      ),
    );
    if (items == null) return;
    final r = await _send(() =>
        Api.instance.patch('/api/customs-clearance/${widget.clearanceId}/invoice', {'saleItems': items}));
    if (r == null) return;
    final no = '${_m(_m(r)['clearance'])['saleInvoiceNumber'] ?? ''}';
    _say(_m(r)['closed'] == true
        ? tr('صدرت الفاتورة $no وأُنهيت المعاملة', 'Invoice $no issued — transaction closed')
        : tr('صدرت الفاتورة $no — بانتظار فاتورة النقل', 'Invoice $no issued — awaiting the transport invoice'));
  }

  Future<void> _attachTransportInvoice() async {
    final picked = await pickFileAsDataUrl();
    if (picked == null || !mounted) return;
    final r = await _send(() => Api.instance.post('/api/customs-clearance/${widget.clearanceId}/transport-invoice',
        {'dataUrl': picked.dataUrl, 'fileName': picked.fileName}));
    if (r == null) return;
    _say(_m(r)['closed'] == true
        ? tr('أُرفقت فاتورة النقل وأُنهيت المعاملة', 'Transport invoice attached — transaction closed')
        : tr('أُرفقت فاتورة النقل', 'Transport invoice attached'));
  }

  Future<void> _noTransportInvoice() async {
    final ok = await _confirm(
      tr('لا فاتورة نقل لهذه المعاملة', 'No transport invoice'),
      tr('تُسجَّل المعاملةُ على أنّها لا تنتظر فاتورةَ ناقل، فتُنهى في الحال.',
          'The transaction is recorded as not awaiting a carrier invoice and closes at once.'),
      action: tr('تأكيد', 'Confirm'),
      danger: false,
    );
    if (!ok) return;
    final r = await _send(() => Api.instance
        .post('/api/customs-clearance/${widget.clearanceId}/transport-invoice', {'notRequired': true}));
    if (r != null && _m(r)['closed'] == true) _say(tr('أُنهيت المعاملة', 'Transaction closed'));
  }

  Future<void> _reopen() async {
    final ok = await _confirm(
      tr('إعادة فتح المعاملة', 'Reopen transaction'),
      tr('تعود المعاملةُ إلى قوائم المتابعة، وتبقى فاتورتُها كما صدرت.',
          'The transaction returns to the follow-up lists; its invoice stays as issued.'),
      action: tr('إعادة الفتح', 'Reopen'),
      danger: false,
    );
    if (!ok) return;
    await _send(
      () => Api.instance.patch('/api/customs-clearance/${widget.clearanceId}/complete', {'completed': false}),
      ok: tr('أُعيد فتح المعاملة', 'Transaction reopened'),
    );
  }

  /// بيانُ وحدةٍ واحدة: رقمُها وتاريخُ إرجاعها وسيّارةُ كلّ مرحلةِ نقلٍ أُنجزت.
  /// والحفظُ بالمصفوفة كاملةً — الخادمُ يكتب `containers` كما تصله.
  Future<void> _editUnit(int i, List<Map<String, dynamic>> units, List<String> legs, String cargo) async {
    final next = await showModalBottomSheet<Map<String, dynamic>>(
      context: context,
      isScrollControlled: true,
      builder: (_) => _UnitSheet(unit: units[i], index: i, cargo: cargo, legs: legs),
    );
    if (next == null) return;
    final all = [...units]..[i] = next;
    await _patch({'containers': all}, tr('حُفظت بيانات الوحدة', 'Unit saved'));
  }

  /// ملاحظةٌ جديدة — تُضاف إلى السجلّ ولا تمحو ما قبلها.
  Future<void> _addNote() async {
    final text = _note.text.trim();
    if (text.isEmpty) return;
    final r = await _send(
      () => Api.instance.post('/api/customs-clearance/${widget.clearanceId}/notes', {'text': text}),
      ok: tr('أُضيفت الملاحظة', 'Note added'),
    );
    if (r != null) _note.clear();
  }

  String _when(dynamic v) {
    final d = DateTime.tryParse('${v ?? ''}');
    if (d == null) return '';
    final l = d.toLocal();
    return '${l.day.toString().padLeft(2, '0')}/${l.month.toString().padLeft(2, '0')}/${l.year} ${l.hour.toString().padLeft(2, '0')}:${l.minute.toString().padLeft(2, '0')}';
  }

  num _nz(Map<String, dynamic> m, String k) {
    final v = m[k];
    return v is num ? v : num.tryParse(v?.toString() ?? '') ?? 0;
  }

  String _money(dynamic v) {
    final n = (v is num) ? v : num.tryParse(v?.toString() ?? '') ?? 0;
    return n.toStringAsFixed(0).replaceAllMapped(RegExp(r'\B(?=(\d{3})+(?!\d))'), (m) => ',');
  }

  @override
  Widget build(BuildContext context) {
    final c = _c ?? {};
    // ── الدورةُ كما حسبها الخادم ───────────────────────────────────────────
    // ما أُنجز وما أُغلِق والنسبةُ تُقرأ من `pipeline` — لا تُشتقّ هنا: القاعدةُ
    // (طريقان يتنافيان، ومراحلُ ليست من طريق المعاملة) واحدةٌ في الخادم.
    final pipeline = _m(c['pipeline']);
    final steps = _maps(pipeline['steps']);
    final cargo = (c['cargoType'] ?? 'containers').toString();
    final vehicles = cargo == 'vehicles';
    final nextKey = (pipeline['next'] ?? '').toString();
    final units = _maps(c['containers']);
    final stageDone = _m(c['stageDone']);
    final stageDates = _m(c['stageDates']);
    final costs = _m(c['costs']);
    final documents = _m(c['documents']);
    final notes = _maps(c['notesLog']);
    final revenue = _m(c['revenue']);
    final attachments = _maps(c['attachments']);
    final payments = _maps(c['paymentStages']);
    final totalCost = _costItems.fold<num>(0, (s, it) => s + _nz(costs, it.$1));
    final invoiceNo = (c['saleInvoiceNumber'] ?? '').toString();
    final cancelled = c['cancelled'] == true;
    final completed = c['isCompleted'] == true;
    // فُوترت ولم تُنهَ: تنتظر فاتورةَ النقل (awaitsTransportInvoice في الخادم).
    final awaiting = invoiceNo.isNotEmpty && !completed && !cancelled && c['transportInvoiceReceived'] != true;
    // من النقل فما بعده تُتابَع المراحلُ لكلّ وحدة: `units[i].steps` مراحلُها هي،
    // و`steps` في مستوى المعاملة مجموعُها (unitsDone/unitsOf).
    final perUnit = pipeline['perUnit'] == true;
    final pUnits = _maps(pipeline['units']);
    Map<String, dynamic>? pUnit(int i) => pUnits.where((u) => u['index'] == i).firstOrNull;
    // مراحلُ النقل المنجَزةُ لهذه الوحدة — عنها يُسأل أيُّ سيّارةٍ نقلتها.
    List<String> doneLegs(int i) => [
          for (final s in (perUnit ? _maps(pUnit(i)?['steps']) : steps))
            if (_transportLegs.contains(s['key']) && s['done'] == true) '${s['key']}',
        ];
    final sel = perUnit && pUnit(_unitSel) != null ? _unitSel : -1;
    final baseSteps = perUnit ? steps.where((x) => x['perUnit'] != true && x['key'] != 'invoiced').toList() : steps;
    final unitSteps = !perUnit ? const <Map<String, dynamic>>[]
        : sel < 0 ? steps.where((x) => x['perUnit'] == true).toList() : _maps(pUnit(sel)?['steps']);
    final lastSteps = perUnit ? steps.where((x) => x['key'] == 'invoiced').toList() : const <Map<String, dynamic>>[];
    Widget stepRow(Map<String, dynamic> st, {required bool last, Object? unit, String? next}) => _stepRow(
          st, cargo: cargo, last: last, unit: unit,
          isNext: '${st['key']}' == (next ?? nextKey) && !completed && !cancelled,
          enabled: !cancelled, canInvoice: c['upcoming'] != true,
        );
    String unitName(int i) {
      final no = i < units.length ? '${units[i]['containerNumber'] ?? ''}'.trim() : '';
      return no.isNotEmpty ? no : '${vehicles ? tr('السيّارة', 'Vehicle') : tr('الحاوية', 'Container')} ${_arDigits(i + 1)}';
    }
    // أُغلقت ولم تصدر فاتورتُها — تُفوتَر وهي مغلقة.
    final closedNotInvoiced = completed && invoiceNo.isEmpty && !steps.any((x) => x['key'] == 'invoiced' && x['done'] == true);
    // أوّلُ اسمِ كلّ ملفٍّ يُنزَّل: رقمُ البوليصة، وإلّا رقمُ المعاملة.
    final fileBase = '${c['blNumber'] ?? ''}'.trim().isNotEmpty ? '${c['blNumber']}'.trim() : '${c['refNumber'] ?? widget.ref}';
    String attTitle(Map<String, dynamic> a) {
      final t = '${a['title'] ?? ''}'.trim();
      if (t.isNotEmpty) return t;
      final st = '${a['stage'] ?? ''}';
      return st.isNotEmpty ? customsStageLabel(st, cargo) : '${a['fileName'] ?? ''}'.replaceAll(RegExp(r'\.[^.]+$'), '');
    }
    final attTotals = <String, int>{};
    for (final a in attachments) { attTotals[attTitle(a)] = (attTotals[attTitle(a)] ?? 0) + 1; }
    final attSeen = <String, int>{};

    return AppScaffold(
      title: Text('${tr('تخليص', 'Clearance')} ${widget.ref}'),
      body: _loading
          ? ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(height: 120), SizedBox(height: 10), Shimmer(height: 220)])
          : _error != null
              ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
              : RefreshIndicator(
                  onRefresh: () { _sheetsKey = ''; _loadTasks(); return _load(); },
                  child: ListView(padding: const EdgeInsets.all(14), children: [
                    // ── معلومات أساسية ──
                    FadeSlideIn(
                      child: AppCard(
                        topAccent: cancelled ? T.danger : completed ? T.success : T.navy,
                        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          Text((c['customerName'] ?? '—').toString(), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
                          const SizedBox(height: 8),
                          Wrap(spacing: 6, runSpacing: 6, children: [
                            if ((c['blNumber'] ?? '').toString().isNotEmpty) Chip2('BL: ${c['blNumber']}', T.navy),
                            Chip2(c['branch'] == 'dammam' ? tr('الدمام', 'Dammam') : tr('جدة', 'Jeddah'), T.info),
                            if (c['containerCount'] != null)
                              Chip2('${c['containerCount']} ${vehicles ? tr('سيّارة', 'vehicles') : tr('حاوية', 'containers')}', T.violet),
                            if ((c['shippingAgent'] ?? '').toString().isNotEmpty) Chip2(c['shippingAgent'].toString(), T.cyan, icon: Icons.directions_boat_outlined),
                            if (invoiceNo.isNotEmpty) Chip2('${tr('مفوترة', 'Invoiced')} · $invoiceNo', T.navy, icon: Icons.receipt_long_outlined),
                            if (completed) Chip2(tr('مُقفلة', 'Closed'), T.success),
                            if (closedNotInvoiced) Chip2(tr('لم تُفوتَر', 'Not invoiced'), T.danger, icon: Icons.error_outline),
                            if (cancelled) Chip2(tr('ملغاة', 'Cancelled'), T.danger),
                          ]),
                        ]),
                      ),
                    ),
                    const SizedBox(height: 12),
                    // ── بانتظار فاتورة النقل ──
                    // بالأحمر حتى لا تُنسى: الفاتورةُ صدرت والمعاملةُ لم تُنهَ.
                    if (awaiting) ...[
                      Container(
                        padding: const EdgeInsets.all(12),
                        decoration: BoxDecoration(
                          color: T.danger.withValues(alpha: 0.07),
                          borderRadius: BorderRadius.circular(16),
                          border: Border.all(color: T.danger.withValues(alpha: 0.45)),
                        ),
                        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                            const Icon(Icons.error_outline, color: T.danger, size: 20),
                            const SizedBox(width: 8),
                            Expanded(
                              child: Text(
                                tr('صدرت الفاتورة $invoiceNo — بانتظار فاتورة النقل', 'Invoice $invoiceNo issued — awaiting the transport invoice'),
                                style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13, color: T.danger),
                              ),
                            ),
                          ]),
                          const SizedBox(height: 8),
                          Wrap(spacing: 8, runSpacing: 4, children: [
                            FilledButton.icon(
                              style: FilledButton.styleFrom(backgroundColor: T.danger),
                              onPressed: _saving ? null : _attachTransportInvoice,
                              icon: const Icon(Icons.attach_file_rounded, size: 16),
                              label: Text(tr('إرفاق فاتورة النقل', 'Attach transport invoice')),
                            ),
                            TextButton(
                              onPressed: _saving ? null : _noTransportInvoice,
                              child: Text(tr('لا فاتورة نقل لهذه المعاملة', 'No transport invoice for this one'),
                                  style: const TextStyle(color: T.danger)),
                            ),
                          ]),
                        ]),
                      ),
                      const SizedBox(height: 12),
                    ],
                    // ── الفوترة والإنهاء فعلان ──
                    if (completed)
                      Align(
                        alignment: AlignmentDirectional.centerStart,
                        child: OutlinedButton.icon(
                          onPressed: _saving ? null : _reopen,
                          icon: const Icon(Icons.lock_open_outlined, size: 16),
                          label: Text(tr('إعادة الفتح', 'Reopen')),
                        ),
                      ),
                    if (closedNotInvoiced || (!completed && !cancelled && c['upcoming'] != true))
                      SizedBox(
                        width: double.infinity,
                        child: FilledButton.icon(
                          onPressed: _saving ? null : _issueInvoice,
                          icon: const Icon(Icons.receipt_long_outlined, size: 18),
                          label: Text(invoiceNo.isEmpty
                              ? tr('إصدار الفاتورة', 'Issue invoice')
                              : tr('تعديل بنود الفاتورة $invoiceNo', 'Edit invoice $invoiceNo')),
                        ),
                      ),
                    if (completed || (!cancelled && c['upcoming'] != true)) const SizedBox(height: 12),
                    // ── مسار المراحل ──
                    FadeSlideIn(
                      delayMs: 40,
                      child: AppCard(
                        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          Row(children: [
                            Text(tr('مسار التخليص', 'Clearance pipeline'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14)),
                            const Spacer(),
                            Text('${pipeline['done'] ?? 0}/${pipeline['total'] ?? 0} · ${pipeline['percent'] ?? 0}%',
                                style: const TextStyle(fontWeight: FontWeight.w800, color: T.navy)),
                          ]),
                          const SizedBox(height: 8),
                          ClipRRect(
                            borderRadius: BorderRadius.circular(6),
                            child: LinearProgressIndicator(
                              value: (_nz(pipeline, 'percent') / 100).clamp(0, 1).toDouble(), minHeight: 6,
                              backgroundColor: T.inkFaint.withValues(alpha: 0.12), color: T.success),
                          ),
                          const SizedBox(height: 10),
                          for (final e in baseSteps.asMap().entries)
                            stepRow(e.value, last: !perUnit && e.key == baseSteps.length - 1),
                          if (perUnit) ...[
                            const SizedBox(height: 10),
                            Text(vehicles ? tr('النقلُ وما بعده — لكلّ سيّارة', 'Transport onward — per vehicle') : tr('النقلُ وما بعده — لكلّ حاوية', 'Transport onward — per container'),
                                style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13)),
                            if (pipeline['mixedRoutes'] == true)
                              Text(tr('الوحداتُ سلكت طرقًا مختلفة — اختر وحدةً لترى مراحلَها.', 'Units took different routes — pick one to see its stages.'),
                                  style: const TextStyle(fontSize: 11, color: T.warn)),
                            const SizedBox(height: 6),
                            Wrap(spacing: 6, runSpacing: 2, children: [
                              ChoiceChip(
                                label: Text(tr('الكلّ معًا', 'All together'), style: const TextStyle(fontSize: 12)),
                                selected: sel < 0,
                                onSelected: (_) => setState(() => _unitSel = -1),
                              ),
                              for (final u in pUnits)
                                ChoiceChip(
                                  label: Text('${unitName(_nz(u, 'index').toInt())} · ${_nz(u, 'percent').toInt()}%', style: const TextStyle(fontSize: 12)),
                                  selected: sel == u['index'],
                                  onSelected: (_) => setState(() => _unitSel = _nz(u, 'index').toInt()),
                                ),
                            ]),
                            const SizedBox(height: 8),
                            for (final st in unitSteps)
                              stepRow(st, last: false, unit: sel < 0 ? 'all' : sel, next: sel < 0 ? null : '${pUnit(sel)?['next'] ?? ''}'),
                            for (final st in lastSteps) stepRow(st, last: true),
                          ],
                        ]),
                      ),
                    ),
                    const SizedBox(height: 12),
                    // ── الوحدات: حاوياتٌ أو سيّارات ──
                    // خانةٌ لكلّ وحدةٍ بعدد المعاملة (يفتحها الخادم — syncUnits)،
                    // تُلمَس فيُكتب رقمُها وتاريخُ إرجاعها وبيانُ نقلها.
                    if (units.isNotEmpty) ...[
                      FadeSlideIn(
                        delayMs: 60,
                        child: AppCard(
                          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                            Text('${vehicles ? tr('السيّارات', 'Vehicles') : tr('الحاويات', 'Containers')} (${units.length})',
                                style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14)),
                            const SizedBox(height: 8),
                            for (final e in units.asMap().entries) _unitCard(e.key, units, doneLegs(e.key), cargo, perUnit ? pUnit(e.key) : null),
                          ]),
                        ),
                      ),
                      const SizedBox(height: 12),
                    ],
                    // ── مهام الإنجاز ──
                    FadeSlideIn(
                      delayMs: 80,
                      child: AppCard(
                        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          Text(tr('مهام الإنجاز', 'Completion tasks'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14)),
                          const SizedBox(height: 6),
                          ..._stageDoneItems.map((it) {
                            final done = stageDone[it.$1] == true;
                            final date = (stageDates[it.$1] ?? '').toString();
                            return CheckboxListTile(
                              contentPadding: EdgeInsets.zero,
                              dense: true,
                              controlAffinity: ListTileControlAffinity.leading,
                              value: done,
                              onChanged: _saving ? null : (v) => _patch({
                                'stageDone': {it.$1: v},
                                if (v == true && date.isEmpty)
                                  'stageDates': {it.$1: DateTime.now().toIso8601String().split('T').first},
                              }, tr('تم التحديث', 'Updated')),
                              title: Text(tr(it.$2, it.$3), style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600)),
                              subtitle: date.isNotEmpty ? Text(date, style: const TextStyle(fontSize: 10.5, color: T.inkFaint)) : null,
                            );
                          }),
                        ]),
                      ),
                    ),
                    const SizedBox(height: 12),
                    // ── مستندات البوليصة ──
                    FadeSlideIn(
                      delayMs: 90,
                      child: AppCard(
                        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          Text(tr('المستندات', 'Documents'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14)),
                          const SizedBox(height: 6),
                          ..._documentItems.map((it) => CheckboxListTile(
                                contentPadding: EdgeInsets.zero,
                                dense: true,
                                controlAffinity: ListTileControlAffinity.leading,
                                value: documents[it.$1] == true,
                                onChanged: _saving ? null : (v) => _patch({'documents': {it.$1: v}}, tr('تم التحديث', 'Updated')),
                                title: Text(tr(it.$2, it.$3), style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600)),
                              )),
                        ]),
                      ),
                    ),
                    const SizedBox(height: 12),
                    // (رُفعت «أوراق الوكيل» بطلب القسم — تتكرّر مع المستندات أعلاه.)
                    // ── الملاحظات ──
                    FadeSlideIn(
                      delayMs: 105,
                      child: AppCard(
                        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          Row(children: [
                            Text(tr('الملاحظات', 'Notes'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14)),
                            const Spacer(),
                            if (notes.isNotEmpty) Text('${notes.length}', style: const TextStyle(fontSize: 11, color: T.inkFaint)),
                          ]),
                          const SizedBox(height: 6),
                          // سطرٌ يُضاف لا خانةٌ تُدهَس: لكلّ ملاحظةٍ صاحبُها ووقتُها،
                          // وأحدثُها هي التي تظهر في الجدول. راجع notesLog في الخادم.
                          Row(children: [
                            Expanded(
                              child: TextField(
                                controller: _note,
                                minLines: 1,
                                maxLines: 3,
                                decoration: InputDecoration(hintText: tr('اكتب ملاحظة…', 'Write a note…'), isDense: true),
                              ),
                            ),
                            const SizedBox(width: 8),
                            FilledButton(
                              onPressed: _saving ? null : _addNote,
                              child: Text(tr('إضافة', 'Add')),
                            ),
                          ]),
                          const SizedBox(height: 8),
                          if (notes.isEmpty && '${c['notes'] ?? ''}'.isEmpty)
                            Text(tr('لا ملاحظات بعد', 'No notes yet'), style: const TextStyle(fontSize: 12, color: T.inkFaint))
                          else
                            ...notes.reversed.map((nt) => Container(
                                  width: double.infinity,
                                  margin: const EdgeInsets.only(bottom: 6),
                                  padding: const EdgeInsets.all(10),
                                  decoration: BoxDecoration(color: T.canvas, borderRadius: BorderRadius.circular(10)),
                                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                    Text('${nt['text'] ?? ''}', style: const TextStyle(fontSize: 12.5)),
                                    const SizedBox(height: 3),
                                    Text('${nt['byName'] ?? ''} · ${_when(nt['at'])}',
                                        style: const TextStyle(fontSize: 10.5, color: T.inkFaint)),
                                  ]),
                                )),
                          if ('${c['notes'] ?? ''}'.isNotEmpty)
                            Container(
                              width: double.infinity,
                              padding: const EdgeInsets.all(10),
                              decoration: BoxDecoration(
                                borderRadius: BorderRadius.circular(10),
                                border: Border.all(color: T.line),
                              ),
                              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                Text('${c['notes'] ?? ''}', style: const TextStyle(fontSize: 12)),
                                const SizedBox(height: 3),
                                Text(tr('ملاحظة قديمة (قبل سجلّ الملاحظات)', 'Older note (before the notes log)'),
                                    style: const TextStyle(fontSize: 10.5, color: T.inkFaint)),
                              ]),
                            ),
                        ]),
                      ),
                    ),
                    const SizedBox(height: 12),
                    // ── مهامّ خطّة العمل المرتبطة بالمعاملة ──
                    if (_tasks != null) ...[
                      AppCard(
                        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          Row(children: [
                            Text(tr('مهامّ خطّة العمل', 'Work-plan tasks'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14)),
                            const Spacer(),
                            if (_tasks!.isNotEmpty) Text('${_tasks!.length}', style: const TextStyle(fontSize: 11, color: T.inkFaint)),
                          ]),
                          const SizedBox(height: 6),
                          if (_tasks!.isEmpty)
                            Text(tr('لا مهامّ مرتبطة بهذه المعاملة', 'No tasks linked to this transaction'),
                                style: const TextStyle(fontSize: 12, color: T.inkFaint)),
                          for (final t in _tasks!) _taskRow(t),
                        ]),
                      ),
                      const SizedBox(height: 12),
                    ],
                    // ── التكاليف ──
                    FadeSlideIn(
                      delayMs: 120,
                      child: AppCard(
                        topAccent: T.orange,
                        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          Row(children: [
                            Text(tr('التكاليف', 'Costs'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14)),
                            const Spacer(),
                            IconButton(icon: const Icon(Icons.edit_outlined, size: 18, color: T.navy), onPressed: () => _editCosts(costs)),
                          ]),
                          ..._costItems.where((it) => (costs[it.$1] ?? 0) != 0).map((it) => Padding(
                            padding: const EdgeInsets.symmetric(vertical: 3),
                            child: Row(children: [
                              Expanded(child: Text(tr(it.$2, it.$3), style: const TextStyle(fontSize: 12.5))),
                              Text('${_money(costs[it.$1])} ${tr('ر.س', 'SAR')}', style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700)),
                            ]),
                          )),
                          const Divider(height: 18),
                          Row(children: [
                            Text(tr('الإجمالي', 'Total'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13.5)),
                            const Spacer(),
                            Text('${_money(totalCost)} ${tr('ر.س', 'SAR')}', style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 14, color: T.orange)),
                          ]),
                          const SizedBox(height: 6),
                          Text(tr('تُملأ البنود تلقائيًّا بمبلغ مرحلة السداد حين تؤكّد الإدارة المالية الدفع، وتبقى قابلة للتعديل.',
                                  'Lines fill automatically with the payment-stage amount once Finance confirms payment, and stay editable.'),
                              style: const TextStyle(fontSize: 11, color: T.inkFaint)),
                        ]),
                      ),
                    ),
                    const SizedBox(height: 12),
                    // ── الإيراد والفاتورة ──
                    // في التخليص لا تُباع الرسوم بل تُمرَّر: ما دُفع للموانى
                    // والجمارك يُسترد كما هو. والفاتورةُ محسوبةٌ لا مكتوبة.
                    // (صافي الربح وهامشُه رُفعا من تفاصيل المعاملة بطلب صاحب
                    //  الشركة — موضعُهما «تحليلات قسم التخليص» وهي للإدارة.)
                    FadeSlideIn(
                      delayMs: 140,
                      child: AppCard(
                        topAccent: T.navy,
                        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          Row(children: [
                            Text(tr('الإيراد والفاتورة', 'Revenue & invoice'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14)),
                            const Spacer(),
                            IconButton(icon: const Icon(Icons.edit_outlined, size: 18, color: T.navy), onPressed: () => _editMargin(revenue, costs)),
                          ]),
                          _contractStrip(canEditCustoms(context)),
                          for (final it in _marginItems.where((it) => _nz(revenue, it.$1) != 0)) ...[
                            Padding(
                              padding: const EdgeInsets.symmetric(vertical: 3),
                              child: Row(children: [
                                Expanded(child: Text(tr(it.$2, it.$3), style: const TextStyle(fontSize: 12.5))),
                                Text('${_money(_nz(revenue, it.$1))} ${tr('ر.س', 'SAR')}', style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700)),
                              ]),
                            ),
                            if (it.$1 == 'clearanceFee') _clearanceFeeNote,
                          ],
                          if (revenue['totalInvoiced'] != null) ...[
                            const Divider(height: 18),
                            Row(children: [
                              Text(tr('إجمالي الفاتورة', 'Total invoiced'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13.5)),
                              const Spacer(),
                              Text('${_money(revenue['totalInvoiced'])} ${tr('ر.س', 'SAR')}', style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 14, color: T.navy)),
                            ]),
                          ],
                        ]),
                      ),
                    ),
                    const SizedBox(height: 12),
                    // ── مراحل السداد ──
                    // إدخالٌ لكلّ مرّة: المرحلةُ نفسُها قد تُسدَّد على دفعات،
                    // فتُرقَّم ليُعرَف أيُّها هذا.
                    if (payments.isNotEmpty || _payDefs.isNotEmpty) ...[
                      AppCard(
                        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          Text('${tr('مراحل السداد', 'Payment stages')} (${payments.length})',
                              style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14)),
                          const SizedBox(height: 6),
                          ..._paymentGroups(payments, fileBase),
                        ]),
                      ),
                      const SizedBox(height: 12),
                    ],
                    // أطرافُ المعاملة لا تُعرض هنا — ملفّاتُهم في صفحاتهم (العملاء · الوكلاء · الناقلون).
                    // ── المرفقات ──
                    // ورقُ كلِّ مرحلةٍ موسومًا بها، يُفتح ويُنزَّل من الجوّال
                    // كما من الويب: من في الميناء أحوجُ إليه ممّن في المكتب.
                    FadeSlideIn(
                      delayMs: 160,
                      child: AppCard(
                        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          Row(children: [
                            Text('${tr('المرفقات', 'Attachments')} (${attachments.length})', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14)),
                            const Spacer(),
                            TextButton.icon(onPressed: _saving ? null : _uploadAttachment, icon: const Icon(Icons.attach_file_rounded, size: 16), label: Text(tr('إرفاق', 'Attach'))),
                          ]),
                          if (attachments.isEmpty)
                            Padding(
                              padding: const EdgeInsets.symmetric(vertical: 8),
                              child: Text(tr('لا مرفقات بعد. اختر المرحلة ثمّ أرفق ورقَها.', 'No attachments yet. Pick a stage, then attach its paperwork.'),
                                  style: const TextStyle(color: T.inkFaint, fontSize: 12.5)),
                            ),
                          ...attachments.map((att) {
                            final st = (att['stage'] ?? '').toString();
                            final stLabel = st.isEmpty ? tr('عامّ', 'General') : customsStageLabel(st, cargo);
                            final title = attTitle(att);
                            final nth = attSeen[title] = (attSeen[title] ?? 0) + 1;
                            final url = customsFileUrl(att['fileUrl'], base: fileBase, title: title,
                                n: (attTotals[title] ?? 0) > 1 ? nth : 0, fileName: att['fileName']);
                            return Padding(
                              padding: const EdgeInsets.symmetric(vertical: 4),
                              child: Row(children: [
                                const Icon(Icons.description_outlined, size: 17, color: T.navy),
                                const SizedBox(width: 8),
                                Expanded(
                                  // لمسُ العنوان يفتح الملفَّ للعرض — كالعين بجانبه.
                                  child: InkWell(
                                    onTap: () => customsOpenFile(context, att['fileUrl']),
                                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                      Text((att['title'] ?? att['fileName'] ?? '—').toString(),
                                          style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700, color: T.navy), maxLines: 1, overflow: TextOverflow.ellipsis),
                                      Text(stLabel, style: const TextStyle(fontSize: 11, color: T.inkFaint)),
                                    ]),
                                  ),
                                ),
                                // فتحٌ للعرض (الصورةُ وPDF تُعرَضان) — والتنزيلُ بجانبه باسمه المرتَّب.
                                IconButton(visualDensity: VisualDensity.compact, icon: const Icon(Icons.visibility_outlined, size: 18, color: T.navy),
                                    tooltip: tr('فتح', 'Open'), onPressed: () => customsOpenFile(context, att['fileUrl'])),
                                IconButton(visualDensity: VisualDensity.compact, icon: const Icon(Icons.download_rounded, size: 18, color: T.orange),
                                    tooltip: tr('تنزيل', 'Download'), onPressed: () => _openFile(url)),
                                IconButton(visualDensity: VisualDensity.compact, icon: const Icon(Icons.delete_outline, size: 18, color: T.danger),
                                    onPressed: _saving ? null : () => _deleteAttachment(att)),
                              ]),
                            );
                          }),
                        ]),
                      ),
                    ),
                    const SizedBox(height: 20),
                  ]),
                ),
    );
  }

  /// سطرُ مرحلةٍ في المسار. `unit` تُرسَل مع التعليم لمراحل الوحدات ('all' أو
  /// رقمُ الصفّ)؛ والمجموعُ يحمل عدّادَه (unitsDone/unitsOf).
  Widget _stepRow(Map<String, dynamic> st, {
    required String cargo, required bool last, required bool isNext, required bool enabled, required bool canInvoice, Object? unit,
  }) {
    final key = '${st['key']}';
    final done = st['done'] == true;
    final locked = st['locked'] == true;
    // الطريقُ الآخرُ يُضغَط فيتحوّل الاختيارُ إليه — لا بابٌ موصد.
    final switchable = st['switchable'] == true;
    final of = st['unitsOf'] == null ? 0 : _nz(st, 'unitsOf').toInt();
    final got = _nz(st, 'unitsDone').toInt();
    final partial = of > 0 && got > 0 && got < of;
    // «إصدار الفاتورة» لا تُعلَّم بيد: تُعلَّم بإصدارها.
    final VoidCallback? onTap = _saving || (locked && !switchable) || !enabled
        ? null
        : key == 'invoiced'
            ? (done || !canInvoice ? null : _issueInvoice)
            : () => _setStage(key, !done, unit: st['perUnit'] == true || unit is int ? unit : null);
    return InkWell(
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 3),
        child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Column(children: [
            Container(
              width: 22, height: 22,
              decoration: BoxDecoration(
                color: done ? T.success : partial ? T.warn.withValues(alpha: 0.18) : locked ? T.inkFaint.withValues(alpha: 0.15) : Colors.transparent,
                shape: BoxShape.circle,
                border: Border.all(color: done ? T.success : partial ? T.warn : locked ? Colors.transparent : T.inkFaint, width: 2),
              ),
              child: done
                  ? const Icon(Icons.check, size: 13, color: Colors.white)
                  : locked && !switchable ? const Icon(Icons.lock_outline, size: 12, color: T.inkFaint) : null,
            ),
            if (!last)
              Container(width: 2, height: 20, color: done ? T.success.withValues(alpha: 0.4) : T.inkFaint.withValues(alpha: 0.25)),
          ]),
          const SizedBox(width: 10),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(
                customsStageLabel(key, cargo),
                style: TextStyle(
                  fontSize: 12.5,
                  fontWeight: isNext ? FontWeight.w900 : FontWeight.w600,
                  color: locked ? T.inkFaint : isNext ? T.navy : done ? T.ink : T.inkSoft,
                ),
              ),
              if (locked && '${st['reason'] ?? ''}'.isNotEmpty)
                Text('${st['reason']}', style: const TextStyle(fontSize: 10.5, color: T.inkFaint)),
            ]),
          ),
          if (of > 0 && !locked) Chip2('$got/$of', done ? T.success : partial ? T.warn : T.inkFaint),
          if (isNext) ...[const SizedBox(width: 4), Chip2(tr('التالية', 'Next'), T.navy)],
        ]),
      ),
    );
  }

  /// بطاقةُ الوحدة على هيئة حاوية: لوحةٌ برقمها، وتحتها ما كُتب عنها.
  Widget _unitCard(int i, List<Map<String, dynamic>> units, List<String> doneLegs, String cargo, Map<String, dynamic>? progress) {
    final vehicles = cargo == 'vehicles';
    // حالُ الوحدة من مراحلها هي (pipeline.units[i]).
    final waiting = '${progress?['next'] ?? ''}';
    final returned = _maps(progress?['steps']).any((x) => x['key'] == 'containers_returned' && x['done'] == true);
    final state = progress == null ? null
        : waiting.isNotEmpty ? ('${tr('تنتظر', 'Waiting')}: ${customsStageLabel(waiting, cargo)}', T.warn)
        : returned ? (tr('أُرجعت', 'Returned'), T.success) : (tr('اكتملت', 'Complete'), T.success);
    final u = units[i];
    final number = '${u['containerNumber'] ?? ''}'.trim();
    final moves = _maps(u['moves']);
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: InkWell(
        borderRadius: BorderRadius.circular(8),
        onTap: _saving ? null : () => _editUnit(i, units, doneLegs, cargo),
        child: Container(
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(8),
            border: Border.all(color: T.navy, width: 2),
          ),
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Container(
              color: T.navy,
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
              child: Row(children: [
                Icon(vehicles ? Icons.directions_car_filled_outlined : Icons.view_week_outlined, size: 15, color: Colors.white),
                const SizedBox(width: 6),
                Text('${vehicles ? tr('سيّارة', 'Vehicle') : tr('حاوية', 'Container')} ${_arDigits(i + 1)}',
                    style: const TextStyle(color: Colors.white70, fontSize: 11, fontWeight: FontWeight.w700)),
                const Spacer(),
                Text(number.isEmpty ? tr('بلا رقم', 'No number') : number,
                    textDirection: TextDirection.ltr,
                    style: TextStyle(color: number.isEmpty ? Colors.white54 : Colors.white, fontSize: 13.5, fontWeight: FontWeight.w900, letterSpacing: 1)),
                const SizedBox(width: 6),
                const Icon(Icons.edit_outlined, size: 14, color: Colors.white70),
              ]),
            ),
            if (!vehicles || doneLegs.isNotEmpty || state != null)
              Padding(
                padding: const EdgeInsets.fromLTRB(10, 7, 10, 8),
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  if (state != null)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 3),
                      child: Text(state.$1, style: TextStyle(fontSize: 12, fontWeight: FontWeight.w800, color: state.$2)),
                    ),
                  if (!vehicles) _returnBox(u),
                  for (final leg in doneLegs) _moveLine(leg, moves.where((x) => x['leg'] == leg).firstOrNull, cargo),
                ]),
              ),
          ]),
        ),
      ),
    );
  }

  /// إرجاعُ الحاوية: التاريخُ ومعه ما يُسأل عنه حين يطالب الوكيلُ بغرامة —
  /// المكانُ والإيصالُ والسيّارةُ ورقمُ كشفها أو فاتورتها.
  Widget _returnBox(Map<String, dynamic> u) {
    String s(String k) => '${u[k] ?? ''}'.trim();
    final date = s('returnDate');
    final kind = s('returnVehicleKind');
    final ref = s('returnRef');
    final returned = date.isNotEmpty;
    Widget row(String label, String value) => Padding(
          padding: const EdgeInsets.only(top: 2),
          child: Text.rich(TextSpan(children: [
            TextSpan(text: '$label: ', style: const TextStyle(color: T.inkFaint)),
            TextSpan(text: value.isEmpty ? '—' : value, style: const TextStyle(fontWeight: FontWeight.w700, color: T.ink)),
          ]), style: const TextStyle(fontSize: 11.5)),
        );
    return Container(
      margin: const EdgeInsets.only(top: 4),
      padding: const EdgeInsets.all(8),
      decoration: BoxDecoration(
        color: (returned ? T.success : T.inkFaint).withValues(alpha: 0.07),
        borderRadius: BorderRadius.circular(6),
        border: Border.all(color: (returned ? T.success : T.inkFaint).withValues(alpha: 0.3)),
      ),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          const Icon(Icons.undo_rounded, size: 14, color: T.orange),
          const SizedBox(width: 4),
          Text(tr('إرجاع الحاوية', 'Container return'), style: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.w800)),
        ]),
        row(tr('تاريخ الإرجاع', 'Return date'), date),
        if (s('returnDepot').isNotEmpty) row(tr('مكان الإرجاع', 'Returned to'), s('returnDepot')),
        if (s('returnReceipt').isNotEmpty) row(tr('رقم إيصال الإرجاع (EIR)', 'Return receipt (EIR)'), s('returnReceipt')),
        if (kind.isNotEmpty)
          row(kind == 'energize' ? tr('سيّارة تنشيط · رقم كشف التخريج', 'Energize truck · Release sheet') : tr('سيّارة خارجيّة · رقم كشف التخريج', 'External truck · Release sheet'), ref),
        if (s('returnNotes').isNotEmpty) row(tr('ملاحظات الإرجاع', 'Return notes'), s('returnNotes')),
      ]),
    );
  }

  Widget _moveLine(String leg, Map<String, dynamic>? move, String cargo) {
    final kind = '${move?['vehicleKind'] ?? ''}';
    final ref = '${move?['ref'] ?? ''}'.trim();
    final linked = kind == 'energize' && ref.isNotEmpty && _sheets != null ? _sheets!.containsKey(ref) : null;
    return Padding(
      padding: const EdgeInsets.only(top: 4),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(customsStageLabel(leg, cargo), style: const TextStyle(fontSize: 11, color: T.inkFaint)),
        Text(
          kind.isEmpty
              ? tr('لم تُحدَّد السيّارة', 'Vehicle not set')
              : kind == 'energize'
                  ? '${tr('سيّارة تنشيط', 'Energize vehicle')} · ${tr('رقم كشف التخريج', 'Release sheet')}: ${ref.isEmpty ? '—' : ref}'
                  : '${tr('سيّارة خارجيّة', 'External vehicle')} · ${tr('رقم كشف التخريج', 'Release sheet')}: ${ref.isEmpty ? '—' : ref}',
          style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: kind.isEmpty ? T.warn : T.ink),
        ),
        if (linked != null)
          Text(
            linked ? tr('مرتبط بسير عمل التشغيل', 'Linked to the operations workflow') : tr('غير موجود في سير عمل التشغيل', 'Not found in the operations workflow'),
            style: TextStyle(fontSize: 10.5, fontWeight: FontWeight.w700, color: linked ? T.success : T.danger),
          ),
      ]),
    );
  }

  Widget _taskRow(Map<String, dynamic> t) {
    final dl = jpDeadline(t);
    final done = t['status'] == 'done';
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Icon(done ? Icons.check_circle : Icons.radio_button_unchecked, size: 17, color: done ? T.success : T.inkFaint),
        const SizedBox(width: 8),
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text('${t['title'] ?? ''}',
                style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700, decoration: done ? TextDecoration.lineThrough : null)),
            Text('${t['assignedToName'] ?? ''} · ${dl.$1}', style: TextStyle(fontSize: 11, color: dl.$2)),
          ]),
        ),
      ]),
    );
  }

  /// الإدخالاتُ تحت تعريف مرحلتها: الاسمُ من التعريف الحيّ، وما حُذف تعريفُه
  /// يبقى مقروءًا باسمه المحفوظ على الإدخال — بلا «إضافة».
  List<Widget> _paymentGroups(List<Map<String, dynamic>> payments, String fileBase) {
    final known = {for (final d in _payDefs) '${d['key']}'};
    final groups = <(String?, String, List<Map<String, dynamic>>)>[
      for (final d in _payDefs)
        ('${d['key']}', tr('${d['nameAr'] ?? d['nameEn'] ?? d['key']}', '${d['nameEn'] ?? d['nameAr'] ?? d['key']}'),
            payments.where((p) => '${p['key']}' == '${d['key']}').toList()),
    ];
    for (final p in payments.where((p) => !known.contains('${p['key']}'))) {
      final name = '${p['label'] ?? p['key'] ?? ''}';
      final hit = groups.where((g) => g.$1 == null && g.$2 == name).firstOrNull;
      if (hit != null) { hit.$3.add(p); } else { groups.add((null, name, [p])); }
    }
    return [
      for (final g in groups) ...[
        Row(children: [
          Expanded(child: Text(g.$2, style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w800, color: g.$3.isEmpty ? T.inkSoft : T.ink))),
          if (g.$1 != null)
            TextButton.icon(
              style: TextButton.styleFrom(visualDensity: VisualDensity.compact),
              onPressed: _saving ? null : () => _editPayment(g.$2, key: g.$1),
              icon: const Icon(Icons.add, size: 16),
              label: Text(tr('إضافة', 'Add')),
            ),
        ]),
        for (final e in g.$3.asMap().entries) _paymentEntry(e.value, g.$2, g.$3.length > 1 ? e.key + 1 : 0, fileBase),
        const Divider(height: 10),
      ],
    ];
  }

  Widget _paymentEntry(Map<String, dynamic> p, String stage, int ordinal, String fileBase) {
    final (statusLabel, statusColor) = customsPayStatus(p['payStatus']);
    final proofs = _maps(p['proofFiles']);
    final proofTitle = '$stage - ${tr('إثبات الدفع', 'Payment proof')}';
    return Container(
      margin: const EdgeInsets.only(bottom: 6),
      padding: const EdgeInsetsDirectional.fromSTEB(10, 6, 2, 6),
      decoration: BoxDecoration(color: T.canvas, borderRadius: BorderRadius.circular(10)),
      child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Wrap(spacing: 6, runSpacing: 4, children: [
              if (ordinal > 0) Chip2(tr('الدفعة ${_arDigits(ordinal)}', 'Payment $ordinal'), T.navy),
              Chip2(statusLabel, statusColor),
            ]),
            const SizedBox(height: 3),
            Text([
              if ('${p['date'] ?? ''}'.isNotEmpty) '${p['date']}',
              if (p['amount'] != null) '${_money(p['amount'])} ${tr('ر.س', 'SAR')}',
              if ('${p['note'] ?? ''}'.isNotEmpty) '${p['note']}',
            ].join(' · '), style: const TextStyle(fontSize: 11.5, color: T.inkSoft)),
            if ('${p['decisionNote'] ?? ''}'.isNotEmpty)
              Text('${tr('ملاحظة الماليّة', 'Finance note')}: ${p['decisionNote']}', style: TextStyle(fontSize: 11.5, color: statusColor)),
            if ('${p['fileUrl'] ?? ''}'.isNotEmpty || proofs.isNotEmpty)
              Wrap(spacing: 4, children: [
                if ('${p['fileUrl'] ?? ''}'.isNotEmpty)
                  TextButton.icon(
                    style: TextButton.styleFrom(visualDensity: VisualDensity.compact, padding: EdgeInsets.zero),
                    onPressed: () => _openFile(customsFileUrl(p['fileUrl'], base: fileBase, title: stage, n: ordinal, fileName: p['fileName'])),
                    icon: const Icon(Icons.attach_file, size: 14),
                    label: Text(tr('المرفق', 'File'), style: const TextStyle(fontSize: 11.5)),
                  ),
                for (final f in proofs.asMap().entries)
                  TextButton.icon(
                    style: TextButton.styleFrom(visualDensity: VisualDensity.compact, padding: EdgeInsets.zero),
                    onPressed: () => _openFile(customsFileUrl(f.value['fileUrl'], base: fileBase, title: proofTitle,
                        n: proofs.length > 1 ? f.key + 1 : ordinal, fileName: f.value['fileName'])),
                    icon: const Icon(Icons.verified_outlined, size: 14, color: T.success),
                    label: Text(tr('إثبات الدفع', 'Payment proof'), style: const TextStyle(fontSize: 11.5, color: T.success)),
                  ),
              ]),
          ]),
        ),
        IconButton(visualDensity: VisualDensity.compact, icon: const Icon(Icons.edit_outlined, size: 17, color: T.navy),
            tooltip: tr('تعديل', 'Edit'), onPressed: _saving ? null : () => _editPayment(stage, entry: p)),
        IconButton(visualDensity: VisualDensity.compact, icon: const Icon(Icons.delete_outline, size: 18, color: T.danger),
            onPressed: _saving ? null : () => _deletePayment(p, stage, ordinal)),
      ]),
    );
  }

  /// إضافةُ إدخالٍ إلى مرحلة سداد (`key`) أو تعديلُ إدخالٍ قائم (`entry`).
  Future<void> _editPayment(String stage, {String? key, Map<String, dynamic>? entry}) async {
    final body = await showModalBottomSheet<Map<String, dynamic>>(
      context: context,
      isScrollControlled: true,
      builder: (_) => _PaymentSheet(
          stage: stage, entry: entry,
          amountRequired: customsCostMappedStages.contains(key ?? '${entry?['key'] ?? ''}')),
    );
    if (body == null) return;
    final path = '/api/customs-clearance/${widget.clearanceId}/payment-stages';
    await _send(
      () => entry == null ? Api.instance.post(path, {'key': key, ...body}) : Api.instance.put('$path/${entry['_id']}', body),
      ok: entry == null ? tr('أُضيف الإدخال', 'Entry added') : tr('حُفظ الإدخال', 'Entry saved'),
    );
  }

  static final Widget _clearanceFeeNote = Padding(
    padding: const EdgeInsets.only(bottom: 3),
    child: Text(tr('أجور التخليص = سعر الحاوية في العقد × عدد الحاويات', 'Clearance fee = contract price per container × containers'),
        style: const TextStyle(fontSize: 10.5, color: T.inkFaint)),
  );

  /// شريطُ عقد العميل أعلى «الإيراد والفاتورة»: اسمُ العقد، ووجهةُ النقل من الميناء
  /// إلى العميل، وزرُّ «تعبئة من العقد». يُقرأ للجميع، ويُعمَل به لمن يعدّل وحدَه.
  Widget _contractStrip(bool canEdit) {
    if (!_contractLoaded) return const SizedBox.shrink();
    final k = _contract;
    if (k == null) {
      return Padding(
        padding: const EdgeInsets.only(bottom: 6),
        child: Text(tr('لا يوجد عقد ساري بأسعار لهذا العميل', 'No active contract with prices for this customer'),
            style: const TextStyle(fontSize: 11.5, color: T.inkFaint)),
      );
    }
    final routes = _maps(_m(k['pricing'])['routes']);
    final cur = _m(k['route']);
    String rk(Map<String, dynamic> r) => '${r['from'] ?? ''}|${r['to'] ?? ''}';
    final curKey = cur.isEmpty ? null : rk(cur);
    final keys = {for (final r in routes) rk(r)};
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: T.navy.withValues(alpha: 0.05),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: T.navy.withValues(alpha: 0.2)),
      ),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          const Icon(Icons.assignment_outlined, size: 16, color: T.navy),
          const SizedBox(width: 6),
          Expanded(
            child: Text('${tr('من عقد العميل', 'From the customer contract')}: ${k['title'] ?? ''}',
                style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w800, color: T.navy)),
          ),
        ]),
        if (routes.isNotEmpty) ...[
          const SizedBox(height: 8),
          DropdownButtonFormField<String>(
            // المفتاحُ يعيد بناءَ الخانة حين يتغيّر العقدُ أو وجهتُه من الخادم.
            key: ValueKey('${k['_id']}|$curKey'),
            initialValue: curKey != null && keys.contains(curKey) ? curKey : null,
            isExpanded: true,
            isDense: true,
            decoration: InputDecoration(labelText: tr('وجهة النقل من الميناء إلى العميل', 'Port → customer route'), isDense: true),
            items: [
              for (final r in routes)
                DropdownMenuItem(
                  value: rk(r),
                  child: Text('${r['from'] ?? ''} → ${r['to'] ?? ''}${r['price'] == null ? '' : ' · ${_money(r['price'])}'}',
                      overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 12.5)),
                ),
            ],
            onChanged: !canEdit || _saving
                ? null
                : (v) {
                    final r = routes.where((x) => rk(x) == v).firstOrNull;
                    if (r != null) _applyContract(from: '${r['from'] ?? ''}', to: '${r['to'] ?? ''}');
                  },
          ),
        ],
        if (canEdit) ...[
          const SizedBox(height: 6),
          Align(
            alignment: AlignmentDirectional.centerEnd,
            child: OutlinedButton.icon(
              onPressed: _saving
                  ? null
                  : () => cur.isEmpty ? _applyContract() : _applyContract(from: '${cur['from'] ?? ''}', to: '${cur['to'] ?? ''}'),
              icon: const Icon(Icons.download_done_outlined, size: 16),
              label: Text(tr('تعبئة من العقد', 'Fill from contract')),
            ),
          ),
        ],
      ]),
    );
  }

  /// بنودُ الإيراد التي تُكتب بيد. والصوافي المحسوبة ليست منها: صافي النقل
  /// = سعرُه ناقصَ تكلفته، يحسبه الخادمُ ولا يقبله من أحد (راجع recomputeTotals)؛
  /// وصافي النقل إلى الساحة كذلك متى كُتب سعرُه، وإلّا بقي يُكتب كما كان.
  Future<void> _editMargin(Map<String, dynamic> revenue, Map<String, dynamic> costs) async {
    String init(String k) => _nz(revenue, k) == 0 ? '' : _nz(revenue, k).toString();
    const plain = ['clearanceFee', 'transportSelling', 'yardToCustomerSelling', 'yardNet', 'storageNet', 'securityScan', 'labour'];
    final ctrls = {for (final k in [...plain, 'transportToYardNet']) k: TextEditingController(text: init(k))};
    // فارغٌ على المعاملات القديمة (null) — والفراغُ معنًى لا صفر.
    final yardSell = TextEditingController(text: revenue['transportToYardSelling'] == null ? '' : '${revenue['transportToYardSelling']}');
    String label(String k) {
      final it = _marginItems.firstWhere((x) => x.$1 == k);
      return tr(it.$2, it.$3);
    }
    num v(TextEditingController c) => num.tryParse(c.text.trim()) ?? 0;
    Widget input(String k, {VoidCallback? onChanged, Widget? note}) => Padding(
          padding: const EdgeInsets.only(bottom: 8),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            TextField(
              controller: ctrls[k], keyboardType: const TextInputType.numberWithOptions(decimal: true),
              onChanged: onChanged == null ? null : (_) => onChanged(),
              decoration: InputDecoration(labelText: label(k)),
            ),
            if (note != null) note,
          ]),
        );
    Widget computed(String k, num value) => Padding(
          padding: const EdgeInsets.only(bottom: 8),
          child: InputDecorator(
            decoration: InputDecoration(labelText: '${label(k)} (${tr('محسوب', 'computed')})', filled: true, fillColor: T.canvas),
            child: Text('${_money(value)} ${tr('ر.س', 'SAR')}', style: const TextStyle(fontWeight: FontWeight.w700)),
          ),
        );
    await showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (c) => StatefulBuilder(
        builder: (c, setSt) {
          void refresh() => setSt(() {});
          final yardSet = yardSell.text.trim().isNotEmpty;
          return SafeArea(
            child: Padding(
              padding: EdgeInsets.fromLTRB(16, 16, 16, MediaQuery.of(c).viewInsets.bottom + 16),
              child: SingleChildScrollView(
                child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text(tr('تعديل بنود الإيراد', 'Edit revenue lines'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
                  const SizedBox(height: 4),
                  Text(tr('الفاتورة تُحسب: المصروفات + الأجور والصوافي. وصافي كلّ جزءٍ من النقل = سعره للعميل − تكلفته.',
                          'The invoice is derived: costs + fees and nets. Each transport leg net = its price − its cost.'),
                      style: const TextStyle(fontSize: 11.5, color: T.inkFaint)),
                  const SizedBox(height: 12),
                  input('clearanceFee', note: _clearanceFeeNote),
                  input('transportSelling', onChanged: refresh),
                  computed('transportNet', v(ctrls['transportSelling']!) - _nz(costs, 'transport')),
                  Padding(
                    padding: const EdgeInsets.only(bottom: 8),
                    child: TextField(
                      controller: yardSell, keyboardType: const TextInputType.numberWithOptions(decimal: true),
                      onChanged: (_) => refresh(),
                      decoration: InputDecoration(labelText: label('transportToYardSelling')),
                    ),
                  ),
                  if (yardSet)
                    computed('transportToYardNet', v(yardSell) - _nz(costs, 'transportToYard'))
                  else
                    input('transportToYardNet'),
                  input('yardToCustomerSelling', onChanged: refresh),
                  computed('yardToCustomerNet', v(ctrls['yardToCustomerSelling']!) - _nz(costs, 'transportYardToCustomer')),
                  for (final k in const ['yardNet', 'storageNet', 'securityScan', 'labour']) input(k),
                  const SizedBox(height: 8),
                  SizedBox(
                    width: double.infinity,
                    child: FilledButton(
                      onPressed: () {
                        final sell = yardSell.text.trim();
                        final body = {'revenue': {
                          for (final k in plain) k: num.tryParse(ctrls[k]!.text.trim()) ?? 0,
                          // الفراغُ يُرسَل '' فيعود null في الخادم — «لم يُكتب السعر».
                          'transportToYardSelling': sell.isEmpty ? '' : (num.tryParse(sell) ?? ''),
                          if (sell.isEmpty) 'transportToYardNet': num.tryParse(ctrls['transportToYardNet']!.text.trim()) ?? 0,
                        }};
                        Navigator.pop(c);
                        _patch(body, tr('حُفظت البنود', 'Lines saved'));
                      },
                      child: Text(tr('حفظ', 'Save')),
                    ),
                  ),
                ]),
              ),
            ),
          );
        },
      ),
    );
  }

  /// إرفاقُ ملفٍّ موسومًا بالمرحلة التي أُنتج فيها — يُقرأ بعدُ في موضعه من
  /// دورة الإجراءات لا في كومةٍ واحدة.
  Future<void> _uploadAttachment() async {
    final picked = await pickFileAsDataUrl();
    if (picked == null || !mounted) return;
    final title = TextEditingController(text: picked.fileName.replaceAll(RegExp(r'\.[^.]+$'), ''));
    final cargo = (_c?['cargoType'] ?? 'containers').toString();
    String stage = (_c?['stage'] ?? '').toString();
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => StatefulBuilder(
        builder: (c, setSt) => AlertDialog(
          title: Text(tr('إرفاق ملفّ', 'Attach file')),
          content: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(picked.fileName, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 12, color: T.inkSoft)),
            const SizedBox(height: 8),
            TextField(controller: title, autofocus: true, decoration: InputDecoration(labelText: tr('اسم الملفّ', 'Title'))),
            const SizedBox(height: 10),
            DropdownButtonFormField<String>(
              initialValue: customsStages.any((x) => x.$1 == stage) ? stage : '',
              isExpanded: true,
              decoration: InputDecoration(labelText: tr('المرحلة', 'Stage')),
              items: [
                DropdownMenuItem(value: '', child: Text(tr('مرفق عامّ', 'General'))),
                ...customsStages.map((x) => DropdownMenuItem(value: x.$1, child: Text(customsStageLabel(x.$1, cargo), overflow: TextOverflow.ellipsis))),
              ],
              onChanged: (v) => setSt(() => stage = v ?? ''),
            ),
          ]),
          actions: [
            TextButton(onPressed: () => Navigator.pop(c, false), child: Text(tr('إلغاء', 'Cancel'))),
            FilledButton(onPressed: () => Navigator.pop(c, true), child: Text(tr('رفع', 'Upload'))),
          ],
        ),
      ),
    );
    if (ok != true) return;
    await _send(
      () => Api.instance.post('/api/customs-clearance/${widget.clearanceId}/attachments', {
        'files': [
          {'dataUrl': picked.dataUrl, 'fileName': picked.fileName, 'title': title.text.trim(), 'stage': stage},
        ],
      }),
      ok: tr('أُرفق الملفّ', 'File attached'),
    );
  }

  /// الملفُّ يُقدَّم على `/api/uploads/...` من الخادم نفسِه، فيُفتح بمتصفّح
  /// الجهاز فينزّله أو يعرضه — لا حاجة لتنزيلٍ داخل التطبيق.
  Future<void> _openFile(String fileUrl) async {
    final u = fileUrl;
    if (u.isEmpty) return;
    final uri = Uri.parse(u.startsWith('http') ? u : '${AppConfig.apiBase}$u');
    if (!await launchUrl(uri, mode: LaunchMode.externalApplication)) {
      _say(tr('تعذّر فتح الملفّ', 'Could not open the file'));
    }
  }

  /// حذفُ المرفق يحذف معه إدخالَ مرحلة السداد الذي يملكه (removedStages في
  /// الردّ) — فيُقال قبل الحذف لا بعده.
  Future<void> _deleteAttachment(Map<String, dynamic> att) async {
    final url = '${att['fileUrl'] ?? ''}';
    final owned = url.isNotEmpty && _maps(_c?['paymentStages']).any((p) => p['fileUrl'] == url);
    final name = '${att['title'] ?? att['fileName'] ?? ''}';
    final ok = await _confirm(
      tr('حذف المرفق', 'Delete attachment'),
      owned
          ? tr('«$name»\nيُحذَف معه إدخالُه في مراحل السداد.', '"$name"\nIts payment-stage entry is deleted with it.')
          : name,
      action: tr('حذف', 'Delete'),
    );
    if (!ok) return;
    final r = await _send(() => Api.instance.delete('/api/customs-clearance/${widget.clearanceId}/attachments/${att['_id']}'));
    final removed = r == null ? const [] : (_m(r)['removedStages'] as List? ?? const []);
    if (removed.isNotEmpty) {
      _say(tr('حُذف المرفق ومعه من مراحل السداد: ${removed.join('، ')}', 'Deleted, with payment stage: ${removed.join(', ')}'));
    }
  }

  Future<void> _deletePayment(Map<String, dynamic> p, String stage, int ordinal) async {
    final hasFile = '${p['fileUrl'] ?? ''}'.isNotEmpty || (p['proofFiles'] as List? ?? const []).isNotEmpty;
    final name = '$stage${ordinal > 0 ? ' — ${tr('الدفعة ${_arDigits(ordinal)}', 'Payment $ordinal')}' : ''}';
    final ok = await _confirm(
      tr('حذف إدخال السداد', 'Delete payment entry'),
      hasFile ? tr('«$name»\nيُحذَف معه مرفقُه.', '"$name"\nIts attachment is deleted with it.') : name,
      action: tr('حذف', 'Delete'),
    );
    if (!ok) return;
    await _send(() => Api.instance.delete('/api/customs-clearance/${widget.clearanceId}/payment-stages/${p['_id']}'));
  }

  Future<void> _editCosts(Map<String, dynamic> costs) async {
    final ctrls = {for (final it in _costItems) it.$1: TextEditingController(text: ((costs[it.$1] ?? 0) as num) == 0 ? '' : costs[it.$1].toString())};
    await showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (c) => SafeArea(
        child: Padding(
          padding: EdgeInsets.fromLTRB(16, 16, 16, MediaQuery.of(c).viewInsets.bottom + 16),
          child: SingleChildScrollView(
            child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(tr('تعديل التكاليف', 'Edit costs'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
              const SizedBox(height: 12),
              ..._costItems.map((it) => Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: TextField(controller: ctrls[it.$1], keyboardType: TextInputType.number, decoration: InputDecoration(labelText: tr(it.$2, it.$3))),
              )),
              const SizedBox(height: 8),
              SizedBox(
                width: double.infinity,
                child: FilledButton(
                  onPressed: () {
                    final body = {'costs': {for (final it in _costItems) it.$1: num.tryParse(ctrls[it.$1]!.text) ?? 0}};
                    Navigator.pop(c);
                    _patch(body, tr('حُفظت التكاليف', 'Costs saved'));
                  },
                  child: Text(tr('حفظ', 'Save')),
                ),
              ),
            ]),
          ),
        ),
      ),
    );
  }
}

/// ورقةُ الوحدة: رقمُها، تاريخُ إرجاعها (للحاويات وحدَها)، ولكلّ مرحلةِ نقلٍ
/// أُنجزت أيُّ سيّارةٍ نقلتها — سيّارةُ الشركة برقم كشف التخريج، أو خارجيّةٌ
/// برقم فاتورتها. تردّ الصفَّ معدَّلًا، والحفظُ عند مَن فتحها.
class _UnitSheet extends StatefulWidget {
  final Map<String, dynamic> unit;
  final int index;
  final String cargo;
  final List<String> legs;
  const _UnitSheet({required this.unit, required this.index, required this.cargo, required this.legs});
  @override
  State<_UnitSheet> createState() => _UnitSheetState();
}

class _UnitSheetState extends State<_UnitSheet> {
  late final TextEditingController _number = TextEditingController(text: '${widget.unit['containerNumber'] ?? ''}');
  late final TextEditingController _notes = TextEditingController(text: '${widget.unit['notes'] ?? ''}');
  late String _returnDate = '${widget.unit['returnDate'] ?? ''}';
  // تفاصيلُ إرجاع الحاوية: أين، وبأيّ إيصال، وبأيّ سيّارة.
  late final TextEditingController _returnDepot = TextEditingController(text: '${widget.unit['returnDepot'] ?? ''}');
  late final TextEditingController _returnReceipt = TextEditingController(text: '${widget.unit['returnReceipt'] ?? ''}');
  late final TextEditingController _returnRef = TextEditingController(text: '${widget.unit['returnRef'] ?? ''}');
  late final TextEditingController _returnNotes = TextEditingController(text: '${widget.unit['returnNotes'] ?? ''}');
  late String _returnKind = '${widget.unit['returnVehicleKind'] ?? ''}';
  final Map<String, String> _kind = {};
  final Map<String, TextEditingController> _ref = {};

  bool get _vehicles => widget.cargo == 'vehicles';

  @override
  void initState() {
    super.initState();
    final moves = _maps(widget.unit['moves']);
    for (final leg in widget.legs) {
      final mv = moves.where((x) => x['leg'] == leg).firstOrNull;
      _kind[leg] = '${mv?['vehicleKind'] ?? ''}';
      _ref[leg] = TextEditingController(text: '${mv?['ref'] ?? ''}');
    }
  }

  @override
  void dispose() {
    _number.dispose();
    _notes.dispose();
    _returnDepot.dispose();
    _returnReceipt.dispose();
    _returnRef.dispose();
    _returnNotes.dispose();
    for (final c in _ref.values) { c.dispose(); }
    super.dispose();
  }

  void _done() {
    // بيانُ مرحلةٍ رُفعت علامتُها يبقى كما هو — لا يُمحى لأنّه غاب عن الورقة.
    final others = _maps(widget.unit['moves']).where((x) => !widget.legs.contains(x['leg']));
    Navigator.pop(context, <String, dynamic>{
      ...widget.unit,
      'containerNumber': _number.text.trim(),
      'notes': _notes.text.trim(),
      'returnDate': _vehicles ? '${widget.unit['returnDate'] ?? ''}' : _returnDate,
      // الإرجاعُ للحاويات وحدَها — والسيّارةُ تحمل ما كان فيها كما هو.
      if (!_vehicles) ...{
        'returnDepot': _returnDepot.text.trim(),
        'returnReceipt': _returnReceipt.text.trim().toUpperCase(),
        'returnVehicleKind': _returnKind,
        'returnRef': _returnRef.text.trim(),
        'returnNotes': _returnNotes.text.trim(),
      },
      'moves': [
        ...others,
        for (final leg in widget.legs) {'leg': leg, 'vehicleKind': _kind[leg] ?? '', 'ref': _ref[leg]!.text.trim()},
      ],
    });
  }

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: Padding(
        padding: EdgeInsets.fromLTRB(16, 16, 16, MediaQuery.of(context).viewInsets.bottom + 16),
        child: SingleChildScrollView(
          child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text('${_vehicles ? tr('سيّارة', 'Vehicle') : tr('حاوية', 'Container')} ${_arDigits(widget.index + 1)}',
                style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
            const SizedBox(height: 12),
            TextField(
              controller: _number,
              textDirection: TextDirection.ltr,
              textCapitalization: TextCapitalization.characters,
              decoration: InputDecoration(labelText: _vehicles ? tr('رقم السيارة', 'Vehicle no.') : tr('رقم الحاوية', 'Container no.')),
            ),
            if (!_vehicles) ...[
              const SizedBox(height: 10),
              Row(children: [
                Expanded(
                  child: OutlinedButton.icon(
                    icon: const Icon(Icons.event_outlined, size: 18),
                    label: Text('${tr('تاريخ الإرجاع', 'Return date')}: ${_returnDate.isEmpty ? tr('اختر التاريخ', 'Pick date') : _returnDate}'),
                    onPressed: () async {
                      final d = await showDatePicker(
                        context: context,
                        initialDate: DateTime.tryParse(_returnDate) ?? DateTime.now(),
                        firstDate: DateTime(2020), lastDate: DateTime(2100),
                      );
                      if (d != null) setState(() => _returnDate = d.toIso8601String().split('T').first);
                    },
                  ),
                ),
                if (_returnDate.isNotEmpty)
                  IconButton(icon: const Icon(Icons.clear, size: 18), onPressed: () => setState(() => _returnDate = '')),
              ]),
              const SizedBox(height: 8),
              TextField(controller: _returnDepot, decoration: InputDecoration(labelText: tr('مكان الإرجاع (الساحة / المحطة)', 'Returned to (depot)'))),
              const SizedBox(height: 8),
              TextField(
                controller: _returnReceipt,
                textDirection: TextDirection.ltr,
                textCapitalization: TextCapitalization.characters,
                decoration: InputDecoration(labelText: tr('رقم إيصال الإرجاع (EIR)', 'Return receipt (EIR)')),
              ),
              const SizedBox(height: 8),
              Wrap(spacing: 8, children: [
                for (final k in const [('energize', 'سيّارة تنشيط', 'Energize truck'), ('external', 'سيّارة خارجيّة', 'External truck')])
                  ChoiceChip(
                    label: Text(tr(k.$2, k.$3), style: const TextStyle(fontSize: 12)),
                    selected: _returnKind == k.$1,
                    onSelected: (_) => setState(() => _returnKind = _returnKind == k.$1 ? '' : k.$1),
                  ),
              ]),
              if (_returnKind.isNotEmpty) ...[
                const SizedBox(height: 8),
                TextField(
                  controller: _returnRef,
                  textDirection: TextDirection.ltr,
                  decoration: InputDecoration(
                      labelText: tr('رقم كشف التخريج', 'Release sheet no.')),
                ),
              ],
              const SizedBox(height: 8),
              TextField(controller: _returnNotes, maxLines: 2, decoration: InputDecoration(labelText: tr('ملاحظات الإرجاع', 'Return notes'))),
            ],
            for (final leg in widget.legs) ...[
              const SizedBox(height: 14),
              Text(customsStageLabel(leg, widget.cargo), style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w800)),
              const SizedBox(height: 6),
              Wrap(spacing: 8, children: [
                for (final k in const [('energize', 'سيّارة تنشيط', 'Energize vehicle'), ('external', 'سيّارة خارجيّة', 'External vehicle')])
                  ChoiceChip(
                    label: Text(tr(k.$2, k.$3), style: const TextStyle(fontSize: 12)),
                    selected: _kind[leg] == k.$1,
                    onSelected: (_) => setState(() => _kind[leg] = _kind[leg] == k.$1 ? '' : k.$1),
                  ),
              ]),
              if ((_kind[leg] ?? '').isNotEmpty) ...[
                const SizedBox(height: 8),
                TextField(
                  controller: _ref[leg],
                  textDirection: TextDirection.ltr,
                  decoration: InputDecoration(
                      labelText: tr('رقم كشف التخريج', 'Release sheet no.')),
                ),
              ],
            ],
            if (widget.legs.isEmpty)
              Padding(
                padding: const EdgeInsets.only(top: 10),
                child: Text(tr('بيانُ النقل يُكتب بعد تعليم مرحلة النقل في مسار التخليص.', 'Transport details open once a transport stage is ticked.'),
                    style: const TextStyle(fontSize: 11.5, color: T.inkFaint)),
              ),
            const SizedBox(height: 12),
            TextField(controller: _notes, maxLines: 2, decoration: InputDecoration(labelText: tr('ملاحظات', 'Notes'))),
            const SizedBox(height: 16),
            SizedBox(width: double.infinity, child: FilledButton(onPressed: _done, child: Text(tr('حفظ', 'Save')))),
          ]),
        ),
      ),
    );
  }
}

/// ورقةُ إدخال السداد: تاريخٌ ومبلغٌ وملاحظةٌ وملفّ — ولا يُسجَّل إدخالٌ بلا تاريخٍ
/// ولا ملفّ. تردّ جسمَ الطلب، والإرسالُ عند مَن فتحها.
class _PaymentSheet extends StatefulWidget {
  final String stage;
  final Map<String, dynamic>? entry;
  // مرحلةٌ يُكتب مبلغُها في بند تكلفةٍ عند تأكيد الدفع — فالمبلغُ فيها إلزاميّ.
  final bool amountRequired;
  const _PaymentSheet({required this.stage, this.entry, this.amountRequired = false});
  @override
  State<_PaymentSheet> createState() => _PaymentSheetState();
}

class _PaymentSheetState extends State<_PaymentSheet> {
  late String _date = '${widget.entry?['date'] ?? ''}';
  late final TextEditingController _amount = TextEditingController(text: widget.entry?['amount'] == null ? '' : '${widget.entry!['amount']}');
  late final TextEditingController _noteCtrl = TextEditingController(text: '${widget.entry?['note'] ?? ''}');
  PickedFile? _file;

  bool get _hadFile => '${widget.entry?['fileUrl'] ?? ''}'.isNotEmpty;
  bool get _amountOk => !widget.amountRequired || (num.tryParse(_amount.text.trim()) ?? 0) > 0;

  @override
  void dispose() {
    _amount.dispose();
    _noteCtrl.dispose();
    super.dispose();
  }

  void _done() {
    void say(String m) => ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(m)));
    final text = _amount.text.trim();
    final amount = text.isEmpty ? null : num.tryParse(text);
    if (text.isNotEmpty && (amount == null || amount < 0)) return say(tr('اكتب المبلغ رقمًا صحيحًا', 'Enter a valid amount'));
    if (!_amountOk) return say(tr('المبلغ إلزاميّ لهذه المرحلة', 'The amount is required for this stage'));
    if (_date.isEmpty && _file == null && !_hadFile) return say(tr('اختر تاريخًا أو أرفِق ملفًّا', 'Pick a date or attach a file'));
    Navigator.pop(context, <String, dynamic>{
      'date': _date, 'amount': amount, 'note': _noteCtrl.text.trim(),
      if (_file != null) ...{'dataUrl': _file!.dataUrl, 'fileName': _file!.fileName},
    });
  }

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: Padding(
        padding: EdgeInsets.fromLTRB(16, 16, 16, MediaQuery.of(context).viewInsets.bottom + 16),
        child: SingleChildScrollView(
          child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(widget.entry == null ? tr('إضافة إدخال سداد', 'Add payment entry') : tr('تعديل إدخال السداد', 'Edit payment entry'),
                style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
            Text(widget.stage, style: const TextStyle(fontSize: 12, color: T.inkSoft)),
            const SizedBox(height: 12),
            Row(children: [
              Expanded(
                child: OutlinedButton.icon(
                  icon: const Icon(Icons.event_outlined, size: 18),
                  label: Text('${tr('التاريخ', 'Date')}: ${_date.isEmpty ? tr('اختر التاريخ', 'Pick date') : _date}'),
                  onPressed: () async {
                    final d = await showDatePicker(
                      context: context,
                      initialDate: DateTime.tryParse(_date) ?? DateTime.now(),
                      firstDate: DateTime(2020), lastDate: DateTime(2100),
                    );
                    if (d != null) setState(() => _date = d.toIso8601String().split('T').first);
                  },
                ),
              ),
              if (_date.isNotEmpty) IconButton(icon: const Icon(Icons.clear, size: 18), onPressed: () => setState(() => _date = '')),
            ]),
            const SizedBox(height: 10),
            TextField(
              controller: _amount,
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              textDirection: TextDirection.ltr,
              onChanged: (_) => setState(() {}),
              decoration: InputDecoration(
                labelText: widget.amountRequired ? '${tr('المبلغ (إلزامي)', 'Amount (required)')} *' : tr('المبلغ (اختياري)', 'Amount (optional)'),
                helperText: widget.amountRequired
                    ? tr('يُكتب في بند التكلفة المقابل حين تؤكّد الإدارة المالية الدفع', 'Written into the matching cost line once Finance confirms payment')
                    : null,
              ),
            ),
            const SizedBox(height: 10),
            TextField(controller: _noteCtrl, maxLines: 2, decoration: InputDecoration(labelText: tr('ملاحظة', 'Note'))),
            const SizedBox(height: 10),
            OutlinedButton.icon(
              onPressed: () async {
                final f = await pickFileAsDataUrl();
                if (f != null && mounted) setState(() => _file = f);
              },
              icon: const Icon(Icons.attach_file, size: 18),
              label: Text(
                _file?.fileName ?? (_hadFile ? tr('استبدال الملفّ المرفق', 'Replace the attached file') : tr('إرفاق ملفّ (اختياري)', 'Attach a file (optional)')),
                overflow: TextOverflow.ellipsis,
              ),
            ),
            const SizedBox(height: 14),
            SizedBox(width: double.infinity, child: FilledButton(onPressed: _amountOk ? _done : null, child: Text(tr('حفظ', 'Save')))),
          ]),
        ),
      ),
    );
  }
}

/// ورقةُ إصدار الفاتورة: بنودُ البيع من إعدادات القسم (`saleItemDefs`) بسعرها
/// ومرفقها. تردّ البنودَ التي كُتب سعرُها، والإصدارُ عند مَن فتحها.
class _InvoiceSheet extends StatefulWidget {
  final List<Map<String, dynamic>> defs;
  final List<Map<String, dynamic>> existing;
  // وصلت فاتورةُ النقل من بابٍ آخر (خانتُها أو مراحلُ السداد) — فلا تنبيه.
  final bool transportReceived;
  const _InvoiceSheet({required this.defs, required this.existing, required this.transportReceived});
  @override
  State<_InvoiceSheet> createState() => _InvoiceSheetState();
}

class _InvoiceSheetState extends State<_InvoiceSheet> {
  final Map<String, TextEditingController> _amount = {};
  final Map<String, PickedFile> _file = {};

  Map<String, dynamic>? _old(String key) => widget.existing.where((x) => x['key'] == key).firstOrNull;
  bool _hasFile(String key) => _file[key] != null || '${_old(key)?['fileUrl'] ?? ''}'.isNotEmpty;

  @override
  void initState() {
    super.initState();
    for (final d in widget.defs) {
      final key = '${d['key']}';
      final old = _old(key);
      _amount[key] = TextEditingController(text: old == null ? '' : '${old['amount'] ?? ''}');
    }
  }

  @override
  void dispose() {
    for (final c in _amount.values) { c.dispose(); }
    super.dispose();
  }

  void _done() {
    final items = <Map<String, dynamic>>[];
    for (final d in widget.defs) {
      final key = '${d['key']}';
      final text = _amount[key]!.text.trim();
      if (text.isEmpty) continue;
      final amount = num.tryParse(text);
      if (amount == null || amount < 0) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(tr('اكتب سعرَ «${d['nameAr']}» رقمًا صحيحًا', 'Enter a valid amount for "${d['nameEn'] ?? d['nameAr']}"'))));
        return;
      }
      items.add({
        'key': key, 'amount': amount,
        if (_file[key] != null) ...{'file': _file[key]!.dataUrl, 'fileName': _file[key]!.fileName},
      });
    }
    Navigator.pop(context, items);
  }

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: Padding(
        padding: EdgeInsets.fromLTRB(16, 16, 16, MediaQuery.of(context).viewInsets.bottom + 16),
        child: SingleChildScrollView(
          child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(tr('إصدار الفاتورة', 'Issue invoice'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
            const SizedBox(height: 4),
            Text(tr('اكتب سعرَ كلّ بندٍ يدخل الفاتورة، وأرفِق ورقتَه إن وُجدت. ما تُرك سعرُه فارغًا لا يدخلها.',
                    'Enter the price of each line on the invoice and attach its paper if any. Lines left empty are left out.'),
                style: const TextStyle(fontSize: 11.5, color: T.inkFaint)),
            const SizedBox(height: 12),
            for (final d in widget.defs) ...[
              Row(children: [
                Expanded(
                  child: TextField(
                    controller: _amount['${d['key']}'],
                    keyboardType: const TextInputType.numberWithOptions(decimal: true),
                    textDirection: TextDirection.ltr,
                    decoration: InputDecoration(labelText: tr('${d['nameAr'] ?? d['key']}', '${d['nameEn'] ?? d['nameAr'] ?? d['key']}')),
                  ),
                ),
                IconButton(
                  tooltip: _file['${d['key']}']?.fileName ?? tr('إرفاق', 'Attach'),
                  icon: Icon(_hasFile('${d['key']}') ? Icons.task_outlined : Icons.attach_file_rounded,
                      size: 20, color: _hasFile('${d['key']}') ? T.success : T.inkSoft),
                  onPressed: () async {
                    final p = await pickFileAsDataUrl();
                    if (p != null && mounted) setState(() => _file['${d['key']}'] = p);
                  },
                ),
              ]),
              // فاتورةُ النقل ليست شرطًا للإصدار — لكنّ غيابَها يُقال هنا.
              if (customsTransportInvoiceKeys.contains('${d['key']}') && !widget.transportReceived
                  && !customsTransportInvoiceKeys.any(_hasFile))
                Padding(
                  padding: const EdgeInsets.only(top: 4),
                  child: Text(tr('فاتورة النقل لم تُستلَم بعد — تُرفَق لاحقًا فتُنهى المعاملة', 'Transport invoice not received yet — attach it later and the transaction closes'),
                      style: const TextStyle(fontSize: 11.5, color: T.danger, fontWeight: FontWeight.w700)),
                ),
              const SizedBox(height: 8),
            ],
            const SizedBox(height: 8),
            SizedBox(
              width: double.infinity,
              child: FilledButton(onPressed: _done, child: Text(tr('إصدار الفاتورة', 'Issue invoice'))),
            ),
          ]),
        ),
      ),
    );
  }
}
