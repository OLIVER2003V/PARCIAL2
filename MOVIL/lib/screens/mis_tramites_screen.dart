import 'dart:async';
import 'package:flutter/material.dart';
import '../core/app_theme.dart';
import '../services/tramite_service.dart';
import '../services/notificacion_store.dart';
import 'detalle_tramite_screen.dart';

class MisTramitesScreen extends StatefulWidget {
  const MisTramitesScreen({super.key});

  @override
  State<MisTramitesScreen> createState() => _MisTramitesScreenState();
}

class _MisTramitesScreenState extends State<MisTramitesScreen> {
  final TramiteService _service = TramiteService();

  List<dynamic> _todos   = [];
  List<dynamic> _filtros = [];
  bool   _isLoading     = true;
  String _busqueda      = '';
  String _filtroEstado  = 'TODOS';

  static const int _porPagina = 10;
  int _paginaActual = 1;

  List<dynamic> get _pagina =>
      _filtros.take(_paginaActual * _porPagina).toList();
  bool get _hayMas => _filtros.length > _paginaActual * _porPagina;

  Timer? _pollingTimer;
  Map<String, String> _estadosAnteriores = {};

  static const _estados = ['TODOS', 'EN_PROCESO', 'COMPLETADO', 'RECHAZADO', 'CREADO'];

  @override
  void initState() {
    super.initState();
    _cargar();
    _iniciarPolling();
  }

  @override
  void dispose() {
    _pollingTimer?.cancel();
    super.dispose();
  }

  Future<void> _cargar() async {
    final lista = await _service.obtenerMisTramites();
    if (!mounted) return;
    setState(() {
      _todos = lista;
      _estadosAnteriores = {
        for (final t in lista)
          (t['id'] ?? ''): (t['estadoSemaforo'] ?? ''),
      };
      _aplicarFiltros();
      _isLoading = false;
    });
  }

  void _aplicarFiltros() {
    var resultado = _todos;

    if (_filtroEstado != 'TODOS') {
      resultado = resultado.where((t) =>
        (t['estadoSemaforo'] ?? '').toUpperCase() == _filtroEstado).toList();
    }

    if (_busqueda.isNotEmpty) {
      final q = _busqueda.toLowerCase();
      resultado = resultado.where((t) =>
        (t['codigoSeguimiento'] ?? '').toLowerCase().contains(q) ||
        (t['descripcion'] ?? '').toLowerCase().contains(q)).toList();
    }

    _filtros = resultado;
    _paginaActual = 1; // Reinicia paginación al filtrar
  }

  void _iniciarPolling() {
    _pollingTimer = Timer.periodic(const Duration(seconds: 8), (_) async {
      final lista = await _service.obtenerMisTramites();
      if (!mounted) return;

      for (final t in lista) {
        final id          = t['id'] ?? '';
        final nuevoEstado = t['estadoSemaforo'] ?? '';
        final prevEstado  = _estadosAnteriores[id] ?? '';

        if (prevEstado.isNotEmpty && nuevoEstado != prevEstado) {
          final codigo = t['codigoSeguimiento'] ?? id;
          await NotificacionStore.agregar(AppNotificacion(
            id:     '${id}_${DateTime.now().millisecondsSinceEpoch}',
            titulo: 'Trámite actualizado',
            cuerpo: 'Tu trámite $codigo cambió a: $nuevoEstado',
            fecha:  DateTime.now(),
          ));
          if (mounted) {
            ScaffoldMessenger.of(context).showSnackBar(SnackBar(
              content: Row(children: [
                const Icon(Icons.notifications_active, color: Colors.white),
                const SizedBox(width: 10),
                Expanded(child: Text('Trámite $codigo: $nuevoEstado')),
              ]),
              backgroundColor: AppTheme.brandPrimary,
              behavior: SnackBarBehavior.floating,
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
            ));
          }
        }
      }

      setState(() {
        _todos = lista;
        _estadosAnteriores = {
          for (final t in lista) (t['id'] ?? ''): (t['estadoSemaforo'] ?? ''),
        };
        _aplicarFiltros();
      });
    });
  }

