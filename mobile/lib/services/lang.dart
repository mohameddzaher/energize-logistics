import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Bilingual support, mirroring the web's AR/EN toggle. `tr(ar, en)` is used
/// across every screen; toggling notifies the root MaterialApp which rebuilds
/// the whole tree in the other language + direction.
class Lang extends ChangeNotifier {
  Lang._();
  static final Lang instance = Lang._();
  static const _storage = FlutterSecureStorage();

  bool ar = true;
  // Customer/supplier accounts keep their own language (English by default),
  // separate from a staff member's choice on the same device.
  bool _partner = false;
  String get _key => _partner ? 'lang_partner' : 'lang';

  Future<void> load() async {
    ar = (await _storage.read(key: 'lang')) != 'en';
    notifyListeners();
  }

  /// Switch to the language saved for this kind of account.
  Future<void> useAccount(String role) async {
    final partner = role == 'client';
    if (partner == _partner && !partner) return;
    _partner = partner;
    final v = await _storage.read(key: _key);
    ar = partner ? v == 'ar' : v != 'en';
    notifyListeners();
  }

  Future<void> toggle() async {
    ar = !ar;
    notifyListeners();
    await _storage.write(key: _key, value: ar ? 'ar' : 'en');
  }
}

String tr(String arText, String enText) => Lang.instance.ar ? arText : enText;
