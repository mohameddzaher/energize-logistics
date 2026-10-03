import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
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

String _money(dynamic v) {
  final n = (v is num) ? v : num.tryParse(v?.toString() ?? '') ?? 0;
  return n.toStringAsFixed(0).replaceAllMapped(RegExp(r'\B(?=(\d{3})+(?!\d))'), (m) => ',');
}

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
  /// حالةُ الطلب المختارة — تُرسَل فلترَ عمودٍ كما ترسله الشاشةُ في الويب.
  String _status = '';
  Map<String, dynamic> _byStatus = const {};
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
  }

  @override
  void dispose() {
    Live.instance.off('workflow:stageChanged', _onLive);
    Live.instance.off('workflow:created', _onLive);
    Live.instance.off('workflow:updated', _onLive);
    Live.instance.off('workflow:bulkImported', _onLive);
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final params = [
        'page=$_page', 'limit=40',
        if (_status.isNotEmpty) 'cf_applicationStatus=${Uri.encodeQueryComponent(_status)}',
        if (_q.trim().isNotEmpty) 'search=${Uri.encodeQueryComponent(_q.trim())}',
      ];
      final results = await Future.wait([
        Api.instance.get('/api/workflows?${params.join('&')}'),
        Api.instance.get('/api/workflows/stats').catchError((_) => <String, dynamic>{}),
      ]);
      if (!mounted) return;
      setState(() {
        _rows = List<Map<String, dynamic>>.from(results[0]['workflows'] ?? []);
        _pages = ((results[0]['pages'] ?? 1) as num).toInt();
        _stats = Map<String, dynamic>.from(results[1]);
        // أعدادُ الحالات تُحسَب في الخادم على كلّ الصفوف — لا على الأربعين
        // المعروضة، كما في الويب.
        _byStatus = Map<String, dynamic>.from(_stats['byStatus'] ?? {});
        _loading = false;
        _error = null;
      });
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = e.toString(); });
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
      (tr('حالة التنفيذ', 'Execution status'), w['executionStatus']),
      (tr('طريقة الدفع', 'Payment method'), w['paymentMethod']),
      (tr('قيمة الشراء', 'Purchase value'), w['purchaseValue'] != null ? '${_money(w['purchaseValue'])} ر.س' : null),
      (tr('قيمة البيع', 'Selling value'), w['sellingValue'] != null ? '${_money(w['sellingValue'])} ر.س' : null),
      (tr('رقم الفاتورة', 'Invoice #'), w['invoiceNumber']),
      (tr('تاريخ الدفع', 'Payment date'), w['paymentDate']),
      (tr('المرجع', 'Reference'), w['reference']),
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
                  if (_stats.isNotEmpty)
                    Padding(
                      padding: const EdgeInsets.fromLTRB(14, 12, 14, 0),
                      // ── أربعُ بطاقاتٍ كما في الويب ────────────────────────
                      // والرابعةُ تناقضٌ يُقرأ: السندُ «وصل» في حالة الطلب ولا
                      // تاريخَ لسداده في الكشف — فإمّا تاريخٌ ناقصٌ يُكتب أو
                      // حالةٌ تُصحَّح. وهي رقمٌ لا يُستخرَج من البطاقتين
                      // منفصلتين.
                      child: Column(children: [
                        Row(children: [
                          Expanded(child: _statCard(tr('الإجمالي', 'Total'), '${_stats['total'] ?? 0}', T.navy)),
                          const SizedBox(width: 8),
                          Expanded(child: _statCard(tr('سندات لم تصل', 'Pending bonds'), '${_stats['pendingInvoices'] ?? 0}', T.warn)),
                        ]),
                        const SizedBox(height: 8),
                        Row(children: [
                          Expanded(child: _statCard(tr('سند لم يصل وحالته «استُلم»', 'Pending, status received'), '${_stats['pendingBondReceived'] ?? 0}', T.danger)),
                          const SizedBox(width: 8),
                          Expanded(child: _statCard(tr('قيمة الشراء', 'Purchase'), _money(_stats['sumPurchaseValue']), T.violet)),
                        ]),
                      ]),
                    ),
                  Padding(
                    padding: const EdgeInsets.fromLTRB(14, 10, 14, 0),
                    child: TextField(
                      onSubmitted: (v) { setState(() { _q = v; _page = 1; _loading = true; }); _load(); },
                      onChanged: (v) => _q = v,
                      textInputAction: TextInputAction.search,
                      decoration: InputDecoration(hintText: tr('ابحث بالكشف أو المالك ثم إدخال…', 'Search then enter…'), prefixIcon: const Icon(Icons.search)),
                    ),
                  ),
                  Padding(
                    padding: const EdgeInsets.fromLTRB(14, 8, 14, 4),
                    child: SingleChildScrollView(
                      scrollDirection: Axis.horizontal,
                      // ── والشرائحُ حالةُ الطلب لا المرحلة ────────────────────
                      // كانت خمسَ شرائحِ مراحلَ أربعٌ منها فارغةٌ دائمًا (كلُّ
                      // الكشوف «مسودة»). والسؤالُ الذي يُسأل كلَّ صباح هو حالةُ
                      // الطلب: كم في الطريق، وكم وصلت ولم يصل سندُها — ومعها
                      // عددُها من الخادم كما في بطاقات الويب.
                      child: Row(
                        children: _appStatuses.entries.map((e) {
                          final selected = _status == e.key;
                          final n = (_byStatus[e.key] ?? 0) as num;
                          return Padding(
                            padding: const EdgeInsets.only(left: 6),
                            child: FilterChip(
                              selected: selected,
                              onSelected: (_) { setState(() { _status = selected ? '' : e.key; _page = 1; _loading = true; }); _load(); },
                              label: Text('${tr(e.value.$1, e.value.$2)}${n > 0 ? ' ($n)' : ''}'),
                              labelStyle: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: selected ? Colors.white : e.value.$3),
                              selectedColor: e.value.$3,
                              backgroundColor: e.value.$3.withValues(alpha: 0.1),
                              checkmarkColor: Colors.white,
                              side: BorderSide.none,
                              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
                            ),
                          );
                        }).toList(),
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
                                        Row(children: [
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

  Widget _statCard(String label, String value, Color color) => AppCard(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 10),
        topAccent: color,
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(label, style: const TextStyle(fontSize: 10.5, color: T.inkSoft, fontWeight: FontWeight.w700), maxLines: 1, overflow: TextOverflow.ellipsis),
          const SizedBox(height: 3),
          Text(value, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w900)),
        ]),
      );
}
