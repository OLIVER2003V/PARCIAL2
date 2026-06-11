import 'dart:convert';

enum RolMensaje { usuario, asistente }

class RequisitoCampo {
  final String etiqueta;
  final String tipo;
  final bool requerido;

  const RequisitoCampo({
    required this.etiqueta,
    required this.tipo,
    required this.requerido,
  });

  factory RequisitoCampo.fromJson(Map<String, dynamic> j) => RequisitoCampo(
        etiqueta: j['etiqueta'] ?? '',
        tipo: j['tipo'] ?? 'texto',
        requerido: j['requerido'] == true,
      );

  Map<String, dynamic> toJson() =>
      {'etiqueta': etiqueta, 'tipo': tipo, 'requerido': requerido};
}

class CandidatoAlternativo {
  final String procesoId;
  final String nombre;
  final double confianza;

  const CandidatoAlternativo({
    required this.procesoId,
    required this.nombre,
    required this.confianza,
  });

  factory CandidatoAlternativo.fromJson(Map<String, dynamic> j) =>
      CandidatoAlternativo(
        procesoId: j['procesoId'] ?? '',
        nombre: j['nombre'] ?? '',
        confianza: (j['confianza'] ?? 0).toDouble(),
      );

  Map<String, dynamic> toJson() =>
      {'procesoId': procesoId, 'nombre': nombre, 'confianza': confianza};
}

class MensajeChat {
  final RolMensaje rol;
  final String contenido;
  final DateTime timestamp;
  final String? accion;
  final String? procesoId;
  final String? procesoNombre;
  final List<RequisitoCampo>? requisitos;
  final List<CandidatoAlternativo>? candidatosAlternativos;

  MensajeChat({
    required this.rol,
    required this.contenido,
    DateTime? timestamp,
    this.accion,
    this.procesoId,
    this.procesoNombre,
    this.requisitos,
    this.candidatosAlternativos,
  }) : timestamp = timestamp ?? DateTime.now();

  Map<String, String> toBackendJson() => {
        'rol': rol == RolMensaje.usuario ? 'user' : 'assistant',
        'contenido': contenido,
      };

  Map<String, dynamic> toJson() => {
        'rol': rol == RolMensaje.usuario ? 'user' : 'assistant',
        'contenido': contenido,
        'timestamp': timestamp.toIso8601String(),
        if (accion != null) 'accion': accion,
        if (procesoId != null) 'procesoId': procesoId,
        if (procesoNombre != null) 'procesoNombre': procesoNombre,
        if (requisitos != null)
          'requisitos': requisitos!.map((r) => r.toJson()).toList(),
        if (candidatosAlternativos != null)
          'candidatosAlternativos':
              candidatosAlternativos!.map((c) => c.toJson()).toList(),
      };

  factory MensajeChat.fromJson(Map<String, dynamic> j) => MensajeChat(
        rol: j['rol'] == 'user' ? RolMensaje.usuario : RolMensaje.asistente,
        contenido: j['contenido'] ?? '',
        timestamp: j['timestamp'] != null
            ? DateTime.tryParse(j['timestamp']) ?? DateTime.now()
            : DateTime.now(),
        accion: j['accion'],
        procesoId: j['procesoId'],
        procesoNombre: j['procesoNombre'],
        requisitos: j['requisitos'] != null
            ? (j['requisitos'] as List)
                .map((r) => RequisitoCampo.fromJson(Map<String, dynamic>.from(r)))
                .toList()
            : null,
        candidatosAlternativos: j['candidatosAlternativos'] != null
            ? (j['candidatosAlternativos'] as List)
                .map((c) =>
                    CandidatoAlternativo.fromJson(Map<String, dynamic>.from(c)))
                .toList()
            : null,
      );
}

class ConversacionHistorial {
  final String id;
  final String titulo;
  final DateTime fecha;
  final List<MensajeChat> mensajes;

  const ConversacionHistorial({
    required this.id,
    required this.titulo,
    required this.fecha,
    required this.mensajes,
  });

  Map<String, dynamic> toJson() => {
        'id': id,
        'titulo': titulo,
        'fecha': fecha.toIso8601String(),
        'mensajes': mensajes.map((m) => m.toJson()).toList(),
      };

  factory ConversacionHistorial.fromJson(Map<String, dynamic> j) =>
      ConversacionHistorial(
        id: j['id'] ?? '',
        titulo: j['titulo'] ?? 'Conversación',
        fecha: j['fecha'] != null
            ? DateTime.tryParse(j['fecha']) ?? DateTime.now()
            : DateTime.now(),
        mensajes: j['mensajes'] != null
            ? (j['mensajes'] as List)
                .map((m) => MensajeChat.fromJson(Map<String, dynamic>.from(m)))
                .toList()
            : [],
      );
}

class ChatbotResponse {
  final String respuesta;
  final List<String> sugerenciasRapidas;
  final String? accion;
  final String? procesoId;
  final String? procesoNombre;
  final List<RequisitoCampo>? requisitos;
  final List<CandidatoAlternativo>? candidatosAlternativos;

  ChatbotResponse({
    required this.respuesta,
    required this.sugerenciasRapidas,
    this.accion,
    this.procesoId,
    this.procesoNombre,
    this.requisitos,
    this.candidatosAlternativos,
  });

  factory ChatbotResponse.fromJson(Map<String, dynamic> j) => ChatbotResponse(
        respuesta: j['respuesta'] ?? '(sin respuesta)',
        sugerenciasRapidas: j['sugerenciasRapidas'] != null
            ? List<String>.from(j['sugerenciasRapidas'])
            : [],
        accion: j['accion'],
        procesoId: j['procesoId'],
        procesoNombre: j['procesoNombre'],
        requisitos: j['requisitos'] != null
            ? (j['requisitos'] as List)
                .map((r) =>
                    RequisitoCampo.fromJson(Map<String, dynamic>.from(r)))
                .toList()
            : null,
        candidatosAlternativos: j['candidatosAlternativos'] != null
            ? (j['candidatosAlternativos'] as List)
                .map((c) =>
                    CandidatoAlternativo.fromJson(Map<String, dynamic>.from(c)))
                .toList()
            : null,
      );
}

// Helpers para serialización JSON de listas
String mensajesAJson(List<MensajeChat> msgs) =>
    jsonEncode(msgs.map((m) => m.toJson()).toList());

List<MensajeChat> mensajesDesdeJson(String raw) {
  try {
    final lista = jsonDecode(raw) as List;
    return lista
        .map((m) => MensajeChat.fromJson(Map<String, dynamic>.from(m)))
        .toList();
  } catch (_) {
    return [];
  }
}

String historialAJson(List<ConversacionHistorial> h) =>
    jsonEncode(h.map((c) => c.toJson()).toList());

List<ConversacionHistorial> historialDesdeJson(String raw) {
  try {
    final lista = jsonDecode(raw) as List;
    return lista
        .map((c) =>
            ConversacionHistorial.fromJson(Map<String, dynamic>.from(c)))
        .toList();
  } catch (_) {
    return [];
  }
}
