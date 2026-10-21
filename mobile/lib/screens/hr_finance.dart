import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';
import '../config.dart';
import '../services/api.dart';
import '../services/hijri.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/file_upload.dart';
import '../ui/hr_quick.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';
import 'hr_employee_profile.dart';

/// ماليّاتُ الموارد البشريّة — نظيرةُ `/system/finance/hr/residency` و`/system/hr/finance-follow`.
///
/// تبويبان في الجهتين:
///   · رسومُ الإقامات ورخص العمل: كلُّ مستندٍ صفّ (الإقامةُ ورخصةُ العمل منفصلتان)،
///     ما انتهى وما بقي عليه ٢٠ يومًا فأقلّ. الماليّةُ تحدّد صفًّا أو أكثر — أو كلَّ
///     نتائج الفلتر — وتسجّل «تمّ دفع الرسوم»؛ والموارد البشريّة تقرأ الحالة.
///   · الطلبات: الموارد البشريّة ترسل (موظّفون + ما يُحتاج لكلٍّ منهم + مرفقات)،
///     والماليّةُ تجيب «تمّ» أو «لم يتمّ» بملاحظةٍ ومرفقات.
///
/// والأرقامُ كلُّها من الخادم: كلُّ مجموعةِ شرائح تُعَدّ بكلّ الفلاتر عدا فلترها
/// (controllers/hrFinanceController) — كالموقع تمامًا.
class FinanceResidencyScreen extends StatelessWidget {
  const FinanceResidencyScreen({super.key});
  @override
  Widget build(BuildContext context) => _Tabs(
        title: tr('الإقامات ورخص العمل', 'Iqamas & Work Permits'),
        tabs: [tr('الرسوم', 'Fees'), tr('طلبات الموارد البشرية', 'HR requests')],
        children: const [
          HrDocFeesView(listUrl: '/api/finance/hr-docs', optionsUrl: '/api/finance/hr-docs/options',
              payUrl: '/api/finance/hr-docs/pay', unpayUrl: '/api/finance/hr-docs/unpay'),
          HrFinanceRequestsView(finance: true, listUrl: '/api/finance/hr-requests', answerUrl: '/api/finance/hr-requests'),
        ],
      );
}

class HrFinanceFollowScreen extends StatelessWidget {
  const HrFinanceFollowScreen({super.key});
  @override
  Widget build(BuildContext context) => _Tabs(
        title: tr('متابعة المالية', 'Finance Follow-up'),
        tabs: [tr('رسوم الإقامات ورخص العمل', 'Iqama & permit fees'), tr('طلبات للمالية', 'Requests to Finance')],
        children: const [
          HrDocFeesView(listUrl: '/api/hr/finance-follow/docs', optionsUrl: '/api/hr/finance-follow/options', profileLinks: true),
          HrFinanceRequestsView(finance: false, listUrl: '/api/hr/finance-requests', createUrl: '/api/hr/finance-requests'),
        ],
      );
}

class _Tabs extends StatelessWidget {
  final String title;
  final List<String> tabs;
  final List<Widget> children;
  const _Tabs({required this.title, required this.tabs, required this.children});
  @override
  Widget build(BuildContext context) => DefaultTabController(
        length: tabs.length,
        child: AppScaffold(
          title: Text(title),
          appBarBottom: TabBar(
            isScrollable: true,
            indicatorColor: T.orange,
            labelStyle: const TextStyle(fontWeight: FontWeight.w800),
            tabs: [for (final t in tabs) Tab(text: t)],
          ),
          body: TabBarView(children: children),
        ),
      );
}

String _url(String u) => u.startsWith('http') ? u : '${AppConfig.apiBase}$u';
void _openFile(Map f) => launchUrl(Uri.parse(_url('${f['fileUrl']}')), mode: LaunchMode.externalApplication);

String _docLabel(String k) => k == 'iqama' ? tr('إقامة', 'Iqama') : tr('رخصة عمل', 'Work permit');

String _stamp(dynamic v) {
  final d = DateTime.tryParse((v ?? '').toString());
  if (d == null) return '—';
  final l = d.toLocal();
  return '${l.year}/${l.month.toString().padLeft(2, '0')}/${l.day.toString().padLeft(2, '0')} '
      '${l.hour.toString().padLeft(2, '0')}:${l.minute.toString().padLeft(2, '0')}';
}

Widget _files(List files) => Wrap(spacing: 6, runSpacing: 6, children: [
      for (final f in files)
        ActionChip(
          avatar: const Icon(Icons.attach_file, size: 16),
          label: Text('${(f as Map)['fileName'] ?? tr('مرفق', 'File')}', style: const TextStyle(fontSize: 12)),
          onPressed: () => _openFile(f),
        ),
    ]);

void _snack(BuildContext context, String m) {
  if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(m)));
}

