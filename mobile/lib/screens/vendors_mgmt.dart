import 'dart:async';
import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/export_sheet.dart';
import '../ui/lookup_field.dart';
import '../ui/search_field.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';
import 'insight_kit.dart';
import 'shipment_orders_common.dart';
import 'vendors_mgmt_files.dart';

/// Vendors management («إدارة الموردين»), counterpart of /system/vendors-mgmt on the web.
/// Every activity figure comes from /api/vendors-mgmt, computed from the shipments; the register keeps what the team knows.

const vmEvent = 'vendors:changed';
const _months = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
const _monthsEn = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
String _mon(dynamic m) { final i = (inum(m).toInt() - 1).clamp(0, 11); return tr(_months[i], _monthsEn[i]); }

const vmKinds = <String, (String, String, Color)>{
  'master': ('معتمد', 'On the master', T.success),
  'outside': ('غير معتمد', 'Outside the master', T.warn),
  'freelancer': ('سائق فرد', 'Freelancer', T.violet),
  'fleet': ('أسطول تنشيط', 'Our fleet', T.navy),
  'none': ('غير محدّد', 'Unknown', T.inkFaint),
};
Widget vmKindChip(dynamic k) { final x = vmKinds['$k'] ?? vmKinds['none']!; return Chip2(tr(x.$1, x.$2), x.$3); }

List<Map<String, dynamic>> _list(dynamic v) => List<Map<String, dynamic>>.from(((v as List?) ?? const []).map((e) => Map<String, dynamic>.from(e)));

/// Opens the carrier card by register id, or by name for a carrier only seen in shipments.
void openVendor(BuildContext context, {String? id, String? name}) {
  if ((id ?? '').isEmpty && (name ?? '').isEmpty) return;
  Navigator.push(context, MaterialPageRoute(builder: (_) => VendorCardScreen(id: id, name: name)));
}

/// Shared live-reload state for the screens here.
mixin _LiveLoad<W extends StatefulWidget> on State<W> {
  Timer? _liveT;
  void _onLiveEvt() { _liveT?.cancel(); _liveT = Timer(const Duration(milliseconds: 600), reload); }
  late final void Function() _liveCb = _onLiveEvt;
  List<String> get liveEvents => const [vmEvent, 'shipmentOrders:updated', 'shipmentOrders:fleet', 'shipmentRequests:changed', 'workflow:bulkImported'];
  Future<void> reload();
  void startLive() { for (final e in liveEvents) { Live.instance.on(e, _liveCb); } }
  void stopLive() { _liveT?.cancel(); for (final e in liveEvents) { Live.instance.off(e, _liveCb); } }
}

// Chart colours, same as the web: approved, outside, freelancers, our fleet, approved-share line.
const vmColMaster = Color(0xFFF37121);
const vmColOutside = Color(0xFFFBBF77);
const vmColFreelancer = Color(0xFFCBD5E1);
const vmColFleet = Color(0xFF334155);
const vmColShare = Color(0xFF0EA5E9);

/// Filters as repeated `f_<dim>` query parameters.
String vmFilterQuery(Map<String, List<String>> f) => [
  for (final e in f.entries) for (final v in e.value) 'f_${e.key}=${Uri.encodeQueryComponent(v)}',
].join('&');

const _vmDims = [
  ('branch', 'الفرع', 'Branch'), ('customer', 'العميل', 'Customer'), ('fromCity', 'مدينة التحميل', 'Loading city'), ('toCity', 'مدينة الوصول', 'Destination'),
  ('truckType', 'نوع الشاحنة', 'Truck type'), ('agent', 'مندوب التشغيل', 'Operations rep'), ('payment', 'نوع الدفع', 'Payment type'),
  ('kind', 'نوع المورّد', 'Carrier kind'), ('owner', 'مسؤول المتابعة', 'Follow-up owner'), ('contract', 'حالة التعاقد', 'Contract status'),
];

/// Filter bar shared by the section analysis and the daily page: shipment dimensions narrow the trips, carrier dimensions narrow the carriers.
class VmFilterBar extends StatefulWidget {
  final Map<String, List<String>> value;
  final ValueChanged<Map<String, List<String>>> onChanged;
  final String from;
  final String to;
  const VmFilterBar({super.key, required this.value, required this.onChanged, required this.from, required this.to});
  @override
  State<VmFilterBar> createState() => _VmFilterBarState();
}

class _VmFilterBarState extends State<VmFilterBar> {
  Map<String, List<Map<String, dynamic>>> _opts = {};
  List<Map<String, dynamic>> _owners = [];
  List<Map<String, dynamic>> _contracts = [];
  String _span = '';

  @override
  void initState() { super.initState(); _loadCarrier(); _loadOpts(); }
  @override
  void didUpdateWidget(covariant VmFilterBar old) { super.didUpdateWidget(old); if (old.from != widget.from || old.to != widget.to) _loadOpts(); }

  Future<void> _loadOpts() async {
    final span = '${widget.from}:${widget.to}';
    if (span == _span) return;
    _span = span;
    try {
      final d = await Api.instance.get('/api/shipment-orders/insights/options?from=${widget.from}&to=${widget.to}');
      final o = Map<String, dynamic>.from(d['options'] ?? {});
      if (mounted) setState(() => _opts = {for (final e in o.entries) e.key: _list(e.value)});
    } catch (_) {}
  }
  Future<void> _loadCarrier() async {
    try {
      final d = await Api.instance.get('/api/vendors-mgmt/filter-options');
      if (mounted) setState(() { _owners = _list(d['owners']); _contracts = _list(d['contracts']); });
    } catch (_) {}
  }

  String _label(String k, String v) {
    if (v == '__blank__' || v == '__none') return tr('— غير محدّد —', '— not set —');
    if (k == 'payment') return soPaymentKindLabel(v);
    if (k == 'kind') { final x = vmKinds[v]; return x == null ? v : tr(x.$1, x.$2); }
    if (k == 'contract') return vmContractLabel(v);
    return v;
  }
  List<Map<String, dynamic>> _optionsOf(String k) {
    if (k == 'kind') return [for (final v in ['master', 'outside', 'freelancer', 'fleet']) {'value': v, 'count': null}];
    if (k == 'owner') return _owners;
    if (k == 'contract') return _contracts;
    return _opts[k] ?? const [];
  }

  void _set(String k, List<String> v) {
    final n = {for (final e in widget.value.entries) e.key: [...e.value]};
    if (v.isEmpty) { n.remove(k); } else { n[k] = v; }
    widget.onChanged(n);
  }

  @override
  Widget build(BuildContext context) {
    final f = widget.value;
    final active = f.values.fold<int>(0, (a, v) => a + v.length);
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      SingleChildScrollView(scrollDirection: Axis.horizontal, child: Row(children: [
        for (final dm in _vmDims)
          Padding(padding: const EdgeInsetsDirectional.only(end: 5), child: FilterChip(
            label: Text('${tr(dm.$2, dm.$3)}${(f[dm.$1] ?? const []).isEmpty ? '' : ' (${f[dm.$1]!.length})'}'),
            selected: (f[dm.$1] ?? const []).isNotEmpty,
            onSelected: (_) async {
              final r = await pickValues(context, title: tr(dm.$2, dm.$3), options: _optionsOf(dm.$1), selected: f[dm.$1] ?? const [], labelOf: (v) => _label(dm.$1, v));
              if (r != null) _set(dm.$1, r);
            },
          )),
      ])),
      if (active > 0)
        Padding(padding: const EdgeInsets.only(top: 4), child: Wrap(spacing: 5, runSpacing: 4, children: [
          for (final e in f.entries)
            for (final v in e.value)
              InputChip(
                label: Text(_label(e.key, v), style: const TextStyle(fontSize: 11.5)),
                onDeleted: () => _set(e.key, e.value.where((x) => x != v).toList()),
                visualDensity: VisualDensity.compact,
              ),
          ActionChip(avatar: const Icon(Icons.restart_alt, size: 15), label: Text(tr('مسح الفلاتر', 'Clear filters')), onPressed: () => widget.onChanged({})),
        ])),
    ]);
  }
}

/// Monthly trips stacked by carrier kind, with the approved share above each column.
class _KindStackChart extends StatelessWidget {
  final List<Map<String, dynamic>> months;
  const _KindStackChart(this.months);
  @override
  Widget build(BuildContext context) {
    if (months.isEmpty) return const SizedBox.shrink();
    const h = 130.0;
    num max = 1;
    for (final m in months) {
      final t = inum(m['master']) + inum(m['outside']) + inum(m['freelancer']) + inum(m['fleet']);
      if (t > max) max = t;
    }
    Widget seg(num v, Color c, {bool top = false}) => Container(width: 20, height: h * (v / max),
        decoration: BoxDecoration(color: c, borderRadius: top ? const BorderRadius.vertical(top: Radius.circular(4)) : null));
    Widget legend(Color c, String a, String e) => Row(mainAxisSize: MainAxisSize.min, children: [
      Container(width: 10, height: 10, decoration: BoxDecoration(color: c, borderRadius: BorderRadius.circular(3))),
      const SizedBox(width: 4), Text(tr(a, e), style: const TextStyle(fontSize: 11, color: T.inkSoft)),
    ]);
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      SizedBox(height: h + 40, child: SingleChildScrollView(scrollDirection: Axis.horizontal, reverse: Lang.instance.ar, child: Row(crossAxisAlignment: CrossAxisAlignment.end, children: [
        for (final m in months)
          Padding(padding: const EdgeInsets.symmetric(horizontal: 4), child: Column(mainAxisAlignment: MainAxisAlignment.end, children: [
            Text('${m['masterShare'] ?? 0}%', style: const TextStyle(fontSize: 9.5, fontWeight: FontWeight.w800, color: vmColShare)),
            const SizedBox(height: 2),
            seg(inum(m['fleet']), vmColFleet, top: true),
            seg(inum(m['freelancer']), vmColFreelancer),
            seg(inum(m['outside']), vmColOutside),
            seg(inum(m['master']), vmColMaster),
            const SizedBox(height: 3),
            Text(_mon(m['month']), style: const TextStyle(fontSize: 9, color: T.inkFaint)),
          ])),
      ]))),
      const SizedBox(height: 6),
      Wrap(spacing: 10, runSpacing: 4, children: [
        legend(vmColMaster, 'المعتمدون', 'Approved'), legend(vmColOutside, 'غير معتمدين', 'Outside'),
        legend(vmColFreelancer, 'سائقون أفراد', 'Freelancers'), legend(vmColFleet, 'أسطول تنشيط', 'Our fleet'),
        legend(vmColShare, 'حصّة المعتمدين %', 'Approved share %'),
      ]),
    ]);
  }
}

String _monthEnd(String ym) {
  final y = int.tryParse(ym.substring(0, 4)) ?? DateTime.now().year;
  final m = int.tryParse(ym.substring(5, 7)) ?? DateTime.now().month;
  final d = DateTime(y, m + 1, 0);
  final now = DateTime.now();
  return ymd(d.isAfter(now) ? now : d);
}

String _thisMonth() { final n = DateTime.now(); return '${n.year}-${n.month.toString().padLeft(2, '0')}'; }

Future<String?> _pickMonth(BuildContext context, String cur) async {
  final d = await showDatePicker(context: context, initialDate: DateTime.tryParse('$cur-01') ?? DateTime.now(), firstDate: DateTime(2025), lastDate: DateTime.now(),
      helpText: tr('اختر أيَّ يومٍ في الشهر', 'Pick any day in the month'));
  if (d == null) return null;
  return '${d.year}-${d.month.toString().padLeft(2, '0')}';
}

// ── تحليل القسم ─────────────────────────────────────────────────────────────

class VendorsOverviewScreen extends StatefulWidget {
  const VendorsOverviewScreen({super.key});
  @override
  State<VendorsOverviewScreen> createState() => _VendorsOverviewScreenState();
}

class _VendorsOverviewScreenState extends State<VendorsOverviewScreen> with _LiveLoad {
  Map<String, dynamic>? _d;
  String? _error;
  String _month = _thisMonth();
  int _actMonth = -1;
  int _seq = 0;
  Map<String, List<String>> _filters = {};

  @override
  void initState() { super.initState(); reload(); startLive(); }
  @override
  void dispose() { stopLive(); super.dispose(); }

  @override
  Future<void> reload() async {
    final mine = ++_seq;
    try {
      final fq = vmFilterQuery(_filters);
      final d = await Api.instance.get('/api/vendors-mgmt/overview?month=$_month${fq.isEmpty ? '' : '&$fq'}');
      if (!mounted || mine != _seq) return;
      setState(() { _d = Map<String, dynamic>.from(d); _error = null; if (_actMonth < 0) _actMonth = inum(_d!['curMonth']).toInt(); });
    } catch (e) {
      if (mounted && mine == _seq) setState(() => _error = e.toString());
    }
  }

