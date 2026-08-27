import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/filter_sheet.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';
import 'vehicle_registry.dart' show docLabel, fmtDate, daysText, money, statusColor, statusLabel;

/// ── شاشةُ عائلةِ مستندٍ واحدة، نظيرُ صفحات المستندات في الموقع ─────────────
///
/// المشكلة التي تحلّها ليست نقصًا في البيانات: أرقام بطاقات التشغيل والتفاويض
/// ووثائق التأمين مسجَّلةٌ كلُّها منذ الاستيراد، وكانت لا تجد في أي شاشة عمودًا
/// يعرضها. فيفلتر المستخدم على بطاقة التشغيل فيحصل على المركبات الصحيحة بلا
/// رقمِ بطاقةٍ واحد، فيظنّ الملف لم يُستورَد.
///
/// وعائلةٌ واحدةٌ في الشاشة لا المستندات الستّة مجتمعة: مجموعُها يجاوز الأربعين
/// حقلًا، وهي في الملف المصدر مجموعةٌ عائلةً عائلة بلونها — والشاشة تتبع الورقة
/// التي يعرفها القسم.
///
/// ولماذا شاشةٌ واحدةٌ موصوفةٌ بالبيانات لا سبعُ شاشات منسوخة: النسخُ يفترق عند
/// أوّل تعديل — يُصلَح زرُّ التجديد في واحدة ويبقى معطوبًا في ستّ.

/// حقلٌ يُعرَض في بطاقة المركبة: كيف يُقرأ من المركبة وكيف يُسمّى.
class DocField {
  final String ar, en;
  final String Function(Map v) get;

  /// أرقامُ الأوراق تُقرأ يسارًا إلى يمين مهما كانت لغة الشاشة.
  final bool mono;
  const DocField(this.ar, this.en, this.get, {this.mono = false});
}

/// شريحةُ تصفيةٍ محلّيةٍ فوق الصفوف المحمَّلة.
class DocChip {
  final String key, ar, en;
  final Color tone;
  final bool Function(Map v)? test;
  const DocChip(this.key, this.ar, this.en, this.tone, [this.test]);
}

class DocFamily {
  /// مفتاح المستند ذي تاريخ الانتهاء — أو `null` لعائلةٍ لا تنتهي.
  ///
  /// شريحةُ بترو اب من هذا الثاني: لها رقمٌ وحالةٌ وسقفُ صرف ولا تاريخَ انتهاء.
  /// وإقحامُها في عمود «الأيام المتبقية» يجعل الأسطول كلَّه يظهر «بلا تاريخ» في
  /// شاشةٍ لا معنى للتاريخ فيها — نقصٌ مُختلَق يُوهم أن ثَمّ عملًا مطلوبًا.
  /// ومعه يسقط زرُّ التجديد: لا يُجدَّد ما لا ينتهي.
  final String? docKey;
  final String arTitle, enTitle;
  final IconData icon;
  final List<DocField> fields;
  final List<String> Function(Map v) searchIn;
  final List<DocChip>? chips;
  const DocFamily({
    required this.docKey,
    required this.arTitle,
    required this.enTitle,
    required this.icon,
    required this.fields,
    required this.searchIn,
    this.chips,
  });
}

String _s(dynamic v) => (v == null) ? '' : v.toString();
Map _sub(Map v, String k) => (v[k] is Map) ? v[k] as Map : const {};
String _fold(String s) => s
    .replaceAll(RegExp('[أإآ]'), 'ا')
    .replaceAll('ى', 'ي')
    .replaceAll('ة', 'ه')
    .toLowerCase()
    .trim();

/// حالةُ هذا المستند على هذه المركبة كما حسبها الخادم بعتبات الإعدادات.
/// لا تُحسَب هنا، وإلا اختلفت ألوانُ هذه الشاشة عن شاشة التنبيهات على المركبة
/// نفسِها — والمستخدم يرى الشاشتين في اليوم نفسه.
Map<String, dynamic> _state(Map v, String docKey) {
  final st = (v['docStatuses'] is Map) ? (v['docStatuses'][docKey] as Map?) : null;
  return {'status': _s(st?['status']).isEmpty ? 'none' : _s(st?['status']), 'days': st?['days']};
}

