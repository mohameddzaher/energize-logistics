import 'dart:async';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';
import '../config.dart';
import '../services/api.dart';
import '../services/auth.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/file_upload.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';

/// دفترُ العهدة — الكاش، وكارت المشتريات، والورشة. شاشةٌ واحدةٌ لعهدتين:
/// النقلُ الخفيف (`LtCustodyScreen`) والنقلُ الثقيل (`HtCustodyScreen`)، مطابقةٌ
/// لـ`components/system/CustodyLedger` في الموقع. وما يختلف بينهما في `CustodyCfg`.
///
/// ثلاثةُ حساباتٍ في أعلى الشاشة، ولكلٍّ واردُه وصادرُه ورصيدُه. والقواعدُ في
/// الخادم وتصل هنا في `rules`: الشاشةُ ترسم ما يُسمَح به ولا تعيد كتابتَه.
/// والثقيلُ يزيد السيّارة: الواردُ أو الصادرُ يُنسب — اختيارًا — إلى شاحنةٍ من
/// أسطول لوكيشن سوليوشن، تُختار من قائمةٍ فيها بحث.
class CustodyCfg {
  final String api, event, titleAr, titleEn, repAr, repEn, missingAr, missingEn;
  /// يطابق حارسَ المسار في الخادم (`CUSTODY_ROLES`). العهدةُ مالٌ لا تُفتَح بمنح
  /// القسم، وتعديلُ قيدٍ مسجَّلٍ وحذفُه يقرّرهما الخادم (`canEdit` / `canDelete`).
  final Set<String> roles;
  final bool vehicles;
  const CustodyCfg({
    required this.api, required this.event, required this.titleAr, required this.titleEn,
    required this.repAr, required this.repEn, required this.missingAr, required this.missingEn,
    required this.roles, this.vehicles = false,
  });
}

class LtCustodyScreen extends StatelessWidget {
  const LtCustodyScreen({super.key});
  static const cfg = CustodyCfg(
    api: '/api/light-transport/custody', event: 'lt:custody',
    titleAr: 'عهدة النقل الخفيف', titleEn: 'Light Transport Custody',
    repAr: 'مندوب', repEn: 'Rep',
    missingAr: 'لا مندوبَ بهذا الرقم في الموارد البشريّة ولا في سجلّ النقل الخفيف.', missingEn: 'No rep with this number in HR or the light-transport register.',
    roles: {'super_admin', 'b2c_manager', 'b2c_deputy', 'cfo', 'accounting_manager', 'accountant'},
  );
  @override
  Widget build(BuildContext context) => const CustodyLedgerScreen(cfg: cfg);
}

class HtCustodyScreen extends StatelessWidget {
  const HtCustodyScreen({super.key});
  static const cfg = CustodyCfg(
    api: '/api/ls2/custody', event: 'ht:custody',
    titleAr: 'عهدة النقل الثقيل', titleEn: 'Heavy Transport Custody',
    repAr: 'موظف', repEn: 'Employee',
    missingAr: 'لا موظّفَ بهذا الرقم في الموارد البشريّة.', missingEn: 'No employee with this number in HR.',
    roles: {'super_admin', 'location_manager', 'cfo', 'accounting_manager', 'accountant'},
    vehicles: true,
  );
  @override
  Widget build(BuildContext context) => const CustodyLedgerScreen(cfg: cfg);
}

const _accounts = [
  ('cash', 'الكاش', 'Cash', Icons.payments_outlined),
  ('card', 'الكارت', 'Card', Icons.credit_card),
  ('workshop', 'الورشة', 'Workshop', Icons.build_outlined),
];

