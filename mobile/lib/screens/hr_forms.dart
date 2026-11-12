import 'dart:async';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';
import '../services/auth.dart';
import '../ui/file_upload.dart';
import '../config.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';
import '../ui/search_field.dart';

/// Official forms and letters: the HR paper library. Counterpart of `/system/hr/forms`.
/// These papers used to circulate in chat, so an old copy got signed and returned; each paper now has a version number that rises when it is replaced.
/// HR team has the full web capability: new form (file upload), edit or replace its file (bumps the version), archive and restore from the archive.
class HrFormsScreen extends StatefulWidget {
  const HrFormsScreen({super.key});
  @override
  State<HrFormsScreen> createState() => _HrFormsScreenState();
}

class _HrFormsScreenState extends State<HrFormsScreen> {
  List<Map<String, dynamic>> _items = [];
  List<Map<String, dynamic>> _cats = [];
  Map<String, dynamic> _counts = {};
  // "All" is the sum of categories without their filter (server), not the count of the selected category.
  int _total = 0;
  bool _loading = true;
  String? _error;
  String _cat = '';
  String _q = '';
  // Changing the category reloads and destroys the field; the text lives in a controller so it survives.
  final _searchCtl = TextEditingController();
  Timer? _debounce;
  bool _archived = false;
  int _seq = 0;
  late final void Function() _onLive;

  /// HR team by role or department grant; isHRStaff on the web.
  bool get _staff {
    final a = context.read<AuthProvider>();
    return const ['super_admin', 'admin', 'it_manager', 'it_team_leader', 'it_specialist', 'hr_manager', 'hr_team_leader', 'hr_specialist'].contains(a.role) || a.canAccessSection('HR');
  }

  @override
  void initState() {
    super.initState();
    _load();
    _onLive = () => _load();
    Live.instance.on('hr:forms', _onLive);
  }

  @override
  void dispose() {
    Live.instance.off('hr:forms', _onLive);
    _debounce?.cancel();
    _searchCtl.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    final mine = ++_seq;
    try {
      final p = <String>[];
      if (_cat.isNotEmpty) p.add('category=$_cat');
      if (_q.trim().isNotEmpty) p.add('q=${Uri.encodeQueryComponent(_q.trim())}');
      if (_archived) p.add('includeArchived=1');
      final d = await Api.instance.get('/api/hr/forms${p.isEmpty ? '' : '?${p.join('&')}'}');
      if (!mounted || mine != _seq) return;
      setState(() {
        _items = List<Map<String, dynamic>>.from(((d as Map)['items'] as List? ?? const [])
            .map((e) => Map<String, dynamic>.from(e as Map)));
        _cats = List<Map<String, dynamic>>.from((d['categories'] as List? ?? const [])
            .map((e) => Map<String, dynamic>.from(e as Map)));
        _counts = Map<String, dynamic>.from(d['counts'] ?? {});
        _total = (d['total'] as num?)?.toInt() ?? _items.length;
        _loading = false;
        _error = null;
      });
    } catch (e) {
      if (mounted && mine == _seq) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  String _size(dynamic n) {
    final v = (n is num ? n : 0).toInt();
    if (v <= 0) return '—';
    if (v < 1024) return '$v B';
    if (v < 1024 * 1024) return '${(v / 1024).round()} KB';
    return '${(v / 1024 / 1024).toStringAsFixed(1)} MB';
  }

  /// Downloads are counted: an undownloaded form is either unneeded or unknown, and the count tells which over time.
  Future<void> _download(Map<String, dynamic> it) async {
    Api.instance.post('/api/hr/forms/${it['_id']}/downloaded', const {}).catchError((_) => <String, dynamic>{});
    // The file is served at `/api/uploads/...` by the same server and opened in the device browser, which downloads or displays it, as with customs attachments.
    final u = (it['fileUrl'] ?? '').toString();
    if (u.isEmpty) return;
    final uri = Uri.parse(u.startsWith('http') ? u : '${AppConfig.apiBase}$u');
    final ok = await launchUrl(uri, mode: LaunchMode.externalApplication);
    if (!ok && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(tr('تعذّر فتح الملف', 'Could not open the file'))));
    }
  }

