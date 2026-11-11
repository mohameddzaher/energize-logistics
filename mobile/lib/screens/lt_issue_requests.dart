import 'dart:async';
import 'package:flutter/material.dart';
import 'package:printing/printing.dart';
import 'package:provider/provider.dart';
import '../services/api.dart';
import '../services/auth.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/search_field.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';
import 'ls2_store.dart';

/// Store issue requests (طلب صرف) for both stores, as on the web: the list first, the items screen one tap away.
/// Saving a request is the stock-out; the server refuses any line that would take a balance below zero. Posted requests are not edited; cancelling returns the stock on the record.
class IssueCfg {
  final String base, itemsBase, titleAr, titleEn, vehiclesKind, section;
  final List<String> editRoles;
  const IssueCfg({required this.base, required this.itemsBase, required this.titleAr, required this.titleEn,
      required this.vehiclesKind, required this.section, required this.editRoles});
  bool get heavy => vehiclesKind == 'heavy';
  bool canEdit(AuthProvider a) => editRoles.contains(a.role) || a.canEditSection(section);
  Future<List<Map<String, dynamic>>> plates() => heavy ? loadHeavyStorePlates() : loadLightStorePlates();
}

// Same writers as the store routes on the server (routes/lightTransport.js EDIT, routes/ls2.js ADMIN).
const ltIssueCfg = IssueCfg(
  base: '/api/light-transport/store/issue-requests', itemsBase: '/api/light-transport/store',
  titleAr: 'مخزن النقل الخفيف — طلبات الصرف', titleEn: 'Light Transport Store — Issue Requests', vehiclesKind: 'light', section: 'B2C',
  editRoles: ['super_admin', 'admin', 'b2c_manager', 'b2c_deputy', 'b2c_project_lead', 'it_manager', 'it_specialist', 'cfo', 'accounting_manager', 'accountant'],
);
const htIssueCfg = IssueCfg(
  base: '/api/ls2/store/issue-requests', itemsBase: '/api/ls2/store',
  titleAr: 'مخزن النقل الثقيل — طلبات الصرف', titleEn: 'Heavy Transport Store — Issue Requests', vehiclesKind: 'heavy', section: 'Location Solutions',
  editRoles: ['super_admin', 'admin', 'it_manager', 'it_specialist', 'operations_manager', 'operations_team_leader', 'workshop_manager', 'location_manager', 'vehicles_manager'],
);

num _num(dynamic v) => v is num ? v : num.tryParse(v?.toString() ?? '') ?? 0;
num _r3(num n) => (n * 1000).round() / 1000;
String _fq(dynamic v) {
  final n = _r3(_num(v));
  return n == n.roundToDouble() ? n.round().toString() : n.toString();
}
String _dmy(dynamic v) {
  final s = (v ?? '').toString();
  return s.length < 10 ? '—' : s.substring(0, 10).split('-').reversed.join('/');
}
/// When the request was entered in the system, Riyadh time.
String _recordedAt(dynamic v) {
  final d = DateTime.tryParse('${v ?? ''}');
  if (d == null) return '—';
  final r = d.toUtc().add(const Duration(hours: 3));
  String p(int x) => x.toString().padLeft(2, '0');
  return '${p(r.day)}/${p(r.month)}/${r.year} ${p(r.hour)}:${p(r.minute)}';
}

/// Today in Riyadh, the latest issue date allowed.
DateTime _todayRiyadh() {
  final d = DateTime.now().toUtc().add(const Duration(hours: 3));
  return DateTime(d.year, d.month, d.day);
}
String _ymd(DateTime d) => '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';
String _reasonLabel(String key) {
  for (final r in storeIssueReasons) { if (r.$1 == key) return tr(r.$2, r.$3); }
  return key.isEmpty ? '—' : key;
}

Future<void> _printPdf(BuildContext context, String base, Map<String, dynamic> r) async {
  try {
    final bytes = await Api.instance.getBytes('$base/${r['_id']}/pdf');
    await Printing.layoutPdf(onLayout: (_) async => bytes, name: (r['number'] ?? 'issue-request').toString());
  } catch (e) {
    if (context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e is ApiException ? e.message : tr('تعذّر توليد ملف الطلب', 'Could not generate the PDF'))));
    }
  }
}

