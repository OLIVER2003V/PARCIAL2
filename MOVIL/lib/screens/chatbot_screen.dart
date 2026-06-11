import 'package:flutter/material.dart';
import 'package:speech_to_text/speech_to_text.dart';
import 'package:speech_to_text/speech_recognition_result.dart';
import '../core/app_theme.dart';
import '../models/mensaje_chat.dart';
import '../models/proceso.dart';
import '../services/chatbot_service.dart';
import '../services/proceso_service.dart';
import 'formulario_tramite_screen.dart';
import 'catalogo_screen.dart';

class ChatbotScreen extends StatefulWidget {
  const ChatbotScreen({super.key});

  @override
  State<ChatbotScreen> createState() => _ChatbotScreenState();
}

class _ChatbotScreenState extends State<ChatbotScreen> {
  final ChatbotService       _service       = ChatbotService();
  final ProcesoService       _procesoService = ProcesoService();
  final TextEditingController _inputCtrl     = TextEditingController();
  final ScrollController     _scrollCtrl    = ScrollController();
  final SpeechToText         _stt           = SpeechToText();

  bool   _cargando        = false;
  bool   _sttDisponible   = false;
  bool   _escuchando      = false;
  bool   _verHistorial    = false;
  double _nivelSonido     = 0.0;

  List<String> _sugerencias = [];

  final List<String> _sugerenciasIniciales = [
    '¿Qué trámites puedo solicitar?',
    '¿Cómo va el estado de mis trámites?',
    '¿Cómo inicio un nuevo trámite?',
    '¿Qué documentos necesito?',
  ];

  @override
  void initState() {
    super.initState();
    _inicializarVoz();
  }

  Future<void> _inicializarVoz() async {
    final ok = await _stt.initialize(
      onError: (_) { if (mounted) setState(() => _escuchando = false); },
      onStatus: (s) {
        if (mounted && (s == 'done' || s == 'notListening')) {
          setState(() => _escuchando = false);
        }
      },
    );
    if (mounted) setState(() => _sttDisponible = ok);
  }

  @override
  void dispose() {
    _inputCtrl.dispose();
    _scrollCtrl.dispose();
    _stt.stop();
    super.dispose();
  }

  // ── Envío ──────────────────────────────────────────────────────────────────

  Future<void> _enviar([String? forzado]) async {
    final texto = (forzado ?? _inputCtrl.text).trim();
    if (texto.isEmpty || _cargando) return;

    setState(() {
      _service.agregarMensaje(RolMensaje.usuario, texto);
      _inputCtrl.clear();
      _sugerencias = [];
      _cargando = true;
    });
    _scrollAlFondo();

    final resp = await _service.enviar(texto);
    if (!mounted) return;

    setState(() {
      if (resp != null) {
        _service.agregarMensaje(
          RolMensaje.asistente,
          resp.respuesta,
          accion: resp.accion,
          procesoId: resp.procesoId,
          procesoNombre: resp.procesoNombre,
          requisitos: resp.requisitos,
          candidatosAlternativos: resp.candidatosAlternativos,
        );
        _sugerencias = resp.sugerenciasRapidas;
      } else {
        _service.agregarMensaje(
          RolMensaje.asistente,
          '⚠️ No pude procesar tu mensaje. Intenta de nuevo en unos segundos.',
        );
      }
      _cargando = false;
    });
    _scrollAlFondo();
  }

