import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';
import 'customs_detail.dart';

/// لوحةُ قسم التخليص — نظيرُ `/system/customs/dashboard` في الموقع.
///
/// ما يحتاجه الفريقُ ليعمل: كم معاملةً قادمةً ومفتوحةً ومغلقة، وأين تقف كلٌّ
/// منها، وما الذي ينتظر فاتورةَ نقله، وحركةُ كلّ فردٍ في الفريق. ولا رقمَ
/// ماليًّا فيها — الأرباحُ في «تحليلات قسم التخليص» وهي للإدارة وحدَها.
///
/// والصفوفُ تأتي مع الأرقام في النداء نفسِه: كلُّ بطاقةٍ تُلمَس فتُفتَح معاملاتُها
/// في ورقة، بلا نداءٍ ثانٍ ولا رقمٍ لا يُعرَف ممّ تكوّن.
class CustomsDashboardScreen extends StatefulWidget {
  const CustomsDashboardScreen({super.key});
  @override
  State<CustomsDashboardScreen> createState() => _CustomsDashboardScreenState();
}

List<Map<String, dynamic>> _maps(dynamic v) =>
    v is List ? [for (final e in v) if (e is Map) Map<String, dynamic>.from(e)] : [];
int _i(dynamic v) => v is num ? v.round() : int.tryParse('${v ?? ''}') ?? 0;

class _CustomsDashboardScreenState extends State<CustomsDashboardScreen> {
  Map<String, dynamic>? _d;
  bool _loading = true;
  String? _error;
  // فلاترُ النداء بأسمائها عند الخادم: customerParty, agentParty, branch,
  // cargoType, member (مَن أنشأ), from/to (تاريخُ الإنشاء). وكلُّ بطاقةٍ تُحسَب
  // على ما بقي بعدها.
  final Map<String, String> _f = {};
  bool _showFilters = false;
  // العملاءُ والوكلاءُ من `/filters` ({value,label})؛ والفريقُ من ردّ اللوحة.
  List<Map<String, dynamic>> _customerOpts = const [], _agentOpts = const [];
  bool _allCustomers = false;
  int _seq = 0;
  late final void Function() _onLive;

  @override
  void initState() {
    super.initState();
    _load();
    _loadOptions();
    _onLive = () => _load();
    Live.instance.on('customs:updated', _onLive);
  }

  @override
  void dispose() {
    Live.instance.off('customs:updated', _onLive);
    super.dispose();
  }

