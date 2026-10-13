import 'dart:async';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../services/api.dart';
import '../services/auth.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';

/// عهدةُ النقل الخفيف — الكاش، وكارت المشتريات، والورشة.
///
/// ثلاثةُ حساباتٍ في أعلى الشاشة، ولكلٍّ واردُه وصادرُه ورصيدُه. والقواعدُ في
/// الخادم (`/api/light-transport/custody`) وتصل هنا في `rules`: الشاشةُ ترسم
/// ما يُسمَح به ولا تعيد كتابتَه. مطابقةٌ لشاشة الموقع
/// `/system/b2c/light-transport/custody`.

const _editRoles = {'super_admin', 'admin', 'b2c_manager', 'b2c_project_lead', 'it_manager', 'cfo', 'accounting_manager', 'accountant'};

const _accounts = [
  ('cash', 'الكاش', 'Cash', Icons.payments_outlined),
  ('card', 'الكارت', 'Card', Icons.credit_card),
  ('workshop', 'الورشة', 'Workshop', Icons.build_outlined),
];

const _word = {
  'cash': ('الكاش', 'Cash'), 'card': ('الكارت', 'Card'), 'workshop': ('الورشة', 'Workshop'),
  'bank': ('البنك', 'Bank'), 'maintenance': ('الصيانة', 'Maintenance'), 'rep': ('مندوب', 'Rep'), 'company': ('الشركة', 'Company'),
};
String _w(dynamic k) { final x = _word[k?.toString()]; return x == null ? (k ?? '').toString() : tr(x.$1, x.$2); }

num _num(dynamic v) => (v is num) ? v : num.tryParse(v?.toString() ?? '') ?? 0;
String _money(dynamic v) {
  final s = _num(v).toStringAsFixed(2).split('.');
  return '${s[0].replaceAllMapped(RegExp(r'\B(?=(\d{3})+(?!\d))'), (m) => ',')}.${s[1]}';
}
String _date(dynamic v) { final s = (v ?? '').toString(); return s.length >= 10 ? s.substring(0, 10).split('-').reversed.join('/') : '—'; }
String _ymd(DateTime d) => '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';

class LtCustodyScreen extends StatefulWidget {
  const LtCustodyScreen({super.key});
  @override
  State<LtCustodyScreen> createState() => _LtCustodyScreenState();
}

class _LtCustodyScreenState extends State<LtCustodyScreen> {
  Map<String, dynamic>? _d;
  String _account = 'cash';
  String _direction = '';
  String _q = '';
  DateTimeRange? _range;
  String? _error;
  int _seq = 0;
  Timer? _debounce;
  late final void Function() _onLive;

  @override
  void initState() {
    super.initState();
    _load();
    _onLive = () => _load();
    Live.instance.on('lt:custody', _onLive);
  }

  @override
  void dispose() {
    Live.instance.off('lt:custody', _onLive);
    _debounce?.cancel();
    super.dispose();
  }

  Future<void> _load() async {
    // آخرُ طلبٍ هو الذي يُعرَض: الفلترُ الأوسعُ أبطأ، وجوابُه يصل بعد الأضيق.
    final mine = ++_seq;
    final p = <String, String>{
      'account': _account,
      if (_direction.isNotEmpty) 'direction': _direction,
      if (_q.trim().isNotEmpty) 'q': _q.trim(),
      if (_range != null) 'from': _ymd(_range!.start),
      if (_range != null) 'to': _ymd(_range!.end),
    };
    try {
      final d = await Api.instance.get('/api/light-transport/custody?${Uri(queryParameters: p).query}');
      if (!mounted || mine != _seq) return;
      setState(() { _d = Map<String, dynamic>.from(d as Map); _error = null; });
    } catch (e) {
      if (mounted && mine == _seq) setState(() => _error = e.toString());
    }
  }

  bool get _canEdit {
    final auth = context.read<AuthProvider>();
    return _editRoles.contains(auth.role) || auth.canEditSection('B2C');
  }

