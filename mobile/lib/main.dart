import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'config.dart';
import 'services/auth.dart';
import 'screens/login.dart';
import 'screens/home.dart';

void main() {
  runApp(const EnergizeApp());
}

class EnergizeApp extends StatelessWidget {
  const EnergizeApp({super.key});

  @override
  Widget build(BuildContext context) {
    return ChangeNotifierProvider(
      create: (_) => AuthProvider()..bootstrap(),
      child: MaterialApp(
        title: 'Energize Logistics',
        debugShowCheckedModeBanner: false,
        // التطبيق عربي أولًا — كل الشاشات RTL.
        locale: const Locale('ar'),
        builder: (context, child) =>
            Directionality(textDirection: TextDirection.rtl, child: child!),
        theme: ThemeData(
          useMaterial3: true,
          colorScheme: ColorScheme.fromSeed(
            seedColor: const Color(AppConfig.navy),
            primary: const Color(AppConfig.navy),
            secondary: const Color(AppConfig.orange),
          ),
          scaffoldBackgroundColor: const Color(0xFFF5F6F8),
          appBarTheme: const AppBarTheme(
            backgroundColor: Color(AppConfig.navy),
            foregroundColor: Colors.white,
            centerTitle: true,
          ),
          filledButtonTheme: FilledButtonThemeData(
            style: FilledButton.styleFrom(
              backgroundColor: const Color(AppConfig.navy),
              minimumSize: const Size.fromHeight(48),
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
            ),
          ),
          inputDecorationTheme: InputDecorationTheme(
            filled: true,
            fillColor: Colors.white,
            border: OutlineInputBorder(
              borderRadius: BorderRadius.circular(12),
              borderSide: const BorderSide(color: Color(0xFFE2E8F0)),
            ),
            enabledBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(12),
              borderSide: const BorderSide(color: Color(0xFFE2E8F0)),
            ),
          ),
        ),
        home: const _Gate(),
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
      return const Scaffold(body: Center(child: CircularProgressIndicator()));
    }
    return auth.user == null ? const LoginScreen() : const HomeScreen();
  }
}
