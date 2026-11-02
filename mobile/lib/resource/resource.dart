import 'dart:async';
import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/hijri.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';
import '../ui/export_sheet.dart';
import '../ui/search_field.dart';

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
  // Lookup field: fetches options from an endpoint and stores the selected id.
  final String? lookupEndpoint;   // '/api/crm/companies'
  final String? lookupListKey;    // 'companies'
  final String? lookupQuery;      // 'limit=200'
  final String Function(Map<String, dynamic>)? lookupLabel; // Row to display text.
  // Which value is stored from the selected row: normally `_id`, since the field links to an existing record. Managed lists (`/api/lookups`) are stored by their Arabic text instead, because exports and filters read them directly. The stored value is passed explicitly when it differs from the id.
  final String Function(Map<String, dynamic>)? lookupValue;
  /// A registry with thousands of rows is searched on the server. The picker loads one page and filters it locally, which is fine for forty employees but reports "no results" for a supplier past the first page. Callers that raise this send the search text to the server.
  final bool lookupServerSearch;
  /// Title that follows the form selection, e.g. the container count label becomes the vehicle count label when a transaction type is chosen. Receives the current form values; without it the title is fixed.
  final String Function(Map<String, dynamic> values)? labelOf;
  const FieldSpec(this.name, this.ar, this.en,
      {this.type = FieldType.text, this.required = false, this.options,
       this.lookupEndpoint, this.lookupListKey, this.lookupQuery, this.lookupLabel,
       this.lookupValue, this.lookupServerSearch = false, this.labelOf});

  String get label => tr(ar, en);
}

class ResourceConfig {
  final String arTitle;
  final String enTitle;
  final IconData icon;
  final String endpoint;      // '/api/fleet/drivers'
  /// Write endpoint when it differs from the read endpoint. The customer registry is read from `/api/customer-registry` (computed figures) and written on `/api/shipment-orders/customers` (the actual table). Without the split, edits go to an endpoint that does not write.
  final String? writeEndpoint;
  final String listKey;       // 'drivers'
  final String listQuery;     // extra query for the LIST GET only (e.g. 'all=1') — kept off endpoint so /:id actions stay clean
  final String updateMethod;  // 'PUT' | 'PATCH'
  final String liveEvent;     // 'fleet:updated'
  /// Other events that trigger a list reload (e.g. the attachment count of a collection invoice).
  final List<String> extraLiveEvents;
  final List<String> searchFields;
  final List<FieldSpec> fields;
  final String Function(Map<String, dynamic>) titleOf;
  final String Function(Map<String, dynamic>)? subtitleOf;
  final List<(String, Color)> Function(Map<String, dynamic>)? chipsOf;
  final bool canCreate;
  final bool canEdit;
  final bool canDelete;
  /// When set, tapping a row opens a full detail page instead of the edit sheet; editing is via the pencil icon.
  final void Function(BuildContext, Map<String, dynamic>)? onOpen;
  /// When set, the add button opens a custom form instead of the generic one and returns `true` if saved, so the list reloads. For additions that need more than the generic form holds (files).
  final Future<bool?> Function(BuildContext)? onCreate;
  /// Name of a select field used to build the filter chips above the list (All plus each option with its count).
  final String? filterField;
  /// Filter chip options when `filterField` is not a form field, e.g. a server-computed field such as collection status that is not shown in the edit sheet.
  final List<(String, String, String)>? filterOptions;
  /// Extra sort fields besides the name (name, ar, en): (fieldName, arLabel, enLabel).
  final List<(String, String, String)> sortFields;
  /// Quick per-row actions (three-dot menu): toggle, delete or change status without opening the form. Returns the actions for each row; each runs a request and then the list refreshes.
  final List<ResourceAction> Function(Map<String, dynamic>)? rowActions;

  /// Sends the search text to the server (`q=`) instead of filtering in the app. Searching only what is loaded works while the whole list is loaded. A registry of three thousand rows is not downloaded to a phone on a limited network, so the user would search the first 200 and get "no results", a silent truncation.
  final bool serverSearch;

  /// Key of the full record in `GET endpoint/:id`, set when the list rows are trimmed. The edit sheet is filled from the list row and `_save` sends every form field, so a form field missing from the row is sent empty and wipes the stored value (e.g. invoice value and declaration date in clearance). When set, the full record is read before filling, so an empty value really is empty.
  final String? editFullKey;