  String _party(Map e) {
    if (e['direction'] == 'in') return '${tr('من', 'From')} ${_w(e['source'])}';
    if (e['target'] == 'rep') return '${tr('مندوب', 'Rep')}: ${e['repName'] ?? ''}';
    if (e['target'] == 'company') return tr('الشركة', 'Company');
    return '${tr('إلى', 'To')} ${_w(e['target'])}';
  }

  Future<void> _delete(Map e) async {
    final transfer = e['transferId'] != null;
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: Text(tr('حذف هذا القيد؟', 'Delete this entry?')),
        content: Text(transfer
            ? tr('هذا تحويلٌ بين حسابين — يُحذَف طرفاه معًا ويعود الرصيدان كما كانا.', 'This is a transfer — both sides are removed.')
            : tr('يُحذَف القيدُ ويتغيّر رصيدُ الحساب. يُقيَّد الحذفُ باسمك.', 'The entry is removed and the balance changes. Recorded under your name.')),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: Text(tr('إلغاء', 'Cancel'))),
          FilledButton(style: FilledButton.styleFrom(backgroundColor: T.danger), onPressed: () => Navigator.pop(c, true), child: Text(tr('حذف', 'Delete'))),
        ],
      ),
    );
    if (ok != true) return;
    try { await Api.instance.delete('/api/light-transport/custody/${e['_id']}'); _load(); }
    catch (err) { if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(err.toString()))); }
  }

  Future<void> _open(String direction) async {
    final rules = Map<String, dynamic>.from(_d!['rules'] as Map);
    final saved = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (c) => _EntrySheet(account: _account, direction: direction, rules: rules, today: (_d!['today'] ?? _ymd(DateTime.now())).toString()),
    );
    if (saved == true) _load();
  }

  Future<void> _pickRange() async {
    final now = DateTime.now();
    final r = await showDateRangePicker(context: context, firstDate: DateTime(2024), lastDate: DateTime(now.year + 1), initialDateRange: _range);
    if (r != null) { setState(() => _range = r); _load(); }
  }

  @override
  Widget build(BuildContext context) {
    final d = _d;
    final canEdit = _canEdit;
    return AppScaffold(
      title: Text(tr('عهدة النقل الخفيف', 'Light Transport Custody')),
      body: d == null
          ? (_error != null
              ? ErrorRetry(message: _error!, onRetry: () { setState(() => _error = null); _load(); })
              : ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(height: 90), SizedBox(height: 10), Shimmer(), SizedBox(height: 10), Shimmer()]))
          : RefreshIndicator(onRefresh: _load, child: _body(d, canEdit)),
    );
  }

  Widget _body(Map<String, dynamic> d, bool canEdit) {
    final balances = Map<String, dynamic>.from(d['balances'] as Map);
    final rules = Map<String, dynamic>.from(d['rules'] as Map);
    final entries = List<Map<String, dynamic>>.from((d['entries'] as List).map((e) => Map<String, dynamic>.from(e as Map)));
    final shown = Map<String, dynamic>.from(d['shown'] as Map);
    final canDelete = d['canDelete'] == true;
    final sources = List.from((rules['inSources'] as Map)[_account] ?? const []);
    final toCash = List.from(rules['toCash'] ?? const []).contains(_account);
    return ListView(padding: const EdgeInsets.all(14), children: [
      // ── الحساباتُ الثلاثة بالعرض ──────────────────────────────────────────
      Row(children: [
        for (final a in _accounts) ...[
          Expanded(child: _accountCard(a, Map<String, dynamic>.from(balances[a.$1] as Map))),
          if (a.$1 != 'workshop') const SizedBox(width: 8),
        ],
      ]),
      const SizedBox(height: 6),
      Text(
        '${tr('واردُه من', 'In from')}: ${sources.map(_w).join(tr('، ', ', '))}${toCash ? tr(' · ويصرف إلى الكاش', ' · can pay out to cash') : ''}',
        style: const TextStyle(fontSize: 11, color: T.inkFaint),
      ),
      if (canEdit) ...[
        const SizedBox(height: 10),
        Row(children: [
          Expanded(child: FilledButton.icon(
            style: FilledButton.styleFrom(backgroundColor: T.success),
            onPressed: () => _open('in'), icon: const Icon(Icons.south_west, size: 18), label: Text(tr('وارد (In)', 'In')),
          )),
          const SizedBox(width: 8),
          Expanded(child: FilledButton.icon(
            onPressed: () => _open('out'), icon: const Icon(Icons.north_east, size: 18), label: Text(tr('صادر (Out)', 'Out')),
          )),
        ]),
      ],
      const SizedBox(height: 12),
      // ── الفلاتر ───────────────────────────────────────────────────────────
      TextField(
        onChanged: (v) { _q = v; _debounce?.cancel(); _debounce = Timer(const Duration(milliseconds: 350), _load); },
        decoration: InputDecoration(hintText: tr('اسم المندوب، رقم الإقامة، البيان…', 'Rep name, ID no., detail…'), prefixIcon: const Icon(Icons.search), isDense: true),
      ),
      const SizedBox(height: 8),
      Wrap(spacing: 6, runSpacing: 6, crossAxisAlignment: WrapCrossAlignment.center, children: [
        for (final o in [('', tr('الكلّ', 'All')), ('in', tr('وارد', 'In')), ('out', tr('صادر', 'Out'))])
          ChoiceChip(label: Text(o.$2), selected: _direction == o.$1, onSelected: (_) { setState(() => _direction = o.$1); _load(); }),
        ActionChip(
          avatar: const Icon(Icons.date_range, size: 16),
          label: Text(_range == null ? tr('كلّ المدّة', 'All time') : '${_date(_ymd(_range!.start))} – ${_date(_ymd(_range!.end))}'),
          onPressed: _pickRange,
        ),
        if (_range != null) IconButton(visualDensity: VisualDensity.compact, icon: const Icon(Icons.close, size: 18), onPressed: () { setState(() => _range = null); _load(); }),
      ]),
      const SizedBox(height: 10),
      Row(children: [
        Text('${tr('القيود', 'Entries')} (${entries.length})', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14.5)),
        const Spacer(),
        Text('${tr('وارد', 'In')} ${_money(shown['in'])}', style: const TextStyle(fontSize: 11.5, color: T.success, fontWeight: FontWeight.w700)),
        const SizedBox(width: 10),
        Text('${tr('صادر', 'Out')} ${_money(shown['out'])}', style: const TextStyle(fontSize: 11.5, color: T.danger, fontWeight: FontWeight.w700)),
      ]),
      const SizedBox(height: 8),
      if (entries.isEmpty) EmptyState(icon: Icons.receipt_long_outlined, title: tr('لا قيودَ في هذا العرض', 'No entries in this view')),
      ...entries.map((e) {
        final isIn = e['direction'] == 'in';
        final color = isIn ? T.success : T.danger;
        final sub = [
          _date(e['date']),
          if (e['target'] == 'rep') ...[e['repIdNumber'], e['repNationality'], e['repProject']],
          if (e['transferId'] != null) tr('تحويل', 'transfer'),
          e['createdByName'],
        ].where((x) => x != null && x.toString().isNotEmpty).join(' · ');
        return Padding(
          padding: const EdgeInsets.only(bottom: 8),
          child: AppCard(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
            child: Row(children: [
              Container(
                padding: const EdgeInsets.all(8),
                decoration: BoxDecoration(color: color.withValues(alpha: 0.1), borderRadius: BorderRadius.circular(10)),
                child: Icon(isIn ? Icons.south_west : Icons.north_east, size: 17, color: color),
              ),
              const SizedBox(width: 10),
              Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(_party(e), style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 12.5)),
                if ((e['detail'] ?? '').toString().isNotEmpty) Text(e['detail'].toString(), style: const TextStyle(fontSize: 11.5, color: T.inkSoft)),
                Text(sub, style: const TextStyle(fontSize: 10.5, color: T.inkFaint)),
              ])),
              Text('${isIn ? '+' : '−'}${_money(e['amount'])}', style: TextStyle(fontWeight: FontWeight.w900, fontSize: 13.5, color: color)),
              if (canDelete) IconButton(visualDensity: VisualDensity.compact, icon: const Icon(Icons.delete_outline, size: 18, color: T.inkFaint), onPressed: () => _delete(e)),
            ]),
          ),
        );
      }),
      const SizedBox(height: 20),
    ]);
  }

  Widget _accountCard((String, String, String, IconData) a, Map<String, dynamic> b) {
    final on = _account == a.$1;
    final bal = _num(b['balance']);
    return Pressable(
      onTap: () { setState(() => _account = a.$1); _load(); },
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 10),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: on ? T.orange : const Color(0xFFE2E8F0), width: on ? 2 : 1),
        ),
        child: Column(children: [
          Icon(a.$4, size: 20, color: on ? T.orange : T.inkSoft),
          const SizedBox(height: 4),
          Text(tr(a.$2, a.$3), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 12.5)),
          const SizedBox(height: 4),
          FittedBox(child: Text(_money(bal), style: TextStyle(fontWeight: FontWeight.w900, fontSize: 15, color: bal < 0 ? T.danger : T.navy))),
          const SizedBox(height: 2),
          FittedBox(child: Text('${tr('وارد', 'In')} ${_money(b['in'])}', style: const TextStyle(fontSize: 10, color: T.success))),
          FittedBox(child: Text('${tr('صادر', 'Out')} ${_money(b['out'])}', style: const TextStyle(fontSize: 10, color: T.danger))),
        ]),
      ),
    );
  }
}