  Future<void> _load() async {
    // ردُّ النداء الأقدم لا يغلب الأحدث: غيرُ المفلتَر أبطأ، فلو وصل آخِرًا
    // رسم أرقامَ الكلّ تحت اسم عميلٍ مختار.
    final mine = ++_seq;
    final q = _f.entries.map((e) => '${e.key}=${Uri.encodeQueryComponent(e.value)}').join('&');
    try {
      final d = await Api.instance.get('/api/customs-clearance/dashboard${q.isEmpty ? '' : '?$q'}');
      if (!mounted || mine != _seq) return;
      setState(() {
        _d = Map<String, dynamic>.from(d);
        _loading = false;
        _error = null;
      });
    } catch (e) {
      if (mounted && mine == _seq) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  Future<void> _loadOptions() async {
    try {
      final d = await Api.instance.get('/api/customs-clearance/filters');
      final o = d['options'] is Map ? d['options'] as Map : const {};
      if (mounted) setState(() { _customerOpts = _maps(o['customers']); _agentOpts = _maps(o['agents']); });
    } catch (_) {
      // بلا القائمتين تبقى بقيّةُ الفلاتر تعمل.
    }
  }

  void _setF(String key, String value) {
    setState(() { value.isEmpty ? _f.remove(key) : _f[key] = value; _loading = true; });
    _load();
  }

  Widget _pick(String key, String label, String all, List<(String, String)> opts) => Padding(
        padding: const EdgeInsets.only(top: 8),
        child: DropdownButtonFormField<String>(
          // المفتاحُ يتبع القيمة: «مسح الفلاتر» ولمسةُ فردٍ من الفريق يغيّرانها من خارج القائمة.
          key: ValueKey('$key:${_f[key] ?? ''}'),
          initialValue: opts.any((o) => o.$1 == _f[key]) ? _f[key] : '',
          isExpanded: true,
          decoration: InputDecoration(isDense: true, labelText: label, border: const OutlineInputBorder()),
          items: [
            DropdownMenuItem(value: '', child: Text(all)),
            for (final o in opts) DropdownMenuItem(value: o.$1, child: Text(o.$2, overflow: TextOverflow.ellipsis)),
          ],
          onChanged: (v) => _setF(key, v ?? ''),
        ),
      );

  Widget _date(String key, String label) => Expanded(
        child: OutlinedButton(
          onPressed: () async {
            final d = await showDatePicker(
              context: context,
              initialDate: DateTime.tryParse(_f[key] ?? '') ?? DateTime.now(),
              firstDate: DateTime(2020), lastDate: DateTime(2100),
            );
            if (d != null) _setF(key, d.toIso8601String().split('T').first);
          },
          onLongPress: _f[key] == null ? null : () => _setF(key, ''),
          child: Text('$label: ${_f[key] ?? '—'}', style: const TextStyle(fontSize: 12), overflow: TextOverflow.ellipsis),
        ),
      );

  Widget _filters(List<Map<String, dynamic>> team) => AppCard(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          InkWell(
            onTap: () => setState(() => _showFilters = !_showFilters),
            child: Row(children: [
              const Icon(Icons.filter_list, size: 18, color: T.navy),
              const SizedBox(width: 6),
              Text(tr('الفلاتر', 'Filters'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13)),
              const SizedBox(width: 6),
              if (_f.isNotEmpty) Chip2('${_f.length}', T.orange),
              const Spacer(),
              if (_f.isNotEmpty)
                TextButton(
                  style: TextButton.styleFrom(visualDensity: VisualDensity.compact),
                  onPressed: () { setState(() { _f.clear(); _loading = true; }); _load(); },
                  child: Text(tr('مسح الفلاتر', 'Clear filters')),
                ),
              Icon(_showFilters ? Icons.expand_less : Icons.expand_more, color: T.inkSoft),
            ]),
          ),
          if (_showFilters) ...[
            _pick('customerParty', tr('العميل', 'Customer'), tr('كلُّ العملاء', 'All customers'),
                [for (final c in _customerOpts) ('${c['value']}', '${c['label'] ?? ''}')]),
            _pick('agentParty', tr('وكيل الشحن', 'Shipping agent'), tr('كلُّ الوكلاء', 'All agents'),
                [for (final c in _agentOpts) ('${c['value']}', '${c['label'] ?? ''}')]),
            Row(children: [
              Expanded(child: _pick('branch', tr('الفرع', 'Branch'), tr('كلُّ الفروع', 'All branches'),
                  [('jeddah', tr('جدة', 'Jeddah')), ('dammam', tr('الدمام', 'Dammam'))])),
              const SizedBox(width: 8),
              Expanded(child: _pick('cargoType', tr('نوع المعاملة', 'Type'), tr('الكلّ', 'All'),
                  [('containers', tr('حاويات', 'Containers')), ('vehicles', tr('سيّارات', 'Vehicles'))])),
            ]),
            _pick('member', tr('مَن أنشأ', 'Created by'), tr('كلُّ الفريق', 'Whole team'),
                [for (final m in team) ('${m['_id']}', '${m['name'] ?? ''}')]),
            const SizedBox(height: 8),
            // تاريخُ الإنشاء — والضغطةُ الطويلةُ تمسح التاريخ.
            Row(children: [_date('from', tr('من', 'From')), const SizedBox(width: 8), _date('to', tr('إلى', 'To'))]),
            const SizedBox(height: 6),
          ],
        ]),
      );

  void _open(Map<String, dynamic> r) => Navigator.push(context, MaterialPageRoute(
      builder: (_) => CustomsDetailScreen(clearanceId: '${r['_id']}', ref: '${r['refNumber'] ?? ''}')));

