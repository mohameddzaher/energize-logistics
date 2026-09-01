import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/lang.dart';
import '../services/notifications.dart';
import '../ui/app_scaffold.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';

/// أدوات الإدارة — المستخدمون (إنشاء/تعديل/قفل/حذف)، مصفوفة الصلاحيات
/// (دور × قسم: بدون/عرض/تحرير)، والإشعارات الشخصية.

const roleLabels = {
  'super_admin': ('المدير العام', 'Super Admin'),
  'admin': ('مدير', 'Admin'),
  'employee': ('موظف', 'Employee'),
  'operations_manager': ('مدير العمليات', 'Operations Manager'),
  'operations_staff': ('عمليات', 'Operations'),
  'moderator': ('مشرف', 'Moderator'),
  'client': ('عميل', 'Client'),
  'workshop_manager': ('مدير الورشة', 'Workshop Manager'),
  'workshop_employee': ('فني ورشة', 'Workshop Employee'),
  'procurement_staff': ('مشتريات الورشة', 'Purchasing'),
  'b2c_manager': ('رئيس B2C', 'B2C Head'),
  'b2c_project_lead': ('مدير مشروع B2C', 'B2C PM'),
  'remote_employee': ('موظف عن بُعد', 'Remote Employee'),
  'remote_manager': ('مدير العمل عن بُعد', 'Remote Manager'),
  'hr_manager': ('مدير الموارد البشرية', 'HR Manager'),
  'hr_specialist': ('أخصائي موارد بشرية', 'HR Specialist'),
  'crm_manager': ('مدير علاقات العملاء', 'CRM Manager'),
  'crm_team_lead': ('قائد فريق CRM', 'CRM Team Lead'),
  'crm_specialist': ('أخصائي CRM', 'CRM Specialist'),
  'crm_agent': ('موظف CRM', 'CRM Agent'),
  'finance_manager': ('مدير مالي', 'Finance Manager'),
  'accountant': ('محاسب', 'Accountant'),
  'sales_manager': ('مدير المبيعات', 'Sales Manager'),
  'sales_rep': ('مندوب مبيعات', 'Sales Rep'),
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
};

String roleLabel(dynamic r) {
  final e = roleLabels[r];
  return e == null ? (r ?? '—').toString() : tr(e.$1, e.$2);
}

String _fold(String s) => s.replaceAll(RegExp('[أإآ]'), 'ا').replaceAll('ى', 'ي').replaceAll('ة', 'ه').toLowerCase();

