import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/export_sheet.dart';
import '../ui/theme.dart';
import '../ui/stat_grid.dart';
import '../ui/widgets.dart';
import 'it_common.dart';
import 'it_custody.dart';
import 'it_recurring.dart';
import 'it_tickets.dart';

/// IT dashboard, counterpart of /system/it: a date range (default 90 days) sent to /api/it/dashboard, an Excel export with a sheet per block, and every number opens its rows.
class ItDashboardScreen extends StatefulWidget {
  const ItDashboardScreen({super.key});
  @override
  State<ItDashboardScreen> createState() => _ItDashboardScreenState();
}

class _ItDashboardScreenState extends State<ItDashboardScreen> {
  Map<String, dynamic>? _data;
  bool _loading = true;
  String? _error;
  String _from = daysAgoYmd(89);
  String _to = todayYmd();
  int _seq = 0;
  late final void Function() _onLive;

  @override
  void initState() {
    super.initState();
    _onLive = () => _load();
    Live.instance.on('it:updated', _onLive);
    _load();
  }

  @override
  void dispose() {
    Live.instance.off('it:updated', _onLive);
    super.dispose();
  }

  Future<void> _load() async {
    final my = ++_seq;
    try {
      final d = await Api.instance.get('/api/it/dashboard?from=$_from&to=$_to');
      if (!mounted || my != _seq) return;
      setState(() { _data = Map<String, dynamic>.from(d); _loading = false; _error = null; });
    } catch (e) {
      if (mounted && my == _seq) setState(() { _loading = false; _error = e is ApiException ? e.message : e.toString(); });
    }
  }

  Map<String, dynamic> get _t => Map<String, dynamic>.from((_data?['totals'] as Map?) ?? {});
  Map<String, dynamic> get _custody => Map<String, dynamic>.from((_data?['custody'] as Map?) ?? {});
  List<Map<String, dynamic>> _list(dynamic v) => List<Map<String, dynamic>>.from((v as List?) ?? []);
  num _num(dynamic v) => v is num ? v : 0;

  int get _systemsDown => _list(_t['systemsByStatus'])
      .where((s) => s['key'] == 'down' || s['key'] == 'degraded')
      .fold<int>(0, (s, r) => s + _num(r['count']).toInt());

  // One workbook with a sheet per dashboard block, the same sheets as the web.
  Future<void> _export() async {
    final t = _t, c = _custody;
    final byStatus = Map<String, dynamic>.from((c['byStatus'] as Map?) ?? {});
    ExportCol col(String ar, String en, String key) => ExportCol(ar, en, (r) => r[key]);
    final nameCount = [col('البند', 'Name', 'name'), col('العدد', 'Count', 'count')];
    await exportExcel(context, fileName: 'it-dashboard-$_to', sheets: [
      ('Summary', [col('المؤشر', 'Metric', 'metric'), col('القيمة', 'Value', 'value')], [
        {'metric': 'Period', 'value': '$_from → $_to'},
        {'metric': 'Open tickets', 'value': _num(t['openTickets'])},
        {'metric': 'In progress', 'value': _num(t['inProgress'])},
        {'metric': 'Resolved in period', 'value': _num(t['resolvedThisPeriod'])},
        {'metric': 'Avg resolution (days)', 'value': (_num(t['avgResolutionMinutes']) / 1440).round()},
        {'metric': 'Systems down or degraded', 'value': _systemsDown},
        {'metric': 'Custody items assigned', 'value': _num(t['assetsAssigned'])},
        {'metric': 'Units in store', 'value': _num(t['stockCount'] ?? t['assetsInStock'])},
      ]),
      ('By category', nameCount, _list(t['ticketsByCategory']).map((r) => {'name': categoryLabel(r['key'], en: true), 'count': r['count']}).toList()),
      ('By priority', nameCount, _list(t['ticketsByPriority']).map((r) => {'name': priorityLabel(r['key'], en: true), 'count': r['count']}).toList()),
      ('By status', nameCount, _list(t['ticketsByStatus']).map((r) => {'name': ticketStatusLabel(r['key'], en: true), 'count': r['count']}).toList()),
      ('Opened vs resolved', [col('التاريخ', 'Date', 'date'), col('مفتوحة', 'Opened', 'opened'), col('تم حلها', 'Resolved', 'resolved')], _list(t['timeline'])),
      ('Custody by category', nameCount, _list(c['buckets']).map((b) => {'name': b['nameEn'] ?? b['key'], 'count': b['count']}).toList()),
      ('Custody by state', nameCount, [
        {'name': 'With employee', 'count': _num(byStatus['assigned'])},
        {'name': 'In store', 'count': _num(byStatus['in_stock'])},
        {'name': 'Faulty', 'count': _num(byStatus['returned'])},
      ]),
      ('Store by type', nameCount, _list(t['stockByType']).map((r) => {'name': r['key'], 'count': r['count']}).toList()),
      ('Low stock', nameCount, _list(t['lowStock']).map((r) => {'name': r['key'], 'count': r['count']}).toList()),
      ('Renewals due', [col('النظام', 'System', 'name'), col('تاريخ التجديد', 'Renewal date', 'renewalDate'), col('التكلفة', 'Cost', 'cost'), col('الفترة', 'Period', 'costPeriod')],
          _list(t['renewalsDueSoon'])),
    ]);
  }

