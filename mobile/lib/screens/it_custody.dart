import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';

/// عهد الأجهزة (IT) — the custody register with the full action set:
/// تسليم جديد، نقل، إرجاع للمستودع، إبلاغ تلف/فقد، إخراج من الخدمة، السجل.
class ItCustodyScreen extends StatefulWidget {
  const ItCustodyScreen({super.key});
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
  'tablet': ('جهاز لوحي', 'Tablet'),
  'monitor': ('شاشة', 'Monitor'),
  'keyboard': ('كيبورد', 'Keyboard'),
  'mouse': ('ماوس', 'Mouse'),
  'keyboard_mouse': ('ماوس وكيبورد', 'Keyboard & mouse'),
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
  CustodyBucket('peripherals', 'ماوس وكيبورد', 'Mouse & Keyboard', 'keyboard_mouse', ['mouse', 'keyboard', 'keyboard_mouse'], Icons.keyboard_rounded),
  CustodyBucket('phones', 'موبايلات', 'Phones', 'phone', ['phone', 'tablet'], Icons.smartphone_rounded),
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

class _ItCustodyScreenState extends State<ItCustodyScreen> {
  List<Map<String, dynamic>> _rows = [];
  bool _loading = true;
  String? _error;
  String _q = '';
  // الفلاتر كلها تعمل على مجموعة محمّلة مرة واحدة: الكروت والأزرار تعرض
  // إجمالياتها من نفس المجموعة، ولو فلتر كلٌّ منها على الخادم لعرض كل كارت عدداً
  // محسوباً بعد فلتر الآخر — أي أعداداً لا تجمع على الكل.
  String _status = '';
  String _bucket = '';
  String _otherType = '';
  String _condition = '';
  late final void Function() _onLive;

  @override
  void initState() {
    super.initState();
    _load();
    _onLive = () => _load();
    Live.instance.on('it:updated', _onLive);
  }

  @override
  void dispose() {
    Live.instance.off('it:updated', _onLive);
    super.dispose();
  }

  Future<void> _load() async {
    try {
      // `scope=all` يضم المستودع: زر «المستودع» وكارت كل فئة يجب أن يعدّا
      // المخزون أيضاً، وبدونه تعرض الشاشة إجماليات ينقصها ثلث السجل.
      final d = await Api.instance.get('/api/it/custody?scope=all');
      if (!mounted) return;
      setState(() { _rows = List<Map<String, dynamic>>.from(d['items'] ?? []); _loading = false; _error = null; });
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  String _fold(String s) => s.replaceAll(RegExp('[أإآ]'), 'ا').replaceAll('ى', 'ي').replaceAll('ة', 'ه').toLowerCase();

  @override
  Widget build(BuildContext context) {
    final q = _fold(_q.trim());
    final filtered = _rows.where((r) {
      if (_bucket.isNotEmpty && bucketOf(r['type']) != _bucket) return false;
      if (_bucket == 'other' && _otherType.isNotEmpty && r['type'] != _otherType) return false;
      if (_status.isNotEmpty && r['status'] != _status) return false;
      if (_condition.isNotEmpty && r['condition'] != _condition) return false;
      if (q.isEmpty) return true;
      return [r['name'], r['serialNumber'], r['brand'], empName(r['employee'])]
          .any((x) => _fold((x ?? '').toString()).contains(q));
    }).toList();

    // الإجماليات تُحسب على المجموعة كاملة قبل أي فلتر — كارت يتغيّر رقمه كلما
    // فُلترت القائمة لا يصلح كإجمالي.
    int countBucket(String k) => _rows.where((r) => bucketOf(r['type']) == k).length;
    int countStatus(String k) => _rows.where((r) => r['status'] == k).length;

    // «خارج الخدمة» صارت «تالف» بطلب القسم: الأولى تصف موقعاً، وما يعنيه
    // المستودع فعلاً هو أن الصنف لم يعد صالحاً للتسليم.
    final statuses = {
      'assigned': (tr('بعهدة الموظف', 'With employee'), T.warn),
      'in_stock': (tr('المستودع', 'In store'), T.info),
      'returned': (tr('تالف', 'Faulty'), T.danger),
    };

    // الفلتر الثاني يعرض ما هو موجود فعلاً فقط: عرض كل نوع ممكن يعني خيارات
    // نتيجتها صفر.
    final otherKinds = otherBucketTypes
        .where((t) => _rows.any((r) => r['type'] == t))
        .toList();

    final conditionKeys = custodyConditions.keys
        .where((k) => _rows.any((r) => r['condition'] == k))
        .toList();

    return AppScaffold(
      title: Text(tr('عهد الأجهزة', 'IT Custody')),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => _newCustodySheet(context),
        icon: const Icon(Icons.add),
        label: Text(tr('تسليم عهدة', 'Assign')),
      ),
      body: _loading
          ? ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(height: 48), SizedBox(height: 10), Shimmer(), SizedBox(height: 10), Shimmer()])
          : _error != null
              ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
              : Column(children: [
                  Padding(
                    padding: const EdgeInsets.fromLTRB(14, 12, 14, 0),
                    child: TextField(
                      onChanged: (v) => setState(() => _q = v),
                      decoration: InputDecoration(hintText: tr('ابحث بالاسم أو الرقم التسلسلي أو الموظف…', 'Search…'), prefixIcon: const Icon(Icons.search)),
                    ),
                  ),
                  // كروت الفئات الخمس بإجمالياتها. الضغط يفلتر، والضغط ثانيةً يلغي.
                  SizedBox(
                    height: 84,
                    child: ListView.separated(
                      scrollDirection: Axis.horizontal,
                      padding: const EdgeInsets.fromLTRB(14, 10, 14, 4),
                      itemCount: custodyBuckets.length,
                      separatorBuilder: (_, __) => const SizedBox(width: 8),
                      itemBuilder: (c, i) {
                        final b = custodyBuckets[i];
                        final on = _bucket == b.key;
                        return Pressable(
                          onTap: () => setState(() { _bucket = on ? '' : b.key; _otherType = ''; }),
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
                              Text('${countBucket(b.key)}',
                                  style: TextStyle(fontSize: 20, fontWeight: FontWeight.w800, color: on ? T.orange : T.ink)),
                            ]),
                          ),
                        );
                      },
                    ),
                  ),

