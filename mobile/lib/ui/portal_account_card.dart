import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../services/api.dart';
import '../services/auth.dart';
import '../services/lang.dart';
import 'theme.dart';
import 'widgets.dart';

/// Portal account, twin of PortalAccountCard on the web: a card in each customer or supplier profile that asks the server whether this row has a portal login. It offers creating one (email + password), or shows the account with change password, suspend and delete. Management is limited to ACCOUNT_ADMIN_ROLES on the server.
const _adminRoles = ['super_admin', 'admin', 'it_manager', 'it_specialist'];

class PortalAccountCard extends StatefulWidget {
  final String source; // Register key: 'fleet_customer', 'crm_company', etc.
  final String refId;  // Row id
  final String? name;
  const PortalAccountCard({super.key, required this.source, required this.refId, this.name});

  @override
  State<PortalAccountCard> createState() => _PortalAccountCardState();
}

class _PortalAccountCardState extends State<PortalAccountCard> {
  Map<String, dynamic>? _account;
  String _kind = 'customer';
  bool _loading = true, _busy = false, _openForm = false, _showPw = false;
  final _email = TextEditingController();
  final _pw = TextEditingController();

  @override
  void initState() { super.initState(); _load(); }

  @override
  void dispose() { _email.dispose(); _pw.dispose(); super.dispose(); }

