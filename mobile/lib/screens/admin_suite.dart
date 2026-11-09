import 'dart:async';
import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../services/notifications.dart';
import '../services/live.dart';
import '../ui/export_sheet.dart';
import '../ui/app_scaffold.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';
import '../ui/search_field.dart';
import 'package:provider/provider.dart';
import '../services/auth.dart';

/// Admin tools: users (create/edit/lock/delete), permissions matrix (role by section: none/view/edit), and personal notifications.

const roleLabels = {
  'super_admin': ('المدير العام', 'Super Admin'),
  'admin': ('مدير', 'Admin'),
  'employee': ('موظف', 'Employee'),
  'operations_manager': ('مدير العمليات', 'Operations Manager'),
  'operations_staff': ('عمليات', 'Operations'),
  'moderator': ('مشرف', 'Moderator'),
  'client': ('عميل', 'Client'),
  'procurement_staff': ('مشتريات الورشة', 'Purchasing'),
  'b2c_manager': ('رئيس B2C', 'B2C Head'),
  'b2c_deputy': ('نائب مدير قطاع الأفراد', 'B2C Deputy Manager'),
  'b2c_project_lead': ('مدير مشروع B2C', 'B2C PM'),
  'b2c_rep_supervisor': ('مشرف المناديب التشغيلي', 'Ops Rep Supervisor'),
  'b2c_inspection_supervisor': ('مشرف المناديب التفقدي', 'Inspection Supervisor'),
  'remote_employee': ('موظف عن بُعد', 'Remote Employee'),
  'remote_manager': ('مدير العمل عن بُعد', 'Remote Manager'),
  'hr_manager': ('مدير الموارد البشرية', 'HR Manager'),
  'hr_specialist': ('أخصائي موارد بشرية', 'HR Specialist'),
  'crm_manager': ('مدير علاقات العملاء', 'CRM Manager'),
  'crm_specialist': ('أخصائي CRM', 'CRM Specialist'),
  'cfo': ('المدير المالي', 'CFO'),
  'accounting_manager': ('مدير الحسابات', 'Accounting Manager'),
  'accountant': ('محاسب', 'Accountant'),
  'sales_manager': ('مدير المبيعات', 'Sales Manager'),
  'sales_rep': ('مندوب مبيعات', 'Sales Rep'),
  'vendors_manager': ('مدير قسم الموردين', 'Vendors Manager'),
  'vendors_team_leader': ('قائد فريق الموردين', 'Vendors Team Leader'),
  'vendors_staff': ('موظف قسم الموردين', 'Vendors Officer'),
  'vendors_trainee': ('متدرّب قسم الموردين', 'Vendors Trainee'),
  'procurement_manager': ('مدير المشتريات', 'Procurement Manager'),
  'customs_manager': ('مدير التخليص', 'Customs Manager'),
  'customs_officer': ('مخلّص جمركي', 'Customs Officer'),
  'it_manager': ('مدير تقنية المعلومات', 'IT Manager'),
  'it_specialist': ('أخصائي تقنية معلومات', 'IT Specialist'),
  'marketing_manager': ('مدير التسويق', 'Marketing Manager'),
  'marketing_specialist': ('أخصائي تسويق', 'Marketing Specialist'),
  'bd_manager': ('مدير تطوير الأعمال', 'BD Manager'),
  'bd_specialist': ('أخصائي تطوير أعمال', 'BD Specialist'),
  'fleet_manager': ('مدير الأسطول', 'Fleet Manager'),
  'fleet_supervisor': ('مشرف أسطول', 'Fleet Supervisor'),
  'administration_staff': ('شؤون إدارية', 'Administrator'),
  'contracts_manager': ('مدير العقود', 'Contracts Manager'),
  'collections_manager': ('مدير التحصيل', 'Collections Manager'),
  'collections_staff': ('موظف التحصيل', 'Collections Officer'),
  'ops_platform_manager': ('مدير منصة التشغيل', 'Ops Platform Manager'),
  'ops_platform_staff': ('موظف منصة التشغيل', 'Ops Platform Staff'),
  'shipment_orders_manager': ('مدير طلبات الشحنات', 'Shipment Orders Manager'),
  'shipment_orders_staff': ('موظف طلبات الشحنات', 'Shipment Orders Staff'),
  'shipment_orders_followup': ('المتابعة', 'Shipment Follow-up'),
  'vehicles_manager': ('مدير المركبات', 'Vehicles Manager'),
  'vehicles_staff': ('موظف المركبات', 'Vehicles Staff'),
  'location_manager': ('مدير لوكيشن سوليوشن', 'Location Solutions Manager'),
  'location_staff': ('موظف لوكيشن سوليوشن', 'Location Solutions Staff'),
  'administration_manager': ('مدير الشؤون الإدارية', 'Administration Manager'),
  'contracts_staff': ('موظف العقود', 'Contracts Staff'),
};

/// Roles as the server accepts them (/api/users/roles), including every new role and every user type created from the permissions screen. The static list above was the only source before, so it lacked eleven roles and still held two long-merged ones; users for vehicles or Location Solutions could not be created from the phone and an old role was rejected. The static list is the fallback when the server is unreachable.
List<(String, String, String)> serverRoles = [];

Future<void> loadServerRoles() async {
  try {
    final d = await Api.instance.get('/api/users/roles');
    serverRoles = List<Map<String, dynamic>>.from(d['roles'] ?? [])
        .map((r) => ('${r['key']}', '${r['ar'] ?? r['key']}', '${r['en'] ?? r['key']}'))
        .toList();
  } catch (_) {/* The static list remains. */}
}

/// Role keys to choose from: from the server if it responds, otherwise the static list.
List<String> roleKeys() => serverRoles.isNotEmpty ? serverRoles.map((r) => r.$1).toList() : roleLabels.keys.toList();

String roleLabel(dynamic r) {
  for (final s in serverRoles) {
    if (s.$1 == r) return tr(s.$2, s.$3);
  }
  final e = roleLabels[r];
  return e == null ? (r ?? '—').toString() : tr(e.$1, e.$2);
}

String _fold(String s) => s.replaceAll(RegExp('[أإآ]'), 'ا').replaceAll('ى', 'ي').replaceAll('ة', 'ه').toLowerCase();

// Users
class AdminUsersScreen extends StatefulWidget {
  const AdminUsersScreen({super.key});
  @override
  State<AdminUsersScreen> createState() => _AdminUsersScreenState();
}

class _AdminUsersScreenState extends State<AdminUsersScreen> {
  List<Map<String, dynamic>> _rows = [];
  bool _loading = true;
  String? _error;
  String _q = '';
  String _role = '';
  // In-memory filters, as on the web: HR file, status, direct manager.
  String _hr = '';
  String _st = '';
  String _mgr = '';
  final _searchCtl = TextEditingController(); // Text stays equal to _q after loading.

  late final void Function() _onLive;

  @override
  void initState() {
    super.initState();
    loadServerRoles().then((_) { if (mounted) setState(() {}); });
    _load();
    _onLive = () => _load();
    Live.instance.on('user:deleted', _onLive);
  }

  @override
  void dispose() { Live.instance.off('user:deleted', _onLive); _searchCtl.dispose(); super.dispose(); }

  static String _status(Map<String, dynamic> u) => (u['status'] ?? (u['isLocked'] == true ? 'locked' : u['isActive'] == false ? 'inactive' : 'active')).toString();
  static final _exportCols = [
    ExportCol('الاسم الأول', 'First name', (u) => u['firstName']),
    ExportCol('اسم العائلة', 'Last name', (u) => u['lastName']),
    ExportCol('البريد', 'Email', (u) => u['email']),
    ExportCol('الدور', 'Role', (u) => roleLabel(u['role'])),
    ExportCol('المدير المباشر', 'Direct manager', (u) => u['manager'] is Map ? '${u['manager']['firstName'] ?? ''} ${u['manager']['lastName'] ?? ''}'.trim() : ''),
    ExportCol('ملف الموظف', 'HR file', (u) => u['linkedEmployee'] is Map ? '${u['linkedEmployee']['firstName'] ?? ''} ${u['linkedEmployee']['lastName'] ?? ''}'.trim() : tr('غير مرتبط', 'Not linked')),
    ExportCol('الفرع', 'Branch', (u) => u['branch'] is Map ? u['branch']['name'] : ''),
    ExportCol('الحالة', 'Status', (u) => switch (_status(u)) {
          'active' => tr('نشط', 'Active'), 'locked' => tr('مقفول', 'Locked'), 'inactive' => tr('موقوف', 'Inactive'), final x => x,
        }),
    ExportCol('آخر دخول', 'Last login', (u) => (u['lastLogin'] ?? '').toString().replaceFirst('T', ' ').split('.').first),
    ExportCol('تاريخ الإنشاء', 'Created', (u) => (u['createdAt'] ?? '').toString().split('T').first),
  ];

