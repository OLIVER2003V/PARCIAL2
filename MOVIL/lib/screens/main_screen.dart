import 'package:flutter/material.dart';
import '../core/app_theme.dart';
import '../services/notificacion_store.dart';
import 'catalogo_screen.dart';
import 'mis_tramites_screen.dart';
import 'rastreo_screen.dart';
import 'chatbot_screen.dart';
import 'notificaciones_screen.dart';
import 'perfil_screen.dart';

class MainScreen extends StatefulWidget {
  const MainScreen({super.key, this.tabInicial = 0});
  final int tabInicial;

  @override
  State<MainScreen> createState() => _MainScreenState();
}

class _MainScreenState extends State<MainScreen> {
  late int _tabActual;
  int _notifNoLeidas = 0;

  static const _titulos = ['Trámites', 'Mis Trámites', 'Rastrear', 'Asistente IA'];

  @override
  void initState() {
    super.initState();
    _tabActual = widget.tabInicial;
    _cargarNotificaciones();
  }

  Future<void> _cargarNotificaciones() async {
    final count = await NotificacionStore.contarNoLeidas();
    if (mounted) setState(() => _notifNoLeidas = count);
  }

  final List<Widget> _tabs = const [
    CatalogoScreen(),
    MisTramitesScreen(),
    RastreoScreen(),
    ChatbotScreen(),
  ];

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppTheme.brandBg,
      appBar: AppBar(
        backgroundColor: AppTheme.brandSurface,
        elevation: 0,
        title: Text(
          _titulos[_tabActual],
          style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold),
        ),
        actions: [
          // Campanita con badge
          Stack(
            alignment: Alignment.center,
            children: [
              IconButton(
                icon: const Icon(Icons.notifications_outlined, color: Colors.white),
                tooltip: 'Notificaciones',
                onPressed: () async {
                  await Navigator.push(
                    context,
                    MaterialPageRoute(builder: (_) => const NotificacionesScreen()),
                  );
                  _cargarNotificaciones();
                },
              ),
              if (_notifNoLeidas > 0)
                Positioned(
                  right: 8, top: 8,
                  child: Container(
                    padding: const EdgeInsets.all(3),
                    constraints: const BoxConstraints(minWidth: 16, minHeight: 16),
                    decoration: const BoxDecoration(
                      color: AppTheme.estadoRojo,
                      shape: BoxShape.circle,
                    ),
                    child: Text(
                      _notifNoLeidas > 9 ? '9+' : '$_notifNoLeidas',
                      style: const TextStyle(color: Colors.white, fontSize: 9,
                        fontWeight: FontWeight.w900),
                      textAlign: TextAlign.center,
                    ),
                  ),
                ),
            ],
          ),
          // Perfil
          IconButton(
            icon: const Icon(Icons.person_outline, color: Colors.white),
            tooltip: 'Mi Perfil',
            onPressed: () => Navigator.push(
              context,
              MaterialPageRoute(builder: (_) => const PerfilScreen()),
            ),
          ),
          const SizedBox(width: 4),
        ],
      ),
      body: IndexedStack(
        index: _tabActual,
        children: _tabs,
      ),
      bottomNavigationBar: NavigationBar(
        backgroundColor: AppTheme.brandSurface,
        indicatorColor: AppTheme.brandPrimary.withValues(alpha: 0.2),
        selectedIndex: _tabActual,
        onDestinationSelected: (i) => setState(() => _tabActual = i),
        labelBehavior: NavigationDestinationLabelBehavior.alwaysShow,
        destinations: const [
          NavigationDestination(
            icon: Icon(Icons.home_outlined, color: AppTheme.brandMuted),
            selectedIcon: Icon(Icons.home_rounded, color: AppTheme.brandPrimary),
            label: 'Inicio',
          ),
          NavigationDestination(
            icon: Icon(Icons.folder_outlined, color: AppTheme.brandMuted),
            selectedIcon: Icon(Icons.folder_rounded, color: AppTheme.brandPrimary),
            label: 'Mis Trámites',
          ),
          NavigationDestination(
            icon: Icon(Icons.search_outlined, color: AppTheme.brandMuted),
            selectedIcon: Icon(Icons.search_rounded, color: AppTheme.brandPrimary),
            label: 'Rastrear',
          ),
          NavigationDestination(
            icon: Icon(Icons.smart_toy_outlined, color: AppTheme.brandMuted),
            selectedIcon: Icon(Icons.smart_toy_rounded, color: AppTheme.brandPrimary),
            label: 'Asistente',
          ),
        ],
      ),
    );
  }
}
