// 👇 NUEVO Tema central de la app — paleta consistente con el frontend web
//
// Reemplaza los Color(0xFF...) hardcoded en cada pantalla.
// Inspirado en la paleta brand-* del frontend (Tailwind tokens).

import 'package:flutter/material.dart';

class AppTheme {
  // ============================================================================
  //  👇 NUEVO Paleta brand
  // ============================================================================
  /// Fondo oscuro principal (slate-900)
  static const Color brandBg = Color(0xFF0F172A);

  /// Superficies elevadas: cards, appbar (slate-800)
  static const Color brandSurface = Color(0xFF1E293B);

  /// Color primario: púrpura corporativo
  static const Color brandPrimary = Color(0xFF9333EA);

  /// Bordes y separadores sutiles (slate-700)
  static const Color brandBorder = Color(0xFF334155);

  /// Texto secundario (slate-400)
  static const Color brandMuted = Color(0xFF94A3B8);

  // ============================================================================
  //  👇 NUEVO Estados (semáforo de trámites)
  // ============================================================================
  /// Verde — Aprobado / Completado / OK
  static const Color estadoVerde = Color(0xFF10B981);

  /// Ámbar — En revisión / Pendiente
  static const Color estadoAmbar = Color(0xFFF59E0B);

  /// Rojo — Rechazado / Error
  static const Color estadoRojo = Color(0xFFEF4444);

  // ============================================================================
  //  👇 NUEVO Helpers de UI reutilizables
  // ============================================================================
  /// Border radius estándar para cards y botones
  static const double radius = 12.0;
  static const double radiusGrande = 16.0;

  /// InputDecoration consistente para todos los TextFormField oscuros
  static InputDecoration inputDecoration({
    required String label,
    IconData? icono,
  }) {
    return InputDecoration(
      labelText: label,
      labelStyle: const TextStyle(color: brandMuted),
      prefixIcon: icono != null ? Icon(icono, color: brandMuted) : null,
      filled: true,
      fillColor: brandSurface,
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(radius),
        borderSide: BorderSide.none,
      ),
    );
  }

  /// Estilo estándar para botones primarios púrpuras
  static ButtonStyle botonPrimario() {
    return ElevatedButton.styleFrom(
      backgroundColor: brandPrimary,
      foregroundColor: Colors.white,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(radius),
      ),
    );
  }

  /// Color del semáforo según el estado del trámite
  static Color colorEstado(String estado) {
    switch (estado.toUpperCase()) {
      case 'APROBADO':
      case 'COMPLETADO':
        return estadoVerde;
      case 'RECHAZADO':
        return estadoRojo;
      default:
        return estadoAmbar; // EN_REVISION, EN_PROCESO, EN_TIEMPO
    }
  }
}