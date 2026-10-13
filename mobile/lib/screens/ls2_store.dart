import 'dart:async';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../services/api.dart';
import '../services/auth.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/lookup_field.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';

/// مخزن النقل الثقيل (LS2) — قطع الغيار: أصناف برصيد وسعر وحالة، حركات وارد/صادر
/// (صادر على عربية / وارد من عربية)، إضافة أصناف، وسجل حركات. مطابق للويب.
/// ومع كلّ صنفٍ موردُه ويومُ شرائه؛ والعددُ لا يتغيّر إلّا بحركة.
/// شاشةُ المخزن — للنقل الثقيل وللنقل الخفيف معًا.
///
/// ── ولماذا شاشةٌ واحدة ──────────────────────────────────────────────────────
/// سؤالُ المخزن واحدٌ في القسمين: ماذا عندنا، وكم بقي، ومن صرف ماذا على أيّ
/// مركبة، وما الذي قارب النفاد. وآليّتُه واحدةٌ حرفًا بحرف — وارد وصادر، رصيدٌ
/// بعد كلّ حركة، وتراجعٌ بحركةٍ معاكسةٍ لا بمسح. وأصنافُ المخزنين وأرصدتُهما
/// منفصلةٌ في القاعدة (`warehouse`)، فلا يُقرأ رصيدُ أحدهما في الآخر.
///
/// فيُمرَّر `base` ولا تُنسَخ الشاشة — ونسخُها يعني شاشتين تفترقان أوّلَ إصلاح.
class Ls2StoreScreen extends StatefulWidget {
  final String base;
  final String titleAr;
  final String titleEn;
  /// مصدرُ المركبات التي يُصرَف عليها: `heavy` أو `light`.
  ///
  /// ── وكان مصدرًا واحدًا للمخزنين ──────────────────────────────────────────
  /// كانت القائمةُ تُجلَب من `/api/ls2/vehicles` دائمًا — أي شاحناتُ النقل
  /// الثقيل — فمن يصرف قطعةَ دراجةٍ في مخزن النقل الخفيف يُعرَض له سبعٌ
  /// وخمسون شاحنةً لا علاقةَ لها بما في يده، ولا تظهر دراجتُه أصلًا.
  final String vehiclesKind;
  const Ls2StoreScreen({
    super.key,
    this.base = '/api/ls2/store',
    this.titleAr = 'مخزن النقل الثقيل',
    this.titleEn = 'Heavy Transport Store',
    this.vehiclesKind = 'heavy',
  });
  @override
  State<Ls2StoreScreen> createState() => _Ls2StoreScreenState();
}

String _money(dynamic v) {
  final n = (v is num) ? v : num.tryParse(v?.toString() ?? '') ?? 0;
  final s = n.round().toString();
  final b = StringBuffer();
  for (int i = 0; i < s.length; i++) { if (i > 0 && (s.length - i) % 3 == 0) b.write(','); b.write(s[i]); }
  return b.toString();
}

const _statusMeta = {
  'ok': ('متوفر', 'In stock', T.success),
  'low': ('منخفض', 'Low', T.warn),
  'out': ('نافد', 'Out', T.danger),
};

class _Ls2StoreScreenState extends State<Ls2StoreScreen> {
  List<Map<String, dynamic>> _items = [];
  Map<String, dynamic> _totals = {};
  List<Map<String, dynamic>> _cats = [];
  List<Map<String, dynamic>> _plates = [];
  bool _loading = true;
  String? _error;
  String _q = '';
  String _statusF = '';
  String _catF = '';
  // يومُ الشراء والمورد — يُفلتَران في الخادم، لا فيما جُلب.
  String _from = '';
  String _to = '';
  String _supplierF = '';
  List<Map<String, dynamic>> _suppliers = [];
  // الطلبُ الأوسعُ أبطأ، فيصل بعد الأضيق ويكتب فوقه — فلا يُقبَل إلّا آخرُ طلب.
  int _seq = 0;
  Timer? _debounce;
  late final void Function() _onLive;

  /// نقاطُ الموردين بجوار نقاط المخزن: `/store` ← `/suppliers`.
  String get _supBase => widget.base.replaceFirst(RegExp(r'/store$'), '/suppliers');

  @override
  void initState() {
    super.initState();
    _load();
    _loadPlates();
    _loadSuppliers();
    // موردٌ يُضاف من شاشة «الموردون» أو مع صنفٍ جديدٍ يُعلَن بالحدث نفسِه.
    _onLive = () { _load(); _loadSuppliers(); };
    Live.instance.on('ls2:store', _onLive);
  }

  @override
  void dispose() {
    Live.instance.off('ls2:store', _onLive);
    _debounce?.cancel();
    super.dispose();
  }

  Future<void> _loadSuppliers() async {
    try {
      final d = await Api.instance.get(_supBase);
      if (mounted) setState(() => _suppliers = List<Map<String, dynamic>>.from(d['suppliers'] ?? []));
    } catch (_) {/* القائمةُ تبقى كما هي — ويُكتب اسمُ المورد يدًا */}
  }

  /// مفتاحُ اللوحة: السجلّان يكتبانها بصيغتين، فتُطابَق بحروفها وأرقامها.
  String _pk(dynamic v) => (v ?? '').toString().replaceAll(RegExp(r'[^0-9A-Za-z\u0621-\u064A]'), '').toUpperCase();

  /// المركباتُ التي يُصرَف عليها — ومعها ما يُعرَف عنها (المشروعُ أوّلًا).
  Future<void> _loadPlates() async {
    try {
      if (widget.vehiclesKind == 'light') {
        // سجلُّ مركبات القسم موصولًا براكبها الحاليّ — ومنه المشروعُ والفرع.
        final d = await Api.instance.get('/api/light-transport/orders/options');
        final riders = <String, Map<String, dynamic>>{};
        for (final e in List<Map<String, dynamic>>.from(d['employees'] ?? [])) {
          final k = _pk(e['vehiclePlate']);
          if (k.isNotEmpty) riders.putIfAbsent(k, () => e);
        }
        final rows = <Map<String, dynamic>>[];
        for (final v in List<Map<String, dynamic>>.from(d['vehicles'] ?? [])) {
          final r = riders[_pk(v['plateNumber'])];
          rows.add({
            'plate': (v['plateNumber'] ?? '').toString(),
            'project': (r?['projectAr'] ?? '').toString(),
            'rider': (r?['name'] ?? v['authorizedName'] ?? '').toString(),
            'city': (r?['cityAr'] ?? '').toString(),
            'detail': [v['typeAr'], v['brand']].where((x) => (x ?? '').toString().isNotEmpty).join(' '),
          });
        }
        // ولوحةٌ على موظّفٍ وليست في سجلّ المركبات تُضاف: الصرفُ عليها واقعٌ.
        final have = rows.map((r) => _pk(r['plate'])).toSet();
        for (final e in riders.entries) {
          if (!have.contains(e.key)) {
            rows.add({
              'plate': (e.value['vehiclePlate'] ?? '').toString(),
              'project': (e.value['projectAr'] ?? '').toString(),
              'rider': (e.value['name'] ?? '').toString(),
              'city': (e.value['cityAr'] ?? '').toString(),
              'detail': '',
            });
          }
        }
        rows.sort((a, b) => a['plate'].toString().compareTo(b['plate'].toString()));
        if (mounted) setState(() => _plates = rows.where((r) => r['plate'].toString().isNotEmpty).toList());
      } else {
        // النقطةُ تردّ `items` لا `vehicles` — وكانت القائمةُ تخرج فارغةً بلا خطأ.
        final d = await Api.instance.get('/api/ls2/vehicles');
        final rows = List<Map<String, dynamic>>.from(d['items'] ?? []).map((v) => {
              'plate': (v['plate'] ?? '').toString(),
              'project': '',
              'rider': (v['driverName'] ?? '').toString(),
              'city': '',
              'detail': [v['name'], v['brand']].where((x) => (x ?? '').toString().isNotEmpty).join(' '),
            }).where((r) => r['plate'].toString().isNotEmpty).toList();
        if (mounted) setState(() => _plates = rows);
      }
    } catch (_) { /* القائمةُ تبقى فارغةً وتُكتَب اللوحةُ يدًا */ }
  }

