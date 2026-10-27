import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';
import '../ui/stat_grid.dart';

/// لوحةُ مدير التشغيل — نظيرُ components/ops/OpsAnalytics في الويب.
///
/// الحسابُ كلُّه في الخادم (utils/opsAnalytics) فالشاشةُ تعرض ولا تحسب: المالُ
/// والرحلاتُ والأهدافُ وأسبابُ الإلغاء والفروعُ والمناديبُ والعملاءُ والموردون
/// والمسارات، بفلتر المدّة (الكل/يوم/شهر/ربع/مدى) وخمسة فلاتر.
class OpsAnalyticsPanel extends StatefulWidget {
  final String base;
  final String liveEvent;
  const OpsAnalyticsPanel({super.key, required this.base, this.liveEvent = 'workflow:updated'});
  @override
  State<OpsAnalyticsPanel> createState() => _OpsAnalyticsPanelState();
}

const _orange = T.orange;
const _navy = T.navy;

String _nf(dynamic n) => (num.tryParse('${n ?? 0}') ?? 0).round().toString().replaceAllMapped(RegExp(r'\B(?=(\d{3})+(?!\d))'), (_) => ',');
String _short(dynamic n) {
  final v = (num.tryParse('${n ?? 0}') ?? 0).toDouble();
  final a = v.abs();
  if (a >= 1e6) return '${(v / 1e6).toStringAsFixed(1)}M';
  if (a >= 1e3) return '${(v / 1e3).toStringAsFixed(1)}K';
  return v.round().toString();
}
num _num(dynamic v) => num.tryParse('${v ?? 0}') ?? 0;

class _OpsAnalyticsPanelState extends State<OpsAnalyticsPanel> {
  Map<String, dynamic>? _d;
  Map<String, dynamic> _opts = {};
  final Map<String, String> _q = {'period': 'month'};
  bool _loading = true;
  bool _busy = false;
  bool _showFilters = false;
  int _seq = 0;
  late final void Function() _onLive = _load;

  @override
  void initState() {
    super.initState();
    _load();
    Api.instance.get('${widget.base}/filters').then((d) {
      if (mounted && d is Map) setState(() => _opts = Map<String, dynamic>.from(d));
    }).catchError((_) {});
    Live.instance.on(widget.liveEvent, _onLive);
  }

  @override
  void dispose() {
    Live.instance.off(widget.liveEvent, _onLive);
    super.dispose();
  }