  Color _colorEstado(String e) => AppTheme.colorEstado(e);

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        // Búsqueda
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
          child: TextField(
            style: const TextStyle(color: Colors.white),
            onChanged: (v) => setState(() { _busqueda = v; _aplicarFiltros(); }),
            decoration: InputDecoration(
              hintText: 'Buscar por código o descripción...',
              hintStyle: const TextStyle(color: AppTheme.brandMuted),
              prefixIcon: const Icon(Icons.search, color: AppTheme.brandMuted),
              suffixIcon: _busqueda.isNotEmpty
                  ? IconButton(
                      icon: const Icon(Icons.clear, color: AppTheme.brandMuted),
                      onPressed: () => setState(() { _busqueda = ''; _aplicarFiltros(); }),
                    )
                  : null,
              filled: true,
              fillColor: AppTheme.brandSurface,
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(AppTheme.radius),
                borderSide: BorderSide.none,
              ),
            ),
          ),
        ),

        // Chips de estado
        SizedBox(
          height: 40,
          child: ListView.separated(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.symmetric(horizontal: 16),
            itemCount: _estados.length,
            separatorBuilder: (_, __) => const SizedBox(width: 8),
            itemBuilder: (_, i) {
              final e       = _estados[i];
              final activo  = _filtroEstado == e;
              return FilterChip(
                label: Text(e, style: TextStyle(
                  fontSize: 11,
                  fontWeight: FontWeight.bold,
                  color: activo ? Colors.white : AppTheme.brandMuted,
                )),
                selected: activo,
                onSelected: (_) => setState(() {
                  _filtroEstado = e;
                  _aplicarFiltros();
                }),
                backgroundColor: AppTheme.brandSurface,
                selectedColor: AppTheme.brandPrimary,
                checkmarkColor: Colors.white,
                side: BorderSide(
                  color: activo ? AppTheme.brandPrimary : AppTheme.brandBorder,
                ),
              );
            },
          ),
        ),
        const SizedBox(height: 8),

        // Contador
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
          child: Row(children: [
            Text('${_filtros.length} trámite${_filtros.length == 1 ? '' : 's'}',
              style: const TextStyle(color: AppTheme.brandMuted, fontSize: 12)),
          ]),
        ),

        // Lista
        Expanded(
          child: _isLoading
              ? const Center(child: CircularProgressIndicator(color: AppTheme.brandPrimary))
              : RefreshIndicator(
                  color: AppTheme.brandPrimary,
                  backgroundColor: AppTheme.brandSurface,
                  onRefresh: _cargar,
                  child: _filtros.isEmpty
                      ? _emptyState()
                      : ListView.builder(
                          padding: const EdgeInsets.symmetric(
                              horizontal: 16, vertical: 4),
                          itemCount: _pagina.length + (_hayMas ? 1 : 0),
                          itemBuilder: (_, i) {
                            if (i == _pagina.length) {
                              return Padding(
                                padding: const EdgeInsets.symmetric(
                                    vertical: 12),
                                child: Center(
                                  child: OutlinedButton.icon(
                                    style: OutlinedButton.styleFrom(
                                      foregroundColor: AppTheme.brandPrimary,
                                      side: const BorderSide(
                                          color: AppTheme.brandPrimary),
                                      shape: RoundedRectangleBorder(
                                          borderRadius: BorderRadius.circular(
                                              AppTheme.radius)),
                                    ),
                                    onPressed: () => setState(
                                        () => _paginaActual++),
                                    icon: const Icon(
                                        Icons.expand_more_rounded),
                                    label: Text(
                                        'Cargar más (${_filtros.length - _pagina.length} restantes)'),
                                  ),
                                ),
                              );
                            }
                            return _tarjetaTramite(_pagina[i]);
                          },
                        ),
                ),
        ),
      ],
    );
  }

  Widget _tarjetaTramite(Map<String, dynamic> t) {
    final estado  = t['estadoSemaforo'] ?? 'DESCONOCIDO';
    final color   = _colorEstado(estado);
    final codigo  = t['codigoSeguimiento'] ?? '—';
    final proceso = t['nombreProceso'] ?? t['codigoProceso'] ?? 'Trámite';

    return Card(
      color: AppTheme.brandSurface,
      margin: const EdgeInsets.only(bottom: 10),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(AppTheme.radiusGrande)),
      child: InkWell(
        borderRadius: BorderRadius.circular(AppTheme.radiusGrande),
        onTap: () => Navigator.push(
          context,
          MaterialPageRoute(builder: (_) => DetalleTramiteScreen(tramiteId: t['id'])),
        ),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text(codigo,
                    style: TextStyle(color: color, fontSize: 14, fontWeight: FontWeight.bold)),
                  _badgeEstado(estado, color),
                ],
              ),
              const SizedBox(height: 8),
              Text(proceso,
                style: const TextStyle(color: Colors.white, fontSize: 13, fontWeight: FontWeight.w600)),
              const SizedBox(height: 4),
              Text(t['descripcion'] ?? 'Sin descripción',
                style: const TextStyle(color: AppTheme.brandMuted, fontSize: 12),
                maxLines: 2, overflow: TextOverflow.ellipsis),
              const SizedBox(height: 10),
              Row(
                children: [
                  const Icon(Icons.access_time_outlined, color: AppTheme.brandMuted, size: 13),
                  const SizedBox(width: 4),
                  Text(_formatearFecha(t['fechaCreacion']),
                    style: const TextStyle(color: AppTheme.brandMuted, fontSize: 11)),
                  const Spacer(),
                  if (t['departamentoActualId'] != null) ...[
                    const Icon(Icons.business_outlined, color: AppTheme.brandMuted, size: 13),
                    const SizedBox(width: 4),
                    Text('${t['departamentoActualId']}',
                      style: const TextStyle(color: AppTheme.brandMuted, fontSize: 11)),
                  ],
                  const SizedBox(width: 6),
                  const Icon(Icons.chevron_right_rounded, color: AppTheme.brandMuted, size: 16),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _badgeEstado(String estado, Color color) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: color.withValues(alpha: 0.4)),
      ),
      child: Row(mainAxisSize: MainAxisSize.min, children: [
        Container(width: 6, height: 6,
          decoration: BoxDecoration(color: color, shape: BoxShape.circle)),
        const SizedBox(width: 5),
        Text(estado,
          style: TextStyle(color: color, fontSize: 10, fontWeight: FontWeight.bold)),
      ]),
    );
  }

  String _formatearFecha(dynamic fecha) {
    if (fecha == null) return 'Fecha desconocida';
    try {
      final dt = DateTime.parse(fecha.toString());
      return '${dt.day}/${dt.month}/${dt.year}';
    } catch (_) {
      return fecha.toString();
    }
  }

  Widget _emptyState() {
    return ListView(children: [
      const SizedBox(height: 80),
      Center(child: Column(children: [
        Container(
          width: 80, height: 80,
          decoration: BoxDecoration(
            color: AppTheme.brandSurface,
            borderRadius: BorderRadius.circular(24),
          ),
          child: const Icon(Icons.folder_open_rounded, size: 40, color: AppTheme.brandMuted),
        ),
        const SizedBox(height: 20),
        Text(
          _busqueda.isNotEmpty || _filtroEstado != 'TODOS'
              ? 'Sin resultados'
              : 'Sin trámites aún',
          style: const TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.bold),
        ),
        const SizedBox(height: 8),
        const Text('Inicia un trámite desde la pestaña Inicio',
          style: TextStyle(color: AppTheme.brandMuted, fontSize: 13)),
      ])),
    ]);
  }
}