  /// ── منتقي المركبة: قائمةٌ تُبحَث، ومعها مشروعُها ───────────────────────────
  /// كان `Autocomplete` يُطابق النصَّ حرفيًّا على اللوحة وحدَها: لا يُبحَث
  /// بمشروعٍ ولا باسم راكب، ولا يُعرَض شيءٌ غيرُ اللوحة — ومن يصرف يسأل «هذه
  /// تبع أيّ مشروع؟».
  Future<Map<String, dynamic>?> _pickPlate() {
    return showModalBottomSheet<Map<String, dynamic>>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (c) {
        String q = '';
        String fold(String x) => x
            .replaceAll(RegExp('[أإآ]'), 'ا').replaceAll('ى', 'ي').replaceAll('ة', 'ه')
            .replaceAll(' ', '').toLowerCase();
        return StatefulBuilder(builder: (c, setS) {
          final fq = fold(q.trim());
          final list = _plates.where((r) => fq.isEmpty
              || fold('${r['plate']} ${r['project']} ${r['rider']} ${r['city']} ${r['detail']}').contains(fq)).toList();
          return SafeArea(
            child: Padding(
              padding: EdgeInsets.only(bottom: MediaQuery.of(c).viewInsets.bottom),
              child: SizedBox(
                height: MediaQuery.of(c).size.height * 0.7,
                child: Column(children: [
                  Padding(
                    padding: const EdgeInsets.all(14),
                    child: TextField(
                      autofocus: true,
                      onChanged: (v) => setS(() => q = v),
                      decoration: InputDecoration(
                        hintText: tr('اللوحة أو المشروع أو اسم الراكب…', 'Plate, project or rider…'),
                        prefixIcon: const Icon(Icons.search),
                      ),
                    ),
                  ),
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 14),
                    child: Align(
                      alignment: AlignmentDirectional.centerStart,
                      child: Text(tr('${list.length} من ${_plates.length} مركبة', '${list.length} of ${_plates.length}'),
                          style: const TextStyle(fontSize: 11.5, color: T.inkFaint)),
                    ),
                  ),
                  const Divider(height: 14),
                  Expanded(
                    child: ListView.builder(
                      itemCount: list.length,
                      itemBuilder: (c, i) {
                        final r = list[i];
                        final sub = [
                          if ((r['project'] ?? '').toString().isNotEmpty) '${tr('مشروع', 'project')}: ${r['project']}',
                          if ((r['rider'] ?? '').toString().isNotEmpty) r['rider'],
                          if ((r['city'] ?? '').toString().isNotEmpty) r['city'],
                          if ((r['detail'] ?? '').toString().isNotEmpty) r['detail'],
                        ].join(' · ');
                        return ListTile(
                          dense: true,
                          title: Text(r['plate'].toString(), style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 14)),
                          subtitle: sub.isEmpty ? null : Text(sub, style: const TextStyle(fontSize: 11.5)),
                          onTap: () => Navigator.pop(c, r),
                        );
                      },
                    ),
                  ),
                ]),
              ),
            ),
          );
        });
      },
    );
  }

  Future<void> _load() async {
    final seq = ++_seq;
    final qs = [
      if (_q.trim().isNotEmpty) 'q=${Uri.encodeComponent(_q.trim())}',
      if (_from.isNotEmpty) 'from=$_from',
      if (_to.isNotEmpty) 'to=$_to',
      if (_supplierF.isNotEmpty) 'supplier=$_supplierF',
    ].join('&');
    try {
      final res = await Future.wait([
        Api.instance.get('${widget.base}${qs.isEmpty ? '' : '?$qs'}'),
        Api.instance.get('${widget.base}/dashboard'),
      ]);
      if (!mounted || seq != _seq) return;
      setState(() {
        _items = List<Map<String, dynamic>>.from(res[0]['items'] ?? []);
        _totals = Map<String, dynamic>.from(res[1]['totals'] ?? {});
        _cats = List<Map<String, dynamic>>.from(res[1]['byCategory'] ?? []);
        _loading = false; _error = null;
      });
    } catch (e) { if (mounted && seq == _seq) setState(() { _loading = false; _error = e.toString(); }); }
  }

  String _sLabel(String s) { final m = _statusMeta[s]; return m == null ? s : tr(m.$1, m.$2); }
  Color _sColor(String s) => _statusMeta[s]?.$3 ?? T.inkFaint;

  void _setPeriod(String from, String to) {
    setState(() { _from = from; _to = to; });
    _load();
  }

  @override
  Widget build(BuildContext context) {
    final canEdit = _canEditStore(context.watch<AuthProvider>());
    final items = _items.where((i) => (_statusF.isEmpty || i['status'] == _statusF) && (_catF.isEmpty || i['category'] == _catF)).toList();
    return AppScaffold(
      title: Text(tr(widget.titleAr, widget.titleEn)),
      actions: [
        // فاتورةُ شراءٍ واحدةٌ فيها عدّةُ أصناف — تُكتب في نموذجٍ واحد.
        if (canEdit) IconButton(icon: const Icon(Icons.playlist_add), tooltip: tr('إضافة عدّة أصناف', 'Add several items'), onPressed: _openBulkCreate),
        IconButton(icon: const Icon(Icons.history), tooltip: tr('سجل الحركات', 'Movements'), onPressed: _openLog),
      ],
      floatingActionButton: !canEdit ? null : FloatingActionButton.extended(
        backgroundColor: const Color(0xFF12325C), foregroundColor: Colors.white,
        icon: const Icon(Icons.add), label: Text(tr('صنف', 'Item')), onPressed: () => _openItemForm(null),
      ),
      body: _loading && _items.isEmpty
          ? ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(height: 70), SizedBox(height: 10), Shimmer(), SizedBox(height: 10), Shimmer()])
          : _error != null
              ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
              : Column(children: [
                  // بطاقات
                  Padding(
                    padding: const EdgeInsets.fromLTRB(12, 12, 12, 4),
                    child: Row(children: [
                      Expanded(child: _tile(tr('الأصناف', 'Items'), '${_totals['items'] ?? _items.length}', T.orange)),
                      const SizedBox(width: 6),
                      Expanded(child: _tile(tr('القيمة', 'Value'), _money(_totals['totalValue']), T.success)),
                      const SizedBox(width: 6),
                      Expanded(child: _tileTap(tr('منخفض', 'Low'), '${_totals['lowStock'] ?? 0}', T.warn, 'low')),
                      const SizedBox(width: 6),
                      Expanded(child: _tileTap(tr('نافد', 'Out'), '${_totals['outOfStock'] ?? 0}', T.danger, 'out')),
                    ]),
                  ),
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                    child: Row(children: [
                      Expanded(child: TextField(
                        onChanged: (v) {
                          _q = v;
                          _debounce?.cancel();
                          _debounce = Timer(const Duration(milliseconds: 300), _load);
                        },
                        decoration: InputDecoration(hintText: tr('ابحث بالاسم/الكود/الموديل…', 'name / code / model…'), prefixIcon: const Icon(Icons.search), isDense: true),
                      )),
                      if (_statusF.isNotEmpty) Padding(padding: const EdgeInsets.only(right: 6, left: 6), child: InputChip(label: Text(_sLabel(_statusF)), onDeleted: () => setState(() => _statusF = ''))),
                    ]),
                  ),
                  if (_cats.isNotEmpty)
                    SizedBox(
                      height: 38,
                      child: ListView(scrollDirection: Axis.horizontal, padding: const EdgeInsets.symmetric(horizontal: 12), children: [
                        _fchip(tr('الكل', 'All'), _catF.isEmpty, () => setState(() => _catF = '')),
                        ..._cats.map((c) {
                          final k = (c['key'] ?? '').toString();
                          final sel = _catF == k;
                          return _fchip('${Lang.instance.ar ? (c['ar'] ?? k) : k} (${c['count']})', sel, () => setState(() => _catF = sel ? '' : k));
                        }),
                      ]),
                    ),
                  // المورد ويومُ الشراء — يُرسَلان إلى الخادم.
                  SizedBox(
                    height: 38,
                    child: ListView(scrollDirection: Axis.horizontal, padding: const EdgeInsets.symmetric(horizontal: 12), children: [
                      _fchip(
                        _supplierF.isEmpty ? tr('كل الموردين', 'All suppliers') : _supplierLabel(_suppliers, _supplierF),
                        _supplierF.isNotEmpty,
                        () async {
                          final v = await _pickSupplier(context, _suppliers, _supplierF, allowNew: false, noneLabel: tr('كل الموردين', 'All suppliers'));
                          if (v == null || !mounted) return;
                          setState(() => _supplierF = v);
                          _load();
                        },
                      ),
                      Center(child: Padding(
                        padding: const EdgeInsetsDirectional.only(start: 4, end: 8),
                        child: Text(tr('تاريخ الشراء', 'Purchase date'), style: const TextStyle(fontSize: 11, color: T.inkFaint, fontWeight: FontWeight.w600)),
                      )),
                      ..._periodChips(context, _from, _to, _setPeriod),
                    ]),
                  ),
                  Expanded(
                    child: RefreshIndicator(
                      onRefresh: _load,
                      child: items.isEmpty
                          ? EmptyState(icon: Icons.inventory_2_outlined, title: tr('لا توجد أصناف مطابقة', 'No items'))
                          : ListView.separated(
                              padding: const EdgeInsets.fromLTRB(12, 12, 12, 88),
                              itemCount: items.length,
                              separatorBuilder: (_, __) => const SizedBox(height: 8),
                              itemBuilder: (c, i) {
                                final it = items[i];
                                final st = (it['status'] ?? 'ok').toString();
                                final bought = [
                                  if ((it['purchaseDate'] ?? '').toString().isNotEmpty) '${tr('تاريخ الشراء', 'Purchased')}: ${_dmy(it['purchaseDate'])}',
                                  if ((it['supplierName'] ?? '').toString().isNotEmpty) '${tr('المورد', 'Supplier')}: ${it['supplierName']}',
                                ].join(' · ');
                                return Pressable(
                                  onTap: canEdit ? () => _openItemForm(it) : null,
                                  child: AppCard(
                                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                      Row(children: [
                                        Expanded(child: Text((it['name'] ?? '').toString(), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14))),
                                        Chip2(_sLabel(st), _sColor(st)),
                                      ]),
                                      if ((it['categoryAr'] ?? it['category'] ?? '').toString().isNotEmpty || (it['compatibleModels'] as List?)?.isNotEmpty == true)
                                        Padding(padding: const EdgeInsets.only(top: 2), child: Text([it['categoryAr'] ?? it['category'], ...((it['compatibleModels'] as List?) ?? [])].where((x) => (x ?? '').toString().isNotEmpty).join(' · '), style: const TextStyle(fontSize: 11, color: T.inkFaint), maxLines: 1, overflow: TextOverflow.ellipsis)),
                                      if (bought.isNotEmpty)
                                        Padding(padding: const EdgeInsets.only(top: 2), child: Text(bought, style: const TextStyle(fontSize: 11, color: T.inkSoft), maxLines: 1, overflow: TextOverflow.ellipsis)),
                                      const SizedBox(height: 8),
                                      // العدد × سعر القطعة = الإجمالي
                                      Wrap(spacing: 14, runSpacing: 4, children: [
                                        _kv(tr('العدد', 'Qty'), '${it['quantity']} ${it['unit'] ?? ''}', T.ink),
                                        _kv(tr('سعر القطعة', 'Unit price'), _money(it['unitPrice']), T.inkSoft),
                                        _kv(tr('الإجمالي', 'Total'), _money(it['value']), T.success),
                                      ]),
                                      if (canEdit) ...[
                                      const SizedBox(height: 8),
                                      Row(children: [
                                        Expanded(child: OutlinedButton.icon(
                                          style: OutlinedButton.styleFrom(foregroundColor: T.success, side: const BorderSide(color: T.success), padding: const EdgeInsets.symmetric(vertical: 6)),
                                          icon: const Icon(Icons.south, size: 16), label: Text(tr('وارد', 'In')),
                                          onPressed: () => _openMovement(it, 'in'),
                                        )),
                                        const SizedBox(width: 8),
                                        Expanded(child: OutlinedButton.icon(
                                          style: OutlinedButton.styleFrom(foregroundColor: T.orange, side: const BorderSide(color: T.orange), padding: const EdgeInsets.symmetric(vertical: 6)),
                                          icon: const Icon(Icons.north, size: 16), label: Text(tr('صادر', 'Out')),
                                          onPressed: () => _openMovement(it, 'out'),
                                        )),
                                      ]),
                                      ],
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

  Widget _kv(String label, String value, Color color) => Row(mainAxisSize: MainAxisSize.min, children: [
        Text('$label: ', style: const TextStyle(fontSize: 11.5, color: T.inkFaint)),
        Text(value, style: TextStyle(fontWeight: FontWeight.w800, fontSize: 12.5, color: color)),
      ]);

  Widget _tile(String label, String value, Color color) => AppCard(
        padding: const EdgeInsets.all(10),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          FittedBox(fit: BoxFit.scaleDown, alignment: AlignmentDirectional.centerStart, child: Text(value, style: TextStyle(fontSize: 17, fontWeight: FontWeight.w900, color: color, height: 1))),
          const SizedBox(height: 2),
          Text(label, style: const TextStyle(fontSize: 10, color: T.inkSoft, fontWeight: FontWeight.w600)),
        ]),
      );
  Widget _tileTap(String label, String value, Color color, String status) => Pressable(
        onTap: () => setState(() => _statusF = _statusF == status ? '' : status),
        child: _tile(label, value, color),
      );

  void _toast(String msg) {
    if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg)));
  }

  // ── حركة وارد/صادر ──
  Future<void> _openMovement(Map<String, dynamic> it, String type) async {
    final ok = await showModalBottomSheet<bool>(
      context: context, isScrollControlled: true, backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (_) => _MovementSheet(base: widget.base, item: it, type: type, suppliers: _suppliers, plates: _plates, pickPlate: _pickPlate, pk: _pk),
    );
    if (ok != true) return;
    _toast(tr('تم التسجيل', 'Recorded'));
    _load();
    _loadSuppliers();
  }

  // ── إضافة/تعديل صنف ──
  Future<void> _openItemForm(Map<String, dynamic>? item) async {
    final saved = await showModalBottomSheet<bool>(
      context: context, isScrollControlled: true, backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (_) => _ItemFormSheet(base: widget.base, item: item, suppliers: _suppliers),
    );
    if (saved != true) return;
    _toast(tr('تم الحفظ', 'Saved'));
    _load();
    _loadSuppliers();
  }

  // ── إضافة عدّة أصناف ──
  Future<void> _openBulkCreate() async {
    final count = await Navigator.push<int>(context, MaterialPageRoute(
      fullscreenDialog: true,
      builder: (_) => _BulkCreateScreen(base: widget.base, suppliers: _suppliers),
    ));
    if (count == null) return;
    _toast(tr('أُضيف $count صنفًا', 'Added $count items'));
    _load();
    _loadSuppliers();
  }

  // ── التراجع عن حركة ──
  // الحركةُ المسجَّلةُ لا تُعدَّل (قرارُ الإدارة الماليّة) — الخطأُ يُصحَّح بحركةٍ
  // معاكسةٍ بسببٍ مكتوب، وتبقى الاثنتان في السجلّ. ولا شاشةَ تعديلٍ هنا عن قصد.
  Future<bool> _reverse(Map<String, dynamic> m) async {
    final reason = TextEditingController();
    final isIn = m['type'] == 'in';
    final go = await showDialog<bool>(
      context: context,
      builder: (c) => StatefulBuilder(builder: (c2, setInner) => AlertDialog(
        title: Text(tr('التراجع عن الحركة', 'Reverse movement'), style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 16)),
        content: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text('${m['itemName']} · ${isIn ? tr('وارد', 'In') : tr('صادر', 'Out')} ${m['quantity']}'
              '${(m['performedByName'] ?? '').toString().isEmpty ? '' : ' · ${m['performedByName']}'}',
              style: const TextStyle(fontSize: 12.5, color: T.inkSoft)),
          const SizedBox(height: 12),
          TextField(
            controller: reason, autofocus: true, maxLines: 2,
            onChanged: (_) => setInner(() {}),
            decoration: InputDecoration(
              labelText: tr('سبب التراجع *', 'Reason *'),
              hintText: tr('مثال: سُجِّلت على مركبةٍ أخرى خطأً', 'e.g. wrong vehicle'),
            ),
          ),
          const SizedBox(height: 10),
          Text(
            tr('الحركة الأصلية لا تُعدَّل ولا تُحذَف — تبقى في السجل، وتُسجَّل بجوارها حركة معاكسة باسمك وبسببك.',
               'The original is neither edited nor deleted — an opposite entry is recorded under your name and reason.'),
            style: const TextStyle(fontSize: 11, color: T.inkFaint, height: 1.45)),
        ]),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c2, false), child: Text(tr('إلغاء', 'Cancel'))),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: T.danger),
            onPressed: reason.text.trim().length < 3 ? null : () => Navigator.pop(c2, true),
            child: Text(tr('تأكيد التراجع', 'Confirm')),
          ),
        ],
      )),
    );
    if (go != true) return false;
    try {
      await Api.instance.post('${widget.base}/movements/${m['_id']}/reverse', {'reason': reason.text.trim()});
      _toast(tr('تم التراجع وعاد الرصيد كما كان', 'Reversed'));
      _load();
      return true;
    } catch (e) {
      _toast(e is ApiException ? e.message : e.toString());
      return false;
    }
  }

  // ── سجل الحركات ──
  Future<void> _openLog() async {
    final canEdit = _canEditStore(context.read<AuthProvider>());
    await showModalBottomSheet(
      context: context, isScrollControlled: true, backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (_) => _LogSheet(base: widget.base, suppliers: _suppliers, canEdit: canEdit, reverse: _reverse),
    );
  }
}