const _word = {
  'cash': ('الكاش', 'Cash'), 'card': ('الكارت', 'Card'), 'workshop': ('الورشة', 'Workshop'),
  'bank': ('البنك', 'Bank'), 'maintenance': ('الصيانة', 'Maintenance'), 'company': ('الشركة', 'Company'), 'opening': ('رصيد افتتاحي', 'Opening balance'),
};
String _w(dynamic k, [CustodyCfg? cfg]) {
  if (k == 'rep') return cfg == null ? tr('مندوب', 'Rep') : tr(cfg.repAr, cfg.repEn);
  final x = _word[k?.toString()]; return x == null ? (k ?? '').toString() : tr(x.$1, x.$2);
}
String _car(Map e) => ((e['vehiclePlate'] ?? '').toString().isNotEmpty ? e['vehiclePlate'] : (e['vehicleName'] ?? '')).toString();

num _num(dynamic v) => (v is num) ? v : num.tryParse(v?.toString() ?? '') ?? 0;
String _money(dynamic v) {
  final s = _num(v).toStringAsFixed(2).split('.');
  return '${s[0].replaceAllMapped(RegExp(r'\B(?=(\d{3})+(?!\d))'), (m) => ',')}.${s[1]}';
}
String _date(dynamic v) { final s = (v ?? '').toString(); return s.length >= 10 ? s.substring(0, 10).split('-').reversed.join('/') : '—'; }
String _ymd(DateTime d) => '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';

List<Map<String, dynamic>> _attachments(Map? e) =>
    [for (final a in (e?['attachments'] as List? ?? const [])) Map<String, dynamic>.from(a as Map)];

/// الملفُّ يُقدَّم على `/api/uploads/...` من الخادم نفسِه، فيُفتح بتطبيقٍ خارجيّ.
void _openFile(dynamic fileUrl) {
  final u = (fileUrl ?? '').toString();
  if (u.isEmpty) return;
  launchUrl(Uri.parse(u.startsWith('http') ? u : '${AppConfig.apiBase}$u'), mode: LaunchMode.externalApplication);
}

class CustodyLedgerScreen extends StatefulWidget {
  final CustodyCfg cfg;
  const CustodyLedgerScreen({super.key, required this.cfg});
  @override
  State<CustodyLedgerScreen> createState() => _CustodyLedgerScreenState();
}