class LtIssueRequestsScreen extends StatefulWidget {
  final IssueCfg cfg;
  const LtIssueRequestsScreen({super.key, this.cfg = ltIssueCfg});
  @override
  State<LtIssueRequestsScreen> createState() => _LtIssueRequestsScreenState();
}

class _LtIssueRequestsScreenState extends State<LtIssueRequestsScreen> {
  List<Map<String, dynamic>> _rows = [];
  bool _loading = true;
  String? _error;
  String _q = '';
  String _status = '';
  final _searchCtl = TextEditingController();
  Timer? _debounce;
  int _seq = 0;
  late final void Function() _onLive;

  @override
  void initState() {
    super.initState();
    _load();
    // Same event as the store: a request, a receipt or a cancellation changes the list and balances together.
    _onLive = _load;
    Live.instance.on('ls2:store', _onLive);
  }

  @override
  void dispose() {
    Live.instance.off('ls2:store', _onLive);
    _debounce?.cancel();
    _searchCtl.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    final seq = ++_seq;
    final qs = [
      if (_q.trim().isNotEmpty) 'q=${Uri.encodeComponent(_q.trim())}',
      if (_status.isNotEmpty) 'status=$_status',
    ].join('&');
    try {
      final d = await Api.instance.get('${widget.cfg.base}${qs.isEmpty ? '' : '?$qs'}');
      if (!mounted || seq != _seq) return;
      setState(() { _rows = List<Map<String, dynamic>>.from(d['requests'] ?? []); _loading = false; _error = null; });
    } catch (e) {
      if (mounted && seq == _seq) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  Future<void> _create() async {
    final r = await Navigator.of(context).push<Map<String, dynamic>>(MaterialPageRoute(builder: (_) => _IssueRequestForm(cfg: widget.cfg)));
    if (r == null || !mounted) return;
    _load();
    final go = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        content: Text(tr('حُفظ طلب الصرف ${r['number']} وخُصم من الرصيد. طباعة الطلب أو مشاركته للتوقيع؟', 'Request ${r['number']} saved and stock deducted. Print or share it for signature?')),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: Text(tr('لاحقًا', 'Later'))),
          FilledButton(onPressed: () => Navigator.pop(c, true), child: const Text('PDF')),
        ],
      ),
    );
    if (go == true && mounted) await _printPdf(context, widget.cfg.base, r);
  }

  void _openItems() {
    Navigator.of(context).push(MaterialPageRoute(builder: (_) => Ls2StoreScreen(
          base: widget.cfg.itemsBase, titleAr: 'الأصناف والأرصدة', titleEn: 'Items & stock', vehiclesKind: widget.cfg.vehiclesKind)));
  }

  Future<void> _openDetail(Map<String, dynamic> r, bool canEdit) async {
    final changed = await showModalBottomSheet<bool>(
      context: context, isScrollControlled: true, backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (_) => _DetailSheet(r: r, canEdit: canEdit, base: widget.cfg.base),
    );
    if (changed == true) _load();
  }

  @override
  Widget build(BuildContext context) {
    final canEdit = widget.cfg.canEdit(context.watch<AuthProvider>());
    return AppScaffold(
      title: Text(tr(widget.cfg.titleAr, widget.cfg.titleEn)),
      actions: [
        IconButton(icon: const Icon(Icons.inventory_2_outlined), tooltip: tr('الأصناف والأرصدة', 'Items & stock'), onPressed: _openItems),
      ],
      floatingActionButton: !canEdit ? null : FloatingActionButton.extended(
        backgroundColor: T.orange, foregroundColor: Colors.white,
        icon: const Icon(Icons.add), label: Text(tr('طلب صرف', 'Issue request')), onPressed: _create,
      ),
      body: Column(children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(14, 12, 14, 6),
          child: SearchField(
            controller: _searchCtl,
            hint: tr('رقم الطلب / اللوحة / الصنف / الكود…', 'Number / plate / item / code…'),
            onChanged: (v) {
              _q = v;
              _debounce?.cancel();
              _debounce = Timer(const Duration(milliseconds: 350), _load);
            },
          ),
        ),
        SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          padding: const EdgeInsets.symmetric(horizontal: 14),
          child: Row(children: [
            for (final s in [('', 'الكل', 'All'), ('posted', 'مصروف', 'Posted'), ('cancelled', 'ملغى', 'Cancelled')])
              Padding(
                padding: const EdgeInsetsDirectional.only(end: 6),
                child: ChoiceChip(
                  label: Text(tr(s.$2, s.$3)), selected: _status == s.$1,
                  onSelected: (_) { setState(() => _status = s.$1); _load(); },
                ),
              ),
          ]),
        ),
        Expanded(
          child: _loading && _rows.isEmpty
              ? ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(), SizedBox(height: 10), Shimmer(), SizedBox(height: 10), Shimmer()])
              : _error != null
                  ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
                  : RefreshIndicator(
                      onRefresh: _load,
                      child: _rows.isEmpty
                          ? ListView(children: [EmptyState(icon: Icons.assignment_outlined, title: tr('لا طلبات صرف', 'No issue requests'))])
                          : ListView.separated(
                              padding: const EdgeInsets.fromLTRB(14, 8, 14, 90),
                              itemCount: _rows.length,
                              separatorBuilder: (_, __) => const SizedBox(height: 10),
                              itemBuilder: (c, i) {
                                final r = _rows[i];
                                final cancelled = r['status'] == 'cancelled';
                                final lines = List<Map<String, dynamic>>.from(r['lines'] ?? []);
                                final sub = [r['project'], r['rider']].where((x) => (x ?? '').toString().isNotEmpty).join(' · ');
                                return InkWell(
                                  borderRadius: BorderRadius.circular(16),
                                  onTap: () => _openDetail(r, canEdit),
                                  child: AppCard(
                                    topAccent: cancelled ? T.danger : T.orange,
                                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                      Row(children: [
                                        Text('${r['number']}', textDirection: TextDirection.ltr, style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 15)),
                                        const SizedBox(width: 8),
                                        Text(_dmy(r['date']), style: const TextStyle(fontSize: 12, color: T.inkFaint)),
                                        const Spacer(),
                                        Chip2(cancelled ? tr('ملغى', 'Cancelled') : tr('مصروف', 'Posted'), cancelled ? T.danger : T.success),
                                      ]),
                                      const SizedBox(height: 6),
                                      Text('${r['vehiclePlate'] ?? ''}', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14)),
                                      if (sub.isNotEmpty) Text(sub, style: const TextStyle(fontSize: 12, color: T.inkSoft)),
                                      const SizedBox(height: 4),
                                      Text('${_reasonLabel((r['issueReason'] ?? '').toString())} · ${lines.length} ${tr('سطر', 'lines')} · ${_fq(r['totalQty'])}',
                                          style: const TextStyle(fontSize: 12, color: T.inkSoft)),
                                      Text(lines.map((l) => l['itemName']).join('، '), maxLines: 1, overflow: TextOverflow.ellipsis,
                                          style: const TextStyle(fontSize: 11.5, color: T.inkFaint)),
                                    ]),
                                  ),
                                );
                              },
                            ),
                    ),
        ),
      ]),
    );
  }
}

