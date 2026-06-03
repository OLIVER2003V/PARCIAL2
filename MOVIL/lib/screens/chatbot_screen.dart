// 👇 NUEVO CU17 — Asistente IA para el Cliente
//
// Pantalla completa de chat conversacional contra el endpoint
// /api/ia/chatbot-cliente del backend. Usa Gemini en el servidor.
//
// Features:
//  - Bubbles diferenciados por rol (usuario / asistente)
//  - Loading dots mientras la IA piensa
//  - Sugerencias rápidas iniciales y dinámicas (devueltas por la IA)
//  - Botón "Nueva conversación" para limpiar historial
//  - Auto-scroll al fondo cuando entra mensaje nuevo

import 'package:flutter/material.dart';
import '../core/app_theme.dart';
import '../models/mensaje_chat.dart';
import '../services/chatbot_service.dart';

class ChatbotScreen extends StatefulWidget {
  const ChatbotScreen({super.key});

  @override
  State<ChatbotScreen> createState() => _ChatbotScreenState();
}

class _ChatbotScreenState extends State<ChatbotScreen> {
  final ChatbotService _chatbotService = ChatbotService();
  final TextEditingController _inputController = TextEditingController();
  final ScrollController _scrollController = ScrollController();

  bool _cargando = false;
  List<String> _sugerenciasActuales = [];

  // 👇 NUEVO Sugerencias iniciales (alineadas con el frontend web)
  final List<String> _sugerenciasIniciales = [
    '¿Qué trámites puedo solicitar?',
    '¿Cómo va el estado de mis trámites?',
    '¿Cómo inicio un nuevo trámite?',
    '¿Qué documentos necesito?',
  ];

  @override
  void dispose() {
    _inputController.dispose();
    _scrollController.dispose();
    super.dispose();
  }

  Future<void> _enviar([String? mensajeForzado]) async {
    final texto = (mensajeForzado ?? _inputController.text).trim();
    if (texto.isEmpty || _cargando) return;

    // 1) Mostrar el mensaje del usuario inmediatamente
    setState(() {
      _chatbotService.agregarMensaje(RolMensaje.usuario, texto);
      _inputController.clear();
      _sugerenciasActuales = [];
      _cargando = true;
    });
    _scrollAlFondo();

    // 2) Llamar al backend
    final respuesta = await _chatbotService.enviar(texto);

    if (!mounted) return;

    setState(() {
      if (respuesta != null) {
        _chatbotService.agregarMensaje(
          RolMensaje.asistente,
          respuesta.respuesta,
        );
        _sugerenciasActuales = respuesta.sugerenciasRapidas;
      } else {
        _chatbotService.agregarMensaje(
          RolMensaje.asistente,
          '⚠️ No pude procesar tu mensaje. Intenta de nuevo en unos segundos.',
        );
      }
      _cargando = false;
    });
    _scrollAlFondo();
  }

