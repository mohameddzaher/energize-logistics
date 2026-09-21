import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';
import '../ui/file_upload.dart';

/// الإدارة المالية — مالُ كلّ قسمٍ في موضعٍ واحد، من الحمولة نفسِها التي
/// تعرضها صفحاتُ الموقع (/api/finance). فلا يختلف رقمٌ بين الهاتف والموقع.
/// وتسمع `finance:changed`: أيُّ حركةٍ ماليّةٍ في أيّ قسمٍ تُعيد القراءة.

const financeDepts = <(String, String, String, IconData)>[
  ('operations', 'ماليات التشغيل', 'Operations finance', Icons.assignment_outlined),
  ('fleet', 'ماليات إدارة الأسطول', 'Fleet finance', Icons.local_shipping_outlined),
  ('customs', 'ماليات التخليص الجمركي', 'Customs finance', Icons.directions_boat_outlined),
  ('light', 'ماليات النقل الخفيف', 'Light transport finance', Icons.two_wheeler),
  ('marketing', 'ماليات التسويق والتطوير', 'Marketing & BD finance', Icons.campaign_outlined),
  ('hr', 'ماليات الموارد البشرية', 'HR finance', Icons.badge_outlined),
  ('it', 'ماليات تقنية المعلومات', 'IT finance', Icons.computer_outlined),
  ('collections', 'ماليات التحصيل', 'Collections finance', Icons.request_quote_outlined),
  ('vehicles', 'ماليات المركبات', 'Vehicles finance', Icons.directions_car_outlined),
];

String _pad(int n) => n.toString().padLeft(2, '0');

/// الفتراتُ الجاهزة — بتوقيت الجهاز، وهو توقيتُ الرياض عند المستخدمين.
(String, String) _range(String key) {
  final now = DateTime.now();
  final today = '${now.year}-${_pad(now.month)}-${_pad(now.day)}';
  switch (key) {
    case 'lastMonth':
      final first = DateTime(now.year, now.month - 1, 1);
      final last = DateTime(now.year, now.month, 0);
      return ('${first.year}-${_pad(first.month)}-01', '${last.year}-${_pad(last.month)}-${_pad(last.day)}');
    case 'quarter':
      final first = DateTime(now.year, now.month - 2, 1);
      return ('${first.year}-${_pad(first.month)}-01', today);
    case 'year':
      return ('${now.year}-01-01', today);
    default:
      return ('${now.year}-${_pad(now.month)}-01', today);
  }
}

const _presets = <(String, String, String)>[
  ('month', 'هذا الشهر', 'This month'),
  ('lastMonth', 'الشهر السابق', 'Last month'),
  ('quarter', 'آخر ٣ شهور', 'Last 3 months'),
  ('year', 'هذه السنة', 'This year'),
];

String fmtFin(dynamic v, String format) {
  if (v == null || v == '') return '—';
  if (format == 'money' || format == 'number') {
    final n = num.tryParse('$v');
    if (n == null) return '$v';
    final fixed = format == 'money' ? (n * 100).round() / 100 : n;
    final parts = fixed.toString().split('.');
    final intPart = parts[0].replaceAllMapped(RegExp(r'(\d)(?=(\d{3})+$)'), (m) => '${m[1]},');
    final dec = parts.length > 1 && parts[1] != '0' ? '.${parts[1].padRight(2, '0').substring(0, 2)}' : '';
    return '$intPart$dec';
  }
  if (format == 'pct') {
    final n = num.tryParse('$v') ?? 0;
    return '${(n * 10).round() / 10}%';
  }
  if (format == 'date') {
    final s = '$v';
    return s.length >= 10 ? s.substring(0, 10) : s;
  }
  return '$v';
}

Color _tone(String? tone, num value) {
  if (value < 0) return T.danger;
  switch (tone) {
    case 'good': return T.success;
    case 'bad': return T.danger;
    case 'warn': return T.warn;
    default: return T.ink;
  }
}

class _PeriodChips extends StatelessWidget {
  const _PeriodChips({required this.value, required this.onChanged});
  final String value;
  final ValueChanged<String> onChanged;
  @override
  Widget build(BuildContext context) => SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.fromLTRB(14, 10, 14, 4),
        child: Row(children: _presets.map((p) {
          final on = value == p.$1;
          return Padding(
            padding: const EdgeInsetsDirectional.only(end: 6),
            child: ChoiceChip(
              label: Text(tr(p.$2, p.$3), style: TextStyle(fontWeight: FontWeight.w700, color: on ? Colors.white : T.inkSoft)),
              selected: on,
              selectedColor: T.orange,
              onSelected: (_) => onChanged(p.$1),
            ),
          );
        }).toList()),
      );
}

