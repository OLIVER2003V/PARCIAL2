import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../core/app_theme.dart';
import '../services/auth_service.dart';
import 'login_screen.dart';

class PerfilScreen extends StatefulWidget {
  const PerfilScreen({super.key});

  @override
  State<PerfilScreen> createState() => _PerfilScreenState();
}

class _PerfilScreenState extends State<PerfilScreen> {
  final AuthService _auth = AuthService();

  String _username   = '';
  String _nombre     = '';
  String _email      = '';
  String _telefono   = '';
  bool   _isLoading  = true;
  bool   _editando   = false;

  // Controladores de edición
  late final TextEditingController _nombreCtrl;
  late final TextEditingController _emailCtrl;
  late final TextEditingController _telefonoCtrl;

  // Cambio de contraseña
  final _passActualCtrl = TextEditingController();
  final _passNuevaCtrl  = TextEditingController();
  final _passConfCtrl   = TextEditingController();
  bool _verActual = false, _verNueva = false, _verConf = false;

  @override
  void initState() {
    super.initState();
    _nombreCtrl    = TextEditingController();
    _emailCtrl     = TextEditingController();
    _telefonoCtrl  = TextEditingController();
    _cargarPerfil();
  }

  @override
  void dispose() {
    _nombreCtrl.dispose();
    _emailCtrl.dispose();
    _telefonoCtrl.dispose();
    _passActualCtrl.dispose();
    _passNuevaCtrl.dispose();
    _passConfCtrl.dispose();
    super.dispose();
  }

  Future<void> _cargarPerfil() async {
    setState(() => _isLoading = true);
    final prefs    = await SharedPreferences.getInstance();
    final username = prefs.getString('username') ?? '';

    final datos = await _auth.obtenerPerfil();

    setState(() {
      _username = username;
      _nombre   = datos?['nombre']   ?? username;
      _email    = datos?['email']    ?? '';
      _telefono = datos?['telefono'] ?? '';
      _nombreCtrl.text   = _nombre;
      _emailCtrl.text    = _email;
      _telefonoCtrl.text = _telefono;
      _isLoading = false;
    });
  }

  Future<void> _guardarPerfil() async {
    final exito = await _auth.actualizarPerfil({
      'nombre':   _nombreCtrl.text.trim(),
      'email':    _emailCtrl.text.trim(),
      'telefono': _telefonoCtrl.text.trim(),
    });

    if (!mounted) return;
    if (exito) {
      setState(() {
        _nombre   = _nombreCtrl.text.trim();
        _email    = _emailCtrl.text.trim();
        _telefono = _telefonoCtrl.text.trim();
        _editando = false;
      });
      _snack('Perfil actualizado', AppTheme.estadoVerde);
    } else {
      _snack('No se pudo actualizar el perfil', AppTheme.estadoRojo);
    }
  }

  Future<void> _cambiarPassword() async {
    if (_passNuevaCtrl.text != _passConfCtrl.text) {
      _snack('Las contraseñas nuevas no coinciden', AppTheme.estadoRojo);
      return;
    }
    if (_passNuevaCtrl.text.length < 6) {
      _snack('Mínimo 6 caracteres', AppTheme.estadoRojo);
      return;
    }

    final res = await _auth.cambiarPassword(
      _passActualCtrl.text, _passNuevaCtrl.text);

    if (!mounted) return;
    if (res['exito'] == true) {
      _passActualCtrl.clear();
      _passNuevaCtrl.clear();
      _passConfCtrl.clear();
      _snack('Contraseña actualizada', AppTheme.estadoVerde);
    } else {
      _snack(res['mensaje'] ?? 'Error', AppTheme.estadoRojo);
    }
  }

