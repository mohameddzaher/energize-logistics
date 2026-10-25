import 'dart:async';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../services/api.dart';
import '../services/auth.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/export_sheet.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';
import '../ui/search_field.dart';
import 'ops_common.dart';

/// أنواعُ الدفع — صفةُ كلّ عميلٍ في مكانٍ واحد (نظيرُ /system/operations/payment-types).
///
/// اختيارُ اليد على الكشف يغلب كلَّ شيء؛ ثمّ «طريقة الدفع» من المنصّة حين تقول
/// نقدًا؛ ثمّ صفةُ العميل من هنا. نفسُ نقاط الويب: GET/PUT /api/workflows/payment-types،
/// و/apply (معاينةٌ ثمّ تنفيذ)، و/:id/unify.
class OpsPaymentTypesScreen extends StatefulWidget {
  const OpsPaymentTypesScreen({super.key});
  @override
  State<OpsPaymentTypesScreen> createState() => _OpsPaymentTypesScreenState();
}

const _writeRoles = ['super_admin', 'admin', 'operations_manager', 'moderator', 'cfo', 'accounting_manager', 'collections_manager'];

String _fold(String v) => v
    .replaceAll(RegExp('[أإآٱ]'), 'ا').replaceAll('ة', 'ه').replaceAll(RegExp('[ىئي]'), 'ي')
    .replaceAll(RegExp(r'\s+'), ' ').trim().toLowerCase();

String _typeLabel(String v) => v == 'cash' ? tr('كاش', 'Cash') : v == 'tax' ? tr('ضريبي', 'Tax') : tr('بلا نوع', 'Not set');
Color _typeColor(String v) => v == 'cash' ? T.success : v == 'tax' ? T.info : T.warn;

class _OpsPaymentTypesScreenState extends State<OpsPaymentTypesScreen> {
  List<Map<String, dynamic>> _rows = [];
  Map<String, dynamic> _totals = {};
  bool _loading = true;
  String? _error;
  String _q = '';
  // متحكِّمُ البحث عند الشاشة: خطأُ تحديثٍ ثمّ إعادةُ المحاولة لا يُفرغ الخانةَ والكلمةُ تُرشِّح.
  final _searchCtl = TextEditingController();
  String _filter = ''; // '' | cash | tax | none | conflict
  String? _saving;
  String? _unifying;
  bool _applying = false;
  Timer? _live;
  late final void Function() _onLive;

  @override
  void initState() {
    super.initState();
    _load();
    _onLive = () {
      _live?.cancel();
      _live = Timer(const Duration(milliseconds: 800), () { if (mounted) _load(); });
    };
    Live.instance.on('workflow:updated', _onLive);
  }

  @override
  void dispose() {
    Live.instance.off('workflow:updated', _onLive);
    _live?.cancel();
    _searchCtl.dispose();
    super.dispose();
  }

  bool get _canWrite => _writeRoles.contains(context.read<AuthProvider>().role);