// ── المستخدمون ──────────────────────────────────────────────────────────────
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

  @override
  void initState() { super.initState(); _load(); }

  Future<void> _load() async {
    try {
      final d = await Api.instance.get('/api/users${_role.isEmpty ? '' : '?role=$_role'}');
      if (!mounted) return;
      setState(() { _rows = List<Map<String, dynamic>>.from(d['users'] ?? []); _loading = false; _error = null; });
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  Future<void> _editSheet(Map<String, dynamic>? u) async {
    final email = TextEditingController(text: (u?['email'] ?? '').toString());
    final password = TextEditingController();
    final firstName = TextEditingController(text: (u?['firstName'] ?? '').toString());
    final lastName = TextEditingController(text: (u?['lastName'] ?? '').toString());
    String role = (u?['role'] ?? 'employee').toString();
    bool active = u?['isActive'] != false;
    await showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (c) => StatefulBuilder(builder: (c, setS) => SafeArea(
        child: Padding(
          padding: EdgeInsets.fromLTRB(16, 16, 16, MediaQuery.of(c).viewInsets.bottom + 16),
          child: SingleChildScrollView(
            child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(u == null ? tr('مستخدم جديد', 'New user') : tr('تعديل المستخدم', 'Edit user'),
                  style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
              const SizedBox(height: 12),
              Row(children: [
                Expanded(child: TextField(controller: firstName, decoration: InputDecoration(labelText: tr('الاسم الأول *', 'First name *')))),
                const SizedBox(width: 10),
                Expanded(child: TextField(controller: lastName, decoration: InputDecoration(labelText: tr('اسم العائلة *', 'Last name *')))),
              ]),
              const SizedBox(height: 10),
              if (u == null) ...[
                TextField(controller: email, keyboardType: TextInputType.emailAddress, decoration: InputDecoration(labelText: tr('البريد *', 'Email *'))),
                const SizedBox(height: 10),
                TextField(controller: password, obscureText: true, decoration: InputDecoration(labelText: tr('كلمة المرور *', 'Password *'))),
                const SizedBox(height: 10),
              ],
              DropdownButtonFormField<String>(
                initialValue: roleLabels.containsKey(role) ? role : null,
                isExpanded: true,
                decoration: InputDecoration(labelText: tr('الدور', 'Role')),
                items: roleLabels.keys.where((r) => r != 'super_admin').map((r) => DropdownMenuItem(value: r, child: Text(roleLabel(r), overflow: TextOverflow.ellipsis))).toList(),
                onChanged: (v) => setS(() => role = v ?? role),
              ),
              if (u != null)
                SwitchListTile(
                  contentPadding: EdgeInsets.zero,
                  title: Text(tr('حساب مُفعّل', 'Account active'), style: const TextStyle(fontSize: 13.5, fontWeight: FontWeight.w700)),
                  value: active,
                  onChanged: (v) => setS(() => active = v),
                ),
              const SizedBox(height: 12),
              SizedBox(
                width: double.infinity,
                child: FilledButton(
                  onPressed: () async {
                    if (firstName.text.trim().isEmpty) return;
                    try {
                      if (u == null) {
                        if (email.text.trim().isEmpty || password.text.isEmpty) return;
                        await Api.instance.post('/api/users', {
                          'email': email.text.trim(), 'password': password.text,
                          'firstName': firstName.text.trim(), 'lastName': lastName.text.trim(),
                          'role': role,
                        });
                      } else {
                        await Api.instance.put('/api/users/${u['_id']}', {
                          'firstName': firstName.text.trim(), 'lastName': lastName.text.trim(),
                          'role': role, 'isActive': active,
                        });
                      }
                      if (c.mounted) Navigator.pop(c);
                      _load();
                    } catch (e) {
                      if (c.mounted) ScaffoldMessenger.of(c).showSnackBar(SnackBar(content: Text(e.toString())));
                    }
                  },
                  child: Text(u == null ? tr('إنشاء', 'Create') : tr('حفظ', 'Save')),
                ),
              ),
            ]),
          ),
        ),
      )),
    );
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

  // إعادة تعيين كلمة المرور (٨ أحرف على الأقل) — POST /users/:id/reset-password.
  Future<void> _resetPassword(Map<String, dynamic> u) async {
    final pass = TextEditingController();
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: Text(tr('كلمة سر جديدة', 'New password')),
        content: TextField(
          controller: pass,
          autofocus: true,
          decoration: InputDecoration(labelText: tr('كلمة السر (٨ أحرف على الأقل)', 'Password (min 8)')),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: Text(tr('إلغاء', 'Cancel'))),
          FilledButton(onPressed: () => Navigator.pop(c, true), child: Text(tr('تعيين', 'Set'))),
        ],
      ),
    );
    if (ok != true) return;
    if (pass.text.trim().length < 8) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(tr('كلمة السر ٨ أحرف على الأقل', 'At least 8 characters'))));
      return;
    }
    try {
      await Api.instance.post('/api/users/${u['_id']}/reset-password', {'newPassword': pass.text.trim()});
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(tr('تم تغيير كلمة السر', 'Password reset'))));
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    }
  }

  // قفل/فك قفل الحساب — POST /users/:id/lock (تبديل).
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
    final filtered = _rows.where((u) {
      if (q.isEmpty) return true;
      return _fold('${u['firstName'] ?? ''} ${u['lastName'] ?? ''} ${u['email'] ?? ''}').contains(q);
    }).toList();

    return AppScaffold(
      title: Text(tr('المستخدمون', 'Users')),
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
                    child: TextField(
                      onChanged: (v) => setState(() => _q = v),
                      decoration: InputDecoration(hintText: tr('ابحث بالاسم أو البريد…', 'Search…'), prefixIcon: const Icon(Icons.search), suffixText: '${filtered.length}'),
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
                          ...roleLabels.keys.map((r) => DropdownMenuItem(value: r, child: Text(roleLabel(r), overflow: TextOverflow.ellipsis))),
                        ],
                        onChanged: (v) { setState(() { _role = v ?? ''; _loading = true; }); _load(); },
                      ),
                    ),
                  ),
                  Expanded(
                    child: RefreshIndicator(
                      onRefresh: _load,
                      child: filtered.isEmpty
                          ? ListView(children: [const SizedBox(height: 80), EmptyState(icon: Icons.group_outlined, title: tr('لا يوجد مستخدمون', 'No users'))])
                          : ListView.separated(
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
                                            const SizedBox(height: 4),
                                            Wrap(spacing: 6, children: [
                                              Chip2(roleLabel(u['role']), T.navy),
                                              if (!active) Chip2(tr('موقوف', 'Inactive'), T.danger),
                                              if (u['isLocked'] == true) Chip2(tr('مقفول', 'Locked'), T.warn),
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

// ── مصفوفة الصلاحيات ────────────────────────────────────────────────────────
class PermissionsScreen extends StatefulWidget {
  const PermissionsScreen({super.key});
  @override
  State<PermissionsScreen> createState() => _PermissionsScreenState();
}

class _PermissionsScreenState extends State<PermissionsScreen> {
  Map<String, dynamic>? _d;
  bool _loading = true;
  String? _error;
  String _role = '';

  @override
  void initState() { super.initState(); _load(); }

  Future<void> _load() async {
    try {
      final d = await Api.instance.get('/api/admin/permissions');
      if (!mounted) return;
      setState(() {
        _d = Map<String, dynamic>.from(d);
        _role = _role.isEmpty ? (List<String>.from(d['roles'] ?? []).firstWhere((r) => r != 'super_admin', orElse: () => '')) : _role;
        _loading = false;
        _error = null;
      });
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  Future<void> _set(String section, String level) async {
    final perms = Map<String, dynamic>.from((_d?['permissions'] as Map?)?[_role] ?? {});
    perms[section] = level;
    setState(() => (_d!['permissions'] as Map)[_role] = perms);
    try {
      await Api.instance.put('/api/admin/permissions/$_role', {'sections': perms});
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
      _load();
    }
  }

  @override
  Widget build(BuildContext context) {
    final sections = List<String>.from(_d?['sections'] ?? []);
    final roles = List<String>.from(_d?['roles'] ?? []).where((r) => r != 'super_admin').toList();
    final perms = Map<String, dynamic>.from((_d?['permissions'] as Map?)?[_role] ?? {});

    return AppScaffold(
      title: Text(tr('الصلاحيات', 'Permissions')),
      body: _loading
          ? ListView(padding: const EdgeInsets.all(14), children: const [Shimmer(height: 48), SizedBox(height: 10), Shimmer(), SizedBox(height: 10), Shimmer()])
          : _error != null
              ? ErrorRetry(message: _error!, onRetry: () { setState(() => _loading = true); _load(); })
              : Column(children: [
                  Padding(
                    padding: const EdgeInsets.fromLTRB(14, 12, 14, 4),
                    child: DropdownButtonFormField<String>(
                      initialValue: roles.contains(_role) ? _role : null,
                      isExpanded: true,
                      decoration: InputDecoration(labelText: tr('الدور', 'Role')),
                      items: roles.map((r) => DropdownMenuItem(value: r, child: Text(roleLabel(r), overflow: TextOverflow.ellipsis))).toList(),
                      onChanged: (v) => setState(() => _role = v ?? _role),
                    ),
                  ),
                  Expanded(
                    child: ListView.separated(
                      padding: const EdgeInsets.all(14),
                      itemCount: sections.length,
                      separatorBuilder: (_, __) => const SizedBox(height: 8),
                      itemBuilder: (c, i) {
                        final s = sections[i];
                        final level = (perms[s] ?? 'none').toString();
                        return AppCard(
                          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                          child: Row(children: [
                            Expanded(child: Text(s, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13))),
                            SegmentedButton<String>(
                              style: const ButtonStyle(visualDensity: VisualDensity.compact),
                              segments: [
                                ButtonSegment(value: 'none', label: Text(tr('بدون', 'None'), style: const TextStyle(fontSize: 10.5))),
                                ButtonSegment(value: 'view', label: Text(tr('عرض', 'View'), style: const TextStyle(fontSize: 10.5))),
                                ButtonSegment(value: 'edit', label: Text(tr('تحرير', 'Edit'), style: const TextStyle(fontSize: 10.5))),
                              ],
                              selected: {['none', 'view', 'edit'].contains(level) ? level : 'none'},
                              onSelectionChanged: (v) => _set(s, v.first),
                            ),
                          ]),
                        );
                      },
                    ),
                  ),
                ]),
    );
  }
}

// ── الإشعارات ───────────────────────────────────────────────────────────────
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
  void initState() { super.initState(); _load(); }

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
      NotificationService.instance.setUnread(_unread); // مزامنة الشارة
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
                        label: Text('${tr('غير المقروءة', 'Unread')} ($_unread)'),
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