                  // الفلتر الثاني: أي نوع من «أخرى» بالضبط.
                  if (_bucket == 'other' && otherKinds.isNotEmpty)
                    Padding(
                      padding: const EdgeInsets.fromLTRB(14, 6, 14, 0),
                      child: Wrap(spacing: 6, runSpacing: 6, children: otherKinds.map((t) {
                        final on = _otherType == t;
                        return FilterChip(
                          selected: on,
                          onSelected: (_) => setState(() => _otherType = on ? '' : t),
                          label: Text(custodyTypeLabel(t)),
                          labelStyle: TextStyle(fontSize: 11.5, fontWeight: FontWeight.w700, color: on ? Colors.white : T.inkSoft),
                          selectedColor: T.orange,
                          backgroundColor: T.line.withValues(alpha: 0.35),
                          checkmarkColor: Colors.white,
                          side: BorderSide.none,
                          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
                        );
                      }).toList()),
                    ),

                  // أين الصنف الآن: بعهدة موظف، أو على الرف، أو تالف.
                  Padding(
                    padding: const EdgeInsets.fromLTRB(14, 8, 14, 4),
                    child: Row(
                      children: statuses.entries.map((e) {
                        final selected = _status == e.key;
                        return Expanded(
                          child: Padding(
                            padding: const EdgeInsets.only(left: 6),
                            child: Pressable(
                              onTap: () => setState(() => _status = selected ? '' : e.key),
                              child: Container(
                                padding: const EdgeInsets.symmetric(vertical: 9, horizontal: 8),
                                decoration: BoxDecoration(
                                  color: selected ? e.value.$2 : e.value.$2.withValues(alpha: 0.10),
                                  borderRadius: BorderRadius.circular(12),
                                  border: Border.all(color: selected ? e.value.$2 : Colors.transparent),
                                ),
                                child: Column(children: [
                                  Text('${countStatus(e.key)}',
                                      style: TextStyle(fontSize: 17, fontWeight: FontWeight.w800, color: selected ? Colors.white : e.value.$2)),
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

                  // الحالة الفنية — جديد، جيد، تالف…
                  if (conditionKeys.isNotEmpty)
                    Padding(
                      padding: const EdgeInsets.fromLTRB(14, 4, 14, 0),
                      child: Wrap(spacing: 6, runSpacing: 6, children: conditionKeys.map((k) {
                        final on = _condition == k;
                        return FilterChip(
                          selected: on,
                          onSelected: (_) => setState(() => _condition = on ? '' : k),
                          label: Text(conditionLabel(k)),
                          labelStyle: TextStyle(fontSize: 11.5, fontWeight: FontWeight.w700, color: on ? Colors.white : T.inkSoft),
                          selectedColor: T.navy,
                          backgroundColor: T.line.withValues(alpha: 0.35),
                          checkmarkColor: Colors.white,
                          side: BorderSide.none,
                          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
                        );
                      }).toList()),
                    ),
                  Expanded(
                    child: RefreshIndicator(
                      onRefresh: _load,
                      child: filtered.isEmpty
                          ? EmptyState(icon: Icons.devices_other_outlined, title: tr('لا توجد عهد مطابقة', 'No matches'))
                          : ListView.separated(
                              padding: const EdgeInsets.all(14),
                              itemCount: filtered.length,
                              separatorBuilder: (_, __) => const SizedBox(height: 8),
                              itemBuilder: (c, i) {
                                final r = filtered[i];
                                final assigned = r['status'] == 'assigned';
                                return FadeSlideIn(
                                  delayMs: (i * 15).clamp(0, 150),
                                  child: Pressable(
                                    onTap: () => _detailsSheet(context, r),
                                    child: AppCard(
                                      topAccent: assigned ? T.success : T.inkFaint,
                                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                        Row(children: [
                                          Expanded(child: Text((r['name'] ?? '').toString(), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14))),
                                          Chip2(custodyTypeLabel(r['type']), T.navy),
                                        ]),
                                        const SizedBox(height: 5),
                                        Wrap(spacing: 6, runSpacing: 6, children: [
                                          if (r['employee'] != null) Chip2(empName(r['employee']), T.info, icon: Icons.person_outline),
                                          if ((r['serialNumber'] ?? '').toString().isNotEmpty) Chip2(r['serialNumber'], T.inkFaint, icon: Icons.qr_code_2),
                                          if ((r['condition'] ?? '').toString().isNotEmpty) Chip2(conditionLabel(r['condition']), T.warn),
                                          if (r['status'] == 'in_stock') Chip2(tr('المستودع', 'In store'), T.info, icon: Icons.inventory_2_outlined),
                                          if (r['status'] == 'returned') Chip2(tr('تالف', 'Faulty'), T.danger),
                                        ]),
                                      ]),
                                    ),
                                  ),
                                );
                              },
                            ),
                    ),
                  ),
                ]),
    );
  }

  // ── employee picker (shared by assign/transfer) ──
  Future<Map<String, dynamic>?> _pickEmployee(BuildContext context) async {
    List<Map<String, dynamic>> emps = [];
    try {
      final d = await Api.instance.get('/api/it/employees');
      emps = List<Map<String, dynamic>>.from(d['employees'] ?? d['items'] ?? []);
    } catch (_) {}
    if (!context.mounted) return null;
    return showModalBottomSheet<Map<String, dynamic>>(
      context: context,
      isScrollControlled: true,
      builder: (c) {
        String q = '';
        return StatefulBuilder(builder: (c, setS) {
          final fq = _fold(q.trim());
          final list = emps.where((e) => fq.isEmpty || _fold('${empName(e)} ${e['employeeId'] ?? ''}').contains(fq)).toList();
          return SafeArea(
            child: Padding(
              padding: EdgeInsets.only(bottom: MediaQuery.of(c).viewInsets.bottom),
              child: SizedBox(
                height: MediaQuery.of(c).size.height * 0.7,
                child: Column(children: [
                  Padding(
                    padding: const EdgeInsets.all(14),
                    child: TextField(
                      autofocus: true,
                      onChanged: (v) => setS(() => q = v),
                      decoration: InputDecoration(hintText: tr('ابحث عن الموظف…', 'Search employee…'), prefixIcon: const Icon(Icons.search)),
                    ),
                  ),
                  Expanded(
                    child: ListView.builder(
                      itemCount: list.length,
                      itemBuilder: (c, i) => ListTile(
                        title: Text(empName(list[i]), style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 14)),
                        subtitle: Text('${list[i]['employeeId'] ?? ''} · ${list[i]['position'] ?? ''}', style: const TextStyle(fontSize: 12)),
                        onTap: () => Navigator.pop(c, list[i]),
                      ),
                    ),
                  ),
                ]),
              ),
            ),
          );
        });
      },
    );
  }

  // ── new custody ──
  Future<void> _newCustodySheet(BuildContext context) async {
    final emp = await _pickEmployee(context);
    if (emp == null || !context.mounted) return;
    // لا حقل اسم ولا موديل: الاسم يُشتق من النوع والماركة كما في الويب تماماً،
    // والموديل كان يُترك فارغاً في أغلب الصفوف.
    final brand = TextEditingController();
    final serial = TextEditingController();
    final notes = TextEditingController();
    String type = 'laptop';
    String condition = 'good';
    await showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (c) => StatefulBuilder(builder: (c, setS) => SafeArea(
        child: Padding(
          padding: EdgeInsets.fromLTRB(16, 16, 16, MediaQuery.of(c).viewInsets.bottom + 16),
          child: SingleChildScrollView(
            child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text('${tr('تسليم عهدة إلى', 'Assign to')} ${empName(emp)}', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
              const SizedBox(height: 12),
              DropdownButtonFormField<String>(
                initialValue: bucketOf(type),
                decoration: InputDecoration(labelText: tr('النوع', 'Type')),
                items: custodyBuckets.map((b) => DropdownMenuItem(value: b.key, child: Text(b.label))).toList(),
                onChanged: (v) => setS(() {
                  final b = custodyBuckets.firstWhere((x) => x.key == v, orElse: () => custodyBuckets.last);
                  type = b.canonicalType;
                }),
              ),
              if (bucketOf(type) == 'other') ...[
                const SizedBox(height: 10),
                DropdownButtonFormField<String>(
                  initialValue: otherBucketTypes.contains(type) ? type : 'other',
                  decoration: InputDecoration(labelText: tr('أي نوع من «أخرى»؟', 'Which kind of "Other"?')),
                  items: otherBucketTypes.map((t) => DropdownMenuItem(value: t, child: Text(custodyTypeLabel(t)))).toList(),
                  onChanged: (v) => setS(() => type = v ?? type),
                ),
              ],
              const SizedBox(height: 10),
              TextField(
                controller: brand,
                decoration: InputDecoration(labelText: tr('الماركة', 'Brand')),
                onChanged: (_) => setS(() {}),
              ),
              const SizedBox(height: 10),
              TextField(controller: serial, decoration: InputDecoration(labelText: tr('الرقم التسلسلي', 'Serial number'))),
              const SizedBox(height: 10),
              // معاينة الاسم كما سيُحفظ: الاسم مشتقّ، والمستخدم يستحق أن يرى
              // الناتج قبل الحفظ لا بعده.
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(10),
                decoration: BoxDecoration(color: T.line.withValues(alpha: 0.30), borderRadius: BorderRadius.circular(10)),
                child: Row(children: [
                  Text(tr('سيُسجَّل باسم', 'Will be recorded as'), style: const TextStyle(fontSize: 11.5, color: T.inkSoft)),
                  const SizedBox(width: 8),
                  Expanded(child: Text(deriveAssetName(type, brand.text),
                      style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w800))),
                ]),
              ),
              const SizedBox(height: 10),
              DropdownButtonFormField<String>(
                initialValue: condition,
                decoration: InputDecoration(labelText: tr('الحالة الفنية', 'Condition')),
                items: custodyConditions.entries.map((e) => DropdownMenuItem(value: e.key, child: Text(tr(e.value.$1, e.value.$2)))).toList(),
                onChanged: (v) => setS(() => condition = v ?? condition),
              ),
              const SizedBox(height: 10),
              TextField(controller: notes, decoration: InputDecoration(labelText: tr('ملاحظات', 'Notes'))),
              const SizedBox(height: 14),
              SizedBox(
                width: double.infinity,
                child: FilledButton(
                  onPressed: () async {
                    try {
                      // الاسم لا يُرسل: الخادم يشتقّه من النوع والماركة، وإرساله
                      // من هنا يفتح باب اسمين مختلفين لنفس الصنف من شاشتين.
                      await Api.instance.post('/api/it/custody', {
                        'employee': emp['_id'], 'type': type, 'condition': condition,
                        if (brand.text.trim().isNotEmpty) 'brand': brand.text.trim(),
                        if (serial.text.trim().isNotEmpty) 'serialNumber': serial.text.trim(),
                        if (notes.text.trim().isNotEmpty) 'notes': notes.text.trim(),
                      });
                      if (c.mounted) Navigator.pop(c);
                      _load();
                    } catch (e) {
                      if (c.mounted) ScaffoldMessenger.of(c).showSnackBar(SnackBar(content: Text(e.toString())));
                    }
                  },
                  child: Text(tr('تسليم', 'Assign')),
                ),
              ),
            ]),
          ),
        ),
      )),
    );
  }

  // ── details + actions ──
  Future<void> _detailsSheet(BuildContext context, Map<String, dynamic> r) async {
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
              '${(r['serialNumber'] ?? '').toString().isNotEmpty ? ' · ${r['serialNumber']}' : ''}',
              style: const TextStyle(fontSize: 12.5, color: T.inkSoft),
            ),
            if (r['employee'] != null) ...[
              const SizedBox(height: 6),
              Chip2('${tr('بحوزة', 'Held by')}: ${empName(r['employee'])}', T.info, icon: Icons.person_outline),
            ],
            const SizedBox(height: 14),
            Wrap(spacing: 8, runSpacing: 8, children: [
              if (assigned)
                _action(c, Icons.swap_horiz_rounded, tr('نقل إلى موظف', 'Transfer'), T.navy, () => _transfer(context, r)),
              if (assigned)
                _action(c, Icons.assignment_return_outlined, tr('إرجاع للمستودع', 'Return'), T.success, () => _returnItem(context, r)),
              if (assigned)
                _action(c, Icons.report_gmailerrorred_outlined, tr('إبلاغ تلف/فقد', 'Report'), T.warn, () => _report(context, r)),
              if (r['status'] != 'returned')
                _action(c, Icons.block_outlined, tr('تسجيل كتالف', 'Mark faulty'), T.danger, () => _retire(context, r)),
              _action(c, Icons.history_rounded, tr('السجل', 'History'), T.violet, () => _history(context, r)),
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

  Future<void> _post(String path, Map<String, dynamic> body, String okMsg) async {
    try {
      await Api.instance.post(path, body);
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(okMsg)));
      _load();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    }
  }

  Future<void> _transfer(BuildContext context, Map<String, dynamic> r) async {
    final emp = await _pickEmployee(context);
    if (emp == null) return;
    await _post('/api/it/custody/${r['_id']}/transfer', {'toEmployee': emp['_id']},
        tr('نُقلت العهدة إلى ${empName(emp)}', 'Transferred to ${empName(emp)}'));
  }

  Future<void> _returnItem(BuildContext context, Map<String, dynamic> r) async {
    final condition = TextEditingController();
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: Text(tr('إرجاع للمستودع', 'Return to stock')),
        content: TextField(controller: condition, decoration: InputDecoration(labelText: tr('الحالة عند الإرجاع', 'Condition on return'))),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: Text(tr('إلغاء', 'Cancel'))),
          FilledButton(onPressed: () => Navigator.pop(c, true), child: Text(tr('إرجاع', 'Return'))),
        ],
      ),
    );
    if (ok != true) return;
    await _post('/api/it/custody/${r['_id']}/return',
        {if (condition.text.trim().isNotEmpty) 'returnedCondition': condition.text.trim()},
        tr('أُرجعت العهدة إلى المستودع', 'Returned to stock'));
  }

  Future<void> _report(BuildContext context, Map<String, dynamic> r) async {
    String kind = 'damaged';
    final notes = TextEditingController();
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => StatefulBuilder(builder: (c, setS) => AlertDialog(
        title: Text(tr('إبلاغ عن الجهاز', 'Report item')),
        content: Column(mainAxisSize: MainAxisSize.min, children: [
          SegmentedButton<String>(
            segments: [
              ButtonSegment(value: 'damaged', label: Text(tr('تالف', 'Damaged'))),
              ButtonSegment(value: 'lost', label: Text(tr('مفقود', 'Lost'))),
            ],
            selected: {kind},
            onSelectionChanged: (s) => setS(() => kind = s.first),
          ),
          const SizedBox(height: 10),
          TextField(controller: notes, decoration: InputDecoration(labelText: tr('التفاصيل', 'Details'))),
        ]),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: Text(tr('إلغاء', 'Cancel'))),
          FilledButton(onPressed: () => Navigator.pop(c, true), child: Text(tr('إبلاغ', 'Report'))),
        ],
      )),
    );
    if (ok != true) return;
    await _post('/api/it/custody/${r['_id']}/report',
        {'kind': kind, if (notes.text.trim().isNotEmpty) 'notes': notes.text.trim()},
        tr('سُجِّل البلاغ', 'Report recorded'));
  }

  Future<void> _retire(BuildContext context, Map<String, dynamic> r) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: Text(tr('إخراج من الخدمة', 'Retire item')),
        content: Text(tr('سيُخرَج الجهاز من الخدمة نهائيًا. متابعة؟', 'The item will be retired permanently. Continue?')),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: Text(tr('إلغاء', 'Cancel'))),
          FilledButton(style: FilledButton.styleFrom(backgroundColor: T.danger), onPressed: () => Navigator.pop(c, true), child: Text(tr('إخراج', 'Retire'))),
        ],
      ),
    );
    if (ok != true) return;
    await _post('/api/it/custody/${r['_id']}/retire', {}, tr('أُخرج الجهاز من الخدمة', 'Item retired'));
  }

  Future<void> _history(BuildContext context, Map<String, dynamic> r) async {
    List<Map<String, dynamic>> events = [];
    try {
      final d = await Api.instance.get('/api/it/custody/${r['_id']}/history');
      events = List<Map<String, dynamic>>.from(d['events'] ?? []);
    } catch (_) {}
    if (!context.mounted) return;
    const labels = {
      'assigned': ('تسليم', 'Assigned', T.success),
      'transferred': ('نقل', 'Transferred', T.navy),
      'returned': ('إرجاع', 'Returned', T.info),
      'damaged': ('تلف', 'Damaged', T.warn),
      'lost': ('فقد', 'Lost', T.danger),
      'retired': ('إخراج من الخدمة', 'Retired', T.inkFaint),
    };
    showModalBottomSheet(
      context: context,
      builder: (c) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
            Text('${tr('سجل', 'History of')} ${r['name'] ?? ''}', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
            const SizedBox(height: 10),
            if (events.isEmpty) EmptyState(icon: Icons.history, title: tr('لا يوجد سجل بعد', 'No history yet')),
            Flexible(
              child: ListView.builder(
                shrinkWrap: true,
                itemCount: events.length,
                itemBuilder: (c, i) {
                  final e = events[i];
                  final m = labels[e['action']] ?? ('—', '—', T.inkFaint);
                  final at = DateTime.tryParse((e['createdAt'] ?? '').toString())?.toLocal();
                  return ListTile(
                    dense: true,
                    contentPadding: EdgeInsets.zero,
                    leading: CircleAvatar(radius: 14, backgroundColor: m.$3.withValues(alpha: 0.12), child: Icon(Icons.circle, size: 9, color: m.$3)),
                    title: Text(
                      '${tr(m.$1, m.$2)}'
                      '${e['toEmployee'] != null ? ' ← ${empName(e['toEmployee'])}' : ''}',
                      style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13),
                    ),
                    subtitle: Text(
                      '${at != null ? '${at.day}/${at.month}/${at.year}' : ''}'
                      '${(e['notes'] ?? '').toString().isNotEmpty ? ' · ${e['notes']}' : ''}',
                      style: const TextStyle(fontSize: 11.5),
                    ),
                  );
                },
              ),
            ),
          ]),
        ),
      ),
    );
  }
}
