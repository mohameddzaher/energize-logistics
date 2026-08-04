import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import '../services/api.dart';
import '../services/auth.dart';
import '../services/lang.dart';
import '../services/live.dart';
import '../ui/app_scaffold.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';

/// بريد الشركة — صناديق البريد على هوستنجر (@energize-logistics.com).
///
/// ⚠️ مش حسابات الدخول للسيستم. الموظف ممكن يكون له الاتنين بكلمتين مرور
/// مختلفتين، وتغيير واحدة ما بيمسّش التانية. الشاشة بتقول كده صراحةً فوق.
///
/// كلمة المرور مشفّرة على السيرفر ومش بترجع مع القائمة؛ فيه زر إظهار بينده
/// endpoint مستقل وكل كشف بيتسجّل باسم اللي عمله.
const _domain = 'energize-logistics.com';

class ItEmailsScreen extends StatefulWidget {
  const ItEmailsScreen({super.key});
  @override
  State<ItEmailsScreen> createState() => _ItEmailsScreenState();
}

class _ItEmailsScreenState extends State<ItEmailsScreen> {
  List<Map<String, dynamic>> _rows = [];
  Map<String, dynamic> _counts = {};
  bool _loading = true;
  bool _vaultReady = true;
  bool _canReveal = false;
  String? _error;
  String _q = '';
  String _linked = '';

  @override
  void initState() {
    super.initState();
    _load();
    Live.instance.on('it:emails', _onLive);
  }

  @override
  void dispose() {
    Live.instance.off('it:emails', _onLive);
    super.dispose();
  }

  void _onLive() { if (mounted) _load(); }