  @override
  Widget build(BuildContext context) {
    final d = _d;
    final k = Map<String, dynamic>.from(d?['kpis'] ?? {});
    final months = _list(d?['months']);
    final acts = _list(d?['activations']);
    final act = acts.firstWhere((a) => inum(a['month']) == _actMonth, orElse: () => const {});
    // Every tile opens the list it counts; every list exports to Excel.
    final ml = _list(d?['masterList']);
    final xl = _list(d?['extActiveList']);
    final yl = _list(d?['extYearList']);
    final fum = _list(d?['followUps']);
    final fud = _list(d?['followUpsDue']);
    final n = d?['inactiveDays'] ?? 90;
    final cmo = inum(d?['curMonth']).toInt();
    String idle(Map<String, dynamic> r) => r['daysIdle'] == null ? tr('لم يعمل قطّ', 'never worked') : '${tr('بلا رحلة منذ', 'idle')} ${r['daysIdle']} ${tr('يومًا', 'days')}';
    String sub(Map<String, dynamic> r) => [if ('${r['owner'] ?? ''}'.isNotEmpty) r['owner'], if (r['contractState'] != null) vmContractLabel(r['contractState']), '${tr('رحلات العام', 'Year')} ${r['trips'] ?? 0}', '${tr('الشهر', 'Month')} ${r['month'] ?? 0}', '${tr('آخر رحلة', 'Last')} ${r['last'] ?? '—'}', idle(r)].join(' · ');
    String fuSub(Map<String, dynamic> r) => [r['at'] ?? r['lastAt'], if ('${r['byName'] ?? ''}'.isNotEmpty) r['byName'], if ('${r['outcome'] ?? ''}'.isNotEmpty) r['outcome'], if (r['nextAt'] != null) '${tr('التالية', 'next')} ${r['nextAt']}', if (r['daysLate'] != null) '${tr('متأخّرة', 'late')} ${r['daysLate']} ${tr('يومًا', 'days')}'].join(' · ');
    Widget tap(Widget tile, String title, List<Map<String, dynamic>> rows, [String Function(Map<String, dynamic>)? s]) => vmTapTile(() => vmDrill(context, title, rows, s ?? sub), tile);
    final inactiveT = tr('غير نشطين ($n يومًا بلا رحلة)', 'Inactive ($n days without a trip)');
    String pendSub(Map<String, dynamic> r) => [r['approvalStatus'] == 'returned' ? tr('مُعاد للتعديل', 'Returned') : tr('بانتظار الاعتماد', 'Pending'), r['submittedByName'], r['submittedAt']].where((x) => '${x ?? ''}'.isNotEmpty).join(' · ');
    String actSub(Map<String, dynamic> r) => '${tr('أوّل رحلة', 'First trip')} ${r['first']} · ${tr('رحلات الشهر', 'Month trips')} ${r['monthTrips']}';
    return AppScaffold(
      title: Text(tr('تحليل قسم الموردين', 'Vendors analysis')),
      actions: [
        TextButton.icon(
          onPressed: () async { final m = await _pickMonth(context, _month); if (m != null) { setState(() { _month = m; _actMonth = -1; }); reload(); } },
          icon: const Icon(Icons.calendar_month, size: 18), label: Text(_month),
        ),
      ],
      body: d == null
          ? (_error != null ? ErrorRetry(message: _error!, onRetry: reload) : const Center(child: CircularProgressIndicator()))
          : RefreshIndicator(onRefresh: reload, child: ListView(padding: const EdgeInsets.all(14), children: [
              Text('${tr('حتى نهاية', 'As of end of')} ${_mon(d['curMonth'])} ${d['year']} · ${tr('النشط = رحلةٌ منفّذة خلال $n يومًا', 'active = an executed trip within $n days')}', style: const TextStyle(fontSize: 12, color: T.inkFaint)),
              const SizedBox(height: 6),
              VmFilterBar(value: _filters, from: '${_month.substring(0, 4)}-01-01', to: _monthEnd(_month), onChanged: (f) { setState(() => _filters = f); reload(); }),
              const SizedBox(height: 6),
              TileWrap([
                tap(KpiTile(tr('الموردون المعتمدون', 'Approved carriers'), fmtNum(k['masterVendors']), color: T.navy), tr('الموردون المعتمدون', 'Approved carriers'), ml),
                tap(KpiTile(tr('نشطون ($n يومًا)', 'Active ($n days)'), fmtNum(k['masterActive']), color: T.success), tr('نشطون ($n يومًا)', 'Active ($n days)'), ml.where((m) => m['active'] == true).toList()),
                tap(KpiTile(inactiveT, fmtNum(k['masterInactive']), color: T.danger), inactiveT, ml.where((m) => m['active'] != true).toList()),
                tap(KpiTile(tr('لم يعملوا قطّ', 'Never worked'), fmtNum(k['masterNeverWorked']), color: T.inkFaint), tr('لم يعملوا قطّ', 'Never worked'), ml.where((m) => m['everWorked'] != true).toList()),
                tap(KpiTile(tr('نشطون هذا الشهر', 'Active this month'), fmtNum(k['masterActiveMonth']), color: T.success), tr('نشطون هذا الشهر', 'Active this month'), ml.where((m) => m['activeThisMonth'] == true).toList()),
                tap(KpiTile(tr('متعاقَدٌ معهم رسميًّا', 'Officially contracted'), fmtNum(k['masterSigned'])), tr('متعاقَدٌ معهم (عقدٌ مسجَّل)', 'Contracted (recorded)'), ml.where((m) => m['contracted'] == true).toList()),
                tap(KpiTile(tr('متعاقَدون بانتظار ملف العقد', 'Contracted, awaiting file'), fmtNum(k['signedAwaitingFile']), color: T.warn), tr('متعاقَدون بانتظار رفع ملف العقد', 'Contracted, awaiting the file'), ml.where((m) => m['awaitingFile'] == true).toList()),
                tap(KpiTile(tr('متعاقَدون غير نشطين', 'Contracted, inactive'), fmtNum(k['signedInactive']), color: T.warn), tr('متعاقَدون غير نشطين', 'Contracted, inactive'), ml.where((m) => m['contracted'] == true && m['active'] != true).toList()),
                tap(KpiTile(tr('نشطون دون عقد', 'Active, no contract'), fmtNum(k['activeUnsigned']), color: T.warn), tr('نشطون دون عقد', 'Active, no contract'), ml.where((m) => m['contracted'] != true && m['active'] == true).toList()),
                tap(KpiTile(tr('شركاتٌ نشطة غير معتمدة', 'Active, not approved'), fmtNum(k['leadsActive']), color: T.warn), tr('شركاتٌ نشطة غير معتمدة', 'Active, not approved'), xl.where((m) => m['kind'] == 'outside').toList()),
                tap(KpiTile(tr('سائقون أفراد نشطون', 'Active freelancers'), fmtNum(k['freelancersActive']), color: T.violet), tr('سائقون أفراد نشطون', 'Active freelancers'), xl.where((m) => m['kind'] == 'freelancer').toList()),
                tap(KpiTile(tr('بانتظار الاعتماد', 'Awaiting approval'), fmtNum(k['pendingApproval']), color: T.violet), tr('بانتظار الاعتماد', 'Awaiting approval'), _list(d['pendingList']), pendSub),
                tap(KpiTile(tr('رحلات التشغيل الخارجي', 'External trips'), fmtNum(k['externalTrips'])), tr('الموردون الذين عملوا هذا العام', 'Carriers that worked this year'), yl),
                tap(KpiTile(tr('رحلات أسطول تنشيط', 'Our fleet trips'), fmtNum(k['fleetTrips']), color: T.navy), tr('الموردون الذين عملوا هذا العام', 'Carriers that worked this year'), yl),
                tap(KpiTile(tr('حصّة المعتمدين', 'Approved share'), '${k['masterShare'] ?? 0}%', color: T.success), tr('المعتمدون الذين عملوا هذا العام', 'Approved carriers that worked this year'), ml.where((m) => inum(m['trips']) > 0).toList()),
                if (has(k, 'purchase')) tap(KpiTile(tr('إجمالي الشراء', 'Total purchase'), soMoney(k['purchase'])), tr('المشتريات حسب المورّد', 'Purchase by carrier'), [...yl]..sort((a, b) => inum(b['buy']).compareTo(inum(a['buy']))), (r) => '${soMoney(r['buy'])} · ${tr('رحلات', 'Trips')} ${r['trips']}'),
                if (has(k, 'avgTrip')) KpiTile(tr('متوسط الرحلة', 'Avg trip'), soMoney(k['avgTrip'])),
                tap(KpiTile(tr('جددٌ هذا الشهر', 'New this month'), fmtNum(k['newThisMonth']), color: T.violet), tr('أوّلُ رحلةٍ على الإطلاق هذا الشهر', 'First ever trip this month'), cmo > 0 ? _list(acts[cmo - 1]['list']) : const [], actSub),
                tap(KpiTile(tr('متابعاتُ الشهر', 'Follow-ups this month'), fmtNum(k['followUpsMonth'])), tr('متابعاتٌ سجّلها الفريق هذا الشهر', 'Follow-ups logged this month'), fum, fuSub),
                tap(KpiTile(tr('متابعاتٌ مستحقّة', 'Follow-ups due'), fmtNum(k['followUpsDue']), color: T.danger), tr('متابعاتٌ حلّ موعدها', 'Follow-ups due'), fud, fuSub),
              ]),
              VmRegisterStats(query: vmFilterQuery(_filters)),
              VmSalesRealisation(data: Map<String, dynamic>.from(d['salesRealisation'] ?? {}), title: tr('تحقيق طلبات المبيعات في ${_mon(d['curMonth'])}', 'Sales requests realised in ${_mon(d['curMonth'])}')),
              // Team performance cards (sourcing / collection / assist) mount here as their own widget.
              VmRanking(month: _month, query: vmFilterQuery(_filters)),
              SectionCard(
                title: tr('الرحلات شهريًا ونسبة القائمة المعتمدة', 'Trips per month and master share'),
                note: tr('الرقم فوق كلّ عمود = حصّة المعتمدين من التشغيل الخارجي (دون أسطول تنشيط)', 'Number above each column = approved share of external trips (excluding our fleet)'),
                child: Column(children: [
                  _KindStackChart(months),
                  const SizedBox(height: 6),
                  for (final m in months.where((m) => inum(m['external']) > 0))
                    Row(children: [
                      SizedBox(width: 64, child: Text(_mon(m['month']), style: const TextStyle(fontSize: 12))),
                      Expanded(child: Text('${tr('معتمدون', 'A')} ${fmtNum(m['master'])} · ${tr('خارج', 'O')} ${fmtNum(m['outside'])} · ${tr('أفراد', 'F')} ${fmtNum(m['freelancer'])} · ${tr('أسطول', 'Fleet')} ${fmtNum(m['fleet'])}', style: const TextStyle(fontSize: 11.5, color: T.inkSoft))),
                      Text('${m['masterShare']}%', style: const TextStyle(fontWeight: FontWeight.w800, color: vmColShare)),
                    ]),
                ]),
              ),
              SectionCard(
                title: tr('تنشيط الموردين شهريًا', 'Vendors activated per month'),
                note: tr('موردون كانت أوّل رحلةٍ لهم في الشهر — اضغط شهرًا لعرضهم', 'Vendors whose first trip fell in the month — tap a month'),
                child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                  SingleChildScrollView(scrollDirection: Axis.horizontal, child: Row(children: [
                    for (final a in acts.where((a) => inum(a['total']) > 0 || inum(a['month']) == _actMonth))
                      Padding(padding: const EdgeInsetsDirectional.only(end: 5), child: ChoiceChip(
                        label: Text('${_mon(a['month'])} (${a['total']})'), selected: inum(a['month']) == _actMonth,
                        onSelected: (_) => setState(() => _actMonth = inum(a['month']).toInt()))),
                  ])),
                  if (act.isNotEmpty) ...[
                    Text('${tr('معتمدون', 'Approved')} ${act['master'] ?? 0} · ${tr('غير معتمد', 'Outside')} ${act['outside'] ?? 0} · ${tr('أفراد', 'Freelancers')} ${act['freelancer'] ?? 0}', style: const TextStyle(fontSize: 12, color: T.inkSoft)),
                    for (final v in _list(act['list']))
                      ListTile(
                        dense: true, contentPadding: EdgeInsets.zero,
                        title: Text('${v['name']}', style: const TextStyle(fontWeight: FontWeight.w700)),
                        subtitle: Text('${tr('أوّل رحلة', 'First trip')} ${v['first']} · ${tr('رحلات الشهر', 'Month trips')} ${v['monthTrips']}${'${v['owner'] ?? ''}'.isEmpty ? '' : ' · ${v['owner']}'}'),
                        trailing: vmKindChip(v['kind']),
                        onTap: () => openVendor(context, id: v['id'], name: v['name']),
                      ),
                  ],
                ]),
              ),
              SectionCard(
                title: tr('أداء الفريق على الموردين المعتمدين', 'Team results on approved carriers'),
                note: tr('حسب مسؤول المتابعة المسنَد على النظام · اضغط اسمًا لعرض موردِيه', 'By the owner assigned on the system · tap for the carriers'),
                child: Column(children: [
                  for (final t in _list(d['team']))
                    ListTile(
                      dense: true, contentPadding: EdgeInsets.zero,
                      title: Text('${t['owner']}', style: const TextStyle(fontWeight: FontWeight.w800)),
                      subtitle: Text('${tr('معتمدون', 'Approved')} ${t['vendors']} · ${tr('نشطون', 'Active')} ${t['active']} (${t['activity']}%) · ${tr('غير نشطين', 'Inactive')} ${t['inactive']} · ${tr('هذا الشهر', 'This month')} ${t['activeMonth']} · ${tr('متعاقَدٌ معهم', 'Contracted')} ${t['signed']} · ${tr('متابعات', 'Follow-ups')} ${t['followUps']} · ${tr('مستحقّة', 'Due')} ${t['due']}'),
                      trailing: Text('${fmtNum(t['trips'])}\n${t['tripsShare']}%', textAlign: TextAlign.center, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 12)),
                      onTap: () => vmDrill(context, '${t['owner']}', ml.where((m) => ('${m['owner'] ?? ''}'.isEmpty ? 'غير موزَّع' : m['owner']) == t['owner']).toList(), sub),
                    ),
                ]),
              ),
              SectionCard(
                title: tr('متابعات الفريق هذا الشهر', 'Team follow-ups this month'),
                note: tr('ما سجّله كلُّ عضوٍ على النظام (دون ملاحظات الاستيراد)', 'Logged on the system (imported notes excluded)'),
                child: BarList([for (final x in _list(d['followUpsByMember'])) ('${x['name']}', inum(x['followUps']), '${x['followUps']} · ${tr('موردون', 'carriers')} ${x['carriers']}')], color: T.info,
                  onTap: (i) { final x = _list(d['followUpsByMember'])[i]; vmDrill(context, '${x['name']}', fum.where((f) => '${f['byName'] ?? '—'}' == '${x['name']}').toList(), fuSub); }),
              ),
              SectionCard(
                title: tr('حسب نوع المورّد', 'By vendor kind'),
                child: BarList([for (final x in _list(d['kinds'])) (tr(vmKinds['${x['kind']}']!.$1, vmKinds['${x['kind']}']!.$2), inum(x['trips']), '${fmtNum(x['trips'])} · ${x['share']}% · ${tr('موردون', 'vendors')} ${x['vendors']} · ${tr('نشطون', 'active')} ${x['active']}')], color: T.navy,
                  onTap: (i) { final x = _list(d['kinds'])[i]; vmDrill(context, tr(vmKinds['${x['kind']}']!.$1, vmKinds['${x['kind']}']!.$2), yl.where((v) => v['kind'] == x['kind']).toList(), sub); }),
              ),
              SectionCard(
                title: tr('اتجاه الموردين المعتمدين', 'Approved carriers trend'),
                child: Wrap(spacing: 6, runSpacing: 6, children: [
                  for (final e in Map<String, dynamic>.from(d['trendMaster'] ?? {}).entries)
                    InkWell(onTap: () => vmDrill(context, tr((trendLabels[e.key] ?? (e.key, e.key, T.ink)).$1, (trendLabels[e.key] ?? (e.key, e.key, T.ink)).$2), ml.where((m) => m['trend'] == e.key).toList(), sub),
                      child: Chip2('${tr((trendLabels[e.key] ?? (e.key, e.key, T.ink)).$1, (trendLabels[e.key] ?? (e.key, e.key, T.ink)).$2)} · ${e.value}', (trendLabels[e.key] ?? (e.key, e.key, T.ink)).$3)),
                ]),
              ),
              SectionCard(
                title: tr('أعلى الموردين رحلاتٍ هذا العام', 'Top vendors this year'),
                child: Column(children: [
                  for (final v in _list(d['topVendors']))
                    ListTile(
                      dense: true, contentPadding: EdgeInsets.zero,
                      title: Text('${v['name']}', style: const TextStyle(fontWeight: FontWeight.w700), overflow: TextOverflow.ellipsis),
                      subtitle: Text('${tr('رحلات', 'Trips')} ${fmtNum(v['trips'])} · ${tr('هذا الشهر', 'This month')} ${v['month']}${has(v, 'buy') ? ' · ${soMoney(v['buy'])}' : ''} · ${tr('آخر رحلة', 'Last')} ${v['last'] ?? '—'}'),
                      trailing: trendChip(v['trend']),
                      onTap: () => openVendor(context, id: v['id'], name: v['name']),
                    ),
                ]),
              ),
              SectionCard(
                title: tr('متعاقَدٌ معهم وغير نشطين', 'Contracted but inactive'),
                note: tr('عقدُهم مسجَّلٌ على النظام ولا رحلة خلال $n يومًا — أولويّةٌ للمتابعة', 'Contract recorded, no trip in $n days — follow up first'),
                accent: T.warn,
                child: Column(children: [
                  for (final v in ml.where((m) => m['contracted'] == true && m['active'] != true))
                    ListTile(dense: true, contentPadding: EdgeInsets.zero, title: Text('${v['name']}', style: const TextStyle(fontWeight: FontWeight.w700)), subtitle: Text(sub(v)), onTap: () => openVendor(context, id: v['id'])),
                ]),
              ),
              const SizedBox(height: 20),
            ])),
    );
  }
}

