import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

/// Design tokens — the company identity in one file: navy + orange, soft
/// grey canvas, white cards, Tajawal for Arabic.
class T {
  static const navy = Color(0xFF12325C);
  static const navyDark = Color(0xFF081833);
  static const orange = Color(0xFFF37121);
  static const canvas = Color(0xFFF4F6FA);
  static const card = Colors.white;
  // One shade darker so text is not faint and dividers are visible, like the web dashboards ([data-dash]).
  static const line = Color(0xFFCBD5E1);
  static const ink = Color(0xFF0F172A);
  static const inkSoft = Color(0xFF475569);
  static const inkFaint = Color(0xFF64748B);

  static const success = Color(0xFF059669);
  static const warn = Color(0xFFD97706);
  static const danger = Color(0xFFDC2626);
  static const info = Color(0xFF2563EB);
  static const violet = Color(0xFF7C3AED);
  static const cyan = Color(0xFF0891B2);

  static const navyGradient = LinearGradient(
    begin: Alignment.topRight,
    end: Alignment.bottomLeft,
    colors: [Color(0xFF0F2A52), Color(0xFF0A1E3D), navyDark],
  );

  static List<BoxShadow> get softShadow => const [
        BoxShadow(color: Color(0x14122F5C), blurRadius: 16, offset: Offset(0, 6)),
      ];

  static ThemeData theme() {
    final base = ThemeData(
      useMaterial3: true,
      colorScheme: ColorScheme.fromSeed(seedColor: navy, primary: navy, secondary: orange),
      scaffoldBackgroundColor: canvas,
    );
    return base.copyWith(
      textTheme: GoogleFonts.ibmPlexSansArabicTextTheme(base.textTheme).apply(bodyColor: ink, displayColor: ink),
      appBarTheme: AppBarTheme(
        backgroundColor: navy,
        foregroundColor: Colors.white,
        centerTitle: true,
        elevation: 0,
        titleTextStyle: GoogleFonts.ibmPlexSansArabic(fontSize: 18, fontWeight: FontWeight.w700, color: Colors.white),
      ),
      // Navy background with always-white text; without foregroundColor the tonal buttons (e.g. acknowledge) took dark text on navy and vanished.
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          backgroundColor: navy,
          foregroundColor: Colors.white,
          iconColor: Colors.white,
          disabledBackgroundColor: navy.withValues(alpha: 0.35),
          disabledForegroundColor: Colors.white.withValues(alpha: 0.8),
          minimumSize: const Size.fromHeight(50),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
          textStyle: GoogleFonts.ibmPlexSansArabic(fontSize: 16, fontWeight: FontWeight.w700),
        ),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: const Color(0xFFF8FAFC),
        contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
        border: OutlineInputBorder(borderRadius: BorderRadius.circular(14), borderSide: const BorderSide(color: line)),
        enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(14), borderSide: const BorderSide(color: line)),
        focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(14), borderSide: const BorderSide(color: navy, width: 1.6)),
        labelStyle: GoogleFonts.ibmPlexSansArabic(color: inkSoft),
      ),
      // Drag handle and rounded corners on all sheets so users can dismiss them easily.
      bottomSheetTheme: const BottomSheetThemeData(
        showDragHandle: true,
        dragHandleColor: line,
        backgroundColor: Colors.white,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(22))),
        clipBehavior: Clip.antiAlias,
      ),
      // Clearer dropdowns (white background, rounded corners).
      dropdownMenuTheme: DropdownMenuThemeData(
        menuStyle: MenuStyle(
          backgroundColor: WidgetStateProperty.all(Colors.white),
          shape: WidgetStateProperty.all(RoundedRectangleBorder(borderRadius: BorderRadius.circular(14))),
        ),
      ),
    );
  }
}
