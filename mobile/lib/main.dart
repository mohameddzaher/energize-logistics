import 'screens/mediago_ads.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'services/auth.dart';
import 'services/lang.dart';
import 'screens/login.dart';
import 'screens/home.dart';
import 'screens/mediago_complaints.dart';
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
      // Bilingual like the website; switching rebuilds the tree with the correct direction.
      child: ListenableBuilder(
        listenable: Lang.instance..load(),
        builder: (context, _) => MaterialApp(
          // Keyed by language so switching rebuilds the tree immediately with no manual refresh.
          key: ValueKey(Lang.instance.ar),
          title: 'Energize Logistics',
          debugShowCheckedModeBanner: false,
          locale: Locale(Lang.instance.ar ? 'ar' : 'en'),
          builder: (context, child) => Directionality(
            textDirection: Lang.instance.ar ? TextDirection.rtl : TextDirection.ltr,
            // The keyboard closes on every screen by tapping an empty area or dragging the list (otherwise the search field cannot be closed). Buttons keep their taps as they are.
            child: GestureDetector(
              behavior: HitTestBehavior.translucent,
              onTap: () => FocusManager.instance.primaryFocus?.unfocus(),
              child: NotificationListener<ScrollUpdateNotification>(
                onNotification: (n) {
                  if (n.dragDetails != null) FocusManager.instance.primaryFocus?.unfocus();
                  return false;
                },
                child: child!,
              ),
            ),
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
    // Smooth transition between login and the signed-in area.
    return AnimatedSwitcher(
      duration: const Duration(milliseconds: 400),
      // The Media Go account sees a single screen, its home (backend/src/config/scopedRoles).
      child: auth.user == null
          ? const LoginScreen()
          : auth.role == mediagoRole
              ? const MediaGoPartnerHome(key: ValueKey('mediago-home'), complaints: MediaGoComplaintsScreen(partnerHome: true))
              : const HomeScreen(),
    );
  }
}