class _CustodyLedgerScreenState extends State<CustodyLedgerScreen> {
  CustodyCfg get cfg => widget.cfg;
  String _vehicle = '';
  List<Map<String, dynamic>> _cars = const [];
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
    Live.instance.on(cfg.event, _onLive);
    if (cfg.vehicles) _loadCars();
  }

  // سيّاراتُ الأسطول للقائمة — مرّةً واحدة.
  Future<void> _loadCars() async {
    try {
      final r = await Api.instance.get('${cfg.api}/vehicles');
      if (mounted) setState(() => _cars = [for (final v in (r['vehicles'] as List? ?? const [])) Map<String, dynamic>.from(v as Map)]);
    } catch (_) {}
  }

  @override
  void dispose() {
    Live.instance.off(cfg.event, _onLive);
    _debounce?.cancel();
    super.dispose();
  }

  Future<void> _load() async {
    // آخرُ طلبٍ هو الذي يُعرَض: الفلترُ الأوسعُ أبطأ، وجوابُه يصل بعد الأضيق.
    final mine = ++_seq;
    final p = <String, String>{
      'account': _account,
      if (_direction.isNotEmpty) 'direction': _direction,
      if (_vehicle.isNotEmpty) 'vehicle': _vehicle,
      if (_q.trim().isNotEmpty) 'q': _q.trim(),
      if (_range != null) 'from': _ymd(_range!.start),
      if (_range != null) 'to': _ymd(_range!.end),
    };
    try {
      final d = await Api.instance.get('${cfg.api}?${Uri(queryParameters: p).query}');
      if (!mounted || mine != _seq) return;
      setState(() { _d = Map<String, dynamic>.from(d as Map); _error = null; });
    } catch (e) {
      if (mounted && mine == _seq) setState(() => _error = e.toString());
    }
  }

  bool get _canCreate => cfg.roles.contains(context.read<AuthProvider>().role);

  String _party(Map e) {
    if (e['source'] == 'opening') return _w('opening');
    if (e['source'] == 'rep') return '${tr('من', 'From')} ${_w('rep', cfg)}: ${e['repName'] ?? ''}';
    if (e['direction'] == 'in') return '${tr('من', 'From')} ${_w(e['source'])}';
    if (e['target'] == 'rep') return '${_w('rep', cfg)}: ${e['repName'] ?? ''}';
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
    try { await Api.instance.delete('${cfg.api}/${e['_id']}'); _load(); }
    catch (err) { if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(err.toString()))); }
  }

  // وبـ`entry` يصير النموذجُ تعديلًا لقيدٍ مسجَّل — على حسابِ القيد لا الحسابِ المعروض.
  Future<void> _open(String direction, {Map<String, dynamic>? entry}) async {
    final rules = Map<String, dynamic>.from(_d!['rules'] as Map);
    final saved = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (c) => _EntrySheet(
        cfg: cfg, cars: _cars,
        account: (entry?['account'] ?? _account).toString(), direction: direction, rules: rules,
        today: (_d!['today'] ?? _ymd(DateTime.now())).toString(), entry: entry,
      ),
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
    final canCreate = _canCreate;
    return AppScaffold(
      title: Text(tr(cfg.titleAr, cfg.titleEn)),
      body: d == null
          ? (_error != null
              ? ErrorRetry(message: _error!, onRetry: () { setState(() => _error = null); _load(); })
              : ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(height: 90), SizedBox(height: 10), Shimmer(), SizedBox(height: 10), Shimmer()]))
          : RefreshIndicator(onRefresh: _load, child: _body(d, canCreate)),
    );
  }

  Widget _body(Map<String, dynamic> d, bool canCreate) {
    final balances = Map<String, dynamic>.from(d['balances'] as Map);
    final rules = Map<String, dynamic>.from(d['rules'] as Map);
    final entries = List<Map<String, dynamic>>.from((d['entries'] as List).map((e) => Map<String, dynamic>.from(e as Map)));
    final shown = Map<String, dynamic>.from(d['shown'] as Map);
    final canDelete = d['canDelete'] == true;
    final canEdit = d['canEdit'] == true;
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
        '${tr('واردُه من', 'In from')}: ${sources.map((x) => _w(x, cfg)).join(tr('، ', ', '))}${toCash ? tr(' · ويصرف إلى الكاش', ' · can pay out to cash') : ''}',
        style: const TextStyle(fontSize: 11, color: T.inkFaint),
      ),
      if (canCreate) ...[
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
        decoration: InputDecoration(hintText: cfg.vehicles ? tr('الاسم، رقم الإقامة، اللوحة، البيان…', 'Name, ID no., plate, detail…') : tr('اسم المندوب، رقم الإقامة، البيان…', 'Rep name, ID no., detail…'), prefixIcon: const Icon(Icons.search), isDense: true),
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
        if (cfg.vehicles) ActionChip(
          avatar: const Icon(Icons.local_shipping_outlined, size: 16),
          label: Text(_vehicle.isEmpty ? tr('كلّ السيارات', 'All vehicles') : _carLabelOf(_cars, _vehicle)),
          onPressed: () async {
            final v = await pickCustodyVehicle(context, _cars, current: _vehicle, noneLabel: tr('كلّ السيارات', 'All vehicles'));
            if (v != null) { setState(() => _vehicle = v); _load(); }
          },
        ),
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
          if (e['target'] == 'rep' || e['source'] == 'rep') ...[e['repIdNumber'], e['repNationality'], e['repProject']],
          if (_car(e).isNotEmpty) '🚚 ${_car(e)}',
          if (e['transferId'] != null) tr('تحويل', 'transfer'),
          e['createdByName'],
        ].where((x) => x != null && x.toString().isNotEmpty).join(' · ');
        final files = _attachments(e);
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
                if (files.isNotEmpty) Padding(
                  padding: const EdgeInsets.only(top: 4),
                  child: Wrap(spacing: 4, runSpacing: 4, children: [
                    for (final a in files) _FileChip(label: (a['title'] ?? a['fileName'] ?? '').toString(), onTap: () => _openFile(a['fileUrl'])),
                  ]),
                ),
              ])),
              Text('${isIn ? '+' : '−'}${_money(e['amount'])}', style: TextStyle(fontWeight: FontWeight.w900, fontSize: 13.5, color: color)),
              if (canEdit && e['source'] != 'opening') IconButton(
                visualDensity: VisualDensity.compact, tooltip: tr('تعديل القيد', 'Edit entry'),
                icon: const Icon(Icons.edit_outlined, size: 18, color: T.inkFaint),
                onPressed: () => _open(isIn ? 'in' : 'out', entry: e),
              ),
              if (canDelete) IconButton(visualDensity: VisualDensity.compact, tooltip: tr('حذف القيد', 'Delete entry'), icon: const Icon(Icons.delete_outline, size: 18, color: T.inkFaint), onPressed: () => _delete(e)),
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