/// One request: its lines, the PDF and, while posted, the cancellation.
class _DetailSheet extends StatefulWidget {
  final Map<String, dynamic> r;
  final bool canEdit;
  final String base;
  const _DetailSheet({required this.r, required this.canEdit, required this.base});
  @override
  State<_DetailSheet> createState() => _DetailSheetState();
}

class _DetailSheetState extends State<_DetailSheet> {
  bool _printing = false;
  bool _busy = false;
  bool _cancelMode = false;
  String? _err;
  final _reason = TextEditingController();

  @override
  void dispose() { _reason.dispose(); super.dispose(); }

  Future<void> _cancel() async {
    setState(() { _busy = true; _err = null; });
    try {
      await Api.instance.post('${widget.base}/${widget.r['_id']}/cancel', {'reason': _reason.text.trim()});
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(tr('أُلغي ${widget.r['number']} وعادت الكميات إلى المخزن', '${widget.r['number']} cancelled; stock returned'))));
      Navigator.pop(context, true);
    } catch (e) {
      if (mounted) setState(() { _busy = false; _err = e.toString(); });
    }
  }

  @override
  Widget build(BuildContext context) {
    final r = widget.r;
    final lines = List<Map<String, dynamic>>.from(r['lines'] ?? []);
    final cancelled = r['status'] == 'cancelled';
    final kv = <(String, String)>[
      (tr('تاريخ الصرف', 'Issue date'), _dmy(r['date'])),
      if ('${r['createdAt'] ?? ''}'.length >= 16) (tr('تاريخ التسجيل', 'Recorded'), _recordedAt(r['createdAt'])),
      (tr('المركبة / اللوحة', 'Vehicle / plate'), '${r['vehiclePlate'] ?? '—'}'),
      if ('${r['project'] ?? ''}'.isNotEmpty) (tr('المشروع', 'Project'), '${r['project']}'),
      if ('${r['rider'] ?? ''}'.isNotEmpty) (r['warehouse'] == 'heavy' ? tr('السائق', 'Driver') : tr('الراكب', 'Rider'), '${r['rider']}'),
      (tr('سبب الصرف', 'Issue reason'), _reasonLabel('${r['issueReason'] ?? ''}')),
      if ('${r['note'] ?? ''}'.isNotEmpty) (tr('ملاحظة', 'Note'), '${r['note']}'),
      (tr('بواسطة', 'By'), '${r['createdByName'] ?? '—'}'),
      if (cancelled) (tr('أُلغي', 'Cancelled'), [r['cancelledByName'], r['cancelReason']].where((x) => '${x ?? ''}'.isNotEmpty).join(' · ')),
    ];
    return Padding(
      padding: EdgeInsets.fromLTRB(18, 16, 18, MediaQuery.of(context).viewInsets.bottom + 18),
      child: SizedBox(
        height: MediaQuery.of(context).size.height * 0.8,
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            Text('${tr('طلب صرف', 'Issue request')} ', style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 17, color: T.orange)),
            Text('${r['number']}', textDirection: TextDirection.ltr, style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 17)),
            const Spacer(),
            Chip2(cancelled ? tr('ملغى', 'Cancelled') : tr('مصروف', 'Posted'), cancelled ? T.danger : T.success),
          ]),
          const SizedBox(height: 10),
          Expanded(
            child: ListView(children: [
              for (final e in kv)
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 3),
                  child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    SizedBox(width: 120, child: Text(e.$1, style: const TextStyle(fontSize: 12.5, color: T.inkFaint))),
                    Expanded(child: Text(e.$2, style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700))),
                  ]),
                ),
              const SizedBox(height: 10),
              Text(tr('قطع الغيار المطلوبة', 'Requested parts'), style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 14)),
              const SizedBox(height: 6),
              for (final (i, l) in lines.indexed)
                Container(
                  margin: const EdgeInsets.only(bottom: 6),
                  padding: const EdgeInsets.all(10),
                  decoration: BoxDecoration(border: Border.all(color: T.line), borderRadius: BorderRadius.circular(10)),
                  child: Row(children: [
                    Text('${i + 1}', style: const TextStyle(color: T.inkFaint)),
                    const SizedBox(width: 10),
                    Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Text('${l['itemName']}', style: const TextStyle(fontWeight: FontWeight.w800)),
                      if ('${l['itemCode'] ?? ''}'.isNotEmpty) Text('${tr('كود', 'Code')}: ${l['itemCode']}', style: const TextStyle(fontSize: 11.5, color: T.inkFaint)),
                    ])),
                    Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
                      Text('${_fq(l['quantity'])} ${l['unit'] ?? ''}', style: const TextStyle(fontWeight: FontWeight.w900, color: T.orange)),
                      Text('${tr('الرصيد بعده', 'Balance after')}: ${_fq(l['balanceAfter'])}', style: const TextStyle(fontSize: 11, color: T.inkSoft)),
                    ]),
                  ]),
                ),
              if (_cancelMode) ...[
                const SizedBox(height: 8),
                TextField(controller: _reason, autofocus: true, maxLines: 2, onChanged: (_) => setState(() {}),
                    decoration: InputDecoration(labelText: tr('سبب الإلغاء *', 'Reason *'))),
                const SizedBox(height: 6),
                Text(tr('تعود كلُّ الكميات إلى المخزن بحركات وارد معاكسة باسمك وبسببك، وتبقى الحركات الأصلية في السجل مشطوبة.',
                        'Every line returns to stock as an opposite movement under your name; the originals stay in the log struck through.'),
                    style: const TextStyle(fontSize: 11.5, color: T.inkFaint)),
              ],
              if (_err != null) Padding(padding: const EdgeInsets.only(top: 8), child: Text(_err!, style: const TextStyle(color: T.danger, fontWeight: FontWeight.w700))),
            ]),
          ),
          const SizedBox(height: 8),
          Row(children: [
            Expanded(child: OutlinedButton.icon(
              icon: _printing ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2)) : const Icon(Icons.picture_as_pdf_outlined),
              label: Text(tr('طباعة / مشاركة PDF', 'Print / share PDF')),
              onPressed: _printing ? null : () async {
                setState(() => _printing = true);
                await _printPdf(context, widget.base, r);
                if (mounted) setState(() => _printing = false);
              },
            )),
            if (widget.canEdit && !cancelled) ...[
              const SizedBox(width: 8),
              Expanded(child: FilledButton(
                style: FilledButton.styleFrom(backgroundColor: T.danger),
                onPressed: _busy ? null : (!_cancelMode ? () => setState(() => _cancelMode = true) : (_reason.text.trim().length < 3 ? null : _cancel)),
                child: Text(_cancelMode ? tr('تأكيد الإلغاء', 'Confirm cancel') : tr('إلغاء الطلب', 'Cancel request')),
              )),
            ],
          ]),
        ]),
      ),
    );
  }
}