// ═══════════════════════════════════════════════════════════════════════════
class FinanceOverviewScreen extends StatefulWidget {
  const FinanceOverviewScreen({super.key});
  @override
  State<FinanceOverviewScreen> createState() => _FinanceOverviewScreenState();
}

class _FinanceOverviewScreenState extends State<FinanceOverviewScreen> {
  String _preset = 'month';
  Map<String, dynamic>? _d;
  String? _error;
  bool _loading = true;
  int _seq = 0;
  late final void Function() _onLive;

  @override
  void initState() {
    super.initState();
    _load();
    _onLive = () => _load();
    Live.instance.on('finance:changed', _onLive);
  }

  @override
  void dispose() {
    Live.instance.off('finance:changed', _onLive);
    super.dispose();
  }

  Future<void> _load() async {
    final mine = ++_seq;
    final r = _range(_preset);
    try {
      final d = await Api.instance.get('/api/finance/overview?from=${r.$1}&to=${r.$2}');
      if (!mounted || mine != _seq) return;
      setState(() { _d = d; _error = null; _loading = false; });
    } catch (e) {
      if (!mounted || mine != _seq) return;
      setState(() { _error = e.toString(); _loading = false; });
    }
  }

  @override
  Widget build(BuildContext context) {
    final deps = List<Map<String, dynamic>>.from(_d?['departments'] ?? []);
    return AppScaffold(
      title: Text(tr('الإدارة المالية', 'Finance Management')),
      body: Column(children: [
        _PeriodChips(value: _preset, onChanged: (v) { setState(() { _preset = v; _loading = true; }); _load(); }),
        Expanded(
          child: _loading && _d == null
              ? ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(height: 110), SizedBox(height: 10), Shimmer(height: 110)])
              : _error != null && _d == null
                  ? ErrorRetry(message: _error!, onRetry: _load)
                  : RefreshIndicator(
                      onRefresh: _load,
                      child: ListView(
                        padding: const EdgeInsets.fromLTRB(14, 8, 14, 24),
                        children: financeDepts.map((dep) {
                          final row = deps.firstWhere((x) => x['key'] == dep.$1, orElse: () => <String, dynamic>{});
                          final cards = List<Map<String, dynamic>>.from(row['cards'] ?? []);
                          return Padding(
                            padding: const EdgeInsets.only(bottom: 10),
                            child: InkWell(
                              borderRadius: BorderRadius.circular(16),
                              onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => FinanceDeptScreen(dept: dep.$1, arTitle: dep.$2, enTitle: dep.$3))),
                              child: AppCard(
                                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                  Row(children: [
                                    Icon(dep.$4, size: 19, color: T.orange),
                                    const SizedBox(width: 8),
                                    Expanded(child: Text(tr(dep.$2, dep.$3), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14.5))),
                                    const Icon(Icons.chevron_left_rounded, color: T.inkFaint),
                                  ]),
                                  const SizedBox(height: 8),
                                  ...cards.map((c) => Padding(
                                        padding: const EdgeInsets.only(top: 3),
                                        child: Row(children: [
                                          Expanded(child: Text(tr('${c['ar']}', '${c['en']}'), style: const TextStyle(fontSize: 12, color: T.inkSoft))),
                                          Text(fmtFin(c['value'], '${c['format']}'),
                                              style: TextStyle(fontWeight: FontWeight.w800, fontSize: 13.5, color: _tone(c['tone'] as String?, (c['value'] as num?) ?? 0))),
                                        ]),
                                      )),
                                ]),
                              ),
                            ),
                          );
                        }).toList(),
                      ),
                    ),
        ),
      ]),
    );
  }
}

// ═══════════════════════════════════════════════════════════════════════════
class FinanceDeptScreen extends StatefulWidget {
  const FinanceDeptScreen({super.key, required this.dept, required this.arTitle, required this.enTitle});
  final String dept;
  final String arTitle;
  final String enTitle;
  @override
  State<FinanceDeptScreen> createState() => _FinanceDeptScreenState();
}

class _FinanceDeptScreenState extends State<FinanceDeptScreen> {
  String _preset = 'month';
  Map<String, dynamic>? _d;
  String? _error;
  bool _loading = true;
  int _seq = 0;
  late final void Function() _onLive;

  @override
  void initState() {
    super.initState();
    _load();
    _onLive = () => _load();
    Live.instance.on('finance:changed', _onLive);
  }

