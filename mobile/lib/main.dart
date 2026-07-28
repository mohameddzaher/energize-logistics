import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'services/auth.dart';
import 'services/lang.dart';
import 'screens/login.dart';
import 'screens/home.dart';
import 'ui/theme.dart';

void main() {
  runApp(const EnergizeApp());
}

class EnergizeApp extends StatelessWidget {
  const EnergizeApp({super.key});

  @override
  Widget build(BuildContext context) {
    return ChangeNotifierProvider(
      create: (_) => AuthProvider()..bootstrap(),
      // اللغة ثنائية زي الموقع — التبديل يعيد بناء الشجرة بالاتجاه الصحيح.
      child: ListenableBuilder(
        listenable: Lang.instance..load(),
        builder: (context, _) => MaterialApp(
          // مفتاح باللغة: التبديل يعيد بناء الشجرة فورًا — دون أي تحديث يدوي.
          key: ValueKey(Lang.instance.ar),
          title: 'Energize Logistics',
          debugShowCheckedModeBanner: false,
          locale: Locale(Lang.instance.ar ? 'ar' : 'en'),
          builder: (context, child) => Directionality(
            textDirection: Lang.instance.ar ? TextDirection.rtl : TextDirection.ltr,
            child: child!,
          ),
          theme: T.theme(),
          home: const _Gate(),
        ),
      ),
    );
  }
}

class _Gate extends StatelessWidget {
  const _Gate();

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    if (auth.loading) {
      return Scaffold(
        body: Container(
          decoration: const BoxDecoration(gradient: T.navyGradient),
          child: Center(child: Image.asset('assets/logo_white.png', height: 44)),
        ),
      );
    }
    // انتقال ناعم بين الدخول والداخل.
    return AnimatedSwitcher(
      duration: const Duration(milliseconds: 400),
      child: auth.user == null ? const LoginScreen() : const HomeScreen(),
    );
  }
}
