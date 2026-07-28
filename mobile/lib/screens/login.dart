import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../services/auth.dart';
import '../services/lang.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';

/// Premium sign-in: animated navy gradient with floating glow orbs, the
/// company logo, a glassy card that staggers in, and a button that morphs
/// into its loading state.
class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});
  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> with SingleTickerProviderStateMixin {
  final _email = TextEditingController();
  final _password = TextEditingController();
  bool _busy = false;
  bool _obscure = true;
  String? _error;
  late final AnimationController _bg =
      AnimationController(vsync: this, duration: const Duration(seconds: 14))..repeat(reverse: true);

  @override
  void dispose() { _bg.dispose(); super.dispose(); }

  Future<void> _submit() async {
    if (_email.text.trim().isEmpty || _password.text.isEmpty || _busy) return;
    FocusScope.of(context).unfocus();
    setState(() { _busy = true; _error = null; });
    try {
      await context.read<AuthProvider>().login(_email.text, _password.text);
    } catch (e) {
      setState(() => _error = e.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Stack(
        children: [
          // الخلفية المتنفسة: تدرج كحلي + هالات ضوء تتحرك ببطء.
          Container(decoration: const BoxDecoration(gradient: T.navyGradient)),
          AnimatedBuilder(
            animation: _bg,
            builder: (context, _) {
              final t = _bg.value;
              return Stack(children: [
                Positioned(
                  top: -80 + 40 * t, right: -60 - 20 * t,
                  child: _orb(240, T.orange.withValues(alpha: 0.22)),
                ),
                Positioned(
                  bottom: 60 - 50 * t, left: -90 + 30 * t,
                  child: _orb(280, const Color(0xFF3B82F6).withValues(alpha: 0.18)),
                ),
                Positioned(
                  top: 200 + 60 * t, left: 40,
                  child: _orb(120, Colors.white.withValues(alpha: 0.06)),
                ),
              ]);
            },
          ),
          SafeArea(
            child: Center(
              child: SingleChildScrollView(
                padding: const EdgeInsets.symmetric(horizontal: 26, vertical: 24),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    FadeSlideIn(
                      from: const Offset(0, -0.15),
                      child: Container(
                        padding: const EdgeInsets.symmetric(horizontal: 22, vertical: 16),
                        decoration: BoxDecoration(
                          color: Colors.white.withValues(alpha: 0.10),
                          borderRadius: BorderRadius.circular(20),
                          border: Border.all(color: Colors.white.withValues(alpha: 0.15)),
                        ),
                        child: Image.asset('assets/logo.png', height: 46),
                      ),
                    ),
                    const SizedBox(height: 14),
                    FadeSlideIn(
                      delayMs: 120,
                      child: Text(tr('بوابة الموظفين', 'Employee Portal'),
                          style: TextStyle(color: Colors.white.withValues(alpha: 0.85), fontSize: 16, fontWeight: FontWeight.w600)),
                    ),
                    const SizedBox(height: 26),
                    FadeSlideIn(
                      delayMs: 220,
                      child: Container(
                        padding: const EdgeInsets.all(22),
                        decoration: BoxDecoration(
                          color: Colors.white,
                          borderRadius: BorderRadius.circular(24),
                          boxShadow: const [BoxShadow(color: Color(0x33000000), blurRadius: 30, offset: Offset(0, 12))],
                        ),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(tr('تسجيل الدخول', 'Sign in'), style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w800)),
                            const SizedBox(height: 4),
                            Text(tr('ادخل بحسابك المعتمد على النظام', 'Use your system account'), style: const TextStyle(fontSize: 13, color: T.inkSoft)),
                            const SizedBox(height: 18),
                            TextField(
                              controller: _email,
                              keyboardType: TextInputType.emailAddress,
                              textDirection: TextDirection.ltr,
                              decoration: InputDecoration(
                                labelText: tr('البريد الإلكتروني', 'Email'),
                                prefixIcon: const Icon(Icons.alternate_email, size: 20),
                              ),
                            ),
                            const SizedBox(height: 12),
                            TextField(
                              controller: _password,
                              obscureText: _obscure,
                              textDirection: TextDirection.ltr,
                              onSubmitted: (_) => _submit(),
                              decoration: InputDecoration(
                                labelText: tr('كلمة المرور', 'Password'),
                                prefixIcon: const Icon(Icons.lock_outline, size: 20),
                                suffixIcon: IconButton(
                                  icon: Icon(_obscure ? Icons.visibility_off_outlined : Icons.visibility_outlined, size: 20),
                                  onPressed: () => setState(() => _obscure = !_obscure),
                                ),
                              ),
                            ),
                            AnimatedSize(
                              duration: const Duration(milliseconds: 250),
                              child: _error == null
                                  ? const SizedBox(width: double.infinity)
                                  : Container(
                                      width: double.infinity,
                                      margin: const EdgeInsets.only(top: 12),
                                      padding: const EdgeInsets.all(11),
                                      decoration: BoxDecoration(
                                        color: const Color(0xFFFEE2E2),
                                        borderRadius: BorderRadius.circular(12),
                                      ),
                                      child: Row(children: [
                                        const Icon(Icons.error_outline, size: 17, color: Color(0xFFB91C1C)),
                                        const SizedBox(width: 6),
                                        Expanded(child: Text(_error!, style: const TextStyle(color: Color(0xFFB91C1C), fontSize: 13))),
                                      ]),
                                    ),
                            ),
                            const SizedBox(height: 18),
                            FilledButton(
                              onPressed: _busy ? null : _submit,
                              child: AnimatedSwitcher(
                                duration: const Duration(milliseconds: 200),
                                child: _busy
                                    ? const SizedBox(
                                        key: ValueKey('busy'), width: 22, height: 22,
                                        child: CircularProgressIndicator(strokeWidth: 2.5, color: Colors.white))
                                    : Row(
                                        key: const ValueKey('idle'),
                                        mainAxisAlignment: MainAxisAlignment.center,
                                        children: [
                                          Text(tr('دخول', 'Sign in')),
                                          const SizedBox(width: 6),
                                          Icon(Lang.instance.ar ? Icons.arrow_back_rounded : Icons.arrow_forward_rounded, size: 20),
                                        ],
                                      ),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                    const SizedBox(height: 20),
                    FadeSlideIn(
                      delayMs: 350,
                      child: Text('Energize Logistics © ${DateTime.now().year}',
                          style: TextStyle(color: Colors.white.withValues(alpha: 0.4), fontSize: 12)),
                    ),
                  ],
                ),
              ),
            ),
          ),
          // زر اللغة أعلى الشاشة.
          Positioned(
            top: MediaQuery.of(context).padding.top + 8,
            left: 14,
            child: TextButton(
              onPressed: () => Lang.instance.toggle(),
              child: Text(tr('EN', 'ع'),
                  style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w800, fontSize: 16)),
            ),
          ),
        ],
      ),
    );
  }

  Widget _orb(double size, Color color) => Container(
        width: size, height: size,
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          gradient: RadialGradient(colors: [color, color.withValues(alpha: 0)]),
        ),
      );
}