/// نموذجُ القيد: واردٌ (من أين) أو صادرٌ (إلى مَن) — بأقلّ ما يُكتب.
class _EntrySheet extends StatefulWidget {
  final String account, direction, today;
  final Map<String, dynamic> rules;
  const _EntrySheet({required this.account, required this.direction, required this.rules, required this.today});
  @override
  State<_EntrySheet> createState() => _EntrySheetState();
}

class _EntrySheetState extends State<_EntrySheet> {
  final _amount = TextEditingController();
  final _id = TextEditingController();
  final _detail = TextEditingController();
  late String _date = widget.today;
  late final List<String> _sources = List<String>.from((widget.rules['inSources'] as Map)[widget.account] ?? const []);
  late final List<String> _targets = ['rep', 'company', if (List.from(widget.rules['toCash'] ?? const []).contains(widget.account)) 'cash'];
  late String _source = _sources.length == 1 ? _sources.first : '';
  String _target = 'rep';
  Map<String, dynamic>? _rep;
  String _repState = '';
  bool _saving = false;
  Timer? _timer;
  int _seq = 0;

  bool get _isIn => widget.direction == 'in';

  @override
  void dispose() { _timer?.cancel(); _amount.dispose(); _id.dispose(); _detail.dispose(); super.dispose(); }

