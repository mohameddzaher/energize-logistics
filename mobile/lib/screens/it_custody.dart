import 'dart:async';

import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/export_sheet.dart';
import '../ui/lookup_field.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';
import 'it_common.dart';
import '../ui/search_field.dart';

/// عهد الأجهزة (IT) — the custody register with the full action set, نظيرُ
/// /system/it/custody: تسليمٌ (من المخزن أو جديد)، نقل، إرجاع، تالف، بيع وإرجاعُ
/// المبيع، تعديل، حذف، السجلّ، استلامُ عهدة موظّفٍ دفعةً واحدة، عهدُ الموظّف، التصدير.
class ItCustodyScreen extends StatefulWidget {
  /// اللوحة تفتح الشاشةَ على كارتٍ أو زرٍّ بعينه.
  final String initialBucket, initialStatus, initialCondition, initialOtherType;
  const ItCustodyScreen({super.key, this.initialBucket = '', this.initialStatus = '', this.initialCondition = '', this.initialOtherType = ''});
  @override
  State<ItCustodyScreen> createState() => _ItCustodyScreenState();
}

// شرائح الاتصال محذوفة من القائمة: خطوط الأرقام ليست من عهدة القسم، ووجودها
// هنا كان يضيف أربعة وستين صفاً لا يملكها أحد فينا إلى كل عدّ.
// مطابقة لـ TYPE_NAME_AR في backend/src/config/itCustody.js.
const custodyTypes = {
  'laptop': ('لابتوب', 'Laptop'),
  'desktop': ('حاسب مكتبي', 'Desktop'),
  'phone': ('موبايل', 'Phone'),
  'tablet': ('تابلت', 'Tablet'),
  'monitor': ('شاشة', 'Monitor'),
  'keyboard': ('كيبورد', 'Keyboard'),
  'mouse': ('ماوس', 'Mouse'),
  'keyboard_mouse': ('ماوس وكيبورد', 'Keyboard & mouse'), // نوعٌ ملغًى — للصفوف القديمة وحدها
  'headset': ('سماعة رأس', 'Headset'),
  'printer': ('طابعة', 'Printer'),
  'router': ('راوتر', 'Router'),
  'charger': ('شاحن', 'Charger'),
  'cable': ('كابل', 'Cable'),
  'laptop_bag': ('شنطة لابتوب', 'Laptop bag'),
  'accessory': ('ملحق', 'Accessory'),
  'access_card': ('بطاقة دخول', 'Access card'),
  'other': ('صنف آخر', 'Other'),
};

String custodyTypeLabel(dynamic t) {
  final e = custodyTypes[t];
  return e == null ? (t ?? '—').toString() : tr(e.$1, e.$2);
}

/// الفئات الخمس التي تُعرض ككروت بإجمالياتها.
///
/// السجل يخزّن النوع مفصّلاً (ماوس، كيبورد، شنطة…) ولا يمكن قراءة إجمالياته
/// بالعين على خمسة عشر نوعاً. الدلو طبقة عرض تُشتق من النوع ولا تحلّ محله، حتى
/// لا نفقد أن هذا ماوس وذاك كيبورد.
/// مطابقة لـ BUCKETS في backend/src/config/itCustody.js.
class CustodyBucket {
  final String key;
  final String ar;
  final String en;
  final String canonicalType;
  final List<String> types;
  final IconData icon;
  const CustodyBucket(this.key, this.ar, this.en, this.canonicalType, this.types, this.icon);
  String get label => tr(ar, en);
}

const custodyBuckets = <CustodyBucket>[
  CustodyBucket('laptops', 'لابتوبات', 'Laptops', 'laptop', ['laptop', 'desktop'], Icons.laptop_mac_rounded),
  // الماوسُ وحدَه والكيبوردُ وحدَه، ولا طقم — نظيرُ config/itCustody. النوعُ
  // القديم keyboard_mouse يُقرأ في دلو الكيبورد بشارته ولا يُكتب.
  CustodyBucket('mice', 'ماوس', 'Mouse', 'mouse', ['mouse'], Icons.mouse_rounded),
  CustodyBucket('keyboards', 'كيبورد', 'Keyboard', 'keyboard', ['keyboard', 'keyboard_mouse'], Icons.keyboard_rounded),
  CustodyBucket('phones', 'موبايلات', 'Phones', 'phone', ['phone'], Icons.smartphone_rounded),
  CustodyBucket('tablets', 'تابلت', 'Tablets', 'tablet', ['tablet'], Icons.tablet_android_rounded),
  CustodyBucket('monitors', 'شاشات', 'Monitors', 'monitor', ['monitor'], Icons.monitor_rounded),
  CustodyBucket('other', 'أخرى', 'Other', 'other',
      ['laptop_bag', 'charger', 'cable', 'headset', 'printer', 'router', 'access_card', 'accessory', 'other'], Icons.inventory_2_rounded),
];

/// أي نوع مجهول يسقط في «أخرى» بدل أن يختفي من العدّ.
String bucketOf(dynamic type) {
  final t = (type ?? '').toString().trim();
  for (final b in custodyBuckets) {
    if (b.types.contains(t)) return b.key;
  }
  return 'other';
}

/// أنواع دلو «أخرى» — تغذّي الفلتر الثاني الذي يظهر عند اختياره.
const otherBucketTypes = ['laptop_bag', 'charger', 'cable', 'headset', 'printer', 'router', 'access_card', 'accessory', 'other'];

const custodyConditions = {
  'new': ('جديد', 'New'),
  'good': ('جيد', 'Good'),
  'fair': ('مقبول', 'Fair'),
  'damaged': ('تالف', 'Damaged'),
};

String conditionLabel(dynamic c) {
  final e = custodyConditions[c];
  return e == null ? (c ?? '—').toString() : tr(e.$1, e.$2);
}

/// اسم العرض مشتقّ من النوع والماركة بدل أن يُكتب باليد — «لابتوب Dell».
/// الاسم الحرّ هو ما أنتج ستة وستين تهجئة لنفس الأجهزة في السجل.
String deriveAssetName(String type, String brand) {
  final base = custodyTypes[type] == null ? 'صنف آخر' : custodyTypes[type]!.$1;
  final b = brand.trim();
  return b.isEmpty ? base : '$base $b';
}

String empName(dynamic e) {
  if (e is! Map) return '—';
  final ar = (e['arabicName'] ?? '').toString();
  if (ar.isNotEmpty) return ar;
  return '${e['firstName'] ?? ''} ${e['lastName'] ?? ''}'.trim();
}

// أسماءُ حركات السجلّ — مطابقةٌ لـ ACTION_LABEL في صفحة الويب.
const _actionLabels = {
  'added_to_store': ('أُضيف إلى المستودع', 'Added to store', T.info),
  'assigned': ('سُلّم إلى موظف', 'Handed to employee', T.success),
  'transferred': ('نُقل إلى موظف آخر', 'Transferred', T.navy),
  'returned': ('أُعيد إلى المستودع', 'Returned to store', T.info),
  'damaged': ('أُبلغ عن تلفه', 'Reported damaged', T.warn),
  'lost': ('أُبلغ عن فقده', 'Reported lost', T.danger),
  // «retired» لم تعد تُكتب؛ تبقى لأن في السجل حركاتٍ قديمة كُتبت بها.
  'retired': ('سُجّل كتالف', 'Recorded faulty', T.inkFaint),
  'updated': ('عُدّلت بياناته', 'Details updated', T.violet),
  'sold': ('بيع', 'Sold', T.violet),
  'sale_returned': ('أُرجع المبيع إلى المخزن', 'Sale returned to store', T.success),
};

String custodyStatusLabel(dynamic s) => switch ('$s') {
      'assigned' => tr('بعهدة الموظف', 'With employee'),
      'in_stock' => tr('المستودع', 'In store'),
      'returned' => tr('تالف', 'Faulty'),
      'sold' => tr('مُباع', 'Sold'),
      _ => '$s',
    };