// ═══════════════════════════════════════════════════════════════════════════
//  رسومُ الإقامات ورخص العمل
// ═══════════════════════════════════════════════════════════════════════════
class HrDocFeesView extends StatefulWidget {
  final String listUrl;
  final String optionsUrl;
  final String? payUrl;
  final String? unpayUrl;
  final bool profileLinks;
  const HrDocFeesView({super.key, required this.listUrl, required this.optionsUrl, this.payUrl, this.unpayUrl, this.profileLinks = false});
  @override
  State<HrDocFeesView> createState() => _HrDocFeesViewState();
}

class _HrDocFeesViewState extends State<HrDocFeesView> with AutomaticKeepAliveClientMixin {
  @override
  bool get wantKeepAlive => true;

  String _win = '';
  String _doc = '';
  String _paid = '';
  String _q = '';
  Map<String, String> _quick = {};
  Map<String, dynamic>? _d;
  bool _loading = true;
  String? _error;
  int _seq = 0;
  Set<String> _sel = {};
  bool _all = false;
  bool _busy = false;
  late final void Function() _onLive;

  @override
  void initState() {
    super.initState();
    _load();
    _onLive = () => _load();
    for (final e in ['hr-finance:changed', 'hr:master', 'hr:employee']) { Live.instance.on(e, _onLive); }
  }

  @override
  void dispose() {
    for (final e in ['hr-finance:changed', 'hr:master', 'hr:employee']) { Live.instance.off(e, _onLive); }
    super.dispose();
  }

  Map<String, String> get _query => {
        if (_win.isNotEmpty) 'window': _win,
        if (_doc.isNotEmpty) 'doc': _doc,
        if (_paid.isNotEmpty) 'paid': _paid,
        if (_q.isNotEmpty) 'q': _q,
        ..._quick,
      };

  String _qs(Map<String, String> m) => m.entries.where((e) => e.value.isNotEmpty).map((e) => '${e.key}=${Uri.encodeComponent(e.value)}').join('&');

  /// فلترٌ جديد = نتائجُ جديدة: التحديدُ القديمُ لا يُحمَل إليها.
  void _refilter(void Function() change) {
    setState(() { change(); _sel = {}; _all = false; });
    _load();
  }

