import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';
import '../core/app_theme.dart';
import '../services/tramite_service.dart';
import '../core/api_config.dart';

class DetalleTramiteScreen extends StatefulWidget {
  final String tramiteId;
  const DetalleTramiteScreen({super.key, required this.tramiteId});

  @override
  State<DetalleTramiteScreen> createState() => _DetalleTramiteScreenState();
}

class _DetalleTramiteScreenState extends State<DetalleTramiteScreen>
    with SingleTickerProviderStateMixin {

  final TramiteService _service = TramiteService();
  late final TabController _tabCtrl;

  Map<String, dynamic>? _data;
  bool _isLoading = true;
  String? _errorMsg;

  @override
  void initState() {
    super.initState();
    _tabCtrl = TabController(length: 3, vsync: this);
    _cargar();
  }

  @override
  void dispose() {
    _tabCtrl.dispose();
    super.dispose();
  }

  Future<void> _cargar() async {
    setState(() { _isLoading = true; _errorMsg = null; });
    final data = await _service.obtenerDetalleTramite(widget.tramiteId);
    if (!mounted) return;
    setState(() {
      _data      = data;
      _isLoading = false;
      if (data == null) _errorMsg = 'No se pudo cargar el trámite.';
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppTheme.brandBg,
      appBar: AppBar(
        backgroundColor: AppTheme.brandSurface,
        title: Text(
          _data?['codigoSeguimiento'] ?? 'Detalle del Trámite',
          style: const TextStyle(color: Colors.white),
        ),
        iconTheme: const IconThemeData(color: Colors.white),
        elevation: 0,
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh_rounded, color: Colors.white),
            onPressed: _cargar,
          ),
        ],
        bottom: _data == null ? null : TabBar(
          controller: _tabCtrl,
          indicatorColor: AppTheme.brandPrimary,
          labelColor: AppTheme.brandPrimary,
          unselectedLabelColor: AppTheme.brandMuted,
          labelStyle: const TextStyle(fontSize: 12, fontWeight: FontWeight.bold),
          tabs: const [
            Tab(text: 'RESUMEN'),
            Tab(text: 'HISTORIAL'),
            Tab(text: 'DOCUMENTOS'),
          ],
        ),
      ),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator(color: AppTheme.brandPrimary))
          : _errorMsg != null
              ? _errorWidget()
              : TabBarView(
                  controller: _tabCtrl,
                  children: [
                    _tabResumen(),
                    _tabHistorial(),
                    _tabDocumentos(),
                  ],
                ),
    );
  }

  // ── Tab 1: Resumen ────────────────────────────────────────────────────────
  Widget _tabResumen() {
    final t      = _data!;
    final estado = t['estadoSemaforo'] ?? 'DESCONOCIDO';
    final color  = AppTheme.colorEstado(estado);

    return RefreshIndicator(
      color: AppTheme.brandPrimary, backgroundColor: AppTheme.brandSurface,
      onRefresh: _cargar,
      child: ListView(padding: const EdgeInsets.all(16), children: [
        // Estado grande
        Container(
          padding: const EdgeInsets.all(20),
          decoration: BoxDecoration(
            gradient: LinearGradient(
              colors: [color.withValues(alpha: 0.2), color.withValues(alpha: 0.05)],
              begin: Alignment.topLeft, end: Alignment.bottomRight,
            ),
            borderRadius: BorderRadius.circular(AppTheme.radiusGrande),
            border: Border.all(color: color.withValues(alpha: 0.4)),
          ),
          child: Row(children: [
            Icon(_iconEstado(estado), color: color, size: 36),
            const SizedBox(width: 16),
            Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(estado,
                style: TextStyle(color: color, fontSize: 18, fontWeight: FontWeight.bold)),
              const SizedBox(height: 4),
              Text(t['codigoSeguimiento'] ?? '—',
                style: const TextStyle(color: Colors.white70, fontSize: 13)),
            ])),
          ]),
        ),
        const SizedBox(height: 16),

        // Predicción ML (solo si el backend la devuelve)
        if (_tienePredML(t)) ...[
          _cardPrediccionML(t),
          const SizedBox(height: 16),
        ],

        // Info
        _seccion('Información del Trámite', [
          _fila('Proceso',      t['nombreProceso'] ?? t['codigoProceso'] ?? '—'),
          _fila('Descripción',  t['descripcion'] ?? '—'),
          _fila('Iniciado por', t['clienteId'] ?? '—'),
          _fila('Dpto. actual', t['departamentoActualId'] ?? 'Sistema'),
          _fila('Fecha inicio', _formatFecha(t['fechaCreacion'])),
          if (t['fechaActualizacion'] != null)
            _fila('Última act.', _formatFecha(t['fechaActualizacion'])),
        ]),
      ]),
    );
  }

  bool _tienePredML(Map<String, dynamic> t) =>
      t['nivelPrioridad'] != null || t['riesgoDemora'] != null;

  Widget _cardPrediccionML(Map<String, dynamic> t) {
    final nivel  = (t['nivelPrioridad'] ?? 'NORMAL').toString().toUpperCase();
    final riesgo = t['riesgoDemora'];
    final motivo = t['motivoPrediccion'] as String?;

    Color nivelColor;
    IconData nivelIcon;
    switch (nivel) {
      case 'CRITICO':
        nivelColor = AppTheme.estadoRojo;
        nivelIcon  = Icons.warning_amber_rounded;
        break;
      case 'ALTO':
        nivelColor = AppTheme.estadoAmbar;
        nivelIcon  = Icons.trending_up_rounded;
        break;
      default:
        nivelColor = AppTheme.estadoVerde;
        nivelIcon  = Icons.check_circle_outline_rounded;
    }

    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppTheme.brandSurface,
        borderRadius: BorderRadius.circular(AppTheme.radiusGrande),
        border: Border.all(color: nivelColor.withValues(alpha: 0.4)),
      ),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          Icon(Icons.psychology_rounded, color: AppTheme.brandPrimary, size: 14),
          const SizedBox(width: 6),
          const Text('PREDICCIÓN IA',
              style: TextStyle(color: AppTheme.brandPrimary,
                  fontSize: 11, fontWeight: FontWeight.bold, letterSpacing: 1.2)),
        ]),
        const SizedBox(height: 12),
        Row(children: [
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
            decoration: BoxDecoration(
              color: nivelColor.withValues(alpha: 0.12),
              borderRadius: BorderRadius.circular(20),
              border: Border.all(color: nivelColor.withValues(alpha: 0.4)),
            ),
            child: Row(mainAxisSize: MainAxisSize.min, children: [
              Icon(nivelIcon, color: nivelColor, size: 14),
              const SizedBox(width: 5),
              Text('Prioridad $nivel',
                  style: TextStyle(color: nivelColor, fontSize: 11,
                      fontWeight: FontWeight.bold)),
            ]),
          ),
          if (riesgo != null) ...[
            const SizedBox(width: 10),
            Text('Riesgo demora: ${(riesgo * 100).toStringAsFixed(0)}%',
                style: const TextStyle(color: AppTheme.brandMuted, fontSize: 11)),
          ],
        ]),
        if (motivo != null && motivo.isNotEmpty) ...[
          const SizedBox(height: 8),
          Text(motivo,
              style: const TextStyle(color: Colors.white70, fontSize: 11,
                  fontStyle: FontStyle.italic)),
        ],
      ]),
    );
  }

  // ── Tab 2: Historial ──────────────────────────────────────────────────────
  Widget _tabHistorial() {
    final historial = (_data?['historial'] as List?) ?? [];

    if (historial.isEmpty) {
      return const Center(child: Text('Sin historial disponible.',
        style: TextStyle(color: AppTheme.brandMuted)));
    }

    return RefreshIndicator(
      color: AppTheme.brandPrimary, backgroundColor: AppTheme.brandSurface,
      onRefresh: _cargar,
      child: ListView.builder(
        padding: const EdgeInsets.all(16),
        itemCount: historial.length,
        itemBuilder: (_, i) => _timelineNode(historial[i], i, historial.length),
      ),
    );
  }

  // ── Tab 3: Documentos ─────────────────────────────────────────────────────
  Widget _tabDocumentos() {
    final archivos = (_data?['archivos'] as List?) ?? [];

    if (archivos.isEmpty) {
      return Center(child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
        const Icon(Icons.folder_open_rounded, size: 60, color: AppTheme.brandMuted),
        const SizedBox(height: 16),
        const Text('Sin documentos adjuntos',
          style: TextStyle(color: Colors.white, fontSize: 15, fontWeight: FontWeight.bold)),
        const SizedBox(height: 8),
        const Text('Los archivos adjuntos al trámite aparecerán aquí',
          style: TextStyle(color: AppTheme.brandMuted, fontSize: 13)),
      ]));
    }

    return RefreshIndicator(
      color: AppTheme.brandPrimary, backgroundColor: AppTheme.brandSurface,
      onRefresh: _cargar,
      child: ListView.builder(
        padding: const EdgeInsets.all(16),
        itemCount: archivos.length,
        itemBuilder: (_, i) => _tarjetaArchivo(archivos[i]),
      ),
    );
  }

  Widget _tarjetaArchivo(Map<String, dynamic> archivo) {
    final nombre    = archivo['nombreOriginal'] ?? 'Archivo';
    final versiones = (archivo['versiones'] as List?) ?? [];
    final ultimaUrl = versiones.isNotEmpty
        ? versiones.last['url'] ?? ''
        : archivo['url'] ?? '';
    final tamano    = versiones.isNotEmpty
        ? versiones.last['tamano']
        : archivo['tamano'];

    return Card(
      color: AppTheme.brandSurface,
      margin: const EdgeInsets.only(bottom: 10),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(AppTheme.radius)),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Row(children: [
          Container(
            width: 44, height: 44,
            decoration: BoxDecoration(
              color: AppTheme.brandPrimary.withValues(alpha: 0.12),
              borderRadius: BorderRadius.circular(10),
            ),
            child: Icon(_iconArchivo(nombre), color: AppTheme.brandPrimary, size: 22),
          ),
          const SizedBox(width: 12),
          Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(nombre,
              style: const TextStyle(color: Colors.white, fontSize: 13, fontWeight: FontWeight.w600),
              maxLines: 2, overflow: TextOverflow.ellipsis),
            const SizedBox(height: 3),
            Row(children: [
              if (tamano != null)
                Text(_formatTamano(tamano),
                  style: const TextStyle(color: AppTheme.brandMuted, fontSize: 11)),
              if (versiones.length > 1) ...[
                const SizedBox(width: 8),
                Text('v${versiones.length}',
                  style: const TextStyle(color: AppTheme.brandMuted, fontSize: 10)),
              ],
            ]),
          ])),
          if (ultimaUrl.isNotEmpty)
            _esImagen(nombre)
                ? IconButton(
                    icon: const Icon(Icons.image_search_rounded,
                        color: AppTheme.brandPrimary),
                    tooltip: 'Ver imagen',
                    onPressed: () => _verImagen(ultimaUrl),
                  )
                : IconButton(
                    icon: const Icon(Icons.open_in_new_rounded,
                        color: AppTheme.brandPrimary),
                    tooltip: 'Abrir / Descargar',
                    onPressed: () => _abrirUrl(ultimaUrl),
                  ),
        ]),
      ),
    );
  }

  // ── Helpers de UI ─────────────────────────────────────────────────────────
  Widget _seccion(String titulo, List<Widget> filas) {
    return Card(
      color: AppTheme.brandSurface,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(AppTheme.radiusGrande)),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(titulo, style: const TextStyle(color: AppTheme.brandPrimary,
            fontSize: 11, fontWeight: FontWeight.bold, letterSpacing: 1.2)),
          const SizedBox(height: 12),
          ...filas,
        ]),
      ),
    );
  }

  Widget _fila(String label, String valor) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        SizedBox(width: 110, child: Text(label,
          style: const TextStyle(color: AppTheme.brandMuted, fontSize: 12))),
        Expanded(child: Text(valor,
          style: const TextStyle(color: Colors.white, fontSize: 12, fontWeight: FontWeight.w600))),
      ]),
    );
  }

  Widget _timelineNode(Map<String, dynamic> log, int i, int total) {
    final accion = (log['accion'] ?? '').toUpperCase();
    final color  = _colorAccion(accion);
    final icon   = _iconAccion(accion);

    return IntrinsicHeight(
      child: Row(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        SizedBox(width: 36, child: Column(children: [
          Container(width: 2, height: 16,
            color: i == 0 ? Colors.transparent : AppTheme.brandBorder),
          Icon(icon, color: color, size: 22),
          Expanded(child: Container(width: 2,
            color: i == total - 1 ? Colors.transparent : AppTheme.brandBorder)),
        ])),
        const SizedBox(width: 12),
        Expanded(child: Padding(
          padding: const EdgeInsets.only(bottom: 24, top: 2),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(accion, style: TextStyle(color: color, fontWeight: FontWeight.bold, fontSize: 13)),
            const SizedBox(height: 2),
            if (log['departamentoId'] != null)
              Text('${log['departamentoId']}',
                style: const TextStyle(color: Colors.white70, fontSize: 12)),
            if (log['comentario'] != null && log['comentario'].toString().isNotEmpty)
              Container(
                margin: const EdgeInsets.only(top: 6),
                padding: const EdgeInsets.all(8),
                decoration: BoxDecoration(
                  color: AppTheme.brandBorder.withValues(alpha: 0.3),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Text(log['comentario'],
                  style: const TextStyle(color: Colors.white70, fontSize: 11,
                    fontStyle: FontStyle.italic)),
              ),
            const SizedBox(height: 4),
            Text(_formatFecha(log['fecha']),
              style: const TextStyle(color: AppTheme.brandMuted, fontSize: 10)),
          ]),
        )),
      ]),
    );
  }

  static const _extImagen = {'jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp'};

  bool _esImagen(String nombre) {
    final ext = nombre.split('.').last.toLowerCase();
    return _extImagen.contains(ext);
  }

  void _verImagen(String url) {
    final uri = url.startsWith('http') ? url : ApiConfig.archivoVer(url);
    showDialog(
      context: context,
      builder: (_) => Dialog(
        backgroundColor: Colors.black,
        insetPadding: EdgeInsets.zero,
        child: Stack(children: [
          Center(
            child: InteractiveViewer(
              child: Image.network(
                uri,
                fit: BoxFit.contain,
                loadingBuilder: (_, child, progress) => progress == null
                    ? child
                    : const Center(
                        child: CircularProgressIndicator(
                            color: AppTheme.brandPrimary)),
                errorBuilder: (_, __, ___) => const Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Icon(Icons.broken_image_rounded,
                        color: AppTheme.brandMuted, size: 48),
                    SizedBox(height: 8),
                    Text('No se pudo cargar la imagen',
                        style: TextStyle(color: AppTheme.brandMuted)),
                  ],
                ),
              ),
            ),
          ),
          Positioned(
            top: 12, right: 12,
            child: IconButton(
              icon: const Icon(Icons.close_rounded, color: Colors.white),
              onPressed: () => Navigator.pop(context),
            ),
          ),
        ]),
      ),
    );
  }

  void _abrirUrl(String url) async {
    final uri = Uri.parse(
      url.startsWith('http') ? url : ApiConfig.archivoVer(url),
    );
    try {
      // inAppBrowserView usa Chrome Custom Tabs en Android, que soporta PDF,
      // imágenes y web sin necesitar una app externa instalada.
      final ok = await launchUrl(uri, mode: LaunchMode.inAppBrowserView);
      if (!ok && mounted) {
        // Último recurso: intenta abrir en app externa
        await launchUrl(uri, mode: LaunchMode.externalApplication);
      }
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('No se pudo abrir el archivo'),
            backgroundColor: AppTheme.estadoRojo,
          ),
        );
      }
    }
  }

  Widget _errorWidget() {
    return Center(child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
      const Icon(Icons.error_outline_rounded, size: 60, color: AppTheme.estadoRojo),
      const SizedBox(height: 16),
      Text(_errorMsg!, style: const TextStyle(color: Colors.redAccent, fontSize: 14),
        textAlign: TextAlign.center),
      const SizedBox(height: 16),
      ElevatedButton.icon(
        style: AppTheme.botonPrimario(),
        onPressed: _cargar,
        icon: const Icon(Icons.refresh_rounded),
        label: const Text('Reintentar'),
      ),
    ]));
  }

  IconData _iconEstado(String e) {
    switch (e.toUpperCase()) {
      case 'COMPLETADO': case 'APROBADO': return Icons.check_circle_rounded;
      case 'RECHAZADO':  return Icons.cancel_rounded;
      case 'EN_PROCESO': case 'EN_REVISION': return Icons.hourglass_top_rounded;
      default: return Icons.pending_rounded;
    }
  }

  Color _colorAccion(String a) {
    if (a == 'INICIADO' || a == 'APROBADO' || a == 'COMPLETADO') return AppTheme.estadoVerde;
    if (a == 'RECHAZADO') return AppTheme.estadoRojo;
    if (a == 'EN_REVISION' || a == 'EN_PROCESO') return AppTheme.estadoAmbar;
    return AppTheme.brandMuted;
  }

  IconData _iconAccion(String a) {
    if (a == 'INICIADO') return Icons.play_circle_rounded;
    if (a == 'APROBADO' || a == 'COMPLETADO') return Icons.check_circle_rounded;
    if (a == 'RECHAZADO') return Icons.cancel_rounded;
    return Icons.pending_rounded;
  }

  IconData _iconArchivo(String nombre) {
    final ext = nombre.split('.').last.toLowerCase();
    if (['jpg','jpeg','png','webp','gif'].contains(ext)) return Icons.image_rounded;
    if (['pdf'].contains(ext)) return Icons.picture_as_pdf_rounded;
    if (['doc','docx'].contains(ext)) return Icons.article_rounded;
    if (['xls','xlsx'].contains(ext)) return Icons.table_chart_rounded;
    return Icons.attach_file_rounded;
  }

  String _formatTamano(dynamic tamano) {
    if (tamano == null) return '';
    final bytes = (tamano as num).toDouble();
    if (bytes < 1024) return '${bytes.toInt()} B';
    if (bytes < 1024 * 1024) return '${(bytes / 1024).toStringAsFixed(1)} KB';
    return '${(bytes / (1024 * 1024)).toStringAsFixed(1)} MB';
  }

  String _formatFecha(dynamic fecha) {
    if (fecha == null) return '';
    try {
      final dt = DateTime.parse(fecha.toString()).toLocal();
      return '${dt.day}/${dt.month}/${dt.year} ${dt.hour.toString().padLeft(2,'0')}:${dt.minute.toString().padLeft(2,'0')}';
    } catch (_) { return fecha.toString(); }
  }
}
