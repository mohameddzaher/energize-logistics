import 'package:flutter/widgets.dart';
import 'api.dart';

/// Session state: who is signed in, their role and section permissions —
/// the same `user` object /api/auth/me returns to the web.
class AuthProvider extends ChangeNotifier with WidgetsBindingObserver {
  Map<String, dynamic>? user;
  bool loading = true;

  String get role => (user?['role'] ?? '') as String;
  String get fullName =>
      '${user?['firstName'] ?? ''} ${user?['lastName'] ?? ''}'.trim();
  Map<String, dynamic> get permissions =>
      (user?['permissions'] as Map<String, dynamic>?) ?? {};

  bool canAccessSection(String section) {
    final a = permissions[section];
    return a == 'view' || a == 'edit';
  }

  /// May create/update/delete in this section. The API draws the same line
  /// (rbac.js: 'view' passes reads only), so a screen that offers a write
  /// action to a view-only user is offering a button that will 403.
  bool canEditSection(String section) => permissions[section] == 'edit';

  /// App start: if a refresh token survives in the keychain, restore the
  /// session silently (loadTokens + /me does the refresh dance if needed).
  Future<void> bootstrap() async {
    WidgetsBinding.instance.addObserver(this);
    await Api.instance.loadTokens();
    if (await Api.instance.hasSession) {
      try {
        final d = await Api.instance.get('/api/auth/me');
        user = d['user'] as Map<String, dynamic>?;
      } catch (_) {
        user = null;
      }
    }
    loading = false;
    notifyListeners();
  }

  // كل ما التطبيق يرجع للواجهة نعيد جلب المستخدم — فأي تغيير في الدور/الصلاحيات
  // (مثلاً ترقية لـ super_admin) يظهر فورًا بلا تسجيل خروج/دخول.
  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) refreshUser();
  }

  Future<void> refreshUser() async {
    if (user == null) return;
    try {
      if (!await Api.instance.hasSession) return;
      final d = await Api.instance.get('/api/auth/me');
      final u = d['user'] as Map<String, dynamic>?;
      if (u != null) { user = u; notifyListeners(); }
    } catch (_) {/* keep current session on transient errors */}
  }

  Future<void> login(String email, String password) async {
    final d = await Api.instance.post('/api/auth/login', {
      'email': email.trim(),
      'password': password,
    });
    final access = d['accessToken'] as String?;
    final refresh = d['refreshToken'] as String?;
    if (access == null || refresh == null) {
      throw ApiException(500, 'استجابة تسجيل دخول غير مكتملة — حدّث تطبيق الخادم');
    }
    await Api.instance.saveTokens(access: access, refresh: refresh);
    user = d['user'] as Map<String, dynamic>?;
    notifyListeners();
  }

  Future<void> logout() async {
    try {
      await Api.instance.post('/api/auth/logout');
    } catch (_) {/* signing out locally regardless */}
    await Api.instance.clearTokens();
    user = null;
    notifyListeners();
  }
}
