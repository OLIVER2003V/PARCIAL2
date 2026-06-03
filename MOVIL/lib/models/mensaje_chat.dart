// 👇 NUEVO Modelos del Asistente IA Cliente (CU17)
//
// Contrato del backend (AiController.chatbotCliente):
//   Request:  { mensaje: string, historial: [{rol, contenido}, ...] }
//   Response: { respuesta: string, sugerenciasRapidas: string[] }

/// Rol del autor del mensaje en la conversación
enum RolMensaje { usuario, asistente }

/// Un mensaje individual dentro del chat
class MensajeChat {
  final RolMensaje rol;
  final String contenido;
  final DateTime timestamp;

  MensajeChat({
    required this.rol,
    required this.contenido,
    DateTime? timestamp,
  }) : timestamp = timestamp ?? DateTime.now();

  /// Serializa al formato que espera el backend en el campo `historial`.
  /// El backend usa los strings 'user' y 'assistant' (alineado con OpenAI/Gemini).
  Map<String, String> toBackendJson() {
    return {
      'rol': rol == RolMensaje.usuario ? 'user' : 'assistant',
      'contenido': contenido,
    };
  }
}

/// Respuesta del endpoint `/api/ia/chatbot-cliente`
class ChatbotResponse {
  final String respuesta;
  final List<String> sugerenciasRapidas;

  ChatbotResponse({
    required this.respuesta,
    required this.sugerenciasRapidas,
  });

  factory ChatbotResponse.fromJson(Map<String, dynamic> json) {
    return ChatbotResponse(
      respuesta: json['respuesta'] ?? '(sin respuesta)',
      sugerenciasRapidas: json['sugerenciasRapidas'] != null
          ? List<String>.from(json['sugerenciasRapidas'])
          : [],
    );
  }
}