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

  Future<void> load() async {
    ar = (await _storage.read(key: 'lang')) != 'en';
    notifyListeners();
  }

  Future<void> toggle() async {
    ar = !ar;
    notifyListeners();
    await _storage.write(key: 'lang', value: ar ? 'ar' : 'en');
  }
}

String tr(String arText, String enText) => Lang.instance.ar ? arText : enText;