// The API lets a «تعديل» grant on Location Solutions through and refuses a
// «عرض» one — offer the write actions on exactly that line, so a read-only
// user isn't handed buttons that 403.
bool _canEditStore(AuthProvider auth) =>
    const ['super_admin', 'admin', 'it_manager', 'operations_manager', 'operations_staff', 'moderator'].contains(auth.role)
    || auth.canEditSection('Location Solutions');

// ═════════════════════════════════════════════════════════════════════════════
// أدواتٌ مشتركةٌ بين النماذج: التاريخ، المورد، الفترة
// ═════════════════════════════════════════════════════════════════════════════

num _numOf(dynamic v) => v is num ? v : num.tryParse(v?.toString() ?? '') ?? 0;

String _ymd(DateTime d) =>
    '${d.year.toString().padLeft(4, '0')}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';

/// «اليوم» بتوقيت الرياض — لا بتوقيت الهاتف: يومُ الشراء يُقرأ في الخادم بالرياض.
DateTime _riyadhNow() => DateTime.now().toUtc().add(const Duration(hours: 3));
String _todayYmd() => _ymd(_riyadhNow());

/// `2026-10-13` ← `13/10/2026`.
String _dmy(dynamic v) {
  final s = (v ?? '').toString();
  if (s.length < 10) return '—';
  return s.substring(0, 10).split('-').reversed.join('/');
}