  void _go(Widget w) async {
    await Navigator.push(context, MaterialPageRoute(builder: (_) => w));
    _load();
  }

  @override
  Widget build(BuildContext context) {
    return AppScaffold(
      title: Text(tr('البرمجيات وتقنية المعلومات', 'Software & IT')),
      actions: [IconButton(tooltip: tr('تصدير Excel', 'Export Excel'), icon: const Icon(Icons.file_download_outlined), onPressed: _data == null ? null : _export)],
      body: _loading
          ? ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(), SizedBox(height: 10), Shimmer(), SizedBox(height: 10), Shimmer()])
          : _error != null
              ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
              : RefreshIndicator(onRefresh: _load, child: _body()),
    );
  }

  Widget _body() {
    final t = _t, c = _custody;
    final byStatus = Map<String, dynamic>.from((c['byStatus'] as Map?) ?? {});
    final bucketCounts = {for (final b in _list(c['buckets'])) '${b['key']}': _num(b['count']).toInt()};
    return ListView(padding: const EdgeInsets.fromLTRB(14, 12, 14, 40), children: [
      ItDateRange(
        from: _from, to: _to,
        onFrom: (v) { setState(() => _from = v.isEmpty ? daysAgoYmd(89) : v); _load(); },
        onTo: (v) { setState(() => _to = v.isEmpty ? todayYmd() : v); _load(); },
      ),
      const SizedBox(height: 12),
      // Every card leads to its rows.
      StatGrid(
        spacing: 8, minTileWidth: 96, minColumns: 3, maxColumns: 6,
        children: [
          _stat(tr('بلاغات مفتوحة', 'Open tickets'), '${_num(t['openTickets'])}', T.warn, () => _go(const ItTicketsScreen(initialStatus: 'open'))),
          _stat(tr('قيد التنفيذ', 'In progress'), '${_num(t['inProgress'])}', T.info, () => _go(const ItTicketsScreen(initialStatus: 'in_progress'))),
          _stat(tr('تم حلها في الفترة', 'Resolved this period'), '${_num(t['resolvedThisPeriod'])}', T.success, () => _go(const ItTicketsScreen(initialStatus: 'resolved'))),
          _stat(tr('متوسط زمن الحل', 'Avg resolution'), fmtDuration(t['avgResolutionMinutes']), T.orange, () => _go(const ItTicketsScreen())),
          _stat(tr('عهد مسلّمة', 'Assets assigned'), '${_num(t['assetsAssigned'])}', T.violet, () => _go(const ItCustodyScreen())),
          _stat(tr('أنظمة متعثرة', 'Systems down'), '$_systemsDown', _systemsDown > 0 ? T.danger : T.ink, null),
        ],
      ),
      const SizedBox(height: 16),
      Row(children: [
        const Icon(Icons.laptop_mac_rounded, size: 18, color: T.orange),
        const SizedBox(width: 6),
        Text(tr('العهد', 'Custody'), style: const TextStyle(fontWeight: FontWeight.w800)),
        const SizedBox(width: 6),
        Expanded(child: Text(tr('${_num(c['total'])} صنف في السجل', '${_num(c['total'])} items on the register'), maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 11.5, color: T.inkFaint))),
        TextButton(onPressed: () => _go(const ItCustodyScreen()), child: Text(tr('السجل الكامل', 'Full register'), style: const TextStyle(fontSize: 12))),
      ]),
      // Bar height follows its content: grows with font size without overflowing.
      SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        child: IntrinsicHeight(child: Row(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          for (final (i, b) in custodyBuckets.indexed) ...[
            if (i > 0) const SizedBox(width: 8),
            Pressable(
              onTap: () => _go(ItCustodyScreen(initialBucket: b.key)),
              child: Container(
                width: 112, padding: const EdgeInsets.all(10),
                decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(14), border: Border.all(color: T.line)),
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
                  Row(children: [Icon(b.icon, size: 15, color: T.inkFaint), const SizedBox(width: 5), Expanded(child: Text(b.label, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: T.inkSoft)))]),
                  const SizedBox(height: 6),
                  Text('${bucketCounts[b.key] ?? 0}', style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w800)),
                ]),
              ),
            ),
          ],
        ])),
      ),
      const SizedBox(height: 8),
      Row(children: [
        for (final (k, ar, en, color) in [
          ('assigned', 'بعهدة الموظف', 'With employee', T.warn),
          ('in_stock', 'المستودع', 'In store', T.info),
          ('returned', 'تالف', 'Faulty', T.danger),
        ])
          Expanded(child: Padding(
            padding: const EdgeInsetsDirectional.only(end: 6),
            child: Pressable(
              onTap: () => _go(ItCustodyScreen(initialStatus: k)),
              child: Container(
                padding: const EdgeInsets.symmetric(vertical: 9),
                decoration: BoxDecoration(color: color.withValues(alpha: 0.10), borderRadius: BorderRadius.circular(12)),
                child: Column(children: [
                  Text('${_num(byStatus[k])}', style: TextStyle(fontSize: 17, fontWeight: FontWeight.w800, color: color)),
                  Text(tr(ar, en), style: TextStyle(fontSize: 10.5, fontWeight: FontWeight.w700, color: color)),
                ]),
              ),
            ),
          )),
      ]),
      const SizedBox(height: 10),
      _card(tr('حسب الحالة الفنية', 'By condition'), _list(c['byCondition']).isEmpty
          ? _empty(tr('لا توجد بيانات.', 'Nothing to show.'))
          : Wrap(spacing: 6, runSpacing: 6, children: _list(c['byCondition']).map((x) => ActionChip(
              label: Text('${conditionLabel(x['key'])}  ${x['count']}', style: const TextStyle(fontSize: 12)),
              onPressed: () => _go(ItCustodyScreen(initialCondition: '${x['key']}')),
            )).toList())),
      _card(tr('تفصيل «أخرى»', 'Inside "Other"'), _list(c['otherKinds']).isEmpty
          ? _empty(tr('لا توجد أصناف أخرى.', 'Nothing here.'))
          : Wrap(spacing: 6, runSpacing: 6, children: _list(c['otherKinds']).map((x) => ActionChip(
              label: Text('${custodyTypeLabel(x['key'])}  ${x['count']}', style: const TextStyle(fontSize: 12)),
              onPressed: () => _go(ItCustodyScreen(initialBucket: 'other', initialOtherType: '${x['key']}')),
            )).toList())),
      // Open vs resolved: if the first outpaces the second for long, the backlog grows.
      _card(tr('البلاغات المفتوحة مقابل المحلولة', 'Opened vs resolved'), _timeline(_list(t['timeline']))),
      _card(tr('البلاغات حسب التصنيف', 'Tickets by category'), _bars(_list(t['ticketsByCategory']).map((r) => (categoryLabel(r['key']), _num(r['count']))).toList(), T.orange)),
      _card(tr('البلاغات حسب الأولوية', 'Tickets by priority'), _bars(_list(t['ticketsByPriority']).map((r) => (priorityLabel(r['key']), _num(r['count']))).toList(), T.info)),
      // Recurring issues are deliberately loud: repetition is an unaddressed root cause.
      Container(
        margin: const EdgeInsets.only(bottom: 10),
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(color: const Color(0xFFFEF2F2), borderRadius: BorderRadius.circular(16), border: Border.all(color: const Color(0xFFFECACA))),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            const Icon(Icons.warning_amber_rounded, size: 18, color: Color(0xFF991B1B)),
            const SizedBox(width: 6),
            Expanded(child: Text(tr('المشكلات المتكررة', 'Recurring problems'), style: const TextStyle(fontWeight: FontWeight.w800, color: Color(0xFF991B1B)))),
            TextButton(onPressed: () => _go(const ItRecurringScreen()), child: Text(tr('التقرير الكامل', 'Full report'), style: const TextStyle(fontSize: 12, color: Color(0xFFB91C1C)))),
          ]),
          if (_list(_data?['topRecurring']).isEmpty)
            Text(tr('لا توجد مشكلات متكررة حالياً — وضع جيد.', 'No recurring problems right now — all good.'), style: const TextStyle(fontSize: 12.5, color: Color(0xFFB91C1C)))
          else ...[
            Text(tr('هذه المشكلات تكررت أكثر من مرة وتحتاج معالجة جذرية دائمة وليس حلاً مؤقتاً.', 'These problems came back more than once — they need a permanent root-cause fix, not another patch.'),
                style: const TextStyle(fontSize: 11.5, color: Color(0xFFB91C1C))),
            const SizedBox(height: 8),
            for (final g in _list(_data?['topRecurring']))
              Padding(
                padding: const EdgeInsets.only(bottom: 6),
                child: Pressable(
                  onTap: () => _go(ItRecurringScreen(initialSig: '${g['signature']}')),
                  child: Container(
                    padding: const EdgeInsets.all(10),
                    decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(10), border: Border.all(color: const Color(0xFFFECACA))),
                    child: Row(children: [
                      Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Text('${g['sampleTitle'] ?? ''}', maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13)),
                        Text('${categoryLabel(g['category'])} · ${tr('آخر بلاغ', 'last')} ${itDate(g['lastReportedAt'])}', style: const TextStyle(fontSize: 11, color: T.inkFaint)),
                      ])),
                      Chip2('${g['count']}× ${tr('تكرار', 'times')}', T.danger, icon: Icons.refresh),
                    ]),
                  ),
                ),
              ),
          ],
        ]),
      ),
      _card(tr('اشتراكات وتجديدات قريبة', 'Renewals due soon'), _list(t['renewalsDueSoon']).isEmpty
          ? _empty(tr('لا توجد تجديدات خلال 60 يوماً.', 'Nothing due in the next 60 days.'))
          : Column(children: _list(t['renewalsDueSoon']).map((s) {
              final d = DateTime.tryParse('${s['renewalDate'] ?? ''}');
              final now = DateTime.now();
              final days = d == null ? null : DateTime(d.year, d.month, d.day).difference(DateTime(now.year, now.month, now.day)).inDays;
              final color = days == null ? T.inkFaint : days < 0 ? T.danger : days <= 30 ? T.warn : T.inkSoft;
              final name = Lang.instance.ar && '${s['nameAr'] ?? ''}'.isNotEmpty ? '${s['nameAr']}' : '${s['name'] ?? ''}';
              return Padding(
                padding: const EdgeInsets.symmetric(vertical: 4),
                child: Row(children: [
                  Expanded(child: Text(name, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 13))),
                  Text('${itDate(s['renewalDate'])}${days == null ? '' : ' · ${days < 0 ? tr('متأخر ${-days} يوم', '${-days}d overdue') : tr('بعد $days يوم', 'in ${days}d')}'}',
                      style: TextStyle(fontSize: 11.5, fontWeight: FontWeight.w700, color: color)),
                ]),
              );
            }).toList())),
      _card(tr('أحدث البلاغات', 'Recent tickets'), _list(_data?['recentTickets']).isEmpty
          ? _empty(tr('لا توجد بلاغات.', 'No tickets yet.'))
          : Column(children: _list(_data?['recentTickets']).map((tk) => InkWell(
              onTap: () => _go(ItTicketDetailScreen(id: '${tk['_id']}')),
              child: Padding(
                padding: const EdgeInsets.symmetric(vertical: 5),
                child: Row(children: [
                  Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text('${tk['isRecurring'] == true ? '⟳ ' : ''}${tk['title'] ?? ''}', maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600)),
                    Text('${tk['ticketNumber'] ?? ''} · ${itDate(tk['reportedAt'])}', style: const TextStyle(fontSize: 11, color: T.inkFaint)),
                  ])),
                  Chip2(ticketStatusLabel(tk['status']), ticketStatusColor(tk['status'])),
                ]),
              ),
            )).toList())),
      if (_list(t['systemsByStatus']).isNotEmpty)
        _card(tr('حالة الأنظمة', 'Systems status'), Wrap(spacing: 6, runSpacing: 6, children: _list(t['systemsByStatus'])
            .map((s) => Chip2('${systemStatusLabel(s['key'])}: ${s['count']}', s['key'] == 'down' ? T.danger : s['key'] == 'degraded' ? T.warn : T.navy)).toList())),
    ]);
  }

  Widget _stat(String label, String value, Color color, VoidCallback? onTap) => Pressable(
        onTap: onTap ?? () {},
        child: AppCard(
          padding: const EdgeInsets.all(10),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
            Text(label, maxLines: 2, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 10.5, color: T.inkSoft, fontWeight: FontWeight.w700)),
            const SizedBox(height: 4),
            FittedBox(fit: BoxFit.scaleDown, alignment: AlignmentDirectional.centerStart,
                child: Text(value, style: TextStyle(fontSize: 20, fontWeight: FontWeight.w900, color: color))),
            if (onTap != null) Text(tr('اضغط لعرضها', 'tap to open'), style: const TextStyle(fontSize: 9.5, color: T.inkFaint)),
          ]),
        ),
      );

  Widget _card(String title, Widget child) => Padding(
        padding: const EdgeInsets.only(bottom: 10),
        child: AppCard(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(title, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13.5)),
          const SizedBox(height: 10),
          child,
        ])),
      );

  Widget _empty(String s) => Text(s, style: const TextStyle(fontSize: 12.5, color: T.inkFaint));

  Widget _bars(List<(String, num)> rows, Color color) {
    if (rows.isEmpty) return _empty(tr('لا توجد بيانات.', 'Nothing to show.'));
    final max = rows.map((r) => r.$2).fold<num>(1, (a, b) => b > a ? b : a);
    return Column(children: rows.map((r) => Padding(
      padding: const EdgeInsets.symmetric(vertical: 3),
      child: Row(children: [
        SizedBox(width: 110, child: Text(r.$1, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 12))),
        Expanded(child: ClipRRect(
          borderRadius: BorderRadius.circular(4),
          child: LinearProgressIndicator(value: r.$2 / max, minHeight: 10, color: color, backgroundColor: color.withValues(alpha: 0.10)),
        )),
        SizedBox(width: 36, child: Text('${r.$2}', textAlign: TextAlign.end, style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w800))),
      ]),
    )).toList());
  }

  Widget _timeline(List<Map<String, dynamic>> rows) {
    if (rows.isEmpty) return _empty(tr('لا توجد بيانات.', 'Nothing to show.'));
    final opened = rows.map((r) => _num(r['opened'])).toList();
    final resolved = rows.map((r) => _num(r['resolved'])).toList();
    final sumO = opened.fold<num>(0, (a, b) => a + b), sumR = resolved.fold<num>(0, (a, b) => a + b);
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      SizedBox(height: 140, width: double.infinity, child: CustomPaint(painter: _LinesPainter(opened, resolved))),
      const SizedBox(height: 6),
      Row(children: [
        Chip2('${tr('مفتوحة', 'Opened')}: $sumO', T.orange),
        const SizedBox(width: 6),
        Chip2('${tr('تم حلها', 'Resolved')}: $sumR', T.success),
        const Spacer(),
        Text('${'${rows.first['date']}'.substring(5)} → ${'${rows.last['date']}'.substring(5)}', style: const TextStyle(fontSize: 10.5, color: T.inkFaint)),
      ]),
    ]);
  }
}

class _LinesPainter extends CustomPainter {
  final List<num> a, b;
  _LinesPainter(this.a, this.b);
  @override
  void paint(Canvas canvas, Size size) {
    final max = [...a, ...b].fold<num>(1, (m, v) => v > m ? v : m).toDouble();
    final grid = Paint()..color = T.line.withValues(alpha: 0.6)..strokeWidth = 1;
    for (var i = 0; i <= 3; i++) {
      final y = size.height * i / 3;
      canvas.drawLine(Offset(0, y), Offset(size.width, y), grid);
    }
    void line(List<num> v, Color c) {
      if (v.isEmpty) return;
      final p = Path();
      for (var i = 0; i < v.length; i++) {
        final x = v.length == 1 ? size.width / 2 : size.width * i / (v.length - 1);
        final y = size.height - (v[i] / max) * size.height;
        i == 0 ? p.moveTo(x, y) : p.lineTo(x, y);
      }
      canvas.drawPath(p, Paint()..color = c..strokeWidth = 2..style = PaintingStyle.stroke);
    }
    line(a, T.orange);
    line(b, T.success);
  }
  @override
  bool shouldRepaint(_LinesPainter old) => old.a != a || old.b != b;
}
