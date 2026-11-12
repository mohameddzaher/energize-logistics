import 'dart:convert';
import 'dart:typed_data';
import 'package:http/http.dart' as http;
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import '../config.dart';

/// Mirror of the web's lib/api.ts: every request carries the Bearer access
/// token; a 401 triggers ONE silent refresh (the refresh token from secure
/// storage) and a retry. Throws [ApiException] with the server's Arabic
/// message so screens can show it as-is.
class ApiException implements Exception {
  final int status;
  final String message;
  /// What goes beyond the message stays with it.
  /// Some responses are a message with a decision attached: a 409 from load creation carries the missed maintenance and the pending order number, and a panel is built from it, not an error line. The body used to be discarded, so only the message was read and the rest lost, as on web (err.data).
  final Map<String, dynamic> data;
  ApiException(this.status, this.message, [this.data = const {}]);
  @override
  String toString() => message;
}

class Api {
  Api._();
  static final Api instance = Api._();

  static const _storage = FlutterSecureStorage();
  String? _accessToken;

  Future<void> saveTokens({required String access, required String refresh}) async {
    _accessToken = access;
    await _storage.write(key: 'accessToken', value: access);
    await _storage.write(key: 'refreshToken', value: refresh);
  }

  Future<void> loadTokens() async {
    _accessToken = await _storage.read(key: 'accessToken');
  }

  Future<bool> get hasSession async =>
      (await _storage.read(key: 'refreshToken')) != null;

  Future<void> clearTokens() async {
    _accessToken = null;
    await _storage.deleteAll();
  }

  String? get accessToken => _accessToken;

  Map<String, String> _headers() => {
        'Content-Type': 'application/json',
        if (_accessToken != null) 'Authorization': 'Bearer $_accessToken',
      };