  @override
  void dispose() {
    Live.instance.off('finance:changed', _onLive);
    super.dispose();
  }

  Future<void> _load() async {
    final mine = ++_seq;
    final r = _range(_preset);
    try {
      final d = await Api.instance.get('/api/finance/departments/${widget.dept}?from=${r.$1}&to=${r.$2}');
      if (!mounted || mine != _seq) return;
      setState(() { _d = d; _error = null; _loading = false; });
    } catch (e) {
      if (!mounted || mine != _seq) return;
      setState(() { _error = e.toString(); _loading = false; });
    }
  }

  @override
  Widget build(BuildContext context) {
    final cards = List<Map<String, dynamic>>.from(_d?['cards'] ?? []);
    final tables = List<Map<String, dynamic>>.from(_d?['tables'] ?? []);
    final notes = List<Map<String, dynamic>>.from(_d?['notes'] ?? []);
    return AppScaffold(
      title: Text(tr(widget.arTitle, widget.enTitle)),
      body: Column(children: [
        _PeriodChips(value: _preset, onChanged: (v) { setState(() { _preset = v; _loading = true; }); _load(); }),
        Expanded(
          child: _loading && _d == null
              ? ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(height: 80), SizedBox(height: 10), Shimmer(height: 160)])
              : _error != null && _d == null
                  ? ErrorRetry(message: _error!, onRetry: _load)
                  : RefreshIndicator(
                      onRefresh: _load,
                      child: ListView(
                        padding: const EdgeInsets.fromLTRB(14, 8, 14, 24),
                        children: [
                          // ── طلباتُ صرف التخليص ───────────────────────────
                          // ما طلب قسمُ التخليص دفعَه — يُقرَّر فيه من الهاتف
                          // كما يُقرَّر من الموقع، بالعقد نفسِه.
                          if (widget.dept == 'customs') ...[
                            const _CustomsPaymentRequests(),
                            const SizedBox(height: 12),
                          ],
                          Wrap(spacing: 8, runSpacing: 8, children: cards.map((c) {
                            final w = (MediaQuery.of(context).size.width - 28 - 8) / 2;
                            return SizedBox(
                              width: w,
                              child: AppCard(
                                padding: const EdgeInsets.all(11),
                                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                  Text(tr('${c['ar']}', '${c['en']}'), maxLines: 2, style: const TextStyle(fontSize: 11, color: T.inkSoft, fontWeight: FontWeight.w600)),
                                  const SizedBox(height: 4),
                                  Text(fmtFin(c['value'], '${c['format']}'),
                                      style: TextStyle(fontWeight: FontWeight.w900, fontSize: 16, color: _tone(c['tone'] as String?, (c['value'] as num?) ?? 0))),
                                ]),
                              ),
                            );
                          }).toList()),
                          if (notes.isNotEmpty) ...[
                            const SizedBox(height: 10),
                            Container(
                              padding: const EdgeInsets.all(10),
                              decoration: BoxDecoration(color: T.info.withValues(alpha: 0.07), borderRadius: BorderRadius.circular(12)),
                              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: notes.map((n) => Padding(
                                    padding: const EdgeInsets.only(bottom: 3),
                                    child: Text('• ${tr('${n['ar']}', '${n['en']}')}', style: const TextStyle(fontSize: 11.5, color: T.inkSoft)),
                                  )).toList()),
                            ),
                          ],
                          const SizedBox(height: 12),
                          ...tables.map((t) => Padding(
                                padding: const EdgeInsets.only(bottom: 10),
                                child: _FinTableCard(table: t),
                              )),
                        ],
                      ),
                    ),
        ),
      ]),
    );
  }
}

/// جدولٌ على الهاتف: عنوانُه وعددُ صفوفه ومجموعُ أعمدة المال، ويُفتح على صفوفه
/// بطاقةً بطاقة — العمودُ الأوّل عنوانُ البطاقة والباقي سطورٌ تحته.
class _FinTableCard extends StatelessWidget {
  const _FinTableCard({required this.table});
  final Map<String, dynamic> table;