  Future<void> _load() async {
    try {
      final d = await Api.instance.get('/api/users${_role.isEmpty ? '' : '?role=$_role'}');
      if (!mounted) return;
      setState(() { _rows = List<Map<String, dynamic>>.from(d['users'] ?? []); _loading = false; _error = null; });
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  // The full form on one screen, like the web: account type (employee/customer/supplier), role, direct manager (suggested from the org chart), employee file link, branch, B2C projects and branches, the employee's customers, and remote-work pages.
  Future<void> _editSheet(Map<String, dynamic>? u) async {
    final changed = await Navigator.of(context).push<bool>(MaterialPageRoute(
      builder: (_) => _UserFormScreen(user: u, users: _rows),
    ));
    if (changed == true) _load();
  }

  Future<void> _delete(Map<String, dynamic> u) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: Text(tr('حذف المستخدم', 'Delete user')),
        content: Text('${u['firstName'] ?? ''} ${u['lastName'] ?? ''} · ${u['email'] ?? ''}'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: Text(tr('إلغاء', 'Cancel'))),
          FilledButton(style: FilledButton.styleFrom(backgroundColor: T.danger), onPressed: () => Navigator.pop(c, true), child: Text(tr('حذف', 'Delete'))),
        ],
      ),
    );
    if (ok != true) return;
    try {
      await Api.instance.delete('/api/users/${u['_id']}');
      _load();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    }
  }

  // Password reset (at least 8 characters): POST /users/:id/reset-password.
  Future<void> _resetPassword(Map<String, dynamic> u) async {
    final pass = TextEditingController();
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: Text(tr('كلمة سر جديدة', 'New password')),
        content: TextField(
          controller: pass,
          autofocus: true,
          decoration: InputDecoration(labelText: tr('كلمة السر (8 أحرف على الأقل)', 'Password (min 8)')),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: Text(tr('إلغاء', 'Cancel'))),
          FilledButton(onPressed: () => Navigator.pop(c, true), child: Text(tr('تعيين', 'Set'))),
        ],
      ),
    );
    if (ok != true) return;
    if (pass.text.trim().length < 8) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(tr('كلمة السر 8 أحرف على الأقل', 'At least 8 characters'))));
      return;
    }
    try {
      await Api.instance.post('/api/users/${u['_id']}/reset-password', {'newPassword': pass.text.trim()});
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(tr('تم تغيير كلمة السر', 'Password reset'))));
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    }
  }

  // Lock/unlock the account: POST /users/:id/lock (toggle).: Roles and permissions
  Future<void> _toggleLock(Map<String, dynamic> u) async {
    try {
      await Api.instance.post('/api/users/${u['_id']}/lock', {});
      _load();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    }
  }

  @override
  Widget build(BuildContext context) {
    final q = _fold(_q.trim());
    bool partner(Map u) => u['partner'] is Map || u['role'] == 'client' || u['accountType'] == 'customer' || u['accountType'] == 'vendor';
    String hrOf(Map<String, dynamic> u) => partner(u) ? 'partner' : (u['linkedEmployee'] is Map ? 'linked' : 'unlinked');
    String mgrOf(Map<String, dynamic> u) => u['manager'] is Map ? '${u['manager']['_id']}' : '__none';
    final managers = <String, String>{};
    for (final u in _rows) {
      if (u['manager'] is Map) managers['${u['manager']['_id']}'] = '${u['manager']['firstName'] ?? ''} ${u['manager']['lastName'] ?? ''}'.trim();
    }
    final filtered = _rows.where((u) {
      if (_hr.isNotEmpty && hrOf(u) != _hr) return false;
      if (_st.isNotEmpty && _status(u) != _st) return false;
      if (_mgr.isNotEmpty && mgrOf(u) != _mgr) return false;
      if (q.isEmpty) return true;
      return _fold('${u['firstName'] ?? ''} ${u['lastName'] ?? ''} ${u['email'] ?? ''}').contains(q);
    }).toList();
    int countHr(String v) => _rows.where((u) => hrOf(u) == v).length;
    int countSt(String v) => _rows.where((u) => _status(u) == v).length;

    return AppScaffold(
      title: Text(tr('المستخدمون', 'Users')),
      actions: [ExportButton(fileName: 'users', sheetName: tr('المستخدمون', 'Users'), columns: _exportCols, rows: () => filtered)],
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => _editSheet(null),
        icon: const Icon(Icons.person_add_alt_outlined),
        label: Text(tr('مستخدم', 'New')),
      ),
      body: _loading
          ? ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(height: 48), SizedBox(height: 10), Shimmer(), SizedBox(height: 10), Shimmer()])
          : _error != null
              ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
              : Column(children: [
                  Padding(
                    padding: const EdgeInsets.fromLTRB(14, 12, 14, 0),
                    child: SearchField(
                      controller: _searchCtl,
                      onChanged: (v) => setState(() => _q = v),
                      hint: tr('ابحث بالاسم أو البريد…', 'Search…'),
                      suffixText: '${filtered.length}',
                    ),
                  ),
                  Padding(
                    padding: const EdgeInsets.fromLTRB(14, 8, 14, 4),
                    child: SizedBox(
                      height: 40,
                      child: DropdownButtonFormField<String>(
                        initialValue: _role.isEmpty ? null : _role,
                        isExpanded: true,
                        hint: Text(tr('كل الأدوار', 'All roles'), style: const TextStyle(fontSize: 12.5)),
                        decoration: const InputDecoration(isDense: true, contentPadding: EdgeInsets.symmetric(horizontal: 12, vertical: 8)),
                        items: [
                          DropdownMenuItem(value: '', child: Text(tr('كل الأدوار', 'All roles'))),
                          ...roleKeys().map((r) => DropdownMenuItem(value: r, child: Text(roleLabel(r), overflow: TextOverflow.ellipsis))),
                        ],
                        onChanged: (v) { setState(() { _role = v ?? ''; _loading = true; }); _load(); },
                      ),
                    ),
                  ),
                  Padding(
                    padding: const EdgeInsets.fromLTRB(14, 4, 14, 0),
                    child: SizedBox(
                      height: 40,
                      child: DropdownButtonFormField<String>(
                        initialValue: _mgr.isEmpty ? null : _mgr,
                        isExpanded: true,
                        hint: Text(tr('كل المديرين المباشرين', 'Any direct manager'), style: const TextStyle(fontSize: 12.5)),
                        decoration: const InputDecoration(isDense: true, contentPadding: EdgeInsets.symmetric(horizontal: 12, vertical: 8)),
                        items: [
                          DropdownMenuItem(value: '', child: Text(tr('كل المديرين المباشرين', 'Any direct manager'))),
                          DropdownMenuItem(value: '__none', child: Text(tr('بدون مدير مباشر', 'No direct manager'))),
                          ...managers.entries.map((e) => DropdownMenuItem(value: e.key, child: Text(e.value, overflow: TextOverflow.ellipsis))),
                        ],
                        onChanged: (v) => setState(() => _mgr = v ?? ''),
                      ),
                    ),
                  ),
                  SizedBox(
                    height: 46,
                    child: ListView(scrollDirection: Axis.horizontal, padding: const EdgeInsets.fromLTRB(14, 6, 14, 0), children: [
                      for (final x in [('linked', tr('مرتبط بملف موظف', 'Linked')), ('unlinked', tr('غير مرتبط', 'Not linked'))])
                        Padding(padding: const EdgeInsetsDirectional.only(end: 6), child: FilterChip(
                          label: Text('${x.$2} (${countHr(x.$1)})'), selected: _hr == x.$1,
                          onSelected: (_) => setState(() => _hr = _hr == x.$1 ? '' : x.$1))),
                      for (final x in [('active', tr('نشط', 'Active')), ('inactive', tr('موقوف', 'Inactive')), ('locked', tr('مقفول', 'Locked'))])
                        Padding(padding: const EdgeInsetsDirectional.only(end: 6), child: FilterChip(
                          label: Text('${x.$2} (${countSt(x.$1)})'), selected: _st == x.$1,
                          onSelected: (_) => setState(() => _st = _st == x.$1 ? '' : x.$1))),
                    ]),
                  ),
                  Expanded(
                    child: RefreshIndicator(
                      onRefresh: _load,
                      child: filtered.isEmpty
                          ? ListView(keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag, children: [const SizedBox(height: 80), EmptyState(icon: Icons.group_outlined, title: q.isNotEmpty ? tr('لا نتائج مطابقة', 'No matches') : tr('لا يوجد مستخدمون', 'No users'))])
                          : ListView.separated(
                              keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
                              padding: const EdgeInsets.all(14),
                              itemCount: filtered.length,
                              separatorBuilder: (_, __) => const SizedBox(height: 8),
                              itemBuilder: (c, i) {
                                final u = filtered[i];
                                final active = u['isActive'] != false;
                                return FadeSlideIn(
                                  delayMs: (i * 12).clamp(0, 120),
                                  child: Pressable(
                                    onTap: () => _editSheet(u),
                                    child: AppCard(
                                      topAccent: active ? T.success : T.danger,
                                      child: Row(children: [
                                        Expanded(
                                          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                            Text('${u['firstName'] ?? ''} ${u['lastName'] ?? ''}'.trim(), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13.5)),
                                            Text((u['email'] ?? '').toString(), style: const TextStyle(fontSize: 11.5, color: T.inkSoft)),
                                            if (u['manager'] is Map)
                                              Text('${tr('المدير المباشر', 'Direct manager')}: ${u['manager']['firstName'] ?? ''} ${u['manager']['lastName'] ?? ''}',
                                                  style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: Color(0xFF334155))),
                                            const SizedBox(height: 4),
                                            Wrap(spacing: 6, children: [
                                              Chip2(roleLabel(u['role']), T.navy),
                                              if (!active) Chip2(tr('موقوف', 'Inactive'), T.danger),
                                              if (u['isLocked'] == true) Chip2(tr('مقفول', 'Locked'), T.warn),
                                              if (u['branch'] is Map) Chip2('${u['branch']['name'] ?? ''}', T.inkSoft, icon: Icons.store_mall_directory_outlined),
                                              if (u['linkedEmployee'] is Map)
                                                Chip2('${tr('ملف الموظف', 'HR file')}: ${u['linkedEmployee']['firstName'] ?? ''} ${u['linkedEmployee']['lastName'] ?? ''}'.trim(), T.success, icon: Icons.badge_outlined)
                                              else if (u['partner'] is! Map && u['role'] != 'client')
                                                Chip2(tr('غير مرتبط بملف موظف', 'No HR file'), T.warn, icon: Icons.badge_outlined),
                                              if (u['partner'] is Map) Chip2('${u['partner']['name'] ?? ''}', T.orange, icon: Icons.storefront_outlined),
                                            ]),
                                          ]),
                                        ),
                                        PopupMenuButton<int>(
                                          icon: const Icon(Icons.more_vert, size: 20, color: T.inkFaint),
                                          onSelected: (v) {
                                            if (v == 0) _editSheet(u);
                                            if (v == 1) _resetPassword(u);
                                            if (v == 2) _toggleLock(u);
                                            if (v == 3) _delete(u);
                                          },
                                          itemBuilder: (c2) => [
                                            PopupMenuItem(value: 0, child: Row(children: [const Icon(Icons.edit_outlined, size: 18, color: T.navy), const SizedBox(width: 10), Text(tr('تعديل', 'Edit'))])),
                                            PopupMenuItem(value: 1, child: Row(children: [const Icon(Icons.key_outlined, size: 18, color: T.info), const SizedBox(width: 10), Text(tr('إعادة تعيين كلمة السر', 'Reset password'))])),
                                            PopupMenuItem(value: 2, child: Row(children: [Icon(u['isLocked'] == true ? Icons.lock_open_outlined : Icons.lock_outline, size: 18, color: T.warn), const SizedBox(width: 10), Text(u['isLocked'] == true ? tr('فك القفل', 'Unlock') : tr('قفل الحساب', 'Lock'))])),
                                            PopupMenuItem(value: 3, child: Row(children: [const Icon(Icons.delete_outline, size: 18, color: T.danger), const SizedBox(width: 10), Text(tr('حذف', 'Delete'))])),
                                          ],
                                        ),
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

// Counterpart of /system/permissions on the web, in two layers: the section (none/view/edit) decides read and write, and the page (open/closed) decides where inside what the section grants. Also the login page per role and the created user types (create/delete). Saving is one PUT of the whole map `{sections, pages, pagesAll:true, homePage}`; without `pages` the phone saved sections and left pages unchanged.
const _sectionAr = {
  'Main': 'الرئيسية', 'Operations': 'العمليات', 'Collections': 'التحصيل', 'Operations Platform': 'منصة الأوبريشن (B2B)',
  'B2C': 'B2C', 'Workshop': 'الورشة', 'Admin': 'الإدارة', 'Tools': 'الأدوات', 'Portal': 'البوابة', 'Remote': 'العمل عن بُعد',
  'HR': 'الموارد البشرية', 'Self Service': 'الخدمة الذاتية', 'CRM': 'إدارة العلاقات', 'Sales': 'المبيعات',
  'Accounting': 'الإدارة المالية', 'Procurement': 'المشتريات', 'Customs': 'التخليص الجمركي', 'Vehicles': 'المركبات',
  'Location Solutions': 'لوكيشن سوليوشن', 'Performance': 'تقييم الأداء', 'Marketing': 'التسويق',
  'Business Development': 'تطوير الأعمال', 'Software & IT': 'البرمجيات وتقنية المعلومات', 'Shipment Orders': 'طلبات الشحنات',
  'Fleet Management': 'إدارة الأسطول', 'Administration': 'الشؤون الإدارية', 'Contracts': 'إدارة العقود',
  'Business Review': 'مراجعة الأعمال', 'Executive': 'الإدارة العليا',
};
String sectionLabel(String s) => tr(_sectionAr[s] ?? s, s);

class PermissionsScreen extends StatefulWidget {
  const PermissionsScreen({super.key});
  @override
  State<PermissionsScreen> createState() => _PermissionsScreenState();
}

class _PermissionsScreenState extends State<PermissionsScreen> {
  Map<String, dynamic>? _d;
  bool _loading = true, _saving = false;
  String? _error;
  String _role = '';
  Map<String, String> _draft = {};
  Map<String, bool> _pageDraft = {};
  String _home = '';
  final Set<String> _open = {};

  @override
  void initState() { super.initState(); loadServerRoles().then((_) { if (mounted) setState(() {}); }); _load(); }

  void _msg(String m) { if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(m))); }

  Future<void> _load({String? select}) async {
    try {
      final d = Map<String, dynamic>.from(await Api.instance.get('/api/admin/permissions'));
      if (!mounted) return;
      final roles = List<String>.from(d['roles'] ?? []);
      setState(() {
        _d = d;
        _role = select ?? (_role.isNotEmpty && roles.contains(_role) ? _role : (roles.isEmpty ? '' : roles.first));
        _loading = false; _error = null;
      });
      _seed();
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = e is ApiException ? e.message : e.toString(); });
    }
  }

  List<Map<String, dynamic>> get _catalog => List<Map<String, dynamic>>.from((_d?['catalog'] ?? const []).map((e) => Map<String, dynamic>.from(e)));
  List<String> get _managed => List<String>.from(_d?['sections'] ?? const []);
  Map<String, dynamic> _of(String key) => Map<String, dynamic>.from((_d?[key] as Map?)?[_role] ?? const {});
  String get _origHome => ((_d?['explicit'] as Map?)?[_role]?['homePage'] ?? '').toString();

  void _seed() {
    if (_role.isEmpty) return;
    setState(() {
      _draft = _of('permissions').map((k, v) => MapEntry(k, v.toString()));
      _pageDraft = _of('pages').map((k, v) => MapEntry(k, v == true));
      _home = _origHome;
    });
  }

  bool get _dirty {
    final orig = _of('permissions'), origPages = _of('pages');
    if (_managed.any((s) => (_draft[s] ?? 'none') != (orig[s] ?? 'none').toString())) return true;
    if (_catalog.any((p) => (_pageDraft[p['key']] ?? false) != (origPages[p['key']] == true))) return true;
    return _home != _origHome;
  }

  String _roleName(String r) {
    final l = (_d?['roleLabels'] as Map?)?[r];
    return l is Map ? tr('${l['ar'] ?? r}', '${l['en'] ?? r}') : roleLabel(r);
  }
  bool _isCustom(String r) => ((_d?['roleLabels'] as Map?)?[r] as Map?)?['custom'] == true;

  // Changing a section carries its pages along, like the web.
  void _setLevel(String section, String level) => setState(() {
    _draft[section] = level;
    for (final p in _catalog.where((x) => x['section'] == section)) { _pageDraft[p['key']] = level != 'none'; }
  });

  void _setAll(String level) => setState(() {
    for (final s in _managed) { _draft[s] = level; }
    for (final p in _catalog) { if (_managed.contains(p['section'])) _pageDraft[p['key']] = level != 'none'; }
  });

  void _setSectionPages(String section, bool on) => setState(() {
    for (final p in _catalog.where((x) => x['section'] == section)) { _pageDraft[p['key']] = on; }
  });

  // Page in a section that is not granted: tapping grants view on the section and opens only that page.
  void _openOnePage(String section, String key) {
    setState(() {
      _draft[section] = 'view';
      for (final p in _catalog.where((x) => x['section'] == section)) { _pageDraft[p['key']] = p['key'] == key; }
    });
    _msg(tr('مُنح القسمُ «${sectionLabel(section)}» مشاهدةً، وفُتحت هذه الصفحةُ وحدَها فيه — اضغط «حفظ» ليسري.',
        'Granted “${sectionLabel(section)}” view access with only this page open — press Save to apply.'));
  }

  Future<void> _save() async {
    if (_role.isEmpty || _d == null) return;
    setState(() => _saving = true);
    try {
      final pages = {for (final p in _catalog) p['key'].toString(): _pageDraft[p['key']] == true};
      final res = Map<String, dynamic>.from(await Api.instance.put('/api/admin/permissions/$_role',
          {'sections': _draft, 'pages': pages, 'pagesAll': true, 'homePage': _home}));
      final perms = Map<String, dynamic>.from(res['permissions'] ?? {});
      final differ = _draft.entries.where((e) => _managed.contains(e.key) && (perms[e.key] ?? 'none') != e.value).map((e) => sectionLabel(e.key)).toList();
      setState(() {
        (_d!['permissions'] as Map)[_role] = perms;
        (_d!['pages'] as Map)[_role] = Map<String, dynamic>.from(res['pages'] ?? {});
        final ex = Map<String, dynamic>.from(_d!['explicit'] ?? {});
        ex[_role] = {...Map<String, dynamic>.from(ex[_role] ?? {}), 'homePage': _home};
        _d!['explicit'] = ex;
      });
      _seed();
      final granted = perms.values.where((v) => v != 'none').length;
      final pagesNow = Map<String, dynamic>.from(res['pages'] ?? {}).values.where((v) => v == true).length;
      _msg(differ.isNotEmpty
          ? tr('حُفِظ، وفي ${differ.length} قسمًا اختلفت النتيجةُ عمّا طُلب: ${differ.join('، ')}', 'Saved, but ${differ.length} section(s) came back different: ${differ.join(', ')}')
          : tr('حُفِظت صلاحيّاتُ «${_roleName(_role)}» — $granted قسمًا و$pagesNow صفحة', 'Saved “${_roleName(_role)}” — $granted sections, $pagesNow pages'));
      if (mounted) {
        final auth = context.read<AuthProvider>();
        if (auth.role == _role) auth.refreshUser();
      }
    } catch (e) { _msg(e is ApiException ? e.message : tr('تعذّر الحفظ', 'Could not save')); }
    if (mounted) setState(() => _saving = false);
  }

  Future<void> _newRole() async {
    final ar = TextEditingController(), en = TextEditingController(), key = TextEditingController(), desc = TextEditingController();
    final ok = await showModalBottomSheet<bool>(
      context: context, isScrollControlled: true, backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(22))),
      builder: (c) => StatefulBuilder(builder: (c, set) => Padding(
        padding: EdgeInsets.fromLTRB(16, 16, 16, MediaQuery.of(c).viewInsets.bottom + 16),
        child: SingleChildScrollView(child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Text(tr('نوع مستخدم جديد', 'New user type'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16)),
          const SizedBox(height: 10),
          TextField(controller: ar, onChanged: (_) => set(() {}), decoration: InputDecoration(labelText: tr('الاسم بالعربية *', 'Arabic name *'), hintText: tr('مثال: مراجع مالي', 'e.g. Financial reviewer'))),
          TextField(controller: en, onChanged: (_) => set(() {}), decoration: InputDecoration(labelText: tr('الاسم بالإنجليزية *', 'English name *'), hintText: 'Financial reviewer')),
          TextField(
            controller: key,
            onChanged: (v) {
              final clean = v.toLowerCase().replaceAll(RegExp(r'[^a-z0-9_]'), '_');
              if (clean != v) key.value = TextEditingValue(text: clean, selection: TextSelection.collapsed(offset: clean.length));
              set(() {});
            },
            decoration: InputDecoration(labelText: tr('المفتاح *', 'Key *'), hintText: 'financial_reviewer'),
          ),
          Padding(padding: const EdgeInsets.only(top: 4), child: Text(
            tr('حروفٌ لاتينيّةٌ صغيرةٌ وأرقامٌ وشرطةٌ سفليّة. يُكتب على كلّ مستخدمٍ يحمل هذا النوع ولا يُغيَّر بعد الإنشاء. ولاحقة «_manager» محجوزةٌ لمديري الأقسام.',
               'Lowercase letters, digits and underscores. It cannot change afterwards. The “_manager” suffix is reserved for section managers.'),
            style: const TextStyle(fontSize: 11.5, color: T.inkFaint))),
          TextField(controller: desc, decoration: InputDecoration(labelText: tr('لماذا صُنع هذا النوع', 'Why this type exists'))),
          const SizedBox(height: 8),
          Text(tr('يُولَد بلا صلاحيّةٍ واحدة: لا قسمَ ولا صفحة. تُمنَح له من هذه الشاشة بعد إنشائه مباشرةً.',
                  'It is born with nothing: no section, no page. Grant them on this screen right after creating it.'),
              style: const TextStyle(fontSize: 12, color: T.inkSoft)),
          const SizedBox(height: 12),
          FilledButton(
            onPressed: key.text.trim().isEmpty || ar.text.trim().isEmpty || en.text.trim().isEmpty ? null : () => Navigator.pop(c, true),
            child: Text(tr('إنشاء', 'Create')),
          ),
        ])),
      )),
    );
    if (ok != true) return;
    try {
      await Api.instance.post('/api/admin/roles', {'key': key.text.trim(), 'nameAr': ar.text.trim(), 'nameEn': en.text.trim(), 'description': desc.text.trim()});
      _msg(tr('صُنع النوع «${ar.text.trim()}» — امنحه أقسامَه وصفحاتِه الآن', 'Role created — grant its sections and pages now'));
      await loadServerRoles();
      await _load(select: key.text.trim());
    } catch (e) { _msg(e is ApiException ? e.message : tr('تعذّر الإنشاء', 'Could not create')); }
  }

  Future<void> _deleteRole() async {
    final ok = await showDialog<bool>(context: context, builder: (c) => AlertDialog(
      title: Text(tr('حذف النوع «${_roleName(_role)}»؟', 'Delete role “${_roleName(_role)}”?')),
      actions: [
        TextButton(onPressed: () => Navigator.pop(c, false), child: Text(tr('إلغاء', 'Cancel'))),
        FilledButton(style: FilledButton.styleFrom(backgroundColor: T.danger), onPressed: () => Navigator.pop(c, true), child: Text(tr('حذف', 'Delete'))),
      ],
    ));
    if (ok != true) return;
    try {
      await Api.instance.delete('/api/admin/roles/$_role');
      final roles = List<String>.from(_d?['roles'] ?? []).where((r) => r != _role).toList();
      await _load(select: roles.isEmpty ? '' : roles.first);
    } catch (e) { _msg(e is ApiException ? e.message : tr('تعذّر الحذف', 'Could not delete')); }
  }

  Future<void> _pickRole() async {
    final roles = List<String>.from(_d?['roles'] ?? []);
    String q = '';
    final picked = await showModalBottomSheet<String>(
      context: context, isScrollControlled: true, backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(22))),
      builder: (c) => StatefulBuilder(builder: (c, set) {
        final f = roles.where((r) => q.isEmpty || _fold('$r ${_roleName(r)}').contains(_fold(q))).toList();
        return DraggableScrollableSheet(expand: false, initialChildSize: 0.75, maxChildSize: 0.92, builder: (c2, scroll) => Column(children: [
          Padding(padding: const EdgeInsets.fromLTRB(14, 14, 14, 6), child: SearchField(
            autofocus: true, onChanged: (v) => set(() => q = v.trim()),
            hint: tr('ابحث عن دور…', 'Search a role…'),
          )),
          Expanded(child: ListView(controller: scroll, keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag, children: [
            if (f.isEmpty) Padding(padding: const EdgeInsets.all(24), child: Text(tr('لا نتائج مطابقة', 'No matches'), textAlign: TextAlign.center, style: const TextStyle(color: T.inkFaint))),
            for (final r in f) ListTile(
              selected: r == _role,
              title: Text(_roleName(r)),
              trailing: _isCustom(r) ? Chip2(tr('مُصنَّع', 'custom'), T.orange) : null,
              onTap: () => Navigator.pop(c, r),
            ),
          ])),
        ]));
      }),
    );
    if (picked == null || picked == _role || !mounted) return;
    if (_dirty) {
      final leave = await showDialog<bool>(context: context, builder: (c) => AlertDialog(
        title: Text(tr('تغييراتٌ لم تُحفظ', 'Unsaved changes')),
        content: Text(tr('الانتقالُ إلى دورٍ آخر يتجاهلها.', 'Switching roles discards them.')),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: Text(tr('بقاء', 'Stay'))),
          FilledButton(onPressed: () => Navigator.pop(c, true), child: Text(tr('تجاهل', 'Discard'))),
        ],
      ));
      if (leave != true) return;
    }
    setState(() => _role = picked);
    _seed();
  }

  Widget _levelBar(String section) {
    final cur = _draft[section] ?? 'none';
    return SegmentedButton<String>(
      style: const ButtonStyle(visualDensity: VisualDensity.compact),
      showSelectedIcon: false,
      segments: [
        ButtonSegment(value: 'none', label: Text(tr('ممنوع', 'None'), style: const TextStyle(fontSize: 10.5))),
        ButtonSegment(value: 'view', label: Text(tr('مشاهدة', 'View'), style: const TextStyle(fontSize: 10.5))),
        ButtonSegment(value: 'edit', label: Text(tr('تعديل', 'Edit'), style: const TextStyle(fontSize: 10.5))),
      ],
      selected: {['none', 'view', 'edit'].contains(cur) ? cur : 'none'},
      onSelectionChanged: (v) => _setLevel(section, v.first),
    );
  }

  @override
  Widget build(BuildContext context) {
    final me = context.watch<AuthProvider>().role;
    // role-only like the web: whoever sets the matrix is not granted access through it, and creating types is for the system admin.
    final isSuper = const ['super_admin', 'admin', 'it_manager', 'it_specialist'].contains(me);
    final canMakeRoles = const ['super_admin', 'admin', 'it_manager', 'it_specialist'].contains(me);
    final catalog = _catalog;
    final managed = _managed;
    final unmanaged = <String>{for (final p in catalog) if (!managed.contains(p['section'])) p['section'].toString()}.toList();
    final all = [...managed, ...unmanaged];
    final granted = catalog.where((p) => _pageDraft[p['key']] == true).toList();
    final desc = (((_d?['roleLabels'] as Map?)?[_role] as Map?)?['description'] ?? '').toString();

    return AppScaffold(
      title: Text(tr('الأدوار والصلاحيات', 'Roles & Permissions')),
      actions: [
        if (canMakeRoles) IconButton(tooltip: tr('نوع مستخدم جديد', 'New user type'), onPressed: _newRole, icon: const Icon(Icons.person_add_alt)),
      ],
      body: !isSuper
          ? EmptyState(icon: Icons.lock_outline, title: tr('غير مصرّح', 'Not authorized'))
          : _loading
          ? ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(height: 48), SizedBox(height: 10), Shimmer(), SizedBox(height: 10), Shimmer()])
          : _error != null
              ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
              // Maximum width on wide screens (iPad) instead of stretching full width.
              : Center(child: ConstrainedBox(constraints: const BoxConstraints(maxWidth: 760), child: Column(children: [
                  Padding(
                    padding: const EdgeInsets.fromLTRB(14, 12, 14, 4),
                    child: Row(children: [
                      Expanded(child: OutlinedButton(
                        style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(46), alignment: AlignmentDirectional.centerStart),
                        onPressed: _pickRole,
                        child: Row(children: [
                          const Icon(Icons.badge_outlined, size: 18),
                          const SizedBox(width: 8),
                          Expanded(child: Text(_role.isEmpty ? tr('اختر دورًا', 'Pick a role') : _roleName(_role), overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w800))),
                          if (_isCustom(_role)) Chip2(tr('مُصنَّع', 'custom'), T.orange),
                          const Icon(Icons.expand_more),
                        ]),
                      )),
                      if (_isCustom(_role) && canMakeRoles)
                        IconButton(tooltip: tr('حذف النوع', 'Delete role'), onPressed: _deleteRole, icon: const Icon(Icons.delete_outline, color: T.danger)),
                    ]),
                  ),
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 14),
                    child: Row(children: [
                      Expanded(child: Text(
                        '${tr('${granted.length} صفحة مفتوحة من ${catalog.length}', '${granted.length} of ${catalog.length} pages open')}${desc.isEmpty ? '' : ' · $desc'}',
                        style: const TextStyle(fontSize: 11.5, color: T.inkFaint), maxLines: 2, overflow: TextOverflow.ellipsis)),
                      PopupMenuButton<String>(
                        tooltip: tr('الكلّ', 'All'),
                        icon: const Icon(Icons.done_all, size: 20),
                        onSelected: _setAll,
                        itemBuilder: (_) => [
                          PopupMenuItem(value: 'none', child: Text(tr('الكلّ ممنوع', 'All none'))),
                          PopupMenuItem(value: 'view', child: Text(tr('الكلّ مشاهدة', 'All view'))),
                          PopupMenuItem(value: 'edit', child: Text(tr('الكلّ تعديل', 'All edit'))),
                        ],
                      ),
                    ]),
                  ),
                  Expanded(
                    child: ListView(
                      padding: const EdgeInsets.fromLTRB(14, 4, 14, 14),
                      children: [
                        for (final section in all) () {
                          final pages = catalog.where((p) => p['section'] == section).toList();
                          final isManaged = managed.contains(section);
                          final cur = _draft[section] ?? 'none';
                          final on = pages.where((p) => _pageDraft[p['key']] == true).length;
                          final open = _open.contains(section);
                          return Padding(
                            padding: const EdgeInsets.only(bottom: 8),
                            child: AppCard(
                              padding: const EdgeInsets.fromLTRB(12, 8, 12, 8),
                              child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                                InkWell(
                                  onTap: () => setState(() => open ? _open.remove(section) : _open.add(section)),
                                  child: Row(children: [
                                    Icon(open ? Icons.expand_more : Icons.chevron_left, size: 20, color: T.inkFaint),
                                    Expanded(child: Text(sectionLabel(section), style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13))),
                                    Text('$on/${pages.length}', style: const TextStyle(fontSize: 11, color: T.inkFaint)),
                                  ]),
                                ),
                                const SizedBox(height: 6),
                                if (isManaged) Align(alignment: AlignmentDirectional.centerEnd, child: _levelBar(section))
                                else Text(tr('بالصفحات فقط', 'pages only'), style: const TextStyle(fontSize: 11, color: T.inkFaint)),
                                if (open) ...[
                                  const SizedBox(height: 6),
                                  Wrap(spacing: 8, children: [
                                    TextButton(onPressed: () => _setSectionPages(section, true), child: Text(tr('فتح الكل', 'Open all'), style: const TextStyle(fontSize: 12))),
                                    TextButton(onPressed: () => _setSectionPages(section, false), child: Text(tr('إغلاق الكل', 'Close all'), style: const TextStyle(fontSize: 12))),
                                  ]),
                                  if (isManaged && cur == 'none')
                                    Text(tr('القسمُ غيرُ ممنوح — اضغط أيّ صفحةٍ لمنحه «مشاهدة» وفتحِها وحدَها.', 'Section not granted — tap a page to grant view and open just it.'),
                                        style: const TextStyle(fontSize: 11, color: T.warn)),
                                  if (!isManaged)
                                    Text(tr('التأشيرُ يفتح الشاشةَ وأفعالَها — إلّا هذه الشاشةَ نفسَها وحسابَ مديرِ النظام.', 'Ticking opens the screen and its actions — except this screen itself and a super admin account.'),
                                        style: const TextStyle(fontSize: 11, color: T.inkSoft)),
                                  for (final pg in pages)
                                    isManaged && cur == 'none'
                                        ? ListTile(
                                            dense: true, contentPadding: EdgeInsets.zero,
                                            leading: const Icon(Icons.lock_outline, size: 18, color: T.inkFaint),
                                            title: Text(tr('${pg['ar']}', '${pg['en']}'), style: const TextStyle(fontSize: 13, color: T.inkSoft)),
                                            onTap: () => _openOnePage(section, pg['key'].toString()),
                                          )
                                        : CheckboxListTile(
                                            dense: true, contentPadding: EdgeInsets.zero, controlAffinity: ListTileControlAffinity.leading,
                                            value: _pageDraft[pg['key']] == true,
                                            title: Text(tr('${pg['ar']}', '${pg['en']}'), style: const TextStyle(fontSize: 13)),
                                            onChanged: (v) => setState(() => _pageDraft[pg['key'].toString()] = v == true),
                                          ),
                                ],
                              ]),
                            ),
                          );
                        }(),
                      ],
                    ),
                  ),
                  if (_role.isNotEmpty) SafeArea(top: false, child: Container(
                    padding: const EdgeInsets.fromLTRB(14, 8, 14, 8),
                    decoration: const BoxDecoration(color: Colors.white, border: Border(top: BorderSide(color: T.line))),
                    child: Column(mainAxisSize: MainAxisSize.min, children: [
                      // First screen opened for the role, taken from its open pages.
                      DropdownButtonFormField<String>(
                        initialValue: _home.isEmpty || granted.any((p) => p['key'] == _home) ? _home : '',
                        isExpanded: true,
                        decoration: InputDecoration(isDense: true, labelText: tr('صفحة الدخول', 'Landing page'), prefixIcon: const Icon(Icons.home_outlined, size: 18)),
                        items: [
                          DropdownMenuItem(value: '', child: Text(tr('الافتراضيّة لهذا الدور', 'Default for this role'))),
                          for (final p in granted) DropdownMenuItem(value: p['key'].toString(), child: Text('${sectionLabel(p['section'].toString())} — ${tr('${p['ar']}', '${p['en']}')}', overflow: TextOverflow.ellipsis)),
                        ],
                        onChanged: (v) => setState(() => _home = v ?? ''),
                      ),
                      const SizedBox(height: 8),
                      Row(children: [
                        Expanded(child: _dirty
                            ? Text(tr('تغييراتٌ غير محفوظة', 'Unsaved changes'), maxLines: 2, overflow: TextOverflow.ellipsis, style: const TextStyle(color: T.warn, fontSize: 12))
                            : const SizedBox()),
                        TextButton(onPressed: !_dirty || _saving ? null : _seed, child: Text(tr('تراجع', 'Reset'))),
                        FilledButton.icon(
                          // The button sits in a row: bounded minimum width (the theme makes it infinite).
                          style: FilledButton.styleFrom(backgroundColor: T.orange, minimumSize: const Size(0, 44)),
                          onPressed: !_dirty || _saving ? null : _save,
                          icon: _saving ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white)) : const Icon(Icons.save_outlined, size: 18),
                          label: Text(_saving ? tr('جارٍ الحفظ…', 'Saving…') : tr('حفظ', 'Save')),
                        ),
                      ]),
                    ]),
                  )),
                ]))),
    );
  }
}

