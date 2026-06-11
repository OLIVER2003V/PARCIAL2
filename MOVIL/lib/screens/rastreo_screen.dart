import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../core/app_theme.dart';
import '../services/tramite_service.dart';

class RastreoScreen extends StatefulWidget {
  const RastreoScreen({super.key});

  @override
  State<RastreoScreen> createState() => _RastreoScreenState();
}

class _RastreoScreenState extends State<RastreoScreen> {
  final _searchCtrl    = TextEditingController();
  final TramiteService _service = TramiteService();

  bool    _isLoading   = false;
  Map<String, dynamic>? _tramiteData;
  String? _errorMsg;
  List<String> _recientes = [];

  static const _keyRecientes = 'rastreo_recientes';
  static const _maxRecientes = 5;

  @override
  void initState() {
    super.initState();
    _cargarRecientes();
  }

  @override
  void dispose() {
    _searchCtrl.dispose();
    super.dispose();
  }

  Future<void> _cargarRecientes() async {
    final prefs = await SharedPreferences.getInstance();
    final lista = prefs.getStringList(_keyRecientes) ?? [];
    if (mounted) setState(() => _recientes = lista);
  }

  Future<void> _guardarReciente(String codigo) async {
    final prefs = await SharedPreferences.getInstance();
    final lista = prefs.getStringList(_keyRecientes) ?? [];
    lista.remove(codigo);
    lista.insert(0, codigo);
    if (lista.length > _maxRecientes) lista.removeLast();
    await prefs.setStringList(_keyRecientes, lista);
    if (mounted) setState(() => _recientes = List.from(lista));
  }