  Future<void> _load() async {
    try {
      final qs = <String>[];
      if (_q.trim().isNotEmpty) qs.add('q=${Uri.encodeQueryComponent(_q.trim())}');
      if (_linked.isNotEmpty) qs.add('linked=$_linked');
      final d = await Api.instance.get('/api/it/emails${qs.isEmpty ? '' : '?${qs.join('&')}'}');
      if (!mounted) return;
      setState(() {
        _rows = List<Map<String, dynamic>>.from(d['emails'] ?? []);
        _counts = Map<String, dynamic>.from(d['counts'] ?? {});
        _vaultReady = d['vaultReady'] != false;
        _canReveal = d['canReveal'] == true;
        _loading = false;
        _error = null;
      });
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = e is ApiException ? e.message : e.toString(); });
    }
  }

  Future<void> _reveal(Map<String, dynamic> r) async {
    try {
      final d = await Api.instance.post('/api/it/emails/${r['_id']}/reveal', {});
      if (!mounted) return;
      final pw = (d['password'] ?? '').toString();
      showDialog(context: context, builder: (c) => AlertDialog(
        title: Text(tr('كلمة المرور', 'Password'), style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 16)),
        content: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text((r['email'] ?? '').toString(), style: const TextStyle(fontSize: 12, color: T.inkSoft), textDirection: TextDirection.ltr),
          const SizedBox(height: 10),
          SelectableText(pw, style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w900, fontFamily: 'monospace'),
              textDirection: TextDirection.ltr),
          const SizedBox(height: 10),
          Text(tr('تم تسجيل عرضك لكلمة المرور باسمك.', 'This reveal was recorded under your name.'),
              style: const TextStyle(fontSize: 10.5, color: T.inkFaint)),
        ]),
        actions: [
          TextButton.icon(
            onPressed: () { Clipboard.setData(ClipboardData(text: pw)); Navigator.pop(c); },
            icon: const Icon(Icons.copy, size: 16), label: Text(tr('نسخ', 'Copy'))),
          TextButton(onPressed: () => Navigator.pop(c), child: Text(tr('إغلاق', 'Close'))),
        ],
      ));
      _load();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e is ApiException ? e.message : e.toString())));
    }
  }

  Widget _chip(String label, String value, String key) {
    final active = _linked == value;
    return Padding(
      padding: const EdgeInsets.only(left: 6, right: 6),
      child: Pressable(
        onTap: () { setState(() { _linked = active ? '' : value; _loading = true; }); _load(); },
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: active ? T.orange : T.line, width: active ? 1.6 : 1),
          ),
          child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text('${_counts[key] ?? 0}', style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 18, height: 1)),
            const SizedBox(height: 3),
            Text(label, style: const TextStyle(fontSize: 10.5, color: T.inkSoft)),
          ]),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    final canEdit = const ['super_admin', 'admin', 'it_manager', 'it_specialist'].contains(auth.role)
        || auth.canEditSection('Software & IT');

    return AppScaffold(
      title: Text(tr('بريد الشركة', 'Company Email')),
      floatingActionButton: !canEdit ? null : FloatingActionButton.extended(
        backgroundColor: T.orange,
        onPressed: () => _openForm(null),
        icon: const Icon(Icons.add), label: Text(tr('بريد', 'Mailbox')),
      ),
      body: _loading
          ? ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(), SizedBox(height: 10), Shimmer()])
          : _error != null
              ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
              : Column(children: [
                  // الفرق اللي لازم يبان من أول نظرة.
                  Container(
                    width: double.infinity,
                    margin: const EdgeInsets.fromLTRB(14, 12, 14, 0),
                    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
                    decoration: BoxDecoration(
                      color: const Color(0xFFFFFBEB),
                      borderRadius: BorderRadius.circular(10),
                      border: Border.all(color: const Color(0xFFFDE68A)),
                    ),
                    child: Text(
                      tr('صناديق بريد الشركة على هوستنجر — مش حسابات الدخول للسيستم. كلمة المرور هنا مالهاش علاقة بدخول الموظف على السيستم.',
                         'Company mailboxes on Hostinger — not system logins. These passwords are unrelated to signing in.'),
                      style: const TextStyle(fontSize: 11, color: Color(0xFF92400E), height: 1.5)),
                  ),
                  if (!_vaultReady)
                    Container(
                      width: double.infinity,
                      margin: const EdgeInsets.fromLTRB(14, 8, 14, 0),
                      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
                      decoration: BoxDecoration(color: const Color(0xFFFEF2F2), borderRadius: BorderRadius.circular(10),
                          border: Border.all(color: const Color(0xFFFECACA))),
                      child: Text(
                        tr('خزنة كلمات المرور غير مهيأة على السيرفر — حفظ كلمات المرور موقوف.',
                           'Password vault not configured — storing passwords is disabled.'),
                        style: const TextStyle(fontSize: 11, color: Color(0xFF991B1B))),
                    ),
                  SizedBox(
                    height: 72,
                    child: ListView(scrollDirection: Axis.horizontal, padding: const EdgeInsets.fromLTRB(8, 12, 8, 4), children: [
                      _chip(tr('الإجمالي', 'Total'), '', 'total'),
                      _chip(tr('مربوط', 'Linked'), 'yes', 'linked'),
                      _chip(tr('غير مربوط', 'Unlinked'), 'no', 'unlinked'),
                      _chip(tr('بدون كلمة مرور', 'No password'), '', 'withoutPassword'),
                    ]),
                  ),
                  Padding(
                    padding: const EdgeInsets.fromLTRB(14, 4, 14, 8),
                    child: TextField(
                      onChanged: (v) { _q = v; _load(); },
                      decoration: InputDecoration(
                        hintText: tr('ابحث بالاسم أو البريد…', 'name or email…'),
                        prefixIcon: const Icon(Icons.search, size: 18), isDense: true),
                    ),
                  ),
                  Expanded(child: RefreshIndicator(
                    onRefresh: _load,
                    child: _rows.isEmpty
                        ? ListView(children: [Padding(padding: const EdgeInsets.only(top: 50),
                            child: EmptyState(icon: Icons.mail_outline, title: tr('لا توجد صناديق', 'No mailboxes')))])
                        : ListView.builder(
                            padding: const EdgeInsets.fromLTRB(14, 0, 14, 90),
                            itemCount: _rows.length,
                            itemBuilder: (c, i) {
                              final r = _rows[i];
                              final linked = r['employee'] != null;
                              final hasPw = (r['passwordSetAt'] ?? '').toString().isNotEmpty;
                              return Padding(
                                padding: const EdgeInsets.only(bottom: 8),
                                child: AppCard(
                                  padding: const EdgeInsets.all(12),
                                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                    Row(children: [
                                      Expanded(child: Text((r['displayName'] ?? r['email']).toString(),
                                          style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13.5))),
                                      Chip2(r['mailboxType'] == 'functional' ? tr('وظيفي', 'Functional') : tr('شخصي', 'Personal'),
                                          r['mailboxType'] == 'functional' ? T.violet : T.inkFaint),
                                    ]),
                                    const SizedBox(height: 4),
                                    Text((r['email'] ?? '').toString(),
                                        style: const TextStyle(fontSize: 11.5, color: T.inkSoft, fontFamily: 'monospace'),
                                        textDirection: TextDirection.ltr),
                                    const SizedBox(height: 6),
                                    Row(children: [
                                      Icon(linked ? Icons.link : Icons.link_off, size: 14, color: linked ? T.success : T.warn),
                                      const SizedBox(width: 4),
                                      Expanded(child: Text(
                                        linked
                                            ? '${r['employeeName'] ?? ''}${(r['employeeNumber'] ?? '').toString().isEmpty ? '' : ' · #${r['employeeNumber']}'}'
                                            : tr('غير مربوط بموظف', 'not linked'),
                                        style: TextStyle(fontSize: 11.5, color: linked ? T.inkSoft : T.warn))),
                                      if (hasPw && _canReveal)
                                        TextButton.icon(
                                          onPressed: () => _reveal(r),
                                          style: TextButton.styleFrom(padding: const EdgeInsets.symmetric(horizontal: 6)),
                                          icon: const Icon(Icons.visibility_outlined, size: 15),
                                          label: Text(tr('كلمة المرور', 'Password'), style: const TextStyle(fontSize: 11)),
                                        )
                                      else if (!hasPw)
                                        Text(tr('بدون كلمة مرور', 'no password'),
                                            style: const TextStyle(fontSize: 10.5, color: T.danger)),
                                    ]),
                                    if (canEdit)
                                      Align(
                                        alignment: AlignmentDirectional.centerEnd,
                                        child: TextButton.icon(
                                          onPressed: () => _openForm(r),
                                          style: TextButton.styleFrom(padding: const EdgeInsets.symmetric(horizontal: 6)),
                                          icon: const Icon(Icons.edit_outlined, size: 15),
                                          label: Text(tr('تعديل', 'Edit'), style: const TextStyle(fontSize: 11)),
                                        ),
                                      ),
                                  ]),
                                ),
                              );
                            }),
                  )),
                ]),
    );
  }

  // ── إضافة / تعديل ──
  Future<void> _openForm(Map<String, dynamic>? row) async {
    final localPart = TextEditingController(
        text: row == null ? '' : (row['localPart'] ?? (row['email'] ?? '').toString().split('@').first).toString());
    final name = TextEditingController(text: (row?['displayName'] ?? '').toString());
    final pw = TextEditingController();
    final notes = TextEditingController(text: (row?['notes'] ?? '').toString());
    String type = (row?['mailboxType'] ?? 'personal').toString();
    String status = (row?['status'] ?? 'active').toString();
    Map<String, dynamic>? emp = row?['employee'] == null
        ? null
        : {'_id': row!['employee'], 'name': row['employeeName'], 'employeeNumber': row['employeeNumber']};

    final saved = await showModalBottomSheet<bool>(
      context: context, isScrollControlled: true, backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (c) => StatefulBuilder(builder: (c2, setInner) => Padding(
        padding: EdgeInsets.fromLTRB(18, 18, 18, MediaQuery.of(c2).viewInsets.bottom + 18),
        child: SingleChildScrollView(
          child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(row == null ? tr('بريد جديد', 'New mailbox') : tr('تعديل بريد', 'Edit mailbox'),
                style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 16)),
            const SizedBox(height: 14),
            TextField(
              controller: localPart, textDirection: TextDirection.ltr,
              decoration: InputDecoration(labelText: tr('اسم البريد', 'Mailbox name'), hintText: 'first.last', suffixText: '@$_domain'),
            ),
            const SizedBox(height: 10),
            // الموظف: بحث حقيقي، القائمة الساكنة مش هتنفع مع مئات الموظفين.
            Pressable(
              onTap: () async {
                final picked = await _pickEmployee(c2);
                if (picked != null) setInner(() => emp = picked['_id'] == null ? null : picked);
              },
              child: InputDecorator(
                decoration: InputDecoration(labelText: tr('الموظف (اختياري)', 'Employee (optional)')),
                child: Text(
                  emp == null ? tr('بدون ربط', 'Not linked')
                      : '${emp!['name']}${(emp!['employeeNumber'] ?? '').toString().isEmpty ? '' : ' · #${emp!['employeeNumber']}'}',
                  style: TextStyle(fontSize: 13, color: emp == null ? T.inkFaint : T.ink)),
              ),
            ),
            const SizedBox(height: 10),
            TextField(controller: name, decoration: InputDecoration(labelText: tr('الاسم الظاهر', 'Display name'))),
            const SizedBox(height: 10),
            Row(children: [
              Expanded(child: DropdownButtonFormField<String>(
                initialValue: type,
                decoration: InputDecoration(labelText: tr('النوع', 'Type')),
                items: [
                  DropdownMenuItem(value: 'personal', child: Text(tr('شخصي', 'Personal'))),
                  DropdownMenuItem(value: 'functional', child: Text(tr('وظيفي', 'Functional'))),
                ],
                onChanged: (v) => setInner(() => type = v ?? 'personal'))),
              const SizedBox(width: 10),
              Expanded(child: DropdownButtonFormField<String>(
                initialValue: status,
                decoration: InputDecoration(labelText: tr('الحالة', 'Status')),
                items: [
                  DropdownMenuItem(value: 'active', child: Text(tr('نشط', 'Active'))),
                  DropdownMenuItem(value: 'suspended', child: Text(tr('موقوف', 'Suspended'))),
                  DropdownMenuItem(value: 'closed', child: Text(tr('مغلق', 'Closed'))),
                ],
                onChanged: (v) => setInner(() => status = v ?? 'active'))),
            ]),
            const SizedBox(height: 10),
            TextField(
              controller: pw, obscureText: true, enabled: _vaultReady, textDirection: TextDirection.ltr,
              decoration: InputDecoration(
                labelText: row == null ? tr('كلمة المرور', 'Password') : tr('كلمة مرور جديدة (اتركها فارغة للإبقاء)', 'New password (blank keeps current)'),
                helperText: _vaultReady
                    ? tr('تُحفظ مشفّرة ولا تظهر إلا بطلب مسجَّل.', 'Stored encrypted; every reveal is recorded.')
                    : tr('الحفظ موقوف — الخزنة غير مهيأة.', 'Disabled — vault not configured.'),
                helperMaxLines: 2,
              ),
            ),
            const SizedBox(height: 10),
            TextField(controller: notes, maxLines: 2, decoration: InputDecoration(labelText: tr('ملاحظات', 'Notes'))),
            const SizedBox(height: 16),
            SizedBox(width: double.infinity, child: FilledButton(
              style: FilledButton.styleFrom(backgroundColor: T.orange),
              onPressed: () => Navigator.pop(c2, true), child: Text(tr('حفظ', 'Save')))),
          ]),
        ),
      )),
    );

    if (saved != true) return;
    final lp = localPart.text.trim();
    if (lp.isEmpty) return;
    final body = {
      'email': lp.contains('@') ? lp : '$lp@$_domain',
      'displayName': name.text.trim(),
      'mailboxType': type,
      'status': status,
      'notes': notes.text.trim(),
      'employee': emp?['_id'],
      if (pw.text.trim().isNotEmpty) 'password': pw.text.trim(),
    };
    try {
      if (row == null) { await Api.instance.post('/api/it/emails', body); }
      else { await Api.instance.put('/api/it/emails/${row['_id']}', body); }
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(tr('تم الحفظ', 'Saved'))));
      _load();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e is ApiException ? e.message : e.toString())));
    }
  }

  Future<Map<String, dynamic>?> _pickEmployee(BuildContext ctx) async {
    final search = TextEditingController();
    List<Map<String, dynamic>> found = [];
    bool busy = false;
    return showModalBottomSheet<Map<String, dynamic>>(
      context: ctx, isScrollControlled: true, backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (c) => StatefulBuilder(builder: (c2, setInner) {
        Future<void> run() async {
          setInner(() => busy = true);
          try {
            final d = await Api.instance.get('/api/it/emails/employees?q=${Uri.encodeQueryComponent(search.text.trim())}');
            found = List<Map<String, dynamic>>.from(d['employees'] ?? []);
          } catch (_) { found = []; }
          setInner(() => busy = false);
        }
        if (found.isEmpty && !busy && search.text.isEmpty) run();
        return Padding(
          padding: EdgeInsets.fromLTRB(16, 16, 16, MediaQuery.of(c2).viewInsets.bottom + 16),
          child: SizedBox(
            height: MediaQuery.of(c2).size.height * 0.6,
            child: Column(children: [
              TextField(
                controller: search, autofocus: true,
                onChanged: (_) => run(),
                decoration: InputDecoration(hintText: tr('ابحث بالاسم أو الرقم الوظيفي…', 'name or employee no…'),
                    prefixIcon: const Icon(Icons.search, size: 18), isDense: true),
              ),
              const SizedBox(height: 8),
              ListTile(
                dense: true,
                leading: const Icon(Icons.link_off, size: 18),
                title: Text(tr('بدون ربط', 'Not linked')),
                onTap: () => Navigator.pop(c2, {'_id': null}),
              ),
              const Divider(height: 1),
              Expanded(child: busy
                  ? const Center(child: CircularProgressIndicator())
                  : ListView.separated(
                      itemCount: found.length,
                      separatorBuilder: (_, __) => const Divider(height: 1),
                      itemBuilder: (c3, i) {
                        final e = found[i];
                        return ListTile(
                          dense: true,
                          title: Text((e['name'] ?? '').toString(), style: const TextStyle(fontSize: 13)),
                          subtitle: Text([
                            if ((e['employeeNumber'] ?? '').toString().isNotEmpty) '#${e['employeeNumber']}',
                            if ((e['department'] ?? '').toString().isNotEmpty) e['department'],
                            if ((e['jobTitle'] ?? '').toString().isNotEmpty) e['jobTitle'],
                          ].join(' · '), style: const TextStyle(fontSize: 11)),
                          onTap: () => Navigator.pop(c2, e),
                        );
                      })),
            ]),
          ),
        );
      }),
    );
  }
}
