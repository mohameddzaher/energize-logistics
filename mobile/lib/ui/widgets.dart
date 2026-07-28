import 'package:flutter/material.dart';
import 'theme.dart';

/// Staggered entrance: fades + slides a child up. Give each list item an
/// increasing [delay] and the screen builds itself piece by piece.
class FadeSlideIn extends StatefulWidget {
  final Widget child;
  final int delayMs;
  final Offset from;
  const FadeSlideIn({super.key, required this.child, this.delayMs = 0, this.from = const Offset(0, 0.08)});

  @override
  State<FadeSlideIn> createState() => _FadeSlideInState();
}

class _FadeSlideInState extends State<FadeSlideIn> with SingleTickerProviderStateMixin {
  late final AnimationController _c =
      AnimationController(vsync: this, duration: const Duration(milliseconds: 450));
  late final Animation<double> _fade = CurvedAnimation(parent: _c, curve: Curves.easeOutCubic);
  late final Animation<Offset> _slide =
      Tween(begin: widget.from, end: Offset.zero).animate(CurvedAnimation(parent: _c, curve: Curves.easeOutCubic));

  @override
  void initState() {
    super.initState();
    Future.delayed(Duration(milliseconds: widget.delayMs), () { if (mounted) _c.forward(); });
  }

  @override
  void dispose() { _c.dispose(); super.dispose(); }

  @override
  Widget build(BuildContext context) =>
      FadeTransition(opacity: _fade, child: SlideTransition(position: _slide, child: widget.child));
}

/// Press feedback: the card shrinks slightly under the finger — the small
/// detail that makes a UI feel native instead of webby.
class Pressable extends StatefulWidget {
  final Widget child;
  final VoidCallback? onTap;
  const Pressable({super.key, required this.child, this.onTap});

  @override
  State<Pressable> createState() => _PressableState();
}

class _PressableState extends State<Pressable> {
  bool _down = false;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTapDown: (_) => setState(() => _down = true),
      onTapUp: (_) => setState(() => _down = false),
      onTapCancel: () => setState(() => _down = false),
      onTap: widget.onTap,
      child: AnimatedScale(
        scale: _down ? 0.965 : 1,
        duration: const Duration(milliseconds: 110),
        child: widget.child,
      ),
    );
  }
}

/// The standard white card of the design system.
class AppCard extends StatelessWidget {
  final Widget child;
  final EdgeInsets padding;
  final Color? topAccent;
  const AppCard({super.key, required this.child, this.padding = const EdgeInsets.all(14), this.topAccent});

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: T.card,
        borderRadius: BorderRadius.circular(16),
        border: topAccent != null
            ? Border(top: BorderSide(color: topAccent!, width: 4))
            : Border.all(color: T.line),
        boxShadow: T.softShadow,
      ),
      padding: padding,
      child: child,
    );
  }
}

class Chip2 extends StatelessWidget {
  final String label;
  final Color color;
  final IconData? icon;
  const Chip2(this.label, this.color, {super.key, this.icon});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 4),
      decoration: BoxDecoration(color: color.withValues(alpha: 0.11), borderRadius: BorderRadius.circular(20)),
      child: Row(mainAxisSize: MainAxisSize.min, children: [
        if (icon != null) ...[Icon(icon, size: 12, color: color), const SizedBox(width: 3)],
        Text(label, style: TextStyle(fontSize: 11.5, color: color, fontWeight: FontWeight.w700)),
      ]),
    );
  }
}

/// KPI stat with an animated count-up — numbers that roll in feel alive.
class StatCard extends StatelessWidget {
  final String label;
  final num value;
  final Color color;
  final IconData icon;
  const StatCard({super.key, required this.label, required this.value, required this.color, required this.icon});

  @override
  Widget build(BuildContext context) {
    return AppCard(
      padding: const EdgeInsets.all(12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(children: [
            Container(
              padding: const EdgeInsets.all(6),
              decoration: BoxDecoration(color: color.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(10)),
              child: Icon(icon, size: 16, color: color),
            ),
            const Spacer(),
          ]),
          const SizedBox(height: 8),
          TweenAnimationBuilder<double>(
            tween: Tween(begin: 0, end: value.toDouble()),
            duration: const Duration(milliseconds: 900),
            curve: Curves.easeOutCubic,
            builder: (c, v, _) => Text(
              v.round().toString(),
              style: TextStyle(fontSize: 22, fontWeight: FontWeight.w800, color: color, height: 1),
            ),
          ),
          const SizedBox(height: 2),
          Text(label, style: const TextStyle(fontSize: 11, color: T.inkSoft, fontWeight: FontWeight.w600)),
        ],
      ),
    );
  }
}

/// Loading shimmer block — screens skeleton in instead of spinning.
class Shimmer extends StatefulWidget {
  final double height;
  final double radius;
  const Shimmer({super.key, this.height = 84, this.radius = 16});

  @override
  State<Shimmer> createState() => _ShimmerState();
}

class _ShimmerState extends State<Shimmer> with SingleTickerProviderStateMixin {
  late final AnimationController _c =
      AnimationController(vsync: this, duration: const Duration(milliseconds: 1100))..repeat();

  @override
  void dispose() { _c.dispose(); super.dispose(); }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _c,
      builder: (context, _) => Container(
        height: widget.height,
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(widget.radius),
          gradient: LinearGradient(
            begin: Alignment(-1 + 2 * _c.value, 0),
            end: Alignment(0 + 2 * _c.value, 0),
            colors: const [Color(0xFFEDF1F7), Color(0xFFE2E8F0), Color(0xFFEDF1F7)],
          ),
        ),
      ),
    );
  }
}

class ErrorRetry extends StatelessWidget {
  final String message;
  final VoidCallback onRetry;
  const ErrorRetry({super.key, required this.message, required this.onRetry});

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          const Icon(Icons.wifi_off_rounded, size: 42, color: T.inkFaint),
          const SizedBox(height: 10),
          Text(message, textAlign: TextAlign.center, style: const TextStyle(color: T.inkSoft)),
          const SizedBox(height: 12),
          FilledButton.tonal(onPressed: onRetry, child: const Text('إعادة المحاولة')),
        ]),
      ),
    );
  }
}

class EmptyState extends StatelessWidget {
  final IconData icon;
  final String title;
  final String? subtitle;
  const EmptyState({super.key, required this.icon, required this.title, this.subtitle});

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(30),
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          Container(
            padding: const EdgeInsets.all(18),
            decoration: BoxDecoration(color: T.navy.withValues(alpha: 0.06), shape: BoxShape.circle),
            child: Icon(icon, size: 40, color: T.navy.withValues(alpha: 0.45)),
          ),
          const SizedBox(height: 14),
          Text(title, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 16, color: T.inkSoft)),
          if (subtitle != null) ...[
            const SizedBox(height: 6),
            Text(subtitle!, textAlign: TextAlign.center, style: const TextStyle(fontSize: 13, color: T.inkFaint)),
          ],
        ]),
      ),
    );
  }
}
