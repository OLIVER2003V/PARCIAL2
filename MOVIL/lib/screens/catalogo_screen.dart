import 'package:flutter/material.dart';
import '../core/app_theme.dart';
import '../models/proceso.dart';
import '../services/proceso_service.dart';
import 'formulario_tramite_screen.dart';

class CatalogoScreen extends StatefulWidget {
  const CatalogoScreen({super.key});

  @override
  State<CatalogoScreen> createState() => _CatalogoScreenState();
}

class _CatalogoScreenState extends State<CatalogoScreen> {
  final ProcesoService _service = ProcesoService();

  List<ProcesoDefinicion> _todos   = [];
  List<ProcesoDefinicion> _filtros = [];
  bool   _isLoading = true;
  String _busqueda  = '';

  @override
  void initState() {
    super.initState();
    _cargar();
  }

  Future<void> _cargar() async {
    setState(() => _isLoading = true);
    final lista = await _service.obtenerCatalogoPublico();
    if (mounted) {
      setState(() {
        _todos    = lista;
        _filtros  = lista;
        _isLoading = false;
      });
    }
  }

  void _filtrar(String texto) {
    setState(() {
      _busqueda = texto;
      _filtros  = texto.isEmpty
          ? _todos
          : _todos.where((p) =>
              p.nombre.toLowerCase().contains(texto.toLowerCase()) ||
              p.descripcion.toLowerCase().contains(texto.toLowerCase())).toList();
    });
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        // Barra de búsqueda
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
          child: TextField(
            style: const TextStyle(color: Colors.white),
            onChanged: _filtrar,
            decoration: InputDecoration(
              hintText: 'Buscar trámite...',
              hintStyle: const TextStyle(color: AppTheme.brandMuted),
              prefixIcon: const Icon(Icons.search, color: AppTheme.brandMuted),
              suffixIcon: _busqueda.isNotEmpty
                  ? IconButton(
                      icon: const Icon(Icons.clear, color: AppTheme.brandMuted),
                      onPressed: () { _filtrar(''); },
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
                          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                          itemCount: _filtros.length,
                          itemBuilder: (ctx, i) => _tarjetaProceso(_filtros[i]),
                        ),
                ),
        ),
      ],
    );
  }

  Widget _tarjetaProceso(ProcesoDefinicion p) {
    return Card(
      color: AppTheme.brandSurface,
      margin: const EdgeInsets.only(bottom: 12),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(AppTheme.radiusGrande)),
      child: InkWell(
        borderRadius: BorderRadius.circular(AppTheme.radiusGrande),
        onTap: () => Navigator.push(
          context,
          MaterialPageRoute(builder: (_) => FormularioTramiteScreen(proceso: p)),
        ),
        child: Padding(
          padding: const EdgeInsets.all(18),
          child: Row(
            children: [
              Container(
                width: 50, height: 50,
                decoration: BoxDecoration(
                  color: AppTheme.brandPrimary.withValues(alpha: 0.12),
                  borderRadius: BorderRadius.circular(14),
                ),
                child: const Icon(Icons.description_outlined, color: AppTheme.brandPrimary, size: 26),
              ),
              const SizedBox(width: 16),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(p.nombre,
                      style: const TextStyle(color: Colors.white,
                        fontSize: 15, fontWeight: FontWeight.bold)),
                    const SizedBox(height: 4),
                    Text(p.descripcion,
                      style: const TextStyle(color: AppTheme.brandMuted, fontSize: 12),
                      maxLines: 2, overflow: TextOverflow.ellipsis),
                    const SizedBox(height: 8),
                    Row(children: [
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                        decoration: BoxDecoration(
                          color: AppTheme.brandPrimary.withValues(alpha: 0.15),
                          borderRadius: BorderRadius.circular(20),
                        ),
                        child: Text(p.codigo,
                          style: const TextStyle(color: AppTheme.brandPrimary,
                            fontSize: 10, fontWeight: FontWeight.bold)),
                      ),
                      if (p.pasos.isNotEmpty) ...[
                        const SizedBox(width: 8),
                        Text('${p.pasos.length} pasos',
                          style: const TextStyle(color: AppTheme.brandMuted, fontSize: 11)),
                      ],
                    ]),
                  ],
                ),
              ),
              const Icon(Icons.chevron_right_rounded, color: AppTheme.brandMuted),
            ],
          ),
        ),
      ),
    );
  }

  Widget _emptyState() {
    return ListView(
      children: [
        const SizedBox(height: 80),
        Center(
          child: Column(children: [
            Container(
              width: 80, height: 80,
              decoration: BoxDecoration(
                color: AppTheme.brandSurface,
                borderRadius: BorderRadius.circular(24),
              ),
              child: Icon(
                _busqueda.isEmpty ? Icons.inbox_outlined : Icons.search_off_rounded,
                size: 40, color: AppTheme.brandMuted,
              ),
            ),
            const SizedBox(height: 20),
            Text(
              _busqueda.isEmpty
                  ? 'No hay trámites disponibles'
                  : 'Sin resultados para "$_busqueda"',
              style: const TextStyle(color: Colors.white,
                fontSize: 16, fontWeight: FontWeight.bold),
            ),
            const SizedBox(height: 8),
            Text(
              _busqueda.isEmpty
                  ? 'Los trámites publicados aparecerán aquí'
                  : 'Intenta con otro término de búsqueda',
              style: const TextStyle(color: AppTheme.brandMuted, fontSize: 13),
              textAlign: TextAlign.center,
            ),
            if (_busqueda.isEmpty) ...[
              const SizedBox(height: 24),
              ElevatedButton.icon(
                style: AppTheme.botonPrimario(),
                onPressed: _cargar,
                icon: const Icon(Icons.refresh_rounded),
                label: const Text('Actualizar'),
              ),
            ],
          ]),
        ),
      ],
    );
  }
}
