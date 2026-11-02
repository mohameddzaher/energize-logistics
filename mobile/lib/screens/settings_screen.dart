import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../services/api.dart';
import '../services/auth.dart';
import '../services/lang.dart';
import '../ui/app_scaffold.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';
import 'signatures.dart';

/// Settings: change password, switch language and sign out.
class SettingsScreen extends StatelessWidget {
  const SettingsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    return AppScaffold(
      title: Text(tr('الإعدادات', 'Settings')),
      body: ListView(padding: const EdgeInsets.all(14), children: [
        FadeSlideIn(
          child: AppCard(
            child: Row(children: [
              CircleAvatar(radius: 22, backgroundColor: T.navy.withValues(alpha: 0.1),
                  child: Text(auth.fullName.isNotEmpty ? auth.fullName.characters.first : '؟', style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 18, color: T.navy))),
              const SizedBox(width: 12),
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text(auth.fullName, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
                  Text((auth.user?['email'] ?? '').toString(), style: const TextStyle(fontSize: 12, color: T.inkSoft)),
                ]),
              ),
            ]),
          ),
        ),
        const SizedBox(height: 14),
        _tile(context, Icons.person_outline, tr('تعديل الاسم والبريد', 'Edit name & email'), () => _editProfile(context, auth)),
        _tile(context, Icons.draw_outlined, tr('توقيعاتي', 'My signatures'), () => Navigator.push(context, MaterialPageRoute(builder: (_) => const SignaturesScreen()))),
        _tile(context, Icons.lock_outline, tr('تغيير كلمة المرور', 'Change password'), () => _changePassword(context)),
        _tile(context, Icons.translate, tr('اللغة', 'Language'), () => Lang.instance.toggle(), trailing: Text(tr('العربية', 'English'), style: const TextStyle(fontWeight: FontWeight.w700, color: T.navy))),
        // System admin only, as on the web: recompute risk scores + system info
        if (const ['super_admin', 'admin', 'it_manager', 'it_specialist'].contains(auth.role)) ...[
          _tile(context, Icons.shield_outlined, tr('إعادة حساب المخاطر', 'Recalculate risk scores'), () => _recalcRisk(context)),
          AppCard(child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Text(tr('معلومات النظام', 'System information'), style: const TextStyle(fontWeight: FontWeight.w800)),
            const SizedBox(height: 6),
            _info(tr('النظام', 'System'), 'Energize Logistics — Enterprise Management System'),
            _info(tr('الإصدار', 'Version'), '1.0.0'),
            _info(tr('نطاق درجة المخاطر', 'Risk Score Range'), tr('0-100 (منخفض: 0-30، متوسط: 31-60، مرتفع: 61-100)', '0-100 (Low: 0-30, Medium: 31-60, High: 61-100)')),
          ])),
          const SizedBox(height: 8),
        ],
        _tile(context, Icons.logout_rounded, tr('تسجيل الخروج', 'Sign out'), () async {
          final ok = await showDialog<bool>(
            context: context,
            builder: (c) => AlertDialog(
              title: Text(tr('تسجيل الخروج', 'Sign out')),
              content: Text(tr('هل تريد تسجيل الخروج؟', 'Sign out of the app?')),
              actions: [
                TextButton(onPressed: () => Navigator.pop(c, false), child: Text(tr('إلغاء', 'Cancel'))),
                FilledButton(style: FilledButton.styleFrom(backgroundColor: T.danger), onPressed: () => Navigator.pop(c, true), child: Text(tr('خروج', 'Sign out'))),
              ],
            ),
          );
          if (ok == true && context.mounted) await context.read<AuthProvider>().logout();
        }, danger: true),
      ]),
    );
  }

  Widget _info(String k, String v) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 4),
        child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Expanded(child: Text(k, style: const TextStyle(color: T.inkSoft, fontSize: 12.5))),
          Expanded(flex: 2, child: Text(v, style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600))),
        ]),
      );

  /// Runs a full recalculation of risk scores for all customers: POST /api/analytics/risk/recalculate.
  Future<void> _recalcRisk(BuildContext context) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: Text(tr('إعادة حساب المخاطر', 'Recalculate risk scores')),
        content: Text(tr('تشغيل إعادة حساب شاملة لدرجات المخاطر لجميع العملاء.', 'Manually trigger a full risk score recalculation for all customers.')),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: Text(tr('إلغاء', 'Cancel'))),
          FilledButton(style: FilledButton.styleFrom(backgroundColor: T.orange), onPressed: () => Navigator.pop(c, true), child: Text(tr('إعادة الحساب', 'Recalculate'))),
        ],
      ),
    );
    if (ok != true || !context.mounted) return;
    final messenger = ScaffoldMessenger.of(context);
    messenger.showSnackBar(SnackBar(content: Text(tr('جارٍ إعادة الحساب…', 'Recalculating…'))));
    try {
      final d = await Api.instance.post('/api/analytics/risk/recalculate');
      final n = (d is Map && d['results'] is List) ? (d['results'] as List).length : 0;
      messenger.showSnackBar(SnackBar(content: Text(tr('تمت إعادة احتساب درجات المخاطر لعدد $n عميل.', 'Risk scores recalculated for $n customers.'))));
    } catch (e) {
      messenger.showSnackBar(SnackBar(content: Text('${tr('خطأ: ', 'Error: ')}${e is ApiException ? e.message : e}')));
    }
  }

  Widget _tile(BuildContext context, IconData icon, String label, VoidCallback onTap, {Widget? trailing, bool danger = false}) => Padding(
        padding: const EdgeInsets.only(bottom: 8),
        child: Pressable(
          onTap: onTap,
          child: AppCard(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 13),
            child: Row(children: [
              Icon(icon, size: 21, color: danger ? T.danger : T.navy),
              const SizedBox(width: 12),
              Expanded(child: Text(label, style: TextStyle(fontWeight: FontWeight.w700, fontSize: 14.5, color: danger ? T.danger : T.ink))),
              trailing ?? Icon(Lang.instance.ar ? Icons.chevron_left : Icons.chevron_right, color: T.inkFaint),
            ]),
          ),
        ),
      );

  // Edit the account's name and real email (PATCH /api/auth/me); updates immediately.
  void _editProfile(BuildContext context, AuthProvider auth) {
    final firstName = TextEditingController(text: (auth.user?['firstName'] ?? '').toString());
    final lastName = TextEditingController(text: (auth.user?['lastName'] ?? '').toString());
    final email = TextEditingController(text: (auth.user?['email'] ?? '').toString());
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (c) => SafeArea(
        child: Padding(
          padding: EdgeInsets.fromLTRB(16, 16, 16, MediaQuery.of(c).viewInsets.bottom + 16),
          child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(tr('تعديل بيانات الحساب', 'Edit account'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
            const SizedBox(height: 12),
            Row(children: [
              Expanded(child: TextField(controller: firstName, decoration: InputDecoration(labelText: tr('الاسم الأول', 'First name')))),
              const SizedBox(width: 10),
              Expanded(child: TextField(controller: lastName, decoration: InputDecoration(labelText: tr('الاسم الأخير', 'Last name')))),
            ]),
            const SizedBox(height: 10),
            TextField(controller: email, keyboardType: TextInputType.emailAddress, textDirection: TextDirection.ltr,
                autocorrect: false, enableSuggestions: false, textCapitalization: TextCapitalization.none,
                decoration: InputDecoration(labelText: tr('البريد الإلكتروني', 'Email'))),
            const SizedBox(height: 14),
            SizedBox(
              width: double.infinity,
              child: FilledButton(
                onPressed: () async {
                  try {
                    await Api.instance.patch('/api/auth/me', {
                      'firstName': firstName.text.trim(),
                      'lastName': lastName.text.trim(),
                      'email': email.text.trim(),
                    });
                    await auth.refreshUser();
                    if (c.mounted) Navigator.pop(c);
                    if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(tr('تم حفظ البيانات ✔', 'Saved ✔'))));
                  } catch (e) {
                    if (c.mounted) ScaffoldMessenger.of(c).showSnackBar(SnackBar(content: Text(e.toString())));
                  }
                },
                child: Text(tr('حفظ', 'Save')),
              ),
            ),
          ]),
        ),
      ),
    );
  }

  void _changePassword(BuildContext context) {
    final current = TextEditingController();
    final next = TextEditingController();
    final confirm = TextEditingController();
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (c) => SafeArea(
        child: Padding(
          padding: EdgeInsets.fromLTRB(16, 16, 16, MediaQuery.of(c).viewInsets.bottom + 16),
          child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(tr('تغيير كلمة المرور', 'Change password'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
            const SizedBox(height: 12),
            TextField(controller: current, obscureText: true, decoration: InputDecoration(labelText: tr('كلمة المرور الحالية *', 'Current password *'))),
            const SizedBox(height: 10),
            TextField(controller: next, obscureText: true, decoration: InputDecoration(labelText: tr('كلمة المرور الجديدة * (8 أحرف على الأقل)', 'New password * (min 8)'))),
            const SizedBox(height: 10),
            TextField(controller: confirm, obscureText: true, decoration: InputDecoration(labelText: tr('تأكيد كلمة المرور *', 'Confirm password *'))),
            const SizedBox(height: 14),
            SizedBox(
              width: double.infinity,
              child: FilledButton(
                onPressed: () async {
                  // Must match the server's minimum (8) — see routes/auth.js.
                  if (next.text.length < 8) {
                    ScaffoldMessenger.of(c).showSnackBar(SnackBar(
                      content: Text(tr('كلمة المرور 8 أحرف على الأقل', 'Password must be at least 8 characters'))));
                    return;
                  }
                  if (next.text != confirm.text) {
                    ScaffoldMessenger.of(c).showSnackBar(SnackBar(content: Text(tr('كلمتا المرور غير متطابقتين', 'Passwords do not match'))));
                    return;
                  }
                  try {
                    await Api.instance.post('/api/auth/change-password', {'currentPassword': current.text, 'newPassword': next.text});
                    if (c.mounted) Navigator.pop(c);
                    if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(tr('تم تغيير كلمة المرور ✔', 'Password changed ✔'))));
                  } catch (e) {
                    if (c.mounted) ScaffoldMessenger.of(c).showSnackBar(SnackBar(content: Text(e.toString())));
                  }
                },
                child: Text(tr('تغيير', 'Change')),
              ),
            ),
          ]),
        ),
      ),
    );
  }
}