  Future<void> _load() async {
    final mine = ++_seq;
    setState(() => _busy = true);
    try {
      final qs = _q.entries.where((e) => e.value.isNotEmpty).map((e) => '${e.key}=${Uri.encodeQueryComponent(e.value)}').join('&');
      final d = await Api.instance.get('${widget.base}?$qs');
      if (!mounted || mine != _seq) return;
      setState(() { _d = Map<String, dynamic>.from(d); _loading = false; _busy = false; });
    } catch (e) {
      if (!mounted || mine != _seq) return;
      setState(() { _loading = false; _busy = false; });
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e is ApiException ? e.message : tr('تعذّر التحميل', 'Could not load'))));
    }
  }

  void _set(String k, String v) { setState(() => _q[k] = v); _load(); }

  Future<void> _pickDate(String k) async {
    final d = await showDatePicker(context: context, initialDate: DateTime.tryParse(_q[k] ?? '') ?? DateTime.now(), firstDate: DateTime(2020), lastDate: DateTime(2100));
    if (d == null) return;
    _set(k, '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}');
  }

  // حدٌّ موحَّد اللون مع زوايا مستديرة، والشريطُ الملوَّن أعلاه طبقةٌ داخليّة —
  // فـFlutter لا يرسم زوايا مستديرة على حدودٍ مختلفة الألوان.
  Widget _kpi(IconData icon, String label, String value, String sub, Color tone) => Container(
        clipBehavior: Clip.antiAlias,
        decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(12), border: Border.all(color: T.line)),
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Container(height: 3, color: tone),
          Padding(
            padding: const EdgeInsets.fromLTRB(10, 8, 10, 10),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Row(children: [Icon(icon, size: 13, color: tone), const SizedBox(width: 4), Expanded(child: Text(label, style: const TextStyle(fontSize: 11, color: T.inkFaint), overflow: TextOverflow.ellipsis))]),
              const SizedBox(height: 3),
              FittedBox(fit: BoxFit.scaleDown, alignment: AlignmentDirectional.centerStart,
                  child: Text(value, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w900))),
              if (sub.isNotEmpty) Text(sub, style: const TextStyle(fontSize: 10.5, color: T.inkFaint)),
            ]),
          ),
        ]),
      );

  Widget _bar(num pct, Color tone) => ClipRRect(
        borderRadius: BorderRadius.circular(4),
        child: LinearProgressIndicator(value: (pct.clamp(1, 100)) / 100, minHeight: 5, backgroundColor: T.line.withValues(alpha: 0.4), color: tone),
      );

  Widget _panel(String title, {String? hint, Widget? right, required Widget child}) => Padding(
        padding: const EdgeInsets.only(bottom: 10),
        child: AppCard(child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Row(children: [
            Flexible(child: Text(title, style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w800))),
            if (hint != null && hint.isNotEmpty) ...[const SizedBox(width: 6), Flexible(child: Text(hint, style: const TextStyle(fontSize: 10.5, color: T.inkFaint), overflow: TextOverflow.ellipsis))],
            if (right != null) ...[const Spacer(), right],
          ]),
          const SizedBox(height: 8),
          child,
        ])),
      );

  Widget _rank(int i, String name, String value, num share, Color tone, {String? extra}) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 3),
        child: Row(children: [
          SizedBox(width: 26, child: Text('#${i + 1}', style: const TextStyle(fontSize: 10.5, color: T.inkFaint))),
          Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(name, style: const TextStyle(fontSize: 12.5), overflow: TextOverflow.ellipsis),
            const SizedBox(height: 2),
            _bar(share, tone),
          ])),
          const SizedBox(width: 8),
          Text(value, style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w800)),
          SizedBox(width: 44, child: Text('$share%', textAlign: TextAlign.end, style: const TextStyle(fontSize: 11, color: T.inkFaint))),
          if (extra != null) SizedBox(width: 56, child: Text(extra, textAlign: TextAlign.end, style: const TextStyle(fontSize: 11, color: T.inkFaint))),
        ]),
      );

  /// أعمدةٌ بسيطة لاتّجاه الأشهر — الشهرُ الجاري رماديٌّ لأنّه غيرُ مكتمل.
  Widget _monthBars(List monthly, String key, Color tone, {String Function(num)? fmt}) {
    if (monthly.isEmpty) return Text(tr('لا بيانات', 'No data'), style: const TextStyle(fontSize: 12, color: T.inkFaint));
    final vals = monthly.map((m) => _num(m[key])).toList();
    final max = vals.fold<num>(1, (a, b) => b.abs() > a ? b.abs() : a);
    return SizedBox(
      height: 130,
      child: Row(crossAxisAlignment: CrossAxisAlignment.end, children: [
        for (var i = 0; i < monthly.length; i++)
          Expanded(child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 1.5),
            child: Column(mainAxisAlignment: MainAxisAlignment.end, children: [
              Text(fmt == null ? _short(vals[i]) : fmt(vals[i]), style: const TextStyle(fontSize: 8.5, color: T.inkFaint), maxLines: 1),
              Container(height: 4 + 80 * (vals[i].abs() / max), decoration: BoxDecoration(color: monthly[i]['partial'] == true ? T.line : tone, borderRadius: const BorderRadius.vertical(top: Radius.circular(3)))),
              Text('${monthly[i]['month'] ?? ''}'.length >= 7 ? '${monthly[i]['month']}'.substring(5) : '${monthly[i]['month'] ?? ''}', style: const TextStyle(fontSize: 9, color: T.inkFaint)),
            ]),
          )),
      ]),
    );
  }

  Widget _peaks(List<(String, String, Map?, String Function(Map))> items, IconData icon) => Padding(
        padding: const EdgeInsets.only(top: 8),
        child: Row(children: [
          for (final x in items)
            Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Row(children: [Icon(icon, size: 12, color: T.inkFaint), const SizedBox(width: 3), Text(tr(x.$1, x.$2), style: const TextStyle(fontSize: 10.5, color: T.inkFaint))]),
              Text('${x.$3?['name'] ?? '—'}', style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w800)),
              Text(x.$3 == null ? '' : x.$4(x.$3!), style: const TextStyle(fontSize: 11, color: T.inkFaint)),
            ])),
        ]),
      );

  @override
  Widget build(BuildContext context) {
    if (_loading) return const Padding(padding: EdgeInsets.all(20), child: Center(child: CircularProgressIndicator()));
    final d = _d;
    if (d == null) return Padding(padding: const EdgeInsets.all(20), child: Text(tr('تعذّر التحميل', 'Could not load')));
    final t = Map<String, dynamic>.from(d['totals'] ?? {});
    final g = Map<String, dynamic>.from(d['targets'] ?? {});
    final period = Map<String, dynamic>.from(d['period'] ?? {});
    final p = _q['period'] ?? 'month';
    final active = _q.entries.where((e) => e.key != 'period' && e.key != 'month' && e.key != 'day' && e.key != 'from' && e.key != 'to' && e.value.isNotEmpty).length;
    final monthly = List.from(d['monthly'] ?? const []);
    final branches = Map<String, dynamic>.from(d['branches'] ?? {});
    final opsReps = Map<String, dynamic>.from(d['opsReps'] ?? {});
    final clients = Map<String, dynamic>.from(d['clients'] ?? {});
    final vendors = Map<String, dynamic>.from(d['vendors'] ?? {});
    final shares = Map<String, dynamic>.from(d['shares'] ?? {});
    final reasons = List.from(d['reasons'] ?? const []);
    final mainReason = d['mainReason'] as Map?;
    final source = d['source'] as Map?;

    return AnimatedOpacity(
      opacity: _busy ? 0.6 : 1,
      duration: const Duration(milliseconds: 200),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        // ── الفلتر: المدّةُ أوّلًا ──
        AppCard(child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Wrap(spacing: 5, runSpacing: 5, crossAxisAlignment: WrapCrossAlignment.center, children: [
            Text(tr('الفترة', 'Period'), style: const TextStyle(fontSize: 11.5, color: T.inkFaint)),
            for (final x in const [('all', 'الكل', 'All'), ('day', 'يوم', 'Day'), ('month', 'شهر', 'Month'), ('quarter', 'ربع', 'Quarter'), ('range', 'مدى', 'Range')])
              ChoiceChip(
                visualDensity: VisualDensity.compact,
                selected: p == x.$1,
                showCheckmark: false,
                selectedColor: _orange,
                labelStyle: TextStyle(fontSize: 12, color: p == x.$1 ? Colors.white : T.inkSoft),
                label: Text(tr(x.$2, x.$3)),
                onSelected: (_) => _set('period', x.$1),
              ),
            if (p == 'month')
              DropdownButton<String>(
                value: (_q['month'] ?? '').isEmpty || !List.from(_opts['months'] ?? const []).contains(_q['month']) ? '' : _q['month'],
                underline: const SizedBox.shrink(),
                style: const TextStyle(fontSize: 12, color: T.ink),
                items: [
                  DropdownMenuItem(value: '', child: Text(tr('الشهر الحالي', 'This month'))),
                  for (final m in List.from(_opts['months'] ?? const [])) DropdownMenuItem(value: '$m', child: Text('$m')),
                ],
                onChanged: (v) => _set('month', v ?? ''),
              ),
            if (p == 'day') ActionChip(label: Text((_q['day'] ?? '').isEmpty ? tr('اليوم', 'Day') : _q['day']!), onPressed: () => _pickDate('day')),
            if (p == 'range') ...[
              ActionChip(label: Text((_q['from'] ?? '').isEmpty ? tr('من', 'From') : _q['from']!), onPressed: () => _pickDate('from')),
              ActionChip(label: Text((_q['to'] ?? '').isEmpty ? tr('إلى', 'To') : _q['to']!), onPressed: () => _pickDate('to')),
            ],
            ActionChip(
              avatar: const Icon(Icons.tune, size: 15),
              label: Text('${tr('فلاتر', 'Filters')}${active > 0 ? ' ($active)' : ''}'),
              onPressed: () => setState(() => _showFilters = !_showFilters),
            ),
            IconButton(visualDensity: VisualDensity.compact, tooltip: tr('تحديث', 'Refresh'), icon: const Icon(Icons.refresh, size: 18), onPressed: _load),
          ]),
          if (_showFilters) ...[
            const Divider(),
            for (final f in const [('branch', 'الفرع', 'Branch'), ('rentType', 'نوع الإيجار', 'Rent type'), ('payType', 'دفع العميل', 'Customer payment'), ('vendorType', 'نوع المورد', 'Vendor type'), ('opsRep', 'مندوب التشغيل', 'Ops rep')])
              Row(children: [
                SizedBox(width: 110, child: Text(tr(f.$2, f.$3), style: const TextStyle(fontSize: 11.5, color: T.inkFaint))),
                Expanded(child: DropdownButton<String>(
                  isExpanded: true,
                  value: List.from(_opts[f.$1] ?? const []).contains(_q[f.$1]) ? _q[f.$1] : '',
                  style: const TextStyle(fontSize: 12.5, color: T.ink),
                  items: [
                    DropdownMenuItem(value: '', child: Text(tr('الكل', 'All'))),
                    for (final v in List.from(_opts[f.$1] ?? const [])) DropdownMenuItem(value: '$v', child: Text('$v', overflow: TextOverflow.ellipsis)),
                  ],
                  onChanged: (v) => _set(f.$1, v ?? ''),
                )),
              ]),
            if (active > 0)
              Align(alignment: AlignmentDirectional.centerEnd, child: TextButton.icon(
                icon: const Icon(Icons.close, size: 15),
                label: Text(tr('مسح الفلاتر', 'Clear')),
                onPressed: () { setState(() => _q.removeWhere((k, _) => !{'period', 'month'}.contains(k))); _load(); },
              )),
          ],
          const SizedBox(height: 4),
          Text(
            '${period['from'] ?? '—'} → ${period['to'] ?? '—'} · ${tr('${t['days'] ?? 0} يومًا · ${_nf(t['rows'])} سطرًا من تقرير الفروع', '${t['days'] ?? 0} days · ${_nf(t['rows'])} report rows')}'
            '${'${source?['importedAt'] ?? ''}'.length >= 10 ? tr(' · آخر تحديثٍ للتقرير ${'${source?['importedAt']}'.substring(0, 10)}', ' · report imported ${'${source?['importedAt']}'.substring(0, 10)}') : ''}',
            style: const TextStyle(fontSize: 10.5, color: T.inkFaint),
          ),
        ])),
        const SizedBox(height: 10),
        // ① المال والرحلات
        StatGrid(
          spacing: 8,
          children: [
            _kpi(Icons.account_balance_wallet_outlined, tr('إجمالي المبيعات', 'Total sales'), _short(t['sell']), tr('إجمالي الإيراد', 'Total revenue'), _navy),
            _kpi(Icons.shopping_cart_outlined, tr('إجمالي تكلفة الشراء', 'Total buying cost'), _short(t['buy']),
                '${_num(t['sell']) != 0 ? ((_num(t['buy']) / _num(t['sell'])) * 1000).round() / 10 : 0}% ${tr('من المبيعات', 'of sales')}', T.inkFaint),
            _kpi(Icons.percent, tr('هامش الربح', 'Gross margin'), _short(t['gp']), '${t['marginPct'] ?? 0}% ${tr('من المبيعات', 'of sales')}', T.success),
            _kpi(Icons.local_shipping_outlined, tr('إجمالي الرحلات', 'Total trips'), _nf(t['trips']), tr('محقق + غير محقق', 'achieved + failed'), _orange),
            _kpi(Icons.check_circle_outline, tr('الرحلات المحققة', 'Achieved trips'), _nf(t['achieved']), '${t['achievedPct'] ?? 0}% ${tr('من الإجمالي', 'of total')}', T.success),
            _kpi(Icons.cancel_outlined, tr('الرحلات غير المحققة', 'Failed trips'), _nf(t['failed']), '${t['failedPct'] ?? 0}% ${tr('من الإجمالي', 'of total')}', T.danger),
            _kpi(Icons.calendar_month_outlined, tr('متوسط الإيراد / يوم', 'Avg revenue / day'), _short(t['avgRevenuePerDay']), tr('على ${t['days'] ?? 0} يوم', 'over ${t['days'] ?? 0} days'), T.cyan),
            _kpi(Icons.trending_up, tr('متوسط الرحلات / يوم', 'Avg trips / day'), '${t['avgTripsPerDay'] ?? 0}', tr('رحلة محققة', 'achieved trips'), T.violet),
          ],
        ),
        const SizedBox(height: 10),
        // ② الأهداف
        for (final x in [
          (tr('هدف الرحلات', 'Trips target'), t['achieved'], g['periodTrips'], g['tripsAchievementPct'], g['tripsGap'], g['ytdTrips'], g['annualTripsPct'], g['remainingTrips'], _nf),
          (tr('هدف المبيعات', 'Revenue target'), t['sell'], g['periodRevenue'], g['revenueAchievementPct'], g['revenueGap'], g['ytdRevenue'], g['annualRevenuePct'], g['remainingRevenue'], _short),
        ])
          _panel(x.$1,
              right: Text(_num(x.$4) >= 100 ? tr('بلغ الهدف', 'on target') : tr('أقل من الهدف', 'below target'),
                  style: TextStyle(fontSize: 11, fontWeight: FontWeight.w800, color: _num(x.$4) >= 100 ? T.success : T.warn)),
              child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                Row(children: [
                  Text('${x.$4 ?? 0}%', style: const TextStyle(fontSize: 24, fontWeight: FontWeight.w900)),
                  const Spacer(),
                  Text('${x.$9(x.$2)} ${tr('من', 'of')} ${x.$9(x.$3)}', style: const TextStyle(fontSize: 12, color: T.inkFaint)),
                ]),
                const SizedBox(height: 4),
                _bar(_num(x.$4), _num(x.$4) >= 100 ? T.success : _orange),
                const SizedBox(height: 6),
                Row(children: [
                  Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text(tr('الفجوة عن الهدف', 'Gap'), style: const TextStyle(fontSize: 10.5, color: T.inkFaint)),
                    Text('${_num(x.$5) >= 0 ? '+' : ''}${x.$9(x.$5)}', style: TextStyle(fontSize: 13, fontWeight: FontWeight.w800, color: _num(x.$5) >= 0 ? T.success : T.danger)),
                  ])),
                  Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text(tr('المحقق من أول السنة', 'YTD'), style: const TextStyle(fontSize: 10.5, color: T.inkFaint)),
                    Text('${x.$9(x.$6)} · ${x.$7 ?? 0}%', style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w800)),
                  ])),
                  Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text(tr('المتبقي على هدف السنة', 'Remaining'), style: const TextStyle(fontSize: 10.5, color: T.inkFaint)),
                    Text(x.$9(x.$8), style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w800)),
                  ])),
                ]),
              ])),
        // ③ أسبابُ عدم التحقيق
        _panel(tr('مساهمة أسباب الإلغاء', 'Cancellation share'), hint: tr('${_nf(t['failed'])} غير محقق', '${_nf(t['failed'])} failed'),
            child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              for (var i = 0; i < reasons.length && i < 7; i++) _rank(i, '${reasons[i]['name']}', _nf(reasons[i]['failed']), _num(reasons[i]['share']), T.danger),
              if (reasons.isEmpty) Text(tr('لا إلغاءات في الفترة', 'No cancellations'), style: const TextStyle(fontSize: 12, color: T.inkFaint)),
              if (mainReason != null)
                Padding(padding: const EdgeInsets.only(top: 6), child: Row(children: [
                  const Icon(Icons.warning_amber_rounded, size: 14, color: T.danger),
                  const SizedBox(width: 4),
                  Expanded(child: Text(tr('السبب الرئيسي: ${mainReason['name']} ${mainReason['share']}%', 'Main reason: ${mainReason['name']} ${mainReason['share']}%'), style: const TextStyle(fontSize: 11, color: T.danger))),
                ])),
            ])),
        // ④ الاتّجاه
        _panel(tr('اتجاه المبيعات', 'Sales trend'), hint: tr('الشهر الجاري غير مكتمل', 'current month incomplete'), child: _monthBars(monthly, 'sell', _navy)),
        _panel(tr('اتجاه الرحلات', 'Trips trend'), hint: tr('المحقق شهريًّا', 'achieved per month'), child: _monthBars(monthly, 'achieved', _orange, fmt: (v) => _nf(v))),
        // ⑤ الفروع
        _panel(tr('أداء الفروع', 'Branch performance'), hint: tr('${List.from(branches['list'] ?? const []).length} فروع', '${List.from(branches['list'] ?? const []).length} branches'),
            child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              Table(columnWidths: const {0: FlexColumnWidth(2)}, children: [
                TableRow(children: [
                  for (final h in [tr('الفرع', 'Branch'), tr('محقق', 'Achieved'), '%', tr('مبيعات', 'Sales'), tr('هامش', 'Margin')])
                    Text(h, style: const TextStyle(fontSize: 10.5, color: T.inkFaint)),
                ]),
                for (final b in List.from(branches['list'] ?? const []))
                  TableRow(children: [
                    Padding(padding: const EdgeInsets.symmetric(vertical: 3), child: Text('${b['name']}', style: const TextStyle(fontSize: 12))),
                    Text(_nf(b['achieved']), style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700)),
                    Text('${b['tripShare'] ?? 0}%', style: const TextStyle(fontSize: 12, color: T.inkFaint)),
                    Text(_short(b['sell']), style: const TextStyle(fontSize: 12)),
                    Text('${b['margin'] ?? 0}%', style: TextStyle(fontSize: 12, color: _num(b['margin']) >= 12 ? T.success : T.warn)),
                  ]),
              ]),
              _peaks([
                ('أعلى فرع مبيعات', 'Top revenue', (branches['byRevenue'] as Map?)?['highest'] as Map?, (n) => '${_short(n['sell'])} · ${n['sellShare'] ?? 0}%'),
                ('أقل فرع مبيعات', 'Lowest revenue', (branches['byRevenue'] as Map?)?['lowest'] as Map?, (n) => '${_short(n['sell'])} · ${n['sellShare'] ?? 0}%'),
              ], Icons.apartment),
            ])),
        // ⑥ المناديب
        _panel(tr('أداء مناديب التشغيل', 'Ops representatives'),
            hint: '${opsReps['fleetExcluded'] ?? ''}'.isNotEmpty ? tr('بطاقتا الأعلى والأدنى تستثنيان «${opsReps['fleetExcluded']}» (أسطول الشركة)', 'top/lowest exclude the company fleet') : null,
            child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              for (final (i, r) in List.from(opsReps['list'] ?? const []).take(12).indexed) _rank(i, '${r['name']}', _nf(r['achieved']), _num(r['tripShare']), _orange),
              _peaks([
                ('أعلى مندوب', 'Top rep', (opsReps['byTrips'] as Map?)?['highest'] as Map?, (n) => '${_nf(n['achieved'])} · ${n['tripShare'] ?? 0}%'),
                ('أقل مندوب', 'Lowest rep', (opsReps['byTrips'] as Map?)?['lowest'] as Map?, (n) => '${_nf(n['achieved'])} · ${n['tripShare'] ?? 0}%'),
              ], Icons.how_to_reg_outlined),
            ])),
        // ⑦ العملاء والموردون
        _panel(tr('أعلى 10 عملاء', 'Top 10 clients'), hint: tr('${clients['count'] ?? 0} عميلًا نشطًا · النسبة من رحلات العملاء', '${clients['count'] ?? 0} active · share of client trips'),
            child: Column(children: [
              for (final (i, c) in List.from(clients['top'] ?? const []).indexed) _rank(i, '${c['name']}', _nf(c['achieved']), _num(c['tripShare']), _navy, extra: _short(c['sell'])),
            ])),
        _panel(tr('أعلى 10 موردين', 'Top 10 vendors'), hint: tr('${vendors['count'] ?? 0} موردًا · النسبة من رحلات الموردين', '${vendors['count'] ?? 0} vendors · share of vendor trips'),
            child: Column(children: [
              for (final (i, v) in List.from(vendors['top'] ?? const []).indexed) _rank(i, '${v['name']}', _nf(v['achieved']), _num(v['tripShare']), T.violet, extra: _short(v['buy'])),
            ])),
        // ⑧ التوزيعات وأهمُّ المسارات
        for (final s in const [('rentType', 'نوع الإيجار', 'Rent type'), ('payType', 'دفع العميل', 'Customer payment'), ('vendorType', 'نوع المورد', 'Vendor type')])
          _panel(tr(s.$2, s.$3), hint: tr('من المحقق', 'of achieved'), child: Column(children: [
            for (final (i, x) in List.from(shares[s.$1] ?? const []).indexed) _rank(i, '${x['name']}', _nf(x['trips']), _num(x['share']), T.cyan),
          ])),
        _panel(tr('أكثر المسارات', 'Top routes'), hint: tr('محقق', 'achieved'), child: Column(children: [
          for (final (i, r) in List.from(d['routes'] ?? const []).take(8).indexed) _rank(i, '${r['name']}', _nf(r['achieved']), _num(r['tripShare']), T.success),
        ])),
      ]),
    );
  }
}