/// مرفقٌ يُضغَط فيُفتَح — وبـ`onRemove` تظهر علامةُ الإزالة (في النموذج وحدَه).
class _FileChip extends StatelessWidget {
  final String label;
  final VoidCallback? onTap;
  final VoidCallback? onRemove;
  final Color color;
  const _FileChip({required this.label, this.onTap, this.onRemove, this.color = T.navy});

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(8),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 4),
        decoration: BoxDecoration(color: color.withValues(alpha: 0.08), borderRadius: BorderRadius.circular(8)),
        child: Row(mainAxisSize: MainAxisSize.min, children: [
          Icon(Icons.attach_file, size: 12, color: color),
          const SizedBox(width: 3),
          ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 150),
            child: Text(label, maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: color)),
          ),
          if (onRemove != null) ...[
            const SizedBox(width: 4),
            InkWell(onTap: onRemove, child: const Icon(Icons.close, size: 14, color: T.inkFaint)),
          ],
        ]),
      ),
    );
  }
}

/// نموذجُ القيد: واردٌ (من أين) أو صادرٌ (إلى مَن) — بأقلّ ما يُكتب.
///
/// وبـ`entry` يصير تعديلًا لقيدٍ مسجَّل: يُصحَّح المبلغُ واليومُ والبيانُ والمندوبُ
/// والمرفقات. ونوعُ القيد لا يتغيّر — ما كُتب في غير موضعه يُحذَف ويُكتب من جديد.
class _EntrySheet extends StatefulWidget {
  final CustodyCfg cfg;
  final List<Map<String, dynamic>> cars;
  final String account, direction, today;
  final Map<String, dynamic> rules;
  final Map<String, dynamic>? entry;
  const _EntrySheet({required this.cfg, required this.cars, required this.account, required this.direction, required this.rules, required this.today, this.entry});
  @override
  State<_EntrySheet> createState() => _EntrySheetState();
}

class _EntrySheetState extends State<_EntrySheet> {
  late final _amount = TextEditingController(text: widget.entry == null ? '' : _num(widget.entry!['amount']).toString());
  late final _id = TextEditingController(text: (widget.entry?['repIdNumber'] ?? '').toString());
  late final _detail = TextEditingController(text: (widget.entry?['detail'] ?? '').toString());
  late String _date = _entryDate ?? widget.today;
  late final List<String> _sources = List<String>.from((widget.rules['inSources'] as Map)[widget.account] ?? const []);
  late final List<String> _targets = ['rep', 'company', if (List.from(widget.rules['toCash'] ?? const []).contains(widget.account)) 'cash'];
  late String _source = (widget.entry?['source'] ?? (_sources.length == 1 ? _sources.first : '')).toString();
  late String _target = (widget.entry?['target'] ?? 'rep').toString();
  late String _vehicle = widget.entry?['vehicleUnitId'] == null ? '' : widget.entry!['vehicleUnitId'].toString();
  CustodyCfg get cfg => widget.cfg;
  // السيّارةُ على كلّ واردٍ وصادر — إلّا التحويلَ بين حسابين: مالٌ انتقل لا سيّارةَ له.
  bool get _transfer => _isIn ? (_source == 'card' || _source == 'workshop') : _target == 'cash';
  bool get _withCar => cfg.vehicles && !_transfer && widget.entry?['transferId'] == null;
  Map<String, dynamic>? _rep;
  String _repState = '';
  final List<PickedFile> _files = [];
  final Set<String> _removed = {};
  bool _saving = false;
  Timer? _timer;
  int _seq = 0;