class VehicleDocumentsScreen extends StatefulWidget {
  final DocFamily family;
  const VehicleDocumentsScreen({super.key, required this.family});
  @override
  State<VehicleDocumentsScreen> createState() => _VehicleDocumentsScreenState();
}

class _VehicleDocumentsScreenState extends State<VehicleDocumentsScreen> {
  List<Map<String, dynamic>> _rows = [];
  Map<String, String> _filters = {};
  String _q = '';
  String _chip = '';
  int _total = 0;
  bool _loading = true;
  String? _error;
  late final void Function() _onLive;

  @override
  void initState() {
    super.initState();
    _onLive = () { if (mounted) _load(); };
    Live.instance.on('vreg:updated', _onLive);
    _load();
  }

  @override
  void dispose() {
    Live.instance.off('vreg:updated', _onLive);
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final p = <String>['limit=2000'];
      _filters.forEach((k, v) { if (v.isNotEmpty) p.add('$k=${Uri.encodeComponent(v)}'); });
      final d = await Api.instance.get('/api/vehicle-registry?${p.join('&')}');
      if (!mounted) return;
      setState(() {
        _rows = List<Map<String, dynamic>>.from(d['vehicles'] ?? []);
        _total = (d['total'] ?? 0) as int;
        _loading = false;
        _error = null;
      });
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  List<DocChip> get _chips {
    final f = widget.family;
    if (f.chips != null) return f.chips!;
    final k = f.docKey;
    if (k == null) return const [DocChip('', 'الكل', 'All', T.navy)];
    return [
      const DocChip('', 'الكل', 'All', T.navy),
      DocChip('expired', 'منتهٍ', 'Expired', T.danger, (v) => _state(v, k)['status'] == 'expired'),
      DocChip('critical', 'ينتهي قريبًا جدًا', 'Critical', const Color(0xFFEA580C), (v) => _state(v, k)['status'] == 'critical'),
      DocChip('warning', 'قارب على الانتهاء', 'Due soon', const Color(0xFFCA8A04), (v) => _state(v, k)['status'] == 'warning'),
      DocChip('valid', 'ساري', 'Valid', T.success, (v) => _state(v, k)['status'] == 'valid'),
      // «بلا تاريخ» ليست حالةً فرعية — هي قائمةُ العمل الأولى: مستندٌ لا يُعرَف
      // متى ينتهي لا يظهر في أي تنبيه، فينتهي ولا يعلم أحد.
      DocChip('none', 'بلا تاريخ مسجَّل', 'No date on file', T.inkFaint, (v) => _state(v, k)['status'] == 'none'),
    ];
  }

  /// تجديدٌ يقبل الرقم الجديد: بطاقة التشغيل تخرج برقمٍ جديد كل مرة، والتفويض
  /// كذلك أحيانًا. وتركُ الخانة فارغة يعني «الرقم هو هو» — لا محوَه.
  Future<void> _renew(Map v) async {
    final k = widget.family.docKey;
    if (k == null) return;
    final numberLabel = _numberLabel(k);
    final current = numberLabel == null ? '' : _numberOf(v, k);
    DateTime? newExpiry;
    final number = TextEditingController();
    final cost = TextEditingController();
    final note = TextEditingController();

    final ok = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (c) => StatefulBuilder(
        builder: (c, setSheet) => Padding(
          padding: EdgeInsets.fromLTRB(18, 18, 18, MediaQuery.of(c).viewInsets.bottom + 18),
          child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(tr('تجديد ${docLabel(k)}', 'Renew ${docLabel(k)}'),
                style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800)),
            Text('${_s(v['plateNumber'])} · ${tr('ينتهي', 'expires')} ${fmtDate(_dateOf(v, k))}',
                style: const TextStyle(fontSize: 12.5, color: T.inkFaint)),
            const SizedBox(height: 14),
            OutlinedButton.icon(
              icon: const Icon(Icons.calendar_month_outlined, size: 18),
              style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(48), alignment: AlignmentDirectional.centerStart),
              label: Text('${tr('تاريخ الانتهاء الجديد', 'New expiry')}: '
                  '${newExpiry == null ? tr('اختر', 'Pick') : newExpiry!.toIso8601String().split('T').first}'),
              onPressed: () async {
                final d = await showDatePicker(
                  context: c,
                  initialDate: DateTime.now().add(const Duration(days: 365)),
                  // الخادم يرفض تاريخًا في الماضي، فمنعُه هنا أوضح من رسالة خطأ بعد الإرسال.
                  firstDate: DateTime.now(),
                  lastDate: DateTime(2040),
                );
                if (d != null) setSheet(() => newExpiry = d);
              },
            ),
            if (numberLabel != null) ...[
              const SizedBox(height: 10),
              TextField(
                controller: number,
                textDirection: TextDirection.ltr,
                decoration: InputDecoration(
                  labelText: '$numberLabel — ${tr('اتركه فارغًا إن لم يتغيّر', 'blank if unchanged')}',
                  hintText: current.isEmpty ? null : current,
                  helperText: current.isEmpty ? null : '${tr('الحالي', 'Current')}: $current',
                ),
              ),
            ],
            const SizedBox(height: 10),
            TextField(controller: cost, keyboardType: TextInputType.number, decoration: InputDecoration(labelText: tr('التكلفة (ر.س)', 'Cost (SAR)'))),
            const SizedBox(height: 10),
            TextField(controller: note, decoration: InputDecoration(labelText: tr('ملاحظة (اختياري)', 'Note (optional)'))),
            const SizedBox(height: 8),
            Text(
              tr('يُقيَّد في سجل المركبة: التاريخ السابق والجديد، والرقم السابق إن استُبدل، واسم من نفّذه.',
                  'Recorded on the vehicle: old and new date, the old number if replaced, and who did it.'),
              style: const TextStyle(fontSize: 11.5, color: T.inkFaint),
            ),
            const SizedBox(height: 14),
            FilledButton(
              onPressed: newExpiry == null ? null : () => Navigator.pop(c, true),
              child: Text(tr('تأكيد التجديد', 'Confirm renewal')),
            ),
          ]),
        ),
      ),
    );
    if (ok != true || newExpiry == null) return;
    try {
      await Api.instance.post('/api/vehicle-registry/${v['_id']}/renew', {
        'document': k,
        'newExpiry': newExpiry!.toIso8601String().split('T').first,
        if (number.text.trim().isNotEmpty) 'documentNumber': number.text.trim(),
        if (cost.text.trim().isNotEmpty) 'cost': num.tryParse(cost.text.trim()),
        if (note.text.trim().isNotEmpty) 'note': note.text.trim(),
      });
      await _load();
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(tr('تم التجديد', 'Renewed'))));
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    }
  }

  // اسمُ رقم المستند ومسارُه — نفس ما يعرّفه الخادم في config/vehicleDocuments.
  // ورخصةُ السير والفحص لا رقم لهما، فلا خانةَ لهما في نافذة التجديد.
  String? _numberLabel(String k) => switch (k) {
        'insurance' => tr('رقم وثيقة التأمين', 'Policy number'),
        'operatingCard' => tr('رقم بطاقة التشغيل', 'Operating card number'),
        'gps' => tr('سريال جهاز التتبّع', 'GPS serial'),
        'authorization' => tr('رقم التفويض', 'Authorisation number'),
        _ => null,
      };
  String _numberOf(Map v, String k) => switch (k) {
        'insurance' => _s(_sub(v, 'insurance')['policyNumber']),
        'operatingCard' => _s(_sub(v, 'operatingCard')['cardNumber']),
        'gps' => _s(_sub(v, 'gps')['serialImei']),
        'authorization' => _s(_sub(v, 'authorizedPerson')['authorizationNumber']),
        _ => '',
      };
  dynamic _dateOf(Map v, String k) => switch (k) {
        'insurance' => _sub(v, 'insurance')['expiryDate'],
        'operatingCard' => _sub(v, 'operatingCard')['expiryDate'],
        'vehicleLicense' => _sub(v, 'vehicleLicense')['expiryDate'],
        'inspection' => _sub(v, 'inspection')['expiryDate'],
        'gps' => _sub(v, 'gps')['expiryDate'],
        'authorization' => _sub(v, 'authorizedPerson')['expiryDate'],
        _ => null,
      };

  @override
  Widget build(BuildContext context) {
    final f = widget.family;
    final q = _fold(_q);
    final searched = q.isEmpty
        ? _rows
        : _rows.where((v) => f.searchIn(v).any((x) => _fold(x).contains(q))).toList();
    final chips = _chips;
    final active = chips.firstWhere((c) => c.key == _chip, orElse: () => chips.first);
    final rows = active.test == null ? searched : searched.where((v) => active.test!(v)).toList();

    return AppScaffold(
      title: Text(tr(f.arTitle, f.enTitle)),
      body: _loading
          ? ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(height: 48), SizedBox(height: 10), Shimmer(), SizedBox(height: 10), Shimmer()])
          : _error != null
              ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
              : Column(children: [
                  Padding(
                    padding: const EdgeInsets.fromLTRB(14, 12, 14, 6),
                    child: Row(children: [
                      Expanded(
                        child: TextField(
                          onChanged: (v) => setState(() => _q = v),
                          decoration: InputDecoration(hintText: tr('ابحث بلوحة أو رقم…', 'Search plate or number…'), prefixIcon: const Icon(Icons.search)),
                        ),
                      ),
                      const SizedBox(width: 8),
                      // نفس فلاتر الموقع بالضبط: تأتي من الخادم وأعدادُها محسوبة
                      // بعد بقيّة الفلاتر، فلا يفترق ما يراه المستخدم هنا عمّا يراه هناك.
                      Badge(
                        isLabelVisible: _filters.isNotEmpty,
                        label: Text('${_filters.length}'),
                        child: IconButton.filled(
                          style: IconButton.styleFrom(backgroundColor: _filters.isEmpty ? T.navy : T.orange),
                          icon: const Icon(Icons.tune),
                          tooltip: tr('التصفية', 'Filter'),
                          onPressed: () async {
                            final r = await showFilterSheet(
                              context: context,
                              optionsUrl: '/api/vehicle-registry/filters',
                              value: _filters,
                            );
                            if (r != null && mounted) { setState(() { _filters = r; _loading = true; }); _load(); }
                          },
                        ),
                      ),
                    ]),
                  ),
                  SizedBox(
                    height: 42,
                    child: ListView(
                      scrollDirection: Axis.horizontal,
                      padding: const EdgeInsets.symmetric(horizontal: 14),
                      children: chips.map((c) {
                        final n = c.test == null ? searched.length : searched.where(c.test!).length;
                        final on = c.key == active.key;
                        return Padding(
                          padding: const EdgeInsetsDirectional.only(end: 6),
                          child: ChoiceChip(
                            selected: on,
                            selectedColor: c.tone.withValues(alpha: 0.18),
                            label: Text('${tr(c.ar, c.en)} $n', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: on ? c.tone : T.inkFaint)),
                            onSelected: (_) => setState(() => _chip = on ? '' : c.key),
                          ),
                        );
                      }).toList(),
                    ),
                  ),
                  Expanded(
                    child: RefreshIndicator(
                      onRefresh: _load,
                      child: rows.isEmpty
                          ? ListView(children: [const SizedBox(height: 80), EmptyState(icon: f.icon, title: tr('لا نتائج مطابقة', 'No matching rows'))])
                          : ListView.separated(
                              padding: const EdgeInsets.all(14),
                              itemCount: rows.length,
                              separatorBuilder: (_, __) => const SizedBox(height: 8),
                              itemBuilder: (c, i) {
                                final v = rows[i];
                                final k = f.docKey;
                                final st = k == null ? null : _state(v, k);
                                final s = _s(st?['status']).isEmpty ? 'none' : _s(st?['status']);
                                return AppCard(
                                  topAccent: st == null ? T.navy : statusColor(s),
                                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                    Row(children: [
                                      Text(_s(v['plateNumber']), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
                                      const Spacer(),
                                      if (st != null)
                                        Chip2(st['days'] == null ? statusLabel(s) : daysText(st['days']), statusColor(s)),
                                    ]),
                                    const SizedBox(height: 6),
                                    ...f.fields.map((fl) {
                                      final val = fl.get(v);
                                      return Padding(
                                        padding: const EdgeInsets.symmetric(vertical: 2),
                                        child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                          Expanded(flex: 2, child: Text(tr(fl.ar, fl.en), style: const TextStyle(fontSize: 11.5, color: T.inkFaint))),
                                          Expanded(
                                            flex: 3,
                                            child: Text(
                                              val.isEmpty ? '—' : val,
                                              textAlign: TextAlign.end,
                                              textDirection: fl.mono ? TextDirection.ltr : null,
                                              style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700),
                                            ),
                                          ),
                                        ]),
                                      );
                                    }),
                                    if (k != null) ...[
                                      const SizedBox(height: 6),
                                      Align(
                                        alignment: AlignmentDirectional.centerEnd,
                                        child: TextButton.icon(
                                          onPressed: () => _renew(v),
                                          icon: const Icon(Icons.autorenew_rounded, size: 17),
                                          label: Text(tr('تجديد', 'Renew')),
                                        ),
                                      ),
                                    ],
                                  ]),
                                );
                              },
                            ),
                    ),
                  ),
                  Padding(
                    padding: const EdgeInsets.all(8),
                    child: Text(tr('${rows.length} من $_total مركبة', '${rows.length} of $_total vehicles'),
                        style: const TextStyle(fontSize: 11.5, color: T.inkFaint)),
                  ),
                ]),
    );
  }
}