  Future<void> _cerrarSesion() async {
    final conf = await showDialog<bool>(
      context: context,
      builder: (_) => AlertDialog(
        backgroundColor: AppTheme.brandSurface,
        title: const Text('Cerrar Sesión', style: TextStyle(color: Colors.white)),
        content: const Text('¿Estás seguro que deseas salir?',
          style: TextStyle(color: AppTheme.brandMuted)),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false),
            child: const Text('Cancelar', style: TextStyle(color: AppTheme.brandMuted))),
          ElevatedButton(
            style: ElevatedButton.styleFrom(backgroundColor: AppTheme.estadoRojo),
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Salir', style: TextStyle(color: Colors.white)),
          ),
        ],
      ),
    );

    if (conf == true) {
      await _auth.logout();
      if (!mounted) return;
      Navigator.pushAndRemoveUntil(
        context,
        MaterialPageRoute(builder: (_) => const LoginScreen()),
        (_) => false,
      );
    }
  }

  void _snack(String msg, Color color) {
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(
      content: Text(msg),
      backgroundColor: color,
      behavior: SnackBarBehavior.floating,
    ));
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppTheme.brandBg,
      appBar: AppBar(
        backgroundColor: AppTheme.brandSurface,
        title: const Text('Mi Perfil', style: TextStyle(color: Colors.white)),
        iconTheme: const IconThemeData(color: Colors.white),
        elevation: 0,
        actions: [
          if (!_editando)
            IconButton(
              icon: const Icon(Icons.edit_outlined, color: Colors.white),
              onPressed: () => setState(() => _editando = true),
              tooltip: 'Editar perfil',
            ),
        ],
      ),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator(color: AppTheme.brandPrimary))
          : RefreshIndicator(
              color: AppTheme.brandPrimary,
              backgroundColor: AppTheme.brandSurface,
              onRefresh: _cargarPerfil,
              child: ListView(
                padding: const EdgeInsets.all(20),
                children: [
                  // Avatar
                  Center(child: Column(children: [
                    CircleAvatar(
                      radius: 44,
                      backgroundColor: AppTheme.brandPrimary.withValues(alpha: 0.15),
                      child: Text(
                        _nombre.isNotEmpty
                            ? _nombre.substring(0, 1).toUpperCase()
                            : _username.substring(0, 1).toUpperCase(),
                        style: const TextStyle(
                          color: AppTheme.brandPrimary,
                          fontSize: 36, fontWeight: FontWeight.bold,
                        ),
                      ),
                    ),
                    const SizedBox(height: 12),
                    Text(_nombre.isNotEmpty ? _nombre : _username,
                      style: const TextStyle(color: Colors.white,
                        fontSize: 20, fontWeight: FontWeight.bold)),
                    const SizedBox(height: 4),
                    Text('@$_username',
                      style: const TextStyle(color: AppTheme.brandMuted, fontSize: 13)),
                  ])),
                  const SizedBox(height: 28),

                  // Datos personales
                  _encabezadoSeccion('Datos Personales'),
                  const SizedBox(height: 12),

                  if (_editando) ...[
                    _campo(ctrl: _nombreCtrl, label: 'Nombre completo', icono: Icons.person_outline),
                    const SizedBox(height: 12),
                    _campo(ctrl: _emailCtrl, label: 'Correo electrónico',
                      icono: Icons.email_outlined, keyboard: TextInputType.emailAddress),
                    const SizedBox(height: 12),
                    _campo(ctrl: _telefonoCtrl, label: 'Teléfono',
                      icono: Icons.phone_outlined, keyboard: TextInputType.phone),
                    const SizedBox(height: 16),
                    Row(children: [
                      Expanded(child: OutlinedButton(
                        onPressed: () {
                          _nombreCtrl.text   = _nombre;
                          _emailCtrl.text    = _email;
                          _telefonoCtrl.text = _telefono;
                          setState(() => _editando = false);
                        },
                        style: OutlinedButton.styleFrom(
                          foregroundColor: AppTheme.brandMuted,
                          side: const BorderSide(color: AppTheme.brandBorder),
                          padding: const EdgeInsets.symmetric(vertical: 14),
                        ),
                        child: const Text('Cancelar'),
                      )),
                      const SizedBox(width: 12),
                      Expanded(child: ElevatedButton(
                        style: AppTheme.botonPrimario().copyWith(
                          padding: WidgetStateProperty.all(
                            const EdgeInsets.symmetric(vertical: 14))),
                        onPressed: _guardarPerfil,
                        child: const Text('Guardar'),
                      )),
                    ]),
                  ] else ...[
                    _datoCampo(Icons.person_outline, 'Nombre', _nombre.isNotEmpty ? _nombre : '—'),
                    _datoCampo(Icons.email_outlined, 'Email', _email.isNotEmpty ? _email : '—'),
                    _datoCampo(Icons.phone_outlined, 'Teléfono', _telefono.isNotEmpty ? _telefono : '—'),
                  ],

                  const SizedBox(height: 28),
                  _encabezadoSeccion('Seguridad'),
                  const SizedBox(height: 12),

                  // Cambio de contraseña
                  _campoPassword(ctrl: _passActualCtrl, label: 'Contraseña actual',
                    ver: _verActual, onToggle: () => setState(() => _verActual = !_verActual)),
                  const SizedBox(height: 10),
                  _campoPassword(ctrl: _passNuevaCtrl, label: 'Nueva contraseña',
                    ver: _verNueva, onToggle: () => setState(() => _verNueva = !_verNueva)),
                  const SizedBox(height: 10),
                  _campoPassword(ctrl: _passConfCtrl, label: 'Confirmar nueva contraseña',
                    ver: _verConf, onToggle: () => setState(() => _verConf = !_verConf)),
                  const SizedBox(height: 14),
                  SizedBox(
                    width: double.infinity, height: 48,
                    child: ElevatedButton(
                      style: AppTheme.botonPrimario(),
                      onPressed: _cambiarPassword,
                      child: const Text('Cambiar Contraseña'),
                    ),
                  ),

                  const SizedBox(height: 32),
                  const Divider(color: AppTheme.brandBorder),
                  const SizedBox(height: 16),

                  // Cerrar sesión
                  SizedBox(
                    width: double.infinity, height: 48,
                    child: OutlinedButton.icon(
                      style: OutlinedButton.styleFrom(
                        foregroundColor: AppTheme.estadoRojo,
                        side: BorderSide(color: AppTheme.estadoRojo.withValues(alpha: 0.5)),
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(AppTheme.radius)),
                      ),
                      onPressed: _cerrarSesion,
                      icon: const Icon(Icons.logout_rounded),
                      label: const Text('Cerrar Sesión', style: TextStyle(fontWeight: FontWeight.bold)),
                    ),
                  ),
                  const SizedBox(height: 20),
                ],
              ),
            ),
    );
  }

  Widget _encabezadoSeccion(String texto) {
    return Text(texto, style: const TextStyle(
      color: AppTheme.brandPrimary, fontSize: 11,
      fontWeight: FontWeight.bold, letterSpacing: 1.4));
  }

  Widget _datoCampo(IconData icono, String label, String valor) {
    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      decoration: BoxDecoration(
        color: AppTheme.brandSurface,
        borderRadius: BorderRadius.circular(AppTheme.radius),
      ),
      child: Row(children: [
        Icon(icono, color: AppTheme.brandMuted, size: 18),
        const SizedBox(width: 12),
        Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(label, style: const TextStyle(color: AppTheme.brandMuted, fontSize: 11)),
          const SizedBox(height: 2),
          Text(valor, style: const TextStyle(color: Colors.white, fontSize: 14)),
        ])),
      ]),
    );
  }

  Widget _campo({
    required TextEditingController ctrl,
    required String label,
    IconData? icono,
    TextInputType keyboard = TextInputType.text,
  }) {
    return TextFormField(
      controller: ctrl,
      keyboardType: keyboard,
      style: const TextStyle(color: Colors.white),
      decoration: AppTheme.inputDecoration(label: label, icono: icono),
    );
  }

  Widget _campoPassword({
    required TextEditingController ctrl,
    required String label,
    required bool ver,
    required VoidCallback onToggle,
  }) {
    return TextFormField(
      controller: ctrl,
      obscureText: !ver,
      style: const TextStyle(color: Colors.white),
      decoration: AppTheme.inputDecoration(label: label, icono: Icons.lock_outline)
          .copyWith(suffixIcon: IconButton(
            icon: Icon(ver ? Icons.visibility_off : Icons.visibility,
              color: AppTheme.brandMuted),
            onPressed: onToggle,
          )),
    );
  }
}