  /// HR section: under each selected date, shows the matching Hijri date. Optional so other sections' forms are unchanged.
  final bool hijriDates;

  /// Search box hint (Arabic, English) saying what is searched; defaults to a generic "search".
  final (String, String)? searchHint;

  const ResourceConfig({
    required this.arTitle, required this.enTitle, required this.icon,
    required this.endpoint, this.writeEndpoint, required this.listKey,
    this.listQuery = '', this.updateMethod = 'PUT', required this.liveEvent,
    this.extraLiveEvents = const [],
    required this.searchFields, required this.fields, required this.titleOf,
    this.subtitleOf, this.chipsOf,
    this.canCreate = true, this.canEdit = true, this.canDelete = true,
    this.onOpen, this.onCreate, this.filterField, this.filterOptions, this.sortFields = const [], this.rowActions,
    this.serverSearch = false, this.editFullKey, this.hijriDates = false, this.searchHint,
  });

  String get title => tr(arTitle, enTitle);

  /// Endpoint that receives add, edit and delete requests.
  String get writePath => writeEndpoint ?? endpoint;
}

/// Quick row action: icon, title, color, and a function returning (method, path, body?) to execute, or a custom execute function. Optional confirmation message before running.
class ResourceAction {
  final IconData icon;
  final String ar;
  final String en;
  final Color color;
  final String? confirmAr;
  final String? confirmEn;
  /// Ready request: (method 'PATCH'|'PUT'|'POST'|'DELETE', path, body?).
  final (String, String, Map<String, dynamic>?) Function(Map<String, dynamic>)? request;
  /// Action that requires a reason: asked in the confirm dialog (at least three characters) and sent in the request body under this key. The input label uses `reasonAr`/`reasonEn`.
  final String? reasonKey;
  final String? reasonAr;
  final String? reasonEn;
  /// The reason is asked for but not required (e.g. for the not-collected action).
  final bool reasonOptional;
  /// Action with its own screen where the user chooses before sending (e.g. moving a project). Returns true if something changed.
  final Future<bool> Function(BuildContext, Map<String, dynamic>)? run;
  const ResourceAction({
    required this.icon, required this.ar, required this.en, required this.color,
    this.confirmAr, this.confirmEn, this.request, this.reasonKey, this.reasonAr, this.reasonEn, this.run,
    this.reasonOptional = false,
  });
  String get label => tr(ar, en);
}