// ══════════════════ العائلات السبع ══════════════════
// نفس الأعمدة ونفس الترتيب ونفس الأسماء التي في الموقع — من يفتح الشاشتين في
// اليوم نفسه لا يجد جدولين مختلفين لبياناتٍ واحدة.

final vehicleInsuranceFamily = DocFamily(
  docKey: 'insurance',
  arTitle: 'تأمين المركبات', enTitle: 'Vehicle Insurance',
  icon: Icons.shield_outlined,
  fields: [
    DocField('رقم وثيقة التأمين', 'Policy number', (v) => _s(_sub(v, 'insurance')['policyNumber']), mono: true),
    DocField('تاريخ انتهاء التأمين', 'Insurance expiry', (v) => fmtDate(_sub(v, 'insurance')['expiryDate'])),
    DocField('شركة التأمين', 'Insurer', (v) => _s(_sub(v, 'insurance')['companyAr'])),
    DocField('نوع التأمين', 'Coverage type', (v) => _s(_sub(v, 'insurance')['coverageTypeAr'])),
    // مركبةٌ يسدّد قسطَها المموِّل ليست «بلا قسط»: هي مؤمَّنة والرقم عنده.
    DocField('قيمة التأمين', 'Premium', (v) {
      final ins = _sub(v, 'insurance');
      return ins['premiumSar'] != null ? money(ins['premiumSar']) : _s(ins['premiumStatusAr']);
    }),
  ],
  searchIn: (v) => [_s(v['plateNumber']), _s(_sub(v, 'insurance')['policyNumber']), _s(_sub(v, 'insurance')['companyAr']), _s(v['ownerNameAr'])],
);

