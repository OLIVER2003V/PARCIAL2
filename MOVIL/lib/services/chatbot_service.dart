// 👇 NUEVO Servicio del Asistente IA Cliente (CU17)
//
// Mantiene el historial de la conversación en memoria (estilo el frontend web).
// El backend usa el historial para dar contexto a Gemini en cada respuesta.

import 'dart:convert';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';
import '../core/api_config.dart';
import '../models/mensaje_chat.dart';

class ChatbotService {
  /// Historial de la conversación en memoria.
  /// Se reinicia cada vez que el usuario cierra y reabre la pantalla.
  final List<MensajeChat> mensajes = [];

  /// Helper para armar headers con JWT
  Future<Map<String, String>> _getHeaders() async {
    final prefs = await SharedPreferences.getInstance();
    final token = prefs.getString('token') ?? '';
    return {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer $token',
    };
  }

  /// Agrega un mensaje al historial local sin llamar al backend.
  /// Útil para mostrar el mensaje del usuario inmediatamente en la UI.
  void agregarMensaje(RolMensaje rol, String contenido) {
    mensajes.add(MensajeChat(rol: rol, contenido: contenido));
  }

  /// Envía un mensaje al backend y devuelve la respuesta + sugerencias rápidas.
  /// El backend recibe el historial completo para mantener el contexto.
  Future<ChatbotResponse?> enviar(String mensajeUsuario) async {
    try {
      final headers = await _getHeaders();

      // Construir el payload con el historial actual (excluyendo el mensaje
      // que se está enviando, ya que va aparte en el campo `mensaje`).
      final payload = {
        'mensaje': mensajeUsuario,
        'historial': mensajes.map((m) => m.toBackendJson()).toList(),
      };

      final response = await http.post(
        Uri.parse(ApiConfig.iaChatbotCliente),
        headers: headers,
        body: jsonEncode(payload),
      );

      if (response.statusCode == 200) {
        final data = jsonDecode(utf8.decode(response.bodyBytes));
        return ChatbotResponse.fromJson(data);
      } else {
        // El backend puede devolver 503 (IA saturada) o 500 (error interno)
        // con un body tipo { error: "...", tipo: "IA_SATURADA" }
        try {
          final errData = jsonDecode(utf8.decode(response.bodyBytes));
          return ChatbotResponse(
            respuesta: '⚠️ ${errData['error'] ?? 'El asistente no está disponible'}',
            sugerenciasRapidas: const [],
          );
        } catch (_) {
          return null;
        }
      }
    } catch (e) {
      print('Error en chatbot: $e');
      return null;
    }
  }

  /// Limpia el historial (botón "Nueva conversación")
  void limpiar() {
    mensajes.clear();
  }
}