  // رقمُ الإقامة يُكتب فتأتي بياناتُ المندوب من الموارد البشريّة — بلا زرّ بحث.
  void _lookup(String raw) {
    final id = raw.replaceAll(RegExp(r'\s+'), '');
    _timer?.cancel();
    final mine = ++_seq;
    setState(() { _rep = null; _repState = id.length < 8 ? '' : 'loading'; });
    if (id.length < 8) return;
    _timer = Timer(const Duration(milliseconds: 350), () async {
      try {
        final r = await Api.instance.get('/api/light-transport/custody/rep?id=${Uri.encodeQueryComponent(id)}');
        if (mounted && mine == _seq) setState(() { _rep = Map<String, dynamic>.from(r['rep'] as Map); _repState = ''; });
      } catch (_) {
        if (mounted && mine == _seq) setState(() => _repState = 'missing');
      }
    });
  }

  void _say(String m) => ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(m)));

  Future<void> _save() async {
    final amount = num.tryParse(_amount.text.trim()) ?? 0;
    final detail = _detail.text.trim();
    if (amount <= 0) return _say(tr('اكتب المبلغ', 'Enter the amount'));
    if (_isIn && _source.isEmpty) return _say(tr('اختر مصدرَ الوارد', 'Pick where it came from'));
    if (!_isIn && _target == 'rep' && _rep == null) return _say(tr('اكتب رقمَ إقامة المندوب', 'Enter the rep’s ID number'));
    if (!_isIn && _target == 'company' && detail.isEmpty) return _say(tr('اكتب البيان: ما الصرف؟', 'Enter what it was spent on'));
    setState(() => _saving = true);
    try {
      await Api.instance.post('/api/light-transport/custody', {
        'account': widget.account, 'direction': widget.direction, 'amount': amount, 'date': _date, 'detail': detail,
        if (_isIn) 'source': _source,
        if (!_isIn) 'target': _target,
        if (!_isIn && _target == 'rep') 'repIdNumber': _rep!['idNumber'],
      });
      if (mounted) Navigator.pop(context, true);
    } catch (e) {
      if (mounted) { setState(() => _saving = false); _say(e.toString()); }
    }
  }

  Future<void> _pickDate() async {
    final cur = DateTime.tryParse(_date) ?? DateTime.now();
    final d = await showDatePicker(context: context, firstDate: DateTime(2024), lastDate: DateTime(cur.year + 1), initialDate: cur);
    if (d != null) setState(() => _date = _ymd(d));
  }

  @override
  Widget build(BuildContext context) {
    final acc = _w(widget.account);
    final transfer = _isIn ? (_source == 'card' || _source == 'workshop') : _target == 'cash';
    final needDetail = !_isIn && _target == 'company';
    return SafeArea(
      child: SingleChildScrollView(
        padding: EdgeInsets.fromLTRB(16, 16, 16, MediaQuery.of(context).viewInsets.bottom + 16),
        child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(_isIn ? tr('وارد إلى $acc', 'In to $acc') : tr('صادر من $acc', 'Out from $acc'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
          const SizedBox(height: 12),
          Row(children: [
            Expanded(child: TextField(
              controller: _amount, autofocus: true,
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              decoration: InputDecoration(labelText: tr('المبلغ (ر.س) *', 'Amount (SAR) *')),
            )),
            const SizedBox(width: 10),
            OutlinedButton.icon(onPressed: _pickDate, icon: const Icon(Icons.event, size: 16), label: Text(_dateLabel(_date))),
          ]),
          const SizedBox(height: 12),
          if (_isIn) ...[
            Text(tr('الوارد من *', 'In from *'), style: const TextStyle(fontSize: 12, color: T.inkSoft, fontWeight: FontWeight.w700)),
            const SizedBox(height: 6),
            Wrap(spacing: 6, children: [
              for (final s in _sources) ChoiceChip(label: Text(_w(s)), selected: _source == s, onSelected: (_) => setState(() => _source = s)),
            ]),
          ] else ...[
            Text(tr('المتحمِّل *', 'Bearer *'), style: const TextStyle(fontSize: 12, color: T.inkSoft, fontWeight: FontWeight.w700)),
            const SizedBox(height: 6),
            Wrap(spacing: 6, children: [
              for (final k in _targets)
                ChoiceChip(label: Text(k == 'cash' ? tr('إلى الكاش', 'To cash') : _w(k)), selected: _target == k, onSelected: (_) => setState(() => _target = k)),
            ]),
            if (_target == 'rep') ...[
              const SizedBox(height: 10),
              TextField(
                controller: _id, onChanged: _lookup, keyboardType: TextInputType.number, textDirection: TextDirection.ltr,
                decoration: InputDecoration(labelText: tr('رقم إقامة المندوب *', 'Rep ID number *'), hintText: '2xxxxxxxxx'),
              ),
              if (_repState == 'loading') Padding(padding: const EdgeInsets.only(top: 6), child: Text(tr('يُبحَث في الموارد البشريّة…', 'Looking up HR…'), style: const TextStyle(fontSize: 11.5, color: T.inkFaint))),
              if (_repState == 'missing') Padding(padding: const EdgeInsets.only(top: 6), child: Text(tr('لا مندوبَ بهذا الرقم في الموارد البشريّة ولا في سجلّ النقل الخفيف.', 'No rep with this number in HR or the light-transport register.'), style: const TextStyle(fontSize: 11.5, color: T.danger, fontWeight: FontWeight.w700))),
              if (_rep != null) Container(
                width: double.infinity,
                margin: const EdgeInsets.only(top: 8),
                padding: const EdgeInsets.all(10),
                decoration: BoxDecoration(color: T.success.withValues(alpha: 0.08), borderRadius: BorderRadius.circular(12), border: Border.all(color: T.success.withValues(alpha: 0.3))),
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Row(children: [const Icon(Icons.verified_user_outlined, size: 16, color: T.success), const SizedBox(width: 6), Expanded(child: Text((_rep!['name'] ?? '').toString(), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13)))]),
                  const SizedBox(height: 2),
                  Text([
                    if ((_rep!['nationality'] ?? '').toString().isNotEmpty) '${tr('الجنسية', 'Nationality')}: ${_rep!['nationality']}',
                    if ((_rep!['project'] ?? '').toString().isNotEmpty) '${tr('المشروع', 'Project')}: ${_rep!['project']}',
                    if ((_rep!['jobTitle'] ?? '').toString().isNotEmpty) _rep!['jobTitle'].toString(),
                    if ((_rep!['employeeNumber'] ?? '').toString().isNotEmpty) '${tr('الرقم الوظيفي', 'Emp. no.')}: ${_rep!['employeeNumber']}',
                  ].join(' · '), style: const TextStyle(fontSize: 11.5, color: T.inkSoft)),
                  if (_rep!['status'] == 'terminated') Text(tr('تنبيه: منتهي الخدمة في الموارد البشريّة.', 'Note: service ended in HR.'), style: const TextStyle(fontSize: 11.5, color: T.danger, fontWeight: FontWeight.w700)),
                ]),
              ),
            ],
          ],
          if (transfer) Padding(
            padding: const EdgeInsets.only(top: 10),
            child: Text(
              _isIn ? tr('تحويل: يُسجَّل صادرًا على ${_w(_source)} وواردًا على $acc بالمبلغ نفسِه.', 'Transfer: out on ${_w(_source)}, in on $acc.')
                    : tr('تحويل: يُسجَّل صادرًا على $acc وواردًا على الكاش بالمبلغ نفسِه.', 'Transfer: out on $acc, in on cash.'),
              style: const TextStyle(fontSize: 11.5, color: T.inkSoft),
            ),
          ),
          const SizedBox(height: 10),
          TextField(
            controller: _detail,
            decoration: InputDecoration(
              labelText: needDetail ? tr('البيان * — ما الصرف؟', 'Detail * — what was it for?') : tr('البيان (اختياري)', 'Detail (optional)'),
              hintText: needDetail ? tr('مثال: فاتورة كهرباء السكن · صرف مياه · صيانة مكيّف', 'e.g. electricity bill · water · AC repair') : null,
            ),
          ),
          const SizedBox(height: 14),
          SizedBox(width: double.infinity, child: FilledButton(onPressed: _saving ? null : _save, child: Text(tr('تسجيل', 'Record')))),
        ]),
      ),
    );
  }
}

String _dateLabel(String ymd) => _date(ymd);