  Future<void> _borrarRecientes() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_keyRecientes);
    if (mounted) setState(() => _recientes = []);
  }

  Future<void> _buscar([String? codigoForzado]) async {
    final codigo = (codigoForzado ?? _searchCtrl.text).trim().toUpperCase();
    if (codigo.isEmpty) return;

    _searchCtrl.text = codigo;
    setState(() { _isLoading = true; _errorMsg = null; _tramiteData = null; });

    final data = await _service.rastrearTramite(codigo);

    if (data != null) await _guardarReciente(codigo);

    setState(() {
      _isLoading = false;
      _tramiteData = data;
      if (data == null) _errorMsg = 'Trámite "$codigo" no encontrado.';
    });
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        // Buscador
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
          child: Row(children: [
            Expanded(
              child: TextField(
                controller: _searchCtrl,
                style: const TextStyle(color: Colors.white),
                textCapitalization: TextCapitalization.characters,
                textInputAction: TextInputAction.search,
                onSubmitted: (_) => _buscar(),
                decoration: InputDecoration(
                  hintText: 'Ej: TRM-ABC123',
                  hintStyle: const TextStyle(color: AppTheme.brandMuted),
                  prefixIcon: const Icon(Icons.qr_code_scanner_rounded,
                      color: AppTheme.brandMuted),
                  filled: true,
                  fillColor: AppTheme.brandSurface,
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(AppTheme.radius),
                    borderSide: BorderSide.none,
                  ),
                ),
              ),
            ),
            const SizedBox(width: 10),
            SizedBox(
              height: 52, width: 52,
              child: ElevatedButton(
                style: ElevatedButton.styleFrom(
                  backgroundColor: AppTheme.brandPrimary,
                  padding: EdgeInsets.zero,
                  shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(AppTheme.radius)),
                ),
                onPressed: _isLoading ? null : () => _buscar(),
                child: _isLoading
                    ? const SizedBox(
                        width: 20, height: 20,
                        child: CircularProgressIndicator(
                            color: Colors.white, strokeWidth: 2))
                    : const Icon(Icons.arrow_forward_rounded,
                        color: Colors.white),
              ),
            ),
          ]),
        ),

        // Búsquedas recientes (solo cuando no hay resultados)
        if (_recientes.isNotEmpty && _tramiteData == null && !_isLoading)
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(children: [
                  const Text('Recientes',
                      style: TextStyle(
                          color: AppTheme.brandMuted,
                          fontSize: 11,
                          fontWeight: FontWeight.bold,
                          letterSpacing: 1.1)),
                  const Spacer(),
                  GestureDetector(
                    onTap: _borrarRecientes,
                    child: const Text('Borrar',
                        style: TextStyle(
                            color: AppTheme.brandMuted, fontSize: 11)),
                  ),
                ]),
                const SizedBox(height: 6),
                Wrap(
                  spacing: 8,
                  runSpacing: 6,
                  children: _recientes.map((codigo) => GestureDetector(
                    onTap: () => _buscar(codigo),
                    child: Container(
                      padding: const EdgeInsets.symmetric(
                          horizontal: 12, vertical: 6),
                      decoration: BoxDecoration(
                        color: AppTheme.brandSurface,
                        borderRadius: BorderRadius.circular(20),
                        border: Border.all(color: AppTheme.brandBorder),
                      ),
                      child: Row(mainAxisSize: MainAxisSize.min, children: [
                        const Icon(Icons.history_rounded,
                            size: 13, color: AppTheme.brandMuted),
                        const SizedBox(width: 5),
                        Text(codigo,
                            style: const TextStyle(
                                color: Colors.white, fontSize: 12)),
                      ]),
                    ),
                  )).toList(),
                ),
              ],
            ),
          ),

        Expanded(
          child: _isLoading
              ? const Center(
                  child: CircularProgressIndicator(
                      color: AppTheme.brandPrimary))
              : _errorMsg != null
                  ? _errorWidget()
                  : _tramiteData == null
                      ? _instrucciones()
                      : _resultadoWidget(),
        ),
      ],
    );
  }

  // ── Estado inicial (sin búsqueda) ─────────────────────────────────────────
  Widget _instrucciones() {
    return Center(
      child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
        Container(
          width: 90, height: 90,
          decoration: BoxDecoration(
            color: AppTheme.brandSurface,
            borderRadius: BorderRadius.circular(28),
          ),
          child: const Icon(Icons.track_changes_rounded,
            size: 48, color: AppTheme.brandPrimary),
        ),
        const SizedBox(height: 20),
        const Text('Rastrear solicitud',
          style: TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold)),
        const SizedBox(height: 8),
        const Padding(
          padding: EdgeInsets.symmetric(horizontal: 40),
          child: Text(
            'Ingresa el código de seguimiento que recibiste al iniciar tu trámite',
            style: TextStyle(color: AppTheme.brandMuted, fontSize: 13),
            textAlign: TextAlign.center,
          ),
        ),
      ]),
    );
  }

  // ── Error ─────────────────────────────────────────────────────────────────
  Widget _errorWidget() {
    return Center(child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
      const Icon(Icons.search_off_rounded, size: 64, color: AppTheme.estadoRojo),
      const SizedBox(height: 16),
      Text(_errorMsg!, style: const TextStyle(color: Colors.redAccent, fontSize: 15),
        textAlign: TextAlign.center),
      const SizedBox(height: 16),
      TextButton(
        onPressed: () => setState(() { _errorMsg = null; _searchCtrl.clear(); }),
        child: const Text('Intentar de nuevo', style: TextStyle(color: AppTheme.brandPrimary)),
      ),
    ]));
  }

  // ── Resultado completo ────────────────────────────────────────────────────
  Widget _resultadoWidget() {
    final t       = _tramiteData!;
    final estado  = t['estadoSemaforo'] ?? 'DESCONOCIDO';
    final color   = AppTheme.colorEstado(estado);
    final historial = (t['historial'] as List?) ?? [];

    return RefreshIndicator(
      color: AppTheme.brandPrimary,
      backgroundColor: AppTheme.brandSurface,
      onRefresh: _buscar,
      child: ListView(
        padding: const EdgeInsets.symmetric(horizontal: 16),
        children: [
          // Card resumen
          Card(
            color: AppTheme.brandSurface,
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(AppTheme.radiusGrande)),
            child: Padding(
              padding: const EdgeInsets.all(18),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
                  Text(t['codigoSeguimiento'] ?? '—',
                    style: const TextStyle(color: AppTheme.brandPrimary,
                      fontSize: 18, fontWeight: FontWeight.bold)),
                  _badge(estado, color),
                ]),
                const SizedBox(height: 10),
                Text(t['descripcion'] ?? 'Sin descripción',
                  style: const TextStyle(color: Colors.white, fontSize: 13)),
                const SizedBox(height: 10),
                _infoRow(Icons.business_outlined, 'Departamento actual',
                  t['departamentoActualId'] ?? 'Sistema'),
                const SizedBox(height: 6),
                _infoRow(Icons.calendar_today_outlined, 'Iniciado',
                  _formatFecha(t['fechaCreacion'])),
              ]),
            ),
          ),
          const SizedBox(height: 20),

          // Timeline
          if (historial.isNotEmpty) ...[
            const Text('Historial',
              style: TextStyle(color: AppTheme.brandPrimary, fontSize: 12,
                fontWeight: FontWeight.bold, letterSpacing: 1.2)),
            const SizedBox(height: 12),
            ...historial.asMap().entries.map((e) =>
              _timelineNode(e.value, e.key, historial.length)),
          ] else
            const Center(child: Padding(
              padding: EdgeInsets.all(24),
              child: Text('Trámite iniciado, esperando procesamiento.',
                style: TextStyle(color: AppTheme.brandMuted)),
            )),

          const SizedBox(height: 32),
        ],
      ),
    );
  }

  Widget _badge(String estado, Color color) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: color.withValues(alpha: 0.4)),
      ),
      child: Row(mainAxisSize: MainAxisSize.min, children: [
        Container(width: 7, height: 7,
          decoration: BoxDecoration(color: color, shape: BoxShape.circle)),
        const SizedBox(width: 6),
        Text(estado, style: TextStyle(color: color, fontSize: 11, fontWeight: FontWeight.bold)),
      ]),
    );
  }

  Widget _infoRow(IconData icono, String label, String valor) {
    return Row(children: [
      Icon(icono, color: AppTheme.brandMuted, size: 14),
      const SizedBox(width: 6),
      Text('$label: ', style: const TextStyle(color: AppTheme.brandMuted, fontSize: 12)),
      Expanded(child: Text(valor,
        style: const TextStyle(color: Colors.white, fontSize: 12, fontWeight: FontWeight.w600),
        overflow: TextOverflow.ellipsis)),
    ]);
  }

  Widget _timelineNode(Map<String, dynamic> log, int index, int total) {
    final accion     = (log['accion'] ?? '').toUpperCase();
    final isLast     = index == total - 1;
    final isFirst    = index == 0;

    Color dotColor;
    IconData dotIcon;
    if (accion == 'INICIADO' || accion == 'APROBADO' || accion == 'COMPLETADO') {
      dotColor = AppTheme.estadoVerde;
      dotIcon  = Icons.check_circle_rounded;
    } else if (accion == 'RECHAZADO') {
      dotColor = AppTheme.estadoRojo;
      dotIcon  = Icons.cancel_rounded;
    } else if (accion == 'EN_REVISION' || accion == 'EN_PROCESO') {
      dotColor = AppTheme.estadoAmbar;
      dotIcon  = Icons.pending_rounded;
    } else {
      dotColor = AppTheme.brandMuted;
      dotIcon  = Icons.radio_button_unchecked_rounded;
    }

    return IntrinsicHeight(
      child: Row(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        SizedBox(
          width: 36,
          child: Column(children: [
            Container(width: 2, height: 16,
              color: isFirst ? Colors.transparent : AppTheme.brandBorder),
            Icon(dotIcon, color: dotColor, size: 22),
            Expanded(child: Container(width: 2,
              color: isLast ? Colors.transparent : AppTheme.brandBorder)),
          ]),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: Padding(
            padding: const EdgeInsets.only(bottom: 24, top: 4),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(accion,
                style: TextStyle(color: dotColor, fontWeight: FontWeight.bold, fontSize: 13)),
              const SizedBox(height: 3),
              if (log['departamentoId'] != null)
                Text('Departamento: ${log['departamentoId']}',
                  style: const TextStyle(color: AppTheme.brandMuted, fontSize: 11)),
              if (log['comentario'] != null && log['comentario'].toString().isNotEmpty)
                Padding(
                  padding: const EdgeInsets.only(top: 4),
                  child: Container(
                    padding: const EdgeInsets.all(8),
                    decoration: BoxDecoration(
                      color: AppTheme.brandSurface,
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: Text(log['comentario'],
                      style: const TextStyle(color: Colors.white70, fontSize: 11,
                        fontStyle: FontStyle.italic)),
                  ),
                ),
              const SizedBox(height: 3),
              Text(_formatFecha(log['fecha']),
                style: const TextStyle(color: AppTheme.brandMuted, fontSize: 10)),
            ]),
          ),
        ),
      ]),
    );
  }

  String _formatFecha(dynamic fecha) {
    if (fecha == null) return '';
    try {
      final dt = DateTime.parse(fecha.toString());
      return '${dt.day}/${dt.month}/${dt.year} ${dt.hour.toString().padLeft(2,'0')}:${dt.minute.toString().padLeft(2,'0')}';
    } catch (_) { return fecha.toString(); }
  }
}