// ── التحليل التشغيلي اليومي ─────────────────────────────────────────────────

class VendorsDailyScreen extends StatefulWidget {
  const VendorsDailyScreen({super.key});
  @override
  State<VendorsDailyScreen> createState() => _VendorsDailyScreenState();
}

const _blame = [('rep', 'إلغاء من المندوب', 'By rep'), ('noTruck', 'لا سيارة (علينا)', 'No truck (ours)'), ('driver', 'إلغاء من السائق', 'By driver'), ('customer', 'إلغاء من العميل', 'By customer'), ('none', 'بلا سبب', 'No reason'), ('other', 'أخرى', 'Other')];

class _VendorsDailyScreenState extends State<VendorsDailyScreen> with _LiveLoad {
  Map<String, dynamic>? _d;
  String? _error;
  late String _from;
  late String _to;
  Map<String, List<String>> _filters = {};
  // One chosen branch also sets the branch target the page measures against.
  String get _branch => (_filters['branch']?.length ?? 0) == 1 ? _filters['branch']!.first : '';
  int _seq = 0;
  String _custCat = '';

  @override
  void initState() {
    super.initState();
    final n = DateTime.now();
    _from = ymd(DateTime(n.year, n.month, 1));
    _to = ymd(n);
    reload();
    startLive();
  }
  @override
  void dispose() { stopLive(); super.dispose(); }

  @override
  Future<void> reload() async {
    final mine = ++_seq;
    try {
      final fq = vmFilterQuery(_filters);
      final d = await Api.instance.get('/api/vendors-mgmt/daily?from=$_from&to=$_to${_branch.isEmpty ? '' : '&branch=${Uri.encodeQueryComponent(_branch)}'}${fq.isEmpty ? '' : '&$fq'}');
      if (!mounted || mine != _seq) return;
      setState(() { _d = Map<String, dynamic>.from(d); _error = null; });
    } catch (e) {
      if (mounted && mine == _seq) setState(() => _error = e.toString());
    }
  }

  void _setRange(DateTime a, DateTime b) { setState(() { _from = ymd(a); _to = ymd(b); }); reload(); }

  String _statusLabel(dynamic k) { for (final x in soBaseStatuses) { if (x.$1 == '$k') return tr(x.$2, x.$3); } return '${k ?? ''}'; }

  /// The shipment orders behind a daily tile, read with the screen's span and filters.
  Future<void> _rows(String title, String set) async {
    try {
      final fq = vmFilterQuery(_filters);
      final r = await Api.instance.get('/api/vendors-mgmt/daily/rows?from=$_from&to=$_to&set=$set${_branch.isEmpty ? '' : '&branch=${Uri.encodeQueryComponent(_branch)}'}${fq.isEmpty ? '' : '&$fq'}');
      if (!mounted) return;
      vmDrill(context, title, _list(r['rows']),
        (o) => [o['day'], o['branch'], o['customerName'], o['route'], _statusLabel(o['status']), if ('${o['cancelReason'] ?? ''}'.isNotEmpty) o['cancelReason'], if (has(o, 'buyPrice')) soMoney(o['buyPrice'])].where((x) => '${x ?? ''}'.isNotEmpty).join(' · '),
        titleOf: (o) => '${o['waybillNumber'] ?? '—'} · ${o['name']}',
        exportCols: [
          ExportCol('أمر النقل', 'Order', (o) => o['waybillNumber']), ExportCol('اليوم', 'Day', (o) => o['day']), ExportCol('المورّد', 'Carrier', (o) => o['name']),
          ExportCol('النوع', 'Kind', (o) { final x = vmKinds['${o['kind']}']; return x == null ? '' : tr(x.$1, x.$2); }),
          ExportCol('الفرع', 'Branch', (o) => o['branch']), ExportCol('العميل', 'Customer', (o) => o['customerName']), ExportCol('المسار', 'Route', (o) => o['route']),
          ExportCol('الحالة', 'Status', (o) => _statusLabel(o['status'])), ExportCol('سبب الإلغاء', 'Cancel reason', (o) => o['cancelReason']), ExportCol('مندوب التشغيل', 'Ops rep', (o) => o['agentName']),
          if (_list(r['rows']).any((o) => has(o, 'buyPrice'))) ExportCol('الشراء', 'Purchase', (o) => o['buyPrice']),
        ]);
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
    }
  }