/// المعرّفُ يأتي نصًّا، أو كائنًا فيه `_id` إن وُصِل السجلُّ بمورده.
String _idOf(dynamic v) => v is Map ? (v['_id'] ?? '').toString() : (v ?? '').toString();

bool _isId(String v) => RegExp(r'^[0-9a-fA-F]{24}$').hasMatch(v);

/// قيمةُ خانة المورد معرّفُ موردٍ قائمٍ أو اسمٌ جديد — والخادمُ ينشئ الجديد.
Map<String, dynamic> _supplierBody(String v) => _isId(v) ? {'supplier': v} : {'supplier': '', 'supplierName': v};

String _supplierLabel(List<Map<String, dynamic>> suppliers, String value, {String fallback = ''}) {
  if (value.isEmpty) return '';
  for (final s in suppliers) {
    if ((s['_id'] ?? '').toString() == value) return (s['name'] ?? '').toString();
  }
  if (_isId(value)) return fallback.isEmpty ? tr('مورد محذوف', 'Removed supplier') : fallback;
  return '$value ${tr('(جديد)', '(new)')}';
}

Widget _fchip(String label, bool selected, VoidCallback onTap) => Padding(
      padding: const EdgeInsetsDirectional.only(end: 6),
      child: FilterChip(
        selected: selected, label: Text(label), onSelected: (_) => onTap(),
        labelStyle: TextStyle(fontSize: 11.5, fontWeight: FontWeight.w700, color: selected ? Colors.white : T.navy),
        selectedColor: T.navy, backgroundColor: T.navy.withValues(alpha: 0.08), side: BorderSide.none, checkmarkColor: Colors.white,
      ),
    );

/// فلترُ الفترة: «اليوم»، «هذا الشهر»، أو فترةٌ تُنتقى (ويومٌ واحدٌ فترةٌ طرفاها
/// واحد). والحدّان `YYYY-MM-DD` كما ينتظرهما الخادم.
List<Widget> _periodChips(BuildContext context, String from, String to, void Function(String from, String to) onChanged) {
  final now = _riyadhNow();
  final today = _ymd(now);
  final mStart = _ymd(DateTime(now.year, now.month, 1));
  final mEnd = _ymd(DateTime(now.year, now.month + 1, 0));
  final isToday = from == today && to == today;
  final isMonth = from == mStart && to == mEnd;
  final any = from.isNotEmpty || to.isNotEmpty;
  final custom = any && !isToday && !isMonth;
  return [
    _fchip(tr('اليوم', 'Today'), isToday, () => isToday ? onChanged('', '') : onChanged(today, today)),
    _fchip(tr('هذا الشهر', 'This month'), isMonth, () => isMonth ? onChanged('', '') : onChanged(mStart, mEnd)),
    _fchip(
      custom ? (from == to ? _dmy(from) : '${_dmy(from)} – ${_dmy(to)}') : tr('فترة…', 'Range…'),
      custom,
      () async {
        final a = DateTime.tryParse(from), b = DateTime.tryParse(to);
        final r = await showDateRangePicker(
          context: context,
          firstDate: DateTime(2020), lastDate: DateTime(2100),
          initialDateRange: a != null && b != null && !b.isBefore(a) ? DateTimeRange(start: a, end: b) : null,
        );
        if (r != null) onChanged(_ymd(r.start), _ymd(r.end));
      },
    ),
    if (any)
      Padding(
        padding: const EdgeInsetsDirectional.only(end: 6),
        child: ActionChip(
          label: Text(tr('مسح', 'Clear')), avatar: const Icon(Icons.close, size: 14),
          labelStyle: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.w700, color: T.inkSoft),
          side: BorderSide.none, backgroundColor: T.line,
          onPressed: () => onChanged('', ''),
        ),
      ),
  ];
}

/// خانةُ تاريخٍ تُفتَح على التقويم. القيمةُ `YYYY-MM-DD` أو فارغة.
class _DateField extends StatelessWidget {
  final String label;
  final String value;
  final ValueChanged<String> onChanged;
  const _DateField({required this.label, required this.value, required this.onChanged});

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: () async {
        final d = await showDatePicker(
          context: context,
          initialDate: DateTime.tryParse(value) ?? DateTime.tryParse(_todayYmd())!,
          firstDate: DateTime(2020), lastDate: DateTime(2100),
        );
        if (d != null) onChanged(_ymd(d));
      },
      child: InputDecorator(
        isEmpty: value.isEmpty,
        decoration: InputDecoration(labelText: label, suffixIcon: const Icon(Icons.event, size: 18)),
        child: Text(value.isEmpty ? '' : _dmy(value), style: const TextStyle(fontSize: 14)),
      ),
    );
  }
}

/// خانةُ المورد: يُختار من القائمة، أو يُكتب اسمٌ جديدٌ فيُضاف مع الحفظ نفسِه.
class _SupplierField extends StatelessWidget {
  final List<Map<String, dynamic>> suppliers;
  final String value;
  /// اسمُ الموردِ المحفوظُ مع السجلّ — يُعرَض إن حُذف المورد من القائمة.
  final String fallbackName;
  final ValueChanged<String> onChanged;
  const _SupplierField({required this.suppliers, required this.value, required this.onChanged, this.fallbackName = ''});

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: () async {
        final v = await _pickSupplier(context, suppliers, value);
        if (v != null) onChanged(v);
      },
      child: InputDecorator(
        isEmpty: value.isEmpty,
        decoration: InputDecoration(
          labelText: tr('المورد', 'Supplier'),
          hintText: tr('اختر المورد أو اكتب اسمًا جديدًا', 'Pick a supplier or type a new one'),
          suffixIcon: const Icon(Icons.arrow_drop_down),
        ),
        child: Text(_supplierLabel(suppliers, value, fallback: fallbackName), style: const TextStyle(fontSize: 14), maxLines: 1, overflow: TextOverflow.ellipsis),
      ),
    );
  }
}

/// يردّ معرّفَ موردٍ، أو اسمًا جديدًا (إن سُمح)، أو نصًّا فارغًا لـ«بلا مورد» —
/// و`null` إن أُغلقت القائمةُ بلا اختيار.
Future<String?> _pickSupplier(BuildContext context, List<Map<String, dynamic>> suppliers, String current, {bool allowNew = true, String? noneLabel}) {
  return showModalBottomSheet<String>(
    context: context,
    isScrollControlled: true,
    backgroundColor: Colors.white,
    shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
    builder: (_) => _SupplierSheet(suppliers: suppliers, current: current, allowNew: allowNew, noneLabel: noneLabel ?? tr('— بلا مورد —', '— none —')),
  );
}

class _SupplierSheet extends StatefulWidget {
  final List<Map<String, dynamic>> suppliers;
  final String current;
  final bool allowNew;
  final String noneLabel;
  const _SupplierSheet({required this.suppliers, required this.current, required this.allowNew, required this.noneLabel});

  @override
  State<_SupplierSheet> createState() => _SupplierSheetState();
}

class _SupplierSheetState extends State<_SupplierSheet> {
  final _q = TextEditingController();

  @override
  void dispose() { _q.dispose(); super.dispose(); }

