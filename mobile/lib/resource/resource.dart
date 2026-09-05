import 'dart:async';
import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';

/// The native CRUD engine: one generic screen that gives ANY system resource
/// a full native page — list + Arabic-folded search + create + edit + delete,
/// live over the same socket events as the web. A new page of the system is
/// a ResourceConfig entry, not a new hand-written screen.

enum FieldType { text, textarea, number, date, checkbox, select, phone, email, lookup }

class FieldSpec {
  final String name;
  final String ar;
  final String en;
  final FieldType type;
  final bool required;
  final List<(String, String, String)>? options; // (value, ar, en)
  // حقل علاقة (lookup): يجلب الخيارات من endpoint ويخزّن الـ id المختار.
  final String? lookupEndpoint;   // '/api/crm/companies'
  final String? lookupListKey;    // 'companies'
  final String? lookupQuery;      // 'limit=200'
  final String Function(Map<String, dynamic>)? lookupLabel; // صف → نص للعرض
  // ── ما الذي يُخزَّن من الصفّ المختار ──────────────────────────────────────
  // الأصلُ أن يُخزَّن `_id`: الحقلُ علاقةٌ إلى سجلٍّ قائم. لكنّ القوائمَ المدارة
  // (`/api/lookups`) تُخزَّن بنصِّها العربيّ لا بمعرّفها — تقرؤها التصديراتُ
  // والفلاتر مباشرةً، ومعرّفُ Mongo لا يقول شيئًا لمن يفتح الملفّ. فيُمرَّر ما
  // يُخزَّن صراحةً حين يختلف عن المعرّف.
  final String Function(Map<String, dynamic>)? lookupValue;
  const FieldSpec(this.name, this.ar, this.en,
      {this.type = FieldType.text, this.required = false, this.options,
       this.lookupEndpoint, this.lookupListKey, this.lookupQuery, this.lookupLabel,
       this.lookupValue});

  String get label => tr(ar, en);
}

class ResourceConfig {
  final String arTitle;
  final String enTitle;
  final IconData icon;
  final String endpoint;      // '/api/fleet/drivers'
  final String listKey;       // 'drivers'
  final String listQuery;     // extra query for the LIST GET only (e.g. 'all=1') — kept off endpoint so /:id actions stay clean
  final String updateMethod;  // 'PUT' | 'PATCH'
  final String liveEvent;     // 'fleet:updated'
  final List<String> searchFields;
  final List<FieldSpec> fields;
  final String Function(Map<String, dynamic>) titleOf;
  final String Function(Map<String, dynamic>)? subtitleOf;
  final List<(String, Color)> Function(Map<String, dynamic>)? chipsOf;
  final bool canCreate;
  final bool canEdit;
  final bool canDelete;
  /// عند ضبطها: نقرة الصف تفتح ملفًا كاملًا بدل ورقة التحرير (والتحرير من أيقونة القلم).
  final void Function(BuildContext, Map<String, dynamic>)? onOpen;
  /// اسم حقل (من نوع select) تُبنى منه شرائح التصفية أعلى القائمة (الكل + كل خيار بعدّاده).
  final String? filterField;
  /// حقول يُتاح الفرز بها إضافةً للاسم (name, ar, en) — (fieldName, arLabel, enLabel).
  final List<(String, String, String)> sortFields;
  /// إجراءات سريعة لكل صف (قائمة ثلاث نقاط): تبديل/حذف/تغيير حالة دون فتح النموذج.
  /// تُعيد قائمة إجراءات لكل صف؛ كل إجراء ينفّذ طلبًا ثم تُحدَّث القائمة.
  final List<ResourceAction> Function(Map<String, dynamic>)? rowActions;

  /// يُرسل نصُّ البحث إلى الخادم (`q=`) بدل تصفيته في التطبيق.
  ///
  /// البحثُ في المحمَّل وحدَه يصحّ ما دامت القائمةُ تُحمَّل كاملة. أمّا سجلٌّ
  /// فيه ثلاثةُ آلافِ صفٍّ فلا يُنزَّل إلى هاتفٍ على شبكةٍ مقيَّدة، فيبحث
  /// المستخدمُ في أوّل مئتين ويُقال له «لا نتائج» — وهو قصٌّ صامت.
  final bool serverSearch;