  void _scrollAlFondo() {
    // Le damos un frame para que el ListView pinte el nuevo mensaje
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scrollController.hasClients) {
        _scrollController.animateTo(
          _scrollController.position.maxScrollExtent,
          duration: const Duration(milliseconds: 250),
          curve: Curves.easeOut,
        );
      }
    });
  }

  void _limpiarConversacion() {
    setState(() {
      _chatbotService.limpiar();
      _sugerenciasActuales = [];
    });
  }

  @override
  Widget build(BuildContext context) {
    final mensajes = _chatbotService.mensajes;
    final mostrarSugerenciasIniciales = mensajes.isEmpty && !_cargando;

    return Scaffold(
      backgroundColor: AppTheme.brandBg,
      appBar: AppBar(
        backgroundColor: AppTheme.brandSurface,
        iconTheme: const IconThemeData(color: Colors.white),
        title: Row(
          children: [
            Container(
              padding: const EdgeInsets.all(6),
              decoration: BoxDecoration(
                color: AppTheme.brandPrimary,
                borderRadius: BorderRadius.circular(8),
              ),
              child: const Icon(Icons.auto_awesome,
                  color: Colors.white, size: 18),
            ),
            const SizedBox(width: 10),
            const Text(
              'Asistente IA',
              style: TextStyle(
                color: Colors.white,
                fontSize: 16,
                fontWeight: FontWeight.bold,
              ),
            ),
          ],
        ),
        actions: [
          if (mensajes.isNotEmpty)
            IconButton(
              icon: const Icon(Icons.refresh, color: Colors.white),
              tooltip: 'Nueva conversación',
              onPressed: _limpiarConversacion,
            ),
        ],
      ),
      body: Column(
        children: [
          // ZONA DE MENSAJES
          Expanded(
            child: mostrarSugerenciasIniciales
                ? _buildBienvenida()
                : ListView.builder(
                    controller: _scrollController,
                    padding: const EdgeInsets.all(16),
                    itemCount: mensajes.length + (_cargando ? 1 : 0),
                    itemBuilder: (context, index) {
                      // Último item = indicador de "escribiendo..." si está cargando
                      if (_cargando && index == mensajes.length) {
                        return _buildLoadingBubble();
                      }
                      return _buildMensaje(mensajes[index]);
                    },
                  ),
          ),

          // SUGERENCIAS DINÁMICAS (después de cada respuesta de la IA)
          if (_sugerenciasActuales.isNotEmpty && !_cargando)
            _buildSugerencias(_sugerenciasActuales),

          // INPUT
          _buildInput(),
        ],
      ),
    );
  }

  // ============================================================================
  //  WIDGETS DE UI
  // ============================================================================

  Widget _buildBienvenida() {
    return SingleChildScrollView(
      padding: const EdgeInsets.all(24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const SizedBox(height: 40),
          Center(
            child: Container(
              padding: const EdgeInsets.all(20),
              decoration: BoxDecoration(
                color: AppTheme.brandPrimary.withValues(alpha: 0.15),
                shape: BoxShape.circle,
              ),
              child: const Icon(
                Icons.auto_awesome,
                color: AppTheme.brandPrimary,
                size: 48,
              ),
            ),
          ),
          const SizedBox(height: 24),
          const Text(
            '¡Hola! Soy tu asistente',
            textAlign: TextAlign.center,
            style: TextStyle(
              color: Colors.white,
              fontSize: 22,
              fontWeight: FontWeight.bold,
            ),
          ),
          const SizedBox(height: 8),
          const Text(
            'Puedo ayudarte con información sobre trámites, '
            'estados de tus solicitudes y documentos requeridos.',
            textAlign: TextAlign.center,
            style: TextStyle(
              color: AppTheme.brandMuted,
              fontSize: 14,
            ),
          ),
          const SizedBox(height: 32),
          const Text(
            'Prueba con:',
            style: TextStyle(
              color: AppTheme.brandMuted,
              fontSize: 13,
              fontWeight: FontWeight.bold,
            ),
          ),
          const SizedBox(height: 12),
          ..._sugerenciasIniciales.map((s) => Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: _buildChipSugerencia(s),
              )),
        ],
      ),
    );
  }

  Widget _buildMensaje(MensajeChat m) {
    final esUsuario = m.rol == RolMensaje.usuario;
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Row(
        mainAxisAlignment:
            esUsuario ? MainAxisAlignment.end : MainAxisAlignment.start,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (!esUsuario) ...[
            Container(
              padding: const EdgeInsets.all(6),
              decoration: BoxDecoration(
                color: AppTheme.brandPrimary,
                borderRadius: BorderRadius.circular(8),
              ),
              child: const Icon(Icons.auto_awesome,
                  color: Colors.white, size: 14),
            ),
            const SizedBox(width: 8),
          ],
          Flexible(
            child: Container(
              padding: const EdgeInsets.symmetric(
                  horizontal: 14, vertical: 10),
              decoration: BoxDecoration(
                color: esUsuario
                    ? AppTheme.brandPrimary
                    : AppTheme.brandSurface,
                borderRadius: BorderRadius.only(
                  topLeft: const Radius.circular(16),
                  topRight: const Radius.circular(16),
                  bottomLeft: Radius.circular(esUsuario ? 16 : 4),
                  bottomRight: Radius.circular(esUsuario ? 4 : 16),
                ),
              ),
              child: Text(
                m.contenido,
                style: const TextStyle(color: Colors.white, fontSize: 14),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildLoadingBubble() {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            padding: const EdgeInsets.all(6),
            decoration: BoxDecoration(
              color: AppTheme.brandPrimary,
              borderRadius: BorderRadius.circular(8),
            ),
            child: const Icon(Icons.auto_awesome,
                color: Colors.white, size: 14),
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
              width: 32,
              height: 14,
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
        ],
      ),
    );
  }

  Widget _buildSugerencias(List<String> sugerencias) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      child: SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        child: Row(
          children: sugerencias
              .map((s) => Padding(
                    padding: const EdgeInsets.only(right: 8),
                    child: _buildChipSugerencia(s),
                  ))
              .toList(),
        ),
      ),
    );
  }

  Widget _buildChipSugerencia(String texto) {
    return InkWell(
      onTap: _cargando ? null : () => _enviar(texto),
      borderRadius: BorderRadius.circular(20),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
        decoration: BoxDecoration(
          color: AppTheme.brandSurface,
          borderRadius: BorderRadius.circular(20),
          border: Border.all(
            color: AppTheme.brandPrimary.withValues(alpha: 0.4),
          ),
        ),
        child: Text(
          texto,
          style: const TextStyle(color: Colors.white, fontSize: 13),
        ),
      ),
    );
  }

  Widget _buildInput() {
    return Container(
      padding: const EdgeInsets.fromLTRB(12, 8, 12, 12),
      decoration: const BoxDecoration(
        color: AppTheme.brandSurface,
        border: Border(
          top: BorderSide(color: AppTheme.brandBorder, width: 0.5),
        ),
      ),
      child: SafeArea(
        top: false,
        child: Row(
          children: [
            Expanded(
              child: TextField(
                controller: _inputController,
                style: const TextStyle(color: Colors.white),
                textInputAction: TextInputAction.send,
                onSubmitted: (_) => _enviar(),
                decoration: InputDecoration(
                  hintText: 'Escribe tu pregunta...',
                  hintStyle: const TextStyle(color: AppTheme.brandMuted),
                  filled: true,
                  fillColor: AppTheme.brandBg,
                  contentPadding: const EdgeInsets.symmetric(
                      horizontal: 16, vertical: 12),
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(24),
                    borderSide: BorderSide.none,
                  ),
                ),
              ),
            ),
            const SizedBox(width: 8),
            Container(
              decoration: BoxDecoration(
                color: AppTheme.brandPrimary,
                shape: BoxShape.circle,
              ),
              child: IconButton(
                icon: const Icon(Icons.send, color: Colors.white),
                onPressed: _cargando ? null : () => _enviar(),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

// 👇 NUEVO Loading dot animado para el "escribiendo..."
class _Dot extends StatefulWidget {
  final int delay;
  const _Dot({required this.delay});

  @override
  State<_Dot> createState() => _DotState();
}

class _DotState extends State<_Dot> with SingleTickerProviderStateMixin {
  late AnimationController _controller;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 600),
    );
    Future.delayed(Duration(milliseconds: widget.delay), () {
      if (mounted) _controller.repeat(reverse: true);
    });
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return FadeTransition(
      opacity: Tween<double>(begin: 0.3, end: 1.0).animate(_controller),
      child: Container(
        width: 6,
        height: 6,
        decoration: const BoxDecoration(
          color: AppTheme.brandMuted,
          shape: BoxShape.circle,
        ),
      ),
    );
  }
}