/// Value of a field in a row; accepts a dotted path ("mate.name") so nested objects can be searched like flat fields.
String _path(Map<String, dynamic> row, String field) {
  if (!field.contains('.')) return (row[field] ?? '').toString();
  dynamic cur = row;
  for (final part in field.split('.')) {
    if (cur is Map) { cur = cur[part]; } else { return ''; }
  }
  return (cur ?? '').toString();
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

// Sort modes available on any list.
enum _Sort { none, azAsc, azDesc, newest, oldest }

class _ResourceScreenState extends State<ResourceScreen> {
  List<Map<String, dynamic>> _rows = [];
  bool _loading = true;
  bool _loadingMore = false;
  String? _error;
  String _q = '';
  final _searchCtl = TextEditingController();
  String _filter = '';        // '' = all; otherwise the selected filterField value.
  _Sort _sort = _Sort.none;
  int _limit = 200;           // Increases on "load more" instead of silently truncating.
  late final void Function() _onLive;

  ResourceConfig get cfg => widget.config;

  // FieldSpec of the filter field (if present and of type select).
  FieldSpec? get _filterSpec {
    if (cfg.filterField == null) return null;
    if (cfg.filterOptions != null) {
      return FieldSpec(cfg.filterField!, '', '', type: FieldType.select, options: cfg.filterOptions);
    }
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
    for (final e in cfg.extraLiveEvents) { Live.instance.on(e, _onLive); }
  }

  @override
  void dispose() {
    _searchTimer?.cancel();
    _searchCtl.dispose();
    Live.instance.off(cfg.liveEvent, _onLive);
    for (final e in cfg.extraLiveEvents) { Live.instance.off(e, _onLive); }
    super.dispose();
  }

  // A server call per keystroke wastes a limited network; the previous timer is cancelled so a stale keystroke result never lands after the latest.
  Timer? _searchTimer;
  void _searchDebounced() {
    _searchTimer?.cancel();
    _searchTimer = Timer(const Duration(milliseconds: 350), () { if (mounted) _load(); });
  }

  int _seq = 0; // Only the latest request writes; an older search arriving late does not wipe the newer result.
  Future<void> _load() async {
    final mine = ++_seq;
    try {
      final qs = [
        if (cfg.listQuery.isNotEmpty) cfg.listQuery,
        'limit=$_limit',
        if (cfg.serverSearch && _q.trim().isNotEmpty) 'q=${Uri.encodeQueryComponent(_q.trim())}',
      ].join('&');
      final d = await Api.instance.get('${cfg.endpoint}?$qs');
      if (!mounted || mine != _seq) return;
      // Tolerates any response shape: {listKey:[...]} or a bare array, without crashing.
      final raw = d is Map ? d[cfg.listKey] : (d is List ? d : null);
      setState(() {
        _rows = raw is List ? List<Map<String, dynamic>>.from(raw.whereType<Map>().map((e) => Map<String, dynamic>.from(e))) : [];
        _loading = false;
        _loadingMore = false;
        _error = null;
      });
    } catch (e) {
      if (mounted && mine == _seq) setState(() { _loading = false; _loadingMore = false; _error = e.toString(); });
    }
  }

  // Load more: raise the limit and refetch, ending the silent truncation at 200.
  Future<void> _loadMore() async {
    if (_loadingMore) return;
    setState(() { _loadingMore = true; _limit += 200; });
    await _load();
  }

  // Sort a copy of the list by the selected mode.
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
      await Api.instance.delete('${cfg.writePath}/${row['_id']}');
      _load();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    }
  }

  // Quick-action menu (three dots) on the row; includes edit and delete automatically.
  Widget _rowActionsMenu(Map<String, dynamic> row) {
    final acts = cfg.rowActions!(row);
    // A row with no actions gets no button, so an empty menu is never opened.
    if (acts.isEmpty && !cfg.canEdit && !cfg.canDelete) return const SizedBox.shrink();
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
    if (a.run != null) {
      final changed = await a.run!(context, row);
      if (changed && mounted) await _load();
      return;
    }
    String? reason;
    if (a.reasonKey != null) {
      final ctrl = TextEditingController();
      String? err;
      reason = await showDialog<String>(
        context: context,
        builder: (c) => StatefulBuilder(builder: (c, setD) => AlertDialog(
          title: Text(a.label),
          content: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
            if (a.confirmAr != null) Text(tr(a.confirmAr!, a.confirmEn ?? a.confirmAr!), style: const TextStyle(fontSize: 13)),
            const SizedBox(height: 10),
            TextField(
              controller: ctrl, autofocus: true, maxLines: 2,
              decoration: InputDecoration(labelText: a.reasonOptional ? '${tr(a.reasonAr ?? 'السبب', a.reasonEn ?? 'Reason')} ${tr('(اختياري)', '(optional)')}' : '${tr(a.reasonAr ?? 'السبب', a.reasonEn ?? 'Reason')} *', errorText: err),
            ),
          ]),
          actions: [
            TextButton(onPressed: () => Navigator.pop(c), child: Text(tr('إلغاء', 'Cancel'))),
            FilledButton(
              style: FilledButton.styleFrom(backgroundColor: a.color),
              onPressed: () {
                if (!a.reasonOptional && ctrl.text.trim().length < 3) { setD(() => err = tr('اكتب السبب', 'Enter the reason')); return; }
                Navigator.pop(c, ctrl.text.trim());
              },
              child: Text(tr('تأكيد', 'Confirm')),
            ),
          ],
        )),
      );
      if (reason == null) return;
    } else if (a.confirmAr != null) {
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
      final (method, path, sent) = req;
      final body = {...?sent, if (reason != null) a.reasonKey!: reason};
      final dynamic res = switch (method) {
        'POST' => await Api.instance.post(path, body),
        'PUT' => await Api.instance.put(path, body),
        'PATCH' => await Api.instance.patch(path, body),
        'DELETE' => await Api.instance.delete(path),
        _ => null,
      };
      // Server message is shown when sent (e.g. "3 sheets returned to uncollected").
      if (mounted && res is Map && '${res['message'] ?? ''}'.isNotEmpty) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('${res['message']}')));
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

  /// Badge holding a raw value ("lead", "visit") shown with its form option label: the value is for the server, the label for the reader. A non-option value stays as is.
  String _chipLabel(String v) {
    for (final f in cfg.fields) {
      for (final o in f.options ?? const <(String, String, String)>[]) {
        if (o.$1 == v) return tr(o.$2, o.$3);
      }
    }
    for (final o in cfg.filterOptions ?? const <(String, String, String)>[]) {
      if (o.$1 == v) return tr(o.$2, o.$3);
    }
    return v;
  }

  /// Export columns: the title, then the form fields by name; select fields export their label, not their value.
  List<ExportCol> _exportColumns() => [
        ExportCol(cfg.arTitle, cfg.enTitle, (r) => cfg.titleOf(r)),
        for (final f in cfg.fields)
          ExportCol(f.ar, f.en, (r) {
            final raw = _path(r, f.name);
            final v = r[f.name];
            if (f.options != null) {
              final o = f.options!.where((x) => x.$1 == raw).toList();
              if (o.isNotEmpty) return tr(o.first.$2, o.first.$3);
            }
            if (v is Map && f.lookupLabel != null) return f.lookupLabel!(Map<String, dynamic>.from(v));
            if (v is List) return v.join('، ');
            if (f.type == FieldType.number) return num.tryParse(raw) ?? raw;
            if (f.type == FieldType.date && raw.length >= 10) return raw.substring(0, 10);
            return raw;
          }),
      ];

  @override
  Widget build(BuildContext context) {
    final q = _fold(_q.trim());
    final fSpec = _filterSpec;
    // Filter by the selected chip, then search, then sort.
    final filtered = _applySort(_rows.where((r) {
      if (_filter.isNotEmpty && (r[cfg.filterField] ?? '').toString() != _filter) return false;
      if (q.isEmpty) return true;
      // The server already searched; filtering again here would drop rows matched on a field `searchFields` does not know.
      if (cfg.serverSearch) return true;
      return cfg.searchFields.any((f) => _fold(_path(r, f)).contains(q));
    }).toList());
    // Count of each filter option, computed from all loaded rows.
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
        // Exports what is visible (after chip, search and sort), like ExportMenu on the web.
        if (!_loading && _error == null && _rows.isNotEmpty)
          ExportButton(fileName: cfg.enTitle, sheetName: cfg.title, columns: _exportColumns(), rows: () => filtered),
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
              onPressed: cfg.onCreate == null
                  ? () => _openForm()
                  : () async { if (await cfg.onCreate!(context) == true && mounted) _load(); },
              icon: const Icon(Icons.add),
              label: Text(tr('إضافة', 'Add')),
            )
          : null,
      // The search box stays fixed on top and is not swapped out while loading or on error; it was redrawn empty while the term still filtered, so content vanished with no way to clear it.
      body: Column(children: [
                  Padding(
                    padding: const EdgeInsets.fromLTRB(14, 12, 14, 4),
                    child: SearchField(
                      controller: _searchCtl,
                      onChanged: (v) {
                        setState(() => _q = v);
                        if (cfg.serverSearch) _searchDebounced();
                      },
                      hint: cfg.searchHint != null ? tr(cfg.searchHint!.$1, cfg.searchHint!.$2) : null,
                      suffixText: _loading ? null : '${filtered.length}',
                    ),
                  ),
                  Expanded(
                    child: _loading
          ? ListView(padding: const EdgeInsets.all(14), children: const [
              Shimmer(), SizedBox(height: 10), Shimmer(), SizedBox(height: 10), Shimmer(),
            ])
          : _error != null
              ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
              : RefreshIndicator(
                      onRefresh: _load,
                      child: filtered.isEmpty
                          ? EmptyState(icon: cfg.icon, title: tr('لا توجد بيانات مطابقة', 'No matches'))
                          : ListView.separated(
                              keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
                              padding: const EdgeInsets.fromLTRB(14, 8, 14, 90),
                              // Extra trailing row for the load-more button when at the limit.
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
                                              Wrap(spacing: 4, runSpacing: 4, children: chips.where((c2) => c2.$1.isNotEmpty).map((c2) => Chip2(_chipLabel(c2.$1), c2.$2)).toList()),
                                            ],
                                          ]),
                                        ),
                                        if (cfg.rowActions != null)
                                          _rowActionsMenu(r)
                                        else if (cfg.canEdit)
                                          // chevron_right flips automatically in Arabic; choosing the left icon there flipped it twice.
                                          const Icon(Icons.chevron_right, color: T.inkFaint),
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

/// Filter chip above the list: title plus count, highlighted when selected.
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
  final Map<String, String> _lookupLabels = {}; // fieldName to the display text of the selected relation.
  bool _busy = false;

  bool get isEdit => widget.row != null;

  @override
  void initState() {
    super.initState();
    _prefill(widget.row);
    if (isEdit && widget.cfg.editFullKey != null) _loadFull();
  }

  void _prefill(Map<String, dynamic>? row) {
    for (final f in widget.cfg.fields) {
      final v = row?[f.name];
      switch (f.type) {
        case FieldType.checkbox:
          _values[f.name] = v == true;
        case FieldType.select:
          _values[f.name] = (v ?? '').toString();
        case FieldType.lookup:
          // The value may be a populated object {_id,...} or a string id.
          if (v is Map) {
            _values[f.name] = (v['_id'] ?? '').toString();
            if (f.lookupLabel != null) _lookupLabels[f.name] = f.lookupLabel!(Map<String, dynamic>.from(v));
          } else {
            _values[f.name] = (v ?? '').toString();
          }
        case FieldType.date:
          _values[f.name] = v != null ? (v.toString().split('T').first) : '';
        default:
          // The controller is reused when refilling with the full record; creating a new one would leave the old one dangling in the tree.
          final c = _ctrls[f.name];
          if (c == null) {
            _ctrls[f.name] = TextEditingController(text: (v ?? '').toString());
          } else {
            c.text = (v ?? '').toString();
          }
      }
    }
  }

  /// Full record before editing; see `editFullKey`. The list row is trimmed and saving sends every form field, so filling from the row alone wipes what it lacks.
  Future<void> _loadFull() async {
    try {
      final d = await Api.instance.get('${widget.cfg.endpoint}/${widget.row!['_id']}');
      final full = d[widget.cfg.editFullKey!];
      if (full is Map && mounted) {
        setState(() => _prefill({...widget.row!, ...Map<String, dynamic>.from(full)}));
      }
    } catch (_) {
      // Read failed: filling from the row continues so an open sheet is never blocked.
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
        final path = '${widget.cfg.writePath}/${widget.row!['_id']}';
        widget.cfg.updateMethod == 'PATCH'
            ? await Api.instance.patch(path, body)
            : await Api.instance.put(path, body);
      } else {
        await Api.instance.post(widget.cfg.writePath, body);
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
        // The row value may be null or an old value not in options; both are tolerated without crashing.
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
            label: Text('${f.label}: ${val.isEmpty ? tr('اختر التاريخ', 'Pick date') : val}'
                '${widget.cfg.hijriDates && val.isNotEmpty ? '\n${hijriHint(val, ar: Lang.instance.ar)}' : ''}',
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
            decoration: InputDecoration(labelText: (f.labelOf?.call(_values) ?? f.label) + (f.required ? ' *' : '')),
          ),
        );
    }
  }
}

