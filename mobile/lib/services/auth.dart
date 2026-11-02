import 'package:flutter/widgets.dart';
import 'api.dart';
import 'lang.dart';
import 'live.dart';

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

  /// Page-level gate under the section: the section says what is allowed, the page says where. Keyed by the web route, set once from one screen and applied to both clients. A missing key is allowed: the server sends the full map, so absence means an app older than the page, and hiding a screen over a version mismatch would be a silent fault.
  Map<String, dynamic> get pageAccess =>
      (user?['pageAccess'] as Map<String, dynamic>?) ?? const {};

  bool canAccessPage(String? path) {
    if (path == null || path.isEmpty) return true;
    return pageAccess[path] != false;
  }

  /// An explicit page grant wins over the role list. Sections not managed by the matrix are guarded by hand-written role lines that do not know screen-made user types. The web follows the same rule.
  List<String> get pagesGranted =>
      ((user?['pagesGranted'] as List?) ?? const []).map((e) => e.toString()).toList();

  /// Display preferences saved on the account (`uiPrefs`); the dot in the key is written as a colon.
  String pref(String key) => '${(user?['uiPrefs'] as Map?)?[key.replaceAll('.', ':')] ?? ''}';

  /// Updates the in-memory copy after PATCH /api/auth/me/prefs so the screen does not revert.
  void setPref(String key, String value) {
    final u = user;
    if (u == null) return;
    final prefs = Map<String, dynamic>.from((u['uiPrefs'] as Map?) ?? const {});
    final k = key.replaceAll('.', ':');
    if (value.isEmpty) { prefs.remove(k); } else { prefs[k] = value; }
    u['uiPrefs'] = prefs;
    notifyListeners();
  }

  bool isPageGranted(String? path) =>
      path != null && path.isNotEmpty && pagesGranted.contains(path);

  /// App start: if a refresh token survives in the keychain, restore the
  /// session silently (loadTokens + /me does the refresh dance if needed).
  Future<void> bootstrap() async {
    WidgetsBinding.instance.addObserver(this);
    // Permission changes arrive immediately: the web re-reads the user on save, so the app listens to the same event instead of waiting for a restart.
    Live.instance.on('permissions:updated', _onPermissionsChanged);
    Live.instance.on('permissions:roles', _onPermissionsChanged);
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
    if (user != null) await Lang.instance.useAccount(role);
    notifyListeners();
  }

  // Re-fetch the user whenever the app returns to the foreground so role or permission changes (e.g. promotion to super_admin) show without logging in again.
  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) refreshUser();
  }

  void _onPermissionsChanged() => refreshUser();

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
    await Lang.instance.useAccount(role);
    notifyListeners();
  }

  Future<void> logout() async {
    try {
      await Api.instance.post('/api/auth/logout');
    } catch (_) {/* signing out locally regardless */}
    await Api.instance.clearTokens();
    user = null;
    await Lang.instance.useAccount('');
    notifyListeners();
  }
}