List<ExportCol> _custodyCols() => [
      ExportCol('الموظف', 'Employee', (r) => r['employee'] is Map ? itEmpName(r['employee']) : ''),
      ExportCol('الجهاز', 'Item', (r) => r['name'] ?? ''),
      ExportCol('النوع', 'Type', (r) => custodyTypeLabel(r['type'])),
      ExportCol('الرقم التسلسلي', 'Serial', (r) => r['serialNumber'] ?? ''),
      ExportCol('الماركة', 'Brand', (r) => r['brand'] ?? ''),
      ExportCol('المواصفات', 'Specs', (r) => r['specs'] ?? ''),
      ExportCol('الحالة الفنية', 'Condition', (r) => conditionLabel(r['condition'])),
      ExportCol('القيمة للقطعة', 'Value (per unit)', (r) => r['value'] ?? 0),
      ExportCol('تاريخ التسليم', 'Assigned', (r) => '${r['assignedDate'] ?? ''}'.split('T').first),
      ExportCol('الحالة', 'Status', (r) => custodyStatusLabel(r['status'])),
      // تفاصيلُ خطّ الجوّال — فارغةٌ لغيره.
      ExportCol('الباقة', 'Package', (r) => (r['telecom'] as Map?)?['package'] ?? ''),
      ExportCol('المزوّد', 'Provider', (r) => (r['telecom'] as Map?)?['provider'] ?? ''),
      ExportCol('الرقم التسلسلي للشريحة', 'SIM serial', (r) => (r['telecom'] as Map?)?['iccid'] ?? ''),
      ExportCol('مدة العقد (شهر)', 'Contract months', (r) => (r['telecom'] as Map?)?['contractMonths'] ?? ''),
      ExportCol('انتهاء العقد', 'Contract expiry', (r) => (r['telecom'] as Map?)?['expiryDate'] ?? ''),
      ExportCol('المفوَّض لدى المزوّد', 'Authorised with provider', (r) => (r['telecom'] as Map?)?['authorizedName'] ?? ''),
      ExportCol('تاريخ الإرجاع', 'Returned', (r) => '${r['returnedDate'] ?? ''}'.split('T').first),
    ];

class _ItCustodyScreenState extends State<ItCustodyScreen> {
  List<Map<String, dynamic>> _rows = [];
  List<Map<String, dynamic>> _stock = [];
  bool _loading = true;
  String? _error;
  String _q = '';
  // الفلاتر كلها تُرسَل إلى الخادم، ويعود معها عددُ كل كارت وكل زر محسوباً على
  // نفس المجموعة المفلترة — كل كارت يقول بالضبط كم صفاً سيفتحه الضغط عليه.
  late String _status = widget.initialStatus;
  late String _bucket = widget.initialBucket;
  late String _otherType = widget.initialOtherType;
  late String _condition = widget.initialCondition;
  Map<String, int> _bucketCounts = {};
  Map<String, int> _statusCounts = {};
  List<Map<String, dynamic>> _otherKinds = [];
  List<Map<String, dynamic>> _conditionCounts = [];
  int _shownTotal = 0;
  num _shownValue = 0;
  // إجمالي السجل يُعرض بجانب الرقم المفلتر ليُعرف من أيٍّ اقتُطع، لا ليحلّ محلّه.
  int _registerTotal = 0;
  int _registerAssigned = 0;
  final _search = TextEditingController();
  Timer? _debounce;
  int _seq = 0;
  late final void Function() _onLive;

  @override
  void initState() {
    super.initState();
    _onLive = () => _refresh();
    Live.instance.on('it:updated', _onLive);
    Live.instance.on('hr:asset', _onLive);
    _refresh();
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _search.dispose();
    Live.instance.off('it:updated', _onLive);
    Live.instance.off('hr:asset', _onLive);
    super.dispose();
  }

  void _refresh() { _load(); _loadStock(); }