  @override
  Widget build(BuildContext context) {
    final d = _d;
    final t = Map<String, dynamic>.from(d?['totals'] ?? {});
    final days = _list(d?['byDay']);
    final branches = _list(d?['branches']);
    final now = DateTime.now();
    final today = DateTime(now.year, now.month, now.day);
    return AppScaffold(
      title: Text(tr('التحليل التشغيلي اليومي', 'Daily operations')),
      body: d == null
          ? (_error != null ? ErrorRetry(message: _error!, onRetry: reload) : const Center(child: CircularProgressIndicator()))
          : RefreshIndicator(onRefresh: reload, child: ListView(padding: const EdgeInsets.all(14), children: [
              SingleChildScrollView(scrollDirection: Axis.horizontal, child: Row(children: [
                for (final p in [
                  ('اليوم', 'Today', today, today),
                  ('أمس', 'Yesterday', today.subtract(const Duration(days: 1)), today.subtract(const Duration(days: 1))),
                  ('7 أيام', '7 days', today.subtract(const Duration(days: 6)), today),
                  ('هذا الشهر', 'This month', DateTime(now.year, now.month, 1), today),
                  ('الشهر الماضي', 'Last month', DateTime(now.year, now.month - 1, 1), DateTime(now.year, now.month, 0)),
                ])
                  Padding(padding: const EdgeInsetsDirectional.only(end: 5), child: ChoiceChip(label: Text(tr(p.$1, p.$2)), selected: _from == ymd(p.$3) && _to == ymd(p.$4), onSelected: (_) => _setRange(p.$3, p.$4))),
                ActionChip(avatar: const Icon(Icons.date_range, size: 15), label: Text('$_from ← $_to'), onPressed: () async {
                  final r = await showDateRangePicker(context: context, firstDate: DateTime(2025), lastDate: DateTime.now(), initialDateRange: DateTimeRange(start: DateTime.parse(_from), end: DateTime.parse(_to)));
                  if (r != null) _setRange(r.start, r.end);
                }),
              ])),
              const SizedBox(height: 4),
              VmFilterBar(value: _filters, from: _from, to: _to, onChanged: (f) { setState(() => _filters = f); reload(); }),
              const SizedBox(height: 6),
              TileWrap([
                vmTapTile(() => _rows(tr('أوامر النقل في الفترة', 'Orders in the span'), 'all'), KpiTile(tr('أوامر النقل', 'Transport orders'), fmtNum(t['requests']))),
                vmTapTile(() => _rows(tr('أوامرُ محقّقة', 'Fulfilled orders'), 'done'), KpiTile(tr('محقّق', 'Fulfilled'), fmtNum(t['done']), color: T.success)),
                vmTapTile(() => _rows(tr('أوامرُ ملغاة وأسبابها', 'Cancelled orders'), 'failed'), KpiTile(tr('غير محقّق (ملغاة)', 'Not fulfilled'), fmtNum(t['failed']), color: T.danger)),
                vmTapTile(() => _rows(tr('أوامرُ ملغاة وأسبابها', 'Cancelled orders'), 'failed'), KpiTile(tr('نسبة التحقيق', 'Fulfilment'), '${t['rate'] ?? 0}%', color: T.navy)),
                vmTapTile(() => _rows(tr('أوامرُ محقّقة', 'Fulfilled orders'), 'done'), KpiTile(tr('محقّق في اليوم', 'Fulfilled per day'), fmtNum(t['perDay'], digits: 1))),
                if (t['vsTarget'] != null) vmTapTile(() => _rows(tr('أوامرُ محقّقة', 'Fulfilled orders'), 'done'), KpiTile(tr('مقابل المستهدَف', 'Vs target'), '${t['vsTarget']}%', color: inum(t['vsTarget']) >= 100 ? T.success : T.warn)),
                if (has(t, 'buy')) vmTapTile(() => _rows(tr('أوامرُ محقّقة وأسعار شرائها', 'Fulfilled orders and purchase'), 'done'), KpiTile(tr('سعر الشراء', 'Purchase'), soMoney(t['buy']))),
                if (has(t, 'buyExt')) vmTapTile(() => _rows(tr('رحلات التشغيل الخارجي', 'External trips'), 'external'), KpiTile(tr('شراءٌ بدون تنشيط', 'Purchase excl. fleet'), soMoney(t['buyExt']))),
                vmTapTile(() => _rows(tr('رحلات أسطول تنشيط', 'Our fleet trips'), 'fleet'), KpiTile(tr('حصّة أسطول تنشيط', 'Our fleet share'), '${t['fleetShare'] ?? 0}%', color: T.navy)),
                vmTapTile(() => _rows(tr('رحلات السائقين الأفراد', 'Freelancer trips'), 'freelancer'), KpiTile(tr('الأفراد من التشغيل الخارجي', 'Freelancers of external'), '${t['freelancerShareExt'] ?? 0}%', color: T.violet)),
              ]),
              VmSalesRealisation(data: Map<String, dynamic>.from(d['salesRequests'] ?? {}), title: tr('تحقيق طلبات المبيعات في الفترة', 'Realisation of sales requests in the span')),
              VmRegisterStats(query: vmFilterQuery(_filters)),
              // Team performance cards (sourcing / collection / assist) mount here as their own widget.
              if (inum(d['target']?['daily']) > 0) Text('${tr('المستهدَف اليومي', 'Daily target')}: ${d['target']['daily']} · ${tr('مستهدَف الفترة', 'Period target')}: ${d['target']['period']}', style: const TextStyle(fontSize: 12, color: T.inkFaint)),
              if (days.length > 1)
                SectionCard(
                  title: tr('حسب اليوم', 'By day'),
                  note: tr('محقّق (برتقالي) وغير محقّق (أحمر)', 'Fulfilled (orange) and not (red)'),
                  child: Column(children: [
                    ColumnChart(labels: [for (final x in days) '${x['day']}'.substring(8)], a: [for (final x in days) inum(x['done'])], b: [for (final x in days) inum(x['failed'])]),
                    for (final x in days.reversed)
                      Padding(padding: const EdgeInsets.symmetric(vertical: 2), child: Row(children: [
                        SizedBox(width: 82, child: Text('${x['day']}', style: const TextStyle(fontSize: 11.5))),
                        Expanded(child: Text('${x['requests']} / ${x['done']} / ${x['failed']} · ${x['rate']}%${x['vsTarget'] != null ? ' · ${tr('المستهدَف', 'target')} ${x['vsTarget']}%' : ''}${has(x, 'buy') ? ' · ${soMoney(x['buy'])}' : ''}', style: const TextStyle(fontSize: 11.5, color: T.inkSoft))),
                      ])),
                  ]),
                ),
              SectionCard(
                title: tr('حسب نوع المورّد', 'By vendor kind'),
                child: Column(children: [
                  for (final k in _list(d['kinds']))
                    ListTile(dense: true, contentPadding: EdgeInsets.zero,
                      title: Text('${k['label']}', style: const TextStyle(fontWeight: FontWeight.w700)),
                      subtitle: Text('${tr('موردون', 'Vendors')} ${k['vendors']} · ${tr('رحلات', 'Trips')} ${fmtNum(k['trips'])} (${k['share']}%)${has(k, 'buy') ? ' · ${soMoney(k['buy'])} (${k['buyShare']}%) · ${tr('متوسط', 'avg')} ${soMoney(k['avg'])}' : ''}')),
                ]),
              ),
              SectionCard(
                title: tr('حسب نوع الدفع', 'By payment type'),
                child: BarList([for (final p in _list(d['payments'])) ('${p['key']}'.isEmpty ? tr('غير محدّد', 'Unset') : soPaymentKindLabel(p['key']), inum(p['trips']), '${fmtNum(p['trips'])} · ${p['share']}%${has(p, 'avg') ? ' · ${soMoney(p['avg'])}' : ''}')], color: T.info),
              ),
              SectionCard(
                title: tr('من المسؤول عن عدم التحقيق', 'Who caused non-fulfilment'),
                child: Column(children: [
                  for (final b in _list(d['blame']))
                    ListTile(dense: true, contentPadding: EdgeInsets.zero,
                      title: Text('${b['branch']} · ${b['failed']}', style: const TextStyle(fontWeight: FontWeight.w700)),
                      subtitle: Text([for (final x in _blame) if (inum(b[x.$1]) > 0) '${tr(x.$2, x.$3)} ${b[x.$1]}'].join(' · ')),
                      trailing: Text('${b['repShare']}%', style: const TextStyle(color: T.danger, fontWeight: FontWeight.w800))),
                ]),
              ),
              SectionCard(
                title: tr('الاعتماد على السائقين الأفراد حسب الفرع', 'Reliance on freelancers by branch'),
                child: BarList([for (final b in _list(d['branchKinds'])) ('${b['branch']}', inum(b['freelancerShareExt']), '${b['freelancerShareExt']}% · ${tr('أسطول', 'fleet')} ${b['fleet']} · ${tr('شركات', 'companies')} ${b['companies']} · ${tr('أفراد', 'freelancers')} ${b['freelancer']}')], color: T.violet),
              ),
              SectionCard(
                title: tr('أداء الفروع', 'Branch performance'),
                child: Column(children: [
                  for (final b in branches)
                    ListTile(dense: true, contentPadding: EdgeInsets.zero,
                      title: Text('${b['branch']}', style: const TextStyle(fontWeight: FontWeight.w800)),
                      subtitle: Text('${tr('طلبات', 'Requests')} ${b['requests']} · ${tr('محقّق', 'Done')} ${b['done']} · ${tr('غير محقّق', 'Failed')} ${b['failed']} · ${b['rate']}% · ${tr('في اليوم', '/day')} ${b['perDay']}${b['vsTarget'] != null ? ' · ${tr('المستهدَف', 'target')} ${b['vsTarget']}%' : ''}${has(b, 'buy') ? ' · ${soMoney(b['buy'])}' : ''}${'${b['topReason'] ?? ''}'.isEmpty ? '' : ' · ${tr('أكبر سبب', 'top reason')}: ${b['topReason']}'}')),
                ]),
              ),
              SectionCard(
                title: tr('الطلبات حسب العميل', 'Requests by customer'),
                child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                  Wrap(spacing: 5, runSpacing: 5, children: [
                    for (final c in [('', 'الكل', 'All', 'all'), ('full', 'تحقّق كاملًا', 'Fully', 'full'), ('partial', 'تحقّق جزئيًا', 'Partly', 'partial'), ('none', 'لم يتحقّق شيء', 'None', 'none')])
                      ChoiceChip(label: Text('${tr(c.$2, c.$3)} (${d['customerCats']?[c.$4]?['customers'] ?? 0})'), selected: _custCat == c.$1, onSelected: (_) => setState(() => _custCat = c.$1)),
                  ]),
                  for (final c in _list(d['customers']).where((c) => _custCat.isEmpty || c['category'] == _custCat).take(60))
                    ListTile(dense: true, contentPadding: EdgeInsets.zero,
                      title: Text('${c['name']}', style: const TextStyle(fontWeight: FontWeight.w700)),
                      subtitle: Text('${c['branch']}${'${c['sales'] ?? ''}'.isEmpty ? '' : ' · ${c['sales']}'} · ${c['requests']} / ${c['done']} / ${c['failed']} · ${c['rate']}%${_list(c['reasons']).isEmpty ? '' : ' · ${_list(c['reasons']).map((r) => '${r['reason']} ${r['n']}').join('، ')}'}')),
                ]),
              ),
              SectionCard(title: tr('أعلى 10 موردين', 'Top 10 vendors'), child: BarList([for (final v in _list(d['topVendors'])) ('${v['name']}', inum(v['trips']), '${v['trips']} · ${v['share']}%${has(v, 'buy') ? ' · ${soMoney(v['buy'])}' : ''}')], onTap: (i) => openVendor(context, id: _list(d['topVendors'])[i]['id'], name: _list(d['topVendors'])[i]['name']))),
              SectionCard(title: tr('أعلى 10 سائقين أفراد', 'Top 10 freelancers'), child: BarList([for (final v in _list(d['topFreelancers'])) ('${v['name']}', inum(v['trips']), '${v['trips']} · ${v['share']}%')], color: T.violet, onTap: (i) => openVendor(context, id: _list(d['topFreelancers'])[i]['id'], name: _list(d['topFreelancers'])[i]['name']))),
              SectionCard(title: tr('مناديب التشغيل (تعميد المورّد)', 'Ops reps (vendor assignment)'), child: BarList([for (final v in _list(d['opsReps'])) ('${v['name']}', inum(v['trips']), '${v['trips']} · ${v['shareExt'] ?? v['share']}%${has(v, 'avg') ? ' · ${soMoney(v['avg'])}' : ''}')], color: T.info)),
              if (_list(d['helpers']).isNotEmpty)
                SectionCard(title: tr('من ساعد من فريق الموردين', 'Vendors team helpers'), child: BarList([for (final v in _list(d['helpers'])) ('${v['name']}', inum(v['trips']), '${v['trips']} · ${v['share']}%')], color: T.success)),
              SectionCard(
                title: tr('المسارات وأسعار الشراء', 'Routes and purchase prices'),
                note: tr('السعر الأكثر تكرارًا وأرخص مورّد وأفضل مورّد على كلّ مسار', 'Most common price, cheapest and best vendor per route'),
                child: Column(children: [
                  for (final r in _list(d['routes']).take(40))
                    ExpansionTile(
                      tilePadding: EdgeInsets.zero,
                      title: Text('${r['route']}', style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13)),
                      subtitle: Text('${tr('رحلات', 'Trips')} ${r['done']} · ${tr('أسطول', 'fleet')} ${r['fleet']} · ${tr('شركات', 'companies')} ${r['companies']} · ${tr('أفراد', 'freelancers')} ${r['freelancer']} · ${tr('جهات', 'executors')} ${r['executors']}', style: const TextStyle(fontSize: 11.5)),
                      children: [
                        if (r['modePrice'] != null) Align(alignment: AlignmentDirectional.centerStart, child: Text('${tr('السعر الأكثر تكرارًا', 'Most common price')}: ${soMoney(r['modePrice'])}', style: const TextStyle(color: T.orange, fontWeight: FontWeight.w800))),
                        Wrap(spacing: 5, runSpacing: 5, children: [for (final p in _list(r['prices'])) Chip2('${soMoney(p['price'])} (${p['n']})', inum(p['price']) == inum(r['modePrice']) ? T.orange : T.inkSoft)]),
                        if (r['cheapest'] != null) ListTile(dense: true, contentPadding: EdgeInsets.zero, leading: const Icon(Icons.savings_outlined, color: T.success), title: Text('${tr('أرخص مورّد', 'Cheapest')}: ${r['cheapest']['name']}'), trailing: Text(soMoney(r['cheapest']['price'])), onTap: () => openVendor(context, id: r['cheapest']['id'], name: r['cheapest']['name'])),
                        if (r['best'] != null) ListTile(dense: true, contentPadding: EdgeInsets.zero, leading: const Icon(Icons.emoji_events_outlined, color: T.orange), title: Text('${tr('أفضل مورّد', 'Best')}: ${r['best']['name']}'), trailing: Text('${r['best']['trips']}'), onTap: () => openVendor(context, id: r['best']['id'], name: r['best']['name'])),
                        if (_list(r['fleetPrices']).isNotEmpty) Align(alignment: AlignmentDirectional.centerStart, child: Text('${tr('أسعار أسطول تنشيط', 'Our fleet prices')}: ${_list(r['fleetPrices']).map((p) => '${soMoney(p['price'])} (${p['n']})').join(' · ')}', style: const TextStyle(fontSize: 11.5, color: T.navy))),
                      ],
                    ),
                ]),
              ),
              if (_list(d['purchaseByVendor']).isNotEmpty)
                SectionCard(
                  title: tr('توزيع الشراء على الموردين', 'Purchase by vendor'),
                  child: Column(children: [
                    for (final v in _list(d['purchaseByVendor']).take(60))
                      ListTile(dense: true, contentPadding: EdgeInsets.zero,
                        title: Text('${v['name']}', style: const TextStyle(fontWeight: FontWeight.w700), overflow: TextOverflow.ellipsis),
                        subtitle: Text('${tr(vmKinds['${v['kind']}']?.$1 ?? '', vmKinds['${v['kind']}']?.$2 ?? '')} · ${v['branch'] ?? ''} · ${tr('رحلات', 'Trips')} ${v['trips']}${has(v, 'avg') ? ' · ${tr('متوسط', 'avg')} ${soMoney(v['avg'])}' : ''}'),
                        trailing: has(v, 'buy') ? Text('${soMoney(v['buy'])}\n${v['share']}%', textAlign: TextAlign.end, style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w800)) : null,
                        onTap: () => openVendor(context, id: v['id'], name: v['name'])),
                  ]),
                ),
              const SizedBox(height: 20),
            ])),
    );
  }
}

