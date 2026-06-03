import 'package:flutter/material.dart';
import '../services/auth_service.dart';
import '../core/app_theme.dart';
import 'main_screen.dart';
import 'registro_screen.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _formKey            = GlobalKey<FormState>();
  final _usernameController = TextEditingController();
  final _passwordController = TextEditingController();
  final _authService        = AuthService();

  bool    _isLoading     = false;
  bool    _verPassword   = false;
  String? _errorMessage;

  @override
  void dispose() {
    _usernameController.dispose();
    _passwordController.dispose();
    super.dispose();
  }

  void _intentarLogin() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() { _isLoading = true; _errorMessage = null; });

    final usuario = await _authService.login(
      _usernameController.text.trim(),
      _passwordController.text,
    );

    if (!mounted) return;
    setState(() => _isLoading = false);

    if (usuario != null) {
      Navigator.pushReplacement(
        context,
        MaterialPageRoute(builder: (_) => const MainScreen()),
      );
    } else {
      setState(() => _errorMessage = 'Usuario o contraseña incorrectos');
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppTheme.brandBg,
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(28),
            child: Form(
              key: _formKey,
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  // Logo
                  Container(
                    width: 80, height: 80,
                    decoration: BoxDecoration(
                      color: AppTheme.brandPrimary.withOpacity(0.15),
                      borderRadius: BorderRadius.circular(24),
                    ),
                    child: const Icon(Icons.shield_rounded, size: 44, color: AppTheme.brandPrimary),
                  ),
                  const SizedBox(height: 24),
                  const Text('BPMS Core',
                    style: TextStyle(color: Colors.white, fontSize: 28, fontWeight: FontWeight.bold)),
                  const SizedBox(height: 6),
                  const Text('Portal del Ciudadano',
                    style: TextStyle(color: AppTheme.brandMuted, fontSize: 15)),
                  const SizedBox(height: 40),

                  // Username
                  TextFormField(
                    controller: _usernameController,
                    style: const TextStyle(color: Colors.white),
                    textInputAction: TextInputAction.next,
                    decoration: AppTheme.inputDecoration(label: 'Usuario', icono: Icons.person_outline),
                    validator: (v) => v!.isEmpty ? 'Ingrese su usuario' : null,
                  ),
                  const SizedBox(height: 16),

                  // Password
                  TextFormField(
                    controller: _passwordController,
                    obscureText: !_verPassword,
                    style: const TextStyle(color: Colors.white),
                    textInputAction: TextInputAction.done,
                    onFieldSubmitted: (_) => _intentarLogin(),
                    decoration: AppTheme.inputDecoration(
                      label: 'Contraseña', icono: Icons.lock_outline,
                    ).copyWith(
                      suffixIcon: IconButton(
                        icon: Icon(
                          _verPassword ? Icons.visibility_off : Icons.visibility,
                          color: AppTheme.brandMuted,
                        ),
                        onPressed: () => setState(() => _verPassword = !_verPassword),
                      ),
                    ),
                    validator: (v) => v!.isEmpty ? 'Ingrese su contraseña' : null,
                  ),
                  const SizedBox(height: 24),

                  // Error
                  if (_errorMessage != null)
                    Container(
                      margin: const EdgeInsets.only(bottom: 16),
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(
                        color: AppTheme.estadoRojo.withOpacity(0.1),
                        borderRadius: BorderRadius.circular(AppTheme.radius),
                        border: Border.all(color: AppTheme.estadoRojo.withOpacity(0.4)),
                      ),
                      child: Row(children: [
                        const Icon(Icons.error_outline, color: Colors.redAccent, size: 18),
                        const SizedBox(width: 8),
                        Expanded(child: Text(_errorMessage!,
                          style: const TextStyle(color: Colors.redAccent, fontSize: 14))),
                      ]),
                    ),

                  // Botón Ingresar
                  SizedBox(
                    width: double.infinity, height: 52,
                    child: ElevatedButton(
                      style: AppTheme.botonPrimario().copyWith(
                        textStyle: WidgetStateProperty.all(
                          const TextStyle(fontSize: 16, fontWeight: FontWeight.bold),
                        ),
                      ),
                      onPressed: _isLoading ? null : _intentarLogin,
                      child: _isLoading
                          ? const SizedBox(width: 24, height: 24,
                              child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2.5))
                          : const Text('Ingresar'),
                    ),
                  ),
                  const SizedBox(height: 20),

                  // Link Registro
                  Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      const Text('¿Nuevo aquí? ',
                        style: TextStyle(color: AppTheme.brandMuted, fontSize: 14)),
                      GestureDetector(
                        onTap: () => Navigator.push(
                          context,
                          MaterialPageRoute(builder: (_) => const RegistroScreen()),
                        ),
                        child: const Text('Crear cuenta',
                          style: TextStyle(
                            color: AppTheme.brandPrimary,
                            fontSize: 14,
                            fontWeight: FontWeight.bold,
                            decoration: TextDecoration.underline,
                            decorationColor: AppTheme.brandPrimary,
                          )),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