  const ResourceConfig({
    required this.arTitle, required this.enTitle, required this.icon,
    required this.endpoint, required this.listKey,
    this.listQuery = '', this.updateMethod = 'PUT', required this.liveEvent,
    required this.searchFields, required this.fields, required this.titleOf,
    this.subtitleOf, this.chipsOf,
    this.canCreate = true, this.canEdit = true, this.canDelete = true,
    this.onOpen, this.filterField, this.sortFields = const [], this.rowActions,
    this.serverSearch = false,
  });

  String get title => tr(arTitle, enTitle);
}

/// إجراء صف سريع: أيقونة + عنوان + لون + دالة تُرجع (method, path, body?) للتنفيذ،
/// أو دالة تنفيذ مخصّصة. رسالة تأكيد اختيارية قبل التنفيذ.
class ResourceAction {
  final IconData icon;
  final String ar;
  final String en;
  final Color color;
  final String? confirmAr;
  final String? confirmEn;
  /// طلب جاهز: (method 'PATCH'|'PUT'|'POST'|'DELETE', path, body?).
  final (String, String, Map<String, dynamic>?) Function(Map<String, dynamic>)? request;
  const ResourceAction({
    required this.icon, required this.ar, required this.en, required this.color,
    this.confirmAr, this.confirmEn, this.request,
  });
  String get label => tr(ar, en);
}

String _fold(String s) => s
    .replaceAll(RegExp('[أإآ]'), 'ا').replaceAll('ى', 'ي').replaceAll('ة', 'ه')
    .replaceAll('ؤ', 'و').replaceAll('ئ', 'ي').toLowerCase();

class ResourceScreen extends StatefulWidget {
  final ResourceConfig config;
  const ResourceScreen({super.key, required this.config});

  @override
  State<ResourceScreen> createState() => _ResourceScreenState();
}

// أوضاع الفرز المتاحة على أي قائمة.
enum _Sort { none, azAsc, azDesc, newest, oldest }

class _ResourceScreenState extends State<ResourceScreen> {
  List<Map<String, dynamic>> _rows = [];
  bool _loading = true;
  bool _loadingMore = false;
  String? _error;
  String _q = '';
  String _filter = '';        // '' = الكل ؛ وإلا قيمة filterField المختارة
  _Sort _sort = _Sort.none;
  int _limit = 200;           // يزيد عند «تحميل المزيد» — بدل القص الصامت
  late final void Function() _onLive;

  ResourceConfig get cfg => widget.config;

  // FieldSpec الخاص بحقل التصفية (إن وُجد وكان من نوع select).
  FieldSpec? get _filterSpec {
    if (cfg.filterField == null) return null;
    for (final f in cfg.fields) {
      if (f.name == cfg.filterField && f.type == FieldType.select) return f;
    }
    return null;
  }

  @override
  void initState() {
    super.initState();
    _load();
    _onLive = () => _load();
    Live.instance.on(cfg.liveEvent, _onLive);
  }

  @override
  void dispose() {
    _searchTimer?.cancel();
    Live.instance.off(cfg.liveEvent, _onLive);
    super.dispose();
  }

  // نداءُ الخادم عند كلّ حرفٍ إسرافٌ على شبكةٍ مقيَّدة — والمؤقّتُ السابقُ
  // يُلغى فلا تصل نتيجةُ حرفٍ قديمٍ بعد نتيجة ما كُتب أخيرًا.
  Timer? _searchTimer;
  void _searchDebounced() {
    _searchTimer?.cancel();
    _searchTimer = Timer(const Duration(milliseconds: 350), () { if (mounted) _load(); });
  }

  Future<void> _load() async {
    try {
      final qs = [
        if (cfg.listQuery.isNotEmpty) cfg.listQuery,
        'limit=$_limit',
        if (cfg.serverSearch && _q.trim().isNotEmpty) 'q=${Uri.encodeQueryComponent(_q.trim())}',
      ].join('&');
      final d = await Api.instance.get('${cfg.endpoint}?$qs');
      if (!mounted) return;
      // نتحمّل أي شكل استجابة: {listKey:[...]} أو مصفوفة مباشرة — بلا كراش.
      final raw = d is Map ? d[cfg.listKey] : (d is List ? d : null);
      setState(() {
        _rows = raw is List ? List<Map<String, dynamic>>.from(raw.whereType<Map>().map((e) => Map<String, dynamic>.from(e))) : [];
        _loading = false;
        _loadingMore = false;
        _error = null;
      });
    } catch (e) {
      if (mounted) setState(() { _loading = false; _loadingMore = false; _error = e.toString(); });
    }
  }