  @override
  Widget build(BuildContext context) {
    final typed = _q.text.trim();
    final k = typed.toLowerCase();
    final list = widget.suppliers.where((s) => k.isEmpty
        || [s['name'], s['phone'], s['city']].any((v) => (v ?? '').toString().toLowerCase().contains(k))).toList();
    final exact = widget.suppliers.any((s) => (s['name'] ?? '').toString().trim().toLowerCase() == k);
    return SafeArea(
      child: Padding(
        padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
        child: SizedBox(
          height: MediaQuery.of(context).size.height * 0.65,
          child: Column(children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(14, 14, 14, 6),
              child: TextField(
                controller: _q,
                onChanged: (_) => setState(() {}),
                decoration: InputDecoration(
                  hintText: widget.allowNew ? tr('ابحث أو اكتب اسمَ موردٍ جديد…', 'Search or type a new supplier…') : tr('ابحث عن مورد…', 'Search suppliers…'),
                  prefixIcon: const Icon(Icons.search),
                ),
              ),
            ),
            Expanded(
              child: ListView(children: [
                if (widget.allowNew && typed.isNotEmpty && !exact)
                  ListTile(
                    dense: true,
                    leading: const Icon(Icons.add_circle_outline, color: T.orange, size: 20),
                    title: Text(tr('إضافة «$typed» موردًا جديدًا', 'Add “$typed” as a new supplier'), style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13.5, color: T.orange)),
                    subtitle: Text(tr('يُنشأ المورد مع الحفظ.', 'Created on save.'), style: const TextStyle(fontSize: 11)),
                    onTap: () => Navigator.pop(context, typed),
                  ),
                ListTile(
                  dense: true,
                  title: Text(widget.noneLabel, style: const TextStyle(fontSize: 13, color: T.inkSoft)),
                  trailing: widget.current.isEmpty ? const Icon(Icons.check, color: T.success, size: 18) : null,
                  onTap: () => Navigator.pop(context, ''),
                ),
                ...list.map((s) {
                  final id = (s['_id'] ?? '').toString();
                  final sub = [s['city'], s['phone']].where((x) => (x ?? '').toString().isNotEmpty).join(' · ');
                  return ListTile(
                    dense: true,
                    title: Text((s['name'] ?? '').toString(), style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13.5)),
                    subtitle: sub.isEmpty ? null : Text(sub, style: const TextStyle(fontSize: 11.5)),
                    trailing: id == widget.current ? const Icon(Icons.check, color: T.success, size: 18) : null,
                    onTap: () => Navigator.pop(context, id),
                  );
                }),
                if (widget.suppliers.isEmpty && typed.isEmpty)
                  Padding(
                    padding: const EdgeInsets.all(20),
                    child: Text(
                      widget.allowNew ? tr('لا موردين بعد — اكتب اسمَ المورد في خانة البحث لإضافته.', 'No suppliers yet — type a name above to add one.') : tr('لا موردين بعد.', 'No suppliers yet.'),
                      textAlign: TextAlign.center, style: const TextStyle(fontSize: 12.5, color: T.inkFaint)),
                  ),
              ]),
            ),
          ]),
        ),
      ),
    );
  }
}

Widget _errBox(String msg) => Container(
      width: double.infinity,
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
      decoration: BoxDecoration(color: T.danger.withValues(alpha: 0.08), borderRadius: BorderRadius.circular(10)),
      child: Text(msg, style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: T.danger)),
    );

// ═════════════════════════════════════════════════════════════════════════════
// حركة وارد / صادر على صنفٍ واحد
// ═════════════════════════════════════════════════════════════════════════════

/// النموذجُ يحفظ بنفسه ويبقى مفتوحًا إن رُفض: شريطُ التنبيه يظهر خلف الورقة
/// المفتوحة فلا يُرى، فيُكتب الخطأُ فيها.
class _MovementSheet extends StatefulWidget {
  final String base;
  final Map<String, dynamic> item;
  final String type;
  final List<Map<String, dynamic>> suppliers;
  final List<Map<String, dynamic>> plates;
  final Future<Map<String, dynamic>?> Function() pickPlate;
  final String Function(dynamic) pk;
  const _MovementSheet({required this.base, required this.item, required this.type, required this.suppliers, required this.plates, required this.pickPlate, required this.pk});

  @override
  State<_MovementSheet> createState() => _MovementSheetState();
}

class _MovementSheetState extends State<_MovementSheet> {
  final _qty = TextEditingController(text: '1');
  final _reason = TextEditingController();
  // سعرُ القطعة الواحدة في هذا الوارد — يبدأ بسعر الصنف المسجَّل، والخادمُ
  // يحدّث به سعرَ الصنف. ولا واردَ بلا سعر (PRICE_REQUIRED).
  late final _price = TextEditingController(text: _numOf(widget.item['unitPrice']) > 0 ? '${widget.item['unitPrice']}' : '');
  // المورد يبدأ بمورد الصنف، ويومُ الشراء اليومَ — وكلاهما للوارد وحدَه.
  late String _supplier = _idOf(widget.item['supplier']);
  String _date = _todayYmd();
  String _plate = '';
  String? _priceErr;
  String? _err;
  bool _busy = false;

  bool get _isIn => widget.type == 'in';

  @override
  void dispose() { _qty.dispose(); _reason.dispose(); _price.dispose(); super.dispose(); }

  Future<void> _submit() async {
    final qty = num.tryParse(_qty.text.trim()) ?? 0;
    final price = num.tryParse(_price.text.trim()) ?? 0;
    if (qty <= 0) { setState(() => _err = tr('أدخل كمية صحيحة', 'Enter a quantity')); return; }
    if (_isIn && price <= 0) { setState(() => _priceErr = tr('اكتب سعر القطعة الواحدة', 'Enter the price per piece')); return; }
    setState(() { _busy = true; _err = null; });
    try {
      await Api.instance.post('${widget.base}/${widget.item['_id']}/movement', {
        'type': widget.type, 'quantity': qty, 'vehiclePlate': _plate.trim(), 'reason': _reason.text.trim(),
        if (_isIn) 'unitPrice': price,
        if (_isIn) 'date': _date,
        if (_isIn && _supplier.isNotEmpty) ..._supplierBody(_supplier),
      });
      if (mounted) Navigator.pop(context, true);
    } catch (e) {
      if (mounted) setState(() { _busy = false; _err = e.toString(); });
    }
  }

  @override
  Widget build(BuildContext context) {
    final it = widget.item;
    final isIn = _isIn;
    final hit = _plate.trim().isEmpty
        ? const <String, dynamic>{}
        : widget.plates.firstWhere((r) => widget.pk(r['plate']) == widget.pk(_plate), orElse: () => const {});
    final total = (num.tryParse(_qty.text.trim()) ?? 0) * (num.tryParse(_price.text.trim()) ?? 0);
    return Padding(
      padding: EdgeInsets.fromLTRB(18, 16, 18, MediaQuery.of(context).viewInsets.bottom + 18),
      child: SingleChildScrollView(
        child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(isIn ? tr('وارد للمخزن', 'Stock in') : tr('صادر من المخزن', 'Stock out'), style: TextStyle(fontWeight: FontWeight.w900, fontSize: 17, color: isIn ? T.success : T.orange)),
          const SizedBox(height: 2),
          Text('${it['name']} · ${tr('الرصيد', 'balance')}: ${it['quantity']} ${it['unit'] ?? ''}', style: const TextStyle(fontSize: 12.5, color: T.inkFaint)),
          const SizedBox(height: 14),
          if (_err != null) _errBox(_err!),
          TextField(controller: _qty, keyboardType: TextInputType.number, autofocus: true, onChanged: (_) => setState(() => _err = null), decoration: InputDecoration(labelText: tr('الكمية *', 'Quantity *'))),
          const SizedBox(height: 10),
          if (isIn) ...[
            TextField(
              controller: _price,
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              onChanged: (_) => setState(() => _priceErr = null),
              decoration: InputDecoration(labelText: tr('سعر القطعة الواحدة (ر.س) *', 'Price per piece (SAR) *'), errorText: _priceErr),
            ),
            Padding(
              padding: const EdgeInsets.only(top: 4),
              child: Text('${tr('إجمالي الوارد', 'Receipt total')}: ${_money(total)} ${tr('ر.س', 'SAR')}',
                  style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: T.inkSoft)),
            ),
            const SizedBox(height: 10),
            // ممّن اشتُري ومتى — اختياريّان، ويُسجَّلان على الحركة نفسِها.
            _SupplierField(suppliers: widget.suppliers, value: _supplier, fallbackName: (it['supplierName'] ?? '').toString(), onChanged: (v) => setState(() => _supplier = v)),
            const SizedBox(height: 10),
            _DateField(label: tr('تاريخ الشراء', 'Purchase date'), value: _date, onChanged: (v) => setState(() => _date = v)),
            const SizedBox(height: 10),
          ],
          // ── المركبةُ تُنتقى من قائمةٍ تُبحَث، ومشروعُها يُقال تحتها ─────────
          OutlinedButton.icon(
            style: OutlinedButton.styleFrom(alignment: AlignmentDirectional.centerStart, minimumSize: const Size(double.infinity, 48)),
            onPressed: () async {
              final r = await widget.pickPlate();
              if (r != null && mounted) setState(() => _plate = (r['plate'] ?? '').toString());
            },
            icon: const Icon(Icons.local_shipping_outlined, size: 18),
            label: Text(
              _plate.trim().isEmpty
                  ? (isIn ? tr('واردة من مركبة (اختياري)', 'In from vehicle (optional)') : tr('صادرة على مركبة', 'Out to vehicle'))
                  : _plate,
              style: const TextStyle(fontSize: 13.5, fontWeight: FontWeight.w700),
            ),
          ),
          if (_plate.trim().isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(top: 6),
              child: Container(
                width: double.infinity,
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                decoration: BoxDecoration(
                  color: hit.isEmpty ? const Color(0xFFFEF3C7) : const Color(0xFFF1F5F9),
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Text(
                  hit.isEmpty
                      ? tr('هذه اللوحة ليست في سجلّ مركبات القسم — ستُسجَّل كما كُتبت.',
                          'Not in the section register — recorded as typed.')
                      : [
                          (hit['project'] ?? '').toString().isNotEmpty
                              ? '${tr('تبع مشروع', 'project')}: ${hit['project']}'
                              : tr('لا مشروعَ مسجَّلًا لهذه المركبة', 'No project recorded'),
                          if ((hit['rider'] ?? '').toString().isNotEmpty) '${tr('الراكب', 'rider')}: ${hit['rider']}',
                          if ((hit['city'] ?? '').toString().isNotEmpty) hit['city'],
                          if ((hit['detail'] ?? '').toString().isNotEmpty) hit['detail'],
                        ].join(' · '),
                  style: TextStyle(
                    fontSize: 11.5, fontWeight: FontWeight.w700,
                    color: hit.isEmpty ? const Color(0xFF92400E) : T.inkSoft,
                  ),
                ),
              ),
            ),
          const SizedBox(height: 10),
          TextField(controller: _reason, decoration: InputDecoration(labelText: tr('ملاحظة / سبب', 'Reason'))),
          const SizedBox(height: 14),
          SizedBox(width: double.infinity, child: FilledButton(
            style: FilledButton.styleFrom(backgroundColor: isIn ? T.success : T.orange),
            onPressed: _busy ? null : _submit,
            child: Text(_busy ? tr('جارٍ التسجيل…', 'Recording…') : tr('تسجيل الحركة', 'Record')))),
        ]),
      ),
    );
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// صنفٌ جديد / تعديل صنف
// ═════════════════════════════════════════════════════════════════════════════