  bool get _isIn => widget.direction == 'in';
  bool get _editing => widget.entry != null;
  // المندوبُ يُسأل عنه في الصادر إلى مندوب، وفي واردِ الكاش من مندوب.
  bool get _needsRep => _isIn ? _source == 'rep' : _target == 'rep';
  String? get _entryDate {
    final s = (widget.entry?['date'] ?? '').toString();
    return s.length >= 10 ? s.substring(0, 10) : null;
  }

  @override
  void initState() {
    super.initState();
    // قيدُ مندوبٍ يُفتَح للتعديل: تُجلَب بياناتُه برقمه المسجَّل كما لو كُتب الآن.
    if (_editing && _needsRep && _id.text.trim().length >= 8) {
      _repState = 'loading';
      _fetchRep(_id.text.trim(), ++_seq, Duration.zero);
    }
  }

  @override
  void dispose() { _timer?.cancel(); _amount.dispose(); _id.dispose(); _detail.dispose(); super.dispose(); }

  // رقمُ الإقامة يُكتب فتأتي بياناتُ المندوب من الموارد البشريّة — بلا زرّ بحث.
  void _lookup(String raw) {
    final id = raw.replaceAll(RegExp(r'\s+'), '');
    _timer?.cancel();
    final mine = ++_seq;
    setState(() { _rep = null; _repState = id.length < 8 ? '' : 'loading'; });
    if (id.length < 8) return;
    _fetchRep(id, mine, const Duration(milliseconds: 350));
  }

  void _fetchRep(String id, int mine, Duration wait) {
    _timer = Timer(wait, () async {
      try {
        final r = await Api.instance.get('${cfg.api}/rep?id=${Uri.encodeQueryComponent(id)}');
        if (mounted && mine == _seq) setState(() { _rep = Map<String, dynamic>.from(r['rep'] as Map); _repState = ''; });
      } catch (_) {
        if (mounted && mine == _seq) setState(() => _repState = 'missing');
      }
    });
  }

  // تغييرُ النوع يُسقط المندوبَ المعروض: رقمُه يُعاد البحثُ به إن بقي مطلوبًا.
  void _retype(VoidCallback change) {
    setState(change);
    if (_needsRep && _rep == null && _id.text.trim().isNotEmpty) _lookup(_id.text);
  }