  void _searchChanged(String v) {
    _q = v;
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 350), _load);
  }

  int _n(dynamic v) => v is num ? v.toInt() : 0;

  bool get _anyFilter => _bucket.isNotEmpty || _status.isNotEmpty || _condition.isNotEmpty || _otherType.isNotEmpty || _q.trim().isNotEmpty;

  Future<void> _load() async {
    final my = ++_seq;
    try {
      // `scope=all` يضم المستودع: زر «المستودع» وكارت كل فئة يجب أن يعدّا المخزون أيضاً.
      final qs = <String, String>{'scope': 'all'};
      if (_bucket.isNotEmpty) qs['bucket'] = _bucket;
      if (_bucket == 'other' && _otherType.isNotEmpty) qs['otherType'] = _otherType;
      if (_status.isNotEmpty) qs['status'] = _status;
      if (_condition.isNotEmpty) qs['condition'] = _condition;
      if (_q.trim().isNotEmpty) qs['q'] = _q.trim();
      final query = qs.entries.map((e) => '${e.key}=${Uri.encodeQueryComponent(e.value)}').join('&');
      final d = await Api.instance.get('/api/it/custody?$query');
      if (!mounted || my != _seq) return;
      final counts = (d['counts'] as Map?) ?? const {};
      final reg = (d['register'] as Map?) ?? const {};
      setState(() {
        _rows = List<Map<String, dynamic>>.from(d['items'] ?? []);
        _bucketCounts = {
          for (final b in List<Map<String, dynamic>>.from(counts['buckets'] ?? []))
            (b['key'] ?? '').toString(): _n(b['count']),
        };
        _statusCounts = {
          for (final e in ((counts['byStatus'] as Map?) ?? const {}).entries) e.key.toString(): _n(e.value),
        };
        _otherKinds = List<Map<String, dynamic>>.from(counts['otherKinds'] ?? []);
        _conditionCounts = List<Map<String, dynamic>>.from(counts['conditions'] ?? []);
        _shownTotal = counts['total'] is num ? _n(counts['total']) : _rows.length;
        _shownValue = (counts['value'] as num?) ?? 0;
        _registerTotal = _n(reg['total']);
        _registerAssigned = _n(reg['assigned']);
        _loading = false;
        _error = null;
      });
    } catch (e) {
      if (mounted && my == _seq) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  // ما على الرفّ الآن — يُسلَّم منه في «تسليم عهدة».
  Future<void> _loadStock() async {
    try {
      final d = await Api.instance.get('/api/it/stock');
      if (mounted) _stock = List<Map<String, dynamic>>.from(d['items'] ?? []);
    } catch (_) {}
  }

  void _clearFilters() {
    _search.clear();
    setState(() { _bucket = ''; _otherType = ''; _status = ''; _condition = ''; _q = ''; });
    _load();
  }

  Future<void> _export() async {
    final scope = await pickExportScope(context, filtered: _anyFilter, allHint: '$_registerTotal');
    if (scope == null || !mounted) return;
    var rows = _rows;
    if (scope == 'all' && _anyFilter) {
      try { rows = List<Map<String, dynamic>>.from((await Api.instance.get('/api/it/custody?scope=all'))['items'] ?? []); } catch (_) {}
    }
    if (!mounted) return;
    await exportExcel(context, fileName: 'it-custody', sheets: [('Custody', _custodyCols(), rows)]);
  }

  @override
  Widget build(BuildContext context) {
    final filtered = _rows;
    final canEdit = canEditIt(context);
    int countBucket(String k) => _bucketCounts[k] ?? 0;
    int countStatus(String k) => _statusCounts[k] ?? 0;

    final statuses = {
      'assigned': (tr('بعهدة الموظف', 'With employee'), T.warn),
      'in_stock': (tr('المستودع', 'In store'), T.info),
      'returned': (tr('تالف', 'Faulty'), T.danger),
    };

    final otherKinds = _otherKinds.map((k) => (k['key'] ?? '').toString()).toList();
    final conditionKeys = _conditionCounts.map((k) => (k['key'] ?? '').toString()).toList();

    return AppScaffold(
      title: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
        Text(tr('عهد تقنية المعلومات', 'IT Custody')),
        Text(tr('$_registerAssigned عهدة بحوزة الموظفين', '$_registerAssigned items currently assigned'),
            style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w500)),
      ]),
      actions: [
        IconButton(tooltip: tr('تصدير Excel', 'Export to Excel'), icon: const Icon(Icons.file_download_outlined), onPressed: _export),
        if (canEdit)
          IconButton(tooltip: tr('استلام عهدة موظف', 'Receive from employee'), icon: const Icon(Icons.assignment_turned_in_outlined), onPressed: () => _handover(context)),
      ],
      floatingActionButton: !canEdit ? null : FloatingActionButton.extended(
        onPressed: () => _custodyForm(context, null),
        icon: const Icon(Icons.add),
        label: Text(tr('تسليم عهدة', 'Assign item')),
      ),
      body: _loading
          ? ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(height: 48), SizedBox(height: 10), Shimmer(), SizedBox(height: 10), Shimmer()])
          : _error != null
              ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
              : RefreshIndicator(
                  onRefresh: _load,
                  child: CustomScrollView(keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag, slivers: [
                    SliverToBoxAdapter(child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                      Padding(
                        padding: const EdgeInsets.fromLTRB(14, 12, 14, 0),
                        child: SearchField(
                          controller: _search, dense: true,
                          onChanged: _searchChanged,
                          hint: tr('ابحث بالجهاز أو الرقم التسلسلي أو الموظف…', 'Search item, serial or employee…'),
                        ),
                      ),
                      // «المعروض» يصف القائمة، و«إجمالي السجل» يقول من أيٍّ اقتُطعت ويُرجع الكلَّ بالضغط.
                      Padding(
                        padding: const EdgeInsets.fromLTRB(14, 8, 14, 0),
                        child: Row(children: [
                          _mini(tr('المعروض الآن', 'Showing'), '$_shownTotal', T.ink),
                          const SizedBox(width: 6),
                          _mini(tr('إجمالي السجل', 'Total register'), '$_registerTotal', T.ink, onTap: _anyFilter ? _clearFilters : null),
                          const SizedBox(width: 6),
                          _mini(tr('قيمة المعروض', 'Value shown'), fmtMoney(_shownValue), T.orange),
                        ]),
                      ),
                      // ارتفاعُ الشريط من محتواه — يكبر مع حجم الخط ولا يفيض.
                      SingleChildScrollView(
                        scrollDirection: Axis.horizontal,
                        padding: const EdgeInsets.fromLTRB(14, 10, 14, 4),
                        child: IntrinsicHeight(child: Row(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                          for (final (i, b) in custodyBuckets.indexed) ...[
                            if (i > 0) const SizedBox(width: 8),
                            () {
                            final on = _bucket == b.key;
                            return Pressable(
                              onTap: () { setState(() { _bucket = on ? '' : b.key; _otherType = ''; }); _load(); },
                              child: Container(
                                width: 118,
                                padding: const EdgeInsets.all(10),
                                decoration: BoxDecoration(
                                  color: on ? T.orange.withValues(alpha: 0.10) : Colors.white,
                                  borderRadius: BorderRadius.circular(14),
                                  border: Border.all(color: on ? T.orange : T.line),
                                ),
                                child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
                                  Row(children: [
                                    Icon(b.icon, size: 15, color: on ? T.orange : T.inkFaint),
                                    const SizedBox(width: 5),
                                    Expanded(child: Text(b.label, maxLines: 1, overflow: TextOverflow.ellipsis,
                                        style: TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: on ? T.orange : T.inkSoft))),
                                  ]),
                                  const SizedBox(height: 6),
                                  Text('${countBucket(b.key)}', style: TextStyle(fontSize: 20, fontWeight: FontWeight.w800, color: on ? T.orange : T.ink)),
                                ]),
                              ),
                            );
                            }(),
                          ],
                        ])),
                      ),
                      if (_bucket == 'other' && otherKinds.isNotEmpty)
                        Padding(
                          padding: const EdgeInsets.fromLTRB(14, 6, 14, 0),
                          child: Wrap(spacing: 6, runSpacing: 6, children: [
                            _chip(tr('الكل', 'All'), _otherType.isEmpty, T.orange, () { setState(() => _otherType = ''); _load(); }),
                            ..._otherKinds.map((k) {
                              final t = '${k['key']}';
                              final on = _otherType == t;
                              return _chip('${custodyTypeLabel(t)} ${k['count'] ?? ''}', on, T.orange, () { setState(() => _otherType = on ? '' : t); _load(); });
                            }),
                          ]),
                        ),
                      Padding(
                        padding: const EdgeInsets.fromLTRB(14, 8, 14, 4),
                        child: Row(
                          children: statuses.entries.map((e) {
                            final selected = _status == e.key;
                            return Expanded(
                              child: Padding(
                                padding: const EdgeInsetsDirectional.only(end: 6),
                                child: Pressable(
                                  onTap: () { setState(() => _status = selected ? '' : e.key); _load(); },
                                  child: Container(
                                    padding: const EdgeInsets.symmetric(vertical: 9, horizontal: 8),
                                    decoration: BoxDecoration(
                                      color: selected ? e.value.$2 : e.value.$2.withValues(alpha: 0.10),
                                      borderRadius: BorderRadius.circular(12),
                                      border: Border.all(color: selected ? e.value.$2 : Colors.transparent),
                                    ),
                                    child: Column(children: [
                                      Text('${countStatus(e.key)}', style: TextStyle(fontSize: 17, fontWeight: FontWeight.w800, color: selected ? Colors.white : e.value.$2)),
                                      Text(e.value.$1, maxLines: 1, overflow: TextOverflow.ellipsis, textAlign: TextAlign.center,
                                          style: TextStyle(fontSize: 10.5, fontWeight: FontWeight.w700, color: selected ? Colors.white : e.value.$2)),
                                    ]),
                                  ),
                                ),
                              ),
                            );
                          }).toList(),
                        ),
                      ),
                      if (conditionKeys.isNotEmpty || _condition.isNotEmpty)
                        Padding(
                          padding: const EdgeInsets.fromLTRB(14, 4, 14, 0),
                          child: Wrap(spacing: 6, runSpacing: 6, children: {...conditionKeys, if (_condition.isNotEmpty) _condition}.map((k) {
                            final on = _condition == k;
                            return _chip(conditionLabel(k), on, T.navy, () { setState(() => _condition = on ? '' : k); _load(); });
                          }).toList()),
                        ),
                      if (_anyFilter)
                        Align(
                          alignment: AlignmentDirectional.centerEnd,
                          child: Padding(
                            padding: const EdgeInsets.symmetric(horizontal: 8),
                            child: TextButton(onPressed: _clearFilters, child: Text(tr('مسح الفلاتر', 'Clear filters'), style: const TextStyle(fontSize: 12))),
                          ),
                        ),
                    ])),
                    if (filtered.isEmpty)
                      // مسافةٌ تحتها حتى لا يغطّيها زرُّ «تسليم عهدة».
                      SliverPadding(padding: const EdgeInsets.only(bottom: 90), sliver: SliverToBoxAdapter(child: EmptyState(icon: Icons.devices_other_outlined,
                          title: _anyFilter ? tr('لا توجد عهد مطابقة للفلتر الحالي.', 'Nothing matches the current filter.') : tr('لا توجد عهد مسجّلة.', 'No custody items found.'))))
                    else
                      SliverPadding(
                        padding: const EdgeInsets.fromLTRB(14, 8, 14, 90),
                        sliver: SliverList.separated(
                          itemCount: filtered.length,
                          separatorBuilder: (_, __) => const SizedBox(height: 8),
                          itemBuilder: (c, i) => _row(filtered[i], canEdit),
                        ),
                      ),
                  ]),
                ),
    );
  }

  Widget _mini(String label, String value, Color color, {VoidCallback? onTap}) => Expanded(
        child: Pressable(
          onTap: onTap ?? () {},
          child: Container(
            padding: const EdgeInsets.symmetric(vertical: 8, horizontal: 8),
            decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(12), border: Border.all(color: onTap != null ? T.orange : T.line)),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(value, style: TextStyle(fontSize: 15, fontWeight: FontWeight.w900, color: color)),
              Text(label, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 10.5, color: T.inkSoft, fontWeight: FontWeight.w600)),
            ]),
          ),
        ),
      );

  Widget _chip(String label, bool on, Color color, VoidCallback onTap) => FilterChip(
        selected: on,
        onSelected: (_) => onTap(),
        label: Text(label),
        labelStyle: TextStyle(fontSize: 11.5, fontWeight: FontWeight.w700, color: on ? Colors.white : T.inkSoft),
        selectedColor: color,
        backgroundColor: T.line.withValues(alpha: 0.35),
        checkmarkColor: Colors.white,
        side: BorderSide.none,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
      );

  Widget _row(Map<String, dynamic> r, bool canEdit) {
    final assigned = r['status'] == 'assigned';
    return Pressable(
      onTap: () => _detailsSheet(context, r, canEdit),
      child: AppCard(
        topAccent: assigned ? T.success : r['status'] == 'returned' ? T.danger : r['status'] == 'sold' ? T.violet : T.inkFaint,
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            Expanded(child: Text((r['name'] ?? '').toString(), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14))),
            Chip2(custodyTypeLabel(r['type']), T.navy),
          ]),
          if ('${r['specs'] ?? ''}'.isNotEmpty) Text('${r['specs']}', maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 11.5, color: T.inkFaint)),
          const SizedBox(height: 5),
          Wrap(spacing: 6, runSpacing: 6, children: [
            if (r['employee'] != null) Chip2(itEmpName(r['employee']), T.info, icon: Icons.person_outline),
            if ((r['serialNumber'] ?? '').toString().isNotEmpty) Chip2('${r['serialNumber']}', T.inkFaint, icon: Icons.qr_code_2),
            if ((r['condition'] ?? '').toString().isNotEmpty) Chip2(conditionLabel(r['condition']), T.warn),
            if (assigned && r['assignedDate'] != null) Chip2(itDate(r['assignedDate']), T.inkFaint, icon: Icons.event_outlined),
            if (r['status'] == 'in_stock') Chip2(tr('المستودع', 'In store'), T.info, icon: Icons.inventory_2_outlined),
            if (r['status'] == 'returned') Chip2('${tr('تالف', 'Faulty')} ${r['returnedDate'] != null ? itDate(r['returnedDate']) : ''}', T.danger),
            // Who recorded the return.
            if (r['status'] == 'returned' && r['returnedTo'] is Map) Chip2('${tr('سجّله', 'By')} ${'${r['returnedTo']['firstName'] ?? ''} ${r['returnedTo']['lastName'] ?? ''}'.trim()}', T.inkSoft, icon: Icons.person_pin_outlined),
            // المُباعُ يقول ثمنَه في الوسم.
            if (r['status'] == 'sold') Chip2('${tr('مُباع', 'Sold')}${r['soldPrice'] is num && r['soldPrice'] > 0 ? ' · ${fmtMoney(r['soldPrice'])}' : ''}', T.violet, icon: Icons.sell_outlined),
          ]),
        ]),
      ),
    );
  }

  // ── details + actions — نفس أزرار صفّ الجدول في الويب ──
  Future<void> _detailsSheet(BuildContext context, Map<String, dynamic> r, bool canEdit) async {
    final assigned = r['status'] == 'assigned';
    await showModalBottomSheet(
      context: context,
      builder: (c) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text((r['name'] ?? '').toString(), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16)),
            const SizedBox(height: 4),
            Text(
              '${custodyTypeLabel(r['type'])}${(r['brand'] ?? '').toString().isNotEmpty ? ' · ${r['brand']}' : ''}'
              '${(r['serialNumber'] ?? '').toString().isNotEmpty ? ' · ${r['serialNumber']}' : ''}'
              '${r['value'] is num && r['value'] > 0 ? ' · ${fmtMoney(r['value'])}' : ''}',
              style: const TextStyle(fontSize: 12.5, color: T.inkSoft),
            ),
            if (r['employee'] != null) ...[
              const SizedBox(height: 6),
              Chip2('${tr('بحوزة', 'Held by')}: ${itEmpName(r['employee'])}', T.info, icon: Icons.person_outline),
            ],
            if (r['status'] == 'sold') ...[
              const SizedBox(height: 6),
              Text('${tr('بيع إلى', 'Sold to')} ${r['soldTo'] is Map ? itEmpName(r['soldTo']) : (r['soldToName'] ?? '—')}'
                  '${r['soldPrice'] is num ? ' · ${fmtMoney(r['soldPrice'])}' : ''}${r['soldDate'] != null ? ' · ${'${r['soldDate']}'.split('T').first}' : ''}',
                  style: const TextStyle(fontSize: 12, color: T.violet)),
            ],
            const SizedBox(height: 14),
            Wrap(spacing: 8, runSpacing: 8, children: [
              if (canEdit && assigned) _action(c, Icons.assignment_return_outlined, tr('استرجاع', 'Return'), T.success, () => _returnItem(context, r)),
              if (canEdit && assigned) _action(c, Icons.swap_horiz_rounded, tr('نقل لموظف آخر', 'Transfer'), T.navy, () => _transfer(context, r)),
              if (canEdit && r['status'] != 'returned' && r['status'] != 'sold')
                _action(c, Icons.report_gmailerrorred_outlined, tr('تالف', 'Faulty'), T.danger, () => _faulty(context, r)),
              if (canEdit && r['status'] == 'sold')
                _action(c, Icons.undo_rounded, tr('إرجاع المبيع إلى المخزن', 'Return sale to store'), T.success, () => _unsell(context, r)),
              if (canEdit && r['status'] != 'sold')
                _action(c, Icons.sell_outlined, tr('بيع للموظف', 'Sell'), T.violet, () => _sell(context, r)),
              _action(c, Icons.history_rounded, tr('سجل الحركة', 'Movement history'), T.violet, () => _history(context, r)),
              if (r['employee'] is Map)
                _action(c, Icons.badge_outlined, tr('عهد الموظف', 'Employee custody'), T.info, () => _byEmployee(context, r['employee'] as Map)),
              if (canEdit) _action(c, Icons.edit_outlined, tr('تعديل', 'Edit'), T.orange, () => _custodyForm(context, r)),
              if (canEdit) _action(c, Icons.delete_outline, tr('حذف', 'Delete'), T.danger, () => _delete(context, r)),
            ]),
            const SizedBox(height: 6),
          ]),
        ),
      ),
    );
  }

  Widget _action(BuildContext sheet, IconData icon, String label, Color color, Future<void> Function() run) =>
      ActionChip(
        avatar: Icon(icon, size: 17, color: color),
        label: Text(label, style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700, color: color)),
        backgroundColor: color.withValues(alpha: 0.08),
        side: BorderSide.none,
        onPressed: () { Navigator.pop(sheet); run(); },
      );

  void _snack(String m) { if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(m))); }

  Future<bool> _post(String path, Map<String, dynamic> body, String okMsg) async {
    try {
      await Api.instance.post(path, body);
      _snack(okMsg);
      _refresh();
      return true;
    } catch (e) {
      _snack(e is ApiException ? e.message : e.toString());
      return false;
    }
  }

  Widget _conditionDropdown(String value, ValueChanged<String> on, {String? label}) => DropdownButtonFormField<String>(
        initialValue: custodyConditions.containsKey(value) ? value : null,
        isExpanded: true,
        decoration: InputDecoration(labelText: label ?? tr('الحالة الفنية', 'Condition'), isDense: true),
        items: custodyConditions.entries.map((e) => DropdownMenuItem(value: e.key, child: Text(tr(e.value.$1, e.value.$2)))).toList(),
        onChanged: (v) => on(v ?? value),
      );

  Widget _picker(String label, String text, VoidCallback onTap) => InkWell(
        onTap: onTap,
        child: InputDecorator(
          decoration: InputDecoration(labelText: label, isDense: true, suffixIcon: const Icon(Icons.arrow_drop_down)),
          child: Text(text.isEmpty ? '—' : text, style: TextStyle(fontSize: 13, color: text.isEmpty ? T.inkFaint : T.ink)),
        ),
      );

  Future<bool?> _dialog(BuildContext context, String title, String okLabel, Widget Function(StateSetter setS) body, {Color? okColor}) =>
      showDialog<bool>(
        context: context,
        builder: (c) => StatefulBuilder(builder: (c, setS) => AlertDialog(
          title: Text(title),
          content: SingleChildScrollView(child: body(setS)),
          actions: [
            TextButton(onPressed: () => Navigator.pop(c, false), child: Text(tr('إلغاء', 'Cancel'))),
            FilledButton(style: okColor == null ? null : FilledButton.styleFrom(backgroundColor: okColor), onPressed: () => Navigator.pop(c, true), child: Text(okLabel)),
          ],
        )),
      );

  // ── تسليم عهدة (من المخزن أو جديد) / تعديل ──
  Future<void> _custodyForm(BuildContext context, Map<String, dynamic>? editing) async {
    // من المخزن هو الطريقُ الأفضل فهو الافتراضيّ — إلّا والرفُّ فارغ.
    String mode = editing != null ? 'new' : (_stock.isNotEmpty ? 'stock' : 'new');
    Map<String, dynamic>? emp = editing?['employee'] is Map ? Map<String, dynamic>.from(editing!['employee']) : null;
    Map<String, dynamic>? picked;
    String type = '${editing?['type'] ?? 'laptop'}';
    String condition = '${editing?['condition'] ?? 'good'}';
    String assignedDate = editing == null ? todayYmd() : '${editing['assignedDate'] ?? ''}'.split('T').first;
    final brand = TextEditingController(text: '${editing?['brand'] ?? ''}');
    final serial = TextEditingController(text: '${editing?['serialNumber'] ?? ''}');
    final specs = TextEditingController(text: '${editing?['specs'] ?? ''}');
    final value = TextEditingController(text: '${editing?['value'] ?? 0}');
    final notes = TextEditingController(text: '${editing?['notes'] ?? ''}');
    final tel = Map<String, dynamic>.from((editing?['telecom'] as Map?) ?? {});
    final pkg = TextEditingController(text: '${tel['package'] ?? ''}');
    final provider = TextEditingController(text: '${tel['provider'] ?? ''}');
    final iccid = TextEditingController(text: '${tel['iccid'] ?? ''}');
    final months = TextEditingController(text: '${tel['contractMonths'] ?? ''}');
    String expiry = '${tel['expiryDate'] ?? ''}'.split('T').first;
    final authorized = TextEditingController(text: '${tel['authorizedName'] ?? ''}');

    final ok = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (c) => StatefulBuilder(builder: (c, setS) {
        final canSave = emp != null && (editing != null || mode == 'new' || picked != null);
        return SafeArea(
          child: Padding(
            padding: EdgeInsets.fromLTRB(16, 16, 16, MediaQuery.of(c).viewInsets.bottom + 16),
            child: SingleChildScrollView(
              child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                Text(editing != null ? tr('تعديل العهدة', 'Edit custody item') : tr('تسليم عهدة', 'Assign custody item'),
                    style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
                const SizedBox(height: 12),
                if (editing == null) ...[
                  SegmentedButton<String>(
                    segments: [
                      ButtonSegment(value: 'stock', label: Text(tr('من المخزن', 'From stock'))),
                      ButtonSegment(value: 'new', label: Text(tr('جديد مباشرة', 'Brand new'))),
                    ],
                    selected: {mode},
                    onSelectionChanged: (s) => setS(() => mode = s.first),
                  ),
                  const SizedBox(height: 12),
                ],
                // الموظّفُ لا يتغيّر في التعديل — النقلُ إجراءٌ له سجلّه.
                IgnorePointer(
                  ignoring: editing != null,
                  child: _picker(tr('الموظف', 'Employee'), emp == null ? '' : itEmpName(emp), () async {
                    final e = await pickItEmployee(c);
                    if (e != null) setS(() => emp = e);
                  }),
                ),
                const SizedBox(height: 10),
                if (editing == null && mode == 'stock') ...[
                  if (_stock.isEmpty)
                    Container(
                      padding: const EdgeInsets.all(10),
                      decoration: BoxDecoration(color: const Color(0xFFFFFBEB), borderRadius: BorderRadius.circular(10), border: Border.all(color: const Color(0xFFFDE68A))),
                      child: Text(tr('المستودع فارغ حالياً — استخدم "جديد مباشرة" أو أضف أصنافاً في صفحة المستودع.', 'Stock is empty — use "Brand new", or add items on the Stock page.'),
                          style: const TextStyle(fontSize: 12, color: Color(0xFF92400E))),
                    )
                  else
                    _picker(tr('الجهاز من المخزن', 'Item from stock'),
                        picked == null ? '' : '${picked!['name']}${'${picked!['serialNumber'] ?? ''}'.isEmpty ? '' : ' — ${picked!['serialNumber']}'}', () async {
                      final s = await pickFromList(c, title: tr('الجهاز من المخزن', 'Item from stock'), items: _stock,
                          label: (s) => '${s['name']}${'${s['serialNumber'] ?? ''}'.isEmpty ? '' : ' — ${s['serialNumber']}'}',
                          hint: (s) => custodyTypeLabel(s['type']));
                      if (s != null) setS(() => picked = s);
                    }),
                ] else ...[
                  DropdownButtonFormField<String>(
                    initialValue: bucketOf(type),
                    decoration: InputDecoration(labelText: tr('النوع', 'Type'), isDense: true),
                    items: custodyBuckets.map((b) => DropdownMenuItem(value: b.key, child: Text(b.label))).toList(),
                    onChanged: type == 'sim' ? null : (v) => setS(() {
                      type = custodyBuckets.firstWhere((x) => x.key == v, orElse: () => custodyBuckets.last).canonicalType;
                    }),
                  ),
                  if (bucketOf(type) == 'other' && type != 'sim') ...[
                    const SizedBox(height: 10),
                    DropdownButtonFormField<String>(
                      initialValue: otherBucketTypes.contains(type) ? type : 'other',
                      decoration: InputDecoration(labelText: tr('أي نوع من «أخرى»؟', 'Which kind of "Other"?'), isDense: true),
                      items: otherBucketTypes.map((t) => DropdownMenuItem(value: t, child: Text(custodyTypeLabel(t)))).toList(),
                      onChanged: (v) => setS(() => type = v ?? type),
                    ),
                  ],
                  const SizedBox(height: 10),
                  Row(children: [
                    Expanded(child: TextField(controller: brand, onChanged: (_) => setS(() {}), decoration: InputDecoration(labelText: tr('الماركة', 'Brand'), hintText: tr('مثال: Dell', 'e.g. Dell')))),
                    const SizedBox(width: 8),
                    Expanded(child: TextField(controller: serial, decoration: InputDecoration(labelText: tr('الرقم التسلسلي', 'Serial number')))),
                  ]),
                  const SizedBox(height: 10),
                  // معاينةُ الاسم كما سيُحفظ — الاسمُ مشتقٌّ لا يُكتب.
                  Container(
                    padding: const EdgeInsets.all(10),
                    decoration: BoxDecoration(color: T.line.withValues(alpha: 0.30), borderRadius: BorderRadius.circular(10)),
                    child: Row(children: [
                      Text(tr('سيُسجَّل باسم', 'Will be recorded as'), style: const TextStyle(fontSize: 11.5, color: T.inkSoft)),
                      const SizedBox(width: 8),
                      Expanded(child: Text(deriveAssetName(type, brand.text), style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w800))),
                    ]),
                  ),
                  const SizedBox(height: 10),
                  Row(children: [
                    Expanded(child: _conditionDropdown(condition, (v) => setS(() => condition = v))),
                    const SizedBox(width: 8),
                    Expanded(child: TextField(controller: value, keyboardType: TextInputType.number, decoration: InputDecoration(labelText: tr('القيمة للقطعة الواحدة', 'Value per single unit')))),
                  ]),
                  // خطُّ الجوّال يُوصَف بباقةٍ وعقدٍ وشريحةٍ ومفوَّضٍ لدى المزوّد.
                  if (type == 'sim') ...[
                    const SizedBox(height: 10),
                    LookupField(type: 'telecom_package', controller: pkg, label: tr('الباقة', 'Package')),
                    const SizedBox(height: 10),
                    LookupField(type: 'telecom_provider', controller: provider, label: tr('المزوّد', 'Provider')),
                    const SizedBox(height: 10),
                    TextField(controller: iccid, decoration: InputDecoration(labelText: tr('الرقم التسلسلي للشريحة', 'SIM serial (ICCID)'))),
                    const SizedBox(height: 10),
                    Row(children: [
                      Expanded(child: TextField(controller: months, keyboardType: TextInputType.number, decoration: InputDecoration(labelText: tr('مدة العقد (شهر)', 'Contract (months)')))),
                      const SizedBox(width: 8),
                      Expanded(child: ItDateField(label: tr('تاريخ انتهاء العقد', 'Contract expiry'), value: expiry, clearable: true, onChanged: (v) => setS(() => expiry = v))),
                    ]),
                    const SizedBox(height: 10),
                    TextField(controller: authorized, decoration: InputDecoration(labelText: tr('اسم المفوَّض لدى المزوّد', 'Authorised with the provider'), hintText: tr('قد يختلف عن المستخدم الحالي', 'May differ from the current user'))),
                  ],
                  const SizedBox(height: 10),
                  TextField(controller: specs, decoration: InputDecoration(labelText: tr('المواصفات', 'Specs'), hintText: 'i7 / 16GB / 512GB SSD')),
                ],
                const SizedBox(height: 10),
                ItDateField(label: tr('تاريخ التسليم', 'Assigned date'), value: assignedDate, onChanged: (v) => setS(() => assignedDate = v)),
                const SizedBox(height: 10),
                TextField(controller: notes, maxLines: 2, decoration: InputDecoration(labelText: tr('ملاحظات', 'Notes'))),
                const SizedBox(height: 14),
                FilledButton(onPressed: canSave ? () => Navigator.pop(c, true) : null, child: Text(tr('حفظ', 'Save'))),
              ]),
            ),
          ),
        );
      }),
    );
    if (ok != true || emp == null) return;
    try {
      if (editing == null && mode == 'stock') {
        // نفسُ المستند يغادر الرفَّ إلى الموظّف — بسيرته ورقمه التسلسلي، وبلا حالةٍ فنّية.
        await Api.instance.post('/api/it/stock/${picked!['_id']}/assign', {'employee': emp!['_id'], 'assignedDate': assignedDate, 'notes': notes.text});
      } else {
        // الاسمُ لا يُرسل: الخادمُ يشتقّه من النوع والماركة.
        final body = {
          'employee': emp!['_id'], 'type': type, 'condition': condition, 'brand': brand.text.trim(),
          'serialNumber': serial.text.trim(), 'specs': specs.text.trim(), 'value': num.tryParse(value.text.trim()) ?? 0,
          'assignedDate': assignedDate, 'notes': notes.text,
          if (type == 'sim') 'telecom': {
            ...tel, 'package': pkg.text.trim(), 'provider': provider.text.trim(), 'iccid': iccid.text.trim(),
            'contractMonths': months.text.trim().isEmpty ? null : num.tryParse(months.text.trim()),
            'expiryDate': expiry, 'authorizedName': authorized.text.trim(),
          },
        };
        if (editing != null) { await Api.instance.put('/api/it/custody/${editing['_id']}', body); }
        else { await Api.instance.post('/api/it/custody', body); }
      }
      _snack(tr('تم الحفظ', 'Saved'));
      _refresh();
    } catch (e) {
      _snack(e is ApiException ? e.message : e.toString());
    }
  }

  Future<void> _delete(BuildContext context, Map<String, dynamic> r) async {
    final ok = await _dialog(context, tr('حذف هذه العهدة؟', 'Delete this custody item?'), tr('حذف', 'Delete'),
        (_) => Text('${r['name'] ?? ''}'), okColor: T.danger);
    if (ok != true) return;
    try { await Api.instance.delete('/api/it/custody/${r['_id']}'); _refresh(); } catch (e) { _snack(e is ApiException ? e.message : '$e'); }
  }

  Future<void> _transfer(BuildContext context, Map<String, dynamic> r) async {
    Map<String, dynamic>? to;
    String date = todayYmd();
    String condition = '${r['condition'] ?? 'good'}';
    final notes = TextEditingController();
    final ok = await _dialog(context, tr('نقل العهدة لموظف آخر', 'Transfer to another employee'), tr('تأكيد النقل', 'Confirm transfer'), (setS) => Column(mainAxisSize: MainAxisSize.min, children: [
      Text('${tr('الحائز الحالي:', 'Currently held by:')} ${itEmpName(r['employee'])}${'${r['serialNumber'] ?? ''}'.isEmpty ? '' : ' · ${r['serialNumber']}'}', style: const TextStyle(fontSize: 12.5, color: T.inkSoft)),
      const SizedBox(height: 10),
      _picker(tr('الموظف الجديد', 'New holder'), to == null ? '' : itEmpName(to), () async {
        final e = await pickItEmployee(context);
        if (e != null) setS(() => to = e);
      }),
      const SizedBox(height: 10),
      ItDateField(label: tr('تاريخ النقل', 'Transfer date'), value: date, onChanged: (v) => setS(() => date = v)),
      const SizedBox(height: 10),
      _conditionDropdown(condition, (v) => setS(() => condition = v), label: tr('الحالة عند النقل', 'Condition at transfer')),
      const SizedBox(height: 10),
      TextField(controller: notes, maxLines: 2, decoration: InputDecoration(labelText: tr('ملاحظات', 'Notes'))),
    ]));
    if (ok != true || to == null) return;
    await _post('/api/it/custody/${r['_id']}/transfer', {'toEmployee': to!['_id'], 'date': date, 'condition': condition, 'notes': notes.text},
        tr('نُقلت العهدة إلى ${itEmpName(to)}', 'Transferred to ${itEmpName(to)}'));
  }

  Future<void> _returnItem(BuildContext context, Map<String, dynamic> r) async {
    String condition = '${r['condition'] ?? 'good'}';
    String date = todayYmd();
    bool retire = false;
    final ok = await _dialog(context, tr('استرجاع العهدة', 'Return custody item'), tr('تأكيد الاسترجاع', 'Confirm return'), (setS) => Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Text(tr('استرجاع "${r['name']}" من ${itEmpName(r['employee'])}', 'Returning "${r['name']}" from ${itEmpName(r['employee'])}'), style: const TextStyle(fontSize: 12.5, color: T.inkSoft)),
      const SizedBox(height: 10),
      _conditionDropdown(condition, (v) => setS(() => condition = v), label: tr('الحالة عند الاسترجاع', 'Condition on return')),
      const SizedBox(height: 10),
      ItDateField(label: tr('تاريخ الاسترجاع', 'Return date'), value: date, onChanged: (v) => setS(() => date = v)),
      const SizedBox(height: 10),
      Text(tr('وجهة الجهاز بعد الاسترجاع', 'Where does it go?'), style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700)),
      const SizedBox(height: 6),
      SegmentedButton<bool>(
        segments: [
          ButtonSegment(value: false, label: Text(tr('رجوع للمخزن', 'Back to stock'))),
          ButtonSegment(value: true, label: Text(tr('تالف', 'Faulty'))),
        ],
        selected: {retire},
        onSelectionChanged: (s) => setS(() => retire = s.first),
      ),
      const SizedBox(height: 8),
      Text(retire
          ? tr('سيُسجَّل الجهاز كتالف ولن يظهر في المستودع.', 'The device is recorded as faulty and will not appear in stock.')
          : tr('سيعود الجهاز إلى المستودع جاهزاً للتسليم لموظف آخر، مع الاحتفاظ بسجله الكامل.', 'The device returns to stock, ready to hand to someone else, keeping its full history.'),
          style: const TextStyle(fontSize: 11, color: T.inkFaint)),
    ]));
    if (ok != true) return;
    await _post('/api/it/custody/${r['_id']}/return', {'returnedCondition': condition, 'returnedDate': date, 'retire': retire},
        tr('تم الاسترجاع', 'Returned'));
  }

  /// بيعُ صنفٍ من العهدة — المشتري موظّفٌ من القائمة أو اسمٌ حرٌّ، أحدُهما لا كلاهما.
  Future<void> _sell(BuildContext context, Map<String, dynamic> r) async {
    // المشتري الافتراضيُّ هو حائزُه.
    Map<String, dynamic>? buyer = r['employee'] is Map ? Map<String, dynamic>.from(r['employee']) : null;
    final buyerName = TextEditingController();
    final price = TextEditingController(text: '${r['value'] ?? 0}');
    final notes = TextEditingController();
    String date = todayYmd();
    final ok = await _dialog(context, tr('بيع الصنف', 'Sell item'), tr('تأكيد البيع', 'Confirm sale'), (setS) => Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Text('${r['name'] ?? ''}${'${r['serialNumber'] ?? ''}'.isEmpty ? '' : ' · ${r['serialNumber']}'}', style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700)),
      const SizedBox(height: 10),
      Row(children: [
        Expanded(child: _picker(tr('المشتري (موظف)', 'Buyer (employee)'), buyer == null ? '' : itEmpName(buyer), () async {
          final e = await pickItEmployee(context);
          if (e != null) setS(() { buyer = e; buyerName.clear(); });
        })),
        if (buyer != null) IconButton(icon: const Icon(Icons.close, size: 18), onPressed: () => setS(() => buyer = null)),
      ]),
      const SizedBox(height: 10),
      TextField(controller: buyerName, enabled: buyer == null, decoration: InputDecoration(labelText: tr('أو مشترٍ من خارج الشركة', 'Or an outside buyer'), hintText: tr('اسم المشتري', 'Buyer name'))),
      const SizedBox(height: 10),
      Row(children: [
        Expanded(child: TextField(controller: price, keyboardType: TextInputType.number, decoration: InputDecoration(labelText: tr('الثمن المدفوع للحسابات', 'Price paid to accounting')))),
        const SizedBox(width: 8),
        Expanded(child: ItDateField(label: tr('تاريخ البيع', 'Sale date'), value: date, onChanged: (v) => setS(() => date = v))),
      ]),
      const SizedBox(height: 10),
      TextField(controller: notes, decoration: InputDecoration(labelText: tr('ملاحظات', 'Notes'), hintText: tr('رقم سند القبض مثلًا', 'Receipt number, for example'))),
      const SizedBox(height: 8),
      Text(tr('بعد البيع يخرج الصنف من العهدة ومن المخزون معًا، ويبقى صفّه في السجل يقول لمن بيع وبكم ومتى.',
              'Once sold, the item leaves both custody and stock, and its row stays in the register recording who bought it, for how much, and when.'),
          style: const TextStyle(fontSize: 11, color: T.inkFaint)),
    ]));
    if (ok != true) return;
    if (buyer == null && buyerName.text.trim().isEmpty) { _snack(tr('اختر المشتري', 'Pick a buyer')); return; }
    await _post('/api/it/custody/${r['_id']}/sell', {
      if (buyer != null) 'employee': buyer!['_id'],
      if (buyer == null) 'buyerName': buyerName.text.trim(),
      'price': num.tryParse(price.text.trim()) ?? 0, 'date': date, 'notes': notes.text,
    }, tr('تم البيع', 'Sold'));
  }

  /// إرجاعُ المُباع: يُلغى البيعُ ويُردّ الثمن، فيعود الجهازُ نفسُه إلى المخزن.
  Future<void> _unsell(BuildContext context, Map<String, dynamic> r) async {
    final refund = TextEditingController(text: '${r['soldPrice'] ?? 0}');
    final notes = TextEditingController();
    String date = todayYmd();
    final ok = await _dialog(context, tr('إرجاع المبيع إلى المخزن', 'Return sale to store'), tr('تأكيد الإرجاع', 'Confirm return'), (setS) => Column(mainAxisSize: MainAxisSize.min, children: [
      Row(children: [
        Expanded(child: TextField(controller: refund, keyboardType: TextInputType.number, decoration: InputDecoration(labelText: tr('المبلغ المردود للموظف', 'Amount refunded')))),
        const SizedBox(width: 8),
        Expanded(child: ItDateField(label: tr('تاريخ الإرجاع', 'Return date'), value: date, onChanged: (v) => setS(() => date = v))),
      ]),
      const SizedBox(height: 10),
      TextField(controller: notes, decoration: InputDecoration(labelText: tr('ملاحظات', 'Notes'))),
      const SizedBox(height: 8),
      Text(tr('يرجع الصنف نفسه إلى المخزن بحالة «في المخزن»، ويبقى البيع ثم الإرجاع والمبلغ المردود في سجل حركته.',
              'The same item goes back to stock; its history keeps the sale, then this return and the refunded amount.'),
          style: const TextStyle(fontSize: 11, color: T.inkFaint)),
    ]));
    if (ok != true) return;
    await _post('/api/it/custody/${r['_id']}/unsell', {'refund': num.tryParse(refund.text.trim()) ?? 0, 'date': date, 'notes': notes.text},
        tr('رجع الصنف إلى المخزن', 'Item is back in stock'));
  }

  /// «تالف» — يكتب البلاغ بسببه وخصمه، وينقل الصنف إلى «تالف».
  Future<void> _faulty(BuildContext context, Map<String, dynamic> r) async {
    String kind = 'damaged';
    String date = todayYmd();
    final notes = TextEditingController();
    final cost = TextEditingController(text: '0');
    final ok = await _dialog(context, tr('تالف', 'Faulty'), tr('تسجيل', 'Record'), okColor: T.danger, (setS) => Column(mainAxisSize: MainAxisSize.min, children: [
      Text('${r['name'] ?? ''}${r['employee'] != null ? ' — ${itEmpName(r['employee'])}' : ''}', style: const TextStyle(fontSize: 12.5, color: T.inkSoft)),
      const SizedBox(height: 10),
      SegmentedButton<String>(
        segments: [
          ButtonSegment(value: 'damaged', label: Text(tr('تالف', 'Damaged'))),
          ButtonSegment(value: 'lost', label: Text(tr('مفقود', 'Lost'))),
        ],
        selected: {kind},
        onSelectionChanged: (s) => setS(() => kind = s.first),
      ),
      const SizedBox(height: 8),
      Text(
        kind == 'damaged'
            ? tr('يخرج الصنف من التداول ويظهر تحت «تالف»، وتصير حالته الفنية «تالف». يبقى اسم من كان يحمله مسجّلاً عليه ولا يُحسب عليه عهدةً قائمة.',
                'The item leaves circulation and appears under "Faulty", with its condition set to damaged. Who was holding it stays on the record, but it no longer counts as outstanding custody.')
            : tr('يخرج الصنف من التداول لأنه لم يعد موجوداً، ويبقى البلاغ باسم من كان يحمله.',
                'The item leaves circulation because it no longer exists; the report stays under whoever was holding it.'),
        style: const TextStyle(fontSize: 11, color: T.inkSoft),
      ),
      const SizedBox(height: 10),
      ItDateField(label: tr('التاريخ', 'Date'), value: date, onChanged: (v) => setS(() => date = v)),
      const SizedBox(height: 10),
      TextField(controller: cost, keyboardType: TextInputType.number, decoration: InputDecoration(labelText: tr('قيمة الخصم (إن وُجد)', 'Amount charged (if any)'))),
      const SizedBox(height: 10),
      TextField(controller: notes, maxLines: 2, decoration: InputDecoration(labelText: tr('ملاحظات', 'Notes'))),
    ]));
    if (ok != true) return;
    await _post('/api/it/custody/${r['_id']}/report', {
      'kind': kind, 'date': date, 'notes': notes.text, 'cost': num.tryParse(cost.text.trim()) ?? 0,
    }, tr('سُجِّل الصنف كتالف', 'Recorded as faulty'));
  }

  Future<void> _history(BuildContext context, Map<String, dynamic> r) async {
    List<Map<String, dynamic>> events = [];
    try {
      final d = await Api.instance.get('/api/it/custody/${r['_id']}/history');
      events = List<Map<String, dynamic>>.from(d['events'] ?? []);
    } catch (_) {}
    if (!context.mounted) return;
    _eventsSheet(context, '${tr('سجل حركة الصنف', 'Item movement history')} — ${r['name'] ?? ''}', events);
  }

  void _eventsSheet(BuildContext context, String title, List<Map<String, dynamic>> events, {List<Map<String, dynamic>>? held}) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (c) => SafeArea(
        child: SizedBox(
          height: MediaQuery.of(c).size.height * 0.75,
          child: ListView(padding: const EdgeInsets.all(16), children: [
            Text(title, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
            if (held != null) ...[
              const SizedBox(height: 10),
              Text(tr('بعهدته الآن (${held.length})', 'Holds now (${held.length})'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13, color: T.inkSoft)),
              const SizedBox(height: 6),
              if (held.isEmpty) Text(tr('لا توجد عهد على هذا الموظف.', 'This employee holds no custody items.'), style: const TextStyle(fontSize: 12, color: T.inkFaint)),
              for (final it in held)
                ListTile(
                  dense: true, contentPadding: EdgeInsets.zero,
                  leading: const Icon(Icons.devices_other_outlined, size: 18),
                  title: Text('${it['name'] ?? ''}', style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13)),
                  subtitle: Text([custodyTypeLabel(it['type']), it['serialNumber'], if (it['assignedDate'] != null) '${tr('منذ', 'since')} ${itDate(it['assignedDate'])}']
                      .where((x) => x != null && '$x'.isNotEmpty).join(' · '), style: const TextStyle(fontSize: 11.5)),
                ),
              const Divider(),
              Text(tr('الحركات', 'Movements'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13, color: T.inkSoft)),
            ],
            const SizedBox(height: 8),
            if (events.isEmpty) EmptyState(icon: Icons.history, title: tr('لا توجد حركات مسجلة.', 'No movements recorded yet.')),
            for (final e in events) Builder(builder: (_) {
              final m = _actionLabels[e['action']] ?? ('${e['action'] ?? '—'}', '${e['action'] ?? '—'}', T.inkFaint);
              return ListTile(
                dense: true,
                contentPadding: EdgeInsets.zero,
                leading: CircleAvatar(radius: 14, backgroundColor: m.$3.withValues(alpha: 0.12), child: Icon(Icons.circle, size: 9, color: m.$3)),
                title: Text('${tr(m.$1, m.$2)}${e['asset'] is Map ? ' — ${(e['asset'] as Map)['name'] ?? ''}' : ''}', style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13)),
                subtitle: Text([
                  itDate(e['date'] ?? e['createdAt']),
                  if (e['fromEmployee'] != null) '${tr('من', 'from')} ${itEmpName(e['fromEmployee'])}',
                  if (e['toEmployee'] != null) '${tr('إلى', 'to')} ${itEmpName(e['toEmployee'])}',
                  if ('${e['notes'] ?? ''}'.isNotEmpty) e['notes'],
                  if (e['cost'] is num && e['cost'] > 0) '${tr('خصم', 'charged')} ${fmtMoney(e['cost'])}',
                  '${tr('سجّلها', 'recorded by')} ${e['byName'] ?? '—'}',
                ].join(' · '), style: const TextStyle(fontSize: 11.5)),
              );
            }),
          ]),
        ),
      ),
    );
  }

  /// عهدُ موظّفٍ واحد: ما بيده الآن وحركاتُه — /custody/by-employee/:id.
  Future<void> _byEmployee(BuildContext context, Map emp) async {
    Map d = {};
    try { d = await Api.instance.get('/api/it/custody/by-employee/${emp['_id']}'); } catch (_) {}
    if (!context.mounted) return;
    _eventsSheet(context, '${tr('عهد', 'Custody of')} ${itEmpName(emp)}',
        List<Map<String, dynamic>>.from(d['history'] ?? []), held: List<Map<String, dynamic>>.from(d['assigned'] ?? []));
  }

  /// مكتبُ الاستلام: يُختار الموظّف فتُعلَّم كلُّ عهده، ومن استلم بعضَها يرفع علامةَ ما لم يستلم.
  Future<void> _handover(BuildContext context) async {
    final emp = await pickItEmployee(context, title: tr('استلام عهدة من موظف', 'Receive custody from an employee'));
    if (emp == null || !context.mounted) return;
    List<Map<String, dynamic>> held = [];
    try {
      final d = await Api.instance.get('/api/it/custody/by-employee/${emp['_id']}');
      held = List<Map<String, dynamic>>.from(d['assigned'] ?? []);
    } catch (_) {}
    if (!context.mounted) return;
    final picked = held.map((i) => '${i['_id']}').toSet();
    String date = todayYmd();
    String condition = 'good';
    String outcome = 'stock';
    final notes = TextEditingController();
    final price = TextEditingController(text: '0');
    final ok = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (c) => StatefulBuilder(builder: (c, setS) => SafeArea(child: Padding(
        padding: EdgeInsets.fromLTRB(16, 16, 16, MediaQuery.of(c).viewInsets.bottom + 16),
        child: SingleChildScrollView(child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Text('${tr('استلام عهدة من', 'Receive custody from')} ${itEmpName(emp)}', style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 15)),
          const SizedBox(height: 10),
          if (held.isEmpty)
            Text(tr('لا توجد عهد على هذا الموظف.', 'This employee holds no custody items.'), style: const TextStyle(color: T.inkFaint))
          else ...[
            Row(children: [
              Expanded(child: Text(tr('بعهدته ${held.length} صنف — علِّم على ما استلمته', 'Holds ${held.length} item(s) — tick what was handed back'),
                  style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: T.inkSoft))),
              TextButton(
                onPressed: () => setS(() => picked.length == held.length ? picked.clear() : picked.addAll(held.map((i) => '${i['_id']}'))),
                child: Text(picked.length == held.length ? tr('إلغاء التحديد', 'Clear all') : tr('تحديد الكل', 'Select all'), style: const TextStyle(fontSize: 12)),
              ),
            ]),
            for (final it in held)
              CheckboxListTile(
                dense: true,
                contentPadding: EdgeInsets.zero,
                value: picked.contains('${it['_id']}'),
                onChanged: (v) => setS(() => v == true ? picked.add('${it['_id']}') : picked.remove('${it['_id']}')),
                title: Text('${it['name'] ?? ''}', style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700)),
                subtitle: Text([custodyTypeLabel(it['type']), it['serialNumber'], if (it['assignedDate'] != null) '${tr('منذ', 'since')} ${itDate(it['assignedDate'])}']
                    .where((x) => x != null && '$x'.isNotEmpty).join(' · '), style: const TextStyle(fontSize: 11.5)),
              ),
            Text(tr('سيتبقى ${held.length - picked.length} صنف بعهدة الموظف بعد هذا الاستلام.', '${held.length - picked.length} item(s) will remain with the employee after this.'),
                style: const TextStyle(fontSize: 11.5, color: T.inkFaint)),
          ],
          if (picked.isNotEmpty) ...[
            const Divider(height: 22),
            Row(children: [
              Expanded(child: ItDateField(label: tr('تاريخ الاستلام', 'Handover date'), value: date, onChanged: (v) => setS(() => date = v))),
              const SizedBox(width: 8),
              Expanded(child: _conditionDropdown(condition, (v) => setS(() => condition = v), label: tr('الحالة عند الاستلام', 'Condition on return'))),
            ]),
            const SizedBox(height: 10),
            TextField(controller: notes, maxLines: 2, decoration: InputDecoration(labelText: tr('ملاحظات', 'Notes'))),
            const SizedBox(height: 10),
            Text(tr('مصير ما استُلم', 'What happens to them'), style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700)),
            const SizedBox(height: 6),
            SegmentedButton<String>(
              segments: [
                ButtonSegment(value: 'stock', label: Text(tr('يعود للمستودع', 'Back to store'), style: const TextStyle(fontSize: 11.5))),
                ButtonSegment(value: 'faulty', label: Text(tr('تالف', 'Faulty'), style: const TextStyle(fontSize: 11.5))),
                ButtonSegment(value: 'sold', label: Text(tr('اشتراه الموظف', 'Bought'), style: const TextStyle(fontSize: 11.5))),
              ],
              selected: {outcome},
              onSelectionChanged: (s) => setS(() => outcome = s.first),
            ),
            if (outcome == 'sold') ...[
              const SizedBox(height: 10),
              TextField(controller: price, keyboardType: TextInputType.number, decoration: InputDecoration(labelText: tr('الثمن المدفوع للحسابات (للصنف الواحد)', 'Price paid to accounting (per item)'))),
            ],
            const SizedBox(height: 14),
            FilledButton(
              onPressed: () => Navigator.pop(c, true),
              child: Text(outcome == 'sold'
                  ? tr('تأكيد بيع ${picked.length}', 'Confirm sale of ${picked.length}')
                  : tr('تأكيد استلام ${picked.length}', 'Confirm ${picked.length} item(s)')),
            ),
          ],
        ])),
      ))),
    );
    if (ok != true || picked.isEmpty) return;
    try {
      final d = await Api.instance.post('/api/it/custody/handover', {
        'employee': emp['_id'], 'items': picked.toList(), 'date': date, 'condition': condition, 'notes': notes.text,
        'retire': outcome == 'faulty', 'outcome': outcome, 'price': num.tryParse(price.text.trim()) ?? 0,
      });
      // ما بقي عليه يُقال صراحةً — وهو المقصودُ من الشاشة كلّها.
      final returned = d['returned'] ?? picked.length;
      final outstanding = ((d['outstanding'] as List?) ?? []).length;
      final verb = outcome == 'sold' ? tr('بيع', 'sold') : outcome == 'faulty' ? tr('سُجّل كتالف', 'recorded faulty') : tr('استلام', 'handed back');
      _snack(tr('تم $verb $returned صنف. المتبقي بعهدة الموظف: $outstanding صنف.', '$returned item(s) $verb. Still outstanding: $outstanding.'));
      _refresh();
    } catch (e) {
      _snack(e is ApiException ? e.message : e.toString());
    }
  }
}