  void _msg(String s) { if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(s))); }

  Future<void> _load() async {
    if (widget.source.isEmpty || widget.refId.isEmpty) { setState(() => _loading = false); return; }
    try {
      final r = await Api.instance.get('/api/partners/account?source=${Uri.encodeComponent(widget.source)}&refId=${Uri.encodeComponent(widget.refId)}');
      _account = r['account'] is Map ? Map<String, dynamic>.from(r['account']) : null;
      _kind = (r['register'] is Map ? r['register']['kind'] : null)?.toString() ?? 'customer';
    } catch (_) { _account = null; }
    if (mounted) setState(() => _loading = false);
  }

  Future<void> _create() async {
    if (_email.text.trim().isEmpty || _pw.text.length < 8) {
      _msg(tr('أدخل بريدًا إلكترونيًا وكلمة مرور لا تقل عن 8 أحرف', 'Enter an email and a password of at least 8 characters'));
      return;
    }
    setState(() => _busy = true);
    try {
      final r = await Api.instance.post('/api/partners/account', {
        'source': widget.source, 'refId': widget.refId, 'email': _email.text.trim(), 'password': _pw.text, 'firstName': widget.name,
      });
      _account = Map<String, dynamic>.from(r['account']);
      _openForm = false; _email.clear(); _pw.clear();
      _msg((r['message'] ?? tr('تم إنشاء حساب الدخول', 'Login created')).toString());
    } catch (e) { _msg(e is ApiException ? e.message : tr('تعذّر إنشاء الحساب', 'Failed to create the login')); }
    if (mounted) setState(() => _busy = false);
  }

  Future<void> _resetPassword() async {
    final ctrl = TextEditingController();
    final pw = await showDialog<String>(context: context, builder: (c) => AlertDialog(
      title: Text(tr('تغيير كلمة المرور', 'Reset password')),
      content: TextField(controller: ctrl, obscureText: true, decoration: InputDecoration(labelText: tr('كلمة المرور الجديدة (8 أحرف على الأقل)', 'New password (min 8 characters)'))),
      actions: [
        TextButton(onPressed: () => Navigator.pop(c), child: Text(tr('إلغاء', 'Cancel'))),
        FilledButton(onPressed: () => Navigator.pop(c, ctrl.text), child: Text(tr('تغيير', 'Reset'))),
      ],
    ));
    if (pw == null || pw.isEmpty) return;
    if (pw.length < 8) { _msg(tr('كلمة المرور 8 أحرف على الأقل', 'Password must be at least 8 characters')); return; }
    setState(() => _busy = true);
    try {
      await Api.instance.patch('/api/partners/account/${_account!['_id']}', {'password': pw});
      _msg(tr('تم تغيير كلمة المرور — تم إنهاء جلساته على كل الأجهزة', 'Password reset — the partner is signed out of every device'));
    } catch (e) { _msg(e is ApiException ? e.message : tr('فشل', 'Failed')); }
    if (mounted) setState(() => _busy = false);
  }

  Future<void> _toggleActive() async {
    setState(() => _busy = true);
    try {
      final r = await Api.instance.patch('/api/partners/account/${_account!['_id']}', {'isActive': _account!['isActive'] != true});
      _account = Map<String, dynamic>.from(r['account']);
      _msg(_account!['isActive'] == true ? tr('تم تفعيل الحساب', 'Account enabled') : tr('تم إيقاف الحساب', 'Account suspended'));
    } catch (e) { _msg(e is ApiException ? e.message : tr('فشل', 'Failed')); }
    if (mounted) setState(() => _busy = false);
  }

  Future<void> _remove() async {
    final ok = await showDialog<bool>(context: context, builder: (c) => AlertDialog(
      title: Text(tr('حذف حساب الدخول؟', 'Delete this login?')),
      content: Text(tr('سجل العميل يبقى كما هو — يُحذف حساب الدخول فقط.', 'The customer record stays — only the login is removed.')),
      actions: [
        TextButton(onPressed: () => Navigator.pop(c, false), child: Text(tr('إلغاء', 'Cancel'))),
        FilledButton(style: FilledButton.styleFrom(backgroundColor: T.danger), onPressed: () => Navigator.pop(c, true), child: Text(tr('حذف', 'Delete'))),
      ],
    ));
    if (ok != true) return;
    setState(() => _busy = true);
    try {
      await Api.instance.delete('/api/partners/account/${_account!['_id']}');
      _account = null;
      _msg(tr('تم حذف الحساب', 'Login deleted'));
    } catch (e) { _msg(e is ApiException ? e.message : tr('فشل', 'Failed')); }
    if (mounted) setState(() => _busy = false);
  }

  @override
  Widget build(BuildContext context) {
    final role = context.watch<AuthProvider>().role;
    final canManage = _adminRoles.contains(role);
    if (_loading) {
      return AppCard(child: Row(children: [
        const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2)),
        const SizedBox(width: 8),
        Text(tr('جارٍ التحقق من حساب البوابة…', 'Checking portal access…'), style: const TextStyle(color: T.inkFaint, fontSize: 13)),
      ]));
    }
    final vendor = _kind == 'vendor';
    final kindLabel = vendor ? tr('المورد', 'supplier') : tr('العميل', 'customer');
    final a = _account;
    return AppCard(
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          const Icon(Icons.key_outlined, color: T.orange, size: 20),
          const SizedBox(width: 8),
          Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(tr('حساب البوابة', 'Portal access'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14)),
            Text(tr('حساب دخول يتيح لهذا $kindLabel متابعة شحناته وبوالصه وفواتيره بنفسه.',
                    'A login lets this $kindLabel see their own shipments, waybills and invoices.'),
                style: const TextStyle(color: T.inkFaint, fontSize: 11.5)),
          ])),
          if (a != null)
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
              decoration: BoxDecoration(color: (a['isActive'] == true ? T.success : T.danger).withValues(alpha: 0.12), borderRadius: BorderRadius.circular(20)),
              child: Text(a['isActive'] == true ? tr('مفعّل', 'Active') : tr('موقوف', 'Suspended'),
                  style: TextStyle(fontSize: 11, color: a['isActive'] == true ? T.success : T.danger, fontWeight: FontWeight.w700)),
            ),
        ]),
        const SizedBox(height: 10),
        if (a != null) ...[
          Row(children: [
            const Icon(Icons.mail_outline, size: 16, color: T.inkFaint),
            const SizedBox(width: 6),
            Expanded(child: SelectableText('${a['email'] ?? ''}', style: const TextStyle(fontWeight: FontWeight.w600))),
          ]),
          const SizedBox(height: 4),
          Text(
            a['lastLogin'] != null
                ? '${tr('آخر دخول', 'Last login')}: ${(DateTime.tryParse('${a['lastLogin']}')?.toLocal().toString() ?? '').split('.').first}'
                : tr('لم يسجّل الدخول بعد', 'Has never signed in yet'),
            style: const TextStyle(color: T.inkFaint, fontSize: 11.5),
          ),
          if (canManage) ...[
            const SizedBox(height: 8),
            Wrap(spacing: 8, runSpacing: 6, children: [
              OutlinedButton.icon(onPressed: _busy ? null : _resetPassword, icon: const Icon(Icons.key_outlined, size: 16), label: Text(tr('تغيير كلمة المرور', 'Reset password'))),
              OutlinedButton.icon(
                onPressed: _busy ? null : _toggleActive,
                icon: Icon(a['isActive'] == true ? Icons.shield_outlined : Icons.verified_user_outlined, size: 16),
                label: Text(a['isActive'] == true ? tr('إيقاف', 'Suspend') : tr('تفعيل', 'Enable')),
              ),
              OutlinedButton.icon(
                style: OutlinedButton.styleFrom(foregroundColor: T.danger),
                onPressed: _busy ? null : _remove, icon: const Icon(Icons.delete_outline, size: 16), label: Text(tr('حذف', 'Delete')),
              ),
            ]),
          ],
        ] else if (canManage) ...[
          if (_openForm) ...[
            TextField(controller: _email, keyboardType: TextInputType.emailAddress, decoration: InputDecoration(labelText: tr('البريد الإلكتروني للدخول', 'Login email'))),
            const SizedBox(height: 8),
            TextField(
              controller: _pw, obscureText: !_showPw,
              decoration: InputDecoration(
                labelText: tr('كلمة المرور (8 أحرف على الأقل)', 'Password (min 8 characters)'),
                suffixIcon: IconButton(onPressed: () => setState(() => _showPw = !_showPw), icon: Icon(_showPw ? Icons.visibility_off : Icons.visibility)),
              ),
            ),
            const SizedBox(height: 8),
            Row(children: [
              FilledButton.icon(
                style: FilledButton.styleFrom(backgroundColor: T.orange),
                onPressed: _busy ? null : _create,
                icon: _busy ? const SizedBox(width: 14, height: 14, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white)) : const Icon(Icons.person_add_alt, size: 16),
                label: Text(tr('إنشاء الحساب', 'Create login')),
              ),
              TextButton(onPressed: () => setState(() => _openForm = false), child: Text(tr('إلغاء', 'Cancel'))),
            ]),
          ] else
            Align(
              alignment: AlignmentDirectional.centerStart,
              child: FilledButton.icon(
                style: FilledButton.styleFrom(backgroundColor: T.orange),
                onPressed: () => setState(() => _openForm = true),
                icon: const Icon(Icons.person_add_alt, size: 16),
                label: Text(tr('إنشاء حساب دخول لهذا $kindLabel', 'Create a login for this $kindLabel')),
              ),
            ),
        ] else
          Text(tr('لا يوجد حساب بوابة بعد. يمكن للمسؤول إنشاؤه.', 'No portal login yet. An administrator can create one.'), style: const TextStyle(color: T.inkFaint, fontSize: 12)),
      ]),
    );
  }
}