// ── الموردون ────────────────────────────────────────────────────────────────

class VendorsListScreen extends StatefulWidget {
  /// Optional fixed kind (e.g. 'freelancer' for the freelance drivers page).
  final String kind;
  const VendorsListScreen({super.key, this.kind = ''});
  @override
  State<VendorsListScreen> createState() => _VendorsListScreenState();
}

class _VendorsListScreenState extends State<VendorsListScreen> with _LiveLoad {
  List<Map<String, dynamic>> _all = [];
  List<String> _owners = [];
  String? _error;
  bool _loading = true;
  String _q = '';
  late String _kind = widget.kind;
  String _owner = '';
  String _contract = '';
  String _trend = '';
  String _active = '';
  String _papers = '';
  int _seq = 0;

  @override
  void initState() { super.initState(); reload(); startLive(); }
  @override
  void dispose() { stopLive(); super.dispose(); }

  @override
  Future<void> reload() async {
    final mine = ++_seq;
    try {
      final d = await Api.instance.get('/api/vendors-mgmt/vendors');
      if (!mounted || mine != _seq) return;
      setState(() { _all = _list(d['vendors']); _owners = [for (final o in (d['owners'] as List? ?? const [])) '$o']; _loading = false; _error = null; });
    } catch (e) {
      if (mounted && mine == _seq) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  String _fold(String s) => s.replaceAll(RegExp('[أإآ]'), 'ا').replaceAll('ى', 'ي').replaceAll('ة', 'ه').toLowerCase();

  List<Map<String, dynamic>> get _rows {
    final q = _fold(_q.trim());
    return _all.where((v) {
      if (_kind.isNotEmpty && v['kind'] != _kind) return false;
      if (_owner.isNotEmpty && v['followOwner'] != _owner) return false;
      if (_contract == 'signed' && v['signed'] != true) return false;
      if (_contract == 'unsigned' && v['signed'] == true) return false;
      if (_trend.isNotEmpty && v['trend'] != _trend) return false;
      if (_active == 'month' && v['activeThisMonth'] != true) return false;
      if (_active == '3m' && v['active'] != true) return false;
      if (_active == 'inactive' && v['active'] == true) return false;
      if (_papers == 'missingDocs' && !(v['id'] != null && v['kind'] != 'freelancer' && (v['docsMissing'] as List? ?? const []).isNotEmpty)) return false;
      if (_papers == 'contracted' && v['contracted'] != true) return false;
      if (_papers == 'notContracted' && !(v['id'] != null && v['kind'] != 'freelancer' && v['contracted'] != true)) return false;
      if (_papers == 'expiring' && !(v['contractState'] == 'expiring' || v['contractState'] == 'expired')) return false;
      if (_papers == 'pending' && !(v['approvalStatus'] == 'pending' || v['approvalStatus'] == 'returned')) return false;
      if (q.isNotEmpty && !_fold('${v['name']} ${v['phone'] ?? ''} ${v['headOffice'] ?? ''} ${v['representative'] ?? ''}').contains(q)) return false;
      return true;
    }).toList();
  }

  Future<void> _create() async {
    // A freelance driver keeps the short form; a company joins with its required papers and goes to approval.
    if (widget.kind == 'freelancer') {
      final ok = await Navigator.push<bool>(context, MaterialPageRoute(builder: (_) => const VendorEditScreen(vendor: {'type': 'freelancer'})));
      if (ok == true) reload();
      return;
    }
    final id = await Navigator.push<String>(context, MaterialPageRoute(builder: (_) => const VendorNewScreen()));
    if (id != null && id.isNotEmpty && mounted) { reload(); openVendor(context, id: id); }
  }

  Widget _dd(String label, String value, List<(String, String)> items, void Function(String) on) => Padding(
        padding: const EdgeInsetsDirectional.only(end: 6),
        child: DropdownButton<String>(
          value: items.any((i) => i.$1 == value) ? value : '',
          underline: const SizedBox.shrink(),
          style: const TextStyle(fontSize: 12.5, color: T.ink),
          items: [DropdownMenuItem(value: '', child: Text(label)), for (final i in items) DropdownMenuItem(value: i.$1, child: Text(i.$2))],
          onChanged: (v) => setState(() => on(v ?? '')),
        ),
      );

  @override
  Widget build(BuildContext context) {
    final rows = _rows;
    return AppScaffold(
      title: Text(widget.kind == 'freelancer' ? tr('السائقون الأفراد', 'Freelance drivers') : tr('الموردون', 'Vendors')),
      floatingActionButton: FloatingActionButton.extended(onPressed: _create, icon: const Icon(Icons.add), label: Text(widget.kind == 'freelancer' ? tr('سائق فرد', 'Freelancer') : tr('مورّد', 'Vendor'))),
      body: Column(children: [
        Padding(padding: const EdgeInsets.fromLTRB(12, 8, 12, 0), child: SearchField(hint: tr('الاسم، الجوال، المقر…', 'Name, phone, office…'), onChanged: (v) => setState(() => _q = v))),
        SingleChildScrollView(scrollDirection: Axis.horizontal, padding: const EdgeInsets.symmetric(horizontal: 12), child: Row(children: [
          if (widget.kind.isEmpty) _dd(tr('كل الأنواع', 'All kinds'), _kind, [for (final k in ['master', 'outside', 'freelancer']) (k, tr(vmKinds[k]!.$1, vmKinds[k]!.$2))], (v) => _kind = v),
          _dd(tr('كل المسؤولين', 'All owners'), _owner, [for (final o in _owners) (o, o)], (v) => _owner = v),
          _dd(tr('كل العقود', 'All contracts'), _contract, [('signed', tr('موقّع', 'Signed')), ('unsigned', tr('غير موقّع', 'Unsigned'))], (v) => _contract = v),
          _dd(tr('كل الاتجاهات', 'All trends'), _trend, [for (final e in trendLabels.entries) (e.key, tr(e.value.$1, e.value.$2))], (v) => _trend = v),
          _dd(tr('المستندات والعقد', 'Papers & contract'), _papers, [('missingDocs', tr('مستنداتٌ ناقصة', 'Missing papers')), ('contracted', tr('متعاقَد رسميًّا', 'Contracted')), ('notContracted', tr('غير متعاقَد', 'Not contracted')), ('expiring', tr('عقودٌ تنتهي / انتهت', 'Contracts ending')), ('pending', tr('بانتظار الاعتماد', 'Pending approval'))], (v) => _papers = v),
          _dd(tr('كل النشاط', 'Any activity'), _active, [('month', tr('نشط هذا الشهر', 'Active this month')), ('3m', tr('نشط (ضمن مدّة النشاط)', 'Active (within the activity window)')), ('inactive', tr('غير نشط', 'Inactive'))], (v) => _active = v),
        ])),
        Padding(padding: const EdgeInsets.symmetric(horizontal: 14), child: Align(alignment: AlignmentDirectional.centerStart, child: Text('${rows.length} ${tr('مورّد', 'vendors')}', style: const TextStyle(fontSize: 12, color: T.inkFaint)))),
        Expanded(child: _loading
            ? const Center(child: CircularProgressIndicator())
            : _error != null
                ? ErrorRetry(message: _error!, onRetry: reload)
                : RefreshIndicator(onRefresh: reload, child: ListView.builder(
                    padding: const EdgeInsets.fromLTRB(12, 4, 12, 90),
                    itemCount: rows.length.clamp(0, 400),
                    itemBuilder: (_, i) {
                      final v = rows[i];
                      return Padding(padding: const EdgeInsets.only(bottom: 6), child: Pressable(
                        onTap: () => openVendor(context, id: v['id'], name: v['name']),
                        child: AppCard(padding: const EdgeInsets.all(12), child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                          Row(children: [
                            Expanded(child: Text('${v['name']}', style: const TextStyle(fontWeight: FontWeight.w800), overflow: TextOverflow.ellipsis)),
                            gradeBadge(v['grade'], score: v['score']),
                          ]),
                          const SizedBox(height: 4),
                          Wrap(spacing: 5, runSpacing: 4, children: [
                            vmKindChip(v['kind']),
                            trendChip(v['trend']),
                            if ('${v['followOwner'] ?? ''}'.isNotEmpty) Chip2('${v['followOwner']}', T.info, icon: Icons.person_outline),
                            if ('${v['contractStatus'] ?? ''}'.isNotEmpty) Chip2('${v['contractStatus']}', v['signed'] == true ? T.success : T.warn),
                            if ('${v['leadPriority'] ?? ''}'.isNotEmpty) Chip2('${v['leadPriority']}', T.danger),
                            if (v['unregistered'] == true) Chip2(tr('غير مسجّل', 'Unregistered'), T.inkFaint),
                            if (v['approvalStatus'] != null && v['approvalStatus'] != 'approved') vmApprovalChip(v['approvalStatus']),
                            if (v['id'] != null && v['kind'] != 'freelancer' && (v['docsMissing'] as List? ?? const []).isNotEmpty) Chip2('${tr('ينقصه', 'Missing')} ${(v['docsMissing'] as List).length} ${tr('مستند', 'papers')}', T.danger),
                            if (v['contracted'] == true) Chip2('${tr('متعاقَد', 'Contracted')}${v['contractEndDate'] != null ? ' · ${v['contractEndDate']}' : ''}', v['contractState'] == 'expired' ? T.danger : v['contractState'] == 'expiring' ? T.warn : T.success),
                          ]),
                          const SizedBox(height: 4),
                          Text('${tr('رحلات العام', 'Year trips')} ${fmtNum(v['trips'])} · ${tr('هذا الشهر', 'This month')} ${v['month'] ?? 0} · ${tr('آخر رحلة', 'Last')} ${v['last'] ?? '—'}${has(v, 'avg') && inum(v['avg']) > 0 ? ' · ${tr('متوسط', 'avg')} ${soMoney(v['avg'])}' : ''}${v['completeness'] != null && v['id'] != null ? ' · ${tr('اكتمال الملف', 'File')} ${v['completeness']}%' : ''}',
                              style: const TextStyle(fontSize: 11.5, color: T.inkSoft)),
                        ])),
                      ));
                    },
                  ))),
      ]),
    );
  }
}

// ── بطاقة المورّد ───────────────────────────────────────────────────────────

class VendorCardScreen extends StatefulWidget {
  final String? id;
  final String? name;
  const VendorCardScreen({super.key, this.id, this.name});
  @override
  State<VendorCardScreen> createState() => _VendorCardScreenState();
}

const _channels = [('call', 'اتصال', 'Call'), ('whatsapp', 'واتساب', 'WhatsApp'), ('visit', 'زيارة', 'Visit'), ('email', 'بريد', 'Email'), ('meeting', 'اجتماع', 'Meeting'), ('other', 'أخرى', 'Other')];

class _VendorCardScreenState extends State<VendorCardScreen> with _LiveLoad {
  Map<String, dynamic>? _d;
  String? _error;
  late String? _id = widget.id;

  @override
  void initState() { super.initState(); reload(); startLive(); }
  @override
  void dispose() { stopLive(); super.dispose(); }

  @override
  Future<void> reload() async {
    try {
      dynamic d;
      if ((_id ?? '').isNotEmpty) {
        d = await Api.instance.get('/api/vendors-mgmt/vendors/$_id');
      } else {
        d = await Api.instance.get('/api/vendors-mgmt/vendors/by-name?name=${Uri.encodeQueryComponent(widget.name ?? '')}');
        if (d is Map && d['redirect'] != null) { _id = '${d['redirect']}'; return reload(); }
      }
      if (mounted) setState(() { _d = Map<String, dynamic>.from(d); _error = null; });
    } catch (e) {
      if (mounted) setState(() => _error = e.toString());
    }
  }