class _ItemFormSheet extends StatefulWidget {
  final String base;
  final Map<String, dynamic>? item;
  final List<Map<String, dynamic>> suppliers;
  const _ItemFormSheet({required this.base, required this.item, required this.suppliers});

  @override
  State<_ItemFormSheet> createState() => _ItemFormSheetState();
}

class _ItemFormSheetState extends State<_ItemFormSheet> {
  late final _name = TextEditingController(text: widget.item?['name']?.toString() ?? '');
  late final _cat = TextEditingController(text: widget.item?['category']?.toString() ?? '');
  late final _code = TextEditingController(text: widget.item?['code']?.toString() ?? '');
  final _qty = TextEditingController(text: '1');
  late final _unit = TextEditingController(text: widget.item?['unit']?.toString() ?? 'قطعة');
  late final _price = TextEditingController(text: widget.item?['unitPrice']?.toString() ?? '');
  late final _minQ = TextEditingController(text: widget.item?['minQuantity']?.toString() ?? '0');
  late final _notes = TextEditingController(text: widget.item?['notes']?.toString() ?? '');
  late String _supplier = _idOf(widget.item?['supplier']);
  // صنفٌ جديدٌ يُشترى اليومَ في الغالب؛ والقائمُ يبقى على ما سُجِّل له.
  late String _date = widget.item == null ? _todayYmd() : _ymdOf(widget.item?['purchaseDate']);
  String? _nameErr;
  String? _priceErr;
  String? _err;
  bool _busy = false;

  static String _ymdOf(dynamic v) { final s = (v ?? '').toString(); return s.length >= 10 ? s.substring(0, 10) : ''; }

  bool get _isNew => widget.item == null;

  @override
  void dispose() {
    for (final c in [_name, _cat, _code, _qty, _unit, _price, _minQ, _notes]) { c.dispose(); }
    super.dispose();
  }

  Future<void> _save() async {
    if (_name.text.trim().isEmpty) { setState(() => _nameErr = tr('اسم الصنف مطلوب', 'Name required')); return; }
    // صنفٌ جديدٌ بلا سعرٍ يرفضه الخادم — فيُقال هنا والنموذجُ مفتوح.
    if (_isNew && (num.tryParse(_price.text.trim()) ?? 0) <= 0) {
      setState(() => _priceErr = tr('اكتب سعر القطعة الواحدة', 'Enter the price per piece'));
      return;
    }
    // ── والعددُ لا يُرسَل عند التعديل ─────────────────────────────────────
    // العددُ لا يتغيّر إلّا بحركةٍ مسجَّلةٍ باسم صاحبها؛ والخادمُ يتجاهله في
    // التعديل، فلا يُعرَض ولا يُرسَل.
    final body = <String, dynamic>{
      'name': _name.text.trim(), 'category': _cat.text.trim(), 'code': _code.text.trim(),
      'unit': _unit.text.trim(), 'unitPrice': num.tryParse(_price.text.trim()) ?? 0,
      'minQuantity': num.tryParse(_minQ.text.trim()) ?? 0, 'notes': _notes.text.trim(),
      'purchaseDate': _date,
      if (_supplier.isNotEmpty) ..._supplierBody(_supplier) else ...{'supplier': '', 'supplierName': ''},
      if (_isNew) 'quantity': num.tryParse(_qty.text.trim()) ?? 0,
    };
    setState(() { _busy = true; _err = null; });
    try {
      if (_isNew) { await Api.instance.post(widget.base, body); }
      else { await Api.instance.put('${widget.base}/${widget.item!['_id']}', body); }
      if (mounted) Navigator.pop(context, true);
    } catch (e) {
      if (mounted) setState(() { _busy = false; _err = e.toString(); });
    }
  }

  @override
  Widget build(BuildContext context) {
    final total = (num.tryParse(_qty.text.trim()) ?? 0) * (num.tryParse(_price.text.trim()) ?? 0);
    return Padding(
      padding: EdgeInsets.fromLTRB(18, 16, 18, MediaQuery.of(context).viewInsets.bottom + 18),
      child: SingleChildScrollView(child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(_isNew ? tr('صنف جديد', 'New item') : tr('تعديل الصنف', 'Edit item'), style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 16)),
        const SizedBox(height: 12),
        if (_err != null) _errBox(_err!),
        TextField(controller: _name, onChanged: (_) { if (_nameErr != null) setState(() => _nameErr = null); }, decoration: InputDecoration(labelText: tr('اسم الصنف *', 'Name *'), errorText: _nameErr)),
        const SizedBox(height: 10),
        Row(children: [
          Expanded(child: TextField(controller: _cat, decoration: InputDecoration(labelText: tr('التصنيف', 'Category')))),
          const SizedBox(width: 10),
          Expanded(child: TextField(controller: _code, decoration: InputDecoration(labelText: tr('الكود', 'Code')))),
        ]),
        const SizedBox(height: 10),
        _SupplierField(suppliers: widget.suppliers, value: _supplier, fallbackName: (widget.item?['supplierName'] ?? '').toString(), onChanged: (v) => setState(() => _supplier = v)),
        const SizedBox(height: 10),
        Row(children: [
          Expanded(child: _DateField(label: tr('تاريخ الشراء', 'Purchase date'), value: _date, onChanged: (v) => setState(() => _date = v))),
          const SizedBox(width: 10),
          Expanded(child: LookupField(type: 'ls2_store_unit', controller: _unit, label: tr('الوحدة', 'Unit'), fallback: const ['قطعة', 'لتر'])),
        ]),
        const SizedBox(height: 10),
        Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          if (_isNew) Expanded(flex: 2, child: TextField(controller: _qty, keyboardType: TextInputType.number, onChanged: (_) => setState(() {}), decoration: InputDecoration(labelText: tr('العدد', 'Quantity')))),
          if (_isNew) const SizedBox(width: 10),
          Expanded(flex: 3, child: TextField(
            controller: _price, keyboardType: const TextInputType.numberWithOptions(decimal: true),
            onChanged: (_) => setState(() => _priceErr = null),
            decoration: InputDecoration(labelText: tr('سعر القطعة الواحدة (ر.س) *', 'Price per piece (SAR) *'), errorText: _priceErr),
          )),
        ]),
        if (_isNew && total > 0)
          Container(
            width: double.infinity,
            margin: const EdgeInsets.only(top: 8),
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
            decoration: BoxDecoration(color: T.success.withValues(alpha: 0.08), borderRadius: BorderRadius.circular(10)),
            child: Text('${tr('الإجمالي', 'Total')}: ${_money(total)} ${tr('ر.س', 'SAR')}', style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w800, color: T.success)),
          ),
        const SizedBox(height: 10),
        TextField(controller: _minQ, keyboardType: TextInputType.number, decoration: InputDecoration(labelText: tr('حد التنبيه (نقص)', 'Min qty (low alert)'))),
        const SizedBox(height: 10),
        TextField(controller: _notes, maxLines: 2, decoration: InputDecoration(labelText: tr('ملاحظات', 'Notes'))),
        if (!_isNew)
          Padding(
            padding: const EdgeInsets.only(top: 8),
            child: Text(tr('العدد لا يتغيّر من هنا — يتغيّر بحركة وارد أو صادر.', 'Quantity changes only through an in/out movement.'), style: const TextStyle(fontSize: 11, color: T.inkFaint)),
          ),
        const SizedBox(height: 14),
        SizedBox(width: double.infinity, child: FilledButton.icon(
          icon: const Icon(Icons.save_outlined, size: 18),
          label: Text(_busy ? tr('جارٍ الحفظ…', 'Saving…') : tr('حفظ', 'Save')),
          onPressed: _busy ? null : _save,
        )),
      ])),
    );
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// إضافة عدّة أصناف — فاتورةُ شراءٍ واحدة
// ═════════════════════════════════════════════════════════════════════════════

