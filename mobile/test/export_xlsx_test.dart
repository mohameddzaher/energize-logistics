import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:energize_mobile/ui/export_sheet.dart';

void main() {
  test('buildXlsx writes a readable workbook', () {
    final bytes = buildXlsx([
      ('السائقون', [
        ['الاسم', 'المبلغ', 'مدفوع'],
        ['علي <&> "x"', 250.5, true],
        ['Ahmed', 1000, null],
      ]),
      ('Second/Sheet', [
        ['a'],
        ['b'],
      ]),
    ], rtl: true);
    final out = Platform.environment['OUT'];
    if (out != null) File(out).writeAsBytesSync(bytes); // للفحص بقارئٍ خارجيّ
    expect(String.fromCharCodes(bytes.take(2)), 'PK'); // zip
    expect(bytes.length, greaterThan(200));
  });
}
