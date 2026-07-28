import 'dart:convert';
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
      );
      if (res.statusCode != 200) return false;
      final body = jsonDecode(res.body) as Map<String, dynamic>;
      final token = body['accessToken'] as String?;
      if (token == null) return false;
      _accessToken = token;
      await _storage.write(key: 'accessToken', value: token);
      return true;
    } catch (_) {
      return false;
    }
  }

  Future<dynamic> _request(String method, String path, {Object? body, bool retried = false}) async {
    final uri = Uri.parse('${AppConfig.apiBase}$path');
    late http.Response res;
    final encoded = body == null ? null : jsonEncode(body);
    switch (method) {
      case 'GET':
        res = await http.get(uri, headers: _headers());
      case 'POST':
        res = await http.post(uri, headers: _headers(), body: encoded);
      case 'PATCH':
        res = await http.patch(uri, headers: _headers(), body: encoded);
      case 'PUT':
        res = await http.put(uri, headers: _headers(), body: encoded);
      case 'DELETE':
        res = await http.delete(uri, headers: _headers());
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

  Future<dynamic> get(String path) => _request('GET', path);
  Future<dynamic> post(String path, [Object? body]) => _request('POST', path, body: body);
  Future<dynamic> patch(String path, [Object? body]) => _request('PATCH', path, body: body);
  Future<dynamic> put(String path, [Object? body]) => _request('PUT', path, body: body);
  Future<dynamic> delete(String path) => _request('DELETE', path);
}