/// سطرٌ في الدفعة. متحكّماتُه تُنشأ معه مرّةً وتُتلَف معه — لا في البناء.
class _NewRow {
  static int _seq = 1;
  final int id = _seq++;
  final name = TextEditingController();
  final cat = TextEditingController();
  final code = TextEditingController();
  final qty = TextEditingController(text: '1');
  final price = TextEditingController();
  String unit = 'قطعة';

  /// السطرُ الفارغُ تمامًا لا يُرسَل: ثلاثةُ أسطرٍ تُفتَح جاهزةً ولا يُلزَم بملئها.
  bool get filled => name.text.trim().isNotEmpty || price.text.trim().isNotEmpty || code.text.trim().isNotEmpty;
  num get total => (num.tryParse(qty.text.trim()) ?? 0) * (num.tryParse(price.text.trim()) ?? 0);

  void dispose() { name.dispose(); cat.dispose(); code.dispose(); qty.dispose(); price.dispose(); }
}

/// الموردُ ويومُ الشراء مرّةً في الأعلى، ولكلّ صنفٍ سطر. والخادمُ يقبل الدفعةَ
/// كلَّها أو يرفضها كلَّها بأرقام الأسطر الناقصة — فيُكتب الخطأُ على سطره.
class _BulkCreateScreen extends StatefulWidget {
  final String base;
  final List<Map<String, dynamic>> suppliers;
  const _BulkCreateScreen({required this.base, required this.suppliers});

  @override
  State<_BulkCreateScreen> createState() => _BulkCreateScreenState();
}

class _BulkCreateScreenState extends State<_BulkCreateScreen> {
  final List<_NewRow> _rows = [_NewRow(), _NewRow(), _NewRow()];
  final Map<int, String> _errors = {};
  List<String> _units = const ['قطعة', 'لتر'];
  String _supplier = '';
  String _date = _todayYmd();
  String? _err;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    loadLookupNames('ls2_store_unit', fallback: _units).then((u) { if (mounted) setState(() => _units = u); });
  }

  @override
  void dispose() {
    for (final r in _rows) { r.dispose(); }
    super.dispose();
  }

  void _remove(_NewRow r) {
    setState(() { _rows.remove(r); _errors.remove(r.id); });
    // يُتلَف بعد أن يخرج سطرُه من الشجرة، لا وخاناتُه ما زالت تقرؤه.
    WidgetsBinding.instance.addPostFrameCallback((_) => r.dispose());
  }

  Future<void> _save() async {
    final filled = _rows.where((r) => r.filled).toList();
    if (filled.isEmpty) { setState(() => _err = tr('اكتب صنفًا واحدًا على الأقل', 'Enter at least one item')); return; }
    setState(() { _busy = true; _err = null; _errors.clear(); });
    try {
      final r = await Api.instance.post('${widget.base}/bulk-create', {
        'purchaseDate': _date,
        if (_supplier.isNotEmpty) ..._supplierBody(_supplier),
        'items': filled.map((x) => {
              'name': x.name.text.trim(), 'category': x.cat.text.trim(), 'code': x.code.text.trim(),
              'quantity': num.tryParse(x.qty.text.trim()) ?? 0, 'unit': x.unit,
              'unitPrice': num.tryParse(x.price.text.trim()) ?? 0,
            }).toList(),
      });
      final count = r is Map && r['summary'] is Map ? _numOf(r['summary']['count']).toInt() : 0;
      if (mounted) Navigator.pop(context, count > 0 ? count : filled.length);
    } catch (e) {
      if (!mounted) return;
      // رقمُ السطر في الردّ هو ترتيبُه فيما أُرسل (يبدأ من ١) — لا في الشاشة.
      final list = e is ApiException && e.data['errors'] is List ? e.data['errors'] as List : const [];
      setState(() {
        _busy = false;
        _err = e.toString();
        for (final x in list) {
          if (x is! Map) continue;
          final line = _numOf(x['line']).toInt();
          if (line < 1 || line > filled.length) continue;
          final id = filled[line - 1].id;
          final msg = (x['message'] ?? '').toString();
          _errors[id] = _errors.containsKey(id) ? '${_errors[id]} · $msg' : msg;
        }
      });
    }
  }

  Widget _rowCard(_NewRow r, int i) {
    final err = _errors[r.id];
    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.fromLTRB(12, 6, 12, 12),
      decoration: BoxDecoration(
        color: err == null ? Colors.white : T.danger.withValues(alpha: 0.05),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: err == null ? T.line : T.danger),
      ),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          Text('${tr('صنف', 'Item')} ${i + 1}', style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w800, color: T.inkSoft)),
          const Spacer(),
          Text('${tr('الإجمالي', 'Total')}: ${_money(r.total)}', style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w800, color: T.success)),
          if (_rows.length > 1)
            IconButton(
              visualDensity: VisualDensity.compact,
              icon: const Icon(Icons.delete_outline, size: 19, color: T.danger),
              tooltip: tr('حذف السطر', 'Remove row'),
              onPressed: () => _remove(r),
            )
          else
            const SizedBox(height: 40),
        ]),
        TextField(controller: r.name, onChanged: (_) => setState(() {}), decoration: InputDecoration(labelText: tr('اسم الصنف *', 'Name *'), isDense: true, errorText: err, errorMaxLines: 3)),
        const SizedBox(height: 8),
        Row(children: [
          Expanded(child: TextField(controller: r.cat, decoration: InputDecoration(labelText: tr('التصنيف', 'Category'), isDense: true))),
          const SizedBox(width: 8),
          Expanded(child: TextField(controller: r.code, onChanged: (_) => setState(() {}), decoration: InputDecoration(labelText: tr('الكود', 'Code'), isDense: true))),
        ]),
        const SizedBox(height: 8),
        Row(children: [
          Expanded(flex: 2, child: TextField(controller: r.qty, keyboardType: TextInputType.number, onChanged: (_) => setState(() {}), decoration: InputDecoration(labelText: tr('العدد', 'Qty'), isDense: true))),
          const SizedBox(width: 8),
          Expanded(flex: 3, child: DropdownButtonFormField<String>(
            initialValue: r.unit,
            isExpanded: true,
            decoration: InputDecoration(labelText: tr('الوحدة', 'Unit'), isDense: true),
            items: {r.unit, ..._units}.map((u) => DropdownMenuItem(value: u, child: Text(u, overflow: TextOverflow.ellipsis))).toList(),
            onChanged: (v) => setState(() => r.unit = v ?? r.unit),
          )),
          const SizedBox(width: 8),
          Expanded(flex: 3, child: TextField(controller: r.price, keyboardType: const TextInputType.numberWithOptions(decimal: true), onChanged: (_) => setState(() {}), decoration: InputDecoration(labelText: tr('سعر القطعة *', 'Unit price *'), isDense: true))),
        ]),
      ]),
    );
  }

  @override
  Widget build(BuildContext context) {
    final filled = _rows.where((r) => r.filled).toList();
    final total = filled.fold<num>(0, (a, r) => a + r.total);
    return Scaffold(
      backgroundColor: T.canvas,
      appBar: AppBar(title: Text(tr('إضافة عدّة أصناف', 'Add several items'))),
      body: ListView(padding: const EdgeInsets.all(14), children: [
        Text(
          tr('المورد وتاريخ الشراء يُكتبان مرّةً ويُطبَّقان على كلّ الأسطر. تُحفَظ الدفعة كلُّها أو لا يُحفَظ منها شيء.',
             'Supplier and date apply to every row. The batch is saved whole or not at all.'),
          style: const TextStyle(fontSize: 12, color: T.inkSoft, height: 1.5),
        ),
        const SizedBox(height: 12),
        if (_err != null) _errBox(_err!),
        _SupplierField(suppliers: widget.suppliers, value: _supplier, onChanged: (v) => setState(() => _supplier = v)),
        const SizedBox(height: 10),
        _DateField(label: tr('تاريخ الشراء', 'Purchase date'), value: _date, onChanged: (v) => setState(() => _date = v)),
        const SizedBox(height: 14),
        for (int i = 0; i < _rows.length; i++) KeyedSubtree(key: ValueKey(_rows[i].id), child: _rowCard(_rows[i], i)),
        Align(
          alignment: AlignmentDirectional.centerStart,
          child: OutlinedButton.icon(
            icon: const Icon(Icons.add, size: 18),
            label: Text(tr('سطر آخر', 'Another row')),
            onPressed: () => setState(() => _rows.add(_NewRow())),
          ),
        ),
      ]),
      bottomNavigationBar: SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(14, 8, 14, 10),
          child: Row(children: [
            Expanded(child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text('${filled.length} ${tr('صنف', 'items')}', style: const TextStyle(fontSize: 11.5, color: T.inkSoft, fontWeight: FontWeight.w600)),
              Text('${tr('الإجمالي', 'Total')}: ${_money(total)} ${tr('ر.س', 'SAR')}', style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w900, color: T.success)),
            ])),
            FilledButton.icon(
              icon: const Icon(Icons.save_outlined, size: 18),
              label: Text(_busy ? tr('جارٍ الحفظ…', 'Saving…') : '${tr('حفظ', 'Save')} (${filled.length})'),
              onPressed: _busy ? null : _save,
            ),
          ]),
        ),
      ),
    );
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// سجلّ الحركات
// ═════════════════════════════════════════════════════════════════════════════