  /// معاملاتُ بطاقةٍ أو مرحلةٍ أو عميل — من الصفوف المحمَّلة نفسِها.
  void _showRows(String title, bool Function(Map<String, dynamic>) test) {
    final rows = _maps(_d?['rows']).where(test).toList();
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      backgroundColor: T.canvas,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(22))),
      builder: (_) => DraggableScrollableSheet(
        expand: false,
        initialChildSize: 0.85,
        maxChildSize: 0.95,
        builder: (c, scroll) => Column(children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 14, 8, 6),
            child: Row(children: [
              Expanded(child: Text('$title (${rows.length})', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15))),
              IconButton(onPressed: () => Navigator.pop(c), icon: const Icon(Icons.close)),
            ]),
          ),
          Expanded(
            child: rows.isEmpty
                ? EmptyState(icon: Icons.directions_boat_outlined, title: tr('لا معاملات هنا', 'No transactions here'))
                : ListView.separated(
                    controller: scroll,
                    padding: const EdgeInsets.fromLTRB(14, 4, 14, 24),
                    itemCount: rows.length,
                    separatorBuilder: (_, __) => const SizedBox(height: 8),
                    itemBuilder: (_, i) => _row(rows[i]),
                  ),
          ),
        ]),
      ),
    );
  }

  Widget _row(Map<String, dynamic> r) {
    final vehicles = r['cargoType'] == 'vehicles';
    final bucket = '${r['bucket']}';
    final bl = '${r['blNumber'] ?? ''}';
    final awaiting = r['awaitingTransportInvoice'] == true;
    final state = switch (bucket) {
      'upcoming' => [tr('قادمة', 'Upcoming'), if ('${r['expectedDate'] ?? ''}'.isNotEmpty) '${r['expectedDate']}'].join(' · '),
      'closed' => tr('مغلقة', 'Closed'),
      'cancelled' => tr('ملغاة', 'Cancelled'),
      _ => '${r['next'] ?? ''}'.isEmpty
          ? tr('اكتملت مراحلُها — تنتظر الإنهاء', 'All stages done — awaiting closure')
          : customsStageLabel('${r['next']}', '${r['cargoType'] ?? 'containers'}'),
    };
    return Pressable(
      onTap: () => _open(r),
      child: AppCard(
        topAccent: awaiting || r['returnState'] == 'overdue' ? T.danger : null,
        padding: const EdgeInsets.all(12),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(bl.isNotEmpty ? '$bl — ${r['customerName'] ?? ''}' : '${r['customerName'] ?? '—'}',
              style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13.5), maxLines: 1, overflow: TextOverflow.ellipsis),
          const SizedBox(height: 2),
          Text([
            '${tr('رقم المعاملة', 'Transaction no.')}: ${r['refNumber'] ?? ''}',
            if ('${r['createdByName'] ?? ''}'.isNotEmpty) '${r['createdByName']}',
          ].join(' · '), style: const TextStyle(fontSize: 11.5, color: T.inkSoft), maxLines: 1, overflow: TextOverflow.ellipsis),
          const SizedBox(height: 6),
          Row(children: [
            Expanded(child: Text(state, style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: bucket == 'open' ? T.navy : T.inkSoft))),
            Text('${_i(r['percent'])}%', style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w800, color: T.navy)),
          ]),
          const SizedBox(height: 4),
          ClipRRect(
            borderRadius: BorderRadius.circular(4),
            child: LinearProgressIndicator(value: (_i(r['percent']) / 100).clamp(0, 1).toDouble(), minHeight: 5, backgroundColor: T.line, color: T.success),
          ),
          const SizedBox(height: 6),
          Wrap(spacing: 5, runSpacing: 5, children: [
            Chip2('${_i(r['units'])} ${vehicles ? tr('سيّارة', 'vehicles') : tr('حاوية', 'containers')}', T.violet),
            if ('${r['invoiceNumber'] ?? ''}'.isNotEmpty) Chip2('${tr('مفوترة', 'Invoiced')} · ${r['invoiceNumber']}', T.success),
            if (awaiting) Chip2(tr('بانتظار فاتورة النقل', 'Awaiting transport invoice'), T.danger, icon: Icons.error_outline),
            if (r['returnState'] == 'overdue') Chip2('${tr('تأخّر الإرجاع', 'Return overdue')} · ${r['returnDeadline']}', T.danger)
            else if (r['returnState'] == 'due') Chip2('${tr('الإرجاع قريب', 'Return due')} · ${r['returnDeadline']}', T.warn),
            if (_i(r['pendingPayments']) > 0) Chip2(tr('${r['pendingPayments']} طلب صرف معلّق', '${r['pendingPayments']} pending payments'), T.warn),
            if (_i(r['openTasks']) > 0) Chip2(tr('${r['openTasks']} مهمّة', '${r['openTasks']} tasks'), T.info, icon: Icons.event_available_outlined),
          ]),
        ]),
      ),
    );
  }

  Widget _card(String label, int value, Color color, IconData icon, bool Function(Map<String, dynamic>) test, {String? sub}) => Pressable(
        onTap: () => _showRows(label, test),
        child: AppCard(
          topAccent: color == T.danger && value > 0 ? T.danger : null,
          padding: const EdgeInsets.all(12),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisAlignment: MainAxisAlignment.center, children: [
            Row(children: [
              Icon(icon, size: 16, color: color),
              const SizedBox(width: 6),
              Expanded(child: Text(label, style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: T.inkSoft), maxLines: 1, overflow: TextOverflow.ellipsis)),
            ]),
            const SizedBox(height: 6),
            Text('$value', style: TextStyle(fontSize: 21, fontWeight: FontWeight.w900, color: color == T.danger && value == 0 ? T.ink : color, height: 1)),
            if (sub != null) ...[
              const SizedBox(height: 3),
              Text(sub, style: const TextStyle(fontSize: 10.5, color: T.inkFaint), maxLines: 1, overflow: TextOverflow.ellipsis),
            ],
          ]),
        ),
      );

  Widget _head(String s) => Padding(
      padding: const EdgeInsets.fromLTRB(2, 18, 2, 8),
      child: Text(s, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14.5)));

  String _ago(dynamic v) {
    final d = DateTime.tryParse('${v ?? ''}')?.toLocal();
    return d == null ? tr('لا حركة', 'No activity') : '${tr('آخر حركة', 'Last activity')} ${d.day}/${d.month}/${d.year}';
  }

  @override
  Widget build(BuildContext context) {
    final d = _d;
    return AppScaffold(
      title: Text(tr('لوحة القسم', 'Section Dashboard')),
      body: _loading && d == null
          ? ListView(padding: const EdgeInsets.all(14), children: const [
              Shimmer(height: 92), SizedBox(height: 10), Shimmer(height: 180), SizedBox(height: 10), Shimmer(height: 180),
            ])
          : _error != null || d == null
              ? ErrorRetry(message: _error ?? '—', onRetry: () { setState(() => _loading = true); _load(); })
              : RefreshIndicator(onRefresh: _load, child: _body(d)),
    );
  }

  Widget _body(Map<String, dynamic> d) {
    final n = Map<String, dynamic>.from(d['counts'] ?? const {});
    final byStage = _maps(d['byStage']);
    final byCustomer = _maps(d['byCustomer']);
    final team = _maps(d['team']);
    final shownCustomers = _allCustomers ? byCustomer : byCustomer.take(8).toList();
    return ListView(padding: const EdgeInsets.fromLTRB(14, 12, 14, 30), children: [
      _filters(team),
      if (_loading) const Padding(padding: EdgeInsets.only(top: 8), child: LinearProgressIndicator(minHeight: 2)),
      const SizedBox(height: 10),
      GridView.count(
        crossAxisCount: 2, shrinkWrap: true, physics: const NeverScrollableScrollPhysics(),
        crossAxisSpacing: 10, mainAxisSpacing: 10, childAspectRatio: 1.7,
        children: [
          _card(tr('قادمة', 'Upcoming'), _i(n['upcoming']), T.info, Icons.schedule_outlined, (r) => r['bucket'] == 'upcoming',
              sub: _i(n['upcomingOverdue']) > 0 ? tr('${n['upcomingOverdue']} فات موعدُها', '${n['upcomingOverdue']} past due') : null),
          _card(tr('مفتوحة', 'Open'), _i(n['open']), T.navy, Icons.directions_boat_outlined, (r) => r['bucket'] == 'open',
              sub: tr('${_i(n['openContainers'])} حاوية · ${_i(n['openVehicles'])} سيّارة', '${_i(n['openContainers'])} containers · ${_i(n['openVehicles'])} vehicles')),
          _card(tr('مغلقة', 'Closed'), _i(n['closed']), T.success, Icons.task_alt_outlined, (r) => r['bucket'] == 'closed',
              sub: tr('${_i(n['closedThisMonth'])} هذا الشهر', '${_i(n['closedThisMonth'])} this month')),
          _card(tr('بانتظار فاتورة النقل', 'Awaiting transport invoice'), _i(n['awaitingTransportInvoice']), T.danger, Icons.error_outline,
              (r) => r['awaitingTransportInvoice'] == true,
              sub: tr('${_i(n['notInvoiced'])} مفتوحة لم تُفوتَر', '${_i(n['notInvoiced'])} open not invoiced')),
          _card(tr('عملاء نعمل معهم الآن', 'Active customers'), _i(n['activeCustomers']), T.violet, Icons.people_outline, (r) => r['bucket'] == 'open',
              sub: tr('من ${_i(n['customers'])} عميلًا', 'of ${_i(n['customers'])} customers')),
          _card(tr('متأخّرة الإرجاع', 'Return overdue'), _i(n['returnOverdue']), T.danger, Icons.assignment_return_outlined, (r) => r['returnState'] == 'overdue',
              sub: _i(n['returnDue']) > 0 ? tr('${n['returnDue']} موعدُها قريب', '${n['returnDue']} due soon') : null),
          _card(tr('طلبات صرف معلّقة', 'Pending payment requests'), _i(n['pendingPayments']), T.warn, Icons.payments_outlined, (r) => _i(r['pendingPayments']) > 0,
              sub: tr('في ${_i(n['withPendingPayments'])} معاملة', 'in ${_i(n['withPendingPayments'])} transactions')),
          _card(tr('مهامّ JP', 'JP tasks'), _i(n['tasksOpen']), T.cyan, Icons.event_available_outlined, (r) => _i(r['openTasks']) > 0,
              sub: _i(n['tasksOverdue']) > 0 ? tr('${n['tasksOverdue']} متأخّرة', '${n['tasksOverdue']} late') : null),
        ],
      ),
      // ── أين تقف المفتوحة ──
      _head(tr('أين تقف المعاملات المفتوحة', 'Where open transactions stand')),
      AppCard(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
        child: Column(children: [
          if (byStage.isEmpty)
            Padding(padding: const EdgeInsets.all(10), child: Text(tr('لا معاملات مفتوحة', 'No open transactions'), style: const TextStyle(color: T.inkFaint, fontSize: 12.5))),
          for (final s in byStage)
            () {
              final key = '${s['key']}';
              final label = key == 'done' ? tr('اكتملت مراحلُها — تنتظر الإنهاء', 'All stages done — awaiting closure') : customsStageLabel(key);
              return InkWell(
                onTap: () => _showRows(label, (r) => r['bucket'] == 'open' && '${r['next'] ?? ''}' == (key == 'done' ? '' : key)),
                child: Padding(
                  padding: const EdgeInsets.symmetric(vertical: 8),
                  child: Row(children: [
                    Expanded(child: Text(label, style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700))),
                    Text(tr('${_i(s['units'])} وحدة', '${_i(s['units'])} units'), style: const TextStyle(fontSize: 11, color: T.inkFaint)),
                    const SizedBox(width: 8),
                    Chip2('${_i(s['count'])}', key == 'done' ? T.success : T.navy),
                  ]),
                ),
              );
            }(),
        ]),
      ),
      // ── الفرعان ──
      _head(tr('حسب الفرع', 'By branch')),
      AppCard(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
        child: Column(children: [
          for (final b in _maps(d['byBranch']))
            InkWell(
              onTap: () => _showRows(b['key'] == 'dammam' ? tr('الدمام', 'Dammam') : tr('جدة', 'Jeddah'),
                  (r) => r['bucket'] != 'cancelled' && r['branch'] == b['key']),
              child: Padding(
                padding: const EdgeInsets.symmetric(vertical: 8),
                child: Row(children: [
                  Expanded(child: Text(b['key'] == 'dammam' ? tr('الدمام', 'Dammam') : tr('جدة', 'Jeddah'), style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w800))),
                  Chip2(tr('قادمة ${_i(b['upcoming'])}', 'Upcoming ${_i(b['upcoming'])}'), T.info),
                  const SizedBox(width: 5),
                  Chip2(tr('مفتوحة ${_i(b['open'])}', 'Open ${_i(b['open'])}'), T.navy),
                  const SizedBox(width: 5),
                  Chip2(tr('مغلقة ${_i(b['closed'])}', 'Closed ${_i(b['closed'])}'), T.success),
                ]),
              ),
            ),
        ]),
      ),
      // ── العملاء ──
      _head(tr('حسب العميل', 'By customer')),
      AppCard(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          if (byCustomer.isEmpty)
            Padding(padding: const EdgeInsets.all(10), child: Text(tr('لا عملاء', 'No customers'), style: const TextStyle(color: T.inkFaint, fontSize: 12.5))),
          for (final c in shownCustomers)
            InkWell(
              onTap: () => _showRows('${c['name'] ?? ''}', (r) =>
                  r['bucket'] != 'cancelled' && '${r['customerParty'] ?? r['customerName'] ?? '—'}' == '${c['key']}'),
              child: Padding(
                padding: const EdgeInsets.symmetric(vertical: 8),
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text('${c['name'] ?? '—'}', style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w800), maxLines: 1, overflow: TextOverflow.ellipsis),
                  const SizedBox(height: 4),
                  Wrap(spacing: 5, runSpacing: 5, children: [
                    Chip2(tr('مفتوحة ${_i(c['open'])}', 'Open ${_i(c['open'])}'), T.navy),
                    if (_i(c['upcoming']) > 0) Chip2(tr('قادمة ${_i(c['upcoming'])}', 'Upcoming ${_i(c['upcoming'])}'), T.info),
                    if (_i(c['closed']) > 0) Chip2(tr('مغلقة ${_i(c['closed'])}', 'Closed ${_i(c['closed'])}'), T.success),
                    if (_i(c['awaiting']) > 0) Chip2(tr('بانتظار فاتورة النقل ${_i(c['awaiting'])}', 'Awaiting transport invoice ${_i(c['awaiting'])}'), T.danger),
                    if (_i(c['units']) > 0) Chip2(tr('${_i(c['units'])} وحدة مفتوحة', '${_i(c['units'])} open units'), T.violet),
                  ]),
                ]),
              ),
            ),
          if (byCustomer.length > 8)
            TextButton(
              onPressed: () => setState(() => _allCustomers = !_allCustomers),
              child: Text(_allCustomers ? tr('عرض أقلّ', 'Show less') : tr('عرض الكلّ (${byCustomer.length})', 'Show all (${byCustomer.length})')),
            ),
        ]),
      ),
      // ── الفريق: ما على كلّ فردٍ الآن، وما فعله في ثلاثين يومًا ──
      _head(tr('حركة الفريق (٣٠ يومًا)', 'Team activity (30 days)')),
      // لمسةُ فردٍ تجعل اللوحةَ كلَّها لما أنشأه هو — ولمسةٌ ثانيةٌ ترفع الفلتر.
      for (final m in team) ...[
        Pressable(
          onTap: () => _setF('member', _f['member'] == '${m['_id']}' ? '' : '${m['_id']}'),
          child: AppCard(
          topAccent: _f['member'] == '${m['_id']}' ? T.orange : null,
          padding: const EdgeInsets.all(12),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(children: [
              Expanded(child: Text('${m['name'] ?? ''}', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13.5))),
              if (m['isManager'] == true) Chip2(tr('مدير القسم', 'Manager'), T.orange),
              if (_i(m['tasksOverdue']) > 0) ...[const SizedBox(width: 5), Chip2(tr('${m['tasksOverdue']} مهمّة متأخّرة', '${m['tasksOverdue']} late tasks'), T.danger)],
            ]),
            const SizedBox(height: 4),
            Text(tr(
              'مفتوحة أنشأها ${_i(m['openCreated'])} · قادمة ${_i(m['upcomingCreated'])} · أغلق هذا الشهر ${_i(m['closedThisMonth'])}',
              'Open created ${_i(m['openCreated'])} · upcoming ${_i(m['upcomingCreated'])} · closed this month ${_i(m['closedThisMonth'])}',
            ), style: const TextStyle(fontSize: 12, color: T.inkSoft)),
            Text(tr(
              'مراحل ${_i(m['stages30'])} · ملاحظات ${_i(m['notes30'])} · طلبات صرف ${_i(m['payments30'])} · مهامّ قائمة ${_i(m['tasksOpen'])}',
              'Stages ${_i(m['stages30'])} · notes ${_i(m['notes30'])} · payment requests ${_i(m['payments30'])} · open tasks ${_i(m['tasksOpen'])}',
            ), style: const TextStyle(fontSize: 12, color: T.inkSoft)),
            const SizedBox(height: 2),
            Text(_ago(m['lastActivityAt']), style: const TextStyle(fontSize: 11, color: T.inkFaint)),
          ]),
        )),
        const SizedBox(height: 8),
      ],
      if (team.isEmpty) Text(tr('لا أفراد في الفريق', 'No team members'), style: const TextStyle(color: T.inkFaint, fontSize: 12.5)),
    ]);
  }
}