  void _scrollAlFondo() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scrollCtrl.hasClients) {
        _scrollCtrl.animateTo(
          _scrollCtrl.position.maxScrollExtent,
          duration: const Duration(milliseconds: 250),
          curve: Curves.easeOut,
        );
      }
    });
  }

  Future<void> _limpiar() async {
    await _service.limpiar();
    if (mounted) setState(() => _sugerencias = []);
  }

  // ── Voz ────────────────────────────────────────────────────────────────────

  void _onSpeechResult(SpeechRecognitionResult r) {
    setState(() => _inputCtrl.text = r.recognizedWords);
    if (r.finalResult && _escuchando && r.recognizedWords.trim().isNotEmpty) {
      setState(() => _escuchando = false);
      _enviar();
    }
  }

  Future<void> _toggleVoz() async {
    if (!_sttDisponible) return;
    if (_escuchando) {
      setState(() => _escuchando = false);
      await _stt.stop();
      return;
    }
    setState(() { _escuchando = true; _nivelSonido = 0.0; _inputCtrl.clear(); });
    await _stt.listen(
      onResult: _onSpeechResult,
      onSoundLevelChange: (l) => setState(() => _nivelSonido = l.clamp(0.0, 10.0)),
      listenOptions: SpeechListenOptions(
        pauseFor: const Duration(seconds: 2),
        partialResults: true,
        cancelOnError: true,
        listenMode: ListenMode.dictation,
      ),
    );
  }

  // ── Navegación desde tarjetas ──────────────────────────────────────────────

  Future<void> _navegarATramite(String procesoId) async {
    ProcesoDefinicion? proceso;
    try {
      final lista = await _procesoService.obtenerCatalogoPublico();
      proceso = lista.firstWhere((p) => p.id == procesoId,
          orElse: () => lista.first);
    } catch (_) {}

    if (!mounted) return;
    if (proceso != null) {
      Navigator.push(context,
          MaterialPageRoute(builder: (_) => FormularioTramiteScreen(proceso: proceso!)));
    } else {
      _navegarACatalogo();
    }
  }

  void _navegarACatalogo() {
    Navigator.push(context,
        MaterialPageRoute(builder: (_) => const CatalogoScreen()));
  }

  // ── UI ─────────────────────────────────────────────────────────────────────

  @override
  Widget build(BuildContext context) {
    final mensajes = _service.mensajes;
    final bienvenida = mensajes.isEmpty && !_cargando;

    return Scaffold(
      backgroundColor: AppTheme.brandBg,
      appBar: AppBar(
        backgroundColor: AppTheme.brandSurface,
        iconTheme: const IconThemeData(color: Colors.white),
        title: Row(children: [
          Container(
            padding: const EdgeInsets.all(6),
            decoration: BoxDecoration(
                color: AppTheme.brandPrimary,
                borderRadius: BorderRadius.circular(8)),
            child: const Icon(Icons.auto_awesome, color: Colors.white, size: 18),
          ),
          const SizedBox(width: 10),
          const Text('Asistente IA',
              style: TextStyle(
                  color: Colors.white, fontSize: 16, fontWeight: FontWeight.bold)),
        ]),
        actions: [
          // Historial
          Stack(alignment: Alignment.center, children: [
            IconButton(
              icon: Icon(Icons.history_rounded,
                  color: _verHistorial
                      ? AppTheme.brandPrimary
                      : Colors.white),
              tooltip: 'Historial de conversaciones',
              onPressed: () => setState(() => _verHistorial = !_verHistorial),
            ),
            if (_service.historial.isNotEmpty && !_verHistorial)
              Positioned(
                right: 8, top: 8,
                child: Container(
                  width: 8, height: 8,
                  decoration: const BoxDecoration(
                      color: AppTheme.estadoAmbar, shape: BoxShape.circle),
                ),
              ),
          ]),
          if (mensajes.isNotEmpty)
            IconButton(
              icon: const Icon(Icons.delete_sweep_rounded, color: Colors.white),
              tooltip: 'Limpiar conversación',
              onPressed: _limpiar,
            ),
        ],
      ),
      body: Column(children: [
        Expanded(child: _verHistorial ? _buildHistorial() : _buildChat(bienvenida, mensajes)),
        if (!_verHistorial) ...[
          if (_sugerencias.isNotEmpty && !_cargando) _buildSugerencias(_sugerencias),
          _buildInput(),
        ],
      ]),
    );
  }

  // ── Panel de historial ─────────────────────────────────────────────────────

  Widget _buildHistorial() {
    final hist = _service.historial;
    return Column(children: [
      // Cabecera
      Container(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
        decoration: const BoxDecoration(
          color: AppTheme.brandSurface,
          border: Border(bottom: BorderSide(color: AppTheme.brandBorder, width: 0.5)),
        ),
        child: Row(children: [
          const Text('Conversaciones anteriores',
              style: TextStyle(
                  color: Colors.white, fontSize: 14, fontWeight: FontWeight.bold)),
          const Spacer(),
          if (hist.isNotEmpty)
            TextButton(
              onPressed: () async {
                await _service.limpiarHistorial();
                if (mounted) setState(() {});
              },
              child: const Text('Borrar todo',
                  style: TextStyle(color: AppTheme.estadoRojo, fontSize: 12)),
            ),
        ]),
      ),
      Expanded(
        child: hist.isEmpty
            ? Center(child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
                Container(
                  width: 64, height: 64,
                  decoration: BoxDecoration(
                      color: AppTheme.brandSurface,
                      borderRadius: BorderRadius.circular(20)),
                  child: const Icon(Icons.history_rounded,
                      size: 32, color: AppTheme.brandMuted),
                ),
                const SizedBox(height: 16),
                const Text('Sin conversaciones archivadas',
                    style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
                const SizedBox(height: 6),
                const Text('Al limpiar el chat, la conversación se guardará aquí.',
                    style: TextStyle(color: AppTheme.brandMuted, fontSize: 12),
                    textAlign: TextAlign.center),
              ]))
            : ListView.separated(
                padding: const EdgeInsets.all(16),
                itemCount: hist.length,
                separatorBuilder: (_, __) => const SizedBox(height: 8),
                itemBuilder: (_, i) {
                  final conv = hist[i];
                  return Card(
                    color: AppTheme.brandSurface,
                    shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(AppTheme.radiusGrande)),
                    child: InkWell(
                      borderRadius:
                          BorderRadius.circular(AppTheme.radiusGrande),
                      onTap: () {
                        _service.restaurarConversacion(conv);
                        setState(() => _verHistorial = false);
                        _scrollAlFondo();
                      },
                      child: Padding(
                        padding: const EdgeInsets.all(14),
                        child: Row(children: [
                          Expanded(child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(_formatearFecha(conv.fecha),
                                    style: const TextStyle(
                                        color: AppTheme.brandMuted,
                                        fontSize: 10,
                                        fontWeight: FontWeight.bold)),
                                const SizedBox(height: 4),
                                Text(conv.titulo,
                                    style: const TextStyle(
                                        color: Colors.white, fontSize: 13),
                                    maxLines: 2,
                                    overflow: TextOverflow.ellipsis),
                                const SizedBox(height: 4),
                                Text(
                                    '${conv.mensajes.length} mensaje${conv.mensajes.length != 1 ? 's' : ''}',
                                    style: const TextStyle(
                                        color: AppTheme.brandMuted,
                                        fontSize: 11)),
                              ])),
                          IconButton(
                            icon: const Icon(Icons.delete_outline_rounded,
                                color: AppTheme.brandMuted, size: 18),
                            tooltip: 'Eliminar',
                            onPressed: () async {
                              await _service.eliminarConversacion(conv.id);
                              if (mounted) setState(() {});
                            },
                          ),
                        ]),
                      ),
                    ),
                  );
                },
              ),
      ),
    ]);
  }

  // ── Chat principal ─────────────────────────────────────────────────────────

  Widget _buildChat(bool bienvenida, List<MensajeChat> mensajes) {
    if (bienvenida) return _buildBienvenida();
    return ListView.builder(
      controller: _scrollCtrl,
      padding: const EdgeInsets.all(16),
      itemCount: mensajes.length + (_cargando ? 1 : 0),
      itemBuilder: (_, i) {
        if (_cargando && i == mensajes.length) return _buildLoadingBubble();
        return _buildMensaje(mensajes[i]);
      },
    );
  }

  // ── Bienvenida ─────────────────────────────────────────────────────────────

  Widget _buildBienvenida() {
    return SingleChildScrollView(
      padding: const EdgeInsets.all(24),
      child: Column(crossAxisAlignment: CrossAxisAlignment.center, children: [
        const SizedBox(height: 32),
        Container(
          padding: const EdgeInsets.all(20),
          decoration: BoxDecoration(
              color: AppTheme.brandPrimary.withValues(alpha: 0.15),
              shape: BoxShape.circle),
          child: const Icon(Icons.auto_awesome,
              color: AppTheme.brandPrimary, size: 48),
        ),
        const SizedBox(height: 24),
        const Text('¡Hola! Soy tu asistente',
            textAlign: TextAlign.center,
            style: TextStyle(
                color: Colors.white, fontSize: 22, fontWeight: FontWeight.bold)),
        const SizedBox(height: 8),
        const Text(
            'Te ayudo con tus trámites. Escríbeme o usa el micrófono para decirme qué necesitas.',
            textAlign: TextAlign.center,
            style: TextStyle(color: AppTheme.brandMuted, fontSize: 14)),
        const SizedBox(height: 32),
        const Align(
          alignment: Alignment.centerLeft,
          child: Text('Prueba preguntando:',
              style: TextStyle(
                  color: AppTheme.brandMuted,
                  fontSize: 11,
                  fontWeight: FontWeight.bold,
                  letterSpacing: 1.2)),
        ),
        const SizedBox(height: 12),
        ..._sugerenciasIniciales.map((s) => Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: SizedBox(
                width: double.infinity,
                child: _buildChipSugerencia(s, ancho: true),
              ),
            )),
      ]),
    );
  }

  // ── Burbuja de mensaje ─────────────────────────────────────────────────────

  Widget _buildMensaje(MensajeChat m) {
    final esUser = m.rol == RolMensaje.usuario;
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Row(
        mainAxisAlignment:
            esUser ? MainAxisAlignment.end : MainAxisAlignment.start,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (!esUser) ...[
            Container(
              padding: const EdgeInsets.all(6),
              decoration: BoxDecoration(
                  color: AppTheme.brandPrimary,
                  borderRadius: BorderRadius.circular(8)),
              child: const Icon(Icons.auto_awesome, color: Colors.white, size: 14),
            ),
            const SizedBox(width: 8),
          ],
          Flexible(
            child: Column(
              crossAxisAlignment:
                  esUser ? CrossAxisAlignment.end : CrossAxisAlignment.start,
              children: [
                // Burbuja de texto
                Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                  decoration: BoxDecoration(
                    color: esUser
                        ? AppTheme.brandPrimary
                        : AppTheme.brandSurface,
                    borderRadius: BorderRadius.only(
                      topLeft: const Radius.circular(16),
                      topRight: const Radius.circular(16),
                      bottomLeft: Radius.circular(esUser ? 16 : 4),
                      bottomRight: Radius.circular(esUser ? 4 : 16),
                    ),
                  ),
                  child: Text(m.contenido,
                      style: const TextStyle(color: Colors.white, fontSize: 14)),
                ),

                // Tarjetas de acción (solo en mensajes del asistente)
                if (!esUser) ...[
                  // Tarjeta de requisitos (tiene prioridad — incluye botón iniciar)
                  if (m.accion == 'MOSTRAR_REQUISITOS' && m.procesoId != null)
                    _buildTarjetaRequisitos(m),

                  // Botón Iniciar trámite: acción explícita O cualquier procesoId
                  // sin tarjeta de requisitos ya mostrada
                  if (m.procesoId != null && m.accion != 'MOSTRAR_REQUISITOS')
                    _buildBotonIniciar(m.procesoId!, m.procesoNombre),

                  // Botón catálogo
                  if (m.accion == 'CATALOGO_MANUAL' || m.accion == 'NO_RECONOCIDO')
                    _buildBotonCatalogo(),

                  // Candidatos alternativos
                  if (m.candidatosAlternativos != null &&
                      m.candidatosAlternativos!.isNotEmpty)
                    _buildCandidatos(m.candidatosAlternativos!),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }

  // ── Tarjeta: Iniciar trámite ───────────────────────────────────────────────

  Widget _buildBotonIniciar(String procesoId, String? nombre) {
    return Padding(
      padding: const EdgeInsets.only(top: 6),
      child: InkWell(
        onTap: () => _navegarATramite(procesoId),
        borderRadius: BorderRadius.circular(AppTheme.radius),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
          decoration: BoxDecoration(
            color: AppTheme.estadoVerde.withValues(alpha: 0.12),
            borderRadius: BorderRadius.circular(AppTheme.radius),
            border: Border.all(color: AppTheme.estadoVerde.withValues(alpha: 0.4)),
          ),
          child: Row(children: [
            const Icon(Icons.check_circle_rounded,
                color: AppTheme.estadoVerde, size: 16),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                nombre != null && nombre.isNotEmpty
                    ? 'Iniciar: $nombre'
                    : 'Iniciar trámite',
                style: const TextStyle(
                    color: AppTheme.estadoVerde,
                    fontSize: 13,
                    fontWeight: FontWeight.bold),
              ),
            ),
            const Icon(Icons.chevron_right_rounded,
                color: AppTheme.estadoVerde, size: 16),
          ]),
        ),
      ),
    );
  }

  // ── Tarjeta: Requisitos ────────────────────────────────────────────────────

  Widget _buildTarjetaRequisitos(MensajeChat m) {
    final reqs = m.requisitos ?? [];
    return Padding(
      padding: const EdgeInsets.only(top: 6),
      child: Container(
        decoration: BoxDecoration(
          color: AppTheme.brandSurface,
          borderRadius: BorderRadius.circular(AppTheme.radiusGrande),
          border: Border.all(color: AppTheme.brandBorder),
        ),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          // Cabecera
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
            decoration: BoxDecoration(
              color: Colors.indigo.withValues(alpha: 0.15),
              borderRadius: const BorderRadius.vertical(
                  top: Radius.circular(AppTheme.radiusGrande)),
              border: const Border(
                  bottom: BorderSide(
                      color: Color(0x33818CF8), width: 0.5)),
            ),
            child: Row(children: [
              const Icon(Icons.assignment_outlined,
                  color: Color(0xFF818CF8), size: 16),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  'Requisitos: ${m.procesoNombre ?? ''}',
                  style: const TextStyle(
                      color: Color(0xFF818CF8),
                      fontSize: 12,
                      fontWeight: FontWeight.bold),
                ),
              ),
            ]),
          ),

          if (reqs.isNotEmpty)
            ...reqs.map((r) => Padding(
                  padding: const EdgeInsets.symmetric(
                      horizontal: 14, vertical: 6),
                  child: Row(children: [
                    Icon(
                      r.requerido
                          ? Icons.circle
                          : Icons.radio_button_unchecked_rounded,
                      size: 8,
                      color: r.requerido
                          ? AppTheme.estadoRojo
                          : AppTheme.brandMuted,
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                        child: Text(r.etiqueta,
                            style: const TextStyle(
                                color: Colors.white, fontSize: 12))),
                    Container(
                      padding: const EdgeInsets.symmetric(
                          horizontal: 6, vertical: 2),
                      decoration: BoxDecoration(
                        color: AppTheme.brandBg,
                        borderRadius: BorderRadius.circular(4),
                      ),
                      child: Text(_tipoLabel(r.tipo),
                          style: const TextStyle(
                              color: AppTheme.brandMuted, fontSize: 10)),
                    ),
                  ]),
                ))
          else
            const Padding(
              padding: EdgeInsets.all(14),
              child: Text('Sin formulario configurado.',
                  style: TextStyle(
                      color: AppTheme.brandMuted,
                      fontSize: 12,
                      fontStyle: FontStyle.italic)),
            ),

          // Leyenda
          if (reqs.isNotEmpty)
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
              child: Row(children: [
                const Icon(Icons.circle, size: 8, color: AppTheme.estadoRojo),
                const SizedBox(width: 4),
                const Text('Obligatorio',
                    style: TextStyle(
                        color: AppTheme.brandMuted, fontSize: 10)),
                const SizedBox(width: 14),
                const Icon(Icons.radio_button_unchecked_rounded,
                    size: 8, color: AppTheme.brandMuted),
                const SizedBox(width: 4),
                const Text('Opcional',
                    style: TextStyle(
                        color: AppTheme.brandMuted, fontSize: 10)),
              ]),
            ),

          // Botón iniciar
          if (m.procesoId != null)
            Padding(
              padding: const EdgeInsets.fromLTRB(10, 4, 10, 10),
              child: InkWell(
                onTap: () => _navegarATramite(m.procesoId!),
                borderRadius: BorderRadius.circular(AppTheme.radius),
                child: Container(
                  padding: const EdgeInsets.symmetric(
                      horizontal: 14, vertical: 10),
                  decoration: BoxDecoration(
                    color: AppTheme.estadoVerde.withValues(alpha: 0.12),
                    borderRadius: BorderRadius.circular(AppTheme.radius),
                    border: Border.all(
                        color: AppTheme.estadoVerde.withValues(alpha: 0.4)),
                  ),
                  child: Row(children: [
                    const Icon(Icons.check_circle_rounded,
                        color: AppTheme.estadoVerde, size: 16),
                    const SizedBox(width: 8),
                    Expanded(
                        child: Text(
                            'Iniciar: ${m.procesoNombre ?? 'trámite'}',
                            style: const TextStyle(
                                color: AppTheme.estadoVerde,
                                fontSize: 13,
                                fontWeight: FontWeight.bold))),
                    const Icon(Icons.chevron_right_rounded,
                        color: AppTheme.estadoVerde, size: 16),
                  ]),
                ),
              ),
            ),
        ]),
      ),
    );
  }

  // ── Tarjeta: Ver catálogo ──────────────────────────────────────────────────

  Widget _buildBotonCatalogo() {
    return Padding(
      padding: const EdgeInsets.only(top: 6),
      child: InkWell(
        onTap: _navegarACatalogo,
        borderRadius: BorderRadius.circular(AppTheme.radius),
        child: Container(
          padding:
              const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
          decoration: BoxDecoration(
            color: Colors.blue.withValues(alpha: 0.10),
            borderRadius: BorderRadius.circular(AppTheme.radius),
            border:
                Border.all(color: Colors.blue.withValues(alpha: 0.35)),
          ),
          child: const Row(children: [
            Icon(Icons.list_alt_rounded, color: Colors.blueAccent, size: 16),
            SizedBox(width: 8),
            Expanded(
              child: Text('Ver catálogo de trámites',
                  style: TextStyle(
                      color: Colors.blueAccent,
                      fontSize: 13,
                      fontWeight: FontWeight.bold)),
            ),
            Icon(Icons.chevron_right_rounded,
                color: Colors.blueAccent, size: 16),
          ]),
        ),
      ),
    );
  }

  // ── Candidatos alternativos ────────────────────────────────────────────────

  Widget _buildCandidatos(List<CandidatoAlternativo> candidatos) {
    return Padding(
      padding: const EdgeInsets.only(top: 6),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        const Text('¿Quizás quisiste decir?',
            style: TextStyle(
                color: AppTheme.brandMuted,
                fontSize: 10,
                fontWeight: FontWeight.bold,
                letterSpacing: 1)),
        const SizedBox(height: 4),
        ...candidatos.map((c) => Padding(
              padding: const EdgeInsets.only(bottom: 4),
              child: InkWell(
                onTap: () => _navegarATramite(c.procesoId),
                borderRadius: BorderRadius.circular(AppTheme.radius),
                child: Container(
                  padding: const EdgeInsets.symmetric(
                      horizontal: 12, vertical: 8),
                  decoration: BoxDecoration(
                    color: AppTheme.brandSurface,
                    borderRadius: BorderRadius.circular(AppTheme.radius),
                    border:
                        Border.all(color: AppTheme.brandBorder),
                  ),
                  child: Row(children: [
                    const Icon(Icons.chevron_right_rounded,
                        color: AppTheme.brandMuted, size: 14),
                    const SizedBox(width: 6),
                    Expanded(
                        child: Text(c.nombre,
                            style: const TextStyle(
                                color: Colors.white, fontSize: 12))),
                    Container(
                      padding: const EdgeInsets.symmetric(
                          horizontal: 6, vertical: 2),
                      decoration: BoxDecoration(
                        color: AppTheme.brandBg,
                        borderRadius: BorderRadius.circular(4),
                      ),
                      child: Text(
                          '${(c.confianza * 100).toStringAsFixed(0)}%',
                          style: const TextStyle(
                              color: AppTheme.brandMuted, fontSize: 10)),
                    ),
                  ]),
                ),
              ),
            )),
      ]),
    );
  }

  // ── Loading bubble ─────────────────────────────────────────────────────────

  Widget _buildLoadingBubble() {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Container(
          padding: const EdgeInsets.all(6),
          decoration: BoxDecoration(
              color: AppTheme.brandPrimary,
              borderRadius: BorderRadius.circular(8)),
          child: const Icon(Icons.auto_awesome, color: Colors.white, size: 14),
        ),
        const SizedBox(width: 8),
        Container(
          padding:
              const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
          decoration: const BoxDecoration(
            color: AppTheme.brandSurface,
            borderRadius: BorderRadius.only(
              topLeft: Radius.circular(16),
              topRight: Radius.circular(16),
              bottomLeft: Radius.circular(4),
              bottomRight: Radius.circular(16),
            ),
          ),
          child: const SizedBox(
            width: 32, height: 14,
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                _Dot(delay: 0),
                _Dot(delay: 200),
                _Dot(delay: 400),
              ],
            ),
          ),
        ),
      ]),
    );
  }

  // ── Sugerencias ────────────────────────────────────────────────────────────

  Widget _buildSugerencias(List<String> lista) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      child: SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        child: Row(
          children: lista
              .map((s) => Padding(
                    padding: const EdgeInsets.only(right: 8),
                    child: _buildChipSugerencia(s),
                  ))
              .toList(),
        ),
      ),
    );
  }

  Widget _buildChipSugerencia(String texto, {bool ancho = false}) {
    return InkWell(
      onTap: _cargando ? null : () => _enviar(texto),
      borderRadius: BorderRadius.circular(20),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 9),
        decoration: BoxDecoration(
          color: AppTheme.brandSurface,
          borderRadius: BorderRadius.circular(20),
          border: Border.all(
              color: AppTheme.brandPrimary.withValues(alpha: 0.4)),
        ),
        child: Text(texto,
            style: const TextStyle(color: Colors.white, fontSize: 13)),
      ),
    );
  }

  // ── Input ──────────────────────────────────────────────────────────────────

  Widget _buildInput() {
    return Column(mainAxisSize: MainAxisSize.min, children: [
      // Banner escuchando
      if (_escuchando)
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
          decoration: BoxDecoration(
            color: AppTheme.estadoRojo.withValues(alpha: 0.1),
            border: const Border(
                top: BorderSide(color: AppTheme.brandBorder, width: 0.5)),
          ),
          child: Row(children: [
            const Icon(Icons.graphic_eq_rounded,
                color: AppTheme.estadoRojo, size: 14),
            const SizedBox(width: 8),
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text('Escuchando…',
                      style: TextStyle(
                          color: AppTheme.estadoRojo,
                          fontSize: 12,
                          fontWeight: FontWeight.w600)),
                  // Barra de nivel de audio
                  const SizedBox(height: 4),
                  ClipRRect(
                    borderRadius: BorderRadius.circular(2),
                    child: LinearProgressIndicator(
                      value: (_nivelSonido / 10).clamp(0.0, 1.0),
                      minHeight: 3,
                      backgroundColor:
                          AppTheme.estadoRojo.withValues(alpha: 0.2),
                      valueColor: const AlwaysStoppedAnimation<Color>(
                          AppTheme.estadoRojo),
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(width: 8),
            const Text('Pausa 2 s → envía',
                style: TextStyle(
                    color: AppTheme.brandMuted, fontSize: 10)),
          ]),
        ),

      // Fila de entrada
      Container(
        padding: const EdgeInsets.fromLTRB(12, 8, 12, 12),
        decoration: const BoxDecoration(
          color: AppTheme.brandSurface,
          border: Border(
              top: BorderSide(color: AppTheme.brandBorder, width: 0.5)),
        ),
        child: SafeArea(
          top: false,
          child: Row(children: [
            Expanded(
              child: TextField(
                controller: _inputCtrl,
                style: const TextStyle(color: Colors.white),
                textInputAction: TextInputAction.send,
                onSubmitted: (_) => _enviar(),
                decoration: InputDecoration(
                  hintText: _escuchando ? 'Hablando…' : 'Escribe tu pregunta…',
                  hintStyle: TextStyle(
                    color: _escuchando
                        ? AppTheme.estadoRojo.withValues(alpha: 0.7)
                        : AppTheme.brandMuted,
                  ),
                  filled: true,
                  fillColor: AppTheme.brandBg,
                  contentPadding: const EdgeInsets.symmetric(
                      horizontal: 16, vertical: 12),
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(24),
                    borderSide: BorderSide.none,
                  ),
                  enabledBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(24),
                    borderSide: BorderSide(
                      color: _escuchando
                          ? AppTheme.estadoRojo.withValues(alpha: 0.5)
                          : Colors.transparent,
                    ),
                  ),
                  focusedBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(24),
                    borderSide: BorderSide(
                      color: _escuchando
                          ? AppTheme.estadoRojo
                          : AppTheme.brandPrimary,
                    ),
                  ),
                ),
              ),
            ),
            const SizedBox(width: 8),

            // Micrófono
            if (_sttDisponible)
              AnimatedScale(
                scale: _escuchando
                    ? 1.0 + (_nivelSonido / 50).clamp(0.0, 0.25)
                    : 1.0,
                duration: const Duration(milliseconds: 100),
                child: Container(
                  decoration: BoxDecoration(
                    color: _escuchando
                        ? AppTheme.estadoRojo
                        : AppTheme.brandSurface,
                    shape: BoxShape.circle,
                    border: Border.all(
                      color: _escuchando
                          ? AppTheme.estadoRojo
                          : AppTheme.brandBorder,
                    ),
                  ),
                  child: IconButton(
                    icon: Icon(
                      _escuchando
                          ? Icons.stop_rounded
                          : Icons.mic_none_rounded,
                      color: _escuchando ? Colors.white : AppTheme.brandMuted,
                    ),
                    tooltip: _escuchando
                        ? 'Detener grabación'
                        : 'Hablar con el asistente',
                    onPressed: _cargando ? null : _toggleVoz,
                  ),
                ),
              ),
            if (_sttDisponible) const SizedBox(width: 8),

            // Enviar
            Container(
              decoration: const BoxDecoration(
                  color: AppTheme.brandPrimary, shape: BoxShape.circle),
              child: IconButton(
                icon: const Icon(Icons.send_rounded, color: Colors.white),
                onPressed: _cargando ? null : _enviar,
              ),
            ),
          ]),
        ),
      ),
    ]);
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  String _tipoLabel(String tipo) {
    const mapa = {
      'texto': 'Texto', 'textarea': 'Texto largo', 'email': 'Correo',
      'telefono': 'Teléfono', 'numero': 'Número', 'fecha': 'Fecha',
      'hora': 'Hora', 'si_no': 'Sí/No', 'seleccion': 'Lista',
      'radio': 'Opción', 'checkbox': 'Múltiple', 'archivo': 'Archivo',
      'imagen': 'Imagen', 'calificacion': 'Calificación',
    };
    return mapa[tipo] ?? tipo;
  }

  String _formatearFecha(DateTime fecha) {
    final ahora = DateTime.now();
    final diff = ahora.difference(fecha).inDays;
    final hora =
        '${fecha.hour.toString().padLeft(2, '0')}:${fecha.minute.toString().padLeft(2, '0')}';
    if (diff == 0) return 'Hoy, $hora';
    if (diff == 1) return 'Ayer, $hora';
    if (diff < 7)  return 'Hace $diff días';
    return '${fecha.day}/${fecha.month}/${fecha.year}';
  }
}

// ── Dot animado ────────────────────────────────────────────────────────────

class _Dot extends StatefulWidget {
  final int delay;
  const _Dot({required this.delay});

  @override
  State<_Dot> createState() => _DotState();
}

class _DotState extends State<_Dot> with SingleTickerProviderStateMixin {
  late AnimationController _ctrl;

  @override
  void initState() {
    super.initState();
    _ctrl = AnimationController(
        vsync: this, duration: const Duration(milliseconds: 600));
    Future.delayed(Duration(milliseconds: widget.delay), () {
      if (mounted) _ctrl.repeat(reverse: true);
    });
  }

  @override
  void dispose() { _ctrl.dispose(); super.dispose(); }

  @override
  Widget build(BuildContext context) {
    return FadeTransition(
      opacity: Tween<double>(begin: 0.3, end: 1.0).animate(_ctrl),
      child: Container(
        width: 6, height: 6,
        decoration: const BoxDecoration(
            color: AppTheme.brandMuted, shape: BoxShape.circle),
      ),
    );
  }
}
