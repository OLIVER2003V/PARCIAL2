import 'dart:convert';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';
import '../core/api_config.dart';
import '../models/mensaje_chat.dart';

const _keySesion    = 'bpms_chat_sesion';
const _keyHistorial = 'bpms_chat_historial';
const _maxConvs     = 15;

class ChatbotService {
  final List<MensajeChat>           mensajes  = [];
  final List<ConversacionHistorial> historial = [];

  ChatbotService() {
    _cargarDesdeStorage();
  }

  // ── Persistencia ───────────────────────────────────────────────────────────

  Future<void> _cargarDesdeStorage() async {
    final prefs = await SharedPreferences.getInstance();

    final rawSesion = prefs.getString(_keySesion);
    if (rawSesion != null) mensajes.addAll(mensajesDesdeJson(rawSesion));

    final rawHist = prefs.getString(_keyHistorial);
    if (rawHist != null) historial.addAll(historialDesdeJson(rawHist));
  }

  Future<void> _guardarSesion() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_keySesion, mensajesAJson(mensajes));
  }

  Future<void> _guardarHistorial() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_keyHistorial, historialAJson(historial));
  }

  // ── Mensajes ───────────────────────────────────────────────────────────────

  void agregarMensaje(
    RolMensaje rol,
    String contenido, {
    String? accion,
    String? procesoId,
    String? procesoNombre,
    List<RequisitoCampo>? requisitos,
    List<CandidatoAlternativo>? candidatosAlternativos,
  }) {
    mensajes.add(MensajeChat(
      rol: rol,
      contenido: contenido,
      accion: accion,
      procesoId: procesoId,
      procesoNombre: procesoNombre,
      requisitos: requisitos,
      candidatosAlternativos: candidatosAlternativos,
    ));
    _guardarSesion();
  }

  /// Archiva la conversación en historial y limpia el chat.
  Future<void> limpiar() async {
    if (mensajes.any((m) => m.rol == RolMensaje.usuario)) {
      _archivar();
    }
    mensajes.clear();
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_keySesion);
  }

  // ── Historial ──────────────────────────────────────────────────────────────

  void restaurarConversacion(ConversacionHistorial conv) {
    mensajes
      ..clear()
      ..addAll(conv.mensajes);
    _guardarSesion();
  }

  Future<void> eliminarConversacion(String id) async {
    historial.removeWhere((c) => c.id == id);
    await _guardarHistorial();
  }

  Future<void> limpiarHistorial() async {
    historial.clear();
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_keyHistorial);
  }

  // ── Envío HTTP ─────────────────────────────────────────────────────────────

  Future<Map<String, String>> _getHeaders() async {
    final prefs = await SharedPreferences.getInstance();
    final token = prefs.getString('token') ?? '';
    return {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer $token',
    };
  }

  Future<ChatbotResponse?> enviar(String mensajeUsuario) async {
    try {
      final headers = await _getHeaders();
      final payload = {
        'mensaje': mensajeUsuario,
        'historial': mensajes.map((m) => m.toBackendJson()).toList(),
      };
      final response = await http.post(
        Uri.parse(ApiConfig.iaChatbotCliente),
        headers: headers,
        body: jsonEncode(payload),
      ).timeout(const Duration(seconds: 30));

      if (response.statusCode == 200) {
        final data = jsonDecode(utf8.decode(response.bodyBytes));
        return ChatbotResponse.fromJson(data);
      } else {
        try {
          final err = jsonDecode(utf8.decode(response.bodyBytes));
          return ChatbotResponse(
            respuesta: '⚠️ ${err['error'] ?? 'El asistente no está disponible'}',
            sugerenciasRapidas: [],
          );
        } catch (_) {
          return null;
        }
      }
    } catch (e) {
      return null;
    }
  }

  // ── Privados ───────────────────────────────────────────────────────────────

  void _archivar() {
    final primero = mensajes.firstWhere(
      (m) => m.rol == RolMensaje.usuario,
      orElse: () => mensajes.first,
    );
    final titulo = primero.contenido.length > 55
        ? '${primero.contenido.substring(0, 55)}…'
        : primero.contenido;

    final conv = ConversacionHistorial(
      id: DateTime.now().millisecondsSinceEpoch.toString(),
      titulo: titulo,
      fecha: DateTime.now(),
      mensajes: List.from(mensajes),
    );

    historial.insert(0, conv);
    if (historial.length > _maxConvs) historial.removeLast();
    _guardarHistorial();
  }
}