  Future<void> _addFollowUp() async {
    final ok = await showModalBottomSheet<bool>(
      context: context, isScrollControlled: true, backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (_) => _FollowUpSheet(vendorId: _id!),
    );
    if (ok == true) reload();
  }

  Future<void> _register() async {
    final v = Map<String, dynamic>.from(_d?['vendor'] ?? {});
    final id = await Navigator.push<String>(context, MaterialPageRoute(builder: (_) => VendorNewScreen(name: '${v['name'] ?? ''}', aliases: [for (final n in (_d?['names'] as List? ?? const [])) '$n'])));
    if (id != null && id.isNotEmpty) { _id = id; reload(); }
  }

  Widget _kv(String k, dynamic v) => '${v ?? ''}'.trim().isEmpty ? const SizedBox.shrink() : Padding(
        padding: const EdgeInsets.symmetric(vertical: 2),
        child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          SizedBox(width: 118, child: Text(k, style: const TextStyle(fontSize: 12, color: T.inkFaint))),
          Expanded(child: Text('$v', style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600))),
        ]),
      );

  Widget _group(String title, List<Map<String, dynamic>> rows, {Color color = T.orange}) => rows.isEmpty
      ? const SizedBox.shrink()
      : SectionCard(title: title, child: BarList([for (final r in rows.take(12)) ('${r['name']}', inum(r['trips']), '${r['trips']} · ${r['share']}%${has(r, 'avg') ? ' · ${soMoney(r['avg'])}' : ''}')], color: color));

  @override
  Widget build(BuildContext context) {
    final d = _d;
    final v = Map<String, dynamic>.from(d?['vendor'] ?? {});
    final a = Map<String, dynamic>.from(d?['activity'] ?? {});
    final mon = [for (final x in (a['mon'] as List? ?? const [])) inum(x)];
    final registered = v['unregistered'] != true && (_id ?? '').isNotEmpty;
    return AppScaffold(
      title: Text('${v['name'] ?? widget.name ?? tr('بطاقة المورّد', 'Vendor card')}'),
      actions: [
        if (registered) IconButton(tooltip: tr('تعديل الملف', 'Edit file'), icon: const Icon(Icons.edit_outlined), onPressed: () async {
          final ok = await Navigator.push<bool>(context, MaterialPageRoute(builder: (_) => VendorEditScreen(vendor: v)));
          if (ok == true) reload();
        }),
      ],
      floatingActionButton: registered ? FloatingActionButton.extended(onPressed: _addFollowUp, icon: const Icon(Icons.add_comment_outlined), label: Text(tr('متابعة', 'Follow-up'))) : null,
      body: d == null
          ? (_error != null ? ErrorRetry(message: _error!, onRetry: reload) : const Center(child: CircularProgressIndicator()))
          : RefreshIndicator(onRefresh: reload, child: ListView(padding: const EdgeInsets.fromLTRB(14, 14, 14, 90), children: [
              AppCard(child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                Wrap(spacing: 5, runSpacing: 5, crossAxisAlignment: WrapCrossAlignment.center, children: [
                  if (d['grade'] != null) gradeBadge(d['grade'], score: d['score']),
                  vmKindChip(v['kind'] ?? 'none'),
                  trendChip(d['trend']),
                  if (v['inMaster'] == true) Chip2('${tr('معتمد · رقم', 'Approved no.')} ${v['masterNo'] ?? ''}', T.success),
                  if ('${v['contractStatus'] ?? ''}'.isNotEmpty) Chip2('${tr('العقد', 'Contract')}: ${v['contractStatus']}', v['signed'] == true ? T.success : T.warn),
                  if ('${v['followOwner'] ?? ''}'.isNotEmpty) Chip2('${tr('مسؤول المتابعة', 'Owner')}: ${v['followOwner']}', T.info),
                  if (!registered) Chip2(tr('غير مسجّل في السجلّ', 'Not in the register'), T.danger),
                ]),
                const SizedBox(height: 8),
                _kv(tr('صاحب المنشأة', 'Owner'), [v['ownerName'], v['ownerPhone']].where((e) => '${e ?? ''}'.isNotEmpty).join(' · ')),
                _kv(tr('المشغّل', 'Operator'), [v['operatorName'], v['operatorPhone']].where((e) => '${e ?? ''}'.isNotEmpty).join(' · ')),
                _kv(tr('الجوال', 'Phone'), v['phone']),
                _kv(tr('ممثل المورّد', 'Representative'), v['representative']),
                _kv(tr('المقر', 'Head office'), v['headOffice']),
                _kv(tr('الوجهات', 'Destinations'), v['destinations']),
                _kv(tr('نوع السيارات', 'Vehicle types'), v['vehicleTypes']),
                _kv(tr('عدد السيارات', 'Fleet size'), v['fleetSize']),
                _kv(tr('مندوب تنشيط', 'Our rep'), v['energizeRep']),
                _kv(tr('التصنيف الضريبي', 'Tax class'), v['taxClass']),
                _kv(tr('تاريخ التعاقد', 'Contract date'), v['contractDate']),
                _kv(tr('مدّة السداد', 'Payment term'), v['paymentTermDays'] == null ? null : '${v['paymentTermDays']} ${tr('يومًا', 'days')}'),
                _kv(tr('كود المالية', 'Finance code'), v['financeCode']),
                _kv(tr('السجلّ التجاري', 'CR'), v['commercialRegister']),
                _kv(tr('تقييم الفريق', 'Team rating'), v['rating'] == null ? null : '${v['rating']}/5 ${v['ratingNote'] ?? ''}'),
                if (_list(d['missing']).isNotEmpty) ...[
                  const SizedBox(height: 6),
                  Text('${tr('ناقصٌ في الملف', 'Missing in the file')} (${d['completeness'] ?? 0}% ${tr('مكتمل', 'complete')}): ${_list(d['missing']).map((m) => m['label']).join('، ')}', style: const TextStyle(fontSize: 12, color: T.warn, fontWeight: FontWeight.w700)),
                ],
                if ((d['names'] as List?)?.isNotEmpty == true) ...[
                  const SizedBox(height: 6),
                  Text('${tr('أسماؤه على النظام', 'Names in shipments')}: ${(d['names'] as List).join(' · ')}', style: const TextStyle(fontSize: 11.5, color: T.inkFaint)),
                ],
                if (!registered) Padding(padding: const EdgeInsets.only(top: 8), child: FilledButton.icon(onPressed: _register, icon: const Icon(Icons.app_registration), label: Text(tr('تسجيله في سجلّ الموردين', 'Register this vendor')))),
              ])),
              if (registered) VmApprovalCard(vendorId: _id!, approval: Map<String, dynamic>.from(d['approval'] ?? {}), onChanged: reload),
              if (registered) VmPapersCard(card: d, onChanged: reload),
              if (registered) VmContractCard(card: d, onChanged: reload),
              const SizedBox(height: 10),
              TileWrap([
                KpiTile(tr('رحلات محقّقة', 'Trips'), fmtNum(a['trips']), color: T.navy),
                KpiTile(tr('ملغاة', 'Cancelled'), fmtNum(a['cancelled']), color: T.danger),
                if (has(a, 'buy')) KpiTile(tr('إجمالي الشراء', 'Purchase'), soMoney(a['buy'])),
                if (has(a, 'avg')) KpiTile(tr('متوسط سعر الرحلة', 'Avg trip'), soMoney(a['avg'])),
                KpiTile(tr('أوّل رحلة', 'First trip'), '${a['first'] ?? '—'}'),
                KpiTile(tr('آخر رحلة', 'Last trip'), '${a['last'] ?? '—'}'),
              ]),
              if (mon.any((x) => x > 0))
                SectionCard(title: '${tr('الرحلات كلّ شهر', 'Trips per month')} ${d['year'] ?? ''}', child: ColumnChart(labels: [for (var i = 0; i < 12; i++) _mon(i + 1)], a: mon)),
              if (_list(a['routes']).isNotEmpty)
                SectionCard(
                  title: tr('المسارات وأسعارها', 'Routes and prices'),
                  note: tr('بالأحمر: آخر سعرٍ أعلى من الفئة A المعتمدة', 'Red: last price above approved tier A'),
                  child: Column(children: [
                    for (final r in _list(a['routes']).take(30))
                      ListTile(dense: true, contentPadding: EdgeInsets.zero,
                        title: Text('${r['route']}', style: TextStyle(fontWeight: FontWeight.w700, color: r['aboveA'] == true ? T.danger : T.ink)),
                        subtitle: Text('${tr('رحلات', 'Trips')} ${r['trips']}${has(r, 'min') ? ' · ${soMoney(r['min'])}–${soMoney(r['max'])} · ${tr('متوسط', 'avg')} ${soMoney(r['avg'])}' : ''}${has(r, 'lastPrice') ? ' · ${tr('آخر', 'last')} ${soMoney(r['lastPrice'])}' : ''}${r['approved'] is Map ? ' · A/B/C ${r['approved']['A'] ?? '—'}/${r['approved']['B'] ?? '—'}/${r['approved']['C'] ?? '—'}' : ''}')),
                  ]),
                ),
              _group(tr('حسب الفرع', 'By branch'), _list(a['branches']), color: T.navy),
              _group(tr('أهم العملاء', 'Top customers'), _list(a['customers'])),
              _group(tr('مناديب التشغيل المتعاملون', 'Ops reps dealing'), _list(a['opsReps']), color: T.info),
              _group(tr('السائقون', 'Drivers'), _list(a['drivers']), color: T.violet),
              if (_list(d['vehicles']).isNotEmpty)
                SectionCard(title: '${tr('سيارات المورّد في السجل', 'Registered trucks')} (${_list(d['vehicles']).length})', child: Column(children: [
                  for (final x in _list(d['vehicles']).take(40))
                    ListTile(dense: true, contentPadding: EdgeInsets.zero, title: Text('${x['plate']}', style: const TextStyle(fontWeight: FontWeight.w700)),
                      subtitle: Text([x['truckType'], x['brand'], x['defaultDriverName'], if ('${x['operationCardExpiry'] ?? ''}'.isNotEmpty) '${tr('بطاقة التشغيل', 'Op card')} ${x['operationCardExpiry']}'].where((e) => '${e ?? ''}'.isNotEmpty).join(' · '))),
                ])),
              if (_list(d['drivers']).isNotEmpty)
                SectionCard(title: '${tr('سائقو المورّد في السجل', 'Registered drivers')} (${_list(d['drivers']).length})', child: Column(children: [
                  for (final x in _list(d['drivers']).take(40))
                    ListTile(dense: true, contentPadding: EdgeInsets.zero, title: Text('${x['name']}', style: const TextStyle(fontWeight: FontWeight.w700)),
                      subtitle: Text([x['phone'], x['nationality'], x['residenceNumber'], if ('${x['driverCardExpiry'] ?? ''}'.isNotEmpty) '${tr('البطاقة', 'Card')} ${x['driverCardExpiry']}'].where((e) => '${e ?? ''}'.isNotEmpty).join(' · '))),
                ])),
              if (_list(a['lastTrips']).isNotEmpty)
                SectionCard(title: tr('آخر الرحلات', 'Latest trips'), child: Column(children: [
                  for (final o in _list(a['lastTrips']))
                    ListTile(dense: true, contentPadding: EdgeInsets.zero,
                      leading: Text('${o['waybillNumber'] ?? ''}', style: const TextStyle(fontWeight: FontWeight.w800, color: T.orange, fontSize: 12)),
                      title: Text('${o['route']} · ${o['customer'] ?? ''}', style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700)),
                      subtitle: Text([o['day'], o['branch'], o['rep'], o['plate'], o['driver'], if (has(o, 'price')) soMoney(o['price'])].where((e) => '${e ?? ''}'.isNotEmpty).join(' · '), style: const TextStyle(fontSize: 11))),
                ])),
              SectionCard(
                title: tr('المتابعات', 'Follow-ups'),
                child: Column(children: [
                  if (_list(d['followUps']).isEmpty) Padding(padding: const EdgeInsets.all(10), child: Text(tr('لا متابعاتٍ بعد', 'No follow-ups yet'), style: const TextStyle(color: T.inkFaint))),
                  for (final f in _list(d['followUps']))
                    ListTile(dense: true, contentPadding: EdgeInsets.zero,
                      leading: Icon(f['channel'] == 'whatsapp' ? Icons.chat_outlined : f['channel'] == 'visit' ? Icons.place_outlined : Icons.call_outlined, size: 18, color: T.inkSoft),
                      title: Text([f['outcome'], f['contractStatus']].where((e) => '${e ?? ''}'.isNotEmpty).join(' · '), style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13)),
                      subtitle: Text([f['note'], f['byName'], soFmtDate(f['at']), if (f['nextAt'] != null) '${tr('التالية', 'Next')} ${soFmtDate(f['nextAt'])}'].where((e) => '${e ?? ''}'.isNotEmpty).join(' · ')),
                      trailing: registered ? IconButton(icon: const Icon(Icons.delete_outline, size: 18), onPressed: () async {
                        final messenger = ScaffoldMessenger.of(context);
                        try { await Api.instance.delete('/api/vendors-mgmt/follow-ups/${f['_id']}'); reload(); }
                        catch (e) { messenger.showSnackBar(SnackBar(content: Text(e.toString()))); }
                      }) : null),
                ]),
              ),
            ])),
    );
  }
}