  Future<void> _load() async {
    try {
      final d = await Api.instance.get('/api/workflows/payment-types');
      if (!mounted) return;
      setState(() {
        _rows = List<Map<String, dynamic>>.from(d['rows'] ?? const []);
        _totals = Map<String, dynamic>.from(d['totals'] ?? const {});
        _loading = false;
        _error = null;
      });
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = opsErr(e); });
    }
  }

  List<Map<String, dynamic>> get _shown {
    final needle = _fold(_q);
    return _rows.where((r) {
      final pt = (r['paymentType'] ?? '').toString();
      if (_filter == 'conflict') {
        if (((r['conflicts'] ?? 0) as num) == 0) return false;
      } else if (_filter == 'none' ? pt.isNotEmpty : (_filter.isNotEmpty && pt != _filter)) {
        return false;
      }
      if (needle.isEmpty) return true;
      return _fold('${r['name'] ?? ''}').contains(needle) || _fold('${r['code'] ?? ''}').contains(needle);
    }).toList();
  }

  /// صفةُ العميل تُحفَظ وتملأ كشوفَه بلا نوع؛ والمخالفُ يُسأل عنه بعدده.
  Future<void> _setType(Map<String, dynamic> row, String type) async {
    if (type == (row['paymentType'] ?? '')) return;
    setState(() => _saving = '${row['_id']}');
    try {
      final r = await Api.instance.put('/api/workflows/payment-types/${row['_id']}', {'paymentType': type, 'onlyEmpty': true});
      if (!mounted) return;
      setState(() => row['paymentType'] = type);
      final changed = ((r['changed'] ?? 0) as num).toInt();
      opsSnack(context, changed > 0 ? tr('حُفظ — وسرى على $changed كشفًا بلا نوع', 'Saved — applied to $changed reports') : tr('حُفظ', 'Saved'));
      final remaining = ((r['remaining'] ?? 0) as num).toInt();
      if (remaining > 0) {
        final goAll = await opsConfirm(context, tr(
          'ولهذا العميل $remaining كشفًا بنوعٍ مخالفٍ لصفته الجديدة. أحوّلها كلَّها؟\n\nالتحويل يغيّر أين تُفوتَر هذه الكشوف وأين تُحصَّل — وما اختاره موظّفٌ بيده لا يُمسّ على كلّ حال.',
          "$remaining of this customer's reports carry a different type. Convert them all?\n\nThis changes where those reports are invoiced and collected. Types chosen by hand are never touched.",
        ));
        if (goAll) {
          final all = await Api.instance.put('/api/workflows/payment-types/${row['_id']}', {'paymentType': type, 'onlyEmpty': false});
          final sk = ((all['skippedManual'] ?? 0) as num).toInt();
          if (mounted) {
            opsSnack(context, tr('حُوِّل ${all['changed'] ?? 0} كشفًا${sk > 0 ? ' · وتُرك $sk باختيارٍ يدويّ' : ''}',
                'Converted ${all['changed'] ?? 0} reports${sk > 0 ? ' · $sk left as hand-picked' : ''}'));
          }
        }
      }
      _load();
    } catch (e) {
      if (mounted) opsSnack(context, opsErr(e), error: true);
    } finally {
      if (mounted) setState(() => _saving = null);
    }
  }

  Future<void> _unify(Map<String, dynamic> row) async {
    final n = ((row['conflicts'] ?? 0) as num).toInt();
    if (n == 0) return;
    final to = row['paymentType'] == 'cash' ? tr('كاش', 'cash') : tr('ضريبي', 'tax');
    final ok = await opsConfirm(context, tr(
      'توحيد $n كشفًا لـ«${row['name']}» على «$to»؟\n\nهذه كشوفٌ نوعُها مكتوبٌ من شيت المتابعة ويخالف صفة العميل. التوحيد يغيّر أين تُفوتَر وأين تُحصَّل، ولا يمسّ ما اختير باليد ولا ما صدرت له فاتورة.',
      'Unify $n reports of “${row['name']}” to $to?\n\nTheir type came from the follow-up sheet and differs from the customer. This changes where they are invoiced and collected. Hand-picked types and already-invoiced reports are untouched.',
    ));
    if (!ok) return;
    setState(() => _unifying = '${row['_id']}');
    try {
      final r = await Api.instance.post('/api/workflows/payment-types/${row['_id']}/unify', {});
      if (mounted) opsSnack(context, (r['message'] ?? tr('وُحِّد ${r['changed'] ?? 0} كشفًا', 'Unified ${r['changed'] ?? 0} reports')).toString());
      _load();
    } catch (e) {
      if (mounted) opsSnack(context, opsErr(e), error: true);
    } finally {
      if (mounted) setState(() => _unifying = null);
    }
  }

  /// تمريرُ القاعدة على كلّ الكشوف بلا نوع — يُعرَض أثرُها قبل تنفيذها.
  Future<void> _applyAll() async {
    setState(() => _applying = true);
    try {
      final p = await Api.instance.post('/api/workflows/payment-types/apply', {'preview': true, 'onlyEmpty': true});
      final would = ((p['wouldChange'] ?? 0) as num).toInt();
      if (!mounted) return;
      if (would == 0) { opsSnack(context, tr('لا كشفَ بلا نوعٍ يمكن ملؤه', 'Nothing to fill')); return; }
      final detail = ((p['moves'] as Map?) ?? const {}).entries.map((e) => '${e.key}: ${e.value}').join('\n');
      final go = await opsConfirm(context, tr('سيُملأ نوعُ الدفع على $would كشفًا بلا نوع.\n\n$detail\n\nولن يُمَسّ كشفٌ اختار موظّفٌ نوعَه بيده.', '$would reports will be filled.\n\n$detail'));
      if (!go) return;
      final r = await Api.instance.post('/api/workflows/payment-types/apply', {'onlyEmpty': true});
      if (mounted) opsSnack(context, tr('مُلئ ${r['changed'] ?? 0} كشفًا', '${r['changed'] ?? 0} reports filled'));
      _load();
    } catch (e) {
      if (mounted) opsSnack(context, opsErr(e), error: true);
    } finally {
      if (mounted) setState(() => _applying = false);
    }
  }

  Widget _chip(String k, String label, num n, Color tone) {
    final on = _filter == k;
    return Padding(
      padding: const EdgeInsetsDirectional.only(end: 6),
      child: ChoiceChip(
        selected: on,
        onSelected: (_) => setState(() => _filter = on ? '' : k),
        label: Text('$label $n'),
        labelStyle: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: on ? Colors.white : tone),
        selectedColor: T.ink,
        backgroundColor: Colors.white,
        showCheckmark: false,
        side: BorderSide(color: on ? T.ink : T.line),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final canWrite = _canWrite;
    final shown = _shown;
    final cols = [
      ExportCol('كود الحساب', 'Code', (r) => r['code'] ?? ''),
      ExportCol('العميل', 'Customer', (r) => r['name'] ?? ''),
      ExportCol('نوع الدفع', 'Payment type', (r) => _typeLabel('${r['paymentType'] ?? ''}')),
      ExportCol('الإدارة', 'Department', (r) => r['department'] ?? ''),
      ExportCol('عدد الكشوف', 'Reports', (r) => r['reports'] ?? 0),
      ExportCol('منها كاش', 'Cash reports', (r) => r['cashReports'] ?? 0),
      ExportCol('منها ضريبي', 'Tax reports', (r) => r['taxReports'] ?? 0),
      ExportCol('مخالف لصفته', 'Conflicting', (r) => r['conflicts'] ?? 0),
      ExportCol('قيمة البيع', 'Selling value', (r) => r['value'] ?? 0),
    ];
    return AppScaffold(
      title: Text(tr('أنواع الدفع', 'Payment types')),
      actions: [
        ExportButton(fileName: 'payment-types', sheetName: tr('أنواع الدفع', 'Payment types'), columns: cols, rows: () => _shown),
        if (canWrite)
          IconButton(
            tooltip: tr('ملء الكشوف بلا نوع', 'Fill untyped reports'),
            onPressed: _applying ? null : _applyAll,
            icon: _applying ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2)) : const Icon(Icons.auto_fix_high),
          ),
      ],
      body: _loading
          ? ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(height: 70), SizedBox(height: 10), Shimmer(height: 200)])
          : _error != null
              ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView(keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag, padding: const EdgeInsets.all(14), children: [
                    // القاعدةُ مكتوبةٌ حيث تُطبَّق.
                    Container(
                      padding: const EdgeInsets.all(10),
                      decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(12), border: Border.all(color: T.line)),
                      child: Text.rich(TextSpan(children: [
                        TextSpan(text: '${tr('كيف يُقرَّر نوعُ الكشف؟', 'How a report gets its type')} ', style: const TextStyle(fontWeight: FontWeight.w800)),
                        TextSpan(text: tr('اختيارُ الموظّف على الكشف يغلب كلَّ شيء. فإن لم يُختَر: متى قالت منصّةُ التشغيل إنّ طريقة دفع الحمولة «كاش» فهي نقديّة ولو كان العميلُ ضريبيًّا — وهو الاستثناء الوحيد. وما عدا ذلك يأخذ صفةَ العميل من هذه الصفحة.',
                            "A choice made on the report wins. Otherwise: if the platform says the load is paid cash it is cash even for a taxed customer — the only exception. Everything else takes the customer's type from this page.")),
                      ]), style: const TextStyle(fontSize: 11.5, color: T.inkSoft, height: 1.5)),
                    ),
                    const SizedBox(height: 10),
                    SearchField(controller: _searchCtl, hint: tr('ابحث باسم العميل أو الكود…', 'Customer or code…'), dense: true, onChanged: (v) => setState(() => _q = v)),
                    const SizedBox(height: 8),
                    SingleChildScrollView(
                      scrollDirection: Axis.horizontal,
                      child: Row(children: [
                        _chip('cash', tr('كاش', 'Cash'), (_totals['cash'] ?? 0) as num, T.success),
                        _chip('tax', tr('ضريبي', 'Tax'), (_totals['tax'] ?? 0) as num, T.info),
                        _chip('none', tr('بلا نوع', 'Not set'), (_totals['none'] ?? 0) as num, T.warn),
                        if (((_totals['conflictCustomers'] ?? 0) as num) > 0)
                          _chip('conflict', tr('مخالف لصفته · ${_totals['conflictReports'] ?? 0} كشفًا', 'Conflicting · ${_totals['conflictReports'] ?? 0} reports'),
                              (_totals['conflictCustomers'] ?? 0) as num, T.danger),
                      ]),
                    ),
                    Padding(
                      padding: const EdgeInsets.symmetric(vertical: 6),
                      child: Text(tr('${shown.length} من ${_totals['customers'] ?? 0} عميلًا · ${opsMoney(_totals['reports'] ?? 0)} كشفًا', '${shown.length} of ${_totals['customers'] ?? 0} customers'),
                          style: const TextStyle(fontSize: 11, color: T.inkFaint)),
                    ),
                    if (shown.isEmpty) EmptyState(icon: Icons.payments_outlined, title: tr('لا عملاءَ مطابقين', 'No matching customers')),
                    for (final r in shown)
                      Padding(
                        padding: const EdgeInsets.only(bottom: 8),
                        child: AppCard(
                          topAccent: _typeColor('${r['paymentType'] ?? ''}'),
                          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                            Row(children: [
                              Expanded(child: Text('${r['name'] ?? ''}', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13.5))),
                              Text('${(r['code'] ?? '').toString().isEmpty ? '—' : r['code']}', textDirection: TextDirection.ltr, style: const TextStyle(fontSize: 11.5, color: T.inkFaint, fontFamily: 'monospace')),
                            ]),
                            const SizedBox(height: 6),
                            Row(children: [
                              if (canWrite)
                                _saving == '${r['_id']}'
                                    ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))
                                    : DropdownButton<String>(
                                        value: '${r['paymentType'] ?? ''}',
                                        isDense: true,
                                        underline: const SizedBox.shrink(),
                                        style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700, color: _typeColor('${r['paymentType'] ?? ''}')),
                                        items: [
                                          for (final v in const ['', 'cash', 'tax'])
                                            DropdownMenuItem(value: v, child: Text(_typeLabel(v), style: TextStyle(color: _typeColor(v)))),
                                        ],
                                        onChanged: (v) { if (v != null) _setType(r, v); },
                                      )
                              else
                                Chip2(_typeLabel('${r['paymentType'] ?? ''}'), _typeColor('${r['paymentType'] ?? ''}')),
                              const SizedBox(width: 10),
                              Text('${tr('كشوفه', 'Reports')} ${opsMoney(r['reports'] ?? 0)}', style: const TextStyle(fontSize: 12)),
                              const SizedBox(width: 8),
                              Text('${r['cashReports'] ?? 0}', style: const TextStyle(fontSize: 12, color: T.success, fontWeight: FontWeight.w700)),
                              const Text(' / ', style: TextStyle(fontSize: 12, color: T.inkFaint)),
                              Text('${r['taxReports'] ?? 0}', style: const TextStyle(fontSize: 12, color: T.info, fontWeight: FontWeight.w700)),
                              const Spacer(),
                              if (((r['conflicts'] ?? 0) as num) > 0)
                                Text(tr('مخالف: ${r['conflicts']}', 'differs: ${r['conflicts']}'), style: const TextStyle(fontSize: 11, color: T.danger, fontWeight: FontWeight.w700)),
                            ]),
                            if (canWrite && ((r['conflicts'] ?? 0) as num) > 0)
                              Align(
                                alignment: AlignmentDirectional.centerEnd,
                                child: TextButton.icon(
                                  style: TextButton.styleFrom(foregroundColor: T.danger),
                                  onPressed: _unifying == '${r['_id']}' ? null : () => _unify(r),
                                  icon: _unifying == '${r['_id']}' ? const SizedBox(width: 14, height: 14, child: CircularProgressIndicator(strokeWidth: 2)) : const Icon(Icons.auto_fix_high, size: 16),
                                  label: Text(tr('توحيد', 'Unify')),
                                ),
                              ),
                          ]),
                        ),
                      ),
                    const SizedBox(height: 6),
                    Text(tr('تغييرُ صفةِ عميلٍ هنا يملأ كشوفَه التي لا نوعَ لها، ولا يمسّ كشفًا اختار موظّفٌ نوعَه بيده — تلك واقعةٌ على حمولةٍ بعينها، وهذه صفةٌ عامّة.',
                        "Changing a customer's type fills their untyped reports and never touches a report someone typed by hand."),
                        style: const TextStyle(fontSize: 11, color: T.inkFaint)),
                  ]),
                ),
    );
  }
}
