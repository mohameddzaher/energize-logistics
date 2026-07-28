import 'package:flutter_test/flutter_test.dart';
import 'package:energize_mobile/main.dart';

void main() {
  testWidgets('app boots', (WidgetTester tester) async {
    await tester.pumpWidget(const EnergizeApp());
    expect(find.byType(EnergizeApp), findsOneWidget);
  });
}