  @override
  Widget build(BuildContext context) {
    final cols = List<Map<String, dynamic>>.from(table['columns'] ?? []);
    final rows = List<Map<String, dynamic>>.from(table['rows'] ?? []);
    final moneyCols = cols.where((c) => c['format'] == 'money').toList();
    return AppCard(
      padding: EdgeInsets.zero,
      child: ExpansionTile(
        shape: const Border(),
        title: Text(tr('${table['ar']}', '${table['en']}'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14)),
        subtitle: Text(
          [
            '${rows.length} ${tr('صف', 'rows')}',
            if (moneyCols.isNotEmpty)
              '${tr(moneyCols.first['ar'], moneyCols.first['en'])}: ${fmtFin(rows.fold<num>(0, (a, r) => a + ((r[moneyCols.first['key']] as num?) ?? 0)), 'money')}',
          ].join(' · '),
          style: const TextStyle(fontSize: 11.5, color: T.inkSoft),
        ),
        childrenPadding: const EdgeInsets.fromLTRB(12, 0, 12, 12),
        children: [
          if (rows.isEmpty) Text(tr('لا بيانات في هذه الفترة', 'No data in this period'), style: const TextStyle(color: T.inkFaint)),
          ...rows.take(60).map((r) => Container(
                margin: const EdgeInsets.only(top: 8),
                padding: const EdgeInsets.all(10),
                decoration: BoxDecoration(color: T.canvas, borderRadius: BorderRadius.circular(10)),
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text(fmtFin(r[cols.first['key']], '${cols.first['format']}'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13)),
                  ...cols.skip(1).map((c) => Padding(
                        padding: const EdgeInsets.only(top: 2),
                        child: Row(children: [
                          Expanded(child: Text(tr('${c['ar']}', '${c['en']}'), style: const TextStyle(fontSize: 11.5, color: T.inkSoft))),
                          Text(fmtFin(r[c['key']], '${c['format']}'),
                              style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700,
                                  color: (num.tryParse('${r[c['key']]}') ?? 0) < 0 && c['format'] != 'text' ? T.danger : T.ink)),
                        ]),
                      )),
                ]),
              )),
          if (rows.length > 60)
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: Text(tr('تُعرض أول ٦٠ صفًا — الجدول كاملًا وتصديره من الموقع.', 'First 60 rows — the full table and export are on the website.'),
                  style: const TextStyle(fontSize: 11, color: T.inkFaint)),
            ),
        ],
      ),
    );
  }
}

/// طلباتُ صرف التخليص — المعلَّقةُ أوّلًا، وثلاثةُ أجوبةٍ لكلّ طلب.
class _CustomsPaymentRequests extends StatefulWidget {
  const _CustomsPaymentRequests();
  @override
  State<_CustomsPaymentRequests> createState() => _CustomsPaymentRequestsState();
}

class _CustomsPaymentRequestsState extends State<_CustomsPaymentRequests> {
  List<Map<String, dynamic>> _rows = const [];
  Map<String, dynamic> _counts = const {};
  bool _loading = true;
  String _tab = 'pending';

  @override
  void initState() { super.initState(); _load(); }

  Future<void> _load() async {
    try {
      final d = await Api.instance.get('/api/customs-clearance/payment-requests?status=$_tab');
      if (!mounted) return;
      setState(() {
        _rows = List<Map<String, dynamic>>.from(d['requests'] ?? const []);
        _counts = Map<String, dynamic>.from(d['counts'] ?? const {});
        _loading = false;
      });
    } catch (_) {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _decide(Map<String, dynamic> r, String decision) async {
    final noteCtrl = TextEditingController();
    PickedFile? proof;
    final go = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      builder: (c) => StatefulBuilder(builder: (c, setSheet) => SafeArea(
        child: Padding(
          padding: EdgeInsets.fromLTRB(16, 16, 16, MediaQuery.of(c).viewInsets.bottom + 16),
          child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(
              decision == 'paid' ? tr('تأكيد الدفع', 'Confirm payment')
                  : decision == 'returned' ? tr('إرجاع الطلب', 'Return the request')
                      : tr('رفض الطلب', 'Reject the request'),
              style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
            const SizedBox(height: 4),
            Text('${r['refNumber'] ?? ''} · ${r['label'] ?? r['key'] ?? ''}',
                style: const TextStyle(fontSize: 11.5, color: T.inkFaint)),
            const SizedBox(height: 12),
            TextField(
              controller: noteCtrl,
              maxLines: 2,
              decoration: InputDecoration(labelText: tr('ملاحظة (اختياري)', 'Note (optional)')),
            ),
            if (decision == 'paid') ...[
              const SizedBox(height: 10),
              OutlinedButton.icon(
                onPressed: () async {
                  final f = await pickFileAsDataUrl();
                  if (f != null) setSheet(() => proof = f);
                },
                icon: const Icon(Icons.attach_file, size: 18),
                label: Text(proof == null
                    ? tr('إرفاق إثبات الدفع (اختياري)', 'Attach proof (optional)')
                    : proof!.fileName),
              ),
            ],
            const SizedBox(height: 12),
            SizedBox(
              width: double.infinity,
              child: FilledButton(onPressed: () => Navigator.pop(c, true), child: Text(tr('تأكيد', 'Confirm'))),
            ),
          ]),
        ),
      )),
    );
    if (go != true) return;
    try {
      await Api.instance.patch(
        '/api/customs-clearance/${r['clearanceId']}/payment-stages/${r['entryId']}/decision',
        {
          'decision': decision,
          'note': noteCtrl.text.trim(),
          if (proof != null) 'files': [{'dataUrl': proof!.dataUrl, 'fileName': proof!.fileName}],
        },
      );
      _load();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    }
  }