  // «تحميل المزيد»: نرفع الحد ونعيد الجلب — نهاية القص الصامت عند 200.
  Future<void> _loadMore() async {
    if (_loadingMore) return;
    setState(() { _loadingMore = true; _limit += 200; });
    await _load();
  }

  // فرز نسخة من القائمة حسب الوضع المختار.
  List<Map<String, dynamic>> _applySort(List<Map<String, dynamic>> list) {
    if (_sort == _Sort.none) return list;
    final out = [...list];
    int byDate(Map a, Map b) {
      final da = DateTime.tryParse((a['createdAt'] ?? '').toString()) ?? DateTime(1970);
      final db = DateTime.tryParse((b['createdAt'] ?? '').toString()) ?? DateTime(1970);
      return da.compareTo(db);
    }
    switch (_sort) {
      case _Sort.azAsc:
        out.sort((a, b) => _fold(cfg.titleOf(a)).compareTo(_fold(cfg.titleOf(b))));
      case _Sort.azDesc:
        out.sort((a, b) => _fold(cfg.titleOf(b)).compareTo(_fold(cfg.titleOf(a))));
      case _Sort.newest:
        out.sort((a, b) => byDate(b, a));
      case _Sort.oldest:
        out.sort(byDate);
      case _Sort.none:
        break;
    }
    return out;
  }

