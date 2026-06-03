import 'package:flutter/material.dart';
import '../core/app_theme.dart';
import '../services/auth_service.dart';

class RegistroScreen extends StatefulWidget {
  const RegistroScreen({super.key});

  @override
  State<RegistroScreen> createState() => _RegistroScreenState();
}

class _RegistroScreenState extends State<RegistroScreen> {
  final _formKey              = GlobalKey<FormState>();
  final _authService          = AuthService();

  final _nombreController     = TextEditingController();
  final _apellidoController   = TextEditingController();
  final _emailController      = TextEditingController();
  final _usernameController   = TextEditingController();
  final _telefonoController   = TextEditingController();
  final _dniController        = TextEditingController();
  final _passController       = TextEditingController();
  final _passConfirmController = TextEditingController();

  bool    _isLoading   = false;
  bool    _verPass     = false;
  bool    _verPassConf = false;
  String? _errorMsg;

  @override
  void dispose() {
    _nombreController.dispose();
    _apellidoController.dispose();
    _emailController.dispose();
    _usernameController.dispose();
    _telefonoController.dispose();
    _dniController.dispose();
    _passController.dispose();
    _passConfirmController.dispose();
    super.dispose();
  }

  void _registrar() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() { _isLoading = true; _errorMsg = null; });

    final resultado = await _authService.registrar({
      'nombre':    '${_nombreController.text.trim()} ${_apellidoController.text.trim()}',
      'email':     _emailController.text.trim(),
      'username':  _usernameController.text.trim(),
      'telefono':  _telefonoController.text.trim(),
      'dni':       _dniController.text.trim(),
      'password':  _passController.text,
      'rol':       'CLIENTE',
    });

    if (!mounted) return;
    setState(() => _isLoading = false);

    if (resultado['exito'] == true) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('✅ Cuenta creada. Ingresa con tus credenciales.'),
          backgroundColor: Color(0xFF10B981),
        ),
      );
      Navigator.pop(context);
    } else {
      setState(() => _errorMsg = resultado['mensaje'] ?? 'Error al crear cuenta');
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppTheme.brandBg,
      appBar: AppBar(
        backgroundColor: AppTheme.brandSurface,
        title: const Text('Crear Cuenta', style: TextStyle(color: Colors.white)),
        iconTheme: const IconThemeData(color: Colors.white),
        elevation: 0,
      ),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24),
          child: Form(
            key: _formKey,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text('Datos Personales',
                  style: TextStyle(color: AppTheme.brandPrimary, fontSize: 12,
                    fontWeight: FontWeight.bold, letterSpacing: 1.2)),
                const SizedBox(height: 16),

                Row(children: [
                  Expanded(child: _campo(
                    ctrl: _nombreController,
                    label: 'Nombre *',
                    icono: Icons.person_outline,
                    validator: (v) => v!.isEmpty ? 'Requerido' : null,
                  )),
                  const SizedBox(width: 12),
                  Expanded(child: _campo(
                    ctrl: _apellidoController,
                    label: 'Apellido *',
                    icono: Icons.person_outline,
                    validator: (v) => v!.isEmpty ? 'Requerido' : null,
                  )),
                ]),
                const SizedBox(height: 12),

                _campo(
                  ctrl: _emailController,
                  label: 'Correo electrónico *',
                  icono: Icons.email_outlined,
                  keyboard: TextInputType.emailAddress,
                  validator: (v) {
                    if (v!.isEmpty) return 'Requerido';
                    if (!v.contains('@')) return 'Email inválido';
                    return null;
                  },
                ),
                const SizedBox(height: 12),

                _campo(
                  ctrl: _dniController,
                  label: 'N° de identidad / DPI *',
                  icono: Icons.badge_outlined,
                  keyboard: TextInputType.number,
                  validator: (v) => v!.isEmpty ? 'Requerido' : null,
                ),
                const SizedBox(height: 12),

                _campo(
                  ctrl: _telefonoController,
                  label: 'Teléfono',
                  icono: Icons.phone_outlined,
                  keyboard: TextInputType.phone,
                ),
                const SizedBox(height: 24),

                const Text('Credenciales de Acceso',
                  style: TextStyle(color: AppTheme.brandPrimary, fontSize: 12,
                    fontWeight: FontWeight.bold, letterSpacing: 1.2)),
                const SizedBox(height: 16),

                _campo(
                  ctrl: _usernameController,
                  label: 'Nombre de usuario *',
                  icono: Icons.alternate_email,
                  validator: (v) {
                    if (v!.isEmpty) return 'Requerido';
                    if (v.length < 4) return 'Mínimo 4 caracteres';
                    if (v.contains(' ')) return 'Sin espacios';
                    return null;
                  },
                ),
                const SizedBox(height: 12),

                _campoPassword(
                  ctrl: _passController,
                  label: 'Contraseña *',
                  ver: _verPass,
                  onToggle: () => setState(() => _verPass = !_verPass),
                  validator: (v) {
                    if (v!.isEmpty) return 'Requerido';
                    if (v.length < 6) return 'Mínimo 6 caracteres';
                    return null;
                  },
                ),
                const SizedBox(height: 12),

                _campoPassword(
                  ctrl: _passConfirmController,
                  label: 'Confirmar contraseña *',
                  ver: _verPassConf,
                  onToggle: () => setState(() => _verPassConf = !_verPassConf),
                  validator: (v) {
                    if (v != _passController.text) return 'Las contraseñas no coinciden';
                    return null;
                  },
                ),
                const SizedBox(height: 24),

                if (_errorMsg != null)
                  Container(
                    margin: const EdgeInsets.only(bottom: 16),
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: AppTheme.estadoRojo.withValues(alpha: 0.1),
                      borderRadius: BorderRadius.circular(AppTheme.radius),
                      border: Border.all(color: AppTheme.estadoRojo.withValues(alpha: 0.4)),
                    ),
                    child: Row(children: [
                      const Icon(Icons.error_outline, color: Colors.redAccent, size: 18),
                      const SizedBox(width: 8),
                      Expanded(child: Text(_errorMsg!,
                        style: const TextStyle(color: Colors.redAccent, fontSize: 14))),
                    ]),
                  ),

                SizedBox(
                  width: double.infinity, height: 52,
                  child: ElevatedButton(
                    style: AppTheme.botonPrimario().copyWith(
                      textStyle: WidgetStateProperty.all(
                        const TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
                    ),
                    onPressed: _isLoading ? null : _registrar,
                    child: _isLoading
                        ? const SizedBox(width: 24, height: 24,
                            child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2.5))
                        : const Text('Crear Cuenta'),
                  ),
                ),
                const SizedBox(height: 12),

                Center(
                  child: TextButton(
                    onPressed: () => Navigator.pop(context),
                    child: const Text('Ya tengo cuenta — Ingresar',
                      style: TextStyle(color: AppTheme.brandMuted, fontSize: 13)),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _campo({
    required TextEditingController ctrl,
    required String label,
    IconData? icono,
    TextInputType keyboard = TextInputType.text,
    String? Function(String?)? validator,
  }) {
    return TextFormField(
      controller: ctrl,
      keyboardType: keyboard,
      style: const TextStyle(color: Colors.white),
      decoration: AppTheme.inputDecoration(label: label, icono: icono),
      validator: validator,
    );
  }

  Widget _campoPassword({
    required TextEditingController ctrl,
    required String label,
    required bool ver,
    required VoidCallback onToggle,
    String? Function(String?)? validator,
  }) {
    return TextFormField(
      controller: ctrl,
      obscureText: !ver,
      style: const TextStyle(color: Colors.white),
      decoration: AppTheme.inputDecoration(label: label, icono: Icons.lock_outline)
          .copyWith(
            suffixIcon: IconButton(
              icon: Icon(ver ? Icons.visibility_off : Icons.visibility,
                color: AppTheme.brandMuted),
              onPressed: onToggle,
            ),
          ),
      validator: validator,
    );
  }
}