  @override
  Widget build(BuildContext context) {
    return AppCard(
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          Expanded(child: Text(tr('طلبات صرف التخليص', 'Customs payment requests'),
              style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13.5))),
          Chip2('${_counts['pending'] ?? 0}', T.warn),
        ]),
        const SizedBox(height: 2),
        Text(tr('ما طلب قسمُ التخليص دفعَه — بمرفقه', 'What customs asked to be paid — with its file'),
            style: const TextStyle(fontSize: 11, color: T.inkFaint)),
        const SizedBox(height: 8),
        SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          child: Row(children: [
            for (final t in const [('pending', 'بانتظار الدفع', 'Awaiting'), ('paid', 'مدفوعة', 'Paid'), ('returned', 'مُعادة', 'Returned'), ('rejected', 'مرفوضة', 'Rejected')])
              Padding(
                padding: const EdgeInsets.only(left: 6),
                child: FilterChip(
                  selected: _tab == t.$1,
                  onSelected: (_) { setState(() { _tab = t.$1; _loading = true; }); _load(); },
                  label: Text(tr(t.$2, t.$3)),
                  labelStyle: TextStyle(fontSize: 11.5, fontWeight: FontWeight.w700, color: _tab == t.$1 ? Colors.white : T.inkSoft),
                  selectedColor: T.navy,
                  side: BorderSide.none,
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
                ),
              ),
          ]),
        ),
        const SizedBox(height: 6),
        if (_loading)
          const Padding(padding: EdgeInsets.all(14), child: Center(child: CircularProgressIndicator(strokeWidth: 2)))
        else if (_rows.isEmpty)
          Padding(padding: const EdgeInsets.all(14), child: Center(child: Text(tr('لا طلبات', 'Nothing here'), style: const TextStyle(fontSize: 12, color: T.inkFaint))))
        else
          ..._rows.take(40).map((r) => Padding(
            padding: const EdgeInsets.only(top: 8),
            child: Container(
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(color: T.inkFaint.withValues(alpha: 0.05), borderRadius: BorderRadius.circular(12)),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Row(children: [
                  Expanded(child: Text('${r['customerName'] ?? '—'}', style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w800))),
                  Text('${r['refNumber'] ?? ''}', style: const TextStyle(fontSize: 11, color: T.inkFaint)),
                ]),
                const SizedBox(height: 2),
                Text('${r['label'] ?? r['key'] ?? ''} · ${r['amount'] ?? '—'}${r['note'] != null && '${r['note']}'.isNotEmpty ? ' · ${r['note']}' : ''}',
                    style: const TextStyle(fontSize: 11.5)),
                if ('${r['decisionNote'] ?? ''}'.isNotEmpty)
                  Text('${r['decisionNote']}', style: const TextStyle(fontSize: 11, color: T.inkSoft)),
                const SizedBox(height: 6),
                Row(children: [
                  if ('${r['fileUrl'] ?? ''}'.isNotEmpty)
                    Text(tr('مرفق ✓', 'file ✓'), style: const TextStyle(fontSize: 11, color: T.success, fontWeight: FontWeight.w700))
                  else
                    Text(tr('بلا مرفق', 'no file'), style: const TextStyle(fontSize: 11, color: T.warn)),
                  const Spacer(),
                  IconButton(tooltip: tr('تم الدفع', 'Paid'), icon: const Icon(Icons.check, size: 18, color: T.success), onPressed: () => _decide(r, 'paid')),
                  IconButton(tooltip: tr('إرجاع', 'Return'), icon: const Icon(Icons.undo, size: 18, color: T.info), onPressed: () => _decide(r, 'returned')),
                  IconButton(tooltip: tr('رفض', 'Reject'), icon: const Icon(Icons.block, size: 18, color: T.danger), onPressed: () => _decide(r, 'rejected')),
                ]),
              ]),
            ),
          )),
      ]),
    );
  }
}
