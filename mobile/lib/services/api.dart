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
  ApiException(this.status, this.message);
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
      // ── التوكن المجدَّد يُحفَظ، وإلا خرج المستخدم قسرًا كل نصف شهر ───────────
      // الخادم يجدّد توكن التجديد حين يتجاوز نصف عمره ويرسل البديل هنا. كان
      // البديل يُهمَل، فيبقى الهاتف على التوكن القديم حتى يُحذَف بعد مهلة
      // السماح — ثم يفشل أوّل تجديدٍ بعده فيُطلَب من المستخدم كلمة سرّه من
      // جديد بلا سبب يفهمه. هذا بالضبط ما كان يبدو «الجلسة بايظة، اعمل دخول
      // وخروج».
      final newRefresh = body['refreshToken'] as String?;
      if (newRefresh != null && newRefresh.isNotEmpty) {
        await _storage.write(key: 'refreshToken', value: newRefresh);
      }
      return true;
    } catch (_) {
      return false;
    }
  }

  // مهلة زمنية لكل طلب — على شبكة موبايل بطيئة أو متقطعة، طلب بلا مهلة يعلّق
  // للأبد فتفضل الشاشة «بتلف». مع المهلة يتحوّل لخطأ يظهر مع زر إعادة المحاولة.
  static const _timeout = Duration(seconds: 25);

  Future<dynamic> _request(String method, String path, {Object? body, bool retried = false}) async {
    final uri = Uri.parse('${AppConfig.apiBase}$path');
    late http.Response res;
    final encoded = body == null ? null : jsonEncode(body);
    try {
      switch (method) {
        case 'GET':
          res = await http.get(uri, headers: _headers()).timeout(_timeout);
        case 'POST':
          res = await http.post(uri, headers: _headers(), body: encoded).timeout(_timeout);
        case 'PATCH':
          res = await http.patch(uri, headers: _headers(), body: encoded).timeout(_timeout);
        case 'PUT':
          res = await http.put(uri, headers: _headers(), body: encoded).timeout(_timeout);
        case 'DELETE':
          res = await http.delete(uri, headers: _headers()).timeout(_timeout);
      }
    } on Exception {
      // انقطاع/مهلة/فشل شبكة — رسالة عربية واضحة بدل تعليق الشاشة.
      throw ApiException(0, 'تعذّر الاتصال بالخادم — تأكد من الإنترنت وأعد المحاولة');
    }

    if (res.statusCode == 401 && !retried && !path.startsWith('/api/auth/')) {
      if (await _refresh()) {
        return _request(method, path, body: body, retried: true);
      }
      throw ApiException(401, 'انتهت الجلسة — سجّل الدخول من جديد');
    }

    final decoded = res.body.isEmpty ? {} : jsonDecode(utf8.decode(res.bodyBytes));
    if (res.statusCode >= 200 && res.statusCode < 300) return decoded;
    final msg = (decoded is Map && decoded['message'] != null)
        ? decoded['message'].toString()
        : 'تعذر تنفيذ الطلب (${res.statusCode})';
    throw ApiException(res.statusCode, msg);
  }

  // تحميل ملف ثنائي (PDF البوليصة مثلًا) بالمصادقة — يرجّع البايتات كما هي.
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

  Future<dynamic> get(String path) => _request('GET', path);
  Future<dynamic> post(String path, [Object? body]) => _request('POST', path, body: body);
  Future<dynamic> patch(String path, [Object? body]) => _request('PATCH', path, body: body);
  Future<dynamic> put(String path, [Object? body]) => _request('PUT', path, body: body);
  Future<dynamic> delete(String path) => _request('DELETE', path);
}