  void _snack(String m) { if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(m))); }

  /// New form or edit of an existing one. The file is required on create and optional on edit; replacing it bumps the version on the server.
  Future<void> _openForm([Map<String, dynamic>? edit]) async {
    final title = TextEditingController(text: '${edit?['title'] ?? ''}');
    final titleEn = TextEditingController(text: '${edit?['titleEn'] ?? ''}');
    final desc = TextEditingController(text: '${edit?['description'] ?? ''}');
    String category = '${edit?['category'] ?? (_cat.isNotEmpty ? _cat : 'forms')}';
    if (_cats.isNotEmpty && !_cats.any((c) => c['key'] == category)) category = '${_cats.first['key']}';
    PickedFile? file;
    final ok = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (c) => StatefulBuilder(builder: (c, setS) => Padding(
        padding: EdgeInsets.fromLTRB(18, 18, 18, MediaQuery.of(c).viewInsets.bottom + 18),
        child: SingleChildScrollView(child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(edit != null ? tr('تعديل النموذج', 'Edit document') : tr('نموذج جديد', 'New document'), style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w800)),
          const SizedBox(height: 12),
          TextField(controller: title, decoration: InputDecoration(labelText: tr('اسم النموذج', 'Name'), hintText: tr('نموذج طلب إجازة', 'Leave request form'))),
          const SizedBox(height: 10),
          TextField(controller: titleEn, decoration: InputDecoration(labelText: tr('بالإنجليزية (اختياري)', 'English (optional)'))),
          const SizedBox(height: 10),
          if (_cats.isNotEmpty)
            DropdownButtonFormField<String>(
              initialValue: category,
              decoration: InputDecoration(labelText: tr('التصنيف', 'Category')),
              items: [for (final x in _cats) DropdownMenuItem(value: '${x['key']}', child: Text(tr('${x['ar']}', '${x['en']}')))],
              onChanged: (v) => setS(() => category = v ?? category),
            ),
          const SizedBox(height: 10),
          TextField(controller: desc, maxLines: 2, decoration: InputDecoration(labelText: tr('وصف / متى تُستعمل', 'Description / when to use it'))),
          const SizedBox(height: 10),
          OutlinedButton.icon(
            style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(46), alignment: AlignmentDirectional.centerStart),
            icon: const Icon(Icons.attach_file),
            label: Text(file != null ? file!.fileName
                : edit != null ? tr('استبدال الملفّ (اختياري)', 'Replace the file (optional)') : tr('اختر الملفّ', 'Pick the file'),
                maxLines: 1, overflow: TextOverflow.ellipsis),
            onPressed: () async {
              final f = await pickFileAsDataUrl();
              if (f != null) setS(() => file = f);
            },
          ),
          if (edit != null)
            Padding(
              padding: const EdgeInsets.only(top: 6),
              child: Text(tr('الملفُّ الحاليُّ «${edit['fileName'] ?? '—'}» — نسخة ${edit['version'] ?? 1}. استبدالُه يرفع الرقم إلى ${((edit['version'] ?? 1) as num) + 1}.',
                  'Current file "${edit['fileName'] ?? '—'}" — version ${edit['version'] ?? 1}. Replacing bumps it to ${((edit['version'] ?? 1) as num) + 1}.'),
                  style: const TextStyle(fontSize: 11, color: T.inkFaint)),
            ),
          const SizedBox(height: 14),
          SizedBox(width: double.infinity, child: FilledButton.icon(
            icon: const Icon(Icons.upload_outlined),
            onPressed: () {
              if (title.text.trim().isEmpty) { ScaffoldMessenger.of(c).showSnackBar(SnackBar(content: Text(tr('اكتب اسمَ النموذج', 'Give it a name')))); return; }
              if (edit == null && file == null) { ScaffoldMessenger.of(c).showSnackBar(SnackBar(content: Text(tr('اختر الملفّ', 'Pick the file')))); return; }
              Navigator.pop(c, true);
            },
            label: Text(tr('حفظ', 'Save')),
          )),
        ])),
      )),
    );
    if (ok != true) return;
    final body = <String, dynamic>{
      'title': title.text.trim(), 'titleEn': titleEn.text.trim(), 'category': category, 'description': desc.text.trim(),
      if (file != null) 'file': file!.dataUrl,
      if (file != null) 'fileName': file!.fileName,
    };
    try {
      if (edit != null) {
        await Api.instance.put('/api/hr/forms/${edit['_id']}', body);
        _snack(file != null ? tr('استُبدل الملفُّ — ورقمُ النسخة ارتفع', 'File replaced — version bumped') : tr('حُفظ', 'Saved'));
      } else {
        await Api.instance.post('/api/hr/forms', body);
        _snack(tr('أُضيف النموذج', 'Added'));
      }
      _load();
    } catch (e) { _snack(e.toString()); }
  }

  Future<void> _archive(Map<String, dynamic> it) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        content: Text(tr('أرشفةُ «${it['title']}»؟ تبقى محفوظةً ويمكن إظهارُها.', 'Archive "${it['title']}"? It stays stored.')),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: Text(tr('إلغاء', 'Cancel'))),
          FilledButton(style: FilledButton.styleFrom(backgroundColor: T.danger), onPressed: () => Navigator.pop(c, true), child: Text(tr('أرشفة', 'Archive'))),
        ],
      ),
    );
    if (ok != true) return;
    try { await Api.instance.delete('/api/hr/forms/${it['_id']}'); _snack(tr('أُرشِف', 'Archived')); _load(); }
    catch (e) { _snack(e.toString()); }
  }

  Future<void> _restore(Map<String, dynamic> it) async {
    try { await Api.instance.put('/api/hr/forms/${it['_id']}', {'isActive': true}); _load(); }
    catch (e) { _snack(e.toString()); }
  }

  @override
  Widget build(BuildContext context) {
    final staff = _staff;
    return AppScaffold(
      title: Text(tr('النماذج والخطابات', 'Forms & Letters')),
      floatingActionButton: staff
          ? FloatingActionButton.extended(onPressed: () => _openForm(), icon: const Icon(Icons.add), label: Text(tr('نموذج جديد', 'New document')))
          : null,
      body: _loading
          ? ListView(padding: const EdgeInsets.all(14), children: const [
              Shimmer(height: 50), SizedBox(height: 10), Shimmer(height: 90), SizedBox(height: 10), Shimmer(height: 90),
            ])
          : _error != null
              ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView(padding: const EdgeInsets.all(14), keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag, children: [
                    SearchField(
                      controller: _searchCtl,
                      onChanged: (v) { _q = v; _debounce?.cancel(); _debounce = Timer(const Duration(milliseconds: 350), _load); },
                      hint: tr('ابحث باسم النموذج…', 'Search by name…'),
                    ),
                    const SizedBox(height: 10),
                    SingleChildScrollView(
                      scrollDirection: Axis.horizontal,
                      child: Row(children: [
                        Padding(
                          padding: const EdgeInsets.only(left: 6),
                          child: FilterChip(
                            selected: _cat.isEmpty,
                            onSelected: (_) => setState(() { _cat = ''; _loading = true; _load(); }),
                            label: Text('${tr('الكل', 'All')} ($_total)'),
                            labelStyle: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: _cat.isEmpty ? Colors.white : T.navy),
                            selectedColor: T.orange,
                            backgroundColor: T.navy.withValues(alpha: 0.08),
                            checkmarkColor: Colors.white,
                            side: BorderSide.none,
                            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
                          ),
                        ),
                        for (final c in _cats)
                          Padding(
                            padding: const EdgeInsets.only(left: 6),
                            child: FilterChip(
                              selected: _cat == c['key'],
                              onSelected: (_) => setState(() {
                                _cat = _cat == c['key'] ? '' : c['key'].toString();
                                _loading = true; _load();
                              }),
                              label: Text('${tr(c['ar'].toString(), c['en'].toString())} (${_counts[c['key']] ?? 0})'),
                              labelStyle: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: _cat == c['key'] ? Colors.white : T.navy),
                              selectedColor: T.orange,
                              backgroundColor: T.navy.withValues(alpha: 0.08),
                              checkmarkColor: Colors.white,
                              side: BorderSide.none,
                              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
                            ),
                          ),
                      ]),
                    ),
                    SwitchListTile(
                      dense: true,
                      contentPadding: EdgeInsets.zero,
                      value: _archived,
                      activeThumbColor: T.orange,
                      title: Text(tr('أظهر المؤرشف', 'Show archived'), style: const TextStyle(fontSize: 13)),
                      onChanged: (v) { setState(() { _archived = v; _loading = true; }); _load(); },
                    ),
                    if (_items.isEmpty)
                      EmptyState(icon: Icons.folder_open_outlined, title: tr('لا أوراقَ هنا بعد', 'Nothing here yet')),
                    for (final it in _items)
                      Opacity(opacity: it['isActive'] == false ? 0.6 : 1, child: Card(
                        margin: const EdgeInsets.only(bottom: 8),
                        child: ListTile(
                          leading: Container(
                            padding: const EdgeInsets.all(8),
                            decoration: BoxDecoration(color: T.orange.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(10)),
                            child: const Icon(Icons.description_outlined, color: T.orange, size: 20),
                          ),
                          title: Text((it['title'] ?? '—').toString(), style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 14)),
                          subtitle: Text([
                            '${tr('نسخة', 'v')} ${it['version'] ?? 1}',
                            _size(it['size']),
                            '${it['downloads'] ?? 0} ${tr('تنزيل', 'downloads')}',
                            if ((it['description'] ?? '').toString().isNotEmpty) it['description'].toString(),
                          ].join(' · '), maxLines: 2, overflow: TextOverflow.ellipsis),
                          trailing: Row(mainAxisSize: MainAxisSize.min, children: [
                            IconButton(
                              icon: const Icon(Icons.download_outlined),
                              tooltip: tr('تنزيل', 'Download'),
                              onPressed: () => _download(it),
                            ),
                            if (staff)
                              PopupMenuButton<String>(
                                onSelected: (v) {
                                  if (v == 'edit') _openForm(it);
                                  if (v == 'archive') _archive(it);
                                  if (v == 'restore') _restore(it);
                                },
                                itemBuilder: (_) => [
                                  PopupMenuItem(value: 'edit', child: Text(tr('تعديل أو استبدال الملفّ', 'Edit or replace'))),
                                  if (it['isActive'] != false)
                                    PopupMenuItem(value: 'archive', child: Text(tr('أرشفة', 'Archive'), style: const TextStyle(color: T.danger)))
                                  else
                                    PopupMenuItem(value: 'restore', child: Text(tr('إرجاع', 'Restore'))),
                                ],
                              ),
                          ]),
                          onTap: () => _download(it),
                        ),
                      )),
                  ]),
                ),
    );
  }
}