/// Draft line: the picked item and the typed quantity.
class _Line {
  Map<String, dynamic>? item;
  final qty = TextEditingController();
  String? serverErr;
}

/// Create form. The balance after each line is computed while typing: stock minus this line and every earlier line of the same item, which is what the server checks and prints.
class _IssueRequestForm extends StatefulWidget {
  final IssueCfg cfg;
  const _IssueRequestForm({required this.cfg});
  @override
  State<_IssueRequestForm> createState() => _IssueRequestFormState();
}

class _IssueRequestFormState extends State<_IssueRequestForm> {
  List<Map<String, dynamic>> _items = [];
  List<Map<String, dynamic>> _plates = [];
  String _date = '';
  String _plate = '';
  String _issueReason = '';
  final _note = TextEditingController();
  final List<_Line> _lines = [_Line()];
  bool _busy = false;
  String? _err;
  late final void Function() _onLive;

  @override
  void initState() {
    super.initState();
    _loadItems();
    widget.cfg.plates().then((p) { if (mounted) setState(() => _plates = p); }).catchError((_) {});
    // Balances change under the form when someone else issues or receives.
    _onLive = _loadItems;
    Live.instance.on('ls2:store', _onLive);
  }

  @override
  void dispose() {
    Live.instance.off('ls2:store', _onLive);
    _note.dispose();
    for (final l in _lines) { l.qty.dispose(); }
    super.dispose();
  }

