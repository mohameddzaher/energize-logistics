import 'package:flutter/foundation.dart';
import 'api.dart';

/// Session state: who is signed in, their role and section permissions —
/// the same `user` object /api/auth/me returns to the web.
class AuthProvider extends ChangeNotifier {
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

  /// App start: if a refresh token survives in the keychain, restore the
  /// session silently (loadTokens + /me does the refresh dance if needed).
  Future<void> bootstrap() async {
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