class _FollowUpSheet extends StatefulWidget {
  final String vendorId;
  const _FollowUpSheet({required this.vendorId});
  @override
  State<_FollowUpSheet> createState() => _FollowUpSheetState();
}

class _FollowUpSheetState extends State<_FollowUpSheet> {
  String _channel = 'call';
  final _outcome = TextEditingController();
  final _note = TextEditingController();
  final _contract = TextEditingController();
  DateTime? _next;
  bool _busy = false;
  @override
  void dispose() { _outcome.dispose(); _note.dispose(); _contract.dispose(); super.dispose(); }
  Future<void> _save() async {
    if (_outcome.text.trim().isEmpty && _note.text.trim().isEmpty) return;
    setState(() => _busy = true);
    try {
      await Api.instance.post('/api/vendors-mgmt/vendors/${widget.vendorId}/follow-ups', {
        'channel': _channel, 'outcome': _outcome.text.trim(), 'note': _note.text.trim(),
        if (_contract.text.trim().isNotEmpty) 'contractStatus': _contract.text.trim(),
        if (_next != null) 'nextAt': '${ymd(_next!)}T12:00:00',
      });
      if (mounted) Navigator.pop(context, true);
    } catch (e) {
      if (mounted) { setState(() => _busy = false); ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString()))); }
    }
  }
  @override
  Widget build(BuildContext context) => Padding(
        padding: EdgeInsets.fromLTRB(16, 16, 16, 16 + MediaQuery.of(context).viewInsets.bottom),
        child: SingleChildScrollView(child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Text(tr('تسجيل متابعة', 'Record a follow-up'), style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 16)),
          Wrap(spacing: 5, children: [for (final c in _channels) ChoiceChip(label: Text(tr(c.$2, c.$3)), selected: _channel == c.$1, onSelected: (_) => setState(() => _channel = c.$1))]),
          TextField(controller: _outcome, decoration: InputDecoration(labelText: tr('ما تمّ *', 'Outcome *'))),
          TextField(controller: _note, maxLines: 2, decoration: InputDecoration(labelText: tr('ملاحظة', 'Note'))),
          const SizedBox(height: 6),
          LookupField(type: 'vendor_contract_status', controller: _contract, label: tr('حالة التعاقد بعد المتابعة', 'Contract status after it')),
          const SizedBox(height: 6),
          OutlinedButton.icon(
            onPressed: () async { final d = await showDatePicker(context: context, initialDate: DateTime.now().add(const Duration(days: 3)), firstDate: DateTime.now(), lastDate: DateTime.now().add(const Duration(days: 365))); if (d != null) setState(() => _next = d); },
            icon: const Icon(Icons.event),
            label: Text(_next == null ? tr('موعد المتابعة التالية (اختياري)', 'Next follow-up (optional)') : ymd(_next!)),
          ),
          const SizedBox(height: 10),
          FilledButton(onPressed: _busy ? null : _save, child: Text(tr('حفظ', 'Save'))),
        ])),
      );
}

// ── Edit / create the carrier file ──────────────────────────────────────────

class VendorEditScreen extends StatefulWidget {
  final Map<String, dynamic> vendor;
  const VendorEditScreen({super.key, required this.vendor});
  @override
  State<VendorEditScreen> createState() => _VendorEditScreenState();
}

const _textFields = [
  ('name', 'الاسم *', 'Name *'), ('ownerName', 'اسم صاحب المنشأة', 'Owner name'), ('ownerPhone', 'جوال صاحب المنشأة', 'Owner mobile'),
  ('operatorName', 'المشغّل (من نتعامل معه)', 'Operator'), ('operatorPhone', 'جوال المشغّل', 'Operator mobile'), ('phone', 'الجوال', 'Phone'), ('representative', 'ممثل المورّد', 'Representative'), ('headOffice', 'المقر الرئيسي', 'Head office'),
  ('destinations', 'الوجهات', 'Destinations'), ('vehicleTypes', 'نوع السيارات', 'Vehicle types'), ('fleetSize', 'عدد السيارات', 'Fleet size'),
  ('energizeRep', 'مندوب تنشيط', 'Our rep'), ('followOwner', 'مسؤول المتابعة', 'Follow-up owner'), ('contractDate', 'تاريخ التعاقد', 'Contract date'),
  ('paymentTermDays', 'مدّة السداد (أيام)', 'Payment term (days)'), ('financeCode', 'كود المورّد (المالية)', 'Finance code'), ('commercialRegister', 'السجلّ التجاري', 'CR'),
  ('iban', 'الآيبان', 'IBAN'), ('leadPriority', 'أولوية المتابعة', 'Lead priority'), ('notes', 'ملاحظات', 'Notes'),
];

class _VendorEditScreenState extends State<VendorEditScreen> {
  late final Map<String, TextEditingController> _c = {
    for (final f in _textFields) f.$1: TextEditingController(text: widget.vendor[f.$1] == null ? '' : '${widget.vendor[f.$1]}'),
    'taxClass': TextEditingController(text: '${widget.vendor['taxClass'] ?? ''}'),
    'contractStatus': TextEditingController(text: '${widget.vendor['contractStatus'] ?? ''}'),
    'aliases': TextEditingController(text: [for (final a in (widget.vendor['aliases'] as List? ?? const [])) '$a'].join('\n')),
    'ratingNote': TextEditingController(text: '${widget.vendor['ratingNote'] ?? ''}'),
  };
  late String _type = '${widget.vendor['type'] ?? 'company'}';
  late bool _inMaster = widget.vendor['inMaster'] == true;
  late bool _vendorSigned = widget.vendor['vendorSigned'] == true;
  late bool _ourSigned = widget.vendor['ourSigned'] == true;
  late bool _hasPapers = widget.vendor['hasPapers'] == true;
  late int? _rating = widget.vendor['rating'] == null ? null : inum(widget.vendor['rating']).toInt();
  bool _busy = false;
  bool get _isNew => widget.vendor['_id'] == null;

  @override
  void dispose() { for (final c in _c.values) { c.dispose(); } super.dispose(); }

  Future<void> _save() async {
    if (_c['name']!.text.trim().isEmpty) return;
    setState(() => _busy = true);
    final body = <String, dynamic>{
      for (final e in _c.entries) e.key: e.value.text.trim(),
      'type': _type, 'inMaster': _inMaster, 'vendorSigned': _vendorSigned, 'ourSigned': _ourSigned, 'hasPapers': _hasPapers, 'rating': _rating,
      'aliases': _c['aliases']!.text.split('\n').map((s) => s.trim()).where((s) => s.isNotEmpty).toList(),
    };
    try {
      if (_isNew) { await Api.instance.post('/api/vendors-mgmt/vendors', body); }
      else { await Api.instance.put('/api/vendors-mgmt/vendors/${widget.vendor['_id']}', body); }
      if (mounted) Navigator.pop(context, true);
    } catch (e) {
      if (mounted) { setState(() => _busy = false); ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString()))); }
    }
  }

  @override
  Widget build(BuildContext context) => AppScaffold(
        title: Text(_isNew ? tr('مورّدٌ جديد', 'New vendor') : tr('ملف المورّد', 'Vendor file')),
        floatingActionButton: FloatingActionButton.extended(onPressed: _busy ? null : _save, icon: const Icon(Icons.check), label: Text(tr('حفظ', 'Save'))),
        body: ListView(padding: const EdgeInsets.fromLTRB(14, 14, 14, 100), children: [
          Wrap(spacing: 6, children: [
            ChoiceChip(label: Text(tr('شركة / مؤسسة', 'Company')), selected: _type == 'company', onSelected: (_) => setState(() => _type = 'company')),
            ChoiceChip(label: Text(tr('سائق فرد', 'Freelancer')), selected: _type == 'freelancer', onSelected: (_) => setState(() => _type = 'freelancer')),
          ]),
          SwitchListTile(contentPadding: EdgeInsets.zero, title: Text(tr('معتمد', 'On the master')), value: _inMaster, onChanged: (v) => setState(() => _inMaster = v)),
          for (final f in _textFields)
            Padding(padding: const EdgeInsets.only(bottom: 6), child: TextField(
              controller: _c[f.$1], maxLines: f.$1 == 'notes' ? 3 : 1,
              keyboardType: const {'fleetSize', 'paymentTermDays'}.contains(f.$1) ? TextInputType.number : null,
              decoration: InputDecoration(labelText: tr(f.$2, f.$3)))),
          LookupField(type: 'vendor_tax_class', controller: _c['taxClass']!, label: tr('التصنيف الضريبي', 'Tax class')),
          const SizedBox(height: 6),
          LookupField(type: 'vendor_contract_status', controller: _c['contractStatus']!, label: tr('حالة التعاقد', 'Contract status')),
          CheckboxListTile(contentPadding: EdgeInsets.zero, title: Text(tr('الأوراق مكتملة', 'Papers complete')), value: _hasPapers, onChanged: (v) => setState(() => _hasPapers = v == true)),
          CheckboxListTile(contentPadding: EdgeInsets.zero, title: Text(tr('وقّع طرفُ المورّد', 'Vendor side signed')), value: _vendorSigned, onChanged: (v) => setState(() => _vendorSigned = v == true)),
          CheckboxListTile(contentPadding: EdgeInsets.zero, title: Text(tr('وقّع طرفُنا', 'Our side signed')), value: _ourSigned, onChanged: (v) => setState(() => _ourSigned = v == true)),
          Text(tr('تقييم الفريق', 'Team rating'), style: const TextStyle(fontWeight: FontWeight.w700)),
          Row(children: [for (var i = 1; i <= 5; i++) IconButton(onPressed: () => setState(() => _rating = _rating == i ? null : i), icon: Icon((_rating ?? 0) >= i ? Icons.star : Icons.star_border, color: T.orange))]),
          TextField(controller: _c['ratingNote'], decoration: InputDecoration(labelText: tr('سبب التقييم', 'Rating note'))),
          const SizedBox(height: 6),
          TextField(controller: _c['aliases'], maxLines: 4, decoration: InputDecoration(labelText: tr('أسماؤه الأخرى على النظام (اسمٌ في كلّ سطر)', 'Other names in shipments (one per line)'))),
        ]),
      );
}

// ── التنبيهات ──────────────────────────────────────────────────────────────

class VendorsAlertsScreen extends StatefulWidget {
  const VendorsAlertsScreen({super.key});
  @override
  State<VendorsAlertsScreen> createState() => _VendorsAlertsScreenState();
}

const _alertStates = [('new', 'جديد', 'New', T.danger), ('in_progress', 'قيد المتابعة', 'In progress', T.warn), ('done', 'تمّ الإنجاز', 'Done', T.success)];

class _VendorsAlertsScreenState extends State<VendorsAlertsScreen> with _LiveLoad {
  Map<String, dynamic>? _d;
  String? _error;
  int _days = 30;
  bool _ind = false;
  bool _hideDone = true;
  int _seq = 0;

  @override
  void initState() { super.initState(); reload(); startLive(); }
  @override
  void dispose() { stopLive(); super.dispose(); }

  @override
  Future<void> reload() async {
    final mine = ++_seq;
    try {
      final d = await Api.instance.get('/api/vendors-mgmt/alerts?days=$_days&individuals=${_ind ? 1 : 0}&hideDone=${_hideDone ? 1 : 0}');
      if (mounted && mine == _seq) setState(() { _d = Map<String, dynamic>.from(d); _error = null; });
    } catch (e) {
      if (mounted && mine == _seq) setState(() => _error = e.toString());
    }
  }