  Future<bool> _refresh() async {
    final refresh = await _storage.read(key: 'refreshToken');
    if (refresh == null) return false;
    try {
      final res = await http.post(
        Uri.parse('${AppConfig.apiBase}/api/auth/refresh'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({'refreshToken': refresh}),
      ).timeout(const Duration(seconds: 25));
      if (res.statusCode != 200) return false;
      final body = jsonDecode(res.body) as Map<String, dynamic>;
      final token = body['accessToken'] as String?;
      if (token == null) return false;
      _accessToken = token;
      await _storage.write(key: 'accessToken', value: token);
      // The renewed token is saved, otherwise the user is forced out every half month.
      // The server renews the refresh token once it passes half its life and sends the replacement here. The replacement used to be ignored, so the phone stayed on the old token until it was deleted after the grace period, and the first refresh after that failed, asking the user for the password again for no reason they understand.
      final newRefresh = body['refreshToken'] as String?;
      if (newRefresh != null && newRefresh.isNotEmpty) {
        await _storage.write(key: 'refreshToken', value: newRefresh);
      }
      return true;
    } catch (_) {
      return false;
    }
  }

  // Per-request timeout: on a slow or intermittent mobile network a request without one hangs forever and the screen keeps spinning. With a timeout it becomes an error shown with a retry button.
  static const _timeout = Duration(seconds: 25);

  Future<dynamic> _request(String method, String path, {Object? body, bool retried = false, Duration? timeout}) async {
    final limit = timeout ?? _timeout;
    final uri = Uri.parse('${AppConfig.apiBase}$path');
    late http.Response res;
    final encoded = body == null ? null : jsonEncode(body);
    try {
      switch (method) {
        case 'GET':
          res = await http.get(uri, headers: _headers()).timeout(limit);
        case 'POST':
          res = await http.post(uri, headers: _headers(), body: encoded).timeout(limit);
        case 'PATCH':
          res = await http.patch(uri, headers: _headers(), body: encoded).timeout(limit);
        case 'PUT':
          res = await http.put(uri, headers: _headers(), body: encoded).timeout(limit);
        case 'DELETE':
          res = await http.delete(uri, headers: _headers()).timeout(limit);
      }
    } on Exception {
      // Disconnect, timeout or network failure: a clear Arabic message instead of a hanging screen.
      throw ApiException(0, 'تعذّر الاتصال بالخادم — تأكد من الإنترنت وأعد المحاولة');
    }

    if (res.statusCode == 401 && !retried && !path.startsWith('/api/auth/')) {
      if (await _refresh()) {
        return _request(method, path, body: body, retried: true, timeout: timeout);
      }
      throw ApiException(401, 'انتهت الجلسة — سجّل الدخول من جديد');
    }

    final decoded = res.body.isEmpty ? {} : jsonDecode(utf8.decode(res.bodyBytes));
    if (res.statusCode >= 200 && res.statusCode < 300) return decoded;
    final msg = (decoded is Map && decoded['message'] != null)
        ? decoded['message'].toString()
        : 'تعذر تنفيذ الطلب (${res.statusCode})';
    throw ApiException(res.statusCode, msg, decoded is Map ? Map<String, dynamic>.from(decoded) : const {});
  }

  // Authenticated download of a binary file (e.g. the waybill PDF); returns the bytes as they are.
  Future<Uint8List> getBytes(String path, {bool retried = false}) async {
    final uri = Uri.parse('${AppConfig.apiBase}$path');
    late http.Response res;
    try {
      res = await http.get(uri, headers: _headers()).timeout(const Duration(seconds: 40));
    } on Exception {
      throw ApiException(0, 'تعذّر تحميل الملف — تأكد من الإنترنت وأعد المحاولة');
    }
    if (res.statusCode == 401 && !retried) {
      if (await _refresh()) return getBytes(path, retried: true);
      throw ApiException(401, 'انتهت الجلسة — سجّل الدخول من جديد');
    }
    if (res.statusCode >= 200 && res.statusCode < 300) return res.bodyBytes;
    throw ApiException(res.statusCode, 'تعذّر تحميل الملف (${res.statusCode})');
  }

  /// A file plus the name the server gave it (X-File-Name header), for downloads named by the server.
  Future<(Uint8List, String)> getBytesNamed(String path, {bool retried = false}) async {
    final uri = Uri.parse('${AppConfig.apiBase}$path');
    late http.Response res;
    try {
      res = await http.get(uri, headers: _headers()).timeout(const Duration(seconds: 40));
    } on Exception {
      throw ApiException(0, 'تعذّر تحميل الملف — تأكد من الإنترنت وأعد المحاولة');
    }
    if (res.statusCode == 401 && !retried) {
      if (await _refresh()) return getBytesNamed(path, retried: true);
      throw ApiException(401, 'انتهت الجلسة — سجّل الدخول من جديد');
    }
    if (res.statusCode >= 200 && res.statusCode < 300) {
      var name = '';
      try { name = Uri.decodeComponent(res.headers['x-file-name'] ?? ''); } catch (_) {}
      return (res.bodyBytes, name);
    }
    throw ApiException(res.statusCode, 'تعذّر تحميل الملف (${res.statusCode})');
  }

  /// Sends a request that returns a binary file: waybills of several shipments in one file.
  /// The timeout is wider than for ordinary calls: each waybill is a render in a headless browser on the server, so sixty waybills take about forty seconds.
  Future<Uint8List> postBytes(String path, Object body, {bool retried = false}) async {
    final uri = Uri.parse('${AppConfig.apiBase}$path');
    late http.Response res;
    try {
      res = await http
          .post(uri, headers: _headers(), body: jsonEncode(body))
          .timeout(const Duration(seconds: 150));
    } on Exception {
      throw ApiException(0, 'تعذّر تحميل الملف — تأكد من الإنترنت وأعد المحاولة');
    }
    if (res.statusCode == 401 && !retried) {
      if (await _refresh()) return postBytes(path, body, retried: true);
      throw ApiException(401, 'انتهت الجلسة — سجّل الدخول من جديد');
    }
    if (res.statusCode >= 200 && res.statusCode < 300) return res.bodyBytes;
    // The error comes back as JSON, not PDF; its message is read as in ordinary calls.
    String msg = 'تعذّر تحميل الملف (${res.statusCode})';
    try {
      final d = jsonDecode(utf8.decode(res.bodyBytes));
      if (d is Map && d['message'] != null) msg = d['message'].toString();
    } catch (_) { /* Not JSON */ }
    throw ApiException(res.statusCode, msg);
  }

  Future<dynamic> get(String path) => _request('GET', path);
  Future<dynamic> post(String path, [Object? body]) => _request('POST', path, body: body);
  /// Sends large attachments (images and base64 clips): tens of megabytes on a phone network cannot upload in 25 seconds, so the timeout is two and a half minutes.
  Future<dynamic> postLong(String path, [Object? body]) =>
      _request('POST', path, body: body, timeout: const Duration(seconds: 150));
  Future<dynamic> patch(String path, [Object? body]) => _request('PATCH', path, body: body);
  Future<dynamic> put(String path, [Object? body]) => _request('PUT', path, body: body);
  Future<dynamic> delete(String path) => _request('DELETE', path);
}