  Future<void> _load() async {
    final mine = ++_seq;
    try {
      final qs = _qs(_query);
      final d = await Api.instance.get('${widget.listUrl}${qs.isEmpty ? '' : '?$qs'}');
      if (!mounted || mine != _seq) return; // ردٌّ قديمٌ سبقه أحدث
      setState(() { _d = Map<String, dynamic>.from(d as Map); _loading = false; _error = null; });
    } catch (e) {
      if (mounted && mine == _seq) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  List<Map<String, dynamic>> get _rows => List<Map<String, dynamic>>.from(((_d?['rows'] as List?) ?? const []).map((e) => Map<String, dynamic>.from(e as Map)));
  int _n(dynamic m, String k) => ((m is Map ? m[k] : null) as num?)?.toInt() ?? 0;

  List<Map<String, dynamic>> get _selectedRows => _all ? _rows : _rows.where((r) => _sel.contains(r['key'])).toList();

  Map<String, dynamic> _target() => _all
      ? {'all': true, 'query': _query}
      : {'items': [for (final r in _selectedRows) {'employeeId': r['employeeId'], 'docType': r['docType']}]};

  Future<void> _pay() async {
    final unpaid = _selectedRows.where((r) => r['paid'] != true).length;
    if (unpaid == 0 || widget.payUrl == null) return;
    final note = TextEditingController();
    final amount = TextEditingController();
    final files = <PickedFile>[];
    final go = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      builder: (c) => StatefulBuilder(builder: (c, setSt) => SafeArea(
        child: Padding(
          padding: EdgeInsets.fromLTRB(16, 16, 16, MediaQuery.of(c).viewInsets.bottom + 16),
          child: SingleChildScrollView(
            child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              Text(tr('تمّ دفع الرسوم', 'Fees paid'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16)),
              const SizedBox(height: 8),
              Container(
                padding: const EdgeInsets.all(10),
                decoration: BoxDecoration(color: T.success.withValues(alpha: 0.08), borderRadius: BorderRadius.circular(10)),
                child: Text(
                  tr('سيُسجَّل دفعُ رسوم $unpaid مستند — تسجيلُ دفعٍ فقط، والتجديدُ يبقى للموارد البشرية من ملف الموظف.',
                      '$unpaid document(s) will be marked paid — payment only; HR still renews in the employee profile.'),
                  style: const TextStyle(fontSize: 12.5),
                ),
              ),
              const SizedBox(height: 10),
              TextField(controller: amount, keyboardType: const TextInputType.numberWithOptions(decimal: true),
                  decoration: InputDecoration(labelText: tr('المبلغ لكلّ مستند (اختياري)', 'Amount per document (optional)'))),
              const SizedBox(height: 8),
              TextField(controller: note, maxLines: 3, decoration: InputDecoration(labelText: tr('ملاحظة (اختياري)', 'Note (optional)'))),
              const SizedBox(height: 8),
              Wrap(spacing: 6, runSpacing: 6, children: [
                for (final f in files) Chip(label: Text(f.fileName, style: const TextStyle(fontSize: 12)), onDeleted: () => setSt(() => files.remove(f))),
                ActionChip(
                  avatar: const Icon(Icons.attach_file, size: 16),
                  label: Text(tr('إرفاق ملفات', 'Attach files')),
                  onPressed: () async { final got = await pickFilesAsDataUrls(); setSt(() => files.addAll(got)); },
                ),
              ]),
              const SizedBox(height: 14),
              Row(children: [
                TextButton(onPressed: () => Navigator.pop(c, false), child: Text(tr('إلغاء', 'Cancel'))),
                const Spacer(),
                FilledButton.icon(
                  style: FilledButton.styleFrom(backgroundColor: T.success),
                  onPressed: () => Navigator.pop(c, true),
                  icon: const Icon(Icons.check_circle_outline, size: 18),
                  label: Text(tr('تسجيل الدفع', 'Record payment')),
                ),
              ]),
            ]),
          ),
        ),
      )),
    );
    if (go != true) return;
    setState(() => _busy = true);
    try {
      final r = await Api.instance.postLong(widget.payUrl!, {
        ..._target(),
        'note': note.text.trim(),
        'amount': amount.text.trim().isEmpty ? null : num.tryParse(amount.text.trim()),
        'files': [for (final f in files) {'dataUrl': f.dataUrl, 'fileName': f.fileName}],
      });
      if (!mounted) return;
      _snack(context, tr('سُجّل دفعُ رسوم ${(r as Map)['paid']} مستند', 'Fees recorded for ${r['paid']} document(s)'));
      setState(() { _sel = {}; _all = false; });
      _load();
    } catch (e) {
      if (mounted) _snack(context, e.toString());
    }
    if (mounted) setState(() => _busy = false);
  }

  Future<void> _undo() async {
    final paid = _selectedRows.where((r) => r['paid'] == true).length;
    if (paid == 0 || widget.unpayUrl == null) return;
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: Text(tr('التراجع عن الدفع', 'Undo payment')),
        content: Text(tr('إلغاء دفع رسوم $paid مستند؟ تبقى الدفعةُ في السجلّ ملغاة.', 'Void $paid payment(s)? They stay in the log as voided.')),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: Text(tr('إلغاء', 'Cancel'))),
          FilledButton(style: FilledButton.styleFrom(backgroundColor: T.danger), onPressed: () => Navigator.pop(c, true), child: Text(tr('تراجع', 'Undo'))),
        ],
      ),
    );
    if (ok != true) return;
    setState(() => _busy = true);
    try {
      final r = await Api.instance.post(widget.unpayUrl!, _target());
      if (!mounted) return;
      _snack(context, tr('أُلغي دفعُ ${(r as Map)['undone']} مستند', '${r['undone']} payment(s) voided'));
      setState(() { _sel = {}; _all = false; });
      _load();
    } catch (e) {
      if (mounted) _snack(context, e.toString());
    }
    if (mounted) setState(() => _busy = false);
  }

  Widget _chip(String label, int n, bool on, VoidCallback onTap, {Color color = T.orange}) => Padding(
        padding: const EdgeInsetsDirectional.only(end: 6),
        child: ChoiceChip(
          selected: on,
          onSelected: (_) => onTap(),
          label: Text('$label  $n', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w800, color: on ? Colors.white : T.ink)),
          selectedColor: color,
          backgroundColor: Colors.white,
          side: BorderSide(color: on ? color : T.line),
          showCheckmark: false,
        ),
      );

  @override
  Widget build(BuildContext context) {
    super.build(context);
    if (_loading && _d == null) {
      return ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(height: 90), SizedBox(height: 10), Shimmer(height: 120), SizedBox(height: 10), Shimmer(height: 120)]);
    }
    if (_d == null) return ErrorRetry(message: _error ?? '', onRetry: () { setState(() => _loading = true); _load(); });

    final counts = Map<String, dynamic>.from(_d!['counts'] as Map? ?? {});
    final w = counts['windows'];
    final docs = counts['docs'];
    final paid = counts['paid'];
    final can = Map<String, dynamic>.from(_d!['can'] as Map? ?? {});
    final canPay = can['pay'] == true && widget.payUrl != null;
    final canUndo = can['undo'] == true && widget.unpayUrl != null;
    final rows = _rows;
    final selRows = _selectedRows;
    final unpaidSel = selRows.where((r) => r['paid'] != true).length;
    final paidSel = selRows.length - unpaidSel;
    final horizon = _n(_d, 'horizon');
    final windows = [for (final x in (_d!['windows'] as List? ?? const [20, 15, 10, 5])) (x as num).toInt()];

    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(padding: const EdgeInsets.fromLTRB(12, 12, 12, 90), children: [
        SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          child: Row(children: [
            _chip(tr('الكل (منتهية + $horizon يومًا)', 'All (expired + $horizon d)'), _n(w, 'all'), _win.isEmpty, () => _refilter(() => _win = ''), color: T.navy),
            _chip(tr('منتهية', 'Expired'), _n(w, 'expired'), _win == 'expired', () => _refilter(() => _win = 'expired'), color: T.danger),
            for (final n in windows) _chip(tr('خلال $n يومًا', 'Within $n d'), _n(w, '$n'), _win == '$n', () => _refilter(() => _win = '$n')),
          ]),
        ),
        const SizedBox(height: 8),
        SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          child: Row(children: [
            _chip(tr('كل المستندات', 'All docs'), _n(docs, 'all'), _doc.isEmpty, () => _refilter(() => _doc = ''), color: T.navy),
            _chip(_docLabel('iqama'), _n(docs, 'iqama'), _doc == 'iqama', () => _refilter(() => _doc = _doc == 'iqama' ? '' : 'iqama'), color: T.navy),
            _chip(_docLabel('workPermit'), _n(docs, 'workPermit'), _doc == 'workPermit', () => _refilter(() => _doc = _doc == 'workPermit' ? '' : 'workPermit'), color: T.navy),
            const SizedBox(width: 8),
            _chip(tr('غير مدفوع', 'Unpaid'), _n(paid, 'unpaid'), _paid == 'unpaid', () => _refilter(() => _paid = _paid == 'unpaid' ? '' : 'unpaid'), color: T.navy),
            _chip(tr('مدفوع', 'Paid'), _n(paid, 'paid'), _paid == 'paid', () => _refilter(() => _paid = _paid == 'paid' ? '' : 'paid'), color: T.success),
          ]),
        ),
        const SizedBox(height: 8),
        TextField(
          onSubmitted: (v) => _refilter(() => _q = v.trim()),
          onChanged: (v) { if (v.isEmpty && _q.isNotEmpty) _refilter(() => _q = ''); },
          textInputAction: TextInputAction.search,
          decoration: InputDecoration(isDense: true, prefixIcon: const Icon(Icons.search),
              hintText: tr('ابحث بالاسم أو رقم الإقامة أو الرقم الوظيفي', 'Name, iqama or employee no.')),
        ),
        const SizedBox(height: 8),
        HrQuickFilters(
          value: _quick,
          optionsUrl: widget.optionsUrl,
          params: {if (_win.isNotEmpty) 'window': _win, if (_doc.isNotEmpty) 'doc': _doc, if (_paid.isNotEmpty) 'paid': _paid, if (_q.isNotEmpty) 'q': _q},
          onChanged: (v) => _refilter(() => _quick = v),
        ),
        const SizedBox(height: 8),
        Row(children: [
          Expanded(child: Text(tr('المعروض: ${_n(_d, 'total')} مستند · غير مدفوع ${_n(_d, 'unpaidShown')}', 'Shown: ${_n(_d, 'total')} · unpaid ${_n(_d, 'unpaidShown')}'),
              style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700, color: T.inkSoft))),
          if (_loading) const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2)),
        ]),
        if (canPay) ...[
          const SizedBox(height: 6),
          Wrap(spacing: 6, runSpacing: 6, crossAxisAlignment: WrapCrossAlignment.center, children: [
            if (!_all && rows.isNotEmpty)
              OutlinedButton(onPressed: () => setState(() { _all = true; _sel = {}; }), child: Text(tr('تحديد كلّ نتائج الفلتر (${rows.length})', 'Select all ${rows.length}'))),
            if (selRows.isNotEmpty)
              TextButton(onPressed: () => setState(() { _all = false; _sel = {}; }), child: Text(tr('إلغاء التحديد (${selRows.length})', 'Clear (${selRows.length})'))),
            FilledButton.icon(
              style: FilledButton.styleFrom(backgroundColor: T.success),
              onPressed: unpaidSel == 0 || _busy ? null : _pay,
              icon: const Icon(Icons.check_circle_outline, size: 18),
              label: Text('${tr('تمّ دفع الرسوم', 'Fees paid')}${unpaidSel > 0 ? ' ($unpaidSel)' : ''}'),
            ),
            if (canUndo)
              OutlinedButton.icon(
                style: OutlinedButton.styleFrom(foregroundColor: T.danger),
                onPressed: paidSel == 0 || _busy ? null : _undo,
                icon: const Icon(Icons.undo, size: 18),
                label: Text('${tr('تراجع', 'Undo')}${paidSel > 0 ? ' ($paidSel)' : ''}'),
              ),
          ]),
        ],
        const SizedBox(height: 8),
        if (rows.isEmpty) EmptyState(icon: Icons.badge_outlined, title: tr('لا مستنداتٍ تطابق الفلاتر', 'No documents match')),
        for (final r in rows) _row(r, canPay),
      ]),
    );
  }

  Widget _row(Map<String, dynamic> r, bool canPay) {
    final on = _all || _sel.contains(r['key']);
    final days = (r['daysLeft'] as num?)?.toInt() ?? 0;
    final expired = r['expired'] == true;
    final pay = r['payment'] is Map ? Map<String, dynamic>.from(r['payment'] as Map) : null;
    final dayColor = expired || days <= 5 ? T.danger : days <= 10 ? T.orange : T.warn;
    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      color: on ? T.orange.withValues(alpha: 0.06) : null,
      child: InkWell(
        onTap: canPay
            ? () => setState(() {
                  if (_all) { _all = false; _sel = {for (final x in _rows) x['key'] as String}..remove(r['key']); return; }
                  on ? _sel.remove(r['key']) : _sel.add(r['key'] as String);
                })
            : null,
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            if (canPay) Padding(padding: const EdgeInsetsDirectional.only(end: 6), child: Icon(on ? Icons.check_box : Icons.check_box_outline_blank, color: on ? T.orange : T.inkFaint)),
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Row(children: [
                  Expanded(
                    child: GestureDetector(
                      onTap: widget.profileLinks
                          ? () => Navigator.push(context, MaterialPageRoute(builder: (_) => HrEmployeeProfileScreen(employeeId: '${r['employeeId']}')))
                          : null,
                      child: Text('${r['name']}', style: TextStyle(fontWeight: FontWeight.w800, color: widget.profileLinks ? T.navy : T.ink)),
                    ),
                  ),
                  Chip2(_docLabel('${r['docType']}'), r['docType'] == 'iqama' ? T.info : T.violet),
                ]),
                const SizedBox(height: 3),
                Text([
                  if ('${r['employeeNumber'] ?? ''}'.isNotEmpty) '#${r['employeeNumber']}',
                  if ('${r['idNumber'] ?? ''}'.isNotEmpty) '${r['idNumber']}',
                  if ('${r['department'] ?? ''}'.isNotEmpty) '${r['department']}',
                  if ('${r['project'] ?? ''}'.isNotEmpty) '${r['project']}',
                ].join(' · '), style: const TextStyle(fontSize: 12, color: T.inkSoft)),
                const SizedBox(height: 6),
                Row(children: [
                  Text('${r['expiryDate']}', style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700)),
                  if (hijriDay(r['expiryDate']).isNotEmpty)
                    Text('  ·  ${hijriDay(r['expiryDate'])} ${tr('هـ', 'AH')}', style: const TextStyle(fontSize: 11.5, color: T.inkSoft)),
                  const Spacer(),
                  Text(expired ? tr('منتهية منذ ${-days} يوم', 'Expired ${-days}d') : tr('متبقٍّ $days يوم', '$days d left'),
                      style: TextStyle(fontSize: 12, fontWeight: FontWeight.w800, color: dayColor)),
                ]),
                const SizedBox(height: 6),
                if (pay == null)
                  Chip2(tr('غير مدفوع', 'Unpaid'), T.inkSoft)
                else ...[
                  Row(children: [
                    Chip2(tr('مدفوع', 'Paid'), T.success, icon: Icons.check_circle),
                    const SizedBox(width: 6),
                    Expanded(child: Text('${pay['paidByName'] ?? ''} · ${_stamp(pay['paidAt'])}${pay['amount'] != null ? ' · ${pay['amount']} ${tr('ر.س', 'SAR')}' : ''}',
                        style: const TextStyle(fontSize: 11.5, color: T.inkSoft))),
                  ]),
                  if ('${pay['note'] ?? ''}'.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 4), child: Text('${pay['note']}', style: const TextStyle(fontSize: 12))),
                  if ((pay['files'] as List? ?? const []).isNotEmpty) Padding(padding: const EdgeInsets.only(top: 4), child: _files(pay['files'] as List)),
                ],
              ]),
            ),
          ]),
        ),
      ),
    );
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  طلباتُ الموارد البشريّة إلى الماليّة
// ═══════════════════════════════════════════════════════════════════════════
const _reqStatus = {
  'pending': ('قيد الانتظار', 'Pending', T.warn),
  'done': ('تمّ', 'Done', T.success),
  'not_done': ('لم يتمّ', 'Not done', T.danger),
};