  void _say(String m) => ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(m)));

  Future<void> _addFile() async {
    final f = await pickFileAsDataUrl();
    if (f != null && mounted) setState(() => _files.add(f));
  }

  Future<void> _save() async {
    final amount = num.tryParse(_amount.text.trim()) ?? 0;
    final detail = _detail.text.trim();
    if (amount <= 0) return _say(tr('اكتب المبلغ', 'Enter the amount'));
    if (_isIn && _source.isEmpty) return _say(tr('اختر مصدرَ الوارد', 'Pick where it came from'));
    if (_needsRep && _rep == null) return _say(tr('اكتب رقمَ إقامة ${cfg.repAr}', 'Enter the ${cfg.repEn.toLowerCase()}’s ID number'));
    if (!_isIn && _target == 'company' && detail.isEmpty) return _say(tr('اكتب البيان: ما الصرف؟', 'Enter what it was spent on'));
    setState(() => _saving = true);
    // الاسمُ بلا امتداده عنوانًا — كما في الموقع.
    final sent = [
      for (final f in _files) {'fileName': f.fileName, 'title': f.fileName.replaceFirst(RegExp(r'\.[^.]+$'), ''), 'dataUrl': f.dataUrl},
    ];
    try {
      if (_editing) {
        await Api.instance.put('${cfg.api}/${widget.entry!['_id']}', {
          'amount': amount, 'date': _date, 'detail': detail, 'files': sent, 'removeAttachments': _removed.toList(),
          if (_needsRep) 'repIdNumber': _rep!['idNumber'],
          if (_withCar) 'vehicleUnitId': _vehicle,
        });
      } else {
        await Api.instance.post(cfg.api, {
          'account': widget.account, 'direction': widget.direction, 'amount': amount, 'date': _date, 'detail': detail, 'files': sent,
          if (_isIn) 'source': _source,
          if (!_isIn) 'target': _target,
          if (_needsRep) 'repIdNumber': _rep!['idNumber'],
          if (_withCar && _vehicle.isNotEmpty) 'vehicleUnitId': _vehicle,
        });
      }
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
    String w(String k) => _w(k, cfg);
    final transfer = _isIn ? (_source == 'card' || _source == 'workshop') : _target == 'cash';
    final needDetail = !_isIn && _target == 'company';
    final kept = _attachments(widget.entry).where((a) => !_removed.contains(a['_id'].toString())).toList();
    // المرفقاتُ للصادر (فاتورة، إيصال، صورة تحويل) — ولواردِ المندوب كذلك.
    final canAttach = !_isIn || _source == 'rep' || _attachments(widget.entry).isNotEmpty;
    return SafeArea(
      child: SingleChildScrollView(
        padding: EdgeInsets.fromLTRB(16, 16, 16, MediaQuery.of(context).viewInsets.bottom + 16),
        child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(
            _editing ? tr('تعديل قيد — $acc', 'Edit entry — $acc') : _isIn ? tr('وارد إلى $acc', 'In to $acc') : tr('صادر من $acc', 'Out from $acc'),
            style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15),
          ),
          const SizedBox(height: 12),
          Row(children: [
            Expanded(child: TextField(
              controller: _amount, autofocus: !_editing,
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
              for (final s in _sources)
                ChoiceChip(label: Text(_w(s)), selected: _source == s, onSelected: _editing ? null : (_) => _retype(() => _source = s)),
            ]),
          ] else ...[
            Text(tr('المتحمِّل *', 'Bearer *'), style: const TextStyle(fontSize: 12, color: T.inkSoft, fontWeight: FontWeight.w700)),
            const SizedBox(height: 6),
            Wrap(spacing: 6, children: [
              for (final k in _targets)
                ChoiceChip(label: Text(k == 'cash' ? tr('إلى الكاش', 'To cash') : w(k)), selected: _target == k, onSelected: _editing ? null : (_) => _retype(() => _target = k)),
            ]),
          ],
          if (_editing) Padding(
            padding: const EdgeInsets.only(top: 6),
            child: Text(tr('نوعُ القيد لا يُعدَّل — ما كُتب في غير موضعه يُحذَف ويُكتب من جديد.', 'The entry type cannot change — delete and re-enter it instead.'), style: const TextStyle(fontSize: 11.5, color: T.inkFaint)),
          ),
          if (_needsRep) ...[
              const SizedBox(height: 10),
              TextField(
                controller: _id, onChanged: _lookup, keyboardType: TextInputType.number, textDirection: TextDirection.ltr,
                decoration: InputDecoration(labelText: tr('رقم إقامة ${cfg.repAr} *', '${cfg.repEn} ID number *'), hintText: '2xxxxxxxxx'),
              ),
              if (_repState == 'loading') Padding(padding: const EdgeInsets.only(top: 6), child: Text(tr('يُبحَث في الموارد البشريّة…', 'Looking up HR…'), style: const TextStyle(fontSize: 11.5, color: T.inkFaint))),
              if (_repState == 'missing') Padding(padding: const EdgeInsets.only(top: 6), child: Text(tr(cfg.missingAr, cfg.missingEn), style: const TextStyle(fontSize: 11.5, color: T.danger, fontWeight: FontWeight.w700))),
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
          if (transfer) Padding(
            padding: const EdgeInsets.only(top: 10),
            child: Text(
              _isIn ? tr('تحويل: يُسجَّل صادرًا على ${_w(_source)} وواردًا على $acc بالمبلغ نفسِه.', 'Transfer: out on ${_w(_source)}, in on $acc.')
                    : tr('تحويل: يُسجَّل صادرًا على $acc وواردًا على الكاش بالمبلغ نفسِه.', 'Transfer: out on $acc, in on cash.'),
              style: const TextStyle(fontSize: 11.5, color: T.inkSoft),
            ),
          ),
          if (_withCar) ...[
            const SizedBox(height: 10),
            Text(tr('السيارة (اختياري) — من سيارات لوكيشن سوليوشن', 'Vehicle (optional) — from the Location Solutions fleet'), style: const TextStyle(fontSize: 12, color: T.inkSoft, fontWeight: FontWeight.w700)),
            const SizedBox(height: 6),
            OutlinedButton.icon(
              icon: const Icon(Icons.local_shipping_outlined, size: 18),
              label: Align(alignment: AlignmentDirectional.centerStart, child: Text(_vehicle.isEmpty ? tr('بدون سيارة', 'No vehicle') : _carLabelOf(widget.cars, _vehicle, fallback: _car(widget.entry ?? const {})))),
              onPressed: () async {
                final v = await pickCustodyVehicle(context, widget.cars, current: _vehicle, noneLabel: tr('بدون سيارة', 'No vehicle'));
                if (v != null) setState(() => _vehicle = v);
              },
            ),
          ],
          const SizedBox(height: 10),
          TextField(
            controller: _detail,
            decoration: InputDecoration(
              labelText: needDetail ? tr('البيان * — ما الصرف؟', 'Detail * — what was it for?') : tr('البيان (اختياري)', 'Detail (optional)'),
              hintText: needDetail ? tr('مثال: فاتورة كهرباء السكن · صرف مياه · صيانة مكيّف', 'e.g. electricity bill · water · AC repair') : null,
            ),
          ),
          if (canAttach) ...[
            const SizedBox(height: 12),
            Text(tr('مرفقات (اختياري) — فاتورة، إيصال، صورة تحويل', 'Attachments (optional) — invoice, receipt, transfer slip'), style: const TextStyle(fontSize: 12, color: T.inkSoft, fontWeight: FontWeight.w700)),
            const SizedBox(height: 6),
            Wrap(spacing: 6, runSpacing: 6, crossAxisAlignment: WrapCrossAlignment.center, children: [
              for (final a in kept)
                _FileChip(
                  label: (a['title'] ?? a['fileName'] ?? '').toString(),
                  onTap: () => _openFile(a['fileUrl']),
                  onRemove: () => setState(() => _removed.add(a['_id'].toString())),
                ),
              for (final f in _files)
                _FileChip(label: f.fileName, color: T.success, onRemove: () => setState(() => _files.remove(f))),
              ActionChip(avatar: const Icon(Icons.add, size: 16), label: Text(tr('إرفاق ملف', 'Attach file')), onPressed: _saving ? null : _addFile),
            ]),
          ],
          const SizedBox(height: 14),
          SizedBox(width: double.infinity, child: FilledButton(onPressed: _saving ? null : _save, child: Text(_editing ? tr('حفظ التعديل', 'Save changes') : tr('تسجيل', 'Record')))),
        ]),
      ),
    );
  }
}