// Notifications
class NotificationsScreen extends StatefulWidget {
  const NotificationsScreen({super.key});
  @override
  State<NotificationsScreen> createState() => _NotificationsScreenState();
}

class _NotificationsScreenState extends State<NotificationsScreen> {
  List<Map<String, dynamic>> _rows = [];
  int _unread = 0;
  bool _loading = true;
  String? _error;
  bool _unreadOnly = false;

  @override
  void initState() { super.initState(); loadServerRoles().then((_) { if (mounted) setState(() {}); }); _load(); }

  Future<void> _load() async {
    try {
      final d = await Api.instance.get('/api/notifications?limit=50${_unreadOnly ? '&unreadOnly=true' : ''}');
      if (!mounted) return;
      setState(() {
        _rows = List<Map<String, dynamic>>.from(d['notifications'] ?? []);
        _unread = ((d['unreadCount'] ?? 0) as num).toInt();
        _loading = false;
        _error = null;
      });
      NotificationService.instance.setUnread(_unread); // Badge sync
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  @override
  Widget build(BuildContext context) {
    return AppScaffold(
      title: Text(tr('الإشعارات', 'Notifications')),
      actions: [
        if (_unread > 0)
          TextButton(
            onPressed: () async {
              try { await Api.instance.put('/api/notifications/read-all'); NotificationService.instance.clearBadge(); _load(); } catch (_) {}
            },
            child: Text(tr('قراءة الكل', 'Read all'), style: const TextStyle(color: Colors.white, fontSize: 12.5, fontWeight: FontWeight.w700)),
          ),
      ],
      body: _loading
          ? ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(), SizedBox(height: 10), Shimmer(), SizedBox(height: 10), Shimmer()])
          : _error != null
              ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
              : Column(children: [
                  Padding(
                    padding: const EdgeInsets.fromLTRB(14, 10, 14, 4),
                    child: Row(children: [
                      FilterChip(
                        selected: _unreadOnly,
                        onSelected: (_) { setState(() { _unreadOnly = !_unreadOnly; _loading = true; }); _load(); },
                        label: Text('${tr('غير المقروءة', 'Unread')} (${_unread >= 100 ? '99+' : _unread})'),  // The server stops counting at 100.
                        labelStyle: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: _unreadOnly ? Colors.white : T.orange),
                        selectedColor: T.orange,
                        backgroundColor: T.orange.withValues(alpha: 0.1),
                        checkmarkColor: Colors.white,
                        side: BorderSide.none,
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
                      ),
                    ]),
                  ),
                  Expanded(
                    child: RefreshIndicator(
                      onRefresh: _load,
                      child: _rows.isEmpty
                          ? ListView(children: [const SizedBox(height: 80), EmptyState(icon: Icons.notifications_none, title: tr('لا توجد إشعارات', 'No notifications'))])
                          : ListView.separated(
                              padding: const EdgeInsets.all(14),
                              itemCount: _rows.length,
                              separatorBuilder: (_, __) => const SizedBox(height: 8),
                              itemBuilder: (c, i) {
                                final n = _rows[i];
                                final read = n['isRead'] == true;
                                final at = DateTime.tryParse((n['createdAt'] ?? '').toString())?.toLocal();
                                return FadeSlideIn(
                                  delayMs: (i * 12).clamp(0, 120),
                                  child: Pressable(
                                    onTap: read
                                        ? null
                                        : () async {
                                            try { await Api.instance.put('/api/notifications/${n['_id']}/read'); _load(); } catch (_) {}
                                          },
                                    child: AppCard(
                                      topAccent: read ? null : T.orange,
                                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                        Row(children: [
                                          Expanded(child: Text((n['title'] ?? '').toString(), style: TextStyle(fontWeight: read ? FontWeight.w600 : FontWeight.w800, fontSize: 13.5))),
                                          if (!read) const Icon(Icons.circle, size: 9, color: T.orange),
                                        ]),
                                        if ((n['message'] ?? '').toString().isNotEmpty) ...[
                                          const SizedBox(height: 3),
                                          Text((n['message'] ?? '').toString(), style: const TextStyle(fontSize: 12.5, color: T.inkSoft)),
                                        ],
                                        const SizedBox(height: 5),
                                        Text(at != null ? '${at.day}/${at.month}/${at.year} ${at.hour}:${at.minute.toString().padLeft(2, '0')}' : '', style: const TextStyle(fontSize: 10.5, color: T.inkFaint)),
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

// User form
const _remotePages = [
  ('attendance', 'الحضور والانصراف', 'Attendance'), ('dashboard', 'لوحتي', 'My Dashboard'), ('leave', 'الإجازات', 'Leave'),
  ('chat', 'الرسائل', 'Messages'), ('tasks', 'مهامي', 'My Tasks'), ('report', 'التقرير اليومي', 'Daily Report'),
  ('announcements', 'الإعلانات', 'Announcements'),
];

String _idOf(dynamic v) => v is Map ? (v['_id'] ?? '').toString() : (v ?? '').toString();
String _uName(Map<String, dynamic> u) => '${u['firstName'] ?? ''} ${u['lastName'] ?? ''}'.trim();

class _UserFormScreen extends StatefulWidget {
  const _UserFormScreen({required this.user, required this.users});
  final Map<String, dynamic>? user;
  final List<Map<String, dynamic>> users;
  @override
  State<_UserFormScreen> createState() => _UserFormScreenState();
}

class _UserFormScreenState extends State<_UserFormScreen> {
  late final TextEditingController _email, _password, _first, _last;
  String _accountType = 'employee', _role = 'employee', _manager = '', _branch = '', _linkedCustomer = '';
  String _linkedEmployee = '', _linkedEmployeeLabel = '', _partnerSource = '', _partnerRefId = '', _partnerLabel = '';
  bool _active = true, _saving = false, _showPw = false;
  List<String> _projects = [], _branches = [], _customers = [], _remote = _remotePages.map((p) => p.$1).toList();
  List<Map<String, dynamic>> _branchOpts = [], _projectOpts = [], _customerOpts = [], _b2cHeads = [], _remoteManagers = [];
  String? _err;

  Map<String, dynamic>? get _u => widget.user;

  @override
  void initState() {
    super.initState();
    final u = _u;
    _email = TextEditingController(text: (u?['email'] ?? '').toString());
    _password = TextEditingController();
    _first = TextEditingController(text: (u?['firstName'] ?? '').toString());
    _last = TextEditingController(text: (u?['lastName'] ?? '').toString());
    if (u != null) {
      _role = (u['role'] ?? 'employee').toString();
      _active = u['isActive'] != false;
      _manager = _idOf(u['manager']);
      _branch = _idOf(u['branch']);
      _linkedCustomer = _idOf(u['linkedCustomer']);
      _customers = List.from(u['assignedCustomers'] ?? const []).map(_idOf).toList();
      _projects = List.from(u['assignedProjects'] ?? const []).map(_idOf).toList();
      _branches = List.from(u['assignedBranches'] ?? const []).map(_idOf).toList();
      final ra = List.from(u['remoteAccess'] ?? const []).map((e) => e.toString()).toList();
      if (ra.isNotEmpty) _remote = ra;
      final le = u['linkedEmployee'];
      if (le is Map) {
        _linkedEmployee = _idOf(le);
        _linkedEmployeeLabel = '${le['firstName'] ?? ''} ${le['lastName'] ?? ''}${le['iqamaNumber'] != null ? ' (${le['iqamaNumber']})' : ''}';
      }
      _accountType = (u['accountType'] ?? (_role == 'client' ? 'customer' : 'employee')).toString();
      final pt = u['partner'];
      _partnerSource = pt is Map ? '${pt['source'] ?? ''}' : (_role == 'client' && _linkedCustomer.isNotEmpty ? 'customer' : '');
      _partnerRefId = pt is Map ? '${pt['refId'] ?? ''}' : (_role == 'client' ? _linkedCustomer : '');
      _partnerLabel = pt is Map ? '${pt['name'] ?? ''}' : (u['linkedCustomer'] is Map ? '${u['linkedCustomer']['companyName'] ?? ''}' : '');
    }
    _loadOptions();
  }

  @override
  void dispose() { _email.dispose(); _password.dispose(); _first.dispose(); _last.dispose(); super.dispose(); }

  Future<List<Map<String, dynamic>>> _list(String path, String key) async {
    try {
      final d = await Api.instance.get(path);
      final raw = d is Map ? d[key] : d;
      return raw is List ? List<Map<String, dynamic>>.from(raw.whereType<Map>().map((e) => Map<String, dynamic>.from(e))) : [];
    } catch (_) { return []; }
  }

  Future<void> _loadOptions() async {
    final r = await Future.wait([
      _list('/api/branches?active=true', 'branches'),
      _list('/api/b2c/projects?active=true', 'projects'),
      _list('/api/customers', 'customers'),
      _list('/api/users?role=b2c_manager', 'users'),
      _list('/api/users?role=remote_manager', 'users'),
    ]);
    if (!mounted) return;
    setState(() { _branchOpts = r[0]; _projectOpts = r[1]; _customerOpts = r[2]; _b2cHeads = r[3]; _remoteManagers = r[4]; });
  }

  // The manager is suggested from the org chart on create; suggested, not forced.
  Future<void> _onRole(String role) async {
    setState(() { _role = role; _linkedCustomer = ''; _customers = []; });
    if (const ['super_admin', 'admin', 'it_manager', 'it_specialist', 'client'].contains(role)) { setState(() => _manager = ''); return; }
    if (_u != null) return;
    try {
      final d = await Api.instance.get('/api/users/suggest-manager?role=$role');
      final m = d['manager'];
      if (m is Map && mounted) setState(() => _manager = _idOf(m));
    } catch (_) {}
  }

  Future<Map<String, dynamic>?> _search({
    required String title, required Future<List<Map<String, dynamic>>> Function(String q) fetch,
    required String Function(Map<String, dynamic>) label, String Function(Map<String, dynamic>)? sub,
    bool Function(Map<String, dynamic>)? disabled, int minChars = 0,
  }) => showModalBottomSheet<Map<String, dynamic>>(
    context: context, isScrollControlled: true, backgroundColor: Colors.white,
    shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(22))),
    builder: (_) => _SearchSheet(title: title, fetch: fetch, label: label, sub: sub, disabled: disabled, minChars: minChars),
  );

  Future<void> _pickRole() async {
    final keys = roleKeys().where((r) => r != 'super_admin' || const ['super_admin', 'admin', 'it_manager', 'it_specialist'].contains(_role)).toList();
    final picked = await _search(
      title: tr('ابحث باسم الدور…', 'Search a role…'),
      fetch: (q) async => [for (final k in keys) if (q.isEmpty || _fold('$k ${roleLabel(k)}').contains(_fold(q))) {'_id': k}],
      label: (r) => roleLabel(r['_id']),
    );
    if (picked != null) _onRole(picked['_id'].toString());
  }

  Future<void> _pickManager() async {
    final others = widget.users.where((x) => x['_id'] != _u?['_id'] && x['role'] != 'client').toList();
    final picked = await _search(
      title: tr('ابحث بالاسم أو الدور…', 'Name or role…'),
      fetch: (q) async => [
        {'_id': '', 'firstName': tr('بدون مدير (تروح للموارد البشرية مباشرة)', 'No manager (goes straight to HR)')},
        for (final x in others) if (q.isEmpty || _fold('${_uName(x)} ${roleLabel(x['role'])}').contains(_fold(q))) x,
      ],
      label: (x) => _uName(x), sub: (x) => x['role'] == null ? '' : roleLabel(x['role']),
    );
    if (picked != null) setState(() => _manager = picked['_id'].toString());
  }

  Future<void> _pickEmployee() async {
    final picked = await _search(
      title: tr('ابحث بالاسم أو رقم الإقامة أو رقم الموظف…', 'Name, iqama or employee #…'), minChars: 2,
      fetch: (q) => _list('/api/hr/employees-search?q=${Uri.encodeQueryComponent(q)}', 'employees'),
      label: (e) => _uName(e),
      sub: (e) => [e['jobTitle'], e['iqamaNumber'], if (e['employeeNumber'] != null) '#${e['employeeNumber']}'].where((x) => x != null && '$x'.isNotEmpty).join(' · '),
    );
    if (picked == null) return;
    setState(() {
      _linkedEmployee = _idOf(picked);
      _linkedEmployeeLabel = '${_uName(picked)}${picked['iqamaNumber'] != null ? ' (${picked['iqamaNumber']})' : picked['employeeNumber'] != null ? ' (#${picked['employeeNumber']})' : ''}';
    });
  }

  Future<void> _pickPartner() async {
    final picked = await _search(
      title: tr('ابحث بالاسم…', 'Search by name…'),
      fetch: (q) => _list('/api/partners?kind=$_accountType${q.isEmpty ? '' : '&q=${Uri.encodeQueryComponent(q)}'}&limit=400', 'items'),
      label: (o) => '${o['name'] ?? ''}',
      sub: (o) => o['account'] is Map && o['account']['_id'] != _u?['_id']
          ? tr('له حساب بالفعل: ${o['account']['email']}', 'Already has a login: ${o['account']['email']}')
          : tr('${o['registerAr'] ?? ''}', '${o['registerEn'] ?? ''}'),
      disabled: (o) => o['account'] is Map && o['account']['_id'] != _u?['_id'],
    );
    if (picked == null) return;
    setState(() {
      _partnerSource = '${picked['source']}'; _partnerRefId = '${picked['refId']}';
      _partnerLabel = '${picked['name']} — ${tr('${picked['registerAr'] ?? ''}', '${picked['registerEn'] ?? ''}')}';
      if (_first.text.trim().isEmpty) _first.text = '${picked['name'] ?? ''}';
      if (_email.text.trim().isEmpty && '${picked['email'] ?? ''}'.isNotEmpty) _email.text = '${picked['email']}';
    });
  }

  Future<void> _save() async {
    setState(() { _saving = true; _err = null; });
    try {
      final isNew = _u == null;
      if (_first.text.trim().isEmpty || _email.text.trim().isEmpty || (isNew && _password.text.isEmpty)) {
        throw ApiException(0, tr('أكمل الاسم والبريد وكلمة المرور', 'Fill in name, email and password'));
      }
      final body = <String, dynamic>{
        'email': _email.text.trim(), 'firstName': _first.text.trim(), 'lastName': _last.text.trim(),
        'role': _role, 'accountType': _accountType,
        if (_password.text.isNotEmpty) 'password': _password.text,
        if (!isNew) 'isActive': _active,
      };
      if (_accountType != 'employee') {
        if (_partnerRefId.isEmpty) throw ApiException(0, tr('اختر العميل أو المورد المرتبط بهذا الحساب', 'Pick the customer or supplier this account belongs to'));
        body['partner'] = {'source': _partnerSource, 'refId': _partnerRefId};
      } else {
        if (_role == 'client' && _linkedCustomer.isNotEmpty) body['linkedCustomer'] = _linkedCustomer;
        if (_role == 'employee' && (!isNew || _customers.isNotEmpty)) body['assignedCustomers'] = _customers;
        if (isNew) { if (_branch.isNotEmpty) body['branch'] = _branch; } else { body['branch'] = _branch.isEmpty ? null : _branch; }
        final b2c = _role == 'b2c_project_lead' || _role == 'b2c_manager';
        if (b2c) {
          body['assignedProjects'] = _projects; body['assignedBranches'] = _branches;
          if (!isNew) body['remoteAccess'] = <String>[];
        } else if (_role == 'remote_employee') {
          body['remoteAccess'] = _remote;
          if (!isNew) { body['assignedProjects'] = <String>[]; body['assignedBranches'] = <String>[]; }
        } else if (!isNew) {
          body['assignedProjects'] = <String>[]; body['assignedBranches'] = <String>[]; body['remoteAccess'] = <String>[];
        }
        if (isNew) {
          if (_manager.isNotEmpty) body['manager'] = _manager;
          if (_linkedEmployee.isNotEmpty) body['linkedEmployee'] = _linkedEmployee;
        } else {
          body['manager'] = _manager.isEmpty ? null : _manager;
          body['linkedEmployee'] = _linkedEmployee.isEmpty ? null : _linkedEmployee;
        }
      }
      if (isNew) {
        await Api.instance.post('/api/users', body);
      } else {
        await Api.instance.put('/api/users/${_u!['_id']}', body);
      }
      if (mounted) Navigator.pop(context, true);
    } catch (e) {
      if (mounted) setState(() { _err = e is ApiException ? e.message : e.toString(); _saving = false; });
    }
  }

  Widget _label(String s) => Padding(padding: const EdgeInsets.only(top: 14, bottom: 6), child: Text(s, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13)));

  Widget _pickerTile(String text, VoidCallback onTap, {VoidCallback? onClear, IconData icon = Icons.search}) => OutlinedButton(
    style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(46), alignment: AlignmentDirectional.centerStart),
    onPressed: onTap,
    child: Row(children: [
      Icon(icon, size: 18), const SizedBox(width: 8),
      Expanded(child: Text(text, overflow: TextOverflow.ellipsis)),
      if (onClear != null) InkWell(onTap: onClear, child: const Icon(Icons.close, size: 18, color: T.inkFaint)),
    ]),
  );

  Widget _checks(List<Map<String, dynamic>> opts, List<String> sel, String Function(Map<String, dynamic>) label, {String empty = '—'}) => Container(
    constraints: const BoxConstraints(maxHeight: 220),
    decoration: BoxDecoration(border: Border.all(color: T.line), borderRadius: BorderRadius.circular(10)),
    child: opts.isEmpty
        ? Padding(padding: const EdgeInsets.all(12), child: Text(empty, style: const TextStyle(color: T.inkFaint, fontSize: 12)))
        : ListView(shrinkWrap: true, children: [
            for (final o in opts) CheckboxListTile(
              dense: true, controlAffinity: ListTileControlAffinity.leading,
              value: sel.contains(_idOf(o)), title: Text(label(o), style: const TextStyle(fontSize: 13)),
              onChanged: (v) => setState(() { final id = _idOf(o); v == true ? sel.add(id) : sel.remove(id); }),
            ),
          ]),
  );

  @override
  Widget build(BuildContext context) {
    final isNew = _u == null;
    final mgr = widget.users.firstWhere((x) => x['_id'] == _manager, orElse: () => const {});
    final showManager = _accountType == 'employee' && !const ['client', 'super_admin', 'admin', 'it_manager', 'it_specialist', 'b2c_project_lead', 'remote_employee'].contains(_role);
    return AppScaffold(
      title: Text(isNew ? tr('مستخدم جديد', 'New user') : tr('تعديل المستخدم', 'Edit user')),
      body: ListView(padding: const EdgeInsets.fromLTRB(16, 12, 16, 40), children: [
        // Account type
        SegmentedButton<String>(
          showSelectedIcon: false,
          segments: [
            ButtonSegment(value: 'employee', label: Text(tr('موظف', 'Staff'))),
            ButtonSegment(value: 'customer', label: Text(tr('عميل', 'Customer'))),
            ButtonSegment(value: 'vendor', label: Text(tr('مورد', 'Supplier'))),
          ],
          selected: {_accountType},
          onSelectionChanged: (v) => setState(() { _accountType = v.first; _partnerRefId = ''; _partnerSource = ''; _partnerLabel = ''; }),
        ),
        if (_accountType != 'employee') ...[
          _label(_accountType == 'vendor' ? tr('المورد المرتبط *', 'Linked supplier *') : tr('العميل المرتبط *', 'Linked customer *')),
          _pickerTile(_partnerRefId.isEmpty ? tr('ابحث بالاسم…', 'Search by name…') : _partnerLabel, _pickPartner,
              icon: Icons.storefront_outlined, onClear: _partnerRefId.isEmpty ? null : () => setState(() { _partnerRefId = ''; _partnerSource = ''; _partnerLabel = ''; })),
          Padding(padding: const EdgeInsets.only(top: 4), child: Text(
            tr('تجمع القائمة كل سجلات العملاء والموردين في الشركة — وبجانب كل اسم القسم المسجَّل فيه.', 'This list merges every customer/supplier register in the company.'),
            style: const TextStyle(fontSize: 11, color: T.inkFaint))),
        ],
        const SizedBox(height: 12),
        Row(children: [
          Expanded(child: TextField(controller: _first, decoration: InputDecoration(labelText: tr('الاسم الأول *', 'First name *')))),
          const SizedBox(width: 10),
          Expanded(child: TextField(controller: _last, decoration: InputDecoration(labelText: tr('اسم العائلة', 'Last name')))),
        ]),
        const SizedBox(height: 10),
        TextField(controller: _email, keyboardType: TextInputType.emailAddress, decoration: InputDecoration(labelText: tr('البريد *', 'Email *'))),
        const SizedBox(height: 10),
        TextField(
          controller: _password, obscureText: !_showPw,
          decoration: InputDecoration(
            labelText: isNew ? tr('كلمة المرور *', 'Password *') : tr('كلمة مرور جديدة (اختياري)', 'New password (optional)'),
            suffixIcon: IconButton(onPressed: () => setState(() => _showPw = !_showPw), icon: Icon(_showPw ? Icons.visibility_off : Icons.visibility)),
          ),
        ),
        if (_accountType == 'employee') ...[
          _label(tr('الدور', 'Role')),
          _pickerTile(roleLabel(_role), _pickRole, icon: Icons.badge_outlined),
          if (showManager) ...[
            _label('${tr('المدير المباشر', 'Direct Manager')}  ${tr('(اختياري — يُقترح تلقائيًا حسب القسم)', '(optional — auto-suggested by role)')}'),
            _pickerTile(mgr.isEmpty ? tr('بدون مدير (تروح للموارد البشرية مباشرة)', 'No manager (goes straight to HR)') : '${_uName(mgr)} — ${roleLabel(mgr['role'])}',
                _pickManager, icon: Icons.supervisor_account_outlined, onClear: _manager.isEmpty ? null : () => setState(() => _manager = '')),
          ],
          if (_role != 'client') ...[
            _label(tr('ربط بملف موظف (الموارد البشرية)', 'Link to Employee Profile (HR)')),
            _pickerTile(_linkedEmployee.isEmpty ? tr('ابحث بالاسم أو رقم الإقامة أو رقم الموظف...', 'Search by name, iqama, or employee #...') : _linkedEmployeeLabel,
                _pickEmployee, icon: Icons.badge_outlined, onClear: _linkedEmployee.isEmpty ? null : () => setState(() { _linkedEmployee = ''; _linkedEmployeeLabel = ''; })),
          ],
          if (const ['operations_staff', 'operations_manager', 'procurement_staff'].contains(_role)) ...[
            _label(tr('الفرع *', 'Branch *')),
            DropdownButtonFormField<String>(
              initialValue: _branchOpts.any((b) => _idOf(b) == _branch) ? _branch : '', isExpanded: true,
              items: [DropdownMenuItem(value: '', child: Text(tr('اختر الفرع...', 'Select branch...'))), for (final b in _branchOpts) DropdownMenuItem(value: _idOf(b), child: Text('${b['name'] ?? ''}'))],
              onChanged: (v) => setState(() => _branch = v ?? ''),
            ),
          ],
          if (_role == 'client') ...[
            _label(tr('العميل المرتبط', 'Linked customer')),
            DropdownButtonFormField<String>(
              initialValue: _customerOpts.any((c) => _idOf(c) == _linkedCustomer) ? _linkedCustomer : '', isExpanded: true,
              items: [DropdownMenuItem(value: '', child: Text(tr('العميل...', 'Customer...'))), for (final c in _customerOpts) DropdownMenuItem(value: _idOf(c), child: Text('${c['companyName'] ?? ''}', overflow: TextOverflow.ellipsis))],
              onChanged: (v) => setState(() => _linkedCustomer = v ?? ''),
            ),
          ],
          if (_role == 'b2c_manager' || _role == 'b2c_project_lead') ...[
            _label('${tr('المشاريع المعينة', 'Assigned Projects')} (${_projects.length})${_role == 'b2c_manager' ? tr(' — اختياري، له صلاحية كل المشاريع', ' — optional, has access to all') : ''}'),
            _checks(_projectOpts, _projects, (p) => '${p['name'] ?? ''}'),
            _label('${tr('الفروع المعينة', 'Assigned Branches')} (${_branches.length})'),
            _checks(_branchOpts, _branches, (b) => '${b['name'] ?? ''}'),
            if (_role == 'b2c_project_lead') ...[
              _label(tr('المدير المباشر (مدير B2C)', 'Direct Manager (B2C Manager)')),
              DropdownButtonFormField<String>(
                initialValue: _b2cHeads.any((h) => _idOf(h) == _manager) ? _manager : '', isExpanded: true,
                items: [DropdownMenuItem(value: '', child: Text(tr('بدون', 'None'))), for (final h in _b2cHeads) DropdownMenuItem(value: _idOf(h), child: Text('${_uName(h)} — ${h['email'] ?? ''}', overflow: TextOverflow.ellipsis))],
                onChanged: (v) => setState(() => _manager = v ?? ''),
              ),
            ],
          ],
          if (_role == 'employee') ...[
            _label('${tr('العملاء المعيّنون', 'Assigned customers')} (${_customers.length})'),
            _checks(_customerOpts, _customers, (c) => '${c['companyName'] ?? ''}'),
          ],
          if (_role == 'remote_employee') ...[
            _label(tr('المدير المباشر (مدير العمل عن بُعد)', 'Direct Manager (Remote Manager)')),
            DropdownButtonFormField<String>(
              initialValue: _remoteManagers.any((h) => _idOf(h) == _manager) ? _manager : '', isExpanded: true,
              items: [DropdownMenuItem(value: '', child: Text(tr('بدون (السوبر أدمن فقط)', 'None (super admin only)'))), for (final h in _remoteManagers) DropdownMenuItem(value: _idOf(h), child: Text('${_uName(h)} — ${h['email'] ?? ''}', overflow: TextOverflow.ellipsis))],
              onChanged: (v) => setState(() => _manager = v ?? ''),
            ),
            _label('${tr('الصفحات المسموح بها', 'Allowed Pages')} (${_remote.length})'),
            for (final p in _remotePages) CheckboxListTile(
              dense: true, controlAffinity: ListTileControlAffinity.leading,
              value: _remote.contains(p.$1), title: Text(tr(p.$2, p.$3)),
              onChanged: (v) => setState(() => v == true ? _remote.add(p.$1) : _remote.remove(p.$1)),
            ),
          ],
        ],
        if (!isNew) SwitchListTile(
          contentPadding: EdgeInsets.zero,
          title: Text(tr('حساب مُفعّل', 'Account active'), style: const TextStyle(fontSize: 13.5, fontWeight: FontWeight.w700)),
          value: _active, onChanged: (v) => setState(() => _active = v),
        ),
        if (_err != null) Padding(padding: const EdgeInsets.only(top: 10), child: Text(_err!, style: const TextStyle(color: T.danger))),
        const SizedBox(height: 16),
        FilledButton(
          onPressed: _saving ? null : _save,
          child: _saving ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white)) : Text(isNew ? tr('إنشاء', 'Create') : tr('حفظ', 'Save')),
        ),
      ]),
    );
  }
}

/// Generic search sheet: refetches on each keystroke (debounced); an older reply never beats a newer one.
class _SearchSheet extends StatefulWidget {
  const _SearchSheet({required this.title, required this.fetch, required this.label, this.sub, this.disabled, this.minChars = 0});
  final String title;
  final Future<List<Map<String, dynamic>>> Function(String q) fetch;
  final String Function(Map<String, dynamic>) label;
  final String Function(Map<String, dynamic>)? sub;
  final bool Function(Map<String, dynamic>)? disabled;
  final int minChars;
  @override
  State<_SearchSheet> createState() => _SearchSheetState();
}

class _SearchSheetState extends State<_SearchSheet> {
  List<Map<String, dynamic>> _rows = const [];
  bool _loading = false;
  int _seq = 0;
  Timer? _t;

  @override
  void initState() { super.initState(); if (widget.minChars == 0) _run(''); }
  @override
  void dispose() { _t?.cancel(); super.dispose(); }

  Future<void> _run(String q) async {
    // Cancels any earlier reply still in flight (also when clearing).
    if (q.trim().length < widget.minChars) { _seq++; setState(() { _rows = const []; _loading = false; }); return; }
    final mine = ++_seq;
    setState(() => _loading = true);
    final r = await widget.fetch(q.trim());
    if (mounted && mine == _seq) setState(() { _rows = r; _loading = false; });
  }

  @override
  Widget build(BuildContext context) => Padding(
    padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
    child: DraggableScrollableSheet(
      expand: false, initialChildSize: 0.75, maxChildSize: 0.92,
      builder: (c, scroll) => Column(children: [
        Padding(padding: const EdgeInsets.fromLTRB(14, 14, 14, 6), child: SearchField(
          autofocus: true,
          onChanged: (v) { _t?.cancel(); _t = Timer(const Duration(milliseconds: 350), () => _run(v)); },
          hint: widget.title,
        )),
        if (_loading) const LinearProgressIndicator(minHeight: 2),
        Expanded(child: _rows.isEmpty && !_loading
            ? EmptyState(icon: Icons.search_off_rounded, title: tr('لا نتائج', 'No results'))
            : ListView.builder(
                controller: scroll, itemCount: _rows.length,
                keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
                itemBuilder: (c2, i) {
                  final r = _rows[i];
                  final off = widget.disabled?.call(r) ?? false;
                  final sub = widget.sub?.call(r) ?? '';
                  return ListTile(
                    enabled: !off,
                    title: Text(widget.label(r)),
                    subtitle: sub.isEmpty ? null : Text(sub, style: TextStyle(fontSize: 11.5, color: off ? T.danger : T.orange)),
                    onTap: () => Navigator.pop(c, r),
                  );
                },
              )),
      ]),
    ),
  );
}