  void _openSort() {
    (String, String) lbl(_Sort s) => switch (s) {
          _Sort.none => ('الترتيب الافتراضي', 'Default order'),
          _Sort.azAsc => ('الاسم: أ ← ي', 'Name: A → Z'),
          _Sort.azDesc => ('الاسم: ي ← أ', 'Name: Z → A'),
          _Sort.newest => ('الأحدث أولًا', 'Newest first'),
          _Sort.oldest => ('الأقدم أولًا', 'Oldest first'),
        };
    showModalBottomSheet(
      context: context,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (c) => SafeArea(
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(18, 14, 18, 6),
            child: Row(children: [
              const Icon(Icons.swap_vert_rounded, size: 20, color: T.navy),
              const SizedBox(width: 8),
              Text(tr('ترتيب حسب', 'Sort by'), style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w800)),
            ]),
          ),
          for (final s in _Sort.values)
            ListTile(
              title: Text(tr(lbl(s).$1, lbl(s).$2), style: const TextStyle(fontSize: 14)),
              trailing: _sort == s ? const Icon(Icons.check_rounded, color: T.navy) : null,
              onTap: () { setState(() => _sort = s); Navigator.pop(c); },
            ),
          const SizedBox(height: 6),
        ]),
      ),
    );
  }

  Future<void> _delete(Map<String, dynamic> row) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: Text(tr('تأكيد الحذف', 'Confirm delete')),
        content: Text(tr('هل تريد حذف «${cfg.titleOf(row)}» نهائيًا؟', 'Delete "${cfg.titleOf(row)}"?')),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: Text(tr('إلغاء', 'Cancel'))),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: T.danger),
            onPressed: () => Navigator.pop(c, true),
            child: Text(tr('حذف', 'Delete')),
          ),
        ],
      ),
    );
    if (ok != true) return;
    try {
      await Api.instance.delete('${cfg.endpoint}/${row['_id']}');
      _load();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    }
  }

  // قائمة الإجراءات السريعة (ثلاث نقاط) على الصف — تشمل «تعديل» و«حذف» تلقائيًا.
  Widget _rowActionsMenu(Map<String, dynamic> row) {
    final acts = cfg.rowActions!(row);
    return PopupMenuButton<int>(
      icon: const Icon(Icons.more_vert, color: T.inkFaint),
      onSelected: (idx) {
        if (idx == -1) { _openForm(row: row); return; }
        if (idx == -2) { _delete(row); return; }
        _runAction(acts[idx], row);
      },
      itemBuilder: (c) => [
        for (var i = 0; i < acts.length; i++)
          PopupMenuItem(value: i, child: Row(children: [
            Icon(acts[i].icon, size: 18, color: acts[i].color),
            const SizedBox(width: 10),
            Text(acts[i].label),
          ])),
        if (cfg.canEdit)
          PopupMenuItem(value: -1, child: Row(children: [
            const Icon(Icons.edit_outlined, size: 18, color: T.navy),
            const SizedBox(width: 10),
            Text(tr('تعديل', 'Edit')),
          ])),
        if (cfg.canDelete)
          PopupMenuItem(value: -2, child: Row(children: [
            const Icon(Icons.delete_outline, size: 18, color: T.danger),
            const SizedBox(width: 10),
            Text(tr('حذف', 'Delete')),
          ])),
      ],
    );
  }

  Future<void> _runAction(ResourceAction a, Map<String, dynamic> row) async {
    if (a.confirmAr != null) {
      final ok = await showDialog<bool>(
        context: context,
        builder: (c) => AlertDialog(
          title: Text(a.label),
          content: Text(tr(a.confirmAr!, a.confirmEn ?? a.confirmAr!)),
          actions: [
            TextButton(onPressed: () => Navigator.pop(c, false), child: Text(tr('إلغاء', 'Cancel'))),
            FilledButton(style: FilledButton.styleFrom(backgroundColor: a.color), onPressed: () => Navigator.pop(c, true), child: Text(tr('تأكيد', 'Confirm'))),
          ],
        ),
      );
      if (ok != true) return;
    }
    final req = a.request?.call(row);
    if (req == null) return;
    try {
      final (method, path, body) = req;
      switch (method) {
        case 'POST': await Api.instance.post(path, body ?? {});
        case 'PUT': await Api.instance.put(path, body ?? {});
        case 'PATCH': await Api.instance.patch(path, body ?? {});
        case 'DELETE': await Api.instance.delete(path);
      }
      _load();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    }
  }

  void _openForm({Map<String, dynamic>? row}) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(22))),
      builder: (c) => _ResourceForm(
        cfg: cfg,
        row: row,
        onDone: _load,
        onDelete: row != null && cfg.canDelete ? () { Navigator.pop(c); _delete(row); } : null,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final q = _fold(_q.trim());
    final fSpec = _filterSpec;
    // تصفية بالشريحة المختارة ثم بالبحث ثم الفرز.
    final filtered = _applySort(_rows.where((r) {
      if (_filter.isNotEmpty && (r[cfg.filterField] ?? '').toString() != _filter) return false;
      if (q.isEmpty) return true;
      // الخادمُ بحث بالفعل — وإعادةُ التصفية هنا تُسقط ما طابقه في حقلٍ
      // لا يعرفه `searchFields`.
      if (cfg.serverSearch) return true;
      return cfg.searchFields.any((f) => _fold((r[f] ?? '').toString()).contains(q));
    }).toList());
    // عدّاد كل خيار تصفية محسوبًا من كامل الصفوف المحمّلة.
    int countFor(String v) => v.isEmpty
        ? _rows.length
        : _rows.where((r) => (r[cfg.filterField] ?? '').toString() == v).length;

    return AppScaffold(
      title: Text(cfg.title),
      actions: [
        if (!_loading && _error == null && _rows.isNotEmpty)
          IconButton(
            icon: Icon(Icons.swap_vert_rounded, color: _sort == _Sort.none ? null : T.navy),
            tooltip: tr('ترتيب', 'Sort'),
            onPressed: _openSort,
          ),
      ],
      appBarBottom: (!_loading && _error == null && fSpec != null && _rows.isNotEmpty)
          ? PreferredSize(
              preferredSize: const Size.fromHeight(46),
              child: SizedBox(
                height: 46,
                child: ListView(
                  scrollDirection: Axis.horizontal,
                  padding: const EdgeInsets.fromLTRB(12, 4, 12, 8),
                  children: [
                    _FilterChip(label: tr('الكل', 'All'), count: countFor(''), selected: _filter.isEmpty,
                        onTap: () => setState(() => _filter = '')),
                    for (final o in (fSpec.options ?? const <(String, String, String)>[]))
                      Padding(
                        padding: const EdgeInsets.only(right: 6),
                        child: _FilterChip(
                          label: tr(o.$2, o.$3), count: countFor(o.$1), selected: _filter == o.$1,
                          onTap: () => setState(() => _filter = _filter == o.$1 ? '' : o.$1),
                        ),
                      ),
                  ],
                ),
              ),
            )
          : null,
      floatingActionButton: cfg.canCreate
          ? FloatingActionButton.extended(
              backgroundColor: T.navy,
              foregroundColor: Colors.white,
              onPressed: () => _openForm(),
              icon: const Icon(Icons.add),
              label: Text(tr('إضافة', 'Add')),
            )
          : null,
      body: _loading
          ? ListView(padding: const EdgeInsets.all(14), children: const [
              Shimmer(height: 48), SizedBox(height: 10), Shimmer(), SizedBox(height: 10),
              Shimmer(), SizedBox(height: 10), Shimmer(),
            ])
          : _error != null
              ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
              : Column(children: [
                  Padding(
                    padding: const EdgeInsets.fromLTRB(14, 12, 14, 4),
                    child: TextField(
                      onChanged: (v) {
                        setState(() => _q = v);
                        if (cfg.serverSearch) _searchDebounced();
                      },
                      decoration: InputDecoration(
                        hintText: tr('ابحث…', 'Search…'),
                        prefixIcon: const Icon(Icons.search),
                        suffixText: '${filtered.length}',
                      ),
                    ),
                  ),
                  Expanded(
                    child: RefreshIndicator(
                      onRefresh: _load,
                      child: filtered.isEmpty
                          ? EmptyState(icon: cfg.icon, title: tr('لا توجد بيانات مطابقة', 'No matches'))
                          : ListView.separated(
                              padding: const EdgeInsets.fromLTRB(14, 8, 14, 90),
                              // صف إضافي في النهاية لزر «تحميل المزيد» عندما نكون على الحدّ.
                              itemCount: filtered.length + ((_rows.length >= _limit && _filter.isEmpty && q.isEmpty) ? 1 : 0),
                              separatorBuilder: (_, __) => const SizedBox(height: 8),
                              itemBuilder: (c, i) {
                                if (i >= filtered.length) {
                                  return Padding(
                                    padding: const EdgeInsets.symmetric(vertical: 6),
                                    child: OutlinedButton.icon(
                                      onPressed: _loadingMore ? null : _loadMore,
                                      icon: _loadingMore
                                          ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2))
                                          : const Icon(Icons.expand_more_rounded, size: 18),
                                      label: Text(_loadingMore
                                          ? tr('جارِ التحميل…', 'Loading…')
                                          : tr('تحميل المزيد (${_rows.length}+)', 'Load more (${_rows.length}+)')),
                                    ),
                                  );
                                }
                                final r = filtered[i];
                                final chips = cfg.chipsOf?.call(r) ?? const [];
                                return FadeSlideIn(
                                  delayMs: (i * 15).clamp(0, 150),
                                  child: Pressable(
                                    onTap: cfg.onOpen != null
                                        ? () => cfg.onOpen!(context, r)
                                        : cfg.canEdit ? () => _openForm(row: r) : null,
                                    onLongPress: cfg.onOpen != null && cfg.canEdit ? () => _openForm(row: r) : null,
                                    child: AppCard(
                                      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                                      child: Row(children: [
                                        Container(
                                          padding: const EdgeInsets.all(9),
                                          decoration: BoxDecoration(
                                            color: T.navy.withValues(alpha: 0.07),
                                            borderRadius: BorderRadius.circular(11),
                                          ),
                                          child: Icon(cfg.icon, size: 19, color: T.navy),
                                        ),
                                        const SizedBox(width: 10),
                                        Expanded(
                                          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                            Text(cfg.titleOf(r),
                                                style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13.5),
                                                maxLines: 1, overflow: TextOverflow.ellipsis),
                                            if (cfg.subtitleOf != null && cfg.subtitleOf!(r).isNotEmpty)
                                              Text(cfg.subtitleOf!(r),
                                                  style: const TextStyle(fontSize: 11.5, color: T.inkSoft),
                                                  maxLines: 1, overflow: TextOverflow.ellipsis),
                                            if (chips.any((c2) => c2.$1.isNotEmpty)) ...[
                                              const SizedBox(height: 4),
                                              Wrap(spacing: 4, runSpacing: 4, children: chips.where((c2) => c2.$1.isNotEmpty).map((c2) => Chip2(c2.$1, c2.$2)).toList()),
                                            ],
                                          ]),
                                        ),
                                        if (cfg.rowActions != null)
                                          _rowActionsMenu(r)
                                        else if (cfg.canEdit)
                                          Icon(Lang.instance.ar ? Icons.chevron_left : Icons.chevron_right, color: T.inkFaint),
                                      ]),
                                    ),
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

/// شريحة تصفية أعلى القائمة: عنوان + عدّاد، تُبرز حالتها عند الاختيار.
class _FilterChip extends StatelessWidget {
  final String label;
  final int count;
  final bool selected;
  final VoidCallback onTap;
  const _FilterChip({required this.label, required this.count, required this.selected, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return Material(
      color: selected ? T.navy : T.navy.withValues(alpha: 0.06),
      borderRadius: BorderRadius.circular(20),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(20),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 13, vertical: 8),
          child: Row(mainAxisSize: MainAxisSize.min, children: [
            Text(label,
                style: TextStyle(
                    fontSize: 12.5,
                    fontWeight: FontWeight.w700,
                    color: selected ? Colors.white : T.ink)),
            const SizedBox(width: 5),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
              decoration: BoxDecoration(
                color: selected ? Colors.white.withValues(alpha: 0.25) : T.navy.withValues(alpha: 0.12),
                borderRadius: BorderRadius.circular(9),
              ),
              child: Text('$count',
                  style: TextStyle(
                      fontSize: 11,
                      fontWeight: FontWeight.w800,
                      color: selected ? Colors.white : T.navy)),
            ),
          ]),
        ),
      ),
    );
  }
}

/// The generic create/edit form: builds inputs from FieldSpecs, saves with
/// POST (create) or the configured PUT/PATCH (edit), delete in the header.
class _ResourceForm extends StatefulWidget {
  final ResourceConfig cfg;
  final Map<String, dynamic>? row;
  final Future<void> Function() onDone;
  final VoidCallback? onDelete;
  const _ResourceForm({required this.cfg, this.row, required this.onDone, this.onDelete});

  @override
  State<_ResourceForm> createState() => _ResourceFormState();
}

class _ResourceFormState extends State<_ResourceForm> {
  final Map<String, dynamic> _values = {};
  final Map<String, TextEditingController> _ctrls = {};
  final Map<String, String> _lookupLabels = {}; // fieldName → نص عرض العلاقة المختارة
  bool _busy = false;

  bool get isEdit => widget.row != null;

  @override
  void initState() {
    super.initState();
    for (final f in widget.cfg.fields) {
      final v = widget.row?[f.name];
      switch (f.type) {
        case FieldType.checkbox:
          _values[f.name] = v == true;
        case FieldType.select:
          _values[f.name] = (v ?? '').toString();
        case FieldType.lookup:
          // القيمة قد تكون كائنًا مملوءًا {_id,...} أو id نصيًا.
          if (v is Map) {
            _values[f.name] = (v['_id'] ?? '').toString();
            if (f.lookupLabel != null) _lookupLabels[f.name] = f.lookupLabel!(Map<String, dynamic>.from(v));
          } else {
            _values[f.name] = (v ?? '').toString();
          }
        case FieldType.date:
          _values[f.name] = v != null ? (v.toString().split('T').first) : '';
        default:
          _ctrls[f.name] = TextEditingController(text: (v ?? '').toString());
      }
    }
  }

  @override
  void dispose() {
    for (final c in _ctrls.values) { c.dispose(); }
    super.dispose();
  }

  Future<void> _save() async {
    final body = <String, dynamic>{};
    for (final f in widget.cfg.fields) {
      switch (f.type) {
        case FieldType.checkbox:
          body[f.name] = _values[f.name] == true;
        case FieldType.select:
          body[f.name] = _values[f.name];
        case FieldType.lookup:
          body[f.name] = (_values[f.name] as String?)?.isEmpty ?? true ? null : _values[f.name];
        case FieldType.date:
          body[f.name] = (_values[f.name] as String).isEmpty ? null : _values[f.name];
        case FieldType.number:
          final t = _ctrls[f.name]!.text.trim();
          body[f.name] = t.isEmpty ? null : num.tryParse(t);
        default:
          body[f.name] = _ctrls[f.name]!.text.trim();
      }
      if (f.required && (body[f.name] == null || body[f.name].toString().trim().isEmpty)) {
        ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text(tr('حقل «${f.label}» مطلوب', '"${f.label}" is required'))));
        return;
      }
    }
    setState(() => _busy = true);
    try {
      if (isEdit) {
        final path = '${widget.cfg.endpoint}/${widget.row!['_id']}';
        widget.cfg.updateMethod == 'PATCH'
            ? await Api.instance.patch(path, body)
            : await Api.instance.put(path, body);
      } else {
        await Api.instance.post(widget.cfg.endpoint, body);
      }
      await widget.onDone();
      if (mounted) Navigator.pop(context);
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
      child: DraggableScrollableSheet(
        expand: false,
        initialChildSize: 0.8,
        maxChildSize: 0.95,
        builder: (c, scroll) => ListView(
          controller: scroll,
          padding: const EdgeInsets.all(18),
          children: [
            Row(children: [
              Expanded(
                child: Text(
                  isEdit ? tr('تعديل — ${widget.cfg.titleOf(widget.row!)}', 'Edit') : tr('إضافة ${widget.cfg.arTitle}', 'Add ${widget.cfg.enTitle}'),
                  style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w800),
                  maxLines: 1, overflow: TextOverflow.ellipsis,
                ),
              ),
              if (widget.onDelete != null)
                IconButton(
                  icon: const Icon(Icons.delete_outline, color: T.danger),
                  tooltip: tr('حذف', 'Delete'),
                  onPressed: widget.onDelete,
                ),
            ]),
            const SizedBox(height: 12),
            ...widget.cfg.fields.map(_buildField),
            const SizedBox(height: 14),
            FilledButton(
              onPressed: _busy ? null : _save,
              child: _busy
                  ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                  : Text(isEdit ? tr('حفظ التعديلات', 'Save changes') : tr('إضافة', 'Add')),
            ),
            const SizedBox(height: 10),
          ],
        ),
      ),
    );
  }

  Widget _buildField(FieldSpec f) {
    const pad = EdgeInsets.only(bottom: 10);
    switch (f.type) {
      case FieldType.checkbox:
        return Padding(
          padding: pad,
          child: SwitchListTile(
            contentPadding: EdgeInsets.zero,
            title: Text(f.label, style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600)),
            value: _values[f.name] == true,
            activeTrackColor: T.success,
            onChanged: (v) => setState(() => _values[f.name] = v),
          ),
        );
      case FieldType.select:
        // قيمة الصف قد تكون null أو قيمة قديمة مش في options — نتحمّل الاتنين بلا كراش.
        final current = (_values[f.name] ?? '').toString();
        final opts = f.options ?? const <(String, String, String)>[];
        final known = opts.any((o) => o.$1 == current);
        return Padding(
          padding: pad,
          child: DropdownButtonFormField<String>(
            initialValue: current.isEmpty ? null : current,
            decoration: InputDecoration(labelText: f.label + (f.required ? ' *' : '')),
            items: [
              ...opts.map((o) => DropdownMenuItem(value: o.$1, child: Text(tr(o.$2, o.$3)))),
              if (current.isNotEmpty && !known) DropdownMenuItem(value: current, child: Text(current)),
            ],
            onChanged: (v) => setState(() => _values[f.name] = v ?? ''),
          ),
        );
      case FieldType.lookup:
        final id = (_values[f.name] ?? '').toString();
        final label = _lookupLabels[f.name] ?? (id.isEmpty ? '' : id);
        return Padding(
          padding: pad,
          child: OutlinedButton.icon(
            icon: const Icon(Icons.link_rounded, size: 18),
            style: OutlinedButton.styleFrom(
              minimumSize: const Size.fromHeight(48),
              alignment: AlignmentDirectional.centerStart,
            ),
            label: Text(
              '${f.label}${f.required ? ' *' : ''}: ${label.isEmpty ? tr('اختر…', 'Choose…') : label}',
              style: const TextStyle(fontSize: 14), maxLines: 1, overflow: TextOverflow.ellipsis,
            ),
            onPressed: () async {
              final picked = await showModalBottomSheet<(String, String)?>(
                context: context,
                isScrollControlled: true,
                backgroundColor: Colors.white,
                shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
                builder: (c) => _LookupPicker(field: f, currentId: id),
              );
              if (picked != null) {
                setState(() {
                  _values[f.name] = picked.$1;
                  if (picked.$1.isEmpty) { _lookupLabels.remove(f.name); } else { _lookupLabels[f.name] = picked.$2; }
                });
              }
            },
          ),
        );
      case FieldType.date:
        final val = _values[f.name] as String;
        return Padding(
          padding: pad,
          child: OutlinedButton.icon(
            icon: const Icon(Icons.calendar_month_outlined, size: 18),
            style: OutlinedButton.styleFrom(
              minimumSize: const Size.fromHeight(48),
              alignment: AlignmentDirectional.centerStart,
            ),
            label: Text('${f.label}: ${val.isEmpty ? tr('اختر التاريخ', 'Pick date') : val}',
                style: const TextStyle(fontSize: 14)),
            onPressed: () async {
              final d = await showDatePicker(
                context: context,
                initialDate: DateTime.tryParse(val) ?? DateTime.now(),
                firstDate: DateTime(2020),
                lastDate: DateTime(2032),
              );
              if (d != null) setState(() => _values[f.name] = d.toIso8601String().split('T').first);
            },
          ),
        );
      default:
        return Padding(
          padding: pad,
          child: TextField(
            controller: _ctrls[f.name],
            maxLines: f.type == FieldType.textarea ? 3 : 1,
            keyboardType: f.type == FieldType.number
                ? TextInputType.number
                : f.type == FieldType.phone
                    ? TextInputType.phone
                    : f.type == FieldType.email
                        ? TextInputType.emailAddress
                        : TextInputType.text,
            textDirection: (f.type == FieldType.number || f.type == FieldType.phone || f.type == FieldType.email)
                ? TextDirection.ltr
                : null,
            decoration: InputDecoration(labelText: f.label + (f.required ? ' *' : '')),
          ),
        );
    }
  }
}