String _dateLabel(String ymd) => _date(ymd);

String _carLabelOf(List<Map<String, dynamic>> cars, String unitId, {String fallback = ''}) {
  for (final v in cars) {
    if (v['unitId'].toString() == unitId) return _car({'vehiclePlate': v['plate'], 'vehicleName': v['name']});
  }
  return fallback.isNotEmpty ? fallback : '#$unitId';
}

/// قائمةُ سيّارات الأسطول وفيها بحث — باللوحة أو الاسم أو السائق. تردّ رقمَ الوحدة،
/// أو '' لـ«بدون سيارة / الكلّ»، أو null إن أُغلقت بلا اختيار.
Future<String?> pickCustodyVehicle(BuildContext context, List<Map<String, dynamic>> cars, {required String current, required String noneLabel}) {
  return showModalBottomSheet<String>(
    context: context,
    isScrollControlled: true,
    backgroundColor: Colors.white,
    shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
    builder: (c) => _VehiclePicker(cars: cars, current: current, noneLabel: noneLabel),
  );
}

class _VehiclePicker extends StatefulWidget {
  final List<Map<String, dynamic>> cars;
  final String current, noneLabel;
  const _VehiclePicker({required this.cars, required this.current, required this.noneLabel});
  @override
  State<_VehiclePicker> createState() => _VehiclePickerState();
}