  Future<void> _loadItems() async {
    try {
      final d = await Api.instance.get(widget.cfg.itemsBase);
      if (!mounted) return;
      final items = List<Map<String, dynamic>>.from(d['items'] ?? []);
      final byId = {for (final i in items) '${i['_id']}': i};
      setState(() {
        _items = items;
        for (final l in _lines) { if (l.item != null) l.item = byId['${l.item!['_id']}'] ?? l.item; }
      });
    } catch (_) {/* The form shows the last balances it had. */}
  }

  /// Per line: balance after and the error to show.
  List<(num?, String?)> _computed() {
    final used = <String, num>{};
    return [
      for (final l in _lines)
        () {
          final it = l.item;
          if (it == null) return (null, l.serverErr);
          final raw = l.qty.text.trim();
          final q = num.tryParse(raw) ?? 0;
          final id = '${it['_id']}';
          used[id] = _r3((used[id] ?? 0) + (q > 0 ? q : 0));
          final after = _r3(_num(it['quantity']) - used[id]!);
          String? err = l.serverErr;
          if (raw.isNotEmpty && !(q > 0)) {
            err = tr('الكمية يجب أن تكون أكبر من صفر', 'Quantity must be above zero');
          } else if (after < 0) {
            err = tr('الرصيد لا يكفي: المتاح ${_fq(it['quantity'])} ${it['unit'] ?? ''}', 'Not enough stock: ${_fq(it['quantity'])} ${it['unit'] ?? ''}');
          }
          return (after, err);
        }(),
    ];
  }