/// منتقي علاقة: يجلب الخيارات من endpoint، بحث فوري، واختيار يُرجع (id, label).
/// «بدون» يمسح الاختيار (يُرجع ('', '')).
class _LookupPicker extends StatefulWidget {
  final FieldSpec field;
  final String currentId;
  const _LookupPicker({required this.field, required this.currentId});
  @override
  State<_LookupPicker> createState() => _LookupPickerState();
}

class _LookupPickerState extends State<_LookupPicker> {
  List<Map<String, dynamic>> _rows = [];
  bool _loading = true;
  String? _error;
  String _q = '';

  FieldSpec get f => widget.field;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final qs = f.lookupQuery ?? 'limit=200';
      final sep = (f.lookupEndpoint ?? '').contains('?') ? '&' : '?';
      final d = await Api.instance.get('${f.lookupEndpoint}$sep$qs');
      final raw = d is Map ? d[f.lookupListKey] : (d is List ? d : null);
      if (!mounted) return;
      setState(() {
        _rows = raw is List ? List<Map<String, dynamic>>.from(raw.whereType<Map>().map((e) => Map<String, dynamic>.from(e))) : [];
        _loading = false;
      });
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  String _label(Map<String, dynamic> r) => f.lookupLabel?.call(r) ?? (r['name'] ?? r['title'] ?? r['_id'] ?? '').toString();

