import 'package:flutter/material.dart';
import '../services/notificacion_store.dart';
import '../core/app_theme.dart';

class NotificacionesScreen extends StatefulWidget {
  const NotificacionesScreen({super.key});

  @override
  State<NotificacionesScreen> createState() => _NotificacionesScreenState();
}

class _NotificacionesScreenState extends State<NotificacionesScreen> {
  List<AppNotificacion> _notificaciones = [];
  bool _cargando = true;

  @override
  void initState() {
    super.initState();
    _cargar();
  }

  Future<void> _cargar() async {
    setState(() => _cargando = true);
    final lista = await NotificacionStore.cargar();
    if (mounted) setState(() { _notificaciones = lista; _cargando = false; });
  }

  Future<void> _marcarTodasLeidas() async {
    await NotificacionStore.marcarTodasLeidas();
    await _cargar();
  }

  Future<void> _limpiarTodas() async {
    final confirmar = await showDialog<bool>(
      context: context,
      builder: (_) => AlertDialog(
        backgroundColor: AppTheme.brandSurface,
        title: const Text('Limpiar notificaciones', style: TextStyle(color: Colors.white)),
        content: const Text('¿Eliminar todas las notificaciones?',
            style: TextStyle(color: AppTheme.brandMuted)),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Cancelar', style: TextStyle(color: AppTheme.brandMuted)),
          ),
          TextButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Eliminar', style: TextStyle(color: AppTheme.estadoRojo)),
          ),
        ],
      ),
    );
    if (confirmar == true) {
      await NotificacionStore.limpiar();
      await _cargar();
    }
  }

  String _formatearFecha(DateTime fecha) {
    final ahora = DateTime.now();
    final diff = ahora.difference(fecha);
    if (diff.inMinutes < 1) return 'Ahora mismo';
    if (diff.inMinutes < 60) return 'Hace ${diff.inMinutes} min';
    if (diff.inHours < 24) return 'Hace ${diff.inHours} h';
    if (diff.inDays == 1) return 'Ayer';
    if (diff.inDays < 7) return 'Hace ${diff.inDays} días';
    return '${fecha.day.toString().padLeft(2, '0')}/${fecha.month.toString().padLeft(2, '0')}/${fecha.year}';
  }

  // Agrupa notificaciones por día
  Map<String, List<AppNotificacion>> _agruparPorDia() {
    final ahora = DateTime.now();
    final mapa = <String, List<AppNotificacion>>{};
    for (final n in _notificaciones) {
      final diff = ahora.difference(n.fecha);
      String clave;
      if (diff.inDays == 0) {
        clave = 'Hoy';
      } else if (diff.inDays == 1) {
        clave = 'Ayer';
      } else {
        clave =
            '${n.fecha.day.toString().padLeft(2, '0')}/${n.fecha.month.toString().padLeft(2, '0')}/${n.fecha.year}';
      }
      mapa.putIfAbsent(clave, () => []).add(n);
    }
    return mapa;
  }

  int get _noLeidas => _notificaciones.where((n) => !n.leida).length;

  @override
  Widget build(BuildContext context) {
    final grupos = _agruparPorDia();
    final claves = grupos.keys.toList();

    return Scaffold(
      backgroundColor: AppTheme.brandBg,
      appBar: AppBar(
        backgroundColor: AppTheme.brandSurface,
        elevation: 0,
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('Notificaciones',
                style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 18)),
            if (_noLeidas > 0)
              Text('$_noLeidas sin leer',
                  style: const TextStyle(color: AppTheme.brandPrimary, fontSize: 12)),
          ],
        ),
        iconTheme: const IconThemeData(color: Colors.white),
        actions: [
          if (_notificaciones.isNotEmpty) ...[
            if (_noLeidas > 0)
              IconButton(
                icon: const Icon(Icons.done_all, color: Colors.white),
                tooltip: 'Marcar todas como leídas',
                onPressed: _marcarTodasLeidas,
              ),
            IconButton(
              icon: const Icon(Icons.delete_sweep_outlined, color: AppTheme.brandMuted),
              tooltip: 'Limpiar todas',
              onPressed: _limpiarTodas,
            ),
          ],
        ],
      ),
      body: _cargando
          ? const Center(child: CircularProgressIndicator(color: AppTheme.brandPrimary))
          : RefreshIndicator(
              onRefresh: _cargar,
              color: AppTheme.brandPrimary,
              backgroundColor: AppTheme.brandSurface,
              child: _notificaciones.isEmpty
                  ? _buildEstadoVacio()
                  : ListView.builder(
                      padding: const EdgeInsets.symmetric(vertical: 8),
                      itemCount: claves.fold<int>(0, (sum, k) => sum + 1 + (grupos[k]?.length ?? 0)),
                      itemBuilder: (context, index) {
                        // Calcular a qué grupo e ítem corresponde este índice
                        int cursor = 0;
                        for (final clave in claves) {
                          if (index == cursor) return _buildSeparadorFecha(clave);
                          cursor++;
                          final items = grupos[clave]!;
                          if (index < cursor + items.length) {
                            return _buildTarjetaNotificacion(items[index - cursor]);
                          }
                          cursor += items.length;
                        }
                        return const SizedBox.shrink();
                      },
                    ),
            ),
    );
  }

  Widget _buildEstadoVacio() {
    return ListView(
      children: [
        SizedBox(
          height: MediaQuery.of(context).size.height * 0.65,
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Container(
                width: 80,
                height: 80,
                decoration: BoxDecoration(
                  color: AppTheme.brandSurface,
                  shape: BoxShape.circle,
                ),
                child: const Icon(Icons.notifications_off_outlined,
                    color: AppTheme.brandMuted, size: 40),
              ),
              const SizedBox(height: 20),
              const Text('Sin notificaciones',
                  style: TextStyle(
                      color: Colors.white, fontWeight: FontWeight.bold, fontSize: 18)),
              const SizedBox(height: 8),
              const Text('Las actualizaciones de tus trámites\naparecerán aquí',
                  textAlign: TextAlign.center,
                  style: TextStyle(color: AppTheme.brandMuted, fontSize: 14, height: 1.5)),
            ],
          ),
        ),
      ],
    );
  }

  Widget _buildSeparadorFecha(String etiqueta) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
      child: Row(
        children: [
          Text(etiqueta,
              style: const TextStyle(
                  color: AppTheme.brandMuted, fontWeight: FontWeight.w600, fontSize: 13)),
          const SizedBox(width: 12),
          const Expanded(child: Divider(color: AppTheme.brandBorder)),
        ],
      ),
    );
  }

  Widget _buildTarjetaNotificacion(AppNotificacion n) {
    return Dismissible(
      key: Key(n.id),
      direction: DismissDirection.endToStart,
      background: Container(
        alignment: Alignment.centerRight,
        padding: const EdgeInsets.only(right: 20),
        color: AppTheme.estadoRojo.withValues(alpha: 0.15),
        child: const Icon(Icons.delete_outline, color: AppTheme.estadoRojo),
      ),
      onDismissed: (_) async {
        final lista = await NotificacionStore.cargar();
        lista.removeWhere((x) => x.id == n.id);
        // Guardar la lista actualizada directamente via limpiar + agregar sería ineficiente;
        // se recarga simplemente
        setState(() => _notificaciones.removeWhere((x) => x.id == n.id));
      },
      child: Container(
        margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
        decoration: BoxDecoration(
          color: n.leida ? AppTheme.brandSurface : AppTheme.brandPrimary.withValues(alpha: 0.08),
          borderRadius: BorderRadius.circular(AppTheme.radius),
          border: Border.all(
            color: n.leida ? AppTheme.brandBorder : AppTheme.brandPrimary.withValues(alpha: 0.3),
          ),
        ),
        child: InkWell(
          borderRadius: BorderRadius.circular(AppTheme.radius),
          onTap: () async {
            if (!n.leida) {
              setState(() => n.leida = true);
              // Persiste el cambio
              final lista = await NotificacionStore.cargar();
              final idx = lista.indexWhere((x) => x.id == n.id);
              if (idx != -1) lista[idx].leida = true;
            }
          },
          child: Padding(
            padding: const EdgeInsets.all(14),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                // Indicador visual de leída/no leída
                Container(
                  margin: const EdgeInsets.only(top: 4),
                  width: 10,
                  height: 10,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    color: n.leida ? Colors.transparent : AppTheme.brandPrimary,
                    border: n.leida
                        ? Border.all(color: AppTheme.brandBorder)
                        : null,
                  ),
                ),
                const SizedBox(width: 12),
                // Icono de campana
                Container(
                  width: 40,
                  height: 40,
                  decoration: BoxDecoration(
                    color: AppTheme.brandPrimary.withValues(alpha: 0.12),
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: Icon(
                    _iconoPorTitulo(n.titulo),
                    color: AppTheme.brandPrimary,
                    size: 20,
                  ),
                ),
                const SizedBox(width: 12),
                // Contenido
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Expanded(
                            child: Text(
                              n.titulo,
                              style: TextStyle(
                                color: Colors.white,
                                fontWeight: n.leida ? FontWeight.normal : FontWeight.bold,
                                fontSize: 14,
                              ),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                            ),
                          ),
                          Text(
                            _formatearFecha(n.fecha),
                            style: const TextStyle(color: AppTheme.brandMuted, fontSize: 11),
                          ),
                        ],
                      ),
                      const SizedBox(height: 4),
                      Text(
                        n.cuerpo,
                        style: const TextStyle(
                            color: AppTheme.brandMuted, fontSize: 13, height: 1.4),
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  IconData _iconoPorTitulo(String titulo) {
    final t = titulo.toLowerCase();
    if (t.contains('aprobado') || t.contains('completado')) return Icons.check_circle_outline;
    if (t.contains('rechazado')) return Icons.cancel_outlined;
    if (t.contains('trámite') || t.contains('tramite')) return Icons.folder_outlined;
    if (t.contains('mensaje') || t.contains('comentario')) return Icons.chat_bubble_outline;
    return Icons.notifications_outlined;
  }
}