final vehicleOperatingCardFamily = DocFamily(
  docKey: 'operatingCard',
  arTitle: 'بطاقات التشغيل', enTitle: 'Operating Cards',
  icon: Icons.credit_card_outlined,
  fields: [
    DocField('رقم بطاقة التشغيل', 'Operating card number', (v) => _s(_sub(v, 'operatingCard')['cardNumber']), mono: true),
    DocField('تاريخ الانتهاء', 'Expiry date', (v) => fmtDate(_sub(v, 'operatingCard')['expiryDate'])),
    DocField('الإدارة', 'Department', (v) => _s(v['departmentAr'])),
    DocField('المالك', 'Owner', (v) => _s(v['ownerNameAr'])),
  ],
  searchIn: (v) => [_s(v['plateNumber']), _s(_sub(v, 'operatingCard')['cardNumber']), _s(v['ownerNameAr']), _s(v['departmentAr'])],
);

final vehicleAuthorizationFamily = DocFamily(
  docKey: 'authorization',
  arTitle: 'التفاويض', enTitle: 'Authorisations',
  icon: Icons.assignment_ind_outlined,
  fields: [
    DocField('اسم المفوَّض', 'Authorised person', (v) => _s(_sub(v, 'authorizedPerson')['name'])),
    DocField('رقم الإقامة', 'Iqama number', (v) => _s(_sub(v, 'authorizedPerson')['iqamaNumber']), mono: true),
    DocField('رقم التفويض', 'Authorisation number', (v) => _s(_sub(v, 'authorizedPerson')['authorizationNumber']), mono: true),
    DocField('تاريخ بداية التفويض', 'Start date', (v) => fmtDate(_sub(v, 'authorizedPerson')['startDate'])),
    DocField('تاريخ نهاية التفويض', 'End date', (v) => fmtDate(_sub(v, 'authorizedPerson')['expiryDate'])),
  ],
  searchIn: (v) => [
    _s(v['plateNumber']), _s(_sub(v, 'authorizedPerson')['name']),
    _s(_sub(v, 'authorizedPerson')['iqamaNumber']), _s(_sub(v, 'authorizedPerson')['authorizationNumber']),
  ],
);