  Future<void> _pickItem(_Line l) async {
    final it = await showModalBottomSheet<Map<String, dynamic>>(
      context: context, isScrollControlled: true, backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (_) => _ItemPicker(items: _items),
    );
    if (it != null && mounted) setState(() { l.item = it; l.serverErr = null; });
  }

  Future<void> _save() async {
    final filled = _lines.where((l) => l.item != null || l.qty.text.trim().isNotEmpty).toList();
    setState(() { _busy = true; _err = null; for (final l in _lines) { l.serverErr = null; } });
    try {
      final d = await Api.instance.post(widget.cfg.base, {
        'date': _date,
        'vehiclePlate': _plate.trim(),
        'issueReason': _issueReason,
        'note': _note.text.trim(),
        'lines': [for (final l in filled) {'item': l.item?['_id'], 'quantity': num.tryParse(l.qty.text.trim()) ?? 0}],
      });
      if (!mounted) return;
      Navigator.pop(context, Map<String, dynamic>.from(d['request'] ?? {}));
    } on ApiException catch (e) {
      final errs = e.data['errors'];
      if (errs is List) {
        for (final x in errs) {
          final n = x is Map ? (_num(x['line']).toInt() - 1) : -1;
          if (n >= 0 && n < filled.length) filled[n].serverErr = '${x['message'] ?? ''}';
        }
      }
      if (mounted) setState(() { _busy = false; _err = e.message; });
    } catch (e) {
      if (mounted) setState(() { _busy = false; _err = e.toString(); });
    }
  }