/// الفلاترُ كلُّها في الخادم: السجلُّ أطولُ من أن يُجلَب كلُّه ثمّ يُصفّى هنا.
class _LogSheet extends StatefulWidget {
  final String base;
  final List<Map<String, dynamic>> suppliers;
  final bool canEdit;
  final Future<bool> Function(Map<String, dynamic>) reverse;
  const _LogSheet({required this.base, required this.suppliers, required this.canEdit, required this.reverse});

  @override
  State<_LogSheet> createState() => _LogSheetState();
}

class _LogSheetState extends State<_LogSheet> {
  final _qC = TextEditingController();
  List<Map<String, dynamic>> _movs = [];
  bool _loading = true;
  String _type = '';
  String _from = '';
  String _to = '';
  String _supplier = '';
  int _seq = 0;
  Timer? _debounce;

  @override
  void initState() {
    super.initState();
    _fetch();
    Live.instance.on('ls2:store', _fetch);
  }

  @override
  void dispose() {
    Live.instance.off('ls2:store', _fetch);
    _debounce?.cancel();
    _qC.dispose();
    super.dispose();
  }

  void _fetch() { _run(); }

  Future<void> _run() async {
    final seq = ++_seq;
    final qs = [
      'limit=300',
      if (_type.isNotEmpty) 'type=$_type',
      if (_from.isNotEmpty) 'from=$_from',
      if (_to.isNotEmpty) 'to=$_to',
      if (_supplier.isNotEmpty) 'supplier=$_supplier',
      if (_qC.text.trim().isNotEmpty) 'q=${Uri.encodeComponent(_qC.text.trim())}',
    ].join('&');
    try {
      final d = await Api.instance.get('${widget.base}/movements?$qs');
      if (!mounted || seq != _seq) return;
      setState(() { _movs = List<Map<String, dynamic>>.from(d['movements'] ?? []); _loading = false; });
    } catch (_) {
      if (mounted && seq == _seq) setState(() => _loading = false);
    }
  }

  void _set(VoidCallback change) { setState(change); _run(); }

  Widget _row(Map<String, dynamic> m) {
    final isIn = m['type'] == 'in';
    final reversed = m['reversed'] == true;
    final isReversal = m['isReversal'] == true;
    final tint = reversed ? T.inkFaint : (isIn ? T.success : T.orange);
    final unit = (m['unit'] ?? '').toString();
    return ListTile(
      dense: true,
      contentPadding: EdgeInsets.zero,
      leading: CircleAvatar(radius: 16, backgroundColor: tint.withValues(alpha: 0.12), child: Icon(isIn ? Icons.south : Icons.north, size: 15, color: tint)),
      title: Text((m['itemName'] ?? '').toString(), style: TextStyle(
        fontWeight: FontWeight.w700, fontSize: 13,
        color: reversed ? T.inkFaint : T.ink,
        decoration: reversed ? TextDecoration.lineThrough : null)),
      subtitle: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        // الكمّيّةُ وسعرُ القطعة وإجماليُّ الحركة
        Text([
          '${isIn ? '+' : '−'}${m['quantity']}${unit.isEmpty ? '' : ' $unit'}',
          if (m['unitPrice'] != null) '${tr('سعر القطعة', 'unit price')} ${_money(m['unitPrice'])}',
          if (m['total'] != null) '${tr('الإجمالي', 'total')} ${_money(m['total'])} ${tr('ر.س', 'SAR')}',
        ].join(' · '), style: TextStyle(fontSize: 11.5, fontWeight: FontWeight.w700, color: reversed ? T.inkFaint : T.inkSoft)),
        // متى، وممّن، وعلى أيّ مركبة
        Text([
          _dmy(m['date'] ?? m['createdAt']),
          if ((m['supplierName'] ?? '').toString().isNotEmpty) '${tr('المورد', 'supplier')}: ${m['supplierName']}',
          if ((m['vehiclePlate'] ?? '').toString().isNotEmpty) '${tr('مركبة', 'vehicle')} ${m['vehiclePlate']}',
          if ((m['performedByName'] ?? '').toString().isNotEmpty) m['performedByName'].toString(),
          if ((m['reason'] ?? '').toString().isNotEmpty) m['reason'].toString(),
        ].join(' · '), style: const TextStyle(fontSize: 11)),
        if (reversed)
          Text(tr('مُلغاة', 'reversed') + ((m['reversedByName'] ?? '').toString().isEmpty ? '' : ' · ${m['reversedByName']}'),
              style: const TextStyle(fontSize: 10.5, color: T.danger, fontWeight: FontWeight.w700)),
        if (isReversal)
          Text(tr('حركة تراجع', 'reversal entry'), style: const TextStyle(fontSize: 10.5, color: T.warn, fontWeight: FontWeight.w700)),
      ]),
      trailing: widget.canEdit && m['canReverse'] == true
          ? TextButton.icon(
              onPressed: () async {
                final done = await widget.reverse(m);
                if (done && mounted) _run();
              },
              style: TextButton.styleFrom(foregroundColor: T.danger, padding: const EdgeInsets.symmetric(horizontal: 6)),
              icon: const Icon(Icons.undo, size: 15),
              label: Text(tr('تراجع', 'Undo'), style: const TextStyle(fontSize: 11.5)),
            )
          : null,
    );
  }

  @override
  Widget build(BuildContext context) {
    // قيمةُ الوارد فيما عُرض — والملغاةُ وحركةُ تراجعها لا تُحسَبان.
    final inValue = _movs
        .where((m) => m['type'] == 'in' && m['reversed'] != true && m['isReversal'] != true)
        .fold<num>(0, (a, m) => a + _numOf(m['total']));
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
      child: DraggableScrollableSheet(
        expand: false, initialChildSize: 0.85, maxChildSize: 0.95,
        builder: (c2, scroll) => Column(children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
            child: Row(children: [
              Expanded(child: Text('${tr('سجل الحركات', 'Movement log')} (${_movs.length})', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16))),
              Text('${tr('قيمة الوارد', 'In value')}: ${_money(inValue)}', style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w800, color: T.success)),
            ]),
          ),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 14),
            child: TextField(
              controller: _qC,
              onChanged: (_) {
                _debounce?.cancel();
                _debounce = Timer(const Duration(milliseconds: 300), _run);
              },
              decoration: InputDecoration(hintText: tr('الصنف / المورد / المركبة / السبب…', 'item / supplier / vehicle / reason…'), prefixIcon: const Icon(Icons.search), isDense: true),
            ),
          ),
          const SizedBox(height: 6),
          SizedBox(
            height: 38,
            child: ListView(scrollDirection: Axis.horizontal, padding: const EdgeInsets.symmetric(horizontal: 14), children: [
              _fchip(tr('وارد', 'In'), _type == 'in', () => _set(() => _type = _type == 'in' ? '' : 'in')),
              _fchip(tr('صادر', 'Out'), _type == 'out', () => _set(() => _type = _type == 'out' ? '' : 'out')),
              _fchip(
                _supplier.isEmpty ? tr('كل الموردين', 'All suppliers') : _supplierLabel(widget.suppliers, _supplier),
                _supplier.isNotEmpty,
                () async {
                  final v = await _pickSupplier(context, widget.suppliers, _supplier, allowNew: false, noneLabel: tr('كل الموردين', 'All suppliers'));
                  if (v != null && mounted) _set(() => _supplier = v);
                },
              ),
              ..._periodChips(context, _from, _to, (a, b) => _set(() { _from = a; _to = b; })),
            ]),
          ),
          const Divider(height: 12),
          Expanded(child: _loading
              ? const Center(child: CircularProgressIndicator())
              : _movs.isEmpty
                  ? EmptyState(icon: Icons.history, title: tr('لا حركاتَ في هذا العرض', 'No movements in this view'))
                  : ListView.separated(
                      controller: scroll, padding: const EdgeInsets.symmetric(horizontal: 14),
                      itemCount: _movs.length, separatorBuilder: (_, __) => const Divider(height: 1),
                      itemBuilder: (c3, i) => _row(_movs[i]),
                    )),
        ]),
      ),
    );
  }
}