final vehicleFuelCardFamily = DocFamily(
  // لا تاريخ انتهاء لشريحة الوقود، فلا عمودَ حالةٍ ولا زرَّ تجديد.
  docKey: null,
  arTitle: 'بترو اب — شرائح الوقود', enTitle: 'Petro App Cards',
  icon: Icons.local_gas_station_outlined,
  fields: [
    DocField('شريحة بترو اب', 'Petro App chip', (v) => _s(_sub(v, 'fuelCard')['cardNumber']), mono: true),
    // اللوحةُ في الفاتورة تُكتب بصيغةٍ أخرى، وهي المفتاح الوحيد لمطابقة بند
    // الفاتورة بالمركبة — فليست تكرارًا للوحة.
    DocField('رقم اللوحة في فاتورة بترو اب', 'Plate on invoice', (v) => _s(_sub(v, 'fuelCard')['plateOnInvoiceAr'])),
    DocField('حالة الشريحة', 'Chip status', (v) => _s(_sub(v, 'fuelCard')['statusAr'])),
    DocField('نوع الاستهلاك', 'Consumption type', (v) => _s(_sub(v, 'fuelCard')['consumptionTypeAr'])),
    DocField('حد الاستهلاك', 'Consumption limit', (v) {
      final fc = _sub(v, 'fuelCard');
      if (fc['limitStatus'] == 'open') return tr('مفتوح — بلا سقف', 'Open — no ceiling');
      return fc['limitSar'] != null ? money(fc['limitSar']) : '';
    }),
  ],
  searchIn: (v) => [_s(v['plateNumber']), _s(_sub(v, 'fuelCard')['cardNumber']), _s(_sub(v, 'fuelCard')['plateOnInvoiceAr'])],
  chips: [
    const DocChip('', 'الكل', 'All', T.navy),
    DocChip('has', 'لها شريحة', 'Has a chip', T.success, (v) => _s(_sub(v, 'fuelCard')['cardNumber']).isNotEmpty),
    DocChip('none', 'بلا شريحة', 'No chip', T.danger, (v) => _s(_sub(v, 'fuelCard')['cardNumber']).isEmpty),
    DocChip('open', 'بلا سقف استهلاك', 'No ceiling', T.orange, (v) => _sub(v, 'fuelCard')['limitStatus'] == 'open'),
    DocChip('noInvoicePlate', 'بلا لوحة على الفاتورة', 'No plate on invoice', T.violet,
        (v) => _s(_sub(v, 'fuelCard')['cardNumber']).isNotEmpty && _s(_sub(v, 'fuelCard')['plateOnInvoiceAr']).isEmpty),
  ],
);