/// Relation picker: fetches options from an endpoint, live search, and returns (id, label) on selection. "None" clears the selection (returns ('', '')).
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

  int _seq = 0;
  Timer? _debounce;

  @override
  void dispose() { _debounce?.cancel(); super.dispose(); }

  Future<void> _load() async {
    final mine = ++_seq;
    try {
      final qs = f.lookupQuery ?? 'limit=200';
      final sep = (f.lookupEndpoint ?? '').contains('?') ? '&' : '?';
      // The search text goes to the server when requested; a stale reply never overwrites a newer one.
      final search = f.lookupServerSearch && _q.trim().isNotEmpty
          ? '&q=${Uri.encodeQueryComponent(_q.trim())}' : '';
      final d = await Api.instance.get('${f.lookupEndpoint}$sep$qs$search');
      if (mine != _seq) return;
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

  /// Typing re-requests after a pause; used only for server-side search.
  void _onQueryChanged() {
    if (!f.lookupServerSearch) return;
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 300), _load);
  }

  @override
  Widget build(BuildContext context) {
    final q = _fold(_q.trim());
    // The server already filtered; filtering the result again would hide matches found by mobile number or registry.
    final filtered = f.lookupServerSearch
        ? _rows
        : _rows.where((r) => q.isEmpty || _fold(_label(r)).contains(q)).toList();
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
            child: SearchField(
              autofocus: true,
              onChanged: (v) { setState(() => _q = v); _onQueryChanged(); },
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