class HrFinanceRequestsView extends StatefulWidget {
  final bool finance;
  final String listUrl;
  final String? createUrl;
  final String? answerUrl;
  const HrFinanceRequestsView({super.key, required this.finance, required this.listUrl, this.createUrl, this.answerUrl});
  @override
  State<HrFinanceRequestsView> createState() => _HrFinanceRequestsViewState();
}

class _HrFinanceRequestsViewState extends State<HrFinanceRequestsView> with AutomaticKeepAliveClientMixin {
  @override
  bool get wantKeepAlive => true;

  late String _status = widget.finance ? 'pending' : '';
  String _q = '';
  List<Map<String, dynamic>> _rows = [];
  Map<String, dynamic> _counts = {};
  Map<String, dynamic> _can = {};
  bool _loading = true;
  String? _error;
  int _seq = 0;
  late final void Function() _onLive;

  @override
  void initState() {
    super.initState();
    _load();
    _onLive = () => _load();
    Live.instance.on('hr-finance:changed', _onLive);
  }

  @override
  void dispose() {
    Live.instance.off('hr-finance:changed', _onLive);
    super.dispose();
  }

  Future<void> _load() async {
    final mine = ++_seq;
    try {
      final p = <String>[if (_status.isNotEmpty) 'status=$_status', if (_q.isNotEmpty) 'q=${Uri.encodeComponent(_q)}'];
      final d = await Api.instance.get('${widget.listUrl}${p.isEmpty ? '' : '?${p.join('&')}'}');
      if (!mounted || mine != _seq) return;
      setState(() {
        _rows = List<Map<String, dynamic>>.from(((d as Map)['requests'] as List? ?? const []).map((e) => Map<String, dynamic>.from(e as Map)));
        _counts = Map<String, dynamic>.from(d['counts'] as Map? ?? {});
        _can = Map<String, dynamic>.from(d['can'] as Map? ?? {});
        _loading = false;
        _error = null;
      });
    } catch (e) {
      if (mounted && mine == _seq) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  Future<void> _answer(Map<String, dynamic> r, String status) async {
    final note = TextEditingController(text: r['status'] != 'pending' ? '${r['answerNote'] ?? ''}' : '');
    final files = <PickedFile>[];
    String st = status;
    final go = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      builder: (c) => StatefulBuilder(builder: (c, setSt) => SafeArea(
        child: Padding(
          padding: EdgeInsets.fromLTRB(16, 16, 16, MediaQuery.of(c).viewInsets.bottom + 16),
          child: SingleChildScrollView(
            child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              Text(tr('الرد على الطلب #${r['number']}', 'Answer request #${r['number']}'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16)),
              const SizedBox(height: 10),
              Row(children: [
                for (final s in ['done', 'not_done'])
                  Expanded(
                    child: Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 3),
                      child: ChoiceChip(
                        selected: st == s,
                        onSelected: (_) => setSt(() => st = s),
                        label: SizedBox(width: double.infinity, child: Text(tr(_reqStatus[s]!.$1, _reqStatus[s]!.$2), textAlign: TextAlign.center,
                            style: TextStyle(fontWeight: FontWeight.w800, color: st == s ? Colors.white : T.ink))),
                        selectedColor: _reqStatus[s]!.$3,
                        showCheckmark: false,
                      ),
                    ),
                  ),
              ]),
              const SizedBox(height: 10),
              TextField(controller: note, maxLines: 3, decoration: InputDecoration(labelText: tr('ملاحظة (اختياري)', 'Note (optional)'))),
              const SizedBox(height: 8),
              Wrap(spacing: 6, runSpacing: 6, children: [
                for (final f in files) Chip(label: Text(f.fileName, style: const TextStyle(fontSize: 12)), onDeleted: () => setSt(() => files.remove(f))),
                ActionChip(
                  avatar: const Icon(Icons.attach_file, size: 16),
                  label: Text(tr('إرفاق ملفات', 'Attach files')),
                  onPressed: () async { final got = await pickFilesAsDataUrls(); setSt(() => files.addAll(got)); },
                ),
              ]),
              const SizedBox(height: 14),
              Row(children: [
                TextButton(onPressed: () => Navigator.pop(c, false), child: Text(tr('إلغاء', 'Cancel'))),
                const Spacer(),
                FilledButton(onPressed: () => Navigator.pop(c, true), child: Text(tr('حفظ الرد', 'Save answer'))),
              ]),
            ]),
          ),
        ),
      )),
    );
    if (go != true || widget.answerUrl == null) return;
    try {
      await Api.instance.patch('${widget.answerUrl}/${r['_id']}', {
        'status': st, 'note': note.text.trim(),
        'files': [for (final f in files) {'dataUrl': f.dataUrl, 'fileName': f.fileName}],
      });
      if (mounted) _snack(context, tr('حُفظ الرد', 'Answer saved'));
      _load();
    } catch (e) {
      if (mounted) _snack(context, e.toString());
    }
  }

  Future<void> _create() async {
    if (widget.createUrl == null) return;
    List<Map<String, dynamic>> emps = [];
    bool loadingEmps = false;
    final search = TextEditingController();
    final picked = <Map<String, dynamic>>[];
    final notes = <String, TextEditingController>{};
    final files = <PickedFile>[];
    final go = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      builder: (c) => StatefulBuilder(builder: (c, setSt) {
        if (emps.isEmpty && !loadingEmps) {
          loadingEmps = true;
          Api.instance.get('/api/hr/employees-search?limit=2000').then((d) {
            emps = List<Map<String, dynamic>>.from(((d as Map)['employees'] as List? ?? const []).map((e) => Map<String, dynamic>.from(e as Map)));
            if (c.mounted) setSt(() {});
          }).catchError((e) { if (c.mounted) _snack(c, e.toString()); });
        }
        final q = search.text.trim().toLowerCase();
        final shown = q.isEmpty
            ? <Map<String, dynamic>>[]
            : emps.where((e) => !picked.any((p) => p['_id'] == e['_id']) && [e['arabicName'], e['firstName'], e['lastName'], e['employeeNumber'], e['iqamaNumber'], e['nationalId']]
                .any((v) => (v ?? '').toString().toLowerCase().contains(q))).take(25).toList();
        String nm(Map e) => (e['arabicName'] ?? '${e['firstName'] ?? ''} ${e['lastName'] ?? ''}').toString().trim();
        return SafeArea(
          child: Padding(
            padding: EdgeInsets.fromLTRB(14, 14, 14, MediaQuery.of(c).viewInsets.bottom + 14),
            child: SingleChildScrollView(
              child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                Text(tr('طلب جديد إلى الإدارة المالية', 'New request to Finance'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16)),
                const SizedBox(height: 10),
                TextField(
                  controller: search,
                  onChanged: (_) => setSt(() {}),
                  decoration: InputDecoration(
                    labelText: tr('أضِف موظفًا', 'Add an employee'),
                    hintText: tr('ابحث بالاسم أو الإقامة أو الرقم الوظيفي…', 'name, iqama or number…'),
                    prefixIcon: const Icon(Icons.search),
                  ),
                ),
                for (final e in shown)
                  ListTile(
                    dense: true,
                    title: Text(nm(e)),
                    subtitle: Text([
                      if ('${e['employeeNumber'] ?? ''}'.isNotEmpty) '#${e['employeeNumber']}',
                      if ('${e['iqamaNumber'] ?? e['nationalId'] ?? ''}'.isNotEmpty) '${e['iqamaNumber'] ?? e['nationalId']}',
                      if ('${e['department'] ?? ''}'.isNotEmpty) '${e['department']}',
                    ].join(' · ')),
                    trailing: const Icon(Icons.add_circle_outline),
                    onTap: () => setSt(() { picked.add(e); notes['${e['_id']}'] = TextEditingController(); search.clear(); }),
                  ),
                const SizedBox(height: 6),
                for (final e in picked)
                  Card(
                    margin: const EdgeInsets.only(bottom: 8),
                    child: Padding(
                      padding: const EdgeInsets.fromLTRB(10, 4, 4, 10),
                      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                        Row(children: [
                          Expanded(child: Text('${nm(e)}${'${e['employeeNumber'] ?? ''}'.isNotEmpty ? '  #${e['employeeNumber']}' : ''}', style: const TextStyle(fontWeight: FontWeight.w800))),
                          IconButton(icon: const Icon(Icons.close, size: 18), onPressed: () => setSt(() { picked.remove(e); notes.remove('${e['_id']}'); })),
                        ]),
                        TextField(controller: notes['${e['_id']}'], maxLines: 2,
                            decoration: InputDecoration(isDense: true, hintText: tr('ما المطلوب له من المالية؟', 'What is needed for him?'))),
                      ]),
                    ),
                  ),
                Wrap(spacing: 6, runSpacing: 6, children: [
                  for (final f in files) Chip(label: Text(f.fileName, style: const TextStyle(fontSize: 12)), onDeleted: () => setSt(() => files.remove(f))),
                  ActionChip(
                    avatar: const Icon(Icons.attach_file, size: 16),
                    label: Text(tr('إرفاق ملفات (اختياري)', 'Attach files (optional)')),
                    onPressed: () async { final got = await pickFilesAsDataUrls(); setSt(() => files.addAll(got)); },
                  ),
                ]),
                const SizedBox(height: 14),
                Row(children: [
                  TextButton(onPressed: () => Navigator.pop(c, false), child: Text(tr('إلغاء', 'Cancel'))),
                  const Spacer(),
                  FilledButton.icon(
                    onPressed: () => Navigator.pop(c, true),
                    icon: const Icon(Icons.send_outlined, size: 18),
                    label: Text(tr('إرسال', 'Send')),
                  ),
                ]),
              ]),
            ),
          ),
        );
      }),
    );
    if (go != true) return;
    if (picked.isEmpty) { if (mounted) _snack(context, tr('اختر موظّفًا واحدًا على الأقلّ', 'Pick at least one employee')); return; }
    if (picked.any((e) => (notes['${e['_id']}']?.text.trim() ?? '').isEmpty)) {
      if (mounted) _snack(context, tr('اكتب أمامَ كلّ موظّفٍ ما تحتاجه له', 'Write what is needed for each employee'));
      return;
    }
    try {
      await Api.instance.postLong(widget.createUrl!, {
        'items': [for (final e in picked) {'employee': e['_id'], 'note': notes['${e['_id']}']!.text.trim()}],
        'files': [for (final f in files) {'dataUrl': f.dataUrl, 'fileName': f.fileName}],
      });
      if (mounted) _snack(context, tr('أُرسل الطلبُ إلى الإدارة المالية', 'Sent to Finance'));
      _load();
    } catch (e) {
      if (mounted) _snack(context, e.toString());
    }
  }

  @override
  Widget build(BuildContext context) {
    super.build(context);
    if (_loading) {
      return ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(height: 60), SizedBox(height: 10), Shimmer(height: 140)]);
    }
    if (_error != null) return ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); });
    final canCreate = _can['create'] == true && widget.createUrl != null;
    final canAnswer = _can['answer'] == true && widget.answerUrl != null;
    return Stack(children: [
      RefreshIndicator(
        onRefresh: _load,
        child: ListView(padding: const EdgeInsets.fromLTRB(12, 12, 12, 90), children: [
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: Row(children: [
              for (final s in [('', 'الكل', 'All', 'all'), ('pending', 'قيد الانتظار', 'Pending', 'pending'), ('done', 'تمّ', 'Done', 'done'), ('not_done', 'لم يتمّ', 'Not done', 'not_done')])
                Padding(
                  padding: const EdgeInsetsDirectional.only(end: 6),
                  child: ChoiceChip(
                    selected: _status == s.$1,
                    onSelected: (_) { setState(() => _status = s.$1); _load(); },
                    label: Text('${tr(s.$2, s.$3)}  ${(_counts[s.$4] as num?)?.toInt() ?? 0}',
                        style: TextStyle(fontSize: 12, fontWeight: FontWeight.w800, color: _status == s.$1 ? Colors.white : T.ink)),
                    selectedColor: T.navy,
                    backgroundColor: Colors.white,
                    showCheckmark: false,
                  ),
                ),
            ]),
          ),
          const SizedBox(height: 8),
          TextField(
            onSubmitted: (v) { _q = v.trim(); _load(); },
            onChanged: (v) { if (v.isEmpty && _q.isNotEmpty) { _q = ''; _load(); } },
            textInputAction: TextInputAction.search,
            decoration: InputDecoration(isDense: true, prefixIcon: const Icon(Icons.search),
                hintText: tr('ابحث برقم الطلب أو اسم موظف أو رقم إقامته', 'Request no., employee or iqama')),
          ),
          const SizedBox(height: 10),
          if (_rows.isEmpty) EmptyState(icon: Icons.inbox_outlined, title: tr('لا طلباتَ هنا', 'No requests here')),
          for (final r in _rows) _card(r, canAnswer),
        ]),
      ),
      if (canCreate)
        PositionedDirectional(
          end: 16, bottom: 16,
          child: FloatingActionButton.extended(
            heroTag: 'hrfr-new',
            onPressed: _create,
            icon: const Icon(Icons.add),
            label: Text(tr('طلب جديد للمالية', 'New request')),
          ),
        ),
    ]);
  }

  Widget _card(Map<String, dynamic> r, bool canAnswer) {
    final st = _reqStatus['${r['status']}'] ?? _reqStatus['pending']!;
    final items = List<Map<String, dynamic>>.from((r['items'] as List? ?? const []).map((e) => Map<String, dynamic>.from(e as Map)));
    final files = r['files'] as List? ?? const [];
    final ansFiles = r['answerFiles'] as List? ?? const [];
    return Card(
      margin: const EdgeInsets.only(bottom: 10),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            Text('#${r['number'] ?? '—'}', style: const TextStyle(fontSize: 11, color: T.inkFaint)),
            const SizedBox(width: 6),
            Chip2(tr(st.$1, st.$2), st.$3),
            const SizedBox(width: 6),
            Text('${items.length} ${tr('موظف', 'employees')}', style: const TextStyle(fontSize: 11.5, color: T.inkSoft)),
          ]),
          const SizedBox(height: 4),
          Text('${tr('من', 'From')} ${r['createdByName'] ?? '—'} · ${_stamp(r['createdAt'])}', style: const TextStyle(fontSize: 11, color: T.inkFaint)),
          const Divider(height: 16),
          for (final it in items)
            Padding(
              padding: const EdgeInsets.only(bottom: 6),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text('${it['name']}${'${it['employeeNumber'] ?? ''}'.isNotEmpty ? '  #${it['employeeNumber']}' : ''}${'${it['idNumber'] ?? ''}'.isNotEmpty ? '  · ${it['idNumber']}' : ''}',
                    style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13)),
                Text('${it['note'] ?? ''}', style: const TextStyle(fontSize: 12.5)),
              ]),
            ),
          if (files.isNotEmpty) ...[
            const SizedBox(height: 4),
            Text(tr('مرفقات الموارد البشرية', 'HR attachments'), style: const TextStyle(fontSize: 11, color: T.inkSoft)),
            _files(files),
          ],
          if (r['status'] != 'pending') ...[
            const SizedBox(height: 8),
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(8),
              decoration: BoxDecoration(color: st.$3.withValues(alpha: 0.07), borderRadius: BorderRadius.circular(8)),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text('${tr('ردّ الإدارة المالية', 'Finance reply')} · ${r['answeredByName'] ?? '—'} · ${_stamp(r['answeredAt'])}',
                    style: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.w700)),
                if ('${r['answerNote'] ?? ''}'.isNotEmpty) Text('${r['answerNote']}', style: const TextStyle(fontSize: 12.5)),
                if (ansFiles.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 4), child: _files(ansFiles)),
              ]),
            ),
          ],
          if (canAnswer) ...[
            const SizedBox(height: 8),
            Wrap(spacing: 6, children: [
              FilledButton.icon(
                style: FilledButton.styleFrom(backgroundColor: T.success),
                onPressed: () => _answer(r, 'done'),
                icon: const Icon(Icons.check, size: 16),
                label: Text(tr('تمّ', 'Done')),
              ),
              OutlinedButton.icon(
                style: OutlinedButton.styleFrom(foregroundColor: T.danger),
                onPressed: () => _answer(r, 'not_done'),
                icon: const Icon(Icons.close, size: 16),
                label: Text(tr('لم يتمّ', 'Not done')),
              ),
            ]),
          ],
        ]),
      ),
    );
  }
}