class _VehiclePickerState extends State<_VehiclePicker> {
  String _q = '';
  // الطيُّ العربيّ كما في الموقع: «احمد» تجد «أحمد».
  static String _fold(String s) => s.toLowerCase()
      .replaceAll(RegExp('[أإآ]'), 'ا').replaceAll('ى', 'ي').replaceAll('ة', 'ه').replaceAll('ؤ', 'و').replaceAll('ئ', 'ي')
      .replaceAll(RegExp(r'\s+'), ' ').trim();

  @override
  Widget build(BuildContext context) {
    final q = _fold(_q);
    final shown = q.isEmpty ? widget.cars : widget.cars.where((v) =>
        _fold('${v['plate'] ?? ''} ${v['name'] ?? ''} ${v['driver'] ?? ''}').contains(q)).toList();
    return SafeArea(
      child: Padding(
        padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
        child: SizedBox(
          height: MediaQuery.of(context).size.height * 0.7,
          child: Column(children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(14, 14, 14, 6),
              child: TextField(
                autofocus: true,
                onChanged: (v) => setState(() => _q = v),
                decoration: InputDecoration(hintText: tr('ابحث باللوحة أو الاسم أو السائق…', 'Search plate, name or driver…'), prefixIcon: const Icon(Icons.search), isDense: true),
              ),
            ),
            Expanded(child: ListView(children: [
              ListTile(
                dense: true,
                title: Text(widget.noneLabel, style: TextStyle(fontWeight: FontWeight.w700, color: widget.current.isEmpty ? T.orange : T.inkSoft)),
                onTap: () => Navigator.pop(context, ''),
              ),
              for (final v in shown)
                ListTile(
                  dense: true,
                  leading: const Icon(Icons.local_shipping_outlined, size: 20),
                  title: Text(_car({'vehiclePlate': v['plate'], 'vehicleName': v['name']}),
                      style: TextStyle(fontWeight: FontWeight.w700, color: v['unitId'].toString() == widget.current ? T.orange : T.navy)),
                  subtitle: Text([
                    if ((v['name'] ?? '') != (v['plate'] ?? '')) v['name'],
                    v['driver'],
                  ].where((x) => x != null && x.toString().isNotEmpty).join(' · '), style: const TextStyle(fontSize: 11.5)),
                  onTap: () => Navigator.pop(context, v['unitId'].toString()),
                ),
              if (shown.isEmpty) Padding(padding: const EdgeInsets.all(24), child: Center(child: Text(tr('لا نتائج', 'No matches'), style: const TextStyle(color: T.inkFaint)))),
            ])),
          ]),
        ),
      ),
    );
  }
}