final vehicleGpsFamily = DocFamily(
  docKey: 'gps',
  arTitle: 'أجهزة التتبّع GPS', enTitle: 'GPS Devices',
  icon: Icons.satellite_alt_outlined,
  fields: [
    DocField('جهاز GPS', 'GPS device', (v) => _s(_sub(v, 'gps')['deviceModel'])),
    // حالةُ الجهاز غيرُ حالة الاشتراك: جهازٌ مسروق قد يكون اشتراكه ساريًا.
    DocField('حالة جهاز GPS', 'Device status', (v) => _s(_sub(v, 'gps')['deviceStatusAr'])),
    DocField('شركة الـGPS', 'GPS provider', (v) => _s(_sub(v, 'gps')['provider'])),
    DocField('سريال GPS', 'GPS serial', (v) => _s(_sub(v, 'gps')['serialImei']), mono: true),
    DocField('تاريخ انتهاء الـGPS', 'Subscription expiry', (v) => fmtDate(_sub(v, 'gps')['expiryDate'])),
  ],
  searchIn: (v) => [_s(v['plateNumber']), _s(_sub(v, 'gps')['serialImei']), _s(_sub(v, 'gps')['deviceModel']), _s(_sub(v, 'gps')['provider'])],
);

final vehicleLicenceFamily = DocFamily(
  docKey: 'vehicleLicense',
  arTitle: 'رخص السير', enTitle: 'Vehicle Licences',
  icon: Icons.description_outlined,
  fields: [
    // الرخصة تُطبَع بالهجريّ والنظام يحسب بالميلاديّ؛ عرضُ أحدهما وحده يجعل
    // الموظف يقارن ما في يده بما في الشاشة فلا يتطابقان.
    DocField('انتهاء رخصة السير (ميلادي)', 'Licence expiry (Gregorian)', (v) => fmtDate(_sub(v, 'vehicleLicense')['expiryDate'])),
    DocField('انتهاء رخصة السير (هجري)', 'Licence expiry (Hijri)', (v) => _s(_sub(v, 'vehicleLicense')['expiryDateHijri']), mono: true),
    DocField('المالك', 'Owner', (v) => _s(v['ownerNameAr'])),
  ],
  searchIn: (v) => [_s(v['plateNumber']), _s(v['ownerNameAr']), _s(_sub(v, 'vehicleLicense')['expiryDateHijri'])],
);

final vehicleInspectionFamily = DocFamily(
  docKey: 'inspection',
  arTitle: 'الفحص الدوري', enTitle: 'Periodic Inspection',
  icon: Icons.fact_check_outlined,
  fields: [
    DocField('حالة الفحص', 'Inspection status', (v) => _s(_sub(v, 'inspection')['statusAr'])),
    DocField('تاريخ انتهاء الفحص (ميلادي)', 'Inspection expiry (Gregorian)', (v) => fmtDate(_sub(v, 'inspection')['expiryDate'])),
    DocField('تاريخ انتهاء الفحص (هجري)', 'Inspection expiry (Hijri)', (v) => _s(_sub(v, 'inspection')['expiryDateHijri']), mono: true),
  ],
  searchIn: (v) => [_s(v['plateNumber']), _s(v['ownerNameAr']), _s(_sub(v, 'inspection')['statusAr'])],
);
