import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../core/app_theme.dart';
import '../services/tramite_service.dart';
import 'catalogo_screen.dart';
import 'detalle_tramite_screen.dart';

class HomeScreen extends StatefulWidget {
  final void Function(int) onSwitchTab;
  const HomeScreen({super.key, required this.onSwitchTab});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  final TramiteService _service = TramiteService();

  String _nombre = '';
  List<dynamic> _tramites = [];
  bool _isLoading = true;

  @override
  void initState() {
    super.initState();
    _cargar();
  }

  Future<void> _cargar() async {
    final prefs = await SharedPreferences.getInstance();
    final nombre = prefs.getString('nombre') ?? prefs.getString('username') ?? 'Usuario';
    final tramites = await _service.obtenerMisTramites();
    if (!mounted) return;
    setState(() {
      _nombre = nombre;
      _tramites = tramites;
      _isLoading = false;
    });
  }

  // Cálculo de estadísticas
  int get _total => _tramites.length;
  int get _activos => _tramites
      .where((t) => ['EN_PROCESO', 'EN_REVISION', 'CREADO']
          .contains((t['estadoSemaforo'] ?? '').toUpperCase()))
      .length;
  int get _completados => _tramites
      .where((t) => ['COMPLETADO', 'APROBADO']
          .contains((t['estadoSemaforo'] ?? '').toUpperCase()))
      .length;
  int get _rechazados => _tramites
      .where((t) => (t['estadoSemaforo'] ?? '').toUpperCase() == 'RECHAZADO')
      .length;

  List<dynamic> get _recientes => _tramites.take(3).toList();

  @override
  Widget build(BuildContext context) {
    return RefreshIndicator(
      color: AppTheme.brandPrimary,
      backgroundColor: AppTheme.brandSurface,
      onRefresh: _cargar,
      child: ListView(
        padding: EdgeInsets.zero,
        children: [
          _header(),
          const SizedBox(height: 20),
          _statsRow(),
          const SizedBox(height: 24),
          _accionesRapidas(context),
          const SizedBox(height: 24),
          _seccionRecientes(context),
          const SizedBox(height: 32),
        ],
      ),
    );
  }