  @override
  Widget build(BuildContext context) {
    final computed = _computed();
    final filled = _lines.where((l) => l.item != null || l.qty.text.trim().isNotEmpty).toList();
    final incomplete = filled.any((l) => l.item == null || !((num.tryParse(l.qty.text.trim()) ?? 0) > 0));
    final anyErr = computed.any((c) => c.$2 != null);
    final canSave = _date.isNotEmpty && _plate.trim().isNotEmpty && _issueReason.isNotEmpty && filled.isNotEmpty && !incomplete && !anyErr && !_busy;
    final hit = _plates.where((p) => storePlateKey(p['plate']) == storePlateKey(_plate)).firstOrNull;
    return Scaffold(
      appBar: AppBar(title: Text(tr('طلب صرف', 'Issue request'))),
      body: ListView(padding: const EdgeInsets.fromLTRB(16, 14, 16, 100), children: [
        Text(tr('يُخصم الرصيد عند الحفظ. لا يُعدَّل الطلب بعد حفظه؛ يُلغى ويُعاد إن لزم.', 'Stock is deducted on save. A saved request is not edited; cancel it and raise a new one.'),
            style: const TextStyle(fontSize: 12, color: T.inkFaint)),
        const SizedBox(height: 10),
        // The actual issue day, chosen (the entry can follow the paper); the server keeps when it was recorded.
        OutlinedButton.icon(
          style: OutlinedButton.styleFrom(alignment: AlignmentDirectional.centerStart, padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12)),
          onPressed: () async {
            final today = _todayRiyadh();
            final d = await showDatePicker(context: context, initialDate: DateTime.tryParse(_date) ?? today, firstDate: DateTime(today.year - 2), lastDate: today);
            if (d != null && mounted) setState(() => _date = _ymd(d));
          },
          icon: const Icon(Icons.event_outlined, size: 18),
          label: Text(_date.isEmpty ? tr('اختر تاريخ الصرف *', 'Pick the issue date *') : '${tr('تاريخ الصرف', 'Issue date')}: ${_dmy(_date)}'),
        ),
        const SizedBox(height: 10),
        OutlinedButton.icon(
          style: OutlinedButton.styleFrom(alignment: AlignmentDirectional.centerStart, padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12)),
          onPressed: () async {
            final r = await pickStorePlate(context, _plates);
            if (r != null && mounted) setState(() => _plate = (r['plate'] ?? '').toString());
          },
          icon: const Icon(Icons.two_wheeler_outlined, size: 18),
          label: Text(_plate.isEmpty ? tr('اختر المركبة / اللوحة *', 'Pick the vehicle / plate *') : _plate),
        ),
        if (hit != null && ('${hit['project']}${hit['rider']}').isNotEmpty)
          Padding(
            padding: const EdgeInsets.only(top: 4),
            child: Text([if ('${hit['project']}'.isNotEmpty) '${tr('مشروع', 'Project')}: ${hit['project']}', if ('${hit['rider']}'.isNotEmpty) hit['rider']].join(' · '),
                style: const TextStyle(fontSize: 11.5, color: T.inkSoft)),
          ),
        const SizedBox(height: 12),
        IssueReasonPicker(value: _issueReason, onChanged: (v) => setState(() => _issueReason = v)),
        const SizedBox(height: 14),
        Text(tr('قطع الغيار المطلوبة', 'Requested parts'), style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 14)),
        const SizedBox(height: 6),
        for (final (i, l) in _lines.indexed)
          Container(
            margin: const EdgeInsets.only(bottom: 8),
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(
              color: computed[i].$2 != null ? T.danger.withValues(alpha: 0.05) : Colors.white,
              border: Border.all(color: computed[i].$2 != null ? T.danger.withValues(alpha: 0.4) : T.line),
              borderRadius: BorderRadius.circular(12),
            ),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Row(children: [
                Text('${i + 1}', style: const TextStyle(color: T.inkFaint, fontWeight: FontWeight.w800)),
                const SizedBox(width: 8),
                Expanded(child: InkWell(
                  onTap: () => _pickItem(l),
                  child: Padding(
                    padding: const EdgeInsets.symmetric(vertical: 6),
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Text(l.item == null ? tr('اختر الصنف (بالاسم أو الكود) *', 'Pick the item (name or code) *') : '${l.item!['name']}',
                          style: TextStyle(fontWeight: FontWeight.w800, color: l.item == null ? T.inkFaint : T.ink)),
                      if (l.item != null)
                        Text([if ('${l.item!['code'] ?? ''}'.isNotEmpty) '${tr('كود', 'Code')}: ${l.item!['code']}', '${tr('المتاح', 'In stock')}: ${_fq(l.item!['quantity'])} ${l.item!['unit'] ?? ''}'].join(' · '),
                            style: const TextStyle(fontSize: 11.5, color: T.inkSoft)),
                    ]),
                  ),
                )),
                if (_lines.length > 1)
                  IconButton(
                    icon: const Icon(Icons.delete_outline, color: T.danger, size: 20),
                    onPressed: () => setState(() { _lines.removeAt(i).qty.dispose(); }),
                  ),
              ]),
              Row(children: [
                Expanded(child: TextField(
                  controller: l.qty,
                  keyboardType: const TextInputType.numberWithOptions(decimal: true),
                  onChanged: (_) => setState(() => l.serverErr = null),
                  decoration: InputDecoration(isDense: true, labelText: tr('الكمية *', 'Qty *'), suffixText: '${l.item?['unit'] ?? ''}'),
                )),
                const SizedBox(width: 12),
                Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
                  Text(tr('الرصيد بعد الصرف', 'Balance after'), style: const TextStyle(fontSize: 11, color: T.inkFaint)),
                  Text(computed[i].$1 == null ? '—' : '${_fq(computed[i].$1)} ${l.item?['unit'] ?? ''}',
                      style: TextStyle(fontWeight: FontWeight.w900, color: (computed[i].$1 ?? 0) < 0 ? T.danger : T.ink)),
                ]),
              ]),
              if (computed[i].$2 != null)
                Padding(padding: const EdgeInsets.only(top: 4), child: Text(computed[i].$2!, style: const TextStyle(fontSize: 11.5, color: T.danger, fontWeight: FontWeight.w700))),
            ]),
          ),
        Align(
          alignment: AlignmentDirectional.centerStart,
          child: TextButton.icon(onPressed: () => setState(() => _lines.add(_Line())), icon: const Icon(Icons.add), label: Text(tr('سطر آخر', 'Another line'))),
        ),
        TextField(controller: _note, decoration: InputDecoration(labelText: tr('ملاحظة (اختياري)', 'Note (optional)'))),
        if (_err != null) Padding(padding: const EdgeInsets.only(top: 10), child: Text(_err!, style: const TextStyle(color: T.danger, fontWeight: FontWeight.w700))),
      ]),
      bottomNavigationBar: SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 6, 16, 10),
          child: FilledButton(
            style: FilledButton.styleFrom(backgroundColor: T.orange, padding: const EdgeInsets.symmetric(vertical: 14)),
            onPressed: canSave ? _save : null,
            child: Text(_busy ? tr('جارٍ الحفظ…', 'Saving…') : tr('حفظ وصرف (${filled.length} سطر)', 'Save & issue (${filled.length} lines)')),
          ),
        ),
      ),
    );
  }
}