  Future<void> _setState(String key, String s) async {
    try { await Api.instance.post('/api/vendors-mgmt/alerts/state', {'key': key, 'state': s}); reload(); }
    catch (e) { if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString()))); }
  }

  @override
  Widget build(BuildContext context) {
    final groups = _list(_d?['groups']);
    return AppScaffold(
      title: Text(tr('التنبيهات', 'Alerts')),
      body: _d == null
          ? (_error != null ? ErrorRetry(message: _error!, onRetry: reload) : const Center(child: CircularProgressIndicator()))
          : RefreshIndicator(onRefresh: reload, child: ListView(padding: const EdgeInsets.all(14), children: [
              Wrap(spacing: 6, runSpacing: 6, children: [
                for (final d in [7, 30, 60, 90]) ChoiceChip(label: Text(d == 7 ? tr('آخر 7 أيام', 'Last 7 days') : tr('آخر $d يومًا', 'Last $d days')), selected: _days == d, onSelected: (_) { setState(() => _days = d); reload(); }),
                FilterChip(label: Text(tr('تضمين السائقين الأفراد', 'Include freelancers')), selected: _ind, onSelected: (v) { setState(() => _ind = v); reload(); }),
                FilterChip(label: Text(tr('إخفاء ما أُنجز', 'Hide done')), selected: _hideDone, onSelected: (v) { setState(() => _hideDone = v); reload(); }),
              ]),
              for (final g in groups)
                SectionCard(
                  title: '${g['ar']}',
                  note: '${tr('الإجراء', 'Action')}: ${g['action']} · ${tr('مفتوح', 'Open')} ${g['open']} ${tr('من', 'of')} ${g['total']}',
                  child: Column(children: [
                    if (_list(g['items']).isEmpty) Padding(padding: const EdgeInsets.all(8), child: Text(tr('لا تنبيهات مفتوحة', 'No open alerts'), style: const TextStyle(color: T.inkFaint))),
                    for (final it in _list(g['items']).take(50))
                      ListTile(dense: true, contentPadding: EdgeInsets.zero,
                        title: Text('${it['name']}', style: const TextStyle(fontWeight: FontWeight.w700)),
                        subtitle: Text([if (it['trips'] != null) '${tr('رحلات', 'Trips')} ${it['trips']}', it['last'], it['owner'], it['detail']].where((e) => '${e ?? ''}'.isNotEmpty).join(' · '), maxLines: 3, overflow: TextOverflow.ellipsis),
                        onTap: () => openVendor(context, id: it['id'], name: it['name']),
                        trailing: PopupMenuButton<String>(
                          onSelected: (s) => _setState('${it['key']}', s),
                          itemBuilder: (_) => [for (final s in _alertStates) PopupMenuItem(value: s.$1, child: Text(tr(s.$2, s.$3)))],
                          child: Chip2(tr((_alertStates.firstWhere((s) => s.$1 == it['state'], orElse: () => _alertStates.first)).$2, (_alertStates.firstWhere((s) => s.$1 == it['state'], orElse: () => _alertStates.first)).$3),
                              _alertStates.firstWhere((s) => s.$1 == it['state'], orElse: () => _alertStates.first).$4),
                        )),
                  ]),
                ),
            ])),
    );
  }
}

// ── بحث بالمسار ────────────────────────────────────────────────────────────

class VendorsRouteSearchScreen extends StatefulWidget {
  const VendorsRouteSearchScreen({super.key});
  @override
  State<VendorsRouteSearchScreen> createState() => _VendorsRouteSearchScreenState();
}

class _VendorsRouteSearchScreenState extends State<VendorsRouteSearchScreen> {
  final _from = TextEditingController();
  final _to = TextEditingController();
  Map<String, dynamic>? _d;
  bool _busy = false;
  String? _error;

  @override
  void dispose() { _from.dispose(); _to.dispose(); super.dispose(); }

  Future<void> _go() async {
    if (_from.text.trim().isEmpty && _to.text.trim().isEmpty) return;
    FocusScope.of(context).unfocus();
    setState(() { _busy = true; _error = null; });
    try {
      final d = await Api.instance.get('/api/vendors-mgmt/route-search?from=${Uri.encodeQueryComponent(_from.text.trim())}&to=${Uri.encodeQueryComponent(_to.text.trim())}');
      if (mounted) setState(() { _d = Map<String, dynamic>.from(d); _busy = false; });
    } catch (e) {
      if (mounted) setState(() { _busy = false; _error = e.toString(); });
    }
  }

  @override
  Widget build(BuildContext context) {
    final d = _d;
    final price = d?['price'];
    return AppScaffold(
      title: Text(tr('بحث بالمسار', 'Route search')),
      body: ListView(padding: const EdgeInsets.all(14), children: [
        AppCard(child: Column(children: [
          TextField(controller: _from, decoration: InputDecoration(labelText: tr('مكان التحميل (من)', 'Loading place (from)'), hintText: tr('جازان · ميناء جدة · الجبيل', 'Jazan · Jeddah port'))),
          const SizedBox(height: 6),
          TextField(controller: _to, decoration: InputDecoration(labelText: tr('الوجهة (إلى)', 'Destination (to)')), onSubmitted: (_) => _go()),
          const SizedBox(height: 8),
          SizedBox(width: double.infinity, child: FilledButton.icon(onPressed: _busy ? null : _go, icon: const Icon(Icons.search), label: Text(tr('بحث', 'Search')))),
        ])),
        if (_busy) const Padding(padding: EdgeInsets.all(20), child: Center(child: CircularProgressIndicator())),
        if (_error != null) Padding(padding: const EdgeInsets.all(12), child: Text(_error!, style: const TextStyle(color: T.danger))),
        if (d != null) ...[
          const SizedBox(height: 8),
          TileWrap([
            KpiTile(tr('رحلات محقّقة', 'Trips'), fmtNum(d['trips'])),
            KpiTile(tr('موردون منفّذون', 'Executing vendors'), fmtNum(_list(d['vendors']).length)),
            if (price is Map) KpiTile(tr('أقل · أعلى', 'Min · max'), '${soMoney(price['min'])} · ${soMoney(price['max'])}'),
            if (price is Map) KpiTile(tr('متوسط السعر', 'Avg price'), soMoney(price['avg'])),
          ]),
          if (_list(d['approved']).isNotEmpty)
            SectionCard(title: tr('السعر المعتمد A / B / C', 'Approved price A / B / C'), child: Column(children: [
              for (final a in _list(d['approved'])) ListTile(dense: true, contentPadding: EdgeInsets.zero, title: Text('${a['fromCity']} ← ${a['toCity']}'), trailing: Text('${a['A'] ?? '—'} / ${a['B'] ?? '—'} / ${a['C'] ?? '—'}', style: const TextStyle(fontWeight: FontWeight.w800))),
            ]))
          else
            Padding(padding: const EdgeInsets.only(top: 8), child: Text(tr('المسار غير مدرجٍ في قائمة الأسعار المعتمدة', 'Route not in the approved list'), style: const TextStyle(color: T.inkFaint))),
          SectionCard(title: tr('الموردون المنفّذون على المسار', 'Vendors on this route'), note: tr('بالأحمر: سعرٌ أعلى من الفئة A', 'Red: above tier A'), child: Column(children: [
            for (final v in _list(d['vendors']).take(60))
              ListTile(dense: true, contentPadding: EdgeInsets.zero,
                title: Text('${v['name']}', style: TextStyle(fontWeight: FontWeight.w700, color: v['aboveA'] == true ? T.danger : T.ink)),
                subtitle: Text([tr(vmKinds['${v['kind']}']?.$1 ?? '', vmKinds['${v['kind']}']?.$2 ?? ''), v['owner'], v['contract'], '${tr('رحلات', 'Trips')} ${v['trips']}', '${tr('آخر', 'Last')} ${v['last'] ?? '—'}', if (has(v, 'lastPrice')) soMoney(v['lastPrice']), if (has(v, 'avg')) '${tr('متوسط', 'avg')} ${soMoney(v['avg'])}', v['phone']].where((e) => '${e ?? ''}'.isNotEmpty).join(' · ')),
                onTap: () => openVendor(context, id: v['id'], name: v['name'])),
          ])),
          if (_list(d['returnTrip']).isNotEmpty)
            SectionCard(title: tr('موردون يصلون إلى مكان التحميل (فرصة رحلة عودة)', 'Vendors arriving at the loading place (return trip)'), child: Column(children: [
              for (final v in _list(d['returnTrip'])) ListTile(dense: true, contentPadding: EdgeInsets.zero, title: Text('${v['name']}'), subtitle: Text('${tr('رحلات', 'Trips')} ${v['trips']} · ${tr('آخر', 'Last')} ${v['last']} · ${tr('من', 'From')} ${v['from']}'), onTap: () => openVendor(context, id: v['id'], name: v['name'])),
            ])),
          if (_list(d['masterNearby']).isNotEmpty)
            SectionCard(title: tr('الموردون المعتمدون الذين يشمل مقرُّهم أو وجهاتُهم المكان', 'Master vendors covering the place'), child: Column(children: [
              for (final v in _list(d['masterNearby']).take(40)) ListTile(dense: true, contentPadding: EdgeInsets.zero, title: Text('${v['name']}'), subtitle: Text([v['owner'], v['contract'], v['headOffice'], v['vehicleTypes'], v['phone']].where((e) => '${e ?? ''}'.isNotEmpty).join(' · ')), onTap: () => openVendor(context, id: v['id'])),
            ])),
        ],
      ]),
    );
  }
}

// ── السيارات ───────────────────────────────────────────────────────────────

class VendorsVehiclesScreen extends StatefulWidget {
  const VendorsVehiclesScreen({super.key});
  @override
  State<VendorsVehiclesScreen> createState() => _VendorsVehiclesScreenState();
}

class _VendorsVehiclesScreenState extends State<VendorsVehiclesScreen> {
  List<Map<String, dynamic>> _rows = [];
  int _total = 0;
  bool _loading = true;
  String? _error;
  String _q = '';
  Timer? _t;
  int _seq = 0;
  late final void Function() _onLive = _load;

  @override
  void initState() { super.initState(); _load(); Live.instance.on('shipmentOrders:fleet', _onLive); Live.instance.on(vmEvent, _onLive); }
  @override
  void dispose() { _t?.cancel(); Live.instance.off('shipmentOrders:fleet', _onLive); Live.instance.off(vmEvent, _onLive); super.dispose(); }

  Future<void> _load() async {
    final mine = ++_seq;
    try {
      final d = await Api.instance.get('/api/shipment-orders/vehicles?ownership=supplier&limit=200${_q.trim().isEmpty ? '' : '&q=${Uri.encodeQueryComponent(_q.trim())}'}');
      if (!mounted || mine != _seq) return;
      setState(() { _rows = _list(d['vehicles']); _total = inum(d['total']).toInt(); _loading = false; _error = null; });
    } catch (e) {
      if (mounted && mine == _seq) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  bool _expired(dynamic v) { final d = DateTime.tryParse('${v ?? ''}'); return d != null && d.isBefore(DateTime.now()); }

  @override
  Widget build(BuildContext context) => AppScaffold(
        title: Text(tr('سيارات الموردين', 'Vendor trucks')),
        body: Column(children: [
          Padding(padding: const EdgeInsets.fromLTRB(12, 8, 12, 4), child: SearchField(hint: tr('اللوحة، السائق، المورّد، بطاقة التشغيل…', 'Plate, driver, vendor, op card…'),
              onChanged: (v) { _t?.cancel(); _t = Timer(const Duration(milliseconds: 350), () { _q = v; _load(); }); })),
          Padding(padding: const EdgeInsets.symmetric(horizontal: 14), child: Align(alignment: AlignmentDirectional.centerStart, child: Text('${tr('في السجل', 'In the register')}: ${fmtNum(_total)}', style: const TextStyle(fontSize: 12, color: T.inkFaint)))),
          Expanded(child: _loading
              ? const Center(child: CircularProgressIndicator())
              : _error != null
                  ? ErrorRetry(message: _error!, onRetry: _load)
                  : RefreshIndicator(onRefresh: _load, child: ListView.builder(
                      padding: const EdgeInsets.fromLTRB(12, 4, 12, 20),
                      itemCount: _rows.length,
                      itemBuilder: (_, i) {
                        final v = _rows[i];
                        final sup = v['supplier'] is Map ? v['supplier'] as Map : null;
                        return Padding(padding: const EdgeInsets.only(bottom: 6), child: AppCard(padding: const EdgeInsets.all(12), child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                          Row(children: [
                            Expanded(child: Text('${v['plate']}', style: const TextStyle(fontWeight: FontWeight.w900))),
                            if ('${v['truckType'] ?? ''}'.isNotEmpty) Chip2('${v['truckType']}', T.navy),
                          ]),
                          if (sup != null) InkWell(onTap: () => openVendor(context, id: '${sup['_id']}'), child: Text('${sup['name']}', style: const TextStyle(color: T.orange, fontWeight: FontWeight.w700))),
                          Text([v['brand'], v['color'], v['modelYear'], v['defaultDriverName'], v['defaultDriverPhone']].where((e) => '${e ?? ''}'.isNotEmpty).join(' · '), style: const TextStyle(fontSize: 12, color: T.inkSoft)),
                          if ('${v['operationCardExpiry'] ?? ''}'.isNotEmpty)
                            Text('${tr('بطاقة التشغيل', 'Operating card')}: ${v['operationCardNumber'] ?? ''} · ${v['operationCardExpiry']}', style: TextStyle(fontSize: 12, color: _expired(v['operationCardExpiry']) ? T.danger : T.inkFaint, fontWeight: FontWeight.w700)),
                        ])));
                      },
                    ))),
        ]),
      );
}