  @override
  Widget build(BuildContext context) {
    final q = _fold(_q.trim());
    final filtered = _rows.where((r) => q.isEmpty || _fold(_label(r)).contains(q)).toList();
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
      child: DraggableScrollableSheet(
        expand: false,
        initialChildSize: 0.7,
        maxChildSize: 0.92,
        builder: (c, scroll) => Column(children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(18, 14, 18, 6),
            child: Row(children: [
              Expanded(child: Text(f.label, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w800))),
              TextButton.icon(
                onPressed: () => Navigator.pop(c, ('', '')),
                icon: const Icon(Icons.clear, size: 16),
                label: Text(tr('بدون', 'None')),
              ),
            ]),
          ),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 14),
            child: TextField(
              autofocus: true,
              onChanged: (v) => setState(() => _q = v),
              decoration: InputDecoration(hintText: tr('ابحث…', 'Search…'), prefixIcon: const Icon(Icons.search)),
            ),
          ),
          Expanded(
            child: _loading
                ? const Center(child: CircularProgressIndicator())
                : _error != null
                    ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
                    : filtered.isEmpty
                        ? EmptyState(icon: Icons.link_off_rounded, title: tr('لا نتائج', 'No results'))
                        : ListView.builder(
                            controller: scroll,
                            padding: const EdgeInsets.fromLTRB(8, 6, 8, 20),
                            itemCount: filtered.length,
                            itemBuilder: (c2, i) {
                              final r = filtered[i];
                              final id = (f.lookupValue?.call(r) ?? r['_id'] ?? '').toString();
                              final on = id == widget.currentId;
                              return ListTile(
                                leading: Icon(on ? Icons.radio_button_checked : Icons.radio_button_off,
                                    color: on ? T.navy : T.inkFaint, size: 20),
                                title: Text(_label(r), style: const TextStyle(fontSize: 14)),
                                onTap: () => Navigator.pop(c, (id, _label(r))),
                              );
                            },
                          ),
          ),
        ]),
      ),
    );
  }
}