  // ── Header con saludo ──────────────────────────────────────────────────────
  Widget _header() {
    return Container(
      padding: const EdgeInsets.fromLTRB(20, 20, 20, 24),
      decoration: const BoxDecoration(
        color: AppTheme.brandSurface,
        borderRadius: BorderRadius.vertical(bottom: Radius.circular(24)),
      ),
      child: Row(children: [
        Container(
          width: 52, height: 52,
          decoration: BoxDecoration(
            gradient: const LinearGradient(
              colors: [AppTheme.brandPrimary, Color(0xFF7C3AED)],
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
            ),
            borderRadius: BorderRadius.circular(16),
          ),
          child: Center(
            child: Text(
              _nombre.isNotEmpty ? _nombre[0].toUpperCase() : 'U',
              style: const TextStyle(color: Colors.white, fontSize: 22,
                  fontWeight: FontWeight.bold),
            ),
          ),
        ),
        const SizedBox(width: 14),
        Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          const Text('Bienvenido',
              style: TextStyle(color: AppTheme.brandMuted, fontSize: 13)),
          Text(_nombre,
              style: const TextStyle(color: Colors.white, fontSize: 18,
                  fontWeight: FontWeight.bold),
              maxLines: 1, overflow: TextOverflow.ellipsis),
        ])),
        if (_isLoading)
          const SizedBox(
            width: 20, height: 20,
            child: CircularProgressIndicator(
              color: AppTheme.brandPrimary, strokeWidth: 2),
          ),
      ]),
    );
  }

  // ── Tarjetas de estadísticas ───────────────────────────────────────────────
  Widget _statsRow() {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16),
      child: Row(children: [
        Expanded(child: _statCard('Total', _total,
            Icons.folder_copy_rounded, AppTheme.brandPrimary)),
        const SizedBox(width: 10),
        Expanded(child: _statCard('Activos', _activos,
            Icons.hourglass_top_rounded, AppTheme.estadoAmbar)),
        const SizedBox(width: 10),
        Expanded(child: _statCard('Listos', _completados,
            Icons.check_circle_rounded, AppTheme.estadoVerde)),
        const SizedBox(width: 10),
        Expanded(child: _statCard('Rechazados', _rechazados,
            Icons.cancel_rounded, AppTheme.estadoRojo)),
      ]),
    );
  }

  Widget _statCard(String label, int valor, IconData icon, Color color) {
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 14, horizontal: 10),
      decoration: BoxDecoration(
        color: AppTheme.brandSurface,
        borderRadius: BorderRadius.circular(AppTheme.radius),
        border: Border.all(color: color.withValues(alpha: 0.3)),
      ),
      child: Column(children: [
        Icon(icon, color: color, size: 20),
        const SizedBox(height: 6),
        Text('$valor',
            style: TextStyle(color: color, fontSize: 20,
                fontWeight: FontWeight.bold)),
        const SizedBox(height: 2),
        Text(label,
            style: const TextStyle(color: AppTheme.brandMuted,
                fontSize: 10, fontWeight: FontWeight.w500),
            textAlign: TextAlign.center),
      ]),
    );
  }

  // ── Acciones rápidas ──────────────────────────────────────────────────────
  Widget _accionesRapidas(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        const Text('Acciones rápidas',
            style: TextStyle(color: Colors.white, fontSize: 14,
                fontWeight: FontWeight.bold)),
        const SizedBox(height: 12),
        Row(children: [
          Expanded(child: _accionBtn(
            icon: Icons.add_circle_outline_rounded,
            label: 'Nuevo\nTrámite',
            color: AppTheme.brandPrimary,
            onTap: () => Navigator.push(context,
                MaterialPageRoute(builder: (_) => const CatalogoScreen())),
          )),
          const SizedBox(width: 10),
          Expanded(child: _accionBtn(
            icon: Icons.search_rounded,
            label: 'Rastrear\nTrámite',
            color: AppTheme.estadoAmbar,
            onTap: () => widget.onSwitchTab(2),
          )),
          const SizedBox(width: 10),
          Expanded(child: _accionBtn(
            icon: Icons.smart_toy_rounded,
            label: 'Asistente\nIA',
            color: const Color(0xFF06B6D4),
            onTap: () => widget.onSwitchTab(3),
          )),
        ]),
      ]),
    );
  }

  Widget _accionBtn({
    required IconData icon,
    required String label,
    required Color color,
    required VoidCallback onTap,
  }) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 16),
        decoration: BoxDecoration(
          color: color.withValues(alpha: 0.1),
          borderRadius: BorderRadius.circular(AppTheme.radius),
          border: Border.all(color: color.withValues(alpha: 0.3)),
        ),
        child: Column(children: [
          Icon(icon, color: color, size: 26),
          const SizedBox(height: 8),
          Text(label,
              style: TextStyle(color: color, fontSize: 11,
                  fontWeight: FontWeight.bold),
              textAlign: TextAlign.center),
        ]),
      ),
    );
  }

  // ── Trámites recientes ────────────────────────────────────────────────────
  Widget _seccionRecientes(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          const Expanded(
            child: Text('Trámites recientes',
                style: TextStyle(color: Colors.white, fontSize: 14,
                    fontWeight: FontWeight.bold)),
          ),
          TextButton(
            onPressed: () => widget.onSwitchTab(1),
            child: const Text('Ver todos',
                style: TextStyle(color: AppTheme.brandPrimary, fontSize: 12)),
          ),
        ]),
        const SizedBox(height: 8),
        if (_isLoading)
          const Center(child: Padding(
            padding: EdgeInsets.all(20),
            child: CircularProgressIndicator(color: AppTheme.brandPrimary),
          ))
        else if (_recientes.isEmpty)
          _emptyRecientes(context)
        else
          ...(_recientes.map((t) => _tarjetaReciente(context, t))),
      ]),
    );
  }

  Widget _tarjetaReciente(BuildContext context, Map<String, dynamic> t) {
    final estado = t['estadoSemaforo'] ?? 'DESCONOCIDO';
    final color  = AppTheme.colorEstado(estado);
    final codigo = t['codigoSeguimiento'] ?? '—';
    final nombre = t['nombreProceso'] ?? t['codigoProceso'] ?? 'Trámite';

    return Card(
      color: AppTheme.brandSurface,
      margin: const EdgeInsets.only(bottom: 10),
      shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(AppTheme.radiusGrande)),
      child: InkWell(
        borderRadius: BorderRadius.circular(AppTheme.radiusGrande),
        onTap: () => Navigator.push(context,
            MaterialPageRoute(
                builder: (_) => DetalleTramiteScreen(tramiteId: t['id']))),
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Row(children: [
            Container(
              width: 40, height: 40,
              decoration: BoxDecoration(
                color: color.withValues(alpha: 0.12),
                borderRadius: BorderRadius.circular(12),
              ),
              child: Icon(_iconEstado(estado), color: color, size: 20),
            ),
            const SizedBox(width: 12),
            Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start,
                children: [
              Text(nombre,
                  style: const TextStyle(color: Colors.white, fontSize: 13,
                      fontWeight: FontWeight.w600),
                  maxLines: 1, overflow: TextOverflow.ellipsis),
              const SizedBox(height: 3),
              Text(codigo,
                  style: TextStyle(color: color, fontSize: 11,
                      fontWeight: FontWeight.bold)),
            ])),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
              decoration: BoxDecoration(
                color: color.withValues(alpha: 0.12),
                borderRadius: BorderRadius.circular(20),
                border: Border.all(color: color.withValues(alpha: 0.4)),
              ),
              child: Text(estado,
                  style: TextStyle(color: color, fontSize: 9,
                      fontWeight: FontWeight.bold)),
            ),
          ]),
        ),
      ),
    );
  }

  Widget _emptyRecientes(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(28),
      decoration: BoxDecoration(
        color: AppTheme.brandSurface,
        borderRadius: BorderRadius.circular(AppTheme.radiusGrande),
      ),
      child: Column(children: [
        const Icon(Icons.inbox_outlined, size: 40, color: AppTheme.brandMuted),
        const SizedBox(height: 12),
        const Text('Sin trámites aún',
            style: TextStyle(color: Colors.white, fontSize: 14,
                fontWeight: FontWeight.bold)),
        const SizedBox(height: 6),
        const Text('Inicia tu primer trámite tocando el botón de abajo',
            style: TextStyle(color: AppTheme.brandMuted, fontSize: 12),
            textAlign: TextAlign.center),
        const SizedBox(height: 16),
        ElevatedButton.icon(
          style: AppTheme.botonPrimario(),
          onPressed: () => Navigator.push(context,
              MaterialPageRoute(builder: (_) => const CatalogoScreen())),
          icon: const Icon(Icons.add_rounded),
          label: const Text('Nuevo trámite'),
        ),
      ]),
    );
  }

  IconData _iconEstado(String e) {
    switch (e.toUpperCase()) {
      case 'COMPLETADO': case 'APROBADO': return Icons.check_circle_rounded;
      case 'RECHAZADO':  return Icons.cancel_rounded;
      case 'EN_PROCESO': case 'EN_REVISION': return Icons.hourglass_top_rounded;
      default: return Icons.pending_rounded;
    }
  }
}