/// Item search by name, supplier name or code.
class _ItemPicker extends StatefulWidget {
  final List<Map<String, dynamic>> items;
  const _ItemPicker({required this.items});
  @override
  State<_ItemPicker> createState() => _ItemPickerState();
}

class _ItemPickerState extends State<_ItemPicker> {
  String _q = '';
  String _fold(String x) => x.replaceAll(RegExp('[أإآ]'), 'ا').replaceAll('ى', 'ي').replaceAll('ة', 'ه').toLowerCase();

  @override
  Widget build(BuildContext context) {
    final words = _fold(_q.trim()).split(RegExp(r'\s+')).where((w) => w.isNotEmpty).toList();
    final list = widget.items.where((i) {
      final hay = _fold('${i['name']} ${i['code'] ?? ''} ${i['supplierItemName'] ?? ''}');
      return words.every(hay.contains);
    }).toList();
    return SafeArea(
      child: Padding(
        padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
        child: SizedBox(
          height: MediaQuery.of(context).size.height * 0.75,
          child: Column(children: [
            Padding(
              padding: const EdgeInsets.all(14),
              child: SearchField(autofocus: true, hint: tr('اسم الصنف أو الكود…', 'Item name or code…'), onChanged: (v) => setState(() => _q = v)),
            ),
            const Divider(height: 1),
            Expanded(
              child: ListView.builder(
                keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
                itemCount: list.length,
                itemBuilder: (c, i) {
                  final it = list[i];
                  final stock = _num(it['quantity']);
                  return ListTile(
                    dense: true,
                    title: Text('${it['name']}', style: const TextStyle(fontWeight: FontWeight.w700)),
                    subtitle: Text([if ('${it['code'] ?? ''}'.isNotEmpty) '${tr('كود', 'Code')}: ${it['code']}', if ('${it['supplierItemName'] ?? ''}'.isNotEmpty) '${it['supplierItemName']}'].join(' · ')),
                    trailing: Text('${_fq(stock)} ${it['unit'] ?? ''}', style: TextStyle(fontWeight: FontWeight.w800, color: stock > 0 ? T.ink : T.danger)),
                    onTap: () => Navigator.pop(c, it),
                  );
                },
              ),
            ),
          ]),
        ),
      ),
    );
  }
}
